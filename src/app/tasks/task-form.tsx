"use client";

import { useActionState, useId, type ReactNode } from "react";
import {
  MAX_INTERVAL,
  RECURRENCE_FREQUENCIES,
  REPEAT_LABELS,
  WEEKDAY_NAMES,
} from "@/lib/tasks/recurrence";
import {
  CATEGORY_LABELS,
  EMPTY_TASK_FORM,
  PRIORITY_LABELS,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  type TaskFormState,
  type TaskFormValues,
} from "@/lib/tasks/schema";

type Props = {
  /** The server action to run on submit. */
  action: (previous: TaskFormState, formData: FormData) => Promise<TaskFormState>;
  /** What the fields start with: empty for a new quest, the saved values when editing. */
  initial?: TaskFormValues;
  submitLabel: string;
};

const CONTROL =
  "w-full rounded border-2 border-panel-border bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-panel-border";

// Side by side, a long label that wraps pushes its box lower than its neighbour's. These classes
// reserve two lines of label height and sit the text at the bottom, so both boxes start level.
const LEVEL_LABEL = "sm:flex sm:min-h-12 sm:items-end";
const SAME_HEIGHT = "h-11";

function Field({
  id,
  label,
  error,
  labelClassName = "",
  children,
}: {
  id: string;
  label: string;
  error?: string;
  labelClassName?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className={`mb-1 block font-bold ${labelClassName}`}>
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

export function TaskForm({ action, initial = EMPTY_TASK_FORM, submitLabel }: Props) {
  // `attempt` counts finished submissions. It is the key that rebuilds the fields below after each
  // result: a browser keeps a <select>'s old choice when new default values arrive, so without a
  // fresh start a rejected form could silently put the category back to "Work".
  const [tracked, formAction, pending] = useActionState<
    { result: TaskFormState; attempt: number },
    FormData
  >(
    async (previous, formData) => ({
      result: await action(previous.result, formData),
      attempt: previous.attempt + 1,
    }),
    { result: { status: "idle" }, attempt: 0 },
  );
  const state = tracked.result;
  const prefix = useId();

  // After a rejected submission the form shows what the user typed, not a blank form.
  const values = state.status === "error" && state.values ? state.values : initial;
  const errors = state.status === "error" ? (state.errors ?? {}) : {};
  const describedBy = (field: string, hasError: boolean) =>
    hasError ? `${prefix}-${field}-error` : undefined;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div key={tracked.attempt} className="space-y-4">
        {state.status === "error" && state.message && (
          <p role="alert" className="rounded border-2 border-panel-border p-3">
            {state.message}
          </p>
        )}
        {state.status === "saved" && (
          <p role="status" className="rounded border-2 border-panel-border p-3">
            Quest added.
          </p>
        )}

        <Field id={`${prefix}-title`} label="Quest name" error={errors.title}>
          <input
            id={`${prefix}-title`}
            name="title"
            type="text"
            required
            maxLength={200}
            defaultValue={values.title}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={describedBy("title", Boolean(errors.title))}
            className={CONTROL}
          />
        </Field>

        <Field id={`${prefix}-notes`} label="Notes (optional)" error={errors.notes}>
          <textarea
            id={`${prefix}-notes`}
            name="notes"
            rows={3}
            maxLength={5000}
            defaultValue={values.notes}
            aria-invalid={errors.notes ? true : undefined}
            aria-describedby={describedBy("notes", Boolean(errors.notes))}
            className={CONTROL}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field id={`${prefix}-category`} label="Category" error={errors.category}>
            <select
              id={`${prefix}-category`}
              name="category"
              defaultValue={values.category}
              aria-invalid={errors.category ? true : undefined}
              aria-describedby={describedBy("category", Boolean(errors.category))}
              className={CONTROL}
            >
              {TASK_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </Field>

          <Field id={`${prefix}-priority`} label="Priority" error={errors.priority}>
            <select
              id={`${prefix}-priority`}
              name="priority"
              defaultValue={values.priority}
              aria-invalid={errors.priority ? true : undefined}
              aria-describedby={describedBy("priority", Boolean(errors.priority))}
              className={CONTROL}
            >
              {TASK_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </option>
              ))}
            </select>
          </Field>

          <Field id={`${prefix}-dueDate`} label="Due date (optional)" error={errors.dueDate}>
            <input
              id={`${prefix}-dueDate`}
              name="dueDate"
              type="date"
              min="2000-01-01"
              max="2100-12-31"
              defaultValue={values.dueDate}
              aria-invalid={errors.dueDate ? true : undefined}
              aria-describedby={describedBy("dueDate", Boolean(errors.dueDate))}
              className={CONTROL}
            />
          </Field>
        </div>

        <fieldset className="space-y-4 rounded border-2 border-panel-border p-3">
          <legend className="px-1 font-bold">Repeat</legend>
          <p className="text-sm">
            A repeating quest needs a due date. When you complete it, the next one is created
            automatically.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id={`${prefix}-repeat`}
              label="Repeats"
              error={errors.repeat}
              labelClassName={LEVEL_LABEL}
            >
              <select
                id={`${prefix}-repeat`}
                name="repeat"
                defaultValue={values.repeat}
                aria-invalid={errors.repeat ? true : undefined}
                aria-describedby={describedBy("repeat", Boolean(errors.repeat))}
                className={`${CONTROL} ${SAME_HEIGHT}`}
              >
                {(["none", ...RECURRENCE_FREQUENCIES] as const).map((choice) => (
                  <option key={choice} value={choice}>
                    {REPEAT_LABELS[choice]}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              id={`${prefix}-interval`}
              label="Every (number of days, weeks or months)"
              error={errors.interval}
              labelClassName={LEVEL_LABEL}
            >
              <input
                id={`${prefix}-interval`}
                name="interval"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_INTERVAL}
                defaultValue={values.interval}
                aria-invalid={errors.interval ? true : undefined}
                aria-describedby={describedBy("interval", Boolean(errors.interval))}
                className={`${CONTROL} ${SAME_HEIGHT}`}
              />
            </Field>
          </div>

          <fieldset aria-describedby={describedBy("weekdays", Boolean(errors.weekdays))}>
            <legend className="mb-2 font-bold">On these days (weekly only, optional)</legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              {WEEKDAY_NAMES.map((name, index) => (
                <label key={name} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="weekdays"
                    value={index + 1}
                    defaultChecked={values.weekdays.includes(String(index + 1))}
                    className="size-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-panel-border"
                  />
                  {name}
                </label>
              ))}
            </div>
            {errors.weekdays && (
              <p id={`${prefix}-weekdays-error`} className="mt-1 text-sm">
                {errors.weekdays}
              </p>
            )}
          </fieldset>
        </fieldset>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded border-2 border-panel-border bg-background px-4 py-3 font-bold hover:bg-panel-from focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-panel-border disabled:opacity-70"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
