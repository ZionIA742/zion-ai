begin;

set local search_path = pg_catalog, pg_temp, public, auth, extensions;

-- The D.1 ledger is shared by canonical human sources. A source id is
-- validated by the scoped SECURITY DEFINER writer for its source_type; a
-- single PostgreSQL FK cannot target both lifecycle and qualification events.
alter table public.commercial_human_decision_evidence
  drop constraint p9_human_evidence_source_fk,
  drop constraint p9_human_evidence_domain_chk,
  drop constraint p9_human_evidence_field_chk,
  drop constraint p9_human_evidence_source_type_chk;

alter table public.commercial_human_decision_evidence
  add constraint p9_human_evidence_domain_chk
    check (decision_domain in ('crm_stage', 'commercial_facts', 'proposal', 'products', 'commitments', 'opportunity')),
  add constraint p9_human_evidence_field_chk
    check (
      (decision_domain = 'crm_stage' and decision_field = 'stage')
      or (
        decision_domain = 'commercial_facts'
        and decision_field in (
          'need_summary', 'interested_product_reference', 'space_text',
          'requested_area_m2', 'location_text', 'preferred_period_text',
          'budget_text', 'decision_context', 'installation_interest',
          'payment_interest', 'technical_visit_interest',
          'customer_preferences_text', 'relevant_objection_text'
        )
      )
      or (decision_domain = 'proposal' and decision_field in ('proposal', 'total_value', 'currency', 'version'))
      or (decision_domain = 'products' and decision_field in ('product', 'quantity', 'unit_value', 'total_value'))
      or (decision_domain = 'commitments' and decision_field in ('commitment', 'scheduled_at', 'description'))
      or (decision_domain = 'opportunity' and decision_field = 'selected_opportunity')
    ),
  add constraint p9_human_evidence_source_type_chk
    check (source_type in (
      'commercial_opportunity_lifecycle_event',
      'commercial_opportunity_qualification_fact_event'
    ));

create or replace function public.record_human_qualification_decision_evidence_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_commercial_opportunity_id uuid,
  p_actor_user_id uuid,
  p_operation_key text,
  p_source_id uuid,
  p_fact_key text,
  p_canonical_value_json jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public, auth
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_existing public.commercial_human_decision_evidence;
  v_opportunity public.commercial_opportunities;
  v_event public.commercial_opportunity_qualification_fact_events;
  v_evidence_id uuid;
begin
  if v_user_id is null or v_user_id is distinct from p_actor_user_id
     or nullif(current_setting('request.jwt.claim.role', true), '') <> 'authenticated' then
    raise exception using errcode = '42501', message = 'human qualification evidence actor is not authorized';
  end if;

  select opportunity_row.* into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
    and opportunity_row.primary_conversation_id = p_conversation_id
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'human qualification evidence opportunity scope mismatch';
  end if;

  select event_row.* into v_event
  from public.commercial_opportunity_qualification_fact_events event_row
  where event_row.id = p_source_id
    and event_row.organization_id = p_organization_id
    and event_row.store_id = p_store_id
    and event_row.commercial_opportunity_id = p_commercial_opportunity_id
    and event_row.fact_key = p_fact_key
    and event_row.operation_key = p_operation_key
    and event_row.source_type = 'crm_manual'
    and event_row.assertion_level = 'confirmed'
    and event_row.created_by = 'user:' || p_actor_user_id::text
    and event_row.value_json is not distinct from p_canonical_value_json;
  if not found then
    raise exception using errcode = '23514', message = 'human qualification evidence source is not canonical';
  end if;

  select * into v_existing
  from public.commercial_human_decision_evidence evidence_row
  where evidence_row.organization_id = p_organization_id
    and evidence_row.operation_key = p_operation_key;
  if found then
    if v_existing.source_id is distinct from p_source_id
       or v_existing.actor_user_id is distinct from p_actor_user_id
       or v_existing.commercial_opportunity_id is distinct from p_commercial_opportunity_id
       or v_existing.decision_domain is distinct from 'commercial_facts'
       or v_existing.decision_field is distinct from p_fact_key
       or v_existing.canonical_value_json is distinct from p_canonical_value_json then
      raise exception using errcode = '23505', message = 'ZION_HUMAN_EVIDENCE_IDEMPOTENCY_KEY_REUSED';
    end if;
    return v_existing.id;
  end if;

  insert into public.commercial_human_decision_evidence (
    organization_id, store_id, conversation_id, commercial_opportunity_id,
    actor_user_id, decision_domain, decision_field, canonical_value_json,
    source_type, source_id, source_version, operation_key, observed_at
  ) values (
    p_organization_id, p_store_id, p_conversation_id, p_commercial_opportunity_id,
    p_actor_user_id, 'commercial_facts', p_fact_key, p_canonical_value_json,
    'commercial_opportunity_qualification_fact_event', v_event.id, v_event.id::text,
    p_operation_key, v_event.created_at
  ) returning id into v_evidence_id;

  return v_evidence_id;
end;
$function$;

alter function public.record_human_qualification_decision_evidence_internal(uuid, uuid, uuid, uuid, uuid, text, uuid, text, jsonb) owner to postgres;
revoke all on function public.record_human_qualification_decision_evidence_internal(uuid, uuid, uuid, uuid, uuid, text, uuid, text, jsonb) from public, anon, authenticated, service_role;

create or replace function public.write_commercial_opportunity_qualification_fact_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text,
  p_fact_key text,
  p_value_json jsonb,
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
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using errcode = '42501', message = 'qualification fact write by user is not authorized';
  end if;

  if not exists (
    select 1 from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
      and membership_row.is_active is true
  ) then
    raise exception using errcode = '42501', message = 'qualification fact write by user is not authorized';
  end if;

  select * into v_result
  from public.apply_commercial_opportunity_qualification_fact_internal(
    p_request_organization_id, p_store_id, p_commercial_opportunity_id,
    p_operation_key, p_fact_key, p_value_json, 'confirmed', 'crm_manual',
    p_source_message_id, p_source_conversation_id, ('user:' || v_user_id::text),
    p_resolves_conflict
  );

  select opportunity_row.primary_conversation_id into v_conversation_id
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id;
  if v_conversation_id is not null then
    begin
      perform public.record_human_qualification_decision_evidence_internal(
        p_request_organization_id, p_store_id, v_conversation_id,
        p_commercial_opportunity_id, v_user_id, p_operation_key,
        v_result.event_id, v_result.fact_key, p_value_json
      );
    exception when others then
      get stacked diagnostics v_ledger_sqlstate = returned_sqlstate;
      if v_ledger_sqlstate in ('22023', '23502', '23503', '23505', '23514', '40001', '40P01', '42501') then
        raise;
      end if;
      null;
    end;
  end if;

  return query select v_result.commercial_opportunity_id, v_result.fact_key,
    v_result.event_id, v_result.current_last_event_id, v_result.current_state,
    v_result.current_value_json, v_result.normalized_value_text, v_result.value_kind,
    v_result.conflict_values_json, v_result.changed, v_result.outcome, v_result.updated_at;
end;
$function$;

alter function public.write_commercial_opportunity_qualification_fact_by_user(uuid, uuid, uuid, text, text, jsonb, uuid, uuid, boolean) owner to postgres;
revoke all on function public.write_commercial_opportunity_qualification_fact_by_user(uuid, uuid, uuid, text, text, jsonb, uuid, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.write_commercial_opportunity_qualification_fact_by_user(uuid, uuid, uuid, text, text, jsonb, uuid, uuid, boolean) to authenticated;

commit;
