begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;
-- SQL Editor executes this rollback-only runner as the real postgres session.
-- Do not forge a service_role JWT claim: hardened commercial session-context
-- writers reject claim/session mismatches. Keep request identity explicitly clean.
set local request.jwt.claim.role = '';
set local request.jwt.claim.sub = '';
set local request.jwt.claims = '{}';

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    '20261007150500_p9_8_6_final_commercial_condition_manual_checks',
    0
  )
);

-- =============================================================================
-- ZION / P9 / Bloco 8 / Etapa 8.6
-- REAL-SUT rollback-only runner.
--
-- No production/DEV fixture is assumed. Every business row used by the tests is
-- created inside this transaction and the runner ends in ROLLBACK.
-- There is no optional scenario state: a missing fixture/function is a FAIL or ERROR.
-- =============================================================================

create temp table pg_temp.p9_8_6_results (
  n integer primary key,
  name text not null,
  status text not null check (status in ('PASS','FAIL','ERROR')),
  details text null
) on commit drop;

insert into pg_temp.p9_8_6_results(n,name,status,details)
select n, names.name, 'FAIL', 'not executed'
from pg_catalog.generate_series(1,28) n
join lateral (
  select (array[
    'surface_and_security_installed',
    'generic_guard_uses_exact_capability_not_first_latest',
    'transaction_local_fixture_and_cycle_projection',
    'acceptance_alone_does_not_change_stage',
    'generic_negotiated_close_bypass_rejected',
    'noncurrent_quote_version_rejected',
    'foreign_same_store_negotiation_cycle_rejected',
    'cross_tenant_negotiation_cycle_rejected',
    'happy_path_materializes_condition_and_closes_atomically',
    'same_operation_and_fingerprint_replays_exact_result',
    'operation_key_fingerprint_conflict_rejected',
    'cycle_and_acceptance_uniqueness_enforced',
    'final_condition_resolver_returns_exact_current_lineage',
    'canonical_contract_lineage_passes_before_renegotiation',
    'post_accept_renegotiation_creates_new_cycle_same_lifecycle',
    'renegotiation_baseline_captures_old_accepted_proposal',
    'old_condition_superseded_immediately',
    'final_condition_resolver_is_stale_during_renegotiation',
    'create_contract_readiness_observes_stale_final_condition',
    'old_contract_downstream_lineage_blocked_immediately',
    'old_negotiation_cycle_rejected_after_renegotiation',
    'old_accepted_q1_cannot_be_reused_before_q2_exists',
    'stale_acceptance_rejected_after_q2_becomes_current',
    'q2_new_acceptance_new_final_condition_restores_current_lineage',
    'direct_bloco6_closure_requires_no_final_condition',
    'supersession_failure_rolls_back_renegotiation_atomically',
    'historical_acceptance_contract_and_conditions_are_preserved',
    'runner_integrity_and_rollback_ready'
  ])[n] as name
) names on true;

create temp table pg_temp.p9_8_6_ctx (
  run_id uuid not null,
  org_id uuid not null,
  store_id uuid not null,
  customer_id uuid not null,
  lead_id uuid not null,
  lead_link_id uuid not null,
  conversation_id uuid not null,
  session_id uuid not null,
  actor_id uuid not null,
  opportunity_id uuid not null,
  lifecycle_cycle integer not null,
  negotiation_cycle_1 uuid not null,
  quote_1 uuid not null,
  version_1 uuid not null,
  acceptance_message_1 uuid not null,
  acceptance_1 uuid not null,
  noncurrent_quote uuid not null,
  noncurrent_version uuid not null,
  condition_1 uuid null,
  close_event_1 uuid null,
  contract_1 uuid null,
  renegotiation_cycle_2 uuid null,
  quote_2 uuid null,
  version_2 uuid null,
  acceptance_message_2 uuid null,
  acceptance_2 uuid null,
  condition_2 uuid null,
  close_event_2 uuid null,
  other_opportunity_id uuid not null,
  other_cycle_id uuid not null,
  other_org_id uuid not null,
  other_store_id uuid not null,
  other_customer_id uuid not null,
  other_tenant_opportunity_id uuid not null,
  other_tenant_cycle_id uuid not null,
  direct_opportunity_id uuid null,
  direct_quote_id uuid null,
  direct_version_id uuid null,
  direct_acceptance_id uuid null
) on commit drop;

create or replace function pg_temp.p9_8_6_record(
  p_n integer,
  p_name text,
  p_status text,
  p_details text default null
)
returns void
language plpgsql
as $function$
begin
  update pg_temp.p9_8_6_results
  set name = p_name,
      status = p_status,
      details = p_details
  where n = p_n;

  raise notice '% %: % -- %', p_status, p_n, p_name, coalesce(p_details,'');
end;
$function$;

create or replace function pg_temp.p9_8_6_assert(
  p_n integer,
  p_name text,
  p_ok boolean,
  p_details text default null
)
returns void
language plpgsql
as $function$
begin
  perform pg_temp.p9_8_6_record(
    p_n,
    p_name,
    case when coalesce(p_ok,false) then 'PASS' else 'FAIL' end,
    p_details
  );
end;
$function$;

create or replace function pg_temp.p9_8_6_expect_error(
  p_n integer,
  p_name text,
  p_sql text,
  p_expected_message text default null
)
returns void
language plpgsql
as $function$
begin
  begin
    execute p_sql;
    perform pg_temp.p9_8_6_record(
      p_n,
      p_name,
      'FAIL',
      'expected error was not raised: ' || coalesce(p_expected_message,'<any>')
    );
  exception when others then
    perform pg_temp.p9_8_6_record(
      p_n,
      p_name,
      case
        when p_expected_message is null
          or pg_catalog.strpos(pg_catalog.lower(sqlerrm), pg_catalog.lower(p_expected_message)) > 0
        then 'PASS'
        else 'FAIL'
      end,
      sqlstate || ' ' || sqlerrm
    );
  end;
end;
$function$;

create or replace function pg_temp.p9_8_6_insert_cycle_event(
  p_org uuid,
  p_store uuid,
  p_opportunity uuid,
  p_customer uuid,
  p_lifecycle integer,
  p_previous_stage text,
  p_reason_code text,
  p_label text
)
returns uuid
language plpgsql
as $function$
declare
  v_id uuid := gen_random_uuid();
  v_event_key text;
  v_evidence_type text := case
    when p_reason_code = 'visit_viable_concrete_offer_required'
      then 'material_negotiation_price_counteroffer'
    when p_reason_code = 'renegotiation_required'
      then 'material_negotiation_price_counteroffer'
    else 'material_negotiation_discount_request'
  end;
begin
  v_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
    p_org,
    p_store,
    p_opportunity,
    p_lifecycle,
    'stage_transition',
    p_previous_stage,
    'negociacao',
    'system',
    null,
    p_reason_code,
    null,
    'p9_8_6_runner',
    v_evidence_type,
    null,
    p_label
  );

  insert into public.commercial_opportunity_lifecycle_events(
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    customer_id,
    lifecycle_cycle,
    event_type,
    previous_stage,
    new_stage,
    reason_code,
    evidence_type,
    evidence_summary,
    actor_type,
    source,
    metadata,
    idempotency_key,
    event_key
  ) values (
    v_id,
    p_org,
    p_store,
    p_opportunity,
    p_customer,
    p_lifecycle,
    'stage_transition',
    p_previous_stage,
    'negociacao',
    p_reason_code,
    v_evidence_type,
    p_label,
    'system',
    'p9_8_6_runner',
    '{}'::jsonb,
    'p9_8_6_cycle:' || v_id::text,
    v_event_key
  );

  return v_id;
end;
$function$;

