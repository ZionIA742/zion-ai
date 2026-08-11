begin;

create temp table pg_temp._p18_privileged_matrix (
  scenario_number integer primary key,
  scenario_name text not null
);

insert into pg_temp._p18_privileged_matrix (scenario_number, scenario_name)
values
  (1, 'catalog and execute ACL for get_org_access_status'),
  (2, 'catalog and execute ACL for onboarding_get_store_onboarding_scoped'),
  (3, 'active membership can call get_org_access_status'),
  (4, 'inactive membership is blocked by get_org_access_status'),
  (5, 'active membership can call onboarding_get_store_onboarding_scoped'),
  (6, 'inactive membership is blocked by onboarding_get_store_onboarding_scoped'),
  (7, 'schedule_post_appointment_followups keeps the server-only table contract'),
  (8, 'anon direct table access is blocked'),
  (9, 'authenticated direct table access is blocked even with active membership'),
  (10, 'enqueue_post_appointment_followups execute ACL is server-only'),
  (11, 'service_role keeps the legitimate followup flow'),
  (12, 'cross-tenant and browser-side fail-closed behavior stays intact');

create temp table pg_temp._p18_privileged_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  details text not null
);

create temp table pg_temp._p18_privileged_state (
  state_key text primary key,
  value_uuid uuid null,
  value_text text null
) on commit drop;

