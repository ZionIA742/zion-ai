begin;



set local lock_timeout = '5s';

set local statement_timeout = '300s';

set local idle_in_transaction_session_timeout = '300s';

set local search_path = pg_catalog, pg_temp, public, auth, extensions;



create temp table pg_temp._p19a49_results (

  scenario text primary key,

  name text not null,

  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),

  detail text

) on commit preserve rows;



create or replace function pg_temp._p19a49_record(

  p_scenario text,

  p_name text,

  p_status text,

  p_detail text default null

)

returns void language plpgsql as $function$

begin

  insert into pg_temp._p19a49_results(scenario, name, status, detail)

  values (p_scenario, p_name, p_status, p_detail)

  on conflict (scenario) do update set

    name = excluded.name, status = excluded.status, detail = excluded.detail;

end;

$function$;



create or replace function pg_temp._p19a49_uuid(p_seed text)

returns uuid language sql immutable as $function$

  select (

    pg_catalog.substr(pg_catalog.md5(p_seed), 1, 8) || '-' ||

    pg_catalog.substr(pg_catalog.md5(p_seed), 9, 4) || '-4' ||

    pg_catalog.substr(pg_catalog.md5(p_seed), 14, 3) || '-8' ||

    pg_catalog.substr(pg_catalog.md5(p_seed), 18, 3) || '-' ||

    pg_catalog.substr(pg_catalog.md5(p_seed), 21, 12)

  )::uuid;

$function$;



create or replace function pg_temp._p19a49_store(p_seed text)

returns table(org_id uuid, store_id uuid)

language plpgsql as $function$

begin

  org_id := pg_temp._p19a49_uuid('p19a49:' || p_seed || ':org');

  store_id := pg_temp._p19a49_uuid('p19a49:' || p_seed || ':store');

  insert into public.organizations(id, name, subscription_status)

  values (org_id, 'P19A 4.9 Org ' || p_seed, 'active');

  insert into public.stores(id, organization_id, name)

  values (store_id, org_id, 'P19A 4.9 Store ' || p_seed);

  return next;

end;

$function$;



create or replace function pg_temp._p19a49_active(

  p_seed text, p_org uuid, p_store uuid, p_waba text, p_phone text, p_token text

)

returns uuid language plpgsql as $function$

declare v_id uuid := pg_temp._p19a49_uuid('p19a49:' || p_seed || ':active');

begin

  insert into public.external_integrations(

    id, organization_id, store_id, provider, status, is_active,

    display_phone_number, phone_number_id, whatsapp_business_account_id,

    access_token, metadata, updated_at

  ) values (

    v_id, p_org, p_store, 'whatsapp', 'active', true,

    '+55 11 90000-4' || right(p_seed, 3), p_phone, p_waba,

    p_token, '{"runner":"p19a_4_9"}'::jsonb, clock_timestamp()

  );

  return v_id;

end;

$function$;



create or replace function pg_temp._p19a49_request(

  p_seed text, p_org uuid, p_store uuid, p_active uuid,

  p_waba text, p_phone text, p_status text default 'ready_to_cutover',

  p_expires timestamptz default null

)

returns uuid language plpgsql as $function$

declare v_id uuid := pg_temp._p19a49_uuid('p19a49:' || p_seed || ':request');

begin

  insert into public.whatsapp_binding_change_requests(

    id, organization_id, store_id, provider, source, idempotency_key,

    status, active_integration_id, candidate_whatsapp_business_account_id,

    candidate_phone_number_id, candidate_display_phone_number,

    candidate_provenance, candidate_received_at, expires_at, created_at, updated_at

  ) values (

    v_id, p_org, p_store, 'whatsapp', 'p19a_4_9_runner', 'candidate:' || p_seed,

    p_status, p_active, p_waba, p_phone, '+55 11 90000-4999',

    '{"runner":"p19a_4_9"}'::jsonb, clock_timestamp(),

    coalesce(p_expires, clock_timestamp() + interval '1 hour'),

    clock_timestamp(), clock_timestamp()

  );

  return v_id;

