begin;

create temp table p19a_store_channel_settings_test_results (
  ordinal integer primary key,
  test_name text not null,
  result text not null,
  detail text not null
) on commit drop;

do $runner$
declare
  v_target public.stores%rowtype;
  v_other_store public.stores%rowtype;
  v_member public.memberships%rowtype;
  v_base_writer_regprocedure regprocedure;
  v_wrapper_writer_regprocedure regprocedure;
  v_base_security_definer boolean;
  v_wrapper_security_definer boolean;
  v_base_config text[];
  v_wrapper_config text[];
  v_base_owner text;
  v_wrapper_owner text;
  v_first_result public.store_channel_settings%rowtype;
  v_second_result public.store_channel_settings%rowtype;
  v_updated_result public.store_channel_settings%rowtype;
  v_answer jsonb;
  v_disallowed_before jsonb;
  v_disallowed_after jsonb;
  v_secret_before jsonb;
  v_secret_after jsonb;
  v_canonical_row_count bigint;
  v_other_store_marker_count bigint;
  v_expected_mirror_count bigint;
  v_own_scope_visible_count bigint;
  v_other_scope_visible_count bigint;
  v_cross_tenant_sqlstate text;
  v_cross_tenant_message text;
  v_cross_org_id uuid;
  v_cross_store_id uuid;
  v_updated_at_advanced boolean;
  v_base_permission_blocked boolean := false;
