begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, public, pg_temp;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('p9_cross_sell_acceptance_profile_writer', 0)
);

do $preflight$

begin

  if pg_catalog.to_regclass('public.messages') is null

     or pg_catalog.to_regclass('public.conversations') is null

     or pg_catalog.to_regclass('public.commercial_opportunities') is null

     or pg_catalog.to_regclass('public.pools') is null

     or pg_catalog.to_regclass('public.store_catalog_items') is null

     or pg_catalog.to_regclass('public.commercial_opportunity_profile_current') is null

     or pg_catalog.to_regclass('public.commercial_opportunity_profile_versions') is null

     or pg_catalog.to_regclass('public.commercial_opportunity_profile_components') is null

     or pg_catalog.to_regclass('public.commercial_opportunity_profile_execution_intents') is null

     or pg_catalog.to_regprocedure('public.write_commercial_opportunity_profile_internal(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,uuid,text,text,text,jsonb)') is null
     or pg_catalog.to_regclass('public.p9_profile_components_quote_item_kind_uidx') is null
     or pg_catalog.to_regclass('public.p9_profile_components_quote_item_pool_uidx') is null
     or pg_catalog.to_regclass('public.p9_profile_components_quote_item_catalog_uidx') is null
     or pg_catalog.to_regprocedure('public.zion_resolve_request_role_internal()') is null
     or pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: P9 cross-sell acceptance dependencies are missing';

  end if;

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
      and not column_row.attisdropped
    group by column_row.attrelid
    having pg_catalog.count(*) = 7
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: P9 6.1-B profile quote-term columns are missing';
  end if;

  if pg_catalog.to_regclass('public.commercial_opportunity_cross_sell_suggestions') is not null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: P9 cross-sell suggestion ledger already exists';
  end if;

end;

$preflight$;

create unique index if not exists p9_profile_components_cross_sell_acceptance_uidx
  on public.commercial_opportunity_profile_components (
    id,
    profile_version_id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    component_kind
  );

