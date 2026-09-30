-- ZION / Pilar 9 / Bloco 7 / Etapa 7.5
-- Manual checks for canonical post-technical-visit decision authority.
--
-- Execute only AFTER:
--   20260929165000_p9_7_5_post_visit_decision_authority.sql
-- is applied in controlled DEV.
--
-- Every fixture/data mutation performed by this runner is transactional and
-- is rolled back at the end.

begin;

create temp table p975_decision_results (
  scenario text primary key,
  passed boolean not null,
  detail text not null
) on commit drop;

do $runner$
declare
  v_run text :=
    pg_catalog.substr(
      pg_catalog.replace(gen_random_uuid()::text, '-', ''),
      1,
      12
    );

  v_opportunity public.commercial_opportunities%rowtype;
  v_responsible_id uuid;

  v_appointment_id uuid := gen_random_uuid();
  v_followup_id uuid := gen_random_uuid();

  v_r1 uuid := gen_random_uuid();
  v_r2 uuid := gen_random_uuid();
  v_r3 uuid := gen_random_uuid();
  v_r4 uuid := gen_random_uuid();
  v_r5 uuid := gen_random_uuid();
  v_r6 uuid := gen_random_uuid();
  v_r7 uuid := gen_random_uuid();
  v_r8 uuid := gen_random_uuid();

  v_event1 uuid;
  v_event2 uuid;
  v_event3 uuid;
  v_event4 uuid;
  v_event5 uuid;
  v_event6 uuid;
  v_event7 uuid;
  v_event8 uuid;

  v_loss_message_id uuid;

  v_decision record;
  v_decision1_id uuid;
  v_decision2_id uuid;

  v_q record;
  v_readiness record;
  v_group text;

  v_stage_before text;
  v_lifecycle_before integer;

  v_quote_count_before bigint;
  v_appointment_count_before bigint;
  v_followup_count_before bigint;

  v_count bigint;
  v_definition text;
  v_error text;
