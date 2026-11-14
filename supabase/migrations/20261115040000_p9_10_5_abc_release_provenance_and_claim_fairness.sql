-- Correção incremental da 10.5-A/B/C.
-- O release precisa apontar para o evento canônico produzido na mesma transação;
-- o claim considera no máximo uma solicitação por conversa por rodada.

begin;

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
  v_release_origin text;
  v_version text;
  v_request_id uuid;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_release_reason, '')), '');
begin
  select conversation_row.* into v_conversation
    from public.conversations conversation_row
   where conversation_row.id = p_conversation_id
     and conversation_row.organization_id = p_organization_id
   for update;
  if not found then
    raise exception using errcode = '42501', message = 'P9_10_5_B_CONVERSATION_SCOPE_MISMATCH';
  end if;

  select lease_row.* into v_lease
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
  select nullif(pg_catalog.btrim(log_row.event_key), '')
    into v_takeover_event_key
    from public.state_transition_log log_row
   where log_row.organization_id = p_organization_id
     and log_row.store_id = p_store_id
     and log_row.conversation_id = p_conversation_id
     and log_row.to_state = 'humano_assumiu'
     and log_row.created_at >= v_lease.takeover_started_at
     and log_row.created_at <= v_lease.released_at
   order by log_row.created_at desc, log_row.id desc
   limit 1;

  if v_takeover_event_key is null then
    return null;
  end if;

  if v_reason = 'hybrid_human_timeout_auto_release' then
    v_release_origin := 'lease_expiration';
    select nullif(pg_catalog.btrim(log_row.event_key), '') into v_release_event_key
      from public.state_transition_log log_row
     where log_row.organization_id = p_organization_id
       and log_row.store_id = p_store_id
       and log_row.conversation_id = p_conversation_id
       and log_row.source = 'hybrid_human_timeout_auto_release'
       and log_row.to_state <> 'humano_assumiu'
       and log_row.metadata->>'origin' = 'hybrid_human_timeout_auto_release'
       and log_row.created_at >= v_lease.takeover_started_at
       and log_row.created_at <= v_lease.released_at
     order by log_row.created_at desc, log_row.id desc limit 1;
  elsif v_reason = 'p9_system_recovery' then
    v_release_origin := 'system_recovery';
    select nullif(pg_catalog.btrim(log_row.event_key), '') into v_release_event_key
      from public.state_transition_log log_row
     where log_row.organization_id = p_organization_id
       and log_row.store_id = p_store_id
       and log_row.conversation_id = p_conversation_id
       and log_row.source = 'p9_system_recovery'
       and log_row.to_state <> 'humano_assumiu'
       and log_row.created_at >= v_lease.takeover_started_at
       and log_row.created_at <= v_lease.released_at
     order by log_row.created_at desc, log_row.id desc limit 1;
  else
    v_release_origin := 'human_release';
    select nullif(pg_catalog.btrim(log_row.event_key), '') into v_release_event_key
      from public.state_transition_log log_row
     where log_row.organization_id = p_organization_id
       and log_row.store_id = p_store_id
       and log_row.conversation_id = p_conversation_id
       and log_row.source in ('panel_release_conversation_to_ai_scoped', 'human_release_conversation_to_ai')
       and log_row.to_state <> 'humano_assumiu'
       and log_row.created_at >= v_lease.takeover_started_at
       and log_row.created_at <= v_lease.released_at
     order by log_row.created_at desc, log_row.id desc limit 1;
  end if;

  if v_release_event_key is null then
    return null;
  end if;

  insert into public.p9_contextual_reconstruction_requests (
    organization_id, store_id, conversation_id, takeover_event_key, release_event_key,
    takeover_started_at, released_at, takeover_version, release_origin, processing_error
  ) values (
    p_organization_id, p_store_id, p_conversation_id, v_takeover_event_key, v_release_event_key,
    v_lease.takeover_started_at, v_lease.released_at, v_version, v_release_origin, v_reason
  ) on conflict (organization_id, store_id, conversation_id, takeover_version)
    do update set updated_at = pg_catalog.clock_timestamp(),
                  release_event_key = excluded.release_event_key,
                  release_origin = excluded.release_origin;

  select request_row.id into v_request_id
    from public.p9_contextual_reconstruction_requests request_row
   where request_row.organization_id = p_organization_id
     and request_row.store_id = p_store_id
     and request_row.conversation_id = p_conversation_id
     and request_row.takeover_version = v_version;
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
returns table (id uuid, organization_id uuid, store_id uuid, conversation_id uuid,
  takeover_event_key text, release_event_key text, takeover_started_at timestamptz,
  released_at timestamptz, takeover_version text, claim_token uuid, claim_expires_at timestamptz,
  attempt_count integer)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_candidate record;
  v_request record;
  v_conversation public.conversations%rowtype;
  v_lease public.conversation_human_takeover_leases%rowtype;
  v_token uuid;
  v_expiry timestamptz;
