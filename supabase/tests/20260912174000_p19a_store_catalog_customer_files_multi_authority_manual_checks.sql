begin;

do $runner$
declare
  v_target_org uuid;
  v_target_store uuid;
  v_member_user uuid;
  v_file_a uuid;
  v_file_b uuid;
  v_array uuid[];
  v_state text;
  v_count bigint;
  v_primary uuid;
  v_allow boolean;
  v_ok boolean;
begin
  ---------------------------------------------------------------------------
  -- 01. Nova tabela existe.
  ---------------------------------------------------------------------------
  if pg_catalog.to_regclass('public.store_catalog_customer_files') is null then
    raise exception 'FAIL 01: store_catalog_customer_files missing';
  end if;

  ---------------------------------------------------------------------------
  -- 02. RLS habilitado.
  ---------------------------------------------------------------------------
  select c.relrowsecurity
  into v_ok
  from pg_catalog.pg_class c
  where c.oid = 'public.store_catalog_customer_files'::pg_catalog.regclass;

  if not coalesce(v_ok, false) then
    raise exception 'FAIL 02: RLS is not enabled on store_catalog_customer_files';
  end if;

  ---------------------------------------------------------------------------
  -- 03. Reader multi existe e e SECURITY DEFINER.
  ---------------------------------------------------------------------------
  select p.prosecdef
  into v_ok
  from pg_catalog.pg_proc p
  where p.oid = to_regprocedure(
    'public.read_store_catalog_settings_multi_scoped(uuid,uuid)'
  );

  if not coalesce(v_ok, false) then
    raise exception 'FAIL 03: multi reader missing or not SECURITY DEFINER';
  end if;

  ---------------------------------------------------------------------------
  -- 04. Writer multi existe e e SECURITY DEFINER.
  ---------------------------------------------------------------------------
  select p.prosecdef
  into v_ok
  from pg_catalog.pg_proc p
  where p.oid = to_regprocedure(
    'public.upsert_store_catalog_settings_multi_scoped(uuid,uuid,boolean,uuid[])'
  );

  if not coalesce(v_ok, false) then
    raise exception 'FAIL 04: multi writer missing or not SECURITY DEFINER';
  end if;

  ---------------------------------------------------------------------------
  -- 05. Backfill: todo legacy selecionado esta presente na lista canonica.
  ---------------------------------------------------------------------------
  if exists (
    select 1
    from public.store_catalog_settings s
    where s.allow_full_catalog_send is true
      and s.customer_catalog_import_file_id is not null
      and not exists (
        select 1
        from public.store_catalog_customer_files cf
        where cf.organization_id = s.organization_id
          and cf.store_id = s.store_id
          and cf.import_file_id = s.customer_catalog_import_file_id
      )
  ) then
    raise exception 'FAIL 05: legacy selected file was not backfilled';
  end if;

  ---------------------------------------------------------------------------
  -- 06. Escolhe store real com pelo menos dois arquivos elegiveis + membro.
  ---------------------------------------------------------------------------
  with eligible as (
    select
      f.organization_id,
      f.store_id,
      f.id,
      f.created_at,
      row_number() over (
        partition by f.organization_id, f.store_id
        order by f.created_at desc nulls last, f.id
      ) as rn
    from public.store_import_files f
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
  ),
  candidates as (
    select
      e.organization_id,
      e.store_id,
      (pg_catalog.array_agg(e.id order by e.rn))[1] as file_a,
      (pg_catalog.array_agg(e.id order by e.rn))[2] as file_b
    from eligible e
    where e.rn <= 2
    group by e.organization_id, e.store_id
    having count(*) >= 2
  )
  select
    c.organization_id,
    c.store_id,
    m.user_id,
    c.file_a,
    c.file_b
  into
    v_target_org,
    v_target_store,
    v_member_user,
    v_file_a,
    v_file_b
  from candidates c
  join public.memberships m
    on m.organization_id = c.organization_id
   and m.is_active is true
   and m.user_id is not null
  order by c.organization_id, c.store_id
  limit 1;

  if v_file_a is null or v_file_b is null then
    raise exception 'FAIL 06: no store with two eligible imported catalog files exists';
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
    raise exception 'FAIL 07: auth.uid fixture could not be established';
  end if;

  ---------------------------------------------------------------------------
  -- 08. Writer multi salva dois arquivos na ordem enviada.
  ---------------------------------------------------------------------------
  select r.customer_catalog_import_file_ids
  into v_array
  from public.upsert_store_catalog_settings_multi_scoped(
    v_target_org,
    v_target_store,
    true,
    array[v_file_a, v_file_b]::uuid[]
  ) r;

  if v_array is distinct from array[v_file_a, v_file_b]::uuid[] then
    raise exception 'FAIL 08: multi writer did not preserve file order';
  end if;

  ---------------------------------------------------------------------------
  -- 09. Parent policy fica ligada e mirror aponta para o primeiro arquivo.
  ---------------------------------------------------------------------------
  select
    s.allow_full_catalog_send,
    s.customer_catalog_import_file_id
  into
    v_allow,
    v_primary
  from public.store_catalog_settings s
  where s.organization_id = v_target_org
    and s.store_id = v_target_store;

  if v_allow is distinct from true or v_primary is distinct from v_file_a then
    raise exception 'FAIL 09: parent policy/mirror mismatch after multi write';
  end if;

  ---------------------------------------------------------------------------
  -- 10. Tabela filha contem exatamente dois arquivos.
  ---------------------------------------------------------------------------
  select count(*)
  into v_count
  from public.store_catalog_customer_files cf
  where cf.organization_id = v_target_org
    and cf.store_id = v_target_store;

  if v_count <> 2 then
    raise exception 'FAIL 10: expected exactly two canonical customer catalog files';
  end if;

  ---------------------------------------------------------------------------
  -- 11. Ordem 1/2 esta correta.
  ---------------------------------------------------------------------------
  if not exists (
    select 1
    from public.store_catalog_customer_files cf
    where cf.organization_id = v_target_org
      and cf.store_id = v_target_store
      and cf.import_file_id = v_file_a
      and cf.sort_order = 1
  ) or not exists (
    select 1
    from public.store_catalog_customer_files cf
    where cf.organization_id = v_target_org
      and cf.store_id = v_target_store
      and cf.import_file_id = v_file_b
      and cf.sort_order = 2
  ) then
    raise exception 'FAIL 11: canonical file sort order mismatch';
  end if;

  ---------------------------------------------------------------------------
  -- 12. Reader multi devolve a mesma lista ordenada.
  ---------------------------------------------------------------------------
  select r.customer_catalog_import_file_ids
  into v_array
  from public.read_store_catalog_settings_multi_scoped(
    v_target_org,
    v_target_store
  ) r;

  if v_array is distinct from array[v_file_a, v_file_b]::uuid[] then
    raise exception 'FAIL 12: multi reader did not return canonical ordered list';
  end if;

  ---------------------------------------------------------------------------
  -- 13. Reader antigo continua vendo o primeiro arquivo (compatibilidade).
  ---------------------------------------------------------------------------
  select r.customer_catalog_import_file_id
  into v_primary
  from public.read_store_catalog_settings_scoped(
    v_target_org,
    v_target_store
  ) r;

  if v_primary is distinct from v_file_a then
    raise exception 'FAIL 13: legacy reader mirror compatibility mismatch';
  end if;

  ---------------------------------------------------------------------------
  -- 14. Segundo arquivo tambem esta protegido (prova 1:N real).
  ---------------------------------------------------------------------------
  v_state := null;

  begin
    delete from public.store_import_file_items i
    where i.import_file_id = v_file_b
      and i.organization_id = v_target_org
      and i.store_id = v_target_store;
  exception
    when others then
      v_state := sqlstate;
  end;

  if v_state is distinct from '23503' then
    raise exception
      'FAIL 14: second selected file link deletion expected 23503, got %',
      v_state;
  end if;

  ---------------------------------------------------------------------------
  -- 15. Duplicidade e rejeitada.
  ---------------------------------------------------------------------------
  v_state := null;

  begin
    perform 1
    from public.upsert_store_catalog_settings_multi_scoped(
      v_target_org,
      v_target_store,
      true,
      array[v_file_a, v_file_a]::uuid[]
    );
  exception
    when others then
      v_state := sqlstate;
  end;

  if v_state is distinct from '22023' then
    raise exception 'FAIL 15: duplicate ids expected 22023, got %', v_state;
  end if;

  ---------------------------------------------------------------------------
  -- 16. "Sim" sem arquivo e rejeitado.
  ---------------------------------------------------------------------------
  v_state := null;

  begin
    perform 1
    from public.upsert_store_catalog_settings_multi_scoped(
      v_target_org,
      v_target_store,
      true,
      '{}'::uuid[]
    );
  exception
    when others then
      v_state := sqlstate;
  end;

  if v_state is distinct from '22023' then
    raise exception 'FAIL 16: enabled empty list expected 22023, got %', v_state;
  end if;

  ---------------------------------------------------------------------------
  -- 17. "Nao" com arquivo e rejeitado.
  ---------------------------------------------------------------------------
  v_state := null;

  begin
    perform 1
    from public.upsert_store_catalog_settings_multi_scoped(
      v_target_org,
      v_target_store,
      false,
      array[v_file_a]::uuid[]
    );
  exception
    when others then
      v_state := sqlstate;
  end;

  if v_state is distinct from '22023' then
    raise exception 'FAIL 17: disabled nonempty list expected 22023, got %', v_state;
  end if;

  ---------------------------------------------------------------------------
  -- 18. Arquivo inexistente e rejeitado.
  ---------------------------------------------------------------------------
  v_state := null;

  begin
    perform 1
    from public.upsert_store_catalog_settings_multi_scoped(
      v_target_org,
      v_target_store,
      true,
      array['00000000-0000-0000-0000-000000000001'::uuid]::uuid[]
    );
  exception
    when others then
      v_state := sqlstate;
  end;

  if v_state is distinct from '22023' then
    raise exception 'FAIL 18: invalid file expected 22023, got %', v_state;
  end if;

  ---------------------------------------------------------------------------
  -- 19. Writer antigo continua sincronizando a lista para exatamente 1.
  ---------------------------------------------------------------------------
  perform 1
  from public.upsert_store_catalog_settings_scoped(
    v_target_org,
    v_target_store,
    true,
    v_file_b
  );

  select count(*)
  into v_count
  from public.store_catalog_customer_files cf
  where cf.organization_id = v_target_org
    and cf.store_id = v_target_store
    and cf.import_file_id = v_file_b
    and cf.sort_order = 1;

  if v_count <> 1 then
    raise exception 'FAIL 19: legacy writer did not sync one canonical file';
  end if;

  select count(*)
  into v_count
  from public.store_catalog_customer_files cf
  where cf.organization_id = v_target_org
    and cf.store_id = v_target_store;

  if v_count <> 1 then
    raise exception 'FAIL 20: legacy writer left extra canonical files';
  end if;

  ---------------------------------------------------------------------------
  -- 21. Writer antigo desligando limpa a lista e o mirror.
  ---------------------------------------------------------------------------
  perform 1
  from public.upsert_store_catalog_settings_scoped(
    v_target_org,
    v_target_store,
    false,
    null
  );

  select
    s.allow_full_catalog_send,
    s.customer_catalog_import_file_id
  into
    v_allow,
    v_primary
  from public.store_catalog_settings s
  where s.organization_id = v_target_org
    and s.store_id = v_target_store;

  if v_allow is distinct from false or v_primary is not null then
    raise exception 'FAIL 21: legacy disable did not clear parent policy/mirror';
  end if;

  select count(*)
  into v_count
  from public.store_catalog_customer_files cf
  where cf.organization_id = v_target_org
    and cf.store_id = v_target_store;

  if v_count <> 0 then
    raise exception 'FAIL 22: legacy disable did not clear canonical file list';
  end if;

  ---------------------------------------------------------------------------
  -- 23. Sem arquivos autorizados, vinculo pode ser removido novamente.
  -- Tudo sera revertido pelo ROLLBACK final.
  ---------------------------------------------------------------------------
  delete from public.store_import_file_items i
  where i.import_file_id = v_file_b
    and i.organization_id = v_target_org
    and i.store_id = v_target_store;

  if found is not true then
    raise exception 'FAIL 23: unselected import link should be removable';
  end if;
end;
$runner$;

rollback;
