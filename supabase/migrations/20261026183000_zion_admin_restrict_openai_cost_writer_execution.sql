-- ZION-ADM 8-C.4-B.6-D
-- Restringir execucao direta do writer financeiro OpenAI.
-- Migration:
-- 20261026183000_zion_admin_restrict_openai_cost_writer_execution.sql
--
-- Preserva a chamada interna pelo finalizador.
-- Nao altera funcoes existentes.
-- Nao altera tabelas.
-- Nao cria snapshots.
-- Nao ativa cron ou coleta.

BEGIN;

-- 1. Verificar se o finalizador e o writer
-- utilizam o mesmo proprietario privilegiado.

DO $guard$
DECLARE
    v_writer oid;
    v_finalize oid;

    v_writer_owner oid;
    v_finalize_owner oid;

    v_writer_definer boolean;
    v_finalize_definer boolean;
BEGIN

    v_writer := pg_catalog.to_regprocedure(
      'public.zion_admin_write_openai_provider_cost_snapshot(jsonb,jsonb)'
    );

    v_finalize := pg_catalog.to_regprocedure(
      'public.zion_admin_finalize_openai_cost_collection_operation_by_system(uuid,uuid,jsonb,jsonb)'
    );

    IF v_writer IS NULL OR v_finalize IS NULL THEN
        RAISE EXCEPTION
          'OPENAI_COST_WRITER_RESTRICTION_MISSING_RPC';
    END IF;

    SELECT p.proowner, p.prosecdef
    INTO v_writer_owner, v_writer_definer
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_writer;

    SELECT p.proowner, p.prosecdef
    INTO v_finalize_owner, v_finalize_definer
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_finalize;

    IF v_writer_owner IS DISTINCT FROM v_finalize_owner
       OR v_writer_definer IS DISTINCT FROM true
       OR v_finalize_definer IS DISTINCT FROM true
       OR NOT pg_catalog.has_function_privilege(
           'service_role', v_finalize, 'EXECUTE'
       )
    THEN
        RAISE EXCEPTION
          'OPENAI_COST_WRITER_RESTRICTION_UNSAFE_DEPENDENCY';
    END IF;

END;
$guard$;

-- 2. Remover execucao direta por papeis externos.
--
-- O finalizador SECURITY DEFINER permanece
-- autorizado a chamar o writer internamente
-- sob o proprietario compartilhado.
--
-- Nenhuma permissao nova e concedida.

REVOKE EXECUTE ON FUNCTION
public.zion_admin_write_openai_provider_cost_snapshot(
    jsonb, jsonb
)
FROM PUBLIC, anon, authenticated, service_role;

-- 3. Falhar e reverter a transacao caso
-- alguma permissao efetiva continue aberta.

DO $guard$
DECLARE
    v_writer oid;
    v_finalize oid;
    v_owner name;
BEGIN

    v_writer := pg_catalog.to_regprocedure(
      'public.zion_admin_write_openai_provider_cost_snapshot(jsonb,jsonb)'
    );

    v_finalize := pg_catalog.to_regprocedure(
      'public.zion_admin_finalize_openai_cost_collection_operation_by_system(uuid,uuid,jsonb,jsonb)'
    );

    SELECT pg_catalog.pg_get_userbyid(p.proowner)
    INTO v_owner
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_writer;

    IF pg_catalog.has_function_privilege(
         'service_role', v_writer, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         'anon', v_writer, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         'authenticated', v_writer, 'EXECUTE'
       )
       OR NOT pg_catalog.has_function_privilege(
         v_owner::text, v_writer, 'EXECUTE'
       )
       OR NOT pg_catalog.has_function_privilege(
         'service_role', v_finalize, 'EXECUTE'
       )
    THEN
        RAISE EXCEPTION
          'OPENAI_COST_WRITER_RESTRICTION_VERIFICATION_FAILED';
    END IF;

END;
$guard$;

COMMIT;

-- 4. Diagnostico de instalacao.
-- SOMENTE LEITURA.

WITH rpc AS (
    SELECT
        pg_catalog.to_regprocedure(
          'public.zion_admin_write_openai_provider_cost_snapshot(jsonb,jsonb)'
        ) AS writer,
        pg_catalog.to_regprocedure(
          'public.zion_admin_finalize_openai_cost_collection_operation_by_system(uuid,uuid,jsonb,jsonb)'
        ) AS finalize
),
checks AS (

    SELECT
        '01_writer_existe' AS verificacao,
        writer IS NOT NULL AS passou
    FROM rpc

    UNION ALL

    SELECT
        '02_service_role_writer_bloqueado',
        writer IS NOT NULL
        AND NOT pg_catalog.has_function_privilege(
            'service_role', writer, 'EXECUTE'
        )
    FROM rpc

    UNION ALL

    SELECT
        '03_anon_writer_bloqueado',
        writer IS NOT NULL
        AND NOT pg_catalog.has_function_privilege(
            'anon', writer, 'EXECUTE'
        )
    FROM rpc

    UNION ALL

    SELECT
        '04_authenticated_writer_bloqueado',
        writer IS NOT NULL
        AND NOT pg_catalog.has_function_privilege(
            'authenticated', writer, 'EXECUTE'
        )
    FROM rpc

    UNION ALL

    SELECT
        '05_finalizador_service_role_preservado',
        finalize IS NOT NULL
        AND pg_catalog.has_function_privilege(
            'service_role', finalize, 'EXECUTE'
        )
    FROM rpc

    UNION ALL

    SELECT
        '06_proprietario_compartilhado',
        EXISTS (
            SELECT 1
            FROM rpc r
            JOIN pg_catalog.pg_proc w
              ON w.oid = r.writer
            JOIN pg_catalog.pg_proc f
              ON f.oid = r.finalize
            WHERE w.proowner = f.proowner
              AND w.prosecdef
              AND f.prosecdef
        )

    UNION ALL

    SELECT
        '07_operacoes_preservadas',
        NOT EXISTS (
            SELECT 1
            FROM public.zion_admin_openai_cost_collection_operations
        )

    UNION ALL

    SELECT
        '08_eventos_preservados',
        NOT EXISTS (
            SELECT 1
            FROM public.zion_admin_openai_cost_collection_operation_events
        )

    UNION ALL

    SELECT
        '09_snapshots_openai_preservados',
        NOT EXISTS (
            SELECT 1
            FROM public.zion_admin_provider_cost_collections
            WHERE provider = 'openai'
              AND source = 'openai_organization_costs'
        )
)

SELECT
    verificacao,
    CASE
        WHEN passou THEN 'PASS'
        ELSE 'FAIL'
    END AS resultado
FROM checks
ORDER BY verificacao;
