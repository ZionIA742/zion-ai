begin;

create temp table pg_temp._p18_catalog_import_matrix (
  scenario_number integer primary key,
  scenario_name text not null
);

insert into pg_temp._p18_catalog_import_matrix (
  scenario_number,
  scenario_name
)
values
  (1, 'rls ativa nas sete tabelas'),
  (2, 'policies finais sao seguras e apontam so para authenticated'),
  (3, 'anon sem privilegios nas sete tabelas'),
  (4, 'authenticated tem apenas crud nas seis tabelas de acesso direto'),
  (5, 'authenticated segue sem acesso a store_import_media_assets'),
  (6, 'clientes seguem sem truncate trigger references'),
  (7, 'leitura direta de memberships e stores funciona no contexto authenticated'),
  (8, 'crud real no proprio tenant funciona nas tabelas principais'),
  (9, 'operacoes cross-tenant falham ou ficam invisiveis nas tabelas principais'),
  (10, 'crud real no proprio tenant funciona nas tabelas filhas'),
  (11, 'filhas bloqueiam parent swap e delete cross-tenant'),
  (12, 'pool_photos exige coerencia entre colunas do filho e o pai'),
  (13, 'service_role executa crud real com rollback'),
  (14, 'fixtures sinteticas usam chaves exclusivas na transacao');

create temp table pg_temp._p18_catalog_import_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  details text not null
);

create temp table pg_temp._p18_catalog_import_state (
  state_key text primary key,
  value_uuid uuid null,
  value_text text null
) on commit drop;

