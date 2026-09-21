-- P9 6.2-C: keep Profile -> Sales Quote Items materialization aligned with
-- the canonical Sales Quotes money contract before int4 persistence.

create or replace function public.p9_sales_quote_assert_int4_cents_by_system(
  p_value numeric,
  p_error_message text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if p_value is null
     or p_value < 0
     or p_value > 2147483647
     or p_value <> pg_catalog.trunc(p_value) then
    raise exception using
      errcode = 'P0001',
      message = p_error_message;
  end if;

  return p_value::integer;
end;
$function$;

alter function public.p9_sales_quote_assert_int4_cents_by_system(numeric, text)
  owner to postgres;

comment on function public.p9_sales_quote_assert_int4_cents_by_system(
  numeric, text
) is
  'P9 6.2-C helper for deterministic int4 cents validation before sales_quote_items persistence.';

revoke all on function public.p9_sales_quote_assert_int4_cents_by_system(
  numeric, text
) from public, anon, authenticated, service_role;

create or replace function public.p9_sales_quote_item_subtotal_cents_by_system(
  p_quantity numeric,
  p_unit_price_cents integer,
  p_error_message text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if p_quantity is null
     or p_quantity <= 0
     or p_quantity <> pg_catalog.trunc(p_quantity)
     or p_unit_price_cents is null
     or p_unit_price_cents < 0 then
    raise exception using
      errcode = 'P0001',
      message = p_error_message;
  end if;

  return public.p9_sales_quote_assert_int4_cents_by_system(
    p_quantity * p_unit_price_cents,
    p_error_message
  );
end;
$function$;

alter function public.p9_sales_quote_item_subtotal_cents_by_system(
  numeric, integer, text
) owner to postgres;

comment on function public.p9_sales_quote_item_subtotal_cents_by_system(
  numeric, integer, text
) is
  'P9 6.2-C helper for deterministic service/custom line subtotal validation before sales_quote_items persistence.';

revoke all on function public.p9_sales_quote_item_subtotal_cents_by_system(
  numeric, integer, text
) from public, anon, authenticated, service_role;

do $migration$
declare
  v_function_def text;
  v_updated_def text;
  v_error_message constant text := 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_MONEY_OUT_OF_RANGE';
begin
  select pg_catalog.pg_get_functiondef(
    'public.materialize_sales_quote_items_from_current_profile_by_system(uuid,uuid,uuid)'::pg_catalog.regprocedure
  )
  into v_function_def;

  if v_function_def is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: sales quote profile materializer function missing';
  end if;

  if position('pg_catalog.round((pool_row.price)::numeric * 100)::integer' in v_function_def) = 0
     or position('then catalog_row.price_cents' in v_function_def) = 0
     or position('component_row.quote_item_quantity * component_row.quote_item_unit_price_cents' in v_function_def) = 0
     or position('materializer_version'', 2' in v_function_def) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: materializer 6.1-B money expressions not found';
  end if;

  v_updated_def := v_function_def;

  v_updated_def := pg_catalog.replace(
    v_updated_def,
    'pg_catalog.round((pool_row.price)::numeric * 100)::integer',
    pg_catalog.format(
      'public.p9_sales_quote_assert_int4_cents_by_system(pg_catalog.round((pool_row.price)::numeric * 100), %L)',
      v_error_message
    )
  );

  v_updated_def := pg_catalog.replace(
    v_updated_def,
    'then catalog_row.price_cents',
    pg_catalog.format(
      'then public.p9_sales_quote_assert_int4_cents_by_system(catalog_row.price_cents::numeric, %L)',
      v_error_message
    )
  );

  v_updated_def := pg_catalog.replace(
    v_updated_def,
    'component_row.quote_item_quantity * component_row.quote_item_unit_price_cents',
    pg_catalog.format(
      'public.p9_sales_quote_item_subtotal_cents_by_system(component_row.quote_item_quantity, component_row.quote_item_unit_price_cents, %L)',
      v_error_message
    )
  );

  v_updated_def := pg_catalog.replace(
    v_updated_def,
    'materializer_version'', 2',
    'materializer_version'', 3'
  );

  if v_updated_def = v_function_def then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: materializer definition was not changed';
  end if;

  execute v_updated_def;
end;
$migration$;

alter function public.materialize_sales_quote_items_from_current_profile_by_system(
  uuid, uuid, uuid
) owner to postgres;

comment on function public.materialize_sales_quote_items_from_current_profile_by_system(
  uuid, uuid, uuid
) is
  'P9 6.2-C service-role canonical quote-item materializer. It snapshots current Profile pool/catalog/service/custom components into sales_quote_items once, preserves replay snapshots, requires typed human-authorized quote terms for service/custom, and validates money values against int4 cents limits before persistence.';

revoke all on function public.materialize_sales_quote_items_from_current_profile_by_system(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.materialize_sales_quote_items_from_current_profile_by_system(
  uuid, uuid, uuid
) to service_role;

do $postcondition$
declare
  v_function_def text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.materialize_sales_quote_items_from_current_profile_by_system(uuid,uuid,uuid)'::pg_catalog.regprocedure
  )
  into v_function_def;

  if pg_catalog.to_regprocedure('public.p9_sales_quote_assert_int4_cents_by_system(numeric,text)') is null
     or pg_catalog.to_regprocedure('public.p9_sales_quote_item_subtotal_cents_by_system(numeric,integer,text)') is null
     or position('p9_sales_quote_assert_int4_cents_by_system' in v_function_def) = 0
     or position('p9_sales_quote_item_subtotal_cents_by_system' in v_function_def) = 0
     or position('ZION_SALES_QUOTE_PROFILE_MATERIALIZER_MONEY_OUT_OF_RANGE' in v_function_def) = 0
     or position('quote_item_quantity * component_row.quote_item_unit_price_cents' in v_function_def) > 0
     or position('pg_catalog.round((pool_row.price)::numeric * 100)::integer' in v_function_def) > 0
     or position('materializer_version'', 3' in v_function_def) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: materializer 6.2-C money guards missing';
  end if;
end;
$postcondition$;
