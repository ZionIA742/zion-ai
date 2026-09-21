-- Manual checks for P9 protected Strategy settings system reader.
-- Safe to run after applying:
-- supabase/migrations/20260916203000_p9_store_strategy_settings_system_reader.sql

create temp table p9_store_strategy_settings_system_reader_results (
  test_name text primary key,
  status text not null,
  details text
) on commit drop;

do $$
declare
  v_proc regprocedure := 'public.read_store_strategy_settings_by_system(uuid,uuid)'::regprocedure;
  v_config text[];
  v_owner text;
  v_strategy_row public.store_strategy_settings%rowtype;
  v_reader_row record;
  v_row_count integer;
  v_fail_closed_sqlstate text;
  v_fail_closed_message text;
begin
  select pg_catalog.pg_get_userbyid(p.proowner), p.proconfig
  into v_owner, v_config
  from pg_catalog.pg_proc p
  where p.oid = v_proc;

  if v_owner <> 'postgres' then
    raise exception 'FAIL: reader owner must be postgres';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = v_proc
      and p.prosecdef
      and coalesce(p.proconfig @> array[
        'search_path=pg_catalog, public, pg_temp',
        'row_security=off'
      ]::text[], false)
  ) then
    raise exception 'FAIL: reader must be SECURITY DEFINER with safe search_path and row_security off';
  end if;

  insert into p9_store_strategy_settings_system_reader_results
    values ('01_reader_hardening', 'PASS', 'reader is postgres-owned SECURITY DEFINER with fixed search_path and row_security off');

  if not has_function_privilege('service_role', v_proc, 'EXECUTE') then
    raise exception 'FAIL: service_role must have EXECUTE on strategy reader';
  end if;

  if has_function_privilege('authenticated', v_proc, 'EXECUTE')
     or has_function_privilege('anon', v_proc, 'EXECUTE')
     or has_function_privilege('public', v_proc, 'EXECUTE') then
    raise exception 'FAIL: only service_role may execute strategy reader';
  end if;

  insert into p9_store_strategy_settings_system_reader_results
    values ('02_reader_execute_grants', 'PASS', 'service_role can execute; authenticated, anon, and public cannot');

  if has_table_privilege('service_role', 'public.store_strategy_settings', 'SELECT') then
    raise exception 'FAIL: service_role must not receive direct SELECT on store_strategy_settings';
  end if;

  if has_table_privilege('service_role', 'public.store_payment_settings', 'SELECT') then
    raise exception 'FAIL: this P9 reader fix must not grant direct SELECT on store_payment_settings';
  end if;

  insert into p9_store_strategy_settings_system_reader_results
    values ('03_no_direct_service_role_table_select', 'PASS', 'no direct service_role SELECT exists for Strategy or Payment settings');

  select *
  into v_strategy_row
  from public.store_strategy_settings
  order by updated_at desc nulls last, created_at desc nulls last
  limit 1;

  if v_strategy_row.organization_id is null then
    insert into p9_store_strategy_settings_system_reader_results
      values ('04_reader_scope_existing_row', 'SKIP', 'no existing strategy settings row available to validate row contents');
  else
    select count(*)
    into v_row_count
    from public.read_store_strategy_settings_by_system(
      v_strategy_row.organization_id,
      v_strategy_row.store_id
    );

    if v_row_count <> 1 then
      raise exception 'FAIL: reader must return exactly one row for an existing exact organization/store scope';
    end if;

    select *
    into v_reader_row
    from public.read_store_strategy_settings_by_system(
      v_strategy_row.organization_id,
      v_strategy_row.store_id
    );

    if v_reader_row.organization_id <> v_strategy_row.organization_id
       or v_reader_row.store_id <> v_strategy_row.store_id then
      raise exception 'FAIL: reader returned a row outside requested organization/store scope';
    end if;

    insert into p9_store_strategy_settings_system_reader_results
      values ('04_reader_scope_existing_row', 'PASS', 'reader returns only the exact organization/store strategy row');

    begin
      perform *
      from public.read_store_strategy_settings_by_system(
        v_strategy_row.organization_id,
        '00000000-0000-0000-0000-000000000000'::uuid
      );
    exception
      when others then
        v_fail_closed_sqlstate := sqlstate;
        v_fail_closed_message := sqlerrm;
    end;

    if v_fail_closed_sqlstate <> '22023'
       or v_fail_closed_message <> 'store does not belong to organization' then
      raise exception
        'FAIL: reader must reject invalid organization/store scope with SQLSTATE 22023 and expected message; got %, %',
        coalesce(v_fail_closed_sqlstate, '<none>'),
        coalesce(v_fail_closed_message, '<none>');
    end if;

    insert into p9_store_strategy_settings_system_reader_results
      values ('05_reader_wrong_store_scope', 'PASS', 'reader rejects invalid organization/store scope with SQLSTATE 22023');
  end if;
end $$;

table p9_store_strategy_settings_system_reader_results
order by test_name;
