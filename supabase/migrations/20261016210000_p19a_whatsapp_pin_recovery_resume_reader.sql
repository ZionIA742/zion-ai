-- ZION / P19-A / 4-B.4
-- Reader canonico para retomar materializacao remote_confirmed.
-- Exclusivamente service_role.
-- Sem acesso direto do navegador.
-- Sem alteracao de estado ou operacoes Meta.

BEGIN;

CREATE FUNCTION public.read_whatsapp_pin_recovery_resumable_attempt_by_system(
    p_actor_user_id uuid,
    p_organization_id uuid,
    p_store_id uuid,
    p_waba_id text,
    p_phone_number_id text
)
RETURNS TABLE (
    attempt_id uuid,
    operation_id uuid,
    status text,
    organization_id uuid,
    store_id uuid,
    waba_id text,
    phone_number_id text,
    created_at timestamptz,
    remote_result_at timestamptz,
    authorization_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    -- Somente backend privilegiado.
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_PIN_RECOVERY_READER_SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    -- Parametros obrigatorios.
    IF p_actor_user_id IS NULL
       OR p_organization_id IS NULL
       OR p_store_id IS NULL
       OR NULLIF(pg_catalog.btrim(p_waba_id), '') IS NULL
       OR NULLIF(pg_catalog.btrim(p_phone_number_id), '') IS NULL
    THEN
        RAISE EXCEPTION
            'ZION_PIN_RECOVERY_READER_INVALID_SCOPE'
            USING ERRCODE = '22023';
    END IF;

    -- O ator precisa continuar sendo administrador interno.
    -- A capability manage_whatsapp_pins deve ser verificada
    -- adicionalmente pela rota autenticada do backend.
    IF NOT EXISTS (
        SELECT 1
        FROM public.zion_internal_admins adm
        WHERE COALESCE(
            pg_catalog.to_jsonb(adm)->>'user_id',
            pg_catalog.to_jsonb(adm)->>'auth_user_id'
        ) = p_actor_user_id::text
    ) THEN
        RAISE EXCEPTION
            'ZION_PIN_RECOVERY_READER_ADMIN_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    -- Nenhuma alteracao de estado.
    -- Identificadores somente da tentativa confirmada
    -- pertencente ao mesmo administrador e alvo canonico.
    RETURN QUERY
    SELECT
        a.id,
        a.operation_id,
        a.status,
        a.organization_id,
        a.store_id,
        a.waba_id,
        a.phone_number_id,
        a.created_at,
        a.remote_result_at,
        a.authorization_expires_at
    FROM public.whatsapp_pin_recovery_attempts a
    JOIN public.stores loja
      ON loja.id = a.store_id
     AND loja.organization_id = a.organization_id
    JOIN public.whatsapp_phone_security_secrets novo_pin
      ON novo_pin.id = a.replacement_secret_id
     AND novo_pin.organization_id = a.organization_id
     AND novo_pin.store_id = a.store_id
     AND novo_pin.phone_number_id = a.phone_number_id
     AND novo_pin.status = 'pending'
    JOIN public.whatsapp_phone_security_secrets historico
      ON historico.id = a.historical_secret_id
     AND historico.organization_id = a.organization_id
     AND historico.store_id = a.store_id
     AND historico.phone_number_id = a.phone_number_id
     AND historico.status = 'invalidated'
    WHERE a.actor_user_id = p_actor_user_id
      AND a.organization_id = p_organization_id
      AND a.store_id = p_store_id
      AND a.waba_id = p_waba_id
      AND a.phone_number_id = p_phone_number_id
      AND a.status = 'remote_confirmed'
      AND a.remote_result_at IS NOT NULL
      AND a.remote_http_status BETWEEN 200 AND 299
      AND NULLIF(
          pg_catalog.btrim(a.remote_evidence_hash), ''
      ) IS NOT NULL
      AND a.finalized_at IS NULL
    ORDER BY a.created_at DESC
    LIMIT 1;
END;
$function$;

-- Fechar EXECUTE publico, inclusive permissoes default.
REVOKE ALL ON FUNCTION
public.read_whatsapp_pin_recovery_resumable_attempt_by_system(
    uuid, uuid, uuid, text, text
)
FROM PUBLIC, anon, authenticated, service_role;

-- Autorizar exclusivamente o backend.
GRANT EXECUTE ON FUNCTION
public.read_whatsapp_pin_recovery_resumable_attempt_by_system(
    uuid, uuid, uuid, text, text
)
TO service_role;

COMMIT;
