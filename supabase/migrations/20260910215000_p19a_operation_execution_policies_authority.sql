-- P19-A / Block 3 / Operation
-- Canonical execution policies for Technical Visit + New Pool Installation.
--
-- Principles:
--   * one aggregate execution authority per store;
--   * independent configured markers per card;
--   * no backfill: technical false/null defaults are not human decisions;
--   * card writers are isolated and atomic;
--   * legacy operation fields remain compatibility mirrors, not the rich authority;
--   * false explicitly disables a capability and clears stale dependent details;
--   * no persisted UI status / configured_state second source of truth.

create or replace function public.store_operation_jsonb_text_array_is_valid(
  p_value jsonb,
  p_allowed text[]
)
returns boolean
language plpgsql
immutable
set search_path = 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_count integer;
  v_distinct_count integer;
begin
  if p_value is null or pg_catalog.jsonb_typeof(p_value) <> 'array' then
    return false;
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_value) as element(value)
    where pg_catalog.jsonb_typeof(element.value) <> 'string'
       or nullif(pg_catalog.btrim(element.value #>> '{}'), '') is null
       or not ((element.value #>> '{}') = any(p_allowed))
  ) then
    return false;
  end if;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(distinct element.value #>> '{}')::integer
  into
    v_count,
    v_distinct_count
  from pg_catalog.jsonb_array_elements(p_value) as element(value);

  return v_count = v_distinct_count;
end;
$function$;

create or replace function public.store_operation_technical_visit_execution_policy_is_valid(
  p_policy jsonb
)
returns boolean
language plpgsql
immutable
set search_path = 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_requires_appointment boolean;
  v_duration_mode text;
  v_duration_minutes numeric;
begin
  if p_policy is null or pg_catalog.jsonb_typeof(p_policy) <> 'object' then
    return false;
  end if;

  -- Do not silently accept undeclared authoritative keys.
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_policy) as policy_key(key_name)
    where policy_key.key_name not in (
      'required_situations',
      'required_other',
      'optional_situations',
      'optional_other',
      'team_mode',
      'team_rule',
      'requires_appointment',
      'duration_mode',
      'duration_minutes',
      'duration_rule',
      'preconfirm_items',
      'preconfirm_other',
      'notes'
    )
  ) then
    return false;
  end if;

  if not public.store_operation_jsonb_text_array_is_valid(
    p_policy -> 'required_situations',
    array[
      'toda_venda_piscina',
      'piscina_com_instalacao',
      'instalacao_sem_venda',
      'troca_piscina',
      'instalacao_equipamento',
      'projeto_fora_padrao',
      'medidas',
      'viabilidade',
      'equipe_tecnica',
      'outro'
    ]::text[]
  ) then
    return false;
  end if;

  if not public.store_operation_jsonb_text_array_is_valid(
    p_policy -> 'optional_situations',
    array[
      'cliente_pedir',
      'avaliar_local',
      'confirmar_medidas',
      'orcamento_preciso',
      'outro'
    ]::text[]
  ) then
    return false;
  end if;

  if not public.store_operation_jsonb_text_array_is_valid(
    p_policy -> 'preconfirm_items',
    array[
      'endereco',
      'contato',
      'interesse',
      'medidas',
      'fotos',
      'outro'
    ]::text[]
  ) then
    return false;
  end if;

  if coalesce(p_policy ->> 'team_mode', '') not in (
    'dono_loja',
    'mesma_instalacao',
    'equipe_tecnica',
    'outro_time',
    'parceiro',
    'caso_a_caso'
  ) then
    return false;
  end if;

  if pg_catalog.jsonb_typeof(p_policy -> 'requires_appointment') <> 'boolean' then
    return false;
  end if;

  v_requires_appointment := (p_policy ->> 'requires_appointment')::boolean;
  v_duration_mode := nullif(
    pg_catalog.btrim(coalesce(p_policy ->> 'duration_mode', '')),
    ''
  );

  if 'outro' = any (
    array(
      select value #>> '{}'
      from pg_catalog.jsonb_array_elements(p_policy -> 'required_situations')
    )
  ) then
    if nullif(pg_catalog.btrim(coalesce(p_policy ->> 'required_other', '')), '') is null then
      return false;
    end if;
  elsif nullif(pg_catalog.btrim(coalesce(p_policy ->> 'required_other', '')), '') is not null then
    return false;
  end if;

  if 'outro' = any (
    array(
      select value #>> '{}'
      from pg_catalog.jsonb_array_elements(p_policy -> 'optional_situations')
    )
  ) then
    if nullif(pg_catalog.btrim(coalesce(p_policy ->> 'optional_other', '')), '') is null then
      return false;
    end if;
  elsif nullif(pg_catalog.btrim(coalesce(p_policy ->> 'optional_other', '')), '') is not null then
    return false;
  end if;

  if p_policy ->> 'team_mode' in ('outro_time', 'caso_a_caso') then
    if nullif(pg_catalog.btrim(coalesce(p_policy ->> 'team_rule', '')), '') is null then
      return false;
    end if;
  elsif nullif(pg_catalog.btrim(coalesce(p_policy ->> 'team_rule', '')), '') is not null then
    return false;
  end if;

  if v_requires_appointment then
    if v_duration_mode not in (
      '30',
      '60',
      '90',
      '120',
      'personalizado',
      'varia'
    ) then
      return false;
    end if;

    if v_duration_mode in ('30', '60', '90', '120', 'personalizado') then
      if pg_catalog.jsonb_typeof(p_policy -> 'duration_minutes') <> 'number' then
        return false;
      end if;

      v_duration_minutes := (p_policy ->> 'duration_minutes')::numeric;

      if v_duration_minutes <= 0
         or v_duration_minutes <> pg_catalog.trunc(v_duration_minutes) then
        return false;
      end if;

      if v_duration_mode in ('30', '60', '90', '120')
         and v_duration_minutes <> v_duration_mode::numeric then
        return false;
      end if;

      if nullif(pg_catalog.btrim(coalesce(p_policy ->> 'duration_rule', '')), '') is not null then
        return false;
      end if;
    else
      if p_policy -> 'duration_minutes' is not null
         and pg_catalog.jsonb_typeof(p_policy -> 'duration_minutes') <> 'null' then
        return false;
      end if;

      if nullif(pg_catalog.btrim(coalesce(p_policy ->> 'duration_rule', '')), '') is null then
        return false;
      end if;
    end if;
  else
    if v_duration_mode is not null then
      return false;
    end if;

    if p_policy -> 'duration_minutes' is not null
       and pg_catalog.jsonb_typeof(p_policy -> 'duration_minutes') <> 'null' then
      return false;
    end if;

    if nullif(pg_catalog.btrim(coalesce(p_policy ->> 'duration_rule', '')), '') is not null then
      return false;
    end if;
  end if;

  if 'outro' = any (
    array(
      select value #>> '{}'
      from pg_catalog.jsonb_array_elements(p_policy -> 'preconfirm_items')
    )
  ) then
    if nullif(pg_catalog.btrim(coalesce(p_policy ->> 'preconfirm_other', '')), '') is null then
      return false;
    end if;
  elsif nullif(pg_catalog.btrim(coalesce(p_policy ->> 'preconfirm_other', '')), '') is not null then
    return false;
  end if;

  if p_policy -> 'notes' is not null
     and pg_catalog.jsonb_typeof(p_policy -> 'notes') not in ('string', 'null') then
    return false;
  end if;

  return true;
end;
$function$;

create or replace function public.store_operation_installation_execution_policy_is_valid(
  p_policy jsonb
)
returns boolean
language plpgsql
immutable
set search_path = 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_supply_mode text;
  v_supplier_lead_time_mode text;
  v_start_lead_time_mode text;
  v_duration_mode text;
  v_duration_value numeric;
  v_multiple_teams boolean;
  v_concurrent_capacity numeric;
begin
  if p_policy is null or pg_catalog.jsonb_typeof(p_policy) <> 'object' then
    return false;
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_policy) as policy_key(key_name)
    where policy_key.key_name not in (
      'customer_can_buy_without',
      'customer_can_buy_without_rule',
      'third_party_pool',
      'third_party_pool_rule',
      'supply_mode',
      'supplier_lead_time_mode',
      'supplier_lead_time_value',
      'supplier_lead_time_rule',
      'start_lead_time_mode',
      'start_lead_time_value',
      'start_lead_time_rule',
      'duration_mode',
      'duration_value',
      'has_multiple_teams',
      'concurrent_capacity',
      'schedule_gates',
      'schedule_gates_other',
      'start_gates',
      'start_gates_other',
      'includes',
      'includes_other',
      'excludes',
      'excludes_details',
      'notes'
    )
  ) then
    return false;
  end if;

  if coalesce(p_policy ->> 'customer_can_buy_without', '') not in (
    'sim',
    'nao',
    'depende'
  ) then
    return false;
  end if;

  if coalesce(p_policy ->> 'third_party_pool', '') not in (
    'sim',
    'nao',
    'depende'
  ) then
    return false;
  end if;

  if p_policy ->> 'customer_can_buy_without' = 'depende' then
    if nullif(
      pg_catalog.btrim(coalesce(p_policy ->> 'customer_can_buy_without_rule', '')),
      ''
    ) is null then
      return false;
    end if;
  elsif nullif(
    pg_catalog.btrim(coalesce(p_policy ->> 'customer_can_buy_without_rule', '')),
    ''
  ) is not null then
    return false;
  end if;

  if p_policy ->> 'third_party_pool' = 'depende' then
    if nullif(
      pg_catalog.btrim(coalesce(p_policy ->> 'third_party_pool_rule', '')),
      ''
    ) is null then
      return false;
    end if;
  elsif nullif(
    pg_catalog.btrim(coalesce(p_policy ->> 'third_party_pool_rule', '')),
    ''
  ) is not null then
    return false;
  end if;

  v_supply_mode := nullif(
    pg_catalog.btrim(coalesce(p_policy ->> 'supply_mode', '')),
    ''
  );

  if v_supply_mode not in ('disponivel', 'sob_encomenda', 'misto') then
    return false;
  end if;

  v_supplier_lead_time_mode := nullif(
    pg_catalog.btrim(coalesce(p_policy ->> 'supplier_lead_time_mode', '')),
    ''
  );

  if v_supply_mode in ('sob_encomenda', 'misto') then
    if v_supplier_lead_time_mode not in (
      '1_3',
      '4_7',
      '8_15',
      'varia',
      'outro'
    ) then
      return false;
    end if;

    if v_supplier_lead_time_mode = 'outro' then
      if nullif(
        pg_catalog.btrim(coalesce(p_policy ->> 'supplier_lead_time_value', '')),
        ''
      ) is null then
        return false;
      end if;
    elsif nullif(
      pg_catalog.btrim(coalesce(p_policy ->> 'supplier_lead_time_value', '')),
      ''
    ) is not null then
      return false;
    end if;

    if v_supplier_lead_time_mode = 'varia' then
      if nullif(
        pg_catalog.btrim(coalesce(p_policy ->> 'supplier_lead_time_rule', '')),
        ''
      ) is null then
        return false;
      end if;
    elsif nullif(
      pg_catalog.btrim(coalesce(p_policy ->> 'supplier_lead_time_rule', '')),
      ''
    ) is not null then
      return false;
    end if;
  else
    if v_supplier_lead_time_mode is not null
       or nullif(
         pg_catalog.btrim(coalesce(p_policy ->> 'supplier_lead_time_value', '')),
         ''
       ) is not null
       or nullif(
         pg_catalog.btrim(coalesce(p_policy ->> 'supplier_lead_time_rule', '')),
         ''
       ) is not null then
      return false;
    end if;
  end if;

  v_start_lead_time_mode := nullif(
    pg_catalog.btrim(coalesce(p_policy ->> 'start_lead_time_mode', '')),
    ''
  );

  if v_start_lead_time_mode not in (
    'mesmo_dia',
    '1_dia',
    '2_3_dias',
    '4_7_dias',
    'varia',
    'outro'
  ) then
    return false;
  end if;

  if v_start_lead_time_mode = 'outro' then
    if nullif(
      pg_catalog.btrim(coalesce(p_policy ->> 'start_lead_time_value', '')),
      ''
    ) is null then
      return false;
    end if;
  elsif nullif(
    pg_catalog.btrim(coalesce(p_policy ->> 'start_lead_time_value', '')),
    ''
  ) is not null then
    return false;
  end if;

  if v_start_lead_time_mode = 'varia' then
    if nullif(
      pg_catalog.btrim(coalesce(p_policy ->> 'start_lead_time_rule', '')),
      ''
    ) is null then
      return false;
    end if;
  elsif nullif(
    pg_catalog.btrim(coalesce(p_policy ->> 'start_lead_time_rule', '')),
    ''
  ) is not null then
    return false;
  end if;

  v_duration_mode := nullif(
    pg_catalog.btrim(coalesce(p_policy ->> 'duration_mode', '')),
    ''
  );

  if v_duration_mode not in (
    'horas',
    'dias_uteis',
    'dias_corridos',
    'varia'
  ) then
    return false;
  end if;

  if v_duration_mode = 'varia' then
    if p_policy -> 'duration_value' is not null
       and pg_catalog.jsonb_typeof(p_policy -> 'duration_value') <> 'null' then
      return false;
    end if;

    if nullif(
      pg_catalog.btrim(coalesce(p_policy ->> 'duration_rule', '')),
      ''
    ) is null then
      return false;
    end if;
  else
    if pg_catalog.jsonb_typeof(p_policy -> 'duration_value') <> 'number' then
      return false;
    end if;

    v_duration_value := (p_policy ->> 'duration_value')::numeric;

    if v_duration_value <= 0
       or v_duration_value <> pg_catalog.trunc(v_duration_value) then
      return false;
    end if;

    if nullif(
      pg_catalog.btrim(coalesce(p_policy ->> 'duration_rule', '')),
      ''
    ) is not null then
      return false;
    end if;
  end if;

  if pg_catalog.jsonb_typeof(p_policy -> 'has_multiple_teams') <> 'boolean' then
    return false;
  end if;

  if pg_catalog.jsonb_typeof(p_policy -> 'concurrent_capacity') <> 'number' then
    return false;
  end if;

  v_multiple_teams := (p_policy ->> 'has_multiple_teams')::boolean;
  v_concurrent_capacity := (p_policy ->> 'concurrent_capacity')::numeric;

  if v_concurrent_capacity <= 0
     or v_concurrent_capacity <> pg_catalog.trunc(v_concurrent_capacity) then
    return false;
  end if;

  if v_multiple_teams and v_concurrent_capacity < 2 then
    return false;
  end if;

  if not v_multiple_teams and v_concurrent_capacity <> 1 then
    return false;
  end if;

  if not public.store_operation_jsonb_text_array_is_valid(
    p_policy -> 'schedule_gates',
    array[
      'visita',
      'endereco',
      'produto',
      'orcamento',
      'pagamento',
      'contrato',
      'outro'
    ]::text[]
  ) then
    return false;
  end if;

  if not public.store_operation_jsonb_text_array_is_valid(
    p_policy -> 'start_gates',
    array[
      'visita',
      'pagamento',
      'produto',
      'contrato',
      'local',
      'outro'
    ]::text[]
  ) then
    return false;
  end if;

  if not public.store_operation_jsonb_text_array_is_valid(
    p_policy -> 'includes',
    array[
      'entrega',
      'escavacao',
      'base',
      'posicionamento',
      'hidraulica',
      'eletrica',
      'bomba_filtro',
      'acessorios',
      'testes',
      'enchimento',
      'tratamento',
      'orientacao',
      'acabamento',
      'residuos',
      'outro'
    ]::text[]
  ) then
    return false;
  end if;

  if not public.store_operation_jsonb_text_array_is_valid(
    p_policy -> 'excludes',
    array[
      'entorno',
      'paisagismo',
      'eletrica_externa',
      'hidraulica_externa',
      'entulho',
      'acessos',
      'outro'
    ]::text[]
  ) then
    return false;
  end if;

  if 'outro' = any (
    array(
      select value #>> '{}'
      from pg_catalog.jsonb_array_elements(p_policy -> 'schedule_gates')
    )
  ) then
    if nullif(
      pg_catalog.btrim(coalesce(p_policy ->> 'schedule_gates_other', '')),
      ''
    ) is null then
      return false;
    end if;
  elsif nullif(
    pg_catalog.btrim(coalesce(p_policy ->> 'schedule_gates_other', '')),
    ''
  ) is not null then
    return false;
  end if;

  if 'outro' = any (
    array(
      select value #>> '{}'
      from pg_catalog.jsonb_array_elements(p_policy -> 'start_gates')
    )
  ) then
    if nullif(
      pg_catalog.btrim(coalesce(p_policy ->> 'start_gates_other', '')),
      ''
    ) is null then
      return false;
    end if;
  elsif nullif(
    pg_catalog.btrim(coalesce(p_policy ->> 'start_gates_other', '')),
    ''
  ) is not null then
    return false;
  end if;

  if 'outro' = any (
    array(
      select value #>> '{}'
      from pg_catalog.jsonb_array_elements(p_policy -> 'includes')
    )
  ) then
    if nullif(
      pg_catalog.btrim(coalesce(p_policy ->> 'includes_other', '')),
      ''
    ) is null then
      return false;
    end if;
  elsif nullif(
    pg_catalog.btrim(coalesce(p_policy ->> 'includes_other', '')),
    ''
  ) is not null then
    return false;
  end if;

  if 'outro' = any (
    array(
      select value #>> '{}'
      from pg_catalog.jsonb_array_elements(p_policy -> 'excludes')
    )
  ) and nullif(
    pg_catalog.btrim(coalesce(p_policy ->> 'excludes_details', '')),
    ''
  ) is null then
    return false;
  end if;

  if p_policy -> 'notes' is not null
     and pg_catalog.jsonb_typeof(p_policy -> 'notes') not in ('string', 'null') then
    return false;
  end if;

  return true;
