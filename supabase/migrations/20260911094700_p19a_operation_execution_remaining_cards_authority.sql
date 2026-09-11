-- P19-A / Block 3 / Operation
-- Canonical execution-policy authority for:
-- Card 7  - pool replacement
-- Card 8  - delivery
-- Card 9  - pickup
-- Card 10 - technical services
--
-- Explicit "No":
--   configured_at IS NOT NULL
--   policy IS NULL
--
-- Never configured:
--   configured_at IS NULL
--   policy IS NULL

alter table public.store_operation_execution_policies
  add column if not exists pool_replacement_policy jsonb,
  add column if not exists pool_replacement_configured_at timestamptz,
  add column if not exists delivery_policy jsonb,
  add column if not exists delivery_configured_at timestamptz,
  add column if not exists pickup_policy jsonb,
  add column if not exists pickup_configured_at timestamptz,
  add column if not exists technical_services_policy jsonb,
  add column if not exists technical_services_configured_at timestamptz;


-- ============================================================
-- INTERNAL VALIDATION HELPERS
-- ============================================================

create or replace function public.store_operation_execution_jsonb_text_array_allowed_internal(
  p_value jsonb,
  p_allowed text[]
)
returns boolean
language plpgsql
immutable
set search_path = 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_item jsonb;
  v_text text;
