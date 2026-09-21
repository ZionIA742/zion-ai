begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:b5:e5.5.3:followup-inbox-reader-v3-opportunity-stage:v1',
    0
  )
);

do $preflight$
begin
  if pg_catalog.to_regprocedure(
    'public.panel_list_followup_opportunity_candidates_scoped_v2(uuid,uuid,text,integer,integer,integer)'
  ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: followup inbox reader v2 is missing';
  end if;

  if pg_catalog.to_regprocedure(
    'public.panel_list_followup_opportunity_candidates_scoped_v3(uuid,uuid,text,integer,integer,integer)'
  ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: followup inbox reader v3 already exists';
  end if;

  if pg_catalog.to_regclass('public.commercial_opportunities') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical commercial opportunities table is missing';
  end if;
end;
$preflight$;

create function public.panel_list_followup_opportunity_candidates_scoped_v3(
  p_organization_id uuid,
  p_store_id uuid default null,
  p_followup_type text default 'offer',
  p_min_hours_since_customer integer default 24,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  commercial_opportunity_id uuid,
  conversation_id uuid,
  lead_id uuid,
  lead_name text,
  lead_phone text,
  conversation_status text,
  opportunity_stage text,
  is_human_active boolean,
  last_customer_message_at timestamptz,
  last_ai_message_at timestamptz,
  hours_since_customer numeric,
  followup_type text,
  suggested_action text,
  operational_state text,
  blocked_reason text,
  followup_id uuid,
  followup_cycle integer,
  followup_status text,
  next_action text,
  next_action_at timestamptz,
  attempt_count integer,
  exhausted boolean,
  opted_out boolean,
  consent_restored boolean,
  reason_code text,
  reason_details text,
  context jsonb,
  total_count bigint,
  ready_count bigint,
  waiting_count bigint,
  blocked_count bigint
)
language sql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
  select
    candidate.commercial_opportunity_id,
    candidate.conversation_id,
    candidate.lead_id,
    candidate.lead_name,
    candidate.lead_phone,
    candidate.conversation_status,
    opportunity_row.stage as opportunity_stage,
    candidate.is_human_active,
    candidate.last_customer_message_at,
    candidate.last_ai_message_at,
    candidate.hours_since_customer,
    candidate.followup_type,
    candidate.suggested_action,
    candidate.operational_state,
    candidate.blocked_reason,
    candidate.followup_id,
    candidate.followup_cycle,
    candidate.followup_status,
    candidate.next_action,
    candidate.next_action_at,
    candidate.attempt_count,
    candidate.exhausted,
    candidate.opted_out,
    candidate.consent_restored,
    candidate.reason_code,
    candidate.reason_details,
    candidate.context,
    candidate.total_count,
    candidate.ready_count,
    candidate.waiting_count,
    candidate.blocked_count
  from public.panel_list_followup_opportunity_candidates_scoped_v2(
    p_organization_id,
    p_store_id,
    p_followup_type,
    p_min_hours_since_customer,
    p_limit,
    p_offset
  ) candidate
  join public.commercial_opportunities opportunity_row
    on opportunity_row.id = candidate.commercial_opportunity_id
   and opportunity_row.organization_id = p_organization_id
   and (
     p_store_id is null
     or opportunity_row.store_id = p_store_id
   );
$function$;

alter function public.panel_list_followup_opportunity_candidates_scoped_v3(
  uuid,
  uuid,
  text,
  integer,
  integer,
  integer
) owner to postgres;

revoke all on function public.panel_list_followup_opportunity_candidates_scoped_v3(
  uuid,
  uuid,
  text,
  integer,
  integer,
  integer
) from public, anon, authenticated, service_role;

grant execute on function public.panel_list_followup_opportunity_candidates_scoped_v3(
  uuid,
  uuid,
  text,
  integer,
  integer,
  integer
) to authenticated;

comment on function public.panel_list_followup_opportunity_candidates_scoped_v3(
  uuid,
  uuid,
  text,
  integer,
  integer,
  integer
) is
  'P9 5.5.3 hotfix Inbox follow-up reader v3. Preserves v2 pagination/totals and adds opportunity_stage from commercial_opportunities.stage.';

do $postconditions$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.panel_list_followup_opportunity_candidates_scoped_v3(uuid,uuid,text,integer,integer,integer)'
  );
  v_result text;
  v_definition text;
begin
  if v_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: followup inbox reader v3 is missing';
  end if;

  select pg_catalog.pg_get_function_result(v_oid)
  into v_result;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(v_oid))
  into v_definition;

  if v_result not like '%conversation_status text%'
     or v_result not like '%opportunity_stage text%'
     or v_result not like '%total_count bigint%'
     or v_result not like '%ready_count bigint%'
     or v_result not like '%waiting_count bigint%'
     or v_result not like '%blocked_count bigint%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: v3 return contract is incomplete';
  end if;

  if pg_catalog.strpos(v_definition, 'panel_list_followup_opportunity_candidates_scoped_v2') = 0
     or pg_catalog.strpos(v_definition, 'commercial_opportunities') = 0
     or pg_catalog.strpos(v_definition, 'opportunity_row.stage as opportunity_stage') = 0
     or pg_catalog.strpos(v_definition, 'candidate.conversation_status') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: v3 stage source contract is incomplete';
  end if;
end;
$postconditions$;

commit;
