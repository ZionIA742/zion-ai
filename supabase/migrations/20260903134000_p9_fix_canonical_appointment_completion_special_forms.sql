-- ZION / Pilar 9 / Bloco 3 / Etapa 3.5
-- Hotfix: canonical appointment completion SQL special forms
--
-- The already-applied foundation migration incorrectly schema-qualified
-- SQL special forms COALESCE and NULLIF as pg_catalog.coalesce/nullif.
-- PostgreSQL does not resolve NULLIF that way at runtime.
--
-- Do NOT edit the already-applied migration retroactively.
-- This hotfix redefines only the affected functions with unqualified
-- COALESCE / NULLIF while preserving their public signatures and semantics.

create or replace function public.create_store_appointment_with_commercial_context(
  p_organization_id uuid,
  p_store_id uuid,
  p_lead_id uuid,
  p_conversation_id uuid,
  p_title text,
  p_appointment_type text,
  p_status text,
  p_scheduled_start timestamp with time zone,
  p_scheduled_end timestamp with time zone,
  p_customer_name text,
  p_customer_phone text,
  p_address_text text,
  p_notes text,
  p_source text,
  p_created_by_user_id uuid,
  p_commercial_opportunity_id uuid default null::uuid
)
returns public.store_appointments
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text :=
    coalesce(
      nullif(
        pg_catalog.current_setting('request.jwt.claim.role', true),
        ''
      ),
      nullif(auth.jwt() ->> 'role', '')
    );
  v_opportunity public.commercial_opportunities;
  v_created_appointment public.store_appointments;
begin
  if (v_request_role not in ('authenticated', 'service_role'))
     and session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'create store appointment with commercial context is not authorized';
  end if;

  if p_status = 'completed' then
    raise exception using errcode = '23514',
      message = 'ZION_APPOINTMENT_COMPLETION_REQUIRES_CANONICAL_WRITER';
  end if;

  if p_commercial_opportunity_id is not null then
    select opportunity_row.*
    into v_opportunity
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = p_commercial_opportunity_id;

    if not found then
      raise exception using errcode = '23503',
        message = 'commercial opportunity not found';
    end if;

    if v_opportunity.organization_id is distinct from p_organization_id
       or v_opportunity.store_id is distinct from p_store_id then
      raise exception using errcode = '23514',
        message = 'commercial opportunity scope mismatch';
    end if;

    if p_lead_id is not null
       and v_opportunity.origin_lead_id is distinct from p_lead_id then
      raise exception using errcode = '23514',
        message = 'commercial opportunity lead mismatch';
    end if;

    if p_conversation_id is not null then
      if v_opportunity.primary_conversation_id is null then
        raise exception using errcode = '23514',
          message = 'commercial opportunity conversation missing';
      end if;

      if v_opportunity.primary_conversation_id is distinct from p_conversation_id then
        raise exception using errcode = '23514',
          message = 'commercial opportunity conversation mismatch';
      end if;
    end if;
  end if;

  select *
  into v_created_appointment
  from public.create_store_appointment(
    p_organization_id,
    p_store_id,
    p_lead_id,
    p_conversation_id,
    p_title,
    p_appointment_type,
    p_status,
    p_scheduled_start,
    p_scheduled_end,
    p_customer_name,
    p_customer_phone,
    p_address_text,
    p_notes,
    p_source,
    p_created_by_user_id
  );

  if p_commercial_opportunity_id is not null then
    update public.store_appointments appointment_row
    set commercial_opportunity_id = p_commercial_opportunity_id
    where appointment_row.id = v_created_appointment.id
    returning appointment_row.*
    into v_created_appointment;
  end if;

  return v_created_appointment;
end;
$function$;

create or replace function public.cancel_store_appointment(
  p_appointment_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_cancel_reason text default null::text
)
returns public.store_appointments
language plpgsql
as $function$
declare
  v_existing public.store_appointments;
  v_row public.store_appointments;
  v_notes text;