create or replace function pg_temp._p18_catalog_import_record(
  p_scenario_number integer,
  p_status text,
  p_details text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p18_catalog_import_results (
    scenario_number,
    scenario_name,
    status,
    details
  )
  values (
    p_scenario_number,
    (
      select matrix_row.scenario_name
      from pg_temp._p18_catalog_import_matrix matrix_row
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

create or replace function pg_temp._p18_catalog_import_require(
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

create or replace function pg_temp._p18_catalog_import_set_auth(
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
  end if;
end;
$function$;

create or replace function pg_temp._p18_catalog_import_reset_auth()
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

create or replace function pg_temp._p18_catalog_import_exec(
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
  perform pg_temp._p18_catalog_import_set_auth(p_role, p_user_id);

  begin
    execute p_sql into v_value;
    perform pg_temp._p18_catalog_import_reset_auth();

    return query
    select true, v_value, null::text, null::text;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;

      perform pg_temp._p18_catalog_import_reset_auth();

      return query
      select false, null::text, v_state, v_message;
  end;
end;
$function$;

create or replace function pg_temp._p18_catalog_import_uuid(
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
  from pg_temp._p18_catalog_import_state state_row
  where state_row.state_key = p_state_key;

  if v_value is null then
    raise exception using
      errcode = 'P0001',
      message = format('missing uuid state for key %s', p_state_key);
  end if;

  return v_value;
end;
$function$;

create or replace function pg_temp._p18_catalog_import_text(
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
  from pg_temp._p18_catalog_import_state state_row
  where state_row.state_key = p_state_key;

  if v_value is null then
    raise exception using
      errcode = 'P0001',
      message = format('missing text state for key %s', p_state_key);
  end if;

  return v_value;
end;
$function$;

create or replace function pg_temp._p18_catalog_import_assert_success(
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
  from pg_temp._p18_catalog_import_exec(p_role, p_user_id, p_sql);

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

create or replace function pg_temp._p18_catalog_import_assert_failure(
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
  from pg_temp._p18_catalog_import_exec(p_role, p_user_id, p_sql);

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

do $setup$
declare
  v_run_id uuid := gen_random_uuid();
  v_run_token text := 'p18_catalog_' || replace(gen_random_uuid()::text, '-', '');
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_store_a uuid := gen_random_uuid();
  v_store_b uuid := gen_random_uuid();
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_catalog_item_a uuid := gen_random_uuid();
  v_catalog_item_b uuid := gen_random_uuid();
  v_import_file_a uuid := gen_random_uuid();
  v_import_file_b uuid := gen_random_uuid();
  v_pool_a uuid := gen_random_uuid();
  v_pool_b uuid := gen_random_uuid();
  v_catalog_photo_a uuid := gen_random_uuid();
  v_catalog_photo_b uuid := gen_random_uuid();
  v_pool_photo_a uuid := gen_random_uuid();
  v_pool_photo_b uuid := gen_random_uuid();
  v_import_file_item_a uuid := gen_random_uuid();
  v_import_file_item_b uuid := gen_random_uuid();
  v_media_asset_a uuid := gen_random_uuid();
begin
  insert into public.organizations (id, name)
  values
    (v_org_a, 'P18 Catalog Org A ' || v_run_token),
    (v_org_b, 'P18 Catalog Org B ' || v_run_token);

  insert into public.stores (id, organization_id, name)
  values
    (v_store_a, v_org_a, 'P18 Catalog Store A ' || v_run_token),
    (v_store_b, v_org_b, 'P18 Catalog Store B ' || v_run_token);

  insert into auth.users (id)
  values
    (v_user_a),
    (v_user_b);

  insert into public.memberships (organization_id, user_id, role, is_active)
  values
    (v_org_a, v_user_a, 'owner', true),
    (v_org_b, v_user_b, 'owner', true);

  insert into public.store_catalog_items (
    id,
    organization_id,
    store_id,
    sku,
    name,
    description,
    price_cents,
    price_status,
    currency,
    is_active,
    track_stock,
    stock_quantity,
    stock_status,
    metadata
  )
  values
    (
      v_catalog_item_a,
      v_org_a,
      v_store_a,
      'SKU-A-' || left(v_run_token, 12),
      'Catalog A ' || v_run_token,
      'Fixture item A',
      1000,
      'valid',
      'BRL',
      true,
      false,
      null,
      'not_tracked',
      jsonb_build_object('runner', v_run_token)
    ),
    (
      v_catalog_item_b,
      v_org_b,
      v_store_b,
      'SKU-B-' || left(v_run_token, 12),
      'Catalog B ' || v_run_token,
      'Fixture item B',
      2000,
      'valid',
      'BRL',
      true,
      false,
      null,
      'not_tracked',
      jsonb_build_object('runner', v_run_token)
    );

  insert into public.pools (
    id,
    organization_id,
    store_id,
    name,
    width_m,
    length_m,
    depth_m,
    shape,
    material,
    max_capacity_l,
    weight_kg,
    price,
    price_status,
    description,
    is_active,
    track_stock,
    stock_quantity,
    stock_status
  )
  values
    (
      v_pool_a,
      v_org_a,
      v_store_a,
      'Pool A ' || v_run_token,
      2,
      3,
      1,
      'retangular',
      'vinil',
      1000,
      200,
      5000,
      'valid',
      'Fixture pool A',
      true,
      false,
      null,
      'not_tracked'
    ),
    (
      v_pool_b,
      v_org_b,
      v_store_b,
      'Pool B ' || v_run_token,
      2,
      3,
      1,
      'retangular',
      'vinil',
      1000,
      200,
      6000,
      'valid',
      'Fixture pool B',
      true,
      false,
      null,
      'not_tracked'
    );

  insert into public.store_import_files (
    id,
    organization_id,
    store_id,
    source,
    original_file_name,
    mime_type,
    extension,
    size_bytes,
    storage_bucket,
    storage_path,
    import_summary,
    status,
    import_batch_id,
    file_hash
  )
  values
    (
      v_import_file_a,
      v_org_a,
      v_store_a,
      'runner',
      'seed-a-' || v_run_token || '.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'xlsx',
      123,
      'store-import-files',
      v_org_a::text || '/' || v_store_a::text || '/' || v_run_token || '-seed-a.xlsx',
      jsonb_build_object('runner', v_run_token),
      'active',
      gen_random_uuid(),
      null
    ),
    (
      v_import_file_b,
      v_org_b,
      v_store_b,
      'runner',
      'seed-b-' || v_run_token || '.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'xlsx',
      456,
      'store-import-files',
      v_org_b::text || '/' || v_store_b::text || '/' || v_run_token || '-seed-b.xlsx',
      jsonb_build_object('runner', v_run_token),
      'active',
      gen_random_uuid(),
      null
    );

  insert into public.store_catalog_item_photos (
    id,
    catalog_item_id,
    file_name,
    file_size_bytes,
    sort_order,
    storage_path
  )
  values
    (
      v_catalog_photo_a,
      v_catalog_item_a,
      'seed-catalog-a-' || v_run_token || '.jpg',
      100,
      0,
      v_org_a::text || '/' || v_store_a::text || '/' || v_run_token || '-catalog-a.jpg'
    ),
    (
      v_catalog_photo_b,
      v_catalog_item_b,
      'seed-catalog-b-' || v_run_token || '.jpg',
      100,
      0,
      v_org_b::text || '/' || v_store_b::text || '/' || v_run_token || '-catalog-b.jpg'
    );

  insert into public.pool_photos (
    id,
    organization_id,
    store_id,
    pool_id,
    file_name,
    file_size_bytes,
    sort_order,
    storage_path
  )
  values
    (
      v_pool_photo_a,
      v_org_a,
      v_store_a,
      v_pool_a,
      'seed-pool-a-' || v_run_token || '.jpg',
      100,
      0,
      v_org_a::text || '/' || v_store_a::text || '/' || v_run_token || '-pool-a.jpg'
    ),
    (
      v_pool_photo_b,
      v_org_b,
      v_store_b,
      v_pool_b,
      'seed-pool-b-' || v_run_token || '.jpg',
      100,
      0,
      v_org_b::text || '/' || v_store_b::text || '/' || v_run_token || '-pool-b.jpg'
    );

  insert into public.store_import_file_items (
    id,
    import_file_id,
    organization_id,
    store_id,
    destination_type,
    destination_table,
    destination_item_id
  )
  values
    (
      v_import_file_item_a,
      v_import_file_a,
      v_org_a,
      v_store_a,
      'catalog_item',
      'store_catalog_items',
      v_catalog_item_a
    ),
    (
      v_import_file_item_b,
      v_import_file_b,
      v_org_b,
      v_store_b,
      'pool',
      'pools',
      v_pool_b
    );

  insert into public.store_import_media_assets (
    id,
    organization_id,
    store_id,
    import_batch_id,
    import_file_id,
    source_file_name,
    source_kind,
    source_location_key,
    association_strength,
    status,
    file_name,
    size_bytes,
    normalized_mime_type,
    original_mime_type,
    storage_bucket,
    storage_path,
    metadata
  )
  values
    (
      v_media_asset_a,
      v_org_a,
      v_store_a,
      gen_random_uuid(),
      v_import_file_a,
      'seed-a-' || v_run_token || '.xlsx',
      'xlsx_row_image',
      'row:1:image:1',
      'strong_auto',
      'staged',
      'asset-a-' || v_run_token || '.jpg',
      100,
      'image/jpeg',
      'image/jpeg',
      'store-import-files',
      v_org_a::text || '/' || v_store_a::text || '/' || v_run_token || '-asset-a.jpg',
      jsonb_build_object('runner', v_run_token)
    );

  insert into pg_temp._p18_catalog_import_state (state_key, value_uuid, value_text) values
    ('run_id', v_run_id, null),
    ('org_a', v_org_a, null),
    ('org_b', v_org_b, null),
    ('store_a', v_store_a, null),
    ('store_b', v_store_b, null),
    ('user_a', v_user_a, null),
    ('user_b', v_user_b, null),
    ('catalog_item_a', v_catalog_item_a, null),
    ('catalog_item_b', v_catalog_item_b, null),
    ('import_file_a', v_import_file_a, null),
    ('import_file_b', v_import_file_b, null),
    ('pool_a', v_pool_a, null),
    ('pool_b', v_pool_b, null),
    ('catalog_photo_a', v_catalog_photo_a, null),
    ('catalog_photo_b', v_catalog_photo_b, null),
    ('pool_photo_a', v_pool_photo_a, null),
    ('pool_photo_b', v_pool_photo_b, null),
    ('import_file_item_a', v_import_file_item_a, null),
    ('import_file_item_b', v_import_file_item_b, null),
    ('media_asset_a', v_media_asset_a, null),
    ('run_token', null, v_run_token);
exception
  when others then
    perform pg_temp._p18_catalog_import_record(14, 'HARNESS_ERROR', 'setup failed: ' || sqlerrm);
    raise;
end;
$setup$;

do $scenario_1$
declare
  v_ok boolean;
begin
  select bool_and(class_row.relrowsecurity)
  into v_ok
  from pg_catalog.pg_class class_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = class_row.relnamespace
  where namespace_row.nspname = 'public'
    and class_row.relname in (
      'store_catalog_items',
      'store_catalog_item_photos',
      'store_import_files',
      'store_import_file_items',
      'store_import_media_assets',
      'pools',
      'pool_photos'
    );

  perform pg_temp._p18_catalog_import_require(v_ok, 'one or more target tables do not have rls enabled');
  perform pg_temp._p18_catalog_import_record(1, 'PASS', 'all seven target tables report relrowsecurity=true');
exception
  when others then
    perform pg_temp._p18_catalog_import_record(1, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_1$;

do $scenario_2$
declare
  v_total integer;
  v_unsafe integer;
  v_media_asset_policy_count integer;
begin
  select count(*)
  into v_total
  from pg_catalog.pg_policies policy_row
  where policy_row.schemaname = 'public'
    and policy_row.tablename in (
      'store_catalog_items',
      'store_catalog_item_photos',
      'store_import_files',
      'store_import_file_items',
      'pools',
      'pool_photos'
    );

  select count(*)
  into v_unsafe
  from pg_catalog.pg_policies policy_row
  where policy_row.schemaname = 'public'
    and policy_row.tablename in (
      'store_catalog_items',
      'store_catalog_item_photos',
      'store_import_files',
      'store_import_file_items',
      'pools',
      'pool_photos'
    )
    and (
      policy_row.roles <> array['authenticated']::name[]
      or coalesce(policy_row.qual, '') ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      or coalesce(policy_row.with_check, '') ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      or lower(pg_catalog.btrim(coalesce(policy_row.qual, ''))) = 'true'
      or lower(pg_catalog.btrim(coalesce(policy_row.with_check, ''))) = 'true'
      or policy_row.roles @> array['public']::name[]
    );

  select count(*)
  into v_media_asset_policy_count
  from pg_catalog.pg_policies policy_row
  where policy_row.schemaname = 'public'
    and policy_row.tablename = 'store_import_media_assets';

  perform pg_temp._p18_catalog_import_require(v_total = 24, format('expected 24 policies on six scoped tables, found %s', v_total));
  perform pg_temp._p18_catalog_import_require(v_unsafe = 0, format('found %s unsafe or mis-scoped policies', v_unsafe));
  perform pg_temp._p18_catalog_import_require(v_media_asset_policy_count = 0, format('store_import_media_assets should finish with 0 client policies, found %s', v_media_asset_policy_count));
  perform pg_temp._p18_catalog_import_record(2, 'PASS', format('policy_count=%s unsafe_count=%s media_asset_policy_count=%s', v_total, v_unsafe, v_media_asset_policy_count));
exception
  when others then
    perform pg_temp._p18_catalog_import_record(2, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_2$;

do $scenario_3$
declare
  v_anon_ok boolean;
  v_public_ok boolean;
begin
  select bool_and(
    not has_table_privilege('anon', pg_catalog.format('public.%I', table_name), 'SELECT')
    and not has_table_privilege('anon', pg_catalog.format('public.%I', table_name), 'INSERT')
    and not has_table_privilege('anon', pg_catalog.format('public.%I', table_name), 'UPDATE')
    and not has_table_privilege('anon', pg_catalog.format('public.%I', table_name), 'DELETE')
    and not has_table_privilege('anon', pg_catalog.format('public.%I', table_name), 'TRUNCATE')
    and not has_table_privilege('anon', pg_catalog.format('public.%I', table_name), 'TRIGGER')
    and not has_table_privilege('anon', pg_catalog.format('public.%I', table_name), 'REFERENCES')
  )
  into v_anon_ok
  from (
    values
      ('store_catalog_items'),
      ('store_catalog_item_photos'),
      ('store_import_files'),
      ('store_import_file_items'),
      ('store_import_media_assets'),
      ('pools'),
      ('pool_photos')
  ) as target(table_name);

  select bool_and(
    not exists (
      select 1
      from pg_catalog.pg_class class_row
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = class_row.relnamespace
      join lateral pg_catalog.aclexplode(coalesce(class_row.relacl, pg_catalog.acldefault('r', class_row.relowner))) acl_row
        on true
      where namespace_row.nspname = 'public'
        and class_row.relname = target.table_name
        and class_row.relkind in ('r', 'p')
        and acl_row.grantee = 0
        and acl_row.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    )
  )
  into v_public_ok
  from (
    values
      ('store_catalog_items'),
      ('store_catalog_item_photos'),
      ('store_import_files'),
      ('store_import_file_items'),
      ('store_import_media_assets'),
      ('pools'),
      ('pool_photos')
  ) as target(table_name);

  perform pg_temp._p18_catalog_import_require(v_anon_ok, 'anon still has privileges on one or more target tables');
  perform pg_temp._p18_catalog_import_require(v_public_ok, 'PUBLIC still has privileges on one or more target tables');
  perform pg_temp._p18_catalog_import_record(3, 'PASS', 'anon and PUBLIC have no table privileges on target tables');
exception
  when others then
    perform pg_temp._p18_catalog_import_record(3, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_3$;

do $scenario_4$
declare
  v_ok boolean;
begin
  select bool_and(
    has_table_privilege('authenticated', pg_catalog.format('public.%I', table_name), 'SELECT')
    and has_table_privilege('authenticated', pg_catalog.format('public.%I', table_name), 'INSERT')
    and has_table_privilege('authenticated', pg_catalog.format('public.%I', table_name), 'UPDATE')
    and has_table_privilege('authenticated', pg_catalog.format('public.%I', table_name), 'DELETE')
  )
  into v_ok
  from (
    values
      ('store_catalog_items'),
      ('store_catalog_item_photos'),
      ('store_import_files'),
      ('store_import_file_items'),
      ('pools'),
      ('pool_photos')
  ) as target(table_name);

  perform pg_temp._p18_catalog_import_require(v_ok, 'authenticated is missing direct CRUD on one or more browser tables');
  perform pg_temp._p18_catalog_import_record(4, 'PASS', 'authenticated has direct CRUD on all six browser tables');
exception
  when others then
    perform pg_temp._p18_catalog_import_record(4, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_4$;

do $scenario_5$
declare
  v_user_a uuid := pg_temp._p18_catalog_import_uuid('user_a');
begin
  perform pg_temp._p18_catalog_import_require(
    not has_table_privilege('authenticated', 'public.store_import_media_assets', 'SELECT')
    and not has_table_privilege('authenticated', 'public.store_import_media_assets', 'INSERT')
    and not has_table_privilege('authenticated', 'public.store_import_media_assets', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.store_import_media_assets', 'DELETE')
    and not has_table_privilege('authenticated', 'public.store_import_media_assets', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.store_import_media_assets', 'TRIGGER')
    and not has_table_privilege('authenticated', 'public.store_import_media_assets', 'REFERENCES'),
    'authenticated still has privileges on store_import_media_assets'
  );

  perform pg_temp._p18_catalog_import_assert_failure(
    'authenticated',
    v_user_a,
    'select count(*)::text from public.store_import_media_assets',
    '42501'
  );

  perform pg_temp._p18_catalog_import_record(5, 'PASS', 'authenticated has no direct access to store_import_media_assets');
exception
  when others then
    perform pg_temp._p18_catalog_import_record(5, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_5$;

do $scenario_6$
declare
  v_ok boolean;
begin
  select bool_and(
    not has_table_privilege('authenticated', pg_catalog.format('public.%I', table_name), 'TRUNCATE')
    and not has_table_privilege('authenticated', pg_catalog.format('public.%I', table_name), 'TRIGGER')
    and not has_table_privilege('authenticated', pg_catalog.format('public.%I', table_name), 'REFERENCES')
    and not has_table_privilege('anon', pg_catalog.format('public.%I', table_name), 'TRUNCATE')
    and not has_table_privilege('anon', pg_catalog.format('public.%I', table_name), 'TRIGGER')
    and not has_table_privilege('anon', pg_catalog.format('public.%I', table_name), 'REFERENCES')
  )
  into v_ok
  from (
    values
      ('store_catalog_items'),
      ('store_catalog_item_photos'),
      ('store_import_files'),
      ('store_import_file_items'),
      ('store_import_media_assets'),
      ('pools'),
      ('pool_photos')
  ) as target(table_name);

  perform pg_temp._p18_catalog_import_require(v_ok, 'client roles still have TRUNCATE, TRIGGER or REFERENCES');
  perform pg_temp._p18_catalog_import_record(6, 'PASS', 'client roles have no TRUNCATE, TRIGGER or REFERENCES');
exception
  when others then
    perform pg_temp._p18_catalog_import_record(6, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_6$;

do $scenario_7$
declare
  v_user_a uuid := pg_temp._p18_catalog_import_uuid('user_a');
  v_org_a uuid := pg_temp._p18_catalog_import_uuid('org_a');
  v_org_b uuid := pg_temp._p18_catalog_import_uuid('org_b');
  v_store_a uuid := pg_temp._p18_catalog_import_uuid('store_a');
  v_store_b uuid := pg_temp._p18_catalog_import_uuid('store_b');
begin
  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format(
      'select exists (select 1 from public.memberships where organization_id = %L::uuid and user_id = %L::uuid and is_active is true)::text',
      v_org_a,
      v_user_a
    ),
    'true'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format(
      'select exists (select 1 from public.memberships where organization_id = %L::uuid and user_id = %L::uuid)::text',
      v_org_b,
      v_user_a
    ),
    'false'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format(
      'select exists (select 1 from public.stores where id = %L::uuid and organization_id = %L::uuid)::text',
      v_store_a,
      v_org_a
    ),
    'true'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format(
      'select exists (select 1 from public.stores where id = %L::uuid and organization_id = %L::uuid)::text',
      v_store_b,
      v_org_b
    ),
    'false'
  );

  perform pg_temp._p18_catalog_import_record(7, 'PASS', 'authenticated can read its own active membership and own store, but not foreign scope');
exception
  when others then
    perform pg_temp._p18_catalog_import_record(7, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_7$;

do $scenario_8$
declare
  v_user_a uuid := pg_temp._p18_catalog_import_uuid('user_a');
  v_org_a uuid := pg_temp._p18_catalog_import_uuid('org_a');
  v_store_a uuid := pg_temp._p18_catalog_import_uuid('store_a');
  v_catalog_item_a uuid := pg_temp._p18_catalog_import_uuid('catalog_item_a');
  v_import_file_a uuid := pg_temp._p18_catalog_import_uuid('import_file_a');
  v_pool_a uuid := pg_temp._p18_catalog_import_uuid('pool_a');
  v_catalog_item_update_id uuid := gen_random_uuid();
  v_catalog_item_delete_id uuid := gen_random_uuid();
  v_import_file_update_id uuid := gen_random_uuid();
  v_import_file_delete_id uuid := gen_random_uuid();
  v_pool_update_id uuid := gen_random_uuid();
  v_pool_delete_id uuid := gen_random_uuid();
  v_run_token text := pg_temp._p18_catalog_import_text('run_token');
begin
  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format('select exists (select 1 from public.store_catalog_items where id = %L::uuid)::text', v_catalog_item_a),
    'true'
  );
  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format('select exists (select 1 from public.store_import_files where id = %L::uuid)::text', v_import_file_a),
    'true'
  );
  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format('select exists (select 1 from public.pools where id = %L::uuid)::text', v_pool_a),
    'true'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with inserted as (
        insert into public.store_catalog_items (
          id, organization_id, store_id, sku, name, description, price_cents, price_status, currency, is_active, track_stock, stock_quantity, stock_status, metadata
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L, 'Main Insert Update', 'runner', 111, 'valid', 'BRL', true, false, null, 'not_tracked', '{}'::jsonb
        )
        returning id
      )
      select count(*)::text from inserted
    $sql$, v_catalog_item_update_id, v_org_a, v_store_a, 'main-sku-' || v_run_token),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.store_catalog_items
        set name = 'Main Updated', description = 'updated'
        where id = %L::uuid
        returning id
      )
      select count(*)::text from updated
    $sql$, v_catalog_item_update_id),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with inserted as (
        insert into public.store_catalog_items (
          id, organization_id, store_id, sku, name, description, price_cents, price_status, currency, is_active, track_stock, stock_quantity, stock_status, metadata
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L, 'Main Insert Delete', 'runner', 222, 'valid', 'BRL', true, false, null, 'not_tracked', '{}'::jsonb
        )
        returning id
      )
      select count(*)::text from inserted
    $sql$, v_catalog_item_delete_id, v_org_a, v_store_a, 'main-sku-delete-' || v_run_token),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with deleted as (
        delete from public.store_catalog_items
        where id = %L::uuid
        returning id
      )
      select count(*)::text from deleted
    $sql$, v_catalog_item_delete_id),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with inserted as (
        insert into public.store_import_files (
          id, organization_id, store_id, source, original_file_name, mime_type, extension, size_bytes, storage_bucket, storage_path, import_summary, status, import_batch_id, file_hash
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 'runner', %L, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx', 99, 'store-import-files', %L, '{}'::jsonb, 'active', gen_random_uuid(), null
        )
        returning id
      )
      select count(*)::text from inserted
    $sql$, v_import_file_update_id, v_org_a, v_store_a, 'main-file-' || v_run_token || '.xlsx', 'main-path-' || v_run_token),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.store_import_files
        set original_file_name = %L
        where id = %L::uuid
        returning id
      )
      select count(*)::text from updated
    $sql$, 'main-file-updated-' || v_run_token || '.xlsx', v_import_file_update_id),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with inserted as (
        insert into public.store_import_files (
          id, organization_id, store_id, source, original_file_name, mime_type, extension, size_bytes, storage_bucket, storage_path, import_summary, status, import_batch_id, file_hash
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 'runner', %L, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx', 120, 'store-import-files', %L, '{}'::jsonb, 'active', gen_random_uuid(), null
        )
        returning id
      )
      select count(*)::text from inserted
    $sql$, v_import_file_delete_id, v_org_a, v_store_a, 'main-file-delete-' || v_run_token || '.xlsx', 'main-path-delete-' || v_run_token),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with deleted as (
        delete from public.store_import_files
        where id = %L::uuid
        returning id
      )
      select count(*)::text from deleted
    $sql$, v_import_file_delete_id),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with inserted as (
        insert into public.pools (
          id, organization_id, store_id, name, width_m, length_m, depth_m, shape, material, max_capacity_l, weight_kg, price, price_status, description, is_active, track_stock, stock_quantity, stock_status
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L, 2, 3, 1, 'retangular', 'vinil', 1000, 200, 7890, 'valid', 'runner', true, false, null, 'not_tracked'
        )
        returning id
      )
      select count(*)::text from inserted
    $sql$, v_pool_update_id, v_org_a, v_store_a, 'main-pool-' || v_run_token),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.pools
        set name = %L, description = 'updated'
        where id = %L::uuid
        returning id
      )
      select count(*)::text from updated
    $sql$, 'main-pool-updated-' || v_run_token, v_pool_update_id),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with inserted as (
        insert into public.pools (
          id, organization_id, store_id, name, width_m, length_m, depth_m, shape, material, max_capacity_l, weight_kg, price, price_status, description, is_active, track_stock, stock_quantity, stock_status
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L, 2, 3, 1, 'retangular', 'vinil', 1000, 200, 6543, 'valid', 'runner', true, false, null, 'not_tracked'
        )
        returning id
      )
      select count(*)::text from inserted
    $sql$, v_pool_delete_id, v_org_a, v_store_a, 'main-pool-delete-' || v_run_token),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with deleted as (
        delete from public.pools
        where id = %L::uuid
        returning id
      )
      select count(*)::text from deleted
    $sql$, v_pool_delete_id),
    '1'
  );

  perform pg_temp._p18_catalog_import_record(8, 'PASS', 'same-tenant select insert update delete executed on store_catalog_items, store_import_files and pools');