create or replace function pg_temp._p18_privileged_record(
  p_scenario_number integer,
  p_status text,
  p_details text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p18_privileged_results (
    scenario_number,
    scenario_name,
    status,
    details
  )
  values (
    p_scenario_number,
    (
      select matrix_row.scenario_name
      from pg_temp._p18_privileged_matrix matrix_row
      where matrix_row.scenario_number = p_scenario_number
    ),
    p_status,
    p_details
  )
  on conflict (scenario_number) do update
  set status = excluded.status,
      details = excluded.details;
end;
$function$;

create or replace function pg_temp._p18_privileged_require(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $function$
begin
  if coalesce(p_condition, false) is not true then
    raise exception using
      errcode = 'P0001',
      message = 'HARNESS_ERROR: ' || p_message;
  end if;
end;
$function$;

create or replace function pg_temp._p18_privileged_sut_fail(
  p_message text
)
returns void
language plpgsql
as $function$
begin
  raise exception using
    errcode = 'P0001',
    message = 'SUT_FAIL: ' || p_message;
end;
$function$;

create or replace function pg_temp._p18_privileged_harness_fail(
  p_message text
)
returns void
language plpgsql
as $function$
begin
  raise exception using
    errcode = 'P0001',
    message = 'HARNESS_ERROR: ' || p_message;
end;
$function$;

create or replace function pg_temp._p18_privileged_record_exception(
  p_scenario_number integer,
  p_error_message text
)
returns void
language plpgsql
as $function$
declare
  v_status text;
  v_details text;
begin
  if p_error_message like 'SUT_FAIL: %' then
    v_status := 'SUT_FAIL';
    v_details := substring(p_error_message from 11);
  elsif p_error_message like 'HARNESS_ERROR: %' then
    v_status := 'HARNESS_ERROR';
    v_details := substring(p_error_message from 16);
  else
    v_status := 'HARNESS_ERROR';
    v_details := p_error_message;
  end if;

  perform pg_temp._p18_privileged_record(
    p_scenario_number,
    v_status,
    coalesce(v_details, '<null>')
  );
end;
$function$;

create or replace function pg_temp._p18_privileged_set_auth(
  p_role text,
  p_user_id uuid default null
)
returns void
language plpgsql
as $function$
begin
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform pg_catalog.set_config('request.jwt.claim.role', coalesce(p_role, ''), true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    case
      when p_role is null or p_role = '' then ''
      else json_build_object('sub', coalesce(p_user_id::text, ''), 'role', p_role)::text
    end,
    true
  );

  if p_role = 'authenticated' then
    execute 'set local role authenticated';
  elsif p_role = 'service_role' then
    execute 'set local role service_role';
  elsif p_role = 'anon' then
    execute 'set local role anon';
  end if;
end;
$function$;

create or replace function pg_temp._p18_privileged_reset_auth()
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

create or replace function pg_temp._p18_privileged_exec_value(
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
begin
  perform pg_temp._p18_privileged_set_auth(p_role, p_user_id);

  begin
    execute p_sql into v_value;
    perform pg_temp._p18_privileged_reset_auth();
    return query select true, v_value, null::text, null::text;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;
      perform pg_temp._p18_privileged_reset_auth();
      return query select false, null::text, v_state, v_message;
  end;
end;
$function$;

create or replace function pg_temp._p18_privileged_exec_statement(
  p_role text,
  p_user_id uuid,
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
  perform pg_temp._p18_privileged_set_auth(p_role, p_user_id);

  begin
    execute p_sql;
    perform pg_temp._p18_privileged_reset_auth();
    return query select true, null::text, null::text;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;
      perform pg_temp._p18_privileged_reset_auth();
      return query select false, v_state, v_message;
  end;
end;
$function$;

create or replace function pg_temp._p18_privileged_assert_success(
  p_role text,
  p_user_id uuid,
  p_sql text,
  p_expected_value text default null
)
returns void
language plpgsql
as $function$
declare
  v_exec record;
begin
  select * into v_exec
  from pg_temp._p18_privileged_exec_value(p_role, p_user_id, p_sql);

  if not coalesce(v_exec.operation_succeeded, false) then
    perform pg_temp._p18_privileged_sut_fail(
      format(
        'expected success but got sqlstate=%s message=%s sql=%s',
        coalesce(v_exec.returned_sqlstate, '<null>'),
        coalesce(v_exec.message_text, '<null>'),
        p_sql
      )
    );
  end if;

  if p_expected_value is not null and v_exec.value_text is distinct from p_expected_value then
    perform pg_temp._p18_privileged_sut_fail(
      format(
        'unexpected value expected=%s actual=%s sql=%s',
        p_expected_value,
        coalesce(v_exec.value_text, '<null>'),
        p_sql
      )
    );
  end if;
end;
$function$;

create or replace function pg_temp._p18_privileged_assert_failure(
  p_role text,
  p_user_id uuid,
  p_sql text,
  p_expected_sqlstate text,
  p_expected_message text default null
)
returns void
language plpgsql
as $function$
declare
  v_exec record;
begin
  select * into v_exec
  from pg_temp._p18_privileged_exec_value(p_role, p_user_id, p_sql);

  if coalesce(v_exec.operation_succeeded, false) then
    perform pg_temp._p18_privileged_sut_fail(
      format('expected failure but succeeded sql=%s', p_sql)
    );
  end if;

  if v_exec.returned_sqlstate is distinct from p_expected_sqlstate then
    perform pg_temp._p18_privileged_sut_fail(
      format(
        'unexpected failure sqlstate expected=%s actual=%s sql=%s message=%s',
        p_expected_sqlstate,
        coalesce(v_exec.returned_sqlstate, '<null>'),
        p_sql,
        coalesce(v_exec.message_text, '<null>')
      )
    );
  end if;

  if p_expected_message is not null and v_exec.message_text is distinct from p_expected_message then
    perform pg_temp._p18_privileged_sut_fail(
      format(
        'unexpected failure message expected=%s actual=%s sql=%s',
        p_expected_message,
        coalesce(v_exec.message_text, '<null>'),
        p_sql
      )
    );
  end if;
end;
$function$;

create or replace function pg_temp._p18_privileged_assert_statement_failure(
  p_role text,
  p_user_id uuid,
  p_sql text,
  p_expected_sqlstate text
)
returns void
language plpgsql
as $function$
declare
  v_exec record;
begin
  select * into v_exec
  from pg_temp._p18_privileged_exec_statement(p_role, p_user_id, p_sql);

  if coalesce(v_exec.operation_succeeded, false) then
    perform pg_temp._p18_privileged_sut_fail(
      format('expected statement failure but succeeded sql=%s', p_sql)
    );
  end if;

  if v_exec.returned_sqlstate is distinct from p_expected_sqlstate then
    perform pg_temp._p18_privileged_sut_fail(
      format(
        'unexpected statement failure sqlstate expected=%s actual=%s sql=%s message=%s',
        p_expected_sqlstate,
        coalesce(v_exec.returned_sqlstate, '<null>'),
        p_sql,
        coalesce(v_exec.message_text, '<null>')
      )
    );
  end if;
end;
$function$;

create or replace function pg_temp._p18_privileged_assert_statement_success(
  p_role text,
  p_user_id uuid,
  p_sql text
)
returns void
language plpgsql
as $function$
declare
  v_exec record;
begin
  select * into v_exec
  from pg_temp._p18_privileged_exec_statement(p_role, p_user_id, p_sql);

  if not coalesce(v_exec.operation_succeeded, false) then
    perform pg_temp._p18_privileged_sut_fail(
      format(
        'expected statement success but got sqlstate=%s message=%s sql=%s',
        coalesce(v_exec.returned_sqlstate, '<null>'),
        coalesce(v_exec.message_text, '<null>'),
        p_sql
      )
    );
  end if;
end;
$function$;

create or replace function pg_temp._p18_privileged_state_put_uuid(
  p_state_key text,
  p_value uuid
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p18_privileged_state (state_key, value_uuid, value_text)
  values (p_state_key, p_value, null)
  on conflict (state_key) do update
  set value_uuid = excluded.value_uuid,
      value_text = excluded.value_text;
end;
$function$;

create or replace function pg_temp._p18_privileged_state_get_uuid(
  p_state_key text
)
returns uuid
language plpgsql
as $function$
declare
  v_value uuid;
begin
  select state_row.value_uuid
  into v_value
  from pg_temp._p18_privileged_state state_row
  where state_row.state_key = p_state_key;

  if v_value is null then
    perform pg_temp._p18_privileged_harness_fail(
      format('missing uuid state for key %s', p_state_key)
    );
  end if;

  return v_value;
end;
$function$;

do $setup$
declare
  v_run_token text := 'p18_privileged_' || replace(gen_random_uuid()::text, '-', '');
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_store_a uuid := gen_random_uuid();
  v_store_b uuid := gen_random_uuid();
  v_user_active uuid := gen_random_uuid();
  v_user_inactive uuid := gen_random_uuid();
  v_user_foreign uuid := gen_random_uuid();
  v_lead_a uuid := gen_random_uuid();
  v_conversation_a uuid := gen_random_uuid();
  v_appointment_a uuid := gen_random_uuid();
begin
  perform pg_temp._p18_privileged_require(
    pg_catalog.to_regclass('public.schedule_post_appointment_followups') is not null,
    'setup failed: public.schedule_post_appointment_followups is missing'
  );
  perform pg_temp._p18_privileged_require(
    pg_catalog.to_regprocedure('public.enqueue_post_appointment_followups(uuid,uuid,timestamptz)') is not null,
    'setup failed: public.enqueue_post_appointment_followups(uuid,uuid,timestamptz) is missing'
  );
  perform pg_temp._p18_privileged_require(
    pg_catalog.to_regclass('public.subscriptions') is not null,
    'setup failed: public.subscriptions is missing'
  );
  perform pg_temp._p18_privileged_require(
    pg_catalog.to_regclass('public.store_onboarding') is not null,
    'setup failed: public.store_onboarding is missing'
  );

  insert into public.organizations (id, name)
  values
    (v_org_a, 'P18 Privileged Org A ' || v_run_token),
    (v_org_b, 'P18 Privileged Org B ' || v_run_token);

  insert into public.stores (id, organization_id, name)
  values
    (v_store_a, v_org_a, 'P18 Privileged Store A ' || v_run_token),
    (v_store_b, v_org_b, 'P18 Privileged Store B ' || v_run_token);

  insert into auth.users (id)
  values
    (v_user_active),
    (v_user_inactive),
    (v_user_foreign);

  insert into public.memberships (organization_id, user_id, role, is_active)
  values
    (v_org_a, v_user_active, 'owner'::public.app_role, true),
    (v_org_a, v_user_inactive, 'owner'::public.app_role, false),
    (v_org_b, v_user_foreign, 'owner'::public.app_role, true);

  insert into public.subscriptions (
    organization_id,
    plan_code,
    status,
    current_period_start,
    current_period_end,
    past_due_since,
    grace_until,
    suspended_at,
    canceled_at,
    token_limit_mensal,
    token_consumido_atual,
    alert_at_percent,
    econ_mode_at_percent
  )
  values
    (
      v_org_a,
      'p18_privileged_plan_a',
      'active',
      now() - interval '15 day',
      now() + interval '15 day',
      null,
      null,
      null,
      null,
      1000000,
      0,
      80,
      95
    ),
    (
      v_org_b,
      'p18_privileged_plan_b',
      'active',
      now() - interval '15 day',
      now() + interval '15 day',
      null,
      null,
      null,
      null,
      1000000,
      0,
      80,
      95
    );

  insert into public.leads (
    id,
    organization_id,
    store_id,
    state,
    created_at,
    updated_at
  )
  values (
    v_lead_a,
    v_org_a,
    v_store_a,
    'negociacao',
    now(),
    now()
  );

  insert into public.conversations (
    id,
    organization_id,
    lead_id,
    status,
    is_human_active,
    created_at
  )
  values (
    v_conversation_a,
    v_org_a,
    v_lead_a,
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
  values (
    v_appointment_a,
    v_org_a,
    v_store_a,
    'P18 Privileged Appointment ' || v_run_token,
    'technical_visit',
    'scheduled',
    now() - interval '2 day 1 hour',
    now() - interval '2 day',
    'P18 Customer A',
    null,
    'Rua P18 A',
    'fixture',
    v_lead_a,
    v_conversation_a
  );

  perform pg_temp._p18_privileged_state_put_uuid('org_a', v_org_a);
  perform pg_temp._p18_privileged_state_put_uuid('org_b', v_org_b);
  perform pg_temp._p18_privileged_state_put_uuid('store_a', v_store_a);
  perform pg_temp._p18_privileged_state_put_uuid('store_b', v_store_b);
  perform pg_temp._p18_privileged_state_put_uuid('user_active', v_user_active);
  perform pg_temp._p18_privileged_state_put_uuid('user_inactive', v_user_inactive);
  perform pg_temp._p18_privileged_state_put_uuid('user_foreign', v_user_foreign);
  perform pg_temp._p18_privileged_state_put_uuid('appointment_a', v_appointment_a);
exception
  when others then
    perform pg_temp._p18_privileged_record(12, 'HARNESS_ERROR', 'setup failed: ' || sqlerrm);
end;
$setup$;

do $scenario_1$
declare
  v_function_oid oid := pg_catalog.to_regprocedure('public.get_org_access_status(uuid)');
  v_public_execute integer;
begin
  perform pg_temp._p18_privileged_require(v_function_oid is not null, 'get_org_access_status oid missing');

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_function_oid
      and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
      and proc_row.prosecdef
      and proc_row.proconfig @> array['search_path=pg_catalog, public, pg_temp']
      and proc_row.proconfig @> array['row_security=off']
  ) then
    perform pg_temp._p18_privileged_sut_fail('public.get_org_access_status(uuid) contract mismatch');
  end if;

  select count(*)
  into v_public_execute
  from pg_catalog.pg_proc proc_row
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      proc_row.proacl,
      pg_catalog.acldefault('f', proc_row.proowner)
    )
  ) acl_row
  where proc_row.oid = v_function_oid
    and acl_row.grantee = 0
    and acl_row.privilege_type = 'EXECUTE';

  if v_public_execute <> 0
     or pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_function_oid, 'EXECUTE') then
    perform pg_temp._p18_privileged_sut_fail('public.get_org_access_status(uuid) execute grants mismatch');
  end if;

  perform pg_temp._p18_privileged_record(1, 'PASS', 'get_org_access_status stays SECURITY DEFINER owned by postgres, keeps search_path/row_security off, and only authenticated/service_role keep EXECUTE');
exception
  when others then
    perform pg_temp._p18_privileged_record_exception(1, sqlerrm);
end;
$scenario_1$;

do $scenario_2$
declare
  v_function_oid oid := pg_catalog.to_regprocedure('public.onboarding_get_store_onboarding_scoped(uuid,uuid)');
  v_public_execute integer;
begin
  perform pg_temp._p18_privileged_require(v_function_oid is not null, 'onboarding_get_store_onboarding_scoped oid missing');

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_function_oid
      and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
      and proc_row.prosecdef
      and proc_row.proconfig @> array['search_path=pg_catalog, public, pg_temp']
      and proc_row.proconfig @> array['row_security=off']
  ) then
    perform pg_temp._p18_privileged_sut_fail('public.onboarding_get_store_onboarding_scoped(uuid,uuid) contract mismatch');
  end if;

  select count(*)
  into v_public_execute
  from pg_catalog.pg_proc proc_row
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      proc_row.proacl,
      pg_catalog.acldefault('f', proc_row.proowner)
    )
  ) acl_row
  where proc_row.oid = v_function_oid
    and acl_row.grantee = 0
    and acl_row.privilege_type = 'EXECUTE';

  if v_public_execute <> 0
     or pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_function_oid, 'EXECUTE') then
    perform pg_temp._p18_privileged_sut_fail('public.onboarding_get_store_onboarding_scoped(uuid,uuid) execute grants mismatch');
  end if;

  perform pg_temp._p18_privileged_record(2, 'PASS', 'onboarding_get_store_onboarding_scoped stays SECURITY DEFINER owned by postgres, keeps search_path/row_security off, and only authenticated/service_role keep EXECUTE');