begin
  select store_row.*
  into v_target
  from public.stores store_row
  join public.memberships membership_row
    on membership_row.organization_id = store_row.organization_id
   and membership_row.is_active is true
   and membership_row.user_id is not null
  order by store_row.created_at nulls last, store_row.id
  limit 1;

  if not found then
    raise exception 'FAIL: no store with active membership available to exercise channel settings runner';
  end if;

  select membership_row.*
  into v_member
  from public.memberships membership_row
  where membership_row.organization_id = v_target.organization_id
    and membership_row.is_active is true
    and membership_row.user_id is not null
  order by membership_row.created_at nulls last, membership_row.id
  limit 1;

  if not found then
    raise exception 'FAIL: no active membership available to exercise authenticated channel writer';
  end if;

  select store_row.*
  into v_other_store
  from public.stores store_row
  where store_row.organization_id <> v_target.organization_id
  order by store_row.created_at nulls last, store_row.id
  limit 1;

  if v_other_store.id is not null then
    v_cross_org_id := v_other_store.organization_id;
    v_cross_store_id := v_other_store.id;
  else
    v_cross_org_id := '00000000-0000-0000-0000-000000000001'::uuid;
    if v_cross_org_id = v_target.organization_id then
      v_cross_org_id := '00000000-0000-0000-0000-000000000002'::uuid;
    end if;
    v_cross_store_id := '00000000-0000-0000-0000-000000000101'::uuid;
  end if;

  v_base_writer_regprocedure := pg_catalog.to_regprocedure(
    'public.upsert_store_channel_settings_scoped(uuid,uuid,text,boolean,boolean,text,text,boolean,text,text,text,text)'
  );
  v_wrapper_writer_regprocedure := pg_catalog.to_regprocedure(
    'public.upsert_store_channel_settings_with_legacy_mirror_scoped(uuid,uuid,text,boolean,boolean,text,text,boolean,text,text,text,text)'
  );

  if v_base_writer_regprocedure is null then
    raise exception 'FAIL: internal channel settings writer signature missing';
  end if;

  if v_wrapper_writer_regprocedure is null then
    raise exception 'FAIL: wrapper channel settings writer signature missing';
  end if;

  select
    proc_row.prosecdef,
    proc_row.proconfig,
    pg_catalog.pg_get_userbyid(proc_row.proowner)
  into
    v_base_security_definer,
    v_base_config,
    v_base_owner
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_base_writer_regprocedure::oid;

  select
    proc_row.prosecdef,
    proc_row.proconfig,
    pg_catalog.pg_get_userbyid(proc_row.proowner)
  into
    v_wrapper_security_definer,
    v_wrapper_config,
    v_wrapper_owner
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_wrapper_writer_regprocedure::oid;

  ---------------------------------------------------------------------------
  -- 01-07 schema, columns, RLS and grants
  ---------------------------------------------------------------------------

  if pg_catalog.to_regclass('public.store_channel_settings') is null then
    raise exception 'FAIL: store_channel_settings table missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.store_channel_settings'::regclass
      and constraint_row.conname = 'store_channel_settings_pkey'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) = 'PRIMARY KEY (organization_id, store_id)'
  ) then
    raise exception 'FAIL: store_channel_settings primary key must be exactly organization_id plus store_id';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.store_channel_settings'::regclass
      and constraint_row.conname = 'store_channel_settings_store_scope_fkey'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike
        'FOREIGN KEY (store_id, organization_id) REFERENCES stores(id, organization_id)%'
  ) then
    raise exception 'FAIL: store_channel_settings organization/store foreign key missing or malformed';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_channel_settings'
      and (
        column_name like '%secret%'
        or column_name like '%token%'
        or column_name like '%password%'
        or column_name like '%credential%'
        or column_name like '%status%'
        or column_name like '%health%'
        or column_name like '%runtime%'
        or column_name like '%webhook%'
        or column_name like '%whatsapp%'
      )
  ) then
    raise exception 'FAIL: store_channel_settings contains secret, status, runtime, webhook or whatsapp columns';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.store_channel_settings'::regclass
      and trigger_row.tgname = 'store_channel_settings_touch_updated_at'
      and trigger_row.tgenabled = 'O'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'FAIL: store_channel_settings updated_at trigger missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class class_row
    where class_row.oid = 'public.store_channel_settings'::regclass
      and class_row.relrowsecurity is true
  ) then
    raise exception 'FAIL: row level security must be enabled on store_channel_settings';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'store_channel_settings'
      and policyname = 'store_channel_settings_select_by_active_membership'
      and cmd = 'SELECT'
  ) then
    raise exception 'FAIL: store_channel_settings select policy missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'store_channel_settings'
      and cmd <> 'SELECT'
  ) then
    raise exception 'FAIL: store_channel_settings must not expose direct write policies';
  end if;

  if not has_table_privilege('authenticated', 'public.store_channel_settings', 'SELECT') then
    raise exception 'FAIL: authenticated select grant missing on store_channel_settings';
  end if;

  if has_table_privilege('authenticated', 'public.store_channel_settings', 'INSERT')
     or has_table_privilege('authenticated', 'public.store_channel_settings', 'UPDATE')
     or has_table_privilege('authenticated', 'public.store_channel_settings', 'DELETE')
  then
    raise exception 'FAIL: authenticated can still write store_channel_settings directly';
  end if;

  insert into p19a_store_channel_settings_test_results
  values
    (1, '01_table_exists', 'PASS', 'store_channel_settings table exists'),
    (2, '02_primary_key', 'PASS', 'organization_id plus store_id is the exact primary key'),
    (3, '03_store_scope_foreign_key', 'PASS', 'store scope foreign key binds store_id to organization_id'),
    (4, '04_no_secret_or_status_columns', 'PASS', 'canonical table has no secret, credential, status, runtime, webhook or whatsapp columns'),
    (5, '05_updated_at_trigger', 'PASS', 'updated_at trigger is enabled'),
    (6, '06_rls_select_only', 'PASS', 'RLS is enabled with only the active-membership SELECT policy'),
    (7, '07_authenticated_select_without_direct_write', 'PASS', 'authenticated can read canonically but cannot insert, update or delete the table directly');

  ---------------------------------------------------------------------------
  -- 08-13 writers, grants and nullable schema contract
  ---------------------------------------------------------------------------

  if not coalesce(v_base_security_definer, false)
     or v_base_owner <> 'postgres'
     or not exists (
       select 1
       from unnest(coalesce(v_base_config, array[]::text[])) as config_row(value)
       where config_row.value like 'search_path=%pg_catalog%public%pg_temp%'
     )
     or not exists (
       select 1
       from unnest(coalesce(v_base_config, array[]::text[])) as config_row(value)
       where config_row.value = 'row_security=off'
     )
  then
    raise exception 'FAIL: internal channel writer must be owned by postgres, SECURITY DEFINER, with safe search_path and row_security off';
  end if;

  if not coalesce(v_wrapper_security_definer, false)
     or v_wrapper_owner <> 'postgres'
     or not exists (
       select 1
       from unnest(coalesce(v_wrapper_config, array[]::text[])) as config_row(value)
       where config_row.value like 'search_path=%pg_catalog%public%pg_temp%'
     )
     or not exists (
       select 1
       from unnest(coalesce(v_wrapper_config, array[]::text[])) as config_row(value)
       where config_row.value = 'row_security=off'
     )
  then
    raise exception 'FAIL: wrapper channel writer must be owned by postgres, SECURITY DEFINER, with safe search_path and row_security off';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.upsert_store_channel_settings_scoped(uuid,uuid,text,boolean,boolean,text,text,boolean,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated must not execute the internal channel writer directly';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.upsert_store_channel_settings_with_legacy_mirror_scoped(uuid,uuid,text,boolean,boolean,text,text,boolean,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated cannot execute the wrapper channel writer';
  end if;

  if has_function_privilege(
    'service_role',
    'public.upsert_store_channel_settings_scoped(uuid,uuid,text,boolean,boolean,text,text,boolean,text,text,text,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'public.upsert_store_channel_settings_with_legacy_mirror_scoped(uuid,uuid,text,boolean,boolean,text,text,boolean,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: service_role should not execute channel writers';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_channel_settings'
      and column_name = 'commercial_receives_real_clients'
      and is_nullable = 'YES'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_channel_settings'
      and column_name = 'commercial_is_official_sales_channel'
      and is_nullable = 'YES'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_channel_settings'
      and column_name = 'commercial_human_handoff_enabled'
      and is_nullable = 'YES'
  ) then
    raise exception 'FAIL: boolean columns must remain nullable at schema level for legacy/backfill compatibility';
  end if;

  insert into p19a_store_channel_settings_test_results
  values
    (8, '08_internal_writer_hardening', 'PASS', 'internal writer is postgres-owned SECURITY DEFINER with safe search_path and row_security off'),
    (9, '09_wrapper_writer_hardening', 'PASS', 'wrapper writer is postgres-owned SECURITY DEFINER with safe search_path and row_security off'),
    (10, '10_authenticated_cannot_call_base_writer', 'PASS', 'authenticated has no EXECUTE grant on the base writer'),
    (11, '11_authenticated_can_call_wrapper', 'PASS', 'authenticated has EXECUTE only on the wrapper writer'),
    (12, '12_service_role_cannot_execute_writers', 'PASS', 'service_role does not gain write access through the channel writers'),
    (13, '13_boolean_columns_stay_nullable_in_schema', 'PASS', 'booleans remain nullable for legacy/backfill while canonical saves require explicit true or false');

  ---------------------------------------------------------------------------
  -- 14-17 base writer validation rules
  -- Keep the SQL Editor role privileged here, but inject the same JWT claims
  -- used by auth.uid(). This lets us exercise the internal helper even though
  -- authenticated is intentionally denied EXECUTE on it.
  ---------------------------------------------------------------------------

  perform pg_catalog.set_config('request.jwt.claim.sub', v_member.user_id::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    json_build_object('sub', v_member.user_id, 'role', 'authenticated')::text,
    true
  );

  begin
    perform public.upsert_store_channel_settings_scoped(
      v_target.organization_id, v_target.id, 'Canal Base', null, true,
      'WhatsApp', 'Principal', true, null, 'Provider', 'API', null
    );
    raise exception 'FAIL: base writer accepted null commercial_receives_real_clients';
  exception
    when others then
      if sqlstate <> 'P0001' or position('COMMERCIAL_RECEIVES_REAL_CLIENTS_REQUIRED' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.upsert_store_channel_settings_scoped(
      v_target.organization_id, v_target.id, 'Canal Base', true, null,
      'WhatsApp', 'Principal', true, null, 'Provider', 'API', null
    );
    raise exception 'FAIL: base writer accepted null commercial_is_official_sales_channel';
  exception
    when others then
      if sqlstate <> 'P0001' or position('COMMERCIAL_IS_OFFICIAL_SALES_CHANNEL_REQUIRED' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.upsert_store_channel_settings_scoped(
      v_target.organization_id, v_target.id, 'Canal Base', true, true,
      'WhatsApp', 'Principal', null, null, 'Provider', 'API', null
    );
    raise exception 'FAIL: base writer accepted null commercial_human_handoff_enabled';
  exception
    when others then
      if sqlstate <> 'P0001' or position('COMMERCIAL_HUMAN_HANDOFF_ENABLED_REQUIRED' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.upsert_store_channel_settings_scoped(
      v_target.organization_id, v_target.id, '   ', true, true,
      'WhatsApp', 'Principal', true, null, 'Provider', 'API', null
    );
    raise exception 'FAIL: base writer accepted blank commercial_channel_name';
  exception
    when others then
      if sqlstate <> 'P0001' or position('COMMERCIAL_CHANNEL_NAME_REQUIRED' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.upsert_store_channel_settings_scoped(
      v_target.organization_id, v_target.id, 'Canal Base', true, true,
      '   ', 'Principal', true, null, 'Provider', 'API', null
    );
    raise exception 'FAIL: base writer accepted blank commercial_channel_type';
  exception
    when others then
      if sqlstate <> 'P0001' or position('COMMERCIAL_CHANNEL_TYPE_REQUIRED' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.upsert_store_channel_settings_scoped(
      v_target.organization_id, v_target.id, 'Canal Base', true, true,
      'WhatsApp', '   ', true, null, 'Provider', 'API', null
    );
    raise exception 'FAIL: base writer accepted blank commercial_entry_priority';
  exception
    when others then
      if sqlstate <> 'P0001' or position('COMMERCIAL_ENTRY_PRIORITY_REQUIRED' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.upsert_store_channel_settings_scoped(
      v_target.organization_id, v_target.id, 'Canal Base', true, true,
      'WhatsApp', 'Principal', true, null, '   ', 'API', null
    );
    raise exception 'FAIL: base writer accepted blank integration_provider_name';
  exception
    when others then
      if sqlstate <> 'P0001' or position('INTEGRATION_PROVIDER_REQUIRED' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.upsert_store_channel_settings_scoped(
      v_target.organization_id, v_target.id, 'Canal Base', true, true,
      'WhatsApp', 'Principal', true, null, 'Provider', '   ', null
    );
    raise exception 'FAIL: base writer accepted blank integration_connection_mode';
  exception
    when others then
      if sqlstate <> 'P0001' or position('INTEGRATION_CONNECTION_MODE_REQUIRED' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  insert into p19a_store_channel_settings_test_results
  values
    (14, '14_null_receives_real_clients_rejected', 'PASS', 'base writer rejects NULL instead of mirroring it as Não'),
    (15, '15_null_official_channel_rejected', 'PASS', 'base writer rejects NULL official-channel state instead of mirroring it as Não'),
    (16, '16_null_handoff_rejected', 'PASS', 'base writer rejects NULL human-handoff state instead of mirroring it as Não'),
    (17, '17_blank_required_text_rejected', 'PASS', 'all required human text fields reject blank input');

  ---------------------------------------------------------------------------
  -- 18-26 wrapper save, mirror, tenant isolation and idempotency
  ---------------------------------------------------------------------------

  select coalesce(
    jsonb_agg(
      jsonb_build_object('question_key', answer_row.question_key, 'answer', answer_row.answer)
      order by answer_row.question_key, answer_row.answer::text
    ),
    '[]'::jsonb
  )
  into v_disallowed_before
  from public.store_onboarding_answers answer_row
  where answer_row.organization_id = v_target.organization_id
    and answer_row.store_id = v_target.id
    and answer_row.question_key in (
      'commercial_whatsapp',
      'responsible_whatsapp',
      'integration_test_status',
      'webhook_inbound_status',
      'external_send_status',
      'assistant_alerts_route',
      'urgency_route',
      'reports_route'
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object('question_key', answer_row.question_key, 'answer', answer_row.answer)
      order by answer_row.question_key, answer_row.answer::text
    ),
    '[]'::jsonb
  )
  into v_secret_before
  from public.store_onboarding_answers answer_row
  where answer_row.organization_id = v_target.organization_id
    and answer_row.store_id = v_target.id
    and (
      answer_row.question_key like '%secret%'
      or answer_row.question_key like '%token%'
      or answer_row.question_key like '%password%'
      or answer_row.question_key like '%credential%'
    );

  if v_other_store.id is not null then
    insert into public.store_channel_settings (
      organization_id,
      store_id,
      commercial_channel_name,
      commercial_receives_real_clients,
      commercial_is_official_sales_channel,
      commercial_channel_type,
      commercial_entry_priority,
      commercial_human_handoff_enabled,
      commercial_channel_notes,
      integration_provider_name,
      integration_connection_mode,
      integrations_notes
    )
    values (
      v_other_store.organization_id,
      v_other_store.id,
      'Outro Tenant Runner',
      true,
      true,
      'WhatsApp',
      'Principal',
      true,
      'Linha fixture para validar select escopado',
      'Provider other',
      'API',
      'Fixture other tenant'
    )
    on conflict (organization_id, store_id) do update
    set
      commercial_channel_name = excluded.commercial_channel_name,
      commercial_receives_real_clients = excluded.commercial_receives_real_clients,
      commercial_is_official_sales_channel = excluded.commercial_is_official_sales_channel,
      commercial_channel_type = excluded.commercial_channel_type,
      commercial_entry_priority = excluded.commercial_entry_priority,
      commercial_human_handoff_enabled = excluded.commercial_human_handoff_enabled,
      commercial_channel_notes = excluded.commercial_channel_notes,
      integration_provider_name = excluded.integration_provider_name,
      integration_connection_mode = excluded.integration_connection_mode,
      integrations_notes = excluded.integrations_notes;
  end if;

  execute 'set local role authenticated';

  begin
    perform public.upsert_store_channel_settings_scoped(
      v_target.organization_id, v_target.id, 'Should Not Execute', true, true,
      'WhatsApp', 'Principal', true, null, 'Provider', 'API', null
    );
    raise exception 'FAIL: authenticated executed the internal base writer';
  exception
    when insufficient_privilege then
      v_base_permission_blocked := true;
    when others then
      if sqlstate = '42501' then
        v_base_permission_blocked := true;
      else
        raise;
      end if;
  end;

  if not v_base_permission_blocked then
    raise exception 'FAIL: authenticated base-writer denial was not observed';
  end if;

  select *
  into v_first_result
  from public.upsert_store_channel_settings_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.id,
    'Canal Comercial P19A Runner',
    true,
    false,
    'WhatsApp comercial dedicado',
    'Canal principal de entrada',
    true,
    'Observacao humana runner',
    'Provider P19A Runner',
    'API / webhook',
    'Sem secrets, sem health, sem runtime'
  );

  select count(*)
  into v_own_scope_visible_count
  from public.store_channel_settings channel_row
  where channel_row.organization_id = v_target.organization_id
    and channel_row.store_id = v_target.id;

  select count(*)
  into v_other_scope_visible_count
  from public.store_channel_settings channel_row
  where channel_row.organization_id <> v_target.organization_id;

  if v_own_scope_visible_count <> 1 then
    raise exception 'FAIL: authenticated member could not select its own canonical row';
  end if;

  if v_other_scope_visible_count <> 0 then
    raise exception 'FAIL: authenticated member could select canonical rows from another tenant';
  end if;

  if v_first_result.organization_id <> v_target.organization_id
     or v_first_result.store_id <> v_target.id
  then
    raise exception 'FAIL: wrapper writer returned a row outside the requested organization/store scope';
  end if;

  if v_first_result.commercial_channel_name <> 'Canal Comercial P19A Runner'
     or v_first_result.commercial_receives_real_clients is distinct from true
     or v_first_result.commercial_is_official_sales_channel is distinct from false
     or v_first_result.commercial_channel_type <> 'WhatsApp comercial dedicado'
     or v_first_result.commercial_entry_priority <> 'Canal principal de entrada'
     or v_first_result.commercial_human_handoff_enabled is distinct from true
     or v_first_result.commercial_channel_notes <> 'Observacao humana runner'
     or v_first_result.integration_provider_name <> 'Provider P19A Runner'
     or v_first_result.integration_connection_mode <> 'API / webhook'
     or v_first_result.integrations_notes <> 'Sem secrets, sem health, sem runtime'
  then
    raise exception 'FAIL: wrapper writer did not persist the requested canonical channel settings';
  end if;

  begin
    perform public.upsert_store_channel_settings_with_legacy_mirror_scoped(
      v_cross_org_id,
      v_cross_store_id,
      'Cross Tenant Attempt',
      true,
      true,
      'WhatsApp',
      'Principal',
      true,
      null,
      'Provider',
      'API',
      null
    );
    raise exception 'FAIL: cross-tenant wrapper call should have been blocked';
  exception
    when others then
      v_cross_tenant_sqlstate := sqlstate;
      v_cross_tenant_message := sqlerrm;
  end;

  if v_cross_tenant_sqlstate <> 'P0001'
     or position('MEMBERSHIP_REQUIRED' in coalesce(v_cross_tenant_message, '')) = 0
  then
    raise exception 'FAIL: cross-tenant wrapper call returned unexpected failure [%] %',
      coalesce(v_cross_tenant_sqlstate, 'null'),
      coalesce(v_cross_tenant_message, 'null');
  end if;

  select *
  into v_second_result
  from public.upsert_store_channel_settings_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.id,
    'Canal Comercial P19A Runner',
    true,
    false,
    'WhatsApp comercial dedicado',
    'Canal principal de entrada',
    true,
    'Observacao humana runner',
    'Provider P19A Runner',
    'API / webhook',
    'Sem secrets, sem health, sem runtime'
  );

  select count(*)
  into v_canonical_row_count
  from public.store_channel_settings channel_row
  where channel_row.organization_id = v_target.organization_id
    and channel_row.store_id = v_target.id;

  if v_canonical_row_count <> 1 then
    raise exception 'FAIL: repeated wrapper save created a competing canonical row';
  end if;

  perform pg_catalog.pg_sleep(0.02);

  select *
  into v_updated_result
  from public.upsert_store_channel_settings_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.id,
    'Canal Comercial P19A Runner Atualizado',
    false,
    true,
    'WhatsApp comercial dedicado',
    'Canal principal de entrada',
    false,
    'Observacao humana runner 2',
    'Provider P19A Runner 2',
    'API / webhook',
    'Sem secrets, sem health, sem runtime 2'
  );

  v_updated_at_advanced :=
    v_second_result.updated_at is not null
    and v_updated_result.updated_at is not null
    and v_updated_result.updated_at > v_second_result.updated_at;

  if not coalesce(v_updated_at_advanced, false) then
    raise exception 'FAIL: updated_at did not advance after a wrapper update';
  end if;

  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claims', '', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claim.role', '', true);

  with expected_answers as (
    select *
    from (
      values
        ('commercial_channel_name'::text, to_jsonb('Canal Comercial P19A Runner Atualizado'::text)),
        ('commercial_receives_real_clients'::text, to_jsonb('Não'::text)),
        ('commercial_is_official_sales_channel'::text, to_jsonb('Sim'::text)),
        ('commercial_channel_type'::text, to_jsonb('WhatsApp comercial dedicado'::text)),
        ('commercial_entry_priority'::text, to_jsonb('Canal principal de entrada'::text)),
        ('commercial_human_handoff_enabled'::text, to_jsonb('Não'::text)),
        ('commercial_channel_notes'::text, to_jsonb('Observacao humana runner 2'::text)),
        ('integration_provider_name'::text, to_jsonb('Provider P19A Runner 2'::text)),
        ('integration_connection_mode'::text, to_jsonb('API / webhook'::text)),
        ('integrations_notes'::text, to_jsonb('Sem secrets, sem health, sem runtime 2'::text))
    ) as expected(question_key, answer)
  )
  select count(*)
  into v_expected_mirror_count
  from expected_answers expected
  join public.store_onboarding_answers answer_row
    on answer_row.organization_id = v_target.organization_id
   and answer_row.store_id = v_target.id
   and answer_row.question_key = expected.question_key
   and answer_row.answer = expected.answer;

  if v_expected_mirror_count <> 10 then
    raise exception 'FAIL: wrapper mirror did not refresh all 10 canonical legacy keys exactly';
  end if;

  select answer_row.answer
  into v_answer
  from public.store_onboarding_answers answer_row
  where answer_row.organization_id = v_target.organization_id
    and answer_row.store_id = v_target.id
    and answer_row.question_key = 'commercial_receives_real_clients';

  if v_answer is distinct from to_jsonb('Não'::text) then
    raise exception 'FAIL: canonical false must mirror commercial_receives_real_clients exactly as Não';
  end if;

  select answer_row.answer
  into v_answer
  from public.store_onboarding_answers answer_row
  where answer_row.organization_id = v_target.organization_id
    and answer_row.store_id = v_target.id
    and answer_row.question_key = 'commercial_is_official_sales_channel';

  if v_answer is distinct from to_jsonb('Sim'::text) then
    raise exception 'FAIL: canonical true must mirror commercial_is_official_sales_channel exactly as Sim';
  end if;

  select answer_row.answer
  into v_answer
  from public.store_onboarding_answers answer_row
  where answer_row.organization_id = v_target.organization_id
    and answer_row.store_id = v_target.id
    and answer_row.question_key = 'commercial_human_handoff_enabled';

  if v_answer is distinct from to_jsonb('Não'::text) then
    raise exception 'FAIL: canonical false must mirror commercial_human_handoff_enabled exactly as Não';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('question_key', answer_row.question_key, 'answer', answer_row.answer)
      order by answer_row.question_key, answer_row.answer::text
    ),
    '[]'::jsonb
  )
  into v_disallowed_after
  from public.store_onboarding_answers answer_row
  where answer_row.organization_id = v_target.organization_id
    and answer_row.store_id = v_target.id
    and answer_row.question_key in (
      'commercial_whatsapp',
      'responsible_whatsapp',
      'integration_test_status',
      'webhook_inbound_status',
      'external_send_status',
      'assistant_alerts_route',
      'urgency_route',
      'reports_route'
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object('question_key', answer_row.question_key, 'answer', answer_row.answer)
      order by answer_row.question_key, answer_row.answer::text
    ),
    '[]'::jsonb
  )
  into v_secret_after
  from public.store_onboarding_answers answer_row
  where answer_row.organization_id = v_target.organization_id
    and answer_row.store_id = v_target.id
    and (
      answer_row.question_key like '%secret%'
      or answer_row.question_key like '%token%'
      or answer_row.question_key like '%password%'
      or answer_row.question_key like '%credential%'
    );

  if v_disallowed_after is distinct from v_disallowed_before then
    raise exception 'FAIL: wrapper writer changed disallowed legacy/status/runtime/routing values';
  end if;

  if v_secret_after is distinct from v_secret_before then
    raise exception 'FAIL: wrapper writer created or changed secret-like legacy values';
  end if;

  if v_other_store.id is not null then
    select count(*)
    into v_other_store_marker_count
    from public.store_channel_settings channel_row
    where channel_row.organization_id = v_other_store.organization_id
      and channel_row.store_id = v_other_store.id
      and channel_row.commercial_channel_name = 'Outro Tenant Runner';

    if v_other_store_marker_count <> 1 then
      raise exception 'FAIL: cross-tenant attempt modified the other tenant fixture row';
    end if;
  else
    v_other_store_marker_count := 0;
  end if;

  insert into p19a_store_channel_settings_test_results
  values
    (18, '18_wrapper_save_returns_scoped_row', 'PASS', 'wrapper writer returns the canonical row for the requested organization/store'),
    (19, '19_wrapper_persists_requested_values', 'PASS', 'wrapper writer persists all canonical channel and integration fields exactly as requested'),
    (20, '20_authenticated_select_stays_scoped', 'PASS', 'authenticated membership can select its own row and cannot see rows outside its organization'),
    (21, '21_all_10_canonical_keys_mirrored', 'PASS', 'wrapper mirror refreshes exactly the 10 canonical legacy keys, including exact Sim/Não boolean semantics'),
    (22, '22_disallowed_and_secret_values_unchanged', 'PASS', 'wrapper leaves whatsapp, responsible, status, runtime, routing and secret-like legacy values byte-for-byte unchanged'),
    (23, '23_cross_tenant_blocked', 'PASS', case when v_other_store.id is not null then 'authenticated membership cannot save channel settings for the existing other organization/store' else 'authenticated membership cannot save channel settings for an organization outside its membership; no second tenant store exists in this database' end),
    (24, '24_repeated_save_idempotent', 'PASS', 'repeating the same wrapper save keeps a single canonical row'),
    (25, '25_updated_at_and_boolean_mirror_update', 'PASS', 'update advances updated_at and preserves exact TRUE/FALSE to Sim/Não mirror semantics'),
    (26, '26_other_tenants_untouched_and_rollback_safe', 'PASS', case when v_other_store.id is not null then 'other tenant fixture remained unchanged; all runner writes are inside the surrounding transaction and will be rolled back' else 'cross-tenant denial was proved without a second tenant fixture; all runner writes are inside the surrounding transaction and will be rolled back' end);
end
$runner$;

table p19a_store_channel_settings_test_results order by ordinal;

rollback;
