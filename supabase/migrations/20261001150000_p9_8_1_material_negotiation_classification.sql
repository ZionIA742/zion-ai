begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('20261001150000_p9_8_1_material_negotiation_classification', 0)
);

do $preflight$
declare
  v_required_relation text;
begin
  foreach v_required_relation in array array[
    'public.messages',
    'public.commercial_message_intent_resolution_events',
    'public.commercial_message_intent_resolution_current',
    'public.commercial_opportunity_stage_transition_authority'
  ] loop
    if pg_catalog.to_regclass(v_required_relation) is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('P9_8_1 material classification precondition missing: %s', v_required_relation);
    end if;
  end loop;
end;
$preflight$;

create table if not exists public.commercial_message_material_classification_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  message_id uuid not null,
  conversation_id uuid not null,
  conversation_session_id uuid not null,
  customer_id uuid not null,
  lead_customer_link_id uuid not null,
  commercial_opportunity_id uuid not null,
  material_kind text not null,
  classification_status text not null,
  evidence_text text not null,
  classifier_name text not null,
  classifier_version text not null,
  operation_key text not null,
  event_key text not null,
  supersedes_event_id uuid null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint p9_material_events_material_kind_chk check (
    material_kind in (
      'discount_request',
      'price_counteroffer',
      'payment_terms_negotiation',
      'included_items_negotiation',
      'commercial_deadline_negotiation',
      'concession_exchange',
      'no_material',
      'ambiguous'
    )
  ),
  constraint p9_material_events_status_chk check (
    classification_status in ('confirmed', 'ambiguous')
    and (material_kind <> 'no_material' or classification_status = 'confirmed')
  ),
  constraint p9_material_events_evidence_chk check (
    pg_catalog.length(pg_catalog.btrim(evidence_text)) between 1 and 2000
  ),
  constraint p9_material_events_classifier_chk check (
    classifier_name = 'sales_ai_material_negotiation'
    and classifier_version = 'v1'
  ),
  constraint p9_material_events_operation_key_chk check (
    operation_key = pg_catalog.btrim(operation_key)
    and pg_catalog.length(operation_key) between 1 and 200
  ),
  constraint p9_material_events_event_key_chk check (
    pg_catalog.length(event_key) = 64
    and event_key ~ '^[0-9a-f]{64}$'
  ),
  constraint p9_material_events_metadata_chk check (
    pg_catalog.jsonb_typeof(metadata) = 'object'
  ),
  constraint p9_material_events_supersedes_self_chk check (
    supersedes_event_id is null or supersedes_event_id <> id
  )
);

alter table public.commercial_message_material_classification_events owner to postgres;
alter table public.commercial_message_material_classification_events enable row level security;
revoke all on table public.commercial_message_material_classification_events
  from public, anon, authenticated, service_role;

create unique index if not exists p9_material_events_message_operation_uidx
  on public.commercial_message_material_classification_events (
    organization_id, store_id, message_id, operation_key
  );

create unique index if not exists p9_material_events_message_event_key_uidx
  on public.commercial_message_material_classification_events (
    organization_id, store_id, message_id, event_key
  );

create unique index if not exists p9_material_events_supersedes_once_uidx
  on public.commercial_message_material_classification_events (supersedes_event_id)
  where supersedes_event_id is not null;

create index if not exists p9_material_events_message_created_idx
  on public.commercial_message_material_classification_events (
    organization_id, store_id, message_id, created_at desc
  );

alter table public.commercial_message_material_classification_events
  add constraint p9_material_events_supersedes_scope_fk
  foreign key (supersedes_event_id)
  references public.commercial_message_material_classification_events(id)
  on delete restrict;

create table if not exists public.commercial_message_material_classification_current (
  organization_id uuid not null,
  store_id uuid not null,
  message_id uuid not null,
  material_kind text not null,
  current_event_id uuid not null,
  updated_at timestamptz not null default now(),

  constraint p9_material_current_pk primary key (
    organization_id, store_id, message_id, material_kind
  ),
  constraint p9_material_current_event_fk
    foreign key (current_event_id)
    references public.commercial_message_material_classification_events(id)
    on delete restrict
);

