begin;



set local lock_timeout = '5s';

set local statement_timeout = '300s';

set local idle_in_transaction_session_timeout = '300s';

set local search_path = pg_catalog, pg_temp, public, auth, extensions;



create temp table pg_temp._p19a_pin_results (

  scenario text primary key,

  name text not null,

  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),

  detail text

) on commit preserve rows;



create or replace function pg_temp._p19a_pin_record(

  p_scenario text, p_name text, p_status text, p_detail text default null

)

returns void language plpgsql as $function$

begin

  insert into pg_temp._p19a_pin_results values (p_scenario, p_name, p_status, p_detail)

  on conflict (scenario) do update set name = excluded.name, status = excluded.status, detail = excluded.detail;

end;

$function$;



create or replace function pg_temp._p19a_pin_uuid(p_seed text)

returns uuid language sql immutable as $function$

  select (substr(md5(p_seed), 1, 8) || '-' || substr(md5(p_seed), 9, 4) || '-4' || substr(md5(p_seed), 14, 3) || '-8' || substr(md5(p_seed), 18, 3) || '-' || substr(md5(p_seed), 21, 12))::uuid;

$function$;



create or replace function pg_temp._p19a_pin_store(p_seed text)

returns table(org_id uuid, store_id uuid) language plpgsql as $function$

begin

  org_id := pg_temp._p19a_pin_uuid('p19a-pin:' || p_seed || ':org');

  store_id := pg_temp._p19a_pin_uuid('p19a-pin:' || p_seed || ':store');

  insert into public.organizations(id, name, subscription_status)

  values (org_id, 'P19A PIN ' || p_seed, 'active');

  insert into public.stores(id, organization_id, name)

  values (store_id, org_id, 'P19A PIN store ' || p_seed);

  return next;

end;

$function$;



create or replace function pg_temp._p19a_pin_integration(

  p_seed text, p_org uuid, p_store uuid, p_phone text

)

returns uuid language plpgsql as $function$

declare v_id uuid := pg_temp._p19a_pin_uuid('p19a-pin:' || p_seed || ':integration');

begin

  insert into public.external_integrations(

    id, organization_id, store_id, provider, status, is_active,

    display_phone_number, phone_number_id, whatsapp_business_account_id,

    access_token, metadata, updated_at

  ) values (

    v_id, p_org, p_store, 'whatsapp', 'active', true,

    '+55 11 90000-4' || right(p_seed, 3), p_phone, 'p19a-pin-waba-' || p_seed,

    'p19a-pin-existing-integration-sentinel', '{"runner":"p19a_pin"}'::jsonb, clock_timestamp()

  );

  return v_id;

end;

$function$;



create or replace function pg_temp._p19a_pin_material(p_seed text)

returns table(ciphertext text, iv text, auth_tag text) language sql immutable as $function$

  select 'ciphertext-sentinel-' || p_seed, 'iv-sentinel-' || p_seed, 'auth-tag-sentinel-' || p_seed;

$function$;



do $preflight$

declare v_signature text; v_signatures text[] := array[

  'public.create_whatsapp_phone_security_secret_pending_by_system(uuid,uuid,text,text,text,text,text,integer)',

  'public.activate_whatsapp_phone_security_secret_by_system(uuid,uuid,text,text,uuid)',

  'public.invalidate_whatsapp_phone_security_secret_by_system(uuid,uuid,uuid)',

  'public.read_whatsapp_phone_security_secret_metadata_by_system(uuid,uuid,text,text)',

  'public.read_whatsapp_phone_security_secret_material_by_system(uuid,uuid,text,text)'];

begin

  if to_regclass('public.whatsapp_phone_security_secrets') is null then raise exception 'P19A_WHATSAPP_PIN_PREFLIGHT_TABLE_MISSING'; end if;

  foreach v_signature in array v_signatures loop

    if to_regprocedure(v_signature) is null then raise exception 'P19A_WHATSAPP_PIN_PREFLIGHT_FUNCTION_MISSING: %', v_signature; end if;

    if not has_function_privilege('service_role', to_regprocedure(v_signature), 'execute')

       or has_function_privilege('anon', to_regprocedure(v_signature), 'execute')

       or has_function_privilege('authenticated', to_regprocedure(v_signature), 'execute') then

      raise exception 'P19A_WHATSAPP_PIN_PREFLIGHT_PRIVILEGES_INVALID: %', v_signature;

    end if;

  end loop;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_phone_security_secrets' and column_name in ('pin', 'raw_pin', 'plaintext', 'access_token')) then

    raise exception 'P19A_WHATSAPP_PIN_PREFLIGHT_FORBIDDEN_COLUMN';

  end if;

