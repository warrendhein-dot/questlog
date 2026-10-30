import type { Task, TaskPriority } from "./schema";

// Pure date and view logic for the Today and This-week lists. No framework, no clock, no database:
// every function takes "today" (or the time) as an argument, so tests can pin it to any day.
//
// Dates are plain calendar dates ("2026-10-28"), compared as text. They are never turned into Date
// objects in the user's local time, because that shifts them by a day in some time zones.

export const QUEST_VIEWS = ["today", "week", "all"] as const;
export type QuestView = (typeof QUEST_VIEWS)[number];

/** The view named in the address (`?view=week`), from a fixed list. Anything else means Today. */
export function parseView(value: unknown): QuestView {
  return QUEST_VIEWS.find((view) => view === value) ?? "today";
}

/** Whether the browser or database could use this as a time zone name (for example "Africa/Johannesburg"). */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || timeZone.length === 0 || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date it is right now in the given time zone. An unknown zone counts as UTC. */
export function todayIn(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: isValidTimeZone(timeZone) ? timeZone : "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar date `days` after (or before, if negative) `date`. Both are plain YYYY-MM-DD text. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday and the Sunday of the week that contains `date`. Weeks start on Monday. */
export function weekBounds(date: string): { start: string; end: string } {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const sinceMonday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  const start = addDays(date, -sinceMonday);
  return { start, end: addDays(start, 6) };
}

type Sortable = Pick<Task, "title" | "priority" | "dueDate" | "pinnedFor" | "completedAt">;

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 2, normal: 1, low: 0 };

function byPriorityThenTitle(a: Sortable, b: Sortable): number {
  return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || a.title.localeCompare(b.title);
}

function byDueDateThenPriority(a: Sortable, b: Sortable): number {
  // Callers only pass quests that have a due date.
  return (a.dueDate as string).localeCompare(b.dueDate as string) || byPriorityThenTitle(a, b);
}

function overdue<T extends Sortable>(open: T[], today: string): T[] {
  return open.filter((t) => t.dueDate !== null && t.dueDate < today).sort(byDueDateThenPriority);
}

/**
 * Today: what is overdue (oldest first), then what is due today or pinned to today (high priority
 * first, then by title). A quest appears once: an overdue quest that is also pinned stays under
 * "overdue". Completed quests never appear.
 */
export function selectToday<T extends Sortable>(tasks: T[], today: string) {
  const open = tasks.filter((t) => t.completedAt === null);
  const late = overdue(open, today);
  const lateSet = new Set(late);
  const due = open
    .filter((t) => !lateSet.has(t) && (t.dueDate === today || t.pinnedFor === today))
    .sort(byPriorityThenTitle);
  return { overdue: late, today: due };
}

/**
 * This week: what is overdue (oldest first), then what is due from today to Sunday, soonest first.
 * Completed quests never appear.
 */
export function selectWeek<T extends Sortable>(tasks: T[], today: string) {
  const open = tasks.filter((t) => t.completedAt === null);
  const { end } = weekBounds(today);
  const upcoming = open
    .filter((t) => t.dueDate !== null && t.dueDate >= today && t.dueDate <= end)
    .sort(byDueDateThenPriority);
  return { overdue: overdue(open, today), thisWeek: upcoming };
}