create or replace function pg_temp.p9_8_6_make_sent_quote(
  p_org uuid,
  p_store uuid,
  p_opportunity uuid,
  p_lead uuid,
  p_conversation uuid,
  p_label text,
  p_total integer,
  p_set_current boolean
)
returns table(quote_id uuid, version_id uuid)
language plpgsql
as $function$
declare
  v_quote uuid := gen_random_uuid();
  v_version uuid := gen_random_uuid();
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  insert into public.sales_quotes(
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    conversation_id,
    lead_id,
    quote_number,
    title,
    status,
    customer_name,
    customer_phone,
    valid_until,
    subtotal_cents,
    discount_cents,
    total_cents,
    metadata
  ) values (
    v_quote,
    p_org,
    p_store,
    p_opportunity,
    p_conversation,
    p_lead,
    'P986-' || pg_catalog.upper(pg_catalog.left(pg_catalog.replace(v_quote::text,'-',''),12)),
    'P9 8.6 ' || p_label,
    'sent',
    'P9 8.6 Runner Customer',
    '5511999999999',
    ((v_now at time zone 'UTC')::date + 30),
    p_total,
    0,
    p_total,
    pg_catalog.jsonb_build_object('runner','p9_8_6','label',p_label)
  );

  insert into public.sales_quote_versions(
    id,
    quote_id,
    organization_id,
    store_id,
    version_number,
    status,
    quote_kind,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    generated_by,
    quote_snapshot,
    created_at,
    sent_at
  ) values (
    v_version,
    v_quote,
    p_org,
    p_store,
    1,
    'sent',
    null,
    'zion-store-files',
    p_org::text || '/' || p_store::text || '/p9-8-6/' || v_quote::text || '/v1.pdf',
    'p9-8-6-' || p_label || '.pdf',
    'application/pdf',
    1000,
    'system',
    pg_catalog.jsonb_build_object(
      'quote', pg_catalog.jsonb_build_object(
        'id', v_quote::text,
        'subtotalCents', p_total,
        'discountCents', 0,
        'totalCents', p_total
      ),
      'items', pg_catalog.jsonb_build_array()
    ),
    v_now,
    v_now
  );

  update public.sales_quotes
  set current_version_id = v_version
  where id = v_quote;

  if p_set_current then
    perform *
    from public.set_current_commercial_proposal_from_sent_quote_by_system(
      p_org,
      p_store,
      p_opportunity,
      v_quote,
      v_version,
      'current_commercial_proposal:' || p_opportunity::text || ':' || v_quote::text || ':' || v_version::text,
      'p9_8_6_runner'
    );
  end if;

  return query select v_quote, v_version;
end;
$function$;

create or replace function pg_temp.p9_8_6_insert_acceptance(
  p_org uuid,
  p_store uuid,
  p_opportunity uuid,
  p_lifecycle integer,
  p_quote uuid,
  p_version uuid,
  p_message uuid,
  p_actor uuid
)
returns uuid
language plpgsql
as $function$
declare
  v_id uuid := gen_random_uuid();
  v_customer uuid;
  v_signal_at timestamptz;
begin
  select opportunity_row.customer_id
  into v_customer
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_opportunity
    and opportunity_row.organization_id = p_org
    and opportunity_row.store_id = p_store;

  select message_row.created_at
  into v_signal_at
  from public.messages message_row
  where message_row.id = p_message;

  insert into public.commercial_proposal_acceptance_events(
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    customer_id,
    lifecycle_cycle,
    quote_id,
    quote_version_id,
    source_message_id,
    signal_kind,
    customer_signal_at,
    confirmed_by_user_id,
    accepted_at
  ) values (
    v_id,
    p_org,
    p_store,
    p_opportunity,
    v_customer,
    p_lifecycle,
    p_quote,
    p_version,
    p_message,
    'customer_accepted_quote',
    v_signal_at,
    p_actor,
    pg_catalog.clock_timestamp()
  );

  return v_id;
end;
$function$;

create or replace function pg_temp.p9_8_6_make_material_message(
  p_org uuid,
  p_store uuid,
  p_customer uuid,
  p_lead_link uuid,
  p_opportunity uuid,
  p_conversation uuid,
  p_label text,
  p_content text,
  p_material_kind text
)
returns uuid
language plpgsql
as $function$
declare
  v_message public.messages%rowtype;
  v_cmir record;
  v_classification record;
begin
  select *
  into v_message
  from public.insert_message(
    p_conversation,
    'user',
    'incoming',
    'text',
    p_content,
    'p9_8_6_msg:' || p_label || ':' || gen_random_uuid()::text,
    null,
    '{}'::jsonb
  );

  select *
  into v_cmir
  from public.write_commercial_message_intent_resolution_by_system(
    p_org,
    p_store,
    v_message.id,
    p_customer,
    p_lead_link,
    'p9_8_6_cmir:' || p_label || ':' || v_message.id::text,
    'continue_same_intent',
    'same_intent',
    p_opportunity,
    null,
    'ai',
    '{}'::jsonb,
    'sales_ai.intent_resolution'
  );

  select *
  into v_classification
  from public.write_commercial_message_material_classification_by_system(
    p_org,
    p_store,
    v_message.id,
    p_customer,
    p_opportunity,
    p_material_kind,
    'confirmed',
    p_content,
    'p9_8_6_class:' || p_label || ':' || v_message.id::text,
    null,
    '{}'::jsonb,
    'sales_ai_material_negotiation',
    'v1'
  );

  return v_message.id;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 1-2. Static installed contract.
-- -----------------------------------------------------------------------------
do $surface$
declare
  v_guard_def text;
  v_readiness_def text;
  v_lineage_def text;
  v_ok boolean;
begin
  begin
    v_ok :=
      pg_catalog.to_regclass('public.commercial_final_conditions') is not null
      and pg_catalog.to_regclass('public.commercial_final_condition_transition_authority') is not null
      and pg_catalog.to_regprocedure('public.p9_resolve_current_commercial_final_condition_internal(uuid,uuid,uuid)') is not null
      and pg_catalog.to_regprocedure('public.read_current_commercial_final_condition_by_system(uuid,uuid,uuid)') is not null
      and pg_catalog.to_regprocedure('public.materialize_accepted_negotiated_condition_by_system(uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text)') is not null
      and pg_catalog.to_regprocedure('public.p9_readiness_v2_pre_final_condition(uuid,uuid,uuid,text)') is not null
      and pg_catalog.to_regprocedure('public.p9_contract_lineage_pre_final_condition(uuid,uuid,uuid)') is not null
      and exists(
        select 1 from pg_catalog.pg_attribute a
        where a.attrelid='public.commercial_opportunities'::regclass
          and a.attname='current_negotiation_cycle_id'
          and not a.attisdropped
      )
      and exists(
        select 1 from pg_catalog.pg_class c
        where c.oid='public.commercial_final_conditions'::regclass
          and c.relrowsecurity and c.relforcerowsecurity
      );

    perform pg_temp.p9_8_6_assert(
      1,'surface_and_security_installed',v_ok,
      'Final Condition table/resolver/boundary/current-cycle projection and forced RLS'
    );

    v_guard_def := pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'public.p9_guard_negotiated_final_condition_transition()'::regprocedure
    ));
    v_readiness_def := pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)'::regprocedure
    ));
    v_lineage_def := pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)'::regprocedure
    ));

    perform pg_temp.p9_8_6_assert(
      2,
      'generic_guard_uses_exact_capability_not_first_latest',
      pg_catalog.strpos(v_guard_def,'commercial_final_condition_transition_authority') > 0
      and pg_catalog.strpos(v_guard_def,'current_negotiation_cycle_id') > 0
      and pg_catalog.strpos(v_guard_def,'order by') = 0
      and pg_catalog.strpos(v_guard_def,'limit 1') = 0
      and pg_catalog.strpos(v_readiness_def,'p9_resolve_current_commercial_final_condition_internal') > 0
      and pg_catalog.strpos(v_lineage_def,'p9_resolve_current_commercial_final_condition_internal') > 0,
      'exact transaction capability + active cycle pointer; no first/latest cycle inference'
    );
  exception when others then
    perform pg_temp.p9_8_6_record(1,'surface_and_security_installed','ERROR',sqlstate||' '||sqlerrm);
    perform pg_temp.p9_8_6_record(2,'generic_guard_uses_exact_capability_not_first_latest','ERROR',sqlstate||' '||sqlerrm);
  end;
end;
$surface$;

-- -----------------------------------------------------------------------------
-- 3. Self-contained fixture.
-- -----------------------------------------------------------------------------
do $fixture$
declare
  v_run uuid := gen_random_uuid();
  v_org uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_lead uuid := gen_random_uuid();
  v_lead_link uuid := gen_random_uuid();
  v_conversation uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_opp uuid := gen_random_uuid();
  v_cycle uuid;
  v_quote uuid;
  v_version uuid;
  v_noncurrent_quote uuid;
  v_noncurrent_version uuid;
  v_message public.messages%rowtype;
  v_acceptance uuid;
  v_link record;

  v_other_opp uuid := gen_random_uuid();
  v_other_cycle uuid;

  v_other_org uuid := gen_random_uuid();
  v_other_store uuid := gen_random_uuid();
  v_other_customer uuid := gen_random_uuid();
  v_other_tenant_opp uuid := gen_random_uuid();
  v_other_tenant_cycle uuid;
