begin;

set local lock_timeout = '5s';

-- Restrict the legacy customer pause writer to trusted backend callers.
-- Preserve its implementation and the existing canonical AI guard.

do $preflight$
declare
  v_writer oid;
  v_guard oid;
begin
  v_writer := pg_catalog.to_regprocedure(
    'public.apply_customer_pause_window(uuid,uuid,uuid)'
  );

  v_guard := pg_catalog.to_regprocedure(
    'public.can_ai_reply_now(uuid,uuid,uuid)'
  );

  if v_writer is null or v_guard is null then
    raise exception 'P9_PAUSE_REQUIRED_FUNCTION_MISSING';
  end if;

  if pg_catalog.md5(
       pg_catalog.pg_get_functiondef(v_writer)
     ) is distinct from
       '599f476cb4d392f3585c5a6affa66f3f'
  then
    raise exception 'P9_PAUSE_WRITER_BASELINE_DRIFT';
  end if;

  if pg_catalog.md5(
       pg_catalog.pg_get_functiondef(v_guard)
     ) is distinct from
       'dfb487581b881a4cee9c1aa3510cb084'
  then
    raise exception 'P9_PAUSE_GUARD_BASELINE_DRIFT';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_proc p
     where p.oid = v_writer
       and p.prosecdef
       and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  ) then
    raise exception 'P9_PAUSE_WRITER_AUTHORITY_DRIFT';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_proc p
     where p.oid = v_guard
       and p.prosecdef
       and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  ) then
    raise exception 'P9_PAUSE_GUARD_AUTHORITY_DRIFT';
  end if;

  if not pg_catalog.has_function_privilege(
    'service_role',v_writer,'EXECUTE'
  ) then
    raise exception 'P9_PAUSE_SERVICE_ROLE_BASELINE_INVALID';
  end if;
end;
$preflight$;

revoke all on function
  public.apply_customer_pause_window(uuid,uuid,uuid)
  from public, anon, authenticated;

grant execute on function
  public.apply_customer_pause_window(uuid,uuid,uuid)
  to service_role;

do $postcondition$
declare
  v_writer oid := pg_catalog.to_regprocedure(
    'public.apply_customer_pause_window(uuid,uuid,uuid)'
  );

  v_guard oid := pg_catalog.to_regprocedure(
    'public.can_ai_reply_now(uuid,uuid,uuid)'
  );
begin
  if pg_catalog.has_function_privilege(
    'anon',v_writer,'EXECUTE'
  ) then
    raise exception 'P9_PAUSE_ANON_EXECUTE_REMAINS';
  end if;

  if pg_catalog.has_function_privilege(
    'authenticated',v_writer,'EXECUTE'
  ) then
    raise exception 'P9_PAUSE_AUTHENTICATED_EXECUTE_REMAINS';
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
     where p.oid = v_writer
       and a.grantee = 0
       and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'P9_PAUSE_PUBLIC_EXECUTE_REMAINS';
  end if;

  if not pg_catalog.has_function_privilege(
    'service_role',v_writer,'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'postgres',v_writer,'EXECUTE'
  ) then
    raise exception 'P9_PAUSE_BACKEND_AUTHORITY_LOST';
  end if;

  if not pg_catalog.has_function_privilege(
    'service_role',v_guard,'EXECUTE'
  ) then
    raise exception 'P9_PAUSE_CANONICAL_GUARD_AUTHORITY_LOST';
  end if;

  if pg_catalog.md5(
    pg_catalog.pg_get_functiondef(v_writer)
  ) is distinct from
    '599f476cb4d392f3585c5a6affa66f3f'
  then
    raise exception 'P9_PAUSE_WRITER_DEFINITION_CHANGED';
  end if;

  if pg_catalog.md5(
    pg_catalog.pg_get_functiondef(v_guard)
  ) is distinct from
    'dfb487581b881a4cee9c1aa3510cb084'
  then
    raise exception 'P9_PAUSE_GUARD_DEFINITION_CHANGED';
  end if;
end;
$postcondition$;

commit;