begin
  if auth.role() is distinct from 'service_role' or p_organization_id is null or p_store_id is null
     or p_limit is null or p_limit < 1 or p_limit > 100 or p_claimed_by is null
     or pg_catalog.btrim(p_claimed_by) = '' or pg_catalog.length(p_claimed_by) > 200
     or p_lease_seconds is null or p_lease_seconds < 60 or p_lease_seconds > 3600
     or p_max_attempts is distinct from 3 then
    raise exception using errcode = '42501', message = 'P9_10_5_B_INVALID_CLAIM_ARGUMENTS';
  end if;

  for v_candidate in
    select request_row.id, request_row.conversation_id
      from public.p9_contextual_reconstruction_requests request_row
      join public.conversations conversation_row
        on conversation_row.id = request_row.conversation_id
       and conversation_row.organization_id = p_organization_id
     where request_row.organization_id = p_organization_id
       and request_row.store_id = p_store_id
       and (request_row.status in ('pending', 'retryable')
         or (request_row.status = 'claimed' and request_row.claim_expires_at <= pg_catalog.clock_timestamp()))
       and request_row.id = (
         select candidate.id
           from public.p9_contextual_reconstruction_requests candidate
          where candidate.organization_id = p_organization_id
            and candidate.store_id = p_store_id
            and candidate.conversation_id = request_row.conversation_id
            and (candidate.status in ('pending', 'retryable')
              or (candidate.status = 'claimed' and candidate.claim_expires_at <= pg_catalog.clock_timestamp()))
          order by candidate.created_at, candidate.id
          limit 1
       )
     order by request_row.created_at, request_row.id
     limit p_limit
     for update of conversation_row skip locked
  loop
    select conversation_row.* into v_conversation
      from public.conversations conversation_row
     where conversation_row.id = v_candidate.conversation_id
       and conversation_row.organization_id = p_organization_id
     for update;
    if not found then continue; end if;

    select lease_row.* into v_lease
      from public.conversation_human_takeover_leases lease_row
     where lease_row.conversation_id = v_conversation.id
     for update;

    select request_row.* into v_request
      from public.p9_contextual_reconstruction_requests request_row
     where request_row.id = v_candidate.id
       and request_row.organization_id = p_organization_id
       and request_row.store_id = p_store_id
       and request_row.attempt_count < p_max_attempts
       and (request_row.status in ('pending', 'retryable')
         or (request_row.status = 'claimed' and request_row.claim_expires_at <= pg_catalog.clock_timestamp()))
     for update;
    if not found then continue; end if;

    if v_request.status = 'claimed' and v_request.claim_expires_at <= pg_catalog.clock_timestamp() then
      update public.p9_contextual_reconstruction_requests
         set status = case when attempt_count >= p_max_attempts then 'failed_final' else 'retryable' end,
             claim_token = null, claim_expires_at = null, claimed_by = null,
             processing_error = case when attempt_count >= p_max_attempts then 'P9_10_5_B_CLAIM_EXPIRED_MAX_ATTEMPTS' else processing_error end,
             updated_at = pg_catalog.clock_timestamp()
       where id = v_request.id;
      if v_request.attempt_count >= p_max_attempts then continue; end if;
      v_request.status := 'retryable';
    end if;

    if v_lease.organization_id is distinct from p_organization_id
       or v_lease.store_id is distinct from p_store_id
       or v_lease.takeover_started_at::text is distinct from v_request.takeover_version
       or v_lease.released_at is null or v_lease.hard_hold is true
       or v_conversation.status = 'humano_assumiu' or coalesce(v_conversation.is_human_active, false) then
      update public.p9_contextual_reconstruction_requests
         set status = 'obsolete', processing_error = 'P9_10_5_B_CONTEXT_NO_LONGER_CURRENT',
             claim_token = null, claim_expires_at = null, claimed_by = null,
             updated_at = pg_catalog.clock_timestamp()
       where id = v_request.id;
      continue;
    end if;

    v_token := pg_catalog.gen_random_uuid();
    v_expiry := pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds);
    update public.p9_contextual_reconstruction_requests
       set status = 'claimed', claim_token = v_token, claim_expires_at = v_expiry,
           claimed_by = p_claimed_by, attempt_count = attempt_count + 1,
           updated_at = pg_catalog.clock_timestamp()
     where id = v_request.id;

    id := v_request.id; organization_id := v_request.organization_id; store_id := v_request.store_id;
    conversation_id := v_request.conversation_id; takeover_event_key := v_request.takeover_event_key;
    release_event_key := v_request.release_event_key; takeover_started_at := v_request.takeover_started_at;
    released_at := v_request.released_at; takeover_version := v_request.takeover_version;
    claim_token := v_token; claim_expires_at := v_expiry; attempt_count := v_request.attempt_count + 1;
    return next;
  end loop;
end;
$function$;

alter function public.p9_10_5_b_enqueue_contextual_reconstruction_request(uuid,uuid,uuid,text) owner to postgres;
alter function public.claim_p9_contextual_reconstruction_requests_by_system(uuid,uuid,integer,text,integer,integer) owner to postgres;

commit;
