begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('p9_profile_service_custom_quote_terms', 0)
);

do $preflight$
begin
  if pg_catalog.to_regclass('public.commercial_opportunity_profile_components') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_profile_versions') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_profile_current') is null
     or pg_catalog.to_regclass('public.sales_quote_items') is null
     or pg_catalog.to_regclass('auth.users') is null
     or pg_catalog.to_regprocedure('public.write_commercial_opportunity_profile_internal(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,uuid,text,text,text,jsonb)') is null
     or pg_catalog.to_regprocedure('public.materialize_sales_quote_items_from_current_profile_by_system(uuid,uuid,uuid)') is null
     or pg_catalog.to_regclass('public.p9_profile_components_quote_item_kind_uidx') is null
     or pg_catalog.to_regprocedure('public.zion_resolve_request_role_internal()') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: required P9 profile quote-term objects are missing';
  end if;
end;
$preflight$;

alter table public.commercial_opportunity_profile_components
  add column if not exists quote_item_name text null,
  add column if not exists quote_item_description text null,
  add column if not exists quote_item_quantity integer null,
  add column if not exists quote_item_unit_price_cents integer null,
  add column if not exists quote_terms_authority_type text null,
  add column if not exists quote_terms_authority_user_id uuid null,
  add column if not exists quote_terms_origin_component_id uuid null;

