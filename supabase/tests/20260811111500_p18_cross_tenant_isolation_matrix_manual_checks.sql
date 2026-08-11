begin;

create temp table pg_temp._p18_cross_tenant_matrix (
  scenario_number integer primary key,
  scenario_name text not null
);

insert into pg_temp._p18_cross_tenant_matrix (scenario_number, scenario_name)
values
  (1, 'catalog import parent tables block inactive membership'),
  (2, 'catalog import child tables block inactive membership'),
  (3, 'operational direct tables block inactive membership'),
  (4, 'store_schedule_blocks update pivot own to foreign or mismatched scope is blocked'),
  (5, 'store_schedule_settings update pivot own to foreign or mismatched scope is blocked'),
  (6, 'store_discount_settings update pivot own to foreign or mismatched scope is blocked'),
  (7, 'assistant_list_messages blocks inactive membership'),
  (8, 'operational invoker rpcs close the foreign and inactive gaps'),
  (9, 'operational definer rpcs close the inactive gap'),
  (10, 'synthetic fixtures remain isolated inside the transaction');

create temp table pg_temp._p18_cross_tenant_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  details text not null
);

create temp table pg_temp._p18_cross_tenant_state (
  state_key text primary key,
  value_uuid uuid null,
  value_text text null
) on commit drop;

