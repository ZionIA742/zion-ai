begin;



set local lock_timeout = '5s';

set local statement_timeout = '300s';

set local idle_in_transaction_session_timeout = '300s';

set local search_path = pg_catalog, pg_temp, public, auth, extensions;



create temp table pg_temp._p19a_whatsapp_embedded_results (

  scenario integer primary key,

  name text not null,

  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),

  detail text

) on commit preserve rows;



create or replace function pg_temp._p19a_whatsapp_record(

  p_scenario integer,

  p_name text,

  p_status text,

  p_detail text default null

)

returns void

language plpgsql

as $function$

begin

  insert into pg_temp._p19a_whatsapp_embedded_results(scenario, name, status, detail)

  values (p_scenario, p_name, p_status, p_detail)

  on conflict (scenario) do update

    set name = excluded.name,

        status = excluded.status,

        detail = excluded.detail;

end;

$function$;



create or replace function pg_temp._p19a_whatsapp_uuid(p_seed text)

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



create or replace function pg_temp._p19a_whatsapp_store_fixture(

  p_seed text

)

returns table (

  org_id uuid,

  store_id uuid

)

language plpgsql

as $function$

declare

  v_org uuid := pg_temp._p19a_whatsapp_uuid(p_seed || ':org');

  v_store uuid := pg_temp._p19a_whatsapp_uuid(p_seed || ':store');

begin

  insert into public.organizations(id, name, subscription_status)

  values (v_org, 'P19A WhatsApp Embedded Org ' || p_seed, 'active');



  insert into public.stores(id, organization_id, name)

  values (v_store, v_org, 'P19A WhatsApp Embedded Store ' || p_seed);



  return query select v_org, v_store;

end;

$function$;



create or replace function pg_temp._p19a_insert_whatsapp_integration(

  p_seed text,

  p_org_id uuid,

  p_store_id uuid,

  p_waba_id text,

  p_phone_number_id text,

  p_display_phone_number text,

  p_access_token text,

  p_metadata jsonb default '{}'::jsonb,

  p_status text default 'active',

  p_is_active boolean default true

)

returns uuid

language plpgsql

as $function$

declare

  v_id uuid := pg_temp._p19a_whatsapp_uuid(p_seed || ':integration');

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

    p_status,

    p_is_active,

    p_display_phone_number,

    p_phone_number_id,

    p_waba_id,

    p_access_token,

    null,

    p_metadata,

    pg_catalog.clock_timestamp()

  );



  return v_id;

end;

$function$;



-- 1. privileges and invoker contract

do $$

declare

  v_proc pg_catalog.regprocedure :=

    'public.materialize_store_whatsapp_embedded_signup_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)'::pg_catalog.regprocedure;

  v_prosecdef boolean;

  v_public_execute boolean;

begin

  select proc_row.prosecdef

  into v_prosecdef

  from pg_catalog.pg_proc proc_row

  join pg_catalog.pg_namespace namespace_row

    on namespace_row.oid = proc_row.pronamespace

  where namespace_row.nspname = 'public'

    and proc_row.proname = 'materialize_store_whatsapp_embedded_signup_by_system'

    and proc_row.oid = v_proc;



  select exists (

    select 1

    from pg_catalog.pg_proc proc_row

    cross join lateral pg_catalog.aclexplode(

      coalesce(proc_row.proacl, pg_catalog.acldefault('f', proc_row.proowner))

    ) acl_row

    where proc_row.oid = v_proc

      and acl_row.grantee = 0

      and acl_row.privilege_type = 'EXECUTE'

  )

  into v_public_execute;



  perform pg_temp._p19a_whatsapp_record(

    1,

    'writer is service-only and not security definer',

    case

      when v_prosecdef is false

       and v_public_execute is false

       and not pg_catalog.has_function_privilege(

         'anon',

         v_proc,

         'execute'

       )

       and not pg_catalog.has_function_privilege(

         'authenticated',

         v_proc,

         'execute'

       )

       and pg_catalog.has_function_privilege(

         'service_role',

         v_proc,

         'execute'

       )

      then 'PASS'

      else 'SUT_FAIL'

    end,

    'prosecdef=' || coalesce(v_prosecdef::text, '<missing>')

      || ' public_execute=' || coalesce(v_public_execute::text, '<missing>')

  );

