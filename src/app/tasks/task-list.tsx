import Link from "next/link";
import { setTaskCompleted } from "@/app/tasks/actions";
import type { TaskWithSteps } from "@/lib/tasks/queries";
import { CATEGORY_LABELS, PRIORITY_LABELS } from "@/lib/tasks/schema";

type Props = {
  tasks: TaskWithSteps[];
  /** "open" shows a Complete button, "done" shows an Undo button. */
  mode: "open" | "done";
  emptyMessage: string;
};

export function TaskList({ tasks, mode, emptyMessage }: Props) {
  if (tasks.length === 0) return <p>{emptyMessage}</p>;

  return (
    <ul className="space-y-3">
      {tasks.map((task) => (
        <li
          key={task.id}
          className="flex items-start justify-between gap-3 rounded border-2 border-panel-border p-3"
        >
          <div className="min-w-0">
            <Link
              href={`/tasks/${task.id}`}
              className="font-bold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-panel-border"
            >
              {task.title}
            </Link>
            {/* Priority and category are written out, never conveyed by colour alone. */}
            <p className="mt-1 text-sm">
              {CATEGORY_LABELS[task.category]} · {PRIORITY_LABELS[task.priority]} priority
              {task.dueDate ? ` · Due ${task.dueDate}` : ""}
            </p>
            {task.stepsTotal > 0 && (
              <p className="mt-1 text-sm">
                Steps: {task.stepsDone} of {task.stepsTotal} done
              </p>
            )}
          </div>
          <form action={setTaskCompleted}>
            <input type="hidden" name="id" value={task.id} />
            <input type="hidden" name="completed" value={mode === "open" ? "true" : "false"} />
            <button
              type="submit"
              // The spoken name must START WITH the visible word (WCAG 2.5.3, "Label in Name"), so a
              // voice-control user who says "click Undo" finds this button.
              aria-label={`${mode === "open" ? "Complete" : "Undo"} quest: ${task.title}`}
              className="rounded border-2 border-panel-border bg-background px-3 py-1 font-bold hover:bg-panel-from focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-panel-border"
            >
              {mode === "open" ? "Complete" : "Undo"}
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
