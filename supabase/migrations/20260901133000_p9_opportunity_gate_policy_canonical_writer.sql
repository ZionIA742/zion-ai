begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local idle_in_transaction_session_timeout = '120s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:gate-policy-canonical-writer:v1', 0)
);

-- ============================================================================
-- P9 3.5 - Canonical Store Opportunity Gate Policy Writer
--
-- Contract:
-- - policy versions/rules remain append-only;
-- - current is the only live authority;
-- - no latest/max(version_number) fallback;
-- - one store-scoped advisory lock serializes version creation/current movement;
-- - operation_key replay is idempotent and never regresses current;
-- - same operation_key with a different fingerprint/payload fails closed;
-- - only an authenticated active member may call the public writer;
-- - no service_role/system writer is exposed in this migration;
-- - bootstrap/migrations may call the internal writer only while executing as
--   the postgres owner, without granting EXECUTE to runtime roles.
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
    'store_opportunity_gate_policy_versions',
    'store_opportunity_gate_policy_rules',
    'store_opportunity_gate_policy_current'
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
    'public.write_store_opportunity_gate_policy_internal(uuid,uuid,text,text,jsonb,text,uuid,text,text,text,jsonb)',
    'public.write_store_opportunity_gate_policy_by_user(uuid,uuid,text,text,jsonb,text,jsonb)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is not null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('gate policy writer collision detected: %s', v_signature);
    end if;
  end loop;
end;
$preflight$;

