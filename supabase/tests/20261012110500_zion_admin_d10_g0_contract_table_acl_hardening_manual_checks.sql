-- ZION-ADM / D10-G0
-- Verificacao read-only das permissoes contratuais.
-- Executada no Supabase: 16 PASS / 0 FAIL.
-- Nao modifica dados, grants ou policies.
-- Espera-se que a migration de hardening ja tenha sido aplicada.

WITH contract_tables AS (
  SELECT
    c.oid,
    c.relname::text AS table_name,
    c.relacl,
    c.relowner
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n
    ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN (
      'store_contract_templates',
      'store_contract_template_versions',
      'store_contract_template_extracted_rules'
    )
),
roles AS (
  SELECT *
  FROM (VALUES
    ('anon', false),
    ('authenticated', false),
    ('service_role', true)
  ) AS r(role_name, allow_dml)
),
role_checks AS (
  SELECT
    'TABLE_ACCESS'::text AS category,
    t.table_name || ' / ' || r.role_name AS object_name,
    CASE
      WHEN r.allow_dml THEN
        has_table_privilege(r.role_name, t.oid, 'SELECT')
        AND has_table_privilege(r.role_name, t.oid, 'INSERT')
        AND has_table_privilege(r.role_name, t.oid, 'UPDATE')
        AND has_table_privilege(r.role_name, t.oid, 'DELETE')
      ELSE NOT (
        has_table_privilege(r.role_name, t.oid, 'SELECT')
        OR has_table_privilege(r.role_name, t.oid, 'INSERT')
        OR has_table_privilege(r.role_name, t.oid, 'UPDATE')
        OR has_table_privilege(r.role_name, t.oid, 'DELETE')
        OR has_table_privilege(r.role_name, t.oid, 'TRUNCATE')
        OR has_table_privilege(r.role_name, t.oid, 'REFERENCES')
        OR has_table_privilege(r.role_name, t.oid, 'TRIGGER')
      )
    END AS passed
  FROM contract_tables t
  CROSS JOIN roles r
),
public_checks AS (
  SELECT
    'PUBLIC_GRANT'::text AS category,
    t.table_name AS object_name,
    NOT EXISTS (
      SELECT 1
      FROM aclexplode(
        COALESCE(t.relacl, acldefault('r', t.relowner))
      ) a
      WHERE a.grantee = 0
    ) AS passed
  FROM contract_tables t
),
rpc_checks AS (
  SELECT
    'RPC_AUTHORITY'::text AS category,
    p.oid::regprocedure::text AS object_name,
    (
      p.prosecdef
      AND has_function_privilege(
        'service_role', p.oid, 'EXECUTE'
      )
      AND NOT has_function_privilege(
        'anon', p.oid, 'EXECUTE'
      )
      AND NOT has_function_privilege(
        'authenticated', p.oid, 'EXECUTE'
      )
    ) AS passed
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n
    ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'activate_store_contract_template_version_by_system',
      'replace_store_contract_template_rules_by_system'
    )
),
object_checks AS (
  SELECT
    'OBJECT_COUNT'::text AS category,
    'three_contract_tables'::text AS object_name,
    (SELECT count(*) = 3 FROM contract_tables) AS passed

  UNION ALL

  SELECT
    'OBJECT_COUNT',
    'two_contract_rpcs',
    (SELECT count(*) = 2 FROM rpc_checks)
),
checks AS (
  SELECT * FROM role_checks
  UNION ALL
  SELECT * FROM public_checks
  UNION ALL
  SELECT * FROM rpc_checks
  UNION ALL
  SELECT * FROM object_checks
)
SELECT
  category,
  object_name,
  CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,
  count(*) FILTER (WHERE NOT passed) OVER () AS total_failures,
  count(*) OVER () AS total_checks
FROM checks
ORDER BY category, object_name;