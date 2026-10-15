-- ZION-ADM / D10-G0
-- Bloqueio definitivo de escrita direta em regras contratuais.
--
-- APLICAR SOMENTE APOS:
-- 1. Instalacao e validacao da RPC de revisao.
-- 2. Publicacao da API D10-G1 compativel.
-- 3. Validacao operacional dos fluxos contratuais.
--
-- Nao executar antecipadamente em producao.

BEGIN;

-- Garantir autoridade deterministica da RPC de extracao.
-- Executado na mesma transacao do lockdown.
ALTER FUNCTION public.replace_store_contract_template_rules_by_system(
  uuid, uuid, uuid, jsonb, uuid
) OWNER TO postgres;

-- Built-in functions resolve through pg_catalog first.
-- Existing contract tables remain explicitly schema-qualified.
ALTER FUNCTION public.replace_store_contract_template_rules_by_system(
  uuid, uuid, uuid, jsonb, uuid
) SET search_path TO pg_catalog, public;

DO $$
DECLARE
  v_signature text;
  v_rpc_oid oid;
BEGIN
  IF to_regclass(
    'public.store_contract_template_extracted_rules'
  ) IS NULL THEN
    RAISE EXCEPTION
      'ZION_ADM_RULE_LOCKDOWN_TABLE_MISSING';
  END IF;

  -- O backend deve conservar acesso de leitura.
  IF NOT has_table_privilege(
    'service_role',
    'public.store_contract_template_extracted_rules',
    'SELECT'
  ) THEN
    RAISE EXCEPTION
      'ZION_ADM_RULE_LOCKDOWN_SERVICE_READ_MISSING';
  END IF;

  -- As duas autoridades de escrita precisam existir,
  -- ser SECURITY DEFINER e pertencer a postgres.
  FOREACH v_signature IN ARRAY ARRAY[
    'public.replace_store_contract_template_rules_by_system(uuid,uuid,uuid,jsonb,uuid)',
    'public.review_store_contract_template_rule_by_system(uuid,uuid,uuid,uuid,bigint,uuid,text,text,text)'
  ]
  LOOP
    v_rpc_oid := to_regprocedure(v_signature);

    IF v_rpc_oid IS NULL THEN
      RAISE EXCEPTION
        'ZION_ADM_RULE_LOCKDOWN_RPC_MISSING: %',
        v_signature;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc p
      WHERE p.oid = v_rpc_oid
        AND p.prosecdef = true
        AND pg_catalog.pg_get_userbyid(p.proowner)
          = 'postgres'
    ) THEN
      RAISE EXCEPTION
        'ZION_ADM_RULE_LOCKDOWN_RPC_AUTHORITY_INVALID: %',
        v_signature;
    END IF;

    IF NOT has_function_privilege(
      'service_role', v_rpc_oid, 'EXECUTE'
    ) OR has_function_privilege(
      'anon', v_rpc_oid, 'EXECUTE'
    ) OR has_function_privilege(
      'authenticated', v_rpc_oid, 'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        'ZION_ADM_RULE_LOCKDOWN_RPC_GRANTS_INVALID: %',
        v_signature;
    END IF;
  END LOOP;
END;
$$;

-- Mantem SELECT para os leitores autorizados.
-- Remove escrita direta da role do backend.
-- As RPCs continuam operando com autoridade postgres.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE,
       REFERENCES, TRIGGER
ON TABLE public.store_contract_template_extracted_rules
FROM service_role;

DO $$
DECLARE
  v_privilege text;
BEGIN
  IF NOT has_table_privilege(
    'service_role',
    'public.store_contract_template_extracted_rules',
    'SELECT'
  ) THEN
    RAISE EXCEPTION
      'ZION_ADM_RULE_LOCKDOWN_READ_LOST';
  END IF;

  FOREACH v_privilege IN ARRAY ARRAY[
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'REFERENCES',
    'TRIGGER'
  ]
  LOOP
    IF has_table_privilege(
      'service_role',
      'public.store_contract_template_extracted_rules',
      v_privilege
    ) THEN
      RAISE EXCEPTION
        'ZION_ADM_RULE_LOCKDOWN_PRIVILEGE_REMAINS: %',
        v_privilege;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
