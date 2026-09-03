begin;

set local lock_timeout = '5s';
set local statement_timeout = '240s';
set local idle_in_transaction_session_timeout = '240s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:checklist-human-override-carry-forward:v1', 0)
);

-- ============================================================================
-- P9 / Bloco 3 / Etapa 3.5
-- Mature human checklist override carry-forward.
--
-- Frozen contract:
-- - the materializer always recomputes a pure current system definition first;
-- - human override is a contextual exception, never an eternal truth;
-- - carry-forward is item-scoped and requires exact item_key + item_kind;
-- - carry-forward compares a deterministic fingerprint of only the material
--   system basis for that item, not global Profile/Policy/Settings version ids;
-- - irrelevant authority changes therefore do not invalidate a human exception;
-- - system convergence absorbs the exception without deleting append-only audit;
-- - changed/inconclusive basis becomes needs_resolution; changed concrete
--   incompatible authority becomes conflict; humans still cannot create conflict;
-- - removed/retyped items are never resurrected by historical overrides;
-- - base_checklist_version_id remains the direct event parent; a separate
--   system_baseline_checklist_version_id records the true system baseline;
-- - a new human decision after a real system materialization anchors to that
--   current system baseline; consecutive human-only children keep the prior
--   true system baseline;
-- - non-materializer system authority remains preserved fail-closed;
-- - applicability remains separate from readiness/progress;
-- - historical pre-v2 human rows are never mutated/backfilled and remain
--   preserved fail-closed if they lack the explicit baseline contract.
-- ============================================================================

do $preflight$
declare
  v_materializer oid := pg_catalog.to_regprocedure(
    'public.materialize_commercial_opportunity_checklist_by_system(uuid,uuid,uuid,text)'
  );
  v_writer oid := pg_catalog.to_regprocedure(
    'public.override_commercial_opportunity_checklist_item_by_user(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)'
  );
  v_validator oid := pg_catalog.to_regprocedure(
    'public.p9_commercial_opportunity_checklist_validate_override_event()'
  );
  v_definition text;
begin
  if pg_catalog.to_regclass('public.commercial_opportunity_checklist_versions') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_checklist_items') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_checklist_current') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_checklist_override_events') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical checklist foundation is missing';
  end if;

  if v_materializer is null or v_writer is null or v_validator is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: checklist materializer/writer/validator is missing';
  end if;

  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: extensions.digest(bytea,text) is missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.p9_opportunity_checklist_system_basis_fingerprint_internal(text,text,text,text,jsonb)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.p9_opportunity_checklist_apply_human_override_internal(jsonb,jsonb)'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: carry-forward helper collision detected';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute attribute_row
    where attribute_row.attrelid = 'public.commercial_opportunity_checklist_override_events'::regclass
      and attribute_row.attname in (
        'system_baseline_checklist_version_id',
        'system_baseline_applicability_state',
        'system_baseline_basis_fingerprint'
      )
      and not attribute_row.attisdropped
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: carry-forward baseline columns already exist';
  end if;

  select pg_catalog.pg_get_functiondef(v_materializer) into v_definition;
  if pg_catalog.strpos(v_definition, 'preserved_human_authority') = 0
     or pg_catalog.strpos(v_definition, 'p9_checklist_materializer_v1') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: checklist materializer is not the expected v1 authority contract';
  end if;

  select pg_catalog.pg_get_functiondef(v_writer) into v_definition;
  if pg_catalog.strpos(v_definition, 'current_setting(''request.jwt.claim.role'', true)') = 0
     or pg_catalog.strpos(v_definition, 'human_override') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: checklist human override writer is not the expected canonical writer';
  end if;
end;
$preflight$;

-- Explicit system baseline lineage belongs to override audit, not to the direct
-- parent relation. Existing immutable rows are intentionally left NULL.
alter table public.commercial_opportunity_checklist_override_events
  add column system_baseline_checklist_version_id uuid null,
  add column system_baseline_applicability_state text null,
  add column system_baseline_basis_fingerprint text null;

alter table public.commercial_opportunity_checklist_override_events
  add constraint p9_checklist_override_events_system_baseline_shape_chk
  check (
    (
      system_baseline_checklist_version_id is null
      and system_baseline_applicability_state is null
      and system_baseline_basis_fingerprint is null
    )
    or
    (
      system_baseline_checklist_version_id is not null
      and system_baseline_applicability_state is not null
      and system_baseline_basis_fingerprint is not null
    )
  ),
  add constraint p9_checklist_override_events_system_baseline_state_chk
  check (
    system_baseline_applicability_state is null
    or system_baseline_applicability_state in (
      'required', 'optional', 'not_applicable', 'needs_resolution', 'conflict'
    )
  ),
  add constraint p9_checklist_override_events_system_baseline_fingerprint_chk
  check (
    system_baseline_basis_fingerprint is null
    or (
      pg_catalog.length(system_baseline_basis_fingerprint) = 64
      and system_baseline_basis_fingerprint ~ '^[0-9a-f]{64}$'
    )
  ),
  add constraint p9_checklist_override_events_system_baseline_scope_fk
  foreign key (
    system_baseline_checklist_version_id,
    organization_id,
    store_id,
    commercial_opportunity_id
  )
  references public.commercial_opportunity_checklist_versions(
    id,
    organization_id,
    store_id,
    commercial_opportunity_id
  )
  on delete restrict;

create index p9_checklist_override_events_system_baseline_idx
  on public.commercial_opportunity_checklist_override_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    system_baseline_checklist_version_id
  )
  where system_baseline_checklist_version_id is not null;

comment on column public.commercial_opportunity_checklist_override_events.system_baseline_checklist_version_id is
  'True system checklist baseline for this item-level human decision. Distinct from base_checklist_version_id, which remains the direct event parent. NULL only for immutable pre-carry-forward historical rows.';
comment on column public.commercial_opportunity_checklist_override_events.system_baseline_applicability_state is
  'Pure system applicability at the true baseline used by the human decision. NULL only for immutable pre-carry-forward historical rows.';
comment on column public.commercial_opportunity_checklist_override_events.system_baseline_basis_fingerprint is
  'SHA-256 of the item-scoped material system basis used by the human decision. NULL only for immutable pre-carry-forward historical rows.';

