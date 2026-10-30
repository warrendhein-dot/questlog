import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireUser,
  getTimeZone,
  redirect,
  revalidatePath,
  insert,
  update,
  selectAfterUpdate,
  eq,
  rpc,
  getCompletionContext,
  deleteRows,
  deleteEq,
  deleteNot,
} = vi.hoisted(() => {
  const selectAfterUpdate = vi.fn();
  const eq = vi.fn();
  return {
    deleteRows: vi.fn(),
    deleteEq: vi.fn(),
    deleteNot: vi.fn(),
    requireUser: vi.fn(),
    getTimeZone: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    }),
    revalidatePath: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    selectAfterUpdate,
    eq,
    rpc: vi.fn(),
    getCompletionContext: vi.fn(),
  };
});

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/auth/profile", () => ({ getTimeZone }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: () => ({ insert, update, delete: deleteRows }),
    rpc,
  }),
}));
vi.mock("@/lib/tasks/queries", () => ({ getCompletionContext }));

import {
  createTask,
  deleteTaskForever,
  emptyTrash,
  restoreTask,
  setTaskCompleted,
  setTaskPinned,
  trashTask,
  updateTask,
} from "./actions";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const IDLE = { status: "idle" } as const;

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) for (const item of value) data.append(key, item);
    else data.set(key, value);
  }
  return data;
}

const good = {
  title: "Slay the inbox",
  notes: "",
  category: "work",
  priority: "high",
  dueDate: "2026-12-24",
};

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "user-1" });
  getTimeZone.mockResolvedValue("UTC");
  insert.mockResolvedValue({ error: null });
  // update(...).eq(...).select(...) for updateTask, update(...).eq(...) for setTaskCompleted
  eq.mockReturnValue({
    select: selectAfterUpdate,
    then: (r: (v: unknown) => void) => r({ error: null }),
  });
  update.mockReturnValue({ eq });
  selectAfterUpdate.mockResolvedValue({ data: [{ id: ID }], error: null });
  rpc.mockResolvedValue({ data: null, error: null });
  deleteEq.mockResolvedValue({ error: null });
  deleteNot.mockResolvedValue({ error: null });
  deleteRows.mockReturnValue({ eq: deleteEq, not: deleteNot });
  getCompletionContext.mockResolvedValue({
    dueDate: null,
    completedAt: null,
    anchor: null,
    recurrence: null,
  });
});

