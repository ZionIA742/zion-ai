begin;

alter table public.store_appointments
  drop constraint if exists store_appointments_valid_type;

alter table public.store_appointments
  add constraint store_appointments_valid_type
  check (
    appointment_type = any (
      array[
        'technical_visit'::text,
        'installation'::text,
        'follow_up'::text,
        'meeting'::text,
        'measurement'::text,
        'maintenance'::text,
        'post_sale'::text,
        'other'::text
      ]
    )
  );

create or replace function public.create_store_appointment(
  p_organization_id uuid,
  p_store_id uuid,
  p_lead_id uuid,
  p_conversation_id uuid,
  p_title text,
  p_appointment_type text,
  p_status text,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_address_text text default null,
  p_notes text default null,
  p_source text default 'panel',
  p_created_by_user_id uuid default null
)
returns public.store_appointments
language plpgsql
as $function$
declare
  v_row public.store_appointments;
  v_has_appointment_conflict boolean;
  v_has_block_conflict boolean;
  v_within_operating_window boolean;
  v_effective_conversation_id uuid;
begin
  if p_title is null or pg_catalog.btrim(p_title) = '' then
    raise exception 'Título do compromisso é obrigatório.';
  end if;

  if p_scheduled_start is null or p_scheduled_end is null then
    raise exception 'Período do compromisso é obrigatório.';
  end if;

  if p_scheduled_end <= p_scheduled_start then
    raise exception 'Horário final deve ser maior que o horário inicial.';
  end if;

  if p_appointment_type not in (
    'technical_visit',
    'installation',
    'follow_up',
    'meeting',
    'measurement',
    'maintenance',
    'post_sale',
    'other'
  ) then
    raise exception 'Tipo de compromisso inválido.';
  end if;

  if p_status = 'completed' then
    raise exception using
      errcode = '23514',
      message = 'ZION_APPOINTMENT_COMPLETION_REQUIRES_CANONICAL_WRITER';
  end if;

  if p_status not in (
    'scheduled',
    'completed',
    'cancelled',
    'rescheduled'
  ) then
    raise exception 'Status do compromisso inválido.';
  end if;

  if p_source not in (
    'panel',
    'ai_operator',
    'system'
  ) then
    raise exception 'Origem inválida.';
  end if;

  select public.is_store_appointment_within_operating_window(
    p_organization_id,
    p_store_id,
    p_appointment_type,
    p_scheduled_start,
    p_scheduled_end
  )
  into v_within_operating_window;

  if not v_within_operating_window then
    raise exception 'Esse compromisso está fora da janela operacional configurada da loja.';
  end if;

  select public.has_store_appointment_conflict(
    p_organization_id,
    p_store_id,
    p_scheduled_start,
    p_scheduled_end,
    null
  )
  into v_has_appointment_conflict;

  if v_has_appointment_conflict then
    raise exception 'Já existe outro compromisso nesse horário.';
  end if;

  select public.has_store_schedule_block_conflict(
    p_organization_id,
    p_store_id,
    p_scheduled_start,
    p_scheduled_end
  )
  into v_has_block_conflict;

  if v_has_block_conflict then
    raise exception 'Existe um bloqueio de agenda nesse horário.';
  end if;

  v_effective_conversation_id := p_conversation_id;

  if v_effective_conversation_id is null and p_lead_id is not null then
    v_effective_conversation_id := public.get_latest_conversation_for_lead(
      p_organization_id,
      p_lead_id
    );
  end if;

  insert into public.store_appointments (
    organization_id,
    store_id,
    lead_id,
    conversation_id,
    title,
    appointment_type,
    status,
    scheduled_start,
    scheduled_end,
    customer_name,
    customer_phone,
    address_text,
    notes,
    source,
    created_by_user_id
  )
  values (
    p_organization_id,
    p_store_id,
    p_lead_id,
    v_effective_conversation_id,
    pg_catalog.btrim(p_title),
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
  )
  returning * into v_row;

  perform public.log_schedule_conversation_event(
    p_organization_id,
    v_row.conversation_id,
    'compromisso_agendado',
    'schedule_panel',
    pg_catalog.jsonb_build_object(
      'appointment_id', v_row.id,
      'appointment_type', v_row.appointment_type,
      'title', v_row.title,
      'status', v_row.status,
      'scheduled_start', v_row.scheduled_start,
      'scheduled_end', v_row.scheduled_end,
      'customer_name', v_row.customer_name,
      'customer_phone', v_row.customer_phone,
      'address_text', v_row.address_text,
      'notes', v_row.notes,
      'source', v_row.source
    )
  );

  return v_row;
end;
$function$;

