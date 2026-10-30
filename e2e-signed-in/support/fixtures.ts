import { test as base, expect, type Page } from "@playwright/test";
import { signIn } from "./session";
import { createTestUser, type TestUser } from "./users";

type Fixtures = {
  /** A brand-new user, created just for this test. */
  user: TestUser;
};

/**
 * Like Playwright's normal `test`, except that `page` is already signed in as a fresh `user`.
 * For a signed-out visitor or a second user, make another browser context in the test itself.
 */
export const test = base.extend<Fixtures>({
  // Playwright calls the second argument `use` by convention, but React's lint rules mistake that for
  // React's own `use` hook, so it is named `provide` here. The name is arbitrary.
  user: async ({}, provide) => {
    await provide(await createTestUser());
  },
  page: async ({ page, context, baseURL, user }, provide) => {
    await signIn(context, baseURL!, user);
    await provide(page);
  },
});

export { expect };

/** Fills in and submits the "New quest" form, then waits for the quest to appear in the list. */
export async function addQuest(
  page: Page,
  title: string,
  options: {
    notes?: string;
    category?: string;
    priority?: string;
    dueDate?: string;
    /** "daily", "weekly" or "monthly". */
    repeat?: string;
    /** The "every N" number. */
    interval?: string;
    /** Names of the weekday boxes to tick, for example ["Monday", "Thursday"]. */
    weekdays?: string[];
  } = {},
): Promise<void> {
  await page.getByLabel("Quest name").fill(title);
  if (options.notes) await page.getByLabel("Notes (optional)").fill(options.notes);
  if (options.category) await page.getByLabel("Category").selectOption(options.category);
  if (options.priority) await page.getByLabel("Priority").selectOption(options.priority);
  if (options.dueDate) await page.getByLabel("Due date (optional)").fill(options.dueDate);
  if (options.repeat) await page.getByLabel("Repeats").selectOption(options.repeat);
  if (options.interval) {
    await page.getByLabel("Every (number of days, weeks or months)").fill(options.interval);
  }
  for (const day of options.weekdays ?? []) await page.getByLabel(day).check();
  await page.getByRole("button", { name: "Add quest" }).click();
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
}
