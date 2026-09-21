begin;

set transaction isolation level repeatable read;
set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_quote_lineage_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_quote_lineage_ctx (
  singleton boolean primary key default true check (singleton),
  org_a uuid not null,
  org_b uuid not null,
  store_a uuid not null,
  store_b uuid not null,
  customer_a uuid not null,
  customer_b uuid not null,
  opp_pool uuid not null,
  opp_catalog uuid not null,
  opp_no_current uuid not null,
  opp_needs uuid not null,
  opp_conflict uuid not null,
  opp_partial uuid not null,
  opp_service uuid not null,
  opp_custom uuid not null,
  opp_empty uuid not null,
  opp_pool_no_price uuid not null,
  opp_catalog_no_price uuid not null,
  opp_current_change uuid not null,
  opp_corrupt uuid not null,
  opp_other_scope uuid not null,
  quote_legacy uuid not null,
  quote_no_opp uuid not null,
  quote_pool uuid not null,
  quote_catalog uuid not null,
  quote_no_current uuid not null,
  quote_needs uuid not null,
  quote_conflict uuid not null,
  quote_partial uuid not null,
  quote_service uuid not null,
  quote_custom uuid not null,
  quote_empty uuid not null,
  quote_pool_no_price uuid not null,
  quote_catalog_no_price uuid not null,
  quote_current_change uuid not null,
  quote_corrupt uuid not null,
  quote_other_scope uuid not null,
  pool_a uuid not null,
  pool_b uuid not null,
  pool_no_price uuid not null,
  catalog_a uuid not null,
  catalog_b uuid not null,
  catalog_no_price uuid not null
) on commit preserve rows;

create or replace function pg_temp._p9_quote_lineage_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text default null
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_quote_lineage_results(
    scenario_number,
    scenario_name,
    status,
    detail
  ) values (
    p_scenario_number,
    p_scenario_name,
    p_status,
    coalesce(p_detail, '<null>')
  )
  on conflict (scenario_number) do update
  set scenario_name = excluded.scenario_name,
      status = excluded.status,
      detail = excluded.detail;
end;
$function$;

create or replace function pg_temp._p9_quote_lineage_exec(
  p_sql text
)
returns table (
  operation_succeeded boolean,
  value_json jsonb,
  returned_sqlstate text,
  message_text text,
  constraint_name text
)
language plpgsql
as $function$
declare
  v_value jsonb;
  v_state text;
  v_message text;
  v_constraint text;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    return query select false, null::jsonb, null::text,
      'runner helper must start as postgres'::text, null::text;
    return;
  end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('role', 'service_role')::text,
    true
  );
  execute 'set local role service_role';

  begin
    execute pg_catalog.format('select to_jsonb(result_row) from (%s) result_row', p_sql)
      into v_value;

    execute 'reset role';
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);

    return query select true, v_value, null::text, null::text, null::text;
  exception when others then
    get stacked diagnostics
      v_state = returned_sqlstate,
      v_message = message_text,
      v_constraint = constraint_name;

    execute 'reset role';
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);

    return query select false, null::jsonb, v_state, v_message, v_constraint;
  end;
end;
$function$;

create or replace function pg_temp._p9_quote_lineage_exec_statement(
  p_sql text
)
returns table (
  operation_succeeded boolean,
  returned_sqlstate text,
  message_text text,
  constraint_name text
)
language plpgsql
as $function$
declare
  v_state text;
  v_message text;
  v_constraint text;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    return query select false, null::text,
      'runner statement helper must start as postgres'::text, null::text;
    return;
  end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('role', 'service_role')::text,
    true
  );
  execute 'set local role service_role';

  begin
    execute p_sql;

    execute 'reset role';
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);

    return query select true, null::text, null::text, null::text;
  exception when others then
    get stacked diagnostics
      v_state = returned_sqlstate,
      v_message = message_text,
      v_constraint = constraint_name;

    execute 'reset role';
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);

    return query select false, v_state, v_message, v_constraint;
  end;
end;
$function$;

create or replace function pg_temp._p9_quote_lineage_expect_fail(
  p_scenario_number integer,
  p_scenario_name text,
  p_sql text,
  p_expected_message text default null
)
returns void
language plpgsql
as $function$
declare
  v_result record;
begin
  select *
  into v_result
  from pg_temp._p9_quote_lineage_exec_statement(p_sql);

  if v_result.operation_succeeded then
    perform pg_temp._p9_quote_lineage_record(
      p_scenario_number,
      p_scenario_name,
      'SUT_FAIL',
      'operation succeeded but failure was expected'
    );
    return;
  end if;

  if p_expected_message is not null
     and coalesce(v_result.message_text, '') not ilike '%' || p_expected_message || '%'
     and coalesce(v_result.constraint_name, '') not ilike '%' || p_expected_message || '%' then
    perform pg_temp._p9_quote_lineage_record(
      p_scenario_number,
      p_scenario_name,
      'SUT_FAIL',
      'unexpected failure: ' || coalesce(v_result.message_text, '<null>') ||
      ' [constraint=' || coalesce(v_result.constraint_name, '<null>') || ']'
    );
    return;
  end if;

  perform pg_temp._p9_quote_lineage_record(
    p_scenario_number,
    p_scenario_name,
    'PASS',
    coalesce(v_result.constraint_name, v_result.message_text, 'failed as expected')
  );
end;
$function$;

create or replace function pg_temp._p9_quote_lineage_create_profile(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_profile_state text,
  p_operation_key text,
  p_components jsonb
)
returns uuid
language plpgsql
as $function$
declare
  v_previous uuid;
  v_version_number integer;
  v_profile_version_id uuid := gen_random_uuid();
begin
  select current_row.current_profile_version_id
  into v_previous
  from public.commercial_opportunity_profile_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id;

  select coalesce(max(version_row.version_number), 0) + 1
  into v_version_number
  from public.commercial_opportunity_profile_versions version_row
  where version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id
    and version_row.commercial_opportunity_id = p_commercial_opportunity_id;

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
    created_by,
    metadata
  ) values (
    v_profile_version_id,
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_version_number,
    v_previous,
    p_profile_state,
    p_operation_key,
    repeat('a', 64),
    'system',
    null,
    'manual_check_fixture',
    'manual_check_profile',
    'manual_check',
    '{}'::jsonb
  );

  insert into public.commercial_opportunity_profile_components (
    organization_id,
    store_id,
    commercial_opportunity_id,
    profile_version_id,
    component_key,
    component_kind,
    component_state,
    pool_id,
    catalog_item_id,
    reference_text,
    metadata
  )
  select
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_profile_version_id,
    component_row.component_key,
    component_row.component_kind,
    component_row.component_state,
    component_row.pool_id,
    component_row.catalog_item_id,
    component_row.reference_text,
    '{}'::jsonb
  from pg_catalog.jsonb_to_recordset(coalesce(p_components, '[]'::jsonb)) as component_row(
    component_key text,
    component_kind text,
    component_state text,
    pool_id uuid,
    catalog_item_id uuid,
    reference_text text
  );

  insert into public.commercial_opportunity_profile_current (
    organization_id,
    store_id,
    commercial_opportunity_id,
    current_profile_version_id,
    last_operation_key
  ) values (
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_profile_version_id,
    p_operation_key
  )
  on conflict (organization_id, store_id, commercial_opportunity_id) do update
  set current_profile_version_id = excluded.current_profile_version_id,
      last_operation_key = excluded.last_operation_key;

  return v_profile_version_id;
