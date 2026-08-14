begin;

create temp table pg_temp._operational_rpc_service_role_fix_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  details text not null
);

create or replace function pg_temp._operational_rpc_service_role_fix_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_details text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._operational_rpc_service_role_fix_results (
    scenario_number,
    scenario_name,
    status,
    details
  )
  values (
    p_scenario_number,
    p_scenario_name,
    p_status,
    p_details
  )
  on conflict (scenario_number) do update
  set scenario_name = excluded.scenario_name,
      status = excluded.status,
      details = excluded.details;
end;
$function$;

create or replace function pg_temp._operational_rpc_service_role_fix_require(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $function$
begin
  if coalesce(p_condition, false) is not true then
    raise exception using errcode = 'P0001', message = p_message;
  end if;
end;
$function$;

create or replace function pg_temp._operational_rpc_service_role_fix_set_auth(
  p_session_role text,
  p_user_id uuid default null,
  p_claim_role_setting text default null,
  p_claims_role text default null
)
returns void
language plpgsql
as $function$
begin
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform pg_catalog.set_config('request.jwt.claim.role', coalesce(p_claim_role_setting, ''), true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    case
      when p_claims_role is null or p_claims_role = '' then ''
      else jsonb_build_object('sub', coalesce(p_user_id::text, ''), 'role', p_claims_role)::text
    end,
    true
  );

  if p_session_role = 'authenticated' then
    execute 'set local role authenticated';
  elsif p_session_role = 'service_role' then
    execute 'set local role service_role';
  elsif p_session_role = 'anon' then
    execute 'set local role anon';
  end if;
end;
$function$;

create or replace function pg_temp._operational_rpc_service_role_fix_reset_auth()
returns void
language plpgsql
as $function$
begin
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claim.role', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '', true);
end;
$function$;

create or replace function pg_temp._operational_rpc_service_role_fix_exec(
  p_session_role text,
  p_user_id uuid,
  p_claim_role_setting text,
  p_claims_role text,
  p_sql text
)
returns table (
  operation_succeeded boolean,
  returned_sqlstate text,
  message_text text
)
language plpgsql
as $function$
declare
  v_state text;
  v_message text;
begin
  perform pg_temp._operational_rpc_service_role_fix_set_auth(
    p_session_role,
    p_user_id,
    p_claim_role_setting,
    p_claims_role
  );

  begin
    execute p_sql;
    perform pg_temp._operational_rpc_service_role_fix_reset_auth();
    return query select true, null::text, null::text;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;
      perform pg_temp._operational_rpc_service_role_fix_reset_auth();
      return query select false, v_state, v_message;
  end;
end;
$function$;

do $setup$
declare
  v_run_token text := 'operational_rpc_role_fix_' || replace(gen_random_uuid()::text, '-', '');
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_store_a uuid := gen_random_uuid();
  v_store_b uuid := gen_random_uuid();
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_user_inactive uuid := gen_random_uuid();
  v_lead_a uuid := gen_random_uuid();
  v_lead_b uuid := gen_random_uuid();
  v_conversation_a uuid := gen_random_uuid();
  v_conversation_b uuid := gen_random_uuid();
  v_appointment_a uuid := gen_random_uuid();
  v_appointment_b uuid := gen_random_uuid();
  v_appointment_c uuid := gen_random_uuid();
begin
  create temp table pg_temp._operational_rpc_service_role_fix_state (
    state_key text primary key,
    value_uuid uuid not null
  ) on commit drop;

  insert into public.organizations (id, name)
  values
    (v_org_a, 'Operational RPC Role Fix Org A ' || v_run_token),
    (v_org_b, 'Operational RPC Role Fix Org B ' || v_run_token);

  insert into public.stores (id, organization_id, name)
  values
    (v_store_a, v_org_a, 'Operational RPC Role Fix Store A ' || v_run_token),
    (v_store_b, v_org_b, 'Operational RPC Role Fix Store B ' || v_run_token);

  insert into auth.users (id)
  values
    (v_user_a),
    (v_user_b),
    (v_user_inactive);

  insert into public.memberships (organization_id, user_id, role, is_active)
  values
    (v_org_a, v_user_a, 'owner'::public.app_role, true),
    (v_org_b, v_user_b, 'owner'::public.app_role, true),
    (v_org_a, v_user_inactive, 'owner'::public.app_role, false);

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
      v_lead_a,
      v_org_a,
      v_store_a,
      'Role Fix Lead A ' || v_run_token,
      '5511990000001',
      'negociacao'
    ),
    (
      v_lead_b,
      v_org_b,
      v_store_b,
      'Role Fix Lead B ' || v_run_token,
      '5511990000002',
      'negociacao'
    );

  insert into public.conversations (
    id,
    organization_id,
    lead_id,
    status,
    is_human_active,
    created_at
  )
  values
    (
      v_conversation_a,
      v_org_a,
      v_lead_a,
      'open',
      false,
      now()
    ),
    (
      v_conversation_b,
      v_org_b,
      v_lead_b,
      'open',
      false,
      now()
    );

  insert into public.store_appointments (
    id,
    organization_id,
    store_id,
    title,
    appointment_type,
    status,
    scheduled_start,
    scheduled_end,
    customer_name,
    customer_phone,
    address_text,
    notes,
    lead_id,
    conversation_id
  )
  values
    (
      v_appointment_a,
      v_org_a,
      v_store_a,
      'Role Fix Appointment A ' || v_run_token,
      'technical_visit',
      'scheduled',
      now() + interval '1 day',
      now() + interval '1 day 1 hour',
      'Cliente A',
      '5511990000001',
      'Rua A',
      'runner',
      v_lead_a,
      v_conversation_a
    ),
    (
      v_appointment_b,
      v_org_b,
      v_store_b,
      'Role Fix Appointment B ' || v_run_token,
      'technical_visit',
      'scheduled',
      now() + interval '2 day',
      now() + interval '2 day 1 hour',
      'Cliente B',
      '5511990000002',
      'Rua B',
      'runner',
      v_lead_b,
      v_conversation_b
    ),
    (
      v_appointment_c,
      v_org_a,
      v_store_a,
      'Role Fix Appointment C ' || v_run_token,
      'technical_visit',
      'scheduled',
      now() + interval '3 day',
      now() + interval '3 day 1 hour',
      'Cliente C',
      '5511990000003',
      'Rua C',
      'runner',
      v_lead_a,
      v_conversation_a
    );

  insert into pg_temp._operational_rpc_service_role_fix_state (state_key, value_uuid)
  values
    ('org_a', v_org_a),
    ('org_b', v_org_b),
    ('store_a', v_store_a),
    ('store_b', v_store_b),
    ('user_a', v_user_a),
    ('user_b', v_user_b),
    ('user_inactive', v_user_inactive),
    ('lead_a', v_lead_a),
    ('lead_b', v_lead_b),
    ('conversation_a', v_conversation_a),
    ('conversation_b', v_conversation_b),
    ('appointment_a', v_appointment_a),
    ('appointment_b', v_appointment_b),
    ('appointment_c', v_appointment_c);
