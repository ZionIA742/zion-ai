begin;

set transaction isolation level repeatable read;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_profile_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_profile_ctx (
  singleton boolean primary key default true check (singleton),
  org_a uuid not null,
  org_b uuid not null,
  store_a uuid not null,
  store_b_same_org uuid not null,
  store_c_other_org uuid not null,
  user_a uuid not null,
  user_b uuid not null,
  user_inactive_a uuid not null,
  customer_a uuid not null,
  customer_b uuid not null,
  opp_a uuid not null,
  opp_peer uuid not null,
  opp_other_org uuid not null,
  pool_a uuid not null,
  pool_same_org_other_store uuid not null,
  pool_other_org uuid not null,
  catalog_a uuid not null,
  catalog_same_org_other_store uuid not null,
  catalog_other_org uuid not null,
  profile_v1 uuid not null,
  profile_v2 uuid not null,
  baseline_pools_count bigint not null,
  baseline_catalog_count bigint not null
) on commit preserve rows;

insert into pg_temp._p9_profile_ctx (
  org_a,
  org_b,
  store_a,
  store_b_same_org,
  store_c_other_org,
  user_a,
  user_b,
  user_inactive_a,
  customer_a,
  customer_b,
  opp_a,
  opp_peer,
  opp_other_org,
  pool_a,
  pool_same_org_other_store,
  pool_other_org,
  catalog_a,
  catalog_same_org_other_store,
  catalog_other_org,
  profile_v1,
  profile_v2,
  baseline_pools_count,
  baseline_catalog_count
)
values (
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  (select count(*) from public.pools),
  (select count(*) from public.store_catalog_items)
);

create or replace function pg_temp._p9_profile_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text default null
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_profile_results (
    scenario_number,
    scenario_name,
    status,
    detail
  )
  values (
    p_scenario_number,
    p_scenario_name,
    p_status,
    coalesce(p_detail, '<null>')
  )
  on conflict (scenario_number) do update
  set
    scenario_name = excluded.scenario_name,
    status = excluded.status,
    detail = excluded.detail;
end;
$function$;

create or replace function pg_temp._p9_profile_expect(
  p_scenario_number integer,
  p_scenario_name text,
  p_condition boolean,
  p_detail text default null
)
returns void
language plpgsql
as $function$
begin
  perform pg_temp._p9_profile_record(
    p_scenario_number,
    p_scenario_name,
    case when p_condition then 'PASS' else 'SUT_FAIL' end,
    coalesce(p_detail, case when p_condition then 'ok' else 'condition returned false' end)
  );
exception
  when others then
    perform pg_temp._p9_profile_record(
      p_scenario_number,
      p_scenario_name,
      'HARNESS_ERROR',
      sqlstate || ': ' || sqlerrm
    );
end;
$function$;

create or replace function pg_temp._p9_profile_expect_fail(
  p_scenario_number integer,
  p_scenario_name text,
  p_sql text,
  p_expected_sqlstates text[],
  p_expected_constraint text default null,
  p_expected_message_contains text default null
)
returns void
language plpgsql
as $function$
declare
  v_state text;
  v_message text;
  v_constraint text;
  v_state_matches boolean;
  v_constraint_matches boolean;
  v_message_matches boolean;
begin
  if coalesce(pg_catalog.array_length(p_expected_sqlstates, 1), 0) = 0 then
    perform pg_temp._p9_profile_record(
      p_scenario_number,
      p_scenario_name,
      'HARNESS_ERROR',
      'expected SQLSTATE allowlist is empty'
    );
    return;
  end if;

  begin
    execute p_sql;

    perform pg_temp._p9_profile_record(
      p_scenario_number,
      p_scenario_name,
      'SUT_FAIL',
      'statement unexpectedly succeeded'
    );
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;

      v_state_matches := v_state = any(p_expected_sqlstates);
      v_constraint_matches :=
        p_expected_constraint is null
        or v_constraint is not distinct from p_expected_constraint;
      v_message_matches :=
        p_expected_message_contains is null
        or pg_catalog.strpos(coalesce(v_message, ''), p_expected_message_contains) > 0;

      perform pg_temp._p9_profile_record(
        p_scenario_number,
        p_scenario_name,
        case
          when v_state_matches
           and v_constraint_matches
           and v_message_matches
          then 'PASS'
          else 'SUT_FAIL'
        end,
        pg_catalog.format(
          'actual=%s constraint=%s message=%s / expected_states=%s expected_constraint=%s expected_message_contains=%s',
          coalesce(v_state, '<null>'),
          coalesce(v_constraint, '<null>'),
          coalesce(v_message, '<null>'),
          p_expected_sqlstates::text,
          coalesce(p_expected_constraint, '<any>'),
          coalesce(p_expected_message_contains, '<any>')
        )
      );
  end;
exception
  when others then
    perform pg_temp._p9_profile_record(
      p_scenario_number,
      p_scenario_name,
      'HARNESS_ERROR',
      sqlstate || ': ' || sqlerrm
    );
end;
$function$;

create or replace function pg_temp._p9_profile_index_columns(
  p_index_name text
)
returns name[]
language sql
stable
as $function$
  select pg_catalog.array_agg(attribute_row.attname order by key_row.ordinality)
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_class
    on index_class.oid = index_row.indexrelid
  join pg_catalog.pg_class table_class
    on table_class.oid = index_row.indrelid
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = table_class.relnamespace
  join pg_catalog.unnest(index_row.indkey) with ordinality as key_row(attnum, ordinality)
    on true
  join pg_catalog.pg_attribute attribute_row
    on attribute_row.attrelid = table_class.oid
   and attribute_row.attnum = key_row.attnum
  where namespace_row.nspname = 'public'
    and index_class.relname = p_index_name;