begin
  if p_value is null
     or jsonb_typeof(p_value) <> 'array' then
    return false;
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_value)
  loop
    if jsonb_typeof(v_item) <> 'string' then
      return false;
    end if;

    v_text := nullif(btrim(v_item #>> '{}'), '');

    if v_text is null
       or not (v_text = any(p_allowed)) then
      return false;
    end if;
  end loop;

  return true;
end;
$function$;


create or replace function public.store_operation_execution_has_nonblank_text_internal(
  p_policy jsonb,
  p_key text
)
returns boolean
language sql
immutable
set search_path = 'pg_catalog', 'public', 'pg_temp'
as $function$
  select nullif(btrim(coalesce(p_policy ->> p_key, '')), '') is not null;
$function$;


create or replace function public.store_operation_execution_has_positive_integer_internal(
  p_policy jsonb,
  p_key text
)
returns boolean
language sql
immutable
set search_path = 'pg_catalog', 'public', 'pg_temp'
as $function$
  select coalesce((p_policy ->> p_key) ~ '^[1-9][0-9]*$', false);
$function$;


-- ============================================================
-- CARD 7 - POOL REPLACEMENT VALIDATOR
-- ============================================================

create or replace function public.store_operation_pool_replacement_execution_policy_is_valid(
  p_policy jsonb
)
returns boolean
language plpgsql
immutable
set search_path = 'pg_catalog', 'public', 'pg_temp'
as $function$
begin
  if p_policy is null
     or jsonb_typeof(p_policy) <> 'object' then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_policy) as item(key)
    where not (
      item.key = any(array[
        'situations',
        'situations_other',
        'uses_installation_team',
        'team_rule',
        'duration_mode',
        'duration_value',
        'duration_rule',
        'removes_old',
        'removes_old_rule',
        'disposal_included',
        'disposal_rule',
        'requires_visit',
        'visit_rule',
        'includes',
        'excludes',
        'excludes_details',
        'notes'
      ]::text[])
    )
  ) then
    return false;
  end if;

  if not public.store_operation_execution_jsonb_text_array_allowed_internal(
    p_policy -> 'situations',
    array[
      'nova_da_loja',
      'nova_terceiro',
      'danificada',
      'modelo_diferente',
      'caso_a_caso'
    ]::text[]
  ) then
    return false;
  end if;

  if p_policy -> 'situations' @> '["caso_a_caso"]'::jsonb
     and not public.store_operation_execution_has_nonblank_text_internal(
       p_policy,
       'situations_other'
     ) then
    return false;
  end if;

  if coalesce(p_policy ->> 'uses_installation_team', '')
     not in ('sim', 'nao', 'depende') then
    return false;
  end if;

  if p_policy ->> 'uses_installation_team' = 'depende'
     and not public.store_operation_execution_has_nonblank_text_internal(
       p_policy,
       'team_rule'
     ) then
    return false;
  end if;

  if coalesce(p_policy ->> 'duration_mode', '')
     not in ('horas', 'dias', 'varia') then
    return false;
  end if;

  if p_policy ->> 'duration_mode' in ('horas', 'dias')
     and not public.store_operation_execution_has_positive_integer_internal(
       p_policy,
       'duration_value'
     ) then
    return false;
  end if;

  if p_policy ->> 'duration_mode' = 'varia'
     and not public.store_operation_execution_has_nonblank_text_internal(
       p_policy,
       'duration_rule'
     ) then
    return false;
  end if;

  if coalesce(p_policy ->> 'removes_old', '')
     not in ('sim', 'nao', 'caso_a_caso') then
    return false;
  end if;

  if p_policy ->> 'removes_old' = 'caso_a_caso'
     and not public.store_operation_execution_has_nonblank_text_internal(
       p_policy,
       'removes_old_rule'
     ) then
    return false;
  end if;

  if coalesce(p_policy ->> 'disposal_included', '')
     not in ('sim', 'nao', 'caso_a_caso') then
    return false;
  end if;

  if p_policy ->> 'disposal_included' = 'caso_a_caso'
     and not public.store_operation_execution_has_nonblank_text_internal(
       p_policy,
       'disposal_rule'
     ) then
    return false;
  end if;

  if coalesce(p_policy ->> 'requires_visit', '')
     not in ('sim', 'nao', 'depende') then
    return false;
  end if;

  if p_policy ->> 'requires_visit' = 'depende'
     and not public.store_operation_execution_has_nonblank_text_internal(
       p_policy,
       'visit_rule'
     ) then
    return false;
  end if;

  if not public.store_operation_execution_jsonb_text_array_allowed_internal(
    p_policy -> 'includes',
    array[
      'desconexao',
      'retirada_antiga',
      'preparacao_base',
      'posicionamento',
      'hidraulica',
      'equipamentos',
      'testes',
      'descarte',
      'outro'
    ]::text[]
  ) then
    return false;
  end if;

  if p_policy -> 'includes' @> '["outro"]'::jsonb
     and not public.store_operation_execution_has_nonblank_text_internal(
       p_policy,
       'notes'
     ) then
    return false;
  end if;

  if not public.store_operation_execution_jsonb_text_array_allowed_internal(
    p_policy -> 'excludes',
    array[
      'descarte',
      'obra_entorno',
      'paisagismo',
      'estrutura',
      'eletrica_externa',
      'hidraulica_externa',
      'outro'
    ]::text[]
  ) then
    return false;
  end if;

  if p_policy -> 'excludes' @> '["outro"]'::jsonb
     and not public.store_operation_execution_has_nonblank_text_internal(
       p_policy,
       'excludes_details'
     ) then
    return false;
  end if;

  return true;
end;
$function$;


-- ============================================================
-- CARD 8 - DELIVERY VALIDATOR
-- ============================================================