end;
$function$;

create table if not exists public.store_operation_execution_policies (
  organization_id uuid not null,
  store_id uuid not null,
  technical_visit_policy jsonb null,
  installation_policy jsonb null,
  technical_visit_configured_at timestamptz null,
  installation_configured_at timestamptz null,
  created_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  updated_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),

  constraint store_operation_execution_policies_pkey
    primary key (organization_id, store_id),

  constraint store_operation_execution_policies_technical_visit_policy_shape_valid
    check (
      technical_visit_policy is null
      or public.store_operation_technical_visit_execution_policy_is_valid(
        technical_visit_policy
      )
    ),

  constraint store_operation_execution_policies_installation_policy_shape_valid
    check (
      installation_policy is null
      or public.store_operation_installation_execution_policy_is_valid(
        installation_policy
      )
    )
);

alter table public.store_operation_execution_policies
  enable row level security;

revoke all on table public.store_operation_execution_policies
  from public, anon, authenticated, service_role;

create or replace function public.store_operation_execution_assert_scope_internal(
  p_organization_id uuid,
  p_store_id uuid
)
returns void
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'pg_temp'
set row_security = 'off'
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_is_member boolean;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if v_request_role = 'authenticated' then
    if auth.uid() is null then
      raise exception using
        errcode = '42501',
        message = 'store operation execution policy scope is not authorized';
    end if;

    select exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = p_organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
    into v_is_member;

    if coalesce(v_is_member, false) is not true then
      raise exception using
        errcode = '42501',
        message = 'store operation execution policy scope is not authorized';
    end if;
  elsif v_request_role = 'postgres' then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'store operation execution policy scope is not authorized';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store operation execution policy scope is not authorized';
  end if;