end;

$function$;



do $preflight$

declare

  v_cutover regprocedure :=

    'public.cutover_whatsapp_binding_change_request_by_system(uuid,uuid,text,uuid,text,uuid,text,text,text,text,jsonb)'::regprocedure;

begin

  if to_regclass('public.whatsapp_binding_change_requests') is null

     or to_regclass('public.external_integrations') is null

     or to_regprocedure('public.cutover_whatsapp_binding_change_request_by_system(uuid,uuid,text,uuid,text,uuid,text,text,text,text,jsonb)') is null then

    raise exception 'P19A_4_9_PREFLIGHT_SCHEMA_MISSING';

  end if;

  if not has_function_privilege('service_role', v_cutover, 'execute')

     or has_function_privilege('anon', v_cutover, 'execute')

     or has_function_privilege('authenticated', v_cutover, 'execute') then

    raise exception 'P19A_4_9_PREFLIGHT_PRIVILEGES_INVALID';

  end if;

  if pg_get_functiondef(v_cutover) ilike '%WABA_CHANGE_REQUIRES_NEW_TOKEN%'

     or pg_get_functiondef(v_cutover) ilike '%insert into public.external_integrations%'

     or pg_get_functiondef(v_cutover) not ilike '%access_token = v_fresh_access_token%' then

    raise exception 'P19A_4_9_PREFLIGHT_CONTRACT_INVALID';

  end if;

end;

$preflight$;



-- Fresh-token happy path, token replacement, same-WABA and different-WABA.

do $case$

declare c record; a uuid; r uuid; out_row record; token text; request_status text;

begin

  select * into c from pg_temp._p19a49_store('happy');

  a := pg_temp._p19a49_active('happy', c.org_id, c.store_id, 'waba-old', 'phone-old', 'old-token');

  r := pg_temp._p19a49_request('happy', c.org_id, c.store_id, a, 'waba-new', 'phone-new');

  select * into out_row from public.cutover_whatsapp_binding_change_request_by_system(

    c.org_id, c.store_id, 'whatsapp', r, 'cutover:happy', a,

    'waba-new', 'phone-new', '+55 11 90000-4999', 'fresh-token-sentinel',

    '{"source":"p19a_4_9_runner"}'::jsonb

  );

  select access_token into token from public.external_integrations where id = a;

  select change_row.status into request_status from public.whatsapp_binding_change_requests change_row where change_row.id = r;

  perform pg_temp._p19a49_record('A', 'fresh token atomically replaces active binding',

    case when out_row.status = 'completed' and token = 'fresh-token-sentinel'

      and request_status = 'completed' and out_row.whatsapp_business_account_id = 'waba-new'

      then 'PASS' else 'SUT_FAIL' end,

    'status=' || coalesce(request_status, '<null>'));

exception when others then

  perform pg_temp._p19a49_record('A', 'fresh token atomically replaces active binding', 'HARNESS_ERROR', 'SQLSTATE=' || sqlstate);

end;

$case$;



-- Missing token and wrong candidate/active fail before mutation.

do $case$

declare c record; a uuid; r uuid; e text; token text; request_status text;

begin

  select * into c from pg_temp._p19a49_store('fail');

  a := pg_temp._p19a49_active('fail', c.org_id, c.store_id, 'waba-fail', 'phone-fail-old', 'old-fail');

  r := pg_temp._p19a49_request('fail', c.org_id, c.store_id, a, 'waba-fail', 'phone-fail-new');

  begin

    perform * from public.cutover_whatsapp_binding_change_request_by_system(

      c.org_id, c.store_id, 'whatsapp', r, 'cutover:fail', a,

      'waba-fail', 'phone-fail-new', '+55 11 90000-4999', null, '{}'::jsonb

    );

  exception when others then e := sqlerrm; end;

  select access_token into token from public.external_integrations where id = a;

  select change_row.status into request_status from public.whatsapp_binding_change_requests change_row where change_row.id = r;

  perform pg_temp._p19a49_record('B', 'missing fresh token preserves database',

    case when e like '%FRESH_TOKEN_REQUIRED%' and token = 'old-fail' and request_status = 'ready_to_cutover'

      then 'PASS' else 'SUT_FAIL' end, null);