begin
  begin
    insert into auth.users(id) values(v_actor);

    insert into public.organizations(id,name,subscription_status)
    values(v_org,'P9 8.6 runner org '||pg_catalog.left(v_run::text,8),'active');

    insert into public.stores(id,organization_id,name)
    values(v_store,v_org,'P9 8.6 runner store');

    insert into public.customers(id,organization_id,display_name,normalized_name)
    values(v_customer,v_org,'P9 8.6 Customer','p9 8 6 customer');

    insert into public.customer_store_links(organization_id,store_id,customer_id)
    values(v_org,v_store,v_customer);

    insert into public.memberships(organization_id,user_id,role,is_active)
    values(v_org,v_actor,'admin',true);

    insert into public.leads(
      id,organization_id,store_id,name,phone,state,created_at,updated_at
    ) values(
      v_lead,v_org,v_store,'P9 8.6 Lead',
      '55119'||pg_catalog.translate(pg_catalog.left(pg_catalog.replace(v_run::text,'-',''),8),'abcdef','123456'),
      'novo_lead',pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()
    );

    insert into public.lead_customer_links(
      id,organization_id,store_id,lead_id,customer_id,status,
      source,linked_by_actor_type,linked_at,metadata
    ) values(
      v_lead_link,v_org,v_store,v_lead,v_customer,'active',
      'manual','migration',pg_catalog.clock_timestamp(),'{}'::jsonb
    );

    insert into public.conversations(
      id,organization_id,lead_id,status,is_human_active,created_at
    ) values(
      v_conversation,v_org,v_lead,'open',false,pg_catalog.clock_timestamp()
    );

    insert into public.commercial_opportunities(
      id,organization_id,store_id,customer_id,origin_lead_id,
      primary_conversation_id,stage,lifecycle_cycle
    ) values(
      v_opp,v_org,v_store,v_customer,v_lead,v_conversation,'negociacao',1
    );

    v_cycle := pg_temp.p9_8_6_insert_cycle_event(
      v_org,v_store,v_opp,v_customer,1,'orcamento',
      'concrete_quote_objection_required','P9 8.6 initial negotiation cycle'
    );

    insert into public.conversation_sessions(
      id,organization_id,store_id,conversation_id,status
    ) values(v_session,v_org,v_store,v_conversation,'active');

    select * into v_link
    from public.link_commercial_session_context(
      v_org,v_store,v_session,v_customer,v_opp,v_lead_link,
      'migration','migration',null,'p9-8-6:'||v_run::text,
      'p9-8-6:context:'||v_run::text,null,'{}'::jsonb,null
    );

    select q.quote_id,q.version_id into v_quote,v_version
    from pg_temp.p9_8_6_make_sent_quote(
      v_org,v_store,v_opp,v_lead,v_conversation,'Q1',100000,true
    ) q;

    select q.quote_id,q.version_id into v_noncurrent_quote,v_noncurrent_version
    from pg_temp.p9_8_6_make_sent_quote(
      v_org,v_store,v_opp,v_lead,v_conversation,'QX-noncurrent',120000,false
    ) q;

    select * into v_message
    from public.insert_message(
      v_conversation,'user','incoming','text','Aceito a proposta Q1.',
      'p9_8_6_accept_q1:'||v_run::text,null,'{}'::jsonb
    );

    v_acceptance := pg_temp.p9_8_6_insert_acceptance(
      v_org,v_store,v_opp,1,v_quote,v_version,v_message.id,v_actor
    );

    -- Same store / other opportunity cycle.
    insert into public.commercial_opportunities(
      id,organization_id,store_id,customer_id,stage,lifecycle_cycle
    ) values(v_other_opp,v_org,v_store,v_customer,'negociacao',1);

    v_other_cycle := pg_temp.p9_8_6_insert_cycle_event(
      v_org,v_store,v_other_opp,v_customer,1,'orcamento',
      'concrete_quote_objection_required','P9 8.6 other opportunity cycle'
    );

    -- Other tenant/store cycle.
    insert into public.organizations(id,name,subscription_status)
    values(v_other_org,'P9 8.6 other tenant','active');

    insert into public.stores(id,organization_id,name)
    values(v_other_store,v_other_org,'P9 8.6 other tenant store');

    insert into public.customers(id,organization_id,display_name,normalized_name)
    values(v_other_customer,v_other_org,'P9 8.6 Other Customer','p9 8 6 other customer');

    insert into public.customer_store_links(organization_id,store_id,customer_id)
    values(v_other_org,v_other_store,v_other_customer);

    insert into public.commercial_opportunities(
      id,organization_id,store_id,customer_id,stage,lifecycle_cycle
    ) values(v_other_tenant_opp,v_other_org,v_other_store,v_other_customer,'negociacao',1);

    v_other_tenant_cycle := pg_temp.p9_8_6_insert_cycle_event(
      v_other_org,v_other_store,v_other_tenant_opp,v_other_customer,1,'orcamento',
      'concrete_quote_objection_required','P9 8.6 cross tenant cycle'
    );

    insert into pg_temp.p9_8_6_ctx(
      run_id,org_id,store_id,customer_id,lead_id,lead_link_id,conversation_id,
      session_id,actor_id,opportunity_id,lifecycle_cycle,negotiation_cycle_1,
      quote_1,version_1,acceptance_message_1,acceptance_1,
      noncurrent_quote,noncurrent_version,
      other_opportunity_id,other_cycle_id,
      other_org_id,other_store_id,other_customer_id,
      other_tenant_opportunity_id,other_tenant_cycle_id
    ) values(
      v_run,v_org,v_store,v_customer,v_lead,v_lead_link,v_conversation,
      v_session,v_actor,v_opp,1,v_cycle,
      v_quote,v_version,v_message.id,v_acceptance,
      v_noncurrent_quote,v_noncurrent_version,
      v_other_opp,v_other_cycle,
      v_other_org,v_other_store,v_other_customer,
      v_other_tenant_opp,v_other_tenant_cycle
    );

    perform pg_temp.p9_8_6_assert(
      3,
      'transaction_local_fixture_and_cycle_projection',
      exists(
        select 1 from public.commercial_opportunities o
        where o.id=v_opp
          and o.stage='negociacao'
          and o.lifecycle_cycle=1
          and o.current_negotiation_cycle_id=v_cycle
      )
      and exists(
        select 1
        from public.p9_resolve_current_commercial_proposal_internal(v_org,v_store,v_opp) p
        where p.proposal_state='available'
          and p.reason_code='current_proposal_authority_valid'
          and p.current_quote_id=v_quote
          and p.current_quote_version_id=v_version
      )
      and exists(
        select 1
        from public.p9_resolve_current_commercial_proposal_acceptance_internal(v_org,v_store,v_opp) a
        where a.acceptance_state='accepted'
          and a.reason_code='current_proposal_accepted'
          and a.acceptance_event_id=v_acceptance
      ),
      'self-contained Q1/V1 accepted negotiation fixture; no DEV fixture dependency'
    );
  exception when others then
    perform pg_temp.p9_8_6_record(
      3,'transaction_local_fixture_and_cycle_projection','ERROR',sqlstate||' '||sqlerrm
    );
  end;
end;
$fixture$;

-- -----------------------------------------------------------------------------
-- 4-8. Pre-close guards.
-- -----------------------------------------------------------------------------
do $preclose_guards$
declare
  c pg_temp.p9_8_6_ctx%rowtype;
  v_stage text;
  v_sql text;
