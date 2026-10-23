import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home page shows the app title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Questlog");
  await expect(page.getByRole("heading", { level: 1, name: "Questlog" })).toBeVisible();
});

test("home page logs no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});

test("responses carry the security headers", async ({ request }) => {
  const response = await request.get("/");
  const headers = response.headers();

  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["strict-transport-security"]).toContain("max-age=");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  // The framework should not advertise itself.
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("home page has no detectable accessibility violations (WCAG 2.1 AA)", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
