import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Unit/component tests live in src/; database security tests live in supabase/tests/.
    // Browser tests live in e2e/ and run via Playwright.
    include: [
      "src/**/*.test.{ts,tsx}",
      "supabase/**/*.test.ts",
      "e2e-signed-in/support/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/app/layout.tsx"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
