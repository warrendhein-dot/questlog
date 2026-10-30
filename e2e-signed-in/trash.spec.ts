import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { todayIn } from "../src/lib/tasks/views";
import { addQuest, expect, test } from "./support/fixtures";
import { signIn } from "./support/session";
import { loadLocalStack } from "./support/stack";
import { clientFor, createTestUser } from "./support/users";

// The Trash, end to end: deleting from the list and from the edit page, the Trash page (restore,
// delete forever, empty), what a trashed quest can no longer do, repeating quests, and privacy.
// The browser's time zone is pinned to UTC in the config, so "today" is the UTC date.

const today = () => todayIn("UTC", new Date());

const open = (page: Page) => page.getByRole("region", { name: "Open quests" });
const done = (page: Page) => page.getByRole("region", { name: "Completed" });
/** The quests on the Trash page (its own main area, so nothing else on the page can be confused with them). */
const trashed = (page: Page) => page.getByRole("main").getByRole("listitem");

/** The id of an open quest, from its link's address. */
async function idOf(page: Page, title: string): Promise<string> {
  const href = await open(page)
    .getByRole("link", { name: title, exact: true })
    .getAttribute("href");
  return href!.split("/").pop()!;
}

/**
 * Opens a quest's edit page and waits until it is really on screen: the home page's own "New quest"
 * form has the same field labels and is still shown for a moment after the click.
 */
async function openEditPage(page: Page, title: string): Promise<void> {
  await open(page).getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
}

/** Adds a quest on the "All quests" view and sends it to the Trash with the list's Delete button. */
async function addAndDelete(page: Page, title: string) {
  await page.goto("/?view=all");
  await addQuest(page, title);
  await open(page)
    .getByRole("button", { name: `Delete quest: ${title}` })
    .click();
  await expect(open(page).getByRole("link", { name: title, exact: true })).toHaveCount(0);
}

test.describe("deleting a quest", () => {
  test("from the list: it leaves the list and waits in the Trash", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Old gym pass", { category: "health", priority: "low" });
    await expect(open(page).getByRole("listitem")).toHaveCount(1);

    await open(page).getByRole("button", { name: "Delete quest: Old gym pass" }).click();
    await expect(open(page).getByRole("listitem")).toHaveCount(0);
    // Still gone after a reload: it was saved, not just hidden.
    await page.goto("/?view=all");
    await expect(page.getByRole("link", { name: "Old gym pass" })).toHaveCount(0);

    await page.getByRole("link", { name: "Trash" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Trash" })).toBeVisible();
    await expect(trashed(page)).toHaveCount(1);
    await expect(trashed(page).getByText("Old gym pass")).toBeVisible();
    await expect(trashed(page).getByText("Health · Low priority")).toBeVisible();
    await expect(
      trashed(page).getByText(`Deleted ${today()} · removed for good around`),
    ).toBeVisible();
  });

  test("a completed quest can be deleted too", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Done and dusted");
    await page.getByRole("button", { name: "Complete quest: Done and dusted" }).click();
    await expect(done(page).getByRole("link", { name: "Done and dusted" })).toBeVisible();

    await done(page).getByRole("button", { name: "Delete quest: Done and dusted" }).click();
    await expect(done(page).getByRole("link", { name: "Done and dusted" })).toHaveCount(0);

    await page.goto("/trash");
    await expect(trashed(page).getByText("Done and dusted")).toBeVisible();
  });

  test("from the edit page: it goes home and the quest is in the Trash", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Edit then delete");
    await openEditPage(page, "Edit then delete");

    await page.getByRole("button", { name: "Delete quest" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/?view=all");
    await expect(page.getByRole("link", { name: "Edit then delete" })).toHaveCount(0);

    await page.goto("/trash");
    await expect(trashed(page).getByText("Edit then delete")).toBeVisible();
  });

  test("a trashed quest's own page is gone, like a page that never existed", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Gone soon");
    const id = await idOf(page, "Gone soon");
    await open(page).getByRole("button", { name: "Delete quest: Gone soon" }).click();
    await expect(open(page).getByRole("listitem")).toHaveCount(0);

    const response = await page.goto(`/tasks/${id}`);
    expect(response?.status()).toBe(404);
  });
});

