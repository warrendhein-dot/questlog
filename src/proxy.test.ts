// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
let cookieAdapter: {
  getAll: () => unknown;
  setAll: (c: { name: string; value: string; options?: object }[]) => void;
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: typeof cookieAdapter }) => {
    cookieAdapter = options.cookies;
    return { auth: { getUser } };
  },
}));

const SIGNED_IN = { data: { user: { id: "user-1" } } };
const SIGNED_OUT = { data: { user: null } };

beforeEach(() => {
  vi.resetModules();
  getUser.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefgh.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
});

async function run(path: string, headers: Record<string, string> = {}) {
  const { proxy } = await import("./proxy");
  return proxy(new NextRequest(`http://localhost:3000${path}`, { headers }));
}

describe("proxy: signed-out visitors", () => {
  it("redirects a protected page to /login", async () => {
    getUser.mockResolvedValue(SIGNED_OUT);
    const response = await run("/");
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  });

  it("drops query strings on the way to /login, so nothing is smuggled along", async () => {
    getUser.mockResolvedValue(SIGNED_OUT);
    const response = await run("/tasks?next=https://evil.example");
    expect(new URL(response.headers.get("location")!).search).toBe("");
  });

  it.each(["/login", "/auth/callback"])("lets them open the public path %s", async (path) => {
    getUser.mockResolvedValue(SIGNED_OUT);
    const response = await run(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not treat a look-alike path as public", async () => {
    getUser.mockResolvedValue(SIGNED_OUT);
    const response = await run("/login/../tasks");
    expect(response.status).toBe(307);
  });
});

describe("proxy: signed-in users", () => {
  it("lets them through to protected pages", async () => {
    getUser.mockResolvedValue(SIGNED_IN);
    const response = await run("/tasks");
    expect(response.status).toBe(200);
  });

  it("asks Supabase to validate the session instead of trusting the cookie", async () => {
    getUser.mockResolvedValue(SIGNED_IN);
    await run("/", { cookie: "sb-abcdefgh-auth-token=forged" });
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it("passes refreshed session cookies back to the browser", async () => {
    getUser.mockImplementation(async () => {
      cookieAdapter.setAll([{ name: "sb-token", value: "fresh", options: { path: "/" } }]);
      return SIGNED_IN;
    });
    const response = await run("/");
    expect(response.cookies.get("sb-token")?.value).toBe("fresh");
  });

  it("keeps cookie changes when redirecting an expired session to /login", async () => {
    getUser.mockImplementation(async () => {
      cookieAdapter.setAll([{ name: "sb-token", value: "", options: { path: "/", maxAge: 0 } }]);
      return SIGNED_OUT;
    });
    const response = await run("/");
    expect(response.status).toBe(307);
    expect(response.cookies.get("sb-token")).toBeDefined();
  });

  it("reads the session from the request's cookies", async () => {
    getUser.mockResolvedValue(SIGNED_IN);
    await run("/", { cookie: "sb-token=abc" });
    expect(cookieAdapter.getAll()).toEqual([{ name: "sb-token", value: "abc" }]);
  });
});

describe("proxy: security policy", () => {
  it.each([
    ["a page", "/"],
    ["the login page", "/login"],
  ])("sets a nonce-based CSP on %s", async (_label, path) => {
    getUser.mockResolvedValue(SIGNED_OUT);
    const csp = (await run(path)).headers.get("content-security-policy")!;
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).toContain("connect-src 'self' https://abcdefgh.supabase.co");
  });

  it("uses a different nonce for every request", async () => {
    getUser.mockResolvedValue(SIGNED_OUT);
    const nonceOf = async () =>
      (await run("/login")).headers.get("content-security-policy")!.match(/nonce-([^']+)/)![1];
    expect(await nonceOf()).not.toBe(await nonceOf());
  });

  it("applies the policy to redirects as well", async () => {
    getUser.mockResolvedValue(SIGNED_OUT);
    const response = await run("/");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("fails closed when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    await expect(run("/")).rejects.toThrow(/Invalid environment configuration/);
  });

  it("skips build assets but covers every page", async () => {
    const { config } = await import("./proxy");
    const pattern = new RegExp(`^${config.matcher[0]}$`);
    expect(pattern.test("/")).toBe(true);
    expect(pattern.test("/login")).toBe(true);
    expect(pattern.test("/_next/static/chunks/app.js")).toBe(false);
    expect(pattern.test("/favicon.ico")).toBe(false);
  });
});
