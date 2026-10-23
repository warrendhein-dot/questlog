import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest doesn't expose global hooks, so Testing Library can't register its own cleanup.
// Without this, components rendered by one test stay on screen for the next.
afterEach(() => {
  cleanup();
});
