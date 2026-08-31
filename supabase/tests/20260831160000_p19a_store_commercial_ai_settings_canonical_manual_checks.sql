begin;

do $runner$
declare
  v_target public.stores%rowtype;
  v_member public.memberships%rowtype;
  v_other_store public.stores%rowtype;

  v_first public.store_commercial_ai_settings%rowtype;
  v_second public.store_commercial_ai_settings%rowtype;
  v_repeat public.store_commercial_ai_settings%rowtype;

  v_invalid_policy_sqlstate text;
  v_invalid_requirement_sqlstate text;
  v_direct_write_sqlstate text;
  v_cross_tenant_sqlstate text;

  v_columns text[];
  v_missing_mirrors bigint;
  v_row_count bigint;
  v_visible_other bigint;
  v_bad_backfill_scopes bigint;
  v_expected_price_direct_rule text;
begin
  ---------------------------------------------------------------------------
  -- 1. Exact schema / domain separation
  ---------------------------------------------------------------------------
  select array_agg(column_name order by ordinal_position)
  into v_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'store_commercial_ai_settings';

  if v_columns <> array[
    'organization_id',
    'store_id',
    'price_answer_policy',
    'price_context_requirements',
    'created_at',
    'updated_at'
  ] then
    raise exception 'FAIL: unexpected store_commercial_ai_settings columns: %', v_columns;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_commercial_ai_settings'
      and column_name in (
        'discount_special_rules',
        'accepted_payment_methods',
        'quote_id',
        'crm_stage',
        'runtime_status'
      )
  ) then
    raise exception 'FAIL: commercial AI settings table contains adjacent-domain columns';
  end if;

  ---------------------------------------------------------------------------
  -- 2. PK / scoped FK / allowlists / trigger
  ---------------------------------------------------------------------------
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.store_commercial_ai_settings'::regclass
      and c.conname = 'store_commercial_ai_settings_pkey'
      and c.contype = 'p'
      and pg_catalog.pg_get_constraintdef(c.oid)
        = 'PRIMARY KEY (organization_id, store_id)'
  ) then
    raise exception 'FAIL: exact PK organization_id/store_id missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.store_commercial_ai_settings'::regclass
      and c.conname = 'store_commercial_ai_settings_store_scope_fkey'
      and c.contype = 'f'
      and pg_catalog.pg_get_constraintdef(c.oid)
        like 'FOREIGN KEY (store_id, organization_id) REFERENCES stores(id, organization_id)%'
  ) then
    raise exception 'FAIL: scoped store FK missing';
  end if;

  if not public.store_commercial_ai_price_answer_policy_is_valid('direct_when_asked')
     or not public.store_commercial_ai_price_answer_policy_is_valid('range_only_when_asked')
     or not public.store_commercial_ai_price_answer_policy_is_valid('human_required_for_price')
     or public.store_commercial_ai_price_answer_policy_is_valid('quote_specific_price')
  then
    raise exception 'FAIL: price_answer_policy allowlist mismatch';
  end if;

  if not public.store_commercial_ai_price_context_requirements_are_valid(
       array[
         'need_summary',
         'interested_product_reference',
         'space_or_measurements',
         'installation_scope'
       ]::text[]
     )
     or public.store_commercial_ai_price_context_requirements_are_valid(
       array['so_apos_identificar_interesse_real']::text[]
     )
  then
    raise exception 'FAIL: price_context_requirements allowlist mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.store_commercial_ai_settings'::regclass
      and t.tgname = 'store_commercial_ai_settings_touch_updated_at'
      and t.tgenabled = 'O'
      and not t.tgisinternal
  ) then
    raise exception 'FAIL: updated_at trigger missing';
  end if;

  ---------------------------------------------------------------------------
  -- 3. RLS / table grants
  -- Authenticated: scoped SELECT only.
  -- service_role: server-side SELECT only; no writes.
  ---------------------------------------------------------------------------
  if not exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid = 'public.store_commercial_ai_settings'::regclass
      and c.relrowsecurity is true
  ) then
    raise exception 'FAIL: RLS must be enabled';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'store_commercial_ai_settings'
      and p.policyname = 'store_commercial_ai_settings_select_by_active_membership'
      and p.cmd = 'SELECT'
      and 'authenticated' = any(p.roles)
  ) then
    raise exception 'FAIL: authenticated SELECT RLS policy missing';
  end if;

  if not has_table_privilege(
       'authenticated',
       'public.store_commercial_ai_settings',
       'SELECT'
     )
     or has_table_privilege(
       'authenticated',
       'public.store_commercial_ai_settings',
       'INSERT'
     )
     or has_table_privilege(
       'authenticated',
       'public.store_commercial_ai_settings',
       'UPDATE'
     )
     or has_table_privilege(
       'authenticated',
       'public.store_commercial_ai_settings',
       'DELETE'
     )
  then
    raise exception 'FAIL: authenticated table privileges mismatch';
  end if;

  if not has_table_privilege(
       'service_role',
       'public.store_commercial_ai_settings',
       'SELECT'
     )
     or has_table_privilege(
       'service_role',
       'public.store_commercial_ai_settings',
       'INSERT'
     )
     or has_table_privilege(
       'service_role',
       'public.store_commercial_ai_settings',
       'UPDATE'
     )
     or has_table_privilege(
       'service_role',
       'public.store_commercial_ai_settings',
       'DELETE'
     )
  then
    raise exception 'FAIL: service_role must have read-only table access';
  end if;

  ---------------------------------------------------------------------------
  -- 4. Writer grants / SECURITY DEFINER hardening
  ---------------------------------------------------------------------------
  if has_function_privilege(
       'authenticated',
       'public.upsert_store_commercial_ai_settings_scoped(uuid,uuid,text,text[])',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.upsert_store_commercial_ai_settings_with_legacy_mirror_scoped(uuid,uuid,text,text[])',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.upsert_store_commercial_ai_settings_scoped(uuid,uuid,text,text[])',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.upsert_store_commercial_ai_settings_with_legacy_mirror_scoped(uuid,uuid,text,text[])',
       'EXECUTE'
     )
  then
    raise exception 'FAIL: writer grants mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid =
      'public.upsert_store_commercial_ai_settings_scoped(uuid,uuid,text,text[])'::regprocedure
      and p.prosecdef is true
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.proconfig::text like '%search_path=pg_catalog, public, pg_temp%'
      and p.proconfig::text like '%row_security=off%'
  ) or not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid =
      'public.upsert_store_commercial_ai_settings_with_legacy_mirror_scoped(uuid,uuid,text,text[])'::regprocedure
      and p.prosecdef is true
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.proconfig::text like '%search_path=pg_catalog, public, pg_temp%'
      and p.proconfig::text like '%row_security=off%'
  ) then
    raise exception 'FAIL: writer hardening/owner mismatch';
  end if;

  ---------------------------------------------------------------------------
  -- 5. Migration backfill safety against conflicting/invalid legacy scopes.
  -- The canonical table is new in this migration, so a scope whose legacy
  -- authority was conflicting/invalid must not have been materialized.
  ---------------------------------------------------------------------------
  with legacy_answers as (
    select
      answer_row.organization_id,
      answer_row.store_id,
      answer_row.question_key,
      answer_row.answer,
      case
        when answer_row.question_key in (
          'ai_can_send_price_directly',
          'price_needs_human_help'
        )
        then case
          when answer_row.answer = 'true'::jsonb then 'sim'
          when answer_row.answer = 'false'::jsonb then 'nao'
          else pg_catalog.lower(
            translate(
              nullif(pg_catalog.btrim(answer_row.answer #>> '{}'), ''),
              'ãáàâäÃÁÀÂÄõóòôöÕÓÒÔÖçÇ',
              'aaaaaAAAAAoooooOOOOOcC'
            )
          )
        end
        when answer_row.question_key = 'price_talk_mode'
          then pg_catalog.lower(
            nullif(pg_catalog.btrim(answer_row.answer #>> '{}'), '')
          )
        when answer_row.question_key = 'price_must_understand_before'
          then answer_row.answer::text
        else null
      end as compare_value
    from public.store_onboarding_answers answer_row
    where answer_row.question_key in (
      'ai_can_send_price_directly',
      'price_needs_human_help',
      'price_talk_mode',
      'price_must_understand_before'
    )
  ),
  legacy_scopes as (
    select distinct organization_id, store_id
    from legacy_answers
  ),
  bad_scopes as (
    select
      scope_row.organization_id,
      scope_row.store_id
    from legacy_scopes scope_row
    where exists (
      select 1
      from legacy_answers conflict_row
      where conflict_row.organization_id = scope_row.organization_id
        and conflict_row.store_id = scope_row.store_id
      group by conflict_row.question_key
      having count(distinct conflict_row.compare_value)
        filter (where conflict_row.compare_value is not null) > 1
    )
    or exists (
      select 1
      from legacy_answers invalid_row
      where invalid_row.organization_id = scope_row.organization_id
        and invalid_row.store_id = scope_row.store_id
        and (
          (
            invalid_row.question_key in (
              'ai_can_send_price_directly',
              'price_needs_human_help'
            )
            and invalid_row.compare_value is not null
            and invalid_row.compare_value not in ('sim', 'nao')
          )
          or (
            invalid_row.question_key = 'price_talk_mode'
            and invalid_row.compare_value is not null
            and invalid_row.compare_value not in (
              'quando_cliente_perguntar',
              'apenas_faixa_inicial',
              'nao_falar_sozinha'
            )
          )
          or (
            invalid_row.question_key = 'price_must_understand_before'
            and invalid_row.answer is not null
            and invalid_row.answer <> 'null'::jsonb
            and case
              when pg_catalog.jsonb_typeof(invalid_row.answer) <> 'array'
                then true
              else exists (
                select 1
                from pg_catalog.jsonb_array_elements_text(invalid_row.answer) as value
                where nullif(pg_catalog.btrim(value), '') is null
                   or pg_catalog.lower(pg_catalog.btrim(value)) not in (
                     'so_apos_entender_objetivo',
                     'so_apos_identificar_interesse_real',
                     'so_apos_entender_tipo',
                     'so_apos_entender_medidas',
                     'so_apos_entender_instalacao'
                   )
              )
            end
          )
        )
    )
  )
  select count(*)
  into v_bad_backfill_scopes
  from bad_scopes bad_row
  join public.store_commercial_ai_settings canonical_row
    on canonical_row.organization_id = bad_row.organization_id
   and canonical_row.store_id = bad_row.store_id;

  if v_bad_backfill_scopes <> 0 then
    raise exception
      'FAIL: fail-closed backfill materialized % conflicting/invalid legacy scope(s)',
      v_bad_backfill_scopes;
  end if;

  ---------------------------------------------------------------------------
  -- 6. Choose a real store with an active member.
  ---------------------------------------------------------------------------
  select store_row.*
  into v_target
  from public.stores store_row
  where store_row.organization_id is not null
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = store_row.organization_id
        and membership_row.is_active is true
        and membership_row.user_id is not null
    )
  order by store_row.id
  limit 1;

  if v_target.id is null then
    raise exception 'FAIL: no store with active membership available for transactional checks';
  end if;

  select membership_row.*
  into v_member
  from public.memberships membership_row
  where membership_row.organization_id = v_target.organization_id
    and membership_row.is_active is true
    and membership_row.user_id is not null
  order by membership_row.user_id
  limit 1;

  if v_member.user_id is null then
    raise exception 'FAIL: no active membership available for RLS checks';
  end if;

  select store_row.*
  into v_other_store
  from public.stores store_row
  where store_row.organization_id <> v_target.organization_id
    and not exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = store_row.organization_id
        and membership_row.user_id = v_member.user_id
        and membership_row.is_active is true
    )
  order by store_row.id
  limit 1;

  -- Prepare a real other-tenant canonical row while still executing as postgres.
  if v_other_store.id is not null then
    perform public.upsert_store_commercial_ai_settings_scoped(
      v_other_store.organization_id,
      v_other_store.id,
      'direct_when_asked',
      '{}'::text[]
    );
  end if;

  v_expected_price_direct_rule :=
    public.store_commercial_ai_settings_build_price_direct_rule(
      'range_only_when_asked',
      array['installation_scope']::text[]
    );

  ---------------------------------------------------------------------------
  -- 7. Switch to authenticated member context.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_member.user_id::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    insert into public.store_commercial_ai_settings (
      organization_id,
      store_id,
      price_answer_policy,
      price_context_requirements
    )
    values (
      v_target.organization_id,
      v_target.id,
      'direct_when_asked',
      '{}'::text[]
    );
  exception when others then
    v_direct_write_sqlstate := sqlstate;
  end;

  if v_direct_write_sqlstate is null then
    raise exception 'FAIL: direct INSERT should be blocked by grants/RLS';
  end if;

  ---------------------------------------------------------------------------
  -- 8. First canonical write + normalization/deduplication
  ---------------------------------------------------------------------------
  v_first := public.upsert_store_commercial_ai_settings_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.id,
    'direct_when_asked',
    array[
      'space_or_measurements',
      'need_summary',
      'space_or_measurements'
    ]::text[]
  );

  if v_first.price_answer_policy <> 'direct_when_asked'
     or v_first.price_context_requirements <> array[
       'space_or_measurements',
       'need_summary'
     ]::text[]
  then
    raise exception 'FAIL: first write did not normalize/dedupe as expected';
  end if;

  select count(*)
  into v_row_count
  from public.store_commercial_ai_settings row_data
  where row_data.organization_id = v_target.organization_id
    and row_data.store_id = v_target.id;

  if v_row_count <> 1 then
    raise exception 'FAIL: canonical cardinality after first write is %', v_row_count;
  end if;

  ---------------------------------------------------------------------------
  -- 9. Updated_at must advance with clock_timestamp()
  ---------------------------------------------------------------------------
  perform pg_sleep(0.01);

  v_second := public.upsert_store_commercial_ai_settings_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.id,
    'range_only_when_asked',
    array['installation_scope']::text[]
  );

  if v_second.updated_at <= v_first.updated_at then
    raise exception 'FAIL: updated_at did not advance with clock_timestamp()';
  end if;

  ---------------------------------------------------------------------------
  -- 10. Exact canonical -> legacy mirrors, including price_direct_rule
  --
  -- The wrapper writes the legacy mirror through a privileged scoped writer.
  -- Verification must run back as the SQL Editor/session role; otherwise the
  -- authenticated role can hide the mirror rows and produce a false 6/6 miss.
  ---------------------------------------------------------------------------
  execute 'reset role';

  select count(*)
  into v_missing_mirrors
  from (
    values
      ('price_talk_mode', to_jsonb('apenas_faixa_inicial'::text)),
      ('ai_can_send_price_directly', to_jsonb(true)),
      ('price_needs_human_help', to_jsonb('nao'::text)),
      (
        'price_must_understand_before',
        to_jsonb(array['so_apos_entender_instalacao']::text[])
      ),
      (
        'price_direct_conditions',
        to_jsonb(array[
          'so_apos_entender_instalacao',
          'apenas_faixa_inicial'
        ]::text[])
      ),
      ('price_direct_rule', to_jsonb(v_expected_price_direct_rule))
  ) expected(question_key, answer)
  where not exists (
    select 1
    from public.store_onboarding_answers answer_row
    where answer_row.organization_id = v_target.organization_id
      and answer_row.store_id = v_target.id
      and answer_row.question_key = expected.question_key
      and answer_row.answer = expected.answer
  );

  if v_missing_mirrors <> 0 then
    raise exception 'FAIL: canonical to legacy mirrors mismatch (% missing)', v_missing_mirrors;
  end if;

  -- Return to the authenticated member context for the remaining permission /
  -- isolation checks.
  perform set_config('role', 'authenticated', true);

  ---------------------------------------------------------------------------
  -- 11. Idempotent repeat: no duplicate canonical row, stable created_at/value.
  ---------------------------------------------------------------------------
  v_repeat := public.upsert_store_commercial_ai_settings_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.id,
    'range_only_when_asked',
    array['installation_scope']::text[]
  );

  if v_repeat.created_at <> v_second.created_at
     or v_repeat.price_answer_policy <> v_second.price_answer_policy
     or v_repeat.price_context_requirements <> v_second.price_context_requirements
  then
    raise exception 'FAIL: repeated save changed canonical identity/value';
  end if;

  select count(*)
  into v_row_count
  from public.store_commercial_ai_settings row_data
  where row_data.organization_id = v_target.organization_id
    and row_data.store_id = v_target.id;

  if v_row_count <> 1 then
    raise exception 'FAIL: repeated save created duplicate canonical rows';
  end if;

  ---------------------------------------------------------------------------
  -- 12. Invalid canonical values must fail closed.
  ---------------------------------------------------------------------------
  begin
    perform public.upsert_store_commercial_ai_settings_with_legacy_mirror_scoped(
      v_target.organization_id,
      v_target.id,
      'invalid',
      '{}'::text[]
    );
  exception when others then
    v_invalid_policy_sqlstate := sqlstate;
  end;

  begin
    perform public.upsert_store_commercial_ai_settings_with_legacy_mirror_scoped(
      v_target.organization_id,
      v_target.id,
      'direct_when_asked',
      array['so_apos_identificar_interesse_real']::text[]
    );
  exception when others then
    v_invalid_requirement_sqlstate := sqlstate;
  end;

  if v_invalid_policy_sqlstate <> '23514'
     or v_invalid_requirement_sqlstate <> '23514'
  then
    raise exception
      'FAIL: invalid values were not rejected (policy %, requirement %)',
      v_invalid_policy_sqlstate,
      v_invalid_requirement_sqlstate;
  end if;

  ---------------------------------------------------------------------------
  -- 13. RLS + cross-tenant writer isolation.
  ---------------------------------------------------------------------------
  if v_other_store.id is not null then
    select count(*)
    into v_visible_other
    from public.store_commercial_ai_settings row_data
    where row_data.organization_id = v_other_store.organization_id
      and row_data.store_id = v_other_store.id;

    if v_visible_other <> 0 then
      raise exception 'FAIL: authenticated member can see another tenant canonical row';
    end if;

    begin
      perform public.upsert_store_commercial_ai_settings_with_legacy_mirror_scoped(
        v_other_store.organization_id,
        v_other_store.id,
        'direct_when_asked',
        '{}'::text[]
      );
    exception when others then
      v_cross_tenant_sqlstate := sqlstate;
    end;

    if v_cross_tenant_sqlstate <> '42501' then
      raise exception
        'FAIL: cross-tenant writer was not blocked with 42501 (got %)',
        v_cross_tenant_sqlstate;
    end if;
  else
    raise notice
      'NOTICE: no second tenant unavailable; real cross-tenant row visibility probe skipped';
  end if;

  raise notice 'PASS: p19a store_commercial_ai_settings canonical manual checks';
end;
$runner$;

rollback;
