import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  getCompletionContext,
  getTask,
  listOpenTasks,
  listRecentCompletedTasks,
  listTrashedTasks,
} from "./queries";

type Call = [string, unknown[]];

/** A stand-in for the Supabase query builder: records each call and resolves to `result`. */
function fakeSupabase(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const chain: unknown = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") return (resolve: (value: unknown) => void) => resolve(result);
        return (...args: unknown[]) => {
          calls.push([String(property), args]);
          return chain;
        };
      },
    },
  );
  const client = {
    from: (table: string) => {
      calls.push(["from", [table]]);
      return chain;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const row = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  title: "Pay rent",
  notes: "",
  category: "home",
  priority: "high",
  due_date: "2026-11-01",
  completed_at: null,
  pinned_for: null,
  recur_frequency: null,
  recur_interval: null,
  recur_weekdays: null,
};

const task = {
  id: row.id,
  title: "Pay rent",
  notes: "",
  category: "home",
  priority: "high",
  dueDate: "2026-11-01",
  completedAt: null,
  pinnedFor: null,
  recurrence: null,
};

// The lists also embed each quest's steps.
const listRow = { ...row, subtasks: [] };
const listTask = { ...task, stepsDone: 0, stepsTotal: 0 };

describe("listOpenTasks", () => {
  it("returns open tasks in the app's shape", async () => {
    const { client } = fakeSupabase({ data: [listRow], error: null });
    expect(await listOpenTasks(client)).toEqual([listTask]);
  });

  it("counts how many of a quest's steps are done", async () => {
    const subtasks = [
      { completed_at: "2026-10-27T08:00:00Z" },
      { completed_at: null },
      { completed_at: "2026-10-27T09:00:00Z" },
    ];
    const { client } = fakeSupabase({ data: [{ ...listRow, subtasks }], error: null });
    expect(await listOpenTasks(client)).toEqual([{ ...task, stepsDone: 2, stepsTotal: 3 }]);
  });

  it("returns the day a quest is pinned to", async () => {
    const { client } = fakeSupabase({
      data: [{ ...listRow, pinned_for: "2026-10-28" }],
      error: null,
    });
    expect((await listOpenTasks(client))[0]!.pinnedFor).toBe("2026-10-28");
  });

  it("returns how a quest repeats, with the weekdays in order", async () => {
    const { client } = fakeSupabase({
      data: [{ ...listRow, recur_frequency: "weekly", recur_interval: 2, recur_weekdays: [4, 1] }],
      error: null,
    });
    expect((await listOpenTasks(client))[0]!.recurrence).toEqual({
      frequency: "weekly",
      interval: 2,
      weekdays: [1, 4],
    });
  });

  it("returns no weekdays for a rule without any, and no rule for a quest that does not repeat", async () => {
    const { client } = fakeSupabase({
      data: [
        { ...listRow, recur_frequency: "monthly", recur_interval: 1, recur_weekdays: null },
        listRow,
      ],
      error: null,
    });
    const [monthly, plain] = await listOpenTasks(client);
    expect(monthly!.recurrence).toEqual({ frequency: "monthly", interval: 1, weekdays: [] });
    expect(plain!.recurrence).toBeNull();
  });

  it("refuses a repeat rule the app does not know", async () => {
    const { client } = fakeSupabase({
      data: [{ ...listRow, recur_frequency: "hourly", recur_interval: 1 }],
      error: null,
    });
    await expect(listOpenTasks(client)).rejects.toThrow();
  });

  it("asks for the repeat columns along with the other columns", async () => {
    const { client, calls } = fakeSupabase({ data: [], error: null });
    await listOpenTasks(client);
    const select = calls.find(([name]) => name === "select")!;
    expect(String(select[1][0])).toContain("recur_frequency, recur_interval, recur_weekdays");
  });

  it("asks for the pinned day along with the other columns", async () => {
    const { client, calls } = fakeSupabase({ data: [], error: null });
    await listOpenTasks(client);
    const select = calls.find(([name]) => name === "select")!;
    expect(String(select[1][0])).toContain("pinned_for");
  });

  it("asks for the steps along with the quests", async () => {
    const { client, calls } = fakeSupabase({ data: [], error: null });
    await listOpenTasks(client);
    const select = calls.find(([name]) => name === "select")!;
    expect(String(select[1][0])).toContain("subtasks(completed_at)");
  });

  it("asks for open tasks only, soonest first, with undated ones last", async () => {
    const { client, calls } = fakeSupabase({ data: [], error: null });
    await listOpenTasks(client);
    expect(calls).toContainEqual(["from", ["tasks"]]);
    expect(calls).toContainEqual(["is", ["completed_at", null]]);
    expect(calls).toContainEqual(["order", ["due_date", { ascending: true, nullsFirst: false }]]);
    expect(calls).toContainEqual(["order", ["priority", { ascending: false }]]);
  });

  it("leaves out quests in the Trash", async () => {
    const { client, calls } = fakeSupabase({ data: [], error: null });
    await listOpenTasks(client);
    expect(calls).toContainEqual(["is", ["deleted_at", null]]);
  });

  it("copes with no rows", async () => {
    const { client } = fakeSupabase({ data: null, error: null });
    expect(await listOpenTasks(client)).toEqual([]);
  });

  it("throws a generic error that does not leak database details", async () => {
    const { client } = fakeSupabase({
      data: null,
      error: { message: 'permission denied for table "tasks"' },
    });
    const attempt = listOpenTasks(client);
    await expect(attempt).rejects.toThrow("Could not load your quests");
    await expect(attempt).rejects.not.toThrow(/permission|tasks"/);
  });

  it("refuses rows that do not look like tasks", async () => {
    const { client } = fakeSupabase({ data: [{ ...listRow, category: "combat" }], error: null });
    await expect(listOpenTasks(client)).rejects.toThrow();
  });

  it("refuses rows that come back without their steps", async () => {
    const { client } = fakeSupabase({ data: [row], error: null });
    await expect(listOpenTasks(client)).rejects.toThrow();
  });
});

describe("listRecentCompletedTasks", () => {
  it("asks for completed tasks, newest first, limited", async () => {
    const { client, calls } = fakeSupabase({
      data: [{ ...listRow, completed_at: "2026-10-27T08:00:00Z" }],
      error: null,
    });
    const result = await listRecentCompletedTasks(client, 5);
    expect(result[0]!.completedAt).toBe("2026-10-27T08:00:00Z");
    expect(calls).toContainEqual(["not", ["completed_at", "is", null]]);
    expect(calls).toContainEqual(["order", ["completed_at", { ascending: false }]]);
    expect(calls).toContainEqual(["limit", [5]]);
  });

  it("defaults to the latest 20", async () => {
    const { client, calls } = fakeSupabase({ data: [], error: null });
    await listRecentCompletedTasks(client);
    expect(calls).toContainEqual(["limit", [20]]);
  });

  it("leaves out quests in the Trash", async () => {
    const { client, calls } = fakeSupabase({ data: [], error: null });
    await listRecentCompletedTasks(client);
    expect(calls).toContainEqual(["is", ["deleted_at", null]]);
  });

  it("copes with no rows and throws a generic error on failure", async () => {
    expect(
      await listRecentCompletedTasks(fakeSupabase({ data: null, error: null }).client),
    ).toEqual([]);
    await expect(
      listRecentCompletedTasks(fakeSupabase({ data: null, error: { message: "boom" } }).client),
    ).rejects.toThrow("Could not load your completed quests");
  });
});

describe("listTrashedTasks", () => {
  const trashedRow = { ...row, deleted_at: "2026-10-30T03:57:46.123+00:00" };

  it("returns trashed quests with when they were deleted", async () => {
    const { client } = fakeSupabase({ data: [trashedRow], error: null });
    expect(await listTrashedTasks(client)).toEqual([
      { ...task, deletedAt: "2026-10-30T03:57:46.123+00:00" },
    ]);
  });

  it("asks only for quests in the Trash, most recently deleted first", async () => {
    const { client, calls } = fakeSupabase({ data: [], error: null });
    await listTrashedTasks(client);
    expect(calls).toContainEqual(["from", ["tasks"]]);
    expect(calls).toContainEqual(["not", ["deleted_at", "is", null]]);
    expect(calls).toContainEqual(["order", ["deleted_at", { ascending: false }]]);
    const select = calls.find(([name]) => name === "select")!;
    expect(String(select[1][0])).toContain("deleted_at");
  });

  it("keeps the repeat rule, so a restored quest is described the same way", async () => {
    const { client } = fakeSupabase({
      data: [{ ...trashedRow, recur_frequency: "daily", recur_interval: 3 }],
      error: null,
    });
    expect((await listTrashedTasks(client))[0]!.recurrence).toEqual({
      frequency: "daily",
      interval: 3,
      weekdays: [],
    });
  });

  it("copes with no rows", async () => {
    expect(await listTrashedTasks(fakeSupabase({ data: null, error: null }).client)).toEqual([]);
  });

  it("refuses a row that has no delete time, and throws a generic error on failure", async () => {
    await expect(
      listTrashedTasks(fakeSupabase({ data: [row], error: null }).client),
    ).rejects.toThrow();
    const attempt = listTrashedTasks(
      fakeSupabase({ data: null, error: { message: "secret detail" } }).client,
    );
    await expect(attempt).rejects.toThrow("Could not load the Trash");
    await expect(attempt).rejects.not.toThrow(/secret detail/);
  });
});

describe("getTask", () => {
  it("returns the task", async () => {
    const { client, calls } = fakeSupabase({ data: row, error: null });
    expect(await getTask(client, row.id)).toEqual(task);
    expect(calls).toContainEqual(["eq", ["id", row.id]]);
  });

  it("does not find a quest that is in the Trash", async () => {
    const { client, calls } = fakeSupabase({ data: null, error: null });
    await getTask(client, row.id);
    expect(calls).toContainEqual(["is", ["deleted_at", null]]);
  });

  it("returns null when there is no such task, or it belongs to someone else", async () => {
    const { client } = fakeSupabase({ data: null, error: null });
    expect(await getTask(client, row.id)).toBeNull();
  });

  it("throws a generic error on failure", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "secret detail" } });
    const attempt = getTask(client, row.id);
    await expect(attempt).rejects.toThrow("Could not load the quest");
    await expect(attempt).rejects.not.toThrow(/secret detail/);
  });
});

