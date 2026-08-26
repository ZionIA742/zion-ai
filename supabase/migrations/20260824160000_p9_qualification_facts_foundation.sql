begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:b3:e3.1:qualification-facts-foundation:v1',
    0
  )
);

-- --------------------------------------------------------------------------
-- Preflight
-- --------------------------------------------------------------------------
do $preflight$
declare
  v_function_signature text;
begin
  if pg_catalog.to_regclass('public.organizations') is null
     or pg_catalog.to_regclass('public.stores') is null
     or pg_catalog.to_regclass('public.memberships') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null then
    raise exception using
      errcode = 'P0001',
      message = 'qualification facts prerequisites are missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'memberships'
      and column_name = 'is_active'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.memberships.is_active is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles role_row
    where role_row.rolname = 'anon'
  ) or not exists (
    select 1
    from pg_catalog.pg_roles role_row
    where role_row.rolname = 'authenticated'
  ) or not exists (
    select 1
    from pg_catalog.pg_roles role_row
    where role_row.rolname = 'service_role'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'qualification facts required roles are missing';
  end if;

  if pg_catalog.to_regclass('public.commercial_opportunity_qualification_fact_events') is not null
     or pg_catalog.to_regclass('public.commercial_opportunity_qualification_facts_current') is not null then
    raise exception using
      errcode = 'P0001',
      message = 'qualification facts objects already exist';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    where index_row.indrelid = 'public.stores'::pg_catalog.regclass
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indexprs is null
      and index_row.indpred is null
      and index_row.indnkeyatts = 2
      and index_row.indkey[0] = (
        select attribute_row.attnum
        from pg_catalog.pg_attribute attribute_row
        where attribute_row.attrelid = 'public.stores'::pg_catalog.regclass
          and attribute_row.attname = 'id'
          and not attribute_row.attisdropped
      )
      and index_row.indkey[1] = (
        select attribute_row.attnum
        from pg_catalog.pg_attribute attribute_row
        where attribute_row.attrelid = 'public.stores'::pg_catalog.regclass
          and attribute_row.attname = 'organization_id'
          and not attribute_row.attisdropped
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.stores(id, organization_id) unique target is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    where index_row.indrelid = 'public.commercial_opportunities'::pg_catalog.regclass
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indexprs is null
      and index_row.indpred is null
      and index_row.indnkeyatts = 3
      and index_row.indkey[0] = (
        select attribute_row.attnum
        from pg_catalog.pg_attribute attribute_row
        where attribute_row.attrelid = 'public.commercial_opportunities'::pg_catalog.regclass
          and attribute_row.attname = 'id'
          and not attribute_row.attisdropped
      )
      and index_row.indkey[1] = (
        select attribute_row.attnum
        from pg_catalog.pg_attribute attribute_row
        where attribute_row.attrelid = 'public.commercial_opportunities'::pg_catalog.regclass
          and attribute_row.attname = 'organization_id'
          and not attribute_row.attisdropped
      )
      and index_row.indkey[2] = (
        select attribute_row.attnum
        from pg_catalog.pg_attribute attribute_row
        where attribute_row.attrelid = 'public.commercial_opportunities'::pg_catalog.regclass
          and attribute_row.attname = 'store_id'
          and not attribute_row.attisdropped
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.commercial_opportunities(id, organization_id, store_id) unique target is missing';
  end if;

  foreach v_function_signature in array array[
    'public.p9_qfact_touch_current_updated_at()',
    'public.p9_qfact_prevent_event_mutation()',
    'public.p9_qfact_validate_current_projection()'
  ]
  loop
    if pg_catalog.to_regprocedure(v_function_signature) is not null then
      raise exception using
        errcode = 'P0001',
        message = format('qualification facts collision detected: %s', v_function_signature);
    end if;
  end loop;
end;
$preflight$;

-- --------------------------------------------------------------------------
-- Append-only ledger
-- --------------------------------------------------------------------------
create table public.commercial_opportunity_qualification_fact_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  fact_key text not null,
  value_json jsonb null,
  normalized_value_text text null,
  value_kind text not null,
  assertion_level text not null,
  source_type text not null,
  source_message_id uuid null,
  source_conversation_id uuid null,
  operation_key text not null,
  created_by text not null,
  resolves_conflict boolean not null default false,
  created_at timestamptz not null default now(),

  constraint p9_qfact_events_org_fk
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint p9_qfact_events_store_scope_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint p9_qfact_events_opp_scope_fk
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,

  constraint p9_qfact_events_fact_key_chk
    check (
      fact_key in (
        'need_summary',
        'interested_product_reference',
        'space_text',
        'requested_area_m2',
        'location_text',
        'preferred_period_text',
        'budget_text',
        'decision_context',
        'installation_interest',
        'payment_interest',
        'technical_visit_interest',
        'customer_preferences_text',
        'relevant_objection_text'
      )
    ),

  constraint p9_qfact_events_value_kind_chk
    check (value_kind in ('text', 'number', 'boolean')),

  constraint p9_qfact_events_assertion_chk
    check (assertion_level in ('inferred', 'confirmed')),

  constraint p9_qfact_events_source_type_chk
    check (
      source_type in (
        'incoming_customer_message',
        'crm_manual',
        'system_inference',
        'system_correction',
        'migration_backfill'
      )
    ),

  constraint p9_qfact_events_operation_key_chk
    check (
      operation_key = pg_catalog.btrim(operation_key)
      and pg_catalog.length(operation_key) between 1 and 200
    ),

  constraint p9_qfact_events_created_by_chk
    check (
      pg_catalog.length(pg_catalog.btrim(created_by)) between 3 and 120
      and created_by ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_qfact_events_fact_value_kind_chk
    check (
      (fact_key = 'requested_area_m2' and value_kind = 'number')
      or (
        fact_key in (
          'installation_interest',
          'payment_interest',
          'technical_visit_interest'
        )
        and value_kind = 'boolean'
      )
      or (
        fact_key in (
          'need_summary',
          'interested_product_reference',
          'space_text',
          'location_text',
          'preferred_period_text',
          'budget_text',
          'decision_context',
          'customer_preferences_text',
          'relevant_objection_text'
        )
        and value_kind = 'text'
      )
    ),

  constraint p9_qfact_events_source_assertion_chk
    check (
      source_type <> 'system_inference'
      or assertion_level = 'inferred'
    ),

  constraint p9_qfact_events_provenance_chk
    check (
      (source_message_id is null or source_conversation_id is not null)
      and (
        source_type <> 'incoming_customer_message'
        or (
          source_message_id is not null
          and source_conversation_id is not null
        )
      )
    ),

  constraint p9_qfact_events_normalized_text_chk
    check (
      (
        value_kind = 'text'
        and normalized_value_text is not null
        and normalized_value_text = pg_catalog.btrim(normalized_value_text)
        and pg_catalog.length(normalized_value_text) > 0
      )
      or (
        value_kind <> 'text'
        and normalized_value_text is null
      )
    ),

  constraint p9_qfact_events_value_payload_chk
    check (
      value_json is not null
      and value_json <> 'null'::jsonb
      and (
        (
          value_kind = 'text'
          and pg_catalog.jsonb_typeof(value_json) = 'string'
          and pg_catalog.length(pg_catalog.btrim(value_json #>> '{}')) > 0
        )
        or (
          value_kind = 'number'
          and pg_catalog.jsonb_typeof(value_json) = 'number'
        )
        or (
          value_kind = 'boolean'
          and pg_catalog.jsonb_typeof(value_json) = 'boolean'
        )
      )
    ),

  constraint p9_qfact_events_resolution_chk
    check (
      resolves_conflict is false
      or (
        assertion_level = 'confirmed'
        and source_type in (
          'incoming_customer_message',
          'crm_manual',
          'system_correction'
        )
      )
    )
);

create unique index p9_qfact_events_scope_fact_operation_uidx
  on public.commercial_opportunity_qualification_fact_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    fact_key,
    operation_key
  );

create unique index p9_qfact_events_scope_fact_id_uidx
  on public.commercial_opportunity_qualification_fact_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    fact_key,
    id
  );

create index p9_qfact_events_scope_fact_created_idx
  on public.commercial_opportunity_qualification_fact_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    fact_key,
    created_at desc
  );

create index p9_qfact_events_scope_created_idx
  on public.commercial_opportunity_qualification_fact_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    created_at desc
  );

-- --------------------------------------------------------------------------
-- Current projection
-- --------------------------------------------------------------------------
create table public.commercial_opportunity_qualification_facts_current (
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  fact_key text not null,
  current_state text not null,
  value_json jsonb null,
  normalized_value_text text null,
  value_kind text not null,
  conflict_values_json jsonb null,
  source_type text not null,
  source_message_id uuid null,
  source_conversation_id uuid null,
  last_event_id uuid not null,
  last_operation_key text not null,
  updated_at timestamptz not null default now(),

  constraint p9_qfact_current_pk
    primary key (
      organization_id,
      store_id,
      commercial_opportunity_id,
      fact_key
    ),

  constraint p9_qfact_current_org_fk
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint p9_qfact_current_store_scope_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint p9_qfact_current_opp_scope_fk
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,

  constraint p9_qfact_current_last_event_fk
    foreign key (
      organization_id,
      store_id,
      commercial_opportunity_id,
      fact_key,
      last_event_id
    )
    references public.commercial_opportunity_qualification_fact_events(
      organization_id,
      store_id,
      commercial_opportunity_id,
      fact_key,
      id
    )
    on delete restrict,

  constraint p9_qfact_current_fact_key_chk
    check (
      fact_key in (
        'need_summary',
        'interested_product_reference',
        'space_text',
        'requested_area_m2',
        'location_text',
        'preferred_period_text',
        'budget_text',
        'decision_context',
        'installation_interest',
        'payment_interest',
        'technical_visit_interest',
        'customer_preferences_text',
        'relevant_objection_text'
      )
    ),

  constraint p9_qfact_current_state_chk
    check (current_state in ('inferred', 'confirmed', 'conflict')),

  constraint p9_qfact_current_value_kind_chk
    check (value_kind in ('text', 'number', 'boolean')),

  constraint p9_qfact_current_source_type_chk
    check (
      source_type in (
        'incoming_customer_message',
        'crm_manual',
        'system_inference',
        'system_correction',
        'migration_backfill'
      )
    ),

  constraint p9_qfact_current_last_operation_key_chk
    check (
      last_operation_key = pg_catalog.btrim(last_operation_key)
      and pg_catalog.length(last_operation_key) between 1 and 200
    ),

  constraint p9_qfact_current_fact_value_kind_chk
    check (
      (fact_key = 'requested_area_m2' and value_kind = 'number')
      or (
        fact_key in (
          'installation_interest',
          'payment_interest',
          'technical_visit_interest'
        )
        and value_kind = 'boolean'
      )
      or (
        fact_key in (
          'need_summary',
          'interested_product_reference',
          'space_text',
          'location_text',
          'preferred_period_text',
          'budget_text',
          'decision_context',
          'customer_preferences_text',
          'relevant_objection_text'
        )
        and value_kind = 'text'
      )
    ),

  constraint p9_qfact_current_provenance_chk
    check (
      (source_message_id is null or source_conversation_id is not null)
      and (
        source_type <> 'incoming_customer_message'
        or (
          source_message_id is not null
          and source_conversation_id is not null
        )
      )
    ),

  constraint p9_qfact_current_normalized_text_chk
    check (
      (
        value_kind = 'text'
        and current_state in ('inferred', 'confirmed')
        and normalized_value_text is not null
        and normalized_value_text = pg_catalog.btrim(normalized_value_text)
        and pg_catalog.length(normalized_value_text) > 0
      )
      or (
        value_kind <> 'text'
        and normalized_value_text is null
      )
      or (
        current_state = 'conflict'
        and normalized_value_text is null
      )
    ),

  constraint p9_qfact_current_payload_chk
    check (
      (
        current_state in ('inferred', 'confirmed')
        and value_json is not null
        and value_json <> 'null'::jsonb
        and conflict_values_json is null
        and (
          (
            value_kind = 'text'
            and pg_catalog.jsonb_typeof(value_json) = 'string'
            and pg_catalog.length(pg_catalog.btrim(value_json #>> '{}')) > 0
          )
          or (
            value_kind = 'number'
            and pg_catalog.jsonb_typeof(value_json) = 'number'
          )
          or (
            value_kind = 'boolean'
            and pg_catalog.jsonb_typeof(value_json) = 'boolean'
          )
        )
      )
      or (
        current_state = 'conflict'
        and value_json is null
        and normalized_value_text is null
        and conflict_values_json is not null
        and pg_catalog.jsonb_typeof(conflict_values_json) = 'array'
        and pg_catalog.jsonb_array_length(conflict_values_json) >= 2
      )
    )
);

create index p9_qfact_current_scope_updated_idx
  on public.commercial_opportunity_qualification_facts_current (
    organization_id,
    store_id,
    commercial_opportunity_id,
    updated_at desc
  );

-- --------------------------------------------------------------------------
-- Internal integrity triggers
-- --------------------------------------------------------------------------
create or replace function public.p9_qfact_touch_current_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

create or replace function public.p9_qfact_validate_current_projection()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_event public.commercial_opportunity_qualification_fact_events%rowtype;
begin
  if tg_op = 'UPDATE'
     and (
       new.organization_id is distinct from old.organization_id
       or new.store_id is distinct from old.store_id
       or new.commercial_opportunity_id is distinct from old.commercial_opportunity_id
       or new.fact_key is distinct from old.fact_key
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'qualification current projection identity is immutable';
  end if;

  select event_row.*
  into v_event
  from public.commercial_opportunity_qualification_fact_events event_row
  where event_row.id = new.last_event_id
    and event_row.organization_id = new.organization_id
    and event_row.store_id = new.store_id
    and event_row.commercial_opportunity_id = new.commercial_opportunity_id
    and event_row.fact_key = new.fact_key;

  -- Let the composite FK produce 23503 if the event does not exist in scope.
  if not found then
    return new;
  end if;

  if new.last_operation_key <> v_event.operation_key then
    raise exception using
      errcode = 'P0001',
      message = 'qualification current projection operation_key does not match last event';
  end if;

  if new.value_kind <> v_event.value_kind
     or new.source_type <> v_event.source_type
     or new.source_message_id is distinct from v_event.source_message_id
     or new.source_conversation_id is distinct from v_event.source_conversation_id then
    raise exception using
      errcode = 'P0001',
      message = 'qualification current projection provenance does not match last event';
  end if;

  if new.current_state = 'inferred' then
    if v_event.assertion_level <> 'inferred'
       or v_event.resolves_conflict
       or new.value_json is distinct from v_event.value_json
       or new.normalized_value_text is distinct from v_event.normalized_value_text then
      raise exception using
        errcode = 'P0001',
        message = 'qualification inferred projection is inconsistent with last event';
    end if;
  elsif new.current_state = 'confirmed' then
    if v_event.assertion_level <> 'confirmed'
       or new.value_json is distinct from v_event.value_json
       or new.normalized_value_text is distinct from v_event.normalized_value_text then
      raise exception using
        errcode = 'P0001',
        message = 'qualification confirmed projection is inconsistent with last event';
    end if;
  elsif new.current_state = 'conflict' then
    if v_event.assertion_level <> 'confirmed'
       or v_event.resolves_conflict then
      raise exception using
        errcode = 'P0001',
        message = 'qualification conflict projection must point to a non-resolving confirmed event';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.p9_qfact_prevent_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
begin
  raise exception using
    errcode = 'P0001',
    message = 'commercial_opportunity_qualification_fact_events is append-only';
end;
$function$;

alter function public.p9_qfact_touch_current_updated_at()
  owner to postgres;
alter function public.p9_qfact_validate_current_projection()
  owner to postgres;
alter function public.p9_qfact_prevent_event_mutation()
  owner to postgres;

revoke all on function public.p9_qfact_touch_current_updated_at()
  from public, anon, authenticated, service_role;
revoke all on function public.p9_qfact_validate_current_projection()
  from public, anon, authenticated, service_role;
revoke all on function public.p9_qfact_prevent_event_mutation()
  from public, anon, authenticated, service_role;

create trigger p9_qfact_current_validate_projection
  before insert or update on public.commercial_opportunity_qualification_facts_current
  for each row
  execute function public.p9_qfact_validate_current_projection();

create trigger p9_qfact_current_touch_updated_at
  before update on public.commercial_opportunity_qualification_facts_current
  for each row
  execute function public.p9_qfact_touch_current_updated_at();

create trigger p9_qfact_events_append_only
  before update or delete on public.commercial_opportunity_qualification_fact_events
  for each row
  execute function public.p9_qfact_prevent_event_mutation();

-- --------------------------------------------------------------------------
-- RLS / ACL
-- --------------------------------------------------------------------------
alter table public.commercial_opportunity_qualification_fact_events enable row level security;
alter table public.commercial_opportunity_qualification_facts_current enable row level security;

revoke all on table public.commercial_opportunity_qualification_fact_events
  from public, anon, authenticated, service_role;
revoke all on table public.commercial_opportunity_qualification_facts_current
  from public, anon, authenticated, service_role;

grant select on table public.commercial_opportunity_qualification_fact_events
  to authenticated, service_role;
grant select on table public.commercial_opportunity_qualification_facts_current
  to authenticated, service_role;

-- Direct writes stay closed until the canonical writer exists.
drop policy if exists p9_qfact_events_select_active_membership
  on public.commercial_opportunity_qualification_fact_events;
create policy p9_qfact_events_select_active_membership
  on public.commercial_opportunity_qualification_fact_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = commercial_opportunity_qualification_fact_events.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active = true
    )
  );

drop policy if exists p9_qfact_current_select_active_membership
  on public.commercial_opportunity_qualification_facts_current;
create policy p9_qfact_current_select_active_membership
  on public.commercial_opportunity_qualification_facts_current
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = commercial_opportunity_qualification_facts_current.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active = true
    )
  );