create or replace function public.update_store_appointment(
  p_appointment_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_title text,
  p_appointment_type text,
  p_status text,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_address_text text default null,
  p_notes text default null
)
returns public.store_appointments
language plpgsql
as $function$
declare
  v_existing public.store_appointments;
  v_row public.store_appointments;
  v_has_appointment_conflict boolean;
  v_has_block_conflict boolean;
  v_within_operating_window boolean;
  v_time_changed boolean := false;
  v_status_changed boolean := false;
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

  if p_title is null or pg_catalog.btrim(p_title) = '' then
    raise exception 'Título do compromisso é obrigatório.';
  end if;

  if p_scheduled_start is null or p_scheduled_end is null then
    raise exception 'Período do compromisso é obrigatório.';
  end if;

  if p_scheduled_end <= p_scheduled_start then
    raise exception 'Horário final deve ser maior que o horário inicial.';
  end if;

  if p_appointment_type not in (
    'technical_visit',
    'installation',
    'follow_up',
    'meeting',
    'measurement',
    'maintenance',
    'post_sale',
    'other'
  ) then
    raise exception 'Tipo de compromisso inválido.';
  end if;

  if p_status not in (
    'scheduled',
    'completed',
    'cancelled',
    'rescheduled'
  ) then
    raise exception 'Status do compromisso inválido.';
  end if;

  if v_existing.status is distinct from 'completed'
     and p_status = 'completed' then
    raise exception using
      errcode = '23514',
      message = 'ZION_APPOINTMENT_COMPLETION_REQUIRES_CANONICAL_WRITER';
  end if;

  if v_existing.status = 'completed'
     and p_status is distinct from 'completed' then
    raise exception using
      errcode = '23514',
      message = 'ZION_APPOINTMENT_COMPLETION_REOPEN_REQUIRES_EXPLICIT_CORRECTION_AUTHORITY';
  end if;

  select public.is_store_appointment_within_operating_window(
    p_organization_id,
    p_store_id,
    p_appointment_type,
    p_scheduled_start,
    p_scheduled_end
  )
  into v_within_operating_window;

  if not v_within_operating_window then
    raise exception 'Esse compromisso está fora da janela operacional configurada da loja.';
  end if;

  select public.has_store_appointment_conflict(
    p_organization_id,
    p_store_id,
    p_scheduled_start,
    p_scheduled_end,
    p_appointment_id
  )
  into v_has_appointment_conflict;

  if v_has_appointment_conflict then
    raise exception 'Já existe outro compromisso nesse horário.';
  end if;

  select public.has_store_schedule_block_conflict(
    p_organization_id,
    p_store_id,
    p_scheduled_start,
    p_scheduled_end
  )
  into v_has_block_conflict;

  if v_has_block_conflict then
    raise exception 'Existe um bloqueio de agenda nesse horário.';
  end if;

  v_time_changed :=
    v_existing.scheduled_start is distinct from p_scheduled_start
    or v_existing.scheduled_end is distinct from p_scheduled_end;

  v_status_changed := v_existing.status is distinct from p_status;

  update public.store_appointments
  set
    title = pg_catalog.btrim(p_title),
    appointment_type = p_appointment_type,
    status = p_status,
    scheduled_start = p_scheduled_start,
    scheduled_end = p_scheduled_end,
    customer_name = p_customer_name,
    customer_phone = p_customer_phone,
    address_text = p_address_text,
    notes = p_notes,
    updated_at = pg_catalog.now()
  where id = p_appointment_id
    and organization_id = p_organization_id
    and store_id = p_store_id
  returning * into v_row;

  if v_time_changed then
    perform public.log_schedule_conversation_event(
      p_organization_id,
      v_row.conversation_id,
      'compromisso_remarcado',
      'schedule_panel',
      pg_catalog.jsonb_build_object(
        'appointment_id', v_row.id,
        'appointment_type', v_row.appointment_type,
        'title', v_row.title,
        'previous_start', v_existing.scheduled_start,
        'previous_end', v_existing.scheduled_end,
        'scheduled_start', v_row.scheduled_start,
        'scheduled_end', v_row.scheduled_end,
        'status', v_row.status,
        'customer_name', v_row.customer_name,
        'customer_phone', v_row.customer_phone,
        'address_text', v_row.address_text,
        'notes', v_row.notes
      )
    );
  end if;

  if v_status_changed and v_row.status = 'cancelled' then
    perform public.log_schedule_conversation_event(
      p_organization_id,
      v_row.conversation_id,
      'compromisso_cancelado',
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
        'notes', v_row.notes
      )
    );
  end if;

  return v_row;
end;
$function$;

create or replace function public.check_store_appointment_availability_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_appointment_type text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_ignore_appointment_id uuid default null
)
returns table (
  available boolean,
  reason_code text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_installation_status text;
begin
  if p_organization_id is null or p_store_id is null
     or p_start_at is null or p_end_at is null
     or p_end_at <= p_start_at then
    return query select false, 'invalid_request'::text;
    return;
  end if;

  if p_appointment_type is null or p_appointment_type not in (
    'technical_visit',
    'installation',
    'follow_up',
    'meeting',
    'measurement',
    'maintenance',
    'post_sale',
    'other'
  ) then
    return query select false, 'invalid_appointment_type'::text;
    return;
  end if;

  if not public.is_store_appointment_within_operating_window(
    p_organization_id,
    p_store_id,
    p_appointment_type,
    p_start_at,
    p_end_at
  ) then
    return query select false, 'outside_operating_window'::text;
    return;
  end if;

  if public.has_store_schedule_block_conflict(
    p_organization_id,
    p_store_id,
    p_start_at,
    p_end_at
  ) then
    return query select false, 'schedule_block_conflict'::text;
    return;
  end if;

  if public.has_store_appointment_conflict(
    p_organization_id,
    p_store_id,
    p_start_at,
    p_end_at,
    p_ignore_appointment_id
  ) then
    return query select false, 'global_capacity_exceeded'::text;
    return;
  end if;

  v_installation_status :=
    public.p19a_check_installation_team_capacity_internal(
      p_organization_id,
      p_store_id,
      p_appointment_type,
      p_start_at,
      p_end_at,
      p_ignore_appointment_id
    );

  if v_installation_status = 'invalid' then
    return query select false, 'installation_team_capacity_invalid'::text;
    return;
  end if;

  if v_installation_status = 'conflict' then
    return query select false, 'installation_team_capacity_exceeded'::text;
    return;
  end if;

  return query select true, null::text;
end;
$function$;

commit;
