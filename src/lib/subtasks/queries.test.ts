import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { listSubtasks } from "./queries";

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

const TASK = "123e4567-e89b-42d3-a456-426614174000";
const row = {
  id: "223e4567-e89b-42d3-a456-426614174000",
  title: "Book the venue",
  completed_at: null,
};

describe("listSubtasks", () => {
  it("returns the steps in the app's shape", async () => {
    const { client } = fakeSupabase({
      data: [row, { ...row, completed_at: "2026-10-27T08:00:00Z" }],
      error: null,
    });
    expect(await listSubtasks(client, TASK)).toEqual([
      { id: row.id, title: "Book the venue", completedAt: null },
      { id: row.id, title: "Book the venue", completedAt: "2026-10-27T08:00:00Z" },
    ]);
  });

  it("asks for one quest's steps, oldest first", async () => {
    const { client, calls } = fakeSupabase({ data: [], error: null });
    await listSubtasks(client, TASK);
    expect(calls).toContainEqual(["from", ["subtasks"]]);
    expect(calls).toContainEqual(["eq", ["task_id", TASK]]);
    expect(calls).toContainEqual(["order", ["created_at", { ascending: true }]]);
  });

  it("copes with no rows", async () => {
    const { client } = fakeSupabase({ data: null, error: null });
    expect(await listSubtasks(client, TASK)).toEqual([]);
  });

  it("throws a generic error that does not leak database details", async () => {
    const { client } = fakeSupabase({
      data: null,
      error: { message: 'permission denied for table "subtasks"' },
    });
    const attempt = listSubtasks(client, TASK);
    await expect(attempt).rejects.toThrow("Could not load the steps");
    await expect(attempt).rejects.not.toThrow(/permission|subtasks"/);
  });

  it("refuses rows that do not look like steps", async () => {
    const { client } = fakeSupabase({ data: [{ ...row, id: "not-a-uuid" }], error: null });
    await expect(listSubtasks(client, TASK)).rejects.toThrow();
  });
});