comment on table public.commercial_opportunity_qualification_fact_events is
  'Ledger append-only de fatos de qualificacao por commercial_opportunity_id. Registra fato e proveniencia; nao representa autorizacao operacional nem altera Settings.';

comment on column public.commercial_opportunity_qualification_fact_events.resolves_conflict is
  'Resolve somente o conflito sobre qual fato deve ser considerado confirmado. Nao autoriza atendimento, preco, frete, visita, instalacao, excecao operacional ou mudanca de Settings.';

comment on column public.commercial_opportunity_qualification_fact_events.source_type is
  'system_inference nunca e autoridade confirmada. system_correction representa aplicacao deterministica de uma correcao explicita, nao inferencia livre da IA.';

comment on column public.commercial_opportunity_qualification_fact_events.fact_key is
  'interested_product_reference representa interesse do cliente, nunca disponibilidade, estoque ou prazo de fornecimento.';

comment on table public.commercial_opportunity_qualification_facts_current is
  'Projecao atual dos fatos de qualificacao por opportunity. missing e derivado pelo reader e nao e persistido. Consequencias comerciais e operacionais sao avaliadas separadamente.';

-- --------------------------------------------------------------------------
-- Postconditions
-- --------------------------------------------------------------------------
do $postconditions$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_opportunity_qualification_fact_events'::pg_catalog.regclass
      and constraint_row.conname = 'p9_qfact_events_opp_scope_fk'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: events opportunity scope fk is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_opportunity_qualification_facts_current'::pg_catalog.regclass
      and constraint_row.conname = 'p9_qfact_current_last_event_fk'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: current last_event scope fk is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_opportunity_qualification_fact_events'::pg_catalog.regclass
      and constraint_row.conname = 'p9_qfact_events_resolution_chk'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: conflict resolution authority check is missing';
  end if;

  if pg_catalog.to_regprocedure('public.p9_qfact_validate_current_projection()') is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: current projection validator is missing';
  end if;

  if not (
    select class_row.relrowsecurity
    from pg_catalog.pg_class class_row
    where class_row.oid = 'public.commercial_opportunity_qualification_fact_events'::pg_catalog.regclass
  ) or not (
    select class_row.relrowsecurity
    from pg_catalog.pg_class class_row
    where class_row.oid = 'public.commercial_opportunity_qualification_facts_current'::pg_catalog.regclass
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: RLS must be enabled on qualification facts tables';
  end if;

  if pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_opportunity_qualification_fact_events',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_opportunity_qualification_facts_current',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_opportunity_qualification_facts_current',
       'UPDATE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: direct service_role qualification writes must remain closed until the canonical writer exists';
  end if;

  if not pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_opportunity_qualification_fact_events',
       'SELECT'
     )
     or not pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_opportunity_qualification_facts_current',
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'anon',
       'public.commercial_opportunity_qualification_fact_events',
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'anon',
       'public.commercial_opportunity_qualification_facts_current',
       'SELECT'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: qualification facts read grants are inconsistent';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policy policy_row
    where policy_row.polrelid = 'public.commercial_opportunity_qualification_fact_events'::pg_catalog.regclass
      and policy_row.polname = 'p9_qfact_events_select_active_membership'
  ) or not exists (
    select 1
    from pg_catalog.pg_policy policy_row
    where policy_row.polrelid = 'public.commercial_opportunity_qualification_facts_current'::pg_catalog.regclass
      and policy_row.polname = 'p9_qfact_current_select_active_membership'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: active-membership select policies are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.commercial_opportunity_qualification_facts_current'::pg_catalog.regclass
      and trigger_row.tgname = 'p9_qfact_current_validate_projection'
      and not trigger_row.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.commercial_opportunity_qualification_facts_current'::pg_catalog.regclass
      and trigger_row.tgname = 'p9_qfact_current_touch_updated_at'
      and not trigger_row.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.commercial_opportunity_qualification_fact_events'::pg_catalog.regclass
      and trigger_row.tgname = 'p9_qfact_events_append_only'
      and not trigger_row.tgisinternal
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: qualification facts integrity triggers are missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid in (
      pg_catalog.to_regprocedure('public.p9_qfact_touch_current_updated_at()'),
      pg_catalog.to_regprocedure('public.p9_qfact_prevent_event_mutation()'),
      pg_catalog.to_regprocedure('public.p9_qfact_validate_current_projection()')
    )
      and (
        pg_catalog.pg_get_userbyid(proc_row.proowner) <> 'postgres'
        or proc_row.prosecdef
        or proc_row.proconfig is distinct from array['search_path=pg_catalog, pg_temp']::text[]
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: qualification facts internal function hardening is inconsistent';
  end if;

  if pg_catalog.has_function_privilege(
       'authenticated',
       'public.p9_qfact_validate_current_projection()',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.p9_qfact_validate_current_projection()',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: direct execution remains granted on internal qualification function';
  end if;
end;
$postconditions$;

commit;