create or replace function public.store_operation_delivery_execution_policy_is_valid(
  p_policy jsonb
)
returns boolean
language plpgsql
immutable
set search_path = 'pg_catalog', 'public', 'pg_temp'
as $function$
begin
  if p_policy is null
     or jsonb_typeof(p_policy) <> 'object' then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_policy) as item(key)
    where not (
      item.key = any(array[
        'items',
        'items_other',
        'with_installation_mode',
        'with_installation_timing',
        'with_installation_notes',
        'provider',
        'provider_rule',
        'uses_installation_team',
        'installation_team_rule',
        'coverage_mode',
        'pricing_mode',
        'pricing_destination_mode',
        'pricing_destination_rule',
        'partner_pricing_mode',
        'partner_pricing_rule',
        'case_factors',
        'case_rule',
        'fixed_fee_cents',
        'requires_appointment',
        'lead_time_mode',
        'lead_time_value',
        'release_gates',
        'release_gates_other',
        'unloading_mode',
        'notes'
      ]::text[])
    )
  ) then
    return false;
  end if;

  if not public.store_operation_execution_jsonb_text_array_allowed_internal(
    p_policy -> 'items',
    array[
      'piscina_sem_instalacao',
      'piscina_com_instalacao',
      'equipamentos',
      'acessorios',
      'quimicos',
      'outros'
    ]::text[]
  ) then
    return false;
  end if;

  if jsonb_array_length(p_policy -> 'items') = 0 then
    return false;
  end if;

  if p_policy -> 'items' @> '["outros"]'::jsonb
     and not public.store_operation_execution_has_nonblank_text_internal(
       p_policy,
       'items_other'
     ) then
    return false;
  end if;

  if p_policy -> 'items' @> '["piscina_com_instalacao"]'::jsonb then
    if coalesce(p_policy ->> 'with_installation_mode', '')
       not in ('parte_instalacao', 'separado', 'depende') then
      return false;
    end if;

    if not public.store_operation_execution_has_nonblank_text_internal(
      p_policy,
      'with_installation_timing'
    ) then
      return false;
    end if;

    if (
      p_policy ->> 'with_installation_mode' = 'depende'
      or p_policy ->> 'with_installation_timing' = 'depende'
    )
    and not public.store_operation_execution_has_nonblank_text_internal(
      p_policy,
      'with_installation_notes'
    ) then
      return false;
    end if;
  end if;

  if coalesce(p_policy ->> 'provider', '')
     not in ('propria', 'parceiro', 'ambos', 'caso_a_caso') then
    return false;
  end if;

  if p_policy ->> 'provider' in ('ambos', 'caso_a_caso')
     and not public.store_operation_execution_has_nonblank_text_internal(
       p_policy,
       'provider_rule'
     ) then
    return false;
  end if;

  if p_policy ->> 'provider' in ('propria', 'ambos', 'caso_a_caso') then
    if coalesce(p_policy ->> 'uses_installation_team', '')
       not in ('sim', 'nao', 'depende') then
      return false;
    end if;

    if p_policy ->> 'uses_installation_team' = 'depende'
       and not public.store_operation_execution_has_nonblank_text_internal(
         p_policy,
         'installation_team_rule'
       ) then
      return false;
    end if;
  end if;

  if not public.store_operation_execution_has_nonblank_text_internal(
    p_policy,
    'coverage_mode'
  ) then
    return false;
  end if;

  if coalesce(p_policy ->> 'pricing_mode', '')
     not in (
       'gratuito',
       'incluido',
       'fixo',
       'destino',
       'parceiro',
       'caso_a_caso'
     ) then
    return false;
  end if;

  if p_policy ->> 'pricing_mode' = 'fixo'
     and not public.store_operation_execution_has_positive_integer_internal(
       p_policy,
       'fixed_fee_cents'
     ) then
    return false;
  end if;

  if p_policy ->> 'pricing_mode' = 'destino' then
    if not public.store_operation_execution_has_nonblank_text_internal(
      p_policy,
      'pricing_destination_mode'
    ) then
      return false;
    end if;

    if p_policy ->> 'pricing_destination_mode' = 'outra'
       and not public.store_operation_execution_has_nonblank_text_internal(
         p_policy,
         'pricing_destination_rule'
       ) then
      return false;
    end if;
  end if;

  if p_policy ->> 'pricing_mode' = 'parceiro' then
    if not public.store_operation_execution_has_nonblank_text_internal(
      p_policy,
      'partner_pricing_mode'
    ) then
      return false;
    end if;

    if p_policy ->> 'partner_pricing_mode' = 'depende'
       and not public.store_operation_execution_has_nonblank_text_internal(
         p_policy,
         'partner_pricing_rule'
       ) then
      return false;
    end if;
  end if;

  if p_policy ->> 'pricing_mode' = 'caso_a_caso'
     and not public.store_operation_execution_has_nonblank_text_internal(
       p_policy,
       'case_rule'
     ) then
    return false;
  end if;

  if p_policy ? 'case_factors'
     and jsonb_typeof(p_policy -> 'case_factors') <> 'array' then
    return false;
  end if;

  if p_policy ? 'case_factors'
     and p_policy -> 'case_factors' @> '["outro"]'::jsonb
     and not public.store_operation_execution_has_nonblank_text_internal(
       p_policy,
       'case_rule'
     ) then
    return false;
  end if;

  if jsonb_typeof(p_policy -> 'requires_appointment')
     is distinct from 'boolean' then
    return false;
  end if;

  if not public.store_operation_execution_has_nonblank_text_internal(
    p_policy,
    'lead_time_mode'
  ) then
    return false;
  end if;

  if not public.store_operation_execution_jsonb_text_array_allowed_internal(
    p_policy -> 'release_gates',
    array[
      'pagamento',
      'produto',
      'endereco',
      'contrato',
      'outro'
    ]::text[]
  ) then
    return false;
  end if;

  if p_policy -> 'release_gates' @> '["outro"]'::jsonb
     and not public.store_operation_execution_has_nonblank_text_internal(
       p_policy,
       'release_gates_other'
     ) then
    return false;
  end if;

  if coalesce(p_policy ->> 'unloading_mode', '')
     not in ('transporta', 'descarrega', 'posiciona', 'depende') then
    return false;
  end if;

  if p_policy ->> 'unloading_mode' = 'depende'
     and not public.store_operation_execution_has_nonblank_text_internal(
       p_policy,
       'notes'
     ) then
    return false;
  end if;

  return true;