-- Canonical per-item system-basis fingerprint. It intentionally ignores
-- global Profile/Policy/Settings version identifiers and hashes only the
-- selected decision inputs that materially determine this item's applicability.
create or replace function public.p9_opportunity_checklist_system_basis_fingerprint_internal(
  p_item_key text,
  p_item_kind text,
  p_system_applicability_state text,
  p_system_reason_code text,
  p_decision_basis jsonb
)
returns text
language plpgsql
immutable
set search_path = pg_catalog, pg_temp, extensions
as $function$
declare
  v_candidates jsonb := '[]'::jsonb;
  v_basis_payload jsonb;
  v_sanitized_basis jsonb;
begin
  if p_item_key is null
     or p_item_kind not in ('commercial_gate', 'technical_requirement')
     or p_system_applicability_state not in ('required', 'optional', 'not_applicable', 'needs_resolution', 'conflict')
     or p_system_reason_code is null
     or pg_catalog.jsonb_typeof(coalesce(p_decision_basis, '{}'::jsonb)) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_SYSTEM_BASIS_INPUT_INVALID';
  end if;

  if pg_catalog.jsonb_typeof(p_decision_basis -> 'selected_candidates') = 'array' then
    select coalesce(
      pg_catalog.jsonb_agg(candidate_row.value order by candidate_row.value ->> 'candidate_key', candidate_row.value::text),
      '[]'::jsonb
    )
    into v_candidates
    from pg_catalog.jsonb_array_elements(p_decision_basis -> 'selected_candidates') candidate_row(value);

    v_basis_payload := pg_catalog.jsonb_build_object(
      'basis_version', 1,
      'basis_mode', 'selected_candidates',
      'item_key', p_item_key,
      'item_kind', p_item_kind,
      'system_applicability_state', p_system_applicability_state,
      'system_reason_code', p_system_reason_code,
      'selected_priority', p_decision_basis -> 'selected_priority',
      'selected_candidates', v_candidates
    );
  else
    -- Opaque fallback exists only for non-materializer system authorities. Such
    -- baselines are preserved, never auto-merged by the materializer.
    v_sanitized_basis := p_decision_basis
      - 'human_override'
      - 'human_carry_forward'
      - 'human_revalidation'
      - 'human_override_resolution';

    v_basis_payload := pg_catalog.jsonb_build_object(
      'basis_version', 1,
      'basis_mode', 'opaque_system_item',
      'item_key', p_item_key,
      'item_kind', p_item_kind,
      'system_applicability_state', p_system_applicability_state,
      'system_reason_code', p_system_reason_code,
      'decision_basis', v_sanitized_basis
    );
  end if;

  return pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_basis_payload::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
end;
$function$;

alter function public.p9_opportunity_checklist_system_basis_fingerprint_internal(
  text, text, text, text, jsonb
) owner to postgres;

revoke all on function public.p9_opportunity_checklist_system_basis_fingerprint_internal(
  text, text, text, text, jsonb
) from public, anon, authenticated, service_role;

-- Pure merge reducer for one newly evaluated system item and its current item.
-- The temporary _human_merge_action marker is stripped by the materializer
-- before persistence/fingerprinting.
create or replace function public.p9_opportunity_checklist_apply_human_override_internal(
  p_system_item jsonb,
  p_current_item jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_result jsonb := p_system_item;
  v_system_basis jsonb;
  v_current_basis jsonb;
  v_override jsonb;
  v_status text;
  v_system_state text;
  v_system_reason text;
  v_system_fingerprint text;
  v_human_state text;
  v_human_reason text;
  v_baseline_fingerprint text;
  v_final_state text;
  v_final_reason text;
begin
  if pg_catalog.jsonb_typeof(p_system_item) is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_current_item) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_HUMAN_MERGE_INPUT_INVALID';
  end if;

  if p_system_item ->> 'item_key' is distinct from p_current_item ->> 'item_key'
     or p_system_item ->> 'item_kind' is distinct from p_current_item ->> 'item_kind' then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_HUMAN_MERGE_IDENTITY_MISMATCH';
  end if;

  v_system_basis := p_system_item -> 'decision_basis';
  v_current_basis := p_current_item -> 'decision_basis';
  v_override := v_current_basis -> 'human_override';

  if pg_catalog.jsonb_typeof(v_override) is distinct from 'object' then
    return p_system_item;
  end if;

  v_status := coalesce(nullif(v_override ->> 'status', ''), 'active');
  v_system_state := p_system_item ->> 'applicability_state';
  v_system_reason := p_system_item ->> 'reason_code';
  v_system_fingerprint := v_system_basis ->> 'system_basis_fingerprint';
  v_human_state := v_override ->> 'to_applicability_state';
  v_human_reason := v_override ->> 'reason_code';
  v_baseline_fingerprint := v_override ->> 'system_baseline_basis_fingerprint';

  if v_status not in ('active', 'revalidation_required')
     or v_human_state not in ('required', 'optional', 'not_applicable', 'needs_resolution')
     or v_human_reason is null
     or v_system_fingerprint is null
     or pg_catalog.length(v_system_fingerprint) <> 64
     or v_system_fingerprint !~ '^[0-9a-f]{64}$'
     or v_baseline_fingerprint is null
     or pg_catalog.length(v_baseline_fingerprint) <> 64
     or v_baseline_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_HUMAN_OVERRIDE_BASELINE_INVALID';
  end if;

  -- System convergence absorbs the exception. Historical override events stay
  -- append-only; the effective item returns to pure system authority.
  if v_system_state = v_human_state then
    return p_system_item || pg_catalog.jsonb_build_object(
      '_human_merge_action', 'absorbed'
    );
  end if;

  -- Same material basis: carry the human exception forward unchanged.
  if v_status = 'active' and v_system_fingerprint = v_baseline_fingerprint then
    v_result := v_result || pg_catalog.jsonb_build_object(
      'applicability_state', v_human_state,
      'reason_code', v_human_reason,
      'decision_basis', v_system_basis || pg_catalog.jsonb_build_object(
        'human_override', v_override || pg_catalog.jsonb_build_object(
          'status', 'active',
          'last_evaluated_system_basis_fingerprint', v_system_fingerprint
        )
      ),
      '_human_merge_action', 'carried'
    );
    return v_result;
  end if;

  -- Once a basis changed, the old exception no longer dominates. Concrete
  -- opposing authority becomes conflict; inconclusive authority stays
  -- needs_resolution. A prior human needs_resolution is also not promoted to a
  -- fabricated concrete conflict.
  if v_system_state = 'conflict' then
    v_final_state := 'conflict';
    v_final_reason := 'human_override_basis_changed_conflict';
  elsif v_system_state = 'needs_resolution' or v_human_state = 'needs_resolution' then
    v_final_state := 'needs_resolution';
    v_final_reason := 'human_override_revalidation_required';
  else
    v_final_state := 'conflict';
    v_final_reason := 'human_override_basis_changed_conflict';
  end if;

  v_result := v_result || pg_catalog.jsonb_build_object(
    'applicability_state', v_final_state,
    'reason_code', v_final_reason,
    'decision_basis', v_system_basis || pg_catalog.jsonb_build_object(
      'human_override', v_override || pg_catalog.jsonb_build_object(
        'status', 'revalidation_required',
        'invalidated_by_system_basis_fingerprint', v_system_fingerprint,
        'revalidation_system_applicability_state', v_system_state,
        'revalidation_system_reason_code', v_system_reason
      )
    ),
    '_human_merge_action', 'revalidation_required'
  );

  return v_result;