begin
  begin
    select * into strict c from pg_temp.p9_8_6_ctx;

    select stage into v_stage
    from public.commercial_opportunities
    where id=c.opportunity_id;

    perform pg_temp.p9_8_6_assert(
      4,'acceptance_alone_does_not_change_stage',
      v_stage='negociacao',
      'acceptance exists but stage is still negociacao'
    );

    v_sql := pg_catalog.format(
      $sql$select * from public.transition_commercial_opportunity_stage_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L,%L,%L,%L,%L::uuid,%L,%L
      )$sql$,
      c.org_id,c.store_id,c.opportunity_id,
      'p9_8_6_generic_bypass:'||c.run_id::text,
      'fechamento_pagamento','generic bypass probe','accepted_negotiated_condition',
      c.acceptance_message_1,'runner bypass','p9_8_6_runner'
    );
    perform pg_temp.p9_8_6_expect_error(
      5,'generic_negotiated_close_bypass_rejected',v_sql,'P9_FINAL_COMMERCIAL_CONDITION_REQUIRED'
    );

    v_sql := pg_catalog.format(
      $sql$select * from public.materialize_accepted_negotiated_condition_by_system(
        %L::uuid,%L::uuid,%L::uuid,1,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L
      )$sql$,
      c.org_id,c.store_id,c.opportunity_id,c.negotiation_cycle_1,
      c.noncurrent_quote,c.noncurrent_version,c.acceptance_1,
      'p9_8_6_noncurrent:'||c.run_id::text,'fp-noncurrent-'||c.run_id::text
    );
    perform pg_temp.p9_8_6_expect_error(
      6,'noncurrent_quote_version_rejected',v_sql,'P9_FINAL_CONDITION_CURRENT_PROPOSAL_MISMATCH'
    );

    v_sql := pg_catalog.format(
      $sql$select * from public.materialize_accepted_negotiated_condition_by_system(
        %L::uuid,%L::uuid,%L::uuid,1,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L
      )$sql$,
      c.org_id,c.store_id,c.opportunity_id,c.other_cycle_id,
      c.quote_1,c.version_1,c.acceptance_1,
      'p9_8_6_other_cycle:'||c.run_id::text,'fp-other-cycle-'||c.run_id::text
    );
    perform pg_temp.p9_8_6_expect_error(
      7,'foreign_same_store_negotiation_cycle_rejected',v_sql,'P9_FINAL_CONDITION_NEGOTIATION_CYCLE_STALE'
    );

    v_sql := pg_catalog.format(
      $sql$select * from public.materialize_accepted_negotiated_condition_by_system(
        %L::uuid,%L::uuid,%L::uuid,1,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L
      )$sql$,
      c.org_id,c.store_id,c.opportunity_id,c.other_tenant_cycle_id,
      c.quote_1,c.version_1,c.acceptance_1,
      'p9_8_6_cross_tenant:'||c.run_id::text,'fp-cross-tenant-'||c.run_id::text
    );
    perform pg_temp.p9_8_6_expect_error(
      8,'cross_tenant_negotiation_cycle_rejected',v_sql,'P9_FINAL_CONDITION_NEGOTIATION_CYCLE_STALE'
    );
  exception when others then
    perform pg_temp.p9_8_6_record(4,'acceptance_alone_does_not_change_stage','ERROR',sqlstate||' '||sqlerrm);
    perform pg_temp.p9_8_6_record(5,'generic_negotiated_close_bypass_rejected','ERROR',sqlstate||' '||sqlerrm);
    perform pg_temp.p9_8_6_record(6,'noncurrent_quote_version_rejected','ERROR',sqlstate||' '||sqlerrm);
    perform pg_temp.p9_8_6_record(7,'foreign_same_store_negotiation_cycle_rejected','ERROR',sqlstate||' '||sqlerrm);
    perform pg_temp.p9_8_6_record(8,'cross_tenant_negotiation_cycle_rejected','ERROR',sqlstate||' '||sqlerrm);
  end;
end;
$preclose_guards$;

-- -----------------------------------------------------------------------------
-- 9-13. First Final Condition and idempotency.
-- -----------------------------------------------------------------------------
do $first_close$
declare
  c pg_temp.p9_8_6_ctx%rowtype;
  v_row record;
  v_replay record;
  v_resolved record;
  v_condition_count bigint;
  v_cycle_count bigint;
  v_acceptance_count bigint;
  v_sql text;
  v_operation text;
  v_fp text;
begin
  begin
    select * into strict c from pg_temp.p9_8_6_ctx;
    v_operation := 'p9_8_6_close_q1:'||c.run_id::text;
    v_fp := pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_operation,'UTF8'),'sha256'),
      'hex'
    );

    select * into v_row
    from public.materialize_accepted_negotiated_condition_by_system(
      c.org_id,c.store_id,c.opportunity_id,c.lifecycle_cycle,c.negotiation_cycle_1,
      c.quote_1,c.version_1,c.acceptance_1,v_operation,v_fp
    );

    update pg_temp.p9_8_6_ctx
    set condition_1=v_row.condition_id,
        close_event_1=v_row.lifecycle_event_id
    where run_id=c.run_id;

    perform pg_temp.p9_8_6_assert(
      9,'happy_path_materializes_condition_and_closes_atomically',
      v_row.condition_id is not null
      and v_row.condition_state='current'
      and not v_row.replayed
      and v_row.lifecycle_event_id is not null
      and exists(
        select 1 from public.commercial_opportunities o
        where o.id=c.opportunity_id
          and o.stage='fechamento_pagamento'
          and o.current_negotiation_cycle_id is null
      )
      and exists(
        select 1 from public.commercial_opportunity_lifecycle_events e
        where e.id=v_row.lifecycle_event_id
          and e.previous_stage='negociacao'
          and e.new_stage='fechamento_pagamento'
          and e.reason_code='accepted_negotiated_condition_required'
      ),
      'C1 + negotiated close lifecycle event committed in one transaction'
    );

    select * into v_replay
    from public.materialize_accepted_negotiated_condition_by_system(
      c.org_id,c.store_id,c.opportunity_id,c.lifecycle_cycle,c.negotiation_cycle_1,
      c.quote_1,c.version_1,c.acceptance_1,v_operation,v_fp
    );

    perform pg_temp.p9_8_6_assert(
      10,'same_operation_and_fingerprint_replays_exact_result',
      v_replay.replayed
      and v_replay.condition_id=v_row.condition_id
      and v_replay.lifecycle_event_id=v_row.lifecycle_event_id,
      'replay returns exact C1 and exact closure lifecycle event'
    );

    v_sql := pg_catalog.format(
      $sql$select * from public.materialize_accepted_negotiated_condition_by_system(
        %L::uuid,%L::uuid,%L::uuid,1,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L
      )$sql$,
      c.org_id,c.store_id,c.opportunity_id,c.negotiation_cycle_1,
      c.quote_1,c.version_1,c.acceptance_1,v_operation,v_fp||':different'
    );
    perform pg_temp.p9_8_6_expect_error(
      11,'operation_key_fingerprint_conflict_rejected',v_sql,'P9_FINAL_CONDITION_OPERATION_KEY_REUSED'
    );

    select count(*) into v_condition_count
    from public.commercial_final_conditions f
    where f.organization_id=c.org_id
      and f.store_id=c.store_id
      and f.commercial_opportunity_id=c.opportunity_id
      and f.lifecycle_cycle=1
      and f.condition_state='current';

    select count(*) into v_cycle_count
    from public.commercial_final_conditions f
    where f.organization_id=c.org_id
      and f.store_id=c.store_id
      and f.commercial_opportunity_id=c.opportunity_id
      and f.lifecycle_cycle=1
      and f.negotiation_cycle_id=c.negotiation_cycle_1;

    select count(*) into v_acceptance_count
    from public.commercial_final_conditions f
    where f.organization_id=c.org_id
      and f.store_id=c.store_id
      and f.acceptance_event_id=c.acceptance_1;

    perform pg_temp.p9_8_6_assert(
      12,'cycle_and_acceptance_uniqueness_enforced',
      v_condition_count=1 and v_cycle_count=1 and v_acceptance_count=1,
      'one current condition; one Final Condition per cycle and acceptance'
    );

    select * into v_resolved
    from public.p9_resolve_current_commercial_final_condition_internal(
      c.org_id,c.store_id,c.opportunity_id
    );

    perform pg_temp.p9_8_6_assert(
      13,'final_condition_resolver_returns_exact_current_lineage',
      v_resolved.condition_state='current'
      and v_resolved.reason_code='final_condition_current'
      and v_resolved.condition_id=v_row.condition_id
      and v_resolved.negotiation_cycle_id=c.negotiation_cycle_1
      and v_resolved.quote_id=c.quote_1
      and v_resolved.quote_version_id=c.version_1
      and v_resolved.acceptance_event_id=c.acceptance_1,
      'resolver uses exact cycle + Q1/V1 + A1'
    );
  exception when others then
    perform pg_temp.p9_8_6_record(9,'happy_path_materializes_condition_and_closes_atomically','ERROR',sqlstate||' '||sqlerrm);
    perform pg_temp.p9_8_6_record(10,'same_operation_and_fingerprint_replays_exact_result','ERROR',sqlstate||' '||sqlerrm);
    perform pg_temp.p9_8_6_record(11,'operation_key_fingerprint_conflict_rejected','ERROR',sqlstate||' '||sqlerrm);
    perform pg_temp.p9_8_6_record(12,'cycle_and_acceptance_uniqueness_enforced','ERROR',sqlstate||' '||sqlerrm);
    perform pg_temp.p9_8_6_record(13,'final_condition_resolver_returns_exact_current_lineage','ERROR',sqlstate||' '||sqlerrm);
  end;
end;
$first_close$;

-- -----------------------------------------------------------------------------
-- 14. Canonical historical contract anchored in Q1/V1/A1.
-- -----------------------------------------------------------------------------
do $contract_before_renegotiation$
declare
  c pg_temp.p9_8_6_ctx%rowtype;
  v_contract uuid := gen_random_uuid();
  v_guard record;
  v_accepted_at timestamptz;