end;
$function$;


-- ============================================================
-- CARD 9 - PICKUP VALIDATOR
-- ============================================================

create or replace function public.store_operation_pickup_execution_policy_is_valid(
  p_policy jsonb
)
returns boolean
language plpgsql
immutable
set search_path = 'pg_catalog', 'public', 'pg_temp'
as $function$
begin
  if p_policy is null
     or jsonb_typeof(p_policy) <> 'object' then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_policy) as item(key)
    where not (
      item.key = any(array[
        'items',
        'items_other',
        'location_mode',
        'other_location',
        'requires_appointment',
        'ready_mode',
        'ready_value',
        'third_party_allowed',
        'release_gates',
        'release_gates_other',
        'notes'
      ]::text[])
    )
  ) then
    return false;
  end if;

  if not public.store_operation_execution_jsonb_text_array_allowed_internal(
    p_policy -> 'items',
    array[
      'piscinas',
      'equipamentos',
      'acessorios',
      'quimicos',
      'outros'
    ]::text[]
  ) then
    return false;
  end if;

  if jsonb_array_length(p_policy -> 'items') = 0 then
    return false;
  end if;

  if p_policy -> 'items' @> '["outros"]'::jsonb
     and not public.store_operation_execution_has_nonblank_text_internal(
       p_policy,
       'items_other'
     ) then
    return false;
  end if;

  if coalesce(p_policy ->> 'location_mode', '')
     not in ('loja', 'outro') then
    return false;
  end if;

  if p_policy ->> 'location_mode' = 'outro'
     and not public.store_operation_execution_has_nonblank_text_internal(
       p_policy,
       'other_location'
     ) then
    return false;
  end if;

  if jsonb_typeof(p_policy -> 'requires_appointment')
     is distinct from 'boolean' then
    return false;
  end if;

  if not public.store_operation_execution_has_nonblank_text_internal(
    p_policy,
    'ready_mode'
  ) then
    return false;
  end if;

  if coalesce(p_policy ->> 'third_party_allowed', '')
     not in ('comprador', 'autorizado') then
    return false;
  end if;

  if not public.store_operation_execution_jsonb_text_array_allowed_internal(
    p_policy -> 'release_gates',
    array[
      'pagamento',
      'separado',
      'identificacao',
      'autorizacao',
      'outro'
    ]::text[]
  ) then
    return false;
  end if;

  if p_policy -> 'release_gates' @> '["outro"]'::jsonb
     and not public.store_operation_execution_has_nonblank_text_internal(
       p_policy,
       'release_gates_other'
     ) then
    return false;
  end if;

  return true;
