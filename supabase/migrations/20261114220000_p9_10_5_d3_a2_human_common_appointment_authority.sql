begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

do $precondition$
begin
  if pg_catalog.to_regprocedure(
    'public.create_store_appointment_with_commercial_context(uuid,uuid,uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,uuid,uuid)'
  ) is null then
    raise exception using
      errcode = '42883',
      message = 'precondition failed: canonical common appointment writer is required';
  end if;
end;
$precondition$;

create table public.p9_human_common_appointment_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  store_id uuid not null,
  lead_id uuid null,
  conversation_id uuid null,
  commercial_opportunity_id uuid null,
  actor_user_id uuid not null,
  operation_key text not null,
  request_fingerprint text not null,
  source_type text not null default 'panel_human',
  source_version integer not null default 1,
  appointment_id uuid null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_at timestamptz null,
  constraint p9_human_common_appointment_operation_key_chk
    check (pg_catalog.length(pg_catalog.btrim(operation_key)) between 1 and 200),
  constraint p9_human_common_appointment_fingerprint_chk
    check (pg_catalog.length(pg_catalog.btrim(request_fingerprint)) = 64),
  constraint p9_human_common_appointment_source_chk
    check (source_type = 'panel_human' and source_version = 1),
  constraint p9_human_common_appointment_scope_uk
    unique (id, organization_id, store_id),
  constraint p9_human_common_appointment_operation_uk
    unique (organization_id, operation_key),
  constraint p9_human_common_appointment_store_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id) on delete restrict,
  constraint p9_human_common_appointment_lead_fk
    foreign key (lead_id, organization_id, store_id)
    references public.leads(id, organization_id, store_id) on delete restrict,
  constraint p9_human_common_appointment_opportunity_fk
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id) on delete restrict,
  constraint p9_human_common_appointment_appointment_fk
    foreign key (appointment_id, organization_id, store_id)
    references public.store_appointments(id, organization_id, store_id) on delete restrict
);

revoke all on table public.p9_human_common_appointment_operations
  from public, anon, authenticated, service_role;

create or replace function public.create_common_appointment_by_user(
  p_organization_id uuid,
  p_store_id uuid,
  p_lead_id uuid,
  p_conversation_id uuid,
  p_title text,
  p_appointment_type text,
  p_status text,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_address_text text,
  p_notes text,
  p_commercial_opportunity_id uuid,
  p_operation_key text
)
returns public.store_appointments
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp, auth, extensions
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := public.zion_resolve_request_role_internal();
  v_fingerprint text;
  v_operation public.p9_human_common_appointment_operations%rowtype;
  v_appointment public.store_appointments;
