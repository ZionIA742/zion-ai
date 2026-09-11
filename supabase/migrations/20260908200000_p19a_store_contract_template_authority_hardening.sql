-- P19-A / Bloco 3 / Contrato padrão da loja
-- Authority hardening:
-- - fail-closed preflight
-- - one active version per template
-- - historical immutability
-- - deferred active pointer integrity
-- - atomic contract version activation
-- - atomic extracted-rule replacement

-- ============================================================
-- 1. PREFLIGHT
-- ============================================================

do $$
begin
  if exists (
    select 1
    from public.store_contract_template_versions
    where status = 'active'
    group by template_id
    having count(*) > 1
  ) then
    raise exception
      'P19A_CONTRACT_PREFLIGHT_FAILED: more than one active version exists for the same template';
  end if;

  if exists (
    select 1
    from public.store_contract_templates t
    left join public.store_contract_template_versions v
      on v.id = t.active_version_id
    where t.active_version_id is not null
      and (
        v.id is null
        or v.template_id is distinct from t.id
        or v.organization_id is distinct from t.organization_id
        or v.store_id is distinct from t.store_id
        or v.status is distinct from 'active'
      )
  ) then
    raise exception
      'P19A_CONTRACT_PREFLIGHT_FAILED: inconsistent active_version_id pointer exists';
  end if;

  if exists (
    select 1
    from public.store_contract_template_versions v
    join public.store_contract_templates t
      on t.id = v.template_id
    where v.status = 'active'
      and t.active_version_id is distinct from v.id
  ) then
    raise exception
      'P19A_CONTRACT_PREFLIGHT_FAILED: active version exists outside the official pointer';
  end if;

  if exists (
    select 1
    from public.store_contract_templates t
    where
      (t.active_version_id is null and t.status = 'active')
      or
      (t.active_version_id is not null and t.status <> 'active')
  ) then
    raise exception
      'P19A_CONTRACT_PREFLIGHT_FAILED: template status disagrees with active_version_id';
  end if;
end;
$$;


-- ============================================================
-- 2. NO MÁXIMO UMA VERSÃO ACTIVE POR TEMPLATE
-- ============================================================

create unique index if not exists
  store_contract_template_versions_one_active_uidx
on public.store_contract_template_versions (template_id)
where status = 'active';


-- ============================================================
-- 3. VERSION STATE / HISTORY GUARD
-- ============================================================

create or replace function public.p19a_guard_store_contract_template_version_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_total_rules bigint;
  v_final_rules bigint;
begin
  -- Estados históricos/finais são imutáveis.
  if old.status in ('archived', 'rejected', 'approved') then
    raise exception
      'P19A_CONTRACT_VERSION_READ_ONLY: version % with status % is immutable',
      old.id,
      old.status;
  end if;

  -- Uma versão ativa só pode deixar de ser ativa ao ser arquivada
  -- durante o cutover controlado.
  if old.status = 'active' then
    if new.status <> 'archived' then
      raise exception
        'P19A_CONTRACT_ACTIVE_VERSION_READ_ONLY: active version % can only transition to archived',
        old.id;
    end if;

    if
      (to_jsonb(new) - 'status' - 'updated_at')
      is distinct from
      (to_jsonb(old) - 'status' - 'updated_at')
    then
      raise exception
        'P19A_CONTRACT_ACTIVE_VERSION_MUTATION_BLOCKED: active version % cannot be changed while being archived',
        old.id;
    end if;

    return new;
  end if;

  -- Ativação só pode partir de uma candidata analisada/em revisão
  -- e somente quando todas as regras estiverem em estado final.
  if new.status = 'active' and old.status <> 'active' then
    if old.status not in ('analyzed', 'awaiting_review') then
      raise exception
        'P19A_CONTRACT_VERSION_NOT_ACTIVATABLE: version % cannot become active from status %',
        old.id,
        old.status;
    end if;

    if old.rejected_at is not null then
      raise exception
        'P19A_CONTRACT_REJECTED_VERSION_NOT_ACTIVATABLE: version % has rejected_at',
        old.id;
    end if;

    select
      count(*),
      count(*) filter (
        where review_status in ('approved', 'rejected', 'edited')
      )
    into
      v_total_rules,
      v_final_rules
    from public.store_contract_template_extracted_rules
    where template_version_id = old.id
      and organization_id = old.organization_id
      and store_id = old.store_id;

    if v_total_rules = 0 then
      raise exception
        'P19A_CONTRACT_VERSION_HAS_NO_RULES: version % cannot become active without extracted rules',
        old.id;
    end if;

    if v_final_rules <> v_total_rules then
      raise exception
        'P19A_CONTRACT_VERSION_HAS_PENDING_RULES: version % cannot become active before all rules are reviewed',
        old.id;
    end if;
  end if;

  -- Rejeição só pertence a candidatas mutáveis.
  if new.status = 'rejected' and old.status <> 'rejected' then
    if old.status not in ('uploaded', 'failed', 'analyzed', 'awaiting_review') then
      raise exception
        'P19A_CONTRACT_VERSION_NOT_REJECTABLE: version % cannot be rejected from status %',
        old.id,
        old.status;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists
  p19a_guard_store_contract_template_version_update_trg
