begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public;

do $preflight$
begin
  if pg_catalog.to_regclass('public.whatsapp_binding_change_requests') is null then
    raise exception using errcode = 'P0001',
      message = 'whatsapp_binding_change_requests is required';
  end if;

  if pg_catalog.to_regclass('public.external_integrations') is null then
    raise exception using errcode = 'P0001',
      message = 'external_integrations is required';
  end if;

  if pg_catalog.to_regclass('public.external_integrations_whatsapp_phone_number_uidx') is null then
    raise exception using errcode = 'P0001',
      message = 'external_integrations_whatsapp_phone_number_uidx is required';
  end if;

  if pg_catalog.to_regclass('public.whatsapp_binding_change_requests_active_uidx') is null then
    raise exception using errcode = 'P0001',
      message = 'whatsapp_binding_change_requests_active_uidx is required';
  end if;

  if pg_catalog.to_regprocedure(
       'public.materialize_whatsapp_binding_candidate_by_system(uuid,uuid,text,text,text,text,text,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.advance_whatsapp_binding_change_request_by_system(uuid,uuid,uuid,text)'
     ) is null then
    raise exception using errcode = 'P0001',
      message = 'P19-A 4.7 WhatsApp binding-change foundation is required';
  end if;

  if pg_catalog.to_regprocedure(
       'public.materialize_store_whatsapp_embedded_signup_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)'
     ) is null then
    raise exception using errcode = 'P0001',
      message = 'canonical first-connection WhatsApp writer is required';
  end if;
end;
$preflight$;

-- P19-A 4.8 owns terminal behavior and cutover. The active integration remains
-- the single row in public.external_integrations. Candidate identifiers remain
-- in public.whatsapp_binding_change_requests until an atomic cutover completes.
--
-- There is intentionally no candidate token column in this contract. Reusing
-- external_integrations.access_token is allowed only when the candidate belongs
-- to the same WABA as the locked active integration. A WABA change therefore
-- fails closed and must use a future flow that materializes a compatible token.

alter table public.whatsapp_binding_change_requests
  add column if not exists active_phone_number_id_snapshot text,
  add column if not exists active_whatsapp_business_account_id_snapshot text,
  add column if not exists active_display_phone_number_snapshot text,
  add column if not exists expires_at timestamptz,
  add column if not exists cutover_idempotency_key text,
  add column if not exists cutover_provenance jsonb not null default '{}'::jsonb,
  add column if not exists completed_phone_number_id text,
  add column if not exists completed_whatsapp_business_account_id text,
  add column if not exists completed_display_phone_number text,
  add column if not exists completed_at timestamptz,
  add column if not exists terminal_provenance jsonb not null default '{}'::jsonb,
  add column if not exists terminal_at timestamptz;

-- Backfill only from the exact scoped active-integration identity captured by
-- 4.7. Do not silently cross organization/store/provider boundaries.
update public.whatsapp_binding_change_requests change_row
   set active_phone_number_id_snapshot = integration_row.phone_number_id,
       active_whatsapp_business_account_id_snapshot = integration_row.whatsapp_business_account_id,
       active_display_phone_number_snapshot = integration_row.display_phone_number,
       expires_at = coalesce(change_row.expires_at, change_row.created_at + interval '24 hours'),
       updated_at = change_row.updated_at
  from public.external_integrations integration_row
 where change_row.active_integration_id = integration_row.id
   and change_row.organization_id = integration_row.organization_id
   and change_row.store_id = integration_row.store_id
   and change_row.provider = integration_row.provider
   and (
     change_row.active_phone_number_id_snapshot is null
     or change_row.active_whatsapp_business_account_id_snapshot is null
     or change_row.active_display_phone_number_snapshot is null
   );

update public.whatsapp_binding_change_requests
   set expires_at = coalesce(expires_at, created_at + interval '24 hours')
 where expires_at is null;

-- 4.7 did not own terminal behavior, but make a pre-existing completed row
-- readable if one was created administratively before this migration.
update public.whatsapp_binding_change_requests
   set completed_phone_number_id = coalesce(
         completed_phone_number_id,
         candidate_phone_number_id
       ),
       completed_whatsapp_business_account_id = coalesce(
         completed_whatsapp_business_account_id,
         candidate_whatsapp_business_account_id
       ),
       completed_display_phone_number = coalesce(
         completed_display_phone_number,
         candidate_display_phone_number
       ),
       completed_at = coalesce(completed_at, updated_at, created_at),
       terminal_at = coalesce(terminal_at, updated_at, created_at)
 where status = 'completed';

