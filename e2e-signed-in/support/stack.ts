import { execSync } from "node:child_process";

/**
 * Settings for the throwaway Supabase stack that the signed-in browser tests run against.
 *
 * The stack is started with `supabase start` (needs Docker; CI does it for every run). It is a
 * private copy of Supabase running on this computer: its database is built from our own migrations
 * and is deleted afterwards, and its keys are generated locally and work nowhere else.
 */
export type LocalStack = {
  url: string;
  publishableKey: string;
  /** Lets the tests create users. It only works against the throwaway stack. */
  secretKey: string;
};

/** Reads `KEY="value"` lines, the format of `supabase status -o env`. */
export function parseStatusEnv(output: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match) continue;
    vars[match[1]!] = match[2]!.replace(/^"(.*)"$/, "$1");
  }
  return vars;
}

/**
 * Picks what the tests need out of the status output. If something is missing, the error lists the
 * variable NAMES that were found (never their values), so a CLI that renames them is easy to fix.
 */
export function stackFromStatus(vars: Record<string, string>): LocalStack {
  const url = vars.API_URL ?? vars.SUPABASE_URL;
  // The app only accepts new-style publishable keys, so the legacy anon key is not a substitute.
  const publishableKey = vars.PUBLISHABLE_KEY;
  const secretKey = vars.SECRET_KEY ?? vars.SERVICE_ROLE_KEY;

  const missing = [
    !url && "API_URL",
    !publishableKey && "PUBLISHABLE_KEY",
    !secretKey && "SECRET_KEY",
  ].filter(Boolean);
  if (missing.length > 0 || !url || !publishableKey || !secretKey) {
    throw new Error(
      `The local Supabase status output is missing ${missing.join(", ")}. ` +
        `Variables found: ${Object.keys(vars).sort().join(", ") || "(none)"}.`,
    );
  }
  return { url, publishableKey, secretKey };
}

const STATUS_COMMANDS = [
  "supabase status -o env", // CI installs the CLI on the PATH
  "npx --no-install supabase status -o env", // CLI installed in this project
  "npx supabase status -o env", // fetched on demand
];

export function readStatusOutput(): string {
  let lastError: unknown;
  for (const command of STATUS_COMMANDS) {
    try {
      return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    "Could not read the local Supabase stack. Start it first with `npx supabase start` " +
      `(needs Docker). Last error: ${lastError instanceof Error ? lastError.message.split("\n")[0] : "unknown"}`,
  );
}

/**
 * The stack's settings. Tests can run in several processes, so they are shared through environment
 * variables: the first call reads the stack, later calls (in test workers) just reuse the result.
 */
export function loadLocalStack(): LocalStack {
  const cached = {
    url: process.env.E2E_SUPABASE_URL,
    publishableKey: process.env.E2E_SUPABASE_PUBLISHABLE_KEY,
    secretKey: process.env.E2E_SUPABASE_SECRET_KEY,
  };
  if (cached.url && cached.publishableKey && cached.secretKey) {
    return cached as LocalStack;
  }

  const stack = stackFromStatus(parseStatusEnv(readStatusOutput()));
  process.env.E2E_SUPABASE_URL = stack.url;
  process.env.E2E_SUPABASE_PUBLISHABLE_KEY = stack.publishableKey;
  process.env.E2E_SUPABASE_SECRET_KEY = stack.secretKey;
  return stack;
}