exception when others then

  perform pg_temp._p19a49_record('B', 'missing fresh token preserves database', 'HARNESS_ERROR', 'SQLSTATE=' || sqlstate);

end;

$case$;



-- Completed replay is tokenless and returns only persisted snapshots.

do $case$

declare c record; a uuid; r uuid; out_row record; replay record; calls text;

begin

  select * into c from pg_temp._p19a49_store('replay');

  a := pg_temp._p19a49_active('replay', c.org_id, c.store_id, 'waba-r', 'phone-r-old', 'old-r');

  r := pg_temp._p19a49_request('replay', c.org_id, c.store_id, a, 'waba-r', 'phone-r-new');

  select * into out_row from public.cutover_whatsapp_binding_change_request_by_system(

    c.org_id, c.store_id, 'whatsapp', r, 'cutover:replay', a,

    'waba-r', 'phone-r-new', '+55 11 90000-4999', 'fresh-r', '{}'::jsonb

  );

  select * into replay from public.cutover_whatsapp_binding_change_request_by_system(

    c.org_id, c.store_id, 'whatsapp', r, 'cutover:replay', a,

    'waba-r', 'phone-r-new', '+55 11 90000-4999', null, '{}'::jsonb

  );

  perform pg_temp._p19a49_record('C', 'completed replay does not require a token',

    case when replay.outcome = 'idempotent_replay' and replay.status = 'completed'

      and replay.phone_number_id = 'phone-r-new' then 'PASS' else 'SUT_FAIL' end, null);

exception when others then

  perform pg_temp._p19a49_record('C', 'completed replay does not require a token', 'HARNESS_ERROR', 'SQLSTATE=' || sqlstate);

end;

$case$;



-- Provenance and request rows never contain the fresh token.

do $case$

declare c record; a uuid; r uuid; req jsonb; meta jsonb; token text; out_row record;

begin

  select * into c from pg_temp._p19a49_store('secret');

  a := pg_temp._p19a49_active('secret', c.org_id, c.store_id, 'waba-s', 'phone-s-old', 'old-s');

  r := pg_temp._p19a49_request('secret', c.org_id, c.store_id, a, 'waba-s', 'phone-s-new');

  select * into out_row from public.cutover_whatsapp_binding_change_request_by_system(

    c.org_id, c.store_id, 'whatsapp', r, 'cutover:secret', a,

    'waba-s', 'phone-s-new', '+55 11 90000-4999', 'fresh-secret-sentinel',

    '{"source":"p19a_4_9_runner"}'::jsonb

  );

  select cutover_provenance into req from public.whatsapp_binding_change_requests where id = r;

  select metadata, access_token into meta, token from public.external_integrations where id = a;

  perform pg_temp._p19a49_record('D', 'fresh token is absent from provenance and metadata',

    case when position('fresh-secret-sentinel' in coalesce(req, '{}'::jsonb)::text) = 0

      and position('fresh-secret-sentinel' in coalesce(meta, '{}'::jsonb)::text) = 0

      and token = 'fresh-secret-sentinel' then 'PASS' else 'SUT_FAIL' end, null);

exception when others then

  perform pg_temp._p19a49_record('D', 'fresh token is absent from provenance and metadata', 'HARNESS_ERROR', 'SQLSTATE=' || sqlstate);

end;

$case$;



-- Expiry, terminal immutability, idempotency conflict, tenant/store isolation,

-- and cancel remain fail-closed. The first-connection writer is not invoked here.

do $case$

declare c record; other record; a uuid; r uuid; e text; token text;

