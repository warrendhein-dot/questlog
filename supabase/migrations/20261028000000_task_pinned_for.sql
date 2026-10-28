-- Slice 5: pinning a quest to the Today view.
--
-- `pinned_for` holds the day (a plain calendar date) the quest is pinned to. A pin only counts on
-- its own day, so an old pin quietly stops mattering and nothing has to clear it.
--
-- Same model as the rest of `tasks`: the owner can change it on their own rows (row-level security
-- already limits that), it cannot be set at creation (it starts empty), and nobody else can touch it.

alter table public.tasks
  add column pinned_for date
    check (pinned_for between date '2000-01-01' and date '2100-12-31');

grant update (pinned_for) on public.tasks to authenticated;
