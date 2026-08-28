begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    '20260828130000_p9_commercial_message_intent_resolution_foundation',
    0
  )
);

do $preflight$
declare
  v_required_table text;
  v_required_column text;
  v_function_signature text;
begin
  if pg_catalog.to_regclass('auth.users') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: required relation auth.users does not exist';
  end if;

  foreach v_required_table in array array[
    'public.organizations',
    'public.stores',
    'public.customers',
    'public.memberships',
    'public.messages',
    'public.conversation_sessions',
    'public.commercial_opportunities',
    'public.lead_customer_links',
    'public.commercial_session_context_links'
  ] loop
    if pg_catalog.to_regclass(v_required_table) is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: required relation %s does not exist',
          v_required_table
        );
    end if;
  end loop;

  foreach v_required_column in array array[
    'organization_id',
    'store_id',
    'conversation_id',
    'conversation_session_id',
    'commercial_session_context_link_id',
    'commercial_context_capture_state',
    'lead_id',
    'sender',
    'direction'
  ] loop
    if not exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = 'messages'
        and column_row.column_name = v_required_column
    ) then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: public.messages.%s is missing',
          v_required_column
        );
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_class index_relation
    join pg_catalog.pg_index index_row
      on index_row.indexrelid = index_relation.oid
    join pg_catalog.pg_class table_relation
      on table_relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = table_relation.relnamespace
    where namespace_row.nspname = 'public'
      and table_relation.relname = 'commercial_opportunities'
      and index_relation.relname = 'commercial_opportunities_id_org_store_customer_uidx'
      and pg_catalog.pg_get_indexdef(index_relation.oid) like '%(id, organization_id, store_id, customer_id)%'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: commercial_opportunities_id_org_store_customer_uidx is missing or invalid';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class index_relation
    join pg_catalog.pg_index index_row
      on index_row.indexrelid = index_relation.oid
    join pg_catalog.pg_class table_relation
      on table_relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = table_relation.relnamespace
    where namespace_row.nspname = 'public'
      and table_relation.relname = 'lead_customer_links'
      and index_relation.relname = 'lead_customer_links_id_org_store_customer_uidx'
      and pg_catalog.pg_get_indexdef(index_relation.oid) like '%(id, organization_id, store_id, customer_id)%'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: lead_customer_links_id_org_store_customer_uidx is missing or invalid';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class index_relation
    join pg_catalog.pg_index index_row
      on index_row.indexrelid = index_relation.oid
    join pg_catalog.pg_class table_relation
      on table_relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = table_relation.relnamespace
    where namespace_row.nspname = 'public'
      and table_relation.relname = 'conversation_sessions'
      and index_relation.relname = 'conversation_sessions_id_org_store_conv_uidx'
      and pg_catalog.pg_get_indexdef(index_relation.oid) like '%(id, organization_id, store_id, conversation_id)%'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: conversation_sessions_id_org_store_conv_uidx is missing or invalid';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class class_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname in (
        'commercial_message_intent_resolution_events',
        'commercial_message_intent_resolution_current'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: commercial message intent resolution foundation already exists';
  end if;

  foreach v_function_signature in array array[
    'public.p9_cmir_validate_event()',
    'public.p9_cmir_validate_current_projection()',
    'public.p9_cmir_touch_current_updated_at()',
    'public.p9_cmir_prevent_event_mutation()',
    'public.p9_cmir_enforce_superseded_event_not_current()'
  ] loop
    if pg_catalog.to_regprocedure(v_function_signature) is not null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: internal function collision detected for %s',
          v_function_signature
        );
    end if;
  end loop;
end;
$preflight$;

