begin;

set transaction isolation level repeatable read;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_reopen_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_reopen_ctx (
  singleton boolean primary key default true check (singleton),
  org_a uuid not null,
  org_b uuid not null,
  store_a uuid not null,
  store_b uuid not null,
  store_c uuid not null,
  user_a uuid not null,
  customer_a uuid not null,
  customer_b uuid not null,
  opp_system uuid not null,
  opp_user uuid not null,
  opp_not_lost uuid not null,
  opp_scope uuid not null,
  opp_invalid_target uuid not null,
  opp_blank_reason uuid not null
) on commit preserve rows;

insert into pg_temp._p9_reopen_ctx (
  org_a,
  org_b,
  store_a,
  store_b,
  store_c,
  user_a,
  customer_a,
  customer_b,
  opp_system,
  opp_user,
  opp_not_lost,
  opp_scope,
  opp_invalid_target,
  opp_blank_reason
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
  gen_random_uuid()
);

create or replace function pg_temp._p9_reopen_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text default null
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_reopen_results(
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

create or replace function pg_temp._p9_reopen_exec_json(
  p_role text,
  p_user_id uuid,
  p_sql text
)
returns table (
  operation_succeeded boolean,
  value_json jsonb,
  returned_sqlstate text,
  message_text text,
  constraint_name text
)
language plpgsql
as $function$
declare
  v_value jsonb;
  v_state text;
  v_message text;
  v_constraint text;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    return query
    select false, null::jsonb, null::text,
      'runner helper must start as postgres'::text, null::text;
    return;
  end if;

  if p_role not in ('postgres', 'service_role', 'authenticated', 'anon') then
    return query
    select false, null::jsonb, 'P0001'::text,
      'unsupported role'::text, null::text;
    return;
  end if;

  if p_role <> 'postgres' then
    perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
    perform set_config('request.jwt.claim.role', p_role, true);
    perform set_config(
      'request.jwt.claims',
      pg_catalog.jsonb_build_object(
        'sub', coalesce(p_user_id::text, ''),
        'role', p_role
      )::text,
      true
    );
    execute pg_catalog.format('set local role %I', p_role);
  end if;

  begin
    execute pg_catalog.format(
      'select to_jsonb(result_row) from (%s) result_row',
      p_sql
    )
    into v_value;

    if p_role <> 'postgres' then
      execute 'reset role';
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      perform set_config('request.jwt.claims', '', true);
    end if;

    return query
    select true, v_value, null::text, null::text, null::text;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;

      if p_role <> 'postgres' then
        begin
          execute 'reset role';
        exception when others then
          null;
        end;
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claim.role', '', true);
        perform set_config('request.jwt.claims', '', true);
      end if;

      return query
      select false, null::jsonb, v_state, v_message, v_constraint;
  end;
exception
  when others then
    begin
      execute 'reset role';
    exception when others then
      null;
    end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);

    return query
    select false, null::jsonb, sqlstate::text,
      ('runner helper error: ' || sqlerrm)::text, null::text;
end;
$function$;