alter table public.commercial_message_material_classification_current owner to postgres;
alter table public.commercial_message_material_classification_current enable row level security;
revoke all on table public.commercial_message_material_classification_current
  from public, anon, authenticated, service_role;

create or replace function public.assert_commercial_message_material_classification(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_customer_id uuid,
  p_evidence_message_id uuid,
  p_material_kind text,
  p_evidence_summary text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_material_kind text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_material_kind, '')));
  v_evidence_summary text := nullif(pg_catalog.btrim(coalesce(p_evidence_summary, '')), '');
  v_message public.messages;
  v_cmir public.commercial_message_intent_resolution_events;
  v_material public.commercial_message_material_classification_events;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_customer_id is null
     or p_evidence_message_id is null
     or v_evidence_summary is null
     or v_material_kind not in (
       'discount_request',
       'price_counteroffer',
       'payment_terms_negotiation',
       'included_items_negotiation',
       'commercial_deadline_negotiation',
       'concession_exchange'
     ) then
    raise exception using errcode = '23514', message = 'ZION_MATERIAL_CLASSIFICATION_ARGUMENTS_INVALID';
  end if;

  select message_row.*
  into v_message
  from public.messages message_row
  where message_row.id = p_evidence_message_id
    and message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id;

  if not found
     or v_message.deleted_at is not null
     or v_message.sender <> 'user'
     or v_message.direction <> 'incoming'
     or pg_catalog.length(pg_catalog.btrim(coalesce(v_message.content, ''))) = 0 then
    raise exception using errcode = '23514', message = 'ZION_MATERIAL_CLASSIFICATION_MESSAGE_INVALID';
  end if;

  select event_row.*
  into v_cmir
  from public.commercial_message_intent_resolution_current current_row
  join public.commercial_message_intent_resolution_events event_row
    on event_row.id = current_row.current_event_id
   and event_row.organization_id = current_row.organization_id
   and event_row.store_id = current_row.store_id
   and event_row.anchor_message_id = current_row.anchor_message_id
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.anchor_message_id = p_evidence_message_id;

  if not found
     or v_cmir.customer_id is distinct from p_customer_id
     or v_cmir.resolved_opportunity_id is distinct from p_commercial_opportunity_id
     or v_cmir.conversation_id is distinct from v_message.conversation_id
     or v_cmir.conversation_session_id is distinct from v_message.conversation_session_id then
    raise exception using errcode = '23514', message = 'ZION_MATERIAL_CLASSIFICATION_CMIR_MISMATCH';
  end if;

  select event_row.*
  into v_material
  from public.commercial_message_material_classification_current current_row
  join public.commercial_message_material_classification_events event_row
    on event_row.id = current_row.current_event_id
   and event_row.organization_id = current_row.organization_id
   and event_row.store_id = current_row.store_id
   and event_row.message_id = current_row.message_id
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.message_id = p_evidence_message_id
    and current_row.material_kind = v_material_kind
    and event_row.classification_status = 'confirmed'
    and event_row.commercial_opportunity_id = p_commercial_opportunity_id
    and event_row.customer_id = p_customer_id
    and event_row.classifier_name = 'sales_ai_material_negotiation'
    and event_row.classifier_version = 'v1';

  if not found then
    raise exception using errcode = '23514', message = 'ZION_MATERIAL_CLASSIFICATION_NOT_CONFIRMED';
  end if;

  if v_material.evidence_text is distinct from v_evidence_summary then
    raise exception using errcode = '23514', message = 'ZION_MATERIAL_CLASSIFICATION_EVIDENCE_SUMMARY_MISMATCH';
  end if;

  if position(
       pg_catalog.lower(v_material.evidence_text)
       in pg_catalog.lower(v_message.content)
     ) = 0 then
    raise exception using errcode = '23514', message = 'ZION_MATERIAL_CLASSIFICATION_EVIDENCE_INVALID';
  end if;

  return v_material.id;
