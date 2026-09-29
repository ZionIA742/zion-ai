-- P9 / Bloco 7 / Etapa 7.4
-- Forward-only infrastructure for post-technical-visit responsible contact.
-- The migration is intentionally service-role-only. It does not change quote,
-- contract, opportunity-stage, or completion-event semantics.

do $$
begin
  if to_regclass('public.store_appointments') is null
     or to_regclass('public.store_appointment_completion_current') is null
     or to_regclass('public.store_appointment_completion_events') is null
     or to_regclass('public.schedule_post_appointment_followups') is null
     or to_regclass('public.store_responsibles') is null
     or to_regclass('public.store_assistant_notification_queue') is null
     or to_regclass('public.store_responsible_external_notifications') is null then
    raise exception 'P9 7.4 precondition failed: required appointment/followup/notification tables are missing';
  end if;
end
$$;

create table if not exists public.schedule_post_appointment_followup_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  followup_id uuid not null,
  appointment_id uuid not null,
  responsible_id uuid not null,
  attempt_number integer not null,
  schedule_anchor timestamptz not null,
  lifecycle_cycle integer null,
  commercial_opportunity_id uuid null,
  status text not null default 'reserved',
  reserved_at timestamptz not null default now(),
  sent_at timestamptz null,
  failed_at timestamptz null,
  uncertain_at timestamptz null,
  external_notification_id uuid null,
  external_message_id text null,
  inbound_response_id uuid null,
  locked_at timestamptz null,
  locked_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_post_appointment_followup_attempts_number_chk
    check (attempt_number between 1 and 3),
  constraint schedule_post_appointment_followup_attempts_cycle_chk
    check (lifecycle_cycle is null or lifecycle_cycle >= 1),
  constraint schedule_post_appointment_followup_attempts_status_chk
    check (status in ('reserved','materialized','sent','failed','uncertain','cancelled','superseded')),
  constraint schedule_post_appointment_followup_attempts_followup_scope_fkey
    foreign key (followup_id) references public.schedule_post_appointment_followups(id) on delete restrict,
  constraint schedule_post_appointment_followup_attempts_responsible_fkey
    foreign key (responsible_id) references public.store_responsibles(id) on delete restrict
);

create unique index if not exists schedule_post_appointment_followup_attempts_anchor_number_uidx
  on public.schedule_post_appointment_followup_attempts
    (organization_id, store_id, followup_id, schedule_anchor, attempt_number,
     coalesce(commercial_opportunity_id, '00000000-0000-0000-0000-000000000000'::uuid),
     coalesce(lifecycle_cycle, 0));
create index if not exists schedule_post_appointment_followup_attempts_due_idx
  on public.schedule_post_appointment_followup_attempts (organization_id, store_id, status, schedule_anchor);

create table if not exists public.schedule_post_appointment_followup_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  followup_id uuid null,
  appointment_id uuid null,
  responsible_id uuid not null,
  inbound_external_message_id text not null,
  replied_to_external_message_id text null,
  correlation_method text not null,
  raw_content text null,
  metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint schedule_post_appointment_followup_responses_metadata_chk
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists schedule_post_appointment_followup_responses_inbound_uidx
  on public.schedule_post_appointment_followup_responses
    (organization_id, store_id, inbound_external_message_id);
create index if not exists schedule_post_appointment_followup_responses_followup_idx
  on public.schedule_post_appointment_followup_responses (organization_id, store_id, followup_id, created_at desc);

alter table public.store_responsible_external_notifications
  add column if not exists related_followup_id uuid null,
  add column if not exists followup_attempt_id uuid null,
  add column if not exists attempt_number integer null;

alter table public.store_responsible_external_notifications
  add constraint store_responsible_external_notifications_attempt_number_chk
  check (attempt_number is null or attempt_number between 1 and 3);

create unique index if not exists store_responsible_external_notifications_followup_attempt_uidx
  on public.store_responsible_external_notifications
    (organization_id, store_id, related_followup_id, followup_attempt_id, channel)
  where related_followup_id is not null and followup_attempt_id is not null;

