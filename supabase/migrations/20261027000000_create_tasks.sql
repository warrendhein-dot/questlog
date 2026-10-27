-- Slice 3: tasks ("quests"). Created, edited and completed by their owner only.
--
-- Security model, enforced here in the database so it holds even if the app code has a bug:
--   * row-level security: you can only ever see and change your own rows;
--   * column-level grants: the owner, id and timestamps can never be set or changed through the API;
--   * no DELETE for now (soft delete and the Trash arrive in a later slice);
--   * size limits and a creation rate limit.

create type public.task_category as enum ('work', 'health', 'learning', 'home', 'social');
create type public.task_priority as enum ('low', 'normal', 'high');

create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  -- Filled in from the signed-in session, so the app never sends (or forges) it.
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title        text not null
                 check (char_length(btrim(title)) between 1 and 200),
  notes        text not null default ''
                 check (char_length(notes) <= 5000),
  category     public.task_category not null,
  priority     public.task_priority not null default 'normal',
  due_date     date
                 check (due_date between date '2000-01-01' and date '2100-12-31'),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.tasks enable row level security;

-- Least privilege, column by column. Signed-out visitors (anon) get nothing.
revoke all on public.tasks from anon, authenticated;
grant select on public.tasks to authenticated;
grant insert (title, notes, category, priority, due_date) on public.tasks to authenticated;
grant update (title, notes, category, priority, due_date, completed_at) on public.tasks to authenticated;

-- "(select auth.uid())" lets Postgres evaluate the user id once per query instead of once per row.
create policy tasks_select_own on public.tasks
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy tasks_insert_own on public.tasks
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy tasks_update_own on public.tasks
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Indexes for the lists the app shows (open by due date, completed by recency) and for the
-- rate-limit check below.
create index tasks_user_open_idx on public.tasks (user_id, due_date) where completed_at is null;
create index tasks_user_done_idx on public.tasks (user_id, completed_at desc) where completed_at is not null;
create index tasks_user_created_idx on public.tasks (user_id, created_at desc);

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- Creation rate limit: at most 60 new tasks per user per minute. It lives in the database so it
-- also covers anyone who talks to the API directly instead of using the app. The function runs as
-- the caller, so it only sees (and counts) the caller's own rows.
create function public.enforce_task_rate_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select count(*) from public.tasks
    where user_id = new.user_id and created_at > now() - interval '1 minute'
  ) >= 60 then
    raise exception 'task_rate_limit';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_task_rate_limit() from public, anon, authenticated;

create trigger tasks_rate_limit
  before insert on public.tasks
  for each row execute function public.enforce_task_rate_limit();
