-- ZION-ADM | BLOCO 1 | ETAPA 2.3-C.1-A
-- Pre-validacao transacional do fechamento definitivo.
--
-- NAO cria fechamento financeiro.
-- NAO cria registros de auditoria financeira.
-- NAO altera pre-fechamentos.
-- NAO comprova faturamento Meta.
-- NAO aceita authorityKey fornecida pela aplicacao.
-- NAO habilita fechamento automatico.
--
-- A RPC futura de gravacao devera verificar as fontes
-- financeiras independentemente e executar todas as
-- gravacoes na mesma transacao.
--
-- Este preflight permanece fail-closed enquanto
-- nao existir a autoridade financeira completa.

BEGIN;

CREATE FUNCTION public.zion_admin_monthly_final_close_preflight_by_system(
    p_month date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_preclosure public.zion_admin_monthly_preclosures%ROWTYPE;
    v_audit public.zion_admin_monthly_preclosure_audit%ROWTYPE;

    v_blockers text[] := ARRAY[
        'source_authority_unverified',
        'meta_financial_authority_unverified'
    ]::text[];
BEGIN
    -- Somente backend autorizado.
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_PREFLIGHT_UNAUTHORIZED';
    END IF;

    -- Competencia mensal canonica.
    IF p_month IS NULL
       OR p_month < DATE '2020-01-01'
       OR p_month > DATE '2100-12-01'
       OR p_month <> pg_catalog.date_trunc(
           'month',
           p_month::timestamp
       )::date
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_PREFLIGHT_INVALID_MONTH';
    END IF;

    -- Mesmo bloqueio utilizado pelo writer do pre-fechamento.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('zion_admin_monthly_preclosure'),
        pg_catalog.hashtext(p_month::text)
    );

    -- Nenhuma revisao de fechamento pode se basear
    -- em pre-fechamento alterado durante a verificacao.
    SELECT *
    INTO v_preclosure
    FROM public.zion_admin_monthly_preclosures
    WHERE month = p_month
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_PREFLIGHT_PRECLOSURE_MISSING';
    END IF;

    -- Conferir a revisao corrente contra o historico.
    SELECT *
    INTO v_audit
    FROM public.zion_admin_monthly_preclosure_audit
    WHERE month = p_month
      AND revision = v_preclosure.revision;

    IF NOT FOUND
       OR v_audit.source_snapshot IS DISTINCT FROM
          v_preclosure.source_snapshot
       OR v_audit.pending_sources IS DISTINCT FROM
          v_preclosure.pending_sources
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_PREFLIGHT_REVISION_MISMATCH';
    END IF;

    -- Estrutura do snapshot preliminar.
    IF v_preclosure.source_snapshot ->> 'financial_status'
          IS DISTINCT FROM 'preliminary'
       OR pg_catalog.jsonb_typeof(
           v_preclosure.source_snapshot -> 'sources'
       ) IS DISTINCT FROM 'object'
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_PREFLIGHT_INVALID_SNAPSHOT';
    END IF;

    -- Detectar fechamento ja registrado.
    IF EXISTS (
        SELECT 1
        FROM public.zion_admin_monthly_final_closures
        WHERE month = p_month
    ) THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_PREFLIGHT_ALREADY_FINALIZED';
    END IF;

    -- Nunca ignorar pendencias existentes.
    IF pg_catalog.cardinality(
        v_preclosure.pending_sources
    ) > 0 THEN
        v_blockers := pg_catalog.array_append(
            v_blockers,
            'preclosure_pending_sources'
        );
    END IF;

    -- Nao existe ainda uma autoridade financeira
    -- Meta instalada que autorize o fechamento.
    --
    -- Mesmo com pending_sources vazio, esta RPC
    -- nunca retorna elegibilidade verdadeira.
    --
    -- A futura etapa devera adicionar verificadores
    -- independentes de fontes financeiras reais.

    RETURN pg_catalog.jsonb_build_object(
        'ok', false,
        'status', 'blocked',
        'eligible', false,
        'month', p_month,
        'preclosure_revision', v_preclosure.revision,
        'pending_sources', v_preclosure.pending_sources,
        'blockers', v_blockers
    );
END;
$function$;

-- Nenhuma chamada publica ou de usuario autenticado.

REVOKE ALL ON FUNCTION
    public.zion_admin_monthly_final_close_preflight_by_system(date)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.zion_admin_monthly_final_close_preflight_by_system(date)
TO service_role;

COMMIT;