end;
$function$;

alter function public.p9_opportunity_checklist_apply_human_override_internal(
  jsonb, jsonb
) owner to postgres;

revoke all on function public.p9_opportunity_checklist_apply_human_override_internal(
  jsonb, jsonb
) from public, anon, authenticated, service_role;


-- Strengthen the existing append-only event validator with explicit system
-- baseline integrity. The existing BEFORE INSERT trigger keeps this function.
create or replace function public.p9_commercial_opportunity_checklist_validate_override_event()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp, public, extensions
as $function$
declare
  v_result_version public.commercial_opportunity_checklist_versions;
  v_base_item public.commercial_opportunity_checklist_items;
  v_result_item public.commercial_opportunity_checklist_items;
  v_system_baseline_version public.commercial_opportunity_checklist_versions;
  v_system_baseline_item public.commercial_opportunity_checklist_items;
  v_system_baseline_state text;
  v_system_baseline_reason text;
  v_system_baseline_fingerprint text;
  v_result_override jsonb;
begin
  select version_row.*
  into v_result_version
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.id = new.result_checklist_version_id
    and version_row.organization_id = new.organization_id
    and version_row.store_id = new.store_id
    and version_row.commercial_opportunity_id = new.commercial_opportunity_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'checklist override result version is outside event scope';
  end if;

  if v_result_version.previous_checklist_version_id is distinct from new.base_checklist_version_id then
    raise exception using
      errcode = 'P0001',
      message = 'checklist override result version must be the direct child of base version';
  end if;

  if v_result_version.actor_type is distinct from 'human'
     or v_result_version.actor_user_id is distinct from new.actor_user_id then
    raise exception using
      errcode = 'P0001',
      message = 'checklist override result version must be attributed to the same human actor';
  end if;

  if v_result_version.operation_key is distinct from new.operation_key then
    raise exception using
      errcode = 'P0001',
      message = 'checklist override operation_key must match result version';
  end if;

  select item_row.*
  into v_base_item
  from public.commercial_opportunity_checklist_items item_row
  where item_row.checklist_version_id = new.base_checklist_version_id
    and item_row.organization_id = new.organization_id
    and item_row.store_id = new.store_id
    and item_row.commercial_opportunity_id = new.commercial_opportunity_id
    and item_row.item_key = new.item_key
    and item_row.item_kind = new.item_kind;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'checklist override base item does not exist';
  end if;

  if v_base_item.applicability_state is distinct from new.from_applicability_state then
    raise exception using
      errcode = 'P0001',
      message = 'checklist override from state does not match base item';
  end if;

  select item_row.*
  into v_result_item
  from public.commercial_opportunity_checklist_items item_row
  where item_row.checklist_version_id = new.result_checklist_version_id
    and item_row.organization_id = new.organization_id
    and item_row.store_id = new.store_id
    and item_row.commercial_opportunity_id = new.commercial_opportunity_id
    and item_row.item_key = new.item_key
    and item_row.item_kind = new.item_kind;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'checklist override result item does not exist';
  end if;

  if v_result_item.applicability_state is distinct from new.to_applicability_state then
    raise exception using
      errcode = 'P0001',
      message = 'checklist override to state does not match result item';
  end if;

  -- Carry-forward v2 requires an explicit true system baseline for every new
  -- canonical override event. Pre-v2 historical rows remain nullable because
  -- immutable audit rows are never backfilled/mutated.
  if new.system_baseline_checklist_version_id is null
     or new.system_baseline_applicability_state is null
     or new.system_baseline_basis_fingerprint is null then
    raise exception using
      errcode = 'P0001',
      message = 'checklist override system baseline is required';
  end if;

  select version_row.*
  into v_system_baseline_version
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.id = new.system_baseline_checklist_version_id
    and version_row.organization_id = new.organization_id
    and version_row.store_id = new.store_id
    and version_row.commercial_opportunity_id = new.commercial_opportunity_id;

  if not found or v_system_baseline_version.actor_type is distinct from 'system' then
    raise exception using
      errcode = 'P0001',
      message = 'checklist override system baseline version is invalid';
  end if;

  select item_row.*
  into v_system_baseline_item
  from public.commercial_opportunity_checklist_items item_row
  where item_row.checklist_version_id = new.system_baseline_checklist_version_id
    and item_row.organization_id = new.organization_id
    and item_row.store_id = new.store_id
    and item_row.commercial_opportunity_id = new.commercial_opportunity_id
    and item_row.item_key = new.item_key
    and item_row.item_kind = new.item_kind;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'checklist override system baseline item does not exist';
  end if;

  v_system_baseline_state := coalesce(
    nullif(v_system_baseline_item.decision_basis ->> 'system_applicability_state', ''),
    v_system_baseline_item.applicability_state
  );

  v_system_baseline_reason := coalesce(
    nullif(v_system_baseline_item.decision_basis ->> 'system_reason_code', ''),
    v_system_baseline_item.reason_code
  );

  v_system_baseline_fingerprint := public.p9_opportunity_checklist_system_basis_fingerprint_internal(
    v_system_baseline_item.item_key,
    v_system_baseline_item.item_kind,
    v_system_baseline_state,
    v_system_baseline_reason,
    v_system_baseline_item.decision_basis
  );

  if new.system_baseline_applicability_state is distinct from v_system_baseline_state
     or new.system_baseline_basis_fingerprint is distinct from v_system_baseline_fingerprint then
    raise exception using
      errcode = 'P0001',
      message = 'checklist override system baseline payload mismatch';
  end if;

  v_result_override := v_result_item.decision_basis -> 'human_override';

  if pg_catalog.jsonb_typeof(v_result_override) is distinct from 'object'
     or v_result_override ->> 'status' is distinct from 'active'
     or v_result_override ->> 'system_baseline_checklist_version_id'
          is distinct from new.system_baseline_checklist_version_id::text
     or v_result_override ->> 'system_baseline_applicability_state'
          is distinct from new.system_baseline_applicability_state
     or v_result_override ->> 'system_baseline_basis_fingerprint'
          is distinct from new.system_baseline_basis_fingerprint
     or v_result_override ->> 'to_applicability_state'
          is distinct from new.to_applicability_state then
    raise exception using
      errcode = 'P0001',
      message = 'checklist override result item baseline audit mismatch';
  end if;

  return new;