exception
  when others then
    perform pg_temp._p18_catalog_import_record(8, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_8$;

do $scenario_9$
declare
  v_user_a uuid := pg_temp._p18_catalog_import_uuid('user_a');
  v_org_b uuid := pg_temp._p18_catalog_import_uuid('org_b');
  v_store_b uuid := pg_temp._p18_catalog_import_uuid('store_b');
  v_catalog_item_a uuid := pg_temp._p18_catalog_import_uuid('catalog_item_a');
  v_catalog_item_b uuid := pg_temp._p18_catalog_import_uuid('catalog_item_b');
  v_import_file_a uuid := pg_temp._p18_catalog_import_uuid('import_file_a');
  v_import_file_b uuid := pg_temp._p18_catalog_import_uuid('import_file_b');
  v_pool_a uuid := pg_temp._p18_catalog_import_uuid('pool_a');
  v_pool_b uuid := pg_temp._p18_catalog_import_uuid('pool_b');
  v_run_token text := pg_temp._p18_catalog_import_text('run_token');
begin
  perform pg_temp._p18_catalog_import_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      insert into public.store_catalog_items (
        id, organization_id, store_id, sku, name, description, price_cents, price_status, currency, is_active, track_stock, stock_quantity, stock_status, metadata
      ) values (
        gen_random_uuid(), %L::uuid, %L::uuid, %L, 'Denied Catalog', 'runner', 1, 'valid', 'BRL', true, false, null, 'not_tracked', '{}'::jsonb
      )
    $sql$, v_org_b, v_store_b, 'deny-main-sku-' || v_run_token),
    '42501'
  );
  perform pg_temp._p18_catalog_import_assert_failure(
    'authenticated',
    v_user_a,
    format('update public.store_catalog_items set organization_id = %L::uuid, store_id = %L::uuid where id = %L::uuid', v_org_b, v_store_b, v_catalog_item_a),
    '42501'
  );
  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format('with deleted as (delete from public.store_catalog_items where id = %L::uuid returning id) select count(*)::text from deleted', v_catalog_item_b),
    '0'
  );

  perform pg_temp._p18_catalog_import_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      insert into public.store_import_files (
        id, organization_id, store_id, source, original_file_name, mime_type, extension, size_bytes, storage_bucket, storage_path, import_summary, status, import_batch_id, file_hash
      ) values (
        gen_random_uuid(), %L::uuid, %L::uuid, 'runner', %L, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx', 50, 'store-import-files', %L, '{}'::jsonb, 'active', gen_random_uuid(), null
      )
    $sql$, v_org_b, v_store_b, 'deny-main-file-' || v_run_token || '.xlsx', 'deny-main-file-' || v_run_token),
    '42501'
  );
  perform pg_temp._p18_catalog_import_assert_failure(
    'authenticated',
    v_user_a,
    format('update public.store_import_files set organization_id = %L::uuid, store_id = %L::uuid where id = %L::uuid', v_org_b, v_store_b, v_import_file_a),
    '42501'
  );
  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format('with deleted as (delete from public.store_import_files where id = %L::uuid returning id) select count(*)::text from deleted', v_import_file_b),
    '0'
  );

  perform pg_temp._p18_catalog_import_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      insert into public.pools (
        id, organization_id, store_id, name, width_m, length_m, depth_m, shape, material, max_capacity_l, weight_kg, price, price_status, description, is_active, track_stock, stock_quantity, stock_status
      ) values (
        gen_random_uuid(), %L::uuid, %L::uuid, %L, 2, 3, 1, 'retangular', 'vinil', 1000, 200, 100, 'valid', 'runner', true, false, null, 'not_tracked'
      )
    $sql$, v_org_b, v_store_b, 'deny-main-pool-' || v_run_token),
    '42501'
  );
  perform pg_temp._p18_catalog_import_assert_failure(
    'authenticated',
    v_user_a,
    format('update public.pools set organization_id = %L::uuid, store_id = %L::uuid where id = %L::uuid', v_org_b, v_store_b, v_pool_a),
    '42501'
  );
  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format('with deleted as (delete from public.pools where id = %L::uuid returning id) select count(*)::text from deleted', v_pool_b),
    '0'
  );

  perform pg_temp._p18_catalog_import_record(9, 'PASS', 'cross-tenant insert and update fail, and delete stays invisible, on the three main tables');