alter table public.store_responsible_external_notifications enable row level security;
revoke all on table public.store_responsible_external_notifications from public, anon, authenticated, service_role;
grant select, insert, update on table public.store_responsible_external_notifications to service_role;

alter table public.schedule_post_appointment_followup_attempts enable row level security;
revoke all on table public.schedule_post_appointment_followup_attempts from public, anon, authenticated, service_role;
grant select, insert, update on table public.schedule_post_appointment_followup_attempts to service_role;

alter table public.schedule_post_appointment_followup_responses enable row level security;
revoke all on table public.schedule_post_appointment_followup_responses from public, anon, authenticated, service_role;
grant select, insert, update on table public.schedule_post_appointment_followup_responses to service_role;

comment on table public.schedule_post_appointment_followup_attempts is
  'One business contact attempt for P9 7.4. Transport retries are not business attempts.';
comment on table public.schedule_post_appointment_followup_responses is
  'Raw responsible inbound response correlation ledger for P9 7.4; interpretation belongs to 7.5.';

create or replace function public.claim_post_technical_visit_followup_attempt(
  p_organization_id uuid,
  p_store_id uuid,
  p_now timestamptz default now()
)
  returns table (attempt_id uuid, notification_id uuid, attempt_number integer, outcome text, external_message_id text)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_followup public.schedule_post_appointment_followups;
  v_appointment public.store_appointments;
  v_completion public.store_appointment_completion_events;
  v_responsible public.store_responsibles;
  v_attempt public.schedule_post_appointment_followup_attempts;
  v_internal_id uuid;
  v_notification_id uuid;
  v_anchor timestamptz;
  v_next integer;
  v_due timestamptz;
  v_count integer;
  v_destination text;
