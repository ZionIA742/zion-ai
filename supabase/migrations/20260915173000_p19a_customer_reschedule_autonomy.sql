-- P19-A / Block 3 / Front 7
-- Canonical autonomy policy for customer-suggested reschedule times.
-- Authority remains public.store_schedule_settings.

alter table public.store_schedule_settings
  add column if not exists ai_can_accept_customer_reschedule_without_approval boolean null,
  add column if not exists customer_reschedule_autonomy_configured_at timestamptz null;

comment on column public.store_schedule_settings.ai_can_accept_customer_reschedule_without_approval is
  'Canonical policy: whether Sales AI may accept a customer-suggested reschedule time without human approval after canonical availability passes.';

comment on column public.store_schedule_settings.customer_reschedule_autonomy_configured_at is
  'Timestamp of the first explicit valid save of the customer reschedule autonomy card. NULL means not configured and must fail closed to human approval.';

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.store_schedule_settings'::regclass
      and conname = 'store_schedule_settings_reschedule_autonomy_shape_valid'
  ) then
    alter table public.store_schedule_settings
      add constraint store_schedule_settings_reschedule_autonomy_shape_valid
      check (
        (customer_reschedule_autonomy_configured_at is null
          and ai_can_accept_customer_reschedule_without_approval is null)
        or
        (customer_reschedule_autonomy_configured_at is not null
          and ai_can_accept_customer_reschedule_without_approval is not null)
      );
  end if;
end;
$$;

create or replace function public.upsert_store_customer_reschedule_autonomy_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_ai_can_accept_without_approval boolean
)
returns public.store_schedule_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_result public.store_schedule_settings%rowtype;
begin
  perform public.store_schedule_assert_card_writer_scope_internal(
    p_organization_id,
    p_store_id
  );

  if p_ai_can_accept_without_approval is null then
    raise exception using
      errcode = '22023',
      message = 'CUSTOMER_RESCHEDULE_AUTONOMY_REQUIRED';
  end if;

  update public.store_schedule_settings schedule_row
  set
    ai_can_accept_customer_reschedule_without_approval =
      p_ai_can_accept_without_approval,
    customer_reschedule_autonomy_configured_at = coalesce(
      schedule_row.customer_reschedule_autonomy_configured_at,
      pg_catalog.now()
    ),
    updated_at = pg_catalog.now()
  where schedule_row.organization_id = p_organization_id
    and schedule_row.store_id = p_store_id
  returning *
  into v_result;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'STORE_SCHEDULE_SETTINGS_REQUIRED_FOR_RESCHEDULE_AUTONOMY';
  end if;

  return v_result;
end;
$function$;

alter function public.upsert_store_customer_reschedule_autonomy_scoped(
  uuid, uuid, boolean
) owner to postgres;

revoke all on function public.upsert_store_customer_reschedule_autonomy_scoped(
  uuid, uuid, boolean
) from public, anon, authenticated, service_role;

grant execute on function public.upsert_store_customer_reschedule_autonomy_scoped(
  uuid, uuid, boolean
) to authenticated;

comment on function public.upsert_store_customer_reschedule_autonomy_scoped(
  uuid, uuid, boolean
) is
  'P19-A canonical authenticated writer for explicit customer reschedule autonomy configuration.';

create or replace function public.read_store_customer_reschedule_autonomy_by_system(
  p_organization_id uuid,
  p_store_id uuid
)
returns table(
  configured boolean,
  ai_can_accept_without_approval boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if coalesce(v_request_role, '') <> 'service_role'
     and session_user <> 'postgres'
  then
    raise exception using
      errcode = '42501',
      message = 'service_role is required';
  end if;

  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_organization_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'customer reschedule autonomy scope is not authorized';
  end if;

  return query
  select
    schedule_row.customer_reschedule_autonomy_configured_at is not null,
    schedule_row.ai_can_accept_customer_reschedule_without_approval
  from public.store_schedule_settings schedule_row
  where schedule_row.organization_id = p_organization_id
    and schedule_row.store_id = p_store_id;
end;
$function$;

alter function public.read_store_customer_reschedule_autonomy_by_system(
  uuid, uuid
) owner to postgres;

revoke all on function public.read_store_customer_reschedule_autonomy_by_system(
  uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.read_store_customer_reschedule_autonomy_by_system(
  uuid, uuid
) to service_role;

comment on function public.read_store_customer_reschedule_autonomy_by_system(
  uuid, uuid
) is
  'P19-A protected system reader for customer reschedule autonomy. Unconfigured or false must be interpreted fail-closed as human approval required.';
