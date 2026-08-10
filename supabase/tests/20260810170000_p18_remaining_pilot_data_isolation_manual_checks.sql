begin;

create temp table pg_temp._p18_remaining_matrix (
  scenario_number integer primary key,
  scenario_name text not null
);

insert into pg_temp._p18_remaining_matrix (scenario_number, scenario_name)
values
  (1, 'rls e force rls finais nas tres tabelas'),
  (2, 'grants finais e policies finais das tres tabelas'),
  (3, 'discount settings authenticated respeita tenant e bloqueia delete e membership inativa'),
  (4, 'threads e context state bloqueiam acesso direto authenticated'),
  (5, 'execute das cinco rpcs fica fechado para public anon e service_role limitado'),
  (6, 'assistant_get_thread_summary funciona no proprio tenant e invisibiliza foreign tenant'),
  (7, 'assistant_list_messages funciona no tenant proprio e via service_role'),
  (8, 'assistant_list_messages_paginated funciona no tenant proprio e invisibiliza foreign tenant'),
  (9, 'assistant_mark_notifications_seen altera apenas o proprio tenant e foreign ou inactive retorna 42501'),
  (10, 'assistant_send_human_message cria mensagem no tenant proprio e foreign ou inactive retorna 42501'),
  (11, 'assistant_get_or_create_primary_thread e assistant_enqueue_internal_notification nao reabrem para authenticated'),
  (12, 'superficies da etapa 3.3 nao foram reabertas e fixtures sinteticas ficam isoladas');

create temp table pg_temp._p18_remaining_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  details text not null
);

create temp table pg_temp._p18_remaining_state (
  state_key text primary key,
  value_uuid uuid null,
  value_text text null
) on commit drop;

