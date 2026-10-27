import { z } from "zod";

/** A step of a quest, as the app uses it. Steps are one level deep: a step has no steps of its own. */
export type Subtask = {
  id: string;
  title: string;
  completedAt: string | null;
};

/** Progress through a quest's steps, for the quest list. */
export type StepProgress = { stepsDone: number; stepsTotal: number };

/** The result of the "add a step" form, handed back to it (and the only thing the browser sees). */
export type SubtaskFormState =
  { status: "idle" } | { status: "saved" } | { status: "error"; message: string; value?: string };

const titleSchema = z
  .string()
  .trim()
  .min(1, "Give the step a name.")
  .max(200, "Keep the step to 200 characters or fewer.");

/**
 * Validates the "add a step" form. Only the `title` field is read; anything else in the submission
 * is ignored. On failure the typed text is handed back so the form can show it again.
 */
export function parseSubtaskForm(
  formData: FormData,
): { success: true; title: string } | { success: false; message: string; value: string } {
  const raw = formData.get("title");
  // A form field can also be a file upload. Anything that is not plain text counts as missing.
  const value = typeof raw === "string" ? raw : "";
  const result = titleSchema.safeParse(value);
  if (result.success) return { success: true, title: result.data };
  return { success: false, message: result.error.issues[0]!.message, value };
}

const idSchema = z.uuid();

/** An id from the outside world (URL, form field), or null if it is not a UUID. */
export function parseSubtaskId(value: unknown): string | null {
  const result = idSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** The "all steps done" offer is made when a quest has steps and every one is ticked. */
export function allStepsDone(steps: Pick<Subtask, "completedAt">[]): boolean {
  return steps.length > 0 && steps.every((step) => step.completedAt !== null);
}