create table public.commercial_opportunity_cross_sell_suggestions (

  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null,

  store_id uuid not null,

  commercial_opportunity_id uuid not null,

  conversation_id uuid not null,

  suggestion_message_id uuid not null,

  candidate_kind text not null,

  pool_id uuid null,

  catalog_item_id uuid null,

  status text not null default 'suggested',

  suggestion_operation_key text not null,

  suggestion_request_fingerprint text not null,

  acceptance_operation_key text null,

  acceptance_request_fingerprint text null,

  terminal_operation_key text null,

  terminal_request_fingerprint text null,

  customer_evidence_message_id uuid null,

  accepted_profile_version_id uuid null,

  accepted_profile_component_id uuid null,

  metadata jsonb not null default '{}'::jsonb,

  acceptance_metadata jsonb null,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  accepted_at timestamptz null,

  terminal_at timestamptz null,

  constraint p9_cross_sell_suggestions_org_fk

    foreign key (organization_id)

    references public.organizations(id)

    on delete restrict,

  constraint p9_cross_sell_suggestions_store_scope_fk

    foreign key (store_id, organization_id)

    references public.stores(id, organization_id)

    on delete restrict,

  constraint p9_cross_sell_suggestions_opp_scope_fk

    foreign key (commercial_opportunity_id, organization_id, store_id)

    references public.commercial_opportunities(id, organization_id, store_id)

    on delete restrict,

  constraint p9_cross_sell_suggestions_conversation_fk

    foreign key (conversation_id)

    references public.conversations(id)

    on delete restrict,

  constraint p9_cross_sell_suggestions_suggestion_message_fk

    foreign key (suggestion_message_id)

    references public.messages(id)

    on delete restrict,

  constraint p9_cross_sell_suggestions_evidence_message_fk

    foreign key (customer_evidence_message_id)

    references public.messages(id)

    on delete restrict,

  constraint p9_cross_sell_suggestions_pool_scope_fk

    foreign key (pool_id, organization_id, store_id)

    references public.pools(id, organization_id, store_id)

    on delete restrict,

  constraint p9_cross_sell_suggestions_catalog_scope_fk

    foreign key (catalog_item_id, organization_id, store_id)

    references public.store_catalog_items(id, organization_id, store_id)

    on delete restrict,

  constraint p9_cross_sell_suggestions_profile_version_scope_fk

    foreign key (

      accepted_profile_version_id,

      organization_id,

      store_id,

      commercial_opportunity_id

    )

    references public.commercial_opportunity_profile_versions(

      id,

      organization_id,

      store_id,

      commercial_opportunity_id

    )

    on delete restrict,

  constraint p9_cross_sell_suggestions_profile_component_version_kind_fk
    foreign key (
      accepted_profile_component_id,
      accepted_profile_version_id,
      organization_id,
      store_id,
      commercial_opportunity_id,
      candidate_kind
    )
    references public.commercial_opportunity_profile_components (
      id,
      profile_version_id,
      organization_id,
      store_id,
      commercial_opportunity_id,
      component_kind
    )
    on delete restrict,

  constraint p9_cross_sell_suggestions_profile_component_pool_fk
    foreign key (
      accepted_profile_component_id,
      organization_id,
      store_id,
      commercial_opportunity_id,
      candidate_kind,
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
    on delete restrict,

  constraint p9_cross_sell_suggestions_profile_component_catalog_fk
    foreign key (
      accepted_profile_component_id,
      organization_id,
      store_id,
      commercial_opportunity_id,
      candidate_kind,
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
    on delete restrict,

  constraint p9_cross_sell_suggestions_kind_chk

    check (candidate_kind in ('pool', 'catalog_item')),

  constraint p9_cross_sell_suggestions_candidate_shape_chk

    check (

      (candidate_kind = 'pool' and pool_id is not null and catalog_item_id is null)

      or (candidate_kind = 'catalog_item' and catalog_item_id is not null and pool_id is null)

    ),

  constraint p9_cross_sell_suggestions_status_chk

    check (status in ('suggested', 'accepted', 'rejected', 'superseded')),

  constraint p9_cross_sell_suggestions_suggestion_operation_key_chk

    check (

      suggestion_operation_key = pg_catalog.btrim(suggestion_operation_key)

      and pg_catalog.length(suggestion_operation_key) between 1 and 200

    ),

  constraint p9_cross_sell_suggestions_suggestion_fingerprint_chk

    check (

      pg_catalog.length(suggestion_request_fingerprint) = 64

      and suggestion_request_fingerprint ~ '^[0-9a-f]{64}$'

    ),

  constraint p9_cross_sell_suggestions_acceptance_operation_key_chk

    check (

      acceptance_operation_key is null

      or (

        acceptance_operation_key = pg_catalog.btrim(acceptance_operation_key)

        and pg_catalog.length(acceptance_operation_key) between 1 and 200

      )

    ),

  constraint p9_cross_sell_suggestions_acceptance_fingerprint_chk

    check (

      acceptance_request_fingerprint is null

      or (

        pg_catalog.length(acceptance_request_fingerprint) = 64

        and acceptance_request_fingerprint ~ '^[0-9a-f]{64}$'

      )

    ),

  constraint p9_cross_sell_suggestions_terminal_operation_key_chk

    check (

      terminal_operation_key is null

      or (

        terminal_operation_key = pg_catalog.btrim(terminal_operation_key)

        and pg_catalog.length(terminal_operation_key) between 1 and 200

      )

    ),

  constraint p9_cross_sell_suggestions_terminal_fingerprint_chk

    check (

      terminal_request_fingerprint is null

      or (

        pg_catalog.length(terminal_request_fingerprint) = 64

        and terminal_request_fingerprint ~ '^[0-9a-f]{64}$'

      )

    ),

  constraint p9_cross_sell_suggestions_status_shape_chk

    check (

      (

        status = 'suggested'

        and acceptance_operation_key is null

        and acceptance_request_fingerprint is null

        and terminal_operation_key is null

        and terminal_request_fingerprint is null

        and customer_evidence_message_id is null
        and acceptance_metadata is null

        and accepted_profile_version_id is null

        and accepted_profile_component_id is null

        and accepted_at is null

        and terminal_at is null

      )

      or (

        status = 'accepted'

        and acceptance_operation_key is not null

        and acceptance_request_fingerprint is not null

        and terminal_operation_key is null

        and terminal_request_fingerprint is null

        and customer_evidence_message_id is not null
        and acceptance_metadata is not null

        and accepted_profile_version_id is not null

        and accepted_profile_component_id is not null

        and accepted_at is not null

        and terminal_at is null

      )

      or (

        status in ('rejected', 'superseded')

        and acceptance_operation_key is null

        and acceptance_request_fingerprint is null

        and terminal_operation_key is not null

        and terminal_request_fingerprint is not null

        and customer_evidence_message_id is null
        and acceptance_metadata is null

        and accepted_profile_version_id is null

        and accepted_profile_component_id is null

        and accepted_at is null

        and terminal_at is not null

      )

    ),

  constraint p9_cross_sell_suggestions_metadata_chk
    check (pg_catalog.jsonb_typeof(metadata) = 'object'),

  constraint p9_cross_sell_suggestions_acceptance_metadata_chk
    check (
      acceptance_metadata is null
      or pg_catalog.jsonb_typeof(acceptance_metadata) = 'object'
    )

);

create unique index p9_cross_sell_suggestions_scope_suggestion_op_uidx

  on public.commercial_opportunity_cross_sell_suggestions (

    organization_id,

    store_id,

    commercial_opportunity_id,

    suggestion_operation_key

  );

create unique index p9_cross_sell_suggestions_scope_acceptance_op_uidx

  on public.commercial_opportunity_cross_sell_suggestions (

    organization_id,

    store_id,

    commercial_opportunity_id,

    acceptance_operation_key

  )

  where acceptance_operation_key is not null;

create unique index p9_cross_sell_suggestions_scope_terminal_op_uidx

  on public.commercial_opportunity_cross_sell_suggestions (

    organization_id,

    store_id,

    commercial_opportunity_id,

    terminal_operation_key

  )

  where terminal_operation_key is not null;

create index p9_cross_sell_suggestions_scope_status_idx

  on public.commercial_opportunity_cross_sell_suggestions (

    organization_id,

    store_id,

    commercial_opportunity_id,

    conversation_id,

    status,

    created_at

  );

create index p9_cross_sell_suggestions_candidate_idx

  on public.commercial_opportunity_cross_sell_suggestions (

    organization_id,

    store_id,

    commercial_opportunity_id,

    candidate_kind,

    pool_id,

    catalog_item_id,

    status

  );

create or replace function public.touch_p9_cross_sell_suggestion_updated_at()

returns trigger

language plpgsql

set search_path = pg_catalog, public, pg_temp

as $function$

begin

  new.updated_at := now();

  return new;

end;

$function$;

drop trigger if exists p9_cross_sell_suggestions_touch_updated_at

  on public.commercial_opportunity_cross_sell_suggestions;

create trigger p9_cross_sell_suggestions_touch_updated_at

  before update on public.commercial_opportunity_cross_sell_suggestions

  for each row

  execute function public.touch_p9_cross_sell_suggestion_updated_at();

create or replace function public.record_commercial_cross_sell_suggestion_by_system(

  p_organization_id uuid,

  p_store_id uuid,

  p_commercial_opportunity_id uuid,

  p_conversation_id uuid,

  p_suggestion_message_id uuid,

  p_candidate_kind text,

  p_pool_id uuid default null,

  p_catalog_item_id uuid default null,

  p_operation_key text default null,

  p_request_fingerprint text default null,

  p_metadata jsonb default '{}'::jsonb

)

returns table (

  suggestion_id uuid,

  status text,

  replayed boolean,

  outcome text

)

language plpgsql

security definer

set search_path = pg_catalog, public, pg_temp

set row_security = off

as $function$

declare

  v_request_role text := public.zion_resolve_request_role_internal();

  v_candidate_kind text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_candidate_kind, '')), ''));

  v_operation_key text := nullif(pg_catalog.btrim(coalesce(p_operation_key, '')), '');

  v_request_fingerprint text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_request_fingerprint, '')), ''));

  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);

  v_existing public.commercial_opportunity_cross_sell_suggestions%rowtype;

  v_inserted public.commercial_opportunity_cross_sell_suggestions%rowtype;

  v_message public.messages%rowtype;

  v_opportunity public.commercial_opportunities%rowtype;

