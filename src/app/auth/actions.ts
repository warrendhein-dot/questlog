"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Signs the user out and clears the session cookies. As a Server Action it gets Next.js's built-in
 * cross-site request protection (the request's Origin must match the app's host).
 */
export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
