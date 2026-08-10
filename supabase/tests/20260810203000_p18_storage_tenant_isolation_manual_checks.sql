begin;

create temp table pg_temp._p18_storage_matrix (
  scenario_number integer primary key,
  scenario_name text not null
);

insert into pg_temp._p18_storage_matrix (scenario_number, scenario_name)
values
  (1, 'bucket public private flags remain correct'),
  (2, 'final storage policies and roles are exact for the 3 focal buckets'),
  (3, 'photo buckets expose no mutation to public or anon'),
  (4, 'public read of pool and catalog photos remains available'),
  (5, 'user A can insert pool photo into tenant A path'),
  (6, 'user A cannot insert pool photo into tenant B path'),
  (7, 'user A can delete pool photo from tenant A and cannot delete tenant B'),
  (8, 'store catalog photos own tenant delete works and foreign delete stays invisible'),
  (9, 'store catalog photos mirror the pool photo insert delete isolation'),
  (10, 'store import files own tenant select works'),
  (11, 'store import files foreign tenant read stays invisible'),
  (12, 'store import files own tenant insert works'),
  (13, 'store import files foreign tenant insert is blocked'),
  (14, 'store import files own tenant update works'),
  (15, 'store import files update cannot pivot path to tenant B'),
  (16, 'store import files own tenant delete works'),
  (17, 'store import files foreign tenant delete stays invisible'),
  (18, 'inactive membership is blocked across the 3 buckets'),
  (19, 'invalid organization path is blocked'),
  (20, 'invalid store path is blocked'),
  (21, 'store from another organization is blocked'),
  (22, 'zion-store-files policy surface remains untouched inside the runner'),
  (23, 'storage.objects global grants stay untouched inside the runner'),
  (24, 'synthetic fixtures stay isolated inside the transaction and final rollback');

create temp table pg_temp._p18_storage_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  details text not null
);

create temp table pg_temp._p18_storage_state (
  state_key text primary key,
  value_uuid uuid null,
  value_text text null
) on commit drop;