exception
  when others then
    perform pg_temp._p18_catalog_import_record(9, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_9$;

do $scenario_10$
declare
  v_user_a uuid := pg_temp._p18_catalog_import_uuid('user_a');
  v_org_a uuid := pg_temp._p18_catalog_import_uuid('org_a');
  v_store_a uuid := pg_temp._p18_catalog_import_uuid('store_a');
  v_catalog_item_a uuid := pg_temp._p18_catalog_import_uuid('catalog_item_a');
  v_pool_a uuid := pg_temp._p18_catalog_import_uuid('pool_a');
  v_import_file_a uuid := pg_temp._p18_catalog_import_uuid('import_file_a');
  v_catalog_photo_a uuid := pg_temp._p18_catalog_import_uuid('catalog_photo_a');
  v_pool_photo_a uuid := pg_temp._p18_catalog_import_uuid('pool_photo_a');
  v_import_file_item_a uuid := pg_temp._p18_catalog_import_uuid('import_file_item_a');
  v_catalog_photo_update_id uuid := gen_random_uuid();
  v_catalog_photo_delete_id uuid := gen_random_uuid();
  v_pool_photo_update_id uuid := gen_random_uuid();
  v_pool_photo_delete_id uuid := gen_random_uuid();
  v_import_file_item_update_id uuid := gen_random_uuid();
  v_import_file_item_delete_id uuid := gen_random_uuid();
  v_run_token text := pg_temp._p18_catalog_import_text('run_token');
begin
  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format('select exists (select 1 from public.store_catalog_item_photos where id = %L::uuid)::text', v_catalog_photo_a),
    'true'
  );
  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format('select exists (select 1 from public.pool_photos where id = %L::uuid)::text', v_pool_photo_a),
    'true'
  );
  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format('select exists (select 1 from public.store_import_file_items where id = %L::uuid)::text', v_import_file_item_a),
    'true'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with inserted as (
        insert into public.store_catalog_item_photos (
          id, catalog_item_id, file_name, file_size_bytes, sort_order, storage_path
        ) values (
          %L::uuid, %L::uuid, %L, 10, 1, %L
        )
        returning id
      )
      select count(*)::text from inserted
    $sql$, v_catalog_photo_update_id, v_catalog_item_a, 'child-catalog-' || v_run_token || '.jpg', 'child-catalog-path-' || v_run_token),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.store_catalog_item_photos
        set file_name = %L
        where id = %L::uuid
        returning id
      )
      select count(*)::text from updated
    $sql$, 'child-catalog-updated-' || v_run_token || '.jpg', v_catalog_photo_update_id),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with inserted as (
        insert into public.store_catalog_item_photos (
          id, catalog_item_id, file_name, file_size_bytes, sort_order, storage_path
        ) values (
          %L::uuid, %L::uuid, %L, 10, 2, %L
        )
        returning id
      )
      select count(*)::text from inserted
    $sql$, v_catalog_photo_delete_id, v_catalog_item_a, 'child-catalog-delete-' || v_run_token || '.jpg', 'child-catalog-delete-path-' || v_run_token),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with deleted as (
        delete from public.store_catalog_item_photos
        where id = %L::uuid
        returning id
      )
      select count(*)::text from deleted
    $sql$, v_catalog_photo_delete_id),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with inserted as (
        insert into public.pool_photos (
          id, organization_id, store_id, pool_id, file_name, file_size_bytes, sort_order, storage_path
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, %L, 11, 1, %L
        )
        returning id
      )
      select count(*)::text from inserted
    $sql$, v_pool_photo_update_id, v_org_a, v_store_a, v_pool_a, 'child-pool-' || v_run_token || '.jpg', 'child-pool-path-' || v_run_token),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.pool_photos
        set file_name = %L
        where id = %L::uuid
        returning id
      )
      select count(*)::text from updated
    $sql$, 'child-pool-updated-' || v_run_token || '.jpg', v_pool_photo_update_id),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with inserted as (
        insert into public.pool_photos (
          id, organization_id, store_id, pool_id, file_name, file_size_bytes, sort_order, storage_path
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, %L, 12, 2, %L
        )
        returning id
      )
      select count(*)::text from inserted
    $sql$, v_pool_photo_delete_id, v_org_a, v_store_a, v_pool_a, 'child-pool-delete-' || v_run_token || '.jpg', 'child-pool-delete-path-' || v_run_token),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with deleted as (
        delete from public.pool_photos
        where id = %L::uuid
        returning id
      )
      select count(*)::text from deleted
    $sql$, v_pool_photo_delete_id),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with inserted as (
        insert into public.store_import_file_items (
          id, import_file_id, organization_id, store_id, destination_type, destination_table, destination_item_id
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'catalog_item', 'store_catalog_items', %L::uuid
        )
        returning id
      )
      select count(*)::text from inserted
    $sql$, v_import_file_item_update_id, v_import_file_a, v_org_a, v_store_a, v_catalog_item_a),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with updated as (
        update public.store_import_file_items
        set destination_type = 'catalog_item'
        where id = %L::uuid
        returning id
      )
      select count(*)::text from updated
    $sql$, v_import_file_item_update_id),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with inserted as (
        insert into public.store_import_file_items (
          id, import_file_id, organization_id, store_id, destination_type, destination_table, destination_item_id
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'catalog_item', 'store_catalog_items', %L::uuid
        )
        returning id
      )
      select count(*)::text from inserted
    $sql$, v_import_file_item_delete_id, v_import_file_a, v_org_a, v_store_a, v_catalog_item_a),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format($sql$
      with deleted as (
        delete from public.store_import_file_items
        where id = %L::uuid
        returning id
      )
      select count(*)::text from deleted
    $sql$, v_import_file_item_delete_id),
    '1'
  );

  perform pg_temp._p18_catalog_import_record(10, 'PASS', 'same-tenant select insert update delete executed on all three child tables');