end;
$function$;

alter function public.p9_commercial_opportunity_checklist_validate_override_event()
  owner to postgres;

revoke all on function public.p9_commercial_opportunity_checklist_validate_override_event()
  from public, anon, authenticated, service_role;


-- Replace the materializer in place. Signature and service-role boundary stay
-- stable so event-key idempotency and future callers do not need a parallel RPC.
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
       or v_lineage_system_version.created_by not in ('p9_checklist_materializer_v1', 'p9_checklist_materializer_v2') then
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
       or v_current_version.created_by not in ('p9_checklist_materializer_v1', 'p9_checklist_materializer_v2')
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

    v_system_decision_basis := pg_catalog.jsonb_build_object(
      'materializer_version', 2,
      'selected_priority', (v_item_record.entry ->> 'selected_priority')::integer,
      'selected_candidates', v_item_record.entry -> 'candidates',
      'profile_version_id', v_profile_version.id,
      'gate_policy_version_id', v_policy_version.id,
      'settings_fingerprint', v_settings_fingerprint
    );

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
          'materializer_version', 2
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
    'materializer_version', 2,
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
    'p9_checklist_materializer_v2',
    pg_catalog.jsonb_build_object(
      'materializer_version', 2,
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
  'Service-role-only P9 checklist-definition materializer v2. Recomputes pure current Profile + Gate Policy + consumed Settings, hashes item-scoped material decision basis, merges canonical human exceptions by carry-forward/absorption/revalidation, preserves non-materializer authority fail-closed, and never mixes applicability with readiness/progress.';

revoke all on function public.materialize_commercial_opportunity_checklist_by_system(
  uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;

grant execute on function public.materialize_commercial_opportunity_checklist_by_system(
  uuid, uuid, uuid, text
) to service_role;

-- Replace the human writer in place so every new event gets the true system
-- baseline and item-scoped basis fingerprint.
create or replace function public.override_commercial_opportunity_checklist_item_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_expected_current_checklist_version_id uuid,
  p_operation_key text,
  p_request_fingerprint text,
  p_item_key text,
  p_item_kind text,
  p_to_applicability_state text,
  p_reason_code text,
  p_reason_text text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  result_checklist_version_id uuid,
  version_number integer,
  base_checklist_version_id uuid,
  current_checklist_version_id uuid,
  item_key text,
  item_kind text,
  from_applicability_state text,
  to_applicability_state text,
  checklist_state text,
  changed boolean,
  replayed boolean,
  outcome text,
  request_fingerprint text,
  actor_user_id uuid,
  created_at timestamptz,
  current_updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public, auth, extensions
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  v_operation_key text := nullif(pg_catalog.btrim(coalesce(p_operation_key, '')), '');
  v_request_fingerprint text := pg_catalog.lower(
    nullif(pg_catalog.btrim(coalesce(p_request_fingerprint, '')), '')
  );
  v_item_key text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_item_key, '')), ''));
  v_item_kind text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_item_kind, '')), ''));
  v_to_state text := pg_catalog.lower(
    nullif(pg_catalog.btrim(coalesce(p_to_applicability_state, '')), '')
  );
  v_reason_code text := pg_catalog.lower(
    nullif(pg_catalog.btrim(coalesce(p_reason_code, '')), '')
  );
  v_reason_text text := nullif(pg_catalog.btrim(coalesce(p_reason_text, '')), '');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_version_metadata jsonb;

  v_current public.commercial_opportunity_checklist_current%rowtype;
  v_base public.commercial_opportunity_checklist_versions%rowtype;
  v_base_item public.commercial_opportunity_checklist_items%rowtype;
  v_existing_event public.commercial_opportunity_checklist_override_events%rowtype;
  v_existing_result public.commercial_opportunity_checklist_versions%rowtype;
  v_existing_version public.commercial_opportunity_checklist_versions%rowtype;
  v_new public.commercial_opportunity_checklist_versions%rowtype;
  v_event public.commercial_opportunity_checklist_override_events%rowtype;
  v_system_baseline_version public.commercial_opportunity_checklist_versions%rowtype;
  v_system_baseline_item public.commercial_opportunity_checklist_items%rowtype;

  v_item_count integer := 0;
  v_base_derived_state text;
  v_result_state text;
  v_recomputed_settings_fingerprint text;
  v_updated_rows integer := 0;
  v_existing_human_override jsonb;
  v_system_baseline_checklist_version_id uuid;
  v_system_baseline_state text;
  v_system_baseline_reason text;
  v_system_baseline_fingerprint text;
