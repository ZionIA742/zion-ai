begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public;

do $preflight$
begin
  if to_regclass('public.conversation_sessions') is null
     or to_regclass('public.commercial_session_context_links') is null
     or to_regclass('public.commercial_opportunities') is null
     or to_regclass('public.messages') is null
     or to_regclass('public.leads') is null then
    raise exception using
      errcode = 'P0001',
      message = 'commercial_conversation_fact_events prerequisites are missing';
  end if;

  if to_regclass('public.commercial_conversation_fact_events') is not null
     or to_regprocedure('public.prevent_commercial_conversation_fact_event_mutation()') is not null
     or to_regprocedure('public.write_commercial_conversation_fact_event_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid,text,text,text,text,uuid)') is not null
     or to_regprocedure('public.read_commercial_conversation_fact_events_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid)') is not null then
    raise exception using
      errcode = 'P0001',
      message = 'commercial_conversation_fact_events foundation collision detected';
  end if;
end;
$preflight$;

create table public.commercial_conversation_fact_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  conversation_id uuid not null,
  lead_id uuid not null,
  conversation_session_id uuid not null,
  commercial_session_context_link_id uuid null,
  commercial_opportunity_id uuid null,

  fact_key text not null,
  value_json jsonb not null,
  operation_key text not null,
  event_kind text not null default 'assertion',
  supersedes_event_id uuid null,

  source_message_id uuid not null,
  source_media_type text not null,
  actor_type text not null,
  evidence_level text not null,
  created_at timestamptz not null default now(),

  constraint commercial_conversation_fact_events_scope_fkey
    foreign key (conversation_id, organization_id)
    references public.conversations(id, organization_id)
    on delete restrict,

  constraint commercial_conversation_fact_events_lead_scope_fkey
    foreign key (lead_id, organization_id, store_id)
    references public.leads(id, organization_id, store_id)
    on delete restrict,

  constraint commercial_conversation_fact_events_session_scope_fkey
    foreign key (conversation_session_id, organization_id, store_id, conversation_id)
    references public.conversation_sessions(id, organization_id, store_id, conversation_id)
    on delete restrict,

  constraint commercial_conversation_fact_events_context_scope_fkey
    foreign key (commercial_session_context_link_id, organization_id, store_id, conversation_session_id)
    references public.commercial_session_context_links(id, organization_id, store_id, conversation_session_id)
    on delete restrict,

  constraint commercial_conversation_fact_events_opportunity_scope_fkey
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,

  constraint commercial_conversation_fact_events_source_message_fkey
    foreign key (source_message_id)
    references public.messages(id)
    on delete restrict,

  constraint commercial_conversation_fact_events_supersedes_fkey
    foreign key (supersedes_event_id)
    references public.commercial_conversation_fact_events(id)
    on delete restrict,

  constraint commercial_conversation_fact_events_fact_key_check
    check (fact_key = btrim(fact_key) and length(fact_key) between 1 and 120),

  constraint commercial_conversation_fact_events_operation_key_check
    check (operation_key = btrim(operation_key) and length(operation_key) between 1 and 240),

  constraint commercial_conversation_fact_events_value_check
    check (value_json is not null and value_json <> 'null'::jsonb),

  constraint commercial_conversation_fact_events_event_kind_check
    check (event_kind in ('assertion', 'correction', 'conflict_resolution')),

  constraint commercial_conversation_fact_events_media_check
    check (source_media_type in ('text', 'audio', 'image', 'video', 'document')),

  constraint commercial_conversation_fact_events_actor_check
    check (actor_type in ('customer', 'human', 'assistant', 'system')),

  constraint commercial_conversation_fact_events_evidence_check
    check (evidence_level in ('declared', 'confirmed', 'inferred', 'conflict')),

  constraint commercial_conversation_fact_events_context_opportunity_check
    check (commercial_session_context_link_id is null or commercial_opportunity_id is not null)
);

create unique index commercial_conversation_fact_events_operation_uidx
  on public.commercial_conversation_fact_events (organization_id, store_id, operation_key);

create index commercial_conversation_fact_events_scope_idx
  on public.commercial_conversation_fact_events (
    organization_id,
    store_id,
    conversation_id,
    lead_id,
    conversation_session_id,
    created_at,
    id
  );

create index commercial_conversation_fact_events_fact_idx
  on public.commercial_conversation_fact_events (
    organization_id,
    store_id,
    conversation_session_id,
    fact_key,
    created_at,
    id
  );

create index commercial_conversation_fact_events_source_idx
  on public.commercial_conversation_fact_events (
    organization_id,
    store_id,
    source_message_id
  );

alter table public.commercial_conversation_fact_events owner to postgres;

create or replace function public.prevent_commercial_conversation_fact_event_mutation()
returns trigger
language plpgsql
as $function$
begin
  raise exception using
    errcode = 'P0001',
    message = 'commercial conversation fact events are append-only';
