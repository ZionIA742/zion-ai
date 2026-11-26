begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

do $preconditions$
declare
  v_internal_oid oid := to_regprocedure('public.apply_commercial_opportunity_qualification_fact_internal(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)');
  v_system_oid oid := to_regprocedure('public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)');
  v_internal_prosrc text;
  v_system_prosrc text;
begin
  if v_internal_oid is null or v_system_oid is null then
    raise exception using errcode = 'P0001', message = 'P9_B11_FINAL_TARGET_FUNCTION_MISSING';
  end if;

  select pg_catalog.regexp_replace(p.prosrc, E'\r\n?', E'\n', 'g')
    into v_internal_prosrc
  from pg_catalog.pg_proc p
  where p.oid = v_internal_oid;

  select pg_catalog.regexp_replace(p.prosrc, E'\r\n?', E'\n', 'g')
    into v_system_prosrc
  from pg_catalog.pg_proc p
  where p.oid = v_system_oid;

  if md5(v_internal_prosrc) <> 'd57d795834d08d1b218d1b835be0da1f'
     or md5(v_system_prosrc) <> '70a272160ff353570ad1b445b073cedb' then
    raise exception using errcode = 'P0001', message = 'P9_B11_CONFIRMED_TARGET_PROSRC_EQUIVALENCE_FAILED';
  end if;

  if pg_catalog.pg_get_userbyid((select proowner from pg_catalog.pg_proc where oid = v_internal_oid)) <> 'postgres'
     or pg_catalog.pg_get_userbyid((select proowner from pg_catalog.pg_proc where oid = v_system_oid)) <> 'postgres'
     or not (select prosecdef from pg_catalog.pg_proc where oid = v_internal_oid)
     or not (select prosecdef from pg_catalog.pg_proc where oid = v_system_oid)
     or pg_catalog.strpos(v_system_prosrc, 'lead_customer_link_request_role') = 0
     or pg_catalog.strpos(v_system_prosrc, 'human_message') = 0 then
    raise exception using errcode = 'P0001', message = 'P9_B11_TARGET_SECURITY_CONTRACT_FAILED';
  end if;
end;
$preconditions$;

