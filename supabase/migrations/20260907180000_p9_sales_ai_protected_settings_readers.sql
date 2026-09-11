-- P9 - Sales AI protected canonical settings readers.
--
-- Purpose:
-- Allow trusted server-side Sales AI execution to read the canonical payment
-- and commercial-channel settings without granting service_role direct table
-- access.
--
-- Security contract:
-- - exact organization/store scope;
-- - SECURITY DEFINER owned by postgres;
-- - fixed safe search_path;
-- - row_security off only inside the trusted reader;
-- - executable only by service_role;
-- - no direct table grants are changed;
-- - authenticated/anon/public cannot execute these readers.

create or replace function public.read_store_payment_settings_by_system(
  p_organization_id uuid,
  p_store_id uuid
)
returns table (
  organization_id uuid,
  store_id uuid,
  accepted_payment_methods text[],
  pix_key_type text,
  pix_key text,
  pix_holder_name text,
  down_payment_mode text,
  down_payment_value_type text,
  down_payment_percent numeric,
  down_payment_amount_cents integer,
  installments_enabled boolean,
  max_installments integer,
  installment_interest_policy text,
  payment_notes text,
  created_at timestamptz,
  updated_at timestamptz
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
      errcode = '22023',
      message = 'store does not belong to organization';
  end if;

  return query
  select
    payment_row.organization_id,
    payment_row.store_id,
    payment_row.accepted_payment_methods,
    payment_row.pix_key_type,
    payment_row.pix_key,
    payment_row.pix_holder_name,
    payment_row.down_payment_mode,
    payment_row.down_payment_value_type,
    payment_row.down_payment_percent,
    payment_row.down_payment_amount_cents,
    payment_row.installments_enabled,
    payment_row.max_installments,
    payment_row.installment_interest_policy,
    payment_row.payment_notes,
    payment_row.created_at,
    payment_row.updated_at
  from public.store_payment_settings payment_row
  where payment_row.organization_id = p_organization_id
    and payment_row.store_id = p_store_id;
end;
$function$;

alter function public.read_store_payment_settings_by_system(
  uuid,
  uuid
) owner to postgres;

revoke all on function public.read_store_payment_settings_by_system(
  uuid,
  uuid
) from public;

revoke all on function public.read_store_payment_settings_by_system(
  uuid,
  uuid
) from anon;

revoke all on function public.read_store_payment_settings_by_system(
  uuid,
  uuid
) from authenticated;

revoke all on function public.read_store_payment_settings_by_system(
  uuid,
  uuid
) from service_role;

grant execute on function public.read_store_payment_settings_by_system(
  uuid,
  uuid
) to service_role;


create or replace function public.read_store_channel_settings_by_system(
  p_organization_id uuid,
  p_store_id uuid
)
returns table (
  organization_id uuid,
  store_id uuid,
  commercial_channel_name text,
  commercial_receives_real_clients boolean,
  commercial_is_official_sales_channel boolean,
  commercial_channel_type text,
  commercial_entry_priority text,
  commercial_human_handoff_enabled boolean,
  commercial_channel_notes text,
  integration_provider_name text,
  integration_connection_mode text,
  integrations_notes text,
  created_at timestamptz,
  updated_at timestamptz
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
      errcode = '22023',
      message = 'store does not belong to organization';
  end if;

  return query
  select
    channel_row.organization_id,
    channel_row.store_id,
    channel_row.commercial_channel_name,
    channel_row.commercial_receives_real_clients,
    channel_row.commercial_is_official_sales_channel,
    channel_row.commercial_channel_type,
    channel_row.commercial_entry_priority,
    channel_row.commercial_human_handoff_enabled,
    channel_row.commercial_channel_notes,
    channel_row.integration_provider_name,
    channel_row.integration_connection_mode,
    channel_row.integrations_notes,
    channel_row.created_at,
    channel_row.updated_at
  from public.store_channel_settings channel_row
  where channel_row.organization_id = p_organization_id
    and channel_row.store_id = p_store_id;
end;
$function$;

alter function public.read_store_channel_settings_by_system(
  uuid,
  uuid
) owner to postgres;

revoke all on function public.read_store_channel_settings_by_system(
  uuid,
  uuid
) from public;

revoke all on function public.read_store_channel_settings_by_system(
  uuid,
  uuid
) from anon;

revoke all on function public.read_store_channel_settings_by_system(
  uuid,
  uuid
) from authenticated;

revoke all on function public.read_store_channel_settings_by_system(
  uuid,
  uuid
) from service_role;

grant execute on function public.read_store_channel_settings_by_system(
  uuid,
  uuid
) to service_role;