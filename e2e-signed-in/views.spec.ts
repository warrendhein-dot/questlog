import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { todayIn, weekBounds } from "../src/lib/tasks/views";
import { addQuest, expect, test } from "./support/fixtures";
import { signIn } from "./support/session";
import { clientFor, createTestUser } from "./support/users";

// The Today and This-week views. The browser's time zone is pinned to UTC in the config, so "today"
// here is the UTC date. Dates are worked out once per test, from the same function the app uses.

const dayFrom = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The dates a test needs, relative to today. */
function dates() {
  const today = todayIn("UTC", new Date());
  const { end } = weekBounds(today);
  return { today, yesterday: dayFrom(today, -1), sunday: end, nextMonday: dayFrom(end, 1) };
}

const links = (page: Page, region: string) =>
  page.getByRole("region", { name: region }).getByRole("link").allTextContents();

test.describe("choosing a view", () => {
  test("opens on Today, with the three views as links and the current one marked", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: "Today" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Quest views" });
    await expect(nav.getByRole("link")).toHaveText(["Today", "This week", "All quests"]);
    await expect(nav.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(/Nothing due today/)).toBeVisible();
  });

  test("switches views by clicking, each with its own address that survives a reload", async ({
    page,
  }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Quest views" });

    await nav.getByRole("link", { name: "This week" }).click();
    await expect(page).toHaveURL(/\/\?view=week$/);
    await expect(page.getByRole("heading", { level: 2, name: "This week" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "This week" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await nav.getByRole("link", { name: "All quests" }).click();
    await expect(page).toHaveURL(/\/\?view=all$/);
    await page.reload();
    await expect(page.getByRole("heading", { level: 2, name: "Open quests" })).toBeVisible();
  });

  test("falls back to Today for a view that does not exist, and never echoes it", async ({
    page,
  }) => {
    await page.goto("/?view=%3Cscript%3Ealert(1)%3C/script%3E");
    await expect(page.getByRole("heading", { level: 2, name: "Today" })).toBeVisible();
    await expect(page.getByText("alert(1)")).toHaveCount(0);
  });
});

test.describe("Today", () => {
  test("shows overdue quests first, then those due or pinned today, and nothing else", async ({
    page,
  }) => {
    const { today, yesterday, sunday } = dates();
    await page.goto("/?view=all");
    await addQuest(page, "Due today", { dueDate: today });
    await addQuest(page, "Late one", { dueDate: yesterday });
    await addQuest(page, "Pinned one");
    await addQuest(page, "Undated, not pinned");
    await addQuest(page, "Later this week", { dueDate: sunday === today ? "2100-01-01" : sunday });
    await page.getByRole("button", { name: "Pin to today: Pinned one" }).click();
    await expect(page.getByText("Pinned to today")).toBeVisible();

    await page.getByRole("navigation", { name: "Quest views" }).getByText("Today").click();
    const region = page.getByRole("region", { name: "Today" });
    await expect(region.getByRole("heading", { level: 3, name: "Overdue" })).toBeVisible();
    await expect(
      region.getByRole("heading", { level: 3, name: "Due or pinned for today" }),
    ).toBeVisible();

    const shown = await links(page, "Today");
    expect(shown[0]).toBe("Late one");
    expect(shown.slice(1).sort()).toEqual(["Due today", "Pinned one"]);
  });

  test("completing a quest takes it off the list and into Completed", async ({ page }) => {
    const { today } = dates();
    await page.goto("/?view=all");
    await addQuest(page, "Finish me", { dueDate: today });
    await page.getByRole("navigation", { name: "Quest views" }).getByText("Today").click();
    await page.getByRole("button", { name: "Complete quest: Finish me" }).click();
    await expect(page.getByRole("region", { name: "Today" }).getByText("Finish me")).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Completed" }).getByRole("link", { name: "Finish me" }),
    ).toBeVisible();
  });
});

test.describe("pinning", () => {
  test("pins a quest to today and unpins it again", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Maybe today");

    await page.getByRole("button", { name: "Pin to today: Maybe today" }).click();
    await expect(page.getByText("Pinned to today")).toBeVisible();
    await expect(page.getByRole("button", { name: "Unpin from today: Maybe today" })).toBeVisible();

    await page.getByRole("navigation", { name: "Quest views" }).getByText("Today").click();
    await expect(
      page.getByRole("region", { name: "Today" }).getByRole("link", { name: "Maybe today" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Unpin from today: Maybe today" }).click();
    await expect(page.getByRole("region", { name: "Today" }).getByText("Maybe today")).toHaveCount(
      0,
    );
    await expect(page.getByText(/Nothing due today/)).toBeVisible();
  });

  test("a pin lasts for its own day only", async ({ page, user }) => {
    const { yesterday } = dates();
    await page.goto("/?view=all");
    await addQuest(page, "Pinned long ago");
    const id = (await page.getByRole("link", { name: "Pinned long ago" }).getAttribute("href"))!
      .split("/")
      .pop()!;

    // Pin it for yesterday, the way yesterday's click would have.
    const api = await clientFor(user);
    const pinned = await api.from("tasks").update({ pinned_for: yesterday }).eq("id", id).select();
    expect(pinned.error).toBeNull();

    await page.getByRole("navigation", { name: "Quest views" }).getByText("Today").click();
    await expect(page.getByText("Pinned long ago")).toHaveCount(0);
    await page.getByRole("navigation", { name: "Quest views" }).getByText("All quests").click();
    await expect(page.getByRole("link", { name: "Pinned long ago" })).toBeVisible();
    await expect(page.getByText("Pinned to today")).toHaveCount(0);
  });

  test("one user cannot pin, or unpin, another user's quest", async ({ page, user }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Alice's quest");
    const id = (await page.getByRole("link", { name: "Alice's quest" }).getAttribute("href"))!
      .split("/")
      .pop()!;

    const bob = await createTestUser();
    const bobApi = await clientFor(bob);
    const attempt = await bobApi
      .from("tasks")
      .update({ pinned_for: dates().today })
      .eq("id", id)
      .select();
    expect(attempt.data).toEqual([]);

    const aliceApi = await clientFor(user);
    const rows = await aliceApi.from("tasks").select("pinned_for").eq("id", id);
    expect(rows.data).toEqual([{ pinned_for: null }]);
  });
});

test.describe("This week", () => {
  test("shows overdue quests first, then quests due from today through Sunday", async ({
    page,
  }) => {
    const { today, yesterday, sunday, nextMonday } = dates();
    await page.goto("/?view=all");
    await addQuest(page, "Late one", { dueDate: yesterday });
    await addQuest(page, "Sunday one", { dueDate: sunday });
    await addQuest(page, "Next Monday one", { dueDate: nextMonday });
    await addQuest(page, "Undated one");
    if (today !== sunday) await addQuest(page, "Today one", { dueDate: today });

    await page.getByRole("navigation", { name: "Quest views" }).getByText("This week").click();
    const region = page.getByRole("region", { name: "This week" });
    await expect(region.getByRole("heading", { level: 3, name: "Overdue" })).toBeVisible();
    await expect(region.getByRole("heading", { level: 3, name: "Due this week" })).toBeVisible();

    const shown = await links(page, "This week");
    expect(shown[0]).toBe("Late one");
    expect(shown.slice(1)).toEqual(today === sunday ? ["Sunday one"] : ["Today one", "Sunday one"]);
    await expect(region.getByText("Next Monday one")).toHaveCount(0);
    await expect(region.getByText("Undated one")).toHaveCount(0);
  });
});

test.describe("the user's own time zone", () => {
  test("the browser's time zone is saved, and 'today' follows it", async ({
    browser,
    baseURL,
    user,
  }) => {
    // Kiritimati is UTC+14: for most of every day its date is not the UTC date.
    const zone = "Pacific/Kiritimati";
    const context = await browser.newContext({ baseURL, timezoneId: zone });
    await signIn(context, baseURL!, user);
    const page = await context.newPage();

    const there = todayIn(zone, new Date());
    await page.goto("/?view=all");
    await addQuest(page, "Due where I am", { dueDate: there });

    // The first visit saves the zone, then the page redraws with the user's own "today".
    const api = await clientFor(user);
    await expect
      .poll(async () => (await api.from("profiles").select("time_zone")).data?.[0]?.time_zone)
      .toBe(zone);

    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Today" }).getByRole("link", { name: "Due where I am" }),
    ).toBeVisible();
    await context.close();
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

    const { today, yesterday } = dates();
    await page.goto("/?view=all");
    await addQuest(page, "Due today", { dueDate: today });
    await addQuest(page, "Late one", { dueDate: yesterday });
    for (const tab of ["Today", "This week", "All quests"]) {
      await page.getByRole("navigation", { name: "Quest views" }).getByText(tab).click();
      await expect(page.getByRole("link", { name: tab, exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
    await page.getByRole("button", { name: "Pin to today: Due today" }).click();
    await expect(page.getByText("Pinned to today")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("has no detectable accessibility violations in any view (WCAG 2.1 AA)", async ({ page }) => {
    const { today, yesterday, sunday } = dates();
    await page.goto("/?view=all");
    await addQuest(page, "Due today", { dueDate: today });
    await addQuest(page, "Late one", { dueDate: yesterday });
    await addQuest(page, "Sunday one", { dueDate: sunday });
    await page.getByRole("button", { name: "Pin to today: Late one" }).click();
    await expect(page.getByText("Pinned to today")).toBeVisible();

    const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
    for (const view of ["today", "week", "all"]) {
      await page.goto(`/?view=${view}`);
      await expect(page.getByRole("navigation", { name: "Quest views" })).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
    }
  });

  test("can be used with the keyboard alone", async ({ page }) => {
    await page.goto("/?view=all");
    await addQuest(page, "Keyboard quest");
    await page.getByRole("button", { name: "Pin to today: Keyboard quest" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Pinned to today")).toBeVisible();

    await page.getByRole("link", { name: "Today", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\?view=today$/);
    await expect(page.getByRole("link", { name: "Keyboard quest" })).toBeVisible();
  });
});