create or replace function pg_temp._p18_remaining_record(
  p_scenario_number integer,
  p_status text,
  p_details text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p18_remaining_results (
    scenario_number,
    scenario_name,
    status,
    details
  )
  values (
    p_scenario_number,
    (
      select matrix_row.scenario_name
      from pg_temp._p18_remaining_matrix matrix_row
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

create or replace function pg_temp._p18_remaining_require(
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

create or replace function pg_temp._p18_remaining_set_auth(
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

create or replace function pg_temp._p18_remaining_reset_auth()
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

create or replace function pg_temp._p18_remaining_exec(
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
  perform pg_temp._p18_remaining_set_auth(p_role, p_user_id);

  begin
    execute p_sql into v_value;
    perform pg_temp._p18_remaining_reset_auth();
    return query select true, v_value, null::text, null::text;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;
      perform pg_temp._p18_remaining_reset_auth();
      return query select false, null::text, v_state, v_message;
  end;
end;
$function$;

create or replace function pg_temp._p18_remaining_assert_success(
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
  from pg_temp._p18_remaining_exec(p_role, p_user_id, p_sql);

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

create or replace function pg_temp._p18_remaining_assert_failure(
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
  from pg_temp._p18_remaining_exec(p_role, p_user_id, p_sql);

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

do $setup$
declare
  v_run_token text := 'p18_remaining_' || replace(gen_random_uuid()::text, '-', '');
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_store_a uuid := gen_random_uuid();
  v_store_a_upsert uuid := gen_random_uuid();
  v_store_b uuid := gen_random_uuid();
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_user_inactive uuid := gen_random_uuid();
  v_thread_a uuid := gen_random_uuid();
  v_thread_b uuid := gen_random_uuid();
  v_context_a uuid := gen_random_uuid();
  v_context_b uuid := gen_random_uuid();
  v_message_a_old uuid := gen_random_uuid();
  v_message_a_new uuid := gen_random_uuid();
  v_message_b uuid := gen_random_uuid();
  v_message_a_old_created_at timestamp with time zone := now() - interval '10 minute';
  v_message_a_new_created_at timestamp with time zone := now() - interval '1 minute';
  v_message_b_created_at timestamp with time zone := now() - interval '3 minute';
  v_notification_a_pending uuid := gen_random_uuid();
  v_notification_a_future uuid := gen_random_uuid();
  v_notification_b_pending uuid := gen_random_uuid();
  v_task_a uuid := gen_random_uuid();
  v_task_b uuid := gen_random_uuid();
begin
  insert into public.organizations (id, name)
  values
    (v_org_a, 'P18 Remaining Org A ' || v_run_token),
    (v_org_b, 'P18 Remaining Org B ' || v_run_token);

  insert into public.stores (id, organization_id, name)
  values
    (v_store_a, v_org_a, 'P18 Remaining Store A ' || v_run_token),
    (v_store_a_upsert, v_org_a, 'P18 Remaining Store A Upsert ' || v_run_token),
    (v_store_b, v_org_b, 'P18 Remaining Store B ' || v_run_token);

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

  insert into public.store_discount_settings (
    organization_id,
    store_id,
    default_discount_percent,
    max_discount_percent,
    allow_ask_above_max_discount
  )
  values
    (v_org_a, v_store_a, 5.00, 10.00, false),
    (v_org_b, v_store_b, 7.50, 15.00, true);

  insert into public.store_assistant_threads (
    id,
    organization_id,
    store_id,
    thread_type,
    status,
    title,
    created_by,
    last_message_at,
    last_message_preview
  )
  values
    (
      v_thread_a,
      v_org_a,
      v_store_a,
      'primary',
      'active',
      'Runner Thread A ' || v_run_token,
      'system',
      now() - interval '1 minute',
      'latest a'
    ),
    (
      v_thread_b,
      v_org_b,
      v_store_b,
      'primary',
      'active',
      'Runner Thread B ' || v_run_token,
      'system',
      now() - interval '2 minute',
      'latest b'
    );

  insert into public.store_assistant_context_state (
    id,
    organization_id,
    store_id,
    thread_id,
    active_topic,
    active_intent,
    active_status,
    timezone_name,
    candidate_options,
    context_payload,
    created_at,
    updated_at
  )
  values
    (
      v_context_a,
      v_org_a,
      v_store_a,
      v_thread_a,
      'runner',
      'runner',
      'active',
      'America/Sao_Paulo',
      '[]'::jsonb,
      jsonb_build_object('runner', v_run_token),
      now(),
      now()
    ),
    (
      v_context_b,
      v_org_b,
      v_store_b,
      v_thread_b,
      'runner',
      'runner',
      'active',
      'America/Sao_Paulo',
      '[]'::jsonb,
      jsonb_build_object('runner', v_run_token),
      now(),
      now()
    );

  insert into public.store_assistant_messages (
    id,
    organization_id,
    store_id,
    thread_id,
    sender,
    sender_role,
    direction,
    message_type,
    content,
    metadata,
    created_at
  )
  values
    (
      v_message_a_old,
      v_org_a,
      v_store_a,
      v_thread_a,
      'assistant',
      'assistant_operational',
      'outgoing',
      'text',
      'Message A old ' || v_run_token,
      '{}'::jsonb,
      v_message_a_old_created_at
    ),
    (
      v_message_a_new,
      v_org_a,
      v_store_a,
      v_thread_a,
      'assistant',
      'assistant_operational',
      'outgoing',
      'text',
      'Message A new ' || v_run_token,
      '{}'::jsonb,
      v_message_a_new_created_at
    ),
    (
      v_message_b,
      v_org_b,
      v_store_b,
      v_thread_b,
      'assistant',
      'assistant_operational',
      'outgoing',
      'text',
      'Message B ' || v_run_token,
      '{}'::jsonb,
      v_message_b_created_at
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
    customer_name,
    timezone_name,
    task_payload
  )
  values
    (
      v_task_a,
      v_org_a,
      v_store_a,
      v_thread_a,
      'appointment_reschedule_with_customer',
      'waiting_customer_response',
      'normal',
      'Runner Task A ' || v_run_token,
      'fixture',
      'Runner A',
      'America/Sao_Paulo',
      jsonb_build_object(
        'needs_responsible_approval', true,
        'needs_new_time_negotiation', false,
        'runner', v_run_token
      )
    ),
    (
      v_task_b,
      v_org_b,
      v_store_b,
      v_thread_b,
      'appointment_reschedule_with_customer',
      'waiting_customer_response',
      'normal',
      'Runner Task B ' || v_run_token,
      'fixture',
      'Runner B',
      'America/Sao_Paulo',
      jsonb_build_object(
        'needs_responsible_approval', false,
        'needs_new_time_negotiation', true,
        'runner', v_run_token
      )
    );

  insert into public.store_assistant_notification_queue (
    id,
    organization_id,
    store_id,
    notification_type,
    priority,
    status,
    title,
    body,
    context,
    related_lead_id,
    related_conversation_id,
    related_appointment_id,
    available_at,
    processed_at
  )
  values
    (
      v_notification_a_pending,
      v_org_a,
      v_store_a,
      'important_alert',
      'normal',
      'pending',
      'Pending A ' || v_run_token,
      'body',
      jsonb_build_object('runner', v_run_token),
      null,
      null,
      null,
      now() - interval '1 minute',
      null
    ),
    (
      v_notification_a_future,
      v_org_a,
      v_store_a,
      'important_alert',
      'normal',
      'pending',
      'Future A ' || v_run_token,
      'body',
      jsonb_build_object('runner', v_run_token),
      null,
      null,
      null,
      now() + interval '1 day',
      null
    ),
    (
      v_notification_b_pending,
      v_org_b,
      v_store_b,
      'important_alert',
      'normal',
      'pending',
      'Pending B ' || v_run_token,
      'body',
      jsonb_build_object('runner', v_run_token),
      null,
      null,
      null,
      now() - interval '1 minute',
      null
    );

  insert into pg_temp._p18_remaining_state (state_key, value_uuid)
  values
    ('org_a', v_org_a),
    ('org_b', v_org_b),
    ('store_a', v_store_a),
    ('store_a_upsert', v_store_a_upsert),
    ('store_b', v_store_b),
    ('user_a', v_user_a),
    ('user_b', v_user_b),
    ('user_inactive', v_user_inactive),
    ('thread_a', v_thread_a),
    ('thread_b', v_thread_b),
    ('context_a', v_context_a),
    ('context_b', v_context_b),
    ('message_a_old', v_message_a_old),
    ('message_a_new', v_message_a_new),
    ('message_b', v_message_b),
    ('notification_a_pending', v_notification_a_pending),
    ('notification_a_future', v_notification_a_future),
    ('notification_b_pending', v_notification_b_pending),
    ('task_a', v_task_a),
    ('task_b', v_task_b);

  insert into pg_temp._p18_remaining_state (state_key, value_text)
  values
    ('run_token', v_run_token),
    ('message_a_old_created_at', v_message_a_old_created_at::text),
    ('message_a_new_created_at', v_message_a_new_created_at::text),
    ('message_b_created_at', v_message_b_created_at::text);
end;
$setup$;

do $scenario_1$
declare
  v_missing_rls integer;
  v_force_enabled integer;
begin
  select count(*)
  into v_missing_rls
  from pg_catalog.pg_class class_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = class_row.relnamespace
  where namespace_row.nspname = 'public'
    and class_row.relname in (
      'store_discount_settings',
      'store_assistant_threads',
      'store_assistant_context_state'
    )
    and not class_row.relrowsecurity;

  select count(*)
  into v_force_enabled
  from pg_catalog.pg_class class_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = class_row.relnamespace
  where namespace_row.nspname = 'public'
    and class_row.relname in (
      'store_discount_settings',
      'store_assistant_threads',
      'store_assistant_context_state'
    )
    and class_row.relforcerowsecurity;

  perform pg_temp._p18_remaining_require(v_missing_rls = 0, format('expected RLS enabled on 3 tables, missing on %s', v_missing_rls));
  perform pg_temp._p18_remaining_require(v_force_enabled = 0, format('expected FORCE RLS off on 3 tables, found %s enabled', v_force_enabled));
  perform pg_temp._p18_remaining_record(1, 'PASS', 'RLS active on the 3 tables and FORCE RLS remains off');
exception
  when others then
    perform pg_temp._p18_remaining_record(1, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_1$;

do $scenario_2$
declare
  v_discount_policies integer;
  v_thread_policies integer;
  v_context_policies integer;
begin
  perform pg_temp._p18_remaining_require(
    has_table_privilege('authenticated', 'public.store_discount_settings', 'SELECT')
    and has_table_privilege('authenticated', 'public.store_discount_settings', 'INSERT')
    and has_table_privilege('authenticated', 'public.store_discount_settings', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.store_discount_settings', 'DELETE'),
    'authenticated grants on store_discount_settings diverged'
  );

  perform pg_temp._p18_remaining_require(
    has_table_privilege('service_role', 'public.store_discount_settings', 'SELECT')
    and has_table_privilege('service_role', 'public.store_discount_settings', 'INSERT')
    and has_table_privilege('service_role', 'public.store_discount_settings', 'UPDATE')
    and has_table_privilege('service_role', 'public.store_assistant_threads', 'SELECT')
    and has_table_privilege('service_role', 'public.store_assistant_threads', 'INSERT')
    and has_table_privilege('service_role', 'public.store_assistant_threads', 'UPDATE')
    and has_table_privilege('service_role', 'public.store_assistant_context_state', 'SELECT')
    and has_table_privilege('service_role', 'public.store_assistant_context_state', 'INSERT')
    and has_table_privilege('service_role', 'public.store_assistant_context_state', 'UPDATE'),
    'service_role grants on the 3 tables diverged'
  );

  perform pg_temp._p18_remaining_require(
    not has_table_privilege('authenticated', 'public.store_assistant_threads', 'SELECT')
    and not has_table_privilege('authenticated', 'public.store_assistant_context_state', 'SELECT'),
    'authenticated must keep zero direct grants on threads and context_state'
  );

  select count(*) into v_discount_policies
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename = 'store_discount_settings';

  select count(*) into v_thread_policies
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename = 'store_assistant_threads';

  select count(*) into v_context_policies
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename = 'store_assistant_context_state';

  perform pg_temp._p18_remaining_require(v_discount_policies = 3, format('expected 3 policies on store_discount_settings, found %s', v_discount_policies));
  perform pg_temp._p18_remaining_require(v_thread_policies = 0, format('expected 0 policies on store_assistant_threads, found %s', v_thread_policies));
  perform pg_temp._p18_remaining_require(v_context_policies = 0, format('expected 0 policies on store_assistant_context_state, found %s', v_context_policies));
  perform pg_temp._p18_remaining_record(2, 'PASS', 'table grants and policies match the final contract');
exception
  when others then
    perform pg_temp._p18_remaining_record(2, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_2$;

do $scenario_3$
declare
  v_user_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'user_a');
  v_user_inactive uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'user_inactive');
  v_org_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'org_a');
  v_org_b uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'org_b');
  v_store_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'store_a');
  v_store_a_upsert uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'store_a_upsert');
  v_store_b uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'store_b');
begin
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    'select auth.uid()::text',
    v_user_a::text
  );
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    format(
      'select count(*)::text from public.memberships where organization_id = %L::uuid and user_id = auth.uid() and is_active is true',
      v_org_a
    ),
    '1'
  );
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    format('select count(*)::text from public.stores where id = %L::uuid and organization_id = %L::uuid', v_store_a, v_org_a),
    '1'
  );
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    format('select count(*)::text from public.stores where id = %L::uuid and organization_id = %L::uuid', v_store_a_upsert, v_org_a),
    '1'
  );
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    format('select count(*)::text from public.store_discount_settings where organization_id = %L::uuid and store_id = %L::uuid', v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    format('select count(*)::text from public.store_discount_settings where organization_id = %L::uuid and store_id = %L::uuid', v_org_a, v_store_a_upsert),
    '0'
  );
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    format('select count(*)::text from public.store_discount_settings where organization_id = %L::uuid and store_id = %L::uuid', v_org_b, v_store_b),
    '0'
  );
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with inserted as (
        insert into public.store_discount_settings (
          organization_id, store_id, default_discount_percent, max_discount_percent, allow_ask_above_max_discount
        ) values (
          %L::uuid, %L::uuid, 3.50, 9.50, false
        )
        on conflict (store_id) do update
        set default_discount_percent = excluded.default_discount_percent
        returning store_id
      )
      select count(*)::text from inserted
    $sql$, v_org_a, v_store_a_upsert),
    '1'
  );
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.store_discount_settings
        set max_discount_percent = 11.00
        where organization_id = %L::uuid
          and store_id = %L::uuid
        returning store_id
      )
      select count(*)::text from updated
    $sql$, v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_remaining_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      insert into public.store_discount_settings (
        organization_id, store_id, default_discount_percent, max_discount_percent, allow_ask_above_max_discount
      ) values (
        %L::uuid, %L::uuid, 2.00, 8.00, false
      )
    $sql$, v_org_b, v_store_b),
    '42501'
  );
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.store_discount_settings
        set max_discount_percent = 99.00
        where organization_id = %L::uuid
          and store_id = %L::uuid
        returning store_id
      )
      select count(*)::text from updated
    $sql$, v_org_b, v_store_b),
    '0'
  );
  perform pg_temp._p18_remaining_assert_failure(
    'authenticated',
    v_user_a,
    format('delete from public.store_discount_settings where organization_id = %L::uuid and store_id = %L::uuid', v_org_a, v_store_a),
    '42501'
  );
  perform pg_temp._p18_remaining_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      insert into public.store_discount_settings (
        organization_id, store_id, default_discount_percent, max_discount_percent, allow_ask_above_max_discount
      ) values (
        %L::uuid, %L::uuid, 1.00, 2.00, false
      )
    $sql$, v_org_a, gen_random_uuid()),
    '42501'
  );
  perform pg_temp._p18_remaining_record(3, 'PASS', 'discount settings enforces active membership, same-tenant visibility and no delete');
