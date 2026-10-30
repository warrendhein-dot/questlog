import Link from "next/link";
import { emptyTrash } from "@/app/tasks/actions";
import { ConfirmAction } from "@/app/tasks/confirm-action";
import { TrashList } from "@/app/trash/trash-list";
import { getTimeZone } from "@/lib/auth/profile";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listTrashedTasks } from "@/lib/tasks/queries";
import { TRASH_DAYS } from "@/lib/tasks/trash";

const PANEL =
  "rounded-lg border-2 border-panel-border bg-linear-to-b from-panel-from to-panel-to p-6 shadow-lg";

export default async function TrashPage() {
  await requireUser();

  const supabase = await createSupabaseServerClient();
  const [tasks, timeZone] = await Promise.all([listTrashedTasks(supabase), getTimeZone(supabase)]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <section aria-labelledby="trash" className={PANEL}>
        <h1 id="trash" className="mb-2 text-2xl font-bold tracking-wide">
          Trash
        </h1>
        <p className="mb-4 text-sm">
          Deleted quests stay here for {TRASH_DAYS} days. You can restore them until then; after
          that they are removed for good.
        </p>

        <TrashList tasks={tasks} timeZone={timeZone} />

        {tasks.length > 0 && (
          <div className="mt-4">
            <ConfirmAction
              action={emptyTrash}
              label="Empty Trash"
              accessibleLabel="Empty Trash: delete everything in it for good"
              question={`Delete all ${tasks.length} ${tasks.length === 1 ? "quest" : "quests"} in the Trash for good? This cannot be undone.`}
              confirmLabel="Yes, empty the Trash"
            />
          </div>
        )}

        <p className="mt-4">
          <Link
            href="/"
            className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-panel-border"
          >
            Back to your quests
          </Link>
        </p>
      </section>
    </main>
  );
}