describe("createTask", () => {
  it("saves a valid quest without sending an owner, and refreshes the list", async () => {
    expect(await createTask(IDLE, form(good))).toEqual({ status: "saved" });
    expect(insert).toHaveBeenCalledWith({
      title: "Slay the inbox",
      notes: "",
      category: "work",
      priority: "high",
      due_date: "2026-12-24",
      recur_frequency: null,
      recur_interval: null,
      recur_weekdays: null,
    });
    expect(insert.mock.calls[0]![0]).not.toHaveProperty("user_id");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("stores no date as null", async () => {
    await createTask(IDLE, form({ ...good, dueDate: "" }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ due_date: null }));
  });

  it("requires sign-in before doing anything", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(createTask(IDLE, form(good))).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects invalid input, shows what was typed, and never reaches the database", async () => {
    const result = await createTask(IDLE, form({ ...good, title: "", notes: "Keep me" }));
    expect(result).toMatchObject({
      status: "error",
      errors: { title: "Give the quest a name." },
      values: { notes: "Keep me" },
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("ignores an owner or completion time smuggled into the form", async () => {
    await createTask(IDLE, form({ ...good, user_id: "someone-else", completed_at: "2020-01-01" }));
    const sent = insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty("user_id");
    expect(sent).not.toHaveProperty("completed_at");
  });

  it("explains the rate limit in plain words", async () => {
    insert.mockResolvedValue({ error: { message: "task_rate_limit" } });
    const result = await createTask(IDLE, form(good));
    expect(result).toMatchObject({
      status: "error",
      message: expect.stringMatching(/very quickly/),
    });
  });

  it("hides database error details", async () => {
    insert.mockResolvedValue({
      error: { message: 'new row violates row-level security policy for table "tasks"' },
    });
    const result = await createTask(IDLE, form(good));
    expect(result).toMatchObject({
      status: "error",
      message: "Could not save the quest. Please try again.",
    });
    expect(JSON.stringify(result)).not.toMatch(/row-level|policy|"tasks"/);
  });
});

describe("updateTask", () => {
  it("updates the quest by id and returns to the list", async () => {
    await expect(updateTask(ID, IDLE, form(good))).rejects.toThrow("NEXT_REDIRECT:/");
    expect(update).toHaveBeenCalledWith({
      title: "Slay the inbox",
      notes: "",
      category: "work",
      priority: "high",
      due_date: "2026-12-24",
      recur_frequency: null,
      recur_interval: null,
      recur_weekdays: null,
    });
    expect(eq).toHaveBeenCalledWith("id", ID);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("requires sign-in first", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(updateTask(ID, IDLE, form(good))).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a UUID", async () => {
    const result = await updateTask("1; drop table tasks", IDLE, form(good));
    expect(result).toMatchObject({ status: "error", message: "That quest could not be found." });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects invalid input without touching the database", async () => {
    const result = await updateTask(ID, IDLE, form({ ...good, category: "combat" }));
    expect(result).toMatchObject({ status: "error", errors: { category: "Pick a category." } });
    expect(update).not.toHaveBeenCalled();
  });

  it("says not found when no row changed (someone else's quest, or already gone)", async () => {
    selectAfterUpdate.mockResolvedValue({ data: [], error: null });
    const result = await updateTask(ID, IDLE, form(good));
    expect(result).toMatchObject({ status: "error", message: "That quest could not be found." });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("treats a missing result as not found", async () => {
    selectAfterUpdate.mockResolvedValue({ data: null, error: null });
    expect(await updateTask(ID, IDLE, form(good))).toMatchObject({ status: "error" });
  });

  it("hides database error details", async () => {
    selectAfterUpdate.mockResolvedValue({ data: null, error: { message: "internal detail" } });
    const result = await updateTask(ID, IDLE, form(good));
    expect(JSON.stringify(result)).not.toContain("internal detail");
    expect(result).toMatchObject({
      status: "error",
      values: { title: "Slay the inbox", dueDate: "2026-12-24" },
    });
  });

  it("keeps an empty date empty when showing an error again", async () => {
    selectAfterUpdate.mockResolvedValue({ data: null, error: { message: "x" } });
    const result = await updateTask(ID, IDLE, form({ ...good, dueDate: "" }));
    expect(result).toMatchObject({ values: { dueDate: "" } });
  });
});

describe("repeating quests: saving the rule", () => {
  const weekly = { ...good, repeat: "weekly", interval: "2", weekdays: ["4", "1"] };

  it("sends the rule with a new quest", async () => {
    await createTask(IDLE, form(weekly));
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        recur_frequency: "weekly",
        recur_interval: 2,
        recur_weekdays: [1, 4],
      }),
    );
  });

  it("sends no weekdays for a rule without any", async () => {
    await createTask(IDLE, form({ ...good, repeat: "monthly", interval: "1" }));
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        recur_frequency: "monthly",
        recur_interval: 1,
        recur_weekdays: null,
      }),
    );
  });

  it("never sends the series anchor or the link to an earlier quest", async () => {
    await createTask(
      IDLE,
      form({ ...weekly, recurrence_anchor: "2000-01-01", recurred_from: ID, completed_at: "x" }),
    );
    const sent = insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty("recurrence_anchor");
    expect(sent).not.toHaveProperty("recurred_from");
    expect(sent).not.toHaveProperty("completed_at");
  });

  it("refuses a repeating quest with no due date, and never reaches the database", async () => {
    const result = await createTask(IDLE, form({ ...weekly, dueDate: "" }));
    expect(result).toMatchObject({
      status: "error",
      errors: { dueDate: expect.stringMatching(/needs a date/) },
      values: { repeat: "weekly", interval: "2", weekdays: ["4", "1"] },
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("shows the rule again when the database refuses the quest", async () => {
    insert.mockResolvedValue({ error: { message: "boom" } });
    const result = await createTask(IDLE, form(weekly));
    expect(result).toMatchObject({
      status: "error",
      values: { repeat: "weekly", interval: "2", weekdays: ["1", "4"] },
    });
  });

  it("saves a changed rule when editing, and clears it when the quest stops repeating", async () => {
    await expect(updateTask(ID, IDLE, form(weekly))).rejects.toThrow("NEXT_REDIRECT:/");
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ recur_frequency: "weekly", recur_interval: 2 }),
    );
    await expect(updateTask(ID, IDLE, form({ ...good, repeat: "none" }))).rejects.toThrow(
      "NEXT_REDIRECT:/",
    );
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recur_frequency: null,
        recur_interval: null,
        recur_weekdays: null,
      }),
    );
  });
});

