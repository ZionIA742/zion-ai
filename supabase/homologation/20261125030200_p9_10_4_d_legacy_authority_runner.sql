begin;

set local lock_timeout='5s';
set local statement_timeout='30s';

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


set local role anon;

do $denied$
begin
  if current_user <> 'anon' then
    raise exception 'P9_AUTHORITY_ROLE_NOT_EFFECTIVE';
  end if;

  if pg_catalog.has_function_privilege(
    current_user,
    'public.assistant_push_system_message(uuid,uuid,text,text,uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    current_user,
    'public.apply_customer_pause_window(uuid,uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'P9_UNTRUSTED_AUTHORITY_REMAINS';
  end if;

  begin
    perform public.assistant_push_system_message(
      null::uuid,
      null::uuid,
      ''::text,
      'text'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      '{}'::jsonb
    );

    raise exception 'P9_ASSISTANT_UNEXPECTED_EXECUTION';

  exception when insufficient_privilege then
    if sqlerrm not like
      'permission denied for function assistant_push_system_message%'
    then
      raise;
    end if;
  end;

  begin
    perform public.apply_customer_pause_window(
      null::uuid,null::uuid,null::uuid
    );

    raise exception 'P9_PAUSE_UNEXPECTED_EXECUTION';

  exception when insufficient_privilege then
    if sqlerrm not like
      'permission denied for function apply_customer_pause_window%'
    then
      raise;
    end if;
  end;
end;
$denied$;

reset role;

select 'anon_both_writers_denied' as test,
       'PASS' as result;



set local role authenticated;

do $denied$
begin
  if current_user <> 'authenticated' then
    raise exception 'P9_AUTHORITY_ROLE_NOT_EFFECTIVE';
  end if;

  if pg_catalog.has_function_privilege(
    current_user,
    'public.assistant_push_system_message(uuid,uuid,text,text,uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    current_user,
    'public.apply_customer_pause_window(uuid,uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'P9_UNTRUSTED_AUTHORITY_REMAINS';
  end if;

  begin
    perform public.assistant_push_system_message(
      null::uuid,
      null::uuid,
      ''::text,
      'text'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      '{}'::jsonb
    );

    raise exception 'P9_ASSISTANT_UNEXPECTED_EXECUTION';

  exception when insufficient_privilege then
    if sqlerrm not like
      'permission denied for function assistant_push_system_message%'
    then
      raise;
    end if;
  end;

  begin
    perform public.apply_customer_pause_window(
      null::uuid,null::uuid,null::uuid
    );

    raise exception 'P9_PAUSE_UNEXPECTED_EXECUTION';

  exception when insufficient_privilege then
    if sqlerrm not like
      'permission denied for function apply_customer_pause_window%'
    then
      raise;
    end if;
  end;
end;
$denied$;

reset role;

select 'authenticated_both_writers_denied' as test,
       'PASS' as result;


set local role service_role;

do $service_probe$
begin
  if current_user <> 'service_role' then
    raise exception 'P9_SERVICE_ROLE_NOT_EFFECTIVE';
  end if;

  if not pg_catalog.has_function_privilege(
    current_user,
    'public.assistant_push_system_message(uuid,uuid,text,text,uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    current_user,
    'public.apply_customer_pause_window(uuid,uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'P9_SERVICE_AUTHORITY_MISSING';
  end if;

  if public.apply_customer_pause_window(
    null::uuid,null::uuid,null::uuid
  ) is distinct from false then
    raise exception 'P9_PAUSE_EMPTY_SCOPE_UNEXPECTED';
  end if;

  begin
    perform public.assistant_push_system_message(
      null::uuid,
      null::uuid,
      ''::text,
      'text'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      '{}'::jsonb
    );

    raise exception 'P9_EMPTY_MESSAGE_UNEXPECTEDLY_ACCEPTED';

  exception when raise_exception then
    if sqlerrm <> 'MENSAGEM_VAZIA' then
      raise;
    end if;
  end;
end;
$service_probe$;

reset role;

select 'service_role_function_entry_preserved' as test,
       'PASS' as result;

rollback;

do $rollback_check$
declare
  v_assistant oid := pg_catalog.to_regprocedure(
    'public.assistant_push_system_message(uuid,uuid,text,text,uuid,uuid,uuid,jsonb)'
  );

  v_pause oid := pg_catalog.to_regprocedure(
    'public.apply_customer_pause_window(uuid,uuid,uuid)'
  );

  v_guard oid := pg_catalog.to_regprocedure(
    'public.can_ai_reply_now(uuid,uuid,uuid)'
  );
begin
  if v_assistant is null
     or v_pause is null
     or v_guard is null then
    raise exception 'P9_ROLLBACK_FUNCTION_MISSING';
  end if;

  if pg_catalog.md5(
    pg_catalog.pg_get_functiondef(v_assistant)
  ) is distinct from 'd3937025c1e64ef154f0733b8efd4e34'
  or pg_catalog.md5(
    pg_catalog.pg_get_functiondef(v_pause)
  ) is distinct from '599f476cb4d392f3585c5a6affa66f3f'
  or pg_catalog.md5(
    pg_catalog.pg_get_functiondef(v_guard)
  ) is distinct from 'dfb487581b881a4cee9c1aa3510cb084'
  then
    raise exception 'P9_AUTHORITY_ROLLBACK_DEFINITION_DRIFT';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid=v_assistant
      and p.proacl::text=
        '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
  ) or not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid=v_pause
      and p.proacl::text=
        '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
  ) or not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid=v_guard
      and p.proacl::text=
        '{postgres=X/postgres,service_role=X/postgres}'
  ) then
    raise exception 'P9_AUTHORITY_ROLLBACK_ACL_DRIFT';
  end if;
end;
$rollback_check$;

select 'original_definitions_and_acls_restored' as test,
       'PASS' as result;
