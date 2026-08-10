begin;

create temp table pg_temp._p18_operational_matrix (
  scenario_number integer primary key,
  scenario_name text not null
);

insert into pg_temp._p18_operational_matrix (scenario_number, scenario_name)
values
  (1, 'rls ativa nas sete tabelas'),
  (2, 'contagem final de policies e tabelas server-only'),
  (3, 'nenhuma policy insegura ou grant para public anon'),
  (4, 'authenticated termina so com os grants esperados'),
  (5, 'service_role preserva acesso total nas sete tabelas'),
  (6, 'policy-base de memberships stores segue funcional no tenant proprio'),
  (7, 'crud direto de appointments respeita tenant e sem delete'),
  (8, 'crud direto de schedule_blocks respeita tenant e sem insert'),
  (9, 'crud direto de schedule_settings respeita tenant e sem delete'),
  (10, 'operational_tasks fica select-only para authenticated'),
  (11, 'server-only bloqueia acesso direto authenticated'),
  (12, 'grants execute por funcao ficam fechados para public anon'),
  (13, 'security invoker criticas seguem funcionando no proprio tenant'),
  (14, 'security definer expostas ao authenticated autorizam proprio tenant e negam foreign'),
  (15, 'funcoes server-only ficam so para service_role'),
  (16, 'fixtures sinteticas ficam isoladas na transacao e sem commit');

create temp table pg_temp._p18_operational_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  details text not null
);

create temp table pg_temp._p18_operational_state (
  state_key text primary key,
  value_uuid uuid null,
  value_text text null
) on commit drop;