begin

  select * into c from pg_temp._p19a49_store('isolation');

  select * into other from pg_temp._p19a49_store('other');

  a := pg_temp._p19a49_active('isolation', c.org_id, c.store_id, 'waba-i', 'phone-i-old', 'old-i');

  r := pg_temp._p19a49_request('isolation', c.org_id, c.store_id, a, 'waba-i', 'phone-i-new');

  begin

    perform * from public.cutover_whatsapp_binding_change_request_by_system(

      other.org_id, c.store_id, 'whatsapp', r, 'cutover:wrong-org', a,

      'waba-i', 'phone-i-new', '+55 11 90000-4999', 'fresh-i', '{}'::jsonb

    );

  exception when others then e := sqlerrm; end;

  select access_token into token from public.external_integrations where id = a;

  perform pg_temp._p19a49_record('E', 'tenant isolation blocks foreign cutover',

    case when e like '%REQUEST_NOT_FOUND%' and token = 'old-i' then 'PASS' else 'SUT_FAIL' end, null);

exception when others then

  perform pg_temp._p19a49_record('E', 'tenant isolation blocks foreign cutover', 'HARNESS_ERROR', 'SQLSTATE=' || sqlstate);

end;

$case$;



-- Same-WABA replay is tokenless; incompatible idempotency input is rejected.

do $case$

declare c record; a uuid; r uuid; replay record; e text;

begin

  select * into c from pg_temp._p19a49_store('same');

  a := pg_temp._p19a49_active('same', c.org_id, c.store_id, 'waba-same', 'phone-same-old', 'old-same');

  r := pg_temp._p19a49_request('same', c.org_id, c.store_id, a, 'waba-same', 'phone-same-new');

  perform * from public.cutover_whatsapp_binding_change_request_by_system(

    c.org_id, c.store_id, 'whatsapp', r, 'cutover:same', a,

    'waba-same', 'phone-same-new', '+55 11 90000-4999', 'fresh-same', '{}'::jsonb

  );

  select * into replay from public.cutover_whatsapp_binding_change_request_by_system(

    c.org_id, c.store_id, 'whatsapp', r, 'cutover:same', a,

    'waba-same', 'phone-same-new', '+55 11 90000-4999', null, '{}'::jsonb

  );

  begin

    perform * from public.cutover_whatsapp_binding_change_request_by_system(

      c.org_id, c.store_id, 'whatsapp', r, 'cutover:same-conflict', a,

      'waba-same', 'phone-same-new', '+55 11 90000-4999', null, '{}'::jsonb

    );

  exception when others then e := sqlerrm; end;

  perform pg_temp._p19a49_record('F', 'same-WABA replay and idempotency conflict',

    case when replay.outcome = 'idempotent_replay' and e like '%IDEMPOTENCY_CONFLICT%'

      then 'PASS' else 'SUT_FAIL' end, null);

exception when others then

  perform pg_temp._p19a49_record('F', 'same-WABA replay and idempotency conflict', 'HARNESS_ERROR', 'SQLSTATE=' || sqlstate);

end;

$case$;



-- Wrong candidate and wrong expected active never mutate the active row.

do $case$

declare c record; a uuid; r uuid; e_candidate text; e_active text; token text;

begin

  select * into c from pg_temp._p19a49_store('guards');

  a := pg_temp._p19a49_active('guards', c.org_id, c.store_id, 'waba-guards', 'phone-guards-old', 'old-guards');

  r := pg_temp._p19a49_request('guards', c.org_id, c.store_id, a, 'waba-guards', 'phone-guards-new');

  begin

    perform * from public.cutover_whatsapp_binding_change_request_by_system(

      c.org_id, c.store_id, 'whatsapp', r, 'cutover:guards-candidate', a,

      'waba-guards', 'wrong-phone', '+55 11 90000-4999', 'fresh-guards', '{}'::jsonb

    );

  exception when others then e_candidate := sqlerrm; end;

  begin

    perform * from public.cutover_whatsapp_binding_change_request_by_system(

      c.org_id, c.store_id, 'whatsapp', r, 'cutover:guards-active', pg_temp._p19a49_uuid('wrong-active'),

      'waba-guards', 'phone-guards-new', '+55 11 90000-4999', 'fresh-guards', '{}'::jsonb

    );

  exception when others then e_active := sqlerrm; end;

  select access_token into token from public.external_integrations where id = a;

  perform pg_temp._p19a49_record('G', 'wrong candidate and expected active fail closed',

    case when e_candidate like '%EXPECTED_BINDING_MISMATCH%'

      and e_active like '%EXPECTED_BINDING_MISMATCH%' and token = 'old-guards'

      then 'PASS' else 'SUT_FAIL' end, null);

