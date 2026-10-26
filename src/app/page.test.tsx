import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUser } = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/app/auth/actions", () => ({ signOut: vi.fn() }));

import Home from "./page";

beforeEach(() => {
  requireUser.mockReset();
  requireUser.mockResolvedValue({ id: "u1", email: "hero@example.com" });
});

describe("Home page", () => {
  it("shows the app title as the main heading", async () => {
    render(await Home());
    expect(screen.getByRole("heading", { level: 1, name: "Questlog" })).toBeInTheDocument();
  });

  it("has a main landmark for screen-reader navigation", async () => {
    render(await Home());
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("shows who is signed in and offers sign-out", async () => {
    render(await Home());
    expect(screen.getByText("Signed in as hero@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("does not render for a signed-out visitor", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(Home()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("escapes markup in the account's email address", async () => {
    requireUser.mockResolvedValue({
      id: "u1",
      email: '<img src=x onerror="alert(1)">@example.com',
    });
    const { container } = render(await Home());
    expect(container.querySelector("img")).toBeNull();
  });
});
