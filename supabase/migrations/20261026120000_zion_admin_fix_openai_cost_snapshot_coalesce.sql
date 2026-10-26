-- ZION-ADM 8-C.2
-- Correcao pontual de COALESCE na RPC OpenAI
-- Migration: 20261026120000_zion_admin_fix_openai_cost_snapshot_coalesce.sql
-- Nao altera despesas ou tabelas.

BEGIN;

DO $zion_fix$
DECLARE
    v_oid oid;
    v_original text;
    v_corrigido text;
    v_ocorrencias integer;
BEGIN
    v_oid := pg_catalog.to_regprocedure(
        'public.zion_admin_write_openai_provider_cost_snapshot(jsonb,jsonb)'
    );

    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'ZION_OPENAI_RPC_NOT_FOUND';
    END IF;

    -- Confirmar a configuracao de seguranca existente.

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        WHERE p.oid = v_oid
          AND p.prosecdef = true
          AND 'search_path=""' = ANY(p.proconfig)
    ) THEN
        RAISE EXCEPTION
            'ZION_OPENAI_RPC_SECURITY_UNEXPECTED';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_oid)
    INTO v_original;

    -- Exigir exatamente as duas ocorrencias
    -- identificadas na migration anterior.

    v_ocorrencias := (
        length(v_original)
        - length(
            replace(
                v_original,
                'pg_catalog.coalesce(',
                ''
            )
        )
    ) / length('pg_catalog.coalesce(');

    IF v_ocorrencias <> 2 THEN
        RAISE EXCEPTION
            'ZION_OPENAI_UNEXPECTED_COALESCE_COUNT: %',
            v_ocorrencias;
    END IF;

    -- Corrigir somente a expressao incorreta.

    v_corrigido := replace(
        v_original,
        'pg_catalog.coalesce(',
        'COALESCE('
    );

    -- Recriar a mesma funcao com o corpo corrigido.
    -- Nenhum snapshot e gravado aqui.

    EXECUTE v_corrigido;

    -- Confirmar que a correcao permaneceu aplicada.

    IF position(
        'pg_catalog.coalesce(' IN
        pg_catalog.pg_get_functiondef(v_oid)
    ) > 0 THEN
        RAISE EXCEPTION
            'ZION_OPENAI_COALESCE_FIX_FAILED';
    END IF;

    -- Preservar seguranca e privilegios.

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        WHERE p.oid = v_oid
          AND p.prosecdef = true
          AND 'search_path=""' = ANY(p.proconfig)
    )
    OR NOT pg_catalog.has_function_privilege(
        'service_role', v_oid, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
        'anon', v_oid, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
        'authenticated', v_oid, 'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'ZION_OPENAI_RPC_SECURITY_CHANGED';
    END IF;

    RAISE NOTICE
        'ZION_OPENAI_COALESCE_FIXED: % occurrences',
        v_ocorrencias;
END;
$zion_fix$;

COMMIT;

-- Verificacao final somente leitura.

SELECT
    CASE
        WHEN position(
            'pg_catalog.coalesce(' IN
            pg_catalog.pg_get_functiondef(
                pg_catalog.to_regprocedure(
                    'public.zion_admin_write_openai_provider_cost_snapshot(jsonb,jsonb)'
                )
            )
        ) = 0
        THEN 'PASS'
        ELSE 'FAIL'
    END AS correcao_coalesce,

    (
        SELECT count(*)
        FROM public.zion_admin_provider_cost_collections
        WHERE collection_key IN (
            'openai_organization_costs:v1:zion_adm_8c2_rollback_A_20261026',
            'openai_organization_costs:v1:zion_adm_8c2_rollback_B_20261026'
        )
    ) AS colecoes_ficticias_restantes;