describe("setTaskCompleted", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const repeating = (over: Record<string, unknown> = {}) => ({
    dueDate: "2026-10-28",
    completedAt: null,
    anchor: "2026-10-28",
    recurrence: { frequency: "weekly", interval: 1, weekdays: [] },
    ...over,
  });

  it("completes an ordinary quest through the database function, with no next date", async () => {
    await setTaskCompleted(form({ id: ID, completed: "true" }));
    expect(rpc).toHaveBeenCalledWith("complete_task", { p_task_id: ID, p_next_due: null });
    expect(update).not.toHaveBeenCalled(); // the browser's clock and the API are not used for the time
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("works out the next date for a repeating quest and passes it along", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-28T12:00:00Z"), toFake: ["Date"] });
    getCompletionContext.mockResolvedValue(repeating());
    await setTaskCompleted(form({ id: ID, completed: "true" }));
    expect(rpc).toHaveBeenCalledWith("complete_task", { p_task_id: ID, p_next_due: "2026-11-04" });
  });

  it("skips ahead when a repeating quest is completed late", async () => {
    // Due Wed 28 Oct, ticked off Fri 6 Nov: the next Wednesday is 11 Nov, not 4 Nov.
    vi.useFakeTimers({ now: new Date("2026-11-06T12:00:00Z"), toFake: ["Date"] });
    getCompletionContext.mockResolvedValue(repeating());
    await setTaskCompleted(form({ id: ID, completed: "true" }));
    expect(rpc).toHaveBeenCalledWith("complete_task", { p_task_id: ID, p_next_due: "2026-11-11" });
  });

  it("keeps the schedule when a repeating quest is completed early", async () => {
    // Due Wed 28 Oct, ticked off Mon 26 Oct: still the 4th of November next, not the 28th again.
    vi.useFakeTimers({ now: new Date("2026-10-26T12:00:00Z"), toFake: ["Date"] });
    getCompletionContext.mockResolvedValue(repeating());
    await setTaskCompleted(form({ id: ID, completed: "true" }));
    expect(rpc).toHaveBeenCalledWith("complete_task", { p_task_id: ID, p_next_due: "2026-11-04" });
  });

  it("uses the user's own date, from their saved time zone", async () => {
    // 23:30 UTC on the 28th is already the 29th in Johannesburg, so a daily quest due the 28th
    // finished "today" there is next due on the 30th.
    vi.useFakeTimers({ now: new Date("2026-10-28T23:30:00Z"), toFake: ["Date"] });
    getTimeZone.mockResolvedValue("Africa/Johannesburg");
    getCompletionContext.mockResolvedValue(
      repeating({ recurrence: { frequency: "daily", interval: 1, weekdays: [] } }),
    );
    await setTaskCompleted(form({ id: ID, completed: "true" }));
    expect(rpc).toHaveBeenCalledWith("complete_task", { p_task_id: ID, p_next_due: "2026-10-30" });
  });

  it("passes no next date for a series that has run past the end of the calendar", async () => {
    vi.useFakeTimers({ now: new Date("2100-12-31T12:00:00Z"), toFake: ["Date"] });
    getCompletionContext.mockResolvedValue(
      repeating({
        dueDate: "2100-12-31",
        anchor: "2100-12-31",
        recurrence: { frequency: "daily", interval: 1, weekdays: [] },
      }),
    );
    await setTaskCompleted(form({ id: ID, completed: "true" }));
    expect(rpc).toHaveBeenCalledWith("complete_task", { p_task_id: ID, p_next_due: null });
  });

  it("passes no next date when the quest is already completed (a second click)", async () => {
    getCompletionContext.mockResolvedValue(repeating({ completedAt: "2026-10-28T08:00:00Z" }));
    await setTaskCompleted(form({ id: ID, completed: "true" }));
    expect(rpc).toHaveBeenCalledWith("complete_task", { p_task_id: ID, p_next_due: null });
  });

  it("passes no next date for a quest that is not the user's or does not exist", async () => {
    getCompletionContext.mockResolvedValue(null);
    await setTaskCompleted(form({ id: ID, completed: "true" }));
    expect(rpc).toHaveBeenCalledWith("complete_task", { p_task_id: ID, p_next_due: null });
  });

  it("re-opens a quest through the database function", async () => {
    await setTaskCompleted(form({ id: ID, completed: "false" }));
    expect(rpc).toHaveBeenCalledWith("reopen_task", { p_task_id: ID });
    expect(getCompletionContext).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("requires sign-in first", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(setTaskCompleted(form({ id: ID, completed: "true" }))).rejects.toThrow(
      "NEXT_REDIRECT:/login",
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["a bad id", { id: "nope", completed: "true" }],
    ["no id", { completed: "true" }],
    ["a bad completed value", { id: ID, completed: "yes" }],
    ["no completed value", { id: ID }],
  ])("ignores %s", async (_label, fields) => {
    await setTaskCompleted(form(fields));
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["true", "false"])(
    "throws a generic error when the database refuses (completed=%s)",
    async (completed) => {
      rpc.mockResolvedValue({ data: null, error: { message: "secret" } });
      const attempt = setTaskCompleted(form({ id: ID, completed }));
      await expect(attempt).rejects.toThrow("Could not update the quest");
      await expect(attempt).rejects.not.toThrow(/secret/);
    },
  );
});
describe("setTaskPinned", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pins a quest to today in the user's own time zone", async () => {
    // 23:30 UTC on the 27th is already the 28th in Johannesburg.
    vi.useFakeTimers({ now: new Date("2026-10-27T23:30:00Z"), toFake: ["Date"] });
    getTimeZone.mockResolvedValue("Africa/Johannesburg");
    await setTaskPinned(form({ id: ID, pinned: "true" }));
    expect(update).toHaveBeenCalledWith({ pinned_for: "2026-10-28" });
    expect(eq).toHaveBeenCalledWith("id", ID);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("unpins a quest", async () => {
    await setTaskPinned(form({ id: ID, pinned: "false" }));
    expect(update).toHaveBeenCalledWith({ pinned_for: null });
    expect(getTimeZone).not.toHaveBeenCalled();
  });

  it("never lets the browser choose the date", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-28T10:00:00Z"), toFake: ["Date"] });
    await setTaskPinned(form({ id: ID, pinned: "true", pinned_for: "2099-01-01" }));
    expect(update).toHaveBeenCalledWith({ pinned_for: "2026-10-28" });
  });

  it("requires sign-in first", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(setTaskPinned(form({ id: ID, pinned: "true" }))).rejects.toThrow(
      "NEXT_REDIRECT:/login",
    );
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ["a bad id", { id: "nope", pinned: "true" }],
    ["no id", { pinned: "true" }],
    ["a bad pinned value", { id: ID, pinned: "yes" }],
    ["no pinned value", { id: ID }],
  ])("ignores %s", async (_label, fields) => {
    await setTaskPinned(form(fields));
    expect(update).not.toHaveBeenCalled();
  });

  it("throws a generic error when the database refuses", async () => {
    eq.mockReturnValue({ then: (r: (v: unknown) => void) => r({ error: { message: "secret" } }) });
    const attempt = setTaskPinned(form({ id: ID, pinned: "false" }));
    await expect(attempt).rejects.toThrow("Could not update the quest");
    await expect(attempt).rejects.not.toThrow(/secret/);
  });
});