end;
$function$;

insert into pg_temp._p9_quote_lineage_ctx (
  org_a, org_b, store_a, store_b, customer_a, customer_b,
  opp_pool, opp_catalog, opp_no_current, opp_needs, opp_conflict,
  opp_partial, opp_service, opp_custom, opp_empty, opp_pool_no_price,
  opp_catalog_no_price, opp_current_change, opp_corrupt, opp_other_scope,
  quote_legacy, quote_no_opp, quote_pool, quote_catalog, quote_no_current,
  quote_needs, quote_conflict, quote_partial, quote_service, quote_custom,
  quote_empty, quote_pool_no_price, quote_catalog_no_price,
  quote_current_change, quote_corrupt, quote_other_scope,
  pool_a, pool_b, pool_no_price, catalog_a, catalog_b, catalog_no_price
)
values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid()
);

do $fixtures$
declare
  ctx pg_temp._p9_quote_lineage_ctx;
  v_pool_version uuid;
  v_catalog_version uuid;
  v_current_change_v1 uuid;
  v_corrupt_v1 uuid;
  v_corrupt_v2 uuid;
  v_component_pool uuid;
  v_component_catalog uuid;
begin
  select * into ctx from pg_temp._p9_quote_lineage_ctx where singleton;

  insert into public.organizations (id, name, subscription_status)
  values
    (ctx.org_a, 'P9 Quote Lineage Org A', 'active'),
    (ctx.org_b, 'P9 Quote Lineage Org B', 'active');

  insert into public.stores (id, organization_id, name)
  values
    (ctx.store_a, ctx.org_a, 'P9 Quote Lineage Store A'),
    (ctx.store_b, ctx.org_b, 'P9 Quote Lineage Store B');

  insert into public.customers (id, organization_id, display_name)
  values
    (ctx.customer_a, ctx.org_a, 'P9 Quote Lineage Customer A'),
    (ctx.customer_b, ctx.org_b, 'P9 Quote Lineage Customer B');

  insert into public.commercial_opportunities (id, organization_id, store_id, customer_id, stage)
  values
    (ctx.opp_pool, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'),
    (ctx.opp_catalog, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'),
    (ctx.opp_no_current, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'),
    (ctx.opp_needs, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'),
    (ctx.opp_conflict, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'),
    (ctx.opp_partial, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'),
    (ctx.opp_service, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'),
    (ctx.opp_custom, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'),
    (ctx.opp_empty, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'),
    (ctx.opp_pool_no_price, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'),
    (ctx.opp_catalog_no_price, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'),
    (ctx.opp_current_change, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'),
    (ctx.opp_corrupt, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'),
    (ctx.opp_other_scope, ctx.org_b, ctx.store_b, ctx.customer_b, 'orcamento');

  insert into public.pools (
    id, organization_id, store_id, name, width_m, length_m, depth_m,
    shape, material, max_capacity_l, weight_kg, price, price_status,
    description, is_active, track_stock, stock_quantity, stock_status
  ) values
    (
      ctx.pool_a, ctx.org_a, ctx.store_a, 'Lineage Pool A',
      2, 3, 1, 'retangular', 'vinil', 1000, 200, 1234.56, 'valid',
      'Lineage valid pool', true, false, null, 'not_tracked'
    ),
    (
      ctx.pool_b, ctx.org_b, ctx.store_b, 'Lineage Pool B',
      2, 3, 1, 'retangular', 'vinil', 1000, 200, 2222.22, 'valid',
      'Lineage other scope pool', true, false, null, 'not_tracked'
    ),
    (
      ctx.pool_no_price, ctx.org_a, ctx.store_a, 'Lineage Pool No Price',
      2, 3, 1, 'retangular', 'vinil', 1000, 200, null, 'missing',
      'Lineage no price pool', true, false, null, 'not_tracked'
    );

  insert into public.store_catalog_items (
    id, organization_id, store_id, sku, name, description, price_cents,
    price_status, currency, is_active, track_stock, stock_quantity,
    stock_status, metadata
  ) values
    (
      ctx.catalog_a, ctx.org_a, ctx.store_a, 'LIN-A',
      'Lineage Catalog A', 'Lineage valid catalog', 2500,
      'valid', 'BRL', true, false, null, 'not_tracked', '{}'::jsonb
    ),
    (
      ctx.catalog_b, ctx.org_b, ctx.store_b, 'LIN-B',
      'Lineage Catalog B', 'Lineage other scope catalog', 3500,
      'valid', 'BRL', true, false, null, 'not_tracked', '{}'::jsonb
    ),
    (
      ctx.catalog_no_price, ctx.org_a, ctx.store_a, 'LIN-NP',
      'Lineage Catalog No Price', 'Lineage no price catalog', null,
      'missing', 'BRL', true, false, null, 'not_tracked', '{}'::jsonb
    );

  insert into public.sales_quotes (
    id, organization_id, store_id, commercial_opportunity_id,
    conversation_id, lead_id, quote_number, title, status,
    customer_name, customer_phone, customer_notes, internal_notes,
    subtotal_cents, discount_cents, total_cents, current_version_id, metadata
  ) values
    (ctx.quote_legacy, ctx.org_a, ctx.store_a, null, null, null, 'QL-LEG', 'Legacy', 'draft', 'Legacy', null, null, null, 0, 0, 0, null, '{}'::jsonb),
    (ctx.quote_no_opp, ctx.org_a, ctx.store_a, null, null, null, 'QL-NOOPP', 'No Opp', 'draft', 'No Opp', null, null, null, 0, 0, 0, null, '{}'::jsonb),
    (ctx.quote_pool, ctx.org_a, ctx.store_a, ctx.opp_pool, null, null, 'QL-POOL', 'Pool', 'draft', 'Pool', null, null, null, 0, 0, 0, null, '{}'::jsonb),
    (ctx.quote_catalog, ctx.org_a, ctx.store_a, ctx.opp_catalog, null, null, 'QL-CAT', 'Catalog', 'draft', 'Catalog', null, null, null, 0, 0, 0, null, '{}'::jsonb),
    (ctx.quote_no_current, ctx.org_a, ctx.store_a, ctx.opp_no_current, null, null, 'QL-NOCUR', 'No Current', 'draft', 'No Current', null, null, null, 0, 0, 0, null, '{}'::jsonb),
    (ctx.quote_needs, ctx.org_a, ctx.store_a, ctx.opp_needs, null, null, 'QL-NEEDS', 'Needs', 'draft', 'Needs', null, null, null, 0, 0, 0, null, '{}'::jsonb),
    (ctx.quote_conflict, ctx.org_a, ctx.store_a, ctx.opp_conflict, null, null, 'QL-CONF', 'Conflict', 'draft', 'Conflict', null, null, null, 0, 0, 0, null, '{}'::jsonb),
    (ctx.quote_partial, ctx.org_a, ctx.store_a, ctx.opp_partial, null, null, 'QL-PART', 'Partial', 'draft', 'Partial', null, null, null, 0, 0, 0, null, '{}'::jsonb),
    (ctx.quote_service, ctx.org_a, ctx.store_a, ctx.opp_service, null, null, 'QL-SVC', 'Service', 'draft', 'Service', null, null, null, 0, 0, 0, null, '{}'::jsonb),
    (ctx.quote_custom, ctx.org_a, ctx.store_a, ctx.opp_custom, null, null, 'QL-CUS', 'Custom', 'draft', 'Custom', null, null, null, 0, 0, 0, null, '{}'::jsonb),
    (ctx.quote_empty, ctx.org_a, ctx.store_a, ctx.opp_empty, null, null, 'QL-EMP', 'Empty', 'draft', 'Empty', null, null, null, 0, 0, 0, null, '{}'::jsonb),
    (ctx.quote_pool_no_price, ctx.org_a, ctx.store_a, ctx.opp_pool_no_price, null, null, 'QL-PNP', 'Pool No Price', 'draft', 'Pool No Price', null, null, null, 0, 0, 0, null, '{}'::jsonb),
    (ctx.quote_catalog_no_price, ctx.org_a, ctx.store_a, ctx.opp_catalog_no_price, null, null, 'QL-CNP', 'Catalog No Price', 'draft', 'Catalog No Price', null, null, null, 0, 0, 0, null, '{}'::jsonb),
    (ctx.quote_current_change, ctx.org_a, ctx.store_a, ctx.opp_current_change, null, null, 'QL-CHG', 'Current Change', 'draft', 'Current Change', null, null, null, 0, 0, 0, null, '{}'::jsonb),
    (ctx.quote_corrupt, ctx.org_a, ctx.store_a, ctx.opp_corrupt, null, null, 'QL-CORR', 'Corrupt', 'draft', 'Corrupt', null, null, null, 0, 0, 0, null, '{}'::jsonb),
    (ctx.quote_other_scope, ctx.org_b, ctx.store_b, ctx.opp_other_scope, null, null, 'QL-OTH', 'Other', 'draft', 'Other', null, null, null, 0, 0, 0, null, '{}'::jsonb);

  v_pool_version := pg_temp._p9_quote_lineage_create_profile(
    ctx.org_a, ctx.store_a, ctx.opp_pool, 'resolved', 'lineage-pool-v1',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'component_key', 'pool_primary',
      'component_kind', 'pool',
      'component_state', 'resolved',
      'pool_id', ctx.pool_a,
      'catalog_item_id', null,
      'reference_text', null
    ))
  );

  v_catalog_version := pg_temp._p9_quote_lineage_create_profile(
    ctx.org_a, ctx.store_a, ctx.opp_catalog, 'resolved', 'lineage-catalog-v1',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'component_key', 'catalog_primary',
      'component_kind', 'catalog_item',
      'component_state', 'resolved',
      'pool_id', null,
      'catalog_item_id', ctx.catalog_a,
      'reference_text', null
    ))
  );

  perform pg_temp._p9_quote_lineage_create_profile(ctx.org_a, ctx.store_a, ctx.opp_needs, 'needs_clarification', 'lineage-needs-v1', '[]'::jsonb);
  perform pg_temp._p9_quote_lineage_create_profile(ctx.org_a, ctx.store_a, ctx.opp_conflict, 'conflict', 'lineage-conflict-v1', '[]'::jsonb);
  perform pg_temp._p9_quote_lineage_create_profile(ctx.org_a, ctx.store_a, ctx.opp_empty, 'resolved', 'lineage-empty-v1', '[]'::jsonb);

  perform pg_temp._p9_quote_lineage_create_profile(
    ctx.org_a, ctx.store_a, ctx.opp_partial, 'resolved', 'lineage-partial-v1',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'component_key', 'pool_partial',
      'component_kind', 'pool',
      'component_state', 'partial',
      'pool_id', ctx.pool_a,
      'catalog_item_id', null,
      'reference_text', null
    ))
  );

  perform pg_temp._p9_quote_lineage_create_profile(
    ctx.org_a, ctx.store_a, ctx.opp_service, 'resolved', 'lineage-service-v1',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'component_key', 'service_install',
      'component_kind', 'service',
      'component_state', 'resolved',
      'pool_id', null,
      'catalog_item_id', null,
      'reference_text', 'Instalacao'
    ))
  );

  perform pg_temp._p9_quote_lineage_create_profile(
    ctx.org_a, ctx.store_a, ctx.opp_custom, 'resolved', 'lineage-custom-v1',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'component_key', 'custom_note',
      'component_kind', 'custom',
      'component_state', 'resolved',
      'pool_id', null,
      'catalog_item_id', null,
      'reference_text', 'Item especial'
    ))
  );

  perform pg_temp._p9_quote_lineage_create_profile(
    ctx.org_a, ctx.store_a, ctx.opp_pool_no_price, 'resolved', 'lineage-pool-no-price-v1',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'component_key', 'pool_no_price',
      'component_kind', 'pool',
      'component_state', 'resolved',
      'pool_id', ctx.pool_no_price,
      'catalog_item_id', null,
      'reference_text', null
    ))
  );

  perform pg_temp._p9_quote_lineage_create_profile(
    ctx.org_a, ctx.store_a, ctx.opp_catalog_no_price, 'resolved', 'lineage-catalog-no-price-v1',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'component_key', 'catalog_no_price',
      'component_kind', 'catalog_item',
      'component_state', 'resolved',
      'pool_id', null,
      'catalog_item_id', ctx.catalog_no_price,
      'reference_text', null
    ))
  );

  v_current_change_v1 := pg_temp._p9_quote_lineage_create_profile(
    ctx.org_a, ctx.store_a, ctx.opp_current_change, 'resolved', 'lineage-current-change-v1',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'component_key', 'catalog_original',
      'component_kind', 'catalog_item',
      'component_state', 'resolved',
      'pool_id', null,
      'catalog_item_id', ctx.catalog_a,
      'reference_text', null
    ))
  );

  v_corrupt_v1 := pg_temp._p9_quote_lineage_create_profile(
    ctx.org_a, ctx.store_a, ctx.opp_corrupt, 'resolved', 'lineage-corrupt-v1',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'component_key', 'catalog_corrupt_a',
      'component_kind', 'catalog_item',
      'component_state', 'resolved',
      'pool_id', null,
      'catalog_item_id', ctx.catalog_a,
      'reference_text', null
    ))
  );

  v_corrupt_v2 := pg_temp._p9_quote_lineage_create_profile(
    ctx.org_a, ctx.store_a, ctx.opp_corrupt, 'resolved', 'lineage-corrupt-v2',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'component_key', 'catalog_corrupt_b',
      'component_kind', 'catalog_item',
      'component_state', 'resolved',
      'pool_id', null,
      'catalog_item_id', ctx.catalog_a,
      'reference_text', null
    ))
  );

  select component_row.id into v_component_pool
  from public.commercial_opportunity_profile_components component_row
  where component_row.profile_version_id = v_pool_version;

  select component_row.id into v_component_catalog
  from public.commercial_opportunity_profile_components component_row
  where component_row.profile_version_id = v_catalog_version;

  -- Corrupt fixture: two canonical items from different profile versions.
  insert into public.sales_quote_items (
    quote_id, organization_id, store_id, commercial_opportunity_id,
    profile_component_id, item_type, pool_id, catalog_item_id, name, sku,
    description, quantity, unit_price_cents, discount_cents, subtotal_cents,
    total_cents, sort_order, metadata
  )
  select
    ctx.quote_corrupt, ctx.org_a, ctx.store_a, ctx.opp_corrupt,
    component_row.id, component_row.component_kind, null, component_row.catalog_item_id,
    'Corrupt ' || component_row.component_key, 'CORR', null,
    1, 2500, 0, 2500, 2500,
    row_number() over (order by component_row.profile_version_id)::integer,
    '{}'::jsonb
  from public.commercial_opportunity_profile_components component_row
  where component_row.profile_version_id in (v_corrupt_v1, v_corrupt_v2);
