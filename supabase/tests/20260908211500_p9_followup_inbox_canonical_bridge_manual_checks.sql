begin;

set transaction isolation level repeatable read;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_followup_bridge_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (
    status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')
  ),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_followup_bridge_matrix (
  scenario_number integer primary key,
  scenario_name text not null
) on commit preserve rows;

insert into pg_temp._p9_followup_bridge_matrix (
  scenario_number,
  scenario_name
)
values
  (1, 'reader retorna oportunidade e conversa exatas'),
  (2, 'candidato elegivel fica desbloqueado'),
  (3, 'conversa com multiplas opportunities falha fechada'),
  (4, 'leitura cross-tenant nao autorizada'),
  (5, 'store mismatch no enqueue falha fechado'),
  (6, 'enqueue canonico cria followup e fila'),
  (7, 'followup canonico preserva contrato da inbox'),
  (8, 'fila carrega escopo canonico completo'),
  (9, 'replay identico e idempotente'),
  (10, 'replay incompativel falha fechado'),
  (11, 'opportunity conversation mismatch falha fechado'),
  (12, 'enqueue ambiguo nao ativa followup'),
  (13, 'reader reconhece followup canonico ativo'),
  (14, 'opportunity de outro tenant falha fechado'),
  (15, 'grants permitem authenticated e bloqueiam anon'),
  (16, 'ponte nao depende dos rpcs legados');

create temp table pg_temp._p9_followup_bridge_ctx (
  singleton boolean primary key default true check (singleton),

  run_id uuid not null,

  org_a uuid not null,
  org_b uuid not null,

  store_a uuid not null,
  store_a2 uuid not null,
  store_b uuid not null,

  user_a uuid not null,
  user_b uuid not null,

  customer_a uuid not null,
  customer_b uuid not null,

  lead_main uuid not null,
  lead_ambiguous uuid not null,
  lead_b uuid not null,

  conversation_main uuid not null,
  conversation_ambiguous uuid not null,
  conversation_b uuid not null,

  opportunity_main uuid not null,
  opportunity_ambiguous_a uuid not null,
  opportunity_ambiguous_b uuid not null,
  opportunity_b uuid not null,

  next_action_at timestamptz not null
) on commit preserve rows;

insert into pg_temp._p9_followup_bridge_ctx (
  run_id,

  org_a,
  org_b,

  store_a,
  store_a2,
  store_b,

  user_a,
  user_b,

  customer_a,
  customer_b,

  lead_main,
  lead_ambiguous,
  lead_b,

  conversation_main,
  conversation_ambiguous,
  conversation_b,

  opportunity_main,
  opportunity_ambiguous_a,
  opportunity_ambiguous_b,
  opportunity_b,

  next_action_at
)
values (
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

  '2099-01-01 12:00:00+00'::timestamptz
);