end;
$setup$;

do $checks$
declare
  v_org_a uuid := (select value_uuid from pg_temp._operational_rpc_service_role_fix_state where state_key = 'org_a');
  v_org_b uuid := (select value_uuid from pg_temp._operational_rpc_service_role_fix_state where state_key = 'org_b');
  v_store_a uuid := (select value_uuid from pg_temp._operational_rpc_service_role_fix_state where state_key = 'store_a');
  v_store_b uuid := (select value_uuid from pg_temp._operational_rpc_service_role_fix_state where state_key = 'store_b');
  v_user_a uuid := (select value_uuid from pg_temp._operational_rpc_service_role_fix_state where state_key = 'user_a');
  v_user_b uuid := (select value_uuid from pg_temp._operational_rpc_service_role_fix_state where state_key = 'user_b');
  v_user_inactive uuid := (select value_uuid from pg_temp._operational_rpc_service_role_fix_state where state_key = 'user_inactive');
  v_lead_a uuid := (select value_uuid from pg_temp._operational_rpc_service_role_fix_state where state_key = 'lead_a');
  v_lead_b uuid := (select value_uuid from pg_temp._operational_rpc_service_role_fix_state where state_key = 'lead_b');
  v_conversation_a uuid := (select value_uuid from pg_temp._operational_rpc_service_role_fix_state where state_key = 'conversation_a');
  v_conversation_b uuid := (select value_uuid from pg_temp._operational_rpc_service_role_fix_state where state_key = 'conversation_b');
  v_appointment_a uuid := (select value_uuid from pg_temp._operational_rpc_service_role_fix_state where state_key = 'appointment_a');
  v_appointment_b uuid := (select value_uuid from pg_temp._operational_rpc_service_role_fix_state where state_key = 'appointment_b');
  v_appointment_c uuid := (select value_uuid from pg_temp._operational_rpc_service_role_fix_state where state_key = 'appointment_c');
  v_definition text;
  v_exec record;
  v_robust_pattern text := 'coalesce(nullif(pg_catalog.current_setting(''request.jwt.claim.role'', true), ''''), nullif(auth.jwt() ->> ''role'', ''''), '''')';
  v_fragile_pattern text := 'coalesce(nullif(pg_catalog.current_setting(''request.jwt.claim.role'', true), ''''), '''')';
  v_new_start_b timestamp with time zone := now() + interval '2 day 3 hour';
  v_new_end_b timestamp with time zone := now() + interval '2 day 4 hour';
  v_updated_start_b timestamp with time zone;
  v_event_count integer;
  v_completed_status_c text;
  v_completion_event_count_c integer;
begin
  begin
    perform pg_temp._operational_rpc_service_role_fix_require(
      pg_catalog.to_regprocedure('public.log_schedule_conversation_event(uuid,uuid,text,text,jsonb)') is not null
      and pg_catalog.to_regprocedure('public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)') is not null
      and pg_catalog.to_regprocedure('public.get_latest_conversation_for_lead(uuid,uuid)') is not null,
      'one or more target signatures are missing'
    );
    perform pg_temp._operational_rpc_service_role_fix_record(1, 'signatures das 3 RPCs permanecem corretas', 'PASS', 'signatures ok');
  exception when others then
    perform pg_temp._operational_rpc_service_role_fix_record(1, 'signatures das 3 RPCs permanecem corretas', 'FAIL', sqlerrm);
  end;

  begin
    perform pg_temp._operational_rpc_service_role_fix_require(
      exists (
        select 1
        from pg_catalog.pg_proc proc_row
        where proc_row.oid = 'public.log_schedule_conversation_event(uuid,uuid,text,text,jsonb)'::pg_catalog.regprocedure
          and proc_row.prosecdef
          and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
          and proc_row.proconfig @> array['search_path=pg_catalog, public, pg_temp']::text[]
      )
      and exists (
        select 1
        from pg_catalog.pg_proc proc_row
        where proc_row.oid = 'public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)'::pg_catalog.regprocedure
          and proc_row.prosecdef
          and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
          and proc_row.proconfig @> array['search_path=pg_catalog, public, pg_temp']::text[]
      )
      and exists (
        select 1
        from pg_catalog.pg_proc proc_row
        where proc_row.oid = 'public.get_latest_conversation_for_lead(uuid,uuid)'::pg_catalog.regprocedure
          and proc_row.prosecdef
          and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
          and proc_row.proconfig @> array['search_path=pg_catalog, public, pg_temp']::text[]
      ),
      'security definer, owner or search_path diverged'
    );
    perform pg_temp._operational_rpc_service_role_fix_record(2, 'SECURITY DEFINER, owner postgres e search_path endurecido permanecem intactos', 'PASS', 'security/owner/search_path ok');
  exception when others then
    perform pg_temp._operational_rpc_service_role_fix_record(2, 'SECURITY DEFINER, owner postgres e search_path endurecido permanecem intactos', 'FAIL', sqlerrm);
  end;

  begin
    select * into v_exec
    from pg_temp._operational_rpc_service_role_fix_exec(
      'authenticated',
      v_user_inactive,
      'authenticated',
      'authenticated',
      format(
        $sql$
          select public.get_latest_conversation_for_lead(
            p_organization_id => %L::uuid,
            p_lead_id => %L::uuid
          )
        $sql$,
        v_org_a,
        v_lead_a
      )
    );

    perform pg_temp._operational_rpc_service_role_fix_require(
      v_exec.operation_succeeded is false and v_exec.returned_sqlstate = '42501',
      format(
        'authenticated without active membership did not remain blocked (succeeded=%s, sqlstate=%s, message=%s)',
        coalesce(v_exec.operation_succeeded::text, '<null>'),
        coalesce(v_exec.returned_sqlstate, '<null>'),
        coalesce(v_exec.message_text, '<null>')
      )
    );
    perform pg_temp._operational_rpc_service_role_fix_record(3, 'authenticated sem membership ativa continua bloqueado', 'PASS', '42501 preservado');
  exception when others then
    perform pg_temp._operational_rpc_service_role_fix_record(3, 'authenticated sem membership ativa continua bloqueado', 'FAIL', sqlerrm);
  end;

  begin
    select * into v_exec
    from pg_temp._operational_rpc_service_role_fix_exec(
      'authenticated',
      v_user_a,
      'authenticated',
      'authenticated',
      format(
        $sql$
          select count(*)::text
          from public.complete_store_appointment_with_outcome(
            p_appointment_id => %L::uuid,
            p_organization_id => %L::uuid,
            p_store_id => %L::uuid,
            p_completion_outcome => 'needs_followup',
            p_completion_note => 'runner'
          )
        $sql$,
        v_appointment_a,
        v_org_a,
        v_store_a
      )
    );

    perform pg_temp._operational_rpc_service_role_fix_require(
      v_exec.operation_succeeded,
      format(
        'authenticated own-tenant execution failed (succeeded=%s, sqlstate=%s, message=%s)',
        coalesce(v_exec.operation_succeeded::text, '<null>'),
        coalesce(v_exec.returned_sqlstate, '<null>'),
        coalesce(v_exec.message_text, '<null>')
      )
    );
    perform pg_temp._operational_rpc_service_role_fix_record(4, 'authenticated com membership correta continua autorizado', 'PASS', 'authenticated own tenant ok');
  exception when others then
    perform pg_temp._operational_rpc_service_role_fix_record(4, 'authenticated com membership correta continua autorizado', 'FAIL', sqlerrm);
  end;

  begin
    select * into v_exec
    from pg_temp._operational_rpc_service_role_fix_exec(
      'authenticated',
      v_user_a,
      'authenticated',
      'authenticated',
      format(
        $sql$
          select public.log_schedule_conversation_event(
            p_organization_id => %L::uuid,
            p_conversation_id => %L::uuid,
            p_event_type => 'compromisso_remarcado',
            p_created_by => 'runner',
            p_payload => '{}'::jsonb
          )
        $sql$,
        v_org_b,
        v_conversation_b
      )
    );

    perform pg_temp._operational_rpc_service_role_fix_require(
      v_exec.operation_succeeded is false and v_exec.returned_sqlstate = '42501',
      format(
        'cross-tenant execution did not remain fail-closed (succeeded=%s, sqlstate=%s, message=%s)',
        coalesce(v_exec.operation_succeeded::text, '<null>'),
        coalesce(v_exec.returned_sqlstate, '<null>'),
        coalesce(v_exec.message_text, '<null>')
      )
    );
    perform pg_temp._operational_rpc_service_role_fix_record(5, 'cross-tenant continua fail-closed', 'PASS', 'cross tenant 42501 ok');
  exception when others then
    perform pg_temp._operational_rpc_service_role_fix_record(5, 'cross-tenant continua fail-closed', 'FAIL', sqlerrm);
  end;

  begin
    select * into v_exec
    from pg_temp._operational_rpc_service_role_fix_exec(
      'anon',
      null,
      'anon',
      'anon',
      format(
        $sql$
          select public.get_latest_conversation_for_lead(
            p_organization_id => %L::uuid,
            p_lead_id => %L::uuid
          )
        $sql$,
        v_org_a,
        v_lead_a
      )
    );

    perform pg_temp._operational_rpc_service_role_fix_require(
      v_exec.operation_succeeded is false and v_exec.returned_sqlstate = '42501',
      format(
        'anon access check failed (succeeded=%s, sqlstate=%s, message=%s)',
        coalesce(v_exec.operation_succeeded::text, '<null>'),
        coalesce(v_exec.returned_sqlstate, '<null>'),
        coalesce(v_exec.message_text, '<null>')
      )
    );
    perform pg_temp._operational_rpc_service_role_fix_record(6, 'anon continua sem bypass', 'PASS', coalesce(v_exec.returned_sqlstate, 'execution blocked'));
  exception when others then
    perform pg_temp._operational_rpc_service_role_fix_record(6, 'anon continua sem bypass', 'FAIL', sqlerrm);
  end;

  begin
    select * into v_exec
    from pg_temp._operational_rpc_service_role_fix_exec(
      'service_role',
      null,
      'service_role',
      'service_role',
      format(
        $sql$
          select public.log_schedule_conversation_event(
            p_organization_id => %L::uuid,
            p_conversation_id => %L::uuid,
            p_event_type => 'compromisso_remarcado',
            p_created_by => 'runner',
            p_payload => '{}'::jsonb
          )
        $sql$,
        v_org_a,
        v_conversation_a
      )
    );

    perform pg_temp._operational_rpc_service_role_fix_require(
      v_exec.operation_succeeded,
      format(
        'service_role legacy request.jwt.claim.role path failed (succeeded=%s, sqlstate=%s, message=%s)',
        coalesce(v_exec.operation_succeeded::text, '<null>'),
        coalesce(v_exec.returned_sqlstate, '<null>'),
        coalesce(v_exec.message_text, '<null>')
      )
    );
    perform pg_temp._operational_rpc_service_role_fix_record(7, 'service_role reconhecido por request.jwt.claim.role continua autorizado', 'PASS', 'legacy path ok');
  exception when others then
    perform pg_temp._operational_rpc_service_role_fix_record(7, 'service_role reconhecido por request.jwt.claim.role continua autorizado', 'FAIL', sqlerrm);
  end;

  begin
    select * into v_exec
    from pg_temp._operational_rpc_service_role_fix_exec(
      'service_role',
      null,
      '',
      'service_role',
      format(
        $sql$
          select public.get_latest_conversation_for_lead(
            p_organization_id => %L::uuid,
            p_lead_id => %L::uuid
          )
        $sql$,
        v_org_a,
        v_lead_a
      )
    );

    perform pg_temp._operational_rpc_service_role_fix_require(
      v_exec.operation_succeeded,
      format(
        'service_role auth.jwt fallback path failed (succeeded=%s, sqlstate=%s, message=%s)',
        coalesce(v_exec.operation_succeeded::text, '<null>'),
        coalesce(v_exec.returned_sqlstate, '<null>'),
        coalesce(v_exec.message_text, '<null>')
      )
    );
    perform pg_temp._operational_rpc_service_role_fix_record(8, 'service_role reconhecido pelo fallback auth.jwt tambem continua autorizado', 'PASS', 'fallback path ok');
  exception when others then
    perform pg_temp._operational_rpc_service_role_fix_record(8, 'service_role reconhecido pelo fallback auth.jwt tambem continua autorizado', 'FAIL', sqlerrm);
  end;

  begin
    select * into v_exec
    from pg_temp._operational_rpc_service_role_fix_exec(
      'service_role',
      null,
      '',
      '',
      format(
        $sql$
          select public.log_schedule_conversation_event(
            p_organization_id => %L::uuid,
            p_conversation_id => %L::uuid,
            p_event_type => 'compromisso_remarcado',
            p_created_by => 'runner',
            p_payload => '{}'::jsonb
          )
        $sql$,
        v_org_a,
        v_conversation_a
      )
    );

    perform pg_temp._operational_rpc_service_role_fix_require(
      v_exec.operation_succeeded is false and v_exec.returned_sqlstate = '42501',
      format(
        'absence of both role sources check failed (succeeded=%s, sqlstate=%s, message=%s)',
        coalesce(v_exec.operation_succeeded::text, '<null>'),
        coalesce(v_exec.returned_sqlstate, '<null>'),
        coalesce(v_exec.message_text, '<null>')
      )
    );
    perform pg_temp._operational_rpc_service_role_fix_record(9, 'ausencia de request.jwt.claim.role e auth.jwt nao vira bypass', 'PASS', 'missing role sources still blocked');
  exception when others then
    perform pg_temp._operational_rpc_service_role_fix_record(9, 'ausencia de request.jwt.claim.role e auth.jwt nao vira bypass', 'FAIL', sqlerrm);
  end;

  begin
    select pg_catalog.pg_get_functiondef('public.log_schedule_conversation_event(uuid,uuid,text,text,jsonb)'::pg_catalog.regprocedure)
    into v_definition;
    perform pg_temp._operational_rpc_service_role_fix_require(
      position(v_robust_pattern in v_definition) > 0,
      'log_schedule_conversation_event missing hardened resolver'
    );

    select pg_catalog.pg_get_functiondef('public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)'::pg_catalog.regprocedure)
    into v_definition;
    perform pg_temp._operational_rpc_service_role_fix_require(
      position(v_robust_pattern in v_definition) > 0,
      'complete_store_appointment_with_outcome missing hardened resolver'
    );

    select pg_catalog.pg_get_functiondef('public.get_latest_conversation_for_lead(uuid,uuid)'::pg_catalog.regprocedure)
    into v_definition;
    perform pg_temp._operational_rpc_service_role_fix_require(
      position(v_robust_pattern in v_definition) > 0,
      'get_latest_conversation_for_lead missing hardened resolver'
    );

    perform pg_temp._operational_rpc_service_role_fix_record(10, 'o guard robusto esta presente nas 3 RPCs corrigidas', 'PASS', 'hardened resolver present in all targets');
  exception when others then
    perform pg_temp._operational_rpc_service_role_fix_record(10, 'o guard robusto esta presente nas 3 RPCs corrigidas', 'FAIL', sqlerrm);
  end;

  begin
    select pg_catalog.pg_get_functiondef('public.log_schedule_conversation_event(uuid,uuid,text,text,jsonb)'::pg_catalog.regprocedure)
    into v_definition;
    perform pg_temp._operational_rpc_service_role_fix_require(
      position(v_fragile_pattern in v_definition) = 0,
      'log_schedule_conversation_event still contains fragile resolver'
    );

    select pg_catalog.pg_get_functiondef('public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)'::pg_catalog.regprocedure)
    into v_definition;
    perform pg_temp._operational_rpc_service_role_fix_require(
      position(v_fragile_pattern in v_definition) = 0,
      'complete_store_appointment_with_outcome still contains fragile resolver'
    );

    select pg_catalog.pg_get_functiondef('public.get_latest_conversation_for_lead(uuid,uuid)'::pg_catalog.regprocedure)
    into v_definition;
    perform pg_temp._operational_rpc_service_role_fix_require(
      position(v_fragile_pattern in v_definition) = 0,
      'get_latest_conversation_for_lead still contains fragile resolver'
    );

    perform pg_temp._operational_rpc_service_role_fix_record(11, 'o padrao fragil isolado nao permanece nas 3 RPCs corrigidas', 'PASS', 'fragile fragment removed from all targets');
  exception when others then
    perform pg_temp._operational_rpc_service_role_fix_record(11, 'o padrao fragil isolado nao permanece nas 3 RPCs corrigidas', 'FAIL', sqlerrm);
  end;

  begin
    perform pg_temp._operational_rpc_service_role_fix_require(
      has_function_privilege('authenticated', 'public.log_schedule_conversation_event(uuid,uuid,text,text,jsonb)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.log_schedule_conversation_event(uuid,uuid,text,text,jsonb)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.log_schedule_conversation_event(uuid,uuid,text,text,jsonb)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.get_latest_conversation_for_lead(uuid,uuid)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.get_latest_conversation_for_lead(uuid,uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.get_latest_conversation_for_lead(uuid,uuid)', 'EXECUTE'),
      'one or more grants diverged'
    );
    perform pg_temp._operational_rpc_service_role_fix_record(12, 'grants nao foram ampliados', 'PASS', 'ACL relevant grants unchanged');
  exception when others then
    perform pg_temp._operational_rpc_service_role_fix_record(12, 'grants nao foram ampliados', 'FAIL', sqlerrm);
  end;

  begin
    select * into v_exec
    from pg_temp._operational_rpc_service_role_fix_exec(
      'service_role',
      null,
      '',
      'service_role',
      format(
        $sql$
          select count(*)::text
          from public.complete_store_appointment_with_outcome(
            p_appointment_id => %L::uuid,
            p_organization_id => %L::uuid,
            p_store_id => %L::uuid,
            p_completion_outcome => 'fully_completed',
            p_completion_note => 'runner-service-role-fallback'
          )
        $sql$,
        v_appointment_c,
        v_org_a,
        v_store_a
      )
    );

    perform pg_temp._operational_rpc_service_role_fix_require(
      v_exec.operation_succeeded,
      format(
        'service_role fallback complete_store_appointment_with_outcome path failed (succeeded=%s, sqlstate=%s, message=%s)',
        coalesce(v_exec.operation_succeeded::text, '<null>'),
        coalesce(v_exec.returned_sqlstate, '<null>'),
        coalesce(v_exec.message_text, '<null>')
      )
    );

    select appointment_row.status
    into v_completed_status_c
    from public.store_appointments appointment_row
    where appointment_row.id = v_appointment_c
      and appointment_row.organization_id = v_org_a
      and appointment_row.store_id = v_store_a;

    perform pg_temp._operational_rpc_service_role_fix_require(
      v_completed_status_c = 'completed',
      format('appointment_c was not completed; status=%s', coalesce(v_completed_status_c, '<null>'))
    );

    select count(*)
    into v_completion_event_count_c
    from public.conversation_events event_row
    where event_row.organization_id = v_org_a
      and event_row.conversation_id = v_conversation_a
      and event_row.event_type = 'compromisso_concluido'
      and event_row.payload ->> 'appointment_id' = v_appointment_c::text;

    perform pg_temp._operational_rpc_service_role_fix_require(
      v_completion_event_count_c = 1,
      format(
        'expected exactly 1 compromisso_concluido event for appointment_c, found %s',
        v_completion_event_count_c
      )
    );

    perform pg_temp._operational_rpc_service_role_fix_record(
      13,
      'conclusao system via fallback auth.jwt percorre complete + logger com sucesso',
      'PASS',
      'appointment_c completed and exactly one compromisso_concluido event created'
    );
  exception when others then
    perform pg_temp._operational_rpc_service_role_fix_record(
      13,
      'conclusao system via fallback auth.jwt percorre complete + logger com sucesso',
      'FAIL',
      sqlerrm
    );
  end;

  begin
    select * into v_exec
    from pg_temp._operational_rpc_service_role_fix_exec(
      'service_role',
      null,
      '',
      'service_role',
      format(
        $sql$
          select count(*)::text
          from public.update_store_appointment(
            p_appointment_id => %L::uuid,
            p_organization_id => %L::uuid,
            p_store_id => %L::uuid,
            p_title => %L,
            p_appointment_type => 'technical_visit',
            p_status => 'rescheduled',
            p_scheduled_start => %L::timestamptz,
            p_scheduled_end => %L::timestamptz,
            p_customer_name => %L,
            p_customer_phone => %L,
            p_address_text => %L,
            p_notes => %L
          )
        $sql$,
        v_appointment_b,
        v_org_b,
        v_store_b,
        'Role Fix Appointment B Remarcado',
        v_new_start_b,
        v_new_end_b,
        'Cliente B',
        '5511990000002',
        'Rua B',
        'runner-rescheduled'
      )
    );

    perform pg_temp._operational_rpc_service_role_fix_require(
      v_exec.operation_succeeded,
      format(
        'service_role fallback update_store_appointment path failed (succeeded=%s, sqlstate=%s, message=%s)',
        coalesce(v_exec.operation_succeeded::text, '<null>'),
        coalesce(v_exec.returned_sqlstate, '<null>'),
        coalesce(v_exec.message_text, '<null>')
      )
    );

    select appointment_row.scheduled_start
    into v_updated_start_b
    from public.store_appointments appointment_row
    where appointment_row.id = v_appointment_b;

    perform pg_temp._operational_rpc_service_role_fix_require(
      v_updated_start_b = v_new_start_b,
      'appointment_b was not updated to the new schedule'
    );

    select count(*)
    into v_event_count
    from public.conversation_events event_row
    where event_row.organization_id = v_org_b
      and event_row.conversation_id = v_conversation_b
      and event_row.event_type = 'compromisso_remarcado'
      and event_row.payload ->> 'appointment_id' = v_appointment_b::text;

    perform pg_temp._operational_rpc_service_role_fix_require(
      v_event_count = 1,
      format('expected exactly 1 compromisso_remarcado event for appointment_b, found %s', v_event_count)
    );

    perform pg_temp._operational_rpc_service_role_fix_record(14, 'remarcacao system via fallback auth.jwt percorre update + logger com sucesso', 'PASS', 'appointment_b updated and exactly one compromisso_remarcado event created');
  exception when others then
    perform pg_temp._operational_rpc_service_role_fix_record(14, 'remarcacao system via fallback auth.jwt percorre update + logger com sucesso', 'FAIL', sqlerrm);
  end;
end;
$checks$;

table pg_temp._operational_rpc_service_role_fix_results
order by scenario_number;

do $gate$
declare
  v_total integer;
  v_non_pass integer;
  v_non_pass_details text;
begin
  select count(*) into v_total
  from pg_temp._operational_rpc_service_role_fix_results;

  if v_total <> 14 then
    raise exception using
      errcode = 'P0001',
      message = format('manual check failed: expected 14 scenarios but found %s', v_total);
  end if;

  select count(*) into v_non_pass
  from pg_temp._operational_rpc_service_role_fix_results
  where status <> 'PASS';

  select string_agg(
           format(
             '#%s [%s] %s - %s',
             scenario_number,
             status,
             scenario_name,
             details
           ),
           E'\n'
           order by scenario_number
         )
  into v_non_pass_details
  from pg_temp._operational_rpc_service_role_fix_results
  where status <> 'PASS';

  if v_non_pass <> 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'manual check failed: %s scenario(s) did not pass:%s%s',
        v_non_pass,
        E'\n',
        coalesce(v_non_pass_details, '<no scenario details>')
      );
  end if;
end;
$gate$;

rollback;