begin

  if v_request_role is distinct from 'service_role' then

    raise exception using errcode = '42501', message = 'ZION_CROSS_SELL_SYSTEM_WRITER_REQUIRED';

  end if;

  if p_organization_id is null

     or p_store_id is null

     or p_commercial_opportunity_id is null

     or p_conversation_id is null

     or p_suggestion_message_id is null then

    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_SCOPE_REQUIRED';

  end if;

  if v_operation_key is null or pg_catalog.length(v_operation_key) > 200 then

    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_OPERATION_KEY_INVALID';

  end if;

  if v_request_fingerprint is null

     or pg_catalog.length(v_request_fingerprint) <> 64

     or v_request_fingerprint !~ '^[0-9a-f]{64}$' then

    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_REQUEST_FINGERPRINT_INVALID';

  end if;

  if v_candidate_kind not in ('pool', 'catalog_item') then

    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_CANDIDATE_KIND_INVALID';

  end if;

  if not (

    (v_candidate_kind = 'pool' and p_pool_id is not null and p_catalog_item_id is null)

    or (v_candidate_kind = 'catalog_item' and p_catalog_item_id is not null and p_pool_id is null)

  ) then

    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_CANDIDATE_SHAPE_INVALID';

  end if;

  if pg_catalog.jsonb_typeof(v_metadata) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_METADATA_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:cross-sell:' || p_organization_id::text || ':' || p_store_id::text || ':' || p_commercial_opportunity_id::text,
      0
    )
  );

  select opportunity_row.*

  into v_opportunity

  from public.commercial_opportunities opportunity_row

  where opportunity_row.id = p_commercial_opportunity_id

    and opportunity_row.organization_id = p_organization_id

    and opportunity_row.store_id = p_store_id

  for update;

  if not found then

    raise exception using errcode = '23503', message = 'ZION_CROSS_SELL_OPPORTUNITY_SCOPE_INVALID';

  end if;

  if v_opportunity.primary_conversation_id is distinct from p_conversation_id then

    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_CONVERSATION_NOT_OPPORTUNITY_PRIMARY';

  end if;

  select message_row.*

  into v_message

  from public.messages message_row

  where message_row.id = p_suggestion_message_id

    and message_row.organization_id = p_organization_id

    and message_row.store_id = p_store_id

    and message_row.conversation_id = p_conversation_id;

  if not found then

    raise exception using errcode = '23503', message = 'ZION_CROSS_SELL_SUGGESTION_MESSAGE_SCOPE_INVALID';

  end if;

  if v_message.direction is distinct from 'outgoing'

     or v_message.sender is distinct from 'ai' then

    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_SUGGESTION_MESSAGE_NOT_AI_OUTBOUND';

  end if;

  if v_candidate_kind = 'pool' and not exists (

    select 1

    from public.pools pool_row

    where pool_row.id = p_pool_id

      and pool_row.organization_id = p_organization_id

      and pool_row.store_id = p_store_id

  ) then

    raise exception using errcode = '23503', message = 'ZION_CROSS_SELL_POOL_SCOPE_INVALID';

  end if;

  if v_candidate_kind = 'catalog_item' and not exists (
    select 1
    from public.store_catalog_items item_row
    where item_row.id = p_catalog_item_id
      and item_row.organization_id = p_organization_id
      and item_row.store_id = p_store_id
  ) then
    raise exception using errcode = '23503', message = 'ZION_CROSS_SELL_CATALOG_ITEM_SCOPE_INVALID';
  end if;

  if v_candidate_kind = 'pool' and not exists (
    select 1
    from public.pools pool_row
    where pool_row.id = p_pool_id
      and pool_row.organization_id = p_organization_id
      and pool_row.store_id = p_store_id
      and pool_row.is_active is true
      and pool_row.price_status = 'valid'
      and pool_row.price is not null
      and pool_row.price >= 0
  ) then
    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_POOL_SOURCE_NOT_USABLE';
  end if;

  if v_candidate_kind = 'catalog_item' and not exists (
    select 1
    from public.store_catalog_items item_row
    where item_row.id = p_catalog_item_id
      and item_row.organization_id = p_organization_id
      and item_row.store_id = p_store_id
      and item_row.is_active is true
      and item_row.price_status = 'valid'
      and item_row.price_cents is not null
      and item_row.price_cents >= 0
  ) then
    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_CATALOG_SOURCE_NOT_USABLE';
  end if;

  select suggestion_row.*

  into v_existing

  from public.commercial_opportunity_cross_sell_suggestions suggestion_row

  where suggestion_row.organization_id = p_organization_id

    and suggestion_row.store_id = p_store_id

    and suggestion_row.commercial_opportunity_id = p_commercial_opportunity_id

    and suggestion_row.suggestion_operation_key = v_operation_key;

  if found then

    if v_existing.conversation_id is distinct from p_conversation_id

       or v_existing.suggestion_message_id is distinct from p_suggestion_message_id

       or v_existing.candidate_kind is distinct from v_candidate_kind

       or v_existing.pool_id is distinct from p_pool_id

       or v_existing.catalog_item_id is distinct from p_catalog_item_id

       or v_existing.suggestion_request_fingerprint is distinct from v_request_fingerprint

       or v_existing.metadata is distinct from v_metadata then

      raise exception using errcode = '23505', message = 'ZION_CROSS_SELL_SUGGESTION_OPERATION_KEY_REUSED';

    end if;

    return query

    select v_existing.id, v_existing.status, true, 'idempotent_replay'::text;

    return;

  end if;

  insert into public.commercial_opportunity_cross_sell_suggestions (

    organization_id,

    store_id,

    commercial_opportunity_id,

    conversation_id,

    suggestion_message_id,

    candidate_kind,

    pool_id,

    catalog_item_id,

    suggestion_operation_key,

    suggestion_request_fingerprint,

    metadata

  )

  values (

    p_organization_id,

    p_store_id,

    p_commercial_opportunity_id,

    p_conversation_id,

    p_suggestion_message_id,

    v_candidate_kind,

    p_pool_id,

    p_catalog_item_id,

    v_operation_key,

    v_request_fingerprint,

    v_metadata

  )

  returning * into v_inserted;

  return query

  select v_inserted.id, v_inserted.status, false, 'suggestion_recorded'::text;

