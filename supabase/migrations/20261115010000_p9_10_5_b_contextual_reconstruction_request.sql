-- ZION / Pilar 9 / 10.5-B
-- Solicitação durável de reconstrução contextual após release humano.
-- Esta fila é deliberadamente separada de ai_run_queue: ela não é consumida
-- por geração, sender, WhatsApp ou cron nesta microetapa.

begin;

create table if not exists public.p9_contextual_reconstruction_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  takeover_event_key text not null,
  release_event_key text not null,
  takeover_started_at timestamptz not null,
  released_at timestamptz not null,
  takeover_version text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  claim_token uuid,
  claim_expires_at timestamptz,
  claimed_by text,
  processing_error text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  constraint p9_contextual_reconstruction_requests_status_chk
    check (status in ('pending', 'claimed', 'completed', 'retryable', 'failed_final', 'obsolete')),
  constraint p9_contextual_reconstruction_requests_attempt_chk
    check (attempt_count >= 0 and attempt_count <= 3),
  constraint p9_contextual_reconstruction_requests_claim_chk
    check (
      (status = 'claimed' and claim_token is not null and claim_expires_at is not null and claimed_by is not null)
      or (status <> 'claimed')
    ),
  constraint p9_contextual_reconstruction_requests_scope_version_uidx
    unique (organization_id, store_id, conversation_id, takeover_version)
);

create index if not exists p9_contextual_reconstruction_requests_pending_idx
  on public.p9_contextual_reconstruction_requests (status, created_at, id)
  where status in ('pending', 'retryable', 'claimed');