exception
  when others then
    perform pg_temp._p18_remaining_record(3, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_3$;

do $scenario_4$
declare
  v_user_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'user_a');
begin
  perform pg_temp._p18_remaining_assert_failure('authenticated', v_user_a, 'select count(*)::text from public.store_assistant_threads', '42501');
  perform pg_temp._p18_remaining_assert_failure('authenticated', v_user_a, 'select count(*)::text from public.store_assistant_context_state', '42501');
  perform pg_temp._p18_remaining_record(4, 'PASS', 'authenticated keeps zero direct access to threads and context_state');
exception
  when others then
    perform pg_temp._p18_remaining_record(4, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_4$;

do $scenario_5$
declare
  v_public_execute integer;
  v_anon_execute integer;
  v_service_role_execute integer;
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
      'assistant_get_thread_summary',
      'assistant_list_messages',
      'assistant_list_messages_paginated',
      'assistant_mark_notifications_seen',
      'assistant_send_human_message'
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
      'assistant_get_thread_summary',
      'assistant_list_messages',
      'assistant_list_messages_paginated',
      'assistant_mark_notifications_seen',
      'assistant_send_human_message'
    )
    and has_function_privilege('anon', proc_row.oid, 'EXECUTE');

  select count(*)
  into v_service_role_execute
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname in (
      'assistant_get_thread_summary',
      'assistant_list_messages',
      'assistant_list_messages_paginated',
      'assistant_mark_notifications_seen',
      'assistant_send_human_message'
    )
    and has_function_privilege('service_role', proc_row.oid, 'EXECUTE');

  perform pg_temp._p18_remaining_require(v_public_execute = 0, format('found %s of the 5 rpc functions still executable by PUBLIC', v_public_execute));
  perform pg_temp._p18_remaining_require(v_anon_execute = 0, format('found %s of the 5 rpc functions still executable by anon', v_anon_execute));
  perform pg_temp._p18_remaining_require(v_service_role_execute = 1, format('service_role must execute only assistant_list_messages, found %s audited grants', v_service_role_execute));
  perform pg_temp._p18_remaining_record(5, 'PASS', 'execute grants are closed for PUBLIC and anon and service_role is limited to assistant_list_messages');