begin
  -- The aggregate is a materialized operational obligation, not the source
  -- of truth for whether a technical visit is due. Create it from the
  -- current appointment state so a normal scheduled/rescheduled visit can
  -- enter 7.4 without an orphan producer RPC.
  insert into public.schedule_post_appointment_followups
    (organization_id, store_id, appointment_id, lead_id, conversation_id,
     scheduled_end, followup_status, preferred_channel, prompt_count)
  select a.organization_id, a.store_id, a.id, a.lead_id, a.conversation_id,
         a.scheduled_end, 'pending_confirmation', 'unknown', 0
    from public.store_appointments a
    left join public.store_appointment_completion_current c
      on c.organization_id=a.organization_id and c.store_id=a.store_id and c.appointment_id=a.id
    left join public.store_appointment_completion_events e
      on e.id=c.current_completion_event_id and e.organization_id=c.organization_id
     and e.store_id=c.store_id and e.appointment_id=c.appointment_id
   where a.organization_id=p_organization_id and a.store_id=p_store_id
     and a.appointment_type='technical_visit'
     and a.scheduled_end is not null and a.scheduled_end + interval '10 minutes' <= p_now
     and (a.status in ('scheduled','rescheduled') or e.completion_outcome='needs_followup')
     and (e.id is null or e.completion_outcome <> 'fully_completed')
  on conflict (appointment_id) do nothing;

  for v_followup in
    select f.*
      from public.schedule_post_appointment_followups f
     where f.organization_id = p_organization_id
       and f.store_id = p_store_id
       and f.resolved_at is null
       and f.resolved_at is null
     order by f.created_at, f.id
     for update skip locked
  loop
    select a.* into v_appointment
      from public.store_appointments a
     where a.id = v_followup.appointment_id
       and a.organization_id = p_organization_id
       and a.store_id = p_store_id
     for update;
    if not found or v_appointment.appointment_type <> 'technical_visit'
       or v_appointment.status = 'cancelled'
       or v_appointment.scheduled_end is null then continue; end if;

    v_anchor := v_appointment.scheduled_end;
    if v_followup.scheduled_end is distinct from v_anchor and v_followup.resolved_at is null then
      update public.schedule_post_appointment_followup_attempts
         set status='superseded', updated_at=p_now
       where followup_id=v_followup.id and schedule_anchor is distinct from v_anchor
         and status in ('reserved','materialized','failed');
      update public.store_responsible_external_notifications
         set status='cancelled', processed_at=p_now, locked_at=null, locked_by=null, updated_at=p_now
       where related_followup_id=v_followup.id and status in ('ready_to_send','materialized','processing');
      update public.schedule_post_appointment_followups
         set scheduled_end = v_anchor, prompt_count=0, last_prompted_at=null,
             followup_status='pending_confirmation', confirmed_at=null, resolution=null, updated_at = p_now
       where id = v_followup.id;
      v_followup.prompt_count := 0;
      v_followup.last_prompted_at := null;
    end if;

    select e.* into v_completion
      from public.store_appointment_completion_current c
      join public.store_appointment_completion_events e
        on e.id = c.current_completion_event_id
       and e.organization_id = c.organization_id
       and e.store_id = c.store_id
       and e.appointment_id = c.appointment_id
     where c.organization_id = p_organization_id
       and c.store_id = p_store_id
       and c.appointment_id = v_appointment.id;

    if found and v_completion.completion_outcome = 'fully_completed' then
      update public.schedule_post_appointment_followups
         set followup_status = 'confirmed_completed', confirmed_at = coalesce(confirmed_at, p_now),
             resolved_at = p_now, resolution = 'confirmed_completed', updated_at = p_now
       where id = v_followup.id and resolved_at is null;
      continue;
    end if;
    if not found and v_appointment.status not in ('scheduled','rescheduled') then continue; end if;
    if found and v_completion.completion_outcome <> 'needs_followup'
       and v_appointment.status not in ('scheduled','rescheduled') then continue; end if;
    if v_anchor + interval '10 minutes' > p_now then continue; end if;

    v_next := coalesce(v_followup.prompt_count, 0) + 1;
    v_due := case when v_next = 1 then v_anchor + interval '10 minutes'
                  else coalesce(v_followup.last_prompted_at, v_anchor) + interval '30 minutes' end;
    if v_due > p_now then continue; end if;

    select count(*) into v_count
      from public.store_responsibles r
     where r.organization_id = p_organization_id and r.store_id = p_store_id
       and r.is_primary = true and r.is_active = true;
    if v_count <> 1 then continue; end if;
    select * into v_responsible from public.store_responsibles
     where organization_id = p_organization_id and store_id = p_store_id
       and is_primary = true and is_active = true;
    v_destination := pg_catalog.regexp_replace(coalesce(v_responsible.whatsapp_number, ''), '[^0-9]', '', 'g');
    if pg_catalog.char_length(v_destination) = 11 then v_destination := '55' || v_destination; end if;
    if pg_catalog.char_length(v_destination) < 12 then continue; end if;

    select * into v_attempt from public.schedule_post_appointment_followup_attempts x
     where x.organization_id = p_organization_id and x.store_id = p_store_id
       and x.followup_id = v_followup.id and x.schedule_anchor = v_anchor and x.attempt_number = v_next
       and x.commercial_opportunity_id is not distinct from v_appointment.commercial_opportunity_id
       and x.lifecycle_cycle is not distinct from v_appointment.commercial_opportunity_lifecycle_cycle;
    update public.schedule_post_appointment_followup_attempts
       set status='superseded', updated_at=p_now
     where organization_id=p_organization_id and store_id=p_store_id
       and followup_id=v_followup.id and schedule_anchor=v_anchor and attempt_number=v_next
       and (commercial_opportunity_id is distinct from v_appointment.commercial_opportunity_id
            or lifecycle_cycle is distinct from v_appointment.commercial_opportunity_lifecycle_cycle)
       and status in ('reserved','materialized','failed');
    if found then
      if v_attempt.status in ('sent','uncertain','cancelled','superseded') then continue; end if;
      if v_attempt.external_notification_id is not null then
        if exists (
          select 1 from public.store_responsible_external_notifications n
           where n.id=v_attempt.external_notification_id and n.organization_id=p_organization_id
             and n.store_id=p_store_id and n.related_followup_id=v_followup.id
             and n.followup_attempt_id=v_attempt.id and n.status='sent'
             and n.external_message_id is not null
        ) then
          update public.schedule_post_appointment_followup_attempts
             set status='sent', sent_at=coalesce(sent_at,p_now),
                 external_message_id=(select n.external_message_id from public.store_responsible_external_notifications n where n.id=v_attempt.external_notification_id),
                 updated_at=p_now
           where id=v_attempt.id;
          update public.schedule_post_appointment_followups
             set prompt_count=v_attempt.attempt_number,last_prompted_at=coalesce(last_prompted_at,p_now),
                 followup_status='prompt_sent',updated_at=p_now where id=v_followup.id and resolved_at is null;
          continue;
        end if;
        if v_attempt.status='failed'
           and coalesce((select n.attempts from public.store_responsible_external_notifications n where n.id=v_attempt.external_notification_id),0) < 3 then
          update public.store_responsible_external_notifications
             set status='ready_to_send', failed_at=null, processed_at=null, error_text=null,
                 locked_at=null, locked_by=null, updated_at=p_now
           where id=v_attempt.external_notification_id and status='failed';
          update public.schedule_post_appointment_followup_attempts
             set status='materialized', updated_at=p_now where id=v_attempt.id;
          return query select v_attempt.id, v_attempt.external_notification_id, v_next, 'retry_existing', null::text; return;
        end if;
        continue;
      end if;
    else
      insert into public.schedule_post_appointment_followup_attempts
        (organization_id,store_id,followup_id,appointment_id,responsible_id,attempt_number,schedule_anchor,lifecycle_cycle,commercial_opportunity_id,status)
      values (p_organization_id,p_store_id,v_followup.id,v_appointment.id,v_responsible.id,v_next,v_anchor,
              v_appointment.commercial_opportunity_lifecycle_cycle,v_appointment.commercial_opportunity_id,'reserved') returning * into v_attempt;
    end if;

    v_internal_id := gen_random_uuid();
    insert into public.store_assistant_notification_queue
      (id,organization_id,store_id,notification_type,priority,status,title,body,context,related_appointment_id,available_at)
    values (v_internal_id,p_organization_id,p_store_id,'post_technical_visit','high','pending',
      'Acompanhamento da visita técnica',
      'Como foi a visita técnica? Pode me contar o que foi identificado e se ficou algum ponto pendente?',
      jsonb_build_object('source','p9_7_4','followup_id',v_followup.id,'attempt_id',v_attempt.id,'attempt_number',v_next,'schedule_anchor',v_anchor),
      v_appointment.id,p_now);

    insert into public.store_responsible_external_notifications
      (organization_id,store_id,responsible_id,internal_notification_id,channel,destination,notification_type,priority,status,title,body,rendered_message,context,source_event_key,related_appointment_id,related_followup_id,followup_attempt_id,attempt_number)
    values (p_organization_id,p_store_id,v_responsible.id,v_internal_id,'whatsapp_responsible',v_destination,
      'post_technical_visit','high','ready_to_send','Acompanhamento da visita técnica',
      'Como foi a visita técnica? Pode me contar o que foi identificado e se ficou algum ponto pendente?',
      'Como foi a visita técnica? Pode me contar o que foi identificado e se ficou algum ponto pendente?',
      jsonb_build_object('source','p9_7_4','followup_id',v_followup.id,'attempt_id',v_attempt.id,'attempt_number',v_next,'schedule_anchor',v_anchor),
      'p9_7_4:'||v_followup.id::text||':'||v_anchor::text||':'||v_next::text||':'||coalesce(v_appointment.commercial_opportunity_id::text,'none')||':'||coalesce(v_appointment.commercial_opportunity_lifecycle_cycle::text,'none'),v_appointment.id,v_followup.id,v_attempt.id,v_next)
    returning id into v_notification_id;

    update public.schedule_post_appointment_followup_attempts
       set external_notification_id = v_notification_id, status = 'materialized', updated_at = p_now
     where id = v_attempt.id;
    update public.schedule_post_appointment_followup_attempts
       set locked_at=p_now, locked_by='p9_7_4_claim', updated_at=p_now
     where id=v_attempt.id;
    return query select v_attempt.id, v_notification_id, v_next, 'claimed', null::text; return;
  end loop;
