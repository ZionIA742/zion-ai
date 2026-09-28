-- P9 / Bloco 7 / Etapa 7.3
-- Behavioral rollback-only harness. Run only in an isolated database session.
begin;

create temp table p97_results (
  scenario text primary key,
  passed boolean not null,
  detail text not null
) on commit drop;

do $setup$
declare
  v_run text := replace(gen_random_uuid()::text, '-', '');
  v_org uuid := gen_random_uuid();
  v_other_org uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_other_store uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_other_user uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_appointment uuid := gen_random_uuid();
  v_overlap uuid := gen_random_uuid();
  v_daily_second uuid := gen_random_uuid();
  v_opportunity uuid := gen_random_uuid();
  v_stage_before text;
  v_error text;
  v_result boolean;
  v_updated public.store_appointments;
  v_original_start timestamptz;
  v_block uuid := gen_random_uuid();
  v_holiday_block uuid := gen_random_uuid();
  v_reason text;
  v_installation_status text;
  v_start timestamptz := '2026-01-15 14:00:00+00';
begin
  insert into public.organizations (id, name) values
    (v_org, 'P97 runner ' || v_run), (v_other_org, 'P97 other ' || v_run);
  insert into public.stores (id, organization_id, name) values
    (v_store, v_org, 'P97 store ' || v_run), (v_other_store, v_other_org, 'P97 other store ' || v_run);
  insert into auth.users (id) values (v_user), (v_other_user);
  insert into public.memberships (organization_id, user_id, role, is_active) values
    (v_org, v_user, 'owner', true), (v_other_org, v_other_user, 'owner', true);
  insert into public.customers (id, organization_id, display_name, normalized_name) values (v_customer, v_org, 'P97 customer', 'p97 customer');
  insert into public.commercial_opportunities (id, organization_id, store_id, customer_id, stage)
  values (v_opportunity, v_org, v_store, v_customer, 'negociacao');
  insert into public.store_schedule_settings (
    organization_id, store_id, allow_multiple_appointments_per_day,
    allow_same_time_appointments, same_time_capacity, attends_holidays,
    enforce_operating_window, operating_days, operating_hours,
    installation_days, technical_visit_days, timezone_name,
    agenda_capacity_configured_at, daily_limit_mode, daily_limit,
    appointment_buffer_enabled, appointment_buffer_minutes
  ) values (
    v_org, v_store, false, false, 1, false, false,
    '["segunda","terca","quarta","quinta","sexta","sabado","domingo"]'::jsonb,
    '{"quinta":{"start":"00:00","end":"23:59"}}'::jsonb,
    '[]'::jsonb, null, 'America/New_York', null, null, null, null, null
  );
  insert into public.store_appointments (
    id, organization_id, store_id, title, appointment_type, status,
    scheduled_start, scheduled_end, source,
    commercial_opportunity_id, commercial_opportunity_lifecycle_cycle
  ) values (
    v_appointment, v_org, v_store, 'P97 appointment', 'meeting', 'scheduled',
    v_start, v_start + interval '1 hour', 'panel',
    v_opportunity,
    (select lifecycle_cycle from public.commercial_opportunities where id = v_opportunity)
  );

  -- Cancel boundary: authenticated member, cross-tenant rejection and service role.
  set local role authenticated;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  begin
    perform public.cancel_store_appointment(v_appointment, v_org, v_store, 'runner authenticated');
    set local role postgres;
    perform set_config('request.jwt.claim.role', '', true);
    insert into p97_results values ('cancel authenticated member', true, 'authorized');
  exception when others then
    set local role postgres;
    perform set_config('request.jwt.claim.role', '', true);
    insert into p97_results values ('cancel authenticated member', false, sqlerrm);
  end;

  update public.store_appointments set status = 'scheduled' where id = v_appointment;

  set local role service_role;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  begin
    perform public.cancel_store_appointment(v_appointment, v_org, v_store, 'runner service role');
    set local role postgres;
    perform set_config('request.jwt.claim.role', '', true);
    insert into p97_results values ('cancel service_role', true, 'authorized');
  exception when others then
    set local role postgres;
    perform set_config('request.jwt.claim.role', '', true);
    insert into p97_results values ('cancel service_role', false, sqlerrm);
  end;

  update public.store_appointments set status = 'scheduled' where id = v_appointment;

  set local role authenticated;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_other_user::text, true);
  begin
    perform public.cancel_store_appointment(v_appointment, v_org, v_store, 'cross tenant');
    set local role postgres;
    perform set_config('request.jwt.claim.role', '', true);
    insert into p97_results values ('cancel authenticated cross tenant', false, 'unexpected authorization');
  exception when others then
    set local role postgres;
    perform set_config('request.jwt.claim.role', '', true);
    insert into p97_results values ('cancel authenticated cross tenant', true, sqlerrm);
  end;
  set local role authenticated;
  begin
    update public.store_appointments set notes = 'direct update must fail' where id = v_appointment;
    set local role postgres;
    insert into p97_results values ('direct UPDATE denied', false, 'unexpected direct write');
  exception when others then
    set local role postgres;
    insert into p97_results values ('direct UPDATE denied', true, sqlerrm);
  end;
  set local role postgres;

  set local role service_role;
  begin
    update public.store_appointments set notes = 'service role direct update must fail' where id = v_appointment;
    set local role postgres;
    insert into p97_results values ('service_role direct UPDATE denied', false, 'unexpected direct write');
  exception when others then
    set local role postgres;
    insert into p97_results values ('service_role direct UPDATE denied', true, sqlerrm);
  end;

  update public.store_appointments set status = 'completed' where id = v_appointment;
  begin
    perform public.cancel_store_appointment(v_appointment, v_org, v_store, 'completed');
    insert into p97_results values ('completed cannot cancel', false, 'unexpected cancellation');
  exception when others then
    insert into p97_results values ('completed cannot cancel', true, sqlerrm);
  end;
  update public.store_appointments set status = 'scheduled' where id = v_appointment;
  select stage into v_stage_before from public.commercial_opportunities where id = v_opportunity;
  perform public.cancel_store_appointment(v_appointment, v_org, v_store, 'stage invariant');
  if (select stage from public.commercial_opportunities where id = v_opportunity) = v_stage_before then
    insert into p97_results values ('cancel does not change opportunity stage', true, v_stage_before);
  else
    insert into p97_results values ('cancel does not change opportunity stage', false, 'stage changed');
  end if;

  -- Modern capacity and timezone cases.
  update public.store_schedule_settings set
    timezone_name = 'America/New_York', agenda_capacity_configured_at = clock_timestamp(),
    daily_limit_mode = 'fixed_limit', daily_limit = 2,
    appointment_buffer_enabled = false, appointment_buffer_minutes = null,
    allow_multiple_appointments_per_day = true, allow_same_time_appointments = false, same_time_capacity = 1
  where organization_id = v_org and store_id = v_store;

  update public.store_appointments
  set status = 'scheduled',
      scheduled_start = v_start,
      scheduled_end = v_start + interval '1 hour'
  where id = v_appointment;

  insert into public.store_appointments (
    id, organization_id, store_id, title, appointment_type, status,
    scheduled_start, scheduled_end, source
  ) values (
    v_daily_second, v_org, v_store, 'P97 daily limit second', 'meeting', 'scheduled',
    v_start + interval '4 hour', v_start + interval '5 hour', 'panel'
  );

  select public.has_store_appointment_conflict(
    v_org, v_store, v_start + interval '2 hour', v_start + interval '3 hour', null
  ) into v_result;
  insert into p97_results values (
    'fixed_limit blocks at daily_limit',
    v_result,
    coalesce(v_result::text, 'false')
  );

  -- 2026-01-16 03:30Z is Jan 15 in New York but Jan 16 in Sao Paulo.
  -- Both active fixtures belong to Jan 15 in the STORE timezone, so a third
  -- appointment at this instant must be blocked by daily_limit=2.
  select public.has_store_appointment_conflict(
    v_org, v_store, '2026-01-16 03:30:00+00', '2026-01-16 04:00:00+00', null
  ) into v_result;
  insert into p97_results values (
    'store timezone controls daily_limit local day',
    v_result,
    coalesce(v_result::text, 'false')
  );

  delete from public.store_appointments where id = v_daily_second;

  update public.store_schedule_settings
  set daily_limit_mode = 'no_fixed_limit',
      daily_limit = null
  where organization_id = v_org and store_id = v_store;
  select public.has_store_appointment_conflict(v_org, v_store, v_start + interval '2 hour', v_start + interval '3 hour', null) into v_result;
  insert into p97_results values ('no_fixed_limit has no daily limit', not v_result, coalesce(v_result::text, 'false'));

  update public.store_schedule_settings set appointment_buffer_enabled = true, appointment_buffer_minutes = 60 where organization_id = v_org and store_id = v_store;
  select public.has_store_appointment_conflict(v_org, v_store, v_start + interval '1 hour 30 minutes', v_start + interval '2 hour 30 minutes', null) into v_result;
  insert into p97_results values ('buffer blocks smaller gap', v_result, coalesce(v_result::text, 'false'));
  select public.has_store_appointment_conflict(v_org, v_store, v_start + interval '2 hour', v_start + interval '3 hour', null) into v_result;
  insert into p97_results values ('buffer exact gap allowed', not v_result, coalesce(v_result::text, 'false'));
  update public.store_schedule_settings set appointment_buffer_enabled = false, appointment_buffer_minutes = null where organization_id = v_org and store_id = v_store;
  select public.has_store_appointment_conflict(v_org, v_store, v_start + interval '1 hour', v_start + interval '2 hour', null) into v_result;
  insert into p97_results values ('buffer disabled allows adjacent', not v_result, coalesce(v_result::text, 'false'));

  update public.store_schedule_settings set daily_limit_mode = 'no_fixed_limit', allow_same_time_appointments = true, same_time_capacity = 2 where organization_id = v_org and store_id = v_store;
  select public.has_store_appointment_conflict(v_org, v_store, v_start, v_start + interval '1 hour', null) into v_result;
  insert into p97_results values ('same_time capacity permits within capacity', not v_result, coalesce(v_result::text, 'false'));
  insert into public.store_appointments (id, organization_id, store_id, title, appointment_type, status, scheduled_start, scheduled_end, source)
  values (v_overlap, v_org, v_store, 'P97 overlap', 'meeting', 'scheduled', v_start, v_start + interval '1 hour', 'panel');
  select public.has_store_appointment_conflict(v_org, v_store, v_start, v_start + interval '1 hour', null) into v_result;
  insert into p97_results values ('same_time additional above capacity blocked', v_result, coalesce(v_result::text, 'false'));
  update public.store_appointments set status = 'cancelled' where id = v_overlap;
  select public.has_store_appointment_conflict(v_org, v_store, v_start, v_start + interval '1 hour', null) into v_result;
  insert into p97_results values ('cancelled does not consume capacity', not v_result, coalesce(v_result::text, 'false'));
  update public.store_appointments set status = 'completed' where id = v_overlap;
  select public.has_store_appointment_conflict(v_org, v_store, v_start, v_start + interval '1 hour', null) into v_result;
  insert into p97_results values ('completed does not consume capacity', not v_result, coalesce(v_result::text, 'false'));

  -- Legacy semantics and specific operating days.
  update public.store_schedule_settings
  set agenda_capacity_configured_at = null,
      daily_limit_mode = null,
      daily_limit = null,
      appointment_buffer_enabled = null,
      appointment_buffer_minutes = null,
      allow_multiple_appointments_per_day = false,
      allow_same_time_appointments = false,
      same_time_capacity = 1
  where organization_id = v_org and store_id = v_store;
  select public.has_store_appointment_conflict(v_org, v_store, v_start + interval '4 hour', v_start + interval '5 hour', null) into v_result;
  insert into p97_results values ('legacy one active appointment per day', v_result, coalesce(v_result::text, 'false'));
  update public.store_schedule_settings set allow_multiple_appointments_per_day = true, allow_same_time_appointments = false where organization_id = v_org and store_id = v_store;
  select public.has_store_appointment_conflict(v_org, v_store, v_start + interval '30 minutes', v_start + interval '90 minutes', null) into v_result;
  insert into p97_results values ('legacy same-time false blocks overlap', v_result, coalesce(v_result::text, 'false'));
  update public.store_schedule_settings set allow_same_time_appointments = true, same_time_capacity = 2 where organization_id = v_org and store_id = v_store;
  select public.has_store_appointment_conflict(v_org, v_store, v_start, v_start + interval '1 hour', null) into v_result;
  insert into p97_results values ('legacy same-time capacity permits N', not v_result, coalesce(v_result::text, 'false'));

  update public.store_schedule_settings set enforce_operating_window = true, operating_days = '["quinta","sexta"]'::jsonb, technical_visit_days = '["quinta"]'::jsonb, installation_days = '["quinta"]'::jsonb, operating_hours = '{"quinta":{"start":"00:00","end":"23:59"},"sexta":{"start":"00:00","end":"23:59"}}'::jsonb where organization_id = v_org and store_id = v_store;
  select public.is_store_appointment_within_operating_window(v_org, v_store, 'technical_visit', '2026-01-15 14:00+00', '2026-01-15 15:00+00') into v_result;
  insert into p97_results values ('technical_visit_days restricts technical_visit', v_result, coalesce(v_result::text, 'false'));
  select public.is_store_appointment_within_operating_window(v_org, v_store, 'technical_visit', '2026-01-16 14:00+00', '2026-01-16 15:00+00') into v_result;
  insert into p97_results values ('technical_visit_days blocks Friday', not v_result, coalesce(v_result::text, 'false'));
  update public.store_schedule_settings set technical_visit_days = null where organization_id = v_org and store_id = v_store;
  select public.is_store_appointment_within_operating_window(v_org, v_store, 'technical_visit', '2026-01-16 14:00+00', '2026-01-16 15:00+00') into v_result;
  insert into p97_results values ('technical_visit_days NULL falls back to operating_days', v_result, coalesce(v_result::text, 'false'));
  update public.store_schedule_settings set technical_visit_days = '[]'::jsonb where organization_id = v_org and store_id = v_store;
  select public.is_store_appointment_within_operating_window(v_org, v_store, 'technical_visit', '2026-01-16 14:00+00', '2026-01-16 15:00+00') into v_result;
  insert into p97_results values ('technical_visit_days empty array blocks', not v_result, coalesce(v_result::text, 'false'));
  update public.store_schedule_settings set technical_visit_days = '["quinta"]'::jsonb where organization_id = v_org and store_id = v_store;
  select public.is_store_appointment_within_operating_window(v_org, v_store, 'installation', '2026-01-15 14:00+00', '2026-01-15 15:00+00') into v_result;
  insert into p97_results values ('installation_days permits Thursday', v_result, coalesce(v_result::text, 'false'));
  select public.is_store_appointment_within_operating_window(v_org, v_store, 'installation', '2026-01-16 14:00+00', '2026-01-16 15:00+00') into v_result;
  insert into p97_results values ('installation_days blocks Friday', not v_result, coalesce(v_result::text, 'false'));
  update public.store_schedule_settings set installation_days = '[]'::jsonb where organization_id = v_org and store_id = v_store;
  select public.is_store_appointment_within_operating_window(v_org, v_store, 'installation', '2026-01-15 14:00+00', '2026-01-15 15:00+00') into v_result;
  insert into p97_results values ('installation_days empty array falls back to operating_days Thursday', v_result, coalesce(v_result::text, 'false'));
  select public.is_store_appointment_within_operating_window(v_org, v_store, 'installation', '2026-01-16 14:00+00', '2026-01-16 15:00+00') into v_result;
  insert into p97_results values ('installation_days empty array falls back to operating_days Friday', v_result, coalesce(v_result::text, 'false'));
  update public.store_schedule_settings set technical_visit_days = '["sexta"]'::jsonb, installation_days = '["sexta"]'::jsonb, operating_days = '["quinta"]'::jsonb where organization_id = v_org and store_id = v_store;
  select public.is_store_appointment_within_operating_window(v_org, v_store, 'technical_visit', '2026-01-16 14:00+00', '2026-01-16 15:00+00') into v_result;
  insert into p97_results values ('operating_days remains external limit', not v_result, coalesce(v_result::text, 'false'));
  select public.is_store_appointment_within_operating_window(v_org, v_store, 'installation', '2026-01-16 14:00+00', '2026-01-16 15:00+00') into v_result;
  insert into p97_results values ('operating_days remains external limit for installation', not v_result, coalesce(v_result::text, 'false'));
  update public.store_schedule_settings set operating_days = '["quinta","sexta"]'::jsonb, technical_visit_days = '["quinta"]'::jsonb, installation_days = '["quinta"]'::jsonb where organization_id = v_org and store_id = v_store;
  select public.is_store_appointment_within_operating_window(v_org, v_store, 'meeting', '2026-01-15 14:00+00', '2026-01-15 15:00+00') into v_result;
  insert into p97_results values ('meeting uses operating_days', v_result, coalesce(v_result::text, 'false'));
  select public.is_store_appointment_within_operating_window(v_org, v_store, 'post_sale', '2026-01-16 14:00+00', '2026-01-16 15:00+00') into v_result;
  insert into p97_results values ('post_sale uses operating_days', v_result, coalesce(v_result::text, 'false'));

  -- Direct operating-window holiday semantics (restored by the final migration).
  update public.store_schedule_settings
  set attends_holidays = false,
      operating_days = '["quinta","sexta"]'::jsonb,
      operating_hours = '{"quinta":{"start":"00:00","end":"23:59"},"sexta":{"start":"00:00","end":"23:59"}}'::jsonb
  where organization_id = v_org and store_id = v_store;

  insert into public.store_schedule_blocks (
    id, organization_id, store_id, title, block_type, start_at, end_at, source, notes
  ) values (
    v_holiday_block, v_org, v_store, 'P97 holiday helper', 'holiday',
    v_start + interval '10 hour', v_start + interval '11 hour',
    'system', 'holiday helper fixture'
  );

  select public.is_store_appointment_within_operating_window(
    v_org, v_store, 'meeting', v_start + interval '10 hour', v_start + interval '11 hour'
  ) into v_result;
  insert into p97_results values (
    'holiday block closes operating window when holidays not attended',
    not v_result,
    coalesce(v_result::text, 'false')
  );

  update public.store_schedule_settings
  set attends_holidays = true
  where organization_id = v_org and store_id = v_store;

  select public.is_store_appointment_within_operating_window(
    v_org, v_store, 'meeting', v_start + interval '10 hour', v_start + interval '11 hour'
  ) into v_result;
  insert into p97_results values (
    'holiday helper permits window when holidays attended',
    v_result,
    coalesce(v_result::text, 'false')
  );

  delete from public.store_schedule_blocks where id = v_holiday_block;

  update public.store_schedule_settings set
    attends_holidays = false,
    timezone_name = 'America/New_York', agenda_capacity_configured_at = clock_timestamp(),
    daily_limit_mode = 'no_fixed_limit', daily_limit = null,
    appointment_buffer_enabled = false, appointment_buffer_minutes = null,
    allow_multiple_appointments_per_day = true, allow_same_time_appointments = false, same_time_capacity = 1
  where organization_id = v_org and store_id = v_store;
  select scheduled_start into v_original_start from public.store_appointments where id = v_appointment;

  -- update_store_appointment logs a schedule conversation event. The nested
  -- log_schedule_conversation_event boundary authorizes from JWT request role
  -- (service_role) or authenticated membership, not from SQL Editor session_user.
  -- Run the RPC under the same service-role request context used by the server.
  perform set_config('request.jwt.claim.role', 'service_role', true);
  begin
    select * into v_updated
    from public.update_store_appointment(
      v_appointment, v_org, v_store, 'P97 appointment', 'meeting', 'rescheduled',
      v_start + interval '2 hour', v_start + interval '3 hour', null, null, null, null
    );
    perform set_config('request.jwt.claim.role', '', true);

    if v_updated.status = 'rescheduled'
       and v_updated.scheduled_start = v_start + interval '2 hour' then
      insert into p97_results values (
        'reschedule allowed via update_store_appointment',
        true,
        v_updated.status
      );
    else
      insert into p97_results values (
        'reschedule allowed via update_store_appointment',
        false,
        'unexpected final row'
      );
    end if;
  exception when others then
    perform set_config('request.jwt.claim.role', '', true);
    insert into p97_results values (
      'reschedule allowed via update_store_appointment',
      false,
      sqlerrm
    );
  end;
  insert into public.store_appointments (id, organization_id, store_id, title, appointment_type, status, scheduled_start, scheduled_end, source)
  values (v_overlap, v_org, v_store, 'P97 reschedule blocker', 'meeting', 'scheduled', v_start + interval '4 hour', v_start + interval '5 hour', 'panel')
  on conflict (id) do update set status = 'scheduled', scheduled_start = excluded.scheduled_start, scheduled_end = excluded.scheduled_end;
  update public.store_schedule_settings set appointment_buffer_enabled = true, appointment_buffer_minutes = 60 where organization_id = v_org and store_id = v_store;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  begin
    select * into v_updated
    from public.update_store_appointment(
      v_appointment, v_org, v_store, 'P97 appointment', 'meeting', 'rescheduled',
      v_start + interval '4 hour', v_start + interval '5 hour', null, null, null, null
    );

    perform set_config('request.jwt.claim.role', '', true);
    insert into p97_results values (
      'reschedule blocked by capacity preserves original',
      false,
      'unexpected update success'
    );
  exception when others then
    perform set_config('request.jwt.claim.role', '', true);
    select scheduled_start
    into v_original_start
    from public.store_appointments
    where id = v_appointment;

    insert into p97_results values (
      'reschedule blocked by capacity preserves original',
      v_original_start = v_start + interval '2 hour',
      sqlerrm
    );
  end;
  select stage = v_stage_before into v_result from public.commercial_opportunities where id = v_opportunity;
  insert into p97_results values ('reschedule preserves opportunity stage', v_result, v_stage_before);

  insert into public.store_schedule_blocks (id, organization_id, store_id, title, block_type, start_at, end_at, source, notes)
  values (v_block, v_org, v_store, 'P97 schedule block', 'manual_block', v_start + interval '6 hour', v_start + interval '7 hour', 'system', 'fixture');
  select reason_code into v_reason
  from public.check_store_appointment_availability_by_system(v_org, v_store, 'meeting', v_start + interval '6 hour', v_start + interval '7 hour', null);
  insert into p97_results values ('schedule block returns canonical conflict', v_reason = 'schedule_block_conflict', coalesce(v_reason, 'null'));

  if to_regclass('public.store_operation_execution_policies') is not null then
    insert into public.store_operation_execution_policies (
      organization_id, store_id, installation_policy, installation_configured_at,
      technical_visit_policy, technical_visit_configured_at
    ) values (
      v_org, v_store,
      jsonb_build_object('customer_can_buy_without','sim','third_party_pool','nao','supply_mode','disponivel','start_lead_time_mode','1_dia','duration_mode','horas','duration_value',6,'has_multiple_teams',false,'concurrent_capacity',1,'schedule_gates',jsonb_build_array(),'start_gates',jsonb_build_array(),'includes',jsonb_build_array(),'excludes',jsonb_build_array()),
      clock_timestamp(),
      jsonb_build_object('required_situations',jsonb_build_array('medidas'),'optional_situations',jsonb_build_array('cliente_pedir'),'team_mode','mesma_instalacao','requires_appointment',true,'duration_mode','60','duration_minutes',60,'preconfirm_items',jsonb_build_array('endereco','contato')),
      clock_timestamp()
    ) on conflict (organization_id, store_id) do update set
      installation_policy = excluded.installation_policy,
      installation_configured_at = excluded.installation_configured_at,
      technical_visit_policy = excluded.technical_visit_policy,
      technical_visit_configured_at = excluded.technical_visit_configured_at;
    update public.store_schedule_settings set
      agenda_capacity_configured_at = clock_timestamp(),
      daily_limit_mode = 'no_fixed_limit',
      daily_limit = null,
      appointment_buffer_enabled = false,
      appointment_buffer_minutes = null,
      allow_multiple_appointments_per_day = true,
      allow_same_time_appointments = true,
      same_time_capacity = 2
    where organization_id = v_org and store_id = v_store;

    insert into public.store_appointments (organization_id, store_id, title, appointment_type, status, scheduled_start, scheduled_end, source)
    values (v_org, v_store, 'P97 shared installation base', 'installation', 'scheduled', v_start + interval '8 hour', v_start + interval '9 hour', 'system');

    select reason_code into v_reason
    from public.check_store_appointment_availability_by_system(
      v_org,
      v_store,
      'technical_visit',
      v_start + interval '8 hour',
      v_start + interval '9 hour',
      null
    );
    insert into p97_results values (
      'shared installation team blocks technical_visit',
      v_reason = 'installation_team_capacity_exceeded',
      coalesce(v_reason, 'null')
    );
  else
    insert into p97_results values ('shared installation team blocks technical_visit', false, 'policy table unavailable');
  end if;

  update public.store_schedule_settings
  set timezone_name = 'Invalid/Timezone',
      enforce_operating_window = false
  where organization_id = v_org and store_id = v_store;

  select public.is_store_appointment_within_operating_window(
    v_org, v_store, 'meeting', v_start, v_start + interval '1 hour'
  ) into v_result;
  insert into p97_results values (
    'invalid timezone fails closed with operating window disabled',
    not v_result,
    coalesce(v_result::text, 'false')
  );

  select public.has_store_appointment_conflict(
    v_org, v_store, v_start + interval '10 hour', v_start + interval '11 hour', null
  ) into v_result;
  insert into p97_results values (
    'invalid timezone blocks capacity helper',
    v_result,
    coalesce(v_result::text, 'false')
  );

  delete from public.store_schedule_settings where organization_id = v_org and store_id = v_store;
  select public.is_store_appointment_within_operating_window(v_org, v_store, 'meeting', v_start, v_start + interval '1 hour') into v_result;
  insert into p97_results values ('absent schedule row preserves legacy fallback', v_result, coalesce(v_result::text, 'false'));
  select public.has_store_appointment_conflict(v_org, v_store, v_start + interval '10 hour', v_start + interval '11 hour', null) into v_result;
  insert into p97_results values ('absent row allows non-overlapping same-day appointment', not v_result, coalesce(v_result::text, 'false'));
  select public.has_store_appointment_conflict(v_org, v_store, v_start + interval '1 hour 30 minutes', v_start + interval '2 hour 30 minutes', null) into v_result;
  insert into p97_results values ('absent row blocks overlapping appointment', v_result, coalesce(v_result::text, 'false'));

  select public.has_store_appointment_conflict(v_org, v_store, v_start + interval '2 hour', v_start + interval '3 hour', v_appointment) into v_result;
  insert into p97_results values ('reschedule ignores own appointment', not v_result, coalesce(v_result::text, 'false'));
  insert into p97_results values ('reschedule does not mutate opportunity stage', (select stage = v_stage_before from public.commercial_opportunities where id = v_opportunity), v_stage_before);
