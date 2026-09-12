begin;

do $runner$
declare
  v_target_org uuid;
  v_target_store uuid;
  v_member_user uuid;
  v_target_file uuid;
  v_state text;
  v_count bigint;
  v_deleted bigint;
  v_ok boolean;
begin
  ---------------------------------------------------------------------------
  -- 1. Função de proteção existe e está endurecida.
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
    'public.protect_selected_customer_catalog_import_link()'
  );

  if not coalesce(v_ok, false) then
    raise exception 'FAIL 01: selected catalog link guard hardening mismatch';
  end if;

  ---------------------------------------------------------------------------
  -- 2. Trigger existe no store_import_file_items.
  ---------------------------------------------------------------------------
  select exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.store_import_file_items'::pg_catalog.regclass
      and t.tgname = 'protect_selected_customer_catalog_import_link'
      and t.tgenabled = 'O'
      and not t.tgisinternal
  )
  into v_ok;

  if not coalesce(v_ok, false) then
    raise exception 'FAIL 02: selected catalog link protection trigger missing';
  end if;

  ---------------------------------------------------------------------------
  -- 3. Escolhe arquivo real elegível + membro ativo da mesma organização.
  ---------------------------------------------------------------------------
  select
    f.organization_id,
    f.store_id,
    m.user_id,
    f.id
  into
    v_target_org,
    v_target_store,
    v_member_user,
    v_target_file
  from public.store_import_files f
  join public.stores s
    on s.id = f.store_id
   and s.organization_id = f.organization_id
  join public.memberships m
    on m.organization_id = f.organization_id
   and m.is_active is true
   and m.user_id is not null
  where f.status = 'active'
    and nullif(pg_catalog.btrim(f.storage_bucket), '') is not null
    and nullif(pg_catalog.btrim(f.storage_path), '') is not null
    and exists (
      select 1
      from public.store_import_file_items i
      where i.import_file_id = f.id
        and i.organization_id = f.organization_id
        and i.store_id = f.store_id
    )
  order by f.created_at desc nulls last, f.id
  limit 1;

  if v_target_file is null then
    raise exception 'FAIL 03: no eligible imported catalog file exists';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    v_member_user::text,
    true
  );
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object(
      'sub', v_member_user::text,
      'role', 'authenticated'
    )::text,
    true
  );

  if auth.uid() is distinct from v_member_user then
    raise exception 'FAIL 04: auth.uid fixture could not be established';
  end if;

  ---------------------------------------------------------------------------
  -- 4. Seleciona o arquivo como catálogo completo.
  ---------------------------------------------------------------------------
  perform 1
  from public.upsert_store_catalog_settings_scoped(
    v_target_org,
    v_target_store,
    true,
    v_target_file
  );

  select count(*)
  into v_count
  from public.store_import_file_items i
  where i.import_file_id = v_target_file
    and i.organization_id = v_target_org
    and i.store_id = v_target_store;

  if v_count <= 0 then
    raise exception 'FAIL 05: target file lost its import links before protection check';
  end if;

  ---------------------------------------------------------------------------
  -- 5. Enquanto selecionado, remover os vínculos deve falhar com 23503.
  ---------------------------------------------------------------------------
  v_state := null;

  begin
    delete from public.store_import_file_items i
    where i.import_file_id = v_target_file
      and i.organization_id = v_target_org
      and i.store_id = v_target_store;
  exception
    when others then
      v_state := sqlstate;
  end;

  if v_state is distinct from '23503' then
    raise exception
      'FAIL 06: selected file link deletion expected 23503, got %',
      v_state;
  end if;

  select count(*)
  into v_count
  from public.store_import_file_items i
  where i.import_file_id = v_target_file
    and i.organization_id = v_target_org
    and i.store_id = v_target_store;

  if v_count <= 0 then
    raise exception 'FAIL 07: selected file links were partially removed';
  end if;

  ---------------------------------------------------------------------------
  -- 6. Após desabilitar a seleção, a limpeza volta a ser permitida.
  -- Tudo é revertido pelo ROLLBACK final.
  ---------------------------------------------------------------------------
  perform 1
  from public.upsert_store_catalog_settings_scoped(
    v_target_org,
    v_target_store,
    false,
    null
  );

  with deleted as (
    delete from public.store_import_file_items i
    where i.import_file_id = v_target_file
      and i.organization_id = v_target_org
      and i.store_id = v_target_store
    returning 1
  )
  select count(*)
  into v_deleted
  from deleted;

  if v_deleted <= 0 then
    raise exception 'FAIL 08: import links should be removable after selection is disabled';
  end if;
end;
$runner$;

rollback;