exception
  when others then
    perform pg_temp._p18_privileged_record_exception(2, sqlerrm);
end;
$scenario_2$;

do $scenario_3$
declare
  v_org_a uuid := pg_temp._p18_privileged_state_get_uuid('org_a');
  v_user_active uuid := pg_temp._p18_privileged_state_get_uuid('user_active');
begin
  perform pg_temp._p18_privileged_assert_success(
    'authenticated',
    v_user_active,
    format($sql$
      select public.get_org_access_status(%L::uuid)->>'ai_mode'
    $sql$, v_org_a),
    'normal'
  );

  perform pg_temp._p18_privileged_record(3, 'PASS', 'active membership still gets a successful get_org_access_status response');
exception
  when others then
    perform pg_temp._p18_privileged_record_exception(3, sqlerrm);
end;
$scenario_3$;

do $scenario_4$
declare
  v_org_a uuid := pg_temp._p18_privileged_state_get_uuid('org_a');
  v_user_inactive uuid := pg_temp._p18_privileged_state_get_uuid('user_inactive');
begin
  perform pg_temp._p18_privileged_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      select public.get_org_access_status(%L::uuid)::text
    $sql$, v_org_a),
    '42501',
    'organization scope is not authorized'
  );

  perform pg_temp._p18_privileged_record(4, 'PASS', 'inactive membership is now fail-closed in get_org_access_status with the existing authorization error');
