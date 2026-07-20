begin;

-- ZION / Pilar 9 / Fase 4 / 4.1B-4
-- Endurece default privileges futuros de funcoes no schema public.
--
-- Escopo:
-- - remove EXECUTE padrao futuro para PUBLIC, anon e authenticated;
-- - trata separadamente owners postgres e supabase_admin;
-- - nao altera grants de funcoes historicas;
-- - preserva o modelo deny-by-default com grants explicitos por funcao.

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:public-function-default-privileges-hardening:v1',
    0
  )
);

do $preflight$
declare
  v_executor_is_superuser boolean;
begin
  if pg_catalog.to_regnamespace('public') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public schema is missing';
  end if;

  if pg_catalog.to_regrole('postgres') is null
     or pg_catalog.to_regrole('supabase_admin') is null
     or pg_catalog.to_regrole('anon') is null
     or pg_catalog.to_regrole('authenticated') is null
     or pg_catalog.to_regrole('service_role') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: one or more required roles are missing';
  end if;

  select role_row.rolsuper
  into v_executor_is_superuser
  from pg_catalog.pg_roles role_row
  where role_row.rolname = current_user;

  if coalesce(v_executor_is_superuser, false) is not true
     and current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'precondition failed: migration must run as postgres or a superuser-equivalent role to alter default privileges for postgres and supabase_admin';
  end if;
end;
$preflight$;

-- Nao concede service_role por default. Novas funcoes devem receber grants
-- explicitos por allowlist auditada.
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

alter default privileges for role postgres in schema public
  revoke execute on functions from authenticated;

alter default privileges for role supabase_admin in schema public
  revoke execute on functions from public;

alter default privileges for role supabase_admin in schema public
  revoke execute on functions from anon;

alter default privileges for role supabase_admin in schema public
  revoke execute on functions from authenticated;

do $postconditions$
declare
  v_public_namespace oid := 'public'::pg_catalog.regnamespace;
begin
  if exists (
    with owners as (
      select unnest(
        array[
          'postgres'::pg_catalog.regrole,
          'supabase_admin'::pg_catalog.regrole
        ]
      ) as owner_oid
    ),
    effective_defaults as (
      select
        owner_row.owner_oid,
        coalesce(
          (
            select default_acl_row.defaclacl
            from pg_catalog.pg_default_acl default_acl_row
            where default_acl_row.defaclrole = owner_row.owner_oid
              and default_acl_row.defaclnamespace = v_public_namespace
              and default_acl_row.defaclobjtype = 'f'
          ),
          pg_catalog.acldefault('f', owner_row.owner_oid)
        ) as acl_items
      from owners owner_row
    )
    select 1
    from effective_defaults default_row
    cross join lateral pg_catalog.aclexplode(default_row.acl_items) privilege_row
    where privilege_row.privilege_type = 'EXECUTE'
      and privilege_row.grantee in (
        0,
        'anon'::pg_catalog.regrole::oid,
        'authenticated'::pg_catalog.regrole::oid
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: one or more public function default privileges still expose EXECUTE to PUBLIC, anon or authenticated';
  end if;
end;
$postconditions$;

commit;
