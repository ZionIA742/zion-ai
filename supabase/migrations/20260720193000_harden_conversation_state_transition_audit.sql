begin;

-- ZION / Pilar 9 / Fase 4 / 4.1B-3
-- Hardening estrutural, versionado e definitivo da transicao de estado
-- de conversas e da auditoria em state_transition_log.
--
-- Escopo:
-- - cria um nucleo canonico que deriva conversation -> lead -> store -> organization;
-- - preserva autoria, motivo, origem, metadata e event_key;
-- - endurece os caminhos publicos do painel;
-- - separa caminhos humanos e internos privilegiados;
-- - repara divergencias historicas deterministicas em state_transition_log;
-- - protege state_transition_log contra tenant incoerente;
-- - nao altera current_org_id e nao depende dela.

set local lock_timeout = '5s';
set local statement_timeout = '240s';
set local idle_in_transaction_session_timeout = '240s';
set local search_path = pg_catalog, pg_temp, public, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:conversation-state-transition-audit-hardening:v1',
    0
  )
);

do $preflight$
declare
  v_required_column_count integer;
begin
  if pg_catalog.to_regclass('public.conversations') is null
     or pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.stores') is null
     or pg_catalog.to_regclass('public.memberships') is null
     or pg_catalog.to_regclass('public.state_transition_log') is null
     or pg_catalog.to_regclass('public.state_transition_log_archive') is null
     or pg_catalog.to_regclass('auth.users') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: required conversation audit relations are missing';
  end if;

  if pg_catalog.to_regclass('public.conversations_id_organization_uidx') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: conversations_id_organization_uidx is required';
  end if;

  select count(*)
  into v_required_column_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'conversations'
    and column_name in (
      'id',
      'organization_id',
      'lead_id',
      'status',
      'is_human_active',
      'last_status_reason',
      'last_status_metadata'
    );

  if v_required_column_count <> 7 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: conversations is missing one or more required audit columns';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'memberships'
      and column_name = 'role'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: memberships.role is required for owner-only pilot authorization';
  end if;

  if exists (
    select 1
    from public.state_transition_log log_row
    where log_row.event_key is not null
    group by log_row.event_key
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'precondition failed: duplicate state_transition_log.event_key values already exist';
  end if;
end;
$preflight$;

-- --------------------------------------------------------------------------
-- Ajustes de schema minimos para conversas e logs.
-- --------------------------------------------------------------------------

alter table public.conversations
  add column if not exists last_status_actor_type text null,
  add column if not exists last_status_actor_user_id uuid null;

alter table public.conversations
  drop constraint if exists conversations_last_status_actor_user_fkey;

alter table public.conversations
  add constraint conversations_last_status_actor_user_fkey
  foreign key (last_status_actor_user_id)
  references auth.users(id)
  on delete restrict;

alter table public.state_transition_log
  add column if not exists organization_id uuid null,
  add column if not exists store_id uuid null,
  add column if not exists actor_type text null,
  add column if not exists actor_user_id uuid null,
  add column if not exists reason text null,
  add column if not exists source text null,
  add column if not exists metadata jsonb null,
  add column if not exists event_key text null;

alter table public.state_transition_log_archive
  add column if not exists id uuid null,
  add column if not exists organization_id uuid null,
  add column if not exists store_id uuid null,
  add column if not exists actor_type text null,
  add column if not exists actor_user_id uuid null,
  add column if not exists reason text null,
  add column if not exists source text null,
  add column if not exists metadata jsonb null,
  add column if not exists event_key text null,
  add column if not exists archived_at timestamptz null,
  add column if not exists archive_reason text null;

alter table public.state_transition_log
  alter column metadata set default '{}'::jsonb;

alter table public.state_transition_log_archive
  alter column metadata set default '{}'::jsonb;

do $archive_preflight$
declare
  v_missing_id bigint;
  v_duplicate_id bigint;
  v_missing_required bigint;
  v_invalid_actor bigint;
  v_missing_archive_fields bigint;
begin
  select count(*)
  into v_missing_id
  from public.state_transition_log_archive archive_row
  where archive_row.id is null;

  select count(*)
  into v_duplicate_id
  from (
    select archive_row.id
    from public.state_transition_log_archive archive_row
    where archive_row.id is not null
    group by archive_row.id
    having count(*) > 1
  ) duplicate_rows;

  select count(*)
  into v_missing_required
  from public.state_transition_log_archive archive_row
  where archive_row.organization_id is null
     or archive_row.store_id is null
     or archive_row.conversation_id is null
     or archive_row.to_state is null
     or archive_row.metadata is null
     or archive_row.created_at is null
     or archive_row.event_key is null;

  select count(*)
  into v_invalid_actor
  from public.state_transition_log_archive archive_row
  where archive_row.actor_type is null
     or archive_row.actor_type not in ('human', 'ai', 'system', 'migration')
     or (
       archive_row.actor_type = 'human'
       and archive_row.actor_user_id is null
     )
     or (
       archive_row.actor_type in ('ai', 'system', 'migration')
       and archive_row.actor_user_id is not null
     );

  select count(*)
  into v_missing_archive_fields
  from public.state_transition_log_archive archive_row
  where archive_row.archived_at is null
     or nullif(pg_catalog.btrim(coalesce(archive_row.archive_reason, '')), '') is null;

  if v_missing_id > 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'precondition failed: state_transition_log_archive contains %s row(s) with null id',
        v_missing_id
      );
  end if;

  if v_duplicate_id > 0 then
    raise exception using
      errcode = '23505',
      message = format(
        'precondition failed: state_transition_log_archive contains %s duplicated id value(s)',
        v_duplicate_id
      );
  end if;

  if v_missing_required > 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'precondition failed: state_transition_log_archive contains %s legacy row(s) with null mandatory audit fields',
        v_missing_required
      );
  end if;

  if v_invalid_actor > 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'precondition failed: state_transition_log_archive contains %s row(s) with invalid actor contract',
        v_invalid_actor
      );
  end if;

  if v_missing_archive_fields > 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'precondition failed: state_transition_log_archive contains %s legacy row(s) without archived_at/archive_reason and cannot be hardened automatically',
        v_missing_archive_fields
      );
  end if;
end;
$archive_preflight$;

drop index if exists public.state_transition_log_event_key_uidx;
create unique index state_transition_log_event_key_uidx
  on public.state_transition_log (event_key)
  where event_key is not null;

drop index if exists public.state_transition_log_conversation_created_idx;
create index state_transition_log_conversation_created_idx
  on public.state_transition_log (conversation_id, created_at desc);

drop index if exists public.state_transition_log_archive_conversation_created_idx;
create index state_transition_log_archive_conversation_created_idx
  on public.state_transition_log_archive (conversation_id, created_at desc);

alter table public.state_transition_log
  drop constraint if exists state_transition_log_actor_type_check;

alter table public.state_transition_log
  add constraint state_transition_log_actor_type_check
  check (
    actor_type is null
    or actor_type in ('human', 'ai', 'system', 'migration')
  );

alter table public.state_transition_log_archive
  drop constraint if exists state_transition_log_archive_actor_type_check;

alter table public.state_transition_log_archive
  add constraint state_transition_log_archive_actor_type_check
  check (
    actor_type in ('human', 'ai', 'system', 'migration')
    and (
      (
        actor_type = 'human'
        and actor_user_id is not null
      )
      or (
        actor_type in ('ai', 'system', 'migration')
        and actor_user_id is null
      )
    )
  );

alter table public.state_transition_log
  drop constraint if exists state_transition_log_actor_user_fkey;

alter table public.state_transition_log
  add constraint state_transition_log_actor_user_fkey
  foreign key (actor_user_id)
  references auth.users(id)
  on delete restrict;

alter table public.state_transition_log_archive
  drop constraint if exists state_transition_log_archive_actor_user_fkey;

