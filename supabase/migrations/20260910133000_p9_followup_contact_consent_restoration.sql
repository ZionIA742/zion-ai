begin;

-- ============================================================================
-- P9 / Block 5 / Stage 5.3
-- Explicit contact-consent restoration after canonical opt-out.
--
-- Contract:
-- - opt-out remains separate from Lost;
-- - consent restoration is explicit and anchored to an exact customer inbound;
-- - restoring consent does NOT activate a follow-up;
-- - the opted-out cycle becomes consent_restored;
-- - a later normal activation may create a new follow-up cycle;
-- - historical opted_out_at is preserved;
-- - events remain append-only and operation-key idempotent.
-- ============================================================================


-- ============================================================================
-- 1. Follow-up state: consent_restored is terminal for the opted-out cycle.
-- ============================================================================

alter table public.commercial_opportunity_followups
  add column if not exists consent_restored_at timestamptz null;

alter table public.commercial_opportunity_followups
  drop constraint commercial_opportunity_followups_status_check;

alter table public.commercial_opportunity_followups
  add constraint commercial_opportunity_followups_status_check
  check (
    status in (
      'active',
      'resolved',
      'cancelled',
      'exhausted',
      'opted_out',
      'consent_restored'
    )
  );

alter table public.commercial_opportunity_followups
  drop constraint commercial_opportunity_followups_terminal_shape_check;

alter table public.commercial_opportunity_followups
  add constraint commercial_opportunity_followups_terminal_shape_check
  check (
    (
      status = 'active'
      and resolved_at is null
      and cancelled_at is null
      and exhausted_at is null
      and opted_out_at is null
      and consent_restored_at is null
    )
    or (
      status = 'resolved'
      and resolved_at is not null
      and cancelled_at is null
      and exhausted_at is null
      and opted_out_at is null
      and consent_restored_at is null
    )
    or (
      status = 'cancelled'
      and resolved_at is null
      and cancelled_at is not null
      and exhausted_at is null
      and opted_out_at is null
      and consent_restored_at is null
    )
    or (
      status = 'exhausted'
      and resolved_at is null
      and cancelled_at is null
      and exhausted_at is not null
      and opted_out_at is null
      and consent_restored_at is null
    )
    or (
      status = 'opted_out'
      and resolved_at is null
      and cancelled_at is null
      and exhausted_at is null
      and opted_out_at is not null
      and consent_restored_at is null
    )
    or (
      status = 'consent_restored'
      and resolved_at is null
      and cancelled_at is null
      and exhausted_at is null
      and opted_out_at is not null
      and consent_restored_at is not null
      and consent_restored_at >= opted_out_at
    )
  );


-- ============================================================================
-- 2. Append-only event contract.
-- ============================================================================

alter table public.commercial_opportunity_followup_events
  drop constraint commercial_opportunity_followup_events_event_type_check;

alter table public.commercial_opportunity_followup_events
  add constraint commercial_opportunity_followup_events_event_type_check
  check (
    event_type in (
      'activated',
      'attempt_recorded',
      'resolved',
      'cancelled',
      'exhausted',
      'opted_out',
      'consent_restored'
    )
  );


-- ============================================================================
-- 3. Snapshot replay understands consent_restored.
-- ============================================================================

create or replace function public.restore_commercial_opportunity_followup_snapshot(
  p_event public.commercial_opportunity_followup_events
)
returns public.commercial_opportunity_followups
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_snapshot jsonb := p_event.metadata -> 'result_snapshot';
  v_followup public.commercial_opportunity_followups;
  v_expected_status text;
