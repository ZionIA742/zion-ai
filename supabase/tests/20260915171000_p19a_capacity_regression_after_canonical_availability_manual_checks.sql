begin;

create temp table p19a_front6_capacity_regression (
  scenario integer not null,
  name text not null,
  status text not null,
  detail text not null
) on commit drop;

do $test$
declare
  v_org uuid := 'b02252ce-0e73-4371-9e23-f1009e7b1698';
  v_store uuid := '6ac8f4b1-e50f-42c0-9cae-78951d6daf7b';
  v_start timestamptz := '2099-01-20 14:00:00+00';
  v_end timestamptz := '2099-01-20 15:00:00+00';
  v_update_start timestamptz := '2099-01-20 17:00:00+00';
  v_update_end timestamptz := '2099-01-20 18:00:00+00';
  v_base_id uuid;
  v_update_id uuid;
  v_existing bigint;
begin
  if not exists (
    select 1
    from public.store_schedule_settings
    where organization_id=v_org and store_id=v_store
  ) then
    raise exception using errcode='P0001', message='TEST_PRECONDITION_SCHEDULE_SETTINGS_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.store_operation_execution_policies
    where organization_id=v_org and store_id=v_store
      and installation_policy is not null
      and technical_visit_policy is not null
  ) then
    raise exception using errcode='P0001', message='TEST_PRECONDITION_EXECUTION_POLICIES_NOT_FOUND';
  end if;

  select count(*) into v_existing
  from public.store_appointments a
  where a.organization_id=v_org
    and a.store_id=v_store
    and a.status in ('scheduled','rescheduled')
    and a.scheduled_start < v_update_end + interval '3 hours'
    and a.scheduled_end > v_start;

  if v_existing <> 0 then
    raise exception using errcode='P0001', message='TEST_PRECONDITION_SLOTS_NOT_EMPTY';
  end if;

  update public.store_schedule_settings
  set allow_multiple_appointments_per_day=true,
      allow_same_time_appointments=true,
      same_time_capacity=3
  where organization_id=v_org and store_id=v_store;

  update public.store_operation_execution_policies
  set installation_policy = jsonb_set(
        jsonb_set(installation_policy,'{has_multiple_teams}','false'::jsonb,true),
        '{concurrent_capacity}','1'::jsonb,true
      ),
      technical_visit_policy = jsonb_set(
        technical_visit_policy,'{team_mode}','"mesma_instalacao"'::jsonb,true
      )
  where organization_id=v_org and store_id=v_store;

  insert into public.store_appointments
    (organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source)
  values
    (v_org,v_store,'P19A FRONT6 REG BASE INSTALLATION','installation','scheduled',v_start,v_end,'system')
  returning id into v_base_id;

  begin
    insert into public.store_appointments
      (organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source)
    values
      (v_org,v_store,'P19A FRONT6 REG SECOND INSTALLATION','installation','scheduled',v_start,v_end,'system');
    insert into pg_temp.p19a_front6_capacity_regression values
      (1,'instalacao continua respeitando capacidade da equipe','FAIL','second installation incorrectly accepted');
  exception when check_violation then
    insert into pg_temp.p19a_front6_capacity_regression values
      (1,'instalacao continua respeitando capacidade da equipe',
       case when sqlerrm='ZION_INSTALLATION_CONCURRENT_CAPACITY_EXCEEDED' then 'PASS' else 'FAIL' end,sqlerrm);
  end;

  begin
    insert into public.store_appointments
      (organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source)
    values
      (v_org,v_store,'P19A FRONT6 REG SHARED VISIT','technical_visit','scheduled',v_start,v_end,'system');
    insert into pg_temp.p19a_front6_capacity_regression values
      (2,'visita compartilhada continua consumindo equipe','FAIL','shared visit incorrectly accepted');
  exception when check_violation then
    insert into pg_temp.p19a_front6_capacity_regression values
      (2,'visita compartilhada continua consumindo equipe',
       case when sqlerrm='ZION_INSTALLATION_CONCURRENT_CAPACITY_EXCEEDED' then 'PASS' else 'FAIL' end,sqlerrm);
  end;

  delete from public.store_appointments where id=v_base_id;

  update public.store_schedule_settings
  set same_time_capacity=2
  where organization_id=v_org and store_id=v_store;

  insert into public.store_appointments
    (organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source)
  values
    (v_org,v_store,'P19A FRONT6 REG MEETING 1','meeting','scheduled',v_start,v_end,'system'),
    (v_org,v_store,'P19A FRONT6 REG MEETING 2','meeting','scheduled',v_start,v_end,'system');

  begin
    insert into public.store_appointments
      (organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source)
    values
      (v_org,v_store,'P19A FRONT6 REG THIRD GENERAL','follow_up','scheduled',v_start,v_end,'system');
    insert into pg_temp.p19a_front6_capacity_regression values
      (3,'capacidade geral continua protegida','FAIL','third general appointment incorrectly accepted');
  exception when check_violation then
    insert into pg_temp.p19a_front6_capacity_regression values
      (3,'capacidade geral continua protegida',
       case when sqlerrm='ZION_APPOINTMENT_GLOBAL_CAPACITY_EXCEEDED' then 'PASS' else 'FAIL' end,sqlerrm);
  end;

  delete from public.store_appointments
  where organization_id=v_org and store_id=v_store and title like 'P19A FRONT6 REG%';

  update public.store_schedule_settings
  set same_time_capacity=3
  where organization_id=v_org and store_id=v_store;

  insert into public.store_appointments
    (organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source)
  values
    (v_org,v_store,'P19A FRONT6 REG UPDATE BASE','installation','scheduled',v_start,v_end,'system')
  returning id into v_base_id;

  insert into public.store_appointments
    (organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source)
  values
    (v_org,v_store,'P19A FRONT6 REG UPDATE CANDIDATE','technical_visit','scheduled',v_update_start,v_update_end,'system')
  returning id into v_update_id;

  begin
    update public.store_appointments
    set scheduled_start=v_start, scheduled_end=v_end, updated_at=pg_catalog.now()
    where id=v_update_id;
    insert into pg_temp.p19a_front6_capacity_regression values
      (4,'update de visita compartilhada continua protegido','FAIL','shared visit update incorrectly accepted');
  exception when check_violation then
    insert into pg_temp.p19a_front6_capacity_regression values
      (4,'update de visita compartilhada continua protegido',
       case when sqlerrm='ZION_INSTALLATION_CONCURRENT_CAPACITY_EXCEEDED' then 'PASS' else 'FAIL' end,sqlerrm);
  end;
end;
$test$;

select scenario,name,status,detail
from pg_temp.p19a_front6_capacity_regression
order by scenario;

do $assert$
begin
  if (select count(*) from pg_temp.p19a_front6_capacity_regression) <> 4 then
    raise exception using errcode='P0001', message='P19A_FRONT6_CAPACITY_REGRESSION_INCOMPLETE';
  end if;
  if exists (select 1 from pg_temp.p19a_front6_capacity_regression where status<>'PASS') then
    raise exception using errcode='P0001', message='P19A_FRONT6_CAPACITY_REGRESSION_FAILED';
  end if;
end;
$assert$;

rollback;

select
  (select count(*) from public.store_appointments where organization_id='b02252ce-0e73-4371-9e23-f1009e7b1698'::uuid and store_id='6ac8f4b1-e50f-42c0-9cae-78951d6daf7b'::uuid and title like 'P19A FRONT6 REG%') as test_rows_after_rollback;
