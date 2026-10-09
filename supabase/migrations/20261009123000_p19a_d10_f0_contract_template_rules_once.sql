-- ZION-ADM / D10-F0
-- Prevent a second extraction from replacing rules that already exist.
-- This is additive: the historical migration remains unchanged.

begin;

do $$
begin
  if to_regprocedure(
    'public.replace_store_contract_template_rules_by_system(uuid,uuid,uuid,jsonb,uuid)'
  ) is null then
    raise exception
      'P19A_D10_F0_PRECONDITION_MISSING_RULE_REPLACEMENT_FUNCTION';
  end if;

  if to_regclass('public.store_contract_template_versions') is null
     or to_regclass('public.store_contract_template_extracted_rules') is null then
    raise exception
      'P19A_D10_F0_PRECONDITION_MISSING_CONTRACT_TEMPLATE_TABLES';
  end if;
end;
$$;

create or replace function public.replace_store_contract_template_rules_by_system(
  p_version_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_rules jsonb,
  p_actor_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.store_contract_template_versions%rowtype;
  v_rules jsonb := coalesce(p_rules, '[]'::jsonb);
  v_rule_count integer := 0;
  v_invalid_count integer := 0;
  v_existing_rule_count bigint := 0;
  v_now timestamptz := now();
begin
  if p_version_id is null
     or p_organization_id is null
     or p_store_id is null
     or p_actor_id is null
  then
    raise exception
      'P19A_CONTRACT_INVALID_RULE_REPLACEMENT_ARGUMENTS';
  end if;

  if jsonb_typeof(v_rules) <> 'array' then
    raise exception
      'P19A_CONTRACT_RULES_PAYLOAD_MUST_BE_ARRAY';
  end if;

  -- The version row is the serialization point for the one-shot extraction.
  select *
  into v_version
  from public.store_contract_template_versions
  where id = p_version_id
    and organization_id = p_organization_id
    and store_id = p_store_id
  for update;

  if not found then
    raise exception
      'P19A_CONTRACT_VERSION_NOT_FOUND_OR_OUT_OF_SCOPE';
  end if;

  if v_version.status not in ('analyzed', 'awaiting_review') then
    raise exception
      'P19A_CONTRACT_RULES_VERSION_READ_ONLY: status %',
      v_version.status;
  end if;

  if v_version.rejected_at is not null then
    raise exception
      'P19A_CONTRACT_RULES_REJECTED_VERSION_READ_ONLY';
  end if;

  if nullif(btrim(coalesce(v_version.raw_extracted_text, '')), '') is null then
    raise exception
      'P19A_CONTRACT_TEXT_NOT_AVAILABLE';
  end if;

  -- This check is deliberately after FOR UPDATE. A waiter therefore sees the
  -- committed rules/marker from the first extraction and cannot replace them.
  select count(*)
  into v_existing_rule_count
  from public.store_contract_template_extracted_rules
  where template_version_id = v_version.id
    and organization_id = p_organization_id
    and store_id = p_store_id;

  if v_existing_rule_count > 0
     or coalesce(v_version.metadata, '{}'::jsonb) ? 'rules_extracted_at'
  then
    raise exception
      'P19A_CONTRACT_RULES_ALREADY_EXTRACTED';
  end if;

  select count(*)
  into v_invalid_count
  from jsonb_array_elements(v_rules) as item
  where
    nullif(btrim(coalesce(item->>'rule_key', '')), '') is null
    or nullif(btrim(coalesce(item->>'rule_group', '')), '') is null
    or nullif(btrim(coalesce(item->>'label', '')), '') is null;

  if v_invalid_count > 0 then
    raise exception
      'P19A_CONTRACT_RULES_PAYLOAD_INVALID: % invalid rule(s)',
      v_invalid_count;
  end if;

  -- DELETE + INSERT remain in the same transaction and are reachable only
  -- after the one-shot guard above.
  delete from public.store_contract_template_extracted_rules
  where template_version_id = v_version.id
    and organization_id = p_organization_id
    and store_id = p_store_id;

  insert into public.store_contract_template_extracted_rules (
    template_version_id,
    organization_id,
    store_id,
    rule_key,
    rule_group,
    label,
    value_text,
    value_json,
    source_excerpt,
    confidence,
    review_status,
    sort_order,
    created_at,
    updated_at
  )
  select
    v_version.id,
    p_organization_id,
    p_store_id,
    btrim(item->>'rule_key'),
    btrim(item->>'rule_group'),
    btrim(item->>'label'),
    nullif(btrim(coalesce(item->>'value_text', '')), ''),
    coalesce(item->'value_json', '{}'::jsonb),
    nullif(btrim(coalesce(item->>'source_excerpt', '')), ''),
    case
      when nullif(btrim(coalesce(item->>'confidence', '')), '') is null
        then null
      else (item->>'confidence')::numeric
    end,
    'pending',
    coalesce(
      case
        when nullif(btrim(coalesce(item->>'sort_order', '')), '') is null
          then null
        else (item->>'sort_order')::integer
      end,
      (ordinality - 1)::integer
    ),
    v_now,
    v_now
  from jsonb_array_elements(v_rules)
    with ordinality as source(item, ordinality);

  get diagnostics v_rule_count = row_count;

  update public.store_contract_template_versions
  set
    status = 'awaiting_review',
    analysis_summary =
      case
        when v_rule_count > 0
          then format('%s regra(s) sugerida(s) para revisao humana.', v_rule_count)
        else 'Nenhuma regra confiavel foi encontrada no contrato.'
      end,
    metadata =
      coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'rules_extracted_at', v_now,
        'rules_extracted_by_user_id', p_actor_id,
        'rules_extracted_count', v_rule_count
      ),
    updated_at = v_now
  where id = v_version.id
    and organization_id = p_organization_id
    and store_id = p_store_id;

  if not found then
    raise exception
      'P19A_CONTRACT_RULE_REPLACEMENT_VERSION_UPDATE_FAILED';
  end if;

  return v_rule_count;
end;
$$;

revoke all on function public.replace_store_contract_template_rules_by_system(
  uuid,
  uuid,
  uuid,
  jsonb,
  uuid
) from public, anon, authenticated;

grant execute on function public.replace_store_contract_template_rules_by_system(
  uuid,
  uuid,
  uuid,
  jsonb,
  uuid
) to service_role;

commit;
