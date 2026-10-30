"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTimeZone } from "@/lib/auth/profile";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCompletionContext } from "@/lib/tasks/queries";
import { nextOccurrence, type Recurrence } from "@/lib/tasks/recurrence";
import {
  inputToFormValues,
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

/** The three database columns for a repeat rule; all null for a quest that does not repeat. */
function recurrenceColumns(rule: Recurrence | null) {
  return {
    recur_frequency: rule?.frequency ?? null,
    recur_interval: rule?.interval ?? null,
    recur_weekdays: rule && rule.weekdays.length > 0 ? rule.weekdays : null,
  };
}

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
  const { title, notes, category, priority, dueDate, recurrence } = parsed.data;

  const supabase = await createSupabaseServerClient();
  // The owner is not sent: the database fills it in from the session.
  const { error } = await supabase.from("tasks").insert({
    title,
    notes,
    category,
    priority,
    due_date: dueDate,
    ...recurrenceColumns(recurrence),
  });
  if (error) return failed(inputToFormValues(parsed.data), error);

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
  const { title, notes, category, priority, dueDate, recurrence } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({
      title,
      notes,
      category,
      priority,
      due_date: dueDate,
      ...recurrenceColumns(recurrence),
    })
    .eq("id", taskId)
    .select("id");
  if (error) return failed(inputToFormValues(parsed.data), error);
  // Updating someone else's task (or one that no longer exists) changes zero rows without an error.
  if (!data || data.length === 0) return { status: "error", message: NOT_FOUND };

  revalidatePath("/");
  redirect("/");
}

/**
 * Completes or re-opens a quest. Used by the plain buttons in the quest list.
 *
 * Both go through database functions (`complete_task`, `reopen_task`), which stamp the time with the
 * database's clock and do everything in one step. Completing a repeating quest also creates the
 * next one; the date for it is worked out here, because the date rules are written once, in
 * TypeScript, and tested there.
 */
export async function setTaskCompleted(formData: FormData): Promise<void> {
  await requireUser();

  const id = parseTaskId(formData.get("id"));
  const completed = formData.get("completed");
  if (!id || (completed !== "true" && completed !== "false")) return;

  const supabase = await createSupabaseServerClient();

  if (completed === "false") {
    const { error } = await supabase.rpc("reopen_task", { p_task_id: id });
    if (error) throw new Error("Could not update the quest");
    revalidatePath("/");
    return;
  }

  let nextDue: string | null = null;
  const context = await getCompletionContext(supabase, id);
  if (context?.recurrence && context.dueDate && context.anchor && context.completedAt === null) {
    // Whichever is later, the due date or today: finishing late must not produce a copy that is
    // already in the past, and finishing early must not pull the next one forward.
    const today = todayIn(await getTimeZone(supabase), new Date());
    const after = context.dueDate > today ? context.dueDate : today;
    nextDue = nextOccurrence(context.recurrence, context.anchor, after);
  }

  const { error } = await supabase.rpc("complete_task", { p_task_id: id, p_next_due: nextDue });
  if (error) throw new Error("Could not update the quest");

  revalidatePath("/");
}

/** Everything the Trash changes shows on the home page, and on the Trash page itself. */
function refreshTrashPages() {
  revalidatePath("/");
  revalidatePath("/trash");
}

/**
 * Moves a quest to the Trash (the Delete button). The database stamps the time and refuses another
 * user's quest, and a quest already in the Trash is left alone. The edit page also sends `from=edit`;
 * that page cannot show a trashed quest, so it goes home. The destination is fixed here, never taken
 * from the form.
 */
export async function trashTask(formData: FormData): Promise<void> {
  await requireUser();

  const id = parseTaskId(formData.get("id"));
  if (!id) return;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("trash_task", { p_task_id: id });
  if (error) throw new Error("Could not delete the quest");

  refreshTrashPages();
  if (formData.get("from") === "edit") redirect("/");
}

/** Takes a quest out of the Trash (the Restore button). */
export async function restoreTask(formData: FormData): Promise<void> {
  await requireUser();

  const id = parseTaskId(formData.get("id"));
  if (!id) return;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("restore_task", { p_task_id: id });
  if (error) throw new Error("Could not restore the quest");

  refreshTrashPages();
}

/**
 * Removes a quest from the Trash for good, with its steps. It cannot be undone, so the Trash page
 * asks first. The database only allows deleting rows that are already in the Trash, so this can
 * never remove a live quest even if it were sent one.
 */
export async function deleteTaskForever(formData: FormData): Promise<void> {
  await requireUser();

  const id = parseTaskId(formData.get("id"));
  if (!id) return;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw new Error("Could not delete the quest");

  refreshTrashPages();
}

/**
 * Removes everything in the Trash for good. The filter says "in the Trash" outright, so the intent
 * is clear even before the database's own rule (only trashed rows can be deleted) is considered.
 */
export async function emptyTrash(): Promise<void> {
  await requireUser();

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("tasks").delete().not("deleted_at", "is", null);
  if (error) throw new Error("Could not empty the Trash");

  refreshTrashPages();
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