create or replace function pg_temp._p18_operational_record(
  p_scenario_number integer,
  p_status text,
  p_details text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p18_operational_results (
    scenario_number,
    scenario_name,
    status,
    details
  )
  values (
    p_scenario_number,
    (
      select matrix_row.scenario_name
      from pg_temp._p18_operational_matrix matrix_row
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

create or replace function pg_temp._p18_operational_require(
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
      message = p_message;
  end if;
end;
$function$;

create or replace function pg_temp._p18_operational_set_auth(
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

create or replace function pg_temp._p18_operational_reset_auth()
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

create or replace function pg_temp._p18_operational_exec(
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
  perform pg_temp._p18_operational_set_auth(p_role, p_user_id);

  begin
    execute p_sql into v_value;
    perform pg_temp._p18_operational_reset_auth();
    return query select true, v_value, null::text, null::text;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;
      perform pg_temp._p18_operational_reset_auth();
      return query select false, null::text, v_state, v_message;
  end;
end;
$function$;

create or replace function pg_temp._p18_operational_assert_success(
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
  from pg_temp._p18_operational_exec(p_role, p_user_id, p_sql);

  if not coalesce(v_exec.operation_succeeded, false) then
    raise exception using
      errcode = 'P0001',
      message = format(
        'expected success but got sqlstate=%s message=%s sql=%s',
        coalesce(v_exec.returned_sqlstate, '<null>'),
        coalesce(v_exec.message_text, '<null>'),
        p_sql
      );
  end if;

  if p_expected_value is not null and v_exec.value_text is distinct from p_expected_value then
    raise exception using
      errcode = 'P0001',
      message = format(
        'unexpected value expected=%s actual=%s sql=%s',
        p_expected_value,
        coalesce(v_exec.value_text, '<null>'),
        p_sql
      );
  end if;
end;
$function$;

create or replace function pg_temp._p18_operational_assert_failure(
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
  from pg_temp._p18_operational_exec(p_role, p_user_id, p_sql);

  if coalesce(v_exec.operation_succeeded, false) then
    raise exception using
      errcode = 'P0001',
      message = format('expected failure but succeeded sql=%s', p_sql);
  end if;

  if v_exec.returned_sqlstate is distinct from p_expected_sqlstate then
    raise exception using
      errcode = 'P0001',
      message = format(
        'unexpected failure sqlstate expected=%s actual=%s sql=%s message=%s',
        p_expected_sqlstate,
        coalesce(v_exec.returned_sqlstate, '<null>'),
        p_sql,
        coalesce(v_exec.message_text, '<null>')
      );
  end if;
end;
$function$;

create or replace function pg_temp._p18_operational_build_assistant_primary_thread_sql(
  p_organization_id uuid,
  p_store_id uuid,
  p_lead_id uuid,
  p_conversation_id uuid
)
returns text
language plpgsql
as $function$
declare
  v_function_row record;
  v_arg_row record;
  v_arguments text[] := array[]::text[];
  v_argument_sql text;
begin
  select
    proc_row.oid,
    proc_row.pronargs,
    proc_row.proargnames,
    string_to_array(pg_catalog.oidvectortypes(proc_row.proargtypes), ', ') as arg_types
  into v_function_row
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname = 'assistant_get_or_create_primary_thread';

  if v_function_row.oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'assistant_get_or_create_primary_thread not found';
  end if;

  if v_function_row.pronargs < 1
     or v_function_row.proargnames is null
     or array_length(v_function_row.proargnames, 1) is distinct from v_function_row.pronargs
     or array_length(v_function_row.arg_types, 1) is distinct from v_function_row.pronargs then
    raise exception using
      errcode = 'P0001',
      message = 'assistant_get_or_create_primary_thread signature metadata is unavailable for safe harness execution';
  end if;

  for v_arg_row in
    select
      v_function_row.proargnames[arg_index] as arg_name,
      v_function_row.arg_types[arg_index] as arg_type
    from generate_series(1, v_function_row.pronargs) arg_index
  loop
    if v_arg_row.arg_name is null or v_arg_row.arg_name = '' then
      raise exception using
        errcode = 'P0001',
        message = 'assistant_get_or_create_primary_thread contains unnamed parameters and cannot be invoked safely by the harness';
    end if;

    if v_arg_row.arg_type = 'uuid' then
      if v_arg_row.arg_name like '%organization%' then
        v_argument_sql := format('%I => %L::uuid', v_arg_row.arg_name, p_organization_id);
      elsif v_arg_row.arg_name like '%store%' then
        v_argument_sql := format('%I => %L::uuid', v_arg_row.arg_name, p_store_id);
      elsif v_arg_row.arg_name like '%lead%' then
        v_argument_sql := format('%I => %L::uuid', v_arg_row.arg_name, p_lead_id);
      elsif v_arg_row.arg_name like '%conversation%' then
        v_argument_sql := format('%I => %L::uuid', v_arg_row.arg_name, p_conversation_id);
      elsif v_arg_row.arg_name like '%user%' then
        v_argument_sql := format('%I => null::uuid', v_arg_row.arg_name);
      else
        raise exception using
          errcode = 'P0001',
          message = format(
            'assistant_get_or_create_primary_thread has unsupported uuid parameter %s',
            v_arg_row.arg_name
          );
      end if;
    elsif v_arg_row.arg_type = 'jsonb' then
      v_argument_sql := format('%I => ''{}''::jsonb', v_arg_row.arg_name);
    elsif v_arg_row.arg_type = 'json' then
      v_argument_sql := format('%I => ''{}''::json', v_arg_row.arg_name);
    elsif v_arg_row.arg_type in ('text', 'character varying') then
      v_argument_sql := format('%I => %L', v_arg_row.arg_name, 'runner');
    elsif v_arg_row.arg_type = 'boolean' then
      v_argument_sql := format('%I => false', v_arg_row.arg_name);
    elsif v_arg_row.arg_type = 'integer' then
      v_argument_sql := format('%I => 0', v_arg_row.arg_name);
    elsif v_arg_row.arg_type = 'bigint' then
      v_argument_sql := format('%I => 0::bigint', v_arg_row.arg_name);
    elsif v_arg_row.arg_type = 'timestamp with time zone' then
      v_argument_sql := format('%I => now()', v_arg_row.arg_name);
    else
      raise exception using
        errcode = 'P0001',
        message = format(
          'assistant_get_or_create_primary_thread has unsupported parameter type %s for %s',
          v_arg_row.arg_type,
          v_arg_row.arg_name
        );
    end if;

    v_arguments := array_append(v_arguments, v_argument_sql);
  end loop;

  return 'select public.assistant_get_or_create_primary_thread('
    || array_to_string(v_arguments, ', ')
    || ')';
end;
$function$;

do $setup$
declare
  v_run_id uuid := gen_random_uuid();
  v_run_token text := 'p18_operational_' || replace(gen_random_uuid()::text, '-', '');
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_store_a uuid := gen_random_uuid();
  v_store_a_settings uuid := gen_random_uuid();
  v_store_b uuid := gen_random_uuid();
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_lead_a uuid := gen_random_uuid();
  v_lead_b uuid := gen_random_uuid();
  v_conversation_a uuid := gen_random_uuid();
  v_conversation_b uuid := gen_random_uuid();
  v_appointment_a uuid := gen_random_uuid();
  v_appointment_b uuid := gen_random_uuid();
  v_block_a uuid := gen_random_uuid();
  v_block_b uuid := gen_random_uuid();
  v_task_a uuid := gen_random_uuid();
  v_task_b uuid := gen_random_uuid();
  v_event_type_key text;
begin
  insert into public.organizations (id, name)
  values
    (v_org_a, 'P18 Operational Org A ' || v_run_token),
    (v_org_b, 'P18 Operational Org B ' || v_run_token);

  insert into public.stores (id, organization_id, name)
  values
    (v_store_a, v_org_a, 'P18 Operational Store A ' || v_run_token),
    (v_store_a_settings, v_org_a, 'P18 Operational Store A Settings ' || v_run_token),
    (v_store_b, v_org_b, 'P18 Operational Store B ' || v_run_token);

  insert into auth.users (id)
  values
    (v_user_a),
    (v_user_b);

  insert into public.memberships (organization_id, user_id, role, is_active)
  values
    (v_org_a, v_user_a, 'owner', true),
    (v_org_b, v_user_b, 'owner', true);

  insert into public.leads (id, organization_id, store_id, state, created_at, updated_at)
  values
    (v_lead_a, v_org_a, v_store_a, 'negociacao', now(), now()),
    (v_lead_b, v_org_b, v_store_b, 'negociacao', now(), now());

  insert into public.conversations (id, organization_id, lead_id, status, is_human_active, created_at)
  values
    (v_conversation_a, v_org_a, v_lead_a, 'open', false, now()),
    (v_conversation_b, v_org_b, v_lead_b, 'open', false, now());

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
      'Runner Appointment A ' || v_run_token,
      'technical_visit',
      'scheduled',
      now() + interval '1 day',
      now() + interval '1 day 1 hour',
      'Runner Customer A',
      null,
      'Rua Runner A',
      'fixture',
      v_lead_a,
      v_conversation_a
    ),
    (
      v_appointment_b,
      v_org_b,
      v_store_b,
      'Runner Appointment B ' || v_run_token,
      'technical_visit',
      'scheduled',
      now() + interval '2 day',
      now() + interval '2 day 1 hour',
      'Runner Customer B',
      null,
      'Rua Runner B',
      'fixture',
      v_lead_b,
      v_conversation_b
    );

  if pg_catalog.to_regclass('public.event_types') is null then
    raise exception using
      errcode = 'P0001',
      message = 'setup failed: public.event_types is required for log_schedule_conversation_event';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'event_types'
      and column_row.column_name = 'key'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'event_types'
      and column_row.column_name = 'is_active'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'setup failed: public.event_types must expose key and is_active for safe harness execution';
  end if;

  execute $sql$
    select event_type_row.key
    from public.event_types event_type_row
    where event_type_row.is_active is true
    order by event_type_row.key
    limit 1
  $sql$
  into v_event_type_key;

  if v_event_type_key is null then
    raise exception using
      errcode = 'P0001',
      message = 'setup failed: no active event_types.key was found for log_schedule_conversation_event';
  end if;

  insert into public.store_schedule_blocks (
    id,
    organization_id,
    store_id,
    title,
    block_type,
    start_at,
    end_at,
    source,
    notes
  )
  values
    (
      v_block_a,
      v_org_a,
      v_store_a,
      'Runner Block A ' || v_run_token,
      'manual_block',
      now() + interval '3 day',
      now() + interval '3 day 2 hour',
      'panel',
      'fixture'
    ),
    (
      v_block_b,
      v_org_b,
      v_store_b,
      'Runner Block B ' || v_run_token,
      'manual_block',
      now() + interval '4 day',
      now() + interval '4 day 2 hour',
      'panel',
      'fixture'
    );

  insert into public.store_schedule_settings (
    organization_id,
    store_id,
    allow_multiple_appointments_per_day,
    allow_same_time_appointments,
    same_time_capacity,
    attends_holidays,
    enforce_operating_window,
    operating_days,
    operating_hours,
    installation_days,
    after_hours_behavior,
    timezone_name,
    notes
  )
  values
    (
      v_org_a,
      v_store_a,
      true,
      false,
      1,
      false,
      false,
      '["monday","tuesday"]'::jsonb,
      '{"monday":{"start":"08:00","end":"18:00"},"tuesday":{"start":"08:00","end":"18:00"}}'::jsonb,
      '["monday"]'::jsonb,
      'queue_next_day',
      'America/Sao_Paulo',
      'fixture'
    );

  insert into public.store_assistant_operational_tasks (
    id,
    organization_id,
    store_id,
    thread_id,
    task_type,
    status,
    priority,
    title,
    description,
    related_lead_id,
    related_conversation_id,
    related_appointment_id,
    customer_name,
    customer_phone,
    target_date,
    target_time,
    target_start_at,
    target_end_at,
    timezone_name,
    task_payload
  )
  values
    (
      v_task_a,
      v_org_a,
      v_store_a,
      null,
      'appointment_reschedule_with_customer',
      'waiting_customer_response',
      'normal',
      'Runner Task A ' || v_run_token,
      'fixture',
      v_lead_a,
      v_conversation_a,
      v_appointment_a,
      'Runner Customer A',
      null,
      null,
      null,
      now() + interval '5 day',
      now() + interval '5 day 1 hour',
      'America/Sao_Paulo',
      jsonb_build_object('runner', v_run_token)
    ),
    (
      v_task_b,
      v_org_b,
      v_store_b,
      null,
      'appointment_reschedule_with_customer',
      'waiting_customer_response',
      'normal',
      'Runner Task B ' || v_run_token,
      'fixture',
      v_lead_b,
      v_conversation_b,
      v_appointment_b,
      'Runner Customer B',
      null,
      null,
      null,
      now() + interval '6 day',
      now() + interval '6 day 1 hour',
      'America/Sao_Paulo',
      jsonb_build_object('runner', v_run_token)
    );

  insert into pg_temp._p18_operational_state (state_key, value_uuid, value_text) values
    ('run_id', v_run_id, null),
    ('org_a', v_org_a, null),
    ('org_b', v_org_b, null),
    ('store_a', v_store_a, null),
    ('store_a_settings', v_store_a_settings, null),
    ('store_b', v_store_b, null),
    ('user_a', v_user_a, null),
    ('user_b', v_user_b, null),
    ('lead_a', v_lead_a, null),
    ('lead_b', v_lead_b, null),
    ('conversation_a', v_conversation_a, null),
    ('conversation_b', v_conversation_b, null),
    ('appointment_a', v_appointment_a, null),
    ('appointment_b', v_appointment_b, null),
    ('block_a', v_block_a, null),
    ('block_b', v_block_b, null),
    ('task_a', v_task_a, null),
    ('task_b', v_task_b, null),
    ('event_type_key', null, v_event_type_key),
    ('run_token', null, v_run_token);
exception
  when others then
    perform pg_temp._p18_operational_record(16, 'HARNESS_ERROR', 'setup failed: ' || sqlerrm);
    raise;
end;
$setup$;

do $scenario_1$
declare
  v_ok boolean;
begin
  select bool_and(class_row.relrowsecurity)
  into v_ok
  from pg_catalog.pg_class class_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = class_row.relnamespace
  where namespace_row.nspname = 'public'
    and class_row.relname in (
      'store_appointments',
      'store_assistant_messages',
      'store_assistant_notification_queue',
      'store_assistant_operational_tasks',
      'store_responsibles',
      'store_schedule_blocks',
      'store_schedule_settings'
    );

  perform pg_temp._p18_operational_require(v_ok, 'one or more target tables do not have rls enabled');
  perform pg_temp._p18_operational_record(1, 'PASS', 'all seven operational tables report relrowsecurity=true');
exception
  when others then
    perform pg_temp._p18_operational_record(1, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_1$;

do $scenario_2$
declare
  v_total integer;
  v_appointments integer;
  v_blocks integer;
  v_settings integer;
  v_tasks integer;
  v_messages integer;
  v_notifications integer;
  v_responsibles integer;
begin
  select count(*) into v_total
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename in (
      'store_appointments',
      'store_assistant_messages',
      'store_assistant_notification_queue',
      'store_assistant_operational_tasks',
      'store_responsibles',
      'store_schedule_blocks',
      'store_schedule_settings'
    );

  select count(*) into v_appointments from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'store_appointments';
  select count(*) into v_blocks from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'store_schedule_blocks';
  select count(*) into v_settings from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'store_schedule_settings';
  select count(*) into v_tasks from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'store_assistant_operational_tasks';
  select count(*) into v_messages from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'store_assistant_messages';
  select count(*) into v_notifications from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'store_assistant_notification_queue';
  select count(*) into v_responsibles from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'store_responsibles';

  perform pg_temp._p18_operational_require(v_total = 10, format('expected 10 policies, found %s', v_total));
  perform pg_temp._p18_operational_require(v_appointments = 3, format('appointments expected 3 policies, found %s', v_appointments));
  perform pg_temp._p18_operational_require(v_blocks = 3, format('schedule_blocks expected 3 policies, found %s', v_blocks));
  perform pg_temp._p18_operational_require(v_settings = 3, format('schedule_settings expected 3 policies, found %s', v_settings));
  perform pg_temp._p18_operational_require(v_tasks = 1, format('operational_tasks expected 1 policy, found %s', v_tasks));
  perform pg_temp._p18_operational_require(v_messages = 0 and v_notifications = 0 and v_responsibles = 0, 'server-only tables must finish with zero authenticated policies');
  perform pg_temp._p18_operational_record(2, 'PASS', format('policy_count=%s appointments=%s blocks=%s settings=%s tasks=%s server_only=(%s,%s,%s)', v_total, v_appointments, v_blocks, v_settings, v_tasks, v_messages, v_notifications, v_responsibles));
exception
  when others then
    perform pg_temp._p18_operational_record(2, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_2$;

do $scenario_3$
declare
  v_unsafe integer;
  v_public_acl integer;
  v_anon_acl integer;
begin
  select count(*)
  into v_unsafe
  from pg_catalog.pg_policies policy_row
  where policy_row.schemaname = 'public'
    and policy_row.tablename in (
      'store_appointments',
      'store_assistant_messages',
      'store_assistant_notification_queue',
      'store_assistant_operational_tasks',
      'store_responsibles',
      'store_schedule_blocks',
      'store_schedule_settings'
    )
    and (
      lower(pg_catalog.btrim(coalesce(policy_row.qual, ''))) = 'true'
      or lower(pg_catalog.btrim(coalesce(policy_row.with_check, ''))) = 'true'
      or policy_row.roles @> array['public']::name[]
      or policy_row.roles @> array['anon']::name[]
      or coalesce(policy_row.qual, '') ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      or coalesce(policy_row.with_check, '') ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    );

  select count(*)
  into v_public_acl
  from pg_catalog.pg_class class_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = class_row.relnamespace
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      class_row.relacl,
      pg_catalog.acldefault('r', class_row.relowner)
    )
  ) acl_row
  where namespace_row.nspname = 'public'
    and class_row.relname in (
      'store_appointments',
      'store_assistant_messages',
      'store_assistant_notification_queue',
      'store_assistant_operational_tasks',
      'store_responsibles',
      'store_schedule_blocks',
      'store_schedule_settings'
    )
    and acl_row.grantee = 0
    and acl_row.privilege_type in (
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER'
    );

  select count(*)
  into v_anon_acl
  from unnest(array[
    'public.store_appointments',
    'public.store_assistant_messages',
    'public.store_assistant_notification_queue',
    'public.store_assistant_operational_tasks',
    'public.store_responsibles',
    'public.store_schedule_blocks',
    'public.store_schedule_settings'
  ]) as target_table
  where has_table_privilege('anon', target_table, 'SELECT')
     or has_table_privilege('anon', target_table, 'INSERT')
     or has_table_privilege('anon', target_table, 'UPDATE')
     or has_table_privilege('anon', target_table, 'DELETE')
     or has_table_privilege('anon', target_table, 'TRUNCATE')
     or has_table_privilege('anon', target_table, 'REFERENCES')
     or has_table_privilege('anon', target_table, 'TRIGGER');

  perform pg_temp._p18_operational_require(v_unsafe = 0, format('found %s unsafe policies', v_unsafe));
  perform pg_temp._p18_operational_require(v_public_acl = 0, format('found %s tables still granting PUBLIC', v_public_acl));
  perform pg_temp._p18_operational_require(v_anon_acl = 0, format('found %s tables still granting anon', v_anon_acl));
  perform pg_temp._p18_operational_record(3, 'PASS', 'no unsafe true-policies, hardcoded identifiers, or PUBLIC/anon table grants remain');
exception
  when others then
    perform pg_temp._p18_operational_record(3, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_3$;

do $scenario_4$
declare
  v_ok boolean;
begin
  select
    has_table_privilege('authenticated', 'public.store_appointments', 'SELECT')
    and has_table_privilege('authenticated', 'public.store_appointments', 'INSERT')
    and has_table_privilege('authenticated', 'public.store_appointments', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.store_appointments', 'DELETE')
    and not has_table_privilege('authenticated', 'public.store_appointments', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.store_appointments', 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.store_appointments', 'TRIGGER')
    and has_table_privilege('authenticated', 'public.store_schedule_blocks', 'SELECT')
    and not has_table_privilege('authenticated', 'public.store_schedule_blocks', 'INSERT')
    and has_table_privilege('authenticated', 'public.store_schedule_blocks', 'UPDATE')
    and has_table_privilege('authenticated', 'public.store_schedule_blocks', 'DELETE')
    and not has_table_privilege('authenticated', 'public.store_schedule_blocks', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.store_schedule_blocks', 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.store_schedule_blocks', 'TRIGGER')
    and has_table_privilege('authenticated', 'public.store_schedule_settings', 'SELECT')
    and has_table_privilege('authenticated', 'public.store_schedule_settings', 'INSERT')
    and has_table_privilege('authenticated', 'public.store_schedule_settings', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.store_schedule_settings', 'DELETE')
    and not has_table_privilege('authenticated', 'public.store_schedule_settings', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.store_schedule_settings', 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.store_schedule_settings', 'TRIGGER')
    and has_table_privilege('authenticated', 'public.store_assistant_operational_tasks', 'SELECT')
    and not has_table_privilege('authenticated', 'public.store_assistant_operational_tasks', 'INSERT')
    and not has_table_privilege('authenticated', 'public.store_assistant_operational_tasks', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.store_assistant_operational_tasks', 'DELETE')
    and not has_table_privilege('authenticated', 'public.store_assistant_operational_tasks', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.store_assistant_operational_tasks', 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.store_assistant_operational_tasks', 'TRIGGER')
    and not has_table_privilege('authenticated', 'public.store_assistant_messages', 'SELECT')
    and not has_table_privilege('authenticated', 'public.store_assistant_messages', 'INSERT')
    and not has_table_privilege('authenticated', 'public.store_assistant_messages', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.store_assistant_messages', 'DELETE')
    and not has_table_privilege('authenticated', 'public.store_assistant_messages', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.store_assistant_messages', 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.store_assistant_messages', 'TRIGGER')
    and not has_table_privilege('authenticated', 'public.store_assistant_notification_queue', 'SELECT')
    and not has_table_privilege('authenticated', 'public.store_assistant_notification_queue', 'INSERT')
    and not has_table_privilege('authenticated', 'public.store_assistant_notification_queue', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.store_assistant_notification_queue', 'DELETE')
    and not has_table_privilege('authenticated', 'public.store_assistant_notification_queue', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.store_assistant_notification_queue', 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.store_assistant_notification_queue', 'TRIGGER')
    and not has_table_privilege('authenticated', 'public.store_responsibles', 'SELECT')
    and not has_table_privilege('authenticated', 'public.store_responsibles', 'INSERT')
    and not has_table_privilege('authenticated', 'public.store_responsibles', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.store_responsibles', 'DELETE')
    and not has_table_privilege('authenticated', 'public.store_responsibles', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.store_responsibles', 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.store_responsibles', 'TRIGGER')
  into v_ok;

  perform pg_temp._p18_operational_require(v_ok, 'authenticated table grants diverged from the expected pilot contract');
  perform pg_temp._p18_operational_record(4, 'PASS', 'authenticated keeps only appointments/select-insert-update, blocks/select-update-delete, settings/select-insert-update and operational_tasks/select');
exception
  when others then
    perform pg_temp._p18_operational_record(4, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_4$;

do $scenario_5$
declare
  v_ok boolean;
begin
  select bool_and(
    has_table_privilege('service_role', target_table, 'SELECT')
    and has_table_privilege('service_role', target_table, 'INSERT')
    and has_table_privilege('service_role', target_table, 'UPDATE')
    and has_table_privilege('service_role', target_table, 'DELETE')
  )
  into v_ok
  from unnest(array[
    'public.store_appointments',
    'public.store_assistant_messages',
    'public.store_assistant_notification_queue',
    'public.store_assistant_operational_tasks',
    'public.store_responsibles',
    'public.store_schedule_blocks',
    'public.store_schedule_settings'
  ]) target_table;

  perform pg_temp._p18_operational_require(v_ok, 'service_role lost one or more required table privileges');
  perform pg_temp._p18_operational_record(5, 'PASS', 'service_role keeps CRUD access on all seven tables');
exception
  when others then
    perform pg_temp._p18_operational_record(5, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_5$;

do $scenario_6$
declare
  v_user_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'user_a');
  v_org_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'org_a');
  v_store_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'store_a');
  v_store_b uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'store_b');
begin
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format('select count(*)::text from public.memberships where organization_id = %L::uuid', v_org_a),
    '1'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format('select count(*)::text from public.stores where id = %L::uuid', v_store_a),
    '1'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format('select count(*)::text from public.stores where id = %L::uuid', v_store_b),
    '0'
  );
  perform pg_temp._p18_operational_record(6, 'PASS', 'authenticated can read own membership and store while foreign store stays invisible');
exception
  when others then
    perform pg_temp._p18_operational_record(6, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_6$;

do $scenario_7$
declare
  v_user_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'user_a');
  v_org_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'org_a');
  v_org_b uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'org_b');
  v_store_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'store_a');
  v_store_b uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'store_b');
  v_appointment_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'appointment_a');
  v_appointment_b uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'appointment_b');
  v_insert_id uuid := gen_random_uuid();
begin
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format('select count(*)::text from public.store_appointments where id = %L::uuid', v_appointment_a),
    '1'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with inserted as (
        insert into public.store_appointments (
          id, organization_id, store_id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 'Inserted Appointment', 'technical_visit', 'scheduled', now() + interval '7 day', now() + interval '7 day 1 hour', 'Runner Customer', null, 'Rua Insert', 'runner', null, null
        )
        returning id
      )
      select count(*)::text from inserted
    $sql$, v_insert_id, v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format('with updated as (update public.store_appointments set notes = ''updated'' where id = %L::uuid returning id) select count(*)::text from updated', v_insert_id),
    '1'
  );
  perform pg_temp._p18_operational_assert_failure(
    'authenticated',
    v_user_a,
    format('delete from public.store_appointments where id = %L::uuid', v_insert_id),
    '42501'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format('select count(*)::text from public.store_appointments where id = %L::uuid', v_appointment_b),
    '0'
  );
  perform pg_temp._p18_operational_assert_failure(
    'authenticated',
    v_user_a,
    format('update public.store_appointments set organization_id = %L::uuid, store_id = %L::uuid where id = %L::uuid', v_org_b, v_store_b, v_appointment_a),
    '42501'
  );
  perform pg_temp._p18_operational_record(7, 'PASS', 'authenticated keeps own tenant select/insert/update on appointments, without delete, and cannot pivot to foreign tenant');
exception
  when others then
    perform pg_temp._p18_operational_record(7, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_7$;

do $scenario_8$
declare
  v_user_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'user_a');
  v_org_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'org_a');
  v_store_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'store_a');
  v_block_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'block_a');
  v_block_b uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'block_b');
