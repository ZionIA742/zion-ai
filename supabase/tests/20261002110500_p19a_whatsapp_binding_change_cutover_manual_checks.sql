begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p19a48_results (
  scenario text primary key,
  name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text
) on commit preserve rows;

create or replace function pg_temp._p19a48_record(
  p_scenario text,
  p_name text,
  p_status text,
  p_detail text default null
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p19a48_results(scenario, name, status, detail)
  values (p_scenario, p_name, p_status, p_detail)
  on conflict (scenario) do update
    set name = excluded.name,
        status = excluded.status,
        detail = excluded.detail;
end;
$function$;

create or replace function pg_temp._p19a48_uuid(p_seed text)
returns uuid
language sql
immutable
as $function$
  select (
    pg_catalog.substr(pg_catalog.md5(p_seed), 1, 8) || '-' ||
    pg_catalog.substr(pg_catalog.md5(p_seed), 9, 4) || '-' ||
    '4' || pg_catalog.substr(pg_catalog.md5(p_seed), 14, 3) || '-' ||
    '8' || pg_catalog.substr(pg_catalog.md5(p_seed), 18, 3) || '-' ||
    pg_catalog.substr(pg_catalog.md5(p_seed), 21, 12)
  )::uuid;
$function$;

create or replace function pg_temp._p19a48_store_fixture(p_seed text)
returns table (
  org_id uuid,
  store_id uuid
)
language plpgsql
as $function$
declare
  v_org uuid := pg_temp._p19a48_uuid('p19a48:' || p_seed || ':org');
  v_store uuid := pg_temp._p19a48_uuid('p19a48:' || p_seed || ':store');
begin
  insert into public.organizations(id, name, subscription_status)
  values (v_org, 'P19A 4.8 Org ' || p_seed, 'active');

  insert into public.stores(id, organization_id, name)
  values (v_store, v_org, 'P19A 4.8 Store ' || p_seed);

  return query select v_org, v_store;
end;
$function$;

create or replace function pg_temp._p19a48_insert_active(
  p_seed text,
  p_org_id uuid,
  p_store_id uuid,
  p_waba text,
  p_phone text,
  p_display text,
  p_token text
)
returns uuid
language plpgsql
as $function$
declare
  v_id uuid := pg_temp._p19a48_uuid('p19a48:' || p_seed || ':integration');
begin
  insert into public.external_integrations (
    id,
    organization_id,
    store_id,
    provider,
    status,
    is_active,
    display_phone_number,
    phone_number_id,
    whatsapp_business_account_id,
    access_token,
    last_error,
    metadata,
    updated_at
  )
  values (
    v_id,
    p_org_id,
    p_store_id,
    'whatsapp',
    'active',
    true,
    p_display,
    p_phone,
    p_waba,
    p_token,
    null,
    '{"runner":"p19a_4_8"}'::jsonb,
    pg_catalog.clock_timestamp()
  );

  return v_id;
end;
$function$;

create or replace function pg_temp._p19a48_insert_request(
  p_seed text,
  p_org_id uuid,
  p_store_id uuid,
  p_active_id uuid,
  p_candidate_waba text,
  p_candidate_phone text,
  p_candidate_display text,
  p_status text default 'ready_to_cutover',
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
as $function$
declare
  v_id uuid := pg_temp._p19a48_uuid('p19a48:' || p_seed || ':request');
begin
  insert into public.whatsapp_binding_change_requests (
    id,
    organization_id,
    store_id,
    provider,
    source,
    idempotency_key,
    status,
    active_integration_id,
    candidate_whatsapp_business_account_id,
    candidate_phone_number_id,
    candidate_display_phone_number,
    candidate_provenance,
    candidate_received_at,
    expires_at,
    created_at,
    updated_at
  )
  values (
    v_id,
    p_org_id,
    p_store_id,
    'whatsapp',
    'p19a_4_8_runner',
    'candidate:' || p_seed,
    p_status,
    p_active_id,
    p_candidate_waba,
    p_candidate_phone,
    p_candidate_display,
    '{"runner":"p19a_4_8"}'::jsonb,
    pg_catalog.clock_timestamp(),
    p_expires_at,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  );

  return v_id;
end;
$function$;

-- Structural preflight. Behavioral scenarios follow below.
do $preflight$
declare
  v_cutover pg_catalog.regprocedure :=
    'public.cutover_whatsapp_binding_change_request_by_system(uuid,uuid,text,uuid,text,uuid,text,text,text,jsonb)'::pg_catalog.regprocedure;
  v_cancel pg_catalog.regprocedure :=
    'public.cancel_whatsapp_binding_change_request_by_system(uuid,uuid,text,uuid,jsonb)'::pg_catalog.regprocedure;
  v_expire pg_catalog.regprocedure :=
    'public.expire_whatsapp_binding_change_request_by_system(uuid,uuid,text,uuid,jsonb)'::pg_catalog.regprocedure;
  v_definition text;
begin
  if pg_catalog.to_regclass('public.whatsapp_binding_change_requests') is null
     or pg_catalog.to_regclass('public.external_integrations') is null then
    raise exception 'P19A_4_8_PREFLIGHT_TABLE_MISSING';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'whatsapp_binding_change_requests'
       and column_name in (
         'active_phone_number_id_snapshot',
         'active_whatsapp_business_account_id_snapshot',
         'active_display_phone_number_snapshot',
         'expires_at',
         'cutover_idempotency_key',
         'completed_phone_number_id',
         'completed_whatsapp_business_account_id',
         'completed_display_phone_number',
         'completed_at',
         'terminal_at'
       )
     group by table_schema, table_name
    having count(*) = 10
  ) then
    raise exception 'P19A_4_8_PREFLIGHT_COLUMNS_MISSING';
  end if;

  if pg_catalog.to_regclass('public.whatsapp_binding_change_requests_cutover_key_uidx') is null
     or pg_catalog.to_regclass('public.whatsapp_binding_change_requests_active_uidx') is null
     or pg_catalog.to_regclass('public.external_integrations_whatsapp_phone_number_uidx') is null then
    raise exception 'P19A_4_8_PREFLIGHT_UNIQUENESS_MISSING';
  end if;

  if pg_catalog.to_regprocedure('public.snapshot_whatsapp_binding_change_active_by_system()') is null
     or pg_catalog.to_regprocedure('public.guard_whatsapp_binding_change_terminal_immutability_by_system()') is null
     or pg_catalog.to_regprocedure('public.materialize_store_whatsapp_embedded_signup_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)') is null
     or pg_catalog.to_regprocedure('public.advance_whatsapp_binding_change_request_by_system(uuid,uuid,uuid,text)') is null then
    raise exception 'P19A_4_8_PREFLIGHT_RPC_OR_GUARD_MISSING';
  end if;

  if not pg_catalog.has_function_privilege('service_role', v_cutover, 'execute')
     or not pg_catalog.has_function_privilege('service_role', v_cancel, 'execute')
     or not pg_catalog.has_function_privilege('service_role', v_expire, 'execute')
     or pg_catalog.has_function_privilege('anon', v_cutover, 'execute')
     or pg_catalog.has_function_privilege('authenticated', v_cutover, 'execute')
     or pg_catalog.has_function_privilege('anon', v_cancel, 'execute')
     or pg_catalog.has_function_privilege('authenticated', v_cancel, 'execute')
     or pg_catalog.has_function_privilege('anon', v_expire, 'execute')
     or pg_catalog.has_function_privilege('authenticated', v_expire, 'execute')
     or exists (
       select 1
         from pg_catalog.pg_proc proc_row
         cross join lateral pg_catalog.aclexplode(
           coalesce(proc_row.proacl, pg_catalog.acldefault('f', proc_row.proowner))
         ) acl_row
        where proc_row.oid in (v_cutover::oid, v_cancel::oid, v_expire::oid)
          and acl_row.grantee = 0
          and acl_row.privilege_type = 'EXECUTE'
     ) then
    raise exception 'P19A_4_8_PREFLIGHT_PRIVILEGES_INVALID';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_trigger
     where tgrelid = 'public.whatsapp_binding_change_requests'::pg_catalog.regclass
       and tgname = 'whatsapp_binding_change_active_snapshot_trg'
       and not tgisinternal
  ) or not exists (
    select 1
      from pg_catalog.pg_trigger
     where tgrelid = 'public.whatsapp_binding_change_requests'::pg_catalog.regclass
       and tgname = 'whatsapp_binding_change_terminal_immutability_trg'
       and not tgisinternal
  ) then
    raise exception 'P19A_4_8_PREFLIGHT_TRIGGER_MISSING';
  end if;

  select pg_catalog.pg_get_functiondef(v_cutover) into v_definition;
  if v_definition not ilike '%for update%'
     or v_definition not ilike '%completed_phone_number_id%'
     or v_definition not ilike '%ZION_WHATSAPP_CHANGE_WABA_CHANGE_REQUIRES_NEW_TOKEN%'
     or v_definition ilike '%p_access_token%'
     or v_definition ilike '%insert into public.external_integrations%' then
    raise exception 'P19A_4_8_PREFLIGHT_CUTOVER_CONTRACT_INVALID';
  end if;
