import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// These tests run against the real production build with placeholder Supabase settings
// (see playwright.config.ts), so they need no accounts and never reach a real Supabase project.

test.describe("signed-out visitor", () => {
  test("is sent from the home page to the login page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page).toHaveTitle("Questlog");
    await expect(page.getByRole("heading", { level: 1, name: "Questlog" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeEnabled();
  });

  test("cannot open any other page either", async ({ page }) => {
    await page.goto("/tasks?next=https://evil.example");
    await expect(page).toHaveURL(/\/login$/); // sent to the login page, with the query string dropped
  });

  test("cannot open a quest's edit page, whether the id is real or made up", async ({ page }) => {
    for (const id of ["123e4567-e89b-42d3-a456-426614174000", "not-a-uuid", "%2e%2e%2fsecret"]) {
      await page.goto(`/tasks/${id}`);
      await expect(page).toHaveURL(/\/login$/);
    }
  });

  test("gets no content from a path-traversal attempt, and the server keeps working", async ({
    request,
  }) => {
    // Next.js refuses this particular form by closing the connection without a reply. Either a
    // refusal status or a closed connection is acceptable; page content never is.
    const outcome = await request
      .get("/tasks/..%2F..%2Fetc%2Fpasswd", { maxRedirects: 0, failOnStatusCode: false })
      .then(
        (response) => response.status(),
        () => "connection closed",
      );
    expect([307, 400, 404, "connection closed"]).toContain(outcome);
    expect((await request.get("/login")).status()).toBe(200);
  });

  test("sees a clear message when sign-in did not complete", async ({ page }) => {
    await page.goto("/auth/callback?error=access_denied");
    await expect(page).toHaveURL(/\/login\?error=signin_failed$/);
    // Scoped to <main>: Next.js adds its own invisible role="alert" region for screen readers.
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "isn't allowed to use Questlog",
    );
  });

  test("is never shown text taken from the address bar", async ({ page }) => {
    await page.goto("/login?error=<b>hacked</b>");
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("hacked")).toHaveCount(0);
  });

  test("starts a Google sign-in through Supabase using the secure PKCE flow", async ({ page }) => {
    // Stand in for Supabase so no real network call is made.
    await page.route("https://placeholder.supabase.co/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<h1>stub</h1>" }),
    );
    await page.goto("/login");
    const appOrigin = new URL(page.url()).origin; // read before the browser navigates away
    const authorize = page.waitForRequest(/placeholder\.supabase\.co\/auth\/v1\/authorize/);
    await page.getByRole("button", { name: "Sign in with Google" }).click();

    const url = new URL((await authorize).url());
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("redirect_to")).toBe(`${appOrigin}/auth/callback`);
    expect(url.searchParams.get("code_challenge")).toBeTruthy(); // PKCE: the secret never travels
    expect(url.searchParams.get("code_challenge_method")).toBe("s256");
  });
});

test.describe("login page quality", () => {
  test("logs no console errors, which also means no Content-Security-Policy violations", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });

  test("has no detectable accessibility violations (WCAG 2.1 AA)", async ({ page }) => {
    await page.goto("/login");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("is fully keyboard operable", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard focus order is checked on desktop");
    await page.goto("/login");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeFocused();
  });
});

test.describe("security headers", () => {
  test("every response carries the fixed headers", async ({ request }) => {
    const headers = (await request.get("/login")).headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("the Content-Security-Policy is strict and uses a fresh nonce each time", async ({
    request,
  }) => {
    const first = (await request.get("/login")).headers()["content-security-policy"]!;
    const second = (await request.get("/login")).headers()["content-security-policy"]!;

    expect(first).toContain("frame-ancestors 'none'");
    expect(first).toContain("object-src 'none'");
    expect(first).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(first).not.toContain("'unsafe-inline'");
    expect(first).not.toContain("'unsafe-eval'");
    expect(first).toContain("connect-src 'self' https://placeholder.supabase.co");

    const nonce = (policy: string) => policy.match(/nonce-([^']+)/)![1];
    expect(nonce(first)).not.toBe(nonce(second));
  });

  test("the policy also protects redirects", async ({ request }) => {
    const response = await request.get("/", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  test("every script on the page carries the nonce, so the browser will run it", async ({
    page,
  }) => {
    await page.goto("/login");
    const unmarked = await page.evaluate(
      () => [...document.scripts].filter((script) => !script.nonce).length,
    );
    expect(unmarked).toBe(0);
  });
});