end;
$function$;

create or replace function public.read_store_operation_execution_policies_scoped(
  p_organization_id uuid,
  p_store_id uuid
)
returns public.store_operation_execution_policies
language plpgsql
security definer
stable
set search_path = 'pg_catalog', 'public', 'pg_temp'
set row_security = 'off'
as $function$
declare
  v_result public.store_operation_execution_policies%rowtype;
begin
  perform public.store_operation_execution_assert_scope_internal(
    p_organization_id,
    p_store_id
  );

  select *
  into v_result
  from public.store_operation_execution_policies policy_row
  where policy_row.organization_id = p_organization_id
    and policy_row.store_id = p_store_id;

  if not found then
    return null;
  end if;

  return v_result;
end;
$function$;

create or replace function public.upsert_store_operation_technical_visit_configuration_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_offers_technical_visit boolean,
  p_technical_visit_policy jsonb,
  p_technical_visit_pricing_mode text default null,
  p_technical_visit_fixed_fee_cents integer default null,
  p_technical_visit_case_by_case_rule text default null,
  p_technical_visit_fee_deductible_from_purchase boolean default null
)
returns public.store_operation_execution_policies
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'pg_temp'
set row_security = 'off'
as $function$
declare
  v_policy jsonb;
  v_pricing_mode text;
  v_result public.store_operation_execution_policies%rowtype;
