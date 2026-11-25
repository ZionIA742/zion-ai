-- ZION / I8-001: inventario complementar unificado, somente leitura.
-- Uma unica consulta; nenhuma RPC operacional do ZION e invocada.
-- Resultados de catalogo nao substituem analise do corpo SQL nem testes concorrentes.
WITH
wanted_functions(name) AS (
  VALUES
    ('ensure_commercial_conversation_session_context'),
    ('insert_message'),
    ('replace_commercial_session_context_link'),
    ('write_commercial_message_intent_resolution_internal'),
    ('write_commercial_message_intent_resolution_by_system'),
    ('materialize_sales_ai_reply_set_by_system'),
    ('materialize_sales_ai_reply_set_by_worker_by_system'),
    ('i8_001_current_context_matches_cycle'),
    ('read_commercial_opportunity_qualification_facts_by_system'),
    ('read_commercial_opportunity_qualification_facts_by_user')
),
wanted_tables(name) AS (
  VALUES
    ('commercial_session_context_links'),
    ('commercial_opportunities'),
    ('commercial_opportunity_lifecycle_events'),
    ('commercial_message_intent_resolution_current'),
    ('commercial_message_intent_resolution_events'),
    ('commercial_opportunity_qualification_fact_events'),
    ('commercial_opportunity_qualification_facts_current'),
    ('commercial_conversation_session_contexts'),
    ('conversation_sessions'),
    ('conversations'),
    ('messages')
),
wanted_migrations(version) AS (
  VALUES
    ('20260720173000'), ('20260722113000'), ('20260724110000'),
    ('20260728143000'), ('20260729110000'), ('20260825124000'),
    ('20260825165000'), ('20260826185000'), ('20260828130000'),
    ('20260828190000'), ('20260828203000'), ('20260831113000'),
    ('20260923132000'), ('20260923154500'), ('20261006160000'),
    ('20261008133000'), ('20261009120000'), ('20261019160000'),
    ('20261020123000'), ('20261021010000'), ('20261023220000'),
    ('20261023221000'), ('20261023223000'), ('20261028120000')
),
function_inventory AS (
  SELECT
    'FUNCTION'::text AS tipo,
    p.oid::regprocedure::text AS objeto,
    jsonb_build_object(
      'owner', pg_get_userbyid(p.proowner),
      'security_definer', p.prosecdef,
      'language', l.lanname,
      'kind', p.prokind,
      'config', p.proconfig,
      'acl', p.proacl::text,
      'arguments', pg_get_function_identity_arguments(p.oid),
      'result', pg_get_function_result(p.oid)
    ) AS metadados,
    pg_get_functiondef(p.oid) AS definicao
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
    AND (
      EXISTS (SELECT 1 FROM wanted_functions w WHERE w.name = p.proname)
      OR p.proname ~* '(commercial.*context|intent_resolution|qualification_fact|materialize_sales_ai_reply_set|sales_ai.*(external|gate)|contract.*(send|finaliz)|send.*contract|i8_001_)'
    )
),
missing_functions AS (
  SELECT
    'FUNCTION_MISSING'::text AS tipo,
    'public.' || w.name AS objeto,
    jsonb_build_object('exists', false) AS metadados,
    NULL::text AS definicao
  FROM wanted_functions w
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = w.name
  )
),
table_inventory AS (
  SELECT
    'TABLE'::text AS tipo,
    'public.' || w.name AS objeto,
    jsonb_build_object(
      'exists', c.oid IS NOT NULL,
      'rls_enabled', c.relrowsecurity,
      'rls_forced', c.relforcerowsecurity,
      'columns', COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'name', a.attname,
            'type', format_type(a.atttypid, a.atttypmod),
            'not_null', a.attnotnull,
            'default', pg_get_expr(d.adbin, d.adrelid)
          ) ORDER BY a.attnum
        ) FILTER (WHERE a.attnum IS NOT NULL),
        '[]'::jsonb
      )
    ) AS metadados,
    NULL::text AS definicao
  FROM wanted_tables w
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class c
    ON c.relnamespace = n.oid AND c.relname = w.name AND c.relkind IN ('r', 'p')
  LEFT JOIN pg_catalog.pg_attribute a
    ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef d
    ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  GROUP BY w.name, c.oid, c.relrowsecurity, c.relforcerowsecurity
),
trigger_inventory AS (
  SELECT
    'TRIGGER'::text AS tipo,
    'public.' || c.relname || '.' || t.tgname AS objeto,
    jsonb_build_object(
      'enabled', t.tgenabled,
      'function', t.tgfoid::regprocedure::text,
      'internal', t.tgisinternal
    ) AS metadados,
    pg_get_triggerdef(t.oid, true) AS definicao
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN wanted_tables w ON w.name = c.relname
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
),
constraint_inventory AS (
  SELECT
    'CONSTRAINT'::text AS tipo,
    'public.' || c.relname || '.' || con.conname AS objeto,
    jsonb_build_object('type', con.contype, 'validated', con.convalidated) AS metadados,
    pg_get_constraintdef(con.oid, true) AS definicao
  FROM pg_catalog.pg_constraint con
  JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN wanted_tables w ON w.name = c.relname
  WHERE n.nspname = 'public'
),
index_inventory AS (
  SELECT
    'INDEX'::text AS tipo,
    i.schemaname || '.' || i.indexname AS objeto,
    jsonb_build_object('table', i.tablename) AS metadados,
    i.indexdef AS definicao
  FROM pg_catalog.pg_indexes i
  JOIN wanted_tables w ON w.name = i.tablename
  WHERE i.schemaname = 'public'
),
migration_inventory AS (
  SELECT
    'MIGRATION'::text AS tipo,
    w.version AS objeto,
    jsonb_build_object(
      'registered_in_history', COUNT(to_jsonb(m) ->> 'version') > 0,
      'history_row_count', COUNT(to_jsonb(m) ->> 'version'),
      'history_relation', 'supabase_migrations.schema_migrations'
    ) AS metadados,
    NULL::text AS definicao
  FROM wanted_migrations w
  LEFT JOIN supabase_migrations.schema_migrations m
    ON (to_jsonb(m) ->> 'version') = w.version
  GROUP BY w.version
)
SELECT tipo, objeto, metadados, definicao
FROM (
  SELECT * FROM function_inventory
  UNION ALL SELECT * FROM missing_functions
  UNION ALL SELECT * FROM table_inventory
  UNION ALL SELECT * FROM trigger_inventory
  UNION ALL SELECT * FROM constraint_inventory
  UNION ALL SELECT * FROM index_inventory
  UNION ALL SELECT * FROM migration_inventory
) resultado
ORDER BY tipo, objeto;