end;
$function$;

alter function public.assert_commercial_message_material_classification(
  uuid, uuid, uuid, uuid, uuid, text, text
) owner to postgres;

revoke all on function public.assert_commercial_message_material_classification(
  uuid, uuid, uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;

create or replace function public.write_commercial_message_material_classification_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_message_id uuid,
  p_customer_id uuid,
  p_commercial_opportunity_id uuid,
  p_material_kind text,
  p_classification_status text,
  p_evidence_text text,
  p_operation_key text,
  p_supersedes_event_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_classifier_name text default 'sales_ai_material_negotiation',
  p_classifier_version text default 'v1'
)
returns table (
  event_id uuid,
  material_kind text,
  classification_status text,
  supersedes_event_id uuid,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_kind text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_material_kind, '')));
  v_status text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_classification_status, '')));
  v_evidence text := nullif(pg_catalog.btrim(coalesce(p_evidence_text, '')), '');
  v_operation_key text := nullif(pg_catalog.btrim(coalesce(p_operation_key, '')), '');
  v_classifier_name text := nullif(pg_catalog.btrim(coalesce(p_classifier_name, '')), '');
  v_classifier_version text := nullif(pg_catalog.btrim(coalesce(p_classifier_version, '')), '');
  v_message public.messages;
  v_cmir public.commercial_message_intent_resolution_events;
  v_current public.commercial_message_material_classification_current;
  v_existing public.commercial_message_material_classification_events;
  v_event_id uuid;
  v_event_key text;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_message_id is null
     or p_customer_id is null
     or p_commercial_opportunity_id is null
     or v_kind not in (
       'discount_request', 'price_counteroffer', 'payment_terms_negotiation',
       'included_items_negotiation', 'commercial_deadline_negotiation',
       'concession_exchange', 'no_material', 'ambiguous'
     )
     or v_status not in ('confirmed', 'ambiguous')
     or (v_kind = 'no_material' and v_status <> 'confirmed')
     or v_evidence is null
     or v_operation_key is null
     or v_classifier_name is distinct from 'sales_ai_material_negotiation'
     or v_classifier_version is distinct from 'v1'
     or p_metadata is null
     or pg_catalog.jsonb_typeof(p_metadata) <> 'object' then
    raise exception using errcode = '22023', message = 'ZION_MATERIAL_CLASSIFICATION_ARGUMENTS_REQUIRED';
  end if;

  select message_row.*
  into v_message
  from public.messages message_row
  where message_row.id = p_message_id
    and message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id;

  if not found
     or v_message.deleted_at is not null
     or v_message.sender <> 'user'
     or v_message.direction <> 'incoming'
     or pg_catalog.length(pg_catalog.btrim(coalesce(v_message.content, ''))) = 0 then
    raise exception using errcode = '23514', message = 'ZION_MATERIAL_CLASSIFICATION_MESSAGE_INVALID';
  end if;

  if position(pg_catalog.lower(v_evidence) in pg_catalog.lower(v_message.content)) = 0 then
    raise exception using errcode = '23514', message = 'ZION_MATERIAL_CLASSIFICATION_EVIDENCE_INVALID';
  end if;

  select event_row.*
  into v_cmir
  from public.commercial_message_intent_resolution_current current_row
  join public.commercial_message_intent_resolution_events event_row
    on event_row.id = current_row.current_event_id
   and event_row.organization_id = current_row.organization_id
   and event_row.store_id = current_row.store_id
   and event_row.anchor_message_id = current_row.anchor_message_id
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.anchor_message_id = p_message_id;

  if not found
     or v_cmir.customer_id is distinct from p_customer_id
     or v_cmir.resolved_opportunity_id is distinct from p_commercial_opportunity_id
     or v_cmir.conversation_id is distinct from v_message.conversation_id
     or v_cmir.conversation_session_id is distinct from v_message.conversation_session_id then
    raise exception using errcode = '23514', message = 'ZION_MATERIAL_CLASSIFICATION_CMIR_MISMATCH';
  end if;

  v_event_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'organization_id', p_organization_id,
          'store_id', p_store_id,
          'message_id', p_message_id,
          'customer_id', p_customer_id,
          'commercial_opportunity_id', p_commercial_opportunity_id,
          'material_kind', v_kind,
          'classification_status', v_status,
          'evidence_text', v_evidence,
          'classifier_name', v_classifier_name,
          'classifier_version', v_classifier_version,
          'operation_key', v_operation_key,
          'supersedes_event_id', p_supersedes_event_id,
          'metadata', p_metadata
        )::text,
        'UTF8'::name
      ),
      'sha256'::text
    ),
    'hex'::text
  );

  select event_row.*
  into v_existing
  from public.commercial_message_material_classification_events event_row
  where event_row.organization_id = p_organization_id
    and event_row.store_id = p_store_id
    and event_row.message_id = p_message_id
    and event_row.operation_key = v_operation_key;

  if found then
    if v_existing.event_key is distinct from v_event_key then
      raise exception using errcode = '23505', message = 'ZION_MATERIAL_CLASSIFICATION_IDEMPOTENCY_KEY_REUSED';
    end if;

    return query select v_existing.id, v_existing.material_kind,
      v_existing.classification_status, v_existing.supersedes_event_id, true;
    return;
  end if;

  select * into v_current
  from public.commercial_message_material_classification_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.message_id = p_message_id
    and current_row.material_kind = v_kind
  for update;

  if p_supersedes_event_id is null then
    if found then
      raise exception using errcode = '23514', message = 'ZION_MATERIAL_CLASSIFICATION_SUPERSESSION_REQUIRED';
    end if;
  elsif not found or v_current.current_event_id is distinct from p_supersedes_event_id then
    raise exception using errcode = '40001', message = 'ZION_MATERIAL_CLASSIFICATION_CURRENT_CHANGED';
  end if;

  if p_supersedes_event_id is not null and not exists (
    select 1
    from public.commercial_message_material_classification_events previous_event
    where previous_event.id = p_supersedes_event_id
      and previous_event.organization_id = p_organization_id
      and previous_event.store_id = p_store_id
      and previous_event.message_id = p_message_id
      and previous_event.material_kind = v_kind
  ) then
    raise exception using errcode = '23514', message = 'ZION_MATERIAL_CLASSIFICATION_SUPERSESSION_SCOPE_INVALID';
  end if;

  insert into public.commercial_message_material_classification_events (
    organization_id, store_id, message_id, conversation_id,
    conversation_session_id, customer_id, lead_customer_link_id,
    commercial_opportunity_id, material_kind, classification_status,
    evidence_text, classifier_name, classifier_version, operation_key,
    event_key, supersedes_event_id, metadata
  )
  select
    p_organization_id, p_store_id, p_message_id, v_cmir.conversation_id,
    v_cmir.conversation_session_id, p_customer_id, v_cmir.lead_customer_link_id,
    p_commercial_opportunity_id, v_kind, v_status, v_evidence,
    v_classifier_name, v_classifier_version, v_operation_key, v_event_key,
    p_supersedes_event_id, p_metadata
  returning id into v_event_id;

  if p_supersedes_event_id is null then
    insert into public.commercial_message_material_classification_current (
      organization_id, store_id, message_id, material_kind, current_event_id
    ) values (
      p_organization_id, p_store_id, p_message_id, v_kind, v_event_id
    );
  else
    update public.commercial_message_material_classification_current current_row
    set current_event_id = v_event_id, updated_at = now()
    where current_row.organization_id = p_organization_id
      and current_row.store_id = p_store_id
      and current_row.message_id = p_message_id
      and current_row.material_kind = v_kind
      and current_row.current_event_id = p_supersedes_event_id;

    if not found then
      raise exception using errcode = '40001', message = 'ZION_MATERIAL_CLASSIFICATION_CURRENT_CHANGED';
    end if;
  end if;

  return query select v_event_id, v_kind, v_status, p_supersedes_event_id, false;
