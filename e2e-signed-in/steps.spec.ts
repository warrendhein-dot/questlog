import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { addQuest, expect, test } from "./support/fixtures";
import { clientFor } from "./support/users";

// Steps ("subtasks") are managed on a quest's edit page and counted on the home list. Every test
// runs signed in as a brand-new user against the throwaway Supabase.

/** From the home page, opens a quest's edit page. */
async function openQuest(page: Page, title: string) {
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit quest" })).toBeVisible();
}

/** Adds a step on the edit page and waits for it to appear in the list. */
async function addStep(page: Page, title: string) {
  await page.getByLabel("New step").fill(title);
  await page.getByRole("button", { name: "Add step" }).click();
  await expect(steps(page).getByRole("listitem").filter({ hasText: title })).toBeVisible();
}

const steps = (page: Page) => page.getByRole("region", { name: "Steps" });

test.describe("steps on the edit page", () => {
  test("starts with an invitation to add the first step", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Plan the party");
    await openQuest(page, "Plan the party");
    await expect(steps(page).getByText(/No steps yet/)).toBeVisible();
    await expect(page.getByText(/All steps done/)).toHaveCount(0);
  });

  test("adds steps in order, still there after a reload, and counts them on the home list", async ({
    page,
  }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Plan the party");
    await openQuest(page, "Plan the party");
    await addStep(page, "Book the venue");
    await addStep(page, "Send invitations");
    await expect(steps(page).getByText("0 of 2 done")).toBeVisible();

    await page.reload();
    const titles = await steps(page).getByRole("listitem").locator("span").allTextContents();
    expect(titles).toEqual(["Book the venue", "Send invitations"]);

    await page.goto("/?view=all");
    await expect(page.getByText("Steps: 0 of 2 done")).toBeVisible();
  });

  test("ticks and un-ticks a step, and the home list follows", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Plan the party");
    await openQuest(page, "Plan the party");
    await addStep(page, "Book the venue");
    await addStep(page, "Send invitations");

    await page.getByRole("button", { name: "Mark done step: Book the venue" }).click();
    await expect(steps(page).getByText("1 of 2 done")).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo step: Book the venue" })).toBeVisible();

    await page.goto("/?view=all");
    await expect(page.getByText("Steps: 1 of 2 done")).toBeVisible();

    await openQuest(page, "Plan the party");
    await page.getByRole("button", { name: "Undo step: Book the venue" }).click();
    await expect(steps(page).getByText("0 of 2 done")).toBeVisible();
  });

  test("offers to complete the quest when the last step is ticked, but waits to be asked", async ({
    page,
  }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Plan the party");
    await openQuest(page, "Plan the party");
    await addStep(page, "Book the venue");
    await addStep(page, "Send invitations");

    await page.getByRole("button", { name: "Mark done step: Book the venue" }).click();
    await expect(steps(page).getByText("1 of 2 done")).toBeVisible();
    await expect(page.getByText("All steps done. Complete the quest?")).toHaveCount(0);

    await page.getByRole("button", { name: "Mark done step: Send invitations" }).click();
    await expect(page.getByText("All steps done. Complete the quest?")).toBeVisible();

    // Nothing completed by itself: the quest is still open on the home page.
    await page.goto("/?view=all");
    await expect(
      page
        .getByRole("region", { name: "Open quests" })
        .getByRole("link", { name: "Plan the party" }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Completed" }).getByRole("link")).toHaveCount(0);

    // Accepting the offer completes it.
    await openQuest(page, "Plan the party");
    await page.getByRole("button", { name: "Complete quest", exact: true }).click();
    await expect(page.getByText("This quest is completed.")).toBeVisible();
    await expect(page.getByText("All steps done. Complete the quest?")).toHaveCount(0);
    await page.goto("/?view=all");
    await expect(
      page.getByRole("region", { name: "Completed" }).getByRole("link", { name: "Plan the party" }),
    ).toBeVisible();
  });

  test("removes a step", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Plan the party");
    await openQuest(page, "Plan the party");
    await addStep(page, "Book the venue");
    await addStep(page, "Send invitations");

    await page.getByRole("button", { name: "Remove step: Book the venue" }).click();
    await expect(steps(page).getByText("Book the venue")).toHaveCount(0);
    await expect(steps(page).getByText("Send invitations")).toBeVisible();
    await expect(steps(page).getByText("0 of 1 done")).toBeVisible();
  });

  test("goes back to the plain list when the last step is removed", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Plan the party");
    await openQuest(page, "Plan the party");
    await addStep(page, "Only step");
    await page.getByRole("button", { name: "Remove step: Only step" }).click();
    await expect(steps(page).getByText(/No steps yet/)).toBeVisible();
    await page.goto("/?view=all");
    await expect(page.getByText(/Steps:/)).toHaveCount(0);
  });

  test("can be used with the keyboard alone", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Plan the party");
    await openQuest(page, "Plan the party");
    await page.getByLabel("New step").focus();
    await page.keyboard.type("Keyboard step");
    await page.keyboard.press("Enter");
    await expect(
      steps(page).getByRole("listitem").filter({ hasText: "Keyboard step" }),
    ).toBeVisible();
  });
});