create or replace function public.p9_10_5_b_enqueue_contextual_reconstruction_request(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_release_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_conversation public.conversations%rowtype;
  v_lease public.conversation_human_takeover_leases%rowtype;
  v_takeover_event_key text;
  v_release_event_key text;
  v_version text;
  v_request_id uuid;
begin
  select conversation_row.*
    into v_conversation
    from public.conversations conversation_row
   where conversation_row.id = p_conversation_id
     and conversation_row.organization_id = p_organization_id
   for update;

  if not found then
    raise exception using errcode = '42501', message = 'P9_10_5_B_CONVERSATION_SCOPE_MISMATCH';
  end if;

  select lease_row.*
    into v_lease
    from public.conversation_human_takeover_leases lease_row
   where lease_row.conversation_id = p_conversation_id
   for update;

  if not found
     or v_lease.organization_id is distinct from p_organization_id
     or v_lease.store_id is distinct from p_store_id
     or v_lease.released_at is null
     or v_lease.hard_hold is true then
    return null;
  end if;

  v_version := v_lease.takeover_started_at::text;

  select coalesce(nullif(pg_catalog.btrim(log_row.event_key), ''), 'takeover:' || v_version)
    into v_takeover_event_key
    from public.state_transition_log log_row
   where log_row.conversation_id = p_conversation_id
     and log_row.to_state = 'humano_assumiu'
     and log_row.created_at <= v_lease.released_at
   order by log_row.created_at desc, log_row.id desc
   limit 1;

  v_takeover_event_key := coalesce(v_takeover_event_key, 'takeover:' || v_version);

  select coalesce(nullif(pg_catalog.btrim(log_row.event_key), ''), 'release:' || v_version)
    into v_release_event_key
    from public.state_transition_log log_row
   where log_row.conversation_id = p_conversation_id
     and log_row.to_state <> 'humano_assumiu'
     and log_row.created_at <= v_lease.released_at
   order by log_row.created_at desc, log_row.id desc
   limit 1;

  v_release_event_key := coalesce(v_release_event_key, 'release:' || v_version);

  insert into public.p9_contextual_reconstruction_requests (
    organization_id,
    store_id,
    conversation_id,
    takeover_event_key,
    release_event_key,
    takeover_started_at,
    released_at,
    takeover_version,
    processing_error
  ) values (
    p_organization_id,
    p_store_id,
    p_conversation_id,
    v_takeover_event_key,
    v_release_event_key,
    v_lease.takeover_started_at,
    v_lease.released_at,
    v_version,
    nullif(pg_catalog.btrim(coalesce(p_release_reason, '')), '')
  )
  on conflict (organization_id, store_id, conversation_id, takeover_version)
  do update set updated_at = pg_catalog.clock_timestamp()
  returning id into v_request_id;

  return v_request_id;
end;
$function$;

create or replace function public.claim_p9_contextual_reconstruction_requests_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_limit integer,
  p_claimed_by text,
  p_lease_seconds integer,
  p_max_attempts integer default 3
)
returns table (
  id uuid,
  organization_id uuid,
  store_id uuid,
  conversation_id uuid,
  takeover_event_key text,
  release_event_key text,
  takeover_started_at timestamptz,
  released_at timestamptz,
  takeover_version text,
  claim_token uuid,
  claim_expires_at timestamptz,
  attempt_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request record;
  v_conversation public.conversations%rowtype;
  v_lease public.conversation_human_takeover_leases%rowtype;
  v_token uuid;
  v_expiry timestamptz;
begin
  if auth.role() is distinct from 'service_role'
     or p_organization_id is null
     or p_store_id is null
     or p_limit is null or p_limit < 1 or p_limit > 100
     or p_claimed_by is null or pg_catalog.btrim(p_claimed_by) = ''
     or pg_catalog.length(p_claimed_by) > 200
     or p_lease_seconds is null or p_lease_seconds < 60 or p_lease_seconds > 3600
     or p_max_attempts is distinct from 3 then
    raise exception using errcode = '42501', message = 'P9_10_5_B_INVALID_CLAIM_ARGUMENTS';
  end if;

  update public.p9_contextual_reconstruction_requests
     set status = case when attempt_count >= p_max_attempts then 'failed_final' else 'retryable' end,
         claim_token = null,
         claim_expires_at = null,
         claimed_by = null,
         processing_error = case when attempt_count >= p_max_attempts then 'P9_10_5_B_CLAIM_EXPIRED_MAX_ATTEMPTS' else processing_error end,
         updated_at = pg_catalog.clock_timestamp()
   where status = 'claimed'
     and claim_expires_at <= pg_catalog.clock_timestamp();

  for v_request in
    select request_row.*
      from public.p9_contextual_reconstruction_requests request_row
     where request_row.organization_id = p_organization_id
       and request_row.store_id = p_store_id
       and request_row.status in ('pending', 'retryable')
       and request_row.attempt_count < p_max_attempts
     order by request_row.created_at, request_row.id
     limit p_limit
     for update skip locked
  loop
    select conversation_row.* into v_conversation
      from public.conversations conversation_row
     where conversation_row.id = v_request.conversation_id
       and conversation_row.organization_id = p_organization_id
     for update;

    select lease_row.* into v_lease
      from public.conversation_human_takeover_leases lease_row
     where lease_row.conversation_id = v_request.conversation_id
     for update;

    if not found
       or v_lease.organization_id is distinct from p_organization_id
       or v_lease.store_id is distinct from p_store_id
       or v_lease.takeover_started_at::text is distinct from v_request.takeover_version
       or v_lease.released_at is null
       or v_lease.hard_hold is true
       or v_conversation.status = 'humano_assumiu'
       or coalesce(v_conversation.is_human_active, false) then
      update public.p9_contextual_reconstruction_requests
         set status = 'obsolete',
             processing_error = 'P9_10_5_B_CONTEXT_NO_LONGER_CURRENT',
             claim_token = null,
             claim_expires_at = null,
             claimed_by = null,
             updated_at = pg_catalog.clock_timestamp()
       where id = v_request.id;
      continue;
    end if;

    v_token := pg_catalog.gen_random_uuid();
    v_expiry := pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds);

    update public.p9_contextual_reconstruction_requests
       set status = 'claimed',
           claim_token = v_token,
           claim_expires_at = v_expiry,
           claimed_by = p_claimed_by,
           attempt_count = attempt_count + 1,
           updated_at = pg_catalog.clock_timestamp()
     where id = v_request.id;

    id := v_request.id;
    organization_id := v_request.organization_id;
    store_id := v_request.store_id;
    conversation_id := v_request.conversation_id;
    takeover_event_key := v_request.takeover_event_key;
    release_event_key := v_request.release_event_key;
    takeover_started_at := v_request.takeover_started_at;
    released_at := v_request.released_at;
    takeover_version := v_request.takeover_version;
    claim_token := v_token;
    claim_expires_at := v_expiry;
    attempt_count := v_request.attempt_count + 1;
    return next;
  end loop;
