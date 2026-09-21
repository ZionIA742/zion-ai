begin;

alter table public.store_strategy_settings
  add column if not exists brands_has_main boolean,
  add column if not exists brands_main_choice text,
  add column if not exists brands_main_other text,
  add column if not exists brands_worked_choices text[] not null default '{}'::text[],
  add column if not exists brands_worked_other text,
  add column if not exists brands_priority_enabled boolean,
  add column if not exists brands_priority_choices text[] not null default '{}'::text[],
  add column if not exists brands_priority_other text,
  add column if not exists brands_configuration_configured_at timestamptz;

alter table public.store_strategy_settings
  drop constraint if exists store_strategy_settings_brands_main_choice_valid,
  drop constraint if exists store_strategy_settings_brands_worked_choices_valid,
  drop constraint if exists store_strategy_settings_brands_priority_choices_valid,
  drop constraint if exists store_strategy_settings_brands_main_consistent,
  drop constraint if exists store_strategy_settings_brands_worked_other_consistent,
  drop constraint if exists store_strategy_settings_brands_priority_consistent,
  drop constraint if exists store_strategy_settings_brands_configuration_complete;

alter table public.store_strategy_settings
  add constraint store_strategy_settings_brands_main_choice_valid
  check (
    brands_main_choice is null
    or brands_main_choice = any (
      array[
        'iGUi','Henrimar','Fiber','Fibratec','Sodramar','Nautilus','Jacuzzi','Dancor','Syllent','Pooltec',
        'AstralPool','Veico','Albacete','Panozon','Sibrape / Pentair','HTH','Genco','Hidroall','Maresias','CTX Professional','outro'
      ]::text[]
    )
  ),
  add constraint store_strategy_settings_brands_worked_choices_valid
  check (
    brands_worked_choices <@ array[
      'iGUi','Henrimar','Fiber','Fibratec','Sodramar','Nautilus','Jacuzzi','Dancor','Syllent','Pooltec',
      'AstralPool','Veico','Albacete','Panozon','Sibrape / Pentair','HTH','Genco','Hidroall','Maresias','CTX Professional','outro'
    ]::text[]
  ),
  add constraint store_strategy_settings_brands_priority_choices_valid
  check (
    brands_priority_choices <@ array[
      'iGUi','Henrimar','Fiber','Fibratec','Sodramar','Nautilus','Jacuzzi','Dancor','Syllent','Pooltec',
      'AstralPool','Veico','Albacete','Panozon','Sibrape / Pentair','HTH','Genco','Hidroall','Maresias','CTX Professional','outro'
    ]::text[]
  ),
  add constraint store_strategy_settings_brands_main_consistent
  check (
    brands_has_main is null
    or (
      brands_has_main is true
      and brands_main_choice is not null
      and (
        (brands_main_choice = 'outro' and nullif(pg_catalog.btrim(coalesce(brands_main_other, '')), '') is not null)
        or (brands_main_choice <> 'outro' and brands_main_other is null)
      )
    )
    or (
      brands_has_main is false
      and brands_main_choice is null
      and brands_main_other is null
    )
  ),
  add constraint store_strategy_settings_brands_worked_other_consistent
  check (
    (
      'outro' = any(brands_worked_choices)
      and nullif(pg_catalog.btrim(coalesce(brands_worked_other, '')), '') is not null
    )
    or (
      not ('outro' = any(brands_worked_choices))
      and brands_worked_other is null
    )
  ),
  add constraint store_strategy_settings_brands_priority_consistent
  check (
    brands_priority_enabled is null
    or (
      brands_priority_enabled is true
      and cardinality(brands_priority_choices) > 0
      and (
        (
          'outro' = any(brands_priority_choices)
          and nullif(pg_catalog.btrim(coalesce(brands_priority_other, '')), '') is not null
        )
        or (
          not ('outro' = any(brands_priority_choices))
          and brands_priority_other is null
        )
      )
    )
    or (
      brands_priority_enabled is false
      and cardinality(brands_priority_choices) = 0
      and brands_priority_other is null
    )
  ),
  add constraint store_strategy_settings_brands_configuration_complete
  check (
    brands_configuration_configured_at is null
    or (
      brands_has_main is not null
      and brands_priority_enabled is not null
    )
  );