on public.store_contract_template_versions;

create trigger p19a_guard_store_contract_template_version_update_trg
before update
on public.store_contract_template_versions
for each row
execute function public.p19a_guard_store_contract_template_version_update();


-- ============================================================
-- 4. EXTRACTED RULE MUTABILITY GUARD
-- ============================================================

create or replace function public.p19a_guard_store_contract_template_rule_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_version_id uuid;
  v_version_status text;
begin
  -- Cascades originadas da exclusão do pai precisam continuar possíveis.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op = 'DELETE' then
    v_version_id := old.template_version_id;
  else
    v_version_id := new.template_version_id;
  end if;

  select status
  into v_version_status
  from public.store_contract_template_versions
  where id = v_version_id;

  -- Em cascade o pai pode já não existir na visibilidade da operação.
  if not found then
    if tg_op = 'DELETE' then
      return old;
    end if;

    raise exception
      'P19A_CONTRACT_RULE_PARENT_VERSION_NOT_FOUND: version % does not exist',
      v_version_id;
  end if;

  if v_version_status not in ('analyzed', 'awaiting_review') then
    raise exception
      'P19A_CONTRACT_RULE_VERSION_READ_ONLY: rules of version % with status % are immutable',
      v_version_id,
      v_version_status;
  end if;

  if tg_op = 'UPDATE' then
    if
      new.template_version_id is distinct from old.template_version_id
      or new.organization_id is distinct from old.organization_id
      or new.store_id is distinct from old.store_id
    then
      raise exception
        'P19A_CONTRACT_RULE_SCOPE_IMMUTABLE: rule % cannot move between versions or tenants',
        old.id;
    end if;

    return new;
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  return old;
end;
$$;

drop trigger if exists
  p19a_guard_store_contract_template_rule_mutation_trg
on public.store_contract_template_extracted_rules;

create trigger p19a_guard_store_contract_template_rule_mutation_trg
before insert or update or delete
on public.store_contract_template_extracted_rules
for each row
execute function public.p19a_guard_store_contract_template_rule_mutation();


-- ============================================================
-- 5. ACTIVE POINTER FINAL-STATE INTEGRITY
-- Deferred: permite o cutover ocorrer dentro de uma transação,
-- mas exige consistência antes do COMMIT.
-- ============================================================

create or replace function public.p19a_check_store_contract_active_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.store_contract_templates t
    left join public.store_contract_template_versions v
      on v.id = t.active_version_id
    where
      (
        t.active_version_id is not null
        and (
          v.id is null
          or v.template_id is distinct from t.id
          or v.organization_id is distinct from t.organization_id
          or v.store_id is distinct from t.store_id
          or v.status is distinct from 'active'
        )
      )
      or (
        t.active_version_id is null
        and t.status = 'active'
      )
      or (
        t.active_version_id is not null
        and t.status <> 'active'
      )
  ) then
    raise exception
      'P19A_CONTRACT_ACTIVE_POINTER_INTEGRITY_FAILED: template pointer/status is inconsistent';
  end if;

  if exists (
    select 1
    from public.store_contract_template_versions v
    join public.store_contract_templates t
      on t.id = v.template_id
    where v.status = 'active'
      and t.active_version_id is distinct from v.id
  ) then
    raise exception
      'P19A_CONTRACT_ACTIVE_POINTER_INTEGRITY_FAILED: active version is not the official template pointer';
  end if;

  return null;
end;
$$;

drop trigger if exists
  p19a_store_contract_templates_active_integrity_ct
on public.store_contract_templates;

create constraint trigger p19a_store_contract_templates_active_integrity_ct
after insert or update or delete
on public.store_contract_templates
deferrable initially deferred
for each row
execute function public.p19a_check_store_contract_active_integrity();

drop trigger if exists
  p19a_store_contract_template_versions_active_integrity_ct
on public.store_contract_template_versions;

create constraint trigger p19a_store_contract_template_versions_active_integrity_ct
after insert or update or delete
on public.store_contract_template_versions
deferrable initially deferred
for each row
execute function public.p19a_check_store_contract_active_integrity();


-- ============================================================
-- 6. ATOMIC VERSION ACTIVATION RPC
-- ============================================================

