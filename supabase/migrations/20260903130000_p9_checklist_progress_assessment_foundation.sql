begin;

set local lock_timeout = '5s';
set local statement_timeout = '240s';
set local idle_in_transaction_session_timeout = '240s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:checklist-progress-assessment-foundation:v1', 0)
);

-- ============================================================================
-- ZION — Pilar 9 — Bloco 3 — Etapa 3.5
-- Commercial Opportunity Checklist Progress / Assessment Foundation
--
-- Frozen semantic contract:
-- - Applicability answers whether an item applies and remains owned by the
--   immutable checklist definition.
-- - Progress answers what happened: not_started | in_progress | completed.
-- - Assessment answers whether Progress can be asserted safely:
--   determined | needs_resolution | conflict.
-- - When assessment <> determined, progress_state MUST be NULL.
-- - Every projection row carries deterministic Evidence Basis:
--   resolver_key, resolver_version, authority_fingerprint and resolution_basis.
-- - Progress is a CURRENT PROJECTION, not an irreversible trophy. A later
--   canonical authority may legitimately regress it.
-- - Lifecycle-sensitive evidence is anchored by lifecycle_cycle.
-- - Direct human checkboxes never write Progress. Human facts/attestations,
--   when needed, must be separate canonical authorities consumed by a resolver.
-- - Domain authorities (quote, appointment, contract, payment, fulfillment,
--   etc.) remain distinct and are never duplicated as authority here.
-- - Action Readiness is intentionally NOT a universal boolean and is not
--   materialized in this foundation. Future action-specific readiness combines
--   Applicability + Assessment + Progress + action-specific canonical rules.
-- ============================================================================

do $preflight$
declare
  v_existing record;
begin
  for v_existing in
    select *
    from (
      values
        ('organizations'::text),
        ('stores'),
        ('memberships'),
        ('commercial_opportunities'),
        ('commercial_opportunity_checklist_versions'),
        ('commercial_opportunity_checklist_items'),
        ('commercial_opportunity_checklist_current')
    ) as expected(table_name)
  loop
    if pg_catalog.to_regclass('public.' || v_existing.table_name) is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: public.%s is required',
          v_existing.table_name
        );
    end if;
  end loop;

  if pg_catalog.to_regprocedure(
       'public.p9_opportunity_gate_policy_checklist_prevent_mutation()'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: checklist append-only guard is required';
  end if;

  for v_existing in
    select *
    from (
      values
        ('commercial_opportunity_checklist_progress_versions'::text),
        ('commercial_opportunity_checklist_progress_items'),
        ('commercial_opportunity_checklist_progress_current')
    ) as expected(table_name)
  loop
    if pg_catalog.to_regclass('public.' || v_existing.table_name) is not null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: public.%s already exists',
          v_existing.table_name
        );
    end if;
  end loop;

  for v_existing in
    select *
    from (
      values
        ('p9_commercial_opportunity_checklist_progress_validate_item()'::text),
        ('p9_commercial_opportunity_checklist_progress_validate_current()'),
        ('p9_commercial_opportunity_checklist_progress_touch_current_updated_at()')
    ) as expected(function_signature)
  loop
    if pg_catalog.to_regprocedure('public.' || v_existing.function_signature) is not null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: function collision detected public.%s',
          v_existing.function_signature
        );
    end if;
  end loop;
end;
$preflight$;

-- A scoped unique key lets the new projection reference one immutable
-- checklist item with full tenant/opportunity/checklist scope.
create unique index if not exists p9_checklist_items_scope_id_version_uidx
  on public.commercial_opportunity_checklist_items (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    checklist_version_id
  );

-- ============================================================================
-- Immutable Progress / Assessment projection versions.
-- ============================================================================

