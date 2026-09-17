-- P19-A / Bloco 3 / Etapa 3.4
-- Hardening da separacao entre categoria priorizada e tipo de venda.
-- Remove o valor legado piscinas_instalacao do primeiro grupo e impede sua reintroducao.

update public.store_strategy_settings
set strategy_sell_more_choices = pg_catalog.array_remove(strategy_sell_more_choices, 'piscinas_instalacao'),
    updated_at = pg_catalog.now()
where 'piscinas_instalacao' = any(coalesce(strategy_sell_more_choices, '{}'::text[]));

alter table public.store_strategy_settings
  drop constraint if exists store_strategy_settings_sell_more_no_piscinas_instalacao;

alter table public.store_strategy_settings
  add constraint store_strategy_settings_sell_more_no_piscinas_instalacao
  check (
    not ('piscinas_instalacao' = any(coalesce(strategy_sell_more_choices, '{}'::text[])))
  );

create or replace function public.upsert_store_commercial_strategy_policy_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_strategy_sell_more_choices text[],
  p_strategy_sell_more_other text,
  p_strategy_priority_deal_types text[],
  p_strategy_priority_deal_types_other text,
  p_strategy_avoid_cases text[],
  p_strategy_avoid_cases_other text,
  p_strategy_avoid_action text,
  p_strategy_sale_value_range text,
  p_strategy_sale_value_custom text
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
  v_sell_more_choices text[] := '{}'::text[];
  v_priority_deal_types text[] := '{}'::text[];
  v_avoid_cases text[] := '{}'::text[];
  v_sell_more_other text := nullif(pg_catalog.btrim(coalesce(p_strategy_sell_more_other, '')), '');
  v_priority_deal_types_other text := nullif(pg_catalog.btrim(coalesce(p_strategy_priority_deal_types_other, '')), '');
  v_avoid_cases_other text := nullif(pg_catalog.btrim(coalesce(p_strategy_avoid_cases_other, '')), '');
  v_avoid_action text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_strategy_avoid_action, ''))), '');
  v_sale_value_range text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_strategy_sale_value_range, ''))), '');
  v_sale_value_custom text := nullif(pg_catalog.btrim(coalesce(p_strategy_sale_value_custom, '')), '');
  v_candidate text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED'
      using errcode = 'P0001',
            detail = 'AUTH_REQUIRED',
            hint = 'Apenas usuarios autenticados podem salvar a estrategia comercial.';
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
            hint = 'Usuario sem vinculacao ativa nao pode salvar a estrategia comercial.';
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

  foreach v_candidate in array coalesce(p_strategy_sell_more_choices, '{}'::text[]) loop
    v_candidate := pg_catalog.lower(pg_catalog.btrim(coalesce(v_candidate, '')));
    if v_candidate <> '' then
      if not (v_candidate = any(array['piscinas', 'acessorios', 'quimicos', 'servicos', 'troca_equipamentos', 'sem_prioridade', 'outro']::text[])) then
        raise exception 'STRATEGY_SELL_MORE_INVALID' using errcode = '22023';
      end if;
      if not (v_candidate = any(v_sell_more_choices)) then
        v_sell_more_choices := array_append(v_sell_more_choices, v_candidate);
      end if;
    end if;
  end loop;

  foreach v_candidate in array coalesce(p_strategy_priority_deal_types, '{}'::text[]) loop
    v_candidate := pg_catalog.lower(pg_catalog.btrim(coalesce(v_candidate, '')));
    if v_candidate <> '' then
      if not (v_candidate = any(array['maior_valor', 'piscina_com_instalacao', 'varios_itens_servicos', 'venda_rapida_produto', 'cliente_recorrente', 'servico_tecnico_manutencao', 'sem_prioridade', 'outro']::text[])) then
        raise exception 'STRATEGY_PRIORITY_DEAL_TYPE_INVALID' using errcode = '22023';
      end if;
      if not (v_candidate = any(v_priority_deal_types)) then
        v_priority_deal_types := array_append(v_priority_deal_types, v_candidate);
      end if;
    end if;
  end loop;

  foreach v_candidate in array coalesce(p_strategy_avoid_cases, '{}'::text[]) loop
    v_candidate := pg_catalog.lower(pg_catalog.btrim(coalesce(v_candidate, '')));
    if v_candidate <> '' then
      if not (v_candidate = any(array['conflitos_repetidos', 'muitas_idas_voltas', 'excecoes_fora_regras', 'insiste_condicoes_nao_oferecidas', 'servico_nao_executado', 'esforco_desproporcional', 'agressivo_desrespeitoso', 'nenhum', 'outro']::text[])) then
        raise exception 'STRATEGY_AVOID_CASE_INVALID' using errcode = '22023';
      end if;
      if not (v_candidate = any(v_avoid_cases)) then
        v_avoid_cases := array_append(v_avoid_cases, v_candidate);
      end if;
    end if;
  end loop;

  if cardinality(v_sell_more_choices) = 0 then
    raise exception 'STRATEGY_SELL_MORE_REQUIRED' using errcode = '22023';
  end if;

  if 'sem_prioridade' = any(v_sell_more_choices) and cardinality(v_sell_more_choices) > 1 then
    raise exception 'STRATEGY_SELL_MORE_NO_PRIORITY_EXCLUSIVE' using errcode = '22023';
  end if;

  if 'outro' = any(v_sell_more_choices) and v_sell_more_other is null then
    raise exception 'STRATEGY_SELL_MORE_OTHER_REQUIRED' using errcode = '22023';
  elsif not ('outro' = any(v_sell_more_choices)) then
    v_sell_more_other := null;
  end if;

  if cardinality(v_priority_deal_types) = 0 then
    raise exception 'STRATEGY_PRIORITY_DEAL_TYPES_REQUIRED' using errcode = '22023';
  end if;

  if 'sem_prioridade' = any(v_priority_deal_types) and cardinality(v_priority_deal_types) > 1 then
    raise exception 'STRATEGY_PRIORITY_DEAL_TYPES_NO_PRIORITY_EXCLUSIVE' using errcode = '22023';
  end if;

  if 'outro' = any(v_priority_deal_types) and v_priority_deal_types_other is null then
    raise exception 'STRATEGY_PRIORITY_DEAL_TYPES_OTHER_REQUIRED' using errcode = '22023';
  elsif not ('outro' = any(v_priority_deal_types)) then
    v_priority_deal_types_other := null;
  end if;

  if cardinality(v_avoid_cases) = 0 then
    raise exception 'STRATEGY_AVOID_CASES_REQUIRED' using errcode = '22023';
  end if;

  if 'nenhum' = any(v_avoid_cases) and cardinality(v_avoid_cases) > 1 then
    raise exception 'STRATEGY_AVOID_CASES_NONE_EXCLUSIVE' using errcode = '22023';
  end if;

  if 'outro' = any(v_avoid_cases) and v_avoid_cases_other is null then
    raise exception 'STRATEGY_AVOID_CASES_OTHER_REQUIRED' using errcode = '22023';
  elsif not ('outro' = any(v_avoid_cases)) then
    v_avoid_cases_other := null;
  end if;

  if 'nenhum' = any(v_avoid_cases) then
    v_avoid_action := null;
  elsif v_avoid_action is null or not (v_avoid_action = any(array['nao_insistir_seguir_educadamente', 'chamar_humano_antes_avancar', 'sinalizar_internamente_continuar']::text[])) then
    raise exception 'STRATEGY_AVOID_ACTION_REQUIRED_OR_INVALID' using errcode = '22023';
  end if;

  if v_sale_value_range is null or not (v_sale_value_range = any(array['ate_1000', '1000_5000', '5000_10000', '10000_20000', '20000_50000', 'acima_50000', 'varia_muito', 'outra']::text[])) then
    raise exception 'STRATEGY_SALE_VALUE_RANGE_REQUIRED_OR_INVALID' using errcode = '22023';
  end if;

  if v_sale_value_range = any(array['varia_muito', 'outra']::text[]) and v_sale_value_custom is null then
    raise exception 'STRATEGY_SALE_VALUE_CUSTOM_REQUIRED' using errcode = '22023';
  elsif not (v_sale_value_range = any(array['varia_muito', 'outra']::text[])) then
    v_sale_value_custom := null;
  end if;

  insert into public.store_strategy_settings (
    organization_id,
    store_id,
    strategy_sell_more_choices,
    strategy_sell_more_other,
    strategy_sale_preference,
    strategy_sale_preference_other,
    strategy_customer_traits,
    strategy_customer_traits_other,
    strategy_attention_cases,
    strategy_attention_other,
    strategy_priority_deal_types,
    strategy_priority_deal_types_other,
    strategy_avoid_cases,
    strategy_avoid_cases_other,
    strategy_avoid_action,
    strategy_sale_value_range,
    strategy_sale_value_custom,
    strategy_commercial_experience_configured_at,
    strategy_commercial_strategy_configured_at,
    updated_at
  ) values (
    p_organization_id,
    p_store_id,
    v_sell_more_choices,
    v_sell_more_other,
    null,
    null,
    null,
    null,
    null,
    null,
    v_priority_deal_types,
    v_priority_deal_types_other,
    v_avoid_cases,
    v_avoid_cases_other,
    v_avoid_action,
    v_sale_value_range,
    v_sale_value_custom,
    pg_catalog.now(),
    pg_catalog.now(),
    pg_catalog.now()
  )
  on conflict (organization_id, store_id) do update set
    strategy_sell_more_choices = excluded.strategy_sell_more_choices,
    strategy_sell_more_other = excluded.strategy_sell_more_other,
    strategy_sale_preference = null,
    strategy_sale_preference_other = null,
    strategy_customer_traits = null,
    strategy_customer_traits_other = null,
    strategy_attention_cases = null,
    strategy_attention_other = null,
    strategy_priority_deal_types = excluded.strategy_priority_deal_types,
    strategy_priority_deal_types_other = excluded.strategy_priority_deal_types_other,
    strategy_avoid_cases = excluded.strategy_avoid_cases,
    strategy_avoid_cases_other = excluded.strategy_avoid_cases_other,
    strategy_avoid_action = excluded.strategy_avoid_action,
    strategy_sale_value_range = excluded.strategy_sale_value_range,
    strategy_sale_value_custom = excluded.strategy_sale_value_custom,
    strategy_commercial_experience_configured_at = coalesce(
      public.store_strategy_settings.strategy_commercial_experience_configured_at,
      excluded.strategy_commercial_experience_configured_at
    ),
    strategy_commercial_strategy_configured_at = coalesce(
      public.store_strategy_settings.strategy_commercial_strategy_configured_at,
      excluded.strategy_commercial_strategy_configured_at
    ),
    updated_at = excluded.updated_at
  returning *
  into v_result;

  return v_result;
end;
$function$;

alter function public.upsert_store_commercial_strategy_policy_scoped(
  uuid, uuid, text[], text, text[], text, text[], text, text, text, text
) owner to postgres;

revoke all on function public.upsert_store_commercial_strategy_policy_scoped(
  uuid, uuid, text[], text, text[], text, text[], text, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.upsert_store_commercial_strategy_policy_scoped(
  uuid, uuid, text[], text, text[], text, text[], text, text, text, text
) to authenticated;

comment on function public.upsert_store_commercial_strategy_policy_scoped(
  uuid, uuid, text[], text, text[], text, text[], text, text, text, text
) is
  'P19-A canonical authenticated writer for the redesigned Commercial Strategy card. Persists commercial priorities, avoid-cases, the configured AI action and typical sale value without repurposing obsolete customer-trait or attention-case fields.';
