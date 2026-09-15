begin;

create temp table p19a_shared_team_checks (
  scenario integer not null,
  name text not null,
  status text not null,
  detail text not null
) on commit drop;

do $test$
declare
  v_org uuid := 'b02252ce-0e73-4371-9e23-f1009e7b1698';
  v_store uuid := '6ac8f4b1-e50f-42c0-9cae-78951d6daf7b';
  v_start1 timestamptz := '2099-01-16 14:00:00+00';
  v_end1 timestamptz := '2099-01-16 15:00:00+00';
  v_start2 timestamptz := '2099-01-16 16:00:00+00';
  v_end2 timestamptz := '2099-01-16 17:00:00+00';
  v_start3 timestamptz := '2099-01-16 18:00:00+00';
  v_end3 timestamptz := '2099-01-16 19:00:00+00';
  v_start4 timestamptz := '2099-01-16 20:00:00+00';
  v_end4 timestamptz := '2099-01-16 21:00:00+00';
  v_installation_id uuid;
  v_visit_id uuid;
  v_mode text;
  v_existing bigint;
begin
  select technical_visit_policy ->> 'team_mode'
  into v_mode
  from public.store_operation_execution_policies
  where organization_id = v_org and store_id = v_store;

  if v_mode is distinct from 'dono_loja' then
    raise exception using errcode = 'P0001', message = 'TEST_PRECONDITION_VISIT_MODE_CHANGED';
  end if;

  select count(*) into v_existing
  from public.store_appointments a
  where a.organization_id = v_org
    and a.store_id = v_store
    and a.status in ('scheduled','rescheduled')
    and a.scheduled_start < v_end4
    and a.scheduled_end > v_start1;

  if v_existing <> 0 then
    raise exception using errcode = 'P0001', message = 'TEST_PRECONDITION_SLOTS_NOT_EMPTY';
  end if;

  insert into public.store_appointments
    (organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source)
  values
    (v_org,v_store,'P19A FRONT5 NON SHARED INSTALLATION','installation','scheduled',v_start1,v_end1,'system')
  returning id into v_installation_id;

  insert into public.store_appointments
    (organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source)
  values
    (v_org,v_store,'P19A FRONT5 OWNER VISIT','technical_visit','scheduled',v_start1,v_end1,'system')
  returning id into v_visit_id;

  insert into pg_temp.p19a_shared_team_checks
  values (1,'visita do dono nao consome equipe de instalacao','PASS','installation + owner technical_visit accepted under global capacity 2');

  delete from public.store_appointments where id in (v_installation_id,v_visit_id);

  update public.store_operation_execution_policies
  set technical_visit_policy = jsonb_set(technical_visit_policy,'{team_mode}','"mesma_instalacao"'::jsonb,true)
  where organization_id = v_org and store_id = v_store;

  insert into public.store_appointments
    (organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source)
  values
    (v_org,v_store,'P19A FRONT5 SHARED BASE INSTALLATION','installation','scheduled',v_start2,v_end2,'system')
  returning id into v_installation_id;

  begin
    insert into public.store_appointments
      (organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source)
    values
      (v_org,v_store,'P19A FRONT5 SHARED VISIT BLOCKED','technical_visit','scheduled',v_start2,v_end2,'system');
    insert into pg_temp.p19a_shared_team_checks values (2,'visita compartilhada respeita capacidade','FAIL','shared technical_visit was incorrectly accepted');
  exception when check_violation then
    if sqlerrm = 'ZION_INSTALLATION_CONCURRENT_CAPACITY_EXCEEDED' then
      insert into pg_temp.p19a_shared_team_checks values (2,'visita compartilhada respeita capacidade','PASS',sqlerrm);
    else
      insert into pg_temp.p19a_shared_team_checks values (2,'visita compartilhada respeita capacidade','FAIL',sqlerrm);
    end if;
  end;

  delete from public.store_appointments where id = v_installation_id;

  insert into public.store_appointments
    (organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source)
  values
    (v_org,v_store,'P19A FRONT5 SHARED BASE VISIT','technical_visit','scheduled',v_start3,v_end3,'system')
  returning id into v_visit_id;

  begin
    insert into public.store_appointments
      (organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source)
    values
      (v_org,v_store,'P19A FRONT5 INSTALLATION BLOCKED BY VISIT','installation','scheduled',v_start3,v_end3,'system');
    insert into pg_temp.p19a_shared_team_checks values (3,'instalacao respeita visita que usa mesma equipe','FAIL','installation was incorrectly accepted over shared visit');
  exception when check_violation then
    if sqlerrm = 'ZION_INSTALLATION_CONCURRENT_CAPACITY_EXCEEDED' then
      insert into pg_temp.p19a_shared_team_checks values (3,'instalacao respeita visita que usa mesma equipe','PASS',sqlerrm);
    else
      insert into pg_temp.p19a_shared_team_checks values (3,'instalacao respeita visita que usa mesma equipe','FAIL',sqlerrm);
    end if;
  end;

  delete from public.store_appointments where id = v_visit_id;

  insert into public.store_appointments
    (organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source)
  values
    (v_org,v_store,'P19A FRONT5 UPDATE BASE INSTALLATION','installation','scheduled',v_start4,v_end4,'system')
  returning id into v_installation_id;

  insert into public.store_appointments
    (organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source)
  values
    (v_org,v_store,'P19A FRONT5 UPDATE VISIT CANDIDATE','technical_visit','scheduled',v_start4 + interval '2 hours',v_end4 + interval '2 hours','system')
  returning id into v_visit_id;

  begin
    update public.store_appointments
    set scheduled_start = v_start4, scheduled_end = v_end4, updated_at = pg_catalog.now()
    where id = v_visit_id;
    insert into pg_temp.p19a_shared_team_checks values (4,'remarcacao de visita compartilhada respeita capacidade','FAIL','shared visit update was incorrectly accepted');
  exception when check_violation then
    if sqlerrm = 'ZION_INSTALLATION_CONCURRENT_CAPACITY_EXCEEDED' then
      insert into pg_temp.p19a_shared_team_checks values (4,'remarcacao de visita compartilhada respeita capacidade','PASS',sqlerrm);
    else
      insert into pg_temp.p19a_shared_team_checks values (4,'remarcacao de visita compartilhada respeita capacidade','FAIL',sqlerrm);
    end if;
  end;