create or replace function pg_temp._p18_storage_record(
  p_scenario_number integer,
  p_status text,
  p_details text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p18_storage_results (
    scenario_number,
    scenario_name,
    status,
    details
  )
  values (
    p_scenario_number,
    (
      select matrix_row.scenario_name
      from pg_temp._p18_storage_matrix matrix_row
      where matrix_row.scenario_number = p_scenario_number
    ),
    p_status,
    p_details
  )
  on conflict (scenario_number) do update
  set status = excluded.status,
      details = excluded.details;
end;
$function$;

create or replace function pg_temp._p18_storage_require(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $function$
begin
  if coalesce(p_condition, false) is not true then
    raise exception using
      errcode = 'P0001',
      message = p_message;
  end if;
end;
$function$;

create or replace function pg_temp._p18_storage_set_auth(
  p_role text,
  p_user_id uuid default null
)
returns void
language plpgsql
as $function$
begin
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform pg_catalog.set_config('request.jwt.claim.role', coalesce(p_role, ''), true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    case
      when p_role is null or p_role = '' then ''
      else json_build_object('sub', coalesce(p_user_id::text, ''), 'role', p_role)::text
    end,
    true
  );

  if p_role = 'authenticated' then
    execute 'set local role authenticated';
  elsif p_role = 'service_role' then
    execute 'set local role service_role';
  elsif p_role = 'anon' then
    execute 'set local role anon';
  end if;
end;
$function$;

create or replace function pg_temp._p18_storage_reset_auth()
returns void
language plpgsql
as $function$
begin
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claim.role', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '', true);
end;
$function$;

create or replace function pg_temp._p18_storage_exec(
  p_role text,
  p_user_id uuid,
  p_sql text
)
returns table (
  operation_succeeded boolean,
  value_text text,
  returned_sqlstate text,
  message_text text
)
language plpgsql
as $function$
declare
  v_value text;
  v_state text;
  v_message text;
begin
  perform pg_temp._p18_storage_set_auth(p_role, p_user_id);

  begin
    execute p_sql into v_value;
    perform pg_temp._p18_storage_reset_auth();
    return query
    select true, v_value, null::text, null::text;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;
      perform pg_temp._p18_storage_reset_auth();
      return query
      select false, null::text, v_state, v_message;
  end;
end;
$function$;

create or replace function pg_temp._p18_storage_assert_success(
  p_role text,
  p_user_id uuid,
  p_sql text,
  p_expected_value text default null
)
returns void
language plpgsql
as $function$
declare
  v_exec record;
begin
  select *
  into v_exec
  from pg_temp._p18_storage_exec(p_role, p_user_id, p_sql);

  if not coalesce(v_exec.operation_succeeded, false) then
    raise exception using
      errcode = 'P0001',
      message = format(
        'expected success but got sqlstate=%s message=%s sql=%s',
        coalesce(v_exec.returned_sqlstate, '<null>'),
        coalesce(v_exec.message_text, '<null>'),
        p_sql
      );
  end if;

  if p_expected_value is not null and v_exec.value_text is distinct from p_expected_value then
    raise exception using
      errcode = 'P0001',
      message = format(
        'unexpected value expected=%s actual=%s sql=%s',
        p_expected_value,
        coalesce(v_exec.value_text, '<null>'),
        p_sql
      );
  end if;
end;
$function$;

create or replace function pg_temp._p18_storage_assert_failure(
  p_role text,
  p_user_id uuid,
  p_sql text,
  p_expected_sqlstate text
)
returns void
language plpgsql
as $function$
declare
  v_exec record;
begin
  select *
  into v_exec
  from pg_temp._p18_storage_exec(p_role, p_user_id, p_sql);

  if coalesce(v_exec.operation_succeeded, false) then
    raise exception using
      errcode = 'P0001',
      message = format('expected failure but operation succeeded sql=%s', p_sql);
  end if;

  if v_exec.returned_sqlstate is distinct from p_expected_sqlstate then
    raise exception using
      errcode = 'P0001',
      message = format(
        'unexpected failure sqlstate expected=%s actual=%s sql=%s message=%s',
        p_expected_sqlstate,
        coalesce(v_exec.returned_sqlstate, '<null>'),
        p_sql,
        coalesce(v_exec.message_text, '<null>')
      );
  end if;
end;
$function$;

create or replace function pg_temp._p18_storage_assert_delete_policy_result(
  p_policyname text,
  p_bucket_id text,
  p_name text,
  p_role text,
  p_user_id uuid,
  p_expected_result boolean
)
returns void
language plpgsql
as $function$
declare
  v_policy_qual text;
  v_policy_roles name[];
  v_exec record;
  v_sql text;
  v_actual_result boolean;
begin
  select
    policy_row.qual,
    policy_row.roles
  into
    v_policy_qual,
    v_policy_roles
  from pg_catalog.pg_policies policy_row
  where policy_row.schemaname = 'storage'
    and policy_row.tablename = 'objects'
    and policy_row.policyname = p_policyname
    and policy_row.cmd = 'DELETE';

  if coalesce(v_policy_qual, '') = '' then
    raise exception using
      errcode = 'P0001',
      message = format('missing DELETE policy qual for %s', p_policyname);
  end if;

  if array_position(v_policy_roles, p_role::name) is null then
    raise exception using
      errcode = 'P0001',
      message = format(
        'DELETE policy %s is not granted to role %s',
        p_policyname,
        p_role
      );
  end if;

  v_sql := format($sql$
    select exists (
      select 1
      from storage.objects
      where bucket_id = %L
        and name = %L
        and (%s)
    )::text
  $sql$, p_bucket_id, p_name, v_policy_qual);

  select *
  into v_exec
  from pg_temp._p18_storage_exec(p_role, p_user_id, v_sql);

  if not coalesce(v_exec.operation_succeeded, false) then
    raise exception using
      errcode = 'P0001',
      message = format(
        'DELETE policy evaluation failed policy=%s sqlstate=%s message=%s sql=%s',
        p_policyname,
        coalesce(v_exec.returned_sqlstate, '<null>'),
        coalesce(v_exec.message_text, '<null>'),
        v_sql
      );
  end if;

  v_actual_result := coalesce(v_exec.value_text, 'false') = 'true';

  if v_actual_result is distinct from p_expected_result then
    raise exception using
      errcode = 'P0001',
      message = format(
        'unexpected DELETE policy result policy=%s bucket=%s name=%s expected=%s actual=%s',
        p_policyname,
        p_bucket_id,
        p_name,
        p_expected_result::text,
        v_actual_result::text
      );
  end if;
end;
$function$;

create or replace function pg_temp._p18_storage_uuid(
  p_state_key text
)
returns uuid
language plpgsql
as $function$
declare
  v_value uuid;
begin
  select state_row.value_uuid
  into v_value
  from pg_temp._p18_storage_state state_row
  where state_row.state_key = p_state_key;

  if v_value is null then
    raise exception using
      errcode = 'P0001',
      message = format('missing uuid state for key %s', p_state_key);
  end if;

  return v_value;
end;
$function$;

create or replace function pg_temp._p18_storage_text(
  p_state_key text
)
returns text
language plpgsql
as $function$
declare
  v_value text;
begin
  select state_row.value_text
  into v_value
  from pg_temp._p18_storage_state state_row
  where state_row.state_key = p_state_key;

  if v_value is null then
    raise exception using
      errcode = 'P0001',
      message = format('missing text state for key %s', p_state_key);
  end if;

  return v_value;
end;
$function$;

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
  v_pattern := format(
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

create or replace function pg_temp._p18_storage_snapshot_acl()
returns text
language sql
as $function$
  select coalesce(
    (
      select jsonb_agg(
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
      )::text
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
        and class_row.relname = 'objects'
    ),
    '[]'
  );
$function$;

create or replace function pg_temp._p18_storage_snapshot_zion_policies()
returns text
language sql
as $function$
  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'policyname', policy_row.policyname,
          'cmd', policy_row.cmd,
          'roles', policy_row.roles,
          'qual', policy_row.qual,
          'with_check', policy_row.with_check
        )
        order by policy_row.policyname, policy_row.cmd
      )::text
      from pg_catalog.pg_policies policy_row
      where policy_row.schemaname = 'storage'
        and policy_row.tablename = 'objects'
        and (
          coalesce(policy_row.qual, '') ilike '%zion-store-files%'
          or coalesce(policy_row.with_check, '') ilike '%zion-store-files%'
        )
    ),
    '[]'
  );
$function$;

create or replace function pg_temp._p18_storage_insert_object(
  p_bucket_id text,
  p_name text,
  p_owner_user_id uuid default null
)
returns text
language plpgsql
as $function$
declare
  v_column record;
  v_columns text[] := array[]::text[];
  v_values text[] := array[]::text[];
  v_sql text;
