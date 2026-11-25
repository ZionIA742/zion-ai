/*
  ZION / Central I8-001 / Etapa 4.2-A
  Inventario remoto de lifecycle e autoridades canonicas.

  SOMENTE LEITURA.
  Este arquivo nao chama RPC operacional do ZION, nao consulta dados
  comerciais de negocio e nao executa migration. Ele usa apenas catalogos
  PostgreSQL e, quando existente, o historico de migrations.

  Interpretacao dos estados da matriz:
    CONFIRMADO_NO_REMOTO = a definicao/catalogo contem todas as provas
                           estruturais exigidas pela invariante.
    AUSENTE_NO_REMOTO    = objeto estrutural obrigatorio nao existe.
    AINDA_NAO_COMPROVADO = existe objeto, mas a prova do contrato nao e
                           suficiente ou a definicao diverge.

  A ausencia de uma versao em schema_migrations nao prova que SQL manual
  nunca foi executado fora do mecanismo de migrations.
*/

/* 1. Relacao de historico, sem presumir que ela exista. */
SELECT
  to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
    AS migration_history_relation_exists,
  CASE
    WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL
      THEN 'historico indisponivel'
    ELSE 'historico acessivel por relacao catalogada'
  END AS migration_history_state;

/* 2. Tabelas e colunas de lifecycle/contexto. */
WITH required_tables(table_name) AS (
  VALUES
    ('commercial_session_context_links'),
    ('commercial_opportunities'),
    ('commercial_opportunity_lifecycle_events')
),
table_state AS (
  SELECT
    t.table_name,
    to_regclass('public.' || t.table_name) IS NOT NULL AS table_exists
  FROM required_tables t
),
required_columns(table_name, column_name) AS (
  VALUES
    ('commercial_session_context_links', 'lifecycle_cycle'),
    ('commercial_session_context_links', 'unlinked_at'),
    ('commercial_opportunities', 'lifecycle_cycle'),
    ('commercial_opportunities', 'last_reopened_at'),
    ('commercial_opportunities', 'current_loss_event_id'),
    ('commercial_opportunity_lifecycle_events', 'lifecycle_cycle'),
    ('commercial_opportunity_lifecycle_events', 'event_type'),
    ('commercial_opportunity_lifecycle_events', 'previous_stage'),
    ('commercial_opportunity_lifecycle_events', 'new_stage')
)
SELECT
  ts.table_name,
  ts.table_exists,
  rc.column_name,
  a.attname IS NOT NULL AS column_exists,
  format_type(a.atttypid, a.atttypmod) AS data_type,
  CASE WHEN a.attnotnull THEN false ELSE true END AS nullable,
  pg_get_expr(ad.adbin, ad.adrelid) AS default_expression
FROM table_state ts
LEFT JOIN required_columns rc
  ON rc.table_name = ts.table_name
LEFT JOIN pg_catalog.pg_class c
  ON c.relnamespace = 'public'::regnamespace
 AND c.relname = ts.table_name
LEFT JOIN pg_catalog.pg_attribute a
  ON a.attrelid = c.oid
 AND a.attname = rc.column_name
 AND a.attnum > 0
 AND NOT a.attisdropped
LEFT JOIN pg_catalog.pg_attrdef ad
  ON ad.adrelid = a.attrelid
 AND ad.adnum = a.attnum
ORDER BY ts.table_name, rc.column_name;

/* 3. Triggers efetivamente instalados nas tres tabelas. */
SELECT
  n.nspname AS table_schema,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  t.tgenabled,
  pg_get_triggerdef(t.oid, true) AS trigger_definition,
  pn.nspname AS trigger_function_schema,
  pp.proname AS trigger_function_name,
  pg_get_function_identity_arguments(pp.oid) AS trigger_function_arguments,
  md5(pg_get_functiondef(pp.oid)) AS trigger_function_md5
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_proc pp ON pp.oid = t.tgfoid
JOIN pg_catalog.pg_namespace pn ON pn.oid = pp.pronamespace
WHERE NOT t.tgisinternal
  AND n.nspname = 'public'
  AND c.relname IN (
    'commercial_session_context_links',
    'commercial_opportunities',
    'commercial_opportunity_lifecycle_events'
  )
