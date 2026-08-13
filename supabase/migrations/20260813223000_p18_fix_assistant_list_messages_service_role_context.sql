do $preflight$
declare
  v_reader_signature constant text :=
    'public.assistant_list_messages(uuid,uuid,integer)';
  v_reader_oid oid := pg_catalog.to_regprocedure(v_reader_signature);
  v_overload_count integer;
begin
  if v_reader_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.assistant_list_messages(uuid,uuid,integer) is required';
  end if;

  select count(*)
  into v_overload_count
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname = 'assistant_list_messages';

  if v_overload_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'precondition failed: expected exactly 1 public.assistant_list_messages overload, found %s',
        v_overload_count
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_reader_oid
      and proc_row.prosecdef
      and proc_row.proconfig @> array['search_path=pg_catalog, public, pg_temp']::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: assistant_list_messages security definer/search_path contract mismatch';
  end if;

  if not has_function_privilege('authenticated', v_reader_signature, 'EXECUTE')
     or not has_function_privilege('service_role', v_reader_signature, 'EXECUTE')
     or has_function_privilege('anon', v_reader_signature, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: assistant_list_messages execute ACL mismatch before fix';
  end if;
end;
$preflight$;

create or replace function public.assistant_list_messages(
  p_organization_id uuid,
  p_store_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  thread_id uuid,
  sender text,
  sender_role text,
  direction text,
  message_type text,
  content text,
  related_lead_id uuid,
  related_conversation_id uuid,
  related_appointment_id uuid,
  metadata jsonb,
  created_at timestamp with time zone
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_thread_id uuid;
  v_request_role text :=
    coalesce(
      nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
      nullif(auth.jwt() ->> 'role', ''),
      ''
    );
begin
  if p_organization_id is null or p_store_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_organization_id
  ) then
    return;
  end if;

  if v_request_role <> 'service_role' then
    if auth.uid() is null then
      return;
    end if;

    if not exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = p_organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    ) then
      return;
    end if;
  end if;

  select thread_row.id
  into v_thread_id
  from public.store_assistant_threads thread_row
  where thread_row.organization_id = p_organization_id
    and thread_row.store_id = p_store_id
    and thread_row.thread_type = 'primary'
  order by thread_row.updated_at desc nulls last, thread_row.created_at desc nulls last, thread_row.id desc
  limit 1;

  if v_thread_id is null then
    return;
  end if;

  return query
  with recent_messages as (
    select
      message_row.id,
      message_row.thread_id,
      message_row.sender,
      message_row.sender_role,
      message_row.direction,
      message_row.message_type,
      message_row.content,
      message_row.related_lead_id,
      message_row.related_conversation_id,
      message_row.related_appointment_id,
      message_row.metadata,
      message_row.created_at
    from public.store_assistant_messages message_row
    where message_row.organization_id = p_organization_id
      and message_row.store_id = p_store_id
      and message_row.thread_id = v_thread_id
    order by message_row.created_at desc, message_row.id desc
    limit v_limit
  )
  select
    recent_messages.id,
    recent_messages.thread_id,
    recent_messages.sender,
    recent_messages.sender_role,
    recent_messages.direction,
    recent_messages.message_type,
    recent_messages.content,
    recent_messages.related_lead_id,
    recent_messages.related_conversation_id,
    recent_messages.related_appointment_id,
    recent_messages.metadata,
    recent_messages.created_at
  from recent_messages
  order by recent_messages.created_at asc, recent_messages.id asc;
end;
$function$;

revoke all on function public.assistant_list_messages(uuid, uuid, integer) from public;
revoke all on function public.assistant_list_messages(uuid, uuid, integer) from anon;
grant execute on function public.assistant_list_messages(uuid, uuid, integer) to authenticated;
grant execute on function public.assistant_list_messages(uuid, uuid, integer) to service_role;

do $postconditions$
declare
  v_reader_signature constant text :=
    'public.assistant_list_messages(uuid,uuid,integer)';
  v_paginated_signature constant text :=
    'public.assistant_list_messages_paginated(uuid,uuid,integer,timestamp with time zone,uuid,timestamp with time zone,uuid)';
  v_reader_oid oid := pg_catalog.to_regprocedure(v_reader_signature);
  v_normalized_definition text;
  v_overload_count integer;
begin
  if v_reader_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: assistant_list_messages is missing';
  end if;

  select count(*)
  into v_overload_count
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname = 'assistant_list_messages';

  if v_overload_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'postcondition failed: expected exactly 1 public.assistant_list_messages overload, found %s',
        v_overload_count
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_reader_oid
      and proc_row.pronargs = 3
      and proc_row.prorettype = 'record'::pg_catalog.regtype
      and proc_row.prosecdef
      and proc_row.proconfig @> array['search_path=pg_catalog, public, pg_temp']::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: assistant_list_messages signature/security/search_path mismatch';
  end if;

  if not has_function_privilege('authenticated', v_reader_signature, 'EXECUTE')
     or not has_function_privilege('service_role', v_reader_signature, 'EXECUTE')
     or has_function_privilege('anon', v_reader_signature, 'EXECUTE') then
    raise exception using
     errcode = 'P0001',
      message = 'postcondition failed: assistant_list_messages execute ACL mismatch';
  end if;

  if not has_function_privilege('authenticated', v_paginated_signature, 'EXECUTE')
     or has_function_privilege('service_role', v_paginated_signature, 'EXECUTE')
     or has_function_privilege('anon', v_paginated_signature, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: assistant_list_messages_paginated execute ACL mismatch';
  end if;

  select pg_catalog.lower(
           pg_catalog.regexp_replace(
             pg_catalog.pg_get_functiondef(v_reader_oid),
             '\s+',
             ' ',
             'g'
           )
         )
  into v_normalized_definition;

  if position('current_setting(''request.jwt.claim.role'', true)' in v_normalized_definition) = 0
     or position('auth.jwt() ->> ''role''' in v_normalized_definition) = 0
     or position('coalesce(' in v_normalized_definition) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: assistant_list_messages role resolution is not hardened';
  end if;

  if position('auth.uid() is null' in v_normalized_definition) = 0
     or position('membership_row.user_id = auth.uid()' in v_normalized_definition) = 0
     or position('membership_row.is_active is true' in v_normalized_definition) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: assistant_list_messages authenticated gate diverged';
  end if;
end;
$postconditions$;
