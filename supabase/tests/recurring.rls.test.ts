// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDb, createUser } from "./helpers/db";

let db: PGlite;
let counter = 0;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

/** A user of their own, so tests never see each other's rows. */
async function newUser(): Promise<string> {
  return createUser(db, `user${++counter}@example.com`);
}

type Seed = {
  title?: string;
  due?: string | null;
  frequency?: string | null;
  interval?: number | null;
  weekdays?: number[] | null;
};

/** Creates a quest as the database superuser (like Supabase's backend), repeating by default. */
async function seedTask(userId: string, seed: Seed = {}): Promise<string> {
  const { title = "Water the plants", due = "2026-10-28" } = seed;
  const frequency = "frequency" in seed ? seed.frequency : "weekly";
  const interval = "interval" in seed ? seed.interval : 1;
  const weekdays = "weekdays" in seed ? seed.weekdays : null;
  const result = await db.query<{ id: string }>(
    `insert into public.tasks (user_id, title, notes, category, priority, due_date,
                               recur_frequency, recur_interval, recur_weekdays)
     values ($1, $2, 'some notes', 'home', 'high', $3, $4, $5, $6) returning id`,
    [userId, title, due, frequency, interval, weekdays],
  );
  return result.rows[0]!.id;
}

async function seedStep(userId: string, taskId: string, title: string, createdAt: string) {
  await db.query(
    "insert into public.subtasks (user_id, task_id, title, created_at) values ($1, $2, $3, $4)",
    [userId, taskId, title, createdAt],
  );
}

/**
 * Runs one statement the way a signed-in user's request would, but COMMITS it (asUser always rolls
 * back). Only for preparing state that a later step needs to find: the functions under test check
 * the signed-in user from the request claims, which are set here.
 */
async function commitAs<T extends object>(userId: string, sql: string, params: unknown[] = []) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

const rows = (r: { rows: unknown[] }) => r.rows;

describe("repeat rules: what the table accepts", () => {
  const create = (userId: string, sql: string, params: unknown[] = []) =>
    asUser(db, userId, (q) => q(sql, params));
  const columns = "(title, category, due_date, recur_frequency, recur_interval, recur_weekdays)";

  it("lets a user create a repeating quest, and anchors it on its due date", async () => {
    const u = await newUser();
    const row = await asUser(db, u, async (q) => {
      const result = await q<{ recurrence_anchor: string; recurred_from: string | null }>(
        `insert into public.tasks ${columns}
         values ('Weekly', 'work', '2026-10-28', 'weekly', 2, '{1,4}') returning recurrence_anchor::text, recurred_from`,
      );
      return result.rows[0]!;
    });
    expect(row).toEqual({ recurrence_anchor: "2026-10-28", recurred_from: null });
  });

  it.each(["recurrence_anchor", "recurred_from"])("never lets the API write %s", async (column) => {
    const u = await newUser();
    const value = column === "recurred_from" ? "gen_random_uuid()" : "'2026-01-01'";
    await expect(
      create(
        u,
        `insert into public.tasks (title, category, due_date, recur_frequency, recur_interval, ${column})
         values ('X', 'work', '2026-10-28', 'daily', 1, ${value})`,
      ),
    ).rejects.toThrow(/permission denied/);
    const task = await seedTask(u);
    await expect(
      create(u, `update public.tasks set ${column} = ${value} where id = $1`, [task]),
    ).rejects.toThrow(/permission denied/);
  });

  it.each([
    ["a frequency without an interval", "'daily', null, null", "2026-10-28"],
    ["an interval without a frequency", "null, 2, null", "2026-10-28"],
    ["a repeat with no due date to start from", "'daily', 1, null", null],
    ["an interval of 0", "'daily', 0, null", "2026-10-28"],
    ["an interval over 365", "'daily', 366, null", "2026-10-28"],
    ["weekdays on a daily rule", "'daily', 1, '{1}'", "2026-10-28"],
    ["weekdays on a monthly rule", "'monthly', 1, '{1}'", "2026-10-28"],
    ["weekdays without a frequency", "null, null, '{1}'", "2026-10-28"],
    ["weekday 0", "'weekly', 1, '{0}'", "2026-10-28"],
    ["weekday 8", "'weekly', 1, '{8}'", "2026-10-28"],
    ["the same weekday twice", "'weekly', 1, '{1,1}'", "2026-10-28"],
    ["an empty list of weekdays", "'weekly', 1, '{}'", "2026-10-28"],
  ])("rejects %s", async (_label, rule, due) => {
    const u = await newUser();
    await expect(
      create(
        u,
        `insert into public.tasks (title, category, due_date, recur_frequency, recur_interval, recur_weekdays)
         values ('X', 'work', $1, ${rule})`,
        [due],
      ),
    ).rejects.toThrow(/check constraint|violates/);
  });

  it("rejects a frequency that does not exist", async () => {
    const u = await newUser();
    await expect(
      create(
        u,
        `insert into public.tasks ${columns} values ('X', 'work', '2026-10-28', 'hourly', 1, null)`,
      ),
    ).rejects.toThrow(/invalid input value for enum/);
  });

  it("accepts all seven weekdays, and the limits of the interval", async () => {
    const u = await newUser();
    for (const rule of [
      "'weekly', 1, '{1,2,3,4,5,6,7}'",
      "'daily', 365, null",
      "'monthly', 1, null",
    ]) {
      await expect(
        create(
          u,
          `insert into public.tasks ${columns} values ('X', 'work', '2026-10-28', ${rule})`,
        ),
      ).resolves.toBeDefined();
    }
  });

  it("keeps the anchor when other things are edited, and moves it with the rule or the due date", async () => {
    const u = await newUser();
    const task = await seedTask(u, { due: "2026-10-31", frequency: "monthly" });
    const anchor = (q: Parameters<Parameters<typeof asUser>[2]>[0]) =>
      q<{ a: string | null }>(
        "select recurrence_anchor::text as a from public.tasks where id = $1",
        [task],
      ).then((r) => r.rows[0]!.a);

    const result = await asUser(db, u, async (q) => {
      const first = await anchor(q);
      await q("update public.tasks set title = 'Renamed', priority = 'low' where id = $1", [task]);
      const afterRename = await anchor(q);
      await q("update public.tasks set due_date = '2026-11-15' where id = $1", [task]);
      const afterDue = await anchor(q);
      await q("update public.tasks set recur_interval = 2 where id = $1", [task]);
      const afterRule = await anchor(q);
      await q(
        "update public.tasks set recur_frequency = null, recur_interval = null where id = $1",
        [task],
      );
      const afterOff = await anchor(q);
      return { first, afterRename, afterDue, afterRule, afterOff };
    });
    expect(result).toEqual({
      first: "2026-10-31",
      afterRename: "2026-10-31",
      afterDue: "2026-11-15",
      afterRule: "2026-11-15",
      afterOff: null,
    });
  });
});

