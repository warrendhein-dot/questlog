import AxeBuilder from "@axe-core/playwright";
import { addQuest, expect, test } from "./support/fixtures";
import { clientFor } from "./support/users";

// Every test here runs in a browser that is signed in as a brand-new user, against a throwaway
// Supabase with our real tables, security rules and rate limit. See e2e-signed-in/support/.

test.describe("the quest list", () => {
  test("greets a new user with an empty log and says who is signed in", async ({ page, user }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Questlog" })).toBeVisible();
    await expect(page.getByText(`Signed in as ${user.email}`)).toBeVisible();
    await expect(page.getByText("No open quests. Add your first one above.")).toBeVisible();
    await expect(page.getByText("Nothing completed yet.")).toBeVisible();
  });

  test("adds a quest with all its details, and it is still there after a reload", async ({
    page,
  }) => {
    await page.goto("/");
    await addQuest(page, "Slay the inbox", {
      notes: "Zero unread",
      category: "health",
      priority: "high",
      dueDate: "2026-12-24",
    });
    const open = page.getByRole("region", { name: "Open quests" });
    await expect(open.getByText("Health · High priority · Due 2026-12-24")).toBeVisible();

    await page.reload();
    await expect(open.getByRole("link", { name: "Slay the inbox" })).toBeVisible();
  });

  test("clears the form after a quest is added, ready for the next one", async ({ page }) => {
    await page.goto("/");
    await addQuest(page, "First quest", { notes: "some notes", category: "social" });
    await expect(page.getByLabel("Quest name")).toHaveValue("");
    await expect(page.getByLabel("Notes (optional)")).toHaveValue("");
    await expect(page.getByLabel("Category")).toHaveValue("work");
  });

  test("completes a quest and moves it back again with Undo", async ({ page }) => {
    await page.goto("/");
    await addQuest(page, "Pay rent");
    const open = page.getByRole("region", { name: "Open quests" });
    const done = page.getByRole("region", { name: "Completed" });

    await page.getByRole("button", { name: "Complete quest: Pay rent" }).click();
    await expect(done.getByRole("link", { name: "Pay rent" })).toBeVisible();
    await expect(open.getByRole("link", { name: "Pay rent" })).toHaveCount(0);

    await page.getByRole("button", { name: "Undo quest: Pay rent" }).click();
    await expect(open.getByRole("link", { name: "Pay rent" })).toBeVisible();
    await expect(done.getByRole("link", { name: "Pay rent" })).toHaveCount(0);
  });

  test("edits a quest and returns to the list with the change", async ({ page }) => {
    await page.goto("/");
    await addQuest(page, "Book dentist", { category: "health" });

    await page.getByRole("link", { name: "Book dentist" }).click();
    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
    await expect(page.getByLabel("Quest name")).toHaveValue("Book dentist");
    await expect(page.getByLabel("Category")).toHaveValue("health");

    await page.getByLabel("Quest name").fill("Book the dentist");
    await page.getByLabel("Priority").selectOption("high");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Book the dentist" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Book dentist", exact: true })).toHaveCount(0);
    await expect(page.getByText("Health · High priority")).toBeVisible();
  });

  test("lists open quests soonest first, with undated ones last", async ({ page }) => {
    await page.goto("/");
    await addQuest(page, "No date");
    await addQuest(page, "Later", { dueDate: "2026-12-31" });
    await addQuest(page, "Sooner", { dueDate: "2026-11-01" });

    const titles = await page
      .getByRole("region", { name: "Open quests" })
      .getByRole("link")
      .allTextContents();
    expect(titles).toEqual(["Sooner", "Later", "No date"]);
  });
});

test.describe("mistakes and hostile input", () => {
  test("keeps the chosen category when a quest is rejected for having no name", async ({
    page,
  }) => {
    // Regression test for a real bug: the dropdown used to snap back to "Work".
    await page.goto("/");
    await page.getByLabel("Category").selectOption("home");
    await page.getByLabel("Priority").selectOption("low");
    await page.getByLabel("Notes (optional)").fill("Remember me");
    await page.getByRole("button", { name: "Add quest" }).click();

    await expect(page.getByText("Give the quest a name.")).toBeVisible();
    await expect(page.getByLabel("Category")).toHaveValue("home");
    await expect(page.getByLabel("Priority")).toHaveValue("low");
    await expect(page.getByLabel("Notes (optional)")).toHaveValue("Remember me");
    await expect(page.getByLabel("Quest name")).toHaveAttribute("aria-invalid", "true");
  });

  test("shows markup in a quest name as plain text", async ({ page }) => {
    await page.goto("/");
    await addQuest(page, '<img src=x onerror="window.pwned=1"> <b>bold</b>');
    await expect(page.getByText('<img src=x onerror="window.pwned=1"> <b>bold</b>')).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { pwned?: number }).pwned),
    ).toBeUndefined();
    await expect(page.locator("main img")).toHaveCount(0);
  });

  test("tells the user plainly when quests are created too quickly", async ({ page, user }) => {
    // Fill the user's allowance of 60 a minute through the API, then use the form.
    const api = await clientFor(user);
    const { error } = await api
      .from("tasks")
      .insert(Array.from({ length: 60 }, (_, i) => ({ title: `Bulk ${i}`, category: "work" })));
    expect(error).toBeNull();

    await page.goto("/");
    await page.getByLabel("Quest name").fill("One too many");
    await page.getByRole("button", { name: "Add quest" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("very quickly");
    await expect(page.getByLabel("Quest name")).toHaveValue("One too many"); // nothing typed is lost
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

    await page.goto("/");
    await addQuest(page, "Check the console");
    await page.getByRole("button", { name: "Complete quest: Check the console" }).click();
    await expect(page.getByRole("region", { name: "Completed" }).getByRole("link")).toBeVisible();
    await page.getByRole("link", { name: "Check the console" }).click();
    await expect(page.getByRole("heading", { name: "Edit quest" })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("has no detectable accessibility violations with real content on screen (WCAG 2.1 AA)", async ({
    page,
  }) => {
    await page.goto("/");
    await addQuest(page, "Open quest", {
      notes: "details",
      priority: "high",
      dueDate: "2026-12-24",
    });
    await addQuest(page, "Finished quest");
    await page.getByRole("button", { name: "Complete quest: Finished quest" }).click();
    await expect(page.getByRole("region", { name: "Completed" }).getByRole("link")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);

    await page.getByRole("link", { name: "Open quest" }).click();
    const editResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(editResults.violations).toEqual([]);
  });

  test("can be used with the keyboard alone", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Quest name").focus();
    await page.keyboard.type("Keyboard quest");
    await page.keyboard.press("Enter"); // submits the form from inside the name field
    await expect(page.getByRole("link", { name: "Keyboard quest" })).toBeVisible();
  });
});
