import { addQuest, expect, test } from "./support/fixtures";
import { signIn } from "./support/session";
import { clientFor, createTestUser } from "./support/users";

// Two real users, two real browsers, one database. This is the whole privacy promise tested from
// the outside: the browser, the app, the login service and the database working together.

test.describe("one user cannot reach another's quests", () => {
  test("through the pages, the edit URL, and the API", async ({ page, user, browser, baseURL }) => {
    // Alice (the signed-in `page`) creates a quest and we note its id.
    await page.goto("/");
    await addQuest(page, "Alice's private quest");
    const href = await page
      .getByRole("link", { name: "Alice's private quest" })
      .getAttribute("href");
    const aliceTaskId = href!.split("/").pop()!;

    // Bob gets his own browser, signed in as a different user.
    const bob = await createTestUser();
    const bobContext = await browser.newContext({ baseURL });
    await signIn(bobContext, baseURL!, bob);
    const bobPage = await bobContext.newPage();

    // 1. His quest list does not show hers.
    await bobPage.goto("/");
    await expect(bobPage.getByText("Signed in as " + bob.email)).toBeVisible();
    await expect(bobPage.getByText("Alice's private quest")).toHaveCount(0);
    await expect(bobPage.getByText("No open quests. Add your first one above.")).toBeVisible();

    // 2. Opening her edit page by its address looks exactly like a page that does not exist.
    const response = await bobPage.goto(`/tasks/${aliceTaskId}`);
    expect(response?.status()).toBe(404);
    await expect(bobPage.getByText("Alice's private quest")).toHaveCount(0);

    // 3. Straight to the database API with his own valid session: nothing to read, nothing to change.
    const bobApi = await clientFor(bob);
    const read = await bobApi.from("tasks").select("id");
    expect(read.data).toEqual([]);
    const readById = await bobApi.from("tasks").select("id").eq("id", aliceTaskId);
    expect(readById.data).toEqual([]);

    const update = await bobApi
      .from("tasks")
      .update({ title: "Hacked" })
      .eq("id", aliceTaskId)
      .select();
    expect(update.data).toEqual([]);

    const forged = await bobApi
      .from("tasks")
      .insert({ title: "Planted", category: "work", user_id: user.id });
    expect(forged.error).not.toBeNull(); // the owner can never be chosen by the caller

    // Alice's quest is untouched, and nothing was planted in her list.
    const aliceApi = await clientFor(user);
    const aliceRows = await aliceApi.from("tasks").select("title");
    expect(aliceRows.data).toEqual([{ title: "Alice's private quest" }]);

    await bobContext.close();
  });

  test("each user's quests are counted separately for the creation limit", async ({
    page,
    user,
    browser,
    baseURL,
  }) => {
    const alice = await clientFor(user);
    const filled = await alice
      .from("tasks")
      .insert(Array.from({ length: 60 }, (_, i) => ({ title: `Bulk ${i}`, category: "work" })));
    expect(filled.error).toBeNull();

    // Alice is now at her limit, but Bob can still add a quest.
    const bob = await createTestUser();
    const bobContext = await browser.newContext({ baseURL });
    await signIn(bobContext, baseURL!, bob);
    const bobPage = await bobContext.newPage();
    await bobPage.goto("/");
    await addQuest(bobPage, "Bob's first quest");

    await page.goto("/");
    await page.getByLabel("Quest name").fill("Alice's extra");
    await page.getByRole("button", { name: "Add quest" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("very quickly");

    await bobContext.close();
  });
});