begin
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format('select count(*)::text from public.store_schedule_blocks where id = %L::uuid', v_block_a),
    '1'
  );
  perform pg_temp._p18_operational_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      insert into public.store_schedule_blocks (
        id, organization_id, store_id, title, block_type, start_at, end_at, source, notes
      ) values (
        gen_random_uuid(), %L::uuid, %L::uuid, 'Blocked Insert', 'manual_block', now(), now() + interval '1 hour', 'panel', 'runner'
      )
    $sql$, v_org_a, v_store_a),
    '42501'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format('with updated as (update public.store_schedule_blocks set notes = ''updated'' where id = %L::uuid returning id) select count(*)::text from updated', v_block_a),
    '1'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format('select count(*)::text from public.store_schedule_blocks where id = %L::uuid', v_block_b),
    '0'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format('with deleted as (delete from public.store_schedule_blocks where id = %L::uuid returning id) select count(*)::text from deleted', v_block_a),
    '1'
  );
  perform pg_temp._p18_operational_record(8, 'PASS', 'authenticated keeps own select/update/delete on blocks, but direct insert is blocked and foreign rows stay invisible');
exception
  when others then
    perform pg_temp._p18_operational_record(8, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_8$;

do $scenario_9$
declare
  v_user_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'user_a');
  v_org_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'org_a');
  v_store_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'store_a');
  v_store_a_settings uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'store_a_settings');
  v_org_b uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'org_b');
  v_store_b uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'store_b');