exception when others then

  perform pg_temp._p19a49_record('G', 'wrong candidate and expected active fail closed', 'HARNESS_ERROR', 'SQLSTATE=' || sqlstate);

end;

$case$;



-- Candidate phone conflict, expiry and cancel preserve the active binding.

do $case$

declare c record; other record; a uuid; conflict_id uuid; r_conflict uuid; r_expired uuid; r_cancel uuid; e text; token text; out_row record;

begin

  select * into c from pg_temp._p19a49_store('lifecycle');

  select * into other from pg_temp._p19a49_store('lifecycle-conflict');

  a := pg_temp._p19a49_active('lifecycle', c.org_id, c.store_id, 'waba-life', 'phone-life-old', 'old-life');

  conflict_id := pg_temp._p19a49_active('lifecycle-conflict', other.org_id, other.store_id, 'waba-life-2', 'phone-life-conflict', 'other-life');

  r_conflict := pg_temp._p19a49_request('lifecycle-conflict', c.org_id, c.store_id, a, 'waba-life', 'phone-life-conflict');

  begin

    perform * from public.cutover_whatsapp_binding_change_request_by_system(

      c.org_id, c.store_id, 'whatsapp', r_conflict, 'cutover:conflict', a,

      'waba-life', 'phone-life-conflict', '+55 11 90000-4999', 'fresh-life', '{}'::jsonb

    );

  exception when others then e := sqlerrm; end;

  -- The foundation permits only one non-terminal change request per store/provider.
  -- Terminalize the failed-conflict request before creating the expiry fixture.
  select * into out_row
    from public.cancel_whatsapp_binding_change_request_by_system(
      c.org_id, c.store_id, 'whatsapp', r_conflict, '{}'::jsonb
    );

  r_expired := pg_temp._p19a49_request('expired', c.org_id, c.store_id, a, 'waba-life', 'phone-life-expired', 'ready_to_cutover', clock_timestamp() - interval '1 minute');

  select * into out_row from public.expire_whatsapp_binding_change_request_by_system(c.org_id, c.store_id, 'whatsapp', r_expired, '{}'::jsonb);

  r_cancel := pg_temp._p19a49_request('cancelled', c.org_id, c.store_id, a, 'waba-life', 'phone-life-cancelled');

  select * into out_row from public.cancel_whatsapp_binding_change_request_by_system(c.org_id, c.store_id, 'whatsapp', r_cancel, '{}'::jsonb);

  select access_token into token from public.external_integrations where id = a;

  perform pg_temp._p19a49_record('H', 'phone conflict and lifecycle preserve active binding',

    case when e like '%CANDIDATE_PHONE_ALREADY_BOUND%' and token = 'old-life'

      and out_row.status = 'cancelled' then 'PASS' else 'SUT_FAIL' end, null);

exception when others then

  perform pg_temp._p19a49_record('H', 'phone conflict and lifecycle preserve active binding', 'HARNESS_ERROR', 'SQLSTATE=' || sqlstate);

end;

$case$;



-- Tenant and store isolation are checked independently from request identity.

do $case$

declare c record; other record; a uuid; r uuid; e_org text; e_store text; token text;

