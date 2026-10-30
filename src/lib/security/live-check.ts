/**
 * The rules behind `npm run check:live`: what a deployed Questlog must look like to a visitor who is
 * not signed in. Pure functions with no network of their own: scripts/check-live.ts makes the
 * requests and hands the answers here, so every rule can be tested with made-up answers.
 *
 * This file is run directly by Node (it strips the types), so it imports nothing and uses no
 * TypeScript-only syntax such as enums.
 */

/** Header names are lower-case, as `fetch` reports them. */
export type HeaderMap = Record<string, string>;

/** What one request came back with. Redirects are NOT followed, so a 3xx can be inspected. */
export type Probe = {
  status: number;
  headers: HeaderMap;
  /** The page's HTML, only collected for the login page. */
  body?: string;
};

export type Snapshot = {
  /** The site checked, e.g. "https://questlog.example" (no trailing slash). */
  origin: string;
  /** True only when checking a copy running on this computer over plain http. */
  allowHttp: boolean;
  login: Probe;
  /** The login page again, to prove every request gets its own nonce. */
  loginAgain: Probe;
  /** Pages that need a sign-in. */
  protectedPages: { path: string; probe: Probe }[];
  /** The sign-in return address with no code, and with a made-up one. */
  callbackWithoutCode: Probe;
  callbackWithBadCode: Probe;
  /** The same site over plain http (absent when `allowHttp`). */
  plainHttp?: Probe;
  /** Files that must never be served. */
  secretFiles: { path: string; probe: Probe }[];
};

export type CheckResult = { name: string; ok: boolean; detail: string };

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function check(name: string, ok: boolean, detail: string): CheckResult {
  return { name, ok, detail: ok ? "ok" : detail };
}

/** "script-src 'self' 'nonce-abc'" becomes { "script-src": ["'self'", "'nonce-abc'"] }. */
export function parseCsp(csp: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {};
  for (const part of csp.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) directives[name.toLowerCase()] = values;
  }
  return directives;
}

/** The nonce a page's Content-Security-Policy hands out, or null if there is none. */
export function nonceOf(csp: string | undefined): string | null {
  const match = csp?.match(/'nonce-([^']+)'/);
  return match?.[1] ?? null;
}

/** Where a redirect goes, as a URL on the checked site; null if it is not a redirect. */
function redirectTarget(probe: Probe, origin: string): URL | null {
  const location = probe.headers["location"];
  if (!REDIRECTS.has(probe.status) || !location) return null;
  try {
    return new URL(location, origin);
  } catch {
    return null;
  }
}

function headerChecks(s: Snapshot): CheckResult[] {
  const h = s.login.headers;
  const hsts = h["strict-transport-security"] ?? "";
  const maxAge = Number(hsts.match(/max-age=(\d+)/)?.[1] ?? 0);
  return [
    check(
      "Forces https for at least two years (Strict-Transport-Security)",
      maxAge >= 63_072_000 && /includeSubDomains/i.test(hsts),
      `got "${hsts || "nothing"}"`,
    ),
    check(
      "Stops content sniffing (X-Content-Type-Options)",
      h["x-content-type-options"]?.toLowerCase() === "nosniff",
      `got "${h["x-content-type-options"] ?? "nothing"}"`,
    ),
    check(
      "Refuses to be framed (X-Frame-Options)",
      h["x-frame-options"]?.toUpperCase() === "DENY",
      `got "${h["x-frame-options"] ?? "nothing"}"`,
    ),
    check(
      "Does not leak full addresses to other sites (Referrer-Policy)",
      h["referrer-policy"] === "strict-origin-when-cross-origin",
      `got "${h["referrer-policy"] ?? "nothing"}"`,
    ),
    check(
      "Switches off camera, microphone, location and payments (Permissions-Policy)",
      ["camera=()", "microphone=()", "geolocation=()", "payment=()"].every((p) =>
        (h["permissions-policy"] ?? "").includes(p),
      ),
      `got "${h["permissions-policy"] ?? "nothing"}"`,
    ),
    check(
      "Isolates its window from other sites (Cross-Origin-Opener-Policy)",
      h["cross-origin-opener-policy"] === "same-origin",
      `got "${h["cross-origin-opener-policy"] ?? "nothing"}"`,
    ),
    check(
      "Does not announce the framework (no X-Powered-By)",
      h["x-powered-by"] === undefined,
      `X-Powered-By is "${h["x-powered-by"]}"`,
    ),
    check(
      "The login page is never stored for other people (Cache-Control)",
      /no-store|private/i.test(h["cache-control"] ?? "") &&
        !/public/i.test(h["cache-control"] ?? ""),
      `got "${h["cache-control"] ?? "nothing"}"`,
    ),
  ];
}

