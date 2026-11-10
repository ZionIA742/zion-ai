-- P9.9.5: read-only payment history authority for the CRM.
-- This function is deliberately separate from all payment writers.

create or replace function public.p9_read_payment_history_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_lifecycle_cycle integer
)
returns table (
  event_kind text,
  id uuid,
  event_type text,
  amount_cents integer,
  payment_method text,
  reversed_payment_event_id uuid,
  source_type text,
  reason_code text,
  notes text,
  metadata jsonb,
  settlement_state text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
set row_security = off
as $function$
declare
  v_lifecycle_cycle integer;
begin
  select opportunity_row.lifecycle_cycle
    into v_lifecycle_cycle
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'P9_PAYMENT_HISTORY_OPPORTUNITY_NOT_FOUND';
  end if;

  if v_lifecycle_cycle is distinct from p_lifecycle_cycle then
    raise exception using
      errcode = 'P0001',
      message = 'P9_PAYMENT_HISTORY_CYCLE_MISMATCH';
  end if;

  return query
  select
    'payment'::text,
    payment_event.id,
    payment_event.event_type,
    payment_event.amount_cents,
    payment_event.payment_method,
    payment_event.reversed_payment_event_id,
    payment_event.source_type,
    payment_event.reason_code,
    payment_event.notes,
    payment_event.metadata,
    null::text,
    payment_event.created_at
  from public.commercial_opportunity_payment_events payment_event
  where payment_event.organization_id = p_organization_id
    and payment_event.store_id = p_store_id
    and payment_event.commercial_opportunity_id = p_commercial_opportunity_id
    and payment_event.lifecycle_cycle = p_lifecycle_cycle

  union all

  select
    'settlement'::text,
    settlement_event.id,
    null::text,
    null::integer,
    null::text,
    null::uuid,
    null::text,
    settlement_event.reason_code,
    settlement_event.notes,
    settlement_event.metadata,
    settlement_event.settlement_state,
    settlement_event.created_at
  from public.commercial_opportunity_payment_settlement_events settlement_event
  where settlement_event.organization_id = p_organization_id
    and settlement_event.store_id = p_store_id
    and settlement_event.commercial_opportunity_id = p_commercial_opportunity_id
    and settlement_event.lifecycle_cycle = p_lifecycle_cycle
  order by created_at asc, id asc;
end;
$function$;

alter function public.p9_read_payment_history_internal(uuid, uuid, uuid, integer)
  owner to postgres;

revoke all on function public.p9_read_payment_history_internal(uuid, uuid, uuid, integer)
  from public, anon, authenticated, service_role;

grant execute on function public.p9_read_payment_history_internal(uuid, uuid, uuid, integer)
  to service_role;