test.describe("mistakes and hostile input", () => {
  test("asks for a name and keeps the field when a step has none", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Plan the party");
    await openQuest(page, "Plan the party");
    await page.getByLabel("New step").fill("   ");
    await page.getByRole("button", { name: "Add step" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Give the step a name.");
    await expect(page.getByLabel("New step")).toHaveAttribute("aria-invalid", "true");
    await expect(steps(page).getByText(/No steps yet/)).toBeVisible();
  });

  test("shows markup in a step name as plain text", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Plan the party");
    await openQuest(page, "Plan the party");
    await addStep(page, '<img src=x onerror="window.pwned=1"> <b>bold</b>');
    expect(
      await page.evaluate(() => (window as unknown as { pwned?: number }).pwned),
    ).toBeUndefined();
    await expect(page.locator("main img")).toHaveCount(0);
  });

  test("tells the user plainly when a quest is full", async ({ page, user }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Plan the party");
    const href = await page.getByRole("link", { name: "Plan the party" }).getAttribute("href");
    const taskId = href!.split("/").pop()!;

    const api = await clientFor(user);
    const filled = await api
      .from("subtasks")
      .insert(Array.from({ length: 50 }, (_, i) => ({ task_id: taskId, title: `Step ${i}` })));
    expect(filled.error).toBeNull();

    await openQuest(page, "Plan the party");
    await page.getByLabel("New step").fill("One too many");
    await page.getByRole("button", { name: "Add step" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("at most 50 steps");
    await expect(page.getByLabel("New step")).toHaveValue("One too many"); // nothing typed is lost
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
    await addQuest(page, "Plan the party");
    await openQuest(page, "Plan the party");
    await addStep(page, "Book the venue");
    await page.getByRole("button", { name: "Mark done step: Book the venue" }).click();
    await expect(page.getByText("All steps done. Complete the quest?")).toBeVisible();
    await page.getByRole("button", { name: "Remove step: Book the venue" }).click();
    await expect(steps(page).getByText(/No steps yet/)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("has no detectable accessibility violations with steps, ticked steps and the offer on screen", async ({
    page,
  }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Plan the party");
    await openQuest(page, "Plan the party");
    await addStep(page, "Book the venue");
    await addStep(page, "Send invitations");
    await page.getByRole("button", { name: "Mark done step: Book the venue" }).click();
    await expect(steps(page).getByText("1 of 2 done")).toBeVisible();

    const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);

    // Tick the second step too, so the "complete the quest?" offer is on screen.
    await page.getByRole("button", { name: "Mark done step: Send invitations" }).click();
    await expect(page.getByText("All steps done. Complete the quest?")).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);

    // And the home list with its step count.
    await page.goto("/?view=all");
    await expect(page.getByText("Steps: 2 of 2 done")).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  });
});