alter table public.state_transition_log_archive
  add constraint state_transition_log_archive_actor_user_fkey
  foreign key (actor_user_id)
  references auth.users(id)
  on delete restrict;

alter table public.state_transition_log
  drop constraint if exists state_transition_log_organization_fkey;

alter table public.state_transition_log
  add constraint state_transition_log_organization_fkey
  foreign key (organization_id)
  references public.organizations(id)
  on delete restrict;

alter table public.state_transition_log
  drop constraint if exists state_transition_log_store_org_fkey;

alter table public.state_transition_log
  add constraint state_transition_log_store_org_fkey
  foreign key (store_id, organization_id)
  references public.stores(id, organization_id)
  on delete restrict;

alter table public.state_transition_log
  drop constraint if exists state_transition_log_conversation_org_fkey;

alter table public.state_transition_log
  add constraint state_transition_log_conversation_org_fkey
  foreign key (conversation_id, organization_id)
  references public.conversations(id, organization_id)
  on delete restrict;

-- --------------------------------------------------------------------------
-- Helpers canonicos.
-- --------------------------------------------------------------------------

create or replace function public._conversation_transition_allowed_state(
  p_state text
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_state text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_state, '')));
begin
  if v_state not in (
    'novo_lead',
    'qualificacao',
    'orcamento',
    'negociacao',
    'fechamento_pagamento',
    'pagamento_pendente_confirmacao',
    'agendar_visita',
    'agendar_instalacao',
    'pos_venda_nps',
    'perdido',
    'humano_assumiu'
  ) then
    raise exception using
      errcode = '22023',
      message = 'invalid conversation state';
  end if;

  return v_state;
end;
$function$;

alter function public._conversation_transition_allowed_state(text)
  owner to postgres;

revoke all on function public._conversation_transition_allowed_state(text)
  from public, anon, authenticated, service_role;

create or replace function public._conversation_transition_role_is_allowed(
  p_role text
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
  select pg_catalog.lower(pg_catalog.btrim(coalesce(p_role, ''))) = 'owner'
$function$;

alter function public._conversation_transition_role_is_allowed(text)
  owner to postgres;

revoke all on function public._conversation_transition_role_is_allowed(text)
  from public, anon, authenticated, service_role;

create or replace function public._conversation_transition_context(
  p_conversation_id uuid
)
returns table (
  conversation_id uuid,
  lead_id uuid,
  store_id uuid,
  organization_id uuid,
  current_status text,
  is_human_active boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
begin
  return query
  select
    conversation_row.id,
    conversation_row.lead_id,
    lead_row.store_id,
    lead_row.organization_id,
    conversation_row.status,
    conversation_row.is_human_active
  from public.conversations conversation_row
  join public.leads lead_row
    on lead_row.id = conversation_row.lead_id
  join public.stores store_row
    on store_row.id = lead_row.store_id
   and store_row.organization_id = lead_row.organization_id
  where conversation_row.id = p_conversation_id
    and conversation_row.organization_id = lead_row.organization_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'conversation canonical context is invalid';
  end if;
end;
$function$;

alter function public._conversation_transition_context(uuid)
  owner to postgres;

revoke all on function public._conversation_transition_context(uuid)
  from public, anon, authenticated, service_role;

create or replace function public._conversation_transition_validate_actor(
  p_actor_type text,
  p_actor_user_id uuid
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_actor_type text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_actor_type, '')));
begin
  if v_actor_type not in ('human', 'ai', 'system', 'migration') then
    raise exception using
      errcode = '22023',
      message = 'invalid conversation transition actor';
  end if;

  if v_actor_type = 'human' and p_actor_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'invalid conversation transition actor';
  end if;

  if v_actor_type <> 'human' and p_actor_user_id is not null then
    raise exception using
      errcode = '22023',
      message = 'invalid conversation transition actor';
  end if;

  return v_actor_type;
end;
$function$;

alter function public._conversation_transition_validate_actor(text, uuid)
  owner to postgres;

revoke all on function public._conversation_transition_validate_actor(text, uuid)
  from public, anon, authenticated, service_role;

