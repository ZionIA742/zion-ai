begin;

set transaction isolation level repeatable read;
set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_qfact_role_hardening_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create or replace function pg_temp._p9_qfact_role_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_ok boolean,
  p_detail text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_qfact_role_hardening_results(
    scenario_number,
    scenario_name,
    status,
    detail
  )
  values (
    p_scenario_number,
    p_scenario_name,
    case when p_ok then 'PASS' else 'SUT_FAIL' end,
    p_detail
  );
end;
$function$;

do $checks$
declare
  v_writer_oid oid := 'public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)'::regprocedure::oid;
  v_writer_def text;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
  v_helper_claims_role text;
  v_helper_direct_role text;
  v_public_execute boolean;
begin
  select pg_catalog.pg_get_functiondef(v_writer_oid)
  into v_writer_def;

  select
    role_row.rolname,
    proc_row.prosecdef,
    proc_row.proconfig
  into
    v_owner,
    v_security_definer,
    v_config
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_roles role_row
    on role_row.oid = proc_row.proowner
  where proc_row.oid = v_writer_oid;

  perform pg_temp._p9_qfact_role_record(
    1,
    'writer usa resolver canônico de request role',
    v_writer_def ilike '%public.lead_customer_link_request_role()%',
    'writer definition delegates request-role resolution to lead_customer_link_request_role()'
  );

  perform pg_temp._p9_qfact_role_record(
    2,
    'writer mantém security definer owner postgres e hardening de sessão',
    v_owner = 'postgres'
      and v_security_definer is true
      and coalesce(v_config, '{}'::text[]) @> array['search_path=pg_catalog, pg_temp, public']::text[]
      and coalesce(v_config, '{}'::text[]) @> array['row_security=off']::text[],
    pg_catalog.format('owner=%s security_definer=%s config=%s', v_owner, v_security_definer, coalesce(v_config::text, 'null'))
  );

  select exists (
    select 1
    from pg_catalog.pg_proc proc_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(proc_row.proacl, pg_catalog.acldefault('f', proc_row.proowner))
    ) acl_row
    where proc_row.oid = v_writer_oid
      and acl_row.grantee = 0
      and acl_row.privilege_type = 'EXECUTE'
  )
  into v_public_execute;

  perform pg_temp._p9_qfact_role_record(
    3,
    'grants permitem somente service_role além do owner',
    pg_catalog.has_function_privilege('service_role', v_writer_oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', v_writer_oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('anon', v_writer_oid, 'EXECUTE')
      and not v_public_execute,
    pg_catalog.format(
      'service_role=%s authenticated=%s anon=%s public=%s',
      pg_catalog.has_function_privilege('service_role', v_writer_oid, 'EXECUTE'),
      pg_catalog.has_function_privilege('authenticated', v_writer_oid, 'EXECUTE'),
      pg_catalog.has_function_privilege('anon', v_writer_oid, 'EXECUTE'),
      v_public_execute
    )
  );

  perform pg_catalog.set_config('request.jwt.claim.role', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_helper_claims_role := public.lead_customer_link_request_role();

  perform pg_temp._p9_qfact_role_record(
    4,
    'resolver recupera service_role de request.jwt.claims',
    v_helper_claims_role = 'service_role',
    pg_catalog.format('resolved_role=%s', coalesce(v_helper_claims_role, '<null>'))
  );

  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claims', '{}', true);
  v_helper_direct_role := public.lead_customer_link_request_role();

  perform pg_temp._p9_qfact_role_record(
    5,
    'resolver preserva claim role direto quando disponível',
    v_helper_direct_role = 'service_role',
    pg_catalog.format('resolved_role=%s', coalesce(v_helper_direct_role, '<null>'))
  );
exception
  when others then
    insert into pg_temp._p9_qfact_role_hardening_results(
      scenario_number,
      scenario_name,
      status,
      detail
    )
    values (
      99,
      'runner harness',
      'HARNESS_ERROR',
      pg_catalog.format('%s %s', sqlstate, sqlerrm)
    )
    on conflict (scenario_number) do update
      set status = excluded.status,
          detail = excluded.detail;
end;
$checks$;

select
  scenario_number,
  scenario_name,
  status,
  detail
from pg_temp._p9_qfact_role_hardening_results
order by scenario_number;

select
  pg_catalog.count(*) as failed_scenarios
from pg_temp._p9_qfact_role_hardening_results
where status <> 'PASS';

rollback;
