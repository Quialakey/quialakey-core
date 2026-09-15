-- Quialakey - installation complete Supabase
-- Ce fichier peut etre colle en une seule fois dans le SQL Editor Supabase.
-- Il est reexecutable sans supprimer les donnees deja presentes.
-- L'application actuelle utilise la cle anon sans Supabase Auth : les droits
-- anon ci-dessous sont donc necessaires. Le code d'acces affiche par Quialakey
-- protege l'interface, mais ne remplace pas une authentification Supabase.

begin;

-- 1. TABLE PRINCIPALE
create table if not exists public.app_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  expected_updated_at timestamptz
);

-- Ajoute la colonne technique si la table provenait d'une ancienne installation.
alter table public.app_state
add column if not exists expected_updated_at timestamptz;

alter table public.app_state
alter column updated_at set default now();

alter table public.app_state enable row level security;
alter table public.app_state replica identity full;

grant usage on schema public to anon;
grant select, insert, update, delete on public.app_state to anon;


-- 2. POLITIQUES D'ACCES UTILISEES PAR L'APPLICATION
drop policy if exists "Lecture publique app_state" on public.app_state;
drop policy if exists "Ajout public app_state" on public.app_state;
drop policy if exists "Modification publique app_state" on public.app_state;
drop policy if exists "Suppression publique app_state" on public.app_state;

create policy "Lecture publique app_state"
on public.app_state
for select
to anon
using (true);

create policy "Ajout public app_state"
on public.app_state
for insert
to anon
with check (true);

create policy "Modification publique app_state"
on public.app_state
for update
to anon
using (true)
with check (true);

create policy "Suppression publique app_state"
on public.app_state
for delete
to anon
using (true);


-- 3. FONCTIONS HISTORIQUES DE PROTECTION DES FICHES ET DES PHOTOS
-- Elles restent installees pour permettre la reutilisation du script sur un
-- ancien projet. L'application actuelle utilise toutefois une ligne Supabase
-- par fiche, ce qui rend inutile la fusion du tableau complet par declencheur.
create or replace function public.key_state_score(item jsonb)
returns integer
language sql
immutable
as $$
  select
    (case when length(trim(coalesce(item->>'owner', ''))) > 0 then 1 else 0 end) +
    (case when length(trim(coalesce(item->>'ownerFirstName', ''))) > 0 then 1 else 0 end) +
    (case when length(trim(coalesce(item->>'property', ''))) > 0 then 1 else 0 end) +
    (case when length(trim(coalesce(item->>'postalCode', ''))) > 0 then 1 else 0 end) +
    (case when length(trim(coalesce(item->>'city', ''))) > 0 then 1 else 0 end) +
    (case when length(trim(coalesce(item->>'notes', ''))) > 0 then 1 else 0 end) +
    coalesce(
      (
        select count(*)::integer
        from jsonb_array_elements(
          case
            when jsonb_typeof(item->'sets') = 'array' then item->'sets'
            else '[]'::jsonb
          end
        ) as saved_set
        where length(trim(coalesce(saved_set->>'photo', ''))) > 0
      ),
      0
    );
$$;

