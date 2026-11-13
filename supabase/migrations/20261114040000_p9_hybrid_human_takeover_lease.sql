-- P9 Block 10 / Etapa 10.3
-- Persist the human takeover clock in the database.  The clock is shared by
-- panel and Business App messages and never sends a customer notification.

begin;

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

create or replace function public.record_human_takeover_activity_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_activity_key text default null,
  p_activity_at_text text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_conversation public.conversations%rowtype;
  v_activity_at timestamptz := pg_catalog.clock_timestamp();
  v_candidate timestamptz;
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

  if nullif(pg_catalog.btrim(coalesce(p_activity_key, '')), '') is not null then
    insert into public.conversation_human_takeover_activity_events (
      conversation_id, activity_key
    ) values (
      p_conversation_id, pg_catalog.btrim(p_activity_key)
    ) on conflict do nothing;
    v_inserted := found;
  end if;

  if not v_inserted then
    return;
  end if;

  insert into public.conversation_human_takeover_leases (
    conversation_id,
    organization_id,
    store_id,
    takeover_started_at,
    last_human_activity_at,
    notice_30_at,
    hard_hold,
    released_at,
    release_reason,
    updated_at
  ) values (
    p_conversation_id,
    p_organization_id,
    p_store_id,
    v_activity_at,
    v_activity_at,
    null,
    false,
    null,
    null,
    pg_catalog.clock_timestamp()
  )
  on conflict (conversation_id) do update
    set organization_id = excluded.organization_id,
        store_id = excluded.store_id,
        last_human_activity_at = greatest(
          public.conversation_human_takeover_leases.last_human_activity_at,
          excluded.last_human_activity_at
        ),
        notice_30_at = null,
        released_at = null,
        release_reason = null,
        updated_at = pg_catalog.clock_timestamp();
end;
$function$;