end;
$setup$;

insert into p97_results values
  ('capacity trigger remains installed', exists (select 1 from pg_trigger where tgname = 'store_appointments_p19a_capacity_guard'), 'trigger catalog check'),
  ('capacity advisory lock remains effective body', position('pg_advisory_xact_lock' in pg_get_functiondef('public.p19a_guard_store_appointment_capacity_internal()'::regprocedure)) > 0, 'effective function body check'),
  ('helpers deny anonymous execute', not has_function_privilege('anon', 'public.has_store_appointment_conflict(uuid,uuid,timestamptz,timestamptz,uuid)', 'EXECUTE') and not has_function_privilege('anon', 'public.is_store_appointment_within_operating_window(uuid,uuid,text,timestamptz,timestamptz)', 'EXECUTE'), 'PUBLIC/anon effectively denied'),
  ('helpers restrict execute to service_role', not has_function_privilege('authenticated', 'public.has_store_appointment_conflict(uuid,uuid,timestamptz,timestamptz,uuid)', 'EXECUTE') and has_function_privilege('service_role', 'public.has_store_appointment_conflict(uuid,uuid,timestamptz,timestamptz,uuid)', 'EXECUTE') and not has_function_privilege('authenticated', 'public.is_store_appointment_within_operating_window(uuid,uuid,text,timestamptz,timestamptz)', 'EXECUTE') and has_function_privilege('service_role', 'public.is_store_appointment_within_operating_window(uuid,uuid,text,timestamptz,timestamptz)', 'EXECUTE'), 'authenticated denied; service_role allowed');

do $count$
declare
  v_total integer;
begin
  select count(*) into v_total from p97_results;
  if v_total <> 50 then
    raise exception using errcode = 'P0001',
      message = format('P97 7.3 runner scenario count mismatch: expected 50, got %s', v_total);
  end if;
end;
$count$;

select scenario, passed, detail from p97_results order by scenario;

do $fail$
declare v_failed integer;
begin
  select count(*) into v_failed from p97_results where passed is not true;
  if v_failed > 0 then
    raise exception using errcode = 'P0001', message = format('P97 7.3 runner failed: %s scenario(s)', v_failed);
  end if;
end;
$fail$;

rollback;
