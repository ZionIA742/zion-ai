begin;

create temp table p19a_store_strategy_settings_test_results (
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

  v_first_result public.store_strategy_settings%rowtype;
  v_second_result public.store_strategy_settings%rowtype;
  v_updated_result public.store_strategy_settings%rowtype;

  v_base_writer_sqlstate text;
  v_base_writer_message text;
  v_invalid_service_sqlstate text;
  v_invalid_service_message text;
  v_invalid_region_sqlstate text;
  v_invalid_region_message text;
  v_invalid_primary_sqlstate text;
  v_invalid_primary_message text;
  v_cross_tenant_sqlstate text;
  v_cross_tenant_message text;

  v_disallowed_before jsonb;
  v_disallowed_after jsonb;

  v_own_scope_visible_count bigint;
  v_other_scope_visible_count bigint;
  v_row_count bigint;
  v_other_marker_count bigint;

  v_expected_summary_text text;
  v_expected_mirror_matches bigint;
  v_expected_mirror_key_count bigint;
  v_duplicate_mirror_keys bigint;
begin
  ---------------------------------------------------------------------------
  -- 01-06: schema / policies / grants / hardening
  ---------------------------------------------------------------------------
  if pg_catalog.to_regclass('public.store_strategy_settings') is null then
    raise exception 'FAIL: store_strategy_settings table missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.store_strategy_settings'::regclass
      and c.conname = 'store_strategy_settings_pkey'
      and c.contype = 'p'
      and pg_catalog.pg_get_constraintdef(c.oid)
        = 'PRIMARY KEY (organization_id, store_id)'
  ) then
    raise exception 'FAIL: exact store_strategy_settings primary key missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.store_strategy_settings'::regclass
      and c.conname = 'store_strategy_settings_store_scope_fkey'
      and c.contype = 'f'
      and pg_catalog.pg_get_constraintdef(c.oid)
        like 'FOREIGN KEY (store_id, organization_id) REFERENCES stores(id, organization_id)%'
  ) then
    raise exception 'FAIL: exact organization/store foreign key missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.store_strategy_settings'::regclass
      and c.conname = 'store_strategy_settings_region_modes_allowed'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.store_strategy_settings'::regclass
      and c.conname = 'store_strategy_settings_services_allowed'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.store_strategy_settings'::regclass
      and c.conname = 'store_strategy_settings_primary_region_mode_valid'
  ) then
    raise exception 'FAIL: one or more strategy validation constraints are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.store_strategy_settings'::regclass
      and t.tgname = 'store_strategy_settings_touch_updated_at'
      and t.tgenabled = 'O'
      and not t.tgisinternal
  ) then
    raise exception 'FAIL: updated_at trigger missing or disabled';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid = 'public.store_strategy_settings'::regclass
      and c.relrowsecurity is true
  ) then
    raise exception 'FAIL: RLS must be enabled on store_strategy_settings';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'store_strategy_settings'
      and p.policyname = 'store_strategy_settings_select_by_active_membership'
      and p.cmd = 'SELECT'
      and p.roles @> array['authenticated']::name[]
  ) then
    raise exception 'FAIL: authenticated SELECT policy missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'store_strategy_settings'
      and p.cmd <> 'SELECT'
  ) then
    raise exception 'FAIL: direct write RLS policies must not exist';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_strategy_settings'
      and (
        column_name like '%secret%'
        or column_name like '%token%'
        or column_name like '%password%'
        or column_name like '%credential%'
        or column_name like '%status%'
        or column_name like '%health%'
        or column_name like '%runtime%'
      )
  ) then
    raise exception 'FAIL: strategy table contains secret/runtime columns';
  end if;

  if not has_table_privilege(
    'authenticated',
    'public.store_strategy_settings',
    'SELECT'
  ) then
    raise exception 'FAIL: authenticated SELECT grant missing';
  end if;

  if has_table_privilege('authenticated', 'public.store_strategy_settings', 'INSERT')
     or has_table_privilege('authenticated', 'public.store_strategy_settings', 'UPDATE')
     or has_table_privilege('authenticated', 'public.store_strategy_settings', 'DELETE')
  then
    raise exception 'FAIL: authenticated has a direct table write grant';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.upsert_store_strategy_settings_scoped(uuid,uuid,text,text,text,text[],text,boolean,text,text[],text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated can execute internal base writer';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.upsert_store_strategy_settings_with_legacy_mirror_scoped(uuid,uuid,text,text,text,text[],text,boolean,text,text[],text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated cannot execute wrapper writer';
  end if;

  if has_function_privilege(
    'service_role',
    'public.upsert_store_strategy_settings_scoped(uuid,uuid,text,text,text,text[],text,boolean,text,text[],text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'public.upsert_store_strategy_settings_with_legacy_mirror_scoped(uuid,uuid,text,text,text,text[],text,boolean,text,text[],text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: service_role must not execute strategy writers';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid =
      'public.upsert_store_strategy_settings_scoped(uuid,uuid,text,text,text,text[],text,boolean,text,text[],text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text)'::regprocedure
      and p.prosecdef is true
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.proconfig::text like '%search_path=pg_catalog, public, pg_temp%'
      and p.proconfig::text like '%row_security=off%'
  ) then
    raise exception 'FAIL: base writer hardening/owner mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid =
      'public.upsert_store_strategy_settings_with_legacy_mirror_scoped(uuid,uuid,text,text,text,text[],text,boolean,text,text[],text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text)'::regprocedure
      and p.prosecdef is true
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.proconfig::text like '%search_path=pg_catalog, public, pg_temp%'
      and p.proconfig::text like '%row_security=off%'
  ) then
    raise exception 'FAIL: wrapper writer hardening/owner mismatch';
  end if;

  insert into p19a_store_strategy_settings_test_results
  values
    (1, '01_schema_constraints_trigger', 'PASS',
      'table, exact PK/FK, validation checks and updated_at trigger are present'),
    (2, '02_rls_policy_and_table_grants', 'PASS',
      'RLS has only authenticated SELECT policy; direct table writes are unavailable'),
    (3, '03_no_secret_runtime_columns', 'PASS',
      'canonical strategy table excludes secret/status/health/runtime columns'),
    (4, '04_writer_privileges', 'PASS',
      'authenticated can execute only wrapper; service_role executes neither writer'),
    (5, '05_writer_hardening', 'PASS',
      'both writers are postgres-owned SECURITY DEFINER with fixed search_path and row_security off');

  ---------------------------------------------------------------------------
  -- Resolve a real authenticated scope.
  ---------------------------------------------------------------------------
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
    raise exception 'FAIL: no store with active membership available';
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
    raise exception 'FAIL: active member disappeared for target organization';
  end if;

  select store_row.*
  into v_other_store
  from public.stores store_row
  where store_row.organization_id <> v_target.organization_id
  order by store_row.created_at nulls last, store_row.id
  limit 1;

  -- If another tenant already exists, create/update only a rollback-safe marker
  -- so RLS can be exercised against a real row.
  if v_other_store.id is not null then
    insert into public.store_strategy_settings (
      organization_id,
      store_id,
      city,
      service_region_modes,
      service_region_outside_consultation,
      store_services
    )
    values (
      v_other_store.organization_id,
      v_other_store.id,
      'P19A_OTHER_TENANT_FIXTURE',
      '{}'::text[],
      false,
      '{}'::text[]
    )
    on conflict (organization_id, store_id) do update
    set city = excluded.city;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'question_key', a.question_key,
        'answer', a.answer
      )
      order by a.question_key, a.answer::text
    ),
    '[]'::jsonb
  )
  into v_disallowed_before
  from public.store_onboarding_answers a
  where a.organization_id = v_target.organization_id
    and a.store_id = v_target.id
    and a.question_key in (
      'strategy_requires_visit',
      'strategy_requires_human',
      'strategy_exception_cases'
    );

  execute 'set local role authenticated';

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    v_member.user_id::text,
    true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'authenticated',
    true
  );
  perform pg_catalog.set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_member.user_id,
      'role', 'authenticated'
    )::text,
    true
  );

  -- Seed an intentionally stale derived summary through the authenticated,
  -- scoped legacy writer. The canonical wrapper must replace it later.
  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => v_target.organization_id,
    p_store_id => v_target.id,
    p_question_key => 'strategy_ai_store_summary',
    p_answer => to_jsonb('LEGACY SUMMARY SHOULD LOSE'::text)
  );

  ---------------------------------------------------------------------------
  -- 06: base writer really cannot be called by authenticated.
  ---------------------------------------------------------------------------
  begin
    perform public.upsert_store_strategy_settings_scoped(
      v_target.organization_id,
      v_target.id,
      'Bypass'
    );
    raise exception 'FAIL: authenticated executed base writer';
  exception
    when others then
      v_base_writer_sqlstate := sqlstate;
      v_base_writer_message := sqlerrm;
  end;

  if v_base_writer_sqlstate <> '42501' then
    raise exception 'FAIL: base writer denial must be 42501, got [%] %',
      coalesce(v_base_writer_sqlstate, 'null'),
      coalesce(v_base_writer_message, 'null');
  end if;

  ---------------------------------------------------------------------------
  -- 07-08: first canonical write + RLS.
  ---------------------------------------------------------------------------
  select *
  into v_first_result
  from public.upsert_store_strategy_settings_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.id,
    'Franca',
    'SP',
    'Interior paulista',
    array['cidade_e_vizinhas'],
    'cidade_e_vizinhas',
    true,
    'Fora da rota, sob consulta',
    array['venda_piscinas', 'visita_tecnica'],
    'Reformas',
    'Loja consultiva',
    'Sodramar',
    'Sodramar, Brustec',
    'Nao faz obra civil',
    'Piscinas residenciais',
    'Automacao',
    'Cliente residencial',
    'Ticket medio',
    '30k-80k',
    'Premium tecnico',
    'Sodramar',
    'Marca X',
    'Aquecimento',
    'Filtros',
    'Equipe propria',
    'Prazo depende da visita',
    'Apresente com tom consultivo',
    'Entenda o contexto antes do preco',
    'Nao invente prazo'
  );

  if v_first_result.organization_id <> v_target.organization_id
     or v_first_result.store_id <> v_target.id
     or v_first_result.service_region_outside_consultation is distinct from true
     or not ('cidade_e_vizinhas' = any(v_first_result.service_region_modes))
     or not ('sob_consulta' = any(v_first_result.service_region_modes))
     or not ('venda_piscinas' = any(v_first_result.store_services))
     or not ('visita_tecnica' = any(v_first_result.store_services))
  then
    raise exception 'FAIL: first canonical write/normalization mismatch';
  end if;

  select count(*)
  into v_own_scope_visible_count
  from public.store_strategy_settings s
  where s.organization_id = v_target.organization_id
    and s.store_id = v_target.id;

  if v_own_scope_visible_count <> 1 then
    raise exception 'FAIL: authenticated member cannot SELECT own canonical row';
  end if;

  if v_other_store.id is not null then
    select count(*)
    into v_other_scope_visible_count
    from public.store_strategy_settings s
    where s.organization_id = v_other_store.organization_id
      and s.store_id = v_other_store.id;

    if v_other_scope_visible_count <> 0 then
      raise exception 'FAIL: RLS exposed another tenant canonical row';
    end if;
  else
    v_other_scope_visible_count := 0;
  end if;

  ---------------------------------------------------------------------------
  -- 09-11: fail-closed validation.
  ---------------------------------------------------------------------------
  begin
    perform public.upsert_store_strategy_settings_with_legacy_mirror_scoped(
      v_target.organization_id,
      v_target.id,
      'Franca',
      'SP',
      'Interior paulista',
      array['valor_invalido']
    );
    raise exception 'FAIL: invalid region mode was accepted';
  exception
    when others then
      v_invalid_region_sqlstate := sqlstate;
      v_invalid_region_message := sqlerrm;
  end;

  if v_invalid_region_sqlstate <> 'P0001'
     or position(
       'SERVICE_REGION_MODE_INVALID' in coalesce(v_invalid_region_message, '')
     ) = 0
  then
    raise exception 'FAIL: invalid region rejection mismatch [%] %',
      coalesce(v_invalid_region_sqlstate, 'null'),
      coalesce(v_invalid_region_message, 'null');
  end if;

  begin
    perform public.upsert_store_strategy_settings_with_legacy_mirror_scoped(
      v_target.organization_id,
      v_target.id,
      'Franca',
      'SP',
      'Interior paulista',
      array['cidade_e_vizinhas'],
      'modo_invalido'
    );
    raise exception 'FAIL: invalid primary region mode was accepted';
  exception
    when others then
      v_invalid_primary_sqlstate := sqlstate;
      v_invalid_primary_message := sqlerrm;
  end;

  if v_invalid_primary_sqlstate <> 'P0001'
     or position(
       'SERVICE_REGION_PRIMARY_MODE_INVALID' in coalesce(v_invalid_primary_message, '')
     ) = 0
  then
    raise exception 'FAIL: invalid primary mode rejection mismatch [%] %',
      coalesce(v_invalid_primary_sqlstate, 'null'),
      coalesce(v_invalid_primary_message, 'null');
  end if;

  begin
    perform public.upsert_store_strategy_settings_with_legacy_mirror_scoped(
      v_target.organization_id,
      v_target.id,
      'Franca',
      'SP',
      'Interior paulista',
      array['cidade_e_vizinhas'],
      'cidade_e_vizinhas',
      false,
      'Invalid service',
      array['valor_invalido']
    );
    raise exception 'FAIL: invalid service was accepted';
  exception
    when others then
      v_invalid_service_sqlstate := sqlstate;
      v_invalid_service_message := sqlerrm;
  end;

  if v_invalid_service_sqlstate <> 'P0001'
     or position(
       'STORE_SERVICE_INVALID' in coalesce(v_invalid_service_message, '')
     ) = 0
  then
    raise exception 'FAIL: invalid service rejection mismatch [%] %',
      coalesce(v_invalid_service_sqlstate, 'null'),
      coalesce(v_invalid_service_message, 'null');
  end if;

  ---------------------------------------------------------------------------
  -- 12: cross-tenant writer denial.
  ---------------------------------------------------------------------------
  begin
    perform public.upsert_store_strategy_settings_with_legacy_mirror_scoped(
      coalesce(
        v_other_store.organization_id,
        '00000000-0000-0000-0000-000000000001'::uuid
      ),
      coalesce(
        v_other_store.id,
        '00000000-0000-0000-0000-000000000101'::uuid
      ),
      'Cross Tenant'
    );
    raise exception 'FAIL: cross-tenant wrapper call unexpectedly succeeded';
  exception
    when others then
      v_cross_tenant_sqlstate := sqlstate;
      v_cross_tenant_message := sqlerrm;
  end;

  if v_cross_tenant_sqlstate <> 'P0001'
     or position(
       'MEMBERSHIP_REQUIRED' in coalesce(v_cross_tenant_message, '')
     ) = 0
  then
    raise exception 'FAIL: cross-tenant denial mismatch [%] %',
      coalesce(v_cross_tenant_sqlstate, 'null'),
      coalesce(v_cross_tenant_message, 'null');
  end if;

  ---------------------------------------------------------------------------
  -- 13: idempotent repeat write.
  ---------------------------------------------------------------------------
  select *
  into v_second_result
  from public.upsert_store_strategy_settings_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.id,
    'Franca',
    'SP',
    'Interior paulista',
    array['cidade_e_vizinhas'],
    'cidade_e_vizinhas',
    true,
    'Fora da rota, sob consulta',
    array['venda_piscinas', 'visita_tecnica'],
    'Reformas',
    'Loja consultiva',
    'Sodramar',
    'Sodramar, Brustec',
    'Nao faz obra civil',
    'Piscinas residenciais',
    'Automacao',
    'Cliente residencial',
    'Ticket medio',
    '30k-80k',
    'Premium tecnico',
    'Sodramar',
    'Marca X',
    'Aquecimento',
    'Filtros',
    'Equipe propria',
    'Prazo depende da visita',
    'Apresente com tom consultivo',
    'Entenda o contexto antes do preco',
    'Nao invente prazo'
  );

  select count(*)
  into v_row_count
  from public.store_strategy_settings s
  where s.organization_id = v_target.organization_id
    and s.store_id = v_target.id;

  if v_row_count <> 1 then
    raise exception 'FAIL: repeated save created competing canonical rows';
  end if;

  ---------------------------------------------------------------------------
  -- 14-15: updated_at + sob_consulta removal.
  ---------------------------------------------------------------------------
  perform pg_catalog.pg_sleep(0.02);

  select *
  into v_updated_result
  from public.upsert_store_strategy_settings_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.id,
    'Franca',
    'SP',
    'Interior paulista',
    array['cidade_e_vizinhas', 'sob_consulta'],
    'cidade_e_vizinhas',
    false,
    'Somente rota principal',
    array['venda_piscinas'],
    '',
    'Loja consultiva',
    'Sodramar',
    'Sodramar',
    'Nao faz obra civil',
    'Piscinas residenciais',
    'Automacao',
    'Cliente residencial',
    'Ticket medio',
    '30k-80k',
    'Premium tecnico',
    'Sodramar',
    '',
    'Aquecimento',
    'Filtros',
    'Equipe propria',
    'Prazo depende da visita',
    'Apresente com tom consultivo',
    'Entenda o contexto antes do preco',
    'Nao invente prazo'
  );

  if v_second_result.updated_at is null
     or v_updated_result.updated_at is null
     or v_updated_result.updated_at <= v_second_result.updated_at
  then
    raise exception 'FAIL: updated_at did not advance after strategy update';
  end if;

  if 'sob_consulta' = any(v_updated_result.service_region_modes) then
    raise exception 'FAIL: sob_consulta was not removed when consultation=false';
  end if;

  if v_updated_result.service_region_outside_consultation is distinct from false then
    raise exception 'FAIL: outside consultation boolean did not persist false';
  end if;

  -- Mirror verification is intentionally privileged.
  -- store_onboarding_answers is a legacy compatibility store and may not expose
  -- direct SELECT rows to the authenticated role used above. The wrapper write
  -- itself has already been exercised as authenticated; now reset the role so
  -- the runner can verify the exact persisted mirror without RLS masking rows.
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claims', '', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claim.role', '', true);

  ---------------------------------------------------------------------------
  -- 16: exact canonical -> legacy mirror for all 28 fields + derived summary.
  ---------------------------------------------------------------------------
  v_expected_summary_text :=
    public.store_strategy_settings_build_ai_store_summary(
      v_updated_result.store_description,
      v_updated_result.strategy_primary_focus,
      v_updated_result.strategy_positioning,
      v_updated_result.strategy_sell_more,
      v_updated_result.service_regions,
      v_updated_result.service_region_modes,
      v_updated_result.store_services,
      v_updated_result.store_services_other,
      v_updated_result.main_store_brand,
      v_updated_result.strategy_priority_brands,
      v_updated_result.strategy_differentials,
      v_updated_result.strategy_promise_limits
    );

  with expected(question_key, answer) as (
    values
      ('city'::text, to_jsonb(coalesce(v_updated_result.city, ''))),
      ('state'::text, to_jsonb(coalesce(v_updated_result.state, ''))),
      ('service_regions'::text, to_jsonb(coalesce(v_updated_result.service_regions, ''))),
      ('service_region_modes'::text, to_jsonb(v_updated_result.service_region_modes)),
      ('service_region_primary_mode'::text, to_jsonb(coalesce(v_updated_result.service_region_primary_mode, ''))),
      ('service_region_outside_consultation'::text, to_jsonb(v_updated_result.service_region_outside_consultation)),
      ('service_region_notes'::text, to_jsonb(coalesce(v_updated_result.service_region_notes, ''))),
      ('store_services'::text, to_jsonb(v_updated_result.store_services)),
      ('store_services_other'::text, to_jsonb(coalesce(v_updated_result.store_services_other, ''))),
      ('store_description'::text, to_jsonb(coalesce(v_updated_result.store_description, ''))),
      ('main_store_brand'::text, to_jsonb(coalesce(v_updated_result.main_store_brand, ''))),
      ('brands_worked'::text, to_jsonb(coalesce(v_updated_result.brands_worked, ''))),
      ('strategy_service_exclusions'::text, to_jsonb(coalesce(v_updated_result.strategy_service_exclusions, ''))),
      ('strategy_primary_focus'::text, to_jsonb(coalesce(v_updated_result.strategy_primary_focus, ''))),
      ('strategy_sell_more'::text, to_jsonb(coalesce(v_updated_result.strategy_sell_more, ''))),
      ('strategy_common_customer'::text, to_jsonb(coalesce(v_updated_result.strategy_common_customer, ''))),
      ('strategy_ideal_customer'::text, to_jsonb(coalesce(v_updated_result.strategy_ideal_customer, ''))),
      ('strategy_ticket_range'::text, to_jsonb(coalesce(v_updated_result.strategy_ticket_range, ''))),
      ('strategy_positioning'::text, to_jsonb(coalesce(v_updated_result.strategy_positioning, ''))),
      ('strategy_priority_brands'::text, to_jsonb(coalesce(v_updated_result.strategy_priority_brands, ''))),
      ('strategy_non_worked_brands'::text, to_jsonb(coalesce(v_updated_result.strategy_non_worked_brands, ''))),
      ('strategy_top_lines'::text, to_jsonb(coalesce(v_updated_result.strategy_top_lines, ''))),
      ('strategy_top_products'::text, to_jsonb(coalesce(v_updated_result.strategy_top_products, ''))),
      ('strategy_differentials'::text, to_jsonb(coalesce(v_updated_result.strategy_differentials, ''))),
      ('strategy_promise_limits'::text, to_jsonb(coalesce(v_updated_result.strategy_promise_limits, ''))),
      ('strategy_ai_presentation'::text, to_jsonb(coalesce(v_updated_result.strategy_ai_presentation, ''))),
      ('strategy_ai_priorities'::text, to_jsonb(coalesce(v_updated_result.strategy_ai_priorities, ''))),
      ('strategy_ai_never_forget'::text, to_jsonb(coalesce(v_updated_result.strategy_ai_never_forget, ''))),
      ('strategy_ai_store_summary'::text, to_jsonb(coalesce(v_expected_summary_text, '')))
  )
  select count(*)
  into v_expected_mirror_matches
  from expected e
  join public.store_onboarding_answers a
    on a.organization_id = v_target.organization_id
   and a.store_id = v_target.id
   and a.question_key = e.question_key
   and a.answer = e.answer;

  if v_expected_mirror_matches <> 29 then
    raise exception 'FAIL: expected 29 exact mirror values, found %',
      v_expected_mirror_matches;
  end if;

  select count(distinct a.question_key)
  into v_expected_mirror_key_count
  from public.store_onboarding_answers a
  where a.organization_id = v_target.organization_id
    and a.store_id = v_target.id
    and a.question_key in (
      'city',
      'state',
      'service_regions',
      'service_region_modes',
      'service_region_primary_mode',
      'service_region_outside_consultation',
      'service_region_notes',
      'store_services',
      'store_services_other',
      'store_description',
      'main_store_brand',
      'brands_worked',
      'strategy_service_exclusions',
      'strategy_primary_focus',
      'strategy_sell_more',
      'strategy_common_customer',
      'strategy_ideal_customer',
      'strategy_ticket_range',
      'strategy_positioning',
      'strategy_priority_brands',
      'strategy_non_worked_brands',
      'strategy_top_lines',
      'strategy_top_products',
      'strategy_differentials',
      'strategy_promise_limits',
      'strategy_ai_presentation',
      'strategy_ai_priorities',
      'strategy_ai_never_forget',
      'strategy_ai_store_summary'
    );

  if v_expected_mirror_key_count <> 29 then
    raise exception 'FAIL: expected 29 distinct mirrored keys, found %',
      v_expected_mirror_key_count;
  end if;

  select count(*)
  into v_duplicate_mirror_keys
  from (
    select a.question_key
    from public.store_onboarding_answers a
    where a.organization_id = v_target.organization_id
      and a.store_id = v_target.id
      and a.question_key in (
        'city',
        'state',
        'service_regions',
        'service_region_modes',
        'service_region_primary_mode',
        'service_region_outside_consultation',
        'service_region_notes',
        'store_services',
        'store_services_other',
        'store_description',
        'main_store_brand',
        'brands_worked',
        'strategy_service_exclusions',
        'strategy_primary_focus',
        'strategy_sell_more',
        'strategy_common_customer',
        'strategy_ideal_customer',
        'strategy_ticket_range',
        'strategy_positioning',
        'strategy_priority_brands',
        'strategy_non_worked_brands',
        'strategy_top_lines',
        'strategy_top_products',
        'strategy_differentials',
        'strategy_promise_limits',
        'strategy_ai_presentation',
        'strategy_ai_priorities',
        'strategy_ai_never_forget',
        'strategy_ai_store_summary'
      )
    group by a.question_key
    having count(*) <> 1
  ) duplicate_rows;

  if v_duplicate_mirror_keys <> 0 then
    raise exception 'FAIL: one or more canonical mirror keys are duplicated';
  end if;

  ---------------------------------------------------------------------------
  -- 17: excluded legacy keys remain byte-for-byte unchanged.
  ---------------------------------------------------------------------------
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'question_key', a.question_key,
        'answer', a.answer
      )
      order by a.question_key, a.answer::text
    ),
    '[]'::jsonb
  )
  into v_disallowed_after
  from public.store_onboarding_answers a
  where a.organization_id = v_target.organization_id
    and a.store_id = v_target.id
    and a.question_key in (
      'strategy_requires_visit',
      'strategy_requires_human',
      'strategy_exception_cases'
    );

  if v_disallowed_after is distinct from v_disallowed_before then
    raise exception 'FAIL: excluded strategy legacy keys were modified';
  end if;

  ---------------------------------------------------------------------------
  -- 18: privileged verification that cross-tenant attempt changed nothing.
  ---------------------------------------------------------------------------
  if v_other_store.id is not null then
    select count(*)
    into v_other_marker_count
    from public.store_strategy_settings s
    where s.organization_id = v_other_store.organization_id
      and s.store_id = v_other_store.id
      and s.city = 'P19A_OTHER_TENANT_FIXTURE';

    if v_other_marker_count <> 1 then
      raise exception 'FAIL: other tenant fixture was changed unexpectedly';
    end if;
  else
    v_other_marker_count := 0;
  end if;

  insert into p19a_store_strategy_settings_test_results
  values
    (6, '06_base_writer_not_callable', 'PASS',
      'authenticated direct base-writer call is denied with insufficient_privilege'),
    (7, '07_first_write_and_normalization', 'PASS',
      'wrapper creates scoped canonical row and normalizes arrays/sob_consulta'),
    (8, '08_authenticated_select_rls', 'PASS',
      case
        when v_other_store.id is null
          then 'own row visible; no second organization existed for dynamic foreign-row check, policy structure was verified'
        else 'own row visible and existing other-tenant row hidden by RLS'
      end),
    (9, '09_invalid_region_mode_fail_closed', 'PASS',
      'invalid service_region_modes input is rejected'),
    (10, '10_invalid_primary_mode_fail_closed', 'PASS',
      'invalid service_region_primary_mode is rejected'),
    (11, '11_invalid_service_fail_closed', 'PASS',
      'invalid store_services input is rejected'),
    (12, '12_cross_tenant_writer_blocked', 'PASS',
      'authenticated member cannot save another organization/store'),
    (13, '13_repeat_save_idempotent', 'PASS',
      'repeat save keeps exactly one canonical row'),
    (14, '14_updated_at_advances', 'PASS',
      'clock_timestamp-backed trigger advances updated_at within one transaction'),
    (15, '15_sob_consulta_semantics', 'PASS',
      'true adds sob_consulta and false removes it'),
    (16, '16_all_canonical_fields_mirrored', 'PASS',
      'all 28 canonical fields plus derived summary match the persisted legacy mirror exactly under privileged verification'),
    (17, '17_excluded_fields_untouched', 'PASS',
      'strategy_requires_visit, strategy_requires_human and strategy_exception_cases remain unchanged'),
    (18, '18_other_tenant_untouched', 'PASS',
      'cross-tenant attempt did not alter another tenant; runner remains rollback-safe');
end
$runner$;

table p19a_store_strategy_settings_test_results
order by ordinal;

rollback;