end;

$preflight$;



do $case$ begin

  if to_regclass('public.whatsapp_phone_security_secrets') is null then raise exception 'missing'; end if;

  perform pg_temp._p19a_pin_record('A', 'table exists', 'PASS'); exception when others then perform pg_temp._p19a_pin_record('A', 'table exists', 'SUT_FAIL', sqlerrm); end $case$;

do $case$ begin

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='whatsapp_phone_security_secrets' and column_name in ('pin','raw_pin','plaintext','access_token')) then raise exception 'forbidden column'; end if;

  perform pg_temp._p19a_pin_record('B', 'no plaintext PIN column', 'PASS'); exception when others then perform pg_temp._p19a_pin_record('B', 'no plaintext PIN column', 'SUT_FAIL', sqlerrm); end $case$;



do $case$ declare c record; m record; r record;

begin

  select * into c from pg_temp._p19a_pin_store('create'); select * into m from pg_temp._p19a_pin_material('create');

  select * into r from public.create_whatsapp_phone_security_secret_pending_by_system(c.org_id,c.store_id,'whatsapp','phone-create',m.ciphertext,m.iv,m.auth_tag,1);

  if r.status <> 'pending' or r.outcome <> 'created' then raise exception 'pending'; end if;

  perform pg_temp._p19a_pin_record('C', 'create pending', 'PASS');

exception when others then perform pg_temp._p19a_pin_record('C', 'create pending', 'SUT_FAIL', sqlerrm); end $case$;

do $case$ declare c record; m record;

begin

  select * into c from pg_temp._p19a_pin_store('cipher'); select * into m from pg_temp._p19a_pin_material('cipher');

  perform public.create_whatsapp_phone_security_secret_pending_by_system(c.org_id,c.store_id,'whatsapp','phone-cipher',m.ciphertext,m.iv,m.auth_tag,1);

  if not exists (select 1 from public.whatsapp_phone_security_secrets where phone_number_id='phone-cipher' and ciphertext=m.ciphertext and iv=m.iv and auth_tag=m.auth_tag) then raise exception 'material'; end if;

  perform pg_temp._p19a_pin_record('D', 'ciphertext material stored', 'PASS');

exception when others then perform pg_temp._p19a_pin_record('D', 'ciphertext material stored', 'SUT_FAIL', sqlerrm); end $case$;



do $case$ declare c record; m record; caught boolean := false;

begin

  select * into c from pg_temp._p19a_pin_store('tenant'); select * into m from pg_temp._p19a_pin_material('tenant');

  begin perform public.create_whatsapp_phone_security_secret_pending_by_system(pg_temp._p19a_pin_uuid('other-org'),c.store_id,'whatsapp','phone-tenant',m.ciphertext,m.iv,m.auth_tag,1); exception when others then caught := sqlerrm like '%STORE_SCOPE_MISMATCH%'; end;

  if not caught then raise exception 'tenant isolation'; end if;

  perform pg_temp._p19a_pin_record('E', 'tenant isolation', 'PASS');

exception when others then perform pg_temp._p19a_pin_record('E', 'tenant isolation', 'SUT_FAIL', sqlerrm); end $case$;

do $case$ declare c record; other record; m record; caught boolean := false;

begin

  select * into c from pg_temp._p19a_pin_store('store'); select * into other from pg_temp._p19a_pin_store('other-store'); select * into m from pg_temp._p19a_pin_material('store');

  begin perform public.create_whatsapp_phone_security_secret_pending_by_system(c.org_id,other.store_id,'whatsapp','phone-store',m.ciphertext,m.iv,m.auth_tag,1); exception when others then caught := sqlerrm like '%STORE_SCOPE_MISMATCH%'; end;

  if not caught then raise exception 'store isolation'; end if;

  perform pg_temp._p19a_pin_record('F', 'store isolation', 'PASS');

exception when others then perform pg_temp._p19a_pin_record('F', 'store isolation', 'SUT_FAIL', sqlerrm); end $case$;

do $case$ declare c record; m record; caught boolean := false;