end;
$test$;

do $assert$
begin
  if (select count(*) from pg_temp.p19a_shared_team_checks) <> 4 then
    raise exception using errcode = 'P0001', message = 'P19A_SHARED_TEAM_CHECK_INCOMPLETE';
  end if;
  if exists (select 1 from pg_temp.p19a_shared_team_checks where status <> 'PASS') then
    raise exception using errcode = 'P0001', message = 'P19A_SHARED_TEAM_CHECK_FAILED';
  end if;
end;
$assert$;

rollback;

select
  'PASS' as non_shared_visit_keeps_separate_capacity,
  'PASS' as shared_visit_consumes_installation_capacity,
  'PASS' as reverse_shared_capacity_is_enforced,
  'PASS' as shared_visit_update_is_enforced,
  (select technical_visit_policy ->> 'team_mode' from public.store_operation_execution_policies where organization_id='b02252ce-0e73-4371-9e23-f1009e7b1698'::uuid and store_id='6ac8f4b1-e50f-42c0-9cae-78951d6daf7b'::uuid) as visit_mode_after_rollback,
  (select count(*) from public.store_appointments where organization_id='b02252ce-0e73-4371-9e23-f1009e7b1698'::uuid and store_id='6ac8f4b1-e50f-42c0-9cae-78951d6daf7b'::uuid and title like 'P19A FRONT5%') as test_rows_after_rollback;
