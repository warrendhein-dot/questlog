-- Slice 2: only allow-listed Google accounts may ever create a user.
--
-- Supabase calls the "Before User Created" auth hook just before it creates a brand-new user. If the
-- hook rejects, the account is never created, so a stranger who completes Google sign-in leaves no
-- trace in auth.users and never gets a profile or any data.
--
-- The allow-list itself is DATA, not code: the owner adds their own address in the Supabase SQL editor.
-- It is deliberately not in this file, because this repository is public.

create table public.allowed_emails (
  email      text primary key
               check (email = lower(email) and char_length(email) between 3 and 254),
  created_at timestamptz not null default now()
);

alter table public.allowed_emails enable row level security;

-- No policies and no grants: the API roles (anon, authenticated) can neither read nor change this
-- table, so nobody can discover or edit the list through the app's public API.
revoke all on public.allowed_emails from anon, authenticated;

-- SECURITY DEFINER lets the hook read the table with its owner's rights, while the function itself
-- is callable only by Supabase's auth service (supabase_auth_admin). An empty search_path stops a
-- malicious schema from shadowing the objects it uses.
create function public.hook_restrict_signup(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  signup_email    text := lower(event -> 'user' ->> 'email');
  signup_provider text := event -> 'user' -> 'app_metadata' ->> 'provider';
begin
  -- Google only. Accepting email/password sign-ups would let an attacker pre-register the owner's
  -- address and later be merged with the owner's real Google identity.
  if signup_provider is distinct from 'google'
     or signup_email is null
     or not exists (select 1 from public.allowed_emails where email = signup_email)
  then
    return jsonb_build_object(
      'error',
      jsonb_build_object('http_code', 403, 'message', 'This account is not allowed to sign up.')
    );
  end if;

  return '{}'::jsonb;
end;
$$;

revoke execute on function public.hook_restrict_signup(jsonb) from public, anon, authenticated;
grant execute on function public.hook_restrict_signup(jsonb) to supabase_auth_admin;