begin
  for v_column in
    select
      column_row.column_name,
      column_row.data_type,
      column_row.udt_name,
      column_row.is_nullable,
      column_row.column_default,
      column_row.is_generated,
      column_row.generation_expression,
      column_row.is_identity
    from information_schema.columns column_row
    where column_row.table_schema = 'storage'
      and column_row.table_name = 'objects'
    order by column_row.ordinal_position
  loop
    if coalesce(v_column.is_generated, 'NEVER') <> 'NEVER' then
      continue;
    elsif coalesce(v_column.is_identity, 'NO') = 'YES' then
      continue;
    elsif v_column.column_name = 'id' and v_column.column_default is null then
      v_columns := array_append(v_columns, pg_catalog.quote_ident(v_column.column_name));
      v_values := array_append(v_values, 'gen_random_uuid()');
    elsif v_column.column_name = 'bucket_id' then
      v_columns := array_append(v_columns, pg_catalog.quote_ident(v_column.column_name));
      v_values := array_append(v_values, pg_catalog.format('%L', p_bucket_id));
    elsif v_column.column_name = 'name' then
      v_columns := array_append(v_columns, pg_catalog.quote_ident(v_column.column_name));
      v_values := array_append(v_values, pg_catalog.format('%L', p_name));
    elsif v_column.column_name = 'owner' and v_column.column_default is null then
      v_columns := array_append(v_columns, pg_catalog.quote_ident(v_column.column_name));
      if v_column.udt_name = 'uuid' then
        v_values := array_append(v_values, pg_catalog.format('%L::uuid', coalesce(p_owner_user_id, gen_random_uuid())));
      else
        v_values := array_append(v_values, pg_catalog.format('%L', coalesce(p_owner_user_id::text, '')));
      end if;
    elsif v_column.column_name = 'owner_id' and v_column.column_default is null then
      v_columns := array_append(v_columns, pg_catalog.quote_ident(v_column.column_name));
      if v_column.udt_name = 'uuid' then
        v_values := array_append(v_values, pg_catalog.format('%L::uuid', coalesce(p_owner_user_id, gen_random_uuid())));
      else
        v_values := array_append(v_values, pg_catalog.format('%L', coalesce(p_owner_user_id::text, '')));
      end if;
    elsif v_column.column_name in ('metadata', 'user_metadata') and v_column.column_default is null then
      v_columns := array_append(v_columns, pg_catalog.quote_ident(v_column.column_name));
      v_values := array_append(v_values, '''{}''::jsonb');
    elsif v_column.column_name = 'version' and v_column.column_default is null then
      v_columns := array_append(v_columns, pg_catalog.quote_ident(v_column.column_name));
      v_values := array_append(v_values, pg_catalog.format('%L', '1'));
    elsif v_column.column_name in ('created_at', 'updated_at', 'last_accessed_at') and v_column.column_default is null then
      v_columns := array_append(v_columns, pg_catalog.quote_ident(v_column.column_name));
      v_values := array_append(v_values, 'clock_timestamp()');
    elsif v_column.is_nullable = 'NO'
      and v_column.column_default is null
      and v_column.column_name not in ('bucket_id', 'name') then
      raise exception using
        errcode = 'P0001',
        message = format(
          'unsupported required storage.objects column in runner: %s (%s generated=%s identity=%s)',
          v_column.column_name,
          v_column.udt_name,
          coalesce(v_column.is_generated, '<null>'),
          coalesce(v_column.is_identity, '<null>')
        );
    end if;
  end loop;

  if coalesce(array_length(v_columns, 1), 0) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'storage.objects runner could not resolve insertable columns';
  end if;

  v_sql := pg_catalog.format(
    'insert into storage.objects (%s) values (%s)',
    array_to_string(v_columns, ', '),
    array_to_string(v_values, ', ')
  );

  execute v_sql;
  return p_name;
end;
$function$;

do $setup$
declare
  v_run_token text := 'p18_storage_' || replace(gen_random_uuid()::text, '-', '');
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_store_a uuid := gen_random_uuid();
  v_store_b uuid := gen_random_uuid();
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_user_inactive uuid := gen_random_uuid();
  v_pool_path_a text := v_org_a::text || '/' || v_store_a::text || '/pool-seed/seed-a-' || v_run_token || '.jpg';
  v_pool_path_b text := v_org_b::text || '/' || v_store_b::text || '/pool-seed/seed-b-' || v_run_token || '.jpg';
  v_catalog_path_a text := v_org_a::text || '/' || v_store_a::text || '/catalog-seed/seed-a-' || v_run_token || '.jpg';
  v_catalog_path_b text := v_org_b::text || '/' || v_store_b::text || '/catalog-seed/seed-b-' || v_run_token || '.jpg';
  v_import_path_a text := v_org_a::text || '/' || v_store_a::text || '/import-seed/seed-a-' || v_run_token || '.bin';
  v_import_path_b text := v_org_b::text || '/' || v_store_b::text || '/import-seed/seed-b-' || v_run_token || '.bin';
begin
  insert into public.organizations (id, name)
  values
    (v_org_a, 'P18 Storage Org A ' || v_run_token),
    (v_org_b, 'P18 Storage Org B ' || v_run_token);

  insert into public.stores (id, organization_id, name)
  values
    (v_store_a, v_org_a, 'P18 Storage Store A ' || v_run_token),
    (v_store_b, v_org_b, 'P18 Storage Store B ' || v_run_token);

  insert into auth.users (id)
  values
    (v_user_a),
    (v_user_b),
    (v_user_inactive);

  insert into public.memberships (organization_id, user_id, role, is_active)
  values
    (v_org_a, v_user_a, 'owner'::public.app_role, true),
    (v_org_b, v_user_b, 'owner'::public.app_role, true),
    (v_org_a, v_user_inactive, 'owner'::public.app_role, false);

  perform pg_temp._p18_storage_insert_object('pool-photos', v_pool_path_a, v_user_a);
  perform pg_temp._p18_storage_insert_object('pool-photos', v_pool_path_b, v_user_b);
  perform pg_temp._p18_storage_insert_object('store-catalog-photos', v_catalog_path_a, v_user_a);
  perform pg_temp._p18_storage_insert_object('store-catalog-photos', v_catalog_path_b, v_user_b);
  perform pg_temp._p18_storage_insert_object('store-import-files', v_import_path_a, v_user_a);
  perform pg_temp._p18_storage_insert_object('store-import-files', v_import_path_b, v_user_b);

  insert into pg_temp._p18_storage_state (state_key, value_uuid, value_text)
  values
    ('org_a', v_org_a, null),
    ('org_b', v_org_b, null),
    ('store_a', v_store_a, null),
    ('store_b', v_store_b, null),
    ('user_a', v_user_a, null),
    ('user_b', v_user_b, null),
    ('user_inactive', v_user_inactive, null),
    ('pool_path_a', null, v_pool_path_a),
    ('pool_path_b', null, v_pool_path_b),
    ('catalog_path_a', null, v_catalog_path_a),
    ('catalog_path_b', null, v_catalog_path_b),
    ('import_path_a', null, v_import_path_a),
    ('import_path_b', null, v_import_path_b),
    ('run_token', null, v_run_token),
    ('zion_policy_snapshot', null, pg_temp._p18_storage_snapshot_zion_policies()),
    ('storage_acl_snapshot', null, pg_temp._p18_storage_snapshot_acl());
exception
  when others then
    perform pg_temp._p18_storage_record(24, 'HARNESS_ERROR', 'setup failed: ' || sqlerrm);
    raise;
end;
$setup$;

do $scenario_1$
declare
  v_ok boolean;
begin
  select
    exists (
      select 1
      from storage.buckets bucket_row
      where bucket_row.id = 'pool-photos'
        and bucket_row.public is true
    )
    and exists (
      select 1
      from storage.buckets bucket_row
      where bucket_row.id = 'store-catalog-photos'
        and bucket_row.public is true
    )
    and exists (
      select 1
      from storage.buckets bucket_row
      where bucket_row.id = 'store-import-files'
        and bucket_row.public is false
    )
    and exists (
      select 1
      from storage.buckets bucket_row
      where bucket_row.id = 'zion-store-files'
        and bucket_row.public is false
    )
  into v_ok;

  perform pg_temp._p18_storage_require(v_ok, 'bucket public/private flags diverged from the expected contract');
  perform pg_temp._p18_storage_record(1, 'PASS', 'bucket visibility flags match the expected contract');
exception
  when others then
    perform pg_temp._p18_storage_record(1, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_1$;

do $scenario_2$
declare
  v_total integer;
  v_unsafe integer;
begin
  select count(*)
  into v_total
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
    );

  select count(*)
  into v_unsafe
  from pg_catalog.pg_policies policy_row
  where policy_row.schemaname = 'storage'
    and policy_row.tablename = 'objects'
    and policy_row.policyname in (
      'storage_pool_photos_authenticated_insert_tenant',
      'storage_pool_photos_authenticated_delete_tenant',
      'storage_store_catalog_photos_authenticated_insert_tenant',
      'storage_store_catalog_photos_authenticated_delete_tenant',
      'storage_store_import_files_authenticated_select_tenant',
      'storage_store_import_files_authenticated_insert_tenant',
      'storage_store_import_files_authenticated_update_tenant',
      'storage_store_import_files_authenticated_delete_tenant'
    )
    and (
      policy_row.roles <> array['authenticated']::name[]
      or not pg_temp._p18_storage_policy_has_tokens(
        coalesce(policy_row.qual, '') || ' ' || coalesce(policy_row.with_check, ''),
        array[
          'auth.uid()',
          'membership_row.is_active is true',
          'store_row.organization_id = parsed.organization_id'
        ]
      )
      or not pg_temp._p18_storage_policy_has_split_part_segment(
        coalesce(policy_row.qual, '') || ' ' || coalesce(policy_row.with_check, ''),
        1
      )
      or not pg_temp._p18_storage_policy_has_split_part_segment(
        coalesce(policy_row.qual, '') || ' ' || coalesce(policy_row.with_check, ''),
        2
      )
      or not pg_temp._p18_storage_policy_has_nonempty_segment_3(
        coalesce(policy_row.qual, '') || ' ' || coalesce(policy_row.with_check, '')
      )
    );

  perform pg_temp._p18_storage_require(v_total = 10, format('expected 10 focal storage policies, found %s', v_total));
  perform pg_temp._p18_storage_require(v_unsafe = 0, format('found %s focal storage policies with unsafe tenant contract', v_unsafe));
  perform pg_temp._p18_storage_record(2, 'PASS', format('policy_count=%s unsafe_count=%s', v_total, v_unsafe));
exception
  when others then
    perform pg_temp._p18_storage_record(2, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_2$;

do $scenario_3$
declare
  v_bad_count integer;
begin
  select count(*)
  into v_bad_count
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
    and policy_row.roles && array['public', 'anon']::name[];

  perform pg_temp._p18_storage_require(v_bad_count = 0, format('found %s photo mutation policies exposed to public or anon', v_bad_count));
  perform pg_temp._p18_storage_record(3, 'PASS', 'photo buckets expose zero mutation policies to public or anon');
exception
  when others then
    perform pg_temp._p18_storage_record(3, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_3$;

do $scenario_4$
declare
  v_pool_path_a text := pg_temp._p18_storage_text('pool_path_a');
  v_catalog_path_a text := pg_temp._p18_storage_text('catalog_path_a');
begin
  perform pg_temp._p18_storage_assert_success(
    'anon',
    null,
    format($sql$
      select count(*)::text
      from storage.objects
      where bucket_id = 'pool-photos'
        and name = %L
    $sql$, v_pool_path_a),
    '1'
  );

  perform pg_temp._p18_storage_assert_success(
    'anon',
    null,
    format($sql$
      select count(*)::text
      from storage.objects
      where bucket_id = 'store-catalog-photos'
        and name = %L
    $sql$, v_catalog_path_a),
    '1'
  );

  perform pg_temp._p18_storage_record(4, 'PASS', 'public read remains available for pool and catalog photos');
exception
  when others then
    perform pg_temp._p18_storage_record(4, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_4$;

do $scenario_5$
declare
  v_user_a uuid := pg_temp._p18_storage_uuid('user_a');
  v_org_a uuid := pg_temp._p18_storage_uuid('org_a');
  v_store_a uuid := pg_temp._p18_storage_uuid('store_a');
  v_run_token text := pg_temp._p18_storage_text('run_token');
  v_insert_path text := v_org_a::text || '/' || v_store_a::text || '/pool-insert/' || v_run_token || '-insert-a.jpg';
begin
  perform pg_temp._p18_storage_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'pool-photos',
        %L,
        %L::uuid
      )
    $sql$, v_insert_path, v_user_a),
    v_insert_path
  );

  perform pg_temp._p18_storage_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from storage.objects
      where bucket_id = 'pool-photos'
        and name = %L
    $sql$, v_insert_path),
    '1'
  );

  perform pg_temp._p18_storage_record(5, 'PASS', 'user A inserted a pool photo object inside tenant A path');
exception
  when others then
    perform pg_temp._p18_storage_record(5, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_5$;

do $scenario_6$
declare
  v_user_a uuid := pg_temp._p18_storage_uuid('user_a');
  v_org_b uuid := pg_temp._p18_storage_uuid('org_b');
  v_store_b uuid := pg_temp._p18_storage_uuid('store_b');
  v_run_token text := pg_temp._p18_storage_text('run_token');
  v_insert_path text := v_org_b::text || '/' || v_store_b::text || '/pool-foreign/' || v_run_token || '-insert-b.jpg';
begin
  perform pg_temp._p18_storage_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'pool-photos',
        %L,
        %L::uuid
      )
    $sql$, v_insert_path, v_user_a),
    '42501'
  );

  perform pg_temp._p18_storage_record(6, 'PASS', 'user A was blocked from inserting a pool photo into tenant B path');
exception
  when others then
    perform pg_temp._p18_storage_record(6, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_6$;

do $scenario_7$
declare
  v_user_a uuid := pg_temp._p18_storage_uuid('user_a');
  v_org_a uuid := pg_temp._p18_storage_uuid('org_a');
  v_store_a uuid := pg_temp._p18_storage_uuid('store_a');
  v_pool_path_b text := pg_temp._p18_storage_text('pool_path_b');
  v_run_token text := pg_temp._p18_storage_text('run_token');
  v_delete_path text := v_org_a::text || '/' || v_store_a::text || '/pool-delete/' || v_run_token || '-delete-a.jpg';
begin
  perform pg_temp._p18_storage_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'pool-photos',
        %L,
        %L::uuid
      )
    $sql$, v_delete_path, v_user_a),
    v_delete_path
  );

  perform pg_temp._p18_storage_assert_delete_policy_result(
    'storage_pool_photos_authenticated_delete_tenant',
    'pool-photos',
    v_delete_path,
    'authenticated',
    v_user_a,
    true
  );

  perform pg_temp._p18_storage_assert_delete_policy_result(
    'storage_pool_photos_authenticated_delete_tenant',
    'pool-photos',
    v_pool_path_b,
    'authenticated',
    v_user_a,
    false
  );

  perform pg_temp._p18_storage_record(7, 'PASS', 'DELETE policy USING accepted tenant A pool photo for user A and rejected tenant B');
exception
  when others then
    perform pg_temp._p18_storage_record(7, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_7$;

do $scenario_8$
declare
  v_user_a uuid := pg_temp._p18_storage_uuid('user_a');
  v_catalog_path_b text := pg_temp._p18_storage_text('catalog_path_b');
begin
  perform pg_temp._p18_storage_assert_delete_policy_result(
    'storage_store_catalog_photos_authenticated_delete_tenant',
    'store-catalog-photos',
    v_catalog_path_b,
    'authenticated',
    v_user_a,
    false
  );

  perform pg_temp._p18_storage_record(8, 'PASS', 'DELETE policy USING rejected tenant B catalog photo for user A');
exception
  when others then
    perform pg_temp._p18_storage_record(8, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_8$;

do $scenario_9$
declare
  v_user_a uuid := pg_temp._p18_storage_uuid('user_a');
  v_org_a uuid := pg_temp._p18_storage_uuid('org_a');
  v_org_b uuid := pg_temp._p18_storage_uuid('org_b');
  v_store_a uuid := pg_temp._p18_storage_uuid('store_a');
  v_store_b uuid := pg_temp._p18_storage_uuid('store_b');
  v_run_token text := pg_temp._p18_storage_text('run_token');
  v_insert_path_a text := v_org_a::text || '/' || v_store_a::text || '/catalog-insert/' || v_run_token || '-insert-a.jpg';
  v_insert_path_b text := v_org_b::text || '/' || v_store_b::text || '/catalog-insert/' || v_run_token || '-insert-b.jpg';
begin
  perform pg_temp._p18_storage_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'store-catalog-photos',
        %L,
        %L::uuid
      )
    $sql$, v_insert_path_a, v_user_a),
    v_insert_path_a
  );

  perform pg_temp._p18_storage_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'store-catalog-photos',
        %L,
        %L::uuid
      )
    $sql$, v_insert_path_b, v_user_a),
    '42501'
  );

  perform pg_temp._p18_storage_assert_delete_policy_result(
    'storage_store_catalog_photos_authenticated_delete_tenant',
    'store-catalog-photos',
    v_insert_path_a,
    'authenticated',
    v_user_a,
    true
  );

  perform pg_temp._p18_storage_assert_delete_policy_result(
    'storage_store_catalog_photos_authenticated_delete_tenant',
    'store-catalog-photos',
    pg_temp._p18_storage_text('catalog_path_b'),
    'authenticated',
    v_user_a,
    false
  );

  perform pg_temp._p18_storage_record(9, 'PASS', 'catalog photos still block foreign insert and DELETE policy USING accepts own tenant while rejecting foreign tenant');
exception
  when others then
    perform pg_temp._p18_storage_record(9, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_9$;

do $scenario_10$
declare
  v_user_a uuid := pg_temp._p18_storage_uuid('user_a');
  v_import_path_a text := pg_temp._p18_storage_text('import_path_a');
begin
  perform pg_temp._p18_storage_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from storage.objects
      where bucket_id = 'store-import-files'
        and name = %L
    $sql$, v_import_path_a),
    '1'
  );

  perform pg_temp._p18_storage_record(10, 'PASS', 'authenticated user A can read the own store-import-files object');
exception
  when others then
    perform pg_temp._p18_storage_record(10, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_10$;

do $scenario_11$
declare
  v_user_a uuid := pg_temp._p18_storage_uuid('user_a');
  v_import_path_b text := pg_temp._p18_storage_text('import_path_b');
begin
  perform pg_temp._p18_storage_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select count(*)::text
      from storage.objects
      where bucket_id = 'store-import-files'
        and name = %L
    $sql$, v_import_path_b),
    '0'
  );

  perform pg_temp._p18_storage_record(11, 'PASS', 'authenticated user A cannot read tenant B store-import-files objects');
exception
  when others then
    perform pg_temp._p18_storage_record(11, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_11$;

do $scenario_12$
declare
  v_user_a uuid := pg_temp._p18_storage_uuid('user_a');
  v_org_a uuid := pg_temp._p18_storage_uuid('org_a');
  v_store_a uuid := pg_temp._p18_storage_uuid('store_a');
  v_run_token text := pg_temp._p18_storage_text('run_token');
  v_insert_path text := v_org_a::text || '/' || v_store_a::text || '/import-insert/' || v_run_token || '-insert-a.bin';
begin
  perform pg_temp._p18_storage_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'store-import-files',
        %L,
        %L::uuid
      )
    $sql$, v_insert_path, v_user_a),
    v_insert_path
  );

  perform pg_temp._p18_storage_record(12, 'PASS', 'authenticated user A can insert a store-import-files object inside tenant A path');
exception
  when others then
    perform pg_temp._p18_storage_record(12, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_12$;

do $scenario_13$
declare
  v_user_a uuid := pg_temp._p18_storage_uuid('user_a');
  v_org_b uuid := pg_temp._p18_storage_uuid('org_b');
  v_store_b uuid := pg_temp._p18_storage_uuid('store_b');
  v_run_token text := pg_temp._p18_storage_text('run_token');
  v_insert_path text := v_org_b::text || '/' || v_store_b::text || '/import-foreign/' || v_run_token || '-insert-b.bin';
begin
  perform pg_temp._p18_storage_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'store-import-files',
        %L,
        %L::uuid
      )
    $sql$, v_insert_path, v_user_a),
    '42501'
  );

  perform pg_temp._p18_storage_record(13, 'PASS', 'authenticated user A is blocked from inserting store-import-files into tenant B path');
exception
  when others then
    perform pg_temp._p18_storage_record(13, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_13$;

do $scenario_14$
declare
  v_user_a uuid := pg_temp._p18_storage_uuid('user_a');
  v_org_a uuid := pg_temp._p18_storage_uuid('org_a');
  v_store_a uuid := pg_temp._p18_storage_uuid('store_a');
  v_run_token text := pg_temp._p18_storage_text('run_token');
  v_original_path text := v_org_a::text || '/' || v_store_a::text || '/import-update/' || v_run_token || '-before.bin';
  v_updated_path text := v_org_a::text || '/' || v_store_a::text || '/import-update/' || v_run_token || '-after.bin';
begin
  perform pg_temp._p18_storage_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'store-import-files',
        %L,
        %L::uuid
      )
    $sql$, v_original_path, v_user_a),
    v_original_path
  );

  perform pg_temp._p18_storage_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update storage.objects
        set name = %L
        where bucket_id = 'store-import-files'
          and name = %L
        returning name
      )
      select count(*)::text from updated
    $sql$, v_updated_path, v_original_path),
    '1'
  );

  perform pg_temp._p18_storage_record(14, 'PASS', 'authenticated user A can update a store-import-files object inside the same tenant');
exception
  when others then
    perform pg_temp._p18_storage_record(14, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_14$;

do $scenario_15$
declare
  v_user_a uuid := pg_temp._p18_storage_uuid('user_a');
  v_org_a uuid := pg_temp._p18_storage_uuid('org_a');
  v_org_b uuid := pg_temp._p18_storage_uuid('org_b');
  v_store_a uuid := pg_temp._p18_storage_uuid('store_a');
  v_store_b uuid := pg_temp._p18_storage_uuid('store_b');
  v_run_token text := pg_temp._p18_storage_text('run_token');
  v_original_path text := v_org_a::text || '/' || v_store_a::text || '/import-pivot/' || v_run_token || '-before.bin';
  v_pivot_path text := v_org_b::text || '/' || v_store_b::text || '/import-pivot/' || v_run_token || '-after.bin';
begin
  perform pg_temp._p18_storage_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'store-import-files',
        %L,
        %L::uuid
      )
    $sql$, v_original_path, v_user_a),
    v_original_path
  );

  perform pg_temp._p18_storage_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      update storage.objects
      set name = %L
      where bucket_id = 'store-import-files'
        and name = %L
    $sql$, v_pivot_path, v_original_path),
    '42501'
  );

  perform pg_temp._p18_storage_record(15, 'PASS', 'store-import-files update cannot pivot an object into tenant B path');
exception
  when others then
    perform pg_temp._p18_storage_record(15, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_15$;

do $scenario_16$
declare
  v_user_a uuid := pg_temp._p18_storage_uuid('user_a');
  v_org_a uuid := pg_temp._p18_storage_uuid('org_a');
  v_store_a uuid := pg_temp._p18_storage_uuid('store_a');
  v_run_token text := pg_temp._p18_storage_text('run_token');
  v_delete_path text := v_org_a::text || '/' || v_store_a::text || '/import-delete/' || v_run_token || '-delete-a.bin';
begin
  perform pg_temp._p18_storage_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'store-import-files',
        %L,
        %L::uuid
      )
    $sql$, v_delete_path, v_user_a),
    v_delete_path
  );

  perform pg_temp._p18_storage_assert_delete_policy_result(
    'storage_store_import_files_authenticated_delete_tenant',
    'store-import-files',
    v_delete_path,
    'authenticated',
    v_user_a,
    true
  );

  perform pg_temp._p18_storage_record(16, 'PASS', 'DELETE policy USING accepted the own store-import-files object for user A');
exception
  when others then
    perform pg_temp._p18_storage_record(16, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_16$;

do $scenario_17$
declare
  v_user_a uuid := pg_temp._p18_storage_uuid('user_a');
  v_import_path_b text := pg_temp._p18_storage_text('import_path_b');
begin
  perform pg_temp._p18_storage_assert_delete_policy_result(
    'storage_store_import_files_authenticated_delete_tenant',
    'store-import-files',
    v_import_path_b,
    'authenticated',
    v_user_a,
    false
  );

  perform pg_temp._p18_storage_record(17, 'PASS', 'DELETE policy USING rejected tenant B store-import-files object for user A');
exception
  when others then
    perform pg_temp._p18_storage_record(17, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_17$;

do $scenario_18$
declare
  v_user_inactive uuid := pg_temp._p18_storage_uuid('user_inactive');
  v_org_a uuid := pg_temp._p18_storage_uuid('org_a');
  v_store_a uuid := pg_temp._p18_storage_uuid('store_a');
  v_run_token text := pg_temp._p18_storage_text('run_token');
begin
  perform pg_temp._p18_storage_assert_success(
    'authenticated',
    v_user_inactive,
    format($sql$
      select count(*)::text
      from storage.objects
      where bucket_id = 'store-import-files'
        and name = %L
    $sql$, pg_temp._p18_storage_text('import_path_a')),
    '0'
  );

  perform pg_temp._p18_storage_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'pool-photos',
        %L,
        %L::uuid
      )
    $sql$, v_org_a::text || '/' || v_store_a::text || '/inactive/' || v_run_token || '.jpg', v_user_inactive),
    '42501'
  );

  perform pg_temp._p18_storage_assert_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'store-catalog-photos',
        %L,
        %L::uuid
      )
    $sql$, v_org_a::text || '/' || v_store_a::text || '/inactive/' || v_run_token || '.jpg', v_user_inactive),
    '42501'
  );

  perform pg_temp._p18_storage_record(18, 'PASS', 'inactive membership fail-closes across the 3 buckets');
exception
  when others then
    perform pg_temp._p18_storage_record(18, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_18$;

do $scenario_19$
declare
  v_user_a uuid := pg_temp._p18_storage_uuid('user_a');
  v_store_a uuid := pg_temp._p18_storage_uuid('store_a');
  v_run_token text := pg_temp._p18_storage_text('run_token');
begin
  perform pg_temp._p18_storage_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'pool-photos',
        %L,
        %L::uuid
      )
    $sql$, 'not-a-uuid/' || v_store_a::text || '/invalid-org/' || v_run_token || '.jpg', v_user_a),
    '42501'
  );

  perform pg_temp._p18_storage_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'store-catalog-photos',
        %L,
        %L::uuid
      )
    $sql$, 'not-a-uuid/' || v_store_a::text || '/invalid-org/' || v_run_token || '.jpg', v_user_a),
    '42501'
  );

  perform pg_temp._p18_storage_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'store-import-files',
        %L,
        %L::uuid
      )
    $sql$, 'not-a-uuid/' || v_store_a::text || '/invalid-org/' || v_run_token || '.bin', v_user_a),
    '42501'
  );

  perform pg_temp._p18_storage_record(19, 'PASS', 'invalid organization path is rejected across the 3 buckets');
exception
  when others then
    perform pg_temp._p18_storage_record(19, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_19$;

do $scenario_20$
declare
  v_user_a uuid := pg_temp._p18_storage_uuid('user_a');
  v_org_a uuid := pg_temp._p18_storage_uuid('org_a');
  v_run_token text := pg_temp._p18_storage_text('run_token');
begin
  perform pg_temp._p18_storage_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'pool-photos',
        %L,
        %L::uuid
      )
    $sql$, v_org_a::text || '/not-a-uuid/invalid-store/' || v_run_token || '.jpg', v_user_a),
    '42501'
  );

  perform pg_temp._p18_storage_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'store-catalog-photos',
        %L,
        %L::uuid
      )
    $sql$, v_org_a::text || '/not-a-uuid/invalid-store/' || v_run_token || '.jpg', v_user_a),
    '42501'
  );

  perform pg_temp._p18_storage_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'store-import-files',
        %L,
        %L::uuid
      )
    $sql$, v_org_a::text || '/not-a-uuid/invalid-store/' || v_run_token || '.bin', v_user_a),
    '42501'
  );

  perform pg_temp._p18_storage_record(20, 'PASS', 'invalid store path is rejected across the 3 buckets');
exception
  when others then
    perform pg_temp._p18_storage_record(20, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_20$;

do $scenario_21$
declare
  v_user_a uuid := pg_temp._p18_storage_uuid('user_a');
  v_org_a uuid := pg_temp._p18_storage_uuid('org_a');
  v_store_b uuid := pg_temp._p18_storage_uuid('store_b');
  v_run_token text := pg_temp._p18_storage_text('run_token');
begin
  perform pg_temp._p18_storage_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'pool-photos',
        %L,
        %L::uuid
      )
    $sql$, v_org_a::text || '/' || v_store_b::text || '/mismatch/' || v_run_token || '.jpg', v_user_a),
    '42501'
  );

  perform pg_temp._p18_storage_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'store-catalog-photos',
        %L,
        %L::uuid
      )
    $sql$, v_org_a::text || '/' || v_store_b::text || '/mismatch/' || v_run_token || '.jpg', v_user_a),
    '42501'
  );

  perform pg_temp._p18_storage_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      select pg_temp._p18_storage_insert_object(
        'store-import-files',
        %L,
        %L::uuid
      )
    $sql$, v_org_a::text || '/' || v_store_b::text || '/mismatch/' || v_run_token || '.bin', v_user_a),
    '42501'
  );

  perform pg_temp._p18_storage_record(21, 'PASS', 'store path from another organization is rejected across the 3 buckets');
exception
  when others then
    perform pg_temp._p18_storage_record(21, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_21$;

do $scenario_22$
declare
  v_snapshot_before text := pg_temp._p18_storage_text('zion_policy_snapshot');
  v_snapshot_after text;
  v_non_service_role_count integer;
begin
  select pg_temp._p18_storage_snapshot_zion_policies()
  into v_snapshot_after;

  select count(*)
  into v_non_service_role_count
  from pg_catalog.pg_policies policy_row
  where policy_row.schemaname = 'storage'
    and policy_row.tablename = 'objects'
    and (
      coalesce(policy_row.qual, '') ilike '%zion-store-files%'
      or coalesce(policy_row.with_check, '') ilike '%zion-store-files%'
    )
    and policy_row.roles <> array['service_role']::name[];

  perform pg_temp._p18_storage_require(v_snapshot_before = v_snapshot_after, 'zion-store-files policy snapshot changed during the runner');
  perform pg_temp._p18_storage_require(v_non_service_role_count = 0, format('found %s zion-store-files policies outside service_role', v_non_service_role_count));
  perform pg_temp._p18_storage_record(22, 'PASS', 'zion-store-files remains service-role-only and untouched inside the runner');
exception
  when others then
    perform pg_temp._p18_storage_record(22, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_22$;

do $scenario_23$
declare
  v_snapshot_before text := pg_temp._p18_storage_text('storage_acl_snapshot');
  v_snapshot_after text;
  v_authenticated_crud_ok boolean;
begin
  select pg_temp._p18_storage_snapshot_acl()
  into v_snapshot_after;

  select
    has_table_privilege('authenticated', 'storage.objects', 'SELECT')
    and has_table_privilege('authenticated', 'storage.objects', 'INSERT')
    and has_table_privilege('authenticated', 'storage.objects', 'UPDATE')
    and has_table_privilege('authenticated', 'storage.objects', 'DELETE')
    and has_table_privilege('service_role', 'storage.objects', 'SELECT')
    and has_table_privilege('service_role', 'storage.objects', 'INSERT')
    and has_table_privilege('service_role', 'storage.objects', 'UPDATE')
    and has_table_privilege('service_role', 'storage.objects', 'DELETE')
  into v_authenticated_crud_ok;

  perform pg_temp._p18_storage_require(v_snapshot_before = v_snapshot_after, 'storage.objects ACL snapshot changed during the runner');
  perform pg_temp._p18_storage_require(v_authenticated_crud_ok, 'expected shared global CRUD grants on storage.objects were not present');
  perform pg_temp._p18_storage_record(23, 'PASS', 'storage.objects ACL remains stable inside the runner and enforcement stays bucket-policy based');
exception
  when others then
    perform pg_temp._p18_storage_record(23, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_23$;

do $scenario_24$
declare
  v_run_token text := pg_temp._p18_storage_text('run_token');
  v_fixture_count integer;
begin
  select count(*)
  into v_fixture_count
  from (
    select 1
    from public.organizations
    where name = 'P18 Storage Org A ' || v_run_token
    union all
    select 1
    from public.organizations
    where name = 'P18 Storage Org B ' || v_run_token
    union all
    select 1
    from storage.objects
    where name = pg_temp._p18_storage_text('pool_path_a')
    union all
    select 1
    from storage.objects
    where name = pg_temp._p18_storage_text('pool_path_b')
    union all
    select 1
    from storage.objects
    where name = pg_temp._p18_storage_text('catalog_path_a')
    union all
    select 1
    from storage.objects
    where name = pg_temp._p18_storage_text('catalog_path_b')
    union all
    select 1
    from storage.objects
    where name = pg_temp._p18_storage_text('import_path_a')
    union all
    select 1
    from storage.objects
    where name = pg_temp._p18_storage_text('import_path_b')
  ) fixture_rows;

  perform pg_temp._p18_storage_require(length(v_run_token) > 20, 'run token is unexpectedly short');
  perform pg_temp._p18_storage_require(v_fixture_count = 8, format('expected 8 fixture signatures, found %s', v_fixture_count));
  perform pg_temp._p18_storage_record(24, 'PASS', 'fixtures remain isolated in the transaction and final cleanup is delegated to the rollback');
exception
  when others then
    perform pg_temp._p18_storage_record(24, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_24$;

select
  result_row.scenario_number,
  result_row.scenario_name,
  result_row.status,
  result_row.details
from pg_temp._p18_storage_results result_row
order by result_row.scenario_number;

with scenario_summary as (
  select
    count(*) as total_scenarios,
    count(*) filter (where status = 'PASS') as passed_scenarios,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'scenario_number', scenario_number,
          'scenario_name', scenario_name,
          'status', status,
          'details', details
        )
        order by scenario_number
      ) filter (where status <> 'PASS'),
      '[]'::jsonb
    ) as failed_scenarios
  from pg_temp._p18_storage_results
)
select
  case
    when scenario_summary.total_scenarios <> 24 then 'AINDA_NAO_APROVADA'
    when scenario_summary.passed_scenarios <> 24 then 'AINDA_NAO_APROVADA'
    else 'APROVADA'
  end as final_status,
  scenario_summary.passed_scenarios,
  scenario_summary.total_scenarios,
  scenario_summary.failed_scenarios
from scenario_summary;

rollback;