create or replace function pg_temp._p18_cross_tenant_record(
  p_scenario_number integer,
  p_status text,
  p_details text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p18_cross_tenant_results (
    scenario_number,
    scenario_name,
    status,
    details
  )
  values (
    p_scenario_number,
    (
      select matrix_row.scenario_name
      from pg_temp._p18_cross_tenant_matrix matrix_row
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

create or replace function pg_temp._p18_cross_tenant_require(
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

create or replace function pg_temp._p18_cross_tenant_sut_fail(
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

create or replace function pg_temp._p18_cross_tenant_harness_fail(
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

create or replace function pg_temp._p18_cross_tenant_raise_for_unexpected_exec_failure(
  p_sqlstate text,
  p_message text,
  p_sql text,
  p_context text
)
returns void
language plpgsql
as $function$
begin
  if coalesce(p_sqlstate, '') = any(
    array[
      '22023',
      '22P02',
      '42601',
      '42703',
      '42804',
      '42883',
      '42P01',
      '42P13'
    ]
  ) then
    perform pg_temp._p18_cross_tenant_harness_fail(
      format(
        '%s unexpected harness failure sqlstate=%s message=%s sql=%s',
        p_context,
        coalesce(p_sqlstate, '<null>'),
        coalesce(p_message, '<null>'),
        p_sql
      )
    );
  end if;

  perform pg_temp._p18_cross_tenant_sut_fail(
    format(
      '%s unexpected execution failure sqlstate=%s message=%s sql=%s',
      p_context,
      coalesce(p_sqlstate, '<null>'),
      coalesce(p_message, '<null>'),
      p_sql
    )
  );
end;
$function$;

create or replace function pg_temp._p18_cross_tenant_record_exception(
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

  perform pg_temp._p18_cross_tenant_record(
    p_scenario_number,
    v_status,
    coalesce(v_details, '<null>')
  );
end;
$function$;

create or replace function pg_temp._p18_cross_tenant_set_auth(
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

create or replace function pg_temp._p18_cross_tenant_reset_auth()
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

create or replace function pg_temp._p18_cross_tenant_exec(
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
  perform pg_temp._p18_cross_tenant_set_auth(p_role, p_user_id);

  begin
    execute p_sql into v_value;
    perform pg_temp._p18_cross_tenant_reset_auth();
    return query select true, v_value, null::text, null::text;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;

      perform pg_temp._p18_cross_tenant_reset_auth();
      return query select false, null::text, v_state, v_message;
  end;
end;
$function$;

create or replace function pg_temp._p18_cross_tenant_assert_success(
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
  from pg_temp._p18_cross_tenant_exec(p_role, p_user_id, p_sql);

  if not coalesce(v_exec.operation_succeeded, false) then
    perform pg_temp._p18_cross_tenant_raise_for_unexpected_exec_failure(
      v_exec.returned_sqlstate,
      v_exec.message_text,
      p_sql,
      'expected success'
    );
  end if;

  if p_expected_value is not null and v_exec.value_text is distinct from p_expected_value then
    perform pg_temp._p18_cross_tenant_sut_fail(
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

create or replace function pg_temp._p18_cross_tenant_assert_failure(
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
  from pg_temp._p18_cross_tenant_exec(p_role, p_user_id, p_sql);

  if coalesce(v_exec.operation_succeeded, false) then
    perform pg_temp._p18_cross_tenant_sut_fail(
      format('expected failure but operation succeeded sql=%s', p_sql)
    );
  end if;

  if v_exec.returned_sqlstate is distinct from p_expected_sqlstate then
    perform pg_temp._p18_cross_tenant_raise_for_unexpected_exec_failure(
      v_exec.returned_sqlstate,
      format(
        'expected sqlstate=%s actual=%s message=%s',
        p_expected_sqlstate,
        coalesce(v_exec.returned_sqlstate, '<null>'),
        coalesce(v_exec.message_text, '<null>')
      ),
      p_sql,
      'expected specific failure'
    );
  end if;
end;
$function$;

create or replace function pg_temp._p18_cross_tenant_assert_failure_in(
  p_role text,
  p_user_id uuid,
  p_sql text,
  p_expected_sqlstates text[]
)
returns void
language plpgsql
as $function$
declare
  v_exec record;
begin
  select * into v_exec
  from pg_temp._p18_cross_tenant_exec(p_role, p_user_id, p_sql);

  if coalesce(v_exec.operation_succeeded, false) then
    perform pg_temp._p18_cross_tenant_sut_fail(
      format('expected failure but operation succeeded sql=%s', p_sql)
    );
  end if;

  if not (coalesce(v_exec.returned_sqlstate, '') = any(p_expected_sqlstates)) then
    perform pg_temp._p18_cross_tenant_raise_for_unexpected_exec_failure(
      v_exec.returned_sqlstate,
      format(
        'expected_one_of=%s actual=%s message=%s',
        array_to_string(p_expected_sqlstates, ','),
        coalesce(v_exec.returned_sqlstate, '<null>'),
        coalesce(v_exec.message_text, '<null>')
      ),
      p_sql,
      'expected one of specific failures'
    );
  end if;
end;
$function$;

create or replace function pg_temp._p18_cross_tenant_assert_value_or_failure(
  p_role text,
  p_user_id uuid,
  p_sql text,
  p_expected_value text,
  p_expected_sqlstates text[]
)
returns void
language plpgsql
as $function$
declare
  v_exec record;
begin
  select * into v_exec
  from pg_temp._p18_cross_tenant_exec(p_role, p_user_id, p_sql);

  if coalesce(v_exec.operation_succeeded, false) then
    if v_exec.value_text is distinct from p_expected_value then
      perform pg_temp._p18_cross_tenant_sut_fail(
        format(
          'unexpected success value expected=%s actual=%s sql=%s',
          p_expected_value,
          coalesce(v_exec.value_text, '<null>'),
          p_sql
        )
      );
    end if;

    return;
  end if;

  if not (coalesce(v_exec.returned_sqlstate, '') = any(p_expected_sqlstates)) then
    perform pg_temp._p18_cross_tenant_raise_for_unexpected_exec_failure(
      v_exec.returned_sqlstate,
      format(
        'expected_value=%s or_one_of=%s actual=%s message=%s',
        p_expected_value,
        array_to_string(p_expected_sqlstates, ','),
        coalesce(v_exec.returned_sqlstate, '<null>'),
        coalesce(v_exec.message_text, '<null>')
      ),
      p_sql,
      'expected blocked mutation'
    );
  end if;
end;
$function$;

create or replace function pg_temp._p18_cross_tenant_assert_value_or_failure_contract(
  p_role text,
  p_user_id uuid,
  p_sql text,
  p_expected_value text,
  p_expected_sqlstates text[],
  p_expected_failures jsonb default '[]'::jsonb
)
returns void
language plpgsql
as $function$
declare
  v_exec record;
  v_expected_failure jsonb;
begin
  select * into v_exec
  from pg_temp._p18_cross_tenant_exec(p_role, p_user_id, p_sql);

  if coalesce(v_exec.operation_succeeded, false) then
    if v_exec.value_text is distinct from p_expected_value then
      perform pg_temp._p18_cross_tenant_sut_fail(
        format(
          'unexpected success value expected=%s actual=%s sql=%s',
          p_expected_value,
          coalesce(v_exec.value_text, '<null>'),
          p_sql
        )
      );
    end if;

    return;
  end if;

  if coalesce(v_exec.returned_sqlstate, '') = any(p_expected_sqlstates) then
    return;
  end if;

  for v_expected_failure in
    select value
    from jsonb_array_elements(coalesce(p_expected_failures, '[]'::jsonb))
  loop
    if coalesce(v_exec.returned_sqlstate, '') = coalesce(v_expected_failure->>'sqlstate', '')
       and coalesce(v_exec.message_text, '') = coalesce(v_expected_failure->>'message', '') then
      return;
    end if;
  end loop;

  perform pg_temp._p18_cross_tenant_raise_for_unexpected_exec_failure(
    v_exec.returned_sqlstate,
    format(
      'expected_value=%s or_one_of=%s or_contracts=%s actual=%s message=%s',
      p_expected_value,
      array_to_string(p_expected_sqlstates, ','),
      coalesce(p_expected_failures::text, '[]'),
      coalesce(v_exec.returned_sqlstate, '<null>'),
      coalesce(v_exec.message_text, '<null>')
    ),
    p_sql,
    'expected blocked mutation'
  );
end;
$function$;

create or replace function pg_temp._p18_cross_tenant_uuid(
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
  from pg_temp._p18_cross_tenant_state state_row
  where state_row.state_key = p_state_key;

  if v_value is null then
    perform pg_temp._p18_cross_tenant_harness_fail(
      format('missing uuid state for key %s', p_state_key)
    );
  end if;

  return v_value;
end;
$function$;

create or replace function pg_temp._p18_cross_tenant_text(
  p_state_key text
)
returns text
language plpgsql
as $function$
declare
  v_value text;
begin
  select state_row.value_text
  into v_value
  from pg_temp._p18_cross_tenant_state state_row
  where state_row.state_key = p_state_key;

  if v_value is null then
    perform pg_temp._p18_cross_tenant_harness_fail(
      format('missing text state for key %s', p_state_key)
    );
  end if;

  return v_value;
end;
$function$;

do $setup$
declare
  v_run_id uuid := gen_random_uuid();
  v_run_token text := 'p18_cross_tenant_' || replace(gen_random_uuid()::text, '-', '');
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_store_a uuid := gen_random_uuid();
  v_store_b uuid := gen_random_uuid();
  v_store_b_pivot uuid := gen_random_uuid();
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_user_inactive uuid := gen_random_uuid();
  v_lead_a uuid := gen_random_uuid();
  v_lead_b uuid := gen_random_uuid();
  v_conversation_a uuid := gen_random_uuid();
  v_conversation_b uuid := gen_random_uuid();
  v_catalog_item_a uuid := gen_random_uuid();
  v_catalog_item_b uuid := gen_random_uuid();
  v_import_file_a uuid := gen_random_uuid();
  v_import_file_b uuid := gen_random_uuid();
  v_pool_a uuid := gen_random_uuid();
  v_pool_b uuid := gen_random_uuid();
  v_catalog_photo_a uuid := gen_random_uuid();
  v_catalog_photo_b uuid := gen_random_uuid();
  v_pool_photo_a uuid := gen_random_uuid();
  v_pool_photo_b uuid := gen_random_uuid();
  v_import_file_item_a uuid := gen_random_uuid();
  v_import_file_item_b uuid := gen_random_uuid();
  v_appointment_a uuid := gen_random_uuid();
  v_appointment_b uuid := gen_random_uuid();
  v_block_a uuid := gen_random_uuid();
  v_block_b uuid := gen_random_uuid();
  v_task_a uuid := gen_random_uuid();
  v_task_b uuid := gen_random_uuid();
  v_thread_a uuid := gen_random_uuid();
  v_thread_b uuid := gen_random_uuid();
  v_message_a_old uuid := gen_random_uuid();
  v_message_a_new uuid := gen_random_uuid();
  v_message_b uuid := gen_random_uuid();
  v_event_type_key text;
begin
  insert into public.organizations (id, name)
  values
    (v_org_a, 'P18 Cross Tenant Org A ' || v_run_token),
    (v_org_b, 'P18 Cross Tenant Org B ' || v_run_token);

  insert into public.stores (id, organization_id, name)
  values
    (v_store_a, v_org_a, 'P18 Cross Tenant Store A ' || v_run_token),
    (v_store_b, v_org_b, 'P18 Cross Tenant Store B ' || v_run_token),
    (v_store_b_pivot, v_org_b, 'P18 Cross Tenant Store B Pivot ' || v_run_token);

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

  insert into public.leads (id, organization_id, store_id, state, created_at, updated_at)
  values
    (v_lead_a, v_org_a, v_store_a, 'negociacao', now(), now()),
    (v_lead_b, v_org_b, v_store_b, 'negociacao', now(), now());

  insert into public.conversations (id, organization_id, lead_id, status, is_human_active, created_at)
  values
    (v_conversation_a, v_org_a, v_lead_a, 'open', false, now()),
    (v_conversation_b, v_org_b, v_lead_b, 'open', false, now());

  insert into public.store_catalog_items (
    id,
    organization_id,
    store_id,
    sku,
    name,
    description,
    price_cents,
    price_status,
    currency,
    is_active,
    track_stock,
    stock_quantity,
    stock_status,
    metadata
  )
  values
    (
      v_catalog_item_a,
      v_org_a,
      v_store_a,
      'P18-CT-A-' || left(v_run_token, 10),
      'Catalog A ' || v_run_token,
      'fixture',
      1000,
      'valid',
      'BRL',
      true,
      false,
      null,
      'not_tracked',
      jsonb_build_object('runner', v_run_token)
    ),
    (
      v_catalog_item_b,
      v_org_b,
      v_store_b,
      'P18-CT-B-' || left(v_run_token, 10),
      'Catalog B ' || v_run_token,
      'fixture',
      2000,
      'valid',
      'BRL',
      true,
      false,
      null,
      'not_tracked',
      jsonb_build_object('runner', v_run_token)
    );

  insert into public.pools (
    id,
    organization_id,
    store_id,
    name,
    width_m,
    length_m,
    depth_m,
    shape,
    material,
    max_capacity_l,
    weight_kg,
    price,
    price_status,
    description,
    is_active,
    track_stock,
    stock_quantity,
    stock_status
  )
  values
    (
      v_pool_a,
      v_org_a,
      v_store_a,
      'Pool A ' || v_run_token,
      2,
      3,
      1,
      'retangular',
      'vinil',
      1000,
      200,
      5000,
      'valid',
      'fixture',
      true,
      false,
      null,
      'not_tracked'
    ),
    (
      v_pool_b,
      v_org_b,
      v_store_b,
      'Pool B ' || v_run_token,
      2,
      3,
      1,
      'retangular',
      'vinil',
      1000,
      200,
      6000,
      'valid',
      'fixture',
      true,
      false,
      null,
      'not_tracked'
    );

  insert into public.store_import_files (
    id,
    organization_id,
    store_id,
    source,
    original_file_name,
    mime_type,
    extension,
    size_bytes,
    storage_bucket,
    storage_path,
    import_summary,
    status,
    import_batch_id,
    file_hash
  )
  values
    (
      v_import_file_a,
      v_org_a,
      v_store_a,
      'runner',
      'seed-a-' || v_run_token || '.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'xlsx',
      123,
      'store-import-files',
      v_org_a::text || '/' || v_store_a::text || '/' || v_run_token || '-seed-a.xlsx',
      jsonb_build_object('runner', v_run_token),
      'active',
      gen_random_uuid(),
      null
    ),
    (
      v_import_file_b,
      v_org_b,
      v_store_b,
      'runner',
      'seed-b-' || v_run_token || '.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'xlsx',
      456,
      'store-import-files',
      v_org_b::text || '/' || v_store_b::text || '/' || v_run_token || '-seed-b.xlsx',
      jsonb_build_object('runner', v_run_token),
      'active',
      gen_random_uuid(),
      null
    );

  insert into public.store_catalog_item_photos (
    id,
    catalog_item_id,
    file_name,
    file_size_bytes,
    sort_order,
    storage_path
  )
  values
    (
      v_catalog_photo_a,
      v_catalog_item_a,
      'seed-catalog-a-' || v_run_token || '.jpg',
      100,
      0,
      v_org_a::text || '/' || v_store_a::text || '/' || v_run_token || '-catalog-a.jpg'
    ),
    (
      v_catalog_photo_b,
      v_catalog_item_b,
      'seed-catalog-b-' || v_run_token || '.jpg',
      100,
      0,
      v_org_b::text || '/' || v_store_b::text || '/' || v_run_token || '-catalog-b.jpg'
    );

  insert into public.pool_photos (
    id,
    organization_id,
    store_id,
    pool_id,
    file_name,
    file_size_bytes,
    sort_order,
    storage_path
  )
  values
    (
      v_pool_photo_a,
      v_org_a,
      v_store_a,
      v_pool_a,
      'seed-pool-a-' || v_run_token || '.jpg',
      100,
      0,
      v_org_a::text || '/' || v_store_a::text || '/' || v_run_token || '-pool-a.jpg'
    ),
    (
      v_pool_photo_b,
      v_org_b,
      v_store_b,
      v_pool_b,
      'seed-pool-b-' || v_run_token || '.jpg',
      100,
      0,
      v_org_b::text || '/' || v_store_b::text || '/' || v_run_token || '-pool-b.jpg'
    );

  insert into public.store_import_file_items (
    id,
    import_file_id,
    organization_id,
    store_id,
    destination_type,
    destination_table,
    destination_item_id
  )
  values
    (
      v_import_file_item_a,
      v_import_file_a,
      v_org_a,
      v_store_a,
      'catalog_item',
      'store_catalog_items',
      v_catalog_item_a
    ),
    (
      v_import_file_item_b,
      v_import_file_b,
      v_org_b,
      v_store_b,
      'pool',
      'pools',
      v_pool_b
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
      'fixture-a'
    ),
    (
      v_org_b,
      v_store_b,
      true,
      false,
      1,
      false,
      false,
      '["wednesday"]'::jsonb,
      '{"wednesday":{"start":"08:00","end":"18:00"}}'::jsonb,
      '["wednesday"]'::jsonb,
      'queue_next_day',
      'America/Sao_Paulo',
      'fixture-b'
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
      now() - interval '10 minute'
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
      now() - interval '1 minute'
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
      now() - interval '3 minute'
    );

  insert into pg_temp._p18_cross_tenant_state (state_key, value_uuid, value_text) values
    ('run_id', v_run_id, null),
    ('run_token', null, v_run_token),
    ('org_a', v_org_a, null),
    ('org_b', v_org_b, null),
    ('store_a', v_store_a, null),
    ('store_b', v_store_b, null),
    ('store_b_pivot', v_store_b_pivot, null),
    ('user_a', v_user_a, null),
    ('user_b', v_user_b, null),
    ('user_inactive', v_user_inactive, null),
    ('lead_a', v_lead_a, null),
    ('lead_b', v_lead_b, null),
    ('conversation_a', v_conversation_a, null),
    ('conversation_b', v_conversation_b, null),
    ('catalog_item_a', v_catalog_item_a, null),
    ('catalog_item_b', v_catalog_item_b, null),
    ('import_file_a', v_import_file_a, null),
    ('import_file_b', v_import_file_b, null),
    ('pool_a', v_pool_a, null),
    ('pool_b', v_pool_b, null),
    ('catalog_photo_a', v_catalog_photo_a, null),
    ('catalog_photo_b', v_catalog_photo_b, null),
    ('pool_photo_a', v_pool_photo_a, null),
    ('pool_photo_b', v_pool_photo_b, null),
    ('import_file_item_a', v_import_file_item_a, null),
    ('import_file_item_b', v_import_file_item_b, null),
    ('appointment_a', v_appointment_a, null),
    ('appointment_b', v_appointment_b, null),
    ('block_a', v_block_a, null),
    ('block_b', v_block_b, null),
    ('task_a', v_task_a, null),
    ('task_b', v_task_b, null),
    ('thread_a', v_thread_a, null),
    ('thread_b', v_thread_b, null),
    ('event_type_key', null, v_event_type_key);
exception
  when others then
    perform pg_temp._p18_cross_tenant_record(10, 'HARNESS_ERROR', 'setup failed: ' || sqlerrm);
    raise;
end;
$setup$;

do $scenario_1$
declare
  v_user_inactive uuid := pg_temp._p18_cross_tenant_uuid('user_inactive');
  v_org_a uuid := pg_temp._p18_cross_tenant_uuid('org_a');
  v_store_a uuid := pg_temp._p18_cross_tenant_uuid('store_a');
  v_run_token text := pg_temp._p18_cross_tenant_text('run_token');
begin
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format('select count(*)::text from public.store_catalog_items where organization_id = %L::uuid and store_id = %L::uuid', v_org_a, v_store_a),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      with updated as (
        update public.store_catalog_items
        set description = 'inactive-update'
        where id = %L::uuid
        returning id
      )
      select count(*)::text from updated
    $sql$, pg_temp._p18_cross_tenant_uuid('catalog_item_a')),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      with deleted as (
        delete from public.store_catalog_items
        where id = %L::uuid
        returning id
      )
      select count(*)::text from deleted
    $sql$, pg_temp._p18_cross_tenant_uuid('catalog_item_a')),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      insert into public.store_catalog_items (
        id, organization_id, store_id, sku, name, description, price_cents, price_status, currency, is_active, track_stock, stock_quantity, stock_status, metadata
      ) values (
        gen_random_uuid(), %L::uuid, %L::uuid, %L, %L, 'inactive', 1000, 'valid', 'BRL', true, false, null, 'not_tracked', '{}'::jsonb
      )
    $sql$, v_org_a, v_store_a, 'inactive-catalog-' || v_run_token, 'Inactive Catalog ' || v_run_token),
    '42501'
  );

  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format('select count(*)::text from public.store_import_files where organization_id = %L::uuid and store_id = %L::uuid', v_org_a, v_store_a),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      with updated as (
        update public.store_import_files
        set original_file_name = 'inactive-update.pdf'
        where id = %L::uuid
        returning id
      )
      select count(*)::text from updated
    $sql$, pg_temp._p18_cross_tenant_uuid('import_file_a')),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      with deleted as (
        delete from public.store_import_files
        where id = %L::uuid
        returning id
      )
      select count(*)::text from deleted
    $sql$, pg_temp._p18_cross_tenant_uuid('import_file_a')),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      insert into public.store_import_files (
        id, organization_id, store_id, source, original_file_name, mime_type, extension, size_bytes, storage_bucket, storage_path, import_summary, status, import_batch_id, file_hash
      ) values (
        gen_random_uuid(), %L::uuid, %L::uuid, 'runner', %L, 'application/pdf', 'pdf', 10, 'store-import-files', %L, '{}'::jsonb, 'active', gen_random_uuid(), null
      )
    $sql$, v_org_a, v_store_a, 'inactive-file-' || v_run_token || '.pdf', v_org_a::text || '/' || v_store_a::text || '/' || v_run_token || '-inactive.pdf'),
    '42501'
  );

  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format('select count(*)::text from public.pools where organization_id = %L::uuid and store_id = %L::uuid', v_org_a, v_store_a),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      with updated as (
        update public.pools
        set description = 'inactive-update'
        where id = %L::uuid
        returning id
      )
      select count(*)::text from updated
    $sql$, pg_temp._p18_cross_tenant_uuid('pool_a')),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      with deleted as (
        delete from public.pools
        where id = %L::uuid
        returning id
      )
      select count(*)::text from deleted
    $sql$, pg_temp._p18_cross_tenant_uuid('pool_a')),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      insert into public.pools (
        id, organization_id, store_id, name, width_m, length_m, depth_m, shape, material, max_capacity_l, weight_kg, price, price_status, description, is_active, track_stock, stock_quantity, stock_status
      ) values (
        gen_random_uuid(), %L::uuid, %L::uuid, %L, 2, 3, 1, 'retangular', 'vinil', 1000, 200, 5000, 'valid', 'inactive', true, false, null, 'not_tracked'
      )
    $sql$, v_org_a, v_store_a, 'Inactive Pool ' || v_run_token),
    '42501'
  );

  perform pg_temp._p18_cross_tenant_record(1, 'PASS', 'inactive membership hides parent rows, keeps update/delete invisible and blocks authenticated inserts on store_catalog_items, store_import_files and pools');
exception
  when others then
    perform pg_temp._p18_cross_tenant_record_exception(1, sqlerrm);
end;
$scenario_1$;

do $scenario_2$
declare
  v_user_inactive uuid := pg_temp._p18_cross_tenant_uuid('user_inactive');
  v_org_a uuid := pg_temp._p18_cross_tenant_uuid('org_a');
  v_store_a uuid := pg_temp._p18_cross_tenant_uuid('store_a');
  v_catalog_item_a uuid := pg_temp._p18_cross_tenant_uuid('catalog_item_a');
  v_pool_a uuid := pg_temp._p18_cross_tenant_uuid('pool_a');
  v_import_file_a uuid := pg_temp._p18_cross_tenant_uuid('import_file_a');
  v_run_token text := pg_temp._p18_cross_tenant_text('run_token');
begin
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format('select count(*)::text from public.store_catalog_item_photos where id = %L::uuid', pg_temp._p18_cross_tenant_uuid('catalog_photo_a')),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      with updated as (
        update public.store_catalog_item_photos
        set file_name = 'inactive-update.jpg'
        where id = %L::uuid
        returning id
      )
      select count(*)::text from updated
    $sql$, pg_temp._p18_cross_tenant_uuid('catalog_photo_a')),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      with deleted as (
        delete from public.store_catalog_item_photos
        where id = %L::uuid
        returning id
      )
      select count(*)::text from deleted
    $sql$, pg_temp._p18_cross_tenant_uuid('catalog_photo_a')),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      insert into public.store_catalog_item_photos (
        id, catalog_item_id, file_name, file_size_bytes, sort_order, storage_path
      ) values (
        gen_random_uuid(), %L::uuid, %L, 100, 0, %L
      )
    $sql$, v_catalog_item_a, 'inactive-catalog-photo-' || v_run_token || '.jpg', v_org_a::text || '/' || v_store_a::text || '/' || v_run_token || '-inactive-catalog-photo.jpg'),
    '42501'
  );

  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format('select count(*)::text from public.pool_photos where id = %L::uuid', pg_temp._p18_cross_tenant_uuid('pool_photo_a')),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      with updated as (
        update public.pool_photos
        set file_name = 'inactive-update.jpg'
        where id = %L::uuid
        returning id
      )
      select count(*)::text from updated
    $sql$, pg_temp._p18_cross_tenant_uuid('pool_photo_a')),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      with deleted as (
        delete from public.pool_photos
        where id = %L::uuid
        returning id
      )
      select count(*)::text from deleted
    $sql$, pg_temp._p18_cross_tenant_uuid('pool_photo_a')),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      insert into public.pool_photos (
        id, organization_id, store_id, pool_id, file_name, file_size_bytes, sort_order, storage_path
      ) values (
        gen_random_uuid(), %L::uuid, %L::uuid, %L::uuid, %L, 100, 0, %L
      )
    $sql$, v_org_a, v_store_a, v_pool_a, 'inactive-pool-photo-' || v_run_token || '.jpg', v_org_a::text || '/' || v_store_a::text || '/' || v_run_token || '-inactive-pool-photo.jpg'),
    '42501'
  );

  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format('select count(*)::text from public.store_import_file_items where id = %L::uuid', pg_temp._p18_cross_tenant_uuid('import_file_item_a')),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      with updated as (
        update public.store_import_file_items
        set destination_type = 'catalog_item'
        where id = %L::uuid
        returning id
      )
      select count(*)::text from updated
    $sql$, pg_temp._p18_cross_tenant_uuid('import_file_item_a')),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      with deleted as (
        delete from public.store_import_file_items
        where id = %L::uuid
        returning id
      )
      select count(*)::text from deleted
    $sql$, pg_temp._p18_cross_tenant_uuid('import_file_item_a')),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      insert into public.store_import_file_items (
        id, import_file_id, organization_id, store_id, destination_type, destination_table, destination_item_id
      ) values (
        gen_random_uuid(), %L::uuid, %L::uuid, %L::uuid, 'catalog_item', 'store_catalog_items', %L::uuid
      )
    $sql$, v_import_file_a, v_org_a, v_store_a, v_catalog_item_a),
    '42501'
  );

  perform pg_temp._p18_cross_tenant_record(2, 'PASS', 'inactive membership hides child rows, keeps update/delete invisible and blocks authenticated inserts on store_catalog_item_photos, pool_photos and store_import_file_items');
