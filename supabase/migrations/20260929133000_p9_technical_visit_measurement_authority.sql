begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

-- P9 / Bug 2 - technical visit measurement authority
-- Forward-only replacement of checklist materializer v3 with v4.
-- Adds canonical qualification authority for the required situation "medidas".
-- requested_area_m2 and technical_visit_interest remain non-authoritative.

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
  v_technical_visit_policy_row public.store_operation_execution_policies%rowtype;
  v_technical_visit_policy_present boolean := false;
  v_technical_visit_policy_configured boolean := false;
  v_technical_visit_policy jsonb;
  v_technical_visit_required_situations text[] := '{}'::text[];
  v_technical_visit_optional_situations text[] := '{}'::text[];
  v_technical_visit_matched_required_situations text[] := '{}'::text[];
  v_technical_visit_false_required_situations text[] := '{}'::text[];
  v_technical_visit_unresolved_required_situations text[] := '{}'::text[];
  v_technical_visit_conflict_required_situations text[] := '{}'::text[];
  v_technical_visit_situation text;
  v_technical_visit_winning_situation text;
  v_technical_visit_blocking_situation text;
  v_technical_visit_policy_state text := 'needs_resolution';
  v_technical_visit_policy_reason text := 'technical_visit_policy_not_configured';
  v_technical_visit_final_state text := 'needs_resolution';
  v_technical_visit_final_reason text := 'technical_visit_policy_not_configured';
  v_technical_visit_region_state text := 'not_required';
  v_technical_visit_region_reason text := 'technical_visit_region_not_required';
  v_strategy_row public.store_strategy_settings%rowtype;
  v_strategy_present boolean := false;
  v_service_region_configured boolean := false;
  v_service_region_modes_normalized text[] := '{}'::text[];
  v_pool_component_state text;
  v_on_site_measurement_fact_state text := 'missing';
  v_on_site_measurement_fact_value jsonb := null;
  v_on_site_measurement_conflict_values jsonb := null;
  v_on_site_measurement_required boolean := null;
  v_technical_visit_policy_basis jsonb := '{}'::jsonb;
  v_technical_visit_evidence_basis jsonb := '{}'::jsonb;
  v_technical_visit_legacy_basis jsonb := null;
  v_technical_visit_region_basis jsonb := null;
  v_policy_candidate jsonb;
  v_settings_snapshot jsonb;
  v_settings_fingerprint text;

  v_installation_intent_state text;

  v_item_map jsonb := '{}'::jsonb;
  v_item_entry jsonb;
  v_candidate jsonb;
  v_items jsonb := '[]'::jsonb;
  v_merged_items jsonb := '[]'::jsonb;
  v_existing_items jsonb := '[]'::jsonb;
  v_current_items jsonb := '[]'::jsonb;
  v_current_item jsonb;
  v_merged_item jsonb;
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
  v_system_decision_basis jsonb;
  v_system_basis_fingerprint text;
  v_lineage_system_version public.commercial_opportunity_checklist_versions%rowtype;
  v_human_carry_count integer := 0;
  v_human_absorbed_count integer := 0;
  v_human_revalidation_count integer := 0;
  v_human_retired_count integer := 0;

  v_request_payload jsonb;
  v_request_fingerprint text;
  v_recomputed_fingerprint text;
  v_recomputed_settings_fingerprint text;
  v_existing_materializer_version integer;
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

    v_existing_materializer_version := coalesce(
      nullif(v_existing.metadata ->> 'materializer_version', '')::integer,
      1
    );

    v_recomputed_fingerprint := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.jsonb_build_object(
            'materializer_version', v_existing_materializer_version,
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

  -- Carry-forward v2: canonical human overrides are merged item-by-item after
  -- the pure system checklist is recomputed. Legacy human versions that do not
  -- expose the explicit baseline contract remain preserved fail-closed.
  if v_has_current and v_current_version.actor_type = 'human' then
    if not exists (
      select 1
      from public.commercial_opportunity_checklist_items item_row
      where item_row.organization_id = p_organization_id
        and item_row.store_id = p_store_id
        and item_row.commercial_opportunity_id = p_commercial_opportunity_id
        and item_row.checklist_version_id = v_current_version.id
        and pg_catalog.jsonb_typeof(item_row.decision_basis -> 'human_override') = 'object'
    ) or exists (
      select 1
      from public.commercial_opportunity_checklist_items item_row
      where item_row.organization_id = p_organization_id
        and item_row.store_id = p_store_id
        and item_row.commercial_opportunity_id = p_commercial_opportunity_id
        and item_row.checklist_version_id = v_current_version.id
        and pg_catalog.jsonb_typeof(item_row.decision_basis -> 'human_override') = 'object'
        and (
          nullif(item_row.decision_basis -> 'human_override' ->> 'system_baseline_checklist_version_id', '') is null
          or nullif(item_row.decision_basis -> 'human_override' ->> 'system_baseline_applicability_state', '') is null
          or nullif(item_row.decision_basis -> 'human_override' ->> 'system_baseline_basis_fingerprint', '') is null
        )
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
        'preserved_legacy_human_authority'::text,
        v_current_version.request_fingerprint,
        v_current_version.settings_fingerprint,
        v_current_version.actor_type,
        v_current_version.source_type,
        v_current_version.created_by,
        v_current.updated_at;
      return;
    end if;

    with recursive lineage as (
      select
        version_row.id,
        version_row.previous_checklist_version_id,
        version_row.actor_type,
        0 as depth
      from public.commercial_opportunity_checklist_versions version_row
      where version_row.id = v_current_version.id
        and version_row.organization_id = p_organization_id
        and version_row.store_id = p_store_id
        and version_row.commercial_opportunity_id = p_commercial_opportunity_id

      union all

      select
        parent_row.id,
        parent_row.previous_checklist_version_id,
        parent_row.actor_type,
        lineage.depth + 1
      from lineage
      join public.commercial_opportunity_checklist_versions parent_row
        on parent_row.id = lineage.previous_checklist_version_id
       and parent_row.organization_id = p_organization_id
       and parent_row.store_id = p_store_id
       and parent_row.commercial_opportunity_id = p_commercial_opportunity_id
      where lineage.previous_checklist_version_id is not null
        and lineage.depth < 10000
    ), selected_system as (
      select lineage.id
      from lineage
      where lineage.actor_type = 'system'
      order by lineage.depth
      limit 1
    )
    select version_row.*
    into v_lineage_system_version
    from public.commercial_opportunity_checklist_versions version_row
    join selected_system selected_row on selected_row.id = version_row.id;

    if not found
       or v_lineage_system_version.source_type is distinct from 'opportunity_checklist_materializer'
       or v_lineage_system_version.created_by not in (
         'p9_checklist_materializer_v1',
         'p9_checklist_materializer_v2',
         'p9_checklist_materializer_v3',
         'p9_checklist_materializer_v4'
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
  end if;

  -- A system current that is not owned by this materializer remains stronger
  -- authority and is never reinterpreted by carry-forward logic.
  if v_has_current
     and v_current_version.actor_type = 'system'
     and (
       v_current_version.source_type <> 'opportunity_checklist_materializer'
       or v_current_version.created_by not in (
         'p9_checklist_materializer_v1',
         'p9_checklist_materializer_v2',
         'p9_checklist_materializer_v3',
         'p9_checklist_materializer_v4'
       )
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

  select policy_row.*
  into v_technical_visit_policy_row
  from public.store_operation_execution_policies policy_row
  where policy_row.organization_id = p_organization_id
    and policy_row.store_id = p_store_id;

  v_technical_visit_policy_present := found;
  v_technical_visit_policy_configured :=
    v_technical_visit_policy_present
    and v_technical_visit_policy_row.technical_visit_configured_at is not null;
  v_technical_visit_policy := case
    when v_technical_visit_policy_present then v_technical_visit_policy_row.technical_visit_policy
    else null
  end;

  select strategy_row.*
  into v_strategy_row
  from public.store_strategy_settings strategy_row
  where strategy_row.organization_id = p_organization_id
    and strategy_row.store_id = p_store_id;

  v_strategy_present := found;
  v_service_region_configured :=
    v_strategy_present
    and v_strategy_row.service_region_configured_at is not null;

  if v_strategy_present then
    select coalesce(
      pg_catalog.array_agg(region_mode order by region_mode),
      '{}'::text[]
    )
    into v_service_region_modes_normalized
    from pg_catalog.unnest(
      coalesce(v_strategy_row.service_region_modes, '{}'::text[])
    ) as region_mode;
  else
    v_service_region_modes_normalized := '{}'::text[];
  end if;

  v_settings_snapshot := pg_catalog.jsonb_build_object(
    'schema_version', 2,
    'operation', pg_catalog.jsonb_build_object(
      'present', v_operation_present,
      'offers_installation', v_offers_installation
    ),
    'technical_visit_execution_policy', pg_catalog.jsonb_build_object(
      'authority_source', 'store_operation_execution_policies',
      'present', v_technical_visit_policy_present,
      'configured', v_technical_visit_policy_configured,
      'policy', case
        when v_technical_visit_policy is null then null::jsonb
        else pg_catalog.jsonb_build_object(
          'required_situations', coalesce(v_technical_visit_policy -> 'required_situations', '[]'::jsonb),
          'required_other', nullif(pg_catalog.btrim(coalesce(v_technical_visit_policy ->> 'required_other', '')), ''),
          'optional_situations', coalesce(v_technical_visit_policy -> 'optional_situations', '[]'::jsonb),
          'optional_other', nullif(pg_catalog.btrim(coalesce(v_technical_visit_policy ->> 'optional_other', '')), '')
        )
      end,
      'legacy_mirror', pg_catalog.jsonb_build_object(
        'source', 'store_operation_settings',
        'offers_technical_visit', v_offers_technical_visit
      )
    ),
    'contract', pg_catalog.jsonb_build_object(
      'present', v_contract_present,
      'contract_enabled', v_contract_enabled
    ),
    'service_region', pg_catalog.jsonb_build_object(
      'authority_source', 'store_strategy_settings',
      'present', v_strategy_present,
      'configured', v_service_region_configured,
      'city', case when v_strategy_present then nullif(pg_catalog.btrim(coalesce(v_strategy_row.city, '')), '') else null end,
      'state', case when v_strategy_present then nullif(pg_catalog.btrim(coalesce(v_strategy_row.state, '')), '') else null end,
      'service_regions', case when v_strategy_present then nullif(pg_catalog.btrim(coalesce(v_strategy_row.service_regions, '')), '') else null end,
      'service_region_modes', case when v_strategy_present then coalesce(v_strategy_row.service_region_modes, '{}'::text[]) else '{}'::text[] end,
      'service_region_primary_mode', case when v_strategy_present then nullif(pg_catalog.btrim(coalesce(v_strategy_row.service_region_primary_mode, '')), '') else null end,
      'service_region_outside_consultation', case when v_strategy_present then v_strategy_row.service_region_outside_consultation else null end
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

  -- P19-A Settings authority for technical_visit applicability. This item is
  -- derived directly from store_operation_execution_policies and must exist
  -- even when no legacy Gate Policy rule mentions technical_visit. Gate Policy
  -- candidates evaluated above are intentionally overwritten for this item.
  select case
    when exists (
      select 1
      from public.commercial_opportunity_profile_components component_row
      where component_row.organization_id = p_organization_id
        and component_row.store_id = p_store_id
        and component_row.commercial_opportunity_id = p_commercial_opportunity_id
        and component_row.profile_version_id = v_profile_version.id
        and component_row.component_kind = 'pool'
        and component_row.component_state = 'conflict'
    ) then 'conflict'
    when exists (
      select 1
      from public.commercial_opportunity_profile_components component_row
      where component_row.organization_id = p_organization_id
        and component_row.store_id = p_store_id
        and component_row.commercial_opportunity_id = p_commercial_opportunity_id
        and component_row.profile_version_id = v_profile_version.id
        and component_row.component_kind = 'pool'
        and component_row.component_state in ('resolved', 'partial')
    ) then 'positive'
    else 'unknown'
  end into v_pool_component_state;

  v_technical_visit_required_situations := '{}'::text[];
  v_technical_visit_optional_situations := '{}'::text[];

  if v_technical_visit_policy is not null then
    select coalesce(pg_catalog.array_agg(value_text order by value_text), '{}'::text[])
    into v_technical_visit_required_situations
    from (
      select element.value #>> '{}' as value_text
      from pg_catalog.jsonb_array_elements(
        coalesce(v_technical_visit_policy -> 'required_situations', '[]'::jsonb)
      ) as element(value)
    ) situation_row;

    select coalesce(pg_catalog.array_agg(value_text order by value_text), '{}'::text[])
    into v_technical_visit_optional_situations
    from (
      select element.value #>> '{}' as value_text
      from pg_catalog.jsonb_array_elements(
        coalesce(v_technical_visit_policy -> 'optional_situations', '[]'::jsonb)
      ) as element(value)
    ) situation_row;
  end if;

  if 'medidas' = any(v_technical_visit_required_situations) then
    select
      qualification_row.current_state,
      qualification_row.value_json,
      qualification_row.conflict_values_json
    into
      v_on_site_measurement_fact_state,
      v_on_site_measurement_fact_value,
      v_on_site_measurement_conflict_values
    from public.commercial_opportunity_qualification_facts_current qualification_row
    where qualification_row.organization_id = p_organization_id
      and qualification_row.store_id = p_store_id
      and qualification_row.commercial_opportunity_id = p_commercial_opportunity_id
      and qualification_row.fact_key = 'on_site_measurement_required'
    limit 1;

    if not found then
      v_on_site_measurement_fact_state := 'missing';
      v_on_site_measurement_fact_value := null;
      v_on_site_measurement_conflict_values := null;
      v_on_site_measurement_required := null;

    elsif v_on_site_measurement_fact_state = 'confirmed' then
      v_on_site_measurement_required := case
        when v_on_site_measurement_fact_value = 'true'::jsonb then true
        when v_on_site_measurement_fact_value = 'false'::jsonb then false
        else null
      end;

    else
      v_on_site_measurement_required := null;
    end if;

    v_technical_visit_policy_basis := pg_catalog.jsonb_build_object(
      'configured', v_technical_visit_policy_configured,
      'on_site_measurement_authority', pg_catalog.jsonb_build_object(
        'source', 'commercial_opportunity_qualification_facts_current',
        'fact_key', 'on_site_measurement_required',
        'state', v_on_site_measurement_fact_state,
        'value', v_on_site_measurement_required,
        'conflict_values', v_on_site_measurement_conflict_values
      )
    );

  else
    v_technical_visit_policy_basis := pg_catalog.jsonb_build_object(
      'configured', v_technical_visit_policy_configured
    );
  end if;
  v_technical_visit_evidence_basis := '{}'::jsonb;
  v_technical_visit_legacy_basis := null;
  v_technical_visit_region_basis := null;
  v_technical_visit_matched_required_situations := '{}'::text[];
  v_technical_visit_false_required_situations := '{}'::text[];
  v_technical_visit_unresolved_required_situations := '{}'::text[];
  v_technical_visit_conflict_required_situations := '{}'::text[];
  v_technical_visit_winning_situation := null;
  v_technical_visit_blocking_situation := null;

  if not v_technical_visit_policy_configured then
    v_technical_visit_policy_state := 'needs_resolution';
    v_technical_visit_policy_reason := 'technical_visit_policy_not_configured';

  elsif v_technical_visit_policy is null then
    v_technical_visit_policy_basis := v_technical_visit_policy_basis
      || pg_catalog.jsonb_build_object('offered', false);

    if v_offers_technical_visit is true then
      v_technical_visit_policy_state := 'conflict';
      v_technical_visit_policy_reason := 'technical_visit_policy_legacy_mirror_conflict';
      v_technical_visit_legacy_basis := pg_catalog.jsonb_build_object(
        'source', 'store_operation_settings.offers_technical_visit',
        'value', v_offers_technical_visit
      );
    else
      v_technical_visit_policy_state := 'not_applicable';
      v_technical_visit_policy_reason := 'store_does_not_offer_technical_visit';
    end if;

  elsif v_offers_technical_visit is false then
    v_technical_visit_policy_basis := v_technical_visit_policy_basis
      || pg_catalog.jsonb_build_object('offered', true);
    v_technical_visit_policy_state := 'conflict';
    v_technical_visit_policy_reason := 'technical_visit_policy_legacy_mirror_conflict';
    v_technical_visit_legacy_basis := pg_catalog.jsonb_build_object(
      'source', 'store_operation_settings.offers_technical_visit',
      'value', v_offers_technical_visit
    );

  else
    v_technical_visit_policy_basis := v_technical_visit_policy_basis
      || pg_catalog.jsonb_build_object('offered', true);

    foreach v_technical_visit_situation
      in array v_technical_visit_required_situations
    loop
      case v_technical_visit_situation
        when 'toda_venda_piscina' then
          if v_pool_component_state = 'positive' then
            v_technical_visit_matched_required_situations :=
              pg_catalog.array_append(
                v_technical_visit_matched_required_situations,
                v_technical_visit_situation
              );
          elsif v_pool_component_state = 'conflict' then
            v_technical_visit_conflict_required_situations :=
              pg_catalog.array_append(
                v_technical_visit_conflict_required_situations,
                v_technical_visit_situation
              );
          else
            v_technical_visit_unresolved_required_situations :=
              pg_catalog.array_append(
                v_technical_visit_unresolved_required_situations,
                v_technical_visit_situation
              );
          end if;

        when 'piscina_com_instalacao' then
          -- Explicit installation exclusion is a canonical negative for this
          -- conjunction. Absence/null is not equivalent to excluded.
          if v_installation_intent_state = 'excluded' then
            v_technical_visit_false_required_situations :=
              pg_catalog.array_append(
                v_technical_visit_false_required_situations,
                v_technical_visit_situation
              );
          elsif v_pool_component_state = 'positive'
                and v_installation_intent_state = 'included' then
            v_technical_visit_matched_required_situations :=
              pg_catalog.array_append(
                v_technical_visit_matched_required_situations,
                v_technical_visit_situation
              );
          elsif v_pool_component_state = 'conflict'
                or v_installation_intent_state = 'conflict' then
            v_technical_visit_conflict_required_situations :=
              pg_catalog.array_append(
                v_technical_visit_conflict_required_situations,
                v_technical_visit_situation
              );
          else
            v_technical_visit_unresolved_required_situations :=
              pg_catalog.array_append(
                v_technical_visit_unresolved_required_situations,
                v_technical_visit_situation
              );
          end if;

        when 'medidas' then
          if v_on_site_measurement_fact_state = 'confirmed'
             and v_on_site_measurement_required is true then
            v_technical_visit_matched_required_situations :=
              pg_catalog.array_append(
                v_technical_visit_matched_required_situations,
                v_technical_visit_situation
              );

          elsif v_on_site_measurement_fact_state = 'confirmed'
                and v_on_site_measurement_required is false then
            v_technical_visit_false_required_situations :=
              pg_catalog.array_append(
                v_technical_visit_false_required_situations,
                v_technical_visit_situation
              );

          elsif v_on_site_measurement_fact_state = 'conflict' then
            v_technical_visit_conflict_required_situations :=
              pg_catalog.array_append(
                v_technical_visit_conflict_required_situations,
                v_technical_visit_situation
              );

          else
            v_technical_visit_unresolved_required_situations :=
              pg_catalog.array_append(
                v_technical_visit_unresolved_required_situations,
                v_technical_visit_situation
              );
          end if;
        else
          -- No exact canonical predicate exists yet for the remaining required
          -- vocabulary. Preserve the configured situation as the material cause
          -- of fail-closed resolution instead of executing free text/heuristics.
          v_technical_visit_unresolved_required_situations :=
            pg_catalog.array_append(
              v_technical_visit_unresolved_required_situations,
              v_technical_visit_situation
            );
      end case;
    end loop;

    -- Any positively proven required condition is sufficient. Unknown/conflicting
    -- alternative required conditions cannot erase an already proven requirement.
    if coalesce(
      pg_catalog.array_length(v_technical_visit_matched_required_situations, 1),
      0
    ) > 0 then
      v_technical_visit_policy_state := 'required';

      if 'toda_venda_piscina' = any(
        v_technical_visit_matched_required_situations
      ) then
        v_technical_visit_winning_situation := 'toda_venda_piscina';
        v_technical_visit_policy_reason := 'technical_visit_required_for_pool_sale';
        v_technical_visit_evidence_basis := pg_catalog.jsonb_build_object(
          'pool_component_state', v_pool_component_state
        );

      elsif 'piscina_com_instalacao' = any(
        v_technical_visit_matched_required_situations
      ) then
        v_technical_visit_winning_situation := 'piscina_com_instalacao';
        v_technical_visit_policy_reason :=
          'technical_visit_required_for_pool_with_installation';
        v_technical_visit_evidence_basis := pg_catalog.jsonb_build_object(
          'pool_component_state', v_pool_component_state,
          'installation_intent_state', v_installation_intent_state
        );

      elsif 'medidas' = any(
        v_technical_visit_matched_required_situations
      ) then
        v_technical_visit_winning_situation := 'medidas';
        v_technical_visit_policy_reason :=
          'technical_visit_required_for_on_site_measurement';
        v_technical_visit_evidence_basis := pg_catalog.jsonb_build_object(
          'qualification_fact_key', 'on_site_measurement_required',
          'qualification_fact_state', v_on_site_measurement_fact_state,
          'qualification_fact_value', v_on_site_measurement_required
        );

      else
        v_technical_visit_policy_state := 'needs_resolution';
        v_technical_visit_policy_reason :=
          'technical_visit_situation_authority_missing';
      end if;

      v_technical_visit_policy_basis := v_technical_visit_policy_basis
        || pg_catalog.jsonb_build_object(
          'matched_required_situation',
          v_technical_visit_winning_situation
        );

    elsif coalesce(
      pg_catalog.array_length(v_technical_visit_conflict_required_situations, 1),
      0
    ) > 0 then
      v_technical_visit_policy_state := 'conflict';

      if 'toda_venda_piscina' = any(
        v_technical_visit_conflict_required_situations
      ) then
        v_technical_visit_blocking_situation := 'toda_venda_piscina';
        v_technical_visit_policy_reason := 'technical_visit_pool_component_conflict';
        v_technical_visit_evidence_basis := pg_catalog.jsonb_build_object(
          'pool_component_state', v_pool_component_state
        );

      elsif 'piscina_com_instalacao' = any(
        v_technical_visit_conflict_required_situations
      ) then
        v_technical_visit_blocking_situation := 'piscina_com_instalacao';
        v_technical_visit_policy_reason :=
          'technical_visit_pool_installation_conflict';
        v_technical_visit_evidence_basis := pg_catalog.jsonb_build_object(
          'pool_component_state', v_pool_component_state,
          'installation_intent_state', v_installation_intent_state
        );

      elsif 'medidas' = any(
        v_technical_visit_conflict_required_situations
      ) then
        v_technical_visit_blocking_situation := 'medidas';
        v_technical_visit_policy_reason :=
          'technical_visit_measurement_authority_conflict';
        v_technical_visit_evidence_basis := pg_catalog.jsonb_build_object(
          'qualification_fact_key', 'on_site_measurement_required',
          'qualification_fact_state', v_on_site_measurement_fact_state,
          'conflict_values', v_on_site_measurement_conflict_values
        );

      else
        v_technical_visit_policy_reason :=
          'technical_visit_situation_authority_missing';
      end if;

      v_technical_visit_policy_basis := v_technical_visit_policy_basis
        || pg_catalog.jsonb_build_object(
          'conflict_required_situation',
          v_technical_visit_blocking_situation
        );

    elsif coalesce(
      pg_catalog.array_length(v_technical_visit_unresolved_required_situations, 1),
      0
    ) > 0 then
      v_technical_visit_policy_state := 'needs_resolution';
      v_technical_visit_policy_reason := case
        when pg_catalog.array_length(
               v_technical_visit_unresolved_required_situations,
               1
             ) = 1
             and 'medidas' = any(
               v_technical_visit_unresolved_required_situations
             ) then
          'technical_visit_measurement_authority_missing'
        when 'outro' = any(v_technical_visit_unresolved_required_situations) then
          'technical_visit_free_text_situation_requires_human_resolution'
        else
          'technical_visit_situation_authority_missing'
      end;

      v_technical_visit_policy_basis := v_technical_visit_policy_basis
        || pg_catalog.jsonb_build_object(
          'unresolved_required_situations',
          to_jsonb(v_technical_visit_unresolved_required_situations)
        )
        || case
          when 'outro' = any(v_technical_visit_unresolved_required_situations)
            then pg_catalog.jsonb_build_object(
              'required_other',
              nullif(
                pg_catalog.btrim(
                  coalesce(v_technical_visit_policy ->> 'required_other', '')
                ),
                ''
              )
            )
          else '{}'::jsonb
        end;

    elsif coalesce(
      pg_catalog.array_length(v_technical_visit_optional_situations, 1),
      0
    ) > 0 then
      -- No optional situation currently has a safe canonical predicate.
      v_technical_visit_policy_state := 'needs_resolution';
      v_technical_visit_policy_reason := case
        when 'outro' = any(v_technical_visit_optional_situations) then
          'technical_visit_free_text_situation_requires_human_resolution'
        else
          'technical_visit_optional_situation_authority_missing'
      end;

      v_technical_visit_policy_basis := v_technical_visit_policy_basis
        || pg_catalog.jsonb_build_object(
          'unresolved_optional_situations',
          to_jsonb(v_technical_visit_optional_situations)
        )
        || case
          when 'outro' = any(v_technical_visit_optional_situations)
            then pg_catalog.jsonb_build_object(
              'optional_other',
              nullif(
                pg_catalog.btrim(
                  coalesce(v_technical_visit_policy ->> 'optional_other', '')
                ),
                ''
              )
            )
          else '{}'::jsonb
        end;

    elsif coalesce(
      pg_catalog.array_length(v_technical_visit_false_required_situations, 1),
      0
    ) > 0 then
      v_technical_visit_policy_state := 'not_applicable';

      if pg_catalog.array_length(
           v_technical_visit_false_required_situations,
           1
         ) = 1
         and 'medidas' = any(
           v_technical_visit_false_required_situations
         ) then
        v_technical_visit_policy_reason :=
          'technical_visit_measurement_not_required';
        v_technical_visit_evidence_basis := pg_catalog.jsonb_build_object(
          'qualification_fact_key', 'on_site_measurement_required',
          'qualification_fact_state', v_on_site_measurement_fact_state,
          'qualification_fact_value', v_on_site_measurement_required
        );

      else
        v_technical_visit_policy_reason :=
          'technical_visit_required_conditions_explicitly_not_met';
        v_technical_visit_evidence_basis := pg_catalog.jsonb_build_object(
          'installation_intent_state', v_installation_intent_state
        );
      end if;

      v_technical_visit_policy_basis := v_technical_visit_policy_basis
        || pg_catalog.jsonb_build_object(
          'negated_required_situations',
          to_jsonb(v_technical_visit_false_required_situations)
        );

    else
      v_technical_visit_policy_state := 'needs_resolution';
      v_technical_visit_policy_reason :=
        'technical_visit_policy_applicability_not_defined';
      v_technical_visit_policy_basis := v_technical_visit_policy_basis
        || pg_catalog.jsonb_build_object(
          'required_situations', '[]'::jsonb,
          'optional_situations', '[]'::jsonb
        );
    end if;
  end if;

  v_technical_visit_final_state := v_technical_visit_policy_state;
  v_technical_visit_final_reason := v_technical_visit_policy_reason;
  v_technical_visit_region_state := 'not_required';
  v_technical_visit_region_reason := 'technical_visit_region_not_required';

  if v_technical_visit_policy_state in ('required', 'optional') then
    if not v_service_region_configured then
      v_technical_visit_region_state := 'needs_resolution';
      v_technical_visit_region_reason := 'technical_visit_region_not_configured';
      v_technical_visit_region_basis := pg_catalog.jsonb_build_object(
        'authority_source', 'store_strategy_settings',
        'configured', false,
        'state', v_technical_visit_region_state,
        'reason_code', v_technical_visit_region_reason,
        'customer_geography_authority',
        'unavailable_structured_customer_region'
      );

    elsif v_strategy_row.service_region_outside_consultation is true
          or 'sob_consulta' = any(v_service_region_modes_normalized) then
      v_technical_visit_region_state := 'needs_resolution';
      v_technical_visit_region_reason := 'technical_visit_region_under_consultation';
      v_technical_visit_region_basis := pg_catalog.jsonb_build_object(
        'authority_source', 'store_strategy_settings',
        'configured', true,
        'state', v_technical_visit_region_state,
        'reason_code', v_technical_visit_region_reason,
        'city', nullif(pg_catalog.btrim(coalesce(v_strategy_row.city, '')), ''),
        'state_code', nullif(pg_catalog.btrim(coalesce(v_strategy_row.state, '')), ''),
        'service_regions',
          nullif(pg_catalog.btrim(coalesce(v_strategy_row.service_regions, '')), ''),
        'service_region_modes', to_jsonb(v_service_region_modes_normalized),
        'service_region_primary_mode',
          nullif(
            pg_catalog.btrim(
              coalesce(v_strategy_row.service_region_primary_mode, '')
            ),
            ''
          ),
        'outside_consultation',
          v_strategy_row.service_region_outside_consultation,
        'customer_geography_authority',
          'unavailable_structured_customer_region'
      );

    else
      v_technical_visit_region_state := 'needs_resolution';
      v_technical_visit_region_reason := 'technical_visit_region_unverified';
      v_technical_visit_region_basis := pg_catalog.jsonb_build_object(
        'authority_source', 'store_strategy_settings',
        'configured', true,
        'state', v_technical_visit_region_state,
        'reason_code', v_technical_visit_region_reason,
        'city', nullif(pg_catalog.btrim(coalesce(v_strategy_row.city, '')), ''),
        'state_code', nullif(pg_catalog.btrim(coalesce(v_strategy_row.state, '')), ''),
        'service_regions',
          nullif(pg_catalog.btrim(coalesce(v_strategy_row.service_regions, '')), ''),
        'service_region_modes', to_jsonb(v_service_region_modes_normalized),
        'service_region_primary_mode',
          nullif(
            pg_catalog.btrim(
              coalesce(v_strategy_row.service_region_primary_mode, '')
            ),
            ''
          ),
        'outside_consultation',
          v_strategy_row.service_region_outside_consultation,
        'customer_geography_authority',
          'unavailable_structured_customer_region'
      );
    end if;

    if v_technical_visit_region_state <> 'authorized' then
      v_technical_visit_final_state := 'needs_resolution';
      v_technical_visit_final_reason := v_technical_visit_region_reason;
    end if;
  end if;

  v_policy_candidate := pg_catalog.jsonb_build_object(
    'candidate_key', 'p19a:technical_visit_policy',
    'source', 'store_operation_execution_policies',
    'authority_source', 'store_operation_execution_policies.technical_visit_policy',
    'priority', 0,
    'state', v_technical_visit_final_state,
    'reason_code', v_technical_visit_final_reason,
    'policy_assessment_state', v_technical_visit_policy_state,
    'policy_assessment_reason', v_technical_visit_policy_reason,
    'policy_inputs', v_technical_visit_policy_basis,
    'non_authority_inputs', pg_catalog.jsonb_build_object(
      'technical_visit_interest_used', false,
      'requested_area_m2_absence_used', false
    )
  )
  || case
    when v_technical_visit_legacy_basis is null then '{}'::jsonb
    else pg_catalog.jsonb_build_object(
      'legacy_mirror',
      v_technical_visit_legacy_basis
    )
  end
  || case
    when v_technical_visit_evidence_basis = '{}'::jsonb then '{}'::jsonb
    else pg_catalog.jsonb_build_object(
      'evidence',
      v_technical_visit_evidence_basis
    )
  end
  || case
    when v_technical_visit_region_basis is null then '{}'::jsonb
    else pg_catalog.jsonb_build_object(
      'region_assessment',
      v_technical_visit_region_basis
    )
  end;

  v_item_entry := pg_catalog.jsonb_build_object(
    'item_key', 'technical_visit',
    'item_kind', 'commercial_gate',
    'selected_priority', 0,
    'candidates', pg_catalog.jsonb_build_array(v_policy_candidate)
  );

  v_item_map := pg_catalog.jsonb_set(v_item_map, '{technical_visit}', v_item_entry, true);

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

    if v_item_record.item_key = 'technical_visit' then
      v_system_decision_basis := pg_catalog.jsonb_build_object(
        'materializer_version', 4,
        'selected_priority', (v_item_record.entry ->> 'selected_priority')::integer,
        'selected_candidates', v_item_record.entry -> 'candidates'
      );
    else
      v_system_decision_basis := pg_catalog.jsonb_build_object(
        'materializer_version', 4,
        'selected_priority', (v_item_record.entry ->> 'selected_priority')::integer,
        'selected_candidates', v_item_record.entry -> 'candidates',
        'profile_version_id', v_profile_version.id,
        'gate_policy_version_id', v_policy_version.id,
        'settings_fingerprint', v_settings_fingerprint
      );
    end if;

    v_system_basis_fingerprint := public.p9_opportunity_checklist_system_basis_fingerprint_internal(
      v_item_record.item_key,
      v_item_record.entry ->> 'item_kind',
      v_final_state,
      v_final_reason,
      v_system_decision_basis
    );

    v_system_decision_basis := v_system_decision_basis || pg_catalog.jsonb_build_object(
      'system_basis_version', 1,
      'system_applicability_state', v_final_state,
      'system_reason_code', v_final_reason,
      'system_basis_fingerprint', v_system_basis_fingerprint
    );

    v_items := v_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'item_key', v_item_record.item_key,
        'item_kind', v_item_record.entry ->> 'item_kind',
        'applicability_state', v_final_state,
        'reason_code', v_final_reason,
        'decision_basis', v_system_decision_basis,
        'metadata', pg_catalog.jsonb_build_object(
          'materializer_version', 4
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

  -- Merge active human exceptions only after the pure system definition exists.
  -- Identity is exact item_key + item_kind; removed/retyped items are never
  -- resurrected by historical human authority.
  if v_has_current then
    v_merged_items := '[]'::jsonb;

    for v_item_record in
      select item_row.value as system_item
      from pg_catalog.jsonb_array_elements(v_items) item_row(value)
      order by item_row.value ->> 'item_key'
    loop
      v_current_item := null;

      select pg_catalog.jsonb_build_object(
        'item_key', item_row.item_key,
        'item_kind', item_row.item_kind,
        'applicability_state', item_row.applicability_state,
        'reason_code', item_row.reason_code,
        'decision_basis', item_row.decision_basis,
        'metadata', item_row.metadata
      )
      into v_current_item
      from public.commercial_opportunity_checklist_items item_row
      where item_row.organization_id = p_organization_id
        and item_row.store_id = p_store_id
        and item_row.commercial_opportunity_id = p_commercial_opportunity_id
        and item_row.checklist_version_id = v_current_version.id
        and item_row.item_key = v_item_record.system_item ->> 'item_key'
        and item_row.item_kind = v_item_record.system_item ->> 'item_kind';

      if found
         and pg_catalog.jsonb_typeof(v_current_item -> 'decision_basis' -> 'human_override') = 'object' then
        v_merged_item := public.p9_opportunity_checklist_apply_human_override_internal(
          v_item_record.system_item,
          v_current_item
        );
      else
        v_merged_item := v_item_record.system_item;
      end if;

      v_merged_items := v_merged_items || pg_catalog.jsonb_build_array(v_merged_item);
    end loop;

    select pg_catalog.count(*)::integer
    into v_human_carry_count
    from pg_catalog.jsonb_array_elements(v_merged_items) item_row(value)
    where item_row.value ->> '_human_merge_action' = 'carried';

    select pg_catalog.count(*)::integer
    into v_human_absorbed_count
    from pg_catalog.jsonb_array_elements(v_merged_items) item_row(value)
    where item_row.value ->> '_human_merge_action' = 'absorbed';

    select pg_catalog.count(*)::integer
    into v_human_revalidation_count
    from pg_catalog.jsonb_array_elements(v_merged_items) item_row(value)
    where item_row.value ->> '_human_merge_action' = 'revalidation_required';

    select pg_catalog.count(*)::integer
    into v_human_retired_count
    from public.commercial_opportunity_checklist_items current_item
    where current_item.organization_id = p_organization_id
      and current_item.store_id = p_store_id
      and current_item.commercial_opportunity_id = p_commercial_opportunity_id
      and current_item.checklist_version_id = v_current_version.id
      and pg_catalog.jsonb_typeof(current_item.decision_basis -> 'human_override') = 'object'
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_items) system_item(value)
        where system_item.value ->> 'item_key' = current_item.item_key
          and system_item.value ->> 'item_kind' = current_item.item_kind
      );

    select coalesce(
      pg_catalog.jsonb_agg((item_row.value - '_human_merge_action') order by item_row.value ->> 'item_key'),
      '[]'::jsonb
    )
    into v_items
    from pg_catalog.jsonb_array_elements(v_merged_items) item_row(value);
  end if;

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
    'materializer_version', 4,
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
    'p9_checklist_materializer_v4',
    pg_catalog.jsonb_build_object(
      'materializer_version', 4,
      'technical_visit_authority', 'p19a_store_operation_execution_policies',
      'technical_visit_measurement_authority', 'commercial_opportunity_qualification_facts_current.on_site_measurement_required',
      'technical_visit_region_mode', 'fail_closed_without_structured_customer_region',
      'definition_only', true,
      'readiness_progress_separate', true,
      'human_carry_forward_count', v_human_carry_count,
      'human_absorbed_count', v_human_absorbed_count,
      'human_revalidation_count', v_human_revalidation_count,
      'human_retired_count', v_human_retired_count
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
    case
      when (v_human_carry_count + v_human_absorbed_count + v_human_revalidation_count + v_human_retired_count) > 0
        then 'checklist_version_created_with_human_merge'::text
      else 'checklist_version_created'::text
    end,
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
  'Service-role-only P9 checklist-definition materializer v4. Recomputes pure current Profile + Gate Policy + consumed Settings, derives technical_visit applicability from P19-A store_operation_execution_policies with fail-closed region assessment, hashes item-scoped material decision basis, merges canonical human exceptions by carry-forward/absorption/revalidation, preserves non-materializer authority fail-closed, and never mixes applicability with readiness/progress.';

revoke all on function public.materialize_commercial_opportunity_checklist_by_system(
  uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;

grant execute on function public.materialize_commercial_opportunity_checklist_by_system(
  uuid, uuid, uuid, text
) to service_role;

do $measurement_authority_postconditions$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.materialize_commercial_opportunity_checklist_by_system(uuid,uuid,uuid,text)'::pg_catalog.regprocedure
  )
  into v_definition;

  if v_definition not like '%commercial_opportunity_qualification_facts_current%'
     or v_definition not like '%fact_key = ''on_site_measurement_required''%'
     or v_definition not like '%when ''medidas'' then%'
     or v_definition not like '%technical_visit_required_for_on_site_measurement%'
     or v_definition not like '%technical_visit_measurement_not_required%'
     or v_definition not like '%technical_visit_measurement_authority_missing%'
     or v_definition not like '%technical_visit_measurement_authority_conflict%'
     or v_definition not like '%p9_checklist_materializer_v4%' then
    raise exception
      'P9_TECHNICAL_VISIT_MEASUREMENT_AUTHORITY_POSTCONDITION_FAILED';
  end if;
end;
$measurement_authority_postconditions$;
commit;
