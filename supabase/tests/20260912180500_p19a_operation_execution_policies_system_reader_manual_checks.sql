-- P19-A / Block 3 / Operation
-- Manual checks for the protected system reader of canonical execution policies.
-- Read-only with respect to business data.

do $$
declare
  v_owner text;
  v_security_definer boolean;
  v_config text[];
begin
  if to_regprocedure(
    'public.read_store_operation_execution_policies_by_system(uuid,uuid)'
  ) is null then
    raise exception 'missing read_store_operation_execution_policies_by_system(uuid,uuid)';
  end if;

  select
    pg_catalog.pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.proconfig
  into
    v_owner,
    v_security_definer,
    v_config
  from pg_catalog.pg_proc proc
  where proc.oid = to_regprocedure(
    'public.read_store_operation_execution_policies_by_system(uuid,uuid)'
  )::oid;

  if v_owner <> 'postgres' then
    raise exception 'system reader owner must be postgres, got %', v_owner;
  end if;

  if v_security_definer is distinct from true then
    raise exception 'system reader must be SECURITY DEFINER';
  end if;

  if not ('search_path=pg_catalog, public, pg_temp' = any(coalesce(v_config, array[]::text[]))) then
    raise exception 'system reader must use the fixed safe search_path';
  end if;

  if not ('row_security=off' = any(coalesce(v_config, array[]::text[]))) then
    raise exception 'system reader must set row_security=off';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.read_store_operation_execution_policies_by_system(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'service_role must have EXECUTE on the system reader';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.read_store_operation_execution_policies_by_system(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated must not have EXECUTE on the system reader';
  end if;

  if has_function_privilege(
    'anon',
    'public.read_store_operation_execution_policies_by_system(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'anon must not have EXECUTE on the system reader';
  end if;

  if has_function_privilege(
    'public',
    'public.read_store_operation_execution_policies_by_system(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'public must not have EXECUTE on the system reader';
  end if;
end;
$$;

do $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  begin
    perform public.read_store_operation_execution_policies_by_system(
      '00000000-0000-0000-0000-000000000000'::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    );

    raise exception 'authenticated execution was unexpectedly accepted';
  exception
    when insufficient_privilege then
      null;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.role', '', true);
end;
$$;

do $$
declare
  v_expected public.store_operation_execution_policies%rowtype;
  v_actual public.store_operation_execution_policies%rowtype;
begin
  select policy_row.*
  into v_expected
  from public.store_operation_execution_policies policy_row
  join public.stores store_row
    on store_row.id = policy_row.store_id
   and store_row.organization_id = policy_row.organization_id
  order by policy_row.updated_at desc nulls last
  limit 1;

  if not found then
    raise exception 'fixture prerequisite: no canonical operation execution policy row exists';
  end if;

  execute 'set local role service_role';
  perform set_config('request.jwt.claim.role', 'service_role', true);

  select *
  into v_actual
  from public.read_store_operation_execution_policies_by_system(
    v_expected.organization_id,
    v_expected.store_id
  );

  if to_jsonb(v_actual) is distinct from to_jsonb(v_expected) then
    raise exception 'system reader result differs from canonical execution-policy row';
  end if;

  if v_actual.technical_services_policy
       is distinct from v_expected.technical_services_policy
     or v_actual.technical_services_configured_at
       is distinct from v_expected.technical_services_configured_at
  then
    raise exception 'technical-services authority was not preserved by the system reader';
  end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.role', '', true);
end;
$$;

do $$
declare
  v_organization_id uuid;
  v_store_id uuid;
  v_wrong_organization_id uuid;
begin
  select
    policy_row.organization_id,
    policy_row.store_id
  into
    v_organization_id,
    v_store_id
  from public.store_operation_execution_policies policy_row
  join public.stores store_row
    on store_row.id = policy_row.store_id
   and store_row.organization_id = policy_row.organization_id
  limit 1;

  if not found then
    raise exception 'fixture prerequisite: no canonical operation execution policy row exists';
  end if;

  v_wrong_organization_id :=
    case
      when v_organization_id <> '00000000-0000-0000-0000-000000000000'::uuid
        then '00000000-0000-0000-0000-000000000000'::uuid
      else '11111111-1111-1111-1111-111111111111'::uuid
    end;

  execute 'set local role service_role';
  perform set_config('request.jwt.claim.role', 'service_role', true);

  begin
    perform public.read_store_operation_execution_policies_by_system(
      v_wrong_organization_id,
      v_store_id
    );

    raise exception 'cross-scope system read was unexpectedly accepted';
  exception
    when sqlstate '42501' then
      null;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.role', '', true);
end;
$$;

select
  'PASS - protected operation execution policies system reader' as result;
