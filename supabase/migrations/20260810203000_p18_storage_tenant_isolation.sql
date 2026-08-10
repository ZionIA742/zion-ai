do $migration$
declare
  v_uuid_regex constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_pool_tenant_guard text;
  v_catalog_tenant_guard text;
  v_import_tenant_guard text;
  v_policy record;
  v_bucket_row record;
  v_invalid_org_count integer;
  v_invalid_store_count integer;
  v_store_org_mismatch_count integer;
  v_storage_objects_acl_before jsonb;
  v_storage_objects_acl_after jsonb;
  v_zion_policies_before jsonb;
  v_zion_policies_after jsonb;
  v_update_policy_found boolean := false;
  v_update_using_bucket boolean := false;
  v_update_using_auth boolean := false;
  v_update_using_membership boolean := false;
  v_update_using_store boolean := false;
  v_update_using_segment_1 boolean := false;
  v_update_using_segment_2 boolean := false;
  v_update_using_segment_3 boolean := false;
  v_update_check_bucket boolean := false;
  v_update_check_auth boolean := false;
  v_update_check_membership boolean := false;
  v_update_check_store boolean := false;
  v_update_check_segment_1 boolean := false;
  v_update_check_segment_2 boolean := false;
  v_update_check_segment_3 boolean := false;
