-- P9 / Bloco 7 / Etapa 7.4

-- TEMPORARY DEV DRY RUN ONLY.

--

-- This file replaces the three 7.4 RPCs only inside this transaction,

-- executes the fixture-backed runner, and ends with ROLLBACK.

-- It is NOT a migration and MUST NOT be committed as an applied migration.



begin;

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

  v_attempt_found boolean;

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

     and (c.appointment_id is null or e.id is not null)

     and (

       e.id is null

       or (

         e.commercial_opportunity_id is not distinct from a.commercial_opportunity_id

         and e.lifecycle_cycle is not distinct from a.commercial_opportunity_lifecycle_cycle

       )

     )

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



    if exists (

      select 1

        from public.store_appointment_completion_current c

       where c.organization_id = p_organization_id

         and c.store_id = p_store_id

         and c.appointment_id = v_appointment.id

         and not exists (

           select 1

             from public.store_appointment_completion_events e

            where e.id = c.current_completion_event_id

              and e.organization_id = c.organization_id

              and e.store_id = c.store_id

              and e.appointment_id = c.appointment_id

         )

    ) then

      continue;

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



    if found and (

      v_completion.commercial_opportunity_id is distinct from v_appointment.commercial_opportunity_id

      or v_completion.lifecycle_cycle is distinct from v_appointment.commercial_opportunity_lifecycle_cycle

    ) then

      continue;

    end if;



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



    if v_next < 1 or v_next > 3 then

      continue;

    end if;



    if v_next > 1 and v_followup.last_prompted_at is null then

      continue;

    end if;



    v_due := case when v_next = 1 then v_anchor + interval '10 minutes'

                  else v_followup.last_prompted_at + interval '30 minutes' end;

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



    v_attempt_found := found;



    update public.schedule_post_appointment_followup_attempts as stale_attempt

       set status='superseded', updated_at=p_now

     where stale_attempt.organization_id=p_organization_id

       and stale_attempt.store_id=p_store_id

       and stale_attempt.followup_id=v_followup.id

       and stale_attempt.schedule_anchor=v_anchor

       and stale_attempt.attempt_number=v_next

       and (stale_attempt.commercial_opportunity_id is distinct from v_appointment.commercial_opportunity_id

            or stale_attempt.lifecycle_cycle is distinct from v_appointment.commercial_opportunity_lifecycle_cycle)

       and stale_attempt.status in ('reserved','materialized','failed');



    if v_attempt_found then

      if v_attempt.status in ('sent','uncertain','cancelled','superseded') then continue; end if;

      if v_attempt.external_notification_id is not null then

        if exists (

          select 1 from public.store_responsible_external_notifications n

           where n.id=v_attempt.external_notification_id

             and n.organization_id=p_organization_id

             and n.store_id=p_store_id

             and n.related_followup_id=v_followup.id

             and n.followup_attempt_id=v_attempt.id

             and n.related_appointment_id=v_attempt.appointment_id

             and n.responsible_id=v_attempt.responsible_id

             and n.attempt_number=v_attempt.attempt_number

             and n.notification_type='post_technical_visit'

             and n.channel='whatsapp_responsible'

             and n.status='sent'

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

        if v_attempt.status='failed' then

          v_notification_id := null;



          update public.store_responsible_external_notifications n

             set status='ready_to_send',

                 failed_at=null,

                 processed_at=null,

                 error_text=null,

                 locked_at=null,

                 locked_by=null,

                 updated_at=p_now

           where n.id=v_attempt.external_notification_id

             and n.organization_id=p_organization_id

             and n.store_id=p_store_id

             and n.related_followup_id=v_followup.id

             and n.followup_attempt_id=v_attempt.id

             and n.related_appointment_id=v_attempt.appointment_id

             and n.responsible_id=v_attempt.responsible_id

             and n.attempt_number=v_attempt.attempt_number

             and n.notification_type='post_technical_visit'

             and n.channel='whatsapp_responsible'

             and n.status='failed'

             and coalesce(n.attempts,0) < 3

          returning n.id into v_notification_id;



          if v_notification_id is not null then

            update public.schedule_post_appointment_followup_attempts

               set status='materialized', updated_at=p_now

             where id=v_attempt.id;



            return query

              select v_attempt.id, v_notification_id, v_next, 'retry_existing', null::text;

            return;

          end if;

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

    values (v_internal_id,p_organization_id,p_store_id,'post_appointment_followup','high','pending',

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

declare

  v_attempt public.schedule_post_appointment_followup_attempts;

  v_current public.store_appointments;

  v_notification public.store_responsible_external_notifications;

  v_now timestamptz := now();

begin

  select * into v_attempt from public.schedule_post_appointment_followup_attempts where id=p_attempt_id and organization_id=p_organization_id and store_id=p_store_id for update;

  if not found then return false; end if;

  select * into v_current from public.store_appointments where id=v_attempt.appointment_id and organization_id=p_organization_id and store_id=p_store_id;

  if not found then return false; end if;

  if p_outcome not in ('sent','failed','uncertain') then return false; end if;

  if p_external_notification_id is null

     or p_external_notification_id is distinct from v_attempt.external_notification_id then

    return false;

  end if;



  select n.* into v_notification

    from public.store_responsible_external_notifications n

   where n.id=p_external_notification_id

     and n.organization_id=p_organization_id

     and n.store_id=p_store_id

   for update;



  if not found then return false; end if;



  if v_notification.related_followup_id is distinct from v_attempt.followup_id

     or v_notification.followup_attempt_id is distinct from v_attempt.id

     or v_notification.related_appointment_id is distinct from v_attempt.appointment_id

     or v_notification.responsible_id is distinct from v_attempt.responsible_id

     or v_notification.attempt_number is distinct from v_attempt.attempt_number

     or v_notification.notification_type is distinct from 'post_technical_visit'

     or v_notification.channel is distinct from 'whatsapp_responsible' then

    return false;

  end if;

  if p_outcome = 'sent' then

    if v_notification.status <> 'sent' then return false; end if;

    if nullif(btrim(coalesce(p_external_message_id,'')),'') is null then return false; end if;

    if v_notification.external_message_id is distinct from p_external_message_id then return false; end if;

    if v_attempt.status='sent'

       and v_attempt.external_message_id is not distinct from p_external_message_id then

      return true;

    end if;

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

    if v_notification.status <> 'uncertain' then return false; end if;

    if v_attempt.status in ('sent','superseded','cancelled') then return false; end if;

    update public.schedule_post_appointment_followup_attempts set status='uncertain',uncertain_at=v_now,locked_at=null,locked_by=null,updated_at=v_now where id=p_attempt_id;

  else

    if v_notification.status <> 'failed' then return false; end if;

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

       and n.related_appointment_id=at.appointment_id

       and n.attempt_number=at.attempt_number

       and n.responsible_id=at.responsible_id

       and at.schedule_anchor=a.scheduled_end and a.appointment_type='technical_visit'

       and a.status <> 'cancelled' and e.completion_outcome is distinct from 'fully_completed'

       and a.scheduled_end is not null and a.scheduled_end + interval '10 minutes' <= p_received_at

       and (c.appointment_id is null or e.id is not null)

       and ((e.id is null and a.status in ('scheduled','rescheduled'))

            or (e.id is not null and e.completion_outcome='needs_followup'))

       and (

         e.id is null

         or (

           e.commercial_opportunity_id is not distinct from a.commercial_opportunity_id

           and e.lifecycle_cycle is not distinct from a.commercial_opportunity_lifecycle_cycle

         )

       )

       and at.lifecycle_cycle is not distinct from a.commercial_opportunity_lifecycle_cycle

       and at.commercial_opportunity_id is not distinct from a.commercial_opportunity_id

       and exists (select 1 from public.schedule_post_appointment_followups f where f.id=n.related_followup_id and f.resolved_at is null)

    )

    select count(*),

           (array_agg(candidate.followup_id))[1],

           (array_agg(candidate.appointment_id))[1],

           (array_agg(candidate.attempt_id))[1]

      into v_n, v_followup, v_appointment, v_attempt

      from candidates candidate;

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

       and (c.appointment_id is null or e.id is not null)

       and ((e.id is null and a.status in ('scheduled','rescheduled'))

            or (e.id is not null and e.completion_outcome='needs_followup'))

       and not exists (

         select 1

           from public.schedule_post_appointment_followup_attempts x

          where x.organization_id=p_organization_id

            and x.store_id=p_store_id

            and x.followup_id=f.id

            and x.schedule_anchor=a.scheduled_end

            and x.status='uncertain'

       )

       and (

         e.id is null

         or (

           e.commercial_opportunity_id is not distinct from a.commercial_opportunity_id

           and e.lifecycle_cycle is not distinct from a.commercial_opportunity_lifecycle_cycle

         )

       )

    )

    select count(*),

           (array_agg(candidate.followup_id))[1],

           (array_agg(candidate.appointment_id))[1],

           (array_agg(candidate.attempt_id))[1]

      into v_n, v_followup, v_appointment, v_attempt

      from candidates candidate;

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

      update public.schedule_post_appointment_followup_attempts as matched_attempt

         set inbound_response_id=response_id, updated_at=p_received_at

       where matched_attempt.id=v_attempt

         and matched_attempt.followup_id=v_followup

         and matched_attempt.organization_id=p_organization_id

         and matched_attempt.store_id=p_store_id;

    end if;

    update public.schedule_post_appointment_followups set followup_status='resolved',resolved_at=p_received_at,resolution='responsible_replied_pending_7_5',updated_at=p_received_at where id=v_followup and resolved_at is null;

    update public.schedule_post_appointment_followup_attempts as pending_attempt

       set status='cancelled',updated_at=p_received_at

     where pending_attempt.organization_id=p_organization_id

       and pending_attempt.store_id=p_store_id

       and pending_attempt.followup_id=v_followup

       and pending_attempt.status in ('reserved','materialized');

    update public.store_responsible_external_notifications

       set status='cancelled',processed_at=p_received_at,locked_at=null,locked_by=null,updated_at=p_received_at

     where organization_id=p_organization_id and store_id=p_store_id and related_followup_id=v_followup

       and status in ('ready_to_send','materialized','processing');

    return query select true,'correlated',response_id,v_followup,v_appointment;

  end if;

  return query select false,v_method,response_id,null::uuid,null::uuid;

