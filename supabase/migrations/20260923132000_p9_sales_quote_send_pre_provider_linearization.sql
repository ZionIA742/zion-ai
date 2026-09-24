begin;

-- ============================================================================
-- P9 / Bloco 6 / Etapa 6.6
--
-- Lineariza a identidade exata da sales quote version no ultimo boundary
-- controlado antes do POST externo.
--
-- Contrato:
--   * sales_quote_send continua usando o transporte outbound canonico existente;
--   * a versao deve continuar current/approved/not-expired imediatamente antes
--     da tentativa externa;
--   * o lock de sales_quotes permanece segurado enquanto o gate geral move
--     processing -> uncertain;
--   * depois que uma tentativa da current version entrou em processing/attempt,
--     uma nova versao generated nao pode ultrapassar esse envio;
--   * pending ainda pode ser superseded antes de qualquer tentativa externa.
-- ============================================================================


-- ============================================================================
-- 1. Global DB invariant for generated quote versions
-- ============================================================================

create or replace function public.enforce_sales_quote_version_external_send_linearization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_quote public.sales_quotes%rowtype;
  v_blocking_message_id uuid;
begin
  if pg_catalog.lower(pg_catalog.btrim(coalesce(new.status, ''))) <> 'generated' then
    return new;
  end if;

  select quote_row.*
    into v_quote
    from public.sales_quotes quote_row
   where quote_row.id = new.quote_id
     and quote_row.organization_id = new.organization_id
     and quote_row.store_id = new.store_id
   for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'ZION_SALES_QUOTE_VERSION_QUOTE_NOT_FOUND';
  end if;

  if v_quote.current_version_id is null then
    return new;
  end if;

  select message_row.id
    into v_blocking_message_id
    from public.messages message_row
   where message_row.organization_id = new.organization_id
     and message_row.store_id = new.store_id
     and message_row.deleted_at is null
     and coalesce(message_row.metadata ->> 'outbound_origin', '') = 'sales_quote_send'
     and coalesce(message_row.metadata ->> 'source', '') = 'sales_quote_send_route'
     and coalesce(message_row.metadata ->> 'sales_quote_id', '') = new.quote_id::tex
     and coalesce(message_row.metadata ->> 'sales_quote_version_id', '') =
           v_quote.current_version_id::tex
     and (
       coalesce(message_row.outbound_delivery_state, '') in (
         'processing',
         'uncertain',
         'sent'
       )
       or message_row.outbound_attempt_started_at is not null
       or message_row.outbound_provider_accepted_at is not null
       or message_row.external_message_id is not null
     )
   order by message_row.created_at desc, message_row.id desc
   limit 1;

  if v_blocking_message_id is not null then
    raise exception using
      errcode = '23514',
      message =
        'ZION_SALES_QUOTE_VERSION_EXTERNAL_SEND_IN_FLIGHT_OR_REQUIRES_RECONCILIATION';
  end if;

  return new;
end;
$function$;

alter function public.enforce_sales_quote_version_external_send_linearization()
owner to postgres;

revoke all on function
  public.enforce_sales_quote_version_external_send_linearization()
from public, anon, authenticated;

drop trigger if exists
  trg_sales_quote_version_external_send_linearization
on public.sales_quote_versions;

create trigger trg_sales_quote_version_external_send_linearization
before insert on public.sales_quote_versions
for each row
execute function public.enforce_sales_quote_version_external_send_linearization();


-- ============================================================================
-- 2. Quote-aware final external send gate
--
-- Non-quote outbound delegates unchanged to the existing P9 transport gate.
-- sales_quote_send adds quote/version authority under a quote row lock and
-- invokes that existing gate before releasing the lock.
-- ============================================================================

