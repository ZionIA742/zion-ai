begin;

do $runner$
declare
  v_target public.stores%rowtype;
  v_member public.memberships%rowtype;
  v_other_store public.stores%rowtype;

  v_before_high_value jsonb;
  v_after_high_value jsonb;

  v_first public.store_discount_settings%rowtype;
  v_second public.store_discount_settings%rowtype;
  v_empty public.store_discount_settings%rowtype;
  v_legacy_compat public.store_discount_settings%rowtype;

  v_base_grant_allowed boolean;
  v_wrapper_grant_allowed boolean;
  v_service_wrapper_allowed boolean;
  v_cross_tenant_sqlstate text;
  v_bad_backfill_rows bigint;
begin
  ---------------------------------------------------------------------------
  -- 1. Column contract
  ---------------------------------------------------------------------------
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_discount_settings'
      and column_name = 'discount_special_rules'
      and data_type = 'text'
      and is_nullable = 'YES'
  ) then
    raise exception 'FAIL: nullable discount_special_rules text column missing';
  end if;

  ---------------------------------------------------------------------------
  -- 2. Writer grants / backwards-compatible SQL call surface
  ---------------------------------------------------------------------------
  v_base_grant_allowed := has_function_privilege(
    'authenticated',
    'public.upsert_store_discount_settings_scoped(uuid,uuid,numeric,numeric,boolean,text,text)',
    'EXECUTE'
  );

  v_wrapper_grant_allowed := has_function_privilege(
    'authenticated',
    'public.upsert_store_discount_settings_with_legacy_mirror_scoped(uuid,uuid,numeric,numeric,boolean,text,text)',
    'EXECUTE'
  );

  v_service_wrapper_allowed := has_function_privilege(
    'service_role',
    'public.upsert_store_discount_settings_with_legacy_mirror_scoped(uuid,uuid,numeric,numeric,boolean,text,text)',
    'EXECUTE'
  );

  if v_base_grant_allowed
     or not v_wrapper_grant_allowed
     or v_service_wrapper_allowed
  then
    raise exception 'FAIL: discount writer grants mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid =
      'public.upsert_store_discount_settings_scoped(uuid,uuid,numeric,numeric,boolean,text,text)'::regprocedure
      and p.prosecdef is true
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.proconfig::text like '%search_path=pg_catalog, public, pg_temp%'
      and p.proconfig::text like '%row_security=off%'
  ) or not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid =
      'public.upsert_store_discount_settings_with_legacy_mirror_scoped(uuid,uuid,numeric,numeric,boolean,text,text)'::regprocedure
      and p.prosecdef is true
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.proconfig::text like '%search_path=pg_catalog, public, pg_temp%'
      and p.proconfig::text like '%row_security=off%'
  ) then
    raise exception 'FAIL: discount writer hardening/owner mismatch';
  end if;

  ---------------------------------------------------------------------------
  -- 3. Verify conservative migration backfill against live legacy evidence.
  ---------------------------------------------------------------------------
  with legacy_answers as (
    select
      answer_row.organization_id,
      answer_row.store_id,
      answer_row.question_key,
      answer_row.answer,
      nullif(pg_catalog.btrim(answer_row.answer #>> '{}'), '') as answer_text
    from public.store_onboarding_answers answer_row
    where answer_row.question_key in (
      'discount_special_rules',
      'human_help_discount_cases_selected',
      'human_help_discount_cases_other'
    )
  ),
  grouped as (
    select
      organization_id,
      store_id,

      count(distinct answer_text) filter (
        where question_key = 'discount_special_rules'
          and answer_text is not null
      ) as explicit_rule_count,

      case
        when count(distinct answer_text) filter (
          where question_key = 'discount_special_rules'
            and answer_text is not null
        ) = 1
        then max(answer_text) filter (
          where question_key = 'discount_special_rules'
            and answer_text is not null
        )
        else null
      end as explicit_rule,

      count(distinct answer_text) filter (
        where question_key = 'human_help_discount_cases_other'
          and answer_text is not null
      ) as other_rule_count,

      case
        when count(distinct answer_text) filter (
          where question_key = 'human_help_discount_cases_other'
            and answer_text is not null
        ) = 1
        then max(answer_text) filter (
          where question_key = 'human_help_discount_cases_other'
            and answer_text is not null
        )
        else null
      end as other_rule,

      count(distinct answer::text) filter (
        where question_key = 'human_help_discount_cases_selected'
          and answer is not null
          and answer <> 'null'::jsonb
          and pg_catalog.jsonb_typeof(answer) = 'array'
      ) as selected_array_count,

      count(*) filter (
        where question_key = 'human_help_discount_cases_selected'
          and answer is not null
          and answer <> 'null'::jsonb
          and pg_catalog.jsonb_typeof(answer) <> 'array'
      ) as selected_invalid_count,

      case
        when count(distinct answer::text) filter (
          where question_key = 'human_help_discount_cases_selected'
            and answer is not null
            and answer <> 'null'::jsonb
            and pg_catalog.jsonb_typeof(answer) = 'array'
        ) = 1
        and count(*) filter (
          where question_key = 'human_help_discount_cases_selected'
            and answer is not null
            and answer <> 'null'::jsonb
            and pg_catalog.jsonb_typeof(answer) <> 'array'
        ) = 0
        then max(answer::text) filter (
          where question_key = 'human_help_discount_cases_selected'
            and answer is not null
            and answer <> 'null'::jsonb
            and pg_catalog.jsonb_typeof(answer) = 'array'
        )
        else null
      end as selected_cases_json
    from legacy_answers
    group by organization_id, store_id
  ),
  expected as (
    select
      grouped_row.organization_id,
      grouped_row.store_id,
      case
        when grouped_row.explicit_rule_count = 1
          then grouped_row.explicit_rule
        when grouped_row.explicit_rule_count > 1
          then null
        when grouped_row.explicit_rule_count = 0
          and grouped_row.other_rule_count = 1
          and grouped_row.selected_array_count = 1
          and grouped_row.selected_invalid_count = 0
          and grouped_row.selected_cases_json is not null
          and exists (
            select 1
            from pg_catalog.jsonb_array_elements_text(
              grouped_row.selected_cases_json::jsonb
            ) as selected_case
            where pg_catalog.lower(pg_catalog.btrim(selected_case))
              = 'quer_condicao_especial'
          )
        then grouped_row.other_rule
        else null
      end as expected_rule
    from grouped grouped_row
  )
  select count(*)
  into v_bad_backfill_rows
  from expected expected_row
  join public.store_discount_settings discount_row
    on discount_row.organization_id = expected_row.organization_id
   and discount_row.store_id = expected_row.store_id
  where (
      expected_row.expected_rule is not null
      and discount_row.discount_special_rules is distinct from expected_row.expected_rule
    )
    or (
      expected_row.expected_rule is null
      and expected_row.store_id is not null
      and discount_row.discount_special_rules is not null
      and exists (
        select 1
        from grouped grouped_row
        where grouped_row.organization_id = expected_row.organization_id
          and grouped_row.store_id = expected_row.store_id
          and grouped_row.explicit_rule_count > 1
      )
    );

  if v_bad_backfill_rows <> 0 then
    raise exception
      'FAIL: discount_special_rules conservative backfill mismatch on % row(s)',
      v_bad_backfill_rows;
  end if;

  ---------------------------------------------------------------------------
  -- 4. Choose a real store with an active member.
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

  select coalesce(
    jsonb_agg(to_jsonb(row_data) order by row_data.store_id),
    '[]'::jsonb
  )
  into v_before_high_value
  from (
    select *
    from public.store_high_value_discount_settings
    where organization_id = v_target.organization_id
  ) row_data;

  ---------------------------------------------------------------------------
  -- 5. Authenticated writer behavior
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_member.user_id::text, true);
  perform set_config('role', 'authenticated', true);

  v_first := public.upsert_store_discount_settings_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.id,
    5,
    12,
    true,
    'within_policy_autonomous',
    'Cliente importante pode ter condicao especial aprovada pelo responsavel.'
  );

  if v_first.default_discount_percent <> 5
     or v_first.max_discount_percent <> 12
     or v_first.allow_ask_above_max_discount is not true
     or v_first.discount_autonomy_mode <> 'within_policy_autonomous'
     or v_first.discount_special_rules <>
       'Cliente importante pode ter condicao especial aprovada pelo responsavel.'
  then
    raise exception 'FAIL: writer did not save discount policy plus special rules exactly';
  end if;

  -- Verify the privileged legacy mirror outside the authenticated RLS view.
  execute 'reset role';

  if not exists (
    select 1
    from public.store_onboarding_answers answer_row
    where answer_row.organization_id = v_target.organization_id
      and answer_row.store_id = v_target.id
      and answer_row.question_key = 'discount_special_rules'
      and answer_row.answer = to_jsonb(v_first.discount_special_rules)
  ) then
    raise exception 'FAIL: non-null discount_special_rules legacy mirror missing';
  end if;

  -- Return to the authenticated member context for the next writer checks.
  perform set_config('role', 'authenticated', true);

  ---------------------------------------------------------------------------
  -- 6. Changing only special rules must preserve core discount policy.
  ---------------------------------------------------------------------------
  v_second := public.upsert_store_discount_settings_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.id,
    5,
    12,
    true,
    'within_policy_autonomous',
    'Somente gerente aprova excecao acima do teto.'
  );

  if v_second.default_discount_percent <> v_first.default_discount_percent
     or v_second.max_discount_percent <> v_first.max_discount_percent
     or v_second.allow_ask_above_max_discount <> v_first.allow_ask_above_max_discount
     or v_second.discount_autonomy_mode <> v_first.discount_autonomy_mode
     or v_second.discount_special_rules <> 'Somente gerente aprova excecao acima do teto.'
  then
    raise exception 'FAIL: updating special rules changed core discount policy';
  end if;

  ---------------------------------------------------------------------------
  -- 7. Blank -> canonical NULL and legacy empty string.
  ---------------------------------------------------------------------------
  v_empty := public.upsert_store_discount_settings_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.id,
    5,
    12,
    true,
    'within_policy_autonomous',
    '   '
  );

  if v_empty.discount_special_rules is not null then
    raise exception 'FAIL: blank special rules should normalize to canonical null';
  end if;

  -- Verify canonical NULL -> legacy empty string outside authenticated RLS.
  execute 'reset role';

  if not exists (
    select 1
    from public.store_onboarding_answers answer_row
    where answer_row.organization_id = v_target.organization_id
      and answer_row.store_id = v_target.id
      and answer_row.question_key = 'discount_special_rules'
      and answer_row.answer = to_jsonb(''::text)
  ) then
    raise exception 'FAIL: canonical null must mirror as empty legacy string';
  end if;

  -- Return to authenticated for backwards-compatibility writer proof.
  perform set_config('role', 'authenticated', true);

  ---------------------------------------------------------------------------
  -- 8. Backwards compatibility: old 6-argument SQL call must still resolve.
  -- The new seventh parameter is optional/default NULL.
  ---------------------------------------------------------------------------
  v_legacy_compat := public.upsert_store_discount_settings_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.id,
    5,
    12,
    true,
    'within_policy_autonomous'
  );

  if v_legacy_compat.default_discount_percent <> 5
     or v_legacy_compat.max_discount_percent <> 12
     or v_legacy_compat.allow_ask_above_max_discount is not true
     or v_legacy_compat.discount_autonomy_mode <> 'within_policy_autonomous'
     or v_legacy_compat.discount_special_rules is not null
  then
    raise exception 'FAIL: legacy 6-argument writer call is not backwards-compatible';
  end if;

  ---------------------------------------------------------------------------
  -- 9. High-value policy must remain byte-for-byte unchanged.
  -- Compare under the same privileged visibility used for v_before_high_value.
  ---------------------------------------------------------------------------
  execute 'reset role';

  select coalesce(
    jsonb_agg(to_jsonb(row_data) order by row_data.store_id),
    '[]'::jsonb
  )
  into v_after_high_value
  from (
    select *
    from public.store_high_value_discount_settings
    where organization_id = v_target.organization_id
  ) row_data;

  if v_after_high_value <> v_before_high_value then
    raise exception 'FAIL: discount_special_rules writer changed high-value settings';
  end if;

  -- Return to authenticated for isolation checks.
  perform set_config('role', 'authenticated', true);

  ---------------------------------------------------------------------------
  -- 10. Cross-tenant/scoped writes must fail closed.
  ---------------------------------------------------------------------------
  if v_other_store.id is not null then
    begin
      perform public.upsert_store_discount_settings_with_legacy_mirror_scoped(
        v_other_store.organization_id,
        v_other_store.id,
        1,
        2,
        false,
        'approval_required',
        'cross tenant probe'
      );
    exception when others then
      v_cross_tenant_sqlstate := sqlstate;
    end;

    if v_cross_tenant_sqlstate <> '42501' then
      raise exception
        'FAIL: cross-tenant discount write was not blocked with 42501 (got %)',
        v_cross_tenant_sqlstate;
    end if;
  else
    -- Still prove store/organization scoping if the database has one tenant only.
    begin
      perform public.upsert_store_discount_settings_with_legacy_mirror_scoped(
        v_target.organization_id,
        gen_random_uuid(),
        1,
        2,
        false,
        'approval_required',
        'invalid scoped store probe'
      );
    exception when others then
      v_cross_tenant_sqlstate := sqlstate;
    end;

    if v_cross_tenant_sqlstate <> '42501' then
      raise exception
        'FAIL: scoped-store discount write was not blocked with 42501 (got %)',
        v_cross_tenant_sqlstate;
    end if;
  end if;

  raise notice 'PASS: p19a discount_special_rules manual checks';
end;
$runner$;

rollback;