exception when others then

  perform pg_temp._p19a_whatsapp_record(1, 'writer is service-only and not security definer', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);

end $$;



-- 2. initial insert

do $$

declare

  c record;

  r record;

  v_row record;

begin

  select * into c from pg_temp._p19a_whatsapp_store_fixture('insert-initial');



  select * into r

  from public.materialize_store_whatsapp_embedded_signup_by_system(

    c.org_id,

    c.store_id,

    'waba-insert',

    'phone-insert',

    '+55 11 90000-0001',

    'fake-token-insert',

    'v99.0',

    'fake-app-id',

    '2026-09-25T12:00:00Z'::timestamptz

  );



  select *

  into v_row

  from public.external_integrations

  where id = r.integration_id;



  perform pg_temp._p19a_whatsapp_record(

    2,

    'initial connection inserts active integration',

    case

      when r.outcome = 'inserted'

       and r.provider = 'whatsapp'

       and r.status = 'active'

       and r.is_active is true

       and r.phone_number_id = 'phone-insert'

       and r.whatsapp_business_account_id = 'waba-insert'

       and v_row.access_token = 'fake-token-insert'

       and v_row.metadata->>'source' = 'meta_whatsapp_embedded_signup'

       and v_row.metadata->>'token_storage' = 'external_integrations.access_token'

       and not (v_row.metadata ? 'access_token')

      then 'PASS'

      else 'SUT_FAIL'

    end,

    pg_catalog.row_to_json(r)::text

  );

exception when others then

  perform pg_temp._p19a_whatsapp_record(2, 'initial connection inserts active integration', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);

end $$;



-- 3. replay same WABA/phone/token

do $$

declare

  c record;

  r1 record;

  r2 record;

begin

  select * into c from pg_temp._p19a_whatsapp_store_fixture('replay');



  select * into r1

  from public.materialize_store_whatsapp_embedded_signup_by_system(

    c.org_id, c.store_id, 'waba-replay', 'phone-replay', '+55 11 90000-0002',

    'fake-token-replay', 'v99.0', 'fake-app-id', pg_catalog.clock_timestamp()

  );



  select * into r2

  from public.materialize_store_whatsapp_embedded_signup_by_system(

    c.org_id, c.store_id, 'waba-replay', 'phone-replay', '+55 11 90000-0002',

    'fake-token-replay', 'v99.0', 'fake-app-id', pg_catalog.clock_timestamp()

  );



  perform pg_temp._p19a_whatsapp_record(

    3,

    'same WABA and phone replays idempotently',

    case

      when r1.integration_id = r2.integration_id

       and r2.outcome = 'idempotent_replay'

      then 'PASS'

      else 'SUT_FAIL'

    end,

    pg_catalog.row_to_json(r2)::text

  );

exception when others then

  perform pg_temp._p19a_whatsapp_record(3, 'same WABA and phone replays idempotently', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);

end $$;



-- 4. reconnection same WABA/phone with new token

do $$

declare

  c record;

  r record;

  v_token text;

begin

  select * into c from pg_temp._p19a_whatsapp_store_fixture('reconnect');

  perform pg_temp._p19a_insert_whatsapp_integration(

    'reconnect',

    c.org_id,

    c.store_id,

    'waba-reconnect',

    'phone-reconnect',

    '+55 11 90000-0003',

    'fake-token-old',

    '{"source":"meta_whatsapp_embedded_signup"}'::jsonb

  );



  select * into r

  from public.materialize_store_whatsapp_embedded_signup_by_system(

    c.org_id, c.store_id, 'waba-reconnect', 'phone-reconnect', '+55 11 90000-0003',

    'fake-token-new', 'v99.0', 'fake-app-id', pg_catalog.clock_timestamp()

  );



  select access_token into v_token

  from public.external_integrations

  where store_id = c.store_id and provider = 'whatsapp';



  perform pg_temp._p19a_whatsapp_record(

    4,

    'same WABA and phone reconnects with new token',

    case

      when r.outcome = 'reconnected'

       and v_token = 'fake-token-new'

       and pg_catalog.strpos(pg_catalog.row_to_json(r)::text, 'fake-token-new') = 0

      then 'PASS'

      else 'SUT_FAIL'

    end,

    pg_catalog.row_to_json(r)::text

  );

