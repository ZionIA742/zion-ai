begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';
set local idle_in_transaction_session_timeout = '120s';

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:action-readiness-scoped-reader:v1', 0)
);

-- ============================================================================
-- P9 3.5-H1 - Scoped runtime reader for Commercial Action Readiness.
--
-- Keeps the canonical resolver internal while exposing one read-only bridge for
-- authenticated UI calls and server/service-role calls. The bridge owns only
-- authorization/scope checks; commercial readiness semantics remain entirely
-- in p9_resolve_commercial_action_readiness_internal(...).
-- ============================================================================

do $preflight$
begin
  if pg_catalog.to_regprocedure(
    'public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)'
  ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: internal commercial action readiness resolver is required';
  end if;

  if pg_catalog.to_regprocedure(
    'public.zion_resolve_request_role_internal()'
  ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: zion_resolve_request_role_internal() is required';
  end if;

  if pg_catalog.to_regclass('public.stores') is null
     or pg_catalog.to_regclass('public.memberships') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: store, membership, and commercial opportunity authorities are required';
  end if;

  if pg_catalog.to_regprocedure(
    'public.read_commercial_action_readiness_scoped(uuid,uuid,uuid,text)'
  ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: scoped commercial action readiness reader already exists';
  end if;
end;
$preflight$;

create function public.read_commercial_action_readiness_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_action_key text
)
returns table (
  action_key text,
  readiness_state text,
  reason_code text,
  blocking_items jsonb,
  readiness_basis jsonb,
  authority_fingerprint text,
  resolver_key text,
  resolver_version integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp, public, extensions
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_user_id uuid := auth.uid();
  v_is_member boolean := false;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or nullif(pg_catalog.btrim(coalesce(p_action_key, '')), '') is null then
    raise exception using
      errcode = '22023',
      message = 'P9_ACTION_READINESS_SCOPED_ARGUMENTS_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_organization_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'P9_ACTION_READINESS_STORE_SCOPE_NOT_AUTHORIZED';
  end if;

  if not exists (
    select 1
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = p_commercial_opportunity_id
      and opportunity_row.organization_id = p_organization_id
      and opportunity_row.store_id = p_store_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'P9_ACTION_READINESS_OPPORTUNITY_SCOPE_NOT_AUTHORIZED';
  end if;

  if v_request_role = 'authenticated' then
    if v_user_id is null then
      raise exception using
        errcode = '42501',
        message = 'P9_ACTION_READINESS_ACTIVE_MEMBERSHIP_REQUIRED';
    end if;

    select exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = p_organization_id
        and membership_row.user_id = v_user_id
        and membership_row.is_active is true
    )
    into v_is_member;

    if coalesce(v_is_member, false) is not true then
      raise exception using
        errcode = '42501',
        message = 'P9_ACTION_READINESS_ACTIVE_MEMBERSHIP_REQUIRED';
    end if;
  elsif v_request_role in ('service_role', 'postgres') then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'P9_ACTION_READINESS_REQUEST_ROLE_NOT_AUTHORIZED';
  end if;

  return query
  select resolved.*
  from public.p9_resolve_commercial_action_readiness_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_action_key
  ) resolved;
end;
$function$;

alter function public.read_commercial_action_readiness_scoped(
  uuid, uuid, uuid, text
) owner to postgres;

revoke all on function public.read_commercial_action_readiness_scoped(
  uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;

grant execute on function public.read_commercial_action_readiness_scoped(
  uuid, uuid, uuid, text
) to authenticated, service_role;

comment on function public.read_commercial_action_readiness_scoped(
  uuid, uuid, uuid, text
) is
  'Scoped runtime bridge for P9 commercial action readiness. Authenticated callers require active organization membership and exact store/opportunity scope; service_role/postgres are server/admin contexts. Commercial semantics remain owned by the internal action-specific resolver.';

-- ============================================================================
-- Postconditions.
-- ============================================================================

do $postconditions$
declare
  v_function oid := pg_catalog.to_regprocedure(
    'public.read_commercial_action_readiness_scoped(uuid,uuid,uuid,text)'
  );
  v_internal oid := pg_catalog.to_regprocedure(
    'public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)'
  );
  v_owner text;
  v_security_definer boolean;
  v_volatility "char";
  v_config text[];
  v_definition text;
begin
  if v_function is null or v_internal is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: scoped or internal action readiness function missing';
  end if;

  select
    pg_catalog.pg_get_userbyid(proc_row.proowner),
    proc_row.prosecdef,
    proc_row.provolatile,
    proc_row.proconfig,
    pg_catalog.pg_get_functiondef(proc_row.oid)
  into
    v_owner,
    v_security_definer,
    v_volatility,
    v_config,
    v_definition
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_function;

  if v_owner is distinct from 'postgres'
     or v_security_definer is not true
     or v_volatility is distinct from 's'
     or not coalesce(v_config, '{}'::text[]) @> array[
       'row_security=off',
       'search_path=pg_catalog, pg_temp, public, extensions'
     ]::text[] then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: scoped action readiness reader hardening mismatch';
  end if;

  if pg_catalog.has_function_privilege(
       'public',
       'public.read_commercial_action_readiness_scoped(uuid,uuid,uuid,text)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.read_commercial_action_readiness_scoped(uuid,uuid,uuid,text)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'authenticated',
       'public.read_commercial_action_readiness_scoped(uuid,uuid,uuid,text)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.read_commercial_action_readiness_scoped(uuid,uuid,uuid,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: scoped action readiness reader grants mismatch';
  end if;

  if pg_catalog.has_function_privilege(
       'authenticated',
       'public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: internal action readiness resolver became exposed';
  end if;

  if pg_catalog.strpos(v_definition, 'zion_resolve_request_role_internal') = 0
     or pg_catalog.strpos(v_definition, 'membership_row.is_active is true') = 0
     or pg_catalog.strpos(v_definition, 'commercial_opportunities') = 0
     or pg_catalog.strpos(v_definition, 'p9_resolve_commercial_action_readiness_internal') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: scoped action readiness reader definition mismatch';
  end if;
end;
$postconditions$;

commit;
