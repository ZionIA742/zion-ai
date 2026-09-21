begin;



set transaction isolation level repeatable read;

set local lock_timeout = '5s';

set local statement_timeout = '300s';

set local idle_in_transaction_session_timeout = '300s';

set local search_path = pg_catalog, pg_temp, public, auth, extensions;



create temp table pg_temp._p9_apply_change_lineage_results (

  scenario_number integer primary key,

  scenario_name text not null,

  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),

  detail text not null

) on commit preserve rows;



create or replace function pg_temp._p9_apply_change_lineage_record(

  p_scenario_number integer,

  p_scenario_name text,

  p_status text,

  p_detail text default null

)

returns void

language plpgsql

as $function$

begin

  insert into pg_temp._p9_apply_change_lineage_results(

    scenario_number, scenario_name, status, detail

  ) values (

    p_scenario_number, p_scenario_name, p_status, coalesce(p_detail, '<null>')

  )

  on conflict (scenario_number) do update

  set scenario_name = excluded.scenario_name,

      status = excluded.status,

      detail = excluded.detail;

end;

$function$;



create or replace function pg_temp._p9_apply_change_lineage_exec_json(

  p_role text,

  p_user_id uuid,

  p_sql text

)

returns table (

  operation_succeeded boolean,

  value_json jsonb,

  returned_sqlstate text,

  message_text text

)

language plpgsql

as $function$

declare

  v_value jsonb;

  v_state text;

  v_message text;

begin

  if current_user <> 'postgres' or session_user <> 'postgres' then

    return query select false, null::jsonb, null::text, 'runner helper must start as postgres'::text;

    return;

  end if;



  if p_role <> 'postgres' then

    perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);

    perform set_config('request.jwt.claim.role', p_role, true);

    perform set_config(

      'request.jwt.claims',

      pg_catalog.jsonb_build_object('sub', coalesce(p_user_id::text, ''), 'role', p_role)::text,

      true

    );

    execute pg_catalog.format('set local role %I', p_role);

  end if;



  begin

    execute pg_catalog.format('select to_jsonb(result_row) from (%s) result_row', p_sql)

      into v_value;



    if p_role <> 'postgres' then

      execute 'reset role';

    end if;



    return query select true, v_value, null::text, null::text;

  exception when others then

    get stacked diagnostics

      v_state = returned_sqlstate,

      v_message = message_text;



    if p_role <> 'postgres' then

      execute 'reset role';

    end if;



    return query select false, null::jsonb, v_state, v_message;

  end;

end;

$function$;



create or replace function pg_temp._p9_apply_change_lineage_create_profile(

  p_organization_id uuid,

  p_store_id uuid,

  p_commercial_opportunity_id uuid,

  p_operation_key text,

  p_quote_terms_authority_user_id uuid,

  p_components jsonb

)

returns uuid

language plpgsql

as $function$

declare

  v_profile_version_id uuid := gen_random_uuid();

begin

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

    1,

    null,

    'resolved',

    p_operation_key,

    repeat('b', 64),

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

    metadata,

    quote_item_name,

    quote_item_description,

    quote_item_quantity,

    quote_item_unit_price_cents,

    quote_terms_authority_type,

    quote_terms_authority_user_id,

    quote_terms_origin_component_id

  )

  select

    p_organization_id,

    p_store_id,

    p_commercial_opportunity_id,

    v_profile_version_id,

    component_row.component_key,

    component_row.component_kind,

    'resolved',

    component_row.pool_id,

    component_row.catalog_item_id,

    component_row.reference_text,

    '{}'::jsonb,

    case
      when component_row.component_kind in ('service', 'custom')
        then component_row.quote_item_name
      else null
    end,

    case
      when component_row.component_kind in ('service', 'custom')
        then component_row.quote_item_description
      else null
    end,

    case
      when component_row.component_kind in ('service', 'custom')
        then component_row.quote_item_quantity
      else null
    end,

    case
      when component_row.component_kind in ('service', 'custom')
        then component_row.quote_item_unit_price_cents
      else null
    end,

    case
      when component_row.component_kind in ('service', 'custom')
        then 'human'
      else null
    end,

    case
      when component_row.component_kind in ('service', 'custom')
        then p_quote_terms_authority_user_id
      else null
    end,

    null::uuid

  from pg_catalog.jsonb_to_recordset(coalesce(p_components, '[]'::jsonb)) as component_row(

    component_key text,

    component_kind text,

    pool_id uuid,

    catalog_item_id uuid,

    reference_text text,

    quote_item_name text,

    quote_item_description text,

    quote_item_quantity integer,

    quote_item_unit_price_cents integer

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

  );



  return v_profile_version_id;

