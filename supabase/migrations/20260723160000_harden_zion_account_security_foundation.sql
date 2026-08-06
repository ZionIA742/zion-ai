begin isolation level repeatable read;

-- ZION / Pilar 18 / Bloco 5 / Etapa 5
-- Hardening da fundacao de seguranca das contas.
--
-- Escopo:
-- - endurece default privileges futuros no schema public;
-- - restringe grants e policies de public.zion_internal_admins;
-- - neutraliza o provisionamento automatico legado por trigger;
-- - redefine funcoes de escopo/consulta com contrato e grants estritos;
-- - falha com rollback integral caso o contrato remoto esperado divirja.

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p18:b5:e5:harden-zion-account-security-foundation:v1',
    0
  )
);

do $preflight$
declare
  v_executor_is_superuser boolean;
  v_handle_new_user_oid oid;
  v_can_admin_postgres_defaults boolean;
begin
  if pg_catalog.to_regnamespace('public') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public schema is missing';
  end if;

  if pg_catalog.to_regnamespace('auth') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: auth schema is missing';
  end if;

  if pg_catalog.to_regrole('postgres') is null
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

  v_can_admin_postgres_defaults := coalesce(v_executor_is_superuser, false)
    or current_user = 'postgres'
    or pg_catalog.pg_has_role(current_user, 'postgres', 'member');

  if v_can_admin_postgres_defaults is not true then
    raise exception using
      errcode = '42501',
      message = 'precondition failed: executor lacks authority to administer default privileges for postgres';
  end if;

  if pg_catalog.to_regclass('public.zion_internal_admins') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.zion_internal_admins is missing';
  end if;

  if pg_catalog.to_regclass('public.memberships') is null
     or pg_catalog.to_regclass('public.organizations') is null
     or pg_catalog.to_regclass('public.stores') is null
     or pg_catalog.to_regclass('public.subscriptions') is null
     or pg_catalog.to_regclass('public.store_onboarding') is null
     or pg_catalog.to_regclass('auth.users') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: one or more required tables are missing';
  end if;

  if pg_catalog.to_regtype('public.app_role') is null
     or pg_catalog.to_regtype('public.subscription_status') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: required enums are missing';
  end if;

  if pg_catalog.to_regprocedure('public.current_org_id()') is null
     or pg_catalog.to_regprocedure('public.is_member_of_org(uuid)') is null
     or pg_catalog.to_regprocedure('public.get_org_access_status(uuid)') is null
     or pg_catalog.to_regprocedure('public.onboarding_get_store_onboarding_scoped(uuid,uuid)') is null
     or pg_catalog.to_regprocedure('public.handle_new_user()') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: one or more required functions are missing or have a different signature';
  end if;

  v_handle_new_user_oid := pg_catalog.to_regprocedure('public.handle_new_user()');

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class class_row
      on class_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'auth'
      and class_row.relname = 'users'
      and trigger_row.tgname = 'on_auth_user_created'
      and trigger_row.tgfoid = v_handle_new_user_oid
      and trigger_row.tgisinternal is false
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: auth.users trigger on_auth_user_created is missing or no longer calls public.handle_new_user()';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_handle_new_user_oid
      and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
      and proc_row.prorettype = 'trigger'::pg_catalog.regtype
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.handle_new_user() must remain postgres-owned and return trigger';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class class_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'zion_internal_admins'
      and class_row.relkind = 'r'
      and pg_catalog.pg_get_userbyid(class_row.relowner) = 'postgres'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.zion_internal_admins owner mismatch';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'zion_internal_admins'
      and column_row.column_name = 'id'
      and column_row.udt_name = 'uuid'
      and column_row.is_nullable = 'NO'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.zion_internal_admins.id contract mismatch';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'zion_internal_admins'
      and column_row.column_name = 'user_id'
      and column_row.udt_name = 'uuid'
      and column_row.is_nullable = 'NO'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.zion_internal_admins.user_id contract mismatch';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'zion_internal_admins'
      and column_row.column_name = 'role'
      and column_row.udt_name = 'text'
      and column_row.is_nullable = 'NO'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.zion_internal_admins.role contract mismatch';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'zion_internal_admins'
      and column_row.column_name = 'is_active'
      and column_row.udt_name = 'bool'
      and column_row.is_nullable = 'NO'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.zion_internal_admins.is_active contract mismatch';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'memberships'
      and column_row.column_name = 'user_id'
      and column_row.udt_name = 'uuid'
      and column_row.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'memberships'
      and column_row.column_name = 'organization_id'
      and column_row.udt_name = 'uuid'
      and column_row.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'memberships'
      and column_row.column_name = 'created_at'
      and column_row.udt_name = 'timestamptz'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.memberships minimum contract mismatch';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'organizations'
      and column_row.column_name = 'id'
      and column_row.udt_name = 'uuid'
      and column_row.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'organizations'
      and column_row.column_name = 'subscription_status'
      and column_row.udt_name = 'text'
      and column_row.is_nullable = 'NO'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.organizations minimum contract mismatch';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'stores'
      and column_row.column_name = 'id'
      and column_row.udt_name = 'uuid'
      and column_row.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'stores'
      and column_row.column_name = 'organization_id'
      and column_row.udt_name = 'uuid'
      and column_row.is_nullable = 'NO'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.stores minimum contract mismatch';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'subscriptions'
      and column_row.column_name = 'organization_id'
      and column_row.udt_name = 'uuid'
      and column_row.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'subscriptions'
      and column_row.column_name = 'status'
      and column_row.udt_schema = 'public'
      and column_row.udt_name = 'subscription_status'
      and column_row.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'subscriptions'
      and column_row.column_name in (
        'grace_until',
        'past_due_since',
        'suspended_at',
        'canceled_at',
        'token_limit_mensal',
        'token_consumido_atual',
        'econ_mode_at_percent',
        'current_period_start',
        'current_period_end'
      )
    group by column_row.table_schema, column_row.table_name
    having count(*) = 9
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.subscriptions minimum contract mismatch';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'store_onboarding'
      and column_row.column_name = 'store_id'
      and column_row.udt_name = 'uuid'
      and column_row.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'store_onboarding'
      and column_row.column_name = 'organization_id'
      and column_row.udt_name = 'uuid'
      and column_row.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'store_onboarding'
      and column_row.column_name = 'status'
      and column_row.udt_name = 'text'
      and column_row.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'store_onboarding'
      and column_row.column_name = 'completed_at'
      and column_row.udt_name = 'timestamptz'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'store_onboarding'
      and column_row.column_name = 'updated_at'
      and column_row.udt_name = 'timestamptz'
      and column_row.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'store_onboarding'
      and column_row.column_name = 'created_at'
      and column_row.udt_name = 'timestamptz'
      and column_row.is_nullable = 'NO'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.store_onboarding'::pg_catalog.regclass
      and constraint_row.contype = 'p'
      and constraint_row.conkey = array[
        (
          select attribute_row.attnum
          from pg_catalog.pg_attribute attribute_row
          where attribute_row.attrelid = 'public.store_onboarding'::pg_catalog.regclass
            and attribute_row.attname = 'store_id'
            and attribute_row.attisdropped is false
        )
      ]::smallint[]
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.store_onboarding'::pg_catalog.regclass
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.stores'::pg_catalog.regclass
      and constraint_row.conkey = array[
        (
          select attribute_row.attnum
          from pg_catalog.pg_attribute attribute_row
          where attribute_row.attrelid = 'public.store_onboarding'::pg_catalog.regclass
            and attribute_row.attname = 'store_id'
            and attribute_row.attisdropped is false
        )
      ]::smallint[]
      and constraint_row.confkey = array[
        (
          select attribute_row.attnum
          from pg_catalog.pg_attribute attribute_row
          where attribute_row.attrelid = 'public.stores'::pg_catalog.regclass
            and attribute_row.attname = 'id'
            and attribute_row.attisdropped is false
        )
      ]::smallint[]
      and constraint_row.confdeltype = 'c'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.store_onboarding minimum contract mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = pg_catalog.to_regprocedure('public.current_org_id()')
      and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
  ) or not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = pg_catalog.to_regprocedure('public.is_member_of_org(uuid)')
      and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
  ) or not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = pg_catalog.to_regprocedure('public.get_org_access_status(uuid)')
      and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
      and proc_row.prorettype = 'jsonb'::pg_catalog.regtype
  ) or not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = pg_catalog.to_regprocedure('public.onboarding_get_store_onboarding_scoped(uuid,uuid)')
      and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
  ) or not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = pg_catalog.to_regprocedure('public.handle_new_user()')
      and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: one or more required function owners diverge from postgres';
  end if;