function cspChecks(s: Snapshot): CheckResult[] {
  const raw = s.login.headers["content-security-policy"];
  if (!raw) return [check("Has a Content-Security-Policy", false, "the header is missing")];
  const csp = parseCsp(raw);
  const has = (directive: string, value: string) => csp[directive]?.includes(value) ?? false;
  const script = csp["script-src"] ?? [];
  const style = csp["style-src"] ?? [];
  const connect = csp["connect-src"] ?? [];
  // Where the browser may send requests: this site and Supabase, over https. Plain http is allowed
  // only when checking a copy on this computer.
  const connectOk = connect.every(
    (source) =>
      source === "'self'" ||
      source.startsWith("https://") ||
      (s.allowHttp && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(source)),
  );
  return [
    check("Has a Content-Security-Policy", true, ""),
    check(
      "Scripts need this request's nonce, and 'unsafe-inline' and 'unsafe-eval' are off",
      script.some((v) => v.startsWith("'nonce-")) &&
        script.includes("'strict-dynamic'") &&
        !script.includes("'unsafe-inline'") &&
        !script.includes("'unsafe-eval'"),
      `script-src is "${script.join(" ")}"`,
    ),
    check(
      "Styles need the nonce too, and 'unsafe-inline' is off",
      style.some((v) => v.startsWith("'nonce-")) && !style.includes("'unsafe-inline'"),
      `style-src is "${style.join(" ")}"`,
    ),
    check(
      "Everything not named defaults to this site only",
      csp["default-src"]?.join(" ") === "'self'",
      `default-src is "${csp["default-src"]?.join(" ") ?? "missing"}"`,
    ),
    check(
      "Plugins are off (object-src 'none')",
      has("object-src", "'none'"),
      "object-src is not 'none'",
    ),
    check(
      "Cannot be framed (frame-ancestors 'none')",
      has("frame-ancestors", "'none'"),
      "frame-ancestors is not 'none'",
    ),
    check(
      "Cannot change the page's base address (base-uri 'self')",
      has("base-uri", "'self'"),
      "base-uri is not 'self'",
    ),
    check(
      "Forms can only send to this site (form-action 'self')",
      has("form-action", "'self'"),
      "form-action is not 'self'",
    ),
    check(
      "Upgrades any stray http request to https",
      s.allowHttp || csp["upgrade-insecure-requests"] !== undefined,
      "upgrade-insecure-requests is missing",
    ),
    check(
      "The browser may only talk to this site and Supabase over https",
      connect.includes("'self'") && connectOk && !connect.some((v) => v.startsWith("ws:")),
      `connect-src is "${connect.join(" ")}"`,
    ),
  ];
}

function nonceChecks(s: Snapshot): CheckResult[] {
  const first = nonceOf(s.login.headers["content-security-policy"]);
  const second = nonceOf(s.loginAgain.headers["content-security-policy"]);
  const body = s.login.body ?? "";
  const scripts = body.match(/<script\b[^>]*>/gi) ?? [];
  const unmarked =
    first === null ? scripts : scripts.filter((tag) => !tag.includes(`nonce="${first}"`));
  return [
    check(
      "Every request gets a new, unguessable nonce",
      first !== null && second !== null && first !== second && first.length >= 16,
      first === null || second === null
        ? "a request came back with no nonce"
        : first === second
          ? "two requests got the same nonce"
          : "the nonce is too short",
    ),
    check(
      "Every script on the login page carries that nonce",
      scripts.length > 0 && unmarked.length === 0,
      scripts.length === 0
        ? "no scripts found in the page"
        : `${unmarked.length} of ${scripts.length} scripts lack the nonce`,
    ),
  ];
}

function routingChecks(s: Snapshot): CheckResult[] {
  const results: CheckResult[] = [
    check("The login page loads", s.login.status === 200, `status ${s.login.status}`),
  ];

  const stranded = s.protectedPages.filter(
    ({ probe }) => redirectTarget(probe, s.origin)?.pathname !== "/login",
  );
  results.push(
    check(
      "Signed-out visitors are sent to the login page from every other page",
      stranded.length === 0,
      `these did not redirect to /login: ${stranded.map((p) => `${p.path} (${p.probe.status})`).join(", ")}`,
    ),
  );

  // The sign-in return address builds its redirects from NEXT_PUBLIC_APP_URL. If that setting were
  // missing or wrong, a freshly signed-in user would be sent to the wrong site (for example localhost).
  const callbacks = [
    ["without a code", s.callbackWithoutCode],
    ["with a made-up code", s.callbackWithBadCode],
  ] as const;
  for (const [label, probe] of callbacks) {
    const target = redirectTarget(probe, s.origin);
    results.push(
      check(
        `A failed sign-in (${label}) goes back to this site's login page`,
        target !== null &&
          target.origin === s.origin &&
          target.pathname === "/login" &&
          target.searchParams.get("error") === "signin_failed",
        target === null
          ? `status ${probe.status}, not a redirect`
          : `it redirects to ${target.origin}${target.pathname}`,
      ),
    );
  }

  if (s.plainHttp) {
    const target = redirectTarget(s.plainHttp, s.origin);
    results.push(
      check(
        "Plain http is sent to https",
        target !== null && target.protocol === "https:",
        `status ${s.plainHttp.status}, goes to ${target?.protocol ?? "nowhere"}`,
      ),
    );
  }
  return results;
}

function exposureChecks(s: Snapshot): CheckResult[] {
  const served = s.secretFiles.filter(({ probe }) => probe.status === 200);
  const body = s.login.body ?? "";
  const leaks = [/sb_secret_/, /service_role/i, ...(s.allowHttp ? [] : [/localhost/i])].filter(
    (p) => p.test(body),
  );
  return [
    check(
      "Files that must stay private are not served",
      served.length === 0,
      `these returned content: ${served.map((f) => f.path).join(", ")}`,
    ),
    check(
      "The login page has no secret keys or development addresses in it",
      leaks.length === 0,
      `the page contains ${leaks.map(String).join(", ")}`,
    ),
  ];
}

/** Runs every rule against what the site answered. */
export function runChecks(snapshot: Snapshot): CheckResult[] {
  return [
    ...routingChecks(snapshot),
    ...headerChecks(snapshot),
    ...cspChecks(snapshot),
    ...nonceChecks(snapshot),
    ...exposureChecks(snapshot),
  ];
}