create or replace function pg_temp._p9_followup_bridge_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_followup_bridge_results (
    scenario_number,
    scenario_name,
    status,
    detail
  )
  values (
    p_scenario_number,
    p_scenario_name,
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

create or replace function pg_temp._p9_followup_bridge_exec(
  p_role text,
  p_user_id uuid,
  p_sql text
)
returns table (
  operation_succeeded boolean,
  value_text text,
  returned_sqlstate text,
  message_text text
)
language plpgsql
as $function$
declare
  v_value text;
  v_state text;
  v_message text;
  v_ok boolean := false;
begin
  if p_role not in (
    'postgres',
    'authenticated',
    'anon',
    'service_role'
  ) then
    return query
    select
      false,
      null::text,
      'P0001'::text,
      'unsupported role'::text;
    return;
  end if;

  if p_role <> 'postgres' then
    perform set_config(
      'request.jwt.claim.sub',
      coalesce(p_user_id::text, ''),
      true
    );

    perform set_config(
      'request.jwt.claim.role',
      p_role,
      true
    );

    perform set_config(
      'request.jwt.claims',
      case
        when p_user_id is null then
          jsonb_build_object(
            'role',
            p_role
          )::text
        else
          jsonb_build_object(
            'role',
            p_role,
            'sub',
            p_user_id::text
          )::text
      end,
      true
    );

    execute format('set local role %I', p_role);
  end if;

  begin
    execute p_sql into v_value;
    v_ok := true;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;

      v_ok := false;
  end;

  begin
    execute 'reset role';
  exception
    when others then
      null;
  end;

  perform set_config(
    'request.jwt.claim.sub',
    '',
    true
  );

  perform set_config(
    'request.jwt.claim.role',
    '',
    true
  );

  perform set_config(
    'request.jwt.claims',
    '',
    true
  );

  return query
  select
    v_ok,
    case
      when v_ok then v_value
      else null::text
    end,
    v_state,
    v_message;
end;
$function$;

create or replace function pg_temp._p9_followup_bridge_enqueue_sql(
  p_org uuid,
  p_store uuid,
  p_opportunity uuid,
  p_conversation uuid,
  p_followup_type text,
  p_operation_key text,
  p_cadence integer,
  p_next_action_at timestamptz
)
returns text
language sql
as $function$
  select format(
    $sql$
      select public.panel_enqueue_followup_opportunity_scoped(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L,
        %L,
        %s,
        %L::timestamptz
      )::text
    $sql$,
    p_org::text,
    p_store::text,
    p_opportunity::text,
    p_conversation::text,
    p_followup_type,
    p_operation_key,
    p_cadence,
    p_next_action_at::text
  );
$function$;

do $setup$
declare
  v pg_temp._p9_followup_bridge_ctx;

  v_lead_link_main uuid := gen_random_uuid();
  v_lead_link_ambiguous uuid := gen_random_uuid();
  v_lead_link_b uuid := gen_random_uuid();

  v_session_main uuid := gen_random_uuid();
  v_session_ambiguous uuid := gen_random_uuid();
  v_session_b uuid := gen_random_uuid();

  v_context_main uuid := gen_random_uuid();
  v_context_ambiguous uuid := gen_random_uuid();
  v_context_b uuid := gen_random_uuid();
begin
  select *
  into strict v
  from pg_temp._p9_followup_bridge_ctx;

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
  values
    (
      v.user_a,
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'runner-followup-bridge-a-'
        || v.run_id::text
        || '@example.test',
      '',
      now(),
      jsonb_build_object(
        'provider',
        'email',
        'providers',
        jsonb_build_array('email')
      ),
      jsonb_build_object(
        'runner',
        true,
        'key',
        'followup-bridge-a'
      ),
      now(),
      now(),
      '',
      '',
      '',
      '',
      false,
      false
    ),
    (
      v.user_b,
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'runner-followup-bridge-b-'
        || v.run_id::text
        || '@example.test',
      '',
      now(),
      jsonb_build_object(
        'provider',
        'email',
        'providers',
        jsonb_build_array('email')
      ),
      jsonb_build_object(
        'runner',
        true,
        'key',
        'followup-bridge-b'
      ),
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
  values
    (
      v.org_a,
      'Runner Followup Bridge Org A '
        || v.run_id::text
    ),
    (
      v.org_b,
      'Runner Followup Bridge Org B '
        || v.run_id::text
    );

  insert into public.stores (
    id,
    organization_id,
    name
  )
  values
    (
      v.store_a,
      v.org_a,
      'Runner Followup Bridge Store A '
        || v.run_id::text
    ),
    (
      v.store_a2,
      v.org_a,
      'Runner Followup Bridge Store A2 '
        || v.run_id::text
    ),
    (
      v.store_b,
      v.org_b,
      'Runner Followup Bridge Store B '
        || v.run_id::text
    );

  insert into public.memberships (
    organization_id,
    user_id,
    role
  )
  values
    (
      v.org_a,
      v.user_a,
      'owner'
    ),
    (
      v.org_b,
      v.user_b,
      'owner'
    );

  insert into public.customers (
    id,
    organization_id,
    display_name
  )
  values
    (
      v.customer_a,
      v.org_a,
      'Runner Followup Bridge Customer A'
    ),
    (
      v.customer_b,
      v.org_b,
      'Runner Followup Bridge Customer B'
    );

  insert into public.customer_store_links (
    organization_id,
    store_id,
    customer_id
  )
  values
    (
      v.org_a,
      v.store_a,
      v.customer_a
    ),
    (
      v.org_a,
      v.store_a2,
      v.customer_a
    ),
    (
      v.org_b,
      v.store_b,
      v.customer_b
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
      v.lead_main,
      v.org_a,
      v.store_a,
      'Runner Main',
      '+5511999990001',
      'novo_lead'
    ),
    (
      v.lead_ambiguous,
      v.org_a,
      v.store_a,
      'Runner Ambiguous',
      '+5511999990002',
      'novo_lead'
    ),
    (
      v.lead_b,
      v.org_b,
      v.store_b,
      'Runner Tenant B',
      '+5511999990003',
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
      v_lead_link_main,
      v.org_a,
      v.store_a,
      v.lead_main,
      v.customer_a,
      'active',
      'system',
      'system',
      jsonb_build_object(
        'fixture',
        'p9_followup_inbox_bridge'
      )
    ),
    (
      v_lead_link_ambiguous,
      v.org_a,
      v.store_a,
      v.lead_ambiguous,
      v.customer_a,
      'active',
      'system',
      'system',
      jsonb_build_object(
        'fixture',
        'p9_followup_inbox_bridge'
      )
    ),
    (
      v_lead_link_b,
      v.org_b,
      v.store_b,
      v.lead_b,
      v.customer_b,
      'active',
      'system',
      'system',
      jsonb_build_object(
        'fixture',
        'p9_followup_inbox_bridge'
      )
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
      v.conversation_main,
      v.org_a,
      v.lead_main,
      'active',
      false
    ),
    (
      v.conversation_ambiguous,
      v.org_a,
      v.lead_ambiguous,
      'active',
      false
    ),
    (
      v.conversation_b,
      v.org_b,
      v.lead_b,
      'active',
      false
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
      v_session_main,
      v.org_a,
      v.store_a,
      v.conversation_main,
      'active'
    ),
    (
      v_session_ambiguous,
      v.org_a,
      v.store_a,
      v.conversation_ambiguous,
      'active'
    ),
    (
      v_session_b,
      v.org_b,
      v.store_b,
      v.conversation_b,
      'active'
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
      v.opportunity_main,
      v.org_a,
      v.store_a,
      v.customer_a,
      v.lead_main,
      v.conversation_main,
      'orcamento',
      1,
      now(),
      now()
    ),
    (
      v.opportunity_ambiguous_a,
      v.org_a,
      v.store_a,
      v.customer_a,
      v.lead_ambiguous,
      v.conversation_ambiguous,
      'orcamento',
      1,
      now(),
      now()
    ),
    (
      v.opportunity_ambiguous_b,
      v.org_a,
      v.store_a,
      v.customer_a,
      v.lead_ambiguous,
      v.conversation_ambiguous,
      'negociacao',
      1,
      now(),
      now()
    ),
    (
      v.opportunity_b,
      v.org_b,
      v.store_b,
      v.customer_b,
      v.lead_b,
      v.conversation_b,
      'orcamento',
      1,
      now(),
      now()
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
  values
    (
      v_context_main,
      v.org_a,
      v.store_a,
      v_session_main,
      v.customer_a,
      v.opportunity_main,
      v_lead_link_main,
      'active',
      'system',
      'system',
      jsonb_build_object(
        'fixture',
        'p9_followup_inbox_bridge'
      )
    ),
    (
      v_context_ambiguous,
      v.org_a,
      v.store_a,
      v_session_ambiguous,
      v.customer_a,
      v.opportunity_ambiguous_a,
      v_lead_link_ambiguous,
      'active',
      'system',
      'system',
      jsonb_build_object(
        'fixture',
        'p9_followup_inbox_bridge',
        'purpose',
        'ambiguity_fail_closed'
      )
    ),
    (
      v_context_b,
      v.org_b,
      v.store_b,
      v_session_b,
      v.customer_b,
      v.opportunity_b,
      v_lead_link_b,
      'active',
      'system',
      'system',
      jsonb_build_object(
        'fixture',
        'p9_followup_inbox_bridge'
      )
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
      v.conversation_main,
      v.org_a,
      v.store_a,
      false,
      false,
      pg_catalog.clock_timestamp()
        - interval '49 hours',
      pg_catalog.clock_timestamp()
        - interval '48 hours',
      null,
      pg_catalog.clock_timestamp(),
      'none'
    ),
    (
      v.conversation_ambiguous,
      v.org_a,
      v.store_a,
      false,
      false,
      pg_catalog.clock_timestamp()
        - interval '49 hours',
      pg_catalog.clock_timestamp()
        - interval '48 hours',
      null,
      pg_catalog.clock_timestamp(),
      'none'
    ),
    (
      v.conversation_b,
      v.org_b,
      v.store_b,
      false,
      false,
      pg_catalog.clock_timestamp()
        - interval '49 hours',
      pg_catalog.clock_timestamp()
        - interval '48 hours',
      null,
      pg_catalog.clock_timestamp(),
      'none'
    );
end;
$setup$;

do $scenarios$
declare
  v pg_temp._p9_followup_bridge_ctx;

  v_exec record;

  v_candidate jsonb;
  v_ambiguous jsonb;

  v_first_enqueue jsonb;
  v_replay jsonb;

  v_followup jsonb;
  v_queue jsonb;

  v_queue_count bigint;
  v_followup_count bigint;
begin
  select *
  into strict v
  from pg_temp._p9_followup_bridge_ctx;

  ----------------------------------------------------------------
  -- 1. Reader retorna opportunity + conversation exatas
  ----------------------------------------------------------------

  select *
  into v_exec
  from pg_temp._p9_followup_bridge_exec(
    'authenticated',
    v.user_a,
    format(
      $sql$
        select row_to_json(candidate)::text
        from public.panel_list_followup_opportunity_candidates_scoped(
          %L::uuid,
          %L::uuid,
          'offer',
          24,
          100
        ) candidate
        where candidate.commercial_opportunity_id = %L::uuid
          and candidate.conversation_id = %L::uuid
      $sql$,
      v.org_a::text,
      v.store_a::text,
      v.opportunity_main::text,
      v.conversation_main::text
    )
  );

  v_candidate := v_exec.value_text::jsonb;

  perform pg_temp._p9_followup_bridge_record(
    1,
    'reader retorna oportunidade e conversa exatas',
    case
      when v_exec.operation_succeeded
       and v_candidate ->> 'commercial_opportunity_id'
            = v.opportunity_main::text
       and v_candidate ->> 'conversation_id'
            = v.conversation_main::text
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(
      v_exec.value_text,
      v_exec.message_text,
      '<null>'
    )
  );

  ----------------------------------------------------------------
  -- 2. Candidato normal desbloqueado
  ----------------------------------------------------------------

  perform pg_temp._p9_followup_bridge_record(
    2,
    'candidato elegivel fica desbloqueado',
    case
      when v_candidate is not null
       and v_candidate -> 'blocked_reason' = 'null'::jsonb
       and v_candidate ->> 'suggested_action'
            = 'followup_offer'
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(
      v_candidate::text,
      '<null>'
    )
  );

  ----------------------------------------------------------------
  -- 3. Conversa ambigua
  ----------------------------------------------------------------

  select *
  into v_exec
  from pg_temp._p9_followup_bridge_exec(
    'authenticated',
    v.user_a,
    format(
      $sql$
        select jsonb_build_object(
          'count',
          count(*),
          'all_blocked',
          coalesce(
            bool_and(
              candidate.blocked_reason
                = 'multiple_opportunities_same_conversation'
            ),
            false
          )
        )::text
        from public.panel_list_followup_opportunity_candidates_scoped(
          %L::uuid,
          %L::uuid,
          'offer',
          24,
          100
        ) candidate
        where candidate.conversation_id = %L::uuid
      $sql$,
      v.org_a::text,
      v.store_a::text,
      v.conversation_ambiguous::text
    )
  );

  v_ambiguous := v_exec.value_text::jsonb;

  perform pg_temp._p9_followup_bridge_record(
    3,
    'conversa com multiplas opportunities falha fechada',
    case
      when v_exec.operation_succeeded
       and (v_ambiguous ->> 'count')::integer = 2
       and (v_ambiguous ->> 'all_blocked')::boolean
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(
      v_exec.value_text,
      v_exec.message_text,
      '<null>'
    )
  );

  ----------------------------------------------------------------
  -- 4. Cross tenant reader
  ----------------------------------------------------------------

  select *
  into v_exec
  from pg_temp._p9_followup_bridge_exec(
    'authenticated',
    v.user_a,
    format(
      $sql$
        select count(*)::text
        from public.panel_list_followup_opportunity_candidates_scoped(
          %L::uuid,
          %L::uuid,
          'offer',
          24,
          100
        )
      $sql$,
      v.org_b::text,
      v.store_b::text
    )
  );

  perform pg_temp._p9_followup_bridge_record(
    4,
    'leitura cross-tenant nao autorizada',
    case
      when not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '42501'
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(
      v_exec.message_text,
      '<null>'
    )
  );

  ----------------------------------------------------------------
  -- 5. Store mismatch
  ----------------------------------------------------------------

  select *
  into v_exec
  from pg_temp._p9_followup_bridge_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_bridge_enqueue_sql(
      v.org_a,
      v.store_a2,
      v.opportunity_main,
      v.conversation_main,
      'offer',
      'bridge-store-mismatch-1',
      60,
      v.next_action_at
    )
  );

  perform pg_temp._p9_followup_bridge_record(
    5,
    'store mismatch no enqueue falha fechado',
    case
      when not v_exec.operation_succeeded
       and coalesce(
         v_exec.message_text,
         ''
       ) like '%commercial opportunity not found%'
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(
      v_exec.message_text,
      '<null>'
    )
  );

  ----------------------------------------------------------------
  -- 6. Enqueue principal
  ----------------------------------------------------------------

  select *
  into v_exec
  from pg_temp._p9_followup_bridge_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_bridge_enqueue_sql(
      v.org_a,
      v.store_a,
      v.opportunity_main,
      v.conversation_main,
      'offer',
      'bridge-main-1',
      60,
      v.next_action_at
    )
  );

  v_first_enqueue := v_exec.value_text::jsonb;

  perform pg_temp._p9_followup_bridge_record(
    6,
    'enqueue canonico cria followup e fila',
    case
      when v_exec.operation_succeeded
       and (v_first_enqueue ->> 'ok')::boolean
       and not (v_first_enqueue ->> 'replayed')::boolean
       and v_first_enqueue ->> 'commercial_opportunity_id'
            = v.opportunity_main::text
       and v_first_enqueue ->> 'conversation_id'
            = v.conversation_main::text
       and nullif(
         v_first_enqueue ->> 'followup_id',
         ''
       ) is not null
       and nullif(
         v_first_enqueue ->> 'ai_run_id',
         ''
       ) is not null
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(
      v_exec.value_text,
      v_exec.message_text,
      '<null>'
    )
  );

  ----------------------------------------------------------------
  -- 7. Followup canônico persistido
  ----------------------------------------------------------------

  select to_jsonb(followup_row)
  into v_followup
  from public.commercial_opportunity_followups followup_row
  where followup_row.organization_id = v.org_a
    and followup_row.store_id = v.store_a
    and followup_row.commercial_opportunity_id
        = v.opportunity_main
    and followup_row.status = 'active';

  perform pg_temp._p9_followup_bridge_record(
    7,
    'followup canonico preserva contrato da inbox',
    case
      when v_followup ->> 'reason_code'
            = 'manual_inbox_followup'
       and v_followup #>> '{context,source}'
            = 'inbox_manual_followup'
       and v_followup #>> '{context,conversation_id}'
            = v.conversation_main::text
       and v_followup ->> 'next_action'
            = 'followup_offer'
       and v_followup ->> 'cadence_interval_minutes'
            = '60'
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(
      v_followup::text,
      '<null>'
    )
  );

  ----------------------------------------------------------------
  -- 8. Queue carrega escopo
  ----------------------------------------------------------------

  select to_jsonb(queue_row)
  into v_queue
  from public.ai_sales_action_queue queue_row
  where queue_row.organization_id = v.org_a
    and queue_row.store_id = v.store_a
    and queue_row.conversation_id = v.conversation_main
    and queue_row.action_key =
      'manual_followup_opportunity:'
      || v.opportunity_main::text
      || ':bridge-main-1';

  perform pg_temp._p9_followup_bridge_record(
    8,
    'fila carrega escopo canonico completo',
    case
      when v_queue ->> 'next_action' = 'followup_offer'
       and v_queue #>> '{payload,commercial_opportunity_id}'
            = v.opportunity_main::text
       and v_queue #>> '{payload,conversation_id}'
            = v.conversation_main::text
       and v_queue #>> '{payload,followup_id}'
            = v_followup ->> 'id'
       and v_queue #>> '{payload,followup_cycle}'
            = v_followup ->> 'cycle'
       and v_queue #>> '{payload,followup_operation_key}'
            = 'bridge-main-1'
       and v_queue #>> '{payload,followup_type}'
            = 'offer'
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(
      v_queue::text,
      '<null>'
    )
  );

  ----------------------------------------------------------------
  -- 9. Replay idempotente
  ----------------------------------------------------------------

  select *
  into v_exec
  from pg_temp._p9_followup_bridge_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_bridge_enqueue_sql(
      v.org_a,
      v.store_a,
      v.opportunity_main,
      v.conversation_main,
      'offer',
      'bridge-main-1',
      60,
      v.next_action_at
    )
  );

  v_replay := v_exec.value_text::jsonb;

  select count(*)
  into v_queue_count
  from public.ai_sales_action_queue queue_row
  where queue_row.organization_id = v.org_a
    and queue_row.store_id = v.store_a
    and queue_row.action_key =
      'manual_followup_opportunity:'
      || v.opportunity_main::text
      || ':bridge-main-1';

  select count(*)
  into v_followup_count
  from public.commercial_opportunity_followups followup_row
  where followup_row.organization_id = v.org_a
    and followup_row.store_id = v.store_a
    and followup_row.commercial_opportunity_id
        = v.opportunity_main
    and followup_row.status = 'active';

  perform pg_temp._p9_followup_bridge_record(
    9,
    'replay identico e idempotente',
    case
      when v_exec.operation_succeeded
       and (v_replay ->> 'ok')::boolean
       and (v_replay ->> 'replayed')::boolean
       and v_replay ->> 'ai_run_id'
            = v_first_enqueue ->> 'ai_run_id'
       and v_queue_count = 1
       and v_followup_count = 1
        then 'PASS'
      else 'SUT_FAIL'
    end,
    'queue_count='
      || v_queue_count::text
      || ', followup_count='
      || v_followup_count::text
      || ', replay='
      || coalesce(
        v_replay::text,
        '<null>'
      )
  );

  ----------------------------------------------------------------
  -- 10. Replay incompatível
  ----------------------------------------------------------------

  select *
  into v_exec
  from pg_temp._p9_followup_bridge_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_bridge_enqueue_sql(
      v.org_a,
      v.store_a,
      v.opportunity_main,
      v.conversation_main,
      'visit',
      'bridge-main-1',
      60,
      v.next_action_at
    )
  );

  perform pg_temp._p9_followup_bridge_record(
    10,
    'replay incompativel falha fechado',
    case
      when not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '23505'
       and v_exec.message_text
            = 'ZION_FOLLOWUP_INBOX_OPERATION_KEY_CONFLICT'
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(
      v_exec.message_text,
      '<null>'
    )
  );

  ----------------------------------------------------------------
  -- 11. Opportunity/conversation mismatch
  ----------------------------------------------------------------

  select *
  into v_exec
  from pg_temp._p9_followup_bridge_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_bridge_enqueue_sql(
      v.org_a,
      v.store_a,
      v.opportunity_main,
      v.conversation_ambiguous,
      'offer',
      'bridge-conversation-mismatch-1',
      60,
      v.next_action_at
    )
  );

  perform pg_temp._p9_followup_bridge_record(
    11,
    'opportunity conversation mismatch falha fechado',
    case
      when v_exec.operation_succeeded
       and not (
         (
           v_exec.value_text::jsonb
         ) ->> 'ok'
       )::boolean
       and (
         v_exec.value_text::jsonb
       ) ->> 'error'
            = 'opportunity_conversation_scope_mismatch'
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(
      v_exec.value_text,
      v_exec.message_text,
      '<null>'
    )
  );

  ----------------------------------------------------------------
  -- 12. Ambiguidade impede ativação
  ----------------------------------------------------------------

  select *
  into v_exec
  from pg_temp._p9_followup_bridge_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_bridge_enqueue_sql(
      v.org_a,
      v.store_a,
      v.opportunity_ambiguous_a,
      v.conversation_ambiguous,
      'offer',
      'bridge-ambiguous-1',
      60,
      v.next_action_at
    )
  );

  select count(*)
  into v_followup_count
  from public.commercial_opportunity_followups followup_row
  where followup_row.organization_id = v.org_a
    and followup_row.store_id = v.store_a
    and followup_row.commercial_opportunity_id
        = v.opportunity_ambiguous_a
    and followup_row.status = 'active';

  perform pg_temp._p9_followup_bridge_record(
    12,
    'enqueue ambiguo nao ativa followup',
    case
      when v_exec.operation_succeeded
       and not (
         (
           v_exec.value_text::jsonb
         ) ->> 'ok'
       )::boolean
       and (
         v_exec.value_text::jsonb
       ) ->> 'error' = 'followup_blocked'
       and (
         v_exec.value_text::jsonb
       ) ->> 'blocked_reason'
            = 'multiple_opportunities_same_conversation'
       and v_followup_count = 0
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(
      v_exec.value_text,
      v_exec.message_text,
      '<null>'
    )
  );

  ----------------------------------------------------------------
  -- 13. Reader agora reconhece active canônico
  ----------------------------------------------------------------

  select *
  into v_exec
  from pg_temp._p9_followup_bridge_exec(
    'authenticated',
    v.user_a,
    format(
      $sql$
        select candidate.blocked_reason::text
        from public.panel_list_followup_opportunity_candidates_scoped(
          %L::uuid,
          %L::uuid,
          'offer',
          24,
          100
        ) candidate
        where candidate.commercial_opportunity_id = %L::uuid
          and candidate.conversation_id = %L::uuid
      $sql$,
      v.org_a::text,
      v.store_a::text,
      v.opportunity_main::text,
      v.conversation_main::text
    )
  );

  perform pg_temp._p9_followup_bridge_record(
    13,
    'reader reconhece followup canonico ativo',
    case
      when v_exec.operation_succeeded
       and v_exec.value_text = 'followup_ja_ativo'
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(
      v_exec.value_text,
      v_exec.message_text,
      '<null>'
    )
  );

  ----------------------------------------------------------------
  -- 14. Opportunity de outro tenant
  ----------------------------------------------------------------

  select *
  into v_exec
  from pg_temp._p9_followup_bridge_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_bridge_enqueue_sql(
      v.org_a,
      v.store_a,
      v.opportunity_b,
      v.conversation_b,
      'offer',
      'bridge-cross-tenant-1',
      60,
      v.next_action_at
    )
  );

  perform pg_temp._p9_followup_bridge_record(
    14,
    'opportunity de outro tenant falha fechado',
    case
      when not v_exec.operation_succeeded
       and coalesce(
         v_exec.message_text,
         ''
       ) like '%commercial opportunity not found%'
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(
      v_exec.message_text,
      '<null>'
    )
  );

  ----------------------------------------------------------------
  -- 15. Grants
  ----------------------------------------------------------------

  perform pg_temp._p9_followup_bridge_record(
    15,
    'grants permitem authenticated e bloqueiam anon',
    case
      when has_function_privilege(
        'authenticated',
        'public.panel_list_followup_opportunity_candidates_scoped(uuid,uuid,text,integer,integer)',
        'EXECUTE'
      )
       and has_function_privilege(
        'authenticated',
        'public.panel_enqueue_followup_opportunity_scoped(uuid,uuid,uuid,uuid,text,text,integer,timestamp with time zone)',
        'EXECUTE'
      )
       and not has_function_privilege(
        'anon',
        'public.panel_list_followup_opportunity_candidates_scoped(uuid,uuid,text,integer,integer)',
        'EXECUTE'
      )
       and not has_function_privilege(
        'anon',
        'public.panel_enqueue_followup_opportunity_scoped(uuid,uuid,uuid,uuid,text,text,integer,timestamp with time zone)',
        'EXECUTE'
      )
        then 'PASS'
      else 'SUT_FAIL'
    end,
    'ACL validation'
  );

  ----------------------------------------------------------------
  -- 16. Nenhuma dependência dos RPCs legados
  ----------------------------------------------------------------

  perform pg_temp._p9_followup_bridge_record(
    16,
    'ponte nao depende dos rpcs legados',
    case
      when pg_catalog.pg_get_functiondef(
        'public.panel_list_followup_opportunity_candidates_scoped(uuid,uuid,text,integer,integer)'::regprocedure
      ) not like '%panel_list_followup_candidates_scoped%'
       and pg_catalog.pg_get_functiondef(
        'public.panel_enqueue_followup_opportunity_scoped(uuid,uuid,uuid,uuid,text,text,integer,timestamp with time zone)'::regprocedure
      ) not like '%panel_enqueue_followup_scoped%'
        then 'PASS'
      else 'SUT_FAIL'
    end,
    'canonical bridge definitions inspected'
  );