exception when others then

  perform pg_temp._p19a_whatsapp_record(4, 'same WABA and phone reconnects with new token', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);

end $$;



-- 5. generic legacy conversion

do $$

declare

  c record;

  r record;

  v_row record;

begin

  select * into c from pg_temp._p19a_whatsapp_store_fixture('legacy-convert');

  perform pg_temp._p19a_insert_whatsapp_integration(

    'legacy-convert',

    c.org_id,

    c.store_id,

    'waba-legacy',

    'phone-legacy-old',

    '+55 11 90000-0004',

    null,

    '{"source":"meta_whatsapp_cloud_api","activation_mode":"manual_assisted_setup","token_storage":"server_env_for_pilot","payment_status":"pending_currency_review","channel_purpose":"zion_pilot_real_whatsapp","number_scenario":"new_number","notes":"legacy freeform note must not be carried forward","access_token":"fake-token-top-level-legacy","nested":{"token":"fake-token-nested-legacy","app_secret":"fake-app-secret-nested-legacy"}}'::jsonb

  );



  select * into r

  from public.materialize_store_whatsapp_embedded_signup_by_system(

    c.org_id, c.store_id, 'waba-legacy', 'phone-legacy-new', '+55 11 90000-0005',

    'fake-token-legacy-converted', 'v99.0', 'fake-app-id', '2026-09-25T13:00:00Z'::timestamptz

  );



  select *

  into v_row

  from public.external_integrations

  where id = r.integration_id;



  perform pg_temp._p19a_whatsapp_record(

    5,

    'legacy manual pilot converts within same WABA',

    case

      when r.outcome = 'legacy_converted'

       and v_row.phone_number_id = 'phone-legacy-new'

       and v_row.display_phone_number = '+55 11 90000-0005'

       and v_row.access_token = 'fake-token-legacy-converted'

       and v_row.metadata->>'converted_from_manual_pilot' = 'true'

       and v_row.metadata->>'previous_phone_number_id' = 'phone-legacy-old'

       and v_row.metadata->>'previous_display_phone_number' = '+55 11 90000-0004'

       and v_row.metadata->>'activation_mode' = 'embedded_signup'

       and v_row.metadata->>'payment_status' = 'pending_currency_review'

       and v_row.metadata->>'channel_purpose' = 'zion_pilot_real_whatsapp'

       and v_row.metadata->>'number_scenario' = 'new_number'

       and not (v_row.metadata ? 'notes')

       and not (v_row.metadata ? 'nested')

       and not (v_row.metadata ? 'access_token')

       and pg_catalog.strpos(v_row.metadata::text, 'fake-token-top-level-legacy') = 0

       and pg_catalog.strpos(v_row.metadata::text, 'fake-token-nested-legacy') = 0

       and pg_catalog.strpos(v_row.metadata::text, 'fake-app-secret-nested-legacy') = 0

      then 'PASS'

      else 'SUT_FAIL'

    end,

    v_row.metadata::text

  );

exception when others then

  perform pg_temp._p19a_whatsapp_record(5, 'legacy manual pilot converts within same WABA', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);

end $$;



-- 6. future non-legacy phone change fails and leaves row unchanged

do $$

declare

  c record;

  v_before record;

  v_after record;