end
$$;

create or replace function public.finalize_post_technical_visit_followup_attempt(
  p_organization_id uuid, p_store_id uuid, p_attempt_id uuid, p_outcome text,
  p_external_notification_id uuid default null, p_external_message_id text default null, p_error text default null
)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_attempt public.schedule_post_appointment_followup_attempts; v_current public.store_appointments; v_now timestamptz := now();
begin
  select * into v_attempt from public.schedule_post_appointment_followup_attempts where id=p_attempt_id and organization_id=p_organization_id and store_id=p_store_id for update;
  if not found then return false; end if;
  select * into v_current from public.store_appointments where id=v_attempt.appointment_id and organization_id=p_organization_id and store_id=p_store_id;
  if not found then return false; end if;
  if p_outcome not in ('sent','failed','uncertain') then return false; end if;
  if p_external_notification_id is null or p_external_notification_id is distinct from v_attempt.external_notification_id then return false; end if;
  if not exists (
    select 1 from public.store_responsible_external_notifications n
     where n.id=p_external_notification_id and n.organization_id=p_organization_id and n.store_id=p_store_id
       and n.related_followup_id=v_attempt.followup_id and n.followup_attempt_id=v_attempt.id
  ) then return false; end if;
  if p_outcome = 'sent' then
    if nullif(btrim(coalesce(p_external_message_id,'')),'') is null then return false; end if;
    if v_attempt.status='sent' and v_attempt.external_message_id is not distinct from p_external_message_id then return true; end if;
    if not exists (
      select 1 from public.store_responsible_external_notifications n
       where n.id=p_external_notification_id and n.status='sent'
         and n.external_message_id=p_external_message_id
    ) then return false; end if;
    update public.schedule_post_appointment_followup_attempts
       set status=case when status in ('reserved','materialized','failed') then 'sent' else status end,
           sent_at=coalesce(sent_at,v_now), external_message_id=p_external_message_id,
           locked_at=null,locked_by=null,updated_at=v_now
     where id=p_attempt_id;
    if v_attempt.schedule_anchor = v_current.scheduled_end
       and v_attempt.lifecycle_cycle is not distinct from v_current.commercial_opportunity_lifecycle_cycle
       and v_attempt.commercial_opportunity_id is not distinct from v_current.commercial_opportunity_id
       and v_current.status <> 'cancelled'
       and exists (select 1 from public.schedule_post_appointment_followups f where f.id=v_attempt.followup_id and f.resolved_at is null) then
      update public.schedule_post_appointment_followups set prompt_count=v_attempt.attempt_number,last_prompted_at=v_now,followup_status='prompt_sent',updated_at=v_now where id=v_attempt.followup_id and resolved_at is null;
    end if;
  elsif p_outcome = 'uncertain' then
    if v_attempt.status in ('sent','superseded','cancelled') then return false; end if;
    update public.schedule_post_appointment_followup_attempts set status='uncertain',uncertain_at=v_now,locked_at=null,locked_by=null,updated_at=v_now where id=p_attempt_id;
  else
    if v_attempt.status in ('sent','uncertain','superseded','cancelled') then return false; end if;
    update public.schedule_post_appointment_followup_attempts set status='failed',failed_at=v_now,locked_at=null,locked_by=null,updated_at=v_now where id=p_attempt_id;
  end if;
  return true;