ORDER BY c.relname, t.tgname;

/* 4. Autoridades e readers/writers relevantes.
      A definicao completa nao e retornada por padrao; hash e marcadores
      permitem comparar o contrato sem provocar uma saida excessiva. */
WITH expected(authority, signature, markers) AS (
  VALUES
    ('ensure_context',
     'public.ensure_commercial_conversation_session_context(uuid,uuid,uuid)',
     ARRAY[
       'existing_captured',
       'lifecycle_cycle',
       'unlinked_at',
       'commercial_opportunities',
       'for update'
     ]::text[]),
    ('insert_message',
     'public.insert_message(uuid,text,text,text,text,text,text,jsonb)',
     ARRAY[
       'ensure_commercial_conversation_session_context',
       'private_acquire_sales_contract_conversation_xact_lock'
     ]::text[]),
    ('context_replacement',
     'public.replace_commercial_session_context_link(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,uuid,jsonb,text,text,jsonb,timestamptz)',
     ARRAY[
       'replaces_link_id',
       'lifecycle_cycle',
       'commercial_opportunity_lifecycle_events',
       'reopened'
     ]::text[]),
    ('cmir_writer',
     'public.write_commercial_message_intent_resolution_internal(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,jsonb,text)',
     ARRAY[
       'commercial_opportunity_lifecycle_events',
       'replace_commercial_session_context_link',
       'reopen_same_intent'
     ]::text[]),
    ('sales_ai_materializer',
     'public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)',
     ARRAY[
       'commercial_session_context_links',
       'lifecycle_cycle',
       'unlinked_at',
       'private_acquire_sales_contract_conversation_xact_lock'
     ]::text[]),
    ('sales_ai_worker_materializer',
     'public.materialize_sales_ai_reply_set_by_worker_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,text,uuid,uuid,jsonb,jsonb,jsonb)',
     ARRAY[
       'materialize_sales_ai_reply_set_by_system'
     ]::text[]),
    ('external_send_gate_v2',
     'public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)',
     ARRAY[
       'commercial_opportunity',
       'private_acquire_sales_contract_conversation_xact_lock'
     ]::text[]),
    ('external_send_gate_v3',
     'public.validate_or_cancel_whatsapp_external_send_v3_by_system(uuid,uuid,uuid)',
     ARRAY[
       'validate_or_cancel_whatsapp_external_send_v2_by_system'
     ]::text[]),
    ('contract_send_gate',
     'public.validate_or_start_sales_contract_send_by_system(uuid,uuid,uuid)',
     ARRAY[
       'sales_contract_send',
       'service_role'
     ]::text[]),
    ('contract_send_finalizer',
     'public.finalize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,text)',
     ARRAY[
       'sales_contract_send',
       'service_role'
     ]::text[]),
    ('qualification_fact_writer',
     'public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)',
     ARRAY[
       'service_role',
       'organization_id',
       'store_id',
       'commercial_opportunity_id'
     ]::text[]),
    ('qualification_fact_reader_system',
     'public.read_commercial_opportunity_qualification_facts_by_system(uuid,uuid,uuid)',
     ARRAY[
       'organization_id',
       'store_id',
       'commercial_opportunity_id',
       'service_role'
     ]::text[]),
    ('qualification_fact_reader_user',
     'public.read_commercial_opportunity_qualification_facts_by_user(uuid,uuid,uuid)',
     ARRAY[
       'organization_id',
       'store_id',
       'commercial_opportunity_id',
       'membership'
     ]::text[])
), defs AS (
  SELECT
    e.*,
    p.oid,
    CASE WHEN p.oid IS NULL THEN NULL ELSE pg_get_functiondef(p.oid) END AS definition,
    CASE WHEN p.oid IS NULL THEN NULL ELSE md5(pg_get_functiondef(p.oid)) END AS definition_md5,
    CASE WHEN p.oid IS NULL THEN NULL ELSE pg_get_userbyid(p.proowner) END AS owner_name,
    p.prosecdef AS security_definer,
    CASE WHEN p.oid IS NULL THEN NULL ELSE array_to_string(p.proconfig, ',') END AS proconfig
  FROM expected e
  LEFT JOIN pg_catalog.pg_proc p
    ON p.oid = to_regprocedure(e.signature)
)
SELECT
  authority,
  signature,
  oid IS NOT NULL AS function_exists,
  definition_md5,
  owner_name,
  security_definer,
  proconfig,
  CASE WHEN oid IS NULL THEN NULL ELSE has_function_privilege('service_role', oid, 'EXECUTE') END AS service_role_execute,
  CASE WHEN oid IS NULL THEN NULL ELSE has_function_privilege('authenticated', oid, 'EXECUTE') END AS authenticated_execute,
  CASE WHEN oid IS NULL THEN NULL ELSE has_function_privilege('anon', oid, 'EXECUTE') END AS anon_execute,
  bool_and(position(lower(marker) IN lower(coalesce(definition, ''))) > 0) AS all_markers_present,
  jsonb_object_agg(
    marker,
    position(lower(marker) IN lower(coalesce(definition, ''))) > 0
  ) AS marker_results