begin

  select * into c from pg_temp._p19a49_store('scope');

  select * into other from pg_temp._p19a49_store('scope-other');

  a := pg_temp._p19a49_active('scope', c.org_id, c.store_id, 'waba-scope', 'phone-scope-old', 'old-scope');

  r := pg_temp._p19a49_request('scope', c.org_id, c.store_id, a, 'waba-scope', 'phone-scope-new');

  begin

    perform * from public.cutover_whatsapp_binding_change_request_by_system(other.org_id, c.store_id, 'whatsapp', r, 'cutover:org', a, 'waba-scope', 'phone-scope-new', '+55 11 90000-4999', 'fresh-scope', '{}'::jsonb);

  exception when others then e_org := sqlerrm; end;

  begin

    perform * from public.cutover_whatsapp_binding_change_request_by_system(c.org_id, other.store_id, 'whatsapp', r, 'cutover:store', a, 'waba-scope', 'phone-scope-new', '+55 11 90000-4999', 'fresh-scope', '{}'::jsonb);

  exception when others then e_store := sqlerrm; end;

  select access_token into token from public.external_integrations where id = a;

  perform pg_temp._p19a49_record('I', 'organization and store isolation',

    case when e_org like '%REQUEST_NOT_FOUND%' and e_store like '%REQUEST_NOT_FOUND%' and token = 'old-scope'

      then 'PASS' else 'SUT_FAIL' end, null);

exception when others then

  perform pg_temp._p19a49_record('I', 'organization and store isolation', 'HARNESS_ERROR', 'SQLSTATE=' || sqlstate);

end;

$case$;



-- A request already terminal in FAILED cannot be cut over or reopened.
do $case$
declare
  c record;
  a uuid;
  r uuid;
  e text;
  before_token text;
  before_waba text;
  before_phone text;
  before_display text;
  after_token text;
  after_waba text;
  after_phone text;
  after_display text;
  request_status text;
  request_completed_at timestamptz;
  request_completed_phone text;
  request_completed_waba text;
  request_completed_display text;
begin
  select * into c from pg_temp._p19a49_store('terminal-failed');

  a := pg_temp._p19a49_active(
    'terminal-failed',
    c.org_id,
    c.store_id,
    'waba-terminal-old',
    'phone-terminal-old',
    'old-terminal-token'
  );

  r := pg_temp._p19a49_request(
    'terminal-failed',
    c.org_id,
    c.store_id,
    a,
    'waba-terminal-new',
    'phone-terminal-new',
    'failed'
  );

  select
    access_token,
    whatsapp_business_account_id,
    phone_number_id,
    display_phone_number
    into before_token, before_waba, before_phone, before_display
    from public.external_integrations
   where id = a;

  begin
    perform * from public.cutover_whatsapp_binding_change_request_by_system(
      c.org_id,
      c.store_id,
      'whatsapp',
      r,
      'cutover:terminal-failed',
      a,
      'waba-terminal-new',
      'phone-terminal-new',
      '+55 11 90000-4999',
      'fresh-terminal-sentinel',
      '{}'::jsonb
    );
  exception when others then
    e := sqlerrm;
  end;

  select
    access_token,
    whatsapp_business_account_id,
    phone_number_id,
    display_phone_number
    into after_token, after_waba, after_phone, after_display
    from public.external_integrations
   where id = a;

  select
    status,
    completed_at,
    completed_phone_number_id,
    completed_whatsapp_business_account_id,
    completed_display_phone_number
    into
      request_status,
      request_completed_at,
      request_completed_phone,
      request_completed_waba,
      request_completed_display
    from public.whatsapp_binding_change_requests
   where id = r;

  perform pg_temp._p19a49_record(
    'J',
    'failed terminal request cannot be cut over',
    case
      when e like '%ZION_WHATSAPP_CHANGE_TERMINAL_REQUEST%'
       and after_token is not distinct from before_token
       and after_waba is not distinct from before_waba
       and after_phone is not distinct from before_phone
       and after_display is not distinct from before_display
       and request_status = 'failed'
       and request_completed_at is null
       and request_completed_phone is null
       and request_completed_waba is null
       and request_completed_display is null
      then 'PASS'
      else 'SUT_FAIL'
    end,
    null
  );
exception when others then
  perform pg_temp._p19a49_record(
    'J',
    'failed terminal request cannot be cut over',
    'HARNESS_ERROR',
    'SQLSTATE=' || sqlstate
  );