end;

$function$;



do $fixtures$

declare

  v_org uuid := gen_random_uuid();

  v_store uuid := gen_random_uuid();

  v_user uuid := gen_random_uuid();

  v_customer uuid := gen_random_uuid();

  v_pool uuid := gen_random_uuid();

  v_catalog uuid := gen_random_uuid();

  v_opp_catalog uuid := gen_random_uuid();

  v_opp_pool uuid := gen_random_uuid();

  v_opp_service uuid := gen_random_uuid();

  v_opp_manual uuid := gen_random_uuid();

  v_opp_malicious uuid := gen_random_uuid();

  v_opp_rollback uuid := gen_random_uuid();

  v_quote_catalog uuid := gen_random_uuid();

  v_quote_pool uuid := gen_random_uuid();

  v_quote_service uuid := gen_random_uuid();

  v_quote_manual uuid := gen_random_uuid();

  v_quote_malicious uuid := gen_random_uuid();

  v_quote_rollback uuid := gen_random_uuid();

  v_item_catalog uuid := gen_random_uuid();

  v_item_pool uuid := gen_random_uuid();

  v_item_service uuid := gen_random_uuid();

  v_item_malicious uuid := gen_random_uuid();

  v_item_rollback uuid := gen_random_uuid();

  v_component_catalog uuid;

  v_component_pool uuid;

  v_component_service uuid;

  v_component_malicious uuid;

  v_component_rollback uuid;

  v_catalog_version uuid;

  v_pool_version uuid;

  v_service_version uuid;

  v_malicious_version uuid;

  v_rollback_version uuid;

