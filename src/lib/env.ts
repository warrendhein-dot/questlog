import { z } from "zod";

/**
 * The single source of truth for configuration read from environment variables.
 * Validating at the boundary means a bad deploy fails loudly at startup instead of
 * causing a confusing bug later. Add new variables here AND in `.env.example`.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Only http(s) is accepted: never trust a config value to be a safe URL scheme.
  NEXT_PUBLIC_APP_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Supabase settings are validated separately, and only when something asks for them, so the
 * rest of the app (and CI builds) work without Supabase configured.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** https always; plain http only for this computer (the throwaway Supabase and app used by CI tests). */
function isHttpsOrLoopbackUrl(value: string): boolean {
  // A validation rule must never throw: unparseable input is simply "not allowed".
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // A Supabase address never carries a username or password. Rejecting them also defeats tricks
  // like http://anything@evil.example@localhost, where the part before the last @ is not the host.
  if (url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

const supabaseEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .url()
    .refine(
      isHttpsOrLoopbackUrl,
      "must be an https URL (plain http is allowed only for localhost)",
    ),
  // The publishable key is safe in the browser because row-level security protects the data.
  // The secret key bypasses security entirely, so a `sb_secret_` value here is a mistake.
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .startsWith("sb_publishable_", "must be a Supabase publishable key (sb_publishable_...)"),
});

export type SupabaseEnv = z.infer<typeof supabaseEnvSchema>;

function parseWith<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined>,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Report variable names and reasons only, never the values (they may be secrets).
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return result.data;
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const env = parseWith(envSchema, source);
  if (env.NODE_ENV === "production") {
    // The development default (http://localhost:3000) must never quietly apply on the live site:
    // every sign-in redirect is built from this address, so a forgotten setting would send people
    // to localhost. Fail loudly instead, naming the variable and never its value.
    if (source.NEXT_PUBLIC_APP_URL === undefined) {
      throw new Error(
        "Invalid environment configuration: NEXT_PUBLIC_APP_URL: is required in production",
      );
    }
    if (!isHttpsOrLoopbackUrl(env.NEXT_PUBLIC_APP_URL)) {
      throw new Error(
        "Invalid environment configuration: NEXT_PUBLIC_APP_URL: must be https in production (plain http is allowed only for localhost)",
      );
    }
  }
  return env;
}

export function parseSupabaseEnv(source: Record<string, string | undefined>): SupabaseEnv {
  return parseWith(supabaseEnvSchema, source);
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

let cachedSupabase: SupabaseEnv | undefined;

export function getSupabaseEnv(): SupabaseEnv {
  // These two lookups must be written out literally: Next.js replaces `process.env.NEXT_PUBLIC_*`
  // with the real value at build time, which is what makes them available in the browser.
  cachedSupabase ??= parseSupabaseEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  return cachedSupabase;
}