exception
  when others then
    perform pg_temp._p18_privileged_record_exception(4, sqlerrm);
end;
$scenario_4$;

do $scenario_5$
declare
  v_org_a uuid := pg_temp._p18_privileged_state_get_uuid('org_a');
  v_store_a uuid := pg_temp._p18_privileged_state_get_uuid('store_a');
  v_user_active uuid := pg_temp._p18_privileged_state_get_uuid('user_active');
begin
  perform pg_temp._p18_privileged_assert_success(
    'authenticated',
    v_user_active,
    format($sql$
      select (public.onboarding_get_store_onboarding_scoped(%L::uuid, %L::uuid) is null)::text
    $sql$, v_org_a, v_store_a)
  );

  perform pg_temp._p18_privileged_record(5, 'PASS', 'active membership still reaches onboarding_get_store_onboarding_scoped successfully');
exception
  when others then
    perform pg_temp._p18_privileged_record_exception(5, sqlerrm);
end;
$scenario_5$;

do $scenario_6$
declare
  v_org_a uuid := pg_temp._p18_privileged_state_get_uuid('org_a');
  v_store_a uuid := pg_temp._p18_privileged_state_get_uuid('store_a');
  v_user_inactive uuid := pg_temp._p18_privileged_state_get_uuid('user_inactive');