begin

  create temp table pg_temp._p9_apply_change_lineage_ctx (

    singleton boolean primary key default true check (singleton),

    org_id uuid not null,

    store_id uuid not null,

    user_id uuid not null,

    pool_id uuid not null,

    catalog_id uuid not null,

    quote_catalog uuid not null,

    quote_pool uuid not null,

    quote_service uuid not null,

    quote_manual uuid not null,

    quote_malicious uuid not null,

    quote_rollback uuid not null,

    opp_catalog uuid not null,

    opp_pool uuid not null,

    opp_service uuid not null,

    opp_manual uuid not null,

    opp_malicious uuid not null,

    opp_rollback uuid not null,

    item_catalog uuid not null,

    item_pool uuid not null,

    item_service uuid not null,

    item_malicious uuid not null,

    item_rollback uuid not null,

    component_catalog uuid,

    component_pool uuid,

    component_service uuid,

    component_malicious uuid,

    component_rollback uuid

  ) on commit preserve rows;



  insert into auth.users(id) values (v_user);

  insert into public.organizations (id, name, subscription_status)

  values (v_org, 'P9 Apply Change Lineage Org', 'active');

  insert into public.stores (id, organization_id, name)

  values (v_store, v_org, 'P9 Apply Change Lineage Store');

  insert into public.memberships (organization_id, user_id, role, is_active)

  values (v_org, v_user, 'admin', true);

  insert into public.customers (id, organization_id, display_name)

  values (v_customer, v_org, 'P9 Apply Change Lineage Customer');



  insert into public.commercial_opportunities (id, organization_id, store_id, customer_id, stage)

  values

    (v_opp_catalog, v_org, v_store, v_customer, 'orcamento'),

    (v_opp_pool, v_org, v_store, v_customer, 'orcamento'),

    (v_opp_service, v_org, v_store, v_customer, 'orcamento'),

    (v_opp_manual, v_org, v_store, v_customer, 'orcamento'),

    (v_opp_malicious, v_org, v_store, v_customer, 'orcamento'),

    (v_opp_rollback, v_org, v_store, v_customer, 'orcamento');



  insert into public.pools (

    id, organization_id, store_id, name, width_m, length_m, depth_m,

    shape, material, max_capacity_l, weight_kg, price, price_status,

    description, is_active, track_stock, stock_quantity, stock_status

  ) values (

    v_pool, v_org, v_store, 'Apply Change Lineage Pool',

    2, 3, 1, 'retangular', 'vinil', 1000, 200, 1234.56, 'valid',

    'Apply-change lineage pool', true, false, null, 'not_tracked'

  );



  insert into public.store_catalog_items (

    id, organization_id, store_id, sku, name, description, price_cents,

    price_status, currency, is_active, track_stock, stock_quantity,

    stock_status, metadata

  ) values (

    v_catalog, v_org, v_store, 'ACL-CAT',

    'Apply Change Lineage Catalog', 'Apply-change lineage catalog', 2500,

    'valid', 'BRL', true, false, null, 'not_tracked', '{}'::jsonb

  );



  v_catalog_version := pg_temp._p9_apply_change_lineage_create_profile(

    v_org, v_store, v_opp_catalog, 'apply-change-lineage-catalog', v_user,

    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(

      'component_key', 'catalog_primary',

      'component_kind', 'catalog_item',

      'pool_id', null,

      'catalog_item_id', v_catalog,

      'reference_text', null

    ))

  );

  v_pool_version := pg_temp._p9_apply_change_lineage_create_profile(

    v_org, v_store, v_opp_pool, 'apply-change-lineage-pool', v_user,

    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(

      'component_key', 'pool_primary',

      'component_kind', 'pool',

      'pool_id', v_pool,

      'catalog_item_id', null,

      'reference_text', null

    ))

  );

  v_service_version := pg_temp._p9_apply_change_lineage_create_profile(

    v_org, v_store, v_opp_service, 'apply-change-lineage-service', v_user,

    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(

      'component_key', 'service_primary',

      'component_kind', 'service',

      'pool_id', null,

      'catalog_item_id', null,

      'reference_text', 'Instalacao',

      'quote_item_name', 'Instalacao',

      'quote_item_description', null,

      'quote_item_quantity', 1,

      'quote_item_unit_price_cents', 5000

    ))

  );

  v_malicious_version := pg_temp._p9_apply_change_lineage_create_profile(

    v_org, v_store, v_opp_malicious, 'apply-change-lineage-malicious', v_user,

    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(

      'component_key', 'catalog_malicious',

      'component_kind', 'catalog_item',

      'pool_id', null,

      'catalog_item_id', v_catalog,

      'reference_text', null

    ))

  );

  v_rollback_version := pg_temp._p9_apply_change_lineage_create_profile(

    v_org, v_store, v_opp_rollback, 'apply-change-lineage-rollback', v_user,

    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(

      'component_key', 'pool_rollback',

      'component_kind', 'pool',

      'pool_id', v_pool,

      'catalog_item_id', null,

      'reference_text', null

    ))

  );



  select id into v_component_catalog

  from public.commercial_opportunity_profile_components

  where profile_version_id = v_catalog_version;

  select id into v_component_pool

  from public.commercial_opportunity_profile_components

  where profile_version_id = v_pool_version;

  select id into v_component_service

  from public.commercial_opportunity_profile_components

  where profile_version_id = v_service_version;

  select id into v_component_malicious

  from public.commercial_opportunity_profile_components

  where profile_version_id = v_malicious_version;

  select id into v_component_rollback

  from public.commercial_opportunity_profile_components

  where profile_version_id = v_rollback_version;



  insert into public.sales_quotes (

    id, organization_id, store_id, commercial_opportunity_id,

    conversation_id, lead_id, quote_number, title, status,

    customer_name, customer_phone, customer_notes, internal_notes,

    subtotal_cents, discount_cents, total_cents, current_version_id, metadata

  ) values

    (v_quote_catalog, v_org, v_store, v_opp_catalog, null, null, 'ACL-CAT', 'Catalog', 'draft', 'Catalog', null, null, null, 10000, 0, 10000, null, '{}'::jsonb),

    (v_quote_pool, v_org, v_store, v_opp_pool, null, null, 'ACL-POOL', 'Pool', 'draft', 'Pool', null, null, null, 20000, 0, 20000, null, '{}'::jsonb),

    (v_quote_service, v_org, v_store, v_opp_service, null, null, 'ACL-SVC', 'Service', 'draft', 'Service', null, null, null, 5000, 0, 5000, null, '{}'::jsonb),

    (v_quote_manual, v_org, v_store, v_opp_manual, null, null, 'ACL-MAN', 'Manual', 'draft', 'Manual', null, null, null, 5000, 0, 5000, null, '{}'::jsonb),

    (v_quote_malicious, v_org, v_store, v_opp_malicious, null, null, 'ACL-MAL', 'Malicious', 'draft', 'Malicious', null, null, null, 10000, 0, 10000, null, '{}'::jsonb),

    (v_quote_rollback, v_org, v_store, v_opp_rollback, null, null, 'ACL-RB', 'Rollback', 'draft', 'Rollback', null, null, null, 20000, 0, 20000, null, '{}'::jsonb);



  insert into public.sales_quote_items (

    id, quote_id, organization_id, store_id, commercial_opportunity_id,

    profile_component_id, item_type, pool_id, catalog_item_id, name, description,

    quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents,

    sort_order, sku, metadata

  ) values

    (v_item_catalog, v_quote_catalog, v_org, v_store, v_opp_catalog, v_component_catalog, 'catalog_item', null, v_catalog, 'Catalog item', null, 1, 10000, 0, 10000, 10000, 1, null, '{}'::jsonb),

    (v_item_pool, v_quote_pool, v_org, v_store, v_opp_pool, v_component_pool, 'pool', v_pool, null, 'Pool item', null, 1, 20000, 0, 20000, 20000, 1, null, '{}'::jsonb),

    (v_item_service, v_quote_service, v_org, v_store, v_opp_service, v_component_service, 'service', null, null, 'Service item', null, 1, 5000, 0, 5000, 5000, 1, null, '{}'::jsonb),

    (v_item_malicious, v_quote_malicious, v_org, v_store, v_opp_malicious, v_component_malicious, 'catalog_item', null, v_catalog, 'Malicious item', null, 1, 10000, 0, 10000, 10000, 1, null, '{}'::jsonb),

    (v_item_rollback, v_quote_rollback, v_org, v_store, v_opp_rollback, v_component_rollback, 'pool', v_pool, null, 'Rollback item', null, 1, 20000, 0, 20000, 20000, 1, null, '{}'::jsonb);



  insert into pg_temp._p9_apply_change_lineage_ctx(

    org_id, store_id, user_id, pool_id, catalog_id,

    quote_catalog, quote_pool, quote_service, quote_manual, quote_malicious, quote_rollback,

    opp_catalog, opp_pool, opp_service, opp_manual, opp_malicious, opp_rollback,

    item_catalog, item_pool, item_service, item_malicious, item_rollback,

    component_catalog, component_pool, component_service, component_malicious, component_rollback

  ) values (

    v_org, v_store, v_user, v_pool, v_catalog,

    v_quote_catalog, v_quote_pool, v_quote_service, v_quote_manual, v_quote_malicious, v_quote_rollback,

    v_opp_catalog, v_opp_pool, v_opp_service, v_opp_manual, v_opp_malicious, v_opp_rollback,

    v_item_catalog, v_item_pool, v_item_service, v_item_malicious, v_item_rollback,

    v_component_catalog, v_component_pool, v_component_service, v_component_malicious, v_component_rollback

  );

