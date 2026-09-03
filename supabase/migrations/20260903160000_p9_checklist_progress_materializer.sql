begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:checklist-progress-materializer:v1', 0)
);

-- ============================================================================
-- P9 / Bloco 3 / Etapa 3.5
-- Commercial Opportunity Checklist Progress Materializer v1.
--
-- Frozen contract:
-- - Applicability remains owned by the immutable current Checklist;
-- - only required/optional checklist items receive Progress rows;
-- - Progress is not_started | in_progress | completed;
-- - Assessment is determined | needs_resolution | conflict;
-- - Assessment <> determined always means Progress = NULL;
-- - explicit current Checklist and opportunity lifecycle_cycle are authoritative;
-- - domain resolvers own their facts; this materializer only orchestrates them;
-- - unsupported domains fail closed as needs_resolution / NULL, never guessed;
-- - every required/optional item is materialized exactly once before current moves;
-- - current is explicit; latest/max/version-number discovery is forbidden;
-- - event replay is idempotent and stale replay never regresses current;
-- - versions/items are append-only and evidence fingerprints are deterministic.
-- ============================================================================

do $preflight$
declare
  v_table text;
  v_signature text;
begin
  foreach v_table in array array[
    'commercial_opportunities',
    'commercial_opportunity_checklist_versions',
    'commercial_opportunity_checklist_items',
    'commercial_opportunity_checklist_current',
    'commercial_opportunity_checklist_progress_versions',
    'commercial_opportunity_checklist_progress_items',
    'commercial_opportunity_checklist_progress_current'
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
    'public.p9_resolve_qualification_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_quote_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_post_sale_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_technical_visit_progress_internal(uuid,uuid,uuid)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('precondition failed: resolver missing: %s', v_signature);
    end if;
  end loop;

  if pg_catalog.to_regprocedure(
       'public.materialize_commercial_opportunity_checklist_progress_by_system(uuid,uuid,uuid,text)'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: checklist progress materializer already exists';
  end if;
end;
$preflight$;

create function public.materialize_commercial_opportunity_checklist_progress_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_materialization_event_key text
)
returns table (
  current_progress_version_id uuid,
  version_number integer,
  previous_progress_version_id uuid,
  checklist_version_id uuid,
  lifecycle_cycle integer,
  item_count integer,
  projection_state text,
  changed boolean,
  replayed boolean,
  outcome text,
  request_fingerprint text,
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

  v_opportunity public.commercial_opportunities%rowtype;
  v_checklist_current public.commercial_opportunity_checklist_current%rowtype;
  v_checklist_version public.commercial_opportunity_checklist_versions%rowtype;

  v_has_current boolean := false;
  v_history_count integer := 0;
  v_current public.commercial_opportunity_checklist_progress_current%rowtype;
  v_current_version public.commercial_opportunity_checklist_progress_versions%rowtype;
  v_existing public.commercial_opportunity_checklist_progress_versions%rowtype;
  v_new public.commercial_opportunity_checklist_progress_versions%rowtype;
  v_new_version_number integer;
  v_new_previous_id uuid;

  v_item record;
  v_resolution record;
  v_assessment_state text;
  v_progress_state text;
  v_resolver_key text;
  v_resolver_version integer;
  v_authority_fingerprint text;
  v_resolution_basis jsonb;
  v_reason_code text;
  v_fallback_basis jsonb;

  v_items jsonb := '[]'::jsonb;
  v_current_items jsonb := '[]'::jsonb;
  v_existing_items jsonb := '[]'::jsonb;
  v_item_count integer := 0;
  v_conflict_count integer := 0;
  v_needs_resolution_count integer := 0;
  v_projection_state text;

  v_request_payload jsonb;
  v_request_fingerprint text;
  v_recomputed_fingerprint text;
begin
  if v_request_role is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'ZION_CHECKLIST_PROGRESS_MATERIALIZER_NOT_AUTHORIZED';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_PROGRESS_SCOPE_REQUIRED';
  end if;

  if v_event_key is null or pg_catalog.length(v_event_key) > 155 then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_PROGRESS_EVENT_KEY_INVALID';
  end if;

  v_operation_key := 'checklist_progress:v1:' || v_event_key;

  if pg_catalog.length(v_operation_key) > 200 then
    raise exception using
      errcode = '22023',
      message = 'ZION_CHECKLIST_PROGRESS_OPERATION_KEY_INVALID';
  end if;

  -- Serialize with Profile/Checklist/lifecycle writers that lock this exact
  -- opportunity row/scope. No latest/max fallback is used anywhere below.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_store_id::text || ':' || p_commercial_opportunity_id::text,
      0
    )
  );

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'ZION_CHECKLIST_PROGRESS_OPPORTUNITY_SCOPE_INVALID';
  end if;

  select checklist_current.*
  into v_checklist_current
  from public.commercial_opportunity_checklist_current checklist_current
  where checklist_current.organization_id = p_organization_id
    and checklist_current.store_id = p_store_id
    and checklist_current.commercial_opportunity_id = p_commercial_opportunity_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_PROGRESS_CURRENT_CHECKLIST_REQUIRED';
  end if;

  select checklist_version.*
  into v_checklist_version
  from public.commercial_opportunity_checklist_versions checklist_version
  where checklist_version.id = v_checklist_current.current_checklist_version_id
    and checklist_version.organization_id = p_organization_id
    and checklist_version.store_id = p_store_id
    and checklist_version.commercial_opportunity_id = p_commercial_opportunity_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_PROGRESS_CURRENT_CHECKLIST_INVALID';
  end if;

  select progress_current.*
  into v_current
  from public.commercial_opportunity_checklist_progress_current progress_current
  where progress_current.organization_id = p_organization_id
    and progress_current.store_id = p_store_id
    and progress_current.commercial_opportunity_id = p_commercial_opportunity_id
  for update;

  v_has_current := found;

  select pg_catalog.count(*)::integer
  into v_history_count
  from public.commercial_opportunity_checklist_progress_versions version_row
  where version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id
    and version_row.commercial_opportunity_id = p_commercial_opportunity_id;

  if not v_has_current and v_history_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_PROGRESS_CURRENT_MISSING_WITH_HISTORY';
  end if;

  if v_has_current then
    select version_row.*
    into v_current_version
    from public.commercial_opportunity_checklist_progress_versions version_row
    where version_row.id = v_current.current_progress_version_id
      and version_row.organization_id = p_organization_id
      and version_row.store_id = p_store_id
      and version_row.commercial_opportunity_id = p_commercial_opportunity_id;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_CHECKLIST_PROGRESS_CURRENT_VERSION_INVALID';
    end if;

    if v_current_version.source_type <> 'opportunity_checklist_progress_materializer'
       or v_current_version.created_by <> 'p9_progress_materializer_v1' then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_CHECKLIST_PROGRESS_CURRENT_AUTHORITY_NOT_OWNED';
    end if;
  end if;

  -- Resolve replay before reading domain authorities again. Old events retain
  -- their original immutable interpretation and never move current if stale.
  select version_row.*
  into v_existing
  from public.commercial_opportunity_checklist_progress_versions version_row
  where version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id
    and version_row.commercial_opportunity_id = p_commercial_opportunity_id
    and version_row.operation_key = v_operation_key;

  if found then
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'checklist_item_id', progress_item.checklist_item_id,
          'item_key', checklist_item.item_key,
          'applicability_state', checklist_item.applicability_state,
          'assessment_state', progress_item.assessment_state,
          'progress_state', progress_item.progress_state,
          'resolver_key', progress_item.resolver_key,
          'resolver_version', progress_item.resolver_version,
          'authority_fingerprint', progress_item.authority_fingerprint,
          'resolution_basis', progress_item.resolution_basis,
          'reason_code', progress_item.reason_code,
          'metadata', progress_item.metadata
        )
        order by checklist_item.item_key, progress_item.checklist_item_id
      ),
      '[]'::jsonb
    )
    into v_existing_items
    from public.commercial_opportunity_checklist_progress_items progress_item
    join public.commercial_opportunity_checklist_items checklist_item
      on checklist_item.id = progress_item.checklist_item_id
     and checklist_item.organization_id = progress_item.organization_id
     and checklist_item.store_id = progress_item.store_id
     and checklist_item.commercial_opportunity_id = progress_item.commercial_opportunity_id
     and checklist_item.checklist_version_id = progress_item.checklist_version_id
    where progress_item.organization_id = p_organization_id
      and progress_item.store_id = p_store_id
      and progress_item.commercial_opportunity_id = p_commercial_opportunity_id
      and progress_item.progress_version_id = v_existing.id;

    v_recomputed_fingerprint := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.jsonb_build_object(
            'materializer_version', 1,
            'checklist_version_id', v_existing.checklist_version_id,
            'lifecycle_cycle', v_existing.lifecycle_cycle,
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
        message = 'ZION_CHECKLIST_PROGRESS_STORED_REQUEST_FINGERPRINT_MISMATCH';
    end if;

    return query
    select
      v_existing.id,
      v_existing.version_number,
      v_existing.previous_progress_version_id,
      v_existing.checklist_version_id,
      v_existing.lifecycle_cycle,
      pg_catalog.jsonb_array_length(v_existing_items),
      v_existing.projection_state,
      false,
      true,
      case
        when v_has_current and v_current.current_progress_version_id = v_existing.id
          then 'idempotent_replay_current'
        else 'idempotent_replay_stale'
      end,
      v_existing.request_fingerprint,
      v_existing.source_type,
      v_existing.created_by,
      case when v_has_current then v_current.updated_at else null::timestamptz end;
    return;
  end if;

  -- Resolve every concretely applicable checklist item. The four canonical V1
  -- resolvers own their domains. Every other item is represented explicitly as
  -- unavailable authority and therefore fails closed as needs_resolution/NULL.
  for v_item in
    select checklist_item.*
    from public.commercial_opportunity_checklist_items checklist_item
    where checklist_item.organization_id = p_organization_id
      and checklist_item.store_id = p_store_id
      and checklist_item.commercial_opportunity_id = p_commercial_opportunity_id
      and checklist_item.checklist_version_id = v_checklist_version.id
      and checklist_item.applicability_state in ('required', 'optional')
    order by checklist_item.item_key, checklist_item.id
  loop
    v_assessment_state := null;
    v_progress_state := null;
    v_resolver_key := null;
    v_resolver_version := null;
    v_authority_fingerprint := null;
    v_resolution_basis := null;
    v_reason_code := null;

    if v_item.item_key = 'qualification' then
      select * into v_resolution
      from public.p9_resolve_qualification_progress_internal(
        p_organization_id, p_store_id, p_commercial_opportunity_id
      );

      if not found then
        raise exception using errcode = 'P0001', message = 'ZION_CHECKLIST_PROGRESS_QUALIFICATION_RESOLVER_EMPTY';
      end if;

      v_assessment_state := v_resolution.assessment_state;
      v_progress_state := v_resolution.progress_state;
      v_resolver_key := v_resolution.resolver_key;
      v_resolver_version := v_resolution.resolver_version;
      v_authority_fingerprint := v_resolution.authority_fingerprint;
      v_resolution_basis := v_resolution.resolution_basis;
      v_reason_code := v_resolution.reason_code;

    elsif v_item.item_key = 'quote' then
      select * into v_resolution
      from public.p9_resolve_quote_progress_internal(
        p_organization_id, p_store_id, p_commercial_opportunity_id
      );

      if not found then
        raise exception using errcode = 'P0001', message = 'ZION_CHECKLIST_PROGRESS_QUOTE_RESOLVER_EMPTY';
      end if;

      v_assessment_state := v_resolution.assessment_state;
      v_progress_state := v_resolution.progress_state;
      v_resolver_key := v_resolution.resolver_key;
      v_resolver_version := v_resolution.resolver_version;
      v_authority_fingerprint := v_resolution.authority_fingerprint;
      v_resolution_basis := v_resolution.resolution_basis;
      v_reason_code := v_resolution.reason_code;

    elsif v_item.item_key = 'post_sale' then
      select * into v_resolution
      from public.p9_resolve_post_sale_progress_internal(
        p_organization_id, p_store_id, p_commercial_opportunity_id
      );

      if not found then
        raise exception using errcode = 'P0001', message = 'ZION_CHECKLIST_PROGRESS_POST_SALE_RESOLVER_EMPTY';
      end if;

      v_assessment_state := v_resolution.assessment_state;
      v_progress_state := v_resolution.progress_state;
      v_resolver_key := v_resolution.resolver_key;
      v_resolver_version := v_resolution.resolver_version;
      v_authority_fingerprint := v_resolution.authority_fingerprint;
      v_resolution_basis := v_resolution.resolution_basis;
      v_reason_code := v_resolution.reason_code;

    elsif v_item.item_key = 'technical_visit' then
      select * into v_resolution
      from public.p9_resolve_technical_visit_progress_internal(
        p_organization_id, p_store_id, p_commercial_opportunity_id
      );

      if not found then
        raise exception using errcode = 'P0001', message = 'ZION_CHECKLIST_PROGRESS_TECHNICAL_VISIT_RESOLVER_EMPTY';
      end if;

      v_assessment_state := v_resolution.assessment_state;
      v_progress_state := v_resolution.progress_state;
      v_resolver_key := v_resolution.resolver_key;
      v_resolver_version := v_resolution.resolver_version;
      v_authority_fingerprint := v_resolution.authority_fingerprint;
      v_resolution_basis := v_resolution.resolution_basis;
      v_reason_code := v_resolution.reason_code;

    else
      v_fallback_basis := pg_catalog.jsonb_build_object(
        'authority', 'canonical_progress_authority_unavailable',
        'materializer_version', 1,
        'item_key', v_item.item_key,
        'item_kind', v_item.item_kind,
        'checklist_item_id', v_item.id,
        'checklist_version_id', v_checklist_version.id,
        'lifecycle_cycle', v_opportunity.lifecycle_cycle,
        'applicability_state', v_item.applicability_state
      );

      v_assessment_state := 'needs_resolution';
      v_progress_state := null;
      v_resolver_key := v_item.item_key || ':unavailable';
      v_resolver_version := 1;
      v_authority_fingerprint := pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(v_fallback_basis::text, 'UTF8'),
          'sha256'
        ),
        'hex'
      );
      v_resolution_basis := v_fallback_basis;
      v_reason_code := 'canonical_progress_authority_unavailable';
    end if;

    if v_assessment_state not in ('determined', 'needs_resolution', 'conflict')
       or (
         v_assessment_state = 'determined'
         and v_progress_state not in ('not_started', 'in_progress', 'completed')
       )
       or (
         v_assessment_state in ('needs_resolution', 'conflict')
         and v_progress_state is not null
       )
       or v_resolver_key is null
       or v_resolver_key <> pg_catalog.btrim(v_resolver_key)
       or pg_catalog.length(v_resolver_key) not between 3 and 160
       or v_resolver_key !~ '^[a-z0-9_:.\/-]+$'
       or v_resolver_version is null
       or v_resolver_version < 1
       or v_authority_fingerprint is null
       or pg_catalog.length(v_authority_fingerprint) <> 64
       or v_authority_fingerprint !~ '^[0-9a-f]{64}$'
       or pg_catalog.jsonb_typeof(v_resolution_basis) is distinct from 'object'
       or v_resolution_basis = '{}'::jsonb
       or v_reason_code is null
       or v_reason_code <> pg_catalog.btrim(v_reason_code)
       or pg_catalog.length(v_reason_code) not between 3 and 120
       or v_reason_code !~ '^[a-z0-9_:.\/-]+$' then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_CHECKLIST_PROGRESS_RESOLVER_CONTRACT_INVALID:' || v_item.item_key;
    end if;

    if v_item.item_key in ('qualification', 'quote', 'post_sale', 'technical_visit')
       and v_resolver_key is distinct from v_item.item_key then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_CHECKLIST_PROGRESS_RESOLVER_KEY_MISMATCH:' || v_item.item_key;
    end if;

    v_items := v_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'checklist_item_id', v_item.id,
        'item_key', v_item.item_key,
        'applicability_state', v_item.applicability_state,
        'assessment_state', v_assessment_state,
        'progress_state', v_progress_state,
        'resolver_key', v_resolver_key,
        'resolver_version', v_resolver_version,
        'authority_fingerprint', v_authority_fingerprint,
        'resolution_basis', v_resolution_basis,
        'reason_code', v_reason_code,
        'metadata', pg_catalog.jsonb_build_object('materializer_version', 1)
      )
    );
  end loop;

  select coalesce(
    pg_catalog.jsonb_agg(item_row.value order by item_row.value ->> 'item_key', item_row.value ->> 'checklist_item_id'),
    '[]'::jsonb
  )
  into v_items
  from pg_catalog.jsonb_array_elements(v_items) item_row(value);

  v_item_count := pg_catalog.jsonb_array_length(v_items);

  select
    (pg_catalog.count(*) filter (where item_row.value ->> 'assessment_state' = 'conflict'))::integer,
    (pg_catalog.count(*) filter (where item_row.value ->> 'assessment_state' = 'needs_resolution'))::integer
  into v_conflict_count, v_needs_resolution_count
  from pg_catalog.jsonb_array_elements(v_items) item_row(value);

  v_projection_state :=
    case
      when v_conflict_count > 0 then 'conflict'
      when v_needs_resolution_count > 0 then 'needs_resolution'
      else 'determined'
    end;

  v_request_payload := pg_catalog.jsonb_build_object(
    'materializer_version', 1,
    'checklist_version_id', v_checklist_version.id,
    'lifecycle_cycle', v_opportunity.lifecycle_cycle,
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
          'checklist_item_id', progress_item.checklist_item_id,
          'item_key', checklist_item.item_key,
          'applicability_state', checklist_item.applicability_state,
          'assessment_state', progress_item.assessment_state,
          'progress_state', progress_item.progress_state,
          'resolver_key', progress_item.resolver_key,
          'resolver_version', progress_item.resolver_version,
          'authority_fingerprint', progress_item.authority_fingerprint,
          'resolution_basis', progress_item.resolution_basis,
          'reason_code', progress_item.reason_code,
          'metadata', progress_item.metadata
        )
        order by checklist_item.item_key, progress_item.checklist_item_id
      ),
      '[]'::jsonb
    )
    into v_current_items
    from public.commercial_opportunity_checklist_progress_items progress_item
    join public.commercial_opportunity_checklist_items checklist_item
      on checklist_item.id = progress_item.checklist_item_id
     and checklist_item.organization_id = progress_item.organization_id
     and checklist_item.store_id = progress_item.store_id
     and checklist_item.commercial_opportunity_id = progress_item.commercial_opportunity_id
     and checklist_item.checklist_version_id = progress_item.checklist_version_id
    where progress_item.organization_id = p_organization_id
      and progress_item.store_id = p_store_id
      and progress_item.commercial_opportunity_id = p_commercial_opportunity_id
      and progress_item.progress_version_id = v_current_version.id;

    if v_current_version.request_fingerprint = v_request_fingerprint then
      if v_current_version.checklist_version_id is distinct from v_checklist_version.id
         or v_current_version.lifecycle_cycle is distinct from v_opportunity.lifecycle_cycle
         or v_current_version.projection_state is distinct from v_projection_state
         or v_current_items is distinct from v_items then
        raise exception using
          errcode = 'P0001',
          message = 'ZION_CHECKLIST_PROGRESS_FINGERPRINT_PAYLOAD_MISMATCH';
      end if;

      return query
      select
        v_current_version.id,
        v_current_version.version_number,
        v_current_version.previous_progress_version_id,
        v_current_version.checklist_version_id,
        v_current_version.lifecycle_cycle,
        v_item_count,
        v_current_version.projection_state,
        false,
        false,
        'progress_unchanged'::text,
        v_current_version.request_fingerprint,
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

  insert into public.commercial_opportunity_checklist_progress_versions (
    organization_id,
    store_id,
    commercial_opportunity_id,
    version_number,
    previous_progress_version_id,
    checklist_version_id,
    lifecycle_cycle,
    projection_state,
    operation_key,
    request_fingerprint,
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
    v_checklist_version.id,
    v_opportunity.lifecycle_cycle,
    v_projection_state,
    v_operation_key,
    v_request_fingerprint,
    'opportunity_checklist_progress_materializer',
    'progress_materialized_from_current_checklist_and_authorities',
    'p9_progress_materializer_v1',
    pg_catalog.jsonb_build_object(
      'materializer_version', 1,
      'applicability_source', 'current_checklist',
      'unsupported_authority_policy', 'fail_closed_needs_resolution'
    )
  )
  returning * into v_new;

  insert into public.commercial_opportunity_checklist_progress_items (
    organization_id,
    store_id,
    commercial_opportunity_id,
    progress_version_id,
    checklist_version_id,
    checklist_item_id,
    assessment_state,
    progress_state,
    resolver_key,
    resolver_version,
    authority_fingerprint,
    resolution_basis,
    reason_code,
    metadata
  )
  select
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_new.id,
    v_checklist_version.id,
    normalized_item.checklist_item_id,
    normalized_item.assessment_state,
    normalized_item.progress_state,
    normalized_item.resolver_key,
    normalized_item.resolver_version,
    normalized_item.authority_fingerprint,
    normalized_item.resolution_basis,
    normalized_item.reason_code,
    normalized_item.metadata
  from pg_catalog.jsonb_to_recordset(v_items) as normalized_item(
    checklist_item_id uuid,
    item_key text,
    applicability_state text,
    assessment_state text,
    progress_state text,
    resolver_key text,
    resolver_version integer,
    authority_fingerprint text,
    resolution_basis jsonb,
    reason_code text,
    metadata jsonb
  );

  insert into public.commercial_opportunity_checklist_progress_current (
    organization_id,
    store_id,
    commercial_opportunity_id,
    current_progress_version_id,
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
    current_progress_version_id = excluded.current_progress_version_id,
    last_operation_key = excluded.last_operation_key;

  select progress_current.*
  into v_current
  from public.commercial_opportunity_checklist_progress_current progress_current
  where progress_current.organization_id = p_organization_id
    and progress_current.store_id = p_store_id
    and progress_current.commercial_opportunity_id = p_commercial_opportunity_id;

  if not found or v_current.current_progress_version_id is distinct from v_new.id then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CHECKLIST_PROGRESS_CURRENT_NOT_UPDATED';
  end if;

  return query
  select
    v_new.id,
    v_new.version_number,
    v_new.previous_progress_version_id,
    v_new.checklist_version_id,
    v_new.lifecycle_cycle,
    v_item_count,
    v_new.projection_state,
    true,
    false,
    'progress_materialized'::text,
    v_new.request_fingerprint,
    v_new.source_type,
    v_new.created_by,
    v_current.updated_at;
end;
$function$;

alter function public.materialize_commercial_opportunity_checklist_progress_by_system(
  uuid, uuid, uuid, text
) owner to postgres;

revoke all on function public.materialize_commercial_opportunity_checklist_progress_by_system(
  uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;

grant execute on function public.materialize_commercial_opportunity_checklist_progress_by_system(
  uuid, uuid, uuid, text
) to service_role;

comment on function public.materialize_commercial_opportunity_checklist_progress_by_system(
  uuid, uuid, uuid, text
) is
  'Service-role-only P9 Progress/Assessment materializer. Evaluates every required/optional item from the explicit current Checklist using canonical domain resolvers when available and deterministic fail-closed needs_resolution evidence otherwise; writes an immutable complete version before moving explicit current.';

-- ============================================================================
-- Postconditions.
-- ============================================================================

do $postconditions$
declare
  v_function oid := pg_catalog.to_regprocedure(
    'public.materialize_commercial_opportunity_checklist_progress_by_system(uuid,uuid,uuid,text)'
  );
begin
  if v_function is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: checklist progress materializer missing';
  end if;

  if (
    select procedure_row.proowner <> (
      select role_row.oid from pg_catalog.pg_roles role_row where role_row.rolname = 'postgres'
    )
    from pg_catalog.pg_proc procedure_row
    where procedure_row.oid = v_function
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: checklist progress materializer owner mismatch';
  end if;

  if not (
    select procedure_row.prosecdef
    from pg_catalog.pg_proc procedure_row
    where procedure_row.oid = v_function
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: checklist progress materializer must be SECURITY DEFINER';
  end if;

  if pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: checklist progress materializer grants mismatch';
  end if;

  if pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_opportunity_checklist_progress_versions',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_opportunity_checklist_progress_items',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_opportunity_checklist_progress_current',
       'INSERT'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: progress materializer leaked direct table INSERT';
  end if;
end;
$postconditions$;

commit;
