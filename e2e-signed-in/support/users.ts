import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadLocalStack } from "./stack";

export type TestUser = { id: string; email: string; password: string };

const NO_SESSION_STORAGE = { auth: { autoRefreshToken: false, persistSession: false } };

/**
 * Creates a brand-new user in the throwaway stack. Every test gets its own, so tests cannot
 * interfere with each other and nothing needs cleaning up afterwards.
 */
export async function createTestUser(): Promise<TestUser> {
  const stack = loadLocalStack();
  const admin = createClient(stack.url, stack.secretKey, NO_SESSION_STORAGE);
  // example.test is a reserved name that can never be a real address.
  const email = `e2e-${randomUUID()}@example.test`;
  const password = randomUUID();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error("Could not create a test user in the local Supabase stack");
  return { id: data.user.id, email, password };
}

/**
 * A client that acts as this user, with the same limits the app has: it uses the publishable key
 * plus the user's own session, so row-level security applies exactly as it does in the app.
 */
export async function clientFor(user: TestUser): Promise<SupabaseClient> {
  const stack = loadLocalStack();
  const client = createClient(stack.url, stack.publishableKey, NO_SESSION_STORAGE);
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw new Error("The test user could not sign in");
  return client;
}
