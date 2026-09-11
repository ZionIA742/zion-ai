begin;

create temp table p19a_schedule_checks (
  check_no integer primary key,
  check_name text not null,
  status text not null
    check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  details text null
) on commit drop;

create or replace function pg_temp.p19a_record(
  p_no integer,
  p_name text,
  p_status text,
  p_details text default null
)
returns void
language plpgsql
as $$
begin
  insert into p19a_schedule_checks(
    check_no,
    check_name,
    status,
    details
  )
  values (
    p_no,
    p_name,
    p_status,
    p_details
  );
end;
$$;


do $$
declare
  v_member_org uuid;
  v_member_user uuid;

  v_org_b uuid := gen_random_uuid();
  v_store_a uuid := gen_random_uuid();
  v_store_b uuid := gen_random_uuid();

  v_random_user uuid := gen_random_uuid();

  v_row public.store_schedule_settings%rowtype;

  v_human_configured_at timestamptz;
  v_after_hours_configured_at timestamptz;
  v_agenda_configured_at timestamptz;

  v_count integer;
begin

  -- ==========================================================
  -- PREREQUISITE
  -- Need one real DEV active membership so the authenticated
  -- branch can be tested for real.
  -- ==========================================================

  select
    membership_row.organization_id,
    membership_row.user_id
  into
    v_member_org,
    v_member_user
  from public.memberships membership_row
  where membership_row.is_active is true
    and membership_row.user_id is not null
    and exists (
      select 1
      from auth.users user_row
      where user_row.id = membership_row.user_id
    )
  order by membership_row.created_at nulls last
  limit 1;

  if v_member_org is null or v_member_user is null then
    raise exception using
      errcode = 'P0001',
      message = 'MANUAL_CHECK_PREREQUISITE_NO_ACTIVE_MEMBERSHIP';
  end if;


  -- Temporary DEV fixtures.
  -- Entire suite is rolled back.

  insert into public.stores (
    id,
    organization_id,
    name
  )
  values (
    v_store_a,
    v_member_org,
    'P19A Schedule Check Store A'
  );

  insert into public.organizations (
    id,
    name
  )
  values (
    v_org_b,
    'P19A Schedule Check Org B'
  );

  insert into public.stores (
    id,
    organization_id,
    name
  )
  values (
    v_store_b,
    v_org_b,
    'P19A Schedule Check Store B'
  );


  -- ==========================================================
  -- AUTH / TENANT
  -- ==========================================================

  perform set_config(
    'request.jwt.claim.role',
    'authenticated',
    true
  );

  perform set_config(
    'request.jwt.claim.sub',
    v_member_user::text,
    true
  );

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'authenticated',
      'sub', v_member_user::text
    )::text,
    true
  );

  if auth.uid() = v_member_user
     and public.zion_resolve_request_role_internal() = 'authenticated' then
    perform pg_temp.p19a_record(
      1,
      'authenticated claims resolvem usuario DEV real',
      'PASS'
    );
  else
    perform pg_temp.p19a_record(
      1,
      'authenticated claims resolvem usuario DEV real',
      'SUT_FAIL',
      format(
        'auth.uid=%s resolver=%s expected_user=%s',
        auth.uid(),
        public.zion_resolve_request_role_internal(),
        v_member_user
      )
    );
  end if;


  begin
    select *
    into v_row
    from public.upsert_store_human_schedule_configuration_scoped(
      p_organization_id => v_member_org,
      p_store_id => v_store_a,
      p_operating_days => '["segunda","terca"]'::jsonb,
      p_operating_hours =>
        '{
          "segunda":{"start":"09:00","end":"18:00"},
          "terca":{"start":"09:00","end":"18:00"}
        }'::jsonb,
      p_timezone_name => 'America/Sao_Paulo',
      p_holiday_mode => 'closed'
    );

    if v_row.store_id = v_store_a
       and v_row.organization_id = v_member_org then
      perform pg_temp.p19a_record(
        2,
        'authenticated com membership ativa pode gravar sua store',
        'PASS'
      );
    else
      perform pg_temp.p19a_record(
        2,
        'authenticated com membership ativa pode gravar sua store',
        'SUT_FAIL',
        v_row::text
      );
    end if;

  exception
    when others then
      perform pg_temp.p19a_record(
        2,
        'authenticated com membership ativa pode gravar sua store',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  -- Same authenticated role, but a UUID without membership.

  perform set_config(
    'request.jwt.claim.sub',
    v_random_user::text,
    true
  );

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'authenticated',
      'sub', v_random_user::text
    )::text,
    true
  );

  begin
    perform public.upsert_store_human_schedule_configuration_scoped(
      p_organization_id => v_member_org,
      p_store_id => v_store_a,
      p_operating_days => '["segunda"]'::jsonb,
      p_operating_hours =>
        '{"segunda":{"start":"09:00","end":"18:00"}}'::jsonb,
      p_timezone_name => 'America/Sao_Paulo',
      p_holiday_mode => 'closed'
    );

    perform pg_temp.p19a_record(
      3,
      'authenticated sem membership e bloqueado',
      'SUT_FAIL',
      'writer accepted user without membership'
    );

  exception
    when sqlstate '42501' then
      perform pg_temp.p19a_record(
        3,
        'authenticated sem membership e bloqueado',
        'PASS'
      );

    when others then
      perform pg_temp.p19a_record(
        3,
        'authenticated sem membership e bloqueado',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  -- Restore valid authenticated user and prove cross-tenant store mismatch.

  perform set_config(
    'request.jwt.claim.sub',
    v_member_user::text,
    true
  );

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'authenticated',
      'sub', v_member_user::text
    )::text,
    true
  );

  begin
    perform public.upsert_store_human_schedule_configuration_scoped(
      p_organization_id => v_member_org,
      p_store_id => v_store_b,
      p_operating_days => '["segunda"]'::jsonb,
      p_operating_hours =>
        '{"segunda":{"start":"09:00","end":"18:00"}}'::jsonb,
      p_timezone_name => 'America/Sao_Paulo',
      p_holiday_mode => 'closed'
    );

    perform pg_temp.p19a_record(
      4,
      'org A + store B de outra org e bloqueado',
      'SUT_FAIL',
      'cross-tenant store accepted'
    );

  exception
    when sqlstate '42501' then
      perform pg_temp.p19a_record(
        4,
        'org A + store B de outra org e bloqueado',
        'PASS'
      );

    when others then
      perform pg_temp.p19a_record(
        4,
        'org A + store B de outra org e bloqueado',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  -- Explicit service_role claim must NOT become postgres merely because
  -- SQL Editor session_user is postgres.

  perform set_config(
    'request.jwt.claim.role',
    'service_role',
    true
  );

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'service_role',
      'sub', v_member_user::text
    )::text,
    true
  );

  begin
    perform public.upsert_store_human_schedule_configuration_scoped(
      p_organization_id => v_member_org,
      p_store_id => v_store_a,
      p_operating_days => '["segunda"]'::jsonb,
      p_operating_hours =>
        '{"segunda":{"start":"09:00","end":"18:00"}}'::jsonb,
      p_timezone_name => 'America/Sao_Paulo',
      p_holiday_mode => 'closed'
    );

    perform pg_temp.p19a_record(
      5,
      'service_role explicito nao fura autoridade postgres',
      'SUT_FAIL',
      'service_role accepted'
    );

  exception
    when sqlstate '42501' then
      perform pg_temp.p19a_record(
        5,
        'service_role explicito nao fura autoridade postgres',
        'PASS'
      );

    when others then
      perform pg_temp.p19a_record(
        5,
        'service_role explicito nao fura autoridade postgres',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  -- Restore postgres execution context for the remaining semantic checks.

  perform set_config(
    'request.jwt.claim.role',
    'postgres',
    true
  );

  perform set_config(
    'request.jwt.claim.sub',
    '',
    true
  );

  perform set_config(
    'request.jwt.claims',
    '{"role":"postgres"}',
    true
  );


  -- ==========================================================
  -- HUMAN SCHEDULE VALIDATION
  -- ==========================================================

  begin
    perform public.upsert_store_human_schedule_configuration_scoped(
      p_organization_id => v_member_org,
      p_store_id => v_store_a,
      p_operating_days => '["dia_invalido"]'::jsonb,
      p_operating_hours =>
        '{"dia_invalido":{"start":"09:00","end":"18:00"}}'::jsonb,
      p_timezone_name => 'America/Sao_Paulo',
      p_holiday_mode => 'closed'
    );

    perform pg_temp.p19a_record(
      6,
      'dia operacional invalido e bloqueado',
      'SUT_FAIL',
      'invalid day accepted'
    );

  exception
    when sqlstate '22023' then
      perform pg_temp.p19a_record(
        6,
        'dia operacional invalido e bloqueado',
        'PASS'
      );

    when others then
      perform pg_temp.p19a_record(
        6,
        'dia operacional invalido e bloqueado',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  begin
    perform public.upsert_store_human_schedule_configuration_scoped(
      p_organization_id => v_member_org,
      p_store_id => v_store_a,
      p_operating_days => '["segunda"]'::jsonb,
      p_operating_hours =>
        '{"segunda":{"start":"18:00","end":"09:00"}}'::jsonb,
      p_timezone_name => 'America/Sao_Paulo',
      p_holiday_mode => 'closed'
    );

    perform pg_temp.p19a_record(
      7,
      'horario invertido e bloqueado',
      'SUT_FAIL',
      'invalid hours accepted'
    );

  exception
    when sqlstate '22023' then
      perform pg_temp.p19a_record(
        7,
        'horario invertido e bloqueado',
        'PASS'
      );

    when others then
      perform pg_temp.p19a_record(
        7,
        'horario invertido e bloqueado',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  begin
    perform public.upsert_store_human_schedule_configuration_scoped(
      p_organization_id => v_member_org,
      p_store_id => v_store_a,
      p_operating_days => '["segunda"]'::jsonb,
      p_operating_hours =>
        '{"segunda":{"start":"09:00","end":"18:00"}}'::jsonb,
      p_timezone_name => 'Timezone/Inexistente',
      p_holiday_mode => 'closed'
    );

    perform pg_temp.p19a_record(
      8,
      'timezone invalido e bloqueado',
      'SUT_FAIL',
      'invalid timezone accepted'
    );

  exception
    when sqlstate '22023' then
      perform pg_temp.p19a_record(
        8,
        'timezone invalido e bloqueado',
        'PASS'
      );

    when others then
      perform pg_temp.p19a_record(
        8,
        'timezone invalido e bloqueado',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  begin
    perform public.upsert_store_human_schedule_configuration_scoped(
      p_organization_id => v_member_org,
      p_store_id => v_store_a,
      p_operating_days => '["segunda"]'::jsonb,
      p_operating_hours =>
        '{"segunda":{"start":"09:00","end":"18:00"}}'::jsonb,
      p_timezone_name => 'America/Sao_Paulo',
      p_holiday_mode => 'special'
    );

    perform pg_temp.p19a_record(
      9,
      'feriado special sem horario e bloqueado',
      'SUT_FAIL',
      'special without times accepted'
    );

  exception
    when sqlstate '22023' then
      perform pg_temp.p19a_record(
        9,
        'feriado special sem horario e bloqueado',
        'PASS'
      );

    when others then
      perform pg_temp.p19a_record(
        9,
        'feriado special sem horario e bloqueado',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  begin
    perform public.upsert_store_human_schedule_configuration_scoped(
      p_organization_id => v_member_org,
      p_store_id => v_store_a,
      p_operating_days => '["segunda"]'::jsonb,
      p_operating_hours =>
        '{"segunda":{"start":"09:00","end":"18:00"}}'::jsonb,
      p_timezone_name => 'America/Sao_Paulo',
      p_holiday_mode => 'case_by_case'
    );

    perform pg_temp.p19a_record(
      10,
      'feriado case_by_case sem observacao e bloqueado',
      'SUT_FAIL',
      'case_by_case without notes accepted'
    );

  exception
    when sqlstate '22023' then
      perform pg_temp.p19a_record(
        10,
        'feriado case_by_case sem observacao e bloqueado',
        'PASS'
      );

    when others then
      perform pg_temp.p19a_record(
        10,
        'feriado case_by_case sem observacao e bloqueado',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  -- Normal mode.

  select *
  into v_row
  from public.upsert_store_human_schedule_configuration_scoped(
    p_organization_id => v_member_org,
    p_store_id => v_store_a,
    p_operating_days => '["segunda","terca"]'::jsonb,
    p_operating_hours =>
      '{
        "segunda":{"start":"09:00","end":"18:00"},
        "terca":{"start":"10:00","end":"17:00"}
      }'::jsonb,
    p_timezone_name => 'America/Sao_Paulo',
    p_holiday_mode => 'normal',
    p_holiday_open_time => '11:00'::time,
    p_holiday_close_time => '13:00'::time,
    p_holiday_notes => 'deve ser limpo'
  );

  if v_row.holiday_mode = 'normal'
     and v_row.attends_holidays is true
     and v_row.holiday_open_time is null
     and v_row.holiday_close_time is null
     and v_row.holiday_notes is null then
    perform pg_temp.p19a_record(
      11,
      'feriado normal canonicaliza dados condicionais',
      'PASS'
    );
  else
    perform pg_temp.p19a_record(
      11,
      'feriado normal canonicaliza dados condicionais',
      'SUT_FAIL',
      v_row::text
    );
  end if;


  -- Special must remain legacy fail-closed.

  select *
  into v_row
  from public.upsert_store_human_schedule_configuration_scoped(
    p_organization_id => v_member_org,
    p_store_id => v_store_a,
    p_operating_days => '["segunda","terca"]'::jsonb,
    p_operating_hours =>
      '{
        "segunda":{"start":"09:00","end":"18:00"},
        "terca":{"start":"10:00","end":"17:00"}
      }'::jsonb,
    p_timezone_name => 'America/Sao_Paulo',
    p_holiday_mode => 'special',
    p_holiday_open_time => '10:00'::time,
    p_holiday_close_time => '14:00'::time,
    p_holiday_notes => 'deve ser limpo'
  );

  v_human_configured_at := v_row.human_schedule_configured_at;

  if v_row.holiday_mode = 'special'
     and v_row.attends_holidays is false
     and v_row.holiday_open_time = '10:00'::time
     and v_row.holiday_close_time = '14:00'::time
     and v_row.holiday_notes is null
     and v_human_configured_at is not null then
    perform pg_temp.p19a_record(
      12,
      'feriado special persiste horario e mirror legado fail-closed',
      'PASS'
    );
  else
    perform pg_temp.p19a_record(
      12,
      'feriado special persiste horario e mirror legado fail-closed',
      'SUT_FAIL',
      v_row::text
    );
  end if;


  -- Verify bootstrap did not invent decisions for other cards and
  -- did not activate enforce_operating_window.

  if v_row.ai_after_hours_configured_at is null
     and v_row.agenda_capacity_configured_at is null
     and v_row.enforce_operating_window is false
     and v_row.ai_after_hours_enabled is false
     and v_row.ai_after_hours_mode is null
     and v_row.ai_attends_holidays is false
     and v_row.daily_limit_mode is null
     and v_row.daily_limit is null
     and v_row.appointment_buffer_enabled is null
     and v_row.appointment_buffer_minutes is null then
    perform pg_temp.p19a_record(
      13,
      'bootstrap nao inventa configuracao de agenda ou after-hours',
      'PASS'
    );
  else
    perform pg_temp.p19a_record(
      13,
      'bootstrap nao inventa configuracao de agenda ou after-hours',
      'SUT_FAIL',
      v_row::text
    );
  end if;


  -- Deterministic replay proof.

  update public.store_schedule_settings
  set updated_at = '2000-01-01 00:00:00+00'::timestamptz
  where organization_id = v_member_org
    and store_id = v_store_a;

  select *
  into v_row
  from public.upsert_store_human_schedule_configuration_scoped(
    p_organization_id => v_member_org,
    p_store_id => v_store_a,
    p_operating_days => '["segunda","terca"]'::jsonb,
    p_operating_hours =>
      '{
        "segunda":{"start":"09:00","end":"18:00"},
        "terca":{"start":"10:00","end":"17:00"}
      }'::jsonb,
    p_timezone_name => 'America/Sao_Paulo',
    p_holiday_mode => 'special',
    p_holiday_open_time => '10:00'::time,
    p_holiday_close_time => '14:00'::time
  );

  if v_row.human_schedule_configured_at = v_human_configured_at
     and v_row.updated_at >
       '2000-01-01 00:00:00+00'::timestamptz then
    perform pg_temp.p19a_record(
      14,
      'human schedule replay preserva primeiro configured_at',
      'PASS'
    );
  else
    perform pg_temp.p19a_record(
      14,
      'human schedule replay preserva primeiro configured_at',
      'SUT_FAIL',
      v_row::text
    );
  end if;


  -- Legitimate change also preserves first configured_at.

  select *
  into v_row
  from public.upsert_store_human_schedule_configuration_scoped(
    p_organization_id => v_member_org,
    p_store_id => v_store_a,
    p_operating_days => '["quarta"]'::jsonb,
    p_operating_hours =>
      '{"quarta":{"start":"08:00","end":"12:00"}}'::jsonb,
    p_timezone_name => 'America/Sao_Paulo',
    p_holiday_mode => 'case_by_case',
    p_holiday_notes => 'Abrir somente mediante decisao humana'
  );

  if v_row.human_schedule_configured_at = v_human_configured_at
     and v_row.holiday_mode = 'case_by_case'
     and v_row.attends_holidays is false
     and v_row.holiday_open_time is null
     and v_row.holiday_close_time is null
     and v_row.holiday_notes =
       'Abrir somente mediante decisao humana' then
    perform pg_temp.p19a_record(
      15,
      'mudanca legitima preserva primeiro human configured_at',
      'PASS'
    );
  else
    perform pg_temp.p19a_record(
      15,
      'mudanca legitima preserva primeiro human configured_at',
      'SUT_FAIL',
      v_row::text
    );
  end if;


  -- ==========================================================
  -- AI AFTER HOURS
  -- ==========================================================

  begin
    perform public.upsert_store_schedule_ai_after_hours_policy_scoped(
      p_organization_id => v_org_b,
      p_store_id => v_store_b,
      p_ai_after_hours_enabled => true,
      p_ai_after_hours_mode => 'all_closed_hours',
      p_ai_attends_holidays => false
    );

    perform pg_temp.p19a_record(
      16,
      'after-hours exige schedule row existente',
      'SUT_FAIL',
      'missing schedule row accepted'
    );

  exception
    when sqlstate '22023' then
      perform pg_temp.p19a_record(
        16,
        'after-hours exige schedule row existente',
        'PASS'
      );

    when others then
      perform pg_temp.p19a_record(
        16,
        'after-hours exige schedule row existente',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  begin
    perform public.upsert_store_schedule_ai_after_hours_policy_scoped(
      p_organization_id => v_member_org,
      p_store_id => v_store_a,
      p_ai_after_hours_enabled => null,
      p_ai_after_hours_mode => null
    );

    perform pg_temp.p19a_record(
      17,
      'after-hours enabled null e bloqueado',
      'SUT_FAIL',
      'null enabled accepted'
    );

  exception
    when sqlstate '22023' then
      perform pg_temp.p19a_record(
        17,
        'after-hours enabled null e bloqueado',
        'PASS'
      );

    when others then
      perform pg_temp.p19a_record(
        17,
        'after-hours enabled null e bloqueado',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  begin
    perform public.upsert_store_schedule_ai_after_hours_policy_scoped(
      p_organization_id => v_member_org,
      p_store_id => v_store_a,
      p_ai_after_hours_enabled => true,
      p_ai_after_hours_mode => null
    );

    perform pg_temp.p19a_record(
      18,
      'after-hours ativo exige modo',
      'SUT_FAIL',
      'enabled without mode accepted'
    );

  exception
    when sqlstate '22023' then
      perform pg_temp.p19a_record(
        18,
        'after-hours ativo exige modo',
        'PASS'
      );

    when others then
      perform pg_temp.p19a_record(
        18,
        'after-hours ativo exige modo',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  begin
    perform public.upsert_store_schedule_ai_after_hours_policy_scoped(
      p_organization_id => v_member_org,
      p_store_id => v_store_a,
      p_ai_after_hours_enabled => true,
      p_ai_after_hours_mode => 'specific_window',
      p_ai_after_hours_start => '19:00'::time,
      p_ai_after_hours_end => null,
      p_ai_attends_holidays => false
    );

    perform pg_temp.p19a_record(
      19,
      'specific_window exige inicio e fim',
      'SUT_FAIL',
      'incomplete window accepted'
    );

  exception
    when sqlstate '22023' then
      perform pg_temp.p19a_record(
        19,
        'specific_window exige inicio e fim',
        'PASS'
      );

    when others then
      perform pg_temp.p19a_record(
        19,
        'specific_window exige inicio e fim',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  select *
  into v_row
  from public.upsert_store_schedule_ai_after_hours_policy_scoped(
    p_organization_id => v_member_org,
    p_store_id => v_store_a,
    p_ai_after_hours_enabled => true,
    p_ai_after_hours_mode => 'specific_window',
    p_ai_after_hours_start => '19:00'::time,
    p_ai_after_hours_end => '22:00'::time,
    p_ai_attends_holidays => true
  );

  v_after_hours_configured_at :=
    v_row.ai_after_hours_configured_at;

  if v_after_hours_configured_at is not null
     and v_row.ai_after_hours_enabled is true
     and v_row.ai_after_hours_mode = 'specific_window'
     and v_row.ai_after_hours_start = '19:00'::time
     and v_row.ai_after_hours_end = '22:00'::time
     and v_row.ai_attends_holidays is true then
    perform pg_temp.p19a_record(
      20,
      'after-hours happy path persiste policy canonica',
      'PASS'
    );
  else
    perform pg_temp.p19a_record(
      20,
      'after-hours happy path persiste policy canonica',
      'SUT_FAIL',
      v_row::text
    );
  end if;


  update public.store_schedule_settings
  set updated_at = '2000-01-01 00:00:00+00'::timestamptz
  where organization_id = v_member_org
    and store_id = v_store_a;

  select *
  into v_row
  from public.upsert_store_schedule_ai_after_hours_policy_scoped(
    p_organization_id => v_member_org,
    p_store_id => v_store_a,
    p_ai_after_hours_enabled => true,
    p_ai_after_hours_mode => 'specific_window',
    p_ai_after_hours_start => '19:00'::time,
    p_ai_after_hours_end => '22:00'::time,
    p_ai_attends_holidays => true
  );

  if v_row.ai_after_hours_configured_at =
       v_after_hours_configured_at
     and v_row.updated_at >
       '2000-01-01 00:00:00+00'::timestamptz then
    perform pg_temp.p19a_record(
      21,
      'after-hours replay preserva primeiro configured_at',
      'PASS'
    );
  else
    perform pg_temp.p19a_record(
      21,
      'after-hours replay preserva primeiro configured_at',
      'SUT_FAIL',
      v_row::text
    );
  end if;


  select *
  into v_row
  from public.upsert_store_schedule_ai_after_hours_policy_scoped(
    p_organization_id => v_member_org,
    p_store_id => v_store_a,
    p_ai_after_hours_enabled => false,
    p_ai_after_hours_mode => 'specific_window',
    p_ai_after_hours_start => '19:00'::time,
    p_ai_after_hours_end => '22:00'::time,
    p_ai_attends_holidays => true
  );

  if v_row.ai_after_hours_configured_at =
       v_after_hours_configured_at
     and v_row.ai_after_hours_enabled is false
     and v_row.ai_after_hours_mode is null
     and v_row.ai_after_hours_start is null
     and v_row.ai_after_hours_end is null
     and v_row.ai_attends_holidays is false then
    perform pg_temp.p19a_record(
      22,
      'after-hours desativado limpa todos os dependentes',
      'PASS'
    );
  else
    perform pg_temp.p19a_record(
      22,
      'after-hours desativado limpa todos os dependentes',
      'SUT_FAIL',
      v_row::text
    );
  end if;


  -- ==========================================================
  -- AGENDA CAPACITY
  -- ==========================================================

  begin
    perform public.upsert_store_agenda_capacity_configuration_scoped(
      p_organization_id => v_org_b,
      p_store_id => v_store_b,
      p_allow_multiple_appointments_per_day => true,
      p_allow_same_time_appointments => false,
      p_appointment_buffer_enabled => false,
      p_daily_limit_mode => 'no_fixed_limit'
    );

    perform pg_temp.p19a_record(
      23,
      'agenda exige schedule row existente',
      'SUT_FAIL',
      'missing schedule row accepted'
    );

  exception
    when sqlstate '22023' then
      perform pg_temp.p19a_record(
        23,
        'agenda exige schedule row existente',
        'PASS'
      );

    when others then
      perform pg_temp.p19a_record(
        23,
        'agenda exige schedule row existente',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  begin
    perform public.upsert_store_agenda_capacity_configuration_scoped(
      p_organization_id => v_member_org,
      p_store_id => v_store_a,
      p_allow_multiple_appointments_per_day => true,
      p_allow_same_time_appointments => false,
      p_appointment_buffer_enabled => false,
      p_daily_limit_mode => null
    );

    perform pg_temp.p19a_record(
      24,
      'agenda multipla exige daily_limit_mode',
      'SUT_FAIL',
      'null daily limit mode accepted'
    );

  exception
    when sqlstate '22023' then
      perform pg_temp.p19a_record(
        24,
        'agenda multipla exige daily_limit_mode',
        'PASS'
      );

    when others then
      perform pg_temp.p19a_record(
        24,
        'agenda multipla exige daily_limit_mode',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  begin
    perform public.upsert_store_agenda_capacity_configuration_scoped(
      p_organization_id => v_member_org,
      p_store_id => v_store_a,
      p_allow_multiple_appointments_per_day => true,
      p_allow_same_time_appointments => null,
      p_appointment_buffer_enabled => false,
      p_daily_limit_mode => 'no_fixed_limit'
    );

    perform pg_temp.p19a_record(
      25,
      'agenda nao transforma same-time omitido em nao',
      'SUT_FAIL',
      'null same-time policy accepted'
    );

  exception
    when sqlstate '22023' then
      perform pg_temp.p19a_record(
        25,
        'agenda nao transforma same-time omitido em nao',
        'PASS'
      );

    when others then
      perform pg_temp.p19a_record(
        25,
        'agenda nao transforma same-time omitido em nao',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  begin
    perform public.upsert_store_agenda_capacity_configuration_scoped(
      p_organization_id => v_member_org,
      p_store_id => v_store_a,
      p_allow_multiple_appointments_per_day => true,
      p_allow_same_time_appointments => false,
      p_appointment_buffer_enabled => null,
      p_daily_limit_mode => 'no_fixed_limit'
    );

    perform pg_temp.p19a_record(
      26,
      'agenda nao transforma buffer omitido em nao',
      'SUT_FAIL',
      'null buffer policy accepted'
    );

  exception
    when sqlstate '22023' then
      perform pg_temp.p19a_record(
        26,
        'agenda nao transforma buffer omitido em nao',
        'PASS'
      );

    when others then
      perform pg_temp.p19a_record(
        26,
        'agenda nao transforma buffer omitido em nao',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  begin
    perform public.upsert_store_agenda_capacity_configuration_scoped(
      p_organization_id => v_member_org,
      p_store_id => v_store_a,
      p_allow_multiple_appointments_per_day => true,
      p_allow_same_time_appointments => false,
      p_appointment_buffer_enabled => false,
      p_daily_limit_mode => 'fixed_limit',
      p_daily_limit => 1
    );

    perform pg_temp.p19a_record(
      27,
      'agenda multipla rejeita limite diario 1',
      'SUT_FAIL',
      'multiple appointments with daily limit 1 accepted'
    );

  exception
    when sqlstate '22023' then
      perform pg_temp.p19a_record(
        27,
        'agenda multipla rejeita limite diario 1',
        'PASS'
      );

    when others then
      perform pg_temp.p19a_record(
        27,
        'agenda multipla rejeita limite diario 1',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  begin
    perform public.upsert_store_agenda_capacity_configuration_scoped(
      p_organization_id => v_member_org,
      p_store_id => v_store_a,
      p_allow_multiple_appointments_per_day => true,
      p_allow_same_time_appointments => true,
      p_appointment_buffer_enabled => false,
      p_daily_limit_mode => 'no_fixed_limit',
      p_same_time_capacity => 1
    );

    perform pg_temp.p19a_record(
      28,
      'same-time ativo exige capacidade minima 2',
      'SUT_FAIL',
      'same-time capacity 1 accepted'
    );

  exception
    when sqlstate '22023' then
      perform pg_temp.p19a_record(
        28,
        'same-time ativo exige capacidade minima 2',
        'PASS'
      );

    when others then
      perform pg_temp.p19a_record(
        28,
        'same-time ativo exige capacidade minima 2',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  begin
    perform public.upsert_store_agenda_capacity_configuration_scoped(
      p_organization_id => v_member_org,
      p_store_id => v_store_a,
      p_allow_multiple_appointments_per_day => true,
      p_allow_same_time_appointments => false,
      p_appointment_buffer_enabled => true,
      p_daily_limit_mode => 'no_fixed_limit',
      p_appointment_buffer_minutes => null
    );

    perform pg_temp.p19a_record(
      29,
      'buffer ativo exige minutos',
      'SUT_FAIL',
      'enabled buffer without minutes accepted'
    );

  exception
    when sqlstate '22023' then
      perform pg_temp.p19a_record(
        29,
        'buffer ativo exige minutos',
        'PASS'
      );

    when others then
      perform pg_temp.p19a_record(
        29,
        'buffer ativo exige minutos',
        'HARNESS_ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;


  select *
  into v_row
  from public.upsert_store_agenda_capacity_configuration_scoped(
    p_organization_id => v_member_org,
    p_store_id => v_store_a,
    p_allow_multiple_appointments_per_day => true,
    p_allow_same_time_appointments => true,
    p_appointment_buffer_enabled => true,
    p_daily_limit_mode => 'fixed_limit',
    p_daily_limit => 5,
    p_same_time_capacity => 3,
    p_appointment_buffer_minutes => 15
  );

  v_agenda_configured_at :=
    v_row.agenda_capacity_configured_at;

  if v_agenda_configured_at is not null
     and v_row.allow_multiple_appointments_per_day is true
     and v_row.daily_limit_mode = 'fixed_limit'
     and v_row.daily_limit = 5
     and v_row.allow_same_time_appointments is true
     and v_row.same_time_capacity = 3
     and v_row.appointment_buffer_enabled is true
     and v_row.appointment_buffer_minutes = 15 then
    perform pg_temp.p19a_record(
      30,
      'agenda happy path persiste capacidade completa',
      'PASS'
    );
  else
    perform pg_temp.p19a_record(
      30,
      'agenda happy path persiste capacidade completa',
      'SUT_FAIL',
      v_row::text
    );
  end if;


  update public.store_schedule_settings
  set updated_at = '2000-01-01 00:00:00+00'::timestamptz
  where organization_id = v_member_org
    and store_id = v_store_a;

  select *
  into v_row
  from public.upsert_store_agenda_capacity_configuration_scoped(
    p_organization_id => v_member_org,
    p_store_id => v_store_a,
    p_allow_multiple_appointments_per_day => true,
    p_allow_same_time_appointments => true,
    p_appointment_buffer_enabled => true,
    p_daily_limit_mode => 'fixed_limit',
    p_daily_limit => 5,
    p_same_time_capacity => 3,
    p_appointment_buffer_minutes => 15
  );

  if v_row.agenda_capacity_configured_at =
       v_agenda_configured_at
     and v_row.updated_at >
       '2000-01-01 00:00:00+00'::timestamptz then
    perform pg_temp.p19a_record(
      31,
      'agenda replay preserva primeiro configured_at',
      'PASS'
    );
  else
    perform pg_temp.p19a_record(
      31,
      'agenda replay preserva primeiro configured_at',
      'SUT_FAIL',
      v_row::text
    );
  end if;


  -- Legitimate change to no fixed limit.

  select *
  into v_row
  from public.upsert_store_agenda_capacity_configuration_scoped(
    p_organization_id => v_member_org,
    p_store_id => v_store_a,
    p_allow_multiple_appointments_per_day => true,
    p_allow_same_time_appointments => false,
    p_appointment_buffer_enabled => false,
    p_daily_limit_mode => 'no_fixed_limit',
    p_daily_limit => 99,
    p_same_time_capacity => 99,
    p_appointment_buffer_minutes => 99
  );

  if v_row.agenda_capacity_configured_at =
       v_agenda_configured_at
     and v_row.daily_limit_mode = 'no_fixed_limit'
     and v_row.daily_limit is null
     and v_row.allow_same_time_appointments is false
     and v_row.same_time_capacity = 1
     and v_row.appointment_buffer_enabled is false
     and v_row.appointment_buffer_minutes is null then
    perform pg_temp.p19a_record(
      32,
      'agenda limpa stale data e preserva configured_at',
      'PASS'
    );
  else
    perform pg_temp.p19a_record(
      32,
      'agenda limpa stale data e preserva configured_at',
      'SUT_FAIL',
      v_row::text
    );
  end if;


  -- Single appointment mode must ignore/canonicalize all dependent data.

  select *
  into v_row
  from public.upsert_store_agenda_capacity_configuration_scoped(
    p_organization_id => v_member_org,
    p_store_id => v_store_a,
    p_allow_multiple_appointments_per_day => false,
    p_allow_same_time_appointments => true,
    p_appointment_buffer_enabled => true,
    p_daily_limit_mode => 'no_fixed_limit',
    p_daily_limit => 9,
    p_same_time_capacity => 9,
    p_appointment_buffer_minutes => 30
  );

  if v_row.agenda_capacity_configured_at =
       v_agenda_configured_at
     and v_row.allow_multiple_appointments_per_day is false
     and v_row.daily_limit_mode = 'fixed_limit'
     and v_row.daily_limit = 1
     and v_row.allow_same_time_appointments is false
     and v_row.same_time_capacity = 1
     and v_row.appointment_buffer_enabled is false
     and v_row.appointment_buffer_minutes is null then
    perform pg_temp.p19a_record(
      33,
      'agenda single appointment canonicaliza dependencias',
      'PASS'
    );
  else
    perform pg_temp.p19a_record(
      33,
      'agenda single appointment canonicaliza dependencias',
      'SUT_FAIL',
      v_row::text
    );
  end if;


  -- ==========================================================
  -- FINAL INTEGRITY
  -- ==========================================================

  select count(*)
  into v_count
  from public.store_schedule_settings
  where organization_id = v_org_b
    and store_id = v_store_b;

  if v_count = 0 then
    perform pg_temp.p19a_record(
      34,
      'writers que exigem row nao fabricaram schedule na store B',
      'PASS'
    );
  else
    perform pg_temp.p19a_record(
      34,
      'writers que exigem row nao fabricaram schedule na store B',
      'SUT_FAIL',
      format('rows=%s', v_count)
    );
  end if;

end;
$$;


-- ============================================================
-- HARD GATE
--
-- Exactly 34 checks.
-- Any missing result, SUT_FAIL or HARNESS_ERROR aborts the suite.
-- ============================================================

do $$
declare
  v_total integer;
  v_pass integer;
  v_sut_fail integer;
  v_harness_error integer;
begin
  select
    count(*),
    count(*) filter (where status = 'PASS'),
    count(*) filter (where status = 'SUT_FAIL'),
    count(*) filter (where status = 'HARNESS_ERROR')
  into
    v_total,
    v_pass,
    v_sut_fail,
    v_harness_error
  from p19a_schedule_checks;

  if v_total <> 34
     or v_pass <> 34
     or v_sut_fail <> 0
     or v_harness_error <> 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'P19A_SCHEDULE_MANUAL_CHECKS_FAILED total=%s pass=%s sut_fail=%s harness_error=%s',
        v_total,
        v_pass,
        v_sut_fail,
        v_harness_error
      );
  end if;
end;
$$;


select
  check_no,
  check_name,
  status,
  details
from p19a_schedule_checks
order by check_no;

rollback;
