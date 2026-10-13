-- ZION / P9 / Bloco 9 / Etapa 9.3-B
-- Runner 20261013150500 - Fundacao de aprovacoes comerciais
-- SOMENTE LEITURA: executar uma unica vez no Supabase SQL Editor.
-- Retorna um unico result set, mesmo em clientes que mostram apenas a ultima consulta.
-- Nao cria, altera ou exclui registros, tabelas ou privilegios.

WITH
 target AS (
   SELECT to_regclass('public.p9_responsible_commercial_approval_requests') AS table_oid
 ),
 expected_columns (column_name, data_type, is_nullable) AS (
   VALUES
     ('id', 'uuid', 'NO'),
     ('organization_id', 'uuid', 'NO'),
     ('store_id', 'uuid', 'NO'),
     ('responsible_id', 'uuid', 'NO'),
     ('commercial_opportunity_id', 'uuid', 'NO'),
     ('lifecycle_cycle', 'integer', 'NO'),
     ('request_kind', 'text', 'NO'),
     ('request_key', 'text', 'NO'),
     ('quote_id', 'uuid', 'NO'),
     ('quote_version_id', 'uuid', 'NO'),
     ('proposal_acceptance_event_id', 'uuid', 'YES'),
     ('contract_template_id', 'uuid', 'YES'),
     ('contract_template_version_id', 'uuid', 'YES'),
     ('report_snapshot', 'jsonb', 'NO'),
     ('status', 'text', 'NO'),
     ('outbound_notification_id', 'uuid', 'YES'),
     ('outbound_external_message_id', 'text', 'YES'),
     ('decision_inbound_message_id', 'uuid', 'YES'),
     ('decision_external_message_id', 'text', 'YES'),
     ('decision_text', 'text', 'YES'),
     ('decided_at', 'timestamp with time zone', 'YES'),
     ('customer_outbound_message_id', 'uuid', 'YES'),
     ('fulfilled_at', 'timestamp with time zone', 'YES'),
     ('invalidated_at', 'timestamp with time zone', 'YES'),
     ('invalidated_reason', 'text', 'YES'),
     ('created_at', 'timestamp with time zone', 'NO'),
     ('updated_at', 'timestamp with time zone', 'NO')
 ),
 expected_foreign_keys (constraint_name) AS (
   VALUES
     ('p9_commercial_approval_opportunity_fk'),
     ('p9_commercial_approval_quote_fk'),
     ('p9_commercial_approval_quote_version_fk'),
     ('p9_commercial_approval_acceptance_fk'),
     ('p9_commercial_approval_template_fk'),
     ('p9_commercial_approval_template_version_fk'),
     ('p9_commercial_approval_notification_fk'),
     ('p9_commercial_approval_responsible_message_fk')
 ),
 expected_checks (constraint_name) AS (
   VALUES
     ('p9_commercial_approval_document_kind_ck'),
     ('p9_commercial_approval_decision_evidence_ck'),
     ('p9_commercial_approval_fulfillment_ck')
 ),
 expected_indexes (index_name, must_be_unique) AS (
   VALUES
     ('p9_commercial_approval_request_key_uidx', true),
     ('p9_commercial_approval_one_active_per_kind_uidx', true),
     ('p9_commercial_approval_notification_uidx', true),
     ('p9_commercial_approval_inbound_decision_uidx', true),
     ('p9_commercial_approval_external_decision_uidx', true),
     ('p9_commercial_approval_outbound_external_uidx', true),
     ('p9_commercial_approval_pending_idx', false)
 ),
 checks AS (
   SELECT 1 AS ordem, 'tabela_existe' AS teste,
          (SELECT table_oid IS NOT NULL FROM target) AS passou,
          'Tabela canônica criada' AS detalhe
   UNION ALL
   SELECT 2, 'colunas_e_tipos',
          NOT EXISTS (
            SELECT 1 FROM expected_columns e
            LEFT JOIN information_schema.columns c
              ON c.table_schema = 'public'
             AND c.table_name = 'p9_responsible_commercial_approval_requests'
             AND c.column_name = e.column_name
            WHERE c.column_name IS NULL
               OR c.data_type <> e.data_type
               OR c.is_nullable <> e.is_nullable
          ),
          '27 colunas essenciais, tipos e nulidade'
   UNION ALL
   SELECT 3, 'isolamento_rls_habilitado',
          COALESCE((SELECT cls.relrowsecurity FROM pg_class cls
                    JOIN target t ON cls.oid = t.table_oid), false),
          'Row Level Security habilitado'
   UNION ALL
   SELECT 4, 'anon_authenticated_sem_acesso_direto',
          COALESCE((SELECT NOT (
            has_table_privilege('anon', t.table_oid, 'SELECT, INSERT, UPDATE, DELETE')
            OR has_table_privilege('authenticated', t.table_oid, 'SELECT, INSERT, UPDATE, DELETE')
          ) FROM target t), false),
          'Nenhuma permissao direta a anon/authenticated'
   UNION ALL
   SELECT 5, 'service_role_permissoes_por_etapa',
          COALESCE((SELECT
            has_table_privilege('service_role', t.table_oid, 'SELECT')
            AND NOT has_table_privilege('service_role', t.table_oid, 'DELETE')
            AND CASE
              WHEN to_regprocedure(
                'public.p9_request_quote_send_approval_by_system(uuid,uuid,uuid,uuid,integer,uuid,uuid,jsonb)'
              ) IS NULL THEN
                has_table_privilege('service_role', t.table_oid, 'INSERT')
                AND has_table_privilege('service_role', t.table_oid, 'UPDATE')
              ELSE
                NOT has_table_privilege('service_role', t.table_oid, 'INSERT')
                AND NOT has_table_privilege('service_role', t.table_oid, 'UPDATE')
            END
          FROM target t), false),
          'Fundacao: escrita da service_role; apos writer: escrita direta bloqueada'
   UNION ALL
   SELECT 6, 'oito_chaves_estrangeiras',
          NOT EXISTS (
            SELECT 1 FROM expected_foreign_keys e
            WHERE NOT EXISTS (
              SELECT 1 FROM pg_constraint c, target t
              WHERE c.conrelid = t.table_oid
                AND c.contype = 'f'
                AND c.conname = e.constraint_name
            )
          ),
          'Referencias aos registros de origem presentes'
   UNION ALL
   SELECT 7, 'checks_de_estado_e_evidencia',
          NOT EXISTS (
            SELECT 1 FROM expected_checks e
            WHERE NOT EXISTS (
              SELECT 1 FROM pg_constraint c, target t
              WHERE c.conrelid = t.table_oid
                AND c.contype = 'c'
                AND c.conname = e.constraint_name
            )
          ),
          'Contrato, decisao e finalizacao possuem restricoes'
   UNION ALL
   SELECT 8, 'indices_de_unicidade_e_consulta',
          NOT EXISTS (
            SELECT 1 FROM expected_indexes e
            WHERE NOT EXISTS (
              SELECT 1 FROM pg_index i
              JOIN pg_class idx ON idx.oid = i.indexrelid
              JOIN target t ON t.table_oid = i.indrelid
              WHERE idx.relname = e.index_name
                AND (NOT e.must_be_unique OR i.indisunique)
            )
          ),
          'Todos os sete indices esperados presentes'
   UNION ALL
   SELECT 9, 'indice_unico_aprovacao_ativa',
          EXISTS (
            SELECT 1 FROM pg_index i
            JOIN pg_class idx ON idx.oid = i.indexrelid
            JOIN target t ON t.table_oid = i.indrelid
            WHERE idx.relname = 'p9_commercial_approval_one_active_per_kind_uidx'
              AND i.indisunique
              AND i.indpred IS NOT NULL
          ),
          'Uma solicitacao ativa por loja/oportunidade/tipo'
 )
SELECT ordem, teste,
       CASE WHEN passou THEN 'PASS' ELSE 'FAIL' END AS resultado,
       detalhe
FROM checks
ORDER BY ordem;
