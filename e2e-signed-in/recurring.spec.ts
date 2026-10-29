import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { nextOccurrence } from "../src/lib/tasks/recurrence";
import { addDays, todayIn } from "../src/lib/tasks/views";
import { addQuest, expect, test } from "./support/fixtures";
import { loadLocalStack } from "./support/stack";
import { clientFor, createTestUser } from "./support/users";

// Repeating quests, end to end: the form, the database function that completes a quest and creates
// the next one, and the lists. The browser's time zone is pinned to UTC in the config, so "today" is
// the UTC date. Expected dates come from the same function the app uses, which has its own tests.

const today = () => todayIn("UTC", new Date());

const open = (page: Page) => page.getByRole("region", { name: "Open quests" });
const done = (page: Page) => page.getByRole("region", { name: "Completed" });

/** The id of a quest in the list, from the link's address. */
async function idOf(page: Page, title: string): Promise<string> {
  const href = await open(page)
    .getByRole("link", { name: title, exact: true })
    .getAttribute("href");
  return href!.split("/").pop()!;
}

test.describe("completing a repeating quest", () => {
  test("creates the next one, due on the next scheduled date", async ({ page }) => {
    const start = today();
    await page.goto("/?view=all");
    await addQuest(page, "Water the plants", {
      dueDate: start,
      repeat: "weekly",
      category: "home",
      priority: "high",
      notes: "Front and back",
    });
    await expect(open(page).getByText("Repeats every week")).toBeVisible();

    await page.getByRole("button", { name: "Complete quest: Water the plants" }).click();

    const next = nextOccurrence({ frequency: "weekly", interval: 1, weekdays: [] }, start, start)!;
    await expect(done(page).getByRole("link", { name: "Water the plants" })).toBeVisible();
    const item = open(page).getByRole("listitem");
    await expect(item).toHaveCount(1);
    await expect(item.getByRole("link", { name: "Water the plants" })).toBeVisible();
    await expect(item.getByText(`Home · High priority · Due ${next}`)).toBeVisible();
    await expect(item.getByText("Repeats every week")).toBeVisible();

    // Everything else was copied across too.
    await item.getByRole("link", { name: "Water the plants" }).click();
    await expect(page.getByLabel("Notes (optional)")).toHaveValue("Front and back");
  });

  test("keeps the steps, all to do again", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Tidy the garage", { dueDate: today(), repeat: "daily" });
    await page.getByRole("link", { name: "Tidy the garage" }).click();
    for (const step of ["Sweep", "Sort the boxes"]) {
      await page.getByLabel("New step").fill(step);
      await page.getByRole("button", { name: "Add step" }).click();
      await expect(
        page.getByRole("region", { name: "Steps" }).getByRole("listitem").filter({ hasText: step }),
      ).toBeVisible();
    }
    await page.getByRole("button", { name: "Mark done step: Sweep" }).click();
    await expect(page.getByText("1 of 2 done")).toBeVisible();

    await page.goto("/?view=all");
    await page.getByRole("button", { name: "Complete quest: Tidy the garage" }).click();
    await expect(done(page).getByRole("link", { name: "Tidy the garage" })).toBeVisible();

    // The new quest has both steps, none ticked, in the same order.
    await expect(open(page).getByText("Steps: 0 of 2 done")).toBeVisible();
    await open(page).getByRole("link", { name: "Tidy the garage" }).click();
    const steps = page.getByRole("region", { name: "Steps" }).getByRole("listitem").locator("span");
    await expect(steps).toHaveText(["Sweep", "Sort the boxes"]);
    await expect(page.getByText("0 of 2 done")).toBeVisible();
  });

  test("skips ahead when finished late, instead of piling up past copies", async ({ page }) => {
    const yesterday = addDays(today(), -1);
    await page.goto("/?view=all");
    await addQuest(page, "Take the vitamins", { dueDate: yesterday, repeat: "daily" });
    await page.getByRole("button", { name: "Complete quest: Take the vitamins" }).click();

    // Due yesterday, finished today: the next one is tomorrow, not today and not yesterday.
    await expect(open(page).getByText(new RegExp(`Due ${addDays(today(), 1)}$`))).toBeVisible();
    await expect(open(page).getByRole("listitem")).toHaveCount(1);
  });

  test("a monthly quest on the 31st goes to the end of short months and then returns to the 31st", async ({
    page,
  }) => {
    // Far in the future, so the dates do not depend on when the test runs.
    await page.goto("/?view=all");
    await addQuest(page, "Pay the rent", { dueDate: "2090-01-31", repeat: "monthly" });

    await page.getByRole("button", { name: "Complete quest: Pay the rent" }).click();
    await expect(open(page).getByText(/Due 2090-02-28$/)).toBeVisible();

    await page.getByRole("button", { name: "Complete quest: Pay the rent" }).click();
    await expect(open(page).getByText(/Due 2090-03-31$/)).toBeVisible(); // not the 28th: no drift
  });

  test("weekly on chosen days moves to the next chosen day", async ({ page }) => {
    // Monday 5 February 2091 is a Monday: Monday and Thursday -> Thursday 8th -> Monday 12th.
    await page.goto("/?view=all");
    await addQuest(page, "Gym", {
      dueDate: "2091-02-05",
      repeat: "weekly",
      weekdays: ["Monday", "Thursday"],
    });
    await expect(open(page).getByText("Repeats every week on Mon, Thu")).toBeVisible();

    await page.getByRole("button", { name: "Complete quest: Gym" }).click();
    await expect(open(page).getByText(/Due 2091-02-08$/)).toBeVisible();
    await page.getByRole("button", { name: "Complete quest: Gym" }).click();
    await expect(open(page).getByText(/Due 2091-02-12$/)).toBeVisible();
  });

  test("an ordinary quest completes as before, with nothing created", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "One-off job", { dueDate: today() });
    await page.getByRole("button", { name: "Complete quest: One-off job" }).click();
    await expect(done(page).getByRole("link", { name: "One-off job" })).toBeVisible();
    await expect(open(page).getByText("One-off job")).toHaveCount(0);
  });
});