begin
  create or replace function pg_temp._p18_storage_normalize_policy_text(
    p_value text
  )
  returns text
  language sql
  as $function$
    select lower(
      pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(
          coalesce(p_value, ''),
          '::[a-z_][a-z0-9_ ]*',
          '',
          'gi'
        ),
        '\s+',
        ' ',
        'g'
      )
    );
  $function$;

  create or replace function pg_temp._p18_storage_policy_has_tokens(
    p_value text,
    p_tokens text[]
  )
  returns boolean
  language plpgsql
  as $function$
  declare
    v_normalized text := pg_temp._p18_storage_normalize_policy_text(p_value);
    v_token text;
  begin
    foreach v_token in array p_tokens loop
      if position(lower(coalesce(v_token, '')) in v_normalized) = 0 then
        return false;
      end if;
    end loop;

    return true;
  end;
  $function$;

  create or replace function pg_temp._p18_storage_policy_has_split_part_segment(
    p_value text,
    p_segment integer
  )
  returns boolean
  language plpgsql
  as $function$
  declare
    v_normalized text := pg_temp._p18_storage_normalize_policy_text(p_value);
    v_pattern text;
  begin
    v_pattern := pg_catalog.format(
      '(pg_catalog\.)?split_part\(\s*((storage\.)?objects\.)?name\s*,\s*''/''\s*,\s*%s\s*\)',
      p_segment
    );

    return v_normalized ~ v_pattern;
  end;
  $function$;

  create or replace function pg_temp._p18_storage_policy_has_nonempty_segment_3(
    p_value text
  )
  returns boolean
  language plpgsql
  as $function$
  declare
    v_normalized text := pg_temp._p18_storage_normalize_policy_text(p_value);
    v_pattern text := 'nullif\(\s*(pg_catalog\.)?split_part\(\s*((storage\.)?objects\.)?name\s*,\s*''/''\s*,\s*3\s*\)\s*,\s*''''\s*\)\s+is\s+not\s+null';
  begin
    return v_normalized ~ v_pattern;
  end;
  $function$;

  if pg_catalog.to_regclass('storage.objects') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: storage.objects is required';
  end if;

  if pg_catalog.to_regclass('storage.buckets') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: storage.buckets is required';
  end if;

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
    where column_row.table_schema = 'storage'
      and column_row.table_name = 'objects'
      and column_row.column_name = 'bucket_id'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'storage'
      and column_row.table_name = 'objects'
      and column_row.column_name = 'name'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: storage.objects must expose bucket_id and name';
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
    from pg_catalog.pg_class class_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'storage'
      and class_row.relname = 'objects'
      and class_row.relrowsecurity
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: storage.objects must have row level security enabled';
  end if;

  for v_bucket_row in
    select *
    from (
      values
        ('pool-photos', true),
        ('store-catalog-photos', true),
        ('store-import-files', false),
        ('zion-store-files', false)
    ) expected_row(bucket_id, expected_public)
  loop
    if not exists (
      select 1
      from storage.buckets bucket_row
      where bucket_row.id = v_bucket_row.bucket_id
        and bucket_row.public = v_bucket_row.expected_public
    ) then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: storage.buckets %s public flag mismatch',
          v_bucket_row.bucket_id
        );
    end if;
  end loop;

  for v_bucket_row in
    select *
    from (
      values
        ('pool-photos'),
        ('store-catalog-photos'),
        ('store-import-files')
    ) target_row(bucket_id)
  loop
    select count(*)
    into v_invalid_org_count
    from storage.objects object_row
    where object_row.bucket_id = v_bucket_row.bucket_id
      and pg_catalog.split_part(object_row.name, '/', 1) !~* v_uuid_regex;

    select count(*)
    into v_invalid_store_count
    from storage.objects object_row
    where object_row.bucket_id = v_bucket_row.bucket_id
      and pg_catalog.split_part(object_row.name, '/', 2) !~* v_uuid_regex;

    select count(*)
    into v_store_org_mismatch_count
    from storage.objects object_row
    left join public.stores store_row
      on store_row.id = (
        case
          when pg_catalog.split_part(object_row.name, '/', 2) ~* v_uuid_regex
          then pg_catalog.split_part(object_row.name, '/', 2)::uuid
          else null
        end
      )
    where object_row.bucket_id = v_bucket_row.bucket_id
      and (
        store_row.id is null
        or store_row.organization_id is distinct from (
          case
            when pg_catalog.split_part(object_row.name, '/', 1) ~* v_uuid_regex
            then pg_catalog.split_part(object_row.name, '/', 1)::uuid
            else null
          end
        )
      );

    if v_invalid_org_count <> 0 or v_invalid_store_count <> 0 or v_store_org_mismatch_count <> 0 then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: bucket %s current paths diverge from canonical organization/store contract (invalid_org=%s invalid_store=%s mismatch=%s)',
          v_bucket_row.bucket_id,
          v_invalid_org_count,
          v_invalid_store_count,
          v_store_org_mismatch_count
        );
    end if;
  end loop;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'policyname', policy_row.policyname,
               'cmd', policy_row.cmd,
               'roles', policy_row.roles,
               'qual', policy_row.qual,
               'with_check', policy_row.with_check
             )
             order by policy_row.policyname, policy_row.cmd
           ),
           '[]'::jsonb
         )
  into v_zion_policies_before
  from pg_catalog.pg_policies policy_row
  where policy_row.schemaname = 'storage'
    and policy_row.tablename = 'objects'
    and (
      coalesce(policy_row.qual, '') ilike '%zion-store-files%'
      or coalesce(policy_row.with_check, '') ilike '%zion-store-files%'
    );

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'grantee',
               case
                 when acl_row.grantee = 0 then 'PUBLIC'
                 else role_row.rolname
               end,
               'privilege_type', acl_row.privilege_type,
               'is_grantable', acl_row.is_grantable
             )
             order by
               case
                 when acl_row.grantee = 0 then 'PUBLIC'
                 else role_row.rolname
               end,
               acl_row.privilege_type,
               acl_row.is_grantable
           ),
           '[]'::jsonb
         )
  into v_storage_objects_acl_before
  from pg_catalog.pg_class class_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = class_row.relnamespace
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      class_row.relacl,
      pg_catalog.acldefault('r', class_row.relowner)
    )
  ) acl_row
  left join pg_catalog.pg_roles role_row
    on role_row.oid = acl_row.grantee
  where namespace_row.nspname = 'storage'
    and class_row.relname = 'objects';

  if (
    select count(*)
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'storage'
      and policy_row.tablename = 'objects'
      and (
        coalesce(policy_row.qual, '') ilike '%pool-photos%'
        or coalesce(policy_row.with_check, '') ilike '%pool-photos%'
      )
  ) <> 3 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: expected 3 current pool-photos policies on storage.objects';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'storage'
      and policy_row.tablename = 'objects'
      and policy_row.cmd = 'SELECT'
      and policy_row.roles = array['public']::name[]
      and pg_temp._p18_storage_normalize_policy_text(policy_row.qual) like '%bucket_id = ''pool-photos''%'
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: pool-photos public select policy contract mismatch';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'storage'
      and policy_row.tablename = 'objects'
      and policy_row.cmd = 'INSERT'
      and policy_row.roles = array['authenticated']::name[]
      and pg_temp._p18_storage_normalize_policy_text(policy_row.with_check) like '%bucket_id = ''pool-photos''%'
      and position('auth.uid' in pg_temp._p18_storage_normalize_policy_text(policy_row.with_check)) = 0
      and position('membership' in pg_temp._p18_storage_normalize_policy_text(policy_row.with_check)) = 0
      and position('store_row' in pg_temp._p18_storage_normalize_policy_text(policy_row.with_check)) = 0
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: pool-photos authenticated insert policy contract mismatch';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'storage'
      and policy_row.tablename = 'objects'
      and policy_row.cmd = 'DELETE'
      and policy_row.roles = array['authenticated']::name[]
      and pg_temp._p18_storage_normalize_policy_text(policy_row.qual) like '%bucket_id = ''pool-photos''%'
      and position('auth.uid' in pg_temp._p18_storage_normalize_policy_text(policy_row.qual)) = 0
      and position('membership' in pg_temp._p18_storage_normalize_policy_text(policy_row.qual)) = 0
      and position('store_row' in pg_temp._p18_storage_normalize_policy_text(policy_row.qual)) = 0
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: pool-photos authenticated delete policy contract mismatch';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'storage'
      and policy_row.tablename = 'objects'
      and (
        coalesce(policy_row.qual, '') ilike '%store-catalog-photos%'
        or coalesce(policy_row.with_check, '') ilike '%store-catalog-photos%'
      )
  ) <> 3 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: expected 3 current store-catalog-photos policies on storage.objects';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'storage'
      and policy_row.tablename = 'objects'
      and policy_row.cmd = 'SELECT'
      and policy_row.roles = array['public']::name[]
      and pg_temp._p18_storage_normalize_policy_text(policy_row.qual) like '%bucket_id = ''store-catalog-photos''%'
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: store-catalog-photos public select policy contract mismatch';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'storage'
      and policy_row.tablename = 'objects'
      and policy_row.cmd = 'INSERT'
      and policy_row.roles = array['public']::name[]
      and pg_temp._p18_storage_normalize_policy_text(policy_row.with_check) like '%bucket_id = ''store-catalog-photos''%'
      and position('auth.uid' in pg_temp._p18_storage_normalize_policy_text(policy_row.with_check)) = 0
      and position('membership' in pg_temp._p18_storage_normalize_policy_text(policy_row.with_check)) = 0
      and position('store_row' in pg_temp._p18_storage_normalize_policy_text(policy_row.with_check)) = 0
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: store-catalog-photos public insert policy contract mismatch';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'storage'
      and policy_row.tablename = 'objects'
      and policy_row.cmd = 'DELETE'
      and policy_row.roles = array['public']::name[]
      and pg_temp._p18_storage_normalize_policy_text(policy_row.qual) like '%bucket_id = ''store-catalog-photos''%'
      and position('auth.uid' in pg_temp._p18_storage_normalize_policy_text(policy_row.qual)) = 0
      and position('membership' in pg_temp._p18_storage_normalize_policy_text(policy_row.qual)) = 0
      and position('store_row' in pg_temp._p18_storage_normalize_policy_text(policy_row.qual)) = 0
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: store-catalog-photos public delete policy contract mismatch';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'storage'
      and policy_row.tablename = 'objects'
      and (
        coalesce(policy_row.qual, '') ilike '%store-import-files%'
        or coalesce(policy_row.with_check, '') ilike '%store-import-files%'
      )
  ) <> 4 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: expected 4 current store-import-files policies on storage.objects';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'storage'
      and policy_row.tablename = 'objects'
      and policy_row.cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      and policy_row.roles = array['authenticated']::name[]
      and (
        pg_temp._p18_storage_normalize_policy_text(policy_row.qual) like '%bucket_id = ''store-import-files''%'
        or pg_temp._p18_storage_normalize_policy_text(policy_row.with_check) like '%bucket_id = ''store-import-files''%'
      )
      and position('auth.uid' in pg_temp._p18_storage_normalize_policy_text(coalesce(policy_row.qual, '') || ' ' || coalesce(policy_row.with_check, ''))) = 0
      and position('membership' in pg_temp._p18_storage_normalize_policy_text(coalesce(policy_row.qual, '') || ' ' || coalesce(policy_row.with_check, ''))) = 0
      and position('store_row' in pg_temp._p18_storage_normalize_policy_text(coalesce(policy_row.qual, '') || ' ' || coalesce(policy_row.with_check, ''))) = 0
  ) <> 4 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: store-import-files authenticated bucket-only policy contract mismatch';
  end if;

  v_pool_tenant_guard := pg_catalog.format(
    $guard$
      bucket_id = %1$L
      and auth.uid() is not null
      and nullif(pg_catalog.split_part(name, '/', 3), '') is not null
      and exists (
        select 1
        from (
          select
            case
              when pg_catalog.split_part(name, '/', 1) ~* %2$L
              then pg_catalog.split_part(name, '/', 1)::uuid
              else null
            end as organization_id,
            case
              when pg_catalog.split_part(name, '/', 2) ~* %2$L
              then pg_catalog.split_part(name, '/', 2)::uuid
              else null
            end as store_id
        ) parsed
        join public.memberships membership_row
          on membership_row.organization_id = parsed.organization_id
         and membership_row.user_id = auth.uid()
         and membership_row.is_active is true
        join public.stores store_row
          on store_row.id = parsed.store_id
         and store_row.organization_id = parsed.organization_id
        where parsed.organization_id is not null
          and parsed.store_id is not null
      )
    $guard$,
    'pool-photos',
    v_uuid_regex
  );

  v_catalog_tenant_guard := pg_catalog.format(
    $guard$
      bucket_id = %1$L
      and auth.uid() is not null
      and nullif(pg_catalog.split_part(name, '/', 3), '') is not null
      and exists (
        select 1
        from (
          select
            case
              when pg_catalog.split_part(name, '/', 1) ~* %2$L
              then pg_catalog.split_part(name, '/', 1)::uuid
              else null
            end as organization_id,
            case
              when pg_catalog.split_part(name, '/', 2) ~* %2$L
              then pg_catalog.split_part(name, '/', 2)::uuid
              else null
            end as store_id
        ) parsed
        join public.memberships membership_row
          on membership_row.organization_id = parsed.organization_id
         and membership_row.user_id = auth.uid()
         and membership_row.is_active is true
        join public.stores store_row
          on store_row.id = parsed.store_id
         and store_row.organization_id = parsed.organization_id
        where parsed.organization_id is not null
          and parsed.store_id is not null
      )
    $guard$,
    'store-catalog-photos',
    v_uuid_regex
  );

  v_import_tenant_guard := pg_catalog.format(
    $guard$
      bucket_id = %1$L
      and auth.uid() is not null
      and nullif(pg_catalog.split_part(name, '/', 3), '') is not null
      and exists (
        select 1
        from (
          select
            case
              when pg_catalog.split_part(name, '/', 1) ~* %2$L
              then pg_catalog.split_part(name, '/', 1)::uuid
              else null
            end as organization_id,
            case
              when pg_catalog.split_part(name, '/', 2) ~* %2$L
              then pg_catalog.split_part(name, '/', 2)::uuid
              else null
            end as store_id
        ) parsed
        join public.memberships membership_row
          on membership_row.organization_id = parsed.organization_id
         and membership_row.user_id = auth.uid()
         and membership_row.is_active is true
        join public.stores store_row
          on store_row.id = parsed.store_id
         and store_row.organization_id = parsed.organization_id
        where parsed.organization_id is not null
          and parsed.store_id is not null
      )
    $guard$,
    'store-import-files',
    v_uuid_regex
  );

  for v_policy in
    select policy_row.policyname
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'storage'
      and policy_row.tablename = 'objects'
      and (
        coalesce(policy_row.qual, '') ilike '%pool-photos%'
        or coalesce(policy_row.with_check, '') ilike '%pool-photos%'
        or coalesce(policy_row.qual, '') ilike '%store-catalog-photos%'
        or coalesce(policy_row.with_check, '') ilike '%store-catalog-photos%'
        or coalesce(policy_row.qual, '') ilike '%store-import-files%'
        or coalesce(policy_row.with_check, '') ilike '%store-import-files%'
      )
  loop
    execute pg_catalog.format(
      'drop policy if exists %I on storage.objects',
      v_policy.policyname
    );
  end loop;

  execute $sql$
    create policy storage_pool_photos_public_select
      on storage.objects
      for select
      to public
      using (
        bucket_id = 'pool-photos'
      )
  $sql$;

  execute pg_catalog.format(
    $sql$
      create policy storage_pool_photos_authenticated_insert_tenant
        on storage.objects
        for insert
        to authenticated
        with check (
          %s
        )
    $sql$,
    v_pool_tenant_guard
  );

  execute pg_catalog.format(
    $sql$
      create policy storage_pool_photos_authenticated_delete_tenant
        on storage.objects
        for delete
        to authenticated
        using (
          %s
        )
    $sql$,
    v_pool_tenant_guard
  );

  execute $sql$
    create policy storage_store_catalog_photos_public_select
      on storage.objects
      for select
      to public
      using (
        bucket_id = 'store-catalog-photos'
      )
  $sql$;

  execute pg_catalog.format(
    $sql$
      create policy storage_store_catalog_photos_authenticated_insert_tenant
        on storage.objects
        for insert
        to authenticated
        with check (
          %s
        )
    $sql$,
    v_catalog_tenant_guard
  );

  execute pg_catalog.format(
    $sql$
      create policy storage_store_catalog_photos_authenticated_delete_tenant
        on storage.objects
        for delete
        to authenticated
        using (
          %s
        )
    $sql$,
    v_catalog_tenant_guard
  );

  execute pg_catalog.format(
    $sql$
      create policy storage_store_import_files_authenticated_select_tenant
        on storage.objects
        for select
        to authenticated
        using (
          %s
        )
    $sql$,
    v_import_tenant_guard
  );

  execute pg_catalog.format(
    $sql$
      create policy storage_store_import_files_authenticated_insert_tenant
        on storage.objects
        for insert
        to authenticated
        with check (
          %s
        )
    $sql$,
    v_import_tenant_guard
  );

  execute pg_catalog.format(
    $sql$
      create policy storage_store_import_files_authenticated_update_tenant
        on storage.objects
        for update
        to authenticated
        using (
          %s
        )
        with check (
          %s
        )
    $sql$,
    v_import_tenant_guard,
    v_import_tenant_guard
  );

  execute pg_catalog.format(
    $sql$
      create policy storage_store_import_files_authenticated_delete_tenant
        on storage.objects
        for delete
        to authenticated
        using (
          %s
        )
    $sql$,
    v_import_tenant_guard
  );

  if (
    select count(*)
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'storage'
      and policy_row.tablename = 'objects'
      and policy_row.policyname in (
        'storage_pool_photos_public_select',
        'storage_pool_photos_authenticated_insert_tenant',
        'storage_pool_photos_authenticated_delete_tenant',
        'storage_store_catalog_photos_public_select',
        'storage_store_catalog_photos_authenticated_insert_tenant',
        'storage_store_catalog_photos_authenticated_delete_tenant',
        'storage_store_import_files_authenticated_select_tenant',
        'storage_store_import_files_authenticated_insert_tenant',
        'storage_store_import_files_authenticated_update_tenant',
        'storage_store_import_files_authenticated_delete_tenant'
      )
  ) <> 10 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: expected 10 focal storage policies after tenant isolation';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'storage'
      and policy_row.tablename = 'objects'
      and (
        coalesce(policy_row.qual, '') ilike '%pool-photos%'
        or coalesce(policy_row.with_check, '') ilike '%pool-photos%'
        or coalesce(policy_row.qual, '') ilike '%store-catalog-photos%'
        or coalesce(policy_row.with_check, '') ilike '%store-catalog-photos%'
        or coalesce(policy_row.qual, '') ilike '%store-import-files%'
        or coalesce(policy_row.with_check, '') ilike '%store-import-files%'
      )
  ) <> 10 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: focal buckets must end with exactly 10 storage policies';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'storage'
      and policy_row.tablename = 'objects'
      and (
        coalesce(policy_row.qual, '') ilike '%pool-photos%'
        or coalesce(policy_row.with_check, '') ilike '%pool-photos%'
        or coalesce(policy_row.qual, '') ilike '%store-catalog-photos%'
        or coalesce(policy_row.with_check, '') ilike '%store-catalog-photos%'
        or coalesce(policy_row.qual, '') ilike '%store-import-files%'
        or coalesce(policy_row.with_check, '') ilike '%store-import-files%'
      )
      and (
        lower(pg_catalog.btrim(coalesce(policy_row.qual, ''))) = 'true'
        or lower(pg_catalog.btrim(coalesce(policy_row.with_check, ''))) = 'true'
        or coalesce(policy_row.qual, '') ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
        or coalesce(policy_row.with_check, '') ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: focal storage policies contain hardcoded UUIDs or true clauses';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'storage'
      and policy_row.tablename = 'objects'
      and policy_row.policyname = 'storage_pool_photos_public_select'
      and policy_row.cmd = 'SELECT'
      and policy_row.roles = array['public']::name[]
      and pg_temp._p18_storage_normalize_policy_text(policy_row.qual) like '%bucket_id = ''pool-photos''%'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: pool-photos public select policy missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'storage'
      and policy_row.tablename = 'objects'
      and policy_row.policyname = 'storage_store_catalog_photos_public_select'
      and policy_row.cmd = 'SELECT'
      and policy_row.roles = array['public']::name[]
      and pg_temp._p18_storage_normalize_policy_text(policy_row.qual) like '%bucket_id = ''store-catalog-photos''%'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: store-catalog-photos public select policy missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'storage'
      and policy_row.tablename = 'objects'
      and policy_row.cmd in ('INSERT', 'UPDATE', 'DELETE')
      and (
        coalesce(policy_row.qual, '') ilike '%pool-photos%'
        or coalesce(policy_row.with_check, '') ilike '%pool-photos%'
        or coalesce(policy_row.qual, '') ilike '%store-catalog-photos%'
        or coalesce(policy_row.with_check, '') ilike '%store-catalog-photos%'
      )
      and policy_row.roles && array['public', 'anon']::name[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: photo buckets must not expose PUBLIC or anon mutations';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'storage'
      and policy_row.tablename = 'objects'
      and (
        coalesce(policy_row.qual, '') ilike '%store-import-files%'
        or coalesce(policy_row.with_check, '') ilike '%store-import-files%'
      )
      and policy_row.roles && array['public', 'anon']::name[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: store-import-files must not expose PUBLIC or anon policies';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'storage'
      and policy_row.tablename = 'objects'
      and (
        coalesce(policy_row.qual, '') ilike '%pool-photos%'
        or coalesce(policy_row.with_check, '') ilike '%pool-photos%'
        or coalesce(policy_row.qual, '') ilike '%store-catalog-photos%'
        or coalesce(policy_row.with_check, '') ilike '%store-catalog-photos%'
        or coalesce(policy_row.qual, '') ilike '%store-import-files%'
        or coalesce(policy_row.with_check, '') ilike '%store-import-files%'
      )
      and policy_row.policyname not in (
        'storage_pool_photos_public_select',
        'storage_pool_photos_authenticated_insert_tenant',
        'storage_pool_photos_authenticated_delete_tenant',
        'storage_store_catalog_photos_public_select',
        'storage_store_catalog_photos_authenticated_insert_tenant',
        'storage_store_catalog_photos_authenticated_delete_tenant',
        'storage_store_import_files_authenticated_select_tenant',
        'storage_store_import_files_authenticated_insert_tenant',
        'storage_store_import_files_authenticated_update_tenant',
        'storage_store_import_files_authenticated_delete_tenant'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: unexpected extra policies remain on the focal storage buckets';
  end if;

  select
    true,
    pg_temp._p18_storage_normalize_policy_text(policy_row.qual) like '%bucket_id = ''store-import-files''%',
    pg_temp._p18_storage_policy_has_tokens(
      policy_row.qual,
      array['auth.uid()', 'membership_row.is_active is true', 'store_row.organization_id = parsed.organization_id']
    ),
    position('membership_row' in pg_temp._p18_storage_normalize_policy_text(policy_row.qual)) > 0,
    position('store_row' in pg_temp._p18_storage_normalize_policy_text(policy_row.qual)) > 0,
    pg_temp._p18_storage_policy_has_split_part_segment(policy_row.qual, 1),
    pg_temp._p18_storage_policy_has_split_part_segment(policy_row.qual, 2),
    pg_temp._p18_storage_policy_has_nonempty_segment_3(policy_row.qual),
    pg_temp._p18_storage_normalize_policy_text(policy_row.with_check) like '%bucket_id = ''store-import-files''%',
    pg_temp._p18_storage_policy_has_tokens(
      policy_row.with_check,
      array['auth.uid()', 'membership_row.is_active is true', 'store_row.organization_id = parsed.organization_id']
    ),
    position('membership_row' in pg_temp._p18_storage_normalize_policy_text(policy_row.with_check)) > 0,
    position('store_row' in pg_temp._p18_storage_normalize_policy_text(policy_row.with_check)) > 0,
    pg_temp._p18_storage_policy_has_split_part_segment(policy_row.with_check, 1),
    pg_temp._p18_storage_policy_has_split_part_segment(policy_row.with_check, 2),
    pg_temp._p18_storage_policy_has_nonempty_segment_3(policy_row.with_check)
  into
    v_update_policy_found,
    v_update_using_bucket,
    v_update_using_auth,
    v_update_using_membership,
    v_update_using_store,
    v_update_using_segment_1,
    v_update_using_segment_2,
    v_update_using_segment_3,
    v_update_check_bucket,
    v_update_check_auth,
    v_update_check_membership,
    v_update_check_store,
    v_update_check_segment_1,
    v_update_check_segment_2,
    v_update_check_segment_3
  from pg_catalog.pg_policies policy_row
  where policy_row.schemaname = 'storage'
    and policy_row.tablename = 'objects'
    and policy_row.policyname = 'storage_store_import_files_authenticated_update_tenant'
    and policy_row.cmd = 'UPDATE'
    and policy_row.roles = array['authenticated']::name[];

  if not coalesce(v_update_policy_found, false)
     or not coalesce(v_update_using_bucket, false)
     or not coalesce(v_update_using_auth, false)
     or not coalesce(v_update_using_membership, false)
     or not coalesce(v_update_using_store, false)
     or not coalesce(v_update_using_segment_1, false)
     or not coalesce(v_update_using_segment_2, false)
     or not coalesce(v_update_using_segment_3, false)
     or not coalesce(v_update_check_bucket, false)
     or not coalesce(v_update_check_auth, false)
     or not coalesce(v_update_check_membership, false)
     or not coalesce(v_update_check_store, false)
     or not coalesce(v_update_check_segment_1, false)
     or not coalesce(v_update_check_segment_2, false)
     or not coalesce(v_update_check_segment_3, false) then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'postcondition failed: store-import-files update policy is not tenant-safe; update_policy_check: policy_found=%s using_bucket=%s using_auth=%s using_membership=%s using_store=%s using_segment_1=%s using_segment_2=%s using_segment_3=%s check_bucket=%s check_auth=%s check_membership=%s check_store=%s check_segment_1=%s check_segment_2=%s check_segment_3=%s',
        v_update_policy_found,
        v_update_using_bucket,
        v_update_using_auth,
        v_update_using_membership,
        v_update_using_store,
        v_update_using_segment_1,
        v_update_using_segment_2,
        v_update_using_segment_3,
        v_update_check_bucket,
        v_update_check_auth,
        v_update_check_membership,
        v_update_check_store,
        v_update_check_segment_1,
        v_update_check_segment_2,
        v_update_check_segment_3
      );
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'policyname', policy_row.policyname,
               'cmd', policy_row.cmd,
               'roles', policy_row.roles,
               'qual', policy_row.qual,
               'with_check', policy_row.with_check
             )
             order by policy_row.policyname, policy_row.cmd
           ),
           '[]'::jsonb
         )
  into v_zion_policies_after
  from pg_catalog.pg_policies policy_row
  where policy_row.schemaname = 'storage'
    and policy_row.tablename = 'objects'
    and (
      coalesce(policy_row.qual, '') ilike '%zion-store-files%'
      or coalesce(policy_row.with_check, '') ilike '%zion-store-files%'
    );

  if v_zion_policies_before is distinct from v_zion_policies_after then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: zion-store-files storage policies changed unexpectedly';
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'grantee',
               case
                 when acl_row.grantee = 0 then 'PUBLIC'
                 else role_row.rolname
               end,
               'privilege_type', acl_row.privilege_type,
               'is_grantable', acl_row.is_grantable
             )
             order by
               case
                 when acl_row.grantee = 0 then 'PUBLIC'
                 else role_row.rolname
               end,
               acl_row.privilege_type,
               acl_row.is_grantable
           ),
           '[]'::jsonb
         )
  into v_storage_objects_acl_after
  from pg_catalog.pg_class class_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = class_row.relnamespace
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      class_row.relacl,
      pg_catalog.acldefault('r', class_row.relowner)
    )
  ) acl_row
  left join pg_catalog.pg_roles role_row
    on role_row.oid = acl_row.grantee
  where namespace_row.nspname = 'storage'
    and class_row.relname = 'objects';

  if v_storage_objects_acl_before is distinct from v_storage_objects_acl_after then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: global grants on storage.objects changed unexpectedly';
  end if;

  if not exists (
    select 1
    from storage.buckets bucket_row
    where bucket_row.id = 'pool-photos'
      and bucket_row.public is true
  ) or not exists (
    select 1
    from storage.buckets bucket_row
    where bucket_row.id = 'store-catalog-photos'
      and bucket_row.public is true
  ) or not exists (
    select 1
    from storage.buckets bucket_row
    where bucket_row.id = 'store-import-files'
      and bucket_row.public is false
  ) or not exists (
    select 1
    from storage.buckets bucket_row
    where bucket_row.id = 'zion-store-files'
      and bucket_row.public is false
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: one or more storage bucket public/private flags changed';
  end if;
end;
$migration$;