begin

  select * into c from pg_temp._p19a_whatsapp_store_fixture('future-change');

  perform pg_temp._p19a_insert_whatsapp_integration(

    'future-change',

    c.org_id,

    c.store_id,

    'waba-future',

    'phone-future-old',

    '+55 11 90000-0006',

    'fake-token-future-old',

    '{"source":"meta_whatsapp_embedded_signup","activation_mode":"embedded_signup"}'::jsonb

  );



  select phone_number_id, display_phone_number, access_token

  into v_before

  from public.external_integrations

  where store_id = c.store_id and provider = 'whatsapp';



  begin

    perform *

    from public.materialize_store_whatsapp_embedded_signup_by_system(

      c.org_id, c.store_id, 'waba-future', 'phone-future-new', '+55 11 90000-0007',

      'fake-token-future-new', 'v99.0', 'fake-app-id', pg_catalog.clock_timestamp()

    );

    perform pg_temp._p19a_whatsapp_record(6, 'non-legacy phone change fails closed', 'SUT_FAIL', 'unexpected success');

    return;

  exception when others then

    if sqlerrm not like '%PHONE_CHANGE_REQUIRES_SAFE_FLOW%' then

      perform pg_temp._p19a_whatsapp_record(6, 'non-legacy phone change fails closed', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);

      return;

    end if;

  end;



  select phone_number_id, display_phone_number, access_token

  into v_after

  from public.external_integrations

  where store_id = c.store_id and provider = 'whatsapp';



  perform pg_temp._p19a_whatsapp_record(

    6,

    'non-legacy phone change fails closed',

    case

      when v_after.phone_number_id = v_before.phone_number_id

       and v_after.display_phone_number = v_before.display_phone_number

       and v_after.access_token = v_before.access_token

      then 'PASS'

      else 'SUT_FAIL'

    end,

    'after=' || pg_catalog.row_to_json(v_after)::text

  );

exception when others then

  perform pg_temp._p19a_whatsapp_record(6, 'non-legacy phone change fails closed', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);

end $$;



-- 7. WABA mismatch fails

do $$

declare

  c record;

begin

  select * into c from pg_temp._p19a_whatsapp_store_fixture('waba-mismatch');

  perform pg_temp._p19a_insert_whatsapp_integration(

    'waba-mismatch',

    c.org_id,

    c.store_id,

    'waba-original',

    'phone-waba-mismatch',

    '+55 11 90000-0008',

    'fake-token-waba-original',

    '{"source":"meta_whatsapp_embedded_signup"}'::jsonb

  );



  begin

    perform *

    from public.materialize_store_whatsapp_embedded_signup_by_system(

      c.org_id, c.store_id, 'waba-other', 'phone-waba-mismatch', '+55 11 90000-0008',

      'fake-token-waba-other', 'v99.0', 'fake-app-id', pg_catalog.clock_timestamp()

    );

    perform pg_temp._p19a_whatsapp_record(7, 'WABA mismatch fails closed', 'SUT_FAIL', 'unexpected success');

    return;

  exception when others then

    perform pg_temp._p19a_whatsapp_record(

      7,

      'WABA mismatch fails closed',

      case when sqlerrm like '%WABA_MISMATCH%' then 'PASS' else 'HARNESS_ERROR' end,

      sqlstate || ' ' || sqlerrm

    );

  end;

exception when others then

  perform pg_temp._p19a_whatsapp_record(7, 'WABA mismatch fails closed', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);

end $$;



-- 8. phone_number_id already bound to another store fails

do $$

declare

  c1 record;

  c2 record;

begin

  select * into c1 from pg_temp._p19a_whatsapp_store_fixture('phone-conflict-a');

  select * into c2 from pg_temp._p19a_whatsapp_store_fixture('phone-conflict-b');

  perform pg_temp._p19a_insert_whatsapp_integration(

    'phone-conflict-a',

    c1.org_id,

    c1.store_id,

    'waba-conflict-a',

    'phone-conflict-global',

    '+55 11 90000-0009',

    'fake-token-conflict-a',

    '{"source":"meta_whatsapp_embedded_signup"}'::jsonb

  );



  begin

    perform *

    from public.materialize_store_whatsapp_embedded_signup_by_system(

      c2.org_id, c2.store_id, 'waba-conflict-b', 'phone-conflict-global', '+55 11 90000-0010',

      'fake-token-conflict-b', 'v99.0', 'fake-app-id', pg_catalog.clock_timestamp()

    );

    perform pg_temp._p19a_whatsapp_record(8, 'phone number bound to another store fails closed', 'SUT_FAIL', 'unexpected success');

    return;

  exception when others then

    perform pg_temp._p19a_whatsapp_record(

      8,

      'phone number bound to another store fails closed',

      case when sqlerrm like '%PHONE_ALREADY_BOUND%' or sqlstate = '23505' then 'PASS' else 'HARNESS_ERROR' end,

      sqlstate || ' ' || sqlerrm

    );

  end;

