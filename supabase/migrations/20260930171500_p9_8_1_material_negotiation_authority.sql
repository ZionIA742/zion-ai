-- ZION / Pilar 9 / Bloco 8 / Etapa 8.1
-- Material negotiation authority.
--
-- Scope:
-- - only real material commercial negotiation may project an opportunity to `negociacao`;
-- - generic human/system stage writers are forbidden from targeting `negociacao`;
-- - the stage transition matrix marks normal entries to `negociacao` as specialized;
-- - the existing append-only commercial_opportunity_lifecycle_events row remains the
--   canonical atomic evidence + stage-transition record for 8.1;
-- - no discount/concession autonomy or negotiation execution policy is implemented here;
-- - reopen from `perdido` remains owned by the existing reopen authority.

do $preflight$
begin
  if pg_catalog.to_regprocedure(
       'public.normalize_commercial_opportunity_stage(text)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_1_PRECONDITION_NORMALIZE_STAGE_REQUIRED';
  end if;

  if pg_catalog.to_regprocedure(
       'public.resolve_commercial_opportunity_stage_transition(text,text)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_1_PRECONDITION_STAGE_MATRIX_REQUIRED';
  end if;

  if pg_catalog.to_regprocedure(
       'public.apply_commercial_opportunity_stage_transition_internal(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text,uuid)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_1_PRECONDITION_INTERNAL_STAGE_WRITER_REQUIRED';
  end if;

  if pg_catalog.to_regprocedure(
       'public.assert_commercial_opportunity_message_evidence(uuid,uuid,uuid,uuid,uuid)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_1_PRECONDITION_MESSAGE_EVIDENCE_AUTHORITY_REQUIRED';
  end if;

  if pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_lifecycle_events') is null
     or pg_catalog.to_regclass('public.messages') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_1_PRECONDITION_CANONICAL_TABLES_REQUIRED';
  end if;
end;
$preflight$;

create table if not exists public.commercial_opportunity_stage_transition_authority (
  transaction_id bigint not null,
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  idempotency_key text not null,
  target_stage text not null,
  evidence_type text not null,
  evidence_message_id uuid,
  evidence_summary text not null,
  source text not null,
  actor_type text not null,
  actor_user_id uuid,
  primary key (transaction_id, commercial_opportunity_id, idempotency_key)
);

alter table public.commercial_opportunity_stage_transition_authority owner to postgres;

revoke all on table public.commercial_opportunity_stage_transition_authority
  from public, anon, authenticated, service_role;

create or replace function public.resolve_commercial_opportunity_stage_transition(
  p_from_stage text,
  p_to_stage text
)
returns table (
  from_stage text,
  to_stage text,
  decision text,
  is_permitted boolean,
  requires_specialized_writer boolean,
  reason_code text
)
language plpgsql
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_from_stage text;
  v_to_stage text;
  v_reason_code text;
begin
  begin
    v_from_stage := public.normalize_commercial_opportunity_stage(p_from_stage);
  exception
    when sqlstate '22023' then
      raise exception using errcode = '22023', message = 'ZION_COMMERCIAL_STAGE_UNKNOWN';
  end;

  begin
    v_to_stage := public.normalize_commercial_opportunity_stage(p_to_stage);
  exception
    when sqlstate '22023' then
      raise exception using errcode = '22023', message = 'ZION_COMMERCIAL_STAGE_UNKNOWN';
  end;

  if v_from_stage is null or v_to_stage is null then
    raise exception using errcode = '22023', message = 'ZION_COMMERCIAL_STAGE_REQUIRED';
  end if;

  if v_from_stage = v_to_stage then
    return query select v_from_stage, v_to_stage, 'forbidden'::text, false, false, 'noop_same_stage'::text;
    return;
  end if;

  if v_from_stage in (
       'novo_lead','qualificacao','orcamento','visita_tecnica',
       'negociacao','fechamento_pagamento','instalacao_entrega','pos_venda'
     )
     and v_to_stage = 'perdido' then
    return query select v_from_stage, v_to_stage, 'conditional'::text, false, true, 'loss_writer_required'::text;
    return;
  end if;

  if v_from_stage = 'perdido'
     and v_to_stage in (
       'novo_lead','qualificacao','orcamento','visita_tecnica',
       'negociacao','fechamento_pagamento','instalacao_entrega','pos_venda'
     ) then
    return query select v_from_stage, v_to_stage, 'conditional'::text, false, true, 'reopen_writer_required'::text;
    return;
  end if;

  if v_from_stage in (
       'novo_lead','qualificacao','orcamento','visita_tecnica',
       'negociacao','fechamento_pagamento','instalacao_entrega','pos_venda'
     )
     and v_to_stage = 'concluido_sem_mais_acoes' then
    return query select v_from_stage, v_to_stage, 'conditional'::text, false, true, 'conclusion_writer_required'::text;
    return;
  end if;

  if v_from_stage = 'concluido_sem_mais_acoes'
     and v_to_stage = 'pos_venda' then
    return query select v_from_stage, v_to_stage, 'conditional'::text, false, true, 'post_sale_reopen_writer_required'::text;
    return;
  end if;

  if (
       v_from_stage = 'concluido_sem_mais_acoes'
       and v_to_stage in ('qualificacao', 'orcamento')
     ) or (
       v_from_stage = 'pos_venda'
       and v_to_stage in ('qualificacao', 'orcamento')
     ) then
    return query
    select v_from_stage, v_to_stage, 'forbidden'::text, false, false,
           'new_commercial_intent_requires_new_opportunity'::text;
    return;
  end if;

  if v_from_stage = 'qualificacao' and v_to_stage = 'negociacao' then
    return query
    select v_from_stage, v_to_stage, 'forbidden'::text, false, false,
           'negotiation_requires_quote_stage'::text;
    return;
  end if;

  if v_to_stage = 'negociacao'
     and v_from_stage in (
       'orcamento','visita_tecnica','fechamento_pagamento'
     ) then
    v_reason_code := case
      when v_from_stage = 'orcamento' then 'concrete_quote_objection_required'
      when v_from_stage = 'visita_tecnica' then 'visit_viable_concrete_offer_required'
      when v_from_stage = 'fechamento_pagamento' then 'renegotiation_required'
      else null
    end;

    return query
    select v_from_stage, v_to_stage, 'conditional'::text, false, true, v_reason_code;
    return;
  end if;

  v_reason_code := case
    when v_from_stage = 'novo_lead' and v_to_stage = 'qualificacao' then 'commercial_interest_required'
    when v_from_stage = 'novo_lead' and v_to_stage = 'orcamento' then 'explicit_quote_intent_required'
    when v_from_stage = 'novo_lead' and v_to_stage = 'visita_tecnica' then 'visit_eligibility_required'
    when v_from_stage = 'qualificacao' and v_to_stage = 'orcamento' then 'explicit_quote_intent_required'
    when v_from_stage = 'qualificacao' and v_to_stage = 'visita_tecnica' then 'visit_eligibility_required'
    when v_from_stage = 'orcamento' and v_to_stage = 'visita_tecnica' then 'visit_required_or_eligible'
    when v_from_stage = 'orcamento' and v_to_stage = 'fechamento_pagamento' then 'accepted_current_quote_required'
    when v_from_stage = 'visita_tecnica' and v_to_stage = 'qualificacao' then 'visit_result_missing_commercial_choices'
    when v_from_stage = 'visita_tecnica' and v_to_stage = 'orcamento' then 'visit_viable_quote_ready'
    when v_from_stage = 'negociacao' and v_to_stage = 'visita_tecnica' then 'mandatory_visit_pending'
    when v_from_stage = 'negociacao' and v_to_stage = 'orcamento' then 'quote_revision_required'
    when v_from_stage = 'negociacao' and v_to_stage = 'fechamento_pagamento' then 'accepted_negotiated_condition_required'
    when v_from_stage = 'fechamento_pagamento' and v_to_stage = 'orcamento' then 'quote_gate_revalidation_required'
    when v_from_stage = 'fechamento_pagamento' and v_to_stage = 'visita_tecnica' then 'mandatory_visit_pending'
    when v_from_stage = 'fechamento_pagamento' and v_to_stage = 'instalacao_entrega' then 'execution_release_gates_required'
    when v_from_stage = 'fechamento_pagamento' and v_to_stage = 'pos_venda' then 'simple_sale_completion_required'
    when v_from_stage = 'instalacao_entrega' and v_to_stage = 'pos_venda' then 'execution_completed_without_pending'
    else null
  end;

  if v_reason_code is not null then
    return query select v_from_stage, v_to_stage, 'conditional'::text, false, false, v_reason_code;
    return;
  end if;

  return query select v_from_stage, v_to_stage, 'forbidden'::text, false, false, 'transition_not_allowed'::text;
end;
$function$;

create or replace function public.apply_commercial_opportunity_stage_transition_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_idempotency_key text,
  p_target_stage text,
  p_reason_details text,
  p_evidence_type text,
  p_evidence_message_id uuid,
  p_evidence_summary text,
  p_source text,
  p_expected_event_type text,
  p_actor_type text,
  p_actor_user_id uuid
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  lifecycle_event_id uuid,
  event_type text,
  reason_code text,
  stage_changed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_target_stage text := nullif(pg_catalog.btrim(coalesce(p_target_stage, '')), '');
  v_reason_details text := nullif(pg_catalog.btrim(coalesce(p_reason_details, '')), '');
  v_evidence_type text := nullif(pg_catalog.btrim(coalesce(p_evidence_type, '')), '');
  v_evidence_summary text := nullif(pg_catalog.btrim(coalesce(p_evidence_summary, '')), '');
  v_source text := nullif(pg_catalog.btrim(coalesce(p_source, '')), '');
  v_idempotency_key text := nullif(pg_catalog.btrim(coalesce(p_idempotency_key, '')), '');
  v_actor_type text := nullif(pg_catalog.btrim(coalesce(p_actor_type, '')), '');
  v_opportunity public.commercial_opportunities;
  v_transition_row record;
  v_existing_event public.commercial_opportunity_lifecycle_events;
  v_transition_event public.commercial_opportunity_lifecycle_events;
  v_event_key text;
  v_stored_event_key text;
  v_candidate_event_key text;
  v_constraint_name text;
  v_is_material_negotiation_evidence boolean := false;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or v_target_stage is null
     or v_idempotency_key is null
     or v_evidence_type is null
     or v_evidence_summary is null
     or v_source is null
     or p_expected_event_type is null
     or v_actor_type is null then
    raise exception using errcode = '22023', message = 'ZION_STAGE_TRANSITION_ARGUMENTS_REQUIRED';
  end if;

  if p_expected_event_type not in ('stage_transition', 'conclusion', 'post_sale_reopen') then
    raise exception using errcode = '22023', message = 'ZION_STAGE_TRANSITION_EVENT_TYPE_INVALID';
  end if;

  if v_actor_type not in ('human', 'system') then
    raise exception using errcode = '22023', message = 'ZION_STAGE_TRANSITION_ACTOR_INVALID';
  end if;

  if (v_actor_type = 'human' and p_actor_user_id is null)
     or (v_actor_type <> 'human' and p_actor_user_id is not null) then
    raise exception using errcode = '22023', message = 'ZION_STAGE_TRANSITION_ACTOR_MISMATCH';
  end if;

  if v_target_stage = 'negociacao' then
    if not exists (
      select 1
      from public.commercial_opportunity_stage_transition_authority authority_row
      where authority_row.transaction_id = pg_catalog.txid_current()
        and authority_row.organization_id = p_organization_id
        and authority_row.store_id = p_store_id
        and authority_row.commercial_opportunity_id = p_commercial_opportunity_id
        and authority_row.idempotency_key = v_idempotency_key
        and authority_row.target_stage = v_target_stage
        and authority_row.evidence_type = v_evidence_type
        and authority_row.evidence_message_id is not distinct from p_evidence_message_id
        and authority_row.evidence_summary = v_evidence_summary
        and authority_row.source = v_source
        and authority_row.actor_type = v_actor_type
        and authority_row.actor_user_id is not distinct from p_actor_user_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'ZION_NEGOTIATION_SPECIALIZED_WRITER_REQUIRED';
    end if;

    delete from public.commercial_opportunity_stage_transition_authority authority_row
    where authority_row.transaction_id = pg_catalog.txid_current()
      and authority_row.organization_id = p_organization_id
      and authority_row.store_id = p_store_id
      and authority_row.commercial_opportunity_id = p_commercial_opportunity_id
      and authority_row.idempotency_key = v_idempotency_key;
  end if;

  v_is_material_negotiation_evidence :=
    v_evidence_type in (
      'material_negotiation_discount_request',
      'material_negotiation_price_counteroffer',
      'material_negotiation_payment_terms_negotiation',
      'material_negotiation_included_items_negotiation',
      'material_negotiation_commercial_deadline_negotiation',
      'material_negotiation_concession_exchange'
    );

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'commercial opportunity not found';
  end if;

  if v_opportunity.organization_id is distinct from p_organization_id
     or v_opportunity.store_id is distinct from p_store_id then
    raise exception using errcode = '23514', message = 'commercial opportunity scope mismatch';
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
    if v_existing_event.event_type <> p_expected_event_type
       or v_existing_event.new_stage is distinct from v_target_stage then
      raise exception using errcode = '23505', message = 'ZION_IDEMPOTENCY_KEY_REUSED';
    end if;

    if v_opportunity.stage is distinct from v_existing_event.new_stage
       or v_opportunity.lifecycle_cycle is distinct from v_existing_event.lifecycle_cycle then
      raise exception using errcode = '23514', message = 'ZION_IDEMPOTENT_STAGE_TRANSITION_OBSOLETE';
    end if;

    select *
    into v_transition_row
    from public.resolve_commercial_opportunity_stage_transition(
      v_existing_event.previous_stage,
      v_existing_event.new_stage
    );

    if not found then
      raise exception using errcode = 'P0001', message = 'ZION_STAGE_TRANSITION_MATRIX_UNAVAILABLE';
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
      raise exception using errcode = 'P0001', message = 'ZION_STORED_EVENT_FINGERPRINT_MISMATCH';
    end if;

    v_candidate_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
      v_existing_event.organization_id,
      v_existing_event.store_id,
      v_existing_event.commercial_opportunity_id,
      v_existing_event.lifecycle_cycle,
      p_expected_event_type,
      v_existing_event.previous_stage,
      v_existing_event.new_stage,
      v_actor_type,
      p_actor_user_id,
      v_existing_event.reason_code,
      v_reason_details,
      v_source,
      v_evidence_type,
      p_evidence_message_id,
      v_evidence_summary
    );

    if v_candidate_event_key is distinct from v_existing_event.event_key then
      raise exception using errcode = '23505', message = 'ZION_IDEMPOTENCY_KEY_REUSED';
    end if;

    return query
    select opportunity_row.id, opportunity_row.stage, opportunity_row.lifecycle_cycle,
           v_existing_event.id, v_existing_event.event_type, v_existing_event.reason_code,
           opportunity_row.stage_changed_at, opportunity_row.updated_at
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = v_opportunity.id;
    return;
  end if;

  select *
  into v_transition_row
  from public.resolve_commercial_opportunity_stage_transition(v_opportunity.stage, v_target_stage);

  if not found then
    raise exception using errcode = 'P0001', message = 'ZION_STAGE_TRANSITION_MATRIX_UNAVAILABLE';
  end if;

  if v_transition_row.decision = 'forbidden' then
    raise exception using
      errcode = '23514',
      message = 'ZION_STAGE_TRANSITION_FORBIDDEN',
      detail = coalesce(v_transition_row.reason_code, 'transition_forbidden');
  end if;

  if p_expected_event_type = 'stage_transition' then
    if v_transition_row.decision <> 'conditional'
       or v_transition_row.is_permitted
       or v_transition_row.to_stage in ('perdido', 'concluido_sem_mais_acoes') then
      raise exception using
        errcode = '23514',
        message = 'ZION_SPECIALIZED_STAGE_WRITER_REQUIRED',
        detail = coalesce(v_transition_row.reason_code, 'specialized_writer_required');
    end if;

    if v_transition_row.requires_specialized_writer then
      if v_transition_row.to_stage <> 'negociacao'
         or v_transition_row.reason_code not in (
           'concrete_offer_required',
           'concrete_quote_objection_required',
           'visit_viable_concrete_offer_required',
           'renegotiation_required'
         )
         or not v_is_material_negotiation_evidence then
        raise exception using
          errcode = '23514',
          message = 'ZION_SPECIALIZED_STAGE_WRITER_REQUIRED',
          detail = coalesce(v_transition_row.reason_code, 'specialized_writer_required');
      end if;
    elsif v_transition_row.to_stage = 'negociacao' then
      raise exception using
        errcode = '23514',
        message = 'ZION_NEGOTIATION_SPECIALIZED_WRITER_REQUIRED',
        detail = coalesce(v_transition_row.reason_code, 'material_negotiation_required');
    end if;
  elsif p_expected_event_type = 'conclusion' then
    if v_transition_row.to_stage <> 'concluido_sem_mais_acoes'
       or v_transition_row.decision <> 'conditional'
       or not v_transition_row.requires_specialized_writer
       or v_transition_row.reason_code <> 'conclusion_writer_required' then
      raise exception using
        errcode = '23514',
        message = 'ZION_CONCLUSION_TRANSITION_FORBIDDEN',
        detail = coalesce(v_transition_row.reason_code, 'conclusion_forbidden');
    end if;
  elsif p_expected_event_type = 'post_sale_reopen' then
    if v_opportunity.stage <> 'concluido_sem_mais_acoes'
       or v_transition_row.to_stage <> 'pos_venda'
       or v_transition_row.decision <> 'conditional'
       or not v_transition_row.requires_specialized_writer
       or v_transition_row.reason_code <> 'post_sale_reopen_writer_required' then
      raise exception using
        errcode = '23514',
        message = 'ZION_POST_SALE_REOPEN_FORBIDDEN',
        detail = coalesce(v_transition_row.reason_code, 'post_sale_reopen_forbidden');
    end if;
  end if;

  if p_evidence_message_id is not null then
    perform public.assert_commercial_opportunity_message_evidence(
      p_organization_id => v_opportunity.organization_id,
      p_store_id => v_opportunity.store_id,
      p_commercial_opportunity_id => v_opportunity.id,
      p_customer_id => v_opportunity.customer_id,
      p_evidence_message_id => p_evidence_message_id
    );
  end if;

  v_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id,
    v_opportunity.lifecycle_cycle,
    p_expected_event_type,
    v_opportunity.stage,
    v_transition_row.to_stage,
    v_actor_type,
    p_actor_user_id,
    v_transition_row.reason_code,
    v_reason_details,
    v_source,
    v_evidence_type,
    p_evidence_message_id,
    v_evidence_summary
  );

  begin
    insert into public.commercial_opportunity_lifecycle_events (
      organization_id, store_id, commercial_opportunity_id, customer_id,
      lifecycle_cycle, event_type, previous_stage, new_stage, reason_code,
      reason_details, evidence_type, evidence_message_id, evidence_summary,
      actor_type, actor_user_id, source, metadata, idempotency_key, event_key
    )
    values (
      v_opportunity.organization_id, v_opportunity.store_id, v_opportunity.id,
      v_opportunity.customer_id, v_opportunity.lifecycle_cycle, p_expected_event_type,
      v_opportunity.stage, v_transition_row.to_stage, v_transition_row.reason_code,
      v_reason_details, v_evidence_type, p_evidence_message_id, v_evidence_summary,
      v_actor_type, p_actor_user_id, v_source,
      pg_catalog.jsonb_build_object(
        'request_organization_id', p_organization_id,
        'requested_store_id', p_store_id
      ),
      v_idempotency_key, v_event_key
    )
    returning * into v_transition_event;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;

      if v_constraint_name = 'commercial_opportunity_lifecycle_events_idempotency_uidx' then
        select lifecycle_event.*
        into v_existing_event
        from public.commercial_opportunity_lifecycle_events lifecycle_event
        where lifecycle_event.organization_id = v_opportunity.organization_id
          and lifecycle_event.store_id = v_opportunity.store_id
          and lifecycle_event.commercial_opportunity_id = v_opportunity.id
          and lifecycle_event.idempotency_key = v_idempotency_key
        limit 1;

        if found then
          if v_existing_event.event_type <> p_expected_event_type
             or v_existing_event.new_stage is distinct from v_target_stage then
            raise exception using errcode = '23505', message = 'ZION_IDEMPOTENCY_KEY_REUSED';
          end if;

          if v_opportunity.stage is distinct from v_existing_event.new_stage
             or v_opportunity.lifecycle_cycle is distinct from v_existing_event.lifecycle_cycle then
            raise exception using errcode = '23514', message = 'ZION_IDEMPOTENT_STAGE_TRANSITION_OBSOLETE';
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
            raise exception using errcode = 'P0001', message = 'ZION_STORED_EVENT_FINGERPRINT_MISMATCH';
          end if;

          v_candidate_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
            v_existing_event.organization_id,
            v_existing_event.store_id,
            v_existing_event.commercial_opportunity_id,
            v_existing_event.lifecycle_cycle,
            p_expected_event_type,
            v_existing_event.previous_stage,
            v_existing_event.new_stage,
            v_actor_type,
            p_actor_user_id,
            v_existing_event.reason_code,
            v_reason_details,
            v_source,
            v_evidence_type,
            p_evidence_message_id,
            v_evidence_summary
          );

          if v_candidate_event_key is distinct from v_existing_event.event_key then
            raise exception using errcode = '23505', message = 'ZION_IDEMPOTENCY_KEY_REUSED';
          end if;

          return query
          select opportunity_row.id, opportunity_row.stage, opportunity_row.lifecycle_cycle,
                 v_existing_event.id, v_existing_event.event_type, v_existing_event.reason_code,
                 opportunity_row.stage_changed_at, opportunity_row.updated_at
          from public.commercial_opportunities opportunity_row
          where opportunity_row.id = v_opportunity.id;
          return;
        end if;
      end if;

      raise;
  end;

  update public.commercial_opportunities opportunity_row
  set stage = v_transition_event.new_stage
  where opportunity_row.id = v_opportunity.id;

  return query
  select opportunity_row.id, opportunity_row.stage, opportunity_row.lifecycle_cycle,
         v_transition_event.id, v_transition_event.event_type, v_transition_event.reason_code,
         opportunity_row.stage_changed_at, opportunity_row.updated_at
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = v_opportunity.id;
end;
$function$;

create or replace function public.apply_material_commercial_negotiation_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_expected_lifecycle_cycle integer,
  p_idempotency_key text,
  p_material_kind text,
  p_evidence_message_id uuid,
  p_evidence_summary text,
  p_reason_details text,
  p_source text,
  p_actor_type text,
  p_actor_user_id uuid
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  lifecycle_event_id uuid,
  event_type text,
  reason_code text,
  material_kind text,
  stage_changed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_idempotency_key text := nullif(pg_catalog.btrim(coalesce(p_idempotency_key, '')), '');
  v_material_kind text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_material_kind, '')), ''));
  v_evidence_summary text := nullif(pg_catalog.btrim(coalesce(p_evidence_summary, '')), '');
  v_reason_details text := nullif(pg_catalog.btrim(coalesce(p_reason_details, '')), '');
  v_source text := nullif(pg_catalog.btrim(coalesce(p_source, '')), '');
  v_actor_type text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_actor_type, '')), ''));
  v_evidence_type text;
  v_opportunity public.commercial_opportunities;
  v_message public.messages;
  v_result record;
  v_event public.commercial_opportunity_lifecycle_events;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_expected_lifecycle_cycle is null
     or p_expected_lifecycle_cycle < 0
     or v_idempotency_key is null
     or v_material_kind is null
     or v_evidence_summary is null
     or v_source is null
     or v_actor_type is null then
    raise exception using errcode = '22023', message = 'ZION_MATERIAL_NEGOTIATION_ARGUMENTS_REQUIRED';
  end if;

  if v_actor_type not in ('human', 'system')
     or (v_actor_type = 'human' and p_actor_user_id is null)
     or (v_actor_type = 'system' and p_actor_user_id is not null) then
    raise exception using errcode = '22023', message = 'ZION_MATERIAL_NEGOTIATION_ACTOR_INVALID';
  end if;

  if v_material_kind not in (
       'discount_request',
       'price_counteroffer',
       'payment_terms_negotiation',
       'included_items_negotiation',
       'commercial_deadline_negotiation',
       'concession_exchange'
     ) then
    raise exception using errcode = '22023', message = 'ZION_MATERIAL_NEGOTIATION_KIND_INVALID';
  end if;

  v_evidence_type := 'material_negotiation_' || v_material_kind;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'commercial opportunity not found';
  end if;

  if v_opportunity.organization_id is distinct from p_organization_id
     or v_opportunity.store_id is distinct from p_store_id then
    raise exception using errcode = '23514', message = 'commercial opportunity scope mismatch';
  end if;

  if v_opportunity.lifecycle_cycle is distinct from p_expected_lifecycle_cycle then
    raise exception using errcode = '23514', message = 'ZION_MATERIAL_NEGOTIATION_LIFECYCLE_STALE';
  end if;

  if v_actor_type = 'system' and p_evidence_message_id is null then
    raise exception using errcode = '23514', message = 'ZION_MATERIAL_NEGOTIATION_SYSTEM_MESSAGE_REQUIRED';
  end if;

  if p_evidence_message_id is not null then
    select message_row.*
    into v_message
    from public.messages message_row
    where message_row.id = p_evidence_message_id
      and message_row.organization_id = p_organization_id
      and message_row.store_id = p_store_id;

    if not found then
      raise exception using errcode = '23514', message = 'ZION_MATERIAL_NEGOTIATION_MESSAGE_OUT_OF_SCOPE';
    end if;

    if v_message.deleted_at is not null
       or nullif(pg_catalog.btrim(coalesce(v_message.content, '')), '') is null then
      raise exception using errcode = '23514', message = 'ZION_MATERIAL_NEGOTIATION_MESSAGE_INVALID';
    end if;

    if pg_catalog.lower(
         pg_catalog.btrim(coalesce(v_message.direction, ''))
       ) <> 'incoming' then
      raise exception using
        errcode = '23514',
        message = 'ZION_MATERIAL_NEGOTIATION_MESSAGE_NOT_INBOUND';
    end if;

    perform public.assert_commercial_opportunity_message_evidence(
      p_organization_id => v_opportunity.organization_id,
      p_store_id => v_opportunity.store_id,
      p_commercial_opportunity_id => v_opportunity.id,
      p_customer_id => v_opportunity.customer_id,
      p_evidence_message_id => p_evidence_message_id
    );
  end if;

  insert into public.commercial_opportunity_stage_transition_authority (
    transaction_id, organization_id, store_id, commercial_opportunity_id,
    idempotency_key, target_stage, evidence_type, evidence_message_id,
    evidence_summary, source, actor_type, actor_user_id
  )
  values (
    pg_catalog.txid_current(), p_organization_id, p_store_id,
    p_commercial_opportunity_id, v_idempotency_key, 'negociacao',
    v_evidence_type, p_evidence_message_id, v_evidence_summary, v_source,
    v_actor_type, p_actor_user_id
  )
  on conflict on constraint commercial_opportunity_stage_transition_authority_pkey
  do update set
    organization_id = excluded.organization_id,
    store_id = excluded.store_id,
    target_stage = excluded.target_stage,
    evidence_type = excluded.evidence_type,
    evidence_message_id = excluded.evidence_message_id,
    evidence_summary = excluded.evidence_summary,
    source = excluded.source,
    actor_type = excluded.actor_type,
    actor_user_id = excluded.actor_user_id;

  select *
  into v_result
  from public.apply_commercial_opportunity_stage_transition_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_idempotency_key,
    'negociacao',
    v_reason_details,
    v_evidence_type,
    p_evidence_message_id,
    v_evidence_summary,
    v_source,
    'stage_transition',
    v_actor_type,
    p_actor_user_id
  );

  if v_result.commercial_opportunity_id is distinct from v_opportunity.id
     or v_result.stage is distinct from 'negociacao'
     or v_result.lifecycle_cycle is distinct from p_expected_lifecycle_cycle
     or v_result.lifecycle_event_id is null
     or v_result.event_type is distinct from 'stage_transition'
     or v_result.reason_code not in (
       'concrete_offer_required',
       'concrete_quote_objection_required',
       'visit_viable_concrete_offer_required',
       'renegotiation_required'
     ) then
    raise exception using errcode = 'P0001', message = 'ZION_MATERIAL_NEGOTIATION_INTERNAL_CONTRACT_MISMATCH';
  end if;

  select lifecycle_event.*
  into v_event
  from public.commercial_opportunity_lifecycle_events lifecycle_event
  where lifecycle_event.id = v_result.lifecycle_event_id;

  if not found
     or v_event.organization_id is distinct from p_organization_id
     or v_event.store_id is distinct from p_store_id
     or v_event.commercial_opportunity_id is distinct from p_commercial_opportunity_id
     or v_event.lifecycle_cycle is distinct from p_expected_lifecycle_cycle
     or v_event.new_stage is distinct from 'negociacao'
     or v_event.evidence_type is distinct from v_evidence_type
     or v_event.evidence_message_id is distinct from p_evidence_message_id
     or v_event.evidence_summary is distinct from v_evidence_summary
     or v_event.actor_type is distinct from v_actor_type
     or v_event.actor_user_id is distinct from p_actor_user_id
     or v_event.source is distinct from v_source then
    raise exception using errcode = 'P0001', message = 'ZION_MATERIAL_NEGOTIATION_EVENT_CONTRACT_MISMATCH';
  end if;

  return query
  select v_result.commercial_opportunity_id, v_result.stage, v_result.lifecycle_cycle,
         v_result.lifecycle_event_id, v_result.event_type, v_result.reason_code,
         v_material_kind, v_result.stage_changed_at, v_result.updated_at;
