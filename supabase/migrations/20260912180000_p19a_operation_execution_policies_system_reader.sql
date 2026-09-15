-- P19-A / Block 3 / Operation
-- Protected system reader for canonical operation execution policies.
-- Reuses the existing table authority; no duplicate source of truth.
--
-- Security contract:
-- - exact organization/store scope;
-- - SECURITY DEFINER owned by postgres;
-- - fixed safe search_path;
-- - row_security off only inside the trusted reader;
-- - executable only by service_role;
-- - no direct table grants are changed;
-- - authenticated/anon/public cannot execute this reader.
--
-- Returning the table composite type is intentional so later canonical
-- execution-policy columns remain visible without duplicating a column list.

create or replace function public.read_store_operation_execution_policies_by_system(
  p_organization_id uuid,
  p_store_id uuid
)
returns public.store_operation_execution_policies
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_result public.store_operation_execution_policies%rowtype;
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
      message = 'store operation execution policy scope is not authorized';
  end if;

  select *
  into v_result
  from public.store_operation_execution_policies policy_row
  where policy_row.organization_id = p_organization_id
    and policy_row.store_id = p_store_id;

  if not found then
    return null;
  end if;

  return v_result;
end;
$function$;

alter function public.read_store_operation_execution_policies_by_system(
  uuid,
  uuid
) owner to postgres;

revoke all on function public.read_store_operation_execution_policies_by_system(
  uuid,
  uuid
) from public;

revoke all on function public.read_store_operation_execution_policies_by_system(
  uuid,
  uuid
) from anon;

revoke all on function public.read_store_operation_execution_policies_by_system(
  uuid,
  uuid
) from authenticated;

revoke all on function public.read_store_operation_execution_policies_by_system(
  uuid,
  uuid
) from service_role;

grant execute on function public.read_store_operation_execution_policies_by_system(
  uuid,
  uuid
) to service_role;
