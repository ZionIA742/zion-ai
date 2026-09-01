begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local idle_in_transaction_session_timeout = '120s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:qualification-profile-materializer-guard:v1', 0)
);

-- ============================================================================
-- P9 3.5 - Qualification -> Commercial Opportunity Profile Materializer Guard
--
-- Authority boundary:
-- - canonical Qualification Facts are evidence, not structural sale authority;
-- - v1 never invents pool/catalog/service/custom components from text references;
-- - installation_interest true/false/inferred remains only evidence and therefore
--   materializes as installation=unresolved, never included/excluded;
-- - an installation_interest conflict materializes as installation=conflict;
-- - technical_visit_interest/payment_interest are intentionally not profile
--   execution intents in this materializer;
-- - human profile authority and any non-owned system profile authority win;
-- - read/precedence/write happens under the same opportunity/current lock;
-- - current is explicit; there is no latest/max(version_number) fallback.
-- ============================================================================

do $preflight$
begin
  if pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_profile_versions') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_profile_components') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_profile_execution_intents') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_profile_current') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: P9 commercial opportunity profile foundation is incomplete';
  end if;

  if pg_catalog.to_regprocedure(
    'public.zion_resolve_request_role_internal()'
  ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.zion_resolve_request_role_internal() is missing';
  end if;

  if pg_catalog.to_regprocedure(
    'public.write_commercial_opportunity_profile_internal(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,uuid,text,text,text,jsonb)'
  ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical commercial opportunity profile writer is missing';
  end if;

  if pg_catalog.to_regprocedure(
    'public.materialize_commercial_opportunity_profile_from_qualification_by_system(uuid,uuid,uuid,text,text)'
  ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'qualification profile materializer guard collision detected';
  end if;
end;
$preflight$;

create or replace function public.materialize_commercial_opportunity_profile_from_qualification_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_materialization_event_key text,
  p_installation_evidence_state text
)
returns table (
  current_profile_version_id uuid,
  version_number integer,
  previous_profile_version_id uuid,
  component_count integer,
  execution_intent_count integer,
  profile_state text,
  changed boolean,
  replayed boolean,
  preserved boolean,
  outcome text,
  request_fingerprint text,
  actor_type text,
  source_type text,
  created_by text,
  current_updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public, auth
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_event_key text := nullif(pg_catalog.btrim(coalesce(p_materialization_event_key, '')), '');
  v_installation_evidence_state text := pg_catalog.lower(
    nullif(pg_catalog.btrim(coalesce(p_installation_evidence_state, '')), '')
  );

  v_operation_key text;
  v_request_fingerprint text;
  v_profile_state text;
  v_execution_intents jsonb := '[]'::jsonb;
  v_profile_metadata jsonb := pg_catalog.jsonb_build_object(
    'authority', 'canonical_qualification_facts',
    'materializer_version', 1,
    'structural_component_resolution', 'unavailable_in_runtime_v1'
  );
  v_intent_metadata jsonb := pg_catalog.jsonb_build_object(
    'source_fact_key', 'installation_interest',
    'materializer_version', 1
  );

  v_history_count integer := 0;
  v_component_count integer := 0;
  v_execution_intent_count integer := 0;
  v_expected_intent_count integer := 0;
  v_payload_matches boolean := false;

  v_has_current boolean := false;
  v_current public.commercial_opportunity_profile_current%rowtype;
  v_current_version public.commercial_opportunity_profile_versions%rowtype;
  v_write record;
begin
  if v_request_role is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'ZION_QUALIFICATION_PROFILE_MATERIALIZER_NOT_AUTHORIZED';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_QUALIFICATION_PROFILE_SCOPE_REQUIRED';
  end if;

  if v_event_key is null or pg_catalog.length(v_event_key) > 150 then
    raise exception using
      errcode = '22023',
      message = 'ZION_QUALIFICATION_PROFILE_EVENT_KEY_INVALID';
  end if;

  if v_installation_evidence_state not in ('absent', 'known', 'conflict') then
    raise exception using
      errcode = '22023',
      message = 'ZION_QUALIFICATION_PROFILE_INSTALLATION_EVIDENCE_STATE_INVALID';
  end if;

  v_operation_key := 'qualification_profile:v1:' || v_event_key;

  if pg_catalog.length(v_operation_key) > 200 then
    raise exception using
      errcode = '22023',
      message = 'ZION_QUALIFICATION_PROFILE_OPERATION_KEY_INVALID';
  end if;

  case v_installation_evidence_state
    when 'absent' then
      v_request_fingerprint := '219f52b4ee0651477b4ec2a677683227e745aaf0cbdf01cfae55581cc9519252';
      v_profile_state := 'needs_clarification';
      v_execution_intents := '[]'::jsonb;
      v_expected_intent_count := 0;

    when 'known' then
      v_request_fingerprint := '2ca56a55473f94934f0a4a74981f59bcd665d83b0ef9565e87a4bfb8dc1ec779';
      v_profile_state := 'needs_clarification';
      v_execution_intents := pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'execution_kind', 'installation',
          'intent_state', 'unresolved',
          'reason_code', 'qualification_installation_interest_is_evidence_only',
          'metadata', v_intent_metadata
        )
      );
      v_expected_intent_count := 1;

    when 'conflict' then
      v_request_fingerprint := '6911d729e2fec441e2759082977914e01980bbd9cda0cd7da93251f6b41bf338';
      v_profile_state := 'conflict';
      v_execution_intents := pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'execution_kind', 'installation',
          'intent_state', 'conflict',
          'reason_code', 'qualification_installation_interest_conflict',
          'metadata', v_intent_metadata
        )
      );
      v_expected_intent_count := 1;
  end case;

  if not exists (
    select 1
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = p_commercial_opportunity_id
      and opportunity_row.organization_id = p_organization_id
      and opportunity_row.store_id = p_store_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'ZION_QUALIFICATION_PROFILE_OPPORTUNITY_SCOPE_INVALID';
  end if;

  -- Use the exact same opportunity-scoped advisory lock as the canonical writer.
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

  select current_row.*
  into v_current
  from public.commercial_opportunity_profile_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id
  for update;

  v_has_current := found;

  select pg_catalog.count(*)::integer
  into v_history_count
  from public.commercial_opportunity_profile_versions version_row
  where version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id
    and version_row.commercial_opportunity_id = p_commercial_opportunity_id;

  if not v_has_current and v_history_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_QUALIFICATION_PROFILE_CURRENT_MISSING_WITH_HISTORY';
  end if;

  if v_has_current then
    select version_row.*
    into v_current_version
    from public.commercial_opportunity_profile_versions version_row
    where version_row.id = v_current.current_profile_version_id
      and version_row.organization_id = p_organization_id
      and version_row.store_id = p_store_id
      and version_row.commercial_opportunity_id = p_commercial_opportunity_id;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_QUALIFICATION_PROFILE_CURRENT_VERSION_INVALID';
    end if;

    select pg_catalog.count(*)::integer
    into v_component_count
    from public.commercial_opportunity_profile_components component_row
    where component_row.organization_id = p_organization_id
      and component_row.store_id = p_store_id
      and component_row.commercial_opportunity_id = p_commercial_opportunity_id
      and component_row.profile_version_id = v_current_version.id;

    select pg_catalog.count(*)::integer
    into v_execution_intent_count
    from public.commercial_opportunity_profile_execution_intents intent_row
    where intent_row.organization_id = p_organization_id
      and intent_row.store_id = p_store_id
      and intent_row.commercial_opportunity_id = p_commercial_opportunity_id
      and intent_row.profile_version_id = v_current_version.id;

    if v_current_version.actor_type = 'human' then
      return query
      select
        v_current_version.id,
        v_current_version.version_number,
        v_current_version.previous_profile_version_id,
        v_component_count,
        v_execution_intent_count,
        v_current_version.profile_state,
        false,
        false,
        true,
        'preserved_human_authority'::text,
        v_current_version.request_fingerprint,
        v_current_version.actor_type,
        v_current_version.source_type,
        v_current_version.created_by,
        v_current.updated_at;
      return;
    end if;

    if v_current_version.actor_type <> 'system'
       or v_current_version.source_type <> 'qualification_materializer'
       or v_current_version.created_by <> 'sales_ai_profile_materializer_v1' then
      return query
      select
        v_current_version.id,
        v_current_version.version_number,
        v_current_version.previous_profile_version_id,
        v_component_count,
        v_execution_intent_count,
        v_current_version.profile_state,
        false,
        false,
        true,
        'preserved_non_qualification_authority'::text,
        v_current_version.request_fingerprint,
        v_current_version.actor_type,
        v_current_version.source_type,
        v_current_version.created_by,
        v_current.updated_at;
      return;
    end if;

    if v_current_version.request_fingerprint = v_request_fingerprint then
      v_payload_matches := (
        v_current_version.profile_state = v_profile_state
        and v_current_version.metadata = v_profile_metadata
        and v_component_count = 0
        and v_execution_intent_count = v_expected_intent_count
      );

      if v_payload_matches and v_installation_evidence_state = 'absent' then
        v_payload_matches := not exists (
          select 1
          from public.commercial_opportunity_profile_execution_intents intent_row
          where intent_row.profile_version_id = v_current_version.id
        );
      elsif v_payload_matches and v_installation_evidence_state = 'known' then
        v_payload_matches := exists (
          select 1
          from public.commercial_opportunity_profile_execution_intents intent_row
          where intent_row.profile_version_id = v_current_version.id
            and intent_row.execution_kind = 'installation'
            and intent_row.intent_state = 'unresolved'
            and intent_row.reason_code = 'qualification_installation_interest_is_evidence_only'
            and intent_row.metadata = v_intent_metadata
        );
      elsif v_payload_matches and v_installation_evidence_state = 'conflict' then
        v_payload_matches := exists (
          select 1
          from public.commercial_opportunity_profile_execution_intents intent_row
          where intent_row.profile_version_id = v_current_version.id
            and intent_row.execution_kind = 'installation'
            and intent_row.intent_state = 'conflict'
            and intent_row.reason_code = 'qualification_installation_interest_conflict'
            and intent_row.metadata = v_intent_metadata
        );
      end if;

      if not v_payload_matches then
        raise exception using
          errcode = 'P0001',
          message = 'ZION_QUALIFICATION_PROFILE_FINGERPRINT_PAYLOAD_MISMATCH';
      end if;

      return query
      select
        v_current_version.id,
        v_current_version.version_number,
        v_current_version.previous_profile_version_id,
        v_component_count,
        v_execution_intent_count,
        v_current_version.profile_state,
        false,
        false,
        false,
        'qualification_profile_unchanged'::text,
        v_current_version.request_fingerprint,
        v_current_version.actor_type,
        v_current_version.source_type,
        v_current_version.created_by,
        v_current.updated_at;
      return;
    end if;
  end if;

  -- No current, or current belongs to this exact v1 materializer and its
  -- semantic output changed. Delegate canonical version creation/idempotency to
  -- the existing writer while preserving this transaction's locks.
  select *
  into v_write
  from public.write_commercial_opportunity_profile_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_operation_key,
    v_request_fingerprint,
    v_profile_state,
    '[]'::jsonb,
    v_execution_intents,
    'system',
    null,
    'qualification_materializer',
    'profile_materialized_from_qualification',
    'sales_ai_profile_materializer_v1',
    v_profile_metadata
  );

  select current_row.*
  into v_current
  from public.commercial_opportunity_profile_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_QUALIFICATION_PROFILE_CURRENT_MISSING_AFTER_WRITE';
  end if;

  select version_row.*
  into v_current_version
  from public.commercial_opportunity_profile_versions version_row
  where version_row.id = v_current.current_profile_version_id
    and version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id
    and version_row.commercial_opportunity_id = p_commercial_opportunity_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_QUALIFICATION_PROFILE_CURRENT_VERSION_INVALID_AFTER_WRITE';
  end if;

  select pg_catalog.count(*)::integer
  into v_component_count
  from public.commercial_opportunity_profile_components component_row
  where component_row.organization_id = p_organization_id
    and component_row.store_id = p_store_id
    and component_row.commercial_opportunity_id = p_commercial_opportunity_id
    and component_row.profile_version_id = v_current_version.id;

  select pg_catalog.count(*)::integer
  into v_execution_intent_count
  from public.commercial_opportunity_profile_execution_intents intent_row
  where intent_row.organization_id = p_organization_id
    and intent_row.store_id = p_store_id
    and intent_row.commercial_opportunity_id = p_commercial_opportunity_id
    and intent_row.profile_version_id = v_current_version.id;

  return query
  select
    v_current_version.id,
    v_current_version.version_number,
    v_current_version.previous_profile_version_id,
    v_component_count,
    v_execution_intent_count,
    v_current_version.profile_state,
    coalesce(v_write.changed, false),
    coalesce(v_write.replayed, false),
    false,
    coalesce(v_write.outcome, 'qualification_profile_materialization_completed'),
    v_current_version.request_fingerprint,
    v_current_version.actor_type,
    v_current_version.source_type,
    v_current_version.created_by,
    v_current.updated_at;