begin
  select *
  into v_existing
  from public.store_appointments
  where id = p_appointment_id
    and organization_id = p_organization_id
    and store_id = p_store_id;

  if not found then
    raise exception 'Compromisso não encontrado para esta organização/loja.';
  end if;

  if v_existing.status = 'cancelled' then
    raise exception 'Este compromisso já está cancelado.';
  end if;

  if v_existing.status = 'completed' then
    raise exception using errcode = '23514',
      message = 'ZION_APPOINTMENT_COMPLETION_REOPEN_REQUIRES_EXPLICIT_CORRECTION_AUTHORITY';
  end if;

  v_notes := coalesce(v_existing.notes, '');

  if p_cancel_reason is not null and pg_catalog.btrim(p_cancel_reason) <> '' then
    if v_notes <> '' then
      v_notes := v_notes || E'\n\n[Cancelamento] ' || pg_catalog.btrim(p_cancel_reason);
    else
      v_notes := '[Cancelamento] ' || pg_catalog.btrim(p_cancel_reason);
    end if;
  end if;

  update public.store_appointments
  set
    status = 'cancelled',
    notes = v_notes
  where id = p_appointment_id
    and organization_id = p_organization_id
    and store_id = p_store_id
  returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.complete_store_appointment_with_outcome(
  p_appointment_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_completion_outcome text,
  p_completion_note text default null::text
)
returns public.store_appointments
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_request_role text :=
    coalesce(
      nullif(
        pg_catalog.current_setting('request.jwt.claim.role', true),
        ''
      ),
      nullif(auth.jwt() ->> 'role', ''),
      ''
    );

  v_actor_type text;
  v_actor_user_id uuid;
  v_source_type text;

  v_existing public.store_appointments;
  v_row public.store_appointments;
  v_opportunity public.commercial_opportunities;

  v_current public.store_appointment_completion_current;
  v_current_event public.store_appointment_completion_events;
  v_existing_operation_event public.store_appointment_completion_events;
  v_new_event public.store_appointment_completion_events;

  v_event_number integer;
  v_previous_event_id uuid;
  v_lifecycle_cycle integer;
  v_operation_key text;
  v_request_fingerprint text;
  v_reason_code text;

  v_followup public.schedule_post_appointment_followups;
  v_final_notes text;
  v_resolution text;
  v_followup_note text;
