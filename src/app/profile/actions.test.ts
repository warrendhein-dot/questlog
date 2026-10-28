import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUser, revalidatePath, upsert } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: () => ({ upsert }) }),
}));

import { saveTimeZone } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "user-1" });
  upsert.mockResolvedValue({ error: null });
});

describe("saveTimeZone", () => {
  it("saves a real time zone for the signed-in user, and refreshes the page", async () => {
    await saveTimeZone("Africa/Johannesburg");
    expect(upsert).toHaveBeenCalledWith(
      { user_id: "user-1", time_zone: "Africa/Johannesburg" },
      { onConflict: "user_id" },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("requires sign-in before doing anything", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(saveTimeZone("UTC")).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each(["", "Mars/Olympus_Mons", "'; drop table profiles; --", "x".repeat(65), 42, null])(
    "ignores %s, which is not a time zone",
    async (value) => {
      await saveTimeZone(value as string);
      expect(upsert).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("always uses the signed-in user's id, never one from the caller", async () => {
    await saveTimeZone("UTC");
    expect(upsert.mock.calls[0]![0]).toEqual({ user_id: "user-1", time_zone: "UTC" });
  });

  it("throws a generic error when the database refuses", async () => {
    upsert.mockResolvedValue({ error: { message: "secret detail" } });
    const attempt = saveTimeZone("UTC");
    await expect(attempt).rejects.toThrow("Could not save your time zone");
    await expect(attempt).rejects.not.toThrow(/secret/);
  });
});
