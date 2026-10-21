-- ZION-ADM / 1.8-C2B-SEC: require ACTIVE admin for pre-Meta operations.
-- Applies only if the exact audited SQL function bodies are still deployed.
-- Does not contact Meta, change active PINs, change recoveries, or alter layouts.
-- Deliberately DOES NOT require current admin in remote result/finalize:
-- an already-confirmed Meta change must remain safely recordable even after revocation.
BEGIN;

DO $preflight$
DECLARE
  v record;
  v_actual text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='zion_internal_admins' AND column_name='is_active') THEN
    RAISE EXCEPTION 'PIN_ROTATION_ADMIN_ACTIVE_COLUMN_MISSING';
  END IF;
  IF EXISTS (SELECT 1 FROM public.zion_admin_whatsapp_pin_rotations WHERE status IN ('prepared','authorized','executing','remote_confirmed','remote_uncertain')) THEN
    RAISE EXCEPTION 'PIN_ROTATION_ALREADY_INFLIGHT_REVIEW_REQUIRED';
  END IF;
  FOR v IN SELECT * FROM (VALUES
    ('public.zion_admin_prepare_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,uuid,text,text,timestamptz)', 'eb547c86c94e2c91fd847205fa299312'),
    ('public.zion_admin_authorize_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,text)', '987a0e8444ad02c6795acddb2c271f78'),
    ('public.zion_admin_begin_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,text,text,text,text,integer)', '33f72b1a194df29c3051eaaa315713e7'),
    ('public.zion_admin_cancel_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,text)', '6d5643bd82c5b9eb63f763d2569efafb'),
    ('public.zion_admin_read_whatsapp_pin_rotation_binding_by_system(uuid,uuid,uuid,text)', '00d9eb3678058891bdb8dc0d927b52f1')
  ) AS expected(signature, body_md5) LOOP
    SELECT md5(pg_catalog.regexp_replace(p.prosrc, E'\\s+', '', 'g')) INTO v_actual
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = pg_catalog.to_regprocedure(v.signature);
    IF v_actual IS DISTINCT FROM v.body_md5 THEN
      RAISE EXCEPTION 'PIN_ROTATION_SQL_BASELINE_DIVERGED: %', v.signature;
    END IF;
  END LOOP;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.zion_admin_prepare_whatsapp_pin_rotation_by_system(
  p_operation_id uuid, p_actor_user_id uuid, p_organization_id uuid,
  p_store_id uuid, p_phone_number_id text, p_session_binding_hash text,
  p_expires_at timestamptz
)
RETURNS TABLE(rotation_id uuid, operation_id uuid, status text, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v public.zion_admin_whatsapp_pin_rotations%ROWTYPE;
  v_old_secret_id uuid;
  v_integration_id uuid;
  v_count bigint;
  v_phone text := nullif(btrim(p_phone_number_id),'');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_operation_id IS NULL OR p_actor_user_id IS NULL OR p_organization_id IS NULL
     OR p_store_id IS NULL OR v_phone IS NULL
     OR p_session_binding_hash IS NULL OR p_session_binding_hash !~ '^[0-9a-f]{64}$'
     OR p_expires_at IS NULL OR p_expires_at <= clock_timestamp()
     OR p_expires_at > clock_timestamp() + interval '10 minutes' THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_PREPARE_INVALID' USING ERRCODE='22023';
  END IF;

  -- Authorization must also cover idempotent replay before any result is returned.
  IF NOT EXISTS (
    SELECT 1 FROM public.zion_internal_admins AS admin
    WHERE COALESCE(to_jsonb(admin)->>'user_id', to_jsonb(admin)->>'auth_user_id') = p_actor_user_id::text
      AND admin.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_ACTOR_REVOKED' USING ERRCODE='42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('zion_pin_recovery:' || v_phone,0)
  );

  SELECT a.* INTO v FROM public.zion_admin_whatsapp_pin_rotations a
  WHERE a.operation_id=p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v.actor_user_id IS DISTINCT FROM p_actor_user_id
       OR v.organization_id IS DISTINCT FROM p_organization_id
       OR v.store_id IS DISTINCT FROM p_store_id
       OR v.phone_number_id IS DISTINCT FROM v_phone
       OR v.session_binding_hash IS DISTINCT FROM p_session_binding_hash
       OR v.authorization_expires_at IS DISTINCT FROM p_expires_at THEN
      RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_OPERATION_CONFLICT' USING ERRCODE='23505';
    END IF;
    RETURN QUERY SELECT v.id,v.operation_id,v.status,'idempotent_replay'::text;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.zion_internal_admins a
                 WHERE COALESCE(to_jsonb(a)->>'user_id',to_jsonb(a)->>'auth_user_id') = p_actor_user_id::text
                   AND a.is_active IS TRUE)
     OR NOT EXISTS (SELECT 1 FROM public.stores s
                    WHERE s.id=p_store_id AND s.organization_id=p_organization_id) THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_ACTOR_OR_STORE_INVALID' USING ERRCODE='42501';
  END IF;

  SELECT count(*), (array_agg(i.id))[1] INTO v_count,v_integration_id
  FROM public.external_integrations i
  WHERE i.organization_id=p_organization_id AND i.store_id=p_store_id
    AND i.phone_number_id=v_phone AND i.provider='whatsapp'
    AND i.status='active' AND i.is_active IS TRUE;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_INTEGRATION_NOT_UNIQUE' USING ERRCODE='42501';
  END IF;

  SELECT count(*), (array_agg(s.id))[1] INTO v_count,v_old_secret_id
  FROM public.whatsapp_phone_security_secrets s
  WHERE s.organization_id=p_organization_id AND s.store_id=p_store_id
    AND s.phone_number_id=v_phone AND s.provider='whatsapp'
    AND s.secret_kind='two_step_verification_pin' AND s.status='active'
    AND s.external_integration_id=v_integration_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_ACTIVE_SECRET_NOT_UNIQUE' USING ERRCODE='42501';
  END IF;

  -- Only authorizations which were never consumed can expire automatically.
  FOR v IN SELECT a.* FROM public.zion_admin_whatsapp_pin_rotations a
           WHERE a.phone_number_id=v_phone AND a.status IN ('prepared','authorized')
             AND a.authorization_expires_at<=clock_timestamp() FOR UPDATE LOOP
    UPDATE public.zion_admin_whatsapp_pin_rotations a
    SET status='expired', updated_at=clock_timestamp() WHERE a.id=v.id;
    INSERT INTO public.zion_admin_whatsapp_pin_rotation_events
      (rotation_id,operation_id,actor_user_id,event_type)
    VALUES (v.id,v.operation_id,v.actor_user_id,'expired');
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.zion_admin_whatsapp_pin_rotations a
             WHERE a.phone_number_id=v_phone
               AND a.status IN ('prepared','authorized','executing','remote_confirmed','remote_uncertain'))
     OR EXISTS (SELECT 1 FROM public.whatsapp_pin_recovery_attempts a
                WHERE a.phone_number_id=v_phone
                  AND a.status IN ('prepared','executing','remote_confirmed','remote_uncertain','materialization_pending'))
     OR EXISTS (SELECT 1 FROM public.whatsapp_phone_security_secrets s
                WHERE s.phone_number_id=v_phone AND s.status='pending') THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_TARGET_BUSY' USING ERRCODE='23505';
  END IF;

  INSERT INTO public.zion_admin_whatsapp_pin_rotations (
    operation_id,organization_id,store_id,phone_number_id,integration_id,
    old_secret_id,actor_user_id,session_binding_hash,authorization_expires_at
  ) VALUES (
    p_operation_id,p_organization_id,p_store_id,v_phone,v_integration_id,
    v_old_secret_id,p_actor_user_id,p_session_binding_hash,p_expires_at
  ) RETURNING * INTO v;
  INSERT INTO public.zion_admin_whatsapp_pin_rotation_events
    (rotation_id,operation_id,actor_user_id,event_type)
  VALUES (v.id,v.operation_id,v.actor_user_id,'prepared');
  RETURN QUERY SELECT v.id,v.operation_id,v.status,'created'::text;
