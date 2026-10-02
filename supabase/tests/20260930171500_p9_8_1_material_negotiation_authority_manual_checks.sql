-- P9 8.1 local contract checks.
-- These checks are intentionally source/catalog based; they do not apply SQL
-- remotely and do not mutate production or DEV data.

do $checks$
declare
  v_definition text;
  v_transition record;
begin
  select pg_catalog.pg_get_functiondef(
    'public.transition_commercial_opportunity_stage_by_user(uuid,uuid,uuid,text,text,text,text,uuid,text,text)'::regprocedure
  ) into v_definition;
  if lower(v_definition) not like '%v_normalized_target = ''negociacao''%'
     or v_definition not like '%ZION_NEGOTIATION_SPECIALIZED_WRITER_REQUIRED%' then
    raise exception using message = 'P9_8_1 generic user negotiation guard missing';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)'::regprocedure
  ) into v_definition;
  if lower(v_definition) not like '%v_normalized_target = ''negociacao''%'
     or v_definition not like '%ZION_NEGOTIATION_SPECIALIZED_WRITER_REQUIRED%' then
    raise exception using message = 'P9_8_1 generic system negotiation guard missing';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.apply_commercial_opportunity_stage_transition_internal(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text,uuid)'::regprocedure
  ) into v_definition;
  if lower(v_definition) not like '%commercial_opportunity_stage_transition_authority%'
     or lower(v_definition) not like '%txid_current%'
     or lower(v_definition) not like '%v_transition_row.requires_specialized_writer%'
     or lower(v_definition) not like '%elsif v_transition_row.to_stage = ''negociacao''%'
     or v_definition not like '%ZION_NEGOTIATION_SPECIALIZED_WRITER_REQUIRED%' then
    raise exception using message = 'P9_8_1 internal database authority guard missing';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.apply_material_commercial_negotiation_internal(uuid,uuid,uuid,integer,text,text,uuid,text,text,text,text,uuid)'::regprocedure
  ) into v_definition;
  if lower(v_definition) not like '%insert into public.commercial_opportunity_stage_transition_authority%'
     or lower(v_definition) not like '%apply_commercial_opportunity_stage_transition_internal%' then
    raise exception using message = 'P9_8_1 specialized user/system authority marker missing';
  end if;

  select * into v_transition
  from public.resolve_commercial_opportunity_stage_transition('perdido', 'negociacao');
  if v_transition.decision <> 'conditional'
     or not v_transition.requires_specialized_writer
     or v_transition.reason_code <> 'reopen_writer_required' then
    raise exception using message = 'P9_8_1 perdido negotiation reopen contract changed';
  end if;

  select * into v_transition
  from public.resolve_commercial_opportunity_stage_transition('novo_lead', 'qualificacao');
  if v_transition.decision <> 'conditional'
     or v_transition.is_permitted
     or v_transition.reason_code <> 'commercial_interest_required' then
    raise exception using message = 'P9 8.1 ordinary transition contract changed';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.apply_commercial_opportunity_stage_transition_internal(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text,uuid)'::regprocedure
  ) into v_definition;
  if lower(v_definition) not like '%nullif(pg_catalog.btrim(coalesce(p_idempotency_key%'
     or lower(v_definition) not like '%lifecycle_event.idempotency_key = v_idempotency_key%'
     or lower(v_definition) not like '%idempotency_key, event_key%'
     or lower(v_definition) not like '%compute_commercial_opportunity_event_fingerprint_internal%'
     or lower(v_definition) not like '%when unique_violation%'
     or lower(v_definition) not like '%commercial_opportunity_lifecycle_events_idempotency_uidx%'
     or lower(v_definition) not like '%v_existing_event.event_key%'
     or lower(v_definition) not like '%zion_idempotency_key_reused%' then
    raise exception using message = 'P9 8.1 idempotency/fingerprint contract changed';
  end if;

  select * into v_transition
  from public.resolve_commercial_opportunity_stage_transition('qualificacao', 'negociacao');
  if v_transition.decision <> 'forbidden'
     or v_transition.is_permitted
     or v_transition.requires_specialized_writer
     or v_transition.reason_code <> 'negotiation_requires_quote_stage' then
    raise exception using message = 'P9 8.1 qualificacao negotiation contract changed';
  end if;

  select * into v_transition
  from public.resolve_commercial_opportunity_stage_transition('orcamento', 'negociacao');
  if v_transition.decision <> 'conditional'
     or v_transition.is_permitted
     or not v_transition.requires_specialized_writer
     or v_transition.reason_code <> 'concrete_quote_objection_required' then
    raise exception using message = 'P9 8.1 orcamento negotiation contract changed';
  end if;

  select * into v_transition
  from public.resolve_commercial_opportunity_stage_transition('visita_tecnica', 'negociacao');
  if v_transition.decision <> 'conditional'
     or v_transition.is_permitted
     or not v_transition.requires_specialized_writer
     or v_transition.reason_code <> 'visit_viable_concrete_offer_required' then
    raise exception using message = 'P9 8.1 visita tecnica negotiation contract changed';
  end if;

  select * into v_transition
  from public.resolve_commercial_opportunity_stage_transition('fechamento_pagamento', 'negociacao');
  if v_transition.decision <> 'conditional'
     or v_transition.is_permitted
     or not v_transition.requires_specialized_writer
     or v_transition.reason_code <> 'renegotiation_required' then
    raise exception using message = 'P9 8.1 fechamento pagamento negotiation contract changed';
  end if;
end;
$checks$;
