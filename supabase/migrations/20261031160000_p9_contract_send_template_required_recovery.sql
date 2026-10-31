begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

do $preflight$
begin
  if pg_catalog.to_regclass('public.messages') is null
     or pg_catalog.to_regclass('public.sales_contracts') is null
     or pg_catalog.to_regclass('public.sales_contract_versions') is null
     or pg_catalog.to_regclass('public.p9_sales_contract_send_barriers') is null
     or pg_catalog.to_regprocedure('public.p9_acquire_sales_contract_send_domain_lock(uuid,uuid,uuid)') is null
     or pg_catalog.to_regprocedure('public.read_customer_whatsapp_24h_window_by_system(uuid,uuid,uuid)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_CONTRACT_SEND_TEMPLATE_RECOVERY_PRECONDITION_MISSING';
  end if;
end;
$preflight$;

create or replace function public.resume_sales_contract_send_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_contract_id uuid,
  p_contract_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''),
    nullif(auth.jwt() ->> 'role', '')
  );
  v_contract public.sales_contracts%rowtype;
  v_version public.sales_contract_versions%rowtype;
  v_message public.messages%rowtype;
  v_inbound public.messages%rowtype;
  v_opportunity_id uuid;
  v_key text;
  v_window_open boolean := false;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_role is distinct from 'service_role' and session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'P9_CONTRACT_SEND_SERVICE_ROLE_REQUIRED';
  end if;
  if p_organization_id is null or p_store_id is null
     or p_contract_id is null or p_contract_version_id is null then
    raise exception using errcode = '22023', message = 'P9_CONTRACT_SEND_TEMPLATE_RECOVERY_ARGUMENTS_INVALID';
  end if;

  -- Discover the domain without a row lock. The durable locks begin below.
  select c.* into v_contract
    from public.sales_contracts c
   where c.id = p_contract_id
     and c.organization_id = p_organization_id
     and c.store_id = p_store_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'P9_CONTRACT_SEND_CONTRACT_NOT_FOUND';
  end if;

  v_opportunity_id := case
    when v_contract.metadata ->> 'created_via' = 'create_sales_contract_manual_by_system'
      or v_contract.metadata ->> 'source' = 'responsible_text_draft'
    then nullif(v_contract.metadata ->> 'commercial_opportunity_id', '')::uuid
    else (
      select q.commercial_opportunity_id
        from public.sales_quotes q
       where q.id = v_contract.quote_id
         and q.organization_id = p_organization_id
         and q.store_id = p_store_id
    )
  end;
  if v_opportunity_id is null then
    raise exception using errcode = 'P0002', message = 'P9_CONTRACT_SEND_CANONICAL_OPPORTUNITY_NOT_FOUND';
  end if;

  perform public.p9_acquire_sales_contract_send_domain_lock(
    p_organization_id,
    p_store_id,
    v_opportunity_id
  );

  v_key := 'sales_contract_send:' || p_organization_id::text || ':' ||
    p_store_id::text || ':' || p_contract_id::text || ':' || p_contract_version_id::text;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));

  -- Re-read under the canonical lock order: sales_contracts, version, message.
  select c.* into v_contract
    from public.sales_contracts c
   where c.id = p_contract_id
     and c.organization_id = p_organization_id
     and c.store_id = p_store_id
   for update;
  if not found or v_contract.current_version_id is distinct from p_contract_version_id
     or lower(coalesce(v_contract.status, '')) <> 'approved'
     or v_contract.conversation_id is null then
    raise exception using errcode = '23514', message = 'P9_CONTRACT_SEND_TEMPLATE_RECOVERY_CONTRACT_INVALID';
  end if;

  select v.* into v_version
    from public.sales_contract_versions v
   where v.id = p_contract_version_id
     and v.contract_id = p_contract_id
     and v.organization_id = p_organization_id
     and v.store_id = p_store_id
   for update;
  if not found or lower(coalesce(v_version.status, '')) <> 'approved'
     or nullif(pg_catalog.btrim(coalesce(v_version.storage_bucket, '')), '') is null
     or nullif(pg_catalog.btrim(coalesce(v_version.storage_path, '')), '') is null
     or lower(nullif(pg_catalog.btrim(coalesce(v_version.mime_type, '')), '')) <> 'application/pdf' then
    raise exception using errcode = '23514', message = 'P9_CONTRACT_SEND_TEMPLATE_RECOVERY_VERSION_INVALID';
  end if;

  select m.* into v_message
    from public.messages m
   where m.organization_id = p_organization_id
     and m.store_id = p_store_id
     and m.outbound_idempotency_key = v_key
     and m.deleted_at is null
   for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'message_id', null,
      'outbound_idempotency_key', v_key,
      'outbound_delivery_state', null,
      'sales_contract_id', p_contract_id,
      'sales_contract_version_id', p_contract_version_id,
      'external_message_id', null,
      'outcome', 'no_existing_message'
    );
  end if;

  if v_message.conversation_id is distinct from v_contract.conversation_id
     or v_message.sender is distinct from 'human'
     or v_message.direction is distinct from 'outgoing'
     or v_message.message_type is distinct from 'document'
     or v_message.external_message_id is not null
     or v_message.outbound_idempotency_key is distinct from v_key
     or v_message.metadata ->> 'source' is distinct from 'sales_contract_send_route'
     or v_message.metadata ->> 'outbound_origin' is distinct from 'sales_contract_send'
     or v_message.metadata ->> 'outbound_idempotency_key' is distinct from v_key
     or v_message.metadata ->> 'organization_id' is distinct from p_organization_id::text
     or v_message.metadata ->> 'store_id' is distinct from p_store_id::text
     or v_message.metadata ->> 'sales_contract_id' is distinct from p_contract_id::text
     or v_message.metadata ->> 'sales_contract_version_id' is distinct from p_contract_version_id::text
     or v_message.metadata ->> 'contract_id' is distinct from p_contract_id::text
     or v_message.metadata ->> 'contract_version_id' is distinct from p_contract_version_id::text then
    raise exception using errcode = '23514', message = 'P9_CONTRACT_SEND_TEMPLATE_RECOVERY_MESSAGE_SCOPE_INVALID';
  end if;

  if v_message.outbound_delivery_state = 'sent' or v_message.external_message_id is not null then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'message_id', v_message.id, 'outbound_idempotency_key', v_key,
      'outbound_delivery_state', v_message.outbound_delivery_state,
      'sales_contract_id', p_contract_id, 'sales_contract_version_id', p_contract_version_id,
      'external_message_id', v_message.external_message_id, 'outcome', 'already_sent'
    );
  end if;
  if v_message.outbound_delivery_state = 'uncertain' then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'message_id', v_message.id, 'outbound_idempotency_key', v_key,
      'outbound_delivery_state', v_message.outbound_delivery_state,
      'sales_contract_id', p_contract_id, 'sales_contract_version_id', p_contract_version_id,
      'external_message_id', null, 'outcome', 'uncertain'
    );
  end if;
  if v_message.outbound_delivery_state = 'processing' then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'message_id', v_message.id, 'outbound_idempotency_key', v_key,
      'outbound_delivery_state', v_message.outbound_delivery_state,
      'sales_contract_id', p_contract_id, 'sales_contract_version_id', p_contract_version_id,
      'external_message_id', null, 'outcome', 'in_progress'
    );
  end if;
  if v_message.outbound_delivery_state = 'pending' then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'message_id', v_message.id, 'outbound_idempotency_key', v_key,
      'outbound_delivery_state', v_message.outbound_delivery_state,
      'sales_contract_id', p_contract_id, 'sales_contract_version_id', p_contract_version_id,
      'external_message_id', null, 'outcome', 'already_queued'
    );
  end if;
  if v_message.outbound_delivery_state is distinct from 'template_required' then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'message_id', v_message.id, 'outbound_idempotency_key', v_key,
      'outbound_delivery_state', v_message.outbound_delivery_state,
      'sales_contract_id', p_contract_id, 'sales_contract_version_id', p_contract_version_id,
      'external_message_id', null, 'outcome', 'failed'
    );
  end if;

  select inbound_row.* into v_inbound
    from public.messages inbound_row
   where inbound_row.organization_id = p_organization_id
     and inbound_row.store_id = p_store_id
     and inbound_row.conversation_id = v_message.conversation_id
     and inbound_row.sender = 'user'
     and inbound_row.direction = 'incoming'
     and inbound_row.deleted_at is null
     and inbound_row.external_message_id is not null
     and inbound_row.metadata ->> 'source' = 'meta_whatsapp_webhook'
     and inbound_row.metadata ->> 'channel' = 'whatsapp'
     and inbound_row.metadata ->> 'external_channel' = 'whatsapp'
     and inbound_row.metadata ->> 'provider' = 'meta'
   order by inbound_row.created_at desc, inbound_row.id desc
   limit 1;

  v_window_open := found and v_inbound.created_at is not null
    and v_inbound.created_at <= v_now
    and v_inbound.created_at >= v_now - interval '24 hours';
  if not v_window_open then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'message_id', v_message.id, 'outbound_idempotency_key', v_key,
      'outbound_delivery_state', 'template_required',
      'sales_contract_id', p_contract_id, 'sales_contract_version_id', p_contract_version_id,
      'external_message_id', null, 'outcome', 'template_required'
    );
  end if;

  update public.messages m
     set outbound_delivery_state = 'pending',
         outbound_claimed_at = null,
         outbound_claimed_by = null,
         outbound_attempt_started_at = null,
         outbound_uncertain_at = null,
         outbound_error_text = null
   where m.id = v_message.id
     and m.organization_id = p_organization_id
     and m.store_id = p_store_id
     and m.outbound_delivery_state = 'template_required'
     and m.external_message_id is null
     and m.outbound_attempt_started_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'P9_CONTRACT_SEND_TEMPLATE_RECOVERY_STATE_CHANGED';
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true, 'message_id', v_message.id, 'outbound_idempotency_key', v_key,
    'outbound_delivery_state', 'pending',
    'sales_contract_id', p_contract_id, 'sales_contract_version_id', p_contract_version_id,
    'external_message_id', null, 'outcome', 'resumed'
  );
end;
$function$;

alter function public.resume_sales_contract_send_by_system(uuid,uuid,uuid,uuid)
  owner to postgres;

revoke all on function public.resume_sales_contract_send_by_system(uuid,uuid,uuid,uuid)
from public, anon, authenticated;

grant execute on function public.resume_sales_contract_send_by_system(uuid,uuid,uuid,uuid)
to service_role;

commit;
