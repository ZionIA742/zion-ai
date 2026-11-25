-- N33: installation-only draft extracted from approved N30B1.
-- NOT a definitive migration. Do not apply. ROLLBACK retained.
begin;
set local lock_timeout = '4s';
set local statement_timeout = '60s';

do $preflight$
declare
  v_p0 text;
  v_insert_message text;
  v_takeover text;
  v_ensure text;
  v_release text;
  v_release_proc pg_catalog.pg_proc%rowtype;
  v_insert_marker text := $marker$insert into public.messages ($marker$;
  v_return_marker text := $marker$return;$marker$;
begin
  if pg_catalog.to_regclass('public.conversations') is null
     or pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regprocedure('public.human_takeover_conversation(uuid,text)') is null
     or pg_catalog.to_regprocedure('public.insert_message(uuid,text,text,text,text,text,text,jsonb)') is null
     or pg_catalog.to_regprocedure('public.human_release_conversation_to_ai(uuid,text,text)') is null
     or pg_catalog.to_regprocedure('public.resolve_human_release_target_state(uuid)') is null
     or pg_catalog.to_regprocedure('public.process_stale_human_conversations()') is null then
    raise exception using errcode = 'P0001', message = 'P19A_4_T3_REQUIRED_REMOTE_CONTRACT_MISSING';
  end if;

  if pg_catalog.to_regclass('public.conversation_human_takeover_leases') is not null
     or pg_catalog.to_regclass('public.conversation_human_takeover_activity_events') is not null then
    raise exception using errcode = 'P0001', message = 'P19A_4_T3_TARGET_TABLE_ALREADY_EXISTS';
  end if;

  v_p0 := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.process_stale_human_conversations()'::regprocedure
  ));
  v_p0 := pg_catalog.regexp_replace(v_p0, '[[:space:]]+', ' ', 'g');
  if pg_catalog.strpos(v_p0, 'begin return 0; end;') = 0
     or pg_catalog.strpos(v_p0, 'declare') <> 0
     or pg_catalog.strpos(v_p0, 'if ') <> 0
     or pg_catalog.strpos(v_p0, 'loop') <> 0
     or pg_catalog.strpos(v_p0, 'select ') <> 0
     or pg_catalog.strpos(v_p0, 'insert ') <> 0
     or pg_catalog.strpos(v_p0, 'update ') <> 0
     or pg_catalog.strpos(v_p0, 'delete ') <> 0
     or pg_catalog.strpos(v_p0, 'perform ') <> 0
     or pg_catalog.strpos(v_p0, 'execute ') <> 0
     or pg_catalog.strpos(v_p0, 'transition_conversation_state') <> 0
     or pg_catalog.strpos(v_p0, 'human_takeover') <> 0
     or pg_catalog.strpos(v_p0, 'human_release') <> 0
     or pg_catalog.strpos(v_p0, 'conversation_human_takeover') <> 0 then
    raise exception using errcode = 'P0001', message = 'P19A_4_T3_P0_BODY_NOT_INERT';
  end if;

  v_insert_message := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'::regprocedure
  ));
  v_takeover := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.human_takeover_conversation(uuid,text)'::regprocedure
  ));
  select * into v_release_proc
    from pg_catalog.pg_proc
   where oid = pg_catalog.to_regprocedure('public.human_release_conversation_to_ai(uuid,text,text)');
  v_release := pg_catalog.lower(pg_catalog.pg_get_functiondef(v_release_proc.oid));
  if not v_release_proc.prosecdef
     or coalesce(v_release_proc.proconfig, '{}'::text[]) @> array['search_path=pg_catalog, pg_temp']::text[] is not true
     or pg_catalog.strpos(v_release, 'release_human_takeover_lease_by_system') <> 0
     or pg_catalog.length(v_release) - pg_catalog.length(
          pg_catalog.replace(v_release, v_return_marker, '')
        ) <> 2 * pg_catalog.length(v_return_marker) then
    raise exception using errcode = 'P0001', message = 'P19A_4_T3_RELEASE_DEPENDENCY_NOT_PROVEN';
  end if;
  if pg_catalog.strpos(v_insert_message, v_insert_marker) = 0
     or pg_catalog.strpos(v_insert_message, 'private_acquire_sales_contract_conversation_xact_lock') = 0
     or pg_catalog.strpos(v_insert_message, 'ensure_commercial_conversation_session_context') = 0
     or (
       pg_catalog.strpos(v_takeover, 'transition_conversation_state_by_user') = 0
       and pg_catalog.strpos(v_takeover, 'transition_conversation_state_internal') = 0
     )
     or pg_catalog.length(v_takeover) - pg_catalog.length(
          pg_catalog.replace(v_takeover, v_return_marker, '')
        ) <> 2 * pg_catalog.length(v_return_marker) then
    raise exception using errcode = 'P0001', message = 'P19A_4_T3_DEPENDENCY_CHAIN_NOT_PROVEN';
  end if;

  if pg_catalog.strpos(v_insert_message, 'human_takeover_conversation') <> 0 then
    raise exception using errcode = 'P0001', message = 'P19A_4_T3_INSERT_MESSAGE_TAKEOVER_ALREADY_PRESENT';
  end if;

  if pg_catalog.to_regprocedure('public.ensure_human_takeover_lease_by_system(uuid)') is not null then
    v_ensure := pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'public.ensure_human_takeover_lease_by_system(uuid)'::regprocedure
    ));
    if pg_catalog.strpos(v_ensure, 'takeover_started_at = case') = 0
       or pg_catalog.strpos(v_ensure, 'released_at is not null') = 0
       or pg_catalog.strpos(v_ensure, 'for update of conversation_row') = 0
       or pg_catalog.strpos(v_ensure, 'from public.conversation_human_takeover_leases lease_row') = 0 then
      raise exception using errcode = 'P0001', message = 'P19A_4_T3_EXISTING_ENSURE_INCOMPATIBLE';
    end if;
    raise exception using errcode = 'P0001', message = 'P19A_4_T3_ENSURE_ALREADY_EXISTS';
  end if;

  if pg_catalog.to_regprocedure(
       'public.record_human_takeover_activity_by_system(uuid,uuid,uuid,text,text)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.release_human_takeover_lease_by_system(uuid,text)'
     ) is not null then
    raise exception using errcode = 'P0001', message = 'P19A_4_T3_TARGET_FUNCTION_ALREADY_EXISTS';
  end if;
end;
$preflight$;

