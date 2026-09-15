begin;

create temp table p19a_front6_availability_checks (
  scenario integer not null,
  name text not null,
  status text not null,
  detail text not null
) on commit drop;

do $test$
declare
  v_org uuid := 'b02252ce-0e73-4371-9e23-f1009e7b1698';
  v_store uuid := '6ac8f4b1-e50f-42c0-9cae-78951d6daf7b';
  v_start timestamptz := '2099-01-19 14:00:00+00';
  v_end timestamptz := '2099-01-19 15:00:00+00';
  v_outside_start timestamptz := '2099-01-19 03:00:00+00';
  v_outside_end timestamptz := '2099-01-19 04:00:00+00';
  v_available boolean;
  v_reason text;
  v_first_id uuid;
  v_second_id uuid;
  v_installation_id uuid;
  v_existing bigint;
begin
  select count(*) into v_existing
  from public.store_appointments a
  where a.organization_id = v_org
    and a.store_id = v_store
    and a.status in ('scheduled','rescheduled')
    and a.scheduled_start < v_end
    and a.scheduled_end > v_start;

  if v_existing <> 0 then
    raise exception using errcode = 'P0001', message = 'TEST_PRECONDITION_SLOT_NOT_EMPTY';
  end if;

  update public.store_schedule_settings
  set allow_multiple_appointments_per_day = true,
      allow_same_time_appointments = true,
      same_time_capacity = 2,
      enforce_operating_window = true
  where organization_id = v_org and store_id = v_store;

  update public.store_operation_execution_policies
  set technical_visit_policy = jsonb_set(
    technical_visit_policy,
    '{team_mode}',
    '"mesma_instalacao"'::jsonb,
    true
  )
  where organization_id = v_org and store_id = v_store;

  select available, reason_code into v_available, v_reason
  from public.check_store_appointment_availability_by_system(
    v_org,v_store,'meeting',v_start,v_end,null
  );
  insert into pg_temp.p19a_front6_availability_checks
  values (1,'horario livre e reconhecido',
    case when v_available = true and v_reason is null then 'PASS' else 'FAIL' end,
    coalesce(v_reason,'available'));

  insert into public.store_appointments
    (organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source)
  values
    (v_org,v_store,'P19A FRONT6 FIRST MEETING','meeting','scheduled',v_start,v_end,'system')
  returning id into v_first_id;

  select available, reason_code into v_available, v_reason
  from public.check_store_appointment_availability_by_system(
    v_org,v_store,'meeting',v_start,v_end,null
  );
  insert into pg_temp.p19a_front6_availability_checks
  values (2,'segunda vaga simultanea permitida',
    case when v_available = true and v_reason is null then 'PASS' else 'FAIL' end,
    coalesce(v_reason,'available'));

  insert into public.store_appointments
    (organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source)
  values
    (v_org,v_store,'P19A FRONT6 SECOND MEETING','meeting','scheduled',v_start,v_end,'system')
  returning id into v_second_id;

  select available, reason_code into v_available, v_reason
  from public.check_store_appointment_availability_by_system(
    v_org,v_store,'follow_up',v_start,v_end,null
  );
  insert into pg_temp.p19a_front6_availability_checks
  values (3,'terceira vaga respeita capacidade geral',
    case when v_available = false and v_reason = 'global_capacity_exceeded' then 'PASS' else 'FAIL' end,
    coalesce(v_reason,'unexpected_available'));

  delete from public.store_appointments where id in (v_first_id,v_second_id);

  insert into public.store_schedule_blocks
    (organization_id,store_id,title,block_type,start_at,end_at,source)
  values
    (v_org,v_store,'P19A FRONT6 MANUAL BLOCK','manual_block',v_start,v_end,'system');

  select available, reason_code into v_available, v_reason
  from public.check_store_appointment_availability_by_system(
    v_org,v_store,'meeting',v_start,v_end,null
  );
  insert into pg_temp.p19a_front6_availability_checks
  values (4,'bloqueio de agenda respeitado',
    case when v_available = false and v_reason = 'schedule_block_conflict' then 'PASS' else 'FAIL' end,
    coalesce(v_reason,'unexpected_available'));

  delete from public.store_schedule_blocks
  where organization_id = v_org and store_id = v_store and title = 'P19A FRONT6 MANUAL BLOCK';

  select available, reason_code into v_available, v_reason
  from public.check_store_appointment_availability_by_system(
    v_org,v_store,'meeting',v_outside_start,v_outside_end,null
  );
  insert into pg_temp.p19a_front6_availability_checks
  values (5,'janela operacional respeitada',
    case when v_available = false and v_reason = 'outside_operating_window' then 'PASS' else 'FAIL' end,
    coalesce(v_reason,'unexpected_available'));

  update public.store_schedule_settings
  set same_time_capacity = 3
  where organization_id = v_org and store_id = v_store;

  insert into public.store_appointments
    (organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source)
  values
    (v_org,v_store,'P19A FRONT6 INSTALLATION 1','installation','scheduled',v_start,v_end,'system')
  returning id into v_installation_id;

  insert into public.store_appointments
    (organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source)
  values
    (v_org,v_store,'P19A FRONT6 INSTALLATION 2','installation','scheduled',v_start,v_end,'system');

  select available, reason_code into v_available, v_reason
  from public.check_store_appointment_availability_by_system(
    v_org,v_store,'technical_visit',v_start,v_end,null
  );
  insert into pg_temp.p19a_front6_availability_checks
  values (6,'visita compartilhada respeita capacidade da equipe',
    case when v_available = false and v_reason = 'installation_team_capacity_exceeded' then 'PASS' else 'FAIL' end,
    coalesce(v_reason,'unexpected_available'));
end;
$test$;

select scenario,name,status,detail
from pg_temp.p19a_front6_availability_checks
order by scenario;

do $assert$
begin
  if (select count(*) from pg_temp.p19a_front6_availability_checks) <> 6 then
    raise exception using errcode = 'P0001', message = 'P19A_FRONT6_AVAILABILITY_CHECK_INCOMPLETE';
  end if;

  if exists (select 1 from pg_temp.p19a_front6_availability_checks where status <> 'PASS') then
    raise exception using errcode = 'P0001', message = 'P19A_FRONT6_AVAILABILITY_CHECK_FAILED';
  end if;
end;
$assert$;

rollback;

select
  (select count(*) from public.store_appointments where organization_id='b02252ce-0e73-4371-9e23-f1009e7b1698'::uuid and store_id='6ac8f4b1-e50f-42c0-9cae-78951d6daf7b'::uuid and title like 'P19A FRONT6%') as test_appointments_after_rollback,
  (select count(*) from public.store_schedule_blocks where organization_id='b02252ce-0e73-4371-9e23-f1009e7b1698'::uuid and store_id='6ac8f4b1-e50f-42c0-9cae-78951d6daf7b'::uuid and title like 'P19A FRONT6%') as test_blocks_after_rollback;
