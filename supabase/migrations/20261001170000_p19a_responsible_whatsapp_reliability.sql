begin;

set local search_path = pg_catalog, public, pg_temp;

alter table public.store_assistant_responsible_whatsapp_events
  add column if not exists attempts integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists outbound_status text null,
  add column if not exists outbound_attempt integer null,
  add column if not exists outbound_started_at timestamptz null,
  add column if not exists outbound_finished_at timestamptz null,
  add column if not exists outbound_error text null;

alter table public.store_assistant_responsible_whatsapp_events
  add constraint store_assistant_responsible_whatsapp_events_attempts_check
    check (attempts between 0 and max_attempts and max_attempts between 1 and 10),
  add constraint store_assistant_responsible_whatsapp_events_outbound_status_check
    check (outbound_status is null or outbound_status in ('prepared', 'sending', 'sent', 'failed', 'uncertain')),
  add constraint store_assistant_responsible_whatsapp_events_outbound_attempt_check
    check (outbound_attempt is null or outbound_attempt between 1 and max_attempts);

create index if not exists store_assistant_responsible_whatsapp_events_recovery_idx
  on public.store_assistant_responsible_whatsapp_events (organization_id, store_id, status, locked_at);

alter table public.store_responsible_external_notifications
  add column if not exists send_status text null,
  add column if not exists send_started_at timestamptz null,
  add column if not exists send_finished_at timestamptz null,
  add column if not exists policy_decision text null,
  add column if not exists policy_last_inbound_message_id uuid null,
  add column if not exists policy_template_name text null,
  add column if not exists uncertainty_reason text null;

alter table public.store_responsible_external_notifications
  add constraint store_responsible_external_notifications_send_status_check
    check (send_status is null or send_status in ('prepared', 'sending', 'sent', 'failed', 'uncertain'));

create index if not exists store_responsible_external_notifications_recovery_idx
  on public.store_responsible_external_notifications (organization_id, store_id, status, locked_at);

create or replace function public.claim_store_assistant_responsible_whatsapp_event(
  p_event_id uuid,
  p_claim_token text,
  p_now timestamptz default now(),
  p_stale_after interval default interval '10 minutes'
)
returns table (event_id uuid, claimed boolean, status text, claim_token text)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_claim_token text := nullif(btrim(p_claim_token), '');
  v_event public.store_assistant_responsible_whatsapp_events;
begin
  if public.zion_resolve_request_role_internal() is distinct from 'service_role'
     or p_event_id is null or v_claim_token is null or length(v_claim_token) > 512
     or p_now is null or p_stale_after is null or p_stale_after <= interval '0 seconds' then
    raise exception using errcode = '42501', message = 'P19A_RESPONSIBLE_WHATSAPP_CLAIM_NOT_AUTHORIZED_OR_INVALID';
  end if;

  return query update public.store_assistant_responsible_whatsapp_events e
     set status = 'processing', locked_at = p_now, locked_by = v_claim_token,
         claim_token = v_claim_token, attempts = attempts + 1, updated_at = p_now,
         outbound_status = case when outbound_status = 'prepared' then 'prepared' else outbound_status end,
         outbound_attempt = case when outbound_status = 'prepared' then coalesce(outbound_attempt, attempts + 1) else outbound_attempt end
   where e.id = p_event_id and e.status = 'received' and e.attempts < e.max_attempts
  returning e.id, true, e.status, e.claim_token;
  if found then return; end if;

  select * into v_event from public.store_assistant_responsible_whatsapp_events e where e.id = p_event_id for update;
  if not found then return; end if;

  if v_event.status = 'processing' and v_event.locked_at <= p_now - p_stale_after then
    if v_event.outbound_status = 'sending' then
      update public.store_assistant_responsible_whatsapp_events e
         set status = 'uncertain', outbound_status = 'uncertain', outbound_finished_at = p_now,
             outbound_error = 'processing_stale_after_provider_call', locked_at = null,
             locked_by = null, updated_at = p_now
       where e.id = p_event_id and e.status = 'processing' and e.locked_at = v_event.locked_at;
      return query select p_event_id, false, 'uncertain'::text, null::text;
      return;
    elsif v_event.attempts < v_event.max_attempts then
      return query update public.store_assistant_responsible_whatsapp_events e
         set locked_at = p_now, locked_by = v_claim_token, claim_token = v_claim_token,
             attempts = attempts + 1, updated_at = p_now
       where e.id = p_event_id and e.status = 'processing' and e.locked_at = v_event.locked_at
      returning e.id, true, e.status, e.claim_token;
      return;
    else
      update public.store_assistant_responsible_whatsapp_events e
         set status = 'failed', error_text = 'RESPONSIBLE_WHATSAPP_ATTEMPT_LIMIT_REACHED',
             locked_at = null, locked_by = null, updated_at = p_now
       where e.id = p_event_id and e.status = 'processing' and e.locked_at = v_event.locked_at;
      return query select p_event_id, false, 'failed'::text, null::text;
      return;
    end if;
  end if;

  return query select v_event.id, false, v_event.status, v_event.claim_token;