end;
$fixtures$;

-- 1. Legacy remains valid.
do $scenario$
declare
  ctx pg_temp._p9_quote_lineage_ctx;
begin
  select * into ctx from pg_temp._p9_quote_lineage_ctx where singleton;

  insert into public.sales_quote_items (
    quote_id, organization_id, store_id, item_type, name, description,
    quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents,
    sort_order, sku, metadata
  ) values (
    ctx.quote_legacy, ctx.org_a, ctx.store_a, 'custom', 'Legacy custom',
    null, 1, 1000, 0, 1000, 1000, 1, null, '{}'::jsonb
  );

  perform pg_temp._p9_quote_lineage_record(1, 'legacy item remains valid', 'PASS', 'legacy null lineage accepted');
exception when others then
  perform pg_temp._p9_quote_lineage_record(1, 'legacy item remains valid', 'SUT_FAIL', sqlerrm);
end;
$scenario$;

do $scenarios$
declare
  ctx pg_temp._p9_quote_lineage_ctx;
  v_result record;
  v_first_id uuid;
  v_second_id uuid;
  v_before_price integer;
  v_after_price integer;
  v_profile_version uuid;
  v_items integer;
  v_component_id uuid;
  v_bad_pool_source_quote uuid;
  v_bad_catalog_source_quote uuid;
  v_bad_kind_quote uuid;
  v_legacy_with_opp_quote uuid;
  v_atomic_opp uuid;
  v_atomic_quote uuid;
  v_multi_opp uuid;
  v_multi_quote uuid;
  v_zero_items integer;
  v_function_def text;
  v_function_config text[];
