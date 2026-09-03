begin;

set local lock_timeout = '5s';
set local statement_timeout = '240s';
set local idle_in_transaction_session_timeout = '240s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:commercial-action-readiness:manual-checks:v1', 0)
);

-- ============================================================================
-- P9 / Bloco 3 / Etapa 3.5-G
-- Manual checks for Commercial Action Readiness v1.
--
-- Rollback-only. Borrows one existing org/store/customer scope and creates two
-- temporary opportunities: one qualification-stage opportunity with a draft
-- quote, and one post-sale opportunity. A temporary policy/profile/checklist/
-- progress projection is built canonically and fully removed by ROLLBACK.
-- ============================================================================

do $preflight$
declare
  v_function oid := pg_catalog.to_regprocedure(
    'public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)'
  );
begin
  if v_function is null then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: action readiness migration is not installed';
  end if;

  if pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: internal action readiness resolver leaked EXECUTE';
  end if;

  if pg_catalog.to_regprocedure(
       'public.write_store_opportunity_gate_policy_internal(uuid,uuid,text,text,jsonb,text,uuid,text,text,text,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.write_commercial_opportunity_profile_by_system(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.materialize_commercial_opportunity_checklist_by_system(uuid,uuid,uuid,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.materialize_commercial_opportunity_checklist_progress_by_system(uuid,uuid,uuid,text)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'FIXTURE_FAIL: canonical Profile/Policy/Checklist/Progress writers are required';
  end if;
end;
$preflight$;

create temporary table pg_temp._p9_action_readiness_ctx (
  organization_id uuid not null,
  store_id uuid not null,
  customer_id uuid not null,
  qualification_opportunity_id uuid not null,
  post_sale_opportunity_id uuid not null,
  quote_id uuid not null
) on commit drop;

do $fixture_scope$
declare
  v_org_id uuid;
  v_store_id uuid;
  v_customer_id uuid;
  v_qual_opp uuid := '9f350545-0000-4000-8000-000000000201'::uuid;
  v_post_opp uuid := '9f350545-0000-4000-8000-000000000202'::uuid;
  v_quote_id uuid := '9f350545-0000-4000-8000-000000000203'::uuid;
begin
  select
    opportunity_row.organization_id,
    opportunity_row.store_id,
    opportunity_row.customer_id
  into v_org_id, v_store_id, v_customer_id
  from public.commercial_opportunities opportunity_row
  order by opportunity_row.id::text
  limit 1;

  if v_org_id is null or v_store_id is null or v_customer_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'FIXTURE_FAIL: runner requires one existing opportunity scope';
  end if;

  if exists (
    select 1
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id in (v_qual_opp, v_post_opp)
  ) or exists (
    select 1
    from public.sales_quotes quote_row
    where quote_row.id = v_quote_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'FIXTURE_FAIL: action readiness runner UUID collision';
  end if;

  insert into pg_temp._p9_action_readiness_ctx values (
    v_org_id,
    v_store_id,
    v_customer_id,
    v_qual_opp,
    v_post_opp,
    v_quote_id
  );

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    stage,
    lifecycle_cycle
  )
  values
    (v_qual_opp, v_org_id, v_store_id, v_customer_id, 'qualificacao', 1),
    (v_post_opp, v_org_id, v_store_id, v_customer_id, 'pos_venda', 1);

  -- Draft quote = quote Progress in_progress. That is enough for the P9
  -- commercial-prerequisite layer to say send_quote is commercially ready;
  -- the actual send route still owns PDF/version/approval/provider guards.
  insert into public.sales_quotes (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    creation_idempotency_key,
    creation_request_fingerprint,
    conversation_id,
    lead_id,
    quote_number,
    title,
    status,
    customer_name,
    subtotal_cents,
    discount_cents,
    total_cents,
    current_version_id,
    metadata
  )
  values (
    v_quote_id,
    v_org_id,
    v_store_id,
    v_qual_opp,
    'runner-action-readiness-quote-1',
    repeat('a', 64),
    null,
    null,
    'RUNNER-ACTION-READINESS-001',
    'Runner Action Readiness',
    'draft',
    'Runner',
    100000,
    0,
    100000,
    null,
    '{"runner":"p9_action_readiness_v1"}'::jsonb
  );
end;
$fixture_scope$;

do $canonical_projection$
declare
  v pg_temp._p9_action_readiness_ctx%rowtype;
  v_rules jsonb;
  v_policy record;
  v_profile record;
  v_checklist record;
  v_progress record;
begin
  select * into v from pg_temp._p9_action_readiness_ctx;

  -- If the store explicitly disables technical visits, temporarily enable it so
  -- this generic rollback fixture exercises the optional visit action. Missing
  -- settings remain acceptable because the fixture rule is match_mode=always.
  update public.store_operation_settings
  set offers_technical_visit = true
  where organization_id = v.organization_id
    and store_id = v.store_id;

  v_rules := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'rule_key','quote.always.optional','rule_priority',10,
      'item_kind','commercial_gate','item_key','quote','match_mode','always',
      'component_kind',null,'execution_kind',null,'applicability_state','optional',
      'reason_code','runner_quote_optional','metadata','{}'::jsonb
    ),
    pg_catalog.jsonb_build_object(
      'rule_key','technical_visit.always.optional','rule_priority',10,
      'item_kind','commercial_gate','item_key','technical_visit','match_mode','always',
      'component_kind',null,'execution_kind',null,'applicability_state','optional',
      'reason_code','runner_technical_visit_optional','metadata','{}'::jsonb
    ),
    pg_catalog.jsonb_build_object(
      'rule_key','post_sale.always.required','rule_priority',10,
      'item_kind','commercial_gate','item_key','post_sale','match_mode','always',
      'component_kind',null,'execution_kind',null,'applicability_state','required',
      'reason_code','runner_post_sale_required','metadata','{}'::jsonb
    )
  );

  select * into v_policy
  from public.write_store_opportunity_gate_policy_internal(
    v.organization_id,
    v.store_id,
    'p9:3.5:action-readiness-runner:policy:v1',
    repeat('b', 64),
    v_rules,
    'system',
    null,
    'manual_check_runner',
    'action_readiness_runner_policy',
    'p9_action_readiness_runner',
    '{"runner":true}'::jsonb
  );

  if not coalesce(v_policy.changed, false) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: runner policy was not created';
  end if;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  select * into v_profile
  from public.write_commercial_opportunity_profile_by_system(
    v.organization_id,
    v.store_id,
    v.qualification_opportunity_id,
    'p9:3.5:action-readiness-runner:profile:qualification',
    repeat('c', 64),
    'resolved',
    '[{"component_key":"runner_custom","component_kind":"custom","component_state":"resolved","pool_id":null,"catalog_item_id":null,"reference_text":"rollback action readiness runner","metadata":{}}]'::jsonb,
    '[]'::jsonb,
    'manual_check_runner',
    'action_readiness_runner_profile',
    'p9_action_readiness_runner',
    '{"runner":true,"opportunity":"qualification"}'::jsonb
  );

  if not coalesce(v_profile.changed, false) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: qualification runner profile was not created';
  end if;

  select * into v_checklist
  from public.materialize_commercial_opportunity_checklist_by_system(
    v.organization_id,
    v.store_id,
    v.qualification_opportunity_id,
    'runner:action-readiness:checklist:qualification'
  );

  select * into v_progress
  from public.materialize_commercial_opportunity_checklist_progress_by_system(
    v.organization_id,
    v.store_id,
    v.qualification_opportunity_id,
    'runner:action-readiness:progress:qualification'
  );

  if v_checklist.current_checklist_version_id is null
     or v_progress.current_progress_version_id is null then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: qualification current projections missing';
  end if;

  select * into v_profile
  from public.write_commercial_opportunity_profile_by_system(
    v.organization_id,
    v.store_id,
    v.post_sale_opportunity_id,
    'p9:3.5:action-readiness-runner:profile:post-sale',
    repeat('d', 64),
    'resolved',
    '[{"component_key":"runner_custom","component_kind":"custom","component_state":"resolved","pool_id":null,"catalog_item_id":null,"reference_text":"rollback action readiness runner","metadata":{}}]'::jsonb,
    '[]'::jsonb,
    'manual_check_runner',
    'action_readiness_runner_profile',
    'p9_action_readiness_runner',
    '{"runner":true,"opportunity":"post_sale"}'::jsonb
  );

  if not coalesce(v_profile.changed, false) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: post-sale runner profile was not created';
  end if;

  select * into v_checklist
  from public.materialize_commercial_opportunity_checklist_by_system(
    v.organization_id,
    v.store_id,
    v.post_sale_opportunity_id,
    'runner:action-readiness:checklist:post-sale'
  );

  select * into v_progress
  from public.materialize_commercial_opportunity_checklist_progress_by_system(
    v.organization_id,
    v.store_id,
    v.post_sale_opportunity_id,
    'runner:action-readiness:progress:post-sale'
  );

  if v_checklist.current_checklist_version_id is null
     or v_progress.current_progress_version_id is null then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: post-sale current projections missing';
  end if;

  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.role', '', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
