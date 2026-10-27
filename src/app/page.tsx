import { signOut } from "@/app/auth/actions";
import { createTask } from "@/app/tasks/actions";
import { TaskForm } from "@/app/tasks/task-form";
import { TaskList } from "@/app/tasks/task-list";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listOpenTasks, listRecentCompletedTasks } from "@/lib/tasks/queries";

const PANEL =
  "rounded-lg border-2 border-panel-border bg-linear-to-b from-panel-from to-panel-to p-6 shadow-lg";

export default async function Home() {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();
  const [openTasks, doneTasks] = await Promise.all([
    listOpenTasks(supabase),
    listRecentCompletedTasks(supabase),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <header className={PANEL}>
        <h1 className="text-2xl font-bold tracking-wide">Questlog</h1>
        <p className="mt-3 text-sm">Signed in as {user.email}</p>
      </header>

      <section aria-labelledby="new-quest" className={PANEL}>
        <h2 id="new-quest" className="mb-4 text-xl font-bold">
          New quest
        </h2>
        <TaskForm action={createTask} submitLabel="Add quest" />
      </section>

      <section aria-labelledby="open-quests" className={PANEL}>
        <h2 id="open-quests" className="mb-4 text-xl font-bold">
          Open quests
        </h2>
        <TaskList
          tasks={openTasks}
          mode="open"
          emptyMessage="No open quests. Add your first one above."
        />
      </section>

      <section aria-labelledby="done-quests" className={PANEL}>
        <h2 id="done-quests" className="mb-4 text-xl font-bold">
          Completed
        </h2>
        <TaskList tasks={doneTasks} mode="done" emptyMessage="Nothing completed yet." />
      </section>

      <form action={signOut}>
        <button
          type="submit"
          className="w-full rounded border-2 border-panel-border bg-background px-4 py-3 font-bold hover:bg-panel-from focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-panel-border"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
