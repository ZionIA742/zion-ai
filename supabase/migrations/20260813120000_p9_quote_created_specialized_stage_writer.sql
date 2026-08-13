do $preflight$
begin
  if pg_catalog.to_regclass('public.commercial_opportunities') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.commercial_opportunities is required';
  end if;

  if pg_catalog.to_regclass('public.sales_quotes') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.sales_quotes is required';
  end if;

  if pg_catalog.to_regclass('public.commercial_opportunity_lifecycle_events') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.commercial_opportunity_lifecycle_events is required';
  end if;

  if pg_catalog.to_regprocedure(
    'public.apply_commercial_opportunity_stage_transition_internal(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text,uuid)'
  ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.apply_commercial_opportunity_stage_transition_internal(...) is required';
  end if;

  if pg_catalog.to_regprocedure(
    'public.compute_commercial_opportunity_event_fingerprint_internal(uuid,uuid,uuid,integer,text,text,text,text,uuid,text,text,text,text,uuid,text)'
  ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.compute_commercial_opportunity_event_fingerprint_internal(...) is required';
  end if;
end;
$preflight$;

create or replace function public.advance_commercial_opportunity_to_quote_stage_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_sales_quote_id uuid,
  p_idempotency_key text,
  p_reason_details text default null,
  p_source text default 'system_quote_created_stage_projection'
)
returns table (
  commercial_opportunity_id uuid,
  sales_quote_id uuid,
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
  v_idempotency_key text := nullif(pg_catalog.btrim(coalesce(p_idempotency_key, '')), '');
  v_reason_details text := nullif(pg_catalog.btrim(coalesce(p_reason_details, '')), '');
  v_source text := nullif(pg_catalog.btrim(coalesce(p_source, '')), '');
  v_evidence_type constant text := 'sales_quote_created';
  v_reason_code constant text := 'explicit_quote_intent_required';
  v_opportunity public.commercial_opportunities;
  v_sales_quote public.sales_quotes;
  v_existing_event public.commercial_opportunity_lifecycle_events;
  v_internal_event public.commercial_opportunity_lifecycle_events;
  v_internal_result record;
  v_stored_event_key text;
  v_candidate_event_key text;
  v_evidence_summary text;
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity quote-stage advance by system is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_sales_quote_id is null
     or v_idempotency_key is null
     or v_source is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_QUOTE_STAGE_ADVANCE_ARGUMENTS_REQUIRED';
  end if;

  v_evidence_summary := 'sales_quote_id=' || p_sales_quote_id::text;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'commercial opportunity not found';
  end if;

  if v_opportunity.organization_id is distinct from p_organization_id
     or v_opportunity.store_id is distinct from p_store_id then
    raise exception using
      errcode = '23514',
      message = 'commercial opportunity scope mismatch';
  end if;

  select sales_quote_row.*
  into v_sales_quote
  from public.sales_quotes sales_quote_row
  where sales_quote_row.id = p_sales_quote_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'sales quote not found';
  end if;

  if v_sales_quote.organization_id is distinct from p_organization_id
     or v_sales_quote.store_id is distinct from p_store_id then
    raise exception using
      errcode = '23514',
      message = 'sales quote scope mismatch';
  end if;

  if v_sales_quote.commercial_opportunity_id is null then
    raise exception using
      errcode = '23514',
      message = 'sales quote is not linked to a commercial opportunity';
  end if;

  if v_sales_quote.commercial_opportunity_id is distinct from v_opportunity.id then
    raise exception using
      errcode = '23514',
      message = 'sales quote opportunity mismatch';
  end if;

  select lifecycle_event.*
  into v_existing_event
  from public.commercial_opportunity_lifecycle_events lifecycle_event
  where lifecycle_event.organization_id = v_opportunity.organization_id
    and lifecycle_event.store_id = v_opportunity.store_id
    and lifecycle_event.commercial_opportunity_id = v_opportunity.id
    and lifecycle_event.idempotency_key = v_idempotency_key
  limit 1;

  if v_existing_event.id is not null then
    if v_existing_event.event_type <> 'stage_transition'
       or v_existing_event.previous_stage not in ('novo_lead', 'qualificacao')
       or v_existing_event.new_stage <> 'orcamento'
       or v_existing_event.actor_type <> 'system'
       or v_existing_event.actor_user_id is not null then
      raise exception using
        errcode = '23505',
        message = 'ZION_IDEMPOTENCY_KEY_REUSED';
    end if;

    v_stored_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
      v_existing_event.organization_id,
      v_existing_event.store_id,
      v_existing_event.commercial_opportunity_id,
      v_existing_event.lifecycle_cycle,
      v_existing_event.event_type,
      v_existing_event.previous_stage,
      v_existing_event.new_stage,
      v_existing_event.actor_type,
      v_existing_event.actor_user_id,
      v_existing_event.reason_code,
      v_existing_event.reason_details,
      v_existing_event.source,
      v_existing_event.evidence_type,
      v_existing_event.evidence_message_id,
      v_existing_event.evidence_summary
    );

    if v_existing_event.event_key is distinct from v_stored_event_key then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_STORED_EVENT_FINGERPRINT_MISMATCH';
    end if;

    v_candidate_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
      v_existing_event.organization_id,
      v_existing_event.store_id,
      v_existing_event.commercial_opportunity_id,
      v_existing_event.lifecycle_cycle,
      'stage_transition',
      v_existing_event.previous_stage,
      v_existing_event.new_stage,
      'system',
      null,
      v_reason_code,
      v_reason_details,
      v_source,
      v_evidence_type,
      null,
      v_evidence_summary
    );

    if v_existing_event.reason_code is distinct from v_reason_code
       or v_existing_event.evidence_type is distinct from v_evidence_type
       or v_existing_event.evidence_message_id is not null
       or v_candidate_event_key is distinct from v_existing_event.event_key then
      raise exception using
        errcode = '23505',
        message = 'ZION_IDEMPOTENCY_KEY_REUSED';
    end if;

    return query
    select
      v_opportunity.id,
      p_sales_quote_id,
      v_opportunity.stage,
      v_opportunity.lifecycle_cycle,
      v_existing_event.id,
      v_existing_event.event_type,
      v_existing_event.reason_code,
      false,
      'idempotent_replay'::text,
      v_opportunity.stage_changed_at,
      v_opportunity.updated_at;
    return;
  end if;

  if v_opportunity.stage in ('novo_lead', 'qualificacao') then
    select *
    into v_internal_result
    from public.apply_commercial_opportunity_stage_transition_internal(
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id,
      v_idempotency_key,
      'orcamento',
      v_reason_details,
      v_evidence_type,
      null,
      v_evidence_summary,
      v_source,
      'stage_transition',
      'system',
      null
    );

    if v_internal_result.commercial_opportunity_id is distinct from v_opportunity.id
       or v_internal_result.stage is distinct from 'orcamento'
       or v_internal_result.event_type is distinct from 'stage_transition'
       or v_internal_result.reason_code is distinct from v_reason_code
       or v_internal_result.lifecycle_event_id is null
       or v_internal_result.lifecycle_cycle is distinct from v_opportunity.lifecycle_cycle then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_QUOTE_STAGE_ADVANCE_INTERNAL_CONTRACT_MISMATCH';
    end if;

    select lifecycle_event.*
    into v_internal_event
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.id = v_internal_result.lifecycle_event_id;

    if not found
       or v_internal_event.commercial_opportunity_id is distinct from v_opportunity.id
       or v_internal_event.lifecycle_cycle is distinct from v_opportunity.lifecycle_cycle
       or v_internal_event.event_type is distinct from 'stage_transition'
       or v_internal_event.reason_code is distinct from v_reason_code
       or v_internal_event.new_stage is distinct from 'orcamento'
       or v_internal_event.evidence_type is distinct from v_evidence_type
       or v_internal_event.evidence_summary is distinct from v_evidence_summary then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_QUOTE_STAGE_ADVANCE_INTERNAL_CONTRACT_MISMATCH';
    end if;

    return query
    select
      v_internal_result.commercial_opportunity_id,
      p_sales_quote_id,
      v_internal_result.stage,
      v_internal_result.lifecycle_cycle,
      v_internal_result.lifecycle_event_id,
      v_internal_result.event_type,
      v_internal_result.reason_code,
      true,
      'advanced_to_orcamento'::text,
      v_internal_result.stage_changed_at,
      v_internal_result.updated_at;
    return;
  end if;

  if v_opportunity.stage = 'orcamento' then
    return query
    select
      v_opportunity.id,
      p_sales_quote_id,
      v_opportunity.stage,
      v_opportunity.lifecycle_cycle,
      null::uuid,
      null::text,
      null::text,
      false,
      'already_in_quote_stage'::text,
      v_opportunity.stage_changed_at,
      v_opportunity.updated_at;
    return;
  end if;

  return query
  select
    v_opportunity.id,
    p_sales_quote_id,
    v_opportunity.stage,
    v_opportunity.lifecycle_cycle,
    null::uuid,
    null::text,
    null::text,
    false,
    'stage_not_eligible_for_quote_projection'::text,
    v_opportunity.stage_changed_at,
    v_opportunity.updated_at;
