begin;

do $runner$
declare
  v_columns text[];
  v_ok boolean;
  v_target_org uuid;
  v_target_store uuid;
  v_member_user uuid;
  v_target_file uuid;
  v_other_file uuid;
  v_state text;
  v_row public.store_catalog_settings%rowtype;
  v_count bigint;
  v_writer_def text;
begin
  ---------------------------------------------------------------------------
  -- 1. Shape exato da authority.
  ---------------------------------------------------------------------------
  select array_agg(column_name::text order by ordinal_position)
  into v_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'store_catalog_settings';

  if v_columns is distinct from array[
    'organization_id',
    'store_id',
    'allow_full_catalog_send',
    'customer_catalog_import_file_id',
    'created_at',
    'updated_at'
  ]::text[] then
    raise exception 'FAIL 01: unexpected store_catalog_settings columns: %', v_columns;
  end if;

  ---------------------------------------------------------------------------
  -- 2. PK + FK de store + FK tenant-safe do arquivo + consistência.
  ---------------------------------------------------------------------------
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.store_catalog_settings'::pg_catalog.regclass
      and c.conname = 'store_catalog_settings_pkey'
      and c.contype = 'p'
      and pg_catalog.pg_get_constraintdef(c.oid)
        = 'PRIMARY KEY (organization_id, store_id)'
  ) then
    raise exception 'FAIL 02: composite PK missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.store_catalog_settings'::pg_catalog.regclass
      and c.conname = 'store_catalog_settings_store_fkey'
      and c.contype = 'f'
      and pg_catalog.pg_get_constraintdef(c.oid)
        like 'FOREIGN KEY (store_id, organization_id) REFERENCES stores(id, organization_id)%'
  ) then
    raise exception 'FAIL 03: tenant-safe store FK missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.store_catalog_settings'::pg_catalog.regclass
      and c.conname = 'store_catalog_settings_customer_file_scope_fkey'
      and c.contype = 'f'
      and pg_catalog.pg_get_constraintdef(c.oid)
        like 'FOREIGN KEY (customer_catalog_import_file_id, organization_id, store_id) REFERENCES store_import_files(id, organization_id, store_id)%'
  ) then
    raise exception 'FAIL 04: tenant-safe customer catalog file FK missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.store_catalog_settings'::pg_catalog.regclass
      and c.conname = 'store_catalog_settings_selection_consistency_check'
      and c.contype = 'c'
  ) then
    raise exception 'FAIL 05: selection consistency CHECK missing';
  end if;

  ---------------------------------------------------------------------------
  -- 3. UNIQUE necessária no arquivo bruto para a FK composta.
  ---------------------------------------------------------------------------
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.store_import_files'::pg_catalog.regclass
      and c.conname = 'store_import_files_id_organization_store_key'
      and c.contype = 'u'
      and pg_catalog.pg_get_constraintdef(c.oid)
        = 'UNIQUE (id, organization_id, store_id)'
  ) then
    raise exception 'FAIL 06: composite UNIQUE on store_import_files missing';
  end if;

  ---------------------------------------------------------------------------
  -- 4. Trigger de updated_at.
  ---------------------------------------------------------------------------
  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.store_catalog_settings'::pg_catalog.regclass
      and t.tgname = 'touch_store_catalog_settings_updated_at'
      and t.tgenabled = 'O'
      and not t.tgisinternal
  ) then
    raise exception 'FAIL 07: updated_at trigger missing';
  end if;

  ---------------------------------------------------------------------------
  -- 5. RLS e privilégios: browser lê; não escreve diretamente.
  ---------------------------------------------------------------------------
  select c.relrowsecurity
  into v_ok
  from pg_catalog.pg_class c
  where c.oid = 'public.store_catalog_settings'::pg_catalog.regclass;

  if not coalesce(v_ok, false) then
    raise exception 'FAIL 08: RLS must be enabled';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'store_catalog_settings'
      and p.policyname = 'store_catalog_settings_select_by_active_membership'
      and p.cmd = 'SELECT'
      and 'authenticated' = any(p.roles)
  ) then
    raise exception 'FAIL 09: authenticated SELECT policy missing';
  end if;

  if not has_table_privilege(
       'authenticated',
       'public.store_catalog_settings',
       'SELECT'
     )
     or has_table_privilege(
       'authenticated',
       'public.store_catalog_settings',
       'INSERT'
     )
     or has_table_privilege(
       'authenticated',
       'public.store_catalog_settings',
       'UPDATE'
     )
     or has_table_privilege(
       'authenticated',
       'public.store_catalog_settings',
       'DELETE'
     )
  then
    raise exception 'FAIL 10: authenticated table privileges mismatch';
  end if;

  ---------------------------------------------------------------------------
  -- 6. Reader e writer canônicos existem e estão SECURITY DEFINER.
  ---------------------------------------------------------------------------
  if to_regprocedure(
       'public.read_store_catalog_settings_scoped(uuid,uuid)'
     ) is null then
    raise exception 'FAIL 11: canonical scoped reader missing';
  end if;

  if to_regprocedure(
       'public.upsert_store_catalog_settings_scoped(uuid,uuid,boolean,uuid)'
     ) is null then
    raise exception 'FAIL 12: canonical scoped writer missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid =
      'public.read_store_catalog_settings_scoped(uuid,uuid)'::regprocedure
      and p.prosecdef is true
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.proconfig::text like '%row_security=off%'
      and p.proconfig::text like '%search_path=pg_catalog, public, auth%'
  ) then
    raise exception 'FAIL 13: canonical reader hardening mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid =
      'public.upsert_store_catalog_settings_scoped(uuid,uuid,boolean,uuid)'::regprocedure
      and p.prosecdef is true
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.proconfig::text like '%row_security=off%'
      and p.proconfig::text like '%search_path=pg_catalog, public, auth%'
  ) then
    raise exception 'FAIL 14: canonical writer hardening mismatch';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.read_store_catalog_settings_scoped(uuid,uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.upsert_store_catalog_settings_scoped(uuid,uuid,boolean,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.upsert_store_catalog_settings_scoped(uuid,uuid,boolean,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.upsert_store_catalog_settings_scoped(uuid,uuid,boolean,uuid)',
       'EXECUTE'
     )
  then
    raise exception 'FAIL 15: reader/writer grants mismatch';
  end if;

  ---------------------------------------------------------------------------
  -- 7. Writer contém validação explícita de organization/store do arquivo.
  ---------------------------------------------------------------------------
  select pg_catalog.pg_get_functiondef(
    'public.upsert_store_catalog_settings_scoped(uuid,uuid,boolean,uuid)'::regprocedure
  )
  into v_writer_def;

  if v_writer_def not like '%f.organization_id = p_organization_id%'
     or v_writer_def not like '%f.store_id = p_store_id%'
     or v_writer_def not like '%f.status = ''active''%'
  then
    raise exception 'FAIL 16: writer does not explicitly validate selected file scope/status';
  end if;

  ---------------------------------------------------------------------------
  -- 8. Seleciona um arquivo real, ativo e já vinculado à importação do catálogo.
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
    raise exception 'FAIL 17: no eligible imported catalog file exists for transactional checks';
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
    raise exception 'FAIL 18: auth.uid fixture could not be established';
  end if;

  ---------------------------------------------------------------------------
  -- 9. SIM sem arquivo deve falhar fechado.
  ---------------------------------------------------------------------------
  v_state := null;
  begin
    perform 1
    from public.upsert_store_catalog_settings_scoped(
      v_target_org,
      v_target_store,
      true,
      null
    );
  exception
    when others then
      v_state := sqlstate;
  end;

  if v_state is distinct from '22023' then
    raise exception 'FAIL 19: enabled-without-file expected 22023, got %', v_state;
  end if;

  ---------------------------------------------------------------------------
  -- 10. NÃO com arquivo também deve falhar.
  ---------------------------------------------------------------------------
  v_state := null;
  begin
    perform 1
    from public.upsert_store_catalog_settings_scoped(
      v_target_org,
      v_target_store,
      false,
      v_target_file
    );
  exception
    when others then
      v_state := sqlstate;
  end;

  if v_state is distinct from '22023' then
    raise exception 'FAIL 20: disabled-with-file expected 22023, got %', v_state;
  end if;

  ---------------------------------------------------------------------------
  -- 11. UUID inexistente deve ser rejeitado.
  ---------------------------------------------------------------------------
  v_state := null;
  begin
    perform 1
    from public.upsert_store_catalog_settings_scoped(
      v_target_org,
      v_target_store,
      true,
      pg_catalog.gen_random_uuid()
    );
  exception
    when others then
      v_state := sqlstate;
  end;

  if v_state is distinct from '22023' then
    raise exception 'FAIL 21: unknown file expected 22023, got %', v_state;
  end if;

  ---------------------------------------------------------------------------
  -- 12. Se houver arquivo de outra loja, deve ser rejeitado pelo writer.
  ---------------------------------------------------------------------------
  select f.id
  into v_other_file
  from public.store_import_files f
  where (f.organization_id, f.store_id)
        is distinct from (v_target_org, v_target_store)
    and f.status = 'active'
    and nullif(pg_catalog.btrim(f.storage_bucket), '') is not null
    and nullif(pg_catalog.btrim(f.storage_path), '') is not null
  order by f.created_at desc nulls last, f.id
  limit 1;

  if v_other_file is not null then
    v_state := null;
    begin
      perform 1
      from public.upsert_store_catalog_settings_scoped(
        v_target_org,
        v_target_store,
        true,
        v_other_file
      );
    exception
      when others then
        v_state := sqlstate;
    end;

    if v_state is distinct from '22023' then
      raise exception 'FAIL 22: cross-store file expected 22023, got %', v_state;
    end if;
  end if;

  ---------------------------------------------------------------------------
  -- 13. Arquivo válido é aceito e o reader devolve a mesma authority.
  ---------------------------------------------------------------------------
  select *
  into v_row
  from public.upsert_store_catalog_settings_scoped(
    v_target_org,
    v_target_store,
    true,
    v_target_file
  );

  if v_row.organization_id is distinct from v_target_org
     or v_row.store_id is distinct from v_target_store
     or v_row.allow_full_catalog_send is distinct from true
     or v_row.customer_catalog_import_file_id is distinct from v_target_file
  then
    raise exception 'FAIL 23: valid enabled write returned unexpected row';
  end if;

  select *
  into v_row
  from public.read_store_catalog_settings_scoped(
    v_target_org,
    v_target_store
  );

  if v_row.allow_full_catalog_send is distinct from true
     or v_row.customer_catalog_import_file_id is distinct from v_target_file
  then
    raise exception 'FAIL 24: canonical reader did not return selected file';
  end if;

  ---------------------------------------------------------------------------
  -- 14. Arquivo autorizado não pode ser removido silenciosamente.
  ---------------------------------------------------------------------------
  v_state := null;
  begin
    delete from public.store_import_files
    where id = v_target_file
      and organization_id = v_target_org
      and store_id = v_target_store;
  exception
    when foreign_key_violation then
      v_state := sqlstate;
    when others then
      v_state := sqlstate;
  end;

  if v_state is distinct from '23503' then
    raise exception 'FAIL 25: selected file deletion expected FK violation 23503, got %', v_state;
  end if;

  ---------------------------------------------------------------------------
  -- 15. Desabilitar limpa a referência.
  ---------------------------------------------------------------------------
  select *
  into v_row
  from public.upsert_store_catalog_settings_scoped(
    v_target_org,
    v_target_store,
    false,
    null
  );

  if v_row.allow_full_catalog_send is distinct from false
     or v_row.customer_catalog_import_file_id is not null
  then
    raise exception 'FAIL 26: disabling must clear customer catalog file';
  end if;

  select *
  into v_row
  from public.read_store_catalog_settings_scoped(
    v_target_org,
    v_target_store
  );

  if v_row.allow_full_catalog_send is distinct from false
     or v_row.customer_catalog_import_file_id is not null
  then
    raise exception 'FAIL 27: canonical reader did not preserve disabled/null state';
  end if;

  ---------------------------------------------------------------------------
  -- 16. No máximo uma row por organization/store.
  ---------------------------------------------------------------------------
  select count(*)
  into v_count
  from public.store_catalog_settings s
  where s.organization_id = v_target_org
    and s.store_id = v_target_store;

  if v_count <> 1 then
    raise exception 'FAIL 28: expected exactly one canonical row, got %', v_count;
  end if;
end;
$runner$;

rollback;
