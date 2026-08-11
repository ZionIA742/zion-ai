begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p18:b4:e4.3:privileged-rpc-access-hardening',
    0
  )
);

do $preflight$
begin
  if pg_catalog.to_regprocedure('public.get_org_access_status(uuid)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.get_org_access_status(uuid) is missing';
  end if;

  if pg_catalog.to_regprocedure('public.onboarding_get_store_onboarding_scoped(uuid,uuid)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.onboarding_get_store_onboarding_scoped(uuid,uuid) is missing';
  end if;

  if pg_catalog.to_regprocedure('public.enqueue_post_appointment_followups(uuid,uuid,timestamptz)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.enqueue_post_appointment_followups(uuid,uuid,timestamptz) is missing';
  end if;

  if pg_catalog.to_regclass('public.schedule_post_appointment_followups') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.schedule_post_appointment_followups is missing';
  end if;
end;
$preflight$;

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
        and membership_row.is_active is true
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
        and membership_row.is_active is true
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

alter table public.schedule_post_appointment_followups enable row level security;

revoke all on table public.schedule_post_appointment_followups from public;
revoke all on table public.schedule_post_appointment_followups from anon;
revoke all on table public.schedule_post_appointment_followups from authenticated;

grant select, insert, update on table public.schedule_post_appointment_followups to service_role;

revoke all on function public.enqueue_post_appointment_followups(uuid, uuid, timestamptz) from public;
revoke all on function public.enqueue_post_appointment_followups(uuid, uuid, timestamptz) from anon;
revoke all on function public.enqueue_post_appointment_followups(uuid, uuid, timestamptz) from authenticated;

grant execute on function public.enqueue_post_appointment_followups(uuid, uuid, timestamptz) to service_role;

do $postconditions$
declare
  v_get_org_access_status_oid oid := pg_catalog.to_regprocedure('public.get_org_access_status(uuid)');
  v_onboarding_oid oid := pg_catalog.to_regprocedure('public.onboarding_get_store_onboarding_scoped(uuid,uuid)');
  v_enqueue_followups_oid oid := pg_catalog.to_regprocedure('public.enqueue_post_appointment_followups(uuid,uuid,timestamptz)');
  v_get_org_access_status_definition text;
  v_onboarding_definition text;
  v_followups_rls_enabled boolean;
  v_followups_force_rls boolean;
  v_public_table_acl integer;
  v_public_enqueue_execute integer;
begin
  select pg_catalog.pg_get_functiondef(v_get_org_access_status_oid)
  into v_get_org_access_status_definition;

  if v_get_org_access_status_definition not ilike '%membership_row.is_active is true%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.get_org_access_status(uuid) is missing membership_row.is_active is true';
  end if;

  select pg_catalog.pg_get_functiondef(v_onboarding_oid)
  into v_onboarding_definition;

  if v_onboarding_definition not ilike '%membership_row.is_active is true%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.onboarding_get_store_onboarding_scoped(uuid,uuid) is missing membership_row.is_active is true';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_get_org_access_status_oid
      and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
      and proc_row.prosecdef
      and proc_row.proconfig @> array['search_path=pg_catalog, public, pg_temp']
      and proc_row.proconfig @> array['row_security=off']
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.get_org_access_status(uuid) contract mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_onboarding_oid
      and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
      and proc_row.prosecdef
      and proc_row.proconfig @> array['search_path=pg_catalog, public, pg_temp']
      and proc_row.proconfig @> array['row_security=off']
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
    ) acl_row
    where proc_row.oid in (v_get_org_access_status_oid, v_onboarding_oid, v_enqueue_followups_oid)
      and acl_row.grantee = 0
      and acl_row.privilege_type = 'EXECUTE'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: one or more hardened functions remain executable by PUBLIC';
  end if;

  if pg_catalog.has_function_privilege('anon', v_get_org_access_status_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_get_org_access_status_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_get_org_access_status_oid, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.get_org_access_status(uuid) execute grants mismatch';
  end if;

  if pg_catalog.has_function_privilege('anon', v_onboarding_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_onboarding_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_onboarding_oid, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.onboarding_get_store_onboarding_scoped(uuid,uuid) execute grants mismatch';
  end if;

  if pg_catalog.has_function_privilege('anon', v_enqueue_followups_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_enqueue_followups_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_enqueue_followups_oid, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.enqueue_post_appointment_followups(uuid,uuid,timestamptz) execute grants mismatch';
  end if;

  select class_row.relrowsecurity, class_row.relforcerowsecurity
  into v_followups_rls_enabled, v_followups_force_rls
  from pg_catalog.pg_class class_row
  where class_row.oid = 'public.schedule_post_appointment_followups'::pg_catalog.regclass;

  if v_followups_rls_enabled is not true or v_followups_force_rls is not false then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.schedule_post_appointment_followups RLS contract mismatch';
  end if;

  select count(*)
  into v_public_table_acl
  from pg_catalog.pg_class class_row
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      class_row.relacl,
      pg_catalog.acldefault('r', class_row.relowner)
    )
  ) acl_row
  where class_row.oid = 'public.schedule_post_appointment_followups'::pg_catalog.regclass
    and acl_row.grantee = 0;

  if v_public_table_acl <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.schedule_post_appointment_followups still grants privileges to PUBLIC';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.schedule_post_appointment_followups', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'public.schedule_post_appointment_followups', 'INSERT')
     or pg_catalog.has_table_privilege('anon', 'public.schedule_post_appointment_followups', 'UPDATE')
     or pg_catalog.has_table_privilege('authenticated', 'public.schedule_post_appointment_followups', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.schedule_post_appointment_followups', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.schedule_post_appointment_followups', 'UPDATE')
     or not pg_catalog.has_table_privilege('service_role', 'public.schedule_post_appointment_followups', 'SELECT')
     or not pg_catalog.has_table_privilege('service_role', 'public.schedule_post_appointment_followups', 'INSERT')
     or not pg_catalog.has_table_privilege('service_role', 'public.schedule_post_appointment_followups', 'UPDATE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.schedule_post_appointment_followups table grants mismatch';
  end if;

  select count(*)
  into v_public_enqueue_execute
  from pg_catalog.pg_proc proc_row
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      proc_row.proacl,
      pg_catalog.acldefault('f', proc_row.proowner)
    )
  ) acl_row
  where proc_row.oid = v_enqueue_followups_oid
    and acl_row.grantee = 0
    and acl_row.privilege_type = 'EXECUTE';

  if v_public_enqueue_execute <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.enqueue_post_appointment_followups(uuid,uuid,timestamptz) still grants EXECUTE to PUBLIC';
  end if;
end;
$postconditions$;

commit;