create table if not exists public.conversation_human_takeover_leases (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  organization_id uuid not null,
  store_id uuid not null,
  takeover_started_at timestamptz not null,
  last_human_activity_at timestamptz not null,
  notice_30_at timestamptz,
  hard_hold boolean not null default false,
  released_at timestamptz,
  release_reason text,
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index if not exists conversation_human_takeover_leases_active_idx
  on public.conversation_human_takeover_leases (last_human_activity_at)
  where released_at is null;

create table if not exists public.conversation_human_takeover_activity_events (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  activity_key text not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (conversation_id, activity_key)
);

alter table public.conversation_human_takeover_leases enable row level security;
alter table public.conversation_human_takeover_activity_events enable row level security;
revoke all on table public.conversation_human_takeover_leases from public, anon, authenticated, service_role;
revoke all on table public.conversation_human_takeover_activity_events from public, anon, authenticated, service_role;
grant all on table public.conversation_human_takeover_leases to service_role;
grant all on table public.conversation_human_takeover_activity_events to service_role;

do $functions$
begin
  execute $sql$
    create function public.ensure_human_takeover_lease_by_system(
      p_conversation_id uuid
    ) returns void
    language plpgsql
    security definer
    set search_path = pg_catalog, pg_temp, public
    set row_security = off
    as $function$
    declare
      v_conversation public.conversations%rowtype;
      v_lease public.conversation_human_takeover_leases%rowtype;
      v_store_id uuid;
      v_now timestamptz := pg_catalog.clock_timestamp();
    begin
      select conversation_row.* into v_conversation
        from public.conversations conversation_row
       where conversation_row.id = p_conversation_id
       for update of conversation_row;
      if not found then
        raise exception using errcode = 'P0002', message = 'human takeover conversation not found';
      end if;

      select lead_row.store_id into v_store_id
        from public.leads lead_row
       where lead_row.id = v_conversation.lead_id
         and lead_row.organization_id = v_conversation.organization_id;
      if not found or v_store_id is null then
        raise exception using errcode = '42501', message = 'human takeover conversation scope mismatch';
      end if;

      select lease_row.* into v_lease
        from public.conversation_human_takeover_leases lease_row
       where lease_row.conversation_id = p_conversation_id
       for update;

      if found and (
           v_lease.organization_id is distinct from v_conversation.organization_id
           or v_lease.store_id is distinct from v_store_id
         ) then
        raise exception using errcode = '42501', message = 'human takeover lease scope mismatch';
      end if;

      if not found then
        insert into public.conversation_human_takeover_leases (
          conversation_id, organization_id, store_id, takeover_started_at,
          last_human_activity_at, notice_30_at, hard_hold, released_at,
          release_reason, updated_at
        ) values (
          p_conversation_id, v_conversation.organization_id, v_store_id, v_now,
          v_now, null, false, null, null, v_now
        );
        return;
      end if;

      update public.conversation_human_takeover_leases
         set takeover_started_at = case
               when v_lease.released_at is not null then v_now
               else v_lease.takeover_started_at
             end,
             last_human_activity_at = case
               when v_lease.released_at is not null then v_now
               else v_lease.last_human_activity_at
             end,
             notice_30_at = null,
             released_at = null,
             release_reason = null,
             updated_at = pg_catalog.clock_timestamp()
       where conversation_id = p_conversation_id
         and organization_id = v_conversation.organization_id
         and store_id = v_store_id;
      if not found then
        raise exception using errcode = 'P0001', message = 'human takeover lease update lost scope';
      end if;
    end;
    $function$;
  $sql$;

  execute $sql$
    create function public.record_human_takeover_activity_by_system(
      p_organization_id uuid,
      p_store_id uuid,
      p_conversation_id uuid,
      p_activity_key text default null,
      p_activity_at_text text default null
    ) returns void
    language plpgsql
    security definer
    set search_path = pg_catalog, pg_temp, public
    set row_security = off
    as $function$
    declare
      v_conversation public.conversations%rowtype;
      v_lease public.conversation_human_takeover_leases%rowtype;
      v_activity_at timestamptz := pg_catalog.clock_timestamp();
      v_candidate timestamptz;
      v_activity_key text;
      v_has_lease boolean := false;
      v_inserted boolean := true;
    begin
      select conversation_row.* into v_conversation
        from public.conversations conversation_row
        join public.leads lead_row
          on lead_row.id = conversation_row.lead_id
         and lead_row.organization_id = p_organization_id
         and lead_row.store_id = p_store_id
       where conversation_row.id = p_conversation_id
         and conversation_row.organization_id = p_organization_id
       for update of conversation_row;

      if not found then
        raise exception using errcode = '42501', message = 'human takeover conversation scope mismatch';
      end if;

      -- Lock order is conversation -> lease. Never repair an inconsistent
      -- existing lease by overwriting its tenant or store identity.
      select lease_row.* into v_lease
        from public.conversation_human_takeover_leases lease_row
       where lease_row.conversation_id = p_conversation_id
       for update;
      v_has_lease := found;
      if v_has_lease and (
           v_lease.organization_id is distinct from p_organization_id
           or v_lease.store_id is distinct from p_store_id
         ) then
        raise exception using errcode = '42501', message = 'human takeover lease scope mismatch';
      end if;

      if p_activity_at_text is not null and pg_catalog.btrim(p_activity_at_text) <> '' then
        begin
          v_candidate := p_activity_at_text::timestamptz;
          if v_candidate <= pg_catalog.clock_timestamp() then
            v_activity_at := v_candidate;
          end if;
        exception when others then
          null;
        end;
      end if;

      v_activity_key := nullif(pg_catalog.btrim(coalesce(p_activity_key, '')), '');
      if v_activity_key is not null then
        insert into public.conversation_human_takeover_activity_events (conversation_id, activity_key)
        values (p_conversation_id, v_activity_key)
        on conflict do nothing;
        v_inserted := found;
      end if;
      if not v_inserted then return; end if;

      if not v_has_lease then
        insert into public.conversation_human_takeover_leases (
          conversation_id, organization_id, store_id, takeover_started_at,
          last_human_activity_at, notice_30_at, hard_hold, released_at,
          release_reason, updated_at
        ) values (
          p_conversation_id, p_organization_id, p_store_id, v_activity_at,
          v_activity_at, null, false, null, null, pg_catalog.clock_timestamp()
        );
      else
        update public.conversation_human_takeover_leases
           set takeover_started_at = case
                 when v_lease.released_at is not null then v_activity_at
                 else v_lease.takeover_started_at
               end,
               last_human_activity_at = case
                 when v_lease.released_at is not null then v_activity_at
                 else greatest(v_lease.last_human_activity_at, v_activity_at)
               end,
               notice_30_at = null,
               released_at = null,
               release_reason = null,
               updated_at = pg_catalog.clock_timestamp()
         where conversation_id = p_conversation_id
           and organization_id = p_organization_id
           and store_id = p_store_id;
        if not found then
          raise exception using errcode = 'P0001', message = 'human takeover lease update lost scope';
        end if;
      end if;
    end;
    $function$;
  $sql$;

  execute $sql$
    create function public.release_human_takeover_lease_by_system(
      p_conversation_id uuid,
      p_reason text default 'human_release'
    ) returns void
    language plpgsql
    security definer
    set search_path = pg_catalog, pg_temp, public
    set row_security = off
    as $function$
    declare
      v_conversation public.conversations%rowtype;
      v_lease public.conversation_human_takeover_leases%rowtype;
      v_store_id uuid;
    begin
      select conversation_row.* into v_conversation
        from public.conversations conversation_row
       where conversation_row.id = p_conversation_id
       for update;
      if not found then return; end if;

      select lead_row.store_id into v_store_id
        from public.leads lead_row
       where lead_row.id = v_conversation.lead_id
         and lead_row.organization_id = v_conversation.organization_id;
      if not found then
        raise exception using errcode = '42501', message = 'human takeover conversation scope mismatch';
      end if;

      select lease_row.* into v_lease
        from public.conversation_human_takeover_leases lease_row
       where lease_row.conversation_id = p_conversation_id
       for update;
      if not found then return; end if;

      if v_lease.organization_id is distinct from v_conversation.organization_id
         or v_lease.store_id is distinct from v_store_id
         or v_lease.hard_hold is true then
        raise exception using errcode = '42501',
          message = 'legacy takeover release cannot cross active hard hold or scope';
      end if;

      update public.conversation_human_takeover_leases
         set released_at = case when released_at is null
                                then pg_catalog.clock_timestamp() else released_at end,
             release_reason = case when released_at is null
                                   then nullif(pg_catalog.btrim(coalesce(p_reason, '')), '')
                                   else release_reason end,
             updated_at = pg_catalog.clock_timestamp()
       where conversation_id = p_conversation_id
         and organization_id = v_conversation.organization_id
         and store_id = v_store_id;
    end;
    $function$;
  $sql$;
end;
$functions$;

do $release_patch$
declare
  v_oid oid;
  v_definition text;
  v_marker text := $marker$return;$marker$;
  v_replacement text := $replacement$
    perform public.release_human_takeover_lease_by_system(p_conversation_id, p_reason);
    return;$replacement$;
begin
  select procedure_row.oid, pg_catalog.pg_get_functiondef(procedure_row.oid)
    into v_oid, v_definition
  from pg_catalog.pg_proc procedure_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = procedure_row.pronamespace
  where namespace_row.nspname = 'public'
    and procedure_row.oid = 'public.human_release_conversation_to_ai(uuid,text,text)'::regprocedure;

  if v_oid is null
     or pg_catalog.strpos(pg_catalog.lower(v_definition), 'release_human_takeover_lease_by_system') <> 0
     or pg_catalog.length(v_definition) - pg_catalog.length(
          pg_catalog.replace(v_definition, v_marker, '')
        ) <> 2 * pg_catalog.length(v_marker) then
    raise exception using errcode = 'P0001', message = 'P19A_4_T3_RELEASE_PATCH_MARKER_MISSING_OR_ALREADY_PRESENT';
  end if;

  execute pg_catalog.replace(v_definition, v_marker, v_replacement);
end;
$release_patch$;

do $takeover_patch$
declare
  v_oid oid;
  v_definition text;
  v_marker text := $marker$return;$marker$;
  v_replacement text := $replacement$
    perform public.ensure_human_takeover_lease_by_system(p_conversation_id);
    return;$replacement$;
begin
  select procedure_row.oid, pg_catalog.pg_get_functiondef(procedure_row.oid)
    into v_oid, v_definition
  from pg_catalog.pg_proc procedure_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = procedure_row.pronamespace
  where namespace_row.nspname = 'public'
    and procedure_row.oid = 'public.human_takeover_conversation(uuid,text)'::regprocedure;

  if v_oid is null
     or pg_catalog.length(v_definition) - pg_catalog.length(
          pg_catalog.replace(v_definition, v_marker, '')
        ) <> 2 * pg_catalog.length(v_marker)
     or pg_catalog.strpos(v_definition, 'ensure_human_takeover_lease_by_system') <> 0 then
    raise exception using errcode = 'P0001', message = 'P19A_4_T3_TAKEOVER_PATCH_MARKER_MISSING_OR_ALREADY_PRESENT';
  end if;

  execute pg_catalog.replace(v_definition, v_marker, v_replacement);
end;
$takeover_patch$;

do $insert_message_patch$
declare
  v_oid oid;
  v_definition text;
  v_marker text := $marker$insert into public.messages ($marker$;
  v_replacement text := $replacement$
    if v_sender = 'human'
       and v_direction = 'outgoing'
       and (
         (
           coalesce(p_metadata ->> 'source', '') = 'panel'
           and (
             coalesce(p_metadata ->> 'outbound_origin', '') = 'crm_manual_text'
             or coalesce(p_metadata ->> 'source_channel', '') = 'panel_manual'
           )
         )
         or (
           coalesce(p_metadata ->> 'source', '') = 'meta_whatsapp_webhook'
           and coalesce(p_metadata ->> 'origin', '') = 'whatsapp_business_app'
           and coalesce(p_metadata ->> 'event_kind', '') = 'message_echo'
         )
       )
    then
    perform public.record_human_takeover_activity_by_system(
      v_org_id,
      v_store_id,
      p_conversation_id,
      coalesce(nullif(pg_catalog.btrim(p_metadata ->> 'human_activity_key'), ''), nullif(pg_catalog.btrim(p_external_message_id), '')),
      nullif(pg_catalog.btrim(p_metadata ->> 'human_activity_at'), '')
    );
    end if;

    if v_sender = 'human'
       and v_direction = 'outgoing'
       and coalesce(p_metadata ->> 'source', '') = 'panel'
       and (
         coalesce(p_metadata ->> 'outbound_origin', '') = 'crm_manual_text'
         or coalesce(p_metadata ->> 'source_channel', '') = 'panel_manual'
       )
    then
      perform public.human_takeover_conversation(
        p_conversation_id,
        'automatic_panel_human_message'
      );
    end if;

    insert into public.messages ($replacement$;
begin
  select procedure_row.oid, pg_catalog.pg_get_functiondef(procedure_row.oid)
    into v_oid, v_definition
  from pg_catalog.pg_proc procedure_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = procedure_row.pronamespace
  where namespace_row.nspname = 'public'
    and procedure_row.oid = 'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'::regprocedure;

  if v_oid is null or pg_catalog.strpos(v_definition, v_marker) = 0 then
    raise exception using errcode = 'P0001', message = 'P19A_4_T3_INSERT_MESSAGE_MARKER_MISSING';
  end if;

  if pg_catalog.strpos(v_definition, 'record_human_takeover_activity_by_system') <> 0 then
    raise exception using errcode = 'P0001', message = 'P19A_4_T3_INSERT_MESSAGE_ACTIVITY_ALREADY_PRESENT';
  end if;

  if pg_catalog.strpos(v_definition, 'human_takeover_conversation') <> 0 then
    raise exception using errcode = 'P0001', message = 'P19A_4_T3_INSERT_MESSAGE_TAKEOVER_ALREADY_PRESENT';
  end if;

  execute pg_catalog.replace(v_definition, v_marker, v_replacement);
end;
$insert_message_patch$;

-- Reaplica somente a implementacao canonica do painel da migration
-- 20261114060000, depois que as tabelas de lease deste reparo existem.
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
  v_request_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
  v_conversation public.conversations%rowtype;
  v_lease public.conversation_human_takeover_leases%rowtype;
  v_has_lease boolean := false;
  v_target_state text;
begin
  if v_user_id is null or v_request_role is distinct from 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'conversation transition is not authorized';
  end if;

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

alter function public.record_human_takeover_activity_by_system(uuid, uuid, uuid, text, text) owner to postgres;
alter function public.ensure_human_takeover_lease_by_system(uuid) owner to postgres;
alter function public.release_human_takeover_lease_by_system(uuid, text) owner to postgres;
revoke all on function public.record_human_takeover_activity_by_system(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.release_human_takeover_lease_by_system(uuid, text) from public, anon, authenticated;
grant execute on function public.record_human_takeover_activity_by_system(uuid, uuid, uuid, text, text) to service_role;
revoke all on function public.ensure_human_takeover_lease_by_system(uuid) from public, anon, authenticated;
grant execute on function public.ensure_human_takeover_lease_by_system(uuid) to service_role;
revoke execute on function public.release_human_takeover_lease_by_system(uuid, text) from service_role;
revoke all on function public.human_release_conversation_to_ai(uuid, text, text)
  from public, anon, authenticated, service_role;

revoke all on function public.process_stale_human_conversations() from public, anon, authenticated;
grant execute on function public.process_stale_human_conversations() to service_role;

do $postconditions$
declare
  v_p0 text := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.process_stale_human_conversations()'::regprocedure));
  v_insert_message text := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'::regprocedure));
  v_takeover text := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.human_takeover_conversation(uuid,text)'::regprocedure));
  v_ensure text := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.ensure_human_takeover_lease_by_system(uuid)'::regprocedure));
  v_panel text := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'::regprocedure));
  v_proc pg_catalog.pg_proc%rowtype;
  v_panel_proc pg_catalog.pg_proc%rowtype;
  v_signature text;
begin
  select * into v_panel_proc from pg_catalog.pg_proc
   where oid = 'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'::regprocedure;
  v_p0 := pg_catalog.regexp_replace(v_p0, '[[:space:]]+', ' ', 'g');
  if pg_catalog.to_regclass('public.conversation_human_takeover_leases') is null
     or pg_catalog.to_regclass('public.conversation_human_takeover_activity_events') is null
     or pg_catalog.to_regprocedure('public.record_human_takeover_activity_by_system(uuid,uuid,uuid,text,text)') is null
     or pg_catalog.to_regprocedure('public.ensure_human_takeover_lease_by_system(uuid)') is null
     or pg_catalog.to_regprocedure('public.release_human_takeover_lease_by_system(uuid,text)') is null
     or pg_catalog.strpos(v_p0, 'begin return 0; end;') = 0
     or pg_catalog.strpos(v_p0, 'declare') <> 0
     or pg_catalog.strpos(v_p0, 'if ') <> 0
     or pg_catalog.strpos(v_p0, 'loop') <> 0
     or pg_catalog.strpos(v_p0, 'select ') <> 0
     or pg_catalog.strpos(v_p0, 'insert ') <> 0
     or pg_catalog.strpos(v_p0, 'update ') <> 0
     or pg_catalog.strpos(v_p0, 'delete ') <> 0
     or pg_catalog.strpos(v_p0, 'perform ') <> 0
     or pg_catalog.strpos(v_p0, 'execute ') <> 0
     or pg_catalog.strpos(v_p0, 'transition_conversation_state') <> 0
     or pg_catalog.strpos(v_p0, 'human_takeover') <> 0
     or pg_catalog.strpos(v_p0, 'human_release') <> 0
     or pg_catalog.strpos(v_p0, 'conversation_human_takeover') <> 0
     or pg_catalog.strpos(v_insert_message, 'record_human_takeover_activity_by_system') = 0
     or pg_catalog.strpos(v_takeover, 'ensure_human_takeover_lease_by_system') = 0
     or pg_catalog.strpos(v_ensure, 'takeover_started_at = case') = 0
     or pg_catalog.strpos(v_ensure, 'released_at is not null') = 0
     or pg_catalog.strpos(v_ensure, 'for update of conversation_row') = 0
     or pg_catalog.strpos(v_ensure, 'from public.conversation_human_takeover_leases lease_row') = 0
     or pg_catalog.strpos(v_insert_message, 'private_acquire_sales_contract_conversation_xact_lock') = 0
     or pg_catalog.strpos(v_insert_message, 'ensure_commercial_conversation_session_context') = 0
     or pg_catalog.strpos(v_insert_message, 'record_human_takeover_activity_by_system') = 0
     or pg_catalog.strpos(v_insert_message, 'whatsapp_business_app') = 0
     or pg_catalog.strpos(v_insert_message, 'message_echo') = 0
     or pg_catalog.strpos(v_insert_message, 'automatic_panel_human_message') = 0
     or not v_panel_proc.prosecdef
     or coalesce(v_panel_proc.proconfig, '{}'::text[]) @> array['search_path=pg_catalog, pg_temp, public']::text[] is not true
     or pg_catalog.has_function_privilege('service_role', v_panel_proc.oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_panel_proc.oid, 'EXECUTE')
     or pg_catalog.strpos(v_panel, 'auth.uid()') = 0
     or pg_catalog.strpos(v_panel, 'current_setting(''request.jwt.claim.role'', true)') = 0
     or pg_catalog.strpos(v_panel, 'from public.conversation_human_takeover_leases lease_row') = 0
     or pg_catalog.strpos(v_panel, 'for update of conversation_row') = 0
     or pg_catalog.strpos(v_panel, 'human takeover hard hold requires explicit release authority') = 0
     or pg_catalog.strpos(v_panel, 'released_at') = 0
     or pg_catalog.strpos(v_panel, 'p_request_organization_id') = 0
     or pg_catalog.has_function_privilege('public', 'public.process_stale_human_conversations()', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.process_stale_human_conversations()', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.process_stale_human_conversations()', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', 'public.process_stale_human_conversations()', 'EXECUTE')
     or pg_catalog.has_function_privilege('public', 'public.ensure_human_takeover_lease_by_system(uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.ensure_human_takeover_lease_by_system(uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.ensure_human_takeover_lease_by_system(uuid)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', 'public.ensure_human_takeover_lease_by_system(uuid)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', 'public.record_human_takeover_activity_by_system(uuid,uuid,uuid,text,text)', 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', 'public.release_human_takeover_lease_by_system(uuid,text)', 'EXECUTE') then
    raise exception using errcode = 'P0001', message = 'P19A_4_T3_POSTCONDITION_FAILED';
  end if;

  foreach v_signature in array array[
    'public.ensure_human_takeover_lease_by_system(uuid)',
    'public.record_human_takeover_activity_by_system(uuid,uuid,uuid,text,text)',
    'public.release_human_takeover_lease_by_system(uuid,text)'
  ] loop
    select * into v_proc from pg_catalog.pg_proc where oid = pg_catalog.to_regprocedure(v_signature);
    if not found
       or not v_proc.prosecdef
       or coalesce(v_proc.proconfig, '{}'::text[]) @> array['search_path=pg_catalog, pg_temp, public']::text[] is not true then
      raise exception using errcode = 'P0001', message = 'P19A_4_T3_SECURITY_CATALOG_POSTCONDITION_FAILED:' || v_signature;
    end if;
  end loop;

  select * into v_proc from pg_catalog.pg_proc
   where oid = 'public.human_release_conversation_to_ai(uuid,text,text)'::regprocedure;
  if not found
     or not v_proc.prosecdef
     or coalesce(v_proc.proconfig, '{}'::text[]) @> array['search_path=pg_catalog, pg_temp']::text[] is not true
     or pg_catalog.has_function_privilege('authenticated', v_proc.oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_proc.oid, 'EXECUTE')
     or pg_catalog.strpos(
          pg_catalog.lower(pg_catalog.pg_get_functiondef(v_proc.oid)),
          'release_human_takeover_lease_by_system'
        ) = 0 then
    raise exception using errcode = 'P0001', message = 'P19A_4_T3_RELEASE_SECURITY_CATALOG_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;

-- N2 fences dependem das tabelas/funcoes instaladas pelo reparo acima.

do $worker_patch$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.materialize_sales_ai_reply_set_by_worker_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,text,uuid,uuid,jsonb,jsonb,jsonb)'
  );
  v_definition text;
  v_declaration_anchor constant text := '  v_expires_at timestamptz;';
  v_guard_anchor constant text :=
    '  -- Reutiliza integralmente a autoridade atual.';
  v_guard constant text := $guard$

  -- Revalida a autoridade diretamente no lease. A fence do materializador
  -- original continua sendo a autoridade atomica final sob a mesma transacao.
  declare
    v_lease_organization_id uuid;
    v_lease_store_id uuid;
    v_hard_hold boolean;
    v_released_at timestamptz;
  begin
    select lease_row.organization_id, lease_row.store_id,
           lease_row.hard_hold, lease_row.released_at
      into v_lease_organization_id, v_lease_store_id, v_hard_hold, v_released_at
      from public.conversation_human_takeover_leases lease_row
     where lease_row.conversation_id = p_conversation_id;

    if found and (
         v_lease_organization_id is distinct from p_organization_id
         or v_lease_store_id is distinct from p_store_id
         or v_hard_hold is true
         or v_released_at is null
       ) then
      raise exception using errcode = '42501',
        message = 'P19A_4_T3_N2_AI_BLOCKED_BY_HUMAN_CONTROL';
    end if;
  end;
$guard$;
begin
  if v_oid is null then
    raise exception using errcode = 'P0001',
      message = 'P19A_4_T3_N2_WORKER_FENCE_MISSING';
  end if;

  select pg_catalog.pg_get_functiondef(v_oid) into v_definition;
  if pg_catalog.strpos(v_definition, 'P19A_4_T3_N2_AI_BLOCKED_BY_HUMAN_CONTROL') > 0 then
    return;
  end if;
  if pg_catalog.strpos(v_definition, v_declaration_anchor) = 0
     or pg_catalog.strpos(v_definition, v_guard_anchor) = 0 then
    raise exception using errcode = 'P0001',
      message = 'P19A_4_T3_N2_WORKER_FENCE_DRIFT';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    v_declaration_anchor,
    v_declaration_anchor || E'\n  v_lease_organization_id uuid;\n  v_lease_store_id uuid;\n  v_hard_hold boolean;\n  v_released_at timestamptz;'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_guard_anchor,
    v_guard_anchor || v_guard
  );
  execute v_definition;
end;
$worker_patch$;

do $send_patch$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'
  );
  v_definition text;
  v_declaration_pattern constant text := '(?i)v_conversation_status[[:space:]]+text[[:space:]]*;';
  v_guard_pattern constant text := '(?i)select[[:space:]]+message_row[.][*][[:space:]]+into[[:space:]]+v_message[[:space:]]+from[[:space:]]+public[.]messages[[:space:]]+message_row[[:space:]]+where[[:space:]]+message_row[.]id[[:space:]]*=[[:space:]]*p_message_id[[:space:]]+and[[:space:]]+message_row[.]organization_id[[:space:]]*=[[:space:]]*p_organization_id[[:space:]]+and[[:space:]]+message_row[.]store_id[[:space:]]*=[[:space:]]*p_store_id[[:space:]]+and[[:space:]]+message_row[.]conversation_id[[:space:]]*=[[:space:]]*v_message[.]conversation_id[[:space:]]+for[[:space:]]+update[[:space:]]*;';
  v_declaration_anchor text;
  v_guard_anchor text;
  v_declaration_count integer;
  v_guard_count integer;
  v_guard constant text := $guard$
    if v_block_reason is null and v_initial_sender = 'ai'
       and v_message.sender = 'ai' then
      select lease_row.organization_id, lease_row.store_id,
             lease_row.hard_hold, lease_row.released_at
        into v_lease_organization_id, v_lease_store_id,
             v_hard_hold, v_lease_released_at
        from public.conversation_human_takeover_leases lease_row
       where lease_row.conversation_id = v_message.conversation_id
       for update;

      if found and (
           v_lease_organization_id is distinct from p_organization_id
           or v_lease_store_id is distinct from p_store_id
           or v_hard_hold is true
           or v_lease_released_at is null
         ) then
        v_block_reason := 'human_takeover_hard_hold';
      end if;
    end if;

$guard$;
begin
  if v_oid is null then
    raise exception using errcode = 'P0001',
      message = 'P19A_4_T3_N2_SEND_GATE_MISSING';
  end if;

  select pg_catalog.pg_get_functiondef(v_oid) into v_definition;
  if pg_catalog.strpos(v_definition, 'v_lease_released_at') > 0 then
    return;
  end if;
  select count(*) into v_declaration_count
    from pg_catalog.regexp_matches(v_definition, v_declaration_pattern, 'g');
  select count(*) into v_guard_count
    from pg_catalog.regexp_matches(v_definition, v_guard_pattern, 'g');
  if v_declaration_count <> 1 or v_guard_count <> 1 then
    raise exception using errcode = 'P0001',
      message = 'P19A_4_T3_N2_SEND_GATE_DRIFT',
      detail = pg_catalog.format('declaration=%s; fresh_read=%s', v_declaration_count, v_guard_count);
  end if;
  v_declaration_anchor := pg_catalog.substring(v_definition, v_declaration_pattern);
  v_guard_anchor := pg_catalog.substring(v_definition, v_guard_pattern);
  -- Insert before the fresh message row lock, after the conversation row lock.
  if pg_catalog.strpos(v_definition, 'WHATSAPP_EXTERNAL_SEND_GATE_MESSAGE_DISAPPEARED') = 0
     or pg_catalog.strpos(v_definition, 'human_takeover_active') = 0
     or pg_catalog.strpos(v_definition, 'private_acquire_sales_contract_conversation_xact_lock') = 0
     or pg_catalog.strpos(v_definition, 'private_acquire_sales_contract_conversation_xact_lock') >= pg_catalog.strpos(v_definition, 'human_takeover_active')
     or pg_catalog.strpos(v_definition, 'human_takeover_active') >= pg_catalog.strpos(v_definition, v_guard_anchor)
     or pg_catalog.strpos(v_definition, v_guard_anchor) >= pg_catalog.strpos(v_definition, 'WHATSAPP_EXTERNAL_SEND_GATE_MESSAGE_DISAPPEARED') then
    raise exception using errcode = 'P0001',
      message = 'P19A_4_T3_N2_SEND_GATE_DRIFT',
      detail = 'Unexpected ordering of conversation and fresh message locks';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    v_declaration_anchor,
    v_declaration_anchor || E'\n  v_lease_organization_id uuid;\n  v_lease_store_id uuid;\n  v_hard_hold boolean;\n  v_lease_released_at timestamptz;'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_guard_anchor,
    v_guard || '  ' || v_guard_anchor
  );
  execute v_definition;
end;
$send_patch$;

alter function public.materialize_sales_ai_reply_set_by_worker_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, boolean, text, uuid, uuid, jsonb, jsonb, jsonb
) owner to postgres;
alter function public.validate_or_cancel_whatsapp_external_send_by_system(uuid, uuid, uuid)
  owner to postgres;