end
$$;

create or replace function public.record_post_technical_visit_followup_response(
  p_organization_id uuid, p_store_id uuid, p_responsible_id uuid, p_inbound_external_message_id text,
  p_replied_to_external_message_id text, p_raw_content text, p_metadata jsonb, p_received_at timestamptz default now()
)
returns table (handled boolean, correlation_status text, response_id uuid, followup_id uuid, appointment_id uuid)
language plpgsql security definer set search_path = pg_catalog, public, pg_temp
as $$
declare v_n integer; v_followup uuid; v_appointment uuid; v_attempt uuid; v_method text; v_existing_response uuid;
begin
  select id into v_existing_response from public.schedule_post_appointment_followup_responses
   where organization_id=p_organization_id and store_id=p_store_id and inbound_external_message_id=p_inbound_external_message_id;
  if v_existing_response is not null then
    return query select true,'duplicate',v_existing_response,null::uuid,null::uuid; return;
  end if;
  select count(*) into v_n from public.store_responsibles r
   where r.organization_id=p_organization_id and r.store_id=p_store_id
     and r.is_primary=true and r.is_active=true;
  if v_n <> 1 or not exists (
    select 1 from public.store_responsibles r
     where r.organization_id=p_organization_id and r.store_id=p_store_id
       and r.id=p_responsible_id and r.is_primary=true and r.is_active=true
  ) then
    insert into public.schedule_post_appointment_followup_responses
      (organization_id,store_id,responsible_id,inbound_external_message_id,replied_to_external_message_id,correlation_method,raw_content,metadata,received_at)
    values (p_organization_id,p_store_id,p_responsible_id,p_inbound_external_message_id,p_replied_to_external_message_id,'responsible_primary_invalid',p_raw_content,coalesce(p_metadata,'{}'::jsonb),p_received_at)
    returning id into response_id;
    return query select false,'responsible_primary_invalid',response_id,null::uuid,null::uuid; return;
  end if;
  if nullif(btrim(p_replied_to_external_message_id),'') is not null then
    with candidates as (
      select n.related_followup_id as followup_id, n.related_appointment_id as appointment_id, n.followup_attempt_id as attempt_id
      from public.store_responsible_external_notifications n
      join public.schedule_post_appointment_followup_attempts at
        on at.id=n.followup_attempt_id and at.followup_id=n.related_followup_id
       and at.organization_id=n.organization_id and at.store_id=n.store_id
      join public.store_appointments a
        on a.id=at.appointment_id and a.organization_id=at.organization_id and a.store_id=at.store_id
      left join public.store_appointment_completion_current c
        on c.organization_id=a.organization_id and c.store_id=a.store_id and c.appointment_id=a.id
      left join public.store_appointment_completion_events e
        on e.id=c.current_completion_event_id and e.organization_id=c.organization_id
       and e.store_id=c.store_id and e.appointment_id=c.appointment_id
     where n.organization_id=p_organization_id and n.store_id=p_store_id and n.responsible_id=p_responsible_id
       and n.notification_type='post_technical_visit' and n.channel='whatsapp_responsible'
       and n.status='sent' and n.external_message_id=p_replied_to_external_message_id
       and n.related_followup_id is not null and at.status='sent'
       and at.schedule_anchor=a.scheduled_end and a.appointment_type='technical_visit'
       and a.status <> 'cancelled' and e.completion_outcome is distinct from 'fully_completed'
       and a.scheduled_end is not null and a.scheduled_end + interval '10 minutes' <= p_received_at
       and ((e.id is null and a.status in ('scheduled','rescheduled'))
            or (e.id is not null and e.completion_outcome='needs_followup'))
       and (a.commercial_opportunity_id is null or e.id is null
            or (e.commercial_opportunity_id is not distinct from a.commercial_opportunity_id
                and e.lifecycle_cycle is not distinct from a.commercial_opportunity_lifecycle_cycle))
       and at.lifecycle_cycle is not distinct from a.commercial_opportunity_lifecycle_cycle
       and at.commercial_opportunity_id is not distinct from a.commercial_opportunity_id
       and exists (select 1 from public.schedule_post_appointment_followups f where f.id=n.related_followup_id and f.resolved_at is null)
    )
    select count(*), (array_agg(followup_id))[1], (array_agg(appointment_id))[1], (array_agg(attempt_id))[1]
      into v_n, v_followup, v_appointment, v_attempt
      from candidates;
    v_method := 'meta_context_id';
  else
    select count(*) into v_n from public.store_responsibles r
     where r.organization_id=p_organization_id and r.store_id=p_store_id
       and r.id=p_responsible_id and r.is_primary=true and r.is_active=true;
    if v_n <> 1 then
      v_method := 'responsible_primary_invalid';
      v_n := 0;
    else
    with candidates as (
      select f.id as followup_id, a.id as appointment_id, null::uuid as attempt_id
      from public.schedule_post_appointment_followups f
      join public.store_appointments a on a.id=f.appointment_id and a.organization_id=f.organization_id and a.store_id=f.store_id
      left join public.store_appointment_completion_current c on c.organization_id=a.organization_id and c.store_id=a.store_id and c.appointment_id=a.id
      left join public.store_appointment_completion_events e on e.id=c.current_completion_event_id and e.organization_id=c.organization_id and e.store_id=c.store_id and e.appointment_id=a.id
     where f.organization_id=p_organization_id and f.store_id=p_store_id and f.resolved_at is null
       and a.appointment_type='technical_visit' and a.status <> 'cancelled'
       and a.scheduled_end is not null and a.scheduled_end + interval '10 minutes' <= p_received_at
       and ((e.id is null and a.status in ('scheduled','rescheduled'))
            or (e.id is not null and e.completion_outcome='needs_followup'))
       and not exists (select 1 from public.schedule_post_appointment_followup_attempts x where x.followup_id=f.id and x.schedule_anchor=a.scheduled_end and x.status='uncertain')
       and (a.commercial_opportunity_id is null or e.id is null or (e.commercial_opportunity_id is not distinct from a.commercial_opportunity_id and e.lifecycle_cycle is not distinct from a.commercial_opportunity_lifecycle_cycle))
    )
    select count(*), (array_agg(followup_id))[1], (array_agg(appointment_id))[1], (array_agg(attempt_id))[1]
      into v_n, v_followup, v_appointment, v_attempt
      from candidates;
    v_method := case when v_n=1 then 'single_open_obligation' else 'ambiguous_or_unmatched' end;
    end if;
  end if;
  if v_n <> 1 then v_followup := null; v_appointment := null; v_attempt := null; end if;
  insert into public.schedule_post_appointment_followup_responses
    (organization_id,store_id,followup_id,appointment_id,responsible_id,inbound_external_message_id,replied_to_external_message_id,correlation_method,raw_content,metadata,received_at)
  values (p_organization_id,p_store_id,v_followup,v_appointment,p_responsible_id,p_inbound_external_message_id,p_replied_to_external_message_id,v_method,p_raw_content,coalesce(p_metadata,'{}'::jsonb),p_received_at)
  returning id into response_id;
  if v_followup is not null then
    if v_attempt is not null then
      update public.schedule_post_appointment_followup_attempts
         set inbound_response_id=response_id, updated_at=p_received_at
       where id=v_attempt and followup_id=v_followup and organization_id=p_organization_id and store_id=p_store_id;
    end if;
    update public.schedule_post_appointment_followups set followup_status='resolved',resolved_at=p_received_at,resolution='responsible_replied_pending_7_5',updated_at=p_received_at where id=v_followup and resolved_at is null;
    update public.schedule_post_appointment_followup_attempts set status='cancelled',updated_at=p_received_at where followup_id=v_followup and status in ('reserved','materialized');
    update public.store_responsible_external_notifications
       set status='cancelled',processed_at=p_received_at,locked_at=null,locked_by=null,updated_at=p_received_at
     where organization_id=p_organization_id and store_id=p_store_id and related_followup_id=v_followup
       and status in ('ready_to_send','materialized','processing');
    return query select true,'correlated',response_id,v_followup,v_appointment;
  end if;
  return query select false,v_method,response_id,null::uuid,null::uuid;