exception
  when others then
    perform pg_temp._p18_cross_tenant_record_exception(2, sqlerrm);
end;
$scenario_2$;

do $scenario_3$
declare
  v_user_inactive uuid := pg_temp._p18_cross_tenant_uuid('user_inactive');
  v_org_a uuid := pg_temp._p18_cross_tenant_uuid('org_a');
  v_store_a uuid := pg_temp._p18_cross_tenant_uuid('store_a');
  v_block_a uuid := pg_temp._p18_cross_tenant_uuid('block_a');
  v_run_token text := pg_temp._p18_cross_tenant_text('run_token');
begin
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format('select count(*)::text from public.store_appointments where id = %L::uuid', pg_temp._p18_cross_tenant_uuid('appointment_a')),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      insert into public.store_appointments (
        id, organization_id, store_id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id
      ) values (
        gen_random_uuid(), %L::uuid, %L::uuid, %L, 'technical_visit', 'scheduled', now() + interval '1 day', now() + interval '1 day 1 hour', 'Inactive Runner', null, 'Rua Inactive', 'inactive', null, null
      )
    $sql$, v_org_a, v_store_a, 'Inactive Appointment ' || v_run_token),
    '42501'
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      with updated as (
        update public.store_appointments
        set notes = 'inactive-update'
        where id = %L::uuid
        returning id
      )
      select count(*)::text from updated
    $sql$, pg_temp._p18_cross_tenant_uuid('appointment_a')),
    '0'
  );

  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format('select count(*)::text from public.store_schedule_blocks where id = %L::uuid', v_block_a),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      with updated as (
        update public.store_schedule_blocks
        set notes = 'inactive-update'
        where id = %L::uuid
        returning id
      )
      select count(*)::text from updated
    $sql$, v_block_a),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      with deleted as (
        delete from public.store_schedule_blocks
        where id = %L::uuid
        returning id
      )
      select count(*)::text from deleted
    $sql$, v_block_a),
    '0'
  );

  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format('select count(*)::text from public.store_schedule_settings where organization_id = %L::uuid and store_id = %L::uuid', v_org_a, v_store_a),
    '0'
  );
  perform pg_temp._p18_cross_tenant_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      insert into public.store_schedule_settings (
        organization_id, store_id, allow_multiple_appointments_per_day, allow_same_time_appointments, same_time_capacity, attends_holidays, enforce_operating_window, operating_days, operating_hours, installation_days, after_hours_behavior, timezone_name, notes
      ) values (
        %L::uuid, %L::uuid, true, false, 1, false, false, '["monday"]'::jsonb, '{"monday":{"start":"08:00","end":"18:00"}}'::jsonb, '["monday"]'::jsonb, 'queue_next_day', 'America/Sao_Paulo', 'inactive-insert'
      )
    $sql$, v_org_a, v_store_a),
    '42501'
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      with updated as (
        update public.store_schedule_settings
        set notes = 'inactive-update'
        where organization_id = %L::uuid
          and store_id = %L::uuid
        returning store_id
      )
      select count(*)::text from updated
    $sql$, v_org_a, v_store_a),
    '0'
  );

  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format('select count(*)::text from public.store_assistant_operational_tasks where id = %L::uuid', pg_temp._p18_cross_tenant_uuid('task_a')),
    '0'
  );

  perform pg_temp._p18_cross_tenant_record(3, 'PASS', 'inactive membership blocks only the authenticated operations actually exposed on appointments, schedule blocks, schedule settings and operational tasks');
