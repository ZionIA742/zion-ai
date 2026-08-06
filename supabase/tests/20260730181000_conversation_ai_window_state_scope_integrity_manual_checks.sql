begin;

set local search_path = public, pg_catalog;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'p18:conversation_ai_window_state_scope_integrity',
    0
  )
);

create temp table pg_temp.test_results (
  test_order integer primary key,
  test_name text not null,
  status text not null,
  details text not null
) on commit drop;

create or replace function pg_temp.record_result(
  p_order integer,
  p_name text,
  p_status text,
  p_details text
) returns void
language plpgsql
as $$
begin
  insert into pg_temp.test_results(test_order, test_name, status, details)
  values (p_order, p_name, p_status, p_details);
end;
$$;

create or replace function pg_temp.assert_expected_error(
  p_order integer,
  p_name text,
  p_expected_sqlstate text,
  p_expected_constraint text,
  p_block text,
  p_actual_sqlstate text,
  p_actual_constraint text,
  p_actual_message text
) returns void
language plpgsql
as $$
begin
  if p_actual_sqlstate = p_expected_sqlstate
     and p_actual_constraint = p_expected_constraint
  then
    perform pg_temp.record_result(
      p_order,
      p_name,
      'PASS',
      format('%s => %s / %s', p_block, p_actual_sqlstate, p_actual_constraint)
    );
  else
    perform pg_temp.record_result(
      p_order,
      p_name,
      'SUT_FAIL',
      format(
        '%s => esperado %s / %s; recebido %s / %s / %s',
        p_block,
        p_expected_sqlstate,
        p_expected_constraint,
        coalesce(p_actual_sqlstate, 'null'),
        coalesce(p_actual_constraint, 'null'),
        coalesce(p_actual_message, 'null')
      )
    );
  end if;
end;
$$;

do $$
declare
  v_target_conversation_id constant uuid := '0866458a-c2cd-4d45-a3a8-645d2c2f4560';
  v_canonical_organization_id constant uuid := 'b02252ce-0e73-4371-9e23-f1009e7b1698';
  v_canonical_store_id constant uuid := '6ac8f4b1-e50f-42c0-9cae-78951d6daf7b';
  v_fixture_other_org constant uuid := 'b7bf7e6e-a282-4e7a-a7c3-b7914eb1ee24';
  v_fixture_other_store_same_org constant uuid := '02be5b19-29fd-4945-9a45-f31d95c3ef01';
  v_fixture_other_store_other_org constant uuid := '71a8612e-4312-442f-b86e-f1def2672dc4';
  v_fixture_base_lead_id constant uuid := 'fb2a6ca5-44a9-463f-9c4e-93ba63c62801';
  v_fixture_same_scope_lead_id constant uuid := 'f3463a92-04ee-4639-a94d-6fd7dd8ee584';
  v_fixture_incompatible_lead_id constant uuid := 'f6e3e3de-7aaf-4124-9d43-908df95f4505';
  v_fixture_conversation_id constant uuid := '8b907ea4-8f75-4e72-b643-0c38f7d8d121';
  v_fixture_window_conversation_id constant uuid := '8b907ea4-8f75-4e72-b643-0c38f7d8d121';
  v_state_count integer;
  v_sqlstate text;
  v_constraint text;
  v_message text;
  v_owner name;
  v_rls boolean;
  v_forced_rls boolean;
  v_policy_anon integer;
  v_policy_authenticated integer;
  v_total_policy_count integer;
  v_service_role_privs integer;
  v_denied_write_anon integer;
  v_denied_write_authenticated integer;
  v_expected_conrelid oid := 'public.conversation_ai_window_state'::regclass;
  v_expected_conversation_confrelid oid := 'public.conversations'::regclass;
  v_expected_store_confrelid oid := 'public.stores'::regclass;
  v_expected_function_config text[] := array['search_path=pg_catalog, public'];
  v_state_conversation_org_conkey smallint[];
  v_state_store_org_conkey smallint[];
  v_conversation_confkey smallint[];
  v_store_confkey smallint[];
  v_scope_trigger_attrs smallint[];
  v_parent_conversation_trigger_attrs smallint[];
  v_parent_lead_trigger_attrs smallint[];
  v_existing_trigger_attrs smallint[];
  v_function_oid oid;
  v_existing_proc pg_catalog.pg_proc%rowtype;
  v_existing_lang name;
  v_existing_owner name;
  v_existing_return_type regtype;
  v_existing_function_identity_arguments text;
  v_normalized_existing_body text;
  v_normalized_expected_body text;
  v_fixture_org_ready boolean := false;
  v_fixture_stores_ready boolean := false;
  v_fixture_base_chain_ready boolean := false;
  v_unexpected_required_organization_columns integer := 0;
  v_organization_trigger_count integer := 0;
  v_sut_check_ok boolean;
  v_sut_check_detail text;
  v_policy_anon_roles text;
  v_policy_anon_cmd text;
  v_policy_anon_permissive boolean;
  v_policy_anon_qual text;
  v_policy_anon_with_check text;
  v_policy_authenticated_roles text;
  v_policy_authenticated_cmd text;
  v_policy_authenticated_permissive boolean;
  v_policy_authenticated_qual text;
  v_policy_authenticated_with_check text;
  v_scope_function_body text := $fn$
