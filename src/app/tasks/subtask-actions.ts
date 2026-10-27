"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseSubtaskForm, parseSubtaskId, type SubtaskFormState } from "@/lib/subtasks/schema";

// Same order as every other action, on purpose (see actions.ts): requireUser(), validate everything
// from the browser, talk to the database as the signed-in user, report only generic messages.

const NOT_FOUND = "That quest could not be found.";

/** The edit page shows the steps in full and the home list shows a count, so both are refreshed. */
function refreshPages() {
  revalidatePath("/");
  revalidatePath("/tasks/[id]", "page");
}

function failed(value: string, error: { message?: string; code?: string }): SubtaskFormState {
  // The database says why in short codes (see the subtasks migration). Everything else stays vague.
  if (error.message?.includes("subtask_rate_limit")) {
    return {
      status: "error",
      message: "You're adding steps very quickly. Wait a minute and try again.",
      value,
    };
  }
  if (error.message?.includes("subtask_limit")) {
    return { status: "error", message: "A quest can have at most 50 steps.", value };
  }
  // 23503 = foreign key violation: the quest does not exist, or is not the signed-in user's.
  if (error.code === "23503") return { status: "error", message: NOT_FOUND, value };
  return { status: "error", message: "Could not add the step. Please try again.", value };
}

/** Bound to a quest id by the edit page: `addSubtask.bind(null, task.id)`. */
export async function addSubtask(
  taskId: string,
  _previous: SubtaskFormState,
  formData: FormData,
): Promise<SubtaskFormState> {
  await requireUser();

  const id = parseSubtaskId(taskId);
  if (!id) return { status: "error", message: NOT_FOUND };

  const parsed = parseSubtaskForm(formData);
  if (!parsed.success) return { status: "error", message: parsed.message, value: parsed.value };

  const supabase = await createSupabaseServerClient();
  // The owner is not sent: the database fills it in from the session, and only accepts a quest
  // that belongs to the same person.
  const { error } = await supabase.from("subtasks").insert({ task_id: id, title: parsed.title });
  if (error) return failed(parsed.title, error);

  refreshPages();
  return { status: "saved" };
}

/** Ticks or un-ticks a step. Used by the plain buttons on the edit page. */
export async function setSubtaskCompleted(formData: FormData): Promise<void> {
  await requireUser();

  const id = parseSubtaskId(formData.get("id"));
  const completed = formData.get("completed");
  if (!id || (completed !== "true" && completed !== "false")) return;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("subtasks")
    .update({ completed_at: completed === "true" ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw new Error("Could not update the step");

  refreshPages();
}

/** Removes a step for good. */
export async function removeSubtask(formData: FormData): Promise<void> {
  await requireUser();

  const id = parseSubtaskId(formData.get("id"));
  if (!id) return;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("subtasks").delete().eq("id", id);
  if (error) throw new Error("Could not remove the step");

  refreshPages();
}