create table public.commercial_opportunity_checklist_progress_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  version_number integer not null,
  previous_progress_version_id uuid null,
  checklist_version_id uuid not null,
  lifecycle_cycle integer not null,
  projection_state text not null,
  operation_key text not null,
  request_fingerprint text not null,
  source_type text not null,
  reason_code text not null,
  created_by text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),

  constraint p9_checklist_progress_versions_org_fk
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint p9_checklist_progress_versions_store_scope_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint p9_checklist_progress_versions_opp_scope_fk
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,

  constraint p9_checklist_progress_versions_checklist_scope_fk
    foreign key (
      checklist_version_id,
      organization_id,
      store_id,
      commercial_opportunity_id
    )
    references public.commercial_opportunity_checklist_versions(
      id,
      organization_id,
      store_id,
      commercial_opportunity_id
    )
    on delete restrict,

  constraint p9_checklist_progress_versions_version_number_chk
    check (version_number > 0),

  constraint p9_checklist_progress_versions_previous_not_self_chk
    check (previous_progress_version_id is null or previous_progress_version_id <> id),

  constraint p9_checklist_progress_versions_lifecycle_cycle_chk
    check (lifecycle_cycle >= 1),

  constraint p9_checklist_progress_versions_projection_state_chk
    check (
      projection_state in (
        'determined',
        'needs_resolution',
        'conflict'
      )
    ),

  constraint p9_checklist_progress_versions_operation_key_chk
    check (
      operation_key = pg_catalog.btrim(operation_key)
      and pg_catalog.length(operation_key) between 1 and 200
    ),

  constraint p9_checklist_progress_versions_request_fingerprint_chk
    check (
      pg_catalog.length(request_fingerprint) = 64
      and request_fingerprint ~ '^[0-9a-f]{64}$'
    ),

  constraint p9_checklist_progress_versions_source_type_chk
    check (
      source_type = pg_catalog.btrim(source_type)
      and pg_catalog.length(source_type) between 3 and 120
      and source_type ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_checklist_progress_versions_reason_code_chk
    check (
      reason_code = pg_catalog.btrim(reason_code)
      and pg_catalog.length(reason_code) between 3 and 120
      and reason_code ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_checklist_progress_versions_created_by_chk
    check (
      created_by = pg_catalog.btrim(created_by)
      and pg_catalog.length(created_by) between 3 and 120
      and created_by ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_checklist_progress_versions_metadata_chk
    check (pg_catalog.jsonb_typeof(metadata) = 'object')
);

create unique index p9_checklist_progress_versions_scope_version_number_uidx
  on public.commercial_opportunity_checklist_progress_versions (
    organization_id,
    store_id,
    commercial_opportunity_id,
    version_number
  );

create unique index p9_checklist_progress_versions_scope_operation_uidx
  on public.commercial_opportunity_checklist_progress_versions (
    organization_id,
    store_id,
    commercial_opportunity_id,
    operation_key
  );

create unique index p9_checklist_progress_versions_scope_id_uidx
  on public.commercial_opportunity_checklist_progress_versions (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id
  );

create unique index p9_checklist_progress_versions_scope_id_checklist_uidx
  on public.commercial_opportunity_checklist_progress_versions (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    checklist_version_id
  );

create unique index p9_checklist_progress_versions_previous_once_uidx
  on public.commercial_opportunity_checklist_progress_versions (
    organization_id,
    store_id,
    commercial_opportunity_id,
    previous_progress_version_id
  )
  where previous_progress_version_id is not null;

alter table public.commercial_opportunity_checklist_progress_versions
  add constraint p9_checklist_progress_versions_previous_scope_fk
  foreign key (
    previous_progress_version_id,
    organization_id,
    store_id,
    commercial_opportunity_id
  )
  references public.commercial_opportunity_checklist_progress_versions(
    id,
    organization_id,
    store_id,
    commercial_opportunity_id
  )
  on delete restrict;

-- ============================================================================
-- Immutable per-item Progress / Assessment rows.
--
-- Only checklist items whose applicability is concretely required/optional may
-- receive a Progress row. not_applicable/needs_resolution/conflict remain in
-- Applicability and must never be duplicated as fake Progress states.
-- ============================================================================

create table public.commercial_opportunity_checklist_progress_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  progress_version_id uuid not null,
  checklist_version_id uuid not null,
  checklist_item_id uuid not null,
  assessment_state text not null,
  progress_state text null,
  resolver_key text not null,
  resolver_version integer not null,
  authority_fingerprint text not null,
  resolution_basis jsonb not null,
  reason_code text not null,
  evaluated_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),

  constraint p9_checklist_progress_items_org_fk
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint p9_checklist_progress_items_store_scope_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint p9_checklist_progress_items_opp_scope_fk
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,

  constraint p9_checklist_progress_items_version_scope_fk
    foreign key (
      progress_version_id,
      organization_id,
      store_id,
      commercial_opportunity_id,
      checklist_version_id
    )
    references public.commercial_opportunity_checklist_progress_versions(
      id,
      organization_id,
      store_id,
      commercial_opportunity_id,
      checklist_version_id
    )
    on delete restrict,

  constraint p9_checklist_progress_items_checklist_item_scope_fk
    foreign key (
      checklist_item_id,
      organization_id,
      store_id,
      commercial_opportunity_id,
      checklist_version_id
    )
    references public.commercial_opportunity_checklist_items(
      id,
      organization_id,
      store_id,
      commercial_opportunity_id,
      checklist_version_id
    )
    on delete restrict,

  constraint p9_checklist_progress_items_assessment_state_chk
    check (
      assessment_state in (
        'determined',
        'needs_resolution',
        'conflict'
      )
    ),

  constraint p9_checklist_progress_items_progress_state_chk
    check (
      progress_state is null
      or progress_state in (
        'not_started',
        'in_progress',
        'completed'
      )
    ),

  constraint p9_checklist_progress_items_assessment_progress_shape_chk
    check (
      (
        assessment_state = 'determined'
        and progress_state is not null
      )
      or (
        assessment_state in ('needs_resolution', 'conflict')
        and progress_state is null
      )
    ),

  constraint p9_checklist_progress_items_resolver_key_chk
    check (
      resolver_key = pg_catalog.btrim(resolver_key)
      and pg_catalog.length(resolver_key) between 3 and 160
      and resolver_key ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_checklist_progress_items_resolver_version_chk
    check (resolver_version >= 1),

  constraint p9_checklist_progress_items_authority_fingerprint_chk
    check (
      pg_catalog.length(authority_fingerprint) = 64
      and authority_fingerprint ~ '^[0-9a-f]{64}$'
    ),

  constraint p9_checklist_progress_items_resolution_basis_chk
    check (
      pg_catalog.jsonb_typeof(resolution_basis) = 'object'
      and resolution_basis <> '{}'::jsonb
    ),

  constraint p9_checklist_progress_items_reason_code_chk
    check (
      reason_code = pg_catalog.btrim(reason_code)
      and pg_catalog.length(reason_code) between 3 and 120
      and reason_code ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_checklist_progress_items_metadata_chk
    check (pg_catalog.jsonb_typeof(metadata) = 'object')
);

create unique index p9_checklist_progress_items_version_checklist_item_uidx
  on public.commercial_opportunity_checklist_progress_items (
    progress_version_id,
    checklist_item_id
  );

create index p9_checklist_progress_items_scope_version_idx
  on public.commercial_opportunity_checklist_progress_items (
    organization_id,
    store_id,
    commercial_opportunity_id,
    progress_version_id
  );

create index p9_checklist_progress_items_scope_assessment_idx
  on public.commercial_opportunity_checklist_progress_items (
    organization_id,
    store_id,
    commercial_opportunity_id,
    assessment_state,
    progress_state
  );

-- ============================================================================
-- Explicit current pointer. Never infer current from latest/max.
-- ============================================================================

create table public.commercial_opportunity_checklist_progress_current (
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  current_progress_version_id uuid not null,
  last_operation_key text not null,
  updated_at timestamptz not null default timezone('utc', now()),

  constraint p9_checklist_progress_current_pk
    primary key (organization_id, store_id, commercial_opportunity_id),

  constraint p9_checklist_progress_current_org_fk
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint p9_checklist_progress_current_store_scope_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint p9_checklist_progress_current_opp_scope_fk
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,

  constraint p9_checklist_progress_current_version_scope_fk
    foreign key (
      current_progress_version_id,
      organization_id,
      store_id,
      commercial_opportunity_id
    )
    references public.commercial_opportunity_checklist_progress_versions(
      id,
      organization_id,
      store_id,
      commercial_opportunity_id
    )
    on delete restrict,

  constraint p9_checklist_progress_current_last_operation_key_chk
    check (
      last_operation_key = pg_catalog.btrim(last_operation_key)
      and pg_catalog.length(last_operation_key) between 1 and 200
    )
);

-- ============================================================================
-- Integrity trigger functions.
-- ============================================================================

create or replace function public.p9_commercial_opportunity_checklist_progress_validate_item()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_item public.commercial_opportunity_checklist_items;
begin
  select checklist_item.*
  into v_item
  from public.commercial_opportunity_checklist_items checklist_item
  where checklist_item.id = new.checklist_item_id
    and checklist_item.organization_id = new.organization_id
    and checklist_item.store_id = new.store_id
    and checklist_item.commercial_opportunity_id = new.commercial_opportunity_id
    and checklist_item.checklist_version_id = new.checklist_version_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'checklist progress item points to a checklist item outside its exact scope';
  end if;

  if v_item.applicability_state not in ('required', 'optional') then
    raise exception using
      errcode = '23514',
      message = 'checklist progress may only evaluate required or optional applicability';
  end if;

  return new;
end;
$function$;

create or replace function public.p9_commercial_opportunity_checklist_progress_validate_current()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_progress_version public.commercial_opportunity_checklist_progress_versions;
  v_current_checklist_version_id uuid;
  v_current_lifecycle_cycle integer;
  v_expected_item_count integer;
  v_actual_item_count integer;
  v_conflict_count integer;
  v_needs_resolution_count integer;
  v_expected_projection_state text;
begin
  if tg_op = 'UPDATE'
     and (
       new.organization_id is distinct from old.organization_id
       or new.store_id is distinct from old.store_id
       or new.commercial_opportunity_id is distinct from old.commercial_opportunity_id
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'commercial opportunity checklist progress current identity is immutable';
  end if;

  select version_row.*
  into v_progress_version
  from public.commercial_opportunity_checklist_progress_versions version_row
  where version_row.id = new.current_progress_version_id
    and version_row.organization_id = new.organization_id
    and version_row.store_id = new.store_id
    and version_row.commercial_opportunity_id = new.commercial_opportunity_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'checklist progress current points to a version outside its scope';
  end if;

  if new.last_operation_key is distinct from v_progress_version.operation_key then
    raise exception using
      errcode = '23514',
      message = 'checklist progress current operation_key does not match current version';
  end if;

  select opportunity_row.lifecycle_cycle
  into v_current_lifecycle_cycle
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = new.commercial_opportunity_id
    and opportunity_row.organization_id = new.organization_id
    and opportunity_row.store_id = new.store_id;

  if not found
     or v_progress_version.lifecycle_cycle is distinct from v_current_lifecycle_cycle then
    raise exception using
      errcode = '23514',
      message = 'checklist progress current cannot activate evidence from a stale lifecycle cycle';
  end if;

  select checklist_current.current_checklist_version_id
  into v_current_checklist_version_id
  from public.commercial_opportunity_checklist_current checklist_current
  where checklist_current.organization_id = new.organization_id
    and checklist_current.store_id = new.store_id
    and checklist_current.commercial_opportunity_id = new.commercial_opportunity_id;

  if not found
     or v_progress_version.checklist_version_id is distinct from v_current_checklist_version_id then
    raise exception using
      errcode = '23514',
      message = 'checklist progress current must evaluate the current Applicability checklist version';
  end if;

  select count(*)
  into v_expected_item_count
  from public.commercial_opportunity_checklist_items checklist_item
  where checklist_item.organization_id = new.organization_id
    and checklist_item.store_id = new.store_id
    and checklist_item.commercial_opportunity_id = new.commercial_opportunity_id
    and checklist_item.checklist_version_id = v_progress_version.checklist_version_id
    and checklist_item.applicability_state in ('required', 'optional');

  select
    count(*),
    count(*) filter (where progress_item.assessment_state = 'conflict'),
    count(*) filter (where progress_item.assessment_state = 'needs_resolution')
  into
    v_actual_item_count,
    v_conflict_count,
    v_needs_resolution_count
  from public.commercial_opportunity_checklist_progress_items progress_item
  where progress_item.organization_id = new.organization_id
    and progress_item.store_id = new.store_id
    and progress_item.commercial_opportunity_id = new.commercial_opportunity_id
    and progress_item.progress_version_id = v_progress_version.id;

  if v_actual_item_count is distinct from v_expected_item_count then
    raise exception using
      errcode = '23514',
      message = 'checklist progress current requires a complete projection for every required/optional checklist item';
  end if;

  v_expected_projection_state :=
    case
      when v_conflict_count > 0 then 'conflict'
      when v_needs_resolution_count > 0 then 'needs_resolution'
      else 'determined'
    end;

  if v_progress_version.projection_state is distinct from v_expected_projection_state then
    raise exception using
      errcode = '23514',
      message = 'checklist progress version projection_state does not match item Assessment aggregate';
  end if;

  return new;
end;
$function$;

create or replace function public.p9_commercial_opportunity_checklist_progress_touch_current_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

alter function public.p9_commercial_opportunity_checklist_progress_validate_item()
  owner to postgres;
alter function public.p9_commercial_opportunity_checklist_progress_validate_current()
  owner to postgres;
alter function public.p9_commercial_opportunity_checklist_progress_touch_current_updated_at()
  owner to postgres;

revoke all on function public.p9_commercial_opportunity_checklist_progress_validate_item()
  from public, anon, authenticated, service_role;
revoke all on function public.p9_commercial_opportunity_checklist_progress_validate_current()
  from public, anon, authenticated, service_role;
revoke all on function public.p9_commercial_opportunity_checklist_progress_touch_current_updated_at()
  from public, anon, authenticated, service_role;

create trigger p9_checklist_progress_versions_append_only
  before update or delete on public.commercial_opportunity_checklist_progress_versions
  for each row
  execute function public.p9_opportunity_gate_policy_checklist_prevent_mutation();

create trigger p9_checklist_progress_items_validate
  before insert on public.commercial_opportunity_checklist_progress_items
  for each row
  execute function public.p9_commercial_opportunity_checklist_progress_validate_item();

create trigger p9_checklist_progress_items_append_only
  before update or delete on public.commercial_opportunity_checklist_progress_items
  for each row
  execute function public.p9_opportunity_gate_policy_checklist_prevent_mutation();

create trigger p9_checklist_progress_current_validate
  before insert or update on public.commercial_opportunity_checklist_progress_current
  for each row
  execute function public.p9_commercial_opportunity_checklist_progress_validate_current();

create trigger p9_checklist_progress_current_touch_updated_at
  before update on public.commercial_opportunity_checklist_progress_current
  for each row
  execute function public.p9_commercial_opportunity_checklist_progress_touch_current_updated_at();

-- ============================================================================
-- RLS and direct privilege hardening.
--
-- This foundation intentionally creates no public writer. Future system
-- materializers/resolvers receive EXECUTE on dedicated SECURITY DEFINER RPCs;
-- application roles never gain direct table mutation.
-- ============================================================================

alter table public.commercial_opportunity_checklist_progress_versions
  enable row level security;
alter table public.commercial_opportunity_checklist_progress_items
  enable row level security;
alter table public.commercial_opportunity_checklist_progress_current
  enable row level security;

revoke all on table public.commercial_opportunity_checklist_progress_versions
  from public, anon, authenticated, service_role;
revoke all on table public.commercial_opportunity_checklist_progress_items
  from public, anon, authenticated, service_role;
revoke all on table public.commercial_opportunity_checklist_progress_current
  from public, anon, authenticated, service_role;

grant select on table public.commercial_opportunity_checklist_progress_versions
  to authenticated, service_role;
grant select on table public.commercial_opportunity_checklist_progress_items
  to authenticated, service_role;
grant select on table public.commercial_opportunity_checklist_progress_current
  to authenticated, service_role;

create policy p9_checklist_progress_versions_select_active_membership
  on public.commercial_opportunity_checklist_progress_versions
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id =
            commercial_opportunity_checklist_progress_versions.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
  );

create policy p9_checklist_progress_items_select_active_membership
  on public.commercial_opportunity_checklist_progress_items
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id =
            commercial_opportunity_checklist_progress_items.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
  );

create policy p9_checklist_progress_current_select_active_membership
  on public.commercial_opportunity_checklist_progress_current
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id =
            commercial_opportunity_checklist_progress_current.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
  );