begin
  perform public.store_operation_execution_assert_scope_internal(
    p_organization_id,
    p_store_id
  );

  if p_offers_technical_visit is null then
    raise exception using
      errcode = '22023',
      message = 'offers_technical_visit must be explicitly configured';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store operation technical visit scope is not authorized';
  end if;

  if p_offers_technical_visit then
    if not public.store_operation_technical_visit_execution_policy_is_valid(
      p_technical_visit_policy
    ) then
      raise exception using
        errcode = '23514',
        message = 'technical_visit_policy is invalid';
    end if;

    v_policy := p_technical_visit_policy;
    v_pricing_mode := nullif(
      pg_catalog.lower(
        pg_catalog.btrim(coalesce(p_technical_visit_pricing_mode, ''))
      ),
      ''
    );

    if v_pricing_mode is null then
      raise exception using
        errcode = '23514',
        message = 'technical_visit_pricing_mode is required when technical visit is offered';
    end if;
  else
    v_policy := null;
    v_pricing_mode := null;
  end if;

  insert into public.store_operation_settings (
    organization_id,
    store_id,
    offers_technical_visit,
    technical_visit_days_rule,
    technical_visit_rules,
    technical_visit_rules_other
  )
  values (
    p_organization_id,
    p_store_id,
    p_offers_technical_visit,
    null,
    '{}'::text[],
    null
  )
  on conflict (organization_id, store_id)
  do update set
    offers_technical_visit = excluded.offers_technical_visit,
    technical_visit_days_rule = case
      when excluded.offers_technical_visit is false then null
      else public.store_operation_settings.technical_visit_days_rule
    end,
    technical_visit_rules = case
      when excluded.offers_technical_visit is false then '{}'::text[]
      else public.store_operation_settings.technical_visit_rules
    end,
    technical_visit_rules_other = case
      when excluded.offers_technical_visit is false then null
      else public.store_operation_settings.technical_visit_rules_other
    end;

  perform public.upsert_store_operation_technical_visit_pricing_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_technical_visit_pricing_mode => v_pricing_mode,
    p_technical_visit_fixed_fee_cents => case
      when p_offers_technical_visit
        then p_technical_visit_fixed_fee_cents
      else null
    end,
    p_technical_visit_case_by_case_rule => case
      when p_offers_technical_visit
        then p_technical_visit_case_by_case_rule
      else null
    end,
    p_technical_visit_fee_deductible_from_purchase => case
      when p_offers_technical_visit
        then p_technical_visit_fee_deductible_from_purchase
      else null
    end
  );

  insert into public.store_operation_execution_policies (
    organization_id,
    store_id,
    technical_visit_policy,
    technical_visit_configured_at,
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
    technical_visit_policy = excluded.technical_visit_policy,
    technical_visit_configured_at = coalesce(
      public.store_operation_execution_policies.technical_visit_configured_at,
      excluded.technical_visit_configured_at
    ),
    updated_at = excluded.updated_at
  returning *
  into v_result;

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'offers_technical_visit',
    p_answer => pg_catalog.to_jsonb(p_offers_technical_visit)
  );

  return v_result;
