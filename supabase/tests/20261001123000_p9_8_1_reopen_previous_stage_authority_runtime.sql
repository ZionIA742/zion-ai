-- ZION / Pilar 9 / Bloco 8 / Etapa 8.1 / Passo 2
-- Runtime A-E. All fixtures and mutations are rolled back at the end.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_8_1_reopen_runtime_results (
  scenario text primary key,
  outcome text not null,
  sqlstate text,
  error_message text,
  opportunity_id uuid not null,
  before_stage text,
  after_stage text,
  before_lifecycle integer,
  after_lifecycle integer,
  reopened_event_count integer not null
) on commit preserve rows;

create temp table pg_temp._p9_8_1_reopen_runtime_fixtures (
  scenario text primary key,
  opportunity_id uuid not null,
  lead_id uuid not null,
  conversation_id uuid not null,
  session_id uuid not null,
  customer_id uuid not null,
  initial_stage text not null,
  evidence_message_id uuid,
  loss_event_id uuid,
  reopen_event_id uuid,
  reopen_idempotency_key text not null
) on commit preserve rows;

create temp table pg_temp._p9_8_1_reopen_runtime_scope (
  organization_id uuid not null,
  store_id uuid not null,
  user_id uuid not null
) on commit preserve rows;

insert into pg_temp._p9_8_1_reopen_runtime_fixtures (
  scenario, opportunity_id, lead_id, conversation_id, session_id, customer_id,
  initial_stage, reopen_idempotency_key
)
select fixture.scenario,
       gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
       gen_random_uuid(), fixture.initial_stage,
       'p9-8-1-runtime:' || lower(fixture.scenario) || ':' || gen_random_uuid()::text
from (values
  ('A', 'qualificacao'),
  ('B', 'qualificacao'),
  ('C', 'orcamento'),
  ('D', 'orcamento'),
  ('E', 'qualificacao')
) as fixture(scenario, initial_stage);

do $setup$
declare
  v_run_id uuid := gen_random_uuid();
  v_org_id uuid := gen_random_uuid();
  v_store_id uuid := gen_random_uuid();
  v_user_id uuid := gen_random_uuid();
  v_fixture record;
  v_link jsonb;
  v_message jsonb;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change,
    email_change_token_new, recovery_token, is_sso_user, is_anonymous
  ) values (
    v_user_id, gen_random_uuid(), 'authenticated', 'authenticated',
    'p9-8-1-reopen-runtime-' || v_run_id::text || '@example.test', '', now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('runner', true, 'fixture', 'p9_8_1_reopen_runtime'),
    now(), now(), '', '', '', '', false, false
  );

  insert into public.organizations (id, name)
  values (v_org_id, 'P9 8.1 Reopen Runtime ' || v_run_id::text);

  insert into public.memberships (organization_id, user_id, role)
  values (v_org_id, v_user_id, 'owner');

  insert into public.stores (id, organization_id, name, created_at)
  values (v_store_id, v_org_id, 'P9 8.1 Reopen Runtime ' || v_run_id::text, now());

  insert into pg_temp._p9_8_1_reopen_runtime_scope (organization_id, store_id, user_id)
  values (v_org_id, v_store_id, v_user_id);

  for v_fixture in
    select * from pg_temp._p9_8_1_reopen_runtime_fixtures order by scenario
  loop
    insert into public.customers (id, organization_id, display_name, normalized_name)
    values (
      v_fixture.customer_id, v_org_id,
      'P9 8.1 Runtime Customer ' || v_fixture.scenario || ' ' || v_run_id::text,
      'p9 8 1 runtime customer ' || lower(v_fixture.scenario) || ' ' || v_run_id::text
    );

    insert into public.customer_store_links (id, organization_id, store_id, customer_id)
    values (gen_random_uuid(), v_org_id, v_store_id, v_fixture.customer_id);

    insert into public.leads (id, organization_id, store_id, state, created_at, updated_at)
    values (
      v_fixture.lead_id, v_org_id, v_store_id, v_fixture.initial_stage, now(), now()
    );

    insert into public.conversations (
      id, organization_id, lead_id, status, is_human_active,
      last_status_reason, last_status_metadata, created_at
    ) values (
      v_fixture.conversation_id, v_org_id, v_fixture.lead_id,
      v_fixture.initial_stage, false, null, '{}'::jsonb, now()
    );

    insert into public.commercial_opportunities (
      id, organization_id, store_id, customer_id, origin_lead_id,
      primary_conversation_id, stage
    ) values (
      v_fixture.opportunity_id, v_org_id, v_store_id, v_fixture.customer_id,
      v_fixture.lead_id, v_fixture.conversation_id, v_fixture.initial_stage
    );

    insert into public.conversation_sessions (
      id, organization_id, store_id, conversation_id, status, started_at, closed_at
    ) values (
      v_fixture.session_id, v_org_id, v_store_id, v_fixture.conversation_id,
      'active', now(), null
    );

    select row_to_json(public.link_lead_to_customer(
      v_org_id, v_store_id, v_fixture.lead_id, v_fixture.customer_id,
      'manual', 'human', v_user_id, null,
      'P9 8.1 reopen runtime lead/customer fixture',
      'p9-8-1-runtime:lead:' || lower(v_fixture.scenario), v_run_id,
      jsonb_build_object('runner', true, 'scenario', v_fixture.scenario), now()
    )) into v_link;

    select row_to_json(public.link_commercial_session_context(
      v_org_id, v_store_id, v_fixture.session_id, v_fixture.customer_id,
      v_fixture.opportunity_id, (v_link ->> 'id')::uuid,
      'manual', 'human', v_user_id,
      'P9 8.1 reopen runtime commercial context fixture',
      'p9-8-1-runtime:context:' || lower(v_fixture.scenario), v_run_id,
      jsonb_build_object('runner', true, 'scenario', v_fixture.scenario), null
    )) into v_link;

    select row_to_json(public.insert_message(
      v_fixture.conversation_id, 'user', 'incoming', 'text',
      'P9 8.1 reopen runtime evidence ' || v_fixture.scenario,
      null, null,
      jsonb_build_object('runner', true, 'scenario', v_fixture.scenario,
                         'fixture_run_id', v_run_id::text)
    )) into v_message;

    update pg_temp._p9_8_1_reopen_runtime_fixtures
    set evidence_message_id = (v_message ->> 'id')::uuid
    where scenario = v_fixture.scenario;
  end loop;

