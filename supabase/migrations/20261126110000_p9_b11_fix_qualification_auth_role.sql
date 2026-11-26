-- P9 B11: canonical PostgREST auth context for authenticated qualification writes.
-- Replaces only human qualification wrappers; business scope, membership,
-- CAS, idempotency and human evidence contracts remain unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local search_path = pg_catalog, pg_temp, public, auth;
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('zion:p9:b11:qualification-auth-role:v1', 0));

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
  v_request_role text := auth.role();
begin
  if v_user_id is null or v_request_role is distinct from 'authenticated' then
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

create or replace function public.write_commercial_qualification_fact_by_user_if_current(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text,
  p_fact_key text,
  p_value_json jsonb,
  p_expected_last_event_id uuid,
  p_source_message_id uuid default null,
  p_source_conversation_id uuid default null,
  p_resolves_conflict boolean default false
)
returns table (
  commercial_opportunity_id uuid,
  fact_key text,
  event_id uuid,
  current_last_event_id uuid,
  current_state text,
  current_value_json jsonb,
  normalized_value_text text,
  value_kind text,
  conflict_values_json jsonb,
  changed boolean,
  outcome text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public, auth
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := auth.role();
  v_result record;
  v_conversation_id uuid;
  v_ledger_sqlstate text;
begin
  if v_user_id is null or v_request_role is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'qualification fact write by user is not authorized';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
      and membership_row.is_active is true
  ) then
    raise exception using errcode = '42501', message = 'qualification fact write by user is not authorized';
  end if;

  select * into v_result
  from public.apply_commercial_qualification_fact_internal_if_current(
    p_request_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_operation_key,
    p_fact_key,
    p_value_json,
    'confirmed',
    'crm_manual',
    p_source_message_id,
    p_source_conversation_id,
    ('user:' || v_user_id::text),
    p_resolves_conflict,
    p_expected_last_event_id
  );

  -- Evidence is append-only and must not turn an idempotent replay into a
  -- duplicate-key failure.
  if v_result.changed is true then
    select opportunity_row.primary_conversation_id
    into v_conversation_id
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = p_commercial_opportunity_id;

    if v_conversation_id is not null then
      begin
        perform public.record_human_qualification_decision_evidence_internal(
          p_request_organization_id,
          p_store_id,
          v_conversation_id,
          p_commercial_opportunity_id,
          v_user_id,
          p_operation_key,
          v_result.event_id,
          v_result.fact_key,
          p_value_json
        );
      exception when others then
        get stacked diagnostics v_ledger_sqlstate = returned_sqlstate;
        if v_ledger_sqlstate in ('22023', '23502', '23503', '23505', '23514', '40001', '40P01', '42501') then
          raise;
        end if;
      end;
    end if;
  end if;

  return query
  select v_result.commercial_opportunity_id, v_result.fact_key,
    v_result.event_id, v_result.current_last_event_id, v_result.current_state,
    v_result.current_value_json, v_result.normalized_value_text, v_result.value_kind,
    v_result.conflict_values_json, v_result.changed, v_result.outcome, v_result.updated_at;
end;
$function$;

create or replace function public.record_human_qualification_decision_evidence_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_commercial_opportunity_id uuid,
  p_actor_user_id uuid,
  p_operation_key text,
  p_source_id uuid,
  p_fact_key text,
  p_canonical_value_json jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public, auth
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_existing public.commercial_human_decision_evidence;
  v_opportunity public.commercial_opportunities;
  v_event public.commercial_opportunity_qualification_fact_events;
  v_evidence_id uuid;