end;
$preflight$;

create temp table pg_temp.zion_account_security_business_counts as
select
  (
    select count(*)
    from auth.users user_row
  ) as auth_users_count,
  (
    select count(*)
    from public.organizations organization_row
  ) as organizations_count,
  (
    select count(*)
    from public.memberships membership_row
  ) as memberships_count,
  (
    select count(*)
    from public.stores store_row
  ) as stores_count,
  (
    select count(*)
    from public.subscriptions subscription_row
  ) as subscriptions_count,
  (
    select count(*)
    from public.store_onboarding onboarding_row
  ) as store_onboarding_count,
  (
    select count(*)
    from public.zion_internal_admins admin_row
  ) as zion_internal_admins_count;

alter default privileges for role postgres in schema public
  revoke all on tables from public;

alter default privileges for role postgres in schema public
  revoke all on tables from anon;

alter default privileges for role postgres in schema public
  revoke all on tables from authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from public;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon;

alter default privileges for role postgres in schema public
  revoke all on sequences from authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from public;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

alter default privileges for role postgres in schema public
  revoke execute on functions from authenticated;

alter table public.zion_internal_admins owner to postgres;
alter table public.zion_internal_admins enable row level security;
alter table public.zion_internal_admins force row level security;

do $drop_zion_internal_admin_policies$
declare
  v_policy_name text;