END;
$f$;

CREATE OR REPLACE FUNCTION public.zion_admin_authorize_whatsapp_pin_rotation_by_system(
  p_rotation_id uuid, p_operation_id uuid, p_actor_user_id uuid,
  p_session_binding_hash text
)
RETURNS TABLE(rotation_id uuid, status text, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v public.zion_admin_whatsapp_pin_rotations%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v FROM public.zion_admin_whatsapp_pin_rotations a
  WHERE a.id=p_rotation_id FOR UPDATE;
  IF NOT FOUND OR v.operation_id IS DISTINCT FROM p_operation_id
     OR v.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v.session_binding_hash IS DISTINCT FROM p_session_binding_hash
     OR v.status <> 'prepared' OR v.authorization_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_AUTHORIZATION_INVALID' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.zion_internal_admins a
                 WHERE COALESCE(to_jsonb(a)->>'user_id',to_jsonb(a)->>'auth_user_id')=p_actor_user_id::text
                   AND a.is_active IS TRUE) THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_ACTOR_REVOKED' USING ERRCODE='42501';
  END IF;
  UPDATE public.zion_admin_whatsapp_pin_rotations a
  SET status='authorized',authorized_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE a.id=v.id;
  INSERT INTO public.zion_admin_whatsapp_pin_rotation_events
    (rotation_id,operation_id,actor_user_id,event_type)
  VALUES (v.id,v.operation_id,v.actor_user_id,'authorized');
  RETURN QUERY SELECT v.id,'authorized'::text,'authorized'::text;