do $snapshot_backfill_guard$
begin
  if exists (
    select 1
      from public.whatsapp_binding_change_requests change_row
     where change_row.status in (
       'requested',
       'awaiting_customer_authorization',
       'customer_authorizing',
       'candidate_received',
       'validating',
       'ready_to_cutover'
     )
       and (
         change_row.active_phone_number_id_snapshot is null
         or change_row.active_whatsapp_business_account_id_snapshot is null
         or change_row.active_display_phone_number_snapshot is null
       )
  ) then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_ACTIVE_SNAPSHOT_BACKFILL_FAILED';
  end if;
end;
$snapshot_backfill_guard$;

-- Expiration is intentionally defined by request creation time. 4.7 had no TTL;
-- the fixed 24-hour default is introduced here by 4.8.
alter table public.whatsapp_binding_change_requests
  alter column expires_at drop default,
  alter column expires_at set not null;

create unique index if not exists whatsapp_binding_change_requests_cutover_key_uidx
  on public.whatsapp_binding_change_requests
    (organization_id, store_id, provider, cutover_idempotency_key)
  where cutover_idempotency_key is not null;

create or replace function public.snapshot_whatsapp_binding_change_active_by_system()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_active public.external_integrations%rowtype;
  v_has_supplied_snapshot boolean;
begin
  select integration_row.*
    into v_active
    from public.external_integrations integration_row
   where integration_row.id = new.active_integration_id
     and integration_row.organization_id = new.organization_id
     and integration_row.store_id = new.store_id
     and integration_row.provider = new.provider
     and integration_row.status = 'active'
     and integration_row.is_active is true
   for key share;

  if not found then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_ACTIVE_BINDING_REQUIRED';
  end if;

  v_has_supplied_snapshot :=
    new.active_phone_number_id_snapshot is not null
    or new.active_whatsapp_business_account_id_snapshot is not null
    or new.active_display_phone_number_snapshot is not null;

  if v_has_supplied_snapshot
     and (
       new.active_phone_number_id_snapshot is distinct from v_active.phone_number_id
       or new.active_whatsapp_business_account_id_snapshot is distinct from v_active.whatsapp_business_account_id
       or new.active_display_phone_number_snapshot is distinct from v_active.display_phone_number
     ) then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_ACTIVE_SNAPSHOT_MISMATCH';
  end if;

  new.active_phone_number_id_snapshot := v_active.phone_number_id;
  new.active_whatsapp_business_account_id_snapshot := v_active.whatsapp_business_account_id;
  new.active_display_phone_number_snapshot := v_active.display_phone_number;
  new.expires_at := coalesce(new.expires_at, new.created_at + interval '24 hours');

  return new;
end;
$function$;

drop trigger if exists whatsapp_binding_change_active_snapshot_trg
  on public.whatsapp_binding_change_requests;

create trigger whatsapp_binding_change_active_snapshot_trg
before insert on public.whatsapp_binding_change_requests
for each row
execute function public.snapshot_whatsapp_binding_change_active_by_system();

create or replace function public.guard_whatsapp_binding_change_terminal_immutability_by_system()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if old.status in ('completed', 'failed', 'cancelled', 'expired')
     and pg_catalog.to_jsonb(new) is distinct from pg_catalog.to_jsonb(old) then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_TERMINAL_IMMUTABLE';
  end if;

  return new;
end;
$function$;

drop trigger if exists whatsapp_binding_change_terminal_immutability_trg
  on public.whatsapp_binding_change_requests;

create trigger whatsapp_binding_change_terminal_immutability_trg
before update on public.whatsapp_binding_change_requests
for each row
execute function public.guard_whatsapp_binding_change_terminal_immutability_by_system();

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
    raise exception using errcode = '23505',
      message = 'ZION_WHATSAPP_CHANGE_CUTOVER_CONCURRENT_CONFLICT';
end;
$function$;