test.describe("pressing the button twice", () => {
  test("never creates two next quests", async ({ page, user }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Double click", { dueDate: today(), repeat: "daily" });
    const id = await idOf(page, "Double click");
    const next = addDays(today(), 1);

    // Two completions race each other straight at the database, the way two quick clicks would.
    const api = await clientFor(user);
    const [a, b] = await Promise.all([
      api.rpc("complete_task", { p_task_id: id, p_next_due: next }),
      api.rpc("complete_task", { p_task_id: id, p_next_due: next }),
    ]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();

    const rows = await api.from("tasks").select("id, completed_at").eq("title", "Double click");
    expect(rows.data).toHaveLength(2);
    expect(rows.data!.filter((r) => r.completed_at === null)).toHaveLength(1);
  });
});

test.describe("Undo on a repeating quest", () => {
  test("removes the untouched next quest it created", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Undo me", { dueDate: today(), repeat: "daily" });
    await page.getByRole("button", { name: "Complete quest: Undo me" }).click();
    await expect(done(page).getByRole("link", { name: "Undo me" })).toBeVisible();
    await expect(open(page).getByRole("listitem")).toHaveCount(1);

    await page.getByRole("button", { name: "Undo quest: Undo me" }).click();
    await expect(done(page).getByRole("link", { name: "Undo me" })).toHaveCount(0);
    await expect(open(page).getByRole("listitem")).toHaveCount(1);
    await expect(open(page).getByText(new RegExp(`Due ${today()}$`))).toBeVisible();
  });

  test("keeps the next quest if you have already worked on it", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Keep my edits", { dueDate: today(), repeat: "daily" });
    await page.getByRole("button", { name: "Complete quest: Keep my edits" }).click();
    await expect(done(page).getByRole("link", { name: "Keep my edits" })).toBeVisible();

    // Rename the new one.
    await open(page).getByRole("link", { name: "Keep my edits" }).click();
    await page.getByLabel("Quest name").fill("Keep my edits (renamed)");
    await page.getByRole("button", { name: "Save changes" }).click();
    // Wait for the save to finish (it returns to the home page) before navigating away, or the
    // browser can cancel the save part-way.
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/?view=all");

    await page.getByRole("button", { name: "Undo quest: Keep my edits" }).click();
    await expect(open(page).getByRole("listitem")).toHaveCount(2);
    await expect(open(page).getByRole("link", { name: "Keep my edits (renamed)" })).toBeVisible();
    await expect(
      open(page).getByRole("link", { name: "Keep my edits", exact: true }),
    ).toBeVisible();
  });

  test("does not create another copy when completed again", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Again and again", { dueDate: today(), repeat: "daily" });
    await page.getByRole("button", { name: "Complete quest: Again and again" }).click();
    await expect(open(page).getByRole("listitem")).toHaveCount(1);
    await page.getByRole("button", { name: "Undo quest: Again and again" }).click();
    await expect(open(page).getByRole("listitem")).toHaveCount(1);

    await page.getByRole("button", { name: "Complete quest: Again and again" }).click();
    await expect(done(page).getByRole("link", { name: "Again and again" })).toBeVisible();
    await expect(open(page).getByRole("listitem")).toHaveCount(1);
  });
});

