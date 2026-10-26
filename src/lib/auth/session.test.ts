import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser } }),
}));
vi.mock("next/navigation", () => ({ redirect }));

beforeEach(() => {
  getUser.mockReset();
  redirect.mockClear();
});

describe("getCurrentUser", () => {
  it("returns the user Supabase validates", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@example.com" } } });
    const { getCurrentUser } = await import("./session");
    expect(await getCurrentUser()).toEqual({ id: "u1", email: "a@example.com" });
  });

  it("returns null when nobody is signed in", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { getCurrentUser } = await import("./session");
    expect(await getCurrentUser()).toBeNull();
  });
});

describe("requireUser", () => {
  it("returns the user when signed in", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const { requireUser } = await import("./session");
    expect(await requireUser()).toEqual({ id: "u1" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to /login instead of returning", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { requireUser } = await import("./session");
    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