create or replace function public.cancel_whatsapp_binding_change_request_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_provider text,
  p_request_id uuid,
  p_provenance jsonb default '{}'::jsonb
)
returns table (
  request_id uuid,
  outcome text,
  status text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_request public.whatsapp_binding_change_requests%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_organization_id is null
     or p_store_id is null
     or p_request_id is null
     or p_provider is distinct from 'whatsapp' then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_CANCEL_INPUT_REQUIRED';
  end if;

  if coalesce(p_provenance, '{}'::jsonb)::text ~*
     '"(access[_-]?token|refresh[_-]?token|token|authorization[_-]?code|authorization|code|bearer|app[_-]?secret|client[_-]?secret|client[_-]?token|api[_-]?key|password|secret)"[[:space:]]*:' then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_PROVENANCE_SECRET_FORBIDDEN';
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

  if v_request.status = 'cancelled' then
    return query
    select v_request.id, 'idempotent_replay'::text, v_request.status;
    return;
  end if;

  if v_request.status in ('completed', 'failed', 'expired') then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_TERMINAL_REQUEST';
  end if;

  update public.whatsapp_binding_change_requests
     set status = 'cancelled',
         terminal_at = v_now,
         terminal_provenance = pg_catalog.jsonb_strip_nulls(coalesce(p_provenance, '{}'::jsonb)),
         updated_at = v_now
   where id = v_request.id;

  return query
  select v_request.id, 'cancelled'::text, 'cancelled'::text;
end;
$function$;

create or replace function public.expire_whatsapp_binding_change_request_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_provider text,
  p_request_id uuid,
  p_provenance jsonb default '{}'::jsonb
)
returns table (
  request_id uuid,
  outcome text,
  status text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_request public.whatsapp_binding_change_requests%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_organization_id is null
     or p_store_id is null
     or p_request_id is null
     or p_provider is distinct from 'whatsapp' then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_EXPIRE_INPUT_REQUIRED';
  end if;

  if coalesce(p_provenance, '{}'::jsonb)::text ~*
     '"(access[_-]?token|refresh[_-]?token|token|authorization[_-]?code|authorization|code|bearer|app[_-]?secret|client[_-]?secret|client[_-]?token|api[_-]?key|password|secret)"[[:space:]]*:' then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_PROVENANCE_SECRET_FORBIDDEN';
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

  if v_request.status = 'expired' then
    return query
    select v_request.id, 'idempotent_replay'::text, v_request.status;
    return;
  end if;

  if v_request.status in ('completed', 'failed', 'cancelled') then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_TERMINAL_REQUEST';
  end if;

  if v_request.expires_at > v_now then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_CHANGE_NOT_EXPIRED';
  end if;

  update public.whatsapp_binding_change_requests
     set status = 'expired',
         terminal_at = v_now,
         terminal_provenance = pg_catalog.jsonb_strip_nulls(coalesce(p_provenance, '{}'::jsonb)),
         updated_at = v_now
   where id = v_request.id;

  return query
  select v_request.id, 'expired'::text, 'expired'::text;
end;
$function$;

alter function public.snapshot_whatsapp_binding_change_active_by_system() owner to postgres;
alter function public.guard_whatsapp_binding_change_terminal_immutability_by_system() owner to postgres;
alter function public.cutover_whatsapp_binding_change_request_by_system(
  uuid, uuid, text, uuid, text, uuid, text, text, text, jsonb
) owner to postgres;
alter function public.cancel_whatsapp_binding_change_request_by_system(
  uuid, uuid, text, uuid, jsonb
) owner to postgres;
alter function public.expire_whatsapp_binding_change_request_by_system(
  uuid, uuid, text, uuid, jsonb
) owner to postgres;

revoke all on function public.snapshot_whatsapp_binding_change_active_by_system()
  from public, anon, authenticated;
revoke all on function public.guard_whatsapp_binding_change_terminal_immutability_by_system()
  from public, anon, authenticated;
revoke all on function public.cutover_whatsapp_binding_change_request_by_system(
  uuid, uuid, text, uuid, text, uuid, text, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.cancel_whatsapp_binding_change_request_by_system(
  uuid, uuid, text, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.expire_whatsapp_binding_change_request_by_system(
  uuid, uuid, text, uuid, jsonb
) from public, anon, authenticated;

grant execute on function public.cutover_whatsapp_binding_change_request_by_system(
  uuid, uuid, text, uuid, text, uuid, text, text, text, jsonb
) to service_role;
grant execute on function public.cancel_whatsapp_binding_change_request_by_system(
  uuid, uuid, text, uuid, jsonb
) to service_role;
grant execute on function public.expire_whatsapp_binding_change_request_by_system(
  uuid, uuid, text, uuid, jsonb
) to service_role;

comment on function public.cutover_whatsapp_binding_change_request_by_system(
  uuid, uuid, text, uuid, text, uuid, text, text, text, jsonb
) is
  'P19-A 4.8: atomically promotes a same-WABA candidate into the sole store/provider integration row. Replays return immutable completed-result snapshots; access_token stays only in external_integrations.';

comment on function public.cancel_whatsapp_binding_change_request_by_system(
  uuid, uuid, text, uuid, jsonb
) is
  'P19-A 4.8: idempotently cancels only pre-cutover requests without changing the active integration.';

comment on function public.expire_whatsapp_binding_change_request_by_system(
  uuid, uuid, text, uuid, jsonb
) is
  'P19-A 4.8: expires only elapsed pre-cutover requests without changing the active integration.';

comment on function public.guard_whatsapp_binding_change_terminal_immutability_by_system() is
  'P19-A 4.8: prevents completed, failed, cancelled, or expired WhatsApp binding-change requests from being mutated or reopened.';

commit;