end;
$canonical_projection$;

-- 1. send_quote: draft canonical quote artifact => commercially ready.
do $send_quote_ready$
declare
  v pg_temp._p9_action_readiness_ctx%rowtype;
  r1 record;
  r2 record;
begin
  select * into v from pg_temp._p9_action_readiness_ctx;

  select * into r1
  from public.p9_resolve_commercial_action_readiness_internal(
    v.organization_id, v.store_id, v.qualification_opportunity_id, 'send_quote'
  );

  select * into r2
  from public.p9_resolve_commercial_action_readiness_internal(
    v.organization_id, v.store_id, v.qualification_opportunity_id, 'send_quote'
  );

  if r1.readiness_state is distinct from 'ready'
     or r1.reason_code is distinct from 'send_quote_commercial_prerequisites_ready'
     or r1.authority_fingerprint !~ '^[0-9a-f]{64}$'
     or r1.authority_fingerprint is distinct from r2.authority_fingerprint
     or r1.readiness_basis is distinct from r2.readiness_basis
     or (r1.readiness_basis ->> 'route_local_guards_evaluated')::boolean is distinct from false then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_ACTION_READINESS_SEND_QUOTE_READY_FAILED',
      detail = pg_catalog.jsonb_build_object('first',pg_catalog.to_jsonb(r1),'second',pg_catalog.to_jsonb(r2))::text;
  end if;
