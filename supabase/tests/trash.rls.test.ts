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

/** Creates a quest as the database superuser (like Supabase's backend). */
async function seedTask(
  userId: string,
  options: {
    title?: string;
    repeats?: boolean;
    trashedDaysAgo?: number;
    completed?: boolean;
    /** Makes this the next occurrence of another quest (set at creation, so it counts as untouched). */
    recurredFrom?: string;
  } = {},
): Promise<string> {
  const {
    title = "Pay rent",
    repeats = false,
    trashedDaysAgo,
    completed = false,
    recurredFrom,
  } = options;
  const result = await db.query<{ id: string }>(
    `insert into public.tasks (user_id, title, category, priority, due_date, recur_frequency, recur_interval,
                               completed_at, deleted_at, recurred_from)
     values ($1, $2, 'home', 'normal', '2026-10-28', $3, $4,
             case when $5::boolean then now() end,
             case when $6::int is null then null else now() - make_interval(days => $6::int) end,
             $7)
     returning id`,
    [
      userId,
      title,
      repeats ? "daily" : null,
      repeats ? 1 : null,
      completed,
      trashedDaysAgo ?? null,
      recurredFrom ?? null,
    ],
  );
  return result.rows[0]!.id;
}

async function seedStep(userId: string, taskId: string, title = "A step", done = false) {
  const result = await db.query<{ id: string }>(
    `insert into public.subtasks (user_id, task_id, title, completed_at)
     values ($1, $2, $3, case when $4::boolean then now() end) returning id`,
    [userId, taskId, title, done],
  );
  return result.rows[0]!.id;
}

/**
 * Runs one statement the way a signed-in user's request would, but COMMITS it (asUser always rolls
 * back). Only for preparing state that a later step needs to find.
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

/** What the superuser sees of a quest: whether it is in the Trash, and its other fields. */
async function stored(taskId: string) {
  const result = await db.query<{ trashed: boolean; completed: boolean; title: string }>(
    `select deleted_at is not null as trashed, completed_at is not null as completed, title
       from public.tasks where id = $1`,
    [taskId],
  );
  return result.rows[0] ?? null;
}

const countOf = async (sql: string, params: unknown[] = []) =>
  Number((await db.query<{ n: string }>(sql, params)).rows[0]!.n);

describe("trash_task: moving a quest into the Trash", () => {
  it("moves your quest to the Trash, stamped with the database's own clock", async () => {
    const u = await newUser();
    const task = await seedTask(u);
    const row = await asUser(db, u, async (q) => {
      const ok = (await q<{ ok: boolean }>("select public.trash_task($1) as ok", [task])).rows[0]!
        .ok;
      // A separate statement: one statement cannot see its own changes. Inside a transaction now()
      // is fixed, so equality shows the time came from the database's clock.
      const at_now = (
        await q<{ at_now: boolean }>(
          "select deleted_at = now() as at_now from public.tasks where id = $1",
          [task],
        )
      ).rows[0]!.at_now;
      return { ok, at_now };
    });
    expect(row).toEqual({ ok: true, at_now: true });
  });

  it("does nothing the second time, so the 30 days never restart", async () => {
    const u = await newUser();
    const task = await seedTask(u, { trashedDaysAgo: 10 });
    const ok = await asUser(db, u, async (q) => {
      const result = await q<{ ok: boolean }>("select public.trash_task($1) as ok", [task]);
      return result.rows[0]!.ok;
    });
    expect(ok).toBe(false);
    expect(
      await countOf(
        "select count(*) as n from public.tasks where id = $1 and deleted_at < now() - interval '9 days'",
        [task],
      ),
    ).toBe(1);
  });

  it("works on a completed quest too", async () => {
    const u = await newUser();
    const task = await seedTask(u, { completed: true });
    const ok = await asUser(db, u, async (q) => {
      return (await q<{ ok: boolean }>("select public.trash_task($1) as ok", [task])).rows[0]!.ok;
    });
    expect(ok).toBe(true);
  });

  it("cannot trash another user's quest", async () => {
    const alice = await newUser();
    const bob = await newUser();
    const task = await seedTask(alice);
    const ok = await asUser(db, bob, async (q) => {
      return (await q<{ ok: boolean }>("select public.trash_task($1) as ok", [task])).rows[0]!.ok;
    });
    expect(ok).toBe(false);
    expect((await stored(task))!.trashed).toBe(false);
  });

  it("is refused to signed-out visitors", async () => {
    const task = await seedTask(await newUser());
    await expect(asAnon(db, (q) => q("select public.trash_task($1)", [task]))).rejects.toThrow(
      /permission denied/,
    );
    expect((await stored(task))!.trashed).toBe(false);
  });

  it("is refused when called by the backend with no signed-in user", async () => {
    const task = await seedTask(await newUser());
    await expect(db.query("select public.trash_task($1)", [task])).rejects.toThrow(/not_signed_in/);
  });
});