end;

$function$;

create or replace function public.set_commercial_cross_sell_suggestion_status_by_system(

  p_organization_id uuid,

  p_store_id uuid,

  p_commercial_opportunity_id uuid,

  p_suggestion_id uuid,

  p_status text,

  p_operation_key text,

  p_request_fingerprint text

)

returns table (

  suggestion_id uuid,

  status text,

  replayed boolean,

  outcome text

)

language plpgsql

security definer

set search_path = pg_catalog, public, pg_temp

set row_security = off

as $function$

declare

  v_request_role text := public.zion_resolve_request_role_internal();

  v_status text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_status, '')), ''));

  v_operation_key text := nullif(pg_catalog.btrim(coalesce(p_operation_key, '')), '');

  v_request_fingerprint text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_request_fingerprint, '')), ''));

  v_suggestion public.commercial_opportunity_cross_sell_suggestions%rowtype;

begin

  if v_request_role is distinct from 'service_role' then

    raise exception using errcode = '42501', message = 'ZION_CROSS_SELL_SYSTEM_WRITER_REQUIRED';

  end if;

  if v_status not in ('rejected', 'superseded') then

    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_TERMINAL_STATUS_INVALID';

  end if;

  if v_operation_key is null or pg_catalog.length(v_operation_key) > 200 then

    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_OPERATION_KEY_INVALID';

  end if;

  if v_request_fingerprint is null
     or pg_catalog.length(v_request_fingerprint) <> 64
     or v_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_REQUEST_FINGERPRINT_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:cross-sell:' || p_organization_id::text || ':' || p_store_id::text || ':' || p_commercial_opportunity_id::text,
      0
    )
  );

  select suggestion_row.*

  into v_suggestion

  from public.commercial_opportunity_cross_sell_suggestions suggestion_row

  where suggestion_row.id = p_suggestion_id

    and suggestion_row.organization_id = p_organization_id

    and suggestion_row.store_id = p_store_id

    and suggestion_row.commercial_opportunity_id = p_commercial_opportunity_id

  for update;

  if not found then

    raise exception using errcode = '23503', message = 'ZION_CROSS_SELL_SUGGESTION_SCOPE_INVALID';

  end if;

  if v_suggestion.status = v_status

     and v_suggestion.terminal_operation_key is not distinct from v_operation_key

     and v_suggestion.terminal_request_fingerprint is not distinct from v_request_fingerprint then

    return query

    select v_suggestion.id, v_suggestion.status, true, 'idempotent_replay'::text;

    return;

  end if;

  if v_suggestion.status is distinct from 'suggested' then

    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_SUGGESTION_NOT_ACTIVE';

  end if;

  update public.commercial_opportunity_cross_sell_suggestions suggestion_row

  set

    status = v_status,

    terminal_operation_key = v_operation_key,

    terminal_request_fingerprint = v_request_fingerprint,

    terminal_at = now()

  where suggestion_row.id = v_suggestion.id

  returning * into v_suggestion;

  return query

  select v_suggestion.id, v_suggestion.status, false, 'suggestion_' || v_status;

end;

$function$;

create or replace function public.accept_commercial_cross_sell_suggestion_by_system(

  p_organization_id uuid,

  p_store_id uuid,

  p_commercial_opportunity_id uuid,

  p_suggestion_id uuid,

  p_customer_evidence_message_id uuid,

  p_operation_key text,

  p_request_fingerprint text,

  p_metadata jsonb default '{}'::jsonb

)

returns table (

  suggestion_id uuid,

  accepted_profile_version_id uuid,

  accepted_profile_component_id uuid,

  profile_changed boolean,

  replayed boolean,

  outcome text

)

language plpgsql

security definer

set search_path = pg_catalog, public, pg_temp

set row_security = off

as $function$

declare

  v_request_role text := public.zion_resolve_request_role_internal();

  v_operation_key text := nullif(pg_catalog.btrim(coalesce(p_operation_key, '')), '');

  v_request_fingerprint text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_request_fingerprint, '')), ''));

  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);

  v_suggestion public.commercial_opportunity_cross_sell_suggestions%rowtype;

  v_suggestion_message public.messages%rowtype;

  v_evidence_message public.messages%rowtype;

  v_opportunity public.commercial_opportunities%rowtype;

  v_current public.commercial_opportunity_profile_current%rowtype;

  v_current_version public.commercial_opportunity_profile_versions%rowtype;

  v_existing_component public.commercial_opportunity_profile_components%rowtype;

  v_component_key text;

  v_components jsonb := '[]'::jsonb;

  v_intents jsonb := '[]'::jsonb;

  v_profile_operation_key text;

  v_profile_fingerprint text;

  v_profile_result record;

  v_profile_component_id uuid;

  v_existing_candidate_count integer := 0;