create or replace function public.promote_commercial_memory_fact_if_absent_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text,
  p_fact_key text,
  p_value_json jsonb,
  p_assertion_level text,
  p_source_type text,
  p_source_message_id uuid default null,
  p_source_conversation_id uuid default null,
  p_created_by text default 'commercial_memory_promotion_v1',
  p_resolves_conflict boolean default false,
  p_response_set_id uuid default null,
  p_queue_id uuid default null,
  p_claim_token uuid default null,
  p_anchor_message_id uuid default null,
  p_recovery_conversation_id uuid default null,
  p_recovery_lead_id uuid default null
)
returns table (
  outcome text,
  event_id uuid,
  current_state text,
  current_value_json jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := public.lead_customer_link_request_role();
  v_fact_key text := nullif(pg_catalog.btrim(coalesce(p_fact_key, '')), '');
  v_current public.commercial_opportunity_qualification_facts_current%rowtype;
  v_existing_event_id uuid;
  v_fact_lock_key bigint;
  v_result record;
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'commercial memory promotion is server-only';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_operation_key is null
     or v_fact_key is null
     or p_value_json is null
     or p_value_json = 'null'::jsonb
     or p_assertion_level is distinct from 'confirmed'
     or p_source_type not in ('incoming_customer_message', 'human_message')
     or p_source_message_id is null
     or p_source_conversation_id is null
     or p_resolves_conflict is true then
    raise exception using errcode = '22023',
      message = 'commercial memory promotion arguments are invalid';
  end if;

  if (p_response_set_id is null) <> (p_queue_id is null)
     or (p_response_set_id is null) <> (p_claim_token is null)
     or (p_response_set_id is null) <> (p_anchor_message_id is null)
     or (p_response_set_id is null) <> (p_recovery_conversation_id is null)
     or (p_response_set_id is null) <> (p_recovery_lead_id is null) then
    raise exception using errcode = '22023',
      message = 'commercial memory promotion recovery authority is incomplete';
  end if;

  if p_response_set_id is not null then
    -- Keep the recovery fence order: opportunity/conversation/queue/set
    -- validation happens before the canonical qualification-fact lock.
    perform public.p9_10_4_d_assert_recovery_set_claim_authority(
      p_response_set_id,
      p_queue_id,
      p_claim_token,
      p_organization_id,
      p_store_id,
      p_recovery_conversation_id,
      p_anchor_message_id,
      p_recovery_lead_id,
      p_commercial_opportunity_id
    );
  end if;

  v_fact_lock_key := pg_catalog.hashtextextended(
    'zion:p9:qfact:'
    || p_organization_id::text
    || ':' || p_store_id::text
    || ':' || p_commercial_opportunity_id::text
    || ':' || v_fact_key,
    0
  );

  if p_response_set_id is not null then
    -- Recovery already holds the opportunity lock.
    -- Never wait for a fact lock held by another writer.
    if not pg_catalog.pg_try_advisory_xact_lock(
      v_fact_lock_key
    ) then
      raise exception using
        errcode = '55P03',
        message = 'P9_B11_RECOVERY_FACT_LOCK_BUSY';
    end if;
  else
    perform pg_catalog.pg_advisory_xact_lock(
      v_fact_lock_key
    );
  end if;

  select current_row.*
    into v_current
  from public.commercial_opportunity_qualification_facts_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id
    and current_row.fact_key = v_fact_key
  for update;

  if found then
    return query select
      'ignored_existing_current'::text,
      v_current.last_event_id,
      v_current.current_state,
      v_current.value_json;
    return;
  end if;

  select event_row.id
    into v_existing_event_id
  from public.commercial_opportunity_qualification_fact_events event_row
  where event_row.organization_id = p_organization_id
    and event_row.store_id = p_store_id
    and event_row.commercial_opportunity_id = p_commercial_opportunity_id
    and event_row.fact_key = v_fact_key
  order by event_row.created_at, event_row.id
  limit 1;

  if found then
    return query select
      'ignored_existing_event'::text,
      v_existing_event_id,
      null::text,
      null::jsonb;
    return;
  end if;

  if p_response_set_id is null then
    select *
      into v_result
    from public.write_commercial_opportunity_qualification_fact_by_system(
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id,
      p_operation_key,
      v_fact_key,
      p_value_json,
      p_assertion_level,
      p_source_type,
      p_source_message_id,
      p_source_conversation_id,
      p_created_by,
      p_resolves_conflict
    );
  else
    select *
      into v_result
    from public.p9_10_4_d_write_recovery_qualification_fact_by_system(
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id,
      p_operation_key,
      v_fact_key,
      p_value_json,
      p_assertion_level,
      p_source_type,
      p_source_message_id,
      p_source_conversation_id,
      p_created_by,
      p_resolves_conflict,
      p_response_set_id,
      p_queue_id,
      p_claim_token,
      p_anchor_message_id,
      p_recovery_conversation_id,
      p_recovery_lead_id
    );
  end if;

  if v_result.event_id is null
     or v_result.changed is distinct from true
     or v_result.current_state is distinct from 'confirmed'
     or v_result.outcome is distinct from 'confirmed_created' then
    raise exception using errcode = 'P0001',
      message = 'P9_B11_ATOMIC_PROMOTION_DELEGATED_RESULT_INVALID';
  end if;

  return query select
    'promoted_created'::text,
    v_result.event_id,
    v_result.current_state,
    v_result.current_value_json;
end;
$function$;

alter function public.promote_commercial_memory_fact_if_absent_by_system(
  uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean,uuid,uuid,uuid,uuid,uuid,uuid
) owner to postgres;

revoke all on function public.promote_commercial_memory_fact_if_absent_by_system(
  uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean,uuid,uuid,uuid,uuid,uuid,uuid
) from public, anon, authenticated, service_role;

grant execute on function public.promote_commercial_memory_fact_if_absent_by_system(
  uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean,uuid,uuid,uuid,uuid,uuid,uuid
) to service_role;


do $postconditions$
declare
  v_oid oid := to_regprocedure('public.promote_commercial_memory_fact_if_absent_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean,uuid,uuid,uuid,uuid,uuid,uuid)');
begin
  if v_oid is null
     or not (select prosecdef from pg_proc where oid = v_oid)
     or pg_get_userbyid((select proowner from pg_proc where oid = v_oid)) <> 'postgres'
     or not has_function_privilege('service_role', v_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or has_function_privilege('anon', v_oid, 'EXECUTE')
     or position('zion:p9:qfact:' in pg_get_functiondef(v_oid)) = 0
     or position('ignored_existing_current' in pg_get_functiondef(v_oid)) = 0
     or position('ignored_existing_event' in pg_get_functiondef(v_oid)) = 0 then
    raise exception using errcode = 'P0001', message = 'P9_B11_ATOMIC_PROMOTION_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;

commit;