begin
  if v_user_id is null or v_request_role is distinct from 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'ZION_CHECKLIST_OVERRIDE_NOT_AUTHORIZED';
  end if;

  if p_request_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_expected_current_checklist_version_id is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_OVERRIDE_SCOPE_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
      and membership_row.is_active is true
  ) then
    raise exception using
      errcode = '42501',
      message = 'ZION_CHECKLIST_OVERRIDE_NOT_AUTHORIZED';
  end if;

  if v_operation_key is null or pg_catalog.length(v_operation_key) > 200 then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_OVERRIDE_OPERATION_KEY_INVALID';
  end if;

  if v_request_fingerprint is null
     or pg_catalog.length(v_request_fingerprint) <> 64
     or v_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_OVERRIDE_REQUEST_FINGERPRINT_INVALID';
  end if;

  if v_item_key is null
     or pg_catalog.length(v_item_key) > 160
     or v_item_key !~ '^[a-z0-9_:.\/-]+$' then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_OVERRIDE_ITEM_KEY_INVALID';
  end if;

  if v_item_kind not in ('commercial_gate', 'technical_requirement') then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_OVERRIDE_ITEM_KIND_INVALID';
  end if;

  -- Frozen business rule: a human may resolve conflict, but may never create it.
  if v_to_state not in ('required', 'optional', 'not_applicable', 'needs_resolution') then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_OVERRIDE_TARGET_STATE_INVALID';
  end if;

  if v_reason_code is null
     or pg_catalog.length(v_reason_code) not between 3 and 120
     or v_reason_code !~ '^[a-z0-9_:.\/-]+$' then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_OVERRIDE_REASON_CODE_INVALID';
  end if;

  if v_reason_text is null or pg_catalog.length(v_reason_text) not between 3 and 1000 then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_OVERRIDE_REASON_TEXT_INVALID';
  end if;

  if pg_catalog.jsonb_typeof(v_metadata) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_OVERRIDE_METADATA_INVALID';
  end if;

  -- Exact opportunity-scoped lock shared by Profile and Checklist materializers.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_request_organization_id::text || ':' || p_store_id::text || ':' || p_commercial_opportunity_id::text,
      0
    )
  );

  perform 1
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_request_organization_id
    and opportunity_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'ZION_CHECKLIST_OVERRIDE_OPPORTUNITY_SCOPE_INVALID';
  end if;

  select current_row.*
  into v_current
  from public.commercial_opportunity_checklist_current current_row
  where current_row.organization_id = p_request_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'ZION_CHECKLIST_OVERRIDE_CURRENT_REQUIRED';
  end if;

  -- Replay MUST be resolved before stale-current validation so a legitimate
  -- retry of the already-applied request remains idempotent.
  select event_row.*
  into v_existing_event
  from public.commercial_opportunity_checklist_override_events event_row
  where event_row.organization_id = p_request_organization_id
    and event_row.store_id = p_store_id
    and event_row.commercial_opportunity_id = p_commercial_opportunity_id
    and event_row.operation_key = v_operation_key;

  if found then
    if v_existing_event.request_fingerprint is distinct from v_request_fingerprint
       or v_existing_event.actor_user_id is distinct from v_user_id
       or v_existing_event.base_checklist_version_id is distinct from p_expected_current_checklist_version_id
       or v_existing_event.item_key is distinct from v_item_key
       or v_existing_event.item_kind is distinct from v_item_kind
       or v_existing_event.to_applicability_state is distinct from v_to_state
       or v_existing_event.reason_code is distinct from v_reason_code
       or v_existing_event.reason_text is distinct from v_reason_text
       or v_existing_event.metadata is distinct from v_metadata then
      raise exception using
        errcode = '23505',
        message = 'ZION_CHECKLIST_OVERRIDE_IDEMPOTENCY_KEY_REUSED';
    end if;

    select version_row.*
    into v_existing_result
    from public.commercial_opportunity_checklist_versions version_row
    where version_row.id = v_existing_event.result_checklist_version_id
      and version_row.organization_id = p_request_organization_id
      and version_row.store_id = p_store_id
      and version_row.commercial_opportunity_id = p_commercial_opportunity_id;

    if not found
       or v_existing_result.previous_checklist_version_id is distinct from v_existing_event.base_checklist_version_id
       or v_existing_result.actor_type is distinct from 'human'
       or v_existing_result.actor_user_id is distinct from v_user_id
       or v_existing_result.operation_key is distinct from v_operation_key
       or v_existing_result.request_fingerprint is distinct from v_request_fingerprint then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_CHECKLIST_OVERRIDE_STORED_REPLAY_INVALID';
    end if;

    return query
    select
      v_existing_result.id,
      v_existing_result.version_number,
      v_existing_event.base_checklist_version_id,
      v_current.current_checklist_version_id,
      v_existing_event.item_key,
      v_existing_event.item_kind,
      v_existing_event.from_applicability_state,
      v_existing_event.to_applicability_state,
      v_existing_result.checklist_state,
      false,
      true,
      case
        when v_current.current_checklist_version_id = v_existing_result.id
          then 'idempotent_replay_current'
        else 'idempotent_replay_stale'
      end,
      v_existing_event.request_fingerprint,
      v_existing_event.actor_user_id,
      v_existing_event.created_at,
      v_current.updated_at;
    return;
  end if;

  -- Avoid colliding with a materializer/non-override version that happens to
  -- have the same opportunity-scoped operation_key.
  select version_row.*
  into v_existing_version
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.organization_id = p_request_organization_id
    and version_row.store_id = p_store_id
    and version_row.commercial_opportunity_id = p_commercial_opportunity_id
    and version_row.operation_key = v_operation_key;

  if found then
    raise exception using
      errcode = '23505',
      message = 'ZION_CHECKLIST_OVERRIDE_OPERATION_KEY_CONFLICT';
  end if;

  if v_current.current_checklist_version_id is distinct from p_expected_current_checklist_version_id then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_OVERRIDE_STALE_CURRENT';
  end if;

  select version_row.*
  into v_base
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.id = p_expected_current_checklist_version_id
    and version_row.organization_id = p_request_organization_id
    and version_row.store_id = p_store_id
    and version_row.commercial_opportunity_id = p_commercial_opportunity_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'ZION_CHECKLIST_OVERRIDE_BASE_VERSION_INVALID';
  end if;

  v_recomputed_settings_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_base.settings_snapshot::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  if v_base.settings_fingerprint is distinct from v_recomputed_settings_fingerprint then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_OVERRIDE_BASE_SETTINGS_FINGERPRINT_MISMATCH';
  end if;

  select pg_catalog.count(*)::integer
  into v_item_count
  from public.commercial_opportunity_checklist_items item_row
  where item_row.organization_id = p_request_organization_id
    and item_row.store_id = p_store_id
    and item_row.commercial_opportunity_id = p_commercial_opportunity_id
    and item_row.checklist_version_id = v_base.id;

  if v_item_count <= 0 then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_OVERRIDE_BASE_ITEMS_MISSING';
  end if;

  select item_row.*
  into v_base_item
  from public.commercial_opportunity_checklist_items item_row
  where item_row.organization_id = p_request_organization_id
    and item_row.store_id = p_store_id
    and item_row.commercial_opportunity_id = p_commercial_opportunity_id
    and item_row.checklist_version_id = v_base.id
    and item_row.item_key = v_item_key
    and item_row.item_kind = v_item_kind;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'ZION_CHECKLIST_OVERRIDE_ITEM_NOT_FOUND';
  end if;

  if v_base_item.applicability_state = v_to_state then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_OVERRIDE_STATE_CHANGE_REQUIRED';
  end if;

  -- Resolve the true system baseline for this item. A fresh human decision on
  -- an owned system materialization is anchored to that current system version.
  -- Consecutive human-only children keep the existing item baseline instead of
  -- incorrectly treating a prior human state as system authority.
  v_existing_human_override := v_base_item.decision_basis -> 'human_override';

  if v_base.actor_type = 'system' then
    v_system_baseline_checklist_version_id := v_base.id;
  elsif pg_catalog.jsonb_typeof(v_existing_human_override) = 'object'
        and nullif(v_existing_human_override ->> 'system_baseline_checklist_version_id', '') is not null then
    begin
      v_system_baseline_checklist_version_id :=
        (v_existing_human_override ->> 'system_baseline_checklist_version_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = 'P0001',
          message = 'ZION_CHECKLIST_OVERRIDE_EXISTING_BASELINE_INVALID';
    end;
  else
    with recursive lineage as (
      select version_row.*, 0 as depth
      from public.commercial_opportunity_checklist_versions version_row
      where version_row.id = v_base.id
        and version_row.organization_id = p_request_organization_id
        and version_row.store_id = p_store_id
        and version_row.commercial_opportunity_id = p_commercial_opportunity_id

      union all

      select parent_row.*, lineage.depth + 1
      from lineage
      join public.commercial_opportunity_checklist_versions parent_row
        on parent_row.id = lineage.previous_checklist_version_id
       and parent_row.organization_id = p_request_organization_id
       and parent_row.store_id = p_store_id
       and parent_row.commercial_opportunity_id = p_commercial_opportunity_id
      where lineage.previous_checklist_version_id is not null
        and lineage.depth < 10000
    )
    select lineage.id
    into v_system_baseline_checklist_version_id
    from lineage
    where lineage.actor_type = 'system'
    order by lineage.depth
    limit 1;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_CHECKLIST_OVERRIDE_SYSTEM_BASELINE_REQUIRED';
    end if;
  end if;

  select version_row.*
  into v_system_baseline_version
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.id = v_system_baseline_checklist_version_id
    and version_row.organization_id = p_request_organization_id
    and version_row.store_id = p_store_id
    and version_row.commercial_opportunity_id = p_commercial_opportunity_id;

  if not found or v_system_baseline_version.actor_type is distinct from 'system' then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_OVERRIDE_SYSTEM_BASELINE_INVALID';
  end if;

  select item_row.*
  into v_system_baseline_item
  from public.commercial_opportunity_checklist_items item_row
  where item_row.organization_id = p_request_organization_id
    and item_row.store_id = p_store_id
    and item_row.commercial_opportunity_id = p_commercial_opportunity_id
    and item_row.checklist_version_id = v_system_baseline_version.id
    and item_row.item_key = v_item_key
    and item_row.item_kind = v_item_kind;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_OVERRIDE_SYSTEM_BASELINE_ITEM_MISSING';
  end if;

  v_system_baseline_state := coalesce(
    nullif(v_system_baseline_item.decision_basis ->> 'system_applicability_state', ''),
    v_system_baseline_item.applicability_state
  );

  v_system_baseline_reason := coalesce(
    nullif(v_system_baseline_item.decision_basis ->> 'system_reason_code', ''),
    v_system_baseline_item.reason_code
  );

  v_system_baseline_fingerprint :=
    public.p9_opportunity_checklist_system_basis_fingerprint_internal(
      v_system_baseline_item.item_key,
      v_system_baseline_item.item_kind,
      v_system_baseline_state,
      v_system_baseline_reason,
      v_system_baseline_item.decision_basis
    );

  if pg_catalog.jsonb_typeof(v_existing_human_override) = 'object'
     and v_base.actor_type = 'human' then
    if nullif(v_existing_human_override ->> 'system_baseline_applicability_state', '')
         is distinct from v_system_baseline_state
       or nullif(v_existing_human_override ->> 'system_baseline_basis_fingerprint', '')
         is distinct from v_system_baseline_fingerprint then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_CHECKLIST_OVERRIDE_EXISTING_BASELINE_MISMATCH';
    end if;
  end if;

  select case
    when exists (
      select 1
      from public.commercial_opportunity_checklist_items item_row
      where item_row.organization_id = p_request_organization_id
        and item_row.store_id = p_store_id
        and item_row.commercial_opportunity_id = p_commercial_opportunity_id
        and item_row.checklist_version_id = v_base.id
        and item_row.applicability_state = 'conflict'
    ) then 'conflict'
    when exists (
      select 1
      from public.commercial_opportunity_checklist_items item_row
      where item_row.organization_id = p_request_organization_id
        and item_row.store_id = p_store_id
        and item_row.commercial_opportunity_id = p_commercial_opportunity_id
        and item_row.checklist_version_id = v_base.id
        and item_row.applicability_state = 'needs_resolution'
    ) then 'needs_resolution'
    else 'resolved'
  end
  into v_base_derived_state;

  if v_base.checklist_state is distinct from v_base_derived_state then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_OVERRIDE_BASE_STATE_INCONSISTENT';
  end if;

  select case
    when exists (
      select 1
      from public.commercial_opportunity_checklist_items item_row
      where item_row.organization_id = p_request_organization_id
        and item_row.store_id = p_store_id
        and item_row.commercial_opportunity_id = p_commercial_opportunity_id
        and item_row.checklist_version_id = v_base.id
        and not (
          item_row.item_key = v_item_key
          and item_row.item_kind = v_item_kind
        )
        and item_row.applicability_state = 'conflict'
    ) then 'conflict'
    when v_to_state = 'needs_resolution'
      or exists (
        select 1
        from public.commercial_opportunity_checklist_items item_row
        where item_row.organization_id = p_request_organization_id
          and item_row.store_id = p_store_id
          and item_row.commercial_opportunity_id = p_commercial_opportunity_id
          and item_row.checklist_version_id = v_base.id
          and not (
            item_row.item_key = v_item_key
            and item_row.item_kind = v_item_kind
          )
          and item_row.applicability_state = 'needs_resolution'
      ) then 'needs_resolution'
    else 'resolved'
  end
  into v_result_state;

  v_version_metadata := pg_catalog.jsonb_build_object(
    'authority', 'human_checklist_override',
    'override_contract_version', 2,
    'override_item_key', v_item_key,
    'override_item_kind', v_item_kind,
    'override_from_applicability_state', v_base_item.applicability_state,
    'override_to_applicability_state', v_to_state,
    'system_baseline_checklist_version_id', v_system_baseline_checklist_version_id,
    'system_baseline_applicability_state', v_system_baseline_state,
    'system_baseline_basis_fingerprint', v_system_baseline_fingerprint,
    'request_metadata', v_metadata
  );

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
    p_request_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_base.version_number + 1,
    v_base.id,
    v_base.profile_version_id,
    v_base.gate_policy_version_id,
    v_result_state,
    v_base.settings_snapshot,
    v_base.settings_fingerprint,
    v_operation_key,
    v_request_fingerprint,
    'human',
    v_user_id,
    'crm_manual',
    v_reason_code,
    'user:' || v_user_id::text,
    v_version_metadata
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
    item_row.organization_id,
    item_row.store_id,
    item_row.commercial_opportunity_id,
    v_new.id,
    item_row.item_key,
    item_row.item_kind,
    case
      when item_row.item_key = v_item_key and item_row.item_kind = v_item_kind
        then v_to_state
      else item_row.applicability_state
    end,
    case
      when item_row.item_key = v_item_key and item_row.item_kind = v_item_kind
        then v_reason_code
      else item_row.reason_code
    end,
    case
      when item_row.item_key = v_item_key and item_row.item_kind = v_item_kind
        then (
          item_row.decision_basis
            - 'human_override'
            - 'human_carry_forward'
            - 'human_revalidation'
            - 'human_override_resolution'
        ) || pg_catalog.jsonb_build_object(
          'system_basis_version', 1,
          'system_applicability_state', v_system_baseline_state,
          'system_reason_code', v_system_baseline_reason,
          'system_basis_fingerprint', v_system_baseline_fingerprint,
          'human_override',
          pg_catalog.jsonb_build_object(
            'status', 'active',
            'operation_key', v_operation_key,
            'actor_user_id', v_user_id,
            'system_baseline_checklist_version_id', v_system_baseline_checklist_version_id,
            'system_baseline_applicability_state', v_system_baseline_state,
            'system_baseline_basis_fingerprint', v_system_baseline_fingerprint,
            'from_applicability_state', item_row.applicability_state,
            'to_applicability_state', v_to_state,
            'reason_code', v_reason_code,
            'reason_text', v_reason_text
          )
        )
      else item_row.decision_basis
    end,
    item_row.metadata
  from public.commercial_opportunity_checklist_items item_row
  where item_row.organization_id = p_request_organization_id
    and item_row.store_id = p_store_id
    and item_row.commercial_opportunity_id = p_commercial_opportunity_id
    and item_row.checklist_version_id = v_base.id;

  if (
    select pg_catalog.count(*)::integer
    from public.commercial_opportunity_checklist_items item_row
    where item_row.organization_id = p_request_organization_id
      and item_row.store_id = p_store_id
      and item_row.commercial_opportunity_id = p_commercial_opportunity_id
      and item_row.checklist_version_id = v_new.id
  ) <> v_item_count then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_OVERRIDE_ITEM_CLONE_COUNT_MISMATCH';
  end if;

  insert into public.commercial_opportunity_checklist_override_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    base_checklist_version_id,
    result_checklist_version_id,
    system_baseline_checklist_version_id,
    system_baseline_applicability_state,
    system_baseline_basis_fingerprint,
    item_key,
    item_kind,
    from_applicability_state,
    to_applicability_state,
    reason_code,
    reason_text,
    actor_user_id,
    operation_key,
    request_fingerprint,
    metadata
  )
  values (
    p_request_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_base.id,
    v_new.id,
    v_system_baseline_checklist_version_id,
    v_system_baseline_state,
    v_system_baseline_fingerprint,
    v_item_key,
    v_item_kind,
    v_base_item.applicability_state,
    v_to_state,
    v_reason_code,
    v_reason_text,
    v_user_id,
    v_operation_key,
    v_request_fingerprint,
    v_metadata
  )
  returning * into v_event;

  update public.commercial_opportunity_checklist_current current_row
  set
    current_checklist_version_id = v_new.id,
    last_operation_key = v_operation_key
  where current_row.organization_id = p_request_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id
    and current_row.current_checklist_version_id = p_expected_current_checklist_version_id;

  get diagnostics v_updated_rows = row_count;

  if v_updated_rows <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_OVERRIDE_CURRENT_UPDATE_FAILED';
  end if;

  select current_row.*
  into v_current
  from public.commercial_opportunity_checklist_current current_row
  where current_row.organization_id = p_request_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id;

  if not found
     or v_current.current_checklist_version_id is distinct from v_new.id
     or v_current.last_operation_key is distinct from v_operation_key then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_OVERRIDE_CURRENT_NOT_UPDATED';
  end if;

  return query
  select
    v_new.id,
    v_new.version_number,
    v_base.id,
    v_current.current_checklist_version_id,
    v_event.item_key,
    v_event.item_kind,
    v_event.from_applicability_state,
    v_event.to_applicability_state,
    v_new.checklist_state,
    true,
    false,
    'override_created'::text,
    v_new.request_fingerprint,
    v_user_id,
    v_event.created_at,
    v_current.updated_at;