create or replace function pg_temp._p9_reopen_seed_loss(
  p_opportunity_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
as $function$
declare
  v_opp public.commercial_opportunities;
  v_event public.commercial_opportunity_lifecycle_events;
  v_event_key text;
begin
  select opportunity_row.*
  into v_opp
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_opportunity_id
  for update;

  if not found then
    raise exception 'runner loss seed opportunity missing';
  end if;

  if v_opp.stage = 'perdido' then
    raise exception 'runner loss seed requires non-lost opportunity';
  end if;

  v_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
    v_opp.organization_id,
    v_opp.store_id,
    v_opp.id,
    v_opp.lifecycle_cycle,
    'marked_lost',
    v_opp.stage,
    'perdido',
    'system',
    null,
    'explicit_refusal',
    null,
    'runner_seed_loss',
    null,
    null,
    null
  );

  insert into public.commercial_opportunity_lifecycle_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    customer_id,
    lifecycle_cycle,
    event_type,
    previous_stage,
    new_stage,
    reason_code,
    reason_details,
    evidence_type,
    evidence_message_id,
    evidence_summary,
    actor_type,
    actor_user_id,
    source,
    metadata,
    idempotency_key,
    event_key
  )
  values (
    v_opp.organization_id,
    v_opp.store_id,
    v_opp.id,
    v_opp.customer_id,
    v_opp.lifecycle_cycle,
    'marked_lost',
    v_opp.stage,
    'perdido',
    'explicit_refusal',
    null,
    null,
    null,
    null,
    'system',
    null,
    'runner_seed_loss',
    '{"runner":true}'::jsonb,
    p_idempotency_key,
    v_event_key
  )
  returning *
  into v_event;

  update public.commercial_opportunities opportunity_row
  set
    stage = 'perdido',
    lost_at = v_event.created_at,
    lost_reason_code = v_event.reason_code,
    lost_reason_details = v_event.reason_details,
    current_loss_event_id = v_event.id
  where opportunity_row.id = v_opp.id;

  return v_event.id;
end;
$function$;

do $fixtures$
declare
  c pg_temp._p9_reopen_ctx%rowtype;
begin
  select * into c from pg_temp._p9_reopen_ctx;

  insert into public.organizations(id, name, subscription_status)
  values
    (c.org_a, 'P9 reopen runner org A', 'active'),
    (c.org_b, 'P9 reopen runner org B', 'active');

  insert into public.stores(id, organization_id, name)
  values
    (c.store_a, c.org_a, 'P9 reopen runner store A'),
    (c.store_b, c.org_a, 'P9 reopen runner store B'),
    (c.store_c, c.org_b, 'P9 reopen runner store C');

  insert into auth.users(id)
  values (c.user_a);

  insert into public.memberships(organization_id, user_id, role, is_active)
  values (c.org_a, c.user_a, 'owner'::public.app_role, true);

  insert into public.customers(id, organization_id, display_name, normalized_name)
  values
    (c.customer_a, c.org_a, 'P9 reopen customer A', 'p9 reopen customer a'),
    (c.customer_b, c.org_b, 'P9 reopen customer B', 'p9 reopen customer b');

  insert into public.customer_store_links(organization_id, store_id, customer_id)
  values
    (c.org_a, c.store_a, c.customer_a),
    (c.org_a, c.store_b, c.customer_a),
    (c.org_b, c.store_c, c.customer_b);

  insert into public.commercial_opportunities(
    id,
    organization_id,
    store_id,
    customer_id,
    stage
  )
  values
    (c.opp_system, c.org_a, c.store_a, c.customer_a, 'qualificacao'),
    (c.opp_user, c.org_a, c.store_a, c.customer_a, 'orcamento'),
    (c.opp_not_lost, c.org_a, c.store_a, c.customer_a, 'negociacao'),
    (c.opp_scope, c.org_a, c.store_a, c.customer_a, 'qualificacao'),
    (c.opp_invalid_target, c.org_a, c.store_a, c.customer_a, 'qualificacao'),
    (c.opp_blank_reason, c.org_a, c.store_a, c.customer_a, 'qualificacao');

  perform pg_temp._p9_reopen_seed_loss(c.opp_system, 'runner-seed-loss-system');
  perform pg_temp._p9_reopen_seed_loss(c.opp_user, 'runner-seed-loss-user');
  perform pg_temp._p9_reopen_seed_loss(c.opp_scope, 'runner-seed-loss-scope');
  perform pg_temp._p9_reopen_seed_loss(c.opp_invalid_target, 'runner-seed-loss-invalid-target');
  perform pg_temp._p9_reopen_seed_loss(c.opp_blank_reason, 'runner-seed-loss-blank-reason');
end;
$fixtures$;

do $s1$
declare
  v_ok boolean;
