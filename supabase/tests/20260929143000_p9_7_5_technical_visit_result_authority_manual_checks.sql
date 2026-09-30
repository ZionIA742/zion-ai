-- P9 / Bloco 7 / Etapa 7.5
-- Canonical technical-visit result authority rollback runner.
-- Execute only in an explicitly selected DEV database.
-- This runner NEVER commits.

begin;

create temp table p975_results (
  scenario text primary key,
  passed boolean not null,
  detail text not null
) on commit drop;

do $runner$
declare
  v_run text := replace(gen_random_uuid()::text, '-', '');

  v_org uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_opportunity uuid := gen_random_uuid();
  v_responsible uuid := gen_random_uuid();
  v_appointment uuid := gen_random_uuid();
  v_followup uuid := gen_random_uuid();

  v_r1 uuid := gen_random_uuid();
  v_r2 uuid := gen_random_uuid();
  v_r3 uuid := gen_random_uuid();
  v_r4 uuid := gen_random_uuid();
  v_r5 uuid := gen_random_uuid();
  v_r6 uuid := gen_random_uuid();
  v_r7 uuid := gen_random_uuid();

  v_first jsonb;
  v_replay jsonb;
  v_second jsonb;
  v_adjusted jsonb;
  v_pending jsonb;
  v_no_show jsonb;

  v_event1 uuid;
  v_event2 uuid;
  v_event3 uuid;
  v_event4 uuid;
  v_event5 uuid;

  v_count integer;
  v_stage_before text;