describe("complete_task", () => {
  it("completes an ordinary quest with the database's clock and creates nothing else", async () => {
    const u = await newUser();
    const task = await seedTask(u, { frequency: null, interval: null });
    const result = await asUser(db, u, async (q) => {
      const created = await q<{ id: string | null }>(
        "select public.complete_task($1, null) as id",
        [task],
      );
      const state = await q<{ done: boolean; n: string }>(
        "select completed_at is not null as done, (select count(*) from public.tasks)::text as n from public.tasks where id = $1",
        [task],
      );
      return { created: created.rows[0]!.id, ...state.rows[0]! };
    });
    expect(result).toEqual({ created: null, done: true, n: "1" });
  });

  it("completes a repeating quest and creates the next one in the same step", async () => {
    const u = await newUser();
    const task = await seedTask(u, {
      due: "2026-10-28",
      frequency: "weekly",
      interval: 2,
      weekdays: [3, 5],
    });
    const result = await asUser(db, u, async (q) => {
      const made = await q<{ id: string }>("select public.complete_task($1, '2026-10-30') as id", [
        task,
      ]);
      const old = await q<{ done: boolean }>(
        "select completed_at is not null as done from public.tasks where id = $1",
        [task],
      );
      const next = await q(
        `select id, title, notes, category, priority, due_date::text, completed_at,
                recur_frequency, recur_interval, recur_weekdays, recurrence_anchor::text,
                recurred_from, pinned_for, user_id
           from public.tasks where id = $1`,
        [made.rows[0]!.id],
      );
      return { newId: made.rows[0]!.id, oldDone: old.rows[0]!.done, next: next.rows[0] };
    });
    expect(result.oldDone).toBe(true);
    expect(result.next).toEqual({
      id: result.newId,
      title: "Water the plants",
      notes: "some notes",
      category: "home",
      priority: "high",
      due_date: "2026-10-30",
      completed_at: null,
      recur_frequency: "weekly",
      recur_interval: 2,
      recur_weekdays: [3, 5],
      recurrence_anchor: "2026-10-28", // the series keeps its first date, not the new due date
      recurred_from: task,
      pinned_for: null,
      user_id: u,
    });
  });

  it("copies the steps in their original order, all unticked", async () => {
    const u = await newUser();
    const task = await seedTask(u);
    await seedStep(u, task, "First", "2026-10-01T08:00:00Z");
    await seedStep(u, task, "Second", "2026-10-01T09:00:00Z");
    await seedStep(u, task, "Third", "2026-10-01T10:00:00Z");
    await db.query(
      "update public.subtasks set completed_at = now() where task_id = $1 and title = 'Second'",
      [task],
    );

    const copied = await asUser(db, u, async (q) => {
      const made = await q<{ id: string }>("select public.complete_task($1, '2026-11-04') as id", [
        task,
      ]);
      return (
        await q<{ title: string; completed_at: string | null }>(
          "select title, completed_at from public.subtasks where task_id = $1 order by created_at, id",
          [made.rows[0]!.id],
        )
      ).rows;
    });
    expect(copied).toEqual([
      { title: "First", completed_at: null },
      { title: "Second", completed_at: null },
      { title: "Third", completed_at: null },
    ]);
  });

  it("leaves the finished quest's own steps as they were", async () => {
    const u = await newUser();
    const task = await seedTask(u);
    await seedStep(u, task, "Only step", "2026-10-01T08:00:00Z");
    await db.query("update public.subtasks set completed_at = now() where task_id = $1", [task]);
    const left = await asUser(db, u, async (q) => {
      await q("select public.complete_task($1, '2026-11-04')", [task]);
      return (
        await q<{ done: boolean }>(
          "select completed_at is not null as done from public.subtasks where task_id = $1",
          [task],
        )
      ).rows;
    });
    expect(left).toEqual([{ done: true }]);
  });

  it("does not change the completion time when called again", async () => {
    const u = await newUser();
    const task = await seedTask(u, { frequency: null, interval: null });
    await commitAs(u, "select public.complete_task($1)", [task]);
    const completedAt = () =>
      db
        .query<{ t: string }>("select completed_at::text as t from public.tasks where id = $1", [
          task,
        ])
        .then((r) => r.rows[0]!.t);
    const first = await completedAt();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await commitAs(u, "select public.complete_task($1)", [task]);
    expect(await completedAt()).toBe(first);
  });

  it("keeps the series' first date as the anchor through the next quest's own edits", async () => {
    const u = await newUser();
    const task = await seedTask(u, { due: "2026-10-31", frequency: "monthly" });
    const anchor = await asUser(db, u, async (q) => {
      const next = (
        await q<{ id: string }>("select public.complete_task($1, '2026-11-30') as id", [task])
      ).rows[0]!.id;
      await q("update public.tasks set title = 'Renamed', priority = 'low' where id = $1", [next]);
      return (
        await q<{ a: string }>(
          "select recurrence_anchor::text as a, due_date::text as d from public.tasks where id = $1",
          [next],
        )
      ).rows[0]!.a;
    });
    // Due 30 November (February's short-month trick in miniature), but still anchored on the 31st.
    expect(anchor).toBe("2026-10-31");
  });

  it("creates only one next occurrence however many times it is called", async () => {
    const u = await newUser();
    const task = await seedTask(u);
    const result = await asUser(db, u, async (q) => {
      const first = await q<{ id: string | null }>(
        "select public.complete_task($1, '2026-11-04') as id",
        [task],
      );
      const second = await q<{ id: string | null }>(
        "select public.complete_task($1, '2026-11-04') as id",
        [task],
      );
      const third = await q<{ id: string | null }>(
        "select public.complete_task($1, '2026-11-11') as id",
        [task],
      );
      const total = await q<{ n: string }>("select count(*)::text as n from public.tasks");
      return {
        first: first.rows[0]!.id,
        second: second.rows[0]!.id,
        third: third.rows[0]!.id,
        total: total.rows[0]!.n,
      };
    });
    expect(result.first).not.toBeNull();
    expect(result.second).toBeNull();
    expect(result.third).toBeNull();
    expect(result.total).toBe("2");
  });

  it("completes a repeating quest without creating a next one when there is no next date", async () => {
    const u = await newUser();
    const task = await seedTask(u);
    const result = await asUser(db, u, async (q) => {
      const made = await q<{ id: string | null }>("select public.complete_task($1, null) as id", [
        task,
      ]);
      const total = await q<{ n: string }>("select count(*)::text as n from public.tasks");
      return { made: made.rows[0]!.id, total: total.rows[0]!.n };
    });
    expect(result).toEqual({ made: null, total: "1" });
  });

  it("does not create a duplicate when a quest is completed again after Undo", async () => {
    const u = await newUser();
    const task = await seedTask(u);
    // Complete, and also complete the new one, so Undo cannot remove it.
    const next = (
      await commitAs<{ id: string }>(u, "select public.complete_task($1, '2026-11-04') as id", [
        task,
      ])
    ).rows[0]!.id;
    await commitAs(u, "select public.complete_task($1, null)", [next]);

    const total = await asUser(db, u, async (q) => {
      await q("select public.reopen_task($1)", [task]);
      const again = await q<{ id: string | null }>(
        "select public.complete_task($1, '2026-11-04') as id",
        [task],
      );
      expect(again.rows[0]!.id).toBeNull();
      return (
        await q<{ n: string }>(
          "select count(*)::text as n from public.tasks where recurred_from = $1",
          [task],
        )
      ).rows[0]!.n;
    });
    expect(total).toBe("1");
  });

  it("refuses a next date that is not after the current due date, and changes nothing", async () => {
    const u = await newUser();
    const task = await seedTask(u, { due: "2026-10-28" });
    const state = await asUser(db, u, async (q) => {
      await q("savepoint attempt");
      let message = "";
      try {
        await q("select public.complete_task($1, '2026-10-28')", [task]);
      } catch (error) {
        message = (error as Error).message;
      }
      await q("rollback to savepoint attempt");
      const after = await q<{ done: boolean; n: string }>(
        "select completed_at is not null as done, (select count(*) from public.tasks)::text as n from public.tasks where id = $1",
        [task],
      );
      return { message, ...after.rows[0]! };
    });
    expect(state.message).toMatch(/invalid_next_due/);
    expect(state).toMatchObject({ done: false, n: "1" });
  });

  it("is all or nothing: if the next quest cannot be created, the quest is not completed either", async () => {
    const u = await newUser();
    const task = await seedTask(u);
    await seedStep(u, task, "A step", "2026-10-01T08:00:00Z");
    const state = await asUser(db, u, async (q) => {
      await q("savepoint attempt");
      let message = "";
      try {
        // A due date past 2100 breaks the table's date rule when the next quest is inserted.
        await q("select public.complete_task($1, '2101-01-07')", [task]);
      } catch (error) {
        message = (error as Error).message;
      }
      await q("rollback to savepoint attempt");
      const after = await q<{ done: boolean; tasks: string; steps: string }>(
        `select completed_at is not null as done,
                (select count(*) from public.tasks)::text as tasks,
                (select count(*) from public.subtasks)::text as steps
           from public.tasks where id = $1`,
        [task],
      );
      return { message, ...after.rows[0]! };
    });
    expect(state.message).toMatch(/check constraint/);
    expect(state).toMatchObject({ done: false, tasks: "1", steps: "1" });
  });

  it("does nothing for someone else's quest, or one that does not exist", async () => {
    const alice = await newUser();
    const bob = await newUser();
    const task = await seedTask(alice);
    const result = await asUser(db, bob, async (q) => {
      const theirs = await q<{ id: string | null }>(
        "select public.complete_task($1, '2026-11-04') as id",
        [task],
      );
      const missing = await q<{ id: string | null }>(
        "select public.complete_task('00000000-0000-4000-8000-000000000000', '2026-11-04') as id",
      );
      return { theirs: theirs.rows[0]!.id, missing: missing.rows[0]!.id };
    });
    expect(result).toEqual({ theirs: null, missing: null });
    const untouched = await db.query<{ done: boolean; n: string }>(
      "select completed_at is not null as done, (select count(*) from public.tasks where user_id = $1)::text as n from public.tasks where id = $2",
      [alice, task],
    );
    expect(untouched.rows[0]).toEqual({ done: false, n: "1" });
  });

  it("takes the owner from the signed-in session, never from an argument", async () => {
    const alice = await newUser();
    const bob = await newUser();
    const task = await seedTask(alice);
    const made = await asUser(db, alice, async (q) => {
      const id = (
        await q<{ id: string }>("select public.complete_task($1, '2026-11-04') as id", [task])
      ).rows[0]!.id;
      return (await q<{ user_id: string }>("select user_id from public.tasks where id = $1", [id]))
        .rows[0]!.user_id;
    });
    expect(made).toBe(alice);
    expect(made).not.toBe(bob);
  });

  it("is not available to signed-out visitors", async () => {
    const task = await seedTask(await newUser());
    await expect(
      asAnon(db, (q) => q("select public.complete_task($1, '2026-11-04')", [task])),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses a caller with no user in the session", async () => {
    const task = await seedTask(await newUser());
    await expect(
      asUser(db, "", (q) => q("select public.complete_task($1, '2026-11-04')", [task])),
    ).rejects.toThrow(/not_signed_in|invalid input syntax/);
  });
});

describe("reopen_task", () => {
  it("re-opens a completed quest", async () => {
    const u = await newUser();
    const task = await seedTask(u, { frequency: null, interval: null });
    const result = await asUser(db, u, async (q) => {
      await q("select public.complete_task($1)", [task]);
      const reopened = await q<{ ok: boolean }>("select public.reopen_task($1) as ok", [task]);
      const state = await q<{ done: boolean }>(
        "select completed_at is not null as done from public.tasks where id = $1",
        [task],
      );
      return { ok: reopened.rows[0]!.ok, done: state.rows[0]!.done };
    });
    expect(result).toEqual({ ok: true, done: false });
  });

  it("says false for a quest that is not completed, and for someone else's", async () => {
    const alice = await newUser();
    const bob = await newUser();
    const open = await seedTask(alice, { frequency: null, interval: null });
    const done = await seedTask(alice, { frequency: null, interval: null });
    await commitAs(alice, "select public.complete_task($1)", [done]);

    expect(
      await asUser(
        db,
        alice,
        async (q) =>
          (await q<{ ok: boolean }>("select public.reopen_task($1) as ok", [open])).rows[0]!.ok,
      ),
    ).toBe(false);
    expect(
      await asUser(
        db,
        bob,
        async (q) =>
          (await q<{ ok: boolean }>("select public.reopen_task($1) as ok", [done])).rows[0]!.ok,
      ),
    ).toBe(false);
    const still = await db.query<{ done: boolean }>(
      "select completed_at is not null as done from public.tasks where id = $1",
      [done],
    );
    expect(still.rows[0]!.done).toBe(true);
  });

  it("removes the next occurrence it created if nobody has touched it", async () => {
    const u = await newUser();
    const task = await seedTask(u);
    await seedStep(u, task, "A step", "2026-10-01T08:00:00Z");
    const left = await asUser(db, u, async (q) => {
      await q("select public.complete_task($1, '2026-11-04')", [task]);
      await q("select public.reopen_task($1)", [task]);
      const tasks = await q<{ id: string }>("select id from public.tasks");
      const steps = await q<{ task_id: string }>("select task_id from public.subtasks");
      return { tasks: tasks.rows.map((r) => r.id), steps: steps.rows.map((r) => r.task_id) };
    });
    // Only the original quest, with its own step, is left.
    expect(left).toEqual({ tasks: [task], steps: [task] });
  });

  async function completedWithSuccessor() {
    const u = await newUser();
    const task = await seedTask(u);
    await seedStep(u, task, "A step", "2026-10-01T08:00:00Z");
    const next = (
      await commitAs<{ id: string }>(u, "select public.complete_task($1, '2026-11-04') as id", [
        task,
      ])
    ).rows[0]!.id;
    await new Promise((resolve) => setTimeout(resolve, 20)); // so later edits get a later timestamp
    return { u, task, next };
  }
  const successorsOf = (u: string, task: string) =>
    asUser(db, u, async (q) => {
      await q("select public.reopen_task($1)", [task]);
      return rows(await q("select id from public.tasks where recurred_from = $1", [task])).length;
    });

  it("keeps the next occurrence if it has been edited", async () => {
    const { u, task, next } = await completedWithSuccessor();
    await db.query("update public.tasks set title = 'Edited' where id = $1", [next]);
    expect(await successorsOf(u, task)).toBe(1);
  });

  it("keeps the next occurrence if one of its steps has been ticked", async () => {
    const { u, task, next } = await completedWithSuccessor();
    await db.query("update public.subtasks set completed_at = now() where task_id = $1", [next]);
    expect(await successorsOf(u, task)).toBe(1);
  });

  it("keeps the next occurrence if it has been completed", async () => {
    const { u, task, next } = await completedWithSuccessor();
    await commitAs(u, "select public.complete_task($1, null)", [next]);
    expect(await successorsOf(u, task)).toBe(1);
  });

  it("is not available to signed-out visitors", async () => {
    const task = await seedTask(await newUser());
    await expect(asAnon(db, (q) => q("select public.reopen_task($1)", [task]))).rejects.toThrow(
      /permission denied/,
    );
  });
});