end;
$send_quote_ready$;

-- 2. schedule_technical_visit: optional applicable visit + not_started => ready.
do $schedule_visit_ready$
declare
  v pg_temp._p9_action_readiness_ctx%rowtype;
  r record;
begin
  select * into v from pg_temp._p9_action_readiness_ctx;

  select * into r
  from public.p9_resolve_commercial_action_readiness_internal(
    v.organization_id, v.store_id, v.qualification_opportunity_id, 'schedule_technical_visit'
  );

  if r.readiness_state is distinct from 'ready'
     or r.reason_code is distinct from 'schedule_technical_visit_commercial_prerequisites_ready' then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_ACTION_READINESS_SCHEDULE_VISIT_READY_FAILED',
      detail = pg_catalog.to_jsonb(r)::text;
  end if;
end;
$schedule_visit_ready$;

-- 3. create_contract: no contract applicability gate in this controlled policy => fail closed.
do $create_contract_missing_gate$
declare
  v pg_temp._p9_action_readiness_ctx%rowtype;
  r record;
begin
  select * into v from pg_temp._p9_action_readiness_ctx;

  select * into r
  from public.p9_resolve_commercial_action_readiness_internal(
    v.organization_id, v.store_id, v.qualification_opportunity_id, 'create_contract'
  );

  if r.readiness_state is distinct from 'needs_resolution'
     or r.reason_code is distinct from 'action_readiness_target_gate_missing' then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_ACTION_READINESS_CONTRACT_FAIL_CLOSED_FAILED',
      detail = pg_catalog.to_jsonb(r)::text;
  end if;
end;
$create_contract_missing_gate$;

