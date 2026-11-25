-- P19A 4-T3-N24: candidate only; requires the V3 repair and fences first.
-- No business transition is removed. Generic transitions cannot release control.
-- Materializer lock order: opportunity -> advisory conversation -> conversation row -> lease.
-- Explicit release is confined to a private owner-only implementation invoked by the authenticated panel.
do $n24_materializer$
declare
  v_definition text;
  v_anchor text;
  v_count integer;
  v_patterns text[] := array[
$pattern$perform[[:space:]]+public\.private_acquire_sales_contract_conversation_xact_lock\(p_conversation_id\);[[:space:]]+select[[:space:]]+\*[[:space:]]+into[[:space:]]+v_conversation[[:space:]]+from[[:space:]]+public\.conversations[[:space:]]+where[[:space:]]+id[[:space:]]+=[[:space:]]+p_conversation_id[[:space:]]+and[[:space:]]+organization_id[[:space:]]+=[[:space:]]+p_organization_id[[:space:]]+and[[:space:]]+lead_id[[:space:]]+=[[:space:]]+p_lead_id;[[:space:]]+if[[:space:]]+not[[:space:]]+found[[:space:]]+then[[:space:]]+raise[[:space:]]+exception[[:space:]]+using[[:space:]]+errcode[[:space:]]+=[[:space:]]+'42501',[[:space:]]+message[[:space:]]+=[[:space:]]+'P19A_I8_CONVERSATION_SCOPE_MISMATCH';[[:space:]]+end[[:space:]]+if;$pattern$];
  v_replacements text[] := array[
$replacement$perform public.private_acquire_sales_contract_conversation_xact_lock(p_conversation_id);

  select * into v_conversation
  from public.conversations
  where id = p_conversation_id and organization_id = p_organization_id and lead_id = p_lead_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'P19A_I8_CONVERSATION_SCOPE_MISMATCH';
  end if;

  -- N24: authoritative check under conversation row lock, before any new reply.
  declare
    v_control public.conversation_human_takeover_leases%rowtype;
  begin
    if coalesce(v_conversation.is_human_active, false)
       or v_conversation.status = 'humano_assumiu' then
      raise exception using errcode = '42501', message = 'P19A_4_T3_N2_AI_BLOCKED_BY_HUMAN_CONTROL';
    end if;
    select lease_row.* into v_control
    from public.conversation_human_takeover_leases lease_row
    where lease_row.conversation_id = p_conversation_id
    for update;
    if found and (
         v_control.organization_id is distinct from p_organization_id
         or v_control.store_id is distinct from p_store_id
         or v_control.hard_hold is true
         or v_control.released_at is null
       ) then
      raise exception using errcode = '42501', message = 'P19A_4_T3_N2_AI_BLOCKED_BY_HUMAN_CONTROL';
    end if;
  end;$replacement$];
begin
  select pg_catalog.pg_get_functiondef('public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)'::regprocedure) into v_definition;
  
  for i in 1..pg_catalog.array_length(v_patterns, 1) loop
    select count(*) into v_count from pg_catalog.regexp_matches(v_definition, v_patterns[i], 'g');
    if v_count <> 1 then
      raise exception using errcode = 'P0001', message = 'N24_N24_MATERIALIZER_DRIFT',
        detail = pg_catalog.format('anchor=%s count=%s', i, v_count);
    end if;
    v_anchor := pg_catalog.substring(v_definition, v_patterns[i]);
    v_definition := pg_catalog.replace(v_definition, v_anchor, v_replacements[i]);
  end loop;
  execute v_definition;
end;
$n24_materializer$;