begin

  if v_request_role is distinct from 'service_role' then

    raise exception using errcode = '42501', message = 'ZION_CROSS_SELL_SYSTEM_WRITER_REQUIRED';

  end if;

  if p_organization_id is null

     or p_store_id is null

     or p_commercial_opportunity_id is null

     or p_suggestion_id is null

     or p_customer_evidence_message_id is null then

    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_ACCEPTANCE_SCOPE_REQUIRED';

  end if;

  if v_operation_key is null or pg_catalog.length(v_operation_key) > 200 then

    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_OPERATION_KEY_INVALID';

  end if;

  if v_request_fingerprint is null

     or pg_catalog.length(v_request_fingerprint) <> 64

     or v_request_fingerprint !~ '^[0-9a-f]{64}$' then

    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_REQUEST_FINGERPRINT_INVALID';

  end if;

  if pg_catalog.jsonb_typeof(v_metadata) is distinct from 'object' then

    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_METADATA_INVALID';

  end if;

  perform pg_catalog.pg_advisory_xact_lock(

    pg_catalog.hashtextextended(

      'zion:p9:cross-sell:' || p_organization_id::text || ':' || p_store_id::text || ':' || p_commercial_opportunity_id::text,

      0

    )

  );

  select suggestion_row.*

  into v_suggestion

  from public.commercial_opportunity_cross_sell_suggestions suggestion_row

  where suggestion_row.id = p_suggestion_id

    and suggestion_row.organization_id = p_organization_id

    and suggestion_row.store_id = p_store_id

    and suggestion_row.commercial_opportunity_id = p_commercial_opportunity_id

  for update;

  if not found then

    raise exception using errcode = '23503', message = 'ZION_CROSS_SELL_SUGGESTION_SCOPE_INVALID';

  end if;

  if v_suggestion.status = 'accepted' then

    if v_suggestion.acceptance_operation_key is not distinct from v_operation_key

       and v_suggestion.acceptance_request_fingerprint is not distinct from v_request_fingerprint
       and v_suggestion.customer_evidence_message_id is not distinct from p_customer_evidence_message_id
       and v_suggestion.acceptance_metadata is not distinct from v_metadata then

      return query

      select

        v_suggestion.id,

        v_suggestion.accepted_profile_version_id,

        v_suggestion.accepted_profile_component_id,

        false,

        true,

        'idempotent_replay'::text;

      return;

    end if;

    raise exception using errcode = '23505', message = 'ZION_CROSS_SELL_ACCEPTANCE_OPERATION_KEY_REUSED';

  end if;

  if v_suggestion.status is distinct from 'suggested' then
    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_SUGGESTION_NOT_ACTIVE';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'ZION_CROSS_SELL_OPPORTUNITY_SCOPE_INVALID';
  end if;

  if v_opportunity.primary_conversation_id is distinct from v_suggestion.conversation_id then
    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_CONVERSATION_NOT_OPPORTUNITY_PRIMARY';
  end if;

  select message_row.*

  into v_suggestion_message

  from public.messages message_row

  where message_row.id = v_suggestion.suggestion_message_id

    and message_row.organization_id = p_organization_id

    and message_row.store_id = p_store_id

    and message_row.conversation_id = v_suggestion.conversation_id

    and message_row.direction = 'outgoing'

    and message_row.sender = 'ai';

  if not found then

    raise exception using errcode = '23503', message = 'ZION_CROSS_SELL_SUGGESTION_MESSAGE_INVALID';

  end if;

  select message_row.*

  into v_evidence_message

  from public.messages message_row

  where message_row.id = p_customer_evidence_message_id

    and message_row.organization_id = p_organization_id

    and message_row.store_id = p_store_id

    and message_row.conversation_id = v_suggestion.conversation_id

    and message_row.direction = 'incoming'

    and message_row.sender = 'user';

  if not found then

    raise exception using errcode = '23503', message = 'ZION_CROSS_SELL_EVIDENCE_MESSAGE_INVALID';

  end if;

  if v_evidence_message.created_at <= v_suggestion_message.created_at then

    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_EVIDENCE_NOT_AFTER_SUGGESTION';

  end if;

  if v_suggestion.candidate_kind = 'pool' and not exists (
    select 1
    from public.pools pool_row
    where pool_row.id = v_suggestion.pool_id
      and pool_row.organization_id = p_organization_id
      and pool_row.store_id = p_store_id
  ) then
    raise exception using errcode = '23503', message = 'ZION_CROSS_SELL_POOL_SCOPE_INVALID';
  end if;

  if v_suggestion.candidate_kind = 'pool' and not exists (
    select 1
    from public.pools pool_row
    where pool_row.id = v_suggestion.pool_id
      and pool_row.organization_id = p_organization_id
      and pool_row.store_id = p_store_id
      and pool_row.is_active is true
      and pool_row.price_status = 'valid'
      and pool_row.price is not null
      and pool_row.price >= 0
  ) then
    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_POOL_SOURCE_NOT_USABLE';
  end if;

  if v_suggestion.candidate_kind = 'catalog_item' and not exists (
    select 1
    from public.store_catalog_items item_row
    where item_row.id = v_suggestion.catalog_item_id
      and item_row.organization_id = p_organization_id
      and item_row.store_id = p_store_id
  ) then
    raise exception using errcode = '23503', message = 'ZION_CROSS_SELL_CATALOG_ITEM_SCOPE_INVALID';
  end if;

  if v_suggestion.candidate_kind = 'catalog_item' and not exists (
    select 1
    from public.store_catalog_items item_row
    where item_row.id = v_suggestion.catalog_item_id
      and item_row.organization_id = p_organization_id
      and item_row.store_id = p_store_id
      and item_row.is_active is true
      and item_row.price_status = 'valid'
      and item_row.price_cents is not null
      and item_row.price_cents >= 0
  ) then
    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_CATALOG_SOURCE_NOT_USABLE';
  end if;

  select current_row.*

  into v_current

  from public.commercial_opportunity_profile_current current_row

  where current_row.organization_id = p_organization_id

    and current_row.store_id = p_store_id

    and current_row.commercial_opportunity_id = p_commercial_opportunity_id

  for update;

  if not found then

    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_CURRENT_PROFILE_REQUIRED';

  end if;

  select version_row.*

  into v_current_version

  from public.commercial_opportunity_profile_versions version_row

  where version_row.id = v_current.current_profile_version_id

    and version_row.organization_id = p_organization_id

    and version_row.store_id = p_store_id

    and version_row.commercial_opportunity_id = p_commercial_opportunity_id;

  if not found then

    raise exception using errcode = 'P0001', message = 'ZION_CROSS_SELL_CURRENT_PROFILE_VERSION_INVALID';

  end if;

  v_component_key := case

    when v_suggestion.candidate_kind = 'pool'

      then 'cross_sell:pool:' || v_suggestion.pool_id::text

    else 'cross_sell:catalog_item:' || v_suggestion.catalog_item_id::text

  end;

  select pg_catalog.count(*)::integer
  into v_existing_candidate_count
  from public.commercial_opportunity_profile_components component_row
  where component_row.organization_id = p_organization_id
    and component_row.store_id = p_store_id
    and component_row.commercial_opportunity_id = p_commercial_opportunity_id
    and component_row.profile_version_id = v_current_version.id
    and (
      (
        v_suggestion.candidate_kind = 'pool'
        and component_row.component_kind = 'pool'
        and component_row.pool_id = v_suggestion.pool_id
      )
      or (
        v_suggestion.candidate_kind = 'catalog_item'
        and component_row.component_kind = 'catalog_item'
        and component_row.catalog_item_id = v_suggestion.catalog_item_id
      )
    );

  if v_existing_candidate_count > 1 then
    raise exception using errcode = 'P0001', message = 'ZION_CROSS_SELL_CANDIDATE_ALREADY_PRESENT_AMBIGUOUS';
  end if;

  if v_existing_candidate_count = 1 then
    select component_row.*
    into strict v_existing_component
    from public.commercial_opportunity_profile_components component_row
    where component_row.organization_id = p_organization_id
      and component_row.store_id = p_store_id
      and component_row.commercial_opportunity_id = p_commercial_opportunity_id
      and component_row.profile_version_id = v_current_version.id
      and (
        (
          v_suggestion.candidate_kind = 'pool'
          and component_row.component_kind = 'pool'
          and component_row.pool_id = v_suggestion.pool_id
        )
        or (
          v_suggestion.candidate_kind = 'catalog_item'
          and component_row.component_kind = 'catalog_item'
          and component_row.catalog_item_id = v_suggestion.catalog_item_id
        )
      );

    if v_existing_component.component_state is distinct from 'resolved' then
      raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_CANDIDATE_ALREADY_PRESENT_NOT_RESOLVED';
    end if;

    update public.commercial_opportunity_cross_sell_suggestions suggestion_row
    set
      status = 'accepted',
      acceptance_operation_key = v_operation_key,
      acceptance_request_fingerprint = v_request_fingerprint,
      customer_evidence_message_id = p_customer_evidence_message_id,
      acceptance_metadata = v_metadata,
      accepted_profile_version_id = v_current_version.id,
      accepted_profile_component_id = v_existing_component.id,
      accepted_at = now()
    where suggestion_row.id = v_suggestion.id
    returning * into v_suggestion;

    return query
    select
      v_suggestion.id,
      v_current_version.id,
      v_existing_component.id,
      false,
      false,
      'candidate_already_in_current_profile'::text;
    return;
  end if;

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

        'quote_terms_origin_component_id',

          case

            when component_row.component_kind in ('service', 'custom')

             and component_row.component_state = 'resolved'

             and component_row.quote_terms_authority_type = 'human'

              then component_row.id

            else null

          end

      )

      order by component_row.component_key

    ),

    '[]'::jsonb

  )

  into v_components

  from public.commercial_opportunity_profile_components component_row

  where component_row.organization_id = p_organization_id

    and component_row.store_id = p_store_id

    and component_row.commercial_opportunity_id = p_commercial_opportunity_id

    and component_row.profile_version_id = v_current_version.id;

  v_components := v_components || pg_catalog.jsonb_build_array(

    case

      when v_suggestion.candidate_kind = 'pool' then

        pg_catalog.jsonb_build_object(

          'component_key', v_component_key,

          'component_kind', 'pool',

          'component_state', 'resolved',

          'pool_id', v_suggestion.pool_id,

          'catalog_item_id', null,

          'reference_text', null,

          'metadata', pg_catalog.jsonb_build_object(

            'origin', 'p9_6.1_c_cross_sell_acceptance',

            'cross_sell_suggestion_id', v_suggestion.id,

            'suggestion_message_id', v_suggestion.suggestion_message_id,

            'customer_evidence_message_id', p_customer_evidence_message_id

          )

        )

      else

        pg_catalog.jsonb_build_object(

          'component_key', v_component_key,

          'component_kind', 'catalog_item',

          'component_state', 'resolved',

          'pool_id', null,

          'catalog_item_id', v_suggestion.catalog_item_id,

          'reference_text', null,

          'metadata', pg_catalog.jsonb_build_object(

            'origin', 'p9_6.1_c_cross_sell_acceptance',

            'cross_sell_suggestion_id', v_suggestion.id,

            'suggestion_message_id', v_suggestion.suggestion_message_id,

            'customer_evidence_message_id', p_customer_evidence_message_id

          )

        )

    end

  );

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

  into v_intents

  from public.commercial_opportunity_profile_execution_intents intent_row

  where intent_row.organization_id = p_organization_id

    and intent_row.store_id = p_store_id

    and intent_row.commercial_opportunity_id = p_commercial_opportunity_id

    and intent_row.profile_version_id = v_current_version.id;

  v_profile_operation_key := 'zion:cross-sell-profile:' || v_suggestion.id::text;

  v_profile_fingerprint := pg_catalog.encode(

    extensions.digest(

      convert_to(

        pg_catalog.jsonb_build_object(

          'current_profile_version_id', v_current_version.id,

          'suggestion_id', v_suggestion.id,

          'customer_evidence_message_id', p_customer_evidence_message_id,

          'candidate_kind', v_suggestion.candidate_kind,

          'pool_id', v_suggestion.pool_id,

          'catalog_item_id', v_suggestion.catalog_item_id,

          'components', v_components,

          'execution_intents', v_intents

        )::text,

        'utf8'

      ),

      'sha256'

    ),

    'hex'

  );

  select *

  into v_profile_result

  from public.write_commercial_opportunity_profile_internal(

    p_organization_id,

    p_store_id,

    p_commercial_opportunity_id,

    v_profile_operation_key,

    v_profile_fingerprint,

    v_current_version.profile_state,

    v_components,

    v_intents,

    'system',

    null,

    'cross_sell_acceptance',

    'customer_accepted_cross_sell',

    'sales_ai.cross_sell_acceptance',

    v_metadata || pg_catalog.jsonb_build_object(

      'cross_sell_suggestion_id', v_suggestion.id,

      'suggestion_message_id', v_suggestion.suggestion_message_id,

      'customer_evidence_message_id', p_customer_evidence_message_id,

      'acceptance_operation_key', v_operation_key

    )

  );

  select component_row.id

  into v_profile_component_id

  from public.commercial_opportunity_profile_components component_row

  where component_row.organization_id = p_organization_id

    and component_row.store_id = p_store_id

    and component_row.commercial_opportunity_id = p_commercial_opportunity_id

    and component_row.profile_version_id = v_profile_result.profile_version_id

    and component_row.component_key = v_component_key;

  if v_profile_component_id is null then

    raise exception using errcode = 'P0001', message = 'ZION_CROSS_SELL_ACCEPTED_COMPONENT_MISSING';

  end if;

  update public.commercial_opportunity_cross_sell_suggestions suggestion_row

  set

    status = 'accepted',

    acceptance_operation_key = v_operation_key,

    acceptance_request_fingerprint = v_request_fingerprint,
    customer_evidence_message_id = p_customer_evidence_message_id,
    acceptance_metadata = v_metadata,
    accepted_profile_version_id = v_profile_result.profile_version_id,
    accepted_profile_component_id = v_profile_component_id,
    accepted_at = now()

  where suggestion_row.id = v_suggestion.id

  returning * into v_suggestion;

  return query

  select

    v_suggestion.id,

    v_profile_result.profile_version_id,

    v_profile_component_id,

    coalesce(v_profile_result.changed, false),

    false,

    v_profile_result.outcome::text;

