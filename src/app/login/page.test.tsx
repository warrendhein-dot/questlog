import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, redirect } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/supabase/browser", () => ({ createSupabaseBrowserClient: vi.fn() }));

import LoginPage from "./page";

beforeEach(() => {
  getCurrentUser.mockReset();
  getCurrentUser.mockResolvedValue(null);
  redirect.mockClear();
});

const renderPage = async (error?: string | string[]) =>
  render(await LoginPage({ searchParams: Promise.resolve({ error }) }));

describe("Login page", () => {
  it("offers Google sign-in under the app title", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Questlog" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains a failed sign-in using a known error code", async () => {
    await renderPage("signin_failed");
    expect(screen.getByRole("alert")).toHaveTextContent(/isn't allowed to use Questlog/);
  });

  it("never shows text taken from the URL", async () => {
    const { container } = await renderPage('<img src=x onerror="alert(1)">You have won a prize');
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("prize");
    expect(container.querySelector("img")).toBeNull();
  });

  it("ignores repeated error parameters", async () => {
    await renderPage(["signin_failed", "signin_failed"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends an already signed-in user home", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1" });
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT:/");
  });
});