end;
$preflight$;

-- A-D: happy path, old active before cutover, unique candidate active after,
-- completed request snapshots.
do $case$
declare
  c record;
  r record;
  v_active_id uuid;
  v_request_id uuid;
  v_before record;
  v_after record;
  v_req record;
  v_count integer;
begin
  select * into c from pg_temp._p19a48_store_fixture('A-D');
  v_active_id := pg_temp._p19a48_insert_active(
    'A-D', c.org_id, c.store_id,
    'waba-A', 'phone-A-old', '+55 11 90000-4801', 'runner-token-A'
  );
  v_request_id := pg_temp._p19a48_insert_request(
    'A-D', c.org_id, c.store_id, v_active_id,
    'waba-A', 'phone-A-new', '+55 11 90000-4802'
  );

  select phone_number_id, whatsapp_business_account_id, display_phone_number, access_token
    into v_before
    from public.external_integrations
   where id = v_active_id;

  perform pg_temp._p19a48_record(
    'B',
    'old active remains canonical before cutover',
    case
      when v_before.phone_number_id = 'phone-A-old'
       and v_before.whatsapp_business_account_id = 'waba-A'
       and v_before.access_token = 'runner-token-A'
      then 'PASS' else 'SUT_FAIL'
    end,
    pg_catalog.row_to_json(v_before)::text
  );

  select * into r
    from public.cutover_whatsapp_binding_change_request_by_system(
      c.org_id, c.store_id, 'whatsapp', v_request_id, 'cutover:A-D', v_active_id,
      'waba-A', 'phone-A-new', '+55 11 90000-4802',
      '{"source":"p19a_4_8_runner","scenario":"A-D"}'::jsonb
    );

  perform pg_temp._p19a48_record(
    'A',
    'cutover happy path',
    case
      when r.outcome = 'cutover_completed'
       and r.status = 'completed'
       and r.active_integration_id = v_active_id
       and r.phone_number_id = 'phone-A-new'
       and r.whatsapp_business_account_id = 'waba-A'
      then 'PASS' else 'SUT_FAIL'
    end,
    pg_catalog.row_to_json(r)::text
  );

  select phone_number_id, whatsapp_business_account_id, display_phone_number,
         access_token, status, is_active
    into v_after
    from public.external_integrations
   where id = v_active_id;

  select count(*) into v_count
    from public.external_integrations
   where organization_id = c.org_id
     and store_id = c.store_id
     and provider = 'whatsapp'
     and status = 'active'
     and is_active is true;

  perform pg_temp._p19a48_record(
    'C',
    'candidate becomes the sole active binding and token is preserved',
    case
      when v_count = 1
       and v_after.phone_number_id = 'phone-A-new'
       and v_after.whatsapp_business_account_id = 'waba-A'
       and v_after.display_phone_number = '+55 11 90000-4802'
       and v_after.access_token = 'runner-token-A'
       and v_after.status = 'active'
       and v_after.is_active is true
      then 'PASS' else 'SUT_FAIL'
    end,
    pg_catalog.row_to_json(v_after)::text || ' active_count=' || v_count::text
  );

  select * into v_req
    from public.whatsapp_binding_change_requests
   where id = v_request_id;

  perform pg_temp._p19a48_record(
    'D',
    'successful cutover completes request with immutable result snapshots',
    case
      when v_req.status = 'completed'
       and v_req.cutover_idempotency_key = 'cutover:A-D'
       and v_req.completed_phone_number_id = 'phone-A-new'
       and v_req.completed_whatsapp_business_account_id = 'waba-A'
       and v_req.completed_display_phone_number = '+55 11 90000-4802'
       and v_req.completed_at is not null
       and v_req.terminal_at is not null
      then 'PASS' else 'SUT_FAIL'
    end,
    'status=' || coalesce(v_req.status, '<null>')
  );
