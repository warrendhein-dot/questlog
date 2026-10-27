import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { StepProgress } from "@/lib/subtasks/schema";
import { TASK_CATEGORIES, TASK_PRIORITIES, type Task } from "./schema";

/** A quest for the lists: the quest itself plus how many of its steps are ticked. */
export type TaskWithSteps = Task & StepProgress;

const COLUMNS = "id, title, notes, category, priority, due_date, completed_at";

// Rows from the database are checked too. If the table ever changes shape, we find out here, loudly,
// not three screens later.
const taskRowSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  notes: z.string(),
  category: z.enum(TASK_CATEGORIES),
  priority: z.enum(TASK_PRIORITIES),
  due_date: z.string().nullable(),
  completed_at: z.string().nullable(),
});

// The lists also fetch each quest's steps (just whether they are ticked) to show "2 of 5 done".
// A quest has at most 50 steps, so this stays small.
const LIST_COLUMNS = `${COLUMNS}, subtasks(completed_at)`;

const taskListRowSchema = taskRowSchema.extend({
  subtasks: z.array(z.object({ completed_at: z.string().nullable() })),
});

function toTask(row: unknown): Task {
  const parsed = taskRowSchema.parse(row);
  return {
    id: parsed.id,
    title: parsed.title,
    notes: parsed.notes,
    category: parsed.category,
    priority: parsed.priority,
    dueDate: parsed.due_date,
    completedAt: parsed.completed_at,
  };
}

function toTaskWithSteps(row: unknown): TaskWithSteps {
  const parsed = taskListRowSchema.parse(row);
  return {
    ...toTask(parsed),
    stepsTotal: parsed.subtasks.length,
    stepsDone: parsed.subtasks.filter((step) => step.completed_at !== null).length,
  };
}

// These run as the signed-in user, so row-level security already limits every query to their own
// tasks. The messages below are deliberately generic: database error text can name tables and rules.

/** Open quests: soonest due date first (no date last), then highest priority, then oldest. */
export async function listOpenTasks(supabase: SupabaseClient): Promise<TaskWithSteps[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(LIST_COLUMNS)
    .is("completed_at", null)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error("Could not load your quests");
  return (data ?? []).map(toTaskWithSteps);
}

/** The most recently completed quests. */
export async function listRecentCompletedTasks(
  supabase: SupabaseClient,
  limit = 20,
): Promise<TaskWithSteps[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(LIST_COLUMNS)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("Could not load your completed quests");
  return (data ?? []).map(toTaskWithSteps);
}

/** One quest by id, or null if it does not exist or is not the signed-in user's. */
export async function getTask(supabase: SupabaseClient, id: string): Promise<Task | null> {
  const { data, error } = await supabase.from("tasks").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load the quest");
  return data ? toTask(data) : null;
}
