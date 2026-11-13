-- P9 Block 10 / Etapa 10.4-A
-- Keep panel release state and the persisted takeover lease in one authority.

begin;

create or replace function public.panel_release_conversation_to_ai_scoped(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_to_state text default null,
  p_reason text default 'painel'::text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  v_conversation public.conversations%rowtype;
  v_lease public.conversation_human_takeover_leases%rowtype;
  v_has_lease boolean := false;
  v_target_state text;
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'conversation transition is not authorized';
  end if;

  -- Lock order is conversation -> lease. The store is derived from the
  -- canonical lead relationship; callers cannot choose a different store.
  select conversation_row.*
    into v_conversation
    from public.conversations conversation_row
    join public.leads lead_row
      on lead_row.id = conversation_row.lead_id
     and lead_row.organization_id = p_organization_id
   where conversation_row.id = p_conversation_id
     and conversation_row.organization_id = p_organization_id
   for update of conversation_row;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'conversation transition scope mismatch';
  end if;

  -- Lock the lease only after the conversation lock. A lease for the same
  -- conversation but a different tenant/store is a fail-closed mismatch.
  select lease_row.*
    into v_lease
    from public.conversation_human_takeover_leases lease_row
   where lease_row.conversation_id = p_conversation_id
   for update;

  v_has_lease := found;

  if v_has_lease then
    if v_lease.organization_id is distinct from v_conversation.organization_id
       or v_lease.store_id is distinct from (
         select lead_row.store_id
           from public.leads lead_row
          where lead_row.id = v_conversation.lead_id
            and lead_row.organization_id = v_conversation.organization_id
       ) then
      raise exception using
        errcode = '42501',
        message = 'human takeover lease scope mismatch';
    end if;

    -- Normal panel release must never clear a persistent hard hold.
    if v_lease.hard_hold is true then
      raise exception using
        errcode = '42501',
        message = 'human takeover hard hold requires explicit release authority';
    end if;
  end if;

  v_target_state := coalesce(
    nullif(pg_catalog.btrim(coalesce(p_to_state, '')), ''),
    public.resolve_human_release_target_state(p_conversation_id)
  );

  perform public.transition_conversation_state_by_user(
    p_conversation_id => p_conversation_id,
    p_to_state => v_target_state,
    p_actor_user_id => v_user_id,
    p_reason => p_reason,
    p_source => 'panel_release_conversation_to_ai_scoped',
    p_request_organization_id => p_organization_id,
    p_event_key => null,
    p_metadata => pg_catalog.jsonb_build_object(
      'compatibility_bridge', 'legacy_conversation_transition',
      'wrapper', 'panel_release_conversation_to_ai_scoped',
      'requested_to_state', p_to_state
    )
  );

  -- The row is already locked. Updating only an unreleased lease keeps
  -- retries idempotent and preserves hard_hold and all historical fields.
  if v_has_lease then
    update public.conversation_human_takeover_leases
       set released_at = case
             when released_at is null then pg_catalog.clock_timestamp()
             else released_at
           end,
           release_reason = case
             when released_at is null then nullif(
               pg_catalog.btrim(coalesce(p_reason, 'panel_release')),
               ''
             )
             else release_reason
           end,
           updated_at = pg_catalog.clock_timestamp()
     where conversation_id = p_conversation_id
       and organization_id = v_conversation.organization_id
       and store_id = (
         select lead_row.store_id
           from public.leads lead_row
          where lead_row.id = v_conversation.lead_id
            and lead_row.organization_id = v_conversation.organization_id
       );

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'human takeover lease release did not update the locked row';
    end if;
  end if;
end;
$function$;

alter function public.panel_release_conversation_to_ai_scoped(
  uuid, uuid, text, text
) owner to postgres;

revoke all on function public.panel_release_conversation_to_ai_scoped(
  uuid, uuid, text, text
) from public, anon, service_role;

grant execute on function public.panel_release_conversation_to_ai_scoped(
  uuid, uuid, text, text
) to authenticated;

do $postconditions$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'::regprocedure
  );
begin
  if pg_catalog.strpos(v_definition, 'for update of conversation_row') = 0
     or pg_catalog.strpos(v_definition, 'from public.conversation_human_takeover_leases lease_row') = 0
     or pg_catalog.strpos(v_definition, 'human takeover hard hold requires explicit release authority') = 0
     or pg_catalog.strpos(v_definition, 'released_at') = 0
     or pg_catalog.strpos(v_definition, 'release_reason') = 0
     or pg_catalog.strpos(v_definition, 'p_request_organization_id') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_10_4_A_PANEL_RELEASE_LEASE_SYNC_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;

commit;