end;
$function$;

alter function public.advance_commercial_opportunity_to_quote_stage_by_system(
  uuid, uuid, uuid, uuid, text, text, text
) owner to postgres;

comment on function public.advance_commercial_opportunity_to_quote_stage_by_system(
  uuid, uuid, uuid, uuid, text, text, text
) is
  'Writer especializado de sistema para quote criada: avanca apenas novo_lead/qualificacao para orcamento, retorna no-op em orcamento e skip fail-closed para estagios posteriores sem regressao.';

revoke all on function public.advance_commercial_opportunity_to_quote_stage_by_system(
  uuid, uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.advance_commercial_opportunity_to_quote_stage_by_system(
  uuid, uuid, uuid, uuid, text, text, text
) to service_role;

do $postconditions$
declare
  v_proc_oid oid := pg_catalog.to_regprocedure(
    'public.advance_commercial_opportunity_to_quote_stage_by_system(uuid,uuid,uuid,uuid,text,text,text)'
  );
  v_definition text;
  v_normalized_definition text;
begin
  if v_proc_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: quote-stage specialized writer was not created';
  end if;

  select pg_catalog.pg_get_functiondef(v_proc_oid)
  into v_definition;

  v_normalized_definition := lower(regexp_replace(coalesce(v_definition, ''), '\s+', ' ', 'g'));

  if v_normalized_definition not like '%for update%'
     or v_normalized_definition not like '%from public.sales_quotes%'
     or v_normalized_definition not like '%apply_commercial_opportunity_stage_transition_internal%'
     or v_normalized_definition not like '%novo_lead%'
     or v_normalized_definition not like '%qualificacao%'
     or v_normalized_definition not like '%orcamento%'
     or v_normalized_definition not like '%sales_quote_created%'
     or v_normalized_definition not like '%zion_quote_stage_advance_internal_contract_mismatch%'
     or v_normalized_definition like '%transition_commercial_opportunity_stage_by_system%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: quote-stage specialized writer definition mismatch';
  end if;

  if pg_catalog.pg_get_userbyid((select proc_row.proowner from pg_catalog.pg_proc proc_row where proc_row.oid = v_proc_oid)) <> 'postgres' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: quote-stage specialized writer owner mismatch';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc proc_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(proc_row.proacl, pg_catalog.acldefault('f', proc_row.proowner))
    ) privilege_row
    where proc_row.oid = v_proc_oid
      and privilege_row.grantee = 0
      and privilege_row.privilege_type = 'EXECUTE'
  ) or pg_catalog.has_function_privilege('anon', v_proc_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_proc_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_proc_oid, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: quote-stage specialized writer grants mismatch';
  end if;
end;
$postconditions$;