END;
$f$;

CREATE OR REPLACE FUNCTION public.zion_admin_begin_whatsapp_pin_rotation_by_system(
  p_rotation_id uuid, p_operation_id uuid, p_actor_user_id uuid,
  p_session_binding_hash text, p_ciphertext text, p_iv text,
  p_auth_tag text, p_key_version integer
)
RETURNS TABLE(rotation_id uuid, status text, new_secret_id uuid,
              phone_number_id text, integration_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v public.zion_admin_whatsapp_pin_rotations%ROWTYPE;
  v_secret record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v FROM public.zion_admin_whatsapp_pin_rotations a
  WHERE a.id=p_rotation_id FOR UPDATE;
  IF NOT FOUND OR v.operation_id IS DISTINCT FROM p_operation_id
     OR v.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v.session_binding_hash IS DISTINCT FROM p_session_binding_hash
     OR v.status <> 'authorized' OR v.authorization_expires_at<=clock_timestamp()
     OR v.new_secret_id IS NOT NULL THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_AUTHORIZATION_CONSUMED' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.zion_internal_admins a
                 WHERE COALESCE(to_jsonb(a)->>'user_id',to_jsonb(a)->>'auth_user_id')=p_actor_user_id::text
                   AND a.is_active IS TRUE)
     OR NOT EXISTS (SELECT 1 FROM public.external_integrations i
                    WHERE i.id=v.integration_id AND i.organization_id=v.organization_id
                      AND i.store_id=v.store_id AND i.phone_number_id=v.phone_number_id
                      AND i.provider='whatsapp' AND i.status='active' AND i.is_active IS TRUE)
     OR NOT EXISTS (SELECT 1 FROM public.whatsapp_phone_security_secrets s
                    WHERE s.id=v.old_secret_id AND s.organization_id=v.organization_id
                      AND s.store_id=v.store_id AND s.phone_number_id=v.phone_number_id
                      AND s.status='active' AND s.external_integration_id=v.integration_id) THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_SCOPE_CHANGED' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_pin_recovery_attempts a
             WHERE a.phone_number_id=v.phone_number_id
               AND a.status IN ('prepared','executing','remote_confirmed','remote_uncertain','materialization_pending')) THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_RECOVERY_IN_PROGRESS' USING ERRCODE='23505';
  END IF;

  SELECT * INTO v_secret FROM public.create_whatsapp_phone_security_secret_pending_by_system(
    v.organization_id,v.store_id,'whatsapp',v.phone_number_id,
    p_ciphertext,p_iv,p_auth_tag,p_key_version
  );
  IF v_secret.secret_id IS NULL OR v_secret.status IS DISTINCT FROM 'pending'
     OR v_secret.outcome IS DISTINCT FROM 'created' THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_PENDING_CONFLICT' USING ERRCODE='23505';
  END IF;
  UPDATE public.zion_admin_whatsapp_pin_rotations a
  SET status='executing',execution_started_at=clock_timestamp(),
      new_secret_id=v_secret.secret_id,updated_at=clock_timestamp()
  WHERE a.id=v.id;
  INSERT INTO public.zion_admin_whatsapp_pin_rotation_events
    (rotation_id,operation_id,actor_user_id,event_type)
  VALUES (v.id,v.operation_id,v.actor_user_id,'authorization_consumed');
  RETURN QUERY SELECT v.id,'executing'::text,v_secret.secret_id::uuid,v.phone_number_id,v.integration_id;