begin
  perform pg_temp._p18_privileged_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      select (public.onboarding_get_store_onboarding_scoped(%L::uuid, %L::uuid) is null)::text
    $sql$, v_org_a, v_store_a),
    '42501',
    'store scope is not authorized'
  );

  perform pg_temp._p18_privileged_record(6, 'PASS', 'inactive membership is now fail-closed in onboarding_get_store_onboarding_scoped with the existing authorization error');
exception
  when others then
    perform pg_temp._p18_privileged_record_exception(6, sqlerrm);
end;
$scenario_6$;

do $scenario_7$
declare
  v_rls_enabled boolean;
  v_force_rls boolean;
  v_public_acl integer;
begin
  select class_row.relrowsecurity, class_row.relforcerowsecurity
  into v_rls_enabled, v_force_rls
  from pg_catalog.pg_class class_row
  where class_row.oid = 'public.schedule_post_appointment_followups'::pg_catalog.regclass;

  select count(*)
  into v_public_acl
  from pg_catalog.pg_class class_row
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      class_row.relacl,
      pg_catalog.acldefault('r', class_row.relowner)
    )
  ) acl_row
  where class_row.oid = 'public.schedule_post_appointment_followups'::pg_catalog.regclass
    and acl_row.grantee = 0;

  if v_rls_enabled is not true
     or v_force_rls is not false
     or v_public_acl <> 0
     or pg_catalog.has_table_privilege('anon', 'public.schedule_post_appointment_followups', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'public.schedule_post_appointment_followups', 'INSERT')
     or pg_catalog.has_table_privilege('anon', 'public.schedule_post_appointment_followups', 'UPDATE')
     or pg_catalog.has_table_privilege('authenticated', 'public.schedule_post_appointment_followups', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.schedule_post_appointment_followups', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.schedule_post_appointment_followups', 'UPDATE')
     or not pg_catalog.has_table_privilege('service_role', 'public.schedule_post_appointment_followups', 'SELECT')
     or not pg_catalog.has_table_privilege('service_role', 'public.schedule_post_appointment_followups', 'INSERT')
     or not pg_catalog.has_table_privilege('service_role', 'public.schedule_post_appointment_followups', 'UPDATE') then
    perform pg_temp._p18_privileged_sut_fail('public.schedule_post_appointment_followups contract mismatch after hardening');
  end if;

  perform pg_temp._p18_privileged_record(7, 'PASS', 'schedule_post_appointment_followups keeps RLS enabled without FORCE and exposes direct table privileges only to service_role');