begin
  if pg_catalog.jsonb_typeof(v_snapshot) <> 'object' then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_FOLLOWUP_RESULT_SNAPSHOT_MISSING';
  end if;

  select *
  into v_followup
  from pg_catalog.jsonb_populate_record(
    null::public.commercial_opportunity_followups,
    v_snapshot
  );

  if v_followup.id is null
     or v_followup.organization_id is null
     or v_followup.store_id is null
     or v_followup.commercial_opportunity_id is null
     or v_followup.cycle is null
     or v_followup.status is null then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_FOLLOWUP_RESULT_SNAPSHOT_INVALID';
  end if;

  if v_followup.id is distinct from p_event.followup_id
     or v_followup.organization_id is distinct from p_event.organization_id
     or v_followup.store_id is distinct from p_event.store_id
     or v_followup.commercial_opportunity_id
          is distinct from p_event.commercial_opportunity_id
     or v_followup.cycle is distinct from p_event.cycle then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_FOLLOWUP_RESULT_SNAPSHOT_INVALID';
  end if;

  v_expected_status := case p_event.event_type
    when 'activated' then 'active'
    when 'attempt_recorded' then 'active'
    when 'resolved' then 'resolved'
    when 'cancelled' then 'cancelled'
    when 'exhausted' then 'exhausted'
    when 'opted_out' then 'opted_out'
    when 'consent_restored' then 'consent_restored'
    else null
  end;

  if v_expected_status is null
     or v_followup.status is distinct from v_expected_status then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_FOLLOWUP_RESULT_SNAPSHOT_INVALID';
  end if;

  return v_followup;
end;
$function$;

alter function
  public.restore_commercial_opportunity_followup_snapshot(
    public.commercial_opportunity_followup_events
  )
  owner to postgres;

revoke all on function
  public.restore_commercial_opportunity_followup_snapshot(
    public.commercial_opportunity_followup_events
  )
from public, anon, authenticated, service_role;


-- ============================================================================
-- 4. Canonical system writer for explicit customer re-consent.
-- ============================================================================