begin
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format('select count(*)::text from public.store_schedule_settings where organization_id = %L::uuid and store_id = %L::uuid', v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with inserted as (
        insert into public.store_schedule_settings (
          organization_id, store_id, allow_multiple_appointments_per_day, allow_same_time_appointments, same_time_capacity, attends_holidays, operating_days, operating_hours, installation_days, after_hours_behavior, timezone_name, notes
        ) values (
          %L::uuid, %L::uuid, true, false, 2, false, '["wednesday"]'::jsonb, '{"wednesday":{"start":"09:00","end":"17:00"}}'::jsonb, '["wednesday"]'::jsonb, 'queue_next_day', 'America/Sao_Paulo', 'second-row'
        )
        returning store_id
      )
      select count(*)::text from inserted
    $sql$, v_org_a, v_store_a_settings),
    '1'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format('with updated as (update public.store_schedule_settings set notes = ''updated'' where organization_id = %L::uuid and store_id = %L::uuid returning store_id) select count(*)::text from updated', v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_operational_assert_failure(
    'authenticated',
    v_user_a,
    format('delete from public.store_schedule_settings where organization_id = %L::uuid and store_id = %L::uuid', v_org_a, v_store_a),
    '42501'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format('select count(*)::text from public.store_schedule_settings where organization_id = %L::uuid and store_id = %L::uuid', v_org_b, v_store_b),
    '0'
  );
  perform pg_temp._p18_operational_record(9, 'PASS', 'authenticated keeps own select/insert/update on settings, without delete, and foreign tenant remains blocked');
exception
  when others then
    perform pg_temp._p18_operational_record(9, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_9$;

do $scenario_10$
declare
  v_user_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'user_a');
  v_org_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'org_a');
  v_store_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'store_a');
  v_task_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'task_a');
  v_task_b uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'task_b');
