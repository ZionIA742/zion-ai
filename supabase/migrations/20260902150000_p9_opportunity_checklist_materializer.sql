begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:opportunity-checklist-materializer:v1', 0)
);

-- ============================================================================
-- P9 / Bloco 3 / Etapa 3.5
-- Commercial Opportunity Checklist Materializer v1.
--
-- Frozen authority contract:
-- - checklist definition is applicability, not readiness/progress;
-- - current Profile + current Gate Policy + relevant live Settings are snapshotted;
-- - explicit current pointers are authoritative; latest/max fallbacks are forbidden;
-- - profile structural uncertainty propagates fail-closed to dependent items;
-- - installation=included + offers_installation=false is a structural conflict;
-- - installation=unresolved keeps installation-dependent items needs_resolution;
-- - offers_technical_visit=false makes technical_visit not_applicable;
-- - contract_enabled=false makes contract not_applicable; true does not make it
--   required and therefore the policy/default still decides it;
-- - equal-priority incompatible candidate outcomes materialize as conflict;
-- - component_and_execution is a real AND: uncertainty/conflict on one side does
--   not leak when the other side definitively does not match;
-- - a human current checklist is never overwritten by this system materializer;
-- - any non-owned system checklist authority is also preserved;
-- - event-key replay is idempotent and stale replay never regresses current or
--   reinterprets the original event with newer Profile/Policy/Settings;
-- - versions/items remain append-only and current is moved explicitly.
-- ============================================================================

do $preflight$
declare
  v_table text;
  v_signature text;
