import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "./env";

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
