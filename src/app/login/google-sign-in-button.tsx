"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function GoogleSignInButton() {
  const [state, setState] = useState<"idle" | "redirecting" | "failed">("idle");

  async function signIn() {
    setState("redirecting");
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // The page Supabase returns the browser to. It must also be on Supabase's redirect allow-list.
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setState("failed");
  }

  return (
    <div>
      <button
        type="button"
        onClick={signIn}
        disabled={state === "redirecting"}
        className="w-full rounded border-2 border-panel-border bg-background px-4 py-3 font-bold hover:bg-panel-from focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-panel-border disabled:opacity-70"
      >
        {state === "redirecting" ? "Opening Google…" : "Sign in with Google"}
      </button>
      {state === "failed" && (
        <p role="alert" className="mt-3">
          Could not start sign-in. Please try again.
        </p>
      )}
    </div>
  );
}