end

$$;



-- P9 / Bloco 7 / Etapa 7.4 fixture-backed rollback runner.

-- Execute only in an explicitly selected DEV database. It never commits.

create temp table p974_results (

  scenario text primary key,

  passed boolean not null,

  detail text not null

) on commit drop;

create temp table p974_context (organization_id uuid, store_id uuid) on commit drop;



do $runner$

declare

  v_run text := replace(gen_random_uuid()::text,'-','');

  v_org uuid := gen_random_uuid(); v_store uuid := gen_random_uuid();

  v_customer uuid := gen_random_uuid(); v_opportunity uuid := gen_random_uuid();

  v_responsible uuid := gen_random_uuid(); v_appointment uuid := gen_random_uuid();

  v_completed uuid := gen_random_uuid(); v_full uuid := gen_random_uuid(); v_needs uuid := gen_random_uuid();

  v_stale uuid := gen_random_uuid(); v_missing uuid := gen_random_uuid(); v_fallback uuid := gen_random_uuid(); v_second uuid := gen_random_uuid(); v_future uuid := gen_random_uuid();

  v_clock timestamptz; v_before timestamptz; v_end timestamptz; v_new_end timestamptz; v_last timestamptz;

  v_completed_end timestamptz; v_full_end timestamptz; v_needs_end timestamptz;

  v_missing_end timestamptz; v_fallback_end timestamptz; v_second_end timestamptz;

  v_claim jsonb; v_attempt uuid; v_notification uuid; v_count integer;