begin
  for v_policy_name in
    select policy_row.policyname
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'public'
      and policy_row.tablename = 'zion_internal_admins'
  loop
    execute format(
      'drop policy if exists %I on public.zion_internal_admins',
      v_policy_name
    );
  end loop;
end;
$drop_zion_internal_admin_policies$;

create policy zion_internal_admins_select_own_active
  on public.zion_internal_admins
  for select
  to authenticated
  using (
    public.zion_internal_admins.user_id = auth.uid()
    and public.zion_internal_admins.is_active is true
  );

revoke all on table public.zion_internal_admins from public;
revoke all on table public.zion_internal_admins from anon;
revoke all on table public.zion_internal_admins from authenticated;
revoke all on table public.zion_internal_admins from service_role;

grant select on table public.zion_internal_admins to authenticated;
grant select, insert, update, delete on table public.zion_internal_admins to service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  return new;
end;
$function$;

alter function public.handle_new_user() owner to postgres;

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;
revoke all on function public.handle_new_user() from service_role;

comment on function public.handle_new_user() is
  'Legacy automatic account provisioning was neutralized on 2026-07-23; the trigger remains because platform-owned auth.users trigger ownership cannot be changed here, and accounts must now be provisioned only by the controlled Zion-ADM flow.';

create or replace function public.current_org_id()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_organization_id uuid;
begin
  select membership_row.organization_id
  into v_organization_id
  from public.memberships membership_row
  where membership_row.user_id = auth.uid()
  order by membership_row.created_at asc nulls last, membership_row.organization_id asc
  limit 1;

  return v_organization_id;
end;
$function$;

alter function public.current_org_id() owner to postgres;

revoke all on function public.current_org_id() from public;
revoke all on function public.current_org_id() from anon;
revoke all on function public.current_org_id() from authenticated;
revoke all on function public.current_org_id() from service_role;

grant execute on function public.current_org_id() to authenticated;
grant execute on function public.current_org_id() to service_role;

create or replace function public.is_member_of_org(org_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
  select exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = org_id
      and membership_row.user_id = auth.uid()
  );
$function$;

alter function public.is_member_of_org(uuid) owner to postgres;

revoke all on function public.is_member_of_org(uuid) from public;
revoke all on function public.is_member_of_org(uuid) from anon;
revoke all on function public.is_member_of_org(uuid) from authenticated;
revoke all on function public.is_member_of_org(uuid) from service_role;

grant execute on function public.is_member_of_org(uuid) to authenticated;
grant execute on function public.is_member_of_org(uuid) to service_role;

create or replace function public.zion_resolve_request_role_internal()
returns text
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_claim_role text;
  v_claims_text text;
  v_claims_json jsonb;
begin
  v_claim_role := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');

  if v_claim_role is null then
    v_claims_text := nullif(pg_catalog.current_setting('request.jwt.claims', true), '');

    if v_claims_text is not null then
      begin
        v_claims_json := v_claims_text::jsonb;
      exception
        when others then
          v_claims_json := null;
      end;

      v_claim_role := nullif(v_claims_json ->> 'role', '');
    end if;
  end if;

  if v_claim_role is not null then
    return v_claim_role;
  end if;

  if session_user = 'postgres' then
    return 'postgres';
  end if;

  return null;
end;
$function$;

alter function public.zion_resolve_request_role_internal() owner to postgres;

revoke all on function public.zion_resolve_request_role_internal() from public;
revoke all on function public.zion_resolve_request_role_internal() from anon;
revoke all on function public.zion_resolve_request_role_internal() from authenticated;
revoke all on function public.zion_resolve_request_role_internal() from service_role;

