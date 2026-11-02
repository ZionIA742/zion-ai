-- ZION-ADM / 8-E.11-D.2-C.3
-- Autoridade de registro de uploads financeiros.
--
-- Apenas registra documentos NAO VERIFICADOS.
-- Nao aprova despesas ou comprovantes.
-- Nao habilita fechamento definitivo.
-- Nao concede escrita direta na tabela.
-- SHA256 dos bytes deve ser conferido pelo servidor.

BEGIN;

DO $$
BEGIN
    IF pg_catalog.to_regprocedure(
        'public.zion_admin_register_financial_evidence_upload_by_system(date,integer,text,text,text,text,bigint,uuid)'
    ) IS NOT NULL THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINANCIAL_UPLOAD_WRITER_ALREADY_EXISTS';
    END IF;
END;
$$;

CREATE FUNCTION
public.zion_admin_register_financial_evidence_upload_by_system(
    p_month date,
    p_preclosure_revision integer,
    p_source text,
    p_storage_path text,
    p_document_sha256 text,
    p_mime_type text,
    p_size_bytes bigint,
    p_uploaded_by_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_current_revision integer;
    v_storage_object_id uuid;
    v_storage_metadata jsonb;
    v_storage_size_text text;
    v_expected_extension text;
    v_upload_id bigint;
BEGIN
    -- 1. Entradas obrigatorias.
    IF p_month IS NULL
       OR EXTRACT(DAY FROM p_month) <> 1
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_UPLOAD_INVALID_MONTH';
    END IF;

    IF p_preclosure_revision IS NULL
       OR p_preclosure_revision < 1
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_UPLOAD_INVALID_REVISION';
    END IF;

    IF p_uploaded_by_user_id IS NULL THEN
        RAISE EXCEPTION
            'ZION_ADMIN_UPLOAD_ACTOR_REQUIRED';
    END IF;

    IF p_source IS NULL
       OR p_source NOT IN (
           'fixed_costs',
           'manual_expenses',
           'openai_invoice',
           'meta_invoice'
       )
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_UPLOAD_INVALID_SOURCE';
    END IF;

    IF p_document_sha256 IS NULL
       OR p_document_sha256 !~ '^[0-9a-f]{64}$'
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_UPLOAD_INVALID_SHA256';
    END IF;

    IF p_size_bytes IS NULL
       OR p_size_bytes < 1
       OR p_size_bytes > 10485760
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_UPLOAD_INVALID_SIZE';
    END IF;

    v_expected_extension :=
        CASE p_mime_type
            WHEN 'application/pdf' THEN 'pdf'
            WHEN 'image/png' THEN 'png'
            WHEN 'image/jpeg' THEN 'jpg'
            ELSE NULL
        END;

    IF v_expected_extension IS NULL THEN
        RAISE EXCEPTION
            'ZION_ADMIN_UPLOAD_INVALID_MIME';
    END IF;

    -- 2. Caminho privado e identidade do documento.
    IF p_storage_path IS NULL
       OR pg_catalog.length(p_storage_path) > 512
       OR p_storage_path !~ (
           '^unverified/'
           || p_month::text
           || '/'
           || p_preclosure_revision::text
           || '/'
           || p_source
           || '/[0-9a-f]{8}-[0-9a-f]{4}-'
           || '[0-9a-f]{4}-[0-9a-f]{4}-'
           || '[0-9a-f]{12}-'
           || p_document_sha256
           || '[.]'
           || v_expected_extension
           || '$'
       )
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_UPLOAD_INVALID_PATH';
    END IF;

    -- 3. Somente o owner interno ativo.
    -- O servidor deve fornecer o UUID da sessao
    -- ja autenticada, nunca um UUID do formulario.
    IF NOT EXISTS (
        SELECT 1
        FROM public.zion_internal_admins a
        WHERE a.user_id = p_uploaded_by_user_id
          AND a.is_active IS TRUE
          AND a.role = 'owner'
    ) THEN
        RAISE EXCEPTION
            'ZION_ADMIN_UPLOAD_ACTOR_FORBIDDEN';
    END IF;

    -- 4. Serializa com o writer do pre-fechamento.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext(
            'zion_admin_monthly_preclosure'
        ),
        pg_catalog.hashtext(p_month::text)
    );

    SELECT p.revision
    INTO v_current_revision
    FROM public.zion_admin_monthly_preclosures p
    WHERE p.month = p_month
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'ZION_ADMIN_UPLOAD_PRECLOSURE_NOT_FOUND';
    END IF;

    IF v_current_revision <> p_preclosure_revision THEN
        RAISE EXCEPTION
            'ZION_ADMIN_UPLOAD_STALE_REVISION';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.zion_admin_monthly_preclosure_audit a
        WHERE a.month = p_month
          AND a.revision = p_preclosure_revision
    ) THEN
        RAISE EXCEPTION
            'ZION_ADMIN_UPLOAD_AUDIT_NOT_FOUND';
    END IF;

    -- 5. Competencias fechadas nao recebem uploads.
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
            'ZION_ADMIN_UPLOAD_MONTH_CLOSED';
    END IF;

    -- 6. Confere a existencia do objeto privado.
    SELECT o.id, o.metadata
    INTO v_storage_object_id, v_storage_metadata
    FROM storage.objects o
    WHERE o.bucket_id =
        'zion-admin-financial-evidence'
      AND o.name = p_storage_path;

    IF v_storage_object_id IS NULL
       OR v_storage_metadata IS NULL
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_UPLOAD_STORAGE_OBJECT_NOT_FOUND';
    END IF;

    -- O Storage registra o tamanho no metadata.
    v_storage_size_text :=
        v_storage_metadata ->> 'size';

    IF v_storage_size_text IS NULL
       OR v_storage_size_text !~ '^[0-9]{1,8}$'
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_UPLOAD_STORAGE_SIZE_INVALID';
    END IF;

    IF v_storage_size_text::bigint <> p_size_bytes THEN
        RAISE EXCEPTION
            'ZION_ADMIN_UPLOAD_STORAGE_SIZE_MISMATCH';
    END IF;

    IF v_storage_metadata ->> 'mimetype'
       IS DISTINCT FROM p_mime_type
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_UPLOAD_STORAGE_MIME_MISMATCH';
    END IF;

    -- 7. Registro idempotente por caminho.
    -- Conflitos com metadados diferentes falham.
    INSERT INTO
        public.zion_admin_financial_evidence_uploads (
            month,
            preclosure_revision,
            source,
            storage_bucket,
            storage_path,
            document_sha256,
            mime_type,
            size_bytes,
            uploaded_by_user_id
        )
    VALUES (
        p_month,
        p_preclosure_revision,
        p_source,
        'zion-admin-financial-evidence',
        p_storage_path,
        p_document_sha256,
        p_mime_type,
        p_size_bytes,
        p_uploaded_by_user_id
    )
    ON CONFLICT ON CONSTRAINT
        zion_admin_fin_upload_path_unique
    DO NOTHING
    RETURNING id INTO v_upload_id;

    IF v_upload_id IS NULL THEN
        SELECT u.id
        INTO v_upload_id
        FROM public.zion_admin_financial_evidence_uploads u
        WHERE u.storage_bucket =
            'zion-admin-financial-evidence'
          AND u.storage_path = p_storage_path
          AND u.month = p_month
          AND u.preclosure_revision =
              p_preclosure_revision
          AND u.source = p_source
          AND u.document_sha256 =
              p_document_sha256
          AND u.mime_type = p_mime_type
          AND u.size_bytes = p_size_bytes
          AND u.uploaded_by_user_id =
              p_uploaded_by_user_id;

        IF v_upload_id IS NULL THEN
            RAISE EXCEPTION
                'ZION_ADMIN_UPLOAD_PATH_CONFLICT';
        END IF;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'ok', true,
        'uploadId', v_upload_id,
        'status', 'uploaded_unverified',
        'verified', false
    );
END;
$$;

REVOKE ALL ON FUNCTION
public.zion_admin_register_financial_evidence_upload_by_system(
    date, integer, text, text, text, text, bigint, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
public.zion_admin_register_financial_evidence_upload_by_system(
    date, integer, text, text, text, text, bigint, uuid
)
TO service_role;

COMMENT ON FUNCTION
public.zion_admin_register_financial_evidence_upload_by_system(
    date, integer, text, text, text, text, bigint, uuid
)
IS
    'Registra arquivo privado previamente armazenado, '
    'sem aprovar evidencia ou fechamento financeiro.';

COMMIT;