create table public.commercial_message_intent_resolution_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  anchor_message_id uuid not null,
  conversation_id uuid not null,
  conversation_session_id uuid not null,
  customer_id uuid not null,
  lead_customer_link_id uuid not null,
  previous_context_opportunity_id uuid null,
  resolved_opportunity_id uuid null,
  related_opportunity_id uuid null,
  relation_type text null,
  decision_kind text not null,
  reason_code text not null,
  operation_key text not null,
  event_key text not null,
  supersedes_event_id uuid null,
  actor_type text not null,
  actor_user_id uuid null,
  created_by text not null,
  metadata jsonb null,
  created_at timestamptz not null default now(),

  constraint p9_cmir_events_org_fk
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint p9_cmir_events_store_scope_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint p9_cmir_events_anchor_message_fk
    foreign key (anchor_message_id)
    references public.messages(id)
    on delete restrict,

  constraint p9_cmir_events_session_scope_fk
    foreign key (
      conversation_session_id,
      organization_id,
      store_id,
      conversation_id
    )
    references public.conversation_sessions(
      id,
      organization_id,
      store_id,
      conversation_id
    )
    on delete restrict,

  constraint p9_cmir_events_customer_scope_fk
    foreign key (customer_id, organization_id)
    references public.customers(id, organization_id)
    on delete restrict,

  constraint p9_cmir_events_lead_link_scope_fk
    foreign key (
      lead_customer_link_id,
      organization_id,
      store_id,
      customer_id
    )
    references public.lead_customer_links(
      id,
      organization_id,
      store_id,
      customer_id
    )
    on delete restrict,

  constraint p9_cmir_events_previous_context_opp_scope_fk
    foreign key (
      previous_context_opportunity_id,
      organization_id,
      store_id,
      customer_id
    )
    references public.commercial_opportunities(
      id,
      organization_id,
      store_id,
      customer_id
    )
    on delete restrict,

  constraint p9_cmir_events_resolved_opp_scope_fk
    foreign key (
      resolved_opportunity_id,
      organization_id,
      store_id,
      customer_id
    )
    references public.commercial_opportunities(
      id,
      organization_id,
      store_id,
      customer_id
    )
    on delete restrict,

  constraint p9_cmir_events_related_opp_scope_fk
    foreign key (
      related_opportunity_id,
      organization_id,
      store_id,
      customer_id
    )
    references public.commercial_opportunities(
      id,
      organization_id,
      store_id,
      customer_id
    )
    on delete restrict,

  constraint p9_cmir_events_decision_kind_chk
    check (
      decision_kind in (
        'continue_same_intent',
        'reopen_same_intent',
        'new_independent_opportunity',
        'repurchase',
        'addendum',
        'needs_clarification',
        'structural_ambiguity'
      )
    ),

  constraint p9_cmir_events_relation_type_chk
    check (
      relation_type is null
      or relation_type in ('repurchase_of', 'addendum_to')
    ),

  constraint p9_cmir_events_reason_code_chk
    check (
      reason_code = pg_catalog.btrim(reason_code)
      and pg_catalog.length(reason_code) between 3 and 120
      and reason_code ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_cmir_events_operation_key_chk
    check (
      operation_key = pg_catalog.btrim(operation_key)
      and pg_catalog.length(operation_key) between 1 and 200
    ),

  constraint p9_cmir_events_event_key_chk
    check (
      pg_catalog.length(event_key) = 64
      and event_key ~ '^[0-9a-f]{64}$'
    ),

  constraint p9_cmir_events_actor_type_chk
    check (
      actor_type in (
        'system_rule',
        'ai',
        'human_correction',
        'migration_backfill'
      )
    ),

  constraint p9_cmir_events_actor_user_chk
    check (
      (actor_type = 'human_correction' and actor_user_id is not null)
      or (actor_type <> 'human_correction' and actor_user_id is null)
    ),

  constraint p9_cmir_events_actor_user_fk
    foreign key (actor_user_id)
    references auth.users(id)
    on delete restrict,

  constraint p9_cmir_events_created_by_chk
    check (
      pg_catalog.length(pg_catalog.btrim(created_by)) between 3 and 120
      and created_by ~ '^[a-z0-9_:.\/-]+$'
    ),

  constraint p9_cmir_events_metadata_chk
    check (
      metadata is null
      or pg_catalog.jsonb_typeof(metadata) = 'object'
    ),

  constraint p9_cmir_events_shape_chk
    check (
      (
        decision_kind in (
          'continue_same_intent',
          'reopen_same_intent',
          'new_independent_opportunity'
        )
        and resolved_opportunity_id is not null
        and related_opportunity_id is null
        and relation_type is null
      )
      or (
        decision_kind = 'repurchase'
        and resolved_opportunity_id is not null
        and related_opportunity_id is not null
        and relation_type = 'repurchase_of'
        and resolved_opportunity_id <> related_opportunity_id
      )
      or (
        decision_kind = 'addendum'
        and resolved_opportunity_id is not null
        and related_opportunity_id is not null
        and relation_type = 'addendum_to'
        and resolved_opportunity_id <> related_opportunity_id
      )
      or (
        decision_kind in ('needs_clarification', 'structural_ambiguity')
        and resolved_opportunity_id is null
        and related_opportunity_id is null
        and relation_type is null
      )
    ),

  constraint p9_cmir_events_context_decision_consistency_chk
    check (
      previous_context_opportunity_id is null
      or decision_kind in ('needs_clarification', 'structural_ambiguity')
      or (
        decision_kind in ('continue_same_intent', 'reopen_same_intent')
        and resolved_opportunity_id = previous_context_opportunity_id
      )
      or (
        decision_kind in (
          'new_independent_opportunity',
          'repurchase',
          'addendum'
        )
        and resolved_opportunity_id <> previous_context_opportunity_id
      )
    ),

  constraint p9_cmir_events_supersedes_self_chk
    check (
      supersedes_event_id is null
      or supersedes_event_id <> id
    )
);

