begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:commercial-opportunity-profile-foundation:v1',
    0
  )
);

-- ============================================================================
-- P9 / Bloco 3 / Etapa 3.5
-- Commercial Opportunity Profile foundation.
--
-- Authority contract:
-- - commercial_opportunities remains the opportunity root and does not receive
--   sale_type/nature columns here;
-- - profile versions are append-only historical/audit records;
-- - commercial_opportunity_profile_current is the only current authority;
-- - components and execution intents are structural children of one version;
-- - Qualification Facts, checklist/policy, quote items, CMIR and fulfillment are
--   distinct authorities and are not collapsed into this foundation;
-- - component_subtype is intentionally not modeled in this migration;
-- - metadata is audit/support data only, never structural authority.
-- ============================================================================

do $preflight$
declare
  v_existing record;
begin
  if pg_catalog.to_regclass('public.commercial_opportunities') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.commercial_opportunities is required';
  end if;

  if pg_catalog.to_regclass('public.pools') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.pools is required';
  end if;

  if pg_catalog.to_regclass('public.store_catalog_items') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.store_catalog_items is required';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_class
      on index_class.oid = index_row.indexrelid
    join pg_catalog.pg_class table_class
      on table_class.oid = index_row.indrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = table_class.relnamespace
    where namespace_row.nspname = 'public'
      and table_class.relname = 'commercial_opportunities'
      and index_class.relname = 'commercial_opportunities_id_organization_store_uidx'
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indpred is null
      and index_row.indexprs is null
      and (
        select pg_catalog.array_agg(attribute_row.attname order by key_row.ordinality)
        from pg_catalog.unnest(index_row.indkey) with ordinality as key_row(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = table_class.oid
         and attribute_row.attnum = key_row.attnum
      ) = array['id', 'organization_id', 'store_id']::name[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: commercial_opportunities_id_organization_store_uidx contract mismatch';
  end if;

  for v_existing in
    select *
    from (
      values
        ('commercial_opportunity_profile_versions'::text),
        ('commercial_opportunity_profile_components'),
        ('commercial_opportunity_profile_execution_intents'),
        ('commercial_opportunity_profile_current')
    ) as expected(table_name)
  loop
    if pg_catalog.to_regclass('public.' || v_existing.table_name) is not null then
      raise exception using
        errcode = 'P0001',
        message = format(
          'precondition failed: public.%s already exists',
          v_existing.table_name
        );
    end if;
  end loop;

  for v_existing in
    select *
    from (
      values
        ('p9_commercial_opportunity_profile_prevent_mutation()'::text),
        ('p9_commercial_opportunity_profile_validate_current_projection()'),
        ('p9_commercial_opportunity_profile_touch_current_updated_at()')
    ) as expected(function_signature)
  loop
    if pg_catalog.to_regprocedure('public.' || v_existing.function_signature) is not null then
      raise exception using
        errcode = 'P0001',
        message = format(
          'precondition failed: function collision detected public.%s',
          v_existing.function_signature
        );
    end if;
  end loop;

  if exists (
    select 1
    from public.pools pool_row
    where pool_row.organization_id is null
       or pool_row.store_id is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.pools has null organization_id/store_id';
  end if;

  if exists (
    select 1
    from public.pools pool_row
    left join public.stores store_row
      on store_row.id = pool_row.store_id
     and store_row.organization_id = pool_row.organization_id
    where store_row.id is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.pools store/org mismatch';
  end if;

  if exists (
    select 1
    from public.store_catalog_items item_row
    left join public.stores store_row
      on store_row.id = item_row.store_id
     and store_row.organization_id = item_row.organization_id
    where store_row.id is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.store_catalog_items store/org mismatch';
  end if;

  if exists (
    select 1
    from (
      select id, organization_id, store_id, count(*) as duplicate_count
      from public.pools
      group by id, organization_id, store_id
      having count(*) > 1
    ) duplicate_row
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.pools composite duplicate';
  end if;

  if exists (
    select 1
    from (
      select id, organization_id, store_id, count(*) as duplicate_count
      from public.store_catalog_items
      group by id, organization_id, store_id
      having count(*) > 1
    ) duplicate_row
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.store_catalog_items composite duplicate';
  end if;

  for v_existing in
    select *
    from (
      values
        (
          'pools'::text,
          'pools_id_organization_store_uidx'::text,
          array['id', 'organization_id', 'store_id']::name[]
        ),
        (
          'store_catalog_items',
          'store_catalog_items_id_organization_store_uidx',
          array['id', 'organization_id', 'store_id']::name[]
        )
    ) as expected(table_name, index_name, column_names)
  loop
    if exists (
      select 1
      from pg_catalog.pg_class index_class
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = index_class.relnamespace
      where namespace_row.nspname = 'public'
        and index_class.relname = v_existing.index_name
    )
    and not exists (
      select 1
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class index_class
        on index_class.oid = index_row.indexrelid
      join pg_catalog.pg_class table_class
        on table_class.oid = index_row.indrelid
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = table_class.relnamespace
      where namespace_row.nspname = 'public'
        and table_class.relname = v_existing.table_name
        and index_class.relname = v_existing.index_name
        and index_row.indisunique
        and index_row.indisvalid
        and index_row.indisready
        and index_row.indpred is null
        and index_row.indexprs is null
        and (
          select pg_catalog.array_agg(attribute_row.attname order by key_row.ordinality)
          from pg_catalog.unnest(index_row.indkey) with ordinality as key_row(attnum, ordinality)
          join pg_catalog.pg_attribute attribute_row
            on attribute_row.attrelid = table_class.oid
           and attribute_row.attnum = key_row.attnum
        ) = v_existing.column_names
    ) then
      raise exception using
        errcode = 'P0001',
        message = format(
          'precondition failed: %s exists with a divergent contract',
          v_existing.index_name
        );
    end if;
  end loop;
end;
$preflight$;

create unique index if not exists pools_id_organization_store_uidx
  on public.pools (id, organization_id, store_id);

create unique index if not exists store_catalog_items_id_organization_store_uidx
  on public.store_catalog_items (id, organization_id, store_id);

create table public.commercial_opportunity_profile_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  version_number integer not null,
  previous_profile_version_id uuid null,
  profile_state text not null,
  operation_key text not null,
  request_fingerprint text not null,
  actor_type text not null,
  actor_user_id uuid null,
  source_type text not null,
  reason_code text not null,
  created_by text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),

  constraint p9_profile_versions_org_fk
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint p9_profile_versions_store_scope_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint p9_profile_versions_opp_scope_fk
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,

  constraint p9_profile_versions_actor_user_fk
    foreign key (actor_user_id)
    references auth.users(id)
    on delete restrict,

  constraint p9_profile_versions_version_number_chk
    check (version_number > 0),

  constraint p9_profile_versions_profile_state_chk
    check (profile_state in ('resolved', 'needs_clarification', 'conflict')),

  constraint p9_profile_versions_operation_key_chk
    check (
      operation_key = pg_catalog.btrim(operation_key)
      and pg_catalog.length(operation_key) between 1 and 200
    ),

  constraint p9_profile_versions_request_fingerprint_chk
    check (
      pg_catalog.length(request_fingerprint) = 64
      and request_fingerprint ~ '^[0-9a-f]{64}$'
    ),

  constraint p9_profile_versions_actor_type_chk
    check (actor_type in ('human', 'system')),

  constraint p9_profile_versions_actor_user_chk
    check (
      (actor_type = 'human' and actor_user_id is not null)
      or (actor_type = 'system' and actor_user_id is null)
    ),

  constraint p9_profile_versions_source_type_chk
    check (
      source_type = pg_catalog.btrim(source_type)
      and pg_catalog.length(source_type) between 3 and 120
      and source_type ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_profile_versions_reason_code_chk
    check (
      reason_code = pg_catalog.btrim(reason_code)
      and pg_catalog.length(reason_code) between 3 and 120
      and reason_code ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_profile_versions_created_by_chk
    check (
      created_by = pg_catalog.btrim(created_by)
      and pg_catalog.length(created_by) between 3 and 120
      and created_by ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_profile_versions_metadata_chk
    check (pg_catalog.jsonb_typeof(metadata) = 'object'),

  constraint p9_profile_versions_previous_not_self_chk
    check (previous_profile_version_id is null or previous_profile_version_id <> id)
);

create unique index p9_profile_versions_scope_version_number_uidx
  on public.commercial_opportunity_profile_versions (
    organization_id,
    store_id,
    commercial_opportunity_id,
    version_number
  );

create unique index p9_profile_versions_scope_operation_uidx
  on public.commercial_opportunity_profile_versions (
    organization_id,
    store_id,
    commercial_opportunity_id,
    operation_key
  );

create unique index p9_profile_versions_scope_id_uidx
  on public.commercial_opportunity_profile_versions (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id
  );

create unique index p9_profile_versions_previous_once_uidx
  on public.commercial_opportunity_profile_versions (
    organization_id,
    store_id,
    commercial_opportunity_id,
    previous_profile_version_id
  )
  where previous_profile_version_id is not null;

alter table public.commercial_opportunity_profile_versions
  add constraint p9_profile_versions_previous_scope_fk
  foreign key (
    previous_profile_version_id,
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
  on delete restrict;

create table public.commercial_opportunity_profile_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  profile_version_id uuid not null,
  component_key text not null,
  component_kind text not null,
  component_state text not null,
  pool_id uuid null,
  catalog_item_id uuid null,
  reference_text text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),

  constraint p9_profile_components_org_fk
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint p9_profile_components_store_scope_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint p9_profile_components_opp_scope_fk
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,

  constraint p9_profile_components_version_scope_fk
    foreign key (
      profile_version_id,
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

  constraint p9_profile_components_pool_scope_fk
    foreign key (pool_id, organization_id, store_id)
    references public.pools(id, organization_id, store_id)
    on delete restrict,

  constraint p9_profile_components_catalog_scope_fk
    foreign key (catalog_item_id, organization_id, store_id)
    references public.store_catalog_items(id, organization_id, store_id)
    on delete restrict,

  constraint p9_profile_components_component_key_chk
    check (
      component_key = pg_catalog.btrim(component_key)
      and pg_catalog.length(component_key) between 1 and 120
      and component_key ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_profile_components_kind_chk
    check (component_kind in ('pool', 'catalog_item', 'service', 'custom')),

  constraint p9_profile_components_state_chk
    check (component_state in ('resolved', 'partial', 'conflict')),

  constraint p9_profile_components_reference_text_chk
    check (
      reference_text is null
      or (
        reference_text = pg_catalog.btrim(reference_text)
        and pg_catalog.length(reference_text) between 1 and 500
      )
    ),

  constraint p9_profile_components_metadata_chk
    check (pg_catalog.jsonb_typeof(metadata) = 'object'),

  constraint p9_profile_components_catalog_refs_chk
    check (
      (pool_id is null or component_kind = 'pool')
      and (catalog_item_id is null or component_kind = 'catalog_item')
      and not (pool_id is not null and catalog_item_id is not null)
    ),

  constraint p9_profile_components_resolution_shape_chk
    check (
      (
        component_kind = 'pool'
        and (
          (component_state = 'resolved' and pool_id is not null)
          or (
            component_state = 'partial'
            and (pool_id is not null or reference_text is not null)
          )
          or (component_state = 'conflict' and reference_text is not null)
        )
      )
      or (
        component_kind = 'catalog_item'
        and (
          (component_state = 'resolved' and catalog_item_id is not null)
          or (
            component_state = 'partial'
            and (catalog_item_id is not null or reference_text is not null)
          )
          or (component_state = 'conflict' and reference_text is not null)
        )
      )
      or (
        component_kind in ('service', 'custom')
        and pool_id is null
        and catalog_item_id is null
        and reference_text is not null
      )
    )
);

create unique index p9_profile_components_version_component_key_uidx
  on public.commercial_opportunity_profile_components (
    profile_version_id,
    component_key
  );

create index p9_profile_components_scope_version_idx
  on public.commercial_opportunity_profile_components (
    organization_id,
    store_id,
    commercial_opportunity_id,
    profile_version_id
  );

create table public.commercial_opportunity_profile_execution_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  profile_version_id uuid not null,
  execution_kind text not null,
  intent_state text not null,
  reason_code text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),

  constraint p9_profile_execution_intents_org_fk
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint p9_profile_execution_intents_store_scope_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint p9_profile_execution_intents_opp_scope_fk
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,

  constraint p9_profile_execution_intents_version_scope_fk
    foreign key (
      profile_version_id,
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

  constraint p9_profile_execution_intents_kind_chk
    check (
      execution_kind in (
        'installation',
        'delivery',
        'pickup',
        'service_execution'
      )
    ),

  constraint p9_profile_execution_intents_state_chk
    check (intent_state in ('included', 'excluded', 'unresolved', 'conflict')),

  constraint p9_profile_execution_intents_reason_code_chk
    check (
      reason_code is null
      or (
        reason_code = pg_catalog.btrim(reason_code)
        and pg_catalog.length(reason_code) between 3 and 120
        and reason_code ~ '^[a-z0-9_:.\/-]+$'
      )
    ),

  constraint p9_profile_execution_intents_metadata_chk
    check (pg_catalog.jsonb_typeof(metadata) = 'object')
);

create unique index p9_profile_execution_intents_version_kind_uidx
  on public.commercial_opportunity_profile_execution_intents (
    profile_version_id,
    execution_kind
  );

create index p9_profile_execution_intents_scope_version_idx
  on public.commercial_opportunity_profile_execution_intents (
    organization_id,
    store_id,
    commercial_opportunity_id,
    profile_version_id
  );

create table public.commercial_opportunity_profile_current (
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  current_profile_version_id uuid not null,
  last_operation_key text not null,
  updated_at timestamptz not null default timezone('utc', now()),

  constraint p9_profile_current_pk
    primary key (
      organization_id,
      store_id,
      commercial_opportunity_id
    ),

  constraint p9_profile_current_org_fk
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint p9_profile_current_store_scope_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint p9_profile_current_opp_scope_fk
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,

  constraint p9_profile_current_version_scope_fk
    foreign key (
      current_profile_version_id,
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

  constraint p9_profile_current_last_operation_key_chk
    check (
      last_operation_key = pg_catalog.btrim(last_operation_key)
      and pg_catalog.length(last_operation_key) between 1 and 200
    )
);

create or replace function public.p9_commercial_opportunity_profile_prevent_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
begin
  raise exception using
    errcode = 'P0001',
    message = tg_table_name || ' is append-only';
end;
$function$;

create or replace function public.p9_commercial_opportunity_profile_validate_current_projection()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_profile_version public.commercial_opportunity_profile_versions;
begin
  if tg_op = 'UPDATE'
     and (
       new.organization_id is distinct from old.organization_id
       or new.store_id is distinct from old.store_id
       or new.commercial_opportunity_id is distinct from old.commercial_opportunity_id
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'commercial opportunity profile current identity is immutable';
  end if;

  select version_row.*
  into v_profile_version
  from public.commercial_opportunity_profile_versions version_row
  where version_row.id = new.current_profile_version_id
    and version_row.organization_id = new.organization_id
    and version_row.store_id = new.store_id
    and version_row.commercial_opportunity_id = new.commercial_opportunity_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'commercial opportunity profile current points to a version outside its scope';
  end if;

  if new.last_operation_key is distinct from v_profile_version.operation_key then
    raise exception using
      errcode = '23514',
      message = 'commercial opportunity profile current operation_key does not match current version';
  end if;

  return new;
end;
$function$;

create or replace function public.p9_commercial_opportunity_profile_touch_current_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

alter function public.p9_commercial_opportunity_profile_prevent_mutation()
  owner to postgres;
alter function public.p9_commercial_opportunity_profile_validate_current_projection()
  owner to postgres;
alter function public.p9_commercial_opportunity_profile_touch_current_updated_at()
  owner to postgres;

revoke all on function public.p9_commercial_opportunity_profile_prevent_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.p9_commercial_opportunity_profile_validate_current_projection()
  from public, anon, authenticated, service_role;
revoke all on function public.p9_commercial_opportunity_profile_touch_current_updated_at()
  from public, anon, authenticated, service_role;

create trigger p9_profile_versions_append_only
  before update or delete on public.commercial_opportunity_profile_versions
  for each row
  execute function public.p9_commercial_opportunity_profile_prevent_mutation();

create trigger p9_profile_components_append_only
  before update or delete on public.commercial_opportunity_profile_components
  for each row
  execute function public.p9_commercial_opportunity_profile_prevent_mutation();

create trigger p9_profile_execution_intents_append_only
  before update or delete on public.commercial_opportunity_profile_execution_intents
  for each row
  execute function public.p9_commercial_opportunity_profile_prevent_mutation();

create trigger p9_profile_current_validate_projection
  before insert or update on public.commercial_opportunity_profile_current
  for each row
  execute function public.p9_commercial_opportunity_profile_validate_current_projection();

create trigger p9_profile_current_touch_updated_at
  before update on public.commercial_opportunity_profile_current
  for each row
  execute function public.p9_commercial_opportunity_profile_touch_current_updated_at();

alter table public.commercial_opportunity_profile_versions enable row level security;
alter table public.commercial_opportunity_profile_components enable row level security;
alter table public.commercial_opportunity_profile_execution_intents enable row level security;
alter table public.commercial_opportunity_profile_current enable row level security;

revoke all on table public.commercial_opportunity_profile_versions
  from public, anon, authenticated, service_role;
revoke all on table public.commercial_opportunity_profile_components
  from public, anon, authenticated, service_role;
revoke all on table public.commercial_opportunity_profile_execution_intents
  from public, anon, authenticated, service_role;
revoke all on table public.commercial_opportunity_profile_current
  from public, anon, authenticated, service_role;

grant select on table public.commercial_opportunity_profile_versions
  to authenticated, service_role;
grant select on table public.commercial_opportunity_profile_components
  to authenticated, service_role;
grant select on table public.commercial_opportunity_profile_execution_intents
  to authenticated, service_role;
grant select on table public.commercial_opportunity_profile_current
  to authenticated, service_role;

drop policy if exists p9_profile_versions_select_active_membership
  on public.commercial_opportunity_profile_versions;
create policy p9_profile_versions_select_active_membership
  on public.commercial_opportunity_profile_versions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = commercial_opportunity_profile_versions.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active = true
    )
  );

drop policy if exists p9_profile_components_select_active_membership
  on public.commercial_opportunity_profile_components;
create policy p9_profile_components_select_active_membership
  on public.commercial_opportunity_profile_components
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = commercial_opportunity_profile_components.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active = true
    )
  );

drop policy if exists p9_profile_execution_intents_select_active_membership
  on public.commercial_opportunity_profile_execution_intents;
create policy p9_profile_execution_intents_select_active_membership
  on public.commercial_opportunity_profile_execution_intents
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = commercial_opportunity_profile_execution_intents.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active = true
    )
  );

drop policy if exists p9_profile_current_select_active_membership
  on public.commercial_opportunity_profile_current;
create policy p9_profile_current_select_active_membership
  on public.commercial_opportunity_profile_current
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = commercial_opportunity_profile_current.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active = true
    )
  );

comment on table public.commercial_opportunity_profile_versions is
  'Append-only versions of the canonical commercial profile for an opportunity. Current authority is commercial_opportunity_profile_current, never max(version_number) or latest created_at.';

comment on column public.commercial_opportunity_profile_versions.version_number is
  'Per-opportunity audit sequence. It is not current authority and must not be selected by max/latest.';

comment on column public.commercial_opportunity_profile_versions.previous_profile_version_id is
  'Explicit lineage pointer to the immediately previous profile version in the same organization/store/opportunity scope.';

comment on column public.commercial_opportunity_profile_versions.request_fingerprint is
  'SHA-256 lowercase hex fingerprint of the canonical write request. Same operation_key plus same fingerprint is idempotent; different fingerprint must fail closed in the future writer.';

comment on column public.commercial_opportunity_profile_versions.source_type is
  'Audit/origin descriptor for how the profile version was produced. It is not commercial authority; future writers may enforce a stricter vocabulary.';

comment on column public.commercial_opportunity_profile_versions.metadata is
  'Auxiliary audit metadata only. Structural profile authority lives in typed columns and child tables.';

comment on table public.commercial_opportunity_profile_components is
  'Append-only structured components for one commercial opportunity profile version. reference_text is descriptive evidence, not catalog authority.';

comment on column public.commercial_opportunity_profile_components.reference_text is
  'Snapshot/description used for unresolved, service/custom, or conflict clarification. It is not an authoritative catalog identifier.';

comment on table public.commercial_opportunity_profile_execution_intents is
  'Append-only commercial execution intents for one profile version. These are commercial obligations/intent, not fulfillment execution records.';

comment on table public.commercial_opportunity_profile_current is
  'Explicit current projection for the commercial opportunity profile. Readers must use this pointer, not latest/max/version_number.';

comment on constraint p9_profile_versions_profile_state_chk
  on public.commercial_opportunity_profile_versions is
  'Cross-row invariants for resolved/needs_clarification/conflict belong to the future canonical writer, not CHECK constraints.';

do $postconditions$
declare
  v_expected record;
begin
  for v_expected in
    select *
    from (
      values
        ('commercial_opportunity_profile_versions'::text),
        ('commercial_opportunity_profile_components'),
        ('commercial_opportunity_profile_execution_intents'),
        ('commercial_opportunity_profile_current')
    ) as expected(table_name)
  loop
    if pg_catalog.to_regclass('public.' || v_expected.table_name) is null then
      raise exception using
        errcode = 'P0001',
        message = format('postcondition failed: public.%s missing', v_expected.table_name);
    end if;
  end loop;

  for v_expected in
    select *
    from (
      values
        (
          'pools'::text,
          'pools_id_organization_store_uidx'::text,
          array['id', 'organization_id', 'store_id']::name[]
        ),
        (
          'store_catalog_items',
          'store_catalog_items_id_organization_store_uidx',
          array['id', 'organization_id', 'store_id']::name[]
        ),
        (
          'commercial_opportunity_profile_versions',
          'p9_profile_versions_scope_id_uidx',
          array['id', 'organization_id', 'store_id', 'commercial_opportunity_id']::name[]
        )
    ) as expected(table_name, index_name, column_names)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class index_class
        on index_class.oid = index_row.indexrelid
      join pg_catalog.pg_class table_class
        on table_class.oid = index_row.indrelid
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = table_class.relnamespace
      where namespace_row.nspname = 'public'
        and table_class.relname = v_expected.table_name
        and index_class.relname = v_expected.index_name
        and index_row.indisunique
        and index_row.indisvalid
        and index_row.indisready
        and index_row.indpred is null
        and index_row.indexprs is null
        and (
          select pg_catalog.array_agg(attribute_row.attname order by key_row.ordinality)
          from pg_catalog.unnest(index_row.indkey) with ordinality as key_row(attnum, ordinality)
          join pg_catalog.pg_attribute attribute_row
            on attribute_row.attrelid = table_class.oid
           and attribute_row.attnum = key_row.attnum
        ) = v_expected.column_names
    ) then
      raise exception using
        errcode = 'P0001',
        message = format(
          'postcondition failed: %s contract mismatch',
          v_expected.index_name
        );
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_class
      on index_class.oid = index_row.indexrelid
    where index_class.relname = 'p9_profile_versions_previous_once_uidx'
      and index_row.indisunique
      and index_row.indpred is not null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: p9_profile_versions_previous_once_uidx missing';
  end if;

  for v_expected in
    select *
    from (
      values
        (
          'commercial_opportunity_profile_versions'::text,
          'p9_profile_versions_append_only'::text,
          'p9_commercial_opportunity_profile_prevent_mutation'
        ),
        (
          'commercial_opportunity_profile_components',
          'p9_profile_components_append_only',
          'p9_commercial_opportunity_profile_prevent_mutation'
        ),
        (
          'commercial_opportunity_profile_execution_intents',
          'p9_profile_execution_intents_append_only',
          'p9_commercial_opportunity_profile_prevent_mutation'
        ),
        (
          'commercial_opportunity_profile_current',
          'p9_profile_current_validate_projection',
          'p9_commercial_opportunity_profile_validate_current_projection'
        )
    ) as expected(table_name, trigger_name, function_name)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_class table_class
        on table_class.oid = trigger_row.tgrelid
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = table_class.relnamespace
      join pg_catalog.pg_proc proc_row
        on proc_row.oid = trigger_row.tgfoid
      where namespace_row.nspname = 'public'
        and table_class.relname = v_expected.table_name
        and trigger_row.tgname = v_expected.trigger_name
        and proc_row.proname = v_expected.function_name
        and not trigger_row.tgisinternal
    ) then
      raise exception using
        errcode = 'P0001',
        message = format(
          'postcondition failed: trigger %s missing',
          v_expected.trigger_name
        );
    end if;
  end loop;

  if exists (
    select 1
    from (
      values
        ('commercial_opportunity_profile_versions'::text),
        ('commercial_opportunity_profile_components'),
        ('commercial_opportunity_profile_execution_intents'),
        ('commercial_opportunity_profile_current')
    ) as expected(table_name)
    where not exists (
      select 1
      from pg_catalog.pg_class class_row
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = class_row.relnamespace
      where namespace_row.nspname = 'public'
        and class_row.relname = expected.table_name
        and class_row.relrowsecurity
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: profile RLS missing';
  end if;
end;
$postconditions$;

commit;
