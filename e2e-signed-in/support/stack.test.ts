import { describe, expect, it } from "vitest";
import { parseStatusEnv, stackFromStatus } from "./stack";

const statusOutput = [
  'API_URL="http://127.0.0.1:54321"',
  'STUDIO_URL="http://127.0.0.1:54323"',
  'PUBLISHABLE_KEY="sb_publishable_test_test_test"',
  'SECRET_KEY="sb_secret_test_test_test"',
  'ANON_KEY="legacy-anon"',
  "",
].join("\n");

describe("parseStatusEnv", () => {
  it("reads KEY=value lines and strips the quotes", () => {
    expect(parseStatusEnv(statusOutput)).toMatchObject({
      API_URL: "http://127.0.0.1:54321",
      PUBLISHABLE_KEY: "sb_publishable_test_test_test",
    });
  });

  it("copes with Windows line endings, blank lines and unrelated text", () => {
    const vars = parseStatusEnv("Stopped services: [x]\r\n\r\nAPI_URL=http://127.0.0.1:54321\r\n");
    expect(vars).toEqual({ API_URL: "http://127.0.0.1:54321" });
  });
});

describe("stackFromStatus", () => {
  it("picks the URL, publishable key and secret key", () => {
    expect(stackFromStatus(parseStatusEnv(statusOutput))).toEqual({
      url: "http://127.0.0.1:54321",
      publishableKey: "sb_publishable_test_test_test",
      secretKey: "sb_secret_test_test_test",
    });
  });

  it("falls back to the legacy service-role name for the admin key", () => {
    const vars = {
      API_URL: "http://127.0.0.1:54321",
      PUBLISHABLE_KEY: "p",
      SERVICE_ROLE_KEY: "legacy",
    };
    expect(stackFromStatus(vars).secretKey).toBe("legacy");
  });

  it("does not accept the legacy anon key as a publishable key", () => {
    const vars = { API_URL: "http://127.0.0.1:54321", ANON_KEY: "legacy", SECRET_KEY: "s" };
    expect(() => stackFromStatus(vars)).toThrow(/PUBLISHABLE_KEY/);
  });

  it("says which variables are missing and lists the names found, never the values", () => {
    const vars = { SOME_NEW_NAME: "super-secret-value", API_URL: "http://127.0.0.1:54321" };
    try {
      stackFromStatus(vars);
      expect.unreachable("should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("PUBLISHABLE_KEY, SECRET_KEY");
      expect(message).toContain("API_URL, SOME_NEW_NAME");
      expect(message).not.toContain("super-secret-value");
    }
  });

  it("explains an entirely empty result", () => {
    expect(() => stackFromStatus({})).toThrow(/\(none\)/);
  });
});