end;
$function$;

create or replace function public.enter_commercial_opportunity_negotiation_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_expected_lifecycle_cycle integer,
  p_idempotency_key text,
  p_material_kind text,
  p_evidence_message_id uuid,
  p_evidence_summary text,
  p_reason_details text default null,
  p_source text default 'system_material_negotiation'
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  lifecycle_event_id uuid,
  event_type text,
  reason_code text,
  material_kind text,
  stage_changed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity material negotiation by system is not authorized';
  end if;

  return query
  select *
  from public.apply_material_commercial_negotiation_internal(
    p_organization_id, p_store_id, p_commercial_opportunity_id,
    p_expected_lifecycle_cycle, p_idempotency_key, p_material_kind,
    p_evidence_message_id, p_evidence_summary, p_reason_details, p_source,
    'system', null
  );
end;
$function$;

create or replace function public.enter_commercial_opportunity_negotiation_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_expected_lifecycle_cycle integer,
  p_idempotency_key text,
  p_material_kind text,
  p_evidence_message_id uuid,
  p_evidence_summary text,
  p_reason_details text default null,
  p_source text default 'manual_material_negotiation'
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  lifecycle_event_id uuid,
  event_type text,
  reason_code text,
  material_kind text,
  stage_changed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity material negotiation by user is not authorized';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity material negotiation by user is not authorized';
  end if;

  return query
  select *
  from public.apply_material_commercial_negotiation_internal(
    p_request_organization_id, p_store_id, p_commercial_opportunity_id,
    p_expected_lifecycle_cycle, p_idempotency_key, p_material_kind,
    p_evidence_message_id, p_evidence_summary, p_reason_details, p_source,
    'human', v_user_id
  );
