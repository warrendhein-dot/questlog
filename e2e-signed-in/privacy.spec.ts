import { addQuest, expect, test } from "./support/fixtures";
import { signIn } from "./support/session";
import { clientFor, createTestUser } from "./support/users";

// Two real users, two real browsers, one database. This is the whole privacy promise tested from
// the outside: the browser, the app, the login service and the database working together.

test.describe("one user cannot reach another's quests", () => {
  test("through the pages, the edit URL, and the API", async ({ page, user, browser, baseURL }) => {
    // Alice (the signed-in `page`) creates a quest and we note its id.
    await page.goto("/?view=all");
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
    await bobPage.goto("/?view=all");
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

  test("nor reach, change, or add to her steps", async ({ page, user, browser, baseURL }) => {
    // Alice creates a quest with one step, through her own session.
    await page.goto("/?view=all");
    await addQuest(page, "Alice's private quest");
    const href = await page
      .getByRole("link", { name: "Alice's private quest" })
      .getAttribute("href");
    const aliceTaskId = href!.split("/").pop()!;
    const aliceApi = await clientFor(user);
    const created = await aliceApi
      .from("subtasks")
      .insert({ task_id: aliceTaskId, title: "Alice's private step" })
      .select("id");
    expect(created.error).toBeNull();
    const aliceStepId = created.data![0]!.id as string;

    const bob = await createTestUser();
    const bobApi = await clientFor(bob);

    // Nothing to read, by listing or by id.
    expect((await bobApi.from("subtasks").select("id")).data).toEqual([]);
    expect((await bobApi.from("subtasks").select("id").eq("id", aliceStepId)).data).toEqual([]);

    // Nothing to change or remove: the request succeeds but touches no rows.
    const update = await bobApi
      .from("subtasks")
      .update({ title: "Hacked" })
      .eq("id", aliceStepId)
      .select();
    expect(update.data).toEqual([]);
    const removal = await bobApi.from("subtasks").delete().eq("id", aliceStepId).select();
    expect(removal.data).toEqual([]);

    // He cannot hang a step on her quest, nor pose as her.
    const planted = await bobApi
      .from("subtasks")
      .insert({ task_id: aliceTaskId, title: "Planted" });
    expect(planted.error).not.toBeNull();
    const forged = await bobApi
      .from("subtasks")
      .insert({ task_id: aliceTaskId, title: "Forged", user_id: user.id });
    expect(forged.error).not.toBeNull();

    // He cannot reach her steps through the page either, and her list shows no sign of him.
    const bobContext = await browser.newContext({ baseURL });
    await signIn(bobContext, baseURL!, bob);
    const bobPage = await bobContext.newPage();
    const response = await bobPage.goto(`/tasks/${aliceTaskId}`);
    expect(response?.status()).toBe(404);
    await expect(bobPage.getByText("Alice's private step")).toHaveCount(0);
    await bobContext.close();

    const aliceRows = await aliceApi.from("subtasks").select("title");
    expect(aliceRows.data).toEqual([{ title: "Alice's private step" }]);
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
    await bobPage.goto("/?view=all");
    await addQuest(bobPage, "Bob's first quest");

    await page.goto("/?view=all");
    await page.getByLabel("Quest name").fill("Alice's extra");
    await page.getByRole("button", { name: "Add quest" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("very quickly");

    await bobContext.close();
  });
});
