-- ZION-ADM / 8-E.11-D.3-C.3-A
-- Registro de verificacao financeira MANUAL.
--
-- Nao verifica os bytes do Storage: a rota autenticada
-- devera realizar essa verificacao antes da RPC.
-- O banco revalida todas as autoridades que controla.
--
-- Nao cria fechamento, nao reconcilia fornecedores
-- e nao aprova automaticamente uploads.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
    IF pg_catalog.to_regprocedure(
        'public.zion_admin_verify_monthly_final_evidence_by_system(bigint,date,integer,text,text,bigint,numeric,uuid,boolean)'
    ) IS NOT NULL THEN
        RAISE EXCEPTION
            'ZION_ADMIN_EVIDENCE_VERIFIER_ALREADY_EXISTS';
    END IF;
END;
$preflight$;

CREATE FUNCTION
public.zion_admin_verify_monthly_final_evidence_by_system(
    p_upload_id bigint,
    p_month date,
    p_preclosure_revision integer,
    p_source text,
    p_proof_type text,
    p_amount_brl_cents bigint,
    p_amount_usd numeric,
    p_verified_by_user_id uuid,
    p_manual_review_confirmed boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_upload public.zion_admin_financial_evidence_uploads%ROWTYPE;
    v_existing public.zion_admin_monthly_final_evidence%ROWTYPE;
    v_revision integer;
    v_actor_id uuid;
    v_object_id uuid;
    v_metadata jsonb;
    v_size_text text;
    v_evidence_id bigint;
    v_verified_at timestamptz;
BEGIN
    -- Somente backend privilegiado.
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_ADMIN_EVIDENCE_SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    -- Um booleano nao substitui a autenticacao.
    -- A rota devera comprovar a acao humana explicita.
    IF p_manual_review_confirmed IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION
            'ZION_ADMIN_EVIDENCE_MANUAL_REVIEW_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_upload_id IS NULL OR p_upload_id < 1
       OR p_month IS NULL
       OR EXTRACT(DAY FROM p_month) <> 1
       OR p_preclosure_revision IS NULL
       OR p_preclosure_revision < 1
       OR p_verified_by_user_id IS NULL
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_EVIDENCE_INVALID_IDENTITY'
            USING ERRCODE = '22023';
    END IF;

    IF p_source IS NULL OR p_source NOT IN (
        'fixed_costs',
        'manual_expenses',
        'openai_invoice',
        'meta_invoice'
    ) THEN
        RAISE EXCEPTION
            'ZION_ADMIN_EVIDENCE_INVALID_SOURCE'
            USING ERRCODE = '22023';
    END IF;

    IF NOT (
        (
            p_source = 'fixed_costs'
            AND p_proof_type IN (
                'supplier_invoice',
                'supplier_statement',
                'expense_receipt',
                'internal_reconciliation'
            )
        )
        OR (
            p_source = 'manual_expenses'
            AND p_proof_type IN (
                'expense_receipt',
                'internal_reconciliation'
            )
        )
        OR (
            p_source IN ('openai_invoice','meta_invoice')
            AND p_proof_type IN (
                'supplier_invoice',
                'supplier_statement'
            )
        )
    ) THEN
        RAISE EXCEPTION
            'ZION_ADMIN_EVIDENCE_INVALID_PROOF_TYPE'
            USING ERRCODE = '22023';
    END IF;

    IF (
        p_amount_brl_cents IS NULL
        AND p_amount_usd IS NULL
    )
    OR p_amount_brl_cents < 0
    OR p_amount_usd < 0
    OR p_amount_usd > 999999999999.99999999
    OR (
        p_amount_usd IS NOT NULL
        AND p_amount_usd <>
            pg_catalog.round(p_amount_usd, 8)
    ) THEN
        RAISE EXCEPTION
            'ZION_ADMIN_EVIDENCE_INVALID_AMOUNT'
            USING ERRCODE = '22023';
    END IF;

    -- Descobrir a competencia do upload.
    SELECT u.*
    INTO v_upload
    FROM public.zion_admin_financial_evidence_uploads u
    WHERE u.id = p_upload_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'ZION_ADMIN_EVIDENCE_UPLOAD_NOT_FOUND';
    END IF;

    IF v_upload.month <> p_month
       OR v_upload.preclosure_revision <>
            p_preclosure_revision
       OR v_upload.source <> p_source
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_EVIDENCE_UPLOAD_BINDING_MISMATCH';
    END IF;

    -- Mesmo bloqueio utilizado pelo pre-fechamento.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext(
            'zion_admin_monthly_preclosure'
        ),
        pg_catalog.hashtext(p_month::text)
    );

    -- Revalidacao apos adquirir o bloqueio.
    SELECT u.*
    INTO v_upload
    FROM public.zion_admin_financial_evidence_uploads u
    WHERE u.id = p_upload_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_upload.month <> p_month
       OR v_upload.preclosure_revision <>
            p_preclosure_revision
       OR v_upload.source <> p_source
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_EVIDENCE_UPLOAD_BINDING_MISMATCH';
    END IF;

    -- Ator administrativo ativo e autorizado.
    SELECT a.user_id
    INTO v_actor_id
    FROM public.zion_internal_admins a
    WHERE a.user_id = p_verified_by_user_id
      AND a.is_active IS TRUE
      AND a.role = 'owner'
    FOR SHARE;

    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION
            'ZION_ADMIN_EVIDENCE_ACTOR_FORBIDDEN'
            USING ERRCODE = '42501';
    END IF;

    SELECT p.revision
    INTO v_revision
    FROM public.zion_admin_monthly_preclosures p
    WHERE p.month = p_month
    FOR UPDATE;

    IF v_revision IS NULL
       OR v_revision <> p_preclosure_revision
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_EVIDENCE_STALE_PRECLOSURE';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.zion_admin_monthly_preclosure_audit a
        WHERE a.month = p_month
          AND a.revision = p_preclosure_revision
    ) THEN
        RAISE EXCEPTION
            'ZION_ADMIN_EVIDENCE_PRECLOSURE_AUDIT_MISSING';
    END IF;

    -- Impedir verificacao em mes definitivamente fechado.
    IF EXISTS (
        SELECT 1
        FROM public.zion_admin_monthly_final_closures f
        WHERE f.month = p_month
    )
    OR EXISTS (
        SELECT 1
        FROM public.zion_admin_monthly_closures l
        WHERE l.month = p_month
    ) THEN
        RAISE EXCEPTION
            'ZION_ADMIN_EVIDENCE_MONTH_CLOSED';
    END IF;

    -- O documento deve permanecer registrado no
    -- bucket privado, com identidade e metadados corretos.
    SELECT o.id, o.metadata
    INTO v_object_id, v_metadata
    FROM storage.objects o
    WHERE o.bucket_id = 'zion-admin-financial-evidence'
      AND o.name = v_upload.storage_path
    FOR SHARE;

    IF v_object_id IS NULL OR v_metadata IS NULL THEN
        RAISE EXCEPTION
            'ZION_ADMIN_EVIDENCE_STORAGE_OBJECT_MISSING';
    END IF;

    v_size_text := v_metadata ->> 'size';

    IF v_size_text IS NULL
       OR v_size_text !~ '^[0-9]{1,8}$'
       OR v_size_text::bigint <> v_upload.size_bytes
       OR (v_metadata ->> 'mimetype')
            IS DISTINCT FROM v_upload.mime_type
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_EVIDENCE_STORAGE_METADATA_MISMATCH';
    END IF;

    -- Idempotencia somente para dados identicos.
    SELECT e.*
    INTO v_existing
    FROM public.zion_admin_monthly_final_evidence e
    WHERE e.month = p_month
      AND e.preclosure_revision = p_preclosure_revision
      AND e.source = p_source
      AND e.document_sha256 = v_upload.document_sha256
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.document_reference
                IS DISTINCT FROM v_upload.storage_path
           OR v_existing.proof_type
                IS DISTINCT FROM p_proof_type
           OR v_existing.amount_brl_cents
                IS DISTINCT FROM p_amount_brl_cents
           OR v_existing.amount_usd
                IS DISTINCT FROM p_amount_usd
           OR v_existing.verification_method
                IS DISTINCT FROM 'manual_document_review'
           OR v_existing.verified_by_user_id
                IS DISTINCT FROM p_verified_by_user_id
        THEN
            RAISE EXCEPTION
                'ZION_ADMIN_EVIDENCE_REPLAY_CONFLICT';
        END IF;

        RETURN pg_catalog.jsonb_build_object(
            'ok', true,
            'status', 'already_recorded',
            'evidenceId', v_existing.id,
            'verifiedAt', v_existing.verified_at
        );
    END IF;

    -- Somente registro novo. Sem UPDATE ou DELETE.
    v_verified_at := pg_catalog.clock_timestamp();

    INSERT INTO public.zion_admin_monthly_final_evidence (
        month,
        preclosure_revision,
        source,
        proof_type,
        document_reference,
        document_sha256,
        amount_brl_cents,
        amount_usd,
        verification_method,
        verified_by_user_id,
        verified_at
    )
    VALUES (
        p_month,
        p_preclosure_revision,
        p_source,
        p_proof_type,
        v_upload.storage_path,
        v_upload.document_sha256,
        p_amount_brl_cents,
        p_amount_usd,
        'manual_document_review',
        p_verified_by_user_id,
        v_verified_at
    )
    RETURNING id INTO v_evidence_id;

    RETURN pg_catalog.jsonb_build_object(
        'ok', true,
        'status', 'recorded',
        'evidenceId', v_evidence_id,
        'verifiedAt', v_verified_at
    );
END;
$function$;

ALTER FUNCTION
public.zion_admin_verify_monthly_final_evidence_by_system(
    bigint,date,integer,text,text,bigint,numeric,uuid,boolean
)
OWNER TO postgres;

REVOKE ALL ON FUNCTION
public.zion_admin_verify_monthly_final_evidence_by_system(
    bigint,date,integer,text,text,bigint,numeric,uuid,boolean
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
public.zion_admin_verify_monthly_final_evidence_by_system(
    bigint,date,integer,text,text,bigint,numeric,uuid,boolean
)
TO service_role;

COMMENT ON FUNCTION
public.zion_admin_verify_monthly_final_evidence_by_system(
    bigint,date,integer,text,text,bigint,numeric,uuid,boolean
)
IS
'Registra revisao manual explicita de comprovante financeiro '
'apos autenticacao e verificacao privada dos bytes pelo backend. '
'Nao efetua reconciliacao automatica nem fechamento definitivo.';

COMMIT;