exception when others then

  perform pg_temp._p19a_whatsapp_record(8, 'phone number bound to another store fails closed', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);

end $$;



-- 9. token never appears in return payload

do $$

declare

  c record;

  r record;

begin

  select * into c from pg_temp._p19a_whatsapp_store_fixture('return-token');



  select * into r

  from public.materialize_store_whatsapp_embedded_signup_by_system(

    c.org_id, c.store_id, 'waba-return-token', 'phone-return-token', '+55 11 90000-0011',

    'fake-token-must-not-return', 'v99.0', 'fake-app-id', pg_catalog.clock_timestamp()

  );



  perform pg_temp._p19a_whatsapp_record(

    9,

    'return payload never includes token',

    case when pg_catalog.strpos(pg_catalog.row_to_json(r)::text, 'fake-token-must-not-return') = 0 then 'PASS' else 'SUT_FAIL' end,

    pg_catalog.row_to_json(r)::text

  );

exception when others then

  perform pg_temp._p19a_whatsapp_record(9, 'return payload never includes token', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);

end $$;



-- 10. metadata never stores access_token key

do $$

declare

  c record;

  v_metadata jsonb;

begin

  select * into c from pg_temp._p19a_whatsapp_store_fixture('metadata-token');



  perform *

  from public.materialize_store_whatsapp_embedded_signup_by_system(

    c.org_id, c.store_id, 'waba-metadata-token', 'phone-metadata-token', '+55 11 90000-0012',

    'fake-token-metadata', 'v99.0', 'fake-app-id', pg_catalog.clock_timestamp()

  );



  select metadata

  into v_metadata

  from public.external_integrations

  where store_id = c.store_id and provider = 'whatsapp';



  perform pg_temp._p19a_whatsapp_record(

    10,

    'metadata never contains access_token',

    case

      when not (v_metadata ? 'access_token')

       and not (v_metadata ? 'token')

       and pg_catalog.strpos(v_metadata::text, 'fake-token-metadata') = 0

      then 'PASS'

      else 'SUT_FAIL'

    end,

    v_metadata::text

  );

exception when others then

  perform pg_temp._p19a_whatsapp_record(10, 'metadata never contains access_token', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);

end $$;



-- 11. atomicity after error

do $$

declare

  c record;

  v_before record;

  v_after record;

begin

  select * into c from pg_temp._p19a_whatsapp_store_fixture('atomic-error');

  perform pg_temp._p19a_insert_whatsapp_integration(

    'atomic-error',

    c.org_id,

    c.store_id,

    'waba-atomic',

    'phone-atomic-old',

    '+55 11 90000-0013',

    'fake-token-atomic-old',

    '{"source":"meta_whatsapp_embedded_signup","activation_mode":"embedded_signup"}'::jsonb

  );



  select phone_number_id, display_phone_number, access_token, status, is_active

  into v_before

  from public.external_integrations

  where store_id = c.store_id and provider = 'whatsapp';



  begin

    perform *

    from public.materialize_store_whatsapp_embedded_signup_by_system(

      c.org_id, c.store_id, 'waba-atomic-other', 'phone-atomic-new', '+55 11 90000-0014',

      'fake-token-atomic-new', 'v99.0', 'fake-app-id', pg_catalog.clock_timestamp()

    );

  exception when others then

    null;

  end;



  select phone_number_id, display_phone_number, access_token, status, is_active

  into v_after

  from public.external_integrations

  where store_id = c.store_id and provider = 'whatsapp';



  perform pg_temp._p19a_whatsapp_record(

    11,

    'failed writer call leaves existing integration unchanged',

    case when pg_catalog.row_to_json(v_before)::text = pg_catalog.row_to_json(v_after)::text then 'PASS' else 'SUT_FAIL' end,

    'after=' || pg_catalog.row_to_json(v_after)::text

  );

exception when others then

  perform pg_temp._p19a_whatsapp_record(11, 'failed writer call leaves existing integration unchanged', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);

end $$;



-- 12. unique partial phone_number_id exists

do $$