begin
  if not exists (
    select 1
    from public.conversations conversation_row
    join public.leads lead_row
      on lead_row.id = conversation_row.lead_id
    join public.stores store_row
      on store_row.id = new.store_id
    where conversation_row.id is not distinct from new.conversation_id
      and conversation_row.organization_id is not distinct from new.organization_id
      and lead_row.organization_id is not distinct from new.organization_id
      and lead_row.store_id is not distinct from new.store_id
      and store_row.organization_id is not distinct from new.organization_id
  ) then
    raise exception using
      errcode = '23503',
      constraint = 'conversation_ai_window_state_canonical_scope_fkey',
      message = 'conversation_ai_window_state must match the canonical conversation, lead and store scope';
  end if;

  return new;
end;
$fn$;
  v_parent_conversation_function_body text := $fn$
begin
  if new.organization_id is distinct from old.organization_id
     or new.lead_id is distinct from old.lead_id
  then
    if exists (
      select 1
      from public.conversation_ai_window_state state_row
      left join public.leads lead_row
        on lead_row.id = new.lead_id
      left join public.stores store_row
        on store_row.id = state_row.store_id
      where state_row.conversation_id is not distinct from new.id
        and (
          new.lead_id is null
          or lead_row.id is null
          or new.organization_id is distinct from state_row.organization_id
          or lead_row.organization_id is distinct from new.organization_id
          or lead_row.store_id is distinct from state_row.store_id
          or store_row.id is null
          or store_row.organization_id is distinct from state_row.organization_id
        )
    ) then
      raise exception using
        errcode = '23503',
        constraint = 'conversation_ai_window_state_parent_conversation_scope_fkey',
        message = 'conversation update would break existing conversation_ai_window_state canonical scope';
    end if;
  end if;

  return new;
end;
$fn$;
  v_parent_lead_function_body text := $fn$
begin
  if new.organization_id is distinct from old.organization_id
     or new.store_id is distinct from old.store_id
  then
    if exists (
      select 1
      from public.conversations conversation_row
      join public.conversation_ai_window_state state_row
        on state_row.conversation_id = conversation_row.id
      left join public.stores store_row
        on store_row.id = new.store_id
      where conversation_row.lead_id is not distinct from new.id
        and (
          conversation_row.organization_id is distinct from new.organization_id
          or state_row.organization_id is distinct from new.organization_id
          or state_row.store_id is distinct from new.store_id
          or store_row.id is null
          or store_row.organization_id is distinct from new.organization_id
        )
    ) then
      raise exception using
        errcode = '23503',
        constraint = 'conversation_ai_window_state_parent_lead_scope_fkey',
        message = 'lead update would break existing conversation_ai_window_state canonical scope';
    end if;
  end if;

  return new;
