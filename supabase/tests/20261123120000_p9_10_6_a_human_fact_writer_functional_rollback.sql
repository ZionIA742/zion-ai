/*
  P9 10.6-A functional SQL preparation.

  Review-only runner: it uses existing, context-proven rows, writes only inside
  this transaction, emits one result row, and always rolls back. Run as a
  controlled SQL-editor session only after reviewing the selected fixture row.
  It never calls Meta, WhatsApp, AI, cron, queues, or any external provider.
*/
begin;

set local statement_timeout = '60s';
set local lock_timeout = '5s';
set local search_path = pg_catalog, pg_temp, public;
set local request.jwt.claim.role = 'service_role';

create temporary table p9_10_6_a_functional_result (
  verdict text not null,
  fixture_status text not null,
  human_provenance_ok boolean not null,
  false_provenance_rejected boolean not null,
  scope_isolation_ok boolean not null,
  idempotency_ok boolean not null,
  canonical_facts_preserved boolean not null,
  rollback_guaranteed boolean not null,
  details jsonb not null
) on commit drop;

create temporary table p9_10_6_a_baseline_events (
  id uuid primary key,
  row_json jsonb not null
) on commit drop;

create temporary table p9_10_6_a_baseline_current (
  row_json jsonb not null
) on commit drop;

do $runner$
declare
  v_fixture record;
  v_bad_fixture record;
  v_other_opportunity record;
  v_first record;
  v_second record;
  v_rejected boolean := false;
  v_isolated boolean := false;
  v_idempotent boolean := false;
  v_preserved boolean := false;
  v_bad_fixture_found boolean := false;
  v_other_opportunity_found boolean := false;
  v_provenance_sqlstate text;
  v_provenance_message text;
  v_scope_sqlstate text;
  v_scope_message text;
  v_harness_sqlstate text;
  v_harness_message text;
  v_operation_key text;
  v_before_event_count bigint;
  v_before_current_count bigint;
