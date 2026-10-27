// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDb, createUser } from "./helpers/db";

let db: PGlite;
let alice: string;
let bob: string;
let aliceTaskId: string;
let bobTaskId: string;
let aliceStepId: string;
let bobStepId: string;

async function seedTask(userId: string, title: string) {
  const result = await db.query<{ id: string }>(
    "insert into public.tasks (user_id, title, category) values ($1, $2, 'work') returning id",
    [userId, title],
  );
  return result.rows[0]!.id;
}

async function seedStep(userId: string, taskId: string, title: string) {
  const result = await db.query<{ id: string }>(
    "insert into public.subtasks (user_id, task_id, title) values ($1, $2, $3) returning id",
    [userId, taskId, title],
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
  aliceStepId = await seedStep(alice, aliceTaskId, "Alice's step");
  bobStepId = await seedStep(bob, bobTaskId, "Bob's step");
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("subtasks: who can see and change what", () => {
  it("shows a signed-in user only their own steps", async () => {
    const rows = await asUser(
      db,
      alice,
      async (q) => (await q<{ title: string }>("select title from public.subtasks")).rows,
    );
    expect(rows).toEqual([{ title: "Alice's step" }]);
  });

  it("does not let a user read someone else's step by id", async () => {
    const rows = await asUser(
      db,
      alice,
      async (q) => (await q("select * from public.subtasks where id = $1", [bobStepId])).rows,
    );
    expect(rows).toEqual([]);
  });

  it("fills in the owner from the session when a user adds a step", async () => {
    const owner = await asUser(db, alice, async (q) => {
      const result = await q<{ user_id: string }>(
        "insert into public.subtasks (task_id, title) values ($1, 'New step') returning user_id",
        [aliceTaskId],
      );
      return result.rows[0]!.user_id;
    });
    expect(owner).toBe(alice);
  });

  it("blocks choosing the owner when adding a step", async () => {
    await expect(
      asUser(db, alice, (q) =>
        q("insert into public.subtasks (user_id, task_id, title) values ($1, $2, 'Sneaky')", [
          bob,
          aliceTaskId,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it.each(["id", "completed_at", "created_at", "updated_at"])(
    "blocks setting %s when adding a step",
    async (column) => {
      const value = column === "id" ? "gen_random_uuid()" : "now()";
      await expect(
        asUser(db, alice, (q) =>
          q(`insert into public.subtasks (task_id, title, ${column}) values ($1, 'X', ${value})`, [
            aliceTaskId,
          ]),
        ),
      ).rejects.toThrow(/permission denied/);
    },
  );

  it("refuses to hang a step on someone else's quest", async () => {
    await expect(
      asUser(db, alice, (q) =>
        q("insert into public.subtasks (task_id, title) values ($1, 'Intruder')", [bobTaskId]),
      ),
    ).rejects.toThrow(/foreign key/);
    const bobs = await db.query("select 1 from public.subtasks where title = 'Intruder'");
    expect(bobs.rows).toEqual([]);
  });

  it("gives the same answer for someone else's quest as for one that does not exist", async () => {
    const attempt = (taskId: string) =>
      asUser(db, alice, (q) =>
        q("insert into public.subtasks (task_id, title) values ($1, 'Probe')", [taskId]),
      ).then(
        () => "accepted",
        (error: Error) => error.message.replace(taskId, "<id>"),
      );
    const someoneElses = await attempt(bobTaskId);
    const missing = await attempt("00000000-0000-4000-8000-000000000000");
    expect(someoneElses).toBe(missing);
  });

  it("silently ignores updates to someone else's step", async () => {
    const result = await asUser(db, alice, (q) =>
      q("update public.subtasks set title = 'Hacked' where id = $1", [bobStepId]),
    );
    expect(result.affectedRows).toBe(0);
    const bobs = await db.query<{ title: string }>(
      "select title from public.subtasks where id = $1",
      [bobStepId],
    );
    expect(bobs.rows[0]!.title).toBe("Bob's step");
  });

  it("silently ignores deleting someone else's step", async () => {
    const result = await asUser(db, alice, (q) =>
      q("delete from public.subtasks where id = $1", [bobStepId]),
    );
    expect(result.affectedRows).toBe(0);
    const bobs = await db.query("select 1 from public.subtasks where id = $1", [bobStepId]);
    expect(bobs.rows).toHaveLength(1);
  });

  it("lets a user rename, complete, undo and delete their own step", async () => {
    const result = await asUser(db, alice, async (q) => {
      await q("update public.subtasks set title = 'Renamed' where id = $1", [aliceStepId]);
      await q("update public.subtasks set completed_at = now() where id = $1", [aliceStepId]);
      const done = await q<{ completed_at: string | null }>(
        "select completed_at from public.subtasks where id = $1",
        [aliceStepId],
      );
      await q("update public.subtasks set completed_at = null where id = $1", [aliceStepId]);
      const undone = await q<{ title: string; completed_at: string | null }>(
        "select title, completed_at from public.subtasks where id = $1",
        [aliceStepId],
      );
      const removed = await q("delete from public.subtasks where id = $1", [aliceStepId]);
      return { done: done.rows[0]!.completed_at, undone: undone.rows[0]!, removed };
    });
    expect(result.done).not.toBeNull();
    expect(result.undone).toEqual({ title: "Renamed", completed_at: null });
    expect(result.removed.affectedRows).toBe(1);
  });

  it.each(["user_id", "task_id", "id", "created_at"])(
    "never lets a user change %s",
    async (column) => {
      const value =
        column === "created_at"
          ? "now()"
          : column === "id"
            ? "gen_random_uuid()"
            : `'${column === "user_id" ? bob : bobTaskId}'`;
      await expect(
        asUser(db, alice, (q) =>
          q(`update public.subtasks set ${column} = ${value} where id = $1`, [aliceStepId]),
        ),
      ).rejects.toThrow(/permission denied/);
    },
  );

  it("gives signed-out visitors no access at all", async () => {
    await expect(asAnon(db, (q) => q("select * from public.subtasks"))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asAnon(db, (q) =>
        q("insert into public.subtasks (task_id, title) values ($1, 'X')", [aliceTaskId]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (q) => q("delete from public.subtasks"))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("keeps the limits function out of reach of API users", async () => {
    await expect(
      asUser(db, alice, (q) => q("select public.enforce_subtask_limits()")),
    ).rejects.toThrow(/permission denied/);
  });

  it("removes a quest's steps when the quest is deleted", async () => {
    const carol = await createUser(db, "carol@example.com");
    const task = await seedTask(carol, "Carol's quest");
    await seedStep(carol, task, "Carol's step");
    await db.query("delete from public.tasks where id = $1", [task]);
    const left = await db.query("select 1 from public.subtasks where task_id = $1", [task]);
    expect(left.rows).toEqual([]);
  });

  it("removes a user's steps when the account is deleted", async () => {
    const dora = await createUser(db, "dora@example.com");
    await seedStep(dora, await seedTask(dora, "Dora's quest"), "Dora's step");
    await db.query("delete from auth.users where id = $1", [dora]);
    const left = await db.query("select 1 from public.subtasks where user_id = $1", [dora]);
    expect(left.rows).toEqual([]);
  });
});

describe("subtasks: data rules", () => {
  const insert = (userId: string, title: string, taskId = aliceTaskId) =>
    asUser(db, userId, (q) =>
      q("insert into public.subtasks (task_id, title) values ($1, $2)", [taskId, title]),
    );

  it("applies sensible defaults", async () => {
    const row = await asUser(db, alice, async (q) => {
      const result = await q<{ completed_at: string | null }>(
        "insert into public.subtasks (task_id, title) values ($1, 'Plain') returning completed_at",
        [aliceTaskId],
      );
      return result.rows[0]!;
    });
    expect(row).toEqual({ completed_at: null });
  });

  it.each([
    ["an empty title", ""],
    ["a whitespace-only title", "   "],
    ["a title over 200 characters", "x".repeat(201)],
  ])("rejects %s", async (_label, title) => {
    await expect(insert(alice, title)).rejects.toThrow(/check constraint/);
  });

  it("accepts a title of exactly 200 characters", async () => {
    await expect(insert(alice, "x".repeat(200))).resolves.toBeDefined();
  });

  it("moves updated_at forward on every update", async () => {
    const id = await seedStep(bob, bobTaskId, "Tick tock");
    const before = await db.query<{ updated_at: string }>(
      "select updated_at from public.subtasks where id = $1",
      [id],
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = await asUser(db, bob, async (q) => {
      await q("update public.subtasks set title = 'Tock' where id = $1", [id]);
      return (
        await q<{ updated_at: string }>("select updated_at from public.subtasks where id = $1", [
          id,
        ])
      ).rows[0]!;
    });
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0]!.updated_at).getTime(),
    );
  });
});

describe("subtasks: limits", () => {
  const fill = (userId: string, taskId: string, n: number, createdAt = "now()") =>
    db.query(
      `insert into public.subtasks (user_id, task_id, title, created_at)
         select $1, $2, 'Step ' || g, ${createdAt} from generate_series(1, ${n}) g`,
      [userId, taskId],
    );
  const add = (userId: string, taskId: string) =>
    asUser(db, userId, (q) =>
      q("insert into public.subtasks (task_id, title) values ($1, 'One more')", [taskId]),
    );

  it("allows 50 steps on a quest and stops the 51st", async () => {
    const erin = await createUser(db, "erin@example.com");
    const task = await seedTask(erin, "Big quest");
    await fill(erin, task, 49);
    await expect(add(erin, task)).resolves.toBeDefined(); // the 50th
    // asUser rolls back, so the 50th above was not kept: top the quest up to exactly 50 for real.
    await fill(erin, task, 1);
    await expect(add(erin, task)).rejects.toThrow(/subtask_limit/);
  });

  it("counts steps per quest, so a full quest does not block the others", async () => {
    const frank = await createUser(db, "frank@example.com");
    const full = await seedTask(frank, "Full quest");
    const other = await seedTask(frank, "Other quest");
    await fill(frank, full, 50);
    await expect(add(frank, full)).rejects.toThrow(/subtask_limit/);
    await expect(add(frank, other)).resolves.toBeDefined();
  });

  it("stops a 121st new step in a minute, across quests", async () => {
    const gina = await createUser(db, "gina@example.com");
    const tasks = [await seedTask(gina, "A"), await seedTask(gina, "B"), await seedTask(gina, "C")];
    await fill(gina, tasks[0]!, 50);
    await fill(gina, tasks[1]!, 50);
    await fill(gina, tasks[2]!, 20); // 120 in the last minute
    await expect(add(gina, tasks[2]!)).rejects.toThrow(/subtask_rate_limit/);
  });

  it("counts only the caller's steps, so one user cannot lock out another", async () => {
    const hank = await createUser(db, "hank@example.com");
    const ivy = await createUser(db, "ivy@example.com");
    const hanksTasks = [
      await seedTask(hank, "A"),
      await seedTask(hank, "B"),
      await seedTask(hank, "C"),
    ];
    await fill(hank, hanksTasks[0]!, 50);
    await fill(hank, hanksTasks[1]!, 50);
    await fill(hank, hanksTasks[2]!, 20);
    const ivysTask = await seedTask(ivy, "Ivy's quest");
    await expect(add(ivy, ivysTask)).resolves.toBeDefined();
    await expect(add(hank, hanksTasks[2]!)).rejects.toThrow(/subtask_rate_limit/);
  });

  it("only counts the last minute, so the rate limit lifts by itself", async () => {
    const jo = await createUser(db, "jo@example.com");
    const tasks = [await seedTask(jo, "A"), await seedTask(jo, "B"), await seedTask(jo, "C")];
    await fill(jo, tasks[0]!, 40, "now() - interval '2 minutes'");
    await fill(jo, tasks[1]!, 40, "now() - interval '2 minutes'");
    await fill(jo, tasks[2]!, 40, "now() - interval '2 minutes'");
    await expect(add(jo, tasks[2]!)).resolves.toBeDefined();
  });
});
