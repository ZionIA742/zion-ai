begin;



set local lock_timeout = '5s';

set local statement_timeout = '180s';



select pg_catalog.pg_advisory_xact_lock(

  pg_catalog.hashtextextended('p9_sales_quote_items_profile_lineage', 0)

);



do $preflight$

begin

  if pg_catalog.to_regclass('public.sales_quotes') is null

     or pg_catalog.to_regclass('public.sales_quote_items') is null

     or pg_catalog.to_regclass('public.commercial_opportunity_profile_current') is null

     or pg_catalog.to_regclass('public.commercial_opportunity_profile_versions') is null

     or pg_catalog.to_regclass('public.commercial_opportunity_profile_components') is null

     or pg_catalog.to_regclass('public.pools') is null

     or pg_catalog.to_regclass('public.store_catalog_items') is null

     or pg_catalog.to_regprocedure('public.zion_resolve_request_role_internal()') is null then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: required P9 quote/profile lineage objects are missing';

  end if;



  if not exists (

    select 1

    from pg_catalog.pg_attribute column_row

    where column_row.attrelid = 'public.sales_quote_items'::pg_catalog.regclass

      and column_row.attname in (

        'id',

        'organization_id',

        'store_id',

        'quote_id',

        'item_type',

        'pool_id',

        'catalog_item_id',

        'name',

        'sku',

        'description',

        'quantity',

        'unit_price_cents',

        'discount_cents',

        'subtotal_cents',

        'total_cents',

        'sort_order',

        'metadata'

      )

    group by column_row.attrelid

    having pg_catalog.count(*) = 17

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: public.sales_quote_items does not expose the expected remote contract';

  end if;


  if not exists (

    select 1

    from pg_catalog.pg_index index_row

    join pg_catalog.pg_class index_class

      on index_class.oid = index_row.indexrelid

    join pg_catalog.pg_class table_class

      on table_class.oid = index_row.indrelid

    join pg_catalog.pg_namespace schema_row

      on schema_row.oid = table_class.relnamespace

    where schema_row.nspname = 'public'

      and table_class.relname = 'sales_quotes'

      and index_class.relname = 'sales_quotes_id_commercial_opportunity_organization_store_uidx'

      and index_row.indisunique is true

      and index_row.indpred is null

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: canonical sales_quotes opportunity scope unique index is missing';

  end if;

end;

$preflight$;



alter table public.sales_quote_items

  add column if not exists commercial_opportunity_id uuid null,

  add column if not exists profile_component_id uuid null;




create unique index if not exists p9_profile_components_quote_item_kind_uidx

  on public.commercial_opportunity_profile_components (

    id,

    organization_id,

    store_id,

    commercial_opportunity_id,

    component_kind

  );



create unique index if not exists p9_profile_components_quote_item_pool_uidx

  on public.commercial_opportunity_profile_components (

    id,

    organization_id,

    store_id,

    commercial_opportunity_id,

    component_kind,

    pool_id

  );



create unique index if not exists p9_profile_components_quote_item_catalog_uidx

  on public.commercial_opportunity_profile_components (

    id,

    organization_id,

    store_id,

    commercial_opportunity_id,

    component_kind,

    catalog_item_id

  );



create unique index if not exists p9_sales_quote_items_quote_profile_component_uidx

  on public.sales_quote_items (

    quote_id,

    profile_component_id

  )

  where profile_component_id is not null;



alter table public.sales_quote_items

  drop constraint if exists p9_sales_quote_items_profile_lineage_pair_chk,

  add constraint p9_sales_quote_items_profile_lineage_pair_chk

  check (

    (

      profile_component_id is null

      and commercial_opportunity_id is null

    )

    or (

      profile_component_id is not null

      and commercial_opportunity_id is not null

    )

  ) not valid;



alter table public.sales_quote_items

  drop constraint if exists p9_sales_quote_items_profile_component_shape_chk,

  add constraint p9_sales_quote_items_profile_component_shape_chk

  check (

    profile_component_id is null

    or (

      (

        item_type = 'pool'

        and pool_id is not null

        and catalog_item_id is null

      )

      or (

        item_type = 'catalog_item'

        and catalog_item_id is not null

        and pool_id is null

      )

      or (

        item_type in ('service', 'custom')

        and pool_id is null

        and catalog_item_id is null

      )

    )

  ) not valid;



alter table public.sales_quote_items

  drop constraint if exists p9_sales_quote_items_quote_opportunity_scope_fk,

  add constraint p9_sales_quote_items_quote_opportunity_scope_fk

  foreign key (

    quote_id,

    commercial_opportunity_id,

    organization_id,

    store_id

  )

  references public.sales_quotes (

    id,

    commercial_opportunity_id,

    organization_id,

    store_id

  )

  on delete restrict

  not valid;



alter table public.sales_quote_items

  drop constraint if exists p9_sales_quote_items_profile_component_kind_fk,

  add constraint p9_sales_quote_items_profile_component_kind_fk

  foreign key (

    profile_component_id,

    organization_id,

    store_id,

    commercial_opportunity_id,

    item_type

  )

  references public.commercial_opportunity_profile_components (

    id,

    organization_id,

    store_id,

    commercial_opportunity_id,

    component_kind

  )

  on delete restrict

  not valid;



alter table public.sales_quote_items

  drop constraint if exists p9_sales_quote_items_profile_component_pool_fk,

  add constraint p9_sales_quote_items_profile_component_pool_fk

  foreign key (

    profile_component_id,

    organization_id,

    store_id,

    commercial_opportunity_id,

    item_type,

    pool_id

  )

  references public.commercial_opportunity_profile_components (

    id,

    organization_id,

    store_id,

    commercial_opportunity_id,

    component_kind,

    pool_id

  )

  on delete restrict

  not valid;



alter table public.sales_quote_items

  drop constraint if exists p9_sales_quote_items_profile_component_catalog_fk,

  add constraint p9_sales_quote_items_profile_component_catalog_fk

  foreign key (

    profile_component_id,

    organization_id,

    store_id,

    commercial_opportunity_id,

    item_type,

    catalog_item_id

  )

  references public.commercial_opportunity_profile_components (

    id,

    organization_id,

    store_id,

    commercial_opportunity_id,

    component_kind,

    catalog_item_id

  )

  on delete restrict

  not valid;



comment on column public.sales_quote_items.commercial_opportunity_id is

  'P9 6.1 canonical quote-item lineage. Null preserves legacy items; non-null must match the quote and profile component scope.';



comment on column public.sales_quote_items.profile_component_id is

  'P9 6.1 canonical quote-item lineage to commercial_opportunity_profile_components. Null preserves legacy/manual items.';



create or replace function public.materialize_sales_quote_items_from_current_profile_by_system(

  p_organization_id uuid,

  p_store_id uuid,

  p_quote_id uuid

)

returns table (

  quote_id uuid,

  profile_version_id uuid,

  item_count integer,

  outcome text

)

language plpgsql

security definer

set search_path = pg_catalog, public, pg_temp

set row_security = off

as $function$

declare

  v_request_role text := public.zion_resolve_request_role_internal();

  v_quote public.sales_quotes%rowtype;

  v_current public.commercial_opportunity_profile_current%rowtype;

  v_profile_version public.commercial_opportunity_profile_versions%rowtype;

  v_legacy_item_count integer := 0;

  v_existing_item_count integer := 0;

  v_existing_version_count integer := 0;

  v_existing_version_id uuid;

  v_expected_component_count integer := 0;

  v_missing_component_count integer := 0;

  v_extra_item_count integer := 0;

  v_inserted_count integer := 0;

  v_now timestamptz := pg_catalog.clock_timestamp();

begin

  if v_request_role is distinct from 'service_role' then

    raise exception using

      errcode = '42501',

      message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_NOT_AUTHORIZED';

  end if;



  if p_organization_id is null

     or p_store_id is null

     or p_quote_id is null then

    raise exception using

      errcode = '22023',

      message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_SCOPE_REQUIRED';

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

      message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_QUOTE_NOT_FOUND';

  end if;



  if v_quote.commercial_opportunity_id is null then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_QUOTE_OPPORTUNITY_REQUIRED';

  end if;



  select pg_catalog.count(*)::integer

  into v_legacy_item_count

  from public.sales_quote_items item_row

  where item_row.organization_id = p_organization_id

    and item_row.store_id = p_store_id

    and item_row.quote_id = p_quote_id

    and item_row.profile_component_id is null;



  if v_legacy_item_count > 0 then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_LEGACY_ITEMS_PRESENT';

  end if;



  select pg_catalog.count(*)::integer

  into v_missing_component_count

  from public.sales_quote_items item_row

  where item_row.organization_id = p_organization_id

    and item_row.store_id = p_store_id

    and item_row.quote_id = p_quote_id

    and item_row.profile_component_id is not null

    and not exists (

      select 1

      from public.commercial_opportunity_profile_components component_row

      where component_row.id = item_row.profile_component_id

        and component_row.organization_id = item_row.organization_id

        and component_row.store_id = item_row.store_id

        and component_row.commercial_opportunity_id = item_row.commercial_opportunity_id

        and component_row.component_kind = item_row.item_type

    );



  if v_missing_component_count > 0 then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_EXISTING_COMPONENT_REF_INVALID';

  end if;



  select

    pg_catalog.count(*)::integer,

    pg_catalog.count(distinct component_row.profile_version_id)::integer

  into

    v_existing_item_count,

    v_existing_version_count

  from public.sales_quote_items item_row

  join public.commercial_opportunity_profile_components component_row

    on component_row.id = item_row.profile_component_id

   and component_row.organization_id = item_row.organization_id

   and component_row.store_id = item_row.store_id

   and component_row.commercial_opportunity_id = item_row.commercial_opportunity_id

   and component_row.component_kind = item_row.item_type

  where item_row.organization_id = p_organization_id

    and item_row.store_id = p_store_id

    and item_row.quote_id = p_quote_id

    and item_row.profile_component_id is not null;



  if v_existing_item_count > 0 then

    if v_existing_version_count <> 1 then

      raise exception using

        errcode = 'P0001',

        message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_MULTIPLE_PROFILE_VERSIONS';

    end if;



    select distinct component_row.profile_version_id

    into strict v_existing_version_id

    from public.sales_quote_items item_row

    join public.commercial_opportunity_profile_components component_row

      on component_row.id = item_row.profile_component_id

     and component_row.organization_id = item_row.organization_id

     and component_row.store_id = item_row.store_id

     and component_row.commercial_opportunity_id = item_row.commercial_opportunity_id

     and component_row.component_kind = item_row.item_type

    where item_row.organization_id = p_organization_id

      and item_row.store_id = p_store_id

      and item_row.quote_id = p_quote_id

      and item_row.profile_component_id is not null;



    select version_row.*

    into v_profile_version

    from public.commercial_opportunity_profile_versions version_row

    where version_row.id = v_existing_version_id

      and version_row.organization_id = p_organization_id

      and version_row.store_id = p_store_id

      and version_row.commercial_opportunity_id = v_quote.commercial_opportunity_id;



    if not found then

      raise exception using

        errcode = 'P0001',

        message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_EXISTING_VERSION_INVALID';

    end if;



    if v_profile_version.profile_state <> 'resolved' then

      raise exception using

        errcode = 'P0001',

        message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_EXISTING_VERSION_NOT_RESOLVED';

    end if;



    select pg_catalog.count(*)::integer

    into v_expected_component_count

    from public.commercial_opportunity_profile_components component_row

    where component_row.organization_id = p_organization_id

      and component_row.store_id = p_store_id

      and component_row.commercial_opportunity_id = v_quote.commercial_opportunity_id

      and component_row.profile_version_id = v_existing_version_id

      and component_row.component_state = 'resolved'

      and component_row.component_kind in ('pool', 'catalog_item');



    if exists (

      select 1

      from public.commercial_opportunity_profile_components component_row

      where component_row.organization_id = p_organization_id

        and component_row.store_id = p_store_id

        and component_row.commercial_opportunity_id = v_quote.commercial_opportunity_id

        and component_row.profile_version_id = v_existing_version_id

        and component_row.component_state <> 'resolved'

    ) then

      raise exception using

        errcode = 'P0001',

        message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_EXISTING_VERSION_HAS_UNRESOLVED_COMPONENT';

    end if;



    if exists (

      select 1

      from public.commercial_opportunity_profile_components component_row

      where component_row.organization_id = p_organization_id

        and component_row.store_id = p_store_id

        and component_row.commercial_opportunity_id = v_quote.commercial_opportunity_id

        and component_row.profile_version_id = v_existing_version_id

        and component_row.component_kind in ('service', 'custom')

    ) then

      raise exception using

        errcode = 'P0001',

        message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_CANONICAL_PRICE_AUTHORITY_NOT_AVAILABLE_FOR_COMPONENT_KIND';

    end if;



    select pg_catalog.count(*)::integer

    into v_missing_component_count

    from public.commercial_opportunity_profile_components component_row

    where component_row.organization_id = p_organization_id

      and component_row.store_id = p_store_id

      and component_row.commercial_opportunity_id = v_quote.commercial_opportunity_id

      and component_row.profile_version_id = v_existing_version_id

      and component_row.component_state = 'resolved'

      and component_row.component_kind in ('pool', 'catalog_item')

      and not exists (

        select 1

        from public.sales_quote_items item_row

        where item_row.organization_id = p_organization_id

          and item_row.store_id = p_store_id

          and item_row.quote_id = p_quote_id

          and item_row.profile_component_id = component_row.id

      );



    select pg_catalog.count(*)::integer

    into v_extra_item_count

    from public.sales_quote_items item_row

    join public.commercial_opportunity_profile_components component_row

      on component_row.id = item_row.profile_component_id

     and component_row.organization_id = item_row.organization_id

     and component_row.store_id = item_row.store_id

     and component_row.commercial_opportunity_id = item_row.commercial_opportunity_id

    where item_row.organization_id = p_organization_id

      and item_row.store_id = p_store_id

      and item_row.quote_id = p_quote_id

      and item_row.profile_component_id is not null

      and component_row.profile_version_id <> v_existing_version_id;



    if v_expected_component_count = 0 then

      raise exception using

        errcode = 'P0001',

        message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_NO_MATERIALIZABLE_COMPONENTS';

    end if;



    if v_missing_component_count > 0 or v_extra_item_count > 0 then

      raise exception using

        errcode = 'P0001',

        message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_EXISTING_ITEM_SET_MISMATCH';

    end if;



    return query

    select p_quote_id, v_existing_version_id, v_existing_item_count, 'replay'::text;

    return;

  end if;



  select current_row.*

  into v_current

  from public.commercial_opportunity_profile_current current_row

  where current_row.organization_id = p_organization_id

    and current_row.store_id = p_store_id

    and current_row.commercial_opportunity_id = v_quote.commercial_opportunity_id

  for share;



  if not found then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_CURRENT_PROFILE_REQUIRED';

  end if;



  select version_row.*

  into v_profile_version

  from public.commercial_opportunity_profile_versions version_row

  where version_row.id = v_current.current_profile_version_id

    and version_row.organization_id = p_organization_id

    and version_row.store_id = p_store_id

    and version_row.commercial_opportunity_id = v_quote.commercial_opportunity_id;



  if not found then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_CURRENT_VERSION_INVALID';

  end if;



  if v_profile_version.profile_state <> 'resolved' then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_PROFILE_NOT_RESOLVED';

  end if;



  select pg_catalog.count(*)::integer

  into v_expected_component_count

  from public.commercial_opportunity_profile_components component_row

  where component_row.organization_id = p_organization_id

    and component_row.store_id = p_store_id

    and component_row.commercial_opportunity_id = v_quote.commercial_opportunity_id

    and component_row.profile_version_id = v_profile_version.id;



  if v_expected_component_count = 0 then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_NO_COMPONENTS';

  end if;



  if exists (

    select 1

    from public.commercial_opportunity_profile_components component_row

    where component_row.organization_id = p_organization_id

      and component_row.store_id = p_store_id

      and component_row.commercial_opportunity_id = v_quote.commercial_opportunity_id

      and component_row.profile_version_id = v_profile_version.id

      and component_row.component_state <> 'resolved'

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_COMPONENT_NOT_RESOLVED';

  end if;



  if exists (

    select 1

    from public.commercial_opportunity_profile_components component_row

    where component_row.organization_id = p_organization_id

      and component_row.store_id = p_store_id

      and component_row.commercial_opportunity_id = v_quote.commercial_opportunity_id

      and component_row.profile_version_id = v_profile_version.id

      and component_row.component_kind in ('service', 'custom')

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_CANONICAL_PRICE_AUTHORITY_NOT_AVAILABLE_FOR_COMPONENT_KIND';

  end if;



  if exists (

    select 1

    from public.commercial_opportunity_profile_components component_row

    where component_row.organization_id = p_organization_id

      and component_row.store_id = p_store_id

      and component_row.commercial_opportunity_id = v_quote.commercial_opportunity_id

      and component_row.profile_version_id = v_profile_version.id

      and component_row.component_kind = 'pool'

      and (

        component_row.pool_id is null

        or not exists (

          select 1

          from public.pools pool_row

          where pool_row.id = component_row.pool_id

            and pool_row.organization_id = component_row.organization_id

            and pool_row.store_id = component_row.store_id

            and pool_row.is_active is true

            and pool_row.price_status = 'valid'

            and pool_row.price is not null

            and pool_row.price >= 0

        )

      )

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_POOL_SOURCE_NOT_USABLE';

  end if;



  if exists (

    select 1

    from public.commercial_opportunity_profile_components component_row

    where component_row.organization_id = p_organization_id

      and component_row.store_id = p_store_id

      and component_row.commercial_opportunity_id = v_quote.commercial_opportunity_id

      and component_row.profile_version_id = v_profile_version.id

      and component_row.component_kind = 'catalog_item'

      and (

        component_row.catalog_item_id is null

        or not exists (

          select 1

          from public.store_catalog_items item_row

          where item_row.id = component_row.catalog_item_id

            and item_row.organization_id = component_row.organization_id

            and item_row.store_id = component_row.store_id

            and item_row.is_active is true

            and item_row.price_status = 'valid'

            and item_row.price_cents is not null

            and item_row.price_cents >= 0

        )

      )

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_CATALOG_SOURCE_NOT_USABLE';

  end if;



  insert into public.sales_quote_items (

    quote_id,

    organization_id,

    store_id,

    commercial_opportunity_id,

    profile_component_id,

    item_type,

    pool_id,

    catalog_item_id,

    name,

    sku,

    description,

    quantity,

    unit_price_cents,

    discount_cents,

    subtotal_cents,

    total_cents,

    sort_order,

    metadata

  )

  select

    v_quote.id,

    p_organization_id,

    p_store_id,

    v_quote.commercial_opportunity_id,

    component_row.id,

    component_row.component_kind,

    case when component_row.component_kind = 'pool' then component_row.pool_id else null end,

    case when component_row.component_kind = 'catalog_item' then component_row.catalog_item_id else null end,

    case

      when component_row.component_kind = 'pool' then pool_row.name

      else catalog_row.name

    end,

    case

      when component_row.component_kind = 'catalog_item' then catalog_row.sku

      else null

    end,

    case

      when component_row.component_kind = 'pool' then pool_row.description

      else catalog_row.description

    end,

    1,

    case

      when component_row.component_kind = 'pool'

        then pg_catalog.round((pool_row.price)::numeric * 100)::integer

      else catalog_row.price_cents

    end,

    0,

    case

      when component_row.component_kind = 'pool'

        then pg_catalog.round((pool_row.price)::numeric * 100)::integer

      else catalog_row.price_cents

    end,

    case

      when component_row.component_kind = 'pool'

        then pg_catalog.round((pool_row.price)::numeric * 100)::integer

      else catalog_row.price_cents

    end,

    row_number() over (

      order by component_row.component_key, component_row.id

    )::integer,

    pg_catalog.jsonb_build_object(

      'source', 'commercial_opportunity_profile_component',

      'profile_version_id', v_profile_version.id,

      'profile_component_id', component_row.id,

      'component_key', component_row.component_key,

      'component_kind', component_row.component_kind,

      'materializer', 'materialize_sales_quote_items_from_current_profile_by_system',

      'materializer_version', 1,

      'materialized_at', v_now

    )

  from public.commercial_opportunity_profile_components component_row

  left join public.pools pool_row

    on pool_row.id = component_row.pool_id

   and pool_row.organization_id = component_row.organization_id

   and pool_row.store_id = component_row.store_id

   and pool_row.is_active is true

   and pool_row.price_status = 'valid'

   and pool_row.price is not null

   and pool_row.price >= 0

  left join public.store_catalog_items catalog_row

    on catalog_row.id = component_row.catalog_item_id

   and catalog_row.organization_id = component_row.organization_id

   and catalog_row.store_id = component_row.store_id

   and catalog_row.is_active is true

   and catalog_row.price_status = 'valid'

   and catalog_row.price_cents is not null

   and catalog_row.price_cents >= 0

  where component_row.organization_id = p_organization_id

    and component_row.store_id = p_store_id

    and component_row.commercial_opportunity_id = v_quote.commercial_opportunity_id

    and component_row.profile_version_id = v_profile_version.id

    and component_row.component_state = 'resolved'

    and component_row.component_kind in ('pool', 'catalog_item')

    and (

      (

        component_row.component_kind = 'pool'

        and pool_row.id is not null

      )

      or (

        component_row.component_kind = 'catalog_item'

        and catalog_row.id is not null

      )

    )

  order by component_row.component_key, component_row.id;



  get diagnostics v_inserted_count = row_count;



  if v_inserted_count <> v_expected_component_count then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_MATERIALIZATION_COUNT_MISMATCH';

  end if;



  return query

  select p_quote_id, v_profile_version.id, v_inserted_count, 'materialized'::text;

end;

$function$;



alter function public.materialize_sales_quote_items_from_current_profile_by_system(

  uuid, uuid, uuid

) owner to postgres;



comment on function public.materialize_sales_quote_items_from_current_profile_by_system(

  uuid, uuid, uuid

) is

  'P9 6.1-A service-role canonical quote-item materializer. It snapshots pool/catalog current Profile components into sales_quote_items once, preserves replay snapshots, and fails closed for unresolved/service/custom components.';



revoke all on function public.materialize_sales_quote_items_from_current_profile_by_system(

  uuid, uuid, uuid

) from public, anon, authenticated, service_role;



grant execute on function public.materialize_sales_quote_items_from_current_profile_by_system(

  uuid, uuid, uuid

) to service_role;



commit;