begin
  foreach v_table in array array[
    'organizations',
    'stores',
    'commercial_opportunities',
    'commercial_opportunity_profile_versions',
    'commercial_opportunity_profile_components',
    'commercial_opportunity_profile_execution_intents',
    'commercial_opportunity_profile_current',
    'store_opportunity_gate_policy_versions',
    'store_opportunity_gate_policy_rules',
    'store_opportunity_gate_policy_current',
    'commercial_opportunity_checklist_versions',
    'commercial_opportunity_checklist_items',
    'commercial_opportunity_checklist_current',
    'store_operation_settings',
    'store_contract_settings'
  ] loop
    if pg_catalog.to_regclass('public.' || v_table) is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('precondition failed: public.%s is missing', v_table);
    end if;
  end loop;

  if pg_catalog.to_regprocedure('public.zion_resolve_request_role_internal()') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.zion_resolve_request_role_internal() is missing';
  end if;

  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: extensions.digest(bytea,text) is missing';
  end if;

  foreach v_signature in array array[
    'public.p9_opportunity_checklist_merge_candidate_internal(jsonb,integer,text,text,jsonb)',
    'public.materialize_commercial_opportunity_checklist_by_system(uuid,uuid,uuid,text)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is not null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('opportunity checklist materializer collision detected: %s', v_signature);
    end if;
  end loop;
end;
$preflight$;

-- Pure internal reducer used to keep one deterministic highest-priority
-- candidate set per checklist item.
create or replace function public.p9_opportunity_checklist_merge_candidate_internal(
  p_entry jsonb,
  p_priority integer,
  p_state text,
  p_reason_code text,
  p_candidate jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_entry jsonb := coalesce(p_entry, '{}'::jsonb);
  v_current_priority integer;
begin
  if pg_catalog.jsonb_typeof(v_entry) is distinct from 'object'
     or p_priority is null
     or p_state not in ('required', 'optional', 'not_applicable', 'needs_resolution', 'conflict')
     or p_reason_code is null
     or pg_catalog.jsonb_typeof(p_candidate) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_CANDIDATE_INVALID';
  end if;

  v_current_priority := coalesce((v_entry ->> 'selected_priority')::integer, -2147483648);

  if p_priority > v_current_priority then
    return v_entry || pg_catalog.jsonb_build_object(
      'selected_priority', p_priority,
      'candidates', pg_catalog.jsonb_build_array(
        p_candidate || pg_catalog.jsonb_build_object(
          'priority', p_priority,
          'state', p_state,
          'reason_code', p_reason_code
        )
      )
    );
  end if;

  if p_priority = v_current_priority then
    return pg_catalog.jsonb_set(
      v_entry,
      '{candidates}',
      coalesce(v_entry -> 'candidates', '[]'::jsonb)
        || pg_catalog.jsonb_build_array(
          p_candidate || pg_catalog.jsonb_build_object(
            'priority', p_priority,
            'state', p_state,
            'reason_code', p_reason_code
          )
        ),
      true
    );
  end if;

  return v_entry;
end;
$function$;

alter function public.p9_opportunity_checklist_merge_candidate_internal(
  jsonb, integer, text, text, jsonb
) owner to postgres;

revoke all on function public.p9_opportunity_checklist_merge_candidate_internal(
  jsonb, integer, text, text, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.materialize_commercial_opportunity_checklist_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_materialization_event_key text
)
returns table (
  current_checklist_version_id uuid,
  version_number integer,
  previous_checklist_version_id uuid,
  profile_version_id uuid,
  gate_policy_version_id uuid,
  item_count integer,
  checklist_state text,
  changed boolean,
  replayed boolean,
  preserved boolean,
  outcome text,
  request_fingerprint text,
  settings_fingerprint text,
  actor_type text,
  source_type text,
  created_by text,
  current_updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public, auth, extensions
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_event_key text := nullif(pg_catalog.btrim(coalesce(p_materialization_event_key, '')), '');
  v_operation_key text;

  v_history_count integer := 0;
  v_has_current boolean := false;
  v_current public.commercial_opportunity_checklist_current%rowtype;
  v_current_version public.commercial_opportunity_checklist_versions%rowtype;
  v_existing public.commercial_opportunity_checklist_versions%rowtype;
  v_new public.commercial_opportunity_checklist_versions%rowtype;
  v_new_version_number integer;
  v_new_previous_id uuid;

  v_profile_current public.commercial_opportunity_profile_current%rowtype;
  v_profile_version public.commercial_opportunity_profile_versions%rowtype;
  v_policy_current public.store_opportunity_gate_policy_current%rowtype;
  v_policy_version public.store_opportunity_gate_policy_versions%rowtype;

  v_operation_rows jsonb;
  v_contract_rows jsonb;
  v_operation_present boolean := false;
  v_contract_present boolean := false;
  v_offers_installation boolean;
  v_offers_technical_visit boolean;
  v_contract_enabled boolean;
  v_settings_snapshot jsonb;
  v_settings_fingerprint text;

  v_installation_intent_state text;

  v_item_map jsonb := '{}'::jsonb;
  v_item_entry jsonb;
  v_candidate jsonb;
  v_items jsonb := '[]'::jsonb;
  v_existing_items jsonb := '[]'::jsonb;
  v_current_items jsonb := '[]'::jsonb;
  v_item_record record;
  v_rule public.store_opportunity_gate_policy_rules%rowtype;
  v_component_status text;
  v_execution_status text;
  v_match_status text;
  v_candidate_state text;
  v_candidate_reason text;
  v_selected_state_count integer;
  v_final_state text;
  v_final_reason text;
  v_item_count integer := 0;
  v_checklist_state text;

  v_request_payload jsonb;
  v_request_fingerprint text;
  v_recomputed_fingerprint text;
  v_recomputed_settings_fingerprint text;
begin
  if v_request_role is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'ZION_CHECKLIST_MATERIALIZER_NOT_AUTHORIZED';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_SCOPE_REQUIRED';
  end if;

  if v_event_key is null or pg_catalog.length(v_event_key) > 160 then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_EVENT_KEY_INVALID';
  end if;

  v_operation_key := 'opportunity_checklist:v1:' || v_event_key;

  if pg_catalog.length(v_operation_key) > 200 then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_OPERATION_KEY_INVALID';
  end if;

  -- Freeze Gate Policy before taking the opportunity lock. The policy writer
  -- uses this exact store-scoped advisory lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:gate-policy-writer:v1:' || p_organization_id::text || ':' || p_store_id::text,
      0
    )
  );

  -- Serialize with Profile writers/materializers on the same opportunity.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_store_id::text || ':' || p_commercial_opportunity_id::text,
      0
    )
  );

  perform 1
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'ZION_CHECKLIST_OPPORTUNITY_SCOPE_INVALID';
  end if;

  select current_row.*
  into v_current
  from public.commercial_opportunity_checklist_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id
  for update;

  v_has_current := found;

  select pg_catalog.count(*)::integer
  into v_history_count
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id
    and version_row.commercial_opportunity_id = p_commercial_opportunity_id;

  if not v_has_current and v_history_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_CURRENT_MISSING_WITH_HISTORY';
  end if;

  if v_has_current then
    select version_row.*
    into v_current_version
    from public.commercial_opportunity_checklist_versions version_row
    where version_row.id = v_current.current_checklist_version_id
      and version_row.organization_id = p_organization_id
      and version_row.store_id = p_store_id
      and version_row.commercial_opportunity_id = p_commercial_opportunity_id;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_CHECKLIST_CURRENT_VERSION_INVALID';
    end if;
  end if;

  -- Event-key replay is resolved before reading newer Profile/Policy/Settings.
  -- This intentionally prevents reinterpretation of the old event.
  select version_row.*
  into v_existing
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id
    and version_row.commercial_opportunity_id = p_commercial_opportunity_id
    and version_row.operation_key = v_operation_key;

  if found then
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'item_key', item_row.item_key,
          'item_kind', item_row.item_kind,
          'applicability_state', item_row.applicability_state,
          'reason_code', item_row.reason_code,
          'decision_basis', item_row.decision_basis,
          'metadata', item_row.metadata
        )
        order by item_row.item_key
      ),
      '[]'::jsonb
    )
    into v_existing_items
    from public.commercial_opportunity_checklist_items item_row
    where item_row.organization_id = p_organization_id
      and item_row.store_id = p_store_id
      and item_row.commercial_opportunity_id = p_commercial_opportunity_id
      and item_row.checklist_version_id = v_existing.id;

    v_recomputed_settings_fingerprint := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(v_existing.settings_snapshot::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    );

    if v_existing.settings_fingerprint is distinct from v_recomputed_settings_fingerprint then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_CHECKLIST_STORED_SETTINGS_FINGERPRINT_MISMATCH';
    end if;

    v_recomputed_fingerprint := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.jsonb_build_object(
            'materializer_version', 1,
            'profile_version_id', v_existing.profile_version_id,
            'gate_policy_version_id', v_existing.gate_policy_version_id,
            'settings_fingerprint', v_existing.settings_fingerprint,
            'items', v_existing_items
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    if v_existing.request_fingerprint is distinct from v_recomputed_fingerprint then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_CHECKLIST_STORED_REQUEST_FINGERPRINT_MISMATCH';
    end if;

    return query
    select
      v_existing.id,
      v_existing.version_number,
      v_existing.previous_checklist_version_id,
      v_existing.profile_version_id,
      v_existing.gate_policy_version_id,
      pg_catalog.jsonb_array_length(v_existing_items),
      v_existing.checklist_state,
      false,
      true,
      false,
      case
        when v_current.current_checklist_version_id = v_existing.id
          then 'idempotent_replay_current'
        else 'idempotent_replay_stale'
      end,
      v_existing.request_fingerprint,
      v_existing.settings_fingerprint,
      v_existing.actor_type,
      v_existing.source_type,
      v_existing.created_by,
      v_current.updated_at;
    return;
  end if;

  -- Option A: once a human owns the current checklist, automatic
  -- rematerialization preserves it. Carry-forward semantics belong to the
  -- dedicated override/resolution subpass.
  if v_has_current and v_current_version.actor_type = 'human' then
    select pg_catalog.count(*)::integer
    into v_item_count
    from public.commercial_opportunity_checklist_items item_row
    where item_row.organization_id = p_organization_id
      and item_row.store_id = p_store_id
      and item_row.commercial_opportunity_id = p_commercial_opportunity_id
      and item_row.checklist_version_id = v_current_version.id;

    return query
    select
      v_current_version.id,
      v_current_version.version_number,
      v_current_version.previous_checklist_version_id,
      v_current_version.profile_version_id,
      v_current_version.gate_policy_version_id,
      v_item_count,
      v_current_version.checklist_state,
      false,
      false,
      true,
      'preserved_human_authority'::text,
      v_current_version.request_fingerprint,
      v_current_version.settings_fingerprint,
      v_current_version.actor_type,
      v_current_version.source_type,
      v_current_version.created_by,
      v_current.updated_at;
    return;
  end if;

  if v_has_current and (
    v_current_version.actor_type <> 'system'
    or v_current_version.source_type <> 'opportunity_checklist_materializer'
    or v_current_version.created_by <> 'p9_checklist_materializer_v1'
  ) then
    select pg_catalog.count(*)::integer
    into v_item_count
    from public.commercial_opportunity_checklist_items item_row
    where item_row.organization_id = p_organization_id
      and item_row.store_id = p_store_id
      and item_row.commercial_opportunity_id = p_commercial_opportunity_id
      and item_row.checklist_version_id = v_current_version.id;

    return query
    select
      v_current_version.id,
      v_current_version.version_number,
      v_current_version.previous_checklist_version_id,
      v_current_version.profile_version_id,
      v_current_version.gate_policy_version_id,
      v_item_count,
      v_current_version.checklist_state,
      false,
      false,
      true,
      'preserved_non_materializer_authority'::text,
      v_current_version.request_fingerprint,
      v_current_version.settings_fingerprint,
      v_current_version.actor_type,
      v_current_version.source_type,
      v_current_version.created_by,
      v_current.updated_at;
    return;
  end if;

  -- Read exact current Profile. Opportunity row lock serializes this with the
  -- canonical Profile writer/materializer.
  select current_row.*
  into v_profile_current
  from public.commercial_opportunity_profile_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_PROFILE_CURRENT_REQUIRED';
  end if;

  select version_row.*
  into v_profile_version
  from public.commercial_opportunity_profile_versions version_row
  where version_row.id = v_profile_current.current_profile_version_id
    and version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id
    and version_row.commercial_opportunity_id = p_commercial_opportunity_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_PROFILE_CURRENT_VERSION_INVALID';
  end if;

  -- Read exact current Gate Policy while holding the same store advisory lock
  -- as its canonical writer.
  select current_row.*
  into v_policy_current
  from public.store_opportunity_gate_policy_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_GATE_POLICY_CURRENT_REQUIRED';
  end if;

  select version_row.*
  into v_policy_version
  from public.store_opportunity_gate_policy_versions version_row
  where version_row.id = v_policy_current.current_policy_version_id
    and version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_GATE_POLICY_CURRENT_VERSION_INVALID';
  end if;

  if not exists (
    select 1
    from public.store_opportunity_gate_policy_rules rule_row
    where rule_row.organization_id = p_organization_id
      and rule_row.store_id = p_store_id
      and rule_row.policy_version_id = v_policy_version.id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_GATE_POLICY_RULES_REQUIRED';
  end if;

  if exists (
    select 1
    from public.store_opportunity_gate_policy_rules rule_row
    where rule_row.organization_id = p_organization_id
      and rule_row.store_id = p_store_id
      and rule_row.policy_version_id = v_policy_version.id
    group by rule_row.item_key
    having pg_catalog.count(distinct rule_row.item_kind) > 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_POLICY_ITEM_KIND_AMBIGUOUS';
  end if;

  -- Capture all Settings consumed by this materializer in one MVCC statement.
  -- Only semantic authority fields are snapshotted; timestamps are excluded.
  select
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'offers_installation', settings_row.offers_installation,
            'offers_technical_visit', settings_row.offers_technical_visit
          )
          order by settings_row.store_id
        )
        from public.store_operation_settings settings_row
        where settings_row.organization_id = p_organization_id
          and settings_row.store_id = p_store_id
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'contract_enabled', settings_row.contract_enabled
          )
          order by settings_row.id
        )
        from public.store_contract_settings settings_row
        where settings_row.organization_id = p_organization_id
          and settings_row.store_id = p_store_id
      ),
      '[]'::jsonb
    )
  into v_operation_rows, v_contract_rows;

  if pg_catalog.jsonb_array_length(v_operation_rows) > 1 then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_OPERATION_SETTINGS_AMBIGUOUS';
  end if;

  if pg_catalog.jsonb_array_length(v_contract_rows) > 1 then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_CONTRACT_SETTINGS_AMBIGUOUS';
  end if;

  v_operation_present := pg_catalog.jsonb_array_length(v_operation_rows) = 1;
  v_contract_present := pg_catalog.jsonb_array_length(v_contract_rows) = 1;

  if v_operation_present then
    v_offers_installation := (v_operation_rows -> 0 ->> 'offers_installation')::boolean;
    v_offers_technical_visit := (v_operation_rows -> 0 ->> 'offers_technical_visit')::boolean;
  else
    v_offers_installation := null;
    v_offers_technical_visit := null;
  end if;

  if v_contract_present then
    v_contract_enabled := (v_contract_rows -> 0 ->> 'contract_enabled')::boolean;
  else
    v_contract_enabled := null;
  end if;

  v_settings_snapshot := pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'operation', pg_catalog.jsonb_build_object(
      'present', v_operation_present,
      'offers_installation', v_offers_installation,
      'offers_technical_visit', v_offers_technical_visit
    ),
    'contract', pg_catalog.jsonb_build_object(
      'present', v_contract_present,
      'contract_enabled', v_contract_enabled
    )
  );

  v_settings_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_settings_snapshot::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select intent_row.intent_state
  into v_installation_intent_state
  from public.commercial_opportunity_profile_execution_intents intent_row
  where intent_row.organization_id = p_organization_id
    and intent_row.store_id = p_store_id
    and intent_row.commercial_opportunity_id = p_commercial_opportunity_id
    and intent_row.profile_version_id = v_profile_version.id
    and intent_row.execution_kind = 'installation';

  -- Initialize every policy item with a low-priority fail-closed fallback so a
  -- malformed/incomplete policy cannot silently omit an item.
  for v_item_record in
    select distinct rule_row.item_key, rule_row.item_kind
    from public.store_opportunity_gate_policy_rules rule_row
    where rule_row.organization_id = p_organization_id
      and rule_row.store_id = p_store_id
      and rule_row.policy_version_id = v_policy_version.id
    order by rule_row.item_key
  loop
    v_item_entry := pg_catalog.jsonb_build_object(
      'item_key', v_item_record.item_key,
      'item_kind', v_item_record.item_kind,
      'selected_priority', -1,
      'candidates', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'candidate_key', 'system:unmatched',
          'source', 'system_fallback',
          'priority', -1,
          'state', 'needs_resolution',
          'reason_code', 'policy_item_no_applicable_rule'
        )
      )
    );

    v_item_map := pg_catalog.jsonb_set(
      v_item_map,
      array[v_item_record.item_key],
      v_item_entry,
      true
    );
  end loop;

  -- Evaluate policy rules deterministically.
  for v_rule in
    select rule_row.*
    from public.store_opportunity_gate_policy_rules rule_row
    where rule_row.organization_id = p_organization_id
      and rule_row.store_id = p_store_id
      and rule_row.policy_version_id = v_policy_version.id
    order by rule_row.item_key, rule_row.rule_priority desc, rule_row.rule_key
  loop
    v_component_status := 'not_used';
    v_execution_status := 'not_used';

    if v_rule.match_mode in ('component', 'component_and_execution') then
      if exists (
        select 1
        from public.commercial_opportunity_profile_components component_row
        where component_row.organization_id = p_organization_id
          and component_row.store_id = p_store_id
          and component_row.commercial_opportunity_id = p_commercial_opportunity_id
          and component_row.profile_version_id = v_profile_version.id
          and component_row.component_kind = v_rule.component_kind
          and component_row.component_state = 'conflict'
      ) then
        v_component_status := 'conflict';
      elsif exists (
        select 1
        from public.commercial_opportunity_profile_components component_row
        where component_row.organization_id = p_organization_id
          and component_row.store_id = p_store_id
          and component_row.commercial_opportunity_id = p_commercial_opportunity_id
          and component_row.profile_version_id = v_profile_version.id
          and component_row.component_kind = v_rule.component_kind
          and component_row.component_state in ('resolved', 'partial')
      ) then
        v_component_status := 'match';
      else
        v_component_status := 'no_match';
      end if;
    end if;

    if v_rule.match_mode in ('execution', 'component_and_execution') then
      if exists (
        select 1
        from public.commercial_opportunity_profile_execution_intents intent_row
        where intent_row.organization_id = p_organization_id
          and intent_row.store_id = p_store_id
          and intent_row.commercial_opportunity_id = p_commercial_opportunity_id
          and intent_row.profile_version_id = v_profile_version.id
          and intent_row.execution_kind = v_rule.execution_kind
          and intent_row.intent_state = 'conflict'
      ) then
        v_execution_status := 'conflict';
      elsif exists (
        select 1
        from public.commercial_opportunity_profile_execution_intents intent_row
        where intent_row.organization_id = p_organization_id
          and intent_row.store_id = p_store_id
          and intent_row.commercial_opportunity_id = p_commercial_opportunity_id
          and intent_row.profile_version_id = v_profile_version.id
          and intent_row.execution_kind = v_rule.execution_kind
          and intent_row.intent_state = 'unresolved'
      ) then
        v_execution_status := 'unresolved';
      elsif exists (
        select 1
        from public.commercial_opportunity_profile_execution_intents intent_row
        where intent_row.organization_id = p_organization_id
          and intent_row.store_id = p_store_id
          and intent_row.commercial_opportunity_id = p_commercial_opportunity_id
          and intent_row.profile_version_id = v_profile_version.id
          and intent_row.execution_kind = v_rule.execution_kind
          and intent_row.intent_state = 'included'
      ) then
        v_execution_status := 'match';
      else
        -- excluded or absent both mean the execution predicate does not match.
        v_execution_status := 'no_match';
      end if;
    end if;

    case v_rule.match_mode
      when 'always' then
        v_match_status := 'match';
      when 'component' then
        v_match_status := v_component_status;
      when 'execution' then
        v_match_status := v_execution_status;
      when 'component_and_execution' then
        if v_component_status = 'no_match' or v_execution_status = 'no_match' then
          v_match_status := 'no_match';
        elsif v_component_status = 'conflict' or v_execution_status = 'conflict' then
          v_match_status := 'conflict';
        elsif v_component_status = 'unresolved' or v_execution_status = 'unresolved' then
          v_match_status := 'unresolved';
        else
          v_match_status := 'match';
        end if;
      else
        raise exception using
          errcode = 'P0001',
          message = 'ZION_CHECKLIST_POLICY_MATCH_MODE_UNEXPECTED';
    end case;

    if v_match_status <> 'no_match' then
      if v_match_status = 'conflict' then
        v_candidate_state := 'conflict';
        v_candidate_reason := 'profile_structural_conflict';
      elsif v_match_status = 'unresolved' then
        v_candidate_state := 'needs_resolution';
        v_candidate_reason := 'profile_structural_needs_resolution';
      else
        v_candidate_state := v_rule.applicability_state;
        v_candidate_reason := v_rule.reason_code;
      end if;

      v_candidate := pg_catalog.jsonb_build_object(
        'candidate_key', 'policy:' || v_rule.rule_key,
        'source', 'gate_policy',
        'rule_key', v_rule.rule_key,
        'match_mode', v_rule.match_mode,
        'match_status', v_match_status,
        'component_kind', v_rule.component_kind,
        'execution_kind', v_rule.execution_kind
      );

      v_item_entry := public.p9_opportunity_checklist_merge_candidate_internal(
        v_item_map -> v_rule.item_key,
        v_rule.rule_priority,
        v_candidate_state,
        v_candidate_reason,
        v_candidate
      );

      v_item_map := pg_catalog.jsonb_set(
        v_item_map,
        array[v_rule.item_key],
        v_item_entry,
        true
      );
    end if;
  end loop;

  -- Settings authority: an included installation that the store explicitly does
  -- not offer is a structural contradiction. Unknown capability fails closed.
  if v_installation_intent_state = 'included'
     and (v_offers_installation is false or v_offers_installation is null) then
    for v_item_record in
      select distinct rule_row.item_key
      from public.store_opportunity_gate_policy_rules rule_row
      where rule_row.organization_id = p_organization_id
        and rule_row.store_id = p_store_id
        and rule_row.policy_version_id = v_policy_version.id
        and rule_row.execution_kind = 'installation'
      order by rule_row.item_key
    loop
      v_candidate := pg_catalog.jsonb_build_object(
        'candidate_key', 'settings:installation_capability',
        'source', 'store_operation_settings',
        'setting', 'offers_installation',
        'value', v_offers_installation
      );

      v_item_entry := public.p9_opportunity_checklist_merge_candidate_internal(
        v_item_map -> v_item_record.item_key,
        2000,
        case when v_offers_installation is false then 'conflict' else 'needs_resolution' end,
        case
          when v_offers_installation is false then 'installation_included_but_store_does_not_offer'
          else 'installation_capability_not_configured'
        end,
        v_candidate
      );

      v_item_map := pg_catalog.jsonb_set(
        v_item_map,
        array[v_item_record.item_key],
        v_item_entry,
        true
      );
    end loop;
  end if;

  -- Explicit store capability for technical visits overrides policy applicability.
  -- Unknown capability only blocks when a non-fallback technical-visit rule is
  -- structurally relevant to the current Profile.
  if v_item_map ? 'technical_visit' then
    if v_offers_technical_visit is false then
      v_candidate := pg_catalog.jsonb_build_object(
        'candidate_key', 'settings:technical_visit_capability',
        'source', 'store_operation_settings',
        'setting', 'offers_technical_visit',
        'value', false
      );

      v_item_entry := public.p9_opportunity_checklist_merge_candidate_internal(
        v_item_map -> 'technical_visit',
        3000,
        'not_applicable',
        'store_does_not_offer_technical_visit',
        v_candidate
      );

      v_item_map := pg_catalog.jsonb_set(v_item_map, '{technical_visit}', v_item_entry, true);
    elsif v_offers_technical_visit is null and exists (
      select 1
      from public.store_opportunity_gate_policy_rules rule_row
      where rule_row.organization_id = p_organization_id
        and rule_row.store_id = p_store_id
        and rule_row.policy_version_id = v_policy_version.id
        and rule_row.item_key = 'technical_visit'
        and rule_row.match_mode <> 'always'
        and (
          (rule_row.match_mode in ('execution', 'component_and_execution')
            and rule_row.execution_kind = 'installation'
            and v_installation_intent_state in ('included', 'unresolved', 'conflict'))
          or
          (rule_row.match_mode in ('component', 'component_and_execution')
            and exists (
              select 1
              from public.commercial_opportunity_profile_components component_row
              where component_row.organization_id = p_organization_id
                and component_row.store_id = p_store_id
                and component_row.commercial_opportunity_id = p_commercial_opportunity_id
                and component_row.profile_version_id = v_profile_version.id
                and component_row.component_kind = rule_row.component_kind
            ))
        )
    ) then
      v_candidate := pg_catalog.jsonb_build_object(
        'candidate_key', 'settings:technical_visit_capability',
        'source', 'store_operation_settings',
        'setting', 'offers_technical_visit',
        'value', null
      );

      v_item_entry := public.p9_opportunity_checklist_merge_candidate_internal(
        v_item_map -> 'technical_visit',
        3000,
        'needs_resolution',
        'technical_visit_capability_not_configured',
        v_candidate
      );

      v_item_map := pg_catalog.jsonb_set(v_item_map, '{technical_visit}', v_item_entry, true);
    end if;
  end if;

  -- Contract enabled means the feature exists, not that every sale requires it.
  -- Disabled means the gate is not applicable; missing Settings fail closed.
  if v_item_map ? 'contract' then
    if v_contract_present and v_contract_enabled is false then
      v_candidate := pg_catalog.jsonb_build_object(
        'candidate_key', 'settings:contract_enabled',
        'source', 'store_contract_settings',
        'setting', 'contract_enabled',
        'value', false
      );

      v_item_entry := public.p9_opportunity_checklist_merge_candidate_internal(
        v_item_map -> 'contract',
        3000,
        'not_applicable',
        'contract_disabled_for_store',
        v_candidate
      );

      v_item_map := pg_catalog.jsonb_set(v_item_map, '{contract}', v_item_entry, true);
    elsif not v_contract_present then
      v_candidate := pg_catalog.jsonb_build_object(
        'candidate_key', 'settings:contract_enabled',
        'source', 'store_contract_settings',
        'setting', 'contract_enabled',
        'value', null
      );

      v_item_entry := public.p9_opportunity_checklist_merge_candidate_internal(
        v_item_map -> 'contract',
        3000,
        'needs_resolution',
        'contract_settings_not_configured',
        v_candidate
      );

      v_item_map := pg_catalog.jsonb_set(v_item_map, '{contract}', v_item_entry, true);
    end if;
  end if;

  -- Resolve each item's highest-priority candidate set. Equal-priority
  -- incompatible states become conflict instead of an arbitrary winner.
  for v_item_record in
    select item_row.key as item_key, item_row.value as entry
    from pg_catalog.jsonb_each(v_item_map) item_row(key, value)
    order by item_row.key
  loop
    select
      pg_catalog.count(distinct candidate_row.value ->> 'state')::integer,
      (pg_catalog.array_agg(candidate_row.value ->> 'state' order by candidate_row.value ->> 'candidate_key'))[1],
      (pg_catalog.array_agg(candidate_row.value ->> 'reason_code' order by candidate_row.value ->> 'candidate_key'))[1]
    into v_selected_state_count, v_final_state, v_final_reason
    from pg_catalog.jsonb_array_elements(v_item_record.entry -> 'candidates') candidate_row(value);

    if v_selected_state_count > 1 then
      v_final_state := 'conflict';
      v_final_reason := 'equal_priority_applicability_conflict';
    end if;

    v_items := v_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'item_key', v_item_record.item_key,
        'item_kind', v_item_record.entry ->> 'item_kind',
        'applicability_state', v_final_state,
        'reason_code', v_final_reason,
        'decision_basis', pg_catalog.jsonb_build_object(
          'materializer_version', 1,
          'selected_priority', (v_item_record.entry ->> 'selected_priority')::integer,
          'selected_candidates', v_item_record.entry -> 'candidates',
          'profile_version_id', v_profile_version.id,
          'gate_policy_version_id', v_policy_version.id,
          'settings_fingerprint', v_settings_fingerprint
        ),
        'metadata', pg_catalog.jsonb_build_object(
          'materializer_version', 1
        )
      )
    );
  end loop;

  select coalesce(
    pg_catalog.jsonb_agg(item_row.value order by item_row.value ->> 'item_key'),
    '[]'::jsonb
  )
  into v_items
  from pg_catalog.jsonb_array_elements(v_items) item_row(value);

  v_item_count := pg_catalog.jsonb_array_length(v_items);

  if v_item_count = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_MATERIALIZED_ITEMS_EMPTY';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_items) item_row(value)
    where item_row.value ->> 'applicability_state' = 'conflict'
  ) then
    v_checklist_state := 'conflict';
  elsif exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_items) item_row(value)
    where item_row.value ->> 'applicability_state' = 'needs_resolution'
  ) then
    v_checklist_state := 'needs_resolution';
  else
    v_checklist_state := 'resolved';
  end if;

  v_request_payload := pg_catalog.jsonb_build_object(
    'materializer_version', 1,
    'profile_version_id', v_profile_version.id,
    'gate_policy_version_id', v_policy_version.id,
    'settings_fingerprint', v_settings_fingerprint,
    'items', v_items
  );

  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_request_payload::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  if v_has_current then
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'item_key', item_row.item_key,
          'item_kind', item_row.item_kind,
          'applicability_state', item_row.applicability_state,
          'reason_code', item_row.reason_code,
          'decision_basis', item_row.decision_basis,
          'metadata', item_row.metadata
        )
        order by item_row.item_key
      ),
      '[]'::jsonb
    )
    into v_current_items
    from public.commercial_opportunity_checklist_items item_row
    where item_row.organization_id = p_organization_id
      and item_row.store_id = p_store_id
      and item_row.commercial_opportunity_id = p_commercial_opportunity_id
      and item_row.checklist_version_id = v_current_version.id;

    if v_current_version.request_fingerprint = v_request_fingerprint then
      if v_current_version.profile_version_id is distinct from v_profile_version.id
         or v_current_version.gate_policy_version_id is distinct from v_policy_version.id
         or v_current_version.settings_snapshot is distinct from v_settings_snapshot
         or v_current_version.settings_fingerprint is distinct from v_settings_fingerprint
         or v_current_version.checklist_state is distinct from v_checklist_state
         or v_current_items is distinct from v_items then
        raise exception using
          errcode = 'P0001',
          message = 'ZION_CHECKLIST_FINGERPRINT_PAYLOAD_MISMATCH';
      end if;

      return query
      select
        v_current_version.id,
        v_current_version.version_number,
        v_current_version.previous_checklist_version_id,
        v_current_version.profile_version_id,
        v_current_version.gate_policy_version_id,
        v_item_count,
        v_current_version.checklist_state,
        false,
        false,
        false,
        'checklist_unchanged'::text,
        v_current_version.request_fingerprint,
        v_current_version.settings_fingerprint,
        v_current_version.actor_type,
        v_current_version.source_type,
        v_current_version.created_by,
        v_current.updated_at;
      return;
    end if;
  end if;

  if v_has_current then
    v_new_previous_id := v_current_version.id;
    v_new_version_number := v_current_version.version_number + 1;
  else
    v_new_previous_id := null;
    v_new_version_number := 1;
  end if;

  insert into public.commercial_opportunity_checklist_versions (
    organization_id,
    store_id,
    commercial_opportunity_id,
    version_number,
    previous_checklist_version_id,
    profile_version_id,
    gate_policy_version_id,
    checklist_state,
    settings_snapshot,
    settings_fingerprint,
    operation_key,
    request_fingerprint,
    actor_type,
    actor_user_id,
    source_type,
    reason_code,
    created_by,
    metadata
  )
  values (
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_new_version_number,
    v_new_previous_id,
    v_profile_version.id,
    v_policy_version.id,
    v_checklist_state,
    v_settings_snapshot,
    v_settings_fingerprint,
    v_operation_key,
    v_request_fingerprint,
    'system',
    null,
    'opportunity_checklist_materializer',
    'checklist_materialized_from_current_authorities',
    'p9_checklist_materializer_v1',
    pg_catalog.jsonb_build_object(
      'materializer_version', 1,
      'definition_only', true,
      'readiness_progress_separate', true
    )
  )
  returning * into v_new;

  insert into public.commercial_opportunity_checklist_items (
    organization_id,
    store_id,
    commercial_opportunity_id,
    checklist_version_id,
    item_key,
    item_kind,
    applicability_state,
    reason_code,
    decision_basis,
    metadata
  )
  select
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_new.id,
    normalized_item.item_key,
    normalized_item.item_kind,
    normalized_item.applicability_state,
    normalized_item.reason_code,
    normalized_item.decision_basis,
    normalized_item.metadata
  from pg_catalog.jsonb_to_recordset(v_items) as normalized_item(
    item_key text,
    item_kind text,
    applicability_state text,
    reason_code text,
    decision_basis jsonb,
    metadata jsonb
  );

  insert into public.commercial_opportunity_checklist_current (
    organization_id,
    store_id,
    commercial_opportunity_id,
    current_checklist_version_id,
    last_operation_key
  )
  values (
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_new.id,
    v_operation_key
  )
  on conflict (organization_id, store_id, commercial_opportunity_id) do update
  set
    current_checklist_version_id = excluded.current_checklist_version_id,
    last_operation_key = excluded.last_operation_key;

  select current_row.*
  into v_current
  from public.commercial_opportunity_checklist_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id;

  if not found or v_current.current_checklist_version_id is distinct from v_new.id then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_CURRENT_NOT_UPDATED';
  end if;

  return query
  select
    v_new.id,
    v_new.version_number,
    v_new.previous_checklist_version_id,
    v_new.profile_version_id,
    v_new.gate_policy_version_id,
    v_item_count,
    v_new.checklist_state,
    true,
    false,
    false,
    'checklist_version_created'::text,
    v_new.request_fingerprint,
    v_new.settings_fingerprint,
    v_new.actor_type,
    v_new.source_type,
    v_new.created_by,
    v_current.updated_at;