do $postconditions$
declare
  v_worker text := pg_catalog.pg_get_functiondef(
    'public.materialize_sales_ai_reply_set_by_worker_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,text,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure
  );
  v_send text := pg_catalog.pg_get_functiondef(
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'::regprocedure
  );
begin
  if pg_catalog.strpos(v_worker, 'P19A_4_T3_N2_AI_BLOCKED_BY_HUMAN_CONTROL') = 0
     or pg_catalog.strpos(v_worker, 'conversation_human_takeover_leases') = 0
     or pg_catalog.strpos(v_send, 'v_lease_released_at') = 0
     or pg_catalog.strpos(v_send, 'human_takeover_hard_hold') = 0 then
    raise exception using errcode = 'P0001',
      message = 'P19A_4_T3_N2_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;


do $p19a_4_t3_n3_integrated_postconditions$
declare
  v_p0 text := (
    select pg_catalog.lower(p.prosrc)
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.process_stale_human_conversations()')
  );
  v_release_acl boolean := pg_catalog.has_function_privilege(
    'service_role',
    'public.release_human_takeover_lease_by_system(uuid,text)',
    'EXECUTE'
  );
  v_panel_acl boolean := pg_catalog.has_function_privilege(
    'authenticated',
    'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)',
    'EXECUTE'
  );
  v_panel_service_acl boolean := pg_catalog.has_function_privilege(
    'service_role',
    'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)',
    'EXECUTE'
  );
  v_human_release_service_acl boolean := pg_catalog.has_function_privilege(
    'service_role',
    'public.human_release_conversation_to_ai(uuid,text,text)',
    'EXECUTE'
  );
  v_worker text := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.materialize_sales_ai_reply_set_by_worker_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,text,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure
  ));
  v_send text := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'::regprocedure
  ));
  v_panel text := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'::regprocedure
  ));