begin

  select * into c from pg_temp._p19a_pin_store('provider'); select * into m from pg_temp._p19a_pin_material('provider');

  begin perform public.create_whatsapp_phone_security_secret_pending_by_system(c.org_id,c.store_id,'telegram','phone-provider',m.ciphertext,m.iv,m.auth_tag,1); exception when others then caught := sqlerrm like '%MATERIAL_INVALID%'; end;

  if not caught then raise exception 'provider'; end if;

  perform pg_temp._p19a_pin_record('G', 'provider guard', 'PASS');

exception when others then perform pg_temp._p19a_pin_record('G', 'provider guard', 'SUT_FAIL', sqlerrm); end $case$;

do $case$ declare c record; m record; caught boolean := false;

begin

  select * into c from pg_temp._p19a_pin_store('phone'); select * into m from pg_temp._p19a_pin_material('phone');

  begin perform public.create_whatsapp_phone_security_secret_pending_by_system(c.org_id,c.store_id,'whatsapp','',m.ciphertext,m.iv,m.auth_tag,1); exception when others then caught := sqlerrm like '%MATERIAL_INVALID%'; end;

  if not caught then raise exception 'phone'; end if;

  perform pg_temp._p19a_pin_record('H', 'phone guard', 'PASS');

exception when others then perform pg_temp._p19a_pin_record('H', 'phone guard', 'SUT_FAIL', sqlerrm); end $case$;



do $case$ declare c record; m record; integration_id uuid; r record;

begin

  select * into c from pg_temp._p19a_pin_store('activate'); integration_id := pg_temp._p19a_pin_integration('activate',c.org_id,c.store_id,'phone-activate'); select * into m from pg_temp._p19a_pin_material('activate');

  perform public.create_whatsapp_phone_security_secret_pending_by_system(c.org_id,c.store_id,'whatsapp','phone-activate',m.ciphertext,m.iv,m.auth_tag,1);

  select * into r from public.activate_whatsapp_phone_security_secret_by_system(c.org_id,c.store_id,'whatsapp','phone-activate',integration_id);

  if r.status <> 'active' then raise exception 'activate'; end if;

  perform pg_temp._p19a_pin_record('I', 'activate correct integration', 'PASS');

exception when others then perform pg_temp._p19a_pin_record('I', 'activate correct integration', 'SUT_FAIL', sqlerrm); end $case$;

do $case$ declare c record; other record; m record; integration_id uuid; caught boolean := false;

begin

  select * into c from pg_temp._p19a_pin_store('cross'); select * into other from pg_temp._p19a_pin_store('cross-other'); integration_id := pg_temp._p19a_pin_integration('cross',other.org_id,other.store_id,'phone-cross'); select * into m from pg_temp._p19a_pin_material('cross');

  perform public.create_whatsapp_phone_security_secret_pending_by_system(c.org_id,c.store_id,'whatsapp','phone-cross',m.ciphertext,m.iv,m.auth_tag,1);

  begin perform public.activate_whatsapp_phone_security_secret_by_system(c.org_id,c.store_id,'whatsapp','phone-cross',integration_id); exception when others then caught := sqlerrm like '%INTEGRATION_SCOPE_MISMATCH%'; end;

  if not caught then raise exception 'cross integration'; end if;

  perform pg_temp._p19a_pin_record('J', 'cross integration blocked', 'PASS');

exception when others then perform pg_temp._p19a_pin_record('J', 'cross integration blocked', 'SUT_FAIL', sqlerrm); end $case$;

do $case$ declare c record; m record; first_id uuid; second_id uuid; integration_id uuid; n integer;

begin

  select * into c from pg_temp._p19a_pin_store('unique');
  integration_id := pg_temp._p19a_pin_integration('unique',c.org_id,c.store_id,'phone-unique');
  select * into m from pg_temp._p19a_pin_material('unique');

  perform public.create_whatsapp_phone_security_secret_pending_by_system(c.org_id,c.store_id,'whatsapp','phone-unique',m.ciphertext,m.iv,m.auth_tag,1);

  select secret_id into first_id
    from public.activate_whatsapp_phone_security_secret_by_system(c.org_id,c.store_id,'whatsapp','phone-unique',integration_id);

  perform public.create_whatsapp_phone_security_secret_pending_by_system(
    c.org_id,c.store_id,'whatsapp','phone-unique',m.ciphertext||'-2',m.iv||'-2',m.auth_tag||'-2',1
  );

  select secret_id into second_id
    from public.activate_whatsapp_phone_security_secret_by_system(c.org_id,c.store_id,'whatsapp','phone-unique',integration_id);

  select count(*) into n
    from public.whatsapp_phone_security_secrets
   where phone_number_id='phone-unique' and status='active';

  if n <> 1 or first_id = second_id then raise exception 'active uniqueness'; end if;

  if not exists (
    select 1
      from public.whatsapp_phone_security_secrets
     where id = first_id and status = 'invalidated'
  ) then
    raise exception 'previous active secret not invalidated';
  end if;

  perform pg_temp._p19a_pin_record('K', 'one active secret per phone', 'PASS');