create or replace function
  public.restore_commercial_opportunity_contact_consent_by_system(
    p_organization_id uuid,
    p_store_id uuid,
    p_commercial_opportunity_id uuid,
    p_source_conversation_id uuid,
    p_source_message_id uuid,
    p_operation_key text,
    p_reason_code text,
    p_reason_details text
  )
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text :=
    nullif(
      pg_catalog.current_setting('request.jwt.claim.role', true),
      ''
    );

  v_operation_key text;
  v_reason_code text;
  v_reason_details text;

  v_opportunity public.commercial_opportunities;
  v_existing_event public.commercial_opportunity_followup_events;
  v_replay_followup public.commercial_opportunity_followups;
  v_followup public.commercial_opportunity_followups;

  v_source_message_at timestamptz;
  v_opted_out_count bigint := 0;
  v_active_count bigint := 0;
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message =
        'commercial opportunity contact consent restoration by system is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_source_conversation_id is null
     or p_source_message_id is null then
    raise exception using
      errcode = '22023',
      message =
        'system contact consent restoration requires organization, store, opportunity, conversation and source message';
  end if;

  v_operation_key :=
    public.normalize_commercial_opportunity_followup_operation_key(
      p_operation_key
    );

  v_reason_code :=
    public.normalize_commercial_opportunity_followup_reason_code(
      p_reason_code
    );

  v_reason_details :=
    public.normalize_commercial_opportunity_followup_reason_details(
      p_reason_details
    );

  if v_reason_code is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_FOLLOWUP_REASON_CODE_REQUIRED';
  end if;

  /*
   * Opportunity is the canonical unit of sale.
   * This is also the serialization lock shared with opt-out and SEND authority.
   */
  v_opportunity :=
    public.lock_commercial_opportunity_followup_target(
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id
    );

  v_opportunity :=
    public.validate_commercial_opportunity_followup_integrity(
      v_opportunity
    );

  if v_opportunity.primary_conversation_id
       is distinct from p_source_conversation_id then
    raise exception using
      errcode = '23514',
      message = 'ZION_CONTACT_CONSENT_CONVERSATION_SCOPE_MISMATCH';
  end if;

  /*
   * Validate the exact customer inbound that carries explicit re-consent.
   * No latest/first message lookup is permitted.
   */
  select message_row.created_at
  into v_source_message_at
  from public.messages message_row
  join public.conversations conversation_row
    on conversation_row.id = message_row.conversation_id
  join public.leads lead_row
    on lead_row.id = conversation_row.lead_id
  join public.commercial_session_context_links context_link_row
    on context_link_row.id =
         message_row.commercial_session_context_link_id
  where message_row.id = p_source_message_id
    and message_row.conversation_id = p_source_conversation_id
    and message_row.sender = 'user'
    and message_row.direction = 'incoming'
    and message_row.deleted_at is null
    and message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id
    and conversation_row.organization_id = p_organization_id
    and lead_row.organization_id = p_organization_id
    and lead_row.store_id = p_store_id
    and context_link_row.organization_id = p_organization_id
    and context_link_row.store_id = p_store_id
    and context_link_row.commercial_opportunity_id =
          p_commercial_opportunity_id;

  if v_source_message_at is null then
    raise exception using
      errcode = '23514',
      message = 'ZION_CONTACT_CONSENT_SOURCE_MESSAGE_SCOPE_MISMATCH';
  end if;

  /*
   * Operation-key replay is resolved before state inspection.
   * The same key can never silently bind to another inbound.
   */
  v_existing_event :=
    public.find_commercial_opportunity_followup_event_by_operation_key(
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id,
      v_operation_key
    );

  if v_existing_event.id is not null then
    if v_existing_event.event_type <> 'consent_restored'
       or v_existing_event.actor_type <> 'system'
       or v_existing_event.actor_user_id is not null
       or v_existing_event.reason_code is distinct from v_reason_code
       or v_existing_event.reason_details is distinct from v_reason_details
       or v_existing_event.metadata ->> 'source_conversation_id'
            is distinct from p_source_conversation_id::text
       or v_existing_event.metadata ->> 'source_message_id'
            is distinct from p_source_message_id::text then
      raise exception using
        errcode = '23505',
        message = 'ZION_FOLLOWUP_OPERATION_KEY_CONFLICT';
    end if;

    v_replay_followup :=
      public.restore_commercial_opportunity_followup_snapshot(
        v_existing_event
      );

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'result', 'replay',
      'commercial_opportunity_id', p_commercial_opportunity_id,
      'followup_id', v_replay_followup.id,
      'followup_cycle', v_replay_followup.cycle,
      'followup_status', v_replay_followup.status,
      'consent_restored_at', v_replay_followup.consent_restored_at
    );
  end if;

  /*
   * There must never be more than one current opted-out cycle.
   * Opportunity lock serializes all canonical transitions.
   */
  select pg_catalog.count(*)
  into v_opted_out_count
  from public.commercial_opportunity_followups followup_row
  where followup_row.organization_id = p_organization_id
    and followup_row.store_id = p_store_id
    and followup_row.commercial_opportunity_id =
          p_commercial_opportunity_id
    and followup_row.status = 'opted_out';

  if v_opted_out_count > 1 then
    raise exception using
      errcode = '23514',
      message = 'ZION_CONTACT_CONSENT_MULTIPLE_OPTED_OUT_CYCLES';
  end if;

  /*
   * Explicit consent while already contactable is a safe no-op.
   * No follow-up is activated and no synthetic consent event is created.
   */
  if v_opted_out_count = 0 then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'result', 'already_contactable',
      'commercial_opportunity_id', p_commercial_opportunity_id
    );
  end if;

  select pg_catalog.count(*)
  into v_active_count
  from public.commercial_opportunity_followups followup_row
  where followup_row.organization_id = p_organization_id
    and followup_row.store_id = p_store_id
    and followup_row.commercial_opportunity_id =
          p_commercial_opportunity_id
    and followup_row.status = 'active';

  if v_active_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'ZION_CONTACT_CONSENT_ACTIVE_FOLLOWUP_CONFLICT';
  end if;

  /*
   * Exact current opted-out cycle. Count=1 was proven above;
   * therefore this is not a latest/first heuristic.
   */
  select followup_row.*
  into strict v_followup
  from public.commercial_opportunity_followups followup_row
  where followup_row.organization_id = p_organization_id
    and followup_row.store_id = p_store_id
    and followup_row.commercial_opportunity_id =
          p_commercial_opportunity_id
    and followup_row.status = 'opted_out'
  for update;

  /*
   * The inbound restoring consent must have been persisted after the opt-out.
   * The stop-contact inbound itself therefore cannot restore consent.
   */
  if v_followup.opted_out_at is null
     or v_source_message_at <= v_followup.opted_out_at then
    raise exception using
      errcode = '23514',
      message = 'ZION_CONTACT_CONSENT_SOURCE_NOT_AFTER_OPT_OUT';
  end if;

  update public.commercial_opportunity_followups followup_row
  set
    status = 'consent_restored',
    consent_restored_at = pg_catalog.clock_timestamp()
  where followup_row.id = v_followup.id
    and followup_row.organization_id = p_organization_id
    and followup_row.store_id = p_store_id
    and followup_row.commercial_opportunity_id =
          p_commercial_opportunity_id
    and followup_row.cycle = v_followup.cycle
    and followup_row.status = 'opted_out'
  returning *
  into v_followup;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTACT_CONSENT_RESTORE_TRANSITION_LOST';
  end if;

  insert into public.commercial_opportunity_followup_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    followup_id,
    cycle,
    event_type,
    operation_key,
    actor_type,
    actor_user_id,
    reason_code,
    reason_details,
    metadata
  )
  values (
    v_followup.organization_id,
    v_followup.store_id,
    v_followup.commercial_opportunity_id,
    v_followup.id,
    v_followup.cycle,
    'consent_restored',
    v_operation_key,
    'system',
    null,
    v_reason_code,
    v_reason_details,
    pg_catalog.jsonb_build_object(
      'result_snapshot',
      public.build_commercial_opportunity_followup_snapshot(v_followup),
      'source_conversation_id',
      p_source_conversation_id,
      'source_message_id',
      p_source_message_id,
      'source_message_created_at',
      v_source_message_at
    )
  );

  /*
   * Deliberately:
   * - no new active follow-up cycle;
   * - no opportunity stage mutation;
   * - no Lost mutation.
   */
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'result', 'consent_restored',
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'followup_id', v_followup.id,
    'followup_cycle', v_followup.cycle,
    'followup_status', v_followup.status,
    'opted_out_at', v_followup.opted_out_at,
    'consent_restored_at', v_followup.consent_restored_at,
    'source_conversation_id', p_source_conversation_id,
    'source_message_id', p_source_message_id
  );
end;
$function$;

alter function
  public.restore_commercial_opportunity_contact_consent_by_system(
    uuid,
    uuid,
    uuid,
    uuid,
    uuid,
    text,
    text,
    text
  )
  owner to postgres;

revoke all on function
  public.restore_commercial_opportunity_contact_consent_by_system(
    uuid,
    uuid,
    uuid,
    uuid,
    uuid,
    text,
    text,
    text
  )
from public, anon, authenticated;

grant execute on function
  public.restore_commercial_opportunity_contact_consent_by_system(
    uuid,
    uuid,
    uuid,
    uuid,
    uuid,
    text,
    text,
    text
  )
to service_role;

comment on column
  public.commercial_opportunity_followups.consent_restored_at
is
  'Timestamp of explicit restoration of customer contact consent after this follow-up cycle was opted out. Does not activate a new follow-up cycle.';

comment on function
  public.restore_commercial_opportunity_contact_consent_by_system(
    uuid,
    uuid,
    uuid,
    uuid,
    uuid,
    text,
    text,
    text
  )
is
  'P9 5.3 canonical system authority for explicit customer contact re-consent. Exact inbound and opportunity scoped, idempotent, preserves opt-out history, never activates follow-up and never changes Lost/stage.';

commit;