describe("restore_task: bringing a quest back", () => {
  it("restores your quest from the Trash", async () => {
    const u = await newUser();
    const task = await seedTask(u, { trashedDaysAgo: 3 });
    const ok = await asUser(db, u, async (q) => {
      return (await q<{ ok: boolean }>("select public.restore_task($1) as ok", [task])).rows[0]!.ok;
    });
    expect(ok).toBe(true);
  });

  it("does nothing for a quest that is not in the Trash", async () => {
    const u = await newUser();
    const task = await seedTask(u);
    const ok = await asUser(db, u, async (q) => {
      return (await q<{ ok: boolean }>("select public.restore_task($1) as ok", [task])).rows[0]!.ok;
    });
    expect(ok).toBe(false);
  });

  it("cannot restore another user's quest", async () => {
    const alice = await newUser();
    const bob = await newUser();
    const task = await seedTask(alice, { trashedDaysAgo: 1 });
    const ok = await asUser(db, bob, async (q) => {
      return (await q<{ ok: boolean }>("select public.restore_task($1) as ok", [task])).rows[0]!.ok;
    });
    expect(ok).toBe(false);
    expect((await stored(task))!.trashed).toBe(true);
  });

  it("is refused to signed-out visitors", async () => {
    const task = await seedTask(await newUser(), { trashedDaysAgo: 1 });
    await expect(asAnon(db, (q) => q("select public.restore_task($1)", [task]))).rejects.toThrow(
      /permission denied/,
    );
    expect((await stored(task))!.trashed).toBe(true);
  });
});

