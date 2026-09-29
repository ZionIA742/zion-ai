begin;

create temp table p9_whatsapp_gate_role_repair_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  detail text not null
) on commit preserve rows;

create or replace function pg_temp._p9_gate_role_record(
  p_number integer,
  p_name text,
  p_ok boolean,
  p_detail text
)
returns void
language plpgsql
as $function$
begin
  insert into p9_whatsapp_gate_role_repair_results (
    scenario_number,
    scenario_name,
    status,
    detail
  )
  values (
    p_number,
    p_name,
    case when p_ok then 'PASS' else 'SUT_FAIL' end,
    coalesce(p_detail, '<null>')
  );
end;
$function$;

-- 1. Exact gate signature remains installed --------------------------------
do $scenario$
declare
  v_oid regprocedure;
begin
  v_oid := to_regprocedure(
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'
  );

  perform pg_temp._p9_gate_role_record(
    1,
    'final external send gate signature remains installed',
    v_oid is not null,
    coalesce(v_oid::text, '<missing>')
  );
exception when others then
  perform pg_temp._p9_gate_role_record(
    1,
    'final external send gate signature remains installed',
    false,
    sqlstate || ' ' || sqlerrm
  );
end;
$scenario$;

-- 2. Owner and SECURITY DEFINER are preserved -------------------------------
do $scenario$
declare
  v_owner text;
  v_security_definer boolean;
begin
  select
    pg_get_userbyid(p.proowner),
    p.prosecdef
  into
    v_owner,
    v_security_definer
  from pg_proc p
  where p.oid =
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'::regprocedure;

  perform pg_temp._p9_gate_role_record(
    2,
    'gate preserves postgres owner and security definer',
    v_owner = 'postgres' and v_security_definer,
    format('owner=%s security_definer=%s', v_owner, v_security_definer)
  );
exception when others then
  perform pg_temp._p9_gate_role_record(
    2,
    'gate preserves postgres owner and security definer',
    false,
    sqlstate || ' ' || sqlerrm
  );
end;
$scenario$;

-- 3. Hardened execution config is preserved --------------------------------
do $scenario$
declare
  v_config text[];
  v_search_path_ok boolean;
  v_row_security_ok boolean;
begin
  select p.proconfig
  into v_config
  from pg_proc p
  where p.oid =
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'::regprocedure;

  select
    exists (
      select 1
      from unnest(coalesce(v_config, array[]::text[])) cfg
      where cfg like 'search_path=%pg_catalog%pg_temp%public%'
    ),
    exists (
      select 1
      from unnest(coalesce(v_config, array[]::text[])) cfg
      where cfg = 'row_security=off'
    )
  into
    v_search_path_ok,
    v_row_security_ok;

  perform pg_temp._p9_gate_role_record(
    3,
    'gate preserves fixed search_path and row_security off',
    v_search_path_ok and v_row_security_ok,
    format(
      'search_path_ok=%s row_security_ok=%s config=%s',
      v_search_path_ok,
      v_row_security_ok,
      array_to_string(v_config, ' | ')
    )
  );
exception when others then
  perform pg_temp._p9_gate_role_record(
    3,
    'gate preserves fixed search_path and row_security off',
    false,
    sqlstate || ' ' || sqlerrm
  );
end;
$scenario$;

-- 4. Legacy request.jwt.claim.role source is still accepted -----------------
do $scenario$
declare
  v_definition text;
  v_legacy_pos integer;
begin
  select pg_get_functiondef(
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'::regprocedure
  )
  into v_definition;

  v_legacy_pos := position(
    'current_setting(''request.jwt.claim.role'', true)'
    in v_definition
  );

  perform pg_temp._p9_gate_role_record(
    4,
    'legacy request.jwt.claim.role source remains in role resolution',
    v_legacy_pos > 0,
    format('legacy_position=%s', v_legacy_pos)
  );
exception when others then
  perform pg_temp._p9_gate_role_record(
    4,
    'legacy request.jwt.claim.role source remains in role resolution',
    false,
    sqlstate || ' ' || sqlerrm
  );
end;
$scenario$;

-- 5. auth.jwt role fallback is installed after legacy source ----------------
do $scenario$
declare
  v_definition text;
  v_legacy_pos integer;
  v_auth_jwt_pos integer;
  v_coalesce_pos integer;
