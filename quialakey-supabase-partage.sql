-- Conversion d'un projet Supabase Quialakey existant en projet multi-agences.
-- Faire une sauvegarde verifiee avant execution. Executer une seule fois dans
-- le projet Century 21 Les Minimes a conserver, deja installe avec
-- quialakey-supabase-complet.sql. Ne pas executer dans un autre projet.
-- Ne jamais executer quialakey-supabase-complet.sql apres cette conversion.

begin;

alter table public.app_state
  add column if not exists agency_id text;

-- Le declencheur anti-ecrasement exige la version precedente lors d'un UPDATE.
update public.app_state
set agency_id = 'century21lesminimes',
    expected_updated_at = updated_at
where agency_id is null;

alter table public.app_state
  alter column agency_id set not null;

alter table public.app_state
  drop constraint if exists app_state_pkey;
alter table public.app_state
  add primary key (agency_id, key);

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.agency_accounts (
  agency_id text primary key,
  login_code text not null unique,
  password_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  constraint agency_id_format check (agency_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint login_code_format check (login_code ~ '^[A-Z0-9-]{4,32}$')
);

alter table public.agency_accounts enable row level security;
revoke all on public.agency_accounts from public, anon, authenticated;

create table if not exists public.agency_sessions (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  agency_id text not null references public.agency_accounts(agency_id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '12 hours')
);
create index if not exists agency_sessions_agency_idx on public.agency_sessions (agency_id);
alter table public.agency_sessions enable row level security;
revoke all on public.agency_sessions from public, anon, authenticated;

create or replace function public.current_agency_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select agency_id
  from public.agency_sessions
  where auth_user_id = (select auth.uid()) and expires_at > now()
  limit 1;
$$;

revoke all on function public.current_agency_id() from public, anon;
grant execute on function public.current_agency_id() to authenticated;

create or replace function public.login_agency(p_login_code text, p_password text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare account public.agency_accounts%rowtype;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) is not true then
    raise exception 'Session invalide';
  end if;
  select * into account from public.agency_accounts
  where login_code = upper(trim(p_login_code)) for update;
  if not found then return null; end if;
  if account.locked_until > now() then return null; end if;
  if p_password is null or account.password_hash <> extensions.crypt(p_password, account.password_hash) then
    update public.agency_accounts
    set failed_attempts = case when failed_attempts >= 9 then 0 else failed_attempts + 1 end,
        locked_until = case when failed_attempts >= 9 then now() + interval '15 minutes' else null end
    where agency_id = account.agency_id;
    return null;
  end if;
  update public.agency_accounts set failed_attempts = 0, locked_until = null
  where agency_id = account.agency_id;
  insert into public.agency_sessions (auth_user_id, agency_id)
  values (auth.uid(), account.agency_id)
  on conflict (auth_user_id) do update
  set agency_id = excluded.agency_id, expires_at = now() + interval '12 hours';
  return account.agency_id;
end;
$$;
revoke all on function public.login_agency(text, text) from public, anon;
grant execute on function public.login_agency(text, text) to authenticated;

create or replace function public.logout_agency()
returns void language sql security definer set search_path = ''
as $$ delete from public.agency_sessions where auth_user_id = auth.uid(); $$;
revoke all on function public.logout_agency() from public, anon;
grant execute on function public.logout_agency() to authenticated;

create or replace function public.change_agency_password(p_current_password text, p_new_password text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare account public.agency_accounts%rowtype;
begin
  if p_new_password !~ '^[0-9]{6}$' then return false; end if;
  select a.* into account from public.agency_accounts a
  join public.agency_sessions s on s.agency_id = a.agency_id
  where s.auth_user_id = auth.uid() and s.expires_at > now() for update of a;
  if not found or account.password_hash <> extensions.crypt(p_current_password, account.password_hash) then
    return false;
  end if;
  update public.agency_accounts set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf'))
  where agency_id = account.agency_id;
  delete from public.agency_sessions where agency_id = account.agency_id;
  return true;
end;
$$;
revoke all on function public.change_agency_password(text, text) from public, anon;
grant execute on function public.change_agency_password(text, text) to authenticated;

drop policy if exists "Lecture publique app_state" on public.app_state;
drop policy if exists "Ajout public app_state" on public.app_state;
drop policy if exists "Modification publique app_state" on public.app_state;
drop policy if exists "Suppression publique app_state" on public.app_state;

revoke all on public.app_state from public, anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.app_state to authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on public.app_state to service_role;

create policy "Lecture par agence app_state"
on public.app_state for select to authenticated
using (agency_id = (select public.current_agency_id()));

create policy "Ajout par agence app_state"
on public.app_state for insert to authenticated
with check (agency_id = (select public.current_agency_id()));

create policy "Modification par agence app_state"
on public.app_state for update to authenticated
using (agency_id = (select public.current_agency_id()))
with check (agency_id = (select public.current_agency_id()));

create policy "Suppression par agence app_state"
on public.app_state for delete to authenticated
using (agency_id = (select public.current_agency_id()));

insert into public.app_state (agency_id, key, value, updated_at)
values (
  'century21lesminimes',
  'quialakey-shared-ready-v1',
  jsonb_build_object('validatedAt', now()),
  now()
)
on conflict (agency_id, key) do nothing;

notify pgrst, 'reload schema';

commit;

-- Activer les connexions anonymes dans Supabase Auth avant la bascule.
-- Initialiser les deux comptes avec des hachages bcrypt dans le SQL Editor.
-- Ne jamais enregistrer les mots de passe en clair dans ce fichier ou dans Git.
