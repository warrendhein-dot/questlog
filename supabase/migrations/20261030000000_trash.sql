-- Slice 7: the Trash (T7). Deleting a quest moves it to the Trash; from there it can be restored,
-- deleted for good, or it is purged automatically after 30 days.
--
-- Security model, enforced here in the database so it holds even if the app code has a bug:
--   * `deleted_at` can never be written through the API (no column grant). It is set by trash_task()
--     and cleared by restore_task(), both of which stamp the time with the database's clock;
--   * a quest in the Trash is FROZEN: the row-level security rules refuse to update it, and
--     complete_task() / reopen_task() ignore it. Its steps cannot be added to, ticked or removed either;
--   * "Delete forever" is a real DELETE, but the rules only allow it on rows that are already in the
--     Trash, so a live quest can never be removed that way;
--   * the 30-day purge is a plain function that nobody signed in can call. The database's scheduler
--     (pg_cron) runs it daily.

alter table public.tasks add column deleted_at timestamptz;

-- The purge looks up old trash; the Trash page lists a user's own.
create index tasks_trashed_idx on public.tasks (deleted_at) where deleted_at is not null;

-- ---------------------------------------------------------------------------------------------
-- A quest in the Trash is frozen
-- ---------------------------------------------------------------------------------------------

-- Same rule as before, plus "not in the Trash" both before and after. deleted_at is not a column the
-- API may write, so this is what stops an edit, a pin or a completion reaching a trashed quest.
drop policy tasks_update_own on public.tasks;
create policy tasks_update_own on public.tasks
  for update to authenticated
  using ((select auth.uid()) = user_id and deleted_at is null)
  with check ((select auth.uid()) = user_id and deleted_at is null);

-- Delete forever: only your own rows, and only ones already in the Trash.
grant delete on public.tasks to authenticated;
create policy tasks_delete_trashed_own on public.tasks
  for delete to authenticated
  using ((select auth.uid()) = user_id and deleted_at is not null);

-- Steps hang on a quest, so a trashed quest's steps are frozen with it: nothing can be added, ticked,
-- renamed or removed until the quest is restored. (Deleting the quest forever still removes them: the
-- foreign key cascades.) The subquery runs as the caller, so it only ever sees their own quests.
drop policy subtasks_insert_own on public.subtasks;
create policy subtasks_insert_own on public.subtasks
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.tasks t
       where t.id = task_id and t.user_id = (select auth.uid()) and t.deleted_at is null
    )
  );

drop policy subtasks_update_own on public.subtasks;
create policy subtasks_update_own on public.subtasks
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.tasks t
       where t.id = task_id and t.user_id = (select auth.uid()) and t.deleted_at is null
    )
  )
  with check ((select auth.uid()) = user_id);

drop policy subtasks_delete_own on public.subtasks;
create policy subtasks_delete_own on public.subtasks
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.tasks t
       where t.id = task_id and t.user_id = (select auth.uid()) and t.deleted_at is null
    )
  );

-- ---------------------------------------------------------------------------------------------
-- Moving a quest into the Trash and back
-- ---------------------------------------------------------------------------------------------

-- These two run with the function owner's rights because the API may not write deleted_at. That is
-- why every statement is limited to the signed-in user's rows (taken from the session, never from an
-- argument), and why signed-out callers are refused.
--
-- Trashing a quest that is already in the Trash does nothing, so the time it was deleted (which
-- starts the 30 days) is never moved by a second call. Both return true if a quest was changed.
create function public.trash_task(p_task_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not_signed_in';
  end if;

  update public.tasks
     set deleted_at = now()
   where id = p_task_id and user_id = v_user and deleted_at is null;
  return found;
end;
$$;

create function public.restore_task(p_task_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not_signed_in';
  end if;

  update public.tasks
     set deleted_at = null
   where id = p_task_id and user_id = v_user and deleted_at is not null;
  return found;
end;
$$;

-- Signed-in users only. (Supabase also grants new functions to the signed-out role by default.)
revoke execute on function public.trash_task(uuid) from public, anon;
revoke execute on function public.restore_task(uuid) from public, anon;
grant execute on function public.trash_task(uuid) to authenticated;
grant execute on function public.restore_task(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Repeating quests and the Trash
-- ---------------------------------------------------------------------------------------------

-- Same functions as in the recurring-quests migration with two additions, both "not in the Trash":
--   * a quest in the Trash can be neither completed nor re-opened;
--   * Undo never removes a next occurrence that is in the Trash (it may be restored later).
-- Because "is there already a next occurrence" counts trashed ones too, trashing the next occurrence
-- ends the series: completing the earlier one again does not create another. Restoring it continues it.
create or replace function public.complete_task(p_task_id uuid, p_next_due date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_task public.tasks;
  v_new  uuid;
begin
  if v_user is null then
    raise exception 'not_signed_in';
  end if;

  update public.tasks
     set completed_at = now()
   where id = p_task_id and user_id = v_user and completed_at is null and deleted_at is null
  returning * into v_task;
  if not found then
    return null;
  end if;

  if v_task.recur_frequency is null or p_next_due is null then
    return null;
  end if;
  -- Completed before and re-opened since: the next occurrence already exists, do not add another.
  if exists (select 1 from public.tasks where recurred_from = v_task.id and user_id = v_user) then
    return null;
  end if;
  if p_next_due <= v_task.due_date then
    raise exception 'invalid_next_due';
  end if;

  insert into public.tasks (
    user_id, title, notes, category, priority, due_date,
    recur_frequency, recur_interval, recur_weekdays, recurrence_anchor, recurred_from
  ) values (
    v_user, v_task.title, v_task.notes, v_task.category, v_task.priority, p_next_due,
    v_task.recur_frequency, v_task.recur_interval, v_task.recur_weekdays, v_task.recurrence_anchor,
    v_task.id
  )
  returning id into v_new;

  -- Same steps, same order (their created_at is kept so the order survives), all to do again.
  insert into public.subtasks (user_id, task_id, title, created_at)
  select v_user, v_new, title, created_at
    from public.subtasks
   where task_id = v_task.id and user_id = v_user;

  return v_new;
end;
$$;

create or replace function public.reopen_task(p_task_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not_signed_in';
  end if;

  update public.tasks
     set completed_at = null
   where id = p_task_id and user_id = v_user and completed_at is not null and deleted_at is null;
  if not found then
    return false;
  end if;

  delete from public.tasks t
   where t.recurred_from = p_task_id
     and t.user_id = v_user
     and t.deleted_at is null
     and t.completed_at is null
     and t.updated_at = t.created_at
     and not exists (
       select 1 from public.subtasks s where s.task_id = t.id and s.completed_at is not null
     );
  return true;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The 30-day purge
-- ---------------------------------------------------------------------------------------------

-- Removes quests that have been in the Trash for more than 30 days (their steps go with them).
-- Returns how many were removed. It runs as the database's own scheduler, which is not subject to
-- row-level security, so NOBODY signed in may call it: it would otherwise delete every user's trash.
create function public.purge_trash()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_removed integer;
begin
  delete from public.tasks where deleted_at < now() - interval '30 days';
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke execute on function public.purge_trash() from public, anon, authenticated;

-- Run it every day at 03:17 (database time, UTC). pg_cron is Supabase's built-in scheduler. It is
-- missing from the in-process test database, so this part is skipped there; CI checks on a real
-- local Supabase that the job exists. Scheduling the same name again replaces the job.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('purge-trash', '17 3 * * *', 'select public.purge_trash()');
  end if;
end;
$$;
