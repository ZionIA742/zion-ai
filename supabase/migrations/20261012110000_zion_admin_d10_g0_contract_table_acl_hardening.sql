-- ZION-ADM / D10-G0
-- Restricao de acesso direto as tabelas contratuais.
--
-- Acesso legitimo:
-- Usuario autorizado -> API do ZION -> service_role.
--
-- Bloqueia acesso direto de PUBLIC, anon e authenticated.
-- Nao modifica RLS, RPCs, triggers ou regras comerciais.
--
-- Correcao ja executada manualmente no banco de producao.
-- Esta migration registra a alteracao de forma idempotente.

BEGIN;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'public.store_contract_templates',
    'public.store_contract_template_versions',
    'public.store_contract_template_extracted_rules'
  ]
  LOOP
    IF to_regclass(v_table) IS NULL THEN
      RAISE EXCEPTION
        'D10_G0_MISSING_CONTRACT_TABLE: %',
        v_table;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL PRIVILEGES
ON TABLE
  public.store_contract_templates,
  public.store_contract_template_versions,
  public.store_contract_template_extracted_rules
FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_table text;
  v_role text;
  v_privilege text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'public.store_contract_templates',
    'public.store_contract_template_versions',
    'public.store_contract_template_extracted_rules'
  ]
  LOOP

    FOREACH v_role IN ARRAY ARRAY[
      'anon',
      'authenticated'
    ]
    LOOP
      FOREACH v_privilege IN ARRAY ARRAY[
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER'
      ]
      LOOP
        IF has_table_privilege(
          v_role,
          v_table,
          v_privilege
        ) THEN
          RAISE EXCEPTION
            'D10_G0_UNAUTHORIZED_GRANT: %.%.%',
            v_role,
            v_table,
            v_privilege;
        END IF;
      END LOOP;
    END LOOP;

    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE'
    ]
    LOOP
      IF NOT has_table_privilege(
        'service_role',
        v_table,
        v_privilege
      ) THEN
        RAISE EXCEPTION
          'D10_G0_SERVICE_ROLE_GRANT_MISSING: %.%',
          v_table,
          v_privilege;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class c
      CROSS JOIN LATERAL aclexplode(
        COALESCE(
          c.relacl,
          acldefault('r', c.relowner)
        )
      ) acl
      WHERE c.oid = to_regclass(v_table)
        AND acl.grantee = 0
    ) THEN
      RAISE EXCEPTION
        'D10_G0_PUBLIC_GRANT_REMAINS: %',
        v_table;
    END IF;

  END LOOP;
END;
$$;

COMMIT;