begin
  /* The joins reproduce the writer's proven organization/store/conversation/
     opportunity/customer evidence path. No literal business or UUID fixture
     is supplied by this runner. */
  select
    m.id as message_id,
    m.organization_id,
    m.store_id,
    m.conversation_id,
    m.conversation_session_id,
    m.commercial_session_context_link_id,
    o.id as commercial_opportunity_id,
    o.customer_id,
    m.sender,
    m.direction
  into v_fixture
  from public.messages m
  join public.conversation_sessions cs
    on cs.id = m.conversation_session_id
   and cs.organization_id = m.organization_id
   and cs.store_id = m.store_id
   and cs.conversation_id = m.conversation_id
  join public.commercial_session_context_links context_link
    on context_link.id = m.commercial_session_context_link_id
   and context_link.organization_id = m.organization_id
   and context_link.store_id = m.store_id
   and context_link.conversation_session_id = cs.id
  join public.commercial_opportunities o
    on o.id = context_link.commercial_opportunity_id
   and o.organization_id = m.organization_id
   and o.store_id = m.store_id
   and o.customer_id = context_link.customer_id
  where m.commercial_context_capture_state = 'captured'
    and lower(btrim(coalesce(m.sender, ''))) = 'human'
    and lower(btrim(coalesce(m.direction, ''))) = 'outgoing'
    and not exists (
      select 1
      from public.commercial_opportunity_qualification_facts_current current_row
      where current_row.organization_id = o.organization_id
        and current_row.store_id = o.store_id
        and current_row.commercial_opportunity_id = o.id
        and current_row.fact_key = 'need_summary'
    )
    and not exists (
      select 1
      from public.commercial_opportunity_qualification_fact_events event_row
      where event_row.organization_id = o.organization_id
        and event_row.store_id = o.store_id
        and event_row.commercial_opportunity_id = o.id
        and event_row.operation_key = 'p9-10-6-a-functional:' || m.id::text
    )
  order by m.created_at, m.id
  limit 1;

  if not found then
    insert into p9_10_6_a_functional_result
    values (
      'BLOQUEADO', 'BLOCKED_BY_FIXTURE_PREREQUISITE', false, false, false,
      false, false, true,
      jsonb_build_object(
        'reason', 'no captured human/outgoing message has a proven context link and an unused canonical fact slot',
        'required_sender', 'human',
        'required_direction', 'outgoing',
        'required_capture_state', 'captured',
        'persistent_write', false
      )
    );
    return;
  end if;

  select
    m.id as message_id,
    m.organization_id,
    m.store_id,
    m.conversation_id
  into v_bad_fixture
  from public.messages m
  join public.conversation_sessions cs
    on cs.id = m.conversation_session_id
   and cs.organization_id = m.organization_id
   and cs.store_id = m.store_id
   and cs.conversation_id = m.conversation_id
  join public.commercial_session_context_links context_link
    on context_link.id = m.commercial_session_context_link_id
   and context_link.organization_id = m.organization_id
   and context_link.store_id = m.store_id
   and context_link.conversation_session_id = cs.id
   and context_link.commercial_opportunity_id = v_fixture.commercial_opportunity_id
  where m.organization_id = v_fixture.organization_id
    and m.store_id = v_fixture.store_id
    and m.commercial_context_capture_state = 'captured'
    and (lower(btrim(coalesce(m.sender, ''))) <> 'human'
      or lower(btrim(coalesce(m.direction, ''))) <> 'outgoing')
    and m.id <> v_fixture.message_id
  order by m.created_at, m.id
  limit 1;

  /* Capture FOUND immediately after the negative-provenance SELECT. */
  v_bad_fixture_found := found;

  select o.id, o.organization_id, o.store_id
  into v_other_opportunity
  from public.commercial_opportunities o
  where (o.organization_id, o.store_id) is distinct from
        (v_fixture.organization_id, v_fixture.store_id)
    and o.id <> v_fixture.commercial_opportunity_id
  order by o.created_at, o.id
  limit 1;

  v_other_opportunity_found := found;

  if not v_bad_fixture_found or not v_other_opportunity_found then
    insert into p9_10_6_a_functional_result
    values (
      'BLOQUEADO', 'BLOCKED_BY_FIXTURE_PREREQUISITE', false, false, false,
      false, false, true,
      jsonb_build_object(
        'reason', 'real negative-provenance or cross-scope fixture is unavailable',
        'human_fixture_message_id', v_fixture.message_id,
        'persistent_write', false
      )
    );
    return;
  end if;

  v_operation_key := 'p9-10-6-a-functional:' || v_fixture.message_id::text;

  select count(*) into v_before_event_count
  from public.commercial_opportunity_qualification_fact_events e
  where e.organization_id = v_fixture.organization_id
    and e.store_id = v_fixture.store_id
    and e.commercial_opportunity_id = v_fixture.commercial_opportunity_id;
  select count(*) into v_before_current_count
  from public.commercial_opportunity_qualification_facts_current c
  where c.organization_id = v_fixture.organization_id
    and c.store_id = v_fixture.store_id
    and c.commercial_opportunity_id = v_fixture.commercial_opportunity_id;

  insert into p9_10_6_a_baseline_events (id, row_json)
  select e.id, to_jsonb(e)
  from public.commercial_opportunity_qualification_fact_events e
  where e.organization_id = v_fixture.organization_id
    and e.store_id = v_fixture.store_id
    and e.commercial_opportunity_id = v_fixture.commercial_opportunity_id;

  insert into p9_10_6_a_baseline_current (row_json)
  select to_jsonb(c)
  from public.commercial_opportunity_qualification_facts_current c
  where c.organization_id = v_fixture.organization_id
    and c.store_id = v_fixture.store_id
    and c.commercial_opportunity_id = v_fixture.commercial_opportunity_id;

  /* 1. Valid human/outgoing provenance and 4. first canonical write. */
  select * into v_first
  from public.write_commercial_opportunity_qualification_fact_by_system(
    v_fixture.organization_id,
    v_fixture.store_id,
    v_fixture.commercial_opportunity_id,
    v_operation_key,
    'need_summary',
    to_jsonb('P9 10.6-A functional rollback test'::text),
    'confirmed',
    'human_message',
    v_fixture.message_id,
    v_fixture.conversation_id,
    'p9_10_6_a_functional_test',
    false
  );

  /* 4. Same operation and payload must replay the canonical event. */
  select * into v_second
  from public.write_commercial_opportunity_qualification_fact_by_system(
    v_fixture.organization_id,
    v_fixture.store_id,
    v_fixture.commercial_opportunity_id,
    v_operation_key,
    'need_summary',
    to_jsonb('P9 10.6-A functional rollback test'::text),
    'confirmed',
    'human_message',
    v_fixture.message_id,
    v_fixture.conversation_id,
    'p9_10_6_a_functional_test',
    false
  );

  v_idempotent := v_first.event_id is not null
    and v_first.event_id = v_second.event_id
    and v_second.outcome in ('idempotent_replay_current', 'idempotent_replay_stale');
  v_preserved := (select count(*) from public.commercial_opportunity_qualification_fact_events e
                  where e.organization_id = v_fixture.organization_id
                    and e.store_id = v_fixture.store_id
                    and e.commercial_opportunity_id = v_fixture.commercial_opportunity_id)
                 = v_before_event_count + 1
    and (select count(*) from public.commercial_opportunity_qualification_facts_current c
         where c.organization_id = v_fixture.organization_id
           and c.store_id = v_fixture.store_id
           and c.commercial_opportunity_id = v_fixture.commercial_opportunity_id)
        = v_before_current_count + 1
    and not exists (
      select 1
      from p9_10_6_a_baseline_events b
      left join public.commercial_opportunity_qualification_fact_events e on e.id = b.id
      where e.id is null or to_jsonb(e) is distinct from b.row_json
    )
    and (
      select coalesce(
        jsonb_agg(b.row_json order by b.row_json::text),
        '[]'::jsonb
      )
      from p9_10_6_a_baseline_current b
    ) = (
      select coalesce(
        jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text),
        '[]'::jsonb
      )
      from public.commercial_opportunity_qualification_facts_current c
      where c.organization_id = v_fixture.organization_id
        and c.store_id = v_fixture.store_id
        and c.commercial_opportunity_id = v_fixture.commercial_opportunity_id
        and c.fact_key <> 'need_summary'
    );

  /* 2. Real message with false sender/direction must be rejected. */
  begin
    perform public.write_commercial_opportunity_qualification_fact_by_system(
      v_fixture.organization_id,
      v_fixture.store_id,
      v_fixture.commercial_opportunity_id,
      v_operation_key || ':false-provenance',
      'space_text',
      to_jsonb('must be rejected'::text),
      'confirmed',
      'human_message',
      v_bad_fixture.message_id,
      v_bad_fixture.conversation_id,
      'p9_10_6_a_functional_test',
      false
    );
  exception when others then
    get stacked diagnostics v_provenance_sqlstate = returned_sqlstate,
      v_provenance_message = message_text;
    v_rejected := v_provenance_sqlstate = '23514'
      and v_provenance_message = 'ZION_QFACT_HUMAN_PROVENANCE_INVALID';
  end;

  /* 3. All identifiers below are real, but the opportunity is another scope. */
  begin
    perform public.write_commercial_opportunity_qualification_fact_by_system(
      v_other_opportunity.organization_id,
      v_other_opportunity.store_id,
      v_other_opportunity.id,
      v_operation_key || ':wrong-scope',
      'space_text',
      to_jsonb('must be isolated'::text),
      'confirmed',
      'human_message',
      v_fixture.message_id,
      v_fixture.conversation_id,
      'p9_10_6_a_functional_test',
      false
    );
  exception when others then
    get stacked diagnostics v_scope_sqlstate = returned_sqlstate,
      v_scope_message = message_text;
    v_isolated := v_scope_sqlstate = '23503'
      and v_scope_message = 'qualification source message not found in scope';
  end;

  insert into p9_10_6_a_functional_result
  select
    case when v_idempotent and v_rejected and v_isolated and v_preserved
      then 'PASS' else 'BLOQUEADO' end,
    'ELIGIBLE_FIXTURES_SELECTED',
    v_first.event_id is not null,
    v_rejected,
    v_isolated,
    v_idempotent,
    v_preserved,
    true,
    jsonb_build_object(
      'organization_id', v_fixture.organization_id,
      'store_id', v_fixture.store_id,
      'conversation_id', v_fixture.conversation_id,
      'commercial_opportunity_id', v_fixture.commercial_opportunity_id,
      'human_message_id', v_fixture.message_id,
      'false_provenance_message_id', v_bad_fixture.message_id,
      'cross_scope_opportunity_id', v_other_opportunity.id,
      'first_outcome', v_first.outcome,
      'second_outcome', v_second.outcome,
      'false_provenance_sqlstate', coalesce(v_provenance_sqlstate, '<not captured>'),
      'false_provenance_message', coalesce(v_provenance_message, '<not captured>'),
      'scope_sqlstate', coalesce(v_scope_sqlstate, '<not captured>'),
      'scope_message', coalesce(v_scope_message, '<not captured>'),
      'persistent_write', false
    );
exception when others then
  get stacked diagnostics v_harness_sqlstate = returned_sqlstate,
    v_harness_message = message_text;
  insert into p9_10_6_a_functional_result
  values (
    'BLOQUEADO', 'HARNESS_ERROR', false, false, false, false, false, true,
    jsonb_build_object('sqlstate', v_harness_sqlstate, 'message', v_harness_message, 'persistent_write', false)
  );
end;
$runner$;

select * from p9_10_6_a_functional_result;

rollback;
