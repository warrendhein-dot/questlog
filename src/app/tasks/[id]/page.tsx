import Link from "next/link";
import { notFound } from "next/navigation";
import { trashTask, updateTask } from "@/app/tasks/actions";
import { BUTTON } from "@/app/tasks/button-style";
import { StepsPanel } from "@/app/tasks/steps-panel";
import { TaskForm } from "@/app/tasks/task-form";
import { requireUser } from "@/lib/auth/session";
import { listSubtasks } from "@/lib/subtasks/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTask } from "@/lib/tasks/queries";
import { parseTaskId, toFormValues } from "@/lib/tasks/schema";

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();

  const { id } = await params;
  const taskId = parseTaskId(id);
  if (!taskId) notFound();

  const supabase = await createSupabaseServerClient();
  // Row-level security makes someone else's quest look exactly like one that does not exist.
  const task = await getTask(supabase, taskId);
  if (!task) notFound();
  const steps = await listSubtasks(supabase, task.id);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <section
        aria-labelledby="edit-quest"
        className="rounded-lg border-2 border-panel-border bg-linear-to-b from-panel-from to-panel-to p-6 shadow-lg"
      >
        <h1 id="edit-quest" className="mb-4 text-2xl font-bold tracking-wide">
          Edit quest
        </h1>
        <TaskForm
          action={updateTask.bind(null, task.id)}
          initial={toFormValues(task)}
          submitLabel="Save changes"
        />
        {/* Its own form: a form cannot sit inside the edit form. `from=edit` sends the user home,
            because this page cannot show a quest that is in the Trash. */}
        <form action={trashTask} className="mt-4">
          <input type="hidden" name="id" value={task.id} />
          <input type="hidden" name="from" value="edit" />
          <button type="submit" className={BUTTON}>
            Delete quest
          </button>
          <span className="ml-3 text-sm">It goes to the Trash, where you can restore it.</span>
        </form>
        <p className="mt-4">
          <Link
            href="/"
            className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-panel-border"
          >
            Back to your quests
          </Link>
        </p>
      </section>

      <StepsPanel taskId={task.id} taskCompleted={task.completedAt !== null} steps={steps} />
    </main>
  );
}