exception
  when others then
    perform pg_temp._p18_cross_tenant_record_exception(3, sqlerrm);
end;
$scenario_3$;

do $scenario_4$
declare
  v_user_a uuid := pg_temp._p18_cross_tenant_uuid('user_a');
  v_org_a uuid := pg_temp._p18_cross_tenant_uuid('org_a');
  v_org_b uuid := pg_temp._p18_cross_tenant_uuid('org_b');
  v_store_a uuid := pg_temp._p18_cross_tenant_uuid('store_a');
  v_store_b_pivot uuid := pg_temp._p18_cross_tenant_uuid('store_b_pivot');
  v_block_a uuid := pg_temp._p18_cross_tenant_uuid('block_a');
begin
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_a,
    format('select count(*)::text from public.store_schedule_blocks where id = %L::uuid', v_block_a),
    '1'
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.store_schedule_blocks
        set notes = 'positive-control-block'
        where id = %L::uuid
        returning id
      )
      select count(*)::text from updated
    $sql$, v_block_a),
    '1'
  );
  perform pg_temp._p18_cross_tenant_assert_failure_in(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.store_schedule_blocks
        set organization_id = %L::uuid, store_id = %L::uuid
        where id = %L::uuid
        returning id
      )
      select count(*)::text from updated
    $sql$, v_org_b, v_store_b_pivot, v_block_a),
    array['42501']
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'service_role',
    null,
    format('select count(*)::text from public.store_schedule_blocks where id = %L::uuid and organization_id = %L::uuid and store_id = %L::uuid', v_block_a, v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_cross_tenant_assert_failure_in(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.store_schedule_blocks
        set organization_id = %L::uuid, store_id = %L::uuid
        where id = %L::uuid
        returning id
      )
      select count(*)::text from updated
    $sql$, v_org_a, v_store_b_pivot, v_block_a),
    array['42501', '23503', '23514']
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'service_role',
    null,
    format('select count(*)::text from public.store_schedule_blocks where id = %L::uuid and organization_id = %L::uuid and store_id = %L::uuid', v_block_a, v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_cross_tenant_assert_failure_in(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.store_schedule_blocks
        set organization_id = %L::uuid, store_id = %L::uuid
        where id = %L::uuid
        returning id
      )
      select count(*)::text from updated
    $sql$, v_org_b, v_store_a, v_block_a),
    array['42501', '23503', '23514']
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'service_role',
    null,
    format('select count(*)::text from public.store_schedule_blocks where id = %L::uuid and organization_id = %L::uuid and store_id = %L::uuid', v_block_a, v_org_a, v_store_a),
    '1'
  );

  perform pg_temp._p18_cross_tenant_record(4, 'PASS', 'store_schedule_blocks proves own-row reachability first, then blocks real foreign and mismatched pivots while preserving the original tenant row');
