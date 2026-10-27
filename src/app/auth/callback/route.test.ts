// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();
const signOut = vi.fn();
const ensureProfile = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { exchangeCodeForSession, signOut } }),
}));
vi.mock("@/lib/auth/profile", () => ({ ensureProfile }));

const APP = "https://questlog.example";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP);
  exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  ensureProfile.mockResolvedValue(undefined);
});

async function callback(url: string) {
  const { GET } = await import("./route");
  return GET(new Request(url));
}

const location = (response: Response) => response.headers.get("location");

describe("GET /auth/callback", () => {
  it("signs in, creates the profile and goes home", async () => {
    const response = await callback(`${APP}/auth/callback?code=good-code`);
    expect(exchangeCodeForSession).toHaveBeenCalledWith("good-code");
    expect(ensureProfile).toHaveBeenCalledWith(expect.anything(), "user-1");
    expect(location(response)).toBe(`${APP}/`);
  });

  it("returns to the login page with an error when there is no code", async () => {
    const response = await callback(`${APP}/auth/callback?error=access_denied`);
    expect(location(response)).toBe(`${APP}/login?error=signin_failed`);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("returns to the login page when the code is rejected", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: new Error("bad") });
    const response = await callback(`${APP}/auth/callback?code=stale`);
    expect(location(response)).toBe(`${APP}/login?error=signin_failed`);
    expect(ensureProfile).not.toHaveBeenCalled();
  });

  it("signs the user back out if their profile cannot be created", async () => {
    ensureProfile.mockRejectedValue(new Error("boom"));
    const response = await callback(`${APP}/auth/callback?code=good-code`);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(location(response)).toBe(`${APP}/login?error=signin_failed`);
  });

  it("always redirects to the configured app URL, even if the request claims another host", async () => {
    const response = await callback("https://evil.example/auth/callback?code=good-code");
    expect(new URL(location(response)!).origin).toBe(APP);
  });

  it("ignores any attempt to choose the destination", async () => {
    const response = await callback(
      `${APP}/auth/callback?code=good-code&next=https://evil.example&redirect_to=//evil.example`,
    );
    expect(location(response)).toBe(`${APP}/`);
  });
});