begin

  perform pg_temp._p19a_whatsapp_record(

    12,

    'partial unique phone_number_id exists',

    case

      when exists (

        select 1

        from pg_catalog.pg_indexes index_row

        where index_row.schemaname = 'public'

          and index_row.tablename = 'external_integrations'

          and index_row.indexname = 'external_integrations_whatsapp_phone_number_uidx'

          and index_row.indexdef ilike '%unique%'

          and index_row.indexdef ilike '%phone_number_id%'

          and index_row.indexdef ilike '%provider%'

          and index_row.indexdef ilike '%whatsapp%'

          and index_row.indexdef ilike '%phone_number_id IS NOT NULL%'

      )

      then 'PASS'

      else 'SUT_FAIL'

    end,

    'external_integrations_whatsapp_phone_number_uidx'

  );

exception when others then

  perform pg_temp._p19a_whatsapp_record(12, 'partial unique phone_number_id exists', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);

end $$;



-- 13. no improper unique WABA index

do $$

begin

  perform pg_temp._p19a_whatsapp_record(

    13,

    'WABA is not unique because a WABA can own multiple phone numbers',

    case

      when not exists (

        select 1

        from pg_catalog.pg_indexes index_row

        where index_row.schemaname = 'public'

          and index_row.tablename = 'external_integrations'

          and index_row.indexdef ilike '%unique%'

          and index_row.indexdef ilike '%whatsapp_business_account_id%'

      )

      then 'PASS'

      else 'SUT_FAIL'

    end,

    'no unique whatsapp_business_account_id index expected'

  );

exception when others then

  perform pg_temp._p19a_whatsapp_record(13, 'WABA is not unique because a WABA can own multiple phone numbers', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);

end $$;



-- 14. inactive legacy metadata alone cannot authorize phone change

do $$

declare

  c record;

  v_before record;

  v_after record;

begin

  select * into c from pg_temp._p19a_whatsapp_store_fixture('inactive-legacy-change');

  perform pg_temp._p19a_insert_whatsapp_integration(

    'inactive-legacy-change',

    c.org_id,

    c.store_id,

    'waba-inactive-legacy',

    'phone-inactive-legacy-old',

    '+55 11 90000-0015',

    null,

    '{"source":"meta_whatsapp_cloud_api","activation_mode":"manual_assisted_setup","token_storage":"server_env_for_pilot"}'::jsonb,

    'inactive',

    false

  );



  select phone_number_id, display_phone_number, access_token, status, is_active

  into v_before

  from public.external_integrations

  where store_id = c.store_id and provider = 'whatsapp';



  begin

    perform *

    from public.materialize_store_whatsapp_embedded_signup_by_system(

      c.org_id, c.store_id, 'waba-inactive-legacy', 'phone-inactive-legacy-new', '+55 11 90000-0016',

      'fake-token-inactive-legacy', 'v99.0', 'fake-app-id', pg_catalog.clock_timestamp()

    );

    perform pg_temp._p19a_whatsapp_record(14, 'inactive legacy phone change fails closed', 'SUT_FAIL', 'unexpected success');

    return;

  exception when others then

    if sqlerrm not like '%PHONE_CHANGE_REQUIRES_SAFE_FLOW%' then

      perform pg_temp._p19a_whatsapp_record(14, 'inactive legacy phone change fails closed', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);

      return;

    end if;

  end;



  select phone_number_id, display_phone_number, access_token, status, is_active

  into v_after

  from public.external_integrations

  where store_id = c.store_id and provider = 'whatsapp';



  perform pg_temp._p19a_whatsapp_record(

    14,

    'inactive legacy phone change fails closed',

    case when pg_catalog.row_to_json(v_before)::text = pg_catalog.row_to_json(v_after)::text then 'PASS' else 'SUT_FAIL' end,

    'after=' || pg_catalog.row_to_json(v_after)::text

  );

exception when others then

  perform pg_temp._p19a_whatsapp_record(14, 'inactive legacy phone change fails closed', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);

end $$;



-- 15. actual service_role execution crosses RLS/privileges as production will

do $$
begin
  perform *
  from pg_temp._p19a_whatsapp_store_fixture('service-role-execution');
end $$;

set local role service_role;