begin
  if v_request_role = 'service_role' then
    v_actor_type := 'system';
    v_actor_user_id := null;
    v_source_type := 'service_role_appointment_completion';
  else
    if auth.uid() is null
       or not exists (
         select 1
         from public.memberships membership_row
         where membership_row.organization_id = p_organization_id
           and membership_row.user_id = auth.uid()
           and membership_row.is_active is true
       )
       or not exists (
         select 1
         from public.stores store_row
         where store_row.id = p_store_id
           and store_row.organization_id = p_organization_id
       ) then
      raise exception using errcode = '42501',
        message = 'insufficient privilege: tenant access denied';
    end if;

    v_actor_type := 'human';
    v_actor_user_id := auth.uid();
    v_source_type := 'authenticated_appointment_completion';
  end if;

  if p_completion_outcome not in ('fully_completed', 'needs_followup') then
    raise exception 'Resultado de conclusão inválido.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'p9:appointment_completion:' || p_appointment_id::text,
      0
    )
  );

  select appointment_row.*
  into v_existing
  from public.store_appointments appointment_row
  where appointment_row.id = p_appointment_id
    and appointment_row.organization_id = p_organization_id
    and appointment_row.store_id = p_store_id
  for update;

  if not found then
    raise exception 'Compromisso não encontrado para esta organização/loja.';
  end if;

  if v_existing.status = 'cancelled' then
    raise exception 'Não é possível concluir um compromisso cancelado.';
  end if;

  if v_existing.commercial_opportunity_id is not null then
    select opportunity_row.*
    into v_opportunity
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = v_existing.commercial_opportunity_id
      and opportunity_row.organization_id = p_organization_id
      and opportunity_row.store_id = p_store_id
    for key share;

    if not found then
      raise exception using errcode = '23503',
        message = 'ZION_APPOINTMENT_COMPLETION_OPPORTUNITY_NOT_FOUND';
    end if;

    v_lifecycle_cycle := v_opportunity.lifecycle_cycle;
  else
    v_lifecycle_cycle := null;
  end if;

  v_reason_code := case
    when p_completion_outcome = 'fully_completed'
      then 'appointment_fully_completed'
    else 'appointment_completed_needs_followup'
  end;

  v_operation_key :=
    'appointment_completion:v1:' ||
    p_appointment_id::text || ':' ||
    coalesce(v_lifecycle_cycle::text, 'none') || ':' ||
    p_completion_outcome;

  v_request_fingerprint :=
    public.p9_compute_appointment_completion_fingerprint_internal(
      p_organization_id,
      p_store_id,
      p_appointment_id,
      v_existing.commercial_opportunity_id,
      v_lifecycle_cycle,
      p_completion_outcome
    );

  select event_row.*
  into v_existing_operation_event
  from public.store_appointment_completion_events event_row
  where event_row.organization_id = p_organization_id
    and event_row.store_id = p_store_id
    and event_row.appointment_id = p_appointment_id
    and event_row.operation_key = v_operation_key;

  if found then
    if v_existing_operation_event.request_fingerprint
         is distinct from v_request_fingerprint
       or v_existing_operation_event.completion_outcome
         is distinct from p_completion_outcome
       or v_existing_operation_event.commercial_opportunity_id
         is distinct from v_existing.commercial_opportunity_id
       or v_existing_operation_event.lifecycle_cycle
         is distinct from v_lifecycle_cycle then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_IDEMPOTENCY_CONFLICT';
    end if;

    select current_row.*
    into v_current
    from public.store_appointment_completion_current current_row
    where current_row.organization_id = p_organization_id
      and current_row.store_id = p_store_id
      and current_row.appointment_id = p_appointment_id
    for update;

    if not found
       or v_current.current_completion_event_id
            is distinct from v_existing_operation_event.id then
      raise exception using errcode = '40001',
        message = 'ZION_APPOINTMENT_COMPLETION_OBSOLETE_REPLAY';
    end if;

    if v_existing.status is distinct from 'completed' then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_CURRENT_STATUS_MISMATCH';
    end if;

    return v_existing;
  end if;

  select current_row.*
  into v_current
  from public.store_appointment_completion_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.appointment_id = p_appointment_id
  for update;

  if found then
    select event_row.*
    into v_current_event
    from public.store_appointment_completion_events event_row
    where event_row.id = v_current.current_completion_event_id
      and event_row.organization_id = p_organization_id
      and event_row.store_id = p_store_id
      and event_row.appointment_id = p_appointment_id;

    if not found then
      raise exception using errcode = 'P0001',
        message = 'ZION_APPOINTMENT_COMPLETION_CURRENT_EVENT_MISSING';
    end if;

    if v_current_event.commercial_opportunity_id
         is distinct from v_existing.commercial_opportunity_id
       or v_current_event.lifecycle_cycle
         is distinct from v_lifecycle_cycle then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_SCOPE_CHANGED_NEEDS_RESOLUTION';
    end if;

    if v_current_event.completion_outcome = 'fully_completed'
       and p_completion_outcome = 'needs_followup' then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_REGRESSION_REQUIRES_CORRECTION_AUTHORITY';
    end if;

    v_previous_event_id := v_current_event.id;
    v_event_number := v_current_event.event_number + 1;
  else
    v_previous_event_id := null;
    v_event_number := 1;
  end if;

  insert into public.store_appointment_completion_events (
    organization_id,
    store_id,
    appointment_id,
    event_number,
    previous_completion_event_id,
    commercial_opportunity_id,
    lifecycle_cycle,
    completion_outcome,
    appointment_type_snapshot,
    previous_status_snapshot,
    scheduled_start_snapshot,
    scheduled_end_snapshot,
    actor_type,
    actor_user_id,
    operation_key,
    request_fingerprint,
    reason_code,
    completion_note,
    source_type,
    created_by,
    metadata
  )
  values (
    p_organization_id,
    p_store_id,
    p_appointment_id,
    v_event_number,
    v_previous_event_id,
    v_existing.commercial_opportunity_id,
    v_lifecycle_cycle,
    p_completion_outcome,
    v_existing.appointment_type,
    v_existing.status,
    v_existing.scheduled_start,
    v_existing.scheduled_end,
    v_actor_type,
    v_actor_user_id,
    v_operation_key,
    v_request_fingerprint,
    v_reason_code,
    nullif(pg_catalog.btrim(coalesce(p_completion_note, '')), ''),
    v_source_type,
    'p9_appointment_completion_v1',
    pg_catalog.jsonb_build_object(
      'schema_version', 1,
      'canonical_authority', 'store_appointment_completion_events'
    )
  )
  returning *
  into v_new_event;

  v_final_notes := coalesce(v_existing.notes, '');

  if p_completion_note is not null
     and pg_catalog.btrim(p_completion_note) <> '' then
    if v_final_notes <> '' then
      v_final_notes :=
        v_final_notes ||
        E'\n\n[Conclusão] ' ||
        pg_catalog.btrim(p_completion_note);
    else
      v_final_notes :=
        '[Conclusão] ' ||
        pg_catalog.btrim(p_completion_note);
    end if;
  end if;

  update public.store_appointments
  set
    status = 'completed',
    notes = v_final_notes,
    updated_at = pg_catalog.now()
  where id = p_appointment_id
    and organization_id = p_organization_id
    and store_id = p_store_id
  returning * into v_row;

  insert into public.store_appointment_completion_current (
    organization_id,
    store_id,
    appointment_id,
    current_completion_event_id,
    last_operation_key
  )
  values (
    p_organization_id,
    p_store_id,
    p_appointment_id,
    v_new_event.id,
    v_new_event.operation_key
  )
  on conflict (organization_id, store_id, appointment_id)
  do update
  set
    current_completion_event_id = excluded.current_completion_event_id,
    last_operation_key = excluded.last_operation_key;

  select followup_row.*
  into v_followup
  from public.schedule_post_appointment_followups followup_row
  where followup_row.appointment_id = p_appointment_id
    and followup_row.organization_id = p_organization_id
    and followup_row.store_id = p_store_id
  order by followup_row.created_at desc
  limit 1;

  if p_completion_outcome = 'fully_completed' then
    if found then
      v_resolution := 'confirmed_completed';

      update public.schedule_post_appointment_followups
      set
        followup_status = v_resolution,
        confirmed_at = coalesce(confirmed_at, pg_catalog.now()),
        resolved_at = pg_catalog.now(),
        resolution = v_resolution,
        notes = case
          when p_completion_note is not null
               and pg_catalog.btrim(p_completion_note) <> '' then
            case
              when coalesce(notes, '') <> '' then
                notes ||
                E'\n\n[Fechamento do atendimento] ' ||
                pg_catalog.btrim(p_completion_note)
              else
                '[Fechamento do atendimento] ' ||
                pg_catalog.btrim(p_completion_note)
            end
          else notes
        end,
        updated_at = pg_catalog.now()
      where id = v_followup.id;
    end if;
  else
    v_followup_note := case
      when p_completion_note is not null
           and pg_catalog.btrim(p_completion_note) <> '' then
        '[Após a conclusão ainda falta retorno] ' ||
        pg_catalog.btrim(p_completion_note)
      else
        '[Após a conclusão ainda falta retorno] Atendimento concluído, mas ainda existe retorno pendente.'
    end;

    if found then
      update public.schedule_post_appointment_followups
      set
        followup_status = 'prompt_sent',
        confirmed_at = null,
        resolved_at = null,
        resolution = null,
        notes = case
          when coalesce(notes, '') <> '' then
            notes || E'\n\n' || v_followup_note
          else v_followup_note
        end,
        updated_at = pg_catalog.now()
      where id = v_followup.id;
    else
      insert into public.schedule_post_appointment_followups (
        organization_id,
        store_id,
        appointment_id,
        lead_id,
        conversation_id,
        scheduled_end,
        followup_status,
        preferred_channel,
        prompt_count,
        notes
      )
      values (
        p_organization_id,
        p_store_id,
        p_appointment_id,
        v_row.lead_id,
        v_row.conversation_id,
        v_row.scheduled_end,
        'prompt_sent',
        'unknown',
        0,
        v_followup_note
      )
      returning *
      into v_followup;
    end if;
  end if;

  perform public.log_schedule_conversation_event(
    p_organization_id,
    v_row.conversation_id,
    'compromisso_concluido',
    'schedule_panel',
    pg_catalog.jsonb_build_object(
      'appointment_id', v_row.id,
      'appointment_type', v_row.appointment_type,
      'title', v_row.title,
      'previous_status', v_existing.status,
      'status', v_row.status,
      'scheduled_start', v_row.scheduled_start,
      'scheduled_end', v_row.scheduled_end,
      'customer_name', v_row.customer_name,
      'customer_phone', v_row.customer_phone,
      'address_text', v_row.address_text,
      'notes', v_row.notes,
      'completion_outcome', p_completion_outcome,
      'canonical_completion_event_id', v_new_event.id,
      'canonical_completion_event_number', v_new_event.event_number,
      'canonical_completion_fingerprint', v_new_event.request_fingerprint,
      'has_linked_followup', (v_followup.id is not null)
    )
  );

  return v_row;