exception
  when others then
    perform pg_temp._p18_cross_tenant_record_exception(4, sqlerrm);
end;
$scenario_4$;

do $scenario_5$
declare
  v_user_a uuid := pg_temp._p18_cross_tenant_uuid('user_a');
  v_org_a uuid := pg_temp._p18_cross_tenant_uuid('org_a');
  v_org_b uuid := pg_temp._p18_cross_tenant_uuid('org_b');
  v_store_a uuid := pg_temp._p18_cross_tenant_uuid('store_a');
  v_store_b_pivot uuid := pg_temp._p18_cross_tenant_uuid('store_b_pivot');
begin
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_a,
    format('select count(*)::text from public.store_schedule_settings where organization_id = %L::uuid and store_id = %L::uuid', v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.store_schedule_settings
        set notes = 'positive-control-settings'
        where organization_id = %L::uuid
          and store_id = %L::uuid
        returning store_id
      )
      select count(*)::text from updated
    $sql$, v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_cross_tenant_assert_failure_in(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.store_schedule_settings
        set organization_id = %L::uuid, store_id = %L::uuid
        where organization_id = %L::uuid
          and store_id = %L::uuid
        returning store_id
      )
      select count(*)::text from updated
    $sql$, v_org_b, v_store_b_pivot, v_org_a, v_store_a),
    array['42501']
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'service_role',
    null,
    format('select count(*)::text from public.store_schedule_settings where organization_id = %L::uuid and store_id = %L::uuid', v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_cross_tenant_assert_failure_in(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.store_schedule_settings
        set organization_id = %L::uuid, store_id = %L::uuid
        where organization_id = %L::uuid
          and store_id = %L::uuid
        returning store_id
      )
      select count(*)::text from updated
    $sql$, v_org_a, v_store_b_pivot, v_org_a, v_store_a),
    array['42501', '23503', '23514']
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'service_role',
    null,
    format('select count(*)::text from public.store_schedule_settings where organization_id = %L::uuid and store_id = %L::uuid', v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_cross_tenant_assert_failure_in(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.store_schedule_settings
        set organization_id = %L::uuid, store_id = %L::uuid
        where organization_id = %L::uuid
          and store_id = %L::uuid
        returning store_id
      )
      select count(*)::text from updated
    $sql$, v_org_b, v_store_a, v_org_a, v_store_a),
    array['42501', '23503', '23514']
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'service_role',
    null,
    format('select count(*)::text from public.store_schedule_settings where organization_id = %L::uuid and store_id = %L::uuid', v_org_a, v_store_a),
    '1'
  );

  perform pg_temp._p18_cross_tenant_record(5, 'PASS', 'store_schedule_settings proves own-row reachability first, then blocks real foreign and mismatched pivots without relying on duplicate-row collisions');
