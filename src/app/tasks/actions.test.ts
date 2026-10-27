import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUser, redirect, revalidatePath, insert, update, selectAfterUpdate, eq } = vi.hoisted(
  () => {
    const selectAfterUpdate = vi.fn();
    const eq = vi.fn();
    return {
      requireUser: vi.fn(),
      redirect: vi.fn((url: string) => {
        throw new Error(`NEXT_REDIRECT:${url}`);
      }),
      revalidatePath: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      selectAfterUpdate,
      eq,
    };
  },
);

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: () => ({ insert, update }) }),
}));

import { createTask, setTaskCompleted, updateTask } from "./actions";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const IDLE = { status: "idle" } as const;

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
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
  insert.mockResolvedValue({ error: null });
  // update(...).eq(...).select(...) for updateTask, update(...).eq(...) for setTaskCompleted
  eq.mockReturnValue({
    select: selectAfterUpdate,
    then: (r: (v: unknown) => void) => r({ error: null }),
  });
  update.mockReturnValue({ eq });
  selectAfterUpdate.mockResolvedValue({ data: [{ id: ID }], error: null });
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

describe("setTaskCompleted", () => {
  it("completes a quest with a timestamp", async () => {
    await setTaskCompleted(form({ id: ID, completed: "true" }));
    const sent = update.mock.calls[0]![0] as { completed_at: string };
    expect(new Date(sent.completed_at).toString()).not.toBe("Invalid Date");
    expect(eq).toHaveBeenCalledWith("id", ID);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("re-opens a quest", async () => {
    await setTaskCompleted(form({ id: ID, completed: "false" }));
    expect(update).toHaveBeenCalledWith({ completed_at: null });
  });

  it("requires sign-in first", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(setTaskCompleted(form({ id: ID, completed: "true" }))).rejects.toThrow(
      "NEXT_REDIRECT:/login",
    );
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ["a bad id", { id: "nope", completed: "true" }],
    ["no id", { completed: "true" }],
    ["a bad completed value", { id: ID, completed: "yes" }],
    ["no completed value", { id: ID }],
  ])("ignores %s", async (_label, fields) => {
    await setTaskCompleted(form(fields));
    expect(update).not.toHaveBeenCalled();
  });

  it("throws a generic error when the database refuses", async () => {
    eq.mockReturnValue({ then: (r: (v: unknown) => void) => r({ error: { message: "secret" } }) });
    const attempt = setTaskCompleted(form({ id: ID, completed: "true" }));
    await expect(attempt).rejects.toThrow("Could not update the quest");
    await expect(attempt).rejects.not.toThrow(/secret/);
  });
});