begin
  if v_p0 is null
     or pg_catalog.regexp_replace(v_p0, '[[:space:]]+', '', 'g') not in ('beginreturn0;end;', 'beginreturn0;end')
     or v_release_acl
     or v_human_release_service_acl
     or not v_panel_acl
     or v_panel_service_acl
     or pg_catalog.strpos(v_worker, 'hard_hold') = 0
     or pg_catalog.strpos(v_worker, 'conversation_human_takeover_leases') = 0
     or pg_catalog.strpos(v_send, 'hard_hold') = 0
     or pg_catalog.strpos(v_send, 'released_at') = 0
     or pg_catalog.strpos(v_panel, 'auth.uid()') = 0
     or pg_catalog.strpos(v_panel, 'human takeover hard hold requires explicit release authority') = 0 then
    raise exception using errcode = 'P0001',
      message = 'P19A_4_T3_N3_INTEGRATED_POSTCONDITION_FAILED';
  end if;
end;
$p19a_4_t3_n3_integrated_postconditions$;

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

-- N29C candidate: apply only after N24 inside the rehearsal transaction.
-- No legacy release replacement; no automatic release or external calls.
do $n29c_preflight$
declare
  v_writer pg_catalog.pg_proc%rowtype;
  v_hash text;
begin
  if pg_catalog.to_regclass('public.conversation_human_takeover_hard_hold_decisions') is not null
     or pg_catalog.to_regprocedure('public.create_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text)') is not null
     or pg_catalog.to_regprocedure('public.release_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text)') is not null then
    raise exception 'N29C_HARD_HOLD_OBJECT_ALREADY_EXISTS';
  end if;
  select * into v_writer from pg_catalog.pg_proc
  where oid = pg_catalog.to_regprocedure('public.assistant_send_human_message(uuid,uuid,text)');
  if not found then raise exception 'N29C_WRITER_MISSING'; end if;
  v_hash := pg_catalog.md5(pg_catalog.btrim(pg_catalog.replace(v_writer.prosrc, chr(13), ''), E' \t\n'));
  if v_hash is distinct from '332202ad2a5663cb69dd16b2caa6575f' then
    raise exception 'N29C_WRITER_DRIFT: actual body md5=%', v_hash;
  end if;
  if not v_writer.prosecdef
     or not pg_catalog.has_function_privilege('authenticated',v_writer.oid,'EXECUTE')
     or pg_catalog.has_function_privilege('anon',v_writer.oid,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',v_writer.oid,'EXECUTE') then
    raise exception 'N29C_WRITER_ACL_DRIFT';
  end if;
end;
$n29c_preflight$;

create table public.conversation_human_takeover_hard_hold_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  conversation_id uuid not null,
  decision_type text not null,
  decision_key text not null,
  reason text not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint conversation_human_takeover_hard_hold_decisions_type_chk
    check (decision_type in ('created', 'released')),
  constraint conversation_human_takeover_hard_hold_decisions_key_chk
    check (pg_catalog.length(pg_catalog.btrim(decision_key)) > 0
           and pg_catalog.length(decision_key) <= 512),
  constraint conversation_human_takeover_hard_hold_decisions_reason_chk
    check (pg_catalog.length(pg_catalog.btrim(reason)) > 0
           and pg_catalog.length(reason) <= 2000),
  constraint conversation_human_takeover_hard_hold_decisions_conversation_scope_fkey
    foreign key (conversation_id, organization_id)
    references public.conversations(id, organization_id)
    on delete restrict,
  constraint conversation_human_takeover_hard_hold_decisions_store_scope_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,
  constraint conversation_human_takeover_hard_hold_decisions_key_uidx
    unique (organization_id, store_id, conversation_id, decision_key),
  constraint conversation_human_takeover_hard_hold_decisions_id_scope_uidx
    unique (id, organization_id, store_id, conversation_id)
);

