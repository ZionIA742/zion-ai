-- P19-A Bloco 4.7: represent a controlled WhatsApp binding change before cutover.
-- The active operational integration remains in public.external_integrations.
-- This migration deliberately does not implement cutover, cancellation, expiry,
-- recovery, or deactivation of the previous number (those belong to 4.8).

create table if not exists public.whatsapp_binding_change_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  provider text not null default 'whatsapp',
  source text not null,
  idempotency_key text not null,
  status text not null default 'requested',
  active_integration_id uuid not null,
  candidate_whatsapp_business_account_id text,
  candidate_phone_number_id text,
  candidate_display_phone_number text,
  candidate_provenance jsonb not null default '{}'::jsonb,
  candidate_received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_binding_change_requests_provider_check
    check (provider = 'whatsapp'),
  constraint whatsapp_binding_change_requests_status_check
    check (status in (
      'requested',
      'awaiting_customer_authorization',
      'customer_authorizing',
      'candidate_received',
      'validating',
      'ready_to_cutover',
      'completed',
      'failed',
      'cancelled',
      'expired'
    )),
  constraint whatsapp_binding_change_requests_candidate_pair_check
    check (
      (candidate_whatsapp_business_account_id is null
        and candidate_phone_number_id is null
        and candidate_display_phone_number is null)
      or
      (candidate_whatsapp_business_account_id is not null
        and candidate_phone_number_id is not null
        and candidate_display_phone_number is not null)
    )
);

create unique index if not exists whatsapp_binding_change_requests_idempotency_uidx
  on public.whatsapp_binding_change_requests (organization_id, store_id, provider, idempotency_key);

create unique index if not exists whatsapp_binding_change_requests_active_uidx
  on public.whatsapp_binding_change_requests (organization_id, store_id, provider)
  where status in (
    'requested',
    'awaiting_customer_authorization',
    'customer_authorizing',
    'candidate_received',
    'validating',
    'ready_to_cutover'
  );

create index if not exists whatsapp_binding_change_requests_scope_idx
  on public.whatsapp_binding_change_requests (organization_id, store_id, created_at desc);

