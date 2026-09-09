begin;

set transaction isolation level repeatable read;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_reader_scope_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (
    status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')
  ),
  detail text not null
) on commit preserve rows;

create or replace function pg_temp._record(
  p_number integer,
  p_name text,
  p_status text,
  p_detail text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_reader_scope_results (
    scenario_number,
    scenario_name,
    status,
    detail
  )
  values (
    p_number,
    p_name,
    p_status,
    coalesce(p_detail, '<null>')
  )
  on conflict (scenario_number) do update
  set
    scenario_name = excluded.scenario_name,
    status = excluded.status,
    detail = excluded.detail;
end;
$function$;

create temp table pg_temp._ctx (
  singleton boolean primary key default true check (singleton),

  run_id uuid not null,
  org_id uuid not null,
  store_id uuid not null,
  user_id uuid not null,
  customer_id uuid not null,

  lead_valid uuid not null,
  lead_no_session uuid not null,
  lead_no_context uuid not null,
  lead_ambiguous uuid not null,

  conversation_valid uuid not null,
  conversation_no_session uuid not null,
  conversation_no_context uuid not null,
  conversation_ambiguous uuid not null,

  opportunity_valid uuid not null,
  opportunity_no_session uuid not null,
  opportunity_no_context uuid not null,
  opportunity_ambiguous_a uuid not null,
  opportunity_ambiguous_b uuid not null,

  lead_link_valid uuid not null,
  lead_link_no_session uuid not null,
  lead_link_no_context uuid not null,
  lead_link_ambiguous uuid not null,

  session_valid uuid not null,
  session_no_context uuid not null,

  context_valid uuid not null
) on commit preserve rows;

insert into pg_temp._ctx
values (
  true,

  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),

  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),

  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),

  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),

  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),

  gen_random_uuid(),
  gen_random_uuid(),

  gen_random_uuid()
);

do $setup$
declare
  v pg_temp._ctx;
