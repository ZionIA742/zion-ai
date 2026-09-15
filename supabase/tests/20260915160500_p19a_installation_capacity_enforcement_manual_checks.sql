begin;

create temp table p19a_front5_capacity_checks (
  scenario integer not null,
  name text not null,
  status text not null,
  detail text not null
) on commit drop;

do $test$
declare
  v_org uuid;
  v_store uuid;
  v_start timestamptz := '2099-01-15 15:00:00+00';
  v_end timestamptz := '2099-01-15 16:00:00+00';
  v_installation_id uuid;
  v_meeting_id uuid;
  v_update_candidate_id uuid;
  v_existing integer;
begin
  select s.organization_id, s.id
  into v_org, v_store
  from public.stores s
  join public.store_schedule_settings sch
    on sch.organization_id = s.organization_id
   and sch.store_id = s.id
  join public.store_operation_execution_policies pol
    on pol.organization_id = s.organization_id
   and pol.store_id = s.id
  where sch.allow_same_time_appointments = true
    and sch.same_time_capacity = 2
    and pol.installation_configured_at is not null
    and pol.installation_policy is not null
    and (pol.installation_policy ->> 'concurrent_capacity')::numeric = 1
  order by s.organization_id, s.id
  limit 1;

  if v_org is null or v_store is null then
    raise exception using errcode = 'P0001', message = 'TEST_PRECONDITION_STORE_NOT_FOUND';
  end if;

  select count(*)
  into v_existing
  from public.store_appointments a
  where a.organization_id = v_org
    and a.store_id = v_store
    and a.status in ('scheduled', 'rescheduled')
    and a.scheduled_start < v_end
    and a.scheduled_end > v_start;

  if v_existing <> 0 then
    raise exception using errcode = 'P0001', message = 'TEST_PRECONDITION_SLOT_NOT_EMPTY';
  end if;

  insert into public.store_appointments (
    organization_id, store_id, title, appointment_type, status, scheduled_start, scheduled_end, source
  ) values (
    v_org, v_store, 'P19A FRONT5 BASE INSTALLATION', 'installation', 'scheduled', v_start, v_end, 'system'
  ) returning id into v_installation_id;

  insert into pg_temp.p19a_front5_capacity_checks
  values (1, 'primeira instalacao entra', 'PASS', 'baseline installation inserted');

  begin
    insert into public.store_appointments (
      organization_id, store_id, title, appointment_type, status, scheduled_start, scheduled_end, source
    ) values (
      v_org, v_store, 'P19A FRONT5 SECOND INSTALLATION', 'installation', 'scheduled', v_start, v_end, 'system'
    );

    insert into pg_temp.p19a_front5_capacity_checks
    values (2, 'segunda instalacao excede equipe', 'FAIL', 'second installation was incorrectly accepted');
  exception
    when check_violation then
      if sqlerrm = 'ZION_INSTALLATION_CONCURRENT_CAPACITY_EXCEEDED' then
        insert into pg_temp.p19a_front5_capacity_checks
        values (2, 'segunda instalacao excede equipe', 'PASS', sqlerrm);
      else
        insert into pg_temp.p19a_front5_capacity_checks
        values (2, 'segunda instalacao excede equipe', 'FAIL', sqlerrm);
      end if;
  end;

  insert into public.store_appointments (
    organization_id, store_id, title, appointment_type, status, scheduled_start, scheduled_end, source
  ) values (
    v_org, v_store, 'P19A FRONT5 PARALLEL MEETING', 'meeting', 'scheduled', v_start, v_end, 'system'
  ) returning id into v_meeting_id;

  insert into pg_temp.p19a_front5_capacity_checks
  values (3, 'outro compromisso usa segunda vaga geral', 'PASS', 'meeting accepted while installation team is occupied');

  begin
    insert into public.store_appointments (
      organization_id, store_id, title, appointment_type, status, scheduled_start, scheduled_end, source
    ) values (
      v_org, v_store, 'P19A FRONT5 THIRD GENERAL', 'follow_up', 'scheduled', v_start, v_end, 'system'
    );

    insert into pg_temp.p19a_front5_capacity_checks
    values (4, 'terceiro compromisso excede agenda geral', 'FAIL', 'third general appointment was incorrectly accepted');
  exception
    when check_violation then
      if sqlerrm = 'ZION_APPOINTMENT_GLOBAL_CAPACITY_EXCEEDED' then
        insert into pg_temp.p19a_front5_capacity_checks
        values (4, 'terceiro compromisso excede agenda geral', 'PASS', sqlerrm);
      else
        insert into pg_temp.p19a_front5_capacity_checks
        values (4, 'terceiro compromisso excede agenda geral', 'FAIL', sqlerrm);
      end if;
  end;

  delete from public.store_appointments where id = v_meeting_id;

  insert into public.store_appointments (
    organization_id, store_id, title, appointment_type, status, scheduled_start, scheduled_end, source
  ) values (
    v_org, v_store, 'P19A FRONT5 UPDATE CANDIDATE', 'meeting', 'scheduled', v_start + interval '2 hours', v_end + interval '2 hours', 'system'
  ) returning id into v_update_candidate_id;

  begin
    update public.store_appointments
    set appointment_type = 'installation',
        scheduled_start = v_start,
        scheduled_end = v_end,
        updated_at = pg_catalog.now()
    where id = v_update_candidate_id;

    insert into pg_temp.p19a_front5_capacity_checks
    values (5, 'update para instalacao respeita capacidade', 'FAIL', 'update was incorrectly accepted');
  exception
    when check_violation then
      if sqlerrm = 'ZION_INSTALLATION_CONCURRENT_CAPACITY_EXCEEDED' then
        insert into pg_temp.p19a_front5_capacity_checks
        values (5, 'update para instalacao respeita capacidade', 'PASS', sqlerrm);
      else
        insert into pg_temp.p19a_front5_capacity_checks
        values (5, 'update para instalacao respeita capacidade', 'FAIL', sqlerrm);
      end if;
  end;
end;
$test$;

select scenario, name, status, detail
from pg_temp.p19a_front5_capacity_checks
order by scenario;

do $assert$
begin
  if exists (select 1 from pg_temp.p19a_front5_capacity_checks where status <> 'PASS') then
    raise exception using errcode = 'P0001', message = 'P19A_FRONT5_CAPACITY_CHECK_FAILED';
  end if;

  if (select count(*) from pg_temp.p19a_front5_capacity_checks) <> 5 then
    raise exception using errcode = 'P0001', message = 'P19A_FRONT5_CAPACITY_CHECK_INCOMPLETE';
  end if;
end;
$assert$;

rollback;
