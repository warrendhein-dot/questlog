import { describe, expect, it } from "vitest";
import { nonceOf, parseCsp, runChecks, type Probe, type Snapshot } from "./live-check";

const ORIGIN = "https://questlog.example";

function csp(nonce: string, overrides: Record<string, string> = {}): string {
  const directives: Record<string, string> = {
    "default-src": "'self'",
    "script-src": `'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src": `'self' 'nonce-${nonce}'`,
    "img-src": "'self' data: blob:",
    "font-src": "'self'",
    "connect-src": "'self' https://abc.supabase.co",
    "object-src": "'none'",
    "base-uri": "'self'",
    "form-action": "'self'",
    "frame-ancestors": "'none'",
    "upgrade-insecure-requests": "",
    ...overrides,
  };
  return Object.entries(directives)
    .map(([name, value]) => `${name} ${value}`.trim())
    .join("; ");
}

const NONCE_A = "aaaaaaaaaaaaaaaaaaaaaa==";
const NONCE_B = "bbbbbbbbbbbbbbbbbbbbbb==";

const loginHeaders = (nonce: string) => ({
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "cross-origin-opener-policy": "same-origin",
  "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate",
  "content-security-policy": csp(nonce),
});

const redirectTo = (location: string, status = 307): Probe => ({
  status,
  headers: { location },
});

/** A site that is set up correctly: every check should pass. */
function good(): Snapshot {
  return {
    origin: ORIGIN,
    allowHttp: false,
    login: {
      status: 200,
      headers: loginHeaders(NONCE_A),
      body: `<html><script nonce="${NONCE_A}" src="/a.js"></script><script nonce="${NONCE_A}">x</script></html>`,
    },
    loginAgain: { status: 200, headers: loginHeaders(NONCE_B), body: "" },
    protectedPages: [
      { path: "/", probe: redirectTo("/login") },
      { path: "/trash", probe: redirectTo("/login") },
      { path: "/tasks/123", probe: redirectTo(`${ORIGIN}/login`) },
    ],
    callbackWithoutCode: redirectTo(`${ORIGIN}/login?error=signin_failed`),
    callbackWithBadCode: redirectTo(`${ORIGIN}/login?error=signin_failed`),
    plainHttp: redirectTo(`${ORIGIN}/`, 308),
    secretFiles: [
      { path: "/.env", probe: { status: 404, headers: {} } },
      { path: "/.git/config", probe: redirectTo("/login") },
    ],
  };
}

/** Names of the checks that failed. */
function failures(snapshot: Snapshot): string[] {
  return runChecks(snapshot)
    .filter((r) => !r.ok)
    .map((r) => r.name);
}

/** The one check that must fail when `change` breaks the good site, and no other. */
function breaking(change: (s: Snapshot) => void, allowHttp = false): string[] {
  const snapshot = good();
  snapshot.allowHttp = allowHttp;
  if (allowHttp) delete snapshot.plainHttp;
  change(snapshot);
  return failures(snapshot);
}

const withLoginHeader = (name: string, value: string | undefined) => (s: Snapshot) => {
  if (value === undefined) delete s.login.headers[name];
  else s.login.headers[name] = value;
};

const withCsp = (overrides: Record<string, string>) => (s: Snapshot) => {
  s.login.headers["content-security-policy"] = csp(NONCE_A, overrides);
};

describe("a correctly set up site", () => {
  it("passes every check", () => {
    expect(failures(good())).toEqual([]);
  });

  it("gives every check a name, and says 'ok' when it passes", () => {
    for (const result of runChecks(good())) {
      expect(result.name.length).toBeGreaterThan(10);
      expect(result.detail).toBe("ok");
    }
  });

  it("also passes when checking a copy on this computer over plain http", () => {
    const local = good();
    local.origin = "http://localhost:3100";
    local.allowHttp = true;
    delete local.plainHttp;
    local.callbackWithoutCode = redirectTo("http://localhost:3100/login?error=signin_failed");
    local.callbackWithBadCode = redirectTo("/login?error=signin_failed");
    local.login.headers["content-security-policy"] = csp(NONCE_A, {
      "upgrade-insecure-requests": undefined as unknown as string,
      "connect-src": "'self' http://127.0.0.1:54321",
    }).replace(/; upgrade-insecure-requests undefined/, "");
    local.login.body += "<p>http://localhost:3100</p>";
    expect(failures(local)).toEqual([]);
  });
});

describe("routing", () => {
  it("fails when the login page does not load", () => {
    expect(breaking((s) => (s.login.status = 500))).toEqual(["The login page loads"]);
  });

  it.each([
    ["it answers 200 with content", { status: 200, headers: {} }],
    ["it redirects somewhere else", redirectTo("/somewhere-else")],
    ["it redirects with no address", { status: 307, headers: {} }],
    ["it is not a redirect status", { status: 404, headers: { location: "/login" } }],
    ["the address is not a valid URL", redirectTo("http://[bad")],
  ])("fails when a protected page is not sent to login: %s", (_why, probe) => {
    expect(breaking((s) => (s.protectedPages[1]!.probe = probe))).toEqual([
      "Signed-out visitors are sent to the login page from every other page",
    ]);
  });

  it("says which page was left open", () => {
    const s = good();
    s.protectedPages[1]!.probe = { status: 200, headers: {} };
    const result = runChecks(s).find((r) => !r.ok)!;
    expect(result.detail).toContain("/trash (200)");
  });

  it.each([
    ["to localhost", `http://localhost:3000/login?error=signin_failed`],
    ["to another site", `https://evil.example/login?error=signin_failed`],
    ["to another page", `${ORIGIN}/?error=signin_failed`],
    ["without the error code", `${ORIGIN}/login`],
    ["with a different error", `${ORIGIN}/login?error=other`],
  ])("fails when a failed sign-in goes %s", (_why, location) => {
    const failed = breaking((s) => (s.callbackWithoutCode = redirectTo(location)));
    expect(failed).toEqual([
      "A failed sign-in (without a code) goes back to this site's login page",
    ]);
    const failedBad = breaking((s) => (s.callbackWithBadCode = redirectTo(location)));
    expect(failedBad).toEqual([
      "A failed sign-in (with a made-up code) goes back to this site's login page",
    ]);
  });

  it("fails when the sign-in return address crashes instead of redirecting", () => {
    const failed = breaking((s) => (s.callbackWithBadCode = { status: 500, headers: {} }));
    expect(failed).toEqual([
      "A failed sign-in (with a made-up code) goes back to this site's login page",
    ]);
  });

  it.each([
    ["it is not redirected", { status: 200, headers: {} }],
    ["it is redirected to http", redirectTo("http://questlog.example/", 301)],
    ["it redirects with no address", { status: 308, headers: {} }],
  ])("fails when plain http is not sent to https: %s", (_why, probe) => {
    expect(breaking((s) => (s.plainHttp = probe))).toEqual(["Plain http is sent to https"]);
  });
});

