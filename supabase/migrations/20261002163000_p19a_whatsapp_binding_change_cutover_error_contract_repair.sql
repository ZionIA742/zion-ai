begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public;

-- P19-A 4.8 repair: preserve intentional 23505 business-contract errors
-- instead of collapsing them into the generic concurrent-conflict error.
create or replace function public.cutover_whatsapp_binding_change_request_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_provider text,
  p_request_id uuid,
  p_cutover_idempotency_key text,
  p_expected_active_integration_id uuid,
  p_expected_candidate_whatsapp_business_account_id text,
  p_expected_candidate_phone_number_id text,
  p_expected_candidate_display_phone_number text,
  p_provenance jsonb default '{}'::jsonb
)
returns table (
  request_id uuid,
  outcome text,
  status text,
  active_integration_id uuid,
  provider text,
  phone_number_id text,
  whatsapp_business_account_id text,
  display_phone_number text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_request public.whatsapp_binding_change_requests%rowtype;
  v_active public.external_integrations%rowtype;
  v_active_id uuid;
  v_initial_status text;
  v_candidate_conflict boolean;
  v_key text := nullif(pg_catalog.btrim(coalesce(p_cutover_idempotency_key, '')), '');
  v_candidate_waba text := nullif(pg_catalog.btrim(coalesce(p_expected_candidate_whatsapp_business_account_id, '')), '');
  v_candidate_phone text := nullif(pg_catalog.btrim(coalesce(p_expected_candidate_phone_number_id, '')), '');
  v_candidate_display text := nullif(pg_catalog.btrim(coalesce(p_expected_candidate_display_phone_number, '')), '');
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_safe_metadata jsonb;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_provider is distinct from 'whatsapp'
     or p_request_id is null
     or p_expected_active_integration_id is null
     or v_key is null
     or v_candidate_waba is null
     or v_candidate_phone is null
     or v_candidate_display is null then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_CUTOVER_INPUT_REQUIRED';
  end if;

  if coalesce(p_provenance, '{}'::jsonb)::text ~*
     '"(access[_-]?token|refresh[_-]?token|token|authorization[_-]?code|authorization|code|bearer|app[_-]?secret|client[_-]?secret|client[_-]?token|api[_-]?key|password|secret)"[[:space:]]*:' then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_PROVENANCE_SECRET_FORBIDDEN';
  end if;

  -- First read is deliberately unlocked. Terminal replays lock only the request;
  -- non-terminal cutover work locks the active integration first and then the
  -- request, keeping one stable order for the two rows touched by cutover.
  select change_row.active_integration_id, change_row.status
    into v_active_id, v_initial_status
    from public.whatsapp_binding_change_requests change_row
   where change_row.id = p_request_id
     and change_row.organization_id = p_organization_id
     and change_row.store_id = p_store_id
     and change_row.provider = p_provider;

  if not found then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_REQUEST_NOT_FOUND';
  end if;

  if v_active_id is distinct from p_expected_active_integration_id then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_EXPECTED_BINDING_MISMATCH';
  end if;

  if v_initial_status in ('completed', 'failed', 'cancelled', 'expired') then
    select change_row.*
      into v_request
      from public.whatsapp_binding_change_requests change_row
     where change_row.id = p_request_id
       and change_row.organization_id = p_organization_id
       and change_row.store_id = p_store_id
       and change_row.provider = p_provider
     for update;

    if not found then
      raise exception using errcode = '23514',
        message = 'ZION_WHATSAPP_CHANGE_REQUEST_NOT_FOUND';
    end if;

    if v_request.status = 'completed' then
      if v_request.cutover_idempotency_key is distinct from v_key
         or v_request.candidate_whatsapp_business_account_id is distinct from v_candidate_waba
         or v_request.candidate_phone_number_id is distinct from v_candidate_phone
         or v_request.candidate_display_phone_number is distinct from v_candidate_display
         or v_request.completed_whatsapp_business_account_id is distinct from v_candidate_waba
         or v_request.completed_phone_number_id is distinct from v_candidate_phone
         or v_request.completed_display_phone_number is distinct from v_candidate_display then
        raise exception using errcode = '23505',
          message = 'ZION_WHATSAPP_CHANGE_CUTOVER_IDEMPOTENCY_CONFLICT';
      end if;

      return query
      select
        v_request.id,
        'idempotent_replay'::text,
        v_request.status,
        v_request.active_integration_id,
        v_request.provider,
        v_request.completed_phone_number_id,
        v_request.completed_whatsapp_business_account_id,
        v_request.completed_display_phone_number;
      return;
    end if;

    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_TERMINAL_REQUEST';
  end if;

  select integration_row.*
    into v_active
    from public.external_integrations integration_row
   where integration_row.id = v_active_id
     and integration_row.organization_id = p_organization_id
     and integration_row.store_id = p_store_id
     and integration_row.provider = p_provider
   for update;

  if not found then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_ACTIVE_BINDING_MISSING';
  end if;

  select change_row.*
    into v_request
    from public.whatsapp_binding_change_requests change_row
   where change_row.id = p_request_id
     and change_row.organization_id = p_organization_id
     and change_row.store_id = p_store_id
     and change_row.provider = p_provider
   for update;

  if not found then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_REQUEST_NOT_FOUND';
  end if;

  if v_request.active_integration_id is distinct from v_active.id
     or v_request.active_integration_id is distinct from p_expected_active_integration_id then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_EXPECTED_BINDING_MISMATCH';
  end if;

  -- The request may have become terminal while we were acquiring the active row.
  if v_request.status = 'completed' then
    if v_request.cutover_idempotency_key is distinct from v_key
       or v_request.candidate_whatsapp_business_account_id is distinct from v_candidate_waba
       or v_request.candidate_phone_number_id is distinct from v_candidate_phone
       or v_request.candidate_display_phone_number is distinct from v_candidate_display
       or v_request.completed_whatsapp_business_account_id is distinct from v_candidate_waba
       or v_request.completed_phone_number_id is distinct from v_candidate_phone
       or v_request.completed_display_phone_number is distinct from v_candidate_display then
      raise exception using errcode = '23505',
        message = 'ZION_WHATSAPP_CHANGE_CUTOVER_IDEMPOTENCY_CONFLICT';
    end if;

    return query
    select
      v_request.id,
      'idempotent_replay'::text,
      v_request.status,
      v_request.active_integration_id,
      v_request.provider,
      v_request.completed_phone_number_id,
      v_request.completed_whatsapp_business_account_id,
      v_request.completed_display_phone_number;
    return;
  end if;

  if v_request.status in ('failed', 'cancelled', 'expired') then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_TERMINAL_REQUEST';
  end if;

  if v_request.status <> 'ready_to_cutover' then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_NOT_READY_TO_CUTOVER';
  end if;

  if v_request.expires_at <= v_now then
    update public.whatsapp_binding_change_requests
       set status = 'expired',
           terminal_at = v_now,
           terminal_provenance = pg_catalog.jsonb_strip_nulls(
             coalesce(p_provenance, '{}'::jsonb)
             || pg_catalog.jsonb_build_object('reason', 'expires_at_reached')
           ),
           updated_at = v_now
     where id = v_request.id;

    return query
    select
      v_request.id,
      'expired'::text,
      'expired'::text,
      v_request.active_integration_id,
      p_provider,
      null::text,
      null::text,
      null::text;
    return;
  end if;

  if v_request.active_phone_number_id_snapshot is null
     or v_request.active_whatsapp_business_account_id_snapshot is null
     or v_request.active_display_phone_number_snapshot is null
     or v_request.candidate_whatsapp_business_account_id is distinct from v_candidate_waba
     or v_request.candidate_phone_number_id is distinct from v_candidate_phone
     or v_request.candidate_display_phone_number is distinct from v_candidate_display then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_EXPECTED_BINDING_MISMATCH';
  end if;

  if v_active.status <> 'active'
     or v_active.is_active is not true
     or v_active.phone_number_id is distinct from v_request.active_phone_number_id_snapshot
     or v_active.whatsapp_business_account_id is distinct from v_request.active_whatsapp_business_account_id_snapshot
     or v_active.display_phone_number is distinct from v_request.active_display_phone_number_snapshot then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_ACTIVE_BINDING_STALE';
  end if;

  if nullif(pg_catalog.btrim(coalesce(v_active.access_token, '')), '') is null then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_ACTIVE_TOKEN_REQUIRED';
  end if;

  if v_candidate_waba is distinct from v_active.whatsapp_business_account_id then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_WABA_CHANGE_REQUIRES_NEW_TOKEN';
  end if;

  select exists (
    select 1
      from public.external_integrations integration_row
     where integration_row.provider = p_provider
       and integration_row.phone_number_id = v_candidate_phone
       and integration_row.id <> v_active.id
  )
  into v_candidate_conflict;

  if v_candidate_conflict then
    raise exception using errcode = '23505',
      message = 'ZION_WHATSAPP_CHANGE_CANDIDATE_PHONE_ALREADY_BOUND';
  end if;

  v_safe_metadata :=
    coalesce(v_active.metadata, '{}'::jsonb)
    - 'access_token'
    - 'refresh_token'
    - 'token'
    - 'code'
    - 'authorization_code'
    - 'authorization'
    - 'bearer'
    - 'app_secret'
    - 'client_secret'
    - 'client_token'
    - 'api_key'
    - 'password'
    - 'secret';

  update public.external_integrations
     set whatsapp_business_account_id = v_candidate_waba,
         phone_number_id = v_candidate_phone,
         display_phone_number = v_candidate_display,
         status = 'active',
         is_active = true,
         last_error = null,
         metadata = pg_catalog.jsonb_strip_nulls(
           v_safe_metadata
           || pg_catalog.jsonb_build_object(
             'binding_change_request_id', v_request.id,
             'binding_change_previous_phone_number_id', v_active.phone_number_id,
             'binding_change_previous_display_phone_number', v_active.display_phone_number,
             'binding_change_cutover_at', v_now,
             'binding_change_provenance', coalesce(p_provenance, '{}'::jsonb)
           )
         ),
         updated_at = v_now
   where id = v_active.id;

  update public.whatsapp_binding_change_requests
     set status = 'completed',
         cutover_idempotency_key = v_key,
         cutover_provenance = pg_catalog.jsonb_strip_nulls(
           coalesce(p_provenance, '{}'::jsonb)
           || pg_catalog.jsonb_build_object(
             'previous_phone_number_id', v_active.phone_number_id,
             'previous_display_phone_number', v_active.display_phone_number,
             'cutover_at', v_now
           )
         ),
         completed_phone_number_id = v_candidate_phone,
         completed_whatsapp_business_account_id = v_candidate_waba,
         completed_display_phone_number = v_candidate_display,
         completed_at = v_now,
         terminal_at = v_now,
         updated_at = v_now
   where id = v_request.id;

  return query
  select
    v_request.id,
    'cutover_completed'::text,
    'completed'::text,
    v_active.id,
    v_active.provider,
    v_candidate_phone,
    v_candidate_waba,
    v_candidate_display;

exception
  when unique_violation then
    if sqlerrm in (
      'ZION_WHATSAPP_CHANGE_CUTOVER_IDEMPOTENCY_CONFLICT',
      'ZION_WHATSAPP_CHANGE_CANDIDATE_PHONE_ALREADY_BOUND'
    ) then
      raise;
    end if;

    raise exception using errcode = '23505',
      message = 'ZION_WHATSAPP_CHANGE_CUTOVER_CONCURRENT_CONFLICT';
end;
$function$;

comment on function public.cutover_whatsapp_binding_change_request_by_system(uuid, uuid, text, uuid, text, uuid, text, text, text, jsonb) is
  'P19-A 4.8: atomically validates and promotes the request candidate in the sole store/provider integration row. Replays are idempotent; intentional idempotency/candidate-binding conflicts retain their canonical errors; native unique races map to concurrent conflict.';

commit;
