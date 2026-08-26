begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:b3:qualification-fact-canonical-reader:v1',
    0
  )
);

-- --------------------------------------------------------------------------
-- Preflight
-- --------------------------------------------------------------------------
do $preflight$
declare
  v_signature text;
begin
  if pg_catalog.to_regclass('public.commercial_opportunity_qualification_fact_events') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_qualification_facts_current') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.memberships') is null then
    raise exception using
      errcode = 'P0001',
      message = 'qualification fact reader prerequisites are missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'memberships'
      and column_row.column_name = 'is_active'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.memberships.is_active is missing';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles role_row where role_row.rolname = 'anon'
  ) or not exists (
    select 1 from pg_catalog.pg_roles role_row where role_row.rolname = 'authenticated'
  ) or not exists (
    select 1 from pg_catalog.pg_roles role_row where role_row.rolname = 'service_role'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'qualification fact reader required roles are missing';
  end if;

  foreach v_signature in array array[
    'public.read_commercial_opportunity_qualification_facts_internal(uuid,uuid,uuid)',
    'public.read_commercial_opportunity_qualification_facts_by_system(uuid,uuid,uuid)',
    'public.read_commercial_opportunity_qualification_facts_by_user(uuid,uuid,uuid)'
  ]
  loop
    if pg_catalog.to_regprocedure(v_signature) is not null then
      raise exception using
        errcode = 'P0001',
        message = format('qualification fact reader collision detected: %s', v_signature);
    end if;
  end loop;
end;
$preflight$;

-- --------------------------------------------------------------------------
-- Canonical internal reader.
--
-- missing_fact_groups intentionally exposes only the five conversational
-- qualification groups already used by the Sales AI as default discovery
-- gaps. Other canonical facts remain available in known_facts but are not
-- silently converted into mandatory questions here.
--
-- can_ask_next_question means only that qualification still has an unresolved
-- core gap or conflict. The caller must still apply patience / response-mode /
-- relevance policy before actually asking a question.
-- --------------------------------------------------------------------------
create or replace function public.read_commercial_opportunity_qualification_facts_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  organization_id uuid,
  store_id uuid,
  commercial_opportunity_id uuid,
  known_facts jsonb,
  missing_fact_groups jsonb,
  conflicts jsonb,
  provenance_summary jsonb,
  can_ask_next_question boolean,
  known_fact_count integer,
  missing_group_count integer,
  conflict_count integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_opportunity public.commercial_opportunities;
  v_known_facts jsonb := '[]'::jsonb;
  v_missing_fact_groups jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_provenance_summary jsonb := '{}'::jsonb;
  v_known_fact_count integer := 0;
  v_missing_group_count integer := 0;
  v_conflict_count integer := 0;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_QFACT_READER_ARGUMENTS_REQUIRED';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'commercial opportunity not found';
  end if;

  if v_opportunity.organization_id is distinct from p_organization_id
     or v_opportunity.store_id is distinct from p_store_id then
    raise exception using
      errcode = '23514',
      message = 'commercial opportunity scope mismatch';
  end if;

  -- Fail closed if the materialized projection no longer matches its last
  -- append-only event. Foundation triggers already prevent this on write; the
  -- reader re-check keeps the read contract safe against later regressions.
  if exists (
    select 1
    from public.commercial_opportunity_qualification_facts_current current_row
    left join public.commercial_opportunity_qualification_fact_events event_row
      on event_row.id = current_row.last_event_id
     and event_row.organization_id = current_row.organization_id
     and event_row.store_id = current_row.store_id
     and event_row.commercial_opportunity_id = current_row.commercial_opportunity_id
     and event_row.fact_key = current_row.fact_key
    where current_row.organization_id = v_opportunity.organization_id
      and current_row.store_id = v_opportunity.store_id
      and current_row.commercial_opportunity_id = v_opportunity.id
      and (
        event_row.id is null
        or current_row.last_operation_key is distinct from event_row.operation_key
        or current_row.value_kind is distinct from event_row.value_kind
        or current_row.source_type is distinct from event_row.source_type
        or current_row.source_message_id is distinct from event_row.source_message_id
        or current_row.source_conversation_id is distinct from event_row.source_conversation_id
        or (
          current_row.current_state = 'inferred'
          and (
            event_row.assertion_level is distinct from 'inferred'
            or event_row.resolves_conflict
            or current_row.value_json is distinct from event_row.value_json
            or current_row.normalized_value_text is distinct from event_row.normalized_value_text
          )
        )
        or (
          current_row.current_state = 'confirmed'
          and (
            event_row.assertion_level is distinct from 'confirmed'
            or current_row.value_json is distinct from event_row.value_json
            or current_row.normalized_value_text is distinct from event_row.normalized_value_text
          )
        )
        or (
          current_row.current_state = 'conflict'
          and (
            event_row.assertion_level is distinct from 'confirmed'
            or event_row.resolves_conflict
          )
        )
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_QFACT_READER_PROJECTION_INCONSISTENT';
  end if;

  with fact_order(fact_key, sort_order) as (
    values
      ('need_summary'::text, 10),
      ('interested_product_reference'::text, 20),
      ('space_text'::text, 30),
      ('requested_area_m2'::text, 40),
      ('location_text'::text, 50),
      ('preferred_period_text'::text, 60),
      ('budget_text'::text, 70),
      ('decision_context'::text, 80),
      ('installation_interest'::text, 90),
      ('payment_interest'::text, 100),
      ('technical_visit_interest'::text, 110),
      ('customer_preferences_text'::text, 120),
      ('relevant_objection_text'::text, 130)
  ), scoped as (
    select current_row.*, fact_order.sort_order
    from public.commercial_opportunity_qualification_facts_current current_row
    join fact_order on fact_order.fact_key = current_row.fact_key
    where current_row.organization_id = v_opportunity.organization_id
      and current_row.store_id = v_opportunity.store_id
      and current_row.commercial_opportunity_id = v_opportunity.id
  )
  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'factKey', scoped.fact_key,
          'state', scoped.current_state,
          'valueKind', scoped.value_kind,
          'value', scoped.value_json,
          'normalizedValueText', scoped.normalized_value_text,
          'sourceType', scoped.source_type,
          'sourceMessageId', scoped.source_message_id,
          'sourceConversationId', scoped.source_conversation_id,
          'lastEventId', scoped.last_event_id,
          'lastOperationKey', scoped.last_operation_key,
          'updatedAt', scoped.updated_at
        )
        order by scoped.sort_order
      ) filter (where scoped.current_state in ('inferred', 'confirmed')),
      '[]'::jsonb
    ),
    count(*) filter (where scoped.current_state in ('inferred', 'confirmed'))::integer
  into v_known_facts, v_known_fact_count
  from scoped;

  with fact_order(fact_key, sort_order) as (
    values
      ('need_summary'::text, 10),
      ('interested_product_reference'::text, 20),
      ('space_text'::text, 30),
      ('requested_area_m2'::text, 40),
      ('location_text'::text, 50),
      ('preferred_period_text'::text, 60),
      ('budget_text'::text, 70),
      ('decision_context'::text, 80),
      ('installation_interest'::text, 90),
      ('payment_interest'::text, 100),
      ('technical_visit_interest'::text, 110),
      ('customer_preferences_text'::text, 120),
      ('relevant_objection_text'::text, 130)
  ), scoped as (
    select current_row.*, fact_order.sort_order
    from public.commercial_opportunity_qualification_facts_current current_row
    join fact_order on fact_order.fact_key = current_row.fact_key
    where current_row.organization_id = v_opportunity.organization_id
      and current_row.store_id = v_opportunity.store_id
      and current_row.commercial_opportunity_id = v_opportunity.id
  )
  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'factKey', scoped.fact_key,
          'valueKind', scoped.value_kind,
          'candidates', scoped.conflict_values_json,
          'sourceType', scoped.source_type,
          'sourceMessageId', scoped.source_message_id,
          'sourceConversationId', scoped.source_conversation_id,
          'lastEventId', scoped.last_event_id,
          'lastOperationKey', scoped.last_operation_key,
          'updatedAt', scoped.updated_at
        )
        order by scoped.sort_order
      ) filter (where scoped.current_state = 'conflict'),
      '[]'::jsonb
    ),
    count(*) filter (where scoped.current_state = 'conflict')::integer
  into v_conflicts, v_conflict_count
  from scoped;

  with group_defs(group_key, sort_order, fact_keys) as (
    values
      ('need'::text, 10, array['need_summary','interested_product_reference','customer_preferences_text']::text[]),
      ('space'::text, 20, array['space_text','requested_area_m2']::text[]),
      ('location'::text, 30, array['location_text']::text[]),
      ('installation'::text, 40, array['installation_interest']::text[]),
      ('payment'::text, 50, array['payment_interest']::text[])
  ), missing_groups as (
    select
      group_defs.group_key,
      group_defs.sort_order,
      group_defs.fact_keys,
      exists (
        select 1
        from public.commercial_opportunity_qualification_facts_current conflict_row
        where conflict_row.organization_id = v_opportunity.organization_id
          and conflict_row.store_id = v_opportunity.store_id
          and conflict_row.commercial_opportunity_id = v_opportunity.id
          and conflict_row.fact_key = any(group_defs.fact_keys)
          and conflict_row.current_state = 'conflict'
      ) as has_conflict
    from group_defs
    where not exists (
      select 1
      from public.commercial_opportunity_qualification_facts_current known_row
      where known_row.organization_id = v_opportunity.organization_id
        and known_row.store_id = v_opportunity.store_id
        and known_row.commercial_opportunity_id = v_opportunity.id
        and known_row.fact_key = any(group_defs.fact_keys)
        and known_row.current_state in ('inferred', 'confirmed')
    )
  )
  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'groupKey', missing_groups.group_key,
          'status', case when missing_groups.has_conflict then 'conflict' else 'missing' end,
          'factKeys', to_jsonb(missing_groups.fact_keys)
        )
        order by missing_groups.sort_order
      ),
      '[]'::jsonb
    ),
    count(*)::integer
  into v_missing_fact_groups, v_missing_group_count
  from missing_groups;

  with scoped as (
    select current_row.*
    from public.commercial_opportunity_qualification_facts_current current_row
    where current_row.organization_id = v_opportunity.organization_id
      and current_row.store_id = v_opportunity.store_id
      and current_row.commercial_opportunity_id = v_opportunity.id
  ), source_counts as (
    select
      scoped.source_type,
      count(*)::integer as item_count
    from scoped
    group by scoped.source_type
  )
  select pg_catalog.jsonb_build_object(
    'knownFactCount', v_known_fact_count,
    'confirmedCount', count(*) filter (where scoped.current_state = 'confirmed'),
    'inferredCount', count(*) filter (where scoped.current_state = 'inferred'),
    'conflictCount', v_conflict_count,
    'messageBackedCount', count(*) filter (where scoped.source_message_id is not null),
    'conversationBackedCount', count(*) filter (where scoped.source_conversation_id is not null),
    'sourceCounts', coalesce(
      (
        select pg_catalog.jsonb_object_agg(source_counts.source_type, source_counts.item_count)
        from source_counts
      ),
      '{}'::jsonb
    )
  )
  into v_provenance_summary
  from scoped;

  return query
  select
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id,
    v_known_facts,
    v_missing_fact_groups,
    v_conflicts,
    v_provenance_summary,
    (v_missing_group_count > 0 or v_conflict_count > 0),
    v_known_fact_count,
    v_missing_group_count,
    v_conflict_count;