begin
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format('select count(*)::text from public.store_assistant_operational_tasks where id = %L::uuid', v_task_a),
    '1'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format('select count(*)::text from public.store_assistant_operational_tasks where id = %L::uuid', v_task_b),
    '0'
  );
  perform pg_temp._p18_operational_assert_failure(
    'authenticated',
    v_user_a,
    format('insert into public.store_assistant_operational_tasks (id, organization_id, store_id, task_type, status, priority, title, description, customer_name, timezone_name, task_payload) values (gen_random_uuid(), %L::uuid, %L::uuid, ''appointment_reschedule_with_customer'', ''waiting_customer_response'', ''normal'', ''denied'', ''denied'', ''Runner'', ''America/Sao_Paulo'', ''{}''::jsonb)', v_org_a, v_store_a),
    '42501'
  );
  perform pg_temp._p18_operational_assert_failure(
    'authenticated',
    v_user_a,
    format('update public.store_assistant_operational_tasks set description = ''denied'' where id = %L::uuid', v_task_a),
    '42501'
  );
  perform pg_temp._p18_operational_assert_failure(
    'authenticated',
    v_user_a,
    format('delete from public.store_assistant_operational_tasks where id = %L::uuid', v_task_a),
    '42501'
  );
  perform pg_temp._p18_operational_record(10, 'PASS', 'operational_tasks is visible only for same tenant and remains select-only for authenticated');