create index if not exists conversation_human_takeover_hard_hold_decisions_scope_idx
  on public.conversation_human_takeover_hard_hold_decisions
    (organization_id, store_id, conversation_id, created_at);

alter table public.conversation_human_takeover_hard_hold_decisions
  enable row level security;

revoke all on table public.conversation_human_takeover_hard_hold_decisions
  from public, anon, authenticated, service_role;

create function public.create_human_takeover_hard_hold_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_reason text,
  p_decision_key text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := coalesce(nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''), nullif(auth.jwt() ->> 'role', ''));
  v_conversation public.conversations%rowtype;
  v_lease public.conversation_human_takeover_leases%rowtype;
  v_membership_role text;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_decision_key text := nullif(pg_catalog.btrim(coalesce(p_decision_key, '')), '');
  v_existing public.conversation_human_takeover_hard_hold_decisions%rowtype;
begin
  if v_user_id is null or v_request_role is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'hard hold is not authorized';
  end if;
  if v_reason is null or pg_catalog.length(v_reason) > 2000
     or v_decision_key is null or pg_catalog.length(v_decision_key) > 512 then
    raise exception using errcode = '22023', message = 'hard hold reason and decision key are required';
  end if;

  -- Every hard-hold decision follows conversation -> lease lock order.
  select conversation_row.*
    into v_conversation
    from public.conversations conversation_row
    join public.leads lead_row
      on lead_row.id = conversation_row.lead_id
     and lead_row.organization_id = p_organization_id
     and lead_row.store_id = p_store_id
    join public.stores store_row
      on store_row.id = lead_row.store_id
     and store_row.organization_id = lead_row.organization_id
   where conversation_row.id = p_conversation_id
     and conversation_row.organization_id = p_organization_id
   for update of conversation_row;

  if not found then
    raise exception using errcode = '42501', message = 'hard hold conversation scope mismatch';
  end if;

  select membership_row.role
    into v_membership_role
    from public.memberships membership_row
   where membership_row.organization_id = p_organization_id
     and membership_row.user_id = v_user_id
     and membership_row.is_active is true
   order by membership_row.created_at nulls first
   limit 1;
  if v_membership_role is null
     or not public._conversation_transition_role_is_allowed(v_membership_role) then
    raise exception using errcode = '42501', message = 'hard hold is not authorized';
  end if;

  select lease_row.*
    into v_lease
    from public.conversation_human_takeover_leases lease_row
   where lease_row.conversation_id = p_conversation_id
   for update;
  if not found then
    raise exception using errcode = '55000', message = 'hard hold requires an active human takeover lease';
  end if;
  if v_lease.organization_id is distinct from p_organization_id
     or v_lease.store_id is distinct from p_store_id then
    raise exception using errcode = '42501', message = 'hard hold lease scope mismatch';
  end if;

  select decision_row.*
    into v_existing
    from public.conversation_human_takeover_hard_hold_decisions decision_row
   where decision_row.organization_id = p_organization_id
     and decision_row.store_id = p_store_id
     and decision_row.conversation_id = p_conversation_id
     and decision_row.decision_key = v_decision_key
   for update;
  if found then
    if v_existing.decision_type <> 'created'
       or v_existing.reason <> v_reason
       or v_existing.actor_user_id <> v_user_id then
      raise exception using errcode = '23505', message = 'hard hold decision key conflict';
    end if;
    return;
  end if;

  if v_conversation.is_human_active is distinct from true
     or v_lease.released_at is not null then
    raise exception using errcode = '55000', message = 'hard hold requires active human control';
  end if;
  if v_lease.hard_hold is true then
    raise exception using errcode = '55000', message = 'hard hold is already active';
  end if;

  insert into public.conversation_human_takeover_hard_hold_decisions (
    organization_id, store_id, conversation_id, decision_type,
    decision_key, reason, actor_user_id
  ) values (
    p_organization_id, p_store_id, p_conversation_id, 'created',
    v_decision_key, v_reason, v_user_id
  );

  update public.conversation_human_takeover_leases
     set hard_hold = true, updated_at = pg_catalog.clock_timestamp()
   where conversation_id = p_conversation_id
     and organization_id = p_organization_id
     and store_id = p_store_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'hard hold lease was not updated';
  end if;