describe("trashTask", () => {
  it("moves a quest to the Trash through the database function, and refreshes the lists", async () => {
    await trashTask(form({ id: ID }));
    expect(rpc).toHaveBeenCalledWith("trash_task", { p_task_id: ID });
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/trash");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("goes home afterwards when the button was on the edit page", async () => {
    await expect(trashTask(form({ id: ID, from: "edit" }))).rejects.toThrow("NEXT_REDIRECT:/");
    expect(rpc).toHaveBeenCalledWith("trash_task", { p_task_id: ID });
  });

  it("never lets the form choose where to go", async () => {
    await trashTask(form({ id: ID, from: "https://evil.example", next: "https://evil.example" }));
    expect(redirect).not.toHaveBeenCalled();
  });

  it("never writes the delete time itself", async () => {
    await trashTask(form({ id: ID, deleted_at: "2000-01-01" }));
    expect(update).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("trash_task", { p_task_id: ID });
  });

  it("requires sign-in first", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(trashTask(form({ id: ID }))).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["a bad id", { id: "nope" }],
    ["no id", {}],
  ])("ignores %s", async (_label, fields) => {
    await trashTask(form(fields));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("throws a generic error when the database refuses", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "secret" } });
    const attempt = trashTask(form({ id: ID }));
    await expect(attempt).rejects.toThrow("Could not delete the quest");
    await expect(attempt).rejects.not.toThrow(/secret/);
  });
});