begin
  if v_user_id is null or v_request_role is distinct from 'authenticated' then
    raise exception using errcode = '42501',
      message = 'ZION_HUMAN_COMMON_APPOINTMENT_AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_organization_id
      and membership_row.user_id = v_user_id
      and membership_row.is_active is true
  ) then
    raise exception using errcode = '42501',
      message = 'ZION_HUMAN_COMMON_APPOINTMENT_MEMBERSHIP_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_organization_id
  ) then
    raise exception using errcode = '23503',
      message = 'ZION_HUMAN_COMMON_APPOINTMENT_STORE_SCOPE_NOT_FOUND';
  end if;

  if p_appointment_type is null
     or p_appointment_type = 'technical_visit' then
    raise exception using errcode = '23514',
      message = 'ZION_HUMAN_COMMON_APPOINTMENT_TYPE_NOT_ALLOWED';
  end if;

  if p_operation_key is null
     or pg_catalog.length(pg_catalog.btrim(p_operation_key)) not between 1 and 200 then
    raise exception using errcode = '22023',
      message = 'ZION_HUMAN_COMMON_APPOINTMENT_OPERATION_KEY_REQUIRED';
  end if;

  if p_lead_id is not null and not exists (
    select 1
    from public.leads lead_row
    where lead_row.id = p_lead_id
      and lead_row.organization_id = p_organization_id
      and lead_row.store_id = p_store_id
  ) then
    raise exception using errcode = '23503',
      message = 'ZION_HUMAN_COMMON_APPOINTMENT_LEAD_SCOPE_NOT_FOUND';
  end if;

  if p_conversation_id is not null and not exists (
    select 1
    from public.conversations conversation_row
    left join public.leads lead_row on lead_row.id = conversation_row.lead_id
    where conversation_row.id = p_conversation_id
      and conversation_row.organization_id = p_organization_id
      and lead_row.id is not null
      and lead_row.store_id = p_store_id
      and conversation_row.lead_id = p_lead_id
  ) then
    raise exception using errcode = '23503',
      message = 'ZION_HUMAN_COMMON_APPOINTMENT_CONVERSATION_SCOPE_NOT_FOUND';
  end if;

  if p_commercial_opportunity_id is not null and not exists (
    select 1
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = p_commercial_opportunity_id
      and opportunity_row.organization_id = p_organization_id
      and opportunity_row.store_id = p_store_id
      and (opportunity_row.origin_lead_id is null or opportunity_row.origin_lead_id = p_lead_id)
      and (opportunity_row.primary_conversation_id is null or opportunity_row.primary_conversation_id = p_conversation_id)
  ) then
    raise exception using errcode = '23503',
      message = 'ZION_HUMAN_COMMON_APPOINTMENT_OPPORTUNITY_SCOPE_NOT_FOUND';
  end if;

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'organization_id', p_organization_id,
          'store_id', p_store_id,
          'lead_id', p_lead_id,
          'conversation_id', p_conversation_id,
          'title', pg_catalog.btrim(coalesce(p_title, '')),
          'appointment_type', p_appointment_type,
          'status', p_status,
          'scheduled_start', p_scheduled_start,
          'scheduled_end', p_scheduled_end,
          'customer_name', p_customer_name,
          'customer_phone', p_customer_phone,
          'address_text', p_address_text,
          'notes', p_notes,
          'commercial_opportunity_id', p_commercial_opportunity_id
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.p9_human_common_appointment_operations (
    organization_id, store_id, lead_id, conversation_id,
    commercial_opportunity_id, actor_user_id, operation_key,
    request_fingerprint
  ) values (
    p_organization_id, p_store_id, p_lead_id, p_conversation_id,
    p_commercial_opportunity_id, v_user_id, pg_catalog.btrim(p_operation_key),
    v_fingerprint
  ) on conflict (organization_id, operation_key) do nothing;

  select * into v_operation
  from public.p9_human_common_appointment_operations operation_row
  where operation_row.organization_id = p_organization_id
    and operation_row.operation_key = pg_catalog.btrim(p_operation_key)
  for update;

  if v_operation.actor_user_id is distinct from v_user_id
     or v_operation.store_id is distinct from p_store_id
     or v_operation.request_fingerprint is distinct from v_fingerprint
     or v_operation.lead_id is distinct from p_lead_id
     or v_operation.conversation_id is distinct from p_conversation_id
     or v_operation.commercial_opportunity_id is distinct from p_commercial_opportunity_id then
    raise exception using errcode = '23505',
      message = 'ZION_HUMAN_COMMON_APPOINTMENT_OPERATION_KEY_REUSED';
  end if;

  if v_operation.appointment_id is not null then
    select * into v_appointment
    from public.store_appointments appointment_row
    where appointment_row.id = v_operation.appointment_id
      and appointment_row.organization_id = p_organization_id
      and appointment_row.store_id = p_store_id;
    if not found then
      raise exception using errcode = '23503',
        message = 'ZION_HUMAN_COMMON_APPOINTMENT_RESULT_SCOPE_NOT_FOUND';
    end if;
    return v_appointment;
  end if;

  select * into v_appointment
  from public.create_store_appointment_with_commercial_context(
    p_organization_id, p_store_id, p_lead_id, p_conversation_id,
    p_title, p_appointment_type, p_status, p_scheduled_start,
    p_scheduled_end, p_customer_name, p_customer_phone, p_address_text,
    p_notes, 'panel', v_user_id, p_commercial_opportunity_id
  );

  update public.p9_human_common_appointment_operations operation_row
  set appointment_id = v_appointment.id,
      completed_at = pg_catalog.clock_timestamp()
  where operation_row.id = v_operation.id
    and operation_row.appointment_id is null;

  if not found then
    raise exception using errcode = '40001',
      message = 'ZION_HUMAN_COMMON_APPOINTMENT_COMPLETION_RACE';
  end if;

  return v_appointment;
end;
$function$;

alter function public.create_common_appointment_by_user(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text, uuid, text
) owner to postgres;
revoke all on function public.create_common_appointment_by_user(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text, uuid, text
) from public, anon, service_role;
grant execute on function public.create_common_appointment_by_user(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text, uuid, text
) to authenticated;

commit;
