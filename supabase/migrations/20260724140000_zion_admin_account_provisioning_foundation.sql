begin isolation level repeatable read;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p18:b5:e5:zion-admin-account-provisioning-foundation:v1',
    0
  )
);

do $preflight$
declare
  v_handle_new_user_oid oid;
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

  if pg_catalog.to_regclass('auth.users') is null
     or pg_catalog.to_regclass('public.profiles') is null
     or pg_catalog.to_regclass('public.organizations') is null
     or pg_catalog.to_regclass('public.memberships') is null
     or pg_catalog.to_regclass('public.stores') is null
     or pg_catalog.to_regclass('public.subscriptions') is null
     or pg_catalog.to_regclass('public.store_onboarding') is null
     or pg_catalog.to_regclass('public.zion_internal_admins') is null then
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

  if not exists (
    select 1
    from pg_catalog.pg_enum enum_row
    where enum_row.enumtypid = 'public.app_role'::pg_catalog.regtype
      and enum_row.enumlabel = 'owner'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.app_role must contain owner';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_enum enum_row
    where enum_row.enumtypid = 'public.subscription_status'::pg_catalog.regtype
      and enum_row.enumlabel = 'active'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.subscription_status must contain active';
  end if;

  if pg_catalog.to_regprocedure('public.zion_resolve_request_role_internal()') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.zion_resolve_request_role_internal() is missing';
  end if;

  v_handle_new_user_oid := pg_catalog.to_regprocedure('public.handle_new_user()');

  if v_handle_new_user_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.handle_new_user() is missing';
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
      message = 'precondition failed: auth.users trigger on_auth_user_created is missing or no longer calls public.handle_new_user()';
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
      message = 'precondition failed: public.handle_new_user() was not neutralized safely';
  end if;

  if pg_catalog.to_regprocedure('public.zion_admin_provision_account(uuid,text,text)') is not null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.zion_admin_provision_account(uuid,text,text) already exists';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'auth'
      and column_row.table_name = 'users'
      and column_row.column_name = 'id'
      and column_row.udt_name = 'uuid'
      and column_row.is_nullable = 'NO'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: auth.users.id contract mismatch';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'profiles'
      and column_row.column_name = 'user_id'
      and column_row.udt_name = 'uuid'
      and column_row.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'profiles'
      and column_row.column_name = 'full_name'
      and column_row.udt_name = 'text'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.profiles minimum contract mismatch';
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
      and column_row.column_name = 'name'
      and column_row.udt_name = 'text'
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
      and column_row.table_name = 'memberships'
      and column_row.column_name = 'id'
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
      and column_row.column_name = 'user_id'
      and column_row.udt_name = 'uuid'
      and column_row.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'memberships'
      and column_row.column_name = 'role'
      and column_row.udt_name = 'app_role'
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
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'stores'
      and column_row.column_name = 'name'
      and column_row.udt_name = 'text'
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
      and column_row.column_name = 'plan_code'
      and column_row.udt_name = 'text'
      and column_row.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'subscriptions'
      and column_row.column_name = 'status'
      and column_row.udt_name = 'subscription_status'
      and column_row.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'subscriptions'
      and column_row.column_name = 'current_period_start'
      and column_row.udt_name = 'timestamptz'
      and column_row.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'subscriptions'
      and column_row.column_name = 'current_period_end'
      and column_row.udt_name = 'timestamptz'
      and column_row.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'subscriptions'
      and column_row.column_name = 'past_due_since'
      and column_row.udt_name = 'timestamptz'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'subscriptions'
      and column_row.column_name = 'grace_until'
      and column_row.udt_name = 'timestamptz'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'subscriptions'
      and column_row.column_name = 'suspended_at'
      and column_row.udt_name = 'timestamptz'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'subscriptions'
      and column_row.column_name = 'canceled_at'
      and column_row.udt_name = 'timestamptz'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'subscriptions'
      and column_row.column_name = 'token_limit_mensal'
      and column_row.udt_name = 'int8'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'subscriptions'
      and column_row.column_name = 'token_consumido_atual'
      and column_row.udt_name = 'int8'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'subscriptions'
      and column_row.column_name = 'alert_at_percent'
      and column_row.udt_name = 'int4'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'subscriptions'
      and column_row.column_name = 'econ_mode_at_percent'
      and column_row.udt_name = 'int4'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.subscriptions minimum contract mismatch';
  end if;
end;
$preflight$;

create temp table pg_temp.zion_admin_account_provisioning_counts as
select
  (
    select count(*)
    from auth.users user_row
  ) as auth_users_count,
  (
    select count(*)
    from public.profiles profile_row
  ) as profiles_count,
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

create or replace function public.zion_admin_provision_account(
  p_user_id uuid,
  p_responsible_name text,
  p_store_name text
)
returns table (
  provisioning_status text,
  issue_code text,
  issue_message text,
  profile_user_id uuid,
  organization_id uuid,
  membership_id uuid,
  store_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_responsible_name text := nullif(pg_catalog.btrim(coalesce(p_responsible_name, '')), '');
  v_store_name text := nullif(pg_catalog.btrim(coalesce(p_store_name, '')), '');
  v_now timestamptz := now();
  v_profile_count integer := 0;
  v_membership_count integer := 0;
  v_distinct_org_count integer := 0;
  v_store_count integer := 0;
  v_subscription_count integer := 0;
  v_profile_user_id uuid;
  v_organization_id uuid;
  v_membership_id uuid;
  v_store_id uuid;
begin
  if coalesce(v_request_role, '') not in (
    'service_role',
    'postgres'
  ) then
    raise exception using
      errcode = '42501',
      message = 'account provisioning is not authorized';
  end if;

  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_user_id is required for zion_admin_provision_account';
  end if;

  if v_responsible_name is null then
    raise exception using
      errcode = '22023',
      message = 'p_responsible_name is required for zion_admin_provision_account';
  end if;

  if v_store_name is null then
    raise exception using
      errcode = '22023',
      message = 'p_store_name is required for zion_admin_provision_account';
  end if;

  if not exists (
    select 1
    from auth.users user_row
    where user_row.id = p_user_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'auth user not found for account provisioning';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  select count(*)
  into v_profile_count
  from public.profiles p
  where p.user_id = p_user_id;

  if v_profile_count > 0 then
    v_profile_user_id := p_user_id;
  else
    v_profile_user_id := null;
  end if;

  select
    count(*),
    count(distinct m.organization_id)
  into
    v_membership_count,
    v_distinct_org_count
  from public.memberships m
  where m.user_id = p_user_id;

  if v_membership_count = 0 then
    if v_profile_count > 0 then
      return query
      select
        'requires_manual_intervention'::text,
        'profile_exists_without_tenant'::text,
        'The user already has a profile row without a valid tenant and requires manual review.'::text,
        v_profile_user_id,
        null::uuid,
        null::uuid,
        null::uuid;
      return;
    end if;

    insert into public.profiles (user_id, full_name)
    values (p_user_id, v_responsible_name)
    returning user_id
    into v_profile_user_id;

    insert into public.organizations (name, subscription_status)
    values (v_store_name, 'active')
    returning id
    into v_organization_id;

    insert into public.memberships (organization_id, user_id, role)
    values (v_organization_id, p_user_id, 'owner')
    returning id
    into v_membership_id;

    insert into public.stores (organization_id, name)
    values (v_organization_id, v_store_name)
    returning id
    into v_store_id;

    insert into public.subscriptions (
      organization_id,
      plan_code,
      status,
      current_period_start,
      current_period_end,
      past_due_since,
      grace_until,
      suspended_at,
      canceled_at,
      token_limit_mensal,
      token_consumido_atual,
      alert_at_percent,
      econ_mode_at_percent
    )
    values (
      v_organization_id,
      'pilot_full_access',
      'active',
      v_now,
      v_now + interval '2 months',
      null,
      null,
      null,
      null,
      1000000,
      0,
      80,
      95
    );

    return query
    select
      'provisioned'::text,
      null::text,
      null::text,
      v_profile_user_id,
      v_organization_id,
      v_membership_id,
      v_store_id;
    return;
  end if;

  if v_profile_count = 0 then
    return query
    select
      'requires_manual_intervention'::text,
      'tenant_exists_without_profile'::text,
      'The user already has tenant structure without a valid profile row.'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::uuid;
    return;
  end if;

  if v_membership_count > 1 or v_distinct_org_count > 1 then
    return query
    select
      'requires_manual_intervention'::text,
      'user_linked_to_multiple_organizations'::text,
      'The user already has multiple organization links and cannot be reprovisioned automatically.'::text,
      v_profile_user_id,
      null::uuid,
      null::uuid,
      null::uuid;
    return;
  end if;

  select m.id, m.organization_id
  into v_membership_id, v_organization_id
  from public.memberships m
  where m.user_id = p_user_id
  order by m.created_at asc, m.id asc
  limit 1;

  if v_membership_id is null or v_organization_id is null then
    return query
    select
      'requires_manual_intervention'::text,
      'membership_resolution_failed'::text,
      'The existing membership could not be resolved safely.'::text,
      v_profile_user_id,
      null::uuid,
      null::uuid,
      null::uuid;
    return;
  end if;

  if not exists (
    select 1
    from public.organizations o
    where o.id = v_organization_id
  ) then
    return query
    select
      'requires_manual_intervention'::text,
      'organization_missing'::text,
      'The user membership points to a missing organization.'::text,
      v_profile_user_id,
      v_organization_id,
      v_membership_id,
      null::uuid;
    return;
  end if;

  select count(*)
  into v_store_count
  from public.stores s
  where s.organization_id = v_organization_id;

  select s.id
  into v_store_id
  from public.stores s
  where s.organization_id = v_organization_id
  order by s.id asc
  limit 1;

  if v_store_count > 1 then
    return query
    select
      'requires_manual_intervention'::text,
      'multiple_stores_already_exist'::text,
      'The user already belongs to an organization with multiple stores.'::text,
      v_profile_user_id,
      v_organization_id,
      v_membership_id,
      null::uuid;
    return;
  end if;

  select count(*)
  into v_subscription_count
  from public.subscriptions subscription_row
  where subscription_row.organization_id = v_organization_id;

  if v_subscription_count > 1 then
    return query
    select
      'requires_manual_intervention'::text,
      'multiple_subscriptions_found'::text,
      'The organization already has multiple subscription rows and cannot be reprovisioned automatically.'::text,
      v_profile_user_id,
      v_organization_id,
      v_membership_id,
      v_store_id;
    return;
  end if;

  if v_store_count = 0 then
    return query
    select
      'requires_manual_intervention'::text,
      case
        when v_subscription_count = 0
          then 'membership_missing_store_and_subscription'
        else 'subscription_exists_without_store'
      end::text,
      case
        when v_subscription_count = 0
          then 'The account has an organization membership without store or subscription and requires manual review.'
        else 'The account has a subscription row without a matching store and requires manual review.'
      end::text,
      v_profile_user_id,
      v_organization_id,
      v_membership_id,
      null::uuid;
    return;
  end if;

  if v_subscription_count = 0 then
    return query
    select
      'requires_manual_intervention'::text,
      'subscription_missing_for_existing_store'::text,
      'The organization already has a store but is missing a subscription and cannot be reprovisioned automatically.'::text,
      v_profile_user_id,
      v_organization_id,
      v_membership_id,
      v_store_id;
    return;
  end if;

  if v_subscription_count = 1 then
    return query
    select
      'already_provisioned'::text,
      null::text,
      null::text,
      v_profile_user_id,
      v_organization_id,
      v_membership_id,
      v_store_id;
    return;
  end if;

  return query
  select
    'requires_manual_intervention'::text,
    'tenant_state_unrecognized'::text,
    'The existing tenant state is not recognized safely and requires manual review.'::text,
    v_profile_user_id,
    v_organization_id,
    v_membership_id,
    v_store_id;
end;
$function$;

alter function public.zion_admin_provision_account(uuid,text,text)
  owner to postgres;

revoke all on function public.zion_admin_provision_account(uuid,text,text) from public;
revoke all on function public.zion_admin_provision_account(uuid,text,text) from anon;
revoke all on function public.zion_admin_provision_account(uuid,text,text) from authenticated;
revoke all on function public.zion_admin_provision_account(uuid,text,text) from service_role;

grant execute on function public.zion_admin_provision_account(uuid,text,text)
to service_role;

comment on function public.zion_admin_provision_account(uuid,text,text) is
  'Provisionamento controlado do Zion-ADM para contas piloto; depende do trigger legado neutralizado, que deve permanecer instalado.';

do $postconditions$
declare
  v_function_oid oid := pg_catalog.to_regprocedure('public.zion_admin_provision_account(uuid,text,text)');
  v_handle_new_user_oid oid := pg_catalog.to_regprocedure('public.handle_new_user()');
begin
  if v_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.zion_admin_provision_account(uuid,text,text) was not created';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'zion_admin_provision_account'
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.zion_admin_provision_account overload count mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_function_oid
      and proc_row.pronargs = 3
      and proc_row.proargnames[1:proc_row.pronargs] = array[
        'p_user_id',
        'p_responsible_name',
        'p_store_name'
      ]
      and proc_row.proargmodes = array[
        'i'::"char",
        'i'::"char",
        'i'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char"
      ]
      and proc_row.proargnames[proc_row.pronargs + 1:pg_catalog.array_length(proc_row.proargnames, 1)] = array[
        'provisioning_status',
        'issue_code',
        'issue_message',
        'profile_user_id',
        'organization_id',
        'membership_id',
        'store_id'
      ]
      and proc_row.proallargtypes = array[
        'uuid'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype
      ]::oid[]
      and pg_catalog.pg_get_function_result(proc_row.oid) = 'TABLE(provisioning_status text, issue_code text, issue_message text, profile_user_id uuid, organization_id uuid, membership_id uuid, store_id uuid)'
      and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
      and proc_row.prosecdef is true
      and proc_row.provolatile = 'v'
      and proc_row.proparallel = 'u'
      and coalesce(proc_row.proconfig, '{}'::text[]) @> array[
        'search_path=pg_catalog, public, pg_temp',
        'row_security=off'
      ]::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: zion_admin_provision_account function contract mismatch';
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
    where proc_row.oid = v_function_oid
      and privilege_row.grantee = 0
      and privilege_row.privilege_type = 'EXECUTE'
  ) or pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_function_oid, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: zion_admin_provision_account execute grants mismatch';
  end if;

  if (
    pg_catalog.pg_get_functiondef(v_function_oid) not ilike '%zion_resolve_request_role_internal()%'
    or pg_catalog.pg_get_functiondef(v_function_oid) not ilike '%from auth.users user_row%'
    or pg_catalog.pg_get_functiondef(v_function_oid) not ilike '%insert into public.profiles%'
    or pg_catalog.pg_get_functiondef(v_function_oid) not ilike '%insert into public.organizations%'
    or pg_catalog.pg_get_functiondef(v_function_oid) not ilike '%insert into public.memberships%'
    or pg_catalog.pg_get_functiondef(v_function_oid) not ilike '%insert into public.stores%'
    or pg_catalog.pg_get_functiondef(v_function_oid) not ilike '%insert into public.subscriptions%'
    or pg_catalog.pg_get_functiondef(v_function_oid) ilike ('%' || 'mi' || 'n(p.user_id)' || '%')
    or pg_catalog.pg_get_functiondef(v_function_oid) ilike ('%' || 'mi' || 'n(s.id)' || '%')
    or pg_catalog.pg_get_functiondef(v_function_oid) ilike ('%drop' || ' trigger%')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: zion_admin_provision_account definition mismatch';
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

  if (
    select count(*)
    from auth.users user_row
  ) <> (
    select snapshot_row.auth_users_count
    from pg_temp.zion_admin_account_provisioning_counts snapshot_row
  ) or (
    select count(*)
    from public.profiles profile_row
  ) <> (
    select snapshot_row.profiles_count
    from pg_temp.zion_admin_account_provisioning_counts snapshot_row
  ) or (
    select count(*)
    from public.organizations organization_row
  ) <> (
    select snapshot_row.organizations_count
    from pg_temp.zion_admin_account_provisioning_counts snapshot_row
  ) or (
    select count(*)
    from public.memberships membership_row
  ) <> (
    select snapshot_row.memberships_count
    from pg_temp.zion_admin_account_provisioning_counts snapshot_row
  ) or (
    select count(*)
    from public.stores store_row
  ) <> (
    select snapshot_row.stores_count
    from pg_temp.zion_admin_account_provisioning_counts snapshot_row
  ) or (
    select count(*)
    from public.subscriptions subscription_row
  ) <> (
    select snapshot_row.subscriptions_count
    from pg_temp.zion_admin_account_provisioning_counts snapshot_row
  ) or (
    select count(*)
    from public.store_onboarding onboarding_row
  ) <> (
    select snapshot_row.store_onboarding_count
    from pg_temp.zion_admin_account_provisioning_counts snapshot_row
  ) or (
    select count(*)
    from public.zion_internal_admins admin_row
  ) <> (
    select snapshot_row.zion_internal_admins_count
    from pg_temp.zion_admin_account_provisioning_counts snapshot_row
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: business table row counts changed during zion admin account provisioning foundation';
  end if;
end;
$postconditions$;

commit;