exception
  when others then
    perform pg_temp._p18_cross_tenant_record_exception(5, sqlerrm);
end;
$scenario_5$;

do $scenario_6$
declare
  v_user_a uuid := pg_temp._p18_cross_tenant_uuid('user_a');
  v_org_a uuid := pg_temp._p18_cross_tenant_uuid('org_a');
  v_org_b uuid := pg_temp._p18_cross_tenant_uuid('org_b');
  v_store_a uuid := pg_temp._p18_cross_tenant_uuid('store_a');
  v_store_b_pivot uuid := pg_temp._p18_cross_tenant_uuid('store_b_pivot');
begin
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_a,
    format('select count(*)::text from public.store_discount_settings where organization_id = %L::uuid and store_id = %L::uuid', v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.store_discount_settings
        set default_discount_percent = default_discount_percent + 0.01
        where organization_id = %L::uuid
          and store_id = %L::uuid
        returning store_id
      )
      select count(*)::text from updated
    $sql$, v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_cross_tenant_assert_failure_in(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.store_discount_settings
        set organization_id = %L::uuid, store_id = %L::uuid
        where organization_id = %L::uuid
          and store_id = %L::uuid
        returning store_id
      )
      select count(*)::text from updated
    $sql$, v_org_b, v_store_b_pivot, v_org_a, v_store_a),
    array['42501']
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'service_role',
    null,
    format('select count(*)::text from public.store_discount_settings where organization_id = %L::uuid and store_id = %L::uuid', v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_cross_tenant_assert_failure_in(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.store_discount_settings
        set organization_id = %L::uuid, store_id = %L::uuid
        where organization_id = %L::uuid
          and store_id = %L::uuid
        returning store_id
      )
      select count(*)::text from updated
    $sql$, v_org_a, v_store_b_pivot, v_org_a, v_store_a),
    array['42501', '23503', '23514']
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'service_role',
    null,
    format('select count(*)::text from public.store_discount_settings where organization_id = %L::uuid and store_id = %L::uuid', v_org_a, v_store_a),
    '1'
  );
  perform pg_temp._p18_cross_tenant_assert_failure_in(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.store_discount_settings
        set organization_id = %L::uuid, store_id = %L::uuid
        where organization_id = %L::uuid
          and store_id = %L::uuid
        returning store_id
      )
      select count(*)::text from updated
    $sql$, v_org_b, v_store_a, v_org_a, v_store_a),
    array['42501', '23503', '23514']
  );
  perform pg_temp._p18_cross_tenant_assert_success(
    'service_role',
    null,
    format('select count(*)::text from public.store_discount_settings where organization_id = %L::uuid and store_id = %L::uuid', v_org_a, v_store_a),
    '1'
  );

  perform pg_temp._p18_cross_tenant_record(6, 'PASS', 'store_discount_settings proves own-row reachability first, then blocks real foreign and mismatched pivots without relying on duplicate-row collisions');
exception
  when others then
    perform pg_temp._p18_cross_tenant_record_exception(6, sqlerrm);
end;
$scenario_6$;

do $scenario_7$
declare
  v_user_inactive uuid := pg_temp._p18_cross_tenant_uuid('user_inactive');
  v_org_a uuid := pg_temp._p18_cross_tenant_uuid('org_a');
  v_store_a uuid := pg_temp._p18_cross_tenant_uuid('store_a');
begin
  perform pg_temp._p18_cross_tenant_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      select count(*)::text
      from public.assistant_list_messages(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_limit => 30
      )
    $sql$, v_org_a, v_store_a),
    '0'
  );

  perform pg_temp._p18_cross_tenant_record(7, 'PASS', 'assistant_list_messages keeps the inactive-membership caller fail-closed without reopening thread data');
exception
  when others then
    perform pg_temp._p18_cross_tenant_record_exception(7, sqlerrm);
end;
$scenario_7$;

do $scenario_8$
declare
  v_user_a uuid := pg_temp._p18_cross_tenant_uuid('user_a');
  v_user_inactive uuid := pg_temp._p18_cross_tenant_uuid('user_inactive');
  v_org_a uuid := pg_temp._p18_cross_tenant_uuid('org_a');
  v_org_b uuid := pg_temp._p18_cross_tenant_uuid('org_b');
  v_store_a uuid := pg_temp._p18_cross_tenant_uuid('store_a');
  v_store_b uuid := pg_temp._p18_cross_tenant_uuid('store_b');
  v_appointment_a uuid := pg_temp._p18_cross_tenant_uuid('appointment_a');
  v_appointment_b uuid := pg_temp._p18_cross_tenant_uuid('appointment_b');
  v_block_a uuid := pg_temp._p18_cross_tenant_uuid('block_a');
  v_block_b uuid := pg_temp._p18_cross_tenant_uuid('block_b');