end;
$function$;

create or replace function public.transition_commercial_opportunity_stage_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_idempotency_key text,
  p_target_stage text,
  p_reason_details text default null,
  p_evidence_type text default null,
  p_evidence_message_id uuid default null,
  p_evidence_summary text default null,
  p_source text default 'system_stage_transition'
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  lifecycle_event_id uuid,
  event_type text,
  reason_code text,
  stage_changed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
  v_normalized_target text;
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity stage transition by system is not authorized';
  end if;

  v_normalized_target := public.normalize_commercial_opportunity_stage(p_target_stage);

  if v_normalized_target = 'negociacao' then
    raise exception using
      errcode = '23514',
      message = 'ZION_NEGOTIATION_SPECIALIZED_WRITER_REQUIRED';
  end if;

  return query
  select *
  from public.apply_commercial_opportunity_stage_transition_internal(
    p_organization_id, p_store_id, p_commercial_opportunity_id,
    p_idempotency_key, p_target_stage, p_reason_details, p_evidence_type,
    p_evidence_message_id, p_evidence_summary, p_source,
    'stage_transition', 'system', null
  );
end;
$function$;

create or replace function public.transition_commercial_opportunity_stage_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_idempotency_key text,
  p_target_stage text,
  p_reason_details text default null,
  p_evidence_type text default null,
  p_evidence_message_id uuid default null,
  p_evidence_summary text default null,
  p_source text default 'manual_stage_transition'
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  lifecycle_event_id uuid,
  event_type text,
  reason_code text,
  stage_changed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  v_normalized_target text;
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity stage transition by user is not authorized';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity stage transition by user is not authorized';
  end if;

  v_normalized_target := public.normalize_commercial_opportunity_stage(p_target_stage);

  if v_normalized_target = 'negociacao' then
    raise exception using
      errcode = '23514',
      message = 'ZION_NEGOTIATION_SPECIALIZED_WRITER_REQUIRED';
  end if;

  return query
  select *
  from public.apply_commercial_opportunity_stage_transition_internal(
    p_request_organization_id, p_store_id, p_commercial_opportunity_id,
    p_idempotency_key, p_target_stage, p_reason_details, p_evidence_type,
    p_evidence_message_id, p_evidence_summary, p_source,
    'stage_transition', 'human', v_user_id
  );
