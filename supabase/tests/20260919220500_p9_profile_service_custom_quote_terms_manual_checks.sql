begin;

set transaction isolation level repeatable read;

set local lock_timeout = '5s';

set local statement_timeout = '300s';

set local idle_in_transaction_session_timeout = '300s';

set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_quote_terms_results (

  scenario_number integer primary key,

  scenario_name text not null,

  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),

  detail text not null

) on commit preserve rows;

create temp table pg_temp._p9_quote_terms_ctx (

  singleton boolean primary key default true check (singleton),

  org_a uuid not null,

  org_b uuid not null,

  store_a uuid not null,

  store_b uuid not null,

  user_a uuid not null,

  user_b uuid not null,

  customer_a uuid not null,

  customer_b uuid not null,

  pool_a uuid not null,

  catalog_a uuid not null,

  catalog_service uuid not null,

  catalog_no_price uuid not null,

  opp_service uuid not null,

  opp_custom uuid not null,

  opp_mix uuid not null,

  opp_atomic uuid not null,

  opp_catalog_service uuid not null,

  quote_service uuid not null,

  quote_custom uuid not null,

  quote_mix uuid not null,

  quote_atomic uuid not null,

  quote_catalog_service uuid not null

) on commit preserve rows;

insert into pg_temp._p9_quote_terms_ctx (

  org_a, org_b, store_a, store_b, user_a, user_b, customer_a, customer_b,

  pool_a, catalog_a, catalog_service, catalog_no_price,

  opp_service, opp_custom, opp_mix, opp_atomic, opp_catalog_service,

  quote_service, quote_custom, quote_mix, quote_atomic, quote_catalog_service

)

values (

  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),

  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),

  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),

  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),

  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()

);

create or replace function pg_temp._p9_quote_terms_record(

  p_scenario_number integer,

  p_scenario_name text,

  p_status text,

  p_detail text default null

)

returns void

language plpgsql

as $function$

