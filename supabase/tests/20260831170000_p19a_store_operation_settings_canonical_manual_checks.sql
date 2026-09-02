-- P19-A / Bloco 3 / Etapa 3.3
-- Runner manual read-only: store_operation_settings + technical_visit_days.
-- Em sucesso: "Success. No rows returned".
-- Em falha: levanta P19A_OPERATION_CHECKS_FAILED com a lista de checks.

do $runner$
declare
  v_failures text[] := '{}'::text[];
  v_ok boolean;
  v_count integer;
  v_columns text[];
begin
  -- 1. Coluna de visita técnica existe com contrato esperado.
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_schedule_settings'
      and column_name = 'technical_visit_days'
      and data_type = 'jsonb'
      and is_nullable = 'YES'
  )
  into v_ok;

  if not coalesce(v_ok, false) then
    v_failures := array_append(v_failures, '01 technical_visit_days column contract');
  end if;

  -- 2. CHECK da agenda existe.
  select exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.store_schedule_settings'::regclass
      and constraint_row.conname = 'store_schedule_settings_technical_visit_days_valid'
      and constraint_row.contype = 'c'
  )
  into v_ok;

  if not coalesce(v_ok, false) then
    v_failures := array_append(v_failures, '02 technical_visit_days check constraint');
  end if;

  -- 3. Nova tabela tem exatamente o shape congelado.
  select array_agg(column_name::text order by ordinal_position)
  into v_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'store_operation_settings';

  if v_columns is distinct from array[
    'organization_id',
    'store_id',
    'offers_installation',
    'average_installation_time_days',
    'installation_days_rule',
    'installation_process_notes',
    'offers_technical_visit',
    'technical_visit_days_rule',
    'technical_visit_rules',
    'technical_visit_rules_other',
    'created_at',
    'updated_at'
  ]::text[] then
    v_failures := array_append(v_failures, '03 store_operation_settings exact columns');
  end if;

  -- 4. PK composta.
  select exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.store_operation_settings'::regclass
      and constraint_row.conname = 'store_operation_settings_pkey'
      and constraint_row.contype = 'p'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid)
        = 'PRIMARY KEY (organization_id, store_id)'
  )
  into v_ok;

  if not coalesce(v_ok, false) then
    v_failures := array_append(v_failures, '04 operation composite primary key');
  end if;

  -- 5. FK tenant-safe para stores(id, organization_id).
  select exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.store_operation_settings'::regclass
      and constraint_row.conname = 'store_operation_settings_store_scope_fkey'
      and constraint_row.contype = 'f'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid)
        ilike '%FOREIGN KEY (store_id, organization_id) REFERENCES stores(id, organization_id)%'
  )
  into v_ok;

  if not coalesce(v_ok, false) then
    v_failures := array_append(v_failures, '05 operation tenant-safe foreign key');
  end if;

  -- 6. RLS ativo.
  select coalesce(class_row.relrowsecurity, false)
  into v_ok
  from pg_catalog.pg_class class_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = class_row.relnamespace
  where namespace_row.nspname = 'public'
    and class_row.relname = 'store_operation_settings';

  if not coalesce(v_ok, false) then
    v_failures := array_append(v_failures, '06 operation RLS enabled');
  end if;

  -- 7. Só existe policy SELECT autenticada para a nova tabela.
  select count(*)
  into v_count
  from pg_catalog.pg_policies policy_row
  where policy_row.schemaname = 'public'
    and policy_row.tablename = 'store_operation_settings'
    and policy_row.policyname = 'store_operation_settings_select_by_active_membership'
    and policy_row.cmd = 'SELECT'
    and 'authenticated' = any(policy_row.roles);

  if v_count <> 1 then
    v_failures := array_append(v_failures, '07 operation authenticated select policy');
  end if;

  -- 8. authenticated é read-only na tabela.
  v_ok :=
    has_table_privilege('authenticated', 'public.store_operation_settings', 'SELECT')
    and not has_table_privilege('authenticated', 'public.store_operation_settings', 'INSERT')
    and not has_table_privilege('authenticated', 'public.store_operation_settings', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.store_operation_settings', 'DELETE')
    and not has_table_privilege('authenticated', 'public.store_operation_settings', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.store_operation_settings', 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.store_operation_settings', 'TRIGGER');

  if not coalesce(v_ok, false) then
    v_failures := array_append(v_failures, '08 authenticated operation table read-only');
  end if;

  -- 9. service_role é read-only na tabela.
  v_ok :=
    has_table_privilege('service_role', 'public.store_operation_settings', 'SELECT')
    and not has_table_privilege('service_role', 'public.store_operation_settings', 'INSERT')
    and not has_table_privilege('service_role', 'public.store_operation_settings', 'UPDATE')
    and not has_table_privilege('service_role', 'public.store_operation_settings', 'DELETE')
    and not has_table_privilege('service_role', 'public.store_operation_settings', 'TRUNCATE')
    and not has_table_privilege('service_role', 'public.store_operation_settings', 'REFERENCES')
    and not has_table_privilege('service_role', 'public.store_operation_settings', 'TRIGGER');

  if not coalesce(v_ok, false) then
    v_failures := array_append(v_failures, '09 service_role operation table read-only');
  end if;

  -- 10. Writer base da Operação existe e está endurecido.
  select
    p.prosecdef
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    and coalesce(p.proconfig @> array['row_security=off']::text[], false)
    and coalesce(p.proconfig @> array['search_path=pg_catalog, public, pg_temp']::text[], false)
  into v_ok
  from pg_catalog.pg_proc p
  where p.oid = to_regprocedure(
    'public.upsert_store_operation_settings_scoped(uuid,uuid,boolean,integer,text,text,boolean,text,text[],text)'
  );

  if not coalesce(v_ok, false) then
    v_failures := array_append(v_failures, '10 operation base writer hardened');
  end if;

  -- 11. Writer base não é executável por papéis externos.
  v_ok :=
    not has_function_privilege(
      'authenticated',
      'public.upsert_store_operation_settings_scoped(uuid,uuid,boolean,integer,text,text,boolean,text,text[],text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'public.upsert_store_operation_settings_scoped(uuid,uuid,boolean,integer,text,text,boolean,text,text[],text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.upsert_store_operation_settings_scoped(uuid,uuid,boolean,integer,text,text,boolean,text,text[],text)',
      'EXECUTE'
    );

  if not coalesce(v_ok, false) then
    v_failures := array_append(v_failures, '11 operation base writer blocked');
  end if;

  -- 12. Wrapper da Operação existe e está endurecido.
  select
    p.prosecdef
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    and coalesce(p.proconfig @> array['row_security=off']::text[], false)
    and coalesce(p.proconfig @> array['search_path=pg_catalog, public, pg_temp']::text[], false)
  into v_ok
  from pg_catalog.pg_proc p
  where p.oid = to_regprocedure(
    'public.upsert_store_operation_settings_with_legacy_mirror_scoped(uuid,uuid,boolean,integer,text,text,boolean,text,text[],text)'
  );

  if not coalesce(v_ok, false) then
    v_failures := array_append(v_failures, '12 operation mirror writer hardened');
  end if;

  -- 13. Somente authenticated executa o wrapper da Operação.
  v_ok :=
    has_function_privilege(
      'authenticated',
      'public.upsert_store_operation_settings_with_legacy_mirror_scoped(uuid,uuid,boolean,integer,text,text,boolean,text,text[],text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'public.upsert_store_operation_settings_with_legacy_mirror_scoped(uuid,uuid,boolean,integer,text,text,boolean,text,text[],text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.upsert_store_operation_settings_with_legacy_mirror_scoped(uuid,uuid,boolean,integer,text,text,boolean,text,text[],text)',
      'EXECUTE'
    );

  if not coalesce(v_ok, false) then
    v_failures := array_append(v_failures, '13 operation mirror authenticated-only');
  end if;

  -- 14. Writer base de technical_visit_days existe e está endurecido.
  select
    p.prosecdef
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    and coalesce(p.proconfig @> array['row_security=off']::text[], false)
    and coalesce(p.proconfig @> array['search_path=pg_catalog, public, pg_temp']::text[], false)
  into v_ok
  from pg_catalog.pg_proc p
  where p.oid = to_regprocedure(
    'public.upsert_store_schedule_technical_visit_days_scoped(uuid,uuid,text[])'
  );

  if not coalesce(v_ok, false) then
    v_failures := array_append(v_failures, '14 visit-days base writer hardened');
  end if;

  -- 15. Writer base de technical_visit_days está bloqueado externamente.
  v_ok :=
    not has_function_privilege(
      'authenticated',
      'public.upsert_store_schedule_technical_visit_days_scoped(uuid,uuid,text[])',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'public.upsert_store_schedule_technical_visit_days_scoped(uuid,uuid,text[])',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.upsert_store_schedule_technical_visit_days_scoped(uuid,uuid,text[])',
      'EXECUTE'
    );

  if not coalesce(v_ok, false) then
    v_failures := array_append(v_failures, '15 visit-days base writer blocked');
  end if;

  -- 16. Wrapper de technical_visit_days está endurecido.
  select
    p.prosecdef
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    and coalesce(p.proconfig @> array['row_security=off']::text[], false)
    and coalesce(p.proconfig @> array['search_path=pg_catalog, public, pg_temp']::text[], false)
  into v_ok
  from pg_catalog.pg_proc p
  where p.oid = to_regprocedure(
    'public.upsert_store_schedule_technical_visit_days_with_legacy_mirror_scoped(uuid,uuid,text[])'
  );

  if not coalesce(v_ok, false) then
    v_failures := array_append(v_failures, '16 visit-days mirror writer hardened');
  end if;

  -- 17. Somente authenticated executa o wrapper de technical_visit_days.
  v_ok :=
    has_function_privilege(
      'authenticated',
      'public.upsert_store_schedule_technical_visit_days_with_legacy_mirror_scoped(uuid,uuid,text[])',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'public.upsert_store_schedule_technical_visit_days_with_legacy_mirror_scoped(uuid,uuid,text[])',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.upsert_store_schedule_technical_visit_days_with_legacy_mirror_scoped(uuid,uuid,text[])',
      'EXECUTE'
    );

  if not coalesce(v_ok, false) then
    v_failures := array_append(v_failures, '17 visit-days mirror authenticated-only');
  end if;

  -- 18. Helper da CHECK da agenda continua executável pelo RPC legado invoker.
  v_ok :=
    has_function_privilege(
      'authenticated',
      'public.store_schedule_technical_visit_days_are_valid(jsonb)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.store_schedule_technical_visit_days_are_valid(jsonb)',
      'EXECUTE'
    );

  if not coalesce(v_ok, false) then
    v_failures := array_append(v_failures, '18 schedule check helper compatible with legacy invoker');
  end if;

  -- 19. RPC legado de agenda mantém a assinatura antiga de 13 argumentos.
  select to_regprocedure(
    'public.upsert_store_schedule_settings(uuid,uuid,boolean,boolean,integer,boolean,jsonb,jsonb,jsonb,text,text,boolean,text)'
  ) is not null
  into v_ok;

  if not coalesce(v_ok, false) then
    v_failures := array_append(v_failures, '19 legacy schedule writer signature preserved');
  end if;

  -- 20. Reader legado continua existindo com a assinatura original.
  select to_regprocedure(
    'public.get_store_schedule_settings_effective(uuid,uuid)'
  ) is not null
  into v_ok;

  if not coalesce(v_ok, false) then
    v_failures := array_append(v_failures, '20 legacy schedule reader preserved');
  end if;

  -- 21. Nenhum valor inválido chegou a technical_visit_days.
  select count(*)
  into v_count
  from public.store_schedule_settings schedule_row
  where not public.store_schedule_technical_visit_days_are_valid(
    schedule_row.technical_visit_days
  );

  if v_count <> 0 then
    v_failures := array_append(v_failures, '21 technical_visit_days canonical values valid');
  end if;

  -- 22. technical_visit_rules não contém regras pertencentes a Agenda/Estratégia.
  select count(*)
  into v_count
  from public.store_operation_settings operation_row
  cross join lateral unnest(operation_row.technical_visit_rules)
    as rule_row(rule_value)
  where rule_row.rule_value not in (
    'precisa_agendar',
    'confirmar_endereco',
    'analise_do_local',
    'pode_ter_taxa'
  );

  if v_count <> 0 then
    v_failures := array_append(v_failures, '22 operation visit rules own vocabulary only');
  end if;

  -- 23. Backfill não produziu prazo de instalação inválido.
  select count(*)
  into v_count
  from public.store_operation_settings operation_row
  where operation_row.average_installation_time_days is not null
    and operation_row.average_installation_time_days <= 0;

  if v_count <> 0 then
    v_failures := array_append(v_failures, '23 positive installation days after backfill');
  end if;

  -- 24. Para agendas existentes com legado reconhecível, o backfill de
  -- technical_visit_days deve corresponder ao conjunto canônico esperado.
  with latest_legacy as (
    select distinct on (
      answer_row.organization_id,
      answer_row.store_id,
      answer_row.question_key
    )
      answer_row.organization_id,
      answer_row.store_id,
      answer_row.answer
    from public.store_onboarding_answers answer_row
    where answer_row.question_key = 'technical_visit_available_days'
    order by
      answer_row.organization_id,
      answer_row.store_id,
      answer_row.question_key,
      answer_row.updated_at desc,
      answer_row.id desc
  ),
  mapped as (
    select distinct
      legacy_row.organization_id,
      legacy_row.store_id,
      public.store_schedule_normalize_day(day_row.day_value) as canonical_day
    from latest_legacy legacy_row
    cross join lateral pg_catalog.jsonb_array_elements_text(
      case
        when pg_catalog.jsonb_typeof(legacy_row.answer) = 'array'
          then legacy_row.answer
        else '[]'::jsonb
      end
    ) day_row(day_value)
    where public.store_schedule_normalize_day(day_row.day_value) is not null
  ),
  expected as (
    select
      mapped_row.organization_id,
      mapped_row.store_id,
      pg_catalog.jsonb_agg(
        mapped_row.canonical_day
        order by case mapped_row.canonical_day
          when 'segunda' then 1
          when 'terca' then 2
          when 'quarta' then 3
          when 'quinta' then 4
          when 'sexta' then 5
          when 'sabado' then 6
          when 'domingo' then 7
          else 99
        end
      ) as expected_days
    from mapped mapped_row
    group by mapped_row.organization_id, mapped_row.store_id
  )
  select count(*)
  into v_count
  from expected expected_row
  join public.store_schedule_settings schedule_row
    on schedule_row.organization_id = expected_row.organization_id
   and schedule_row.store_id = expected_row.store_id
  where schedule_row.technical_visit_days is distinct from expected_row.expected_days;

  if v_count <> 0 then
    v_failures := array_append(v_failures, '24 visit-days conservative backfill reconciliation');
  end if;

  -- 25. Backfill booleano da Operação reconcilia boolean/string inequívocos.
  with latest_legacy as (
    select distinct on (
      answer_row.organization_id,
      answer_row.store_id,
      answer_row.question_key
    )
      answer_row.organization_id,
      answer_row.store_id,
      answer_row.question_key,
      answer_row.answer
    from public.store_onboarding_answers answer_row
    where answer_row.question_key in (
      'offers_installation',
      'offers_technical_visit'
    )
    order by
      answer_row.organization_id,
      answer_row.store_id,
      answer_row.question_key,
      answer_row.updated_at desc,
      answer_row.id desc
  ),
  expected as (
    select
      legacy_row.organization_id,
      legacy_row.store_id,
      legacy_row.question_key,
      case
        when pg_catalog.jsonb_typeof(legacy_row.answer) = 'boolean'
          then (legacy_row.answer #>> '{}')::boolean
        when pg_catalog.jsonb_typeof(legacy_row.answer) = 'string'
          then case pg_catalog.lower(pg_catalog.btrim(legacy_row.answer #>> '{}'))
            when 'sim' then true
            when 'true' then true
            when 'yes' then true
            when '1' then true
            when 'não' then false
            when 'nao' then false
            when 'false' then false
            when 'no' then false
            when '0' then false
            else null
          end
        else null
      end as expected_value
    from latest_legacy legacy_row
  )
  select count(*)
  into v_count
  from expected expected_row
  join public.store_operation_settings operation_row
    on operation_row.organization_id = expected_row.organization_id
   and operation_row.store_id = expected_row.store_id
  where expected_row.expected_value is not null
    and (
      case expected_row.question_key
        when 'offers_installation'
          then operation_row.offers_installation
        when 'offers_technical_visit'
          then operation_row.offers_technical_visit
      end
    ) is distinct from expected_row.expected_value;

  if v_count <> 0 then
    v_failures := array_append(v_failures, '25 operation boolean backfill reconciliation');
  end if;

  if cardinality(v_failures) > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_OPERATION_CHECKS_FAILED: ' || array_to_string(v_failures, '; ');
  end if;
end;
$runner$;