end;
$function$;

create or replace function public.finalize_p9_contextual_reconstruction_request_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_error_text text default null,
  p_max_attempts integer default 3
)
returns table (ok boolean, id uuid, status text, attempt_count integer, terminal boolean)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
begin
  if auth.role() is distinct from 'service_role'
     or p_outcome not in ('completed', 'retryable', 'failed_final', 'obsolete')
     or p_max_attempts is distinct from 3 then
    raise exception using errcode = '42501', message = 'P9_10_5_B_INVALID_FINALIZATION_ARGUMENTS';
  end if;

  return query
  with changed as (
    update public.p9_contextual_reconstruction_requests request_row
       set status = case
         when p_outcome = 'completed' then 'completed'
         when p_outcome = 'obsolete' then 'obsolete'
         when p_outcome = 'failed_final' or request_row.attempt_count >= p_max_attempts then 'failed_final'
         else 'retryable'
       end,
       processing_error = case
         when p_outcome in ('completed', 'obsolete') then null
         when p_outcome = 'failed_final' or request_row.attempt_count >= p_max_attempts then 'P9_10_5_B_FAILED_FINAL:' || left(coalesce(nullif(pg_catalog.btrim(p_error_text), ''), 'unspecified'), 900)
         else 'P9_10_5_B_RETRYABLE:' || left(coalesce(nullif(pg_catalog.btrim(p_error_text), ''), 'unspecified'), 900)
       end,
       completed_at = case when p_outcome in ('completed', 'obsolete') or p_outcome = 'failed_final' or request_row.attempt_count >= p_max_attempts then pg_catalog.clock_timestamp() else null end,
       claim_token = null,
       claim_expires_at = null,
       claimed_by = null,
       updated_at = pg_catalog.clock_timestamp()
     where request_row.organization_id = p_organization_id
       and request_row.store_id = p_store_id
       and request_row.id = p_request_id
       and request_row.status = 'claimed'
       and request_row.claim_token = p_claim_token
       and request_row.claim_expires_at > pg_catalog.clock_timestamp()
     returning request_row.id, request_row.status, request_row.attempt_count
  )
  select true, changed.id, changed.status, changed.attempt_count,
         changed.status in ('completed', 'failed_final', 'obsolete')
    from changed;

  if not found then
    return query select false, p_request_id, 'not_claimed'::text, 0, true;
  end if;
end;
$function$;

-- Uma nova tomada humana cria uma nova versão. Repetições durante a mesma
-- tomada preservam a versão; após release, a próxima atividade inicia outra.
create or replace function public.record_human_takeover_activity_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_activity_key text default null,
  p_activity_at_text text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_conversation public.conversations%rowtype;
  v_activity_at timestamptz := pg_catalog.clock_timestamp();
  v_candidate timestamptz;
  v_inserted boolean := true;
begin
  select conversation_row.* into v_conversation
    from public.conversations conversation_row
    join public.leads lead_row on lead_row.id = conversation_row.lead_id and lead_row.organization_id = p_organization_id and lead_row.store_id = p_store_id
   where conversation_row.id = p_conversation_id and conversation_row.organization_id = p_organization_id
   for update of conversation_row;
  if not found then raise exception using errcode = '42501', message = 'human takeover conversation scope mismatch'; end if;
  if p_activity_at_text is not null and pg_catalog.btrim(p_activity_at_text) <> '' then
    begin
      v_candidate := p_activity_at_text::timestamptz;
      if v_candidate <= pg_catalog.clock_timestamp() then v_activity_at := v_candidate; end if;
    exception when others then null;
    end;
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_activity_key, '')), '') is not null then
    insert into public.conversation_human_takeover_activity_events (conversation_id, activity_key)
    values (p_conversation_id, pg_catalog.btrim(p_activity_key)) on conflict do nothing;
    v_inserted := found;
  end if;
  if not v_inserted then return; end if;
  insert into public.conversation_human_takeover_leases (conversation_id, organization_id, store_id, takeover_started_at, last_human_activity_at, notice_30_at, hard_hold, released_at, release_reason, updated_at)
  values (p_conversation_id, p_organization_id, p_store_id, v_activity_at, v_activity_at, null, false, null, null, pg_catalog.clock_timestamp())
  on conflict (conversation_id) do update set
    organization_id = excluded.organization_id,
    store_id = excluded.store_id,
    takeover_started_at = case when public.conversation_human_takeover_leases.released_at is not null then excluded.takeover_started_at else public.conversation_human_takeover_leases.takeover_started_at end,
    last_human_activity_at = case when public.conversation_human_takeover_leases.released_at is not null then excluded.last_human_activity_at else greatest(public.conversation_human_takeover_leases.last_human_activity_at, excluded.last_human_activity_at) end,
    notice_30_at = null,
    released_at = null,
    release_reason = null,
    updated_at = pg_catalog.clock_timestamp();
