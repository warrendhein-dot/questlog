import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { ensureProfile, getTimeZone } from "./profile";

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

describe("getTimeZone", () => {
  function selectClient(result: { data: unknown; error: { message: string } | null }) {
    const maybeSingle = vi.fn().mockResolvedValue(result);
    const select = vi.fn(() => ({ maybeSingle }));
    const from = vi.fn(() => ({ select }));
    return { client: { from } as unknown as SupabaseClient, from, select };
  }

  it("returns the time zone saved in the profile", async () => {
    const { client, from, select } = selectClient({
      data: { time_zone: "Africa/Johannesburg" },
      error: null,
    });
    expect(await getTimeZone(client)).toBe("Africa/Johannesburg");
    expect(from).toHaveBeenCalledWith("profiles");
    expect(select).toHaveBeenCalledWith("time_zone");
  });

  it("falls back to UTC when there is no profile yet", async () => {
    expect(await getTimeZone(selectClient({ data: null, error: null }).client)).toBe("UTC");
  });

  it("falls back to UTC when the saved name is not a real time zone", async () => {
    const { client } = selectClient({ data: { time_zone: "Mars/Olympus_Mons" }, error: null });
    expect(await getTimeZone(client)).toBe("UTC");
  });

  it("throws a generic error without leaking database details", async () => {
    const { client } = selectClient({
      data: null,
      error: { message: 'permission denied for table "profiles"' },
    });
    const attempt = getTimeZone(client);
    await expect(attempt).rejects.toThrow("Could not load your profile");
    await expect(attempt).rejects.not.toThrow(/permission|profiles"/);
  });
});
