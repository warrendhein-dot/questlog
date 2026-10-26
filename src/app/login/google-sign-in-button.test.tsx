import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOAuth = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({ auth: { signInWithOAuth } }),
}));

import { GoogleSignInButton } from "./google-sign-in-button";

beforeEach(() => {
  signInWithOAuth.mockReset();
});

describe("GoogleSignInButton", () => {
  it("starts Google sign-in and returns to this app's callback page", async () => {
    signInWithOAuth.mockResolvedValue({ error: null });
    render(<GoogleSignInButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  });

  it("disables the button while the browser is being sent to Google", async () => {
    signInWithOAuth.mockReturnValue(new Promise(() => {})); // never resolves: the page navigates away
    render(<GoogleSignInButton />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button", { name: /Opening Google/ })).toBeDisabled();
  });

  it("tells the user when sign-in could not be started, and lets them retry", async () => {
    signInWithOAuth.mockResolvedValue({ error: new Error("network") });
    render(<GoogleSignInButton />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not start sign-in/);
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeEnabled();
  });
});