begin
  select pg_get_functiondef(
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'::regprocedure
  )
  into v_definition;

  v_legacy_pos := position(
    'current_setting(''request.jwt.claim.role'', true)'
    in v_definition
  );
  v_auth_jwt_pos := position('auth.jwt()' in v_definition);
  v_coalesce_pos := position('v_request_role text := coalesce(' in v_definition);

  perform pg_temp._p9_gate_role_record(
    5,
    'role resolution falls back to auth.jwt after legacy claim',
    v_coalesce_pos > 0
      and v_legacy_pos > v_coalesce_pos
      and v_auth_jwt_pos > v_legacy_pos,
    format(
      'coalesce=%s legacy=%s auth_jwt=%s',
      v_coalesce_pos,
      v_legacy_pos,
      v_auth_jwt_pos
    )
  );
exception when others then
  perform pg_temp._p9_gate_role_record(
    5,
    'role resolution falls back to auth.jwt after legacy claim',
    false,
    sqlstate || ' ' || sqlerrm
  );
end;
$scenario$;

-- 6. service_role execute grant is preserved --------------------------------
do $scenario$
declare
  v_allowed boolean;
begin
  v_allowed := has_function_privilege(
    'service_role',
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)',
    'EXECUTE'
  );

  perform pg_temp._p9_gate_role_record(
    6,
    'service_role keeps execute privilege on final gate',
    v_allowed,
    format('service_role_execute=%s', v_allowed)
  );
exception when others then
  perform pg_temp._p9_gate_role_record(
    6,
    'service_role keeps execute privilege on final gate',
    false,
    sqlstate || ' ' || sqlerrm
  );
end;
$scenario$;

-- 7. anon/authenticated execute stays revoked -------------------------------
do $scenario$
declare
  v_anon boolean;
  v_authenticated boolean;
begin
  v_anon := has_function_privilege(
    'anon',
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)',
    'EXECUTE'
  );
  v_authenticated := has_function_privilege(
    'authenticated',
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)',
    'EXECUTE'
  );

  perform pg_temp._p9_gate_role_record(
    7,
    'anon and authenticated remain unable to execute final gate',
    not v_anon and not v_authenticated,
    format('anon=%s authenticated=%s', v_anon, v_authenticated)
  );
exception when others then
  perform pg_temp._p9_gate_role_record(
    7,
    'anon and authenticated remain unable to execute final gate',
    false,
    sqlstate || ' ' || sqlerrm
  );
end;
$scenario$;

-- 8. PUBLIC execute stays revoked -------------------------------------------
do $scenario$
declare
  v_public_execute boolean;
begin
  select exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) acl
    where p.oid =
      'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  )
  into v_public_execute;

  perform pg_temp._p9_gate_role_record(
    8,
    'PUBLIC execute privilege remains revoked',
    not v_public_execute,
    format('public_execute=%s', v_public_execute)
  );
exception when others then
  perform pg_temp._p9_gate_role_record(
    8,
    'PUBLIC execute privilege remains revoked',
    false,
    sqlstate || ' ' || sqlerrm
  );
end;
$scenario$;

-- 9. Argument validation still executes after authorization -----------------
do $scenario$
begin
  begin
    perform public.validate_or_cancel_whatsapp_external_send_by_system(
      null,
      null,
      null
    );

    perform pg_temp._p9_gate_role_record(
      9,
      'required argument validation remains intact',
      false,
      'gate unexpectedly accepted null arguments'
    );
  exception when others then
    perform pg_temp._p9_gate_role_record(
      9,
      'required argument validation remains intact',
      sqlstate = '22023'
        and sqlerrm = 'WHATSAPP_EXTERNAL_SEND_GATE_ARGUMENTS_REQUIRED',
      sqlstate || ' ' || sqlerrm
    );
  end;
end;
$scenario$;

-- 10. Message scope lookup remains intact -----------------------------------
do $scenario$
begin
  begin
    perform public.validate_or_cancel_whatsapp_external_send_by_system(
      gen_random_uuid(),
      gen_random_uuid(),
      gen_random_uuid()
    );

    perform pg_temp._p9_gate_role_record(
      10,
      'missing message still fails closed after role repair',
      false,
      'gate unexpectedly accepted a missing message'
    );
  exception when others then
    perform pg_temp._p9_gate_role_record(
      10,
      'missing message still fails closed after role repair',
      sqlstate = 'P0002'
        and sqlerrm = 'WHATSAPP_EXTERNAL_SEND_GATE_MESSAGE_NOT_FOUND_IN_SCOPE',
      sqlstate || ' ' || sqlerrm
    );
  end;
end;
$scenario$;

select
  scenario_number,
  scenario_name,
  status,
  detail
from p9_whatsapp_gate_role_repair_results
order by scenario_number;

select
  count(*) filter (where status = 'PASS') as passed,
  count(*) filter (where status = 'SUT_FAIL') as sut_failed,
  count(*) as total
from p9_whatsapp_gate_role_repair_results;

select count(*) as failed_scenarios
from p9_whatsapp_gate_role_repair_results
where status <> 'PASS';

rollback;
