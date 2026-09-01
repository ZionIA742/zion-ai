begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local idle_in_transaction_session_timeout = '120s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:commercial-opportunity-profile-canonical-writer:v1', 0)
);

-- ============================================================================
-- P9 3.5 - Canonical Commercial Opportunity Profile Writer
--
-- Contract:
-- - profile versions/components/execution intents are append-only;
-- - commercial_opportunity_profile_current is the only live authority;
-- - no latest/max(version_number) fallback;
-- - one opportunity-scoped advisory lock serializes version creation/current;
-- - operation_key replay is idempotent and never regresses current;
-- - same operation_key with different fingerprint or normalized payload fails;
-- - profile_state is cross-row validated against child component/intent states;
-- - system runtime writes are service_role-only;
-- - human writes require authenticated active organization membership;
-- - direct writes to profile tables remain closed.
-- ============================================================================

do $preflight$
declare
  v_table text;
  v_signature text;
begin
  foreach v_table in array array[
    'organizations',
    'stores',
    'memberships',
    'commercial_opportunities',
    'pools',
    'store_catalog_items',
    'commercial_opportunity_profile_versions',
    'commercial_opportunity_profile_components',
    'commercial_opportunity_profile_execution_intents',
    'commercial_opportunity_profile_current'
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

  foreach v_signature in array array[
    'public.write_commercial_opportunity_profile_internal(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,uuid,text,text,text,jsonb)',
    'public.write_commercial_opportunity_profile_by_system(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,jsonb)',
    'public.write_commercial_opportunity_profile_by_user(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,jsonb)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is not null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('commercial opportunity profile writer collision detected: %s', v_signature);
    end if;
  end loop;
end;
$preflight$;

create or replace function public.write_commercial_opportunity_profile_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text,
  p_request_fingerprint text,
  p_profile_state text,
  p_components jsonb,
  p_execution_intents jsonb,
  p_actor_type text,
  p_actor_user_id uuid,
  p_source_type text,
  p_reason_code text,
  p_created_by text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  profile_version_id uuid,
  version_number integer,
  previous_profile_version_id uuid,
  component_count integer,
  execution_intent_count integer,
  current_profile_version_id uuid,
  profile_state text,
  changed boolean,
  replayed boolean,
  outcome text,
  created_at timestamptz,
  current_updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_operation_key text := nullif(pg_catalog.btrim(coalesce(p_operation_key, '')), '');
  v_request_fingerprint text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_request_fingerprint, '')), ''));
  v_profile_state text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_profile_state, '')), ''));
  v_actor_type text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_actor_type, '')), ''));
  v_source_type text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_source_type, '')), ''));
  v_reason_code text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_reason_code, '')), ''));
  v_created_by text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_created_by, '')), ''));
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);

  v_component jsonb;
  v_component_key text;
  v_component_kind text;
  v_component_state text;
  v_pool_id uuid;
  v_catalog_item_id uuid;
  v_reference_text text;
  v_component_metadata jsonb;
  v_normalized_components jsonb := '[]'::jsonb;
  v_existing_components jsonb := '[]'::jsonb;

  v_intent jsonb;
  v_execution_kind text;
  v_intent_state text;
  v_intent_reason_code text;
  v_intent_metadata jsonb;
  v_normalized_intents jsonb := '[]'::jsonb;
  v_existing_intents jsonb := '[]'::jsonb;

  v_component_total integer := 0;
  v_component_unique integer := 0;
  v_intent_total integer := 0;
  v_intent_unique integer := 0;
  v_has_conflict boolean := false;
  v_has_unresolved boolean := false;

  v_history_count integer;
  v_has_current boolean := false;
  v_current public.commercial_opportunity_profile_current%rowtype;
  v_current_version public.commercial_opportunity_profile_versions%rowtype;
  v_existing public.commercial_opportunity_profile_versions%rowtype;
  v_new public.commercial_opportunity_profile_versions%rowtype;
  v_new_version_number integer;
  v_new_previous_id uuid;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_OPPORTUNITY_PROFILE_SCOPE_REQUIRED';
  end if;

  if v_operation_key is null or pg_catalog.length(v_operation_key) > 200 then
    raise exception using
      errcode = '22023',
      message = 'ZION_OPPORTUNITY_PROFILE_OPERATION_KEY_INVALID';
  end if;

  if v_request_fingerprint is null
     or pg_catalog.length(v_request_fingerprint) <> 64
     or v_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'ZION_OPPORTUNITY_PROFILE_REQUEST_FINGERPRINT_INVALID';
  end if;

  if v_profile_state not in ('resolved', 'needs_clarification', 'conflict') then
    raise exception using
      errcode = '22023',
      message = 'ZION_OPPORTUNITY_PROFILE_STATE_INVALID';
  end if;

  if v_actor_type not in ('human', 'system')
     or (v_actor_type = 'human' and p_actor_user_id is null)
     or (v_actor_type = 'system' and p_actor_user_id is not null) then
    raise exception using
      errcode = '22023',
      message = 'ZION_OPPORTUNITY_PROFILE_ACTOR_INVALID';
  end if;

  if v_source_type is null
     or pg_catalog.length(v_source_type) not between 3 and 120
     or v_source_type !~ '^[a-z0-9_:.\/-]+$' then
    raise exception using
      errcode = '22023',
      message = 'ZION_OPPORTUNITY_PROFILE_SOURCE_TYPE_INVALID';
  end if;

  if v_reason_code is null
     or pg_catalog.length(v_reason_code) not between 3 and 120
     or v_reason_code !~ '^[a-z0-9_:.\/-]+$' then
    raise exception using
      errcode = '22023',
      message = 'ZION_OPPORTUNITY_PROFILE_REASON_CODE_INVALID';
  end if;

  if v_created_by is null
     or pg_catalog.length(v_created_by) not between 3 and 120
     or v_created_by !~ '^[a-z0-9_:.\/-]+$' then
    raise exception using
      errcode = '22023',
      message = 'ZION_OPPORTUNITY_PROFILE_CREATED_BY_INVALID';
  end if;

  if pg_catalog.jsonb_typeof(v_metadata) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'ZION_OPPORTUNITY_PROFILE_METADATA_INVALID';
  end if;

  if p_components is null
     or pg_catalog.jsonb_typeof(p_components) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'ZION_OPPORTUNITY_PROFILE_COMPONENTS_ARRAY_REQUIRED';
  end if;

  if p_execution_intents is null
     or pg_catalog.jsonb_typeof(p_execution_intents) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'ZION_OPPORTUNITY_PROFILE_EXECUTION_INTENTS_ARRAY_REQUIRED';
  end if;

  -- Normalize components into one deterministic JSONB array.
  for v_component in
    select component_row.value
    from pg_catalog.jsonb_array_elements(p_components) component_row(value)
  loop
    if pg_catalog.jsonb_typeof(v_component) is distinct from 'object' then
      raise exception using
        errcode = '22023',
        message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_OBJECT_REQUIRED';
    end if;

    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_component) key_row(key_name)
      where key_row.key_name not in (
        'component_key',
        'component_kind',
        'component_state',
        'pool_id',
        'catalog_item_id',
        'reference_text',
        'metadata'
      )
    ) then
      raise exception using
        errcode = '22023',
        message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_UNKNOWN_FIELD';
    end if;

    v_component_key := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_component ->> 'component_key', '')), ''));
    v_component_kind := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_component ->> 'component_kind', '')), ''));
    v_component_state := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_component ->> 'component_state', '')), ''));
    v_reference_text := nullif(pg_catalog.btrim(coalesce(v_component ->> 'reference_text', '')), '');
    v_component_metadata := coalesce(v_component -> 'metadata', '{}'::jsonb);

    begin
      v_pool_id := nullif(pg_catalog.btrim(coalesce(v_component ->> 'pool_id', '')), '')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_POOL_ID_INVALID';
    end;

    begin
      v_catalog_item_id := nullif(pg_catalog.btrim(coalesce(v_component ->> 'catalog_item_id', '')), '')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_CATALOG_ITEM_ID_INVALID';
    end;

    if v_component_key is null
       or pg_catalog.length(v_component_key) > 120
       or v_component_key !~ '^[a-z0-9_:.\/-]+$' then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_KEY_INVALID';
    end if;

    if v_component_kind not in ('pool', 'catalog_item', 'service', 'custom') then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_KIND_INVALID';
    end if;

    if v_component_state not in ('resolved', 'partial', 'conflict') then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_STATE_INVALID';
    end if;

    if v_reference_text is not null and pg_catalog.length(v_reference_text) > 500 then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_REFERENCE_TEXT_INVALID';
    end if;

    if pg_catalog.jsonb_typeof(v_component_metadata) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_METADATA_INVALID';
    end if;

    if v_pool_id is not null and v_component_kind <> 'pool' then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_POOL_KIND_MISMATCH';
    end if;

    if v_catalog_item_id is not null and v_component_kind <> 'catalog_item' then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_CATALOG_KIND_MISMATCH';
    end if;

    if v_pool_id is not null and v_catalog_item_id is not null then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_MULTIPLE_CATALOG_REFS';
    end if;

    if v_component_kind = 'pool' and not (
      (v_component_state = 'resolved' and v_pool_id is not null)
      or (v_component_state = 'partial' and (v_pool_id is not null or v_reference_text is not null))
      or (v_component_state = 'conflict' and v_reference_text is not null)
    ) then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_POOL_COMPONENT_SHAPE_INVALID';
    end if;

    if v_component_kind = 'catalog_item' and not (
      (v_component_state = 'resolved' and v_catalog_item_id is not null)
      or (v_component_state = 'partial' and (v_catalog_item_id is not null or v_reference_text is not null))
      or (v_component_state = 'conflict' and v_reference_text is not null)
    ) then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_CATALOG_COMPONENT_SHAPE_INVALID';
    end if;

    if v_component_kind in ('service', 'custom') and (
      v_pool_id is not null
      or v_catalog_item_id is not null
      or v_reference_text is null
    ) then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_TEXT_COMPONENT_SHAPE_INVALID';
    end if;

    if v_pool_id is not null and not exists (
      select 1
      from public.pools pool_row
      where pool_row.id = v_pool_id
        and pool_row.organization_id = p_organization_id
        and pool_row.store_id = p_store_id
    ) then
      raise exception using errcode = '23503', message = 'ZION_OPPORTUNITY_PROFILE_POOL_OUTSIDE_SCOPE';
    end if;

    if v_catalog_item_id is not null and not exists (
      select 1
      from public.store_catalog_items item_row
      where item_row.id = v_catalog_item_id
        and item_row.organization_id = p_organization_id
        and item_row.store_id = p_store_id
    ) then
      raise exception using errcode = '23503', message = 'ZION_OPPORTUNITY_PROFILE_CATALOG_ITEM_OUTSIDE_SCOPE';
    end if;

    v_normalized_components := v_normalized_components || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'component_key', v_component_key,
        'component_kind', v_component_kind,
        'component_state', v_component_state,
        'pool_id', v_pool_id,
        'catalog_item_id', v_catalog_item_id,
        'reference_text', v_reference_text,
        'metadata', v_component_metadata
      )
    );
  end loop;

  select coalesce(
    pg_catalog.jsonb_agg(component_row.value order by component_row.value ->> 'component_key'),
    '[]'::jsonb
  )
  into v_normalized_components
  from pg_catalog.jsonb_array_elements(v_normalized_components) component_row(value);

  v_component_total := pg_catalog.jsonb_array_length(v_normalized_components);

  select pg_catalog.count(distinct component_row.value ->> 'component_key')::integer
  into v_component_unique
  from pg_catalog.jsonb_array_elements(v_normalized_components) component_row(value);

  if v_component_unique <> v_component_total then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_DUPLICATE_COMPONENT_KEY';
  end if;

  -- Normalize execution intents into one deterministic JSONB array.
  for v_intent in
    select intent_row.value
    from pg_catalog.jsonb_array_elements(p_execution_intents) intent_row(value)
  loop
    if pg_catalog.jsonb_typeof(v_intent) is distinct from 'object' then
      raise exception using
        errcode = '22023',
        message = 'ZION_OPPORTUNITY_PROFILE_EXECUTION_INTENT_OBJECT_REQUIRED';
    end if;

    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_intent) key_row(key_name)
      where key_row.key_name not in (
        'execution_kind',
        'intent_state',
        'reason_code',
        'metadata'
      )
    ) then
      raise exception using
        errcode = '22023',
        message = 'ZION_OPPORTUNITY_PROFILE_EXECUTION_INTENT_UNKNOWN_FIELD';
    end if;

    v_execution_kind := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_intent ->> 'execution_kind', '')), ''));
    v_intent_state := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_intent ->> 'intent_state', '')), ''));
    v_intent_reason_code := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_intent ->> 'reason_code', '')), ''));
    v_intent_metadata := coalesce(v_intent -> 'metadata', '{}'::jsonb);

    if v_execution_kind not in ('installation', 'delivery', 'pickup', 'service_execution') then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_EXECUTION_KIND_INVALID';
    end if;

    if v_intent_state not in ('included', 'excluded', 'unresolved', 'conflict') then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_EXECUTION_INTENT_STATE_INVALID';
    end if;

    if v_intent_reason_code is not null and (
      pg_catalog.length(v_intent_reason_code) not between 3 and 120
      or v_intent_reason_code !~ '^[a-z0-9_:.\/-]+$'
    ) then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_EXECUTION_REASON_CODE_INVALID';
    end if;

    if pg_catalog.jsonb_typeof(v_intent_metadata) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_EXECUTION_METADATA_INVALID';
    end if;

    v_normalized_intents := v_normalized_intents || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'execution_kind', v_execution_kind,
        'intent_state', v_intent_state,
        'reason_code', v_intent_reason_code,
        'metadata', v_intent_metadata
      )
    );
  end loop;

  select coalesce(
    pg_catalog.jsonb_agg(intent_row.value order by intent_row.value ->> 'execution_kind'),
    '[]'::jsonb
  )
  into v_normalized_intents
  from pg_catalog.jsonb_array_elements(v_normalized_intents) intent_row(value);

  v_intent_total := pg_catalog.jsonb_array_length(v_normalized_intents);

  select pg_catalog.count(distinct intent_row.value ->> 'execution_kind')::integer
  into v_intent_unique
  from pg_catalog.jsonb_array_elements(v_normalized_intents) intent_row(value);

  if v_intent_unique <> v_intent_total then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_DUPLICATE_EXECUTION_KIND';
  end if;

  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_normalized_components) component_row(value)
    where component_row.value ->> 'component_state' = 'conflict'
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_normalized_intents) intent_row(value)
    where intent_row.value ->> 'intent_state' = 'conflict'
  )
  into v_has_conflict;

  select (
    v_component_total = 0
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_normalized_components) component_row(value)
      where component_row.value ->> 'component_state' = 'partial'
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_normalized_intents) intent_row(value)
      where intent_row.value ->> 'intent_state' = 'unresolved'
    )
  )
  into v_has_unresolved;

  if v_has_conflict and v_profile_state <> 'conflict' then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_CONFLICT_STATE_REQUIRED';
  end if;

  if v_profile_state = 'conflict' and not v_has_conflict then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_CONFLICT_STATE_WITHOUT_CONFLICT';
  end if;

  if v_profile_state = 'resolved' and (
    v_component_total = 0
    or v_has_conflict
    or v_has_unresolved
  ) then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_RESOLVED_STATE_INCONSISTENT';
  end if;

  if v_profile_state = 'needs_clarification' and (
    v_has_conflict
    or not v_has_unresolved
  ) then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_NEEDS_CLARIFICATION_STATE_INCONSISTENT';
  end if;

  if not exists (
    select 1
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = p_commercial_opportunity_id
      and opportunity_row.organization_id = p_organization_id
      and opportunity_row.store_id = p_store_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'ZION_OPPORTUNITY_PROFILE_OPPORTUNITY_SCOPE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_store_id::text || ':' || p_commercial_opportunity_id::text,
      0
    )
  );

  -- Also lock the opportunity row so a profile write serializes with operations
  -- that explicitly lock the same opportunity record.
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
      message = 'ZION_OPPORTUNITY_PROFILE_CURRENT_MISSING_WITH_HISTORY';
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
        message = 'ZION_OPPORTUNITY_PROFILE_CURRENT_VERSION_INVALID';
    end if;
  end if;

  select version_row.*
  into v_existing
  from public.commercial_opportunity_profile_versions version_row
  where version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id
    and version_row.commercial_opportunity_id = p_commercial_opportunity_id
    and version_row.operation_key = v_operation_key;

  if found then
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'component_key', component_row.component_key,
          'component_kind', component_row.component_kind,
          'component_state', component_row.component_state,
          'pool_id', component_row.pool_id,
          'catalog_item_id', component_row.catalog_item_id,
          'reference_text', component_row.reference_text,
          'metadata', component_row.metadata
        )
        order by component_row.component_key
      ),
      '[]'::jsonb
    )
    into v_existing_components
    from public.commercial_opportunity_profile_components component_row
    where component_row.organization_id = p_organization_id
      and component_row.store_id = p_store_id
      and component_row.commercial_opportunity_id = p_commercial_opportunity_id
      and component_row.profile_version_id = v_existing.id;

    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'execution_kind', intent_row.execution_kind,
          'intent_state', intent_row.intent_state,
          'reason_code', intent_row.reason_code,
          'metadata', intent_row.metadata
        )
        order by intent_row.execution_kind
      ),
      '[]'::jsonb
    )
    into v_existing_intents
    from public.commercial_opportunity_profile_execution_intents intent_row
    where intent_row.organization_id = p_organization_id
      and intent_row.store_id = p_store_id
      and intent_row.commercial_opportunity_id = p_commercial_opportunity_id
      and intent_row.profile_version_id = v_existing.id;

    if v_existing.request_fingerprint is distinct from v_request_fingerprint
       or v_existing.profile_state is distinct from v_profile_state
       or v_existing.actor_type is distinct from v_actor_type
       or v_existing.actor_user_id is distinct from p_actor_user_id
       or v_existing.source_type is distinct from v_source_type
       or v_existing.reason_code is distinct from v_reason_code
       or v_existing.created_by is distinct from v_created_by
       or v_existing.metadata is distinct from v_metadata
       or v_existing_components is distinct from v_normalized_components
       or v_existing_intents is distinct from v_normalized_intents then
      raise exception using
        errcode = '23505',
        message = 'ZION_OPPORTUNITY_PROFILE_IDEMPOTENCY_KEY_REUSED';
    end if;

    return query
    select
      v_existing.id,
      v_existing.version_number,
      v_existing.previous_profile_version_id,
      v_component_total,
      v_intent_total,
      v_current.current_profile_version_id,
      v_existing.profile_state,
      false,
      true,
      case
        when v_current.current_profile_version_id = v_existing.id
          then 'idempotent_replay_current'
        else 'idempotent_replay_stale'
      end,
      v_existing.created_at,
      v_current.updated_at;
    return;
  end if;

  if v_has_current then
    v_new_previous_id := v_current_version.id;
    v_new_version_number := v_current_version.version_number + 1;
  else
    v_new_previous_id := null;
    v_new_version_number := 1;
  end if;

  insert into public.commercial_opportunity_profile_versions (
    organization_id,
    store_id,
    commercial_opportunity_id,
    version_number,
    previous_profile_version_id,
    profile_state,
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
    v_profile_state,
    v_operation_key,
    v_request_fingerprint,
    v_actor_type,
    p_actor_user_id,
    v_source_type,
    v_reason_code,
    v_created_by,
    v_metadata
  )
  returning * into v_new;

  insert into public.commercial_opportunity_profile_components (
    organization_id,
    store_id,
    commercial_opportunity_id,
    profile_version_id,
    component_key,
    component_kind,
    component_state,
    pool_id,
    catalog_item_id,
    reference_text,
    metadata
  )
  select
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_new.id,
    normalized_component.component_key,
    normalized_component.component_kind,
    normalized_component.component_state,
    normalized_component.pool_id,
    normalized_component.catalog_item_id,
    normalized_component.reference_text,
    normalized_component.metadata
  from pg_catalog.jsonb_to_recordset(v_normalized_components) as normalized_component(
    component_key text,
    component_kind text,
    component_state text,
    pool_id uuid,
    catalog_item_id uuid,
    reference_text text,
    metadata jsonb
  );

  insert into public.commercial_opportunity_profile_execution_intents (
    organization_id,
    store_id,
    commercial_opportunity_id,
    profile_version_id,
    execution_kind,
    intent_state,
    reason_code,
    metadata
  )
  select
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_new.id,
    normalized_intent.execution_kind,
    normalized_intent.intent_state,
    normalized_intent.reason_code,
    normalized_intent.metadata
  from pg_catalog.jsonb_to_recordset(v_normalized_intents) as normalized_intent(
    execution_kind text,
    intent_state text,
    reason_code text,
    metadata jsonb
  );

  insert into public.commercial_opportunity_profile_current (
    organization_id,
    store_id,
    commercial_opportunity_id,
    current_profile_version_id,
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
    current_profile_version_id = excluded.current_profile_version_id,
    last_operation_key = excluded.last_operation_key;

  select current_row.*
  into v_current
  from public.commercial_opportunity_profile_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id;

  return query
  select
    v_new.id,
    v_new.version_number,
    v_new.previous_profile_version_id,
    v_component_total,
    v_intent_total,
    v_current.current_profile_version_id,
    v_new.profile_state,
    true,
    false,
    'profile_version_created'::text,
    v_new.created_at,
    v_current.updated_at;
end;
$function$;

alter function public.write_commercial_opportunity_profile_internal(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, uuid, text, text, text, jsonb
) owner to postgres;

comment on function public.write_commercial_opportunity_profile_internal(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, uuid, text, text, text, jsonb
) is
  'Canonical P9 commercial opportunity profile writer. Creates append-only profile versions/components/execution intents, validates cross-row state, moves explicit current, and provides operation-key idempotency without latest/max fallback.';

revoke all on function public.write_commercial_opportunity_profile_internal(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, uuid, text, text, text, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.write_commercial_opportunity_profile_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text,
  p_request_fingerprint text,
  p_profile_state text,
  p_components jsonb,
  p_execution_intents jsonb,
  p_source_type text default 'qualification_materializer',
  p_reason_code text default 'profile_materialized_by_system',
  p_created_by text default 'sales_ai',
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  profile_version_id uuid,
  version_number integer,
  previous_profile_version_id uuid,
  component_count integer,
  execution_intent_count integer,
  current_profile_version_id uuid,
  profile_state text,
  changed boolean,
  replayed boolean,
  outcome text,
  created_at timestamptz,
  current_updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public, auth
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
begin
  if v_request_role is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'ZION_OPPORTUNITY_PROFILE_SYSTEM_WRITE_NOT_AUTHORIZED';
  end if;

  return query
  select *
  from public.write_commercial_opportunity_profile_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_operation_key,
    p_request_fingerprint,
    p_profile_state,
    p_components,
    p_execution_intents,
    'system',
    null,
    p_source_type,
    p_reason_code,
    p_created_by,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$function$;

alter function public.write_commercial_opportunity_profile_by_system(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, text, text, jsonb
) owner to postgres;

comment on function public.write_commercial_opportunity_profile_by_system(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, text, text, jsonb
) is
  'Service-role-only P9 commercial opportunity profile writer for canonical runtime materialization. System writes have no actor_user_id.';

revoke all on function public.write_commercial_opportunity_profile_by_system(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, text, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.write_commercial_opportunity_profile_by_system(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, text, text, jsonb
) to service_role;

create or replace function public.write_commercial_opportunity_profile_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text,
  p_request_fingerprint text,
  p_profile_state text,
  p_components jsonb,
  p_execution_intents jsonb,
  p_reason_code text default 'profile_updated_by_user',
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  profile_version_id uuid,
  version_number integer,
  previous_profile_version_id uuid,
  component_count integer,
  execution_intent_count integer,
  current_profile_version_id uuid,
  profile_state text,
  changed boolean,
  replayed boolean,
  outcome text,
  created_at timestamptz,
  current_updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public, auth
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_user_id uuid := auth.uid();
  v_is_member boolean;
begin
  if v_request_role is distinct from 'authenticated' or v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'ZION_OPPORTUNITY_PROFILE_USER_WRITE_NOT_AUTHORIZED';
  end if;

  select exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
      and membership_row.is_active is true
  )
  into v_is_member;

  if not coalesce(v_is_member, false) then
    raise exception using
      errcode = '42501',
      message = 'ZION_OPPORTUNITY_PROFILE_ACTIVE_MEMBERSHIP_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_request_organization_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'ZION_OPPORTUNITY_PROFILE_STORE_SCOPE_NOT_AUTHORIZED';
  end if;

  if not exists (
    select 1
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = p_commercial_opportunity_id
      and opportunity_row.organization_id = p_request_organization_id
      and opportunity_row.store_id = p_store_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'ZION_OPPORTUNITY_PROFILE_OPPORTUNITY_SCOPE_NOT_AUTHORIZED';
  end if;

  return query
  select *
  from public.write_commercial_opportunity_profile_internal(
    p_request_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_operation_key,
    p_request_fingerprint,
    p_profile_state,
    p_components,
    p_execution_intents,
    'human',
    v_user_id,
    'crm_manual',
    p_reason_code,
    'user:' || v_user_id::text,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$function$;

alter function public.write_commercial_opportunity_profile_by_user(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, jsonb
) owner to postgres;

comment on function public.write_commercial_opportunity_profile_by_user(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, jsonb
) is
  'Authenticated-human P9 commercial opportunity profile writer. Requires active organization membership and exact store/opportunity scope.';

revoke all on function public.write_commercial_opportunity_profile_by_user(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.write_commercial_opportunity_profile_by_user(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, jsonb
) to authenticated;

-- ============================================================================
-- Postconditions.
-- ============================================================================

do $postconditions$
declare
  v_internal oid := pg_catalog.to_regprocedure(
    'public.write_commercial_opportunity_profile_internal(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,uuid,text,text,text,jsonb)'
  );
  v_system oid := pg_catalog.to_regprocedure(
    'public.write_commercial_opportunity_profile_by_system(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,jsonb)'
  );
  v_user oid := pg_catalog.to_regprocedure(
    'public.write_commercial_opportunity_profile_by_user(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,jsonb)'
  );
  v_internal_def text;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
begin
  if v_internal is null or v_system is null or v_user is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: commercial opportunity profile writer functions are missing';
  end if;

  select pg_catalog.pg_get_functiondef(v_internal)
  into v_internal_def;

  if v_internal_def not like '%pg_advisory_xact_lock%'
     or v_internal_def not like '%for update%'
     or v_internal_def like '%max(version_number)%'
     or v_internal_def like '%order by created_at desc%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: internal opportunity-profile writer concurrency/current contract mismatch';
  end if;

  if v_internal_def not like '%ZION_OPPORTUNITY_PROFILE_IDEMPOTENCY_KEY_REUSED%'
     or v_internal_def not like '%v_existing_components is distinct from v_normalized_components%'
     or v_internal_def not like '%v_existing_intents is distinct from v_normalized_intents%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: opportunity-profile idempotency payload contract mismatch';
  end if;

  if v_internal_def not like '%ZION_OPPORTUNITY_PROFILE_CONFLICT_STATE_REQUIRED%'
     or v_internal_def not like '%ZION_OPPORTUNITY_PROFILE_RESOLVED_STATE_INCONSISTENT%'
     or v_internal_def not like '%ZION_OPPORTUNITY_PROFILE_NEEDS_CLARIFICATION_STATE_INCONSISTENT%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: opportunity-profile cross-row state contract mismatch';
  end if;

  select role_row.rolname, proc_row.prosecdef, proc_row.proconfig
  into v_owner, v_security_definer, v_config
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_roles role_row on role_row.oid = proc_row.proowner
  where proc_row.oid = v_internal;

  if v_owner is distinct from 'postgres'
     or not coalesce(v_security_definer, false)
     or not ('search_path=pg_catalog, pg_temp, public' = any(coalesce(v_config, array[]::text[])))
     or not ('row_security=off' = any(coalesce(v_config, array[]::text[]))) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: internal opportunity-profile writer hardening mismatch';
  end if;

  if pg_catalog.has_function_privilege('anon', v_internal, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_internal, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_internal, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: internal opportunity-profile writer leaked EXECUTE';
  end if;

  if not pg_catalog.has_function_privilege('service_role', v_system, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_system, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_system, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: system opportunity-profile writer grants mismatch';
  end if;

  if not pg_catalog.has_function_privilege('authenticated', v_user, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_user, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_user, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: user opportunity-profile writer grants mismatch';
  end if;

  if pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_profile_versions', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_profile_versions', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_profile_components', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_profile_components', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_profile_execution_intents', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_profile_execution_intents', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_profile_current', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_profile_current', 'INSERT') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: direct opportunity-profile table INSERT became available';
  end if;
end;
$postconditions$;

commit;
