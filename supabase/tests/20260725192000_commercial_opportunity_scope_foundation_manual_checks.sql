begin;

set transaction isolation level repeatable read;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_13_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_13_fixture_ids (
  table_name text not null,
  row_id uuid not null,
  fixture_kind text not null,
  primary key (table_name, row_id, fixture_kind)
) on commit preserve rows;

create temp table pg_temp._p9_13_unexpected_acceptances (
  scenario_number integer not null,
  table_name text not null,
  operation_name text not null,
  row_id uuid not null,
  detail text not null
) on commit preserve rows;

create or replace function pg_temp._p9_13_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_13_results (
    scenario_number,
    scenario_name,
    status,
    detail
  )
  values (
    p_scenario_number,
    p_scenario_name,
    p_status,
    case
      when p_detail is null then '<null>'
      else p_detail
    end
  );
end;
$function$;

create or replace function pg_temp._p9_13_describe_index_contract(
  p_expected_index_schema text,
  p_expected_index_name text,
  p_expected_table_schema text,
  p_expected_table_name text,
  p_expected_access_method text,
  p_expected_is_unique boolean,
  p_expected_is_primary boolean,
  p_expected_indnkeyatts integer,
  p_expected_indnatts integer,
  p_expected_columns text[]
)
returns table (
  object_exists boolean,
  index_schema text,
  index_name text,
  table_schema text,
  table_name text,
  relkind text,
  access_method text,
  indisunique boolean,
  indisprimary boolean,
  indisvalid boolean,
  indisready boolean,
  indnkeyatts integer,
  indnatts integer,
  has_expressions boolean,
  is_partial boolean,
  actual_columns text[],
  exact_contract_matches boolean
)
language sql
as $function$
  with named_object as (
    select
      class_row.oid as class_oid,
      class_row.relkind::text as relkind,
      class_row.relname::text as index_name,
      namespace_row.nspname::text as index_schema,
      class_row.relam as relam_oid
    from pg_catalog.pg_class class_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = p_expected_index_schema
      and class_row.relname = p_expected_index_name
  ),
  described as (
    select
      true as object_exists,
      named_object.index_schema,
      named_object.index_name,
      table_namespace.nspname::text as table_schema,
      table_class.relname::text as table_name,
      named_object.relkind,
      am_row.amname::text as access_method,
      index_row.indisunique,
      index_row.indisprimary,
      index_row.indisvalid,
      index_row.indisready,
      index_row.indnkeyatts::integer as indnkeyatts,
      index_row.indnatts::integer as indnatts,
      (index_row.indexprs is not null) as has_expressions,
      (index_row.indpred is not null) as is_partial,
      (
        select array_agg(
                 attribute_row.attname::text
                 order by key_row.ordinality
               )
        from unnest(index_row.indkey::smallint[])
             with ordinality as key_row(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = index_row.indrelid
         and attribute_row.attnum = key_row.attnum
         and not attribute_row.attisdropped
      ) as actual_columns
    from named_object
    left join pg_catalog.pg_index index_row
      on index_row.indexrelid = named_object.class_oid
    left join pg_catalog.pg_class table_class
      on table_class.oid = index_row.indrelid
    left join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = table_class.relnamespace
    left join pg_catalog.pg_am am_row
      on am_row.oid = named_object.relam_oid
  )
  select
    described.object_exists,
    described.index_schema,
    described.index_name,
    described.table_schema,
    described.table_name,
    described.relkind,
    described.access_method,
    described.indisunique,
    described.indisprimary,
    described.indisvalid,
    described.indisready,
    described.indnkeyatts,
    described.indnatts,
    described.has_expressions,
    described.is_partial,
    described.actual_columns,
    (
      described.object_exists
      and described.index_schema = p_expected_index_schema
      and described.index_name = p_expected_index_name
      and described.table_schema = p_expected_table_schema
      and described.table_name = p_expected_table_name
      and described.relkind = 'i'
      and described.access_method = p_expected_access_method
      and described.indisunique = p_expected_is_unique
      and described.indisprimary = p_expected_is_primary
      and described.indisvalid is true
      and described.indisready is true
      and described.has_expressions is false
      and described.is_partial is false
      and described.indnkeyatts = p_expected_indnkeyatts
      and described.indnatts = p_expected_indnatts
      and described.actual_columns is not null
      and described.actual_columns = p_expected_columns
    ) as exact_contract_matches
  from described
  union all
  select
    false as object_exists,
    null::text as index_schema,
    null::text as index_name,
    null::text as table_schema,
    null::text as table_name,
    null::text as relkind,
    null::text as access_method,
    null::boolean as indisunique,
    null::boolean as indisprimary,
    null::boolean as indisvalid,
    null::boolean as indisready,
    null::integer as indnkeyatts,
    null::integer as indnatts,
    null::boolean as has_expressions,
    null::boolean as is_partial,
    null::text[] as actual_columns,
    false as exact_contract_matches
  where not exists (
    select 1
    from named_object
  );
$function$;

do $checks$
declare
  v_table text;
  v_expected_fk_name text;
  v_same_scope_opp_id uuid;
  v_same_scope_customer_id uuid;
  v_same_scope_store_id uuid;
  v_same_scope_organization_id uuid;
  v_row_id uuid;
  v_sqlstate text;
  v_message text;
  v_constraint text;
  v_details text[];
  v_null_success_count integer := 0;
  v_same_scope_success_count integer := 0;
  v_other_org_reject_count integer := 0;
  v_other_store_reject_count integer := 0;
  v_delete_restrict_reject_count integer := 0;
  v_other_org_diag text[];
  v_other_store_diag text[];
  v_delete_diag text[];
  v_cleanup_diag text[];
  v_cleanup_deleted integer;
  v_fixture_setup_ok boolean := true;
  v_catalog_before jsonb;
  v_catalog_after jsonb;
  v_history_before jsonb;
  v_history_after jsonb;
  v_sales_contracts_before jsonb;
  v_sales_contracts_after jsonb;
  v_total integer;
  v_index_contract record;
  v_expected_index record;
  v_index_diag text[];
  v_index_pass_count integer := 0;
  v_run_tag text := 'p9-etapa-1-3-scope-fixture-' || gen_random_uuid()::text;

  v_org_a_id uuid := gen_random_uuid();
  v_org_b_id uuid := gen_random_uuid();
  v_store_a1_id uuid := gen_random_uuid();
  v_store_a2_id uuid := gen_random_uuid();
  v_store_b1_id uuid := gen_random_uuid();
  v_customer_a_id uuid := gen_random_uuid();
  v_customer_b_id uuid := gen_random_uuid();
  v_quote_opp_id uuid := gen_random_uuid();
  v_appointment_opp_id uuid := gen_random_uuid();
  v_task_opp_id uuid := gen_random_uuid();
  v_other_org_opp_id uuid := gen_random_uuid();
  v_other_store_opp_id uuid := gen_random_uuid();
begin
  begin
    if exists (
      select 1
      from (
        values
          ('sales_quotes'::text),
          ('store_appointments'::text),
          ('store_assistant_operational_tasks'::text)
      ) as expected(table_name)
      left join information_schema.columns column_row
        on column_row.table_schema = 'public'
       and column_row.table_name = expected.table_name
       and column_row.column_name = 'commercial_opportunity_id'
      where column_row.column_name is null
         or column_row.data_type <> 'uuid'
         or column_row.is_nullable <> 'YES'
    ) then
      perform pg_temp._p9_13_record(
        1,
        'as tres colunas existem como uuid nullable',
        'SUT_FAIL',
        'uma ou mais colunas commercial_opportunity_id nao existem como uuid nullable'
      );
    else
      perform pg_temp._p9_13_record(
        1,
        'as tres colunas existem como uuid nullable',
        'PASS',
        'sales_quotes, store_appointments e store_assistant_operational_tasks expuseram commercial_opportunity_id uuid nullable'
      );
    end if;
  exception
    when others then
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;
      perform pg_temp._p9_13_record(
        1,
        'as tres colunas existem como uuid nullable',
        'HARNESS_ERROR',
        format(
          'falha no harness ao validar colunas: sqlstate=%s constraint=%s message=%s',
          v_sqlstate,
          case when v_constraint is null then '<null>' else v_constraint end,
          v_message
        )
      );
    end;

  begin
    select *
    into v_index_contract
    from pg_temp._p9_13_describe_index_contract(
      'public',
      'commercial_opportunities_id_organization_store_uidx',
      'public',
      'commercial_opportunities',
      'btree',
      true,
      false,
      3,
      3,
      array['id', 'organization_id', 'store_id']::text[]
    );

    if v_index_contract.exact_contract_matches is true then
      perform pg_temp._p9_13_record(
        2,
        'unicidade em commercial_opportunities existe',
        'PASS',
        'commercial_opportunities_id_organization_store_uidx atende ao contrato exato: public.commercial_opportunities, btree, unique, valido, ready, sem predicate, sem expressions e colunas id, organization_id, store_id'
      );
    else
      perform pg_temp._p9_13_record(
        2,
        'unicidade em commercial_opportunities existe',
        'SUT_FAIL',
        format(
          'contract mismatch: object_exists=%s index_schema=%s index_name=%s table_schema=%s table_name=%s relkind=%s access_method=%s indisunique=%s indisprimary=%s indisvalid=%s indisready=%s indnkeyatts=%s indnatts=%s has_expressions=%s is_partial=%s actual_columns=%s exact_contract_matches=%s',
          v_index_contract.object_exists,
          case when v_index_contract.index_schema is null then '<null>' else v_index_contract.index_schema end,
          case when v_index_contract.index_name is null then '<null>' else v_index_contract.index_name end,
          case when v_index_contract.table_schema is null then '<null>' else v_index_contract.table_schema end,
          case when v_index_contract.table_name is null then '<null>' else v_index_contract.table_name end,
          case when v_index_contract.relkind is null then '<null>' else v_index_contract.relkind end,
          case when v_index_contract.access_method is null then '<null>' else v_index_contract.access_method end,
          case when v_index_contract.indisunique is null then '<null>' else v_index_contract.indisunique::text end,
          case when v_index_contract.indisprimary is null then '<null>' else v_index_contract.indisprimary::text end,
          case when v_index_contract.indisvalid is null then '<null>' else v_index_contract.indisvalid::text end,
          case when v_index_contract.indisready is null then '<null>' else v_index_contract.indisready::text end,
          case when v_index_contract.indnkeyatts is null then '<null>' else v_index_contract.indnkeyatts::text end,
          case when v_index_contract.indnatts is null then '<null>' else v_index_contract.indnatts::text end,
          case when v_index_contract.has_expressions is null then '<null>' else v_index_contract.has_expressions::text end,
          case when v_index_contract.is_partial is null then '<null>' else v_index_contract.is_partial::text end,
          case when v_index_contract.actual_columns is null then '<null>' else array_to_string(v_index_contract.actual_columns, ',') end,
          v_index_contract.exact_contract_matches
        )
      );
    end if;
  exception
    when others then
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;
      perform pg_temp._p9_13_record(
        2,
        'unicidade em commercial_opportunities existe',
        'HARNESS_ERROR',
        format(
          'falha no harness ao validar indice unico: sqlstate=%s constraint=%s message=%s',
          v_sqlstate,
          case when v_constraint is null then '<null>' else v_constraint end,
          v_message
        )
      );
    end;

  begin
    if exists (
      select 1
      from (
        values
          ('public.sales_quotes'::regclass, 'sales_quotes_commercial_opportunity_scope_fkey'::text),
          ('public.store_appointments'::regclass, 'store_appointments_commercial_opportunity_scope_fkey'),
          ('public.store_assistant_operational_tasks'::regclass, 'store_assistant_operational_tasks_commercial_scope_fkey')
      ) as expected(relid, conname)
      left join pg_catalog.pg_constraint constraint_row
        on constraint_row.conrelid = expected.relid
       and constraint_row.conname = expected.conname
      where constraint_row.oid is null
         or constraint_row.contype <> 'f'
         or constraint_row.confrelid <> 'public.commercial_opportunities'::pg_catalog.regclass
         or constraint_row.convalidated is not true
         or constraint_row.confmatchtype <> 's'
         or constraint_row.confupdtype <> 'a'
         or constraint_row.confdeltype <> 'r'
         or constraint_row.condeferrable is not false
         or constraint_row.condeferred is not false
         or constraint_row.conkey <> array[
              (
                select attnum
                from pg_catalog.pg_attribute
                where attrelid = expected.relid
                  and attname = 'commercial_opportunity_id'
                  and not attisdropped
              ),
              (
                select attnum
                from pg_catalog.pg_attribute
                where attrelid = expected.relid
                  and attname = 'organization_id'
                  and not attisdropped
              ),
              (
                select attnum
                from pg_catalog.pg_attribute
                where attrelid = expected.relid
                  and attname = 'store_id'
                  and not attisdropped
              )
            ]::smallint[]
         or constraint_row.confkey <> array[
              (
                select attnum
                from pg_catalog.pg_attribute
                where attrelid = 'public.commercial_opportunities'::pg_catalog.regclass
                  and attname = 'id'
                  and not attisdropped
              ),
              (
                select attnum
                from pg_catalog.pg_attribute
                where attrelid = 'public.commercial_opportunities'::pg_catalog.regclass
                  and attname = 'organization_id'
                  and not attisdropped
              ),
              (
                select attnum
                from pg_catalog.pg_attribute
                where attrelid = 'public.commercial_opportunities'::pg_catalog.regclass
                  and attname = 'store_id'
                  and not attisdropped
              )
            ]::smallint[]
    ) then
      perform pg_temp._p9_13_record(
        3,
        'as tres FKs compostas existem e estao validadas com ON DELETE RESTRICT',
        'SUT_FAIL',
        'uma ou mais FKs compostas divergem em tabela, colunas, referencia, match simple, update no action, delete restrict, validacao ou deferrability'
      );
    else
      perform pg_temp._p9_13_record(
        3,
        'as tres FKs compostas existem e estao validadas com ON DELETE RESTRICT',
        'PASS',
        'as tres FKs compostas atendem ao contrato exato de tabela, ordem de colunas, referencia, match simple, update no action, delete restrict, validacao e not deferrable'
      );
    end if;
  exception
    when others then
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;
      perform pg_temp._p9_13_record(
        3,
        'as tres FKs compostas existem e estao validadas com ON DELETE RESTRICT',
        'HARNESS_ERROR',
        format(
          'falha no harness ao validar FKs: sqlstate=%s constraint=%s message=%s',
          v_sqlstate,
          case when v_constraint is null then '<null>' else v_constraint end,
          v_message
        )
      );
    end;

  begin
    v_index_pass_count := 0;
    v_index_diag := null;

    for v_expected_index in
      select *
      from (
        values
          ('sales_quotes_organization_store_commercial_opportunity_idx'::text, 'sales_quotes'::text),
          ('store_appointments_org_store_commercial_opportunity_idx'::text, 'store_appointments'::text),
          ('store_assistant_operational_tasks_org_store_opportunity_idx'::text, 'store_assistant_operational_tasks'::text)
      ) as expected(index_name, table_name)
    loop
      select *
      into v_index_contract
      from pg_temp._p9_13_describe_index_contract(
        'public',
        v_expected_index.index_name,
        'public',
        v_expected_index.table_name,
        'btree',
        false,
        false,
        3,
        3,
        array[
          'organization_id',
          'store_id',
          'commercial_opportunity_id'
        ]::text[]
      );

      if v_index_contract.exact_contract_matches is true then
        v_index_pass_count := v_index_pass_count + 1;
      else
        v_index_diag := array_append(
          v_index_diag,
          format(
            '%s: object_exists=%s index_schema=%s index_name=%s table_schema=%s table_name=%s relkind=%s access_method=%s indisunique=%s indisprimary=%s indisvalid=%s indisready=%s indnkeyatts=%s indnatts=%s has_expressions=%s is_partial=%s actual_columns=%s exact_contract_matches=%s',
            v_expected_index.index_name,
            v_index_contract.object_exists,
            case when v_index_contract.index_schema is null then '<null>' else v_index_contract.index_schema end,
            case when v_index_contract.index_name is null then '<null>' else v_index_contract.index_name end,
            case when v_index_contract.table_schema is null then '<null>' else v_index_contract.table_schema end,
            case when v_index_contract.table_name is null then '<null>' else v_index_contract.table_name end,
            case when v_index_contract.relkind is null then '<null>' else v_index_contract.relkind end,
            case when v_index_contract.access_method is null then '<null>' else v_index_contract.access_method end,
            case when v_index_contract.indisunique is null then '<null>' else v_index_contract.indisunique::text end,
            case when v_index_contract.indisprimary is null then '<null>' else v_index_contract.indisprimary::text end,
            case when v_index_contract.indisvalid is null then '<null>' else v_index_contract.indisvalid::text end,
            case when v_index_contract.indisready is null then '<null>' else v_index_contract.indisready::text end,
            case when v_index_contract.indnkeyatts is null then '<null>' else v_index_contract.indnkeyatts::text end,
            case when v_index_contract.indnatts is null then '<null>' else v_index_contract.indnatts::text end,
            case when v_index_contract.has_expressions is null then '<null>' else v_index_contract.has_expressions::text end,
            case when v_index_contract.is_partial is null then '<null>' else v_index_contract.is_partial::text end,
            case when v_index_contract.actual_columns is null then '<null>' else array_to_string(v_index_contract.actual_columns, ',') end,
            v_index_contract.exact_contract_matches
          )
        );
      end if;
    end loop;

    if v_index_pass_count = 3 then
      perform pg_temp._p9_13_record(
        4,
        'os tres indices de leitura existem',
        'PASS',
        'os tres indices de leitura atendem ao contrato exato 3/3: schema public, tabela correta, btree, nao unico, valido, ready, sem predicate, sem expressions e colunas organization_id, store_id, commercial_opportunity_id'
      );
    else
      perform pg_temp._p9_13_record(
        4,
        'os tres indices de leitura existem',
        'SUT_FAIL',
        format(
          'cenario 4 exige 3/3 indices validos, mas obteve %s. Diagnostico: %s',
          v_index_pass_count,
          array_to_string(v_index_diag, ' | ')
        )
      );
    end if;
  exception
    when others then
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;
      perform pg_temp._p9_13_record(
        4,
        'os tres indices de leitura existem',
        'HARNESS_ERROR',
        format(
          'falha no harness ao validar indices de leitura: sqlstate=%s constraint=%s message=%s',
          v_sqlstate,
          case when v_constraint is null then '<null>' else v_constraint end,
          v_message
        )
      );
    end;

  begin
    select jsonb_agg(snapshot_row order by snapshot_row.table_name)
    into v_catalog_before
    from (
      select
        class_row.relname as table_name,
        class_row.relrowsecurity as rls_enabled,
        (
          select jsonb_agg(
                   jsonb_build_object(
                     'name', trigger_row.tgname,
                     'enabled', trigger_row.tgenabled
                   )
                   order by trigger_row.tgname
                 )
          from pg_catalog.pg_trigger trigger_row
          where trigger_row.tgrelid = class_row.oid
            and not trigger_row.tgisinternal
        ) as triggers_snapshot,
        (
          select jsonb_agg(
                   jsonb_build_object(
                     'name', policy_row.policyname,
                     'cmd', policy_row.cmd
                   )
                   order by policy_row.policyname
                 )
          from pg_catalog.pg_policies policy_row
          where policy_row.schemaname = 'public'
            and policy_row.tablename = class_row.relname
        ) as policies_snapshot,
        (
          select jsonb_agg(
                   jsonb_build_object(
                     'grantee', grant_row.grantee,
                     'privilege_type', grant_row.privilege_type
                   )
                   order by grant_row.grantee, grant_row.privilege_type
                 )
          from information_schema.role_table_grants grant_row
          where grant_row.table_schema = 'public'
            and grant_row.table_name = class_row.relname
        ) as grants_snapshot
      from pg_catalog.pg_class class_row
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = class_row.relnamespace
      where namespace_row.nspname = 'public'
        and class_row.relname in (
          'commercial_opportunities',
          'sales_quotes',
          'store_appointments',
          'store_assistant_operational_tasks',
          'sales_contracts'
        )
    ) snapshot_row;

    select jsonb_agg(snapshot_row order by snapshot_row.table_name)
    into v_history_before
    from (
      select
        'commercial_opportunities'::text as table_name,
        count(*) as row_count,
        sum(pg_catalog.hashtextextended(id::text || ':' || xmin::text, 0)::numeric) as row_signature
      from public.commercial_opportunities
      union all
      select
        'sales_quotes'::text as table_name,
        count(*) as row_count,
        sum(pg_catalog.hashtextextended(id::text || ':' || xmin::text, 0)::numeric) as row_signature
      from public.sales_quotes
      union all
      select
        'store_appointments'::text as table_name,
        count(*) as row_count,
        sum(pg_catalog.hashtextextended(id::text || ':' || xmin::text, 0)::numeric) as row_signature
      from public.store_appointments
      union all
      select
        'store_assistant_operational_tasks'::text as table_name,
        count(*) as row_count,
        sum(pg_catalog.hashtextextended(id::text || ':' || xmin::text, 0)::numeric) as row_signature
      from public.store_assistant_operational_tasks
      union all
      select
        'sales_contracts'::text as table_name,
        count(*) as row_count,
        sum(pg_catalog.hashtextextended(id::text || ':' || xmin::text, 0)::numeric) as row_signature
      from public.sales_contracts
    ) snapshot_row;

    select jsonb_build_object(
      'columns',
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'column_name', column_row.column_name,
                   'data_type', column_row.data_type,
                   'is_nullable', column_row.is_nullable,
                   'ordinal_position', column_row.ordinal_position
                 )
                 order by column_row.ordinal_position
               )
        from information_schema.columns column_row
        where column_row.table_schema = 'public'
          and column_row.table_name = 'sales_contracts'
      ),
      'constraints',
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'name', constraint_row.conname,
                   'type', constraint_row.contype
                 )
                 order by constraint_row.conname
               )
        from pg_catalog.pg_constraint constraint_row
        where constraint_row.conrelid = 'public.sales_contracts'::pg_catalog.regclass
      ),
      'indexes',
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'name', class_row.relname,
                   'is_unique', index_row.indisunique
                 )
                 order by class_row.relname
               )
        from pg_catalog.pg_index index_row
        join pg_catalog.pg_class class_row
          on class_row.oid = index_row.indexrelid
        where index_row.indrelid = 'public.sales_contracts'::pg_catalog.regclass
      )
    )
    into v_sales_contracts_before;
  exception
    when others then
      v_fixture_setup_ok := false;
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;
      perform pg_temp._p9_13_record(
        12,
        'o runner nao altera triggers, RLS, policies ou grants das tabelas auditadas',
        'HARNESS_ERROR',
        format(
          'falha ao capturar snapshots iniciais: sqlstate=%s constraint=%s message=%s',
          v_sqlstate,
          case when v_constraint is null then '<null>' else v_constraint end,
          v_message
        )
      );
      perform pg_temp._p9_13_record(
        10,
        'os registros preexistentes nao sao alterados pelo runner',
        'HARNESS_ERROR',
        'snapshot inicial indisponivel por falha do harness'
      );
      perform pg_temp._p9_13_record(
        11,
        'public.sales_contracts permanece sem commercial_opportunity_id e o runner nao altera sua estrutura',
        'HARNESS_ERROR',
        'snapshot estrutural inicial de sales_contracts indisponivel por falha do harness'
      );
    end;

  begin
    insert into public.organizations (id, name, subscription_status)
    values
      (v_org_a_id, 'Fixture Org A ' || v_run_tag, 'active'),
      (v_org_b_id, 'Fixture Org B ' || v_run_tag, 'active');

    insert into pg_temp._p9_13_fixture_ids (table_name, row_id, fixture_kind)
    values
      ('organizations', v_org_a_id, 'org_a'),
      ('organizations', v_org_b_id, 'org_b');

    insert into public.stores (id, organization_id, name)
    values
      (v_store_a1_id, v_org_a_id, 'Fixture Store A1 ' || v_run_tag),
      (v_store_a2_id, v_org_a_id, 'Fixture Store A2 ' || v_run_tag),
      (v_store_b1_id, v_org_b_id, 'Fixture Store B1 ' || v_run_tag);

    insert into pg_temp._p9_13_fixture_ids (table_name, row_id, fixture_kind)
    values
      ('stores', v_store_a1_id, 'store_a1'),
      ('stores', v_store_a2_id, 'store_a2'),
      ('stores', v_store_b1_id, 'store_b1');

    insert into public.customers (
      id,
      organization_id,
      display_name,
      normalized_name
    )
    values
      (v_customer_a_id, v_org_a_id, 'Fixture Customer A ' || v_run_tag, 'fixture-customer-a-' || v_run_tag),
      (v_customer_b_id, v_org_b_id, 'Fixture Customer B ' || v_run_tag, 'fixture-customer-b-' || v_run_tag);

    insert into pg_temp._p9_13_fixture_ids (table_name, row_id, fixture_kind)
    values
      ('customers', v_customer_a_id, 'customer_a'),
      ('customers', v_customer_b_id, 'customer_b');

    insert into public.commercial_opportunities (
      id,
      organization_id,
      store_id,
      customer_id,
      origin_lead_id,
      primary_conversation_id,
      stage
    )
    values
      (v_quote_opp_id, v_org_a_id, v_store_a1_id, v_customer_a_id, null, null, 'orcamento'),
      (v_appointment_opp_id, v_org_a_id, v_store_a1_id, v_customer_a_id, null, null, 'visita_tecnica'),
      (v_task_opp_id, v_org_a_id, v_store_a1_id, v_customer_a_id, null, null, 'negociacao'),
      (v_other_store_opp_id, v_org_a_id, v_store_a2_id, v_customer_a_id, null, null, 'qualificacao'),
      (v_other_org_opp_id, v_org_b_id, v_store_b1_id, v_customer_b_id, null, null, 'qualificacao');

    insert into pg_temp._p9_13_fixture_ids (table_name, row_id, fixture_kind)
    values
      ('commercial_opportunities', v_quote_opp_id, 'quote_same_scope'),
      ('commercial_opportunities', v_appointment_opp_id, 'appointment_same_scope'),
      ('commercial_opportunities', v_task_opp_id, 'task_same_scope'),
      ('commercial_opportunities', v_other_store_opp_id, 'other_store_scope'),
      ('commercial_opportunities', v_other_org_opp_id, 'other_org_scope');
  exception
    when others then
      v_fixture_setup_ok := false;
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;
      perform pg_temp._p9_13_record(
        5,
        'registro com commercial_opportunity_id NULL continua permitido',
        'HARNESS_ERROR',
        format(
          'fixtures isoladas nao puderam ser criadas: sqlstate=%s constraint=%s message=%s',
          v_sqlstate,
          case when v_constraint is null then '<null>' else v_constraint end,
          v_message
        )
      );
      perform pg_temp._p9_13_record(
        6,
        'registro com oportunidade do mesmo organization/store e permitido',
        'HARNESS_ERROR',
        'fixtures isoladas indisponiveis'
      );
      perform pg_temp._p9_13_record(
        7,
        'oportunidade de outra organizacao e rejeitada',
        'HARNESS_ERROR',
        'fixtures isoladas indisponiveis'
      );
      perform pg_temp._p9_13_record(
        8,
        'oportunidade de outra loja e rejeitada',
        'HARNESS_ERROR',
        'fixtures isoladas indisponiveis'
      );
      perform pg_temp._p9_13_record(
        9,
        'tentativa de excluir oportunidade referenciada e rejeitada',
        'HARNESS_ERROR',
        'fixtures isoladas indisponiveis'
      );
    end;

  if v_fixture_setup_ok then
    for v_table in
      select unnest(array[
        'sales_quotes'::text,
        'store_appointments',
        'store_assistant_operational_tasks'
      ])
    loop
      v_same_scope_organization_id := v_org_a_id;
      v_same_scope_store_id := v_store_a1_id;
      v_same_scope_customer_id := v_customer_a_id;
      v_expected_fk_name := case v_table
        when 'sales_quotes' then 'sales_quotes_commercial_opportunity_scope_fkey'
        when 'store_appointments' then 'store_appointments_commercial_opportunity_scope_fkey'
        else 'store_assistant_operational_tasks_commercial_scope_fkey'
      end;
      v_same_scope_opp_id := case v_table
        when 'sales_quotes' then v_quote_opp_id
        when 'store_appointments' then v_appointment_opp_id
        else v_task_opp_id
      end;

      v_row_id := gen_random_uuid();
      insert into pg_temp._p9_13_fixture_ids (table_name, row_id, fixture_kind)
      values (v_table, v_row_id, 'null_insert_attempt');

      begin
        if v_table = 'sales_quotes' then
          insert into public.sales_quotes (
            id,
            organization_id,
            store_id,
            conversation_id,
            lead_id,
            quote_number,
            title,
            status,
            customer_name,
            customer_phone,
            customer_notes,
            internal_notes,
            subtotal_cents,
            discount_cents,
            total_cents,
            current_version_id,
            metadata,
            commercial_opportunity_id
          )
          values (
            v_row_id,
            v_same_scope_organization_id,
            v_same_scope_store_id,
            null,
            null,
            'Q-' || replace(v_row_id::text, '-', ''),
            'Fixture Quote ' || v_row_id::text,
            'draft',
            'Fixture Customer A',
            null,
            null,
            null,
            1000,
            0,
            1000,
            null,
            jsonb_build_object('runner', v_run_tag, 'table', v_table, 'scenario', 5),
            null
          );
        elsif v_table = 'store_appointments' then
          insert into public.store_appointments (
            id,
            organization_id,
            store_id,
            title,
            appointment_type,
            status,
            scheduled_start,
            scheduled_end,
            customer_name,
            customer_phone,
            address_text,
            notes,
            lead_id,
            conversation_id,
            commercial_opportunity_id
          )
          values (
            v_row_id,
            v_same_scope_organization_id,
            v_same_scope_store_id,
            'Fixture Appointment ' || v_row_id::text,
            'technical_visit',
            'scheduled',
            now() + interval '1 day',
            now() + interval '1 day 1 hour',
            'Fixture Customer A',
            null,
            'Rua Fixture 100',
            'Runner fixture scenario 5',
            null,
            null,
            null
          );
        else
          insert into public.store_assistant_operational_tasks (
            id,
            organization_id,
            store_id,
            thread_id,
            task_type,
            status,
            priority,
            title,
            description,
            related_lead_id,
            related_conversation_id,
            related_appointment_id,
            customer_name,
            customer_phone,
            target_date,
            target_time,
            target_start_at,
            target_end_at,
            timezone_name,
            task_payload,
            commercial_opportunity_id
          )
          values (
            v_row_id,
            v_same_scope_organization_id,
            v_same_scope_store_id,
            null,
            'commercial_quote_request',
            'open',
            'normal',
            'Fixture Task ' || v_row_id::text,
            'Runner fixture scenario 5',
            null,
            null,
            null,
            'Fixture Customer A',
            null,
            null,
            null,
            null,
            null,
            'America/Sao_Paulo',
            jsonb_build_object('runner', v_run_tag, 'table', v_table, 'scenario', 5),
            null
          );
        end if;

        v_null_success_count := v_null_success_count + 1;
      exception
        when others then
          get stacked diagnostics
            v_sqlstate = returned_sqlstate,
            v_message = message_text,
            v_constraint = constraint_name;
          v_details := array_append(
            v_details,
            format(
              '%s null insert falhou com sqlstate=%s constraint=%s message=%s',
              v_table,
              v_sqlstate,
              case when v_constraint is null then '<null>' else v_constraint end,
              v_message
            )
          );
      end;

      v_row_id := gen_random_uuid();
      insert into pg_temp._p9_13_fixture_ids (table_name, row_id, fixture_kind)
      values (v_table, v_row_id, 'same_scope_insert_attempt');

      begin
        if v_table = 'sales_quotes' then
          insert into public.sales_quotes (
            id,
            organization_id,
            store_id,
            conversation_id,
            lead_id,
            quote_number,
            title,
            status,
            customer_name,
            customer_phone,
            customer_notes,
            internal_notes,
            subtotal_cents,
            discount_cents,
            total_cents,
            current_version_id,
            metadata,
            commercial_opportunity_id
          )
          values (
            v_row_id,
            v_same_scope_organization_id,
            v_same_scope_store_id,
            null,
            null,
            'Q-' || replace(v_row_id::text, '-', ''),
            'Fixture Quote Same Scope ' || v_row_id::text,
            'draft',
            'Fixture Customer A',
            null,
            null,
            null,
            2000,
            0,
            2000,
            null,
            jsonb_build_object('runner', v_run_tag, 'table', v_table, 'scenario', 6),
            v_same_scope_opp_id
          );
        elsif v_table = 'store_appointments' then
          insert into public.store_appointments (
            id,
            organization_id,
            store_id,
            title,
            appointment_type,
            status,
            scheduled_start,
            scheduled_end,
            customer_name,
            customer_phone,
            address_text,
            notes,
            lead_id,
            conversation_id,
            commercial_opportunity_id
          )
          values (
            v_row_id,
            v_same_scope_organization_id,
            v_same_scope_store_id,
            'Fixture Appointment Same Scope ' || v_row_id::text,
            'technical_visit',
            'scheduled',
            now() + interval '2 days',
            now() + interval '2 days 1 hour',
            'Fixture Customer A',
            null,
            'Rua Fixture 200',
            'Runner fixture scenario 6',
            null,
            null,
            v_same_scope_opp_id
          );
        else
          insert into public.store_assistant_operational_tasks (
            id,
            organization_id,
            store_id,
            thread_id,
            task_type,
            status,
            priority,
            title,
            description,
            related_lead_id,
            related_conversation_id,
            related_appointment_id,
            customer_name,
            customer_phone,
            target_date,
            target_time,
            target_start_at,
            target_end_at,
            timezone_name,
            task_payload,
            commercial_opportunity_id
          )
          values (
            v_row_id,
            v_same_scope_organization_id,
            v_same_scope_store_id,
            null,
            'commercial_quote_request',
            'open',
            'normal',
            'Fixture Task Same Scope ' || v_row_id::text,
            'Runner fixture scenario 6',
            null,
            null,
            null,
            'Fixture Customer A',
            null,
            null,
            null,
            null,
            null,
            'America/Sao_Paulo',
            jsonb_build_object('runner', v_run_tag, 'table', v_table, 'scenario', 6),
            v_same_scope_opp_id
          );
        end if;

        v_same_scope_success_count := v_same_scope_success_count + 1;
      exception
        when others then
          get stacked diagnostics
            v_sqlstate = returned_sqlstate,
            v_message = message_text,
            v_constraint = constraint_name;
          v_details := array_append(
            v_details,
            format(
              '%s same scope insert falhou com sqlstate=%s constraint=%s message=%s',
              v_table,
              v_sqlstate,
              case when v_constraint is null then '<null>' else v_constraint end,
              v_message
            )
          );
      end;

      v_row_id := gen_random_uuid();
      insert into pg_temp._p9_13_fixture_ids (table_name, row_id, fixture_kind)
      values (v_table, v_row_id, 'other_org_insert_attempt');

      begin
        if v_table = 'sales_quotes' then
          insert into public.sales_quotes (
            id,
            organization_id,
            store_id,
            conversation_id,
            lead_id,
            quote_number,
            title,
            status,
            customer_name,
            customer_phone,
            customer_notes,
            internal_notes,
            subtotal_cents,
            discount_cents,
            total_cents,
            current_version_id,
            metadata,
            commercial_opportunity_id
          )
          values (
            v_row_id,
            v_same_scope_organization_id,
            v_same_scope_store_id,
            null,
            null,
            'Q-' || replace(v_row_id::text, '-', ''),
            'Fixture Quote Other Org ' || v_row_id::text,
            'draft',
            'Fixture Customer A',
            null,
            null,
            null,
            3000,
            0,
            3000,
            null,
            jsonb_build_object('runner', v_run_tag, 'table', v_table, 'scenario', 7),
            v_other_org_opp_id
          );
        elsif v_table = 'store_appointments' then
          insert into public.store_appointments (
            id,
            organization_id,
            store_id,
            title,
            appointment_type,
            status,
            scheduled_start,
            scheduled_end,
            customer_name,
            customer_phone,
            address_text,
            notes,
            lead_id,
            conversation_id,
            commercial_opportunity_id
          )
          values (
            v_row_id,
            v_same_scope_organization_id,
            v_same_scope_store_id,
            'Fixture Appointment Other Org ' || v_row_id::text,
            'technical_visit',
            'scheduled',
            now() + interval '3 days',
            now() + interval '3 days 1 hour',
            'Fixture Customer A',
            null,
            'Rua Fixture 300',
            'Runner fixture scenario 7',
            null,
            null,
            v_other_org_opp_id
          );
        else
          insert into public.store_assistant_operational_tasks (
            id,
            organization_id,
            store_id,
            thread_id,
            task_type,
            status,
            priority,
            title,
            description,
            related_lead_id,
            related_conversation_id,
            related_appointment_id,
            customer_name,
            customer_phone,
            target_date,
            target_time,
            target_start_at,
            target_end_at,
            timezone_name,
            task_payload,
            commercial_opportunity_id
          )
          values (
            v_row_id,
            v_same_scope_organization_id,
            v_same_scope_store_id,
            null,
            'commercial_quote_request',
            'open',
            'normal',
            'Fixture Task Other Org ' || v_row_id::text,
            'Runner fixture scenario 7',
            null,
            null,
            null,
            'Fixture Customer A',
            null,
            null,
            null,
            null,
            null,
            'America/Sao_Paulo',
            jsonb_build_object('runner', v_run_tag, 'table', v_table, 'scenario', 7),
            v_other_org_opp_id
          );
        end if;

        insert into pg_temp._p9_13_unexpected_acceptances (
          scenario_number,
          table_name,
          operation_name,
          row_id,
          detail
        )
        values (
          7,
          v_table,
          'insert_other_org',
          v_row_id,
          format('%s aceitou oportunidade de outra organizacao', v_table)
        );

        v_other_org_diag := array_append(
          v_other_org_diag,
          format('%s aceitou insert cross-organization com id=%s', v_table, v_row_id::text)
        );
      exception
        when foreign_key_violation then
          get stacked diagnostics
            v_sqlstate = returned_sqlstate,
            v_message = message_text,
            v_constraint = constraint_name;
          if v_sqlstate = '23503' and v_constraint = v_expected_fk_name then
            v_other_org_reject_count := v_other_org_reject_count + 1;
          else
            v_other_org_diag := array_append(
              v_other_org_diag,
              format(
                '%s retornou diagnostico divergente no cross-organization: sqlstate=%s constraint=%s message=%s',
                v_table,
                v_sqlstate,
                case when v_constraint is null then '<null>' else v_constraint end,
                v_message
              )
            );
          end if;
        when others then
          get stacked diagnostics
            v_sqlstate = returned_sqlstate,
            v_message = message_text,
            v_constraint = constraint_name;
          v_other_org_diag := array_append(
            v_other_org_diag,
            format(
              '%s retornou erro divergente no cross-organization: sqlstate=%s constraint=%s message=%s',
              v_table,
              v_sqlstate,
              case when v_constraint is null then '<null>' else v_constraint end,
              v_message
            )
          );
      end;

      v_row_id := gen_random_uuid();
      insert into pg_temp._p9_13_fixture_ids (table_name, row_id, fixture_kind)
      values (v_table, v_row_id, 'other_store_insert_attempt');

      begin
        if v_table = 'sales_quotes' then
          insert into public.sales_quotes (
            id,
            organization_id,
            store_id,
            conversation_id,
            lead_id,
            quote_number,
            title,
            status,
            customer_name,
            customer_phone,
            customer_notes,
            internal_notes,
            subtotal_cents,
            discount_cents,
            total_cents,
            current_version_id,
            metadata,
            commercial_opportunity_id
          )
          values (
            v_row_id,
            v_same_scope_organization_id,
            v_same_scope_store_id,
            null,
            null,
            'Q-' || replace(v_row_id::text, '-', ''),
            'Fixture Quote Other Store ' || v_row_id::text,
            'draft',
            'Fixture Customer A',
            null,
            null,
            null,
            4000,
            0,
            4000,
            null,
            jsonb_build_object('runner', v_run_tag, 'table', v_table, 'scenario', 8),
            v_other_store_opp_id
          );
        elsif v_table = 'store_appointments' then
          insert into public.store_appointments (
            id,
            organization_id,
            store_id,
            title,
            appointment_type,
            status,
            scheduled_start,
            scheduled_end,
            customer_name,
            customer_phone,
            address_text,
            notes,
            lead_id,
            conversation_id,
            commercial_opportunity_id
          )
          values (
            v_row_id,
            v_same_scope_organization_id,
            v_same_scope_store_id,
            'Fixture Appointment Other Store ' || v_row_id::text,
            'technical_visit',
            'scheduled',
            now() + interval '4 days',
            now() + interval '4 days 1 hour',
            'Fixture Customer A',
            null,
            'Rua Fixture 400',
            'Runner fixture scenario 8',
            null,
            null,
            v_other_store_opp_id
          );
        else
          insert into public.store_assistant_operational_tasks (
            id,
            organization_id,
            store_id,
            thread_id,
            task_type,
            status,
            priority,
            title,
            description,
            related_lead_id,
            related_conversation_id,
            related_appointment_id,
            customer_name,
            customer_phone,
            target_date,
            target_time,
            target_start_at,
            target_end_at,
            timezone_name,
            task_payload,
            commercial_opportunity_id
          )
          values (
            v_row_id,
            v_same_scope_organization_id,
            v_same_scope_store_id,
            null,
            'commercial_quote_request',
            'open',
            'normal',
            'Fixture Task Other Store ' || v_row_id::text,
            'Runner fixture scenario 8',
            null,
            null,
            null,
            'Fixture Customer A',
            null,
            null,
            null,
            null,
            null,
            'America/Sao_Paulo',
            jsonb_build_object('runner', v_run_tag, 'table', v_table, 'scenario', 8),
            v_other_store_opp_id
          );
        end if;

        insert into pg_temp._p9_13_unexpected_acceptances (
          scenario_number,
          table_name,
          operation_name,
          row_id,
          detail
        )
        values (
          8,
          v_table,
          'insert_other_store',
          v_row_id,
          format('%s aceitou oportunidade de outra loja', v_table)
        );

        v_other_store_diag := array_append(
          v_other_store_diag,
          format('%s aceitou insert cross-store com id=%s', v_table, v_row_id::text)
        );
      exception
        when foreign_key_violation then
          get stacked diagnostics
            v_sqlstate = returned_sqlstate,
            v_message = message_text,
            v_constraint = constraint_name;
          if v_sqlstate = '23503' and v_constraint = v_expected_fk_name then
            v_other_store_reject_count := v_other_store_reject_count + 1;
          else
            v_other_store_diag := array_append(
              v_other_store_diag,
              format(
                '%s retornou diagnostico divergente no cross-store: sqlstate=%s constraint=%s message=%s',
                v_table,
                v_sqlstate,
                case when v_constraint is null then '<null>' else v_constraint end,
                v_message
              )
            );
          end if;
        when others then
          get stacked diagnostics
            v_sqlstate = returned_sqlstate,
            v_message = message_text,
            v_constraint = constraint_name;
          v_other_store_diag := array_append(
            v_other_store_diag,
            format(
              '%s retornou erro divergente no cross-store: sqlstate=%s constraint=%s message=%s',
              v_table,
              v_sqlstate,
              case when v_constraint is null then '<null>' else v_constraint end,
              v_message
            )
          );
      end;

      v_row_id := gen_random_uuid();
      insert into pg_temp._p9_13_fixture_ids (table_name, row_id, fixture_kind)
      values (v_table, v_row_id, 'delete_restrict_insert_attempt');

      begin
        if v_table = 'sales_quotes' then
          insert into public.sales_quotes (
            id,
            organization_id,
            store_id,
            conversation_id,
            lead_id,
            quote_number,
            title,
            status,
            customer_name,
            customer_phone,
            customer_notes,
            internal_notes,
            subtotal_cents,
            discount_cents,
            total_cents,
            current_version_id,
            metadata,
            commercial_opportunity_id
          )
          values (
            v_row_id,
            v_same_scope_organization_id,
            v_same_scope_store_id,
            null,
            null,
            'Q-' || replace(v_row_id::text, '-', ''),
            'Fixture Quote Restrict ' || v_row_id::text,
            'draft',
            'Fixture Customer A',
            null,
            null,
            null,
            5000,
            0,
            5000,
            null,
            jsonb_build_object('runner', v_run_tag, 'table', v_table, 'scenario', 9),
            v_same_scope_opp_id
          );
        elsif v_table = 'store_appointments' then
          insert into public.store_appointments (
            id,
            organization_id,
            store_id,
            title,
            appointment_type,
            status,
            scheduled_start,
            scheduled_end,
            customer_name,
            customer_phone,
            address_text,
            notes,
            lead_id,
            conversation_id,
            commercial_opportunity_id
          )
          values (
            v_row_id,
            v_same_scope_organization_id,
            v_same_scope_store_id,
            'Fixture Appointment Restrict ' || v_row_id::text,
            'technical_visit',
            'scheduled',
            now() + interval '5 days',
            now() + interval '5 days 1 hour',
            'Fixture Customer A',
            null,
            'Rua Fixture 500',
            'Runner fixture scenario 9',
            null,
            null,
            v_same_scope_opp_id
          );
        else
          insert into public.store_assistant_operational_tasks (
            id,
            organization_id,
            store_id,
            thread_id,
            task_type,
            status,
            priority,
            title,
            description,
            related_lead_id,
            related_conversation_id,
            related_appointment_id,
            customer_name,
            customer_phone,
            target_date,
            target_time,
            target_start_at,
            target_end_at,
            timezone_name,
            task_payload,
            commercial_opportunity_id
          )
          values (
            v_row_id,
            v_same_scope_organization_id,
            v_same_scope_store_id,
            null,
            'commercial_quote_request',
            'open',
            'normal',
            'Fixture Task Restrict ' || v_row_id::text,
            'Runner fixture scenario 9',
            null,
            null,
            null,
            'Fixture Customer A',
            null,
            null,
            null,
            null,
            null,
            'America/Sao_Paulo',
            jsonb_build_object('runner', v_run_tag, 'table', v_table, 'scenario', 9),
            v_same_scope_opp_id
          );
        end if;

        begin
          delete from public.commercial_opportunities
          where id = v_same_scope_opp_id;

          insert into pg_temp._p9_13_unexpected_acceptances (
            scenario_number,
            table_name,
            operation_name,
            row_id,
            detail
          )
          values (
            9,
            v_table,
            'delete_referenced_opportunity',
            v_same_scope_opp_id,
            format(
              '%s aceitou delete_referenced_opportunity para opportunity_id=%s',
              v_table,
              v_same_scope_opp_id::text
            )
          );

          v_delete_diag := array_append(
            v_delete_diag,
            format('%s aceitou delete da oportunidade referenciada %s', v_table, v_same_scope_opp_id::text)
          );
        exception
          when foreign_key_violation then
            get stacked diagnostics
              v_sqlstate = returned_sqlstate,
              v_message = message_text,
              v_constraint = constraint_name;
            if v_sqlstate = '23503' and v_constraint = v_expected_fk_name then
              v_delete_restrict_reject_count := v_delete_restrict_reject_count + 1;
            else
              v_delete_diag := array_append(
                v_delete_diag,
                format(
                  '%s retornou diagnostico divergente no delete restrict: sqlstate=%s constraint=%s message=%s',
                  v_table,
                  v_sqlstate,
                  case when v_constraint is null then '<null>' else v_constraint end,
                  v_message
                )
              );
            end if;
          when others then
            get stacked diagnostics
              v_sqlstate = returned_sqlstate,
              v_message = message_text,
              v_constraint = constraint_name;
            v_delete_diag := array_append(
              v_delete_diag,
              format(
                '%s retornou erro divergente no delete restrict: sqlstate=%s constraint=%s message=%s',
                v_table,
                v_sqlstate,
                case when v_constraint is null then '<null>' else v_constraint end,
                v_message
              )
            );
        end;
      exception
        when others then
          get stacked diagnostics
            v_sqlstate = returned_sqlstate,
            v_message = message_text,
            v_constraint = constraint_name;
          v_delete_diag := array_append(
            v_delete_diag,
            format(
              '%s nao conseguiu montar o cenario de delete restrict: sqlstate=%s constraint=%s message=%s',
              v_table,
              v_sqlstate,
              case when v_constraint is null then '<null>' else v_constraint end,
              v_message
            )
          );
      end;
    end loop;

    if v_null_success_count = 3 then
      perform pg_temp._p9_13_record(
        5,
        'registro com commercial_opportunity_id NULL continua permitido',
        'PASS',
        'os 3 inserts com commercial_opportunity_id null foram aceitos'
      );
    else
      perform pg_temp._p9_13_record(
        5,
        'registro com commercial_opportunity_id NULL continua permitido',
        'SUT_FAIL',
        format(
          'cenario exigia 3 de 3 tabelas, mas somente %s passaram. Diagnostico: %s',
          v_null_success_count,
          array_to_string(v_details, ' | ')
        )
      );
    end if;

    if v_same_scope_success_count = 3 then
      perform pg_temp._p9_13_record(
        6,
        'registro com oportunidade do mesmo organization/store e permitido',
        'PASS',
        'os 3 inserts com oportunidade do mesmo organization/store foram aceitos'
      );
    else
      perform pg_temp._p9_13_record(
        6,
        'registro com oportunidade do mesmo organization/store e permitido',
        'SUT_FAIL',
        format(
          'cenario exigia 3 de 3 tabelas, mas somente %s passaram. Diagnostico: %s',
          v_same_scope_success_count,
          array_to_string(v_details, ' | ')
        )
      );
    end if;

    if v_other_org_reject_count = 3 and not exists (
      select 1
      from pg_temp._p9_13_unexpected_acceptances unexpected_row
      where unexpected_row.scenario_number = 7
    ) then
      perform pg_temp._p9_13_record(
        7,
        'oportunidade de outra organizacao e rejeitada',
        'PASS',
        'as 3 tabelas rejeitaram insert cross-organization com sqlstate 23503 e a FK exata'
      );
    else
      perform pg_temp._p9_13_record(
        7,
        'oportunidade de outra organizacao e rejeitada',
        'SUT_FAIL',
        format(
          'cenario exigia 3 rejeicoes exatas, mas obteve %s. Diagnostico: %s',
          v_other_org_reject_count,
          array_to_string(v_other_org_diag, ' | ')
        )
      );
    end if;

    if v_other_store_reject_count = 3 and not exists (
      select 1
      from pg_temp._p9_13_unexpected_acceptances unexpected_row
      where unexpected_row.scenario_number = 8
    ) then
      perform pg_temp._p9_13_record(
        8,
        'oportunidade de outra loja e rejeitada',
        'PASS',
        'as 3 tabelas rejeitaram insert cross-store com sqlstate 23503 e a FK exata'
      );
    else
      perform pg_temp._p9_13_record(
        8,
        'oportunidade de outra loja e rejeitada',
        'SUT_FAIL',
        format(
          'cenario exigia 3 rejeicoes exatas, mas obteve %s. Diagnostico: %s',
          v_other_store_reject_count,
          array_to_string(v_other_store_diag, ' | ')
        )
      );
    end if;

    if v_delete_restrict_reject_count = 3 and not exists (
      select 1
      from pg_temp._p9_13_unexpected_acceptances unexpected_row
      where unexpected_row.scenario_number = 9
    ) then
      perform pg_temp._p9_13_record(
        9,
        'tentativa de excluir oportunidade referenciada e rejeitada',
        'PASS',
        'as 3 tabelas rejeitaram delete da oportunidade referenciada com sqlstate 23503 e a FK exata'
      );
    else
      perform pg_temp._p9_13_record(
        9,
        'tentativa de excluir oportunidade referenciada e rejeitada',
        'SUT_FAIL',
        format(
          'cenario exigia 3 rejeicoes exatas, mas obteve %s. Diagnostico: %s',
          v_delete_restrict_reject_count,
          array_to_string(v_delete_diag, ' | ')
        )
      );
    end if;
  end if;

  begin
    delete from public.store_assistant_operational_tasks
    where id in (
      select row_id
      from pg_temp._p9_13_fixture_ids
      where table_name = 'store_assistant_operational_tasks'
    );
    get diagnostics v_cleanup_deleted = row_count;
    v_cleanup_diag := array_append(v_cleanup_diag, format('store_assistant_operational_tasks cleanup removeu %s linha(s)', v_cleanup_deleted));

    delete from public.store_appointments
    where id in (
      select row_id
      from pg_temp._p9_13_fixture_ids
      where table_name = 'store_appointments'
    );
    get diagnostics v_cleanup_deleted = row_count;
    v_cleanup_diag := array_append(v_cleanup_diag, format('store_appointments cleanup removeu %s linha(s)', v_cleanup_deleted));

    delete from public.sales_quotes
    where id in (
      select row_id
      from pg_temp._p9_13_fixture_ids
      where table_name = 'sales_quotes'
    );
    get diagnostics v_cleanup_deleted = row_count;
    v_cleanup_diag := array_append(v_cleanup_diag, format('sales_quotes cleanup removeu %s linha(s)', v_cleanup_deleted));

    delete from public.commercial_opportunities
    where id in (
      select row_id
      from pg_temp._p9_13_fixture_ids
      where table_name = 'commercial_opportunities'
    );
    get diagnostics v_cleanup_deleted = row_count;
    v_cleanup_diag := array_append(v_cleanup_diag, format('commercial_opportunities cleanup removeu %s linha(s)', v_cleanup_deleted));

    delete from public.customers
    where id in (
      select row_id
      from pg_temp._p9_13_fixture_ids
      where table_name = 'customers'
    );
    get diagnostics v_cleanup_deleted = row_count;
    v_cleanup_diag := array_append(v_cleanup_diag, format('customers cleanup removeu %s linha(s)', v_cleanup_deleted));

    delete from public.stores
    where id in (
      select row_id
      from pg_temp._p9_13_fixture_ids
      where table_name = 'stores'
    );
    get diagnostics v_cleanup_deleted = row_count;
    v_cleanup_diag := array_append(v_cleanup_diag, format('stores cleanup removeu %s linha(s)', v_cleanup_deleted));

    delete from public.organizations
    where id in (
      select row_id
      from pg_temp._p9_13_fixture_ids
      where table_name = 'organizations'
    );
    get diagnostics v_cleanup_deleted = row_count;
    v_cleanup_diag := array_append(v_cleanup_diag, format('organizations cleanup removeu %s linha(s)', v_cleanup_deleted));
  exception
    when others then
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;
      v_cleanup_diag := array_append(
        v_cleanup_diag,
        format(
          'cleanup falhou com sqlstate=%s constraint=%s message=%s',
          v_sqlstate,
          case when v_constraint is null then '<null>' else v_constraint end,
          v_message
        )
      );
  end;

  if not exists (
    select 1
    from pg_temp._p9_13_results
    where scenario_number = 10
  ) then
    begin
      select jsonb_agg(snapshot_row order by snapshot_row.table_name)
      into v_history_after
      from (
        select
          'commercial_opportunities'::text as table_name,
          count(*) as row_count,
          sum(pg_catalog.hashtextextended(id::text || ':' || xmin::text, 0)::numeric) as row_signature
        from public.commercial_opportunities
        union all
        select
          'sales_quotes'::text as table_name,
          count(*) as row_count,
          sum(pg_catalog.hashtextextended(id::text || ':' || xmin::text, 0)::numeric) as row_signature
        from public.sales_quotes
        union all
        select
          'store_appointments'::text as table_name,
          count(*) as row_count,
          sum(pg_catalog.hashtextextended(id::text || ':' || xmin::text, 0)::numeric) as row_signature
        from public.store_appointments
        union all
        select
          'store_assistant_operational_tasks'::text as table_name,
          count(*) as row_count,
          sum(pg_catalog.hashtextextended(id::text || ':' || xmin::text, 0)::numeric) as row_signature
        from public.store_assistant_operational_tasks
        union all
        select
          'sales_contracts'::text as table_name,
          count(*) as row_count,
          sum(pg_catalog.hashtextextended(id::text || ':' || xmin::text, 0)::numeric) as row_signature
        from public.sales_contracts
      ) snapshot_row;

      if v_history_before is not distinct from v_history_after then
        perform pg_temp._p9_13_record(
          10,
          'os registros preexistentes nao sao alterados pelo runner',
          'PASS',
          'os snapshots deterministicas de contagem e assinatura por id/xmin permaneceram identicos apos excluir as fixtures'
        );
      else
        perform pg_temp._p9_13_record(
          10,
          'os registros preexistentes nao sao alterados pelo runner',
          'SUT_FAIL',
          'o snapshot deterministico dos registros preexistentes divergiu apos o runner'
        );
      end if;
    exception
      when others then
        get stacked diagnostics
          v_sqlstate = returned_sqlstate,
          v_message = message_text,
          v_constraint = constraint_name;
        perform pg_temp._p9_13_record(
          10,
          'os registros preexistentes nao sao alterados pelo runner',
          'HARNESS_ERROR',
          format(
            'falha ao comparar snapshots historicos: sqlstate=%s constraint=%s message=%s',
            v_sqlstate,
            case when v_constraint is null then '<null>' else v_constraint end,
            v_message
          )
        );
    end;
  end if;

  if not exists (
    select 1
    from pg_temp._p9_13_results
    where scenario_number = 11
  ) then
    begin
      select jsonb_build_object(
        'columns',
        (
          select jsonb_agg(
                   jsonb_build_object(
                     'column_name', column_row.column_name,
                     'data_type', column_row.data_type,
                     'is_nullable', column_row.is_nullable,
                     'ordinal_position', column_row.ordinal_position
                   )
                   order by column_row.ordinal_position
                 )
          from information_schema.columns column_row
          where column_row.table_schema = 'public'
            and column_row.table_name = 'sales_contracts'
        ),
        'constraints',
        (
          select jsonb_agg(
                   jsonb_build_object(
                     'name', constraint_row.conname,
                     'type', constraint_row.contype
                   )
                   order by constraint_row.conname
                 )
          from pg_catalog.pg_constraint constraint_row
          where constraint_row.conrelid = 'public.sales_contracts'::pg_catalog.regclass
        ),
        'indexes',
        (
          select jsonb_agg(
                   jsonb_build_object(
                     'name', class_row.relname,
                     'is_unique', index_row.indisunique
                   )
                   order by class_row.relname
                 )
          from pg_catalog.pg_index index_row
          join pg_catalog.pg_class class_row
            on class_row.oid = index_row.indexrelid
          where index_row.indrelid = 'public.sales_contracts'::pg_catalog.regclass
        )
      )
      into v_sales_contracts_after;

      if exists (
        select 1
        from information_schema.columns column_row
        where column_row.table_schema = 'public'
          and column_row.table_name = 'sales_contracts'
          and column_row.column_name = 'commercial_opportunity_id'
      ) then
        perform pg_temp._p9_13_record(
          11,
          'public.sales_contracts permanece sem commercial_opportunity_id e o runner nao altera sua estrutura',
          'SUT_FAIL',
          'sales_contracts expoe commercial_opportunity_id, o que viola o contrato desta etapa'
        );
      elsif v_sales_contracts_before is not distinct from v_sales_contracts_after then
        perform pg_temp._p9_13_record(
          11,
          'public.sales_contracts permanece sem commercial_opportunity_id e o runner nao altera sua estrutura',
          'PASS',
          'sales_contracts manteve o mesmo snapshot estrutural de colunas, constraints e indexes'
        );
      else
        perform pg_temp._p9_13_record(
          11,
          'public.sales_contracts permanece sem commercial_opportunity_id e o runner nao altera sua estrutura',
          'SUT_FAIL',
          'sales_contracts mudou estruturalmente durante o runner'
        );
      end if;
    exception
      when others then
        get stacked diagnostics
          v_sqlstate = returned_sqlstate,
          v_message = message_text,
          v_constraint = constraint_name;
        perform pg_temp._p9_13_record(
          11,
          'public.sales_contracts permanece sem commercial_opportunity_id e o runner nao altera sua estrutura',
          'HARNESS_ERROR',
          format(
            'falha ao comparar snapshot estrutural de sales_contracts: sqlstate=%s constraint=%s message=%s',
            v_sqlstate,
            case when v_constraint is null then '<null>' else v_constraint end,
            v_message
          )
        );
    end;
  end if;

  if not exists (
    select 1
    from pg_temp._p9_13_results
    where scenario_number = 12
  ) then
    begin
      select jsonb_agg(snapshot_row order by snapshot_row.table_name)
      into v_catalog_after
      from (
        select
          class_row.relname as table_name,
          class_row.relrowsecurity as rls_enabled,
          (
            select jsonb_agg(
                     jsonb_build_object(
                       'name', trigger_row.tgname,
                       'enabled', trigger_row.tgenabled
                     )
                     order by trigger_row.tgname
                   )
            from pg_catalog.pg_trigger trigger_row
            where trigger_row.tgrelid = class_row.oid
              and not trigger_row.tgisinternal
          ) as triggers_snapshot,
          (
            select jsonb_agg(
                     jsonb_build_object(
                       'name', policy_row.policyname,
                       'cmd', policy_row.cmd
                     )
                     order by policy_row.policyname
                   )
            from pg_catalog.pg_policies policy_row
            where policy_row.schemaname = 'public'
              and policy_row.tablename = class_row.relname
          ) as policies_snapshot,
          (
            select jsonb_agg(
                     jsonb_build_object(
                       'grantee', grant_row.grantee,
                       'privilege_type', grant_row.privilege_type
                     )
                     order by grant_row.grantee, grant_row.privilege_type
                   )
            from information_schema.role_table_grants grant_row
            where grant_row.table_schema = 'public'
              and grant_row.table_name = class_row.relname
          ) as grants_snapshot
        from pg_catalog.pg_class class_row
        join pg_catalog.pg_namespace namespace_row
          on namespace_row.oid = class_row.relnamespace
        where namespace_row.nspname = 'public'
          and class_row.relname in (
            'commercial_opportunities',
            'sales_quotes',
            'store_appointments',
            'store_assistant_operational_tasks',
            'sales_contracts'
          )
      ) snapshot_row;

      if v_catalog_before is not distinct from v_catalog_after then
        perform pg_temp._p9_13_record(
          12,
          'o runner nao altera triggers, RLS, policies ou grants das tabelas auditadas',
          'PASS',
          'o snapshot catalogado de triggers, RLS, policies e grants permaneceu identico'
        );
      else
        perform pg_temp._p9_13_record(
          12,
          'o runner nao altera triggers, RLS, policies ou grants das tabelas auditadas',
          'SUT_FAIL',
          'o snapshot catalogado de triggers, RLS, policies ou grants divergiu'
        );
      end if;
    exception
      when others then
        get stacked diagnostics
          v_sqlstate = returned_sqlstate,
          v_message = message_text,
          v_constraint = constraint_name;
        perform pg_temp._p9_13_record(
          12,
          'o runner nao altera triggers, RLS, policies ou grants das tabelas auditadas',
          'HARNESS_ERROR',
          format(
            'falha ao comparar snapshot catalogado: sqlstate=%s constraint=%s message=%s',
            v_sqlstate,
            case when v_constraint is null then '<null>' else v_constraint end,
            v_message
          )
        );
    end;
  end if;

  begin
    select count(*)
    into v_total
    from (
      select expected.object_name
      from (
        values
          ('commercial_opportunities_id_organization_store_uidx'::text),
          ('sales_quotes_organization_store_commercial_opportunity_idx'),
          ('store_appointments_org_store_commercial_opportunity_idx'),
          ('store_assistant_operational_tasks_org_store_opportunity_idx'),
          ('sales_quotes_commercial_opportunity_scope_fkey'),
          ('store_appointments_commercial_opportunity_scope_fkey'),
          ('store_assistant_operational_tasks_commercial_scope_fkey')
      ) as expected(object_name)
      left join (
        select class_row.relname as object_name
        from pg_catalog.pg_class class_row
        join pg_catalog.pg_namespace namespace_row
          on namespace_row.oid = class_row.relnamespace
        where namespace_row.nspname = 'public'
          and class_row.relname in (
            'commercial_opportunities_id_organization_store_uidx',
            'sales_quotes_organization_store_commercial_opportunity_idx',
            'store_appointments_org_store_commercial_opportunity_idx',
            'store_assistant_operational_tasks_org_store_opportunity_idx'
          )
        union all
        select constraint_row.conname as object_name
        from pg_catalog.pg_constraint constraint_row
        where constraint_row.conrelid in (
          'public.sales_quotes'::pg_catalog.regclass,
          'public.store_appointments'::pg_catalog.regclass,
          'public.store_assistant_operational_tasks'::pg_catalog.regclass
        )
          and constraint_row.conname in (
            'sales_quotes_commercial_opportunity_scope_fkey',
            'store_appointments_commercial_opportunity_scope_fkey',
            'store_assistant_operational_tasks_commercial_scope_fkey'
          )
      ) actual
        on actual.object_name = expected.object_name
      group by expected.object_name
      having count(actual.object_name) <> 1
    ) mismatch_rows;

    if v_total = 0 then
      perform pg_temp._p9_13_record(
        13,
        'cada indice e constraint contratual existe exatamente uma vez no catalogo',
        'PASS',
        'cada indice e constraint nomeados aparece exatamente uma vez no catalogo'
      );
    else
      perform pg_temp._p9_13_record(
        13,
        'cada indice e constraint contratual existe exatamente uma vez no catalogo',
        'SUT_FAIL',
        format('%s objeto(s) nomeados apareceram com cardinalidade diferente de 1', v_total)
      );
    end if;
  exception
    when others then
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;
      perform pg_temp._p9_13_record(
        13,
        'cada indice e constraint contratual existe exatamente uma vez no catalogo',
        'HARNESS_ERROR',
        format(
          'falha ao contar objetos nomeados: sqlstate=%s constraint=%s message=%s',
          v_sqlstate,
          case when v_constraint is null then '<null>' else v_constraint end,
          v_message
        )
      );
    end;

  begin
    if exists (
      select 1
      from pg_temp._p9_13_fixture_ids fixture_row
      where (
        fixture_row.table_name = 'store_assistant_operational_tasks'
        and exists (
          select 1
          from public.store_assistant_operational_tasks current_row
          where current_row.id = fixture_row.row_id
        )
      ) or (
        fixture_row.table_name = 'store_appointments'
        and exists (
          select 1
          from public.store_appointments current_row
          where current_row.id = fixture_row.row_id
        )
      ) or (
        fixture_row.table_name = 'sales_quotes'
        and exists (
          select 1
          from public.sales_quotes current_row
          where current_row.id = fixture_row.row_id
        )
      ) or (
        fixture_row.table_name = 'commercial_opportunities'
        and exists (
          select 1
          from public.commercial_opportunities current_row
          where current_row.id = fixture_row.row_id
        )
      ) or (
        fixture_row.table_name = 'customers'
        and exists (
          select 1
          from public.customers current_row
          where current_row.id = fixture_row.row_id
        )
      ) or (
        fixture_row.table_name = 'stores'
        and exists (
          select 1
          from public.stores current_row
          where current_row.id = fixture_row.row_id
        )
      ) or (
        fixture_row.table_name = 'organizations'
        and exists (
          select 1
          from public.organizations current_row
          where current_row.id = fixture_row.row_id
        )
      )
    ) then
      perform pg_temp._p9_13_record(
        14,
        'todas as fixtures sao revertidas',
        'SUT_FAIL',
        format(
          'restaram fixtures rastreadas apos o cleanup. Diagnostico: %s',
          array_to_string(v_cleanup_diag, ' | ')
        )
      );
    elsif exists (
      select 1
      from pg_temp._p9_13_unexpected_acceptances
    ) then
      perform pg_temp._p9_13_record(
        14,
        'todas as fixtures sao revertidas',
        'SUT_FAIL',
        'uma ou mais operacoes negativas foram aceitas inesperadamente; isso reprova o cleanup mesmo com rollback final'
      );
    else
      perform pg_temp._p9_13_record(
        14,
        'todas as fixtures sao revertidas',
        'PASS',
        format(
          'nenhuma fixture residual permaneceu e nenhuma operacao negativa foi aceita. Diagnostico: %s',
          array_to_string(v_cleanup_diag, ' | ')
        )
      );
    end if;
  exception
    when others then
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;
      perform pg_temp._p9_13_record(
        14,
        'todas as fixtures sao revertidas',
        'HARNESS_ERROR',
        format(
          'falha ao verificar residual de fixtures: sqlstate=%s constraint=%s message=%s',
          v_sqlstate,
          case when v_constraint is null then '<null>' else v_constraint end,
          v_message
        )
      );
    end;
end;
$checks$;

select
  scenario_number,
  scenario_name,
  status,
  detail
from pg_temp._p9_13_results
order by scenario_number;

select
  count(*) as total_scenarios,
  count(*) filter (where status = 'PASS') as total_pass,
  count(*) filter (where status <> 'PASS') as total_fail,
  0::bigint as total_blocked,
  count(*) filter (where status = 'HARNESS_ERROR') as total_harness_error,
  case
    when count(*) <> 14 then 'AINDA_NAO_APROVADA'
    when count(*) filter (where status <> 'PASS') > 0 then 'AINDA_NAO_APROVADA'
    when count(*) filter (where status = 'HARNESS_ERROR') > 0 then 'AINDA_NAO_APROVADA'
    else 'APROVADA'
  end as final_status
from pg_temp._p9_13_results;

rollback;
