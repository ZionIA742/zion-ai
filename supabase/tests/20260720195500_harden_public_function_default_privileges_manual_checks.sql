-- ZION / Pilar 9 / Fase 4 / 4.1B-4
-- Runner manual somente de leitura para validar default privileges futuros
-- de funcoes no schema public.
--
-- Regras:
-- - executar o arquivo inteiro no SQL Editor do Supabase;
-- - nao aplica migration nem faz db push;
-- - nao cria funcao permanente;
-- - a transacao termina em ROLLBACK para garantir inspeção somente de leitura.

begin;

set local lock_timeout = '3s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';
set local search_path = pg_catalog, pg_temp, public, extensions;

create temp table pg_temp._p9_default_acl_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

do $scenario_1$
declare
  v_ok boolean;
begin
  select pg_catalog.to_regnamespace('public') is not null
     and pg_catalog.to_regrole('postgres') is not null
     and pg_catalog.to_regrole('supabase_admin') is not null
     and pg_catalog.to_regrole('anon') is not null
     and pg_catalog.to_regrole('authenticated') is not null
     and pg_catalog.to_regrole('service_role') is not null
  into v_ok;

  insert into pg_temp._p9_default_acl_results values
    (
      1,
      'roles e schema obrigatorios presentes',
      case when v_ok then 'PASS' else 'SUT_FAIL' end,
      case when v_ok then 'all required roles and schema exist' else 'missing required role or schema' end
    );
end;
$scenario_1$;

do $scenario_2$
declare
  v_ok boolean;
begin
  with effective_defaults as (
    select
      role_name.owner_name,
      coalesce(
        (
          select default_acl_row.defaclacl
          from pg_catalog.pg_default_acl default_acl_row
          where default_acl_row.defaclrole = role_name.owner_name::pg_catalog.regrole
            and default_acl_row.defaclnamespace = 'public'::pg_catalog.regnamespace
            and default_acl_row.defaclobjtype = 'f'
        ),
        pg_catalog.acldefault('f', role_name.owner_name::pg_catalog.regrole)
      ) as acl_items
    from (
      values ('postgres'::text), ('supabase_admin'::text)
    ) as role_name(owner_name)
  )
  select not exists (
    select 1
    from effective_defaults default_row
    cross join lateral pg_catalog.aclexplode(default_row.acl_items) privilege_row
    where privilege_row.privilege_type = 'EXECUTE'
      and privilege_row.grantee in (
        0,
        'anon'::pg_catalog.regrole::oid,
        'authenticated'::pg_catalog.regrole::oid
      )
  )
  into v_ok;

  insert into pg_temp._p9_default_acl_results values
    (
      2,
      'PUBLIC anon e authenticated sem EXECUTE futuro em public',
      case when v_ok then 'PASS' else 'SUT_FAIL' end,
      case when v_ok then 'future functions in public no longer inherit execute for PUBLIC, anon or authenticated' else 'one or more future public functions still inherit execute unexpectedly' end
    );
end;
$scenario_2$;

do $scenario_3$
declare
  v_ok boolean;
begin
  with effective_defaults as (
    select
      role_name.owner_name,
      coalesce(
        (
          select default_acl_row.defaclacl
          from pg_catalog.pg_default_acl default_acl_row
          where default_acl_row.defaclrole = role_name.owner_name::pg_catalog.regrole
            and default_acl_row.defaclnamespace = 'public'::pg_catalog.regnamespace
            and default_acl_row.defaclobjtype = 'f'
        ),
        pg_catalog.acldefault('f', role_name.owner_name::pg_catalog.regrole)
      ) as acl_items
    from (
      values ('postgres'::text), ('supabase_admin'::text)
    ) as role_name(owner_name)
  )
  select not exists (
    select 1
    from effective_defaults default_row
    cross join lateral pg_catalog.aclexplode(default_row.acl_items) privilege_row
    where privilege_row.privilege_type = 'EXECUTE'
      and privilege_row.grantee = 'service_role'::pg_catalog.regrole::oid
  )
  into v_ok;

  insert into pg_temp._p9_default_acl_results values
    (
      3,
      'service_role tambem nao recebe EXECUTE futuro por default',
      case when v_ok then 'PASS' else 'SUT_FAIL' end,
      case when v_ok then 'service_role stays deny-by-default for future public functions' else 'service_role still inherits execute by default for future public functions' end
    );
end;
$scenario_3$;

select *
from pg_temp._p9_default_acl_results
order by scenario_number;

rollback;
