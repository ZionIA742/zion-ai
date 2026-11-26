-- P9 / Bloco 11 compatibility patch
-- D1 recreated the human stage writer and dropped the P9.8.1 specialized
-- negotiation guard. This migration restores that guard while retaining D1's
-- human decision evidence recording.
-- Install atomically after D1 and before the dependent homologation runner.

begin;

do $preflight$
begin
  if pg_catalog.to_regprocedure(
       'public.transition_commercial_opportunity_stage_by_user(uuid,uuid,uuid,text,text,text,text,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.apply_commercial_opportunity_stage_transition_internal(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.record_human_stage_decision_evidence_internal(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_10_5_D1_TRANSITION_COMPAT_PRECONDITION_MISSING';
  end if;
end;
$preflight$;

create or replace function public.transition_commercial_opportunity_stage_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_idempotency_key text,
  p_target_stage text,
  p_reason_details text default null,
  p_evidence_type text default null,
  p_evidence_message_id uuid default null,
  p_evidence_summary text default null,
  p_source text default 'manual_stage_transition'
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  lifecycle_event_id uuid,
  event_type text,
  reason_code text,
  stage_changed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public, auth
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_normalized_target text;
  v_transition record;
  v_conversation_id uuid;
  v_ledger_sqlstate text;
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using errcode = '42501', message = 'commercial opportunity stage transition by user is not authorized';
  end if;

  if not exists (
    select 1 from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
      and membership_row.is_active is true
  ) then
    raise exception using errcode = '42501', message = 'commercial opportunity stage transition by user is not authorized';
  end if;

  v_normalized_target := public.normalize_commercial_opportunity_stage(p_target_stage);
  if v_normalized_target = 'negociacao' then
    raise exception using
      errcode = '23514',
      message = 'ZION_NEGOTIATION_SPECIALIZED_WRITER_REQUIRED';
  end if;

  select * into v_transition
  from public.apply_commercial_opportunity_stage_transition_internal(
    p_request_organization_id, p_store_id, p_commercial_opportunity_id,
    p_idempotency_key, p_target_stage, p_reason_details, p_evidence_type,
    p_evidence_message_id, p_evidence_summary, p_source,
    'stage_transition', 'human', v_user_id
  );

  select opportunity_row.primary_conversation_id into v_conversation_id
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id;
  if v_conversation_id is not null then
    begin
      perform public.record_human_stage_decision_evidence_internal(
        p_request_organization_id, p_store_id, v_conversation_id,
        p_commercial_opportunity_id, v_user_id, p_idempotency_key,
        v_transition.lifecycle_event_id, 'stage', to_jsonb(v_transition.stage)
      );
    exception when others then
      get stacked diagnostics v_ledger_sqlstate = returned_sqlstate;
      if v_ledger_sqlstate in (
        '22023', '23502', '23503', '23505', '23514',
        '40001', '40P01', '42501'
      ) then
        raise;
      end if;
      null;
    end;
  end if;

  return query select v_transition.commercial_opportunity_id, v_transition.stage,
    v_transition.lifecycle_cycle, v_transition.lifecycle_event_id, v_transition.event_type,
    v_transition.reason_code, v_transition.stage_changed_at, v_transition.updated_at;
end;
$function$;

alter function public.transition_commercial_opportunity_stage_by_user(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) owner to postgres;
revoke all on function public.transition_commercial_opportunity_stage_by_user(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.transition_commercial_opportunity_stage_by_user(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) to authenticated;

do $postconditions$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.transition_commercial_opportunity_stage_by_user(uuid,uuid,uuid,text,text,text,text,uuid,text,text)'::regprocedure
  ) into v_definition;
  if v_definition not ilike '%ZION_NEGOTIATION_SPECIALIZED_WRITER_REQUIRED%'
     or v_definition not ilike '%record_human_stage_decision_evidence_internal%'
     or v_definition not ilike '%membership_row.is_active is true%' then
    raise exception using
      errcode = 'P0001',
      message = 'P9_10_5_D1_TRANSITION_COMPAT_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;

commit;