begin
  if v_user_id is null or v_user_id is distinct from p_actor_user_id
     or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'human qualification evidence actor is not authorized';
  end if;

  select opportunity_row.* into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
    and opportunity_row.primary_conversation_id = p_conversation_id
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'human qualification evidence opportunity scope mismatch';
  end if;

  select event_row.* into v_event
  from public.commercial_opportunity_qualification_fact_events event_row
  where event_row.id = p_source_id
    and event_row.organization_id = p_organization_id
    and event_row.store_id = p_store_id
    and event_row.commercial_opportunity_id = p_commercial_opportunity_id
    and event_row.fact_key = p_fact_key
    and event_row.operation_key = p_operation_key
    and event_row.source_type = 'crm_manual'
    and event_row.assertion_level = 'confirmed'
    and event_row.created_by = 'user:' || p_actor_user_id::text
    and event_row.value_json is not distinct from p_canonical_value_json;
  if not found then
    raise exception using errcode = '23514', message = 'human qualification evidence source is not canonical';
  end if;

  select * into v_existing
  from public.commercial_human_decision_evidence evidence_row
  where evidence_row.organization_id = p_organization_id
    and evidence_row.operation_key = p_operation_key;
  if found then
    if v_existing.source_id is distinct from p_source_id
       or v_existing.actor_user_id is distinct from p_actor_user_id
       or v_existing.commercial_opportunity_id is distinct from p_commercial_opportunity_id
       or v_existing.decision_domain is distinct from 'commercial_facts'
       or v_existing.decision_field is distinct from p_fact_key
       or v_existing.canonical_value_json is distinct from p_canonical_value_json then
      raise exception using errcode = '23505', message = 'ZION_HUMAN_EVIDENCE_IDEMPOTENCY_KEY_REUSED';
    end if;
    return v_existing.id;
  end if;

  insert into public.commercial_human_decision_evidence (
    organization_id, store_id, conversation_id, commercial_opportunity_id,
    actor_user_id, decision_domain, decision_field, canonical_value_json,
    source_type, source_id, source_version, operation_key, observed_at
  ) values (
    p_organization_id, p_store_id, p_conversation_id, p_commercial_opportunity_id,
    p_actor_user_id, 'commercial_facts', p_fact_key, p_canonical_value_json,
    'commercial_opportunity_qualification_fact_event', v_event.id, v_event.id::text,
    p_operation_key, v_event.created_at
  ) returning id into v_evidence_id;

  return v_evidence_id;
end;
$function$;

