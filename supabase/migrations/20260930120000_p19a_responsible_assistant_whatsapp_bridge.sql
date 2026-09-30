-- P19-A / Bloco 5 / Etapa 5.1
-- Ledger técnico do bridge WhatsApp do responsável <-> Assistente.
-- Preparada localmente; não executada nesta etapa.

-- Fail closed if the canonical Assistant / responsible schema is not compatible.
do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('public.store_assistant_messages') is null then
    v_missing := array_append(v_missing, 'public.store_assistant_messages');
  end if;

  if to_regclass('public.store_assistant_threads') is null then
    v_missing := array_append(v_missing, 'public.store_assistant_threads');
  end if;

  if to_regclass('public.store_responsibles') is null then
    v_missing := array_append(v_missing, 'public.store_responsibles');
  end if;

  if to_regclass('public.stores') is null then
    v_missing := array_append(v_missing, 'public.stores');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'P19A bridge precondition failed: missing canonical tables: %',
      array_to_string(v_missing, ', ');
  end if;

  if to_regprocedure('public.zion_resolve_request_role_internal()') is null then
    raise exception 'P19A bridge precondition failed: zion_resolve_request_role_internal() is required';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'store_assistant_messages'
       and column_name = 'sender_role'
  ) then
    raise exception 'P19A bridge precondition failed: store_assistant_messages.sender_role is required';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'store_assistant_messages'
       and column_name = 'metadata'
       and data_type in ('json', 'jsonb')
  ) then
    raise exception 'P19A bridge precondition failed: store_assistant_messages.metadata must be json/jsonb';
  end if;

  if exists (
    select 1
      from pg_constraint constraint_row
     where constraint_row.conrelid = 'public.store_assistant_messages'::regclass
       and constraint_row.contype = 'c'
       and pg_get_constraintdef(constraint_row.oid) ilike '%sender_role%'
       and pg_get_constraintdef(constraint_row.oid) not ilike '%store_responsible%'
  ) then
    raise exception 'P19A bridge precondition failed: sender_role check does not allow store_responsible';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'store_assistant_threads'
       and column_name = 'id'
  ) or not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'store_assistant_threads'
       and column_name = 'organization_id'
  ) or not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'store_assistant_threads'
       and column_name = 'store_id'
  ) then
    raise exception 'P19A bridge precondition failed: store_assistant_threads scope columns are required';
  end if;
end;
$$;

-- Composite unique targets used by tenant/store-scoped foreign keys.
create unique index if not exists store_responsibles_id_scope_uidx
  on public.store_responsibles (id, organization_id, store_id);

create unique index if not exists store_assistant_threads_id_scope_uidx
  on public.store_assistant_threads (id, organization_id, store_id);

create unique index if not exists store_assistant_messages_id_thread_scope_uidx
  on public.store_assistant_messages (id, organization_id, store_id, thread_id);

-- Do not allow the replay-protection index to hide historical duplicates.
do $$
begin
  if exists (
    select 1
      from public.store_assistant_messages message_row
     where message_row.sender_role = 'store_responsible'
       and message_row.direction = 'incoming'
       and message_row.metadata ->> 'origin' = 'whatsapp'
       and nullif(btrim(message_row.metadata ->> 'external_message_id'), '') is not null
     group by
       message_row.organization_id,
       message_row.store_id,
       message_row.metadata ->> 'external_message_id'
    having count(*) > 1
  ) then
    raise exception 'P19A bridge precondition failed: duplicate responsible WhatsApp message ids exist';
  end if;
end;
$$;