describe("headers", () => {
  it.each([
    [
      "Forces https for at least two years (Strict-Transport-Security)",
      "strict-transport-security",
      undefined,
    ],
    [
      "Forces https for at least two years (Strict-Transport-Security)",
      "strict-transport-security",
      "max-age=3600; includeSubDomains",
    ],
    [
      "Forces https for at least two years (Strict-Transport-Security)",
      "strict-transport-security",
      "max-age=63072000",
    ],
    ["Stops content sniffing (X-Content-Type-Options)", "x-content-type-options", undefined],
    ["Stops content sniffing (X-Content-Type-Options)", "x-content-type-options", "sniff"],
    ["Refuses to be framed (X-Frame-Options)", "x-frame-options", undefined],
    ["Refuses to be framed (X-Frame-Options)", "x-frame-options", "SAMEORIGIN"],
    [
      "Does not leak full addresses to other sites (Referrer-Policy)",
      "referrer-policy",
      "unsafe-url",
    ],
    [
      "Switches off camera, microphone, location and payments (Permissions-Policy)",
      "permissions-policy",
      "camera=()",
    ],
    [
      "Switches off camera, microphone, location and payments (Permissions-Policy)",
      "permissions-policy",
      undefined,
    ],
    [
      "Isolates its window from other sites (Cross-Origin-Opener-Policy)",
      "cross-origin-opener-policy",
      undefined,
    ],
    ["Does not announce the framework (no X-Powered-By)", "x-powered-by", "Next.js"],
    [
      "The login page is never stored for other people (Cache-Control)",
      "cache-control",
      "public, max-age=3600",
    ],
    ["The login page is never stored for other people (Cache-Control)", "cache-control", undefined],
  ])("fails (%s) when %s is %s", (name, header, value) => {
    expect(breaking(withLoginHeader(header, value))).toEqual([name]);
  });

  it("accepts an HSTS header that is longer than the minimum", () => {
    expect(
      breaking(
        withLoginHeader(
          "strict-transport-security",
          "max-age=94608000; includeSubDomains; preload",
        ),
      ),
    ).toEqual([]);
  });
});

