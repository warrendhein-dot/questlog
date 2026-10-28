"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isValidTimeZone } from "@/lib/tasks/views";

// Same order as every other action: requireUser(), validate what the browser sent, talk to the
// database as the signed-in user, report only generic messages.

/**
 * Saves the time zone the browser reports, so "today" and "this week" mean the user's own days.
 * Called by `TimeZoneSync` whenever the browser's zone differs from the saved one (first visit, or
 * after travelling). A name that is not a real time zone is ignored.
 */
export async function saveTimeZone(timeZone: string): Promise<void> {
  const user = await requireUser();
  if (!isValidTimeZone(timeZone)) return;

  const supabase = await createSupabaseServerClient();
  // Upsert, so it also works for an account whose profile row has not been created yet. Row-level
  // security only lets a user write their own row.
  const { error } = await supabase
    .from("profiles")
    .upsert({ user_id: user.id, time_zone: timeZone }, { onConflict: "user_id" });
  if (error) throw new Error("Could not save your time zone");

  revalidatePath("/");
}
