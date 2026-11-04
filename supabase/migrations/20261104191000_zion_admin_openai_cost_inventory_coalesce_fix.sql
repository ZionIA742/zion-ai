-- ZION-ADM — correcao pontual de COALESCE na RPC OpenAI.
-- Preserva contrato, SECURITY DEFINER, owner e privilegios.
-- Nao altera tabelas, operacoes, snapshots ou cron.
-- A migration original permanece inalterada.
-- ZION-ADM — leitura restrita do inventario financeiro OpenAI.
-- Nenhuma coleta, claim, preparacao ou escrita financeira.
-- Acesso exclusivo por RPC sistemica.
-- Mantem SELECT direto revogado para service_role.

BEGIN;

CREATE OR REPLACE FUNCTION
public.zion_admin_read_openai_cost_operations_by_identity_by_system(
    p_query_identity text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_rows jsonb;
    v_prefix constant text :=
        'openai_organization_costs:v1:';
BEGIN

    IF p_query_identity IS NULL
       OR pg_catalog.length(p_query_identity)
          NOT BETWEEN
          pg_catalog.length(v_prefix) + 1
          AND 4096
       OR p_query_identity IS DISTINCT FROM
          pg_catalog.btrim(p_query_identity)
       OR pg_catalog.left(
            p_query_identity,
            pg_catalog.length(v_prefix)
          ) <> v_prefix
    THEN
        RAISE EXCEPTION
            'OPENAI_COST_INVENTORY_IDENTITY_INVALID'
            USING ERRCODE = '22023';
    END IF;

    -- Retornar no maximo duas operacoes da mesma identidade.
    -- Duas linhas permitem ao aplicativo detectar duplicatas.
    --
    -- O token de claim e restrito a um marcador de presenca:
    -- o token financeiro real nunca sai desta RPC.

    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'id', o.id,
                'operation_key', o.operation_key,
                'provider', o.provider,
                'source', o.source,
                'query_identity', o.query_identity,
                'query_parameters', o.query_parameters,
                'state', o.state,
                'attempt_count', o.attempt_count,
                'max_attempts', o.max_attempts,
                'next_attempt_at', o.next_attempt_at,
                'period_start', o.period_start,
                'period_end', o.period_end,
                'claim_token',
                    CASE
                        WHEN o.claim_token IS NULL
                            THEN NULL
                        ELSE 'present'
                    END,
                'claim_expires_at', o.claim_expires_at,
                'snapshot_collection_id',
                    o.snapshot_collection_id,
                'confirmed_at', o.confirmed_at
            )
            ORDER BY o.created_at DESC, o.id DESC
        ),
        '[]'::jsonb
    )
    INTO v_rows
    FROM (
        SELECT
            t.id,
            t.operation_key,
            t.provider,
            t.source,
            t.query_identity,
            t.query_parameters,
            t.state,
            t.attempt_count,
            t.max_attempts,
            t.next_attempt_at,
            t.period_start,
            t.period_end,
            t.claim_token,
            t.claim_expires_at,
            t.snapshot_collection_id,
            t.confirmed_at,
            t.created_at
        FROM
            public.zion_admin_openai_cost_collection_operations t
        WHERE t.query_identity = p_query_identity
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT 2
    ) o;

    RETURN v_rows;
END;
$function$;

ALTER FUNCTION
public.zion_admin_read_openai_cost_operations_by_identity_by_system(text)
OWNER TO postgres;

REVOKE ALL ON FUNCTION
public.zion_admin_read_openai_cost_operations_by_identity_by_system(text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.zion_admin_read_openai_cost_operations_by_identity_by_system(text)
TO service_role;

COMMENT ON FUNCTION
public.zion_admin_read_openai_cost_operations_by_identity_by_system(text)
IS 'Leitura restrita por identidade financeira OpenAI. Sem SELECT direto ou mutacoes.';

COMMIT;