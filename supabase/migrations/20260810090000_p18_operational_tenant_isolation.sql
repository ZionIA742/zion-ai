do $migration$
declare
  v_target_tables constant text[] := array[
    'store_appointments',
    'store_assistant_messages',
    'store_assistant_notification_queue',
    'store_assistant_operational_tasks',
    'store_responsibles',
    'store_schedule_blocks',
    'store_schedule_settings'
  ];
  v_function_names constant text[] := array[
    'create_store_appointment',
    'update_store_appointment',
    'cancel_store_appointment',
    'update_store_schedule_block',
    'delete_store_schedule_block',
    'upsert_store_schedule_settings',
    'has_store_active_appointment_in_range',
    'has_store_appointment_conflict',
    'has_store_schedule_block_conflict',
    'is_store_appointment_within_operating_window',
    'get_store_schedule_settings_effective',
    'complete_store_appointment_with_outcome',
    'create_store_schedule_block_allow_existing_appointments',
    'get_latest_conversation_for_lead',
    'log_schedule_conversation_event',
    'assistant_enqueue_internal_notification',
    'assistant_get_or_create_primary_thread'
  ];
  v_table_name text;
  v_policy record;
  v_function_row record;
  v_function_definition text;
  v_guard_sql text;
  v_policy_count integer;
  v_public_execute_count integer;
  v_anon_execute_count integer;
