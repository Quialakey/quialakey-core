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
        from jsonb_array_elements(coalesce(item->'sets', '[]'::jsonb)) as saved_set
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
  merged_sets jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(new_sets) <> 'array' then
    return new_sets;
  end if;

  for new_set in select value from jsonb_array_elements(new_sets)
  loop
    select value
      into old_set
      from jsonb_array_elements(coalesce(old_sets, '[]'::jsonb))
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
      merged_item := jsonb_set(
        merged_item,
        '{sets}',
        public.merge_key_sets_without_losing_photos(coalesce(new_item->'sets', '[]'::jsonb), coalesce(old_item->'sets', '[]'::jsonb)),
        true
      );
    end if;

    merged_value := merged_value || jsonb_build_array(merged_item);
  end loop;

  return merged_value;
end;
$$;

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