end;
$function$;


-- ============================================================
-- CARD 10 - TECHNICAL SERVICES VALIDATOR
-- ============================================================

create or replace function public.store_operation_technical_services_execution_policy_is_valid(
  p_policy jsonb
)
returns boolean
language plpgsql
immutable
set search_path = 'pg_catalog', 'public', 'pg_temp'
as $function$
begin
  if p_policy is null
     or jsonb_typeof(p_policy) <> 'object' then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_policy) as item(key)
    where not (
      item.key = any(array[
        'service_types',
        'services_other',
        'equipment_types',
        'equipment_other',
        'equipment_installation_origin_policy',
        'equipment_installation_origin_rule',
        'equipment_replacement_existing',
        'equipment_replacement_existing_rule',
        'notes'
      ]::text[])
    )
  ) then
    return false;
  end if;

  if not public.store_operation_execution_jsonb_text_array_allowed_internal(
    p_policy -> 'service_types',
    array[
      'limpeza',
      'agua',
      'diagnostico',
      'reparo',
      'instalacao_equipamento',
      'troca_equipamento',
      'outro'
    ]::text[]
  ) then
    return false;
  end if;

  if jsonb_array_length(p_policy -> 'service_types') = 0 then
    return false;
  end if;

  if p_policy -> 'service_types' @> '["outro"]'::jsonb
     and not public.store_operation_execution_has_nonblank_text_internal(
       p_policy,
       'services_other'
     ) then
    return false;
  end if;

  if not public.store_operation_execution_jsonb_text_array_allowed_internal(
    p_policy -> 'equipment_types',
    array[
      'bombas',
      'filtros',
      'aquecedores',
      'iluminacao',
      'automacao',
      'cascata_hidro',
      'outros'
    ]::text[]
  ) then
    return false;
  end if;

  if jsonb_array_length(p_policy -> 'equipment_types') = 0 then
    return false;
  end if;

  if p_policy -> 'equipment_types' @> '["outros"]'::jsonb
     and not public.store_operation_execution_has_nonblank_text_internal(
       p_policy,
       'equipment_other'
     ) then
    return false;
  end if;

  if p_policy -> 'service_types' @> '["instalacao_equipamento"]'::jsonb then
    if coalesce(
      p_policy ->> 'equipment_installation_origin_policy',
      ''
    ) not in ('somente_loja', 'tambem_cliente', 'depende') then
      return false;
    end if;

    if p_policy ->> 'equipment_installation_origin_policy' = 'depende'
       and not public.store_operation_execution_has_nonblank_text_internal(
         p_policy,
         'equipment_installation_origin_rule'
       ) then
      return false;
    end if;
  end if;

  if p_policy -> 'service_types' @> '["troca_equipamento"]'::jsonb then
    if coalesce(
      p_policy ->> 'equipment_replacement_existing',
      ''
    ) not in ('sim', 'nao', 'caso_a_caso') then
      return false;
    end if;

    if p_policy ->> 'equipment_replacement_existing' = 'caso_a_caso'
       and not public.store_operation_execution_has_nonblank_text_internal(
         p_policy,
         'equipment_replacement_existing_rule'
       ) then
      return false;
    end if;
  end if;

  return true;
end;
$function$;


-- ============================================================
-- TABLE CONSTRAINTS
-- policy != null always requires marker and valid policy.
-- marker != null + policy null represents explicit human "No".
-- ============================================================