exception
  when others then
    perform pg_temp._p18_privileged_record_exception(7, sqlerrm);
end;
$scenario_7$;

do $scenario_8$
begin
  perform pg_temp._p18_privileged_assert_failure(
    'anon',
    null,
    'select count(*)::text from public.schedule_post_appointment_followups',
    '42501'
  );

  perform pg_temp._p18_privileged_assert_statement_failure(
    'anon',
    null,
    'insert into public.schedule_post_appointment_followups default values',
    '42501'
  );

  perform pg_temp._p18_privileged_record(8, 'PASS', 'anon cannot select from or insert into the server-only followup queue');
exception
  when others then
    perform pg_temp._p18_privileged_record_exception(8, sqlerrm);
end;
$scenario_8$;

do $scenario_9$
declare
  v_user_active uuid := pg_temp._p18_privileged_state_get_uuid('user_active');
begin
  perform pg_temp._p18_privileged_assert_failure(
    'authenticated',
    v_user_active,
    'select count(*)::text from public.schedule_post_appointment_followups',
    '42501'
  );

  perform pg_temp._p18_privileged_assert_statement_failure(
    'authenticated',
    v_user_active,
    'insert into public.schedule_post_appointment_followups default values',
    '42501'
  );

  perform pg_temp._p18_privileged_record(9, 'PASS', 'authenticated keeps zero direct browser-side access to the server-only followup queue');
