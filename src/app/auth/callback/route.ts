import { NextResponse } from "next/server";
import { ensureProfile } from "@/lib/auth/profile";
import { getEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where Supabase sends the browser after Google sign-in, carrying a one-time `code`.
 * We swap the code for a session (stored in cookies), make sure a profile exists, and go home.
 *
 * Every redirect is built from the configured app URL, never from request headers, so a forged
 * Host header cannot send a freshly signed-in user to another site. There is also deliberately no
 * `next` parameter: the destination is always "/", which rules out open-redirect bugs.
 */
export async function GET(request: Request) {
  const appUrl = getEnv().NEXT_PUBLIC_APP_URL;
  const failure = () => NextResponse.redirect(new URL("/login?error=signin_failed", appUrl));

  const code = new URL(request.url).searchParams.get("code");
  if (!code) return failure(); // Google refused, the user cancelled, or the hook rejected the account.

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return failure();

  try {
    await ensureProfile(supabase, data.user.id);
  } catch {
    // Fail closed: a user without a profile is half set up, so do not leave them signed in.
    await supabase.auth.signOut();
    return failure();
  }

  return NextResponse.redirect(new URL("/", appUrl));
}
