-- P19-A / Bloco 3 / Configuracoes / Operacao
-- Card: Regiao de atendimento
--
-- Authority:
--   public.store_strategy_settings
--
-- Objetivos:
-- 1. distinguir default tecnico false de escolha humana explicita "Nao";
-- 2. manter store_strategy_settings como unica authority;
-- 3. writer atomico e estritamente regional;
-- 4. preservar por construcao todos os campos de Strategy fora de Regiao;
-- 5. manter somente os mirrors legados regionais + summary derivado.

alter table public.store_strategy_settings
  add column if not exists service_region_configured_at timestamptz null;

comment on column public.store_strategy_settings.service_region_configured_at is
  'First explicit valid human save of the service-region configuration. NULL means never explicitly configured.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.store_strategy_settings'::regclass
      and conname = 'store_strategy_settings_region_configured_shape_valid'
  ) then
    alter table public.store_strategy_settings
      add constraint store_strategy_settings_region_configured_shape_valid
      check (
        service_region_configured_at is null
        or (
          service_region_primary_mode is not null
          and service_region_primary_mode = any(service_region_modes)
          and (
            service_region_primary_mode <> 'grande_regiao'
            or nullif(pg_catalog.btrim(coalesce(service_regions, '')), '') is not null
          )
        )
      );
  end if;
end
$$;

create or replace function public.upsert_store_strategy_region_configuration_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_service_regions text,
  p_service_region_modes text[],
  p_service_region_primary_mode text,
  p_service_region_outside_consultation boolean,
  p_service_region_notes text default null
)
returns public.store_strategy_settings
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
set row_security to 'off'
as $function$
declare
  v_is_member boolean;
  v_result public.store_strategy_settings%rowtype;

  v_primary_mode text :=
    nullif(
      pg_catalog.lower(
        pg_catalog.btrim(coalesce(p_service_region_primary_mode, ''))
      ),
      ''
    );

  v_service_regions text :=
    nullif(pg_catalog.btrim(coalesce(p_service_regions, '')), '');

  v_service_region_notes text :=
    nullif(pg_catalog.btrim(coalesce(p_service_region_notes, '')), '');

  v_service_region_modes text[] := '{}'::text[];
  v_candidate text;
  v_ai_store_summary text;
