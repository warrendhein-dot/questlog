"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTimeZone } from "@/lib/auth/profile";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  parseTaskForm,
  parseTaskId,
  type TaskFormState,
  type TaskFormValues,
} from "@/lib/tasks/schema";
import { todayIn } from "@/lib/tasks/views";

// Every action here follows the same order, on purpose:
//   1. requireUser(): a signed-out request never gets further.
//   2. Validate everything that came from the browser (Zod). Never trust form fields or ids.
//   3. Talk to the database as the signed-in user, so row-level security applies.
//   4. Report only generic messages back: database error text can name tables and rules.

const NOT_FOUND = "That quest could not be found.";

function failed(values: TaskFormValues, error: { message?: string }): TaskFormState {
  const message = error.message?.includes("task_rate_limit")
    ? "You're creating quests very quickly. Wait a minute and try again."
    : "Could not save the quest. Please try again.";
  return { status: "error", message, values };
}

export async function createTask(
  _previous: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  await requireUser();

  const parsed = parseTaskForm(formData);
  if (!parsed.success) return { status: "error", errors: parsed.errors, values: parsed.values };
  const { title, notes, category, priority, dueDate } = parsed.data;

  const supabase = await createSupabaseServerClient();
  // The owner is not sent: the database fills it in from the session.
  const { error } = await supabase
    .from("tasks")
    .insert({ title, notes, category, priority, due_date: dueDate });
  if (error) {
    return failed(
      {
        title,
        notes,
        category,
        priority,
        dueDate: dueDate ?? "",
      },
      error,
    );
  }

  revalidatePath("/");
  return { status: "saved" };
}

/** Bound to a task id by the edit page: `updateTask.bind(null, task.id)`. */
export async function updateTask(
  id: string,
  _previous: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  await requireUser();

  const taskId = parseTaskId(id);
  if (!taskId) return { status: "error", message: NOT_FOUND };

  const parsed = parseTaskForm(formData);
  if (!parsed.success) return { status: "error", errors: parsed.errors, values: parsed.values };
  const { title, notes, category, priority, dueDate } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ title, notes, category, priority, due_date: dueDate })
    .eq("id", taskId)
    .select("id");
  if (error) {
    return failed({ title, notes, category, priority, dueDate: dueDate ?? "" }, error);
  }
  // Updating someone else's task (or one that no longer exists) changes zero rows without an error.
  if (!data || data.length === 0) return { status: "error", message: NOT_FOUND };

  revalidatePath("/");
  redirect("/");
}

/** Completes or re-opens a quest. Used by the plain buttons in the quest list. */
export async function setTaskCompleted(formData: FormData): Promise<void> {
  await requireUser();

  const id = parseTaskId(formData.get("id"));
  const completed = formData.get("completed");
  if (!id || (completed !== "true" && completed !== "false")) return;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("tasks")
    .update({ completed_at: completed === "true" ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw new Error("Could not update the quest");

  revalidatePath("/");
}

/**
 * Pins a quest to today, or unpins it. "Today" is the user's own day (from the time zone saved in
 * their profile), worked out here on the server so the browser cannot choose the date.
 */
export async function setTaskPinned(formData: FormData): Promise<void> {
  await requireUser();

  const id = parseTaskId(formData.get("id"));
  const pinned = formData.get("pinned");
  if (!id || (pinned !== "true" && pinned !== "false")) return;

  const supabase = await createSupabaseServerClient();
  const pinnedFor = pinned === "true" ? todayIn(await getTimeZone(supabase), new Date()) : null;
  const { error } = await supabase.from("tasks").update({ pinned_for: pinnedFor }).eq("id", id);
  if (error) throw new Error("Could not update the quest");

  revalidatePath("/");
}