end;

$function$;

create or replace function public.accept_commercial_cross_sell_single_active_suggestion_by_system(

  p_organization_id uuid,

  p_store_id uuid,

  p_commercial_opportunity_id uuid,

  p_conversation_id uuid,

  p_customer_evidence_message_id uuid,

  p_operation_key text,

  p_request_fingerprint text,

  p_metadata jsonb default '{}'::jsonb

)

returns table (

  suggestion_id uuid,

  accepted_profile_version_id uuid,

  accepted_profile_component_id uuid,

  profile_changed boolean,

  replayed boolean,

  outcome text

)

language plpgsql

security definer

set search_path = pg_catalog, public, pg_temp

set row_security = off

as $function$

declare

  v_request_role text := public.zion_resolve_request_role_internal();

  v_count integer;

  v_suggestion_id uuid;

  v_evidence public.messages%rowtype;

  v_opportunity public.commercial_opportunities%rowtype;

begin

  if v_request_role is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'ZION_CROSS_SELL_SYSTEM_WRITER_REQUIRED';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_conversation_id is null
     or p_customer_evidence_message_id is null then
    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_ACCEPTANCE_SCOPE_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:cross-sell:' || p_organization_id::text || ':' || p_store_id::text || ':' || p_commercial_opportunity_id::text,
      0
    )
  );

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'ZION_CROSS_SELL_OPPORTUNITY_SCOPE_INVALID';
  end if;

  if v_opportunity.primary_conversation_id is distinct from p_conversation_id then
    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_CONVERSATION_NOT_OPPORTUNITY_PRIMARY';
  end if;

  select message_row.*

  into v_evidence

  from public.messages message_row

  where message_row.id = p_customer_evidence_message_id

    and message_row.organization_id = p_organization_id

    and message_row.store_id = p_store_id

    and message_row.conversation_id = p_conversation_id

    and message_row.direction = 'incoming'

    and message_row.sender = 'user';

  if not found then

    raise exception using errcode = '23503', message = 'ZION_CROSS_SELL_EVIDENCE_MESSAGE_INVALID';

  end if;

  select pg_catalog.count(*)::integer
  into v_count
  from public.commercial_opportunity_cross_sell_suggestions suggestion_row
  join public.messages suggestion_message
    on suggestion_message.id = suggestion_row.suggestion_message_id
   and suggestion_message.organization_id = suggestion_row.organization_id
   and suggestion_message.store_id = suggestion_row.store_id
   and suggestion_message.conversation_id = suggestion_row.conversation_id
  where suggestion_row.organization_id = p_organization_id
    and suggestion_row.store_id = p_store_id
    and suggestion_row.commercial_opportunity_id = p_commercial_opportunity_id
    and suggestion_row.conversation_id = p_conversation_id
    and suggestion_row.status = 'suggested'
    and suggestion_message.direction = 'outgoing'
    and suggestion_message.sender = 'ai'
    and suggestion_message.created_at < v_evidence.created_at;

  if v_count = 0 then

    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_NO_ACTIVE_SUGGESTION';

  end if;

  if v_count > 1 then
    raise exception using errcode = '22023', message = 'ZION_CROSS_SELL_AMBIGUOUS_ACTIVE_SUGGESTION';
  end if;

  select suggestion_row.id
  into strict v_suggestion_id
  from public.commercial_opportunity_cross_sell_suggestions suggestion_row
  join public.messages suggestion_message
    on suggestion_message.id = suggestion_row.suggestion_message_id
   and suggestion_message.organization_id = suggestion_row.organization_id
   and suggestion_message.store_id = suggestion_row.store_id
   and suggestion_message.conversation_id = suggestion_row.conversation_id
  where suggestion_row.organization_id = p_organization_id
    and suggestion_row.store_id = p_store_id
    and suggestion_row.commercial_opportunity_id = p_commercial_opportunity_id
    and suggestion_row.conversation_id = p_conversation_id
    and suggestion_row.status = 'suggested'
    and suggestion_message.direction = 'outgoing'
    and suggestion_message.sender = 'ai'
    and suggestion_message.created_at < v_evidence.created_at;

  return query

  select *

  from public.accept_commercial_cross_sell_suggestion_by_system(

    p_organization_id,

    p_store_id,

    p_commercial_opportunity_id,

    v_suggestion_id,

    p_customer_evidence_message_id,

    p_operation_key,

    p_request_fingerprint,

    p_metadata

  );

