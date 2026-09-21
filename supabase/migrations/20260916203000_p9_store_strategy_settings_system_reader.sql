-- P9 - Assistant protected canonical strategy settings reader.
--
-- Purpose:
-- Allow trusted server-side Assistant execution to read the canonical strategy
-- settings without granting service_role direct table access.
--
-- Security contract:
-- - exact organization/store scope;
-- - SECURITY DEFINER owned by postgres;
-- - fixed safe search_path;
-- - row_security off only inside the trusted reader;
-- - executable only by service_role;
-- - no direct table grants are changed;
-- - authenticated/anon/public cannot execute this reader.

create or replace function public.read_store_strategy_settings_by_system(
  p_organization_id uuid,
  p_store_id uuid
)
returns table (
  organization_id uuid,
  store_id uuid,
  city text,
  state text,
  service_regions text,
  service_region_modes text[],
  service_region_primary_mode text,
  service_region_outside_consultation boolean,
  service_region_notes text,
  store_services text[],
  store_services_other text,
  store_description text,
  main_store_brand text,
  brands_worked text,
  strategy_service_exclusions text,
  strategy_primary_focus text,
  strategy_sell_more text,
  strategy_common_customer text,
  strategy_ideal_customer text,
  strategy_ticket_range text,
  strategy_positioning text,
  strategy_priority_brands text,
  strategy_non_worked_brands text,
  strategy_top_lines text,
  strategy_top_products text,
  strategy_differentials text,
  strategy_promise_limits text,
  strategy_ai_presentation text,
  strategy_ai_priorities text,
  strategy_ai_never_forget text,
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
    strategy_row.organization_id,
    strategy_row.store_id,
    strategy_row.city,
    strategy_row.state,
    strategy_row.service_regions,
    strategy_row.service_region_modes,
    strategy_row.service_region_primary_mode,
    strategy_row.service_region_outside_consultation,
    strategy_row.service_region_notes,
    strategy_row.store_services,
    strategy_row.store_services_other,
    strategy_row.store_description,
    strategy_row.main_store_brand,
    strategy_row.brands_worked,
    strategy_row.strategy_service_exclusions,
    strategy_row.strategy_primary_focus,
    strategy_row.strategy_sell_more,
    strategy_row.strategy_common_customer,
    strategy_row.strategy_ideal_customer,
    strategy_row.strategy_ticket_range,
    strategy_row.strategy_positioning,
    strategy_row.strategy_priority_brands,
    strategy_row.strategy_non_worked_brands,
    strategy_row.strategy_top_lines,
    strategy_row.strategy_top_products,
    strategy_row.strategy_differentials,
    strategy_row.strategy_promise_limits,
    strategy_row.strategy_ai_presentation,
    strategy_row.strategy_ai_priorities,
    strategy_row.strategy_ai_never_forget,
    strategy_row.created_at,
    strategy_row.updated_at
  from public.store_strategy_settings strategy_row
  where strategy_row.organization_id = p_organization_id
    and strategy_row.store_id = p_store_id;
end;
$function$;

alter function public.read_store_strategy_settings_by_system(
  uuid,
  uuid
) owner to postgres;

revoke all on function public.read_store_strategy_settings_by_system(
  uuid,
  uuid
) from public;

revoke all on function public.read_store_strategy_settings_by_system(
  uuid,
  uuid
) from anon;

revoke all on function public.read_store_strategy_settings_by_system(
  uuid,
  uuid
) from authenticated;

revoke all on function public.read_store_strategy_settings_by_system(
  uuid,
  uuid
) from service_role;

grant execute on function public.read_store_strategy_settings_by_system(
  uuid,
  uuid
) to service_role;