describe("getCompletionContext", () => {
  const contextRow = {
    due_date: "2026-10-28",
    completed_at: null,
    recurrence_anchor: "2026-10-14",
    recur_frequency: "weekly",
    recur_interval: 2,
    recur_weekdays: [1, 4],
  };

  it("returns the dates and repeat rule needed to work out the next occurrence", async () => {
    const { client, calls } = fakeSupabase({ data: contextRow, error: null });
    expect(await getCompletionContext(client, row.id)).toEqual({
      dueDate: "2026-10-28",
      completedAt: null,
      anchor: "2026-10-14",
      recurrence: { frequency: "weekly", interval: 2, weekdays: [1, 4] },
    });
    expect(calls).toContainEqual(["from", ["tasks"]]);
    expect(calls).toContainEqual(["eq", ["id", row.id]]);
    expect(calls).toContainEqual(["is", ["deleted_at", null]]);
  });

  it("returns no rule for a quest that does not repeat", async () => {
    const { client } = fakeSupabase({
      data: {
        ...contextRow,
        recurrence_anchor: null,
        recur_frequency: null,
        recur_interval: null,
        recur_weekdays: null,
      },
      error: null,
    });
    expect(await getCompletionContext(client, row.id)).toMatchObject({
      anchor: null,
      recurrence: null,
    });
  });

  it("returns null when there is no such quest, or it belongs to someone else", async () => {
    const { client } = fakeSupabase({ data: null, error: null });
    expect(await getCompletionContext(client, row.id)).toBeNull();
  });

  it("throws a generic error on failure", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "secret detail" } });
    const attempt = getCompletionContext(client, row.id);
    await expect(attempt).rejects.toThrow("Could not load the quest");
    await expect(attempt).rejects.not.toThrow(/secret detail/);
  });
});
