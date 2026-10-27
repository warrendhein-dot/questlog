import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The signed-in user, or null. Supabase checks the session with its server, so a forged or revoked
 * cookie does not count (unlike `getSession()`, which only reads the cookie).
 */
export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Use at the top of every protected page and server action. The proxy already redirects signed-out
 * visitors, but each page must not rely on that: a missed proxy rule would then leak the page.
 */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