begin
  begin
    select * into strict c from pg_temp.p9_8_6_ctx;

    select acceptance_row.accepted_at
    into v_accepted_at
    from public.commercial_proposal_acceptance_events acceptance_row
    where acceptance_row.id=c.acceptance_1
      and acceptance_row.organization_id=c.org_id
      and acceptance_row.store_id=c.store_id;

    insert into public.sales_contracts(
      id,organization_id,store_id,lead_id,conversation_id,quote_id,quote_version_id,
      current_version_id,contract_number,status,title,customer_name,customer_phone,
      currency,subtotal_cents,discount_cents,total_cents,payment_terms,delivery_terms,
      warranty_terms,contract_terms,valid_until,metadata
    ) values(
      v_contract,c.org_id,c.store_id,c.lead_id,c.conversation_id,c.quote_1,c.version_1,
      null,'P986-C-'||pg_catalog.left(pg_catalog.replace(v_contract::text,'-',''),16),
      'pending_review','P9 8.6 Q1 contract','P9 8.6 Runner Customer','5511999999999',
      'BRL',100000,0,100000,null,null,null,null,
      ((pg_catalog.clock_timestamp() at time zone 'UTC')::date+30),
      pg_catalog.jsonb_build_object(
        'source','accepted_quote_version_snapshot',
        'commercial_opportunity_id',c.opportunity_id,
        'quote_version_id',c.version_1,
        'proposal_acceptance_event_id',c.acceptance_1,
        'proposal_acceptance_source_message_id',c.acceptance_message_1,
        'proposal_accepted_at',v_accepted_at,
        'created_via','create_sales_contract_from_current_accepted_proposal_by_system'
      )
    );

    update pg_temp.p9_8_6_ctx set contract_1=v_contract where run_id=c.run_id;

    select * into v_guard
    from public.p9_assert_sales_contract_current_proposal_lineage_internal(
      c.org_id,c.store_id,v_contract
    );

    perform pg_temp.p9_8_6_assert(
      14,'canonical_contract_lineage_passes_before_renegotiation',
      v_guard.commercial_opportunity_id=c.opportunity_id
      and v_guard.quote_id=c.quote_1
      and v_guard.quote_version_id=c.version_1
      and v_guard.acceptance_event_id=c.acceptance_1,
      'canonical Q1 contract matches current Final Condition C1'
    );
  exception when others then
    perform pg_temp.p9_8_6_record(14,'canonical_contract_lineage_passes_before_renegotiation','ERROR',sqlstate||' '||sqlerrm);
  end;
end;
$contract_before_renegotiation$;

-- -----------------------------------------------------------------------------
-- 26. Atomic rollback probe runs BEFORE the real renegotiation.
--
-- The runner is rollback-only and therefore all scenarios share one PostgreSQL
-- transaction_id. Running a second fechamento_pagamento -> negociacao transition
-- later for the same opportunity would be an artificial harness ambiguity in the
-- legacy lifecycle projection guard. Probe rollback now; the failed subtransaction
-- leaves no lifecycle event, so the real renegotiation below remains the only
-- persisted transition of this shape for this opportunity/transaction.
-- -----------------------------------------------------------------------------
create or replace function pg_temp.p9_8_6_force_supersede_failure()
returns trigger
language plpgsql
as $function$
begin
  raise exception using errcode='P0001', message='P9_8_6_RUNNER_FORCED_SUPERSESSION_FAILURE';
end;
$function$;

create trigger p9_8_6_runner_force_supersede_failure
before update on public.commercial_final_conditions
for each row execute function pg_temp.p9_8_6_force_supersede_failure();

do $rollback_probe$
declare
  c pg_temp.p9_8_6_ctx%rowtype;
  v_message uuid;
  v_failed boolean := false;
  v_operation text;
  v_before_stage text;
  v_after_stage text;
  v_before_state text;
  v_after_state text;
  v_before_event_count bigint;
  v_after_event_count bigint;
begin
  begin
    select * into strict c from pg_temp.p9_8_6_ctx;
    v_operation := 'p9_8_6_reneg_rollback_before_n2:'||c.run_id::text;

    v_message := pg_temp.p9_8_6_make_material_message(
      c.org_id,c.store_id,c.customer_id,c.lead_link_id,c.opportunity_id,
      c.conversation_id,'reneg-rollback-before-n2','Quero renegociar, mas force rollback.',
      'price_counteroffer'
    );

    select stage into v_before_stage
    from public.commercial_opportunities where id=c.opportunity_id;
    select condition_state into v_before_state
    from public.commercial_final_conditions where id=c.condition_1;
    select count(*) into v_before_event_count
    from public.commercial_opportunity_lifecycle_events e
    where e.organization_id=c.org_id
      and e.store_id=c.store_id
      and e.commercial_opportunity_id=c.opportunity_id
      and e.idempotency_key=v_operation;

    begin
      perform *
      from public.enter_commercial_opportunity_negotiation_by_system(
        c.org_id,c.store_id,c.opportunity_id,c.lifecycle_cycle,
        v_operation,'price_counteroffer',v_message,
        'Quero renegociar, mas force rollback.','forced rollback before real renegotiation','p9_8_6_runner'
      );
    exception when others then
      v_failed := sqlerrm='P9_8_6_RUNNER_FORCED_SUPERSESSION_FAILURE';
    end;

    select stage into v_after_stage
    from public.commercial_opportunities where id=c.opportunity_id;
    select condition_state into v_after_state
    from public.commercial_final_conditions where id=c.condition_1;
    select count(*) into v_after_event_count
    from public.commercial_opportunity_lifecycle_events e
    where e.organization_id=c.org_id
      and e.store_id=c.store_id
      and e.commercial_opportunity_id=c.opportunity_id
      and e.idempotency_key=v_operation;

    perform pg_temp.p9_8_6_assert(
      26,'supersession_failure_rolls_back_renegotiation_atomically',
      v_failed
      and v_before_stage='fechamento_pagamento'
      and v_after_stage=v_before_stage
      and v_before_state='current'
      and v_after_state=v_before_state
      and v_before_event_count=0
      and v_after_event_count=0
      and exists(
        select 1 from public.commercial_opportunities o
        where o.id=c.opportunity_id and o.current_negotiation_cycle_id is null
      ),
      'forced Final Condition update failure leaves no renegotiation event/projection/stage change'
    );
  exception when others then
    perform pg_temp.p9_8_6_record(26,'supersession_failure_rolls_back_renegotiation_atomically','ERROR',sqlstate||' '||sqlerrm);
  end;
end;
$rollback_probe$;

drop trigger p9_8_6_runner_force_supersede_failure
  on public.commercial_final_conditions;

-- -----------------------------------------------------------------------------
-- 15-22. Real post-accept renegotiation and immediate stale window closure.
-- -----------------------------------------------------------------------------
do $renegotiation$
declare
  c pg_temp.p9_8_6_ctx%rowtype;
  v_message uuid;
  v_reneg record;
  v_event public.commercial_opportunity_lifecycle_events%rowtype;
  v_condition public.commercial_final_conditions%rowtype;
  v_resolved record;
  v_readiness record;
  v_guard_blocked boolean := false;
  v_guard_error text;
  v_sql text;
