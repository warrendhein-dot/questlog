# Phase 1: Core quests (spec v0.1)

Goal: a signed-in, secure, deployed task list covering PRD requirements **T1-T7** (tasks, due date and priority, categories, subtasks, recurring, Today and This-week views, trash). No RPG logic yet (Phase 2) and no AI (Phase 3), but the data model must not block them.

## 1. Decisions

| Topic           | Decision                                                                 | Consequence                                                                                                                           |
| --------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in         | Google sign-in only, via Supabase Auth                                   | No passwords stored by us. The same Google identity can later grant Gmail/Calendar access (Phase 4, with separate read-only consent). |
| Who may sign in | Allow-list of one email address                                          | Anyone else who completes Google sign-in is rejected and has no data access.                                                          |
| Data store      | Supabase (hosted Postgres) with row-level security                       | The database itself refuses to show you someone else's rows, even if our app code has a bug.                                          |
| Categories      | Fixed five: Work, Health, Learning, Home, Social                         | Each maps to one RPG stat (Phase 2). Stored as a database enum, so invalid values are impossible.                                     |
| Recurring tasks | The next occurrence is created when you complete the current one         | No pile-up of duplicates. Computed from the original schedule (see 4.3).                                                              |
| Subtasks        | Parent completes automatically when all subtasks are done                | The parent cannot be completed directly while subtasks are open. One level of nesting only.                                           |
| Today view      | Due today + overdue (overdue on top) + tasks pinned to Today             | Needs a `pinned_for` date on tasks.                                                                                                   |
| Week            | Starts Monday. Time zone detected from the browser, editable in settings | Dates are stored as calendar dates in the user's time zone, and timestamps as UTC.                                                    |
| Deleting        | Soft delete to a Trash, restorable, purged after 30 days                 | Tasks carry `deleted_at`. A scheduled job purges old rows. Also protects the future XP system from delete-and-recreate tricks.        |

## 2. Data model (sketch)

All tables carry `user_id` (owner) and are protected by row-level security: `user_id = auth.uid()`.

`tasks`

- `id` (uuid), `user_id`, `parent_id` (nullable, points to another task; subtasks only, max one level)
- `title` (1-200 chars), `notes` (max 5000 chars)
- `category` (enum of the five), `priority` (`low` | `normal` | `high`)
- `due_date` (date, nullable), `pinned_for` (date, nullable)
- `completed_at` (timestamptz, nullable), `deleted_at` (timestamptz, nullable)
- `recurrence` (jsonb, nullable; validated by a Zod schema: frequency, interval, weekdays)
- `created_at`, `updated_at`
- Reserved for later phases (nullable, unused now): `size`, `source`, `source_ref`

`profiles`

- `user_id`, `time_zone`, `week_starts_on` (fixed `monday` for now)

## 3. Slices

Each slice is one branch, one PR, with tests, and merges only with green CI.

| #   | Slice                  | Delivers                                                                                                                                                        |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Supabase foundation    | Supabase client setup, environment variables in `src/lib/env.ts`, migrations folder, `profiles` table, RLS test harness                                         |
| 2   | Sign-in                | Google sign-in, session refresh in `proxy.ts`, single-email allow-list, protected routes, sign-out. **Also replaces `'unsafe-inline'` with a nonce-based CSP.** |
| 3   | Tasks: create and list | `tasks` table with RLS, create, edit and complete (T1, T2, T3), Zod validation of every input, server actions                                                   |
| 4   | Subtasks               | T4 with the auto-complete rule                                                                                                                                  |
| 5   | Today and This week    | T6 views, overdue handling, pinning                                                                                                                             |
| 6   | Recurring              | T5: pure `nextOccurrence()` function with thorough unit tests, then wiring on completion                                                                        |
| 7   | Trash                  | T7: soft delete, restore, scheduled purge after 30 days                                                                                                         |
| 8   | Deploy                 | Vercel project, preview deployment per PR, production environment variables, security review of the live site                                                   |

Slices 3-7 each add Playwright journeys. Slice 2 must include a test proving that a second account cannot read or write the first account's rows.

## 4. Behaviour details

### 4.1 Completing

Completing sets `completed_at`. A completed task leaves Today and appears under a "Done" list. Un-completing is allowed (sets `completed_at` back to null). Phase 2 will add XP rules that prevent farming this.

### 4.2 Subtasks

- Maximum one level: a subtask cannot have subtasks (enforced by a database constraint).
- Completing the final open subtask completes the parent. Completing a parent directly is blocked while subtasks are open.
- Soft-deleting a parent soft-deletes its subtasks; restoring restores them.

### 4.3 Recurring (default rule; confirm in review)

- A recurrence is `frequency` (daily, weekly, monthly), `interval` (every N), and for weekly an optional list of weekdays.
- Completing an occurrence creates the next one at the **first scheduled date after today**. If you were three Mondays late, you get next Monday, not three duplicates.
- Subtasks of a recurring task are copied (uncompleted) to the next occurrence.
- Skipping an occurrence = deleting it; the series continues only if it was completed, so deleting the final occurrence ends the series. (To revisit.)

### 4.4 Today view order

1. Overdue (oldest due date first), then
2. Due today and pinned for today (high priority first, then title).

## 5. Security requirements for this phase

- Google OAuth scopes: **`openid`, `email`, `profile` only**. No Gmail or Calendar scopes yet.
- Supabase **service-role key never reaches the browser or the repo**; the app uses the anon key plus the user's session, so RLS always applies.
- Sign-in allow-list enforced server-side and in the database (a non-allowed user's profile row is never created).
- Cookies: `httpOnly`, `secure`, `SameSite=Lax`.
- All inputs validated with Zod on the server (title length, enum values, dates, recurrence shape). The client form validation is a convenience only.
- Rate limiting on the sign-in callback and on task-creation actions.
- Strict nonce-based CSP in place by the end of slice 2 (closes the open item in `docs/THREAT-MODEL.md`).
- `docs/THREAT-MODEL.md` updated in slice 2 and slice 8.

## 6. Your part (things only you can do)

These need your own accounts and credentials. I will give step-by-step instructions at the moment each is needed, and you never paste secrets into chat.

1. Create a free **Supabase** project (slice 1).
2. Create a **Google Cloud** OAuth client and give Supabase its client ID and secret (slice 2).
3. Create a free **Vercel** account and connect the GitHub repo (slice 8).

## 7. Open questions

1. Recurring rule in 4.3: "next occurrence after today" versus "next after the completed one's due date". Default above.
2. Should a deleted occurrence end the series, or skip to the next? Default above ends it.
3. Local development database: a Docker-based local Supabase (needs Docker Desktop) or a separate hosted "dev" Supabase project. Proposed: hosted dev project, since Docker is not installed.
