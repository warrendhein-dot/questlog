import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidTimeZone } from "@/lib/tasks/views";

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

/**
 * The time zone saved in the signed-in user's profile, which decides what "today" means for them.
 * Falls back to UTC when there is no profile yet or the saved name is not a real zone.
 */
export async function getTimeZone(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.from("profiles").select("time_zone").maybeSingle();
  if (error) throw new Error("Could not load your profile");
  const saved = data?.time_zone;
  return isValidTimeZone(saved) ? saved : "UTC";
}