begin
  select * into ctx from pg_temp._p9_quote_lineage_ctx where singleton;

  perform pg_temp._p9_quote_lineage_expect_fail(
    2,
    'quote without opportunity fails closed',
    pg_catalog.format(
      'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
      ctx.org_a, ctx.store_a, ctx.quote_no_opp
    ),
    'QUOTE_OPPORTUNITY_REQUIRED'
  );

  perform pg_temp._p9_quote_lineage_expect_fail(
    3,
    'other-scope quote lookup fails closed',
    pg_catalog.format(
      'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
      ctx.org_a, ctx.store_a, ctx.quote_other_scope
    ),
    'QUOTE_NOT_FOUND'
  );

  perform pg_temp._p9_quote_lineage_expect_fail(
    4,
    'missing current profile fails closed',
    pg_catalog.format(
      'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
      ctx.org_a, ctx.store_a, ctx.quote_no_current
    ),
    'CURRENT_PROFILE_REQUIRED'
  );

  perform pg_temp._p9_quote_lineage_expect_fail(
    5,
    'needs_clarification profile fails closed',
    pg_catalog.format(
      'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
      ctx.org_a, ctx.store_a, ctx.quote_needs
    ),
    'PROFILE_NOT_RESOLVED'
  );

  perform pg_temp._p9_quote_lineage_expect_fail(
    6,
    'conflict profile fails closed',
    pg_catalog.format(
      'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
      ctx.org_a, ctx.store_a, ctx.quote_conflict
    ),
    'PROFILE_NOT_RESOLVED'
  );

  perform pg_temp._p9_quote_lineage_expect_fail(
    7,
    'non-resolved component cannot generate definitive item',
    pg_catalog.format(
      'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
      ctx.org_a, ctx.store_a, ctx.quote_partial
    ),
    'COMPONENT_NOT_RESOLVED'
  );

  select *
  into v_result
  from pg_temp._p9_quote_lineage_exec(pg_catalog.format(
    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
    ctx.org_a, ctx.store_a, ctx.quote_pool
  ));

  if v_result.operation_succeeded
     and v_result.value_json ->> 'outcome' = 'materialized'
     and (v_result.value_json ->> 'item_count')::integer = 1
     and exists (
       select 1
       from public.sales_quote_items item_row
       where item_row.quote_id = ctx.quote_pool
         and item_row.item_type = 'pool'
         and item_row.pool_id = ctx.pool_a
         and item_row.catalog_item_id is null
         and item_row.unit_price_cents = 123456
     ) then
    perform pg_temp._p9_quote_lineage_record(8, 'valid pool materializes correctly', 'PASS', v_result.value_json::text);
  else
    perform pg_temp._p9_quote_lineage_record(8, 'valid pool materializes correctly', 'SUT_FAIL', coalesce(v_result.message_text, v_result.value_json::text));
  end if;

  select *
  into v_result
  from pg_temp._p9_quote_lineage_exec(pg_catalog.format(
    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
    ctx.org_a, ctx.store_a, ctx.quote_catalog
  ));

  if v_result.operation_succeeded
     and v_result.value_json ->> 'outcome' = 'materialized'
     and (v_result.value_json ->> 'item_count')::integer = 1
     and exists (
       select 1
       from public.sales_quote_items item_row
       where item_row.quote_id = ctx.quote_catalog
         and item_row.item_type = 'catalog_item'
         and item_row.catalog_item_id = ctx.catalog_a
         and item_row.pool_id is null
         and item_row.sku = 'LIN-A'
         and item_row.unit_price_cents = 2500
     ) then
    perform pg_temp._p9_quote_lineage_record(9, 'valid catalog item materializes correctly', 'PASS', v_result.value_json::text);
  else
    perform pg_temp._p9_quote_lineage_record(9, 'valid catalog item materializes correctly', 'SUT_FAIL', coalesce(v_result.message_text, v_result.value_json::text));
  end if;

  select component_row.id into v_component_id
  from public.commercial_opportunity_profile_components component_row
  where component_row.organization_id = ctx.org_a
    and component_row.store_id = ctx.store_a
    and component_row.commercial_opportunity_id = ctx.opp_pool
    and component_row.component_kind = 'pool'
  limit 1;

  v_bad_pool_source_quote := gen_random_uuid();
  insert into public.sales_quotes (
    id, organization_id, store_id, commercial_opportunity_id,
    conversation_id, lead_id, quote_number, title, status,
    customer_name, customer_phone, customer_notes, internal_notes,
    subtotal_cents, discount_cents, total_cents, current_version_id, metadata
  ) values (
    v_bad_pool_source_quote, ctx.org_a, ctx.store_a, ctx.opp_pool,
    null, null, 'QL-BAD-POOL', 'Bad Pool Source', 'draft',
    'Bad Pool Source', null, null, null, 0, 0, 0, null, '{}'::jsonb
  );

  perform pg_temp._p9_quote_lineage_expect_fail(
    10,
    'pool item cannot point to a different pool/source',
    pg_catalog.format(
      $sql$
        with inserted as (
          insert into public.sales_quote_items (
            quote_id, organization_id, store_id, commercial_opportunity_id,
            profile_component_id, item_type, pool_id, catalog_item_id, name,
            quantity, unit_price_cents, discount_cents, subtotal_cents,
            total_cents, sort_order, metadata
          ) values (
            %L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::uuid,
            'pool', %L::uuid, null, 'Bad pool source',
            1, 1, 0, 1, 1, 99, '{}'::jsonb
          ) returning id
        )
        select id from inserted
      $sql$,
      v_bad_pool_source_quote, ctx.org_a, ctx.store_a, ctx.opp_pool, v_component_id,
      ctx.pool_b
    ),
    'p9_sales_quote_items_profile_component_pool_fk'
  );

  select component_row.id into v_component_id
  from public.commercial_opportunity_profile_components component_row
  where component_row.organization_id = ctx.org_a
    and component_row.store_id = ctx.store_a
    and component_row.commercial_opportunity_id = ctx.opp_catalog
    and component_row.component_kind = 'catalog_item'
  limit 1;

  v_bad_catalog_source_quote := gen_random_uuid();
  insert into public.sales_quotes (
    id, organization_id, store_id, commercial_opportunity_id,
    conversation_id, lead_id, quote_number, title, status,
    customer_name, customer_phone, customer_notes, internal_notes,
    subtotal_cents, discount_cents, total_cents, current_version_id, metadata
  ) values (
    v_bad_catalog_source_quote, ctx.org_a, ctx.store_a, ctx.opp_catalog,
    null, null, 'QL-BAD-CAT', 'Bad Catalog Source', 'draft',
    'Bad Catalog Source', null, null, null, 0, 0, 0, null, '{}'::jsonb
  );

  perform pg_temp._p9_quote_lineage_expect_fail(
    11,
    'catalog item cannot point to a different catalog/source',
    pg_catalog.format(
      $sql$
        with inserted as (
          insert into public.sales_quote_items (
            quote_id, organization_id, store_id, commercial_opportunity_id,
            profile_component_id, item_type, pool_id, catalog_item_id, name,
            quantity, unit_price_cents, discount_cents, subtotal_cents,
            total_cents, sort_order, metadata
          ) values (
            %L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::uuid,
            'catalog_item', null, %L::uuid, 'Bad catalog source',
            1, 1, 0, 1, 1, 99, '{}'::jsonb
          ) returning id
        )
        select id from inserted
      $sql$,
      v_bad_catalog_source_quote, ctx.org_a, ctx.store_a, ctx.opp_catalog, v_component_id,
      ctx.catalog_b
    ),
    'p9_sales_quote_items_profile_component_catalog_fk'
  );

  perform pg_temp._p9_quote_lineage_expect_fail(
    12,
    'pool without usable price fails closed',
    pg_catalog.format(
      'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
      ctx.org_a, ctx.store_a, ctx.quote_pool_no_price
    ),
    'POOL_SOURCE_NOT_USABLE'
  );

  perform pg_temp._p9_quote_lineage_expect_fail(
    13,
    'catalog without usable price fails closed',
    pg_catalog.format(
      'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
      ctx.org_a, ctx.store_a, ctx.quote_catalog_no_price
    ),
    'CATALOG_SOURCE_NOT_USABLE'
  );

  perform pg_temp._p9_quote_lineage_expect_fail(
    14,
    'service resolved fails closed in 6.1-A',
    pg_catalog.format(
      'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
      ctx.org_a, ctx.store_a, ctx.quote_service
    ),
    'CANONICAL_PRICE_AUTHORITY_NOT_AVAILABLE_FOR_COMPONENT_KIND'
  );

  perform pg_temp._p9_quote_lineage_expect_fail(
    15,
    'custom resolved fails closed in 6.1-A',
    pg_catalog.format(
      'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
      ctx.org_a, ctx.store_a, ctx.quote_custom
    ),
    'CANONICAL_PRICE_AUTHORITY_NOT_AVAILABLE_FOR_COMPONENT_KIND'
  );

  perform pg_temp._p9_quote_lineage_expect_fail(
    16,
    'no components fails closed',
    pg_catalog.format(
      'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
      ctx.org_a, ctx.store_a, ctx.quote_empty
    ),
    'NO_COMPONENTS'
  );

  v_bad_kind_quote := gen_random_uuid();
  insert into public.sales_quotes (
    id, organization_id, store_id, commercial_opportunity_id,
    conversation_id, lead_id, quote_number, title, status,
    customer_name, customer_phone, customer_notes, internal_notes,
    subtotal_cents, discount_cents, total_cents, current_version_id, metadata
  ) values (
    v_bad_kind_quote, ctx.org_a, ctx.store_a, ctx.opp_catalog,
    null, null, 'QL-BAD-KIND', 'Bad Kind', 'draft',
    'Bad Kind', null, null, null, 0, 0, 0, null, '{}'::jsonb
  );

  perform pg_temp._p9_quote_lineage_expect_fail(
    17,
    'item_type must accompany component_kind',
    pg_catalog.format(
      $sql$
        with inserted as (
          insert into public.sales_quote_items (
            quote_id, organization_id, store_id, commercial_opportunity_id,
            profile_component_id, item_type, pool_id, catalog_item_id, name,
            quantity, unit_price_cents, discount_cents, subtotal_cents,
            total_cents, sort_order, metadata
          ) values (
            %L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::uuid,
            'custom', null, null, 'Bad kind',
            1, 1, 0, 1, 1, 98, '{}'::jsonb
          ) returning id
        )
        select id from inserted
      $sql$,
      v_bad_kind_quote, ctx.org_a, ctx.store_a, ctx.opp_catalog, v_component_id
    ),
    'p9_sales_quote_items_profile_component_kind_fk'
  );

  if exists (
    select 1
    from public.sales_quote_items item_row
    join public.commercial_opportunity_profile_components component_row
      on component_row.id = item_row.profile_component_id
    where item_row.quote_id = ctx.quote_pool
      and item_row.pool_id = component_row.pool_id
  ) then
    perform pg_temp._p9_quote_lineage_record(18, 'pool_id snapshot equals profile component pool_id', 'PASS', 'exact pool lineage confirmed');
  else
    perform pg_temp._p9_quote_lineage_record(18, 'pool_id snapshot equals profile component pool_id', 'SUT_FAIL', 'pool_id mismatch');
  end if;

  if exists (
    select 1
    from public.sales_quote_items item_row
    join public.commercial_opportunity_profile_components component_row
      on component_row.id = item_row.profile_component_id
    where item_row.quote_id = ctx.quote_catalog
      and item_row.catalog_item_id = component_row.catalog_item_id
  ) then
    perform pg_temp._p9_quote_lineage_record(19, 'catalog_item_id snapshot equals profile component catalog_item_id', 'PASS', 'exact catalog lineage confirmed');
  else
    perform pg_temp._p9_quote_lineage_record(19, 'catalog_item_id snapshot equals profile component catalog_item_id', 'SUT_FAIL', 'catalog_item_id mismatch');
  end if;

  if exists (
    select 1
    from public.sales_quote_items item_row
    join public.sales_quotes quote_row
      on quote_row.id = item_row.quote_id
    join public.commercial_opportunity_profile_components component_row
      on component_row.id = item_row.profile_component_id
    where item_row.quote_id in (ctx.quote_pool, ctx.quote_catalog)
      and item_row.commercial_opportunity_id = quote_row.commercial_opportunity_id
      and item_row.commercial_opportunity_id = component_row.commercial_opportunity_id
  ) then
    perform pg_temp._p9_quote_lineage_record(20, 'opportunity matches quote and component', 'PASS', 'opportunity lineage confirmed');
  else
    perform pg_temp._p9_quote_lineage_record(20, 'opportunity matches quote and component', 'SUT_FAIL', 'opportunity mismatch');
  end if;

  select id, unit_price_cents
  into v_first_id, v_before_price
  from public.sales_quote_items
  where quote_id = ctx.quote_catalog
    and profile_component_id is not null;

  select *
  into v_result
  from pg_temp._p9_quote_lineage_exec(pg_catalog.format(
    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
    ctx.org_a, ctx.store_a, ctx.quote_catalog
  ));

  select id, unit_price_cents
  into v_second_id, v_after_price
  from public.sales_quote_items
  where quote_id = ctx.quote_catalog
    and profile_component_id is not null;

  if v_result.operation_succeeded
     and v_result.value_json ->> 'outcome' = 'replay'
     and v_first_id = v_second_id
     and v_before_price = v_after_price
     and (
       select count(*)
       from public.sales_quote_items
       where quote_id = ctx.quote_catalog
         and profile_component_id is not null
     ) = 1 then
    perform pg_temp._p9_quote_lineage_record(21, 'replay returns same item without duplication', 'PASS', v_result.value_json::text);
  else
    perform pg_temp._p9_quote_lineage_record(21, 'replay returns same item without duplication', 'SUT_FAIL', coalesce(v_result.message_text, v_result.value_json::text));
  end if;

  update public.store_catalog_items
  set price_cents = 9999
  where id = ctx.catalog_a
    and organization_id = ctx.org_a
    and store_id = ctx.store_a;

  select *
  into v_result
  from pg_temp._p9_quote_lineage_exec(pg_catalog.format(
    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
    ctx.org_a, ctx.store_a, ctx.quote_catalog
  ));

  select unit_price_cents
  into v_after_price
  from public.sales_quote_items
  where quote_id = ctx.quote_catalog
    and profile_component_id is not null;

  if v_result.operation_succeeded
     and v_result.value_json ->> 'outcome' = 'replay'
     and v_after_price = v_before_price then
    perform pg_temp._p9_quote_lineage_record(22, 'catalog price change does not alter replay snapshot', 'PASS', 'snapshot preserved at ' || v_after_price::text);
  else
    perform pg_temp._p9_quote_lineage_record(22, 'catalog price change does not alter replay snapshot', 'SUT_FAIL', coalesce(v_result.message_text, v_result.value_json::text));
  end if;

  select *
  into v_result
  from pg_temp._p9_quote_lineage_exec(pg_catalog.format(
    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
    ctx.org_a, ctx.store_a, ctx.quote_current_change
  ));

  select profile_version_id
  into v_profile_version
  from public.commercial_opportunity_profile_components
  where id = (
    select profile_component_id
    from public.sales_quote_items
    where quote_id = ctx.quote_current_change
    limit 1
  );

  perform pg_temp._p9_quote_lineage_create_profile(
    ctx.org_a,
    ctx.store_a,
    ctx.opp_current_change,
    'resolved',
    'lineage-current-change-v2',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'component_key', 'catalog_new_current',
      'component_kind', 'catalog_item',
      'component_state', 'resolved',
      'pool_id', null,
      'catalog_item_id', ctx.catalog_no_price,
      'reference_text', null
    ))
  );

  select *
  into v_result
  from pg_temp._p9_quote_lineage_exec(pg_catalog.format(
    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
    ctx.org_a, ctx.store_a, ctx.quote_current_change
  ));

  if v_result.operation_succeeded
     and v_result.value_json ->> 'outcome' = 'replay'
     and (v_result.value_json ->> 'profile_version_id')::uuid = v_profile_version
     and (
       select count(distinct component_row.profile_version_id)
       from public.sales_quote_items item_row
       join public.commercial_opportunity_profile_components component_row
         on component_row.id = item_row.profile_component_id
       where item_row.quote_id = ctx.quote_current_change
     ) = 1 then
    perform pg_temp._p9_quote_lineage_record(23, 'changed current profile does not mix versions on replay', 'PASS', v_result.value_json::text);
  else
    perform pg_temp._p9_quote_lineage_record(23, 'changed current profile does not mix versions on replay', 'SUT_FAIL', coalesce(v_result.message_text, v_result.value_json::text));
  end if;

  perform pg_temp._p9_quote_lineage_expect_fail(
    24,
    'existing items linked to multiple profile versions fail closed',
    pg_catalog.format(
      'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
      ctx.org_a, ctx.store_a, ctx.quote_corrupt
    ),
    'MULTIPLE_PROFILE_VERSIONS'
  );

  perform pg_temp._p9_quote_lineage_expect_fail(
    25,
    'unique quote/profile_component prevents duplicate materialization',
    pg_catalog.format(
      $sql$
        with inserted as (
          insert into public.sales_quote_items (
            quote_id, organization_id, store_id, commercial_opportunity_id,
            profile_component_id, item_type, pool_id, catalog_item_id, name,
            quantity, unit_price_cents, discount_cents, subtotal_cents,
            total_cents, sort_order, metadata
          )
          select
            quote_id, organization_id, store_id, commercial_opportunity_id,
            profile_component_id, item_type, pool_id, catalog_item_id, name,
            quantity, unit_price_cents, discount_cents, subtotal_cents,
            total_cents, 200, metadata
          from public.sales_quote_items
          where quote_id = %L::uuid
            and profile_component_id is not null
          limit 1
          returning id
        )
        select id from inserted
      $sql$,
      ctx.quote_pool
    ),
    'p9_sales_quote_items_quote_profile_component_uidx'
  );

  select pg_catalog.count(*)::integer
  into v_items
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname = 'materialize_sales_quote_items_from_current_profile_by_system'
    and pg_catalog.pg_get_function_arguments(proc_row.oid) =
      'p_organization_id uuid, p_store_id uuid, p_quote_id uuid';

  if v_items = 1 then
    perform pg_temp._p9_quote_lineage_record(26, 'RPC accepts only exact scope and no arbitrary source payload', 'PASS', 'signature is scope-only');
  else
    perform pg_temp._p9_quote_lineage_record(26, 'RPC accepts only exact scope and no arbitrary source payload', 'SUT_FAIL', 'unexpected function signature');
  end if;


  -- 27. A quote with an explicit opportunity but any legacy item must not enter
  -- the canonical materializer. This proves the legacy compatibility shape does
  -- not allow a mixed authority quote.
  v_legacy_with_opp_quote := gen_random_uuid();

  insert into public.sales_quotes (
    id, organization_id, store_id, commercial_opportunity_id,
    conversation_id, lead_id, quote_number, title, status,
    customer_name, customer_phone, customer_notes, internal_notes,
    subtotal_cents, discount_cents, total_cents, current_version_id, metadata
  ) values (
    v_legacy_with_opp_quote, ctx.org_a, ctx.store_a, ctx.opp_pool,
    null, null, 'QL-LEG-OPP', 'Legacy With Opportunity', 'draft',
    'Legacy With Opportunity', null, null, null, 0, 0, 0, null, '{}'::jsonb
  );

  insert into public.sales_quote_items (
    quote_id, organization_id, store_id, item_type, name, description,
    quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents,
    sort_order, sku, metadata
  ) values (
    v_legacy_with_opp_quote, ctx.org_a, ctx.store_a, 'custom',
    'Legacy item with opportunity', null, 1, 1000, 0, 1000, 1000, 1, null, '{}'::jsonb
  );

  perform pg_temp._p9_quote_lineage_expect_fail(
    27,
    'quote with legacy item and opportunity fails canonical materialization',
    pg_catalog.format(
      'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
      ctx.org_a, ctx.store_a, v_legacy_with_opp_quote
    ),
    'LEGACY_ITEMS_PRESENT'
  );

  -- 28. A formerly canonical quote becomes invalid for replay if a legacy item is
  -- introduced beside it. The materializer must reject the hybrid quote.
  insert into public.sales_quote_items (
    quote_id, organization_id, store_id, item_type, name, description,
    quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents,
    sort_order, sku, metadata
  ) values (
    ctx.quote_pool, ctx.org_a, ctx.store_a, 'custom', 'Injected legacy item',
    null, 1, 100, 0, 100, 100, 500, null, '{}'::jsonb
  );

  perform pg_temp._p9_quote_lineage_expect_fail(
    28,
    'hybrid legacy plus canonical quote fails replay',
    pg_catalog.format(
      'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
      ctx.org_a, ctx.store_a, ctx.quote_pool
    ),
    'LEGACY_ITEMS_PRESENT'
  );

  -- 29. A profile with one valid source and one unusable source must fail as a
  -- whole and leave zero quote items. This is the single-session all-or-nothing
  -- proof; the RPC also carries a post-INSERT exact-count guard for races.
  v_atomic_opp := gen_random_uuid();
  v_atomic_quote := gen_random_uuid();

  insert into public.commercial_opportunities (
    id, organization_id, store_id, customer_id, stage
  ) values (
    v_atomic_opp, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'
  );

  insert into public.sales_quotes (
    id, organization_id, store_id, commercial_opportunity_id,
    conversation_id, lead_id, quote_number, title, status,
    customer_name, customer_phone, customer_notes, internal_notes,
    subtotal_cents, discount_cents, total_cents, current_version_id, metadata
  ) values (
    v_atomic_quote, ctx.org_a, ctx.store_a, v_atomic_opp,
    null, null, 'QL-ATOMIC-FAIL', 'Atomic Failure', 'draft',
    'Atomic Failure', null, null, null, 0, 0, 0, null, '{}'::jsonb
  );

  perform pg_temp._p9_quote_lineage_create_profile(
    ctx.org_a,
    ctx.store_a,
    v_atomic_opp,
    'resolved',
    'lineage-atomic-failure-v1',
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'component_key', 'pool_valid',
        'component_kind', 'pool',
        'component_state', 'resolved',
        'pool_id', ctx.pool_a,
        'catalog_item_id', null,
        'reference_text', null
      ),
      pg_catalog.jsonb_build_object(
        'component_key', 'catalog_invalid_price',
        'component_kind', 'catalog_item',
        'component_state', 'resolved',
        'pool_id', null,
        'catalog_item_id', ctx.catalog_no_price,
        'reference_text', null
      )
    )
  );

  select *
  into v_result
  from pg_temp._p9_quote_lineage_exec(pg_catalog.format(
    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
    ctx.org_a, ctx.store_a, v_atomic_quote
  ));

  select pg_catalog.count(*)::integer
  into v_zero_items
  from public.sales_quote_items
  where quote_id = v_atomic_quote;

  if not v_result.operation_succeeded
     and coalesce(v_result.message_text, '') ilike '%CATALOG_SOURCE_NOT_USABLE%'
     and v_zero_items = 0 then
    perform pg_temp._p9_quote_lineage_record(
      29,
      'mixed valid and invalid sources fail atomically with zero items',
      'PASS',
      coalesce(v_result.message_text, 'failed with zero rows')
    );
  else
    perform pg_temp._p9_quote_lineage_record(
      29,
      'mixed valid and invalid sources fail atomically with zero items',
      'SUT_FAIL',
      'succeeded=' || coalesce(v_result.operation_succeeded::text, '<null>') ||
      ' message=' || coalesce(v_result.message_text, '<null>') ||
      ' item_count=' || coalesce(v_zero_items::text, '<null>')
    );
  end if;

  -- 30. A resolved version with two valid components must materialize the exact
  -- expected cardinality, exercising the non-partial success path.
  v_multi_opp := gen_random_uuid();
  v_multi_quote := gen_random_uuid();

  insert into public.commercial_opportunities (
    id, organization_id, store_id, customer_id, stage
  ) values (
    v_multi_opp, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'
  );

  insert into public.sales_quotes (
    id, organization_id, store_id, commercial_opportunity_id,
    conversation_id, lead_id, quote_number, title, status,
    customer_name, customer_phone, customer_notes, internal_notes,
    subtotal_cents, discount_cents, total_cents, current_version_id, metadata
  ) values (
    v_multi_quote, ctx.org_a, ctx.store_a, v_multi_opp,
    null, null, 'QL-MULTI', 'Multi Component', 'draft',
    'Multi Component', null, null, null, 0, 0, 0, null, '{}'::jsonb
  );

  perform pg_temp._p9_quote_lineage_create_profile(
    ctx.org_a,
    ctx.store_a,
    v_multi_opp,
    'resolved',
    'lineage-multi-v1',
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'component_key', 'pool_multi',
        'component_kind', 'pool',
        'component_state', 'resolved',
        'pool_id', ctx.pool_a,
        'catalog_item_id', null,
        'reference_text', null
      ),
      pg_catalog.jsonb_build_object(
        'component_key', 'catalog_multi',
        'component_kind', 'catalog_item',
        'component_state', 'resolved',
        'pool_id', null,
        'catalog_item_id', ctx.catalog_a,
        'reference_text', null
      )
    )
  );

  select *
  into v_result
  from pg_temp._p9_quote_lineage_exec(pg_catalog.format(
    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
    ctx.org_a, ctx.store_a, v_multi_quote
  ));

  select pg_catalog.count(*)::integer
  into v_items
  from public.sales_quote_items
  where quote_id = v_multi_quote
    and profile_component_id is not null;

  if v_result.operation_succeeded
     and v_result.value_json ->> 'outcome' = 'materialized'
     and (v_result.value_json ->> 'item_count')::integer = 2
     and v_items = 2 then
    perform pg_temp._p9_quote_lineage_record(
      30,
      'two valid components materialize exact expected cardinality',
      'PASS',
      v_result.value_json::text
    );
  else
    perform pg_temp._p9_quote_lineage_record(
      30,
      'two valid components materialize exact expected cardinality',
      'SUT_FAIL',
      coalesce(v_result.message_text, v_result.value_json::text, 'unexpected result') ||
      ' actual_items=' || coalesce(v_items::text, '<null>')
    );
  end if;

  -- 31. Structural safety checks for the corrections that cannot be faithfully
  -- exercised as a two-session race inside this single transaction manual runner.
  select pg_catalog.pg_get_functiondef(proc_row.oid), proc_row.proconfig
  into v_function_def, v_function_config
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname = 'materialize_sales_quote_items_from_current_profile_by_system'
    and pg_catalog.pg_get_function_arguments(proc_row.oid) =
      'p_organization_id uuid, p_store_id uuid, p_quote_id uuid';

  if position('for share' in lower(coalesce(v_function_def, ''))) > 0
     and position('v_inserted_count <> v_expected_component_count' in lower(coalesce(v_function_def, ''))) > 0
     and position('zion_sales_quote_profile_materializer_materialization_count_mismatch' in lower(coalesce(v_function_def, ''))) > 0
     and position('min(component_row.profile_version_id)' in lower(coalesce(v_function_def, ''))) = 0
     and coalesce(v_function_config, '{}'::text[]) @> array['search_path=pg_catalog, public, pg_temp']::text[] then
    perform pg_temp._p9_quote_lineage_record(
      31,
      'RPC contains current-row lock exact-count race guard hardened search_path and no min(uuid)',
      'PASS',
      'FOR SHARE + exact-count guard + hardened search_path confirmed'
    );
  else
    perform pg_temp._p9_quote_lineage_record(
      31,
      'RPC contains current-row lock exact-count race guard hardened search_path and no min(uuid)',
      'SUT_FAIL',
      'function contract guard missing or unexpected proconfig'
    );
  end if;
end;
$scenarios$;

select *
from pg_temp._p9_quote_lineage_results
order by scenario_number;

do $assert_all_passed$
declare
  v_failures integer;
  v_details text;
begin
  select count(*)
  into v_failures
  from pg_temp._p9_quote_lineage_results
  where status <> 'PASS';

  if v_failures > 0 then
    select string_agg(
      scenario_number::text || '. ' || scenario_name || ' => ' || status || ': ' || detail,
      E'\n'
      order by scenario_number
    )
    into v_details
    from pg_temp._p9_quote_lineage_results
    where status <> 'PASS';

    raise exception using
      errcode = 'P0001',
      message = 'P9 sales quote item profile lineage manual checks failed',
      detail = v_details;
  end if;
end;
$assert_all_passed$;

rollback;
