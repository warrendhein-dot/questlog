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

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Report variable names and reasons only, never the values (they may be secrets).
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
