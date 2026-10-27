import { setTaskCompleted } from "@/app/tasks/actions";
import { AddStepForm } from "@/app/tasks/add-step-form";
import { addSubtask, removeSubtask, setSubtaskCompleted } from "@/app/tasks/subtask-actions";
import { allStepsDone, type Subtask } from "@/lib/subtasks/schema";

type Props = {
  taskId: string;
  /** Whether the quest itself is already completed. */
  taskCompleted: boolean;
  steps: Subtask[];
};

const BUTTON =
  "rounded border-2 border-panel-border bg-background px-3 py-1 font-bold hover:bg-panel-from focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-panel-border";

export function StepsPanel({ taskId, taskCompleted, steps }: Props) {
  const done = steps.filter((step) => step.completedAt !== null).length;

  return (
    <section
      aria-labelledby="quest-steps"
      className="rounded-lg border-2 border-panel-border bg-linear-to-b from-panel-from to-panel-to p-6 shadow-lg"
    >
      <h2 id="quest-steps" className="mb-4 text-xl font-bold">
        Steps
      </h2>

      {steps.length === 0 ? (
        <p className="mb-4">No steps yet. Break the quest into smaller steps below.</p>
      ) : (
        <>
          <p className="mb-3 text-sm">
            {done} of {steps.length} done
          </p>

          {/* The quest is never completed automatically: ticking the last step only makes an offer. */}
          {allStepsDone(steps) && !taskCompleted && (
            <div role="status" className="mb-4 rounded border-2 border-panel-border p-3">
              <p className="mb-2 font-bold">All steps done. Complete the quest?</p>
              <form action={setTaskCompleted}>
                <input type="hidden" name="id" value={taskId} />
                <input type="hidden" name="completed" value="true" />
                <button type="submit" className={BUTTON}>
                  Complete quest
                </button>
              </form>
            </div>
          )}
          {taskCompleted && <p className="mb-3 text-sm">This quest is completed.</p>}

          <ul className="mb-4 space-y-3">
            {steps.map((step) => {
              const isDone = step.completedAt !== null;
              return (
                <li
                  key={step.id}
                  className="flex items-start justify-between gap-3 rounded border-2 border-panel-border p-3"
                >
                  <div className="min-w-0">
                    <span className={isDone ? "line-through" : undefined}>{step.title}</span>
                    {/* Written out as well as struck through: never conveyed by styling alone. */}
                    <p className="mt-1 text-sm">{isDone ? "Done" : "To do"}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <form action={setSubtaskCompleted}>
                      <input type="hidden" name="id" value={step.id} />
                      <input type="hidden" name="completed" value={isDone ? "false" : "true"} />
                      <button
                        type="submit"
                        // The spoken name must start with the visible word (WCAG 2.5.3).
                        aria-label={`${isDone ? "Undo" : "Mark done"} step: ${step.title}`}
                        className={BUTTON}
                      >
                        {isDone ? "Undo" : "Mark done"}
                      </button>
                    </form>
                    <form action={removeSubtask}>
                      <input type="hidden" name="id" value={step.id} />
                      <button
                        type="submit"
                        aria-label={`Remove step: ${step.title}`}
                        className={BUTTON}
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <AddStepForm action={addSubtask.bind(null, taskId)} />
    </section>
  );
}