exception
  when others then
    perform pg_temp._p18_operational_record(10, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_10$;

do $scenario_11$
declare
  v_user_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'user_a');
begin
  perform pg_temp._p18_operational_assert_failure('authenticated', v_user_a, 'select count(*)::text from public.store_assistant_messages', '42501');
  perform pg_temp._p18_operational_assert_failure('authenticated', v_user_a, 'update public.store_assistant_messages set organization_id = organization_id where false', '42501');
  perform pg_temp._p18_operational_assert_failure('authenticated', v_user_a, 'delete from public.store_assistant_messages where false', '42501');
  perform pg_temp._p18_operational_assert_failure('authenticated', v_user_a, 'select count(*)::text from public.store_assistant_notification_queue', '42501');
  perform pg_temp._p18_operational_assert_failure('authenticated', v_user_a, 'update public.store_assistant_notification_queue set organization_id = organization_id where false', '42501');
  perform pg_temp._p18_operational_assert_failure('authenticated', v_user_a, 'delete from public.store_assistant_notification_queue where false', '42501');
  perform pg_temp._p18_operational_assert_failure('authenticated', v_user_a, 'select count(*)::text from public.store_responsibles', '42501');
  perform pg_temp._p18_operational_assert_failure('authenticated', v_user_a, 'update public.store_responsibles set organization_id = organization_id where false', '42501');
  perform pg_temp._p18_operational_assert_failure('authenticated', v_user_a, 'delete from public.store_responsibles where false', '42501');
  perform pg_temp._p18_operational_record(11, 'PASS', 'server-only tables reject direct authenticated reads');
exception
  when others then
    perform pg_temp._p18_operational_record(11, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_11$;

do $scenario_12$
declare
  v_public_execute integer;
  v_anon_execute integer;
begin
  select count(*)
  into v_public_execute
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      proc_row.proacl,
      pg_catalog.acldefault('f', proc_row.proowner)
    )
  ) acl_row
  where namespace_row.nspname = 'public'
    and proc_row.proname in (
      'create_store_appointment',
      'update_store_appointment',
      'cancel_store_appointment',
      'update_store_schedule_block',
      'delete_store_schedule_block',
      'upsert_store_schedule_settings',
      'has_store_active_appointment_in_range',
      'has_store_appointment_conflict',
      'has_store_schedule_block_conflict',
      'is_store_appointment_within_operating_window',
      'get_store_schedule_settings_effective',
      'complete_store_appointment_with_outcome',
      'create_store_schedule_block_allow_existing_appointments',
      'get_latest_conversation_for_lead',
      'log_schedule_conversation_event',
      'assistant_enqueue_internal_notification',
      'assistant_get_or_create_primary_thread'
    )
    and acl_row.grantee = 0
    and acl_row.privilege_type = 'EXECUTE';

  select count(*)
  into v_anon_execute
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname in (
      'create_store_appointment',
      'update_store_appointment',
      'cancel_store_appointment',
      'update_store_schedule_block',
      'delete_store_schedule_block',
      'upsert_store_schedule_settings',
      'has_store_active_appointment_in_range',
      'has_store_appointment_conflict',
      'has_store_schedule_block_conflict',
      'is_store_appointment_within_operating_window',
      'get_store_schedule_settings_effective',
      'complete_store_appointment_with_outcome',
      'create_store_schedule_block_allow_existing_appointments',
      'get_latest_conversation_for_lead',
      'log_schedule_conversation_event',
      'assistant_enqueue_internal_notification',
      'assistant_get_or_create_primary_thread'
    )
    and has_function_privilege('anon', proc_row.oid, 'EXECUTE');

  perform pg_temp._p18_operational_require(v_public_execute = 0, format('found %s functions still executable by PUBLIC', v_public_execute));
  perform pg_temp._p18_operational_require(v_anon_execute = 0, format('found %s functions still executable by anon', v_anon_execute));
  perform pg_temp._p18_operational_record(12, 'PASS', 'PUBLIC and anon no longer keep execute on audited functions');
