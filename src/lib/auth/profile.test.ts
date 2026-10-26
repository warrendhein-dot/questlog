import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { ensureProfile } from "./profile";

function fakeClient(result: { error: { message: string } | null }) {
  const upsert = vi.fn().mockResolvedValue(result);
  const from = vi.fn(() => ({ upsert }));
  return { client: { from } as unknown as SupabaseClient, from, upsert };
}

describe("ensureProfile", () => {
  it("creates the profile for the user, leaving an existing one untouched", async () => {
    const { client, from, upsert } = fakeClient({ error: null });
    await ensureProfile(client, "user-1");
    expect(from).toHaveBeenCalledWith("profiles");
    expect(upsert).toHaveBeenCalledWith(
      { user_id: "user-1" },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
  });

  it("throws a generic error without leaking database details", async () => {
    const { client } = fakeClient({
      error: { message: 'new row violates policy "profiles_insert_own"' },
    });
    const attempt = ensureProfile(client, "user-1");
    await expect(attempt).rejects.toThrow("Could not create the user profile");
    await expect(attempt).rejects.not.toThrow(/policy|profiles_insert_own/);
  });
});