end;
$function$;

alter function public.override_commercial_opportunity_checklist_item_by_user(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb
) owner to postgres;

comment on function public.override_commercial_opportunity_checklist_item_by_user(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb
) is
  'Authenticated-human-only P9 checklist applicability override writer v2. Requires active membership and expected current version, changes exactly one immutable item, records direct-parent audit plus the true system baseline/fingerprint, rejects manual conflict creation, and resolves replay before stale-current validation.';

revoke all on function public.override_commercial_opportunity_checklist_item_by_user(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.override_commercial_opportunity_checklist_item_by_user(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb
) to authenticated;

-- ============================================================================
-- Postconditions.
-- ============================================================================
do $postconditions$
declare
  v_basis_helper oid := pg_catalog.to_regprocedure(
    'public.p9_opportunity_checklist_system_basis_fingerprint_internal(text,text,text,text,jsonb)'
  );
  v_merge_helper oid := pg_catalog.to_regprocedure(
    'public.p9_opportunity_checklist_apply_human_override_internal(jsonb,jsonb)'
  );
  v_materializer oid := pg_catalog.to_regprocedure(
    'public.materialize_commercial_opportunity_checklist_by_system(uuid,uuid,uuid,text)'
  );
  v_writer oid := pg_catalog.to_regprocedure(
    'public.override_commercial_opportunity_checklist_item_by_user(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)'
  );
  v_validator oid := pg_catalog.to_regprocedure(
    'public.p9_commercial_opportunity_checklist_validate_override_event()'
  );
  v_definition text;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
begin
  if v_basis_helper is null or v_merge_helper is null or v_materializer is null
     or v_writer is null or v_validator is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: carry-forward functions are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute attribute_row
    where attribute_row.attrelid = 'public.commercial_opportunity_checklist_override_events'::regclass
      and attribute_row.attname = 'system_baseline_checklist_version_id'
      and not attribute_row.attisdropped
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute attribute_row
    where attribute_row.attrelid = 'public.commercial_opportunity_checklist_override_events'::regclass
      and attribute_row.attname = 'system_baseline_applicability_state'
      and not attribute_row.attisdropped
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute attribute_row
    where attribute_row.attrelid = 'public.commercial_opportunity_checklist_override_events'::regclass
      and attribute_row.attname = 'system_baseline_basis_fingerprint'
      and not attribute_row.attisdropped
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: carry-forward baseline columns are missing';
  end if;

  if pg_catalog.has_function_privilege('anon', v_basis_helper, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_basis_helper, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_basis_helper, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_merge_helper, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_merge_helper, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_merge_helper, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: carry-forward internal helper leaked EXECUTE';
  end if;

  if pg_catalog.has_function_privilege('anon', v_materializer, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_materializer, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_materializer, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: materializer grants mismatch';
  end if;

  if pg_catalog.has_function_privilege('anon', v_writer, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_writer, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_writer, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: human override writer grants mismatch';
  end if;

  select pg_catalog.pg_get_functiondef(v_materializer) into v_definition;
  if pg_catalog.strpos(v_definition, 'preserved_human_authority') > 0
     or pg_catalog.strpos(v_definition, 'preserved_legacy_human_authority') = 0
     or pg_catalog.strpos(v_definition, 'preserved_non_materializer_authority') = 0
     or pg_catalog.strpos(v_definition, 'p9_opportunity_checklist_apply_human_override_internal') = 0
     or pg_catalog.strpos(v_definition, 'system_basis_fingerprint') = 0
     or pg_catalog.strpos(v_definition, 'checklist_version_created_with_human_merge') = 0
     or pg_catalog.strpos(v_definition, 'p9_checklist_materializer_v2') = 0
     or pg_catalog.strpos(v_definition, 'max(version_number)') > 0
     or pg_catalog.strpos(v_definition, 'order by created_at desc') > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: materializer v2 carry-forward contract mismatch';
  end if;

  select pg_catalog.pg_get_functiondef(v_writer) into v_definition;
  if pg_catalog.strpos(v_definition, 'pg_catalog.nullif') > 0
     or pg_catalog.strpos(v_definition, 'system_baseline_checklist_version_id') = 0
     or pg_catalog.strpos(v_definition, 'system_baseline_basis_fingerprint') = 0
     or pg_catalog.strpos(v_definition, 'ZION_CHECKLIST_OVERRIDE_TARGET_STATE_INVALID') = 0
     or pg_catalog.strpos(v_definition, 'ZION_CHECKLIST_OVERRIDE_STALE_CURRENT') = 0
     or pg_catalog.strpos(v_definition, 'idempotent_replay_stale') = 0
     or pg_catalog.strpos(v_definition, 'max(version_number)') > 0
     or pg_catalog.strpos(v_definition, 'order by created_at desc') > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: human override writer v2 contract mismatch';
  end if;

  select pg_catalog.pg_get_functiondef(v_validator) into v_definition;
  if pg_catalog.strpos(v_definition, 'system baseline is required') = 0
     or pg_catalog.strpos(v_definition, 'system baseline payload mismatch') = 0
     or pg_catalog.strpos(v_definition, 'result item baseline audit mismatch') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: override event baseline validator mismatch';
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
      message = 'postcondition failed: materializer v2 hardening mismatch';
  end if;

  select role_row.rolname, proc_row.prosecdef, proc_row.proconfig
  into v_owner, v_security_definer, v_config
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_roles role_row on role_row.oid = proc_row.proowner
  where proc_row.oid = v_writer;

  if v_owner is distinct from 'postgres'
     or not coalesce(v_security_definer, false)
     or not ('search_path=pg_catalog, pg_temp, public, auth, extensions' = any(coalesce(v_config, array[]::text[])))
     or not ('row_security=off' = any(coalesce(v_config, array[]::text[]))) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: human override writer v2 hardening mismatch';
  end if;

  if pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_checklist_versions', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_checklist_versions', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_checklist_items', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_checklist_items', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_checklist_current', 'UPDATE')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_checklist_current', 'UPDATE')
     or pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_checklist_override_events', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_checklist_override_events', 'INSERT') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: direct checklist mutation privilege leaked';
  end if;
end;
$postconditions$;

commit;
