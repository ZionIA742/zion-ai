begin;

set transaction isolation level repeatable read;
set local lock_timeout = '10s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:action-readiness-scoped-reader:manual-checks:v1', 0)
);

create temp table _p9_action_readiness_scoped_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  details text
) on commit drop;

create or replace function pg_temp._p9_ar_scoped_record(
  p_number integer,
  p_name text,
  p_status text,
  p_details text default null
)
returns void
language plpgsql
as $function$
begin
  insert into _p9_action_readiness_scoped_results(
    scenario_number,
    scenario_name,
    status,
    details
  ) values (
    p_number,
    p_name,
    p_status,
    p_details
  )
  on conflict (scenario_number) do update
  set scenario_name = excluded.scenario_name,
      status = excluded.status,
      details = excluded.details;
end;
$function$;

create or replace function pg_temp._p9_ar_scoped_set_auth(
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
      else pg_catalog.json_build_object(
        'sub', coalesce(p_user_id::text, ''),
        'role', p_role
      )::text
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

create or replace function pg_temp._p9_ar_scoped_reset_auth()
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

create or replace function pg_temp._p9_ar_scoped_exec(
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
  perform pg_temp._p9_ar_scoped_set_auth(p_role, p_user_id);

  begin
    execute p_sql into v_value;
    perform pg_temp._p9_ar_scoped_reset_auth();
    return query select true, v_value, null::text, null::text;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;
      perform pg_temp._p9_ar_scoped_reset_auth();
      return query select false, null::text, v_state, v_message;
  end;
end;
$function$;

do $checks$
declare
  v_reader regprocedure := pg_catalog.to_regprocedure(
    'public.read_commercial_action_readiness_scoped(uuid,uuid,uuid,text)'
  );
  v_internal regprocedure := pg_catalog.to_regprocedure(
    'public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)'
  );
  v_org_id uuid;
  v_store_id uuid;
  v_opportunity_id uuid;
  v_user_id uuid;
  v_exec record;
  v_function oid;
  v_owner text;
  v_security_definer boolean;
  v_volatility "char";
  v_config text[];
  v_definition text;
begin
  if v_reader is null or v_internal is null then
    raise exception using
      errcode = 'P0001',
      message = 'FIXTURE_FAIL: scoped/internal action readiness functions are required';
  end if;

  perform pg_temp._p9_ar_scoped_record(
    1,
    'runtime grants are scoped',
    case
      when not pg_catalog.has_function_privilege(
             'public',
             'public.read_commercial_action_readiness_scoped(uuid,uuid,uuid,text)',
             'EXECUTE'
           )
       and not pg_catalog.has_function_privilege(
             'anon',
             'public.read_commercial_action_readiness_scoped(uuid,uuid,uuid,text)',
             'EXECUTE'
           )
       and pg_catalog.has_function_privilege(
             'authenticated',
             'public.read_commercial_action_readiness_scoped(uuid,uuid,uuid,text)',
             'EXECUTE'
           )
       and pg_catalog.has_function_privilege(
             'service_role',
             'public.read_commercial_action_readiness_scoped(uuid,uuid,uuid,text)',
             'EXECUTE'
           )
      then 'PASS' else 'SUT_FAIL'
    end,
    'authenticated/service_role allowed; public/anon denied'
  );

  perform pg_temp._p9_ar_scoped_record(
    2,
    'internal resolver remains private',
    case
      when not pg_catalog.has_function_privilege(
             'authenticated',
             'public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)',
             'EXECUTE'
           )
       and not pg_catalog.has_function_privilege(
             'service_role',
             'public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)',
             'EXECUTE'
           )
      then 'PASS' else 'SUT_FAIL'
    end,
    'integration must pass through the scoped reader'
  );

  v_function := v_reader::oid;

  select
    pg_catalog.pg_get_userbyid(proc_row.proowner),
    proc_row.prosecdef,
    proc_row.provolatile,
    proc_row.proconfig,
    pg_catalog.pg_get_functiondef(proc_row.oid)
  into
    v_owner,
    v_security_definer,
    v_volatility,
    v_config,
    v_definition
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_function;

  perform pg_temp._p9_ar_scoped_record(
    3,
    'reader hardening and exact authority delegation',
    case
      when v_owner = 'postgres'
       and v_security_definer is true
       and v_volatility = 's'
       and coalesce(v_config, '{}'::text[]) @> array[
         'row_security=off',
         'search_path=pg_catalog, pg_temp, public, extensions'
       ]::text[]
       and pg_catalog.strpos(v_definition, 'zion_resolve_request_role_internal') > 0
       and pg_catalog.strpos(v_definition, 'membership_row.is_active is true') > 0
       and pg_catalog.strpos(v_definition, 'p9_resolve_commercial_action_readiness_internal') > 0
      then 'PASS' else 'SUT_FAIL'
    end,
    'stable security-definer scoped reader delegates to the single internal readiness authority'
  );

  select
    opportunity_row.organization_id,
    opportunity_row.store_id,
    opportunity_row.id,
    membership_row.user_id
  into
    v_org_id,
    v_store_id,
    v_opportunity_id,
    v_user_id
  from public.commercial_opportunities opportunity_row
  join public.memberships membership_row
    on membership_row.organization_id = opportunity_row.organization_id
   and membership_row.is_active is true
   and membership_row.user_id is not null
  where exists (
    select 1
    from public.stores store_row
    where store_row.id = opportunity_row.store_id
      and store_row.organization_id = opportunity_row.organization_id
  )
  order by
    opportunity_row.organization_id,
    opportunity_row.store_id,
    opportunity_row.id,
    membership_row.user_id
  limit 1;

  if v_org_id is null
     or v_store_id is null
     or v_opportunity_id is null
     or v_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'FIXTURE_FAIL: no opportunity with active organization membership';
  end if;

  select * into v_exec
  from pg_temp._p9_ar_scoped_exec(
    'service_role',
    null,
    pg_catalog.format(
      $sql$select readiness_state from public.read_commercial_action_readiness_scoped(%L::uuid,%L::uuid,%L::uuid,'send_quote')$sql$,
      v_org_id,
      v_store_id,
      v_opportunity_id
    )
  );

  perform pg_temp._p9_ar_scoped_record(
    4,
    'service_role can use scoped readiness reader',
    case when v_exec.operation_succeeded and v_exec.value_text in ('ready','blocked','needs_resolution','conflict')
      then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.value_text, coalesce(v_exec.returned_sqlstate || ' ' || v_exec.message_text, '<null>'))
  );

  select * into v_exec
  from pg_temp._p9_ar_scoped_exec(
    'authenticated',
    v_user_id,
    pg_catalog.format(
      $sql$select readiness_state from public.read_commercial_action_readiness_scoped(%L::uuid,%L::uuid,%L::uuid,'send_quote')$sql$,
      v_org_id,
      v_store_id,
      v_opportunity_id
    )
  );

  perform pg_temp._p9_ar_scoped_record(
    5,
    'active authenticated member can use scoped readiness reader',
    case when v_exec.operation_succeeded and v_exec.value_text in ('ready','blocked','needs_resolution','conflict')
      then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.value_text, coalesce(v_exec.returned_sqlstate || ' ' || v_exec.message_text, '<null>'))
  );

  select * into v_exec
  from pg_temp._p9_ar_scoped_exec(
    'authenticated',
    v_user_id,
    pg_catalog.format(
      $sql$select readiness_state from public.read_commercial_action_readiness_scoped(%L::uuid,%L::uuid,%L::uuid,'send_quote')$sql$,
      '00000000-0000-0000-0000-000000000000'::uuid,
      v_store_id,
      v_opportunity_id
    )
  );

  perform pg_temp._p9_ar_scoped_record(
    6,
    'mismatched tenant scope fails closed',
    case when not v_exec.operation_succeeded and v_exec.returned_sqlstate = '42501'
      then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.returned_sqlstate || ' ' || v_exec.message_text, coalesce(v_exec.value_text, '<null>'))
  );

  select * into v_exec
  from pg_temp._p9_ar_scoped_exec(
    'authenticated',
    v_user_id,
    pg_catalog.format(
      $sql$select readiness_state from public.read_commercial_action_readiness_scoped(%L::uuid,%L::uuid,%L::uuid,'not_a_real_action')$sql$,
      v_org_id,
      v_store_id,
      v_opportunity_id
    )
  );

  perform pg_temp._p9_ar_scoped_record(
    7,
    'unsupported action still fails through canonical internal authority',
    case when not v_exec.operation_succeeded and v_exec.returned_sqlstate = '22023'
      then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.returned_sqlstate || ' ' || v_exec.message_text, coalesce(v_exec.value_text, '<null>'))
  );
end;
$checks$;

do $summary$
declare
  v_total integer;
  v_pass integer;
  v_fail integer;
  v_details text;
begin
  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (where status = 'PASS')::integer,
    pg_catalog.count(*) filter (where status <> 'PASS')::integer
  into v_total, v_pass, v_fail
  from _p9_action_readiness_scoped_results;

  if v_total <> 7 then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'P9_ACTION_READINESS_SCOPED_RUNNER_INCOMPLETE expected=7 actual=%s',
        v_total
      );
  end if;

  if v_fail <> 0 then
    select pg_catalog.string_agg(
      pg_catalog.format('%s:%s:%s:%s', scenario_number, scenario_name, status, coalesce(details, '')),
      E'\n'
      order by scenario_number
    )
    into v_details
    from _p9_action_readiness_scoped_results
    where status <> 'PASS';

    raise exception using
      errcode = 'P0001',
      message = 'P9_ACTION_READINESS_SCOPED_RUNNER_FAILED',
      detail = v_details;
  end if;

  raise notice 'P9 action readiness scoped reader manual checks passed: %/%', v_pass, v_total;
end;
$summary$;

rollback;