end
$$;

revoke all on function public.claim_post_technical_visit_followup_attempt(uuid,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_post_technical_visit_followup_attempt(uuid,uuid,uuid,text,uuid,text,text) from public, anon, authenticated;
revoke all on function public.record_post_technical_visit_followup_response(uuid,uuid,uuid,text,text,text,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.claim_post_technical_visit_followup_attempt(uuid,uuid,timestamptz) to service_role;
grant execute on function public.finalize_post_technical_visit_followup_attempt(uuid,uuid,uuid,text,uuid,text,text) to service_role;
grant execute on function public.record_post_technical_visit_followup_response(uuid,uuid,uuid,text,text,text,jsonb,timestamptz) to service_role;

do $$
declare v_table text; v_priv text;
begin
  foreach v_table in array array['public.store_responsible_external_notifications','public.schedule_post_appointment_followup_attempts','public.schedule_post_appointment_followup_responses'] loop
    if not (select relrowsecurity from pg_class where oid=v_table::regclass) then raise exception 'P9 7.4 postcondition failed: RLS disabled for %',v_table; end if;
    if exists (select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=v_table::regclass and a.grantee=0) then raise exception 'P9 7.4 postcondition failed: PUBLIC ACL remains on %',v_table; end if;
    foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if has_table_privilege('anon',v_table,v_priv) or has_table_privilege('authenticated',v_table,v_priv) then raise exception 'P9 7.4 postcondition failed: % has % on %', 'anon/authenticated',v_priv,v_table; end if;
    end loop;
    if not has_table_privilege('service_role',v_table,'SELECT') or not has_table_privilege('service_role',v_table,'INSERT') or not has_table_privilege('service_role',v_table,'UPDATE') then raise exception 'P9 7.4 postcondition failed: service_role minimum grant missing for %',v_table; end if;
    if has_table_privilege('service_role',v_table,'DELETE') or has_table_privilege('service_role',v_table,'TRUNCATE') then raise exception 'P9 7.4 postcondition failed: service_role overgrant on %',v_table; end if;
  end loop;
  if exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.claim_post_technical_visit_followup_attempt(uuid,uuid,timestamptz)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') or has_function_privilege('anon','public.claim_post_technical_visit_followup_attempt(uuid,uuid,timestamptz)','EXECUTE') or has_function_privilege('authenticated','public.claim_post_technical_visit_followup_attempt(uuid,uuid,timestamptz)','EXECUTE') then raise exception 'P9 7.4 postcondition failed: claim RPC public execute'; end if;
  if not has_function_privilege('service_role','public.claim_post_technical_visit_followup_attempt(uuid,uuid,timestamptz)','EXECUTE') then raise exception 'P9 7.4 postcondition failed: claim RPC service_role execute'; end if;
  if exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.finalize_post_technical_visit_followup_attempt(uuid,uuid,uuid,text,uuid,text,text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') or has_function_privilege('anon','public.finalize_post_technical_visit_followup_attempt(uuid,uuid,uuid,text,uuid,text,text)','EXECUTE') or has_function_privilege('authenticated','public.finalize_post_technical_visit_followup_attempt(uuid,uuid,uuid,text,uuid,text,text)','EXECUTE') then raise exception 'P9 7.4 postcondition failed: finalize RPC public execute'; end if;
  if not has_function_privilege('service_role','public.finalize_post_technical_visit_followup_attempt(uuid,uuid,uuid,text,uuid,text,text)','EXECUTE') then raise exception 'P9 7.4 postcondition failed: finalize RPC service_role execute'; end if;
  if exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.record_post_technical_visit_followup_response(uuid,uuid,uuid,text,text,text,jsonb,timestamptz)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') or has_function_privilege('anon','public.record_post_technical_visit_followup_response(uuid,uuid,uuid,text,text,text,jsonb,timestamptz)','EXECUTE') or has_function_privilege('authenticated','public.record_post_technical_visit_followup_response(uuid,uuid,uuid,text,text,text,jsonb,timestamptz)','EXECUTE') then raise exception 'P9 7.4 postcondition failed: response RPC public execute'; end if;
  if not has_function_privilege('service_role','public.record_post_technical_visit_followup_response(uuid,uuid,uuid,text,text,text,jsonb,timestamptz)','EXECUTE') then raise exception 'P9 7.4 postcondition failed: response RPC service_role execute'; end if;
end
$$;