exception
  when others then
    perform pg_temp._p18_operational_record(12, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_12$;

do $scenario_13$
declare
  v_user_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'user_a');
  v_org_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'org_a');
  v_store_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'store_a');
  v_appointment_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'appointment_a');
  v_rpc_block_id uuid := gen_random_uuid();
begin
  perform pg_temp._p18_operational_assert_success(
    'service_role',
    null,
    format($sql$
      with inserted as (
        insert into public.store_schedule_blocks (
          id, organization_id, store_id, title, block_type, start_at, end_at, source, notes
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 'RPC Block', 'manual_block', now() + interval '10 day', now() + interval '10 day 1 hour', 'panel', 'runner'
        )
        returning id
      )
      select count(*)::text from inserted
    $sql$, v_rpc_block_id, v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.create_store_appointment(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_lead_id => null,
        p_conversation_id => null,
        p_title => 'RPC Appointment',
        p_appointment_type => 'technical_visit',
        p_status => 'scheduled',
        p_scheduled_start => now() + interval '8 day',
        p_scheduled_end => now() + interval '8 day 1 hour',
        p_customer_name => 'RPC Customer',
        p_customer_phone => null,
        p_address_text => 'Rua RPC',
        p_notes => 'rpc',
        p_source => 'panel',
        p_created_by_user_id => null
      )
    $sql$, v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.update_store_appointment(
        p_appointment_id => %L::uuid,
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_title => 'Updated RPC Appointment',
        p_appointment_type => 'technical_visit',
        p_status => 'rescheduled',
        p_scheduled_start => now() + interval '9 day',
        p_scheduled_end => now() + interval '9 day 1 hour',
        p_customer_name => 'RPC Customer',
        p_customer_phone => null,
        p_address_text => 'Rua RPC',
        p_notes => 'rpc-update'
      )
    $sql$, v_appointment_a, v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.cancel_store_appointment(
        p_appointment_id => %L::uuid,
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_cancel_reason => 'runner'
      )
    $sql$, v_appointment_a, v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.update_store_schedule_block(
        p_block_id => %L::uuid,
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_title => 'Updated Block',
        p_block_type => 'manual_block',
        p_start_at => now() + interval '10 day',
        p_end_at => now() + interval '10 day 2 hour',
        p_notes => 'rpc-update'
      )
    $sql$, v_rpc_block_id, v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select public.delete_store_schedule_block(
        p_block_id => %L::uuid,
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid
      )::text
    $sql$, v_rpc_block_id, v_org_a, v_store_a)
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select (public.upsert_store_schedule_settings(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_allow_multiple_appointments_per_day => true,
        p_allow_same_time_appointments => false,
        p_same_time_capacity => 2,
        p_attends_holidays => false,
        p_operating_days => '["monday"]'::jsonb,
        p_operating_hours => '{"monday":{"start":"08:00","end":"18:00"}}'::jsonb,
        p_installation_days => '["monday"]'::jsonb,
        p_after_hours_behavior => 'queue_next_day',
        p_notes => 'rpc-upsert'
      ) is not null)::text
    $sql$, v_org_a, v_store_a),
    'true'
  );
  perform pg_temp._p18_operational_record(13, 'PASS', 'critical security invoker RPCs keep operating inside the same tenant under the new RLS');
exception
  when others then
    perform pg_temp._p18_operational_record(13, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_13$;

do $scenario_14$
declare
  v_user_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'user_a');
  v_org_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'org_a');
  v_org_b uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'org_b');
  v_store_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'store_a');
  v_store_b uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'store_b');
  v_definer_appointment_id uuid := gen_random_uuid();
  v_appointment_b uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'appointment_b');
  v_lead_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'lead_a');
  v_lead_b uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'lead_b');
  v_conversation_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'conversation_a');
  v_conversation_b uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'conversation_b');
  v_event_type_key text := (select value_text from pg_temp._p18_operational_state where state_key = 'event_type_key');