exception
  when others then
    perform pg_temp._p18_remaining_record(5, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_5$;

do $scenario_6$
declare
  v_user_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'user_a');
  v_user_inactive uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'user_inactive');
  v_org_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'org_a');
  v_org_b uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'org_b');
  v_store_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'store_a');
  v_store_b uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'store_b');
begin
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.assistant_get_thread_summary(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid
      )
    $sql$, v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select (
        select pending_notifications::text
        from public.assistant_get_thread_summary(
          p_organization_id => %L::uuid,
          p_store_id => %L::uuid
        )
      )
    $sql$, v_org_a, v_store_a),
    '3'
  );
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.assistant_get_thread_summary(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid
      )
    $sql$, v_org_b, v_store_b),
    '0'
  );
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      select count(*)::text
      from public.assistant_get_thread_summary(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid
      )
    $sql$, v_org_a, v_store_a),
    '0'
  );
  perform pg_temp._p18_remaining_record(6, 'PASS', 'assistant_get_thread_summary works in-tenant and fail-closes on foreign or inactive access');
exception
  when others then
    perform pg_temp._p18_remaining_record(6, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_6$;

do $scenario_7$
declare
  v_user_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'user_a');
  v_org_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'org_a');
  v_org_b uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'org_b');
  v_store_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'store_a');
  v_store_b uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'store_b');
