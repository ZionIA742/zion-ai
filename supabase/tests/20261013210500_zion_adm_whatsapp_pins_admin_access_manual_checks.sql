-- ZION-ADM / PINs WhatsApp / Etapa 3-A
-- Runner de inspeção e verificacao somente leitura.
-- Executar no SQL Editor APOS aplicar a migration.
-- NAO consulta ciphertext, iv, auth_tag ou PINs.

DO $checks$
DECLARE
    v_count integer := 0;
    v_def text;
    v_oid oid;
BEGIN
    SELECT count(*) INTO v_count
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
          'list_zion_admin_whatsapp_pins_by_system',
          'read_zion_admin_whatsapp_pin_material_by_system'
      )
      AND p.prosecdef = true
      AND EXISTS (
          SELECT 1
          FROM pg_catalog.unnest(p.proconfig) AS c(setting)
          WHERE c.setting LIKE 'search_path=%'
      );

    IF v_count <> 2 THEN
        RAISE EXCEPTION 'FAIL: faltam RPCs SECURITY DEFINER com search_path fixo (%/2)', v_count;
    END IF;

    RAISE NOTICE 'PASS: 2 RPCs SECURITY DEFINER com search_path fixo';

    v_oid := pg_catalog.to_regprocedure('public.list_zion_admin_whatsapp_pins_by_system(uuid)');
    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'FAIL: assinatura da RPC de listagem ausente';
    END IF;

    IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
    THEN
        RAISE EXCEPTION 'FAIL: ACL da RPC de listagem incorreta';
    END IF;
    RAISE NOTICE 'PASS: listagem EXECUTE somente service_role';

    v_oid := pg_catalog.to_regprocedure('public.read_zion_admin_whatsapp_pin_material_by_system(uuid,uuid,uuid,uuid)');
    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'FAIL: assinatura da RPC de leitura ausente';
    END IF;

    IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
    THEN
        RAISE EXCEPTION 'FAIL: ACL da RPC de leitura incorreta';
    END IF;
    RAISE NOTICE 'PASS: leitura EXECUTE somente service_role';

    SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.zion_admin_audit_events'::regclass
      AND c.conname = 'zion_admin_audit_events_action_check';

    IF v_def IS NULL OR position('whatsapp_pin.list' IN v_def) = 0
       OR position('whatsapp_pin.reveal' IN v_def) = 0 THEN
        RAISE EXCEPTION 'FAIL: action_check nao permite auditoria de PINs';
    END IF;
    RAISE NOTICE 'PASS: audit action_check suporta list/reveal';

    SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.zion_admin_audit_events'::regclass
      AND c.conname = 'zion_admin_audit_events_target_type_check';

    IF v_def IS NULL OR position('whatsapp_pin' IN v_def) = 0 THEN
        RAISE EXCEPTION 'FAIL: target_type_check nao permite whatsapp_pin';
    END IF;
    RAISE NOTICE 'PASS: audit target_type_check suporta whatsapp_pin';

    RAISE NOTICE 'PASS: runner finalizado, sem consulta a material criptografado';
END;
$checks$;

-- Evidencia visivel nao sensivel da tentativa META, sem revelar PIN.
SELECT
    s.store_id,
    s.phone_number_id,
    s.status,
    s.created_at,
    s.invalidated_at
FROM public.whatsapp_phone_security_secrets AS s
WHERE s.store_id = '54fb81f4-92e5-463a-af6c-fc1544ea4b04'::uuid
  AND s.phone_number_id = '1322472314288518'
ORDER BY s.created_at DESC
LIMIT 5;
