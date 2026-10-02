-- P19-A / Bloco 5 / Etapa 5.1
-- Manual checks for the responsible WhatsApp -> Assistant bridge.
-- Execute only against the intended DEV database. This file was not executed.

do $$
declare
  v_predicate text;
  v_constraint text;
begin
  if to_regclass('public.store_assistant_responsible_whatsapp_events') is null then
    raise exception '5.1 table is missing';
  end if;

  if to_regclass('public.store_assistant_messages') is null
     or to_regclass('public.store_responsibles') is null then
    raise exception '5.1 canonical message/responsible tables are missing';
  end if;

  if to_regprocedure('public.claim_store_assistant_responsible_whatsapp_event(uuid,text,timestamptz,interval)') is null then
    raise exception '5.1 atomic claim function is missing';
  end if;

  if not has_table_privilege('anon', 'public.store_assistant_responsible_whatsapp_events', 'SELECT')
     and not has_table_privilege('authenticated', 'public.store_assistant_responsible_whatsapp_events', 'SELECT')
     and not has_table_privilege('anon', 'public.store_assistant_responsible_whatsapp_events', 'INSERT')
     and not has_table_privilege('authenticated', 'public.store_assistant_responsible_whatsapp_events', 'INSERT') then
    null;
  else
    raise exception '5.1 anonymous/authenticated table access is open';
  end if;

  if not has_table_privilege('service_role', 'public.store_assistant_responsible_whatsapp_events', 'SELECT')
     or not has_table_privilege('service_role', 'public.store_assistant_responsible_whatsapp_events', 'INSERT')
     or not has_table_privilege('service_role', 'public.store_assistant_responsible_whatsapp_events', 'UPDATE') then
    raise exception '5.1 service_role required table privileges are missing';
  end if;

  if has_table_privilege('anon', 'public.store_assistant_responsible_whatsapp_events', 'DELETE')
     or has_table_privilege('authenticated', 'public.store_assistant_responsible_whatsapp_events', 'DELETE')
     or has_table_privilege('service_role', 'public.store_assistant_responsible_whatsapp_events', 'DELETE') then
    raise exception '5.1 DELETE must not be granted';
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

  select pg_get_indexdef(index_row.indexrelid)
    into v_predicate
    from pg_index index_row
    join pg_class table_row on table_row.oid = index_row.indrelid
    join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
   where namespace_row.nspname = 'public'
     and table_row.relname = 'store_assistant_messages'
     and index_row.indexrelid::regclass::text = 'public.store_assistant_messages_responsible_whatsapp_external_uidx';

  if v_predicate is null
     or v_predicate not ilike '%sender_role = ''store_responsible''%'
     or v_predicate not ilike '%direction = ''incoming''%'
     or v_predicate not ilike '%origin%whatsapp%' then
    raise exception '5.1 replay index predicate is not the expected contract';
  end if;

  for v_constraint in
    select constraint_row.conname
      from pg_constraint constraint_row
     where constraint_row.conrelid = 'public.store_assistant_responsible_whatsapp_events'::regclass
       and constraint_row.conname in (
         'store_assistant_responsible_whatsapp_events_responsible_fkey',
         'store_assistant_responsible_whatsapp_events_inbound_message_fkey',
         'store_assistant_responsible_whatsapp_events_assistant_message_fkey'
       )
  loop
    null;
  end loop;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.store_assistant_responsible_whatsapp_events'::regclass
       and conname = 'store_assistant_responsible_whatsapp_events_responsible_fkey'
  ) then
    raise exception '5.1 responsible scoped FK is missing';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.store_assistant_responsible_whatsapp_events'::regclass
       and conname = 'store_assistant_responsible_whatsapp_events_inbound_message_fkey'
  ) or not exists (
    select 1 from pg_constraint
     where conrelid = 'public.store_assistant_responsible_whatsapp_events'::regclass
       and conname = 'store_assistant_responsible_whatsapp_events_assistant_message_fkey'
  ) then
    raise exception '5.1 message scoped FKs are missing';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'store_assistant_messages'
       and indexname = 'store_assistant_messages_id_thread_scope_uidx'
  ) then
    raise exception '5.1 message thread scope unique target is missing';
  end if;

  if not exists (
    select 1 from pg_constraint constraint_row
     where constraint_row.conrelid = 'public.store_assistant_responsible_whatsapp_events'::regclass
       and pg_get_constraintdef(constraint_row.oid) ilike '%status%received%processing%sent%failed%uncertain%'
  ) then
    raise exception '5.1 status check is missing';
  end if;

  -- The sender_role contract is proven by the real messages column and the
  -- partial replay index. If a check constraint exists, it must include the
  -- new historical role instead of silently rejecting the bridge message.
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

  -- No P9 object is created or altered by this runner. P9 7.4 remains a
  -- separate service-role RPC and is intentionally not referenced here.
  if to_regprocedure('public.record_post_technical_visit_followup_response(uuid,uuid,uuid,text,text,text,jsonb,timestamptz)') is null then
    raise exception 'P9 7.4 response authority unexpectedly missing';
  end if;
end;
$$;

select '5.1 responsible assistant bridge manual contract checks passed' as result;
