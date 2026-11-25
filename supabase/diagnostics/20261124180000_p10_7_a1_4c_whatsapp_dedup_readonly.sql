-- MICROETAPA 10.7-A1.4c
-- Diagnostico somente leitura. Cada bloco abaixo retorna uma tabela visivel no SQL Editor.
-- Nao usa NOTICE, nao cria fixtures e nao altera dados.

SELECT
  'a1_4b_objects'::text AS diagnostic,
  c.table_name,
  c.object_kind,
  c.present,
  c.expected_definition
FROM (
  VALUES
    ('store_assistant_notification_queue', 'table',
     to_regclass('public.store_assistant_notification_queue') IS NOT NULL,
     'fila interna da Assistente'),
    ('uq_store_assistant_notification_human_response_event', 'index',
     to_regclass('public.uq_store_assistant_notification_human_response_event') IS NOT NULL,
     'unicidade tenant-scoped por event_key do scanner humano'),
    ('trg_p10_7_a1_4b_preserve_delivered_human_response_alert', 'trigger',
     EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public.store_assistant_notification_queue'::regclass
         AND tgname = 'trg_p10_7_a1_4b_preserve_delivered_human_response_alert'
         AND NOT tgisinternal
     ),
     'impede sent/delivered/read -> pending para alertas humanos')
) AS c(table_name, object_kind, present, expected_definition)
ORDER BY c.table_name;

SELECT
  'a1_4b_historical_duplicates'::text AS diagnostic,
  q.organization_id,
  q.store_id,
  q.context ->> 'event_key' AS event_key,
  count(*)::bigint AS row_count,
  min(q.created_at) AS first_created_at,
  max(q.created_at) AS last_created_at
FROM public.store_assistant_notification_queue q
WHERE q.notification_type = 'important_alert'
  AND q.context ->> 'reason' = 'human_response_pending'
  AND NULLIF(BTRIM(q.context ->> 'event_key'), '') IS NOT NULL
GROUP BY q.organization_id, q.store_id, q.context ->> 'event_key'
HAVING count(*) > 1
ORDER BY row_count DESC, first_created_at;

SELECT
  'a1_4b_index_compatibility'::text AS diagnostic,
  indexrelid::regclass AS index_name,
  pg_get_indexdef(indexrelid) AS index_definition
FROM pg_catalog.pg_index
WHERE indexrelid = to_regclass('public.uq_store_assistant_notification_human_response_event');

SELECT
  'a1_4b_trigger_compatibility'::text AS diagnostic,
  t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid) AS trigger_definition,
  p.oid::regprocedure AS trigger_function
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.store_assistant_notification_queue'::regclass
  AND t.tgname = 'trg_p10_7_a1_4b_preserve_delivered_human_response_alert'
  AND NOT t.tgisinternal;

SELECT
  'a1_4b_migration_preflight'::text AS diagnostic,
  count(*) FILTER (
    WHERE q.notification_type = 'important_alert'
      AND q.context ->> 'reason' = 'human_response_pending'
      AND NULLIF(BTRIM(q.context ->> 'event_key'), '') IS NOT NULL
  )::bigint AS human_response_alert_rows,
  count(*) FILTER (
    WHERE q.notification_type = 'important_alert'
      AND q.context ->> 'reason' = 'human_response_pending'
      AND q.status IN ('sent', 'delivered', 'read')
  )::bigint AS delivered_rows,
  count(*) FILTER (
    WHERE q.notification_type <> 'important_alert'
       OR q.context ->> 'reason' IS DISTINCT FROM 'human_response_pending'
  )::bigint AS other_notification_rows
FROM public.store_assistant_notification_queue q;