end;
$function$;

create trigger commercial_conversation_fact_events_append_only_trg
before update or delete on public.commercial_conversation_fact_events
for each row execute function public.prevent_commercial_conversation_fact_event_mutation();

create or replace function public.write_commercial_conversation_fact_event_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid,
  p_conversation_session_id uuid,
  p_commercial_session_context_link_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text,
  p_fact_key text,
  p_value_json jsonb,
  p_source_message_id uuid,
  p_source_media_type text,
  p_actor_type text,
  p_evidence_level text,
  p_event_kind text default 'assertion',
  p_supersedes_event_id uuid default null
)
returns table (
  event_id uuid,
  outcome text,
  operation_key text,
  fact_key text,
  conflict_group_key text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_operation_key text := nullif(btrim(coalesce(p_operation_key, '')), '');
  v_fact_key text := nullif(btrim(coalesce(p_fact_key, '')), '');
  v_media_type text := lower(nullif(btrim(coalesce(p_source_media_type, '')), ''));
  v_actor_type text := lower(nullif(btrim(coalesce(p_actor_type, '')), ''));
  v_evidence_level text := lower(nullif(btrim(coalesce(p_evidence_level, '')), ''));
  v_event_kind text := lower(nullif(btrim(coalesce(p_event_kind, 'assertion')), ''));
  v_existing public.commercial_conversation_fact_events%rowtype;
  v_message public.messages%rowtype;
  v_conversation_lead_id uuid;
  v_lead_store_id uuid;
  v_context_opportunity_id uuid;
  v_opportunity_origin_lead_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if (v_request_role is distinct from 'service_role') and session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'commercial conversation fact writer is server-only';
  end if;

  if p_organization_id is null or p_store_id is null or p_conversation_id is null
     or p_lead_id is null or p_conversation_session_id is null
     or p_source_message_id is null or p_value_json is null
     or v_operation_key is null or v_fact_key is null then
    raise exception using errcode = '23514', message = 'commercial conversation fact scope or provenance is incomplete';
  end if;

  if v_media_type not in ('text', 'audio', 'image', 'video', 'document')
     or v_actor_type not in ('customer', 'human', 'assistant', 'system')
     or v_evidence_level not in ('declared', 'confirmed', 'inferred', 'conflict')
     or v_event_kind not in ('assertion', 'correction', 'conflict_resolution')
     or p_value_json = 'null'::jsonb then
    raise exception using errcode = '23514', message = 'commercial conversation fact payload is invalid';
  end if;

  select c.lead_id, l.store_id
    into v_conversation_lead_id, v_lead_store_id
  from public.conversations c
  join public.leads l on l.id = c.lead_id
                       and l.organization_id = c.organization_id
  where c.id = p_conversation_id
    and c.organization_id = p_organization_id;

  if not found or v_conversation_lead_id is distinct from p_lead_id
     or v_lead_store_id is distinct from p_store_id then
    raise exception using errcode = '42501', message = 'commercial conversation fact conversation lead scope mismatch';
  end if;

  if not exists (
    select 1
    from public.conversation_sessions s
    where s.id = p_conversation_session_id
      and s.organization_id = p_organization_id
      and s.store_id = p_store_id
      and s.conversation_id = p_conversation_id
  ) then
    raise exception using errcode = '42501', message = 'commercial conversation fact session scope mismatch';
  end if;

  select m.* into v_message
  from public.messages m
  where m.id = p_source_message_id
    and m.organization_id = p_organization_id
    and m.store_id = p_store_id
    and m.conversation_id = p_conversation_id
    and m.lead_id = p_lead_id;

  if not found then
    raise exception using errcode = '42501', message = 'commercial conversation fact source message scope mismatch';
  end if;

  if v_media_type is distinct from lower(v_message.message_type) then
    raise exception using errcode = '23514', message = 'commercial conversation fact media type mismatch';
  end if;

  if (v_actor_type = 'customer' and (v_message.sender <> 'user' or v_message.direction <> 'incoming'))
     or (v_actor_type = 'human' and v_message.sender <> 'human')
     or (v_actor_type = 'assistant' and v_message.sender <> 'ai') then
    raise exception using errcode = '23514', message = 'commercial conversation fact actor provenance mismatch';
  end if;

  if p_commercial_session_context_link_id is not null then
    select l.commercial_opportunity_id
      into v_context_opportunity_id
    from public.commercial_session_context_links l
    where l.id = p_commercial_session_context_link_id
      and l.organization_id = p_organization_id
      and l.store_id = p_store_id
      and l.conversation_session_id = p_conversation_session_id
      and l.status = 'active';
    if not found then
      raise exception using errcode = '42501', message = 'commercial conversation fact context link scope mismatch';
    end if;
  end if;

  if p_commercial_opportunity_id is not null then
    select o.origin_lead_id
      into v_opportunity_origin_lead_id
    from public.commercial_opportunities o
    where o.id = p_commercial_opportunity_id
      and o.organization_id = p_organization_id
      and o.store_id = p_store_id;
    if not found or v_opportunity_origin_lead_id is distinct from p_lead_id then
      raise exception using errcode = '42501', message = 'commercial conversation fact opportunity lead scope mismatch';
    end if;
    if v_context_opportunity_id is distinct from p_commercial_opportunity_id
       and p_commercial_session_context_link_id is not null then
      raise exception using errcode = '42501', message = 'commercial conversation fact opportunity context mismatch';
    end if;
  elsif p_commercial_session_context_link_id is not null then
    raise exception using errcode = '23514', message = 'commercial conversation fact context requires opportunity';
  end if;

  if p_supersedes_event_id is not null and not exists (
    select 1
    from public.commercial_conversation_fact_events e
    where e.id = p_supersedes_event_id
      and e.organization_id = p_organization_id
      and e.store_id = p_store_id
      and e.conversation_id = p_conversation_id
      and e.lead_id = p_lead_id
      and e.conversation_session_id = p_conversation_session_id
      and e.fact_key = v_fact_key
      and (
        (
          e.commercial_opportunity_id is not distinct from p_commercial_opportunity_id
          and e.commercial_session_context_link_id is not distinct from p_commercial_session_context_link_id
        )
        or (
          e.commercial_opportunity_id is null
          and e.commercial_session_context_link_id is null
          and p_commercial_opportunity_id is not null
          and p_commercial_session_context_link_id is not null
          and v_context_opportunity_id is not distinct from p_commercial_opportunity_id
        )
      )
  ) then
    raise exception using errcode = '42501', message = 'commercial conversation fact superseded event scope mismatch';
  end if;

  select * into v_existing
  from public.commercial_conversation_fact_events e
  where e.organization_id = p_organization_id
    and e.store_id = p_store_id
    and e.operation_key = v_operation_key
  for update;

  if found then
    if v_existing.conversation_id is distinct from p_conversation_id
       or v_existing.lead_id is distinct from p_lead_id
       or v_existing.conversation_session_id is distinct from p_conversation_session_id
       or v_existing.commercial_session_context_link_id is distinct from p_commercial_session_context_link_id
       or v_existing.commercial_opportunity_id is distinct from p_commercial_opportunity_id
       or v_existing.fact_key is distinct from v_fact_key
       or v_existing.value_json is distinct from p_value_json
       or v_existing.source_message_id is distinct from p_source_message_id
       or v_existing.source_media_type is distinct from v_media_type
       or v_existing.actor_type is distinct from v_actor_type
       or v_existing.evidence_level is distinct from v_evidence_level
       or v_existing.event_kind is distinct from v_event_kind
       or v_existing.supersedes_event_id is distinct from p_supersedes_event_id then
      raise exception using errcode = '23505', message = 'commercial conversation fact operation key collision';
    end if;
    return query select v_existing.id, 'replayed'::text, v_existing.operation_key,
      v_existing.fact_key, v_existing.fact_key, v_existing.created_at;
    return;
  end if;

  insert into public.commercial_conversation_fact_events as inserted (
    organization_id, store_id, conversation_id, lead_id, conversation_session_id,
    commercial_session_context_link_id, commercial_opportunity_id, fact_key,
    value_json, operation_key, event_kind, supersedes_event_id, source_message_id,
    source_media_type, actor_type, evidence_level, created_at
  ) values (
    p_organization_id, p_store_id, p_conversation_id, p_lead_id, p_conversation_session_id,
    p_commercial_session_context_link_id, p_commercial_opportunity_id, v_fact_key,
    p_value_json, v_operation_key, v_event_kind, p_supersedes_event_id, p_source_message_id,
    v_media_type, v_actor_type, v_evidence_level, v_now
  ) returning inserted.id, inserted.created_at
    into event_id, created_at;

  operation_key := v_operation_key;
  fact_key := v_fact_key;
  conflict_group_key := v_fact_key;
  outcome := 'created';

  return next;
end;
$function$;

create or replace function public.read_commercial_conversation_fact_events_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid,
  p_conversation_session_id uuid,
  p_commercial_session_context_link_id uuid default null,
  p_commercial_opportunity_id uuid default null
)
returns table (
  event_id uuid,
  organization_id uuid,
  store_id uuid,
  conversation_id uuid,
  lead_id uuid,
  conversation_session_id uuid,
  commercial_session_context_link_id uuid,
  commercial_opportunity_id uuid,
  fact_key text,
  value_json jsonb,
  operation_key text,
  event_kind text,
  supersedes_event_id uuid,
  source_message_id uuid,
  source_media_type text,
  actor_type text,
  evidence_level text,
  created_at timestamptz,
  conflict_state text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_context_opportunity_id uuid;
  v_opportunity_origin_lead_id uuid;
begin
  if (v_request_role is distinct from 'service_role') and session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'commercial conversation fact reader is server-only';
  end if;

  if not exists (
    select 1 from public.conversations c
    join public.leads l on l.id = c.lead_id and l.organization_id = c.organization_id
    where c.id = p_conversation_id and c.organization_id = p_organization_id
      and c.lead_id = p_lead_id and l.store_id = p_store_id
  ) or not exists (
    select 1 from public.conversation_sessions s
    where s.id = p_conversation_session_id and s.organization_id = p_organization_id
      and s.store_id = p_store_id and s.conversation_id = p_conversation_id
  ) then
    raise exception using errcode = '42501', message = 'commercial conversation fact reader scope mismatch';
  end if;

  if p_commercial_session_context_link_id is not null then
    select l.commercial_opportunity_id
      into v_context_opportunity_id
    from public.commercial_session_context_links l
    where l.id = p_commercial_session_context_link_id
      and l.organization_id = p_organization_id
      and l.store_id = p_store_id
      and l.conversation_session_id = p_conversation_session_id;
    if not found
       or p_commercial_opportunity_id is null
       or v_context_opportunity_id is distinct from p_commercial_opportunity_id then
      raise exception using errcode = '42501', message = 'commercial conversation fact reader context mismatch';
    end if;
  end if;

  if p_commercial_opportunity_id is not null then
    select o.origin_lead_id
      into v_opportunity_origin_lead_id
    from public.commercial_opportunities o
    where o.id = p_commercial_opportunity_id
      and o.organization_id = p_organization_id
      and o.store_id = p_store_id;
    if not found or v_opportunity_origin_lead_id is distinct from p_lead_id then
      raise exception using errcode = '42501', message = 'commercial conversation fact reader opportunity mismatch';
    end if;
  end if;

  return query
  with scoped_events as (
    select e.*
    from public.commercial_conversation_fact_events e
    where e.organization_id = p_organization_id
      and e.store_id = p_store_id
      and e.conversation_id = p_conversation_id
      and e.lead_id = p_lead_id
      and e.conversation_session_id = p_conversation_session_id
      and (p_commercial_session_context_link_id is null
           or e.commercial_session_context_link_id = p_commercial_session_context_link_id)
      and (
        (p_commercial_opportunity_id is null and e.commercial_opportunity_id is null)
        or (
          p_commercial_opportunity_id is not null
          and (e.commercial_opportunity_id is null or e.commercial_opportunity_id = p_commercial_opportunity_id)
        )
      )
  ), distinct_values as (
    select distinct se.fact_key, se.commercial_opportunity_id, se.value_json
    from scoped_events se
  ), value_counts as (
    select dv.fact_key, dv.commercial_opportunity_id, count(*) as distinct_value_count
    from distinct_values dv
    group by dv.fact_key, dv.commercial_opportunity_id
  )
  select e.id, e.organization_id, e.store_id, e.conversation_id, e.lead_id,
    e.conversation_session_id, e.commercial_session_context_link_id,
    e.commercial_opportunity_id, e.fact_key, e.value_json, e.operation_key,
    e.event_kind, e.supersedes_event_id, e.source_message_id, e.source_media_type,
    e.actor_type, e.evidence_level, e.created_at,
    case when vc.distinct_value_count > 1 then 'conflict' else 'consistent' end::text
  from scoped_events e
  join value_counts vc
    on vc.fact_key = e.fact_key
   and vc.commercial_opportunity_id is not distinct from e.commercial_opportunity_id
  order by e.created_at, e.id;
end;
$function$;

alter function public.prevent_commercial_conversation_fact_event_mutation() owner to postgres;
alter function public.write_commercial_conversation_fact_event_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb, uuid, text, text, text, text, uuid
) owner to postgres;
alter function public.read_commercial_conversation_fact_events_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid
) owner to postgres;

revoke all on table public.commercial_conversation_fact_events from public, anon, authenticated, service_role;
revoke all on function public.prevent_commercial_conversation_fact_event_mutation() from public, anon, authenticated, service_role;
revoke all on function public.write_commercial_conversation_fact_event_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb, uuid, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.read_commercial_conversation_fact_events_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.write_commercial_conversation_fact_event_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb, uuid, text, text, text, text, uuid
) to service_role;
grant execute on function public.read_commercial_conversation_fact_events_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid
) to service_role;

alter table public.commercial_conversation_fact_events enable row level security;
alter table public.commercial_conversation_fact_events force row level security;

comment on table public.commercial_conversation_fact_events is
  'Append-only structured commercial evidence scoped to organization, store, conversation, lead and commercial session. It never replaces opportunity canonical facts.';

commit;