end;

$function$;

alter function public.touch_p9_cross_sell_suggestion_updated_at() owner to postgres;

alter function public.record_commercial_cross_sell_suggestion_by_system(

  uuid, uuid, uuid, uuid, uuid, text, uuid, uuid, text, text, jsonb

) owner to postgres;

alter function public.set_commercial_cross_sell_suggestion_status_by_system(

  uuid, uuid, uuid, uuid, text, text, text

) owner to postgres;

alter function public.accept_commercial_cross_sell_suggestion_by_system(

  uuid, uuid, uuid, uuid, uuid, text, text, jsonb

) owner to postgres;

alter function public.accept_commercial_cross_sell_single_active_suggestion_by_system(

  uuid, uuid, uuid, uuid, uuid, text, text, jsonb

) owner to postgres;

revoke all on table public.commercial_opportunity_cross_sell_suggestions

  from public, anon, authenticated, service_role;

grant select on table public.commercial_opportunity_cross_sell_suggestions

  to service_role;

revoke all on function public.touch_p9_cross_sell_suggestion_updated_at()

  from public, anon, authenticated, service_role;

revoke all on function public.record_commercial_cross_sell_suggestion_by_system(

  uuid, uuid, uuid, uuid, uuid, text, uuid, uuid, text, text, jsonb

) from public, anon, authenticated, service_role;

