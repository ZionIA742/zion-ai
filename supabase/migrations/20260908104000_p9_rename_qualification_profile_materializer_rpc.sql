-- P9 - Rename qualification profile materializer RPC.
--
-- PostgreSQL identifiers are limited to 63 bytes.
-- The historical function name:
--
--   materialize_commercial_opportunity_profile_from_qualification_by_system
--
-- is 71 bytes and PostgreSQL physically truncated it to:
--
--   materialize_commercial_opportunity_profile_from_qualification_b
--
-- PostgREST therefore cannot resolve the 71-byte RPC name used by the
-- application.
--
-- This migration preserves the existing function body, owner, grants,
-- SECURITY DEFINER contract and authority semantics. It only renames the
-- physical function to an intentional <=63-byte canonical name:
--
--   materialize_opportunity_profile_from_qualification_by_system

do $preflight$
declare
  v_old_function oid;
  v_new_function oid;
begin
  v_old_function := pg_catalog.to_regprocedure(
    'public.materialize_commercial_opportunity_profile_from_qualification_b(uuid,uuid,uuid,text,text)'
  );

  v_new_function := pg_catalog.to_regprocedure(
    'public.materialize_opportunity_profile_from_qualification_by_system(uuid,uuid,uuid,text,text)'
  );

  if v_old_function is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: truncated qualification profile materializer is missing';
  end if;

  if v_new_function is not null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical qualification profile materializer name already exists';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = v_old_function
      and p.proname =
        'materialize_commercial_opportunity_profile_from_qualification_b'
      and p.prosecdef is true
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: materializer owner/security contract is unexpected';
  end if;

  if not pg_catalog.has_function_privilege(
      'service_role',
      v_old_function,
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      v_old_function,
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      v_old_function,
      'EXECUTE'
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: materializer grant contract is unexpected';
  end if;
end;
$preflight$;


alter function
  public.materialize_commercial_opportunity_profile_from_qualification_b(
    uuid,
    uuid,
    uuid,
    text,
    text
  )
rename to
  materialize_opportunity_profile_from_qualification_by_system;


do $postconditions$
declare
  v_function oid;
begin
  v_function := pg_catalog.to_regprocedure(
    'public.materialize_opportunity_profile_from_qualification_by_system(uuid,uuid,uuid,text,text)'
  );

  if v_function is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: renamed qualification profile materializer is missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname =
        'materialize_commercial_opportunity_profile_from_qualification_b'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: truncated materializer name still exists';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = v_function
      and p.proname =
        'materialize_opportunity_profile_from_qualification_by_system'
      and p.prosecdef is true
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: renamed materializer owner/security contract is invalid';
  end if;

  if not pg_catalog.has_function_privilege(
      'service_role',
      v_function,
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      v_function,
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      v_function,
      'EXECUTE'
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: renamed materializer grant contract is invalid';
  end if;
end;
$postconditions$;

notify pgrst, 'reload schema';