begin
  -- RPC create_store_appointment: 3.3 proved own success; 3.6 closes foreign and inactive denial.
  perform pg_temp._p18_cross_tenant_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.create_store_appointment(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_lead_id => null,
        p_conversation_id => null,
        p_title => 'Foreign RPC Appointment',
        p_appointment_type => 'technical_visit',
        p_status => 'scheduled',
        p_scheduled_start => now() + interval '8 day',
        p_scheduled_end => now() + interval '8 day 1 hour',
        p_customer_name => 'Foreign',
        p_customer_phone => null,
        p_address_text => 'Rua Foreign',
        p_notes => 'foreign',
        p_source => 'panel',
        p_created_by_user_id => null
      )
    $sql$, v_org_b, v_store_b),
    '42501'
  );
  perform pg_temp._p18_cross_tenant_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      select count(*)::text
      from public.create_store_appointment(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_lead_id => null,
        p_conversation_id => null,
        p_title => 'Inactive RPC Appointment',
        p_appointment_type => 'technical_visit',
        p_status => 'scheduled',
        p_scheduled_start => now() + interval '8 day',
        p_scheduled_end => now() + interval '8 day 1 hour',
        p_customer_name => 'Inactive',
        p_customer_phone => null,
        p_address_text => 'Rua Inactive',
        p_notes => 'inactive',
        p_source => 'panel',
        p_created_by_user_id => null
      )
    $sql$, v_org_a, v_store_a),
    '42501'
  );

  -- RPC update_store_appointment: 3.3 proved own success; 3.6 closes foreign and inactive denial.
  perform pg_temp._p18_cross_tenant_assert_value_or_failure_contract(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.update_store_appointment(
        p_appointment_id => %L::uuid,
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_title => 'Foreign Update',
        p_appointment_type => 'technical_visit',
        p_status => 'rescheduled',
        p_scheduled_start => now() + interval '9 day',
        p_scheduled_end => now() + interval '9 day 1 hour',
        p_customer_name => 'Foreign',
        p_customer_phone => null,
        p_address_text => 'Rua Foreign',
        p_notes => 'foreign'
      )
    $sql$, v_appointment_b, v_org_b, v_store_b),
    '0',
    array['42501'],
    jsonb_build_array(
      jsonb_build_object(
        'sqlstate', 'P0001',
        'message', 'Compromisso não encontrado para esta organização/loja.'
      )
    )
  );
  perform pg_temp._p18_cross_tenant_assert_value_or_failure_contract(
    'authenticated',
    v_user_inactive,
    format($sql$
      select count(*)::text
      from public.update_store_appointment(
        p_appointment_id => %L::uuid,
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_title => 'Inactive Update',
        p_appointment_type => 'technical_visit',
        p_status => 'rescheduled',
        p_scheduled_start => now() + interval '9 day',
        p_scheduled_end => now() + interval '9 day 1 hour',
        p_customer_name => 'Inactive',
        p_customer_phone => null,
        p_address_text => 'Rua Inactive',
        p_notes => 'inactive'
      )
    $sql$, v_appointment_a, v_org_a, v_store_a),
    '0',
    array['42501'],
    jsonb_build_array(
      jsonb_build_object(
        'sqlstate', 'P0001',
        'message', 'Compromisso não encontrado para esta organização/loja.'
      )
    )
  );

  -- RPC cancel_store_appointment: 3.3 proved own success; 3.6 closes foreign and inactive denial.
  perform pg_temp._p18_cross_tenant_assert_value_or_failure_contract(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.cancel_store_appointment(
        p_appointment_id => %L::uuid,
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_cancel_reason => 'foreign'
      )
    $sql$, v_appointment_b, v_org_b, v_store_b),
    '0',
    array['42501'],
    jsonb_build_array(
      jsonb_build_object(
        'sqlstate', 'P0001',
        'message', 'Compromisso não encontrado para esta organização/loja.'
      )
    )
  );
  perform pg_temp._p18_cross_tenant_assert_value_or_failure_contract(
    'authenticated',
    v_user_inactive,
    format($sql$
      select count(*)::text
      from public.cancel_store_appointment(
        p_appointment_id => %L::uuid,
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_cancel_reason => 'inactive'
      )
    $sql$, v_appointment_a, v_org_a, v_store_a),
    '0',
    array['42501'],
    jsonb_build_array(
      jsonb_build_object(
        'sqlstate', 'P0001',
        'message', 'Compromisso não encontrado para esta organização/loja.'
      )
    )
  );

  -- RPC update_store_schedule_block: 3.3 proved own success; 3.6 closes foreign and inactive denial.
  perform pg_temp._p18_cross_tenant_assert_value_or_failure_contract(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from public.update_store_schedule_block(
        p_block_id => %L::uuid,
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_title => 'Foreign Block',
        p_block_type => 'manual_block',
        p_start_at => now() + interval '10 day',
        p_end_at => now() + interval '10 day 2 hour',
        p_notes => 'foreign'
      )
    $sql$, v_block_b, v_org_b, v_store_b),
    '0',
    array['42501'],
    jsonb_build_array(
      jsonb_build_object(
        'sqlstate', 'P0001',
        'message', 'Bloqueio não encontrado para esta organização/loja.'
      )
    )
  );
  perform pg_temp._p18_cross_tenant_assert_value_or_failure_contract(
    'authenticated',
    v_user_inactive,
    format($sql$
      select count(*)::text
      from public.update_store_schedule_block(
        p_block_id => %L::uuid,
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_title => 'Inactive Block',
        p_block_type => 'manual_block',
        p_start_at => now() + interval '10 day',
        p_end_at => now() + interval '10 day 2 hour',
        p_notes => 'inactive'
      )
    $sql$, v_block_a, v_org_a, v_store_a),
    '0',
    array['42501'],
    jsonb_build_array(
      jsonb_build_object(
        'sqlstate', 'P0001',
        'message', 'Bloqueio não encontrado para esta organização/loja.'
      )
    )
  );

  -- RPC delete_store_schedule_block: 3.3 proved own success; 3.6 closes foreign and inactive denial.
  perform pg_temp._p18_cross_tenant_assert_value_or_failure_contract(
    'authenticated',
    v_user_a,
    format($sql$
      select public.delete_store_schedule_block(
        p_block_id => %L::uuid,
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid
      )::text
    $sql$, v_block_b, v_org_b, v_store_b),
    'false',
    array['42501'],
    jsonb_build_array(
      jsonb_build_object(
        'sqlstate', 'P0001',
        'message', 'Bloqueio não encontrado para esta organização/loja.'
      )
    )
  );
  perform pg_temp._p18_cross_tenant_assert_value_or_failure_contract(
    'authenticated',
    v_user_inactive,
    format($sql$
      select public.delete_store_schedule_block(
        p_block_id => %L::uuid,
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid
      )::text
    $sql$, v_block_a, v_org_a, v_store_a),
    'false',
    array['42501'],
    jsonb_build_array(
      jsonb_build_object(
        'sqlstate', 'P0001',
        'message', 'Bloqueio não encontrado para esta organização/loja.'
      )
    )
  );

  -- RPC upsert_store_schedule_settings: 3.3 proved own success; 3.6 closes foreign and inactive denial.
  perform pg_temp._p18_cross_tenant_assert_value_or_failure(
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
        p_notes => 'foreign-rpc'
      ) is not null)::text
    $sql$, v_org_b, v_store_b),
    'false',
    array['42501']
  );
  perform pg_temp._p18_cross_tenant_assert_value_or_failure(
    'authenticated',
    v_user_inactive,
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
        p_notes => 'inactive-rpc'
      ) is not null)::text
    $sql$, v_org_a, v_store_a),
    'false',
    array['42501']
  );

  perform pg_temp._p18_cross_tenant_record(8, 'PASS', '3.6 closes the foreign and inactive gaps for the six operational invoker RPCs previously proven only in-tenant');