exception
  when others then
    perform pg_temp._p18_privileged_record_exception(9, sqlerrm);
end;
$scenario_9$;

do $scenario_10$
declare
  v_function_oid oid := pg_catalog.to_regprocedure('public.enqueue_post_appointment_followups(uuid,uuid,timestamptz)');
  v_public_execute integer;
begin
  perform pg_temp._p18_privileged_require(v_function_oid is not null, 'enqueue_post_appointment_followups oid missing');

  select count(*)
  into v_public_execute
  from pg_catalog.pg_proc proc_row
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      proc_row.proacl,
      pg_catalog.acldefault('f', proc_row.proowner)
    )
  ) acl_row
  where proc_row.oid = v_function_oid
    and acl_row.grantee = 0
    and acl_row.privilege_type = 'EXECUTE';

  if v_public_execute <> 0
     or pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_function_oid, 'EXECUTE') then
    perform pg_temp._p18_privileged_sut_fail('public.enqueue_post_appointment_followups(uuid,uuid,timestamptz) execute grants mismatch');
  end if;

  perform pg_temp._p18_privileged_record(10, 'PASS', 'enqueue_post_appointment_followups is executable only by service_role and no longer by PUBLIC/anon/authenticated');
exception
  when others then
    perform pg_temp._p18_privileged_record_exception(10, sqlerrm);
end;
$scenario_10$;

do $scenario_11$
declare
  v_org_a uuid := pg_temp._p18_privileged_state_get_uuid('org_a');
  v_store_a uuid := pg_temp._p18_privileged_state_get_uuid('store_a');
  v_appointment_a uuid := pg_temp._p18_privileged_state_get_uuid('appointment_a');
begin
  perform pg_temp._p18_privileged_assert_statement_success(
    'service_role',
    null,
    format($sql$
      do $runner$
      begin
        perform public.enqueue_post_appointment_followups(
          %L::uuid,
          %L::uuid,
          now()
        );
      end
      $runner$
    $sql$, v_org_a, v_store_a)
  );

  perform pg_temp._p18_privileged_assert_success(
    'service_role',
    null,
    format($sql$
      select count(*)::text
      from public.schedule_post_appointment_followups
      where organization_id = %L::uuid
        and store_id = %L::uuid
        and appointment_id = %L::uuid
    $sql$, v_org_a, v_store_a, v_appointment_a),
    '1'
  );

  perform pg_temp._p18_privileged_assert_success(
    'service_role',
    null,
    format($sql$
      with updated_rows as (
        update public.schedule_post_appointment_followups
        set followup_status = followup_status
        where organization_id = %L::uuid
          and store_id = %L::uuid
          and appointment_id = %L::uuid
        returning id
      )
      select count(*)::text
      from updated_rows
    $sql$, v_org_a, v_store_a, v_appointment_a),
    '1'
  );

  perform pg_temp._p18_privileged_record(11, 'PASS', 'service_role still executes the enqueue RPC and keeps real select/update reachability on the followup queue row it created');
