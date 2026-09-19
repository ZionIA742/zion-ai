-- P9 / Bloco 5 / Etapa 5.5.6
-- Cria nome RPC explicito abaixo do limite PostgreSQL de 63 bytes.
-- Nao remove a funcao historica truncada.

do $preflight$
begin
  if pg_catalog.to_regprocedure(
    'public.advance_commercial_opportunity_to_visit_stage_by_system(uuid,uuid,uuid,uuid,text,text,text)'
  ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: short technical visit stage projection RPC already exists';
  end if;
end;
$preflight$;

create function public.advance_commercial_opportunity_to_visit_stage_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_appointment_id uuid,
  p_idempotency_key text,
  p_reason_details text default null,
  p_source text default 'system_technical_visit_stage_projection'
)
returns table (
  commercial_opportunity_id uuid,
  appointment_id uuid,
  stage text,
  lifecycle_cycle integer,
  lifecycle_event_id uuid,
  event_type text,
  reason_code text,
  stage_changed boolean,
  outcome text,
  stage_changed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text :=
    coalesce(
      nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
      nullif(auth.jwt() ->> 'role', '')
    );
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'technical visit stage projection by system is not authorized';
  end if;

  return query
  select *
  from public.advance_commercial_opportunity_to_technical_visit_stage_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_appointment_id,
    p_idempotency_key,
    p_reason_details,
    p_source,
    'system',
    null
  );
end;
$function$;

revoke all on function public.advance_commercial_opportunity_to_visit_stage_by_system(
  uuid, uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.advance_commercial_opportunity_to_visit_stage_by_system(
  uuid, uuid, uuid, uuid, text, text, text
) to service_role;

comment on function public.advance_commercial_opportunity_to_visit_stage_by_system(
  uuid, uuid, uuid, uuid, text, text, text
) is
  'Canonical system RPC for technical-visit stage projection. Explicit short name avoids PostgreSQL 63-byte identifier truncation.';

do $postconditions$
begin
  if pg_catalog.to_regprocedure(
    'public.advance_commercial_opportunity_to_visit_stage_by_system(uuid,uuid,uuid,uuid,text,text,text)'
  ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: short technical visit stage projection RPC was not created';
  end if;

  if not pg_catalog.has_function_privilege(
    'service_role',
    'public.advance_commercial_opportunity_to_visit_stage_by_system(uuid,uuid,uuid,uuid,text,text,text)',
    'EXECUTE'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: service_role execute grant missing';
  end if;
end;
$postconditions$;