begin
  select *
  into strict v
  from pg_temp._ctx;

  insert into auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token,
    is_sso_user,
    is_anonymous
  )
  values (
    v.user_id,
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    'p9-reader-scope-' || v.run_id::text || '@example.test',
    '',
    now(),
    jsonb_build_object(
      'provider', 'email',
      'providers', jsonb_build_array('email')
    ),
    jsonb_build_object('runner', true),
    now(),
    now(),
    '',
    '',
    '',
    '',
    false,
    false
  );

  insert into public.organizations (
    id,
    name
  )
  values (
    v.org_id,
    'P9 Reader Scope Org ' || v.run_id::text
  );

  insert into public.stores (
    id,
    organization_id,
    name
  )
  values (
    v.store_id,
    v.org_id,
    'P9 Reader Scope Store ' || v.run_id::text
  );

  insert into public.memberships (
    organization_id,
    user_id,
    role
  )
  values (
    v.org_id,
    v.user_id,
    'owner'
  );

  insert into public.customers (
    id,
    organization_id,
    display_name
  )
  values (
    v.customer_id,
    v.org_id,
    'P9 Reader Scope Customer'
  );

  insert into public.customer_store_links (
    organization_id,
    store_id,
    customer_id
  )
  values (
    v.org_id,
    v.store_id,
    v.customer_id
  );

  insert into public.leads (
    id,
    organization_id,
    store_id,
    name,
    phone,
    state
  )
  values
    (
      v.lead_valid,
      v.org_id,
      v.store_id,
      'P9 Scope Valid',
      '5511988800101',
      'novo_lead'
    ),
    (
      v.lead_no_session,
      v.org_id,
      v.store_id,
      'P9 Scope No Session',
      '5511988800102',
      'novo_lead'
    ),
    (
      v.lead_no_context,
      v.org_id,
      v.store_id,
      'P9 Scope No Context',
      '5511988800103',
      'novo_lead'
    ),
    (
      v.lead_ambiguous,
      v.org_id,
      v.store_id,
      'P9 Scope Ambiguous',
      '5511988800104',
      'novo_lead'
    );

  insert into public.lead_customer_links (
    id,
    organization_id,
    store_id,
    lead_id,
    customer_id,
    status,
    source,
    linked_by_actor_type,
    metadata
  )
  values
    (
      v.lead_link_valid,
      v.org_id,
      v.store_id,
      v.lead_valid,
      v.customer_id,
      'active',
      'system',
      'system',
      '{"fixture":"reader_scope_integrity"}'::jsonb
    ),
    (
      v.lead_link_no_session,
      v.org_id,
      v.store_id,
      v.lead_no_session,
      v.customer_id,
      'active',
      'system',
      'system',
      '{"fixture":"reader_scope_integrity"}'::jsonb
    ),
    (
      v.lead_link_no_context,
      v.org_id,
      v.store_id,
      v.lead_no_context,
      v.customer_id,
      'active',
      'system',
      'system',
      '{"fixture":"reader_scope_integrity"}'::jsonb
    ),
    (
      v.lead_link_ambiguous,
      v.org_id,
      v.store_id,
      v.lead_ambiguous,
      v.customer_id,
      'active',
      'system',
      'system',
      '{"fixture":"reader_scope_integrity"}'::jsonb
    );

  insert into public.conversations (
    id,
    organization_id,
    lead_id,
    status,
    is_human_active
  )
  values
    (
      v.conversation_valid,
      v.org_id,
      v.lead_valid,
      'active',
      false
    ),
    (
      v.conversation_no_session,
      v.org_id,
      v.lead_no_session,
      'active',
      false
    ),
    (
      v.conversation_no_context,
      v.org_id,
      v.lead_no_context,
      'active',
      false
    ),
    (
      v.conversation_ambiguous,
      v.org_id,
      v.lead_ambiguous,
      'active',
      false
    );

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    origin_lead_id,
    primary_conversation_id,
    stage,
    lifecycle_cycle,
    created_at,
    updated_at
  )
  values
    (
      v.opportunity_valid,
      v.org_id,
      v.store_id,
      v.customer_id,
      v.lead_valid,
      v.conversation_valid,
      'orcamento',
      1,
      now(),
      now()
    ),
    (
      v.opportunity_no_session,
      v.org_id,
      v.store_id,
      v.customer_id,
      v.lead_no_session,
      v.conversation_no_session,
      'orcamento',
      1,
      now(),
      now()
    ),
    (
      v.opportunity_no_context,
      v.org_id,
      v.store_id,
      v.customer_id,
      v.lead_no_context,
      v.conversation_no_context,
      'orcamento',
      1,
      now(),
      now()
    ),
    (
      v.opportunity_ambiguous_a,
      v.org_id,
      v.store_id,
      v.customer_id,
      v.lead_ambiguous,
      v.conversation_ambiguous,
      'orcamento',
      1,
      now(),
      now()
    ),
    (
      v.opportunity_ambiguous_b,
      v.org_id,
      v.store_id,
      v.customer_id,
      v.lead_ambiguous,
      v.conversation_ambiguous,
      'negociacao',
      1,
      now(),
      now()
    );

  insert into public.conversation_sessions (
    id,
    organization_id,
    store_id,
    conversation_id,
    status
  )
  values
    (
      v.session_valid,
      v.org_id,
      v.store_id,
      v.conversation_valid,
      'active'
    ),
    (
      v.session_no_context,
      v.org_id,
      v.store_id,
      v.conversation_no_context,
      'active'
    );

  insert into public.commercial_session_context_links (
    id,
    organization_id,
    store_id,
    conversation_session_id,
    customer_id,
    commercial_opportunity_id,
    lead_customer_link_id,
    status,
    source,
    linked_by_actor_type,
    metadata
  )
  values (
    v.context_valid,
    v.org_id,
    v.store_id,
    v.session_valid,
    v.customer_id,
    v.opportunity_valid,
    v.lead_link_valid,
    'active',
    'system',
    'system',
    '{"fixture":"reader_scope_integrity"}'::jsonb
  );

  insert into public.conversation_ai_window_state (
    conversation_id,
    organization_id,
    store_id,
    waiting_next_day,
    pending_supervisor,
    last_ai_message_at,
    last_customer_message_at,
    next_resume_at,
    updated_at,
    resume_reason
  )
  values
    (
      v.conversation_valid,
      v.org_id,
      v.store_id,
      false,
      false,
      pg_catalog.clock_timestamp() - interval '49 hours',
      pg_catalog.clock_timestamp() - interval '48 hours',
      null,
      pg_catalog.clock_timestamp(),
      'none'
    ),
    (
      v.conversation_no_session,
      v.org_id,
      v.store_id,
      false,
      false,
      pg_catalog.clock_timestamp() - interval '49 hours',
      pg_catalog.clock_timestamp() - interval '48 hours',
      null,
      pg_catalog.clock_timestamp(),
      'none'
    ),
    (
      v.conversation_no_context,
      v.org_id,
      v.store_id,
      false,
      false,
      pg_catalog.clock_timestamp() - interval '49 hours',
      pg_catalog.clock_timestamp() - interval '48 hours',
      null,
      pg_catalog.clock_timestamp(),
      'none'
    ),
    (
      v.conversation_ambiguous,
      v.org_id,
      v.store_id,
      false,
      false,
      pg_catalog.clock_timestamp() - interval '49 hours',
      pg_catalog.clock_timestamp() - interval '48 hours',
      null,
      pg_catalog.clock_timestamp(),
      'none'
    );