do $$
begin
  perform *
  from public.materialize_store_whatsapp_embedded_signup_by_system(
    'c905c150-e8aa-468a-8f6b-c84dd6103eb1'::uuid,
    'c6d5e44b-6123-4a7d-8695-a4b76b8bfc81'::uuid,
    'waba-service-role',
    'phone-service-role',
    '+55 11 90000-0017',
    'fake-token-service-role',
    'v99.0',
    'fake-app-id',
    pg_catalog.clock_timestamp()
  );

  perform pg_catalog.set_config('p19a.whatsapp_service_role_check', 'PASS', true);
exception when others then
  perform pg_catalog.set_config(
    'p19a.whatsapp_service_role_check',
    'FAIL:' || sqlstate || ':' || sqlerrm,
    true
  );
end $$;

reset role;

do $$
declare
  v_check text := pg_catalog.current_setting('p19a.whatsapp_service_role_check', true);
  v_row record;
begin
  select provider, status, is_active, phone_number_id, whatsapp_business_account_id, access_token
  into v_row
  from public.external_integrations
  where store_id = 'c6d5e44b-6123-4a7d-8695-a4b76b8bfc81'::uuid
    and provider = 'whatsapp';

  perform pg_temp._p19a_whatsapp_record(
    15,
    'service_role executes writer successfully under real RLS/privileges',
    case
      when v_check = 'PASS'
       and v_row.provider = 'whatsapp'
       and v_row.status = 'active'
       and v_row.is_active is true
       and v_row.phone_number_id = 'phone-service-role'
       and v_row.whatsapp_business_account_id = 'waba-service-role'
       and v_row.access_token = 'fake-token-service-role'
      then 'PASS'
      else 'SUT_FAIL'
    end,
    'service_role_check=' || coalesce(v_check, '<missing>')
  );
exception when others then
  perform pg_temp._p19a_whatsapp_record(
    15,
    'service_role executes writer successfully under real RLS/privileges',
    'HARNESS_ERROR',
    sqlstate || ' ' || sqlerrm
  );
end $$;


-- 16. store must belong to organization supplied by the server-side caller

do $$
declare
  c1 record;
  c2 record;
  v_count integer;
begin
  select * into c1 from pg_temp._p19a_whatsapp_store_fixture('scope-mismatch-a');
  select * into c2 from pg_temp._p19a_whatsapp_store_fixture('scope-mismatch-b');

  begin
    perform *
    from public.materialize_store_whatsapp_embedded_signup_by_system(
      c1.org_id,
      c2.store_id,
      'waba-scope-mismatch',
      'phone-scope-mismatch',
      '+55 11 90000-0018',
      'fake-token-scope-mismatch',
      'v99.0',
      'fake-app-id',
      pg_catalog.clock_timestamp()
    );

    perform pg_temp._p19a_whatsapp_record(
      16,
      'store and organization mismatch fails before materialization',
      'SUT_FAIL',
      'unexpected success'
    );
    return;
  exception when others then
    if sqlerrm not like '%STORE_SCOPE_MISMATCH%' then
      perform pg_temp._p19a_whatsapp_record(
        16,
        'store and organization mismatch fails before materialization',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
      return;
    end if;
  end;

  select count(*)
  into v_count
  from public.external_integrations
  where store_id = c2.store_id
    and provider = 'whatsapp';

  perform pg_temp._p19a_whatsapp_record(
    16,
    'store and organization mismatch fails before materialization',
    case when v_count = 0 then 'PASS' else 'SUT_FAIL' end,
    'integration_rows=' || v_count::text
  );
exception when others then
  perform pg_temp._p19a_whatsapp_record(
    16,
    'store and organization mismatch fails before materialization',
    'HARNESS_ERROR',
    sqlstate || ' ' || sqlerrm
  );
end $$;


select *

from pg_temp._p19a_whatsapp_embedded_results

order by scenario;



do $$

declare

  v_failures integer;

begin

  select count(*)

  into v_failures

  from pg_temp._p19a_whatsapp_embedded_results

  where status <> 'PASS';



  if v_failures > 0 then

    raise exception using

      errcode = 'P0001',

      message = 'P19A_WHATSAPP_EMBEDDED_SIGNUP_WRITER_MANUAL_CHECKS_FAILED';

  end if;

end $$;



rollback;