create or replace function public.activate_store_contract_template_version_by_system(
  p_version_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_approved_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template_id uuid;
  v_template public.store_contract_templates%rowtype;
  v_version public.store_contract_template_versions%rowtype;
  v_total_rules bigint;
  v_final_rules bigint;
  v_now timestamptz := now();
begin
  if p_version_id is null
     or p_organization_id is null
     or p_store_id is null
     or p_approved_by is null
  then
    raise exception
      'P19A_CONTRACT_INVALID_ACTIVATION_ARGUMENTS';
  end if;

  select template_id
  into v_template_id
  from public.store_contract_template_versions
  where id = p_version_id
    and organization_id = p_organization_id
    and store_id = p_store_id;

  if v_template_id is null then
    raise exception
      'P19A_CONTRACT_VERSION_NOT_FOUND_OR_OUT_OF_SCOPE';
  end if;

  -- Serializa qualquer aprovação concorrente do mesmo template.
  select *
  into v_template
  from public.store_contract_templates
  where id = v_template_id
    and organization_id = p_organization_id
    and store_id = p_store_id
  for update;

  if not found then
    raise exception
      'P19A_CONTRACT_TEMPLATE_NOT_FOUND_OR_OUT_OF_SCOPE';
  end if;

  -- Recarrega a candidata depois do lock do template.
  select *
  into v_version
  from public.store_contract_template_versions
  where id = p_version_id
    and template_id = v_template.id
    and organization_id = p_organization_id
    and store_id = p_store_id
  for update;

  if not found then
    raise exception
      'P19A_CONTRACT_VERSION_NOT_FOUND_OR_OUT_OF_SCOPE';
  end if;

  -- Replay idempotente exato: não reescreve approved_at/by.
  if v_version.status = 'active'
     and v_template.active_version_id = v_version.id
     and v_template.status = 'active'
  then
    return v_version.id;
  end if;

  if v_version.status not in ('analyzed', 'awaiting_review') then
    raise exception
      'P19A_CONTRACT_VERSION_NOT_ACTIVATABLE: status %',
      v_version.status;
  end if;

  if v_version.rejected_at is not null then
    raise exception
      'P19A_CONTRACT_REJECTED_VERSION_NOT_ACTIVATABLE';
  end if;

  select
    count(*),
    count(*) filter (
      where review_status in ('approved', 'rejected', 'edited')
    )
  into
    v_total_rules,
    v_final_rules
  from public.store_contract_template_extracted_rules
  where template_version_id = v_version.id
    and organization_id = p_organization_id
    and store_id = p_store_id;

  if v_total_rules = 0 then
    raise exception
      'P19A_CONTRACT_VERSION_HAS_NO_RULES';
  end if;

  if v_final_rules <> v_total_rules then
    raise exception
      'P19A_CONTRACT_VERSION_HAS_PENDING_RULES';
  end if;

  -- 1. arquiva a ativa anterior
  update public.store_contract_template_versions
  set
    status = 'archived',
    updated_at = v_now
  where template_id = v_template.id
    and organization_id = p_organization_id
    and store_id = p_store_id
    and status = 'active'
    and id <> v_version.id;

  -- 2. ativa a candidata
  update public.store_contract_template_versions
  set
    status = 'active',
    approved_at = v_now,
    approved_by = p_approved_by,
    rejected_at = null,
    rejected_by = null,
    rejection_reason = null,
    updated_at = v_now
  where id = v_version.id
    and template_id = v_template.id
    and organization_id = p_organization_id
    and store_id = p_store_id;

  if not found then
    raise exception
      'P19A_CONTRACT_VERSION_ACTIVATION_UPDATE_FAILED';
  end if;

  -- 3. troca o ponteiro oficial
  update public.store_contract_templates
  set
    active_version_id = v_version.id,
    status = 'active',
    updated_at = v_now
  where id = v_template.id
    and organization_id = p_organization_id
    and store_id = p_store_id;

  if not found then
    raise exception
      'P19A_CONTRACT_TEMPLATE_POINTER_UPDATE_FAILED';
  end if;

  return v_version.id;
end;
$$;


-- ============================================================
-- 7. ATOMIC RULE REPLACEMENT RPC
-- ============================================================

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

  -- DELETE + INSERT agora pertencem à mesma transação.
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


-- ============================================================
-- 8. RPC PERMISSIONS
-- ============================================================

revoke all
on function public.activate_store_contract_template_version_by_system(
  uuid,
  uuid,
  uuid,
  uuid
)
from public;

revoke all
on function public.activate_store_contract_template_version_by_system(
  uuid,
  uuid,
  uuid,
  uuid
)
from anon;

revoke all
on function public.activate_store_contract_template_version_by_system(
  uuid,
  uuid,
  uuid,
  uuid
)
from authenticated;

grant execute
on function public.activate_store_contract_template_version_by_system(
  uuid,
  uuid,
  uuid,
  uuid
)
to service_role;


revoke all
on function public.replace_store_contract_template_rules_by_system(
  uuid,
  uuid,
  uuid,
  jsonb,
  uuid
)
from public;

revoke all
on function public.replace_store_contract_template_rules_by_system(
  uuid,
  uuid,
  uuid,
  jsonb,
  uuid
)
from anon;

revoke all
on function public.replace_store_contract_template_rules_by_system(
  uuid,
  uuid,
  uuid,
  jsonb,
  uuid
)
from authenticated;

grant execute
on function public.replace_store_contract_template_rules_by_system(
  uuid,
  uuid,
  uuid,
  jsonb,
  uuid
)
to service_role;
