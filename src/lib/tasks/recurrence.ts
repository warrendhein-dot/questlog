import { z } from "zod";
import { addDays } from "./views";

// Recurring quests: what a repeat rule looks like, how it is read from a form, and the date maths
// for "when is the next one due". Pure functions with no clock of their own: they take today's date
// as an argument, like the rest of src/lib/tasks, so tests can pin it to any day.
//
// Dates are plain calendar dates ("2026-10-28"), never Date objects in local time.

export const RECURRENCE_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/** Weekdays are numbered like ISO 8601: 1 = Monday ... 7 = Sunday. */
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const REPEAT_LABELS: Record<RecurrenceFrequency | "none", string> = {
  none: "Never",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

export type Recurrence = {
  frequency: RecurrenceFrequency;
  /** Every N days, weeks or months (1 to 365). */
  interval: number;
  /** For weekly rules only: which days of the week (sorted, no repeats). Empty means "the same weekday as the start". */
  weekdays: number[];
};

export const MAX_INTERVAL = 365;
const MAX_DATE = "2100-12-31";

// ---------------------------------------------------------------------------------------------
// Reading a rule from the form
// ---------------------------------------------------------------------------------------------

/** What the form holds for a rule: always text, because that is what a browser submits. */
export type RecurrenceFormValues = {
  /** "none", or one of the frequencies. */
  repeat: string;
  interval: string;
  /** The ticked weekday boxes, as "1" to "7". */
  weekdays: string[];
};

export type RecurrenceFieldErrors = Partial<Record<keyof RecurrenceFormValues, string>>;

export const EMPTY_RECURRENCE_FORM: RecurrenceFormValues = {
  repeat: "none",
  interval: "1",
  weekdays: [],
};

export function recurrenceToFormValues(rule: Recurrence | null): RecurrenceFormValues {
  if (!rule) return EMPTY_RECURRENCE_FORM;
  return {
    repeat: rule.frequency,
    interval: String(rule.interval),
    weekdays: rule.weekdays.map(String),
  };
}

const intervalSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}$/, `Use a whole number from 1 to ${MAX_INTERVAL}.`)
  .transform(Number)
  .pipe(
    z
      .number()
      .min(1, `Use a whole number from 1 to ${MAX_INTERVAL}.`)
      .max(MAX_INTERVAL, `Use a whole number from 1 to ${MAX_INTERVAL}.`),
  );

/**
 * Reads the repeat fields of the quest form. "none" means the quest does not repeat (and the other
 * fields are ignored). An empty "every" box means 1. Ticked weekdays only count for weekly rules.
 * Whether a quest that repeats also has a due date is checked by the caller, which sees both.
 */
export function parseRecurrence(
  input: RecurrenceFormValues,
): { success: true; value: Recurrence | null } | { success: false; errors: RecurrenceFieldErrors } {
  const repeat = input.repeat.trim();
  if (repeat === "" || repeat === "none") return { success: true, value: null };

  const frequency = RECURRENCE_FREQUENCIES.find((f) => f === repeat);
  if (!frequency)
    return { success: false, errors: { repeat: "Pick how often the quest repeats." } };

  const errors: RecurrenceFieldErrors = {};

  const rawInterval = input.interval.trim() === "" ? "1" : input.interval;
  const interval = intervalSchema.safeParse(rawInterval);
  if (!interval.success) errors.interval = interval.error.issues[0]!.message;

  let weekdays: number[] = [];
  if (frequency === "weekly") {
    const days = input.weekdays.map((d) => (/^[1-7]$/.test(d) ? Number(d) : null));
    if (days.includes(null)) errors.weekdays = "Pick days of the week from the list.";
    else weekdays = [...new Set(days as number[])].sort((a, b) => a - b);
  }

  if (Object.keys(errors).length > 0 || !interval.success) return { success: false, errors };
  return { success: true, value: { frequency, interval: interval.data, weekdays } };
}

// ---------------------------------------------------------------------------------------------
// Saying a rule in words
// ---------------------------------------------------------------------------------------------

const UNITS: Record<RecurrenceFrequency, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
};

/** "Repeats every day", "Repeats every 2 weeks on Mon, Thu", "Repeats every month". */
export function describeRecurrence(rule: Recurrence): string {
  const unit = UNITS[rule.frequency];
  const every = rule.interval === 1 ? `every ${unit}` : `every ${rule.interval} ${unit}s`;
  const days =
    rule.frequency === "weekly" && rule.weekdays.length > 0
      ? ` on ${rule.weekdays.map((d) => WEEKDAY_LABELS[d - 1]).join(", ")}`
      : "";
  return `Repeats ${every}${days}`;
}

// ---------------------------------------------------------------------------------------------
// The next date
// ---------------------------------------------------------------------------------------------

function parts(date: string): [number, number, number] {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return [year, month, day];
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** 1 = Monday ... 7 = Sunday. */
function isoWeekday(date: string): number {
  const [y, m, d] = parts(date);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

function mondayOf(date: string): string {
  return addDays(date, -(isoWeekday(date) - 1));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * The first date on the rule's schedule that is strictly after `after`, or null if that would be
 * past the year 2100 (the series then ends).
 *
 * The schedule is fixed by the rule and its `anchor` (the first due date of the series), and nothing
 * else. Working from the anchor each time, instead of from the previous occurrence, is what stops a
 * monthly rule on the 31st from drifting to the 28th after one February.
 *
 * - daily: the anchor, then every N days.
 * - weekly: the anchor, then every N weeks; with weekdays ticked, those days in every Nth week
 *   (weeks run Monday to Sunday, counted from the anchor's week).
 * - monthly: the anchor's day of the month, every N months; a month too short for that day uses its
 *   last day.
 *
 * Callers pass the later of "the due date just completed" and "today" as `after`, so a late
 * completion never produces a stack of already-overdue copies.
 */
export function nextOccurrence(rule: Recurrence, anchor: string, after: string): string | null {
  const start = daysBetween(anchor, addDays(after, 1)) > 0 ? addDays(after, 1) : anchor;
  let result: string | null = null;

  if (rule.frequency === "monthly") {
    const [ay, am, ad] = parts(anchor);
    const anchorIndex = ay * 12 + (am - 1);
    const [sy, sm] = parts(start);
    // Start one step early and walk forward; the loop ends within two or three turns.
    let k = Math.max(0, Math.floor((sy * 12 + (sm - 1) - anchorIndex) / rule.interval) - 1);
    for (; ; k++) {
      const index = anchorIndex + k * rule.interval;
      const year = Math.floor(index / 12);
      const month = (index % 12) + 1;
      const candidate = `${year}-${pad(month)}-${pad(Math.min(ad, daysInMonth(year, month)))}`;
      if (candidate >= start) {
        result = candidate;
        break;
      }
    }
  } else if (rule.frequency === "weekly" && rule.weekdays.length > 0) {
    const anchorWeek = mondayOf(anchor);
    // The next fitting day is at most N weeks and a few days away.
    for (let offset = 0; offset <= 7 * rule.interval + 7; offset++) {
      const day = addDays(start, offset);
      const weeks = daysBetween(anchorWeek, mondayOf(day)) / 7;
      if (rule.weekdays.includes(isoWeekday(day)) && weeks % rule.interval === 0) {
        result = day;
        break;
      }
    }
  } else {
    const step = rule.frequency === "weekly" ? rule.interval * 7 : rule.interval;
    const steps = Math.ceil(daysBetween(anchor, start) / step);
    result = addDays(anchor, steps * step);
  }

  return result !== null && result <= MAX_DATE ? result : null;
}
