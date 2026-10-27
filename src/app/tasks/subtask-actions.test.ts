import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUser, revalidatePath, insert, update, remove, eq } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: () => ({ insert, update, delete: remove }) }),
}));

import { addSubtask, removeSubtask, setSubtaskCompleted } from "./subtask-actions";

const TASK = "123e4567-e89b-42d3-a456-426614174000";
const STEP = "223e4567-e89b-42d3-a456-426614174000";
const IDLE = { status: "idle" } as const;

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "user-1" });
  insert.mockResolvedValue({ error: null });
  // update(...).eq(...) and delete().eq(...) both end in a promise-like.
  eq.mockReturnValue({ then: (r: (v: unknown) => void) => r({ error: null }) });
  update.mockReturnValue({ eq });
  remove.mockReturnValue({ eq });
});

describe("addSubtask", () => {
  it("adds a step to the quest without sending an owner, and refreshes both pages", async () => {
    expect(await addSubtask(TASK, IDLE, form({ title: "  Book the venue " }))).toEqual({
      status: "saved",
    });
    expect(insert).toHaveBeenCalledWith({ task_id: TASK, title: "Book the venue" });
    expect(insert.mock.calls[0]![0]).not.toHaveProperty("user_id");
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks/[id]", "page");
  });

  it("requires sign-in before doing anything", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(addSubtask(TASK, IDLE, form({ title: "Step" }))).rejects.toThrow(
      "NEXT_REDIRECT:/login",
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses a quest id that is not a UUID", async () => {
    const result = await addSubtask("1; drop table tasks", IDLE, form({ title: "Step" }));
    expect(result).toEqual({ status: "error", message: "That quest could not be found." });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects an empty name, shows what was typed, and never reaches the database", async () => {
    const result = await addSubtask(TASK, IDLE, form({ title: "   " }));
    expect(result).toEqual({ status: "error", message: "Give the step a name.", value: "   " });
    expect(insert).not.toHaveBeenCalled();
  });

  it("ignores an owner or completion time smuggled into the form", async () => {
    await addSubtask(
      TASK,
      IDLE,
      form({ title: "Step", user_id: "someone-else", completed_at: "2020-01-01", task_id: "x" }),
    );
    expect(insert).toHaveBeenCalledWith({ task_id: TASK, title: "Step" });
  });

  it("says not found when the database refuses the quest (not yours, or gone)", async () => {
    insert.mockResolvedValue({ error: { code: "23503", message: "violates foreign key" } });
    expect(await addSubtask(TASK, IDLE, form({ title: "Step" }))).toEqual({
      status: "error",
      message: "That quest could not be found.",
      value: "Step",
    });
  });

  it("explains the step limit and the rate limit in plain words", async () => {
    insert.mockResolvedValue({ error: { message: "subtask_limit" } });
    expect(await addSubtask(TASK, IDLE, form({ title: "Step" }))).toMatchObject({
      message: "A quest can have at most 50 steps.",
    });
    insert.mockResolvedValue({ error: { message: "subtask_rate_limit" } });
    expect(await addSubtask(TASK, IDLE, form({ title: "Step" }))).toMatchObject({
      message: expect.stringMatching(/very quickly/),
    });
  });

  it("hides database error details, and keeps what was typed", async () => {
    insert.mockResolvedValue({
      error: { message: 'new row violates row-level security policy for table "subtasks"' },
    });
    const result = await addSubtask(TASK, IDLE, form({ title: "Step" }));
    expect(result).toEqual({
      status: "error",
      message: "Could not add the step. Please try again.",
      value: "Step",
    });
    expect(JSON.stringify(result)).not.toMatch(/row-level|policy|"subtasks"/);
  });
});

describe("setSubtaskCompleted", () => {
  it("ticks a step with a timestamp", async () => {
    await setSubtaskCompleted(form({ id: STEP, completed: "true" }));
    const sent = update.mock.calls[0]![0] as { completed_at: string };
    expect(new Date(sent.completed_at).toString()).not.toBe("Invalid Date");
    expect(eq).toHaveBeenCalledWith("id", STEP);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("un-ticks a step", async () => {
    await setSubtaskCompleted(form({ id: STEP, completed: "false" }));
    expect(update).toHaveBeenCalledWith({ completed_at: null });
  });

  it("requires sign-in first", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(setSubtaskCompleted(form({ id: STEP, completed: "true" }))).rejects.toThrow(
      "NEXT_REDIRECT:/login",
    );
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ["a bad id", { id: "nope", completed: "true" }],
    ["no id", { completed: "true" }],
    ["a bad completed value", { id: STEP, completed: "yes" }],
    ["no completed value", { id: STEP }],
  ])("ignores %s", async (_label, fields) => {
    await setSubtaskCompleted(form(fields));
    expect(update).not.toHaveBeenCalled();
  });

  it("throws a generic error when the database refuses", async () => {
    eq.mockReturnValue({ then: (r: (v: unknown) => void) => r({ error: { message: "secret" } }) });
    const attempt = setSubtaskCompleted(form({ id: STEP, completed: "true" }));
    await expect(attempt).rejects.toThrow("Could not update the step");
    await expect(attempt).rejects.not.toThrow(/secret/);
  });
});

describe("removeSubtask", () => {
  it("removes the step by id and refreshes the pages", async () => {
    await removeSubtask(form({ id: STEP }));
    expect(eq).toHaveBeenCalledWith("id", STEP);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("requires sign-in first", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(removeSubtask(form({ id: STEP }))).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    ["a bad id", { id: "nope" }],
    ["no id", {}],
  ])("ignores %s", async (_label, fields) => {
    await removeSubtask(form(fields));
    expect(remove).not.toHaveBeenCalled();
  });

  it("throws a generic error when the database refuses", async () => {
    eq.mockReturnValue({ then: (r: (v: unknown) => void) => r({ error: { message: "secret" } }) });
    const attempt = removeSubtask(form({ id: STEP }));
    await expect(attempt).rejects.toThrow("Could not remove the step");
    await expect(attempt).rejects.not.toThrow(/secret/);
  });
});