create unique index p9_cmir_events_scope_anchor_operation_uidx
  on public.commercial_message_intent_resolution_events (
    organization_id,
    store_id,
    anchor_message_id,
    operation_key
  );

create unique index p9_cmir_events_scope_anchor_event_key_uidx
  on public.commercial_message_intent_resolution_events (
    organization_id,
    store_id,
    anchor_message_id,
    event_key
  );

create unique index p9_cmir_events_scope_anchor_id_uidx
  on public.commercial_message_intent_resolution_events (
    organization_id,
    store_id,
    anchor_message_id,
    id
  );

create unique index p9_cmir_events_supersedes_once_uidx
  on public.commercial_message_intent_resolution_events (
    supersedes_event_id
  )
  where supersedes_event_id is not null;

create index p9_cmir_events_scope_anchor_created_idx
  on public.commercial_message_intent_resolution_events (
    organization_id,
    store_id,
    anchor_message_id,
    created_at desc
  );

alter table public.commercial_message_intent_resolution_events
  add constraint p9_cmir_events_supersedes_scope_fk
  foreign key (
    organization_id,
    store_id,
    anchor_message_id,
    supersedes_event_id
  )
  references public.commercial_message_intent_resolution_events(
    organization_id,
    store_id,
    anchor_message_id,
    id
  )
  on delete restrict;

create table public.commercial_message_intent_resolution_current (
  organization_id uuid not null,
  store_id uuid not null,
  anchor_message_id uuid not null,
  current_event_id uuid not null,
  last_operation_key text not null,
  updated_at timestamptz not null default now(),

  constraint p9_cmir_current_pk
    primary key (organization_id, store_id, anchor_message_id),

  constraint p9_cmir_current_org_fk
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint p9_cmir_current_store_scope_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint p9_cmir_current_anchor_message_fk
    foreign key (anchor_message_id)
    references public.messages(id)
    on delete restrict,

  constraint p9_cmir_current_event_scope_fk
    foreign key (
      organization_id,
      store_id,
      anchor_message_id,
      current_event_id
    )
    references public.commercial_message_intent_resolution_events(
      organization_id,
      store_id,
      anchor_message_id,
      id
    )
    on delete restrict,

  constraint p9_cmir_current_last_operation_key_chk
    check (
      last_operation_key = pg_catalog.btrim(last_operation_key)
      and pg_catalog.length(last_operation_key) between 1 and 200
    )
);

create or replace function public.p9_cmir_validate_event()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_anchor_message public.messages;
  v_context_link public.commercial_session_context_links;
  v_lead_link public.lead_customer_links;
  v_superseded_event public.commercial_message_intent_resolution_events;
