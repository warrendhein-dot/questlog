import { addDays, todayIn } from "./views";

// The Trash keeps a deleted quest for 30 days, then the database purges it (see purge_trash() in the
// trash migration). Pure functions with no clock of their own, like the rest of src/lib/tasks.

export const TRASH_DAYS = 30;

/**
 * The calendar date (YYYY-MM-DD) on which a quest was deleted, in the user's own time zone.
 * `deletedAt` is the ISO timestamp the database stored.
 */
export function deletedOn(deletedAt: string, timeZone: string): string {
  return todayIn(timeZone, new Date(deletedAt));
}

/**
 * The calendar date after which a quest deleted at `deletedAt` is purged, in the user's time zone.
 * The purge runs once a day (at 03:17 UTC), so the quest can stay up to a day past this date; the
 * page words it as "around".
 */
export function purgeDate(deletedAt: string, timeZone: string): string {
  return addDays(deletedOn(deletedAt, timeZone), TRASH_DAYS);
}