end;
$function$;

alter function public.write_commercial_message_material_classification_internal(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, uuid, jsonb, text, text
) owner to postgres;

revoke all on function public.write_commercial_message_material_classification_internal(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, uuid, jsonb, text, text
) from public, anon, authenticated, service_role;

create or replace function public.write_commercial_message_material_classification_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_message_id uuid,
  p_customer_id uuid,
  p_commercial_opportunity_id uuid,
  p_material_kind text,
  p_classification_status text,
  p_evidence_text text,
  p_operation_key text,
  p_supersedes_event_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_classifier_name text default 'sales_ai_material_negotiation',
  p_classifier_version text default 'v1'
)
returns table (
  event_id uuid,
  material_kind text,
  classification_status text,
  supersedes_event_id uuid,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
begin
  if v_request_role is distinct from 'service_role' and session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'commercial message material classification by system is not authorized';
  end if;

  return query
  select *
  from public.write_commercial_message_material_classification_internal(
    p_organization_id, p_store_id, p_message_id, p_customer_id,
    p_commercial_opportunity_id, p_material_kind, p_classification_status,
    p_evidence_text, p_operation_key, p_supersedes_event_id, p_metadata,
    p_classifier_name, p_classifier_version
  );
end;
$function$;

alter function public.write_commercial_message_material_classification_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, uuid, jsonb, text, text
) owner to postgres;