end;
$function$;

create or replace function public.upsert_store_operation_installation_configuration_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_offers_installation boolean,
  p_installation_policy jsonb
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

  if p_offers_installation is null then
    raise exception using
      errcode = '22023',
      message = 'offers_installation must be explicitly configured';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store operation installation scope is not authorized';
  end if;

  if p_offers_installation then
    if not public.store_operation_installation_execution_policy_is_valid(
      p_installation_policy
    ) then
      raise exception using
        errcode = '23514',
        message = 'installation_policy is invalid';
    end if;

    v_policy := p_installation_policy;
  else
    v_policy := null;
  end if;

  insert into public.store_operation_settings (
    organization_id,
    store_id,
    offers_installation,
    average_installation_time_days,
    installation_days_rule,
    installation_process_notes
  )
  values (
    p_organization_id,
    p_store_id,
    p_offers_installation,
    null,
    null,
    null
  )
  on conflict (organization_id, store_id)
  do update set
    offers_installation = excluded.offers_installation,
    average_installation_time_days = case
      when excluded.offers_installation is false then null
      else public.store_operation_settings.average_installation_time_days
    end,
    installation_days_rule = case
      when excluded.offers_installation is false then null
      else public.store_operation_settings.installation_days_rule
    end,
    installation_process_notes = case
      when excluded.offers_installation is false then null
      else public.store_operation_settings.installation_process_notes
    end;

  insert into public.store_operation_execution_policies (
    organization_id,
    store_id,
    installation_policy,
    installation_configured_at,
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
    installation_policy = excluded.installation_policy,
    installation_configured_at = coalesce(
      public.store_operation_execution_policies.installation_configured_at,
      excluded.installation_configured_at
    ),
    updated_at = excluded.updated_at
  returning *
  into v_result;

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'offers_installation',
    p_answer => pg_catalog.to_jsonb(p_offers_installation)
  );

  return v_result;
