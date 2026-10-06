begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';
set local idle_in_transaction_session_timeout = '120s';

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p19a:discount-counterpart-policy-scope-repair:v1',
    0
  )
);

-- ============================================================================
-- P19-A - Discount counterpart policy scope repair.
--
-- The original foundation migration is already applied remotely.
-- Keep its table/RLS/grants contract intact and repair only the scoped RPC
-- authorization contract so server/service-role calls follow Zion's canonical
-- role model:
--
--   authenticated -> active organization membership required
--   service_role  -> allowed for protected server-side RPC access
--   postgres      -> allowed for controlled admin/migration/manual checks
--   anything else -> fail closed
--
-- Direct table access remains revoked. RPCs remain SECURITY DEFINER boundaries.
-- ============================================================================

do $preflight$
begin
  if pg_catalog.to_regclass('public.store_discount_counterpart_policy') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: store_discount_counterpart_policy table is required';
  end if;

  if pg_catalog.to_regclass('public.stores') is null
     or pg_catalog.to_regclass('public.memberships') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: stores and memberships are required';
  end if;

  if pg_catalog.to_regprocedure(
       'public.zion_resolve_request_role_internal()'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: zion_resolve_request_role_internal() is required';
  end if;

  if pg_catalog.to_regprocedure(
       'public.read_store_discount_counterpart_policy_scoped(uuid,uuid)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: discount counterpart policy reader is required';
  end if;

  if pg_catalog.to_regprocedure(
       'public.upsert_store_discount_counterpart_policy_scoped(uuid,uuid,boolean,text[],boolean,text,numeric,bigint,boolean,integer)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: discount counterpart policy writer is required';
  end if;
end;
$preflight$;

create or replace function public.read_store_discount_counterpart_policy_scoped(
  p_organization_id uuid,
  p_store_id uuid
)
returns setof public.store_discount_counterpart_policy
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_user_id uuid;
  v_is_member boolean := false;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if v_request_role = 'authenticated' then
    v_user_id := auth.uid();

    if v_user_id is null then
      raise exception using
        errcode = '42501',
        message = 'discount counterpart policy scope is not authorized';
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
        message = 'discount counterpart policy scope is not authorized';
    end if;
  elsif v_request_role in ('service_role', 'postgres') then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'discount counterpart policy scope is not authorized';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'discount counterpart policy scope is not authorized';
  end if;

  return query
    select policy_row.*
    from public.store_discount_counterpart_policy policy_row
    where policy_row.organization_id = p_organization_id
      and policy_row.store_id = p_store_id;
end;
$function$;

create or replace function public.upsert_store_discount_counterpart_policy_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_enabled boolean,
  p_allowed_payment_methods text[],
  p_higher_down_payment_enabled boolean,
  p_higher_down_payment_minimum_type text,
  p_higher_down_payment_minimum_percent numeric,
  p_higher_down_payment_minimum_amount_cents bigint,
  p_fewer_installments_enabled boolean,
  p_fewer_installments_max_count integer
)
returns public.store_discount_counterpart_policy
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_row public.store_discount_counterpart_policy;
  v_request_role text := public.zion_resolve_request_role_internal();
  v_user_id uuid;
  v_is_member boolean := false;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if v_request_role = 'authenticated' then
    v_user_id := auth.uid();

    if v_user_id is null then
      raise exception using
        errcode = '42501',
        message = 'discount counterpart policy scope is not authorized';
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
        message = 'discount counterpart policy scope is not authorized';
    end if;
  elsif v_request_role in ('service_role', 'postgres') then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'discount counterpart policy scope is not authorized';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'discount counterpart policy scope is not authorized';
  end if;

  insert into public.store_discount_counterpart_policy (
    organization_id,
    store_id,
    enabled,
    allowed_payment_methods,
    higher_down_payment_enabled,
    higher_down_payment_minimum_type,
    higher_down_payment_minimum_percent,
    higher_down_payment_minimum_amount_cents,
    fewer_installments_enabled,
    fewer_installments_max_count,
    updated_at
  )
  values (
    p_organization_id,
    p_store_id,
    coalesce(p_enabled, false),
    case
      when coalesce(p_enabled, false)
        then coalesce(p_allowed_payment_methods, '{}'::text[])
      else '{}'::text[]
    end,
    case
      when coalesce(p_enabled, false)
        then coalesce(p_higher_down_payment_enabled, false)
      else false
    end,
    case
      when coalesce(p_enabled, false)
       and coalesce(p_higher_down_payment_enabled, false)
        then p_higher_down_payment_minimum_type
      else null
    end,
    case
      when coalesce(p_enabled, false)
       and coalesce(p_higher_down_payment_enabled, false)
        then p_higher_down_payment_minimum_percent
      else null
    end,
    case
      when coalesce(p_enabled, false)
       and coalesce(p_higher_down_payment_enabled, false)
        then p_higher_down_payment_minimum_amount_cents
      else null
    end,
    case
      when coalesce(p_enabled, false)
        then coalesce(p_fewer_installments_enabled, false)
      else false
    end,
    case
      when coalesce(p_enabled, false)
       and coalesce(p_fewer_installments_enabled, false)
        then p_fewer_installments_max_count
      else null
    end,
    pg_catalog.now()
  )
  on conflict (organization_id, store_id)
  do update set
    enabled = excluded.enabled,
    allowed_payment_methods = excluded.allowed_payment_methods,
    higher_down_payment_enabled = excluded.higher_down_payment_enabled,
    higher_down_payment_minimum_type = excluded.higher_down_payment_minimum_type,
    higher_down_payment_minimum_percent = excluded.higher_down_payment_minimum_percent,
    higher_down_payment_minimum_amount_cents = excluded.higher_down_payment_minimum_amount_cents,
    fewer_installments_enabled = excluded.fewer_installments_enabled,
    fewer_installments_max_count = excluded.fewer_installments_max_count,
    updated_at = pg_catalog.now()
  returning *
  into v_row;

  return v_row;
end;
$function$;

alter function public.read_store_discount_counterpart_policy_scoped(uuid, uuid)
  owner to postgres;

alter function public.upsert_store_discount_counterpart_policy_scoped(
  uuid,
  uuid,
  boolean,
  text[],
  boolean,
  text,
  numeric,
  bigint,
  boolean,
  integer
)
  owner to postgres;

revoke all on function public.read_store_discount_counterpart_policy_scoped(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.upsert_store_discount_counterpart_policy_scoped(
  uuid,
  uuid,
  boolean,
  text[],
  boolean,
  text,
  numeric,
  bigint,
  boolean,
  integer
)
  from public, anon, authenticated, service_role;

grant execute on function public.read_store_discount_counterpart_policy_scoped(uuid, uuid)
  to authenticated, service_role;

grant execute on function public.upsert_store_discount_counterpart_policy_scoped(
  uuid,
  uuid,
  boolean,
  text[],
  boolean,
  text,
  numeric,
  bigint,
  boolean,
  integer
)
  to authenticated, service_role;

do $postconditions$
declare
  v_reader_definition text;
  v_writer_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.read_store_discount_counterpart_policy_scoped(uuid,uuid)'::regprocedure
  )
  into v_reader_definition;

  select pg_catalog.pg_get_functiondef(
    'public.upsert_store_discount_counterpart_policy_scoped(uuid,uuid,boolean,text[],boolean,text,numeric,bigint,boolean,integer)'::regprocedure
  )
  into v_writer_definition;

  if pg_catalog.strpos(v_reader_definition, '''service_role''') = 0
     or pg_catalog.strpos(v_reader_definition, '''postgres''') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: reader service_role/postgres authorization is missing';
  end if;

  if pg_catalog.strpos(v_writer_definition, '''service_role''') = 0
     or pg_catalog.strpos(v_writer_definition, '''postgres''') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: writer service_role/postgres authorization is missing';
  end if;

  if not pg_catalog.has_function_privilege(
       'authenticated',
       'public.read_store_discount_counterpart_policy_scoped(uuid,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.read_store_discount_counterpart_policy_scoped(uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: reader execute grants mismatch';
  end if;

  if not pg_catalog.has_function_privilege(
       'authenticated',
       'public.upsert_store_discount_counterpart_policy_scoped(uuid,uuid,boolean,text[],boolean,text,numeric,bigint,boolean,integer)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.upsert_store_discount_counterpart_policy_scoped(uuid,uuid,boolean,text[],boolean,text,numeric,bigint,boolean,integer)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: writer execute grants mismatch';
  end if;

  if pg_catalog.has_table_privilege(
       'authenticated',
       'public.store_discount_counterpart_policy',
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.store_discount_counterpart_policy',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.store_discount_counterpart_policy',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.store_discount_counterpart_policy',
       'DELETE'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.store_discount_counterpart_policy',
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.store_discount_counterpart_policy',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.store_discount_counterpart_policy',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.store_discount_counterpart_policy',
       'DELETE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: direct table access became exposed';
  end if;
end;
$postconditions$;

commit;