create or replace function public.get_org_access_status(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_is_member boolean;
  v_subscription_status_text text;
  v_grace_until timestamptz;
  v_status_is_past_due boolean;
  v_grace_expired boolean;
  v_is_blocked boolean;
  v_reason text;
  v_token_limit_mensal bigint;
  v_token_consumido_atual bigint;
  v_token_pct numeric;
  v_econ_mode_at_percent numeric;
  v_ai_mode text;
begin
  if p_org_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_org_id is required';
  end if;

  if v_request_role = 'authenticated' then
    if auth.uid() is null then
      raise exception using
        errcode = '42501',
        message = 'organization scope is not authorized';
    end if;

    select exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = p_org_id
        and membership_row.user_id = auth.uid()
    )
    into v_is_member;

    if coalesce(v_is_member, false) is not true then
      raise exception using
        errcode = '42501',
        message = 'organization scope is not authorized';
    end if;
  elsif v_request_role in ('service_role', 'postgres') then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'organization scope is not authorized';
  end if;

  select
    subscription_row.status::text,
    subscription_row.grace_until,
    subscription_row.status::text = 'past_due',
    (
      subscription_row.status::text = 'past_due'
      and subscription_row.grace_until is not null
      and subscription_row.grace_until < now()
    ),
    subscription_row.token_limit_mensal::bigint,
    subscription_row.token_consumido_atual::bigint,
    case
      when coalesce(subscription_row.token_limit_mensal, 0) > 0 then
        round(
          (
            subscription_row.token_consumido_atual::numeric
            * 100.0
          ) / subscription_row.token_limit_mensal::numeric,
          2
        )
      else
        0::numeric
    end,
    subscription_row.econ_mode_at_percent::numeric
  into
    v_subscription_status_text,
    v_grace_until,
    v_status_is_past_due,
    v_grace_expired,
    v_token_limit_mensal,
    v_token_consumido_atual,
    v_token_pct,
    v_econ_mode_at_percent
  from (
    select
      subscription_inner.status,
      subscription_inner.grace_until,
      subscription_inner.token_limit_mensal,
      subscription_inner.token_consumido_atual,
      subscription_inner.econ_mode_at_percent
    from public.subscriptions subscription_inner
    where subscription_inner.organization_id = p_org_id
    order by
      subscription_inner.current_period_start desc nulls last,
      subscription_inner.current_period_end desc nulls last
    limit 1
  ) subscription_row;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'subscription_not_found';
  end if;

  v_is_blocked := false;
  v_reason := null;

  if v_subscription_status_text = 'suspended' then
    v_is_blocked := true;
    v_reason := 'subscription_suspended';
  elsif v_status_is_past_due then
    if v_grace_expired then
      v_is_blocked := true;
      v_reason := 'subscription_past_due_grace_expired';
    else
      v_is_blocked := false;
      v_reason := 'subscription_past_due_in_grace';
    end if;
  end if;

  v_ai_mode := case
    when coalesce(v_token_pct, 0::numeric) >= 100::numeric then 'blocked'
    when coalesce(v_token_pct, 0::numeric) >= coalesce(v_econ_mode_at_percent, 101::numeric) then 'econ'
    else 'normal'
  end;

  return pg_catalog.jsonb_build_object(
    'subscription_status', v_subscription_status_text,
    'grace_until', v_grace_until,
    'is_blocked', v_is_blocked,
    'reason', v_reason,
    'token_limit_mensal', coalesce(v_token_limit_mensal, 0::bigint),
    'token_consumido_atual', coalesce(v_token_consumido_atual, 0::bigint),
    'token_pct', coalesce(v_token_pct, 0::numeric),
    'ai_mode', v_ai_mode
  );
end;
$function$;

alter function public.get_org_access_status(uuid) owner to postgres;

revoke all on function public.get_org_access_status(uuid) from public;
revoke all on function public.get_org_access_status(uuid) from anon;
revoke all on function public.get_org_access_status(uuid) from authenticated;
revoke all on function public.get_org_access_status(uuid) from service_role;

grant execute on function public.get_org_access_status(uuid) to authenticated;
grant execute on function public.get_org_access_status(uuid) to service_role;

create or replace function public.onboarding_get_store_onboarding_scoped(
  p_organization_id uuid,
  p_store_id uuid
)
returns public.store_onboarding
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_is_member boolean;
  v_result public.store_onboarding%rowtype;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_organization_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'store scope is not authorized';
  end if;

  if v_request_role = 'authenticated' then
    if auth.uid() is null then
      raise exception using
        errcode = '42501',
        message = 'store scope is not authorized';
    end if;

    select exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = p_organization_id
        and membership_row.user_id = auth.uid()
    )
    into v_is_member;

    if coalesce(v_is_member, false) is not true then
      raise exception using
        errcode = '42501',
        message = 'store scope is not authorized';
    end if;
  elsif v_request_role in ('service_role', 'postgres') then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'store scope is not authorized';
  end if;

  select onboarding_row.*
  into v_result
  from public.store_onboarding onboarding_row
  where onboarding_row.organization_id = p_organization_id
    and onboarding_row.store_id = p_store_id
  limit 1;

  if not found then
    return null;
  end if;

  return v_result;
