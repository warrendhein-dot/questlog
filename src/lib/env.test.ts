import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv, parseSupabaseEnv } from "./env";

describe("getEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reads process.env and returns the validated config", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://questlog.example");
    const { getEnv } = await import("./env");
    expect(getEnv().NEXT_PUBLIC_APP_URL).toBe("https://questlog.example");
  });

  it("caches the result after the first call", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://first.example");
    const { getEnv } = await import("./env");
    const first = getEnv();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://second.example");
    expect(getEnv()).toBe(first);
  });

  it("throws when the environment is invalid", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "not-a-url");
    const { getEnv } = await import("./env");
    expect(() => getEnv()).toThrow(/NEXT_PUBLIC_APP_URL/);
  });
});

describe("parseEnv", () => {
  it("applies safe defaults when nothing is set", () => {
    expect(parseEnv({})).toEqual({
      NODE_ENV: "development",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    });
  });

  it("accepts valid values", () => {
    const env = parseEnv({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://questlog.app" });
    expect(env.NODE_ENV).toBe("production");
    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://questlog.app");
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => parseEnv({ NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });

  it.each(["not-a-url", "javascript:alert(1)", "ftp://example.com"])(
    "rejects %s as the app URL",
    (value) => {
      expect(() => parseEnv({ NEXT_PUBLIC_APP_URL: value })).toThrow(/NEXT_PUBLIC_APP_URL/);
    },
  );

  it("never includes the offending value in the error message", () => {
    const secretish = "javascript:steal(super-secret-token)";
    try {
      parseEnv({ NEXT_PUBLIC_APP_URL: secretish });
      expect.unreachable("parseEnv should have thrown");
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret-token");
    }
  });
});

describe("parseSupabaseEnv", () => {
  const valid = {
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
  };

  it("accepts a project URL and a publishable key", () => {
    expect(parseSupabaseEnv(valid)).toEqual(valid);
  });

  it("requires both variables", () => {
    expect(() => parseSupabaseEnv({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() =>
      parseSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: valid.NEXT_PUBLIC_SUPABASE_URL }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("rejects a plain-http project URL", () => {
    expect(() =>
      parseSupabaseEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "http://abcdefgh.supabase.co" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it.each(["http://127.0.0.1:54321", "http://localhost:54321"])(
    "allows plain http for this computer only (%s), for the throwaway test stack",
    (url) => {
      expect(parseSupabaseEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: url })).toMatchObject({
        NEXT_PUBLIC_SUPABASE_URL: url,
      });
    },
  );

  it.each([
    "http://localhost.evil.example",
    "http://127.0.0.1.evil.example",
    "http://evil.example/localhost",
    "http://user@evil.example@localhost",
    "https://user:password@abcdefgh.supabase.co",
    "ftp://127.0.0.1",
    "javascript:alert(1)",
  ])("does not let %s pass as a local address", (url) => {
    expect(() => parseSupabaseEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: url })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });

  it("rejects a secret key in the public key slot, without echoing it", () => {
    const leaked = "sb_secret_do-not-print-this";
    try {
      parseSupabaseEnv({ ...valid, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: leaked });
      expect.unreachable("a secret key must be rejected");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
      expect(message).not.toContain("do-not-print-this");
    }
  });
});

describe("getSupabaseEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reads the Supabase variables from process.env", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefgh.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
    const { getSupabaseEnv } = await import("./env");
    const first = getSupabaseEnv();
    expect(first.NEXT_PUBLIC_SUPABASE_URL).toBe("https://abcdefgh.supabase.co");
    expect(getSupabaseEnv()).toBe(first);
  });

  it("throws a clear error when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const { getSupabaseEnv } = await import("./env");
    expect(() => getSupabaseEnv()).toThrow(/Invalid environment configuration/);
  });
});
