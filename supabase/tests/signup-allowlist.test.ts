// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asAuthService, asUser, createTestDb, createUser } from "./helpers/db";

let db: PGlite;

/** The payload shape Supabase sends to a "Before User Created" hook (only the fields we use). */
function signupEvent(email: string | null, provider: string) {
  return JSON.stringify({
    user: { email, app_metadata: { provider, providers: [provider] } },
  });
}

async function runHook(event: string) {
  const result = await asAuthService(db, (q) =>
    q<{ hook: unknown }>("select public.hook_restrict_signup($1::jsonb) as hook", [event]),
  );
  return result.rows[0]!.hook as { error?: { http_code: number; message: string } };
}

beforeAll(async () => {
  db = await createTestDb();
  await db.query("insert into public.allowed_emails (email) values ('owner@example.com')");
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("sign-up allow-list hook", () => {
  it("lets the allow-listed Google account sign up", async () => {
    expect(await runHook(signupEvent("owner@example.com", "google"))).toEqual({});
  });

  it("matches the address case-insensitively", async () => {
    expect(await runHook(signupEvent("Owner@Example.COM", "google"))).toEqual({});
  });

  it("rejects any other Google account with a 403", async () => {
    const result = await runHook(signupEvent("stranger@example.com", "google"));
    expect(result.error?.http_code).toBe(403);
    expect(result.error?.message).toMatch(/not allowed/);
  });

  it("rejects the owner's address when it comes through email/password sign-up", async () => {
    // Blocks "pre-hijacking": registering the owner's email by another route.
    const result = await runHook(signupEvent("owner@example.com", "email"));
    expect(result.error?.http_code).toBe(403);
  });

  it("rejects a sign-up with no email address", async () => {
    expect((await runHook(signupEvent(null, "google"))).error?.http_code).toBe(403);
  });

  it("does not leak whether an address is on the list", async () => {
    const unknown = await runHook(signupEvent("stranger@example.com", "google"));
    const wrongProvider = await runHook(signupEvent("owner@example.com", "email"));
    expect(unknown).toEqual(wrongProvider);
  });
});

describe("allow-list privacy", () => {
  it("cannot be read or edited by signed-in users or visitors", async () => {
    const user = await createUser(db, "someone@example.com");
    await expect(asUser(db, user, (q) => q("select * from public.allowed_emails"))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asUser(db, user, (q) =>
        q("insert into public.allowed_emails (email) values ('me@example.com')"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (q) => q("select * from public.allowed_emails"))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("cannot be read directly by the auth service either (only through the hook)", async () => {
    await expect(
      asAuthService(db, (q) => q("select * from public.allowed_emails")),
    ).rejects.toThrow(/permission denied/);
  });

  it("only accepts lower-case, plausible email values", async () => {
    await expect(
      db.query("insert into public.allowed_emails (email) values ('Mixed@Example.com')"),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query("insert into public.allowed_emails (email) values ('a')"),
    ).rejects.toThrow(/check constraint/);
  });

  it("keeps the hook function callable only by the auth service", async () => {
    const user = await createUser(db, "other@example.com");
    const call = "select public.hook_restrict_signup('{}'::jsonb)";
    await expect(asUser(db, user, (q) => q(call))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (q) => q(call))).rejects.toThrow(/permission denied/);
  });
});