-- ============================================================================
-- Contract documentation.
-- ============================================================================

comment on table public.commercial_opportunity_checklist_progress_versions is
  'Append-only current-state projections of Progress/Assessment for one immutable checklist version and opportunity lifecycle cycle. This is a projection over canonical domain authorities, not a replacement for those authorities.';

comment on column public.commercial_opportunity_checklist_progress_versions.checklist_version_id is
  'Exact immutable Applicability checklist version evaluated by this Progress/Assessment projection.';

comment on column public.commercial_opportunity_checklist_progress_versions.lifecycle_cycle is
  'Opportunity lifecycle cycle used to prevent stale evidence from silently crossing reopenings or later commercial cycles.';

comment on column public.commercial_opportunity_checklist_progress_versions.projection_state is
  'Aggregate Assessment state for the projection: determined, needs_resolution or conflict. It never encodes business progress itself.';

comment on table public.commercial_opportunity_checklist_progress_items is
  'Immutable per-item Progress and Assessment projections. Rows exist only for checklist items with concrete required/optional applicability.';

comment on column public.commercial_opportunity_checklist_progress_items.progress_state is
  'Observed progress only: not_started, in_progress or completed. NULL whenever assessment_state is needs_resolution/conflict.';

comment on column public.commercial_opportunity_checklist_progress_items.assessment_state is
  'Whether the resolver can safely determine Progress: determined, needs_resolution or conflict.';