begin
  perform pg_temp._p18_operational_assert_success(
    'service_role',
    null,
    format($sql$
      with inserted as (
        insert into public.store_appointments (
          id, organization_id, store_id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 'Definer Appointment', 'technical_visit', 'scheduled', now() + interval '12 day', now() + interval '12 day 1 hour', 'Runner Definer', null, 'Rua Definer', 'runner', null, null
        )
        returning id
      )
      select count(*)::text from inserted
    $sql$, v_definer_appointment_id, v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.create_store_schedule_block_allow_existing_appointments(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_title => 'Definer Block',
        p_block_type => 'manual_block',
        p_start_at => now() + interval '11 day',
        p_end_at => now() + interval '11 day 1 hour',
        p_notes => 'runner',
        p_source => 'panel',
        p_created_by_user_id => null
      )
    $sql$, v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_operational_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.create_store_schedule_block_allow_existing_appointments(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_title => 'Definer Block Foreign',
        p_block_type => 'manual_block',
        p_start_at => now() + interval '11 day',
        p_end_at => now() + interval '11 day 1 hour',
        p_notes => 'runner',
        p_source => 'panel',
        p_created_by_user_id => null
      )
    $sql$, v_org_b, v_store_b),
    '42501'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.complete_store_appointment_with_outcome(
        p_appointment_id => %L::uuid,
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_completion_outcome => 'fully_completed',
        p_completion_note => 'runner'
      )
    $sql$, v_definer_appointment_id, v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_operational_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.complete_store_appointment_with_outcome(
        p_appointment_id => %L::uuid,
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_completion_outcome => 'fully_completed',
        p_completion_note => 'runner'
      )
    $sql$, v_appointment_b, v_org_b, v_store_b),
    '42501'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select public.get_latest_conversation_for_lead(
        p_organization_id => %L::uuid,
        p_lead_id => %L::uuid
      )::text
    $sql$, v_org_a, v_lead_a),
    v_conversation_a::text
  );
  perform pg_temp._p18_operational_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select public.get_latest_conversation_for_lead(
        p_organization_id => %L::uuid,
        p_lead_id => %L::uuid
      )::text
    $sql$, v_org_b, v_lead_b),
    '42501'
  );
  perform pg_temp._p18_operational_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select public.log_schedule_conversation_event(
        p_organization_id => %L::uuid,
        p_conversation_id => %L::uuid,
        p_event_type => %L,
        p_created_by => 'runner',
        p_payload => '{}'::jsonb
      )
    $sql$, v_org_a, v_conversation_a, v_event_type_key)
  );
  perform pg_temp._p18_operational_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select public.log_schedule_conversation_event(
        p_organization_id => %L::uuid,
        p_conversation_id => %L::uuid,
        p_event_type => %L,
        p_created_by => 'runner',
        p_payload => '{}'::jsonb
      )
    $sql$, v_org_a, v_conversation_b, v_event_type_key),
    '42501'
  );
  perform pg_temp._p18_operational_record(14, 'PASS', 'authenticated can use exposed SECURITY DEFINER functions in-tenant and receives equivalent tenant denial for foreign scope');
exception
  when others then
    perform pg_temp._p18_operational_record(14, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_14$;

do $scenario_15$
declare
  v_user_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'user_a');
  v_org_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'org_a');
  v_store_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'store_a');
  v_lead_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'lead_a');
  v_conversation_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'conversation_a');
  v_authenticated_execute_count integer;
  v_service_role_execute_count integer;
  v_primary_thread_sql text;
begin
  select count(*)
  into v_authenticated_execute_count
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname in (
      'assistant_enqueue_internal_notification',
      'assistant_get_or_create_primary_thread'
    )
    and has_function_privilege('authenticated', proc_row.oid, 'EXECUTE');

  select count(*)
  into v_service_role_execute_count
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname in (
      'assistant_enqueue_internal_notification',
      'assistant_get_or_create_primary_thread'
    )
    and has_function_privilege('service_role', proc_row.oid, 'EXECUTE');

  perform pg_temp._p18_operational_require(v_authenticated_execute_count = 0, format('authenticated still executes %s server-only assistant functions', v_authenticated_execute_count));
  perform pg_temp._p18_operational_require(v_service_role_execute_count = 2, format('service_role expected execute on 2 server-only assistant functions, found %s', v_service_role_execute_count));
  v_primary_thread_sql := pg_temp._p18_operational_build_assistant_primary_thread_sql(
    v_org_a,
    v_store_a,
    v_lead_a,
    v_conversation_a
  );
  perform pg_temp._p18_operational_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select public.assistant_enqueue_internal_notification(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_notification_type => 'important_alert',
        p_title => 'Denied',
        p_body => 'Denied',
        p_priority => 'normal',
        p_context => '{}'::jsonb,
        p_related_lead_id => null,
        p_related_conversation_id => null,
        p_related_appointment_id => null,
        p_event_key => 'runner-denied'
      )
    $sql$, v_org_a, v_store_a),
    '42501'
  );
  perform pg_temp._p18_operational_assert_failure(
    'authenticated',
    v_user_a,
    v_primary_thread_sql,
    '42501'
  );
  perform pg_temp._p18_operational_assert_success(
    'service_role',
    null,
    format($sql$
      select public.assistant_enqueue_internal_notification(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_notification_type => 'important_alert',
        p_title => 'Allowed',
        p_body => 'Allowed',
        p_priority => 'normal',
        p_context => '{}'::jsonb,
        p_related_lead_id => null,
        p_related_conversation_id => null,
        p_related_appointment_id => null,
        p_event_key => 'runner-allowed'
      )
    $sql$, v_org_a, v_store_a)
  );
  perform pg_temp._p18_operational_assert_success(
    'service_role',
    null,
    v_primary_thread_sql
  );
  perform pg_temp._p18_operational_record(15, 'PASS', 'server-only functions reject authenticated, service_role keeps execute, and both assistant server-only functions stay outside browser scope');
exception
  when others then
    perform pg_temp._p18_operational_record(15, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_15$;

do $scenario_16$
declare
  v_run_token text := (select value_text from pg_temp._p18_operational_state where state_key = 'run_token');
  v_org_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'org_a');
  v_org_b uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'org_b');
  v_appointment_a uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'appointment_a');
  v_block_b uuid := (select value_uuid from pg_temp._p18_operational_state where state_key = 'block_b');
  v_match_count integer;
begin
  select count(*)
  into v_match_count
  from (
    select 1 from public.organizations where id = v_org_a
    union all
    select 1 from public.organizations where id = v_org_b
    union all
    select 1 from public.store_appointments where id = v_appointment_a
    union all
    select 1 from public.store_schedule_blocks where id = v_block_b
  ) fixture_rows;

  perform pg_temp._p18_operational_require(length(v_run_token) > 20, 'run token is unexpectedly short');
  perform pg_temp._p18_operational_require(v_match_count = 4, format('expected 4 fixture signatures, found %s', v_match_count));
  perform pg_temp._p18_operational_record(16, 'PASS', 'synthetic fixtures stay isolated under the outer transaction; cleanup is delegated to rollback');
exception
  when others then
    perform pg_temp._p18_operational_record(16, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_16$;

select
  result_row.scenario_number,
  result_row.scenario_name,
  result_row.status,
  result_row.details
from pg_temp._p18_operational_results result_row
order by result_row.scenario_number;

select
  count(*) filter (where status = 'PASS') as pass_count,
  count(*) filter (where status <> 'PASS') as fail_count,
  count(*) as total_count
from pg_temp._p18_operational_results;

rollback;
