-- P19-A / Bloco 4 / 4-T3-N.3 / ensaio integrado somente leitura operacional
-- Reparos e fences sao compostos nesta ordem; somente os delimitadores externos sao removidos.
begin;

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

rollback;