do $n24_central$
declare
  v_definition text;
  v_anchor text;
  v_count integer;
  v_patterns text[] := array[
$pattern$public\._apply_conversation_state_transition\(p_conversation_id[[:space:]]+uuid,$pattern$,
$pattern$v_lead_state_sync_allowed[[:space:]]+boolean;$pattern$,
$pattern$v_state_changed[[:space:]]+:=[[:space:]]+v_context\.current_state[[:space:]]+is[[:space:]]+distinct[[:space:]]+from[[:space:]]+v_target_state;$pattern$,
$pattern$is[[:space:]]+distinct[[:space:]]+from[[:space:]]+\(v_target_state[[:space:]]+=[[:space:]]+'humano_assumiu'\);$pattern$,
$pattern$is_human_active[[:space:]]+=[[:space:]]+\(v_target_state[[:space:]]+=[[:space:]]+'humano_assumiu'\),$pattern$];
  v_replacements text[] := array[
$replacement$public._apply_conversation_state_transition_controlled(p_explicit_human_release boolean, p_conversation_id uuid,$replacement$,
$replacement$v_lead_state_sync_allowed boolean;
  v_control public.conversation_human_takeover_leases%rowtype;
  v_has_control boolean;
  v_keep_human boolean;$replacement$,
$replacement$-- N24: the context reader already holds FOR UPDATE on the conversation.
  -- Lock the lease only after that row. Replays above have no new effects.
  select lease_row.* into v_control
  from public.conversation_human_takeover_leases lease_row
  where lease_row.conversation_id = p_conversation_id
  for update;
  v_has_control := found;
  if v_has_control and (
       v_control.organization_id is distinct from v_context.organization_id
       or v_control.store_id is distinct from v_context.store_id
     ) then
    raise exception using errcode = '42501', message = 'N24_LEASE_SCOPE_MISMATCH';
  end if;

  if p_explicit_human_release is true then
    if v_actor_type is distinct from 'human'
       or p_require_owner is distinct from true
       or p_actor_user_id is null
       or p_actor_user_id is distinct from auth.uid()
       or p_request_organization_id is distinct from v_context.organization_id
       or coalesce(nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
                   nullif(auth.jwt() ->> 'role', '')) is distinct from 'authenticated'
       or v_target_state = 'humano_assumiu'
       or (v_has_control and v_control.hard_hold is true) then
      raise exception using errcode = '42501', message = 'N24_EXPLICIT_RELEASE_NOT_AUTHORIZED';
    end if;
    v_keep_human := false;
  else
    v_keep_human := coalesce(v_context.is_human_active, false)
      or coalesce(v_context.conversation_status = 'humano_assumiu', false)
      or coalesce(v_context.current_state = 'humano_assumiu', false)
      or coalesce(v_target_state = 'humano_assumiu', false)
      or (v_has_control and (v_control.hard_hold is true or v_control.released_at is null));
    if v_keep_human and (not v_has_control or v_control.released_at is not null) then
      perform public.ensure_human_takeover_lease_by_system(p_conversation_id);
    end if;
  end if;

  v_state_changed := v_context.current_state is distinct from v_target_state;$replacement$,
$replacement$is distinct from v_keep_human;$replacement$,
$replacement$is_human_active = v_keep_human,$replacement$];
begin
  select pg_catalog.pg_get_functiondef('public._apply_conversation_state_transition(uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean)'::regprocedure) into v_definition;
  if pg_catalog.to_regprocedure('public._apply_conversation_state_transition_controlled(boolean,uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean)') is not null then raise exception 'N24_PRIVATE_AUTHORITY_ALREADY_EXISTS'; end if;
  for i in 1..pg_catalog.array_length(v_patterns, 1) loop
    select count(*) into v_count from pg_catalog.regexp_matches(v_definition, v_patterns[i], 'g');
    if v_count <> 1 then
      raise exception using errcode = 'P0001', message = 'N24_N24_CENTRAL_DRIFT',
        detail = pg_catalog.format('anchor=%s count=%s', i, v_count);
    end if;
    v_anchor := pg_catalog.substring(v_definition, v_patterns[i]);
    v_definition := pg_catalog.replace(v_definition, v_anchor, v_replacements[i]);
  end loop;
  execute v_definition;
end;
$n24_central$;

alter function public._apply_conversation_state_transition_controlled(boolean,uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean) owner to postgres;
revoke all on function public._apply_conversation_state_transition_controlled(boolean,uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean) from public, anon, authenticated, service_role;

create or replace function public._apply_conversation_state_transition(
  p_conversation_id uuid, p_to_state text, p_actor_type text,
  p_actor_user_id uuid default null, p_reason text default null,
  p_source text default null, p_metadata jsonb default '{}'::jsonb,
  p_event_key text default null, p_request_organization_id uuid default null,
  p_require_owner boolean default false
) returns public.conversations
language plpgsql security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $n24_wrapper$
begin
  return public._apply_conversation_state_transition_controlled(
    false, p_conversation_id, p_to_state, p_actor_type, p_actor_user_id,
    p_reason, p_source, p_metadata, p_event_key,
    p_request_organization_id, p_require_owner
  );
end;
$n24_wrapper$;

do $n24_panel$
declare
  v_definition text;
  v_anchor text;
  v_count integer;
  v_patterns text[] := array[
$pattern$perform[[:space:]]+public\.transition_conversation_state_by_user\($pattern$];
  v_replacements text[] := array[
$replacement$perform public._apply_conversation_state_transition_controlled(
    p_explicit_human_release => true,
    p_actor_type => 'human',
    p_require_owner => true,$replacement$];
begin
  select pg_catalog.pg_get_functiondef('public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'::regprocedure) into v_definition;
  
  for i in 1..pg_catalog.array_length(v_patterns, 1) loop
    select count(*) into v_count from pg_catalog.regexp_matches(v_definition, v_patterns[i], 'g');
    if v_count <> 1 then
      raise exception using errcode = 'P0001', message = 'N24_N24_PANEL_DRIFT',
        detail = pg_catalog.format('anchor=%s count=%s', i, v_count);
    end if;
    v_anchor := pg_catalog.substring(v_definition, v_patterns[i]);
    v_definition := pg_catalog.replace(v_definition, v_anchor, v_replacements[i]);
  end loop;
  execute v_definition;
end;
$n24_panel$;

-- Catalog checks only; functional/concurrent tests are still required.
do $n24_postconditions$
declare
  v_material text := pg_catalog.pg_get_functiondef('public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)'::regprocedure);
  v_central text := pg_catalog.pg_get_functiondef('public._apply_conversation_state_transition_controlled(boolean,uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean)'::regprocedure);
  v_wrapper text := pg_catalog.pg_get_functiondef('public._apply_conversation_state_transition(uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean)'::regprocedure);
  v_panel text := pg_catalog.pg_get_functiondef('public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'::regprocedure);
begin
  if pg_catalog.strpos(v_material, 'N24: authoritative check') = 0
     or pg_catalog.strpos(v_central, 'is_human_active = v_keep_human') = 0
     or pg_catalog.strpos(v_wrapper, 'false, p_conversation_id') = 0
     or pg_catalog.strpos(v_panel, 'p_explicit_human_release => true') = 0
     or pg_catalog.has_function_privilege('authenticated', 'public._apply_conversation_state_transition_controlled(boolean,uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public._apply_conversation_state_transition_controlled(boolean,uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean)', 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', 'public._apply_conversation_state_transition_controlled(boolean,uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', 'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)', 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', 'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)', 'EXECUTE') then
    raise exception 'N24_POSTCONDITION_FAILED';
  end if;
end;
$n24_postconditions$;