-- 4. conclusion outside pos_venda is blocked even with a complete current projection.
do $conclude_wrong_stage$
declare
  v pg_temp._p9_action_readiness_ctx%rowtype;
  r record;
begin
  select * into v from pg_temp._p9_action_readiness_ctx;

  select * into r
  from public.p9_resolve_commercial_action_readiness_internal(
    v.organization_id, v.store_id, v.qualification_opportunity_id, 'conclude_opportunity'
  );

  if r.readiness_state is distinct from 'blocked'
     or r.reason_code is distinct from 'conclude_opportunity_stage_not_pos_venda' then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_ACTION_READINESS_CONCLUDE_STAGE_BLOCK_FAILED',
      detail = pg_catalog.to_jsonb(r)::text;
  end if;
end;
$conclude_wrong_stage$;

-- 5. pos_venda + only optional non-target gates => conclusion business prerequisites ready.
do $conclude_ready$
declare
  v pg_temp._p9_action_readiness_ctx%rowtype;
  r record;
begin
  select * into v from pg_temp._p9_action_readiness_ctx;

  select * into r
  from public.p9_resolve_commercial_action_readiness_internal(
    v.organization_id, v.store_id, v.post_sale_opportunity_id, 'conclude_opportunity'
  );

  if r.readiness_state is distinct from 'ready'
     or r.reason_code is distinct from 'conclude_opportunity_commercial_prerequisites_ready'
     or pg_catalog.jsonb_array_length(r.blocking_items) <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_ACTION_READINESS_CONCLUDE_READY_FAILED',
      detail = pg_catalog.to_jsonb(r)::text;
  end if;
end;
$conclude_ready$;

-- 6. send_quote without a quote artifact => known blocked, not invented ready.
do $send_quote_not_prepared$
declare
  v pg_temp._p9_action_readiness_ctx%rowtype;
  r record;
begin
  select * into v from pg_temp._p9_action_readiness_ctx;

  select * into r
  from public.p9_resolve_commercial_action_readiness_internal(
    v.organization_id, v.store_id, v.post_sale_opportunity_id, 'send_quote'
  );

  if r.readiness_state is distinct from 'blocked'
     or r.reason_code is distinct from 'send_quote_quote_not_prepared' then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_ACTION_READINESS_SEND_QUOTE_NOT_PREPARED_FAILED',
      detail = pg_catalog.to_jsonb(r)::text;
  end if;
end;
$send_quote_not_prepared$;

-- 7. Unsupported action key is rejected, never coerced/fuzzy matched.
do $invalid_action$
declare
  v pg_temp._p9_action_readiness_ctx%rowtype;
begin
  select * into v from pg_temp._p9_action_readiness_ctx;

  begin
    perform 1
    from public.p9_resolve_commercial_action_readiness_internal(
      v.organization_id, v.store_id, v.qualification_opportunity_id, 'send-something'
    );

    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_ACTION_READINESS_INVALID_ACTION_ACCEPTED';
  exception
    when sqlstate '22023' then
      if sqlerrm is distinct from 'P9_ACTION_READINESS_ACTION_KEY_INVALID' then
        raise;
      end if;
  end;
end;
$invalid_action$;

-- 8. Static guards: explicit current only, no latest/max, no runtime-role EXECUTE.
do $structure$
declare
  v_function oid := pg_catalog.to_regprocedure(
    'public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)'
  );
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(v_function)
  into v_definition;

  if v_definition ~* 'order[[:space:]]+by[[:space:]]+(created_at|updated_at|version_number)[[:space:]]+desc'
     or v_definition ~* 'max[[:space:]]*\([[:space:]]*version_number'
     or v_definition ~* 'limit[[:space:]]+1'
     or pg_catalog.strpos(v_definition, 'commercial_opportunity_checklist_current') = 0
     or pg_catalog.strpos(v_definition, 'commercial_opportunity_checklist_progress_current') = 0
     or pg_catalog.strpos(v_definition, 'lifecycle_cycle') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_ACTION_READINESS_STRUCTURE_FAILED';
  end if;

  if pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_ACTION_READINESS_SECURITY_FAILED';
  end if;
end;
$structure$;

rollback;
