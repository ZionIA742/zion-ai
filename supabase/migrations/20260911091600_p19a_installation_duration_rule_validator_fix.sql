-- P19-A / Block 3 / Operation
-- Forward fix: installation duration_mode='varia' canonically requires
-- duration_rule, so duration_rule must also be an allowed policy key.
--
-- The original applied migration remains frozen.

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
      'duration_rule',
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

comment on function public.store_operation_installation_execution_policy_is_valid(jsonb) is
  'Validates canonical installation execution policy, including duration_rule when duration_mode is varia.';