end;
$setup$;

create or replace function pg_temp._reader_result(
  p_user_id uuid,
  p_org_id uuid,
  p_store_id uuid
)
returns jsonb
language plpgsql
as $function$
declare
  v_result jsonb;
begin
  perform set_config(
    'request.jwt.claim.sub',
    p_user_id::text,
    true
  );

  perform set_config(
    'request.jwt.claim.role',
    'authenticated',
    true
  );

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role',
      'authenticated',
      'sub',
      p_user_id::text
    )::text,
    true
  );

  execute 'set local role authenticated';

  select jsonb_agg(
    to_jsonb(candidate)
    order by candidate.commercial_opportunity_id
  )
  into v_result
  from public.panel_list_followup_opportunity_candidates_scoped(
    p_org_id,
    p_store_id,
    'offer',
    24,
    100
  ) candidate;

  execute 'reset role';

  return coalesce(v_result, '[]'::jsonb);

exception
  when others then
    begin
      execute 'reset role';
    exception
      when others then
        null;
    end;

    raise;
end;
$function$;

do $scenarios$
declare
  v pg_temp._ctx;
  v_rows jsonb;
  v_reason text;
  v_count integer;
  v_definition text;
begin
  select *
  into strict v
  from pg_temp._ctx;

  v_rows := pg_temp._reader_result(
    v.user_id,
    v.org_id,
    v.store_id
  );

  --------------------------------------------------------------
  -- 1. Cadeia íntegra continua liberada
  --------------------------------------------------------------

  select item ->> 'blocked_reason'
  into v_reason
  from jsonb_array_elements(v_rows) item
  where item ->> 'commercial_opportunity_id'
      = v.opportunity_valid::text;

  perform pg_temp._record(
    1,
    'cadeia canonica integra continua liberada',
    case
      when v_reason is null then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(v_reason, '<null>')
  );

  --------------------------------------------------------------
  -- 2. Sem active conversation_session bloqueia
  --------------------------------------------------------------

  select item ->> 'blocked_reason'
  into v_reason
  from jsonb_array_elements(v_rows) item
  where item ->> 'commercial_opportunity_id'
      = v.opportunity_no_session::text;

  perform pg_temp._record(
    2,
    'sem active conversation session bloqueia',
    case
      when v_reason = 'primary_conversation_scope_inconsistency'
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(v_reason, '<null>')
  );

  --------------------------------------------------------------
  -- 3. Session ativa sem context link bloqueia
  --------------------------------------------------------------

  select item ->> 'blocked_reason'
  into v_reason
  from jsonb_array_elements(v_rows) item
  where item ->> 'commercial_opportunity_id'
      = v.opportunity_no_context::text;

  perform pg_temp._record(
    3,
    'session ativa sem commercial context bloqueia',
    case
      when v_reason = 'primary_conversation_scope_inconsistency'
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(v_reason, '<null>')
  );

  --------------------------------------------------------------
  -- 4. Ambiguidade continua tendo precedência
  --------------------------------------------------------------

  select
    count(*)
  into v_count
  from jsonb_array_elements(v_rows) item
  where item ->> 'conversation_id'
      = v.conversation_ambiguous::text
    and item ->> 'blocked_reason'
      = 'multiple_opportunities_same_conversation';

  perform pg_temp._record(
    4,
    'ambiguidade continua fail closed com precedencia',
    case
      when v_count = 2 then 'PASS'
      else 'SUT_FAIL'
    end,
    'rows=' || v_count::text
  );

  --------------------------------------------------------------
  -- 5. ACL preservada
  --------------------------------------------------------------

  perform pg_temp._record(
    5,
    'reader continua authenticated only',
    case
      when has_function_privilege(
        'authenticated',
        'public.panel_list_followup_opportunity_candidates_scoped(uuid,uuid,text,integer,integer)',
        'EXECUTE'
      )
       and not has_function_privilege(
        'anon',
        'public.panel_list_followup_opportunity_candidates_scoped(uuid,uuid,text,integer,integer)',
        'EXECUTE'
      )
        then 'PASS'
      else 'SUT_FAIL'
    end,
    'ACL validation'
  );

  --------------------------------------------------------------
  -- 6. Definição contém cadeia canônica
  --------------------------------------------------------------

  select pg_catalog.lower(
    pg_catalog.pg_get_functiondef(
      'public.panel_list_followup_opportunity_candidates_scoped(uuid,uuid,text,integer,integer)'::regprocedure
    )
  )
  into v_definition;

  perform pg_temp._record(
    6,
    'reader contem gate canonico completo',
    case
      when pg_catalog.strpos(
             v_definition,
             'conversation_sessions'
           ) > 0
       and pg_catalog.strpos(
             v_definition,
             'commercial_session_context_links'
           ) > 0
       and pg_catalog.strpos(
             v_definition,
             'lead_customer_links'
           ) > 0
       and pg_catalog.strpos(
             v_definition,
             'primary_conversation_scope_inconsistency'
           ) > 0
        then 'PASS'
      else 'SUT_FAIL'
    end,
    'function definition inspected'
  );

