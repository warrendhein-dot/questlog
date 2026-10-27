import { defineConfig, devices } from "@playwright/test";
import { loadLocalStack } from "./e2e-signed-in/support/stack";

// Signed-in browser tests. They need a throwaway Supabase running on this computer:
//   npx supabase start    (needs Docker; CI does this for every run)
//   npm run test:e2e:signed-in
// The signed-out tests in e2e/ need none of this and run with `npm run test:e2e`.

// A different port from the dev server (3000) and from the signed-out suite (3100).
const PORT = 3101;

// Reads the throwaway stack's address and keys (and fails with a clear message if it is not running).
const stack = loadLocalStack();

export default defineConfig({
  testDir: "./e2e-signed-in",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  // Tests run against the real production build, pointed at the throwaway stack. The values are
  // passed by process variables, which beat any .env.local file, so your real project is never used.
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    env: {
      NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
      NEXT_PUBLIC_SUPABASE_URL: stack.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: stack.publishableKey,
    },
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
