begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '30s';
set local search_path = pg_catalog, pg_temp, public;

select pg_catalog.pg_advisory_xact_lock(20260810125500);

do $preflight$
begin
  if pg_catalog.to_regclass('public.commercial_opportunity_lifecycle_events') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.commercial_opportunity_lifecycle_events is required';
  end if;

  if pg_catalog.to_regclass('public.commercial_opportunities') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.commercial_opportunities is required';
  end if;

  if pg_catalog.to_regprocedure('public.resolve_commercial_opportunity_stage_transition(text,text)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.resolve_commercial_opportunity_stage_transition(text,text) is required';
  end if;

  if pg_catalog.to_regprocedure('public.compute_commercial_opportunity_event_fingerprint_internal(uuid,uuid,uuid,integer,text,text,text,text,uuid,text,text,text,text,uuid,text)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.compute_commercial_opportunity_event_fingerprint_internal(...) is required';
  end if;

  if pg_catalog.to_regprocedure('public.assert_commercial_opportunity_message_evidence(uuid,uuid,uuid,uuid,uuid)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.assert_commercial_opportunity_message_evidence(uuid,uuid,uuid,uuid,uuid) is required';
  end if;

  if pg_catalog.to_regprocedure('public.mark_commercial_opportunity_lost_by_user(uuid,uuid,uuid,text,text,text,uuid,text,text)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.mark_commercial_opportunity_lost_by_user(...) is required';
  end if;

  if pg_catalog.to_regprocedure('public.mark_commercial_opportunity_lost_by_system(uuid,uuid,uuid,text,text,uuid,text,text,text)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.mark_commercial_opportunity_lost_by_system(...) is required';
  end if;

  if pg_catalog.to_regprocedure('public.reopen_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text,text)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.reopen_commercial_opportunity_by_user(...) is required';
  end if;

  if pg_catalog.to_regprocedure('public.enforce_commercial_opportunity_loss_stage_transition()') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.enforce_commercial_opportunity_loss_stage_transition() is required';
  end if;
end;
$preflight$;

alter table public.commercial_opportunity_lifecycle_events
  drop constraint commercial_opportunity_lifecycle_events_event_type_check,
  drop constraint commercial_opportunity_lifecycle_events_reason_code_check,
  drop constraint commercial_opportunity_lifecycle_events_marked_lost_shape_check,
  drop constraint commercial_opportunity_lifecycle_events_reopened_shape_check;

alter table public.commercial_opportunity_lifecycle_events
  add constraint commercial_opportunity_lifecycle_events_event_type_check
    check (
      event_type in (
        'follow_up_exhausted',
        'loss_review_requested',
        'loss_review_approved',
        'loss_review_rejected',
        'marked_lost',
        'reopened',
        'stage_transition',
        'conclusion',
        'post_sale_reopen'
      )
    ),
  add constraint commercial_opportunity_lifecycle_events_reason_code_check
    check (
      reason_code is null
      or reason_code in (
        'explicit_refusal',
        'bought_from_competitor',
        'confirmed_out_of_service_area',
        'confirmed_technical_infeasibility',
        'contact_opt_out',
        'other',
        'commercial_interest_required',
        'explicit_quote_intent_required',
        'visit_eligibility_required',
        'concrete_offer_required',
        'visit_required_or_eligible',
        'concrete_quote_objection_required',
        'accepted_current_quote_required',
        'visit_result_missing_commercial_choices',
        'visit_viable_quote_ready',
        'visit_viable_concrete_offer_required',
        'mandatory_visit_pending',
        'quote_revision_required',
        'accepted_negotiated_condition_required',
        'quote_gate_revalidation_required',
        'renegotiation_required',
        'execution_release_gates_required',
        'simple_sale_completion_required',
        'execution_completed_without_pending',
        'conclusion_writer_required',
        'post_sale_reopen_writer_required'
      )
    ),
  add constraint commercial_opportunity_lifecycle_events_marked_lost_shape_check
    check (
      event_type <> 'marked_lost'
      or (
        reason_code is not null
        and previous_stage is not null
        and previous_stage <> 'perdido'
        and new_stage = 'perdido'
        and (
          reason_code <> 'other'
          or (
            reason_details is not null
            and pg_catalog.length(pg_catalog.btrim(reason_details)) > 0
          )
        )
      )
    ),
  add constraint commercial_opportunity_lifecycle_events_reopened_shape_check
    check (
      event_type <> 'reopened'
      or (
        previous_stage = 'perdido'
        and new_stage in (
          'novo_lead',
          'qualificacao',
          'orcamento',
          'visita_tecnica',
          'negociacao',
          'fechamento_pagamento',
          'instalacao_entrega',
          'pos_venda'
        )
        and new_stage <> 'perdido'
        and reason_details is not null
        and pg_catalog.length(pg_catalog.btrim(reason_details)) > 0
      )
    ),
  add constraint commercial_opportunity_lifecycle_events_stage_transition_shape_check
    check (
      event_type <> 'stage_transition'
      or (
        previous_stage is not null
        and new_stage is not null
        and previous_stage <> new_stage
        and new_stage <> 'perdido'
        and new_stage <> 'concluido_sem_mais_acoes'
        and reason_code is not null
        and evidence_type is not null
        and pg_catalog.length(pg_catalog.btrim(evidence_type)) > 0
        and evidence_summary is not null
        and pg_catalog.length(pg_catalog.btrim(evidence_summary)) > 0
      )
    ),
  add constraint commercial_opportunity_lifecycle_events_conclusion_shape_check
    check (
      event_type <> 'conclusion'
      or (
        previous_stage is not null
        and new_stage = 'concluido_sem_mais_acoes'
        and reason_code = 'conclusion_writer_required'
        and evidence_type is not null
        and pg_catalog.length(pg_catalog.btrim(evidence_type)) > 0
        and evidence_summary is not null
        and pg_catalog.length(pg_catalog.btrim(evidence_summary)) > 0
      )
    ),
  add constraint commercial_opportunity_lifecycle_events_post_sale_reopen_shape_check
    check (
      event_type <> 'post_sale_reopen'
      or (
        previous_stage = 'concluido_sem_mais_acoes'
        and new_stage = 'pos_venda'
        and reason_code = 'post_sale_reopen_writer_required'
        and evidence_type is not null
        and pg_catalog.length(pg_catalog.btrim(evidence_type)) > 0
        and evidence_summary is not null
        and pg_catalog.length(pg_catalog.btrim(evidence_summary)) > 0
      )
    );

create or replace function public.enforce_commercial_opportunity_loss_stage_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_transition_event public.commercial_opportunity_lifecycle_events;
  v_current_tx bigint := pg_catalog.txid_current();
  v_transition_count integer;
  v_expected_event_type text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.stage is not distinct from old.stage then
    if old.stage = 'perdido'
       and (
         new.current_loss_event_id is distinct from old.current_loss_event_id
         or new.lost_at is distinct from old.lost_at
         or new.lost_reason_code is distinct from old.lost_reason_code
         or new.lost_reason_details is distinct from old.lost_reason_details
         or new.lifecycle_cycle is distinct from old.lifecycle_cycle
         or new.last_reopened_at is distinct from old.last_reopened_at
       ) then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_DIRECT_LOSS_STAGE_TRANSITION_FORBIDDEN';
    end if;

    if old.stage <> 'perdido'
       and (
         new.lifecycle_cycle is distinct from old.lifecycle_cycle
         or new.lost_at is distinct from old.lost_at
         or new.lost_reason_code is distinct from old.lost_reason_code
         or new.lost_reason_details is distinct from old.lost_reason_details
         or new.current_loss_event_id is distinct from old.current_loss_event_id
         or new.last_reopened_at is distinct from old.last_reopened_at
       ) then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_DIRECT_STAGE_TRANSITION_FORBIDDEN';
    end if;

    return new;
  end if;

  if old.stage <> 'perdido'
     and new.stage = 'perdido' then
    if new.current_loss_event_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_DIRECT_LOSS_STAGE_TRANSITION_FORBIDDEN';
    end if;

    select lifecycle_event.*
    into v_transition_event
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.id = new.current_loss_event_id
      and lifecycle_event.transaction_id = v_current_tx
      and lifecycle_event.organization_id = old.organization_id
      and lifecycle_event.store_id = old.store_id
      and lifecycle_event.commercial_opportunity_id = old.id
      and lifecycle_event.customer_id = old.customer_id
      and lifecycle_event.lifecycle_cycle = old.lifecycle_cycle
      and lifecycle_event.event_type = 'marked_lost'
      and lifecycle_event.previous_stage is not distinct from old.stage
      and lifecycle_event.new_stage = 'perdido'
    limit 1;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_DIRECT_LOSS_STAGE_TRANSITION_FORBIDDEN';
    end if;

    select count(*)
    into v_transition_count
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.transaction_id = v_current_tx
      and lifecycle_event.organization_id = old.organization_id
      and lifecycle_event.store_id = old.store_id
      and lifecycle_event.commercial_opportunity_id = old.id
      and lifecycle_event.customer_id = old.customer_id
      and lifecycle_event.lifecycle_cycle = old.lifecycle_cycle
      and lifecycle_event.event_type = 'marked_lost';

    if v_transition_count <> 1 then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_LOSS_TRANSITION_EVENT_AMBIGUOUS';
    end if;

    if new.current_loss_event_id is distinct from v_transition_event.id
       or new.lost_at is distinct from v_transition_event.created_at
       or new.lost_reason_code is distinct from v_transition_event.reason_code
       or new.lost_reason_details is distinct from v_transition_event.reason_details
       or new.lifecycle_cycle is distinct from old.lifecycle_cycle
       or new.last_reopened_at is distinct from old.last_reopened_at then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_LOSS_PROJECTION_EVENT_MISMATCH';
    end if;

    return new;
  end if;

  if old.stage = 'perdido'
     and new.stage <> 'perdido' then
    select lifecycle_event.*
    into v_transition_event
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.transaction_id = v_current_tx
      and lifecycle_event.organization_id = old.organization_id
      and lifecycle_event.store_id = old.store_id
      and lifecycle_event.commercial_opportunity_id = old.id
      and lifecycle_event.customer_id = old.customer_id
      and lifecycle_event.lifecycle_cycle = old.lifecycle_cycle
      and lifecycle_event.event_type = 'reopened'
      and lifecycle_event.previous_stage = 'perdido'
      and lifecycle_event.new_stage = new.stage
    order by lifecycle_event.created_at desc
    limit 1;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_DIRECT_REOPEN_TRANSITION_FORBIDDEN';
    end if;

    select count(*)
    into v_transition_count
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.transaction_id = v_current_tx
      and lifecycle_event.organization_id = old.organization_id
      and lifecycle_event.store_id = old.store_id
      and lifecycle_event.commercial_opportunity_id = old.id
      and lifecycle_event.customer_id = old.customer_id
      and lifecycle_event.lifecycle_cycle = old.lifecycle_cycle
      and lifecycle_event.event_type = 'reopened';

    if v_transition_count <> 1 then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_REOPEN_TRANSITION_EVENT_AMBIGUOUS';
    end if;

    if new.lifecycle_cycle <> old.lifecycle_cycle + 1
       or new.current_loss_event_id is not null
       or new.lost_at is not null
       or new.lost_reason_code is not null
       or new.lost_reason_details is not null
       or new.last_reopened_at is distinct from v_transition_event.created_at then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_REOPEN_PROJECTION_EVENT_MISMATCH';
    end if;

    return new;
  end if;

  v_expected_event_type := case
    when new.stage = 'concluido_sem_mais_acoes' then 'conclusion'
    when old.stage = 'concluido_sem_mais_acoes' and new.stage = 'pos_venda' then 'post_sale_reopen'
    else 'stage_transition'
  end;

  select lifecycle_event.*
  into v_transition_event
  from public.commercial_opportunity_lifecycle_events lifecycle_event
  where lifecycle_event.transaction_id = v_current_tx
    and lifecycle_event.organization_id = old.organization_id
    and lifecycle_event.store_id = old.store_id
    and lifecycle_event.commercial_opportunity_id = old.id
    and lifecycle_event.customer_id = old.customer_id
    and lifecycle_event.lifecycle_cycle = old.lifecycle_cycle
    and lifecycle_event.event_type = v_expected_event_type
    and lifecycle_event.previous_stage = old.stage
    and lifecycle_event.new_stage = new.stage
  order by lifecycle_event.created_at desc
  limit 1;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_DIRECT_STAGE_TRANSITION_FORBIDDEN';
  end if;

  select count(*)
  into v_transition_count
  from public.commercial_opportunity_lifecycle_events lifecycle_event
  where lifecycle_event.transaction_id = v_current_tx
    and lifecycle_event.organization_id = old.organization_id
    and lifecycle_event.store_id = old.store_id
    and lifecycle_event.commercial_opportunity_id = old.id
    and lifecycle_event.customer_id = old.customer_id
    and lifecycle_event.lifecycle_cycle = old.lifecycle_cycle
    and lifecycle_event.event_type = v_expected_event_type
    and lifecycle_event.previous_stage = old.stage
    and lifecycle_event.new_stage = new.stage;

  if v_transition_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = case
        when v_expected_event_type = 'conclusion' then 'ZION_CONCLUSION_TRANSITION_EVENT_AMBIGUOUS'
        when v_expected_event_type = 'post_sale_reopen' then 'ZION_POST_SALE_REOPEN_EVENT_AMBIGUOUS'
        else 'ZION_STAGE_TRANSITION_EVENT_AMBIGUOUS'
      end;
  end if;

  if new.lifecycle_cycle is distinct from old.lifecycle_cycle
     or new.current_loss_event_id is distinct from old.current_loss_event_id
     or new.lost_at is distinct from old.lost_at
     or new.lost_reason_code is distinct from old.lost_reason_code
     or new.lost_reason_details is distinct from old.lost_reason_details
     or new.last_reopened_at is distinct from old.last_reopened_at then
    raise exception using
      errcode = 'P0001',
      message = case
        when v_expected_event_type = 'conclusion' then 'ZION_CONCLUSION_PROJECTION_EVENT_MISMATCH'
        when v_expected_event_type = 'post_sale_reopen' then 'ZION_POST_SALE_REOPEN_PROJECTION_EVENT_MISMATCH'
        else 'ZION_STAGE_PROJECTION_EVENT_MISMATCH'
      end;
  end if;

  return new;
end;
$function$;

alter function public.enforce_commercial_opportunity_loss_stage_transition()
  owner to postgres;

comment on function public.enforce_commercial_opportunity_loss_stage_transition() is
  'Bloqueia mudancas diretas de stage em commercial_opportunities e exige evento canonico append-only na mesma transacao para perda, reabertura, transicao normal, conclusao e reabertura de pos-venda.';

revoke all on function public.enforce_commercial_opportunity_loss_stage_transition()
  from public, anon, authenticated, service_role;

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
    raise exception using
      errcode = '22023',
      message = 'ZION_STAGE_TRANSITION_ARGUMENTS_REQUIRED';
  end if;

  if p_expected_event_type not in ('stage_transition', 'conclusion', 'post_sale_reopen') then
    raise exception using
      errcode = '22023',
      message = 'ZION_STAGE_TRANSITION_EVENT_TYPE_INVALID';
  end if;

  if v_actor_type not in ('human', 'system') then
    raise exception using
      errcode = '22023',
      message = 'ZION_STAGE_TRANSITION_ACTOR_INVALID';
  end if;

  if (v_actor_type = 'human' and p_actor_user_id is null)
     or (v_actor_type <> 'human' and p_actor_user_id is not null) then
    raise exception using
      errcode = '22023',
      message = 'ZION_STAGE_TRANSITION_ACTOR_MISMATCH';
  end if;

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

  select lifecycle_event.*
  into v_existing_event
  from public.commercial_opportunity_lifecycle_events lifecycle_event
  where lifecycle_event.organization_id = v_opportunity.organization_id
    and lifecycle_event.store_id = v_opportunity.store_id
    and lifecycle_event.commercial_opportunity_id = v_opportunity.id
    and lifecycle_event.idempotency_key = v_idempotency_key
  limit 1;

  if v_existing_event.id is not null then
    if v_existing_event.event_type <> p_expected_event_type then
      raise exception using
        errcode = '23505',
        message = 'ZION_IDEMPOTENCY_KEY_REUSED';
    end if;

    if v_existing_event.new_stage is distinct from v_target_stage then
      raise exception using
        errcode = '23505',
        message = 'ZION_IDEMPOTENCY_KEY_REUSED';
    end if;

    if v_opportunity.stage is distinct from v_existing_event.new_stage
       or v_opportunity.lifecycle_cycle is distinct from v_existing_event.lifecycle_cycle then
      raise exception using
        errcode = '23514',
        message = 'ZION_IDEMPOTENT_STAGE_TRANSITION_OBSOLETE';
    end if;

    select *
    into v_transition_row
    from public.resolve_commercial_opportunity_stage_transition(
      v_existing_event.previous_stage,
      v_existing_event.new_stage
    );

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_STAGE_TRANSITION_MATRIX_UNAVAILABLE';
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
      raise exception using
        errcode = '23505',
        message = 'ZION_IDEMPOTENCY_KEY_REUSED';
    end if;

    return query
    select
      opportunity_row.id,
      opportunity_row.stage,
      opportunity_row.lifecycle_cycle,
      v_existing_event.id,
      v_existing_event.event_type,
      v_existing_event.reason_code,
      opportunity_row.stage_changed_at,
      opportunity_row.updated_at
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = v_opportunity.id;
    return;
  end if;

  select *
  into v_transition_row
  from public.resolve_commercial_opportunity_stage_transition(
    v_opportunity.stage,
    v_target_stage
  );

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_STAGE_TRANSITION_MATRIX_UNAVAILABLE';
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
       or v_transition_row.requires_specialized_writer
       or v_transition_row.to_stage in ('perdido', 'concluido_sem_mais_acoes') then
      raise exception using
        errcode = '23514',
        message = 'ZION_SPECIALIZED_STAGE_WRITER_REQUIRED',
        detail = coalesce(v_transition_row.reason_code, 'specialized_writer_required');
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
      organization_id,
      store_id,
      commercial_opportunity_id,
      customer_id,
      lifecycle_cycle,
      event_type,
      previous_stage,
      new_stage,
      reason_code,
      reason_details,
      evidence_type,
      evidence_message_id,
      evidence_summary,
      actor_type,
      actor_user_id,
      source,
      metadata,
      idempotency_key,
      event_key
    )
    values (
      v_opportunity.organization_id,
      v_opportunity.store_id,
      v_opportunity.id,
      v_opportunity.customer_id,
      v_opportunity.lifecycle_cycle,
      p_expected_event_type,
      v_opportunity.stage,
      v_transition_row.to_stage,
      v_transition_row.reason_code,
      v_reason_details,
      v_evidence_type,
      p_evidence_message_id,
      v_evidence_summary,
      v_actor_type,
      p_actor_user_id,
      v_source,
      pg_catalog.jsonb_build_object(
        'request_organization_id', p_organization_id,
        'requested_store_id', p_store_id
      ),
      v_idempotency_key,
      v_event_key
    )
    returning *
    into v_transition_event;
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
          if v_existing_event.event_type <> p_expected_event_type then
            raise exception using
              errcode = '23505',
              message = 'ZION_IDEMPOTENCY_KEY_REUSED';
          end if;

          if v_existing_event.new_stage is distinct from v_target_stage then
            raise exception using
              errcode = '23505',
              message = 'ZION_IDEMPOTENCY_KEY_REUSED';
          end if;

          if v_opportunity.stage is distinct from v_existing_event.new_stage
             or v_opportunity.lifecycle_cycle is distinct from v_existing_event.lifecycle_cycle then
            raise exception using
              errcode = '23514',
              message = 'ZION_IDEMPOTENT_STAGE_TRANSITION_OBSOLETE';
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
            raise exception using
              errcode = '23505',
              message = 'ZION_IDEMPOTENCY_KEY_REUSED';
          end if;

          return query
          select
            opportunity_row.id,
            opportunity_row.stage,
            opportunity_row.lifecycle_cycle,
            v_existing_event.id,
            v_existing_event.event_type,
            v_existing_event.reason_code,
            opportunity_row.stage_changed_at,
            opportunity_row.updated_at
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
  select
    opportunity_row.id,
    opportunity_row.stage,
    opportunity_row.lifecycle_cycle,
    v_transition_event.id,
    v_transition_event.event_type,
    v_transition_event.reason_code,
    opportunity_row.stage_changed_at,
    opportunity_row.updated_at
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = v_opportunity.id;
end;
$function$;

alter function public.apply_commercial_opportunity_stage_transition_internal(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  uuid
)
  owner to postgres;

comment on function public.apply_commercial_opportunity_stage_transition_internal(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  uuid
) is
  'Implementa o writer canonico interno de transicao comercial com FOR UPDATE, matriz 2.2, auditoria append-only e replay idempotente deterministico.';

revoke all on function public.apply_commercial_opportunity_stage_transition_internal(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  uuid
)
  from public, anon, authenticated, service_role;

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

  return query
  select *
  from public.apply_commercial_opportunity_stage_transition_internal(
    p_request_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_idempotency_key,
    p_target_stage,
    p_reason_details,
    p_evidence_type,
    p_evidence_message_id,
    p_evidence_summary,
    p_source,
    'stage_transition',
    'human',
    v_user_id
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
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity stage transition by system is not authorized';
  end if;

  return query
  select *
  from public.apply_commercial_opportunity_stage_transition_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_idempotency_key,
    p_target_stage,
    p_reason_details,
    p_evidence_type,
    p_evidence_message_id,
    p_evidence_summary,
    p_source,
    'stage_transition',
    'system',
    null
  );
end;
$function$;

create or replace function public.conclude_commercial_opportunity_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_idempotency_key text,
  p_reason_details text default null,
  p_evidence_type text default null,
  p_evidence_message_id uuid default null,
  p_evidence_summary text default null,
  p_source text default 'manual_conclusion'
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
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity conclusion by user is not authorized';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity conclusion by user is not authorized';
  end if;

  return query
  select *
  from public.apply_commercial_opportunity_stage_transition_internal(
    p_request_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_idempotency_key,
    'concluido_sem_mais_acoes',
    p_reason_details,
    p_evidence_type,
    p_evidence_message_id,
    p_evidence_summary,
    p_source,
    'conclusion',
    'human',
    v_user_id
  );
end;
$function$;

create or replace function public.conclude_commercial_opportunity_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_idempotency_key text,
  p_reason_details text default null,
  p_evidence_type text default null,
  p_evidence_message_id uuid default null,
  p_evidence_summary text default null,
  p_source text default 'system_conclusion'
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
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity conclusion by system is not authorized';
  end if;

  return query
  select *
  from public.apply_commercial_opportunity_stage_transition_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_idempotency_key,
    'concluido_sem_mais_acoes',
    p_reason_details,
    p_evidence_type,
    p_evidence_message_id,
    p_evidence_summary,
    p_source,
    'conclusion',
    'system',
    null
  );
end;
$function$;

create or replace function public.reopen_commercial_opportunity_for_post_sale_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_idempotency_key text,
  p_reason_details text default null,
  p_evidence_type text default null,
  p_evidence_message_id uuid default null,
  p_evidence_summary text default null,
  p_source text default 'manual_post_sale_reopen'
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
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity post-sale reopen by user is not authorized';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity post-sale reopen by user is not authorized';
  end if;

  return query
  select *
  from public.apply_commercial_opportunity_stage_transition_internal(
    p_request_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_idempotency_key,
    'pos_venda',
    p_reason_details,
    p_evidence_type,
    p_evidence_message_id,
    p_evidence_summary,
    p_source,
    'post_sale_reopen',
    'human',
    v_user_id
  );
end;
$function$;

create or replace function public.reopen_commercial_opportunity_for_post_sale_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_idempotency_key text,
  p_reason_details text default null,
  p_evidence_type text default null,
  p_evidence_message_id uuid default null,
  p_evidence_summary text default null,
  p_source text default 'system_post_sale_reopen'
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
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity post-sale reopen by system is not authorized';
  end if;

  return query
  select *
  from public.apply_commercial_opportunity_stage_transition_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_idempotency_key,
    'pos_venda',
    p_reason_details,
    p_evidence_type,
    p_evidence_message_id,
    p_evidence_summary,
    p_source,
    'post_sale_reopen',
    'system',
    null
  );
end;
$function$;

alter function public.transition_commercial_opportunity_stage_by_user(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) owner to postgres;
alter function public.transition_commercial_opportunity_stage_by_system(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) owner to postgres;
alter function public.conclude_commercial_opportunity_by_user(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) owner to postgres;
alter function public.conclude_commercial_opportunity_by_system(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) owner to postgres;
alter function public.reopen_commercial_opportunity_for_post_sale_by_user(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) owner to postgres;
alter function public.reopen_commercial_opportunity_for_post_sale_by_system(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) owner to postgres;

comment on function public.transition_commercial_opportunity_stage_by_user(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) is
  'Writer canonico autenticado para transicoes normais entre estagios comerciais, sempre mediado pela matriz 2.2.';
comment on function public.transition_commercial_opportunity_stage_by_system(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) is
  'Writer canonico de sistema para transicoes normais entre estagios comerciais, sempre mediado pela matriz 2.2.';
comment on function public.conclude_commercial_opportunity_by_user(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) is
  'Writer canonico autenticado para concluir oportunidade comercial em concluido_sem_mais_acoes com auditoria append-only.';
comment on function public.conclude_commercial_opportunity_by_system(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) is
  'Writer canonico de sistema para concluir oportunidade comercial em concluido_sem_mais_acoes com auditoria append-only.';
comment on function public.reopen_commercial_opportunity_for_post_sale_by_user(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) is
  'Writer canonico autenticado para reabrir oportunidade concluida exclusivamente em pos_venda.';
comment on function public.reopen_commercial_opportunity_for_post_sale_by_system(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) is
  'Writer canonico de sistema para reabrir oportunidade concluida exclusivamente em pos_venda.';

revoke all on function public.transition_commercial_opportunity_stage_by_user(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.transition_commercial_opportunity_stage_by_system(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.conclude_commercial_opportunity_by_user(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.conclude_commercial_opportunity_by_system(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.reopen_commercial_opportunity_for_post_sale_by_user(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.reopen_commercial_opportunity_for_post_sale_by_system(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.transition_commercial_opportunity_stage_by_user(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) to authenticated;
grant execute on function public.transition_commercial_opportunity_stage_by_system(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) to service_role;
grant execute on function public.conclude_commercial_opportunity_by_user(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) to authenticated;
grant execute on function public.conclude_commercial_opportunity_by_system(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) to service_role;
grant execute on function public.reopen_commercial_opportunity_for_post_sale_by_user(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) to authenticated;
grant execute on function public.reopen_commercial_opportunity_for_post_sale_by_system(
  uuid, uuid, uuid, text, text, text, uuid, text, text
) to service_role;

do $postconditions$
declare
  v_proc_oid oid;
  v_definition text;
  v_expected_functions text[] := array[
    'public.transition_commercial_opportunity_stage_by_user(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
    'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
    'public.conclude_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text,uuid,text,text)',
    'public.conclude_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
    'public.reopen_commercial_opportunity_for_post_sale_by_user(uuid,uuid,uuid,text,text,text,uuid,text,text)',
    'public.reopen_commercial_opportunity_for_post_sale_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)'
  ];
  v_signature text;
begin
  foreach v_signature in array v_expected_functions loop
    v_proc_oid := pg_catalog.to_regprocedure(v_signature);
    if v_proc_oid is null then
      raise exception using
        errcode = 'P0001',
        message = 'postcondition failed: expected writer function is missing',
        detail = v_signature;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_proc proc_row
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = proc_row.pronamespace
      join pg_catalog.pg_roles role_row
        on role_row.oid = proc_row.proowner
      where proc_row.oid = v_proc_oid
        and namespace_row.nspname = 'public'
        and role_row.rolname = 'postgres'
        and proc_row.prosecdef
        and proc_row.provolatile = 'v'
        and exists (
          select 1
          from pg_catalog.unnest(coalesce(proc_row.proconfig, array[]::text[])) config_row
          where config_row = 'search_path=pg_catalog, pg_temp, public'
        )
        and exists (
          select 1
          from pg_catalog.unnest(coalesce(proc_row.proconfig, array[]::text[])) config_row
          where config_row = 'row_security=off'
        )
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'postcondition failed: writer function metadata mismatch',
        detail = v_signature;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_proc proc_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(proc_row.proacl, pg_catalog.acldefault('f', proc_row.proowner))
      ) acl_row
      where proc_row.oid = v_proc_oid
        and acl_row.grantee = 0
        and acl_row.privilege_type = 'EXECUTE'
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'postcondition failed: writer function exposes EXECUTE to PUBLIC',
        detail = v_signature;
    end if;
  end loop;

  if has_function_privilege(
       'authenticated',
       'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: transition_commercial_opportunity_stage_by_system grants mismatch';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.transition_commercial_opportunity_stage_by_user(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.transition_commercial_opportunity_stage_by_user(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: transition_commercial_opportunity_stage_by_user grants mismatch';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.conclude_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text,uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.conclude_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text,uuid,text,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: conclude_commercial_opportunity_by_user grants mismatch';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.conclude_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.conclude_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: conclude_commercial_opportunity_by_system grants mismatch';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.reopen_commercial_opportunity_for_post_sale_by_user(uuid,uuid,uuid,text,text,text,uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.reopen_commercial_opportunity_for_post_sale_by_user(uuid,uuid,uuid,text,text,text,uuid,text,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: reopen_commercial_opportunity_for_post_sale_by_user grants mismatch';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.reopen_commercial_opportunity_for_post_sale_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.reopen_commercial_opportunity_for_post_sale_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: reopen_commercial_opportunity_for_post_sale_by_system grants mismatch';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.apply_commercial_opportunity_stage_transition_internal(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.apply_commercial_opportunity_stage_transition_internal(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text,uuid)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: internal stage transition function must not be publicly executable';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname = 'commercial_opportunity_lifecycle_events_stage_transition_shape_check'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: stage_transition shape check is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname = 'commercial_opportunity_lifecycle_events_conclusion_shape_check'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: conclusion shape check is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname = 'commercial_opportunity_lifecycle_events_post_sale_reopen_shape_check'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: post_sale_reopen shape check is missing';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.enforce_commercial_opportunity_loss_stage_transition()')
  );
  if v_definition not ilike '%post_sale_reopen%'
     or v_definition not ilike '%conclusion%'
     or v_definition not ilike '%stage_transition%'
     or v_definition not ilike '%ZION_STAGE_PROJECTION_EVENT_MISMATCH%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: stage transition trigger extension mismatch';
  end if;
end;
$postconditions$;

commit;