exception
  when others then
    perform pg_temp._p18_catalog_import_record(10, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_10$;

do $scenario_11$
declare
  v_user_a uuid := pg_temp._p18_catalog_import_uuid('user_a');
  v_org_a uuid := pg_temp._p18_catalog_import_uuid('org_a');
  v_org_b uuid := pg_temp._p18_catalog_import_uuid('org_b');
  v_store_a uuid := pg_temp._p18_catalog_import_uuid('store_a');
  v_store_b uuid := pg_temp._p18_catalog_import_uuid('store_b');
  v_catalog_item_a uuid := pg_temp._p18_catalog_import_uuid('catalog_item_a');
  v_catalog_item_b uuid := pg_temp._p18_catalog_import_uuid('catalog_item_b');
  v_pool_a uuid := pg_temp._p18_catalog_import_uuid('pool_a');
  v_pool_b uuid := pg_temp._p18_catalog_import_uuid('pool_b');
  v_import_file_a uuid := pg_temp._p18_catalog_import_uuid('import_file_a');
  v_import_file_b uuid := pg_temp._p18_catalog_import_uuid('import_file_b');
  v_catalog_photo_a uuid := pg_temp._p18_catalog_import_uuid('catalog_photo_a');
  v_catalog_photo_b uuid := pg_temp._p18_catalog_import_uuid('catalog_photo_b');
  v_pool_photo_a uuid := pg_temp._p18_catalog_import_uuid('pool_photo_a');
  v_pool_photo_b uuid := pg_temp._p18_catalog_import_uuid('pool_photo_b');
  v_import_file_item_a uuid := pg_temp._p18_catalog_import_uuid('import_file_item_a');
  v_import_file_item_b uuid := pg_temp._p18_catalog_import_uuid('import_file_item_b');
  v_run_token text := pg_temp._p18_catalog_import_text('run_token');
begin
  perform pg_temp._p18_catalog_import_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      insert into public.store_catalog_item_photos (
        id, catalog_item_id, file_name, file_size_bytes, sort_order, storage_path
      ) values (
        gen_random_uuid(), %L::uuid, %L, 1, 0, 'wrong-parent'
      )
    $sql$, v_catalog_item_b, 'deny-child-catalog-' || v_run_token || '.jpg'),
    '42501'
  );
  perform pg_temp._p18_catalog_import_assert_failure(
    'authenticated',
    v_user_a,
    format('update public.store_catalog_item_photos set catalog_item_id = %L::uuid where id = %L::uuid', v_catalog_item_b, v_catalog_photo_a),
    '42501'
  );
  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format('with deleted as (delete from public.store_catalog_item_photos where id = %L::uuid returning id) select count(*)::text from deleted', v_catalog_photo_b),
    '0'
  );

  perform pg_temp._p18_catalog_import_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      insert into public.pool_photos (
        id, organization_id, store_id, pool_id, file_name, file_size_bytes, sort_order, storage_path
      ) values (
        gen_random_uuid(), %L::uuid, %L::uuid, %L::uuid, %L, 1, 0, 'wrong-pool'
      )
    $sql$, v_org_a, v_store_a, v_pool_b, 'deny-child-pool-' || v_run_token || '.jpg'),
    '42501'
  );
  perform pg_temp._p18_catalog_import_assert_failure(
    'authenticated',
    v_user_a,
    format('update public.pool_photos set organization_id = %L::uuid, store_id = %L::uuid, pool_id = %L::uuid where id = %L::uuid', v_org_b, v_store_b, v_pool_b, v_pool_photo_a),
    '42501'
  );
  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format('with deleted as (delete from public.pool_photos where id = %L::uuid returning id) select count(*)::text from deleted', v_pool_photo_b),
    '0'
  );

  perform pg_temp._p18_catalog_import_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      insert into public.store_import_file_items (
        id, import_file_id, organization_id, store_id, destination_type, destination_table, destination_item_id
      ) values (
        gen_random_uuid(), %L::uuid, %L::uuid, %L::uuid, 'catalog_item', 'store_catalog_items', %L::uuid
      )
    $sql$, v_import_file_b, v_org_a, v_store_a, v_catalog_item_a),
    '42501'
  );
  perform pg_temp._p18_catalog_import_assert_failure(
    'authenticated',
    v_user_a,
    format('update public.store_import_file_items set import_file_id = %L::uuid, organization_id = %L::uuid, store_id = %L::uuid where id = %L::uuid', v_import_file_b, v_org_b, v_store_b, v_import_file_item_a),
    '42501'
  );
  perform pg_temp._p18_catalog_import_assert_success(
    'authenticated',
    v_user_a,
    format('with deleted as (delete from public.store_import_file_items where id = %L::uuid returning id) select count(*)::text from deleted', v_import_file_item_b),
    '0'
  );

  perform pg_temp._p18_catalog_import_record(11, 'PASS', 'child inserts, parent swaps and cross-tenant deletes are blocked or invisible');
