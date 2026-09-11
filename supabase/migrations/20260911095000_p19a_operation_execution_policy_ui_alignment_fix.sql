-- P19-A / Block 3 / Operation
-- Forward fix:
-- Align Card 8 (Delivery) and Card 9 (Pickup) canonical validators
-- with fields that actually exist in the current Settings UI.
--
-- Removes dead/non-rendered draft fields from canonical authority:
-- Delivery: coverage_mode, requires_appointment, lead_time_mode, lead_time_value
-- Pickup: ready_mode, ready_value
--
-- Also fixes Delivery "depends on project":
-- when with_installation_mode = depende, timing is not rendered by UI;
-- explanatory notes are the required authority.

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
        'pricing_mode',
        'pricing_destination_mode',
        'pricing_destination_rule',
        'partner_pricing_mode',
        'partner_pricing_rule',
        'case_factors',
        'case_rule',
        'fixed_fee_cents',
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

    if p_policy ->> 'with_installation_mode' = 'parte_instalacao' then
      if coalesce(p_policy ->> 'with_installation_timing', '')
         not in ('mesmo_dia', 'antes', 'depende') then
        return false;
      end if;
    elsif p_policy ->> 'with_installation_mode' = 'separado' then
      if coalesce(p_policy ->> 'with_installation_timing', '')
         not in ('sim', 'nao', 'depende') then
        return false;
      end if;
    else
      if public.store_operation_execution_has_nonblank_text_internal(
        p_policy,
        'with_installation_timing'
      ) then
        return false;
      end if;
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
  else
    if public.store_operation_execution_has_nonblank_text_internal(
      p_policy,
      'with_installation_mode'
    )
    or public.store_operation_execution_has_nonblank_text_internal(
      p_policy,
      'with_installation_timing'
    )
    or public.store_operation_execution_has_nonblank_text_internal(
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
  else
    if public.store_operation_execution_has_nonblank_text_internal(
      p_policy,
      'uses_installation_team'
    )
    or public.store_operation_execution_has_nonblank_text_internal(
      p_policy,
      'installation_team_rule'
    ) then
      return false;
    end if;
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

  if p_policy ->> 'pricing_mode' = 'fixo' then
    if not public.store_operation_execution_has_positive_integer_internal(
      p_policy,
      'fixed_fee_cents'
    ) then
      return false;
    end if;
  elsif public.store_operation_execution_has_nonblank_text_internal(
    p_policy,
    'fixed_fee_cents'
  ) then
    return false;
  end if;

  if p_policy ->> 'pricing_mode' = 'destino' then
    if coalesce(p_policy ->> 'pricing_destination_mode', '')
       not in ('distancia', 'regiao', 'faixa', 'outra') then
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
    if coalesce(p_policy ->> 'partner_pricing_mode', '')
       not in ('repasse', 'loja_define', 'depende') then
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

  if p_policy ->> 'pricing_mode' = 'caso_a_caso' then
    if not public.store_operation_execution_jsonb_text_array_allowed_internal(
      p_policy -> 'case_factors',
      array[
        'distancia',
        'peso_tamanho',
        'veiculo',
        'regiao',
        'acesso',
        'outro'
      ]::text[]
    ) then
      return false;
    end if;

    if jsonb_array_length(p_policy -> 'case_factors') = 0 then
      return false;
    end if;

    if not public.store_operation_execution_has_nonblank_text_internal(
      p_policy,
      'case_rule'
    ) then
      return false;
    end if;
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