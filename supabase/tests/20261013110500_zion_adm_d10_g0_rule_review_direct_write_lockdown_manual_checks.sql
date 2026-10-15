-- ZION-ADM / D10-G0
-- Direct-write lockdown: post-deployment checks.
--
-- READ ONLY.
-- Run ONLY after the review authority, compatible API
-- and lockdown migration have been deployed.
--
-- The earlier ACL migration deliberately allowed DML
-- to service_role. This later migration removes it.
-- Do not modify or re-run earlier ACL expectations
-- as the final-state validation.

WITH target AS (
  SELECT
    to_regclass(
      'public.store_contract_template_extracted_rules'
    ) AS relation_oid
),
rpcs AS (
  SELECT
    'extraction'::text AS rpc_name,
    to_regprocedure(
      'public.replace_store_contract_template_rules_by_system(uuid,uuid,uuid,jsonb,uuid)'
    ) AS rpc_oid

  UNION ALL

  SELECT
    'review'::text AS rpc_name,
    to_regprocedure(
      'public.review_store_contract_template_rule_by_system(uuid,uuid,uuid,uuid,bigint,uuid,text,text,text)'
    ) AS rpc_oid
),
checks AS (
  -- Table exists.
  SELECT
    'OBJECT'::text AS category,
    'rules_table_exists'::text AS check_name,
    relation_oid IS NOT NULL AS passed
  FROM target

  UNION ALL

  -- Backend retains SELECT.
  SELECT
    'READ',
    'service_role_select',
    COALESCE(
      has_table_privilege(
        'service_role',
        relation_oid,
        'SELECT'
      ),
      false
    )
  FROM target

  UNION ALL

  -- Backend must have no effective direct write grants.
  SELECT
    'LOCKDOWN',
    'service_role_' || lower(p.privilege),
    t.relation_oid IS NOT NULL
      AND NOT COALESCE(
        has_table_privilege(
          'service_role',
          t.relation_oid,
          p.privilege
        ),
        true
      )
  FROM target t
  CROSS JOIN (
    VALUES
      ('INSERT'),
      ('UPDATE'),
      ('DELETE'),
      ('TRUNCATE'),
      ('REFERENCES'),
      ('TRIGGER')
  ) AS p(privilege)

  UNION ALL

  -- Anon and authenticated remain blocked.
  SELECT
    'TENANT_ACCESS',
    r.role_name || '_' || lower(p.privilege),
    t.relation_oid IS NOT NULL
      AND NOT COALESCE(
        has_table_privilege(
          r.role_name,
          t.relation_oid,
          p.privilege
        ),
        true
      )
  FROM target t
  CROSS JOIN (
    VALUES
      ('anon'),
      ('authenticated')
  ) AS r(role_name)
  CROSS JOIN (
    VALUES
      ('SELECT'),
      ('INSERT'),
      ('UPDATE'),
      ('DELETE'),
      ('TRUNCATE'),
      ('REFERENCES'),
      ('TRIGGER')
  ) AS p(privilege)

  UNION ALL

  -- PUBLIC must have no explicit table grants.
  SELECT
    'PUBLIC',
    'no_public_table_grants',
    t.relation_oid IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class c
        CROSS JOIN LATERAL aclexplode(
          COALESCE(
            c.relacl,
            acldefault('r', c.relowner)
          )
        ) acl
        WHERE c.oid = t.relation_oid
          AND acl.grantee = 0
      )
  FROM target t

  UNION ALL

  -- Both writing authorities must exist.
  SELECT
    'RPC',
    r.rpc_name || '_exists',
    r.rpc_oid IS NOT NULL
  FROM rpcs r

  UNION ALL

  -- Both must remain SECURITY DEFINER.
  SELECT
    'RPC',
    r.rpc_name || '_security_definer',
    COALESCE(
      (
        SELECT p.prosecdef
        FROM pg_catalog.pg_proc p
        WHERE p.oid = r.rpc_oid
      ),
      false
    )
  FROM rpcs r

  UNION ALL

  -- Both authorities must be owned by postgres.
  SELECT
    'RPC',
    r.rpc_name || '_owner_postgres',
    COALESCE(
      (
        SELECT
          pg_catalog.pg_get_userbyid(p.proowner)
            = 'postgres'
        FROM pg_catalog.pg_proc p
        WHERE p.oid = r.rpc_oid
      ),
      false
    )
  FROM rpcs r

  UNION ALL

  -- Both RPCs must use the hardened search_path.
  SELECT
    'RPC',
    r.rpc_name || '_search_path',
    COALESCE(
      (
        SELECT EXISTS (
          SELECT 1
          FROM unnest(p.proconfig) AS cfg(setting)
          WHERE regexp_replace(
            cfg.setting,
            '[[:space:]]+',
            '',
            'g'
          ) = 'search_path=pg_catalog,public'
        )
        FROM pg_catalog.pg_proc p
        WHERE p.oid = r.rpc_oid
      ),
      false
    )
  FROM rpcs r

  UNION ALL

  -- service_role must be able to execute both RPCs.
  SELECT
    'RPC',
    r.rpc_name || '_service_role_execute',
    COALESCE(
      has_function_privilege(
        'service_role',
        r.rpc_oid,
        'EXECUTE'
      ),
      false
    )
  FROM rpcs r

  UNION ALL

  -- Neither anon nor authenticated may execute RPCs.
  SELECT
    'RPC_ACCESS',
    r.rpc_name || '_' || x.role_name || '_blocked',
    r.rpc_oid IS NOT NULL
      AND NOT COALESCE(
        has_function_privilege(
          x.role_name,
          r.rpc_oid,
          'EXECUTE'
        ),
        true
      )
  FROM rpcs r
  CROSS JOIN (
    VALUES
      ('anon'),
      ('authenticated')
  ) AS x(role_name)
),
check_count AS (
  SELECT count(*)::bigint AS observed
  FROM checks
)
SELECT
  c.category,
  c.check_name,
  CASE
    WHEN cc.observed = 37 AND c.passed IS TRUE
      THEN 'PASS'
    ELSE 'FAIL'
  END AS result,
  COUNT(*) FILTER (
    WHERE c.passed IS DISTINCT FROM true
       OR cc.observed <> 37
  ) OVER () AS total_failures,
  cc.observed AS total_checks
FROM checks c
CROSS JOIN check_count cc
ORDER BY c.category, c.check_name;