begin
  ---------------------------------------------------------------------------
  -- Installed authority / security contract.
  ---------------------------------------------------------------------------

  if pg_catalog.to_regclass(
       'public.store_technical_visit_post_visit_decisions'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.decide_post_technical_visit_by_system(uuid,text,jsonb)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P975_DECISION_AUTHORITY_NOT_APPLIED';
  end if;

  insert into p975_decision_results
  values (
    '01 authority installed',
    true,
    'decision table and RPC resolved'
  );

  insert into p975_decision_results
  values (
    '02 rpc privilege boundary',
    not pg_catalog.has_function_privilege(
      'authenticated',
      'public.decide_post_technical_visit_by_system(uuid,text,jsonb)',
      'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.decide_post_technical_visit_by_system(uuid,text,jsonb)',
      'EXECUTE'
    ),
    'authenticated denied; service_role allowed'
  );

  insert into p975_decision_results
  values (
    '03 decision table privilege boundary',
    not pg_catalog.has_table_privilege(
      'authenticated',
      'public.store_technical_visit_post_visit_decisions',
      'SELECT'
    )
    and pg_catalog.has_table_privilege(
      'service_role',
      'public.store_technical_visit_post_visit_decisions',
      'SELECT'
    ),
    'authenticated denied; service_role select allowed'
  );

  select pg_catalog.pg_get_functiondef(
    'public.decide_post_technical_visit_by_system(uuid,text,jsonb)'
      ::pg_catalog.regprocedure
  )
  into v_definition;

  insert into p975_decision_results
  values (
    '04 shared result advisory lock',
    pg_catalog.strpos(
      v_definition,
      'zion:p9:technical-visit-result:v1:'
    ) > 0
    and pg_catalog.strpos(
      v_definition,
      'zion:p9:technical-visit-decision:v1:'
    ) = 0,
    'decision authority coordinates with canonical result writer lock'
  );

  insert into p975_decision_results
  values (
    '05 negotiation remains fail closed',
    pg_catalog.strpos(
      v_definition,
      'v_decision_kind := ''negotiation'''
    ) = 0,
    'no runtime assignment to negotiation'
  );

  insert into p975_decision_results
  values (
    '06 quote already sent branch preserved',
    pg_catalog.strpos(
      v_definition,
      'technical_visit_viable_quote_already_sent'
    ) > 0,
    'none branch remains defined for already-sent quote'
  );

  insert into p975_decision_results
  values (
    '07 append only trigger installed',
    exists (
      select 1
      from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid =
            'public.store_technical_visit_post_visit_decisions'
              ::pg_catalog.regclass
        and trigger_row.tgname =
            'store_technical_visit_post_visit_decisions_append_only'
        and not trigger_row.tgisinternal
    ),
    'append-only trigger exists'
  );

  ---------------------------------------------------------------------------
  -- Select a real DEV opportunity with:
  --
  -- - incomplete qualification;
  -- - no qualification conflicts;
  -- - quote readiness already capable of supporting the quote branch;
  -- - a responsible in the same store.
  --
  -- We complete only the missing qualification groups temporarily using the
  -- canonical qualification writer. Everything rolls back.
  ---------------------------------------------------------------------------

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row

  cross join lateral
    public.read_commercial_opportunity_qualification_facts_internal(
      opportunity_row.organization_id,
      opportunity_row.store_id,
      opportunity_row.id
    ) qualification_row

  cross join lateral
    public.p9_resolve_commercial_action_readiness_internal(
      opportunity_row.organization_id,
      opportunity_row.store_id,
      opportunity_row.id,
      'send_quote'
    ) readiness_row

  where opportunity_row.lifecycle_cycle >= 1
    and opportunity_row.primary_conversation_id is not null
    and opportunity_row.origin_lead_id is not null
    and opportunity_row.stage not in (
      'perdido',
      'concluido_sem_mais_acoes'
    )
    and qualification_row.missing_group_count > 0
    and qualification_row.conflict_count = 0
    and (
      readiness_row.readiness_state = 'ready'
      or (
        readiness_row.readiness_state = 'blocked'
        and readiness_row.reason_code =
            'send_quote_quote_not_prepared'
      )
    )
    and exists (
      select 1
      from public.store_responsibles responsible_row
      where responsible_row.organization_id =
            opportunity_row.organization_id
        and responsible_row.store_id =
            opportunity_row.store_id
    )

  order by
    case
      when readiness_row.readiness_state = 'ready' then 0
      else 1
    end,
    opportunity_row.updated_at desc nulls last,
    opportunity_row.id

  limit 1;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'P975_DECISION_RUNNER_CANDIDATE_NOT_FOUND';
  end if;

  select responsible_row.id
  into v_responsible_id
  from public.store_responsibles responsible_row
  where responsible_row.organization_id =
        v_opportunity.organization_id
    and responsible_row.store_id =
        v_opportunity.store_id
  order by responsible_row.id
  limit 1;

  select *
  into v_q
  from public.read_commercial_opportunity_qualification_facts_internal(
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id
  );

  select *
  into v_readiness
  from public.p9_resolve_commercial_action_readiness_internal(
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id,
    'send_quote'
  );

  insert into p975_decision_results
  values (
    '08 controlled candidate precondition',
    v_q.missing_group_count > 0
    and v_q.conflict_count = 0
    and (
      v_readiness.readiness_state = 'ready'
      or (
        v_readiness.readiness_state = 'blocked'
        and v_readiness.reason_code =
            'send_quote_quote_not_prepared'
      )
    ),
    pg_catalog.format(
      'opportunity=%s missing=%s conflicts=%s readiness=%s/%s',
      v_opportunity.id,
      v_q.missing_group_count,
      v_q.conflict_count,
      v_readiness.readiness_state,
      v_readiness.reason_code
    )
  );

  v_stage_before := v_opportunity.stage;
  v_lifecycle_before := v_opportunity.lifecycle_cycle;

  ---------------------------------------------------------------------------
  -- Visit/follow-up fixture.
  --
  -- completed avoids consuming live schedule capacity.
  -- Direct fixture setup executes as postgres in the SQL runner.
  -- Business RPCs below still require service_role.
  ---------------------------------------------------------------------------

  insert into public.store_appointments (
    id,
    organization_id,
    store_id,
    title,
    appointment_type,
    status,
    scheduled_start,
    scheduled_end,
    source,
    commercial_opportunity_id,
    commercial_opportunity_lifecycle_cycle
  )
  values (
    v_appointment_id,
    v_opportunity.organization_id,
    v_opportunity.store_id,
    'P975 decision authority runner',
    'technical_visit',
    'completed',
    pg_catalog.clock_timestamp() - interval '2 hours',
    pg_catalog.clock_timestamp() - interval '1 hour',
    'system',
    v_opportunity.id,
    v_opportunity.lifecycle_cycle
  );

  insert into public.schedule_post_appointment_followups (
    id,
    organization_id,
    store_id,
    appointment_id,
    scheduled_end,
    followup_status,
    preferred_channel,
    prompt_count
  )
  values (
    v_followup_id,
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_appointment_id,
    pg_catalog.clock_timestamp() - interval '1 hour',
    'prompt_sent',
    'unknown',
    1
  );

  insert into public.schedule_post_appointment_followup_responses (
    id,
    organization_id,
    store_id,
    followup_id,
    appointment_id,
    responsible_id,
    inbound_external_message_id,
    replied_to_external_message_id,
    correlation_method,
    raw_content,
    metadata,
    received_at
  )
  values
  (
    v_r1,
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_followup_id,
    v_appointment_id,
    v_responsible_id,
    'P975D-' || v_run || '-R1',
    null,
    'single_open_obligation',
    'Fui ao local e ficou viavel.',
    '{}'::jsonb,
    pg_catalog.clock_timestamp()
  ),
  (
    v_r2,
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_followup_id,
    v_appointment_id,
    v_responsible_id,
    'P975D-' || v_run || '-R2',
    null,
    'single_open_obligation',
    'Fui ao local novamente e continua viavel.',
    '{}'::jsonb,
    pg_catalog.clock_timestamp()
  ),
  (
    v_r3,
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_followup_id,
    v_appointment_id,
    v_responsible_id,
    'P975D-' || v_run || '-R3',
    null,
    'single_open_obligation',
    'Durante a visita ficou viavel com reforco na base.',
    '{}'::jsonb,
    pg_catalog.clock_timestamp()
  ),
  (
    v_r4,
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_followup_id,
    v_appointment_id,
    v_responsible_id,
    'P975D-' || v_run || '-R4',
    null,
    'single_open_obligation',
    'Fui ao local, mas ainda esta pendente a confirmacao.',
    '{}'::jsonb,
    pg_catalog.clock_timestamp()
  ),
  (
    v_r5,
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_followup_id,
    v_appointment_id,
    v_responsible_id,
    'P975D-' || v_run || '-R5',
    null,
    'single_open_obligation',
    'Fui ao local e tecnicamente ficou inviavel.',
    '{}'::jsonb,
    pg_catalog.clock_timestamp()
  ),
  (
    v_r6,
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_followup_id,
    v_appointment_id,
    v_responsible_id,
    'P975D-' || v_run || '-R6',
    null,
    'single_open_obligation',
    'A visita nao aconteceu porque o cliente nao estava.',
    '{}'::jsonb,
    pg_catalog.clock_timestamp()
  ),
  (
    v_r7,
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_followup_id,
    v_appointment_id,
    v_responsible_id,
    'P975D-' || v_run || '-R7',
    null,
    'single_open_obligation',
    'Nao consegui confirmar se a visita aconteceu.',
    '{}'::jsonb,
    pg_catalog.clock_timestamp()
  ),
  (
    v_r8,
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_followup_id,
    v_appointment_id,
    v_responsible_id,
    'P975D-' || v_run || '-R8',
    null,
    'single_open_obligation',
    'Fui ao local, mas nao consegui determinar o resultado tecnico.',
    '{}'::jsonb,
    pg_catalog.clock_timestamp()
  );

  select count(*)
  into v_quote_count_before
  from public.sales_quotes quote_row
  where quote_row.commercial_opportunity_id =
        v_opportunity.id;

  select count(*)
  into v_appointment_count_before
  from public.store_appointments appointment_row
  where appointment_row.commercial_opportunity_id =
        v_opportunity.id;

  select count(*)
  into v_followup_count_before
  from public.schedule_post_appointment_followups followup_row
  where followup_row.appointment_id =
        v_appointment_id;

  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'service_role',
    true
  );

  ---------------------------------------------------------------------------
  -- VIABLE while qualification is incomplete -> qualification.
  ---------------------------------------------------------------------------

  select result_row.event_id
  into v_event1
  from public.persist_post_technical_visit_result_by_system(
    p_source_response_id => v_r1,
    p_result_kind => 'viable',
    p_evidence_text => 'viavel',
    p_adjustment_summary => null,
    p_uncertainty_reason => null,
    p_occurrence => 'occurred',
    p_occurrence_evidence_text => 'Fui ao local',
    p_operation_key =>
      'p975-decision-result:' || v_run || ':1',
    p_metadata =>
      pg_catalog.jsonb_build_object(
        'runner', 'decision',
        'case', 'qualification'
      )
  ) result_row;

  select *
  into v_decision
  from public.decide_post_technical_visit_by_system(
    v_event1,
    'p975-decision:' || v_run || ':1',
    pg_catalog.jsonb_build_object(
      'runner', 'decision',
      'case', 'qualification'
    )
  );

  v_decision1_id := v_decision.decision_id;

  insert into p975_decision_results
  values (
    '09 viable incomplete routes qualification',
    v_decision.decision_kind = 'qualification'
    and v_decision.decision_reason =
        'technical_visit_viable_but_qualification_incomplete'
    and v_decision.replayed is false,
    pg_catalog.format(
      'decision=%s reason=%s replayed=%s',
      v_decision.decision_kind,
      v_decision.decision_reason,
      v_decision.replayed
    )
  );

  ---------------------------------------------------------------------------
  -- Exact replay.
  ---------------------------------------------------------------------------

  select *
  into v_decision
  from public.decide_post_technical_visit_by_system(
    v_event1,
    'p975-decision:' || v_run || ':1',
    pg_catalog.jsonb_build_object(
      'runner', 'decision',
      'case', 'qualification'
    )
  );

  insert into p975_decision_results
  values (
    '10 identical decision replay',
    v_decision.decision_id = v_decision1_id
    and v_decision.replayed is true,
    pg_catalog.format(
      'decision_id=%s replayed=%s',
      v_decision.decision_id,
      v_decision.replayed
    )
  );

  ---------------------------------------------------------------------------
  -- Same event/key but changed metadata must fail.
  ---------------------------------------------------------------------------

  v_error := null;

  begin
    perform *
    from public.decide_post_technical_visit_by_system(
      v_event1,
      'p975-decision:' || v_run || ':1',
      pg_catalog.jsonb_build_object(
        'runner', 'decision',
        'case', 'qualification',
        'changed', true
      )
    );

  exception
    when others then
      v_error := sqlerrm;
  end;

  insert into p975_decision_results
  values (
    '11 changed metadata replay rejected',
    coalesce(
      v_error =
        'ZION_P9_7_5_INCOMPATIBLE_DECISION_REPLAY',
      false
    ),
    coalesce(v_error, '<no error>')
  );

  ---------------------------------------------------------------------------
  -- Complete ONLY the qualification groups currently missing.
  --
  -- These are intentionally inference fixtures, never fake customer
  -- confirmations. They exist only until the final ROLLBACK.
  ---------------------------------------------------------------------------

  select *
  into v_q
  from public.read_commercial_opportunity_qualification_facts_internal(
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id
  );

  for v_group in
    select group_row ->> 'groupKey'
    from pg_catalog.jsonb_array_elements(
      v_q.missing_fact_groups
    ) group_row

  loop
    if v_group = 'need' then

      perform
        public.write_commercial_opportunity_qualification_fact_by_system(
          v_opportunity.organization_id,
          v_opportunity.store_id,
          v_opportunity.id,
          'p975-decision-qfact:' || v_run || ':need',
          'need_summary',
          pg_catalog.to_jsonb('runner need'::text),
          'inferred',
          'system_inference',
          null,
          null,
          'p9_7_5_runner',
          false
        );

    elsif v_group = 'space' then

      perform
        public.write_commercial_opportunity_qualification_fact_by_system(
          v_opportunity.organization_id,
          v_opportunity.store_id,
          v_opportunity.id,
          'p975-decision-qfact:' || v_run || ':space',
          'space_text',
          pg_catalog.to_jsonb('runner space'::text),
          'inferred',
          'system_inference',
          null,
          null,
          'p9_7_5_runner',
          false
        );

    elsif v_group = 'location' then

      perform
        public.write_commercial_opportunity_qualification_fact_by_system(
          v_opportunity.organization_id,
          v_opportunity.store_id,
          v_opportunity.id,
          'p975-decision-qfact:' || v_run || ':location',
          'location_text',
          pg_catalog.to_jsonb('runner location'::text),
          'inferred',
          'system_inference',
          null,
          null,
          'p9_7_5_runner',
          false
        );

    elsif v_group = 'installation' then

      perform
        public.write_commercial_opportunity_qualification_fact_by_system(
          v_opportunity.organization_id,
          v_opportunity.store_id,
          v_opportunity.id,
          'p975-decision-qfact:' || v_run || ':installation',
          'installation_interest',
          'true'::jsonb,
          'inferred',
          'system_inference',
          null,
          null,
          'p9_7_5_runner',
          false
        );

    elsif v_group = 'payment' then

      perform
        public.write_commercial_opportunity_qualification_fact_by_system(
          v_opportunity.organization_id,
          v_opportunity.store_id,
          v_opportunity.id,
          'p975-decision-qfact:' || v_run || ':payment',
          'payment_interest',
          'true'::jsonb,
          'inferred',
          'system_inference',
          null,
          null,
          'p9_7_5_runner',
          false
        );

    else
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'P975_DECISION_RUNNER_UNKNOWN_QUALIFICATION_GROUP:%s',
          v_group
        );
    end if;
  end loop;

  select *
  into v_q
  from public.read_commercial_opportunity_qualification_facts_internal(
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id
  );

  insert into p975_decision_results
  values (
    '12 canonical qfacts complete qualification',
    v_q.missing_group_count = 0
    and v_q.conflict_count = 0,
    pg_catalog.format(
      'missing=%s conflicts=%s known=%s',
      v_q.missing_group_count,
      v_q.conflict_count,
      v_q.known_fact_count
    )
  );

  select *
  into v_readiness
  from public.p9_resolve_commercial_action_readiness_internal(
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id,
    'send_quote'
  );

  insert into p975_decision_results
  values (
    '13 quote readiness still valid',
    v_readiness.readiness_state = 'ready'
    or (
      v_readiness.readiness_state = 'blocked'
      and v_readiness.reason_code =
          'send_quote_quote_not_prepared'
    ),
    pg_catalog.format(
      '%s/%s',
      v_readiness.readiness_state,
      v_readiness.reason_code
    )
  );

  ---------------------------------------------------------------------------
  -- New viable result supersedes event1.
  ---------------------------------------------------------------------------

  select result_row.event_id
  into v_event2
  from public.persist_post_technical_visit_result_by_system(
    p_source_response_id => v_r2,
    p_result_kind => 'viable',
    p_evidence_text => 'viavel',
    p_adjustment_summary => null,
    p_uncertainty_reason => null,
    p_occurrence => 'occurred',
    p_occurrence_evidence_text => 'Fui ao local',
    p_operation_key =>
      'p975-decision-result:' || v_run || ':2',
    p_metadata =>
      pg_catalog.jsonb_build_object(
        'runner', 'decision',
        'case', 'quote'
      )
  ) result_row;

  v_error := null;

  begin
    perform *
    from public.decide_post_technical_visit_by_system(
      v_event1,
      'p975-decision:' || v_run || ':1',
      pg_catalog.jsonb_build_object(
        'runner', 'decision',
        'case', 'qualification'
      )
    );

  exception
    when others then
      v_error := sqlerrm;
  end;

  insert into p975_decision_results
  values (
    '14 superseded result cannot replay decision',
    coalesce(
      v_error =
        'ZION_P9_7_5_RESULT_EVENT_SUPERSEDED',
      false
    ),
    coalesce(v_error, '<no error>')
  );

  ---------------------------------------------------------------------------
  -- The first decision operation key cannot be reused by the new result.
  ---------------------------------------------------------------------------

  v_error := null;

  begin
    perform *
    from public.decide_post_technical_visit_by_system(
      v_event2,
      'p975-decision:' || v_run || ':1',
      pg_catalog.jsonb_build_object(
        'runner', 'decision',
        'case', 'quote'
      )
    );

  exception
    when others then
      v_error := sqlerrm;
  end;

  insert into p975_decision_results
  values (
    '15 operation key cannot move to another event',
    coalesce(
      v_error =
        'ZION_P9_7_5_INCOMPATIBLE_DECISION_REPLAY',
      false
    ),
    coalesce(v_error, '<no error>')
  );

  ---------------------------------------------------------------------------
  -- VIABLE + complete qualification + valid quote readiness -> quote.
  ---------------------------------------------------------------------------

  select *
  into v_decision
  from public.decide_post_technical_visit_by_system(
    v_event2,
    'p975-decision:' || v_run || ':2',
    pg_catalog.jsonb_build_object(
      'runner', 'decision',
      'case', 'quote'
    )
  );

  v_decision2_id := v_decision.decision_id;

  insert into p975_decision_results
  values (
    '16 viable complete routes quote',
    v_decision.decision_kind = 'quote'
    and v_decision.decision_reason =
        'technical_visit_viable_quote_ready'
    and v_decision.replayed is false,
    pg_catalog.format(
      'decision=%s reason=%s',
      v_decision.decision_kind,
      v_decision.decision_reason
    )
  );

  ---------------------------------------------------------------------------
  -- VIABLE WITH ADJUSTMENTS -> needs_resolution.
  ---------------------------------------------------------------------------

  select result_row.event_id
  into v_event3
  from public.persist_post_technical_visit_result_by_system(
    p_source_response_id => v_r3,
    p_result_kind => 'viable_with_adjustments',
    p_evidence_text => 'viavel com reforco na base',
    p_adjustment_summary => 'reforco na base',
    p_uncertainty_reason => null,
    p_occurrence => 'occurred',
    p_occurrence_evidence_text => 'Durante a visita',
    p_operation_key =>
      'p975-decision-result:' || v_run || ':3',
    p_metadata =>
      pg_catalog.jsonb_build_object(
        'runner', 'decision',
        'case', 'adjustments'
      )
  ) result_row;

  select *
  into v_decision
  from public.decide_post_technical_visit_by_system(
    v_event3,
    'p975-decision:' || v_run || ':3',
    pg_catalog.jsonb_build_object(
      'runner', 'decision',
      'case', 'adjustments'
    )
  );

  insert into p975_decision_results
  values (
    '17 viable with adjustments needs resolution',
    v_decision.decision_kind = 'needs_resolution'
    and v_decision.decision_reason =
        'technical_visit_adjustments_require_resolution',
    pg_catalog.format(
      'decision=%s reason=%s',
      v_decision.decision_kind,
      v_decision.decision_reason
    )
  );

  ---------------------------------------------------------------------------
  -- PENDING -> followup decision only.
  ---------------------------------------------------------------------------

  select result_row.event_id
  into v_event4
  from public.persist_post_technical_visit_result_by_system(
    p_source_response_id => v_r4,
    p_result_kind => 'pending',
    p_evidence_text => 'pendente',
    p_adjustment_summary => null,
    p_uncertainty_reason => 'confirmacao pendente',
    p_occurrence => 'occurred',
    p_occurrence_evidence_text => 'Fui ao local',
    p_operation_key =>
      'p975-decision-result:' || v_run || ':4',
    p_metadata =>
      pg_catalog.jsonb_build_object(
        'runner', 'decision',
        'case', 'pending'
      )
  ) result_row;

  select *
  into v_decision
  from public.decide_post_technical_visit_by_system(
    v_event4,
    'p975-decision:' || v_run || ':4',
    pg_catalog.jsonb_build_object(
      'runner', 'decision',
      'case', 'pending'
    )
  );

  insert into p975_decision_results
  values (
    '18 pending routes followup decision only',
    v_decision.decision_kind = 'followup'
    and v_decision.decision_reason =
        'technical_visit_result_pending',
    pg_catalog.format(
      'decision=%s reason=%s',
      v_decision.decision_kind,
      v_decision.decision_reason
    )
  );

  ---------------------------------------------------------------------------
  -- INFEASIBLE + occurred -> loss proposal, but no loss execution.
  ---------------------------------------------------------------------------

  select result_row.event_id
  into v_event5
  from public.persist_post_technical_visit_result_by_system(
    p_source_response_id => v_r5,
    p_result_kind => 'infeasible',
    p_evidence_text => 'inviavel',
    p_adjustment_summary => null,
    p_uncertainty_reason => null,
    p_occurrence => 'occurred',
    p_occurrence_evidence_text => 'Fui ao local',
    p_operation_key =>
      'p975-decision-result:' || v_run || ':5',
    p_metadata =>
      pg_catalog.jsonb_build_object(
        'runner', 'decision',
        'case', 'loss'
      )
  ) result_row;

  select *
  into v_decision
  from public.decide_post_technical_visit_by_system(
    v_event5,
    'p975-decision:' || v_run || ':5',
    pg_catalog.jsonb_build_object(
      'runner', 'decision',
      'case', 'loss'
    )
  );

  insert into p975_decision_results
  values (
    '19 infeasible occurred proposes technical loss',
    v_decision.decision_kind = 'loss'
    and v_decision.decision_reason =
        'confirmed_technical_infeasibility',
    pg_catalog.format(
      'decision=%s reason=%s',
      v_decision.decision_kind,
      v_decision.decision_reason
    )
  );

  ---------------------------------------------------------------------------
  -- DID NOT OCCUR -> followup, never loss.
  ---------------------------------------------------------------------------

  select result_row.event_id
  into v_event6
  from public.persist_post_technical_visit_result_by_system(
    p_source_response_id => v_r6,
    p_result_kind => null,
    p_evidence_text => null,
    p_adjustment_summary => null,
    p_uncertainty_reason => null,
    p_occurrence => 'did_not_occur',
    p_occurrence_evidence_text =>
      'A visita nao aconteceu',
    p_operation_key =>
      'p975-decision-result:' || v_run || ':6',
    p_metadata =>
      pg_catalog.jsonb_build_object(
        'runner', 'decision',
        'case', 'did_not_occur'
      )
  ) result_row;

  select *
  into v_decision
  from public.decide_post_technical_visit_by_system(
    v_event6,
    'p975-decision:' || v_run || ':6',
    pg_catalog.jsonb_build_object(
      'runner', 'decision',
      'case', 'did_not_occur'
    )
  );

  insert into p975_decision_results
  values (
    '20 did not occur never proposes loss',
    v_decision.decision_kind = 'followup'
    and v_decision.decision_reason =
        'technical_visit_did_not_occur',
    pg_catalog.format(
      'decision=%s reason=%s',
      v_decision.decision_kind,
      v_decision.decision_reason
    )
  );

  ---------------------------------------------------------------------------
  -- UNCLEAR -> needs_resolution.
  ---------------------------------------------------------------------------

  select result_row.event_id
  into v_event7
  from public.persist_post_technical_visit_result_by_system(
    p_source_response_id => v_r7,
    p_result_kind => null,
    p_evidence_text => null,
    p_adjustment_summary => null,
    p_uncertainty_reason =>
      'ocorrencia nao confirmada',
    p_occurrence => 'unclear',
    p_occurrence_evidence_text => null,
    p_operation_key =>
      'p975-decision-result:' || v_run || ':7',
    p_metadata =>
      pg_catalog.jsonb_build_object(
        'runner', 'decision',
        'case', 'unclear'
      )
  ) result_row;

  select *
  into v_decision
  from public.decide_post_technical_visit_by_system(
    v_event7,
    'p975-decision:' || v_run || ':7',
    pg_catalog.jsonb_build_object(
      'runner', 'decision',
      'case', 'unclear'
    )
  );

  insert into p975_decision_results
  values (
    '21 unclear occurrence needs resolution',
    v_decision.decision_kind = 'needs_resolution'
    and v_decision.decision_reason =
        'technical_visit_occurrence_unclear',
    pg_catalog.format(
      'decision=%s reason=%s',
      v_decision.decision_kind,
      v_decision.decision_reason
    )
  );

  ---------------------------------------------------------------------------
  -- Authenticated caller must be denied.
  ---------------------------------------------------------------------------

  v_error := null;

  begin
    perform pg_catalog.set_config(
      'request.jwt.claim.role',
      'authenticated',
      true
    );

    perform *
    from public.decide_post_technical_visit_by_system(
      v_event7,
      'p975-decision:' || v_run || ':7',
      pg_catalog.jsonb_build_object(
        'runner', 'decision',
        'case', 'unclear'
      )
    );

  exception
    when others then
      v_error := sqlerrm;
  end;

  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'service_role',
    true
  );

  insert into p975_decision_results
  values (
    '22 authenticated caller denied',
    coalesce(
      v_error =
        'ZION_P9_7_5_DECISION_NOT_AUTHORIZED',
      false
    ),
    coalesce(v_error, '<no error>')
  );

  ---------------------------------------------------------------------------
  -- Lifecycle stale.
  --
  -- Never mutate lifecycle_cycle directly. Build a real new lifecycle through
  -- the canonical loss -> reopen authorities inside this PL/pgSQL
  -- subtransaction:
  --
  -- customer refusal message
  -- -> canonical system loss
  -- -> canonical system reopen
  -- -> lifecycle_cycle + 1
  -- -> old technical-visit result must be rejected as stale.
  --
  -- The expected stale exception rolls the entire temporary lifecycle,
  -- synthetic message and all related transactional side effects back.
  ---------------------------------------------------------------------------

  v_error := null;
  v_loss_message_id := null;

  begin
    -- insert_message executes this controlled SQL fixture as postgres.
    -- Clear synthetic JWT claims so the canonical session writer sees the real role.
    perform pg_catalog.set_config('request.jwt.claim.role', '', true);
    perform pg_catalog.set_config('request.jwt.claims', '', true);
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

    select inserted_message.id
    into v_loss_message_id
    from public.insert_message(
      p_conversation_id =>
        v_opportunity.primary_conversation_id,
      p_sender =>
        'user',
      p_direction =>
        'incoming',
      p_message_type =>
        'text',
      p_content =>
        'Nao quero mais continuar com esta compra.',
      p_external_message_id =>
        'p975-lifecycle-loss-' || v_run,
      p_media_url =>
        null,
      p_metadata =>
        pg_catalog.jsonb_build_object(
          'runner', 'decision',
          'case', 'lifecycle_stale',
          'synthetic', true
        )
    ) inserted_message;

    -- Downstream system authorities require the service_role claim again.
    perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

    if v_loss_message_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'P975_LIFECYCLE_STALE_MESSAGE_NOT_CREATED';
    end if;

    perform public.assert_commercial_opportunity_message_evidence(
      v_opportunity.organization_id,
      v_opportunity.store_id,
      v_opportunity.id,
      v_opportunity.customer_id,
      v_loss_message_id
    );

    perform *
    from public.mark_commercial_opportunity_lost_by_system(
      p_organization_id =>
        v_opportunity.organization_id,
      p_store_id =>
        v_opportunity.store_id,
      p_commercial_opportunity_id =>
        v_opportunity.id,
      p_idempotency_key =>
        'p975-lifecycle-loss:' || v_run,
      p_reason_code =>
        'explicit_refusal',
      p_evidence_message_id =>
        v_loss_message_id,
      p_evidence_summary =>
        'Nao quero mais continuar com esta compra.',
      p_actor_type =>
        'system',
      p_source =>
        'p975_decision_runner'
    );

    perform *
    from public.reopen_commercial_opportunity_by_system(
      p_organization_id =>
        v_opportunity.organization_id,
      p_store_id =>
        v_opportunity.store_id,
      p_commercial_opportunity_id =>
        v_opportunity.id,
      p_idempotency_key =>
        'p975-lifecycle-reopen:' || v_run,
      p_target_stage =>
        v_stage_before,
      p_reason_details =>
        'P975 lifecycle stale rollback fixture',
      p_source =>
        'p975_decision_runner'
    );

    if not exists (
      select 1
      from public.commercial_opportunities opportunity_row
      where opportunity_row.id =
            v_opportunity.id
        and opportunity_row.organization_id =
            v_opportunity.organization_id
        and opportunity_row.store_id =
            v_opportunity.store_id
        and opportunity_row.lifecycle_cycle =
            v_lifecycle_before + 1
        and opportunity_row.stage =
            v_stage_before
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'P975_LIFECYCLE_STALE_CANONICAL_CYCLE_NOT_ADVANCED';
    end if;

    perform *
    from public.decide_post_technical_visit_by_system(
      v_event7,
      'p975-decision:' || v_run || ':7',
      pg_catalog.jsonb_build_object(
        'runner', 'decision',
        'case', 'unclear'
      )
    );

  exception
    when others then
      v_error := sqlerrm;
  end;

  insert into p975_decision_results
  values (
    '23 lifecycle stale rejected',
    coalesce(
      v_error =
        'ZION_P9_7_5_DECISION_LIFECYCLE_STALE',
      false
    )
    and (
      select opportunity_row.lifecycle_cycle
      from public.commercial_opportunities opportunity_row
      where opportunity_row.id =
            v_opportunity.id
    ) = v_lifecycle_before
    and (
      select opportunity_row.stage
      from public.commercial_opportunities opportunity_row
      where opportunity_row.id =
            v_opportunity.id
    ) = v_stage_before,
    pg_catalog.format(
      'error=%s lifecycle_after_subtransaction=%s stage_after_subtransaction=%s',
      coalesce(v_error, '<no error>'),
      (
        select opportunity_row.lifecycle_cycle
        from public.commercial_opportunities opportunity_row
        where opportunity_row.id =
              v_opportunity.id
      ),
      (
        select opportunity_row.stage
        from public.commercial_opportunities opportunity_row
        where opportunity_row.id =
              v_opportunity.id
      )
    )
  );

  ---------------------------------------------------------------------------
  -- OCCURRED but no technical result -> needs_resolution.
  --
  -- This is different from an explicit "pending" result. The responsible
  -- confirmed the visit happened, but no conclusive technical fact was
  -- extracted, so the CRM must clarify instead of inventing a pending state.
  ---------------------------------------------------------------------------

  select result_row.event_id
  into v_event8
  from public.persist_post_technical_visit_result_by_system(
    p_source_response_id => v_r8,
    p_result_kind => null,
    p_evidence_text => null,
    p_adjustment_summary => null,
    p_uncertainty_reason => 'resultado tecnico nao determinado',
    p_occurrence => 'occurred',
    p_occurrence_evidence_text => 'Fui ao local',
    p_operation_key =>
      'p975-decision-result:' || v_run || ':8',
    p_metadata =>
      pg_catalog.jsonb_build_object(
        'runner', 'decision',
        'case', 'missing_result'
      )
  ) result_row;

  select *
  into v_decision
  from public.decide_post_technical_visit_by_system(
    v_event8,
    'p975-decision:' || v_run || ':8',
    pg_catalog.jsonb_build_object(
      'runner', 'decision',
      'case', 'missing_result'
    )
  );

  insert into p975_decision_results
  values (
    '23b occurred missing result needs resolution',
    v_decision.decision_kind = 'needs_resolution'
    and v_decision.decision_reason =
        'technical_visit_result_missing_needs_resolution',
    pg_catalog.format(
      'decision=%s reason=%s',
      v_decision.decision_kind,
      v_decision.decision_reason
    )
  );

  ---------------------------------------------------------------------------
  -- Append-only enforcement.
  ---------------------------------------------------------------------------

  v_error := null;

  begin
    update public.store_technical_visit_post_visit_decisions decision_row
    set decision_reason =
        decision_row.decision_reason
    where decision_row.id =
          v_decision1_id;

  exception
    when others then
      v_error := sqlerrm;
  end;

  insert into p975_decision_results
  values (
    '24 append only blocks update',
    coalesce(
      v_error =
        'ZION_P9_7_5_POST_VISIT_DECISIONS_APPEND_ONLY',
      false
    ),
    coalesce(v_error, '<no error>')
  );

  v_error := null;

  begin
    delete from public.store_technical_visit_post_visit_decisions decision_row
    where decision_row.id =
          v_decision2_id;

  exception
    when others then
      v_error := sqlerrm;
  end;

  insert into p975_decision_results
  values (
    '25 append only blocks delete',
    coalesce(
      v_error =
        'ZION_P9_7_5_POST_VISIT_DECISIONS_APPEND_ONLY',
      false
    ),
    coalesce(v_error, '<no error>')
  );

  ---------------------------------------------------------------------------
  -- Decision-only guarantee.
  ---------------------------------------------------------------------------

  select count(*)
  into v_count
  from public.store_technical_visit_post_visit_decisions decision_row
  where decision_row.organization_id =
        v_opportunity.organization_id
    and decision_row.store_id =
        v_opportunity.store_id
    and decision_row.appointment_id =
        v_appointment_id;

  insert into p975_decision_results
  values (
    '26 exactly eight decision records',
    v_count = 8,
    v_count::text
  );

  insert into p975_decision_results
  select
    '27 no negotiation decision',
    count(*) = 0,
    count(*)::text
  from public.store_technical_visit_post_visit_decisions decision_row
  where decision_row.organization_id =
        v_opportunity.organization_id
    and decision_row.store_id =
        v_opportunity.store_id
    and decision_row.appointment_id =
        v_appointment_id
    and decision_row.decision_kind =
        'negotiation';

  insert into p975_decision_results
  select
    '28 all consequences remain unexecuted',

    count(*) = 8

    and count(*) filter (
      where decision_row.effects_executed is false
        and decision_row.execution_status =
            'not_executed'
        and decision_row.decision_basis
              ->> 'effects_executed' =
            'false'
    ) = 8,

    pg_catalog.format(
      'rows=%s unexecuted=%s',
      count(*),
      count(*) filter (
        where decision_row.effects_executed is false
          and decision_row.execution_status =
              'not_executed'
          and decision_row.decision_basis
                ->> 'effects_executed' =
              'false'
      )
    )

  from public.store_technical_visit_post_visit_decisions decision_row
  where decision_row.organization_id =
        v_opportunity.organization_id
    and decision_row.store_id =
        v_opportunity.store_id
    and decision_row.appointment_id =
        v_appointment_id;

  insert into p975_decision_results
  values (
    '29 opportunity stage unchanged',

    (
      select opportunity_row.stage
      from public.commercial_opportunities opportunity_row
      where opportunity_row.id =
            v_opportunity.id
    ) = v_stage_before,

    pg_catalog.format(
      'before=%s after=%s',
      v_stage_before,
      (
        select opportunity_row.stage
        from public.commercial_opportunities opportunity_row
        where opportunity_row.id =
              v_opportunity.id
      )
    )
  );

  insert into p975_decision_results
  values (
    '30 no quote created',

    (
      select count(*)
      from public.sales_quotes quote_row
      where quote_row.commercial_opportunity_id =
            v_opportunity.id
    ) = v_quote_count_before,

    pg_catalog.format(
      'before=%s after=%s',
      v_quote_count_before,
      (
        select count(*)
        from public.sales_quotes quote_row
        where quote_row.commercial_opportunity_id =
              v_opportunity.id
      )
    )
  );

  insert into p975_decision_results
  values (
    '31 no appointment created by decision',

    (
      select count(*)
      from public.store_appointments appointment_row
      where appointment_row.commercial_opportunity_id =
            v_opportunity.id
    ) = v_appointment_count_before,

    pg_catalog.format(
      'before=%s after=%s',
      v_appointment_count_before,
      (
        select count(*)
        from public.store_appointments appointment_row
        where appointment_row.commercial_opportunity_id =
              v_opportunity.id
      )
    )
  );

  insert into p975_decision_results
  values (
    '32 no followup created or activated by decision',

    (
      select count(*)
      from public.schedule_post_appointment_followups followup_row
      where followup_row.appointment_id =
            v_appointment_id
    ) = v_followup_count_before

    and (
      select followup_row.followup_status
      from public.schedule_post_appointment_followups followup_row
      where followup_row.id =
            v_followup_id
    ) = 'prompt_sent',

    pg_catalog.format(
      'count=%s status=%s',
      (
        select count(*)
        from public.schedule_post_appointment_followups followup_row
        where followup_row.appointment_id =
              v_appointment_id
      ),
      (
        select followup_row.followup_status
        from public.schedule_post_appointment_followups followup_row
        where followup_row.id =
              v_followup_id
      )
    )
  );

end;
$runner$;

do $count$
declare
  v_total integer;
begin
  select count(*)
  into v_total
  from p975_decision_results;

  if v_total <> 33 then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'P975 decision runner scenario count mismatch: expected 33, got %s',
        v_total
      );
  end if;
end;
$count$;

select
  scenario,
  passed,
  detail
from p975_decision_results
order by scenario;

do $fail$
declare
  v_failed integer;
  v_failure_detail text;
begin
  select
    count(*),
    pg_catalog.string_agg(
      pg_catalog.format('%s => %s', scenario, detail),
      ' | ' order by scenario
    )
  into v_failed, v_failure_detail
  from p975_decision_results
  where passed is not true;

  if v_failed > 0 then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'P975 decision runner failed: %s scenario(s): %s',
        v_failed,
        coalesce(v_failure_detail, '<missing detail>')
      );
  end if;
end;
$fail$;

rollback;