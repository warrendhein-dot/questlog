import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Makes sure the signed-in user has a profile row, creating it with the defaults on first sign-in.
 * Runs as the user, so row-level security guarantees they can only ever create their own.
 */
export async function ensureProfile(supabase: SupabaseClient, userId: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  // Deliberately generic: database error text can reveal table and policy names.
  if (error) throw new Error("Could not create the user profile");
}