revoke all on function public.write_commercial_message_material_classification_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, uuid, jsonb, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.write_commercial_message_material_classification_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, uuid, jsonb, text, text
) to service_role;

create or replace function public.p9_material_negotiation_authority_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_kind text;
  v_customer_id uuid;
begin
  if new.target_stage = 'negociacao' then
    if pg_catalog.left(new.evidence_type, 21) <> 'material_negotiation_' then
      raise exception using errcode = '23514', message = 'ZION_MATERIAL_CLASSIFICATION_REQUIRED';
    end if;

    v_kind := pg_catalog.substr(new.evidence_type, 22);

    select opportunity_row.customer_id
    into v_customer_id
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = new.commercial_opportunity_id
      and opportunity_row.organization_id = new.organization_id
      and opportunity_row.store_id = new.store_id;

    perform public.assert_commercial_message_material_classification(
      new.organization_id,
      new.store_id,
      new.commercial_opportunity_id,
      v_customer_id,
      new.evidence_message_id,
      v_kind,
      new.evidence_summary
    );
  end if;

  return new;
end;
$function$;

alter function public.p9_material_negotiation_authority_guard() owner to postgres;

revoke all on function public.p9_material_negotiation_authority_guard() from public, anon, authenticated, service_role;

drop trigger if exists p9_material_negotiation_authority_guard
  on public.commercial_opportunity_stage_transition_authority;

create trigger p9_material_negotiation_authority_guard
before insert or update on public.commercial_opportunity_stage_transition_authority
for each row execute function public.p9_material_negotiation_authority_guard();

comment on table public.commercial_message_material_classification_events is
  'P9 8.1 canonical per-message material classification history. CMIR remains the identity/context authority.';

comment on table public.commercial_message_material_classification_current is
  'P9 8.1 current material classification projection. Multiple material kinds may coexist for one message.';

do $postconditions$
begin
  if pg_catalog.to_regprocedure(
       'public.write_commercial_message_material_classification_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,jsonb,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.assert_commercial_message_material_classification(uuid,uuid,uuid,uuid,uuid,text,text)'
     ) is null then
    raise exception using errcode = 'P0001', message = 'P9_8_1 material classification functions missing';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.commercial_opportunity_stage_transition_authority'::regclass
      and tgname = 'p9_material_negotiation_authority_guard'
      and not tgenabled = 'D'
  ) then
    raise exception using errcode = 'P0001', message = 'P9_8_1 material authority guard trigger missing';
  end if;
end;
$postconditions$;

commit;
