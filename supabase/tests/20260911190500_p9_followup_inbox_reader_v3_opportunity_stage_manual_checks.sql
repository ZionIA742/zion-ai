begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:b5:e5.5.3:followup-inbox-reader-v3-stage-manual-checks:v1',
    0
  )
);

do $p9_followup_inbox_reader_v3_contract$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.panel_list_followup_opportunity_candidates_scoped_v3(uuid,uuid,text,integer,integer,integer)'
  );
  v_result text;
  v_definition text;
  v_authenticated_grants integer;
begin
  if v_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'p9_followup_inbox_reader_v3_contract: reader v3 is missing';
  end if;

  select pg_catalog.pg_get_function_result(v_oid)
  into v_result;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(v_oid))
  into v_definition;

  if v_result not like '%conversation_status text%'
     or v_result not like '%opportunity_stage text%'
     or v_result not like '%followup_type text%'
     or v_result not like '%total_count bigint%'
     or v_result not like '%ready_count bigint%'
     or v_result not like '%waiting_count bigint%'
     or v_result not like '%blocked_count bigint%' then
    raise exception using
      errcode = 'P0001',
      message = 'p9_followup_inbox_reader_v3_contract: return columns are incomplete';
  end if;

  if pg_catalog.strpos(v_definition, 'panel_list_followup_opportunity_candidates_scoped_v2') = 0
     or pg_catalog.strpos(v_definition, 'opportunity_row.stage as opportunity_stage') = 0
     or pg_catalog.strpos(v_definition, 'candidate.conversation_status') = 0
     or pg_catalog.strpos(v_definition, 'p_offset') = 0
     or pg_catalog.strpos(v_definition, 'p_limit') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'p9_followup_inbox_reader_v3_contract: v2 pagination or canonical stage source is missing';
  end if;

  select count(*)
  into v_authenticated_grants
  from information_schema.routine_privileges privilege_row
  where privilege_row.specific_schema = 'public'
    and privilege_row.routine_name =
      'panel_list_followup_opportunity_candidates_scoped_v3'
    and privilege_row.grantee = 'authenticated'
    and privilege_row.privilege_type = 'EXECUTE';

  if v_authenticated_grants <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'p9_followup_inbox_reader_v3_contract: authenticated execute grant is missing';
  end if;
end;
$p9_followup_inbox_reader_v3_contract$;

do $p9_followup_inbox_reader_v3_stage_source$
declare
  v_definition text;
begin
  select pg_catalog.lower(
    pg_catalog.pg_get_functiondef(
      'public.panel_list_followup_opportunity_candidates_scoped_v3(uuid,uuid,text,integer,integer,integer)'::pg_catalog.regprocedure
    )
  )
  into v_definition;

  if pg_catalog.strpos(v_definition, 'opportunity_row.stage as opportunity_stage') = 0
     or pg_catalog.strpos(v_definition, 'join public.commercial_opportunities opportunity_row') = 0
     or pg_catalog.strpos(v_definition, 'opportunity_row.id = candidate.commercial_opportunity_id') = 0
     or pg_catalog.strpos(v_definition, 'opportunity_row.organization_id = p_organization_id') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'p9_followup_inbox_reader_v3_stage_source: opportunity_stage is not anchored to commercial_opportunities.stage';
  end if;
end;
$p9_followup_inbox_reader_v3_stage_source$;

do $p9_followup_inbox_reader_v3_conversation_status_separate$
declare
  v_result text;
begin
  select pg_catalog.pg_get_function_result(
    'public.panel_list_followup_opportunity_candidates_scoped_v3(uuid,uuid,text,integer,integer,integer)'::pg_catalog.regprocedure
  )
  into v_result;

  if pg_catalog.strpos(v_result, 'conversation_status text') = 0
     or pg_catalog.strpos(v_result, 'opportunity_stage text') = 0
     or pg_catalog.strpos(v_result, 'conversation_status text') >
        pg_catalog.strpos(v_result, 'opportunity_stage text') then
    raise exception using
      errcode = 'P0001',
      message = 'p9_followup_inbox_reader_v3_conversation_status_separate: conversation status and opportunity stage are not separate adjacent fields';
  end if;
end;
$p9_followup_inbox_reader_v3_conversation_status_separate$;

rollback;
