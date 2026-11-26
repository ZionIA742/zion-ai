-- P9 Bloco 11 / Microetapas 1.2-1.4
-- Atomic optimistic-concurrency wrapper for CRM manual qualification facts.
-- This migration is intentionally not executed remotely by the implementation task.

create or replace function public.apply_commercial_qualification_fact_internal_if_current(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text,
  p_fact_key text,
  p_value_json jsonb,
  p_assertion_level text,
  p_source_type text,
  p_source_message_id uuid,
  p_source_conversation_id uuid,
  p_created_by text,
  p_resolves_conflict boolean,
  p_expected_last_event_id uuid
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
  v_current_last_event_id uuid;
begin
  -- This is the same lock domain used by the canonical writer. Holding it
  -- across the revision check and the delegated write makes the check CAS-like
  -- against both CRM and Sales AI writers.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:qfact:'
      || p_organization_id::text
      || ':' || p_store_id::text
      || ':' || p_commercial_opportunity_id::text
      || ':' || pg_catalog.btrim(p_fact_key),
      0
    )
  );

  -- A replay of the same operation must remain idempotent even after the
  -- current revision advanced because the original write already succeeded.
  if exists (
    select 1
    from public.commercial_opportunity_qualification_fact_events event_row
    where event_row.organization_id = p_organization_id
      and event_row.store_id = p_store_id
      and event_row.operation_key = p_operation_key
  ) then
    return query
    select *
    from public.apply_commercial_opportunity_qualification_fact_internal(
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id,
      p_operation_key,
      p_fact_key,
      p_value_json,
      p_assertion_level,
      p_source_type,
      p_source_message_id,
      p_source_conversation_id,
      p_created_by,
      p_resolves_conflict
    );
    return;
  end if;

  select current_row.last_event_id
  into v_current_last_event_id
  from public.commercial_opportunity_qualification_facts_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id
    and current_row.fact_key = pg_catalog.btrim(p_fact_key)
  for update;

  if v_current_last_event_id is distinct from p_expected_last_event_id then
    raise exception using
      errcode = '40001',
      message = 'ZION_QFACT_EXPECTED_REVISION_MISMATCH';
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
    p_assertion_level,
    p_source_type,
    p_source_message_id,
    p_source_conversation_id,
    p_created_by,
    p_resolves_conflict
  );
end;
$function$;

alter function public.apply_commercial_qualification_fact_internal_if_current(
  uuid, uuid, uuid, text, text, jsonb, text, text, uuid, uuid, text, boolean, uuid
) owner to postgres;

revoke all on function public.apply_commercial_qualification_fact_internal_if_current(
  uuid, uuid, uuid, text, text, jsonb, text, text, uuid, uuid, text, boolean, uuid
) from public, anon, authenticated, service_role;

create or replace function public.write_commercial_qualification_fact_by_user_if_current(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text,
  p_fact_key text,
  p_value_json jsonb,
  p_expected_last_event_id uuid,
  p_source_message_id uuid default null,
  p_source_conversation_id uuid default null,
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
set search_path = pg_catalog, pg_temp, public, auth
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_result record;
  v_conversation_id uuid;
  v_ledger_sqlstate text;
begin
  if v_user_id is null or v_request_role is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'qualification fact write by user is not authorized';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
      and membership_row.is_active is true
  ) then
    raise exception using errcode = '42501', message = 'qualification fact write by user is not authorized';
  end if;

  select * into v_result
  from public.apply_commercial_qualification_fact_internal_if_current(
    p_request_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_operation_key,
    p_fact_key,
    p_value_json,
    'confirmed',
    'crm_manual',
    p_source_message_id,
    p_source_conversation_id,
    ('user:' || v_user_id::text),
    p_resolves_conflict,
    p_expected_last_event_id
  );

  -- Evidence is append-only and must not turn an idempotent replay into a
  -- duplicate-key failure.
  if v_result.changed is true then
    select opportunity_row.primary_conversation_id
    into v_conversation_id
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = p_commercial_opportunity_id;

    if v_conversation_id is not null then
      begin
        perform public.record_human_qualification_decision_evidence_internal(
          p_request_organization_id,
          p_store_id,
          v_conversation_id,
          p_commercial_opportunity_id,
          v_user_id,
          p_operation_key,
          v_result.event_id,
          v_result.fact_key,
          p_value_json
        );
      exception when others then
        get stacked diagnostics v_ledger_sqlstate = returned_sqlstate;
        if v_ledger_sqlstate in ('22023', '23502', '23503', '23505', '23514', '40001', '40P01', '42501') then
          raise;
        end if;
      end;
    end if;
  end if;

  return query
  select v_result.commercial_opportunity_id, v_result.fact_key,
    v_result.event_id, v_result.current_last_event_id, v_result.current_state,
    v_result.current_value_json, v_result.normalized_value_text, v_result.value_kind,
    v_result.conflict_values_json, v_result.changed, v_result.outcome, v_result.updated_at;
end;
$function$;

alter function public.write_commercial_qualification_fact_by_user_if_current(
  uuid, uuid, uuid, text, text, jsonb, uuid, uuid, uuid, boolean
) owner to postgres;

revoke all on function public.write_commercial_qualification_fact_by_user_if_current(
  uuid, uuid, uuid, text, text, jsonb, uuid, uuid, uuid, boolean
) from public, anon, authenticated, service_role;

grant execute on function public.write_commercial_qualification_fact_by_user_if_current(
  uuid, uuid, uuid, text, text, jsonb, uuid, uuid, uuid, boolean
) to authenticated;

commit;
