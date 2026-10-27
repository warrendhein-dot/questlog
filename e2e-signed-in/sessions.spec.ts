import { expect, test } from "./support/fixtures";
import {
  addCookies,
  sessionCookieName,
  sessionCookies,
  withDamagedSignature,
} from "./support/session";
import { loadLocalStack } from "./support/stack";

// These tests need a real login service. They check that the app trusts Supabase's answer about a
// session, never just what a cookie claims. Only `user` is requested (not `page`), so each test
// builds exactly the browser it needs.

test.describe("sessions", () => {
  test("a signed-in user visiting the login page is sent straight home", async ({
    browser,
    baseURL,
    user,
  }) => {
    const context = await browser.newContext({ baseURL });
    await addCookies(context, baseURL!, await sessionCookies(user));
    const page = await context.newPage();

    await page.goto("/login");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText(`Signed in as ${user.email}`)).toBeVisible();
    await context.close();
  });

  test("signing out returns to the login page and closes every protected page again", async ({
    browser,
    baseURL,
    user,
  }) => {
    const context = await browser.newContext({ baseURL });
    await addCookies(context, baseURL!, await sessionCookies(user));
    const page = await context.newPage();

    await page.goto("/");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await context.close();
  });

  test("a session cookie that was copied before sign-out stops working afterwards", async ({
    browser,
    baseURL,
    user,
  }) => {
    // Like a stolen cookie: the very same session cookie, replayed in another browser.
    const stolen = await sessionCookies(user);

    const real = await browser.newContext({ baseURL });
    await addCookies(real, baseURL!, stolen);
    const realPage = await real.newPage();
    await realPage.goto("/");
    await expect(realPage.getByText(`Signed in as ${user.email}`)).toBeVisible();

    const thief = await browser.newContext({ baseURL });
    await addCookies(thief, baseURL!, stolen);
    const thiefPage = await thief.newPage();
    await thiefPage.goto("/");
    await expect(thiefPage.getByText(`Signed in as ${user.email}`)).toBeVisible(); // valid so far

    await realPage.getByRole("button", { name: "Sign out" }).click();
    await expect(realPage).toHaveURL(/\/login$/);

    // The copy is now dead: the app asks Supabase, which has ended that session.
    await thiefPage.goto("/");
    await expect(thiefPage).toHaveURL(/\/login$/);

    await real.close();
    await thief.close();
  });

  test("a session cookie with a damaged signature is not trusted", async ({
    browser,
    baseURL,
    user,
  }) => {
    const context = await browser.newContext({ baseURL });
    await addCookies(context, baseURL!, withDamagedSignature(await sessionCookies(user)));
    const page = await context.newPage();

    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await context.close();
  });

  test("a made-up session cookie is treated as no session at all", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    const name = sessionCookieName(loadLocalStack().url);
    await addCookies(context, baseURL!, [{ name, value: "base64-bm90LWEtcmVhbC1zZXNzaW9u" }]);
    const page = await context.newPage();

    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await context.close();
  });
});
