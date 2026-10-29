import { TaskList } from "@/app/tasks/task-list";
import type { TaskWithSteps } from "@/lib/tasks/queries";
import { selectToday, selectWeek, type QuestView } from "@/lib/tasks/views";

const PANEL =
  "rounded-lg border-2 border-panel-border bg-linear-to-b from-panel-from to-panel-to p-6 shadow-lg";

type Props = {
  view: QuestView;
  /** Every open quest of the signed-in user. The view picks and orders what it shows. */
  tasks: TaskWithSteps[];
  /** The user's date today (YYYY-MM-DD). */
  today: string;
};

function Group({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <h3 id={id} className="mb-2 text-lg font-bold">
        {title}
      </h3>
      {children}
    </div>
  );
}

/** The open-quests panel for the chosen view: Today, This week, or All quests. */
export function OpenQuests({ view, tasks, today }: Props) {
  if (view === "all") {
    return (
      <section aria-labelledby="open-quests" className={PANEL}>
        <h2 id="open-quests" className="mb-4 text-xl font-bold">
          Open quests
        </h2>
        <TaskList
          tasks={tasks}
          mode="open"
          today={today}
          emptyMessage="No open quests. Add your first one above."
        />
      </section>
    );
  }

  const isToday = view === "today";
  const selected = isToday ? selectToday(tasks, today) : selectWeek(tasks, today);
  const overdue = selected.overdue;
  const later = "today" in selected ? selected.today : selected.thisWeek;
  const heading = isToday ? "Today" : "This week";
  const laterTitle = isToday ? "Due or pinned for today" : "Due this week";

  return (
    <section aria-labelledby="view-quests" className={PANEL}>
      <h2 id="view-quests" className="mb-4 text-xl font-bold">
        {heading}
      </h2>
      {overdue.length === 0 && later.length === 0 && (
        <p>
          {isToday
            ? "Nothing due today. Pin a quest from All quests, or give one a due date."
            : "Nothing due this week. Quests with no due date are under All quests."}
        </p>
      )}
      {overdue.length > 0 && (
        <Group id="overdue-quests" title="Overdue">
          <TaskList tasks={overdue} mode="open" today={today} emptyMessage="" />
        </Group>
      )}
      {later.length > 0 && (
        <Group id="later-quests" title={laterTitle}>
          <TaskList tasks={later} mode="open" today={today} emptyMessage="" />
        </Group>
      )}
    </section>
  );
}