describe("Content-Security-Policy", () => {
  it("fails when there is no policy at all", () => {
    const failed = breaking(withLoginHeader("content-security-policy", undefined));
    expect(failed).toContain("Has a Content-Security-Policy");
  });

  it.each([
    [
      "has 'unsafe-inline'",
      { "script-src": `'self' 'nonce-${NONCE_A}' 'strict-dynamic' 'unsafe-inline'` },
    ],
    [
      "has 'unsafe-eval'",
      { "script-src": `'self' 'nonce-${NONCE_A}' 'strict-dynamic' 'unsafe-eval'` },
    ],
    ["has no strict-dynamic", { "script-src": `'self' 'nonce-${NONCE_A}'` }],
    ["has no nonce", { "script-src": "'self' 'strict-dynamic'" }],
  ])("fails when script-src %s", (_why, overrides) => {
    expect(breaking(withCsp(overrides))).toEqual([
      "Scripts need this request's nonce, and 'unsafe-inline' and 'unsafe-eval' are off",
    ]);
  });

  it.each([
    ["allows 'unsafe-inline'", { "style-src": `'self' 'nonce-${NONCE_A}' 'unsafe-inline'` }],
    ["has no nonce", { "style-src": "'self'" }],
  ])("fails when style-src %s", (_why, overrides) => {
    expect(breaking(withCsp(overrides))).toEqual([
      "Styles need the nonce too, and 'unsafe-inline' is off",
    ]);
  });

  it.each([
    [
      "default-src is open",
      { "default-src": "*" },
      "Everything not named defaults to this site only",
    ],
    ["object-src is not none", { "object-src": "'self'" }, "Plugins are off (object-src 'none')"],
    [
      "frame-ancestors is not none",
      { "frame-ancestors": "*" },
      "Cannot be framed (frame-ancestors 'none')",
    ],
    [
      "base-uri is open",
      { "base-uri": "*" },
      "Cannot change the page's base address (base-uri 'self')",
    ],
    [
      "form-action is open",
      { "form-action": "*" },
      "Forms can only send to this site (form-action 'self')",
    ],
  ])("fails when %s", (_why, overrides, name) => {
    expect(breaking(withCsp(overrides))).toEqual([name]);
  });

  it("fails when the policy does not upgrade http to https", () => {
    const withoutUpgrade = (s: Snapshot) => {
      s.login.headers["content-security-policy"] = csp(NONCE_A).replace(
        "; upgrade-insecure-requests",
        "",
      );
    };
    expect(breaking(withoutUpgrade)).toEqual(["Upgrades any stray http request to https"]);
  });

  it.each([
    ["an http address", "'self' http://evil.example"],
    ["a wildcard host", "'self' https://*.example.com http:"],
    ["a websocket", "'self' https://abc.supabase.co ws:"],
    ["no 'self'", "https://abc.supabase.co"],
    ["plain http for localhost on a live site", "'self' http://localhost:3000"],
  ])("fails when connect-src allows %s", (_why, value) => {
    expect(breaking(withCsp({ "connect-src": value }))).toEqual([
      "The browser may only talk to this site and Supabase over https",
    ]);
  });

  it("allows plain http for localhost only when checking a copy on this computer", () => {
    expect(breaking(withCsp({ "connect-src": "'self' http://127.0.0.1:54321" }), true)).toEqual([]);
    expect(breaking(withCsp({ "connect-src": "'self' http://evil.example" }), true)).toEqual([
      "The browser may only talk to this site and Supabase over https",
    ]);
  });
});

