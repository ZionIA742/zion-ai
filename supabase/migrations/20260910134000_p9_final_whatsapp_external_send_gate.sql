begin;

-- ============================================================================
-- P9 5.3 - FINAL WHATSAPP EXTERNAL SEND GATE
--
-- Invariants:
-- - Opt-out is NOT Lost.
-- - This migration installs the final external SEND authority gate only.
-- - Canonical follow-up external activation is deliberately deferred until
--   the deployed WhatsApp sender consumes this gate.
-- - Sales AI external transport is revalidated at the final controlled
--   boundary before the provider attempt.
-- - No latest/first opportunity lookup is allowed.
-- - Authority-blocked outbound becomes terminal failed, never pending retry.
-- ============================================================================

create or replace function public.get_active_whatsapp_integration_for_external_send_by_system(
  p_organization_id uuid,
  p_store_id uuid
)
returns table(
  access_token text,
  phone_number_id text
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'pg_temp', 'public'
set row_security to 'off'
as $function$
  with eligible_integration as (
    select
      integration_row.access_token,
      pg_catalog.btrim(integration_row.phone_number_id) as phone_number_id,
      pg_catalog.count(*) over () as eligible_count
    from public.external_integrations integration_row
    where integration_row.organization_id = p_organization_id
      and integration_row.store_id = p_store_id
      and integration_row.provider = 'whatsapp'
      and integration_row.is_active = true
      and integration_row.status = 'active'
      and nullif(
            pg_catalog.btrim(coalesce(integration_row.phone_number_id, '')),
            ''
          ) is not null
  )
  select
    eligible_integration.access_token,
    eligible_integration.phone_number_id
  from eligible_integration
  where eligible_integration.eligible_count = 1;
$function$;

alter function public.get_active_whatsapp_integration_for_external_send_by_system(
  uuid,
  uuid
) owner to postgres;

revoke all on function
  public.get_active_whatsapp_integration_for_external_send_by_system(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.get_active_whatsapp_integration_for_external_send_by_system(uuid, uuid)
to service_role;


create or replace function public.is_real_whatsapp_conversation_for_external_send(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'pg_temp', 'public'
set row_security to 'off'
as $function$
  select
    p_organization_id is not null
    and p_store_id is not null
    and p_conversation_id is not null

    and exists (
      select 1
      from public.conversations conversation_row
      join public.leads lead_row
        on lead_row.id = conversation_row.lead_id
       and lead_row.organization_id = p_organization_id
       and lead_row.store_id = p_store_id
      where conversation_row.id = p_conversation_id
        and conversation_row.organization_id = p_organization_id
    )

    and exists (
      select 1
      from public.get_active_whatsapp_integration_for_external_send_by_system(
        p_organization_id,
        p_store_id
      ) integration_row
    )

    and exists (
      select 1
      from public.messages message_row
      join public.get_active_whatsapp_integration_for_external_send_by_system(
        p_organization_id,
        p_store_id
      ) integration_row
        on message_row.metadata ->> 'phone_number_id' = integration_row.phone_number_id
      where message_row.organization_id = p_organization_id
        and message_row.store_id = p_store_id
        and message_row.conversation_id = p_conversation_id
        and message_row.sender = 'user'
        and message_row.direction = 'incoming'
        and message_row.deleted_at is null
        and message_row.metadata ->> 'source' = 'meta_whatsapp_webhook'
        and message_row.metadata ->> 'channel' = 'whatsapp'
        and message_row.metadata ->> 'external_channel' = 'whatsapp'
        and message_row.metadata ->> 'provider' = 'meta'
    );
$function$;

alter function public.is_real_whatsapp_conversation_for_external_send(
  uuid,
  uuid,
  uuid
) owner to postgres;

revoke all on function
  public.is_real_whatsapp_conversation_for_external_send(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.is_real_whatsapp_conversation_for_external_send(uuid, uuid, uuid)
to service_role;


create or replace function public.validate_or_cancel_whatsapp_external_send_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp', 'public'
set row_security to 'off'
as $function$
declare
  v_request_role text :=
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');

  v_message public.messages;
  v_source_message public.messages;

  v_outbound_kind text;
  v_outbound_origin text;

  v_opportunity_id uuid;
  v_followup_id uuid;
  v_followup_cycle integer;
  v_action_queue_id uuid;
  v_source_message_id uuid;

  v_context_opportunity_id uuid;
  v_source_context_opportunity_id uuid;

  v_followup public.commercial_opportunity_followups;
  v_queue public.ai_sales_action_queue;

  v_block_reason text;
  v_stop_event_exists boolean := false;
  v_any_opt_out_exists boolean := false;
  v_newer_incoming_exists boolean := false;
  v_real_whatsapp boolean := false;

  v_initial_sender text;
  v_initial_outbound_kind text;
  v_initial_opportunity_id uuid;
  v_initial_followup_id uuid;
  v_initial_followup_cycle integer;
  v_initial_action_queue_id uuid;

  v_opportunity public.commercial_opportunities;
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'whatsapp external send gate is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_message_id is null then
    raise exception using
      errcode = '22023',
      message = 'WHATSAPP_EXTERNAL_SEND_GATE_ARGUMENTS_REQUIRED';
  end if;

  /*
   * Initial identity read.
   *
   * No SEND authority is granted from this read. For Sales AI outbound we use
   * its identities only to acquire the same commercial locks used by the
   * opt-out/follow-up writers. The message is re-read after those locks and
   * the conversation lock are held.
   */
  select message_row.*
  into v_message
  from public.messages message_row
  where message_row.id = p_message_id
    and message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'WHATSAPP_EXTERNAL_SEND_GATE_MESSAGE_NOT_FOUND_IN_SCOPE';
  end if;

  if v_message.conversation_id is null then
    raise exception using
      errcode = '23514',
      message = 'WHATSAPP_EXTERNAL_SEND_GATE_CONVERSATION_REQUIRED';
  end if;

  v_initial_sender := v_message.sender;

  v_initial_outbound_kind :=
    nullif(
      pg_catalog.btrim(
        coalesce(v_message.metadata ->> 'outbound_kind', '')
      ),
      ''
    );

  /*
   * Every external Sales AI message must carry an explicit outbound kind.
   * There is deliberately no permissive legacy AI fallback.
   */
  if v_message.sender = 'ai' then
    if v_initial_outbound_kind is null then
      v_block_reason := 'sales_ai_outbound_kind_required';
    elsif v_initial_outbound_kind not in (
      'reactive_ai_reply',
      'stop_contact_ack',
      'canonical_followup'
    ) then
      v_block_reason := 'unsupported_sales_ai_outbound_kind';
    end if;
  end if;

  /*
   * Serialize every recognized Sales AI outbound against its exact commercial
   * opportunity. The opt-out writer locks this same opportunity.
   */
  if v_block_reason is null
     and v_message.sender = 'ai' then
    begin
      v_initial_opportunity_id :=
        nullif(
          v_message.metadata ->> 'commercial_opportunity_id',
          ''
        )::uuid;
    exception
      when invalid_text_representation then
        v_block_reason := 'invalid_sales_ai_opportunity_identity';
    end;

    if v_block_reason is null
       and v_initial_opportunity_id is null then
      v_block_reason := 'sales_ai_opportunity_identity_required';
    end if;

    if v_block_reason is null then
      select opportunity_row.*
      into v_opportunity
      from public.commercial_opportunities opportunity_row
      where opportunity_row.id = v_initial_opportunity_id
        and opportunity_row.organization_id = p_organization_id
        and opportunity_row.store_id = p_store_id
      for update;

      if not found then
        v_block_reason := 'sales_ai_opportunity_scope_mismatch';
      elsif v_opportunity.primary_conversation_id
              is distinct from v_message.conversation_id then
        v_block_reason := 'sales_ai_opportunity_conversation_mismatch';
      end if;
    end if;
  end if;

  /*
   * Canonical follow-up adds its exact follow-up identity.
   * Lock order matches commercial writers:
   *
   *   opportunity -> followup -> conversation
   */
  if v_block_reason is null
     and v_message.sender = 'ai'
     and v_initial_outbound_kind = 'canonical_followup' then
    begin
      v_initial_followup_id :=
        nullif(v_message.metadata ->> 'followup_id', '')::uuid;

      v_initial_followup_cycle :=
        nullif(v_message.metadata ->> 'followup_cycle', '')::integer;

      v_initial_action_queue_id :=
        nullif(v_message.metadata ->> 'action_queue_id', '')::uuid;
    exception
      when invalid_text_representation then
        v_block_reason := 'invalid_canonical_followup_identity';
    end;

    if v_block_reason is null
       and (
         v_initial_followup_id is null
         or v_initial_followup_cycle is null
         or v_initial_action_queue_id is null
       ) then
      v_block_reason := 'canonical_followup_identity_required';
    end if;

    if v_block_reason is null then
      select followup_row.*
      into v_followup
      from public.commercial_opportunity_followups followup_row
      where followup_row.id = v_initial_followup_id
        and followup_row.organization_id = p_organization_id
        and followup_row.store_id = p_store_id
        and followup_row.commercial_opportunity_id =
              v_initial_opportunity_id
        and followup_row.cycle = v_initial_followup_cycle
      for update;

      if not found then
        v_block_reason := 'canonical_followup_scope_mismatch';
      elsif v_followup.status <> 'active' then
        v_block_reason := 'stale_followup';
      end if;
    end if;
  end if;

  /*
   * Same transaction-level conversation lock used by insert_message.
   */
  perform public.private_acquire_sales_contract_conversation_xact_lock(
    v_message.conversation_id
  );

  /*
   * Fresh authority read after all required serialization locks are held.
   */
  select message_row.*
  into v_message
  from public.messages message_row
  where message_row.id = p_message_id
    and message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id
    and message_row.conversation_id = v_message.conversation_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'WHATSAPP_EXTERNAL_SEND_GATE_MESSAGE_DISAPPEARED';
  end if;

  v_outbound_kind :=
    nullif(
      pg_catalog.btrim(
        coalesce(v_message.metadata ->> 'outbound_kind', '')
      ),
      ''
    );

  v_outbound_origin :=
    nullif(
      pg_catalog.btrim(
        coalesce(v_message.metadata ->> 'outbound_origin', '')
      ),
      ''
    );

  if v_block_reason is null
     and v_message.sender is distinct from v_initial_sender then
    v_block_reason := 'message_sender_changed_during_gate';
  end if;

  if v_block_reason is null
     and v_outbound_kind is distinct from v_initial_outbound_kind then
    v_block_reason := 'message_authority_metadata_changed_during_gate';
  end if;

  if v_block_reason is null then
    if v_message.deleted_at is not null
       or v_message.direction <> 'outgoing'
       or v_message.external_message_id is not null
       or coalesce(v_message.metadata ->> 'send_external', 'false') <> 'true'
       or coalesce(v_message.metadata ->> 'external_channel', '') <> 'whatsapp'
       or coalesce(v_message.outbound_delivery_state, '') <> 'processing'
       or v_message.outbound_attempt_started_at is not null then
      v_block_reason := 'message_not_claimed_for_external_send';
    end if;
  end if;

  /*
   * Fresh Sales AI opportunity identity must equal the identity whose row
   * lock is held.
   */
  if v_block_reason is null
     and v_message.sender = 'ai' then
    begin
      v_opportunity_id :=
        nullif(
          v_message.metadata ->> 'commercial_opportunity_id',
          ''
        )::uuid;
    exception
      when invalid_text_representation then
        v_block_reason := 'invalid_sales_ai_opportunity_identity';
    end;

    if v_block_reason is null
       and (
         v_opportunity_id is null
         or v_opportunity_id is distinct from v_initial_opportunity_id
       ) then
      v_block_reason := 'sales_ai_opportunity_identity_changed_during_gate';
    end if;
  end if;

  /*
   * At the final controlled boundary, Sales AI external transport must still
   * belong to a proven real Meta WhatsApp conversation.
   */
  if v_block_reason is null
     and v_message.sender = 'ai' then
    v_real_whatsapp :=
      public.is_real_whatsapp_conversation_for_external_send(
        p_organization_id,
        p_store_id,
        v_message.conversation_id
      );

    if not v_real_whatsapp then
      v_block_reason := 'real_whatsapp_authority_missing';
    end if;
  end if;

  /*
   * Fresh canonical identities must equal the identities whose locks are held.
   */
  if v_block_reason is null
     and v_message.sender = 'ai'
     and v_outbound_kind = 'canonical_followup' then
    begin
      v_followup_id :=
        nullif(v_message.metadata ->> 'followup_id', '')::uuid;

      v_followup_cycle :=
        nullif(v_message.metadata ->> 'followup_cycle', '')::integer;

      v_action_queue_id :=
        nullif(v_message.metadata ->> 'action_queue_id', '')::uuid;
    exception
      when invalid_text_representation then
        v_block_reason := 'invalid_canonical_followup_identity';
    end;

    if v_block_reason is null
       and (
         v_followup_id is distinct from v_initial_followup_id
         or v_followup_cycle is distinct from v_initial_followup_cycle
         or v_action_queue_id is distinct from v_initial_action_queue_id
       ) then
      v_block_reason := 'canonical_followup_identity_changed_during_gate';
    end if;
  end if;
  /*
   * Human/manual/quote paths remain outside the P9 Sales AI gate.
   * Their existing transport contract is preserved.
   */
  if v_block_reason is null and v_message.sender = 'ai' then
    if v_outbound_kind in ('reactive_ai_reply', 'stop_contact_ack') then
      begin
        v_source_message_id :=
          nullif(v_message.metadata ->> 'source_message_id', '')::uuid;
      exception
        when invalid_text_representation then
          v_block_reason := 'invalid_reactive_ai_identity';
      end;

      if v_block_reason is null
         and (
           v_source_message_id is null
           or v_opportunity_id is null
           or v_message.commercial_session_context_link_id is null
         ) then
        v_block_reason := 'reactive_ai_identity_required';
      end if;

      if v_block_reason is null then
        select context_link_row.commercial_opportunity_id
        into v_context_opportunity_id
        from public.commercial_session_context_links context_link_row
        where context_link_row.id =
              v_message.commercial_session_context_link_id
          and context_link_row.organization_id = p_organization_id
          and context_link_row.store_id = p_store_id;

        if not found
           or v_context_opportunity_id is distinct from v_opportunity_id then
          v_block_reason := 'outbound_commercial_context_mismatch';
        end if;
      end if;

      if v_block_reason is null then
        select source_row.*
        into v_source_message
        from public.messages source_row
        where source_row.id = v_source_message_id
          and source_row.organization_id = p_organization_id
          and source_row.store_id = p_store_id
          and source_row.conversation_id = v_message.conversation_id
          and source_row.sender = 'user'
          and source_row.direction = 'incoming'
          and source_row.deleted_at is null;

        if not found
           or v_source_message.commercial_session_context_link_id is null then
          v_block_reason := 'reactive_source_message_scope_mismatch';
        end if;
      end if;

      if v_block_reason is null then
        select context_link_row.commercial_opportunity_id
        into v_source_context_opportunity_id
        from public.commercial_session_context_links context_link_row
        where context_link_row.id =
              v_source_message.commercial_session_context_link_id
          and context_link_row.organization_id = p_organization_id
          and context_link_row.store_id = p_store_id;

        if not found
           or v_source_context_opportunity_id is distinct from v_opportunity_id then
          v_block_reason := 'reactive_source_opportunity_mismatch';
        end if;
      end if;

      if v_block_reason is null then
        select exists (
          select 1
          from public.messages incoming_row
          where incoming_row.organization_id = p_organization_id
            and incoming_row.store_id = p_store_id
            and incoming_row.conversation_id = v_message.conversation_id
            and incoming_row.sender = 'user'
            and incoming_row.direction = 'incoming'
            and incoming_row.deleted_at is null
            and incoming_row.id <> v_source_message.id
            and incoming_row.created_at >= v_source_message.created_at
        )
        into v_newer_incoming_exists;

        if v_newer_incoming_exists then
          v_block_reason := 'superseded_by_new_customer_message';
        end if;
      end if;

      if v_block_reason is null then
        select exists (
          select 1
          from public.commercial_opportunity_followups followup_row
          where followup_row.organization_id = p_organization_id
            and followup_row.store_id = p_store_id
            and followup_row.commercial_opportunity_id = v_opportunity_id
            and followup_row.status = 'opted_out'
        )
        into v_any_opt_out_exists;

        select exists (
          select 1
          from public.commercial_opportunity_followup_events event_row
          where event_row.organization_id = p_organization_id
            and event_row.store_id = p_store_id
            and event_row.commercial_opportunity_id = v_opportunity_id
            and event_row.event_type = 'opted_out'
            and event_row.actor_type = 'system'
            and event_row.metadata ->> 'source_conversation_id'
                  = v_message.conversation_id::text
            and event_row.metadata ->> 'source_message_id'
                  = v_source_message_id::text
        )
        into v_stop_event_exists;

        if v_outbound_kind = 'stop_contact_ack' then
          if not v_stop_event_exists then
            v_block_reason :=
              'stop_contact_ack_without_exact_opt_out_source';
          end if;
        elsif v_any_opt_out_exists then
          v_block_reason := 'commercial_opportunity_opted_out';
        end if;
      end if;
    elsif v_outbound_kind = 'canonical_followup' then
      if v_message.commercial_session_context_link_id is null then
        v_block_reason := 'canonical_followup_context_required';
      end if;

      if v_block_reason is null then
        select context_link_row.commercial_opportunity_id
        into v_context_opportunity_id
        from public.commercial_session_context_links context_link_row
        where context_link_row.id =
              v_message.commercial_session_context_link_id
          and context_link_row.organization_id = p_organization_id
          and context_link_row.store_id = p_store_id;

        if not found
           or v_context_opportunity_id is distinct from v_opportunity_id then
          v_block_reason := 'canonical_followup_context_mismatch';
        end if;
      end if;

      if v_block_reason is null then
        select queue_row.*
        into v_queue
        from public.ai_sales_action_queue queue_row
        where queue_row.id = v_action_queue_id
          and queue_row.organization_id = p_organization_id
          and queue_row.store_id = p_store_id
          and queue_row.conversation_id = v_message.conversation_id;

        if not found
           or v_queue.next_action not in ('followup_offer', 'followup_visit')
           or v_queue.payload ->> 'commercial_opportunity_id'
                is distinct from v_opportunity_id::text
           or v_queue.payload ->> 'followup_id'
                is distinct from v_followup_id::text
           or v_queue.payload ->> 'followup_cycle'
                is distinct from v_followup_cycle::text then
          v_block_reason := 'canonical_followup_queue_scope_mismatch';
        end if;
      end if;

      if v_block_reason is null then
        select exists (
          select 1
          from public.messages incoming_row
          where incoming_row.organization_id = p_organization_id
            and incoming_row.store_id = p_store_id
            and incoming_row.conversation_id = v_message.conversation_id
            and incoming_row.sender = 'user'
            and incoming_row.direction = 'incoming'
            and incoming_row.deleted_at is null
            and incoming_row.created_at > v_queue.enqueued_at
        )
        into v_newer_incoming_exists;

        if v_newer_incoming_exists then
          v_block_reason := 'superseded_by_new_customer_message';
        end if;
      end if;

      if v_block_reason is null then
        select exists (
          select 1
          from public.commercial_opportunity_followups followup_row
          where followup_row.organization_id = p_organization_id
            and followup_row.store_id = p_store_id
            and followup_row.commercial_opportunity_id = v_opportunity_id
            and followup_row.status = 'opted_out'
        )
        into v_any_opt_out_exists;

        if v_any_opt_out_exists then
          v_block_reason := 'commercial_opportunity_opted_out';
        end if;
      end if;
    end if;
  end if;

  if v_block_reason is not null then
    update public.messages message_row
    set
      outbound_delivery_state = 'failed',
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
      and message_row.outbound_attempt_started_at is null;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'WHATSAPP_EXTERNAL_SEND_GATE_BLOCK_TRANSITION_LOST';
    end if;

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'decision', 'blocked',
      'reason', v_block_reason,
      'message_id', p_message_id,
      'conversation_id', v_message.conversation_id
    );
  end if;

  /*
   * Linearization point for the controlled outbound attempt.
   *
   * The same RPC that authorizes SEND moves processing -> uncertain before
   * returning to Node. After this persisted transition there is never a blind
   * retry. The HTTP POST happens immediately after this RPC returns.
   */
  update public.messages message_row
  set
    outbound_delivery_state = 'uncertain',
    outbound_attempt_started_at = pg_catalog.clock_timestamp(),
    outbound_uncertain_at = pg_catalog.clock_timestamp(),
    outbound_claimed_at = null,
    outbound_claimed_by = null,
    outbound_error_text = null
  where message_row.id = p_message_id
    and message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id
    and message_row.outbound_delivery_state = 'processing'
    and message_row.outbound_attempt_started_at is null
    and message_row.external_message_id is null
    and message_row.deleted_at is null;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'WHATSAPP_EXTERNAL_SEND_GATE_ATTEMPT_TRANSITION_LOST';
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'decision', 'send',
    'reason', 'authorized',
    'message_id', p_message_id,
    'conversation_id', v_message.conversation_id,
    'outbound_kind', v_outbound_kind
  );
end;
$function$;

alter function public.validate_or_cancel_whatsapp_external_send_by_system(
  uuid,
  uuid,
  uuid
) owner to postgres;

revoke all on function
  public.validate_or_cancel_whatsapp_external_send_by_system(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.validate_or_cancel_whatsapp_external_send_by_system(uuid, uuid, uuid)
to service_role;


-- ============================================================================
-- Canonical follow-up external activation is intentionally NOT part of this
-- migration. It must be enabled only after the deployed sender consumes
-- validate_or_cancel_whatsapp_external_send_by_system.
-- ============================================================================
comment on function
  public.is_real_whatsapp_conversation_for_external_send(uuid, uuid, uuid)
is
  'P9 5.3 strict external WhatsApp eligibility: exact tenant/store/conversation, active WhatsApp integration with phone_number_id, and proven Meta WhatsApp inbound.';

comment on function
  public.validate_or_cancel_whatsapp_external_send_by_system(uuid, uuid, uuid)
is
  'P9 5.3 final external SEND authority gate. Blocks stale/opted-out Sales AI outbound terminally before provider attempt and atomically records attempt authorization.';


commit;