END;
$f$;

CREATE OR REPLACE FUNCTION public.zion_admin_cancel_whatsapp_pin_rotation_by_system(
  p_rotation_id uuid, p_operation_id uuid, p_actor_user_id uuid,
  p_session_binding_hash text
)
RETURNS TABLE(rotation_id uuid, status text, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v public.zion_admin_whatsapp_pin_rotations%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v FROM public.zion_admin_whatsapp_pin_rotations a
  WHERE a.id=p_rotation_id FOR UPDATE;
  IF NOT FOUND OR v.operation_id IS DISTINCT FROM p_operation_id
     OR v.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v.session_binding_hash IS DISTINCT FROM p_session_binding_hash
     OR v.status NOT IN ('prepared','authorized') THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_CANCEL_NOT_ALLOWED' USING ERRCODE='42501';
  END IF;
  -- Cancelling a still-unexecuted operation is a new human action.
  IF NOT EXISTS (
    SELECT 1 FROM public.zion_internal_admins AS admin
    WHERE COALESCE(to_jsonb(admin)->>'user_id', to_jsonb(admin)->>'auth_user_id') = p_actor_user_id::text
      AND admin.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_ACTOR_REVOKED' USING ERRCODE='42501';
  END IF;
  UPDATE public.zion_admin_whatsapp_pin_rotations a
  SET status='cancelled',updated_at=clock_timestamp() WHERE a.id=v.id;
  INSERT INTO public.zion_admin_whatsapp_pin_rotation_events
    (rotation_id,operation_id,actor_user_id,event_type)
  VALUES (v.id,v.operation_id,v.actor_user_id,'cancelled');
  RETURN QUERY SELECT v.id,'cancelled'::text,'cancelled'::text;
END;
$f$;

CREATE OR REPLACE FUNCTION public.zion_admin_read_whatsapp_pin_rotation_binding_by_system(
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
         AND a.is_active IS TRUE
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
DO $postflight$
DECLARE v record; v_actual text;
BEGIN
  FOR v IN SELECT * FROM (VALUES
    ('public.zion_admin_prepare_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,uuid,text,text,timestamptz)', '1002bd2e1c4b2dd54a6739f5b308e048'),
    ('public.zion_admin_authorize_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,text)', '1e56edfd4bd37e598270431ed1fd23dc'),
    ('public.zion_admin_begin_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,text,text,text,text,integer)', '8172092166eec988976fcc93118dd9f6'),
    ('public.zion_admin_cancel_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,text)', 'e19a3567b447182dbdabdcbffb0244a5'),
    ('public.zion_admin_read_whatsapp_pin_rotation_binding_by_system(uuid,uuid,uuid,text)', '485521cdda7ad82340bc60d80c5e2f96')
  ) AS expected(signature, body_md5) LOOP
    SELECT md5(pg_catalog.regexp_replace(p.prosrc, E'\\s+', '', 'g')) INTO v_actual
    FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(v.signature);
    IF v_actual IS DISTINCT FROM v.body_md5 THEN
      RAISE EXCEPTION 'PIN_ROTATION_SQL_PATCH_MISMATCH: %', v.signature;
    END IF;
  END LOOP;
END;
$postflight$;

-- Privileges of existing functions are preserved by CREATE OR REPLACE.
-- Prevent unexpected public EXECUTE grants if a future deployment changes defaults.
REVOKE ALL ON FUNCTION public.zion_admin_prepare_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.zion_admin_authorize_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.zion_admin_begin_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,text,text,text,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.zion_admin_cancel_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.zion_admin_read_whatsapp_pin_rotation_binding_by_system(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
COMMIT;