end;
$function$;

alter function public.onboarding_get_store_onboarding_scoped(uuid, uuid) owner to postgres;

revoke all on function public.onboarding_get_store_onboarding_scoped(uuid, uuid) from public;
revoke all on function public.onboarding_get_store_onboarding_scoped(uuid, uuid) from anon;
revoke all on function public.onboarding_get_store_onboarding_scoped(uuid, uuid) from authenticated;
revoke all on function public.onboarding_get_store_onboarding_scoped(uuid, uuid) from service_role;

grant execute on function public.onboarding_get_store_onboarding_scoped(uuid, uuid) to authenticated;
grant execute on function public.onboarding_get_store_onboarding_scoped(uuid, uuid) to service_role;

do $postconditions$
declare
  v_public_namespace oid := 'public'::pg_catalog.regnamespace;
  v_zion_internal_admins_oid oid := 'public.zion_internal_admins'::pg_catalog.regclass;
  v_current_org_oid oid := pg_catalog.to_regprocedure('public.current_org_id()');
  v_is_member_oid oid := pg_catalog.to_regprocedure('public.is_member_of_org(uuid)');
  v_resolve_request_role_oid oid := pg_catalog.to_regprocedure('public.zion_resolve_request_role_internal()');
  v_get_org_access_status_oid oid := pg_catalog.to_regprocedure('public.get_org_access_status(uuid)');
  v_onboarding_oid oid := pg_catalog.to_regprocedure('public.onboarding_get_store_onboarding_scoped(uuid,uuid)');
  v_handle_new_user_oid oid := pg_catalog.to_regprocedure('public.handle_new_user()');
  v_get_org_access_status_definition text;
  v_onboarding_definition text;