end;
$function$;

create function public.release_human_takeover_hard_hold_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_reason text,
  p_decision_key text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := coalesce(nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''), nullif(auth.jwt() ->> 'role', ''));
  v_conversation public.conversations%rowtype;
  v_lease public.conversation_human_takeover_leases%rowtype;
  v_membership_role text;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_decision_key text := nullif(pg_catalog.btrim(coalesce(p_decision_key, '')), '');
  v_existing public.conversation_human_takeover_hard_hold_decisions%rowtype;
begin
  if v_user_id is null or v_request_role is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'hard hold release is not authorized';
  end if;
  if v_reason is null or pg_catalog.length(v_reason) > 2000
     or v_decision_key is null or pg_catalog.length(v_decision_key) > 512 then
    raise exception using errcode = '22023', message = 'hard hold release reason and decision key are required';
  end if;

  select conversation_row.*
    into v_conversation
    from public.conversations conversation_row
    join public.leads lead_row
      on lead_row.id = conversation_row.lead_id
     and lead_row.organization_id = p_organization_id
     and lead_row.store_id = p_store_id
    join public.stores store_row
      on store_row.id = lead_row.store_id
     and store_row.organization_id = lead_row.organization_id
   where conversation_row.id = p_conversation_id
     and conversation_row.organization_id = p_organization_id
   for update of conversation_row;
  if not found then
    raise exception using errcode = '42501', message = 'hard hold conversation scope mismatch';
  end if;

  select membership_row.role
    into v_membership_role
    from public.memberships membership_row
   where membership_row.organization_id = p_organization_id
     and membership_row.user_id = v_user_id
     and membership_row.is_active is true
   order by membership_row.created_at nulls first
   limit 1;
  if v_membership_role is null
     or not public._conversation_transition_role_is_allowed(v_membership_role) then
    raise exception using errcode = '42501', message = 'hard hold release is not authorized';
  end if;

  select lease_row.*
    into v_lease
    from public.conversation_human_takeover_leases lease_row
   where lease_row.conversation_id = p_conversation_id
   for update;
  if not found then
    raise exception using errcode = '42501', message = 'hard hold lease scope mismatch';
  end if;
  if v_lease.organization_id is distinct from p_organization_id
     or v_lease.store_id is distinct from p_store_id then
    raise exception using errcode = '42501', message = 'hard hold lease scope mismatch';
  end if;

  select decision_row.*
    into v_existing
    from public.conversation_human_takeover_hard_hold_decisions decision_row
   where decision_row.organization_id = p_organization_id
     and decision_row.store_id = p_store_id
     and decision_row.conversation_id = p_conversation_id
     and decision_row.decision_key = v_decision_key
   for update;
  if found then
    if v_existing.decision_type <> 'released'
       or v_existing.reason <> v_reason
       or v_existing.actor_user_id <> v_user_id then
      raise exception using errcode = '23505', message = 'hard hold release decision key conflict';
    end if;
    return;
  end if;

  if v_conversation.is_human_active is distinct from true or v_lease.released_at is not null then
    raise exception using errcode = '55000', message = 'hard hold requires active human control';
  end if;
  if v_lease.hard_hold is not true then
    raise exception using errcode = '55000', message = 'hard hold is not active';
  end if;

  insert into public.conversation_human_takeover_hard_hold_decisions (
    organization_id, store_id, conversation_id, decision_type,
    decision_key, reason, actor_user_id
  ) values (
    p_organization_id, p_store_id, p_conversation_id, 'released',
    v_decision_key, v_reason, v_user_id
  );

  update public.conversation_human_takeover_leases
     set hard_hold = false, updated_at = pg_catalog.clock_timestamp()
   where conversation_id = p_conversation_id
     and organization_id = p_organization_id
     and store_id = p_store_id
     and hard_hold is true;
  if not found then
    raise exception using errcode = 'P0001', message = 'hard hold release did not update the locked lease';
  end if;
