-- Manual checks for P19-A Sales AI after-hours policy writer.
-- Run in an isolated transaction after applying
-- 20260903120000_p19a_sales_ai_after_hours_policy.sql.
-- This file is intentionally not executed by Codex.

begin;

do $$
declare
  v_org_id uuid := gen_random_uuid();
  v_store_id uuid := gen_random_uuid();
  v_other_store_id uuid := gen_random_uuid();
  v_result public.store_schedule_settings%rowtype;
begin
  insert into public.organizations (id, name)
  values (v_org_id, 'P19A after-hours writer check org');

  insert into public.stores (id, organization_id, name)
  values
    (v_store_id, v_org_id, 'P19A after-hours writer check store'),
    (v_other_store_id, v_org_id, 'P19A after-hours writer other store');

  insert into public.store_schedule_settings (
    organization_id,
    store_id,
    operating_days,
    operating_hours,
    timezone_name
  )
  values
    (
      v_org_id,
      v_store_id,
      '["segunda","terca","quarta","quinta","sexta"]'::jsonb,
      '{"segunda":{"start":"08:00","end":"18:00"}}'::jsonb,
      'America/Sao_Paulo'
    ),
    (
      v_org_id,
      v_other_store_id,
      '["segunda","terca","quarta","quinta","sexta"]'::jsonb,
      '{"segunda":{"start":"08:00","end":"18:00"}}'::jsonb,
      'America/Sao_Paulo'
    );

  v_result := public.upsert_store_schedule_ai_after_hours_policy_scoped(
    v_org_id,
    v_store_id,
    false,
    null,
    null,
    null,
    false
  );

  if v_result.ai_after_hours_enabled is not false
     or v_result.ai_after_hours_mode is not null
     or v_result.ai_after_hours_start is not null
     or v_result.ai_after_hours_end is not null
     or v_result.ai_attends_holidays is not false then
    raise exception 'SUT_FAIL: disabled policy was not saved fail-closed';
  end if;

  v_result := public.upsert_store_schedule_ai_after_hours_policy_scoped(
    v_org_id,
    v_store_id,
    true,
    'all_closed_hours',
    null,
    null,
    true
  );

  if v_result.ai_after_hours_enabled is not true
     or v_result.ai_after_hours_mode <> 'all_closed_hours'
     or v_result.ai_after_hours_start is not null
     or v_result.ai_after_hours_end is not null
     or v_result.ai_attends_holidays is not true then
    raise exception 'SUT_FAIL: all_closed_hours policy was not saved';
  end if;

  v_result := public.upsert_store_schedule_ai_after_hours_policy_scoped(
    v_org_id,
    v_store_id,
    true,
    'specific_window',
    '18:00'::time,
    '23:00'::time,
    false
  );

  if v_result.ai_after_hours_enabled is not true
     or v_result.ai_after_hours_mode <> 'specific_window'
     or v_result.ai_after_hours_start <> '18:00'::time
     or v_result.ai_after_hours_end <> '23:00'::time
     or v_result.ai_attends_holidays is not false then
    raise exception 'SUT_FAIL: specific_window policy was not saved';
  end if;

  begin
    perform public.upsert_store_schedule_ai_after_hours_policy_scoped(
      v_org_id,
      v_store_id,
      true,
      'specific_window',
      null,
      '23:00'::time,
      false
    );
    raise exception 'SUT_FAIL: incomplete specific_window was accepted';
  exception
    when check_violation then
      null;
  end;

  begin
    perform public.upsert_store_schedule_ai_after_hours_policy_scoped(
      v_org_id,
      gen_random_uuid(),
      true,
      'all_closed_hours',
      null,
      null,
      false
    );
    raise exception 'SUT_FAIL: wrong tenant/store scope was accepted';
  exception
    when insufficient_privilege then
      null;
  end;

  if exists (
    select 1
    from public.store_schedule_settings schedule_row
    where schedule_row.organization_id = v_org_id
      and schedule_row.store_id = v_other_store_id
      and schedule_row.ai_after_hours_enabled is true
  ) then
    raise exception 'SUT_FAIL: another store row was changed';
  end if;
end;
$$;

rollback;