alter table public.commercial_opportunity_profile_components
  drop constraint if exists p9_profile_components_quote_terms_text_chk,
  add constraint p9_profile_components_quote_terms_text_chk
  check (
    (
      quote_item_name is null
      or (
        quote_item_name = pg_catalog.btrim(quote_item_name)
        and pg_catalog.length(quote_item_name) between 1 and 500
      )
    )
    and (
      quote_item_description is null
      or (
        quote_item_description = pg_catalog.btrim(quote_item_description)
        and pg_catalog.length(quote_item_description) between 1 and 2000
      )
    )
    and (quote_item_quantity is null or quote_item_quantity > 0)
    and (
      quote_item_unit_price_cents is null
      or quote_item_unit_price_cents >= 0
    )
    and (
      quote_terms_authority_type is null
      or quote_terms_authority_type = 'human'
    )
    and (
      quote_terms_origin_component_id is null
      or quote_terms_origin_component_id <> id
    )
  ) not valid,

  drop constraint if exists p9_profile_components_quote_terms_kind_shape_chk,
  add constraint p9_profile_components_quote_terms_kind_shape_chk
  check (
    (
      component_kind in ('pool', 'catalog_item')
      and quote_item_name is null
      and quote_item_description is null
      and quote_item_quantity is null
      and quote_item_unit_price_cents is null
      and quote_terms_authority_type is null
      and quote_terms_authority_user_id is null
      and quote_terms_origin_component_id is null
    )
    or (
      component_kind in ('service', 'custom')
      and component_state = 'resolved'
      and pool_id is null
      and catalog_item_id is null
      and quote_item_name is not null
      and quote_item_quantity is not null
      and quote_item_unit_price_cents is not null
      and quote_terms_authority_type = 'human'
      and quote_terms_authority_user_id is not null
    )
    or (
      component_kind in ('service', 'custom')
      and component_state <> 'resolved'
      and quote_item_name is null
      and quote_item_description is null
      and quote_item_quantity is null
      and quote_item_unit_price_cents is null
      and quote_terms_authority_type is null
      and quote_terms_authority_user_id is null
      and quote_terms_origin_component_id is null
    )
  ) not valid,

  drop constraint if exists p9_profile_components_quote_terms_authority_user_fk,
  add constraint p9_profile_components_quote_terms_authority_user_fk
  foreign key (quote_terms_authority_user_id)
  references auth.users(id)
  on delete restrict
  not valid,

  drop constraint if exists p9_profile_components_quote_terms_origin_scope_fk,
  drop constraint if exists p9_profile_components_quote_terms_origin_kind_scope_fk,
  add constraint p9_profile_components_quote_terms_origin_kind_scope_fk
  foreign key (
    quote_terms_origin_component_id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    component_kind
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

comment on column public.commercial_opportunity_profile_components.quote_item_name is
  'P9 6.1-B canonical quote item name for resolved service/custom components. Null for pool/catalog and unresolved text components.';
comment on column public.commercial_opportunity_profile_components.quote_item_description is
  'P9 6.1-B optional canonical quote item description for resolved service/custom components.';
comment on column public.commercial_opportunity_profile_components.quote_item_quantity is
  'P9 6.1-B canonical integer quote item quantity for resolved service/custom components, aligned with current sales_quote_items runtime math.';
comment on column public.commercial_opportunity_profile_components.quote_item_unit_price_cents is
  'P9 6.1-B canonical unit price in cents for resolved service/custom components. Zero is allowed; negative values fail closed.';
comment on column public.commercial_opportunity_profile_components.quote_terms_authority_type is
  'P9 6.1-B quote terms authority. Only human is allowed; system may only carry forward existing human-authorized terms.';
comment on column public.commercial_opportunity_profile_components.quote_terms_authority_user_id is
  'P9 6.1-B human user that authorized service/custom quote terms.';
comment on column public.commercial_opportunity_profile_components.quote_terms_origin_component_id is
  'P9 6.1-B previous Profile component used as the exact carry-forward source for service/custom quote terms.';

create or replace function public.write_commercial_opportunity_profile_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text,
  p_request_fingerprint text,
  p_profile_state text,
  p_components jsonb,
  p_execution_intents jsonb,
  p_actor_type text,
  p_actor_user_id uuid,
  p_source_type text,
  p_reason_code text,
  p_created_by text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  profile_version_id uuid,
  version_number integer,
  previous_profile_version_id uuid,
  component_count integer,
  execution_intent_count integer,
  current_profile_version_id uuid,
  profile_state text,
  changed boolean,
  replayed boolean,
  outcome text,
  created_at timestamptz,
  current_updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_operation_key text := nullif(pg_catalog.btrim(coalesce(p_operation_key, '')), '');
  v_request_fingerprint text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_request_fingerprint, '')), ''));
  v_profile_state text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_profile_state, '')), ''));
  v_actor_type text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_actor_type, '')), ''));
  v_source_type text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_source_type, '')), ''));
  v_reason_code text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_reason_code, '')), ''));
  v_created_by text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_created_by, '')), ''));
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);

  v_component jsonb;
  v_component_key text;
  v_component_kind text;
  v_component_state text;
  v_pool_id uuid;
  v_catalog_item_id uuid;
  v_reference_text text;
  v_component_metadata jsonb;
  v_quote_item_name text;
  v_quote_item_description text;
  v_quote_item_quantity integer;
  v_quote_item_unit_price_cents integer;
  v_quote_terms_authority_type text;
  v_quote_terms_authority_user_id uuid;
  v_quote_terms_origin_component_id uuid;
  v_normalized_components jsonb := '[]'::jsonb;
  v_existing_components jsonb := '[]'::jsonb;

  v_intent jsonb;
  v_execution_kind text;
  v_intent_state text;
  v_intent_reason_code text;
  v_intent_metadata jsonb;
  v_normalized_intents jsonb := '[]'::jsonb;
  v_existing_intents jsonb := '[]'::jsonb;

  v_component_total integer := 0;
  v_component_unique integer := 0;
  v_intent_total integer := 0;
  v_intent_unique integer := 0;
  v_has_conflict boolean := false;
  v_has_unresolved boolean := false;

  v_history_count integer;
  v_has_current boolean := false;
  v_current public.commercial_opportunity_profile_current%rowtype;
  v_current_version public.commercial_opportunity_profile_versions%rowtype;
  v_existing public.commercial_opportunity_profile_versions%rowtype;
  v_new public.commercial_opportunity_profile_versions%rowtype;
  v_new_version_number integer;
  v_new_previous_id uuid;
  v_origin public.commercial_opportunity_profile_components%rowtype;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_SCOPE_REQUIRED';
  end if;

  if v_operation_key is null or pg_catalog.length(v_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_OPERATION_KEY_INVALID';
  end if;

  if v_request_fingerprint is null
     or pg_catalog.length(v_request_fingerprint) <> 64
     or v_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_REQUEST_FINGERPRINT_INVALID';
  end if;

  if v_profile_state not in ('resolved', 'needs_clarification', 'conflict') then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_STATE_INVALID';
  end if;

  if v_actor_type not in ('human', 'system')
     or (v_actor_type = 'human' and p_actor_user_id is null)
     or (v_actor_type = 'system' and p_actor_user_id is not null) then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_ACTOR_INVALID';
  end if;

  if v_source_type is null
     or pg_catalog.length(v_source_type) not between 3 and 120
     or v_source_type !~ '^[a-z0-9_:.\/-]+$' then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_SOURCE_TYPE_INVALID';
  end if;

  if v_reason_code is null
     or pg_catalog.length(v_reason_code) not between 3 and 120
     or v_reason_code !~ '^[a-z0-9_:.\/-]+$' then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_REASON_CODE_INVALID';
  end if;

  if v_created_by is null
     or pg_catalog.length(v_created_by) not between 3 and 120
     or v_created_by !~ '^[a-z0-9_:.\/-]+$' then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_CREATED_BY_INVALID';
  end if;

  if pg_catalog.jsonb_typeof(v_metadata) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_METADATA_INVALID';
  end if;

  if p_components is null
     or pg_catalog.jsonb_typeof(p_components) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENTS_ARRAY_REQUIRED';
  end if;

  if p_execution_intents is null
     or pg_catalog.jsonb_typeof(p_execution_intents) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_EXECUTION_INTENTS_ARRAY_REQUIRED';
  end if;

  for v_component in
    select component_row.value
    from pg_catalog.jsonb_array_elements(p_components) component_row(value)
  loop
    if pg_catalog.jsonb_typeof(v_component) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_OBJECT_REQUIRED';
    end if;

    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_component) key_row(key_name)
      where key_row.key_name not in (
        'component_key',
        'component_kind',
        'component_state',
        'pool_id',
        'catalog_item_id',
        'reference_text',
        'metadata',
        'quote_item_name',
        'quote_item_description',
        'quote_item_quantity',
        'quote_item_unit_price_cents',
        'quote_terms_authority_type',
        'quote_terms_authority_user_id',
        'quote_terms_origin_component_id'
      )
    ) then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_UNKNOWN_FIELD';
    end if;

    v_component_key := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_component ->> 'component_key', '')), ''));
    v_component_kind := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_component ->> 'component_kind', '')), ''));
    v_component_state := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_component ->> 'component_state', '')), ''));
    v_reference_text := nullif(pg_catalog.btrim(coalesce(v_component ->> 'reference_text', '')), '');
    v_component_metadata := coalesce(v_component -> 'metadata', '{}'::jsonb);
    v_quote_item_name := nullif(pg_catalog.btrim(coalesce(v_component ->> 'quote_item_name', '')), '');
    v_quote_item_description := nullif(pg_catalog.btrim(coalesce(v_component ->> 'quote_item_description', '')), '');
    v_quote_terms_authority_type := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_component ->> 'quote_terms_authority_type', '')), ''));

    begin
      v_pool_id := nullif(pg_catalog.btrim(coalesce(v_component ->> 'pool_id', '')), '')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_POOL_ID_INVALID';
    end;

    begin
      v_catalog_item_id := nullif(pg_catalog.btrim(coalesce(v_component ->> 'catalog_item_id', '')), '')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_CATALOG_ITEM_ID_INVALID';
    end;

    begin
      v_quote_item_quantity := nullif(pg_catalog.btrim(coalesce(v_component ->> 'quote_item_quantity', '')), '')::integer;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_QUOTE_ITEM_QUANTITY_INVALID';
    end;

    begin
      v_quote_item_unit_price_cents := nullif(pg_catalog.btrim(coalesce(v_component ->> 'quote_item_unit_price_cents', '')), '')::integer;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_QUOTE_ITEM_UNIT_PRICE_INVALID';
    end;

    begin
      v_quote_terms_authority_user_id := nullif(pg_catalog.btrim(coalesce(v_component ->> 'quote_terms_authority_user_id', '')), '')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_QUOTE_TERMS_AUTHORITY_USER_ID_INVALID';
    end;

    begin
      v_quote_terms_origin_component_id := nullif(pg_catalog.btrim(coalesce(v_component ->> 'quote_terms_origin_component_id', '')), '')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_QUOTE_TERMS_ORIGIN_COMPONENT_ID_INVALID';
    end;

    if v_component_key is null
       or pg_catalog.length(v_component_key) > 120
       or v_component_key !~ '^[a-z0-9_:.\/-]+$' then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_KEY_INVALID';
    end if;

    if v_component_kind not in ('pool', 'catalog_item', 'service', 'custom') then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_KIND_INVALID';
    end if;

    if v_component_state not in ('resolved', 'partial', 'conflict') then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_STATE_INVALID';
    end if;

    if v_reference_text is not null and pg_catalog.length(v_reference_text) > 500 then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_REFERENCE_TEXT_INVALID';
    end if;

    if pg_catalog.jsonb_typeof(v_component_metadata) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_METADATA_INVALID';
    end if;

    if v_pool_id is not null and v_component_kind <> 'pool' then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_POOL_KIND_MISMATCH';
    end if;

    if v_catalog_item_id is not null and v_component_kind <> 'catalog_item' then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_CATALOG_KIND_MISMATCH';
    end if;

    if v_pool_id is not null and v_catalog_item_id is not null then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_COMPONENT_MULTIPLE_CATALOG_REFS';
    end if;

    if v_component_kind in ('pool', 'catalog_item') and (
      v_quote_item_name is not null
      or v_quote_item_description is not null
      or v_quote_item_quantity is not null
      or v_quote_item_unit_price_cents is not null
      or v_quote_terms_authority_type is not null
      or v_quote_terms_authority_user_id is not null
      or v_quote_terms_origin_component_id is not null
    ) then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_QUOTE_TERMS_NOT_ALLOWED_FOR_CATALOG_SOURCE';
    end if;

    if v_component_kind = 'pool' and not (
      (v_component_state = 'resolved' and v_pool_id is not null)
      or (v_component_state = 'partial' and (v_pool_id is not null or v_reference_text is not null))
      or (v_component_state = 'conflict' and v_reference_text is not null)
    ) then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_POOL_COMPONENT_SHAPE_INVALID';
    end if;

    if v_component_kind = 'catalog_item' and not (
      (v_component_state = 'resolved' and v_catalog_item_id is not null)
      or (v_component_state = 'partial' and (v_catalog_item_id is not null or v_reference_text is not null))
      or (v_component_state = 'conflict' and v_reference_text is not null)
    ) then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_CATALOG_COMPONENT_SHAPE_INVALID';
    end if;

    if v_component_kind in ('service', 'custom') and (
      v_pool_id is not null
      or v_catalog_item_id is not null
      or v_reference_text is null
    ) then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_TEXT_COMPONENT_SHAPE_INVALID';
    end if;

    if v_component_kind in ('service', 'custom') and v_component_state <> 'resolved' and (
      v_quote_item_name is not null
      or v_quote_item_description is not null
      or v_quote_item_quantity is not null
      or v_quote_item_unit_price_cents is not null
      or v_quote_terms_authority_type is not null
      or v_quote_terms_authority_user_id is not null
      or v_quote_terms_origin_component_id is not null
    ) then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_QUOTE_TERMS_REQUIRE_RESOLVED_TEXT_COMPONENT';
    end if;

    if v_pool_id is not null and not exists (
      select 1
      from public.pools pool_row
      where pool_row.id = v_pool_id
        and pool_row.organization_id = p_organization_id
        and pool_row.store_id = p_store_id
    ) then
      raise exception using errcode = '23503', message = 'ZION_OPPORTUNITY_PROFILE_POOL_OUTSIDE_SCOPE';
    end if;

    if v_catalog_item_id is not null and not exists (
      select 1
      from public.store_catalog_items item_row
      where item_row.id = v_catalog_item_id
        and item_row.organization_id = p_organization_id
        and item_row.store_id = p_store_id
    ) then
      raise exception using errcode = '23503', message = 'ZION_OPPORTUNITY_PROFILE_CATALOG_ITEM_OUTSIDE_SCOPE';
    end if;

    v_normalized_components := v_normalized_components || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'component_key', v_component_key,
        'component_kind', v_component_kind,
        'component_state', v_component_state,
        'pool_id', v_pool_id,
        'catalog_item_id', v_catalog_item_id,
        'reference_text', v_reference_text,
        'metadata', v_component_metadata,
        'quote_item_name', v_quote_item_name,
        'quote_item_description', v_quote_item_description,
        'quote_item_quantity', v_quote_item_quantity,
        'quote_item_unit_price_cents', v_quote_item_unit_price_cents,
        'quote_terms_authority_type', v_quote_terms_authority_type,
        'quote_terms_authority_user_id', v_quote_terms_authority_user_id,
        'quote_terms_origin_component_id', v_quote_terms_origin_component_id
      )
    );
  end loop;

  select coalesce(
    pg_catalog.jsonb_agg(component_row.value order by component_row.value ->> 'component_key'),
    '[]'::jsonb
  )
  into v_normalized_components
  from pg_catalog.jsonb_array_elements(v_normalized_components) component_row(value);

  v_component_total := pg_catalog.jsonb_array_length(v_normalized_components);

  select pg_catalog.count(distinct component_row.value ->> 'component_key')::integer
  into v_component_unique
  from pg_catalog.jsonb_array_elements(v_normalized_components) component_row(value);

  if v_component_unique <> v_component_total then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_DUPLICATE_COMPONENT_KEY';
  end if;

  for v_intent in
    select intent_row.value
    from pg_catalog.jsonb_array_elements(p_execution_intents) intent_row(value)
  loop
    if pg_catalog.jsonb_typeof(v_intent) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_EXECUTION_INTENT_OBJECT_REQUIRED';
    end if;

    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_intent) key_row(key_name)
      where key_row.key_name not in ('execution_kind', 'intent_state', 'reason_code', 'metadata')
    ) then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_EXECUTION_INTENT_UNKNOWN_FIELD';
    end if;

    v_execution_kind := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_intent ->> 'execution_kind', '')), ''));
    v_intent_state := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_intent ->> 'intent_state', '')), ''));
    v_intent_reason_code := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_intent ->> 'reason_code', '')), ''));
    v_intent_metadata := coalesce(v_intent -> 'metadata', '{}'::jsonb);

    if v_execution_kind not in ('installation', 'delivery', 'pickup', 'service_execution') then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_EXECUTION_KIND_INVALID';
    end if;

    if v_intent_state not in ('included', 'excluded', 'unresolved', 'conflict') then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_EXECUTION_INTENT_STATE_INVALID';
    end if;

    if v_intent_reason_code is not null and (
      pg_catalog.length(v_intent_reason_code) not between 3 and 120
      or v_intent_reason_code !~ '^[a-z0-9_:.\/-]+$'
    ) then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_EXECUTION_REASON_CODE_INVALID';
    end if;

    if pg_catalog.jsonb_typeof(v_intent_metadata) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_EXECUTION_METADATA_INVALID';
    end if;

    v_normalized_intents := v_normalized_intents || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'execution_kind', v_execution_kind,
        'intent_state', v_intent_state,
        'reason_code', v_intent_reason_code,
        'metadata', v_intent_metadata
      )
    );
  end loop;

  select coalesce(
    pg_catalog.jsonb_agg(intent_row.value order by intent_row.value ->> 'execution_kind'),
    '[]'::jsonb
  )
  into v_normalized_intents
  from pg_catalog.jsonb_array_elements(v_normalized_intents) intent_row(value);

  v_intent_total := pg_catalog.jsonb_array_length(v_normalized_intents);

  select pg_catalog.count(distinct intent_row.value ->> 'execution_kind')::integer
  into v_intent_unique
  from pg_catalog.jsonb_array_elements(v_normalized_intents) intent_row(value);

  if v_intent_unique <> v_intent_total then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_DUPLICATE_EXECUTION_KIND';
  end if;

  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_normalized_components) component_row(value)
    where component_row.value ->> 'component_state' = 'conflict'
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_normalized_intents) intent_row(value)
    where intent_row.value ->> 'intent_state' = 'conflict'
  )
  into v_has_conflict;

  select (
    v_component_total = 0
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_normalized_components) component_row(value)
      where component_row.value ->> 'component_state' = 'partial'
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_normalized_intents) intent_row(value)
      where intent_row.value ->> 'intent_state' = 'unresolved'
    )
  )
  into v_has_unresolved;

  if v_has_conflict and v_profile_state <> 'conflict' then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_CONFLICT_STATE_REQUIRED';
  end if;

  if v_profile_state = 'conflict' and not v_has_conflict then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_CONFLICT_STATE_WITHOUT_CONFLICT';
  end if;

  if v_profile_state = 'resolved' and (
    v_component_total = 0
    or v_has_conflict
    or v_has_unresolved
  ) then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_RESOLVED_STATE_INCONSISTENT';
  end if;

  if v_profile_state = 'needs_clarification' and (
    v_has_conflict
    or not v_has_unresolved
  ) then
    raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_NEEDS_CLARIFICATION_STATE_INCONSISTENT';
  end if;

  if not exists (
    select 1
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = p_commercial_opportunity_id
      and opportunity_row.organization_id = p_organization_id
      and opportunity_row.store_id = p_store_id
  ) then
    raise exception using errcode = '23503', message = 'ZION_OPPORTUNITY_PROFILE_OPPORTUNITY_SCOPE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_store_id::text || ':' || p_commercial_opportunity_id::text,
      0
    )
  );

  perform 1
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
  for update;

  select current_row.*
  into v_current
  from public.commercial_opportunity_profile_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id
  for update;

  v_has_current := found;

  select pg_catalog.count(*)::integer
  into v_history_count
  from public.commercial_opportunity_profile_versions version_row
  where version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id
    and version_row.commercial_opportunity_id = p_commercial_opportunity_id;

  if not v_has_current and v_history_count > 0 then
    raise exception using errcode = 'P0001', message = 'ZION_OPPORTUNITY_PROFILE_CURRENT_MISSING_WITH_HISTORY';
  end if;

  if v_has_current then
    select version_row.*
    into v_current_version
    from public.commercial_opportunity_profile_versions version_row
    where version_row.id = v_current.current_profile_version_id
      and version_row.organization_id = p_organization_id
      and version_row.store_id = p_store_id
      and version_row.commercial_opportunity_id = p_commercial_opportunity_id;

    if not found then
      raise exception using errcode = 'P0001', message = 'ZION_OPPORTUNITY_PROFILE_CURRENT_VERSION_INVALID';
    end if;
  end if;

  select version_row.*
  into v_existing
  from public.commercial_opportunity_profile_versions version_row
  where version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id
    and version_row.commercial_opportunity_id = p_commercial_opportunity_id
    and version_row.operation_key = v_operation_key;

  if found then
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'component_key', component_row.component_key,
          'component_kind', component_row.component_kind,
          'component_state', component_row.component_state,
          'pool_id', component_row.pool_id,
          'catalog_item_id', component_row.catalog_item_id,
          'reference_text', component_row.reference_text,
          'metadata', component_row.metadata,
          'quote_item_name', component_row.quote_item_name,
          'quote_item_description', component_row.quote_item_description,
          'quote_item_quantity', component_row.quote_item_quantity,
          'quote_item_unit_price_cents', component_row.quote_item_unit_price_cents,
          'quote_terms_authority_type', component_row.quote_terms_authority_type,
          'quote_terms_authority_user_id', component_row.quote_terms_authority_user_id,
          'quote_terms_origin_component_id', component_row.quote_terms_origin_component_id
        )
        order by component_row.component_key
      ),
      '[]'::jsonb
    )
    into v_existing_components
    from public.commercial_opportunity_profile_components component_row
    where component_row.organization_id = p_organization_id
      and component_row.store_id = p_store_id
      and component_row.commercial_opportunity_id = p_commercial_opportunity_id
      and component_row.profile_version_id = v_existing.id;

    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'execution_kind', intent_row.execution_kind,
          'intent_state', intent_row.intent_state,
          'reason_code', intent_row.reason_code,
          'metadata', intent_row.metadata
        )
        order by intent_row.execution_kind
      ),
      '[]'::jsonb
    )
    into v_existing_intents
    from public.commercial_opportunity_profile_execution_intents intent_row
    where intent_row.organization_id = p_organization_id
      and intent_row.store_id = p_store_id
      and intent_row.commercial_opportunity_id = p_commercial_opportunity_id
      and intent_row.profile_version_id = v_existing.id;

    if v_existing.request_fingerprint is distinct from v_request_fingerprint
       or v_existing.profile_state is distinct from v_profile_state
       or v_existing.actor_type is distinct from v_actor_type
       or v_existing.actor_user_id is distinct from p_actor_user_id
       or v_existing.source_type is distinct from v_source_type
       or v_existing.reason_code is distinct from v_reason_code
       or v_existing.created_by is distinct from v_created_by
       or v_existing.metadata is distinct from v_metadata
       or v_existing_components is distinct from v_normalized_components
       or v_existing_intents is distinct from v_normalized_intents then
      raise exception using errcode = '23505', message = 'ZION_OPPORTUNITY_PROFILE_IDEMPOTENCY_KEY_REUSED';
    end if;

    return query
    select
      v_existing.id,
      v_existing.version_number,
      v_existing.previous_profile_version_id,
      v_component_total,
      v_intent_total,
      v_current.current_profile_version_id,
      v_existing.profile_state,
      false,
      true,
      case
        when v_current.current_profile_version_id = v_existing.id
          then 'idempotent_replay_current'
        else 'idempotent_replay_stale'
      end,
      v_existing.created_at,
      v_current.updated_at;
    return;
  end if;

  -- New 6.1-B service/custom terms are enforced only for new profile versions.
  -- Exact idempotent replay of pre-6.1-B historical operations remains replayable.
  for v_component in
    select component_row.value
    from pg_catalog.jsonb_array_elements(v_normalized_components) component_row(value)
    where component_row.value ->> 'component_kind' in ('service', 'custom')
      and component_row.value ->> 'component_state' = 'resolved'
  loop
    v_quote_item_name := nullif(pg_catalog.btrim(coalesce(v_component ->> 'quote_item_name', '')), '');
    v_quote_item_description := nullif(pg_catalog.btrim(coalesce(v_component ->> 'quote_item_description', '')), '');
    v_quote_item_quantity := nullif(pg_catalog.btrim(coalesce(v_component ->> 'quote_item_quantity', '')), '')::integer;
    v_quote_item_unit_price_cents := nullif(pg_catalog.btrim(coalesce(v_component ->> 'quote_item_unit_price_cents', '')), '')::integer;
    v_quote_terms_authority_type := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(v_component ->> 'quote_terms_authority_type', '')), ''));
    v_quote_terms_authority_user_id := nullif(pg_catalog.btrim(coalesce(v_component ->> 'quote_terms_authority_user_id', '')), '')::uuid;
    v_quote_terms_origin_component_id := nullif(pg_catalog.btrim(coalesce(v_component ->> 'quote_terms_origin_component_id', '')), '')::uuid;

    if v_quote_item_name is null
       or v_quote_item_quantity is null
       or v_quote_item_quantity <= 0
       or v_quote_item_unit_price_cents is null
       or v_quote_item_unit_price_cents < 0
       or v_quote_terms_authority_type is distinct from 'human'
       or v_quote_terms_authority_user_id is null then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_QUOTE_TERMS_REQUIRED_FOR_TEXT_COMPONENT';
    end if;

    if pg_catalog.length(v_quote_item_name) > 500 then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_QUOTE_ITEM_NAME_INVALID';
    end if;

    if v_quote_item_description is not null
       and pg_catalog.length(v_quote_item_description) > 2000 then
      raise exception using errcode = '22023', message = 'ZION_OPPORTUNITY_PROFILE_QUOTE_ITEM_DESCRIPTION_INVALID';
    end if;

    if v_actor_type = 'human'
       and (
         v_quote_terms_authority_user_id is distinct from p_actor_user_id
         or v_quote_terms_origin_component_id is not null
       ) then
      raise exception using errcode = '42501', message = 'ZION_OPPORTUNITY_PROFILE_QUOTE_TERMS_HUMAN_AUTHORITY_FORGED';
    end if;

    if v_actor_type = 'system'
       and v_quote_terms_origin_component_id is null then
      raise exception using errcode = '42501', message = 'ZION_OPPORTUNITY_PROFILE_QUOTE_TERMS_SYSTEM_ORIGIN_REQUIRED';
    end if;
  end loop;

  if v_actor_type = 'system' then
    for v_component in
      select component_row.value
      from pg_catalog.jsonb_array_elements(v_normalized_components) component_row(value)
      where component_row.value ->> 'component_kind' in ('service', 'custom')
        and component_row.value ->> 'component_state' = 'resolved'
    loop
      if not v_has_current then
        raise exception using errcode = '42501', message = 'ZION_OPPORTUNITY_PROFILE_QUOTE_TERMS_SYSTEM_BASELINE_REQUIRED';
      end if;

      select origin_row.*
      into v_origin
      from public.commercial_opportunity_profile_components origin_row
      where origin_row.id = (v_component ->> 'quote_terms_origin_component_id')::uuid
        and origin_row.organization_id = p_organization_id
        and origin_row.store_id = p_store_id
        and origin_row.commercial_opportunity_id = p_commercial_opportunity_id
        and origin_row.profile_version_id = v_current_version.id
        and origin_row.component_key = v_component ->> 'component_key'
        and origin_row.component_kind = v_component ->> 'component_kind'
        and origin_row.component_state = 'resolved';

      if not found then
        raise exception using errcode = '42501', message = 'ZION_OPPORTUNITY_PROFILE_QUOTE_TERMS_SYSTEM_ORIGIN_INVALID';
      end if;

      if v_origin.quote_terms_authority_type is distinct from 'human'
         or v_origin.quote_terms_authority_user_id is null
         or v_origin.quote_item_name is null
         or v_origin.quote_item_quantity is null
         or v_origin.quote_item_unit_price_cents is null then
        raise exception using errcode = '42501', message = 'ZION_OPPORTUNITY_PROFILE_QUOTE_TERMS_SYSTEM_ORIGIN_NOT_CANONICAL';
      end if;

      if v_origin.quote_item_name is distinct from (v_component ->> 'quote_item_name')
         or v_origin.quote_item_description is distinct from (v_component ->> 'quote_item_description')
         or v_origin.quote_item_quantity is distinct from (v_component ->> 'quote_item_quantity')::integer
         or v_origin.quote_item_unit_price_cents is distinct from (v_component ->> 'quote_item_unit_price_cents')::integer
         or v_origin.quote_terms_authority_type is distinct from (v_component ->> 'quote_terms_authority_type')
         or v_origin.quote_terms_authority_user_id is distinct from (v_component ->> 'quote_terms_authority_user_id')::uuid then
        raise exception using errcode = '42501', message = 'ZION_OPPORTUNITY_PROFILE_QUOTE_TERMS_SYSTEM_CARRY_FORWARD_MISMATCH';
      end if;
    end loop;
  end if;

  if v_has_current then
    v_new_previous_id := v_current_version.id;
    v_new_version_number := v_current_version.version_number + 1;
  else
    v_new_previous_id := null;
    v_new_version_number := 1;
  end if;

  insert into public.commercial_opportunity_profile_versions (
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
  )
  values (
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_new_version_number,
    v_new_previous_id,
    v_profile_state,
    v_operation_key,
    v_request_fingerprint,
    v_actor_type,
    p_actor_user_id,
    v_source_type,
    v_reason_code,
    v_created_by,
    v_metadata
  )
  returning * into v_new;

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
    v_new.id,
    normalized_component.component_key,
    normalized_component.component_kind,
    normalized_component.component_state,
    normalized_component.pool_id,
    normalized_component.catalog_item_id,
    normalized_component.reference_text,
    normalized_component.metadata,
    normalized_component.quote_item_name,
    normalized_component.quote_item_description,
    normalized_component.quote_item_quantity,
    normalized_component.quote_item_unit_price_cents,
    normalized_component.quote_terms_authority_type,
    normalized_component.quote_terms_authority_user_id,
    normalized_component.quote_terms_origin_component_id
  from pg_catalog.jsonb_to_recordset(v_normalized_components) as normalized_component(
    component_key text,
    component_kind text,
    component_state text,
    pool_id uuid,
    catalog_item_id uuid,
    reference_text text,
    metadata jsonb,
    quote_item_name text,
    quote_item_description text,
    quote_item_quantity integer,
    quote_item_unit_price_cents integer,
    quote_terms_authority_type text,
    quote_terms_authority_user_id uuid,
    quote_terms_origin_component_id uuid
  );

  insert into public.commercial_opportunity_profile_execution_intents (
    organization_id,
    store_id,
    commercial_opportunity_id,
    profile_version_id,
    execution_kind,
    intent_state,
    reason_code,
    metadata
  )
  select
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_new.id,
    normalized_intent.execution_kind,
    normalized_intent.intent_state,
    normalized_intent.reason_code,
    normalized_intent.metadata
  from pg_catalog.jsonb_to_recordset(v_normalized_intents) as normalized_intent(
    execution_kind text,
    intent_state text,
    reason_code text,
    metadata jsonb
  );

  insert into public.commercial_opportunity_profile_current (
    organization_id,
    store_id,
    commercial_opportunity_id,
    current_profile_version_id,
    last_operation_key
  )
  values (
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_new.id,
    v_operation_key
  )
  on conflict (organization_id, store_id, commercial_opportunity_id) do update
  set
    current_profile_version_id = excluded.current_profile_version_id,
    last_operation_key = excluded.last_operation_key;

  select current_row.*
  into v_current
  from public.commercial_opportunity_profile_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id;

  return query
  select
    v_new.id,
    v_new.version_number,
    v_new.previous_profile_version_id,
    v_component_total,
    v_intent_total,
    v_current.current_profile_version_id,
    v_new.profile_state,
    true,
    false,
    'profile_version_created'::text,
    v_new.created_at,
    v_current.updated_at;
