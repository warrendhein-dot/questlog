"use client";

import { useActionState, useId } from "react";
import type { SubtaskFormState } from "@/lib/subtasks/schema";

type Props = {
  /** The server action to run on submit, already bound to a quest: `addSubtask.bind(null, id)`. */
  action: (previous: SubtaskFormState, formData: FormData) => Promise<SubtaskFormState>;
};

const CONTROL =
  "w-full rounded border-2 border-panel-border bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-panel-border";

export function AddStepForm({ action }: Props) {
  // `attempt` counts finished submissions and keys the field, like in TaskForm: after a success the
  // field starts empty again, after a rejection it starts with what the user typed.
  const [tracked, formAction, pending] = useActionState<
    { result: SubtaskFormState; attempt: number },
    FormData
  >(
    async (previous, formData) => ({
      result: await action(previous.result, formData),
      attempt: previous.attempt + 1,
    }),
    { result: { status: "idle" }, attempt: 0 },
  );
  const state = tracked.result;
  const id = useId();
  const hasError = state.status === "error";

  return (
    <form action={formAction} className="space-y-3" noValidate>
      {hasError && (
        <p role="alert" className="rounded border-2 border-panel-border p-3">
          {state.message}
        </p>
      )}
      {state.status === "saved" && (
        <p role="status" className="rounded border-2 border-panel-border p-3">
          Step added.
        </p>
      )}
      <div key={tracked.attempt}>
        <label htmlFor={`${id}-title`} className="mb-1 block font-bold">
          New step
        </label>
        <input
          id={`${id}-title`}
          name="title"
          type="text"
          required
          maxLength={200}
          defaultValue={hasError ? (state.value ?? "") : ""}
          aria-invalid={hasError ? true : undefined}
          className={CONTROL}
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded border-2 border-panel-border bg-background px-4 py-2 font-bold hover:bg-panel-from focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-panel-border disabled:opacity-70"
      >
        {pending ? "Adding…" : "Add step"}
      </button>
    </form>
  );
}