describe("nonces", () => {
  it("fails when two requests get the same nonce", () => {
    const failed = breaking(
      (s) => (s.loginAgain.headers["content-security-policy"] = csp(NONCE_A)),
    );
    expect(failed).toEqual(["Every request gets a new, unguessable nonce"]);
  });

  it("fails when the nonce is too short to be unguessable", () => {
    const failed = breaking((s) => {
      s.login.headers["content-security-policy"] = csp("abc");
      s.login.body = `<script nonce="abc"></script>`;
    });
    expect(failed).toEqual(["Every request gets a new, unguessable nonce"]);
  });

  it("fails when the second request has no nonce", () => {
    const failed = breaking((s) => delete s.loginAgain.headers["content-security-policy"]);
    expect(failed).toEqual(["Every request gets a new, unguessable nonce"]);
  });

  it.each([
    [
      "the same nonce twice",
      (s: Snapshot) => (s.loginAgain.headers["content-security-policy"] = csp(NONCE_A)),
      "two requests got the same nonce",
    ],
    [
      "no nonce on the second request",
      (s: Snapshot) => delete s.loginAgain.headers["content-security-policy"],
      "a request came back with no nonce",
    ],
    [
      "a nonce that is too short",
      (s: Snapshot) => {
        s.login.headers["content-security-policy"] = csp("abc");
      },
      "the nonce is too short",
    ],
  ])("says what is wrong with the nonce: %s", (_why, change, detail) => {
    const s = good();
    change(s);
    const result = runChecks(s).find(
      (r) => r.name === "Every request gets a new, unguessable nonce",
    )!;
    expect(result.detail).toBe(detail);
  });
  it("fails when a script on the page lacks the nonce, and counts them", () => {
    const s = good();
    s.login.body = `<script nonce="${NONCE_A}"></script><script src="/evil.js"></script>`;
    const result = runChecks(s).find((r) => !r.ok)!;
    expect(result.name).toBe("Every script on the login page carries that nonce");
    expect(result.detail).toBe("1 of 2 scripts lack the nonce");
  });

  it("fails when the page has no scripts to check, rather than passing by default", () => {
    const s = good();
    s.login.body = "<html></html>";
    const result = runChecks(s).find((r) => !r.ok)!;
    expect(result.detail).toBe("no scripts found in the page");
  });

  it("fails every script when the policy has no nonce at all", () => {
    const failed = breaking((s) => {
      s.login.headers["content-security-policy"] = "default-src 'self'";
    });
    expect(failed).toContain("Every script on the login page carries that nonce");
  });
});

describe("exposure", () => {
  it("fails when a private file is served, naming it", () => {
    const s = good();
    s.secretFiles[0]!.probe = { status: 200, headers: {} };
    const result = runChecks(s).find((r) => !r.ok)!;
    expect(result.name).toBe("Files that must stay private are not served");
    expect(result.detail).toContain("/.env");
  });

  it.each(["<p>sb_secret_abc</p>", "<p>service_role</p>", "<a href='http://localhost:3000'>x</a>"])(
    "fails when the login page contains %s",
    (extra) => {
      const failed = breaking((s) => (s.login.body += extra));
      expect(failed).toEqual(["The login page has no secret keys or development addresses in it"]);
    },
  );

  it("still rejects a secret key on a local copy, but allows localhost there", () => {
    expect(breaking((s) => (s.login.body += "<p>sb_secret_abc</p>"), true)).toEqual([
      "The login page has no secret keys or development addresses in it",
    ]);
    expect(breaking((s) => (s.login.body += "http://localhost:3000"), true)).toEqual([]);
  });
});

describe("parseCsp and nonceOf", () => {
  it("splits a policy into its directives", () => {
    expect(
      parseCsp("default-src 'self'; script-src 'self' 'nonce-abc'; upgrade-insecure-requests"),
    ).toEqual({
      "default-src": ["'self'"],
      "script-src": ["'self'", "'nonce-abc'"],
      "upgrade-insecure-requests": [],
    });
  });

  it("ignores empty parts and is case-insensitive about directive names", () => {
    expect(parseCsp("Default-Src 'self';; ;")).toEqual({ "default-src": ["'self'"] });
  });

  it("finds the nonce, or says there is none", () => {
    expect(nonceOf("script-src 'nonce-xyz123' 'strict-dynamic'")).toBe("xyz123");
    expect(nonceOf("script-src 'self'")).toBeNull();
    expect(nonceOf(undefined)).toBeNull();
  });
});