begin

  insert into pg_temp._p9_quote_terms_results(

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

create or replace function pg_temp._p9_quote_terms_exec_json(

  p_role text,

  p_user_id uuid,

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

    return query select false, null::jsonb, null::text, 'runner helper must start as postgres'::text, null::text;

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

      perform set_config('request.jwt.claim.sub', '', true);

      perform set_config('request.jwt.claim.role', '', true);

      perform set_config('request.jwt.claims', '', true);

    end if;

    return query select true, v_value, null::text, null::text, null::text;

  exception when others then

    get stacked diagnostics

      v_state = returned_sqlstate,

      v_message = message_text,

      v_constraint = constraint_name;

    if p_role <> 'postgres' then

      execute 'reset role';

      perform set_config('request.jwt.claim.sub', '', true);

      perform set_config('request.jwt.claim.role', '', true);

      perform set_config('request.jwt.claims', '', true);

    end if;

    return query select false, null::jsonb, v_state, v_message, v_constraint;

  end;

exception when others then

  begin execute 'reset role'; exception when others then null; end;

  perform set_config('request.jwt.claim.sub', '', true);

  perform set_config('request.jwt.claim.role', '', true);

  perform set_config('request.jwt.claims', '', true);

  return query select false, null::jsonb, sqlstate::text, ('runner helper error: ' || sqlerrm)::text, null::text;

end;

$function$;

create or replace function pg_temp._p9_quote_terms_exec_statement(

  p_role text,

  p_user_id uuid,

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

    return query select false, null::text, 'runner helper must start as postgres'::text, null::text;

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

    execute p_sql;

    if p_role <> 'postgres' then

      execute 'reset role';

      perform set_config('request.jwt.claim.sub', '', true);

      perform set_config('request.jwt.claim.role', '', true);

      perform set_config('request.jwt.claims', '', true);

    end if;

    return query select true, null::text, null::text, null::text;

  exception when others then

    get stacked diagnostics

      v_state = returned_sqlstate,

      v_message = message_text,

      v_constraint = constraint_name;

    if p_role <> 'postgres' then

      execute 'reset role';

      perform set_config('request.jwt.claim.sub', '', true);

      perform set_config('request.jwt.claim.role', '', true);

      perform set_config('request.jwt.claims', '', true);

    end if;

    return query select false, v_state, v_message, v_constraint;

  end;

exception when others then

  begin execute 'reset role'; exception when others then null; end;

  perform set_config('request.jwt.claim.sub', '', true);

  perform set_config('request.jwt.claim.role', '', true);

  perform set_config('request.jwt.claims', '', true);

  return query select false, sqlstate::text, ('runner helper error: ' || sqlerrm)::text, null::text;

end;

$function$;

create or replace function pg_temp._p9_quote_terms_expect_fail(

  p_scenario_number integer,

  p_scenario_name text,

  p_role text,

  p_user_id uuid,

  p_sql text,

  p_expected_message text

)

returns void

language plpgsql

as $function$

declare

  v_result record;

begin

  select *

  into v_result

  from pg_temp._p9_quote_terms_exec_statement(p_role, p_user_id, p_sql);

  if v_result.operation_succeeded then

    perform pg_temp._p9_quote_terms_record(p_scenario_number, p_scenario_name, 'SUT_FAIL', 'operation succeeded but failure was expected');

    return;

  end if;

  if coalesce(v_result.message_text, '') ilike '%' || p_expected_message || '%'

     or coalesce(v_result.constraint_name, '') ilike '%' || p_expected_message || '%' then

    perform pg_temp._p9_quote_terms_record(

      p_scenario_number,

      p_scenario_name,

      'PASS',

      coalesce(v_result.constraint_name, v_result.message_text, 'failed as expected')

    );

  else

    perform pg_temp._p9_quote_terms_record(

      p_scenario_number,

      p_scenario_name,

      'SUT_FAIL',

      'unexpected failure: ' || coalesce(v_result.message_text, '<null>') ||

      ' [constraint=' || coalesce(v_result.constraint_name, '<null>') || ']'

    );

  end if;

end;

$function$;

create or replace function pg_temp._p9_quote_terms_components_service(

  p_user_id uuid,

  p_name text default 'Servico autorizado',

  p_description text default 'Descricao do servico',

  p_quantity integer default 2,

  p_unit_price_cents integer default 1500,

  p_origin_component_id uuid default null

)

returns jsonb

language sql

as $function$

  select pg_catalog.jsonb_build_array(

    pg_catalog.jsonb_build_object(

      'component_key', 'service_authorized',

      'component_kind', 'service',

      'component_state', 'resolved',

      'reference_text', 'servico definido manualmente',

      'quote_item_name', p_name,

      'quote_item_description', p_description,

      'quote_item_quantity', p_quantity,

      'quote_item_unit_price_cents', p_unit_price_cents,

      'quote_terms_authority_type', 'human',

      'quote_terms_authority_user_id', p_user_id,

      'quote_terms_origin_component_id', p_origin_component_id

    )

  );

$function$;

create or replace function pg_temp._p9_quote_terms_components_custom(

  p_user_id uuid,

  p_name text default 'Item custom autorizado',

  p_description text default 'Descricao custom',

  p_quantity integer default 3,

  p_unit_price_cents integer default 700,

  p_origin_component_id uuid default null

)

returns jsonb

language sql

as $function$

  select pg_catalog.jsonb_build_array(

    pg_catalog.jsonb_build_object(

      'component_key', 'custom_authorized',

      'component_kind', 'custom',

      'component_state', 'resolved',

      'reference_text', 'custom definido manualmente',

      'quote_item_name', p_name,

      'quote_item_description', p_description,

      'quote_item_quantity', p_quantity,

      'quote_item_unit_price_cents', p_unit_price_cents,

      'quote_terms_authority_type', 'human',

      'quote_terms_authority_user_id', p_user_id,

      'quote_terms_origin_component_id', p_origin_component_id

    )

  );

$function$;

create or replace function pg_temp._p9_quote_terms_empty_intents()

returns jsonb

language sql

immutable

as $function$

  select '[]'::jsonb;

$function$;

create or replace function pg_temp._p9_quote_terms_create_quote(

  p_organization_id uuid,

  p_store_id uuid,

  p_customer_id uuid,

  p_quote_number text,

  p_title text

)

returns table (

  opportunity_id uuid,

  quote_id uuid

)

language plpgsql

as $function$

begin

  opportunity_id := gen_random_uuid();

  quote_id := gen_random_uuid();

  insert into public.commercial_opportunities (

    id, organization_id, store_id, customer_id, stage

  ) values (

    opportunity_id, p_organization_id, p_store_id, p_customer_id, 'orcamento'

  );

  insert into public.sales_quotes (

    id, organization_id, store_id, commercial_opportunity_id,

    conversation_id, lead_id, quote_number, title, status,

    customer_name, customer_phone, customer_notes, internal_notes,

    subtotal_cents, discount_cents, total_cents, current_version_id, metadata

  ) values (

    quote_id, p_organization_id, p_store_id, opportunity_id,

    null, null, p_quote_number, p_title, 'draft',

    p_title, null, null, null,

    0, 0, 0, null, '{}'::jsonb

  );

  return next;

end;

$function$;

do $fixtures$

declare

  ctx pg_temp._p9_quote_terms_ctx%rowtype;

begin

  select * into ctx from pg_temp._p9_quote_terms_ctx where singleton;

  insert into auth.users(id)

  values (ctx.user_a), (ctx.user_b);

  insert into public.organizations (id, name, subscription_status)

  values

    (ctx.org_a, 'P9 Quote Terms Org A', 'active'),

    (ctx.org_b, 'P9 Quote Terms Org B', 'active');

  insert into public.stores (id, organization_id, name)

  values

    (ctx.store_a, ctx.org_a, 'P9 Quote Terms Store A'),

    (ctx.store_b, ctx.org_b, 'P9 Quote Terms Store B');

  insert into public.memberships (organization_id, user_id, role, is_active)

  values

    (ctx.org_a, ctx.user_a, 'admin', true),

    (ctx.org_b, ctx.user_b, 'admin', true);

  insert into public.customers (id, organization_id, display_name)

  values

    (ctx.customer_a, ctx.org_a, 'P9 Quote Terms Customer A'),

    (ctx.customer_b, ctx.org_b, 'P9 Quote Terms Customer B');

  insert into public.commercial_opportunities (id, organization_id, store_id, customer_id, stage)

  values

    (ctx.opp_service, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'),

    (ctx.opp_custom, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'),

    (ctx.opp_mix, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'),

    (ctx.opp_atomic, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'),

    (ctx.opp_catalog_service, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento');

  insert into public.pools (

    id, organization_id, store_id, name, width_m, length_m, depth_m,

    shape, material, max_capacity_l, weight_kg, price, price_status,

    description, is_active, track_stock, stock_quantity, stock_status

  ) values (

    ctx.pool_a, ctx.org_a, ctx.store_a, 'Quote Terms Pool A',

    2, 3, 1, 'retangular', 'fibra', 1000, 120, 1234.56, 'valid',

    'Pool valid quote terms', true, false, null, 'not_tracked'

  );

  insert into public.store_catalog_items (

    id, organization_id, store_id, sku, name, description, price_cents,

    price_status, currency, is_active, track_stock, stock_quantity,

    stock_status, metadata

  ) values

    (ctx.catalog_a, ctx.org_a, ctx.store_a, 'QT-A', 'Catalog A', 'Catalog valid', 2500, 'valid', 'BRL', true, false, null, 'not_tracked', '{}'::jsonb),

    (ctx.catalog_service, ctx.org_a, ctx.store_a, 'QT-SVC', 'Servico no catalogo', 'Catalog-backed service', 9900, 'valid', 'BRL', true, false, null, 'not_tracked', '{"kind":"service"}'::jsonb),

    (ctx.catalog_no_price, ctx.org_a, ctx.store_a, 'QT-NP', 'Catalog sem preco', 'Catalog invalid', null, 'missing', 'BRL', true, false, null, 'not_tracked', '{}'::jsonb);

  insert into public.sales_quotes (

    id, organization_id, store_id, commercial_opportunity_id,

    conversation_id, lead_id, quote_number, title, status,

    customer_name, customer_phone, customer_notes, internal_notes,

    subtotal_cents, discount_cents, total_cents, current_version_id, metadata

  ) values

    (ctx.quote_service, ctx.org_a, ctx.store_a, ctx.opp_service, null, null, 'QT-SVC', 'Service', 'draft', 'Service', null, null, null, 0, 0, 0, null, '{}'::jsonb),

    (ctx.quote_custom, ctx.org_a, ctx.store_a, ctx.opp_custom, null, null, 'QT-CUS', 'Custom', 'draft', 'Custom', null, null, null, 0, 0, 0, null, '{}'::jsonb),

    (ctx.quote_mix, ctx.org_a, ctx.store_a, ctx.opp_mix, null, null, 'QT-MIX', 'Mix', 'draft', 'Mix', null, null, null, 0, 0, 0, null, '{}'::jsonb),

    (ctx.quote_atomic, ctx.org_a, ctx.store_a, ctx.opp_atomic, null, null, 'QT-AT', 'Atomic', 'draft', 'Atomic', null, null, null, 0, 0, 0, null, '{}'::jsonb),

    (ctx.quote_catalog_service, ctx.org_a, ctx.store_a, ctx.opp_catalog_service, null, null, 'QT-CAT-SVC', 'Catalog Service', 'draft', 'Catalog Service', null, null, null, 0, 0, 0, null, '{}'::jsonb);

end;

$fixtures$;

do $scenarios$

declare

  ctx pg_temp._p9_quote_terms_ctx%rowtype;

  r record;

  q text;

  v_service_origin uuid;

  v_custom_origin uuid;

  v_service_price integer;

  v_custom_price integer;

  v_service_name text;

  v_items integer;

  v_before_item_id uuid;

  v_after_item_id uuid;

  v_before_total integer;

  v_after_total integer;

  v_version uuid;

  v_zero_items integer;

  v_ok boolean;

  v_service_origin_v1 uuid;

  v_function_def text;

  v_constraint_def text;

  v_opp_id uuid;

  v_quote_id uuid;

  v_pool_id uuid;

  v_item_quantity integer;

  v_unit_price_cents integer;

  v_discount_cents integer;

  v_subtotal_cents integer;

  v_total_cents integer;

  v_materializer_version integer;

begin

  select * into ctx from pg_temp._p9_quote_terms_ctx where singleton;

  select exists (

    select 1

    from pg_catalog.pg_constraint

    where conrelid = 'public.commercial_opportunity_profile_components'::pg_catalog.regclass

      and conname in (

        'p9_profile_components_quote_terms_text_chk',

        'p9_profile_components_quote_terms_kind_shape_chk'

      )

      and convalidated is false

  )

  into v_ok;

  perform pg_temp._p9_quote_terms_record(1, 'historical rows remain possible because new checks are NOT VALID', case when v_ok then 'PASS' else 'SUT_FAIL' end, v_ok::text);

  q := pg_catalog.format(

    $sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'pool-terms-forbidden',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_service, repeat('1',64),

    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(

      'component_key','pool_with_terms','component_kind','pool','component_state','resolved',

      'pool_id',ctx.pool_a,'quote_item_name','Nao pode'

    ))::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  perform pg_temp._p9_quote_terms_expect_fail(2, 'pool/catalog reject quote terms', 'authenticated', ctx.user_a, q, 'QUOTE_TERMS_NOT_ALLOWED_FOR_CATALOG_SOURCE');

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'service-no-terms',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_service, repeat('2',64),

    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('component_key','svc','component_kind','service','component_state','resolved','reference_text','Servico'))::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  perform pg_temp._p9_quote_terms_expect_fail(3, 'service resolved without terms fails', 'authenticated', ctx.user_a, q, 'QUOTE_TERMS_REQUIRED_FOR_TEXT_COMPONENT');

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'custom-no-terms',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_custom, repeat('3',64),

    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('component_key','cus','component_kind','custom','component_state','resolved','reference_text','Custom'))::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  perform pg_temp._p9_quote_terms_expect_fail(4, 'custom resolved without terms fails', 'authenticated', ctx.user_a, q, 'QUOTE_TERMS_REQUIRED_FOR_TEXT_COMPONENT');

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'service-empty-name',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_service, repeat('4',64),

    pg_temp._p9_quote_terms_components_service(ctx.user_a, '   ', 'desc', 1, 1)::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  perform pg_temp._p9_quote_terms_expect_fail(5, 'service empty name fails', 'authenticated', ctx.user_a, q, 'QUOTE_TERMS_REQUIRED_FOR_TEXT_COMPONENT');

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'custom-empty-name',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_custom, repeat('5',64),

    pg_temp._p9_quote_terms_components_custom(ctx.user_a, '   ', 'desc', 1, 1)::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  perform pg_temp._p9_quote_terms_expect_fail(6, 'custom empty name fails', 'authenticated', ctx.user_a, q, 'QUOTE_TERMS_REQUIRED_FOR_TEXT_COMPONENT');

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'quantity-zero',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_service, repeat('6',64),

    pg_temp._p9_quote_terms_components_service(ctx.user_a, 'Svc', 'desc', 0, 1)::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  perform pg_temp._p9_quote_terms_expect_fail(7, 'quantity <= 0 fails', 'authenticated', ctx.user_a, q, 'QUOTE_TERMS_REQUIRED_FOR_TEXT_COMPONENT');

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'negative-price',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_custom, repeat('7',64),

    pg_temp._p9_quote_terms_components_custom(ctx.user_a, 'Custom', 'desc', 1, -1)::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  perform pg_temp._p9_quote_terms_expect_fail(8, 'unit_price_cents < 0 fails', 'authenticated', ctx.user_a, q, 'QUOTE_TERMS_REQUIRED_FOR_TEXT_COMPONENT');

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'service-human-v1',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_service, repeat('8',64),

    pg_temp._p9_quote_terms_components_service(ctx.user_a, 'Servico humano', 'Descricao humana', 2, 1500)::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  select * into r from pg_temp._p9_quote_terms_exec_json('authenticated', ctx.user_a, q);

  perform pg_temp._p9_quote_terms_record(9, 'human writer creates valid service', case when r.operation_succeeded then 'PASS' else 'SUT_FAIL' end, coalesce(r.message_text, r.value_json::text));

  select component_row.id

  into v_service_origin

  from public.commercial_opportunity_profile_components component_row

  join public.commercial_opportunity_profile_versions version_row

    on version_row.id = component_row.profile_version_id

  where version_row.operation_key = 'service-human-v1';

  v_service_origin_v1 := v_service_origin;

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'custom-human-v1',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_custom, repeat('9',64),

    pg_temp._p9_quote_terms_components_custom(ctx.user_a, 'Custom humano', 'Descricao custom', 3, 700)::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  select * into r from pg_temp._p9_quote_terms_exec_json('authenticated', ctx.user_a, q);

  perform pg_temp._p9_quote_terms_record(10, 'human writer creates valid custom', case when r.operation_succeeded then 'PASS' else 'SUT_FAIL' end, coalesce(r.message_text, r.value_json::text));

  select component_row.id

  into v_custom_origin

  from public.commercial_opportunity_profile_components component_row

  join public.commercial_opportunity_profile_versions version_row

    on version_row.id = component_row.profile_version_id

  where version_row.operation_key = 'custom-human-v1';

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'authority-forged',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_service, repeat('a',64),

    pg_temp._p9_quote_terms_components_service(ctx.user_b, 'Forged', 'desc', 1, 1)::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  perform pg_temp._p9_quote_terms_expect_fail(11, 'authority_user_id cannot be forged', 'authenticated', ctx.user_a, q, 'HUMAN_AUTHORITY_FORGED');

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'system-service-new-price',%L,'resolved',%L::jsonb,%L::jsonb,'qualification_materializer','manual_check','sales_ai','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_service, repeat('b',64),

    pg_temp._p9_quote_terms_components_service(ctx.user_a, 'System svc', 'desc', 1, 1)::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  perform pg_temp._p9_quote_terms_expect_fail(12, 'system writer does not create new service price', 'service_role', null, q, 'SYSTEM_ORIGIN_REQUIRED');

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'system-custom-new-price',%L,'resolved',%L::jsonb,%L::jsonb,'qualification_materializer','manual_check','sales_ai','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_custom, repeat('c',64),

    pg_temp._p9_quote_terms_components_custom(ctx.user_a, 'System custom', 'desc', 1, 1)::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  perform pg_temp._p9_quote_terms_expect_fail(13, 'system writer does not create new custom price', 'service_role', null, q, 'SYSTEM_ORIGIN_REQUIRED');

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'service-system-carry',%L,'resolved',%L::jsonb,%L::jsonb,'qualification_materializer','carry_forward','sales_ai','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_service, repeat('d',64),

    pg_temp._p9_quote_terms_components_service(ctx.user_a, 'Servico humano', 'Descricao humana', 2, 1500, v_service_origin)::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  select * into r from pg_temp._p9_quote_terms_exec_json('service_role', null, q);

  perform pg_temp._p9_quote_terms_record(14, 'system carry-forward preserves human service terms', case when r.operation_succeeded then 'PASS' else 'SUT_FAIL' end, coalesce(r.message_text, r.value_json::text));

  select component_row.id

  into v_service_origin

  from public.commercial_opportunity_profile_components component_row

  join public.commercial_opportunity_profile_versions version_row

    on version_row.id = component_row.profile_version_id

  where version_row.operation_key = 'service-system-carry';

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'service-system-price-change',%L,'resolved',%L::jsonb,%L::jsonb,'qualification_materializer','carry_forward','sales_ai','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_service, repeat('e',64),

    pg_temp._p9_quote_terms_components_service(ctx.user_a, 'Servico humano', 'Descricao humana', 2, 1501, v_service_origin)::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  perform pg_temp._p9_quote_terms_expect_fail(15, 'system cannot alter price during carry-forward', 'service_role', null, q, 'CARRY_FORWARD_MISMATCH');

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'service-system-quantity-change',%L,'resolved',%L::jsonb,%L::jsonb,'qualification_materializer','carry_forward','sales_ai','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_service, repeat('f',64),

    pg_temp._p9_quote_terms_components_service(ctx.user_a, 'Servico humano', 'Descricao humana', 3, 1500, v_service_origin)::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  perform pg_temp._p9_quote_terms_expect_fail(16, 'system cannot alter quantity during carry-forward', 'service_role', null, q, 'CARRY_FORWARD_MISMATCH');

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'service-system-name-change',%L,'resolved',%L::jsonb,%L::jsonb,'qualification_materializer','carry_forward','sales_ai','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_service, repeat('0',64),

    pg_temp._p9_quote_terms_components_service(ctx.user_a, 'Outro nome', 'Descricao humana', 2, 1500, v_service_origin)::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  perform pg_temp._p9_quote_terms_expect_fail(17, 'system cannot alter name or description during carry-forward', 'service_role', null, q, 'CARRY_FORWARD_MISMATCH');

  select quote_terms_origin_component_id = v_service_origin_v1

  into v_ok

  from public.commercial_opportunity_profile_components component_row

  join public.commercial_opportunity_profile_versions version_row

    on version_row.id = component_row.profile_version_id

  where version_row.operation_key = 'service-system-carry';

  perform pg_temp._p9_quote_terms_record(18, 'origin_component_id points to previous coherent component', case when v_ok then 'PASS' else 'SUT_FAIL' end, coalesce(v_ok::text, '<null>'));

  select * into r from pg_temp._p9_quote_terms_exec_json('service_role', null, pg_catalog.format(

    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',

    ctx.org_a, ctx.store_a, ctx.quote_service

  ));

  select unit_price_cents, name into v_service_price, v_service_name

  from public.sales_quote_items where quote_id = ctx.quote_service and item_type = 'service';

  perform pg_temp._p9_quote_terms_record(19, 'materializer creates service item correctly', case when r.operation_succeeded and v_service_price = 1500 and v_service_name = 'Servico humano' then 'PASS' else 'SUT_FAIL' end, coalesce(r.message_text, r.value_json::text));

  select * into r from pg_temp._p9_quote_terms_exec_json('service_role', null, pg_catalog.format(

    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',

    ctx.org_a, ctx.store_a, ctx.quote_custom

  ));

  select unit_price_cents into v_custom_price

  from public.sales_quote_items where quote_id = ctx.quote_custom and item_type = 'custom';

  perform pg_temp._p9_quote_terms_record(20, 'materializer creates custom item correctly', case when r.operation_succeeded and v_custom_price = 700 then 'PASS' else 'SUT_FAIL' end, coalesce(r.message_text, r.value_json::text));

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'mix-human-v1',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_mix, repeat('1a',32),

    pg_catalog.jsonb_build_array(

      pg_catalog.jsonb_build_object('component_key','pool','component_kind','pool','component_state','resolved','pool_id',ctx.pool_a),

      pg_catalog.jsonb_build_object('component_key','catalog','component_kind','catalog_item','component_state','resolved','catalog_item_id',ctx.catalog_a),

      pg_catalog.jsonb_build_object('component_key','service_authorized','component_kind','service','component_state','resolved','reference_text','svc','quote_item_name','Svc mix','quote_item_quantity',1,'quote_item_unit_price_cents',111,'quote_terms_authority_type','human','quote_terms_authority_user_id',ctx.user_a),

      pg_catalog.jsonb_build_object('component_key','custom_authorized','component_kind','custom','component_state','resolved','reference_text','cus','quote_item_name','Cus mix','quote_item_quantity',1,'quote_item_unit_price_cents',222,'quote_terms_authority_type','human','quote_terms_authority_user_id',ctx.user_a)

    )::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  select * into r from pg_temp._p9_quote_terms_exec_json('authenticated', ctx.user_a, q);

  select * into r from pg_temp._p9_quote_terms_exec_json('service_role', null, pg_catalog.format(

    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',

    ctx.org_a, ctx.store_a, ctx.quote_mix

  ));

  select count(*)::integer into v_items from public.sales_quote_items where quote_id = ctx.quote_mix and profile_component_id is not null;

  perform pg_temp._p9_quote_terms_record(21, 'materializer creates pool catalog service custom in one version', case when r.operation_succeeded and v_items = 4 then 'PASS' else 'SUT_FAIL' end, coalesce(r.message_text, r.value_json::text));

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'atomic-invalid-catalog',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_atomic, repeat('2a',32),

    pg_catalog.jsonb_build_array(

      pg_catalog.jsonb_build_object('component_key','service_authorized','component_kind','service','component_state','resolved','reference_text','svc','quote_item_name','Svc atomic','quote_item_quantity',1,'quote_item_unit_price_cents',111,'quote_terms_authority_type','human','quote_terms_authority_user_id',ctx.user_a),

      pg_catalog.jsonb_build_object('component_key','bad_catalog','component_kind','catalog_item','component_state','resolved','catalog_item_id',ctx.catalog_no_price)

    )::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  select * into r from pg_temp._p9_quote_terms_exec_json('authenticated', ctx.user_a, q);

  select * into r from pg_temp._p9_quote_terms_exec_json('service_role', null, pg_catalog.format(

    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',

    ctx.org_a, ctx.store_a, ctx.quote_atomic

  ));

  select count(*)::integer into v_zero_items from public.sales_quote_items where quote_id = ctx.quote_atomic;

  perform pg_temp._p9_quote_terms_record(22, 'error leaves zero partial materialization rows', case when not r.operation_succeeded and coalesce(r.message_text,'') ilike '%CATALOG_SOURCE_NOT_USABLE%' and v_zero_items = 0 then 'PASS' else 'SUT_FAIL' end, coalesce(r.message_text, '<null>') || ' rows=' || coalesce(v_zero_items::text,'<null>'));

  select id, total_cents

  into v_before_item_id, v_before_total

  from public.sales_quote_items

  where quote_id = ctx.quote_service and item_type = 'service';

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'service-human-v3',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_service, repeat('3a',32),

    pg_temp._p9_quote_terms_components_service(ctx.user_a, 'Servico alterado', 'Descricao nova', 5, 4000)::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  select * into r from pg_temp._p9_quote_terms_exec_json('authenticated', ctx.user_a, q);

  select * into r from pg_temp._p9_quote_terms_exec_json('service_role', null, pg_catalog.format(

    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',

    ctx.org_a, ctx.store_a, ctx.quote_service

  ));

  select id, total_cents

  into v_after_item_id, v_after_total

  from public.sales_quote_items

  where quote_id = ctx.quote_service and item_type = 'service';

  perform pg_temp._p9_quote_terms_record(23, 'replay of service preserves snapshot', case when r.operation_succeeded and r.value_json ->> 'outcome' = 'replay' and v_before_item_id = v_after_item_id and v_before_total = v_after_total then 'PASS' else 'SUT_FAIL' end, coalesce(r.message_text, r.value_json::text));

  select id, total_cents

  into v_before_item_id, v_before_total

  from public.sales_quote_items

  where quote_id = ctx.quote_custom and item_type = 'custom';

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'custom-human-v2',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_custom, repeat('4a',32),

    pg_temp._p9_quote_terms_components_custom(ctx.user_a, 'Custom alterado', 'Desc nova', 6, 9000)::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  select * into r from pg_temp._p9_quote_terms_exec_json('authenticated', ctx.user_a, q);

  select * into r from pg_temp._p9_quote_terms_exec_json('service_role', null, pg_catalog.format(

    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',

    ctx.org_a, ctx.store_a, ctx.quote_custom

  ));

  select id, total_cents

  into v_after_item_id, v_after_total

  from public.sales_quote_items

  where quote_id = ctx.quote_custom and item_type = 'custom';

  perform pg_temp._p9_quote_terms_record(24, 'replay of custom preserves snapshot', case when r.operation_succeeded and r.value_json ->> 'outcome' = 'replay' and v_before_item_id = v_after_item_id and v_before_total = v_after_total then 'PASS' else 'SUT_FAIL' end, coalesce(r.message_text, r.value_json::text));

  select component_row.profile_version_id

  into v_version

  from public.sales_quote_items item_row

  join public.commercial_opportunity_profile_components component_row

    on component_row.id = item_row.profile_component_id

  where item_row.quote_id = ctx.quote_service

  limit 1;

  perform pg_temp._p9_quote_terms_record(25, 'current profile changes do not alter old quote version lineage', case when v_version is not null and v_version <> (select current_profile_version_id from public.commercial_opportunity_profile_current where commercial_opportunity_id = ctx.opp_service) then 'PASS' else 'SUT_FAIL' end, coalesce(v_version::text, '<null>'));

  perform pg_temp._p9_quote_terms_expect_fail(

    26,

    'tenant store opportunity mismatch fails closed',

    'service_role',

    null,

    pg_catalog.format(

      'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',

      ctx.org_b, ctx.store_b, ctx.quote_service

    ),

    'QUOTE_NOT_FOUND'

  );

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'metadata-only',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_service, repeat('5a',32),

    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('component_key','svc','component_kind','service','component_state','resolved','reference_text','Servico','metadata',pg_catalog.jsonb_build_object('quote_item_unit_price_cents',1234)))::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  perform pg_temp._p9_quote_terms_expect_fail(27, 'metadata alone does not authorize price', 'authenticated', ctx.user_a, q, 'QUOTE_TERMS_REQUIRED_FOR_TEXT_COMPONENT');

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'service-with-pool',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_service, repeat('6a',32),

    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('component_key','svc','component_kind','service','component_state','resolved','reference_text','Servico','pool_id',ctx.pool_a,'quote_item_name','Svc','quote_item_quantity',1,'quote_item_unit_price_cents',100,'quote_terms_authority_type','human','quote_terms_authority_user_id',ctx.user_a))::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  perform pg_temp._p9_quote_terms_expect_fail(28, 'service/custom with pool or catalog ref rejected', 'authenticated', ctx.user_a, q, 'POOL_KIND_MISMATCH');

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'catalog-service-v1',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,

    ctx.org_a, ctx.store_a, ctx.opp_catalog_service, repeat('7a',32),

    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('component_key','catalog_service','component_kind','catalog_item','component_state','resolved','catalog_item_id',ctx.catalog_service))::text,

    pg_temp._p9_quote_terms_empty_intents()::text

  );

  select * into r from pg_temp._p9_quote_terms_exec_json('authenticated', ctx.user_a, q);

  select * into r from pg_temp._p9_quote_terms_exec_json('service_role', null, pg_catalog.format(

    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',

    ctx.org_a, ctx.store_a, ctx.quote_catalog_service

  ));

  select exists(select 1 from public.sales_quote_items where quote_id = ctx.quote_catalog_service and item_type = 'catalog_item' and catalog_item_id = ctx.catalog_service)

  into v_ok;

  perform pg_temp._p9_quote_terms_record(29, 'catalog-backed service remains catalog_item', case when r.operation_succeeded and v_ok then 'PASS' else 'SUT_FAIL' end, coalesce(r.message_text, r.value_json::text));

  select

    pg_catalog.has_function_privilege('service_role', 'public.materialize_sales_quote_items_from_current_profile_by_system(uuid,uuid,uuid)', 'EXECUTE')

    and not pg_catalog.has_function_privilege('authenticated', 'public.materialize_sales_quote_items_from_current_profile_by_system(uuid,uuid,uuid)', 'EXECUTE')

    and pg_catalog.has_function_privilege('service_role', 'public.write_commercial_opportunity_profile_by_system(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,jsonb)', 'EXECUTE')

    and pg_catalog.has_function_privilege('authenticated', 'public.write_commercial_opportunity_profile_by_user(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,jsonb)', 'EXECUTE')

  into v_ok;

  perform pg_temp._p9_quote_terms_record(30, 'grants and service_role materializer contract are correct', case when v_ok then 'PASS' else 'SUT_FAIL' end, v_ok::text);

  select pg_catalog.pg_get_functiondef(
    'public.write_commercial_opportunity_profile_internal(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,uuid,text,text,text,jsonb)'::pg_catalog.regprocedure
  )
  into v_function_def;

  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
  into v_constraint_def
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.commercial_opportunity_profile_components'::pg_catalog.regclass
    and constraint_row.conname = 'p9_profile_components_quote_terms_origin_kind_scope_fk';

  v_ok :=
    position('SET search_path TO ''pg_catalog'', ''public'', ''pg_temp''' in coalesce(v_function_def, '')) > 0
    and position('ZION_OPPORTUNITY_PROFILE_IDEMPOTENCY_KEY_REUSED' in coalesce(v_function_def, '')) > 0
    and position('ZION_OPPORTUNITY_PROFILE_QUOTE_TERMS_REQUIRED_FOR_TEXT_COMPONENT' in coalesce(v_function_def, ''))
        > position('ZION_OPPORTUNITY_PROFILE_IDEMPOTENCY_KEY_REUSED' in coalesce(v_function_def, ''))
    and coalesce(v_constraint_def, '') like
        '%quote_terms_origin_component_id, organization_id, store_id, commercial_opportunity_id, component_kind%'
    and pg_catalog.to_regclass('public.p9_profile_components_quote_terms_origin_scope_uidx') is null;

  perform pg_temp._p9_quote_terms_record(
    31,
    'writer preserves historical exact replay ordering and hardened same-kind carry-forward lineage',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    pg_catalog.format(
      'search_path/replay_order/origin_fk=%s constraint=%s',
      v_ok,
      coalesce(v_constraint_def, '<null>')
    )
  );

  select created.opportunity_id, created.quote_id
  into v_opp_id, v_quote_id
  from pg_temp._p9_quote_terms_create_quote(ctx.org_a, ctx.store_a, ctx.customer_a, 'QT-MONEY-POOL-NORMAL', 'Money Pool Normal') as created;

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'money-pool-normal',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,
    ctx.org_a, ctx.store_a, v_opp_id, repeat('20',32),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('component_key','pool_money_normal','component_kind','pool','component_state','resolved','pool_id',ctx.pool_a))::text,
    pg_temp._p9_quote_terms_empty_intents()::text
  );

  select * into r from pg_temp._p9_quote_terms_exec_json('authenticated', ctx.user_a, q);

  select * into r from pg_temp._p9_quote_terms_exec_json('service_role', null, pg_catalog.format(
    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
    ctx.org_a, ctx.store_a, v_quote_id
  ));

  v_item_quantity := null; v_unit_price_cents := null; v_discount_cents := null; v_subtotal_cents := null; v_total_cents := null; v_materializer_version := null;
  select quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents, nullif(metadata ->> 'materializer_version', '')::integer
  into v_item_quantity, v_unit_price_cents, v_discount_cents, v_subtotal_cents, v_total_cents, v_materializer_version
  from public.sales_quote_items where quote_id = v_quote_id and item_type = 'pool';

  perform pg_temp._p9_quote_terms_record(32, 'materializer keeps normal pool money coherent', case when r.operation_succeeded and v_item_quantity = 1 and v_unit_price_cents = 123456 and v_discount_cents = 0 and v_subtotal_cents = 123456 and v_total_cents = 123456 and v_materializer_version = 3 then 'PASS' else 'SUT_FAIL' end, pg_catalog.format('result=%s q=%s unit=%s discount=%s subtotal=%s total=%s version=%s', coalesce(r.message_text, r.value_json::text), v_item_quantity, v_unit_price_cents, v_discount_cents, v_subtotal_cents, v_total_cents, v_materializer_version));

  v_pool_id := gen_random_uuid();
  insert into public.pools (
    id, organization_id, store_id, name, width_m, length_m, depth_m,
    shape, material, max_capacity_l, weight_kg, price, price_status,
    description, is_active, track_stock, stock_quantity, stock_status
  ) values (
    v_pool_id, ctx.org_a, ctx.store_a, 'Quote Terms Pool Zero',
    2, 3, 1, 'retangular', 'fibra', 1000, 120, 0, 'valid',
    'Pool zero quote terms', true, false, null, 'not_tracked'
  );

  select created.opportunity_id, created.quote_id
  into v_opp_id, v_quote_id
  from pg_temp._p9_quote_terms_create_quote(ctx.org_a, ctx.store_a, ctx.customer_a, 'QT-MONEY-POOL-ZERO', 'Money Pool Zero') as created;

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'money-pool-zero',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,
    ctx.org_a, ctx.store_a, v_opp_id, repeat('21',32),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('component_key','pool_money_zero','component_kind','pool','component_state','resolved','pool_id',v_pool_id))::text,
    pg_temp._p9_quote_terms_empty_intents()::text
  );

  select * into r from pg_temp._p9_quote_terms_exec_json('authenticated', ctx.user_a, q);

  select * into r from pg_temp._p9_quote_terms_exec_json('service_role', null, pg_catalog.format(
    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
    ctx.org_a, ctx.store_a, v_quote_id
  ));

  v_item_quantity := null; v_unit_price_cents := null; v_discount_cents := null; v_subtotal_cents := null; v_total_cents := null;
  select quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents
  into v_item_quantity, v_unit_price_cents, v_discount_cents, v_subtotal_cents, v_total_cents
  from public.sales_quote_items where quote_id = v_quote_id and item_type = 'pool';

  perform pg_temp._p9_quote_terms_record(33, 'materializer permits zero pool money without clamp', case when r.operation_succeeded and v_item_quantity = 1 and v_unit_price_cents = 0 and v_discount_cents = 0 and v_subtotal_cents = 0 and v_total_cents = 0 then 'PASS' else 'SUT_FAIL' end, pg_catalog.format('result=%s q=%s unit=%s discount=%s subtotal=%s total=%s', coalesce(r.message_text, r.value_json::text), v_item_quantity, v_unit_price_cents, v_discount_cents, v_subtotal_cents, v_total_cents));

  v_pool_id := gen_random_uuid();
  insert into public.pools (
    id, organization_id, store_id, name, width_m, length_m, depth_m,
    shape, material, max_capacity_l, weight_kg, price, price_status,
    description, is_active, track_stock, stock_quantity, stock_status
  ) values (
    v_pool_id, ctx.org_a, ctx.store_a, 'Quote Terms Pool Int4 Limit',
    2, 3, 1, 'retangular', 'fibra', 1000, 120, 21474836.47, 'valid',
    'Pool int4 limit quote terms', true, false, null, 'not_tracked'
  );

  select created.opportunity_id, created.quote_id
  into v_opp_id, v_quote_id
  from pg_temp._p9_quote_terms_create_quote(ctx.org_a, ctx.store_a, ctx.customer_a, 'QT-MONEY-POOL-LIMIT', 'Money Pool Limit') as created;

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'money-pool-limit',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,
    ctx.org_a, ctx.store_a, v_opp_id, repeat('22',32),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('component_key','pool_money_limit','component_kind','pool','component_state','resolved','pool_id',v_pool_id))::text,
    pg_temp._p9_quote_terms_empty_intents()::text
  );

  select * into r from pg_temp._p9_quote_terms_exec_json('authenticated', ctx.user_a, q);

  select * into r from pg_temp._p9_quote_terms_exec_json('service_role', null, pg_catalog.format(
    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
    ctx.org_a, ctx.store_a, v_quote_id
  ));

  v_item_quantity := null; v_unit_price_cents := null; v_discount_cents := null; v_subtotal_cents := null; v_total_cents := null;
  select quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents
  into v_item_quantity, v_unit_price_cents, v_discount_cents, v_subtotal_cents, v_total_cents
  from public.sales_quote_items where quote_id = v_quote_id and item_type = 'pool';

  perform pg_temp._p9_quote_terms_record(34, 'materializer permits largest pool cents value fitting int4', case when r.operation_succeeded and v_item_quantity = 1 and v_unit_price_cents = 2147483647 and v_discount_cents = 0 and v_subtotal_cents = 2147483647 and v_total_cents = 2147483647 then 'PASS' else 'SUT_FAIL' end, pg_catalog.format('result=%s q=%s unit=%s discount=%s subtotal=%s total=%s', coalesce(r.message_text, r.value_json::text), v_item_quantity, v_unit_price_cents, v_discount_cents, v_subtotal_cents, v_total_cents));

  v_pool_id := gen_random_uuid();
  insert into public.pools (
    id, organization_id, store_id, name, width_m, length_m, depth_m,
    shape, material, max_capacity_l, weight_kg, price, price_status,
    description, is_active, track_stock, stock_quantity, stock_status
  ) values (
    v_pool_id, ctx.org_a, ctx.store_a, 'Quote Terms Pool Overflow',
    2, 3, 1, 'retangular', 'fibra', 1000, 120, 21474836.48, 'valid',
    'Pool overflow quote terms', true, false, null, 'not_tracked'
  );

  select created.opportunity_id, created.quote_id
  into v_opp_id, v_quote_id
  from pg_temp._p9_quote_terms_create_quote(ctx.org_a, ctx.store_a, ctx.customer_a, 'QT-MONEY-POOL-OVERFLOW', 'Money Pool Overflow') as created;

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'money-pool-overflow',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,
    ctx.org_a, ctx.store_a, v_opp_id, repeat('23',32),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('component_key','pool_money_overflow','component_kind','pool','component_state','resolved','pool_id',v_pool_id))::text,
    pg_temp._p9_quote_terms_empty_intents()::text
  );

  select * into r from pg_temp._p9_quote_terms_exec_json('authenticated', ctx.user_a, q);

  select * into r from pg_temp._p9_quote_terms_exec_json('service_role', null, pg_catalog.format(
    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
    ctx.org_a, ctx.store_a, v_quote_id
  ));

  select count(*)::integer into v_zero_items from public.sales_quote_items where quote_id = v_quote_id;

  perform pg_temp._p9_quote_terms_record(35, 'materializer rejects pool cents overflow deterministically', case when not r.operation_succeeded and coalesce(r.message_text,'') ilike '%MONEY_OUT_OF_RANGE%' and v_zero_items = 0 then 'PASS' else 'SUT_FAIL' end, coalesce(r.message_text, '<null>') || ' rows=' || coalesce(v_zero_items::text,'<null>'));

  select created.opportunity_id, created.quote_id
  into v_opp_id, v_quote_id
  from pg_temp._p9_quote_terms_create_quote(ctx.org_a, ctx.store_a, ctx.customer_a, 'QT-MONEY-CATALOG', 'Money Catalog') as created;

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'money-catalog-valid',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,
    ctx.org_a, ctx.store_a, v_opp_id, repeat('24',32),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('component_key','catalog_money_valid','component_kind','catalog_item','component_state','resolved','catalog_item_id',ctx.catalog_a))::text,
    pg_temp._p9_quote_terms_empty_intents()::text
  );

  select * into r from pg_temp._p9_quote_terms_exec_json('authenticated', ctx.user_a, q);

  select * into r from pg_temp._p9_quote_terms_exec_json('service_role', null, pg_catalog.format(
    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
    ctx.org_a, ctx.store_a, v_quote_id
  ));

  v_item_quantity := null; v_unit_price_cents := null; v_discount_cents := null; v_subtotal_cents := null; v_total_cents := null;
  select quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents
  into v_item_quantity, v_unit_price_cents, v_discount_cents, v_subtotal_cents, v_total_cents
  from public.sales_quote_items where quote_id = v_quote_id and item_type = 'catalog_item';

  perform pg_temp._p9_quote_terms_record(36, 'materializer preserves valid nonnegative catalog price_cents', case when r.operation_succeeded and v_item_quantity = 1 and v_unit_price_cents = 2500 and v_discount_cents = 0 and v_subtotal_cents = 2500 and v_total_cents = 2500 then 'PASS' else 'SUT_FAIL' end, pg_catalog.format('result=%s q=%s unit=%s discount=%s subtotal=%s total=%s', coalesce(r.message_text, r.value_json::text), v_item_quantity, v_unit_price_cents, v_discount_cents, v_subtotal_cents, v_total_cents));

  select created.opportunity_id, created.quote_id
  into v_opp_id, v_quote_id
  from pg_temp._p9_quote_terms_create_quote(ctx.org_a, ctx.store_a, ctx.customer_a, 'QT-MONEY-SERVICE-NORMAL', 'Money Service Normal') as created;

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'money-service-normal',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,
    ctx.org_a, ctx.store_a, v_opp_id, repeat('25',32),
    pg_temp._p9_quote_terms_components_service(ctx.user_a, 'Svc money normal', 'desc', 3, 10000)::text,
    pg_temp._p9_quote_terms_empty_intents()::text
  );

  select * into r from pg_temp._p9_quote_terms_exec_json('authenticated', ctx.user_a, q);

  select * into r from pg_temp._p9_quote_terms_exec_json('service_role', null, pg_catalog.format(
    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
    ctx.org_a, ctx.store_a, v_quote_id
  ));

  v_item_quantity := null; v_unit_price_cents := null; v_discount_cents := null; v_subtotal_cents := null; v_total_cents := null;
  select quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents
  into v_item_quantity, v_unit_price_cents, v_discount_cents, v_subtotal_cents, v_total_cents
  from public.sales_quote_items where quote_id = v_quote_id and item_type = 'service';

  perform pg_temp._p9_quote_terms_record(37, 'materializer computes service subtotal from quantity times unit price', case when r.operation_succeeded and v_item_quantity = 3 and v_unit_price_cents = 10000 and v_discount_cents = 0 and v_subtotal_cents = 30000 and v_total_cents = 30000 then 'PASS' else 'SUT_FAIL' end, pg_catalog.format('result=%s q=%s unit=%s discount=%s subtotal=%s total=%s', coalesce(r.message_text, r.value_json::text), v_item_quantity, v_unit_price_cents, v_discount_cents, v_subtotal_cents, v_total_cents));

  select created.opportunity_id, created.quote_id
  into v_opp_id, v_quote_id
  from pg_temp._p9_quote_terms_create_quote(ctx.org_a, ctx.store_a, ctx.customer_a, 'QT-MONEY-SERVICE-LIMIT', 'Money Service Limit') as created;

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'money-service-limit',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,
    ctx.org_a, ctx.store_a, v_opp_id, repeat('26',32),
    pg_temp._p9_quote_terms_components_service(ctx.user_a, 'Svc money limit', 'desc', 1, 2147483647)::text,
    pg_temp._p9_quote_terms_empty_intents()::text
  );

  select * into r from pg_temp._p9_quote_terms_exec_json('authenticated', ctx.user_a, q);

  select * into r from pg_temp._p9_quote_terms_exec_json('service_role', null, pg_catalog.format(
    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
    ctx.org_a, ctx.store_a, v_quote_id
  ));

  v_item_quantity := null; v_unit_price_cents := null; v_discount_cents := null; v_subtotal_cents := null; v_total_cents := null;
  select quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents
  into v_item_quantity, v_unit_price_cents, v_discount_cents, v_subtotal_cents, v_total_cents
  from public.sales_quote_items where quote_id = v_quote_id and item_type = 'service';

  perform pg_temp._p9_quote_terms_record(38, 'materializer permits service subtotal at int4 limit', case when r.operation_succeeded and v_item_quantity = 1 and v_unit_price_cents = 2147483647 and v_discount_cents = 0 and v_subtotal_cents = 2147483647 and v_total_cents = 2147483647 then 'PASS' else 'SUT_FAIL' end, pg_catalog.format('result=%s q=%s unit=%s discount=%s subtotal=%s total=%s', coalesce(r.message_text, r.value_json::text), v_item_quantity, v_unit_price_cents, v_discount_cents, v_subtotal_cents, v_total_cents));

  select created.opportunity_id, created.quote_id
  into v_opp_id, v_quote_id
  from pg_temp._p9_quote_terms_create_quote(ctx.org_a, ctx.store_a, ctx.customer_a, 'QT-MONEY-SERVICE-OVERFLOW', 'Money Service Overflow') as created;

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'money-service-overflow',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,
    ctx.org_a, ctx.store_a, v_opp_id, repeat('27',32),
    pg_temp._p9_quote_terms_components_service(ctx.user_a, 'Svc money overflow', 'desc', 2, 1073741824)::text,
    pg_temp._p9_quote_terms_empty_intents()::text
  );

  select * into r from pg_temp._p9_quote_terms_exec_json('authenticated', ctx.user_a, q);

  select * into r from pg_temp._p9_quote_terms_exec_json('service_role', null, pg_catalog.format(
    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
    ctx.org_a, ctx.store_a, v_quote_id
  ));

  select count(*)::integer into v_zero_items from public.sales_quote_items where quote_id = v_quote_id;

  perform pg_temp._p9_quote_terms_record(39, 'materializer rejects service subtotal overflow deterministically', case when not r.operation_succeeded and coalesce(r.message_text,'') ilike '%MONEY_OUT_OF_RANGE%' and v_zero_items = 0 then 'PASS' else 'SUT_FAIL' end, coalesce(r.message_text, '<null>') || ' rows=' || coalesce(v_zero_items::text,'<null>'));

  select created.opportunity_id, created.quote_id
  into v_opp_id, v_quote_id
  from pg_temp._p9_quote_terms_create_quote(ctx.org_a, ctx.store_a, ctx.customer_a, 'QT-MONEY-CUSTOM-NORMAL', 'Money Custom Normal') as created;

  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'money-custom-normal',%L,'resolved',%L::jsonb,%L::jsonb,'manual_check','{}'::jsonb)$sql$,
    ctx.org_a, ctx.store_a, v_opp_id, repeat('28',32),
    pg_temp._p9_quote_terms_components_custom(ctx.user_a, 'Custom money normal', 'desc', 2, 222)::text,
    pg_temp._p9_quote_terms_empty_intents()::text
  );

  select * into r from pg_temp._p9_quote_terms_exec_json('authenticated', ctx.user_a, q);

  select * into r from pg_temp._p9_quote_terms_exec_json('service_role', null, pg_catalog.format(
    'select * from public.materialize_sales_quote_items_from_current_profile_by_system(%L::uuid,%L::uuid,%L::uuid)',
    ctx.org_a, ctx.store_a, v_quote_id
  ));

  v_item_quantity := null; v_unit_price_cents := null; v_discount_cents := null; v_subtotal_cents := null; v_total_cents := null;
  select quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents
  into v_item_quantity, v_unit_price_cents, v_discount_cents, v_subtotal_cents, v_total_cents
  from public.sales_quote_items where quote_id = v_quote_id and item_type = 'custom';

  perform pg_temp._p9_quote_terms_record(40, 'materializer computes custom subtotal from quantity times unit price', case when r.operation_succeeded and v_item_quantity = 2 and v_unit_price_cents = 222 and v_discount_cents = 0 and v_subtotal_cents = 444 and v_total_cents = 444 then 'PASS' else 'SUT_FAIL' end, pg_catalog.format('result=%s q=%s unit=%s discount=%s subtotal=%s total=%s', coalesce(r.message_text, r.value_json::text), v_item_quantity, v_unit_price_cents, v_discount_cents, v_subtotal_cents, v_total_cents));

exception when others then

  perform pg_temp._p9_quote_terms_record(999, 'runner uncaught error', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);

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

  from pg_temp._p9_quote_terms_results

  where scenario_number between 1 and 40;

  select count(*)

  into v_missing

  from generate_series(1, 40) as scenario_row(scenario_number)

  where not exists (

    select 1

    from pg_temp._p9_quote_terms_results result_row

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

    from pg_temp._p9_quote_terms_results result_row

    where result_row.status <> 'PASS'

       or result_row.scenario_number not between 1 and 40;

    raise exception using

      errcode = 'P0001',

      message = 'P9 6.1-B/6.2-C profile service/custom quote terms manual checks failed',

      detail = pg_catalog.format(

        'passed=%s failed=%s missing=%s%s%s',

        coalesce(v_passed, 0),

        coalesce(v_failed, 0),

        coalesce(v_missing, 0),

        E'\n',

        coalesce(v_detail, '<no failure rows>')

      );

  end if;

  raise notice 'P9 6.1-B/6.2-C profile service/custom quote terms manual checks passed: % scenarios', v_passed;

end;

$assertions$;

rollback;