begin
  begin
    select * into strict c from pg_temp.p9_8_6_ctx;

    v_message := pg_temp.p9_8_6_make_material_message(
      c.org_id,c.store_id,c.customer_id,c.lead_link_id,c.opportunity_id,
      c.conversation_id,'reneg-2','Quero renegociar o valor da proposta.',
      'price_counteroffer'
    );

    select * into v_reneg
    from public.enter_commercial_opportunity_negotiation_by_system(
      c.org_id,c.store_id,c.opportunity_id,c.lifecycle_cycle,
      'p9_8_6_reneg_2:'||c.run_id::text,
      'price_counteroffer',v_message,
      'Quero renegociar o valor da proposta.',
      'post-accept renegotiation','p9_8_6_runner'
    );

    update pg_temp.p9_8_6_ctx
    set renegotiation_cycle_2=v_reneg.lifecycle_event_id
    where run_id=c.run_id;

    select * into v_event
    from public.commercial_opportunity_lifecycle_events
    where id=v_reneg.lifecycle_event_id;

    perform pg_temp.p9_8_6_assert(
      15,'post_accept_renegotiation_creates_new_cycle_same_lifecycle',
      v_reneg.lifecycle_event_id is not null
      and v_reneg.lifecycle_event_id<>c.negotiation_cycle_1
      and v_reneg.lifecycle_cycle=c.lifecycle_cycle
      and v_event.previous_stage='fechamento_pagamento'
      and v_event.new_stage='negociacao'
      and v_event.reason_code='renegotiation_required'
      and exists(
        select 1 from public.commercial_opportunities o
        where o.id=c.opportunity_id
          and o.stage='negociacao'
          and o.lifecycle_cycle=c.lifecycle_cycle
          and o.current_negotiation_cycle_id=v_reneg.lifecycle_event_id
      ),
      'N2 is a new lifecycle-event UUID while lifecycle_cycle stays 1'
    );

    perform pg_temp.p9_8_6_assert(
      16,'renegotiation_baseline_captures_old_accepted_proposal',
      v_event.metadata #>> '{p9_8_6_renegotiation_baseline,quote_id}' = c.quote_1::text
      and v_event.metadata #>> '{p9_8_6_renegotiation_baseline,quote_version_id}' = c.version_1::text
      and v_event.metadata #>> '{p9_8_6_renegotiation_baseline,acceptance_event_id}' = c.acceptance_1::text,
      'N2 immutably records Q1/V1/A1 baseline before any Q2 exists'
    );

    select * into v_condition
    from public.commercial_final_conditions
    where id=c.condition_1;

    perform pg_temp.p9_8_6_assert(
      17,'old_condition_superseded_immediately',
      v_condition.condition_state='superseded'
      and v_condition.superseded_at is not null
      and v_condition.superseded_by_negotiation_cycle_id=v_reneg.lifecycle_event_id,
      'C1 becomes historical in the same renegotiation transaction'
    );

    select * into v_resolved
    from public.p9_resolve_current_commercial_final_condition_internal(
      c.org_id,c.store_id,c.opportunity_id
    );

    perform pg_temp.p9_8_6_assert(
      18,'final_condition_resolver_is_stale_during_renegotiation',
      v_resolved.condition_state='stale'
      and v_resolved.reason_code='final_condition_superseded_by_renegotiation'
      and v_resolved.negotiation_cycle_id=v_reneg.lifecycle_event_id,
      'no current Final Condition exists during the post-accept stale window'
    );

    select * into v_readiness
    from public.p9_resolve_commercial_action_readiness_internal(
      c.org_id,c.store_id,c.opportunity_id,'create_contract'
    );

    perform pg_temp.p9_8_6_assert(
      19,'create_contract_readiness_observes_stale_final_condition',
      v_readiness.readiness_state is distinct from 'ready'
      and v_readiness.readiness_basis ->> 'final_condition_required' = 'true'
      and v_readiness.readiness_basis ->> 'final_condition_state' = 'stale',
      'readiness composition sees stale Final Condition even if older gates also block'
    );

    begin
      perform *
      from public.p9_assert_sales_contract_current_proposal_lineage_internal(
        c.org_id,c.store_id,c.contract_1
      );
    exception when others then
      v_guard_blocked := sqlerrm='P9_FINAL_COMMERCIAL_CONDITION_STALE';
      v_guard_error := sqlstate||' '||sqlerrm;
    end;

    perform pg_temp.p9_8_6_assert(
      20,'old_contract_downstream_lineage_blocked_immediately',
      v_guard_blocked,
      coalesce(v_guard_error,'guard unexpectedly permitted Q1 contract')
    );

    v_sql := pg_catalog.format(
      $sql$select * from public.materialize_accepted_negotiated_condition_by_system(
        %L::uuid,%L::uuid,%L::uuid,1,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L
      )$sql$,
      c.org_id,c.store_id,c.opportunity_id,c.negotiation_cycle_1,
      c.quote_1,c.version_1,c.acceptance_1,
      'p9_8_6_old_cycle_after_reneg:'||c.run_id::text,
      'fp-old-cycle-after-reneg-'||c.run_id::text
    );
    perform pg_temp.p9_8_6_expect_error(
      21,'old_negotiation_cycle_rejected_after_renegotiation',v_sql,
      'P9_FINAL_CONDITION_NEGOTIATION_CYCLE_STALE'
    );

    v_sql := pg_catalog.format(
      $sql$select * from public.materialize_accepted_negotiated_condition_by_system(
        %L::uuid,%L::uuid,%L::uuid,1,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L
      )$sql$,
      c.org_id,c.store_id,c.opportunity_id,v_reneg.lifecycle_event_id,
      c.quote_1,c.version_1,c.acceptance_1,
      'p9_8_6_reuse_q1:'||c.run_id::text,
      'fp-reuse-q1-'||c.run_id::text
    );
    perform pg_temp.p9_8_6_expect_error(
      22,'old_accepted_q1_cannot_be_reused_before_q2_exists',v_sql,
      'P9_FINAL_CONDITION_RENEGOTIATION_BASELINE_STALE'
    );
  exception when others then
    perform pg_temp.p9_8_6_record(15,'post_accept_renegotiation_creates_new_cycle_same_lifecycle','ERROR',sqlstate||' '||sqlerrm);
    perform pg_temp.p9_8_6_record(16,'renegotiation_baseline_captures_old_accepted_proposal','ERROR',sqlstate||' '||sqlerrm);
    perform pg_temp.p9_8_6_record(17,'old_condition_superseded_immediately','ERROR',sqlstate||' '||sqlerrm);
    perform pg_temp.p9_8_6_record(18,'final_condition_resolver_is_stale_during_renegotiation','ERROR',sqlstate||' '||sqlerrm);
    perform pg_temp.p9_8_6_record(19,'create_contract_readiness_observes_stale_final_condition','ERROR',sqlstate||' '||sqlerrm);
    perform pg_temp.p9_8_6_record(20,'old_contract_downstream_lineage_blocked_immediately','ERROR',sqlstate||' '||sqlerrm);
    perform pg_temp.p9_8_6_record(21,'old_negotiation_cycle_rejected_after_renegotiation','ERROR',sqlstate||' '||sqlerrm);
    perform pg_temp.p9_8_6_record(22,'old_accepted_q1_cannot_be_reused_before_q2_exists','ERROR',sqlstate||' '||sqlerrm);
  end;
end;
$renegotiation$;

-- -----------------------------------------------------------------------------
-- 23-24. Q2/V2 + new acceptance + new Final Condition.
--
-- IMPORTANT HARNESS NOTE:
-- The production stage guard scopes projection events by transaction_id and
-- requires exactly one matching previous_stage/new_stage transition in that
-- transaction. A rollback-only runner necessarily uses one outer transaction.
-- Reusing the scenario-9 opportunity for a second negociacao -> fechamento
-- transition would therefore create a false ZION_STAGE_TRANSITION_EVENT_AMBIGUOUS.
--
-- These scenarios use a second self-contained opportunity already representing
-- the post-accept renegotiation window. Historical Q1/A1/C1 and N2 are seeded as
-- immutable facts; the REAL 8.6 boundary performs exactly one negotiated close
-- for this opportunity. This preserves rollback-only while still exercising the
-- real Q2 acceptance/final-condition/downstream authority.
-- -----------------------------------------------------------------------------
create temp table pg_temp.p9_8_6_q2_ctx (
  opportunity_id uuid not null,
  conversation_id uuid not null,
  session_id uuid not null,
  negotiation_cycle_1 uuid not null,
  renegotiation_cycle_2 uuid not null,
  quote_1 uuid not null,
  version_1 uuid not null,
  acceptance_message_1 uuid not null,
  acceptance_1 uuid not null,
  condition_1 uuid not null,
  quote_2 uuid not null,
  version_2 uuid not null,
  acceptance_message_2 uuid not null,
  acceptance_2 uuid not null,
  condition_2 uuid null,
  close_event_2 uuid null
) on commit drop;

do $q2_fixture_and_close$
declare
  c pg_temp.p9_8_6_ctx%rowtype;
  v_opp uuid := gen_random_uuid();
  v_conversation uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_cycle_1 uuid;
  v_cycle_2 uuid;
  v_quote_1 uuid;
  v_version_1 uuid;
  v_quote_2 uuid;
  v_version_2 uuid;
  v_message_1 public.messages%rowtype;
  v_message_2 public.messages%rowtype;
  v_acceptance_1 uuid;
  v_acceptance_2 uuid;
  v_condition_1 uuid := gen_random_uuid();
  v_link record;
  v_sql text;
  v_row record;
  v_old public.commercial_final_conditions%rowtype;
  v_current public.commercial_final_conditions%rowtype;
  v_operation text;
  v_fp text;