alter table public.store_operation_execution_policies
  drop constraint if exists store_operation_execution_pool_replacement_policy_shape_check,
  add constraint store_operation_execution_pool_replacement_policy_shape_check
    check (
      pool_replacement_policy is null
      or (
        pool_replacement_configured_at is not null
        and public.store_operation_pool_replacement_execution_policy_is_valid(
          pool_replacement_policy
        )
      )
    ),
  drop constraint if exists store_operation_execution_delivery_policy_shape_check,
  add constraint store_operation_execution_delivery_policy_shape_check
    check (
      delivery_policy is null
      or (
        delivery_configured_at is not null
        and public.store_operation_delivery_execution_policy_is_valid(
          delivery_policy
        )
      )
    ),
  drop constraint if exists store_operation_execution_pickup_policy_shape_check,
  add constraint store_operation_execution_pickup_policy_shape_check
    check (
      pickup_policy is null
      or (
        pickup_configured_at is not null
        and public.store_operation_pickup_execution_policy_is_valid(
          pickup_policy
        )
      )
    ),
  drop constraint if exists store_operation_execution_technical_services_policy_shape_check,
  add constraint store_operation_execution_technical_services_policy_shape_check
    check (
      technical_services_policy is null
      or (
        technical_services_configured_at is not null
        and public.store_operation_technical_services_execution_policy_is_valid(
          technical_services_policy
        )
      )
    );


-- ============================================================
-- CARD 7 WRITER
-- ============================================================

create or replace function public.upsert_store_operation_pool_replacement_configuration_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_enabled boolean,
  p_policy jsonb
)
returns public.store_operation_execution_policies
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'pg_temp'
set row_security = 'off'
as $function$
declare
  v_policy jsonb;
  v_result public.store_operation_execution_policies%rowtype;
begin
  perform public.store_operation_execution_assert_scope_internal(
    p_organization_id,
    p_store_id
  );

  if p_enabled is null then
    raise exception using
      errcode = '22023',
      message = 'pool replacement must be explicitly configured';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store operation pool replacement scope is not authorized';
  end if;

  if p_enabled then
    if not public.store_operation_pool_replacement_execution_policy_is_valid(
      p_policy
    ) then
      raise exception using
        errcode = '23514',
        message = 'pool_replacement_policy is invalid';
    end if;

    v_policy := p_policy;
  else
    v_policy := null;
  end if;

  insert into public.store_operation_execution_policies (
    organization_id,
    store_id,
    pool_replacement_policy,
    pool_replacement_configured_at,
    created_at,
    updated_at
  )
  values (
    p_organization_id,
    p_store_id,
    v_policy,
    pg_catalog.timezone('utc', pg_catalog.now()),
    pg_catalog.timezone('utc', pg_catalog.now()),
    pg_catalog.timezone('utc', pg_catalog.now())
  )
  on conflict (organization_id, store_id)
  do update set
    pool_replacement_policy = excluded.pool_replacement_policy,
    pool_replacement_configured_at = coalesce(
      public.store_operation_execution_policies.pool_replacement_configured_at,
      excluded.pool_replacement_configured_at
    ),
    updated_at = excluded.updated_at
  returning *
  into v_result;

  return v_result;
end;
$function$;


-- ============================================================
-- CARD 8 WRITER
-- ============================================================

create or replace function public.upsert_store_operation_delivery_configuration_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_enabled boolean,
  p_policy jsonb
)
returns public.store_operation_execution_policies
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'pg_temp'
set row_security = 'off'
as $function$
declare
  v_policy jsonb;
  v_result public.store_operation_execution_policies%rowtype;