end;
$function$;

alter function public.complete_store_appointment_with_outcome(
  uuid, uuid, uuid, text, text
) owner to postgres;

revoke all on function public.complete_store_appointment_with_outcome(
  uuid, uuid, uuid, text, text
) from public, anon;
grant execute on function public.complete_store_appointment_with_outcome(
  uuid, uuid, uuid, text, text
) to authenticated, service_role;

do $postconditions$
declare
  v_create_ctx_definition text;
  v_cancel_definition text;
  v_complete_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.create_store_appointment_with_commercial_context(uuid,uuid,uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,uuid,uuid)'::pg_catalog.regprocedure
  )
  into v_create_ctx_definition;

  select pg_catalog.pg_get_functiondef(
    'public.cancel_store_appointment(uuid,uuid,uuid,text)'::pg_catalog.regprocedure
  )
  into v_cancel_definition;

  select pg_catalog.pg_get_functiondef(
    'public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)'::pg_catalog.regprocedure
  )
  into v_complete_definition;

  if v_create_ctx_definition like '%pg_catalog.coalesce(%'
     or v_create_ctx_definition like '%pg_catalog.nullif(%'
     or v_cancel_definition like '%pg_catalog.coalesce(%'
     or v_cancel_definition like '%pg_catalog.nullif(%'
     or v_complete_definition like '%pg_catalog.coalesce(%'
     or v_complete_definition like '%pg_catalog.nullif(%' then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: schema-qualified COALESCE/NULLIF still present';
  end if;

  if v_complete_definition not like '%store_appointment_completion_events%'
     or v_complete_definition not like '%store_appointment_completion_current%'
     or v_complete_definition not like '%pg_advisory_xact_lock%' then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: canonical completion semantics lost during hotfix';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)',
       'EXECUTE'
     ) then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: canonical completion grants changed during hotfix';
  end if;
end;
$postconditions$;
