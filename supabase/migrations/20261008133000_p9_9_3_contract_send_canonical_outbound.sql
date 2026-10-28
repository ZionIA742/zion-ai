begin;

do $preflight$
begin
  if to_regclass('public.sales_contracts') is null
     or to_regclass('public.sales_contract_versions') is null
     or to_regclass('public.messages') is null
     or to_regclass('public.conversations') is null
     or to_regclass('public.leads') is null
     or to_regclass('public.conversation_events') is null then
    raise exception using errcode = 'P0001', message = 'P9_9_3_CONTRACT_SEND_REQUIRED_RELATION_MISSING';
  end if;
  if to_regprocedure('public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)') is null then
    raise exception using errcode = 'P0001', message = 'P9_9_3_CONTRACT_SEND_CURRENT_PROPOSAL_GUARD_MISSING';
  end if;
end
$preflight$;

create or replace function public.get_pending_external_messages_v2(
  p_organization_id uuid,
  p_store_id uuid,
  p_limit integer default 50,
  p_processing_lease_seconds integer default 600
)
returns table (
  message_id uuid, organization_id uuid, store_id uuid, conversation_id uuid,
  lead_id uuid, lead_phone text, message_type text, content text, media_url text,
  metadata jsonb, created_at timestamptz, external_message_id text,
  outbound_delivery_state text, outbound_idempotency_key text,
  outbound_claimed_at timestamptz, outbound_attempt_started_at timestamptz,
  outbound_provider_accepted_at timestamptz, outbound_commercial_finalized_at timestamptz,
  outbound_commercial_error_text text
)
language sql security definer
set search_path = pg_catalog, pg_temp, public
as $function$
  select m.id, m.organization_id, m.store_id, m.conversation_id, c.lead_id,
    l.phone, m.message_type, m.content, m.media_url, coalesce(m.metadata, '{}'::jsonb),
    m.created_at, m.external_message_id, m.outbound_delivery_state,
    m.outbound_idempotency_key, m.outbound_claimed_at, m.outbound_attempt_started_at,
    m.outbound_provider_accepted_at, m.outbound_commercial_finalized_at,
    m.outbound_commercial_error_text
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
    and c.organization_id = m.organization_id
  join public.leads l on l.id = c.lead_id
    and l.organization_id = m.organization_id and l.store_id = m.store_id
  where m.organization_id = p_organization_id and m.store_id = p_store_id
    and (
      (m.sender = 'ai' and m.message_type in ('text', 'image', 'document'))
      or (
      m.organization_id = p_organization_id and m.store_id = p_store_id
      and m.sender = 'human'
      and (
        (coalesce(m.metadata ->> 'outbound_origin', '') = 'sales_quote_send'
          and m.message_type in ('text', 'image', 'document'))
        or (coalesce(m.metadata ->> 'outbound_origin', '') = 'sales_contract_send'
          and m.message_type = 'document')
        or (coalesce(m.metadata ->> 'outbound_origin', '') = 'crm_manual_text'
          and m.message_type = 'text')
        or (coalesce(m.metadata ->> 'outbound_origin', '') = 'crm_manual_image'
          and m.message_type = 'image')
        or (coalesce(m.metadata ->> 'outbound_origin', '') = 'crm_manual_audio'
          and m.message_type = 'audio')
        or (coalesce(m.metadata ->> 'outbound_origin', '') = 'crm_manual_video'
          and m.message_type = 'video')
        or (coalesce(m.metadata ->> 'outbound_origin', '') = 'crm_manual_document'
          and m.message_type = 'document')
      )
    )
    )
    and m.direction = 'outgoing' and m.external_message_id is null
    and m.deleted_at is null and coalesce(m.metadata ->> 'send_external', 'false') = 'true'
    and coalesce(m.metadata ->> 'external_channel', '') = 'whatsapp'
    and (coalesce(m.outbound_delivery_state, 'pending') = 'pending'
      or (m.outbound_delivery_state = 'processing'
        and m.outbound_attempt_started_at is null and m.outbound_claimed_at is not null
        and m.outbound_claimed_at < clock_timestamp() - make_interval(
          secs => greatest(coalesce(p_processing_lease_seconds, 600), 1))))
  order by coalesce(m.outbound_claimed_at, m.created_at), m.created_at
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$function$;