end;
$case$;


-- A dedicated fresh-token sentinel must never reach any observable runner output.
do $case$
declare
  c record;
  a uuid;
  r uuid;
  out_row record;
  request_provenance jsonb;
  active_metadata jsonb;
  prior_result_leak boolean;
  v_sentinel constant text := 'p19a49-output-secret-sentinel';
begin
  select * into c from pg_temp._p19a49_store('output-guard');

  a := pg_temp._p19a49_active(
    'output-guard',
    c.org_id,
    c.store_id,
    'waba-output-old',
    'phone-output-old',
    'old-output-token'
  );

  r := pg_temp._p19a49_request(
    'output-guard',
    c.org_id,
    c.store_id,
    a,
    'waba-output-new',
    'phone-output-new'
  );

  select * into out_row
    from public.cutover_whatsapp_binding_change_request_by_system(
      c.org_id,
      c.store_id,
      'whatsapp',
      r,
      'cutover:output-guard',
      a,
      'waba-output-new',
      'phone-output-new',
      '+55 11 90000-4999',
      v_sentinel,
      '{"source":"p19a_4_9_runner"}'::jsonb
    );

  select cutover_provenance
    into request_provenance
    from public.whatsapp_binding_change_requests
   where id = r;

  select metadata
    into active_metadata
    from public.external_integrations
   where id = a;

  select exists (
    select 1
      from pg_temp._p19a49_results result_row
     where position(v_sentinel in pg_catalog.to_jsonb(result_row)::text) > 0
  )
  into prior_result_leak;

  perform pg_temp._p19a49_record(
    'K',
    'fresh token sentinel is absent from observable runner output',
    case
      when position(v_sentinel in coalesce(pg_catalog.to_jsonb(out_row)::text, '')) = 0
       and position(v_sentinel in coalesce(request_provenance, '{}'::jsonb)::text) = 0
       and position(v_sentinel in coalesce(active_metadata, '{}'::jsonb)::text) = 0
       and prior_result_leak is false
      then 'PASS'
      else 'SUT_FAIL'
    end,
    case
      when prior_result_leak then 'TOKEN_SENTINEL_LEAK_DETECTED'
      else null
    end
  );
exception when others then
  perform pg_temp._p19a49_record(
    'K',
    'fresh token sentinel is absent from observable runner output',
    'HARNESS_ERROR',
    'SQLSTATE=' || sqlstate
  );
end;
$case$;


-- Final leak guard: the dedicated sentinel must not exist in any observable result row.
do $guard$
declare
  v_leak boolean;
begin
  select exists (
    select 1
      from pg_temp._p19a49_results result_row
     where position(
       'p19a49-output-secret-sentinel'
       in pg_catalog.to_jsonb(result_row)::text
     ) > 0
  )
  into v_leak;

  if v_leak then
    perform pg_temp._p19a49_record(
      'K',
      'fresh token sentinel is absent from observable runner output',
      'SUT_FAIL',
      'TOKEN_SENTINEL_LEAK_DETECTED'
    );
  end if;
end;
$guard$;


select scenario, name, status, detail from pg_temp._p19a49_results order by scenario;



select

  case when count(*) = 11 and count(*) filter (where status <> 'PASS') = 0

    then 'P19A_4_9_FRESH_TOKEN_RUNNER_PASS'

    else 'P19A_4_9_FRESH_TOKEN_RUNNER_FAIL' end as runner_result,

  count(*) as scenario_count,

  count(*) filter (where status = 'PASS') as pass_count,

  count(*) filter (where status = 'SUT_FAIL') as sut_fail_count,

  count(*) filter (where status = 'HARNESS_ERROR') as harness_error_count,

  coalesce(
    string_agg(
      scenario || ':' || status ||
      case when detail is not null then '[' || detail || ']' else '' end,
      ', ' order by scenario
    ) filter (where status <> 'PASS'),
    'NONE'
  ) as failures

from pg_temp._p19a49_results;



rollback;