begin
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.assistant_list_messages(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_limit => 30
      )
    $sql$, v_org_a, v_store_a),
    '2'
  );
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.assistant_list_messages(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_limit => 30
      )
    $sql$, v_org_b, v_store_b),
    '0'
  );
  perform pg_temp._p18_remaining_assert_success(
    'service_role',
    null,
    format($sql$
      select count(*)::text
      from public.assistant_list_messages(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_limit => 30
      )
    $sql$, v_org_a, v_store_a),
    '2'
  );
  perform pg_temp._p18_remaining_record(7, 'PASS', 'assistant_list_messages serves the browser tenant and the proven service_role caller only');
exception
  when others then
    perform pg_temp._p18_remaining_record(7, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_7$;

do $scenario_8$
declare
  v_user_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'user_a');
  v_user_inactive uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'user_inactive');
  v_org_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'org_a');
  v_org_b uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'org_b');
  v_store_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'store_a');
  v_store_b uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'store_b');
  v_message_a_new uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'message_a_new');
  v_message_b uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'message_b');
  v_message_a_new_created_at text := (select value_text from pg_temp._p18_remaining_state where state_key = 'message_a_new_created_at');
  v_message_b_created_at text := (select value_text from pg_temp._p18_remaining_state where state_key = 'message_b_created_at');
