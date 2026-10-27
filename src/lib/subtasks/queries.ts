import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Subtask } from "./schema";

// Rows from the database are checked too, like everywhere else: if the table ever changes shape we
// find out here, loudly.
const subtaskRowSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  completed_at: z.string().nullable(),
});

/**
 * The steps of one quest, in the order they were added. Runs as the signed-in user, so row-level
 * security already limits it to their own steps; the message is generic on purpose.
 */
export async function listSubtasks(supabase: SupabaseClient, taskId: string): Promise<Subtask[]> {
  const { data, error } = await supabase
    .from("subtasks")
    .select("id, title, completed_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error("Could not load the steps");
  return (data ?? []).map((row) => {
    const parsed = subtaskRowSchema.parse(row);
    return { id: parsed.id, title: parsed.title, completedAt: parsed.completed_at };
  });
}
