import { describe, expect, it } from "vitest";
import { buildCsp, generateNonce } from "./csp";

const base = { nonce: "abc123", isDev: false, supabaseOrigin: "https://abcdefgh.supabase.co" };

describe("generateNonce", () => {
  it("produces a different unguessable value every time", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => generateNonce()));
    expect(nonces.size).toBe(50);
  });

  it("is base64 of 16 random bytes, safe to put inside a header", () => {
    expect(generateNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe("buildCsp", () => {
  const directive = (csp: string, name: string) =>
    csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

  it("ties scripts and styles to the request's nonce", () => {
    const csp = buildCsp(base);
    expect(directive(csp, "script-src")).toContain("'nonce-abc123'");
    expect(directive(csp, "style-src")).toContain("'nonce-abc123'");
  });

  it("never allows inline scripts or styles without a nonce", () => {
    const csp = buildCsp(base);
    expect(directive(csp, "script-src")).not.toContain("'unsafe-inline'");
    expect(directive(csp, "style-src")).not.toContain("'unsafe-inline'");
    expect(directive(csp, "script-src")).not.toContain("'unsafe-eval'");
  });

  it("blocks framing, plugins and base-tag tricks, and limits form targets", () => {
    const csp = buildCsp(base);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("allows the app and its own Supabase project for network calls, and nothing else", () => {
    expect(directive(buildCsp(base), "connect-src")).toBe(
      "connect-src 'self' https://abcdefgh.supabase.co",
    );
  });

  it("forces https in production only", () => {
    expect(buildCsp(base)).toContain("upgrade-insecure-requests");
    expect(buildCsp({ ...base, isDev: true })).not.toContain("upgrade-insecure-requests");
  });

  it("relaxes only what Next's dev tooling needs in development", () => {
    const csp = buildCsp({ ...base, isDev: true });
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(directive(csp, "connect-src")).toContain("ws:");
    expect(directive(csp, "style-src")).toBe("style-src 'self' 'unsafe-inline'");
    // Scripts stay strict even in development.
    expect(directive(csp, "script-src")).not.toContain("'unsafe-inline'");
  });

  it("keeps styles nonce-only in production", () => {
    expect(directive(buildCsp(base), "style-src")).toBe("style-src 'self' 'nonce-abc123'");
  });
});