end;
$function$;

alter function public.write_commercial_opportunity_profile_internal(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, uuid, text, text, text, jsonb
) owner to postgres;

comment on function public.write_commercial_opportunity_profile_internal(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, uuid, text, text, text, jsonb
) is
  'Canonical P9 commercial opportunity profile writer. Creates append-only versions/components/intents, validates typed service/custom quote terms, preserves operation-key idempotency, and allows system carry-forward only from the immediately previous current component.';

revoke all on function public.write_commercial_opportunity_profile_internal(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, uuid, text, text, text, jsonb
) from public, anon, authenticated, service_role;

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
    raise exception using errcode = '42501', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_NOT_AUTHORIZED';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_quote_id is null then
    raise exception using errcode = '22023', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_SCOPE_REQUIRED';
  end if;

  select quote_row.*
  into v_quote
  from public.sales_quotes quote_row
  where quote_row.id = p_quote_id
    and quote_row.organization_id = p_organization_id
    and quote_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_QUOTE_NOT_FOUND';
  end if;

  if v_quote.commercial_opportunity_id is null then
    raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_QUOTE_OPPORTUNITY_REQUIRED';
  end if;

  select pg_catalog.count(*)::integer
  into v_legacy_item_count
  from public.sales_quote_items item_row
  where item_row.organization_id = p_organization_id
    and item_row.store_id = p_store_id
    and item_row.quote_id = p_quote_id
    and item_row.profile_component_id is null;

  if v_legacy_item_count > 0 then
    raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_LEGACY_ITEMS_PRESENT';
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
    raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_EXISTING_COMPONENT_REF_INVALID';
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
      raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_MULTIPLE_PROFILE_VERSIONS';
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
      raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_EXISTING_VERSION_INVALID';
    end if;

    if v_profile_version.profile_state <> 'resolved' then
      raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_EXISTING_VERSION_NOT_RESOLVED';
    end if;

    select pg_catalog.count(*)::integer
    into v_expected_component_count
    from public.commercial_opportunity_profile_components component_row
    where component_row.organization_id = p_organization_id
      and component_row.store_id = p_store_id
      and component_row.commercial_opportunity_id = v_quote.commercial_opportunity_id
      and component_row.profile_version_id = v_existing_version_id
      and component_row.component_state = 'resolved'
      and component_row.component_kind in ('pool', 'catalog_item', 'service', 'custom');

    if exists (
      select 1
      from public.commercial_opportunity_profile_components component_row
      where component_row.organization_id = p_organization_id
        and component_row.store_id = p_store_id
        and component_row.commercial_opportunity_id = v_quote.commercial_opportunity_id
        and component_row.profile_version_id = v_existing_version_id
        and component_row.component_state <> 'resolved'
    ) then
      raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_EXISTING_VERSION_HAS_UNRESOLVED_COMPONENT';
    end if;

    select pg_catalog.count(*)::integer
    into v_missing_component_count
    from public.commercial_opportunity_profile_components component_row
    where component_row.organization_id = p_organization_id
      and component_row.store_id = p_store_id
      and component_row.commercial_opportunity_id = v_quote.commercial_opportunity_id
      and component_row.profile_version_id = v_existing_version_id
      and component_row.component_state = 'resolved'
      and component_row.component_kind in ('pool', 'catalog_item', 'service', 'custom')
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
      raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_NO_MATERIALIZABLE_COMPONENTS';
    end if;

    if v_missing_component_count > 0 or v_extra_item_count > 0 then
      raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_EXISTING_ITEM_SET_MISMATCH';
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
    raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_CURRENT_PROFILE_REQUIRED';
  end if;

  select version_row.*
  into v_profile_version
  from public.commercial_opportunity_profile_versions version_row
  where version_row.id = v_current.current_profile_version_id
    and version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id
    and version_row.commercial_opportunity_id = v_quote.commercial_opportunity_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_CURRENT_VERSION_INVALID';
  end if;

  if v_profile_version.profile_state <> 'resolved' then
    raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_PROFILE_NOT_RESOLVED';
  end if;

  select pg_catalog.count(*)::integer
  into v_expected_component_count
  from public.commercial_opportunity_profile_components component_row
  where component_row.organization_id = p_organization_id
    and component_row.store_id = p_store_id
    and component_row.commercial_opportunity_id = v_quote.commercial_opportunity_id
    and component_row.profile_version_id = v_profile_version.id;

  if v_expected_component_count = 0 then
    raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_NO_COMPONENTS';
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
    raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_COMPONENT_NOT_RESOLVED';
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
    raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_POOL_SOURCE_NOT_USABLE';
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
    raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_CATALOG_SOURCE_NOT_USABLE';
  end if;

  if exists (
    select 1
    from public.commercial_opportunity_profile_components component_row
    where component_row.organization_id = p_organization_id
      and component_row.store_id = p_store_id
      and component_row.commercial_opportunity_id = v_quote.commercial_opportunity_id
      and component_row.profile_version_id = v_profile_version.id
      and component_row.component_kind in ('service', 'custom')
      and (
        component_row.quote_item_name is null
        or component_row.quote_item_quantity is null
        or component_row.quote_item_quantity <= 0
        or component_row.quote_item_unit_price_cents is null
        or component_row.quote_item_unit_price_cents < 0
        or component_row.quote_terms_authority_type is distinct from 'human'
        or component_row.quote_terms_authority_user_id is null
      )
  ) then
    raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_TEXT_COMPONENT_TERMS_NOT_USABLE';
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
      when component_row.component_kind = 'catalog_item' then catalog_row.name
      else component_row.quote_item_name
    end,
    case
      when component_row.component_kind = 'catalog_item' then catalog_row.sku
      else null
    end,
    case
      when component_row.component_kind = 'pool' then pool_row.description
      when component_row.component_kind = 'catalog_item' then catalog_row.description
      else component_row.quote_item_description
    end,
    case
      when component_row.component_kind in ('service', 'custom') then component_row.quote_item_quantity
      else 1
    end,
    case
      when component_row.component_kind = 'pool'
        then pg_catalog.round((pool_row.price)::numeric * 100)::integer
      when component_row.component_kind = 'catalog_item'
        then catalog_row.price_cents
      else component_row.quote_item_unit_price_cents
    end,
    0,
    case
      when component_row.component_kind = 'pool'
        then pg_catalog.round((pool_row.price)::numeric * 100)::integer
      when component_row.component_kind = 'catalog_item'
        then catalog_row.price_cents
      else component_row.quote_item_quantity * component_row.quote_item_unit_price_cents
    end,
    case
      when component_row.component_kind = 'pool'
        then pg_catalog.round((pool_row.price)::numeric * 100)::integer
      when component_row.component_kind = 'catalog_item'
        then catalog_row.price_cents
      else component_row.quote_item_quantity * component_row.quote_item_unit_price_cents
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
      'quote_terms_authority_type', component_row.quote_terms_authority_type,
      'quote_terms_authority_user_id', component_row.quote_terms_authority_user_id,
      'quote_terms_origin_component_id', component_row.quote_terms_origin_component_id,
      'materializer', 'materialize_sales_quote_items_from_current_profile_by_system',
      'materializer_version', 2,
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
    and component_row.component_kind in ('pool', 'catalog_item', 'service', 'custom')
    and (
      (
        component_row.component_kind = 'pool'
        and pool_row.id is not null
      )
      or (
        component_row.component_kind = 'catalog_item'
        and catalog_row.id is not null
      )
      or (
        component_row.component_kind in ('service', 'custom')
        and component_row.quote_item_name is not null
        and component_row.quote_item_quantity is not null
        and component_row.quote_item_quantity > 0
        and component_row.quote_item_unit_price_cents is not null
        and component_row.quote_item_unit_price_cents >= 0
        and component_row.quote_terms_authority_type = 'human'
        and component_row.quote_terms_authority_user_id is not null
      )
    )
  order by component_row.component_key, component_row.id;

  get diagnostics v_inserted_count = row_count;

  if v_inserted_count <> v_expected_component_count then
    raise exception using errcode = 'P0001', message = 'ZION_SALES_QUOTE_PROFILE_MATERIALIZER_MATERIALIZATION_COUNT_MISMATCH';
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
  'P9 6.1-B service-role canonical quote-item materializer. It snapshots current Profile pool/catalog/service/custom components into sales_quote_items once, preserves replay snapshots, and requires typed human-authorized quote terms for service/custom.';