exception
  when others then
    perform pg_temp._record(
      1,
      'runner harness',
      'HARNESS_ERROR',
      sqlerrm
    );
end;
$scenarios$;

insert into pg_temp._p9_reader_scope_results (
  scenario_number,
  scenario_name,
  status,
  detail
)
select *
from (
  values
    (1, 'cadeia canonica integra continua liberada'),
    (2, 'sem active conversation session bloqueia'),
    (3, 'session ativa sem commercial context bloqueia'),
    (4, 'ambiguidade continua fail closed com precedencia'),
    (5, 'reader continua authenticated only'),
    (6, 'reader contem gate canonico completo')
) expected (
  scenario_number,
  scenario_name
)
cross join lateral (
  select
    'HARNESS_ERROR'::text as status,
    'scenario did not run'::text as detail
) missing
where not exists (
  select 1
  from pg_temp._p9_reader_scope_results actual
  where actual.scenario_number = expected.scenario_number
);

do $assertions$
declare
  v_failures integer;
  v_detail text;
begin
  select count(*)
  into v_failures
  from pg_temp._p9_reader_scope_results
  where status <> 'PASS';

  if v_failures > 0 then
    select string_agg(
      format(
        '#%s %s => %s (%s)',
        scenario_number,
        scenario_name,
        status,
        detail
      ),
      E'\n'
      order by scenario_number
    )
    into v_detail
    from pg_temp._p9_reader_scope_results
    where status <> 'PASS';

    raise exception using
      errcode = 'P0001',
      message = 'P9_FOLLOWUP_READER_SCOPE_INTEGRITY_CHECK_FAILED',
      detail = v_detail;
  end if;
end;
$assertions$;

select *
from pg_temp._p9_reader_scope_results
order by scenario_number;

rollback;