begin
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.assistant_list_messages_paginated(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_limit => 10,
        p_before_created_at => null,
        p_before_id => null,
        p_after_created_at => null,
        p_after_id => null
      )
    $sql$, v_org_a, v_store_a),
    '2'
  );
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.assistant_list_messages_paginated(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_limit => 10,
        p_before_created_at => null,
        p_before_id => null,
        p_after_created_at => %L::timestamptz,
        p_after_id => %L::uuid
      )
    $sql$, v_org_a, v_store_a, v_message_a_new_created_at, v_message_a_new),
    '0'
  );
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.assistant_list_messages_paginated(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_limit => 10,
        p_before_created_at => %L::timestamptz,
        p_before_id => %L::uuid,
        p_after_created_at => null,
        p_after_id => null
      )
    $sql$, v_org_b, v_store_b, v_message_b_created_at, v_message_b),
    '0'
  );
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      select count(*)::text
      from public.assistant_list_messages_paginated(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_limit => 10,
        p_before_created_at => null,
        p_before_id => null,
        p_after_created_at => null,
        p_after_id => null
      )
    $sql$, v_org_a, v_store_a),
    '0'
  );
  perform pg_temp._p18_remaining_record(8, 'PASS', 'assistant_list_messages_paginated keeps the own-tenant cursor flow and fail-closes foreign or inactive access');
exception
  when others then
    perform pg_temp._p18_remaining_record(8, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_8$;

do $scenario_9$
declare
  v_user_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'user_a');
  v_user_inactive uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'user_inactive');
  v_org_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'org_a');
  v_org_b uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'org_b');
  v_store_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'store_a');
  v_store_b uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'store_b');
begin
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select public.assistant_mark_notifications_seen(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid
      )::text
    $sql$, v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_remaining_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select public.assistant_mark_notifications_seen(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid
      )::text
    $sql$, v_org_b, v_store_b),
    '42501'
  );
  perform pg_temp._p18_remaining_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      select public.assistant_mark_notifications_seen(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid
      )::text
    $sql$, v_org_a, v_store_a),
    '42501'
  );
  perform pg_temp._p18_remaining_record(9, 'PASS', 'assistant_mark_notifications_seen mutates only the own tenant and denies foreign or inactive access with 42501');
exception
  when others then
    perform pg_temp._p18_remaining_record(9, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_9$;

do $scenario_10$
declare
  v_user_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'user_a');
  v_user_inactive uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'user_inactive');
  v_org_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'org_a');
  v_org_b uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'org_b');
  v_store_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'store_a');
  v_store_b uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'store_b');
  v_thread_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'thread_a');