exception when others then
  perform pg_temp._p19a48_record('A', 'cutover happy path', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
  perform pg_temp._p19a48_record('B', 'old active remains canonical before cutover', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
  perform pg_temp._p19a48_record('C', 'candidate becomes the sole active binding and token is preserved', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
  perform pg_temp._p19a48_record('D', 'successful cutover completes request with immutable result snapshots', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$case$;

-- E: replay remains the original result even after a later cutover mutates the
-- same canonical external_integrations row.
do $case$
declare
  c record;
  r1 record;
  r2 record;
  replay record;
  v_active_id uuid;
  v_request1 uuid;
  v_request2 uuid;
  v_current_phone text;
begin
  select * into c from pg_temp._p19a48_store_fixture('E');
  v_active_id := pg_temp._p19a48_insert_active(
    'E', c.org_id, c.store_id,
    'waba-E', 'phone-E-old', '+55 11 90000-4810', 'runner-token-E'
  );

  v_request1 := pg_temp._p19a48_insert_request(
    'E-1', c.org_id, c.store_id, v_active_id,
    'waba-E', 'phone-E-one', '+55 11 90000-4811'
  );
  select * into r1
    from public.cutover_whatsapp_binding_change_request_by_system(
      c.org_id, c.store_id, 'whatsapp', v_request1, 'cutover:E-1', v_active_id,
      'waba-E', 'phone-E-one', '+55 11 90000-4811', '{"scenario":"E1"}'::jsonb
    );

  v_request2 := pg_temp._p19a48_insert_request(
    'E-2', c.org_id, c.store_id, v_active_id,
    'waba-E', 'phone-E-two', '+55 11 90000-4812'
  );
  select * into r2
    from public.cutover_whatsapp_binding_change_request_by_system(
      c.org_id, c.store_id, 'whatsapp', v_request2, 'cutover:E-2', v_active_id,
      'waba-E', 'phone-E-two', '+55 11 90000-4812', '{"scenario":"E2"}'::jsonb
    );

  select * into replay
    from public.cutover_whatsapp_binding_change_request_by_system(
      c.org_id, c.store_id, 'whatsapp', v_request1, 'cutover:E-1', v_active_id,
      'waba-E', 'phone-E-one', '+55 11 90000-4811', '{"scenario":"E1-replay"}'::jsonb
    );

  select phone_number_id into v_current_phone
    from public.external_integrations
   where id = v_active_id;

  perform pg_temp._p19a48_record(
    'E',
    'completed cutover replays its original result after later cutover',
    case
      when replay.outcome = 'idempotent_replay'
       and replay.status = 'completed'
       and replay.phone_number_id = 'phone-E-one'
       and replay.whatsapp_business_account_id = 'waba-E'
       and replay.display_phone_number = '+55 11 90000-4811'
       and v_current_phone = 'phone-E-two'
      then 'PASS' else 'SUT_FAIL'
    end,
    'replay=' || pg_catalog.row_to_json(replay)::text || ' current=' || coalesce(v_current_phone, '<null>')
  );
exception when others then
  perform pg_temp._p19a48_record('E', 'completed cutover replays its original result after later cutover', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$case$;

-- F: wrong expected candidate fails closed.
do $case$
declare
  c record;
  v_active_id uuid;
  v_request_id uuid;
  v_error text;
  v_phone text;
  v_status text;
begin
  select * into c from pg_temp._p19a48_store_fixture('F');
  v_active_id := pg_temp._p19a48_insert_active(
    'F', c.org_id, c.store_id,
    'waba-F', 'phone-F-old', '+55 11 90000-4820', 'runner-token-F'
  );
  v_request_id := pg_temp._p19a48_insert_request(
    'F', c.org_id, c.store_id, v_active_id,
    'waba-F', 'phone-F-new', '+55 11 90000-4821'
  );

  begin
    perform *
      from public.cutover_whatsapp_binding_change_request_by_system(
        c.org_id, c.store_id, 'whatsapp', v_request_id, 'cutover:F', v_active_id,
        'waba-F', 'phone-F-WRONG', '+55 11 90000-4821', '{}'::jsonb
      );
    v_error := 'unexpected success';
  exception when others then
    v_error := sqlerrm;
  end;

  select phone_number_id into v_phone from public.external_integrations where id = v_active_id;
  select status into v_status from public.whatsapp_binding_change_requests where id = v_request_id;

  perform pg_temp._p19a48_record(
    'F',
    'wrong candidate fails closed',
    case
      when v_error like '%EXPECTED_BINDING_MISMATCH%'
       and v_phone = 'phone-F-old'
       and v_status = 'ready_to_cutover'
      then 'PASS' else 'SUT_FAIL'
    end,
    coalesce(v_error, '<null>') || ' phone=' || coalesce(v_phone, '<null>') || ' status=' || coalesce(v_status, '<null>')
  );
exception when others then
  perform pg_temp._p19a48_record('F', 'wrong candidate fails closed', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$case$;

-- G-I: tenant/store/provider isolation.
do $case$
declare
  c record;
  v_active_id uuid;
  v_request_id uuid;
  v_other_store uuid := pg_temp._p19a48_uuid('p19a48:G:other-store');
  v_other_org uuid := pg_temp._p19a48_uuid('p19a48:H:other-org');
  v_error_g text;
  v_error_h text;
  v_error_i text;
  v_phone text;
begin
  select * into c from pg_temp._p19a48_store_fixture('G-I');
  insert into public.stores(id, organization_id, name)
  values (v_other_store, c.org_id, 'P19A 4.8 Other Store');

  insert into public.organizations(id, name, subscription_status)
  values (v_other_org, 'P19A 4.8 Other Org', 'active');

  v_active_id := pg_temp._p19a48_insert_active(
    'G-I', c.org_id, c.store_id,
    'waba-G', 'phone-G-old', '+55 11 90000-4830', 'runner-token-G'
  );
  v_request_id := pg_temp._p19a48_insert_request(
    'G-I', c.org_id, c.store_id, v_active_id,
    'waba-G', 'phone-G-new', '+55 11 90000-4831'
  );

  begin
    perform * from public.cutover_whatsapp_binding_change_request_by_system(
      c.org_id, v_other_store, 'whatsapp', v_request_id, 'cutover:G', v_active_id,
      'waba-G', 'phone-G-new', '+55 11 90000-4831', '{}'::jsonb
    );
    v_error_g := 'unexpected success';
  exception when others then v_error_g := sqlerrm; end;

  begin
    perform * from public.cutover_whatsapp_binding_change_request_by_system(
      v_other_org, c.store_id, 'whatsapp', v_request_id, 'cutover:H', v_active_id,
      'waba-G', 'phone-G-new', '+55 11 90000-4831', '{}'::jsonb
    );
    v_error_h := 'unexpected success';
  exception when others then v_error_h := sqlerrm; end;

  begin
    perform * from public.cutover_whatsapp_binding_change_request_by_system(
      c.org_id, c.store_id, 'telegram', v_request_id, 'cutover:I', v_active_id,
      'waba-G', 'phone-G-new', '+55 11 90000-4831', '{}'::jsonb
    );
    v_error_i := 'unexpected success';
  exception when others then v_error_i := sqlerrm; end;

  select phone_number_id into v_phone from public.external_integrations where id = v_active_id;

  perform pg_temp._p19a48_record(
    'G', 'other store fails closed',
    case when v_error_g like '%REQUEST_NOT_FOUND%' and v_phone = 'phone-G-old' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_error_g, '<null>')
  );
  perform pg_temp._p19a48_record(
    'H', 'other organization fails closed',
    case when v_error_h like '%REQUEST_NOT_FOUND%' and v_phone = 'phone-G-old' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_error_h, '<null>')
  );
  perform pg_temp._p19a48_record(
    'I', 'wrong provider fails closed',
    case when v_error_i like '%CUTOVER_INPUT_REQUIRED%' and v_phone = 'phone-G-old' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_error_i, '<null>')
  );
exception when others then
  perform pg_temp._p19a48_record('G', 'other store fails closed', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
  perform pg_temp._p19a48_record('H', 'other organization fails closed', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
  perform pg_temp._p19a48_record('I', 'wrong provider fails closed', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$case$;

-- J: stale active snapshot fails closed.
do $case$
declare
  c record;
  v_active_id uuid;
  v_request_id uuid;
  v_error text;
  v_phone text;
  v_status text;
begin
  select * into c from pg_temp._p19a48_store_fixture('J');
  v_active_id := pg_temp._p19a48_insert_active(
    'J', c.org_id, c.store_id,
    'waba-J', 'phone-J-old', '+55 11 90000-4840', 'runner-token-J'
  );
  v_request_id := pg_temp._p19a48_insert_request(
    'J', c.org_id, c.store_id, v_active_id,
    'waba-J', 'phone-J-candidate', '+55 11 90000-4841'
  );

  update public.external_integrations
     set phone_number_id = 'phone-J-changed',
         display_phone_number = '+55 11 90000-4849',
         updated_at = pg_catalog.clock_timestamp()
   where id = v_active_id;

  begin
    perform * from public.cutover_whatsapp_binding_change_request_by_system(
      c.org_id, c.store_id, 'whatsapp', v_request_id, 'cutover:J', v_active_id,
      'waba-J', 'phone-J-candidate', '+55 11 90000-4841', '{}'::jsonb
    );
    v_error := 'unexpected success';
  exception when others then v_error := sqlerrm; end;

  select phone_number_id into v_phone from public.external_integrations where id = v_active_id;
  select status into v_status from public.whatsapp_binding_change_requests where id = v_request_id;

  perform pg_temp._p19a48_record(
    'J',
    'stale active snapshot fails closed',
    case
      when v_error like '%ACTIVE_BINDING_STALE%'
       and v_phone = 'phone-J-changed'
       and v_status = 'ready_to_cutover'
      then 'PASS' else 'SUT_FAIL'
    end,
    coalesce(v_error, '<null>') || ' phone=' || coalesce(v_phone, '<null>')
  );
exception when others then
  perform pg_temp._p19a48_record('J', 'stale active snapshot fails closed', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$case$;

-- K: double attempt and structural serialization contract. A true multi-session
-- race is not fabricated by this single-session runner.
do $case$
declare
  c record;
  r record;
  v_active_id uuid;
  v_request_id uuid;
  v_error text;
  v_definition text;
  v_structural_ok boolean;
begin
  select * into c from pg_temp._p19a48_store_fixture('K');
  v_active_id := pg_temp._p19a48_insert_active(
    'K', c.org_id, c.store_id,
    'waba-K', 'phone-K-old', '+55 11 90000-4850', 'runner-token-K'
  );
  v_request_id := pg_temp._p19a48_insert_request(
    'K', c.org_id, c.store_id, v_active_id,
    'waba-K', 'phone-K-new', '+55 11 90000-4851'
  );

  select * into r from public.cutover_whatsapp_binding_change_request_by_system(
    c.org_id, c.store_id, 'whatsapp', v_request_id, 'cutover:K', v_active_id,
    'waba-K', 'phone-K-new', '+55 11 90000-4851', '{}'::jsonb
  );

  begin
    perform * from public.cutover_whatsapp_binding_change_request_by_system(
      c.org_id, c.store_id, 'whatsapp', v_request_id, 'cutover:K-DIFFERENT', v_active_id,
      'waba-K', 'phone-K-new', '+55 11 90000-4851', '{}'::jsonb
    );
    v_error := 'unexpected success';
  exception when others then v_error := sqlerrm; end;

  select pg_catalog.pg_get_functiondef(
    'public.cutover_whatsapp_binding_change_request_by_system(uuid,uuid,text,uuid,text,uuid,text,text,text,jsonb)'::pg_catalog.regprocedure
  ) into v_definition;

  v_structural_ok :=
    v_definition ilike '%for update%'
    and pg_catalog.to_regclass('public.whatsapp_binding_change_requests_active_uidx') is not null
    and pg_catalog.to_regclass('public.whatsapp_binding_change_requests_cutover_key_uidx') is not null
    and pg_catalog.to_regclass('public.external_integrations_whatsapp_phone_number_uidx') is not null;

  perform pg_temp._p19a48_record(
    'K',
    'double attempt is deterministic and serialization guards exist',
    case
      when r.status = 'completed'
       and v_error like '%CUTOVER_IDEMPOTENCY_CONFLICT%'
       and v_structural_ok
      then 'PASS' else 'SUT_FAIL'
    end,
    coalesce(v_error, '<null>') || ' structural=' || v_structural_ok::text ||
      ' (true parallel race not executed in single-session runner)'
  );
exception when others then
  perform pg_temp._p19a48_record('K', 'double attempt is deterministic and serialization guards exist', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$case$;

-- L-M: cancellation preserves active and replays idempotently.
do $case$
declare
  c record;
  r1 record;
  r2 record;
  v_active_id uuid;
  v_request_id uuid;
  v_phone text;
begin
  select * into c from pg_temp._p19a48_store_fixture('L-M');
  v_active_id := pg_temp._p19a48_insert_active(
    'L-M', c.org_id, c.store_id,
    'waba-L', 'phone-L-old', '+55 11 90000-4860', 'runner-token-L'
  );
  v_request_id := pg_temp._p19a48_insert_request(
    'L-M', c.org_id, c.store_id, v_active_id,
    'waba-L', 'phone-L-new', '+55 11 90000-4861'
  );

  select * into r1 from public.cancel_whatsapp_binding_change_request_by_system(
    c.org_id, c.store_id, 'whatsapp', v_request_id, '{"scenario":"L"}'::jsonb
  );
  select phone_number_id into v_phone from public.external_integrations where id = v_active_id;

  perform pg_temp._p19a48_record(
    'L',
    'cancellation preserves active binding',
    case when r1.status = 'cancelled' and r1.outcome = 'cancelled' and v_phone = 'phone-L-old'
      then 'PASS' else 'SUT_FAIL' end,
    pg_catalog.row_to_json(r1)::text || ' phone=' || coalesce(v_phone, '<null>')
  );

  select * into r2 from public.cancel_whatsapp_binding_change_request_by_system(
    c.org_id, c.store_id, 'whatsapp', v_request_id, '{"scenario":"M"}'::jsonb
  );

  perform pg_temp._p19a48_record(
    'M',
    'cancel replay is idempotent',
    case when r2.status = 'cancelled' and r2.outcome = 'idempotent_replay' and v_phone = 'phone-L-old'
      then 'PASS' else 'SUT_FAIL' end,
    pg_catalog.row_to_json(r2)::text
  );
exception when others then
  perform pg_temp._p19a48_record('L', 'cancellation preserves active binding', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
  perform pg_temp._p19a48_record('M', 'cancel replay is idempotent', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$case$;

-- N-O: expiry preserves active and blocks later cutover.
do $case$
declare
  c record;
  r record;
  v_active_id uuid;
  v_request_id uuid;
  v_phone text;
  v_error text;
begin
  select * into c from pg_temp._p19a48_store_fixture('N-O');
  v_active_id := pg_temp._p19a48_insert_active(
    'N-O', c.org_id, c.store_id,
    'waba-N', 'phone-N-old', '+55 11 90000-4870', 'runner-token-N'
  );
  v_request_id := pg_temp._p19a48_insert_request(
    'N-O', c.org_id, c.store_id, v_active_id,
    'waba-N', 'phone-N-new', '+55 11 90000-4871',
    'ready_to_cutover', pg_catalog.clock_timestamp() - interval '1 minute'
  );

  select * into r from public.expire_whatsapp_binding_change_request_by_system(
    c.org_id, c.store_id, 'whatsapp', v_request_id, '{"scenario":"N"}'::jsonb
  );
  select phone_number_id into v_phone from public.external_integrations where id = v_active_id;

  perform pg_temp._p19a48_record(
    'N',
    'expiry preserves active binding',
    case when r.status = 'expired' and r.outcome = 'expired' and v_phone = 'phone-N-old'
      then 'PASS' else 'SUT_FAIL' end,
    pg_catalog.row_to_json(r)::text || ' phone=' || coalesce(v_phone, '<null>')
  );

  begin
    perform * from public.cutover_whatsapp_binding_change_request_by_system(
      c.org_id, c.store_id, 'whatsapp', v_request_id, 'cutover:O', v_active_id,
      'waba-N', 'phone-N-new', '+55 11 90000-4871', '{}'::jsonb
    );
    v_error := 'unexpected success';
  exception when others then v_error := sqlerrm; end;

  perform pg_temp._p19a48_record(
    'O',
    'expired request cannot cut over',
    case when v_error like '%TERMINAL_REQUEST%' and v_phone = 'phone-N-old'
      then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_error, '<null>')
  );
exception when others then
  perform pg_temp._p19a48_record('N', 'expiry preserves active binding', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
  perform pg_temp._p19a48_record('O', 'expired request cannot cut over', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$case$;

-- P: terminal request cannot reopen through the 4.7 transition writer or direct
-- table mutation.
do $case$
declare
  c record;
  v_active_id uuid;
  v_request_id uuid;
  v_error_writer text;
  v_error_direct text;
  v_status text;
begin
  select * into c from pg_temp._p19a48_store_fixture('P');
  v_active_id := pg_temp._p19a48_insert_active(
    'P', c.org_id, c.store_id,
    'waba-P', 'phone-P-old', '+55 11 90000-4880', 'runner-token-P'
  );
  v_request_id := pg_temp._p19a48_insert_request(
    'P', c.org_id, c.store_id, v_active_id,
    'waba-P', 'phone-P-new', '+55 11 90000-4881'
  );
  perform * from public.cancel_whatsapp_binding_change_request_by_system(
    c.org_id, c.store_id, 'whatsapp', v_request_id, '{}'::jsonb
  );

  begin
    perform * from public.advance_whatsapp_binding_change_request_by_system(
      c.org_id, c.store_id, v_request_id, 'ready_to_cutover'
    );
    v_error_writer := 'unexpected success';
  exception when others then v_error_writer := sqlerrm; end;

  begin
    update public.whatsapp_binding_change_requests
       set status = 'ready_to_cutover'
     where id = v_request_id;
    v_error_direct := 'unexpected success';
  exception when others then v_error_direct := sqlerrm; end;

  select status into v_status from public.whatsapp_binding_change_requests where id = v_request_id;

  perform pg_temp._p19a48_record(
    'P',
    'terminal request cannot reopen',
    case
      when v_error_writer <> 'unexpected success'
       and v_error_direct like '%TERMINAL_IMMUTABLE%'
       and v_status = 'cancelled'
      then 'PASS' else 'SUT_FAIL'
    end,
    'writer=' || coalesce(v_error_writer, '<null>') ||
      ' direct=' || coalesce(v_error_direct, '<null>') ||
      ' status=' || coalesce(v_status, '<null>')
  );
exception when others then
  perform pg_temp._p19a48_record('P', 'terminal request cannot reopen', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$case$;

-- Q: failed attempt rolls back cleanly and a correct retry can complete.
do $case$
declare
  c record;
  r record;
  v_active_id uuid;
  v_request_id uuid;
  v_error text;
  v_phone_after_failure text;
  v_status_after_failure text;
begin
  select * into c from pg_temp._p19a48_store_fixture('Q');
  v_active_id := pg_temp._p19a48_insert_active(
    'Q', c.org_id, c.store_id,
    'waba-Q', 'phone-Q-old', '+55 11 90000-4890', 'runner-token-Q'
  );
  v_request_id := pg_temp._p19a48_insert_request(
    'Q', c.org_id, c.store_id, v_active_id,
    'waba-Q', 'phone-Q-new', '+55 11 90000-4891'
  );

  begin
    perform * from public.cutover_whatsapp_binding_change_request_by_system(
      c.org_id, c.store_id, 'whatsapp', v_request_id, 'cutover:Q', v_active_id,
      'waba-Q', 'phone-Q-WRONG', '+55 11 90000-4891', '{}'::jsonb
    );
    v_error := 'unexpected success';
  exception when others then v_error := sqlerrm; end;

  select phone_number_id into v_phone_after_failure from public.external_integrations where id = v_active_id;
  select status into v_status_after_failure from public.whatsapp_binding_change_requests where id = v_request_id;

  select * into r from public.cutover_whatsapp_binding_change_request_by_system(
    c.org_id, c.store_id, 'whatsapp', v_request_id, 'cutover:Q', v_active_id,
    'waba-Q', 'phone-Q-new', '+55 11 90000-4891', '{"scenario":"Q-retry"}'::jsonb
  );

  perform pg_temp._p19a48_record(
    'Q',
    'failed attempt preserves active and correct retry succeeds',
    case
      when v_error like '%EXPECTED_BINDING_MISMATCH%'
       and v_phone_after_failure = 'phone-Q-old'
       and v_status_after_failure = 'ready_to_cutover'
       and r.status = 'completed'
       and r.phone_number_id = 'phone-Q-new'
      then 'PASS' else 'SUT_FAIL'
    end,
    coalesce(v_error, '<null>') || ' retry=' || pg_catalog.row_to_json(r)::text
  );
exception when others then
  perform pg_temp._p19a48_record('Q', 'failed attempt preserves active and correct retry succeeds', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$case$;

-- R: secret-bearing provenance is rejected, and a safe cutover does not leak
-- the active token into response/provenance/metadata.
do $case$
declare
  c record;
  r record;
  v_active_id uuid;
  v_request_id uuid;
  v_error text;
  v_req record;
  v_meta jsonb;
  v_token text;
  v_leak boolean;
begin
  select * into c from pg_temp._p19a48_store_fixture('R');
  v_active_id := pg_temp._p19a48_insert_active(
    'R', c.org_id, c.store_id,
    'waba-R', 'phone-R-old', '+55 11 90000-4900', 'runner-token-R'
  );
  v_request_id := pg_temp._p19a48_insert_request(
    'R', c.org_id, c.store_id, v_active_id,
    'waba-R', 'phone-R-new', '+55 11 90000-4901'
  );

  begin
    perform * from public.cutover_whatsapp_binding_change_request_by_system(
      c.org_id, c.store_id, 'whatsapp', v_request_id, 'cutover:R', v_active_id,
      'waba-R', 'phone-R-new', '+55 11 90000-4901',
      '{"authorization_code":"must-not-persist"}'::jsonb
    );
    v_error := 'unexpected success';
  exception when others then v_error := sqlerrm; end;

  select * into r from public.cutover_whatsapp_binding_change_request_by_system(
    c.org_id, c.store_id, 'whatsapp', v_request_id, 'cutover:R', v_active_id,
    'waba-R', 'phone-R-new', '+55 11 90000-4901',
    '{"source":"p19a_4_8_runner","scenario":"R"}'::jsonb
  );

  select * into v_req from public.whatsapp_binding_change_requests where id = v_request_id;
  select metadata, access_token into v_meta, v_token from public.external_integrations where id = v_active_id;

  v_leak :=
    pg_catalog.strpos(pg_catalog.row_to_json(r)::text, 'runner-token-R') > 0
    or pg_catalog.strpos(coalesce(v_req.cutover_provenance, '{}'::jsonb)::text, 'runner-token-R') > 0
    or pg_catalog.strpos(coalesce(v_req.terminal_provenance, '{}'::jsonb)::text, 'runner-token-R') > 0
    or pg_catalog.strpos(coalesce(v_meta, '{}'::jsonb)::text, 'runner-token-R') > 0;

  perform pg_temp._p19a48_record(
    'R',
    'secret-bearing provenance is rejected and token does not leak',
    case
      when v_error like '%PROVENANCE_SECRET_FORBIDDEN%'
       and r.status = 'completed'
       and v_token = 'runner-token-R'
       and not v_leak
      then 'PASS' else 'SUT_FAIL'
    end,
    coalesce(v_error, '<null>') || ' leak=' || v_leak::text
  );
exception when others then
  perform pg_temp._p19a48_record('R', 'secret-bearing provenance is rejected and token does not leak', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$case$;

-- S: first connection remains on the pre-existing canonical Embedded Signup
-- writer and does not create a binding-change request.
do $case$
declare
  c record;
  r record;
  v_change_count integer;
  v_token text;
begin
  select * into c from pg_temp._p19a48_store_fixture('S');

  select * into r
    from public.materialize_store_whatsapp_embedded_signup_by_system(
      c.org_id,
      c.store_id,
      'waba-S',
      'phone-S-first',
      '+55 11 90000-4910',
      'runner-token-S',
      'v99.0',
      'p19a-4-8-runner',
      pg_catalog.clock_timestamp()
    );

  select count(*) into v_change_count
    from public.whatsapp_binding_change_requests
   where organization_id = c.org_id
     and store_id = c.store_id
     and provider = 'whatsapp';

  select access_token into v_token
    from public.external_integrations
   where id = r.integration_id;

  perform pg_temp._p19a48_record(
    'S',
    'first connection remains independent from binding-change cutover',
    case
      when r.outcome = 'inserted'
       and r.status = 'active'
       and r.is_active is true
       and r.phone_number_id = 'phone-S-first'
       and v_token = 'runner-token-S'
       and v_change_count = 0
      then 'PASS' else 'SUT_FAIL'
    end,
    pg_catalog.row_to_json(r)::text || ' change_requests=' || v_change_count::text
  );
exception when others then
  perform pg_temp._p19a48_record('S', 'first connection remains independent from binding-change cutover', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$case$;

-- Extra guard T: because 4.8 deliberately has no candidate-token storage, a
-- WABA change must fail closed rather than reuse a token from another WABA.
do $case$
declare
  c record;
  v_active_id uuid;
  v_request_id uuid;
  v_error text;
  v_phone text;
begin
  select * into c from pg_temp._p19a48_store_fixture('T');
  v_active_id := pg_temp._p19a48_insert_active(
    'T', c.org_id, c.store_id,
    'waba-T-old', 'phone-T-old', '+55 11 90000-4920', 'runner-token-T'
  );
  v_request_id := pg_temp._p19a48_insert_request(
    'T', c.org_id, c.store_id, v_active_id,
    'waba-T-new', 'phone-T-new', '+55 11 90000-4921'
  );

  begin
    perform * from public.cutover_whatsapp_binding_change_request_by_system(
      c.org_id, c.store_id, 'whatsapp', v_request_id, 'cutover:T', v_active_id,
      'waba-T-new', 'phone-T-new', '+55 11 90000-4921', '{}'::jsonb
    );
    v_error := 'unexpected success';
  exception when others then v_error := sqlerrm; end;

  select phone_number_id into v_phone from public.external_integrations where id = v_active_id;

  perform pg_temp._p19a48_record(
    'T',
    'different WABA cannot reuse active token',
    case when v_error like '%WABA_CHANGE_REQUIRES_NEW_TOKEN%' and v_phone = 'phone-T-old'
      then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_error, '<null>')
  );
exception when others then
  perform pg_temp._p19a48_record('T', 'different WABA cannot reuse active token', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$case$;

-- Extra guard U: supplied active snapshots cannot spoof the canonical active.
do $case$
declare
  c record;
  v_active_id uuid;
  v_request_id uuid := pg_temp._p19a48_uuid('p19a48:U:request');
  v_error text;
  v_count integer;
begin
  select * into c from pg_temp._p19a48_store_fixture('U');
  v_active_id := pg_temp._p19a48_insert_active(
    'U', c.org_id, c.store_id,
    'waba-U', 'phone-U-old', '+55 11 90000-4930', 'runner-token-U'
  );

  begin
    insert into public.whatsapp_binding_change_requests (
      id, organization_id, store_id, provider, source, idempotency_key, status,
      active_integration_id,
      candidate_whatsapp_business_account_id,
      candidate_phone_number_id,
      candidate_display_phone_number,
      candidate_provenance,
      active_phone_number_id_snapshot,
      active_whatsapp_business_account_id_snapshot,
      active_display_phone_number_snapshot,
      created_at, updated_at
    )
    values (
      v_request_id, c.org_id, c.store_id, 'whatsapp', 'p19a_4_8_runner',
      'candidate:U', 'ready_to_cutover', v_active_id,
      'waba-U', 'phone-U-new', '+55 11 90000-4931', '{}'::jsonb,
      'SPOOFED', 'waba-U', '+55 11 90000-4930',
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
    );
    v_error := 'unexpected success';
  exception when others then v_error := sqlerrm; end;

  select count(*) into v_count
    from public.whatsapp_binding_change_requests
   where id = v_request_id;

  perform pg_temp._p19a48_record(
    'U',
    'active snapshot cannot be spoofed on request insert',
    case when v_error like '%ACTIVE_SNAPSHOT_MISMATCH%' and v_count = 0
      then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_error, '<null>') || ' rows=' || v_count::text
  );
exception when others then
  perform pg_temp._p19a48_record('U', 'active snapshot cannot be spoofed on request insert', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$case$;

select scenario, name, status, detail
  from pg_temp._p19a48_results
 order by scenario;

select
  case
    when count(*) = 21 and count(*) filter (where status <> 'PASS') = 0
      then 'P19A_4_8_BEHAVIOR_RUNNER_PASS'
    else 'P19A_4_8_BEHAVIOR_RUNNER_FAIL'
  end as runner_result,
  count(*) as scenario_count,
  count(*) filter (where status = 'PASS') as pass_count,
  count(*) filter (where status = 'SUT_FAIL') as sut_fail_count,
  count(*) filter (where status = 'HARNESS_ERROR') as harness_error_count,
  coalesce(
    pg_catalog.string_agg(
      scenario || ':' || status,
      ', ' order by scenario
    ) filter (where status <> 'PASS'),
    'NONE'
  ) as failures,
  'K validates duplicate-attempt behavior plus structural serialization guards; it is not a true multi-session race.'::text as concurrency_note
from pg_temp._p19a48_results;

rollback;