FROM defs
LEFT JOIN LATERAL unnest(markers) AS marker ON true
GROUP BY
  authority, signature, oid, definition_md5, owner_name,
  security_definer, proconfig, service_role_execute,
  authenticated_execute, anon_execute
ORDER BY authority;

/* Helper de ciclo: a presenca do nome nao basta; os marcadores do corpo
   devem demonstrar fail-closed e prova CMIR canonica. */
SELECT
  p.oid::regprocedure::text AS helper_signature,
  md5(pg_get_functiondef(p.oid)) AS helper_md5,
  pg_get_userbyid(p.proowner) AS owner_name,
  p.prosecdef AS security_definer,
  array_to_string(p.proconfig, ',') AS proconfig,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  position('select coalesce' IN lower(pg_get_functiondef(p.oid))) > 0 AS has_null_coalesce,
  position('false' IN lower(pg_get_functiondef(p.oid))) > 0 AS has_fail_closed_false,
  position('commercial_message_intent_resolution_current' IN lower(pg_get_functiondef(p.oid))) > 0 AS has_cmir_current,
  position('commercial_message_intent_resolution_events' IN lower(pg_get_functiondef(p.oid))) > 0 AS has_cmir_events
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'i8_001_current_context_matches_cycle';

/* 5. Matriz conservadora das sete invariantes I8-001. */
WITH defs AS (
  SELECT
    p.oid,
    p.oid::regprocedure::text AS signature,
    lower(pg_get_functiondef(p.oid)) AS definition
  FROM pg_catalog.pg_proc p
  WHERE p.oid IN (
    to_regprocedure('public.insert_message(uuid,text,text,text,text,text,text,jsonb)'),
    to_regprocedure('public.ensure_commercial_conversation_session_context(uuid,uuid,uuid)'),
    to_regprocedure('public.replace_commercial_session_context_link(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,uuid,jsonb,text,text,jsonb,timestamptz)'),
    to_regprocedure('public.write_commercial_message_intent_resolution_internal(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,jsonb,text)'),
    to_regprocedure('public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)')
  )
), d AS (
  SELECT
    max(definition) FILTER (WHERE signature LIKE 'public.insert_message%') AS insert_def,
    max(definition) FILTER (WHERE signature LIKE 'public.ensure_commercial_conversation_session_context%') AS ensure_def,
    max(definition) FILTER (WHERE signature LIKE 'public.replace_commercial_session_context_link%') AS replace_def,
    max(definition) FILTER (WHERE signature LIKE 'public.write_commercial_message_intent_resolution_internal%') AS cmir_def,
    max(definition) FILTER (WHERE signature LIKE 'public.materialize_sales_ai_reply_set_by_system%') AS materializer_def
  FROM defs
), tables AS (
  SELECT
    to_regclass('public.commercial_session_context_links') IS NOT NULL AS links_table,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = to_regclass('public.commercial_session_context_links')
        AND a.attname = 'lifecycle_cycle' AND NOT a.attisdropped
    ) AS links_cycle,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = to_regclass('public.commercial_session_context_links')
        AND a.attname = 'unlinked_at' AND NOT a.attisdropped
    ) AS links_unlinked
), helper AS (
  SELECT max(lower(pg_get_functiondef(p.oid))) AS helper_def
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'i8_001_current_context_matches_cycle'
), checks AS (
  SELECT
    d.*,
    t.*,
    h.helper_def,
    position('ensure_commercial_conversation_session_context' IN insert_def) AS insert_ensure_pos,
    position('private_acquire_sales_contract_conversation_xact_lock' IN insert_def) AS insert_private_lock_pos,
    position('existing_captured' IN ensure_def) AS ensure_existing_pos,
    position('commercial_opportunities' IN ensure_def) AS ensure_opportunity_pos,
    position('for update' IN ensure_def) AS ensure_for_update_pos,
    position('lifecycle_cycle' IN ensure_def) AS ensure_cycle_pos,
    position('unlinked_at' IN ensure_def) AS ensure_unlinked_pos,
    position('lifecycle_cycle' IN replace_def) AS replace_cycle_pos,
    position('insert into public.commercial_session_context_links' IN replace_def) AS replace_insert_pos,
    position('commercial_opportunity_lifecycle_events' IN replace_def) AS replace_events_pos,
    position('event_type = ''reopened''' IN replace_def) AS replace_reopened_pos,
    position('commercial_opportunity_lifecycle_events' IN cmir_def) AS cmir_events_pos,
    position('replace_commercial_session_context_link' IN cmir_def) AS cmir_replace_pos,
    position('commercial_session_context_links' IN materializer_def) AS materializer_link_pos,
    position('lifecycle_cycle' IN materializer_def) AS materializer_cycle_pos,
    position('unlinked_at' IN materializer_def) AS materializer_unlinked_pos,
    position('private_acquire_sales_contract_conversation_xact_lock' IN materializer_def) AS materializer_lock_pos,
    position('v_anchor.commercial_session_context_link_id' IN materializer_def) AS materializer_anchor_snapshot_pos
  FROM d CROSS JOIN tables t CROSS JOIN helper h
)
SELECT * FROM (
  SELECT
    1 AS item,
    'ordem de locks insert_message/ensure' AS invariant,
    CASE
      WHEN insert_def IS NULL OR ensure_def IS NULL THEN 'AUSENTE_NO_REMOTO'
      WHEN insert_ensure_pos > 0
       AND insert_private_lock_pos > 0
       AND insert_ensure_pos < insert_private_lock_pos
        THEN 'CONFIRMADO_NO_REMOTO'
      ELSE 'AINDA_NAO_COMPROVADO'
    END AS state,
    'insert_message: ensure antes do lock privado; ausencia de prova e conservadora' AS evidence
  FROM checks

  UNION ALL
  SELECT
    2,
    'ciclo no contexto existing_captured',
    CASE
      WHEN ensure_def IS NULL THEN 'AUSENTE_NO_REMOTO'
      WHEN ensure_existing_pos > 0
       AND ensure_cycle_pos > 0
       AND ensure_unlinked_pos > 0
       AND ensure_opportunity_pos > 0
       AND ensure_for_update_pos > ensure_opportunity_pos
        THEN 'CONFIRMADO_NO_REMOTO'
      ELSE 'AINDA_NAO_COMPROVADO'
    END,
    'existing_captured deve ser precedido por ciclo, unlinked_at e oportunidade bloqueada'
  FROM checks

  UNION ALL
  SELECT
    3,
    'links legados com lifecycle_cycle nulo',
    CASE
      WHEN NOT links_table OR NOT links_cycle THEN 'AUSENTE_NO_REMOTO'
      WHEN ensure_def IS NULL THEN 'AINDA_NAO_COMPROVADO'
      WHEN position('lifecycle_cycle is null' IN ensure_def) > 0
       AND position('lifecycle_cycle = 1' IN ensure_def) > 0
        THEN 'CONFIRMADO_NO_REMOTO'
      ELSE 'AINDA_NAO_COMPROVADO'
    END,
    'a coluna e a regra de limite ao ciclo 1 devem existir simultaneamente'
  FROM checks

  UNION ALL
  SELECT
    4,
    'replacement valida e grava lifecycle_cycle',
    CASE
      WHEN replace_def IS NULL OR NOT links_table OR NOT links_cycle THEN 'AUSENTE_NO_REMOTO'
      WHEN replace_cycle_pos > 0
       AND replace_insert_pos > 0
       AND position('lifecycle_cycle,' IN replace_def) > 0
        THEN 'CONFIRMADO_NO_REMOTO'
      ELSE 'AINDA_NAO_COMPROVADO'
    END,
    'a prova exige ciclo no corpo e na lista de colunas do novo link'
  FROM checks

  UNION ALL
  SELECT
    5,
    'replacement exige evidencia canonica reopened',
    CASE
      WHEN replace_def IS NULL OR cmir_def IS NULL THEN 'AUSENTE_NO_REMOTO'
      WHEN replace_events_pos > 0
       AND replace_reopened_pos > 0
       AND position('lifecycle_cycle' IN replace_def) > 0
       AND cmir_events_pos > 0
        THEN 'CONFIRMADO_NO_REMOTO'
      ELSE 'AINDA_NAO_COMPROVADO'
    END,
    'nomear reopened no CMIR nao substitui a validacao estrutural do replacement'
  FROM checks

  UNION ALL
  SELECT
    6,
    'materializer valida ciclo e vinculo ativo',
    CASE
      WHEN materializer_def IS NULL OR NOT links_table THEN 'AUSENTE_NO_REMOTO'
      WHEN materializer_cycle_pos > 0
       AND materializer_unlinked_pos > 0
       AND materializer_lock_pos > 0
       AND position('status = ''active''' IN materializer_def) > 0
        THEN 'CONFIRMADO_NO_REMOTO'
      ELSE 'AINDA_NAO_COMPROVADO'
    END,
    'funcao presente sem todos os marcadores nao e aprovada'
  FROM checks

  UNION ALL
  SELECT
    7,
    'materializer usa vinculo corrente apos replacement CMIR',
    CASE
      WHEN materializer_def IS NULL OR cmir_def IS NULL THEN 'AUSENTE_NO_REMOTO'
      WHEN helper_def IS NOT NULL
       AND position('select coalesce' IN helper_def) > 0
       AND position('false' IN helper_def) > 0
       AND position('commercial_message_intent_resolution_current' IN helper_def) > 0
       AND position('commercial_message_intent_resolution_events' IN helper_def) > 0
       AND position('i8_001_current_context_matches_cycle' IN materializer_def) > 0
       AND cmir_replace_pos > 0
       AND materializer_anchor_snapshot_pos = 0
        THEN 'CONFIRMADO_NO_REMOTO'
      ELSE 'AINDA_NAO_COMPROVADO'
    END,
    'snapshot do anchor nao pode ser a unica autoridade do replacement'
  FROM checks
) matrix
ORDER BY item;

/* 6. Historico, quando a relacao existir.
      O bloco usa SQL dinamico somente para evitar erro de relacao ausente.
      Ele apenas emite NOTICE; nao cria objetos e nao altera dados. */
DO $history_read_only$
DECLARE
  r record;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE NOTICE 'P9_I8_HISTORY_UNAVAILABLE relation=supabase_migrations.schema_migrations';
    RETURN;
  END IF;

  FOR r IN EXECUTE $sql$
    SELECT version, name
    FROM supabase_migrations.schema_migrations
    WHERE version IN (
      '20261026131500',
      '20261029110000',
      '20261029150000',
      '20261029153000',
      '20261029163000',
      '20261029170000',
      '20261029173000'
    )
    ORDER BY version
  $sql$ LOOP
    RAISE NOTICE 'P9_I8_HISTORY version=% name=%', r.version, r.name;
  END LOOP;
END;
$history_read_only$;