test.describe("setting the rule", () => {
  test("a repeating quest needs a due date, and nothing typed is lost", async ({ page }) => {
    await page.goto("/?view=all");
    await page.getByLabel("Quest name").fill("No date given");
    await page.getByLabel("Repeats").selectOption("weekly");
    await page.getByRole("button", { name: "Add quest" }).click();

    await expect(page.getByText(/needs a date to start from/)).toBeVisible();
    await expect(page.getByLabel("Due date (optional)")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Quest name")).toHaveValue("No date given");
    await expect(page.getByLabel("Repeats")).toHaveValue("weekly");
  });

  test("rejects a nonsense number and keeps the rest", async ({ page }) => {
    await page.goto("/?view=all");
    await page.getByLabel("Quest name").fill("Odd number");
    await page.getByLabel("Due date (optional)").fill(today());
    await page.getByLabel("Repeats").selectOption("daily");
    await page.getByLabel("Every (number of days, weeks or months)").fill("999");
    await page.getByRole("button", { name: "Add quest" }).click();

    await expect(page.getByText("Use a whole number from 1 to 365.")).toBeVisible();
    await expect(page.getByLabel("Every (number of days, weeks or months)")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page.getByLabel("Quest name")).toHaveValue("Odd number");
  });

  test("turns repeating on and off from the edit page", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Switch me", { dueDate: today() });
    await expect(open(page).getByText(/Repeats/)).toHaveCount(0);

    await page.getByRole("link", { name: "Switch me" }).click();
    await page.getByLabel("Repeats").selectOption("monthly");
    await page.getByLabel("Every (number of days, weeks or months)").fill("3");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/?view=all");
    await expect(open(page).getByText("Repeats every 3 months")).toBeVisible();

    await page.getByRole("link", { name: "Switch me" }).click();
    await expect(page.getByLabel("Repeats")).toHaveValue("monthly");
    await expect(page.getByLabel("Every (number of days, weeks or months)")).toHaveValue("3");
    await page.getByLabel("Repeats").selectOption("none");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/?view=all");
    await expect(open(page).getByText(/Repeats/)).toHaveCount(0);
  });
});

test.describe("one user cannot touch another's repeating quest", () => {
  test("completing, re-opening, or faking a completion time", async ({ page, user }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Alice's routine", { dueDate: today(), repeat: "daily" });
    const id = await idOf(page, "Alice's routine");

    const bobApi = await clientFor(await createTestUser());
    const complete = await bobApi.rpc("complete_task", {
      p_task_id: id,
      p_next_due: addDays(today(), 1),
    });
    expect(complete.error).toBeNull();
    expect(complete.data).toBeNull(); // nothing happened, and nothing was created

    const reopen = await bobApi.rpc("reopen_task", { p_task_id: id });
    expect(reopen.data).toBe(false);

    // Nor can anyone, including the owner, write a completion time straight into the table.
    const forged = await (
      await clientFor(user)
    )
      .from("tasks")
      .update({ completed_at: "2020-01-01T00:00:00Z" })
      .eq("id", id);
    expect(forged.error).not.toBeNull();

    const aliceApi = await clientFor(user);
    const rows = await aliceApi.from("tasks").select("completed_at").eq("title", "Alice's routine");
    expect(rows.data).toEqual([{ completed_at: null }]);
  });

  test("signed-out visitors cannot call the completion functions at all", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Private", { dueDate: today(), repeat: "daily" });
    const id = await idOf(page, "Private");

    const stack = loadLocalStack();
    const anon = createClient(stack.url, stack.publishableKey, {
      auth: { persistSession: false },
    });
    const attempt = await anon.rpc("complete_task", { p_task_id: id, p_next_due: null });
    expect(attempt.error).not.toBeNull();
  });
});

test.describe("quality", () => {
  test("logs no console errors, which also means no security-policy violations", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/?view=all");
    await addQuest(page, "Console check", { dueDate: today(), repeat: "daily" });
    await page.getByRole("button", { name: "Complete quest: Console check" }).click();
    await expect(done(page).getByRole("link", { name: "Console check" })).toBeVisible();
    await page.getByRole("button", { name: "Undo quest: Console check" }).click();
    await expect(done(page).getByRole("link", { name: "Console check" })).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test("has no detectable accessibility violations in the form, the lists and the edit page (WCAG 2.1 AA)", async ({
    page,
  }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Accessible", {
      dueDate: today(),
      repeat: "weekly",
      interval: "2",
      weekdays: ["Monday", "Thursday"],
    });
    const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);

    // With a rejected form on screen as well.
    await page.getByLabel("Quest name").fill("Bad");
    await page.getByLabel("Repeats").selectOption("daily");
    await page.getByRole("button", { name: "Add quest" }).click();
    await expect(page.getByText(/needs a date to start from/)).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);

    await page.goto("/?view=all");
    await page.getByRole("link", { name: "Accessible" }).click();
    await expect(page.getByLabel("Repeats")).toHaveValue("weekly");
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  });

  test("can be used with the keyboard alone", async ({ page }) => {
    await page.goto("/?view=all");
    await page.getByLabel("Quest name").focus();
    await page.keyboard.type("Keyboard repeat");
    await page.getByLabel("Due date (optional)").fill(today());
    await page.getByLabel("Repeats").focus();
    await page.keyboard.press("ArrowDown"); // Never -> Daily
    await expect(page.getByLabel("Repeats")).toHaveValue("daily");
    await page.getByLabel("Quest name").focus();
    await page.keyboard.press("Enter");
    await expect(open(page).getByText("Repeats every day")).toBeVisible();
  });
});
