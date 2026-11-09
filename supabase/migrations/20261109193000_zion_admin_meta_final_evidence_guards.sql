BEGIN;

-- ZION-ADM | Bloco 1 | Etapa 2.11-C.1
-- Protecoes adicionais na tabela CANONICA de evidencias.
--
-- NAO registra comprovantes.
-- NAO autentica faturamento Meta.
-- NAO concede INSERT a aplicacoes.
-- NAO autoriza fechamento definitivo.
-- NAO altera valores financeiros existentes.

DO $$
BEGIN
    IF to_regclass(
        'public.zion_admin_monthly_final_evidence'
    ) IS NULL OR to_regclass(
        'public.zion_admin_financial_evidence_uploads'
    ) IS NULL THEN
        RAISE EXCEPTION
            'ZION_ADMIN_META_EVIDENCE_FOUNDATION_MISSING';
    END IF;

    -- Nao migrar silenciosamente evidencias Meta antigas.
    -- Caso existam, exigir auditoria antes da instalacao.
    IF EXISTS (
        SELECT 1
        FROM public.zion_admin_monthly_final_evidence
        WHERE source = 'meta_invoice'
    ) THEN
        RAISE EXCEPTION
            'ZION_ADMIN_META_EVIDENCE_EXISTING_ROWS_REQUIRE_REVIEW';
    END IF;
END;
$$;

ALTER TABLE public.zion_admin_monthly_final_evidence
ADD COLUMN meta_financial_status text;

ALTER TABLE public.zion_admin_monthly_final_evidence
ADD CONSTRAINT zamfe_meta_financial_status_check
CHECK (
    (
        source <> 'meta_invoice'
        AND meta_financial_status IS NULL
    )
    OR
    (
        source = 'meta_invoice'
        AND meta_financial_status IS NOT NULL
        AND meta_financial_status IN (
            'verified_amount',
            'verified_not_applicable'
        )
        AND (
            (
                meta_financial_status = 'verified_amount'
                AND (
                    amount_brl_cents IS NOT NULL
                    OR amount_usd IS NOT NULL
                )
            )
            OR
            (
                meta_financial_status =
                    'verified_not_applicable'
                AND amount_brl_cents IS NOT DISTINCT FROM 0
                AND amount_usd IS NULL
                AND proof_type = 'supplier_statement'
            )
        )
    )
);

-- Vínculo mínimo obrigatório com um upload canônico.
-- Isso NÃO comprova a autenticidade financeira do documento.
-- A futura rota deverá verificar os bytes e a fonte real.
CREATE FUNCTION
public.zion_admin_guard_meta_final_evidence_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF NEW.source = 'meta_invoice'
       AND NOT EXISTS (
           SELECT 1
           FROM public.zion_admin_financial_evidence_uploads u
           WHERE u.month = NEW.month
             AND u.preclosure_revision =
                 NEW.preclosure_revision
             AND u.source = 'meta_invoice'
             AND u.document_sha256 =
                 NEW.document_sha256
       )
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_META_EVIDENCE_UPLOAD_MISSING';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE TRIGGER zamfe_meta_upload_guard
BEFORE INSERT
ON public.zion_admin_monthly_final_evidence
FOR EACH ROW
EXECUTE FUNCTION
public.zion_admin_guard_meta_final_evidence_insert();

-- Evidencias verificadas devem ser append-only.
-- Correcoes futuras precisam de revisoes auditadas,
-- nunca de alteracao silenciosa do registro original.
CREATE FUNCTION
public.zion_admin_refuse_final_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    RAISE EXCEPTION
        'ZION_ADMIN_FINAL_EVIDENCE_IMMUTABLE';
END;
$function$;

CREATE TRIGGER zamfe_immutable
BEFORE UPDATE OR DELETE
ON public.zion_admin_monthly_final_evidence
FOR EACH ROW
EXECUTE FUNCTION
public.zion_admin_refuse_final_evidence_mutation();

REVOKE ALL ON FUNCTION
public.zion_admin_guard_meta_final_evidence_insert()
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
public.zion_admin_refuse_final_evidence_mutation()
FROM PUBLIC, anon, authenticated, service_role;

-- Nenhum novo GRANT de INSERT, UPDATE ou DELETE.
-- O fechamento definitivo continua bloqueado.

COMMIT;