begin
  begin
    select * into strict c from pg_temp.p9_8_6_ctx;

    insert into public.conversations(
      id,organization_id,lead_id,status,is_human_active,created_at
    ) values(
      v_conversation,c.org_id,c.lead_id,'open',false,pg_catalog.clock_timestamp()
    );

    insert into public.commercial_opportunities(
      id,organization_id,store_id,customer_id,origin_lead_id,
      primary_conversation_id,stage,lifecycle_cycle
    ) values(
      v_opp,c.org_id,c.store_id,c.customer_id,c.lead_id,
      v_conversation,'negociacao',c.lifecycle_cycle
    );

    insert into public.conversation_sessions(
      id,organization_id,store_id,conversation_id,status
    ) values(
      v_session,c.org_id,c.store_id,v_conversation,'active'
    );

    select * into v_link
    from public.link_commercial_session_context(
      c.org_id,c.store_id,v_session,c.customer_id,v_opp,c.lead_link_id,
      'migration','migration',null,'p9-8-6-q2:'||c.run_id::text,
      'p9-8-6-q2:context:'||c.run_id::text,null,'{}'::jsonb,null
    );

    v_cycle_1 := pg_temp.p9_8_6_insert_cycle_event(
      c.org_id,c.store_id,v_opp,c.customer_id,c.lifecycle_cycle,'orcamento',
      'concrete_quote_objection_required','P9 8.6 Q2 fixture N1'
    );

    select q.quote_id,q.version_id into v_quote_1,v_version_1
    from pg_temp.p9_8_6_make_sent_quote(
      c.org_id,c.store_id,v_opp,c.lead_id,v_conversation,'Q2-fixture-old-Q1',101000,true
    ) q;

    select * into v_message_1
    from public.insert_message(
      v_conversation,'user','incoming','text','Aceito a proposta antiga Q1.',
      'p9_8_6_q2_fixture_accept_q1:'||c.run_id::text,null,'{}'::jsonb
    );

    v_acceptance_1 := pg_temp.p9_8_6_insert_acceptance(
      c.org_id,c.store_id,v_opp,c.lifecycle_cycle,
      v_quote_1,v_version_1,v_message_1.id,c.actor_id
    );

    -- Seed the canonical post-accept renegotiation event. Its BEFORE trigger
    -- captures Q1/V1/A1 in immutable metadata; its AFTER trigger projects N2.
    v_cycle_2 := pg_temp.p9_8_6_insert_cycle_event(
      c.org_id,c.store_id,v_opp,c.customer_id,c.lifecycle_cycle,
      'fechamento_pagamento','renegotiation_required','P9 8.6 Q2 fixture N2'
    );

    -- Seed the already-historical Final Condition from the previous negotiation.
    -- This is fixture history only; scenario 9 already exercised the real boundary
    -- that creates a current Final Condition and closes atomically.
    insert into public.commercial_final_conditions(
      id,organization_id,store_id,commercial_opportunity_id,lifecycle_cycle,
      negotiation_cycle_id,quote_id,quote_version_id,acceptance_event_id,
      condition_state,operation_key,request_fingerprint,
      materialized_at,superseded_at,superseded_by_negotiation_cycle_id,created_at
    ) values(
      v_condition_1,c.org_id,c.store_id,v_opp,c.lifecycle_cycle,
      v_cycle_1,v_quote_1,v_version_1,v_acceptance_1,
      'superseded',
      'p9_8_6_q2_fixture_c1:'||c.run_id::text,
      'fp-q2-fixture-c1-'||c.run_id::text,
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp(),
      v_cycle_2,
      pg_catalog.clock_timestamp()
    );

    select q.quote_id,q.version_id into v_quote_2,v_version_2
    from pg_temp.p9_8_6_make_sent_quote(
      c.org_id,c.store_id,v_opp,c.lead_id,v_conversation,'Q2-fixture-new-Q2',95000,true
    ) q;

    select * into v_message_2
    from public.insert_message(
      v_conversation,'user','incoming','text','Aceito a nova proposta Q2.',
      'p9_8_6_q2_fixture_accept_q2:'||c.run_id::text,null,'{}'::jsonb
    );

    v_acceptance_2 := pg_temp.p9_8_6_insert_acceptance(
      c.org_id,c.store_id,v_opp,c.lifecycle_cycle,
      v_quote_2,v_version_2,v_message_2.id,c.actor_id
    );

    insert into pg_temp.p9_8_6_q2_ctx(
      opportunity_id,conversation_id,session_id,
      negotiation_cycle_1,renegotiation_cycle_2,
      quote_1,version_1,acceptance_message_1,acceptance_1,condition_1,
      quote_2,version_2,acceptance_message_2,acceptance_2
    ) values(
      v_opp,v_conversation,v_session,
      v_cycle_1,v_cycle_2,
      v_quote_1,v_version_1,v_message_1.id,v_acceptance_1,v_condition_1,
      v_quote_2,v_version_2,v_message_2.id,v_acceptance_2
    );

    v_sql := pg_catalog.format(
      $sql$select * from public.materialize_accepted_negotiated_condition_by_system(
        %L::uuid,%L::uuid,%L::uuid,%s,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L
      )$sql$,
      c.org_id,c.store_id,v_opp,c.lifecycle_cycle,v_cycle_2,
      v_quote_2,v_version_2,v_acceptance_1,
      'p9_8_6_stale_a1_q2_fixture:'||c.run_id::text,
      'fp-stale-a1-q2-fixture-'||c.run_id::text
    );

    perform pg_temp.p9_8_6_expect_error(
      23,'stale_acceptance_rejected_after_q2_becomes_current',v_sql,
      'P9_FINAL_CONDITION_ACCEPTANCE_MISMATCH'
    );

    v_operation := 'p9_8_6_close_q2_fixture:'||c.run_id::text;
    v_fp := pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_operation,'UTF8'),'sha256'),
      'hex'
    );

    select * into v_row
    from public.materialize_accepted_negotiated_condition_by_system(
      c.org_id,c.store_id,v_opp,c.lifecycle_cycle,v_cycle_2,
      v_quote_2,v_version_2,v_acceptance_2,v_operation,v_fp
    );

    update pg_temp.p9_8_6_q2_ctx
    set condition_2=v_row.condition_id,
        close_event_2=v_row.lifecycle_event_id;

    select * into v_old
    from public.commercial_final_conditions
    where id=v_condition_1;

    select * into v_current
    from public.commercial_final_conditions
    where id=v_row.condition_id;

    perform pg_temp.p9_8_6_assert(
      24,'q2_new_acceptance_new_final_condition_restores_current_lineage',
      v_row.condition_state='current'
      and not v_row.replayed
      and v_current.negotiation_cycle_id=v_cycle_2
      and v_current.quote_id=v_quote_2
      and v_current.quote_version_id=v_version_2
      and v_current.acceptance_event_id=v_acceptance_2
      and v_old.condition_state='superseded'
      and exists(
        select 1
        from public.commercial_opportunities o
        where o.id=v_opp
          and o.stage='fechamento_pagamento'
          and o.current_negotiation_cycle_id is null
      ),
      'independent post-renegotiation fixture closes Q2 once; old C1 remains historical'
    );

  exception when others then
    perform pg_temp.p9_8_6_record(
      23,'stale_acceptance_rejected_after_q2_becomes_current','ERROR',sqlstate||' '||sqlerrm
    );
    perform pg_temp.p9_8_6_record(
      24,'q2_new_acceptance_new_final_condition_restores_current_lineage','ERROR',sqlstate||' '||sqlerrm
    );
  end;
end;
$q2_fixture_and_close$;

-- -----------------------------------------------------------------------------
-- 25. Direct Bloco 6 path stays independent from Final Condition.
-- -----------------------------------------------------------------------------
do $direct_bloco6$
declare
  c pg_temp.p9_8_6_ctx%rowtype;
  v_opp uuid := gen_random_uuid();
  v_conversation uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_quote uuid;
  v_version uuid;
  v_message public.messages%rowtype;
  v_acceptance uuid;
  v_transition record;
  v_final record;
  v_link record;
