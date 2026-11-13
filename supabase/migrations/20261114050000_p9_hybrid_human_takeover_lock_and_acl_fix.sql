begin;

-- Corrective migration for 20261114040000. The historical migration remains
-- immutable; all timeout work now follows conversation -> lease lock order.
create or replace function public.process_stale_human_conversations()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_candidate record;
  v_conversation record;
  v_lease record;
  v_event_key text;
  v_processed bigint := 0;
begin
  -- Candidate discovery is intentionally unlocked. Every eligibility decision
  -- is repeated after the conversation and lease locks are held.
  for v_candidate in
    select lease_row.conversation_id
      from public.conversation_human_takeover_leases lease_row
      join public.conversations conversation_row
        on conversation_row.id = lease_row.conversation_id
       and conversation_row.organization_id = lease_row.organization_id
     where lease_row.released_at is null
       and lease_row.last_human_activity_at <= pg_catalog.clock_timestamp() - interval '30 minutes'
       and conversation_row.status = 'humano_assumiu'
       and coalesce(conversation_row.is_human_active, false)
     order by lease_row.last_human_activity_at, lease_row.conversation_id
  loop
    -- Human writers lock the conversation first. SKIP LOCKED prevents a
    -- timeout worker from waiting behind an active human write.
    select conversation_row.id,
           conversation_row.organization_id,
           conversation_row.status,
           conversation_row.is_human_active
      into v_conversation
      from public.conversations conversation_row
     where conversation_row.id = v_candidate.conversation_id
     for update skip locked;

    if not found then
      continue;
    end if;

    -- The lease is always acquired second, matching the human writer order.
    select lease_row.conversation_id,
           lease_row.organization_id,
           lease_row.last_human_activity_at,
           lease_row.notice_30_at,
           lease_row.hard_hold,
           lease_row.released_at
      into v_lease
      from public.conversation_human_takeover_leases lease_row
     where lease_row.conversation_id = v_conversation.id
       and lease_row.organization_id = v_conversation.organization_id
     for update skip locked;

    if not found then
      continue;
    end if;

    -- Revalidate every mutable eligibility field after both locks.
    if v_conversation.status <> 'humano_assumiu'
       or not coalesce(v_conversation.is_human_active, false)
       or v_lease.released_at is not null
       or v_lease.last_human_activity_at > pg_catalog.clock_timestamp() - interval '30 minutes' then
      continue;
    end if;

    if v_lease.notice_30_at is null then
      update public.conversation_human_takeover_leases
         set notice_30_at = pg_catalog.clock_timestamp(),
             updated_at = pg_catalog.clock_timestamp()
       where conversation_id = v_lease.conversation_id;
    end if;

    if v_lease.hard_hold
       or v_lease.last_human_activity_at > pg_catalog.clock_timestamp() - interval '40 minutes' then
      continue;
    end if;

    v_event_key := 'hybrid_human_timeout:' || v_lease.conversation_id::text || ':' || v_lease.last_human_activity_at::text;

    perform public.transition_conversation_state_internal(
      p_conversation_id => v_lease.conversation_id,
      p_to_state => public.resolve_human_release_target_state(v_lease.conversation_id),
      p_reason => 'hybrid_human_timeout_auto_release',
      p_actor_type => 'system',
      p_source => 'hybrid_human_timeout_auto_release',
      p_event_key => v_event_key,
      p_metadata => pg_catalog.jsonb_build_object(
        'source', 'hybrid_human_timeout_auto_release',
        'origin', 'hybrid_human_timeout_auto_release',
        'timeout_minutes', 40,
        'takeover_started_at', v_lease.last_human_activity_at
      )
    );

    perform public.release_human_takeover_lease_by_system(
      v_lease.conversation_id,
      'hybrid_human_timeout_auto_release'
    );
    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$function$;

alter function public.process_stale_human_conversations() owner to postgres;
revoke all on function public.process_stale_human_conversations() from public, anon, authenticated;
grant execute on function public.process_stale_human_conversations() to service_role;

-- These are internal state tables. Direct browser access is forbidden; the
-- SECURITY DEFINER authorities above are the supported access path.
alter table public.conversation_human_takeover_leases enable row level security;
alter table public.conversation_human_takeover_activity_events enable row level security;
revoke all on table public.conversation_human_takeover_leases from public, anon, authenticated, service_role;
revoke all on table public.conversation_human_takeover_activity_events from public, anon, authenticated, service_role;
grant all on table public.conversation_human_takeover_leases to service_role;
grant all on table public.conversation_human_takeover_activity_events to service_role;

do $postconditions$
declare
  v_definition text := pg_catalog.lower(pg_catalog.pg_get_functiondef('public.process_stale_human_conversations()'::regprocedure));
begin
  if pg_catalog.strpos(v_definition, 'for update skip locked') = 0
     or pg_catalog.strpos(v_definition, 'conversation_row') = 0
     or pg_catalog.strpos(v_definition, 'lease_row') = 0
     or pg_catalog.strpos(v_definition, 'hard_hold') = 0
     or pg_catalog.strpos(v_definition, '40 minutes') = 0
     or pg_catalog.strpos(v_definition, 'update public.conversation_human_takeover_leases lease_row') <> 0
     or pg_catalog.has_table_privilege('anon', 'public.conversation_human_takeover_leases', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.conversation_human_takeover_leases', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'public.conversation_human_takeover_activity_events', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.conversation_human_takeover_activity_events', 'SELECT') then
    raise exception using errcode = 'P0001', message = 'P9_10_3_HYBRID_TAKEOVER_LOCK_ACL_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;

commit;