create or replace function public.materialize_whatsapp_binding_candidate_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_source text,
  p_idempotency_key text,
  p_whatsapp_business_account_id text,
  p_phone_number_id text,
  p_display_phone_number text,
  p_provenance jsonb default '{}'::jsonb
)
returns table (
  request_id uuid,
  outcome text,
  status text,
  active_integration_id uuid,
  candidate_phone_number_id text,
  candidate_whatsapp_business_account_id text,
  candidate_display_phone_number text
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_active_count integer;
  v_active_id uuid;
  v_active public.external_integrations%rowtype;
  v_request public.whatsapp_binding_change_requests%rowtype;
  v_waba text := nullif(btrim(coalesce(p_whatsapp_business_account_id, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone_number_id, '')), '');
  v_display text := nullif(btrim(coalesce(p_display_phone_number, '')), '');
  v_source text := nullif(btrim(coalesce(p_source, '')), '');
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_SCOPE_REQUIRED';
  end if;

  if v_source is null or v_key is null or v_waba is null or v_phone is null or v_display is null then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_CANDIDATE_REQUIRED';
  end if;

  if coalesce(p_provenance, '{}'::jsonb)::text ~* '"(access_token|token|app_secret|client_secret|password)"' then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_PROVENANCE_SECRET_FORBIDDEN';
  end if;

  perform 1
    from public.stores store_row
   where store_row.id = p_store_id
     and store_row.organization_id = p_organization_id
   for key share;
  if not found then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_STORE_SCOPE_MISMATCH';
  end if;

  select count(*)
    into v_active_count
    from public.external_integrations integration_row
   where integration_row.organization_id = p_organization_id
     and integration_row.store_id = p_store_id
     and integration_row.provider = 'whatsapp'
     and integration_row.status = 'active'
     and integration_row.is_active is true;

  if v_active_count = 0 then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_REQUIRES_ACTIVE_BINDING';
  elsif v_active_count <> 1 then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_ACTIVE_BINDING_AMBIGUOUS';
  end if;

  select integration_row.id
    into v_active_id
    from public.external_integrations integration_row
   where integration_row.organization_id = p_organization_id
     and integration_row.store_id = p_store_id
     and integration_row.provider = 'whatsapp'
     and integration_row.status = 'active'
     and integration_row.is_active is true
   for update;

  select integration_row.*
    into v_active
    from public.external_integrations integration_row
   where integration_row.id = v_active_id
   for update;

  if v_active.phone_number_id is not distinct from v_phone then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_NOT_REQUIRED';
  end if;

  perform 1
    from public.external_integrations integration_row
   where integration_row.provider = 'whatsapp'
     and integration_row.phone_number_id = v_phone
     and integration_row.id <> v_active.id;
  if found then
    raise exception using errcode = '23505',
      message = 'ZION_WHATSAPP_CHANGE_CANDIDATE_PHONE_ALREADY_BOUND';
  end if;

  select change_row.*
    into v_request
    from public.whatsapp_binding_change_requests change_row
   where change_row.organization_id = p_organization_id
     and change_row.store_id = p_store_id
     and change_row.provider = 'whatsapp'
     and change_row.idempotency_key = v_key
   for update;

  if found then
    if v_request.active_integration_id is distinct from v_active.id then
      raise exception using errcode = '23514',
        message = 'ZION_WHATSAPP_CHANGE_ACTIVE_BINDING_CHANGED';
    end if;

    if v_request.candidate_phone_number_id is not null then
      if v_request.candidate_phone_number_id is distinct from v_phone
         or v_request.candidate_whatsapp_business_account_id is distinct from v_waba
         or v_request.candidate_display_phone_number is distinct from v_display then
        raise exception using errcode = '23505',
          message = 'ZION_WHATSAPP_CHANGE_CANDIDATE_CONFLICT';
      end if;

      return query
      select v_request.id, 'idempotent_replay'::text, v_request.status,
             v_request.active_integration_id, v_request.candidate_phone_number_id,
             v_request.candidate_whatsapp_business_account_id,
             v_request.candidate_display_phone_number;
      return;
    end if;
  else
    begin
      insert into public.whatsapp_binding_change_requests (
        organization_id, store_id, provider, source, idempotency_key,
        status, active_integration_id, candidate_provenance
      ) values (
        p_organization_id, p_store_id, 'whatsapp', v_source, v_key,
        'requested', v_active.id, coalesce(p_provenance, '{}'::jsonb)
      )
      returning * into v_request;
    exception when unique_violation then
      select change_row.*
        into v_request
        from public.whatsapp_binding_change_requests change_row
       where change_row.organization_id = p_organization_id
         and change_row.store_id = p_store_id
         and change_row.provider = 'whatsapp'
         and change_row.idempotency_key = v_key
       for update;

      if not found then
        raise exception using errcode = '23505',
          message = 'ZION_WHATSAPP_CHANGE_CONCURRENT_CONFLICT';
      end if;

      if v_request.active_integration_id is distinct from v_active.id then
        raise exception using errcode = '23514',
          message = 'ZION_WHATSAPP_CHANGE_ACTIVE_BINDING_CHANGED';
      end if;

      if v_request.candidate_phone_number_id is not null then
        if v_request.candidate_phone_number_id is distinct from v_phone
           or v_request.candidate_whatsapp_business_account_id is distinct from v_waba
           or v_request.candidate_display_phone_number is distinct from v_display then
          raise exception using errcode = '23505',
            message = 'ZION_WHATSAPP_CHANGE_CANDIDATE_CONFLICT';
        end if;

        return query
        select v_request.id, 'idempotent_replay'::text, v_request.status,
               v_request.active_integration_id, v_request.candidate_phone_number_id,
               v_request.candidate_whatsapp_business_account_id,
               v_request.candidate_display_phone_number;
        return;
      end if;
    end;
  end if;

  update public.whatsapp_binding_change_requests
     set status = 'candidate_received',
         candidate_whatsapp_business_account_id = v_waba,
         candidate_phone_number_id = v_phone,
         candidate_display_phone_number = v_display,
         candidate_provenance = coalesce(p_provenance, '{}'::jsonb),
         candidate_received_at = coalesce(candidate_received_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where id = v_request.id
  returning * into v_request;

  return query
  select v_request.id, 'candidate_materialized'::text, v_request.status,
         v_request.active_integration_id, v_request.candidate_phone_number_id,
         v_request.candidate_whatsapp_business_account_id,
         v_request.candidate_display_phone_number;
end;
$function$;

create or replace function public.advance_whatsapp_binding_change_request_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_request_id uuid,
  p_next_status text
)
returns table (request_id uuid, status text)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_request public.whatsapp_binding_change_requests%rowtype;
  v_allowed boolean := false;
  v_result_id uuid;
  v_result_status text;
begin
  select change_row.* into v_request
    from public.whatsapp_binding_change_requests change_row
   where change_row.id = p_request_id
     and change_row.organization_id = p_organization_id
     and change_row.store_id = p_store_id
     and change_row.provider = 'whatsapp'
   for update;

  if not found then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_REQUEST_NOT_FOUND';
  end if;

  if p_next_status = v_request.status then
    return query select v_request.id, v_request.status;
    return;
  end if;

  v_allowed :=
    (v_request.status = 'requested' and p_next_status in ('awaiting_customer_authorization', 'customer_authorizing'))
    or (v_request.status = 'awaiting_customer_authorization' and p_next_status = 'customer_authorizing')
    or (v_request.status = 'customer_authorizing' and p_next_status = 'candidate_received')
    or (v_request.status = 'candidate_received' and p_next_status = 'validating')
    or (v_request.status = 'validating' and p_next_status = 'ready_to_cutover');

  if not v_allowed then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_STATE_TRANSITION_INVALID';
  end if;

  if p_next_status in ('validating', 'ready_to_cutover')
     and v_request.candidate_phone_number_id is null then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_CANDIDATE_REQUIRED';
  end if;

  update public.whatsapp_binding_change_requests
     set status = p_next_status, updated_at = clock_timestamp()
   where id = v_request.id
  returning id, status into v_result_id, v_result_status;

  request_id := v_result_id;
  status := v_result_status;

  return next;
end;
$function$;

alter function public.materialize_whatsapp_binding_candidate_by_system(
  uuid, uuid, text, text, text, text, text, jsonb
) owner to postgres;

alter function public.advance_whatsapp_binding_change_request_by_system(
  uuid, uuid, uuid, text
) owner to postgres;

revoke all on table public.whatsapp_binding_change_requests from public, anon, authenticated;
revoke all on function public.materialize_whatsapp_binding_candidate_by_system(
  uuid, uuid, text, text, text, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.advance_whatsapp_binding_change_request_by_system(
  uuid, uuid, uuid, text
) from public, anon, authenticated;

grant execute on function public.materialize_whatsapp_binding_candidate_by_system(
  uuid, uuid, text, text, text, text, text, jsonb
) to service_role;
grant execute on function public.advance_whatsapp_binding_change_request_by_system(
  uuid, uuid, uuid, text
) to service_role;

comment on table public.whatsapp_binding_change_requests is
  'P19-A 4.7 pre-cutover WhatsApp binding change requests. Candidate identifiers are isolated here; active authority remains external_integrations. 4.8 owns cutover and terminal behavior.';

comment on function public.materialize_whatsapp_binding_candidate_by_system(
  uuid, uuid, text, text, text, text, text, jsonb
) is
  'P19-A 4.7: idempotently records a pre-cutover candidate without changing the active WhatsApp integration or storing a second secret.';

comment on function public.advance_whatsapp_binding_change_request_by_system(
  uuid, uuid, uuid, text
) is
  'P19-A 4.7: advances only safe pre-cutover states. Cutover, cancellation, expiry, recovery, and completed transitions belong to 4.8.';
