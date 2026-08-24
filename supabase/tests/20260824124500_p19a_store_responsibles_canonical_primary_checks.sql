begin;

create temp table p19a_store_responsibles_test_results (
  test_name text primary key,
  result text not null,
  detail text not null
) on commit drop;

do $runner$
declare
  v_target public.store_responsibles%rowtype;
  v_other_store_id uuid;
  v_count_before bigint;
  v_count_after bigint;
  v_first_id uuid;
  v_second_id uuid;
  v_wrapper_id uuid;
  v_blocked boolean;
  v_definition text;
begin
  ---------------------------------------------------------------------------
  -- 1. Colunas canônicas
  ---------------------------------------------------------------------------

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_responsibles'
      and column_name = 'is_primary'
      and is_nullable = 'NO'
      and column_default = 'false'
  ) then
    raise exception 'FAIL: is_primary is not NOT NULL DEFAULT false';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_responsibles'
      and column_name = 'is_active'
      and is_nullable = 'NO'
      and column_default = 'true'
  ) then
    raise exception 'FAIL: is_active is not NOT NULL DEFAULT true';
  end if;

  insert into p19a_store_responsibles_test_results
  values (
    '01_schema_columns',
    'PASS',
    'is_primary/is_active are NOT NULL with expected defaults'
  );

  ---------------------------------------------------------------------------
  -- 2. Índice único do primário ativo
  ---------------------------------------------------------------------------

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'store_responsibles'
      and indexname = 'store_responsibles_one_active_primary_per_store_uidx'
      and indexdef ilike '%unique index%'
      and indexdef ilike '%is_primary is true%'
      and indexdef ilike '%is_active is true%'
  ) then
    raise exception 'FAIL: canonical active-primary unique index missing';
  end if;

  insert into p19a_store_responsibles_test_results
  values (
    '02_unique_index_exists',
    'PASS',
    'partial unique index exists for active primary responsible'
  );

  ---------------------------------------------------------------------------
  -- 3. FK composta store + organization
  ---------------------------------------------------------------------------

  select pg_get_constraintdef(c.oid)
  into v_definition
  from pg_constraint c
  where c.conrelid = 'public.store_responsibles'::regclass
    and c.conname = 'store_responsibles_store_scope_fkey';

  if v_definition is null
     or v_definition not ilike '%foreign key (store_id, organization_id)%'
     or v_definition not ilike '%references stores(id, organization_id)%'
  then
    raise exception 'FAIL: composite store scope FK missing or unexpected: %',
      coalesce(v_definition, '<missing>');
  end if;

  insert into p19a_store_responsibles_test_results
  values (
    '03_composite_scope_fk',
    'PASS',
    v_definition
  );

  ---------------------------------------------------------------------------
  -- 4. Backfill real: precisamos de um primário ativo existente
  ---------------------------------------------------------------------------

  select *
  into v_target
  from public.store_responsibles
  where is_primary is true
    and is_active is true
  limit 1;

  if not found then
    raise exception 'FAIL: no active primary responsible exists after backfill';
  end if;

  insert into p19a_store_responsibles_test_results
  values (
    '04_backfill_singleton',
    'PASS',
    format(
      'existing responsible %s is active primary for store %s',
      v_target.id,
      v_target.store_id
    )
  );

  ---------------------------------------------------------------------------
  -- 5. Segunda pessoa primária ativa deve ser recusada
  ---------------------------------------------------------------------------

  v_blocked := false;

  begin
    insert into public.store_responsibles (
      organization_id,
      store_id,
      name,
      whatsapp_number,
      role,
      is_primary,
      is_active
    )
    values (
      v_target.organization_id,
      v_target.store_id,
      'P19A RUNNER DUPLICATE PRIMARY',
      '5511999999999',
      'owner',
      true,
      true
    );
  exception
    when unique_violation then
      v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'FAIL: database allowed two active primary responsibles';
  end if;

  insert into p19a_store_responsibles_test_results
  values (
    '05_duplicate_primary_blocked',
    'PASS',
    'database rejected a second active primary for the same store'
  );

  ---------------------------------------------------------------------------
  -- 6. Scope organization/store incompatível deve ser recusado
  ---------------------------------------------------------------------------

  select s.id
  into v_other_store_id
  from public.stores s
  where s.organization_id <> v_target.organization_id
  limit 1;

  if v_other_store_id is not null then
    v_blocked := false;

    begin
      insert into public.store_responsibles (
        organization_id,
        store_id,
        name,
        whatsapp_number,
        role,
        is_primary,
        is_active
      )
      values (
        v_target.organization_id,
        v_other_store_id,
        'P19A RUNNER INVALID SCOPE',
        '5511888888888',
        'owner',
        false,
        true
      );
    exception
      when foreign_key_violation then
        v_blocked := true;
    end;

    if not v_blocked then
      raise exception 'FAIL: database accepted mismatched organization/store';
    end if;

    insert into p19a_store_responsibles_test_results
    values (
      '06_cross_tenant_fk_blocked',
      'PASS',
      'composite FK rejected mismatched organization/store'
    );
  else
    insert into p19a_store_responsibles_test_results
    values (
      '06_cross_tenant_fk_blocked',
      'SKIP',
      'no store from another organization exists to exercise this assertion'
    );
  end if;

  ---------------------------------------------------------------------------
  -- 7. Writer canônico deve ser idempotente
  ---------------------------------------------------------------------------

  select count(*)
  into v_count_before
  from public.store_responsibles
  where organization_id = v_target.organization_id
    and store_id = v_target.store_id;

  select r.id
  into v_first_id
  from public.upsert_store_primary_responsible_scoped(
    v_target.organization_id,
    v_target.store_id,
    v_target.name,
    v_target.whatsapp_number
  ) r;

  select r.id
  into v_second_id
  from public.upsert_store_primary_responsible_scoped(
    v_target.organization_id,
    v_target.store_id,
    v_target.name,
    v_target.whatsapp_number
  ) r;

  select count(*)
  into v_count_after
  from public.store_responsibles
  where organization_id = v_target.organization_id
    and store_id = v_target.store_id;

  if v_first_id is distinct from v_target.id
     or v_second_id is distinct from v_target.id
     or v_count_after <> v_count_before
  then
    raise exception
      'FAIL: canonical writer is not idempotent: original %, first %, second %, count % -> %',
      v_target.id,
      v_first_id,
      v_second_id,
      v_count_before,
      v_count_after;
  end if;

  insert into p19a_store_responsibles_test_results
  values (
    '07_writer_idempotency',
    'PASS',
    format(
      'same responsible id preserved (%s); row count remained %s',
      v_target.id,
      v_count_after
    )
  );

  ---------------------------------------------------------------------------
  -- 8. Writer com legacy mirror precisa executar de verdade
  -- Usa exatamente os valores existentes, portanto não muda semanticamente nada.
  ---------------------------------------------------------------------------

  select r.id
  into v_wrapper_id
  from public.upsert_store_primary_responsible_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.store_id,
    v_target.name,
    v_target.whatsapp_number
  ) r;

  if v_wrapper_id is distinct from v_target.id then
    raise exception
      'FAIL: transactional mirror writer returned unexpected responsible id: % vs %',
      v_wrapper_id,
      v_target.id;
  end if;

  insert into p19a_store_responsibles_test_results
  values (
    '08_transactional_writer_executes',
    'PASS',
    'canonical + legacy mirror RPC executed successfully with the existing responsible'
  );

  ---------------------------------------------------------------------------
  -- 9. Privilégios das RPCs
  ---------------------------------------------------------------------------

  if has_function_privilege(
    'anon',
    'public.upsert_store_primary_responsible_scoped(uuid,uuid,text,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: anon can execute canonical writer';
  end if;

  if has_function_privilege(
    'anon',
    'public.upsert_store_primary_responsible_with_legacy_mirror_scoped(uuid,uuid,text,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: anon can execute transactional writer';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.upsert_store_primary_responsible_scoped(uuid,uuid,text,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated cannot execute canonical writer';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.upsert_store_primary_responsible_with_legacy_mirror_scoped(uuid,uuid,text,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated cannot execute transactional writer';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.upsert_store_primary_responsible_scoped(uuid,uuid,text,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: service_role cannot execute canonical writer';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.upsert_store_primary_responsible_with_legacy_mirror_scoped(uuid,uuid,text,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: service_role cannot execute transactional writer';
  end if;

  insert into p19a_store_responsibles_test_results
  values (
    '09_rpc_privileges',
    'PASS',
    'anon denied; authenticated and service_role granted as designed'
  );

  ---------------------------------------------------------------------------
  -- 10. RLS permanece ligado
  ---------------------------------------------------------------------------

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'store_responsibles'
      and c.relrowsecurity is true
  ) then
    raise exception 'FAIL: RLS is not enabled on store_responsibles';
  end if;

  insert into p19a_store_responsibles_test_results
  values (
    '10_rls_enabled',
    'PASS',
    'RLS remains enabled on store_responsibles'
  );

end;
$runner$;

select
  test_name,
  result,
  detail
from p19a_store_responsibles_test_results
order by test_name;

rollback;