end;
$function$;

alter function public.create_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text) owner to postgres;
alter function public.release_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text) owner to postgres;
revoke all on function public.create_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text) from public, anon, service_role;
revoke all on function public.release_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text) from public, anon, service_role;
grant execute on function public.create_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.release_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text) to authenticated;

-- Add the real operator to the existing writer, not a caller-supplied identity.
do $n29c_provenance$
declare
  v_definition text := pg_catalog.pg_get_functiondef('public.assistant_send_human_message(uuid,uuid,text)'::regprocedure);
  v_anchor constant text := $a$'responsible_id', v_responsible_id$a$;
  v_new constant text := $a$'responsible_id', v_responsible_id,
      'actor_user_id', auth.uid()$a$;
begin
  if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor) <> 1
     or strpos(v_definition, $a$'actor_user_id'$a$) <> 0 then
    raise exception 'N29C_WRITER_ANCHOR_DRIFT';
  end if;
  execute replace(v_definition,v_anchor,v_new);
end;
$n29c_provenance$;

do $n29c_postconditions$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.create_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text)',
    'public.release_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text)',
    'public.assistant_send_human_message(uuid,uuid,text)'
  ] loop
    if not pg_catalog.has_function_privilege('authenticated',v_signature,'EXECUTE')
       or pg_catalog.has_function_privilege('anon',v_signature,'EXECUTE')
       or pg_catalog.has_function_privilege('service_role',v_signature,'EXECUTE') then
      raise exception 'N29C_ACL_FAILED: %',v_signature;
    end if;
  end loop;
  if strpos(pg_catalog.pg_get_functiondef('public.assistant_send_human_message(uuid,uuid,text)'::regprocedure), $a$'actor_user_id', auth.uid()$a$)=0
     or not exists (select 1 from pg_catalog.pg_class where oid='public.conversation_human_takeover_hard_hold_decisions'::regclass and relrowsecurity)
     or pg_catalog.has_table_privilege('authenticated','public.conversation_human_takeover_hard_hold_decisions','INSERT')
     or pg_catalog.has_table_privilege('service_role','public.conversation_human_takeover_hard_hold_decisions','INSERT') then
    raise exception 'N29C_POSTCONDITION_FAILED';
  end if;
end;
$n29c_postconditions$;

-- N30B: install after N29C, only inside the integrated rehearsal for now.
-- Preserve the legacy writer for ordinary messages; reserve panel reply provenance.
do $n30b_patch$
declare
  v_def text;
  v_anchor text;
  v_new text;
begin
  v_def := pg_catalog.pg_get_functiondef('public.assistant_push_system_message(uuid,uuid,text,text,uuid,uuid,uuid,jsonb)'::regprocedure);
  if pg_catalog.md5(v_def) is distinct from 'c39880e4516986f3d3667be4c304e710' then raise exception 'N30B_SYSTEM_WRITER_DRIFT'; end if;
  v_anchor := $a$  if coalesce(trim(p_content), '') = '' then$a$;
  v_new := $a$  -- Reserved reply provenance can only be written by the trusted backend.
  if pg_catalog.left(coalesce(p_metadata ->> 'source_external_message_id', ''), 6) = 'panel:'
     and coalesce(nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
                  nullif(auth.jwt() ->> 'role', '')) is distinct from 'service_role' then
    raise exception using errcode='42501', message='N30B_RESERVED_PANEL_REPLY_PROVENANCE';
  end if;
  if coalesce(trim(p_content), '') = '' then$a$;
  if (length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor) <> 1 then raise exception 'N30B_SYSTEM_WRITER_ANCHOR'; end if;
  execute replace(v_def,v_anchor,v_new);

  v_def := pg_catalog.pg_get_functiondef('public.panel_transition_conversation_state_scoped(uuid,uuid,text,text)'::regprocedure);
  if pg_catalog.md5(v_def) is distinct from '1b6d6beacab34f8997023f7092169c69' then raise exception 'N30B_PANEL_TRANSITION_DRIFT'; end if;
  v_anchor := $a$v_request_role <> 'authenticated'$a$;
  v_new := $a$coalesce(v_request_role, nullif(auth.jwt() ->> 'role', '')) is distinct from 'authenticated'$a$;
  if (length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor) <> 1 then raise exception 'N30B_PANEL_TRANSITION_ANCHOR'; end if;
  execute replace(v_def,v_anchor,v_new);
end;
$n30b_patch$;

create table public.assistant_human_control_command_receipts (
  human_message_id uuid primary key,
  organization_id uuid not null,
  store_id uuid not null,
  thread_id uuid not null,
  conversation_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('takeover_temporary','create_hard_hold','release_ai')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key (human_message_id,organization_id,store_id,thread_id)
    references public.store_assistant_messages(id,organization_id,store_id,thread_id) on delete restrict,
  foreign key (conversation_id,organization_id) references public.conversations(id,organization_id) on delete restrict,
  foreign key (store_id,organization_id) references public.stores(id,organization_id) on delete restrict
);
alter table public.assistant_human_control_command_receipts enable row level security;
revoke all on public.assistant_human_control_command_receipts from public,anon,authenticated,service_role;

create function public.execute_assistant_human_control_command_scoped(
  p_organization_id uuid, p_store_id uuid, p_human_message_id uuid
) returns table(outcome text, command_action text, target_conversation_id uuid)
language plpgsql security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $n30b$
declare
  v_user uuid := auth.uid();
  v_role text := coalesce(nullif(pg_catalog.current_setting('request.jwt.claim.role',true),''),nullif(auth.jwt()->>'role',''));
  v_message public.store_assistant_messages%rowtype;
  v_receipt public.assistant_human_control_command_receipts%rowtype;
  v_conversation public.conversations%rowtype;
  v_lease public.conversation_human_takeover_leases%rowtype;
  v_has_lease boolean;
  v_normal text;
  v_parts text[];
  v_action text;
  v_name text;
  v_target uuid;
  v_matches bigint;
  v_reason text;
  v_active boolean;
