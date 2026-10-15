BEGIN;

-- ZION-ADM / PINs WhatsApp / Etapa 3-A
-- Listagem administrativa e leitura excepcional criptografada.
-- Nenhuma alteracao de status ou do material dos PINs.

-- 1. Ampliar as acoes permitidas pela auditoria existente.

ALTER TABLE public.zion_admin_audit_events
DROP CONSTRAINT zion_admin_audit_events_action_check;

ALTER TABLE public.zion_admin_audit_events
ADD CONSTRAINT zion_admin_audit_events_action_check
CHECK (
    action IN (
        'account.create',
        'account.first_access_resend',
        'account.access_block',
        'account.access_reactivate',
        'store.suspend',
        'store.reactivate',
        'whatsapp_pin.list',
        'whatsapp_pin.reveal'
    )
);

ALTER TABLE public.zion_admin_audit_events
DROP CONSTRAINT zion_admin_audit_events_target_type_check;

ALTER TABLE public.zion_admin_audit_events
ADD CONSTRAINT zion_admin_audit_events_target_type_check
CHECK (
    target_type IN (
        'user',
        'membership',
        'store',
        'whatsapp_pin'
    )
);

-- 2. Listagem administrativa, exclusivamente metadados.

CREATE OR REPLACE FUNCTION
public.list_zion_admin_whatsapp_pins_by_system(
    p_actor_user_id uuid
)
RETURNS TABLE (
    secret_id uuid,
    organization_id uuid,
    store_id uuid,
    store_name text,
    phone_number_id_masked text,
    secret_status text,
    created_at timestamptz,
    activated_at timestamptz,
    invalidated_at timestamptz,
    can_reveal boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_WHATSAPP_PIN_SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_actor_user_id IS NULL THEN
        RAISE EXCEPTION
            'ZION_WHATSAPP_PIN_ACTOR_REQUIRED'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.zion_admin_audit_events (
        id,
        operation_id,
        actor_user_id,
        action,
        target_type,
        target_id,
        organization_id,
        store_id,
        outcome,
        metadata,
        created_at
    )
    VALUES (
        pg_catalog.gen_random_uuid(),
        pg_catalog.gen_random_uuid(),
        p_actor_user_id,
        'whatsapp_pin.list',
        'whatsapp_pin',
        NULL,
        NULL,
        NULL,
        'success',
        pg_catalog.jsonb_build_object(
            'module', 'whatsapp_pins',
            'scope', 'internal_admin',
            'limit', 250
        ),
        pg_catalog.clock_timestamp()
    );

    RETURN QUERY
    SELECT
        sec.id,
        sec.organization_id,
        sec.store_id,
        COALESCE(
            pg_catalog.to_jsonb(st)->>'name',
            pg_catalog.to_jsonb(st)->>'store_name',
            pg_catalog.to_jsonb(st)->>'display_name',
            'Loja sem nome'
        )::text,
        CASE
            WHEN pg_catalog.length(sec.phone_number_id) > 4
                THEN '****' ||
                    pg_catalog.right(sec.phone_number_id, 4)
            ELSE '****'
        END::text,
        sec.status,
        sec.created_at,
        sec.activated_at,
        sec.invalidated_at,
        (
            sec.status IN ('active', 'invalidated')
        )
    FROM public.whatsapp_phone_security_secrets AS sec
    JOIN public.stores AS st
      ON st.id = sec.store_id
     AND st.organization_id = sec.organization_id
    WHERE sec.provider = 'whatsapp'
      AND sec.secret_kind = 'two_step_verification_pin'
    ORDER BY sec.created_at DESC, sec.id
    LIMIT 250;
END;
$function$;

-- 3. Leitura excepcional do material criptografado.
-- Nunca retorna o PIN em texto puro.
-- Aceita active e invalidated, sem modificar o status.

CREATE OR REPLACE FUNCTION
public.read_zion_admin_whatsapp_pin_material_by_system(
    p_actor_user_id uuid,
    p_secret_id uuid,
    p_organization_id uuid,
    p_store_id uuid
)
RETURNS TABLE (
    secret_id uuid,
    ciphertext text,
    iv text,
    auth_tag text,
    key_version integer,
    secret_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_secret record;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_WHATSAPP_PIN_SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_actor_user_id IS NULL
       OR p_secret_id IS NULL
       OR p_organization_id IS NULL
       OR p_store_id IS NULL
    THEN
        RAISE EXCEPTION
            'ZION_WHATSAPP_PIN_REQUIRED_ARGUMENT_MISSING'
            USING ERRCODE = '22023';
    END IF;

    SELECT sec.*
      INTO v_secret
    FROM public.whatsapp_phone_security_secrets AS sec
    JOIN public.stores AS st
      ON st.id = sec.store_id
     AND st.organization_id = sec.organization_id
    WHERE sec.id = p_secret_id
      AND sec.organization_id = p_organization_id
      AND sec.store_id = p_store_id
      AND sec.provider = 'whatsapp'
      AND sec.secret_kind = 'two_step_verification_pin'
      AND sec.status IN ('active', 'invalidated')
    FOR SHARE OF sec;

    IF NOT FOUND THEN
        INSERT INTO public.zion_admin_audit_events (
            id,
            operation_id,
            actor_user_id,
            action,
            target_type,
            target_id,
            organization_id,
            store_id,
            outcome,
            metadata,
            created_at
        )
        VALUES (
            pg_catalog.gen_random_uuid(),
            pg_catalog.gen_random_uuid(),
            p_actor_user_id,
            'whatsapp_pin.reveal',
            'whatsapp_pin',
            p_secret_id,
            p_organization_id,
            p_store_id,
            'denied',
            pg_catalog.jsonb_build_object(
                'reason', 'not_found_or_ineligible'
            ),
            pg_catalog.clock_timestamp()
        );

        RETURN;
    END IF;

    -- A auditoria e a leitura ocorrem na mesma transacao.
    -- Falha na auditoria impede o retorno do segredo.

    INSERT INTO public.zion_admin_audit_events (
        id,
        operation_id,
        actor_user_id,
        action,
        target_type,
        target_id,
        organization_id,
        store_id,
        outcome,
        metadata,
        created_at
    )
    VALUES (
        pg_catalog.gen_random_uuid(),
        pg_catalog.gen_random_uuid(),
        p_actor_user_id,
        'whatsapp_pin.reveal',
        'whatsapp_pin',
        p_secret_id,
        p_organization_id,
        p_store_id,
        'success',
        pg_catalog.jsonb_build_object(
            'secret_status', v_secret.status,
            'historical',
                (v_secret.status = 'invalidated')
        ),
        pg_catalog.clock_timestamp()
    );

    RETURN QUERY
    SELECT
        v_secret.id::uuid,
        v_secret.ciphertext::text,
        v_secret.iv::text,
        v_secret.auth_tag::text,
        v_secret.key_version::integer,
        v_secret.status::text;
END;
$function$;

-- 4. Restringir execucao exclusivamente ao backend.
-- A API do ZION-ADM devera validar a sessao e a
-- capability manage_whatsapp_pins antes de chamar as RPCs.

REVOKE ALL ON FUNCTION
public.list_zion_admin_whatsapp_pins_by_system(uuid)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
public.read_zion_admin_whatsapp_pin_material_by_system(
    uuid, uuid, uuid, uuid
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.list_zion_admin_whatsapp_pins_by_system(uuid)
TO service_role;

GRANT EXECUTE ON FUNCTION
public.read_zion_admin_whatsapp_pin_material_by_system(
    uuid, uuid, uuid, uuid
)
TO service_role;

COMMIT;
