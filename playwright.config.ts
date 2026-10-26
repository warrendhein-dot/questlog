import { defineConfig, devices } from "@playwright/test";

// A different port from `npm run dev` (3000) so e2e runs never collide with a dev server.
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  // Tests run against the real production build, the same thing users get.
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    // Placeholder settings keep these tests independent of any real account, of your .env.local,
    // and of the network. They are not secrets. Process variables beat .env files in Next.js.
    env: {
      NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
      NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
      // Obviously fake and deliberately low-entropy: a random-looking placeholder trips the secret
      // scanner's generic-api-key rule.
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_test_test",
    },
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
