begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_cmirw_results (
  scenario_number integer primary key,
  scenario text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text null
) on commit drop;

create or replace function pg_temp._p9_cmirw_record(
  p_number integer,
  p_scenario text,
  p_ok boolean,
  p_detail text default null,
  p_harness boolean default false
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_cmirw_results (
    scenario_number, scenario, status, detail
  )
  values (
    p_number,
    p_scenario,
    case
      when p_harness then 'HARNESS_ERROR'
      when p_ok then 'PASS'
      else 'SUT_FAIL'
    end,
    p_detail
  );
end;
$function$;

create temp table pg_temp._p9_cmirw_ctx (
  org_id uuid not null,
  store_id uuid not null,
  customer_id uuid not null,
  other_customer_id uuid not null,
  lead_id uuid not null,
  other_lead_id uuid not null,
  lead_link_id uuid not null,
  other_lead_link_id uuid not null
) on commit drop;

insert into pg_temp._p9_cmirw_ctx
select
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid();

do $fixtures$
declare
  c pg_temp._p9_cmirw_ctx%rowtype;
begin
  select * into c from pg_temp._p9_cmirw_ctx;

  insert into public.organizations (id, name, subscription_status)
  values (c.org_id, 'P9 CMIR Writer Runner Org', 'active');

  insert into public.stores (id, organization_id, name)
  values (c.store_id, c.org_id, 'P9 CMIR Writer Runner Store');

  insert into public.customers (
    id, organization_id, display_name, normalized_name
  )
  values
    (c.customer_id, c.org_id, 'CMIR Writer Customer', 'cmir writer customer'),
    (c.other_customer_id, c.org_id, 'CMIR Writer Other Customer', 'cmir writer other customer');

  insert into public.customer_store_links (
    organization_id, store_id, customer_id
  )
  values
    (c.org_id, c.store_id, c.customer_id),
    (c.org_id, c.store_id, c.other_customer_id);

  insert into public.leads (
    id, organization_id, store_id, name, phone, state, created_at, updated_at
  )
  values
    (c.lead_id, c.org_id, c.store_id, 'CMIR Writer Lead', '5511998100001', 'novo_lead', now(), now()),
    (c.other_lead_id, c.org_id, c.store_id, 'CMIR Writer Other Lead', '5511998100002', 'novo_lead', now(), now());

  insert into public.lead_customer_links (
    id,
    organization_id,
    store_id,
    lead_id,
    customer_id,
    status,
    source,
    linked_by_actor_type,
    linked_at,
    metadata
  )
  values
    (c.lead_link_id, c.org_id, c.store_id, c.lead_id, c.customer_id,
     'active', 'manual', 'migration', now(), '{}'::jsonb),
    (c.other_lead_link_id, c.org_id, c.store_id, c.other_lead_id, c.other_customer_id,
     'active', 'manual', 'migration', now(), '{}'::jsonb);
end;
$fixtures$;

create or replace function pg_temp._p9_cmirw_make_opportunity(
  p_stage text,
  p_customer_id uuid default null
)
returns uuid
language plpgsql
as $function$
declare
  c pg_temp._p9_cmirw_ctx%rowtype;
  v_id uuid := gen_random_uuid();
  v_customer uuid;
begin
  select * into c from pg_temp._p9_cmirw_ctx;
  v_customer := coalesce(p_customer_id, c.customer_id);

  insert into public.commercial_opportunities (
    id, organization_id, store_id, customer_id, stage
  )
  values (
    v_id, c.org_id, c.store_id, v_customer, p_stage
  );

  return v_id;
end;
$function$;

create or replace function pg_temp._p9_cmirw_make_message(
  p_label text,
  p_arrival_opportunity_id uuid default null,
  p_other_customer boolean default false
)
returns table (
  conversation_id uuid,
  session_id uuid,
  message_id uuid,
  arrival_context_link_id uuid
)
language plpgsql
as $function$
declare
  c pg_temp._p9_cmirw_ctx%rowtype;
  v_conv uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_message public.messages;
  v_link public.commercial_session_context_links;
  v_lead uuid;
  v_customer uuid;
  v_lead_link uuid;
begin
  select * into c from pg_temp._p9_cmirw_ctx;

  if p_other_customer then
    v_lead := c.other_lead_id;
    v_customer := c.other_customer_id;
    v_lead_link := c.other_lead_link_id;
  else
    v_lead := c.lead_id;
    v_customer := c.customer_id;
    v_lead_link := c.lead_link_id;
  end if;

  insert into public.conversations (
    id, organization_id, lead_id, status, is_human_active, created_at
  )
  values (
    v_conv, c.org_id, v_lead, 'open', false, now()
  );

  insert into public.conversation_sessions (
    id, organization_id, store_id, conversation_id, status
  )
  values (
    v_session, c.org_id, c.store_id, v_conv, 'active'
  );

  if p_arrival_opportunity_id is not null then
    select *
    into v_link
    from public.link_commercial_session_context(
      c.org_id,
      c.store_id,
      v_session,
      v_customer,
      p_arrival_opportunity_id,
      v_lead_link,
      'migration',
      'migration',
      null,
      'runner:' || p_label,
      'runner:' || p_label || ':arrival',
      null,
      '{}'::jsonb,
      null
    );
  end if;

  select *
  into v_message
  from public.insert_message(
    v_conv,
    'user',
    'incoming',
    'text',
    'runner ' || p_label,
    'p9-cmirw-' || p_label || '-' || v_conv::text,
    null,
    '{}'::jsonb
  );

  return query
  select
    v_conv,
    v_session,
    v_message.id,
    case when p_arrival_opportunity_id is null then null else v_link.id end;
end;
$function$;

create or replace function pg_temp._p9_cmirw_call(
  p_message_id uuid,
  p_operation_key text,
  p_decision_kind text,
  p_reason_code text,
  p_resolved_opportunity_id uuid default null,
  p_related_opportunity_id uuid default null,
  p_customer_id uuid default null,
  p_lead_customer_link_id uuid default null,
  p_actor_type text default 'ai',
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
as $function$
declare
  c pg_temp._p9_cmirw_ctx%rowtype;
  v_row record;
begin
  select * into c from pg_temp._p9_cmirw_ctx;

  select *
  into v_row
  from public.write_commercial_message_intent_resolution_by_system(
    c.org_id,
    c.store_id,
    p_message_id,
    coalesce(p_customer_id, c.customer_id),
    coalesce(p_lead_customer_link_id, c.lead_link_id),
    p_operation_key,
    p_decision_kind,
    p_reason_code,
    p_resolved_opportunity_id,
    p_related_opportunity_id,
    p_actor_type,
    p_metadata,
    'postgres.manual_runner'
  )
  limit 1;

  return pg_catalog.to_jsonb(v_row);
end;
$function$;

do $s1$
declare
  v_ok boolean;
begin
  select
    pg_catalog.to_regprocedure(
      'public.write_commercial_message_intent_resolution_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,jsonb,text)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.write_commercial_message_intent_resolution_internal(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,jsonb,text)'
    ) is not null
  into v_ok;

  perform pg_temp._p9_cmirw_record(
    1, 'writer publico e core interno existem', v_ok
  );
exception when others then
  perform pg_temp._p9_cmirw_record(1, 'writer publico e core interno existem', false, sqlstate || ' ' || sqlerrm, true);
end;
$s1$;

do $s2$
declare
  v_ok boolean;
begin
  select
    pg_catalog.has_function_privilege(
      'service_role',
      'public.write_commercial_message_intent_resolution_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,jsonb,text)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.write_commercial_message_intent_resolution_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,jsonb,text)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.write_commercial_message_intent_resolution_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,jsonb,text)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role',
      'public.write_commercial_message_intent_resolution_internal(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,jsonb,text)',
      'EXECUTE'
    )
  into v_ok;

  perform pg_temp._p9_cmirw_record(
    2, 'ACL: somente wrapper service_role e core oculto', v_ok
  );
exception when others then
  perform pg_temp._p9_cmirw_record(2, 'ACL: somente wrapper service_role e core oculto', false, sqlstate || ' ' || sqlerrm, true);
end;
$s2$;

do $s3$
declare
  v_opp uuid;
  t record;
  j jsonb;
begin
  v_opp := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  select * into t from pg_temp._p9_cmirw_make_message('continue', v_opp);

  j := pg_temp._p9_cmirw_call(
    t.message_id, 'op-continue', 'continue_same_intent', 'same_intent', v_opp
  );

  perform pg_temp._p9_cmirw_record(
    3,
    'continue_same_intent preserva a opportunity exata',
    j ->> 'resolved_opportunity_id' = v_opp::text
      and j ->> 'opportunity_outcome' = 'continued_existing_opportunity'
      and (
        select count(*)
        from public.commercial_session_context_links x
        where x.conversation_session_id = t.session_id
          and x.status = 'active'
          and x.commercial_opportunity_id = v_opp
      ) = 1,
    j::text
  );
exception when others then
  perform pg_temp._p9_cmirw_record(3, 'continue_same_intent preserva a opportunity exata', false, sqlstate || ' ' || sqlerrm, true);
end;
$s3$;

do $s4$
declare
  v_a uuid;
  v_b uuid;
  t record;
  v_blocked boolean := false;
begin
  v_a := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  v_b := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  select * into t from pg_temp._p9_cmirw_make_message('continue-wrong', v_a);

  begin
    perform pg_temp._p9_cmirw_call(
      t.message_id, 'op-continue-wrong', 'continue_same_intent', 'same_intent', v_b
    );
  exception when others then
    v_blocked := sqlstate = '23514';
  end;

  perform pg_temp._p9_cmirw_record(
    4, 'continue nao pode trocar silently a opportunity capturada', v_blocked
  );
exception when others then
  perform pg_temp._p9_cmirw_record(4, 'continue nao pode trocar silently a opportunity capturada', false, sqlstate || ' ' || sqlerrm, true);
end;
$s4$;

do $s5$
declare
  c pg_temp._p9_cmirw_ctx%rowtype;
  v_lost uuid;
  t record;
  j jsonb;
  v_stage text;
  v_actor text;
begin
  select * into c from pg_temp._p9_cmirw_ctx;
  v_lost := pg_temp._p9_cmirw_make_opportunity('negociacao');
  select * into t from pg_temp._p9_cmirw_make_message('reopen', v_lost);

  perform public.mark_commercial_opportunity_lost_by_system(
    c.org_id, c.store_id, v_lost,
    'runner-loss-reopen',
    'explicit_refusal',
    t.message_id,
    'runner loss before reopen',
    'system',
    'runner_cmir_writer'
  );

  j := pg_temp._p9_cmirw_call(
    t.message_id, 'op-reopen', 'reopen_same_intent', 'same_intent_returned', v_lost
  );

  select stage into v_stage
  from public.commercial_opportunities
  where id = v_lost;

  select actor_type into v_actor
  from public.commercial_opportunity_lifecycle_events
  where commercial_opportunity_id = v_lost
    and event_type = 'reopened'
  order by created_at desc
  limit 1;

  perform pg_temp._p9_cmirw_record(
    5,
    'reopen_same_intent usa writer canonico e restaura stage anterior',
    v_stage = 'negociacao'
      and v_actor = 'system'
      and j ->> 'opportunity_outcome' = 'reopened_existing_opportunity',
    j::text
  );
exception when others then
  perform pg_temp._p9_cmirw_record(5, 'reopen_same_intent usa writer canonico e restaura stage anterior', false, sqlstate || ' ' || sqlerrm, true);
end;
$s5$;

do $s6$
declare
  v_arrival uuid;
  v_new uuid := gen_random_uuid();
  t record;
  j jsonb;
begin
  v_arrival := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  select * into t from pg_temp._p9_cmirw_make_message('new-independent', v_arrival);

  j := pg_temp._p9_cmirw_call(
    t.message_id, 'op-new', 'new_independent_opportunity', 'new_purchase_intent', v_new
  );

  perform pg_temp._p9_cmirw_record(
    6,
    'nova opportunity e criada com id explicito e contexto troca A para B',
    exists (
      select 1
      from public.commercial_opportunities
      where id = v_new and stage = 'novo_lead'
    )
    and exists (
      select 1
      from public.commercial_session_context_links
      where conversation_session_id = t.session_id
        and status = 'active'
        and commercial_opportunity_id = v_new
    )
    and j ->> 'context_outcome' = 'arrival_context_replaced',
    j::text
  );
exception when others then
  perform pg_temp._p9_cmirw_record(6, 'nova opportunity e criada com id explicito e contexto troca A para B', false, sqlstate || ' ' || sqlerrm, true);
end;
$s6$;

do $s7$
declare
  v_parent uuid;
  v_new uuid := gen_random_uuid();
  t record;
  j jsonb;
begin
  v_parent := pg_temp._p9_cmirw_make_opportunity('fechamento_pagamento');
  select * into t from pg_temp._p9_cmirw_make_message('repurchase', v_parent);

  j := pg_temp._p9_cmirw_call(
    t.message_id, 'op-repurchase', 'repurchase', 'repurchase_proven', v_new, v_parent
  );

  perform pg_temp._p9_cmirw_record(
    7,
    'recompra cria nova opportunity e materializa repurchase_of',
    j ->> 'relation_type' = 'repurchase_of'
      and j ->> 'related_opportunity_id' = v_parent::text
      and exists (
        select 1
        from public.commercial_message_intent_resolution_events e
        where e.id = (j ->> 'event_id')::uuid
          and e.relation_type = 'repurchase_of'
          and e.related_opportunity_id = v_parent
      ),
    j::text
  );
exception when others then
  perform pg_temp._p9_cmirw_record(7, 'recompra cria nova opportunity e materializa repurchase_of', false, sqlstate || ' ' || sqlerrm, true);
end;
$s7$;

do $s8$
declare
  v_parent uuid;
  v_new uuid := gen_random_uuid();
  t record;
  v_blocked boolean := false;
begin
  v_parent := pg_temp._p9_cmirw_make_opportunity('orcamento');
  select * into t from pg_temp._p9_cmirw_make_message('repurchase-uncommitted', v_parent);

  begin
    perform pg_temp._p9_cmirw_call(
      t.message_id, 'op-repurchase-uncommitted', 'repurchase', 'repurchase_unproven', v_new, v_parent
    );
  exception when others then
    v_blocked := sqlstate = '23514'
      and sqlerrm = 'ZION_CMIR_RELATED_OPPORTUNITY_NOT_COMMERCIALLY_COMMITTED';
  end;

  perform pg_temp._p9_cmirw_record(
    8,
    'recompra falha fechada se venda-pai nao tem compromisso comercial',
    v_blocked and not exists (
      select 1 from public.commercial_opportunities where id = v_new
    )
  );
exception when others then
  perform pg_temp._p9_cmirw_record(8, 'recompra falha fechada se venda-pai nao tem compromisso comercial', false, sqlstate || ' ' || sqlerrm, true);
end;
$s8$;

do $s9$
declare
  v_parent uuid;
  v_new uuid := gen_random_uuid();
  t record;
  j jsonb;
begin
  v_parent := pg_temp._p9_cmirw_make_opportunity('pos_venda');
  select * into t from pg_temp._p9_cmirw_make_message('addendum', v_parent);

  j := pg_temp._p9_cmirw_call(
    t.message_id, 'op-addendum', 'addendum', 'addendum_proven', v_new, v_parent
  );

  perform pg_temp._p9_cmirw_record(
    9,
    'aditivo cria nova opportunity e materializa addendum_to',
    j ->> 'relation_type' = 'addendum_to'
      and j ->> 'related_opportunity_id' = v_parent::text,
    j::text
  );
exception when others then
  perform pg_temp._p9_cmirw_record(9, 'aditivo cria nova opportunity e materializa addendum_to', false, sqlstate || ' ' || sqlerrm, true);
end;
$s9$;

do $s10$
declare
  v_parent uuid;
  v_new uuid := gen_random_uuid();
  t record;
  v_blocked boolean := false;
begin
  v_parent := pg_temp._p9_cmirw_make_opportunity('negociacao');
  select * into t from pg_temp._p9_cmirw_make_message('addendum-uncommitted', v_parent);

  begin
    perform pg_temp._p9_cmirw_call(
      t.message_id, 'op-addendum-uncommitted', 'addendum', 'addendum_unproven', v_new, v_parent
    );
  exception when others then
    v_blocked := sqlstate = '23514'
      and sqlerrm = 'ZION_CMIR_RELATED_OPPORTUNITY_NOT_COMMERCIALLY_COMMITTED';
  end;

  perform pg_temp._p9_cmirw_record(
    10, 'aditivo nao nasce apenas por inferencia da IA', v_blocked
  );
exception when others then
  perform pg_temp._p9_cmirw_record(10, 'aditivo nao nasce apenas por inferencia da IA', false, sqlstate || ' ' || sqlerrm, true);
end;
$s10$;

do $s11$
declare
  v_arrival uuid;
  t record;
  j jsonb;
  v_active uuid;
begin
  v_arrival := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  select * into t from pg_temp._p9_cmirw_make_message('ambiguity', v_arrival);

  j := pg_temp._p9_cmirw_call(
    t.message_id, 'op-ambiguity', 'needs_clarification', 'insufficient_semantic_evidence'
  );

  select commercial_opportunity_id
  into v_active
  from public.commercial_session_context_links
  where conversation_session_id = t.session_id
    and status = 'active';

  perform pg_temp._p9_cmirw_record(
    11,
    'ambiguidade registra adjudicacao sem criar/reabrir/trocar opportunity',
    j ->> 'opportunity_outcome' = 'ambiguity_no_opportunity_mutation'
      and j ->> 'context_outcome' = 'ambiguity_no_context_mutation'
      and v_active = v_arrival,
    j::text
  );
exception when others then
  perform pg_temp._p9_cmirw_record(11, 'ambiguidade registra adjudicacao sem criar/reabrir/trocar opportunity', false, sqlstate || ' ' || sqlerrm, true);
end;
$s11$;

do $s12$
declare
  v_arrival uuid;
  v_new uuid := gen_random_uuid();
  t record;
  j1 jsonb;
  j2 jsonb;
  v_events bigint;
begin
  v_arrival := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  select * into t from pg_temp._p9_cmirw_make_message('replay', v_arrival);

  j1 := pg_temp._p9_cmirw_call(
    t.message_id, 'op-replay', 'new_independent_opportunity', 'new_purchase_intent', v_new
  );
  j2 := pg_temp._p9_cmirw_call(
    t.message_id, 'op-replay', 'new_independent_opportunity', 'new_purchase_intent', v_new
  );

  select count(*) into v_events
  from public.commercial_message_intent_resolution_events
  where anchor_message_id = t.message_id
    and operation_key = 'op-replay';

  perform pg_temp._p9_cmirw_record(
    12,
    'retry exato e idempotente sem duplicar event/opportunity/context',
    j1 ->> 'event_id' = j2 ->> 'event_id'
      and (j2 ->> 'replayed')::boolean
      and v_events = 1
      and (select count(*) from public.commercial_opportunities where id = v_new) = 1,
    j2::text
  );
exception when others then
  perform pg_temp._p9_cmirw_record(12, 'retry exato e idempotente sem duplicar event/opportunity/context', false, sqlstate || ' ' || sqlerrm, true);
end;
$s12$;

do $s13$
declare
  v_arrival uuid;
  t record;
  v_blocked boolean := false;
begin
  v_arrival := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  select * into t from pg_temp._p9_cmirw_make_message('divergent-key', v_arrival);

  perform pg_temp._p9_cmirw_call(
    t.message_id, 'op-divergent', 'needs_clarification', 'first_reason'
  );

  begin
    perform pg_temp._p9_cmirw_call(
      t.message_id, 'op-divergent', 'structural_ambiguity', 'second_reason'
    );
  exception when others then
    v_blocked := sqlstate = '23505'
      and sqlerrm = 'ZION_CMIR_IDEMPOTENCY_KEY_REUSED';
  end;

  perform pg_temp._p9_cmirw_record(
    13, 'mesma operation_key com payload divergente e rejeitada', v_blocked
  );
exception when others then
  perform pg_temp._p9_cmirw_record(13, 'mesma operation_key com payload divergente e rejeitada', false, sqlstate || ' ' || sqlerrm, true);
end;
$s13$;

do $s14$
declare
  v_arrival uuid;
  v_new uuid := gen_random_uuid();
  t record;
  j1 jsonb;
  j2 jsonb;
begin
  v_arrival := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  select * into t from pg_temp._p9_cmirw_make_message('clarify-then-resolve', v_arrival);

  j1 := pg_temp._p9_cmirw_call(
    t.message_id, 'op-clarify', 'needs_clarification', 'missing_intent_detail'
  );
  j2 := pg_temp._p9_cmirw_call(
    t.message_id, 'op-resolve-after-clarify', 'new_independent_opportunity', 'customer_clarified_new_purchase', v_new
  );

  perform pg_temp._p9_cmirw_record(
    14,
    'ambiguidade pode ser superseded diretamente por resolucao posterior',
    exists (
      select 1
      from public.commercial_message_intent_resolution_events e2
      where e2.id = (j2 ->> 'event_id')::uuid
        and e2.supersedes_event_id = (j1 ->> 'event_id')::uuid
    )
    and exists (
      select 1
      from public.commercial_message_intent_resolution_current cur
      where cur.anchor_message_id = t.message_id
        and cur.current_event_id = (j2 ->> 'event_id')::uuid
    ),
    j2::text
  );
exception when others then
  perform pg_temp._p9_cmirw_record(14, 'ambiguidade pode ser superseded diretamente por resolucao posterior', false, sqlstate || ' ' || sqlerrm, true);
end;
$s14$;

do $s15$
declare
  v_arrival uuid;
  t record;
  v_blocked boolean := false;
begin
  v_arrival := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  select * into t from pg_temp._p9_cmirw_make_message('resolved-immutable', v_arrival);

  perform pg_temp._p9_cmirw_call(
    t.message_id, 'op-resolved-first', 'continue_same_intent', 'same_intent', v_arrival
  );

  begin
    perform pg_temp._p9_cmirw_call(
      t.message_id, 'op-resolved-second', 'needs_clarification', 'changed_mind'
    );
  exception when others then
    v_blocked := sqlstate = '23514'
      and sqlerrm = 'ZION_CMIR_RESOLVED_DECISION_IMMUTABLE_FOR_SYSTEM';
  end;

  perform pg_temp._p9_cmirw_record(
    15, 'system/AI nao reescreve silenciosamente decisao ja resolvida', v_blocked
  );
exception when others then
  perform pg_temp._p9_cmirw_record(15, 'system/AI nao reescreve silenciosamente decisao ja resolvida', false, sqlstate || ' ' || sqlerrm, true);
end;
$s15$;

do $s16$
declare
  c pg_temp._p9_cmirw_ctx%rowtype;
  v_arrival uuid;
  v_newer uuid;
  v_resolved uuid := gen_random_uuid();
  t record;
  v_old public.commercial_session_context_links;
  v_replacement public.commercial_session_context_links;
  j jsonb;
begin
  select * into c from pg_temp._p9_cmirw_ctx;
  v_arrival := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  v_newer := pg_temp._p9_cmirw_make_opportunity('orcamento');
  select * into t from pg_temp._p9_cmirw_make_message('stale-context', v_arrival);

  select * into v_old
  from public.commercial_session_context_links
  where id = t.arrival_context_link_id;

  select * into v_replacement
  from public.replace_commercial_session_context_link(
    v_old.id,
    c.org_id,
    c.store_id,
    c.customer_id,
    v_newer,
    c.lead_link_id,
    'system',
    'system',
    null,
    'runner-newer-context',
    'runner-newer-context:' || t.message_id::text,
    null,
    '{}'::jsonb,
    'later_message_or_human_context',
    'A newer live context was established after the anchor message.',
    '{}'::jsonb,
    null
  );

  j := pg_temp._p9_cmirw_call(
    t.message_id, 'op-stale-context', 'new_independent_opportunity',
    'old_message_resolved_new_purchase', v_resolved
  );

  perform pg_temp._p9_cmirw_record(
    16,
    'mensagem antiga nao rebobina contexto vivo mais novo',
    j ->> 'context_outcome' = 'stale_newer_context_preserved'
      and exists (
        select 1
        from public.commercial_session_context_links
        where id = v_replacement.id
          and status = 'active'
          and commercial_opportunity_id = v_newer
      ),
    j::text
  );
exception when others then
  perform pg_temp._p9_cmirw_record(16, 'mensagem antiga nao rebobina contexto vivo mais novo', false, sqlstate || ' ' || sqlerrm, true);
end;
$s16$;

do $s17$
declare
  v_existing uuid;
  t record;
  j jsonb;
begin
  v_existing := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  select * into t from pg_temp._p9_cmirw_make_message('pending-link', null);

  j := pg_temp._p9_cmirw_call(
    t.message_id, 'op-pending-link', 'continue_same_intent',
    'existing_intent_identified', v_existing
  );

  perform pg_temp._p9_cmirw_record(
    17,
    'pending_context sem link ganha contexto somente apos resolucao exata',
    j ->> 'context_outcome' = 'pending_context_linked'
      and exists (
        select 1
        from public.commercial_session_context_links
        where conversation_session_id = t.session_id
          and status = 'active'
          and commercial_opportunity_id = v_existing
      ),
    j::text
  );
exception when others then
  perform pg_temp._p9_cmirw_record(17, 'pending_context sem link ganha contexto somente apos resolucao exata', false, sqlstate || ' ' || sqlerrm, true);
end;
$s17$;

do $s18$
declare
  c pg_temp._p9_cmirw_ctx%rowtype;
  v_newer uuid;
  v_resolved uuid;
  t record;
  v_link public.commercial_session_context_links;
  j jsonb;
begin
  select * into c from pg_temp._p9_cmirw_ctx;
  v_newer := pg_temp._p9_cmirw_make_opportunity('orcamento');
  v_resolved := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  select * into t from pg_temp._p9_cmirw_make_message('pending-newer-context', null);

  select * into v_link
  from public.link_commercial_session_context(
    c.org_id,
    c.store_id,
    t.session_id,
    c.customer_id,
    v_newer,
    c.lead_link_id,
    'system',
    'system',
    null,
    'runner-newer-after-pending',
    'runner-newer-after-pending:' || t.message_id::text,
    null,
    '{}'::jsonb,
    null
  );

  j := pg_temp._p9_cmirw_call(
    t.message_id, 'op-pending-newer', 'continue_same_intent',
    'older_message_points_elsewhere', v_resolved
  );

  perform pg_temp._p9_cmirw_record(
    18,
    'pending_context nao sobrescreve link surgido depois da chegada',
    j ->> 'context_outcome' = 'stale_newer_context_preserved'
      and exists (
        select 1
        from public.commercial_session_context_links
        where id = v_link.id
          and status = 'active'
          and commercial_opportunity_id = v_newer
      ),
    j::text
  );
exception when others then
  perform pg_temp._p9_cmirw_record(18, 'pending_context nao sobrescreve link surgido depois da chegada', false, sqlstate || ' ' || sqlerrm, true);
end;
$s18$;

do $s19$
declare
  v_arrival uuid;
  v_preexisting uuid;
  t record;
  v_blocked boolean := false;
begin
  v_arrival := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  v_preexisting := pg_temp._p9_cmirw_make_opportunity('novo_lead');
  select * into t from pg_temp._p9_cmirw_make_message('new-id-preexists', v_arrival);

  begin
    perform pg_temp._p9_cmirw_call(
      t.message_id, 'op-new-id-preexists', 'new_independent_opportunity',
      'new_purchase_intent', v_preexisting
    );
  exception when others then
    v_blocked := sqlstate = '23505'
      and sqlerrm = 'ZION_CMIR_NEW_OPPORTUNITY_ID_ALREADY_EXISTS';
  end;

  perform pg_temp._p9_cmirw_record(
    19, 'new opportunity exige UUID novo explicito', v_blocked
  );
exception when others then
  perform pg_temp._p9_cmirw_record(19, 'new opportunity exige UUID novo explicito', false, sqlstate || ' ' || sqlerrm, true);
end;
$s19$;

do $s20$
declare
  c pg_temp._p9_cmirw_ctx%rowtype;
  v_arrival uuid;
  v_foreign uuid;
  t record;
  v_blocked boolean := false;
begin
  select * into c from pg_temp._p9_cmirw_ctx;
  v_arrival := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  v_foreign := pg_temp._p9_cmirw_make_opportunity('qualificacao', c.other_customer_id);
  select * into t from pg_temp._p9_cmirw_make_message('cross-customer', v_arrival);

  begin
    perform pg_temp._p9_cmirw_call(
      t.message_id, 'op-cross-customer', 'continue_same_intent',
      'same_intent', v_foreign
    );
  exception when others then
    v_blocked := sqlstate = '23514';
  end;

  perform pg_temp._p9_cmirw_record(
    20, 'opportunity de outro customer e rejeitada', v_blocked
  );
exception when others then
  perform pg_temp._p9_cmirw_record(20, 'opportunity de outro customer e rejeitada', false, sqlstate || ' ' || sqlerrm, true);
end;
$s20$;

do $s21$
declare
  c pg_temp._p9_cmirw_ctx%rowtype;
  v_arrival uuid;
  t record;
  v_blocked boolean := false;
begin
  select * into c from pg_temp._p9_cmirw_ctx;
  v_arrival := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  select * into t from pg_temp._p9_cmirw_make_message('wrong-lead-link', v_arrival);

  begin
    perform pg_temp._p9_cmirw_call(
      t.message_id, 'op-wrong-link', 'continue_same_intent',
      'same_intent', v_arrival, null, c.customer_id, c.other_lead_link_id
    );
  exception when others then
    v_blocked := sqlstate = '23514';
  end;

  perform pg_temp._p9_cmirw_record(
    21, 'lead_customer_link deve pertencer exatamente ao anchor lead/customer', v_blocked
  );
exception when others then
  perform pg_temp._p9_cmirw_record(21, 'lead_customer_link deve pertencer exatamente ao anchor lead/customer', false, sqlstate || ' ' || sqlerrm, true);
end;
$s21$;

do $s22$
declare
  c pg_temp._p9_cmirw_ctx%rowtype;
  v_opp uuid;
  t record;
  v_before uuid;
begin
  select * into c from pg_temp._p9_cmirw_ctx;
  v_opp := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  select * into t from pg_temp._p9_cmirw_make_message('evidence-legacy', v_opp);

  v_before := public.assert_commercial_opportunity_message_evidence(
    c.org_id, c.store_id, v_opp, c.customer_id, t.message_id
  );

  perform pg_temp._p9_cmirw_record(
    22, 'sem CMIR current o snapshot captured legado continua valido', v_before = t.message_id
  );
exception when others then
  perform pg_temp._p9_cmirw_record(22, 'sem CMIR current o snapshot captured legado continua valido', false, sqlstate || ' ' || sqlerrm, true);
end;
$s22$;

do $s23$
declare
  c pg_temp._p9_cmirw_ctx%rowtype;
  v_a uuid;
  v_b uuid := gen_random_uuid();
  t record;
  v_proven uuid;
begin
  select * into c from pg_temp._p9_cmirw_ctx;
  v_a := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  select * into t from pg_temp._p9_cmirw_make_message('evidence-resolved-b', v_a);

  perform pg_temp._p9_cmirw_call(
    t.message_id, 'op-evidence-b', 'new_independent_opportunity',
    'new_purchase_intent', v_b
  );

  v_proven := public.assert_commercial_opportunity_message_evidence(
    c.org_id, c.store_id, v_b, c.customer_id, t.message_id
  );

  perform pg_temp._p9_cmirw_record(
    23, 'CMIR current transfere autoridade de evidencia para opportunity resolvida B',
    v_proven = t.message_id
  );
exception when others then
  perform pg_temp._p9_cmirw_record(23, 'CMIR current transfere autoridade de evidencia para opportunity resolvida B', false, sqlstate || ' ' || sqlerrm, true);
end;
$s23$;

do $s24$
declare
  c pg_temp._p9_cmirw_ctx%rowtype;
  v_a uuid;
  v_b uuid := gen_random_uuid();
  t record;
  v_blocked boolean := false;
begin
  select * into c from pg_temp._p9_cmirw_ctx;
  v_a := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  select * into t from pg_temp._p9_cmirw_make_message('evidence-no-fallback-a', v_a);

  perform pg_temp._p9_cmirw_call(
    t.message_id, 'op-evidence-no-a', 'new_independent_opportunity',
    'new_purchase_intent', v_b
  );

  begin
    perform public.assert_commercial_opportunity_message_evidence(
      c.org_id, c.store_id, v_a, c.customer_id, t.message_id
    );
  exception when others then
    v_blocked := sqlstate = '23514'
      and sqlerrm = 'ZION_LOSS_EVIDENCE_CONTEXT_NOT_PROVEN';
  end;

  perform pg_temp._p9_cmirw_record(
    24, 'CMIR current B impede fallback indevido para snapshot antigo A', v_blocked
  );
exception when others then
  perform pg_temp._p9_cmirw_record(24, 'CMIR current B impede fallback indevido para snapshot antigo A', false, sqlstate || ' ' || sqlerrm, true);
end;
$s24$;

do $s25$
declare
  c pg_temp._p9_cmirw_ctx%rowtype;
  v_a uuid;
  t record;
  v_blocked boolean := false;
begin
  select * into c from pg_temp._p9_cmirw_ctx;
  v_a := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  select * into t from pg_temp._p9_cmirw_make_message('evidence-ambiguity', v_a);

  perform pg_temp._p9_cmirw_call(
    t.message_id, 'op-evidence-ambiguity', 'structural_ambiguity',
    'multiple_plausible_opportunities'
  );

  begin
    perform public.assert_commercial_opportunity_message_evidence(
      c.org_id, c.store_id, v_a, c.customer_id, t.message_id
    );
  exception when others then
    v_blocked := sqlstate = '23514'
      and sqlerrm = 'ZION_LOSS_EVIDENCE_CONTEXT_NOT_PROVEN';
  end;

  perform pg_temp._p9_cmirw_record(
    25, 'ambiguidade current prova nenhuma opportunity e bloqueia fallback', v_blocked
  );
exception when others then
  perform pg_temp._p9_cmirw_record(25, 'ambiguidade current prova nenhuma opportunity e bloqueia fallback', false, sqlstate || ' ' || sqlerrm, true);
end;
$s25$;

do $s26$
declare
  c pg_temp._p9_cmirw_ctx%rowtype;
  v_opp uuid;
  v_conv uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_msg public.messages;
  v_blocked boolean := false;
begin
  select * into c from pg_temp._p9_cmirw_ctx;
  v_opp := pg_temp._p9_cmirw_make_opportunity('qualificacao');

  insert into public.conversations (
    id, organization_id, lead_id, status, is_human_active, created_at
  ) values (
    v_conv, c.org_id, c.lead_id, 'open', false, now()
  );

  insert into public.conversation_sessions (
    id, organization_id, store_id, conversation_id, status
  ) values (
    v_session, c.org_id, c.store_id, v_conv, 'active'
  );

  select * into v_msg
  from public.insert_message(
    v_conv, 'ai', 'outgoing', 'text', 'outbound runner',
    'p9-cmirw-outbound-' || v_conv::text, null, '{}'::jsonb
  );

  begin
    perform pg_temp._p9_cmirw_call(
      v_msg.id, 'op-outbound', 'continue_same_intent', 'same_intent', v_opp
    );
  exception when others then
    v_blocked := sqlstate = '23514';
  end;

  perform pg_temp._p9_cmirw_record(
    26, 'writer aceita somente anchor inbound do customer', v_blocked
  );
exception when others then
  perform pg_temp._p9_cmirw_record(26, 'writer aceita somente anchor inbound do customer', false, sqlstate || ' ' || sqlerrm, true);
end;
$s26$;

do $s27$
declare
  v_a uuid;
  t record;
  v_count bigint;
begin
  v_a := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  select * into t from pg_temp._p9_cmirw_make_message('explicit-not-latest', v_a);

  perform pg_temp._p9_cmirw_make_opportunity('negociacao');
  perform pg_temp._p9_cmirw_make_opportunity('orcamento');

  perform pg_temp._p9_cmirw_call(
    t.message_id, 'op-explicit-not-latest', 'continue_same_intent', 'same_intent', v_a
  );

  select count(*) into v_count
  from public.commercial_message_intent_resolution_events
  where anchor_message_id = t.message_id
    and resolved_opportunity_id = v_a;

  perform pg_temp._p9_cmirw_record(
    27, 'duas outras opportunities nao causam latest/first/fuzzy resolution', v_count = 1
  );
exception when others then
  perform pg_temp._p9_cmirw_record(27, 'duas outras opportunities nao causam latest/first/fuzzy resolution', false, sqlstate || ' ' || sqlerrm, true);
end;
$s27$;

do $s28$
declare
  c pg_temp._p9_cmirw_ctx%rowtype;
  v_parent uuid;
  v_foreign_parent uuid;
  v_new uuid := gen_random_uuid();
  t record;
  v_blocked boolean := false;
begin
  select * into c from pg_temp._p9_cmirw_ctx;
  v_parent := pg_temp._p9_cmirw_make_opportunity('fechamento_pagamento');
  v_foreign_parent := pg_temp._p9_cmirw_make_opportunity('fechamento_pagamento', c.other_customer_id);
  select * into t from pg_temp._p9_cmirw_make_message('foreign-parent', v_parent);

  begin
    perform pg_temp._p9_cmirw_call(
      t.message_id, 'op-foreign-parent', 'repurchase',
      'repurchase_proven', v_new, v_foreign_parent
    );
  exception when others then
    v_blocked := sqlstate = '23514'
      and sqlerrm = 'ZION_CMIR_RELATED_OPPORTUNITY_SCOPE_INVALID';
  end;

  perform pg_temp._p9_cmirw_record(
    28, 'recompra/aditivo exigem parent exato do mesmo customer/store/org', v_blocked
  );
exception when others then
  perform pg_temp._p9_cmirw_record(28, 'recompra/aditivo exigem parent exato do mesmo customer/store/org', false, sqlstate || ' ' || sqlerrm, true);
end;
$s28$;

do $s29$
declare
  v_arrival uuid;
  t record;
  v_blocked boolean := false;
begin
  v_arrival := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  select * into t from pg_temp._p9_cmirw_make_message('bad-actor', v_arrival);

  begin
    perform pg_temp._p9_cmirw_call(
      t.message_id, 'op-bad-actor', 'continue_same_intent',
      'same_intent', v_arrival, null, null, null, 'human_correction'
    );
  exception when others then
    v_blocked := sqlstate = '22023'
      and sqlerrm = 'ZION_CMIR_SYSTEM_ACTOR_INVALID';
  end;

  perform pg_temp._p9_cmirw_record(
    29, 'wrapper de sistema nao aceita human_correction/migration_backfill', v_blocked
  );
exception when others then
  perform pg_temp._p9_cmirw_record(29, 'wrapper de sistema nao aceita human_correction/migration_backfill', false, sqlstate || ' ' || sqlerrm, true);
end;
$s29$;

do $s30$
declare
  v_arrival uuid;
  t record;
  v_blocked boolean := false;
begin
  v_arrival := pg_temp._p9_cmirw_make_opportunity('qualificacao');
  select * into t from pg_temp._p9_cmirw_make_message('reserved-metadata', v_arrival);

  begin
    perform pg_temp._p9_cmirw_call(
      t.message_id, 'op-reserved-metadata', 'continue_same_intent',
      'same_intent', v_arrival, null, null, null, 'ai',
      '{"commercial_consequence":"fake"}'::jsonb
    );
  exception when others then
    v_blocked := sqlstate = '22023'
      and sqlerrm = 'ZION_CMIR_METADATA_RESERVED_KEY';
  end;

  perform pg_temp._p9_cmirw_record(
    30, 'caller nao pode falsificar metadata interna de consequencia', v_blocked
  );
exception when others then
  perform pg_temp._p9_cmirw_record(30, 'caller nao pode falsificar metadata interna de consequencia', false, sqlstate || ' ' || sqlerrm, true);
end;
$s30$;

do $s31$
declare
  v_ok boolean;
begin
  select
    not pg_catalog.has_table_privilege(
      'service_role',
      'public.commercial_message_intent_resolution_events',
      'INSERT'
    )
    and not pg_catalog.has_table_privilege(
      'service_role',
      'public.commercial_message_intent_resolution_events',
      'UPDATE'
    )
    and not pg_catalog.has_table_privilege(
      'service_role',
      'public.commercial_message_intent_resolution_current',
      'INSERT'
    )
    and not pg_catalog.has_table_privilege(
      'authenticated',
      'public.commercial_message_intent_resolution_current',
      'UPDATE'
    )
  into v_ok;

  perform pg_temp._p9_cmirw_record(
    31, 'tabelas event/current continuam sem escrita direta para clientes', v_ok
  );
exception when others then
  perform pg_temp._p9_cmirw_record(31, 'tabelas event/current continuam sem escrita direta para clientes', false, sqlstate || ' ' || sqlerrm, true);
end;
$s31$;

do $s32$
declare
  v_def text;
  v_ok boolean;
begin
  select pg_catalog.pg_get_functiondef(
    'public.assert_commercial_opportunity_message_evidence(uuid,uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure
  ) into v_def;

  v_ok :=
    pg_catalog.strpos(
      v_def,
      'commercial_message_intent_resolution_current'
    ) > 0
    and pg_catalog.strpos(
      v_def,
      'commercial_context_capture_state'
    ) > 0;

  perform pg_temp._p9_cmirw_record(
    32, 'evidence helper contem precedencia CMIR e fallback captured', v_ok
  );
exception when others then
  perform pg_temp._p9_cmirw_record(32, 'evidence helper contem precedencia CMIR e fallback captured', false, sqlstate || ' ' || sqlerrm, true);
end;
$s32$;

table pg_temp._p9_cmirw_results
order by scenario_number;

select
  count(*) filter (where status = 'PASS') as passed,
  count(*) filter (where status = 'SUT_FAIL') as sut_failed,
  count(*) filter (where status = 'HARNESS_ERROR') as harness_errors,
  count(*) as total,
  count(*) filter (where status <> 'PASS') as failed_scenarios,
  (count(*) filter (where status = 'PASS') = 32) as all_32_passed,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'scenario_number', scenario_number,
        'scenario', scenario,
        'status', status,
        'detail', detail
      )
      order by scenario_number
    ) filter (where status <> 'PASS'),
    '[]'::jsonb
  ) as failures
from pg_temp._p9_cmirw_results;

rollback;