begin
  perform public.store_operation_execution_assert_scope_internal(
    p_organization_id,
    p_store_id
  );

  if p_enabled is null then
    raise exception using
      errcode = '22023',
      message = 'delivery must be explicitly configured';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store operation delivery scope is not authorized';
  end if;

  if p_enabled then
    if not public.store_operation_delivery_execution_policy_is_valid(
      p_policy
    ) then
      raise exception using
        errcode = '23514',
        message = 'delivery_policy is invalid';
    end if;

    v_policy := p_policy;
  else
    v_policy := null;
  end if;

  insert into public.store_operation_execution_policies (
    organization_id,
    store_id,
    delivery_policy,
    delivery_configured_at,
    created_at,
    updated_at
  )
  values (
    p_organization_id,
    p_store_id,
    v_policy,
    pg_catalog.timezone('utc', pg_catalog.now()),
    pg_catalog.timezone('utc', pg_catalog.now()),
    pg_catalog.timezone('utc', pg_catalog.now())
  )
  on conflict (organization_id, store_id)
  do update set
    delivery_policy = excluded.delivery_policy,
    delivery_configured_at = coalesce(
      public.store_operation_execution_policies.delivery_configured_at,
      excluded.delivery_configured_at
    ),
    updated_at = excluded.updated_at
  returning *
  into v_result;

  return v_result;
end;
$function$;


-- ============================================================
-- CARD 9 WRITER
-- ============================================================

create or replace function public.upsert_store_operation_pickup_configuration_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_enabled boolean,
  p_policy jsonb
)
returns public.store_operation_execution_policies
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'pg_temp'
set row_security = 'off'
as $function$
declare
  v_policy jsonb;
  v_result public.store_operation_execution_policies%rowtype;
begin
  perform public.store_operation_execution_assert_scope_internal(
    p_organization_id,
    p_store_id
  );

  if p_enabled is null then
    raise exception using
      errcode = '22023',
      message = 'pickup must be explicitly configured';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store operation pickup scope is not authorized';
  end if;

  if p_enabled then
    if not public.store_operation_pickup_execution_policy_is_valid(
      p_policy
    ) then
      raise exception using
        errcode = '23514',
        message = 'pickup_policy is invalid';
    end if;

    v_policy := p_policy;
  else
    v_policy := null;
  end if;

  insert into public.store_operation_execution_policies (
    organization_id,
    store_id,
    pickup_policy,
    pickup_configured_at,
    created_at,
    updated_at
  )
  values (
    p_organization_id,
    p_store_id,
    v_policy,
    pg_catalog.timezone('utc', pg_catalog.now()),
    pg_catalog.timezone('utc', pg_catalog.now()),
    pg_catalog.timezone('utc', pg_catalog.now())
  )
  on conflict (organization_id, store_id)
  do update set
    pickup_policy = excluded.pickup_policy,
    pickup_configured_at = coalesce(
      public.store_operation_execution_policies.pickup_configured_at,
      excluded.pickup_configured_at
    ),
    updated_at = excluded.updated_at
  returning *
  into v_result;

  return v_result;
end;
$function$;


-- ============================================================
-- CARD 10 WRITER
-- ============================================================

create or replace function public.upsert_store_operation_technical_services_configuration_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_enabled boolean,
  p_policy jsonb
)
returns public.store_operation_execution_policies
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'pg_temp'
set row_security = 'off'
as $function$
declare
  v_policy jsonb;
  v_result public.store_operation_execution_policies%rowtype;