end;
$function$;

alter function public.materialize_commercial_opportunity_checklist_by_system(
  uuid, uuid, uuid, text
) owner to postgres;

comment on function public.materialize_commercial_opportunity_checklist_by_system(
  uuid, uuid, uuid, text
) is
  'Service-role-only P9 checklist-definition materializer. Snapshots explicit current Profile + Gate Policy + consumed Settings, evaluates deterministic applicability fail-closed, preserves human/non-owned checklist authority, and never mixes applicability with readiness/progress.';

revoke all on function public.materialize_commercial_opportunity_checklist_by_system(
  uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;

grant execute on function public.materialize_commercial_opportunity_checklist_by_system(
  uuid, uuid, uuid, text
) to service_role;

-- ============================================================================
-- Postconditions.
-- ============================================================================
do $postconditions$
declare
  v_helper oid := pg_catalog.to_regprocedure(
    'public.p9_opportunity_checklist_merge_candidate_internal(jsonb,integer,text,text,jsonb)'
  );
  v_materializer oid := pg_catalog.to_regprocedure(
    'public.materialize_commercial_opportunity_checklist_by_system(uuid,uuid,uuid,text)'
  );
  v_definition text;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
begin
  if v_helper is null or v_materializer is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: opportunity checklist materializer functions are missing';
  end if;

  if pg_catalog.has_function_privilege('anon', v_helper, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_helper, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_helper, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: checklist reducer helper leaked EXECUTE';
  end if;

  if pg_catalog.has_function_privilege('anon', v_materializer, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_materializer, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_materializer, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: checklist materializer grants mismatch';
  end if;

  select pg_catalog.pg_get_functiondef(v_materializer)
  into v_definition;

  if pg_catalog.strpos(v_definition, 'pg_advisory_xact_lock') = 0
     or pg_catalog.strpos(v_definition, 'for update') = 0
     or pg_catalog.strpos(v_definition, 'preserved_human_authority') = 0
     or pg_catalog.strpos(v_definition, 'preserved_non_materializer_authority') = 0
     or pg_catalog.strpos(v_definition, 'offers_installation') = 0
     or pg_catalog.strpos(v_definition, 'offers_technical_visit') = 0
     or pg_catalog.strpos(v_definition, 'contract_enabled') = 0
     or pg_catalog.strpos(v_definition, 'component_and_execution') = 0
     or pg_catalog.strpos(v_definition, 'equal_priority_applicability_conflict') = 0
     or pg_catalog.strpos(v_definition, 'checklist_unchanged') = 0
     or pg_catalog.strpos(v_definition, 'idempotent_replay_stale') = 0
     or pg_catalog.strpos(v_definition, 'max(version_number)') > 0
     or pg_catalog.strpos(v_definition, 'order by created_at desc') > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: checklist materializer contract is incomplete';
  end if;

  select role_row.rolname, proc_row.prosecdef, proc_row.proconfig
  into v_owner, v_security_definer, v_config
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_roles role_row on role_row.oid = proc_row.proowner
  where proc_row.oid = v_materializer;

  if v_owner is distinct from 'postgres'
     or not coalesce(v_security_definer, false)
     or not ('search_path=pg_catalog, pg_temp, public, auth, extensions' = any(coalesce(v_config, array[]::text[])))
     or not ('row_security=off' = any(coalesce(v_config, array[]::text[]))) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: checklist materializer hardening mismatch';
  end if;

  if pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_checklist_versions', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_checklist_versions', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_checklist_items', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_checklist_items', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_checklist_current', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_checklist_current', 'INSERT') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: direct checklist table INSERT became available';
  end if;
end;
$postconditions$;

commit;
