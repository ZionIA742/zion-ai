-- P19-A / Bloco 5 / Etapa 5.1
-- Manual contract checks for the responsible WhatsApp -> Assistant bridge.
-- Execute only against the intended DEV database, after the 5.1 migration.
-- Read-only checks: this runner does not create, update or delete business rows.

do $$
declare
  v_indexdef text;
  v_constraintdef text;
  v_functiondef text;
  v_relrowsecurity boolean;
begin
  if to_regclass('public.store_assistant_responsible_whatsapp_events') is null then
    raise exception '5.1 table is missing';
  end if;

  if to_regclass('public.store_assistant_messages') is null
     or to_regclass('public.store_assistant_threads') is null
     or to_regclass('public.store_responsibles') is null then
    raise exception '5.1 canonical Assistant/responsible tables are missing';
  end if;

  if to_regprocedure('public.claim_store_assistant_responsible_whatsapp_event(uuid,text,timestamptz,interval)') is null then
    raise exception '5.1 atomic claim function is missing';
  end if;

  -- RLS must be enabled.
  select class_row.relrowsecurity
    into v_relrowsecurity
    from pg_class class_row
    join pg_namespace namespace_row on namespace_row.oid = class_row.relnamespace
   where namespace_row.nspname = 'public'
     and class_row.relname = 'store_assistant_responsible_whatsapp_events';

  if coalesce(v_relrowsecurity, false) is not true then
    raise exception '5.1 ledger RLS is not enabled';
  end if;

  -- anon/authenticated must have no direct table access.
  if has_table_privilege('anon', 'public.store_assistant_responsible_whatsapp_events', 'SELECT')
     or has_table_privilege('anon', 'public.store_assistant_responsible_whatsapp_events', 'INSERT')
     or has_table_privilege('anon', 'public.store_assistant_responsible_whatsapp_events', 'UPDATE')
     or has_table_privilege('anon', 'public.store_assistant_responsible_whatsapp_events', 'DELETE')
     or has_table_privilege('authenticated', 'public.store_assistant_responsible_whatsapp_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.store_assistant_responsible_whatsapp_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.store_assistant_responsible_whatsapp_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.store_assistant_responsible_whatsapp_events', 'DELETE') then
    raise exception '5.1 anonymous/authenticated table access is open';
  end if;

  if not has_table_privilege('service_role', 'public.store_assistant_responsible_whatsapp_events', 'SELECT')
     or not has_table_privilege('service_role', 'public.store_assistant_responsible_whatsapp_events', 'INSERT')
     or not has_table_privilege('service_role', 'public.store_assistant_responsible_whatsapp_events', 'UPDATE') then
    raise exception '5.1 service_role required table privileges are missing';
  end if;

  if has_table_privilege('service_role', 'public.store_assistant_responsible_whatsapp_events', 'DELETE') then
    raise exception '5.1 DELETE must not be granted to service_role';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.claim_store_assistant_responsible_whatsapp_event(uuid,text,timestamptz,interval)',
    'EXECUTE'
  ) then
    raise exception '5.1 service_role claim execute is missing';
  end if;

  if has_function_privilege(
    'anon',
    'public.claim_store_assistant_responsible_whatsapp_event(uuid,text,timestamptz,interval)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.claim_store_assistant_responsible_whatsapp_event(uuid,text,timestamptz,interval)',
    'EXECUTE'
  ) then
    raise exception '5.1 claim function is callable by anon/authenticated';
  end if;

  -- Canonical scoped unique targets must exist for the composite FKs.
  if not exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and tablename = 'store_responsibles'
       and indexname = 'store_responsibles_id_scope_uidx'
  ) then
    raise exception '5.1 responsible scope unique target is missing';
  end if;

  if not exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and tablename = 'store_assistant_threads'
       and indexname = 'store_assistant_threads_id_scope_uidx'
  ) then
    raise exception '5.1 thread scope unique target is missing';
  end if;

  if not exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and tablename = 'store_assistant_messages'
       and indexname = 'store_assistant_messages_id_thread_scope_uidx'
  ) then
    raise exception '5.1 message thread scope unique target is missing';
  end if;

  -- Event replay protection must be store/tenant scoped.
  select index_row.indexdef
    into v_indexdef
    from pg_indexes index_row
   where index_row.schemaname = 'public'
     and index_row.tablename = 'store_assistant_responsible_whatsapp_events'
     and index_row.indexname = 'store_assistant_responsible_whatsapp_events_external_uidx';

  if v_indexdef is null
     or v_indexdef not ilike '%organization_id%'
     or v_indexdef not ilike '%store_id%'
     or v_indexdef not ilike '%external_message_id%'
     or v_indexdef not ilike '%unique index%' then
    raise exception '5.1 event replay unique index is not the expected contract';
  end if;

  -- Message replay protection must only target inbound responsible WhatsApp messages.
  select index_row.indexdef
    into v_indexdef
    from pg_indexes index_row
   where index_row.schemaname = 'public'
     and index_row.tablename = 'store_assistant_messages'
     and index_row.indexname = 'store_assistant_messages_responsible_whatsapp_external_uidx';

  if v_indexdef is null
     or v_indexdef not ilike '%organization_id%'
     or v_indexdef not ilike '%store_id%'
     or v_indexdef not ilike '%external_message_id%'
     or v_indexdef not ilike '%sender_role = ''store_responsible''%'
     or v_indexdef not ilike '%direction = ''incoming''%'
     or v_indexdef not ilike '%origin%whatsapp%' then
    raise exception '5.1 responsible WhatsApp replay index is not the expected contract';
  end if;

  -- Responsible FK must bind the id to the same organization/store.
  select pg_get_constraintdef(constraint_row.oid)
    into v_constraintdef
    from pg_constraint constraint_row
   where constraint_row.conrelid = 'public.store_assistant_responsible_whatsapp_events'::regclass
     and constraint_row.conname = 'store_assistant_responsible_whatsapp_events_responsible_fkey';

  if v_constraintdef is null
     or v_constraintdef not ilike '%responsible_id, organization_id, store_id%'
     or v_constraintdef not ilike '%store_responsibles%id, organization_id, store_id%' then
    raise exception '5.1 responsible scoped FK is missing or malformed';
  end if;

  -- Thread FK must bind the thread to the same organization/store.
  select pg_get_constraintdef(constraint_row.oid)
    into v_constraintdef
    from pg_constraint constraint_row
   where constraint_row.conrelid = 'public.store_assistant_responsible_whatsapp_events'::regclass
     and constraint_row.conname = 'store_assistant_responsible_whatsapp_events_thread_fkey';

  if v_constraintdef is null
     or v_constraintdef not ilike '%thread_id, organization_id, store_id%'
     or v_constraintdef not ilike '%store_assistant_threads%id, organization_id, store_id%' then
    raise exception '5.1 thread scoped FK is missing or malformed';
  end if;

  -- Message FKs must bind id + tenant/store + exact Assistant thread.
  select pg_get_constraintdef(constraint_row.oid)
    into v_constraintdef
    from pg_constraint constraint_row
   where constraint_row.conrelid = 'public.store_assistant_responsible_whatsapp_events'::regclass
     and constraint_row.conname = 'store_assistant_responsible_whatsapp_events_inbound_message_fkey';

  if v_constraintdef is null
     or v_constraintdef not ilike '%inbound_message_id, organization_id, store_id, thread_id%'
     or v_constraintdef not ilike '%store_assistant_messages%id, organization_id, store_id, thread_id%' then
    raise exception '5.1 inbound message scoped FK is missing or malformed';
  end if;

  select pg_get_constraintdef(constraint_row.oid)
    into v_constraintdef
    from pg_constraint constraint_row
   where constraint_row.conrelid = 'public.store_assistant_responsible_whatsapp_events'::regclass
     and constraint_row.conname = 'store_assistant_responsible_whatsapp_events_assistant_message_fkey';

  if v_constraintdef is null
     or v_constraintdef not ilike '%assistant_message_id, organization_id, store_id, thread_id%'
     or v_constraintdef not ilike '%store_assistant_messages%id, organization_id, store_id, thread_id%' then
    raise exception '5.1 assistant message scoped FK is missing or malformed';
  end if;

  -- Prevent MATCH SIMPLE from bypassing the message FKs through thread_id = NULL.
  if not exists (
    select 1
      from pg_constraint constraint_row
     where constraint_row.conrelid = 'public.store_assistant_responsible_whatsapp_events'::regclass
       and constraint_row.conname = 'store_assistant_responsible_whatsapp_events_inbound_thread_required_check'
       and pg_get_constraintdef(constraint_row.oid) ilike '%inbound_message_id%thread_id%'
  ) then
    raise exception '5.1 inbound message/thread NULL guard is missing';
  end if;

  if not exists (
    select 1
      from pg_constraint constraint_row
     where constraint_row.conrelid = 'public.store_assistant_responsible_whatsapp_events'::regclass
       and constraint_row.conname = 'store_assistant_responsible_whatsapp_events_assistant_thread_required_check'
       and pg_get_constraintdef(constraint_row.oid) ilike '%assistant_message_id%thread_id%'
  ) then
    raise exception '5.1 assistant message/thread NULL guard is missing';
  end if;

  if not exists (
    select 1
      from pg_constraint constraint_row
     where constraint_row.conrelid = 'public.store_assistant_responsible_whatsapp_events'::regclass
       and constraint_row.conname = 'store_assistant_responsible_whatsapp_events_status_check'
       and pg_get_constraintdef(constraint_row.oid) ilike '%received%'
       and pg_get_constraintdef(constraint_row.oid) ilike '%processing%'
       and pg_get_constraintdef(constraint_row.oid) ilike '%sent%'
       and pg_get_constraintdef(constraint_row.oid) ilike '%failed%'
       and pg_get_constraintdef(constraint_row.oid) ilike '%uncertain%'
  ) then
    raise exception '5.1 status check is missing or incomplete';
  end if;

  if not exists (
    select 1
      from pg_constraint constraint_row
     where constraint_row.conrelid = 'public.store_assistant_responsible_whatsapp_events'::regclass
       and constraint_row.conname = 'store_assistant_responsible_whatsapp_events_processing_lock_check'
  ) then
    raise exception '5.1 processing lock consistency check is missing';
  end if;

  -- sender_role is text in the current contract. If a DB check exists, it must
  -- explicitly permit store_responsible.
  if exists (
    select 1
      from pg_constraint constraint_row
     where constraint_row.conrelid = 'public.store_assistant_messages'::regclass
       and constraint_row.contype = 'c'
       and pg_get_constraintdef(constraint_row.oid) ilike '%sender_role%'
       and pg_get_constraintdef(constraint_row.oid) not ilike '%store_responsible%'
  ) then
    raise exception '5.1 sender_role check does not allow store_responsible';
  end if;

  -- The claim must be atomic, service-role gated, fail on NULL p_now, claim only
  -- received rows and report stale processing without automatically reclaiming.
  select pg_get_functiondef(
    'public.claim_store_assistant_responsible_whatsapp_event(uuid,text,timestamptz,interval)'::regprocedure
  ) into v_functiondef;

  if v_functiondef is null
     or v_functiondef not ilike '%zion_resolve_request_role_internal()%'
     or v_functiondef not ilike '%p_now is null%'
     or v_functiondef not ilike '%event_row.status = ''received''%'
     or v_functiondef not ilike '%status = ''processing''%'
     or v_functiondef not ilike '%processing_stale%'
     or v_functiondef not ilike '%locked_by = v_claim_token%'
     or v_functiondef not ilike '%claim_token = v_claim_token%' then
    raise exception '5.1 atomic claim function definition is not the expected fail-closed contract';
  end if;

  -- P9 remains separate and untouched.
  if to_regprocedure(
    'public.record_post_technical_visit_followup_response(uuid,uuid,uuid,text,text,text,jsonb,timestamptz)'
  ) is null then
    raise exception 'P9 7.4 response authority unexpectedly missing';
  end if;
end;
$$;

select '5.1 responsible assistant bridge manual contract checks passed' as result;