end;
$setup$;

do $scenarios$
declare
  v_org_id uuid;
  v_store_id uuid;
  v_user_id uuid;
  v_fixture record;
  v_loss record;
  v_reopen record;
  v_opp_before public.commercial_opportunities;
  v_opp_after public.commercial_opportunities;
  v_loss_event public.commercial_opportunity_lifecycle_events;
  v_reopened_count integer;
  v_before_stage text;
  v_after_stage text;
  v_before_lifecycle integer;
  v_after_lifecycle integer;
  v_before_loss_event uuid;
  v_after_loss_event uuid;
  v_before_reopened_at timestamptz;
  v_after_reopened_at timestamptz;
  v_error_state text;
  v_error_message text;
  v_first_event_id uuid;
  v_first_stage text;
  v_first_cycle integer;
  v_second_event_id uuid;
  v_second_stage text;
  v_second_cycle integer;
begin
  select organization_id, store_id, user_id
  into strict v_org_id, v_store_id, v_user_id
  from pg_temp._p9_8_1_reopen_runtime_scope;

  -- C uses the already deployed specialized authority to move orcamento into negociacao.
  select * into strict v_fixture
  from pg_temp._p9_8_1_reopen_runtime_fixtures where scenario = 'C';
  select * into strict v_opp_before from public.commercial_opportunities
  where id = v_fixture.opportunity_id;
  begin
    select * into v_reopen
    from public.enter_commercial_opportunity_negotiation_by_system(
      v_org_id, v_store_id, v_fixture.opportunity_id,
      v_opp_before.lifecycle_cycle,
      'p9-8-1-runtime:material:C', 'payment_terms_negotiation',
      v_fixture.evidence_message_id, 'runtime material payment terms evidence',
      'runtime specialized authority', 'p9_8_1_runtime'
    );
  exception when others then
    raise exception using
      errcode = 'P0001',
      message = 'scenario C prerequisite failed: specialized negotiation authority: ' || sqlerrm;
  end;

  -- Loss is canonical for every scenario.
  for v_fixture in
    select * from pg_temp._p9_8_1_reopen_runtime_fixtures order by scenario
  loop
    select * into strict v_loss
    from public.mark_commercial_opportunity_lost_by_system(
      v_org_id, v_store_id, v_fixture.opportunity_id,
      'p9-8-1-runtime:loss:' || lower(v_fixture.scenario),
      'explicit_refusal', v_fixture.evidence_message_id,
      'P9 8.1 runtime canonical loss evidence ' || v_fixture.scenario,
      'system', 'p9_8_1_runtime'
    );

    update pg_temp._p9_8_1_reopen_runtime_fixtures
    set loss_event_id = v_loss.current_loss_event_id
    where scenario = v_fixture.scenario;
  end loop;

  -- A: qualificacao -> negociacao is rejected before mutation.
  select * into strict v_fixture from pg_temp._p9_8_1_reopen_runtime_fixtures where scenario = 'A';
  select * into strict v_opp_before from public.commercial_opportunities where id = v_fixture.opportunity_id;
  select * into strict v_loss_event from public.commercial_opportunity_lifecycle_events where id = v_fixture.loss_event_id;
  v_before_stage := v_opp_before.stage; v_before_lifecycle := v_opp_before.lifecycle_cycle;
  v_before_loss_event := v_opp_before.current_loss_event_id; v_before_reopened_at := v_opp_before.last_reopened_at;
  v_error_state := null; v_error_message := null;
  begin
    perform public.reopen_commercial_opportunity_by_system(
      v_org_id, v_store_id, v_fixture.opportunity_id, v_fixture.reopen_idempotency_key,
      'negociacao', 'P9 8.1 runtime mismatch A', 'p9_8_1_runtime'
    );
  exception when others then get stacked diagnostics v_error_state = returned_sqlstate, v_error_message = message_text;
  end;
  select * into strict v_opp_after from public.commercial_opportunities where id = v_fixture.opportunity_id;
  select count(*) into v_reopened_count from public.commercial_opportunity_lifecycle_events
  where commercial_opportunity_id = v_fixture.opportunity_id and event_type = 'reopened';
  insert into pg_temp._p9_8_1_reopen_runtime_results values (
    'A', case when v_error_state = '23514' and v_error_message = 'ZION_REOPEN_TARGET_STAGE_MISMATCH'
                   and v_opp_after.stage = 'perdido' and v_opp_after.lifecycle_cycle = v_before_lifecycle
                   and v_opp_after.current_loss_event_id = v_before_loss_event
                   and v_opp_after.last_reopened_at is not distinct from v_before_reopened_at
                   and v_loss_event.previous_stage = 'qualificacao'
                   and v_reopened_count = 0 then 'PASS' else 'FAIL' end,
    v_error_state, v_error_message, v_fixture.opportunity_id, v_before_stage, v_opp_after.stage,
    v_before_lifecycle, v_opp_after.lifecycle_cycle, v_reopened_count
  );

  -- B: qualificacao -> qualificacao succeeds and records previous_stage=perdido.
  select * into strict v_fixture from pg_temp._p9_8_1_reopen_runtime_fixtures where scenario = 'B';
  select * into strict v_opp_before from public.commercial_opportunities where id = v_fixture.opportunity_id;
  select * into strict v_loss_event from public.commercial_opportunity_lifecycle_events where id = v_fixture.loss_event_id;
  v_before_lifecycle := v_opp_before.lifecycle_cycle;
  select * into strict v_reopen from public.reopen_commercial_opportunity_by_system(
    v_org_id, v_store_id, v_fixture.opportunity_id, v_fixture.reopen_idempotency_key,
    'qualificacao', 'P9 8.1 runtime matching previous stage B', 'p9_8_1_runtime'
  );
  select * into strict v_opp_after from public.commercial_opportunities where id = v_fixture.opportunity_id;
  select count(*) into v_reopened_count from public.commercial_opportunity_lifecycle_events
  where commercial_opportunity_id = v_fixture.opportunity_id and event_type = 'reopened';
  insert into pg_temp._p9_8_1_reopen_runtime_results values (
    'B', case when v_opp_after.stage = 'qualificacao' and v_opp_after.lifecycle_cycle = v_before_lifecycle + 1
                   and v_opp_after.current_loss_event_id is null and v_reopened_count = 1
                   and v_loss_event.previous_stage = 'qualificacao'
                   and v_fixture.scenario = 'B'
                   and exists (select 1 from public.commercial_opportunity_lifecycle_events e where e.commercial_opportunity_id = v_fixture.opportunity_id and e.event_type = 'reopened' and e.previous_stage = 'perdido' and e.new_stage = 'qualificacao') then 'PASS' else 'FAIL' end,
    null, null, v_fixture.opportunity_id, 'perdido', v_opp_after.stage,
    v_before_lifecycle, v_opp_after.lifecycle_cycle, v_reopened_count
  );

  -- C: negociacao -> negociacao succeeds after specialized material entry.
  select * into strict v_fixture from pg_temp._p9_8_1_reopen_runtime_fixtures where scenario = 'C';
  select * into strict v_opp_before from public.commercial_opportunities where id = v_fixture.opportunity_id;
  select * into strict v_loss_event from public.commercial_opportunity_lifecycle_events where id = v_fixture.loss_event_id;
  v_before_lifecycle := v_opp_before.lifecycle_cycle;
  select * into strict v_reopen from public.reopen_commercial_opportunity_by_system(
    v_org_id, v_store_id, v_fixture.opportunity_id, v_fixture.reopen_idempotency_key,
    'negociacao', 'P9 8.1 runtime matching previous stage C', 'p9_8_1_runtime'
  );
  select * into strict v_opp_after from public.commercial_opportunities where id = v_fixture.opportunity_id;
  select count(*) into v_reopened_count from public.commercial_opportunity_lifecycle_events
  where commercial_opportunity_id = v_fixture.opportunity_id and event_type = 'reopened';
  insert into pg_temp._p9_8_1_reopen_runtime_results values (
    'C', case when v_opp_after.stage = 'negociacao' and v_opp_after.lifecycle_cycle = v_before_lifecycle + 1
                   and v_opp_after.current_loss_event_id is null and v_reopened_count = 1
                   and v_loss_event.previous_stage = 'negociacao'
                   and v_fixture.scenario = 'C'
                   and exists (select 1 from public.commercial_opportunity_lifecycle_events e where e.commercial_opportunity_id = v_fixture.opportunity_id and e.event_type = 'reopened' and e.previous_stage = 'perdido' and e.new_stage = 'negociacao') then 'PASS' else 'FAIL' end,
    null, null, v_fixture.opportunity_id, 'perdido', v_opp_after.stage,
    v_before_lifecycle, v_opp_after.lifecycle_cycle, v_reopened_count
  );

  -- D: orcamento -> negociacao is rejected by previous_stage authority.
  select * into strict v_fixture from pg_temp._p9_8_1_reopen_runtime_fixtures where scenario = 'D';
  select * into strict v_opp_before from public.commercial_opportunities where id = v_fixture.opportunity_id;
  select * into strict v_loss_event from public.commercial_opportunity_lifecycle_events where id = v_fixture.loss_event_id;
  v_before_lifecycle := v_opp_before.lifecycle_cycle; v_before_loss_event := v_opp_before.current_loss_event_id;
  v_error_state := null; v_error_message := null;
  begin
    perform public.reopen_commercial_opportunity_by_system(
      v_org_id, v_store_id, v_fixture.opportunity_id, v_fixture.reopen_idempotency_key,
      'negociacao', 'P9 8.1 runtime mismatch D', 'p9_8_1_runtime'
    );
  exception when others then get stacked diagnostics v_error_state = returned_sqlstate, v_error_message = message_text;
  end;
  select * into strict v_opp_after from public.commercial_opportunities where id = v_fixture.opportunity_id;
  select count(*) into v_reopened_count from public.commercial_opportunity_lifecycle_events
  where commercial_opportunity_id = v_fixture.opportunity_id and event_type = 'reopened';
  insert into pg_temp._p9_8_1_reopen_runtime_results values (
    'D', case when v_error_state = '23514' and v_error_message = 'ZION_REOPEN_TARGET_STAGE_MISMATCH'
                   and v_opp_after.stage = 'perdido' and v_opp_after.lifecycle_cycle = v_before_lifecycle
                   and v_opp_after.current_loss_event_id = v_before_loss_event
                   and v_loss_event.previous_stage = 'orcamento' and v_reopened_count = 0 then 'PASS' else 'FAIL' end,
    v_error_state, v_error_message, v_fixture.opportunity_id, 'perdido', v_opp_after.stage,
    v_before_lifecycle, v_opp_after.lifecycle_cycle, v_reopened_count
  );

  -- E: same payload replays once; an incompatible payload is rejected.
  select * into strict v_fixture from pg_temp._p9_8_1_reopen_runtime_fixtures where scenario = 'E';
  select * into strict v_opp_before from public.commercial_opportunities where id = v_fixture.opportunity_id;
  select * into strict v_loss_event from public.commercial_opportunity_lifecycle_events where id = v_fixture.loss_event_id;
  v_before_lifecycle := v_opp_before.lifecycle_cycle;
  select * into strict v_reopen from public.reopen_commercial_opportunity_by_system(
    v_org_id, v_store_id, v_fixture.opportunity_id, v_fixture.reopen_idempotency_key,
    'qualificacao', 'P9 8.1 runtime idempotent reopen E', 'p9_8_1_runtime'
  );
  v_first_event_id := (select id from public.commercial_opportunity_lifecycle_events where commercial_opportunity_id = v_fixture.opportunity_id and idempotency_key = v_fixture.reopen_idempotency_key);
  v_first_stage := v_reopen.stage; v_first_cycle := v_reopen.lifecycle_cycle;
  select * into strict v_reopen from public.reopen_commercial_opportunity_by_system(
    v_org_id, v_store_id, v_fixture.opportunity_id, v_fixture.reopen_idempotency_key,
    'qualificacao', 'P9 8.1 runtime idempotent reopen E', 'p9_8_1_runtime'
  );
  v_second_event_id := (select id from public.commercial_opportunity_lifecycle_events where commercial_opportunity_id = v_fixture.opportunity_id and idempotency_key = v_fixture.reopen_idempotency_key);
  v_second_stage := v_reopen.stage; v_second_cycle := v_reopen.lifecycle_cycle;
  v_error_state := null; v_error_message := null;
  begin
    perform public.reopen_commercial_opportunity_by_system(
      v_org_id, v_store_id, v_fixture.opportunity_id, v_fixture.reopen_idempotency_key,
      'negociacao', 'P9 8.1 runtime incompatible replay E', 'p9_8_1_runtime'
    );
  exception when others then get stacked diagnostics v_error_state = returned_sqlstate, v_error_message = message_text;
  end;
  select * into strict v_opp_after from public.commercial_opportunities where id = v_fixture.opportunity_id;
  select count(*) into v_reopened_count from public.commercial_opportunity_lifecycle_events
  where commercial_opportunity_id = v_fixture.opportunity_id and event_type = 'reopened';
  insert into pg_temp._p9_8_1_reopen_runtime_results values (
    'E', case when v_first_event_id = v_second_event_id and v_first_stage = v_second_stage
                   and v_first_cycle = v_second_cycle and v_reopened_count = 1
                   and v_error_state = '23505' and v_error_message = 'ZION_IDEMPOTENCY_KEY_REUSED'
                   and v_opp_after.lifecycle_cycle = v_first_cycle
                   and v_loss_event.previous_stage = 'qualificacao' then 'PASS' else 'FAIL' end,
    v_error_state, v_error_message, v_fixture.opportunity_id, 'perdido', v_opp_after.stage,
    v_before_lifecycle, v_opp_after.lifecycle_cycle, v_reopened_count
  );
end;
$scenarios$;

select scenario, outcome, sqlstate, error_message, opportunity_id,
       before_stage, after_stage, before_lifecycle, after_lifecycle,
       reopened_event_count
from pg_temp._p9_8_1_reopen_runtime_results
order by scenario;

do $guard$
declare
  v_failures text;
begin
  if (select count(*) from pg_temp._p9_8_1_reopen_runtime_results) <> 5 then
    raise exception using errcode = 'P0001', message = 'P9 8.1 runtime runner did not record A-E';
  end if;

  select string_agg(scenario || '=' || outcome, ', ' order by scenario)
  into v_failures
  from pg_temp._p9_8_1_reopen_runtime_results
  where outcome <> 'PASS';

  if v_failures is not null then
    raise exception using errcode = 'P0001', message = 'P9 8.1 runtime reopen failures: ' || v_failures;
  end if;
end;
$guard$;

rollback;
