do $migration$
declare
  v_target_tables constant text[] := array[
    'store_catalog_items',
    'store_catalog_item_photos',
    'store_import_files',
    'store_import_file_items',
    'store_import_media_assets',
    'pools',
    'pool_photos'
  ];
  v_browser_tables constant text[] := array[
    'store_catalog_items',
    'store_catalog_item_photos',
    'store_import_files',
    'store_import_file_items',
    'pools',
    'pool_photos'
  ];
  v_table_name text;
  v_policy record;
  v_catalog_photo_match text;
begin
  foreach v_table_name in array v_target_tables loop
    if pg_catalog.to_regclass(pg_catalog.format('public.%I', v_table_name)) is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('precondition failed: public.%I is required', v_table_name);
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

  foreach v_table_name in array array['store_catalog_items', 'store_import_files', 'store_import_media_assets', 'pools', 'store_import_file_items'] loop
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
        message = pg_catalog.format('precondition failed: public.%I must expose organization_id and store_id', v_table_name);
    end if;
  end loop;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'store_catalog_item_photos'
      and column_row.column_name = 'catalog_item_id'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.store_catalog_item_photos must expose catalog_item_id';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'pool_photos'
      and column_row.column_name = 'pool_id'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'pool_photos'
      and column_row.column_name = 'organization_id'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'pool_photos'
      and column_row.column_name = 'store_id'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.pool_photos must expose pool_id, organization_id and store_id';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'store_import_file_items'
      and column_row.column_name = 'import_file_id'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.store_import_file_items must expose import_file_id';
  end if;

  v_catalog_photo_match := '';
  if exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'store_catalog_item_photos'
      and column_row.column_name = 'organization_id'
  ) then
    v_catalog_photo_match := v_catalog_photo_match
      || ' and store_catalog_item_photos.organization_id = parent_row.organization_id';
  end if;
  if exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'store_catalog_item_photos'
      and column_row.column_name = 'store_id'
  ) then
    v_catalog_photo_match := v_catalog_photo_match
      || ' and store_catalog_item_photos.store_id = parent_row.store_id';
  end if;

  foreach v_table_name in array v_target_tables loop
    execute pg_catalog.format('alter table public.%I enable row level security', v_table_name);
    execute pg_catalog.format('revoke all on table public.%I from public', v_table_name);
    execute pg_catalog.format('revoke all on table public.%I from anon', v_table_name);
    execute pg_catalog.format('revoke all on table public.%I from authenticated', v_table_name);
    execute pg_catalog.format('revoke all on table public.%I from service_role', v_table_name);
    execute pg_catalog.format('grant all on table public.%I to service_role', v_table_name);
  end loop;

  foreach v_table_name in array v_browser_tables loop
    execute pg_catalog.format(
      'grant select, insert, update, delete on table public.%I to authenticated',
      v_table_name
    );
  end loop;

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

  foreach v_table_name in array array['store_catalog_items', 'store_import_files', 'pools'] loop
    execute pg_catalog.format(
      $sql$
        create policy %1$I_select_by_active_membership
          on public.%1$I
          for select
          to authenticated
          using (
            auth.uid() is not null
            and exists (
              select 1
              from public.memberships membership_row
              where membership_row.organization_id = %1$I.organization_id
                and membership_row.user_id = auth.uid()
                and membership_row.is_active is true
            )
            and exists (
              select 1
              from public.stores store_row
              where store_row.id = %1$I.store_id
                and store_row.organization_id = %1$I.organization_id
            )
          )
      $sql$,
      v_table_name
    );

    execute pg_catalog.format(
      $sql$
        create policy %1$I_insert_by_active_membership
          on public.%1$I
          for insert
          to authenticated
          with check (
            auth.uid() is not null
            and exists (
              select 1
              from public.memberships membership_row
              where membership_row.organization_id = %1$I.organization_id
                and membership_row.user_id = auth.uid()
                and membership_row.is_active is true
            )
            and exists (
              select 1
              from public.stores store_row
              where store_row.id = %1$I.store_id
                and store_row.organization_id = %1$I.organization_id
            )
          )
      $sql$,
      v_table_name
    );

    execute pg_catalog.format(
      $sql$
        create policy %1$I_update_by_active_membership
          on public.%1$I
          for update
          to authenticated
          using (
            auth.uid() is not null
            and exists (
              select 1
              from public.memberships membership_row
              where membership_row.organization_id = %1$I.organization_id
                and membership_row.user_id = auth.uid()
                and membership_row.is_active is true
            )
            and exists (
              select 1
              from public.stores store_row
              where store_row.id = %1$I.store_id
                and store_row.organization_id = %1$I.organization_id
            )
          )
          with check (
            auth.uid() is not null
            and exists (
              select 1
              from public.memberships membership_row
              where membership_row.organization_id = %1$I.organization_id
                and membership_row.user_id = auth.uid()
                and membership_row.is_active is true
            )
            and exists (
              select 1
              from public.stores store_row
              where store_row.id = %1$I.store_id
                and store_row.organization_id = %1$I.organization_id
            )
          )
      $sql$,
      v_table_name
    );

    execute pg_catalog.format(
      $sql$
        create policy %1$I_delete_by_active_membership
          on public.%1$I
          for delete
          to authenticated
          using (
            auth.uid() is not null
            and exists (
              select 1
              from public.memberships membership_row
              where membership_row.organization_id = %1$I.organization_id
                and membership_row.user_id = auth.uid()
                and membership_row.is_active is true
            )
            and exists (
              select 1
              from public.stores store_row
              where store_row.id = %1$I.store_id
                and store_row.organization_id = %1$I.organization_id
            )
          )
      $sql$,
      v_table_name
    );
  end loop;

  execute pg_catalog.format(
    $sql$
      create policy store_catalog_item_photos_select_by_active_membership
        on public.store_catalog_item_photos
        for select
        to authenticated
        using (
          auth.uid() is not null
          and exists (
            select 1
            from public.store_catalog_items parent_row
            join public.memberships membership_row
              on membership_row.organization_id = parent_row.organization_id
             and membership_row.user_id = auth.uid()
             and membership_row.is_active is true
            join public.stores store_row
              on store_row.id = parent_row.store_id
             and store_row.organization_id = parent_row.organization_id
            where parent_row.id = store_catalog_item_photos.catalog_item_id
            %1$s
          )
        )
    $sql$,
    v_catalog_photo_match
  );

  execute pg_catalog.format(
    $sql$
      create policy store_catalog_item_photos_insert_by_active_membership
        on public.store_catalog_item_photos
        for insert
        to authenticated
        with check (
          auth.uid() is not null
          and exists (
            select 1
            from public.store_catalog_items parent_row
            join public.memberships membership_row
              on membership_row.organization_id = parent_row.organization_id
             and membership_row.user_id = auth.uid()
             and membership_row.is_active is true
            join public.stores store_row
              on store_row.id = parent_row.store_id
             and store_row.organization_id = parent_row.organization_id
            where parent_row.id = store_catalog_item_photos.catalog_item_id
            %1$s
          )
        )
    $sql$,
    v_catalog_photo_match
  );

  execute pg_catalog.format(
    $sql$
      create policy store_catalog_item_photos_update_by_active_membership
        on public.store_catalog_item_photos
        for update
        to authenticated
        using (
          auth.uid() is not null
          and exists (
            select 1
            from public.store_catalog_items parent_row
            join public.memberships membership_row
              on membership_row.organization_id = parent_row.organization_id
             and membership_row.user_id = auth.uid()
             and membership_row.is_active is true
            join public.stores store_row
              on store_row.id = parent_row.store_id
             and store_row.organization_id = parent_row.organization_id
            where parent_row.id = store_catalog_item_photos.catalog_item_id
            %1$s
          )
        )
        with check (
          auth.uid() is not null
          and exists (
            select 1
            from public.store_catalog_items parent_row
            join public.memberships membership_row
              on membership_row.organization_id = parent_row.organization_id
             and membership_row.user_id = auth.uid()
             and membership_row.is_active is true
            join public.stores store_row
              on store_row.id = parent_row.store_id
             and store_row.organization_id = parent_row.organization_id
            where parent_row.id = store_catalog_item_photos.catalog_item_id
            %1$s
          )
        )
    $sql$,
    v_catalog_photo_match
  );

  execute pg_catalog.format(
    $sql$
      create policy store_catalog_item_photos_delete_by_active_membership
        on public.store_catalog_item_photos
        for delete
        to authenticated
        using (
          auth.uid() is not null
          and exists (
            select 1
            from public.store_catalog_items parent_row
            join public.memberships membership_row
              on membership_row.organization_id = parent_row.organization_id
             and membership_row.user_id = auth.uid()
             and membership_row.is_active is true
            join public.stores store_row
              on store_row.id = parent_row.store_id
             and store_row.organization_id = parent_row.organization_id
            where parent_row.id = store_catalog_item_photos.catalog_item_id
            %1$s
          )
        )
    $sql$,
    v_catalog_photo_match
  );

  execute pg_catalog.format(
    $sql$
      create policy pool_photos_select_by_active_membership
        on public.pool_photos
        for select
        to authenticated
        using (
          auth.uid() is not null
          and exists (
            select 1
            from public.pools parent_row
            join public.memberships membership_row
              on membership_row.organization_id = parent_row.organization_id
             and membership_row.user_id = auth.uid()
             and membership_row.is_active is true
            join public.stores store_row
              on store_row.id = parent_row.store_id
             and store_row.organization_id = parent_row.organization_id
            where parent_row.id = pool_photos.pool_id
              and pool_photos.organization_id = parent_row.organization_id
              and pool_photos.store_id = parent_row.store_id
          )
        )
    $sql$
  );

  execute pg_catalog.format(
    $sql$
      create policy pool_photos_insert_by_active_membership
        on public.pool_photos
        for insert
        to authenticated
        with check (
          auth.uid() is not null
          and exists (
            select 1
            from public.pools parent_row
            join public.memberships membership_row
              on membership_row.organization_id = parent_row.organization_id
             and membership_row.user_id = auth.uid()
             and membership_row.is_active is true
            join public.stores store_row
              on store_row.id = parent_row.store_id
             and store_row.organization_id = parent_row.organization_id
            where parent_row.id = pool_photos.pool_id
              and pool_photos.organization_id = parent_row.organization_id
              and pool_photos.store_id = parent_row.store_id
          )
        )
    $sql$
  );

  execute pg_catalog.format(
    $sql$
      create policy pool_photos_update_by_active_membership
        on public.pool_photos
        for update
        to authenticated
        using (
          auth.uid() is not null
          and exists (
            select 1
            from public.pools parent_row
            join public.memberships membership_row
              on membership_row.organization_id = parent_row.organization_id
             and membership_row.user_id = auth.uid()
             and membership_row.is_active is true
            join public.stores store_row
              on store_row.id = parent_row.store_id
             and store_row.organization_id = parent_row.organization_id
            where parent_row.id = pool_photos.pool_id
              and pool_photos.organization_id = parent_row.organization_id
              and pool_photos.store_id = parent_row.store_id
          )
        )
        with check (
          auth.uid() is not null
          and exists (
            select 1
            from public.pools parent_row
            join public.memberships membership_row
              on membership_row.organization_id = parent_row.organization_id
             and membership_row.user_id = auth.uid()
             and membership_row.is_active is true
            join public.stores store_row
              on store_row.id = parent_row.store_id
             and store_row.organization_id = parent_row.organization_id
            where parent_row.id = pool_photos.pool_id
              and pool_photos.organization_id = parent_row.organization_id
              and pool_photos.store_id = parent_row.store_id
          )
        )
    $sql$
  );

  execute pg_catalog.format(
    $sql$
      create policy pool_photos_delete_by_active_membership
        on public.pool_photos
        for delete
        to authenticated
        using (
          auth.uid() is not null
          and exists (
            select 1
            from public.pools parent_row
            join public.memberships membership_row
              on membership_row.organization_id = parent_row.organization_id
             and membership_row.user_id = auth.uid()
             and membership_row.is_active is true
            join public.stores store_row
              on store_row.id = parent_row.store_id
             and store_row.organization_id = parent_row.organization_id
            where parent_row.id = pool_photos.pool_id
              and pool_photos.organization_id = parent_row.organization_id
              and pool_photos.store_id = parent_row.store_id
          )
        )
    $sql$
  );

  execute $sql$
    create policy store_import_file_items_select_by_active_membership
      on public.store_import_file_items
      for select
      to authenticated
      using (
        auth.uid() is not null
        and exists (
          select 1
          from public.store_import_files parent_row
          join public.memberships membership_row
            on membership_row.organization_id = parent_row.organization_id
           and membership_row.user_id = auth.uid()
           and membership_row.is_active is true
          join public.stores store_row
            on store_row.id = parent_row.store_id
           and store_row.organization_id = parent_row.organization_id
          where parent_row.id = store_import_file_items.import_file_id
            and store_import_file_items.organization_id = parent_row.organization_id
            and store_import_file_items.store_id = parent_row.store_id
        )
      )
  $sql$;

  execute $sql$
    create policy store_import_file_items_insert_by_active_membership
      on public.store_import_file_items
      for insert
      to authenticated
      with check (
        auth.uid() is not null
        and exists (
          select 1
          from public.store_import_files parent_row
          join public.memberships membership_row
            on membership_row.organization_id = parent_row.organization_id
           and membership_row.user_id = auth.uid()
           and membership_row.is_active is true
          join public.stores store_row
            on store_row.id = parent_row.store_id
           and store_row.organization_id = parent_row.organization_id
          where parent_row.id = store_import_file_items.import_file_id
            and store_import_file_items.organization_id = parent_row.organization_id
            and store_import_file_items.store_id = parent_row.store_id
        )
      )
  $sql$;

  execute $sql$
    create policy store_import_file_items_update_by_active_membership
      on public.store_import_file_items
      for update
      to authenticated
      using (
        auth.uid() is not null
        and exists (
          select 1
          from public.store_import_files parent_row
          join public.memberships membership_row
            on membership_row.organization_id = parent_row.organization_id
           and membership_row.user_id = auth.uid()
           and membership_row.is_active is true
          join public.stores store_row
            on store_row.id = parent_row.store_id
           and store_row.organization_id = parent_row.organization_id
          where parent_row.id = store_import_file_items.import_file_id
            and store_import_file_items.organization_id = parent_row.organization_id
            and store_import_file_items.store_id = parent_row.store_id
        )
      )
      with check (
        auth.uid() is not null
        and exists (
          select 1
          from public.store_import_files parent_row
          join public.memberships membership_row
            on membership_row.organization_id = parent_row.organization_id
           and membership_row.user_id = auth.uid()
           and membership_row.is_active is true
          join public.stores store_row
            on store_row.id = parent_row.store_id
           and store_row.organization_id = parent_row.organization_id
          where parent_row.id = store_import_file_items.import_file_id
            and store_import_file_items.organization_id = parent_row.organization_id
            and store_import_file_items.store_id = parent_row.store_id
        )
      )
  $sql$;

  execute $sql$
    create policy store_import_file_items_delete_by_active_membership
      on public.store_import_file_items
      for delete
      to authenticated
      using (
        auth.uid() is not null
        and exists (
          select 1
          from public.store_import_files parent_row
          join public.memberships membership_row
            on membership_row.organization_id = parent_row.organization_id
           and membership_row.user_id = auth.uid()
           and membership_row.is_active is true
          join public.stores store_row
            on store_row.id = parent_row.store_id
           and store_row.organization_id = parent_row.organization_id
          where parent_row.id = store_import_file_items.import_file_id
            and store_import_file_items.organization_id = parent_row.organization_id
            and store_import_file_items.store_id = parent_row.store_id
        )
      )
  $sql$;
end;
$migration$;