end;
$function$;

alter function public.materialize_commercial_opportunity_profile_from_qualification_by_system(
  uuid, uuid, uuid, text, text
) owner to postgres;

comment on function public.materialize_commercial_opportunity_profile_from_qualification_by_system(
  uuid, uuid, uuid, text, text
) is
  'Service-role-only P9 v1 qualification profile materializer. It never creates sale components from qualification text, treats installation interest as evidence-only unresolved/conflict, serializes precedence with the canonical profile writer, and preserves human or non-owned system profile authority.';

revoke all on function public.materialize_commercial_opportunity_profile_from_qualification_by_system(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.materialize_commercial_opportunity_profile_from_qualification_by_system(
  uuid, uuid, uuid, text, text
) to service_role;

-- Postconditions.
do $postconditions$
declare
  v_function oid := pg_catalog.to_regprocedure(
    'public.materialize_commercial_opportunity_profile_from_qualification_by_system(uuid,uuid,uuid,text,text)'
  );
  v_definition text;
begin
  if v_function is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: qualification profile materializer guard is missing';
  end if;

  if pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: qualification profile materializer grants are invalid';
  end if;

  select pg_catalog.pg_get_functiondef(v_function)
  into v_definition;

  if pg_catalog.strpos(v_definition, 'pg_advisory_xact_lock') = 0
     or pg_catalog.strpos(v_definition, 'for update') = 0
     or pg_catalog.strpos(v_definition, 'preserved_human_authority') = 0
     or pg_catalog.strpos(v_definition, 'preserved_non_qualification_authority') = 0
     or pg_catalog.strpos(v_definition, 'sales_ai_profile_materializer_v1') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: qualification profile materializer guard contract is incomplete';
  end if;
end;
$postconditions$;

commit;
