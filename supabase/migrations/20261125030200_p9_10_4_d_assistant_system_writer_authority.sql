begin;

set local lock_timeout = '5s';

do $preflight$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.assistant_push_system_message(uuid,uuid,text,text,uuid,uuid,uuid,jsonb)'
  );
begin
  if v_oid is null then
    raise exception 'P9_ASSISTANT_WRITER_MISSING';
  end if;

  if pg_catalog.md5(
    pg_catalog.pg_get_functiondef(v_oid)
  ) is distinct from 'd3937025c1e64ef154f0733b8efd4e34' then
    raise exception 'P9_ASSISTANT_WRITER_BASELINE_DRIFT';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid=v_oid
      and p.prosecdef
      and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
  ) then
    raise exception 'P9_ASSISTANT_WRITER_OWNER_DRIFT';
  end if;

  if not pg_catalog.has_function_privilege(
    'service_role',v_oid,'EXECUTE'
  ) then
    raise exception 'P9_ASSISTANT_BACKEND_BASELINE_INVALID';
  end if;
end;
$preflight$;

revoke all on function
  public.assistant_push_system_message(uuid,uuid,text,text,uuid,uuid,uuid,jsonb)
  from public, anon, authenticated;

grant execute on function
  public.assistant_push_system_message(uuid,uuid,text,text,uuid,uuid,uuid,jsonb)
  to service_role;

do $postcondition$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.assistant_push_system_message(uuid,uuid,text,text,uuid,uuid,uuid,jsonb)'
  );
begin
  if pg_catalog.has_function_privilege(
    'anon',v_oid,'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',v_oid,'EXECUTE'
  ) then
    raise exception 'P9_ASSISTANT_UNTRUSTED_EXECUTE_REMAINS';
  end if;

  if not pg_catalog.has_function_privilege(
    'service_role',v_oid,'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'postgres',v_oid,'EXECUTE'
  ) then
    raise exception 'P9_ASSISTANT_BACKEND_AUTHORITY_LOST';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        p.proacl,
        pg_catalog.acldefault('f',p.proowner)
      )
    ) a
    where p.oid=v_oid
      and a.privilege_type='EXECUTE'
      and a.grantee not in (
        p.proowner,
        'service_role'::regrole::oid
      )
  ) then
    raise exception 'P9_ASSISTANT_UNEXPECTED_GRANT';
  end if;

  if pg_catalog.md5(
    pg_catalog.pg_get_functiondef(v_oid)
  ) is distinct from 'd3937025c1e64ef154f0733b8efd4e34' then
    raise exception 'P9_ASSISTANT_WRITER_DEFINITION_CHANGED';
  end if;
end;
$postcondition$;

commit;
