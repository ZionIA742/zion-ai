begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:b5:e5.5.3:followup-inbox-reader-v2-manual-checks:v1',
    0
  )
);

do $p9_followup_inbox_reader_v2_contract$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.panel_list_followup_opportunity_candidates_scoped_v2(uuid,uuid,text,integer,integer,integer)'
  );
  v_result text;
  v_definition text;
  v_authenticated_grants integer;
begin
  if v_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'p9_followup_inbox_reader_v2_contract: reader v2 is missing';
  end if;

  select pg_catalog.pg_get_function_result(v_oid)
  into v_result;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(v_oid))
  into v_definition;

  if v_result not like '%total_count bigint%'
     or v_result not like '%ready_count bigint%'
     or v_result not like '%waiting_count bigint%'
     or v_result not like '%blocked_count bigint%'
     or v_result not like '%followup_id uuid%'
     or v_result not like '%followup_cycle integer%'
     or v_result not like '%followup_status text%'
     or v_result not like '%next_action_at timestamp with time zone%'
     or v_result not like '%attempt_count integer%'
     or v_result not like '%opted_out boolean%'
     or v_result not like '%consent_restored boolean%'
     or v_result not like '%reason_code text%'
     or v_result not like '%context jsonb%' then
    raise exception using
      errcode = 'P0001',
      message = 'p9_followup_inbox_reader_v2_contract: returned columns are incomplete';
  end if;

  if pg_catalog.strpos(v_definition, 'limit v_limit') = 0
     or pg_catalog.strpos(v_definition, 'offset v_offset') = 0
     or pg_catalog.strpos(v_definition, 'count(*) over () as total_count') = 0
     or pg_catalog.strpos(v_definition, 'count(*) filter') = 0
     or pg_catalog.strpos(v_definition, 'order by') = 0
     or pg_catalog.strpos(v_definition, 'commercial_opportunity_id asc') = 0
     or pg_catalog.strpos(v_definition, 'followup_type asc') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'p9_followup_inbox_reader_v2_contract: pagination totals or deterministic ordering are missing';
  end if;

  if pg_catalog.strpos(v_definition, 'commercial_opportunity_followups') = 0
     or pg_catalog.strpos(v_definition, 'opted_out') = 0
     or pg_catalog.strpos(v_definition, 'consent_restored') = 0
     or pg_catalog.strpos(v_definition, 'reason_code') = 0
     or pg_catalog.strpos(v_definition, 'operational_state') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'p9_followup_inbox_reader_v2_contract: canonical follow-up fields are missing';
  end if;

  select count(*)
  into v_authenticated_grants
  from information_schema.routine_privileges privilege_row
  where privilege_row.specific_schema = 'public'
    and privilege_row.routine_name =
      'panel_list_followup_opportunity_candidates_scoped_v2'
    and privilege_row.grantee = 'authenticated'
    and privilege_row.privilege_type = 'EXECUTE';

  if v_authenticated_grants <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'p9_followup_inbox_reader_v2_contract: authenticated execute grant is missing';
  end if;
end;
$p9_followup_inbox_reader_v2_contract$;

do $p9_followup_inbox_reader_v2_101_candidates$
declare
  v_definition text;
begin
  select pg_catalog.lower(
    pg_catalog.pg_get_functiondef(
      'public.panel_list_followup_opportunity_candidates_scoped_v2(uuid,uuid,text,integer,integer,integer)'::pg_catalog.regprocedure
    )
  )
  into v_definition;

  if pg_catalog.strpos(v_definition, 'v_limit := least(greatest(coalesce(p_limit, 50), 1), 200)') = 0
     or pg_catalog.strpos(v_definition, 'total_count') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'p9_followup_inbox_reader_v2_101_candidates: reader cannot report totals beyond a page';
  end if;
end;
$p9_followup_inbox_reader_v2_101_candidates$;

do $p9_followup_inbox_reader_v2_offset_no_overlap$
declare
  v_definition text;
begin
  select pg_catalog.lower(
    pg_catalog.pg_get_functiondef(
      'public.panel_list_followup_opportunity_candidates_scoped_v2(uuid,uuid,text,integer,integer,integer)'::pg_catalog.regprocedure
    )
  )
  into v_definition;

  if pg_catalog.strpos(v_definition, 'v_offset := greatest(coalesce(p_offset, 0), 0)') = 0
     or pg_catalog.strpos(v_definition, 'offset v_offset') = 0
     or pg_catalog.strpos(v_definition, 'commercial_opportunity_id asc') = 0
     or pg_catalog.strpos(v_definition, 'followup_type asc') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'p9_followup_inbox_reader_v2_offset_no_overlap: stable offset contract is missing';
  end if;
end;
$p9_followup_inbox_reader_v2_offset_no_overlap$;

do $p9_followup_inbox_reader_v2_offer_visit_totals$
declare
  v_definition text;
begin
  select pg_catalog.lower(
    pg_catalog.pg_get_functiondef(
      'public.panel_list_followup_opportunity_candidates_scoped_v2(uuid,uuid,text,integer,integer,integer)'::pg_catalog.regprocedure
    )
  )
  into v_definition;

  if pg_catalog.strpos(v_definition, 'v_followup_type not in (''offer'', ''visit'')') = 0
     or pg_catalog.strpos(v_definition, 'followup_visit') = 0
     or pg_catalog.strpos(v_definition, 'followup_offer') = 0
     or pg_catalog.strpos(v_definition, 'followup_type') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'p9_followup_inbox_reader_v2_offer_visit_totals: offer/visit contract is missing';
  end if;
end;
$p9_followup_inbox_reader_v2_offer_visit_totals$;

do $p9_followup_inbox_reader_v2_scope_and_states$
declare
  v_definition text;
begin
  select pg_catalog.lower(
    pg_catalog.pg_get_functiondef(
      'public.panel_list_followup_opportunity_candidates_scoped_v2(uuid,uuid,text,integer,integer,integer)'::pg_catalog.regprocedure
    )
  )
  into v_definition;

  if pg_catalog.strpos(v_definition, 'memberships') = 0
     or pg_catalog.strpos(v_definition, 'stores') = 0
     or pg_catalog.strpos(v_definition, 'conversation_sessions') = 0
     or pg_catalog.strpos(v_definition, 'commercial_session_context_links') = 0
     or pg_catalog.strpos(v_definition, 'lead_customer_links') = 0
     or pg_catalog.strpos(v_definition, 'commercial_opportunity_opted_out') = 0
     or pg_catalog.strpos(v_definition, 'commercial_opportunity_followup_exhausted') = 0
     or pg_catalog.strpos(v_definition, 'primary_conversation_scope_inconsistency') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'p9_followup_inbox_reader_v2_scope_and_states: scope or canonical states are missing';
  end if;
end;
$p9_followup_inbox_reader_v2_scope_and_states$;

rollback;
