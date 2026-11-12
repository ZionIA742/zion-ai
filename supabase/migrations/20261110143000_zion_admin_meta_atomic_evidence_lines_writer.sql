BEGIN;

-- ZION-ADM | Bloco 1 | Etapa 2.11-C.6-K
--
-- Operacao unica: evidencia mensal + linhas documentais.
-- Reutiliza o writer mensal ja instalado.
-- Reutiliza triggers de integridade e soma no COMMIT.
--
-- INATIVO: nenhuma permissao EXECUTE.
-- Nao comprova origem Meta, cobertura integral das contas
-- ou revisao humana independente.
-- Nao autoriza fechamento financeiro.

CREATE FUNCTION public.zion_admin_register_meta_evidence_with_lines_by_system(
    p_month date,
    p_preclosure_revision integer,
    p_upload_id bigint,
    p_status text,
    p_proof_type text,
    p_amount_brl_cents bigint,
    p_document_reference text,
    p_review_fingerprint_sha256 text,
    p_operation_key uuid,
    p_actor_id uuid,
    p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_item jsonb;
    v_normalized jsonb := '[]'::jsonb;
    v_sorted jsonb;
    v_saved jsonb;
    v_result jsonb;
    v_evidence_id bigint;
    v_document_id bigint;
    v_amount bigint;
    v_total numeric := 0;
    v_amount_records integer := 0;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'ZION_ADMIN_META_ATOMIC_UNAUTHORIZED';
    END IF;

    IF p_lines IS NULL
        OR pg_catalog.jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
        OR pg_catalog.jsonb_array_length(p_lines) NOT BETWEEN 1 AND 5000
    THEN
        RAISE EXCEPTION 'ZION_ADMIN_META_ATOMIC_INVALID_LINES';
    END IF;

    -- Validar toda a colecao antes de solicitar a
    -- criacao da evidencia mensal.
    FOR v_item IN
        SELECT item
        FROM pg_catalog.jsonb_array_elements(p_lines) AS x(item)
    LOOP
        IF pg_catalog.jsonb_typeof(v_item) IS DISTINCT FROM 'object'
            OR NOT (
                v_item ?& ARRAY[
                    'financial_account_type',
                    'financial_account_id',
                    'document_upload_id',
                    'document_reference',
                    'record_kind',
                    'amount_brl_cents',
                    'review_fingerprint_sha256',
                    'document_sha256'
                ]::text[]
            )
            OR (
                SELECT count(*)
                FROM pg_catalog.jsonb_object_keys(v_item)
            ) <> 8
        THEN
            RAISE EXCEPTION 'ZION_ADMIN_META_ATOMIC_INVALID_ITEM';
        END IF;

        IF pg_catalog.jsonb_typeof(
            v_item -> 'document_upload_id'
        ) IS DISTINCT FROM 'number'
            OR pg_catalog.jsonb_typeof(
                v_item -> 'amount_brl_cents'
            ) IS DISTINCT FROM 'number'
            OR (v_item ->> 'document_upload_id')
                !~ '^[1-9][0-9]*$'
            OR (v_item ->> 'amount_brl_cents')
                !~ '^(0|[1-9][0-9]*)$'
        THEN
            RAISE EXCEPTION 'ZION_ADMIN_META_ATOMIC_INVALID_NUMBERS';
        END IF;

        v_document_id :=
            (v_item ->> 'document_upload_id')::bigint;

        v_amount :=
            (v_item ->> 'amount_brl_cents')::bigint;

        IF v_document_id < 1
            OR v_amount NOT BETWEEN 0 AND 100000000000
        THEN
            RAISE EXCEPTION 'ZION_ADMIN_META_ATOMIC_INVALID_AMOUNT';
        END IF;

        IF pg_catalog.jsonb_typeof(
            v_item -> 'financial_account_type'
        ) IS DISTINCT FROM 'string'
            OR pg_catalog.jsonb_typeof(
                v_item -> 'financial_account_id'
            ) IS DISTINCT FROM 'string'
            OR pg_catalog.jsonb_typeof(
                v_item -> 'document_reference'
            ) IS DISTINCT FROM 'string'
            OR pg_catalog.jsonb_typeof(
                v_item -> 'record_kind'
            ) IS DISTINCT FROM 'string'
            OR pg_catalog.jsonb_typeof(
                v_item -> 'review_fingerprint_sha256'
            ) IS DISTINCT FROM 'string'
            OR pg_catalog.jsonb_typeof(
                v_item -> 'document_sha256'
            ) IS DISTINCT FROM 'string'
        THEN
            RAISE EXCEPTION 'ZION_ADMIN_META_ATOMIC_INVALID_TEXT';
        END IF;

        IF (v_item ->> 'record_kind') NOT IN (
            'amount_record',
            'not_applicable_record'
        ) OR (
            (v_item ->> 'record_kind') = 'not_applicable_record'
            AND v_amount <> 0
        ) THEN
            RAISE EXCEPTION 'ZION_ADMIN_META_ATOMIC_INVALID_KIND';
        END IF;

        IF (v_item ->> 'record_kind') = 'amount_record' THEN
            v_amount_records := v_amount_records + 1;
        END IF;

        v_total := v_total + v_amount;
        v_normalized := v_normalized ||
            pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                    'financial_account_type',
                    v_item ->> 'financial_account_type',
                    'financial_account_id',
                    v_item ->> 'financial_account_id',
                    'document_upload_id',
                    v_document_id,
                    'document_reference',
                    v_item ->> 'document_reference',
                    'record_kind',
                    v_item ->> 'record_kind',
                    'amount_brl_cents',
                    v_amount,
                    'review_fingerprint_sha256',
                    v_item ->> 'review_fingerprint_sha256',
                    'document_sha256',
                    v_item ->> 'document_sha256'
                )
            );
    END LOOP;

    IF v_total IS DISTINCT FROM p_amount_brl_cents::numeric
        OR (
            p_status = 'verified_not_applicable'
            AND v_amount_records <> 0
        )
        OR (
            p_status = 'verified_amount'
            AND v_amount_records = 0
        )
    THEN
        RAISE EXCEPTION 'ZION_ADMIN_META_ATOMIC_TOTAL_MISMATCH';
    END IF;

    -- Ordem canonica para comparar reenvios,
    -- independentemente da ordem recebida.
    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            item ORDER BY
                item ->> 'financial_account_type',
                item ->> 'financial_account_id',
                item ->> 'document_reference',
                (item ->> 'document_upload_id')::bigint
        ),
        '[]'::jsonb
    )
    INTO v_sorted
    FROM pg_catalog.jsonb_array_elements(v_normalized) AS x(item);

    -- A funcao mensal verifica operacao, revisao corrente,
    -- upload principal, fechamentos e duplicidade.
    -- A chamada e interna, sob o mesmo dono SQL.
    v_result :=
        public.zion_admin_register_verified_meta_evidence_by_system(
            p_month,
            p_preclosure_revision,
            p_upload_id,
            p_status,
            p_proof_type,
            p_amount_brl_cents,
            p_document_reference,
            p_review_fingerprint_sha256,
            p_operation_key,
            p_actor_id
        );

    IF v_result ->> 'ok' IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'ZION_ADMIN_META_ATOMIC_PARENT_REJECTED';
    END IF;

    v_evidence_id := (v_result ->> 'evidence_id')::bigint;

    IF v_result ->> 'outcome' = 'replayed' THEN
        SELECT COALESCE(
            pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                    'financial_account_type',
                    l.financial_account_type,
                    'financial_account_id',
                    l.financial_account_id,
                    'document_upload_id',
                    l.document_upload_id,
                    'document_reference',
                    l.document_reference,
                    'record_kind',
                    l.record_kind,
                    'amount_brl_cents',
                    l.amount_brl_cents,
                    'review_fingerprint_sha256',
                    l.review_fingerprint_sha256,
                    'document_sha256',
                    l.document_sha256
                )
                ORDER BY
                    l.financial_account_type,
                    l.financial_account_id,
                    l.document_reference,
                    l.document_upload_id
            ),
            '[]'::jsonb
        )
        INTO v_saved
        FROM public.zion_admin_meta_billing_account_lines AS l
        WHERE l.meta_evidence_id = v_evidence_id;

        IF v_saved IS DISTINCT FROM v_sorted THEN
            RAISE EXCEPTION
                'ZION_ADMIN_META_ATOMIC_OPERATION_REUSED';
        END IF;

        RETURN pg_catalog.jsonb_build_object(
            'ok', true,
            'outcome', 'replayed',
            'evidence_id', v_evidence_id
        );
    END IF;

    IF v_result ->> 'outcome' IS DISTINCT FROM 'inserted' THEN
        RAISE EXCEPTION 'ZION_ADMIN_META_ATOMIC_OUTCOME_INVALID';
    END IF;

    FOR v_item IN
        SELECT item
        FROM pg_catalog.jsonb_array_elements(v_normalized) AS x(item)
    LOOP
        INSERT INTO public.zion_admin_meta_billing_account_lines (
            meta_evidence_id,
            month,
            preclosure_revision,
            financial_account_type,
            financial_account_id,
            document_upload_id,
            document_reference,
            record_kind,
            amount_brl_cents,
            review_fingerprint_sha256,
            document_sha256,
            reviewed_by_user_id
        )
        VALUES (
            v_evidence_id,
            p_month,
            p_preclosure_revision,
            v_item ->> 'financial_account_type',
            v_item ->> 'financial_account_id',
            (v_item ->> 'document_upload_id')::bigint,
            v_item ->> 'document_reference',
            v_item ->> 'record_kind',
            (v_item ->> 'amount_brl_cents')::bigint,
            v_item ->> 'review_fingerprint_sha256',
            v_item ->> 'document_sha256',
            p_actor_id
        );
    END LOOP;

    -- Os triggers diferidos conferem a soma novamente
    -- no COMMIT. Falha em qualquer linha aborta tudo.
    RETURN pg_catalog.jsonb_build_object(
        'ok', true,
        'outcome', 'inserted',
        'evidence_id', v_evidence_id,
        'line_count', pg_catalog.jsonb_array_length(p_lines)
    );
END;
$function$;

REVOKE ALL ON FUNCTION
public.zion_admin_register_meta_evidence_with_lines_by_system(
    date, integer, bigint, text, text, bigint,
    text, text, uuid, uuid, jsonb
)
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;