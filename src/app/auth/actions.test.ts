import { beforeEach, describe, expect, it, vi } from "vitest";

const signOutSupabase = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signOut: signOutSupabase } }),
}));
vi.mock("next/navigation", () => ({ redirect }));

beforeEach(() => {
  signOutSupabase.mockReset();
  redirect.mockClear();
});

describe("signOut action", () => {
  it("ends the Supabase session and then sends the user to /login", async () => {
    const { signOut } = await import("./actions");
    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(signOutSupabase).toHaveBeenCalledTimes(1);
  });
});
