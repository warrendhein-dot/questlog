import { describe, expect, it } from "vitest";
import { isPublicPath } from "./paths";

describe("isPublicPath", () => {
  it.each(["/login", "/auth/callback"])("lets signed-out visitors open %s", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each(["/", "/tasks", "/auth", "/auth/callback/extra", "/login/", "/LOGIN", "/login/../"])(
    "requires sign-in for %s",
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    },
  );
});