create or replace function public.upsert_store_brand_preferences_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_brands_has_main boolean,
  p_brands_main_choice text,
  p_brands_main_other text,
  p_brands_worked_choices text[],
  p_brands_worked_other text,
  p_brands_priority_enabled boolean,
  p_brands_priority_choices text[],
  p_brands_priority_other text
)
returns public.store_strategy_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_is_member boolean;
  v_result public.store_strategy_settings%rowtype;
  v_allowed_brands text[] := array[
    'iGUi','Henrimar','Fiber','Fibratec','Sodramar','Nautilus','Jacuzzi','Dancor','Syllent','Pooltec',
    'AstralPool','Veico','Albacete','Panozon','Sibrape / Pentair','HTH','Genco','Hidroall','Maresias','CTX Professional','outro'
  ]::text[];
  v_main_choice text := nullif(pg_catalog.btrim(coalesce(p_brands_main_choice, '')), '');
  v_main_other text := nullif(pg_catalog.btrim(coalesce(p_brands_main_other, '')), '');
  v_worked_choices text[] := '{}'::text[];
  v_worked_other text := nullif(pg_catalog.btrim(coalesce(p_brands_worked_other, '')), '');
  v_priority_choices text[] := '{}'::text[];
  v_priority_other text := nullif(pg_catalog.btrim(coalesce(p_brands_priority_other, '')), '');
  v_candidate text;
  v_canonical_candidate text;
  v_main_store_brand text;
  v_worked_labels text[] := '{}'::text[];
  v_priority_labels text[] := '{}'::text[];
  v_brands_worked_legacy text;
  v_priority_brands_legacy text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED'
      using errcode = 'P0001', detail = 'AUTH_REQUIRED', hint = 'Apenas usuarios autenticados podem salvar as preferencias de marcas.';
  end if;

  select exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_organization_id
      and membership_row.user_id = auth.uid()
      and membership_row.is_active is true
  ) into v_is_member;

  if not coalesce(v_is_member, false) then
    raise exception 'MEMBERSHIP_REQUIRED'
      using errcode = 'P0001', detail = 'MEMBERSHIP_REQUIRED', hint = 'Usuario sem vinculacao ativa nao pode salvar as preferencias de marcas.';
  end if;

  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_organization_id
  ) then
    raise exception 'STORE_NOT_FOUND'
      using errcode = 'P0001', detail = 'STORE_NOT_FOUND', hint = 'Loja nao encontrada no escopo informado.';
  end if;

  if p_brands_has_main is null then
    raise exception 'BRANDS_HAS_MAIN_REQUIRED' using errcode = '22023';
  end if;

  if p_brands_priority_enabled is null then
    raise exception 'BRANDS_PRIORITY_ENABLED_REQUIRED' using errcode = '22023';
  end if;

  if p_brands_has_main then
    if v_main_choice is null then
      raise exception 'BRANDS_MAIN_CHOICE_REQUIRED' using errcode = '22023';
    end if;

    select allowed_brand
    into v_canonical_candidate
    from pg_catalog.unnest(v_allowed_brands) as allowed_brand
    where pg_catalog.lower(allowed_brand) = pg_catalog.lower(v_main_choice)
    limit 1;

    if v_canonical_candidate is null then
      raise exception 'BRANDS_MAIN_CHOICE_INVALID' using errcode = '22023';
    end if;

    v_main_choice := v_canonical_candidate;

    if v_main_choice = 'outro' then
      if v_main_other is null then
        raise exception 'BRANDS_MAIN_OTHER_REQUIRED' using errcode = '22023';
      end if;
      v_main_store_brand := v_main_other;
    else
      v_main_other := null;
      v_main_store_brand := v_main_choice;
    end if;
  else
    v_main_choice := null;
    v_main_other := null;
    v_main_store_brand := null;
  end if;

  foreach v_candidate in array coalesce(p_brands_worked_choices, '{}'::text[]) loop
    v_candidate := nullif(pg_catalog.btrim(coalesce(v_candidate, '')), '');
    if v_candidate is null then
      continue;
    end if;

    select allowed_brand
    into v_canonical_candidate
    from pg_catalog.unnest(v_allowed_brands) as allowed_brand
    where pg_catalog.lower(allowed_brand) = pg_catalog.lower(v_candidate)
    limit 1;

    if v_canonical_candidate is null then
      raise exception 'BRANDS_WORKED_CHOICE_INVALID' using errcode = '22023';
    end if;

    if not (v_canonical_candidate = any(v_worked_choices)) then
      v_worked_choices := pg_catalog.array_append(v_worked_choices, v_canonical_candidate);
    end if;
  end loop;

  if 'outro' = any(v_worked_choices) then
    if v_worked_other is null then
      raise exception 'BRANDS_WORKED_OTHER_REQUIRED' using errcode = '22023';
    end if;
  else
    v_worked_other := null;
  end if;

  if p_brands_has_main
     and v_main_choice is not null
     and v_main_choice <> 'outro'
     and v_main_choice = any(v_worked_choices) then
    raise exception 'BRANDS_MAIN_DUPLICATED_IN_WORKED' using errcode = '22023';
  end if;

  foreach v_candidate in array coalesce(p_brands_priority_choices, '{}'::text[]) loop
    v_candidate := nullif(pg_catalog.btrim(coalesce(v_candidate, '')), '');
    if v_candidate is null then
      continue;
    end if;

    select allowed_brand
    into v_canonical_candidate
    from pg_catalog.unnest(v_allowed_brands) as allowed_brand
    where pg_catalog.lower(allowed_brand) = pg_catalog.lower(v_candidate)
    limit 1;

    if v_canonical_candidate is null then
      raise exception 'BRANDS_PRIORITY_CHOICE_INVALID' using errcode = '22023';
    end if;

    if not (v_canonical_candidate = any(v_priority_choices)) then
      v_priority_choices := pg_catalog.array_append(v_priority_choices, v_canonical_candidate);
    end if;
  end loop;

  if p_brands_priority_enabled then
    if cardinality(v_priority_choices) = 0 then
      raise exception 'BRANDS_PRIORITY_CHOICE_REQUIRED' using errcode = '22023';
    end if;

    if 'outro' = any(v_priority_choices) then
      if v_priority_other is null then
        raise exception 'BRANDS_PRIORITY_OTHER_REQUIRED' using errcode = '22023';
      end if;
    else
      v_priority_other := null;
    end if;
  else
    v_priority_choices := '{}'::text[];
    v_priority_other := null;
  end if;

  foreach v_candidate in array v_worked_choices loop
    if v_candidate = 'outro' then
      v_worked_labels := pg_catalog.array_append(v_worked_labels, v_worked_other);
    else
      v_worked_labels := pg_catalog.array_append(v_worked_labels, v_candidate);
    end if;
  end loop;

  foreach v_candidate in array v_priority_choices loop
    if v_candidate = 'outro' then
      v_priority_labels := pg_catalog.array_append(v_priority_labels, v_priority_other);
    else
      v_priority_labels := pg_catalog.array_append(v_priority_labels, v_candidate);
    end if;
  end loop;

  v_brands_worked_legacy := nullif(pg_catalog.array_to_string(v_worked_labels, ', '), '');
  v_priority_brands_legacy := nullif(pg_catalog.array_to_string(v_priority_labels, ', '), '');

  insert into public.store_strategy_settings (
    organization_id, store_id,
    brands_has_main, brands_main_choice, brands_main_other,
    brands_worked_choices, brands_worked_other,
    brands_priority_enabled, brands_priority_choices, brands_priority_other,
    brands_configuration_configured_at,
    main_store_brand, brands_worked, strategy_priority_brands, updated_at
  ) values (
    p_organization_id, p_store_id,
    p_brands_has_main, v_main_choice, v_main_other,
    v_worked_choices, v_worked_other,
    p_brands_priority_enabled, v_priority_choices, v_priority_other,
    pg_catalog.now(),
    v_main_store_brand, v_brands_worked_legacy, v_priority_brands_legacy, pg_catalog.now()
  )
  on conflict (organization_id, store_id) do update set
    brands_has_main = excluded.brands_has_main,
    brands_main_choice = excluded.brands_main_choice,
    brands_main_other = excluded.brands_main_other,
    brands_worked_choices = excluded.brands_worked_choices,
    brands_worked_other = excluded.brands_worked_other,
    brands_priority_enabled = excluded.brands_priority_enabled,
    brands_priority_choices = excluded.brands_priority_choices,
    brands_priority_other = excluded.brands_priority_other,
    brands_configuration_configured_at = coalesce(
      public.store_strategy_settings.brands_configuration_configured_at,
      excluded.brands_configuration_configured_at
    ),
    main_store_brand = excluded.main_store_brand,
    brands_worked = excluded.brands_worked,
    strategy_priority_brands = excluded.strategy_priority_brands,
    updated_at = excluded.updated_at
  returning * into v_result;

  return v_result;
end;
$function$;

alter function public.upsert_store_brand_preferences_scoped(
  uuid, uuid, boolean, text, text, text[], text, boolean, text[], text
) owner to postgres;

revoke all on function public.upsert_store_brand_preferences_scoped(
  uuid, uuid, boolean, text, text, text[], text, boolean, text[], text
) from public, anon, authenticated, service_role;

grant execute on function public.upsert_store_brand_preferences_scoped(
  uuid, uuid, boolean, text, text, text[], text, boolean, text[], text
) to authenticated;

comment on function public.upsert_store_brand_preferences_scoped(
  uuid, uuid, boolean, text, text, text[], text, boolean, text[], text
) is
  'P19-A canonical authenticated writer for the Commercial brands card. Persists main brand, worked brands and brand preference in structured fields while maintaining legacy text mirrors for compatibility.';

commit;