end;
$$;

alter function public.claim_store_assistant_responsible_whatsapp_event(uuid, text, timestamptz, interval) owner to postgres;
revoke all on function public.claim_store_assistant_responsible_whatsapp_event(uuid, text, timestamptz, interval) from public, anon, authenticated;
grant execute on function public.claim_store_assistant_responsible_whatsapp_event(uuid, text, timestamptz, interval) to service_role;

create or replace function public.recover_stale_store_assistant_responsible_whatsapp_events(
  p_organization_id uuid,
  p_store_id uuid,
  p_now timestamptz default now(),
  p_stale_after interval default interval '10 minutes',
  p_limit integer default 20
)
returns table (event_id uuid, status text, action text)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event record;
  v_inbox_id uuid;
begin
  if public.zion_resolve_request_role_internal() is distinct from 'service_role'
     or p_organization_id is null or p_store_id is null or p_now is null
     or p_stale_after is null or p_stale_after <= interval '0 seconds'
     or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '42501', message = 'P19A_RESPONSIBLE_WHATSAPP_RECOVERY_NOT_AUTHORIZED_OR_INVALID';
  end if;

  for v_event in
    select e.*
    from public.store_assistant_responsible_whatsapp_events e
    where e.organization_id = p_organization_id
      and e.store_id = p_store_id
      and e.status = 'processing'
      and e.locked_at is not null
      and e.locked_at <= p_now - p_stale_after
    order by e.locked_at asc, e.id asc
    limit p_limit
    for update skip locked
  loop
    if v_event.outbound_status = 'sending' then
      update public.store_assistant_responsible_whatsapp_events e
      set status = 'uncertain', outbound_status = 'uncertain',
          outbound_finished_at = p_now,
          outbound_error = 'processing_stale_after_provider_call',
          locked_at = null, locked_by = null, updated_at = p_now
      where e.id = v_event.id and e.status = 'processing' and e.locked_at = v_event.locked_at;
      return query select v_event.id, 'uncertain'::text, 'provider_call_may_have_started'::text;
      continue;
    end if;

    select inbox.id into v_inbox_id
    from public.channel_whatsapp_inbox inbox
    where inbox.organization_id = p_organization_id
      and inbox.store_id = p_store_id
      and (
        inbox.payload -> 'message' ->> 'id' = v_event.external_message_id
        or inbox.payload ->> 'external_message_id' = v_event.external_message_id
      )
    order by inbox.received_at asc, inbox.id asc
    limit 1;

    if v_inbox_id is null then
      update public.store_assistant_responsible_whatsapp_events e
      set status = 'failed', error_text = 'RESPONSIBLE_WHATSAPP_RECOVERY_SOURCE_NOT_FOUND',
          locked_at = null, locked_by = null, updated_at = p_now
      where e.id = v_event.id and e.status = 'processing' and e.locked_at = v_event.locked_at;
      return query select v_event.id, 'failed'::text, 'recovery_source_not_found'::text;
      continue;
    end if;

    update public.channel_whatsapp_inbox
    set processed_at = null, processing_error = null
    where id = v_inbox_id and organization_id = p_organization_id and store_id = p_store_id;

    update public.store_assistant_responsible_whatsapp_events e
    set status = 'received', locked_at = null, locked_by = null,
        claim_token = null, updated_at = p_now
    where e.id = v_event.id and e.status = 'processing' and e.locked_at = v_event.locked_at;

    return query select v_event.id, 'received'::text, 'inbox_reopened_for_recovery'::text;
  end loop;
end;
$$;

alter function public.recover_stale_store_assistant_responsible_whatsapp_events(uuid, uuid, timestamptz, interval, integer) owner to postgres;
revoke all on function public.recover_stale_store_assistant_responsible_whatsapp_events(uuid, uuid, timestamptz, interval, integer) from public, anon, authenticated;
grant execute on function public.recover_stale_store_assistant_responsible_whatsapp_events(uuid, uuid, timestamptz, interval, integer) to service_role;

commit;
