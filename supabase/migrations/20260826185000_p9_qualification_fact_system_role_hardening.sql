begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create or replace function public.write_commercial_opportunity_qualification_fact_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text,
  p_fact_key text,
  p_value_json jsonb,
  p_assertion_level text,
  p_source_type text,
  p_source_message_id uuid default null,
  p_source_conversation_id uuid default null,
  p_created_by text default 'sales_ai',
  p_resolves_conflict boolean default false
)
returns table (
  commercial_opportunity_id uuid,
  fact_key text,
  event_id uuid,
  current_last_event_id uuid,
  current_state text,
  current_value_json jsonb,
  normalized_value_text text,
  value_kind text,
  conflict_values_json jsonb,
  changed boolean,
  outcome text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := public.lead_customer_link_request_role();
  v_source_type text := nullif(pg_catalog.btrim(coalesce(p_source_type, '')), '');
  v_assertion_level text := nullif(pg_catalog.btrim(coalesce(p_assertion_level, '')), '');
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'qualification fact write by system is not authorized';
  end if;

  if v_source_type not in (
    'incoming_customer_message',
    'system_inference',
    'system_correction'
  ) then
    raise exception using
      errcode = '42501',
      message = 'ZION_QFACT_SYSTEM_SOURCE_NOT_AUTHORIZED';
  end if;

  if (v_source_type = 'system_inference' and v_assertion_level <> 'inferred')
     or (v_source_type <> 'system_inference' and v_assertion_level <> 'confirmed') then
    raise exception using
      errcode = '23514',
      message = 'ZION_QFACT_SYSTEM_ASSERTION_MISMATCH';
  end if;

  return query
  select *
  from public.apply_commercial_opportunity_qualification_fact_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_operation_key,
    p_fact_key,
    p_value_json,
    v_assertion_level,
    v_source_type,
    p_source_message_id,
    p_source_conversation_id,
    p_created_by,
    p_resolves_conflict
  );
end;
$function$;

alter function public.write_commercial_opportunity_qualification_fact_by_system(
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  text,
  text,
  uuid,
  uuid,
  text,
  boolean
) owner to postgres;

comment on function public.write_commercial_opportunity_qualification_fact_by_system(
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  text,
  text,
  uuid,
  uuid,
  text,
  boolean
) is
  'P9 system-only qualification fact writer. Resolves service_role through the canonical request-role helper so PostgREST JWT claims fallback works consistently.';

revoke all on function public.write_commercial_opportunity_qualification_fact_by_system(
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  text,
  text,
  uuid,
  uuid,
  text,
  boolean
) from public, anon, authenticated, service_role;

grant execute on function public.write_commercial_opportunity_qualification_fact_by_system(
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  text,
  text,
  uuid,
  uuid,
  text,
  boolean
) to service_role;

commit;