exception when others then perform pg_temp._p19a_pin_record('K', 'one active secret per phone', 'SUT_FAIL', sqlerrm); end $case$;



do $case$ declare c record; m record; i uuid; sid uuid; r record;

begin

  select * into c from pg_temp._p19a_pin_store('invalidate'); i := pg_temp._p19a_pin_integration('invalidate',c.org_id,c.store_id,'phone-invalidate'); select * into m from pg_temp._p19a_pin_material('invalidate');

  select secret_id into sid from public.create_whatsapp_phone_security_secret_pending_by_system(c.org_id,c.store_id,'whatsapp','phone-invalidate',m.ciphertext,m.iv,m.auth_tag,1);

  select * into r from public.invalidate_whatsapp_phone_security_secret_by_system(c.org_id,c.store_id,sid);

  if r.status <> 'invalidated' then raise exception 'invalidate'; end if;

  perform pg_temp._p19a_pin_record('L', 'invalidate pending', 'PASS');

exception when others then perform pg_temp._p19a_pin_record('L', 'invalidate pending', 'SUT_FAIL', sqlerrm); end $case$;

do $case$ declare c record; m record; sid uuid; r record;

begin

  select * into c from pg_temp._p19a_pin_store('replay'); select * into m from pg_temp._p19a_pin_material('replay');

  select secret_id into sid from public.create_whatsapp_phone_security_secret_pending_by_system(c.org_id,c.store_id,'whatsapp','phone-replay',m.ciphertext,m.iv,m.auth_tag,1);

  perform public.invalidate_whatsapp_phone_security_secret_by_system(c.org_id,c.store_id,sid); select * into r from public.invalidate_whatsapp_phone_security_secret_by_system(c.org_id,c.store_id,sid);

  if r.outcome <> 'idempotent_replay' then raise exception 'replay'; end if;

  perform pg_temp._p19a_pin_record('M', 'invalidate replay', 'PASS');

exception when others then perform pg_temp._p19a_pin_record('M', 'invalidate replay', 'SUT_FAIL', sqlerrm); end $case$;

do $case$ declare c record; m record; sid uuid; caught boolean := false;

begin

  select * into c from pg_temp._p19a_pin_store('terminal'); select * into m from pg_temp._p19a_pin_material('terminal');

  select secret_id into sid from public.create_whatsapp_phone_security_secret_pending_by_system(c.org_id,c.store_id,'whatsapp','phone-terminal',m.ciphertext,m.iv,m.auth_tag,1);

  perform public.invalidate_whatsapp_phone_security_secret_by_system(c.org_id,c.store_id,sid);

  begin update public.whatsapp_phone_security_secrets set status='active' where id=sid; exception when others then caught := sqlerrm like '%INVALIDATED_IMMUTABLE%'; end;

  if not caught then raise exception 'terminal reopen'; end if;

  perform pg_temp._p19a_pin_record('N', 'invalidated cannot reopen', 'PASS');

exception when others then perform pg_temp._p19a_pin_record('N', 'invalidated cannot reopen', 'SUT_FAIL', sqlerrm); end $case$;



do $case$ declare c record; m record; i uuid; row_json jsonb;

begin

  select * into c from pg_temp._p19a_pin_store('reader'); i := pg_temp._p19a_pin_integration('reader',c.org_id,c.store_id,'phone-reader'); select * into m from pg_temp._p19a_pin_material('reader');

  perform public.create_whatsapp_phone_security_secret_pending_by_system(c.org_id,c.store_id,'whatsapp','phone-reader',m.ciphertext,m.iv,m.auth_tag,1);

  perform public.activate_whatsapp_phone_security_secret_by_system(c.org_id,c.store_id,'whatsapp','phone-reader',i);

  select to_jsonb(row_value) into row_json from public.read_whatsapp_phone_security_secret_metadata_by_system(c.org_id,c.store_id,'whatsapp','phone-reader') row_value;

  if row_json ? 'ciphertext' or row_json ? 'iv' or row_json ? 'auth_tag' then raise exception 'secret material leaked'; end if;

  perform pg_temp._p19a_pin_record('O', 'reader returns metadata only', 'PASS');

