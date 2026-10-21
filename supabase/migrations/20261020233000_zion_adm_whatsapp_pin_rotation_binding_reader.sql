-- ZION-ADM PIN rotation 1.8-C2B: authorized, service-role-only binding reader.
-- Does NOT write data, generate a PIN, contact Meta, or expose a browser API.
-- Sensitive return values (Meta access token and encrypted active-PIN material)
-- MUST remain inside the trusted server process; never return them to the browser.
BEGIN;

CREATE FUNCTION public.zion_admin_read_whatsapp_pin_rotation_binding_by_system(
  p_rotation_id uuid,
  p_operation_id uuid,
  p_actor_user_id uuid,
  p_session_binding_hash text
)
RETURNS TABLE (
  organization_id uuid,
  store_id uuid,
  phone_number_id text,
  integration_id uuid,
  old_secret_id uuid,
  access_token text,
  ciphertext text,
  iv text,
  auth_tag text,
  key_version integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v public.zion_admin_whatsapp_pin_rotations%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_rotation_id IS NULL
     OR p_operation_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_session_binding_hash IS NULL
     OR p_session_binding_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_BINDING_INPUT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT r.* INTO v
  FROM public.zion_admin_whatsapp_pin_rotations AS r
  WHERE r.id = p_rotation_id
  FOR SHARE;

  IF NOT FOUND
     OR v.operation_id IS DISTINCT FROM p_operation_id
     OR v.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v.session_binding_hash IS DISTINCT FROM p_session_binding_hash
     OR v.status IS DISTINCT FROM 'authorized'
     OR v.authorization_expires_at <= clock_timestamp()
     OR v.new_secret_id IS NOT NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.zion_internal_admins AS a
       WHERE COALESCE(to_jsonb(a)->>'user_id', to_jsonb(a)->>'auth_user_id')
         = p_actor_user_id::text
     ) THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_BINDING_NOT_AUTHORIZED'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    v.organization_id,
    v.store_id,
    v.phone_number_id,
    v.integration_id,
    v.old_secret_id,
    i.access_token,
    s.ciphertext,
    s.iv,
    s.auth_tag,
    s.key_version
  FROM public.external_integrations AS i
  JOIN public.whatsapp_phone_security_secrets AS s
    ON s.id = v.old_secret_id
  JOIN public.stores AS st
    ON st.id = v.store_id
   AND st.organization_id = v.organization_id
  WHERE i.id = v.integration_id
    AND i.organization_id = v.organization_id
    AND i.store_id = v.store_id
    AND i.phone_number_id = v.phone_number_id
    AND i.provider = 'whatsapp'
    AND i.status = 'active'
    AND i.is_active IS TRUE
    AND NULLIF(pg_catalog.btrim(i.access_token), '') IS NOT NULL
    AND s.organization_id = v.organization_id
    AND s.store_id = v.store_id
    AND s.phone_number_id = v.phone_number_id
    AND s.provider = 'whatsapp'
    AND s.secret_kind = 'two_step_verification_pin'
    AND s.status = 'active'
    AND s.external_integration_id = v.integration_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_BINDING_CHANGED_OR_UNAVAILABLE'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.zion_admin_read_whatsapp_pin_rotation_binding_by_system(
  uuid,uuid,uuid,text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.zion_admin_read_whatsapp_pin_rotation_binding_by_system(
  uuid,uuid,uuid,text
) TO service_role;

COMMENT ON FUNCTION public.zion_admin_read_whatsapp_pin_rotation_binding_by_system(
  uuid,uuid,uuid,text
) IS
  'Server-only read of one authorized PIN rotation binding. Returns token and encrypted active PIN material; never expose to a user-facing endpoint.';

COMMIT;