$function$;

create or replace function pg_temp._p9_profile_unique_index_is_exact(
  p_table_name text,
  p_index_name text,
  p_columns name[],
  p_expect_partial boolean default false
)
returns boolean
language sql
stable
as $function$
  select exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_class
      on index_class.oid = index_row.indexrelid
    join pg_catalog.pg_class table_class
      on table_class.oid = index_row.indrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = table_class.relnamespace
    where namespace_row.nspname = 'public'
      and table_class.relname = p_table_name
      and index_class.relname = p_index_name
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indexprs is null
      and (
        (p_expect_partial and index_row.indpred is not null)
        or (not p_expect_partial and index_row.indpred is null)
      )
      and pg_temp._p9_profile_index_columns(p_index_name) = p_columns
  );
$function$;

-- --------------------------------------------------------------------------
-- Fixtures. Everything is rolled back at the end.
-- --------------------------------------------------------------------------
do $fixtures$
declare
  ctx pg_temp._p9_profile_ctx%rowtype;
begin
  select * into ctx from pg_temp._p9_profile_ctx;

  insert into public.organizations (id, name, subscription_status)
  values
    (ctx.org_a, 'P9 Profile Runner Org A', 'active'),
    (ctx.org_b, 'P9 Profile Runner Org B', 'active');

  insert into public.stores (id, organization_id, name)
  values
    (ctx.store_a, ctx.org_a, 'P9 Profile Runner Store A'),
    (ctx.store_b_same_org, ctx.org_a, 'P9 Profile Runner Store B'),
    (ctx.store_c_other_org, ctx.org_b, 'P9 Profile Runner Store C');

  insert into auth.users (id)
  values
    (ctx.user_a),
    (ctx.user_b),
    (ctx.user_inactive_a);

  insert into public.memberships (organization_id, user_id, role, is_active)
  values
    (ctx.org_a, ctx.user_a, 'owner'::public.app_role, true),
    (ctx.org_b, ctx.user_b, 'owner'::public.app_role, true),
    (ctx.org_a, ctx.user_inactive_a, 'owner'::public.app_role, false);

  insert into public.customers (id, organization_id, display_name)
  values
    (ctx.customer_a, ctx.org_a, 'P9 Profile Customer A'),
    (ctx.customer_b, ctx.org_b, 'P9 Profile Customer B');

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    stage
  )
  values
    (ctx.opp_a, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'),
    (ctx.opp_peer, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'),
    (ctx.opp_other_org, ctx.org_b, ctx.store_c_other_org, ctx.customer_b, 'qualificacao');

  insert into public.pools (
    id,
    organization_id,
    store_id,
    name,
    width_m,
    length_m,
    depth_m,
    shape,
    material,
    max_capacity_l,
    weight_kg,
    price,
    price_status,
    description,
    is_active,
    track_stock,
    stock_quantity,
    stock_status
  )
  values
    (
      ctx.pool_a,
      ctx.org_a,
      ctx.store_a,
      'P9 Profile Pool A',
      2,
      3,
      1,
      'retangular',
      'vinil',
      1000,
      200,
      5000,
      'valid',
      'Profile fixture pool A',
      true,
      false,
      null,
      'not_tracked'
    ),
    (
      ctx.pool_same_org_other_store,
      ctx.org_a,
      ctx.store_b_same_org,
      'P9 Profile Pool Same Org Other Store',
      2,
      3,
      1,
      'retangular',
      'vinil',
      1000,
      200,
      5500,
      'valid',
      'Profile fixture pool same org other store',
      true,
      false,
      null,
      'not_tracked'
    ),
    (
      ctx.pool_other_org,
      ctx.org_b,
      ctx.store_c_other_org,
      'P9 Profile Pool Other Org',
      2,
      3,
      1,
      'retangular',
      'vinil',
      1000,
      200,
      6000,
      'valid',
      'Profile fixture pool other org',
      true,
      false,
      null,
      'not_tracked'
    );

  insert into public.store_catalog_items (
    id,
    organization_id,
    store_id,
    sku,
    name,
    description,
    price_cents,
    price_status,
    currency,
    is_active,
    track_stock,
    stock_quantity,
    stock_status,
    metadata
  )
  values
    (
      ctx.catalog_a,
      ctx.org_a,
      ctx.store_a,
      'P9-PROFILE-A',
      'P9 Profile Catalog A',
      'Profile fixture catalog A',
      1000,
      'valid',
      'BRL',
      true,
      false,
      null,
      'not_tracked',
      jsonb_build_object('runner', 'p9_profile')
    ),
    (
      ctx.catalog_same_org_other_store,
      ctx.org_a,
      ctx.store_b_same_org,
      'P9-PROFILE-B-SAME-ORG',
      'P9 Profile Catalog Same Org Other Store',
      'Profile fixture catalog same org other store',
      1500,
      'valid',
      'BRL',
      true,
      false,
      null,
      'not_tracked',
      jsonb_build_object('runner', 'p9_profile')
    ),
    (
      ctx.catalog_other_org,
      ctx.org_b,
      ctx.store_c_other_org,
      'P9-PROFILE-C',
      'P9 Profile Catalog Other Org',
      'Profile fixture catalog other org',
      2000,
      'valid',
      'BRL',
      true,
      false,
      null,
      'not_tracked',
      jsonb_build_object('runner', 'p9_profile')
    );

  insert into public.commercial_opportunity_profile_versions (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    version_number,
    previous_profile_version_id,
    profile_state,
    operation_key,
    request_fingerprint,
    actor_type,
    actor_user_id,
    source_type,
    reason_code,
    created_by
  )
  values
    (
      ctx.profile_v1,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      1,
      null,
      'needs_clarification',
      'p9_profile_fixture:v1',
      repeat('a', 64),
      'system',
      null,
      'manual_check',
      'manual_check_seed',
      'p9_profile_manual_check'
    ),
    (
      ctx.profile_v2,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      2,
      ctx.profile_v1,
      'resolved',
      'p9_profile_fixture:v2',
      repeat('b', 64),
      'human',
      ctx.user_a,
      'crm_manual',
      'manual_resolution',
      'user:' || ctx.user_a::text
    );

  insert into public.commercial_opportunity_profile_components (
    organization_id,
    store_id,
    commercial_opportunity_id,
    profile_version_id,
    component_key,
    component_kind,
    component_state,
    reference_text
  )
  values (
    ctx.org_a,
    ctx.store_a,
    ctx.opp_a,
    ctx.profile_v1,
    'primary_pool',
    'pool',
    'partial',
    'Pool model not yet resolved'
  );

  insert into public.commercial_opportunity_profile_execution_intents (
    organization_id,
    store_id,
    commercial_opportunity_id,
    profile_version_id,
    execution_kind,
    intent_state,
    reason_code
  )
  values (
    ctx.org_a,
    ctx.store_a,
    ctx.opp_a,
    ctx.profile_v1,
    'installation',
    'unresolved',
    'needs_customer_clarification'
  );

  insert into public.commercial_opportunity_profile_components (
    organization_id,
    store_id,
    commercial_opportunity_id,
    profile_version_id,
    component_key,
    component_kind,
    component_state,
    pool_id
  )
  values (
    ctx.org_a,
    ctx.store_a,
    ctx.opp_a,
    ctx.profile_v2,
    'primary_pool',
    'pool',
    'resolved',
    ctx.pool_a
  );

  insert into public.commercial_opportunity_profile_execution_intents (
    organization_id,
    store_id,
    commercial_opportunity_id,
    profile_version_id,
    execution_kind,
    intent_state,
    reason_code
  )
  values (
    ctx.org_a,
    ctx.store_a,
    ctx.opp_a,
    ctx.profile_v2,
    'installation',
    'included',
    'manual_resolution'
  );

  insert into public.commercial_opportunity_profile_current (
    organization_id,
    store_id,
    commercial_opportunity_id,
    current_profile_version_id,
    last_operation_key
  )
  values (
    ctx.org_a,
    ctx.store_a,
    ctx.opp_a,
    ctx.profile_v2,
    'p9_profile_fixture:v2'
  );
end;
$fixtures$;

-- --------------------------------------------------------------------------
-- Structural checks.
-- --------------------------------------------------------------------------
do $structural_checks$
declare
  v_tables text[] := array[
    'commercial_opportunity_profile_versions',
    'commercial_opportunity_profile_components',
    'commercial_opportunity_profile_execution_intents',
    'commercial_opportunity_profile_current'
  ];
  v_function regprocedure;
begin
  perform pg_temp._p9_profile_expect(
    1,
    'profile foundation tables exist',
    not exists (
      select 1
      from pg_catalog.unnest(v_tables) as table_name
      where pg_catalog.to_regclass('public.' || table_name) is null
    )
  );

  perform pg_temp._p9_profile_expect(
    2,
    'candidate key indexes are unique and have exact columns',
    pg_temp._p9_profile_unique_index_is_exact(
      'pools',
      'pools_id_organization_store_uidx',
      array['id', 'organization_id', 'store_id']::name[]
    )
    and pg_temp._p9_profile_unique_index_is_exact(
      'store_catalog_items',
      'store_catalog_items_id_organization_store_uidx',
      array['id', 'organization_id', 'store_id']::name[]
    )
  );

  perform pg_temp._p9_profile_expect(
    3,
    'version keys and anti-branch index exist',
    pg_temp._p9_profile_unique_index_is_exact(
      'commercial_opportunity_profile_versions',
      'p9_profile_versions_scope_version_number_uidx',
      array['organization_id', 'store_id', 'commercial_opportunity_id', 'version_number']::name[]
    )
    and pg_temp._p9_profile_unique_index_is_exact(
      'commercial_opportunity_profile_versions',
      'p9_profile_versions_scope_operation_uidx',
      array['organization_id', 'store_id', 'commercial_opportunity_id', 'operation_key']::name[]
    )
    and pg_temp._p9_profile_unique_index_is_exact(
      'commercial_opportunity_profile_versions',
      'p9_profile_versions_scope_id_uidx',
      array['id', 'organization_id', 'store_id', 'commercial_opportunity_id']::name[]
    )
    and pg_temp._p9_profile_unique_index_is_exact(
      'commercial_opportunity_profile_versions',
      'p9_profile_versions_previous_once_uidx',
      array[
        'organization_id',
        'store_id',
        'commercial_opportunity_id',
        'previous_profile_version_id'
      ]::name[],
      true
    )
  );

  perform pg_temp._p9_profile_expect(
    4,
    'component and execution unique indexes exist',
    pg_temp._p9_profile_unique_index_is_exact(
      'commercial_opportunity_profile_components',
      'p9_profile_components_version_component_key_uidx',
      array['profile_version_id', 'component_key']::name[]
    )
    and pg_temp._p9_profile_unique_index_is_exact(
      'commercial_opportunity_profile_execution_intents',
      'p9_profile_execution_intents_version_kind_uidx',
      array['profile_version_id', 'execution_kind']::name[]
    )
  );

  perform pg_temp._p9_profile_expect(
    5,
    'composite foreign keys exist',
    exists (
      select 1
      from pg_catalog.pg_constraint
      where conname = 'p9_profile_versions_opp_scope_fk'
        and conrelid = 'public.commercial_opportunity_profile_versions'::regclass
        and contype = 'f'
    )
    and exists (
      select 1
      from pg_catalog.pg_constraint
      where conname = 'p9_profile_versions_previous_scope_fk'
        and conrelid = 'public.commercial_opportunity_profile_versions'::regclass
        and contype = 'f'
    )
    and exists (
      select 1
      from pg_catalog.pg_constraint
      where conname = 'p9_profile_components_version_scope_fk'
        and conrelid = 'public.commercial_opportunity_profile_components'::regclass
        and contype = 'f'
    )
    and exists (
      select 1
      from pg_catalog.pg_constraint
      where conname = 'p9_profile_components_pool_scope_fk'
        and conrelid = 'public.commercial_opportunity_profile_components'::regclass
        and contype = 'f'
    )
    and exists (
      select 1
      from pg_catalog.pg_constraint
      where conname = 'p9_profile_components_catalog_scope_fk'
        and conrelid = 'public.commercial_opportunity_profile_components'::regclass
        and contype = 'f'
    )
    and exists (
      select 1
      from pg_catalog.pg_constraint
      where conname = 'p9_profile_current_version_scope_fk'
        and conrelid = 'public.commercial_opportunity_profile_current'::regclass
        and contype = 'f'
    )
  );

  perform pg_temp._p9_profile_expect(
    6,
    'check constraints exist',
    not exists (
      select 1
      from (
        values
          ('p9_profile_versions_profile_state_chk'::text),
          ('p9_profile_versions_request_fingerprint_chk'),
          ('p9_profile_versions_actor_user_chk'),
          ('p9_profile_components_kind_chk'),
          ('p9_profile_components_state_chk'),
          ('p9_profile_components_catalog_refs_chk'),
          ('p9_profile_components_resolution_shape_chk'),
          ('p9_profile_execution_intents_kind_chk'),
          ('p9_profile_execution_intents_state_chk'),
          ('p9_profile_current_last_operation_key_chk')
      ) as expected(conname)
      where not exists (
        select 1
        from pg_catalog.pg_constraint constraint_row
        where constraint_row.conname = expected.conname
      )
    )
  );

  perform pg_temp._p9_profile_expect(
    7,
    'immutability and current projection triggers exist',
    not exists (
      select 1
      from (
        values
          ('commercial_opportunity_profile_versions'::text, 'p9_profile_versions_append_only'::text),
          ('commercial_opportunity_profile_components', 'p9_profile_components_append_only'),
          ('commercial_opportunity_profile_execution_intents', 'p9_profile_execution_intents_append_only'),
          ('commercial_opportunity_profile_current', 'p9_profile_current_validate_projection'),
          ('commercial_opportunity_profile_current', 'p9_profile_current_touch_updated_at')
      ) as expected(table_name, trigger_name)
      where not exists (
        select 1
        from pg_catalog.pg_trigger trigger_row
        where trigger_row.tgrelid = ('public.' || expected.table_name)::regclass
          and trigger_row.tgname = expected.trigger_name
          and not trigger_row.tgisinternal
      )
    )
  );

  perform pg_temp._p9_profile_expect(
    8,
    'RLS enabled on profile tables',
    not exists (
      select 1
      from pg_catalog.unnest(v_tables) as table_name
      where not exists (
        select 1
        from pg_catalog.pg_class class_row
        join pg_catalog.pg_namespace namespace_row
          on namespace_row.oid = class_row.relnamespace
        where namespace_row.nspname = 'public'
          and class_row.relname = table_name
          and class_row.relrowsecurity
      )
    )
  );

  perform pg_temp._p9_profile_expect(
    9,
    'authenticated and service_role have SELECT only, anon has no direct access',
    not exists (
      select 1
      from pg_catalog.unnest(v_tables) as table_name
      where not pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'SELECT')
         or not pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'SELECT')
         or pg_catalog.has_table_privilege('anon', 'public.' || table_name, 'SELECT')
         or pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'INSERT')
         or pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'UPDATE')
         or pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'DELETE')
         or pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'INSERT')
         or pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'UPDATE')
         or pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'DELETE')
         or pg_catalog.has_table_privilege('anon', 'public.' || table_name, 'INSERT')
         or pg_catalog.has_table_privilege('anon', 'public.' || table_name, 'UPDATE')
         or pg_catalog.has_table_privilege('anon', 'public.' || table_name, 'DELETE')
    )
  );

  perform pg_temp._p9_profile_expect(
    10,
    'active membership SELECT policies exist',
    not exists (
      select 1
      from (
        values
          ('commercial_opportunity_profile_versions'::text, 'p9_profile_versions_select_active_membership'::text),
          ('commercial_opportunity_profile_components', 'p9_profile_components_select_active_membership'),
          ('commercial_opportunity_profile_execution_intents', 'p9_profile_execution_intents_select_active_membership'),
          ('commercial_opportunity_profile_current', 'p9_profile_current_select_active_membership')
      ) as expected(table_name, policy_name)
      where not exists (
        select 1
        from pg_catalog.pg_policy policy_row
        where policy_row.polrelid = ('public.' || expected.table_name)::regclass
          and policy_row.polname = expected.policy_name
      )
    )
  );

  perform pg_temp._p9_profile_expect(
    11,
    'required columns, types and defaults exist',
    not exists (
      select 1
      from (
        values
          ('commercial_opportunity_profile_versions'::text, 'id'::text, 'uuid'::text, 'NO'::text, 'gen_random_uuid'::text),
          ('commercial_opportunity_profile_versions', 'version_number', 'integer', 'NO', null),
          ('commercial_opportunity_profile_versions', 'previous_profile_version_id', 'uuid', 'YES', null),
          ('commercial_opportunity_profile_versions', 'profile_state', 'text', 'NO', null),
          ('commercial_opportunity_profile_versions', 'operation_key', 'text', 'NO', null),
          ('commercial_opportunity_profile_versions', 'request_fingerprint', 'text', 'NO', null),
          ('commercial_opportunity_profile_versions', 'actor_type', 'text', 'NO', null),
          ('commercial_opportunity_profile_versions', 'actor_user_id', 'uuid', 'YES', null),
          ('commercial_opportunity_profile_versions', 'source_type', 'text', 'NO', null),
          ('commercial_opportunity_profile_versions', 'reason_code', 'text', 'NO', null),
          ('commercial_opportunity_profile_versions', 'created_by', 'text', 'NO', null),
          ('commercial_opportunity_profile_versions', 'metadata', 'jsonb', 'NO', '''{}''::jsonb'),
          ('commercial_opportunity_profile_versions', 'created_at', 'timestamp with time zone', 'NO', 'timezone'),
          ('commercial_opportunity_profile_components', 'profile_version_id', 'uuid', 'NO', null),
          ('commercial_opportunity_profile_components', 'component_key', 'text', 'NO', null),
          ('commercial_opportunity_profile_components', 'component_kind', 'text', 'NO', null),
          ('commercial_opportunity_profile_components', 'component_state', 'text', 'NO', null),
          ('commercial_opportunity_profile_components', 'pool_id', 'uuid', 'YES', null),
          ('commercial_opportunity_profile_components', 'catalog_item_id', 'uuid', 'YES', null),
          ('commercial_opportunity_profile_components', 'reference_text', 'text', 'YES', null),
          ('commercial_opportunity_profile_components', 'metadata', 'jsonb', 'NO', '''{}''::jsonb'),
          ('commercial_opportunity_profile_execution_intents', 'profile_version_id', 'uuid', 'NO', null),
          ('commercial_opportunity_profile_execution_intents', 'execution_kind', 'text', 'NO', null),
          ('commercial_opportunity_profile_execution_intents', 'intent_state', 'text', 'NO', null),
          ('commercial_opportunity_profile_execution_intents', 'reason_code', 'text', 'YES', null),
          ('commercial_opportunity_profile_execution_intents', 'metadata', 'jsonb', 'NO', '''{}''::jsonb'),
          ('commercial_opportunity_profile_current', 'current_profile_version_id', 'uuid', 'NO', null),
          ('commercial_opportunity_profile_current', 'last_operation_key', 'text', 'NO', null),
          ('commercial_opportunity_profile_current', 'updated_at', 'timestamp with time zone', 'NO', 'timezone')
      ) as expected(table_name, column_name, data_type, is_nullable, default_fragment)
      where not exists (
        select 1
        from information_schema.columns column_row
        where column_row.table_schema = 'public'
          and column_row.table_name = expected.table_name
          and column_row.column_name = expected.column_name
          and column_row.data_type = expected.data_type
          and column_row.is_nullable = expected.is_nullable
          and (
            expected.default_fragment is null
            or column_row.column_default ilike '%' || expected.default_fragment || '%'
          )
      )
    )
  );

  foreach v_function in array array[
    'public.p9_commercial_opportunity_profile_prevent_mutation()'::regprocedure,
    'public.p9_commercial_opportunity_profile_validate_current_projection()'::regprocedure,
    'public.p9_commercial_opportunity_profile_touch_current_updated_at()'::regprocedure
  ]
  loop
    perform pg_temp._p9_profile_expect(
      11 + array_position(array[
        'public.p9_commercial_opportunity_profile_prevent_mutation()'::regprocedure,
        'public.p9_commercial_opportunity_profile_validate_current_projection()'::regprocedure,
        'public.p9_commercial_opportunity_profile_touch_current_updated_at()'::regprocedure
      ], v_function),
      'internal function ownership/search_path/grants are hardened: ' || v_function::text,
      exists (
        select 1
        from pg_catalog.pg_proc proc_row
        join pg_catalog.pg_roles owner_role
          on owner_role.oid = proc_row.proowner
        where proc_row.oid = v_function::oid
          and owner_role.rolname = 'postgres'
          and proc_row.prosecdef is false
          and proc_row.proconfig @> array['search_path=pg_catalog, pg_temp']
      )
      and not pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE')
    );
  end loop;
end;
$structural_checks$;

-- --------------------------------------------------------------------------
-- Constraint and trigger behavior.
-- --------------------------------------------------------------------------
do $behavior_checks$
declare
  ctx pg_temp._p9_profile_ctx%rowtype;
begin
  select * into ctx from pg_temp._p9_profile_ctx;

  perform pg_temp._p9_profile_expect_fail(
    20,
    'version with scope of another opportunity fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_versions (
          organization_id, store_id, commercial_opportunity_id, version_number,
          profile_state, operation_key, request_fingerprint, actor_type,
          source_type, reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 1, 'resolved',
          'bad_scope', %L, 'system', 'manual_check', 'bad_scope',
          'p9_profile_manual_check'
        )
      $sql$,
      ctx.org_b,
      ctx.store_a,
      ctx.opp_a,
      repeat('c', 64)
    ),
    array['23503']
  );

  perform pg_temp._p9_profile_expect_fail(
    21,
    'previous version cross-opportunity fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_versions (
          organization_id, store_id, commercial_opportunity_id, version_number,
          previous_profile_version_id, profile_state, operation_key,
          request_fingerprint, actor_type, source_type, reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 1, %L::uuid, 'resolved',
          'bad_previous_scope', %L, 'system', 'manual_check',
          'bad_previous_scope', 'p9_profile_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_peer,
      ctx.profile_v1,
      repeat('d', 64)
    ),
    array['23503'],
    'p9_profile_versions_previous_scope_fk'
  );

  perform pg_temp._p9_profile_expect_fail(
    22,
    'branching from the same previous version fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_versions (
          organization_id, store_id, commercial_opportunity_id, version_number,
          previous_profile_version_id, profile_state, operation_key,
          request_fingerprint, actor_type, source_type, reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 3, %L::uuid, 'resolved',
          'branch_from_v1', %L, 'system', 'manual_check',
          'branch_from_v1', 'p9_profile_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_v1,
      repeat('e', 64)
    ),
    array['23505'],
    'p9_profile_versions_previous_once_uidx'
  );

  perform pg_temp._p9_profile_expect_fail(
    23,
    'invalid profile_state fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_versions (
          organization_id, store_id, commercial_opportunity_id, version_number,
          profile_state, operation_key, request_fingerprint, actor_type,
          source_type, reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 3, 'ready',
          'bad_profile_state', %L, 'system', 'manual_check',
          'bad_profile_state', 'p9_profile_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      repeat('f', 64)
    ),
    array['23514'],
    'p9_profile_versions_profile_state_chk'
  );

  perform pg_temp._p9_profile_expect_fail(
    24,
    'invalid request_fingerprint fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_versions (
          organization_id, store_id, commercial_opportunity_id, version_number,
          profile_state, operation_key, request_fingerprint, actor_type,
          source_type, reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 3, 'resolved',
          'bad_fingerprint', 'ABC', 'system', 'manual_check',
          'bad_fingerprint', 'p9_profile_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a
    ),
    array['23514'],
    'p9_profile_versions_request_fingerprint_chk'
  );

  perform pg_temp._p9_profile_expect_fail(
    25,
    'actor_type human without actor_user_id fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_versions (
          organization_id, store_id, commercial_opportunity_id, version_number,
          profile_state, operation_key, request_fingerprint, actor_type,
          source_type, reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 3, 'resolved',
          'bad_human_actor', %L, 'human', 'manual_check',
          'bad_human_actor', 'p9_profile_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      repeat('1', 64)
    ),
    array['23514'],
    'p9_profile_versions_actor_user_chk'
  );

  perform pg_temp._p9_profile_expect_fail(
    26,
    'actor_type system with actor_user_id fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_versions (
          organization_id, store_id, commercial_opportunity_id, version_number,
          profile_state, operation_key, request_fingerprint, actor_type,
          actor_user_id, source_type, reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 3, 'resolved',
          'bad_system_actor', %L, 'system', %L::uuid, 'manual_check',
          'bad_system_actor', 'p9_profile_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      repeat('2', 64),
      ctx.user_a
    ),
    array['23514'],
    'p9_profile_versions_actor_user_chk'
  );

  perform pg_temp._p9_profile_expect_fail(
    27,
    'invalid component_kind fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_components (
          organization_id, store_id, commercial_opportunity_id,
          profile_version_id, component_key, component_kind,
          component_state, reference_text
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'bad_kind',
          'bundle', 'resolved', 'Bundle'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_v2
    ),
    array['23514']
  );

  perform pg_temp._p9_profile_expect_fail(
    28,
    'invalid component_state fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_components (
          organization_id, store_id, commercial_opportunity_id,
          profile_version_id, component_key, component_kind,
          component_state, reference_text
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'bad_state',
          'service', 'unknown', 'Service'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_v2
    ),
    array['23514']
  );

  perform pg_temp._p9_profile_expect_fail(
    29,
    'pool cross-organization fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_components (
          organization_id, store_id, commercial_opportunity_id,
          profile_version_id, component_key, component_kind,
          component_state, pool_id
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'pool_wrong_org',
          'pool', 'resolved', %L::uuid
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_v2,
      ctx.pool_other_org
    ),
    array['23503'],
    'p9_profile_components_pool_scope_fk'
  );

  perform pg_temp._p9_profile_expect_fail(
    30,
    'catalog item cross-organization fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_components (
          organization_id, store_id, commercial_opportunity_id,
          profile_version_id, component_key, component_kind,
          component_state, catalog_item_id
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'catalog_wrong_org',
          'catalog_item', 'resolved', %L::uuid
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_v2,
      ctx.catalog_other_org
    ),
    array['23503'],
    'p9_profile_components_catalog_scope_fk'
  );

  perform pg_temp._p9_profile_expect_fail(
    31,
    'pool cross-store in same organization fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_components (
          organization_id, store_id, commercial_opportunity_id,
          profile_version_id, component_key, component_kind,
          component_state, pool_id
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'pool_wrong_store',
          'pool', 'resolved', %L::uuid
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_v2,
      ctx.pool_same_org_other_store
    ),
    array['23503'],
    'p9_profile_components_pool_scope_fk'
  );

  perform pg_temp._p9_profile_expect_fail(
    32,
    'catalog item cross-store in same organization fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_components (
          organization_id, store_id, commercial_opportunity_id,
          profile_version_id, component_key, component_kind,
          component_state, catalog_item_id
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'catalog_wrong_store',
          'catalog_item', 'resolved', %L::uuid
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_v2,
      ctx.catalog_same_org_other_store
    ),
    array['23503'],
    'p9_profile_components_catalog_scope_fk'
  );

  perform pg_temp._p9_profile_expect_fail(
    33,
    'pool/catalog IDs incompatible with component_kind fail',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_components (
          organization_id, store_id, commercial_opportunity_id,
          profile_version_id, component_key, component_kind,
          component_state, pool_id
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'wrong_kind_for_pool',
          'catalog_item', 'resolved', %L::uuid
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_v2,
      ctx.pool_a
    ),
    array['23514']
  );

  perform pg_temp._p9_profile_expect_fail(
    34,
    'resolved pool without pool_id fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_components (
          organization_id, store_id, commercial_opportunity_id,
          profile_version_id, component_key, component_kind,
          component_state, reference_text
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'pool_without_id',
          'pool', 'resolved', 'Pool mentioned'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_v2
    ),
    array['23514'],
    'p9_profile_components_resolution_shape_chk'
  );

  perform pg_temp._p9_profile_expect_fail(
    35,
    'resolved catalog item without catalog_item_id fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_components (
          organization_id, store_id, commercial_opportunity_id,
          profile_version_id, component_key, component_kind,
          component_state, reference_text
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'catalog_without_id',
          'catalog_item', 'resolved', 'Catalog mentioned'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_v2
    ),
    array['23514'],
    'p9_profile_components_resolution_shape_chk'
  );

  perform pg_temp._p9_profile_expect_fail(
    36,
    'resolved service/custom without reference_text fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_components (
          organization_id, store_id, commercial_opportunity_id,
          profile_version_id, component_key, component_kind, component_state
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'service_without_reference',
          'service', 'resolved'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_v2
    ),
    array['23514'],
    'p9_profile_components_resolution_shape_chk'
  );

  perform pg_temp._p9_profile_expect_fail(
    37,
    'conflict component without reference_text fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_components (
          organization_id, store_id, commercial_opportunity_id,
          profile_version_id, component_key, component_kind, component_state
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'conflict_without_reference',
          'custom', 'conflict'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_v2
    ),
    array['23514'],
    'p9_profile_components_resolution_shape_chk'
  );

  perform pg_temp._p9_profile_expect_fail(
    38,
    'invalid execution_kind fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_execution_intents (
          organization_id, store_id, commercial_opportunity_id,
          profile_version_id, execution_kind, intent_state
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'maintenance', 'included'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_v2
    ),
    array['23514'],
    'p9_profile_execution_intents_kind_chk'
  );

  perform pg_temp._p9_profile_expect_fail(
    39,
    'invalid intent_state fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_execution_intents (
          organization_id, store_id, commercial_opportunity_id,
          profile_version_id, execution_kind, intent_state
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'delivery', 'maybe'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_v2
    ),
    array['23514'],
    'p9_profile_execution_intents_state_chk'
  );

  perform pg_temp._p9_profile_expect_fail(
    40,
    'duplicate execution_kind by version fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_execution_intents (
          organization_id, store_id, commercial_opportunity_id,
          profile_version_id, execution_kind, intent_state
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'installation', 'excluded'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_v2
    ),
    array['23505'],
    'p9_profile_execution_intents_version_kind_uidx'
  );

  perform pg_temp._p9_profile_expect_fail(
    41,
    'current pointing to another opportunity version fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_current (
          organization_id, store_id, commercial_opportunity_id,
          current_profile_version_id, last_operation_key
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'p9_profile_fixture:v2'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_peer,
      ctx.profile_v2
    ),
    array['23514'],
    null,
    'points to a version outside its scope'
  );

  perform pg_temp._p9_profile_expect_fail(
    42,
    'current last_operation_key mismatch fails',
    format(
      $sql$
        update public.commercial_opportunity_profile_current
        set last_operation_key = 'wrong_key'
        where organization_id = %L::uuid
          and store_id = %L::uuid
          and commercial_opportunity_id = %L::uuid
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a
    ),
    array['23514'],
    null,
    'operation_key does not match current version'
  );

  perform pg_temp._p9_profile_expect_fail(
    43,
    'UPDATE in versions is blocked',
    format(
      $sql$
        update public.commercial_opportunity_profile_versions
        set profile_state = 'conflict'
        where id = %L::uuid
      $sql$,
      ctx.profile_v1
    ),
    array['P0001'],
    null,
    'is append-only'
  );

  perform pg_temp._p9_profile_expect_fail(
    44,
    'DELETE in versions is blocked',
    format(
      $sql$
        delete from public.commercial_opportunity_profile_versions
        where id = %L::uuid
      $sql$,
      ctx.profile_v1
    ),
    array['P0001'],
    null,
    'is append-only'
  );

  perform pg_temp._p9_profile_expect_fail(
    45,
    'UPDATE in components is blocked',
    format(
      $sql$
        update public.commercial_opportunity_profile_components
        set reference_text = 'changed'
        where profile_version_id = %L::uuid
      $sql$,
      ctx.profile_v2
    ),
    array['P0001'],
    null,
    'is append-only'
  );

  perform pg_temp._p9_profile_expect_fail(
    46,
    'DELETE in components is blocked',
    format(
      $sql$
        delete from public.commercial_opportunity_profile_components
        where profile_version_id = %L::uuid
      $sql$,
      ctx.profile_v2
    ),
    array['P0001'],
    null,
    'is append-only'
  );

  perform pg_temp._p9_profile_expect_fail(
    47,
    'UPDATE in execution intents is blocked',
    format(
      $sql$
        update public.commercial_opportunity_profile_execution_intents
        set intent_state = 'excluded'
        where profile_version_id = %L::uuid
      $sql$,
      ctx.profile_v2
    ),
    array['P0001'],
    null,
    'is append-only'
  );

  perform pg_temp._p9_profile_expect_fail(
    48,
    'DELETE in execution intents is blocked',
    format(
      $sql$
        delete from public.commercial_opportunity_profile_execution_intents
        where profile_version_id = %L::uuid
      $sql$,
      ctx.profile_v2
    ),
    array['P0001'],
    null,
    'is append-only'
  );

  perform pg_temp._p9_profile_expect_fail(
    49,
    'current identity cannot be moved to another opportunity by UPDATE',
    format(
      $sql$
        update public.commercial_opportunity_profile_current
        set commercial_opportunity_id = %L::uuid
        where organization_id = %L::uuid
          and store_id = %L::uuid
          and commercial_opportunity_id = %L::uuid
      $sql$,
      ctx.opp_peer,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a
    ),
    array['P0001'],
    null,
    'current identity is immutable'
  );

  perform pg_temp._p9_profile_expect(
    50,
    'pools/catalog rows are not repaired or mutated by the foundation checks',
    (select count(*) from public.pools) = ctx.baseline_pools_count + 3
    and (select count(*) from public.store_catalog_items) = ctx.baseline_catalog_count + 3
  );

  perform pg_temp._p9_profile_expect_fail(
    51,
    'profile version cannot point previous_profile_version_id to itself',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_versions (
          id, organization_id, store_id, commercial_opportunity_id,
          version_number, previous_profile_version_id, profile_state,
          operation_key, request_fingerprint, actor_type, source_type,
          reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid,
          3, %L::uuid, 'resolved',
          'self_previous', %L, 'system', 'manual_check',
          'self_previous', 'p9_profile_manual_check'
        )
      $sql$,
      ctx.opp_peer,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.opp_peer,
      repeat('3', 64)
    ),
    array['23514'],
    'p9_profile_versions_previous_not_self_chk'
  );

  perform pg_temp._p9_profile_expect_fail(
    52,
    'duplicate component_key in the same profile version fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_components (
          organization_id, store_id, commercial_opportunity_id,
          profile_version_id, component_key, component_kind,
          component_state, pool_id
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid,
          'primary_pool', 'pool', 'resolved', %L::uuid
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_v2,
      ctx.pool_a
    ),
    array['23505'],
    'p9_profile_components_version_component_key_uidx'
  );

  perform pg_temp._p9_profile_expect_fail(
    53,
    'partial pool without pool_id or reference_text fails',
    format(
      $sql$
        insert into public.commercial_opportunity_profile_components (
          organization_id, store_id, commercial_opportunity_id,
          profile_version_id, component_key, component_kind, component_state
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid,
          'partial_pool_without_evidence', 'pool', 'partial'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_v2
    ),
    array['23514'],
    'p9_profile_components_resolution_shape_chk'
  );
end;
$behavior_checks$;

-- --------------------------------------------------------------------------
-- RLS behavior.
-- --------------------------------------------------------------------------
do $rls_checks$
declare
  ctx pg_temp._p9_profile_ctx%rowtype;
  v_seen_count integer;
begin
  select * into ctx from pg_temp._p9_profile_ctx;

  perform set_config('request.jwt.claim.sub', ctx.user_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', ctx.user_a::text, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';

  select count(*)
  into v_seen_count
  from public.commercial_opportunity_profile_versions
  where organization_id = ctx.org_a;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp._p9_profile_expect(
    60,
    'authenticated active member can SELECT own profile rows through RLS',
    v_seen_count = 2,
    'rows_seen=' || coalesce(v_seen_count::text, '<null>')
  );

  perform set_config('request.jwt.claim.sub', ctx.user_b::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', ctx.user_b::text, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';

  select count(*)
  into v_seen_count
  from public.commercial_opportunity_profile_versions
  where organization_id = ctx.org_a;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp._p9_profile_expect(
    61,
    'authenticated active member from another organization cannot SELECT org A profile rows',
    v_seen_count = 0,
    'rows_seen=' || coalesce(v_seen_count::text, '<null>')
  );

  perform set_config('request.jwt.claim.sub', ctx.user_inactive_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', ctx.user_inactive_a::text, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';

  select count(*)
  into v_seen_count
  from public.commercial_opportunity_profile_versions
  where organization_id = ctx.org_a;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp._p9_profile_expect(
    62,
    'authenticated inactive member cannot SELECT profile rows through RLS',
    v_seen_count = 0,
    'rows_seen=' || coalesce(v_seen_count::text, '<null>')
  );
exception
  when others then
    begin
      execute 'reset role';
    exception when others then null;
    end;

    perform pg_temp._p9_profile_record(
      60,
      'RLS checks',
      'HARNESS_ERROR',
      sqlstate || ': ' || sqlerrm
    );
end;
$rls_checks$;

-- --------------------------------------------------------------------------
-- Summary.
-- --------------------------------------------------------------------------
do $summary$
declare
  v_failed_count integer;
  v_missing_scenarios text;
  v_summary jsonb;
begin
  select pg_catalog.string_agg(expected.scenario_number::text, ',' order by expected.scenario_number)
  into v_missing_scenarios
  from (
    select pg_catalog.generate_series(1, 14) as scenario_number
    union all
    select pg_catalog.generate_series(20, 53)
    union all
    select pg_catalog.generate_series(60, 62)
  ) expected
  where not exists (
    select 1
    from pg_temp._p9_profile_results result_row
    where result_row.scenario_number = expected.scenario_number
  );

  if v_missing_scenarios is not null then
    raise exception using
      errcode = 'P0001',
      message = 'P9 profile foundation manual checks harness is incomplete',
      detail = 'missing scenarios: ' || v_missing_scenarios;
  end if;

  select count(*)
  into v_failed_count
  from pg_temp._p9_profile_results
  where status <> 'PASS';

  select jsonb_agg(
    jsonb_build_object(
      'scenario_number', scenario_number,
      'scenario_name', scenario_name,
      'status', status,
      'detail', detail
    )
    order by scenario_number
  )
  into v_summary
  from pg_temp._p9_profile_results;

  if v_failed_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'P9 profile foundation manual checks failed',
      detail = v_summary::text;
  end if;

  raise notice 'P9 profile foundation manual checks passed: %', v_summary::text;
end;
$summary$;

rollback;