end;
$function$;

alter function public.read_commercial_opportunity_qualification_facts_internal(
  uuid, uuid, uuid
) owner to postgres;

comment on function public.read_commercial_opportunity_qualification_facts_internal(
  uuid, uuid, uuid
) is
  'Reader canonico interno de qualification facts por opportunity explicita. Retorna fatos conhecidos, gaps conversacionais centrais, conflitos e resumo de proveniencia; nunca resolve opportunity por recencia.';

revoke all on function public.read_commercial_opportunity_qualification_facts_internal(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- Server-only wrapper used by Sales AI/runtime.
-- --------------------------------------------------------------------------
create or replace function public.read_commercial_opportunity_qualification_facts_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  organization_id uuid,
  store_id uuid,
  commercial_opportunity_id uuid,
  known_facts jsonb,
  missing_fact_groups jsonb,
  conflicts jsonb,
  provenance_summary jsonb,
  can_ask_next_question boolean,
  known_fact_count integer,
  missing_group_count integer,
  conflict_count integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'qualification fact read by system is not authorized';
  end if;

  return query
  select *
  from public.read_commercial_opportunity_qualification_facts_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id
  );
end;
$function$;

alter function public.read_commercial_opportunity_qualification_facts_by_system(
  uuid, uuid, uuid
) owner to postgres;

