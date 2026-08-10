do $migration$
declare
  v_target_table text;
  v_policy record;
  v_function_row record;
  v_public_execute_count integer;
  v_anon_execute_count integer;
  v_authenticated_policy_count integer;
  v_policy_text text;
begin
  foreach v_target_table in array array[
    'store_discount_settings',
    'store_assistant_threads',
    'store_assistant_context_state'
  ] loop
    if pg_catalog.to_regclass(pg_catalog.format('public.%I', v_target_table)) is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('precondition failed: public.%I is required', v_target_table);
    end if;

    if not exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = v_target_table
        and column_row.column_name = 'organization_id'
    ) or not exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = v_target_table
        and column_row.column_name = 'store_id'
    ) then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: public.%I must expose organization_id and store_id',
          v_target_table
        );
    end if;
  end loop;

  if pg_catalog.to_regclass('public.memberships') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.memberships is required';
  end if;

  if pg_catalog.to_regclass('public.stores') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.stores is required';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'memberships'
      and column_row.column_name = 'organization_id'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'memberships'
      and column_row.column_name = 'user_id'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'memberships'
      and column_row.column_name = 'is_active'
      and column_row.udt_name = 'bool'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.memberships canonical active-membership contract mismatch';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'stores'
      and column_row.column_name = 'id'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'stores'
      and column_row.column_name = 'organization_id'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.stores canonical scope contract mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.store_discount_settings'::pg_catalog.regclass
      and constraint_row.contype = 'p'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid, true) = 'PRIMARY KEY (store_id)'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.store_discount_settings primary key must remain store_id';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.store_assistant_threads'::pg_catalog.regclass
      and constraint_row.contype = 'p'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid, true) = 'PRIMARY KEY (id)'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.store_assistant_threads primary key must remain id';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.store_assistant_threads'::pg_catalog.regclass
      and constraint_row.contype = 'u'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid, true) = 'UNIQUE (store_id, thread_type)'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.store_assistant_threads unique(store_id, thread_type) must remain intact';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.store_assistant_threads'::pg_catalog.regclass
      and constraint_row.contype = 'c'
      and position('thread_type' in pg_catalog.pg_get_constraintdef(constraint_row.oid, true)) > 0
      and position('primary' in pg_catalog.pg_get_constraintdef(constraint_row.oid, true)) > 0
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.store_assistant_threads thread_type check mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.store_assistant_threads'::pg_catalog.regclass
      and constraint_row.contype = 'c'
      and position('status' in pg_catalog.pg_get_constraintdef(constraint_row.oid, true)) > 0
      and position('active' in pg_catalog.pg_get_constraintdef(constraint_row.oid, true)) > 0
      and position('archived' in pg_catalog.pg_get_constraintdef(constraint_row.oid, true)) > 0
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.store_assistant_threads status check mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.store_assistant_context_state'::pg_catalog.regclass
      and constraint_row.contype = 'f'
      and position('FOREIGN KEY (thread_id) REFERENCES store_assistant_threads(id) ON DELETE CASCADE' in pg_catalog.pg_get_constraintdef(constraint_row.oid, true)) > 0
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.store_assistant_context_state thread_id foreign key mismatch';
  end if;

  foreach v_target_table in array array[
    'store_discount_settings',
    'store_assistant_threads',
    'store_assistant_context_state'
  ] loop
    execute pg_catalog.format(
      'select count(*) from public.%I where organization_id is null or store_id is null',
      v_target_table
    ) into v_public_execute_count;

    if v_public_execute_count <> 0 then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: public.%I contains rows with null organization_id or store_id',
          v_target_table
        );
    end if;

    execute pg_catalog.format(
      'select count(*) from public.%I target_row left join public.stores store_row on store_row.id = target_row.store_id where store_row.id is null or store_row.organization_id is distinct from target_row.organization_id',
      v_target_table
    ) into v_public_execute_count;

    if v_public_execute_count <> 0 then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: public.%I contains store to organization mismatches',
          v_target_table
        );
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.store_assistant_threads'::pg_catalog.regclass
      and trigger_row.tgname = 'trg_store_assistant_threads_updated_at'
      and trigger_row.tgenabled <> 'D'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: store_assistant_threads updated_at trigger must remain enabled';
  end if;

  for v_function_row in
    select *
    from (
      values
        (
          'assistant_get_thread_summary',
          'p_organization_id uuid, p_store_id uuid',
          'TABLE(thread_id uuid, status text, title text, last_message_at timestamp with time zone, last_message_preview text, total_messages bigint, pending_notifications bigint)'
        ),
        (
          'assistant_list_messages',
          'p_organization_id uuid, p_store_id uuid, p_limit integer',
          'TABLE(id uuid, thread_id uuid, sender text, sender_role text, direction text, message_type text, content text, related_lead_id uuid, related_conversation_id uuid, related_appointment_id uuid, metadata jsonb, created_at timestamp with time zone)'
        ),
        (
          'assistant_list_messages_paginated',
          'p_organization_id uuid, p_store_id uuid, p_limit integer, p_before_created_at timestamp with time zone, p_before_id uuid, p_after_created_at timestamp with time zone, p_after_id uuid',
          'TABLE(id uuid, thread_id uuid, sender text, sender_role text, direction text, message_type text, content text, related_lead_id uuid, related_conversation_id uuid, related_appointment_id uuid, metadata jsonb, created_at timestamp with time zone)'
        ),
        (
          'assistant_mark_notifications_seen',
          'p_organization_id uuid, p_store_id uuid',
          'integer'
        ),
        (
          'assistant_send_human_message',
          'p_organization_id uuid, p_store_id uuid, p_content text',
          'store_assistant_messages'
        )
    ) expected_row(function_name, expected_identity_arguments, expected_return)
  loop
    if (
      select count(*)
      from pg_catalog.pg_proc proc_row
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = proc_row.pronamespace
      where namespace_row.nspname = 'public'
        and proc_row.proname = v_function_row.function_name
    ) <> 1 then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: expected exactly one public.%I function',
          v_function_row.function_name
        );
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_proc proc_row
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = proc_row.pronamespace
      join pg_catalog.pg_roles owner_row
        on owner_row.oid = proc_row.proowner
      where namespace_row.nspname = 'public'
        and proc_row.proname = v_function_row.function_name
        and proc_row.prosecdef is true
        and owner_row.rolname = 'postgres'
        and pg_catalog.pg_get_function_identity_arguments(proc_row.oid) = v_function_row.expected_identity_arguments
        and (
          (v_function_row.expected_return = 'integer' and pg_catalog.format_type(proc_row.prorettype, null) = 'integer')
          or (v_function_row.expected_return = 'store_assistant_messages' and pg_catalog.format_type(proc_row.prorettype, null) = 'store_assistant_messages')
          or (v_function_row.expected_return like 'TABLE(%' and pg_catalog.pg_get_function_result(proc_row.oid) = v_function_row.expected_return)
        )
    ) then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: public.%I signature or return contract mismatch',
          v_function_row.function_name
        );
    end if;
  end loop;

  if (
    select count(*)
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'assistant_get_or_create_primary_thread'
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: expected exactly one public.assistant_get_or_create_primary_thread';
  end if;

  alter table public.store_discount_settings enable row level security;
  alter table public.store_assistant_threads enable row level security;
  alter table public.store_assistant_context_state enable row level security;

  revoke all on table public.store_discount_settings from public;
  revoke all on table public.store_discount_settings from anon;
  revoke all on table public.store_discount_settings from authenticated;
  revoke all on table public.store_discount_settings from service_role;

  revoke all on table public.store_assistant_threads from public;
  revoke all on table public.store_assistant_threads from anon;
  revoke all on table public.store_assistant_threads from authenticated;
  revoke all on table public.store_assistant_threads from service_role;

  revoke all on table public.store_assistant_context_state from public;
  revoke all on table public.store_assistant_context_state from anon;
  revoke all on table public.store_assistant_context_state from authenticated;
  revoke all on table public.store_assistant_context_state from service_role;

  grant select, insert, update on table public.store_discount_settings to authenticated;
  grant select, insert, update on table public.store_discount_settings to service_role;
  grant select, insert, update on table public.store_assistant_threads to service_role;
  grant select, insert, update on table public.store_assistant_context_state to service_role;

  for v_policy in
    select policy_row.tablename, policy_row.policyname
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'public'
      and policy_row.tablename in (
        'store_discount_settings',
        'store_assistant_threads',
        'store_assistant_context_state'
      )
  loop
    execute pg_catalog.format(
      'drop policy if exists %I on public.%I',
      v_policy.policyname,
      v_policy.tablename
    );
  end loop;

  execute $sql$
    create policy store_discount_settings_select_by_active_membership
      on public.store_discount_settings
      for select
      to authenticated
      using (
        auth.uid() is not null
        and exists (
          select 1
          from public.memberships membership_row
          where membership_row.organization_id = store_discount_settings.organization_id
            and membership_row.user_id = auth.uid()
            and membership_row.is_active is true
        )
        and exists (
          select 1
          from public.stores store_row
          where store_row.id = store_discount_settings.store_id
            and store_row.organization_id = store_discount_settings.organization_id
        )
      )
  $sql$;

  execute $sql$
    create policy store_discount_settings_insert_by_active_membership
      on public.store_discount_settings
      for insert
      to authenticated
      with check (
        auth.uid() is not null
        and exists (
          select 1
          from public.memberships membership_row
          where membership_row.organization_id = store_discount_settings.organization_id
            and membership_row.user_id = auth.uid()
            and membership_row.is_active is true
        )
        and exists (
          select 1
          from public.stores store_row
          where store_row.id = store_discount_settings.store_id
            and store_row.organization_id = store_discount_settings.organization_id
        )
      )
  $sql$;

  execute $sql$
    create policy store_discount_settings_update_by_active_membership
      on public.store_discount_settings
      for update
      to authenticated
      using (
        auth.uid() is not null
        and exists (
          select 1
          from public.memberships membership_row
          where membership_row.organization_id = store_discount_settings.organization_id
            and membership_row.user_id = auth.uid()
            and membership_row.is_active is true
        )
        and exists (
          select 1
          from public.stores store_row
          where store_row.id = store_discount_settings.store_id
            and store_row.organization_id = store_discount_settings.organization_id
        )
      )
      with check (
        auth.uid() is not null
        and exists (
          select 1
          from public.memberships membership_row
          where membership_row.organization_id = store_discount_settings.organization_id
            and membership_row.user_id = auth.uid()
            and membership_row.is_active is true
        )
        and exists (
          select 1
          from public.stores store_row
          where store_row.id = store_discount_settings.store_id
            and store_row.organization_id = store_discount_settings.organization_id
        )
      )
  $sql$;

  create or replace function public.assistant_get_thread_summary(
    p_organization_id uuid,
    p_store_id uuid
  )
  returns table (
    thread_id uuid,
    status text,
    title text,
    last_message_at timestamp with time zone,
    last_message_preview text,
    total_messages bigint,
    pending_notifications bigint
  )
  language plpgsql
  security definer
  set search_path = pg_catalog, public, pg_temp
  as $function$
  begin
    if p_organization_id is null or p_store_id is null then
      return;
    end if;

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

    if not exists (
      select 1
      from public.stores store_row
      where store_row.id = p_store_id
        and store_row.organization_id = p_organization_id
    ) then
      return;
    end if;

    return query
    select
      thread_row.id,
      thread_row.status,
      thread_row.title,
      thread_row.last_message_at,
      thread_row.last_message_preview,
      (
        select count(*)
        from public.store_assistant_messages message_row
        where message_row.organization_id = p_organization_id
          and message_row.store_id = p_store_id
          and message_row.thread_id = thread_row.id
      ) as total_messages,
      (
        select count(*)
        from public.store_assistant_notification_queue queue_row
        where queue_row.organization_id = p_organization_id
          and queue_row.store_id = p_store_id
          and queue_row.status = 'pending'
      ) + (
        select count(*)
        from public.store_assistant_operational_tasks task_row
        where task_row.organization_id = p_organization_id
          and task_row.store_id = p_store_id
          and task_row.status = 'waiting_customer_response'
          and (
            coalesce((task_row.task_payload ->> 'needs_responsible_approval')::boolean, false)
            or coalesce((task_row.task_payload ->> 'needs_new_time_negotiation')::boolean, false)
          )
      ) as pending_notifications
    from public.store_assistant_threads thread_row
    where thread_row.organization_id = p_organization_id
      and thread_row.store_id = p_store_id
      and thread_row.thread_type = 'primary'
    order by thread_row.updated_at desc nulls last, thread_row.created_at desc nulls last, thread_row.id desc
    limit 1;
  end;
  $function$;

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
    v_request_role text := coalesce(nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''), '');
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

  create or replace function public.assistant_list_messages_paginated(
    p_organization_id uuid,
    p_store_id uuid,
    p_limit integer default 50,
    p_before_created_at timestamp with time zone default null,
    p_before_id uuid default null,
    p_after_created_at timestamp with time zone default null,
    p_after_id uuid default null
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
  begin
    if p_organization_id is null or p_store_id is null then
      return;
    end if;

    if auth.uid() is null then
      return;
    end if;

    if (p_before_created_at is null) <> (p_before_id is null) then
      raise exception 'assistant_list_messages_paginated requires p_before_created_at and p_before_id together';
    end if;

    if (p_after_created_at is null) <> (p_after_id is null) then
      raise exception 'assistant_list_messages_paginated requires p_after_created_at and p_after_id together';
    end if;

    if p_before_created_at is not null and p_after_created_at is not null then
      raise exception 'assistant_list_messages_paginated does not accept before and after cursors in the same call';
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

    if not exists (
      select 1
      from public.stores store_row
      where store_row.id = p_store_id
        and store_row.organization_id = p_organization_id
    ) then
      return;
    end if;

    select thread_row.id
    into v_thread_id
    from public.store_assistant_threads thread_row
    where thread_row.organization_id = p_organization_id
      and thread_row.store_id = p_store_id
      and thread_row.thread_type = 'primary'
      and thread_row.status = 'active'
    order by thread_row.updated_at desc nulls last, thread_row.created_at desc nulls last, thread_row.id desc
    limit 1;

    if v_thread_id is null then
      return;
    end if;

    if p_before_created_at is not null then
      return query
      with older_messages as (
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
          and (
            message_row.created_at < p_before_created_at
            or (message_row.created_at = p_before_created_at and message_row.id < p_before_id)
          )
        order by message_row.created_at desc, message_row.id desc
        limit v_limit
      )
      select
        older_messages.id,
        older_messages.thread_id,
        older_messages.sender,
        older_messages.sender_role,
        older_messages.direction,
        older_messages.message_type,
        older_messages.content,
        older_messages.related_lead_id,
        older_messages.related_conversation_id,
        older_messages.related_appointment_id,
        older_messages.metadata,
        older_messages.created_at
      from older_messages
      order by older_messages.created_at asc, older_messages.id asc;

      return;
    end if;

    if p_after_created_at is not null then
      return query
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
        and (
          message_row.created_at > p_after_created_at
          or (message_row.created_at = p_after_created_at and message_row.id > p_after_id)
        )
      order by message_row.created_at asc, message_row.id asc
      limit v_limit;

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

  create or replace function public.assistant_mark_notifications_seen(
    p_organization_id uuid,
    p_store_id uuid
  )
  returns integer
  language plpgsql
  security definer
  set search_path = pg_catalog, public, pg_temp
  as $function$
  declare
    v_updated_count integer := 0;
  begin
    if auth.uid() is null then
      raise exception using
        errcode = '42501',
        message = 'insufficient privilege: tenant access denied';
    end if;

    if not exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = p_organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    ) or not exists (
      select 1
      from public.stores store_row
      where store_row.id = p_store_id
        and store_row.organization_id = p_organization_id
    ) then
      raise exception using
        errcode = '42501',
        message = 'insufficient privilege: tenant access denied';
    end if;

    update public.store_assistant_notification_queue queue_row
    set
      status = 'sent',
      processed_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
    where queue_row.organization_id = p_organization_id
      and queue_row.store_id = p_store_id
      and queue_row.status = 'pending'
      and queue_row.available_at <= pg_catalog.now();

    get diagnostics v_updated_count = row_count;
    return v_updated_count;
  end;
  $function$;

  create or replace function public.assistant_send_human_message(
    p_organization_id uuid,
    p_store_id uuid,
    p_content text
  )
  returns public.store_assistant_messages
  language plpgsql
  security definer
  set search_path = pg_catalog, public, pg_temp
  as $function$
  declare
    v_trimmed_content text := pg_catalog.btrim(coalesce(p_content, ''));
    v_function_row record;
    v_arg_row record;
    v_arguments text[] := array[]::text[];
    v_argument_sql text;
    v_thread_sql text;
    v_thread_json jsonb;
    v_thread_id uuid;
    v_thread_organization_id uuid;
    v_thread_store_id uuid;
    v_thread_row public.store_assistant_threads%rowtype;
    v_message public.store_assistant_messages%rowtype;
  begin
    if auth.uid() is null then
      raise exception using
        errcode = '42501',
        message = 'insufficient privilege: tenant access denied';
    end if;

    if not exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = p_organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    ) or not exists (
      select 1
      from public.stores store_row
      where store_row.id = p_store_id
        and store_row.organization_id = p_organization_id
    ) then
      raise exception using
        errcode = '42501',
        message = 'insufficient privilege: tenant access denied';
    end if;

    if v_trimmed_content = '' then
      raise exception using
        errcode = 'P0001',
        message = 'MENSAGEM_VAZIA';
    end if;

    select
      proc_row.oid,
      proc_row.pronargs,
      proc_row.proargnames,
      string_to_array(pg_catalog.oidvectortypes(proc_row.proargtypes), ', ') as arg_types
    into v_function_row
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'assistant_get_or_create_primary_thread';

    if v_function_row.oid is null then
      raise exception using
        errcode = 'P0001',
        message = 'assistant_get_or_create_primary_thread not found';
    end if;

    if v_function_row.pronargs < 1
       or v_function_row.proargnames is null
       or array_length(v_function_row.proargnames, 1) is distinct from v_function_row.pronargs
       or array_length(v_function_row.arg_types, 1) is distinct from v_function_row.pronargs then
      raise exception using
        errcode = 'P0001',
        message = 'assistant_get_or_create_primary_thread signature metadata is unavailable';
    end if;

    for v_arg_row in
      select
        v_function_row.proargnames[arg_index] as arg_name,
        v_function_row.arg_types[arg_index] as arg_type
      from generate_series(1, v_function_row.pronargs) arg_index
    loop
      if v_arg_row.arg_name is null or v_arg_row.arg_name = '' then
        raise exception using
          errcode = 'P0001',
          message = 'assistant_get_or_create_primary_thread contains unnamed parameters';
      end if;

      if v_arg_row.arg_type = 'uuid' then
        if v_arg_row.arg_name like '%organization%' then
          v_argument_sql := pg_catalog.format('%I => %L::uuid', v_arg_row.arg_name, p_organization_id);
        elsif v_arg_row.arg_name like '%store%' then
          v_argument_sql := pg_catalog.format('%I => %L::uuid', v_arg_row.arg_name, p_store_id);
        else
          v_argument_sql := pg_catalog.format('%I => null::uuid', v_arg_row.arg_name);
        end if;
      elsif v_arg_row.arg_type = 'jsonb' then
        v_argument_sql := pg_catalog.format('%I => ''{}''::jsonb', v_arg_row.arg_name);
      elsif v_arg_row.arg_type = 'json' then
        v_argument_sql := pg_catalog.format('%I => ''{}''::json', v_arg_row.arg_name);
      elsif v_arg_row.arg_type in ('text', 'character varying') then
        v_argument_sql := pg_catalog.format('%I => %L', v_arg_row.arg_name, 'assistant_send_human_message');
      elsif v_arg_row.arg_type = 'boolean' then
        v_argument_sql := pg_catalog.format('%I => false', v_arg_row.arg_name);
      elsif v_arg_row.arg_type = 'integer' then
        v_argument_sql := pg_catalog.format('%I => 0', v_arg_row.arg_name);
      elsif v_arg_row.arg_type = 'bigint' then
        v_argument_sql := pg_catalog.format('%I => 0::bigint', v_arg_row.arg_name);
      elsif v_arg_row.arg_type = 'timestamp with time zone' then
        v_argument_sql := pg_catalog.format('%I => pg_catalog.now()', v_arg_row.arg_name);
      else
        raise exception using
          errcode = 'P0001',
          message = pg_catalog.format(
            'assistant_get_or_create_primary_thread has unsupported parameter type %s for %s',
            v_arg_row.arg_type,
            v_arg_row.arg_name
          );
      end if;

      v_arguments := array_append(v_arguments, v_argument_sql);
    end loop;

    v_thread_sql := 'select pg_catalog.to_jsonb(thread_row) from public.assistant_get_or_create_primary_thread('
      || array_to_string(v_arguments, ', ')
      || ') as thread_row';

    execute v_thread_sql into v_thread_json;

    if v_thread_json is null then
      raise exception using
        errcode = '42501',
        message = 'assistant thread resolution failed';
    end if;

    if pg_catalog.jsonb_typeof(v_thread_json) = 'object' then
      v_thread_id := nullif(v_thread_json ->> 'id', '')::uuid;
      v_thread_organization_id := nullif(v_thread_json ->> 'organization_id', '')::uuid;
      v_thread_store_id := nullif(v_thread_json ->> 'store_id', '')::uuid;
    elsif pg_catalog.jsonb_typeof(v_thread_json) = 'string' then
      v_thread_id := trim(both '"' from v_thread_json::text)::uuid;
    end if;

    if v_thread_id is null then
      raise exception using
        errcode = '42501',
        message = 'assistant thread resolution failed';
    end if;

    if v_thread_organization_id is null or v_thread_store_id is null then
      select *
      into v_thread_row
      from public.store_assistant_threads thread_row
      where thread_row.id = v_thread_id;

      v_thread_organization_id := v_thread_row.organization_id;
      v_thread_store_id := v_thread_row.store_id;
    end if;

    if v_thread_organization_id is distinct from p_organization_id
       or v_thread_store_id is distinct from p_store_id then
      raise exception using
        errcode = '42501',
        message = 'assistant thread tenant mismatch';
    end if;

    insert into public.store_assistant_messages (
      organization_id,
      store_id,
      thread_id,
      sender,
      sender_role,
      direction,
      message_type,
      content
    )
    values (
      p_organization_id,
      p_store_id,
      v_thread_id,
      'human',
      'store_responsible',
      'incoming',
      'text',
      v_trimmed_content
    )
    returning *
    into v_message;

    update public.store_assistant_threads thread_row
    set
      last_message_at = coalesce(v_message.created_at, pg_catalog.clock_timestamp()),
      last_message_preview = v_trimmed_content,
      updated_at = pg_catalog.clock_timestamp()
    where thread_row.id = v_thread_id
      and thread_row.organization_id = p_organization_id
      and thread_row.store_id = p_store_id;

    return v_message;
  end;
  $function$;

  for v_function_row in
    select
      proc_row.proname as function_name,
      pg_catalog.pg_get_function_identity_arguments(proc_row.oid) as identity_arguments
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname in (
        'assistant_get_thread_summary',
        'assistant_list_messages',
        'assistant_list_messages_paginated',
        'assistant_mark_notifications_seen',
        'assistant_send_human_message'
      )
  loop
    execute pg_catalog.format(
      'revoke execute on function public.%I(%s) from public',
      v_function_row.function_name,
      v_function_row.identity_arguments
    );
    execute pg_catalog.format(
      'revoke execute on function public.%I(%s) from anon',
      v_function_row.function_name,
      v_function_row.identity_arguments
    );
    execute pg_catalog.format(
      'revoke execute on function public.%I(%s) from authenticated',
      v_function_row.function_name,
      v_function_row.identity_arguments
    );
    execute pg_catalog.format(
      'revoke execute on function public.%I(%s) from service_role',
      v_function_row.function_name,
      v_function_row.identity_arguments
    );
  end loop;

  grant execute on function public.assistant_get_thread_summary(uuid, uuid) to authenticated;
  grant execute on function public.assistant_list_messages(uuid, uuid, integer) to authenticated;
  grant execute on function public.assistant_list_messages(uuid, uuid, integer) to service_role;
  grant execute on function public.assistant_list_messages_paginated(uuid, uuid, integer, timestamp with time zone, uuid, timestamp with time zone, uuid) to authenticated;
  grant execute on function public.assistant_mark_notifications_seen(uuid, uuid) to authenticated;
  grant execute on function public.assistant_send_human_message(uuid, uuid, text) to authenticated;

  if exists (
    select 1
    from pg_catalog.pg_class class_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname in (
        'store_discount_settings',
        'store_assistant_threads',
        'store_assistant_context_state'
      )
      and class_row.relforcerowsecurity
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: force row level security must remain off on the three P18 remaining tables';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class class_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname in (
        'store_discount_settings',
        'store_assistant_threads',
        'store_assistant_context_state'
      )
      and not class_row.relrowsecurity
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: row level security must be enabled on the three P18 remaining tables';
  end if;

  if not (
    has_table_privilege('authenticated', 'public.store_discount_settings', 'SELECT')
    and has_table_privilege('authenticated', 'public.store_discount_settings', 'INSERT')
    and has_table_privilege('authenticated', 'public.store_discount_settings', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.store_discount_settings', 'DELETE')
    and not has_table_privilege('authenticated', 'public.store_discount_settings', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.store_discount_settings', 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.store_discount_settings', 'TRIGGER')
    and not has_table_privilege('authenticated', 'public.store_assistant_threads', 'SELECT')
    and not has_table_privilege('authenticated', 'public.store_assistant_threads', 'INSERT')
    and not has_table_privilege('authenticated', 'public.store_assistant_threads', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.store_assistant_threads', 'DELETE')
    and not has_table_privilege('authenticated', 'public.store_assistant_context_state', 'SELECT')
    and not has_table_privilege('authenticated', 'public.store_assistant_context_state', 'INSERT')
    and not has_table_privilege('authenticated', 'public.store_assistant_context_state', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.store_assistant_context_state', 'DELETE')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: authenticated direct grants diverged from the remaining P18 contract';
  end if;

  if not (
    has_table_privilege('service_role', 'public.store_discount_settings', 'SELECT')
    and has_table_privilege('service_role', 'public.store_discount_settings', 'INSERT')
    and has_table_privilege('service_role', 'public.store_discount_settings', 'UPDATE')
    and not has_table_privilege('service_role', 'public.store_discount_settings', 'DELETE')
    and has_table_privilege('service_role', 'public.store_assistant_threads', 'SELECT')
    and has_table_privilege('service_role', 'public.store_assistant_threads', 'INSERT')
    and has_table_privilege('service_role', 'public.store_assistant_threads', 'UPDATE')
    and not has_table_privilege('service_role', 'public.store_assistant_threads', 'DELETE')
    and has_table_privilege('service_role', 'public.store_assistant_context_state', 'SELECT')
    and has_table_privilege('service_role', 'public.store_assistant_context_state', 'INSERT')
    and has_table_privilege('service_role', 'public.store_assistant_context_state', 'UPDATE')
    and not has_table_privilege('service_role', 'public.store_assistant_context_state', 'DELETE')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: service_role table grants diverged from the remaining P18 contract';
  end if;

  select count(*)
  into v_authenticated_policy_count
  from pg_catalog.pg_policies policy_row
  where policy_row.schemaname = 'public'
    and policy_row.tablename = 'store_discount_settings'
    and policy_row.roles = array['authenticated']::name[];

  if v_authenticated_policy_count <> 3 then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'postcondition failed: expected 3 authenticated policies on store_discount_settings, found %s',
        v_authenticated_policy_count
      );
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'public'
      and policy_row.tablename in ('store_assistant_threads', 'store_assistant_context_state')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: store_assistant_threads and store_assistant_context_state must end with zero client policies';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'public'
      and policy_row.tablename = 'store_discount_settings'
      and (
        lower(coalesce(policy_row.qual, '')) = 'true'
        or lower(coalesce(policy_row.with_check, '')) = 'true'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: policy USING true or WITH CHECK true is forbidden';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'public'
      and policy_row.tablename = 'store_discount_settings'
      and (
        coalesce(policy_row.qual, '') ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
        or coalesce(policy_row.with_check, '') ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: discount policies contain hardcoded UUIDs';
  end if;

  select count(*)
  into v_public_execute_count
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      proc_row.proacl,
      pg_catalog.acldefault('f', proc_row.proowner)
    )
  ) acl_row
  where namespace_row.nspname = 'public'
    and proc_row.proname in (
      'assistant_get_thread_summary',
      'assistant_list_messages',
      'assistant_list_messages_paginated',
      'assistant_mark_notifications_seen',
      'assistant_send_human_message'
    )
    and acl_row.grantee = 0
    and acl_row.privilege_type = 'EXECUTE';

  if v_public_execute_count <> 0 then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'postcondition failed: found %s audited assistant functions still executable by PUBLIC',
        v_public_execute_count
      );
  end if;

  select count(*)
  into v_anon_execute_count
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname in (
      'assistant_get_thread_summary',
      'assistant_list_messages',
      'assistant_list_messages_paginated',
      'assistant_mark_notifications_seen',
      'assistant_send_human_message'
    )
    and has_function_privilege('anon', proc_row.oid, 'EXECUTE');

  if v_anon_execute_count <> 0 then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'postcondition failed: found %s audited assistant functions still executable by anon',
        v_anon_execute_count
      );
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname in (
        'assistant_get_thread_summary',
        'assistant_list_messages',
        'assistant_list_messages_paginated',
        'assistant_mark_notifications_seen',
        'assistant_send_human_message'
      )
      and has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
  ) <> 5 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: authenticated must execute exactly the five browser assistant RPCs';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname in (
        'assistant_get_thread_summary',
        'assistant_list_messages',
        'assistant_list_messages_paginated',
        'assistant_mark_notifications_seen',
        'assistant_send_human_message'
      )
      and has_function_privilege('service_role', proc_row.oid, 'EXECUTE')
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: service_role must execute only assistant_list_messages among the five audited RPCs';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    join pg_catalog.pg_roles owner_row
      on owner_row.oid = proc_row.proowner
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'assistant_get_thread_summary'
      and proc_row.prosecdef is true
      and owner_row.rolname = 'postgres'
      and pg_catalog.pg_get_function_result(proc_row.oid) = 'TABLE(thread_id uuid, status text, title text, last_message_at timestamp with time zone, last_message_preview text, total_messages bigint, pending_notifications bigint)'
      and exists (
        select 1
        from pg_catalog.unnest(coalesce(proc_row.proconfig, array[]::text[])) config_entry
        where config_entry = 'search_path=pg_catalog, public, pg_temp'
      )
      and position('membership_row.is_active is true' in pg_catalog.pg_get_functiondef(proc_row.oid)) > 0
      and position('store_row.id = p_store_id' in pg_catalog.pg_get_functiondef(proc_row.oid)) > 0
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: assistant_get_thread_summary contract diverged from the expected hardening';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    join pg_catalog.pg_roles owner_row
      on owner_row.oid = proc_row.proowner
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'assistant_list_messages'
      and proc_row.prosecdef is true
      and owner_row.rolname = 'postgres'
      and pg_catalog.pg_get_function_result(proc_row.oid) = 'TABLE(id uuid, thread_id uuid, sender text, sender_role text, direction text, message_type text, content text, related_lead_id uuid, related_conversation_id uuid, related_appointment_id uuid, metadata jsonb, created_at timestamp with time zone)'
      and exists (
        select 1
        from pg_catalog.unnest(coalesce(proc_row.proconfig, array[]::text[])) config_entry
        where config_entry = 'search_path=pg_catalog, public, pg_temp'
      )
      and position('current_setting(''request.jwt.claim.role''' in pg_catalog.pg_get_functiondef(proc_row.oid)) > 0
      and position('membership_row.is_active is true' in pg_catalog.pg_get_functiondef(proc_row.oid)) > 0
      and position('thread_row.organization_id = p_organization_id' in pg_catalog.pg_get_functiondef(proc_row.oid)) > 0
      and has_function_privilege('service_role', proc_row.oid, 'EXECUTE')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: assistant_list_messages contract diverged from the expected hardening';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    join pg_catalog.pg_roles owner_row
      on owner_row.oid = proc_row.proowner
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'assistant_list_messages_paginated'
      and proc_row.prosecdef is true
      and owner_row.rolname = 'postgres'
      and pg_catalog.pg_get_function_result(proc_row.oid) = 'TABLE(id uuid, thread_id uuid, sender text, sender_role text, direction text, message_type text, content text, related_lead_id uuid, related_conversation_id uuid, related_appointment_id uuid, metadata jsonb, created_at timestamp with time zone)'
      and exists (
        select 1
        from pg_catalog.unnest(coalesce(proc_row.proconfig, array[]::text[])) config_entry
        where config_entry = 'search_path=pg_catalog, public, pg_temp'
      )
      and position('membership_row.is_active is true' in pg_catalog.pg_get_functiondef(proc_row.oid)) > 0
      and position('requires p_before_created_at and p_before_id together' in pg_catalog.pg_get_functiondef(proc_row.oid)) > 0
      and not has_function_privilege('service_role', proc_row.oid, 'EXECUTE')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: assistant_list_messages_paginated contract diverged from the expected hardening';
  end if;

  select pg_catalog.pg_get_functiondef(proc_row.oid)
  into v_policy_text
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname = 'assistant_mark_notifications_seen';

  if v_policy_text is null
     or position('membership_row.is_active is true' in v_policy_text) = 0
     or position('store_row.id = p_store_id' in v_policy_text) = 0
     or position('auth.uid() is null' in v_policy_text) = 0
     or position('update public.store_assistant_notification_queue' in v_policy_text) = 0
     or position('auth.uid() is null' in v_policy_text) > position('update public.store_assistant_notification_queue' in v_policy_text) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: assistant_mark_notifications_seen must guard authorization before the update';
  end if;

  select pg_catalog.pg_get_functiondef(proc_row.oid)
  into v_policy_text
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname = 'assistant_send_human_message';

  if v_policy_text is null
     or position('MENSAGEM_VAZIA' in v_policy_text) = 0
     or position('membership_row.is_active is true' in v_policy_text) = 0
     or position('store_row.id = p_store_id' in v_policy_text) = 0
     or position('assistant thread tenant mismatch' in v_policy_text) = 0
     or position('insert into public.store_assistant_messages' in v_policy_text) = 0
     or position('auth.uid() is null' in v_policy_text) = 0
     or position('auth.uid() is null' in v_policy_text) > position('insert into public.store_assistant_messages' in v_policy_text) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: assistant_send_human_message must guard authorization before the first write and re-check thread scope';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'public'
      and policy_row.tablename in ('store_appointments', 'store_assistant_messages', 'store_assistant_notification_queue', 'store_assistant_operational_tasks', 'store_responsibles', 'store_schedule_blocks', 'store_schedule_settings')
      and (
        lower(coalesce(policy_row.qual, '')) = 'true'
        or lower(coalesce(policy_row.with_check, '')) = 'true'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: previously hardened P18 surfaces still must not expose USING true or WITH CHECK true policies';
  end if;
end;
$migration$;