create or replace function public.validate_or_cancel_whatsapp_external_send_v2_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );

  v_message public.messages%rowtype;
  v_fresh_message public.messages%rowtype;
  v_quote public.sales_quotes%rowtype;
  v_version public.sales_quote_versions%rowtype;
  v_quote_kind_readiness record;

  v_outbound_origin text;
  v_source text;
  v_quote_id uuid;
  v_version_id uuid;
  v_opportunity_id uuid;
  v_expected_key text;
  v_block_reason text;
  v_delegate_result jsonb;
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'whatsapp external send v2 gate is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_message_id is null then
    raise exception using
      errcode = '22023',
      message = 'WHATSAPP_EXTERNAL_SEND_V2_GATE_ARGUMENTS_REQUIRED';
  end if;

  -- Initial identity read. No quote lock is taken until we know this is a
  -- sales_quote_send operation and can resolve its exact quote id.
  select message_row.*
    into v_message
    from public.messages message_row
   where message_row.id = p_message_id
     and message_row.organization_id = p_organization_id
     and message_row.store_id = p_store_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'WHATSAPP_EXTERNAL_SEND_V2_GATE_MESSAGE_NOT_FOUND';
  end if;

  v_outbound_origin :=
    nullif(pg_catalog.btrim(coalesce(v_message.metadata ->> 'outbound_origin', '')), '');
  v_source :=
    nullif(pg_catalog.btrim(coalesce(v_message.metadata ->> 'source', '')), '');

  -- Preserve every non-quote transport path exactly as before.
  if v_outbound_origin is distinct from 'sales_quote_send' then
    return public.validate_or_cancel_whatsapp_external_send_by_system(
      p_organization_id,
      p_store_id,
      p_message_id
    );
  end if;

  begin
    v_quote_id :=
      nullif(v_message.metadata ->> 'sales_quote_id', '')::uuid;
    v_version_id :=
      nullif(v_message.metadata ->> 'sales_quote_version_id', '')::uuid;
    v_opportunity_id :=
      nullif(v_message.metadata ->> 'commercial_opportunity_id', '')::uuid;
  exception
    when invalid_text_representation then
      v_block_reason := 'sales_quote_send_identity_invalid';
  end;

  if v_block_reason is null
     and (
       v_source is distinct from 'sales_quote_send_route'
       or v_quote_id is null
       or v_version_id is null
       or v_opportunity_id is null
     ) then
    v_block_reason := 'sales_quote_send_identity_required';
  end if;

  if v_block_reason is null then
    v_expected_key :=
      'sales_quote_send:'
      || p_organization_id::text || ':'
      || p_store_id::text || ':'
      || v_opportunity_id::text || ':'
      || v_quote_id::text || ':'
      || v_version_id::text;

    if v_message.outbound_idempotency_key is distinct from v_expected_key
       or coalesce(v_message.metadata ->> 'outbound_idempotency_key', '')
            is distinct from v_expected_key then
      v_block_reason := 'sales_quote_send_idempotency_identity_mismatch';
    end if;
  end if;

  /*
   * Serialize this exact outbound operation with the same deterministic
   * advisory key used by canonical sales_quote_send materialization.
   *
   * The initial message read above is identity discovery only. No external
   * authorization depends on that unlocked snapshot.
   */
  if v_block_reason is null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_expected_key, 0)
    );
  end if;

  -- Quote lock is the serialization point shared with version creation.
  if v_block_reason is null then
    select quote_row.*
      into v_quote
      from public.sales_quotes quote_row
     where quote_row.id = v_quote_id
       and quote_row.organization_id = p_organization_id
       and quote_row.store_id = p_store_id
       and quote_row.commercial_opportunity_id = v_opportunity_id
     for update;

    if not found then
      v_block_reason := 'sales_quote_send_quote_scope_mismatch';
    end if;
  end if;

  /*
   * Keep the same quote -> version ordering already used by canonical
   * quote materialization. The version remains locked through the final
   * provider authorization boundary.
   */
  if v_block_reason is null then
    select version_row.*
      into v_version
      from public.sales_quote_versions version_row
     where version_row.id = v_version_id
       and version_row.quote_id = v_quote_id
       and version_row.organization_id = p_organization_id
       and version_row.store_id = p_store_id
     for update;

    if not found then
      v_block_reason := 'sales_quote_send_version_scope_mismatch';
    end if;
  end if;

  /*
   * insert_message and the canonical WhatsApp transport contract serialize
   * conversation mutations with this xact lock. Take it before the message
   * row lock so this wrapper does not invert conversation -> message ordering
   * when it delegates to the existing final transport gate.
   */
  if v_block_reason is null then
    perform public.private_acquire_sales_contract_conversation_xact_lock(
      v_quote.conversation_id
    );
  end if;

  -- Fresh message authority after quote/version/conversation locks are held.
  if v_block_reason is null then
    select message_row.*
      into v_fresh_message
      from public.messages message_row
     where message_row.id = p_message_id
       and message_row.organization_id = p_organization_id
       and message_row.store_id = p_store_id
     for update;

    if not found then
      raise exception using
        errcode = 'P0002',
        message = 'WHATSAPP_EXTERNAL_SEND_V2_GATE_MESSAGE_DISAPPEARED';
    end if;

    if coalesce(v_fresh_message.metadata ->> 'outbound_origin', '')
          is distinct from 'sales_quote_send'
       or coalesce(v_fresh_message.metadata ->> 'source', '')
          is distinct from 'sales_quote_send_route'
       or coalesce(v_fresh_message.metadata ->> 'sales_quote_id', '')
          is distinct from v_quote_id::tex
       or coalesce(v_fresh_message.metadata ->> 'sales_quote_version_id', '')
          is distinct from v_version_id::tex
       or coalesce(v_fresh_message.metadata ->> 'commercial_opportunity_id', '')
          is distinct from v_opportunity_id::tex
       or v_fresh_message.outbound_idempotency_key is distinct from v_expected_key
       or coalesce(v_fresh_message.metadata ->> 'outbound_idempotency_key', '')
          is distinct from v_expected_key
       or v_fresh_message.sender is distinct from 'human'
       or v_fresh_message.direction is distinct from 'outgoing'
       or pg_catalog.lower(
            pg_catalog.btrim(coalesce(v_fresh_message.message_type, ''))
          ) is distinct from 'document'
       or coalesce(v_fresh_message.metadata ->> 'send_external', 'false')
          is distinct from 'true'
       or coalesce(v_fresh_message.metadata ->> 'external_channel', '')
          is distinct from 'whatsapp'
       or coalesce(v_fresh_message.outbound_delivery_state, '')
          is distinct from 'processing'
       or v_fresh_message.outbound_attempt_started_at is not null
       or v_fresh_message.external_message_id is not null
       or v_fresh_message.deleted_at is not null then
      v_block_reason := 'sales_quote_send_message_authority_changed';
    end if;
  end if;

  if v_block_reason is null then
    if v_quote.conversation_id is distinct from v_fresh_message.conversation_id then
      v_block_reason := 'sales_quote_send_conversation_scope_mismatch';
    elsif v_quote.current_version_id is distinct from v_version_id then
      v_block_reason := 'sales_quote_send_version_stale';
    elsif pg_catalog.lower(pg_catalog.btrim(coalesce(v_quote.status, '')))
            is distinct from 'approved'
       or v_quote.approved_at is null
       or v_quote.approved_by is null
       or v_quote.sent_at is not null then
      v_block_reason := 'sales_quote_send_quote_not_approved';
    end if;
  end if;

  if v_block_reason is null then
    if pg_catalog.lower(pg_catalog.btrim(coalesce(v_version.status, '')))
         is distinct from 'approved'
       or v_version.sent_at is not null then
      v_block_reason := 'sales_quote_send_version_not_approved';
    elsif public.sales_quote_version_is_expired(
      v_version.quote_snapshot,
      v_quote.valid_until,
      (now() at time zone 'UTC')::date
    ) then
      v_block_reason := 'sales_quote_send_version_expired';
    end if;
  end if;
  /*
   * Explicit preliminary/definitive quote kinds depend on mutable commercial
   * authority (especially technical-visit state). The HTTP route checks this
   * before materialization, but queue delay means that result cannot authorize
   * the later provider POST.
   *
   * Re-read the canonical authority while the quote/version locks are held.
   * Legacy quote_kind values remain compatible with the existing contract.
   *
   * Infrastructure/reader errors intentionally propagate. They are technical
   * pre-attempt failures, so the worker releases the claim instead of
   * terminally consuming the outbound operation.
   */
  if v_block_reason is null
     and pg_catalog.lower(pg_catalog.btrim(coalesce(v_version.quote_kind, '')))
           in ('preliminary', 'definitive') then

    select readiness_row.*
      into v_quote_kind_readiness
      from public.read_quote_kind_send_readiness_scoped(
        p_organization_id,
        p_store_id,
        v_opportunity_id,
        v_version_id
      ) readiness_row;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'SALES_QUOTE_SEND_QUOTE_KIND_READINESS_EMPTY';
    end if;

    if pg_catalog.lower(
         pg_catalog.btrim(
           coalesce(v_quote_kind_readiness.readiness_state, '')
         )
       ) is distinct from 'ready' then
      v_block_reason := 'sales_quote_send_quote_kind_not_ready';
    end if;
  end if;

  if v_block_reason is not null then
    update public.messages message_row
       set outbound_delivery_state = 'failed',
           outbound_claimed_at = null,
           outbound_claimed_by = null,
           outbound_attempt_started_at = null,
           outbound_uncertain_at = null,
           outbound_error_text =
             ('ZION_EXTERNAL_SEND_BLOCKED:' || v_block_reason)::tex
     where message_row.id = p_message_id
       and message_row.organization_id = p_organization_id
       and message_row.store_id = p_store_id
       and message_row.outbound_delivery_state = 'processing'
       and message_row.outbound_attempt_started_at is null
       and message_row.external_message_id is null;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'WHATSAPP_EXTERNAL_SEND_V2_GATE_BLOCK_TRANSITION_LOST';
    end if;

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'decision', 'blocked',
      'reason', v_block_reason,
      'message_id', p_message_id,
      'conversation_id', v_message.conversation_id,
      'outbound_origin', 'sales_quote_send',
      'sales_quote_id', v_quote_id,
      'sales_quote_version_id', v_version_id
    );
  end if;

  /*
   * IMPORTANT:
   * The quote row lock is still held here.
   *
   * The existing canonical transport gate atomically moves:
   *
   *     processing -> uncertain
   *
   * before returning to Node. Therefore version creation cannot pass the
   * trigger above between this quote check and the persisted attempt start.
   */
  v_delegate_result :=
    public.validate_or_cancel_whatsapp_external_send_by_system(
      p_organization_id,
      p_store_id,
      p_message_id
    );

  return v_delegate_result;