revoke all on function public.materialize_sales_quote_items_from_current_profile_by_system(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.materialize_sales_quote_items_from_current_profile_by_system(
  uuid, uuid, uuid
) to service_role;

do $postconditions$
declare
  v_function_def text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute column_row
    where column_row.attrelid = 'public.commercial_opportunity_profile_components'::pg_catalog.regclass
      and column_row.attname in (
        'quote_item_name',
        'quote_item_description',
        'quote_item_quantity',
        'quote_item_unit_price_cents',
        'quote_terms_authority_type',
        'quote_terms_authority_user_id',
        'quote_terms_origin_component_id'
      )
    group by column_row.attrelid
    having pg_catalog.count(*) = 7
  ) then
    raise exception using errcode = 'P0001', message = 'postcondition failed: profile quote-term columns missing';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.materialize_sales_quote_items_from_current_profile_by_system(uuid,uuid,uuid)'::pg_catalog.regprocedure
  )
  into v_function_def;

  if position('''service''' in v_function_def) = 0
     or position('''custom''' in v_function_def) = 0
     or position('quote_item_quantity * component_row.quote_item_unit_price_cents' in v_function_def) = 0
     or position('materializer_version'', 2' in v_function_def) = 0 then
    raise exception using errcode = 'P0001', message = 'postcondition failed: materializer 6.1-B contract missing';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.write_commercial_opportunity_profile_internal(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,uuid,text,text,text,jsonb)'::pg_catalog.regprocedure
  )
  into v_function_def;

  if position('SET search_path TO ''pg_catalog'', ''public'', ''pg_temp''' in v_function_def) = 0
     or position('Exact idempotent replay of pre-6.1-B historical operations' in v_function_def) = 0 then
    raise exception using errcode = 'P0001', message = 'postcondition failed: profile writer 6.1-B replay/search_path hardening missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_opportunity_profile_components'::pg_catalog.regclass
      and constraint_row.conname = 'p9_profile_components_quote_terms_origin_kind_scope_fk'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid)
          like '%quote_terms_origin_component_id, organization_id, store_id, commercial_opportunity_id, component_kind%'
  ) then
    raise exception using errcode = 'P0001', message = 'postcondition failed: quote-term origin same-kind scope FK missing';
  end if;
end;
$postconditions$;

commit;