exception
  when others then
    perform pg_temp._p18_privileged_record_exception(11, sqlerrm);
end;
$scenario_11$;

do $scenario_12$
declare
  v_org_b uuid := pg_temp._p18_privileged_state_get_uuid('org_b');
  v_store_b uuid := pg_temp._p18_privileged_state_get_uuid('store_b');
  v_user_active uuid := pg_temp._p18_privileged_state_get_uuid('user_active');
begin
  perform pg_temp._p18_privileged_assert_failure(
    'authenticated',
    v_user_active,
    format($sql$
      select public.get_org_access_status(%L::uuid)::text
    $sql$, v_org_b),
    '42501',
    'organization scope is not authorized'
  );

  perform pg_temp._p18_privileged_assert_failure(
    'authenticated',
    v_user_active,
    format($sql$
      select (public.onboarding_get_store_onboarding_scoped(%L::uuid, %L::uuid) is null)::text
    $sql$, v_org_b, v_store_b),
    '42501',
    'store scope is not authorized'
  );

  perform pg_temp._p18_privileged_assert_statement_failure(
    'authenticated',
    v_user_active,
    format($sql$
      do $runner$
      begin
        perform public.enqueue_post_appointment_followups(
          %L::uuid,
          %L::uuid,
          now()
        );
      end
      $runner$
    $sql$, pg_temp._p18_privileged_state_get_uuid('org_a'), pg_temp._p18_privileged_state_get_uuid('store_a')),
    '42501'
  );

  perform pg_temp._p18_privileged_record(12, 'PASS', 'cross-tenant access stays blocked for the authenticated SECURITY DEFINER readers and the browser role still cannot execute the server-only enqueue RPC');
exception
  when others then
    perform pg_temp._p18_privileged_record_exception(12, sqlerrm);
end;
$scenario_12$;

with final_counts as (
  select
    count(*) as total_scenarios,
    count(*) filter (where status = 'PASS') as passed_scenarios,
    count(*) filter (where status = 'SUT_FAIL') as sut_failed_scenarios,
    count(*) filter (where status = 'HARNESS_ERROR') as harness_error_scenarios,
    count(*) filter (where status <> 'PASS') as failed_scenarios,
    string_agg(
      format('scenario=%s', scenario_number),
      ' || ' order by scenario_number
    ) filter (where status <> 'PASS') as failing_scenarios,
    string_agg(
      format('scenario=%s | status=%s', scenario_number, status),
      ' || ' order by scenario_number
    ) filter (where status <> 'PASS') as failing_statuses,
    string_agg(
      format('scenario=%s | status=%s | details=%s', scenario_number, status, details),
      ' || ' order by scenario_number
    ) filter (where status <> 'PASS') as failing_details
  from pg_temp._p18_privileged_results
)
select
  case
    when total_scenarios <> 12 then 'HARNESS_INCOMPLETO'
    when failed_scenarios = 0 then 'APROVADA'
    else 'AINDA_NAO_APROVADA'
  end as final_status,
  total_scenarios as total,
  count(*) as emitted,
  passed_scenarios as pass,
  failed_scenarios as fail,
  sut_failed_scenarios as sut_fail,
  harness_error_scenarios as harness_error,
  failing_scenarios,
  failing_statuses,
  failing_details
from final_counts
cross join pg_temp._p18_privileged_results
group by
  total_scenarios,
  passed_scenarios,
  failed_scenarios,
  sut_failed_scenarios,
  harness_error_scenarios,
  failing_scenarios,
  failing_statuses,
  failing_details;

rollback;
