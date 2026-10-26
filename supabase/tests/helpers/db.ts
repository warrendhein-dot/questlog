import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Test database for row-level security (RLS) tests.
 *
 * PGlite is a real Postgres running inside the test process, so these tests need no cloud account
 * and no secrets, and run identically on a laptop and in CI. Supabase adds an `auth` schema and
 * two roles on top of plain Postgres; SUPABASE_SHIM recreates just those, so our real migrations
 * can run unchanged.
 */
const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;

  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);

  -- Same logic as Supabase: the signed-in user's id comes from the request's JWT claims.
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    )::uuid
  $$;

  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;

  -- Supabase hands every new public table to its API roles by default. Reproducing that makes the
  -- tests honest: a migration has to revoke access it does not want to give.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`;

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations");

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(await readFile(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

/** Creates a row in auth.users (as the superuser, like Supabase Auth does) and returns its id. */
export async function createUser(db: PGlite, email: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email],
  );
  return result.rows[0]!.id;
}

/**
 * Runs `fn` the way a request from a signed-in user would run: as the `authenticated` role, with
 * that user's id in the JWT claims. The transaction is rolled back afterwards, so tests don't leak
 * state into one another.
 */
export async function asUser<T>(
  db: PGlite,
  userId: string,
  fn: (query: PGlite["query"]) => Promise<T>,
): Promise<T> {
  return runAs(db, "authenticated", { sub: userId, role: "authenticated" }, fn);
}

/** Same, for a signed-out visitor (role `anon`, no user id). */
export async function asAnon<T>(
  db: PGlite,
  fn: (query: PGlite["query"]) => Promise<T>,
): Promise<T> {
  return runAs(db, "anon", { role: "anon" }, fn);
}

class Rollback extends Error {}

async function runAs<T>(
  db: PGlite,
  role: "anon" | "authenticated",
  claims: Record<string, string>,
  fn: (query: PGlite["query"]) => Promise<T>,
): Promise<T> {
  let output: T | undefined;
  let failure: unknown;
  try {
    await db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      try {
        output = await fn(tx.query.bind(tx) as PGlite["query"]);
      } catch (error) {
        failure = error;
      }
      // Always roll back: tests must not leak data into each other, pass or fail.
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  if (failure) throw failure;
  return output as T;
}