begin
  -- ----------------------------------------------------------
  -- AUTH / TENANT SCOPE
  -- ----------------------------------------------------------

  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED'
      using errcode = 'P0001',
            detail = 'AUTH_REQUIRED',
            hint = 'Apenas usuarios autenticados podem salvar a configuracao regional.';
  end if;

  select exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_organization_id
      and membership_row.user_id = auth.uid()
      and membership_row.is_active is true
  )
  into v_is_member;

  if not coalesce(v_is_member, false) then
    raise exception 'MEMBERSHIP_REQUIRED'
      using errcode = 'P0001',
            detail = 'MEMBERSHIP_REQUIRED',
            hint = 'Usuario sem vinculacao ativa nao pode salvar a configuracao regional.';
  end if;

  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_organization_id
  ) then
    raise exception 'STORE_NOT_FOUND'
      using errcode = 'P0001',
            detail = 'STORE_NOT_FOUND',
            hint = 'Loja nao encontrada no escopo informado.';
  end if;

  -- ----------------------------------------------------------
  -- EXPLICIT HUMAN CHOICES
  -- ----------------------------------------------------------

  if p_service_region_outside_consultation is null then
    raise exception 'SERVICE_REGION_OUTSIDE_POLICY_REQUIRED'
      using errcode = '22023',
            detail = 'SERVICE_REGION_OUTSIDE_POLICY_REQUIRED',
            hint = 'Informe explicitamente se pedidos fora da cobertura podem ser atendidos sob consulta.';
  end if;

  if v_primary_mode is null
     or v_primary_mode not in (
       'somente_cidade_loja',
       'cidade_e_vizinhas',
       'grande_regiao',
       'todo_estado'
     )
  then
    raise exception 'SERVICE_REGION_PRIMARY_MODE_REQUIRED'
      using errcode = '22023',
            detail = 'SERVICE_REGION_PRIMARY_MODE_REQUIRED',
            hint = 'Informe uma cobertura principal valida.';
  end if;

  -- ----------------------------------------------------------
  -- NORMALIZE REGION MODES
  -- ----------------------------------------------------------

  foreach v_candidate in array coalesce(p_service_region_modes, '{}'::text[])
  loop
    v_candidate :=
      pg_catalog.lower(pg_catalog.btrim(coalesce(v_candidate, '')));

    if v_candidate = '' then
      continue;
    end if;

    if v_candidate not in (
      'somente_cidade_loja',
      'cidade_e_vizinhas',
      'grande_regiao',
      'todo_estado',
      'sob_consulta'
    ) then
      raise exception 'SERVICE_REGION_MODE_INVALID'
        using errcode = '22023',
              detail = 'SERVICE_REGION_MODE_INVALID',
              hint = 'Modo de cobertura regional invalido.';
    end if;

    if not (v_candidate = any(v_service_region_modes)) then
      v_service_region_modes :=
        array_append(v_service_region_modes, v_candidate);
    end if;
  end loop;

  -- Primary mode is always part of canonical modes.
  if not (v_primary_mode = any(v_service_region_modes)) then
    v_service_region_modes :=
      array_append(v_service_region_modes, v_primary_mode);
  end if;

  -- The boolean and the sob_consulta mode are mirrors of the same
  -- canonical decision and may never disagree.
  if p_service_region_outside_consultation then
    if not ('sob_consulta' = any(v_service_region_modes)) then
      v_service_region_modes :=
        array_append(v_service_region_modes, 'sob_consulta');
    end if;
  else
    select coalesce(
      array_agg(region_row.region_mode order by region_row.ordinality),
      '{}'::text[]
    )
    into v_service_region_modes
    from unnest(v_service_region_modes) with ordinality
      as region_row(region_mode, ordinality)
    where region_row.region_mode <> 'sob_consulta';
  end if;

  -- grande_regiao represents the UI cases in which a textual
  -- coverage definition is required.
  if v_primary_mode = 'grande_regiao'
     and v_service_regions is null
  then
    raise exception 'SERVICE_REGIONS_REQUIRED'
      using errcode = '22023',
            detail = 'SERVICE_REGIONS_REQUIRED',
            hint = 'Informe as cidades, regioes ou limites da cobertura.';
  end if;

  -- ----------------------------------------------------------
  -- CANONICAL WRITE
  -- ONLY REGION COLUMNS ARE UPDATED ON CONFLICT.
  -- ----------------------------------------------------------

  insert into public.store_strategy_settings (
    organization_id,
    store_id,
    service_regions,
    service_region_modes,
    service_region_primary_mode,
    service_region_outside_consultation,
    service_region_notes,
    service_region_configured_at
  )
  values (
    p_organization_id,
    p_store_id,
    v_service_regions,
    v_service_region_modes,
    v_primary_mode,
    p_service_region_outside_consultation,
    v_service_region_notes,
    pg_catalog.now()
  )
  on conflict (organization_id, store_id) do update
  set
    service_regions = excluded.service_regions,
    service_region_modes = excluded.service_region_modes,
    service_region_primary_mode = excluded.service_region_primary_mode,
    service_region_outside_consultation =
      excluded.service_region_outside_consultation,
    service_region_notes = excluded.service_region_notes,
    service_region_configured_at =
      coalesce(
        store_strategy_settings.service_region_configured_at,
        excluded.service_region_configured_at
      )
  returning *
  into v_result;

  -- ----------------------------------------------------------
  -- LEGACY MIRRORS
  -- Authority remains store_strategy_settings.
  -- Mirror only the region family touched by this writer.
  -- ----------------------------------------------------------

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'service_regions',
    p_answer => to_jsonb(coalesce(v_result.service_regions, ''))
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'service_region_modes',
    p_answer => to_jsonb(v_result.service_region_modes)
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'service_region_primary_mode',
    p_answer => to_jsonb(coalesce(v_result.service_region_primary_mode, ''))
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'service_region_outside_consultation',
    p_answer => to_jsonb(v_result.service_region_outside_consultation)
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'service_region_notes',
    p_answer => to_jsonb(coalesce(v_result.service_region_notes, ''))
  );

  -- Region participates in the legacy AI store summary.
  -- Rebuild it from the canonical row after the regional update.
  v_ai_store_summary :=
    public.store_strategy_settings_build_ai_store_summary(
      v_result.store_description,
      v_result.strategy_primary_focus,
      v_result.strategy_positioning,
      v_result.strategy_sell_more,
      v_result.service_regions,
      v_result.service_region_modes,
      v_result.store_services,
      v_result.store_services_other,
      v_result.main_store_brand,
      v_result.strategy_priority_brands,
      v_result.strategy_differentials,
      v_result.strategy_promise_limits
    );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'strategy_ai_store_summary',
    p_answer => to_jsonb(coalesce(v_ai_store_summary, ''))
  );

  return v_result;
end;
$function$;

comment on function public.upsert_store_strategy_region_configuration_scoped(
  uuid,
  uuid,
  text,
  text[],
  text,
  boolean,
  text
) is
  'Canonical scoped writer for the Region configuration card. Updates only regional Strategy authority fields and preserves first explicit configuration timestamp.';

alter function public.upsert_store_strategy_region_configuration_scoped(
  uuid,
  uuid,
  text,
  text[],
  text,
  boolean,
  text
) owner to postgres;

revoke all on function public.upsert_store_strategy_region_configuration_scoped(
  uuid,
  uuid,
  text,
  text[],
  text,
  boolean,
  text
) from public;

revoke all on function public.upsert_store_strategy_region_configuration_scoped(
  uuid,
  uuid,
  text,
  text[],
  text,
  boolean,
  text
) from anon;

revoke all on function public.upsert_store_strategy_region_configuration_scoped(
  uuid,
  uuid,
  text,
  text[],
  text,
  boolean,
  text
) from service_role;

grant execute on function public.upsert_store_strategy_region_configuration_scoped(
  uuid,
  uuid,
  text,
  text[],
  text,
  boolean,
  text
) to authenticated;