create or replace function public._conversation_transition_effective_event_key(
  p_event_key text
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_event_key text := nullif(pg_catalog.btrim(coalesce(p_event_key, '')), '');
begin
  if v_event_key is not null then
    return v_event_key;
  end if;

  return 'state_transition:' || gen_random_uuid()::text;
end;
$function$;

alter function public._conversation_transition_effective_event_key(text)
  owner to postgres;

revoke all on function public._conversation_transition_effective_event_key(text)
  from public, anon, authenticated, service_role;

create or replace function public._conversation_transition_normalize_source(
  p_source text
)
returns text
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
  select coalesce(
    nullif(pg_catalog.btrim(coalesce(p_source, '')), ''),
    'conversation_transition'
  )
$function$;

alter function public._conversation_transition_normalize_source(text)
  owner to postgres;

revoke all on function public._conversation_transition_normalize_source(text)
  from public, anon, authenticated, service_role;

create or replace function public._conversation_transition_sla_event_key(
  p_payload jsonb,
  p_conversation_id uuid,
  p_to_state text,
  p_reason text
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_marker text;
begin
  v_marker := coalesce(
    nullif(pg_catalog.btrim(v_payload ->> 'event_key'), ''),
    nullif(pg_catalog.btrim(v_payload ->> 'dedupe_key'), ''),
    nullif(pg_catalog.btrim(v_payload ->> 'occurrence_key'), ''),
    nullif(pg_catalog.btrim(v_payload ->> 'runtime_row_id'), ''),
    nullif(pg_catalog.btrim(v_payload ->> 'state_entry_event_key'), ''),
    nullif(pg_catalog.btrim(v_payload ->> 'entered_state_at'), ''),
    nullif(pg_catalog.btrim(v_payload ->> 'state_entered_at'), ''),
    nullif(pg_catalog.btrim(v_payload ->> 'status_entered_at'), ''),
    nullif(pg_catalog.btrim(v_payload ->> 'state_started_at'), ''),
    nullif(pg_catalog.btrim(v_payload ->> 'current_state_started_at'), ''),
    nullif(pg_catalog.btrim(v_payload ->> 'from_state_at'), ''),
    nullif(pg_catalog.btrim(v_payload ->> 'deadline_at'), ''),
    nullif(pg_catalog.btrim(v_payload ->> 'violated_at'), ''),
    nullif(pg_catalog.btrim(v_payload ->> 'violation_at'), ''),
    nullif(pg_catalog.btrim(v_payload ->> 'breach_at'), ''),
    nullif(pg_catalog.btrim(v_payload ->> 'due_at'), '')
  );

  if v_marker is null then
    raise exception using
      errcode = 'P0001',
      message = 'conversation SLA runtime row is missing an occurrence marker for deterministic idempotency';
  end if;

  return pg_catalog.concat_ws(
    ':',
    'sla',
    p_conversation_id::text,
    public._conversation_transition_allowed_state(p_to_state),
    coalesce(nullif(pg_catalog.btrim(coalesce(p_reason, '')), ''), 'sla_violation'),
    v_marker
  );
end;
$function$;

alter function public._conversation_transition_sla_event_key(jsonb, uuid, text, text)
  owner to postgres;

revoke all on function public._conversation_transition_sla_event_key(jsonb, uuid, text, text)
  from public, anon, authenticated, service_role;

create or replace function public.resolve_human_release_target_state(
  p_conversation_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_previous_state text;
begin
  select log_row.to_state
  into v_previous_state
  from public.state_transition_log log_row
  where log_row.conversation_id = p_conversation_id
    and log_row.to_state is not null
    and log_row.to_state <> 'humano_assumiu'
  order by log_row.created_at desc, log_row.id desc
  limit 1;

  return coalesce(v_previous_state, 'qualificacao');
end;
$function$;

alter function public.resolve_human_release_target_state(uuid)
  owner to postgres;

revoke all on function public.resolve_human_release_target_state(uuid)
  from public, anon;

grant execute on function public.resolve_human_release_target_state(uuid)
  to authenticated, service_role;

-- --------------------------------------------------------------------------
-- Logger canonico.
-- --------------------------------------------------------------------------

create or replace function public.log_state_transition(
  p_conversation_id uuid,
  p_from_state text,
  p_to_state text,
  p_actor_type text,
  p_actor_user_id uuid default null,
  p_reason text default null,
  p_source text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_event_key text default null,
  p_organization_id uuid default null,
  p_store_id uuid default null
)
returns public.state_transition_log
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_context record;
  v_actor_type text;
  v_existing public.state_transition_log%rowtype;
  v_inserted public.state_transition_log%rowtype;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_event_key text;
  v_source text;
begin
  select *
  into v_context
  from public._conversation_transition_context(p_conversation_id);

  v_actor_type := public._conversation_transition_validate_actor(
    p_actor_type,
    p_actor_user_id
  );

  if p_organization_id is not null
     and p_organization_id is distinct from v_context.organization_id then
    raise exception using
      errcode = '23514',
      message = 'state transition tenant mismatch';
  end if;

  if p_store_id is not null
     and p_store_id is distinct from v_context.store_id then
    raise exception using
      errcode = '23514',
      message = 'state transition tenant mismatch';
  end if;

  if pg_catalog.jsonb_typeof(v_metadata) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'invalid state transition metadata';
  end if;

  v_event_key := public._conversation_transition_effective_event_key(p_event_key);
  v_source := public._conversation_transition_normalize_source(p_source);

  if v_event_key is not null then
    select *
    into v_existing
    from public.state_transition_log log_row
    where log_row.event_key = v_event_key;

    if found then
      if v_existing.conversation_id is distinct from p_conversation_id
         or v_existing.from_state is distinct from p_from_state
         or v_existing.to_state is distinct from p_to_state
         or coalesce(v_existing.actor_type, '') is distinct from v_actor_type
         or v_existing.actor_user_id is distinct from p_actor_user_id
         or coalesce(v_existing.reason, '') is distinct from coalesce(p_reason, '')
         or coalesce(v_existing.source, '') is distinct from v_source
         or coalesce(v_existing.organization_id, '00000000-0000-0000-0000-000000000000'::uuid)
              is distinct from v_context.organization_id
         or coalesce(v_existing.store_id, '00000000-0000-0000-0000-000000000000'::uuid)
              is distinct from v_context.store_id
         or coalesce(v_existing.metadata, '{}'::jsonb) is distinct from v_metadata then
        raise exception using
          errcode = '23505',
          message = 'state transition event_key conflict';
      end if;

      return v_existing;
    end if;
  end if;

  insert into public.state_transition_log (
    organization_id,
    store_id,
    conversation_id,
    from_state,
    to_state,
    actor_type,
    actor_user_id,
    reason,
    source,
    metadata,
    event_key
  ) values (
    v_context.organization_id,
    v_context.store_id,
    p_conversation_id,
    p_from_state,
    p_to_state,
    v_actor_type,
    p_actor_user_id,
    p_reason,
    v_source,
    v_metadata,
    v_event_key
  )
  returning * into v_inserted;

  return v_inserted;
end;
$function$;

alter function public.log_state_transition(
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  jsonb,
  text,
  uuid,
  uuid
) owner to postgres;

comment on function public.log_state_transition(
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  jsonb,
  text,
  uuid,
  uuid
) is
  'Logger canonico de state_transition_log. Deriva organization_id/store_id pela conversation e rejeita tenant incoerente.';

revoke all on function public.log_state_transition(
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  jsonb,
  text,
  uuid,
  uuid
) from public, anon, authenticated;

grant execute on function public.log_state_transition(
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  jsonb,
  text,
  uuid,
  uuid
) to service_role;

-- --------------------------------------------------------------------------
-- Trigger de integridade e trigger de log.
-- --------------------------------------------------------------------------

create or replace function public.enforce_state_transition_log_canonical_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_context record;
  v_actor_type text;
begin
  select *
  into v_context
  from public._conversation_transition_context(new.conversation_id);

  v_actor_type := public._conversation_transition_validate_actor(
    coalesce(new.actor_type, 'system'),
    new.actor_user_id
  );

  if tg_op = 'UPDATE' then
    if new.conversation_id is distinct from old.conversation_id
       or new.from_state is distinct from old.from_state
       or new.to_state is distinct from old.to_state
       or coalesce(new.actor_type, '') is distinct from coalesce(old.actor_type, '')
       or new.actor_user_id is distinct from old.actor_user_id
       or coalesce(new.reason, '') is distinct from coalesce(old.reason, '')
       or coalesce(new.source, '') is distinct from coalesce(old.source, '')
       or coalesce(new.event_key, '') is distinct from coalesce(old.event_key, '')
       or new.created_at is distinct from old.created_at then
      raise exception using
        errcode = 'P0001',
        message = 'state transition log audit fields are immutable';
    end if;
  end if;

  new.organization_id := v_context.organization_id;
  new.store_id := v_context.store_id;
  new.actor_type := v_actor_type;
  new.metadata := coalesce(new.metadata, '{}'::jsonb);

  return new;
end;
$function$;

alter function public.enforce_state_transition_log_canonical_scope()
  owner to postgres;

revoke all on function public.enforce_state_transition_log_canonical_scope()
  from public, anon, authenticated, service_role;

drop trigger if exists state_transition_log_enforce_canonical_scope
  on public.state_transition_log;

create trigger state_transition_log_enforce_canonical_scope
  before insert or update on public.state_transition_log
  for each row
  execute function public.enforce_state_transition_log_canonical_scope();

create or replace function public.trg_log_conversation_status_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_source text;
  v_metadata jsonb;
  v_event_key text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if old.status is not distinct from new.status then
    return new;
  end if;

  v_metadata := coalesce(new.last_status_metadata, '{}'::jsonb);
  v_source := coalesce(
    nullif(pg_catalog.btrim(v_metadata ->> 'source'), ''),
    nullif(pg_catalog.btrim(v_metadata ->> 'origin'), ''),
    'conversation_status_trigger'
  );
  v_event_key := nullif(pg_catalog.btrim(v_metadata ->> 'event_key'), '');

  perform public.log_state_transition(
    p_conversation_id => new.id,
    p_from_state => old.status,
    p_to_state => new.status,
    p_actor_type => coalesce(new.last_status_actor_type, 'system'),
    p_actor_user_id => new.last_status_actor_user_id,
    p_reason => new.last_status_reason,
    p_source => v_source,
    p_metadata => v_metadata,
    p_event_key => v_event_key,
    p_organization_id => new.organization_id,
    p_store_id => null
  );

  return new;
end;
$function$;

alter function public.trg_log_conversation_status_change()
  owner to postgres;

revoke all on function public.trg_log_conversation_status_change()
  from public, anon, authenticated, service_role;

drop trigger if exists log_conversation_status_change
  on public.conversations;

create trigger log_conversation_status_change
  after update of status on public.conversations
  for each row
  execute function public.trg_log_conversation_status_change();

-- --------------------------------------------------------------------------
-- Nucleo canonico de transicao.
-- --------------------------------------------------------------------------

create or replace function public._apply_conversation_state_transition(
  p_conversation_id uuid,
  p_to_state text,
  p_actor_type text,
  p_actor_user_id uuid default null,
  p_reason text default null,
  p_source text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_event_key text default null,
  p_request_organization_id uuid default null,
  p_request_store_id uuid default null,
  p_require_owner boolean default false
)
returns public.conversations
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_context record;
  v_target_state text;
  v_actor_type text;
  v_request_user_id uuid;
  v_membership_role text;
  v_existing_event public.state_transition_log%rowtype;
  v_result public.conversations%rowtype;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_effective_event_key text;
  v_source text;
begin
  select *
  into v_context
  from public._conversation_transition_context(p_conversation_id);

  v_target_state := public._conversation_transition_allowed_state(p_to_state);
  v_actor_type := public._conversation_transition_validate_actor(
    p_actor_type,
    p_actor_user_id
  );

  if p_request_organization_id is not null
     and p_request_organization_id is distinct from v_context.organization_id then
    raise exception using
      errcode = '23514',
      message = 'conversation transition organization mismatch';
  end if;

  if p_request_store_id is not null
     and p_request_store_id is distinct from v_context.store_id then
    raise exception using
      errcode = '23514',
      message = 'conversation transition store mismatch';
  end if;

  if pg_catalog.jsonb_typeof(v_metadata) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'invalid conversation transition metadata';
  end if;

  v_effective_event_key := public._conversation_transition_effective_event_key(
    p_event_key
  );
  v_source := public._conversation_transition_normalize_source(p_source);

  if v_effective_event_key is not null then
    select *
    into v_existing_event
    from public.state_transition_log log_row
    where log_row.event_key = v_effective_event_key;

    if found then
      if v_existing_event.conversation_id is distinct from p_conversation_id
         or v_existing_event.to_state is distinct from v_target_state
         or coalesce(v_existing_event.reason, '') is distinct from coalesce(p_reason, '')
         or coalesce(v_existing_event.actor_type, '') is distinct from v_actor_type
         or v_existing_event.actor_user_id is distinct from p_actor_user_id
         or coalesce(v_existing_event.source, '') is distinct from v_source
         or coalesce(v_existing_event.metadata, '{}'::jsonb) is distinct from v_metadata then
        raise exception using
          errcode = '23505',
          message = 'conversation transition event_key conflict';
      end if;

      select *
      into v_result
      from public.conversations conversation_row
      where conversation_row.id = p_conversation_id;

      return v_result;
    end if;
  end if;

  if v_actor_type = 'human' then
    v_request_user_id := p_actor_user_id;

    select membership_row.role
    into v_membership_role
    from public.memberships membership_row
    where membership_row.organization_id = v_context.organization_id
      and membership_row.user_id = v_request_user_id
    order by membership_row.created_at nulls first
    limit 1;

    if v_membership_role is null then
      raise exception using
        errcode = '42501',
        message = 'conversation transition is not authorized';
    end if;

    if p_require_owner
       and not public._conversation_transition_role_is_allowed(v_membership_role) then
      raise exception using
        errcode = '42501',
        message = 'conversation transition is not authorized';
    end if;
  end if;

  if v_context.current_status is distinct from v_target_state then
    update public.conversations
    set
      status = v_target_state,
      is_human_active = case
        when v_target_state = 'humano_assumiu' then true
        else false
      end,
      last_status_actor_type = v_actor_type,
      last_status_actor_user_id = p_actor_user_id,
      last_status_reason = p_reason,
      last_status_metadata = coalesce(last_status_metadata, '{}'::jsonb)
        || v_metadata
        || jsonb_build_object(
          'source', v_source,
          'event_key', v_effective_event_key,
          'store_id', v_context.store_id,
          'organization_id', v_context.organization_id
        )
    where id = p_conversation_id
    returning * into v_result;
  else
    update public.conversations
    set
      last_status_actor_type = case
        when v_actor_type = 'human' then v_actor_type
        else last_status_actor_type
      end,
      last_status_actor_user_id = case
        when v_actor_type = 'human' then p_actor_user_id
        else last_status_actor_user_id
      end,
      last_status_reason = case
        when v_actor_type = 'human' then p_reason
        else last_status_reason
      end,
      last_status_metadata = case
        when v_actor_type = 'human' then
          coalesce(last_status_metadata, '{}'::jsonb)
          || v_metadata
          || jsonb_build_object(
            'source', v_source,
            'event_key', v_effective_event_key,
            'store_id', v_context.store_id,
            'organization_id', v_context.organization_id
          )
        else last_status_metadata
      end
    where id = p_conversation_id
    returning * into v_result;
  end if;

  if pg_catalog.to_regclass('public.conversation_states') is not null then
    update public.conversation_states
    set state = v_target_state
    where conversation_id = p_conversation_id
      and organization_id = v_context.organization_id;

    if not found then
      begin
        insert into public.conversation_states (
          conversation_id,
          organization_id,
          state
        ) values (
          p_conversation_id,
          v_context.organization_id,
          v_target_state
        );
      exception
        when unique_violation then
          update public.conversation_states
          set state = v_target_state
          where conversation_id = p_conversation_id
            and organization_id = v_context.organization_id;
      end;
    end if;
  end if;

  return v_result;
end;
$function$;

alter function public._apply_conversation_state_transition(
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  jsonb,
  text,
  uuid,
  uuid,
  boolean
) owner to postgres;

revoke all on function public._apply_conversation_state_transition(
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  jsonb,
  text,
  uuid,
  uuid,
  boolean
) from public, anon, authenticated;

grant execute on function public._apply_conversation_state_transition(
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  jsonb,
  text,
  uuid,
  uuid,
  boolean
) to service_role;

create or replace function public.transition_conversation_state(
  p_conversation_id uuid,
  p_to_state text,
  p_reason text
)
returns public.conversations
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
begin
  return public._apply_conversation_state_transition(
    p_conversation_id => p_conversation_id,
    p_to_state => p_to_state,
    p_actor_type => 'system',
    p_actor_user_id => null,
    p_reason => p_reason,
    p_source => 'internal_transition_conversation_state',
    p_metadata => '{}'::jsonb,
    p_event_key => null,
    p_request_organization_id => null,
    p_request_store_id => null,
    p_require_owner => false
  );
end;
$function$;

alter function public.transition_conversation_state(uuid, text, text)
  owner to postgres;

revoke all on function public.transition_conversation_state(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.transition_conversation_state(uuid, text, text)
  to service_role;

create or replace function public.transition_conversation_state_internal(
  p_conversation_id uuid,
  p_to_state text,
  p_reason text,
  p_actor_type text,
  p_source text,
  p_event_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.conversations
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
begin
  return public._apply_conversation_state_transition(
    p_conversation_id => p_conversation_id,
    p_to_state => p_to_state,
    p_actor_type => p_actor_type,
    p_actor_user_id => null,
    p_reason => p_reason,
    p_source => p_source,
    p_metadata => p_metadata,
    p_event_key => p_event_key,
    p_request_organization_id => null,
    p_request_store_id => null,
    p_require_owner => false
  );
end;
$function$;

alter function public.transition_conversation_state_internal(
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb
) owner to postgres;

revoke all on function public.transition_conversation_state_internal(
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.transition_conversation_state_internal(
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb
) to service_role;

create or replace function public.update_conversation_state(
  p_conversation_id uuid,
  p_to_state text
)
returns public.conversations
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
begin
  return public.transition_conversation_state(
    p_conversation_id,
    p_to_state,
    null
  );
end;
$function$;

create or replace function public.update_conversation_state(
  p_conversation_id uuid,
  p_to_state text,
  p_reason text
)
returns public.conversations
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
begin
  return public.transition_conversation_state(
    p_conversation_id,
    p_to_state,
    p_reason
  );
end;
$function$;

alter function public.update_conversation_state(uuid, text)
  owner to postgres;
alter function public.update_conversation_state(uuid, text, text)
  owner to postgres;

revoke all on function public.update_conversation_state(uuid, text)
  from public, anon, authenticated;
revoke all on function public.update_conversation_state(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.update_conversation_state(uuid, text)
  to service_role;
grant execute on function public.update_conversation_state(uuid, text, text)
  to service_role;

create or replace function public.human_takeover_conversation(
  p_conversation_id uuid,
  p_reason text
)
returns public.conversations
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'conversation transition is not authorized';
  end if;

  return public._apply_conversation_state_transition(
    p_conversation_id => p_conversation_id,
    p_to_state => 'humano_assumiu',
    p_actor_type => 'human',
    p_actor_user_id => v_user_id,
    p_reason => p_reason,
    p_source => 'human_takeover',
    p_metadata => '{}'::jsonb,
    p_event_key => null,
    p_request_organization_id => null,
    p_request_store_id => null,
    p_require_owner => true
  );
end;
$function$;

create or replace function public.human_release_conversation_to_ai(
  p_conversation_id uuid,
  p_reason text,
  p_origin text
)
returns public.conversations
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_target_state text;
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'conversation transition is not authorized';
  end if;

  v_target_state := public.resolve_human_release_target_state(p_conversation_id);

  return public._apply_conversation_state_transition(
    p_conversation_id => p_conversation_id,
    p_to_state => v_target_state,
    p_actor_type => 'human',
    p_actor_user_id => v_user_id,
    p_reason => p_reason,
    p_source => coalesce(nullif(pg_catalog.btrim(coalesce(p_origin, '')), ''), 'human_release'),
    p_metadata => '{}'::jsonb,
    p_event_key => null,
    p_request_organization_id => null,
    p_request_store_id => null,
    p_require_owner => true
  );
end;
$function$;

alter function public.human_takeover_conversation(uuid, text)
  owner to postgres;
alter function public.human_release_conversation_to_ai(uuid, text, text)
  owner to postgres;

revoke all on function public.human_takeover_conversation(uuid, text)
  from public, anon;
revoke all on function public.human_release_conversation_to_ai(uuid, text, text)
  from public, anon;

grant execute on function public.human_takeover_conversation(uuid, text)
  to authenticated;
grant execute on function public.human_release_conversation_to_ai(uuid, text, text)
  to authenticated;

create or replace function public.panel_transition_conversation_state_scoped(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_to_state text,
  p_reason text
)
returns public.conversations
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'conversation transition is not authorized';
  end if;

  return public._apply_conversation_state_transition(
    p_conversation_id => p_conversation_id,
    p_to_state => p_to_state,
    p_actor_type => 'human',
    p_actor_user_id => v_user_id,
    p_reason => p_reason,
    p_source => 'panel_transition',
    p_metadata => '{}'::jsonb,
    p_event_key => null,
    p_request_organization_id => p_organization_id,
    p_request_store_id => null,
    p_require_owner => true
  );
end;
$function$;

create or replace function public.panel_takeover_conversation_scoped(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_reason text
)
returns public.conversations
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'conversation transition is not authorized';
  end if;

  return public._apply_conversation_state_transition(
    p_conversation_id => p_conversation_id,
    p_to_state => 'humano_assumiu',
    p_actor_type => 'human',
    p_actor_user_id => v_user_id,
    p_reason => p_reason,
    p_source => 'panel_takeover',
    p_metadata => '{}'::jsonb,
    p_event_key => null,
    p_request_organization_id => p_organization_id,
    p_request_store_id => null,
    p_require_owner => true
  );
end;
$function$;

create or replace function public.panel_release_conversation_to_ai_scoped(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_reason text
)
returns public.conversations
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
begin
  return public.panel_release_conversation_to_ai_scoped(
    p_organization_id,
    p_conversation_id,
    p_reason,
    'panel_release'
  );
end;
$function$;

create or replace function public.panel_release_conversation_to_ai_scoped(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_reason text,
  p_origin text
)
returns public.conversations
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_target_state text;
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'conversation transition is not authorized';
  end if;

  v_target_state := public.resolve_human_release_target_state(p_conversation_id);

  return public._apply_conversation_state_transition(
    p_conversation_id => p_conversation_id,
    p_to_state => v_target_state,
    p_actor_type => 'human',
    p_actor_user_id => v_user_id,
    p_reason => p_reason,
    p_source => coalesce(nullif(pg_catalog.btrim(coalesce(p_origin, '')), ''), 'panel_release'),
    p_metadata => '{}'::jsonb,
    p_event_key => null,
    p_request_organization_id => p_organization_id,
    p_request_store_id => null,
    p_require_owner => true
  );
end;
$function$;

alter function public.panel_transition_conversation_state_scoped(uuid, uuid, text, text)
  owner to postgres;
alter function public.panel_takeover_conversation_scoped(uuid, uuid, text)
  owner to postgres;
alter function public.panel_release_conversation_to_ai_scoped(uuid, uuid, text)
  owner to postgres;
alter function public.panel_release_conversation_to_ai_scoped(uuid, uuid, text, text)
  owner to postgres;

revoke all on function public.panel_transition_conversation_state_scoped(uuid, uuid, text, text)
  from public, anon, service_role;
revoke all on function public.panel_takeover_conversation_scoped(uuid, uuid, text)
  from public, anon, service_role;
revoke all on function public.panel_release_conversation_to_ai_scoped(uuid, uuid, text)
  from public, anon, service_role;
revoke all on function public.panel_release_conversation_to_ai_scoped(uuid, uuid, text, text)
  from public, anon, service_role;

grant execute on function public.panel_transition_conversation_state_scoped(uuid, uuid, text, text)
  to authenticated;
grant execute on function public.panel_takeover_conversation_scoped(uuid, uuid, text)
  to authenticated;
grant execute on function public.panel_release_conversation_to_ai_scoped(uuid, uuid, text)
  to authenticated;
grant execute on function public.panel_release_conversation_to_ai_scoped(uuid, uuid, text, text)
  to authenticated;

create or replace function public.transition_conversation_state_by_user(
  p_conversation_id uuid,
  p_to_state text,
  p_actor_user_id uuid,
  p_reason text,
  p_source text,
  p_request_organization_id uuid default null,
  p_event_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.conversations
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
begin
  return public._apply_conversation_state_transition(
    p_conversation_id => p_conversation_id,
    p_to_state => p_to_state,
    p_actor_type => 'human',
    p_actor_user_id => p_actor_user_id,
    p_reason => p_reason,
    p_source => p_source,
    p_metadata => p_metadata,
    p_event_key => p_event_key,
    p_request_organization_id => p_request_organization_id,
    p_request_store_id => null,
    p_require_owner => true
  );
end;
$function$;

alter function public.transition_conversation_state_by_user(
  uuid,
  text,
  uuid,
  text,
  text,
  uuid,
  text,
  jsonb
) owner to postgres;

revoke all on function public.transition_conversation_state_by_user(
  uuid,
  text,
  uuid,
  text,
  text,
  uuid,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.transition_conversation_state_by_user(
  uuid,
  text,
  uuid,
  text,
  text,
  uuid,
  text,
  jsonb
) to service_role;

create or replace function public.panel_get_conversation_state_history_scoped(
  p_organization_id uuid,
  p_conversation_id uuid
)
returns table (
  organization_id uuid,
  store_id uuid,
  conversation_id uuid,
  from_state text,
  to_state text,
  actor_type text,
  actor_user_id uuid,
  reason text,
  source text,
  metadata jsonb,
  event_key text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_context record;
  v_membership_role text;
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'conversation transition is not authorized';
  end if;

  select *
  into v_context
  from public._conversation_transition_context(p_conversation_id);

  if p_organization_id is distinct from v_context.organization_id then
    raise exception using
      errcode = '42501',
      message = 'conversation transition is not authorized';
  end if;

  select membership_row.role
  into v_membership_role
  from public.memberships membership_row
  where membership_row.organization_id = v_context.organization_id
    and membership_row.user_id = v_user_id
  order by membership_row.created_at nulls first
  limit 1;

  if v_membership_role is null
     or not public._conversation_transition_role_is_allowed(v_membership_role) then
    raise exception using
      errcode = '42501',
      message = 'conversation transition is not authorized';
  end if;

  return query
  select
    log_row.organization_id,
    log_row.store_id,
    log_row.conversation_id,
    log_row.from_state,
    log_row.to_state,
    log_row.actor_type,
    log_row.actor_user_id,
    log_row.reason,
    log_row.source,
    coalesce(log_row.metadata, '{}'::jsonb),
    log_row.event_key,
    log_row.created_at
  from (
    select
      stl.organization_id,
      stl.store_id,
      stl.conversation_id,
      stl.from_state,
      stl.to_state,
      stl.actor_type,
      stl.actor_user_id,
      stl.reason,
      stl.source,
      stl.metadata,
      stl.event_key,
      stl.created_at
    from public.state_transition_log stl
    where stl.conversation_id = p_conversation_id

    union all

    select
      stla.organization_id,
      stla.store_id,
      stla.conversation_id,
      stla.from_state,
      stla.to_state,
      stla.actor_type,
      stla.actor_user_id,
      stla.reason,
      stla.source,
      stla.metadata,
      stla.event_key,
      stla.created_at
    from public.state_transition_log_archive stla
    where stla.conversation_id = p_conversation_id
  ) log_row
  where log_row.organization_id = v_context.organization_id
  order by log_row.created_at desc;
end;
$function$;

alter function public.panel_get_conversation_state_history_scoped(uuid, uuid)
  owner to postgres;

revoke all on function public.panel_get_conversation_state_history_scoped(uuid, uuid)
  from public, anon, service_role;

grant execute on function public.panel_get_conversation_state_history_scoped(uuid, uuid)
  to authenticated;

-- --------------------------------------------------------------------------
-- SLA e archive.
-- --------------------------------------------------------------------------

create or replace function public.process_sla_violations()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_row record;
  v_payload jsonb;
  v_conversation_id uuid;
  v_to_state text;
  v_reason text;
  v_event_key text;
  v_event_exists_before boolean;
  v_processed bigint := 0;
begin
  if pg_catalog.to_regclass('public.conversations_sla_runtime') is null then
    raise exception using
      errcode = 'P0001',
      message = 'conversation SLA runtime view is missing';
  end if;

  for v_row in
    execute 'select pg_catalog.to_jsonb(runtime_row) as payload from public.conversations_sla_runtime runtime_row'
  loop
    v_payload := v_row.payload;
    v_conversation_id := nullif(v_payload ->> 'conversation_id', '')::uuid;
    v_to_state := coalesce(
      nullif(v_payload ->> 'to_state', ''),
      nullif(v_payload ->> 'target_state', ''),
      nullif(v_payload ->> 'next_state', '')
    );
    v_reason := coalesce(
      nullif(v_payload ->> 'reason', ''),
      nullif(v_payload ->> 'reason_code', ''),
      'sla_violation'
    );

    if v_conversation_id is null or v_to_state is null then
      raise exception using
        errcode = 'P0001',
        message = 'conversation SLA runtime row is missing canonical transition fields';
    end if;

    if v_reason = 'sla_violated' then
      v_reason := 'sla_violation';
      v_payload := v_payload || jsonb_build_object(
        'reason_normalization',
        jsonb_build_object(
          'legacy_reason', 'sla_violated',
          'canonical_reason', 'sla_violation',
          'migration', '20260720193000_harden_conversation_state_transition_audit'
        )
      );
    end if;

    v_event_key := public._conversation_transition_sla_event_key(
      v_payload,
      v_conversation_id,
      v_to_state,
      v_reason
    );

    select exists (
      select 1
      from public.state_transition_log log_row
      where log_row.event_key = v_event_key
    )
    into v_event_exists_before;

    if v_event_exists_before then
      continue;
    end if;

    perform public.transition_conversation_state_internal(
      p_conversation_id => v_conversation_id,
      p_to_state => v_to_state,
      p_reason => v_reason,
      p_actor_type => 'system',
      p_source => 'sla_runtime',
      p_event_key => v_event_key,
      p_metadata => v_payload
    );

    if exists (
      select 1
      from public.state_transition_log log_row
      where log_row.event_key = v_event_key
    ) then
      v_processed := v_processed + 1;
    end if;
  end loop;

  return v_processed;
end;
$function$;

alter function public.process_sla_violations()
  owner to postgres;

revoke all on function public.process_sla_violations()
  from public, anon, authenticated;

grant execute on function public.process_sla_violations()
  to service_role;

create or replace function public.process_stale_human_conversations()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_row record;
  v_event_key text;
  v_event_exists_before boolean;
  v_processed bigint := 0;
begin
  -- AGUARDAR DOSSIÊ FINAL DO PILAR 9:
  -- preservar timeout de 10 minutos e retorno automático para qualificacao.
  for v_row in
    select
      conversation_row.id as conversation_id,
      human_log.id as human_log_id
    from public.conversations conversation_row
    join lateral (
      select log_row.id, log_row.created_at
      from public.state_transition_log log_row
      where log_row.conversation_id = conversation_row.id
        and log_row.to_state = 'humano_assumiu'
      order by log_row.created_at desc, log_row.id desc
      limit 1
    ) human_log on true
    where conversation_row.status = 'humano_assumiu'
      and coalesce(conversation_row.is_human_active, false)
      and human_log.created_at <= pg_catalog.clock_timestamp() - interval '10 minutes'
  loop
    v_event_key := pg_catalog.concat(
      'auto_timeout_human:',
      v_row.human_log_id::text
    );

    select exists (
      select 1
      from public.state_transition_log log_row
      where log_row.event_key = v_event_key
    )
    into v_event_exists_before;

    if v_event_exists_before then
      continue;
    end if;

    perform public.transition_conversation_state_internal(
      p_conversation_id => v_row.conversation_id,
      p_to_state => 'qualificacao',
      p_reason => 'auto_timeout_human',
      p_actor_type => 'system',
      p_source => 'human_timeout_auto_release',
      p_event_key => v_event_key,
      p_metadata => jsonb_build_object(
        'source', 'human_timeout_auto_release',
        'origin', 'human_timeout_auto_release',
        'timeout_minutes', 10,
        'timed_out_humano_assumiu_log_id', v_row.human_log_id
      )
    );

    if exists (
      select 1
      from public.state_transition_log log_row
      where log_row.event_key = v_event_key
    ) then
      v_processed := v_processed + 1;
    end if;
  end loop;

  return v_processed;
end;
$function$;

alter function public.process_stale_human_conversations()
  owner to postgres;

revoke all on function public.process_stale_human_conversations()
  from public, anon, authenticated;

grant execute on function public.process_stale_human_conversations()
  to service_role;

create or replace function public.archive_state_transition_log(
  p_older_than interval
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_archived bigint := 0;
  v_cutoff timestamptz;
  v_invalid_source_rows bigint;
begin
  if p_older_than is null or p_older_than <= interval '0 seconds' then
    raise exception using
      errcode = '22023',
      message = 'invalid archive interval';
  end if;

  v_cutoff := pg_catalog.clock_timestamp() - p_older_than;

  select count(*)
  into v_invalid_source_rows
  from public.state_transition_log source_row
  where source_row.created_at < v_cutoff
    and (
      source_row.id is null
      or source_row.organization_id is null
      or source_row.store_id is null
      or source_row.conversation_id is null
      or source_row.to_state is null
      or source_row.actor_type is null
      or source_row.metadata is null
      or source_row.created_at is null
      or source_row.event_key is null
      or source_row.actor_type not in ('human', 'ai', 'system', 'migration')
      or (
        source_row.actor_type = 'human'
        and source_row.actor_user_id is null
      )
      or (
        source_row.actor_type in ('ai', 'system', 'migration')
        and source_row.actor_user_id is not null
      )
    );

  if v_invalid_source_rows > 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'archive aborted: %s state_transition_log row(s) older than cutoff do not satisfy the archive audit contract',
        v_invalid_source_rows
      );
  end if;

  insert into public.state_transition_log_archive (
    id,
    organization_id,
    store_id,
    conversation_id,
    from_state,
    to_state,
    actor_type,
    actor_user_id,
    reason,
    source,
    metadata,
    event_key,
    created_at,
    archived_at,
    archive_reason
  )
  select
    source_row.id,
    source_row.organization_id,
    source_row.store_id,
    source_row.conversation_id,
    source_row.from_state,
    source_row.to_state,
    source_row.actor_type,
    source_row.actor_user_id,
    source_row.reason,
    source_row.source,
    source_row.metadata,
    source_row.event_key,
    source_row.created_at,
    pg_catalog.clock_timestamp(),
    'retention_snapshot'
  from public.state_transition_log source_row
  where source_row.created_at < v_cutoff
    and not exists (
      select 1
      from public.state_transition_log_archive archive_row
      where archive_row.id = source_row.id
    );

  get diagnostics v_archived = row_count;
  return v_archived;
end;
$function$;

alter function public.archive_state_transition_log(interval)
  owner to postgres;

revoke all on function public.archive_state_transition_log(interval)
  from public, anon, authenticated;

grant execute on function public.archive_state_transition_log(interval)
  to service_role;

create or replace function public.prevent_state_transition_log_archive_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if tg_op = 'UPDATE' then
    raise exception using
      errcode = 'P0001',
      message = 'state transition log archive is immutable';
  end if;

  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'P0001',
      message = 'state transition log archive delete is not allowed';
  end if;

  return old;
end;
$function$;

alter function public.prevent_state_transition_log_archive_mutation()
  owner to postgres;

revoke all on function public.prevent_state_transition_log_archive_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists state_transition_log_archive_prevent_mutation
  on public.state_transition_log_archive;

create trigger state_transition_log_archive_prevent_mutation
  before update or delete on public.state_transition_log_archive
  for each row
  execute function public.prevent_state_transition_log_archive_mutation();

do $archive_contract$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.state_transition_log_archive'::pg_catalog.regclass
      and constraint_row.contype = 'p'
  ) then
    alter table public.state_transition_log_archive
      add constraint state_transition_log_archive_pkey primary key (id);
  end if;
end;
$archive_contract$;

alter table public.state_transition_log_archive
  alter column id set not null,
  alter column organization_id set not null,
  alter column store_id set not null,
  alter column conversation_id set not null,
  alter column to_state set not null,
  alter column actor_type set not null,
  alter column metadata set not null,
  alter column created_at set not null,
  alter column event_key set not null,
  alter column archived_at set not null,
  alter column archive_reason set not null;

alter table public.state_transition_log_archive
  drop constraint if exists state_transition_log_archive_archive_reason_not_blank;

alter table public.state_transition_log_archive
  add constraint state_transition_log_archive_archive_reason_not_blank
  check (pg_catalog.length(pg_catalog.btrim(archive_reason)) > 0);

revoke insert, update, delete, truncate
  on table public.state_transition_log_archive
  from public, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- Reparo historico deterministico dos tenants no log.
-- --------------------------------------------------------------------------

drop table if exists pg_temp._stl_canonical_repairs;

create temp table _stl_canonical_repairs
on commit drop
as
select
  log_row.id,
  log_row.organization_id as previous_organization_id,
  log_row.store_id as previous_store_id,
  conversation_row.id as conversation_id,
  lead_row.organization_id as canonical_organization_id,
  lead_row.store_id as canonical_store_id
from public.state_transition_log log_row
join public.conversations conversation_row
  on conversation_row.id = log_row.conversation_id
join public.leads lead_row
  on lead_row.id = conversation_row.lead_id
join public.stores store_row
  on store_row.id = lead_row.store_id
 and store_row.organization_id = lead_row.organization_id
where log_row.organization_id is distinct from lead_row.organization_id
   or log_row.store_id is distinct from lead_row.store_id;

do $repair_guard$
begin
  if exists (
    select 1
    from public.state_transition_log log_row
    left join public.conversations conversation_row
      on conversation_row.id = log_row.conversation_id
    left join public.leads lead_row
      on lead_row.id = conversation_row.lead_id
    left join public.stores store_row
      on store_row.id = lead_row.store_id
    where log_row.organization_id is distinct from coalesce(lead_row.organization_id, log_row.organization_id)
       or log_row.store_id is distinct from coalesce(lead_row.store_id, log_row.store_id)
      and (
        conversation_row.id is null
        or lead_row.id is null
        or store_row.id is null
        or store_row.organization_id is distinct from lead_row.organization_id
        or conversation_row.organization_id is distinct from lead_row.organization_id
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'repair aborted: one or more state_transition_log rows are structurally ambiguous';
  end if;
end;
$repair_guard$;

update public.state_transition_log log_row
set
  organization_id = repair_row.canonical_organization_id,
  store_id = repair_row.canonical_store_id,
  metadata = coalesce(log_row.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'tenant_repair',
      jsonb_build_object(
        'previous_organization_id', repair_row.previous_organization_id,
        'previous_store_id', repair_row.previous_store_id,
        'canonical_organization_id', repair_row.canonical_organization_id,
        'canonical_store_id', repair_row.canonical_store_id,
        'migration', '20260720193000_harden_conversation_state_transition_audit'
      )
    )
from pg_temp._stl_canonical_repairs repair_row
where log_row.id = repair_row.id;

-- --------------------------------------------------------------------------
-- Postconditions.
-- --------------------------------------------------------------------------

do $postconditions$
begin
  if exists (
    select 1
    from public.state_transition_log log_row
    join public.conversations conversation_row
      on conversation_row.id = log_row.conversation_id
    join public.leads lead_row
      on lead_row.id = conversation_row.lead_id
    join public.stores store_row
      on store_row.id = lead_row.store_id
     and store_row.organization_id = lead_row.organization_id
    where log_row.organization_id is distinct from lead_row.organization_id
       or log_row.store_id is distinct from lead_row.store_id
       or conversation_row.organization_id is distinct from lead_row.organization_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: state_transition_log still contains tenant divergence';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_indexes index_row
    where index_row.schemaname = 'public'
      and index_row.tablename = 'state_transition_log'
      and index_row.indexname = 'state_transition_log_event_key_uidx'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: state_transition_log_event_key_uidx is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.state_transition_log_archive'::pg_catalog.regclass
      and constraint_row.contype = 'p'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: state_transition_log_archive primary key is missing';
  end if;

  if exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'state_transition_log_archive'
      and column_row.column_name in (
        'id',
        'organization_id',
        'store_id',
        'conversation_id',
        'to_state',
        'actor_type',
        'metadata',
        'created_at',
        'event_key',
        'archived_at',
        'archive_reason'
      )
      and column_row.is_nullable <> 'NO'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: state_transition_log_archive still exposes nullable mandatory audit columns';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_proc procedure_row
      on procedure_row.oid = trigger_row.tgfoid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = procedure_row.pronamespace
    where trigger_row.tgrelid = 'public.state_transition_log_archive'::pg_catalog.regclass
      and not trigger_row.tgisinternal
      and trigger_row.tgname = 'state_transition_log_archive_prevent_mutation'
      and trigger_row.tgenabled = 'O'
      and trigger_row.tgtype = 19
      and namespace_row.nspname = 'public'
      and procedure_row.proname = 'prevent_state_transition_log_archive_mutation'
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: state_transition_log_archive immutability trigger is missing or invalid';
  end if;

  if pg_catalog.has_table_privilege('service_role', 'public.state_transition_log_archive', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.state_transition_log_archive', 'UPDATE')
     or pg_catalog.has_table_privilege('service_role', 'public.state_transition_log_archive', 'DELETE')
     or pg_catalog.has_table_privilege('service_role', 'public.state_transition_log_archive', 'TRUNCATE')
     or pg_catalog.has_table_privilege('authenticated', 'public.state_transition_log_archive', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.state_transition_log_archive', 'UPDATE')
     or pg_catalog.has_table_privilege('authenticated', 'public.state_transition_log_archive', 'DELETE')
     or pg_catalog.has_table_privilege('authenticated', 'public.state_transition_log_archive', 'TRUNCATE')
     or pg_catalog.has_table_privilege('anon', 'public.state_transition_log_archive', 'INSERT')
     or pg_catalog.has_table_privilege('anon', 'public.state_transition_log_archive', 'UPDATE')
     or pg_catalog.has_table_privilege('anon', 'public.state_transition_log_archive', 'DELETE')
     or pg_catalog.has_table_privilege('anon', 'public.state_transition_log_archive', 'TRUNCATE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: state_transition_log_archive direct DML grants are still exposed';
  end if;

  if exists (
       select 1
       from pg_catalog.pg_proc procedure_row
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           procedure_row.proacl,
           pg_catalog.acldefault('f', procedure_row.proowner)
         )
       ) privilege_row
       where procedure_row.oid in (
         'public.process_sla_violations()'::pg_catalog.regprocedure,
         'public.process_stale_human_conversations()'::pg_catalog.regprocedure,
         'public.archive_state_transition_log(interval)'::pg_catalog.regprocedure
       )
         and privilege_row.grantee = 0
         and privilege_row.privilege_type = 'EXECUTE'
     )
     or has_function_privilege('anon', 'public.process_sla_violations()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.process_sla_violations()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.process_sla_violations()', 'EXECUTE')
     or has_function_privilege('anon', 'public.process_stale_human_conversations()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.process_stale_human_conversations()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.process_stale_human_conversations()', 'EXECUTE')
     or has_function_privilege('anon', 'public.archive_state_transition_log(interval)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.archive_state_transition_log(interval)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.archive_state_transition_log(interval)', 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: SLA/archive function grants are incorrect';
  end if;

  if pg_catalog.strpos(
       pg_catalog.lower(pg_catalog.pg_get_functiondef('public.process_sla_violations()'::pg_catalog.regprocedure)),
       'sla_violation'
     ) = 0
     or pg_catalog.strpos(
          pg_catalog.lower(pg_catalog.pg_get_functiondef('public.process_sla_violations()'::pg_catalog.regprocedure)),
          '_conversation_transition_sla_event_key'
        ) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: process_sla_violations does not enforce the canonical SLA idempotency contract';
  end if;

  if pg_catalog.strpos(
       pg_catalog.lower(pg_catalog.pg_get_functiondef('public.process_stale_human_conversations()'::pg_catalog.regprocedure)),
       '10 minutes'
     ) = 0
     or pg_catalog.strpos(
          pg_catalog.lower(pg_catalog.pg_get_functiondef('public.process_stale_human_conversations()'::pg_catalog.regprocedure)),
          'auto_timeout_human'
        ) = 0
     or pg_catalog.strpos(
          pg_catalog.lower(pg_catalog.pg_get_functiondef('public.process_stale_human_conversations()'::pg_catalog.regprocedure)),
          'human_timeout_auto_release'
        ) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: process_stale_human_conversations does not preserve the approved timeout contract';
  end if;

  if exists (
       select 1
       from pg_catalog.pg_proc procedure_row
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           procedure_row.proacl,
           pg_catalog.acldefault('f', procedure_row.proowner)
         )
       ) privilege_row
       where procedure_row.oid =
             'public.panel_transition_conversation_state_scoped(uuid,uuid,text,text)'::pg_catalog.regprocedure
         and privilege_row.grantee = 0
         and privilege_row.privilege_type = 'EXECUTE'
     )
     or has_function_privilege('anon', 'public.panel_transition_conversation_state_scoped(uuid,uuid,text,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.panel_transition_conversation_state_scoped(uuid,uuid,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.panel_transition_conversation_state_scoped(uuid,uuid,text,text)', 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: panel_transition_conversation_state_scoped grants are incorrect';
  end if;

  if exists (
       select 1
       from pg_catalog.pg_proc procedure_row
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           procedure_row.proacl,
           pg_catalog.acldefault('f', procedure_row.proowner)
         )
       ) privilege_row
       where procedure_row.oid =
             'public.panel_takeover_conversation_scoped(uuid,uuid,text)'::pg_catalog.regprocedure
         and privilege_row.grantee = 0
         and privilege_row.privilege_type = 'EXECUTE'
     )
     or has_function_privilege('anon', 'public.panel_takeover_conversation_scoped(uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.panel_takeover_conversation_scoped(uuid,uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.panel_takeover_conversation_scoped(uuid,uuid,text)', 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: panel_takeover_conversation_scoped grants are incorrect';
  end if;

  if exists (
       select 1
       from pg_catalog.pg_proc procedure_row
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           procedure_row.proacl,
           pg_catalog.acldefault('f', procedure_row.proowner)
         )
       ) privilege_row
       where procedure_row.oid =
             'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text)'::pg_catalog.regprocedure
         and privilege_row.grantee = 0
         and privilege_row.privilege_type = 'EXECUTE'
     )
     or has_function_privilege('anon', 'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text)', 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: panel_release_conversation_to_ai_scoped grants are incorrect';
  end if;

  if exists (
       select 1
       from pg_catalog.pg_proc procedure_row
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           procedure_row.proacl,
           pg_catalog.acldefault('f', procedure_row.proowner)
         )
       ) privilege_row
       where procedure_row.oid =
             'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'::pg_catalog.regprocedure
         and privilege_row.grantee = 0
         and privilege_row.privilege_type = 'EXECUTE'
     )
     or has_function_privilege('anon', 'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)', 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: panel_release_conversation_to_ai_scoped 4-arg grants are incorrect';
  end if;

  if exists (
       select 1
       from pg_catalog.pg_proc procedure_row
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           procedure_row.proacl,
           pg_catalog.acldefault('f', procedure_row.proowner)
         )
       ) privilege_row
       where procedure_row.oid in (
         'public.human_takeover_conversation(uuid,text)'::pg_catalog.regprocedure,
         'public.human_release_conversation_to_ai(uuid,text,text)'::pg_catalog.regprocedure,
         'public.panel_get_conversation_state_history_scoped(uuid,uuid)'::pg_catalog.regprocedure
       )
         and privilege_row.grantee = 0
         and privilege_row.privilege_type = 'EXECUTE'
     )
     or has_function_privilege('anon', 'public.human_takeover_conversation(uuid,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.human_takeover_conversation(uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.human_takeover_conversation(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.human_release_conversation_to_ai(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.human_release_conversation_to_ai(uuid,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.human_release_conversation_to_ai(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.panel_get_conversation_state_history_scoped(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.panel_get_conversation_state_history_scoped(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.panel_get_conversation_state_history_scoped(uuid,uuid)', 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: authenticated human/history function grants are incorrect';
  end if;

  if exists (
       select 1
       from pg_catalog.pg_proc procedure_row
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           procedure_row.proacl,
           pg_catalog.acldefault('f', procedure_row.proowner)
         )
       ) privilege_row
       where procedure_row.oid in (
         'public.transition_conversation_state(uuid,text,text)'::pg_catalog.regprocedure,
         'public.transition_conversation_state_internal(uuid,text,text,text,text,text,jsonb)'::pg_catalog.regprocedure,
         'public.update_conversation_state(uuid,text)'::pg_catalog.regprocedure,
         'public.update_conversation_state(uuid,text,text)'::pg_catalog.regprocedure,
         'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)'::pg_catalog.regprocedure
       )
         and privilege_row.grantee = 0
         and privilege_row.privilege_type = 'EXECUTE'
     )
     or has_function_privilege('anon', 'public.transition_conversation_state(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.transition_conversation_state(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.transition_conversation_state_internal(uuid,text,text,text,text,text,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.transition_conversation_state_internal(uuid,text,text,text,text,text,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.update_conversation_state(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.update_conversation_state(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.update_conversation_state(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.update_conversation_state(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.transition_conversation_state(uuid,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.transition_conversation_state_internal(uuid,text,text,text,text,text,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.update_conversation_state(uuid,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.update_conversation_state(uuid,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)', 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: internal transition function grants are incorrect';
  end if;
end;
$postconditions$;

commit;