exception
  when others then
    perform pg_temp._p18_cross_tenant_record_exception(8, sqlerrm);
end;
$scenario_8$;

do $scenario_9$
declare
  v_user_inactive uuid := pg_temp._p18_cross_tenant_uuid('user_inactive');
  v_org_a uuid := pg_temp._p18_cross_tenant_uuid('org_a');
  v_store_a uuid := pg_temp._p18_cross_tenant_uuid('store_a');
  v_appointment_a uuid := pg_temp._p18_cross_tenant_uuid('appointment_a');
  v_lead_a uuid := pg_temp._p18_cross_tenant_uuid('lead_a');
  v_conversation_a uuid := pg_temp._p18_cross_tenant_uuid('conversation_a');
  v_event_type_key text := pg_temp._p18_cross_tenant_text('event_type_key');
begin
  -- RPC create_store_schedule_block_allow_existing_appointments: 3.3 proved own and foreign; 3.6 closes the inactive gap.
  perform pg_temp._p18_cross_tenant_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      select count(*)::text
      from public.create_store_schedule_block_allow_existing_appointments(
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_title => 'Inactive Definer Block',
        p_block_type => 'manual_block',
        p_start_at => now() + interval '11 day',
        p_end_at => now() + interval '11 day 1 hour',
        p_notes => 'inactive',
        p_source => 'panel',
        p_created_by_user_id => null
      )
    $sql$, v_org_a, v_store_a),
    '42501'
  );

  -- RPC complete_store_appointment_with_outcome: 3.3 proved own and foreign; 3.6 closes the inactive gap.
  perform pg_temp._p18_cross_tenant_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      select count(*)::text
      from public.complete_store_appointment_with_outcome(
        p_appointment_id => %L::uuid,
        p_organization_id => %L::uuid,
        p_store_id => %L::uuid,
        p_completion_outcome => 'fully_completed',
        p_completion_note => 'inactive'
      )
    $sql$, v_appointment_a, v_org_a, v_store_a),
    '42501'
  );

  -- RPC get_latest_conversation_for_lead: 3.3 proved own and foreign; 3.6 closes the inactive gap.
  perform pg_temp._p18_cross_tenant_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      select public.get_latest_conversation_for_lead(
        p_organization_id => %L::uuid,
        p_lead_id => %L::uuid
      )::text
    $sql$, v_org_a, v_lead_a),
    '42501'
  );

  -- RPC log_schedule_conversation_event: 3.3 proved own and foreign; 3.6 closes the inactive gap.
  perform pg_temp._p18_cross_tenant_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      select public.log_schedule_conversation_event(
        p_organization_id => %L::uuid,
        p_conversation_id => %L::uuid,
        p_event_type => %L,
        p_created_by => 'inactive',
        p_payload => '{}'::jsonb
      )
    $sql$, v_org_a, v_conversation_a, v_event_type_key),
    '42501'
  );

  perform pg_temp._p18_cross_tenant_record(9, 'PASS', '3.6 closes the inactive-membership gap for the exposed operational SECURITY DEFINER RPCs');
exception
  when others then
    perform pg_temp._p18_cross_tenant_record_exception(9, sqlerrm);
end;
$scenario_9$;

do $scenario_10$
declare
  v_run_token text := pg_temp._p18_cross_tenant_text('run_token');
  v_fixture_count integer;
begin
  select count(*)
  into v_fixture_count
  from (
    select 1 from public.organizations where name = 'P18 Cross Tenant Org A ' || v_run_token
    union all
    select 1 from public.organizations where name = 'P18 Cross Tenant Org B ' || v_run_token
    union all
    select 1 from public.store_catalog_items where name = 'Catalog A ' || v_run_token
    union all
    select 1 from public.pools where name = 'Pool A ' || v_run_token
    union all
    select 1 from public.store_appointments where title = 'Runner Appointment A ' || v_run_token
    union all
    select 1 from public.store_assistant_threads where title = 'Runner Thread A ' || v_run_token
  ) fixture_rows;

  perform pg_temp._p18_cross_tenant_require(length(v_run_token) > 20, 'run token is unexpectedly short');
  perform pg_temp._p18_cross_tenant_require(v_fixture_count = 6, format('expected 6 fixture signatures, found %s', v_fixture_count));
  perform pg_temp._p18_cross_tenant_record(10, 'PASS', 'fixtures remain synthetic and isolated inside the transaction; final cleanup is delegated to the rollback below');
exception
  when others then
    perform pg_temp._p18_cross_tenant_record_exception(10, sqlerrm);
end;
$scenario_10$;

select
  result_row.scenario_number,
  result_row.scenario_name,
  result_row.status,
  result_row.details
from pg_temp._p18_cross_tenant_results result_row
order by result_row.scenario_number;

with matrix_summary as (
  select count(*) as expected_scenarios
  from pg_temp._p18_cross_tenant_matrix
),
scenario_summary as (
  select
    count(*) as emitted_scenarios,
    count(*) filter (where status = 'PASS') as passed_scenarios,
    count(*) filter (where status = 'SUT_FAIL') as sut_failed_scenarios,
    count(*) filter (where status = 'HARNESS_ERROR') as harness_error_scenarios,
    count(*) filter (where status <> 'PASS') as failed_scenarios,
    string_agg(
      scenario_number::text,
      ', ' order by scenario_number
    ) filter (where status <> 'PASS') as failing_scenarios,
    string_agg(
      status,
      ' | ' order by scenario_number
    ) filter (where status <> 'PASS') as failing_statuses,
    string_agg(
      format(
        'scenario=%s | status=%s | details=%s',
        scenario_number,
        status,
        details
      ),
      ' || ' order by scenario_number
    ) filter (where status <> 'PASS') as failing_details
  from pg_temp._p18_cross_tenant_results
)
select
  case
    when scenario_summary.emitted_scenarios <> matrix_summary.expected_scenarios then 'AINDA_NAO_APROVADA'
    when scenario_summary.passed_scenarios <> matrix_summary.expected_scenarios then 'AINDA_NAO_APROVADA'
    when scenario_summary.sut_failed_scenarios <> 0 then 'AINDA_NAO_APROVADA'
    when scenario_summary.harness_error_scenarios <> 0 then 'AINDA_NAO_APROVADA'
    else 'APROVADA'
  end as final_status,
  matrix_summary.expected_scenarios as total,
  scenario_summary.emitted_scenarios as emitted,
  scenario_summary.passed_scenarios as pass,
  scenario_summary.failed_scenarios as fail,
  scenario_summary.sut_failed_scenarios as sut_fail,
  scenario_summary.harness_error_scenarios as harness_error,
  scenario_summary.failing_scenarios,
  scenario_summary.failing_statuses,
  scenario_summary.failing_details
from matrix_summary
cross join scenario_summary;

rollback;
