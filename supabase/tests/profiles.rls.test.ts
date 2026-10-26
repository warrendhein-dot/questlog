// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDb, createUser } from "./helpers/db";

let db: PGlite;
let alice: string;
let bob: string;

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, "alice@example.com");
  bob = await createUser(db, "bob@example.com");
  // Setup runs as the database superuser, like Supabase's own backend would.
  await db.query(
    "insert into public.profiles (user_id, time_zone) values ($1, 'Africa/Johannesburg')",
    [alice],
  );
  await db.query(
    "insert into public.profiles (user_id, time_zone) values ($1, 'America/New_York')",
    [bob],
  );
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("profiles: row-level security", () => {
  it("is switched on for every table in the public schema", async () => {
    // A guard for the future: any new table that forgets RLS fails this test.
    const result = await db.query<{ tablename: string }>(
      `select c.relname as tablename
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(result.rows).toEqual([]);
  });

  it("shows a signed-in user only their own profile", async () => {
    const rows = await asUser(
      db,
      alice,
      async (q) => (await q("select user_id, time_zone from public.profiles")).rows,
    );
    expect(rows).toEqual([{ user_id: alice, time_zone: "Africa/Johannesburg" }]);
  });

  it("does not let a user read another user's profile by id", async () => {
    const rows = await asUser(
      db,
      alice,
      async (q) => (await q("select * from public.profiles where user_id = $1", [bob])).rows,
    );
    expect(rows).toEqual([]);
  });

  it("lets a user create their own profile", async () => {
    const carol = await createUser(db, "carol@example.com");
    const rows = await asUser(db, carol, async (q) => {
      await q("insert into public.profiles (user_id) values ($1)", [carol]);
      return (await q("select time_zone, week_starts_on from public.profiles")).rows;
    });
    expect(rows).toEqual([{ time_zone: "UTC", week_starts_on: "monday" }]);
  });

  it("blocks creating a profile on behalf of someone else", async () => {
    const dave = await createUser(db, "dave@example.com");
    await expect(
      asUser(db, alice, (q) => q("insert into public.profiles (user_id) values ($1)", [dave])),
    ).rejects.toThrow(/row-level security/);
  });

  it("silently ignores updates to another user's profile", async () => {
    const result = await asUser(db, alice, (q) =>
      q("update public.profiles set time_zone = 'UTC' where user_id = $1", [bob]),
    );
    expect(result.affectedRows).toBe(0);
    const bobsZone = await db.query<{ time_zone: string }>(
      "select time_zone from public.profiles where user_id = $1",
      [bob],
    );
    expect(bobsZone.rows[0]!.time_zone).toBe("America/New_York");
  });

  it("blocks handing your own profile to another user", async () => {
    await expect(
      asUser(db, alice, (q) =>
        q("update public.profiles set user_id = $1 where user_id = $2", [bob, alice]),
      ),
    ).rejects.toThrow(/row-level security|duplicate key/);
  });

  it("lets a user update their own settings", async () => {
    const rows = await asUser(db, alice, async (q) => {
      await q("update public.profiles set time_zone = 'Europe/London' where user_id = $1", [alice]);
      return (await q("select time_zone from public.profiles")).rows;
    });
    expect(rows).toEqual([{ time_zone: "Europe/London" }]);
  });

  it("never lets a user delete a profile", async () => {
    await expect(asUser(db, alice, (q) => q("delete from public.profiles"))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("gives signed-out visitors no access at all", async () => {
    await expect(asAnon(db, (q) => q("select * from public.profiles"))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asAnon(db, (q) => q("insert into public.profiles (user_id) values (gen_random_uuid())")),
    ).rejects.toThrow(/permission denied/);
  });

  it("does not let API roles call the updated_at trigger function directly", async () => {
    await expect(asUser(db, alice, (q) => q("select public.set_updated_at()"))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("profiles: data rules", () => {
  it("rejects an empty or oversized time zone", async () => {
    const eve = await createUser(db, "eve@example.com");
    await expect(
      asUser(db, eve, (q) =>
        q("insert into public.profiles (user_id, time_zone) values ($1, '')", [eve]),
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      asUser(db, eve, (q) =>
        q("insert into public.profiles (user_id, time_zone) values ($1, $2)", [
          eve,
          "x".repeat(65),
        ]),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("rejects an unsupported week start", async () => {
    const frank = await createUser(db, "frank@example.com");
    await expect(
      asUser(db, frank, (q) =>
        q("insert into public.profiles (user_id, week_starts_on) values ($1, 'sunday')", [frank]),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("moves updated_at forward on every update", async () => {
    const before = await db.query<{ created_at: string; updated_at: string }>(
      "select created_at, updated_at from public.profiles where user_id = $1",
      [bob],
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = await asUser(db, bob, async (q) => {
      await q("update public.profiles set time_zone = 'Asia/Tokyo' where user_id = $1", [bob]);
      return (await q<{ updated_at: string }>("select updated_at from public.profiles")).rows[0]!;
    });
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0]!.updated_at).getTime(),
    );
  });

  it("removes the profile when the account is deleted", async () => {
    const gina = await createUser(db, "gina@example.com");
    await db.query("insert into public.profiles (user_id) values ($1)", [gina]);
    await db.query("delete from auth.users where id = $1", [gina]);
    const left = await db.query("select 1 from public.profiles where user_id = $1", [gina]);
    expect(left.rows).toEqual([]);
  });
});