begin
  ---------------------------------------------------------------------------
  -- Fixture
  ---------------------------------------------------------------------------

  insert into public.organizations(id, name)
  values (v_org, 'P975 runner ' || v_run);

  insert into public.stores(id, organization_id, name)
  values (v_store, v_org, 'P975 store ' || v_run);

  insert into public.customers(
    id,
    organization_id,
    display_name,
    normalized_name
  )
  values (
    v_customer,
    v_org,
    'P975 customer',
    'p975 customer'
  );

  insert into public.commercial_opportunities(
    id,
    organization_id,
    store_id,
    customer_id,
    stage
  )
  values (
    v_opportunity,
    v_org,
    v_store,
    v_customer,
    'negociacao'
  );

  select stage
    into v_stage_before
    from public.commercial_opportunities
   where id = v_opportunity;

  insert into public.store_responsibles(
    id,
    organization_id,
    store_id,
    name,
    whatsapp_number,
    role,
    is_primary,
    is_active
  )
  values (
    v_responsible,
    v_org,
    v_store,
    'P975 responsible',
    '55119' || substring(v_run from 1 for 8),
    'owner',
    true,
    true
  );

  insert into public.store_appointments(
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
    v_appointment,
    v_org,
    v_store,
    'P975 technical visit',
    'technical_visit',
    'scheduled',
    clock_timestamp() - interval '2 hours',
    clock_timestamp() - interval '1 hour',
    'system',
    v_opportunity,
    1
  );

  insert into public.schedule_post_appointment_followups(
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
    v_followup,
    v_org,
    v_store,
    v_appointment,
    clock_timestamp() - interval '1 hour',
    'prompt_sent',
    'unknown',
    1
  );

  insert into public.schedule_post_appointment_followup_responses(
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
    v_org,
    v_store,
    v_followup,
    v_appointment,
    v_responsible,
    'P975-R1-' || v_run,
    null,
    'single_open_obligation',
    'Fui ao local e ficou viavel.',
    '{}'::jsonb,
    clock_timestamp()
  ),
  (
    v_r2,
    v_org,
    v_store,
    v_followup,
    v_appointment,
    v_responsible,
    'P975-R2-' || v_run,
    null,
    'single_open_obligation',
    'Fui ao local novamente e continua viavel.',
    '{}'::jsonb,
    clock_timestamp()
  ),
  (
    v_r3,
    v_org,
    v_store,
    v_followup,
    v_appointment,
    v_responsible,
    'P975-R3-' || v_run,
    null,
    'single_open_obligation',
    'Durante a visita ficou viavel com reforco na base.',
    '{}'::jsonb,
    clock_timestamp()
  ),
  (
    v_r4,
    v_org,
    v_store,
    v_followup,
    v_appointment,
    v_responsible,
    'P975-R4-' || v_run,
    null,
    'single_open_obligation',
    'Precisa confirmar a medida do acesso.',
    '{}'::jsonb,
    clock_timestamp()
  ),
  (
    v_r5,
    v_org,
    v_store,
    v_followup,
    v_appointment,
    v_responsible,
    'P975-R5-' || v_run,
    null,
    'single_open_obligation',
    'Nao fui ao local porque o cliente nao estava.',
    '{}'::jsonb,
    clock_timestamp()
  ),
  (
    v_r6,
    v_org,
    v_store,
    v_followup,
    v_appointment,
    v_responsible,
    'P975-R6-' || v_run,
    null,
    'single_open_obligation',
    'Fui ao local e ficou viavel.',
    '{}'::jsonb,
    clock_timestamp()
  ),
  (
    v_r7,
    v_org,
    v_store,
    null,
    null,
    v_responsible,
    'P975-R7-' || v_run,
    null,
    'ambiguous_or_unmatched',
    'Fui ao local e ficou viavel.',
    '{}'::jsonb,
    clock_timestamp()
  );

  ---------------------------------------------------------------------------
  -- Authorization
  ---------------------------------------------------------------------------

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);

  begin
    perform public.persist_post_technical_visit_result_by_system(
      v_r1,
      'viable',
      'ficou viavel',
      null,
      null,
      'occurred',
      'Fui ao local',
      'p975:unauthorized',
      '{}'::jsonb
    );

    insert into p975_results
    values (
      '01 authenticated writer blocked',
      false,
      'writer unexpectedly accepted authenticated'
    );
  exception
    when others then
      insert into p975_results
      values (
        '01 authenticated writer blocked',
        sqlstate = '42501'
          and sqlerrm = 'ZION_P9_7_5_RESULT_WRITER_NOT_AUTHORIZED',
        sqlstate || ' / ' || sqlerrm
      );
  end;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  ---------------------------------------------------------------------------
  -- Missing / uncorrelated source
  ---------------------------------------------------------------------------

  begin
    perform public.persist_post_technical_visit_result_by_system(
      gen_random_uuid(),
      'viable',
      'ficou viavel',
      null,
      null,
      'occurred',
      'Fui ao local',
      'p975:missing-source',
      '{}'::jsonb
    );

    insert into p975_results
    values (
      '02 missing response blocked',
      false,
      'missing response unexpectedly accepted'
    );
  exception
    when others then
      insert into p975_results
      values (
        '02 missing response blocked',
        sqlstate = '23503'
          and sqlerrm = 'ZION_P9_7_5_SOURCE_RESPONSE_NOT_FOUND',
        sqlstate || ' / ' || sqlerrm
      );
  end;

  begin
    perform public.persist_post_technical_visit_result_by_system(
      v_r7,
      'viable',
      'ficou viavel',
      null,
      null,
      'occurred',
      'Fui ao local',
      'p975:uncorrelated',
      '{}'::jsonb
    );

    insert into p975_results
    values (
      '03 uncorrelated response blocked',
      false,
      'uncorrelated response unexpectedly accepted'
    );
  exception
    when others then
      insert into p975_results
      values (
        '03 uncorrelated response blocked',
        sqlstate = '23514'
          and sqlerrm = 'ZION_P9_7_5_SOURCE_RESPONSE_NOT_CORRELATED',
        sqlstate || ' / ' || sqlerrm
      );
  end;

  ---------------------------------------------------------------------------
  -- First canonical event
  ---------------------------------------------------------------------------

  select to_jsonb(x)
    into v_first
    from public.persist_post_technical_visit_result_by_system(
      v_r1,
      'viable',
      'ficou viavel',
      null,
      null,
      'occurred',
      'Fui ao local',
      'p975:event:1',
      '{}'::jsonb
    ) x;

  v_event1 := (v_first ->> 'event_id')::uuid;

  insert into p975_results
  values (
    '04 first viable materializes event 1',
    (v_first ->> 'event_number')::integer = 1
      and (v_first ->> 'replayed')::boolean = false
      and (v_first ->> 'current_result_event_id')::uuid = v_event1
      and exists (
        select 1
          from public.store_technical_visit_result_events e
         where e.id = v_event1
           and e.organization_id = v_org
           and e.store_id = v_store
           and e.appointment_id = v_appointment
           and e.followup_id = v_followup
           and e.commercial_opportunity_id = v_opportunity
           and e.lifecycle_cycle = 1
           and e.source_response_id = v_r1
           and e.responsible_id = v_responsible
           and e.result_kind = 'viable'
           and e.evidence_text = 'ficou viavel'
           and e.occurrence = 'occurred'
           and e.occurrence_evidence_text = 'Fui ao local'
      ),
    coalesce(v_first::text, 'null')
  );

  ---------------------------------------------------------------------------
  -- Idempotency
  ---------------------------------------------------------------------------

  select to_jsonb(x)
    into v_replay
    from public.persist_post_technical_visit_result_by_system(
      v_r1,
      'viable',
      'ficou viavel',
      null,
      null,
      'occurred',
      'Fui ao local',
      'p975:event:1',
      '{}'::jsonb
    ) x;

  select count(*)
    into v_count
    from public.store_technical_visit_result_events
   where organization_id = v_org
     and store_id = v_store
     and appointment_id = v_appointment
     and source_response_id = v_r1;

  insert into p975_results
  values (
    '05 identical replay is idempotent',
    (v_replay ->> 'event_id')::uuid = v_event1
      and (v_replay ->> 'event_number')::integer = 1
      and (v_replay ->> 'replayed')::boolean = true
      and v_count = 1,
    coalesce(v_replay::text, 'null') || ' / count=' || v_count::text
  );

  ---------------------------------------------------------------------------
  -- Incompatible replay / same source different operation
  ---------------------------------------------------------------------------

  begin
    perform public.persist_post_technical_visit_result_by_system(
      v_r1,
      'viable',
      'ficou viavel',
      null,
      null,
      'occurred',
      'Fui ao local',
      'p975:event:1',
      '{"different":true}'::jsonb
    );

    insert into p975_results
    values (
      '06 incompatible replay blocked',
      false,
      'incompatible replay unexpectedly accepted'
    );
  exception
    when others then
      insert into p975_results
      values (
        '06 incompatible replay blocked',
        sqlstate = '23505'
          and sqlerrm = 'ZION_P9_7_5_INCOMPATIBLE_OPERATION_REPLAY',
        sqlstate || ' / ' || sqlerrm
      );
  end;

  begin
    perform public.persist_post_technical_visit_result_by_system(
      v_r1,
      'viable',
      'ficou viavel',
      null,
      null,
      'occurred',
      'Fui ao local',
      'p975:event:1:different-key',
      '{}'::jsonb
    );

    insert into p975_results
    values (
      '07 one source response materializes once',
      false,
      'same source with different operation unexpectedly accepted'
    );
  exception
    when others then
      insert into p975_results
      values (
        '07 one source response materializes once',
        sqlstate = '23505'
          and sqlerrm = 'ZION_P9_7_5_SOURCE_RESPONSE_ALREADY_MATERIALIZED',
        sqlstate || ' / ' || sqlerrm
      );
  end;

  ---------------------------------------------------------------------------
  -- Second event / append-only chain
  ---------------------------------------------------------------------------

  select to_jsonb(x)
    into v_second
    from public.persist_post_technical_visit_result_by_system(
      v_r2,
      'viable',
      'continua viavel',
      null,
      null,
      'occurred',
      'Fui ao local novamente',
      'p975:event:2',
      '{}'::jsonb
    ) x;

  v_event2 := (v_second ->> 'event_id')::uuid;

  insert into p975_results
  values (
    '08 second response advances chain',
    (v_second ->> 'event_number')::integer = 2
      and exists (
        select 1
          from public.store_technical_visit_result_events e
         where e.id = v_event2
           and e.previous_result_event_id = v_event1
      )
      and exists (
        select 1
          from public.store_technical_visit_result_current c
         where c.organization_id = v_org
           and c.store_id = v_store
           and c.appointment_id = v_appointment
           and c.current_result_event_id = v_event2
           and c.last_operation_key = 'p975:event:2'
      ),
    coalesce(v_second::text, 'null')
  );

  ---------------------------------------------------------------------------
  -- Obsolete operation replay
  ---------------------------------------------------------------------------

  begin
    perform public.persist_post_technical_visit_result_by_system(
      v_r1,
      'viable',
      'ficou viavel',
      null,
      null,
      'occurred',
      'Fui ao local',
      'p975:event:1',
      '{}'::jsonb
    );

    insert into p975_results
    values (
      '09 obsolete operation replay blocked',
      false,
      'obsolete replay unexpectedly accepted'
    );
  exception
    when others then
      insert into p975_results
      values (
        '09 obsolete operation replay blocked',
        sqlstate = '40001'
          and sqlerrm = 'ZION_P9_7_5_OBSOLETE_OPERATION_REPLAY',
        sqlstate || ' / ' || sqlerrm
      );
  end;

  ---------------------------------------------------------------------------
  -- Viable with adjustments
  ---------------------------------------------------------------------------

  select to_jsonb(x)
    into v_adjusted
    from public.persist_post_technical_visit_result_by_system(
      v_r3,
      'viable_with_adjustments',
      'ficou viavel com reforco',
      'reforco na base',
      null,
      'occurred',
      'Durante a visita',
      'p975:event:3',
      '{}'::jsonb
    ) x;

  v_event3 := (v_adjusted ->> 'event_id')::uuid;

  insert into p975_results
  values (
    '10 viable with adjustments preserves adjustment',
    (v_adjusted ->> 'event_number')::integer = 3
      and exists (
        select 1
          from public.store_technical_visit_result_events e
         where e.id = v_event3
           and e.previous_result_event_id = v_event2
           and e.result_kind = 'viable_with_adjustments'
           and e.adjustment_summary = 'reforco na base'
      ),
    coalesce(v_adjusted::text, 'null')
  );

  ---------------------------------------------------------------------------
  -- Pending does not imply occurrence
  ---------------------------------------------------------------------------

  select to_jsonb(x)
    into v_pending
    from public.persist_post_technical_visit_result_by_system(
      v_r4,
      'pending',
      'confirmar a medida',
      null,
      'aguarda confirmacao tecnica',
      'unclear',
      null,
      'p975:event:4',
      '{}'::jsonb
    ) x;

  v_event4 := (v_pending ->> 'event_id')::uuid;

  insert into p975_results
  values (
    '11 pending accepts unclear occurrence',
    (v_pending ->> 'event_number')::integer = 4
      and exists (
        select 1
          from public.store_technical_visit_result_events e
         where e.id = v_event4
           and e.result_kind = 'pending'
           and e.occurrence = 'unclear'
           and e.occurrence_evidence_text is null
      ),
    coalesce(v_pending::text, 'null')
  );

  ---------------------------------------------------------------------------
  -- Explicit did-not-occur has no technical result
  ---------------------------------------------------------------------------

  select to_jsonb(x)
    into v_no_show
    from public.persist_post_technical_visit_result_by_system(
      v_r5,
      null,
      null,
      null,
      'visita nao ocorreu',
      'did_not_occur',
      'Nao fui ao local',
      'p975:event:5',
      '{}'::jsonb
    ) x;

  v_event5 := (v_no_show ->> 'event_id')::uuid;

  insert into p975_results
  values (
    '12 did not occur persists without technical result',
    (v_no_show ->> 'event_number')::integer = 5
      and exists (
        select 1
          from public.store_technical_visit_result_events e
         where e.id = v_event5
           and e.result_kind is null
           and e.evidence_text is null
           and e.adjustment_summary is null
           and e.occurrence = 'did_not_occur'
           and e.occurrence_evidence_text = 'Nao fui ao local'
      ),
    coalesce(v_no_show::text, 'null')
  );

  ---------------------------------------------------------------------------
  -- Semantic fail-closed checks
  ---------------------------------------------------------------------------

  begin
    perform public.persist_post_technical_visit_result_by_system(
      v_r6,
      'viable',
      'ficou viavel',
      null,
      null,
      'unclear',
      null,
      'p975:invalid:conclusive-unclear',
      '{}'::jsonb
    );

    insert into p975_results
    values (
      '13 conclusive result requires occurred',
      false,
      'conclusive result with unclear occurrence unexpectedly accepted'
    );
  exception
    when others then
      insert into p975_results
      values (
        '13 conclusive result requires occurred',
        sqlstate = '23514'
          and sqlerrm = 'ZION_P9_7_5_CONCLUSIVE_RESULT_REQUIRES_OCCURRED',
        sqlstate || ' / ' || sqlerrm
      );
  end;

  begin
    perform public.persist_post_technical_visit_result_by_system(
      v_r6,
      'viable',
      'ficou viavel',
      null,
      null,
      'did_not_occur',
      'Fui ao local',
      'p975:invalid:no-show-result',
      '{}'::jsonb
    );

    insert into p975_results
    values (
      '14 did not occur cannot carry result',
      false,
      'did_not_occur with result unexpectedly accepted'
    );
  exception
    when others then
      insert into p975_results
      values (
        '14 did not occur cannot carry result',
        sqlstate = '23514'
          and sqlerrm = 'ZION_P9_7_5_DID_NOT_OCCUR_CANNOT_HAVE_RESULT',
        sqlstate || ' / ' || sqlerrm
      );
  end;

  begin
    perform public.persist_post_technical_visit_result_by_system(
      v_r6,
      'viable',
      null,
      null,
      null,
      'occurred',
      'Fui ao local',
      'p975:invalid:missing-result-evidence',
      '{}'::jsonb
    );

    insert into p975_results
    values (
      '15 result evidence required',
      false,
      'result without evidence unexpectedly accepted'
    );
  exception
    when others then
      insert into p975_results
      values (
        '15 result evidence required',
        sqlstate = '23514'
          and sqlerrm = 'ZION_P9_7_5_RESULT_EVIDENCE_REQUIRED',
        sqlstate || ' / ' || sqlerrm
      );
  end;

  begin
    perform public.persist_post_technical_visit_result_by_system(
      v_r6,
      'viable_with_adjustments',
      'ficou viavel',
      null,
      null,
      'occurred',
      'Fui ao local',
      'p975:invalid:missing-adjustment',
      '{}'::jsonb
    );

    insert into p975_results
    values (
      '16 adjustment summary required',
      false,
      'adjusted viable without adjustment unexpectedly accepted'
    );
  exception
    when others then
      insert into p975_results
      values (
        '16 adjustment summary required',
        sqlstate = '23514'
          and sqlerrm = 'ZION_P9_7_5_ADJUSTMENT_SUMMARY_REQUIRED',
        sqlstate || ' / ' || sqlerrm
      );
  end;

  ---------------------------------------------------------------------------
  -- Persisted source must literally contain extracted evidence
  ---------------------------------------------------------------------------

  begin
    perform public.persist_post_technical_visit_result_by_system(
      v_r6,
      'viable',
      'texto que nao existe',
      null,
      null,
      'occurred',
      'Fui ao local',
      'p975:invalid:invented-result-evidence',
      '{}'::jsonb
    );

    insert into p975_results
    values (
      '17 invented result evidence blocked',
      false,
      'invented result evidence unexpectedly accepted'
    );
  exception
    when others then
      insert into p975_results
      values (
        '17 invented result evidence blocked',
        sqlstate = '23514',
        sqlstate || ' / ' || sqlerrm
      );
  end;

  begin
    perform public.persist_post_technical_visit_result_by_system(
      v_r6,
      'viable',
      'ficou viavel',
      null,
      null,
      'occurred',
      'evidencia de ocorrencia inventada',
      'p975:invalid:invented-occurrence-evidence',
      '{}'::jsonb
    );

    insert into p975_results
    values (
      '18 invented occurrence evidence blocked',
      false,
      'invented occurrence evidence unexpectedly accepted'
    );
  exception
    when others then
      insert into p975_results
      values (
        '18 invented occurrence evidence blocked',
        sqlstate = '23514',
        sqlstate || ' / ' || sqlerrm
      );
  end;

  begin
    perform public.persist_post_technical_visit_result_by_system(
      v_r6,
      'viable_with_adjustments',
      'ficou viavel',
      'ajuste inventado',
      null,
      'occurred',
      'Fui ao local',
      'p975:invalid:invented-adjustment',
      '{}'::jsonb
    );

    insert into p975_results
    values (
      '19 invented adjustment blocked',
      false,
      'invented adjustment unexpectedly accepted'
    );
  exception
    when others then
      insert into p975_results
      values (
        '19 invented adjustment blocked',
        sqlstate = '23514',
        sqlstate || ' / ' || sqlerrm
      );
  end;

  ---------------------------------------------------------------------------
  -- Canonical chain / boundary assertions
  ---------------------------------------------------------------------------

  select count(*)
    into v_count
    from public.store_technical_visit_result_events
   where organization_id = v_org
     and store_id = v_store
     and appointment_id = v_appointment;

  insert into p975_results
  values (
    '20 canonical chain has exactly five accepted events',
    v_count = 5
      and exists (
        select 1
          from public.store_technical_visit_result_current c
         where c.organization_id = v_org
           and c.store_id = v_store
           and c.appointment_id = v_appointment
           and c.current_result_event_id = v_event5
           and c.last_operation_key = 'p975:event:5'
      ),
    'count=' || v_count::text
  );

  insert into p975_results
  values (
    '21 fingerprints are sha256 hex',
    not exists (
      select 1
        from public.store_technical_visit_result_events e
       where e.organization_id = v_org
         and e.store_id = v_store
         and e.appointment_id = v_appointment
         and e.request_fingerprint !~ '^[0-9a-f]{64}$'
    ),
    'fingerprints'
  );

  insert into p975_results
  values (
    '22 writer does not mutate opportunity stage',
    (
      select o.stage
        from public.commercial_opportunities o
       where o.id = v_opportunity
    ) = v_stage_before,
    'stage=' || (
      select o.stage
        from public.commercial_opportunities o
       where o.id = v_opportunity
    )
  );

  insert into p975_results
  values (
    '23 writer does not resolve followup',
    exists (
      select 1
        from public.schedule_post_appointment_followups f
       where f.id = v_followup
         and f.followup_status = 'prompt_sent'
         and f.resolved_at is null
         and f.resolution is null
    ),
    'followup boundary'
  );

  insert into p975_results
  values (
    '24 writer does not create completion authority',
    not exists (
      select 1
        from public.store_appointment_completion_events e
       where e.organization_id = v_org
         and e.store_id = v_store
         and e.appointment_id = v_appointment
    ),
    'completion boundary'
  );

  ---------------------------------------------------------------------------
  -- Append-only protection
  ---------------------------------------------------------------------------

  begin
    update public.store_technical_visit_result_events
       set metadata = metadata
     where id = v_event1;

    insert into p975_results
    values (
      '25 result event update blocked',
      false,
      'event update unexpectedly accepted'
    );
  exception
    when others then
      insert into p975_results
      values (
        '25 result event update blocked',
        position('APPEND_ONLY' in sqlerrm) > 0,
        sqlstate || ' / ' || sqlerrm
      );
  end;

  begin
    delete from public.store_technical_visit_result_events
     where id = v_event1;

    insert into p975_results
    values (
      '26 result event delete blocked',
      false,
      'event delete unexpectedly accepted'
    );
  exception
    when others then
      insert into p975_results
      values (
        '26 result event delete blocked',
        position('APPEND_ONLY' in sqlerrm) > 0,
        sqlstate || ' / ' || sqlerrm
      );
  end;
