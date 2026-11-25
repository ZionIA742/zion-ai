/*
  ZION / Central I8-001 / Etapa 4.2-C
  Diagnostico remoto complementar, exclusivamente de leitura.

  Nao invoca RPCs operacionais, nao consulta linhas de clientes e nao altera
  objetos, dados ou historico de migrations. Retorna as definicoes efetivas
  instaladas para revisao manual das sete invariantes.
*/

/* 1. Tabelas, colunas, tipos, nulabilidade e defaults relevantes. */
WITH required(table_name, column_name) AS (
  VALUES
    ('commercial_session_context_links', 'status'),
    ('commercial_session_context_links', 'lifecycle_cycle'),
    ('commercial_session_context_links', 'unlinked_at'),
    ('commercial_session_context_links', 'commercial_opportunity_id'),
    ('commercial_session_context_links', 'conversation_session_id'),
    ('commercial_opportunities', 'lifecycle_cycle'),
    ('commercial_opportunities', 'stage'),
    ('commercial_opportunities', 'last_reopened_at'),
    ('commercial_opportunities', 'current_loss_event_id'),
    ('commercial_opportunity_lifecycle_events', 'event_type'),
    ('commercial_opportunity_lifecycle_events', 'lifecycle_cycle'),
    ('commercial_opportunity_lifecycle_events', 'previous_stage'),
    ('commercial_opportunity_lifecycle_events', 'new_stage')
)
SELECT
  r.table_name,
  r.column_name,
  c.oid IS NOT NULL AS table_exists,
  a.attname IS NOT NULL AS column_exists,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  CASE WHEN a.attnotnull THEN false ELSE true END AS nullable,
  pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expression,
  pg_catalog.col_description(a.attrelid, a.attnum) AS column_comment
FROM required r
LEFT JOIN pg_catalog.pg_class c
  ON c.relnamespace = 'public'::regnamespace
 AND c.relname = r.table_name
LEFT JOIN pg_catalog.pg_attribute a
  ON a.attrelid = c.oid
 AND a.attname = r.column_name
 AND a.attnum > 0
 AND NOT a.attisdropped
LEFT JOIN pg_catalog.pg_attrdef d
  ON d.adrelid = a.attrelid
 AND d.adnum = a.attnum
ORDER BY r.table_name, r.column_name;

/* 2. Triggers e constraints que podem impor o contrato de lifecycle. */
SELECT
  ns.nspname AS table_schema,
  cls.relname AS table_name,
  trg.tgname AS trigger_name,
  trg.tgenabled,
  pg_catalog.pg_get_triggerdef(trg.oid, true) AS trigger_definition,
  fn_ns.nspname AS trigger_function_schema,
  fn.proname AS trigger_function_name,
  pg_catalog.pg_get_function_identity_arguments(fn.oid) AS trigger_function_arguments,
  md5(pg_catalog.pg_get_functiondef(fn.oid)) AS trigger_function_md5
FROM pg_catalog.pg_trigger trg
JOIN pg_catalog.pg_class cls ON cls.oid = trg.tgrelid
JOIN pg_catalog.pg_namespace ns ON ns.oid = cls.relnamespace
JOIN pg_catalog.pg_proc fn ON fn.oid = trg.tgfoid
JOIN pg_catalog.pg_namespace fn_ns ON fn_ns.oid = fn.pronamespace
WHERE NOT trg.tgisinternal
  AND ns.nspname = 'public'
  AND cls.relname IN (
    'commercial_session_context_links',
    'commercial_opportunities',
    'commercial_opportunity_lifecycle_events'
  )
ORDER BY cls.relname, trg.tgname;

SELECT
  ns.nspname AS constraint_schema,
  cls.relname AS table_name,
  con.conname AS constraint_name,
  pg_catalog.pg_get_constraintdef(con.oid, true) AS constraint_definition
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class cls ON cls.oid = con.conrelid
JOIN pg_catalog.pg_namespace ns ON ns.oid = cls.relnamespace
WHERE ns.nspname = 'public'
  AND cls.relname IN (
    'commercial_session_context_links',
    'commercial_opportunities',
    'commercial_opportunity_lifecycle_events'
  )
ORDER BY cls.relname, con.conname;

/* 3. Assinaturas, owners, security, ACLs e corpos efetivos das autoridades. */
WITH wanted(proname) AS (
  VALUES
    ('ensure_commercial_conversation_session_context'),
    ('insert_message'),
    ('replace_commercial_session_context_link'),
    ('write_commercial_message_intent_resolution_internal'),
    ('materialize_sales_ai_reply_set_by_system'),
    ('materialize_sales_ai_reply_set_by_worker_by_system'),
    ('validate_or_cancel_whatsapp_external_send_v2_by_system'),
    ('validate_or_cancel_whatsapp_external_send_v3_by_system'),
    ('write_commercial_opportunity_qualification_fact_by_system'),
    ('read_commercial_opportunity_qualification_facts_by_system'),
    ('read_commercial_opportunity_qualification_facts_by_user'),
    ('i8_001_current_context_matches_cycle')
)
SELECT
  p.oid::regprocedure::text AS signature,
  p.proname,
  pg_catalog.pg_get_function_result(p.oid) AS result_type,
  pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
  p.prosecdef AS security_definer,
  p.provolatile,
  p.proparallel,
  p.proleakproof,
  pg_catalog.array_to_string(p.proconfig, ',') AS proconfig,
  pg_catalog.array_to_string(p.proacl, ',') AS acl,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  md5(pg_catalog.pg_get_functiondef(p.oid)) AS definition_md5,
  pg_catalog.pg_get_functiondef(p.oid) AS effective_definition
FROM wanted w
JOIN pg_catalog.pg_proc p
  ON p.pronamespace = 'public'::regnamespace
 AND p.proname = w.proname
ORDER BY p.proname, signature;

/* 4. Apenas confirma se o historico catalogado existe; nao presume que ele
      registre SQL manual executado fora do mecanismo de migrations. */
SELECT
  to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
    AS migration_history_relation_exists,
  CASE
    WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL
      THEN 'historico indisponivel para consulta segura'
    ELSE 'relacao existe; consultar manualmente se necessario'
  END AS migration_history_state;