comment on column public.commercial_opportunity_checklist_progress_items.resolver_key is
  'Stable domain-specific resolver identity. Generic checklist state must never replace quote/appointment/contract/payment/fulfillment authorities.';

comment on column public.commercial_opportunity_checklist_progress_items.resolver_version is
  'Version of resolver semantics used to interpret the canonical authority basis.';

comment on column public.commercial_opportunity_checklist_progress_items.authority_fingerprint is
  'Deterministic fingerprint of only the authority inputs relevant to this item/resolver. A change may legitimately re-evaluate or regress current Progress.';

comment on column public.commercial_opportunity_checklist_progress_items.resolution_basis is
  'Structured Evidence Basis explaining the canonical authority references/values used by the resolver. It must be non-empty and audit-safe.';

comment on table public.commercial_opportunity_checklist_progress_current is
  'Explicit current Progress/Assessment projection pointer for one opportunity. Activation is fail-closed: target version must match the current checklist, current lifecycle_cycle, contain every required/optional item exactly once, and have an aggregate projection_state consistent with item Assessments. Never infer current via latest/max/version_number.';

-- ============================================================================
-- Postconditions.
-- ============================================================================

do $postconditions$
declare
  v_expected record;
  v_function oid;
begin
  for v_expected in
    select *
    from (
      values
        ('commercial_opportunity_checklist_progress_versions'::text),
        ('commercial_opportunity_checklist_progress_items'),
        ('commercial_opportunity_checklist_progress_current')
    ) as expected(table_name)
  loop
    if pg_catalog.to_regclass('public.' || v_expected.table_name) is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'postcondition failed: public.%s missing',
          v_expected.table_name
        );
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_class
      on index_class.oid = index_row.indexrelid
    where index_row.indrelid =
          'public.commercial_opportunity_checklist_items'::pg_catalog.regclass
      and index_class.relname = 'p9_checklist_items_scope_id_version_uidx'
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: scoped checklist item reference index missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          'public.commercial_opportunity_checklist_progress_items'::pg_catalog.regclass
      and constraint_row.conname =
          'p9_checklist_progress_items_assessment_progress_shape_chk'
      and constraint_row.contype = 'c'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: Assessment/Progress shape constraint missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid =
          'public.commercial_opportunity_checklist_progress_items'::pg_catalog.regclass
      and trigger_row.tgname = 'p9_checklist_progress_items_validate'
      and not trigger_row.tgisinternal
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: applicability validation trigger missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid =
          'public.commercial_opportunity_checklist_progress_versions'::pg_catalog.regclass
      and trigger_row.tgname = 'p9_checklist_progress_versions_append_only'
      and not trigger_row.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid =
          'public.commercial_opportunity_checklist_progress_items'::pg_catalog.regclass
      and trigger_row.tgname = 'p9_checklist_progress_items_append_only'
      and not trigger_row.tgisinternal
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: append-only triggers missing';
  end if;

  for v_expected in
    select *
    from (
      values
        ('commercial_opportunity_checklist_progress_versions'::text),
        ('commercial_opportunity_checklist_progress_items'),
        ('commercial_opportunity_checklist_progress_current')
    ) as expected(table_name)
  loop
    if not (
      select class_row.relrowsecurity
      from pg_catalog.pg_class class_row
      where class_row.oid =
            pg_catalog.to_regclass('public.' || v_expected.table_name)
    ) then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'postcondition failed: RLS disabled on public.%s',
          v_expected.table_name
        );
    end if;

    if pg_catalog.has_table_privilege(
         'anon',
         'public.' || v_expected.table_name,
         'SELECT'
       )
       or pg_catalog.has_table_privilege(
         'anon',
         'public.' || v_expected.table_name,
         'INSERT'
       )
       or pg_catalog.has_table_privilege(
         'authenticated',
         'public.' || v_expected.table_name,
         'INSERT'
       )
       or pg_catalog.has_table_privilege(
         'authenticated',
         'public.' || v_expected.table_name,
         'UPDATE'
       )
       or pg_catalog.has_table_privilege(
         'authenticated',
         'public.' || v_expected.table_name,
         'DELETE'
       )
       or pg_catalog.has_table_privilege(
         'service_role',
         'public.' || v_expected.table_name,
         'INSERT'
       )
       or pg_catalog.has_table_privilege(
         'service_role',
         'public.' || v_expected.table_name,
         'UPDATE'
       )
       or pg_catalog.has_table_privilege(
         'service_role',
         'public.' || v_expected.table_name,
         'DELETE'
       ) then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'postcondition failed: direct mutation privilege leaked on public.%s',
          v_expected.table_name
        );
    end if;

    if not pg_catalog.has_table_privilege(
         'authenticated',
         'public.' || v_expected.table_name,
         'SELECT'
       )
       or not pg_catalog.has_table_privilege(
         'service_role',
         'public.' || v_expected.table_name,
         'SELECT'
       ) then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'postcondition failed: expected SELECT privilege missing on public.%s',
          v_expected.table_name
        );
    end if;
  end loop;

  for v_expected in
    select *
    from (
      values
        ('p9_commercial_opportunity_checklist_progress_validate_item()'::text),
        ('p9_commercial_opportunity_checklist_progress_validate_current()'),
        ('p9_commercial_opportunity_checklist_progress_touch_current_updated_at()')
    ) as expected(function_signature)
  loop
    v_function := pg_catalog.to_regprocedure('public.' || v_expected.function_signature);

    if v_function is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'postcondition failed: function public.%s missing',
          v_expected.function_signature
        );
    end if;

    if pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'postcondition failed: internal function EXECUTE leaked public.%s',
          v_expected.function_signature
        );
    end if;
  end loop;
end;
$postconditions$;

commit;
