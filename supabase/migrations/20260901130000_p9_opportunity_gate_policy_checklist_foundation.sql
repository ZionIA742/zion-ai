begin;

set local lock_timeout = '5s';
set local statement_timeout = '240s';
set local idle_in_transaction_session_timeout = '240s';
set local search_path = pg_catalog, pg_temp, public, auth;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:opportunity-gate-policy-checklist-foundation:v1',
    0
  )
);

-- ============================================================================
-- P9 / Bloco 3 / Etapa 3.5
-- Opportunity Gate Policy + Checklist Definition foundation.
--
-- Authority contract:
-- - Commercial Opportunity Profile describes what the sale contains/involves.
-- - Store Opportunity Gate Policy is the live, versioned applicability policy.
-- - Existing P19-A Settings remain authorities for capability/operation details;
--   this migration does not clone their values into live policy tables.
-- - Checklist versions are immutable snapshots for one concrete opportunity.
-- - Checklist definition is separate from checklist progress/resolution events.
-- - commercial_opportunity_checklist_current is the only current checklist
--   authority; readers must never infer current by max(version_number), latest
--   created_at, or fuzzy fallbacks.
-- - Macro commercial gates and technical requirements are distinct item kinds.
--   A technical requirement such as measurements/compatibility never implies a
--   technical visit by itself.
-- - No giant sale_type/component_subtype enum is introduced here.
-- - Profile/policy/checklist writers and materializers are intentionally NOT
--   implemented in this foundation; cross-row decision semantics stay fail-
--   closed and will be enforced by future canonical writers.
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

  if pg_catalog.to_regclass('public.commercial_opportunity_profile_versions') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.commercial_opportunity_profile_versions is required';
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
      and table_class.relname = 'commercial_opportunity_profile_versions'
      and index_class.relname = 'p9_profile_versions_scope_id_uidx'
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
      ) = array['id', 'organization_id', 'store_id', 'commercial_opportunity_id']::name[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: p9_profile_versions_scope_id_uidx contract mismatch';
  end if;

  for v_existing in
    select *
    from (
      values
        ('store_opportunity_gate_policy_versions'::text),
        ('store_opportunity_gate_policy_rules'),
        ('store_opportunity_gate_policy_current'),
        ('commercial_opportunity_checklist_versions'),
        ('commercial_opportunity_checklist_items'),
        ('commercial_opportunity_checklist_current'),
        ('commercial_opportunity_checklist_override_events')
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
        ('p9_opportunity_gate_policy_checklist_prevent_mutation()'::text),
        ('p9_opportunity_gate_policy_validate_current_projection()'),
        ('p9_opportunity_gate_policy_touch_current_updated_at()'),
        ('p9_commercial_opportunity_checklist_validate_current_projection()'),
        ('p9_commercial_opportunity_checklist_touch_current_updated_at()'),
        ('p9_commercial_opportunity_checklist_validate_override_event()')
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

-- ============================================================================
-- Live, versioned store-level applicability policy.
-- ============================================================================

create table public.store_opportunity_gate_policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  version_number integer not null,
  previous_policy_version_id uuid null,
  operation_key text not null,
  request_fingerprint text not null,
  actor_type text not null,
  actor_user_id uuid null,
  source_type text not null,
  reason_code text not null,
  created_by text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),

  constraint p9_gate_policy_versions_org_fk
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint p9_gate_policy_versions_store_scope_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint p9_gate_policy_versions_actor_user_fk
    foreign key (actor_user_id)
    references auth.users(id)
    on delete restrict,

  constraint p9_gate_policy_versions_version_number_chk
    check (version_number > 0),

  constraint p9_gate_policy_versions_previous_not_self_chk
    check (previous_policy_version_id is null or previous_policy_version_id <> id),

  constraint p9_gate_policy_versions_operation_key_chk
    check (
      operation_key = pg_catalog.btrim(operation_key)
      and pg_catalog.length(operation_key) between 1 and 200
    ),

  constraint p9_gate_policy_versions_request_fingerprint_chk
    check (
      pg_catalog.length(request_fingerprint) = 64
      and request_fingerprint ~ '^[0-9a-f]{64}$'
    ),

  constraint p9_gate_policy_versions_actor_type_chk
    check (actor_type in ('human', 'system')),

  constraint p9_gate_policy_versions_actor_user_chk
    check (
      (actor_type = 'human' and actor_user_id is not null)
      or (actor_type = 'system' and actor_user_id is null)
    ),

  constraint p9_gate_policy_versions_source_type_chk
    check (
      source_type = pg_catalog.btrim(source_type)
      and pg_catalog.length(source_type) between 3 and 120
      and source_type ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_gate_policy_versions_reason_code_chk
    check (
      reason_code = pg_catalog.btrim(reason_code)
      and pg_catalog.length(reason_code) between 3 and 120
      and reason_code ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_gate_policy_versions_created_by_chk
    check (
      created_by = pg_catalog.btrim(created_by)
      and pg_catalog.length(created_by) between 3 and 120
      and created_by ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_gate_policy_versions_metadata_chk
    check (pg_catalog.jsonb_typeof(metadata) = 'object')
);

create unique index p9_gate_policy_versions_scope_version_number_uidx
  on public.store_opportunity_gate_policy_versions (
    organization_id,
    store_id,
    version_number
  );

create unique index p9_gate_policy_versions_scope_operation_uidx
  on public.store_opportunity_gate_policy_versions (
    organization_id,
    store_id,
    operation_key
  );

create unique index p9_gate_policy_versions_scope_id_uidx
  on public.store_opportunity_gate_policy_versions (
    id,
    organization_id,
    store_id
  );

create unique index p9_gate_policy_versions_previous_once_uidx
  on public.store_opportunity_gate_policy_versions (
    organization_id,
    store_id,
    previous_policy_version_id
  )
  where previous_policy_version_id is not null;

alter table public.store_opportunity_gate_policy_versions
  add constraint p9_gate_policy_versions_previous_scope_fk
  foreign key (
    previous_policy_version_id,
    organization_id,
    store_id
  )
  references public.store_opportunity_gate_policy_versions(
    id,
    organization_id,
    store_id
  )
  on delete restrict;

create table public.store_opportunity_gate_policy_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  policy_version_id uuid not null,
  rule_key text not null,
  rule_priority integer not null default 0,
  item_kind text not null,
  item_key text not null,
  match_mode text not null,
  component_kind text null,
  execution_kind text null,
  applicability_state text not null,
  reason_code text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),

  constraint p9_gate_policy_rules_org_fk
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint p9_gate_policy_rules_store_scope_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint p9_gate_policy_rules_version_scope_fk
    foreign key (policy_version_id, organization_id, store_id)
    references public.store_opportunity_gate_policy_versions(
      id,
      organization_id,
      store_id
    )
    on delete restrict,

  constraint p9_gate_policy_rules_rule_key_chk
    check (
      rule_key = pg_catalog.btrim(rule_key)
      and pg_catalog.length(rule_key) between 1 and 160
      and rule_key ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_gate_policy_rules_priority_chk
    check (rule_priority >= 0),

  constraint p9_gate_policy_rules_item_kind_chk
    check (item_kind in ('commercial_gate', 'technical_requirement')),

  constraint p9_gate_policy_rules_item_key_chk
    check (
      item_key = pg_catalog.btrim(item_key)
      and pg_catalog.length(item_key) between 1 and 160
      and item_key ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_gate_policy_rules_match_mode_chk
    check (
      match_mode in (
        'always',
        'component',
        'execution',
        'component_and_execution'
      )
    ),

  constraint p9_gate_policy_rules_component_kind_chk
    check (
      component_kind is null
      or component_kind in ('pool', 'catalog_item', 'service', 'custom')
    ),

  constraint p9_gate_policy_rules_execution_kind_chk
    check (
      execution_kind is null
      or execution_kind in ('installation', 'delivery', 'pickup', 'service_execution')
    ),

  constraint p9_gate_policy_rules_match_shape_chk
    check (
      (match_mode = 'always' and component_kind is null and execution_kind is null)
      or (match_mode = 'component' and component_kind is not null and execution_kind is null)
      or (match_mode = 'execution' and component_kind is null and execution_kind is not null)
      or (
        match_mode = 'component_and_execution'
        and component_kind is not null
        and execution_kind is not null
      )
    ),

  constraint p9_gate_policy_rules_applicability_state_chk
    check (
      applicability_state in (
        'required',
        'optional',
        'not_applicable',
        'needs_resolution'
      )
    ),

  constraint p9_gate_policy_rules_reason_code_chk
    check (
      reason_code = pg_catalog.btrim(reason_code)
      and pg_catalog.length(reason_code) between 3 and 120
      and reason_code ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_gate_policy_rules_metadata_chk
    check (pg_catalog.jsonb_typeof(metadata) = 'object')
);

create unique index p9_gate_policy_rules_version_rule_key_uidx
  on public.store_opportunity_gate_policy_rules (
    policy_version_id,
    rule_key
  );

create index p9_gate_policy_rules_scope_version_idx
  on public.store_opportunity_gate_policy_rules (
    organization_id,
    store_id,
    policy_version_id,
    rule_priority desc,
    rule_key
  );

create table public.store_opportunity_gate_policy_current (
  organization_id uuid not null,
  store_id uuid not null,
  current_policy_version_id uuid not null,
  last_operation_key text not null,
  updated_at timestamptz not null default timezone('utc', now()),

  constraint p9_gate_policy_current_pk
    primary key (organization_id, store_id),

  constraint p9_gate_policy_current_org_fk
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint p9_gate_policy_current_store_scope_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint p9_gate_policy_current_version_scope_fk
    foreign key (current_policy_version_id, organization_id, store_id)
    references public.store_opportunity_gate_policy_versions(
      id,
      organization_id,
      store_id
    )
    on delete restrict,

  constraint p9_gate_policy_current_last_operation_key_chk
    check (
      last_operation_key = pg_catalog.btrim(last_operation_key)
      and pg_catalog.length(last_operation_key) between 1 and 200
    )
);

-- ============================================================================
-- Immutable checklist-definition snapshots for concrete opportunities.
-- ============================================================================

create table public.commercial_opportunity_checklist_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  version_number integer not null,
  previous_checklist_version_id uuid null,
  profile_version_id uuid not null,
  gate_policy_version_id uuid not null,
  checklist_state text not null,
  settings_snapshot jsonb not null default '{}'::jsonb,
  settings_fingerprint text not null,
  operation_key text not null,
  request_fingerprint text not null,
  actor_type text not null,
  actor_user_id uuid null,
  source_type text not null,
  reason_code text not null,
  created_by text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),

  constraint p9_checklist_versions_org_fk
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint p9_checklist_versions_store_scope_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint p9_checklist_versions_opp_scope_fk
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,

  constraint p9_checklist_versions_profile_scope_fk
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

  constraint p9_checklist_versions_gate_policy_scope_fk
    foreign key (gate_policy_version_id, organization_id, store_id)
    references public.store_opportunity_gate_policy_versions(
      id,
      organization_id,
      store_id
    )
    on delete restrict,

  constraint p9_checklist_versions_actor_user_fk
    foreign key (actor_user_id)
    references auth.users(id)
    on delete restrict,

  constraint p9_checklist_versions_version_number_chk
    check (version_number > 0),

  constraint p9_checklist_versions_previous_not_self_chk
    check (previous_checklist_version_id is null or previous_checklist_version_id <> id),

  constraint p9_checklist_versions_state_chk
    check (checklist_state in ('resolved', 'needs_resolution', 'conflict')),

  constraint p9_checklist_versions_settings_snapshot_chk
    check (pg_catalog.jsonb_typeof(settings_snapshot) = 'object'),

  constraint p9_checklist_versions_settings_fingerprint_chk
    check (
      pg_catalog.length(settings_fingerprint) = 64
      and settings_fingerprint ~ '^[0-9a-f]{64}$'
    ),

  constraint p9_checklist_versions_operation_key_chk
    check (
      operation_key = pg_catalog.btrim(operation_key)
      and pg_catalog.length(operation_key) between 1 and 200
    ),

  constraint p9_checklist_versions_request_fingerprint_chk
    check (
      pg_catalog.length(request_fingerprint) = 64
      and request_fingerprint ~ '^[0-9a-f]{64}$'
    ),

  constraint p9_checklist_versions_actor_type_chk
    check (actor_type in ('human', 'system')),

  constraint p9_checklist_versions_actor_user_chk
    check (
      (actor_type = 'human' and actor_user_id is not null)
      or (actor_type = 'system' and actor_user_id is null)
    ),

  constraint p9_checklist_versions_source_type_chk
    check (
      source_type = pg_catalog.btrim(source_type)
      and pg_catalog.length(source_type) between 3 and 120
      and source_type ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_checklist_versions_reason_code_chk
    check (
      reason_code = pg_catalog.btrim(reason_code)
      and pg_catalog.length(reason_code) between 3 and 120
      and reason_code ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_checklist_versions_created_by_chk
    check (
      created_by = pg_catalog.btrim(created_by)
      and pg_catalog.length(created_by) between 3 and 120
      and created_by ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_checklist_versions_metadata_chk
    check (pg_catalog.jsonb_typeof(metadata) = 'object')
);

create unique index p9_checklist_versions_scope_version_number_uidx
  on public.commercial_opportunity_checklist_versions (
    organization_id,
    store_id,
    commercial_opportunity_id,
    version_number
  );

create unique index p9_checklist_versions_scope_operation_uidx
  on public.commercial_opportunity_checklist_versions (
    organization_id,
    store_id,
    commercial_opportunity_id,
    operation_key
  );

create unique index p9_checklist_versions_scope_id_uidx
  on public.commercial_opportunity_checklist_versions (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id
  );

create unique index p9_checklist_versions_previous_once_uidx
  on public.commercial_opportunity_checklist_versions (
    organization_id,
    store_id,
    commercial_opportunity_id,
    previous_checklist_version_id
  )
  where previous_checklist_version_id is not null;

alter table public.commercial_opportunity_checklist_versions
  add constraint p9_checklist_versions_previous_scope_fk
  foreign key (
    previous_checklist_version_id,
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
  on delete restrict;

create table public.commercial_opportunity_checklist_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  checklist_version_id uuid not null,
  item_key text not null,
  item_kind text not null,
  applicability_state text not null,
  reason_code text not null,
  decision_basis jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),

  constraint p9_checklist_items_org_fk
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint p9_checklist_items_store_scope_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint p9_checklist_items_opp_scope_fk
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,

  constraint p9_checklist_items_version_scope_fk
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

  constraint p9_checklist_items_item_key_chk
    check (
      item_key = pg_catalog.btrim(item_key)
      and pg_catalog.length(item_key) between 1 and 160
      and item_key ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_checklist_items_item_kind_chk
    check (item_kind in ('commercial_gate', 'technical_requirement')),

  constraint p9_checklist_items_applicability_state_chk
    check (
      applicability_state in (
        'required',
        'optional',
        'not_applicable',
        'needs_resolution',
        'conflict'
      )
    ),

  constraint p9_checklist_items_reason_code_chk
    check (
      reason_code = pg_catalog.btrim(reason_code)
      and pg_catalog.length(reason_code) between 3 and 120
      and reason_code ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_checklist_items_decision_basis_chk
    check (pg_catalog.jsonb_typeof(decision_basis) = 'object'),

  constraint p9_checklist_items_metadata_chk
    check (pg_catalog.jsonb_typeof(metadata) = 'object')
);

create unique index p9_checklist_items_version_item_key_uidx
  on public.commercial_opportunity_checklist_items (
    checklist_version_id,
    item_key
  );

create index p9_checklist_items_scope_version_idx
  on public.commercial_opportunity_checklist_items (
    organization_id,
    store_id,
    commercial_opportunity_id,
    checklist_version_id
  );

create table public.commercial_opportunity_checklist_current (
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  current_checklist_version_id uuid not null,
  last_operation_key text not null,
  updated_at timestamptz not null default timezone('utc', now()),

  constraint p9_checklist_current_pk
    primary key (organization_id, store_id, commercial_opportunity_id),

  constraint p9_checklist_current_org_fk
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint p9_checklist_current_store_scope_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint p9_checklist_current_opp_scope_fk
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,

  constraint p9_checklist_current_version_scope_fk
    foreign key (
      current_checklist_version_id,
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

  constraint p9_checklist_current_last_operation_key_chk
    check (
      last_operation_key = pg_catalog.btrim(last_operation_key)
      and pg_catalog.length(last_operation_key) between 1 and 200
    )
);

create table public.commercial_opportunity_checklist_override_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  base_checklist_version_id uuid not null,
  result_checklist_version_id uuid not null,
  item_key text not null,
  item_kind text not null,
  from_applicability_state text not null,
  to_applicability_state text not null,
  reason_code text not null,
  reason_text text not null,
  actor_user_id uuid not null,
  operation_key text not null,
  request_fingerprint text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),

  constraint p9_checklist_override_events_org_fk
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint p9_checklist_override_events_store_scope_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint p9_checklist_override_events_opp_scope_fk
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,

  constraint p9_checklist_override_events_base_scope_fk
    foreign key (
      base_checklist_version_id,
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

  constraint p9_checklist_override_events_result_scope_fk
    foreign key (
      result_checklist_version_id,
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

  constraint p9_checklist_override_events_actor_user_fk
    foreign key (actor_user_id)
    references auth.users(id)
    on delete restrict,

  constraint p9_checklist_override_events_versions_differ_chk
    check (base_checklist_version_id <> result_checklist_version_id),

  constraint p9_checklist_override_events_item_key_chk
    check (
      item_key = pg_catalog.btrim(item_key)
      and pg_catalog.length(item_key) between 1 and 160
      and item_key ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_checklist_override_events_item_kind_chk
    check (item_kind in ('commercial_gate', 'technical_requirement')),

  constraint p9_checklist_override_events_from_state_chk
    check (
      from_applicability_state in (
        'required',
        'optional',
        'not_applicable',
        'needs_resolution',
        'conflict'
      )
    ),

  constraint p9_checklist_override_events_to_state_chk
    check (
      to_applicability_state in (
        'required',
        'optional',
        'not_applicable',
        'needs_resolution',
        'conflict'
      )
    ),

  constraint p9_checklist_override_events_state_change_chk
    check (from_applicability_state <> to_applicability_state),

  constraint p9_checklist_override_events_reason_code_chk
    check (
      reason_code = pg_catalog.btrim(reason_code)
      and pg_catalog.length(reason_code) between 3 and 120
      and reason_code ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_checklist_override_events_reason_text_chk
    check (
      reason_text = pg_catalog.btrim(reason_text)
      and pg_catalog.length(reason_text) between 3 and 1000
    ),

  constraint p9_checklist_override_events_operation_key_chk
    check (
      operation_key = pg_catalog.btrim(operation_key)
      and pg_catalog.length(operation_key) between 1 and 200
    ),

  constraint p9_checklist_override_events_request_fingerprint_chk
    check (
      pg_catalog.length(request_fingerprint) = 64
      and request_fingerprint ~ '^[0-9a-f]{64}$'
    ),

  constraint p9_checklist_override_events_metadata_chk
    check (pg_catalog.jsonb_typeof(metadata) = 'object')
);

create unique index p9_checklist_override_events_scope_operation_uidx
  on public.commercial_opportunity_checklist_override_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    operation_key
  );

create index p9_checklist_override_events_scope_created_idx
  on public.commercial_opportunity_checklist_override_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    created_at,
    id
  );

-- ============================================================================
-- Integrity triggers.
-- ============================================================================

create or replace function public.p9_opportunity_gate_policy_checklist_prevent_mutation()
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

create or replace function public.p9_opportunity_gate_policy_validate_current_projection()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_policy_version public.store_opportunity_gate_policy_versions;
begin
  if tg_op = 'UPDATE'
     and (
       new.organization_id is distinct from old.organization_id
       or new.store_id is distinct from old.store_id
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'store opportunity gate policy current identity is immutable';
  end if;

  select version_row.*
  into v_policy_version
  from public.store_opportunity_gate_policy_versions version_row
  where version_row.id = new.current_policy_version_id
    and version_row.organization_id = new.organization_id
    and version_row.store_id = new.store_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'store opportunity gate policy current points to a version outside its scope';
  end if;

  if new.last_operation_key is distinct from v_policy_version.operation_key then
    raise exception using
      errcode = '23514',
      message = 'store opportunity gate policy current operation_key does not match current version';
  end if;

  return new;
end;
$function$;

create or replace function public.p9_opportunity_gate_policy_touch_current_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

create or replace function public.p9_commercial_opportunity_checklist_validate_current_projection()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_checklist_version public.commercial_opportunity_checklist_versions;
begin
  if tg_op = 'UPDATE'
     and (
       new.organization_id is distinct from old.organization_id
       or new.store_id is distinct from old.store_id
       or new.commercial_opportunity_id is distinct from old.commercial_opportunity_id
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'commercial opportunity checklist current identity is immutable';
  end if;

  select version_row.*
  into v_checklist_version
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.id = new.current_checklist_version_id
    and version_row.organization_id = new.organization_id
    and version_row.store_id = new.store_id
    and version_row.commercial_opportunity_id = new.commercial_opportunity_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'commercial opportunity checklist current points to a version outside its scope';
  end if;

  if new.last_operation_key is distinct from v_checklist_version.operation_key then
    raise exception using
      errcode = '23514',
      message = 'commercial opportunity checklist current operation_key does not match current version';
  end if;

  return new;
end;
$function$;

create or replace function public.p9_commercial_opportunity_checklist_touch_current_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

create or replace function public.p9_commercial_opportunity_checklist_validate_override_event()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_result_version public.commercial_opportunity_checklist_versions;
  v_base_item public.commercial_opportunity_checklist_items;
  v_result_item public.commercial_opportunity_checklist_items;
begin
  select version_row.*
  into v_result_version
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.id = new.result_checklist_version_id
    and version_row.organization_id = new.organization_id
    and version_row.store_id = new.store_id
    and version_row.commercial_opportunity_id = new.commercial_opportunity_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'checklist override result version is outside event scope';
  end if;

  if v_result_version.previous_checklist_version_id is distinct from new.base_checklist_version_id then
    raise exception using
      errcode = 'P0001',
      message = 'checklist override result version must be the direct child of base version';
  end if;

  if v_result_version.actor_type is distinct from 'human'
     or v_result_version.actor_user_id is distinct from new.actor_user_id then
    raise exception using
      errcode = 'P0001',
      message = 'checklist override result version must be attributed to the same human actor';
  end if;

  if v_result_version.operation_key is distinct from new.operation_key then
    raise exception using
      errcode = 'P0001',
      message = 'checklist override operation_key must match result version';
  end if;

  select item_row.*
  into v_base_item
  from public.commercial_opportunity_checklist_items item_row
  where item_row.checklist_version_id = new.base_checklist_version_id
    and item_row.organization_id = new.organization_id
    and item_row.store_id = new.store_id
    and item_row.commercial_opportunity_id = new.commercial_opportunity_id
    and item_row.item_key = new.item_key
    and item_row.item_kind = new.item_kind;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'checklist override base item does not exist';
  end if;

  if v_base_item.applicability_state is distinct from new.from_applicability_state then
    raise exception using
      errcode = 'P0001',
      message = 'checklist override from state does not match base item';
  end if;

  select item_row.*
  into v_result_item
  from public.commercial_opportunity_checklist_items item_row
  where item_row.checklist_version_id = new.result_checklist_version_id
    and item_row.organization_id = new.organization_id
    and item_row.store_id = new.store_id
    and item_row.commercial_opportunity_id = new.commercial_opportunity_id
    and item_row.item_key = new.item_key
    and item_row.item_kind = new.item_kind;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'checklist override result item does not exist';
  end if;

  if v_result_item.applicability_state is distinct from new.to_applicability_state then
    raise exception using
      errcode = 'P0001',
      message = 'checklist override to state does not match result item';
  end if;

  return new;
end;
$function$;

alter function public.p9_opportunity_gate_policy_checklist_prevent_mutation()
  owner to postgres;
alter function public.p9_opportunity_gate_policy_validate_current_projection()
  owner to postgres;
alter function public.p9_opportunity_gate_policy_touch_current_updated_at()
  owner to postgres;
alter function public.p9_commercial_opportunity_checklist_validate_current_projection()
  owner to postgres;
alter function public.p9_commercial_opportunity_checklist_touch_current_updated_at()
  owner to postgres;
alter function public.p9_commercial_opportunity_checklist_validate_override_event()
  owner to postgres;

revoke all on function public.p9_opportunity_gate_policy_checklist_prevent_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.p9_opportunity_gate_policy_validate_current_projection()
  from public, anon, authenticated, service_role;
revoke all on function public.p9_opportunity_gate_policy_touch_current_updated_at()
  from public, anon, authenticated, service_role;
revoke all on function public.p9_commercial_opportunity_checklist_validate_current_projection()
  from public, anon, authenticated, service_role;
revoke all on function public.p9_commercial_opportunity_checklist_touch_current_updated_at()
  from public, anon, authenticated, service_role;
revoke all on function public.p9_commercial_opportunity_checklist_validate_override_event()
  from public, anon, authenticated, service_role;

create trigger p9_gate_policy_versions_append_only
  before update or delete on public.store_opportunity_gate_policy_versions
  for each row
  execute function public.p9_opportunity_gate_policy_checklist_prevent_mutation();

create trigger p9_gate_policy_rules_append_only
  before update or delete on public.store_opportunity_gate_policy_rules
  for each row
  execute function public.p9_opportunity_gate_policy_checklist_prevent_mutation();

create trigger p9_gate_policy_current_validate_projection
  before insert or update on public.store_opportunity_gate_policy_current
  for each row
  execute function public.p9_opportunity_gate_policy_validate_current_projection();

create trigger p9_gate_policy_current_touch_updated_at
  before update on public.store_opportunity_gate_policy_current
  for each row
  execute function public.p9_opportunity_gate_policy_touch_current_updated_at();

create trigger p9_checklist_versions_append_only
  before update or delete on public.commercial_opportunity_checklist_versions
  for each row
  execute function public.p9_opportunity_gate_policy_checklist_prevent_mutation();

create trigger p9_checklist_items_append_only
  before update or delete on public.commercial_opportunity_checklist_items
  for each row
  execute function public.p9_opportunity_gate_policy_checklist_prevent_mutation();

create trigger p9_checklist_current_validate_projection
  before insert or update on public.commercial_opportunity_checklist_current
  for each row
  execute function public.p9_commercial_opportunity_checklist_validate_current_projection();

create trigger p9_checklist_current_touch_updated_at
  before update on public.commercial_opportunity_checklist_current
  for each row
  execute function public.p9_commercial_opportunity_checklist_touch_current_updated_at();

create trigger p9_checklist_override_events_validate
  before insert on public.commercial_opportunity_checklist_override_events
  for each row
  execute function public.p9_commercial_opportunity_checklist_validate_override_event();

create trigger p9_checklist_override_events_append_only
  before update or delete on public.commercial_opportunity_checklist_override_events
  for each row
  execute function public.p9_opportunity_gate_policy_checklist_prevent_mutation();

-- ============================================================================
-- RLS and direct privilege hardening. Future canonical writers receive EXECUTE;
-- direct writes stay closed for authenticated/service_role.
-- ============================================================================

alter table public.store_opportunity_gate_policy_versions enable row level security;
alter table public.store_opportunity_gate_policy_rules enable row level security;
alter table public.store_opportunity_gate_policy_current enable row level security;
alter table public.commercial_opportunity_checklist_versions enable row level security;
alter table public.commercial_opportunity_checklist_items enable row level security;
alter table public.commercial_opportunity_checklist_current enable row level security;
alter table public.commercial_opportunity_checklist_override_events enable row level security;

revoke all on table public.store_opportunity_gate_policy_versions
  from public, anon, authenticated, service_role;
revoke all on table public.store_opportunity_gate_policy_rules
  from public, anon, authenticated, service_role;
revoke all on table public.store_opportunity_gate_policy_current
  from public, anon, authenticated, service_role;
revoke all on table public.commercial_opportunity_checklist_versions
  from public, anon, authenticated, service_role;
revoke all on table public.commercial_opportunity_checklist_items
  from public, anon, authenticated, service_role;
revoke all on table public.commercial_opportunity_checklist_current
  from public, anon, authenticated, service_role;
revoke all on table public.commercial_opportunity_checklist_override_events
  from public, anon, authenticated, service_role;

grant select on table public.store_opportunity_gate_policy_versions
  to authenticated, service_role;
grant select on table public.store_opportunity_gate_policy_rules
  to authenticated, service_role;
grant select on table public.store_opportunity_gate_policy_current
  to authenticated, service_role;
grant select on table public.commercial_opportunity_checklist_versions
  to authenticated, service_role;
grant select on table public.commercial_opportunity_checklist_items
  to authenticated, service_role;
grant select on table public.commercial_opportunity_checklist_current
  to authenticated, service_role;
grant select on table public.commercial_opportunity_checklist_override_events
  to authenticated, service_role;

create policy p9_gate_policy_versions_select_active_membership
  on public.store_opportunity_gate_policy_versions
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = store_opportunity_gate_policy_versions.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
  );

create policy p9_gate_policy_rules_select_active_membership
  on public.store_opportunity_gate_policy_rules
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = store_opportunity_gate_policy_rules.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
  );

create policy p9_gate_policy_current_select_active_membership
  on public.store_opportunity_gate_policy_current
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = store_opportunity_gate_policy_current.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
  );

create policy p9_checklist_versions_select_active_membership
  on public.commercial_opportunity_checklist_versions
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = commercial_opportunity_checklist_versions.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
  );

create policy p9_checklist_items_select_active_membership
  on public.commercial_opportunity_checklist_items
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = commercial_opportunity_checklist_items.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
  );

create policy p9_checklist_current_select_active_membership
  on public.commercial_opportunity_checklist_current
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = commercial_opportunity_checklist_current.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
  );

create policy p9_checklist_override_events_select_active_membership
  on public.commercial_opportunity_checklist_override_events
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = commercial_opportunity_checklist_override_events.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
  );

-- ============================================================================
-- Contract documentation.
-- ============================================================================

comment on table public.store_opportunity_gate_policy_versions is
  'Append-only versions of store-level P9 applicability policy. Current authority is store_opportunity_gate_policy_current, never max(version_number) or latest created_at.';

comment on table public.store_opportunity_gate_policy_rules is
  'Append-only rules mapping structural Commercial Opportunity Profile dimensions to checklist applicability. Existing operational/payment/quote/contract Settings remain separate authorities.';

comment on column public.store_opportunity_gate_policy_rules.rule_priority is
  'Deterministic precedence input for the future materializer. Higher priority is evaluated before lower priority for rules targeting the same item; equal-priority incompatible outcomes must fail closed.';

comment on column public.store_opportunity_gate_policy_rules.match_mode is
  'Typed profile-structural predicate. It intentionally matches component/execution dimensions rather than a giant sale_type enum.';

comment on column public.store_opportunity_gate_policy_rules.applicability_state is
  'Policy outcome candidate: required, optional, not_applicable or needs_resolution. conflict is a materialization result, not a policy rule outcome.';

comment on table public.store_opportunity_gate_policy_current is
  'Explicit live policy pointer for one organization/store. Readers must never derive current from version ordering.';

comment on table public.commercial_opportunity_checklist_versions is
  'Append-only checklist-definition snapshots for one opportunity. Definition is separate from progress/resolution events.';

comment on column public.commercial_opportunity_checklist_versions.profile_version_id is
  'Exact immutable Commercial Opportunity Profile version used to materialize this checklist snapshot.';

comment on column public.commercial_opportunity_checklist_versions.gate_policy_version_id is
  'Exact immutable store gate-policy version used to materialize this checklist snapshot.';

comment on column public.commercial_opportunity_checklist_versions.settings_snapshot is
  'Immutable JSON snapshot of relevant live Settings consumed during materialization. It preserves historical inputs; later Settings changes must not rewrite this checklist.';

comment on column public.commercial_opportunity_checklist_versions.settings_fingerprint is
  'Lowercase SHA-256 fingerprint of the canonical Settings snapshot. Exact canonicalization/fingerprint verification belongs to the future materializer writer.';

comment on constraint p9_checklist_versions_state_chk
  on public.commercial_opportunity_checklist_versions is
  'Cross-row invariants between checklist_state and item applicability states belong to the future canonical materializer/writer.';

comment on table public.commercial_opportunity_checklist_items is
  'Immutable applicability items. commercial_gate and technical_requirement are distinct; technical requirements do not imply visits by themselves.';

comment on column public.commercial_opportunity_checklist_items.decision_basis is
  'Structured audit explanation for materialization inputs/rules. Structural current authority remains item_kind/item_key/applicability_state in the immutable checklist version.';

comment on table public.commercial_opportunity_checklist_current is
  'Explicit current checklist-definition pointer for one opportunity. Never select current by latest/max/version_number.';

comment on table public.commercial_opportunity_checklist_override_events is
  'Append-only human override audit. A valid override must produce a direct-child checklist version, preserve the same human actor and operation_key, and change the referenced item state.';

-- ============================================================================
-- Postconditions.
-- ============================================================================

do $postconditions$
declare
  v_expected record;
begin
  for v_expected in
    select *
    from (
      values
        ('store_opportunity_gate_policy_versions'::text),
        ('store_opportunity_gate_policy_rules'),
        ('store_opportunity_gate_policy_current'),
        ('commercial_opportunity_checklist_versions'),
        ('commercial_opportunity_checklist_items'),
        ('commercial_opportunity_checklist_current'),
        ('commercial_opportunity_checklist_override_events')
    ) as expected(table_name)
  loop
    if pg_catalog.to_regclass('public.' || v_expected.table_name) is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('postcondition failed: public.%s missing', v_expected.table_name);
    end if;
  end loop;

  for v_expected in
    select *
    from (
      values
        (
          'store_opportunity_gate_policy_versions'::text,
          'p9_gate_policy_versions_scope_id_uidx'::text,
          array['id', 'organization_id', 'store_id']::name[]
        ),
        (
          'commercial_opportunity_checklist_versions',
          'p9_checklist_versions_scope_id_uidx',
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
        message = pg_catalog.format('postcondition failed: %s contract mismatch', v_expected.index_name);
    end if;
  end loop;

  for v_expected in
    select *
    from (
      values
        ('store_opportunity_gate_policy_versions'::text, 'p9_gate_policy_versions_append_only'::text),
        ('store_opportunity_gate_policy_rules', 'p9_gate_policy_rules_append_only'),
        ('store_opportunity_gate_policy_current', 'p9_gate_policy_current_validate_projection'),
        ('store_opportunity_gate_policy_current', 'p9_gate_policy_current_touch_updated_at'),
        ('commercial_opportunity_checklist_versions', 'p9_checklist_versions_append_only'),
        ('commercial_opportunity_checklist_items', 'p9_checklist_items_append_only'),
        ('commercial_opportunity_checklist_current', 'p9_checklist_current_validate_projection'),
        ('commercial_opportunity_checklist_current', 'p9_checklist_current_touch_updated_at'),
        ('commercial_opportunity_checklist_override_events', 'p9_checklist_override_events_validate'),
        ('commercial_opportunity_checklist_override_events', 'p9_checklist_override_events_append_only')
    ) as expected(table_name, trigger_name)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid = ('public.' || v_expected.table_name)::regclass
        and trigger_row.tgname = v_expected.trigger_name
        and not trigger_row.tgisinternal
    ) then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('postcondition failed: trigger %s missing', v_expected.trigger_name);
    end if;
  end loop;

  if exists (
    select 1
    from (
      values
        ('store_opportunity_gate_policy_versions'::text),
        ('store_opportunity_gate_policy_rules'),
        ('store_opportunity_gate_policy_current'),
        ('commercial_opportunity_checklist_versions'),
        ('commercial_opportunity_checklist_items'),
        ('commercial_opportunity_checklist_current'),
        ('commercial_opportunity_checklist_override_events')
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
      message = 'postcondition failed: gate policy/checklist RLS missing';
  end if;
end;
$postconditions$;

commit;