end;
$fn$;
begin
  select array_agg(attnum order by ordinality)
  into v_state_conversation_org_conkey
  from pg_catalog.pg_attribute
  cross join unnest(array['conversation_id','organization_id']) with ordinality as cols(attname, ordinality)
  where attrelid = 'public.conversation_ai_window_state'::pg_catalog.regclass
    and pg_catalog.pg_attribute.attname = cols.attname;

  select array_agg(attnum order by ordinality)
  into v_state_store_org_conkey
  from pg_catalog.pg_attribute
  cross join unnest(array['store_id','organization_id']) with ordinality as cols(attname, ordinality)
  where attrelid = 'public.conversation_ai_window_state'::pg_catalog.regclass
    and pg_catalog.pg_attribute.attname = cols.attname;

  select array_agg(attnum order by ordinality)
  into v_conversation_confkey
  from pg_catalog.pg_attribute
  cross join unnest(array['id','organization_id']) with ordinality as cols(attname, ordinality)
  where attrelid = 'public.conversations'::regclass
    and pg_catalog.pg_attribute.attname = cols.attname;

  select array_agg(attnum order by ordinality)
  into v_store_confkey
  from pg_catalog.pg_attribute
  cross join unnest(array['id','organization_id']) with ordinality as cols(attname, ordinality)
  where attrelid = 'public.stores'::regclass
    and pg_catalog.pg_attribute.attname = cols.attname;

  select array_agg(attnum order by ordinality)
  into v_scope_trigger_attrs
  from pg_catalog.pg_attribute
  cross join unnest(array['conversation_id','organization_id','store_id']) with ordinality as cols(attname, ordinality)
  where attrelid = 'public.conversation_ai_window_state'::regclass
    and pg_catalog.pg_attribute.attname = cols.attname;

  select array_agg(attnum order by ordinality)
  into v_parent_conversation_trigger_attrs
  from pg_catalog.pg_attribute
  cross join unnest(array['lead_id','organization_id']) with ordinality as cols(attname, ordinality)
  where attrelid = 'public.conversations'::regclass
    and pg_catalog.pg_attribute.attname = cols.attname;

  select array_agg(attnum order by ordinality)
  into v_parent_lead_trigger_attrs
  from pg_catalog.pg_attribute
  cross join unnest(array['organization_id','store_id']) with ordinality as cols(attname, ordinality)
  where attrelid = 'public.leads'::regclass
    and pg_catalog.pg_attribute.attname = cols.attname;

  begin
    if exists (
      select 1
      from pg_catalog.pg_constraint c
      where c.conname = 'conversation_ai_window_state_conversation_org_fkey'
        and c.contype = 'f'
        and c.conmatchtype = 's'
        and c.conrelid = v_expected_conrelid
        and c.confrelid = v_expected_conversation_confrelid
        and c.conkey = v_state_conversation_org_conkey
        and c.confkey = v_conversation_confkey
        and c.confdeltype = 'c'
        and c.confupdtype = 'a'
        and c.convalidated
        and c.condeferrable = false
        and c.condeferred = false
    ) and exists (
      select 1
      from pg_catalog.pg_constraint c
      where c.conname = 'conversation_ai_window_state_store_org_fkey'
        and c.contype = 'f'
        and c.conmatchtype = 's'
        and c.conrelid = v_expected_conrelid
        and c.confrelid = v_expected_store_confrelid
        and c.conkey = v_state_store_org_conkey
        and c.confkey = v_store_confkey
        and c.confdeltype = 'c'
        and c.confupdtype = 'a'
        and c.convalidated
        and c.condeferrable = false
        and c.condeferred = false
    ) then
      perform pg_temp.record_result(1, 'fks compostas estruturais', 'PASS', 'constraints compostas presentes, ordenadas e validadas');
    else
      perform pg_temp.record_result(1, 'fks compostas estruturais', 'SUT_FAIL', 'constraints compostas ausentes, divergentes, fora de ordem ou nao validadas');
    end if;
  exception when others then
    perform pg_temp.record_result(1, 'fks compostas estruturais', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    v_sut_check_ok := true;
    v_sut_check_detail := 'ok';

    v_function_oid := pg_catalog.to_regprocedure(
      'public.enforce_conversation_ai_window_state_canonical_scope()'
    );
    if v_function_oid is null then
      v_sut_check_ok := false;
      v_sut_check_detail := 'missing exact signature public.enforce_conversation_ai_window_state_canonical_scope()';
    else
      select *
      into strict v_existing_proc
      from pg_catalog.pg_proc
      where oid = v_function_oid;

      select language_row.lanname
      into strict v_existing_lang
      from pg_catalog.pg_language language_row
      where language_row.oid = v_existing_proc.prolang;

      select pg_catalog.pg_get_userbyid(v_existing_proc.proowner)
      into strict v_existing_owner;

      v_existing_return_type := v_existing_proc.prorettype::pg_catalog.regtype;
      v_existing_function_identity_arguments := pg_catalog.pg_get_function_identity_arguments(v_function_oid);
      v_normalized_existing_body := pg_catalog.regexp_replace(pg_catalog.btrim(v_existing_proc.prosrc), '\s+', ' ', 'g');
      v_normalized_expected_body := pg_catalog.regexp_replace(pg_catalog.btrim(v_scope_function_body), '\s+', ' ', 'g');

      if v_existing_function_identity_arguments <> ''
         or v_existing_return_type <> 'trigger'::pg_catalog.regtype
         or v_existing_lang <> 'plpgsql'
         or v_existing_proc.prosecdef is distinct from true
         or coalesce(v_existing_proc.proconfig, '{}'::text[]) <> v_expected_function_config
         or v_existing_owner <> 'postgres'
         or v_normalized_existing_body <> v_normalized_expected_body
      then
        v_sut_check_ok := false;
        v_sut_check_detail := 'divergent function public.enforce_conversation_ai_window_state_canonical_scope()';
      end if;
    end if;

    if v_sut_check_ok then
      v_function_oid := pg_catalog.to_regprocedure(
        'public.guard_conversation_ai_window_state_parent_conversation()'
      );
      if v_function_oid is null then
        v_sut_check_ok := false;
        v_sut_check_detail := 'missing exact signature public.guard_conversation_ai_window_state_parent_conversation()';
      else
        select *
        into strict v_existing_proc
        from pg_catalog.pg_proc
        where oid = v_function_oid;

        select language_row.lanname
        into strict v_existing_lang
        from pg_catalog.pg_language language_row
        where language_row.oid = v_existing_proc.prolang;

        select pg_catalog.pg_get_userbyid(v_existing_proc.proowner)
        into strict v_existing_owner;

        v_existing_return_type := v_existing_proc.prorettype::pg_catalog.regtype;
        v_existing_function_identity_arguments := pg_catalog.pg_get_function_identity_arguments(v_function_oid);
        v_normalized_existing_body := pg_catalog.regexp_replace(pg_catalog.btrim(v_existing_proc.prosrc), '\s+', ' ', 'g');
        v_normalized_expected_body := pg_catalog.regexp_replace(pg_catalog.btrim(v_parent_conversation_function_body), '\s+', ' ', 'g');

        if v_existing_function_identity_arguments <> ''
           or v_existing_return_type <> 'trigger'::pg_catalog.regtype
           or v_existing_lang <> 'plpgsql'
           or v_existing_proc.prosecdef is distinct from true
           or coalesce(v_existing_proc.proconfig, '{}'::text[]) <> v_expected_function_config
           or v_existing_owner <> 'postgres'
           or v_normalized_existing_body <> v_normalized_expected_body
        then
          v_sut_check_ok := false;
          v_sut_check_detail := 'divergent function public.guard_conversation_ai_window_state_parent_conversation()';
        end if;
      end if;
    end if;

    if v_sut_check_ok then
      v_function_oid := pg_catalog.to_regprocedure(
        'public.guard_conversation_ai_window_state_parent_lead()'
      );
      if v_function_oid is null then
        v_sut_check_ok := false;
        v_sut_check_detail := 'missing exact signature public.guard_conversation_ai_window_state_parent_lead()';
      else
        select *
        into strict v_existing_proc
        from pg_catalog.pg_proc
        where oid = v_function_oid;

        select language_row.lanname
        into strict v_existing_lang
        from pg_catalog.pg_language language_row
        where language_row.oid = v_existing_proc.prolang;

        select pg_catalog.pg_get_userbyid(v_existing_proc.proowner)
        into strict v_existing_owner;

        v_existing_return_type := v_existing_proc.prorettype::pg_catalog.regtype;
        v_existing_function_identity_arguments := pg_catalog.pg_get_function_identity_arguments(v_function_oid);
        v_normalized_existing_body := pg_catalog.regexp_replace(pg_catalog.btrim(v_existing_proc.prosrc), '\s+', ' ', 'g');
        v_normalized_expected_body := pg_catalog.regexp_replace(pg_catalog.btrim(v_parent_lead_function_body), '\s+', ' ', 'g');

        if v_existing_function_identity_arguments <> ''
           or v_existing_return_type <> 'trigger'::pg_catalog.regtype
           or v_existing_lang <> 'plpgsql'
           or v_existing_proc.prosecdef is distinct from true
           or coalesce(v_existing_proc.proconfig, '{}'::text[]) <> v_expected_function_config
           or v_existing_owner <> 'postgres'
           or v_normalized_existing_body <> v_normalized_expected_body
        then
          v_sut_check_ok := false;
          v_sut_check_detail := 'divergent function public.guard_conversation_ai_window_state_parent_lead()';
        end if;
      end if;
    end if;

    if v_sut_check_ok then
      select array_agg(trigger_attr order by ordinality)
      into v_existing_trigger_attrs
      from (
        select trigger_attr, ordinality
        from pg_catalog.pg_trigger trigger_row
        cross join lateral unnest(trigger_row.tgattr::smallint[]) with ordinality as trigger_attrs(trigger_attr, ordinality)
        where trigger_row.tgrelid = 'public.conversation_ai_window_state'::regclass
          and trigger_row.tgname = 'trg_conversation_ai_window_state_canonical_scope'
          and not trigger_row.tgisinternal
      ) normalized_trigger_attrs;

      if not exists (
      select 1
      from pg_catalog.pg_trigger t
      where t.tgrelid = 'public.conversation_ai_window_state'::regclass
        and t.tgname = 'trg_conversation_ai_window_state_canonical_scope'
        and t.tgfoid = 'public.enforce_conversation_ai_window_state_canonical_scope()'::regprocedure
        and t.tgtype = 23
        and v_existing_trigger_attrs is not distinct from v_scope_trigger_attrs
        and t.tgenabled = 'O'
        and t.tgnargs = 0
        and t.tgqual is null
        and t.tgconstraint = 0
        and t.tgdeferrable = false
        and t.tginitdeferred = false
        and not t.tgisinternal
      ) then
        v_sut_check_ok := false;
        v_sut_check_detail := 'divergent trigger trg_conversation_ai_window_state_canonical_scope';
      end if;
    end if;

    if v_sut_check_ok then
      select array_agg(trigger_attr order by ordinality)
      into v_existing_trigger_attrs
      from (
        select trigger_attr, ordinality
        from pg_catalog.pg_trigger trigger_row
        cross join lateral unnest(trigger_row.tgattr::smallint[]) with ordinality as trigger_attrs(trigger_attr, ordinality)
        where trigger_row.tgrelid = 'public.conversations'::regclass
          and trigger_row.tgname = 'trg_guard_conversation_ai_window_state_parent_conversation'
          and not trigger_row.tgisinternal
      ) normalized_trigger_attrs;

      if not exists (
        select 1
        from pg_catalog.pg_trigger t
        where t.tgrelid = 'public.conversations'::regclass
          and t.tgname = 'trg_guard_conversation_ai_window_state_parent_conversation'
          and t.tgfoid = 'public.guard_conversation_ai_window_state_parent_conversation()'::regprocedure
          and t.tgtype = 19
          and v_existing_trigger_attrs is not distinct from v_parent_conversation_trigger_attrs
          and t.tgenabled = 'O'
          and t.tgnargs = 0
          and t.tgqual is null
          and t.tgconstraint = 0
          and t.tgdeferrable = false
          and t.tginitdeferred = false
          and not t.tgisinternal
      ) then
        v_sut_check_ok := false;
        v_sut_check_detail := 'divergent trigger trg_guard_conversation_ai_window_state_parent_conversation';
      end if;
    end if;

    if v_sut_check_ok then
      select array_agg(trigger_attr order by ordinality)
      into v_existing_trigger_attrs
      from (
        select trigger_attr, ordinality
        from pg_catalog.pg_trigger trigger_row
        cross join lateral unnest(trigger_row.tgattr::smallint[]) with ordinality as trigger_attrs(trigger_attr, ordinality)
        where trigger_row.tgrelid = 'public.leads'::regclass
          and trigger_row.tgname = 'trg_guard_conversation_ai_window_state_parent_lead'
          and not trigger_row.tgisinternal
      ) normalized_trigger_attrs;

      if not exists (
        select 1
        from pg_catalog.pg_trigger t
        where t.tgrelid = 'public.leads'::regclass
          and t.tgname = 'trg_guard_conversation_ai_window_state_parent_lead'
          and t.tgfoid = 'public.guard_conversation_ai_window_state_parent_lead()'::regprocedure
          and t.tgtype = 19
          and v_existing_trigger_attrs is not distinct from v_parent_lead_trigger_attrs
          and t.tgenabled = 'O'
          and t.tgnargs = 0
          and t.tgqual is null
          and t.tgconstraint = 0
          and t.tgdeferrable = false
          and t.tginitdeferred = false
          and not t.tgisinternal
      ) then
        v_sut_check_ok := false;
        v_sut_check_detail := 'divergent trigger trg_guard_conversation_ai_window_state_parent_lead';
      end if;
    end if;

    if v_sut_check_ok then
      perform pg_temp.record_result(2, 'triggers e funcoes estruturais', 'PASS', 'funcoes auditadas por assinatura exata e triggers presentes com tgtype, tgattr e funcao esperados');
    else
      perform pg_temp.record_result(2, 'triggers e funcoes estruturais', 'SUT_FAIL', v_sut_check_detail);
    end if;
  exception when others then
    perform pg_temp.record_result(2, 'triggers e funcoes estruturais', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if exists (
      select 1
      from public.conversation_ai_window_state state_row
      join public.conversations conversation_row
        on conversation_row.id = state_row.conversation_id
      join public.leads lead_row
        on lead_row.id = conversation_row.lead_id
      join public.stores store_row
        on store_row.id = state_row.store_id
      where state_row.conversation_id = v_target_conversation_id
        and state_row.organization_id = v_canonical_organization_id
        and state_row.store_id = v_canonical_store_id
        and conversation_row.organization_id = v_canonical_organization_id
        and lead_row.organization_id = v_canonical_organization_id
        and lead_row.store_id = v_canonical_store_id
        and store_row.organization_id = v_canonical_organization_id
    ) then
      perform pg_temp.record_result(3, 'linha historica canonica', 'PASS', 'linha historica em escopo canonico');
    else
      perform pg_temp.record_result(3, 'linha historica canonica', 'SUT_FAIL', 'linha historica fora do escopo canonico');
    end if;
  exception when others then
    perform pg_temp.record_result(3, 'linha historica canonica', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select count(*)
    into v_state_count
    from public.conversation_ai_window_state state_row
    left join public.conversations conversation_row
      on conversation_row.id = state_row.conversation_id
    left join public.leads lead_row
      on lead_row.id = conversation_row.lead_id
    left join public.stores store_row
      on store_row.id = state_row.store_id
    where conversation_row.id is null
       or lead_row.id is null
       or store_row.id is null
       or state_row.organization_id is distinct from conversation_row.organization_id
       or lead_row.organization_id is distinct from conversation_row.organization_id
       or lead_row.store_id is distinct from state_row.store_id
       or store_row.organization_id is distinct from state_row.organization_id;

    if v_state_count = 0 then
      perform pg_temp.record_result(4, 'nenhuma linha inconsistente', 'PASS', 'nenhuma linha incoerente encontrada');
    else
      perform pg_temp.record_result(4, 'nenhuma linha inconsistente', 'SUT_FAIL', format('%s linhas incoerentes', v_state_count));
    end if;
  exception when others then
    perform pg_temp.record_result(4, 'nenhuma linha inconsistente', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select count(*)
    into v_unexpected_required_organization_columns
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organizations'
      and is_nullable = 'NO'
      and column_default is null
      and column_name not in ('id', 'name');

    select count(*)
    into v_organization_trigger_count
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.organizations'::regclass
      and trigger_row.tgenabled = 'O'
      and not trigger_row.tgisinternal;

    if v_unexpected_required_organization_columns <> 0 then
      perform pg_temp.record_result(5, 'fixture organization auxiliar', 'HARNESS_ERROR', 'organizations possui colunas obrigatorias adicionais sem default');
    else
      insert into public.organizations (id, name)
      values (v_fixture_other_org, 'fixture conversation ai scope org');

      v_fixture_org_ready := true;
      perform pg_temp.record_result(5, 'fixture organization auxiliar', 'PASS', format('organization criada com id/name; triggers habilitados em organizations=%s', v_organization_trigger_count));
    end if;
  exception when others then
    perform pg_temp.record_result(5, 'fixture organization auxiliar', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if not v_fixture_org_ready then
      perform pg_temp.record_result(6, 'fixtures stores auxiliares', 'HARNESS_ERROR', 'BLOCKED_BY_FIXTURE_PREREQUISITE: organization fixture ausente');
    else
      insert into public.stores (id, organization_id, name)
      values
        (v_fixture_other_store_same_org, v_canonical_organization_id, 'fixture same org'),
        (v_fixture_other_store_other_org, v_fixture_other_org, 'fixture other org');

      v_fixture_stores_ready := true;
      perform pg_temp.record_result(6, 'fixtures stores auxiliares', 'PASS', 'stores auxiliares criadas nas organizations corretas');
    end if;
  exception when others then
    perform pg_temp.record_result(6, 'fixtures stores auxiliares', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if not v_fixture_stores_ready then
      perform pg_temp.record_result(7, 'fixtures base completas', 'HARNESS_ERROR', 'BLOCKED_BY_FIXTURE_PREREQUISITE: stores auxiliares ausentes');
    else
      insert into public.leads (id, organization_id, store_id, name)
      values
        (v_fixture_base_lead_id, v_canonical_organization_id, v_canonical_store_id, 'fixture base lead'),
        (v_fixture_same_scope_lead_id, v_canonical_organization_id, v_canonical_store_id, 'fixture same scope lead'),
        (v_fixture_incompatible_lead_id, v_fixture_other_org, v_fixture_other_store_other_org, 'fixture incompatible lead');

      insert into public.conversations (id, organization_id, lead_id)
      values (v_fixture_conversation_id, v_canonical_organization_id, v_fixture_base_lead_id);

      insert into public.conversation_ai_window_state (
        conversation_id,
        organization_id,
        store_id,
        waiting_next_day,
        pending_supervisor,
        updated_at
      ) values (
        v_fixture_window_conversation_id,
        v_canonical_organization_id,
        v_canonical_store_id,
        false,
        false,
        now()
      );

      v_fixture_base_chain_ready := true;
      perform pg_temp.record_result(7, 'fixtures base completas', 'PASS', 'lead base, lead same-scope, lead incompativel, conversation e window coerente criados');
    end if;
  exception when others then
    perform pg_temp.record_result(7, 'fixtures base completas', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if not v_fixture_base_chain_ready then
      perform pg_temp.record_result(8, 'insert conversa + organizacao divergente', 'HARNESS_ERROR', 'BLOCKED_BY_FIXTURE_PREREQUISITE: fixtures base ausentes');
    else
      begin
        insert into public.conversation_ai_window_state (
          conversation_id, organization_id, store_id, waiting_next_day, pending_supervisor, updated_at
        ) values (
          v_fixture_conversation_id, v_fixture_other_org, v_canonical_store_id, false, false, now()
        );
        perform pg_temp.record_result(8, 'insert conversa + organizacao divergente', 'SUT_FAIL', 'insert incoerente aceito');
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_constraint = constraint_name, v_message = message_text;
        perform pg_temp.assert_expected_error(8, 'insert conversa + organizacao divergente', '23503', 'conversation_ai_window_state_canonical_scope_fkey', 'insert', v_sqlstate, v_constraint, v_message);
      end;
    end if;
  exception when others then
    perform pg_temp.record_result(8, 'insert conversa + organizacao divergente', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if not v_fixture_base_chain_ready then
      perform pg_temp.record_result(9, 'insert loja de outra organizacao', 'HARNESS_ERROR', 'BLOCKED_BY_FIXTURE_PREREQUISITE: fixtures base ausentes');
    else
      begin
        insert into public.conversation_ai_window_state (
          conversation_id, organization_id, store_id, waiting_next_day, pending_supervisor, updated_at
        ) values (
          v_fixture_conversation_id, v_canonical_organization_id, v_fixture_other_store_other_org, false, false, now()
        );
        perform pg_temp.record_result(9, 'insert loja de outra organizacao', 'SUT_FAIL', 'insert incoerente aceito');
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_constraint = constraint_name, v_message = message_text;
        perform pg_temp.assert_expected_error(9, 'insert loja de outra organizacao', '23503', 'conversation_ai_window_state_canonical_scope_fkey', 'insert', v_sqlstate, v_constraint, v_message);
      end;
    end if;
  exception when others then
    perform pg_temp.record_result(9, 'insert loja de outra organizacao', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if not v_fixture_base_chain_ready then
      perform pg_temp.record_result(10, 'insert loja diferente mesma organizacao', 'HARNESS_ERROR', 'BLOCKED_BY_FIXTURE_PREREQUISITE: fixtures base ausentes');
    else
      begin
        insert into public.conversation_ai_window_state (
          conversation_id, organization_id, store_id, waiting_next_day, pending_supervisor, updated_at
        ) values (
          v_fixture_conversation_id, v_canonical_organization_id, v_fixture_other_store_same_org, false, false, now()
        );
        perform pg_temp.record_result(10, 'insert loja diferente mesma organizacao', 'SUT_FAIL', 'insert incoerente aceito');
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_constraint = constraint_name, v_message = message_text;
        perform pg_temp.assert_expected_error(10, 'insert loja diferente mesma organizacao', '23503', 'conversation_ai_window_state_canonical_scope_fkey', 'insert', v_sqlstate, v_constraint, v_message);
      end;
    end if;
  exception when others then
    perform pg_temp.record_result(10, 'insert loja diferente mesma organizacao', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if not v_fixture_base_chain_ready then
      perform pg_temp.record_result(11, 'upsert coerente', 'HARNESS_ERROR', 'BLOCKED_BY_FIXTURE_PREREQUISITE: fixtures base ausentes');
    else
      insert into public.conversation_ai_window_state (
        conversation_id, organization_id, store_id, waiting_next_day, pending_supervisor, updated_at
      ) values (
        v_fixture_conversation_id, v_canonical_organization_id, v_canonical_store_id, false, false, now()
      )
      on conflict (conversation_id) do update
      set organization_id = excluded.organization_id,
          store_id = excluded.store_id,
          updated_at = excluded.updated_at;

      perform pg_temp.record_result(11, 'upsert coerente', 'PASS', 'upsert canonico aceito');
    end if;
  exception when others then
    perform pg_temp.record_result(11, 'upsert coerente', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if not v_fixture_base_chain_ready then
      perform pg_temp.record_result(12, 'update conversation.lead_id same-scope', 'HARNESS_ERROR', 'BLOCKED_BY_FIXTURE_PREREQUISITE: fixtures base ausentes');
    else
      update public.conversations
      set lead_id = v_fixture_same_scope_lead_id
      where id = v_fixture_conversation_id;

      if exists (
        select 1
        from public.conversations conversation_row
        where conversation_row.id = v_fixture_conversation_id
          and conversation_row.lead_id = v_fixture_same_scope_lead_id
          and conversation_row.organization_id = v_canonical_organization_id
      ) then
        perform pg_temp.record_result(12, 'update conversation.lead_id same-scope', 'PASS', 'troca para lead da mesma organization/store foi permitida');
      else
        perform pg_temp.record_result(12, 'update conversation.lead_id same-scope', 'SUT_FAIL', 'conversation nao ficou apontando para o lead same-scope');
      end if;
    end if;
  exception when others then
    perform pg_temp.record_result(12, 'update conversation.lead_id same-scope', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if not v_fixture_base_chain_ready then
      perform pg_temp.record_result(13, 'update conversation.lead_id incompativel', 'HARNESS_ERROR', 'BLOCKED_BY_FIXTURE_PREREQUISITE: fixtures base ausentes');
    else
      begin
        update public.conversations
        set lead_id = v_fixture_incompatible_lead_id
        where id = v_fixture_conversation_id;
        perform pg_temp.record_result(13, 'update conversation.lead_id incompativel', 'SUT_FAIL', 'update incoerente aceito');
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_constraint = constraint_name, v_message = message_text;
        perform pg_temp.assert_expected_error(13, 'update conversation.lead_id incompativel', '23503', 'conversation_ai_window_state_parent_conversation_scope_fkey', 'update conversations', v_sqlstate, v_constraint, v_message);
      end;
    end if;
  exception when others then
    perform pg_temp.record_result(13, 'update conversation.lead_id incompativel', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if not v_fixture_base_chain_ready then
      perform pg_temp.record_result(14, 'update lead.store_id incompativel', 'HARNESS_ERROR', 'BLOCKED_BY_FIXTURE_PREREQUISITE: fixtures base ausentes');
    else
      begin
        update public.leads
        set store_id = v_fixture_other_store_same_org
        where id = v_fixture_same_scope_lead_id;
        perform pg_temp.record_result(14, 'update lead.store_id incompativel', 'SUT_FAIL', 'update incoerente aceito');
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_constraint = constraint_name, v_message = message_text;
        perform pg_temp.assert_expected_error(14, 'update lead.store_id incompativel', '23503', 'conversation_ai_window_state_parent_lead_scope_fkey', 'update leads store_id', v_sqlstate, v_constraint, v_message);
      end;
    end if;
  exception when others then
    perform pg_temp.record_result(14, 'update lead.store_id incompativel', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if not v_fixture_base_chain_ready then
      perform pg_temp.record_result(15, 'update lead.organization_id incompativel', 'HARNESS_ERROR', 'BLOCKED_BY_FIXTURE_PREREQUISITE: fixtures base ausentes');
    else
      begin
        update public.leads
        set organization_id = v_fixture_other_org
        where id = v_fixture_same_scope_lead_id;
        perform pg_temp.record_result(15, 'update lead.organization_id incompativel', 'SUT_FAIL', 'update incoerente aceito');
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_constraint = constraint_name, v_message = message_text;
        perform pg_temp.assert_expected_error(15, 'update lead.organization_id incompativel', '23503', 'conversation_ai_window_state_parent_lead_scope_fkey', 'update leads organization_id', v_sqlstate, v_constraint, v_message);
      end;
    end if;
  exception when others then
    perform pg_temp.record_result(15, 'update lead.organization_id incompativel', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select count(*)
    into v_total_policy_count
    from pg_catalog.pg_policy
    where polrelid = 'public.conversation_ai_window_state'::regclass;

    select c.relrowsecurity, c.relforcerowsecurity, r.rolname
    into v_rls, v_forced_rls, v_owner
    from pg_catalog.pg_class c
    join pg_catalog.pg_roles r
      on r.oid = c.relowner
    where c.oid = 'public.conversation_ai_window_state'::regclass;

    select count(*)
    into v_policy_anon
    from pg_catalog.pg_policy
    where polrelid = 'public.conversation_ai_window_state'::regclass
      and polname = 'deny_all_anon';

    select
      array_to_string(array(
        select pg_catalog.pg_get_userbyid(role_oid)
        from unnest(policy_row.polroles) as role_oids(role_oid)
        order by role_oid
      ), ','),
      case policy_row.polcmd
        when 'r' then 'SELECT'
        when 'a' then 'INSERT'
        when 'w' then 'UPDATE'
        when 'd' then 'DELETE'
        when '*' then 'ALL'
        else policy_row.polcmd::text
      end,
      policy_row.polpermissive,
      pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid, true),
      pg_catalog.pg_get_expr(policy_row.polwithcheck, policy_row.polrelid, true)
    into
      v_policy_anon_roles,
      v_policy_anon_cmd,
      v_policy_anon_permissive,
      v_policy_anon_qual,
      v_policy_anon_with_check
    from pg_catalog.pg_policy policy_row
    where policy_row.polrelid = 'public.conversation_ai_window_state'::regclass
      and policy_row.polname = 'deny_all_anon';

    select count(*)
    into v_policy_authenticated
    from pg_catalog.pg_policy
    where polrelid = 'public.conversation_ai_window_state'::regclass
      and polname = 'deny_all_authenticated';

    select
      array_to_string(array(
        select pg_catalog.pg_get_userbyid(role_oid)
        from unnest(policy_row.polroles) as role_oids(role_oid)
        order by role_oid
      ), ','),
      case policy_row.polcmd
        when 'r' then 'SELECT'
        when 'a' then 'INSERT'
        when 'w' then 'UPDATE'
        when 'd' then 'DELETE'
        when '*' then 'ALL'
        else policy_row.polcmd::text
      end,
      policy_row.polpermissive,
      pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid, true),
      pg_catalog.pg_get_expr(policy_row.polwithcheck, policy_row.polrelid, true)
    into
      v_policy_authenticated_roles,
      v_policy_authenticated_cmd,
      v_policy_authenticated_permissive,
      v_policy_authenticated_qual,
      v_policy_authenticated_with_check
    from pg_catalog.pg_policy policy_row
    where policy_row.polrelid = 'public.conversation_ai_window_state'::regclass
      and policy_row.polname = 'deny_all_authenticated';

    select count(*)
    into v_denied_write_anon
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'conversation_ai_window_state'
      and grantee = 'anon'
      and privilege_type in ('INSERT','UPDATE','DELETE');

    select count(*)
    into v_denied_write_authenticated
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'conversation_ai_window_state'
      and grantee = 'authenticated'
      and privilege_type in ('INSERT','UPDATE','DELETE');

    select count(*)
    into v_service_role_privs
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'conversation_ai_window_state'
      and grantee = 'service_role'
      and privilege_type in ('SELECT','INSERT','UPDATE','DELETE');

    if v_owner = 'postgres'
       and v_rls = true
       and v_forced_rls = false
       and v_total_policy_count = 2
       and v_policy_anon = 1
       and v_policy_authenticated = 1
       and v_policy_anon_roles = 'anon'
       and v_policy_anon_cmd = 'ALL'
       and v_policy_anon_permissive = true
       and coalesce(v_policy_anon_qual, '') = 'false'
       and coalesce(v_policy_anon_with_check, '') = 'false'
       and v_policy_authenticated_roles = 'authenticated'
       and v_policy_authenticated_cmd = 'ALL'
       and v_policy_authenticated_permissive = true
       and coalesce(v_policy_authenticated_qual, '') = 'false'
       and coalesce(v_policy_authenticated_with_check, '') = 'false'
       and v_denied_write_anon = 0
       and v_denied_write_authenticated = 0
       and v_service_role_privs = 4
    then
      perform pg_temp.record_result(16, 'seguranca owner rls grants', 'PASS', 'owner postgres, RLS habilitada e grants preservados');
    else
      perform pg_temp.record_result(16, 'seguranca owner rls grants', 'SUT_FAIL', format('owner=%s rls=%s forced=%s totalPolicies=%s anonPolicies=%s anonRoles=%s anonCmd=%s anonPermissive=%s anonQual=%s anonWithCheck=%s authPolicies=%s authRoles=%s authCmd=%s authPermissive=%s authQual=%s authWithCheck=%s anonWrites=%s authWrites=%s serviceRolePrivs=%s', v_owner, v_rls, v_forced_rls, v_total_policy_count, v_policy_anon, coalesce(v_policy_anon_roles, 'null'), coalesce(v_policy_anon_cmd, 'null'), v_policy_anon_permissive, coalesce(v_policy_anon_qual, 'null'), coalesce(v_policy_anon_with_check, 'null'), v_policy_authenticated, coalesce(v_policy_authenticated_roles, 'null'), coalesce(v_policy_authenticated_cmd, 'null'), v_policy_authenticated_permissive, coalesce(v_policy_authenticated_qual, 'null'), coalesce(v_policy_authenticated_with_check, 'null'), v_denied_write_anon, v_denied_write_authenticated, v_service_role_privs));
    end if;
  exception when others then
    perform pg_temp.record_result(16, 'seguranca owner rls grants', 'HARNESS_ERROR', sqlerrm);
  end;
end;
$$;

table pg_temp.test_results;

rollback;

select
  not exists (
    select 1
    from public.conversation_ai_window_state
    where conversation_id = '8b907ea4-8f75-4e72-b643-0c38f7d8d121'::uuid
  ) as fixture_window_absent,
  not exists (
    select 1
    from public.conversations
    where id = '8b907ea4-8f75-4e72-b643-0c38f7d8d121'::uuid
  ) as fixture_conversation_absent,
  not exists (
    select 1
    from public.leads
    where id in (
      'fb2a6ca5-44a9-463f-9c4e-93ba63c62801'::uuid,
      'f3463a92-04ee-4639-a94d-6fd7dd8ee584'::uuid,
      'f6e3e3de-7aaf-4124-9d43-908df95f4505'::uuid
    )
  ) as fixture_leads_absent,
  not exists (
    select 1
    from public.stores
    where id = '02be5b19-29fd-4945-9a45-f31d95c3ef01'::uuid
  ) as fixture_same_org_store_absent,
  not exists (
    select 1
    from public.stores
    where id = '71a8612e-4312-442f-b86e-f1def2672dc4'::uuid
  ) as fixture_other_org_store_absent,
  not exists (
    select 1
    from public.organizations
    where id = 'b7bf7e6e-a282-4e7a-a7c3-b7914eb1ee24'::uuid
  ) as fixture_org_absent;
