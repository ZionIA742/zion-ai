begin;

do $runner$
declare
  v_org uuid;
  v_store uuid;
  v_file uuid;
  v_expected_name text;
  v_actual_name text;
  v_actual_count bigint;
  v_expected_pool_links bigint;
  v_actual_pool_links bigint;
  v_expected_catalog_links bigint;
  v_actual_catalog_links bigint;
  v_state text;
  v_ok boolean;
  v_other_org uuid;
begin
  ---------------------------------------------------------------------------
  -- 01. Funcao existe, SECURITY DEFINER, owner postgres e hardening correto.
  ---------------------------------------------------------------------------
  select
    p.prosecdef
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    and coalesce(p.proconfig @> array['row_security=off']::text[], false)
    and coalesce(
      p.proconfig @> array['search_path=pg_catalog, public']::text[],
      false
    )
  into v_ok
  from pg_catalog.pg_proc p
  where p.oid = to_regprocedure(
    'public.read_store_customer_catalog_files_for_ai_by_system(uuid,uuid)'
  );

  if not coalesce(v_ok, false) then
    raise exception 'FAIL 01: system catalog reader hardening mismatch';
  end if;

  ---------------------------------------------------------------------------
  -- 02-04. Somente service_role recebe EXECUTE.
  ---------------------------------------------------------------------------
  if not pg_catalog.has_function_privilege(
    'service_role',
    'public.read_store_customer_catalog_files_for_ai_by_system(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'FAIL 02: service_role must have EXECUTE';
  end if;

  if pg_catalog.has_function_privilege(
    'authenticated',
    'public.read_store_customer_catalog_files_for_ai_by_system(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'FAIL 03: authenticated must not have EXECUTE';
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    'public.read_store_customer_catalog_files_for_ai_by_system(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'FAIL 04: anon must not have EXECUTE';
  end if;

  ---------------------------------------------------------------------------
  -- 05. Fixture controlada: escolhe um arquivo importado real, ativo,
  -- armazenado e com pelo menos um vinculo canonico.
  -- O estado original da loja sera preservado pelo ROLLBACK final.
  ---------------------------------------------------------------------------
  select
    f.organization_id,
    f.store_id,
    f.id,
    f.original_file_name
  into
    v_org,
    v_store,
    v_file,
    v_expected_name
  from public.store_import_files f
  where f.status = 'active'
    and nullif(pg_catalog.btrim(f.storage_bucket), '') is not null
    and nullif(pg_catalog.btrim(f.storage_path), '') is not null
    and exists (
      select 1
      from public.stores s
      where s.id = f.store_id
        and s.organization_id = f.organization_id
    )
    and exists (
      select 1
      from public.store_import_file_items i
      where i.import_file_id = f.id
        and i.organization_id = f.organization_id
        and i.store_id = f.store_id
    )
  order by f.created_at desc, f.id
  limit 1;

  if v_file is null then
    raise exception 'FAIL 05: no eligible active imported file exists for fixture';
  end if;

  ---------------------------------------------------------------------------
  -- 06. Monta temporariamente uma configuracao canonica habilitada com 1 arquivo.
  ---------------------------------------------------------------------------
  insert into public.store_catalog_settings (
    organization_id,
    store_id,
    allow_full_catalog_send,
    customer_catalog_import_file_id
  )
  values (
    v_org,
    v_store,
    true,
    v_file
  )
  on conflict on constraint store_catalog_settings_pkey
  do update set
    allow_full_catalog_send = excluded.allow_full_catalog_send,
    customer_catalog_import_file_id = excluded.customer_catalog_import_file_id;

  delete from public.store_catalog_customer_files cf
  where cf.organization_id = v_org
    and cf.store_id = v_store;

  insert into public.store_catalog_customer_files (
    organization_id,
    store_id,
    import_file_id,
    sort_order
  )
  values (
    v_org,
    v_store,
    v_file,
    1
  );

  select count(*)
  into v_actual_count
  from public.read_store_customer_catalog_files_for_ai_by_system(
    v_org,
    v_store
  );

  if v_actual_count is distinct from 1 then
    raise exception 'FAIL 06: enabled fixture expected 1 row, got %', v_actual_count;
  end if;

  ---------------------------------------------------------------------------
  -- 07. O reader deve devolver exatamente o arquivo autorizado.
  ---------------------------------------------------------------------------
  if exists (
    select 1
    from public.read_store_customer_catalog_files_for_ai_by_system(
      v_org,
      v_store
    ) r
    where r.import_file_id is distinct from v_file
  ) then
    raise exception 'FAIL 07: reader returned a file different from authorized fixture';
  end if;

  ---------------------------------------------------------------------------
  -- 08. Metadado original deve vir do store_import_files real.
  ---------------------------------------------------------------------------
  select r.original_file_name
  into v_actual_name
  from public.read_store_customer_catalog_files_for_ai_by_system(
    v_org,
    v_store
  ) r
  limit 1;

  if v_actual_name is distinct from v_expected_name then
    raise exception
      'FAIL 08: original filename mismatch expected %, got %',
      v_expected_name,
      v_actual_name;
  end if;

  ---------------------------------------------------------------------------
  -- 09. Escopo tenant/store exato.
  ---------------------------------------------------------------------------
  if exists (
    select 1
    from public.read_store_customer_catalog_files_for_ai_by_system(
      v_org,
      v_store
    ) r
    where r.organization_id is distinct from v_org
       or r.store_id is distinct from v_store
  ) then
    raise exception 'FAIL 09: reader returned cross-scope rows';
  end if;

  ---------------------------------------------------------------------------
  -- 10. Vinculos de pool batem com store_import_file_items.
  ---------------------------------------------------------------------------
  select count(*)
  into v_expected_pool_links
  from public.store_import_file_items i
  where i.import_file_id = v_file
    and i.organization_id = v_org
    and i.store_id = v_store
    and i.destination_type = 'pool'
    and i.destination_table = 'pools';

  select coalesce(pg_catalog.cardinality(r.linked_pool_ids), 0)
  into v_actual_pool_links
  from public.read_store_customer_catalog_files_for_ai_by_system(
    v_org,
    v_store
  ) r
  limit 1;

  if v_actual_pool_links is distinct from v_expected_pool_links then
    raise exception
      'FAIL 10: pool link count mismatch expected %, got %',
      v_expected_pool_links,
      v_actual_pool_links;
  end if;

  ---------------------------------------------------------------------------
  -- 11. Vinculos de catalog_item tambem batem.
  ---------------------------------------------------------------------------
  select count(*)
  into v_expected_catalog_links
  from public.store_import_file_items i
  where i.import_file_id = v_file
    and i.organization_id = v_org
    and i.store_id = v_store
    and i.destination_type = 'catalog_item'
    and i.destination_table = 'store_catalog_items';

  select coalesce(pg_catalog.cardinality(r.linked_catalog_item_ids), 0)
  into v_actual_catalog_links
  from public.read_store_customer_catalog_files_for_ai_by_system(
    v_org,
    v_store
  ) r
  limit 1;

  if v_actual_catalog_links is distinct from v_expected_catalog_links then
    raise exception
      'FAIL 11: catalog-item link count mismatch expected %, got %',
      v_expected_catalog_links,
      v_actual_catalog_links;
  end if;

  ---------------------------------------------------------------------------
  -- 12. Organization incompatível com a store deve falhar fechada.
  ---------------------------------------------------------------------------
  select s.organization_id
  into v_other_org
  from public.stores s
  where s.organization_id <> v_org
  order by s.organization_id
  limit 1;

  if v_other_org is null then
    v_other_org := '11111111-1111-1111-1111-111111111111'::uuid;
    if v_other_org = v_org then
      v_other_org := '22222222-2222-2222-2222-222222222222'::uuid;
    end if;
  end if;

  v_state := null;

  begin
    perform 1
    from public.read_store_customer_catalog_files_for_ai_by_system(
      v_other_org,
      v_store
    );
  exception
    when others then
      v_state := sqlstate;
  end;

  if v_state is distinct from '22023' then
    raise exception
      'FAIL 12: cross-tenant scope expected 22023, got %',
      v_state;
  end if;

  ---------------------------------------------------------------------------
  -- 13. Policy desligada deve produzir lista vazia mesmo se o child ainda existir.
  -- Isso prova o fail-closed no proprio reader.
  ---------------------------------------------------------------------------
  update public.store_catalog_settings s
  set
    allow_full_catalog_send = false,
    customer_catalog_import_file_id = null
  where s.organization_id = v_org
    and s.store_id = v_store;

  select count(*)
  into v_actual_count
  from public.read_store_customer_catalog_files_for_ai_by_system(
    v_org,
    v_store
  );

  if v_actual_count is distinct from 0 then
    raise exception
      'FAIL 13: disabled policy expected 0 rows, got %',
      v_actual_count;
  end if;

  ---------------------------------------------------------------------------
  -- 14. Parametros nulos falham fechados.
  ---------------------------------------------------------------------------
  v_state := null;

  begin
    perform 1
    from public.read_store_customer_catalog_files_for_ai_by_system(
      null,
      v_store
    );
  exception
    when others then
      v_state := sqlstate;
  end;

  if v_state is distinct from '22023' then
    raise exception
      'FAIL 14: null organization expected 22023, got %',
      v_state;
  end if;
end;
$runner$;

rollback;
