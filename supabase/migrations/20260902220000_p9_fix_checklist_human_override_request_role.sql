begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:fix-checklist-human-override-request-role:v1', 0)
);

-- ============================================================================
-- P9 / Bloco 3 / Etapa 3.5
-- Hotfix: Canonical Human Checklist Override Writer request-role normalization.
--
-- The original writer used pg_catalog.nullif(...). NULLIF is PostgreSQL SQL
-- syntax, not a schema-qualified pg_catalog function, so the function failed at
-- runtime during PL/pgSQL variable initialization. This migration preserves the
-- writer contract and changes only that expression to nullif(...).
-- ============================================================================

do $preflight$
declare
  v_writer oid := pg_catalog.to_regprocedure(
    'public.override_commercial_opportunity_checklist_item_by_user(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)'
  );
begin
  if v_writer is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: checklist human override writer is required before request-role hotfix';
  end if;
end;
$preflight$;

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

  v_item_count integer := 0;
  v_base_derived_state text;
  v_result_state text;
  v_recomputed_settings_fingerprint text;
  v_updated_rows integer := 0;
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
    'override_item_key', v_item_key,
    'override_item_kind', v_item_kind,
    'override_from_applicability_state', v_base_item.applicability_state,
    'override_to_applicability_state', v_to_state,
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
        then item_row.decision_basis || pg_catalog.jsonb_build_object(
          'human_override',
          pg_catalog.jsonb_build_object(
            'operation_key', v_operation_key,
            'actor_user_id', v_user_id,
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
  'Authenticated-human-only P9 checklist applicability override writer. Requires active membership and expected current version, changes exactly one immutable checklist item via a direct-child human version, records append-only audit, rejects manual conflict creation, and resolves replay before stale-current validation.';

revoke all on function public.override_commercial_opportunity_checklist_item_by_user(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.override_commercial_opportunity_checklist_item_by_user(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb
) to authenticated;

do $postconditions$
declare
  v_writer oid := pg_catalog.to_regprocedure(
    'public.override_commercial_opportunity_checklist_item_by_user(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)'
  );
  v_definition text;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
begin
  if v_writer is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: checklist human override writer is missing after request-role hotfix';
  end if;

  select pg_catalog.pg_get_functiondef(v_writer)
  into v_definition;

  if pg_catalog.strpos(v_definition, 'pg_catalog.nullif') > 0
     or pg_catalog.strpos(v_definition, 'current_setting(''request.jwt.claim.role'', true)') = 0
     or pg_catalog.strpos(v_definition, 'auth.uid()') = 0
     or pg_catalog.strpos(v_definition, 'ZION_CHECKLIST_OVERRIDE_STALE_CURRENT') = 0
     or pg_catalog.strpos(v_definition, 'idempotent_replay_current') = 0
     or pg_catalog.strpos(v_definition, 'ZION_CHECKLIST_OVERRIDE_TARGET_STATE_INVALID') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: checklist human override request-role hotfix contract mismatch';
  end if;

  if pg_catalog.has_function_privilege('anon', v_writer, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_writer, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_writer, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: checklist human override writer grants mismatch after hotfix';
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
      message = 'postcondition failed: checklist human override writer hardening mismatch after hotfix';
  end if;
end;
$postconditions$;

commit;
