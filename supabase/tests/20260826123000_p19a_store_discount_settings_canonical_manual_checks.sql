-- P19-A / Etapa 3.3 / Descontos — runner revisado 2026-08-26
begin;

create temp table p19a_store_discount_settings_test_results (
  ordinal integer primary key,
  test_name text not null,
  result text not null,
  detail text not null
) on commit drop;

do $runner$
declare
  v_target public.stores%rowtype;
  v_other_store public.stores%rowtype;
  v_member public.memberships%rowtype;
  v_zion_row public.store_discount_settings%rowtype;
  v_zion_answer jsonb;
  v_discount_row public.store_discount_settings%rowtype;
  v_high_value_row public.store_high_value_discount_settings%rowtype;
  v_base_writer_regprocedure regprocedure;
  v_writer_regprocedure regprocedure;
  v_high_value_writer_regprocedure regprocedure;
  v_can_offer_answer jsonb;
  v_max_discount_answer jsonb;
  v_summary_answer jsonb;
  v_high_value_writer_definition text;
  v_normal_row_count bigint;
  v_high_value_row_count bigint;
begin
  select store_row.*
  into v_target
  from public.stores store_row
  join public.memberships membership_row
    on membership_row.organization_id = store_row.organization_id
   and membership_row.is_active is true
   and membership_row.user_id is not null
  order by store_row.created_at nulls last, store_row.id
  limit 1;

  if not found then
    raise exception 'FAIL: no store with active membership available to exercise discount settings runner';
  end if;

  select membership_row.*
  into v_member
  from public.memberships membership_row
  where membership_row.organization_id = v_target.organization_id
    and membership_row.is_active is true
    and membership_row.user_id is not null
  order by membership_row.created_at nulls last, membership_row.id
  limit 1;

  if not found then
    raise exception 'FAIL: no active membership available to exercise authenticated discount writers';
  end if;

  select *
  into v_other_store
  from public.stores
  where organization_id <> v_target.organization_id
  order by created_at nulls last, id
  limit 1;

  v_base_writer_regprocedure := pg_catalog.to_regprocedure(
    'public.upsert_store_discount_settings_scoped(uuid,uuid,numeric,numeric,boolean,text)'
  );
  v_writer_regprocedure := pg_catalog.to_regprocedure(
    'public.upsert_store_discount_settings_with_legacy_mirror_scoped(uuid,uuid,numeric,numeric,boolean,text)'
  );
  v_high_value_writer_regprocedure := pg_catalog.to_regprocedure(
    'public.upsert_store_high_value_discount_settings_scoped(uuid,uuid,boolean,integer,numeric)'
  );

  if v_base_writer_regprocedure is null then
    raise exception 'FAIL: internal discount base writer signature missing';
  end if;

  if v_writer_regprocedure is null then
    raise exception 'FAIL: transactional discount writer signature missing';
  end if;

  if v_high_value_writer_regprocedure is null then
    raise exception 'FAIL: high-value writer signature missing';
  end if;

  ---------------------------------------------------------------------------
  -- 01-04 schema and defaults
  ---------------------------------------------------------------------------

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_discount_settings'
      and column_name = 'discount_autonomy_mode'
      and is_nullable = 'NO'
      and column_default = '''approval_required''::text'
  ) then
    raise exception 'FAIL: discount_autonomy_mode column/default/not-null contract missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_discount_settings'
      and column_name = 'organization_id'
      and is_nullable = 'NO'
  ) then
    raise exception 'FAIL: store_discount_settings.organization_id must be NOT NULL';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.store_discount_settings'::regclass
      and conname = 'store_discount_settings_discount_autonomy_mode_valid'
  ) then
    raise exception 'FAIL: autonomy constraint missing';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.store_discount_settings'::regclass
      and conname = 'store_discount_settings_default_discount_requires_max'
  ) then
    raise exception 'FAIL: default/max relationship constraint missing';
  end if;

  begin
    perform public.upsert_store_discount_settings_scoped(
      v_target.organization_id,
      v_target.id,
      5,
      10,
      false,
      'invalid_mode'
    );
    raise exception 'FAIL: invalid autonomy mode should have been rejected';
  exception
    when sqlstate '23514' then
      null;
  end;

  if not exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.store_discount_settings'::regclass
      and trigger_row.tgname = 'store_discount_settings_touch_updated_at'
      and trigger_row.tgenabled = 'O'
  ) then
    raise exception 'FAIL: store_discount_settings updated_at trigger missing';
  end if;

  insert into p19a_store_discount_settings_test_results
  values
    (1, '01_schema_autonomy_column', 'PASS', 'organization scope is NOT NULL and discount_autonomy_mode exists with a safe default'),
    (2, '02_autonomy_constraint', 'PASS', 'autonomy/default-max constraints exist and invalid autonomy is rejected'),
    (3, '03_default_approval_required', 'PASS', 'discount_autonomy_mode defaults to approval_required'),
    (4, '04_updated_at_trigger', 'PASS', 'store_discount_settings updated_at trigger enabled');

  ---------------------------------------------------------------------------
  -- 05-07 writer value rules and historical conflict preservation
  ---------------------------------------------------------------------------

  begin
    perform public.upsert_store_discount_settings_scoped(
      v_target.organization_id,
      v_target.id,
      30,
      20,
      false,
      'approval_required'
    );
    raise exception 'FAIL: default > max should have been rejected';
  exception
    when sqlstate '23514' then
      null;
  end;

    select discount_row.*
  into v_zion_row
  from public.store_discount_settings discount_row
  where discount_row.default_discount_percent = 15
    and discount_row.max_discount_percent = 28
    and coalesce(discount_row.allow_ask_above_max_discount, false) is true
    and exists (
      select 1
      from public.store_onboarding_answers answer_row
      where answer_row.organization_id = discount_row.organization_id
        and answer_row.store_id = discount_row.store_id
        and answer_row.question_key = 'max_discount_percent'
        and answer_row.answer in (
          to_jsonb(18),
          to_jsonb('18'::text)
        )
    )
  order by discount_row.updated_at desc nulls last, discount_row.store_id
  limit 1;

  if not found then
    raise exception 'FAIL: expected the known unresolved 15/28 canonical vs legacy 18 conflict to remain present after migration install';
  end if;

  select answer_row.answer
  into v_zion_answer
  from public.store_onboarding_answers answer_row
  where answer_row.organization_id = v_zion_row.organization_id
    and answer_row.store_id = v_zion_row.store_id
    and answer_row.question_key = 'max_discount_percent'
    and answer_row.answer in (
      to_jsonb(18),
      to_jsonb('18'::text)
    )
  limit 1;

  if not found then
    raise exception 'FAIL: expected legacy max_discount_percent=18 evidence for the preserved canonical 15/28 policy';
  end if;

  if v_zion_row.default_discount_percent <> 15
     or v_zion_row.max_discount_percent <> 28
     or v_zion_answer not in (
       to_jsonb(18),
       to_jsonb('18'::text)
     )
  then
    raise exception 'FAIL: migration should preserve both canonical 15/28 and the unresolved legacy 18 evidence';
  end if;

  insert into p19a_store_discount_settings_test_results
  values
    (5, '05_default_gt_max_rejected', 'PASS', 'writer rejects first-step discount greater than normal max'),
    (6, '06_existing_15_28_preserved', 'PASS', 'existing canonical 15/28 policy stays intact after migration install'),
    (7, '07_legacy_18_does_not_overwrite_28', 'PASS', 'migration install does not reconcile or copy legacy 18 into canonical max 28');

  ---------------------------------------------------------------------------
  -- 08-14 high-value table and constraints
  ---------------------------------------------------------------------------

  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'store_high_value_discount_settings'
  ) then
    raise exception 'FAIL: store_high_value_discount_settings table missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_high_value_discount_settings'
      and column_name = 'enabled'
      and is_nullable = 'NO'
      and column_default = 'false'
  ) then
    raise exception 'FAIL: high-value enabled must default to false and be NOT NULL';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.store_high_value_discount_settings'::regclass
      and conname in (
        'store_high_value_discount_settings_disabled_children_cleared',
        'store_high_value_discount_settings_enabled_requirements'
      )
    group by conrelid
    having count(*) = 2
  ) then
    raise exception 'FAIL: high-value enabled/children constraints are incomplete';
  end if;

  select *
  into v_high_value_row
  from public.upsert_store_high_value_discount_settings_scoped(
    v_target.organization_id,
    v_target.id,
    false,
    5000000,
    35
  );

  if v_high_value_row.enabled is distinct from false
     or v_high_value_row.threshold_amount_cents is not null
     or v_high_value_row.discount_percent is not null
  then
    raise exception 'FAIL: disabled high-value policy must clear child values';
  end if;

  begin
    perform public.upsert_store_high_value_discount_settings_scoped(
      v_target.organization_id,
      v_target.id,
      true,
      0,
      10
    );
    raise exception 'FAIL: enabled high-value policy accepted threshold <= 0';
  exception
    when sqlstate '23514' then
      null;
  end;

  begin
    perform public.upsert_store_high_value_discount_settings_scoped(
      v_target.organization_id,
      v_target.id,
      true,
      5000000,
      0
    );
    raise exception 'FAIL: enabled high-value policy accepted percent <= 0';
  exception
    when sqlstate '23514' then
      null;
  end;

  begin
    perform public.upsert_store_high_value_discount_settings_scoped(
      v_target.organization_id,
      v_target.id,
      true,
      5000000,
      120
    );
    raise exception 'FAIL: enabled high-value policy accepted percent > 100';
  exception
    when sqlstate '23514' then
      null;
  end;

  select *
  into v_discount_row
  from public.upsert_store_discount_settings_scoped(
    v_target.organization_id,
    v_target.id,
    5,
    10,
    true,
    'approval_required'
  );

  select *
  into v_high_value_row
  from public.upsert_store_high_value_discount_settings_scoped(
    v_target.organization_id,
    v_target.id,
    true,
    5000000,
    18
  );

  if v_high_value_row.discount_percent <> 18 then
    raise exception 'FAIL: high-value writer did not persist allowed percent above normal max';
  end if;

  insert into p19a_store_discount_settings_test_results
  values
    (8, '08_high_value_schema', 'PASS', 'store_high_value_discount_settings table exists'),
    (9, '09_high_value_default_disabled', 'PASS', 'disabled save keeps enabled false and clears child values'),
    (10, '10_disabled_children_null', 'PASS', 'disabled high-value policy nulls threshold and percent'),
    (11, '11_enabled_requires_threshold_gt_zero', 'PASS', 'enabled high-value policy rejects threshold <= 0'),
    (12, '12_enabled_requires_percent_gt_zero', 'PASS', 'enabled high-value policy rejects percent <= 0'),
    (13, '13_enabled_percent_lte_100', 'PASS', 'enabled high-value policy rejects percent > 100'),
    (14, '14_high_value_percent_can_exceed_normal_max', 'PASS', 'special high-value percent may exceed normal max discount');

  ---------------------------------------------------------------------------
  -- 15-20 RLS, grants and direct-write restrictions
  ---------------------------------------------------------------------------

  if not exists (
    select 1
    from pg_class
    where oid = 'public.store_discount_settings'::regclass
      and relrowsecurity is true
  ) or not exists (
    select 1
    from pg_class
    where oid = 'public.store_high_value_discount_settings'::regclass
      and relrowsecurity is true
  ) then
    raise exception 'FAIL: row level security must be enabled on both discount tables';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'store_discount_settings',
        'store_high_value_discount_settings'
      )
      and cmd <> 'SELECT'
  ) then
    raise exception 'FAIL: discount settings tables must not retain direct-write RLS policies';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'store_discount_settings'
      and policyname = 'store_discount_settings_select_by_active_membership'
      and cmd = 'SELECT'
  ) or not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'store_high_value_discount_settings'
      and policyname = 'store_high_value_discount_settings_select_by_active_membership'
      and cmd = 'SELECT'
  ) then
    raise exception 'FAIL: tenant-scoped SELECT policies are missing';
  end if;

  if not has_table_privilege('authenticated', 'public.store_discount_settings', 'SELECT')
     or not has_table_privilege('authenticated', 'public.store_high_value_discount_settings', 'SELECT')
  then
    raise exception 'FAIL: authenticated SELECT grant missing on discount tables';
  end if;

  if not has_table_privilege('service_role', 'public.store_discount_settings', 'SELECT')
     or not has_table_privilege('service_role', 'public.store_high_value_discount_settings', 'SELECT')
  then
    raise exception 'FAIL: service_role read-only SELECT must be preserved for server observability';
  end if;

  if has_table_privilege('authenticated', 'public.store_discount_settings', 'INSERT')
     or has_table_privilege('authenticated', 'public.store_discount_settings', 'UPDATE')
     or has_table_privilege('authenticated', 'public.store_discount_settings', 'DELETE')
     or has_table_privilege('authenticated', 'public.store_high_value_discount_settings', 'INSERT')
     or has_table_privilege('authenticated', 'public.store_high_value_discount_settings', 'UPDATE')
     or has_table_privilege('authenticated', 'public.store_high_value_discount_settings', 'DELETE')
  then
    raise exception 'FAIL: authenticated can still write discount tables directly';
  end if;

  if has_table_privilege('service_role', 'public.store_discount_settings', 'INSERT')
     or has_table_privilege('service_role', 'public.store_discount_settings', 'UPDATE')
     or has_table_privilege('service_role', 'public.store_discount_settings', 'DELETE')
     or has_table_privilege('service_role', 'public.store_high_value_discount_settings', 'INSERT')
     or has_table_privilege('service_role', 'public.store_high_value_discount_settings', 'UPDATE')
     or has_table_privilege('service_role', 'public.store_high_value_discount_settings', 'DELETE')
  then
    raise exception 'FAIL: service_role must remain read-only on discount settings tables';
  end if;

  if has_function_privilege(
    'service_role',
    'public.upsert_store_discount_settings_scoped(uuid,uuid,numeric,numeric,boolean,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'public.upsert_store_discount_settings_with_legacy_mirror_scoped(uuid,uuid,numeric,numeric,boolean,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'public.upsert_store_high_value_discount_settings_scoped(uuid,uuid,boolean,integer,numeric)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: service_role should not execute discount writers';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.upsert_store_discount_settings_scoped(uuid,uuid,numeric,numeric,boolean,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated must not bypass legacy mirrors through the internal base writer';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.upsert_store_discount_settings_with_legacy_mirror_scoped(uuid,uuid,numeric,numeric,boolean,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated cannot execute normal discount writer';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.upsert_store_high_value_discount_settings_scoped(uuid,uuid,boolean,integer,numeric)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated cannot execute high-value discount writer';
  end if;

  insert into p19a_store_discount_settings_test_results
  values
    (15, '15_rls_enabled', 'PASS', 'row level security enabled on normal and high-value discount tables'),
    (16, '16_grants', 'PASS', 'authenticated and service_role retain read-only SELECT; only authenticated gets public writer EXECUTE'),
    (17, '17_no_direct_authenticated_writes', 'PASS', 'authenticated cannot insert/update/delete discount tables directly'),
    (18, '18_normal_writer_authenticated', 'PASS', 'authenticated can execute only the transactional normal writer; internal base writer remains private'),
    (19, '19_high_value_writer_authenticated', 'PASS', 'high-value writer is executable by authenticated flow only'),
    (20, '20_service_role_no_execute', 'PASS', 'service_role cannot execute discount writers');

  ---------------------------------------------------------------------------
  -- 21-24 tenant scope and idempotency
  ---------------------------------------------------------------------------

  execute 'set local role authenticated';
  perform pg_catalog.set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_member.user_id,
      'role', 'authenticated'
    )::text,
    true
  );

  if v_other_store.id is not null then
    begin
      perform public.upsert_store_discount_settings_with_legacy_mirror_scoped(
        v_other_store.organization_id,
        v_other_store.id,
        5,
        10,
        false,
        'approval_required'
      );
      raise exception 'FAIL: cross-tenant normal writer call should be blocked for authenticated membership';
    exception
      when sqlstate '42501' then
        null;
    end;

    begin
      perform public.upsert_store_high_value_discount_settings_scoped(
        v_other_store.organization_id,
        v_other_store.id,
        true,
        5000000,
        15
      );
      raise exception 'FAIL: cross-tenant high-value writer call should be blocked for authenticated membership';
    exception
      when sqlstate '42501' then
        null;
    end;
  end if;

  perform public.upsert_store_discount_settings_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.id,
    5,
    10,
    true,
    'approval_required'
  );

  perform public.upsert_store_discount_settings_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.id,
    5,
    10,
    true,
    'approval_required'
  );

  select count(*)
  into v_normal_row_count
  from public.store_discount_settings
  where store_id = v_target.id
    and organization_id = v_target.organization_id;

  if v_normal_row_count <> 1 then
    raise exception 'FAIL: repeated normal writer saves created a competing row';
  end if;

  select *
  into v_discount_row
  from public.store_discount_settings
  where store_id = v_target.id
    and organization_id = v_target.organization_id;

  if v_discount_row.default_discount_percent <> 5
     or v_discount_row.max_discount_percent <> 10
     or v_discount_row.discount_autonomy_mode <> 'approval_required'
  then
    raise exception 'FAIL: repeated normal writer saves did not preserve the requested canonical values';
  end if;

  select *
  into v_high_value_row
  from public.upsert_store_high_value_discount_settings_scoped(
    v_target.organization_id,
    v_target.id,
    true,
    5000000,
    18
  );

  select *
  into v_high_value_row
  from public.upsert_store_high_value_discount_settings_scoped(
    v_target.organization_id,
    v_target.id,
    true,
    5000000,
    18
  );

  select count(*)
  into v_high_value_row_count
  from public.store_high_value_discount_settings
  where organization_id = v_target.organization_id
    and store_id = v_target.id;

  if v_high_value_row_count <> 1 then
    raise exception 'FAIL: repeated high-value writer saves created a competing row';
  end if;

  if v_high_value_row.enabled is distinct from true
     or v_high_value_row.threshold_amount_cents <> 5000000
     or v_high_value_row.discount_percent <> 18
  then
    raise exception 'FAIL: repeated high-value writer saves did not preserve the requested canonical values';
  end if;

  perform pg_catalog.set_config('request.jwt.claims', '', true);
  execute 'reset role';

  insert into p19a_store_discount_settings_test_results
  values
    (21, '21_tenant_scope', 'PASS', 'authenticated membership can write only inside its own organization/store scope'),
    (22, '22_cross_tenant_blocked', 'PASS', 'cross-tenant writer calls fail closed with 42501'),
    (23, '23_normal_writer_idempotent', 'PASS', 'normal writer accepts repeated same-value saves without creating competing rows'),
    (24, '24_high_value_writer_idempotent', 'PASS', 'high-value writer accepts repeated same-value saves without creating competing rows');

  ---------------------------------------------------------------------------
  -- 25-28 mirrors and historical conflict behavior
  ---------------------------------------------------------------------------

  select answer
  into v_can_offer_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'can_offer_discount';

  select answer
  into v_max_discount_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'max_discount_percent';

  select answer
  into v_summary_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'discount_policy_summary';

  if v_can_offer_answer is distinct from to_jsonb(false) then
    raise exception 'FAIL: approval_required must mirror can_offer_discount=false for legacy fail-safe compatibility';
  end if;

  if v_max_discount_answer not in (
    to_jsonb(10),
    to_jsonb('10'::text),
    to_jsonb('10.00'::text)
  ) then
    raise exception 'FAIL: explicit save did not refresh max_discount_percent mirror to 10';
  end if;

  if v_summary_answer is null
     or v_summary_answer::text not like '%Autonomia: aprovacao humana%'
  then
    raise exception 'FAIL: explicit save did not refresh a canonical autonomy-aware discount_policy_summary mirror';
  end if;

  if v_zion_row.discount_autonomy_mode <> 'approval_required' then
    raise exception 'FAIL: migration inferred autonomy from legacy can_offer_discount instead of using approval_required';
  end if;

  select pg_catalog.pg_get_functiondef(v_high_value_writer_regprocedure::oid)
  into v_high_value_writer_definition;

  if coalesce(v_high_value_writer_definition, '') ilike '%average_ticket%' then
    raise exception 'FAIL: high-value writer must not derive policy from average_ticket';
  end if;

  if v_zion_row.default_discount_percent <> 15
     or v_zion_row.max_discount_percent <> 28
     or v_zion_answer not in (to_jsonb(18), to_jsonb('18'::text))
  then
    raise exception 'FAIL: captured historical conflict evidence was modified during migration installation';
  end if;

  insert into p19a_store_discount_settings_test_results
  values
    (25, '25_mirrors_after_explicit_save', 'PASS', 'explicit save refreshes fail-safe can_offer_discount, canonical max and autonomy-aware summary mirrors'),
    (26, '26_autonomy_not_inferred_from_can_offer_discount', 'PASS', 'existing legacy discount answers do not promote autonomy above approval_required'),
    (27, '27_high_value_not_inferred_from_average_ticket', 'PASS', 'high-value writer contains no average_ticket inference path'),
    (28, '28_migration_install_does_not_resolve_historical_conflict', 'PASS', 'captured canonical 15/28 and legacy 18 evidence remained unresolved by migration installation');
end
$runner$;

table p19a_store_discount_settings_test_results order by ordinal;

rollback;