end
$runner$;

-------------------------------------------------------------------------------
-- RLS / ACL surface
-------------------------------------------------------------------------------

insert into p975_results values
(
  '27 events RLS enabled',
  (
    select c.relrowsecurity
      from pg_catalog.pg_class c
     where c.oid = 'public.store_technical_visit_result_events'::regclass
  ),
  'RLS'
),
(
  '28 current RLS enabled',
  (
    select c.relrowsecurity
      from pg_catalog.pg_class c
     where c.oid = 'public.store_technical_visit_result_current'::regclass
  ),
  'RLS'
),
(
  '29 writer only service role',
  has_function_privilege(
    'service_role',
    'public.persist_post_technical_visit_result_by_system(uuid,text,text,text,text,text,text,text,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.persist_post_technical_visit_result_by_system(uuid,text,text,text,text,text,text,text,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.persist_post_technical_visit_result_by_system(uuid,text,text,text,text,text,text,text,jsonb)',
    'EXECUTE'
  ),
  'function ACL'
),
(
  '30 service role cannot insert events directly',
  not has_table_privilege(
    'service_role',
    'public.store_technical_visit_result_events',
    'INSERT'
  ),
  'minimum grant'
),
(
  '31 service role cannot update current directly',
  not has_table_privilege(
    'service_role',
    'public.store_technical_visit_result_current',
    'UPDATE'
  ),
  'minimum grant'
);

-------------------------------------------------------------------------------
-- Gate
-------------------------------------------------------------------------------

do $assert$
declare
  r record;
begin
  for r in
    select *
      from p975_results
     order by scenario
  loop
    if not r.passed then
      raise exception
        'P975-FAIL [%] %',
        r.scenario,
        r.detail;
    end if;
  end loop;
end
$assert$;

select *
from p975_results
order by scenario;

rollback;

-- Concurrency is intentionally NOT claimed by this single-session runner.
-- A separate two-session runtime test must prove serialization for concurrent
-- materialization of the same appointment.