exception when others then perform pg_temp._p19a_pin_record('O', 'reader returns metadata only', 'SUT_FAIL', sqlerrm); end $case$;

do $case$ declare v_signature text; v_signatures text[] := array[

  'public.create_whatsapp_phone_security_secret_pending_by_system(uuid,uuid,text,text,text,text,text,integer)',

  'public.activate_whatsapp_phone_security_secret_by_system(uuid,uuid,text,text,uuid)',

  'public.invalidate_whatsapp_phone_security_secret_by_system(uuid,uuid,uuid)',

  'public.read_whatsapp_phone_security_secret_metadata_by_system(uuid,uuid,text,text)',

  'public.read_whatsapp_phone_security_secret_material_by_system(uuid,uuid,text,text)'];

begin

  foreach v_signature in array v_signatures loop

    if not has_function_privilege('service_role',to_regprocedure(v_signature),'execute') or has_function_privilege('anon',to_regprocedure(v_signature),'execute') or has_function_privilege('authenticated',to_regprocedure(v_signature),'execute') then raise exception 'function privilege'; end if;

  end loop;

  perform pg_temp._p19a_pin_record('P', 'service role only', 'PASS');

exception when others then perform pg_temp._p19a_pin_record('P', 'service role only', 'SUT_FAIL', sqlerrm); end $case$;

do $case$ begin

  if has_table_privilege('anon','public.whatsapp_phone_security_secrets','select') or has_table_privilege('authenticated','public.whatsapp_phone_security_secrets','select') then raise exception 'direct select'; end if;

  perform pg_temp._p19a_pin_record('Q', 'anon/authenticated direct access blocked', 'PASS'); exception when others then perform pg_temp._p19a_pin_record('Q', 'anon/authenticated direct access blocked', 'SUT_FAIL', sqlerrm); end $case$;

do $case$ declare c record; row_value record;

begin

  select * into c from pg_temp._p19a_pin_store('existing'); perform pg_temp._p19a_pin_integration('existing',c.org_id,c.store_id,'phone-existing');

  select * into row_value from public.read_whatsapp_phone_security_secret_metadata_by_system(c.org_id,c.store_id,'whatsapp','phone-existing');

  if row_value.managed_pin is distinct from false then raise exception 'existing managed state'; end if;

  perform pg_temp._p19a_pin_record('R', 'existing integration remains valid without secret', 'PASS');

exception when others then perform pg_temp._p19a_pin_record('R', 'existing integration remains valid without secret', 'SUT_FAIL', sqlerrm); end $case$;

do $case$ declare v_defs text;

begin

  select string_agg(pg_get_functiondef(p.oid), E'\n') into v_defs

    from pg_proc p join pg_namespace n on n.oid=p.pronamespace

   where n.nspname='public' and p.proname in ('create_whatsapp_phone_security_secret_pending_by_system','activate_whatsapp_phone_security_secret_by_system','invalidate_whatsapp_phone_security_secret_by_system','read_whatsapp_phone_security_secret_metadata_by_system','read_whatsapp_phone_security_secret_material_by_system');

  if v_defs ilike '%insert into public.external_integrations%' or v_defs ilike '%update public.external_integrations%' or v_defs ilike '%delete from public.external_integrations%' then raise exception 'existing integrations mutated'; end if;

  perform pg_temp._p19a_pin_record('S', 'existing integrations not changed by PIN functions', 'PASS');

exception when others then perform pg_temp._p19a_pin_record('S', 'existing integrations not changed by PIN functions', 'SUT_FAIL', sqlerrm); end $case$;



select scenario, name, status, detail from pg_temp._p19a_pin_results order by scenario;

select 'P19A_WHATSAPP_PIN_FOUNDATION_RUNNER_' || case when count(*) = 19 and count(*) filter (where status <> 'PASS') = 0 then 'PASS' else 'FAIL' end as result,

       count(*) as scenario_count,

       count(*) filter (where status = 'PASS') as pass_count,

       count(*) filter (where status = 'SUT_FAIL') as sut_fail_count,

       count(*) filter (where status = 'HARNESS_ERROR') as harness_error_count,

       coalesce(string_agg(scenario || ':' || coalesce(detail, 'failure'), ', ' order by scenario) filter (where status <> 'PASS'), 'none') as failures

  from pg_temp._p19a_pin_results;



rollback;
