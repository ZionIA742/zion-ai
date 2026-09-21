-- P9 6.2 residual: preserve sales_quote_items profile lineage in atomic apply-change.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';

do $preflight$
begin
  if pg_catalog.to_regclass('public.sales_quotes') is null
     or pg_catalog.to_regclass('public.sales_quote_items') is null
     or pg_catalog.to_regprocedure(
       'public.apply_sales_quote_change_money_and_items_by_system(uuid,uuid,uuid,text,text,integer,integer,integer,text,text,text,text,text,date,jsonb,jsonb)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: required P9 apply-change objects are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute column_row
    where column_row.attrelid = 'public.sales_quote_items'::pg_catalog.regclass
      and column_row.attname in (
        'commercial_opportunity_id',
        'profile_component_id',
        'pool_id',
        'catalog_item_id'
      )
      and not column_row.attisdropped
    group by column_row.attrelid
    having pg_catalog.count(*) = 4
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: sales_quote_items lineage columns are missing';
  end if;
end;
$preflight$;

create or replace function public.apply_sales_quote_change_money_and_items_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_quote_id uuid,
  p_title text,
  p_status text,
  p_subtotal_cents integer,
  p_discount_cents integer,
  p_total_cents integer,
  p_customer_notes text,
  p_internal_notes text,
  p_payment_terms text,
  p_delivery_terms text,
  p_warranty_terms text,
  p_valid_until date,
  p_metadata jsonb,
  p_items jsonb
)
returns table (
  quote_id uuid,
  item_count integer,
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
  v_request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
  v_quote public.sales_quotes%rowtype;
  v_item_count integer := 0;
  v_sum_subtotal numeric := 0;
  v_sum_discount numeric := 0;
  v_sum_total numeric := 0;
  v_updated_count integer := 0;
begin
  if (v_request_role is distinct from 'service_role') and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'sales quote apply-change atomic writer is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_quote_id is null
     or p_status is null
     or p_items is null
     or pg_catalog.jsonb_typeof(p_items) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_items) <= 0 then
    raise exception using
      errcode = '22023',
      message = 'ZION_SALES_QUOTE_APPLY_CHANGE_ATOMIC_ARGUMENTS_INVALID';
  end if;

  select quote_row.*
  into v_quote
  from public.sales_quotes quote_row
  where quote_row.id = p_quote_id
    and quote_row.organization_id = p_organization_id
    and quote_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_SALES_QUOTE_APPLY_CHANGE_QUOTE_NOT_FOUND';
  end if;

  drop table if exists pg_temp.p9_apply_change_items;

  create temp table pg_temp.p9_apply_change_items (
    id uuid,
    commercial_opportunity_id uuid,
    profile_component_id uuid,
    pool_id uuid,
    catalog_item_id uuid,
    item_type text,
    name text,
    description text,
    quantity integer,
    unit_price_cents integer,
    discount_cents integer,
    subtotal_cents integer,
    total_cents integer,
    sort_order integer,
    sku text,
    metadata jsonb
  ) on commit drop;

  insert into pg_temp.p9_apply_change_items (
    id,
    commercial_opportunity_id,
    profile_component_id,
    pool_id,
    catalog_item_id,
    item_type,
    name,
    description,
    quantity,
    unit_price_cents,
    discount_cents,
    subtotal_cents,
    total_cents,
    sort_order,
    sku,
    metadata
  )
  select
    nullif(pg_catalog.btrim(coalesce(item_row.id, '')), '')::uuid,
    nullif(pg_catalog.btrim(coalesce(item_row.commercial_opportunity_id, '')), '')::uuid,
    nullif(pg_catalog.btrim(coalesce(item_row.profile_component_id, '')), '')::uuid,
    nullif(pg_catalog.btrim(coalesce(item_row.pool_id, '')), '')::uuid,
    nullif(pg_catalog.btrim(coalesce(item_row.catalog_item_id, '')), '')::uuid,
    pg_catalog.lower(pg_catalog.btrim(coalesce(item_row.item_type, ''))),
    pg_catalog.btrim(coalesce(item_row.name, '')),
    nullif(pg_catalog.btrim(coalesce(item_row.description, '')), ''),
    item_row.quantity,
    item_row.unit_price_cents,
    item_row.discount_cents,
    item_row.subtotal_cents,
    item_row.total_cents,
    item_row.sort_order,
    nullif(pg_catalog.btrim(coalesce(item_row.sku, '')), ''),
    coalesce(item_row.metadata, '{}'::jsonb)
  from pg_catalog.jsonb_to_recordset(p_items) as item_row(
    id text,
    commercial_opportunity_id text,
    profile_component_id text,
    pool_id text,
    catalog_item_id text,
    item_type text,
    name text,
    description text,
    quantity integer,
    unit_price_cents integer,
    discount_cents integer,
    subtotal_cents integer,
    total_cents integer,
    sort_order integer,
    sku text,
    metadata jsonb
  );

  update pg_temp.p9_apply_change_items input_item
  set commercial_opportunity_id = persisted_item.commercial_opportunity_id,
      profile_component_id = persisted_item.profile_component_id,
      pool_id = persisted_item.pool_id,
      catalog_item_id = persisted_item.catalog_item_id
  from public.sales_quote_items persisted_item
  where input_item.id = persisted_item.id
    and persisted_item.quote_id = p_quote_id
    and persisted_item.organization_id = p_organization_id
    and persisted_item.store_id = p_store_id;

  update pg_temp.p9_apply_change_items input_item
  set commercial_opportunity_id = null,
      profile_component_id = null,
      pool_id = null,
      catalog_item_id = null
  where not exists (
    select 1
    from public.sales_quote_items persisted_item
    where persisted_item.id = input_item.id
      and persisted_item.quote_id = p_quote_id
      and persisted_item.organization_id = p_organization_id
      and persisted_item.store_id = p_store_id
  );

  if exists (
    select 1
    from pg_temp.p9_apply_change_items item_row
    where item_row.item_type is null
      or item_row.item_type not in ('pool', 'catalog_item', 'service', 'custom')
      or item_row.name is null
      or pg_catalog.length(item_row.name) <= 0
      or item_row.quantity is null
      or item_row.quantity <= 0
      or item_row.unit_price_cents is null
      or item_row.unit_price_cents < 0
      or item_row.discount_cents is null
      or item_row.discount_cents < 0
      or item_row.subtotal_cents is null
      or item_row.subtotal_cents < 0
      or item_row.total_cents is null
      or item_row.total_cents < 0
      or item_row.sort_order is null
      or item_row.sort_order <= 0
      or item_row.metadata is null
      or pg_catalog.jsonb_typeof(item_row.metadata) is distinct from 'object'
      or ((item_row.profile_component_id is null) <> (item_row.commercial_opportunity_id is null))
      or (
        item_row.profile_component_id is not null
        and not (
          (
            item_row.item_type = 'pool'
            and item_row.pool_id is not null
            and item_row.catalog_item_id is null
          )
          or (
            item_row.item_type = 'catalog_item'
            and item_row.catalog_item_id is not null
            and item_row.pool_id is null
          )
          or (
            item_row.item_type in ('service', 'custom')
            and item_row.pool_id is null
            and item_row.catalog_item_id is null
          )
        )
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_SALES_QUOTE_APPLY_CHANGE_ITEM_INVALID';
  end if;

  if exists (
    select 1
    from pg_temp.p9_apply_change_items item_row
    where public.p9_sales_quote_item_subtotal_cents_by_system(
      item_row.quantity,
      item_row.unit_price_cents,
      'ZION_SALES_QUOTE_APPLY_CHANGE_MONEY_OUT_OF_RANGE'
    ) <> item_row.subtotal_cents
       or item_row.discount_cents > item_row.subtotal_cents
       or item_row.total_cents <> item_row.subtotal_cents - item_row.discount_cents
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_SALES_QUOTE_APPLY_CHANGE_ITEM_MONEY_INVALID';
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
  from pg_temp.p9_apply_change_items item_row;

  if public.p9_sales_quote_assert_int4_cents_by_system(
       v_sum_subtotal,
       'ZION_SALES_QUOTE_APPLY_CHANGE_MONEY_OUT_OF_RANGE'
     ) <> p_subtotal_cents
     or public.p9_sales_quote_assert_int4_cents_by_system(
       v_sum_discount,
       'ZION_SALES_QUOTE_APPLY_CHANGE_MONEY_OUT_OF_RANGE'
     ) <> p_discount_cents
     or public.p9_sales_quote_assert_int4_cents_by_system(
       v_sum_subtotal - v_sum_discount,
       'ZION_SALES_QUOTE_APPLY_CHANGE_MONEY_OUT_OF_RANGE'
     ) <> p_total_cents
     or public.p9_sales_quote_assert_int4_cents_by_system(
       v_sum_total,
       'ZION_SALES_QUOTE_APPLY_CHANGE_MONEY_OUT_OF_RANGE'
     ) <> p_total_cents then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_SALES_QUOTE_APPLY_CHANGE_HEADER_ITEMS_MISMATCH';
  end if;

  update public.sales_quotes quote_row
  set
    title = p_title,
    status = p_status,
    subtotal_cents = p_subtotal_cents,
    discount_cents = p_discount_cents,
    total_cents = p_total_cents,
    customer_notes = p_customer_notes,
    internal_notes = p_internal_notes,
    payment_terms = p_payment_terms,
    delivery_terms = p_delivery_terms,
    warranty_terms = p_warranty_terms,
    valid_until = p_valid_until,
    metadata = coalesce(p_metadata, '{}'::jsonb),
    updated_at = pg_catalog.clock_timestamp()
  where quote_row.id = p_quote_id
    and quote_row.organization_id = p_organization_id
    and quote_row.store_id = p_store_id;

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_SALES_QUOTE_APPLY_CHANGE_QUOTE_UPDATE_FAILED';
  end if;

  delete from public.sales_quote_items item_row
  where item_row.quote_id = p_quote_id
    and item_row.organization_id = p_organization_id
    and item_row.store_id = p_store_id;

  insert into public.sales_quote_items (
    id,
    quote_id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    profile_component_id,
    pool_id,
    catalog_item_id,
    item_type,
    name,
    description,
    quantity,
    unit_price_cents,
    discount_cents,
    subtotal_cents,
    total_cents,
    sort_order,
    sku,
    metadata
  )
  select
    coalesce(item_row.id, pg_catalog.gen_random_uuid()),
    p_quote_id,
    p_organization_id,
    p_store_id,
    item_row.commercial_opportunity_id,
    item_row.profile_component_id,
    item_row.pool_id,
    item_row.catalog_item_id,
    item_row.item_type,
    item_row.name,
    item_row.description,
    item_row.quantity,
    item_row.unit_price_cents,
    item_row.discount_cents,
    item_row.subtotal_cents,
    item_row.total_cents,
    item_row.sort_order,
    item_row.sku,
    item_row.metadata
  from pg_temp.p9_apply_change_items item_row
  order by item_row.sort_order;

  quote_id := p_quote_id;
  item_count := v_item_count;
  subtotal_cents := p_subtotal_cents;
  discount_cents := p_discount_cents;
  total_cents := p_total_cents;

  return next;
end;
$function$;

alter function public.apply_sales_quote_change_money_and_items_by_system(
  uuid, uuid, uuid, text, text, integer, integer, integer, text, text, text, text, text, date, jsonb, jsonb
) owner to postgres;

comment on function public.apply_sales_quote_change_money_and_items_by_system(
  uuid, uuid, uuid, text, text, integer, integer, integer, text, text, text, text, text, date, jsonb, jsonb
) is
  'Atomically applies sales quote header and item changes while preserving canonical item lineage from persisted rows.';

revoke all on function public.apply_sales_quote_change_money_and_items_by_system(
  uuid, uuid, uuid, text, text, integer, integer, integer, text, text, text, text, text, date, jsonb, jsonb
) from public;

revoke all on function public.apply_sales_quote_change_money_and_items_by_system(
  uuid, uuid, uuid, text, text, integer, integer, integer, text, text, text, text, text, date, jsonb, jsonb
) from anon;

revoke all on function public.apply_sales_quote_change_money_and_items_by_system(
  uuid, uuid, uuid, text, text, integer, integer, integer, text, text, text, text, text, date, jsonb, jsonb
) from authenticated;

grant execute on function public.apply_sales_quote_change_money_and_items_by_system(
  uuid, uuid, uuid, text, text, integer, integer, integer, text, text, text, text, text, date, jsonb, jsonb
) to service_role;

do $verify$
begin
  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'apply_sales_quote_change_money_and_items_by_system'
      and pg_catalog.pg_get_function_identity_arguments(proc_row.oid) =
        'p_organization_id uuid, p_store_id uuid, p_quote_id uuid, p_title text, p_status text, p_subtotal_cents integer, p_discount_cents integer, p_total_cents integer, p_customer_notes text, p_internal_notes text, p_payment_terms text, p_delivery_terms text, p_warranty_terms text, p_valid_until date, p_metadata jsonb, p_items jsonb'
      and proc_row.prosecdef is true
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: apply-change atomic writer function is missing or not security definer';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.apply_sales_quote_change_money_and_items_by_system(uuid,uuid,uuid,text,text,integer,integer,integer,text,text,text,text,text,date,jsonb,jsonb)',
    'execute'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: authenticated can execute apply-change atomic writer';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.apply_sales_quote_change_money_and_items_by_system(uuid,uuid,uuid,text,text,integer,integer,integer,text,text,text,text,text,date,jsonb,jsonb)',
    'execute'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: service_role cannot execute apply-change atomic writer';
  end if;
end;
$verify$;

commit;
