// Checks a deployed Questlog the way a stranger would see it: no sign-in, no secrets, just requests.
//
//   npm run check:live -- https://your-site.vercel.app
//   npm run check:live -- http://localhost:3100 --allow-http     (a copy running on this computer)
//
// The judging rules live in src/lib/security/live-check.ts (unit tested). This file only asks the
// questions. It makes about twenty ordinary GET requests and changes nothing on the site.

import { runChecks, type Probe, type Snapshot } from "../src/lib/security/live-check.ts";

const USAGE = "Usage: npm run check:live -- <https://your-site> [--allow-http (localhost only)]";

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const args = process.argv.slice(2);
const allowHttp = args.includes("--allow-http");
const address = args.find((arg) => !arg.startsWith("--"));
if (!address) fail(USAGE);

let site: URL;
try {
  site = new URL(address);
} catch {
  fail(`That is not a web address.\n${USAGE}`);
}
const isLocal = site.protocol === "http:" && ["localhost", "127.0.0.1"].includes(site.hostname);
if (site.protocol !== "https:" && !(allowHttp && isLocal)) {
  fail(`Use an https address. (--allow-http works only for localhost.)\n${USAGE}`);
}
if (site.username || site.password) fail("The address must not contain a user name or password.");
const origin = site.origin;

/** One GET request. Redirects are not followed, so the redirect itself can be checked. */
async function probe(url: string, withBody = false): Promise<Probe> {
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
    headers: { "user-agent": "questlog-live-check" },
  });
  const headers: Record<string, string> = {};
  for (const [name, value] of response.headers) headers[name.toLowerCase()] = value;
  const body = await response.text(); // always read it, so the connection is released
  return { status: response.status, headers, body: withBody ? body : undefined };
}

const PROTECTED_PATHS = [
  "/",
  "/?view=all",
  "/trash",
  "/tasks/123e4567-e89b-42d3-a456-426614174000",
  "/tasks/not-a-uuid",
];
const SECRET_PATHS = [
  "/.env",
  "/.env.local",
  "/.git/config",
  "/package.json",
  "/supabase/config.toml",
];

async function takeSnapshot(): Promise<Snapshot> {
  const at = (path: string) => `${origin}${path}`;
  return {
    origin,
    allowHttp,
    login: await probe(at("/login"), true),
    loginAgain: await probe(at("/login"), true),
    protectedPages: await Promise.all(
      PROTECTED_PATHS.map(async (path) => ({ path, probe: await probe(at(path)) })),
    ),
    callbackWithoutCode: await probe(at("/auth/callback")),
    callbackWithBadCode: await probe(at("/auth/callback?code=not-a-real-code")),
    plainHttp: allowHttp ? undefined : await probe(at("/").replace(/^https:/, "http:")),
    secretFiles: await Promise.all(
      SECRET_PATHS.map(async (path) => ({ path, probe: await probe(at(path)) })),
    ),
  };
}

let snapshot: Snapshot;
try {
  snapshot = await takeSnapshot();
} catch (error) {
  fail(`Could not reach ${origin}: ${error instanceof Error ? error.message : "unknown error"}`);
}

const results = runChecks(snapshot);
console.log(`Questlog live check: ${origin}\n`);
for (const result of results) {
  console.log(
    `${result.ok ? "PASS" : "FAIL"}  ${result.name}${result.ok ? "" : `\n        ${result.detail}`}`,
  );
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed.`);
process.exit(failed === 0 ? 0 : 1);