describe("the API cannot touch deleted_at directly", () => {
  it("refuses to set it on update, so the Trash can only be entered through trash_task", async () => {
    const u = await newUser();
    const task = await seedTask(u);
    await expect(
      asUser(db, u, (q) => q("update public.tasks set deleted_at = now() where id = $1", [task])),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses to clear it on update, so the Trash can only be left through restore_task", async () => {
    const u = await newUser();
    const task = await seedTask(u, { trashedDaysAgo: 5 });
    await expect(
      asUser(db, u, (q) => q("update public.tasks set deleted_at = null where id = $1", [task])),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses to set it on insert", async () => {
    const u = await newUser();
    await expect(
      asUser(db, u, (q) =>
        q("insert into public.tasks (title, category, deleted_at) values ('X', 'work', now())"),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("a quest in the Trash is frozen", () => {
  it("cannot be edited", async () => {
    const u = await newUser();
    const task = await seedTask(u, { trashedDaysAgo: 1 });
    const changed = await asUser(db, u, async (q) => {
      const result = await q(
        "update public.tasks set title = 'Changed' where id = $1 returning id",
        [task],
      );
      return result.rows.length;
    });
    expect(changed).toBe(0);
    expect((await stored(task))!.title).toBe("Pay rent");
  });

  it("cannot be pinned to today", async () => {
    const u = await newUser();
    const task = await seedTask(u, { trashedDaysAgo: 1 });
    const changed = await asUser(db, u, async (q) => {
      const result = await q(
        "update public.tasks set pinned_for = '2026-10-30' where id = $1 returning id",
        [task],
      );
      return result.rows.length;
    });
    expect(changed).toBe(0);
  });

  it("cannot be completed", async () => {
    const u = await newUser();
    const task = await seedTask(u, { trashedDaysAgo: 1 });
    // Read the quest back inside the same transaction: asUser rolls back at the end, so looking
    // afterwards could never see a change.
    const completedAfter = await asUser(db, u, async (q) => {
      await q("select public.complete_task($1, null)", [task]);
      return (
        await q<{ done: boolean }>(
          "select completed_at is not null as done from public.tasks where id = $1",
          [task],
        )
      ).rows[0]!.done;
    });
    expect(completedAfter).toBe(false);
  });

  it("cannot be re-opened", async () => {
    const u = await newUser();
    const task = await seedTask(u, { trashedDaysAgo: 1, completed: true });
    const ok = await asUser(db, u, async (q) => {
      return (await q<{ ok: boolean }>("select public.reopen_task($1) as ok", [task])).rows[0]!.ok;
    });
    expect(ok).toBe(false);
    expect((await stored(task))!.completed).toBe(true);
  });

  it("can be edited again once it is restored", async () => {
    const u = await newUser();
    const task = await seedTask(u, { trashedDaysAgo: 1 });
    // (asUser rolls back at the end, so restore and edit in one go.)
    const changed = await asUser(db, u, async (q) => {
      await q("select public.restore_task($1)", [task]);
      const result = await q("update public.tasks set title = 'Back' where id = $1 returning id", [
        task,
      ]);
      return result.rows.length;
    });
    expect(changed).toBe(1);
  });
});

describe("steps of a quest in the Trash are frozen with it", () => {
  it("cannot get a new step", async () => {
    const u = await newUser();
    const task = await seedTask(u, { trashedDaysAgo: 1 });
    await expect(
      asUser(db, u, (q) =>
        q("insert into public.subtasks (task_id, title) values ($1, 'Sneaky')", [task]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot be ticked or renamed", async () => {
    const u = await newUser();
    const task = await seedTask(u, { trashedDaysAgo: 1 });
    const step = await seedStep(u, task);
    const changed = await asUser(db, u, async (q) => {
      const result = await q(
        "update public.subtasks set completed_at = now(), title = 'Changed' where id = $1 returning id",
        [step],
      );
      return result.rows.length;
    });
    expect(changed).toBe(0);
  });

  it("cannot be removed one by one", async () => {
    const u = await newUser();
    const task = await seedTask(u, { trashedDaysAgo: 1 });
    const step = await seedStep(u, task);
    const removed = await asUser(db, u, async (q) => {
      const result = await q("delete from public.subtasks where id = $1 returning id", [step]);
      return result.rows.length;
    });
    expect(removed).toBe(0);
    expect(await countOf("select count(*) as n from public.subtasks where id = $1", [step])).toBe(
      1,
    );
  });

  it("work again on a live quest", async () => {
    const u = await newUser();
    const task = await seedTask(u);
    const step = await seedStep(u, task);
    const result = await asUser(db, u, async (q) => {
      const ticked = await q(
        "update public.subtasks set completed_at = now() where id = $1 returning id",
        [step],
      );
      await q("insert into public.subtasks (task_id, title) values ($1, 'Another')", [task]);
      const removed = await q("delete from public.subtasks where id = $1 returning id", [step]);
      return [ticked.rows.length, removed.rows.length];
    });
    expect(result).toEqual([1, 1]);
  });
});

describe("Delete forever", () => {
  it("removes a quest that is in the Trash, and its steps with it", async () => {
    const u = await newUser();
    const task = await seedTask(u, { trashedDaysAgo: 2 });
    await seedStep(u, task);
    const result = await asUser(db, u, async (q) => {
      const removed = (await q("delete from public.tasks where id = $1 returning id", [task])).rows
        .length;
      const steps = (
        await q<{ n: string }>("select count(*) as n from public.subtasks where task_id = $1", [
          task,
        ])
      ).rows[0]!.n;
      return { removed, steps: Number(steps) };
    });
    expect(result).toEqual({ removed: 1, steps: 0 });
  });

  it("never removes a quest that is not in the Trash", async () => {
    const u = await newUser();
    const task = await seedTask(u);
    const removed = await asUser(db, u, async (q) => {
      return (await q("delete from public.tasks where id = $1 returning id", [task])).rows.length;
    });
    expect(removed).toBe(0);
    expect(await stored(task)).not.toBeNull();
  });

  // (The delete rule names the owner, and the select rule hides other users' rows from a DELETE as
  // well, so either one alone would hold. Both are kept on purpose: defense in depth.)
  it("never removes another user's trashed quest", async () => {
    const alice = await newUser();
    const bob = await newUser();
    const task = await seedTask(alice, { trashedDaysAgo: 2 });
    const removed = await asUser(db, bob, async (q) => {
      return (await q("delete from public.tasks where id = $1 returning id", [task])).rows.length;
    });
    expect(removed).toBe(0);
    expect(await stored(task)).not.toBeNull();
  });

  it("empties only your own Trash: live quests and other users' trash stay", async () => {
    const alice = await newUser();
    const bob = await newUser();
    const trashed1 = await seedTask(alice, { title: "Old 1", trashedDaysAgo: 1 });
    const trashed2 = await seedTask(alice, { title: "Old 2", trashedDaysAgo: 9 });
    const live = await seedTask(alice, { title: "Keep me" });
    const bobsTrash = await seedTask(bob, { title: "Bob's old", trashedDaysAgo: 1 });

    const left = await asUser(db, alice, async (q) => {
      // Even a delete with no filter at all can only reach Alice's trashed rows.
      const removed = (await q("delete from public.tasks returning id")).rows.length;
      const remaining = (await q<{ id: string }>("select id from public.tasks")).rows;
      return { removed, remaining: remaining.map((r) => r.id) };
    });
    expect(left.removed).toBe(2);
    expect(left.remaining).toEqual([live]);
    expect(await stored(trashed1)).not.toBeNull(); // asUser rolled back
    expect(await stored(trashed2)).not.toBeNull();
    expect(await stored(bobsTrash)).not.toBeNull();
  });

  it("is refused to signed-out visitors", async () => {
    const task = await seedTask(await newUser(), { trashedDaysAgo: 2 });
    await expect(
      asAnon(db, (q) => q("delete from public.tasks where id = $1", [task])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("another user cannot see your Trash", () => {
  it("hides a trashed quest from other users, like any other quest", async () => {
    const alice = await newUser();
    const bob = await newUser();
    await seedTask(alice, { trashedDaysAgo: 1 });
    const rows = await asUser(db, bob, async (q) => (await q("select id from public.tasks")).rows);
    expect(rows).toHaveLength(0);
  });
});

describe("purge_trash: the 30-day clean-up", () => {
  it("removes quests trashed more than 30 days ago and keeps everything else", async () => {
    const u = await newUser();
    const old = await seedTask(u, { title: "Ancient", trashedDaysAgo: 31 });
    await seedStep(u, old);
    const recent = await seedTask(u, { title: "Recent", trashedDaysAgo: 29 });
    const live = await seedTask(u, { title: "Live" });
    const done = await seedTask(u, { title: "Done", completed: true });

    const removed = (await db.query<{ n: number }>("select public.purge_trash() as n")).rows[0]!.n;

    expect(removed).toBe(1);
    expect(await stored(old)).toBeNull();
    expect(
      await countOf("select count(*) as n from public.subtasks where task_id = $1", [old]),
    ).toBe(0);
    for (const id of [recent, live, done]) expect(await stored(id)).not.toBeNull();
  });

  it("returns 0 when there is nothing to purge", async () => {
    const result = await db.query<{ n: number }>("select public.purge_trash() as n");
    expect(result.rows[0]!.n).toBe(0);
  });

  it.each(["signed-in users", "signed-out visitors"])(
    "cannot be called by %s, who could otherwise wipe everyone's trash",
    async (who) => {
      const u = await newUser();
      const old = await seedTask(u, { trashedDaysAgo: 40 });
      const call = (q: PGlite["query"]) => q("select public.purge_trash()");
      await expect(
        who === "signed-in users" ? asUser(db, u, call) : asAnon(db, call),
      ).rejects.toThrow(/permission denied/);
      expect(await stored(old)).not.toBeNull();
    },
  );
});

describe("repeating quests and the Trash", () => {
  /** Completes `task` as `userId` for real (committed), returning the next occurrence's id. */
  async function completeFor(userId: string, task: string, nextDue = "2026-10-29") {
    const result = await commitAs<{ id: string | null }>(
      userId,
      "select public.complete_task($1, $2) as id",
      [task, nextDue],
    );
    return result.rows[0]!.id;
  }
  const trashFor = (userId: string, task: string) =>
    commitAs(userId, "select public.trash_task($1)", [task]);

  it("Undo leaves a next occurrence alone if it is in the Trash", async () => {
    const u = await newUser();
    const first = await seedTask(u, { repeats: true });
    const next = await completeFor(u, first);
    expect(next).not.toBeNull();
    await trashFor(u, next!);

    const reopened = (
      await commitAs<{ ok: boolean }>(u, "select public.reopen_task($1) as ok", [first])
    ).rows[0]!.ok;

    expect(reopened).toBe(true);
    expect(await stored(next!)).not.toBeNull();
  });

  it("Undo leaves a trashed next occurrence alone even if it was never edited", async () => {
    // Trashing normally counts as an edit, which already protects it. This copy was created straight
    // into the Trash, so only the explicit "not in the Trash" rule keeps it.
    const u = await newUser();
    const first = await seedTask(u, { repeats: true, completed: true });
    const next = await seedTask(u, { repeats: true, trashedDaysAgo: 1, recurredFrom: first });

    const reopened = (
      await commitAs<{ ok: boolean }>(u, "select public.reopen_task($1) as ok", [first])
    ).rows[0]!.ok;

    expect(reopened).toBe(true);
    expect(await stored(next)).not.toBeNull();
  });

  it("deleting the next occurrence ends the series: completing again creates no new one", async () => {
    const u = await newUser();
    const first = await seedTask(u, { repeats: true });
    const next = await completeFor(u, first);
    await trashFor(u, next!);
    await commitAs(u, "select public.reopen_task($1)", [first]);

    const again = await completeFor(u, first, "2026-10-30");

    expect(again).toBeNull();
    expect(
      await countOf("select count(*) as n from public.tasks where recurred_from = $1", [first]),
    ).toBe(1);
  });

  it("restoring the trashed occurrence carries the series on", async () => {
    const u = await newUser();
    const first = await seedTask(u, { repeats: true });
    const next = await completeFor(u, first);
    await trashFor(u, next!);
    await commitAs(u, "select public.restore_task($1)", [next]);

    const third = await completeFor(u, next!, "2026-10-30");

    expect(third).not.toBeNull();
  });

  it("trashing a repeating quest does not create or remove any other quest", async () => {
    const u = await newUser();
    const task = await seedTask(u, { repeats: true });
    await trashFor(u, task);
    expect(await countOf("select count(*) as n from public.tasks where user_id = $1", [u])).toBe(1);
  });
});
