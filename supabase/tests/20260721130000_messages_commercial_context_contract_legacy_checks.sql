-- ZION / Pilar 9 / Bloco 4 / Etapa 4.12
-- Contrato estrutural e legado do snapshot comercial em public.messages.
--
-- ESCOPO DESTA ETAPA:
-- - somente leitura;
-- - nenhuma fixture;
-- - nenhuma escrita;
-- - nenhuma alteracao de trigger;
-- - nenhuma tabela temporaria;
-- - nenhuma dependencia de quantidade fixa de mensagens;
-- - seguro para reexecucao.

with
expected_legacy_columns(column_name) as (
  values
    ('id'::text),
    ('organization_id'::text),
    ('conversation_id'::text),
    ('sender'::text),
    ('content'::text),
    ('created_at'::text),
    ('lead_id'::text),
    ('store_id'::text),
    ('metadata'::text),
    ('external_message_id'::text),
    ('media_url'::text),
    ('message_type'::text),
    ('direction'::text),
    ('read_at'::text),
    ('delivered_at'::text),
    ('edited_at'::text),
    ('deleted_at'::text)
),
expected_all_columns(column_name) as (
  select column_name
  from expected_legacy_columns

  union all values
    ('conversation_session_id'::text),
    ('commercial_session_context_link_id'::text),
    ('commercial_context_capture_state'::text)
),
actual_columns as (
  select
    column_row.column_name::text,
    column_row.data_type::text,
    column_row.udt_schema::text,
    column_row.udt_name::text,
    column_row.is_nullable::text,
    column_row.column_default::text,
    column_row.ordinal_position
  from information_schema.columns column_row
  where column_row.table_schema = 'public'
    and column_row.table_name = 'messages'
),
column_inventory as (
  select
    (select count(*) from actual_columns) as actual_count,
    (
      select count(*)
      from expected_legacy_columns expected
      join actual_columns actual
        on actual.column_name = expected.column_name
    ) as legacy_present,
    (
      select count(*)
      from expected_all_columns expected
      join actual_columns actual
        on actual.column_name = expected.column_name
    ) as expected_present,
    (
      select count(*)
      from actual_columns actual
      left join expected_all_columns expected
        on expected.column_name = actual.column_name
      where expected.column_name is null
    ) as unexpected_count
),
new_column_contract as (
  select
    count(*) filter (
      where column_name = 'conversation_session_id'
        and data_type = 'uuid'
        and udt_schema = 'pg_catalog'
        and udt_name = 'uuid'
        and is_nullable = 'YES'
        and column_default is null
    ) = 1
    and count(*) filter (
      where column_name = 'commercial_session_context_link_id'
        and data_type = 'uuid'
        and udt_schema = 'pg_catalog'
        and udt_name = 'uuid'
        and is_nullable = 'YES'
        and column_default is null
    ) = 1
    and count(*) filter (
      where column_name = 'commercial_context_capture_state'
        and data_type = 'text'
        and udt_schema = 'pg_catalog'
        and udt_name = 'text'
        and is_nullable = 'NO'
        and lower(coalesce(column_default, '')) = '''legacy_unknown''::text'
    ) = 1 as ok
  from actual_columns
),
state_constraint as (
  select
    constraint_row.oid,
    constraint_row.convalidated,
    pg_catalog.pg_get_constraintdef(constraint_row.oid, true) as definition,
    pg_catalog.regexp_replace(
      lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
      '[[:space:]()]',
      '',
      'g'
    ) as normalized_definition
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = pg_catalog.to_regclass('public.messages')
    and constraint_row.conname = 'messages_commercial_context_state_check'
    and constraint_row.contype = 'c'
),
state_constraint_contract as (
  select
    count(*) = 1
    and bool_and(convalidated)
    and bool_and(
      normalized_definition =
        'checkcommercial_context_capture_state=anyarray[''legacy_unknown''::text,''no_active_session''::text]'
        || 'andconversation_session_idisnull'
        || 'andcommercial_session_context_link_idisnull'
        || 'orcommercial_context_capture_state=''pending_context''::text'
        || 'andconversation_session_idisnotnull'
        || 'andcommercial_session_context_link_idisnull'
        || 'orcommercial_context_capture_state=''captured''::text'
        || 'andconversation_session_idisnotnull'
        || 'andcommercial_session_context_link_idisnotnull'
    ) as ok
  from state_constraint
),
foreign_key_contract as (
  select
    constraint_row.conname,
    constraint_row.convalidated,
    constraint_row.confdeltype,
    referenced_namespace.nspname::text as referenced_schema,
    referenced_relation.relname::text as referenced_table,
    (
      select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
      from pg_catalog.unnest(constraint_row.conkey)
           with ordinality as key_column(attnum, ordinality)
      join pg_catalog.pg_attribute attribute_row
        on attribute_row.attrelid = constraint_row.conrelid
       and attribute_row.attnum = key_column.attnum
    ) as source_columns,
    (
      select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
      from pg_catalog.unnest(constraint_row.confkey)
           with ordinality as key_column(attnum, ordinality)
      join pg_catalog.pg_attribute attribute_row
        on attribute_row.attrelid = constraint_row.confrelid
       and attribute_row.attnum = key_column.attnum
    ) as target_columns
  from pg_catalog.pg_constraint constraint_row
  join pg_catalog.pg_class referenced_relation
    on referenced_relation.oid = constraint_row.confrelid
  join pg_catalog.pg_namespace referenced_namespace
    on referenced_namespace.oid = referenced_relation.relnamespace
  where constraint_row.conrelid = pg_catalog.to_regclass('public.messages')
    and constraint_row.contype = 'f'
    and constraint_row.conname in (
      'messages_conversation_session_scope_fkey',
      'messages_context_link_scope_fkey'
    )
),
foreign_key_contract_result as (
  select
    count(*) = 2
    and count(*) filter (
      where conname = 'messages_conversation_session_scope_fkey'
        and convalidated
        and confdeltype = 'r'
        and referenced_schema = 'public'
        and referenced_table = 'conversation_sessions'
        and source_columns = array[
          'conversation_session_id',
          'organization_id',
          'store_id',
          'conversation_id'
        ]::text[]
        and target_columns = array[
          'id',
          'organization_id',
          'store_id',
          'conversation_id'
        ]::text[]
    ) = 1
    and count(*) filter (
      where conname = 'messages_context_link_scope_fkey'
        and convalidated
        and confdeltype = 'r'
        and referenced_schema = 'public'
        and referenced_table = 'commercial_session_context_links'
        and source_columns = array[
          'commercial_session_context_link_id',
          'organization_id',
          'store_id',
          'conversation_session_id'
        ]::text[]
        and target_columns = array[
          'id',
          'organization_id',
          'store_id',
          'conversation_session_id'
        ]::text[]
    ) = 1 as ok
  from foreign_key_contract
),
index_contract as (
  select
    index_namespace.nspname::text as index_schema,
    index_relation.relname::text as index_name,
    table_namespace.nspname::text as table_schema,
    table_relation.relname::text as table_name,
    access_method.amname::text as access_method,
    index_row.indisunique,
    index_row.indisvalid,
    index_row.indisready,
    index_row.indislive,
    index_row.indnkeyatts,
    index_row.indnatts,
    index_row.indexprs is null as has_no_expressions,
    index_row.indpred is null as has_no_predicate,
    case
      when index_row.indpred is null then null
      else pg_catalog.regexp_replace(
        lower(pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid)),
        '[[:space:]()]',
        '',
        'g'
      )
    end as normalized_predicate,
    (
      select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
      from pg_catalog.unnest(index_row.indkey::smallint[])
           with ordinality as key_column(attnum, ordinality)
      join pg_catalog.pg_attribute attribute_row
        on attribute_row.attrelid = index_row.indrelid
       and attribute_row.attnum = key_column.attnum
      where key_column.ordinality <= index_row.indnkeyatts
    ) as key_columns,
    (
      select pg_catalog.array_agg(option_value order by option_position)
      from pg_catalog.unnest(index_row.indoption::smallint[])
           with ordinality as option_row(option_value, option_position)
    ) as key_options
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_relation
    on index_relation.oid = index_row.indexrelid
  join pg_catalog.pg_namespace index_namespace
    on index_namespace.oid = index_relation.relnamespace
  join pg_catalog.pg_class table_relation
    on table_relation.oid = index_row.indrelid
  join pg_catalog.pg_namespace table_namespace
    on table_namespace.oid = table_relation.relnamespace
  join pg_catalog.pg_am access_method
    on access_method.oid = index_relation.relam
  where index_namespace.nspname = 'public'
    and index_relation.relname in (
      'conversation_sessions_id_org_store_conv_uidx',
      'messages_org_store_session_created_idx',
      'messages_org_store_ctx_link_created_idx'
    )
),
index_contract_result as (
  select
    count(*) = 3
    and count(*) filter (
      where index_name = 'conversation_sessions_id_org_store_conv_uidx'
        and table_schema = 'public'
        and table_name = 'conversation_sessions'
        and access_method = 'btree'
        and indisunique
        and indisvalid
        and indisready
        and indislive
        and indnkeyatts = 4
        and indnatts = 4
        and has_no_expressions
        and has_no_predicate
        and key_columns = array[
          'id',
          'organization_id',
          'store_id',
          'conversation_id'
        ]::text[]
        and key_options = array[0, 0, 0, 0]::smallint[]
    ) = 1
    and count(*) filter (
      where index_name = 'messages_org_store_session_created_idx'
        and table_schema = 'public'
        and table_name = 'messages'
        and access_method = 'btree'
        and not indisunique
        and indisvalid
        and indisready
        and indislive
        and indnkeyatts = 4
        and indnatts = 4
        and has_no_expressions
        and not has_no_predicate
        and normalized_predicate = 'conversation_session_idisnotnull'
        and key_columns = array[
          'organization_id',
          'store_id',
          'conversation_session_id',
          'created_at'
        ]::text[]
        and key_options = array[0, 0, 0, 3]::smallint[]
    ) = 1
    and count(*) filter (
      where index_name = 'messages_org_store_ctx_link_created_idx'
        and table_schema = 'public'
        and table_name = 'messages'
        and access_method = 'btree'
        and not indisunique
        and indisvalid
        and indisready
        and indislive
        and indnkeyatts = 4
        and indnatts = 4
        and has_no_expressions
        and not has_no_predicate
        and normalized_predicate = 'commercial_session_context_link_idisnotnull'
        and key_columns = array[
          'organization_id',
          'store_id',
          'commercial_session_context_link_id',
          'created_at'
        ]::text[]
        and key_options = array[0, 0, 0, 3]::smallint[]
    ) = 1 as ok
  from index_contract
),
fill_trigger_contract as (
  select
    count(*) = 1
    and bool_and(trigger_row.tgenabled = 'O')
    and bool_and(trigger_row.tgtype = 23)
    and bool_and(
      trigger_row.tgfoid =
      pg_catalog.to_regprocedure('public.fill_messages_lead_store_from_conversation()')
    ) as ok,
    string_agg(
      pg_catalog.pg_get_triggerdef(trigger_row.oid, true)
      || ' | enabled=' || trigger_row.tgenabled::text,
      E'\n'
      order by trigger_row.oid
    ) as detail
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgrelid = pg_catalog.to_regclass('public.messages')
    and not trigger_row.tgisinternal
    and trigger_row.tgname = 'trg_fill_messages_lead_store'
),
fill_function_contract as (
  select
    count(*) = 1
    and bool_and(procedure_row.pronargs = 0)
    and bool_and(procedure_row.prorettype = 'trigger'::pg_catalog.regtype)
    and bool_and(language_row.lanname = 'plpgsql')
    and bool_and(not procedure_row.prosecdef)
    and bool_and(
      exists (
        select 1
        from pg_catalog.unnest(coalesce(procedure_row.proconfig, '{}'::text[])) config_entry
        where config_entry = 'search_path=public, pg_temp'
      )
    )
    and bool_and(
      position(
        'no_active_session'
        in lower(pg_catalog.pg_get_functiondef(procedure_row.oid))
      ) > 0
    )
    and bool_and(
      position(
        'pending_context'
        in lower(pg_catalog.pg_get_functiondef(procedure_row.oid))
      ) > 0
    )
    and bool_and(
      position(
        'captured'
        in lower(pg_catalog.pg_get_functiondef(procedure_row.oid))
      ) > 0
    )
    and bool_and(
      position(
        'messages commercial context snapshot is immutable after insert'
        in lower(pg_catalog.pg_get_functiondef(procedure_row.oid))
      ) > 0
    ) as ok
  from pg_catalog.pg_proc procedure_row
  join pg_catalog.pg_language language_row
    on language_row.oid = procedure_row.prolang
  where procedure_row.oid =
    pg_catalog.to_regprocedure('public.fill_messages_lead_store_from_conversation()')
),
rpc_contract as (
  select
    pg_catalog.to_regprocedure(
      'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'
    ) is not null
    and (
      select procedure_row.prorettype = 'public.messages'::pg_catalog.regtype
      from pg_catalog.pg_proc procedure_row
      where procedure_row.oid = pg_catalog.to_regprocedure(
        'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'
      )
    )
    and pg_catalog.to_regprocedure(
      'public.panel_send_message(uuid,text,text,text)'
    ) is not null
    and (
      select procedure_row.prorettype = 'uuid'::pg_catalog.regtype
      from pg_catalog.pg_proc procedure_row
      where procedure_row.oid = pg_catalog.to_regprocedure(
        'public.panel_send_message(uuid,text,text,text)'
      )
    )
    and pg_catalog.to_regprocedure(
      'public.panel_send_message_scoped(uuid,uuid,text)'
    ) is not null
    and (
      select procedure_row.prorettype = 'uuid'::pg_catalog.regtype
      from pg_catalog.pg_proc procedure_row
      where procedure_row.oid = pg_catalog.to_regprocedure(
        'public.panel_send_message_scoped(uuid,uuid,text)'
      )
    )
    and pg_catalog.to_regprocedure(
      'public.mark_message_external_sent(uuid,text)'
    ) is not null
    and (
      select procedure_row.prorettype = 'void'::pg_catalog.regtype
      from pg_catalog.pg_proc procedure_row
      where procedure_row.oid = pg_catalog.to_regprocedure(
        'public.mark_message_external_sent(uuid,text)'
      )
    ) as ok
),
message_consistency as (
  select
    count(*) as total_messages,
    count(*) filter (
      where not coalesce(
        (
          (
            commercial_context_capture_state in ('legacy_unknown', 'no_active_session')
            and conversation_session_id is null
            and commercial_session_context_link_id is null
          )
          or (
            commercial_context_capture_state = 'pending_context'
            and conversation_session_id is not null
            and commercial_session_context_link_id is null
          )
          or (
            commercial_context_capture_state = 'captured'
            and conversation_session_id is not null
            and commercial_session_context_link_id is not null
          )
        ),
        false
      )
    ) as inconsistent_messages
  from public.messages
),
legacy_consistency as (
  select
    count(*) as legacy_messages,
    count(*) filter (
      where conversation_session_id is not null
         or commercial_session_context_link_id is not null
    ) as invalid_legacy_messages
  from public.messages
  where commercial_context_capture_state = 'legacy_unknown'
),
state_distribution as (
  select jsonb_build_object(
    'legacy_unknown',
      count(*) filter (where commercial_context_capture_state = 'legacy_unknown'),
    'no_active_session',
      count(*) filter (where commercial_context_capture_state = 'no_active_session'),
    'pending_context',
      count(*) filter (where commercial_context_capture_state = 'pending_context'),
    'captured',
      count(*) filter (where commercial_context_capture_state = 'captured'),
    'other_or_null',
      count(*) filter (
        where commercial_context_capture_state is null
           or commercial_context_capture_state not in (
             'legacy_unknown',
             'no_active_session',
             'pending_context',
             'captured'
           )
      )
  ) as distribution
  from public.messages
),
checks as (
  select
    1 as check_number,
    'tabela e inventario de colunas'::text as check_name,
    (
      pg_catalog.to_regclass('public.messages') is not null
      and inventory.actual_count = 20
      and inventory.legacy_present = 17
      and inventory.expected_present = 20
      and inventory.unexpected_count = 0
    ) as passed,
    format(
      'actual_columns=%s | legacy_columns_present=%s/17 | expected_columns_present=%s/20 | unexpected_columns=%s',
      inventory.actual_count,
      inventory.legacy_present,
      inventory.expected_present,
      inventory.unexpected_count
    ) as detail,
    'public.messages existe e possui exatamente as 17 colunas anteriores mais as 3 colunas do snapshot'::text
      as expected_contract
  from column_inventory inventory

  union all

  select
    2,
    'contrato das tres novas colunas',
    contract.ok,
    (
      select string_agg(
        format(
          '%s: type=%s | nullable=%s | default=%s',
          column_name,
          data_type,
          is_nullable,
          coalesce(column_default, '<null>')
        ),
        E'\n'
        order by ordinal_position
      )
      from actual_columns
      where column_name in (
        'conversation_session_id',
        'commercial_session_context_link_id',
        'commercial_context_capture_state'
      )
    ),
    'dois UUIDs nullable sem default e commercial_context_capture_state text NOT NULL default legacy_unknown'
  from new_column_contract contract

  union all

  select
    3,
    'check logico dos quatro estados',
    contract.ok,
    coalesce(
      (select definition from state_constraint limit 1),
      'constraint ausente'
    ),
    'legacy_unknown/no_active_session sem IDs; pending_context com session; captured com session e context'
  from state_constraint_contract contract

  union all

  select
    4,
    'duas FKs compostas',
    contract.ok,
    coalesce(
      (
        select string_agg(
          format(
            '%s: (%s) -> %s.%s(%s) | on_delete=%s | validated=%s',
            conname,
            array_to_string(source_columns, ', '),
            referenced_schema,
            referenced_table,
            array_to_string(target_columns, ', '),
            confdeltype,
            convalidated
          ),
          E'\n'
          order by conname
        )
        from foreign_key_contract
      ),
      'FKs ausentes'
    ),
    'duas FKs compostas com ordem exata das colunas e ON DELETE RESTRICT'
  from foreign_key_contract_result contract

  union all

  select
    5,
    'tres indices do snapshot',
    contract.ok,
    coalesce(
      (
        select string_agg(
          format(
            '%s on %s.%s: unique=%s | valid=%s | ready=%s | columns=%s | options=%s | predicate=%s',
            index_name,
            table_schema,
            table_name,
            indisunique,
            indisvalid,
            indisready,
            array_to_string(key_columns, ', '),
            key_options::text,
            coalesce(normalized_predicate, '<none>')
          ),
          E'\n'
          order by index_name
        )
        from index_contract
      ),
      'indices ausentes'
    ),
    'um indice unique de parent e dois indices parciais de messages com created_at DESC'
  from index_contract_result contract

  union all

  select
    6,
    'trigger de preenchimento',
    contract.ok,
    coalesce(contract.detail, 'trigger ausente'),
    'trg_fill_messages_lead_store habilitado em public.messages como BEFORE INSERT OR UPDATE'
  from fill_trigger_contract contract

  union all

  select
    7,
    'funcao de preenchimento e imutabilidade',
    contract.ok,
    coalesce(
      (
        select
          procedure_row.oid::regprocedure::text
          || ' | return=' || procedure_row.prorettype::regtype::text
          || ' | language=' || language_row.lanname
          || ' | security_definer=' || procedure_row.prosecdef
          || ' | config=' || coalesce(procedure_row.proconfig::text, '<null>')
        from pg_catalog.pg_proc procedure_row
        join pg_catalog.pg_language language_row
          on language_row.oid = procedure_row.prolang
        where procedure_row.oid = pg_catalog.to_regprocedure(
          'public.fill_messages_lead_store_from_conversation()'
        )
      ),
      'funcao ausente'
    ),
    'funcao trigger PL/pgSQL, SECURITY INVOKER, search_path fixo, tres estados e erro de imutabilidade'
  from fill_function_contract contract

  union all

  select
    8,
    'RPCs de mensagens preservadas',
    contract.ok,
    format(
      'insert_message=%s | panel_send_message=%s | panel_send_message_scoped=%s | mark_message_external_sent=%s',
      pg_catalog.to_regprocedure(
        'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'
      ),
      pg_catalog.to_regprocedure(
        'public.panel_send_message(uuid,text,text,text)'
      ),
      pg_catalog.to_regprocedure(
        'public.panel_send_message_scoped(uuid,uuid,text)'
      ),
      pg_catalog.to_regprocedure(
        'public.mark_message_external_sent(uuid,text)'
      )
    ),
    'assinaturas exatas com retornos messages, uuid, uuid e void'
  from rpc_contract contract

  union all

  select
    9,
    'consistencia atual dos snapshots',
    consistency.inconsistent_messages = 0,
    format(
      'total_messages=%s | inconsistent_messages=%s',
      consistency.total_messages,
      consistency.inconsistent_messages
    ),
    'nenhuma mensagem viola a combinacao permitida entre estado, session_id e context_link_id'
  from message_consistency consistency

  union all

  select
    10,
    'consistencia das mensagens legacy_unknown',
    consistency.invalid_legacy_messages = 0,
    format(
      'legacy_unknown_messages=%s | invalid_legacy_messages=%s',
      consistency.legacy_messages,
      consistency.invalid_legacy_messages
    ),
    'toda mensagem legacy_unknown permanece com os dois IDs historicos nulos'
  from legacy_consistency consistency
),
report_rows as (
  select
    'CHECK'::text as row_type,
    check_number,
    check_name,
    case when passed is true then 'PASS' else 'FAIL' end::text as status,
    detail,
    expected_contract,
    null::text as final_status,
    0 as sort_group
  from checks

  union all

  select
    'INFO',
    null::integer,
    'distribuicao atual dos estados',
    'INFO',
    distribution::text,
    'linha informativa; nao altera a aprovacao',
    null,
    1
  from state_distribution

  union all

  select
    'SUMMARY',
    null::integer,
    'resultado da Etapa 4.12',
    case
      when count(*) filter (where passed is not true) = 0 then 'APROVADA'
      else 'REPROVADA'
    end,
    format(
      'checks=%s | pass=%s | fail=%s',
      count(*),
      count(*) filter (where passed is true),
      count(*) filter (where passed is not true)
    ),
    'todos os 10 checks obrigatorios devem estar em PASS',
    case
      when count(*) filter (where passed is not true) = 0 then 'APROVADA'
      else 'REPROVADA'
    end,
    2
  from checks
)
select
  row_type,
  check_number,
  check_name,
  status,
  detail,
  expected_contract,
  final_status
from report_rows
order by sort_group, check_number nulls last;
