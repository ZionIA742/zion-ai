-- P9 10.4-D: fecha bypasses legados sem alterar as migrations anteriores.

begin;

create or replace function public.p9_10_4_d_assert_recovery_write_authority_for_conversation(
  p_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_conversation public.conversations%rowtype;
  v_lease public.conversation_human_takeover_leases%rowtype;
begin
  select c.* into v_conversation
    from public.conversations c
    join public.leads l on l.id = c.lead_id
    join public.stores s on s.id = l.store_id and s.organization_id = l.organization_id
   where c.id = p_conversation_id
   for update of c;
  if not found then
    raise exception using errcode = '42501', message = 'P9_10_4_D_LEGACY_TRANSITION_SCOPE_MISSING';
  end if;
  select h.* into v_lease
    from public.conversation_human_takeover_leases h
   where h.conversation_id = p_conversation_id
     and h.organization_id = v_conversation.organization_id
   for update;
  perform 1
    from public.commercial_opportunities o
   where o.primary_conversation_id = p_conversation_id
     and o.organization_id = v_conversation.organization_id
   for update;
  if coalesce(v_conversation.is_human_active, false)
     or lower(btrim(coalesce(v_conversation.status, ''))) = 'humano_assumiu'
     or coalesce(v_lease.hard_hold, false)
     or (v_lease.conversation_id is not null and v_lease.released_at is null) then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_RECOVERY_BLOCKED_BY_HUMAN_TAKEOVER';
  end if;
end;
$function$;

do $transition$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.transition_conversation_state_internal(uuid,text,text,text,text,text,jsonb)'
  );
  v_definition text;
  v_anchor constant text := $anchor$
begin
  v_actor_type :=
    public._conversation_transition_validate_actor(
      p_actor_type,
      null
    );
$anchor$;
  v_guard constant text := $guard$
  if p_source like 'ai_sales%' then
    perform public.p9_10_4_d_assert_recovery_write_authority_for_conversation(
      p_conversation_id
    );
  end if;

$guard$;
begin
  if v_oid is null then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_LEGACY_TRANSITION_MISSING';
  end if;
  select pg_catalog.pg_get_functiondef(v_oid) into v_definition;
  if pg_catalog.strpos(v_definition, 'p9_10_4_d_assert_recovery_write_authority_for_conversation') > 0 then
    return;
  end if;
  if pg_catalog.strpos(v_definition, v_anchor) = 0 then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_LEGACY_TRANSITION_DRIFT';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_anchor, v_anchor || v_guard);
  execute v_definition;
end;
$transition$;

create or replace function public.p9_10_4_d_assert_recovery_write_authority_for_conversation(
  p_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_conversation public.conversations%rowtype;
  v_lease public.conversation_human_takeover_leases%rowtype;
begin
  select c.* into v_conversation
    from public.conversations c
    join public.leads l on l.id = c.lead_id
    join public.stores s on s.id = l.store_id and s.organization_id = l.organization_id
   where c.id = p_conversation_id
   for update of c;
  if not found then
    raise exception using errcode = '42501', message = 'P9_10_4_D_LEGACY_TRANSITION_SCOPE_MISSING';
  end if;
  select h.* into v_lease
    from public.conversation_human_takeover_leases h
   where h.conversation_id = p_conversation_id
     and h.organization_id = v_conversation.organization_id
   for update;
  perform 1
    from public.commercial_opportunities o
   where o.primary_conversation_id = p_conversation_id
     and o.organization_id = v_conversation.organization_id
   for update;
  if coalesce(v_conversation.is_human_active, false)
     or lower(btrim(coalesce(v_conversation.status, ''))) = 'humano_assumiu'
     or coalesce(v_lease.hard_hold, false)
     or (v_lease.conversation_id is not null and v_lease.released_at is null) then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_RECOVERY_BLOCKED_BY_HUMAN_TAKEOVER';
  end if;
end;
$function$;

do $quote_auth$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.issue_quote_preparation_task_authorization_by_system(uuid,uuid,uuid,uuid)'
  );
  v_definition text;
  v_anchor constant text := $anchor$
    SELECT *
    INTO v_task
    FROM public.store_assistant_operational_tasks
$anchor$;
  v_guard constant text := $guard$
    IF (v_task.task_payload ->> 'p9_recovery_response_set_id') IS NOT NULL THEN
        PERFORM public.p9_10_4_d_assert_recovery_set_authority(
            (v_task.task_payload ->> 'p9_recovery_response_set_id')::uuid,
            p_organization_id,
            p_store_id,
            v_task.related_conversation_id,
            p_request_message_id
        );
    END IF;

$guard$;
begin
  if v_oid is null then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_QUOTE_AUTHORITY_MISSING';
  end if;
  select pg_catalog.pg_get_functiondef(v_oid) into v_definition;
  if pg_catalog.strpos(v_definition, 'p9_10_4_d_assert_recovery_set_authority') > 0 then
    return;
  end if;
  if pg_catalog.strpos(v_definition, v_anchor) = 0 then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_QUOTE_AUTHORITY_DRIFT';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_anchor, v_anchor || v_guard);
  execute v_definition;
end;
$quote_auth$;

alter function public.p9_10_4_d_assert_recovery_write_authority_for_conversation(uuid) owner to postgres;
revoke all on function public.p9_10_4_d_assert_recovery_write_authority_for_conversation(uuid) from public, anon, authenticated;
grant execute on function public.p9_10_4_d_assert_recovery_write_authority_for_conversation(uuid) to service_role;

commit;