create or replace function public.ensure_human_takeover_lease_by_system(
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
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select * into v_conversation
    from public.conversations
   where id = p_conversation_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'human takeover conversation not found';
  end if;

  insert into public.conversation_human_takeover_leases (
    conversation_id, organization_id, store_id,
    takeover_started_at, last_human_activity_at, updated_at
  ) values (
    p_conversation_id, v_conversation.organization_id,
    (select lead_row.store_id from public.leads lead_row where lead_row.id = v_conversation.lead_id),
    v_now, v_now, v_now
  ) on conflict (conversation_id) do update
    set organization_id = excluded.organization_id,
        store_id = excluded.store_id,
        released_at = null,
        release_reason = null,
        notice_30_at = null,
        updated_at = pg_catalog.clock_timestamp();
end;
$function$;

create or replace function public.release_human_takeover_lease_by_system(
  p_conversation_id uuid,
  p_reason text default 'human_release'
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
begin
  update public.conversation_human_takeover_leases
     set released_at = pg_catalog.clock_timestamp(),
         release_reason = nullif(pg_catalog.btrim(coalesce(p_reason, '')), ''),
         updated_at = pg_catalog.clock_timestamp()
   where conversation_id = p_conversation_id;
end;
$function$;

-- The canonical writer supplies the durable message key/timestamp before the
-- existing takeover transition.  This keeps panel and Business App paths in
-- one authority and makes duplicate webhook events idempotent.
do $migration$
declare
  v_oid oid;
  v_definition text;
  v_marker text := $marker$
    perform public.human_takeover_conversation(
      p_conversation_id,
      'automatic_panel_human_message'
    );$marker$;
  v_replacement text := $replacement$
    perform public.record_human_takeover_activity_by_system(
      v_org_id,
      v_store_id,
      p_conversation_id,
      coalesce(nullif(pg_catalog.btrim(p_metadata ->> 'human_activity_key'), ''), nullif(pg_catalog.btrim(p_external_message_id), '')),
      nullif(pg_catalog.btrim(p_metadata ->> 'human_activity_at'), '')
    );

    perform public.human_takeover_conversation(
      p_conversation_id,
      'automatic_panel_human_message'
    );$replacement$;
begin
  select procedure_row.oid, pg_catalog.pg_get_functiondef(procedure_row.oid)
    into v_oid, v_definition
  from pg_catalog.pg_proc procedure_row
  join pg_catalog.pg_namespace namespace_row on namespace_row.oid = procedure_row.pronamespace
  where namespace_row.nspname = 'public'
    and procedure_row.oid = 'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'::regprocedure;

  if v_oid is null or pg_catalog.strpos(v_definition, v_marker) = 0 then
    raise exception using errcode = 'P0001', message = 'P9_10_3_INSERT_MESSAGE_PRECONDITION_FAILED';
  end if;

  execute pg_catalog.replace(v_definition, v_marker, v_replacement);
end;
$migration$;

create or replace function public.human_takeover_conversation(
  p_conversation_id uuid,
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
begin
  if v_user_id is not null and v_request_role = 'authenticated' then
    perform public.transition_conversation_state_by_user(
      p_conversation_id, 'humano_assumiu', v_user_id, p_reason,
      'human_takeover_conversation', null, null, '{}'::jsonb
    );
    perform public.ensure_human_takeover_lease_by_system(p_conversation_id);
    return;
  end if;

  if v_request_role = 'service_role' or session_user = 'postgres' then
    perform public.transition_conversation_state_internal(
      p_conversation_id => p_conversation_id,
      p_to_state => 'humano_assumiu',
      p_reason => p_reason,
      p_actor_type => 'system',
      p_source => 'human_takeover_conversation',
      p_event_key => null,
      p_metadata => pg_catalog.jsonb_build_object(
        'compatibility_bridge', 'legacy_conversation_transition',
        'wrapper', 'human_takeover_conversation',
        'takeover_mode', 'internal_system'
      )
    );
    perform public.ensure_human_takeover_lease_by_system(p_conversation_id);
    return;
  end if;

  raise exception using errcode = '42501', message = 'conversation transition is not authorized';
end;
$function$;

create or replace function public.human_release_conversation_to_ai(
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
  v_target_state text := coalesce(
    nullif(pg_catalog.btrim(coalesce(p_to_state, '')), ''),
    public.resolve_human_release_target_state(p_conversation_id)
  );
begin
  if v_user_id is not null and v_request_role = 'authenticated' then
    perform public.transition_conversation_state_by_user(
      p_conversation_id, v_target_state, v_user_id, p_reason,
      'human_release_conversation_to_ai', null, null, '{}'::jsonb
    );
    perform public.release_human_takeover_lease_by_system(p_conversation_id, p_reason);
    return;
  end if;

  if v_request_role = 'service_role' or session_user = 'postgres' then
    perform public.transition_conversation_state_internal(
      p_conversation_id => p_conversation_id,
      p_to_state => v_target_state,
      p_reason => p_reason,
      p_actor_type => 'system',
      p_source => 'human_release_conversation_to_ai',
      p_event_key => null,
      p_metadata => pg_catalog.jsonb_build_object(
        'compatibility_bridge', 'legacy_conversation_transition',
        'wrapper', 'human_release_conversation_to_ai',
        'release_mode', 'internal_system'
      )
    );
    perform public.release_human_takeover_lease_by_system(p_conversation_id, p_reason);
    return;
  end if;

  raise exception using errcode = '42501', message = 'conversation transition is not authorized';
end;
$function$;

create or replace function public.process_stale_human_conversations()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_row record;
  v_event_key text;
  v_processed bigint := 0;
begin
  -- The 30-minute mark is internal reference only. No customer notification
  -- is emitted and human control remains active.
  update public.conversation_human_takeover_leases lease_row
     set notice_30_at = pg_catalog.clock_timestamp(),
         updated_at = pg_catalog.clock_timestamp()
   where lease_row.released_at is null
     and lease_row.notice_30_at is null
     and lease_row.last_human_activity_at <= pg_catalog.clock_timestamp() - interval '30 minutes';

  for v_row in
    select conversation_row.id as conversation_id,
           conversation_row.organization_id,
           lease_row.last_human_activity_at
      from public.conversations conversation_row
      join public.conversation_human_takeover_leases lease_row
        on lease_row.conversation_id = conversation_row.id
       and lease_row.organization_id = conversation_row.organization_id
     where conversation_row.status = 'humano_assumiu'
       and coalesce(conversation_row.is_human_active, false)
       and lease_row.released_at is null
       and not lease_row.hard_hold
       and lease_row.last_human_activity_at <= pg_catalog.clock_timestamp() - interval '40 minutes'
     for update of conversation_row, lease_row skip locked
  loop
    v_event_key := 'hybrid_human_timeout:' || v_row.conversation_id::text || ':' || v_row.last_human_activity_at::text;

    perform public.transition_conversation_state_internal(
      p_conversation_id => v_row.conversation_id,
      p_to_state => public.resolve_human_release_target_state(v_row.conversation_id),
      p_reason => 'hybrid_human_timeout_auto_release',
      p_actor_type => 'system',
      p_source => 'hybrid_human_timeout_auto_release',
      p_event_key => v_event_key,
      p_metadata => pg_catalog.jsonb_build_object(
        'source', 'hybrid_human_timeout_auto_release',
        'origin', 'hybrid_human_timeout_auto_release',
        'timeout_minutes', 40,
        'takeover_started_at', v_row.last_human_activity_at
      )
    );

    perform public.release_human_takeover_lease_by_system(
      v_row.conversation_id,
      'hybrid_human_timeout_auto_release'
    );
    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$function$;

alter function public.record_human_takeover_activity_by_system(uuid, uuid, uuid, text, text) owner to postgres;
alter function public.ensure_human_takeover_lease_by_system(uuid) owner to postgres;
alter function public.release_human_takeover_lease_by_system(uuid, text) owner to postgres;
alter function public.human_takeover_conversation(uuid, text) owner to postgres;
alter function public.human_release_conversation_to_ai(uuid, text, text) owner to postgres;
alter function public.process_stale_human_conversations() owner to postgres;

revoke all on function public.record_human_takeover_activity_by_system(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.ensure_human_takeover_lease_by_system(uuid) from public, anon, authenticated;
revoke all on function public.release_human_takeover_lease_by_system(uuid, text) from public, anon, authenticated;
grant execute on function public.record_human_takeover_activity_by_system(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.ensure_human_takeover_lease_by_system(uuid) to service_role;
grant execute on function public.release_human_takeover_lease_by_system(uuid, text) to service_role;

do $postconditions$
begin
  if pg_catalog.to_regclass('public.conversation_human_takeover_leases') is null
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.process_stale_human_conversations()'::regprocedure), '40 minutes') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.process_stale_human_conversations()'::regprocedure), 'hard_hold') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.record_human_takeover_activity_by_system(uuid,uuid,uuid,text,text)'::regprocedure), 'on conflict') = 0 then
    raise exception using errcode = 'P0001', message = 'P9_10_3_HYBRID_TAKEOVER_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;

commit;