begin
  perform public.store_operation_execution_assert_scope_internal(
    p_organization_id,
    p_store_id
  );

  if p_enabled is null then
    raise exception using
      errcode = '22023',
      message = 'technical services must be explicitly configured';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store operation technical services scope is not authorized';
  end if;

  if p_enabled then
    if not public.store_operation_technical_services_execution_policy_is_valid(
      p_policy
    ) then
      raise exception using
        errcode = '23514',
        message = 'technical_services_policy is invalid';
    end if;

    v_policy := p_policy;
  else
    v_policy := null;
  end if;

  insert into public.store_operation_execution_policies (
    organization_id,
    store_id,
    technical_services_policy,
    technical_services_configured_at,
    created_at,
    updated_at
  )
  values (
    p_organization_id,
    p_store_id,
    v_policy,
    pg_catalog.timezone('utc', pg_catalog.now()),
    pg_catalog.timezone('utc', pg_catalog.now()),
    pg_catalog.timezone('utc', pg_catalog.now())
  )
  on conflict (organization_id, store_id)
  do update set
    technical_services_policy = excluded.technical_services_policy,
    technical_services_configured_at = coalesce(
      public.store_operation_execution_policies.technical_services_configured_at,
      excluded.technical_services_configured_at
    ),
    updated_at = excluded.updated_at
  returning *
  into v_result;

  return v_result;
end;
$function$;


-- ============================================================
-- EXECUTE PERMISSIONS
-- ============================================================

revoke all on function
  public.store_operation_execution_jsonb_text_array_allowed_internal(
    jsonb,
    text[]
  )
from public, anon, authenticated, service_role;

revoke all on function
  public.store_operation_execution_has_nonblank_text_internal(
    jsonb,
    text
  )
from public, anon, authenticated, service_role;

revoke all on function
  public.store_operation_execution_has_positive_integer_internal(
    jsonb,
    text
  )
from public, anon, authenticated, service_role;

revoke all on function
  public.store_operation_pool_replacement_execution_policy_is_valid(jsonb)
from public, anon, authenticated, service_role;

revoke all on function
  public.store_operation_delivery_execution_policy_is_valid(jsonb)
from public, anon, authenticated, service_role;

revoke all on function
  public.store_operation_pickup_execution_policy_is_valid(jsonb)
from public, anon, authenticated, service_role;

revoke all on function
  public.store_operation_technical_services_execution_policy_is_valid(jsonb)
from public, anon, authenticated, service_role;

revoke all on function
  public.upsert_store_operation_pool_replacement_configuration_scoped(
    uuid,
    uuid,
    boolean,
    jsonb
  )
from public, anon, service_role;

revoke all on function
  public.upsert_store_operation_delivery_configuration_scoped(
    uuid,
    uuid,
    boolean,
    jsonb
  )
from public, anon, service_role;

revoke all on function
  public.upsert_store_operation_pickup_configuration_scoped(
    uuid,
    uuid,
    boolean,
    jsonb
  )
from public, anon, service_role;

revoke all on function
  public.upsert_store_operation_technical_services_configuration_scoped(
    uuid,
    uuid,
    boolean,
    jsonb
  )
from public, anon, service_role;

grant execute on function
  public.upsert_store_operation_pool_replacement_configuration_scoped(
    uuid,
    uuid,
    boolean,
    jsonb
  )
to authenticated;

grant execute on function
  public.upsert_store_operation_delivery_configuration_scoped(
    uuid,
    uuid,
    boolean,
    jsonb
  )
to authenticated;

grant execute on function
  public.upsert_store_operation_pickup_configuration_scoped(
    uuid,
    uuid,
    boolean,
    jsonb
  )
to authenticated;

grant execute on function
  public.upsert_store_operation_technical_services_configuration_scoped(
    uuid,
    uuid,
    boolean,
    jsonb
  )
to authenticated;


comment on column
  public.store_operation_execution_policies.pool_replacement_configured_at
is
  'First explicit human configuration of Operation Card 7. Non-null with null policy means explicitly disabled.';

comment on column
  public.store_operation_execution_policies.delivery_configured_at
is
  'First explicit human configuration of Operation Card 8. Non-null with null policy means explicitly disabled.';

comment on column
  public.store_operation_execution_policies.pickup_configured_at
is
  'First explicit human configuration of Operation Card 9. Non-null with null policy means explicitly disabled.';

comment on column
  public.store_operation_execution_policies.technical_services_configured_at
is
  'First explicit human configuration of Operation Card 10. Non-null with null policy means explicitly disabled.';