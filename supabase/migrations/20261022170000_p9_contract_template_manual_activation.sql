-- ============================================================
-- ZION | PILAR 9 | BLOCO 9
-- Ativacao manual simplificada do contrato da loja
--
-- Migration sugerida:
-- 20261022170000_p9_contract_template_manual_activation.sql
--
-- Preserva:
-- - autorizacao service_role
-- - escopo organizacao/loja
-- - locks existentes
-- - idempotencia
-- - historico de versoes
-- - arquivo original
--
-- Remove:
-- - obrigatoriedade de extracao de regras
-- - obrigatoriedade de revisao de clausulas
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION
public.activate_store_contract_template_version_by_system(
    p_version_id uuid,
    p_organization_id uuid,
    p_store_id uuid,
    p_approved_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp', 'public'
AS $function$

DECLARE
    v_template_id uuid;
    v_template public.store_contract_templates%rowtype;
    v_version public.store_contract_template_versions%rowtype;
    v_file_exists boolean := false;
    v_request_role text :=
        nullif(
            pg_catalog.current_setting(
                'request.jwt.claim.role',
                true
            ),
            ''
        );
    v_now timestamptz := pg_catalog.now();

BEGIN

    -- 1. Autoridade do servico.
    IF v_request_role IS DISTINCT FROM 'service_role'
       AND session_user <> 'postgres'
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'P9_CONTRACT_ACTIVATION_NOT_AUTHORIZED';
    END IF;

    -- 2. Argumentos obrigatorios.
    IF p_version_id IS NULL
       OR p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_approved_by IS NULL
    THEN
        RAISE EXCEPTION
            'P19A_CONTRACT_INVALID_ACTIVATION_ARGUMENTS';
    END IF;

    -- 3. Localizar a versao no escopo correto.
    SELECT template_id
    INTO v_template_id
    FROM public.store_contract_template_versions
    WHERE id = p_version_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id;

    IF v_template_id IS NULL THEN
        RAISE EXCEPTION
            'P19A_CONTRACT_VERSION_NOT_FOUND_OR_OUT_OF_SCOPE';
    END IF;

    -- 4. Preservar o lock canonico do template.
    SELECT *
    INTO v_template
    FROM public.store_contract_templates
    WHERE id = v_template_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_CONTRACT_TEMPLATE_NOT_FOUND_OR_OUT_OF_SCOPE';
    END IF;

    -- 5. Recarregar a versao sob o lock do template.
    SELECT *
    INTO v_version
    FROM public.store_contract_template_versions
    WHERE id = p_version_id
      AND template_id = v_template.id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_CONTRACT_VERSION_NOT_FOUND_OR_OUT_OF_SCOPE';
    END IF;

    -- 6. Replay idempotente.
    IF v_version.status = 'active'
       AND v_template.active_version_id = v_version.id
       AND v_template.status = 'active'
    THEN
        RETURN v_version.id;
    END IF;

    -- 7. Rejeicao continua definitiva.
    IF v_version.rejected_at IS NOT NULL THEN
        RAISE EXCEPTION
            'P19A_CONTRACT_REJECTED_VERSION_NOT_ACTIVATABLE';
    END IF;

    -- 8. Permitir upload direto sem analise.
    -- Estados failed, rejected, archived e active inconsistente
    -- permanecem bloqueados.
    IF v_version.status NOT IN (
        'uploaded',
        'analyzed',
        'awaiting_review'
    ) THEN
        RAISE EXCEPTION
            'P19A_CONTRACT_VERSION_NOT_ACTIVATABLE: status %',
            v_version.status;
    END IF;

    -- 9. Exigir arquivo armazenado e vinculado ao escopo.
    IF v_version.store_file_id IS NULL THEN
        RAISE EXCEPTION
            'P9_CONTRACT_ACTIVATION_SOURCE_FILE_REQUIRED';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.store_files file_row
        WHERE file_row.id = v_version.store_file_id
          AND file_row.organization_id = p_organization_id
          AND file_row.store_id = p_store_id
    )
    INTO v_file_exists;

    IF NOT v_file_exists THEN
        RAISE EXCEPTION
            'P9_CONTRACT_ACTIVATION_SOURCE_FILE_INVALID';
    END IF;

    -- Nao consultar regras extraidas.
    -- O responsavel assume a revisao do documento.

    -- 10. Arquivar a versao ativa anterior.
    UPDATE public.store_contract_template_versions
    SET
        status = 'archived',
        updated_at = v_now
    WHERE template_id = v_template.id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
      AND status = 'active'
      AND id <> v_version.id;

    -- 11. Ativar a nova versao.
    UPDATE public.store_contract_template_versions
    SET
        status = 'active',
        approved_at = v_now,
        approved_by = p_approved_by,
        rejected_at = NULL,
        rejected_by = NULL,
        rejection_reason = NULL,
        updated_at = v_now
    WHERE id = v_version.id
      AND template_id = v_template.id
      AND organization_id = p_organization_id
      AND store_id = p_store_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_CONTRACT_VERSION_ACTIVATION_UPDATE_FAILED';
    END IF;

    -- 12. Atualizar o ponteiro oficial.
    UPDATE public.store_contract_templates
    SET
        active_version_id = v_version.id,
        status = 'active',
        updated_at = v_now
    WHERE id = v_template.id
      AND organization_id = p_organization_id
      AND store_id = p_store_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_CONTRACT_TEMPLATE_POINTER_UPDATE_FAILED';
    END IF;

    RETURN v_version.id;

END;
$function$;

-- Preservar proprietario e privilegios restritos.

ALTER FUNCTION
public.activate_store_contract_template_version_by_system(
    uuid, uuid, uuid, uuid
)
OWNER TO postgres;

REVOKE ALL ON FUNCTION
public.activate_store_contract_template_version_by_system(
    uuid, uuid, uuid, uuid
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.activate_store_contract_template_version_by_system(
    uuid, uuid, uuid, uuid
)
TO service_role;

-- Verificacao estrutural, sem ativar documentos.

DO $verify$
DECLARE
    v_function regprocedure :=
        'public.activate_store_contract_template_version_by_system(uuid,uuid,uuid,uuid)'::regprocedure;
BEGIN

    IF NOT pg_catalog.has_function_privilege(
        'service_role',
        v_function,
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'P9_CONTRACT_SERVICE_ROLE_PERMISSION_MISSING';
    END IF;

    IF pg_catalog.has_function_privilege(
        'anon',
        v_function,
        'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
        'authenticated',
        v_function,
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'P9_CONTRACT_UNEXPECTED_EXECUTE_PERMISSION';
    END IF;

    RAISE NOTICE
        'P9_CONTRACT_MANUAL_ACTIVATION_FUNCTION_READY';

END;
$verify$;

COMMIT;