begin
  if v_user is null or v_role is distinct from 'authenticated'
    or not exists (select 1 from public.memberships m where m.organization_id=p_organization_id and m.user_id=v_user and m.is_active is true and public._conversation_transition_role_is_allowed(m.role::text)) then
    raise exception using errcode='42501',message='N30B_COMMAND_NOT_AUTHORIZED';
  end if;
  select m.* into v_message from public.store_assistant_messages m
  join public.store_assistant_threads t on t.id=m.thread_id and t.organization_id=m.organization_id and t.store_id=m.store_id
  where m.id=p_human_message_id and m.organization_id=p_organization_id and m.store_id=p_store_id
    and m.sender='human' and m.sender_role='store_responsible' and m.direction='incoming' and m.message_type='text'
    and m.metadata->>'origin'='panel' and m.metadata->>'channel'='panel' and m.metadata->>'actor_user_id'=v_user::text
    and t.thread_type='primary' and t.status='active'
  for update of m;
  if not found then raise exception using errcode='42501',message='N30B_COMMAND_SOURCE_INVALID'; end if;
  -- The source lock serializes retries, including retries after a new takeover.
  select r.* into v_receipt from public.assistant_human_control_command_receipts r where r.human_message_id=p_human_message_id;
  if found then
    if v_receipt.actor_user_id is distinct from v_user or v_receipt.organization_id is distinct from p_organization_id or v_receipt.store_id is distinct from p_store_id or v_receipt.thread_id is distinct from v_message.thread_id then
      raise exception using errcode='42501',message='N30B_COMMAND_RECEIPT_SCOPE';
    end if;
    return query select 'replayed'::text,v_receipt.action,v_receipt.conversation_id;
    return;
  end if;
  -- First execution only: short-lived, exact affirmative command and exact target.
  if v_message.created_at is null or v_message.created_at > pg_catalog.clock_timestamp() or v_message.created_at < pg_catalog.clock_timestamp()-interval '10 minutes' then
    raise exception using errcode='55000',message='N30B_COMMAND_EXPIRED';
  end if;
  if exists (select 1 from public.store_assistant_messages newer
    where newer.organization_id=p_organization_id and newer.store_id=p_store_id and newer.thread_id=v_message.thread_id
    and newer.sender='human' and newer.direction='incoming' and newer.created_at>v_message.created_at) then
    raise exception using errcode='55000',message='N30B_COMMAND_SUPERSEDED';
  end if;
  v_normal := pg_catalog.regexp_replace(pg_catalog.translate(pg_catalog.lower(pg_catalog.btrim(v_message.content)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '[[:space:]]+', ' ', 'g');
  v_parts := pg_catalog.regexp_match(v_normal, '^(eu vou cuidar|vou cuidar eu mesmo|vou assumir o atendimento|nao responda|pare de responder|mantenha em espera|pode assumir|pode voltar a responder|libere a ia|retome a ia) para (.+)$');
  if v_parts is null then raise exception using errcode='22023',message='N30B_COMMAND_EXPLICIT_TARGET_REQUIRED'; end if;
  v_action := case when v_parts[1] in ('eu vou cuidar','vou cuidar eu mesmo','vou assumir o atendimento') then 'takeover_temporary'
    when v_parts[1] in ('nao responda','pare de responder','mantenha em espera') then 'create_hard_hold' else 'release_ai' end;
  v_name := pg_catalog.btrim(v_parts[2]);
  -- Exact name only, no fuzzy ranking, no last-customer guessing. Every matching
  -- conversation counts, even if inactive. UUID syntax is for technical use.
  select count(*), min(c.id::text)::uuid into v_matches,v_target
  from public.conversations c join public.leads l on l.id=c.lead_id and l.organization_id=c.organization_id
  join public.stores s on s.id=l.store_id and s.organization_id=l.organization_id
  where c.organization_id=p_organization_id and s.id=p_store_id and (
    (v_name ~ '^conversa [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and v_name='conversa '||c.id::text)
    or (v_name !~ '^conversa [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and
      pg_catalog.regexp_replace(pg_catalog.translate(pg_catalog.lower(pg_catalog.btrim(l.name)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '[[:space:]]+', ' ', 'g')=v_name)
  );
  if v_matches <> 1 then raise exception using errcode='55000',message='N30B_COMMAND_TARGET_NOT_UNIQUE'; end if;
  select c.* into v_conversation from public.conversations c join public.leads l on l.id=c.lead_id and l.organization_id=c.organization_id
  where c.id=v_target and c.organization_id=p_organization_id and l.store_id=p_store_id for update of c;
  if not found then raise exception using errcode='42501',message='N30B_COMMAND_TARGET_SCOPE'; end if;
  select h.* into v_lease from public.conversation_human_takeover_leases h where h.conversation_id=v_target for update;
  v_has_lease := found;
  if v_has_lease and (v_lease.organization_id is distinct from p_organization_id or v_lease.store_id is distinct from p_store_id) then
    raise exception using errcode='42501',message='N30B_COMMAND_LEASE_SCOPE';
  end if;
  -- Reject commands issued before a subsequent human intervention or release.
  if v_has_lease and (v_message.created_at < v_lease.takeover_started_at or v_message.created_at < v_lease.last_human_activity_at or (v_action='release_ai' and v_message.created_at < v_lease.updated_at) or (v_lease.released_at is not null and v_message.created_at <= v_lease.released_at)) then
    raise exception using errcode='55000',message='N30B_COMMAND_STALE_CONTROL';
  end if;
  v_active := v_conversation.is_human_active is true and v_has_lease and v_lease.released_at is null;
  v_reason := 'assistant_human_command:'||p_human_message_id::text;
  if v_action='takeover_temporary' then
    if not v_active then
      perform public.panel_transition_conversation_state_scoped(p_organization_id,v_target,'humano_assumiu',v_reason);
    end if;
    if not exists (select 1 from public.conversations c join public.conversation_human_takeover_leases h on h.conversation_id=c.id where c.id=v_target and c.is_human_active is true and h.released_at is null and h.organization_id=p_organization_id and h.store_id=p_store_id) then raise exception 'N30B_TAKEOVER_POSTCONDITION'; end if;
  elsif v_action='create_hard_hold' then
    if not v_active then raise exception using errcode='55000',message='N30B_COMMAND_ACTIVE_TAKEOVER_REQUIRED'; end if;
    perform public.create_human_takeover_hard_hold_scoped(p_organization_id,p_store_id,v_target,v_reason,'human-command:'||p_human_message_id::text||':create_hard_hold');
  else
    if not v_active then raise exception using errcode='55000',message='N30B_COMMAND_ACTIVE_TAKEOVER_REQUIRED'; end if;
    if v_lease.hard_hold is true then raise exception using errcode='42501',message='N30B_COMMAND_HARD_HOLD_ACTIVE'; end if;
    perform public.panel_release_conversation_to_ai_scoped(p_organization_id,v_target,case when v_conversation.status='humano_assumiu' then null else v_conversation.status::text end,v_reason);
    if not exists (select 1 from public.conversations c join public.conversation_human_takeover_leases h on h.conversation_id=c.id where c.id=v_target and c.is_human_active is false and h.released_at is not null and h.hard_hold is false) then raise exception 'N30B_RELEASE_POSTCONDITION'; end if;
  end if;
  insert into public.assistant_human_control_command_receipts(human_message_id,organization_id,store_id,thread_id,conversation_id,actor_user_id,action)
  values(p_human_message_id,p_organization_id,p_store_id,v_message.thread_id,v_target,v_user,v_action);
  return query select 'applied'::text,v_action,v_target;
end;
$n30b$;
alter function public.execute_assistant_human_control_command_scoped(uuid,uuid,uuid) owner to postgres;
revoke all on function public.execute_assistant_human_control_command_scoped(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.execute_assistant_human_control_command_scoped(uuid,uuid,uuid) to authenticated;

do $n30b_catalog$
begin
  if not pg_catalog.has_function_privilege('authenticated','public.execute_assistant_human_control_command_scoped(uuid,uuid,uuid)','EXECUTE')
    or pg_catalog.has_function_privilege('anon','public.execute_assistant_human_control_command_scoped(uuid,uuid,uuid)','EXECUTE')
    or pg_catalog.has_function_privilege('service_role','public.execute_assistant_human_control_command_scoped(uuid,uuid,uuid)','EXECUTE')
    or pg_catalog.has_table_privilege('authenticated','public.assistant_human_control_command_receipts','INSERT')
    or pg_catalog.has_table_privilege('service_role','public.assistant_human_control_command_receipts','INSERT') then raise exception 'N30B_ACL_FAILED'; end if;
end;
$n30b_catalog$;

rollback;
