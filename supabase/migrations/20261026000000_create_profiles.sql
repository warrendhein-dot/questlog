-- Slice 1: profiles.
-- One row per signed-in user, holding app settings. Every table in this app carries the owner's
-- user_id and is protected by row-level security (RLS): the database itself refuses to show or
-- change another user's rows, even if our application code has a bug.

create table public.profiles (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  time_zone      text not null default 'UTC'
                   check (char_length(time_zone) between 1 and 64),
  week_starts_on text not null default 'monday'
                   check (week_starts_on in ('monday')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Least privilege. Signed-out visitors (role "anon") get nothing. Signed-in users (role
-- "authenticated") can read, create and update, but never delete: a profile is removed only when
-- the user's account is deleted (cascade above).
revoke all on public.profiles from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;

-- "(select auth.uid())" lets Postgres evaluate the user id once per query instead of once per row.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Keep updated_at honest without trusting the application to set it.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