grant execute on function public.record_commercial_cross_sell_suggestion_by_system(

  uuid, uuid, uuid, uuid, uuid, text, uuid, uuid, text, text, jsonb

) to service_role;

revoke all on function public.set_commercial_cross_sell_suggestion_status_by_system(

  uuid, uuid, uuid, uuid, text, text, text

) from public, anon, authenticated, service_role;

grant execute on function public.set_commercial_cross_sell_suggestion_status_by_system(

  uuid, uuid, uuid, uuid, text, text, text

) to service_role;

revoke all on function public.accept_commercial_cross_sell_suggestion_by_system(

  uuid, uuid, uuid, uuid, uuid, text, text, jsonb

) from public, anon, authenticated, service_role;

grant execute on function public.accept_commercial_cross_sell_suggestion_by_system(

  uuid, uuid, uuid, uuid, uuid, text, text, jsonb

) to service_role;

revoke all on function public.accept_commercial_cross_sell_single_active_suggestion_by_system(

  uuid, uuid, uuid, uuid, uuid, text, text, jsonb

) from public, anon, authenticated, service_role;

grant execute on function public.accept_commercial_cross_sell_single_active_suggestion_by_system(

  uuid, uuid, uuid, uuid, uuid, text, text, jsonb

) to service_role;

alter table public.commercial_opportunity_cross_sell_suggestions enable row level security;

comment on table public.commercial_opportunity_cross_sell_suggestions is

  'P9 6.1-C canonical ledger for cross-sell suggestions tied to a real outbound AI message and accepted only with later inbound customer evidence before Profile write.';

comment on function public.record_commercial_cross_sell_suggestion_by_system(

  uuid, uuid, uuid, uuid, uuid, text, uuid, uuid, text, text, jsonb

) is

  'Registers a pool/catalog cross-sell candidate suggested by a real outbound AI message. Service/custom are intentionally unsupported in 6.1-C.';

comment on function public.accept_commercial_cross_sell_suggestion_by_system(

  uuid, uuid, uuid, uuid, uuid, text, text, jsonb

) is

  'Accepts one explicit active cross-sell suggestion using later inbound customer evidence, appends a Profile version, and never mutates existing quotes directly.';

comment on function public.accept_commercial_cross_sell_single_active_suggestion_by_system(

  uuid, uuid, uuid, uuid, uuid, text, text, jsonb

) is

  'Accepts only when exactly one active cross-sell suggestion exists for the opportunity/conversation before the evidence message; 0 or 2+ suggestions fail closed.';

do $postconditions$

begin

  if pg_catalog.to_regclass('public.commercial_opportunity_cross_sell_suggestions') is null then

    raise exception using errcode = 'P0001', message = 'postcondition failed: cross-sell suggestion table missing';

  end if;

  if pg_catalog.to_regprocedure('public.record_commercial_cross_sell_suggestion_by_system(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,jsonb)') is null

     or pg_catalog.to_regprocedure('public.accept_commercial_cross_sell_suggestion_by_system(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)') is null

     or pg_catalog.to_regprocedure('public.accept_commercial_cross_sell_single_active_suggestion_by_system(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)') is null then

    raise exception using errcode = 'P0001', message = 'postcondition failed: cross-sell writer missing';

  end if;

  if pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_cross_sell_suggestions', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_cross_sell_suggestions', 'UPDATE')
     or pg_catalog.has_table_privilege('anon', 'public.commercial_opportunity_cross_sell_suggestions', 'INSERT')
     or pg_catalog.has_table_privilege('anon', 'public.commercial_opportunity_cross_sell_suggestions', 'UPDATE')
     or not pg_catalog.has_function_privilege('service_role', 'public.record_commercial_cross_sell_suggestion_by_system(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,jsonb)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', 'public.set_commercial_cross_sell_suggestion_status_by_system(uuid,uuid,uuid,uuid,text,text,text)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', 'public.accept_commercial_cross_sell_suggestion_by_system(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', 'public.accept_commercial_cross_sell_single_active_suggestion_by_system(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.record_commercial_cross_sell_suggestion_by_system(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,jsonb)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.accept_commercial_cross_sell_suggestion_by_system(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE') then
    raise exception using errcode = 'P0001', message = 'postcondition failed: cross-sell permissions invalid';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_opportunity_cross_sell_suggestions'::pg_catalog.regclass
      and constraint_row.conname = 'p9_cross_sell_suggestions_profile_component_version_kind_fk'
  )
  or not exists (
    select 1
    from pg_catalog.pg_attribute column_row
    where column_row.attrelid = 'public.commercial_opportunity_cross_sell_suggestions'::pg_catalog.regclass
      and column_row.attname = 'acceptance_metadata'
      and not column_row.attisdropped
  ) then
    raise exception using errcode = 'P0001', message = 'postcondition failed: cross-sell accepted Profile lineage/idempotency evidence missing';
  end if;

  if position(
       'min(suggestion_row.id)'
       in pg_catalog.lower(
         pg_catalog.pg_get_functiondef(
           'public.accept_commercial_cross_sell_single_active_suggestion_by_system(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)'::pg_catalog.regprocedure
         )
       )
     ) > 0 then
    raise exception using errcode = 'P0001', message = 'postcondition failed: single-active cross-sell acceptance still depends on min(uuid)';
  end if;

end;

$postconditions$;

commit;