begin
  perform pg_temp._p18_remaining_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.assistant_send_human_message(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_content => 'Runner human message'
      )
    $sql$, v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_remaining_assert_success(
    'service_role',
    null,
    format($sql$
      select count(*)::text
      from public.store_assistant_messages
      where organization_id = %L::uuid
        and store_id = %L::uuid
        and thread_id = %L::uuid
        and sender = 'human'
        and sender_role = 'store_responsible'
        and direction = 'incoming'
        and message_type = 'text'
        and content = 'Runner human message'
    $sql$, v_org_a, v_store_a, v_thread_a),
    '1'
  );
  perform pg_temp._p18_remaining_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.assistant_send_human_message(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_content => 'Denied foreign'
      )
    $sql$, v_org_b, v_store_b),
    '42501'
  );
  perform pg_temp._p18_remaining_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      select count(*)::text
      from public.assistant_send_human_message(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_content => 'Denied inactive'
      )
    $sql$, v_org_a, v_store_a),
    '42501'
  );
  perform pg_temp._p18_remaining_record(10, 'PASS', 'assistant_send_human_message creates the human message in-tenant and denies foreign or inactive access with 42501');
exception
  when others then
    perform pg_temp._p18_remaining_record(10, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_10$;

do $scenario_11$
declare
  v_user_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'user_a');
  v_org_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'org_a');
  v_store_a uuid := (select value_uuid from pg_temp._p18_remaining_state where state_key = 'store_a');
  v_authenticated_execute integer;
  v_service_role_execute integer;
begin
  select count(*)
  into v_authenticated_execute
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
  into v_service_role_execute
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname in (
      'assistant_enqueue_internal_notification',
      'assistant_get_or_create_primary_thread'
    )
    and has_function_privilege('service_role', proc_row.oid, 'EXECUTE');

  perform pg_temp._p18_remaining_require(v_authenticated_execute = 0, format('authenticated still executes %s server-only assistant functions', v_authenticated_execute));
  perform pg_temp._p18_remaining_require(v_service_role_execute = 2, format('service_role expected execute on 2 server-only assistant functions, found %s', v_service_role_execute));
  perform pg_temp._p18_remaining_assert_failure(
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
        p_event_key => 'p18-remaining-denied'
      )
    $sql$, v_org_a, v_store_a),
    '42501'
  );
  perform pg_temp._p18_remaining_record(11, 'PASS', 'server-only assistant functions from 3.3 remain closed to authenticated');
exception
  when others then
    perform pg_temp._p18_remaining_record(11, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_11$;

do $scenario_12$
declare
  v_run_token text := (select value_text from pg_temp._p18_remaining_state where state_key = 'run_token');
begin
  perform pg_temp._p18_remaining_require(
    not has_table_privilege('authenticated', 'public.store_assistant_messages', 'SELECT')
    and not has_table_privilege('authenticated', 'public.store_assistant_notification_queue', 'SELECT')
    and not has_table_privilege('authenticated', 'public.store_responsibles', 'SELECT')
    and has_table_privilege('authenticated', 'public.store_assistant_operational_tasks', 'SELECT')
    and not has_table_privilege('authenticated', 'public.store_assistant_operational_tasks', 'INSERT')
    and has_table_privilege('authenticated', 'public.store_schedule_settings', 'SELECT')
    and has_table_privilege('authenticated', 'public.store_schedule_settings', 'INSERT')
    and has_table_privilege('authenticated', 'public.store_schedule_settings', 'UPDATE'),
    'a previously hardened P18 surface was reopened'
  );

  perform pg_temp._p18_remaining_require(
    exists (
      select 1
      from public.organizations org_row
      where org_row.name like 'P18 Remaining Org A ' || v_run_token
    ),
    'synthetic fixtures were not created inside the transaction'
  );

  perform pg_temp._p18_remaining_record(12, 'PASS', '3.3 surfaces stay hardened and the synthetic fixtures remain isolated until rollback');
exception
  when others then
    perform pg_temp._p18_remaining_record(12, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_12$;

with scenario_summary as (
  select
    count(*) as total_scenarios,
    count(*) filter (where status = 'PASS') as passed_scenarios,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'scenario_number', scenario_number,
          'scenario_name', scenario_name,
          'status', status,
          'details', details
        )
        order by scenario_number
      ) filter (where status <> 'PASS'),
      '[]'::jsonb
    ) as failed_scenarios
  from pg_temp._p18_remaining_results
)
select
  case
    when scenario_summary.total_scenarios <> 12 then 'AINDA_NAO_APROVADA'
    when scenario_summary.passed_scenarios <> 12 then 'AINDA_NAO_APROVADA'
    else 'APROVADA'
  end as final_status,
  scenario_summary.passed_scenarios,
  scenario_summary.total_scenarios,
  scenario_summary.failed_scenarios
from scenario_summary;

rollback;