end;
$function$;

create or replace function public.ensure_human_takeover_lease_by_system(
  p_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_conversation public.conversations%rowtype;
  v_store_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select * into v_conversation from public.conversations where id = p_conversation_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'human takeover conversation not found'; end if;
  select lead_row.store_id into v_store_id from public.leads lead_row where lead_row.id = v_conversation.lead_id and lead_row.organization_id = v_conversation.organization_id;
  insert into public.conversation_human_takeover_leases (conversation_id, organization_id, store_id, takeover_started_at, last_human_activity_at, updated_at)
  values (p_conversation_id, v_conversation.organization_id, v_store_id, v_now, v_now, v_now)
  on conflict (conversation_id) do update set
    organization_id = excluded.organization_id,
    store_id = excluded.store_id,
    takeover_started_at = case when public.conversation_human_takeover_leases.released_at is not null then excluded.takeover_started_at else public.conversation_human_takeover_leases.takeover_started_at end,
    last_human_activity_at = case when public.conversation_human_takeover_leases.released_at is not null then excluded.last_human_activity_at else greatest(public.conversation_human_takeover_leases.last_human_activity_at, excluded.last_human_activity_at) end,
    released_at = null,
    release_reason = null,
    notice_30_at = null,
    updated_at = pg_catalog.clock_timestamp();
end;
$function$;

create or replace function public.release_human_takeover_lease_by_system(
  p_conversation_id uuid,
  p_reason text default 'human_release'
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_conversation public.conversations%rowtype;
  v_lease public.conversation_human_takeover_leases%rowtype;
begin
  select conversation_row.* into v_conversation from public.conversations conversation_row where conversation_row.id = p_conversation_id for update;
  if not found then return; end if;
  select lease_row.* into v_lease from public.conversation_human_takeover_leases lease_row where lease_row.conversation_id = p_conversation_id for update;
  if not found then return; end if;
  if v_lease.organization_id is distinct from v_conversation.organization_id or v_lease.hard_hold is true then
    raise exception using errcode = '42501', message = 'legacy takeover release cannot cross active hard hold or scope';
  end if;
  update public.conversation_human_takeover_leases
     set released_at = coalesce(released_at, pg_catalog.clock_timestamp()),
         release_reason = case when released_at is null then nullif(pg_catalog.btrim(coalesce(p_reason, '')), '') else release_reason end,
         updated_at = pg_catalog.clock_timestamp()
   where conversation_id = p_conversation_id and organization_id = v_conversation.organization_id;
  perform public.p9_10_5_b_enqueue_contextual_reconstruction_request(v_conversation.organization_id, v_lease.store_id, p_conversation_id, p_reason);
end;
$function$;

-- O caminho scoped do painel não usa o release helper legado; o trigger de
-- autoridade chama o enqueue na mesma transação, após a atualização da lease.
create or replace function public.panel_release_conversation_to_ai_scoped(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_to_state text default null,
  p_reason text default 'painel'
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  v_conversation public.conversations%rowtype;
  v_lease public.conversation_human_takeover_leases%rowtype;
  v_target_state text;
begin
  if v_user_id is null or v_request_role <> 'authenticated' then raise exception using errcode = '42501', message = 'conversation transition is not authorized'; end if;
  select conversation_row.* into v_conversation from public.conversations conversation_row join public.leads lead_row on lead_row.id = conversation_row.lead_id and lead_row.organization_id = p_organization_id where conversation_row.id = p_conversation_id and conversation_row.organization_id = p_organization_id for update of conversation_row;
  if not found then raise exception using errcode = '42501', message = 'conversation transition scope mismatch'; end if;
  select lease_row.* into v_lease from public.conversation_human_takeover_leases lease_row where lease_row.conversation_id = p_conversation_id for update;
  if not found or v_lease.organization_id is distinct from v_conversation.organization_id or v_lease.store_id is distinct from (select lead_row.store_id from public.leads lead_row where lead_row.id = v_conversation.lead_id and lead_row.organization_id = v_conversation.organization_id) or v_lease.hard_hold is true then raise exception using errcode = '42501', message = 'human takeover release scope or hard hold mismatch'; end if;
  v_target_state := coalesce(nullif(pg_catalog.btrim(coalesce(p_to_state, '')), ''), public.resolve_human_release_target_state(p_conversation_id));
  perform public.transition_conversation_state_by_user(p_conversation_id, v_target_state, v_user_id, p_reason, 'panel_release_conversation_to_ai_scoped', p_organization_id, null, null, '{}'::jsonb);
  update public.conversation_human_takeover_leases set released_at = coalesce(released_at, pg_catalog.clock_timestamp()), release_reason = case when released_at is null then nullif(pg_catalog.btrim(coalesce(p_reason, 'panel_release')), '') else release_reason end, updated_at = pg_catalog.clock_timestamp() where conversation_id = p_conversation_id and organization_id = p_organization_id and store_id = v_lease.store_id;
  perform public.p9_10_5_b_enqueue_contextual_reconstruction_request(p_organization_id, v_lease.store_id, p_conversation_id, p_reason);
end;
$function$;

alter function public.p9_10_5_b_enqueue_contextual_reconstruction_request(uuid,uuid,uuid,text) owner to postgres;
alter function public.claim_p9_contextual_reconstruction_requests_by_system(uuid,uuid,integer,text,integer,integer) owner to postgres;
alter function public.finalize_p9_contextual_reconstruction_request_by_system(uuid,uuid,uuid,uuid,text,text,integer) owner to postgres;
alter function public.record_human_takeover_activity_by_system(uuid,uuid,uuid,text,text) owner to postgres;
alter function public.ensure_human_takeover_lease_by_system(uuid) owner to postgres;
alter function public.release_human_takeover_lease_by_system(uuid,text) owner to postgres;
alter function public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text) owner to postgres;

alter table public.p9_contextual_reconstruction_requests enable row level security;
revoke all on table public.p9_contextual_reconstruction_requests from public, anon, authenticated, service_role;
grant all on table public.p9_contextual_reconstruction_requests to service_role;
revoke all on function public.p9_10_5_b_enqueue_contextual_reconstruction_request(uuid,uuid,uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.claim_p9_contextual_reconstruction_requests_by_system(uuid,uuid,integer,text,integer,integer) from public, anon, authenticated;
revoke all on function public.finalize_p9_contextual_reconstruction_request_by_system(uuid,uuid,uuid,uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.claim_p9_contextual_reconstruction_requests_by_system(uuid,uuid,integer,text,integer,integer) to service_role;
grant execute on function public.finalize_p9_contextual_reconstruction_request_by_system(uuid,uuid,uuid,uuid,text,text,integer) to service_role;

do $postconditions$
declare
  v_claim text := pg_catalog.pg_get_functiondef('public.claim_p9_contextual_reconstruction_requests_by_system(uuid,uuid,integer,text,integer,integer)'::regprocedure);
  v_release text := pg_catalog.pg_get_functiondef('public.release_human_takeover_lease_by_system(uuid,text)'::regprocedure);
begin
  if pg_catalog.to_regclass('public.p9_contextual_reconstruction_requests') is null
     or pg_catalog.strpos(v_claim, 'for update skip locked') = 0
     or pg_catalog.strpos(v_claim, 'hard_hold') = 0
     or pg_catalog.strpos(v_claim, 'humano_assumiu') = 0
     or pg_catalog.strpos(v_claim, 'P9_10_5_B_CONTEXT_NO_LONGER_CURRENT') = 0
     or pg_catalog.strpos(v_release, 'p9_10_5_b_enqueue_contextual_reconstruction_request') = 0
     or pg_catalog.strpos(v_claim, 'ai_run_queue') <> 0
     or pg_catalog.strpos(v_claim, 'generate') <> 0
     or pg_catalog.strpos(v_claim, 'sender') <> 0 then
    raise exception using errcode = 'P0001', message = 'P9_10_5_B_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;

commit;
