import Link from "next/link";
import type { QuestView } from "@/lib/tasks/views";

const TABS: { view: QuestView; label: string }[] = [
  { view: "today", label: "Today" },
  { view: "week", label: "This week" },
  { view: "all", label: "All quests" },
];

/** Links, not scripts: each view has its own address (`/?view=week`), so back, reload and sharing work. */
export function QuestTabs({ current }: { current: QuestView }) {
  return (
    <nav aria-label="Quest views">
      <ul className="flex flex-wrap gap-2">
        {TABS.map(({ view, label }) => {
          const active = view === current;
          return (
            <li key={view}>
              <Link
                href={`/?view=${view}`}
                aria-current={active ? "page" : undefined}
                // The current tab is marked by weight, a thick underline and a filled panel as well as by
                // aria-current, never by colour alone.
                className={`block rounded border-2 border-panel-border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-panel-border ${
                  active ? "bg-panel-from font-bold underline underline-offset-4" : "bg-background"
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
