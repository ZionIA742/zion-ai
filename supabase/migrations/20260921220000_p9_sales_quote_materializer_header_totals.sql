-- P9 6.2-D: Profile -> Sales Quote Items materialization owns the quote
-- header totals that are derived from the persisted item snapshot.

create or replace function public.p9_sales_quote_sync_header_from_items_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_quote_id uuid,
  p_error_message text
)
returns table (
  subtotal_cents integer,
  discount_cents integer,
  total_cents integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_item_count integer := 0;
  v_sum_subtotal numeric := 0;
  v_sum_discount numeric := 0;
  v_sum_total numeric := 0;
  v_subtotal_cents integer;
  v_discount_cents integer;
  v_total_cents integer;
  v_items_total_cents integer;
  v_updated_count integer := 0;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_quote_id is null then
    raise exception using
      errcode = '22023',
      message = p_error_message;
  end if;

  if exists (
    select 1
    from public.sales_quote_items item_row
    where item_row.organization_id = p_organization_id
      and item_row.store_id = p_store_id
      and item_row.quote_id = p_quote_id
      and (
        item_row.subtotal_cents is null
        or item_row.discount_cents is null
        or item_row.total_cents is null
        or item_row.subtotal_cents < 0
        or item_row.discount_cents < 0
        or item_row.total_cents < 0
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = p_error_message;
  end if;

  select
    pg_catalog.count(*)::integer,
    coalesce(pg_catalog.sum(item_row.subtotal_cents::numeric), 0),
    coalesce(pg_catalog.sum(item_row.discount_cents::numeric), 0),
    coalesce(pg_catalog.sum(item_row.total_cents::numeric), 0)
  into
    v_item_count,
    v_sum_subtotal,
    v_sum_discount,
    v_sum_total
  from public.sales_quote_items item_row
  where item_row.organization_id = p_organization_id
    and item_row.store_id = p_store_id
    and item_row.quote_id = p_quote_id;

  if v_item_count <= 0 then
    raise exception using
      errcode = 'P0001',
      message = p_error_message;
  end if;

  v_subtotal_cents := public.p9_sales_quote_assert_int4_cents_by_system(
    v_sum_subtotal,
    p_error_message
  );
  v_discount_cents := public.p9_sales_quote_assert_int4_cents_by_system(
    v_sum_discount,
    p_error_message
  );
  v_total_cents := public.p9_sales_quote_assert_int4_cents_by_system(
    v_sum_subtotal - v_sum_discount,
    p_error_message
  );
  v_items_total_cents := public.p9_sales_quote_assert_int4_cents_by_system(
    v_sum_total,
    p_error_message
  );

  if v_items_total_cents <> v_total_cents then
    raise exception using
      errcode = 'P0001',
      message = p_error_message;
  end if;

  update public.sales_quotes quote_row
  set
    subtotal_cents = v_subtotal_cents,
    discount_cents = v_discount_cents,
    total_cents = v_total_cents
  where quote_row.id = p_quote_id
    and quote_row.organization_id = p_organization_id
    and quote_row.store_id = p_store_id;

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = p_error_message;
  end if;

  subtotal_cents := v_subtotal_cents;
  discount_cents := v_discount_cents;
  total_cents := v_total_cents;
  return next;
end;
$function$;

alter function public.p9_sales_quote_sync_header_from_items_by_system(
  uuid, uuid, uuid, text
) owner to postgres;

comment on function public.p9_sales_quote_sync_header_from_items_by_system(
  uuid, uuid, uuid, text
) is
  'P9 6.2-D helper that synchronizes sales_quotes header money from persisted sales_quote_items with int4 cents validation.';

revoke all on function public.p9_sales_quote_sync_header_from_items_by_system(
  uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;

do $migration$
declare
  v_function_def text;
  v_updated_def text;
  v_error_message constant text := 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_MONEY_OUT_OF_RANGE';
  v_sync_block text;
  v_replay_pattern constant text :=
    'return[[:space:]]+query[[:space:]]+select[[:space:]]+p_quote_id[[:space:]]*,[[:space:]]*v_existing_version_id[[:space:]]*,[[:space:]]*v_existing_item_count[[:space:]]*,[[:space:]]*''replay''::text[[:space:]]*;';
  v_materialized_pattern constant text :=
    'return[[:space:]]+query[[:space:]]+select[[:space:]]+p_quote_id[[:space:]]*,[[:space:]]*v_profile_version[.]id[[:space:]]*,[[:space:]]*v_inserted_count[[:space:]]*,[[:space:]]*''materialized''::text[[:space:]]*;';
  v_replay_count integer := 0;
  v_materialized_count integer := 0;
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

  -- Prove the semantic 6.2-C contract without depending on
  -- pg_get_functiondef whitespace/indentation.
  if position('materializer_version'', 3' in v_function_def) = 0
     or position('p9_sales_quote_assert_int4_cents_by_system' in v_function_def) = 0
     or position('p9_sales_quote_item_subtotal_cents_by_system' in v_function_def) = 0
     or position(v_error_message in v_function_def) = 0
     or position('''replay''::text' in v_function_def) = 0
     or position('''materialized''::text' in v_function_def) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: materializer 6.2-C contract not found';
  end if;

  -- Require exactly one canonical return site for each outcome before rewriting.
  select pg_catalog.count(*)::integer
  into v_replay_count
  from pg_catalog.regexp_matches(
    v_function_def,
    v_replay_pattern,
    'g'
  );

  select pg_catalog.count(*)::integer
  into v_materialized_count
  from pg_catalog.regexp_matches(
    v_function_def,
    v_materialized_pattern,
    'g'
  );

  if v_replay_count <> 1
     or v_materialized_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical replay/materialized return sites not found exactly once';
  end if;

  v_sync_block := pg_catalog.format(
    E'perform *\n'
    '  from public.p9_sales_quote_sync_header_from_items_by_system(\n'
    '    p_organization_id,\n'
    '    p_store_id,\n'
    '    p_quote_id,\n'
    '    %L\n'
    '  );',
    v_error_message
  );

  v_updated_def := v_function_def;

  v_updated_def := pg_catalog.regexp_replace(
    v_updated_def,
    v_replay_pattern,
    v_sync_block
      || E'\n\n'
      || E'    return query\n'
      || E'    select p_quote_id, v_existing_version_id, '
      || E'v_existing_item_count, ''replay''::text;',
    'g'
  );

  v_updated_def := pg_catalog.regexp_replace(
    v_updated_def,
    v_materialized_pattern,
    v_sync_block
      || E'\n\n'
      || E'  return query\n'
      || E'  select p_quote_id, v_profile_version.id, '
      || E'v_inserted_count, ''materialized''::text;',
    'g'
  );

  v_updated_def := pg_catalog.replace(
    v_updated_def,
    'materializer_version'', 3',
    'materializer_version'', 4'
  );

  if v_updated_def = v_function_def
     or position('materializer_version'', 3' in v_updated_def) > 0
     or position('materializer_version'', 4' in v_updated_def) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: materializer definition was not changed to 6.2-D';
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
  'P9 6.2-D service-role canonical quote-item materializer. It snapshots current Profile pool/catalog/service/custom components into sales_quote_items once, preserves replay item snapshots, validates money values against int4 cents limits, and synchronizes sales_quotes header totals from persisted items on materialized and replay outcomes.';

revoke all on function public.materialize_sales_quote_items_from_current_profile_by_system(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.materialize_sales_quote_items_from_current_profile_by_system(
  uuid, uuid, uuid
) to service_role;

do $postcondition$
declare
  v_function_def text;
  v_sync_call_count integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.materialize_sales_quote_items_from_current_profile_by_system(uuid,uuid,uuid)'::pg_catalog.regprocedure
  )
  into v_function_def;

  v_sync_call_count :=
    (
      pg_catalog.length(v_function_def)
      - pg_catalog.length(pg_catalog.replace(
          v_function_def,
          'p9_sales_quote_sync_header_from_items_by_system',
          ''
        ))
    ) / pg_catalog.length('p9_sales_quote_sync_header_from_items_by_system');

  if pg_catalog.to_regprocedure('public.p9_sales_quote_sync_header_from_items_by_system(uuid,uuid,uuid,text)') is null
     or v_sync_call_count <> 2
     or position('p9_sales_quote_assert_int4_cents_by_system' in v_function_def) = 0
     or position('p9_sales_quote_item_subtotal_cents_by_system' in v_function_def) = 0
     or position('ZION_SALES_QUOTE_PROFILE_MATERIALIZER_MONEY_OUT_OF_RANGE' in v_function_def) = 0
     or position('''replay''::text' in v_function_def) = 0
     or position('''materialized''::text' in v_function_def) = 0
     or position('quote_item_quantity * component_row.quote_item_unit_price_cents' in v_function_def) > 0
     or position('pg_catalog.round((pool_row.price)::numeric * 100)::integer' in v_function_def) > 0
     or position('materializer_version'', 3' in v_function_def) > 0
     or position('materializer_version'', 4' in v_function_def) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: materializer 6.2-D header sync contract missing';
  end if;
end;
$postcondition$;
