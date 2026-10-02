-- P9 8.1 / Passo 2 focal checks.
-- Read-only contract checks; this file does not apply migrations or mutate DEV.

do $checks$
declare
  v_definition text;
  v_transition record;
begin
  select pg_catalog.pg_get_functiondef(
    'public.apply_commercial_opportunity_reopen_internal(uuid,uuid,uuid,text,text,text,text,text,uuid)'::regprocedure
  ) into v_definition;

  if v_definition is null
     or lower(v_definition) not like '%current_loss_event_id%'
     or lower(v_definition) not like '%event_type = ''marked_lost''%'
     or lower(v_definition) not like '%previous_stage is not null%'
     or lower(v_definition) not like '%new_stage = ''perdido''%'
     or lower(v_definition) not like '%customer_id = v_opportunity.customer_id%'
     or lower(v_definition) not like '%lifecycle_cycle = v_opportunity.lifecycle_cycle%'
     or v_definition not like '%ZION_REOPEN_TARGET_STAGE_MISMATCH%' then
    raise exception using message = 'P9_8_1 reopen previous-stage authority guard missing';
  end if;

  if pg_catalog.strpos(v_definition, 'ZION_REOPEN_TARGET_STAGE_MISMATCH')
       >= pg_catalog.strpos(v_definition, 'v_event_key :=')
     or pg_catalog.strpos(v_definition, 'ZION_REOPEN_TARGET_STAGE_MISMATCH')
       >= pg_catalog.strpos(v_definition, 'insert into public.commercial_opportunity_lifecycle_events')
     or pg_catalog.strpos(v_definition, 'ZION_REOPEN_TARGET_STAGE_MISMATCH')
       >= pg_catalog.strpos(v_definition, 'update public.commercial_opportunities') then
    raise exception using message = 'P9_8_1 mismatch guard is not before reopen mutation';
  end if;

  if lower(v_definition) not like '%v_opportunity.stage <> ''perdido''%'
     or lower(v_definition) not like '%lifecycle_cycle = opportunity_row.lifecycle_cycle + 1%'
     or lower(v_definition) not like '%new_stage,%'
     or lower(v_definition) not like '%idempotency_key%'
     or lower(v_definition) not like '%compute_commercial_opportunity_event_fingerprint_internal%'
     or lower(v_definition) not like '%when unique_violation%' then
    raise exception using message = 'P9_8_1 reopen idempotency/lifecycle contract changed';
  end if;

  select * into v_transition
  from public.resolve_commercial_opportunity_stage_transition('perdido', 'negociacao');
  if v_transition.decision <> 'conditional'
     or v_transition.is_permitted
     or not v_transition.requires_specialized_writer
     or v_transition.reason_code <> 'reopen_writer_required' then
    raise exception using message = 'P9_8_1 perdido negotiation matrix contract changed';
  end if;

  -- Scenario A/D: a lost event whose previous_stage is not negociacao must
  -- reject a caller target of negociacao before any reopen write.
  if v_definition not like '%ZION_REOPEN_LOSS_EVENT_INVALID%'
     or v_definition not like '%ZION_REOPEN_TARGET_STAGE_MISMATCH%' then
    raise exception using message = 'P9_8_1 mismatch scenarios are not fail-closed';
  end if;

  -- Scenarios B/C: matching targets are used by the existing insert/update
  -- path, which preserves reopened(previous_stage=perdido,new_stage=target).
  if lower(v_definition) not like '%''perdido'',%'
     or lower(v_definition) not like '%v_target_stage%'
     or lower(v_definition) not like '%last_reopened_at%' then
    raise exception using message = 'P9_8_1 matching reopen path contract missing';
  end if;

  -- Scenario E: replay remains on the existing idempotency/fingerprint path;
  -- no second writer is introduced by this runner or by the migration.
  if lower(v_definition) not like '%v_existing_event.event_type <> ''reopened''%'
     or lower(v_definition) not like '%zion_idempotency_key_reused%' then
    raise exception using message = 'P9_8_1 replay protection contract missing';
  end if;
end;
$checks$;