begin
  select message_row.*
  into v_anchor_message
  from public.messages message_row
  where message_row.id = new.anchor_message_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'commercial message intent resolution anchor message does not exist';
  end if;

  if v_anchor_message.organization_id is distinct from new.organization_id
     or v_anchor_message.store_id is distinct from new.store_id
     or v_anchor_message.conversation_id is distinct from new.conversation_id
     or v_anchor_message.conversation_session_id is distinct from new.conversation_session_id then
    raise exception using
      errcode = '23514',
      message = 'commercial message intent resolution anchor scope mismatch';
  end if;

  if v_anchor_message.sender <> 'user'
     or v_anchor_message.direction <> 'incoming' then
    raise exception using
      errcode = '23514',
      message = 'commercial message intent resolution requires inbound customer message';
  end if;

  if v_anchor_message.commercial_context_capture_state not in ('captured', 'pending_context') then
    raise exception using
      errcode = '23514',
      message = 'commercial message intent resolution requires captured or pending_context snapshot';
  end if;

  if v_anchor_message.lead_id is null then
    raise exception using
      errcode = '23514',
      message = 'commercial message intent resolution anchor message must belong to a lead';
  end if;

  select lead_link_row.*
  into v_lead_link
  from public.lead_customer_links lead_link_row
  where lead_link_row.id = new.lead_customer_link_id
    and lead_link_row.organization_id = new.organization_id
    and lead_link_row.store_id = new.store_id
    and lead_link_row.customer_id = new.customer_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'commercial message intent resolution lead customer link does not exist in scope';
  end if;

  if v_lead_link.lead_id is distinct from v_anchor_message.lead_id then
    raise exception using
      errcode = '23514',
      message = 'commercial message intent resolution lead customer link is incompatible with anchor message lead';
  end if;

  if v_anchor_message.commercial_context_capture_state = 'captured' then
    if v_anchor_message.commercial_session_context_link_id is null then
      raise exception using
        errcode = '23514',
        message = 'commercial message intent resolution captured snapshot is incomplete';
    end if;

    select context_row.*
    into v_context_link
    from public.commercial_session_context_links context_row
    where context_row.id = v_anchor_message.commercial_session_context_link_id
      and context_row.organization_id = new.organization_id
      and context_row.store_id = new.store_id
      and context_row.conversation_session_id = new.conversation_session_id;

    if not found then
      raise exception using
        errcode = '23514',
        message = 'commercial message intent resolution captured snapshot context is invalid';
    end if;

    if new.previous_context_opportunity_id is distinct from v_context_link.commercial_opportunity_id then
      raise exception using
        errcode = '23514',
        message = 'commercial message intent resolution previous context must match captured snapshot';
    end if;

    if new.customer_id is distinct from v_context_link.customer_id
       or new.lead_customer_link_id is distinct from v_context_link.lead_customer_link_id then
      raise exception using
        errcode = '23514',
        message = 'commercial message intent resolution captured snapshot identity mismatch';
    end if;
  elsif new.previous_context_opportunity_id is not null then
    raise exception using
      errcode = '23514',
      message = 'commercial message intent resolution pending_context requires previous_context_opportunity_id null';
  end if;

  if new.supersedes_event_id is not null then
    select event_row.*
    into v_superseded_event
    from public.commercial_message_intent_resolution_events event_row
    where event_row.id = new.supersedes_event_id
      and event_row.organization_id = new.organization_id
      and event_row.store_id = new.store_id
      and event_row.anchor_message_id = new.anchor_message_id;

    if not found then
      raise exception using
        errcode = '23503',
        message = 'commercial message intent resolution superseded event is outside anchor scope';
    end if;

    if new.conversation_id is distinct from v_superseded_event.conversation_id
       or new.conversation_session_id is distinct from v_superseded_event.conversation_session_id
       or new.customer_id is distinct from v_superseded_event.customer_id
       or new.lead_customer_link_id is distinct from v_superseded_event.lead_customer_link_id
       or new.previous_context_opportunity_id is distinct from v_superseded_event.previous_context_opportunity_id then
      raise exception using
        errcode = '23514',
        message = 'commercial message intent resolution correction cannot rewrite anchor identity or arrival snapshot';
    end if;

    if not exists (
      select 1
      from public.commercial_message_intent_resolution_current current_row
      where current_row.organization_id = new.organization_id
        and current_row.store_id = new.store_id
        and current_row.anchor_message_id = new.anchor_message_id
        and current_row.current_event_id = new.supersedes_event_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'commercial message intent resolution can only supersede the current canonical event';
    end if;
  elsif exists (
    select 1
    from public.commercial_message_intent_resolution_current current_row
    where current_row.organization_id = new.organization_id
      and current_row.store_id = new.store_id
      and current_row.anchor_message_id = new.anchor_message_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'commercial message intent resolution cannot create a parallel root after current exists';
  end if;

  return new;
end;
$function$;

create or replace function public.p9_cmir_validate_current_projection()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_event public.commercial_message_intent_resolution_events;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
       or new.store_id is distinct from old.store_id
       or new.anchor_message_id is distinct from old.anchor_message_id then
      raise exception using
        errcode = 'P0001',
        message = 'commercial message intent resolution current identity is immutable';
    end if;
  end if;

  select event_row.*
  into v_event
  from public.commercial_message_intent_resolution_events event_row
  where event_row.id = new.current_event_id
    and event_row.organization_id = new.organization_id
    and event_row.store_id = new.store_id
    and event_row.anchor_message_id = new.anchor_message_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'commercial message intent resolution current event is outside projection scope';
  end if;

  if new.last_operation_key is distinct from v_event.operation_key then
    raise exception using
      errcode = '23514',
      message = 'commercial message intent resolution current operation key does not match current event';
  end if;

  if tg_op = 'INSERT' then
    if v_event.supersedes_event_id is not null then
      raise exception using
        errcode = '23514',
        message = 'commercial message intent resolution current must initialize from a root event';
    end if;
  elsif new.current_event_id is distinct from old.current_event_id
        and v_event.supersedes_event_id is distinct from old.current_event_id then
    raise exception using
      errcode = '23514',
      message = 'commercial message intent resolution current must advance to the direct superseding event';
  end if;

  if exists (
    select 1
    from public.commercial_message_intent_resolution_events superseding_row
    where superseding_row.organization_id = new.organization_id
      and superseding_row.store_id = new.store_id
      and superseding_row.anchor_message_id = new.anchor_message_id
      and superseding_row.supersedes_event_id = new.current_event_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'commercial message intent resolution current cannot point to a superseded event';
  end if;

  return new;
end;
$function$;

create or replace function public.p9_cmir_touch_current_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

create or replace function public.p9_cmir_prevent_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
begin
  raise exception using
    errcode = 'P0001',
    message = 'commercial_message_intent_resolution_events is append-only';
end;
$function$;

create or replace function public.p9_cmir_enforce_superseded_event_not_current()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
begin
  if new.supersedes_event_id is not null
     and exists (
       select 1
       from public.commercial_message_intent_resolution_current current_row
       where current_row.organization_id = new.organization_id
         and current_row.store_id = new.store_id
         and current_row.anchor_message_id = new.anchor_message_id
         and current_row.current_event_id = new.supersedes_event_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'commercial message intent resolution current must move away from a superseded event in the same transaction';
  end if;

  return null;
end;
$function$;

alter function public.p9_cmir_validate_event()
  owner to postgres;
alter function public.p9_cmir_validate_current_projection()
  owner to postgres;
alter function public.p9_cmir_touch_current_updated_at()
  owner to postgres;
alter function public.p9_cmir_prevent_event_mutation()
  owner to postgres;
alter function public.p9_cmir_enforce_superseded_event_not_current()
  owner to postgres;

revoke all on function public.p9_cmir_validate_event()
  from public, anon, authenticated, service_role;
revoke all on function public.p9_cmir_validate_current_projection()
  from public, anon, authenticated, service_role;
revoke all on function public.p9_cmir_touch_current_updated_at()
  from public, anon, authenticated, service_role;
revoke all on function public.p9_cmir_prevent_event_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.p9_cmir_enforce_superseded_event_not_current()
  from public, anon, authenticated, service_role;

create trigger p9_cmir_events_validate_scope
  before insert on public.commercial_message_intent_resolution_events
  for each row
  execute function public.p9_cmir_validate_event();

create trigger p9_cmir_events_append_only
  before update or delete on public.commercial_message_intent_resolution_events
  for each row
  execute function public.p9_cmir_prevent_event_mutation();

create constraint trigger p9_cmir_events_superseded_not_current
  after insert on public.commercial_message_intent_resolution_events
  deferrable initially deferred
  for each row
  execute function public.p9_cmir_enforce_superseded_event_not_current();

create trigger p9_cmir_current_validate_projection
  before insert or update on public.commercial_message_intent_resolution_current
  for each row
  execute function public.p9_cmir_validate_current_projection();

create trigger p9_cmir_current_touch_updated_at
  before update on public.commercial_message_intent_resolution_current
  for each row
  execute function public.p9_cmir_touch_current_updated_at();

alter table public.commercial_message_intent_resolution_events enable row level security;
alter table public.commercial_message_intent_resolution_current enable row level security;

revoke all on table public.commercial_message_intent_resolution_events
  from public, anon, authenticated, service_role;
revoke all on table public.commercial_message_intent_resolution_current
  from public, anon, authenticated, service_role;

grant select on table public.commercial_message_intent_resolution_events
  to authenticated, service_role;
grant select on table public.commercial_message_intent_resolution_current
  to authenticated, service_role;

drop policy if exists p9_cmir_events_select_active_membership
  on public.commercial_message_intent_resolution_events;
create policy p9_cmir_events_select_active_membership
  on public.commercial_message_intent_resolution_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = commercial_message_intent_resolution_events.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active = true
    )
  );

drop policy if exists p9_cmir_current_select_active_membership
  on public.commercial_message_intent_resolution_current;
create policy p9_cmir_current_select_active_membership
  on public.commercial_message_intent_resolution_current
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = commercial_message_intent_resolution_current.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active = true
    )
  );

