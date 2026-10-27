import { z } from "zod";

export const TASK_CATEGORIES = ["work", "health", "learning", "home", "social"] as const;
export const TASK_PRIORITIES = ["low", "normal", "high"] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const CATEGORY_LABELS: Record<TaskCategory, string> = {
  work: "Work",
  health: "Health",
  learning: "Learning",
  home: "Home",
  social: "Social",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
};

/** A task as the app uses it (camelCase, validated). */
export type Task = {
  id: string;
  title: string;
  notes: string;
  category: TaskCategory;
  priority: TaskPriority;
  /** Calendar date as YYYY-MM-DD. Kept as text on purpose: parsing it into a Date shifts it by time zone. */
  dueDate: string | null;
  completedAt: string | null;
};

/** What the form holds: always strings, because that is what a browser submits. */
export type TaskFormValues = {
  title: string;
  notes: string;
  category: string;
  priority: string;
  dueDate: string;
};

export type TaskFieldErrors = Partial<Record<keyof TaskFormValues, string>>;

/** The result of a form action, handed back to the form (and the only thing the browser sees). */
export type TaskFormState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; message?: string; errors?: TaskFieldErrors; values?: TaskFormValues };

export const EMPTY_TASK_FORM: TaskFormValues = {
  title: "",
  notes: "",
  category: "work",
  priority: "normal",
  dueDate: "",
};

export function toFormValues(task: Task): TaskFormValues {
  return {
    title: task.title,
    notes: task.notes,
    category: task.category,
    priority: task.priority,
    dueDate: task.dueDate ?? "",
  };
}

const MIN_DATE = "2000-01-01";
const MAX_DATE = "2100-12-31";
const isoDate = z.iso.date();

function isPlausibleDate(value: string): boolean {
  // ISO dates compare correctly as plain strings.
  return isoDate.safeParse(value).success && value >= MIN_DATE && value <= MAX_DATE;
}

const taskInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the quest a name.")
    .max(200, "Keep the name to 200 characters or fewer."),
  notes: z.string().trim().max(5000, "Keep the notes to 5000 characters or fewer."),
  category: z.enum(TASK_CATEGORIES, { error: "Pick a category." }),
  priority: z.enum(TASK_PRIORITIES, { error: "Pick a priority." }),
  dueDate: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || isPlausibleDate(value),
      "Use a real date between 2000 and 2100.",
    )
    .transform((value) => (value === "" ? null : value)),
});

export type TaskInput = z.infer<typeof taskInputSchema>;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  // A form field can also be a file upload. Anything that is not plain text counts as missing.
  return typeof value === "string" ? value : "";
}

/**
 * Validates a submitted task form. Only the five known fields are read; anything else in the
 * submission (extra fields someone added by hand) is ignored.
 */
export function parseTaskForm(
  formData: FormData,
):
  | { success: true; data: TaskInput }
  | { success: false; errors: TaskFieldErrors; values: TaskFormValues } {
  const values: TaskFormValues = {
    title: text(formData, "title"),
    notes: text(formData, "notes"),
    category: text(formData, "category"),
    priority: text(formData, "priority"),
    dueDate: text(formData, "dueDate"),
  };

  const result = taskInputSchema.safeParse(values);
  if (result.success) return { success: true, data: result.data };

  const errors: TaskFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof TaskFormValues;
    errors[field] ??= issue.message; // first problem per field only
  }
  return { success: false, errors, values };
}

const taskIdSchema = z.uuid();

/** A task id from the outside world (URL, form field), or null if it is not a UUID. */
export function parseTaskId(value: unknown): string | null {
  const result = taskIdSchema.safeParse(value);
  return result.success ? result.data : null;
}