begin
  begin
    select * into strict c from pg_temp.p9_8_6_ctx;

    -- Keep the direct Bloco 6 probe on its own conversation/session context.
    -- Reusing the negotiated opportunity's conversation would freeze message
    -- evidence against the wrong commercial_session_context_link.
    insert into public.conversations(
      id,organization_id,lead_id,status,is_human_active,created_at
    ) values(
      v_conversation,c.org_id,c.lead_id,'open',false,pg_catalog.clock_timestamp()
    );

    insert into public.commercial_opportunities(
      id,organization_id,store_id,customer_id,origin_lead_id,
      primary_conversation_id,stage,lifecycle_cycle
    ) values(
      v_opp,c.org_id,c.store_id,c.customer_id,c.lead_id,
      v_conversation,'orcamento',1
    );

    insert into public.conversation_sessions(
      id,organization_id,store_id,conversation_id,status
    ) values(
      v_session,c.org_id,c.store_id,v_conversation,'active'
    );

    select * into v_link
    from public.link_commercial_session_context(
      c.org_id,c.store_id,v_session,c.customer_id,v_opp,c.lead_link_id,
      'migration','migration',null,'p9-8-6-direct:'||c.run_id::text,
      'p9-8-6-direct:context:'||c.run_id::text,null,'{}'::jsonb,null
    );

    select q.quote_id,q.version_id into v_quote,v_version
    from pg_temp.p9_8_6_make_sent_quote(
      c.org_id,c.store_id,v_opp,c.lead_id,v_conversation,'DIRECT',88000,true
    ) q;

    select * into v_message
    from public.insert_message(
      v_conversation,'user','incoming','text','Aceito o orçamento direto.',
      'p9_8_6_direct_accept:'||c.run_id::text,null,'{}'::jsonb
    );

    v_acceptance := pg_temp.p9_8_6_insert_acceptance(
      c.org_id,c.store_id,v_opp,1,v_quote,v_version,v_message.id,c.actor_id
    );

    select * into v_transition
    from public.transition_commercial_opportunity_stage_by_system(
      c.org_id,c.store_id,v_opp,
      'p9_8_6_direct_close:'||c.run_id::text,
      'fechamento_pagamento',
      'accepted current quote direct Bloco 6 path',
      'customer_accepted_quote',
      v_message.id,
      'direct accepted current proposal',
      'p9_8_6_runner'
    );

    select * into v_final
    from public.p9_resolve_current_commercial_final_condition_internal(
      c.org_id,c.store_id,v_opp
    );

    update pg_temp.p9_8_6_ctx
    set direct_opportunity_id=v_opp,
        direct_quote_id=v_quote,
        direct_version_id=v_version,
        direct_acceptance_id=v_acceptance
    where run_id=c.run_id;

    perform pg_temp.p9_8_6_assert(
      25,'direct_bloco6_closure_requires_no_final_condition',
      v_transition.stage='fechamento_pagamento'
      and v_transition.reason_code='accepted_current_quote_required'
      and v_final.condition_state='none'
      and not exists(
        select 1 from public.commercial_final_conditions f
        where f.commercial_opportunity_id=v_opp
      ),
      'orcamento -> fechamento_pagamento remains Bloco 6 authority'
    );
  exception when others then
    perform pg_temp.p9_8_6_record(25,'direct_bloco6_closure_requires_no_final_condition','ERROR',sqlstate||' '||sqlerrm);
  end;
end;
$direct_bloco6$;

-- -----------------------------------------------------------------------------
-- 27-28. Historical integrity + runner/static integrity.
-- -----------------------------------------------------------------------------
do $final_integrity$
declare
  c pg_temp.p9_8_6_ctx%rowtype;
  q pg_temp.p9_8_6_q2_ctx%rowtype;
  v_a_final_count bigint;
  v_a_acceptance_count bigint;
  v_a_contract_count bigint;
  v_q_final_count bigint;
  v_q_acceptance_count bigint;
  v_q_current_count bigint;
  v_q_superseded_count bigint;
  v_security_ok boolean;
begin
  begin
    select * into strict c from pg_temp.p9_8_6_ctx;
    select * into strict q from pg_temp.p9_8_6_q2_ctx;

    select count(*)
    into v_a_final_count
    from public.commercial_final_conditions f
    where f.organization_id=c.org_id
      and f.store_id=c.store_id
      and f.commercial_opportunity_id=c.opportunity_id
      and f.lifecycle_cycle=c.lifecycle_cycle;

    select count(*)
    into v_a_acceptance_count
    from public.commercial_proposal_acceptance_events a
    where a.organization_id=c.org_id
      and a.store_id=c.store_id
      and a.commercial_opportunity_id=c.opportunity_id
      and a.id=c.acceptance_1;

    select count(*)
    into v_a_contract_count
    from public.sales_contracts contract_row
    where contract_row.id=c.contract_1;

    select count(*),
           count(*) filter(where condition_state='current'),
           count(*) filter(where condition_state='superseded')
    into v_q_final_count,v_q_current_count,v_q_superseded_count
    from public.commercial_final_conditions f
    where f.organization_id=c.org_id
      and f.store_id=c.store_id
      and f.commercial_opportunity_id=q.opportunity_id
      and f.lifecycle_cycle=c.lifecycle_cycle;

    select count(*)
    into v_q_acceptance_count
    from public.commercial_proposal_acceptance_events a
    where a.organization_id=c.org_id
      and a.store_id=c.store_id
      and a.commercial_opportunity_id=q.opportunity_id
      and a.id in (q.acceptance_1,q.acceptance_2);

    perform pg_temp.p9_8_6_assert(
      27,'historical_acceptance_contract_and_conditions_are_preserved',
      v_a_final_count=1
      and v_a_acceptance_count=1
      and v_a_contract_count=1
      and exists(
        select 1
        from public.commercial_final_conditions f
        where f.id=c.condition_1
          and f.condition_state='superseded'
          and f.superseded_by_negotiation_cycle_id=c.renegotiation_cycle_2
      )
      and v_q_final_count=2
      and v_q_current_count=1
      and v_q_superseded_count=1
      and v_q_acceptance_count=2
      and exists(
        select 1
        from public.commercial_final_conditions f
        where f.id=q.condition_1
          and f.condition_state='superseded'
          and f.superseded_by_negotiation_cycle_id=q.renegotiation_cycle_2
      )
      and exists(
        select 1
        from public.commercial_final_conditions f
        where f.id=q.condition_2
          and f.condition_state='current'
          and f.negotiation_cycle_id=q.renegotiation_cycle_2
          and f.quote_id=q.quote_2
          and f.quote_version_id=q.version_2
          and f.acceptance_event_id=q.acceptance_2
      ),
      'original stale history plus independent Q2 history/current authority are all preserved'
    );

    v_security_ok :=
      not pg_catalog.has_table_privilege('authenticated','public.commercial_final_conditions','INSERT')
      and not pg_catalog.has_table_privilege('service_role','public.commercial_final_conditions','INSERT')
      and pg_catalog.has_function_privilege(
        'service_role',
        'public.materialize_accepted_negotiated_condition_by_system(uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text)',
        'EXECUTE'
      )
      and pg_catalog.has_function_privilege(
        'authenticated',
        'public.materialize_accepted_negotiated_condition_by_user(uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text)',
        'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'authenticated',
        'public.p9_resolve_current_commercial_final_condition_internal(uuid,uuid,uuid)',
        'EXECUTE'
      )
      and exists(
        select 1 from pg_catalog.pg_trigger t
        where t.tgrelid='public.commercial_opportunity_lifecycle_events'::regclass
          and t.tgname='p9_final_condition_negotiated_close_guard'
          and not t.tgisinternal
      )
      and exists(
        select 1 from pg_catalog.pg_trigger t
        where t.tgrelid='public.commercial_opportunity_lifecycle_events'::regclass
          and t.tgname='p9_final_condition_cycle_projection'
          and not t.tgisinternal
      );

    perform pg_temp.p9_8_6_assert(
      28,'runner_integrity_and_rollback_ready',
      v_security_ok
      and (select count(*) from pg_temp.p9_8_6_results where n between 1 and 27 and status='PASS')=27,
      'all prior scenarios PASS; security/grants/triggers present; transaction will ROLLBACK'
    );
  exception when others then
    perform pg_temp.p9_8_6_record(
      27,'historical_acceptance_contract_and_conditions_are_preserved','ERROR',sqlstate||' '||sqlerrm
    );
    perform pg_temp.p9_8_6_record(
      28,'runner_integrity_and_rollback_ready','ERROR',sqlstate||' '||sqlerrm
    );
  end;
end;
$final_integrity$;

with summary as (
  select
    count(*) filter(where status='PASS') as pass_count,
    count(*) filter(where status='FAIL') as fail_count,
    count(*) filter(where status='ERROR') as error_count,
    count(*) as numbered_scenario_count,
    case
      when count(*)=28
       and count(*) filter(where status='PASS')=28
       and count(*) filter(where status in ('FAIL','ERROR'))=0
      then 'P9_8_6_REAL_SUT_PASS'
      else 'P9_8_6_REVIEW_REQUIRED'
    end as overall_status
  from pg_temp.p9_8_6_results
)
select
  r.n,
  r.name,
  r.status,
  r.details,
  s.pass_count,
  s.fail_count,
  s.error_count,
  0::bigint as skip_count,
  s.numbered_scenario_count,
  s.overall_status,
  true as rollback_only
from pg_temp.p9_8_6_results r
cross join summary s
order by r.n;

rollback;