create or replace function public.write_commercial_opportunity_qualification_fact_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text,
  p_fact_key text,
  p_value_json jsonb,
  p_source_message_id uuid default null,
  p_source_conversation_id uuid default null,
  p_resolves_conflict boolean default false
)
returns table (
  commercial_opportunity_id uuid,
  fact_key text,
  event_id uuid,
  current_last_event_id uuid,
  current_state text,
  current_value_json jsonb,
  normalized_value_text text,
  value_kind text,
  conflict_values_json jsonb,
  changed boolean,
  outcome text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := auth.role();
  v_result record;
  v_conversation_id uuid;
  v_ledger_sqlstate text;
begin
  if v_user_id is null or v_request_role is distinct from 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'qualification fact write by user is not authorized';
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
      message = 'qualification fact write by user is not authorized';
  end if;

  select * into v_result
  from public.apply_commercial_opportunity_qualification_fact_internal(
    p_request_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_operation_key,
    p_fact_key,
    p_value_json,
    'confirmed',
    'crm_manual',
    p_source_message_id,
    p_source_conversation_id,
    ('user:' || v_user_id::text),
    p_resolves_conflict
  );

  select opportunity_row.primary_conversation_id into v_conversation_id
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id;
  if v_conversation_id is not null then
    begin
      perform public.record_human_qualification_decision_evidence_internal(
        p_request_organization_id, p_store_id, v_conversation_id,
        p_commercial_opportunity_id, v_user_id, p_operation_key,
        v_result.event_id, v_result.fact_key, p_value_json
      );
    exception when others then
      get stacked diagnostics v_ledger_sqlstate = returned_sqlstate;
      if v_ledger_sqlstate in ('22023', '23502', '23503', '23505', '23514', '40001', '40P01', '42501') then
        raise;
      end if;
      null;
    end;
  end if;

  return query select v_result.commercial_opportunity_id, v_result.fact_key,
    v_result.event_id, v_result.current_last_event_id, v_result.current_state,
    v_result.current_value_json, v_result.normalized_value_text, v_result.value_kind,
    v_result.conflict_values_json, v_result.changed, v_result.outcome, v_result.updated_at;
end;
$function$;

-- D1 stage authorities use the same legacy JWT setting. Keep the specialized
-- negotiation guard and the complete lifecycle evidence path intact.
create or replace function public.record_human_stage_decision_evidence_internal(
  p_organization_id uuid, p_store_id uuid, p_conversation_id uuid,
  p_commercial_opportunity_id uuid, p_actor_user_id uuid, p_operation_key text,
  p_source_id uuid, p_decision_field text, p_canonical_value_json jsonb
)
returns uuid language plpgsql security definer
set search_path = pg_catalog, pg_temp, public, auth set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_existing public.commercial_human_decision_evidence;
  v_opportunity public.commercial_opportunities;
  v_event public.commercial_opportunity_lifecycle_events;
  v_evidence_id uuid;
begin
  if v_user_id is null or v_user_id is distinct from p_actor_user_id
     or auth.role() is distinct from 'authenticated' then
    raise exception using errcode='42501', message='human decision evidence actor is not authorized';
  end if;
  select opportunity_row.* into v_opportunity from public.commercial_opportunities opportunity_row
  where opportunity_row.id=p_commercial_opportunity_id and opportunity_row.organization_id=p_organization_id
    and opportunity_row.store_id=p_store_id and opportunity_row.primary_conversation_id=p_conversation_id for update;
  if not found then raise exception using errcode='23514', message='human decision evidence opportunity scope mismatch'; end if;
  select lifecycle_event.* into v_event from public.commercial_opportunity_lifecycle_events lifecycle_event
  where lifecycle_event.id=p_source_id and lifecycle_event.organization_id=p_organization_id
    and lifecycle_event.store_id=p_store_id and lifecycle_event.commercial_opportunity_id=p_commercial_opportunity_id
    and lifecycle_event.actor_type='human' and lifecycle_event.actor_user_id=p_actor_user_id
    and lifecycle_event.event_type='stage_transition';
  if not found then raise exception using errcode='23514', message='human decision evidence source is not canonical'; end if;
  if v_event.idempotency_key is distinct from p_operation_key or p_decision_field <> 'stage'
     or p_canonical_value_json is distinct from to_jsonb(v_event.new_stage)
     or v_event.lifecycle_cycle is null then
    raise exception using errcode='23514', message='human decision evidence source mismatch';
  end if;
  select * into v_existing from public.commercial_human_decision_evidence evidence_row
  where evidence_row.organization_id=p_organization_id and evidence_row.operation_key=p_operation_key;
  if found then
    if v_existing.source_id is distinct from p_source_id or v_existing.actor_user_id is distinct from p_actor_user_id
       or v_existing.commercial_opportunity_id is distinct from p_commercial_opportunity_id
       or v_existing.canonical_value_json is distinct from p_canonical_value_json then
      raise exception using errcode='23505', message='ZION_HUMAN_EVIDENCE_IDEMPOTENCY_KEY_REUSED';
    end if;
    return v_existing.id;
  end if;
  insert into public.commercial_human_decision_evidence(
    organization_id,store_id,conversation_id,commercial_opportunity_id,actor_user_id,
    decision_domain,decision_field,canonical_value_json,source_type,source_id,source_version,operation_key,observed_at
  ) values (
    p_organization_id,p_store_id,p_conversation_id,p_commercial_opportunity_id,p_actor_user_id,
    'crm_stage',p_decision_field,p_canonical_value_json,'commercial_opportunity_lifecycle_event',
    v_event.id,v_event.lifecycle_cycle::text,p_operation_key,v_event.created_at
  ) returning id into v_evidence_id;
  return v_evidence_id;
end;
$function$;

create or replace function public.transition_commercial_opportunity_stage_by_user(
  p_request_organization_id uuid, p_store_id uuid, p_commercial_opportunity_id uuid,
  p_idempotency_key text, p_target_stage text, p_reason_details text default null,
  p_evidence_type text default null, p_evidence_message_id uuid default null,
  p_evidence_summary text default null, p_source text default 'manual_stage_transition'
)
returns table(commercial_opportunity_id uuid,stage text,lifecycle_cycle integer,lifecycle_event_id uuid,
  event_type text,reason_code text,stage_changed_at timestamptz,updated_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, pg_temp, public, auth set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid(); v_request_role text := auth.role();
  v_normalized_target text; v_transition record; v_conversation_id uuid; v_ledger_sqlstate text;
begin
  if v_user_id is null or v_request_role is distinct from 'authenticated' then
    raise exception using errcode='42501',message='commercial opportunity stage transition by user is not authorized';
  end if;
  if not exists(select 1 from public.memberships membership_row where membership_row.organization_id=p_request_organization_id
    and membership_row.user_id=v_user_id and membership_row.is_active is true) then
    raise exception using errcode='42501',message='commercial opportunity stage transition by user is not authorized';
  end if;
  v_normalized_target := public.normalize_commercial_opportunity_stage(p_target_stage);
  if v_normalized_target='negociacao' then
    raise exception using errcode='23514',message='ZION_NEGOTIATION_SPECIALIZED_WRITER_REQUIRED';
  end if;
  select * into v_transition from public.apply_commercial_opportunity_stage_transition_internal(
    p_request_organization_id,p_store_id,p_commercial_opportunity_id,p_idempotency_key,p_target_stage,
    p_reason_details,p_evidence_type,p_evidence_message_id,p_evidence_summary,p_source,
    'stage_transition','human',v_user_id);
  select opportunity_row.primary_conversation_id into v_conversation_id from public.commercial_opportunities opportunity_row
  where opportunity_row.id=p_commercial_opportunity_id;
  if v_conversation_id is not null then
    begin
      perform public.record_human_stage_decision_evidence_internal(p_request_organization_id,p_store_id,v_conversation_id,
        p_commercial_opportunity_id,v_user_id,p_idempotency_key,v_transition.lifecycle_event_id,'stage',to_jsonb(v_transition.stage));
    exception when others then
      get stacked diagnostics v_ledger_sqlstate=returned_sqlstate;
      if v_ledger_sqlstate in ('22023','23502','23503','23505','23514','40001','40P01','42501') then raise; end if;
      null;
    end;
  end if;
  return query select v_transition.commercial_opportunity_id,v_transition.stage,v_transition.lifecycle_cycle,
    v_transition.lifecycle_event_id,v_transition.event_type,v_transition.reason_code,v_transition.stage_changed_at,v_transition.updated_at;
end;
$function$;

alter function public.read_commercial_opportunity_qualification_facts_by_user(uuid,uuid,uuid) owner to postgres;
alter function public.write_commercial_opportunity_qualification_fact_by_user(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,boolean) owner to postgres;
alter function public.write_commercial_qualification_fact_by_user_if_current(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,uuid,boolean) owner to postgres;
alter function public.record_human_qualification_decision_evidence_internal(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb) owner to postgres;
alter function public.record_human_stage_decision_evidence_internal(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb) owner to postgres;
alter function public.transition_commercial_opportunity_stage_by_user(uuid,uuid,uuid,text,text,text,text,uuid,text,text) owner to postgres;

revoke all on function public.read_commercial_opportunity_qualification_facts_by_user(uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_commercial_opportunity_qualification_facts_by_user(uuid,uuid,uuid) to authenticated;
revoke all on function public.write_commercial_opportunity_qualification_fact_by_user(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function public.write_commercial_opportunity_qualification_fact_by_user(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,boolean) to authenticated;
revoke all on function public.write_commercial_qualification_fact_by_user_if_current(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function public.write_commercial_qualification_fact_by_user_if_current(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,uuid,boolean) to authenticated;
revoke all on function public.record_human_qualification_decision_evidence_internal(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.record_human_stage_decision_evidence_internal(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.transition_commercial_opportunity_stage_by_user(uuid,uuid,uuid,text,text,text,text,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.transition_commercial_opportunity_stage_by_user(uuid,uuid,uuid,text,text,text,text,uuid,text,text) to authenticated;
commit;
