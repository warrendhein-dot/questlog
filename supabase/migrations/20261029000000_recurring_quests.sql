-- Slice 6: recurring quests, and completing quests through the database.
--
-- A quest can repeat (daily, weekly or monthly, every N, weekly on chosen weekdays). Completing a
-- repeating quest creates the next one. That is two writes (complete this, create the next, copy
-- the steps), so it happens inside one database function: either everything happens or nothing
-- does, and pressing the button twice cannot create two copies.
--
-- The date of the next occurrence is worked out by the app (src/lib/tasks/recurrence.ts) and passed
-- in; the function only checks that it is later than the current due date. A caller who passes a
-- silly date can only affect their own quests.

create type public.recurrence_frequency as enum ('daily', 'weekly', 'monthly');

-- Weekdays are numbered like ISO 8601 (1 = Monday ... 7 = Sunday): one to seven distinct values.
-- A function, because a CHECK constraint cannot contain a subquery.
create function public.valid_weekdays(days smallint[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select days is null or (
    cardinality(days) between 1 and 7
    and days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
    and cardinality(days) = (select count(distinct d) from unnest(days) as d)
  )
$$;

alter table public.tasks
  add column recur_frequency   public.recurrence_frequency,
  add column recur_interval    smallint
    check (recur_interval between 1 and 365),
  add column recur_weekdays    smallint[],
  -- The first due date of the series. Every later date is worked out from it and the rule, never
  -- from the previous occurrence, so a monthly quest on the 31st does not drift to the 28th after
  -- one February. Set by the database (see the trigger below), never by the app.
  add column recurrence_anchor date,
  -- Which quest this one was created from when its predecessor was completed.
  add column recurred_from     uuid references public.tasks (id) on delete set null,
  add constraint tasks_recurrence_shape check (
    (recur_frequency is null and recur_interval is null and recur_weekdays is null
       and recurrence_anchor is null)
    or
    (recur_frequency is not null and recur_interval is not null and recurrence_anchor is not null
       and due_date is not null)
  ),
  add constraint tasks_recur_weekdays_valid check (
    public.valid_weekdays(recur_weekdays)
    and (recur_weekdays is null or recur_frequency = 'weekly')
  );

create index tasks_recurred_from_idx on public.tasks (recurred_from) where recurred_from is not null;

-- The app may set the rule, on create and on edit. The anchor and the link to the predecessor are
-- filled in by the database only.
grant insert (recur_frequency, recur_interval, recur_weekdays) on public.tasks to authenticated;
grant update (recur_frequency, recur_interval, recur_weekdays) on public.tasks to authenticated;

-- Keeps the anchor honest. A new repeating quest is anchored on its due date. Editing the rule or
-- the due date re-anchors the series on the new due date (postponing this one shifts the series);
-- any other edit leaves the anchor alone. Turning repeating off clears it.
create function public.set_recurrence_anchor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.recur_frequency is null then
    new.recurrence_anchor := null;
  elsif tg_op = 'INSERT' then
    new.recurrence_anchor := coalesce(new.recurrence_anchor, new.due_date);
  elsif old.recurrence_anchor is null
     or new.due_date is distinct from old.due_date
     or new.recur_frequency is distinct from old.recur_frequency
     or new.recur_interval is distinct from old.recur_interval
     or new.recur_weekdays is distinct from old.recur_weekdays then
    new.recurrence_anchor := new.due_date;
  else
    new.recurrence_anchor := old.recurrence_anchor;
  end if;
  return new;
end;
$$;

revoke execute on function public.set_recurrence_anchor() from public, anon, authenticated;

create trigger tasks_set_recurrence_anchor
  before insert or update on public.tasks
  for each row execute function public.set_recurrence_anchor();

-- Completion now goes through the functions below, which stamp the time with the database's own
-- clock. Closing this gap also settles threat model item A4 (the owner could write any completion
-- time through the API).
revoke update (completed_at) on public.tasks from authenticated;

-- Completes a quest and, if it repeats, creates the next one with a copy of its steps (unticked).
--
-- SECURITY DEFINER, because it must write columns the API may not (the anchor, the link, the
-- completion time). That makes every line below responsible for ownership: each statement is
-- limited to rows of the signed-in user, taken from the session, never from an argument.
--
-- Safe to call twice: the second call finds the quest already completed and does nothing, so there
-- is never more than one next occurrence. Returns the new quest's id, or null if none was created
-- (not a repeating quest, already completed, not yours, or you have no next date).
create function public.complete_task(p_task_id uuid, p_next_due date default null)
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
   where id = p_task_id and user_id = v_user and completed_at is null
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

-- Re-opens a completed quest (Undo). If completing it created a next occurrence that nobody has
-- touched yet (still open, never edited, no step ticked), that copy is removed so Undo does not
-- leave two. Anything the user has worked on is left alone: Undo never destroys their work.
-- Returns true if a quest was re-opened.
create function public.reopen_task(p_task_id uuid)
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
   where id = p_task_id and user_id = v_user and completed_at is not null;
  if not found then
    return false;
  end if;

  delete from public.tasks t
   where t.recurred_from = p_task_id
     and t.user_id = v_user
     and t.completed_at is null
     and t.updated_at = t.created_at
     and not exists (
       select 1 from public.subtasks s where s.task_id = t.id and s.completed_at is not null
     );
  return true;
end;
$$;

-- Signed-in users only. (Supabase also grants new functions to the signed-out role by default.)
revoke execute on function public.complete_task(uuid, date) from public, anon;
revoke execute on function public.reopen_task(uuid) from public, anon;
grant execute on function public.complete_task(uuid, date) to authenticated;
grant execute on function public.reopen_task(uuid) to authenticated;