-- This migration has not been applied before. If this object already exists,
-- fail instead of silently accepting a partially-created / older definition.
create table public.store_assistant_responsible_whatsapp_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  responsible_id uuid not null,
  external_message_id text not null,
  thread_id uuid null,
  inbound_message_id uuid null,
  assistant_message_id uuid null,
  destination text not null,
  status text not null default 'received',
  locked_at timestamptz null,
  locked_by text null,
  claim_token text null,
  external_response_id text null,
  error_text text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint store_assistant_responsible_whatsapp_events_status_check
    check (status in ('received', 'processing', 'sent', 'failed', 'uncertain')),

  constraint store_assistant_responsible_whatsapp_events_external_message_check
    check (nullif(btrim(external_message_id), '') is not null),

  constraint store_assistant_responsible_whatsapp_events_destination_check
    check (nullif(btrim(destination), '') is not null),

  -- MATCH SIMPLE skips a composite FK when any referencing column is NULL.
  -- These checks prevent a message id from bypassing its scoped FK through a
  -- NULL thread_id.
  constraint store_assistant_responsible_whatsapp_events_inbound_thread_required_check
    check (inbound_message_id is null or thread_id is not null),

  constraint store_assistant_responsible_whatsapp_events_assistant_thread_required_check
    check (assistant_message_id is null or thread_id is not null),

  constraint store_assistant_responsible_whatsapp_events_claim_token_check
    check (
      claim_token is null
      or (
        nullif(btrim(claim_token), '') is not null
        and length(claim_token) <= 512
      )
    ),

  constraint store_assistant_responsible_whatsapp_events_locked_by_check
    check (
      locked_by is null
      or (
        nullif(btrim(locked_by), '') is not null
        and length(locked_by) <= 512
      )
    ),

  constraint store_assistant_responsible_whatsapp_events_processing_lock_check
    check (
      status <> 'processing'
      or (
        locked_at is not null
        and claim_token is not null
        and locked_by is not null
        and locked_by = claim_token
      )
    ),

  constraint store_assistant_responsible_whatsapp_events_scope_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id),

  constraint store_assistant_responsible_whatsapp_events_responsible_fkey
    foreign key (responsible_id, organization_id, store_id)
    references public.store_responsibles(id, organization_id, store_id)
    on delete restrict,

  constraint store_assistant_responsible_whatsapp_events_thread_fkey
    foreign key (thread_id, organization_id, store_id)
    references public.store_assistant_threads(id, organization_id, store_id)
    on delete restrict,

  constraint store_assistant_responsible_whatsapp_events_inbound_message_fkey
    foreign key (inbound_message_id, organization_id, store_id, thread_id)
    references public.store_assistant_messages(id, organization_id, store_id, thread_id)
    on delete restrict,

  constraint store_assistant_responsible_whatsapp_events_assistant_message_fkey
    foreign key (assistant_message_id, organization_id, store_id, thread_id)
    references public.store_assistant_messages(id, organization_id, store_id, thread_id)
    on delete restrict
);

create unique index store_assistant_responsible_whatsapp_events_external_uidx
  on public.store_assistant_responsible_whatsapp_events (
    organization_id,
    store_id,
    external_message_id
  );

create index store_assistant_responsible_whatsapp_events_status_idx
  on public.store_assistant_responsible_whatsapp_events (
    organization_id,
    store_id,
    status,
    updated_at
  );

create unique index store_assistant_messages_responsible_whatsapp_external_uidx
  on public.store_assistant_messages (
    organization_id,
    store_id,
    ((metadata ->> 'external_message_id'))
  )
  where sender_role = 'store_responsible'
    and direction = 'incoming'
    and metadata ->> 'origin' = 'whatsapp'
    and nullif(btrim(metadata ->> 'external_message_id'), '') is not null;

-- Atomic, service-role-only claim. Stale processing is reported but is not
-- automatically reclaimed: recovery remains explicit to avoid duplicate AI or
-- duplicate outbound consequences.
create or replace function public.claim_store_assistant_responsible_whatsapp_event(
  p_event_id uuid,
  p_claim_token text,
  p_now timestamptz default now(),
  p_stale_after interval default interval '10 minutes'
)
returns table (
  event_id uuid,
  claimed boolean,
  status text,
  claim_token text
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_claim_token text := nullif(btrim(p_claim_token), '');
begin
  if public.zion_resolve_request_role_internal() is distinct from 'service_role'
     or p_event_id is null
     or v_claim_token is null
     or length(v_claim_token) > 512
     or p_now is null
     or p_stale_after is null
     or p_stale_after <= interval '0 seconds' then
    raise exception using
      errcode = '42501',
      message = 'P19A_RESPONSIBLE_WHATSAPP_CLAIM_NOT_AUTHORIZED_OR_INVALID';
  end if;

  return query
  update public.store_assistant_responsible_whatsapp_events event_row
     set status = 'processing',
         locked_at = p_now,
         locked_by = v_claim_token,
         claim_token = v_claim_token,
         updated_at = p_now
   where event_row.id = p_event_id
     and event_row.status = 'received'
  returning
    event_row.id,
    true,
    event_row.status,
    event_row.claim_token;

  if not found then
    return query
    select
      event_row.id,
      false,
      case
        when event_row.status = 'processing'
         and event_row.locked_at is not null
         and event_row.locked_at <= p_now - p_stale_after
          then 'processing_stale'
        else event_row.status
      end,
      event_row.claim_token
      from public.store_assistant_responsible_whatsapp_events event_row
     where event_row.id = p_event_id;
  end if;
end;
$$;

alter function public.claim_store_assistant_responsible_whatsapp_event(uuid, text, timestamptz, interval)
  owner to postgres;

revoke all on function public.claim_store_assistant_responsible_whatsapp_event(uuid, text, timestamptz, interval)
  from public, anon, authenticated;

grant execute on function public.claim_store_assistant_responsible_whatsapp_event(uuid, text, timestamptz, interval)
  to service_role;

alter table public.store_assistant_responsible_whatsapp_events enable row level security;

revoke all on table public.store_assistant_responsible_whatsapp_events
  from public, anon, authenticated;

grant select, insert, update
  on table public.store_assistant_responsible_whatsapp_events
  to service_role;