end;
$function$;

revoke all on function public.store_operation_jsonb_text_array_is_valid(
  jsonb,
  text[]
) from public, anon, authenticated, service_role;

revoke all on function public.store_operation_technical_visit_execution_policy_is_valid(
  jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.store_operation_installation_execution_policy_is_valid(
  jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.store_operation_execution_assert_scope_internal(
  uuid,
  uuid
) from public, anon, authenticated, service_role;

revoke all on function public.read_store_operation_execution_policies_scoped(
  uuid,
  uuid
) from public, anon, service_role;

revoke all on function public.upsert_store_operation_technical_visit_configuration_scoped(
  uuid,
  uuid,
  boolean,
  jsonb,
  text,
  integer,
  text,
  boolean
) from public, anon, service_role;

revoke all on function public.upsert_store_operation_installation_configuration_scoped(
  uuid,
  uuid,
  boolean,
  jsonb
) from public, anon, service_role;

grant execute on function public.read_store_operation_execution_policies_scoped(
  uuid,
  uuid
) to authenticated;

grant execute on function public.upsert_store_operation_technical_visit_configuration_scoped(
  uuid,
  uuid,
  boolean,
  jsonb,
  text,
  integer,
  text,
  boolean
) to authenticated;

grant execute on function public.upsert_store_operation_installation_configuration_scoped(
  uuid,
  uuid,
  boolean,
  jsonb
) to authenticated;

comment on table public.store_operation_execution_policies is
  'Canonical per-store execution policies for operational service cards. Explicit configured markers distinguish human decisions from technical defaults.';

comment on column public.store_operation_execution_policies.technical_visit_policy is
  'Canonical rich technical-visit execution policy. Pricing remains canonical in store_operation_settings.';

comment on column public.store_operation_execution_policies.installation_policy is
  'Canonical rich new-pool installation execution policy.';

comment on column public.store_operation_execution_policies.technical_visit_configured_at is
  'Timestamp of the first explicit valid human configuration of the Technical Visit card. No migration backfill.';

comment on column public.store_operation_execution_policies.installation_configured_at is
  'Timestamp of the first explicit valid human configuration of the Installation card. No migration backfill.';