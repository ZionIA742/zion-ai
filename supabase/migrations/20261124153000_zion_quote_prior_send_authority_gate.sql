begin;

set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $migration$
declare
  v_signature regprocedure :=
    'public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)'::regprocedure;

  v_original_body text;
  v_definition text;
  v_modified text;
  v_installed_body text;
  v_installed_definition text;

  v_expected_body_hash text :=
    'fdd095bfe1d6ea642c80cc34d24d3baa';

  v_new_body text := $new_body$
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
  v_specialized boolean := false;
  v_prior_send_authorized boolean := false;
  v_prior_valid_until date;
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
          is distinct from v_quote_id::text
       or coalesce(v_fresh_message.metadata ->> 'sales_quote_version_id', '')
          is distinct from v_version_id::text
       or coalesce(v_fresh_message.metadata ->> 'commercial_opportunity_id', '')
          is distinct from v_opportunity_id::text
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
    if (v_fresh_message.metadata ? 'commercial_negotiation_concession_id')
         is distinct from
       (v_fresh_message.metadata ? 'commercial_negotiation_concession_materialization_id') then
      v_block_reason := 'sales_quote_send_specialized_identity_incomplete';
    else
      v_specialized :=
        v_fresh_message.metadata ? 'commercial_negotiation_concession_id'
        and v_fresh_message.metadata ? 'commercial_negotiation_concession_materialization_id';

      if v_specialized then
        perform public.p9_8_5_validate_specialized_quote_send_authority(
          p_organization_id,
          p_store_id,
          p_message_id,
          v_quote_id,
          v_version_id,
          v_opportunity_id
        );
      end if;
    end if;
  end if;

  -- A revisao humana nao invalida uma autorizacao anterior.
  -- Somente mensagens previamente autorizadas podem usar
  -- a evidencia historica correspondente ao mesmo PDF.
  if v_block_reason is null
     and not v_specialized
     and v_quote.current_version_id
           is distinct from v_version_id
     and exists (
       select 1
       from public.sales_quote_versions current_revision
       where current_revision.id = v_quote.current_version_id
         and current_revision.quote_id = v_quote_id
         and current_revision.organization_id = p_organization_id
         and current_revision.store_id = p_store_id
         and current_revision.generated_by = 'human_revision'
     )
  then

    select e.valid_until
    into v_prior_valid_until
    from public.human_quote_revision_prior_send_evidence e
    where e.message_id = p_message_id
      and e.organization_id = p_organization_id
      and e.store_id = p_store_id
      and e.conversation_id = v_fresh_message.conversation_id
      and e.commercial_opportunity_id = v_opportunity_id
      and e.quote_id = v_quote_id
      and e.version_id = v_version_id
      and e.outbound_idempotency_key = v_expected_key
      and e.storage_bucket =
        v_fresh_message.metadata ->> 'storage_bucket'
      and e.storage_path =
        v_fresh_message.metadata ->> 'storage_path'
      and e.storage_path = v_fresh_message.media_url
      and nullif(btrim(e.approved_by), '') is not null
      and v_version.status in ('approved', 'superseded')
      and v_version.sent_at is null;

    v_prior_send_authorized := found;

  end if;

  if v_block_reason is null then
    if v_quote.conversation_id
         is distinct from v_fresh_message.conversation_id then

      v_block_reason :=
        'sales_quote_send_conversation_scope_mismatch';

    elsif v_quote.current_version_id
            is distinct from v_version_id
          and not v_prior_send_authorized then

      v_block_reason :=
        'sales_quote_send_version_stale';

    elsif v_quote.sent_at is not null
          and not v_prior_send_authorized then

      v_block_reason :=
        'sales_quote_send_quote_not_approved';

    elsif not v_specialized
          and not v_prior_send_authorized
          and (
            pg_catalog.lower(
              pg_catalog.btrim(
                coalesce(v_quote.status, '')
              )
            ) is distinct from 'approved'
            or v_quote.approved_at is null
            or v_quote.approved_by is null
          ) then

      v_block_reason :=
        'sales_quote_send_quote_not_approved';

    end if;
  end if;

  if v_block_reason is null then
    if v_version.sent_at is not null then

      v_block_reason :=
        'sales_quote_send_version_not_approved';

    elsif not v_specialized
          and not v_prior_send_authorized
          and pg_catalog.lower(
            pg_catalog.btrim(
              coalesce(v_version.status, '')
            )
          ) is distinct from 'approved' then

      v_block_reason :=
        'sales_quote_send_version_not_approved';

    elsif v_specialized
          and pg_catalog.lower(
            pg_catalog.btrim(
              coalesce(v_version.status, '')
            )
          ) not in ('generated', 'pending_review') then

      v_block_reason :=
        'sales_quote_send_version_not_approved';

    elsif (
      case
        when v_prior_send_authorized then
          coalesce(
            v_prior_valid_until <
              (now() at time zone 'UTC')::date,
            false
          )
        else
          public.sales_quote_version_is_expired(
            v_version.quote_snapshot,
            v_quote.valid_until,
            (now() at time zone 'UTC')::date
          )
      end
    ) then

      v_block_reason :=
        'sales_quote_send_version_expired';

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
             ('ZION_EXTERNAL_SEND_BLOCKED:' || v_block_reason)::text
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
$new_body$;

begin

  select p.prosrc, pg_get_functiondef(p.oid)
  into v_original_body, v_definition
  from pg_proc p
  where p.oid = v_signature
    and p.prosecdef is true
    and p.proowner = 'postgres'::regrole;

  if v_definition is null then
    raise exception 'ZION_QUOTE_GATE_NOT_FOUND';
  end if;

  if md5(
    btrim(
      replace(v_original_body, chr(13), ''),
      E' \t\n'
    )
  ) is distinct from v_expected_body_hash then

    raise exception 'ZION_QUOTE_GATE_SOURCE_CHANGED';

  end if;

  if to_regclass(
    'public.human_quote_revision_prior_send_evidence'
  ) is null then

    raise exception 'ZION_PRIOR_SEND_EVIDENCE_MISSING';

  end if;

  if (
    length(v_definition)
    - length(replace(
        v_definition,
        v_original_body,
        ''
      ))
  ) <> length(v_original_body) then

    raise exception 'ZION_QUOTE_GATE_BODY_ANCHOR_INVALID';

  end if;

  -- Normalize CRLF in the expected body before creating the function.
  v_new_body := replace(v_new_body, chr(13), '');

  v_modified := replace(
    v_definition,
    v_original_body,
    v_new_body
  );

  execute v_modified;

  select replace(p.prosrc, chr(13), ''),
         pg_get_functiondef(p.oid)
  into v_installed_body, v_installed_definition
  from pg_proc p
  where p.oid = v_signature;

  if v_installed_body is distinct from v_new_body
     or replace(v_installed_definition, chr(13), '')
          is distinct from replace(v_modified, chr(13), '') then
    raise exception using
      message = 'ZION_QUOTE_GATE_INSTALLATION_MISMATCH',
      detail = format(
        'expected_body_md5=%s actual_body_md5=%s expected_len=%s actual_len=%s expected_definition_md5=%s actual_definition_md5=%s',
        md5(v_new_body), md5(v_installed_body),
        length(v_new_body), length(v_installed_body),
        md5(replace(v_modified, chr(13), '')),
        md5(replace(v_installed_definition, chr(13), ''))
      );
  end if;

end;
$migration$;

commit;