begin
  v_ok :=
    pg_catalog.to_regprocedure(
      'public.apply_commercial_opportunity_reopen_internal(uuid,uuid,uuid,text,text,text,text,text,uuid)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.reopen_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text,text)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.reopen_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,text)'
    ) is not null;

  perform pg_temp._p9_reopen_record(
    1,
    'core e wrappers esperados existem',
    case when v_ok then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  perform pg_temp._p9_reopen_record(1, 'core e wrappers esperados existem', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s1$;

do $s2$
declare
  v_ok boolean;
begin
  v_ok :=
    not pg_catalog.has_function_privilege(
      'authenticated',
      'public.apply_commercial_opportunity_reopen_internal(uuid,uuid,uuid,text,text,text,text,text,uuid)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role',
      'public.apply_commercial_opportunity_reopen_internal(uuid,uuid,uuid,text,text,text,text,text,uuid)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.apply_commercial_opportunity_reopen_internal(uuid,uuid,uuid,text,text,text,text,text,uuid)',
      'EXECUTE'
    );

  perform pg_temp._p9_reopen_record(
    2,
    'core interno nao e executavel externamente',
    case when v_ok then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  perform pg_temp._p9_reopen_record(2, 'core interno nao e executavel externamente', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s2$;

do $s3$
declare
  v_ok boolean;
begin
  v_ok :=
    pg_catalog.has_function_privilege(
      'authenticated',
      'public.reopen_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text,text)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role',
      'public.reopen_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text,text)',
      'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.reopen_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,text)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.reopen_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,text)',
      'EXECUTE'
    );

  perform pg_temp._p9_reopen_record(
    3,
    'grants separam human e system writers',
    case when v_ok then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  perform pg_temp._p9_reopen_record(3, 'grants separam human e system writers', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s3$;

do $s4$
declare
  v_user_def text;
  v_system_def text;
  v_ok boolean;
begin
  select pg_catalog.pg_get_functiondef(
    'public.reopen_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text,text)'::regprocedure
  ) into v_user_def;

  select pg_catalog.pg_get_functiondef(
    'public.reopen_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,text)'::regprocedure
  ) into v_system_def;

  v_ok :=
    pg_catalog.strpos(v_user_def, 'apply_commercial_opportunity_reopen_internal') > 0
    and pg_catalog.strpos(v_system_def, 'apply_commercial_opportunity_reopen_internal') > 0
    and pg_catalog.strpos(v_system_def, 'request.jwt.claim.role') > 0
    and pg_catalog.strpos(v_system_def, 'auth.jwt()') > 0;

  perform pg_temp._p9_reopen_record(
    4,
    'wrappers delegam ao mesmo core e system usa jwt fallback',
    case when v_ok then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  perform pg_temp._p9_reopen_record(4, 'wrappers delegam ao mesmo core e system usa jwt fallback', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s4$;

do $s5$
declare
  c pg_temp._p9_reopen_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_reopen_ctx;

  select * into r
  from pg_temp._p9_reopen_exec_json(
    'service_role',
    null,
    pg_catalog.format(
      $sql$
        select *
        from public.reopen_commercial_opportunity_by_system(
          %L::uuid,%L::uuid,%L::uuid,%L,%L,%L,%L
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_system,
      'runner-system-reopen',
      'qualificacao',
      'mesma intencao comprovada pelo runner',
      'p9_intent_resolution'
    )
  );

  v_ok :=
    r.operation_succeeded
    and r.value_json ->> 'commercial_opportunity_id' = c.opp_system::text
    and r.value_json ->> 'stage' = 'qualificacao'
    and (r.value_json ->> 'lifecycle_cycle')::integer = 2
    and r.value_json ->> 'current_loss_event_id' is null;

  perform pg_temp._p9_reopen_record(
    5,
    'system writer reabre opportunity perdida',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.value_json::text, r.returned_sqlstate || ' ' || r.message_text)
  );
exception when others then
  perform pg_temp._p9_reopen_record(5, 'system writer reabre opportunity perdida', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s5$;

do $s6$
declare
  c pg_temp._p9_reopen_ctx%rowtype;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_reopen_ctx;

  select exists (
    select 1
    from public.commercial_opportunity_lifecycle_events event_row
    where event_row.commercial_opportunity_id = c.opp_system
      and event_row.idempotency_key = 'runner-system-reopen'
      and event_row.event_type = 'reopened'
      and event_row.actor_type = 'system'
      and event_row.actor_user_id is null
      and event_row.previous_stage = 'perdido'
      and event_row.new_stage = 'qualificacao'
      and event_row.source = 'p9_intent_resolution'
  ) into v_ok;

  perform pg_temp._p9_reopen_record(
    6,
    'system reopen grava lifecycle event com ator system',
    case when v_ok then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  perform pg_temp._p9_reopen_record(6, 'system reopen grava lifecycle event com ator system', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s6$;

do $s7$
declare
  c pg_temp._p9_reopen_ctx%rowtype;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_reopen_ctx;

  select exists (
    select 1
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = c.opp_system
      and opportunity_row.stage = 'qualificacao'
      and opportunity_row.lifecycle_cycle = 2
      and opportunity_row.lost_at is null
      and opportunity_row.lost_reason_code is null
      and opportunity_row.lost_reason_details is null
      and opportunity_row.current_loss_event_id is null
      and opportunity_row.last_reopened_at is not null
  ) into v_ok;

  perform pg_temp._p9_reopen_record(
    7,
    'system reopen converge projection e limpa estado de perda',
    case when v_ok then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  perform pg_temp._p9_reopen_record(7, 'system reopen converge projection e limpa estado de perda', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s7$;

do $s8$
declare
  c pg_temp._p9_reopen_ctx%rowtype;
  r record;
  v_count bigint;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_reopen_ctx;

  select * into r
  from pg_temp._p9_reopen_exec_json(
    'service_role',
    null,
    pg_catalog.format(
      $sql$
        select *
        from public.reopen_commercial_opportunity_by_system(
          %L::uuid,%L::uuid,%L::uuid,%L,%L,%L,%L
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_system,
      'runner-system-reopen',
      'qualificacao',
      'mesma intencao comprovada pelo runner',
      'p9_intent_resolution'
    )
  );

  select count(*)
  into v_count
  from public.commercial_opportunity_lifecycle_events
  where commercial_opportunity_id = c.opp_system
    and idempotency_key = 'runner-system-reopen';

  v_ok :=
    r.operation_succeeded
    and (r.value_json ->> 'lifecycle_cycle')::integer = 2
    and v_count = 1;

  perform pg_temp._p9_reopen_record(
    8,
    'retry exato do system reopen e idempotente',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    pg_catalog.format('rows=%s result=%s', v_count, r.value_json)
  );
exception when others then
  perform pg_temp._p9_reopen_record(8, 'retry exato do system reopen e idempotente', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s8$;

do $s9$
declare
  c pg_temp._p9_reopen_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_reopen_ctx;

  select * into r
  from pg_temp._p9_reopen_exec_json(
    'service_role',
    null,
    pg_catalog.format(
      $sql$
        select *
        from public.reopen_commercial_opportunity_by_system(
          %L::uuid,%L::uuid,%L::uuid,%L,%L,%L,%L
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_system,
      'runner-system-reopen',
      'orcamento',
      'payload divergente',
      'p9_intent_resolution'
    )
  );

  v_ok :=
    not r.operation_succeeded
    and r.message_text = 'ZION_IDEMPOTENCY_KEY_REUSED';

  perform pg_temp._p9_reopen_record(
    9,
    'mesma idempotency key com payload divergente e rejeitada',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, '<null>')
  );
exception when others then
  perform pg_temp._p9_reopen_record(9, 'mesma idempotency key com payload divergente e rejeitada', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s9$;

do $s10$
declare
  c pg_temp._p9_reopen_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_reopen_ctx;

  select * into r
  from pg_temp._p9_reopen_exec_json(
    'service_role',
    null,
    pg_catalog.format(
      $sql$
        select *
        from public.reopen_commercial_opportunity_by_system(
          %L::uuid,%L::uuid,%L::uuid,%L,%L,%L,%L
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_not_lost,
      'runner-not-lost',
      'qualificacao',
      'nao deve reabrir',
      'p9_intent_resolution'
    )
  );

  v_ok :=
    not r.operation_succeeded
    and r.message_text = 'ZION_REOPEN_REQUIRES_LOST_STAGE';

  perform pg_temp._p9_reopen_record(
    10,
    'system reopen exige stage perdido',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, '<null>')
  );
exception when others then
  perform pg_temp._p9_reopen_record(10, 'system reopen exige stage perdido', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s10$;

do $s11$
declare
  c pg_temp._p9_reopen_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_reopen_ctx;

  select * into r
  from pg_temp._p9_reopen_exec_json(
    'service_role',
    null,
    pg_catalog.format(
      $sql$
        select *
        from public.reopen_commercial_opportunity_by_system(
          %L::uuid,%L::uuid,%L::uuid,%L,%L,%L,%L
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_invalid_target,
      'runner-invalid-target',
      'perdido',
      'target invalido',
      'p9_intent_resolution'
    )
  );

  v_ok :=
    not r.operation_succeeded
    and r.message_text = 'ZION_REOPEN_TARGET_STAGE_INVALID';

  perform pg_temp._p9_reopen_record(
    11,
    'target perdido nao e aceito no reopen',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, '<null>')
  );
exception when others then
  perform pg_temp._p9_reopen_record(11, 'target perdido nao e aceito no reopen', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s11$;

do $s12$
declare
  c pg_temp._p9_reopen_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_reopen_ctx;

  select * into r
  from pg_temp._p9_reopen_exec_json(
    'service_role',
    null,
    pg_catalog.format(
      $sql$
        select *
        from public.reopen_commercial_opportunity_by_system(
          %L::uuid,%L::uuid,%L::uuid,%L,%L,%L,%L
        )
      $sql$,
      c.org_a,
      c.store_b,
      c.opp_scope,
      'runner-wrong-store',
      'qualificacao',
      'scope errado',
      'p9_intent_resolution'
    )
  );

  v_ok :=
    not r.operation_succeeded
    and r.message_text = 'commercial opportunity scope mismatch';

  perform pg_temp._p9_reopen_record(
    12,
    'system reopen rejeita store divergente',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, '<null>')
  );
exception when others then
  perform pg_temp._p9_reopen_record(12, 'system reopen rejeita store divergente', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s12$;

do $s13$
declare
  c pg_temp._p9_reopen_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_reopen_ctx;

  select * into r
  from pg_temp._p9_reopen_exec_json(
    'authenticated',
    c.user_a,
    pg_catalog.format(
      $sql$
        select *
        from public.reopen_commercial_opportunity_by_system(
          %L::uuid,%L::uuid,%L::uuid,%L,%L,%L,%L
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_scope,
      'runner-auth-system',
      'qualificacao',
      'auth nao pode',
      'p9_intent_resolution'
    )
  );

  v_ok := not r.operation_succeeded;

  perform pg_temp._p9_reopen_record(
    13,
    'authenticated nao executa system reopen',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, '<null>')
  );
exception when others then
  perform pg_temp._p9_reopen_record(13, 'authenticated nao executa system reopen', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s13$;

do $s14$
declare
  c pg_temp._p9_reopen_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_reopen_ctx;

  select * into r
  from pg_temp._p9_reopen_exec_json(
    'service_role',
    null,
    pg_catalog.format(
      $sql$
        select *
        from public.reopen_commercial_opportunity_by_user(
          %L::uuid,%L::uuid,%L::uuid,%L,%L,%L,%L
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_user,
      'runner-service-user',
      'orcamento',
      'service nao pode',
      'manual_reopen'
    )
  );

  v_ok := not r.operation_succeeded;

  perform pg_temp._p9_reopen_record(
    14,
    'service_role nao executa human reopen',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, '<null>')
  );
exception when others then
  perform pg_temp._p9_reopen_record(14, 'service_role nao executa human reopen', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s14$;

do $s15$
declare
  c pg_temp._p9_reopen_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_reopen_ctx;

  select * into r
  from pg_temp._p9_reopen_exec_json(
    'authenticated',
    c.user_a,
    pg_catalog.format(
      $sql$
        select *
        from public.reopen_commercial_opportunity_by_user(
          %L::uuid,%L::uuid,%L::uuid,%L,%L,%L,%L
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_user,
      'runner-user-reopen',
      'orcamento',
      'reabertura humana preservada',
      'manual_reopen'
    )
  );

  select exists (
    select 1
    from public.commercial_opportunity_lifecycle_events event_row
    where event_row.commercial_opportunity_id = c.opp_user
      and event_row.idempotency_key = 'runner-user-reopen'
      and event_row.event_type = 'reopened'
      and event_row.actor_type = 'human'
      and event_row.actor_user_id = c.user_a
      and event_row.new_stage = 'orcamento'
  )
  and r.operation_succeeded
  into v_ok;

  perform pg_temp._p9_reopen_record(
    15,
    'human reopen continua funcional e preserva ator humano',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.value_json::text, r.returned_sqlstate || ' ' || r.message_text)
  );
exception when others then
  perform pg_temp._p9_reopen_record(15, 'human reopen continua funcional e preserva ator humano', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s15$;

do $s16$
declare
  c pg_temp._p9_reopen_ctx%rowtype;
  r record;
  v_count bigint;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_reopen_ctx;

  select * into r
  from pg_temp._p9_reopen_exec_json(
    'authenticated',
    c.user_a,
    pg_catalog.format(
      $sql$
        select *
        from public.reopen_commercial_opportunity_by_user(
          %L::uuid,%L::uuid,%L::uuid,%L,%L,%L,%L
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_user,
      'runner-user-reopen',
      'orcamento',
      'reabertura humana preservada',
      'manual_reopen'
    )
  );

  select count(*)
  into v_count
  from public.commercial_opportunity_lifecycle_events
  where commercial_opportunity_id = c.opp_user
    and idempotency_key = 'runner-user-reopen';

  v_ok := r.operation_succeeded and v_count = 1;

  perform pg_temp._p9_reopen_record(
    16,
    'retry exato do human reopen continua idempotente',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    pg_catalog.format('rows=%s result=%s', v_count, r.value_json)
  );
exception when others then
  perform pg_temp._p9_reopen_record(16, 'retry exato do human reopen continua idempotente', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s16$;

do $s17$
declare
  c pg_temp._p9_reopen_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_reopen_ctx;

  select * into r
  from pg_temp._p9_reopen_exec_json(
    'authenticated',
    c.user_a,
    pg_catalog.format(
      $sql$
        select *
        from public.reopen_commercial_opportunity_by_user(
          %L::uuid,%L::uuid,%L::uuid,%L,%L,%L,%L
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_user,
      'runner-user-reopen',
      'negociacao',
      'payload humano divergente',
      'manual_reopen'
    )
  );

  v_ok :=
    not r.operation_succeeded
    and r.message_text = 'ZION_IDEMPOTENCY_KEY_REUSED';

  perform pg_temp._p9_reopen_record(
    17,
    'human reopen preserva protecao de idempotency payload',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, '<null>')
  );
exception when others then
  perform pg_temp._p9_reopen_record(17, 'human reopen preserva protecao de idempotency payload', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s17$;

do $s18$
declare
  c pg_temp._p9_reopen_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_reopen_ctx;

  select * into r
  from pg_temp._p9_reopen_exec_json(
    'service_role',
    null,
    pg_catalog.format(
      $sql$
        select *
        from public.reopen_commercial_opportunity_by_system(
          %L::uuid,%L::uuid,%L::uuid,%L,%L,%L,%L
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_blank_reason,
      'runner-blank-reason',
      'qualificacao',
      '   ',
      'p9_intent_resolution'
    )
  );

  v_ok :=
    not r.operation_succeeded
    and r.returned_sqlstate = '22023';

  perform pg_temp._p9_reopen_record(
    18,
    'reason_details vazia e rejeitada fail-closed',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, '<null>')
  );
exception when others then
  perform pg_temp._p9_reopen_record(18, 'reason_details vazia e rejeitada fail-closed', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s18$;

do $s19$
declare
  v_actor_def text;
  v_reopened_def text;
  v_ok boolean;
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
  into v_actor_def
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid =
        'public.commercial_opportunity_lifecycle_events'::regclass
    and constraint_row.conname =
        'commercial_opportunity_lifecycle_events_actor_type_check';

  select pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
  into v_reopened_def
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid =
        'public.commercial_opportunity_lifecycle_events'::regclass
    and constraint_row.conname =
        'commercial_opportunity_lifecycle_events_reopened_shape_check';

  v_ok :=
    pg_catalog.strpos(pg_catalog.lower(v_actor_def), '''system''') > 0
    and pg_catalog.strpos(pg_catalog.lower(v_reopened_def), '''reopened''') > 0
    and pg_catalog.strpos(pg_catalog.lower(v_reopened_def), '''perdido''') > 0;

  perform pg_temp._p9_reopen_record(
    19,
    'constraints lifecycle aceitam actor system e preservam shape reopened',
    case when v_ok then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  perform pg_temp._p9_reopen_record(19, 'constraints lifecycle aceitam actor system e preservam shape reopened', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s19$;

do $s20$
declare
  v_trigger_def text;
  v_ok boolean;
begin
  select pg_catalog.pg_get_functiondef(
    'public.enforce_commercial_opportunity_loss_stage_transition()'::regprocedure
  )
  into v_trigger_def;

  v_ok :=
    pg_catalog.strpos(v_trigger_def, 'event_type = ''reopened''') > 0
    and pg_catalog.strpos(v_trigger_def, 'ZION_REOPEN_TRANSITION_EVENT_AMBIGUOUS') > 0
    and pg_catalog.strpos(v_trigger_def, 'ZION_REOPEN_PROJECTION_EVENT_MISMATCH') > 0
    and exists (
      select 1
      from pg_catalog.pg_class index_row
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = index_row.relnamespace
      where namespace_row.nspname = 'public'
        and index_row.relname =
            'commercial_opportunity_lifecycle_events_operational_slot_uidx'
    );

  perform pg_temp._p9_reopen_record(
    20,
    'trigger e operational slot de reopen permanecem protegidos',
    case when v_ok then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  perform pg_temp._p9_reopen_record(20, 'trigger e operational slot de reopen permanecem protegidos', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s20$;

select
  count(*) filter (where status = 'PASS') as passed,
  count(*) filter (where status = 'SUT_FAIL') as sut_failed,
  count(*) filter (where status = 'HARNESS_ERROR') as harness_errors,
  count(*) as total,
  count(*) filter (where status <> 'PASS') as failed_scenarios,
  (
    count(*) = 20
    and count(*) filter (where status = 'PASS') = 20
    and count(*) filter (where status <> 'PASS') = 0
  ) as all_20_passed,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'scenario_number', scenario_number,
        'scenario_name', scenario_name,
        'status', status,
        'detail', detail
      )
      order by scenario_number
    ) filter (where status <> 'PASS'),
    '[]'::jsonb
  ) as failures
from pg_temp._p9_reopen_results;

rollback;
