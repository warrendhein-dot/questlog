import { deleteTaskForever, restoreTask } from "@/app/tasks/actions";
import { BUTTON } from "@/app/tasks/button-style";
import { ConfirmAction } from "@/app/tasks/confirm-action";
import type { TrashedTask } from "@/lib/tasks/queries";
import { describeRecurrence } from "@/lib/tasks/recurrence";
import { CATEGORY_LABELS, PRIORITY_LABELS } from "@/lib/tasks/schema";
import { deletedOn, purgeDate } from "@/lib/tasks/trash";

type Props = {
  tasks: TrashedTask[];
  /** The user's time zone, so the dates are the user's own days. */
  timeZone: string;
};

/** The quests in the Trash, each with Restore and Delete forever. */
export function TrashList({ tasks, timeZone }: Props) {
  if (tasks.length === 0) return <p>The Trash is empty.</p>;

  return (
    <ul className="space-y-3">
      {tasks.map((task) => (
        <li
          key={task.id}
          className="flex items-start justify-between gap-3 rounded border-2 border-panel-border p-3"
        >
          <div className="min-w-0">
            {/* A trashed quest has no page to open, so its title is plain text, not a link. */}
            <p className="font-bold">{task.title}</p>
            <p className="mt-1 text-sm">
              {CATEGORY_LABELS[task.category]} · {PRIORITY_LABELS[task.priority]} priority
              {task.dueDate ? ` · Due ${task.dueDate}` : ""}
            </p>
            {task.recurrence && (
              <p className="mt-1 text-sm">{describeRecurrence(task.recurrence)}</p>
            )}
            <p className="mt-1 text-sm">
              Deleted {deletedOn(task.deletedAt, timeZone)} · removed for good around{" "}
              {purgeDate(task.deletedAt, timeZone)}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <form action={restoreTask}>
              <input type="hidden" name="id" value={task.id} />
              <button
                type="submit"
                // The spoken name must START WITH the visible word (WCAG 2.5.3, "Label in Name").
                aria-label={`Restore quest: ${task.title}`}
                className={BUTTON}
              >
                Restore
              </button>
            </form>
            <ConfirmAction
              action={deleteTaskForever}
              fields={{ id: task.id }}
              label="Delete forever"
              accessibleLabel={`Delete forever: ${task.title}`}
              question={`Delete "${task.title}" for good? This cannot be undone.`}
              confirmLabel="Yes, delete forever"
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