create or replace function public.merge_key_sets_without_losing_photos(new_sets jsonb, old_sets jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  new_set jsonb;
  old_set jsonb;
  safe_old_sets jsonb := case when jsonb_typeof(old_sets) = 'array' then old_sets else '[]'::jsonb end;
  merged_sets jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(new_sets) <> 'array' then
    return new_sets;
  end if;

  for new_set in select value from jsonb_array_elements(new_sets)
  loop
    select value
      into old_set
      from jsonb_array_elements(safe_old_sets)
      where value->>'id' = new_set->>'id'
      limit 1;

    if old_set is not null
      and length(trim(coalesce(new_set->>'photo', ''))) = 0
      and length(trim(coalesce(old_set->>'photo', ''))) > 0 then
      new_set := jsonb_set(new_set, '{photo}', to_jsonb(old_set->>'photo'), true);
    end if;

    merged_sets := merged_sets || jsonb_build_array(new_set);
  end loop;

  return merged_sets;
end;
$$;

create or replace function public.merge_key_state_without_losing_fields(new_value jsonb, old_value jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  new_item jsonb;
  old_item jsonb;
  merged_item jsonb;
  merged_value jsonb := '[]'::jsonb;
  new_score integer;
  old_score integer;
begin
  if jsonb_typeof(new_value) <> 'array' or jsonb_typeof(old_value) <> 'array' then
    return new_value;
  end if;

  for new_item in select value from jsonb_array_elements(new_value)
  loop
    merged_item := new_item;

    select value
      into old_item
      from jsonb_array_elements(old_value)
      where value->>'id' = new_item->>'id'
      limit 1;

    if old_item is not null then
      new_score := public.key_state_score(new_item);
      old_score := public.key_state_score(old_item);

      if new_score > 0 and old_score > new_score then
        merged_item := jsonb_set(merged_item, '{owner}', to_jsonb(coalesce(nullif(new_item->>'owner', ''), old_item->>'owner', '')), true);
        merged_item := jsonb_set(merged_item, '{ownerFirstName}', to_jsonb(coalesce(nullif(new_item->>'ownerFirstName', ''), old_item->>'ownerFirstName', '')), true);
        merged_item := jsonb_set(merged_item, '{property}', to_jsonb(coalesce(nullif(new_item->>'property', ''), old_item->>'property', '')), true);
        merged_item := jsonb_set(merged_item, '{postalCode}', to_jsonb(coalesce(nullif(new_item->>'postalCode', ''), old_item->>'postalCode', '')), true);
        merged_item := jsonb_set(merged_item, '{city}', to_jsonb(coalesce(nullif(new_item->>'city', ''), old_item->>'city', '')), true);
        merged_item := jsonb_set(merged_item, '{notes}', to_jsonb(coalesce(nullif(new_item->>'notes', ''), old_item->>'notes', '')), true);
      end if;

      merged_item := jsonb_set(
        merged_item,
        '{sets}',
        public.merge_key_sets_without_losing_photos(
          coalesce(new_item->'sets', '[]'::jsonb),
          coalesce(old_item->'sets', '[]'::jsonb)
        ),
        true
      );
    end if;

    merged_value := merged_value || jsonb_build_array(merged_item);
  end loop;

  return merged_value;
end;
$$;


-- 4. PROTECTION DES FICHES CONTRE UNE ANCIENNE CASE VIDE
-- Les lignes "...::slot::..." sont la source fiable. Une fiche renseignee ne
-- peut devenir vide que si l'application transmet la validation issue d'une
-- suppression, d'un deplacement ou d'un transfert confirme.
create or replace function public.protect_app_state_key_rows()
returns trigger
language plpgsql
as $$
begin
  if old.key ~ '^cles-(immobilieres|transaction)-v1::slot::'
    and public.key_state_score(old.value) > 0
    and public.key_state_score(new.value) = 0 then
    if length(trim(coalesce(new.value->>'_quialakeyClearAuthorizedAt', ''))) = 0 then
      raise exception 'Suppression automatique bloquee : utilisez une action de suppression, deplacement ou transfert confirmee.';
    end if;
  end if;

  new.value := new.value - '_quialakeyClearAuthorizedAt';
  return new;
end;
$$;

drop trigger if exists protect_app_state_key_rows_trigger on public.app_state;

create trigger protect_app_state_key_rows_trigger
before update of value on public.app_state
for each row
execute function public.protect_app_state_key_rows();


-- 5. PROTECTION CONTRE LES ECRITURES FAITES DEPUIS UNE ANCIENNE VERSION
-- expected_updated_at doit correspondre a la version actuellement enregistree.
-- Le declencheur ne doit agir que sur UPDATE : lors d'un UPSERT, PostgreSQL
-- commence par une tentative d'INSERT avant de traiter un eventuel conflit.
create or replace function public.prevent_stale_app_state_update()
returns trigger
language plpgsql
as $$
begin
  if new.expected_updated_at is null
    or old.updated_at is distinct from new.expected_updated_at then
    raise exception 'Ancienne version bloquee : rechargez le site avant de sauvegarder.';
  end if;

  new.expected_updated_at := null;
  return new;
end;
$$;

drop trigger if exists app_state_prevent_stale_update on public.app_state;

create trigger app_state_prevent_stale_update
before update on public.app_state
for each row
execute function public.prevent_stale_app_state_update();


-- 6. ACTIVATION REALTIME, SANS ERREUR SI ELLE EST DEJA ACTIVE
do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_state'
  ) then
    alter publication supabase_realtime add table public.app_state;
  end if;
end;
$$;


-- 7. INITIALISATION D'UNE BASE NEUVE
-- Cette ligne permet au premier navigateur de distinguer une base vide valide
-- d'un projet Supabase mal configure, sans importer d'anciennes donnees.
insert into public.app_state (key, value, updated_at, expected_updated_at)
values (
  'cles-cloud-sync-heartbeat-v1',
  jsonb_build_object('version', 'initial', 'initializedAt', now()),
  now(),
  null
)
on conflict (key) do nothing;

commit;


-- VERIFICATION FINALE
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename = 'app_state';

select
  trigger_name,
  event_manipulation,
  action_timing
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'app_state'
order by trigger_name, event_manipulation;

select
  pubname,
  schemaname,
  tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'app_state';