test.describe("restoring", () => {
  test("brings the quest back with everything it had", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Return of the quest", {
      notes: "Keep these notes",
      category: "learning",
      priority: "high",
      dueDate: today(),
    });
    await open(page).getByRole("button", { name: "Delete quest: Return of the quest" }).click();
    await expect(open(page).getByRole("listitem")).toHaveCount(0);

    await page.goto("/trash");
    await trashed(page).getByRole("button", { name: "Restore quest: Return of the quest" }).click();
    await expect(page.getByText("The Trash is empty.")).toBeVisible();

    await page.goto("/?view=all");
    const item = open(page).getByRole("listitem");
    await expect(item.getByText(`Learning · High priority · Due ${today()}`)).toBeVisible();
    await item.getByRole("link", { name: "Return of the quest" }).click();
    await expect(page.getByLabel("Notes (optional)")).toHaveValue("Keep these notes");
  });

  test("keeps the steps, and they work again afterwards", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "With steps");
    await openEditPage(page, "With steps");
    for (const step of ["First", "Second"]) {
      await page.getByLabel("New step").fill(step);
      await page.getByRole("button", { name: "Add step" }).click();
      await expect(page.getByText(step, { exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "Delete quest" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/trash");
    await trashed(page).getByRole("button", { name: "Restore quest: With steps" }).click();
    await expect(page.getByText("The Trash is empty.")).toBeVisible();

    await page.goto("/?view=all");
    await expect(open(page).getByText("Steps: 0 of 2 done")).toBeVisible();
    await openEditPage(page, "With steps");
    await page.getByRole("button", { name: "Mark done step: First" }).click();
    await expect(page.getByText("1 of 2 done")).toBeVisible();
  });
});