begin
  foreach v_table_name in array v_target_tables loop
    if pg_catalog.to_regclass(pg_catalog.format('public.%I', v_table_name)) is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('precondition failed: public.%I is required', v_table_name);
    end if;

    if not exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = v_table_name
        and column_row.column_name = 'organization_id'
    ) or not exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = v_table_name
        and column_row.column_name = 'store_id'
    ) then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: public.%I must expose organization_id and store_id',
          v_table_name
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
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'public'
      and policy_row.tablename = 'memberships'
      and policy_row.policyname = 'memberships_select_own'
      and policy_row.cmd = 'SELECT'
      and policy_row.roles = array['authenticated']::name[]
      and position('user_id = auth.uid()' in lower(coalesce(policy_row.qual, ''))) > 0
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.memberships memberships_select_own policy contract mismatch';
  end if;

  if not has_table_privilege('authenticated', 'public.memberships', 'SELECT') then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: authenticated lacks SELECT on public.memberships';
  end if;

  if not has_table_privilege('authenticated', 'public.stores', 'SELECT') then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: authenticated lacks SELECT on public.stores';
  end if;

  for v_function_row in
    with expected_functions as (
      select *
      from (
        values
          ('create_store_appointment', false, null::text, null::text, false),
          ('update_store_appointment', false, null::text, null::text, false),
          ('cancel_store_appointment', false, null::text, null::text, false),
          ('update_store_schedule_block', false, null::text, null::text, false),
          ('delete_store_schedule_block', false, null::text, null::text, false),
          ('upsert_store_schedule_settings', false, null::text, null::text, false),
          ('has_store_active_appointment_in_range', false, null::text, null::text, false),
          ('has_store_appointment_conflict', false, null::text, null::text, false),
          ('has_store_schedule_block_conflict', false, null::text, null::text, false),
          ('is_store_appointment_within_operating_window', false, null::text, null::text, false),
          ('get_store_schedule_settings_effective', false, null::text, null::text, false),
          ('complete_store_appointment_with_outcome', true, 'p_appointment_id uuid, p_organization_id uuid, p_store_id uuid, p_completion_outcome text, p_completion_note text', 'plpgsql', true),
          ('create_store_schedule_block_allow_existing_appointments', true, 'p_organization_id uuid, p_store_id uuid, p_title text, p_block_type text, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_notes text, p_source text, p_created_by_user_id uuid', 'plpgsql', true),
          ('get_latest_conversation_for_lead', true, 'p_organization_id uuid, p_lead_id uuid', 'sql', false),
          ('log_schedule_conversation_event', true, 'p_organization_id uuid, p_conversation_id uuid, p_event_type text, p_created_by text, p_payload jsonb', 'plpgsql', true),
          ('assistant_enqueue_internal_notification', true, null::text, null::text, false),
          ('assistant_get_or_create_primary_thread', true, null::text, null::text, false)
      ) as expected_row(
        function_name,
        must_be_security_definer,
        expected_identity_arguments,
        expected_language,
        uses_generic_plpgsql_hardening
      )
    )
    select
      expected_row.*,
      proc_row.oid,
      proc_row.prosecdef,
      proc_row.provolatile,
      pg_catalog.pg_get_function_identity_arguments(proc_row.oid) as actual_identity_arguments,
      language_row.lanname as actual_language,
      owner_row.rolname as owner_name,
      pg_catalog.format_type(proc_row.prorettype, null) as return_type,
      pg_catalog.pg_get_functiondef(proc_row.oid) as function_definition
    from expected_functions expected_row
    left join lateral (
      select proc_inner.*
      from pg_catalog.pg_proc proc_inner
      join pg_catalog.pg_namespace namespace_inner
        on namespace_inner.oid = proc_inner.pronamespace
      where namespace_inner.nspname = 'public'
        and proc_inner.proname = expected_row.function_name
    ) proc_row on true
    left join pg_catalog.pg_language language_row
      on language_row.oid = proc_row.prolang
    left join pg_catalog.pg_roles owner_row
      on owner_row.oid = proc_row.proowner
  loop
    if v_function_row.oid is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('precondition failed: public.%I must exist', v_function_row.function_name);
    end if;

    if (
      select count(*)
      from pg_catalog.pg_proc proc_count_row
      join pg_catalog.pg_namespace namespace_count_row
        on namespace_count_row.oid = proc_count_row.pronamespace
      where namespace_count_row.nspname = 'public'
        and proc_count_row.proname = v_function_row.function_name
    ) <> 1 then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: public.%I must be unique in schema public',
          v_function_row.function_name
        );
    end if;

    if v_function_row.must_be_security_definer and v_function_row.prosecdef is not true then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: public.%I must already be SECURITY DEFINER',
          v_function_row.function_name
        );
    end if;

    if not v_function_row.must_be_security_definer and v_function_row.prosecdef is not false then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: public.%I must remain SECURITY INVOKER',
          v_function_row.function_name
        );
    end if;

    if v_function_row.expected_identity_arguments is not null
       and v_function_row.actual_identity_arguments <> v_function_row.expected_identity_arguments then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: public.%I identity arguments mismatch expected=%s actual=%s',
          v_function_row.function_name,
          v_function_row.expected_identity_arguments,
          coalesce(v_function_row.actual_identity_arguments, '<null>')
        );
    end if;

    if v_function_row.expected_language is not null
       and v_function_row.actual_language <> v_function_row.expected_language then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: public.%I language mismatch expected=%s actual=%s',
          v_function_row.function_name,
          v_function_row.expected_language,
          coalesce(v_function_row.actual_language, '<null>')
        );
    end if;

    if v_function_row.uses_generic_plpgsql_hardening
       and position('begin' in lower(v_function_row.function_definition)) = 0 then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: public.%I must expose a plpgsql BEGIN block for guarded rewrite',
          v_function_row.function_name
        );
    end if;

    if v_function_row.function_name = 'get_latest_conversation_for_lead' then
      if v_function_row.owner_name <> 'postgres' then
        raise exception using
          errcode = 'P0001',
          message = 'precondition failed: public.get_latest_conversation_for_lead owner must be postgres';
      end if;

      if v_function_row.provolatile <> 's' then
        raise exception using
          errcode = 'P0001',
          message = 'precondition failed: public.get_latest_conversation_for_lead must start as STABLE';
      end if;

      if v_function_row.return_type <> 'uuid' then
        raise exception using
          errcode = 'P0001',
          message = 'precondition failed: public.get_latest_conversation_for_lead must return uuid';
      end if;
    end if;
  end loop;

  foreach v_table_name in array v_target_tables loop
    execute pg_catalog.format('alter table public.%I enable row level security', v_table_name);
    execute pg_catalog.format('revoke all on table public.%I from public', v_table_name);
    execute pg_catalog.format('revoke all on table public.%I from anon', v_table_name);
    execute pg_catalog.format('revoke all on table public.%I from authenticated', v_table_name);
    execute pg_catalog.format('revoke all on table public.%I from service_role', v_table_name);
    execute pg_catalog.format('grant all on table public.%I to service_role', v_table_name);
  end loop;

  grant select, insert, update on table public.store_appointments to authenticated;
  grant select, update, delete on table public.store_schedule_blocks to authenticated;
  grant select, insert, update on table public.store_schedule_settings to authenticated;
  grant select on table public.store_assistant_operational_tasks to authenticated;

  for v_policy in
    select policy_row.tablename, policy_row.policyname
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'public'
      and policy_row.tablename = any(v_target_tables)
  loop
    execute pg_catalog.format(
      'drop policy if exists %I on public.%I',
      v_policy.policyname,
      v_policy.tablename
    );
  end loop;

  execute $sql$
    create policy store_appointments_select_by_active_membership
      on public.store_appointments
      for select
      to authenticated
      using (
        auth.uid() is not null
        and exists (
          select 1
          from public.memberships membership_row
          where membership_row.organization_id = store_appointments.organization_id
            and membership_row.user_id = auth.uid()
            and membership_row.is_active is true
        )
        and exists (
          select 1
          from public.stores store_row
          where store_row.id = store_appointments.store_id
            and store_row.organization_id = store_appointments.organization_id
        )
      )
  $sql$;

  execute $sql$
    create policy store_appointments_insert_by_active_membership
      on public.store_appointments
      for insert
      to authenticated
      with check (
        auth.uid() is not null
        and exists (
          select 1
          from public.memberships membership_row
          where membership_row.organization_id = store_appointments.organization_id
            and membership_row.user_id = auth.uid()
            and membership_row.is_active is true
        )
        and exists (
          select 1
          from public.stores store_row
          where store_row.id = store_appointments.store_id
            and store_row.organization_id = store_appointments.organization_id
        )
      )
  $sql$;

  execute $sql$
    create policy store_appointments_update_by_active_membership
      on public.store_appointments
      for update
      to authenticated
      using (
        auth.uid() is not null
        and exists (
          select 1
          from public.memberships membership_row
          where membership_row.organization_id = store_appointments.organization_id
            and membership_row.user_id = auth.uid()
            and membership_row.is_active is true
        )
        and exists (
          select 1
          from public.stores store_row
          where store_row.id = store_appointments.store_id
            and store_row.organization_id = store_appointments.organization_id
        )
      )
      with check (
        auth.uid() is not null
        and exists (
          select 1
          from public.memberships membership_row
          where membership_row.organization_id = store_appointments.organization_id
            and membership_row.user_id = auth.uid()
            and membership_row.is_active is true
        )
        and exists (
          select 1
          from public.stores store_row
          where store_row.id = store_appointments.store_id
            and store_row.organization_id = store_appointments.organization_id
        )
      )
  $sql$;

  execute $sql$
    create policy store_schedule_blocks_select_by_active_membership
      on public.store_schedule_blocks
      for select
      to authenticated
      using (
        auth.uid() is not null
        and exists (
          select 1
          from public.memberships membership_row
          where membership_row.organization_id = store_schedule_blocks.organization_id
            and membership_row.user_id = auth.uid()
            and membership_row.is_active is true
        )
        and exists (
          select 1
          from public.stores store_row
          where store_row.id = store_schedule_blocks.store_id
            and store_row.organization_id = store_schedule_blocks.organization_id
        )
      )
  $sql$;

  execute $sql$
    create policy store_schedule_blocks_update_by_active_membership
      on public.store_schedule_blocks
      for update
      to authenticated
      using (
        auth.uid() is not null
        and exists (
          select 1
          from public.memberships membership_row
          where membership_row.organization_id = store_schedule_blocks.organization_id
            and membership_row.user_id = auth.uid()
            and membership_row.is_active is true
        )
        and exists (
          select 1
          from public.stores store_row
          where store_row.id = store_schedule_blocks.store_id
            and store_row.organization_id = store_schedule_blocks.organization_id
        )
      )
      with check (
        auth.uid() is not null
        and exists (
          select 1
          from public.memberships membership_row
          where membership_row.organization_id = store_schedule_blocks.organization_id
            and membership_row.user_id = auth.uid()
            and membership_row.is_active is true
        )
        and exists (
          select 1
          from public.stores store_row
          where store_row.id = store_schedule_blocks.store_id
            and store_row.organization_id = store_schedule_blocks.organization_id
        )
      )
  $sql$;

  execute $sql$
    create policy store_schedule_blocks_delete_by_active_membership
      on public.store_schedule_blocks
      for delete
      to authenticated
      using (
        auth.uid() is not null
        and exists (
          select 1
          from public.memberships membership_row
          where membership_row.organization_id = store_schedule_blocks.organization_id
            and membership_row.user_id = auth.uid()
            and membership_row.is_active is true
        )
        and exists (
          select 1
          from public.stores store_row
          where store_row.id = store_schedule_blocks.store_id
            and store_row.organization_id = store_schedule_blocks.organization_id
        )
      )
  $sql$;

  execute $sql$
    create policy store_schedule_settings_select_by_active_membership
      on public.store_schedule_settings
      for select
      to authenticated
      using (
        auth.uid() is not null
        and exists (
          select 1
          from public.memberships membership_row
          where membership_row.organization_id = store_schedule_settings.organization_id
            and membership_row.user_id = auth.uid()
            and membership_row.is_active is true
        )
        and exists (
          select 1
          from public.stores store_row
          where store_row.id = store_schedule_settings.store_id
            and store_row.organization_id = store_schedule_settings.organization_id
        )
      )
  $sql$;

  execute $sql$
    create policy store_schedule_settings_insert_by_active_membership
      on public.store_schedule_settings
      for insert
      to authenticated
      with check (
        auth.uid() is not null
        and exists (
          select 1
          from public.memberships membership_row
          where membership_row.organization_id = store_schedule_settings.organization_id
            and membership_row.user_id = auth.uid()
            and membership_row.is_active is true
        )
        and exists (
          select 1
          from public.stores store_row
          where store_row.id = store_schedule_settings.store_id
            and store_row.organization_id = store_schedule_settings.organization_id
        )
      )
  $sql$;

  execute $sql$
    create policy store_schedule_settings_update_by_active_membership
      on public.store_schedule_settings
      for update
      to authenticated
      using (
        auth.uid() is not null
        and exists (
          select 1
          from public.memberships membership_row
          where membership_row.organization_id = store_schedule_settings.organization_id
            and membership_row.user_id = auth.uid()
            and membership_row.is_active is true
        )
        and exists (
          select 1
          from public.stores store_row
          where store_row.id = store_schedule_settings.store_id
            and store_row.organization_id = store_schedule_settings.organization_id
        )
      )
      with check (
        auth.uid() is not null
        and exists (
          select 1
          from public.memberships membership_row
          where membership_row.organization_id = store_schedule_settings.organization_id
            and membership_row.user_id = auth.uid()
            and membership_row.is_active is true
        )
        and exists (
          select 1
          from public.stores store_row
          where store_row.id = store_schedule_settings.store_id
            and store_row.organization_id = store_schedule_settings.organization_id
        )
      )
  $sql$;

  execute $sql$
    create policy store_assistant_operational_tasks_select_by_active_membership
      on public.store_assistant_operational_tasks
      for select
      to authenticated
      using (
        auth.uid() is not null
        and exists (
          select 1
          from public.memberships membership_row
          where membership_row.organization_id = store_assistant_operational_tasks.organization_id
            and membership_row.user_id = auth.uid()
            and membership_row.is_active is true
        )
        and exists (
          select 1
          from public.stores store_row
          where store_row.id = store_assistant_operational_tasks.store_id
            and store_row.organization_id = store_assistant_operational_tasks.organization_id
        )
      )
  $sql$;

  for v_function_row in
    select
      proc_row.proname as function_name,
      pg_catalog.pg_get_function_identity_arguments(proc_row.oid) as identity_arguments
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname = any(v_function_names)
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

  create or replace function public.get_latest_conversation_for_lead(
    p_organization_id uuid,
    p_lead_id uuid
  )
  returns uuid
  language plpgsql
  stable
  security definer
  set search_path = pg_catalog, public, pg_temp
  as $function$
  declare
    v_conversation_id uuid;
  begin
    -- p18 tenant authorization guard
    if coalesce(nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''), '') <> 'service_role' then
      if auth.uid() is null
         or not exists (
           select 1
           from public.memberships membership_row
           where membership_row.organization_id = p_organization_id
             and membership_row.user_id = auth.uid()
             and membership_row.is_active is true
         ) then
        raise exception using
          errcode = '42501',
          message = 'insufficient privilege: tenant access denied';
      end if;
    end if;

    select conversation_row.id
    into v_conversation_id
    from public.conversations conversation_row
    where conversation_row.organization_id = p_organization_id
      and conversation_row.lead_id = p_lead_id
    order by conversation_row.last_message_at desc nulls last, conversation_row.created_at desc
    limit 1;

    return v_conversation_id;
  end;
  $function$;

  for v_function_row in
    select
      proc_row.oid,
      proc_row.proname as function_name,
      pg_catalog.pg_get_function_identity_arguments(proc_row.oid) as identity_arguments
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname in (
        'complete_store_appointment_with_outcome',
        'create_store_schedule_block_allow_existing_appointments',
        'log_schedule_conversation_event'
      )
  loop
    v_function_definition := pg_catalog.pg_get_functiondef(v_function_row.oid);

    if position('-- p18 tenant authorization guard' in v_function_definition) > 0 then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: public.%I already contains the p18 tenant authorization guard',
          v_function_row.function_name
        );
    end if;

    if v_function_row.function_name in (
      'complete_store_appointment_with_outcome',
      'create_store_schedule_block_allow_existing_appointments'
    ) then
      v_guard_sql :=
        E'  -- p18 tenant authorization guard\n'
        || E'  if coalesce(nullif(pg_catalog.current_setting(''request.jwt.claim.role'', true), ''''), '''') <> ''service_role'' then\n'
        || E'    if auth.uid() is null\n'
        || E'       or not exists (\n'
        || E'         select 1\n'
        || E'         from public.memberships membership_row\n'
        || E'         where membership_row.organization_id = p_organization_id\n'
        || E'           and membership_row.user_id = auth.uid()\n'
        || E'           and membership_row.is_active is true\n'
        || E'       )\n'
        || E'       or not exists (\n'
        || E'         select 1\n'
        || E'         from public.stores store_row\n'
        || E'         where store_row.id = p_store_id\n'
        || E'           and store_row.organization_id = p_organization_id\n'
        || E'       ) then\n'
        || E'      raise exception using errcode = ''42501'', message = ''insufficient privilege: tenant access denied'';\n'
        || E'    end if;\n'
        || E'  end if;\n';
    else
      v_guard_sql :=
        E'  -- p18 tenant authorization guard\n'
        || E'  if coalesce(nullif(pg_catalog.current_setting(''request.jwt.claim.role'', true), ''''), '''') <> ''service_role'' then\n'
        || E'    if auth.uid() is null\n'
        || E'       or not exists (\n'
        || E'         select 1\n'
        || E'         from public.memberships membership_row\n'
        || E'         where membership_row.organization_id = p_organization_id\n'
        || E'           and membership_row.user_id = auth.uid()\n'
        || E'           and membership_row.is_active is true\n'
        || E'       ) then\n'
        || E'      raise exception using errcode = ''42501'', message = ''insufficient privilege: tenant access denied'';\n'
        || E'    end if;\n'
        || E'    if p_conversation_id is not null and not exists (\n'
        || E'      select 1\n'
        || E'      from public.conversations conversation_row\n'
        || E'      where conversation_row.id = p_conversation_id\n'
        || E'        and conversation_row.organization_id = p_organization_id\n'
        || E'    ) then\n'
        || E'      raise exception using errcode = ''42501'', message = ''insufficient privilege: conversation tenant mismatch'';\n'
        || E'    end if;\n'
        || E'  end if;\n';
    end if;

    v_function_definition := pg_catalog.regexp_replace(
      v_function_definition,
      E'\n[ \t]*SET[ \t]+search_path[^\n]*',
      '',
      'ig'
    );
    v_function_definition := pg_catalog.regexp_replace(
      v_function_definition,
      'SECURITY DEFINER',
      '',
      'ig'
    );
    v_function_definition := pg_catalog.regexp_replace(
      v_function_definition,
      '(LANGUAGE[[:space:]]+plpgsql)',
      E'\\1 SECURITY DEFINER\nSET search_path = pg_catalog, public, pg_temp',
      'i'
    );
    v_function_definition := pg_catalog.regexp_replace(
      v_function_definition,
      '\mBEGIN\M',
      'BEGIN' || E'\n' || v_guard_sql,
      'i'
    );

    execute v_function_definition;
  end loop;

  for v_function_row in
    select
      proc_row.proname as function_name,
      pg_catalog.pg_get_function_identity_arguments(proc_row.oid) as identity_arguments
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname in (
        'assistant_enqueue_internal_notification',
        'assistant_get_or_create_primary_thread'
      )
  loop
    execute pg_catalog.format(
      'alter function public.%I(%s) set search_path = pg_catalog, public, pg_temp',
      v_function_row.function_name,
      v_function_row.identity_arguments
    );
  end loop;

  for v_function_row in
    select
      proc_row.proname as function_name,
      pg_catalog.pg_get_function_identity_arguments(proc_row.oid) as identity_arguments
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname in (
        'create_store_appointment',
        'update_store_appointment',
        'cancel_store_appointment',
        'update_store_schedule_block',
        'delete_store_schedule_block',
        'upsert_store_schedule_settings',
        'has_store_active_appointment_in_range',
        'has_store_appointment_conflict',
        'has_store_schedule_block_conflict',
        'is_store_appointment_within_operating_window',
        'get_store_schedule_settings_effective',
        'complete_store_appointment_with_outcome',
        'create_store_schedule_block_allow_existing_appointments',
        'get_latest_conversation_for_lead',
        'log_schedule_conversation_event'
      )
  loop
    execute pg_catalog.format(
      'grant execute on function public.%I(%s) to authenticated',
      v_function_row.function_name,
      v_function_row.identity_arguments
    );
    execute pg_catalog.format(
      'grant execute on function public.%I(%s) to service_role',
      v_function_row.function_name,
      v_function_row.identity_arguments
    );
  end loop;

  for v_function_row in
    select
      proc_row.proname as function_name,
      pg_catalog.pg_get_function_identity_arguments(proc_row.oid) as identity_arguments
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname in (
        'assistant_enqueue_internal_notification',
        'assistant_get_or_create_primary_thread'
      )
  loop
    execute pg_catalog.format(
      'grant execute on function public.%I(%s) to service_role',
      v_function_row.function_name,
      v_function_row.identity_arguments
    );
  end loop;

  select count(*)
  into v_policy_count
  from pg_catalog.pg_policies policy_row
  where policy_row.schemaname = 'public'
    and policy_row.tablename = any(v_target_tables);

  if v_policy_count <> 10 then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'postcondition failed: expected 10 policies across the seven operational tables, found %s',
        v_policy_count
      );
  end if;

  if not (
    has_table_privilege('authenticated', 'public.store_appointments', 'SELECT')
    and has_table_privilege('authenticated', 'public.store_appointments', 'INSERT')
    and has_table_privilege('authenticated', 'public.store_appointments', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.store_appointments', 'DELETE')
    and not has_table_privilege('authenticated', 'public.store_appointments', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.store_appointments', 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.store_appointments', 'TRIGGER')
    and has_table_privilege('authenticated', 'public.store_schedule_blocks', 'SELECT')
    and not has_table_privilege('authenticated', 'public.store_schedule_blocks', 'INSERT')
    and has_table_privilege('authenticated', 'public.store_schedule_blocks', 'UPDATE')
    and has_table_privilege('authenticated', 'public.store_schedule_blocks', 'DELETE')
    and not has_table_privilege('authenticated', 'public.store_schedule_blocks', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.store_schedule_blocks', 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.store_schedule_blocks', 'TRIGGER')
    and has_table_privilege('authenticated', 'public.store_schedule_settings', 'SELECT')
    and has_table_privilege('authenticated', 'public.store_schedule_settings', 'INSERT')
    and has_table_privilege('authenticated', 'public.store_schedule_settings', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.store_schedule_settings', 'DELETE')
    and not has_table_privilege('authenticated', 'public.store_schedule_settings', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.store_schedule_settings', 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.store_schedule_settings', 'TRIGGER')
    and has_table_privilege('authenticated', 'public.store_assistant_operational_tasks', 'SELECT')
    and not has_table_privilege('authenticated', 'public.store_assistant_operational_tasks', 'INSERT')
    and not has_table_privilege('authenticated', 'public.store_assistant_operational_tasks', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.store_assistant_operational_tasks', 'DELETE')
    and not has_table_privilege('authenticated', 'public.store_assistant_operational_tasks', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.store_assistant_operational_tasks', 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.store_assistant_operational_tasks', 'TRIGGER')
    and not has_table_privilege('authenticated', 'public.store_assistant_messages', 'SELECT')
    and not has_table_privilege('authenticated', 'public.store_assistant_messages', 'INSERT')
    and not has_table_privilege('authenticated', 'public.store_assistant_messages', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.store_assistant_messages', 'DELETE')
    and not has_table_privilege('authenticated', 'public.store_assistant_messages', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.store_assistant_messages', 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.store_assistant_messages', 'TRIGGER')
    and not has_table_privilege('authenticated', 'public.store_assistant_notification_queue', 'SELECT')
    and not has_table_privilege('authenticated', 'public.store_assistant_notification_queue', 'INSERT')
    and not has_table_privilege('authenticated', 'public.store_assistant_notification_queue', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.store_assistant_notification_queue', 'DELETE')
    and not has_table_privilege('authenticated', 'public.store_assistant_notification_queue', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.store_assistant_notification_queue', 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.store_assistant_notification_queue', 'TRIGGER')
    and not has_table_privilege('authenticated', 'public.store_responsibles', 'SELECT')
    and not has_table_privilege('authenticated', 'public.store_responsibles', 'INSERT')
    and not has_table_privilege('authenticated', 'public.store_responsibles', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.store_responsibles', 'DELETE')
    and not has_table_privilege('authenticated', 'public.store_responsibles', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.store_responsibles', 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.store_responsibles', 'TRIGGER')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: authenticated table grants diverged from the operational tenant-isolation contract';
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
    and proc_row.proname = any(v_function_names)
    and acl_row.grantee = 0
    and acl_row.privilege_type = 'EXECUTE';

  if v_public_execute_count <> 0 then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'postcondition failed: found %s audited functions still executable by PUBLIC',
        v_public_execute_count
      );
  end if;

  select count(*)
  into v_anon_execute_count
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname = any(v_function_names)
    and has_function_privilege('anon', proc_row.oid, 'EXECUTE');

  if v_anon_execute_count <> 0 then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'postcondition failed: found %s audited functions still executable by anon',
        v_anon_execute_count
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    join pg_catalog.pg_language language_row
      on language_row.oid = proc_row.prolang
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'get_latest_conversation_for_lead'
      and proc_row.prosecdef is true
      and proc_row.provolatile = 's'
      and pg_catalog.pg_get_function_identity_arguments(proc_row.oid) = 'p_organization_id uuid, p_lead_id uuid'
      and pg_catalog.format_type(proc_row.prorettype, null) = 'uuid'
      and language_row.lanname = 'plpgsql'
      and exists (
        select 1
        from pg_catalog.unnest(coalesce(proc_row.proconfig, array[]::text[])) config_entry
        where config_entry = 'search_path=pg_catalog, public, pg_temp'
      )
      and position('-- p18 tenant authorization guard' in pg_catalog.pg_get_functiondef(proc_row.oid)) > 0
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: get_latest_conversation_for_lead was not hardened with SECURITY DEFINER, safe search_path and P18 guard';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'complete_store_appointment_with_outcome'
      and proc_row.prosecdef is true
      and position('-- p18 tenant authorization guard' in pg_catalog.pg_get_functiondef(proc_row.oid)) > 0
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: complete_store_appointment_with_outcome lost SECURITY DEFINER or guard';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'create_store_schedule_block_allow_existing_appointments'
      and proc_row.prosecdef is true
      and position('-- p18 tenant authorization guard' in pg_catalog.pg_get_functiondef(proc_row.oid)) > 0
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: create_store_schedule_block_allow_existing_appointments lost SECURITY DEFINER or guard';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'log_schedule_conversation_event'
      and proc_row.prosecdef is true
      and position('-- p18 tenant authorization guard' in pg_catalog.pg_get_functiondef(proc_row.oid)) > 0
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: log_schedule_conversation_event lost SECURITY DEFINER or guard';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'assistant_enqueue_internal_notification'
      and proc_row.prosecdef is true
      and exists (
        select 1
        from pg_catalog.unnest(coalesce(proc_row.proconfig, array[]::text[])) config_entry
        where config_entry = 'search_path=pg_catalog, public, pg_temp'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: assistant_enqueue_internal_notification must remain SECURITY DEFINER with safe search_path';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'assistant_get_or_create_primary_thread'
      and proc_row.prosecdef is true
      and exists (
        select 1
        from pg_catalog.unnest(coalesce(proc_row.proconfig, array[]::text[])) config_entry
        where config_entry = 'search_path=pg_catalog, public, pg_temp'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: assistant_get_or_create_primary_thread must remain SECURITY DEFINER with safe search_path';
  end if;
end;
$migration$;