end;
$function$;

alter function public.validate_or_cancel_whatsapp_external_send_v2_by_system(
  uuid,
  uuid,
  uuid
) owner to postgres;

comment on function
  public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid, uuid, uuid)
is
  'P9 6.6 quote-aware final external SEND gate. sales_quote_send is revalidated against exact current approved non-expired quote/version under the quote lock, then delegates to the canonical WhatsApp transport gate which persists the attempt before provider POST.';

revoke all on function
  public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid, uuid, uuid)
from public;

revoke all on function
  public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid, uuid, uuid)
from anon;

revoke all on function
  public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid, uuid, uuid)
from authenticated;

revoke all on function
  public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid, uuid, uuid)
from service_role;

grant execute on function
  public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid, uuid, uuid)
to service_role;


-- ============================================================================
-- 3. Postconditions
-- ============================================================================

do $postconditions$
declare
  v_gate_definition text;
  v_trigger_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)'::regprocedure
  )
    into v_gate_definition;

  if v_gate_definition is null
     or v_gate_definition not ilike '%sales_quote_send_version_stale%'
     or v_gate_definition not ilike '%current_version_id%'
     or v_gate_definition not ilike '%for update%'
     or v_gate_definition not ilike '%sales_quote_version_is_expired%'
     or v_gate_definition not ilike
          '%read_quote_kind_send_readiness_scoped%'
     or v_gate_definition not ilike
          '%sales_quote_send_quote_kind_not_ready%'
     or v_gate_definition not ilike
          '%pg_advisory_xact_lock%'
     or v_gate_definition not ilike
          '%private_acquire_sales_contract_conversation_xact_lock%'
     or position(
          'from public.sales_quotes quote_row'
          in v_gate_definition
        ) = 0
     or position(
          'from public.sales_quote_versions version_row'
          in v_gate_definition
        ) <= position(
          'from public.sales_quotes quote_row'
          in v_gate_definition
        )
     or position(
          'private_acquire_sales_contract_conversation_xact_lock'
          in v_gate_definition
        ) <= position(
          'from public.sales_quote_versions version_row'
          in v_gate_definition
        )
     or position(
          'into v_fresh_message'
          in v_gate_definition
        ) <= position(
          'private_acquire_sales_contract_conversation_xact_lock'
          in v_gate_definition
        )
     or v_gate_definition not ilike
          '%validate_or_cancel_whatsapp_external_send_by_system%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: P9 6.6 quote-aware final gate is incomplete';
  end if;

  if has_function_privilege(
       'public',
       'public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)',
       'execute'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: P9 6.6 quote-aware gate ACL invalid';
  end if;

  select pg_catalog.pg_get_triggerdef(trigger_row.oid)
    into v_trigger_definition
    from pg_catalog.pg_trigger trigger_row
   where trigger_row.tgrelid = 'public.sales_quote_versions'::regclass
     and trigger_row.tgname =
           'trg_sales_quote_version_external_send_linearization'
     and not trigger_row.tgisinternal;

  if v_trigger_definition is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: P9 6.6 version/send linearization trigger missing';
  end if;

  if pg_catalog.pg_get_functiondef(
       'public.enforce_sales_quote_version_external_send_linearization()'::regprocedure
     ) not ilike
       '%ZION_SALES_QUOTE_VERSION_EXTERNAL_SEND_IN_FLIGHT_OR_REQUIRES_RECONCILIATION%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: P9 6.6 version creation guard incomplete';
  end if;
end;
$postconditions$;

commit;