comment on table public.commercial_message_intent_resolution_events is
  'Ledger append-only de resolucao canonica da intencao comercial por anchor_message_id. Nao altera snapshot da mensagem, nao reabre opportunity e nao substitui commercial_session_context_links.';

comment on table public.commercial_message_intent_resolution_current is
  'Projecao minima da resolucao atualmente canonica por anchor_message_id. Current e explicitamente materializado; nao e derivado por latest/first/updated_at.';

comment on column public.commercial_message_intent_resolution_events.previous_context_opportunity_id is
  'Snapshot do contexto comercial capturado quando a mensagem entrou. Em captured deve espelhar exatamente o commercial_session_context_link da mensagem; em pending_context permanece null.';

comment on column public.commercial_message_intent_resolution_events.relation_type is
  'Semantica da resolucao entre opportunities. A materializacao fisica de relacoes fica para writer posterior e nao existe nesta foundation.';

do $postconditions$
begin
  if pg_catalog.to_regclass('public.commercial_message_intent_resolution_events') is null
     or pg_catalog.to_regclass('public.commercial_message_intent_resolution_current') is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: commercial message intent resolution tables are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_message_intent_resolution_events'::pg_catalog.regclass
      and constraint_row.conname = 'p9_cmir_events_session_scope_fk'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_message_intent_resolution_events'::pg_catalog.regclass
      and constraint_row.conname = 'p9_cmir_events_lead_link_scope_fk'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_message_intent_resolution_events'::pg_catalog.regclass
      and constraint_row.conname = 'p9_cmir_events_actor_user_fk'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_message_intent_resolution_current'::pg_catalog.regclass
      and constraint_row.conname = 'p9_cmir_current_event_scope_fk'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: critical commercial message intent resolution foreign keys are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_message_intent_resolution_events'::pg_catalog.regclass
      and constraint_row.conname = 'p9_cmir_events_shape_chk'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_message_intent_resolution_events'::pg_catalog.regclass
      and constraint_row.conname = 'p9_cmir_events_event_key_chk'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_message_intent_resolution_events'::pg_catalog.regclass
      and constraint_row.conname = 'p9_cmir_events_context_decision_consistency_chk'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: commercial message intent resolution checks are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class index_relation
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = index_relation.relnamespace
    where namespace_row.nspname = 'public'
      and index_relation.relname in (
        'p9_cmir_events_scope_anchor_operation_uidx',
        'p9_cmir_events_scope_anchor_event_key_uidx',
        'p9_cmir_events_scope_anchor_id_uidx',
        'p9_cmir_events_supersedes_once_uidx'
      )
    group by namespace_row.nspname
    having count(*) = 4
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: commercial message intent resolution unique indexes are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.commercial_message_intent_resolution_events'::pg_catalog.regclass
      and trigger_row.tgname = 'p9_cmir_events_validate_scope'
      and not trigger_row.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.commercial_message_intent_resolution_events'::pg_catalog.regclass
      and trigger_row.tgname = 'p9_cmir_events_append_only'
      and not trigger_row.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.commercial_message_intent_resolution_events'::pg_catalog.regclass
      and trigger_row.tgname = 'p9_cmir_events_superseded_not_current'
      and not trigger_row.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.commercial_message_intent_resolution_current'::pg_catalog.regclass
      and trigger_row.tgname = 'p9_cmir_current_validate_projection'
      and not trigger_row.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.commercial_message_intent_resolution_current'::pg_catalog.regclass
      and trigger_row.tgname = 'p9_cmir_current_touch_updated_at'
      and not trigger_row.tgisinternal
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: commercial message intent resolution triggers are missing';
  end if;

  if not (
    select class_row.relrowsecurity
    from pg_catalog.pg_class class_row
    where class_row.oid = 'public.commercial_message_intent_resolution_events'::pg_catalog.regclass
  ) or not (
    select class_row.relrowsecurity
    from pg_catalog.pg_class class_row
    where class_row.oid = 'public.commercial_message_intent_resolution_current'::pg_catalog.regclass
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: RLS must be enabled on commercial message intent resolution tables';
  end if;

  if not pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_message_intent_resolution_events',
       'SELECT'
     )
     or not pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_message_intent_resolution_current',
       'SELECT'
     )
     or not pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_message_intent_resolution_events',
       'SELECT'
     )
     or not pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_message_intent_resolution_current',
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'anon',
       'public.commercial_message_intent_resolution_events',
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'anon',
       'public.commercial_message_intent_resolution_current',
       'SELECT'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: commercial message intent resolution read grants are inconsistent';
  end if;

  if pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_message_intent_resolution_events',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_message_intent_resolution_events',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_message_intent_resolution_events',
       'DELETE'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_message_intent_resolution_current',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_message_intent_resolution_current',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_message_intent_resolution_current',
       'DELETE'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_message_intent_resolution_events',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_message_intent_resolution_events',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_message_intent_resolution_events',
       'DELETE'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_message_intent_resolution_current',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_message_intent_resolution_current',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_message_intent_resolution_current',
       'DELETE'
     )
     or pg_catalog.has_table_privilege(
       'anon',
       'public.commercial_message_intent_resolution_events',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'anon',
       'public.commercial_message_intent_resolution_events',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'anon',
       'public.commercial_message_intent_resolution_events',
       'DELETE'
     )
     or pg_catalog.has_table_privilege(
       'anon',
       'public.commercial_message_intent_resolution_current',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'anon',
       'public.commercial_message_intent_resolution_current',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'anon',
       'public.commercial_message_intent_resolution_current',
       'DELETE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: direct writes must remain closed until the canonical writer exists';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policy policy_row
    where policy_row.polrelid = 'public.commercial_message_intent_resolution_events'::pg_catalog.regclass
      and policy_row.polname = 'p9_cmir_events_select_active_membership'
  ) or not exists (
    select 1
    from pg_catalog.pg_policy policy_row
    where policy_row.polrelid = 'public.commercial_message_intent_resolution_current'::pg_catalog.regclass
      and policy_row.polname = 'p9_cmir_current_select_active_membership'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: active-membership select policies are missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid in (
      pg_catalog.to_regprocedure('public.p9_cmir_validate_event()'),
      pg_catalog.to_regprocedure('public.p9_cmir_validate_current_projection()'),
      pg_catalog.to_regprocedure('public.p9_cmir_touch_current_updated_at()'),
      pg_catalog.to_regprocedure('public.p9_cmir_prevent_event_mutation()'),
      pg_catalog.to_regprocedure('public.p9_cmir_enforce_superseded_event_not_current()')
    )
      and (
        pg_catalog.pg_get_userbyid(proc_row.proowner) <> 'postgres'
        or proc_row.prosecdef
        or proc_row.proconfig is distinct from array['search_path=pg_catalog, pg_temp']::text[]
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: commercial message intent resolution internal function hardening is inconsistent';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid in (
      pg_catalog.to_regprocedure('public.p9_cmir_validate_event()'),
      pg_catalog.to_regprocedure('public.p9_cmir_validate_current_projection()'),
      pg_catalog.to_regprocedure('public.p9_cmir_touch_current_updated_at()'),
      pg_catalog.to_regprocedure('public.p9_cmir_prevent_event_mutation()'),
      pg_catalog.to_regprocedure('public.p9_cmir_enforce_superseded_event_not_current()')
    )
      and (
        pg_catalog.has_function_privilege(
          'authenticated',
          proc_row.oid,
          'EXECUTE'
        )
        or pg_catalog.has_function_privilege(
          'service_role',
          proc_row.oid,
          'EXECUTE'
        )
        or pg_catalog.has_function_privilege(
          'anon',
          proc_row.oid,
          'EXECUTE'
        )
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: direct execution remains granted on internal commercial message intent resolution functions';
  end if;
end;
$postconditions$;

commit;
