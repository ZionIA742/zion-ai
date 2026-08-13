begin;

create temp table pg_temp._p18_assistant_fix_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  details text not null
);

create or replace function pg_temp._p18_assistant_fix_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_details text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p18_assistant_fix_results (
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

create or replace function pg_temp._p18_assistant_fix_require(
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

create or replace function pg_temp._p18_assistant_fix_normalize(
  p_definition text
)
returns text
language sql
as $function$
  select pg_catalog.lower(pg_catalog.regexp_replace(coalesce(p_definition, ''), '\s+', ' ', 'g'));
$function$;

create or replace function pg_temp._p18_assistant_fix_set_auth(
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

create or replace function pg_temp._p18_assistant_fix_reset_auth()
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

create or replace function pg_temp._p18_assistant_fix_exec_count(
  p_session_role text,
  p_user_id uuid,
  p_org_id uuid,
  p_store_id uuid,
  p_claim_role_setting text default null,
  p_claims_role text default null
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
  perform pg_temp._p18_assistant_fix_set_auth(
    p_session_role,
    p_user_id,
    p_claim_role_setting,
    p_claims_role
  );

  begin
    select count(*)::text
    into v_value
    from public.assistant_list_messages(
      p_organization_id => p_org_id,
      p_store_id => p_store_id,
      p_limit => 30
    );

    perform pg_temp._p18_assistant_fix_reset_auth();
    return query select true, v_value, null::text, null::text;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;
      perform pg_temp._p18_assistant_fix_reset_auth();
      return query select false, null::text, v_state, v_message;
  end;
end;
$function$;

do $setup$
declare
  v_run_token text := 'p18_assistant_fix_' || replace(gen_random_uuid()::text, '-', '');
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_store_a uuid := gen_random_uuid();
  v_store_b uuid := gen_random_uuid();
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_user_inactive uuid := gen_random_uuid();
  v_thread_a uuid := gen_random_uuid();
  v_thread_b uuid := gen_random_uuid();
begin
  create temp table pg_temp._p18_assistant_fix_state (
    state_key text primary key,
    value_uuid uuid not null
  ) on commit drop;

  insert into public.organizations (id, name)
  values
    (v_org_a, 'P18 Assistant Fix Org A ' || v_run_token),
    (v_org_b, 'P18 Assistant Fix Org B ' || v_run_token);

  insert into public.stores (id, organization_id, name)
  values
    (v_store_a, v_org_a, 'P18 Assistant Fix Store A ' || v_run_token),
    (v_store_b, v_org_b, 'P18 Assistant Fix Store B ' || v_run_token);

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
      now(),
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
      now(),
      'latest b'
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
      gen_random_uuid(),
      v_org_a,
      v_store_a,
      v_thread_a,
      'assistant',
      'assistant_operational',
      'outgoing',
      'text',
      'Message A old ' || v_run_token,
      '{}'::jsonb,
      now() - interval '10 minute'
    ),
    (
      gen_random_uuid(),
      v_org_a,
      v_store_a,
      v_thread_a,
      'human',
      'store_responsible',
      'incoming',
      'text',
      'Message A new ' || v_run_token,
      '{}'::jsonb,
      now() - interval '1 minute'
    ),
    (
      gen_random_uuid(),
      v_org_b,
      v_store_b,
      v_thread_b,
      'assistant',
      'assistant_operational',
      'outgoing',
      'text',
      'Message B ' || v_run_token,
      '{}'::jsonb,
      now() - interval '3 minute'
    );

  insert into pg_temp._p18_assistant_fix_state (state_key, value_uuid)
  values
    ('org_a', v_org_a),
    ('org_b', v_org_b),
    ('store_a', v_store_a),
    ('store_b', v_store_b),
    ('user_a', v_user_a),
    ('user_inactive', v_user_inactive);
end;
$setup$;

do $checks$
declare
  v_definition text;
  v_normalized_definition text;
  v_exec record;
  v_org_a uuid := (select value_uuid from pg_temp._p18_assistant_fix_state where state_key = 'org_a');
  v_org_b uuid := (select value_uuid from pg_temp._p18_assistant_fix_state where state_key = 'org_b');
  v_store_a uuid := (select value_uuid from pg_temp._p18_assistant_fix_state where state_key = 'store_a');
  v_store_b uuid := (select value_uuid from pg_temp._p18_assistant_fix_state where state_key = 'store_b');
  v_user_a uuid := (select value_uuid from pg_temp._p18_assistant_fix_state where state_key = 'user_a');
  v_user_inactive uuid := (select value_uuid from pg_temp._p18_assistant_fix_state where state_key = 'user_inactive');
begin
  begin
    perform pg_temp._p18_assistant_fix_require(
      pg_catalog.to_regprocedure('public.assistant_list_messages(uuid,uuid,integer)') is not null
      and (
        select count(*)
        from pg_catalog.pg_proc proc_row
        join pg_catalog.pg_namespace namespace_row
          on namespace_row.oid = proc_row.pronamespace
        where namespace_row.nspname = 'public'
          and proc_row.proname = 'assistant_list_messages'
      ) = 1,
      'assistant_list_messages signature missing or overload count changed'
    );
    perform pg_temp._p18_assistant_fix_record(1, 'assistant_list_messages existe com assinatura esperada e sem overload extra', 'PASS', 'assinatura e overload ok');
  exception when others then
    perform pg_temp._p18_assistant_fix_record(1, 'assistant_list_messages existe com assinatura esperada e sem overload extra', 'FAIL', sqlerrm);
  end;

  begin
    perform pg_temp._p18_assistant_fix_require(
      exists (
        select 1
        from pg_catalog.pg_proc proc_row
        where proc_row.oid = 'public.assistant_list_messages(uuid,uuid,integer)'::pg_catalog.regprocedure
          and proc_row.prosecdef
          and proc_row.proconfig @> array['search_path=pg_catalog, public, pg_temp']::text[]
      ),
      'assistant_list_messages security definer/search_path changed'
    );
    perform pg_temp._p18_assistant_fix_record(2, 'assistant_list_messages permanece security definer com search_path endurecido', 'PASS', 'security definer e search_path ok');
  exception when others then
    perform pg_temp._p18_assistant_fix_record(2, 'assistant_list_messages permanece security definer com search_path endurecido', 'FAIL', sqlerrm);
  end;

  begin
    perform pg_temp._p18_assistant_fix_require(
      has_function_privilege('authenticated', 'public.assistant_list_messages(uuid,uuid,integer)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.assistant_list_messages(uuid,uuid,integer)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.assistant_list_messages(uuid,uuid,integer)', 'EXECUTE'),
      'assistant_list_messages ACL diverged'
    );
    perform pg_temp._p18_assistant_fix_record(3, 'assistant_list_messages grants finais: authenticated e service_role, anon negado', 'PASS', 'ACL final ok');
  exception when others then
    perform pg_temp._p18_assistant_fix_record(3, 'assistant_list_messages grants finais: authenticated e service_role, anon negado', 'FAIL', sqlerrm);
  end;

  select pg_catalog.pg_get_functiondef('public.assistant_list_messages(uuid,uuid,integer)'::pg_catalog.regprocedure)
  into v_definition;
  v_normalized_definition := pg_temp._p18_assistant_fix_normalize(v_definition);

  begin
    perform pg_temp._p18_assistant_fix_require(
      position('current_setting(''request.jwt.claim.role'', true)' in v_normalized_definition) > 0
      and position('auth.jwt() ->> ''role''' in v_normalized_definition) > 0
      and position('coalesce(' in v_normalized_definition) > 0,
      'assistant_list_messages role resolution is not hardened'
    );
    perform pg_temp._p18_assistant_fix_record(4, 'assistant_list_messages role resolution usa current_setting com fallback auth.jwt', 'PASS', 'fallback robusto presente');
  exception when others then
    perform pg_temp._p18_assistant_fix_record(4, 'assistant_list_messages role resolution usa current_setting com fallback auth.jwt', 'FAIL', sqlerrm);
  end;

  begin
    perform pg_temp._p18_assistant_fix_require(
      position('auth.uid() is null' in v_normalized_definition) > 0
      and position('membership_row.user_id = auth.uid()' in v_normalized_definition) > 0
      and position('membership_row.is_active is true' in v_normalized_definition) > 0,
      'authenticated gate markers diverged'
    );
    perform pg_temp._p18_assistant_fix_record(5, 'assistant_list_messages preserva gate authenticated por auth.uid e membership ativa', 'PASS', 'gate authenticated preservado');
  exception when others then
    perform pg_temp._p18_assistant_fix_record(5, 'assistant_list_messages preserva gate authenticated por auth.uid e membership ativa', 'FAIL', sqlerrm);
  end;

  begin
    perform pg_temp._p18_assistant_fix_require(
      pg_catalog.to_regprocedure('public.assistant_list_messages_paginated(uuid,uuid,integer,timestamp with time zone,uuid,timestamp with time zone,uuid)') is not null
      and has_function_privilege('authenticated', 'public.assistant_list_messages_paginated(uuid,uuid,integer,timestamp with time zone,uuid,timestamp with time zone,uuid)', 'EXECUTE')
      and not has_function_privilege('service_role', 'public.assistant_list_messages_paginated(uuid,uuid,integer,timestamp with time zone,uuid,timestamp with time zone,uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.assistant_list_messages_paginated(uuid,uuid,integer,timestamp with time zone,uuid,timestamp with time zone,uuid)', 'EXECUTE'),
      'assistant_list_messages_paginated relevant contract diverged'
    );
    perform pg_temp._p18_assistant_fix_record(6, 'assistant_list_messages_paginated permanece authenticated-only', 'PASS', 'ACL relevante do paginated preservado');
  exception when others then
    perform pg_temp._p18_assistant_fix_record(6, 'assistant_list_messages_paginated permanece authenticated-only', 'FAIL', sqlerrm);
  end;

  begin
    select * into v_exec
    from pg_temp._p18_assistant_fix_exec_count(
      'authenticated',
      v_user_a,
      v_org_a,
      v_store_a,
      'authenticated',
      'authenticated'
    );

    perform pg_temp._p18_assistant_fix_require(
      v_exec.operation_succeeded and v_exec.value_text = '2',
      'authenticated own-tenant read failed'
    );
    perform pg_temp._p18_assistant_fix_record(7, 'authenticated continua lendo apenas o proprio tenant', 'PASS', 'authenticated proprio tenant ok');
  exception when others then
    perform pg_temp._p18_assistant_fix_record(7, 'authenticated continua lendo apenas o proprio tenant', 'FAIL', sqlerrm);
  end;

  begin
    select * into v_exec
    from pg_temp._p18_assistant_fix_exec_count(
      'authenticated',
      v_user_a,
      v_org_b,
      v_store_b,
      'authenticated',
      'authenticated'
    );
    perform pg_temp._p18_assistant_fix_require(
      v_exec.operation_succeeded and v_exec.value_text = '0',
      'authenticated foreign-tenant read did not fail-close'
    );

    select * into v_exec
    from pg_temp._p18_assistant_fix_exec_count(
      'authenticated',
      v_user_inactive,
      v_org_a,
      v_store_a,
      'authenticated',
      'authenticated'
    );
    perform pg_temp._p18_assistant_fix_require(
      v_exec.operation_succeeded and v_exec.value_text = '0',
      'inactive membership read did not fail-close'
    );
    perform pg_temp._p18_assistant_fix_record(8, 'authenticated foreign tenant ou membership inativa retornam zero', 'PASS', 'foreign e inactive continuam fail-closed');
  exception when others then
    perform pg_temp._p18_assistant_fix_record(8, 'authenticated foreign tenant ou membership inativa retornam zero', 'FAIL', sqlerrm);
  end;

  begin
    select * into v_exec
    from pg_temp._p18_assistant_fix_exec_count(
      'service_role',
      null,
      v_org_a,
      v_store_a,
      'service_role',
      'service_role'
    );
    perform pg_temp._p18_assistant_fix_require(
      v_exec.operation_succeeded and v_exec.value_text = '2',
      'legacy service_role path failed'
    );
    perform pg_temp._p18_assistant_fix_record(9, 'service_role continua lendo pelo caminho legacy com request.jwt.claim.role', 'PASS', 'legacy service_role ok');
  exception when others then
    perform pg_temp._p18_assistant_fix_record(9, 'service_role continua lendo pelo caminho legacy com request.jwt.claim.role', 'FAIL', sqlerrm);
  end;

  begin
    select * into v_exec
    from pg_temp._p18_assistant_fix_exec_count(
      'service_role',
      null,
      v_org_a,
      v_store_a,
      '',
      'service_role'
    );
    perform pg_temp._p18_assistant_fix_require(
      v_exec.operation_succeeded and v_exec.value_text = '2',
      'auth.jwt fallback service_role path failed'
    );
    perform pg_temp._p18_assistant_fix_record(10, 'service_role agora le pelo fallback auth.jwt quando request.jwt.claim.role vem vazio', 'PASS', 'fallback auth.jwt ok');
  exception when others then
    perform pg_temp._p18_assistant_fix_record(10, 'service_role agora le pelo fallback auth.jwt quando request.jwt.claim.role vem vazio', 'FAIL', sqlerrm);
  end;
end;
$checks$;

do $gate$
declare
  v_total integer;
  v_non_pass integer;
begin
  select count(*) into v_total
  from pg_temp._p18_assistant_fix_results;

  if v_total <> 10 then
    raise exception using
      errcode = 'P0001',
      message = format('manual check failed: expected 10 scenarios but found %s', v_total);
  end if;

  select count(*) into v_non_pass
  from pg_temp._p18_assistant_fix_results
  where status <> 'PASS';

  if v_non_pass <> 0 then
    raise exception using
      errcode = 'P0001',
      message = format('manual check failed: %s scenarios did not pass', v_non_pass);
  end if;
end;
$gate$;

table pg_temp._p18_assistant_fix_results
order by scenario_number;

rollback;