exception
  when others then
    perform pg_temp._p9_followup_bridge_record(
      1,
      'runner harness',
      'HARNESS_ERROR',
      sqlerrm
    );
end;
$scenarios$;

insert into pg_temp._p9_followup_bridge_results (
  scenario_number,
  scenario_name,
  status,
  detail
)
select
  matrix.scenario_number,
  matrix.scenario_name,
  'HARNESS_ERROR',
  'scenario did not run'
from pg_temp._p9_followup_bridge_matrix matrix
where not exists (
  select 1
  from pg_temp._p9_followup_bridge_results result
  where result.scenario_number
      = matrix.scenario_number
);

do $assertions$
declare
  v_failed_count integer;
  v_summary text;
begin
  select count(*)
  into v_failed_count
  from pg_temp._p9_followup_bridge_results
  where status <> 'PASS';

  if v_failed_count > 0 then
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
    into v_summary
    from pg_temp._p9_followup_bridge_results
    where status <> 'PASS';

    raise exception using
      errcode = 'P0001',
      message = 'P9_FOLLOWUP_INBOX_BRIDGE_MANUAL_CHECK_FAILED',
      detail = v_summary;
  end if;
end;
$assertions$;

select *
from pg_temp._p9_followup_bridge_results
order by scenario_number;

rollback;