test.describe("deleting for good", () => {
  test("asks first, and Cancel changes nothing", async ({ page }) => {
    await addAndDelete(page, "Think twice");
    await page.goto("/trash");

    await trashed(page).getByRole("button", { name: "Delete forever: Think twice" }).click();
    await expect(
      page.getByText('Delete "Think twice" for good? This cannot be undone.'),
    ).toBeVisible();
    // Keyboard users land on the harmless choice.
    await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText(/cannot be undone/)).toHaveCount(0);
    await expect(
      trashed(page).getByRole("button", { name: "Delete forever: Think twice" }),
    ).toBeFocused();
    await page.reload();
    await expect(trashed(page).getByText("Think twice")).toBeVisible();
  });

  test("removes the quest and its steps once confirmed", async ({ page, user }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Burn after reading");
    await openEditPage(page, "Burn after reading");
    await page.getByLabel("New step").fill("A step");
    await page.getByRole("button", { name: "Add step" }).click();
    await expect(page.getByText("A step", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Delete quest" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/trash");
    await trashed(page).getByRole("button", { name: "Delete forever: Burn after reading" }).click();
    await page.getByRole("button", { name: "Yes, delete forever" }).click();
    await expect(page.getByText("The Trash is empty.")).toBeVisible();

    // Gone from the database, steps included, not merely hidden.
    const api = await clientFor(user);
    expect((await api.from("tasks").select("id")).data).toEqual([]);
    expect((await api.from("subtasks").select("id")).data).toEqual([]);
  });

  test("Empty Trash asks first, then clears the Trash but never touches live quests", async ({
    page,
  }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Keep me");
    for (const title of ["Bin one", "Bin two"]) {
      await addQuest(page, title);
      await open(page)
        .getByRole("button", { name: `Delete quest: ${title}` })
        .click();
      await expect(open(page).getByRole("link", { name: title, exact: true })).toHaveCount(0);
    }

    await page.goto("/trash");
    await expect(trashed(page)).toHaveCount(2);
    await page.getByRole("button", { name: /^Empty Trash/ }).click();
    await expect(
      page.getByText("Delete all 2 quests in the Trash for good? This cannot be undone."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Yes, empty the Trash" }).click();
    await expect(page.getByText("The Trash is empty.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Empty Trash/ })).toHaveCount(0);

    await page.goto("/?view=all");
    await expect(open(page).getByRole("link", { name: "Keep me" })).toBeVisible();
  });
});

test.describe("what a quest in the Trash can no longer do", () => {
  test("it cannot be edited, completed, given steps, or brought back through the API", async ({
    page,
    user,
  }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Frozen");
    const id = await idOf(page, "Frozen");
    await open(page).getByRole("button", { name: "Delete quest: Frozen" }).click();
    await expect(open(page).getByRole("listitem")).toHaveCount(0);

    const api = await clientFor(user);

    const edit = await api.from("tasks").update({ title: "Thawed" }).eq("id", id).select();
    expect(edit.data).toEqual([]);

    const complete = await api.rpc("complete_task", { p_task_id: id, p_next_due: null });
    expect(complete.error).toBeNull();
    const reopen = await api.rpc("reopen_task", { p_task_id: id });
    expect(reopen.data).toBe(false);

    const step = await api.from("subtasks").insert({ task_id: id, title: "Sneaky" });
    expect(step.error).not.toBeNull();

    // Nor can anyone, including the owner, write the delete time directly.
    const untrash = await api.from("tasks").update({ deleted_at: null }).eq("id", id);
    expect(untrash.error).not.toBeNull();

    // After all of that it is still the same quest, still in the Trash, and still open.
    await page.goto("/trash");
    await expect(trashed(page).getByText("Frozen")).toBeVisible();
    await trashed(page).getByRole("button", { name: "Restore quest: Frozen" }).click();
    await expect(page.getByText("The Trash is empty.")).toBeVisible();
    await page.goto("/?view=all");
    await expect(open(page).getByRole("link", { name: "Frozen", exact: true })).toBeVisible();
    await expect(done(page).getByRole("link", { name: "Frozen" })).toHaveCount(0);
  });

  test("the API cannot delete a quest that is not in the Trash", async ({ page, user }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Still alive");
    const id = await idOf(page, "Still alive");

    const api = await clientFor(user);
    const attempt = await api.from("tasks").delete().eq("id", id).select();
    expect(attempt.data).toEqual([]);

    await page.goto("/?view=all");
    await expect(open(page).getByRole("link", { name: "Still alive" })).toBeVisible();
  });
});

test.describe("repeating quests and the Trash", () => {
  test("deleting the next one ends the series, and restoring it carries on", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Series", { dueDate: today(), repeat: "daily" });
    await page.getByRole("button", { name: "Complete quest: Series" }).click();
    await expect(done(page).getByRole("link", { name: "Series" })).toBeVisible();
    await expect(open(page).getByRole("listitem")).toHaveCount(1);

    // Delete the next occurrence: the series ends there.
    await open(page).getByRole("button", { name: "Delete quest: Series" }).click();
    await expect(open(page).getByRole("listitem")).toHaveCount(0);

    // Undo and complete the first one again: no new next occurrence is created.
    await done(page).getByRole("button", { name: "Undo quest: Series" }).click();
    await expect(open(page).getByRole("listitem")).toHaveCount(1);
    await open(page).getByRole("button", { name: "Complete quest: Series" }).click();
    await expect(done(page).getByRole("link", { name: "Series" })).toBeVisible();
    await expect(open(page).getByRole("listitem")).toHaveCount(0);

    // Restoring the deleted one brings the series back.
    await page.goto("/trash");
    await trashed(page).getByRole("button", { name: "Restore quest: Series" }).click();
    await expect(page.getByText("The Trash is empty.")).toBeVisible();
    await page.goto("/?view=all");
    await expect(open(page).getByRole("listitem")).toHaveCount(1);
    await expect(open(page).getByText("Repeats every day")).toBeVisible();
  });

  test("the Trash says how a repeating quest repeats", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Weekly chore", { dueDate: today(), repeat: "weekly", interval: "2" });
    await open(page).getByRole("button", { name: "Delete quest: Weekly chore" }).click();
    await expect(open(page).getByRole("listitem")).toHaveCount(0);

    await page.goto("/trash");
    await expect(trashed(page).getByText("Repeats every 2 weeks")).toBeVisible();
  });
});

test.describe("one user cannot touch another's Trash", () => {
  test("seeing, restoring, deleting, or emptying", async ({ page, user, browser, baseURL }) => {
    await addAndDelete(page, "Alice's bin");
    await page.goto("/?view=all");
    await addQuest(page, "Alice's live quest");
    const liveId = await idOf(page, "Alice's live quest");
    const aliceApi = await clientFor(user);
    const binned = await aliceApi.from("tasks").select("id").eq("title", "Alice's bin");
    const binnedId = (binned.data as { id: string }[])[0]!.id;

    const bob = await createTestUser();
    const bobContext = await browser.newContext({ baseURL });
    await signIn(bobContext, baseURL!, bob);
    const bobPage = await bobContext.newPage();

    // His Trash page does not show hers.
    await bobPage.goto("/trash");
    await expect(bobPage.getByText("The Trash is empty.")).toBeVisible();
    await expect(bobPage.getByText("Alice's bin")).toHaveCount(0);

    // Straight to the database as Bob: nothing happens to her quests, and nothing is revealed.
    const bobApi = await clientFor(bob);
    expect((await bobApi.rpc("trash_task", { p_task_id: liveId })).data).toBe(false);
    expect((await bobApi.rpc("restore_task", { p_task_id: binnedId })).data).toBe(false);
    expect((await bobApi.from("tasks").delete().eq("id", binnedId).select()).data).toEqual([]);
    expect(
      (await bobApi.from("tasks").delete().not("deleted_at", "is", null).select()).data,
    ).toEqual([]);

    // Alice's quests are exactly as she left them.
    await page.goto("/trash");
    await expect(trashed(page).getByText("Alice's bin")).toBeVisible();
    await page.goto("/?view=all");
    await expect(open(page).getByRole("link", { name: "Alice's live quest" })).toBeVisible();

    await bobContext.close();
  });

  test("signed-out visitors cannot reach the Trash page or its functions", async ({
    page,
    browser,
    baseURL,
  }) => {
    await addAndDelete(page, "Private bin");
    await page.goto("/?view=all");
    await addQuest(page, "Private live quest");
    const id = await idOf(page, "Private live quest");

    const visitor = await browser.newContext({ baseURL });
    const visitorPage = await visitor.newPage();
    await visitorPage.goto("/trash");
    await expect(visitorPage).toHaveURL(/\/login$/);
    await visitor.close();

    const stack = loadLocalStack();
    const anon = createClient(stack.url, stack.publishableKey, { auth: { persistSession: false } });
    expect((await anon.rpc("trash_task", { p_task_id: id })).error).not.toBeNull();
    expect((await anon.rpc("restore_task", { p_task_id: id })).error).not.toBeNull();
    expect((await anon.rpc("purge_trash")).error).not.toBeNull();
  });

  test("signed-in users cannot run the purge", async ({ user }) => {
    const api = await clientFor(user);
    expect((await api.rpc("purge_trash")).error).not.toBeNull();
  });
});

test.describe("quality", () => {
  test("shows markup in a quest name as plain text in the Trash", async ({ page }) => {
    await addAndDelete(page, '<img src=x onerror="alert(1)">');
    await page.goto("/trash");
    await expect(page.locator("main img")).toHaveCount(0);
    await expect(trashed(page).getByText('<img src=x onerror="alert(1)">')).toBeVisible();
  });

  test("logs no console errors, which also means no security-policy violations", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await addAndDelete(page, "Console check");
    await page.goto("/trash");
    await trashed(page).getByRole("button", { name: "Restore quest: Console check" }).click();
    await expect(page.getByText("The Trash is empty.")).toBeVisible();
    await page.goto("/?view=all");
    await open(page).getByRole("button", { name: "Delete quest: Console check" }).click();
    await expect(open(page).getByRole("listitem")).toHaveCount(0);
    await page.goto("/trash");
    await trashed(page).getByRole("button", { name: "Delete forever: Console check" }).click();
    await page.getByRole("button", { name: "Yes, delete forever" }).click();
    await expect(page.getByText("The Trash is empty.")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("has no detectable accessibility violations on the Trash, even while asking (WCAG 2.1 AA)", async ({
    page,
  }) => {
    const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
    await addAndDelete(page, "Accessible bin");
    await page.goto("/?view=all");
    await addQuest(page, "Second bin");
    await open(page).getByRole("button", { name: "Delete quest: Second bin" }).click();
    await expect(open(page).getByRole("listitem")).toHaveCount(0);

    await page.goto("/trash");
    await expect(trashed(page)).toHaveCount(2);
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);

    // With a question on screen as well.
    await page.getByRole("button", { name: /^Empty Trash/ }).click();
    await expect(page.getByText(/cannot be undone/)).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);

    // And the home page and edit page, which gained a Delete button.
    await page.goto("/?view=all");
    await addQuest(page, "Live one");
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
    await openEditPage(page, "Live one");
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  });

  test("can be used with the keyboard alone", async ({ page }) => {
    await addAndDelete(page, "Keyboard bin");
    await page.goto("/trash");

    await trashed(page).getByRole("button", { name: "Delete forever: Keyboard bin" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
    // The confirming button sits just before Cancel, so Shift+Tab reaches it.
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Yes, delete forever" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("The Trash is empty.")).toBeVisible();
  });
});