begin
  if exists (
    with effective_defaults as (
      select
        'postgres'::pg_catalog.regrole as owner_oid,
        coalesce(
          (
            select default_acl_row.defaclacl
            from pg_catalog.pg_default_acl default_acl_row
            where default_acl_row.defaclrole = 'postgres'::pg_catalog.regrole
              and default_acl_row.defaclnamespace = v_public_namespace
              and default_acl_row.defaclobjtype = 'r'
          ),
          pg_catalog.acldefault('r', 'postgres'::pg_catalog.regrole)
        ) as acl_items
    )
    select 1
    from effective_defaults default_row
    cross join lateral pg_catalog.aclexplode(default_row.acl_items) privilege_row
    where privilege_row.grantee in (
      0,
      'anon'::pg_catalog.regrole::oid,
      'authenticated'::pg_catalog.regrole::oid
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: future public table default privileges still expose API roles';
  end if;

  if exists (
    with effective_defaults as (
      select
        'postgres'::pg_catalog.regrole as owner_oid,
        coalesce(
          (
            select default_acl_row.defaclacl
            from pg_catalog.pg_default_acl default_acl_row
            where default_acl_row.defaclrole = 'postgres'::pg_catalog.regrole
              and default_acl_row.defaclnamespace = v_public_namespace
              and default_acl_row.defaclobjtype = 'S'
          ),
          pg_catalog.acldefault('S', 'postgres'::pg_catalog.regrole)
        ) as acl_items
    )
    select 1
    from effective_defaults default_row
    cross join lateral pg_catalog.aclexplode(default_row.acl_items) privilege_row
    where privilege_row.grantee in (
      0,
      'anon'::pg_catalog.regrole::oid,
      'authenticated'::pg_catalog.regrole::oid
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: future public sequence default privileges still expose API roles';
  end if;

  if exists (
    with effective_defaults as (
      select
        'postgres'::pg_catalog.regrole as owner_oid,
        coalesce(
          (
            select default_acl_row.defaclacl
            from pg_catalog.pg_default_acl default_acl_row
            where default_acl_row.defaclrole = 'postgres'::pg_catalog.regrole
              and default_acl_row.defaclnamespace = v_public_namespace
              and default_acl_row.defaclobjtype = 'f'
          ),
          pg_catalog.acldefault('f', 'postgres'::pg_catalog.regrole)
        ) as acl_items
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
      message = 'postcondition failed: future public function default privileges still expose EXECUTE to API roles';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'zion_internal_admins'
      and column_row.column_name = 'role'
      and column_row.udt_name = 'text'
      and column_row.is_nullable = 'NO'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.zion_internal_admins.role contract mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class class_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'zion_internal_admins'
      and class_row.relrowsecurity is true
      and class_row.relforcerowsecurity is true
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: zion_internal_admins RLS/force RLS mismatch';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'public'
      and policy_row.tablename = 'zion_internal_admins'
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: zion_internal_admins must expose exactly one active policy';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policy policy_row
    join pg_catalog.pg_class class_row
      on class_row.oid = policy_row.polrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'zion_internal_admins'
      and policy_row.polname =
        'zion_internal_admins_select_own_active'
      and policy_row.polcmd = 'r'
      and policy_row.polpermissive is true
      and policy_row.polroles = array[
        'authenticated'::pg_catalog.regrole::oid
      ]::oid[]
      and policy_row.polqual is not null
      and policy_row.polwithcheck is null
      and pg_catalog.pg_get_expr(
        policy_row.polqual,
        policy_row.polrelid,
        true
      ) ~* '(^|[^[:alnum:]_])(auth\.)?uid\(\)'
      and pg_catalog.pg_get_expr(
        policy_row.polqual,
        policy_row.polrelid,
        true
      ) ilike '%is_active%'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: zion_internal_admins final policy contract mismatch';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class class_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        class_row.relacl,
        pg_catalog.acldefault('r', class_row.relowner)
      )
    ) privilege_row
    where class_row.oid = v_zion_internal_admins_oid
      and privilege_row.grantee = 0
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: PUBLIC still has unexpected privileges on zion_internal_admins';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.zion_internal_admins', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'public.zion_internal_admins', 'INSERT')
     or pg_catalog.has_table_privilege('anon', 'public.zion_internal_admins', 'UPDATE')
     or pg_catalog.has_table_privilege('anon', 'public.zion_internal_admins', 'DELETE')
     or pg_catalog.has_table_privilege('anon', 'public.zion_internal_admins', 'TRUNCATE')
     or pg_catalog.has_table_privilege('anon', 'public.zion_internal_admins', 'REFERENCES')
     or pg_catalog.has_table_privilege('anon', 'public.zion_internal_admins', 'TRIGGER')
     or pg_catalog.has_table_privilege('anon', 'public.zion_internal_admins', 'MAINTAIN') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: anon still has unexpected privileges on zion_internal_admins';
  end if;

  if not pg_catalog.has_table_privilege('authenticated', 'public.zion_internal_admins', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.zion_internal_admins', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.zion_internal_admins', 'UPDATE')
     or pg_catalog.has_table_privilege('authenticated', 'public.zion_internal_admins', 'DELETE')
     or pg_catalog.has_table_privilege('authenticated', 'public.zion_internal_admins', 'TRUNCATE')
     or pg_catalog.has_table_privilege('authenticated', 'public.zion_internal_admins', 'REFERENCES')
     or pg_catalog.has_table_privilege('authenticated', 'public.zion_internal_admins', 'TRIGGER')
     or pg_catalog.has_table_privilege('authenticated', 'public.zion_internal_admins', 'MAINTAIN') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: authenticated final privileges on zion_internal_admins mismatch';
  end if;

  if not pg_catalog.has_table_privilege('service_role', 'public.zion_internal_admins', 'SELECT')
     or not pg_catalog.has_table_privilege('service_role', 'public.zion_internal_admins', 'INSERT')
     or not pg_catalog.has_table_privilege('service_role', 'public.zion_internal_admins', 'UPDATE')
     or not pg_catalog.has_table_privilege('service_role', 'public.zion_internal_admins', 'DELETE')
     or pg_catalog.has_table_privilege('service_role', 'public.zion_internal_admins', 'TRUNCATE')
     or pg_catalog.has_table_privilege('service_role', 'public.zion_internal_admins', 'REFERENCES')
     or pg_catalog.has_table_privilege('service_role', 'public.zion_internal_admins', 'TRIGGER')
     or pg_catalog.has_table_privilege('service_role', 'public.zion_internal_admins', 'MAINTAIN') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: service_role final privileges on zion_internal_admins mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class class_row
      on class_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'auth'
      and class_row.relname = 'users'
      and trigger_row.tgname = 'on_auth_user_created'
      and trigger_row.tgfoid = v_handle_new_user_oid
      and trigger_row.tgisinternal is false
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: auth.users trigger on_auth_user_created must remain bound to public.handle_new_user()';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc proc_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        proc_row.proacl,
        pg_catalog.acldefault('f', proc_row.proowner)
      )
    ) privilege_row
    where proc_row.oid = v_handle_new_user_oid
      and privilege_row.grantee = 0
      and privilege_row.privilege_type = 'EXECUTE'
  ) or pg_catalog.has_function_privilege('anon', v_handle_new_user_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_handle_new_user_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_handle_new_user_oid, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.handle_new_user() still exposes execute to API roles';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_handle_new_user_oid
      and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
      and proc_row.prorettype = 'trigger'::pg_catalog.regtype
      and proc_row.prosecdef is true
      and coalesce(proc_row.proconfig, '{}'::text[]) @> array[
        'search_path=pg_catalog, public, pg_temp'
      ]::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.handle_new_user() contract mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_description description_row
    where description_row.classoid = 'pg_proc'::pg_catalog.regclass
      and description_row.objoid = v_handle_new_user_oid
      and description_row.description ilike '%neutralized%'
      and description_row.description ilike '%trigger remains%'
      and description_row.description ilike '%Zion-ADM%'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.handle_new_user() comment was not updated';
  end if;

  if (
    pg_catalog.pg_get_functiondef(v_handle_new_user_oid) not ilike '%return new;%'
    or pg_catalog.pg_get_functiondef(v_handle_new_user_oid) ilike '%insert into public.organizations%'
    or pg_catalog.pg_get_functiondef(v_handle_new_user_oid) ilike '%insert into public.profiles%'
    or pg_catalog.pg_get_functiondef(v_handle_new_user_oid) ilike '%insert into public.memberships%'
    or pg_catalog.pg_get_functiondef(v_handle_new_user_oid) ilike '%insert into public.subscriptions%'
    or pg_catalog.pg_get_functiondef(v_handle_new_user_oid) ilike '%update auth.users%'
    or pg_catalog.pg_get_functiondef(v_handle_new_user_oid) ilike '%insert into auth.users%'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.handle_new_user() was not neutralized safely';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_current_org_oid
      and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
      and proc_row.prorettype = 'uuid'::pg_catalog.regtype
      and proc_row.prosecdef is true
      and proc_row.provolatile = 's'
      and coalesce(proc_row.proconfig, '{}'::text[]) @> array[
        'search_path=pg_catalog, public, pg_temp'
      ]::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.current_org_id() contract mismatch';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc proc_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        proc_row.proacl,
        pg_catalog.acldefault('f', proc_row.proowner)
      )
    ) privilege_row
    where proc_row.oid = v_current_org_oid
      and privilege_row.grantee = 0
      and privilege_row.privilege_type = 'EXECUTE'
  ) or pg_catalog.has_function_privilege('anon', v_current_org_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_current_org_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_current_org_oid, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.current_org_id() execute grants mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_is_member_oid
      and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
      and proc_row.prosecdef is false
      and proc_row.provolatile = 's'
      and coalesce(proc_row.proconfig, '{}'::text[]) @> array[
        'search_path=pg_catalog, public, pg_temp'
      ]::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.is_member_of_org(uuid) contract mismatch';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc proc_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        proc_row.proacl,
        pg_catalog.acldefault('f', proc_row.proowner)
      )
    ) privilege_row
    where proc_row.oid = v_is_member_oid
      and privilege_row.grantee = 0
      and privilege_row.privilege_type = 'EXECUTE'
  ) or pg_catalog.has_function_privilege('anon', v_is_member_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_is_member_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_is_member_oid, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.is_member_of_org(uuid) execute grants mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_resolve_request_role_oid
      and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
      and proc_row.prorettype = 'text'::pg_catalog.regtype
      and proc_row.prosecdef is false
      and proc_row.provolatile = 's'
      and coalesce(proc_row.proconfig, '{}'::text[]) @> array[
        'search_path=pg_catalog, public, pg_temp'
      ]::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.zion_resolve_request_role_internal() contract mismatch';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc proc_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        proc_row.proacl,
        pg_catalog.acldefault('f', proc_row.proowner)
      )
    ) privilege_row
    where proc_row.oid = v_resolve_request_role_oid
      and privilege_row.grantee in (
        0,
        'anon'::pg_catalog.regrole::oid,
        'authenticated'::pg_catalog.regrole::oid,
        'service_role'::pg_catalog.regrole::oid
      )
      and privilege_row.privilege_type = 'EXECUTE'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.zion_resolve_request_role_internal() execute grants mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_get_org_access_status_oid
      and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
      and proc_row.prorettype = 'jsonb'::pg_catalog.regtype
      and proc_row.prosecdef is true
      and coalesce(proc_row.proconfig, '{}'::text[]) @> array[
        'search_path=pg_catalog, public, pg_temp',
        'row_security=off'
      ]::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.get_org_access_status(uuid) contract mismatch';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc proc_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        proc_row.proacl,
        pg_catalog.acldefault('f', proc_row.proowner)
      )
    ) privilege_row
    where proc_row.oid = v_get_org_access_status_oid
      and privilege_row.grantee = 0
      and privilege_row.privilege_type = 'EXECUTE'
  ) or pg_catalog.has_function_privilege('anon', v_get_org_access_status_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_get_org_access_status_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_get_org_access_status_oid, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.get_org_access_status(uuid) execute grants mismatch';
  end if;

  v_get_org_access_status_definition := pg_catalog.pg_get_functiondef(v_get_org_access_status_oid);

  if v_get_org_access_status_definition ilike '%pg_has_role(session_user, ''service_role'', ''member'')%'
     or v_get_org_access_status_definition not ilike '%zion_resolve_request_role_internal()%'
     or v_get_org_access_status_definition not ilike '%from public.subscriptions%'
     or v_get_org_access_status_definition not ilike '%from public.memberships%'
     or v_get_org_access_status_definition not ilike '%jsonb_build_object%'
     or v_get_org_access_status_definition not ilike '%subscription_not_found%'
     or v_get_org_access_status_definition not ilike '%subscription_suspended%'
     or v_get_org_access_status_definition not ilike '%subscription_past_due_grace_expired%'
     or v_get_org_access_status_definition not ilike '%subscription_past_due_in_grace%'
     or v_get_org_access_status_definition ilike '%subscription_missing%'
     or v_get_org_access_status_definition ilike '%subscription_status_restricted%'
     or v_get_org_access_status_definition ilike '%grace_period_expired%'
     or v_get_org_access_status_definition ilike '%token_limit_reached%'
     or v_get_org_access_status_definition not ilike '%''subscription_status''%'
     or v_get_org_access_status_definition not ilike '%''grace_until''%'
     or v_get_org_access_status_definition not ilike '%''is_blocked''%'
     or v_get_org_access_status_definition not ilike '%''reason''%'
     or v_get_org_access_status_definition not ilike '%''token_limit_mensal''%'
     or v_get_org_access_status_definition not ilike '%''token_consumido_atual''%'
     or v_get_org_access_status_definition not ilike '%''token_pct''%'
     or v_get_org_access_status_definition not ilike '%''ai_mode''%'
     or v_get_org_access_status_definition not ilike '%v_ai_mode := case%'
     or v_get_org_access_status_definition not ilike '%when coalesce(v_token_pct, 0::numeric) >= 100::numeric then ''blocked''%'
     or v_get_org_access_status_definition not ilike '%when coalesce(v_token_pct, 0::numeric) >= coalesce(v_econ_mode_at_percent, 101::numeric) then ''econ''%'
     or v_get_org_access_status_definition not ilike '%else ''normal''%'
     or v_get_org_access_status_definition ilike '%v_ai_mode := case%v_is_blocked := true%end;%'
     or v_get_org_access_status_definition ilike '%v_ai_mode := case%v_reason :=%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.get_org_access_status(uuid) definition mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_onboarding_oid
      and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
      and proc_row.prosecdef is true
      and coalesce(proc_row.proconfig, '{}'::text[]) @> array[
        'search_path=pg_catalog, public, pg_temp',
        'row_security=off'
      ]::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.onboarding_get_store_onboarding_scoped(uuid,uuid) contract mismatch';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc proc_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        proc_row.proacl,
        pg_catalog.acldefault('f', proc_row.proowner)
      )
    ) privilege_row
    where proc_row.oid = v_onboarding_oid
      and privilege_row.grantee = 0
      and privilege_row.privilege_type = 'EXECUTE'
  ) or pg_catalog.has_function_privilege('anon', v_onboarding_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_onboarding_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_onboarding_oid, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.onboarding_get_store_onboarding_scoped(uuid,uuid) execute grants mismatch';
  end if;

  v_onboarding_definition := pg_catalog.pg_get_functiondef(v_onboarding_oid);

  if v_onboarding_definition ilike '%pg_has_role(session_user, ''service_role'', ''member'')%'
     or v_onboarding_definition not ilike '%zion_resolve_request_role_internal()%'
     or v_onboarding_definition not ilike '%from public.stores%'
     or v_onboarding_definition not ilike '%from public.memberships%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: onboarding_get_store_onboarding_scoped(uuid,uuid) is missing scope validation clauses';
  end if;

  if exists (
    select 1
    from pg_temp.zion_account_security_business_counts snapshot_row
    where snapshot_row.auth_users_count <> (
            select count(*)
            from auth.users user_row
          )
       or snapshot_row.organizations_count <> (
            select count(*)
            from public.organizations organization_row
          )
       or snapshot_row.memberships_count <> (
            select count(*)
            from public.memberships membership_row
          )
       or snapshot_row.stores_count <> (
            select count(*)
            from public.stores store_row
          )
       or snapshot_row.subscriptions_count <> (
            select count(*)
            from public.subscriptions subscription_row
          )
       or snapshot_row.store_onboarding_count <> (
            select count(*)
            from public.store_onboarding onboarding_row
          )
       or snapshot_row.zion_internal_admins_count <> (
            select count(*)
            from public.zion_internal_admins admin_row
          )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: business table row counts changed during account security hardening';
  end if;
end;
$postconditions$;

commit;