begin

  v_clock := clock_timestamp();

  v_end := v_clock - interval '11 minutes';

  v_before := v_end - interval '1 hour';

  -- Keep every later active fixture on the same weekday/time as the first
  -- appointment, but on a different week. This preserves operating-window /
  -- technical-visit-day compatibility while avoiding overlap and per-day
  -- capacity interaction from the 7.3 guards.

  v_completed_end := v_end - interval '7 days';

  v_full_end := v_end - interval '14 days';

  v_needs_end := v_end - interval '21 days';

  v_missing_end := v_end - interval '28 days';

  v_fallback_end := v_end - interval '35 days';

  v_second_end := v_end - interval '42 days';

  insert into p974_context values(v_org,v_store);

  insert into public.organizations(id,name) values(v_org,'P974 runner '||v_run);

  insert into public.stores(id,organization_id,name) values(v_store,v_org,'P974 store '||v_run);

  insert into public.customers(id,organization_id,display_name,normalized_name) values(v_customer,v_org,'P974 customer','p974 customer');

  insert into public.commercial_opportunities(id,organization_id,store_id,customer_id,stage) values(v_opportunity,v_org,v_store,v_customer,'negociacao');

  insert into public.store_responsibles(id,organization_id,store_id,name,whatsapp_number,role,is_primary,is_active)

    values(v_responsible,v_org,v_store,'P974 responsible','5511999999999','owner',true,true);

  insert into public.store_appointments(id,organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source,commercial_opportunity_id,commercial_opportunity_lifecycle_cycle)

    values(v_appointment,v_org,v_store,'P974 technical','technical_visit','scheduled',v_before,v_end,'system',v_opportunity,1);



  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,v_end+interval '9 minutes') x;

  insert into p974_results values('01 before +10 no claim',v_claim is null or v_claim->>'attempt_id' is null,coalesce(v_claim::text,'empty'));

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,v_end+interval '10 minutes') x;

  v_attempt := (v_claim->>'attempt_id')::uuid; v_notification := (v_claim->>'notification_id')::uuid;

  insert into p974_results values('02 +10 attempt 1',v_claim->>'attempt_number'='1',coalesce(v_claim::text,'empty'));

  update public.store_responsible_external_notifications set status='sent',external_message_id='P974-M1',sent_at=clock_timestamp() where id=v_notification;

  if not public.finalize_post_technical_visit_followup_attempt(v_org,v_store,v_attempt,'sent',v_notification,'P974-M1',null) then raise exception 'P974-02 finalize 1'; end if;

  select last_prompted_at into v_last from public.schedule_post_appointment_followups where appointment_id=v_appointment;

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,v_last+interval '30 minutes') x;

  insert into p974_results values('03 +30 attempt 2',v_claim->>'attempt_number'='2',coalesce(v_claim::text,'empty'));

  v_attempt := (v_claim->>'attempt_id')::uuid; v_notification := (v_claim->>'notification_id')::uuid;

  update public.store_responsible_external_notifications set status='sent',external_message_id='P974-M2',sent_at=clock_timestamp() where id=v_notification;

  perform public.finalize_post_technical_visit_followup_attempt(v_org,v_store,v_attempt,'sent',v_notification,'P974-M2',null);

  select last_prompted_at into v_last from public.schedule_post_appointment_followups where appointment_id=v_appointment;

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,v_last+interval '30 minutes') x;

  insert into p974_results values('04 +30 attempt 3',v_claim->>'attempt_number'='3',coalesce(v_claim::text,'empty'));

  v_attempt := (v_claim->>'attempt_id')::uuid; v_notification := (v_claim->>'notification_id')::uuid;

  update public.store_responsible_external_notifications set status='sent',external_message_id='P974-M3',sent_at=clock_timestamp() where id=v_notification;

  perform public.finalize_post_technical_visit_followup_attempt(v_org,v_store,v_attempt,'sent',v_notification,'P974-M3',null);

  select last_prompted_at into v_last

    from public.schedule_post_appointment_followups

   where appointment_id=v_appointment;



  select to_jsonb(x) into v_claim

    from public.claim_post_technical_visit_followup_attempt(

      v_org,

      v_store,

      v_last + interval '30 minutes'

    ) x;



  select count(*) into v_count

    from public.schedule_post_appointment_followup_attempts

   where organization_id=v_org

     and store_id=v_store

     and attempt_number=4;



  insert into p974_results

  values(

    '05 no attempt 4',

    (v_claim is null or v_claim->>'attempt_id' is null) and v_count=0,

    coalesce(v_claim::text,'empty') || ' / count=' || v_count::text

  );



  v_new_end := clock_timestamp() - interval '11 minutes';

  update public.store_appointments set status='rescheduled',scheduled_start=v_new_end-interval '1 hour',scheduled_end=v_new_end where id=v_appointment;

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,v_new_end+interval '9 minutes') x;

  insert into p974_results values('06 rescheduled before current +10',v_claim is null or v_claim->>'attempt_id' is null,coalesce(v_claim::text,'empty'));

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,v_new_end+interval '10 minutes') x;

  insert into p974_results values('07 rescheduled current anchor attempt 1',v_claim->>'attempt_number'='1',coalesce(v_claim::text,'empty'));

  v_attempt := (v_claim->>'attempt_id')::uuid; v_notification := (v_claim->>'notification_id')::uuid;

  update public.store_responsible_external_notifications set status='sent',external_message_id='P974-M4',sent_at=clock_timestamp() where id=v_notification;

  perform public.finalize_post_technical_visit_followup_attempt(v_org,v_store,v_attempt,'sent',v_notification,'P974-M4',null);

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-1','P974-M4','ok','{"media_ids":{"image":null}}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('08 exact context current response',v_claim->>'handled'='true' and v_claim->>'correlation_status'='correlated',coalesce(v_claim::text,'empty'));

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-1','P974-M4','duplicate','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('09 duplicate inbound idempotent',v_claim->>'correlation_status'='duplicate',coalesce(v_claim::text,'empty'));

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-2',null,'no context','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('10 resolved followup excluded from fallback',v_claim->>'handled'='false',coalesce(v_claim::text,'empty'));

  select count(*) into v_count from public.schedule_post_appointment_followup_attempts where organization_id=v_org and store_id=v_store and schedule_anchor=v_end;

  insert into p974_results values('11 old anchor retained as history',v_count=3,v_count::text);

  update public.store_appointments set status='cancelled' where id=v_appointment;

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()+interval '2 days') x;

  insert into p974_results values('12 cancelled no claim',v_claim is null or v_claim->>'attempt_id' is null,coalesce(v_claim::text,'empty'));



  insert into public.store_appointments(id,organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source,commercial_opportunity_id,commercial_opportunity_lifecycle_cycle)

    values(v_completed,v_org,v_store,'P974 no completion','technical_visit','completed',v_completed_end-interval '1 hour',v_completed_end,'system',v_opportunity,1);

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()+interval '2 days') x;

  insert into p974_results values('44 completed without canonical event fail closed',v_claim is null or v_claim->>'attempt_id' is null,coalesce(v_claim::text,'empty'));

  insert into p974_results values('45 response preserves media locator',exists(select 1 from public.schedule_post_appointment_followup_responses where organization_id=v_org and store_id=v_store and metadata ? 'media_ids'),'metadata');

  insert into p974_results values('46 response closes collection',exists(select 1 from public.schedule_post_appointment_followups where organization_id=v_org and store_id=v_store and resolution='responsible_replied_pending_7_5'),'resolution');



  insert into public.store_appointments(id,organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source,commercial_opportunity_id,commercial_opportunity_lifecycle_cycle)

    values(v_full,v_org,v_store,'P974 fully completed','technical_visit','scheduled',v_full_end-interval '1 hour',v_full_end,'system',v_opportunity,1);

  perform set_config('request.jwt.claim.role','service_role',true);

  perform public.complete_store_appointment_with_outcome(v_full,v_org,v_store,'fully_completed','runner full');

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()) x;

  insert into p974_results values('47 fully_completed resolved no send',v_claim is null or v_claim->>'attempt_id' is null,'no claim');



  insert into public.store_appointments(id,organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source,commercial_opportunity_id,commercial_opportunity_lifecycle_cycle)

    values(v_needs,v_org,v_store,'P974 needs followup','technical_visit','scheduled',v_needs_end-interval '1 hour',v_needs_end,'system',v_opportunity,1);

  perform public.complete_store_appointment_with_outcome(v_needs,v_org,v_store,'needs_followup','runner needs');

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()) x;

  insert into p974_results values('48 needs_followup remains eligible',v_claim->>'attempt_number'='1',coalesce(v_claim::text,'empty'));

  v_attempt := (v_claim->>'attempt_id')::uuid; v_notification := (v_claim->>'notification_id')::uuid;

  update public.store_responsible_external_notifications set status='failed',attempts=1,failed_at=clock_timestamp() where id=v_notification;

  perform public.finalize_post_technical_visit_followup_attempt(v_org,v_store,v_attempt,'failed',v_notification,null,'deterministic');

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()) x;

  insert into p974_results values('49 deterministic retry keeps business attempt',v_claim->>'attempt_id'=v_attempt::text and v_claim->>'attempt_number'='1',coalesce(v_claim::text,'empty'));

  update public.store_responsible_external_notifications set status='failed',attempts=3,failed_at=clock_timestamp() where id=v_notification;

  perform public.finalize_post_technical_visit_followup_attempt(v_org,v_store,v_attempt,'failed',v_notification,null,'exhausted');

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()) x;

  insert into p974_results values('50 exhausted transport retry creates no attempt 2',v_claim is null or v_claim->>'attempt_id' is null,coalesce(v_claim::text,'empty'));

  update public.schedule_post_appointment_followup_attempts set status='materialized' where id=v_attempt;

  update public.store_responsible_external_notifications set status='processing' where id=v_notification;

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()) x;

  insert into p974_results values('51 processing worker is not failed',v_claim is null or v_claim->>'attempt_id' is null,coalesce(v_claim::text,'empty'));

  update public.schedule_post_appointment_followup_attempts set status='uncertain',uncertain_at=clock_timestamp() where id=v_attempt;

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()) x;

  insert into p974_results values('52 uncertain freezes blind retry',v_claim is null or v_claim->>'attempt_id' is null,coalesce(v_claim::text,'empty'));



  update public.schedule_post_appointment_followup_attempts

     set status='failed',

         lifecycle_cycle=99,

         commercial_opportunity_id=v_opportunity

   where id=v_attempt;



  update public.store_responsible_external_notifications

     set status='failed',

         attempts=1,

         source_event_key=pg_catalog.regexp_replace(

           source_event_key,

           ':[^:]+$',

           ':99'

         )

   where id=v_notification;

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()) x;

  insert into p974_results values('53 stale lifecycle same anchor is not rearmed',v_claim->>'attempt_id' is distinct from v_attempt::text and v_claim->>'attempt_number'='1',coalesce(v_claim::text,'empty'));
  -- Scenario 53 is finished. Remove its legitimate open obligation so
  -- scenarios 54/55 isolate the completed-without-canonical-event case.
  update public.schedule_post_appointment_followups
     set resolved_at=clock_timestamp(),
         resolution='fixture_cleanup',
         followup_status='resolved',
         updated_at=clock_timestamp()
   where appointment_id=v_needs
     and resolved_at is null;

  update public.schedule_post_appointment_followup_attempts
     set status='cancelled',
         updated_at=clock_timestamp()
   where organization_id=v_org
     and store_id=v_store
     and appointment_id=v_needs
     and status in ('reserved','materialized','failed');

  update public.store_responsible_external_notifications
     set status='cancelled',
         processed_at=clock_timestamp(),
         locked_at=null,
         locked_by=null,
         updated_at=clock_timestamp()
   where organization_id=v_org
     and store_id=v_store
     and related_appointment_id=v_needs
     and status in ('ready_to_send','materialized','processing','failed');



  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-C1','P974-M1','completed no event','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('54 completed without event context unmatched',v_claim->>'handled'='false',coalesce(v_claim::text,'empty'));

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-C2',null,'completed no event','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('55 completed without event fallback unmatched',v_claim->>'handled'='false',coalesce(v_claim::text,'empty'));



  update public.store_responsibles set is_active=false where id=v_responsible;

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-P0',null,'no primary','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('56 zero primary fail closed',v_claim->>'correlation_status'='responsible_primary_invalid',coalesce(v_claim::text,'empty'));

  update public.store_responsibles set is_active=true,whatsapp_number='5511999999999' where id=v_responsible;

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,gen_random_uuid(),'P974-IN-PX',null,'wrong primary','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('57 responsible different from primary fail closed',v_claim->>'correlation_status'='responsible_primary_invalid',coalesce(v_claim::text,'empty'));



  insert into public.store_appointments(id,organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source,commercial_opportunity_id,commercial_opportunity_lifecycle_cycle)

    values(v_missing,v_org,v_store,'P974 invalid destination','technical_visit','scheduled',v_missing_end-interval '1 hour',v_missing_end,'system',v_opportunity,1);

  update public.store_responsibles set whatsapp_number='invalid' where id=v_responsible;

  select to_jsonb(x) into v_claim from public.claim_post_technical_visit_followup_attempt(v_org,v_store,clock_timestamp()) x;

  insert into p974_results values('58 invalid destination no materialization',not exists(select 1 from public.store_responsible_external_notifications where related_appointment_id=v_missing),'no notification');

  update public.store_responsibles set whatsapp_number='5511999999999' where id=v_responsible;

  update public.schedule_post_appointment_followups set resolved_at=clock_timestamp(),resolution='fixture_cleanup' where appointment_id=v_missing;

  update public.store_appointments set status='cancelled' where id=v_missing;



  insert into public.store_appointments(id,organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source,commercial_opportunity_id,commercial_opportunity_lifecycle_cycle)

    values(v_fallback,v_org,v_store,'P974 fallback','technical_visit','scheduled',v_fallback_end-interval '1 hour',v_fallback_end,'system',v_opportunity,1);

  insert into public.schedule_post_appointment_followups(organization_id,store_id,appointment_id,scheduled_end,followup_status,preferred_channel,prompt_count)

    values(v_org,v_store,v_fallback,v_fallback_end,'pending_confirmation','unknown',0);

  update public.schedule_post_appointment_followups set resolved_at=clock_timestamp(),resolution='fixture_cleanup' where appointment_id=v_needs;

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-F1',null,'fallback one','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('59 fallback exactly one correlates',v_claim->>'handled'='true' and v_claim->>'correlation_status'='correlated',coalesce(v_claim::text,'empty'));

  update public.schedule_post_appointment_followups set resolved_at=clock_timestamp(),resolution='fixture_cleanup' where appointment_id=v_fallback;

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-F0',null,'fallback zero','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('60 fallback zero unmatched',v_claim->>'handled'='false',coalesce(v_claim::text,'empty'));

  update public.schedule_post_appointment_followups set resolved_at=null,resolution=null,followup_status='pending_confirmation' where appointment_id=v_fallback;

  insert into public.store_appointments(id,organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source,commercial_opportunity_id,commercial_opportunity_lifecycle_cycle)

    values(v_second,v_org,v_store,'P974 fallback second','technical_visit','scheduled',v_second_end-interval '1 hour',v_second_end,'system',v_opportunity,1);

  insert into public.schedule_post_appointment_followups(organization_id,store_id,appointment_id,scheduled_end,followup_status,preferred_channel,prompt_count)

    values(v_org,v_store,v_second,v_second_end,'pending_confirmation','unknown',0);

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-FM',null,'fallback multiple','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('61 fallback multiple ambiguous',v_claim->>'handled'='false' and v_claim->>'correlation_status'='ambiguous_or_unmatched',coalesce(v_claim::text,'empty'));

  update public.schedule_post_appointment_followups set resolved_at=clock_timestamp(),resolution='fixture_cleanup' where appointment_id in (v_fallback,v_second);

  update public.store_appointments set status='cancelled' where id in (v_fallback,v_second);

  insert into public.store_appointments(id,organization_id,store_id,title,appointment_type,status,scheduled_start,scheduled_end,source,commercial_opportunity_id,commercial_opportunity_lifecycle_cycle)

    values(v_future,v_org,v_store,'P974 fallback future','technical_visit','scheduled',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours','system',v_opportunity,1);

  insert into public.schedule_post_appointment_followups(organization_id,store_id,appointment_id,scheduled_end,followup_status,preferred_channel,prompt_count)

    values(v_org,v_store,v_future,clock_timestamp()+interval '2 hours','pending_confirmation','unknown',0);

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,v_responsible,'P974-IN-FT',null,'fallback future','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('62 fallback before due unmatched',v_claim->>'handled'='false',coalesce(v_claim::text,'empty'));

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(gen_random_uuid(),v_store,v_responsible,'P974-IN-XT','P974-M4','cross tenant','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('63 context cross tenant unmatched',v_claim->>'handled'='false',coalesce(v_claim::text,'empty'));

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,gen_random_uuid(),v_responsible,'P974-IN-XS','P974-M4','cross store','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('64 context cross store unmatched',v_claim->>'handled'='false',coalesce(v_claim::text,'empty'));

  select to_jsonb(x) into v_claim from public.record_post_technical_visit_followup_response(v_org,v_store,gen_random_uuid(),'P974-IN-XR','P974-M4','other responsible','{}'::jsonb,clock_timestamp()) x;

  insert into p974_results values('65 context other responsible unmatched',v_claim->>'handled'='false',coalesce(v_claim::text,'empty'));

end

$runner$;



insert into p974_results values

 ('13 RLS external',(select relrowsecurity from pg_class where oid='public.store_responsible_external_notifications'::regclass),'RLS'),

 ('14 RLS attempts',(select relrowsecurity from pg_class where oid='public.schedule_post_appointment_followup_attempts'::regclass),'RLS'),

 ('15 RLS responses',(select relrowsecurity from pg_class where oid='public.schedule_post_appointment_followup_responses'::regclass),'RLS'),

 ('16 anon no external select',not has_table_privilege('anon','public.store_responsible_external_notifications','SELECT'),'ACL'),

 ('17 authenticated no external insert',not has_table_privilege('authenticated','public.store_responsible_external_notifications','INSERT'),'ACL'),

 ('18 anon no attempts update',not has_table_privilege('anon','public.schedule_post_appointment_followup_attempts','UPDATE'),'ACL'),

 ('19 authenticated no responses delete',not has_table_privilege('authenticated','public.schedule_post_appointment_followup_responses','DELETE'),'ACL'),

 ('20 service role claim execute',has_function_privilege('service_role','public.claim_post_technical_visit_followup_attempt(uuid,uuid,timestamptz)','EXECUTE'),'RPC ACL'),

 ('21 anon claim denied',not has_function_privilege('anon','public.claim_post_technical_visit_followup_attempt(uuid,uuid,timestamptz)','EXECUTE'),'RPC ACL'),

 ('22 authenticated finalize denied',not has_function_privilege('authenticated','public.finalize_post_technical_visit_followup_attempt(uuid,uuid,uuid,text,uuid,text,text)','EXECUTE'),'RPC ACL'),

 ('23 public response denied',not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.record_post_technical_visit_followup_response(uuid,uuid,uuid,text,text,text,jsonb,timestamptz)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),'RPC ACL'),

 ('24 service role no external delete',not has_table_privilege('service_role','public.store_responsible_external_notifications','DELETE'),'minimum grant'),

 ('25 service role no attempts delete',not has_table_privilege('service_role','public.schedule_post_appointment_followup_attempts','DELETE'),'minimum grant'),

 ('26 service role no responses delete',not has_table_privilege('service_role','public.schedule_post_appointment_followup_responses','DELETE'),'minimum grant'),

 ('27 public no external ACL',not exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid='public.store_responsible_external_notifications'::regclass and a.grantee=0),'ACL'),

 ('28 public no attempts ACL',not exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid='public.schedule_post_appointment_followup_attempts'::regclass and a.grantee=0),'ACL'),

 ('29 public no responses ACL',not exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid='public.schedule_post_appointment_followup_responses'::regclass and a.grantee=0),'ACL'),

 ('30 anon no external update',not has_table_privilege('anon','public.store_responsible_external_notifications','UPDATE'),'ACL'),

 ('31 authenticated no external delete',not has_table_privilege('authenticated','public.store_responsible_external_notifications','DELETE'),'ACL'),

 ('32 attempt numbers bounded',not exists(select 1 from public.schedule_post_appointment_followup_attempts where attempt_number not between 1 and 3),'constraint'),

 ('33 response metadata object',not exists(select 1 from public.schedule_post_appointment_followup_responses where jsonb_typeof(metadata)<>'object'),'constraint'),

 ('34 no quote or contract notification',not exists(select 1 from public.store_responsible_external_notifications n join p974_context c on c.organization_id=n.organization_id and c.store_id=n.store_id where n.notification_type in ('quote','contract')),'contract boundary');



do $assert$

declare r record;

begin

  for r in select * from p974_results loop

    if not r.passed then raise exception 'P974-FAIL [%] %',r.scenario,r.detail; end if;

  end loop;

end

$assert$;



select * from p974_results order by scenario;

rollback;



-- P974-MANUAL-CONCURRENCY (not asserted by this single-connection runner):

-- execute two concurrent service_role calls to claim_post_technical_visit_followup_attempt

-- for the same organization/store and assert one business attempt and one

-- notification. Transactional row locks/unique indexes are the production

-- protection; this script intentionally does not pretend to prove simultaneity.