comment on function public.read_commercial_opportunity_qualification_facts_by_system(
  uuid, uuid, uuid
) is
  'Reader server-only de qualification facts para Sales AI/runtime, sempre por organization/store/opportunity explicitos.';

revoke all on function public.read_commercial_opportunity_qualification_facts_by_system(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.read_commercial_opportunity_qualification_facts_by_system(
  uuid, uuid, uuid
) to service_role;

-- --------------------------------------------------------------------------
-- Authenticated human wrapper for CRM/read surfaces.
-- --------------------------------------------------------------------------
create or replace function public.read_commercial_opportunity_qualification_facts_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  organization_id uuid,
  store_id uuid,
  commercial_opportunity_id uuid,
  known_facts jsonb,
  missing_fact_groups jsonb,
  conflicts jsonb,
  provenance_summary jsonb,
  can_ask_next_question boolean,
  known_fact_count integer,
  missing_group_count integer,
  conflict_count integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'qualification fact read by user is not authorized';
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
      message = 'qualification fact read by user is not authorized';
  end if;

  return query
  select *
  from public.read_commercial_opportunity_qualification_facts_internal(
    p_request_organization_id,
    p_store_id,
    p_commercial_opportunity_id
  );
end;
$function$;

alter function public.read_commercial_opportunity_qualification_facts_by_user(
  uuid, uuid, uuid
) owner to postgres;

comment on function public.read_commercial_opportunity_qualification_facts_by_user(
  uuid, uuid, uuid
) is
  'Reader autenticado de qualification facts para CRM. Exige membership ativa e escopo explicito; nao descobre opportunity implicitamente.';

revoke all on function public.read_commercial_opportunity_qualification_facts_by_user(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.read_commercial_opportunity_qualification_facts_by_user(
  uuid, uuid, uuid
) to authenticated;

-- --------------------------------------------------------------------------
-- Postconditions
-- --------------------------------------------------------------------------
do $postconditions$
declare
  v_internal_oid oid := pg_catalog.to_regprocedure(
    'public.read_commercial_opportunity_qualification_facts_internal(uuid,uuid,uuid)'
  );
  v_system_oid oid := pg_catalog.to_regprocedure(
    'public.read_commercial_opportunity_qualification_facts_by_system(uuid,uuid,uuid)'
  );
  v_user_oid oid := pg_catalog.to_regprocedure(
    'public.read_commercial_opportunity_qualification_facts_by_user(uuid,uuid,uuid)'
  );
  v_proc_oid oid;
  v_expected_result text :=
    'TABLE(organization_id uuid, store_id uuid, commercial_opportunity_id uuid, known_facts jsonb, missing_fact_groups jsonb, conflicts jsonb, provenance_summary jsonb, can_ask_next_question boolean, known_fact_count integer, missing_group_count integer, conflict_count integer)';
begin
  if v_internal_oid is null or v_system_oid is null or v_user_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: qualification fact reader function is missing';
  end if;

  foreach v_proc_oid in array array[v_internal_oid, v_system_oid, v_user_oid]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_proc proc_row
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = proc_row.pronamespace
      join pg_catalog.pg_roles role_row
        on role_row.oid = proc_row.proowner
      where proc_row.oid = v_proc_oid
        and namespace_row.nspname = 'public'
        and role_row.rolname = 'postgres'
        and proc_row.prosecdef
        and proc_row.provolatile = 's'
        and pg_catalog.pg_get_function_result(proc_row.oid) = v_expected_result
        and exists (
          select 1
          from pg_catalog.unnest(coalesce(proc_row.proconfig, array[]::text[])) config_row
          where config_row = 'search_path=pg_catalog, pg_temp, public'
        )
        and exists (
          select 1
          from pg_catalog.unnest(coalesce(proc_row.proconfig, array[]::text[])) config_row
          where config_row = 'row_security=off'
        )
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'postcondition failed: qualification fact reader metadata mismatch';
    end if;

    if exists (
      select 1
      from pg_catalog.pg_proc proc_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(proc_row.proacl, pg_catalog.acldefault('f', proc_row.proowner))
      ) acl_row
      where proc_row.oid = v_proc_oid
        and acl_row.grantee = 0
        and acl_row.privilege_type = 'EXECUTE'
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'postcondition failed: qualification fact reader exposes EXECUTE to PUBLIC';
    end if;
  end loop;

  if pg_catalog.has_function_privilege(
       'authenticated',
       'public.read_commercial_opportunity_qualification_facts_internal(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.read_commercial_opportunity_qualification_facts_internal(uuid,uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: internal qualification fact reader must stay closed';
  end if;

  if pg_catalog.has_function_privilege(
       'authenticated',
       'public.read_commercial_opportunity_qualification_facts_by_system(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.read_commercial_opportunity_qualification_facts_by_system(uuid,uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: system qualification fact reader grants mismatch';
  end if;

  if not pg_catalog.has_function_privilege(
       'authenticated',
       'public.read_commercial_opportunity_qualification_facts_by_user(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.read_commercial_opportunity_qualification_facts_by_user(uuid,uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: user qualification fact reader grants mismatch';
  end if;

  -- Reader migration must not reopen direct writes.
  if pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_fact_events', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_fact_events', 'UPDATE')
     or pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_fact_events', 'DELETE')
     or pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_facts_current', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_facts_current', 'UPDATE')
     or pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_facts_current', 'DELETE')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_fact_events', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_fact_events', 'UPDATE')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_fact_events', 'DELETE')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_facts_current', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_facts_current', 'UPDATE')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_facts_current', 'DELETE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: qualification fact direct writes were reopened';
  end if;
end;
$postconditions$;

commit;