end;
$function$;

alter function public.apply_material_commercial_negotiation_internal(
  uuid, uuid, uuid, integer, text, text, uuid, text, text, text, text, uuid
) owner to postgres;

alter function public.enter_commercial_opportunity_negotiation_by_system(
  uuid, uuid, uuid, integer, text, text, uuid, text, text, text
) owner to postgres;

alter function public.enter_commercial_opportunity_negotiation_by_user(
  uuid, uuid, uuid, integer, text, text, uuid, text, text, text
) owner to postgres;

revoke all on function public.apply_material_commercial_negotiation_internal(
  uuid, uuid, uuid, integer, text, text, uuid, text, text, text, text, uuid
) from public, anon, authenticated, service_role;

revoke all on function public.enter_commercial_opportunity_negotiation_by_system(
  uuid, uuid, uuid, integer, text, text, uuid, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.enter_commercial_opportunity_negotiation_by_system(
  uuid, uuid, uuid, integer, text, text, uuid, text, text, text
) to service_role;

revoke all on function public.enter_commercial_opportunity_negotiation_by_user(
  uuid, uuid, uuid, integer, text, text, uuid, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.enter_commercial_opportunity_negotiation_by_user(
  uuid, uuid, uuid, integer, text, text, uuid, text, text, text
) to authenticated;

revoke all on function public.transition_commercial_opportunity_stage_by_system(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.transition_commercial_opportunity_stage_by_system(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) to service_role;

revoke all on function public.transition_commercial_opportunity_stage_by_user(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.transition_commercial_opportunity_stage_by_user(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) to authenticated;

revoke all on function public.apply_commercial_opportunity_stage_transition_internal(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text, text, text, uuid
) from public, anon, authenticated, service_role;

comment on function public.enter_commercial_opportunity_negotiation_by_system(
  uuid, uuid, uuid, integer, text, text, uuid, text, text, text
) is
  'P9 8.1 system authority: enters negociacao only from structured material commercial negotiation evidence tied to the current opportunity lifecycle and an inbound canonical message.';

comment on function public.enter_commercial_opportunity_negotiation_by_user(
  uuid, uuid, uuid, integer, text, text, uuid, text, text, text
) is
  'P9 8.1 human authority: enters negociacao only from structured material commercial negotiation evidence; offline evidence is allowed without inventing a message.';

do $postconditions$
declare
  v_transition record;
  v_proc oid;
  v_definition text;
begin
  if pg_catalog.to_regclass('public.commercial_opportunity_stage_transition_authority') is null then
    raise exception using errcode = 'P0001', message = 'P9_8_1_POSTCONDITION_AUTHORITY_TABLE_MISSING';
  end if;

  select *
  into v_transition
  from public.resolve_commercial_opportunity_stage_transition('qualificacao', 'negociacao');
  if v_transition.decision <> 'forbidden'
     or v_transition.is_permitted
     or v_transition.requires_specialized_writer
     or v_transition.reason_code <> 'negotiation_requires_quote_stage' then
    raise exception using errcode = 'P0001', message = 'P9_8_1_POSTCONDITION_QUALIFICATION_NEGOTIATION_MISMATCH';
  end if;

  select *
  into v_transition
  from public.resolve_commercial_opportunity_stage_transition('orcamento', 'negociacao');
  if v_transition.decision <> 'conditional'
     or v_transition.is_permitted
     or not v_transition.requires_specialized_writer
     or v_transition.reason_code <> 'concrete_quote_objection_required' then
    raise exception using errcode = 'P0001', message = 'P9_8_1_POSTCONDITION_QUOTE_NEGOTIATION_MISMATCH';
  end if;

  select *
  into v_transition
  from public.resolve_commercial_opportunity_stage_transition('visita_tecnica', 'negociacao');
  if v_transition.decision <> 'conditional'
     or v_transition.is_permitted
     or not v_transition.requires_specialized_writer
     or v_transition.reason_code <> 'visit_viable_concrete_offer_required' then
    raise exception using errcode = 'P0001', message = 'P9_8_1_POSTCONDITION_VISIT_NEGOTIATION_MISMATCH';
  end if;

  select *
  into v_transition
  from public.resolve_commercial_opportunity_stage_transition('fechamento_pagamento', 'negociacao');
  if v_transition.decision <> 'conditional'
     or v_transition.is_permitted
     or not v_transition.requires_specialized_writer
     or v_transition.reason_code <> 'renegotiation_required' then
    raise exception using errcode = 'P0001', message = 'P9_8_1_POSTCONDITION_CLOSING_NEGOTIATION_MISMATCH';
  end if;

  select *
  into v_transition
  from public.resolve_commercial_opportunity_stage_transition('perdido', 'negociacao');
  if v_transition.decision <> 'conditional'
     or not v_transition.requires_specialized_writer
     or v_transition.reason_code <> 'reopen_writer_required' then
    raise exception using errcode = 'P0001', message = 'P9_8_1_POSTCONDITION_REOPEN_CONTRACT_CHANGED';
  end if;

  v_proc := pg_catalog.to_regprocedure(
    'public.apply_commercial_opportunity_stage_transition_internal(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text,uuid)'
  );
  if v_proc is null
     or pg_catalog.has_function_privilege('anon', v_proc, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_proc, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_proc, 'EXECUTE') then
    raise exception using errcode = 'P0001', message = 'P9_8_1_POSTCONDITION_INTERNAL_STAGE_WRITER_ACL_MISMATCH';
  end if;

  select pg_catalog.pg_get_functiondef(v_proc) into v_definition;
  if v_definition not ilike '%commercial_opportunity_stage_transition_authority%'
     or v_definition not ilike '%txid_current%'
     or v_definition not ilike '%ZION_NEGOTIATION_SPECIALIZED_WRITER_REQUIRED%'
     or v_definition not ilike '%material_negotiation_discount_request%' then
    raise exception using errcode = 'P0001', message = 'P9_8_1_POSTCONDITION_INTERNAL_STAGE_WRITER_CONTRACT_MISMATCH';
  end if;

  v_proc := pg_catalog.to_regprocedure(
    'public.apply_material_commercial_negotiation_internal(uuid,uuid,uuid,integer,text,text,uuid,text,text,text,text,uuid)'
  );
  select pg_catalog.pg_get_functiondef(v_proc) into v_definition;
  if v_definition not ilike '%insert into public.commercial_opportunity_stage_transition_authority%'
     or v_definition not ilike '%apply_commercial_opportunity_stage_transition_internal%' then
    raise exception using errcode = 'P0001', message = 'P9_8_1_POSTCONDITION_SPECIALIZED_AUTHORITY_MARKER_MISSING';
  end if;

  v_proc := pg_catalog.to_regprocedure(
    'public.enter_commercial_opportunity_negotiation_by_system(uuid,uuid,uuid,integer,text,text,uuid,text,text,text)'
  );
  if v_proc is null
     or pg_catalog.has_function_privilege('anon', v_proc, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_proc, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_proc, 'EXECUTE') then
    raise exception using errcode = 'P0001', message = 'P9_8_1_POSTCONDITION_SYSTEM_WRITER_ACL_MISMATCH';
  end if;

  v_proc := pg_catalog.to_regprocedure(
    'public.enter_commercial_opportunity_negotiation_by_user(uuid,uuid,uuid,integer,text,text,uuid,text,text,text)'
  );
  if v_proc is null
     or pg_catalog.has_function_privilege('anon', v_proc, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_proc, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_proc, 'EXECUTE') then
    raise exception using errcode = 'P0001', message = 'P9_8_1_POSTCONDITION_USER_WRITER_ACL_MISMATCH';
  end if;

  v_proc := pg_catalog.to_regprocedure(
    'public.apply_material_commercial_negotiation_internal(uuid,uuid,uuid,integer,text,text,uuid,text,text,text,text,uuid)'
  );
  if v_proc is null
     or pg_catalog.has_function_privilege('anon', v_proc, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_proc, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_proc, 'EXECUTE') then
    raise exception using errcode = 'P0001', message = 'P9_8_1_POSTCONDITION_INTERNAL_NEGOTIATION_WRITER_ACL_MISMATCH';
  end if;

  v_proc := pg_catalog.to_regprocedure(
    'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)'
  );
  select pg_catalog.pg_get_functiondef(v_proc) into v_definition;
  if v_definition not ilike '%ZION_NEGOTIATION_SPECIALIZED_WRITER_REQUIRED%' then
    raise exception using errcode = 'P0001', message = 'P9_8_1_POSTCONDITION_GENERIC_SYSTEM_WRITER_NOT_BLOCKED';
  end if;

  v_proc := pg_catalog.to_regprocedure(
    'public.transition_commercial_opportunity_stage_by_user(uuid,uuid,uuid,text,text,text,text,uuid,text,text)'
  );
  select pg_catalog.pg_get_functiondef(v_proc) into v_definition;
  if v_definition not ilike '%ZION_NEGOTIATION_SPECIALIZED_WRITER_REQUIRED%' then
    raise exception using errcode = 'P0001', message = 'P9_8_1_POSTCONDITION_GENERIC_USER_WRITER_NOT_BLOCKED';
  end if;
end;
$postconditions$;
