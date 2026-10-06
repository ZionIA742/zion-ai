begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';
set local idle_in_transaction_session_timeout = '120s';

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p19a:discount-counterpart-policy:operational-validation:v1', 0)
);

do $preflight$
begin
  if pg_catalog.to_regclass('public.store_discount_counterpart_policy') is null
     or pg_catalog.to_regclass('public.store_payment_settings') is null
     or pg_catalog.to_regclass('public.stores') is null
     or pg_catalog.to_regclass('public.memberships') is null then
    raise exception using errcode = 'P0001', message = 'precondition failed: discount, payment and store tables are required';
  end if;
  if pg_catalog.to_regprocedure('public.zion_resolve_request_role_internal()') is null then
    raise exception using errcode = 'P0001', message = 'precondition failed: request role resolver is required';
  end if;
end;
$preflight$;

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
  v_payment public.store_payment_settings;
  v_request_role text := public.zion_resolve_request_role_internal();
  v_user_id uuid;
  v_is_member boolean := false;
  v_enabled boolean := coalesce(p_enabled, false);
  v_higher_enabled boolean := v_enabled and coalesce(p_higher_down_payment_enabled, false);
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using errcode = '22023', message = 'organization_id and store_id are required';
  end if;

  if v_request_role = 'authenticated' then
    v_user_id := auth.uid();
    if v_user_id is null then
      raise exception using errcode = '42501', message = 'discount counterpart policy scope is not authorized';
    end if;
    select exists (
      select 1 from public.memberships membership_row
      where membership_row.organization_id = p_organization_id
        and membership_row.user_id = v_user_id
        and membership_row.is_active is true
    ) into v_is_member;
    if not coalesce(v_is_member, false) then
      raise exception using errcode = '42501', message = 'discount counterpart policy scope is not authorized';
    end if;
  elsif v_request_role in ('service_role', 'postgres') then
    null;
  else
    raise exception using errcode = '42501', message = 'discount counterpart policy scope is not authorized';
  end if;

  perform 1 from public.stores store_row
  where store_row.id = p_store_id and store_row.organization_id = p_organization_id;
  if not found then
    raise exception using errcode = '42501', message = 'discount counterpart policy scope is not authorized';
  end if;

  if v_higher_enabled then
    select * into strict v_payment
    from public.store_payment_settings payment_row
    where payment_row.organization_id = p_organization_id
      and payment_row.store_id = p_store_id;

    if v_payment.down_payment_mode = 'none' then
      null;
    elsif v_payment.down_payment_mode in ('optional', 'required')
      and v_payment.down_payment_value_type = 'percent'
      and v_payment.down_payment_percent > 0
      and v_payment.down_payment_percent <= 100 then
      if p_higher_down_payment_minimum_type <> 'percent'
         or p_higher_down_payment_minimum_percent is null
         or p_higher_down_payment_minimum_percent <= v_payment.down_payment_percent then
        raise exception using errcode = '22023', message = 'a contrapartida de entrada deve ser maior que a entrada normal da loja';
      end if;
    elsif v_payment.down_payment_mode in ('optional', 'required')
      and v_payment.down_payment_value_type = 'fixed'
      and v_payment.down_payment_amount_cents is not null
      and v_payment.down_payment_amount_cents > 0 then
      if p_higher_down_payment_minimum_type <> 'fixed'
         or p_higher_down_payment_minimum_amount_cents is null
         or p_higher_down_payment_minimum_amount_cents <= v_payment.down_payment_amount_cents then
        raise exception using errcode = '22023', message = 'a contrapartida de entrada deve ser maior que a entrada normal da loja';
      end if;
    else
      raise exception using errcode = '22023', message = 'a entrada normal da loja precisa estar definida para usar esta contrapartida';
    end if;
  end if;

  insert into public.store_discount_counterpart_policy (
    organization_id, store_id, enabled, allowed_payment_methods,
    higher_down_payment_enabled, higher_down_payment_minimum_type,
    higher_down_payment_minimum_percent, higher_down_payment_minimum_amount_cents,
    fewer_installments_enabled, fewer_installments_max_count, updated_at
  ) values (
    p_organization_id, p_store_id, v_enabled,
    case when v_enabled then coalesce(p_allowed_payment_methods, '{}'::text[]) else '{}'::text[] end,
    case when v_enabled then coalesce(p_higher_down_payment_enabled, false) else false end,
    case when v_higher_enabled then p_higher_down_payment_minimum_type else null end,
    case when v_higher_enabled then p_higher_down_payment_minimum_percent else null end,
    case when v_higher_enabled then p_higher_down_payment_minimum_amount_cents else null end,
    case when v_enabled then coalesce(p_fewer_installments_enabled, false) else false end,
    case when v_enabled and coalesce(p_fewer_installments_enabled, false) then p_fewer_installments_max_count else null end,
    pg_catalog.now()
  )
  on conflict (organization_id, store_id) do update set
    enabled = excluded.enabled,
    allowed_payment_methods = excluded.allowed_payment_methods,
    higher_down_payment_enabled = excluded.higher_down_payment_enabled,
    higher_down_payment_minimum_type = excluded.higher_down_payment_minimum_type,
    higher_down_payment_minimum_percent = excluded.higher_down_payment_minimum_percent,
    higher_down_payment_minimum_amount_cents = excluded.higher_down_payment_minimum_amount_cents,
    fewer_installments_enabled = excluded.fewer_installments_enabled,
    fewer_installments_max_count = excluded.fewer_installments_max_count,
    updated_at = pg_catalog.now()
  returning * into v_row;
  return v_row;
end;
$function$;

alter function public.upsert_store_discount_counterpart_policy_scoped(uuid, uuid, boolean, text[], boolean, text, numeric, bigint, boolean, integer) owner to postgres;
revoke all on function public.upsert_store_discount_counterpart_policy_scoped(uuid, uuid, boolean, text[], boolean, text, numeric, bigint, boolean, integer) from public, anon, authenticated, service_role;
grant execute on function public.upsert_store_discount_counterpart_policy_scoped(uuid, uuid, boolean, text[], boolean, text, numeric, bigint, boolean, integer) to authenticated, service_role;

commit;