create or replace function public.validate_sales_contract_send_before_external_by_system(
  p_organization_id uuid, p_store_id uuid, p_message_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  m public.messages;
  c public.sales_contracts;
  v public.sales_contract_versions;
  initial_message public.messages;
  contract_id uuid;
  version_id uuid;
  guard_state text;
begin
  select * into initial_message
    from public.messages
   where id = p_message_id
     and organization_id = p_organization_id
     and store_id = p_store_id;
  if not found then
    return jsonb_build_object('ok',true,'decision','blocked','reason','message_not_found');
  end if;

  begin
    contract_id := nullif(btrim(initial_message.metadata->>'sales_contract_id'),'')::uuid;
    version_id := nullif(btrim(initial_message.metadata->>'sales_contract_version_id'),'')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('ok',true,'decision','blocked','reason','contract_identity_invalid','message_id',p_message_id);
  end;

  if contract_id is null or version_id is null then
    return jsonb_build_object('ok',true,'decision','blocked','reason','contract_identity_invalid','message_id',p_message_id);
  end if;

  -- Lock order is contract -> version -> message, matching approval,
  -- versioning and materialization writers. The authorities are reread after
  -- all locks are held, eliminating a validation-only TOCTOU window.
  select * into c
    from public.sales_contracts
   where id = contract_id
     and organization_id = p_organization_id
     and store_id = p_store_id
   for update;
  if not found then
    return jsonb_build_object('ok',true,'decision','blocked','reason','contract_not_current_approved','message_id',p_message_id);
  end if;

  select * into v
    from public.sales_contract_versions
   where id = version_id
     and contract_id = c.id
     and organization_id = p_organization_id
     and store_id = p_store_id
   for update;
  if not found then
    return jsonb_build_object('ok',true,'decision','blocked','reason','contract_pdf_not_current','message_id',p_message_id,'conversation_id',c.conversation_id);
  end if;

  select * into m
    from public.messages
   where id = p_message_id
     and organization_id = p_organization_id
     and store_id = p_store_id
     and deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('ok',true,'decision','blocked','reason','message_not_found','message_id',p_message_id);
  end if;

  if m.id is distinct from p_message_id
     or m.organization_id is distinct from p_organization_id
     or m.store_id is distinct from p_store_id
     or m.conversation_id is distinct from c.conversation_id
     or m.message_type is distinct from 'document'
     or m.media_url is null
     or m.outbound_delivery_state is distinct from 'uncertain'
     or m.outbound_attempt_started_at is null
     or m.external_message_id is not null
     or m.metadata->>'source' is distinct from 'sales_contract_send_route'
     or m.metadata->>'channel' is distinct from 'whatsapp'
     or m.metadata->>'external_channel' is distinct from 'whatsapp'
     or m.metadata->>'send_external' is distinct from 'true'
     or m.metadata->>'outbound_origin' is distinct from 'sales_contract_send'
     or m.metadata->>'outbound_idempotency_key' is distinct from 'sales_contract_send:' || p_organization_id || ':' || p_store_id || ':' || c.id || ':' || v.id
     or m.outbound_idempotency_key is distinct from 'sales_contract_send:' || p_organization_id || ':' || p_store_id || ':' || c.id || ':' || v.id
     or m.metadata->>'sales_contract_id' is distinct from c.id::text
     or m.metadata->>'sales_contract_version_id' is distinct from v.id::text
     or m.metadata->>'organization_id' is distinct from p_organization_id::text
     or m.metadata->>'store_id' is distinct from p_store_id::text
     or m.metadata->>'storage_bucket' is distinct from v.storage_bucket
     or m.metadata->>'storage_path' is distinct from v.storage_path
     or m.metadata->>'attachment_kind' is distinct from 'file'
     or m.metadata->>'file_kind' is distinct from 'sales_contract_pdf'
     or m.media_url is distinct from v.storage_path
     or lower(btrim(coalesce(m.metadata->>'mime_type',''))) is distinct from 'application/pdf'
     or lower(btrim(coalesce(v.mime_type,''))) is distinct from 'application/pdf'
     or c.current_version_id is distinct from v.id
     or lower(btrim(coalesce(c.status,''))) is distinct from 'approved'
     or lower(btrim(coalesce(v.status,''))) is distinct from 'approved' then
    return jsonb_build_object('ok',true,'decision','blocked','reason','contract_send_identity_or_state_invalid','message_id',m.id,'conversation_id',m.conversation_id);
  end if;

  select guard_state into guard_state
    from public.p9_assert_sales_contract_current_proposal_lineage_internal(
      p_organization_id,p_store_id,c.id
    );
  if guard_state is distinct from 'current' then
    return jsonb_build_object('ok',true,'decision','blocked','reason','current_proposal_replaced','message_id',m.id,'conversation_id',m.conversation_id);
  end if;

  return jsonb_build_object('ok',true,'decision','send','reason','authorized','message_id',m.id,'conversation_id',m.conversation_id);
exception when invalid_text_representation then
  return jsonb_build_object('ok',true,'decision','blocked','reason','contract_identity_invalid','message_id',p_message_id);
end;
$function$;

create or replace function public.validate_or_start_sales_contract_send_by_system(
  p_organization_id uuid, p_store_id uuid, p_message_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  initial_message public.messages;
  m public.messages;
  c public.sales_contracts;
  v public.sales_contract_versions;
  window_result jsonb;
  window_decision text;
  window_reason text;
  contract_id uuid;
  version_id uuid;
  guard_state text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and session_user <> 'postgres' then
    raise exception using errcode='42501', message='P9_CONTRACT_SEND_SERVICE_ROLE_REQUIRED';
  end if;

  select * into initial_message
    from public.messages
   where id=p_message_id and organization_id=p_organization_id and store_id=p_store_id;
  if not found then
    return jsonb_build_object('ok',true,'decision','blocked','reason','message_not_found','message_id',p_message_id);
  end if;

  window_result := public.read_customer_whatsapp_24h_window_by_system(
    p_organization_id, p_store_id, p_message_id
  );
  window_decision := window_result->>'decision';
  window_reason := nullif(btrim(coalesce(window_result->>'reason','')), '');
  if window_decision in ('template_required','blocked') then
    update public.messages
       set outbound_delivery_state = case when window_decision='template_required' then 'template_required' else 'failed' end,
           outbound_claimed_at = null,
           outbound_claimed_by = null,
           outbound_attempt_started_at = null,
           outbound_uncertain_at = null,
           outbound_error_text = case when window_decision='template_required'
             then 'ZION_EXTERNAL_SEND_TEMPLATE_REQUIRED:' || coalesce(window_reason,'window_closed')
             else 'ZION_EXTERNAL_SEND_BLOCKED:' || coalesce(window_reason,'window_blocked') end
     where id=p_message_id and organization_id=p_organization_id and store_id=p_store_id
       and outbound_delivery_state='processing' and outbound_attempt_started_at is null
       and external_message_id is null and deleted_at is null;
    if not found then
      raise exception using errcode='P0001', message='P9_CONTRACT_SEND_WINDOW_TRANSITION_LOST';
    end if;
    return jsonb_build_object('ok',true,'decision',window_decision,'reason',coalesce(window_reason,'window_blocked'),'message_id',p_message_id,'conversation_id',initial_message.conversation_id);
  end if;
  if window_decision is distinct from 'send' then
    raise exception using errcode='P0001', message='P9_CONTRACT_SEND_WINDOW_DECISION_INVALID';
  end if;

  begin
    contract_id := nullif(btrim(initial_message.metadata->>'sales_contract_id'),'')::uuid;
    version_id := nullif(btrim(initial_message.metadata->>'sales_contract_version_id'),'')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('ok',true,'decision','blocked','reason','contract_identity_invalid','message_id',p_message_id);
  end;
  if contract_id is null or version_id is null then
    return jsonb_build_object('ok',true,'decision','blocked','reason','contract_identity_invalid','message_id',p_message_id);
  end if;

  -- One transaction and one lock order: contract -> version -> conversation -> message.
  select * into c from public.sales_contracts
   where id=contract_id and organization_id=p_organization_id and store_id=p_store_id for update;
  if not found then
    return jsonb_build_object('ok',true,'decision','blocked','reason','contract_not_current_approved','message_id',p_message_id);
  end if;
  select * into v from public.sales_contract_versions
   where id=version_id and contract_id=c.id and organization_id=p_organization_id and store_id=p_store_id for update;
  if not found then
    return jsonb_build_object('ok',true,'decision','blocked','reason','contract_pdf_not_current','message_id',p_message_id,'conversation_id',c.conversation_id);
  end if;
  if c.conversation_id is null then
    return jsonb_build_object('ok',true,'decision','blocked','reason','contract_conversation_required','message_id',p_message_id);
  end if;
  perform public.private_acquire_sales_contract_conversation_xact_lock(c.conversation_id);
  select * into m from public.messages
   where id=p_message_id and organization_id=p_organization_id and store_id=p_store_id and deleted_at is null for update;
  if not found then
    return jsonb_build_object('ok',true,'decision','blocked','reason','message_not_found','message_id',p_message_id);
  end if;

  if m.conversation_id is distinct from c.conversation_id
     or m.sender is distinct from 'human'
     or m.direction is distinct from 'outgoing'
     or m.message_type is distinct from 'document'
     or m.media_url is distinct from v.storage_path
     or m.outbound_delivery_state is distinct from 'processing'
     or m.outbound_attempt_started_at is not null
     or m.external_message_id is not null
     or m.metadata->>'source' is distinct from 'sales_contract_send_route'
     or m.metadata->>'outbound_origin' is distinct from 'sales_contract_send'
     or m.metadata->>'outbound_idempotency_key' is distinct from 'sales_contract_send:' || p_organization_id || ':' || p_store_id || ':' || c.id || ':' || v.id
     or m.metadata->>'sales_contract_id' is distinct from c.id::text
     or m.metadata->>'sales_contract_version_id' is distinct from v.id::text
     or m.metadata->>'organization_id' is distinct from p_organization_id::text
     or m.metadata->>'store_id' is distinct from p_store_id::text
     or m.metadata->>'storage_bucket' is distinct from v.storage_bucket
     or m.metadata->>'storage_path' is distinct from v.storage_path
     or m.metadata->>'attachment_kind' is distinct from 'file'
     or m.metadata->>'file_kind' is distinct from 'sales_contract_pdf'
     or lower(btrim(coalesce(m.metadata->>'mime_type',''))) is distinct from 'application/pdf'
     or lower(btrim(coalesce(v.mime_type,''))) is distinct from 'application/pdf'
     or c.current_version_id is distinct from v.id
     or lower(btrim(coalesce(c.status,''))) is distinct from 'approved'
     or lower(btrim(coalesce(v.status,''))) is distinct from 'approved' then
    return jsonb_build_object('ok',true,'decision','blocked','reason','contract_send_identity_or_state_invalid','message_id',m.id,'conversation_id',m.conversation_id);
  end if;
  select guard_state into guard_state from public.p9_assert_sales_contract_current_proposal_lineage_internal(p_organization_id,p_store_id,c.id);
  if guard_state is distinct from 'current' then
    return jsonb_build_object('ok',true,'decision','blocked','reason','current_proposal_replaced','message_id',m.id,'conversation_id',m.conversation_id);
  end if;

  update public.messages
     set outbound_delivery_state='uncertain',
         outbound_attempt_started_at=clock_timestamp(),
         outbound_uncertain_at=clock_timestamp(),
         outbound_claimed_at=null,
         outbound_claimed_by=null,
         outbound_error_text=null
   where id=m.id and organization_id=p_organization_id and store_id=p_store_id
     and outbound_delivery_state='processing' and outbound_attempt_started_at is null
     and external_message_id is null and deleted_at is null;
  if not found then
    raise exception using errcode='P0001', message='P9_CONTRACT_SEND_ATTEMPT_TRANSITION_LOST';
  end if;
  return jsonb_build_object('ok',true,'decision','send','reason','authorized','message_id',m.id,'conversation_id',m.conversation_id);
end;
$function$;

drop function if exists public.materialize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text);

create or replace function public.materialize_sales_contract_send_by_system(
  p_organization_id uuid, p_store_id uuid, p_contract_id uuid,
  p_contract_version_id uuid, p_conversation_id uuid, p_message_content text,
  p_message_metadata jsonb, p_idempotency_key text, p_source text,
  p_actor_user_id uuid
)
returns table (
  message_id uuid, outbound_idempotency_key text, outbound_delivery_state text,
  sales_contract_id uuid, sales_contract_version_id uuid, external_message_id text,
  outcome text
)
language plpgsql security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  c public.sales_contracts; v public.sales_contract_versions; m public.messages;
  key text := nullif(btrim(p_idempotency_key), ''); guard_state text;
  bucket text; path text; filename text; mime text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and session_user <> 'postgres' then raise exception using errcode='42501', message='P9_CONTRACT_SEND_SERVICE_ROLE_REQUIRED'; end if;
  if p_source is distinct from 'sales_contract_send_route' or key is null
     or p_organization_id is null or p_store_id is null or p_contract_id is null
     or p_contract_version_id is null or p_conversation_id is null or p_actor_user_id is null then
    raise exception using errcode='22023', message='P9_CONTRACT_SEND_ARGUMENTS_INVALID';
  end if;
  if key is distinct from 'sales_contract_send:' || p_organization_id || ':' || p_store_id || ':' || p_contract_id || ':' || p_contract_version_id then
    raise exception using errcode='22023', message='P9_CONTRACT_SEND_IDEMPOTENCY_KEY_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(key, 0));
  select * into c from public.sales_contracts where id=p_contract_id and organization_id=p_organization_id and store_id=p_store_id for update;
  if not found then raise exception using errcode='P0002', message='P9_CONTRACT_SEND_CONTRACT_NOT_FOUND'; end if;
  if c.conversation_id is distinct from p_conversation_id then
    raise exception using errcode='23514', message='P9_CONTRACT_SEND_CONVERSATION_MISMATCH';
  end if;
  select * into v from public.sales_contract_versions where id=p_contract_version_id and contract_id=c.id and organization_id=p_organization_id and store_id=p_store_id for update;
  if not found then raise exception using errcode='P0002', message='P9_CONTRACT_SEND_VERSION_NOT_FOUND'; end if;
  bucket := nullif(btrim(coalesce(v.storage_bucket,'')), ''); path := nullif(btrim(coalesce(v.storage_path,'')), ''); filename := nullif(btrim(coalesce(v.original_filename,'')), ''); mime := lower(nullif(btrim(coalesce(v.mime_type,'')),''));
  if bucket is null or path is null or filename is null or mime is distinct from 'application/pdf' then raise exception using errcode='23514', message='P9_CONTRACT_SEND_PDF_INVALID'; end if;
  select * into m from public.messages where organization_id=p_organization_id and store_id=p_store_id and outbound_idempotency_key=key for update;
  if found then
    if m.deleted_at is not null
       or m.organization_id is distinct from p_organization_id
       or m.store_id is distinct from p_store_id
       or m.conversation_id is distinct from p_conversation_id
       or lower(btrim(coalesce(m.sender,''))) is distinct from 'human'
       or lower(btrim(coalesce(m.direction,''))) is distinct from 'outgoing'
       or lower(btrim(coalesce(m.message_type,''))) is distinct from 'document'
       or m.media_url is distinct from path
       or m.metadata->>'source' is distinct from 'sales_contract_send_route'
       or m.metadata->>'outbound_origin' is distinct from 'sales_contract_send'
       or m.metadata->>'outbound_idempotency_key' is distinct from key
       or m.metadata->>'organization_id' is distinct from p_organization_id::text
       or m.metadata->>'store_id' is distinct from p_store_id::text
       or m.metadata->>'sales_contract_id' is distinct from c.id::text
       or m.metadata->>'sales_contract_version_id' is distinct from v.id::text
       or m.metadata->>'storage_bucket' is distinct from bucket
       or m.metadata->>'storage_path' is distinct from path
       or m.metadata->>'original_file_name' is distinct from filename
       or lower(btrim(coalesce(m.metadata->>'mime_type',''))) is distinct from mime
       or m.metadata->>'attachment_kind' is distinct from 'file'
       or m.metadata->>'file_kind' is distinct from 'sales_contract_pdf' then
      raise exception using errcode='23514', message='P9_CONTRACT_SEND_EXISTING_MESSAGE_SCOPE_MISMATCH';
    end if;
    if nullif(btrim(coalesce(m.metadata->>'sent_by_user_id','')), '') is null then
      raise exception using errcode='23514', message='P9_CONTRACT_SEND_ACTOR_MISMATCH';
    end if;
    return query select m.id,key,coalesce(m.outbound_delivery_state,'pending'),c.id,v.id,m.external_message_id,
      case when m.outbound_delivery_state='uncertain' then 'uncertain' when m.external_message_id is not null or m.outbound_delivery_state='sent' then 'already_sent' when m.outbound_delivery_state='failed' then 'failed' else 'already_queued' end;
    return;
  end if;
  if p_message_metadata->>'sent_by_user_id' is distinct from p_actor_user_id::text then
    raise exception using errcode='23514', message='P9_CONTRACT_SEND_ACTOR_MISMATCH';
  end if;
  if lower(btrim(coalesce(c.status,''))) is distinct from 'approved' then
    raise exception using errcode='23514', message='P9_CONTRACT_SEND_CONTRACT_NOT_APPROVED';
  end if;
  if c.current_version_id is distinct from p_contract_version_id then
    raise exception using errcode='23514', message='P9_CONTRACT_SEND_VERSION_NOT_CURRENT';
  end if;
  if lower(btrim(coalesce(v.status,''))) is distinct from 'approved' then
    raise exception using errcode='23514', message='P9_CONTRACT_SEND_VERSION_NOT_APPROVED';
  end if;
  select guard_state into guard_state from public.p9_assert_sales_contract_current_proposal_lineage_internal(p_organization_id,p_store_id,c.id);
  if guard_state is distinct from 'current' then raise exception using errcode='P0001', message='P9_CONTRACT_SEND_CURRENT_PROPOSAL_NOT_CURRENT'; end if;
  select * into m from public.insert_message(p_conversation_id,'human','outgoing','document',p_message_content,null,path,
    coalesce(p_message_metadata,'{}'::jsonb) || jsonb_build_object('source','sales_contract_send_route','channel','whatsapp','external_channel','whatsapp','send_external',true,'outbound_origin','sales_contract_send','outbound_idempotency_key',key,'organization_id',p_organization_id,'store_id',p_store_id,'sales_contract_id',c.id,'sales_contract_version_id',v.id,'attachment_kind','file','file_kind','sales_contract_pdf','storage_bucket',bucket,'storage_path',path,'mime_type','application/pdf','original_file_name',filename,'generated_by','system','sent_by_user_id',p_actor_user_id::text));
  if m.id is null
     or m.organization_id is distinct from p_organization_id
     or m.store_id is distinct from p_store_id
     or m.conversation_id is distinct from p_conversation_id
     or m.sender is distinct from 'human'
     or m.direction is distinct from 'outgoing'
     or m.message_type is distinct from 'document'
     or m.media_url is distinct from path
     or m.metadata->>'outbound_origin' is distinct from 'sales_contract_send'
     or m.metadata->>'sales_contract_id' is distinct from c.id::text
     or m.metadata->>'sales_contract_version_id' is distinct from v.id::text then
    raise exception using errcode='23514', message='P9_CONTRACT_SEND_INSERT_SCOPE_MISMATCH';
  end if;
  update public.messages set outbound_idempotency_key=key,outbound_delivery_state='pending',outbound_claimed_at=null,outbound_claimed_by=null,outbound_attempt_started_at=null,outbound_provider_accepted_at=null,outbound_uncertain_at=null,outbound_error_text=null,outbound_commercial_finalized_at=null,outbound_commercial_error_at=null,outbound_commercial_error_text=null where id=m.id and organization_id=p_organization_id and store_id=p_store_id and deleted_at is null returning * into m;
  if not found then raise exception using errcode='P0001', message='P9_CONTRACT_SEND_OUTBOUND_STATE_NOT_APPLIED'; end if;
  return query select m.id,key,m.outbound_delivery_state,c.id,v.id,m.external_message_id,'queued'::text;
end;
$function$;

create or replace function public.finalize_sales_contract_send_by_system(
  p_organization_id uuid, p_store_id uuid, p_contract_id uuid,
  p_contract_version_id uuid, p_message_id uuid, p_idempotency_key text, p_source text
)
returns table (
  sales_contract_id uuid, sales_contract_version_id uuid, message_id uuid,
  external_message_id text, sent_at timestamptz, conversation_event_created boolean,
  outcome text
)
language plpgsql security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  c public.sales_contracts;
  v public.sales_contract_versions;
  m public.messages;
  key text := nullif(btrim(p_idempotency_key),'');
  event_created boolean := false;
  now_at timestamptz;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' and session_user <> 'postgres' then raise exception using errcode='42501', message='P9_CONTRACT_SEND_SERVICE_ROLE_REQUIRED'; end if;
  if p_source is distinct from 'system_sales_contract_send_reconciliation' or key is distinct from 'sales_contract_send:' || p_organization_id || ':' || p_store_id || ':' || p_contract_id || ':' || p_contract_version_id then raise exception using errcode='22023', message='P9_CONTRACT_SEND_FINALIZATION_ARGUMENTS_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(key,0));
  select * into c from public.sales_contracts where id=p_contract_id and organization_id=p_organization_id and store_id=p_store_id for update;
  if not found then raise exception using errcode='P0002', message='P9_CONTRACT_SEND_CONTRACT_LINEAGE_NOT_FOUND'; end if;
  select * into v from public.sales_contract_versions where id=p_contract_version_id and contract_id=p_contract_id and organization_id=p_organization_id and store_id=p_store_id for update;
  if not found then raise exception using errcode='P0002', message='P9_CONTRACT_SEND_CONTRACT_LINEAGE_NOT_FOUND'; end if;
  select * into m from public.messages where id=p_message_id and organization_id=p_organization_id and store_id=p_store_id and outbound_idempotency_key=key for update;
  if not found then raise exception using errcode='P0002', message='P9_CONTRACT_SEND_MESSAGE_NOT_FOUND'; end if;
  if m.deleted_at is not null
     or m.organization_id is distinct from p_organization_id
     or m.store_id is distinct from p_store_id
     or m.conversation_id is distinct from c.conversation_id
     or m.sender is distinct from 'human'
     or m.direction is distinct from 'outgoing'
     or m.message_type is distinct from 'document'
     or m.media_url is null
     or m.external_message_id is null
     or m.outbound_provider_accepted_at is null
     or m.outbound_delivery_state is distinct from 'sent'
     or m.metadata->>'source' is distinct from 'sales_contract_send_route'
     or m.metadata->>'channel' is distinct from 'whatsapp'
     or m.metadata->>'external_channel' is distinct from 'whatsapp'
     or m.metadata->>'send_external' is distinct from 'true'
     or m.metadata->>'outbound_origin' is distinct from 'sales_contract_send'
     or m.metadata->>'outbound_idempotency_key' is distinct from key
     or m.metadata->>'organization_id' is distinct from p_organization_id::text
     or m.metadata->>'store_id' is distinct from p_store_id::text
     or m.metadata->>'sales_contract_id' is distinct from c.id::text
     or m.metadata->>'sales_contract_version_id' is distinct from v.id::text
     or nullif(btrim(coalesce(m.metadata->>'sent_by_user_id','')), '') is null
     or m.metadata->>'storage_bucket' is distinct from v.storage_bucket
     or m.metadata->>'storage_path' is distinct from v.storage_path
     or m.media_url is distinct from v.storage_path
     or m.metadata->>'attachment_kind' is distinct from 'file'
     or m.metadata->>'file_kind' is distinct from 'sales_contract_pdf'
     or lower(btrim(coalesce(m.metadata->>'mime_type',''))) is distinct from 'application/pdf'
     or lower(btrim(coalesce(v.mime_type,''))) is distinct from 'application/pdf' then
    raise exception using errcode='23514', message='P9_CONTRACT_SEND_EXTERNAL_EVIDENCE_REQUIRED';
  end if;
  if m.outbound_commercial_finalized_at is not null then
    return query select c.id,v.id,m.id,m.external_message_id,coalesce(v.sent_at,m.outbound_provider_accepted_at),false,'already_finalized'::text;
    return;
  end if;
  if c.current_version_id is distinct from v.id
     or lower(btrim(coalesce(c.status,''))) is distinct from 'approved'
     or lower(btrim(coalesce(v.status,''))) is distinct from 'approved' then
    raise exception using errcode='23514', message='P9_CONTRACT_SEND_PREVIOUS_STATE_INVALID';
  end if;
  now_at := coalesce(m.outbound_provider_accepted_at, clock_timestamp());
  update public.sales_contract_versions
     set status='sent', sent_at=coalesce(sent_at,now_at)
   where id=v.id and contract_id=c.id and organization_id=p_organization_id and store_id=p_store_id and status='approved'
   returning * into v;
  if not found then raise exception using errcode='P0001', message='P9_CONTRACT_SEND_VERSION_FINALIZATION_FAILED'; end if;
  update public.sales_contracts
     set status='sent_to_customer', sent_at=coalesce(sent_at,now_at), sent_by=(m.metadata->>'sent_by_user_id')::uuid
   where id=c.id and organization_id=p_organization_id and store_id=p_store_id and current_version_id=v.id and status='approved'
   returning * into c;
  if not found then raise exception using errcode='P0001', message='P9_CONTRACT_SEND_CONTRACT_FINALIZATION_FAILED'; end if;
  if c.conversation_id is not null and not exists (select 1 from public.conversation_events where organization_id=p_organization_id and conversation_id=c.conversation_id and event_type='contrato_enviado' and payload->>'message_id'=m.id::text) then
    insert into public.conversation_events(conversation_id,organization_id,event_type,payload,created_by) values(c.conversation_id,p_organization_id,'contrato_enviado',jsonb_build_object('contract_id',c.id,'contract_version_id',v.id,'message_id',m.id,'external_message_id',m.external_message_id,'outbound_idempotency_key',key,'status','sent'),'system'); event_created:=true;
  end if;
  update public.messages set outbound_commercial_finalized_at=clock_timestamp(),outbound_commercial_error_at=null,outbound_commercial_error_text=null where id=m.id and organization_id=p_organization_id and store_id=p_store_id and outbound_delivery_state='sent' and external_message_id=m.external_message_id and outbound_commercial_finalized_at is null returning * into m;
  if not found then raise exception using errcode='P0001', message='P9_CONTRACT_SEND_FINALIZATION_MARKER_LOST'; end if;
  return query select c.id,v.id,m.id,m.external_message_id,now_at,event_created,'finalized'::text;
end;
$function$;

alter function public.get_pending_external_messages_v2(uuid,uuid,integer,integer) owner to postgres;
alter function public.validate_sales_contract_send_before_external_by_system(uuid,uuid,uuid) owner to postgres;
alter function public.validate_or_start_sales_contract_send_by_system(uuid,uuid,uuid) owner to postgres;
alter function public.materialize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid) owner to postgres;
alter function public.finalize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,text) owner to postgres;
revoke all on function public.validate_or_start_sales_contract_send_by_system(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.materialize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid) from public,anon,authenticated;
revoke all on function public.finalize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.validate_sales_contract_send_before_external_by_system(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.validate_sales_contract_send_before_external_by_system(uuid,uuid,uuid) to service_role;
grant execute on function public.validate_or_start_sales_contract_send_by_system(uuid,uuid,uuid) to service_role;
grant execute on function public.materialize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid) to service_role;
grant execute on function public.finalize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,text) to service_role;
commit;
