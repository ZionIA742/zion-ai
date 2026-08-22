begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('p9_sales_quote_send_canonical_outbound', 0)
);

do $preflight$
begin
  if pg_catalog.to_regclass('public.messages') is null
     or pg_catalog.to_regclass('public.sales_quotes') is null
     or pg_catalog.to_regclass('public.sales_quote_versions') is null
     or pg_catalog.to_regclass('public.store_files') is null
     or pg_catalog.to_regclass('public.conversations') is null
     or pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.conversation_events') is null
     or pg_catalog.to_regclass('public.store_assistant_operational_tasks') is null
     or pg_catalog.to_regprocedure(
       'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.set_current_commercial_proposal_from_sent_quote_by_system(uuid,uuid,uuid,uuid,uuid,text,text)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: required quote outbound objects are missing';
  end if;

  -- Contratos legados precisam existir, mas esta migration NAO os substitui.
  if pg_catalog.to_regprocedure(
       'public.get_pending_external_messages(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.mark_message_external_sent(uuid,text)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: legacy whatsapp outbound functions are missing';
  end if;
end;
$preflight$;

alter table public.messages
  add column if not exists outbound_idempotency_key text,
  add column if not exists outbound_delivery_state text,
  add column if not exists outbound_claimed_at timestamptz,
  add column if not exists outbound_claimed_by text,
  add column if not exists outbound_attempt_started_at timestamptz,
  add column if not exists outbound_provider_accepted_at timestamptz,
  add column if not exists outbound_uncertain_at timestamptz,
  add column if not exists outbound_error_text text,
  add column if not exists outbound_commercial_finalized_at timestamptz,
  add column if not exists outbound_commercial_error_at timestamptz,
  add column if not exists outbound_commercial_error_text text;

alter table public.messages
  drop constraint if exists messages_outbound_delivery_state_check;

alter table public.messages
  add constraint messages_outbound_delivery_state_check
  check (
    outbound_delivery_state is null
    or outbound_delivery_state in ('pending', 'processing', 'sent', 'uncertain', 'failed')
  );

drop index if exists public.messages_org_store_outbound_idempotency_uidx;

create unique index messages_org_store_outbound_idempotency_uidx
  on public.messages (organization_id, store_id, outbound_idempotency_key)
  where outbound_idempotency_key is not null;

-- IMPORTANTE:
-- public.get_pending_external_messages(uuid,uuid) permanece intocada.
-- O worker novo usa apenas a versao v2 abaixo.
create or replace function public.get_pending_external_messages_v2(
  p_organization_id uuid,
  p_store_id uuid,
  p_limit integer default 50,
  p_processing_lease_seconds integer default 600
)
returns table (
  message_id uuid,
  organization_id uuid,
  store_id uuid,
  conversation_id uuid,
  lead_id uuid,
  lead_phone text,
  message_type text,
  content text,
  media_url text,
  metadata jsonb,
  created_at timestamptz,
  external_message_id text,
  outbound_delivery_state text,
  outbound_idempotency_key text,
  outbound_claimed_at timestamptz,
  outbound_attempt_started_at timestamptz,
  outbound_provider_accepted_at timestamptz,
  outbound_commercial_finalized_at timestamptz,
  outbound_commercial_error_text text
)
language sql
security definer
set search_path = pg_catalog, pg_temp, public
as $function$
  select
    message_row.id as message_id,
    message_row.organization_id,
    message_row.store_id,
    message_row.conversation_id,
    conversation_row.lead_id,
    lead_row.phone as lead_phone,
    message_row.message_type,
    message_row.content,
    message_row.media_url,
    coalesce(message_row.metadata, '{}'::jsonb) as metadata,
    message_row.created_at,
    message_row.external_message_id,
    message_row.outbound_delivery_state,
    message_row.outbound_idempotency_key,
    message_row.outbound_claimed_at,
    message_row.outbound_attempt_started_at,
    message_row.outbound_provider_accepted_at,
    message_row.outbound_commercial_finalized_at,
    message_row.outbound_commercial_error_text
  from public.messages as message_row
  join public.conversations as conversation_row
    on conversation_row.id = message_row.conversation_id
   and conversation_row.organization_id = message_row.organization_id
  join public.leads as lead_row
    on lead_row.id = conversation_row.lead_id
   and lead_row.organization_id = message_row.organization_id
   and lead_row.store_id = message_row.store_id
  where message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id
    and (
      message_row.sender = 'ai'
      or (
        message_row.sender = 'human'
        and coalesce(message_row.metadata ->> 'outbound_origin', '') in (
          'crm_manual_text',
          'crm_manual_image',
          'sales_quote_send'
        )
      )
    )
    and message_row.direction = 'outgoing'
    and message_row.external_message_id is null
    and message_row.deleted_at is null
    and message_row.message_type in ('text', 'image', 'document')
    and coalesce(message_row.metadata ->> 'send_external', 'false') = 'true'
    and coalesce(message_row.metadata ->> 'external_channel', '') = 'whatsapp'
    and (
      coalesce(message_row.outbound_delivery_state, 'pending') = 'pending'
      or (
        message_row.outbound_delivery_state = 'processing'
        and message_row.outbound_attempt_started_at is null
        and message_row.outbound_claimed_at is not null
        and message_row.outbound_claimed_at < (
          clock_timestamp()
          - make_interval(
              secs => greatest(coalesce(p_processing_lease_seconds, 600), 1)
            )
        )
      )
    )
  order by
    coalesce(message_row.outbound_claimed_at, message_row.created_at) asc,
    message_row.created_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$function$;

-- IMPORTANTE:
-- public.mark_message_external_sent(uuid,text) permanece intocada.
-- Esta funcao v2 e scoped e pertence apenas ao novo protocolo.

create or replace function public.mark_message_external_sent_v2(
  p_organization_id uuid,
  p_store_id uuid,
  p_message_id uuid,
  p_external_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
  v_now timestamptz := clock_timestamp();
  v_external_message_id text := nullif(btrim(coalesce(p_external_message_id, '')), '');
  v_message public.messages;
begin
  if (v_request_role is distinct from 'service_role') and session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'message external sent v2 is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_message_id is null
     or v_external_message_id is null then
    raise exception using errcode = '22023', message = 'MESSAGE_EXTERNAL_SENT_V2_ARGUMENTS_REQUIRED';
  end if;

  select message_row.*
    into v_message
    from public.messages as message_row
   where message_row.id = p_message_id
     and message_row.organization_id = p_organization_id
     and message_row.store_id = p_store_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'MESSAGE_NOT_FOUND_IN_SCOPE';
  end if;

  if v_message.deleted_at is not null
     or lower(btrim(coalesce(v_message.direction, ''))) <> 'outgoing'
     or lower(btrim(coalesce(v_message.metadata ->> 'external_channel', ''))) <> 'whatsapp'
     or lower(btrim(coalesce(v_message.metadata ->> 'send_external', 'false'))) <> 'true' then
    raise exception using errcode = '23514', message = 'MESSAGE_NOT_ELIGIBLE_FOR_EXTERNAL_SENT_V2';
  end if;

  if v_message.external_message_id is not null
     and v_message.external_message_id is distinct from v_external_message_id then
    raise exception using errcode = '23505', message = 'MESSAGE_EXTERNAL_ID_ALREADY_DIFFERENT';
  end if;

  if lower(btrim(coalesce(v_message.outbound_delivery_state, ''))) = 'sent' then
    if v_message.external_message_id is distinct from v_external_message_id then
      raise exception using errcode = '23505', message = 'MESSAGE_EXTERNAL_ID_ALREADY_DIFFERENT';
    end if;

    return jsonb_build_object(
      'ok', true,
      'success', true,
      'message_id', v_message.id,
      'external_message_id', v_message.external_message_id,
      'outbound_delivery_state', v_message.outbound_delivery_state,
      'outbound_provider_accepted_at', v_message.outbound_provider_accepted_at,
      'outcome', 'already_sent'
    );
  end if;

  if lower(btrim(coalesce(v_message.outbound_delivery_state, ''))) <> 'uncertain'
     or v_message.outbound_attempt_started_at is null then
    raise exception using errcode = '23514', message = 'MESSAGE_EXTERNAL_ATTEMPT_EVIDENCE_REQUIRED';
  end if;

  update public.messages as message_row
     set external_message_id = v_external_message_id,
         outbound_delivery_state = 'sent',
         outbound_provider_accepted_at = coalesce(message_row.outbound_provider_accepted_at, v_now),
         outbound_uncertain_at = null,
         outbound_claimed_at = null,
         outbound_claimed_by = null,
         outbound_error_text = null
   where message_row.id = p_message_id
     and message_row.organization_id = p_organization_id
     and message_row.store_id = p_store_id
     and message_row.deleted_at is null
     and message_row.outbound_delivery_state = 'uncertain'
     and message_row.outbound_attempt_started_at is not null
     and (
       message_row.external_message_id is null
       or message_row.external_message_id = v_external_message_id
     )
  returning message_row.* into v_message;

  if not found then
    raise exception using errcode = 'P0001', message = 'MESSAGE_EXTERNAL_SENT_V2_TRANSITION_LOST';
  end if;

  return jsonb_build_object(
    'ok', true,
    'success', true,
    'message_id', v_message.id,
    'external_message_id', v_message.external_message_id,
    'outbound_delivery_state', v_message.outbound_delivery_state,
    'outbound_provider_accepted_at', v_message.outbound_provider_accepted_at,
    'outcome', 'sent'
  );
end;
$function$;

create or replace function public.materialize_sales_quote_send_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_conversation_id uuid,
  p_sales_quote_id uuid,
  p_sales_quote_version_id uuid,
  p_message_content text,
  p_message_metadata jsonb,
  p_idempotency_key text,
  p_source text
)
returns table (
  message_id uuid,
  outbound_idempotency_key text,
  outbound_delivery_state text,
  commercial_opportunity_id uuid,
  sales_quote_id uuid,
  sales_quote_version_id uuid,
  external_message_id text,
  outcome text
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_source text := nullif(btrim(coalesce(p_source, '')), '');
  v_expected_key text;
  v_quote public.sales_quotes;
  v_version public.sales_quote_versions;
  v_opportunity public.commercial_opportunities;
  v_message public.messages;
  v_store_file public.store_files;
  v_metadata jsonb;
  v_storage_bucket text;
  v_storage_path text;
  v_original_filename text;
  v_mime_type text;
  v_size_bytes bigint;
begin
  if (v_request_role is distinct from 'service_role') and session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'sales quote send materialization is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_conversation_id is null
     or p_sales_quote_id is null
     or p_sales_quote_version_id is null
     or v_key is null
     or nullif(btrim(coalesce(p_message_content, '')), '') is null
     or p_message_metadata is null
     or jsonb_typeof(p_message_metadata) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'SALES_QUOTE_SEND_ARGUMENTS_REQUIRED';
  end if;

  if v_source is distinct from 'sales_quote_send_route' then
    raise exception using errcode = '22023', message = 'SALES_QUOTE_SEND_SOURCE_INVALID';
  end if;

  v_expected_key :=
    'sales_quote_send:'
    || p_organization_id::text
    || ':'
    || p_store_id::text
    || ':'
    || p_commercial_opportunity_id::text
    || ':'
    || p_sales_quote_id::text
    || ':'
    || p_sales_quote_version_id::text;

  if v_key is distinct from v_expected_key then
    raise exception using errcode = '22023', message = 'SALES_QUOTE_SEND_IDEMPOTENCY_KEY_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_expected_key, 0));

  select opportunity_row.*
    into v_opportunity
    from public.commercial_opportunities as opportunity_row
   where opportunity_row.id = p_commercial_opportunity_id
     and opportunity_row.organization_id = p_organization_id
     and opportunity_row.store_id = p_store_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'COMMERCIAL_OPPORTUNITY_NOT_FOUND_FOR_QUOTE_SEND';
  end if;

  select quote_row.*
    into v_quote
    from public.sales_quotes as quote_row
   where quote_row.id = p_sales_quote_id
     and quote_row.organization_id = p_organization_id
     and quote_row.store_id = p_store_id
     and quote_row.commercial_opportunity_id = p_commercial_opportunity_id
     and quote_row.conversation_id = p_conversation_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'SALES_QUOTE_NOT_FOUND_FOR_CANONICAL_SEND';
  end if;

  if v_quote.current_version_id is distinct from p_sales_quote_version_id then
    raise exception using errcode = '23514', message = 'SALES_QUOTE_VERSION_MUST_BE_CURRENT_FOR_SEND';
  end if;

  select version_row.*
    into v_version
    from public.sales_quote_versions as version_row
   where version_row.id = p_sales_quote_version_id
     and version_row.quote_id = v_quote.id
     and version_row.organization_id = p_organization_id
     and version_row.store_id = p_store_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'SALES_QUOTE_VERSION_NOT_FOUND_FOR_CANONICAL_SEND';
  end if;

  if v_version.version_number is null then
    raise exception using errcode = '23514', message = 'SALES_QUOTE_VERSION_NUMBER_REQUIRED_FOR_CANONICAL_SEND';
  end if;

  if v_version.sent_at is not null
     or lower(btrim(coalesce(v_version.status, ''))) in ('sent', 'superseded', 'failed') then
    raise exception using errcode = '23514', message = 'SALES_QUOTE_VERSION_NOT_SENDABLE';
  end if;

  if v_version.store_file_id is not null then
    select store_file_row.*
      into v_store_file
      from public.store_files as store_file_row
     where store_file_row.id = v_version.store_file_id
       and store_file_row.organization_id = p_organization_id
       and store_file_row.store_id = p_store_id
     limit 1;

    if not found then
      raise exception using errcode = '23514', message = 'SALES_QUOTE_STORE_FILE_SCOPE_MISMATCH';
    end if;
  end if;

  v_storage_bucket := nullif(btrim(coalesce(v_store_file.storage_bucket, v_version.storage_bucket, '')), '');
  v_storage_path := nullif(btrim(coalesce(v_store_file.storage_path, v_version.storage_path, '')), '');
  v_original_filename := nullif(btrim(coalesce(v_store_file.original_filename, v_version.original_filename, '')), '');
  v_mime_type := lower(nullif(btrim(coalesce(v_store_file.mime_type, v_version.mime_type, '')), ''));
  v_size_bytes := coalesce(v_store_file.size_bytes, v_version.size_bytes);

  if v_storage_bucket is null
     or v_storage_path is null
     or v_original_filename is null
     or v_mime_type is distinct from 'application/pdf' then
    raise exception using errcode = '23514', message = 'SALES_QUOTE_PDF_ARTIFACT_INVALID_FOR_SEND';
  end if;

  select message_row.*
    into v_message
    from public.messages as message_row
   where message_row.organization_id = p_organization_id
     and message_row.store_id = p_store_id
     and message_row.outbound_idempotency_key = v_expected_key
   limit 1
   for update;

  if found then
    if v_message.deleted_at is not null then
      raise exception using errcode = '23505', message = 'SALES_QUOTE_SEND_SOFT_DELETED_OPERATION_ALREADY_EXISTS';
    end if;

    if coalesce(v_message.metadata ->> 'outbound_origin', '') <> 'sales_quote_send'
       or coalesce(v_message.metadata ->> 'source', '') <> 'sales_quote_send_route'
       or coalesce(v_message.metadata ->> 'commercial_opportunity_id', '') <> p_commercial_opportunity_id::text
       or coalesce(v_message.metadata ->> 'sales_quote_id', '') <> p_sales_quote_id::text
       or coalesce(v_message.metadata ->> 'sales_quote_version_id', '') <> p_sales_quote_version_id::text
       or lower(btrim(coalesce(v_message.message_type, ''))) <> 'document'
       or coalesce(v_message.media_url, '') <> v_storage_path then
      raise exception using errcode = '23514', message = 'SALES_QUOTE_SEND_EXISTING_MESSAGE_SCOPE_MISMATCH';
    end if;

    return query
    select
      v_message.id,
      v_expected_key,
      coalesce(v_message.outbound_delivery_state, 'pending'),
      p_commercial_opportunity_id,
      p_sales_quote_id,
      p_sales_quote_version_id,
      v_message.external_message_id,
      case
        when coalesce(v_message.outbound_delivery_state, '') = 'uncertain' then 'uncertain'
        when v_message.external_message_id is not null
          or coalesce(v_message.outbound_delivery_state, '') = 'sent' then 'already_sent'
        when coalesce(v_message.outbound_delivery_state, '') = 'failed' then 'failed'
        else 'already_queued'
      end;
    return;
  end if;

  v_metadata := coalesce(p_message_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'source', 'sales_quote_send_route',
      'channel', 'whatsapp',
      'external_channel', 'whatsapp',
      'send_external', true,
      'outbound_origin', 'sales_quote_send',
      'outbound_idempotency_key', v_expected_key,
      'organization_id', p_organization_id,
      'store_id', p_store_id,
      'commercial_opportunity_id', p_commercial_opportunity_id,
      'sales_quote_id', p_sales_quote_id,
      'sales_quote_version_id', p_sales_quote_version_id,
      'attachment_kind', 'file',
      'file_kind', 'sales_quote_pdf',
      'storage_bucket', v_storage_bucket,
      'storage_path', v_storage_path,
      'mime_type', 'application/pdf',
      'original_file_name', v_original_filename,
      'size_bytes', v_size_bytes,
      'generated_by', 'system'
    );

  select *
    into v_message
    from public.insert_message(
      p_conversation_id,
      'human',
      'outgoing',
      'document',
      p_message_content,
      null,
      v_storage_path,
      v_metadata
    );

  if v_message.id is null
     or v_message.organization_id is distinct from p_organization_id
     or v_message.store_id is distinct from p_store_id
     or v_message.conversation_id is distinct from p_conversation_id then
    raise exception using errcode = '23514', message = 'SALES_QUOTE_SEND_INSERT_MESSAGE_SCOPE_MISMATCH';
  end if;

  update public.messages as message_row
     set outbound_idempotency_key = v_expected_key,
         outbound_delivery_state = 'pending',
         outbound_claimed_at = null,
         outbound_claimed_by = null,
         outbound_attempt_started_at = null,
         outbound_provider_accepted_at = null,
         outbound_uncertain_at = null,
         outbound_error_text = null,
         outbound_commercial_finalized_at = null,
         outbound_commercial_error_at = null,
         outbound_commercial_error_text = null
   where message_row.id = v_message.id
     and message_row.organization_id = p_organization_id
     and message_row.store_id = p_store_id
     and message_row.deleted_at is null
  returning message_row.* into v_message;

  if not found then
    raise exception using errcode = 'P0001', message = 'SALES_QUOTE_SEND_MESSAGE_OUTBOUND_STATE_NOT_APPLIED';
  end if;

  return query
  select
    v_message.id,
    v_expected_key,
    v_message.outbound_delivery_state,
    p_commercial_opportunity_id,
    p_sales_quote_id,
    p_sales_quote_version_id,
    v_message.external_message_id,
    'queued'::text;
end;
$function$;

create or replace function public.finalize_sales_quote_send_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_sales_quote_id uuid,
  p_sales_quote_version_id uuid,
  p_message_id uuid,
  p_idempotency_key text,
  p_source text
)
returns table (
  sales_quote_id uuid,
  sales_quote_version_id uuid,
  message_id uuid,
  external_message_id text,
  sent_at timestamptz,
  conversation_event_created boolean,
  current_proposal_outcome text,
  outcome text
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_source text := nullif(btrim(coalesce(p_source, '')), '');
  v_expected_key text;
  v_message public.messages;
  v_quote public.sales_quotes;
  v_version public.sales_quote_versions;
  v_provider_sent_at timestamptz;
  v_event_created boolean := false;
  v_projection record;
  v_projection_outcome text := null;
  v_has_later_sent_version boolean := false;
begin
  if (v_request_role is distinct from 'service_role') and session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'sales quote send finalization is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_sales_quote_id is null
     or p_sales_quote_version_id is null
     or p_message_id is null
     or v_key is null then
    raise exception using errcode = '22023', message = 'SALES_QUOTE_SEND_FINALIZATION_ARGUMENTS_REQUIRED';
  end if;

  if v_source is distinct from 'system_quote_send_reconciliation' then
    raise exception using errcode = '22023', message = 'SALES_QUOTE_SEND_SOURCE_INVALID';
  end if;

  v_expected_key :=
    'sales_quote_send:'
    || p_organization_id::text
    || ':'
    || p_store_id::text
    || ':'
    || p_commercial_opportunity_id::text
    || ':'
    || p_sales_quote_id::text
    || ':'
    || p_sales_quote_version_id::text;

  if v_key is distinct from v_expected_key then
    raise exception using errcode = '22023', message = 'SALES_QUOTE_SEND_IDEMPOTENCY_KEY_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_expected_key, 0));

  select message_row.*
    into v_message
    from public.messages as message_row
   where message_row.id = p_message_id
     and message_row.organization_id = p_organization_id
     and message_row.store_id = p_store_id
     and message_row.outbound_idempotency_key = v_expected_key
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'SALES_QUOTE_SEND_MESSAGE_NOT_FOUND';
  end if;

  if v_message.deleted_at is not null then
    raise exception using errcode = '23514', message = 'SALES_QUOTE_SEND_MESSAGE_DELETED';
  end if;

  if coalesce(v_message.metadata ->> 'outbound_origin', '') <> 'sales_quote_send'
     or coalesce(v_message.metadata ->> 'source', '') <> 'sales_quote_send_route'
     or coalesce(v_message.metadata ->> 'outbound_idempotency_key', '') <> v_expected_key
     or coalesce(v_message.metadata ->> 'commercial_opportunity_id', '') <> p_commercial_opportunity_id::text
     or coalesce(v_message.metadata ->> 'sales_quote_id', '') <> p_sales_quote_id::text
     or coalesce(v_message.metadata ->> 'sales_quote_version_id', '') <> p_sales_quote_version_id::text
     or lower(btrim(coalesce(v_message.message_type, ''))) <> 'document' then
    raise exception using errcode = '23514', message = 'SALES_QUOTE_SEND_MESSAGE_SCOPE_MISMATCH';
  end if;

  if v_message.external_message_id is null
     or v_message.outbound_provider_accepted_at is null
     or coalesce(v_message.outbound_delivery_state, '') <> 'sent' then
    raise exception using errcode = '23514', message = 'SALES_QUOTE_SEND_EXTERNAL_EVIDENCE_REQUIRED';
  end if;

  select quote_row.*
    into v_quote
    from public.sales_quotes as quote_row
   where quote_row.id = p_sales_quote_id
     and quote_row.organization_id = p_organization_id
     and quote_row.store_id = p_store_id
     and quote_row.commercial_opportunity_id = p_commercial_opportunity_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'SALES_QUOTE_NOT_FOUND_FOR_FINALIZATION';
  end if;

  select version_row.*
    into v_version
    from public.sales_quote_versions as version_row
   where version_row.id = p_sales_quote_version_id
     and version_row.quote_id = p_sales_quote_id
     and version_row.organization_id = p_organization_id
     and version_row.store_id = p_store_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'SALES_QUOTE_VERSION_NOT_FOUND_FOR_FINALIZATION';
  end if;

  if v_version.version_number is null then
    raise exception using errcode = '23514', message = 'SALES_QUOTE_VERSION_NUMBER_REQUIRED_FOR_FINALIZATION';
  end if;

  if v_message.outbound_commercial_finalized_at is not null then
    return query
    select
      p_sales_quote_id,
      p_sales_quote_version_id,
      v_message.id,
      v_message.external_message_id,
      coalesce(v_version.sent_at, v_message.outbound_provider_accepted_at),
      false,
      null::text,
      'already_finalized'::text;
    return;
  end if;

  v_provider_sent_at := v_message.outbound_provider_accepted_at;

  if v_version.sent_at is null then
    update public.sales_quote_versions as version_row
       set status = case
         when lower(btrim(coalesce(version_row.status, ''))) = 'superseded' then version_row.status
         when lower(btrim(coalesce(version_row.status, ''))) = 'sent' then version_row.status
         else 'sent'
       end,
           sent_at = v_provider_sent_at
     where version_row.id = v_version.id
       and version_row.organization_id = p_organization_id
       and version_row.store_id = p_store_id
    returning version_row.* into v_version;
  end if;

  -- O aggregate da quote acompanha somente a versão interna atual.
  -- Uma versão antiga enviada tardiamente vira fato histórico, mas não muda
  -- o estado agregado de uma revisão interna mais nova.
  if v_quote.current_version_id is not distinct from v_version.id then
    update public.sales_quotes as quote_row
       set status = case
         when lower(btrim(coalesce(quote_row.status, ''))) = 'sent' then quote_row.status
         else 'sent'
       end,
           sent_at = coalesce(quote_row.sent_at, v_provider_sent_at),
           updated_at = clock_timestamp()
     where quote_row.id = v_quote.id
       and quote_row.organization_id = p_organization_id
       and quote_row.store_id = p_store_id
    returning quote_row.* into v_quote;
  end if;

  update public.store_assistant_operational_tasks as task_row
     set status = 'resolved',
         resolved_at = coalesce(task_row.resolved_at, v_provider_sent_at),
         updated_at = clock_timestamp()
   where task_row.organization_id = p_organization_id
     and task_row.store_id = p_store_id
     and task_row.commercial_opportunity_id = p_commercial_opportunity_id
     and task_row.task_type = 'commercial_quote_request'
     and task_row.status in (
       'open',
       'in_progress',
       'ready_to_execute',
       'waiting_user_choice',
       'waiting_customer_response'
     )
     and (task_row.related_conversation_id is null or task_row.related_conversation_id = v_quote.conversation_id)
     and (task_row.related_lead_id is null or task_row.related_lead_id = v_quote.lead_id);

  if v_quote.conversation_id is not null
     and not exists (
       select 1
         from public.conversation_events as event_row
        where event_row.organization_id = p_organization_id
          and event_row.conversation_id = v_quote.conversation_id
          and event_row.event_type = 'orcamento_enviado'
          and coalesce(event_row.payload ->> 'message_id', '') = v_message.id::text
     ) then
    insert into public.conversation_events (
      conversation_id,
      organization_id,
      event_type,
      payload,
      created_by
    )
    values (
      v_quote.conversation_id,
      p_organization_id,
      'orcamento_enviado',
      jsonb_build_object(
        'commercial_opportunity_id', p_commercial_opportunity_id,
        'quote_id', v_quote.id,
        'version_id', v_version.id,
        'quote_number', v_quote.quote_number,
        'total_cents', v_quote.total_cents,
        'message_id', v_message.id,
        'external_message_id', v_message.external_message_id,
        'outbound_idempotency_key', v_expected_key,
        'status', 'sent'
      ),
      'system'
    );
    v_event_created := true;
  end if;

  -- Regra de lineage dentro da MESMA quote:
  -- uma versão de número maior que já tenha evidência canônica de envio
  -- prevalece sobre uma versão antiga que chegou atrasada ao provider.
  select exists (
    select 1
      from public.sales_quote_versions as later_version
     where later_version.quote_id = v_quote.id
       and later_version.organization_id = p_organization_id
       and later_version.store_id = p_store_id
       and later_version.version_number is not null
       and later_version.version_number > v_version.version_number
       and later_version.sent_at is not null
       and lower(btrim(coalesce(later_version.status, ''))) in ('sent', 'superseded')
  ) into v_has_later_sent_version;

  if v_has_later_sent_version then
    v_projection_outcome := 'stale_older_quote_version_ignored';
  else
    select *
      into v_projection
      from public.set_current_commercial_proposal_from_sent_quote_by_system(
        p_organization_id,
        p_store_id,
        p_commercial_opportunity_id,
        p_sales_quote_id,
        p_sales_quote_version_id,
        'current_commercial_proposal:' || p_commercial_opportunity_id::text || ':' || p_sales_quote_id::text || ':' || p_sales_quote_version_id::text,
        v_source
      )
      limit 1;

    v_projection_outcome := coalesce(v_projection.outcome, null);
  end if;

  update public.messages as message_row
     set outbound_commercial_finalized_at = clock_timestamp(),
         outbound_commercial_error_at = null,
         outbound_commercial_error_text = null
   where message_row.id = v_message.id
     and message_row.organization_id = p_organization_id
     and message_row.store_id = p_store_id
     and message_row.outbound_delivery_state = 'sent'
     and message_row.external_message_id = v_message.external_message_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'SALES_QUOTE_SEND_COMMERCIAL_FINALIZATION_MARKER_LOST';
  end if;

  return query
  select
    p_sales_quote_id,
    p_sales_quote_version_id,
    v_message.id,
    v_message.external_message_id,
    coalesce(v_version.sent_at, v_provider_sent_at),
    v_event_created,
    v_projection_outcome,
    'finalized'::text;
end;
$function$;

alter function public.get_pending_external_messages_v2(
  uuid, uuid, integer, integer
) owner to postgres;
revoke all on function public.get_pending_external_messages_v2(
  uuid, uuid, integer, integer
) from public, anon, authenticated;
grant execute on function public.get_pending_external_messages_v2(
  uuid, uuid, integer, integer
) to service_role;

alter function public.mark_message_external_sent_v2(
  uuid, uuid, uuid, text
) owner to postgres;
revoke all on function public.mark_message_external_sent_v2(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.mark_message_external_sent_v2(
  uuid, uuid, uuid, text
) to service_role;

alter function public.materialize_sales_quote_send_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, text, text
) owner to postgres;
revoke all on function public.materialize_sales_quote_send_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.materialize_sales_quote_send_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, text, text
) to service_role;

alter function public.finalize_sales_quote_send_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text
) owner to postgres;
revoke all on function public.finalize_sales_quote_send_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.finalize_sales_quote_send_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text
) to service_role;

commit;
