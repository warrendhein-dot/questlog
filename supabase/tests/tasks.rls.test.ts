// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDb, createUser } from "./helpers/db";

let db: PGlite;
let alice: string;
let bob: string;
let aliceTaskId: string;
let bobTaskId: string;

async function seedTask(userId: string, title: string) {
  const result = await db.query<{ id: string }>(
    "insert into public.tasks (user_id, title, category) values ($1, $2, 'work') returning id",
    [userId, title],
  );
  return result.rows[0]!.id;
}

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, "alice@example.com");
  bob = await createUser(db, "bob@example.com");
  // Setup runs as the database superuser, like Supabase's own backend would.
  aliceTaskId = await seedTask(alice, "Alice's quest");
  bobTaskId = await seedTask(bob, "Bob's quest");
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("tasks: who can see and change what", () => {
  it("shows a signed-in user only their own tasks", async () => {
    const rows = await asUser(
      db,
      alice,
      async (q) => (await q<{ title: string }>("select title from public.tasks")).rows,
    );
    expect(rows).toEqual([{ title: "Alice's quest" }]);
  });

  it("does not let a user read someone else's task by id", async () => {
    const rows = await asUser(
      db,
      alice,
      async (q) => (await q("select * from public.tasks where id = $1", [bobTaskId])).rows,
    );
    expect(rows).toEqual([]);
  });

  it("fills in the owner from the session when a user creates a task", async () => {
    const owner = await asUser(db, alice, async (q) => {
      const result = await q<{ user_id: string }>(
        "insert into public.tasks (title, category) values ('New quest', 'health') returning user_id",
      );
      return result.rows[0]!.user_id;
    });
    expect(owner).toBe(alice);
  });

  it("blocks choosing the owner when creating a task", async () => {
    await expect(
      asUser(db, alice, (q) =>
        q("insert into public.tasks (user_id, title, category) values ($1, 'Sneaky', 'work')", [
          bob,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it.each(["id", "completed_at", "created_at", "updated_at"])(
    "blocks setting %s when creating a task",
    async (column) => {
      const value = column === "id" ? "gen_random_uuid()" : "now()";
      await expect(
        asUser(db, alice, (q) =>
          q(`insert into public.tasks (title, category, ${column}) values ('X', 'work', ${value})`),
        ),
      ).rejects.toThrow(/permission denied/);
    },
  );

  it("silently ignores updates to someone else's task", async () => {
    const result = await asUser(db, alice, (q) =>
      q("update public.tasks set title = 'Hacked' where id = $1", [bobTaskId]),
    );
    expect(result.affectedRows).toBe(0);
    const bobs = await db.query<{ title: string }>("select title from public.tasks where id = $1", [
      bobTaskId,
    ]);
    expect(bobs.rows[0]!.title).toBe("Bob's quest");
  });

  it("lets a user edit and complete their own task, and undo the completion", async () => {
    const result = await asUser(db, alice, async (q) => {
      await q(
        "update public.tasks set title = 'Renamed', priority = 'high', due_date = '2026-12-24' where id = $1",
        [aliceTaskId],
      );
      await q("update public.tasks set completed_at = now() where id = $1", [aliceTaskId]);
      const done = await q<{ completed_at: string | null }>(
        "select completed_at from public.tasks where id = $1",
        [aliceTaskId],
      );
      await q("update public.tasks set completed_at = null where id = $1", [aliceTaskId]);
      const undone = await q<{ title: string; completed_at: string | null }>(
        "select title, completed_at from public.tasks where id = $1",
        [aliceTaskId],
      );
      return { done: done.rows[0]!.completed_at, undone: undone.rows[0]! };
    });
    expect(result.done).not.toBeNull();
    expect(result.undone).toEqual({ title: "Renamed", completed_at: null });
  });

  it.each(["user_id", "id", "created_at"])("never lets a user change %s", async (column) => {
    const value =
      column === "created_at" ? "now()" : column === "id" ? "gen_random_uuid()" : `'${bob}'`;
    await expect(
      asUser(db, alice, (q) =>
        q(`update public.tasks set ${column} = ${value} where id = $1`, [aliceTaskId]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("lets a user pin their own task to a day, and unpin it", async () => {
    const result = await asUser(db, alice, async (q) => {
      await q("update public.tasks set pinned_for = '2026-10-28' where id = $1", [aliceTaskId]);
      const pinned = await q<{ pinned_for: string | null }>(
        "select pinned_for::text from public.tasks where id = $1",
        [aliceTaskId],
      );
      await q("update public.tasks set pinned_for = null where id = $1", [aliceTaskId]);
      const unpinned = await q<{ pinned_for: string | null }>(
        "select pinned_for::text from public.tasks where id = $1",
        [aliceTaskId],
      );
      return { pinned: pinned.rows[0]!.pinned_for, unpinned: unpinned.rows[0]!.pinned_for };
    });
    expect(result).toEqual({ pinned: "2026-10-28", unpinned: null });
  });

  it("silently ignores pinning someone else's task", async () => {
    const result = await asUser(db, alice, (q) =>
      q("update public.tasks set pinned_for = '2026-10-28' where id = $1", [bobTaskId]),
    );
    expect(result.affectedRows).toBe(0);
    const bobs = await db.query<{ pinned_for: string | null }>(
      "select pinned_for::text from public.tasks where id = $1",
      [bobTaskId],
    );
    expect(bobs.rows[0]!.pinned_for).toBeNull();
  });

  it("starts unpinned, and cannot be pinned at creation", async () => {
    const pin = await asUser(db, alice, async (q) => {
      const result = await q<{ pinned_for: string | null }>(
        "insert into public.tasks (title, category) values ('Plain', 'work') returning pinned_for",
      );
      return result.rows[0]!.pinned_for;
    });
    expect(pin).toBeNull();
    await expect(
      asUser(db, alice, (q) =>
        q(
          "insert into public.tasks (title, category, pinned_for) values ('X', 'work', '2026-10-28')",
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it.each(["1999-12-31", "2101-01-01"])("rejects the implausible pin date %s", async (date) => {
    await expect(
      asUser(db, alice, (q) =>
        q("update public.tasks set pinned_for = $1 where id = $2", [date, aliceTaskId]),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("does not let users delete tasks (yet)", async () => {
    await expect(asUser(db, alice, (q) => q("delete from public.tasks"))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("gives signed-out visitors no access at all", async () => {
    await expect(asAnon(db, (q) => q("select * from public.tasks"))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asAnon(db, (q) => q("insert into public.tasks (title, category) values ('X', 'work')")),
    ).rejects.toThrow(/permission denied/);
  });

  it("keeps the rate-limit function out of reach of API users", async () => {
    await expect(
      asUser(db, alice, (q) => q("select public.enforce_task_rate_limit()")),
    ).rejects.toThrow(/permission denied/);
  });

  it("removes a user's tasks when the account is deleted", async () => {
    const carol = await createUser(db, "carol@example.com");
    await seedTask(carol, "Carol's quest");
    await db.query("delete from auth.users where id = $1", [carol]);
    const left = await db.query("select 1 from public.tasks where user_id = $1", [carol]);
    expect(left.rows).toEqual([]);
  });
});

describe("tasks: data rules", () => {
  const insert = (userId: string, sql: string, params: unknown[] = []) =>
    asUser(db, userId, (q) => q(sql, params));

  it("applies sensible defaults", async () => {
    const row = await asUser(db, alice, async (q) => {
      const result = await q<{
        priority: string;
        notes: string;
        due_date: string | null;
        completed_at: string | null;
      }>(
        "insert into public.tasks (title, category) values ('Plain', 'home') returning priority, notes, due_date, completed_at",
      );
      return result.rows[0]!;
    });
    expect(row).toEqual({ priority: "normal", notes: "", due_date: null, completed_at: null });
  });

  it.each([
    ["an empty title", "''"],
    ["a whitespace-only title", "'   '"],
    ["a title over 200 characters", `'${"x".repeat(201)}'`],
  ])("rejects %s", async (_label, title) => {
    await expect(
      insert(alice, `insert into public.tasks (title, category) values (${title}, 'work')`),
    ).rejects.toThrow(/check constraint/);
  });

  it("accepts a title of exactly 200 characters", async () => {
    await expect(
      insert(
        alice,
        `insert into public.tasks (title, category) values ('${"x".repeat(200)}', 'work')`,
      ),
    ).resolves.toBeDefined();
  });

  it("rejects notes over 5000 characters", async () => {
    await expect(
      insert(
        alice,
        `insert into public.tasks (title, category, notes) values ('T', 'work', '${"n".repeat(5001)}')`,
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("rejects a category or priority that does not exist", async () => {
    await expect(
      insert(alice, "insert into public.tasks (title, category) values ('T', 'combat')"),
    ).rejects.toThrow(/invalid input value for enum/);
    await expect(
      insert(
        alice,
        "insert into public.tasks (title, category, priority) values ('T', 'work', 'urgent')",
      ),
    ).rejects.toThrow(/invalid input value for enum/);
  });

  it.each(["1999-12-31", "2101-01-01"])("rejects the implausible due date %s", async (date) => {
    await expect(
      insert(
        alice,
        "insert into public.tasks (title, category, due_date) values ('T', 'work', $1)",
        [date],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("moves updated_at forward on every update", async () => {
    const before = await db.query<{ updated_at: string }>(
      "select updated_at from public.tasks where id = $1",
      [bobTaskId],
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = await asUser(db, bob, async (q) => {
      await q("update public.tasks set priority = 'low' where id = $1", [bobTaskId]);
      return (
        await q<{ updated_at: string }>("select updated_at from public.tasks where id = $1", [
          bobTaskId,
        ])
      ).rows[0]!;
    });
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0]!.updated_at).getTime(),
    );
  });
});

describe("tasks: creation rate limit", () => {
  const burst = (n: number) =>
    `insert into public.tasks (title, category) select 'Quest ' || g, 'work' from generate_series(1, ${n}) g`;

  it("allows 60 new tasks in a minute", async () => {
    const dave = await createUser(db, "dave@example.com");
    await expect(asUser(db, dave, (q) => q(burst(60)))).resolves.toBeDefined();
  });

  it("stops the 61st task in the same minute with a clear signal", async () => {
    const erin = await createUser(db, "erin@example.com");
    await expect(
      asUser(db, erin, async (q) => {
        await q(burst(60));
        return q("insert into public.tasks (title, category) values ('One too many', 'work')");
      }),
    ).rejects.toThrow(/task_rate_limit/);
  });

  it("counts only the caller's tasks, so one user cannot lock out another", async () => {
    const frank = await createUser(db, "frank@example.com");
    const gina = await createUser(db, "gina@example.com");
    await db.query(
      "insert into public.tasks (user_id, title, category) select $1, 'Quest ' || g, 'work' from generate_series(1, 60) g",
      [frank],
    );
    await expect(
      asUser(db, gina, (q) =>
        q("insert into public.tasks (title, category) values ('Fine', 'work')"),
      ),
    ).resolves.toBeDefined();
    await expect(
      asUser(db, frank, (q) =>
        q("insert into public.tasks (title, category) values ('Blocked', 'work')"),
      ),
    ).rejects.toThrow(/task_rate_limit/);
  });

  it("only counts the last minute, so the limit lifts by itself", async () => {
    const hank = await createUser(db, "hank@example.com");
    await db.query(
      `insert into public.tasks (user_id, title, category, created_at)
         select $1, 'Old ' || g, 'work', now() - interval '2 minutes' from generate_series(1, 60) g`,
      [hank],
    );
    await expect(
      asUser(db, hank, (q) =>
        q("insert into public.tasks (title, category) values ('Fresh', 'work')"),
      ),
    ).resolves.toBeDefined();
  });
});
