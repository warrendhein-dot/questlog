-- Slice 4: steps ("subtasks") of a quest. One level only: a step cannot have steps of its own.
--
-- Same security model as tasks, enforced here in the database:
--   * row-level security: you can only ever see and change your own rows;
--   * column-level grants: the owner, the quest a step belongs to, and the timestamps can never be
--     set or changed through the API after creation;
--   * a step can only be attached to a quest that belongs to the same user (composite foreign key);
--   * size limits, a cap on steps per quest, and a creation rate limit.
--
-- Steps can be deleted by their owner. They are tiny, and the Trash (a later slice) is for quests.

-- A foreign key alone only proves that a quest *exists*, not whose it is: anyone who guessed a quest
-- id could hang steps on someone else's quest. Pairing the quest id with the owner id closes that.
alter table public.tasks
  add constraint tasks_id_user_id_key unique (id, user_id);

create table public.subtasks (
  id           uuid primary key default gen_random_uuid(),
  -- Filled in from the signed-in session, so the app never sends (or forges) it.
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id      uuid not null,
  title        text not null
                 check (char_length(btrim(title)) between 1 and 200),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Both columns must match one quest row: that quest has to be this user's own.
  constraint subtasks_task_owner_fkey
    foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade
);

alter table public.subtasks enable row level security;

-- Least privilege, column by column. Signed-out visitors (anon) get nothing.
revoke all on public.subtasks from anon, authenticated;
grant select on public.subtasks to authenticated;
grant insert (task_id, title) on public.subtasks to authenticated;
grant update (title, completed_at) on public.subtasks to authenticated;
grant delete on public.subtasks to authenticated;

create policy subtasks_select_own on public.subtasks
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy subtasks_insert_own on public.subtasks
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy subtasks_update_own on public.subtasks
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy subtasks_delete_own on public.subtasks
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- The steps of one quest, in the order they were added; and the rate-limit check below.
create index subtasks_task_idx on public.subtasks (task_id, created_at);
create index subtasks_user_created_idx on public.subtasks (user_id, created_at desc);

create trigger subtasks_set_updated_at
  before update on public.subtasks
  for each row execute function public.set_updated_at();

-- Limits: at most 50 steps per quest, and at most 120 new steps per user per minute. They live in
-- the database so they also cover anyone who talks to the API directly instead of using the app.
-- The function runs as the caller, so it only sees (and counts) the caller's own rows.
create function public.enforce_subtask_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select count(*) from public.subtasks where task_id = new.task_id
  ) >= 50 then
    raise exception 'subtask_limit';
  end if;
  if (
    select count(*) from public.subtasks
    where user_id = new.user_id and created_at > now() - interval '1 minute'
  ) >= 120 then
    raise exception 'subtask_rate_limit';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_subtask_limits() from public, anon, authenticated;

create trigger subtasks_limits
  before insert on public.subtasks
  for each row execute function public.enforce_subtask_limits();