describe("restoreTask", () => {
  it("takes a quest out of the Trash through the database function", async () => {
    await restoreTask(form({ id: ID }));
    expect(rpc).toHaveBeenCalledWith("restore_task", { p_task_id: ID });
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/trash");
  });

  it("requires sign-in first", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(restoreTask(form({ id: ID }))).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["a bad id", { id: "nope" }],
    ["no id", {}],
  ])("ignores %s", async (_label, fields) => {
    await restoreTask(form(fields));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("throws a generic error when the database refuses", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "secret" } });
    const attempt = restoreTask(form({ id: ID }));
    await expect(attempt).rejects.toThrow("Could not restore the quest");
    await expect(attempt).rejects.not.toThrow(/secret/);
  });
});

describe("deleteTaskForever", () => {
  it("deletes the one quest with that id, and refreshes the lists", async () => {
    await deleteTaskForever(form({ id: ID }));
    expect(deleteRows).toHaveBeenCalledTimes(1);
    expect(deleteEq).toHaveBeenCalledWith("id", ID);
    expect(deleteNot).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/trash");
  });

  it("requires sign-in first", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(deleteTaskForever(form({ id: ID }))).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(deleteRows).not.toHaveBeenCalled();
  });

  it.each([
    ["a bad id", { id: "nope" }],
    ["no id", {}],
    ["a list of ids", { id: `${ID},${ID}` }],
  ])("ignores %s, so nothing is ever deleted without a single valid id", async (_label, fields) => {
    await deleteTaskForever(form(fields));
    expect(deleteRows).not.toHaveBeenCalled();
  });

  it("throws a generic error when the database refuses", async () => {
    deleteEq.mockResolvedValue({ error: { message: "secret" } });
    const attempt = deleteTaskForever(form({ id: ID }));
    await expect(attempt).rejects.toThrow("Could not delete the quest");
    await expect(attempt).rejects.not.toThrow(/secret/);
  });
});

describe("emptyTrash", () => {
  it("deletes only what is in the Trash, and refreshes the lists", async () => {
    await emptyTrash();
    expect(deleteRows).toHaveBeenCalledTimes(1);
    expect(deleteNot).toHaveBeenCalledWith("deleted_at", "is", null);
    expect(deleteEq).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/trash");
  });

  it("requires sign-in first", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(emptyTrash()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(deleteRows).not.toHaveBeenCalled();
  });

  it("throws a generic error when the database refuses", async () => {
    deleteNot.mockResolvedValue({ error: { message: "secret" } });
    const attempt = emptyTrash();
    await expect(attempt).rejects.toThrow("Could not empty the Trash");
    await expect(attempt).rejects.not.toThrow(/secret/);
  });
});