exception
  when others then
    perform pg_temp._p18_catalog_import_record(11, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_11$;

do $scenario_12$
declare
  v_user_a uuid := pg_temp._p18_catalog_import_uuid('user_a');
  v_org_a uuid := pg_temp._p18_catalog_import_uuid('org_a');
  v_org_b uuid := pg_temp._p18_catalog_import_uuid('org_b');
  v_store_a uuid := pg_temp._p18_catalog_import_uuid('store_a');
  v_store_b uuid := pg_temp._p18_catalog_import_uuid('store_b');
  v_pool_a uuid := pg_temp._p18_catalog_import_uuid('pool_a');
  v_pool_photo_a uuid := pg_temp._p18_catalog_import_uuid('pool_photo_a');
  v_run_token text := pg_temp._p18_catalog_import_text('run_token');
begin
  perform pg_temp._p18_catalog_import_assert_failure(
    'authenticated',
    v_user_a,
    format($sql$
      insert into public.pool_photos (
        id, organization_id, store_id, pool_id, file_name, file_size_bytes, sort_order, storage_path
      ) values (
        gen_random_uuid(), %L::uuid, %L::uuid, %L::uuid, %L, 1, 0, 'mismatch-a'
      )
    $sql$, v_org_b, v_store_b, v_pool_a, 'mismatch-pool-photo-' || v_run_token || '.jpg'),
    '42501'
  );

  perform pg_temp._p18_catalog_import_assert_failure(
    'authenticated',
    v_user_a,
    format('update public.pool_photos set organization_id = %L::uuid, store_id = %L::uuid where id = %L::uuid', v_org_b, v_store_a, v_pool_photo_a),
    '42501'
  );

  perform pg_temp._p18_catalog_import_record(12, 'PASS', 'pool_photos rejects org/store values that diverge from the parent pool');
exception
  when others then
    perform pg_temp._p18_catalog_import_record(12, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_12$;

do $scenario_13$
declare
  v_org_a uuid := pg_temp._p18_catalog_import_uuid('org_a');
  v_store_a uuid := pg_temp._p18_catalog_import_uuid('store_a');
  v_import_file_a uuid := pg_temp._p18_catalog_import_uuid('import_file_a');
  v_media_asset_update_id uuid := gen_random_uuid();
  v_media_asset_delete_id uuid := gen_random_uuid();
  v_run_token text := pg_temp._p18_catalog_import_text('run_token');
begin
  perform pg_temp._p18_catalog_import_assert_success(
    'service_role',
    null,
    'select exists (select 1 from public.store_import_media_assets)::text',
    'true'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'service_role',
    null,
    format($sql$
      with inserted as (
        insert into public.store_import_media_assets (
          id, organization_id, store_id, import_batch_id, import_file_id, source_file_name, source_kind, source_location_key, association_strength, status, file_name, size_bytes, normalized_mime_type, original_mime_type, storage_bucket, storage_path, metadata
        ) values (
          %L::uuid, %L::uuid, %L::uuid, gen_random_uuid(), %L::uuid, %L, 'xlsx_row_image', 'row:2:image:1', 'strong_auto', 'staged', %L, 101, 'image/jpeg', 'image/jpeg', 'store-import-files', %L, '{}'::jsonb
        )
        returning id
      )
      select count(*)::text from inserted
    $sql$, v_media_asset_update_id, v_org_a, v_store_a, v_import_file_a, 'service-role-' || v_run_token || '.xlsx', 'service-role-' || v_run_token || '.jpg', 'service-role-path-' || v_run_token),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'service_role',
    null,
    format($sql$
      with updated as (
        update public.store_import_media_assets
        set status = 'promoted'
        where id = %L::uuid
        returning id
      )
      select count(*)::text from updated
    $sql$, v_media_asset_update_id),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'service_role',
    null,
    format($sql$
      with inserted as (
        insert into public.store_import_media_assets (
          id, organization_id, store_id, import_batch_id, import_file_id, source_file_name, source_kind, source_location_key, association_strength, status, file_name, size_bytes, normalized_mime_type, original_mime_type, storage_bucket, storage_path, metadata
        ) values (
          %L::uuid, %L::uuid, %L::uuid, gen_random_uuid(), %L::uuid, %L, 'xlsx_row_image', 'row:3:image:1', 'strong_auto', 'staged', %L, 102, 'image/jpeg', 'image/jpeg', 'store-import-files', %L, '{}'::jsonb
        )
        returning id
      )
      select count(*)::text from inserted
    $sql$, v_media_asset_delete_id, v_org_a, v_store_a, v_import_file_a, 'service-role-delete-' || v_run_token || '.xlsx', 'service-role-delete-' || v_run_token || '.jpg', 'service-role-delete-path-' || v_run_token),
    '1'
  );

  perform pg_temp._p18_catalog_import_assert_success(
    'service_role',
    null,
    format($sql$
      with deleted as (
        delete from public.store_import_media_assets
        where id = %L::uuid
        returning id
      )
      select count(*)::text from deleted
    $sql$, v_media_asset_delete_id),
    '1'
  );

  perform pg_temp._p18_catalog_import_record(13, 'PASS', 'service_role executed select insert update and delete on store_import_media_assets');
exception
  when others then
    perform pg_temp._p18_catalog_import_record(13, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_13$;

do $scenario_14$
declare
  v_run_token text := pg_temp._p18_catalog_import_text('run_token');
  v_match_count integer;
begin
  select count(*)
  into v_match_count
  from (
    select 1
    from public.organizations
    where name = 'P18 Catalog Org A ' || v_run_token
    union all
    select 1
    from public.organizations
    where name = 'P18 Catalog Org B ' || v_run_token
    union all
    select 1
    from public.store_catalog_items
    where sku = 'SKU-A-' || left(v_run_token, 12)
    union all
    select 1
    from public.store_catalog_items
    where sku = 'SKU-B-' || left(v_run_token, 12)
    union all
    select 1
    from public.store_import_files
    where original_file_name = 'seed-a-' || v_run_token || '.xlsx'
    union all
    select 1
    from public.store_import_files
    where original_file_name = 'seed-b-' || v_run_token || '.xlsx'
    union all
    select 1
    from public.pool_photos
    where file_name = 'seed-pool-a-' || v_run_token || '.jpg'
    union all
    select 1
    from public.pool_photos
    where file_name = 'seed-pool-b-' || v_run_token || '.jpg'
  ) as fixture_rows;

  perform pg_temp._p18_catalog_import_require(length(v_run_token) > 20, 'run token is unexpectedly short');
  perform pg_temp._p18_catalog_import_require(v_match_count = 8, format('expected 8 unique fixture signatures, found %s', v_match_count));
  perform pg_temp._p18_catalog_import_record(14, 'PASS', 'fixtures are uniquely keyed inside the surrounding transaction; cleanup is delegated to the final rollback');
exception
  when others then
    perform pg_temp._p18_catalog_import_record(14, 'HARNESS_ERROR', sqlerrm);
end;
$scenario_14$;

select
  result_row.scenario_number,
  result_row.scenario_name,
  result_row.status,
  result_row.details
from pg_temp._p18_catalog_import_results result_row
order by result_row.scenario_number;

select
  count(*) filter (where status = 'PASS') as pass_count,
  count(*) filter (where status <> 'PASS') as fail_count,
  count(*) as total_count
from pg_temp._p18_catalog_import_results;

rollback;