create or replace function public.write_store_opportunity_gate_policy_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_operation_key text,
  p_request_fingerprint text,
  p_rules jsonb,
  p_actor_type text,
  p_actor_user_id uuid,
  p_source_type text,
  p_reason_code text,
  p_created_by text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  policy_version_id uuid,
  version_number integer,
  previous_policy_version_id uuid,
  rule_count integer,
  current_policy_version_id uuid,
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
  v_actor_type text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_actor_type, '')), ''));
  v_source_type text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_source_type, '')), ''));
  v_reason_code text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_reason_code, '')), ''));
  v_created_by text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_created_by, '')), ''));
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_rule jsonb;
  v_rule_metadata jsonb;
  v_rule_key text;
  v_item_kind text;
  v_item_key text;
  v_match_mode text;
  v_component_kind text;
  v_execution_kind text;
  v_applicability_state text;
  v_rule_reason_code text;
  v_priority_text text;
  v_rule_priority integer;
  v_normalized_rules jsonb := '[]'::jsonb;
  v_existing_rules jsonb := '[]'::jsonb;
  v_rule_total integer;
  v_rule_unique integer;
  v_history_count integer;
  v_has_current boolean := false;
  v_current public.store_opportunity_gate_policy_current%rowtype;
  v_current_version public.store_opportunity_gate_policy_versions%rowtype;
  v_existing public.store_opportunity_gate_policy_versions%rowtype;
  v_new public.store_opportunity_gate_policy_versions%rowtype;
  v_new_version_number integer;
  v_new_previous_id uuid;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_GATE_POLICY_SCOPE_REQUIRED';
  end if;

  if v_operation_key is null or pg_catalog.length(v_operation_key) > 200 then
    raise exception using
      errcode = '22023',
      message = 'ZION_GATE_POLICY_OPERATION_KEY_INVALID';
  end if;

  if v_request_fingerprint is null
     or pg_catalog.length(v_request_fingerprint) <> 64
     or v_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'ZION_GATE_POLICY_REQUEST_FINGERPRINT_INVALID';
  end if;

  if v_actor_type not in ('human', 'system')
     or (v_actor_type = 'human' and p_actor_user_id is null)
     or (v_actor_type = 'system' and p_actor_user_id is not null) then
    raise exception using
      errcode = '22023',
      message = 'ZION_GATE_POLICY_ACTOR_INVALID';
  end if;

  if v_source_type is null
     or pg_catalog.length(v_source_type) not between 3 and 120
     or v_source_type !~ '^[a-z0-9_:.\/-]+$' then
    raise exception using
      errcode = '22023',
      message = 'ZION_GATE_POLICY_SOURCE_TYPE_INVALID';
  end if;

  if v_reason_code is null
     or pg_catalog.length(v_reason_code) not between 3 and 120
     or v_reason_code !~ '^[a-z0-9_:.\/-]+$' then
    raise exception using
      errcode = '22023',
      message = 'ZION_GATE_POLICY_REASON_CODE_INVALID';
  end if;

  if v_created_by is null
     or pg_catalog.length(v_created_by) not between 3 and 120
     or v_created_by !~ '^[a-z0-9_:.\/-]+$' then
    raise exception using
      errcode = '22023',
      message = 'ZION_GATE_POLICY_CREATED_BY_INVALID';
  end if;

  if pg_catalog.jsonb_typeof(v_metadata) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'ZION_GATE_POLICY_METADATA_INVALID';
  end if;

  if p_rules is null
     or pg_catalog.jsonb_typeof(p_rules) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_rules) = 0 then
    raise exception using
      errcode = '22023',
      message = 'ZION_GATE_POLICY_RULES_REQUIRED';
  end if;

  for v_rule in
    select rule_row.value
    from pg_catalog.jsonb_array_elements(p_rules) rule_row(value)
  loop
    if pg_catalog.jsonb_typeof(v_rule) is distinct from 'object' then
      raise exception using
        errcode = '22023',
        message = 'ZION_GATE_POLICY_RULE_OBJECT_REQUIRED';
    end if;

    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_rule) key_row(key_name)
      where key_row.key_name not in (
        'rule_key',
        'rule_priority',
        'item_kind',
        'item_key',
        'match_mode',
        'component_kind',
        'execution_kind',
        'applicability_state',
        'reason_code',
        'metadata'
      )
    ) then
      raise exception using
        errcode = '22023',
        message = 'ZION_GATE_POLICY_RULE_UNKNOWN_FIELD';
    end if;

    v_rule_key := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_rule ->> 'rule_key', '')), ''));
    v_item_kind := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_rule ->> 'item_kind', '')), ''));
    v_item_key := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_rule ->> 'item_key', '')), ''));
    v_match_mode := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_rule ->> 'match_mode', '')), ''));
    v_component_kind := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_rule ->> 'component_kind', '')), ''));
    v_execution_kind := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_rule ->> 'execution_kind', '')), ''));
    v_applicability_state := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_rule ->> 'applicability_state', '')), ''));
    v_rule_reason_code := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_rule ->> 'reason_code', '')), ''));
    v_rule_metadata := coalesce(v_rule -> 'metadata', '{}'::jsonb);
    v_priority_text := coalesce(v_rule ->> 'rule_priority', '0');

    if v_rule_key is null
       or pg_catalog.length(v_rule_key) > 160
       or v_rule_key !~ '^[a-z0-9_:.\/-]+$' then
      raise exception using errcode = '22023', message = 'ZION_GATE_POLICY_RULE_KEY_INVALID';
    end if;

    if v_priority_text !~ '^[0-9]+$' or pg_catalog.length(v_priority_text) > 9 then
      raise exception using errcode = '22023', message = 'ZION_GATE_POLICY_RULE_PRIORITY_INVALID';
    end if;

    v_rule_priority := v_priority_text::integer;

    if v_item_kind not in ('commercial_gate', 'technical_requirement') then
      raise exception using errcode = '22023', message = 'ZION_GATE_POLICY_RULE_ITEM_KIND_INVALID';
    end if;

    if v_item_key is null
       or pg_catalog.length(v_item_key) > 160
       or v_item_key !~ '^[a-z0-9_:.\/-]+$' then
      raise exception using errcode = '22023', message = 'ZION_GATE_POLICY_RULE_ITEM_KEY_INVALID';
    end if;

    if v_match_mode not in ('always', 'component', 'execution', 'component_and_execution') then
      raise exception using errcode = '22023', message = 'ZION_GATE_POLICY_RULE_MATCH_MODE_INVALID';
    end if;

    if v_component_kind is not null
       and v_component_kind not in ('pool', 'catalog_item', 'service', 'custom') then
      raise exception using errcode = '22023', message = 'ZION_GATE_POLICY_RULE_COMPONENT_KIND_INVALID';
    end if;

    if v_execution_kind is not null
       and v_execution_kind not in ('installation', 'delivery', 'pickup', 'service_execution') then
      raise exception using errcode = '22023', message = 'ZION_GATE_POLICY_RULE_EXECUTION_KIND_INVALID';
    end if;

    if not (
      (v_match_mode = 'always' and v_component_kind is null and v_execution_kind is null)
      or (v_match_mode = 'component' and v_component_kind is not null and v_execution_kind is null)
      or (v_match_mode = 'execution' and v_component_kind is null and v_execution_kind is not null)
      or (
        v_match_mode = 'component_and_execution'
        and v_component_kind is not null
        and v_execution_kind is not null
      )
    ) then
      raise exception using errcode = '22023', message = 'ZION_GATE_POLICY_RULE_MATCH_SHAPE_INVALID';
    end if;

    if v_applicability_state not in ('required', 'optional', 'not_applicable', 'needs_resolution') then
      raise exception using errcode = '22023', message = 'ZION_GATE_POLICY_RULE_APPLICABILITY_INVALID';
    end if;

    if v_rule_reason_code is null
       or pg_catalog.length(v_rule_reason_code) not between 3 and 120
       or v_rule_reason_code !~ '^[a-z0-9_:.\/-]+$' then
      raise exception using errcode = '22023', message = 'ZION_GATE_POLICY_RULE_REASON_CODE_INVALID';
    end if;

    if pg_catalog.jsonb_typeof(v_rule_metadata) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'ZION_GATE_POLICY_RULE_METADATA_INVALID';
    end if;

    v_normalized_rules := v_normalized_rules || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'rule_key', v_rule_key,
        'rule_priority', v_rule_priority,
        'item_kind', v_item_kind,
        'item_key', v_item_key,
        'match_mode', v_match_mode,
        'component_kind', v_component_kind,
        'execution_kind', v_execution_kind,
        'applicability_state', v_applicability_state,
        'reason_code', v_rule_reason_code,
        'metadata', v_rule_metadata
      )
    );
  end loop;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(distinct rule_row.value ->> 'rule_key')::integer
  into v_rule_total, v_rule_unique
  from pg_catalog.jsonb_array_elements(v_normalized_rules) rule_row(value);

  if v_rule_total <> v_rule_unique then
    raise exception using
      errcode = '22023',
      message = 'ZION_GATE_POLICY_DUPLICATE_RULE_KEY';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      rule_row.value
      order by
        (rule_row.value ->> 'rule_priority')::integer desc,
        rule_row.value ->> 'rule_key'
    ),
    '[]'::jsonb
  )
  into v_normalized_rules
  from pg_catalog.jsonb_array_elements(v_normalized_rules) rule_row(value);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:gate-policy-writer:v1:' || p_organization_id::text || ':' || p_store_id::text,
      0
    )
  );

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for key share;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'ZION_GATE_POLICY_STORE_SCOPE_INVALID';
  end if;

  select current_row.*
  into v_current
  from public.store_opportunity_gate_policy_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
  for update;

  v_has_current := found;

  select pg_catalog.count(*)::integer
  into v_history_count
  from public.store_opportunity_gate_policy_versions version_row
  where version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id;

  if not v_has_current and v_history_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_GATE_POLICY_CURRENT_MISSING_WITH_HISTORY';
  end if;

  if v_has_current then
    select version_row.*
    into v_current_version
    from public.store_opportunity_gate_policy_versions version_row
    where version_row.id = v_current.current_policy_version_id
      and version_row.organization_id = p_organization_id
      and version_row.store_id = p_store_id;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_GATE_POLICY_CURRENT_VERSION_INVALID';
    end if;
  end if;

  select version_row.*
  into v_existing
  from public.store_opportunity_gate_policy_versions version_row
  where version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id
    and version_row.operation_key = v_operation_key;

  if found then
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'rule_key', rule_row.rule_key,
          'rule_priority', rule_row.rule_priority,
          'item_kind', rule_row.item_kind,
          'item_key', rule_row.item_key,
          'match_mode', rule_row.match_mode,
          'component_kind', rule_row.component_kind,
          'execution_kind', rule_row.execution_kind,
          'applicability_state', rule_row.applicability_state,
          'reason_code', rule_row.reason_code,
          'metadata', rule_row.metadata
        )
        order by rule_row.rule_priority desc, rule_row.rule_key
      ),
      '[]'::jsonb
    )
    into v_existing_rules
    from public.store_opportunity_gate_policy_rules rule_row
    where rule_row.organization_id = p_organization_id
      and rule_row.store_id = p_store_id
      and rule_row.policy_version_id = v_existing.id;

    if v_existing.request_fingerprint is distinct from v_request_fingerprint
       or v_existing.actor_type is distinct from v_actor_type
       or v_existing.actor_user_id is distinct from p_actor_user_id
       or v_existing.source_type is distinct from v_source_type
       or v_existing.reason_code is distinct from v_reason_code
       or v_existing.created_by is distinct from v_created_by
       or v_existing.metadata is distinct from v_metadata
       or v_existing_rules is distinct from v_normalized_rules then
      raise exception using
        errcode = '23505',
        message = 'ZION_GATE_POLICY_IDEMPOTENCY_KEY_REUSED';
    end if;

    return query
    select
      v_existing.id,
      v_existing.version_number,
      v_existing.previous_policy_version_id,
      v_rule_total,
      v_current.current_policy_version_id,
      false,
      true,
      case
        when v_current.current_policy_version_id = v_existing.id
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

  insert into public.store_opportunity_gate_policy_versions (
    organization_id,
    store_id,
    version_number,
    previous_policy_version_id,
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
    v_new_version_number,
    v_new_previous_id,
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

  insert into public.store_opportunity_gate_policy_rules (
    organization_id,
    store_id,
    policy_version_id,
    rule_key,
    rule_priority,
    item_kind,
    item_key,
    match_mode,
    component_kind,
    execution_kind,
    applicability_state,
    reason_code,
    metadata
  )
  select
    p_organization_id,
    p_store_id,
    v_new.id,
    normalized_rule.rule_key,
    normalized_rule.rule_priority,
    normalized_rule.item_kind,
    normalized_rule.item_key,
    normalized_rule.match_mode,
    normalized_rule.component_kind,
    normalized_rule.execution_kind,
    normalized_rule.applicability_state,
    normalized_rule.reason_code,
    normalized_rule.metadata
  from pg_catalog.jsonb_to_recordset(v_normalized_rules) as normalized_rule(
    rule_key text,
    rule_priority integer,
    item_kind text,
    item_key text,
    match_mode text,
    component_kind text,
    execution_kind text,
    applicability_state text,
    reason_code text,
    metadata jsonb
  );

  insert into public.store_opportunity_gate_policy_current (
    organization_id,
    store_id,
    current_policy_version_id,
    last_operation_key
  )
  values (
    p_organization_id,
    p_store_id,
    v_new.id,
    v_operation_key
  )
  on conflict (organization_id, store_id) do update
  set
    current_policy_version_id = excluded.current_policy_version_id,
    last_operation_key = excluded.last_operation_key;

  select current_row.*
  into v_current
  from public.store_opportunity_gate_policy_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id;

  return query
  select
    v_new.id,
    v_new.version_number,
    v_new.previous_policy_version_id,
    v_rule_total,
    v_current.current_policy_version_id,
    true,
    false,
    'policy_version_created'::text,
    v_new.created_at,
    v_current.updated_at;
end;
$function$;

alter function public.write_store_opportunity_gate_policy_internal(
  uuid, uuid, text, text, jsonb, text, uuid, text, text, text, jsonb
) owner to postgres;

comment on function public.write_store_opportunity_gate_policy_internal(
  uuid, uuid, text, text, jsonb, text, uuid, text, text, text, jsonb
) is
  'Canonical P9 gate-policy writer. Serializes per store, creates append-only policy versions/rules, moves explicit current, and makes operation-key replay idempotent without regressing current.';

revoke all on function public.write_store_opportunity_gate_policy_internal(
  uuid, uuid, text, text, jsonb, text, uuid, text, text, text, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.write_store_opportunity_gate_policy_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_operation_key text,
  p_request_fingerprint text,
  p_rules jsonb,
  p_reason_code text default 'policy_updated_by_user',
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  policy_version_id uuid,
  version_number integer,
  previous_policy_version_id uuid,
  rule_count integer,
  current_policy_version_id uuid,
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
      message = 'ZION_GATE_POLICY_USER_WRITE_NOT_AUTHORIZED';
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
      message = 'ZION_GATE_POLICY_ACTIVE_MEMBERSHIP_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_request_organization_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'ZION_GATE_POLICY_STORE_SCOPE_NOT_AUTHORIZED';
  end if;

  return query
  select *
  from public.write_store_opportunity_gate_policy_internal(
    p_request_organization_id,
    p_store_id,
    p_operation_key,
    p_request_fingerprint,
    p_rules,
    'human',
    v_user_id,
    'settings_ui',
    p_reason_code,
    'user:' || v_user_id::text,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$function$;

alter function public.write_store_opportunity_gate_policy_by_user(
  uuid, uuid, text, text, jsonb, text, jsonb
) owner to postgres;

comment on function public.write_store_opportunity_gate_policy_by_user(
  uuid, uuid, text, text, jsonb, text, jsonb
) is
  'Authenticated-human P9 gate-policy writer. Requires active organization membership and exact store scope. No service-role/system wrapper is exposed.';

revoke all on function public.write_store_opportunity_gate_policy_by_user(
  uuid, uuid, text, text, jsonb, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.write_store_opportunity_gate_policy_by_user(
  uuid, uuid, text, text, jsonb, text, jsonb
) to authenticated;

-- ============================================================================
-- Postconditions.
-- ============================================================================

do $postconditions$
declare
  v_internal oid := pg_catalog.to_regprocedure(
    'public.write_store_opportunity_gate_policy_internal(uuid,uuid,text,text,jsonb,text,uuid,text,text,text,jsonb)'
  );
  v_user oid := pg_catalog.to_regprocedure(
    'public.write_store_opportunity_gate_policy_by_user(uuid,uuid,text,text,jsonb,text,jsonb)'
  );
  v_internal_def text;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
begin
  if v_internal is null or v_user is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: gate policy writer functions are missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.write_store_opportunity_gate_policy_by_system(uuid,uuid,text,text,jsonb,text,jsonb)'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: a system gate-policy writer was exposed unexpectedly';
  end if;

  select pg_catalog.pg_get_functiondef(v_internal)
  into v_internal_def;

  if v_internal_def not like '%pg_advisory_xact_lock%'
     or v_internal_def not like '%for update%'
     or v_internal_def like '%max(version_number)%'
     or v_internal_def like '%order by created_at desc%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: internal gate-policy writer concurrency/current contract mismatch';
  end if;

  select role_row.rolname, proc_row.prosecdef, proc_row.proconfig
  into v_owner, v_security_definer, v_config
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_roles role_row on role_row.oid = proc_row.proowner
  where proc_row.oid = v_internal;

  if v_owner <> 'postgres'
     or not v_security_definer
     or not ('search_path=pg_catalog, pg_temp, public' = any(v_config))
     or not ('row_security=off' = any(v_config)) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: internal gate-policy writer hardening mismatch';
  end if;

  if pg_catalog.has_function_privilege(
       'authenticated',
       'public.write_store_opportunity_gate_policy_internal(uuid,uuid,text,text,jsonb,text,uuid,text,text,text,jsonb)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.write_store_opportunity_gate_policy_internal(uuid,uuid,text,text,jsonb,text,uuid,text,text,text,jsonb)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: internal gate-policy writer is executable by runtime roles';
  end if;

  if not pg_catalog.has_function_privilege(
       'authenticated',
       'public.write_store_opportunity_gate_policy_by_user(uuid,uuid,text,text,jsonb,text,jsonb)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.write_store_opportunity_gate_policy_by_user(uuid,uuid,text,text,jsonb,text,jsonb)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.write_store_opportunity_gate_policy_by_user(uuid,uuid,text,text,jsonb,text,jsonb)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: user gate-policy writer grants mismatch';
  end if;
end;
$postconditions$;

commit;