end;

$fixtures$;



do $scenarios$

declare

  ctx pg_temp._p9_apply_change_lineage_ctx%rowtype;

  r record;

  q text;

  v_fake_opp uuid := gen_random_uuid();

  v_fake_component uuid := gen_random_uuid();

  v_fake_pool uuid := gen_random_uuid();

  v_fake_catalog uuid := gen_random_uuid();

  v_item record;

  v_quote record;

  v_count integer;

  v_sum_subtotal integer;

  v_sum_discount integer;

  v_sum_total integer;

begin

  select * into ctx from pg_temp._p9_apply_change_lineage_ctx where singleton;



  q := pg_catalog.format(

    $sql$

      select * from public.apply_sales_quote_change_money_and_items_by_system(

        %L::uuid, %L::uuid, %L::uuid,

        'Catalog updated'::text, 'pending_review'::text,

        10000::integer, 500::integer, 9500::integer,

        null::text, null::text, null::text, null::text, null::text, null::date, '{}'::jsonb,

        %L::jsonb

      )

    $sql$,

    ctx.org_id,

    ctx.store_id,

    ctx.quote_catalog,

    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(

      'id', ctx.item_catalog,

      'item_type', 'catalog_item',

      'name', 'Catalog item',

      'quantity', 1,

      'unit_price_cents', 10000,

      'discount_cents', 500,

      'subtotal_cents', 10000,

      'total_cents', 9500,

      'sort_order', 1,

      'metadata', '{}'::jsonb

    ))::text

  );



  select * into r from pg_temp._p9_apply_change_lineage_exec_json('service_role', null, q);

  select * into v_item from public.sales_quote_items where id = ctx.item_catalog;



  perform pg_temp._p9_apply_change_lineage_record(

    1,

    'catalog item preserves persisted commercial opportunity profile component and catalog lineage',

    case

      when r.operation_succeeded

       and v_item.commercial_opportunity_id = ctx.opp_catalog

       and v_item.profile_component_id = ctx.component_catalog

       and v_item.catalog_item_id = ctx.catalog_id

       and v_item.pool_id is null

       and v_item.discount_cents = 500

      then 'PASS' else 'SUT_FAIL'

    end,

    pg_catalog.format('result=%s item_lineage=%s/%s/%s/%s discount=%s', coalesce(r.message_text, r.value_json::text), v_item.commercial_opportunity_id, v_item.profile_component_id, v_item.pool_id, v_item.catalog_item_id, v_item.discount_cents)

  );



  q := pg_catalog.format(

    $sql$

      select * from public.apply_sales_quote_change_money_and_items_by_system(

        %L::uuid, %L::uuid, %L::uuid,

        'Pool updated'::text, 'pending_review'::text,

        20000::integer, 1000::integer, 19000::integer,

        null::text, null::text, null::text, null::text, null::text, null::date, '{}'::jsonb,

        %L::jsonb

      )

    $sql$,

    ctx.org_id,

    ctx.store_id,

    ctx.quote_pool,

    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(

      'id', ctx.item_pool,

      'item_type', 'pool',

      'name', 'Pool item',

      'quantity', 1,

      'unit_price_cents', 20000,

      'discount_cents', 1000,

      'subtotal_cents', 20000,

      'total_cents', 19000,

      'sort_order', 1,

      'metadata', '{}'::jsonb

    ))::text

  );



  select * into r from pg_temp._p9_apply_change_lineage_exec_json('service_role', null, q);

  select * into v_item from public.sales_quote_items where id = ctx.item_pool;



  perform pg_temp._p9_apply_change_lineage_record(

    2,

    'pool item preserves persisted pool profile lineage',

    case

      when r.operation_succeeded

       and v_item.commercial_opportunity_id = ctx.opp_pool

       and v_item.profile_component_id = ctx.component_pool

       and v_item.pool_id = ctx.pool_id

       and v_item.catalog_item_id is null

      then 'PASS' else 'SUT_FAIL'

    end,

    pg_catalog.format('result=%s item_lineage=%s/%s/%s/%s', coalesce(r.message_text, r.value_json::text), v_item.commercial_opportunity_id, v_item.profile_component_id, v_item.pool_id, v_item.catalog_item_id)

  );



  q := pg_catalog.format(

    $sql$

      select * from public.apply_sales_quote_change_money_and_items_by_system(

        %L::uuid, %L::uuid, %L::uuid,

        'Service updated'::text, 'pending_review'::text,

        5000::integer, 250::integer, 4750::integer,

        null::text, null::text, null::text, null::text, null::text, null::date, '{}'::jsonb,

        %L::jsonb

      )

    $sql$,

    ctx.org_id,

    ctx.store_id,

    ctx.quote_service,

    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(

      'id', ctx.item_service,

      'item_type', 'service',

      'name', 'Service item',

      'quantity', 1,

      'unit_price_cents', 5000,

      'discount_cents', 250,

      'subtotal_cents', 5000,

      'total_cents', 4750,

      'sort_order', 1,

      'metadata', '{}'::jsonb

    ))::text

  );



  select * into r from pg_temp._p9_apply_change_lineage_exec_json('service_role', null, q);

  select * into v_item from public.sales_quote_items where id = ctx.item_service;



  perform pg_temp._p9_apply_change_lineage_record(

    3,

    'service/custom profile item preserves profile lineage without pool or catalog',

    case

      when r.operation_succeeded

       and v_item.commercial_opportunity_id = ctx.opp_service

       and v_item.profile_component_id = ctx.component_service

       and v_item.pool_id is null

       and v_item.catalog_item_id is null

      then 'PASS' else 'SUT_FAIL'

    end,

    pg_catalog.format('result=%s item_lineage=%s/%s/%s/%s', coalesce(r.message_text, r.value_json::text), v_item.commercial_opportunity_id, v_item.profile_component_id, v_item.pool_id, v_item.catalog_item_id)

  );



  q := pg_catalog.format(

    $sql$

      select * from public.apply_sales_quote_change_money_and_items_by_system(

        %L::uuid, %L::uuid, %L::uuid,

        'Manual updated'::text, 'pending_review'::text,

        7000::integer, 0::integer, 7000::integer,

        null::text, null::text, null::text, null::text, null::text, null::date, '{}'::jsonb,

        %L::jsonb

      )

    $sql$,

    ctx.org_id,

    ctx.store_id,

    ctx.quote_manual,

    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(

      'id', gen_random_uuid(),

      'commercial_opportunity_id', v_fake_opp,

      'profile_component_id', v_fake_component,

      'pool_id', v_fake_pool,

      'catalog_item_id', v_fake_catalog,

      'item_type', 'custom',

      'name', 'Manual item',

      'quantity', 1,

      'unit_price_cents', 7000,

      'discount_cents', 0,

      'subtotal_cents', 7000,

      'total_cents', 7000,

      'sort_order', 1,

      'metadata', '{}'::jsonb

    ))::text

  );



  select * into r from pg_temp._p9_apply_change_lineage_exec_json('service_role', null, q);

  select * into v_item

  from public.sales_quote_items

  where quote_id = ctx.quote_manual

    and organization_id = ctx.org_id

    and store_id = ctx.store_id;



  perform pg_temp._p9_apply_change_lineage_record(

    4,

    'new manual item ignores supplied lineage and remains null lineage',

    case

      when r.operation_succeeded

       and v_item.commercial_opportunity_id is null

       and v_item.profile_component_id is null

       and v_item.pool_id is null

       and v_item.catalog_item_id is null

      then 'PASS' else 'SUT_FAIL'

    end,

    pg_catalog.format('result=%s item_lineage=%s/%s/%s/%s', coalesce(r.message_text, r.value_json::text), v_item.commercial_opportunity_id, v_item.profile_component_id, v_item.pool_id, v_item.catalog_item_id)

  );



  q := pg_catalog.format(

    $sql$

      select * from public.apply_sales_quote_change_money_and_items_by_system(

        %L::uuid, %L::uuid, %L::uuid,

        'Malicious updated'::text, 'pending_review'::text,

        10000::integer, 1000::integer, 9000::integer,

        null::text, null::text, null::text, null::text, null::text, null::date, '{}'::jsonb,

        %L::jsonb

      )

    $sql$,

    ctx.org_id,

    ctx.store_id,

    ctx.quote_malicious,

    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(

      'id', ctx.item_malicious,

      'commercial_opportunity_id', v_fake_opp,

      'profile_component_id', v_fake_component,

      'pool_id', v_fake_pool,

      'catalog_item_id', v_fake_catalog,

      'item_type', 'catalog_item',

      'name', 'Malicious item',

      'quantity', 1,

      'unit_price_cents', 10000,

      'discount_cents', 1000,

      'subtotal_cents', 10000,

      'total_cents', 9000,

      'sort_order', 1,

      'metadata', '{}'::jsonb

    ))::text

  );



  select * into r from pg_temp._p9_apply_change_lineage_exec_json('service_role', null, q);

  select * into v_item from public.sales_quote_items where id = ctx.item_malicious;



  perform pg_temp._p9_apply_change_lineage_record(

    5,

    'existing item ignores supplied lineage and preserves persisted authority',

    case

      when r.operation_succeeded

       and v_item.commercial_opportunity_id = ctx.opp_malicious

       and v_item.profile_component_id = ctx.component_malicious

       and v_item.pool_id is null

       and v_item.catalog_item_id = ctx.catalog_id

      then 'PASS' else 'SUT_FAIL'

    end,

    pg_catalog.format('result=%s item_lineage=%s/%s/%s/%s fake=%s/%s/%s/%s', coalesce(r.message_text, r.value_json::text), v_item.commercial_opportunity_id, v_item.profile_component_id, v_item.pool_id, v_item.catalog_item_id, v_fake_opp, v_fake_component, v_fake_pool, v_fake_catalog)

  );



  q := pg_catalog.format(

    $sql$

      select * from public.apply_sales_quote_change_money_and_items_by_system(

        %L::uuid, %L::uuid, %L::uuid,

        'Rollback updated'::text, 'pending_review'::text,

        40000::integer, 0::integer, 40000::integer,

        null::text, null::text, null::text, null::text, null::text, null::date, '{}'::jsonb,

        %L::jsonb

      )

    $sql$,

    ctx.org_id,

    ctx.store_id,

    ctx.quote_rollback,

    pg_catalog.jsonb_build_array(

      pg_catalog.jsonb_build_object('id', ctx.item_rollback, 'item_type', 'pool', 'name', 'Rollback A', 'quantity', 1, 'unit_price_cents', 20000, 'discount_cents', 0, 'subtotal_cents', 20000, 'total_cents', 20000, 'sort_order', 1, 'metadata', '{}'::jsonb),

      pg_catalog.jsonb_build_object('id', ctx.item_rollback, 'item_type', 'pool', 'name', 'Rollback B', 'quantity', 1, 'unit_price_cents', 20000, 'discount_cents', 0, 'subtotal_cents', 20000, 'total_cents', 20000, 'sort_order', 2, 'metadata', '{}'::jsonb)

    )::text

  );



  select * into r from pg_temp._p9_apply_change_lineage_exec_json('service_role', null, q);

  select * into v_item from public.sales_quote_items where id = ctx.item_rollback;



  perform pg_temp._p9_apply_change_lineage_record(

    6,

    'rollback after item insert failure preserves previous lineage',

    case

      when not r.operation_succeeded

       and r.returned_sqlstate = '23505'

       and v_item.commercial_opportunity_id = ctx.opp_rollback

       and v_item.profile_component_id = ctx.component_rollback

       and v_item.pool_id = ctx.pool_id

       and v_item.catalog_item_id is null

       and v_item.name = 'Rollback item'

      then 'PASS' else 'SUT_FAIL'

    end,

    pg_catalog.format('state=%s message=%s item_lineage=%s/%s/%s/%s name=%s', coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>'), v_item.commercial_opportunity_id, v_item.profile_component_id, v_item.pool_id, v_item.catalog_item_id, v_item.name)

  );



  select

    quote_row.subtotal_cents,

    quote_row.discount_cents,

    quote_row.total_cents,

    pg_catalog.count(item_row.id)::integer as item_count,

    coalesce(pg_catalog.sum(item_row.subtotal_cents), 0)::integer as sum_subtotal,

    coalesce(pg_catalog.sum(item_row.discount_cents), 0)::integer as sum_discount,

    coalesce(pg_catalog.sum(item_row.total_cents), 0)::integer as sum_total

  into v_quote

  from public.sales_quotes quote_row

  join public.sales_quote_items item_row

    on item_row.quote_id = quote_row.id

   and item_row.organization_id = quote_row.organization_id

   and item_row.store_id = quote_row.store_id

  where quote_row.id = ctx.quote_catalog

  group by quote_row.id;



  v_count := v_quote.item_count;

  v_sum_subtotal := v_quote.sum_subtotal;

  v_sum_discount := v_quote.sum_discount;

  v_sum_total := v_quote.sum_total;



  perform pg_temp._p9_apply_change_lineage_record(

    7,

    'atomic writer still keeps header money equal to item sums',

    case

      when v_count = 1

       and v_quote.subtotal_cents = v_sum_subtotal

       and v_quote.discount_cents = v_sum_discount

       and v_quote.total_cents = v_sum_total

       and v_quote.total_cents = v_quote.subtotal_cents - v_quote.discount_cents

      then 'PASS' else 'SUT_FAIL'

    end,

    pg_catalog.format('quote=%s/%s/%s sums=%s/%s/%s count=%s', v_quote.subtotal_cents, v_quote.discount_cents, v_quote.total_cents, v_sum_subtotal, v_sum_discount, v_sum_total, v_count)

  );

exception when others then

  perform pg_temp._p9_apply_change_lineage_record(999, 'runner uncaught error', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);

end;

$scenarios$;



do $assertions$

declare

  v_failed integer;

  v_passed integer;

  v_missing integer;

  v_detail text;

begin

  select count(*) filter (where status = 'PASS'),

         count(*) filter (where status <> 'PASS')

  into v_passed, v_failed

  from pg_temp._p9_apply_change_lineage_results

  where scenario_number between 1 and 7;



  select count(*)

  into v_missing

  from generate_series(1, 7) as scenario_row(scenario_number)

  where not exists (

    select 1

    from pg_temp._p9_apply_change_lineage_results result_row

    where result_row.scenario_number = scenario_row.scenario_number

  );



  if v_failed > 0 or v_missing > 0 then

    select string_agg(

      pg_catalog.format(

        '#%s %s => %s (%s)',

        result_row.scenario_number,

        result_row.scenario_name,

        result_row.status,

        result_row.detail

      ),

      E'\n'

      order by result_row.scenario_number

    )

    into v_detail

    from pg_temp._p9_apply_change_lineage_results result_row

    where result_row.status <> 'PASS'

       or result_row.scenario_number not between 1 and 7;



    raise exception using

      errcode = 'P0001',

      message = 'P9 6.2 apply-change lineage manual checks failed',

      detail = pg_catalog.format(

        'passed=%s failed=%s missing=%s%s%s',

        coalesce(v_passed, 0),

        coalesce(v_failed, 0),

        coalesce(v_missing, 0),

        E'\n',

        coalesce(v_detail, '<no failure rows>')

      );

  end if;



  raise notice 'P9 6.2 apply-change lineage manual checks passed: % scenarios', v_passed;

end;

$assertions$;



rollback;
