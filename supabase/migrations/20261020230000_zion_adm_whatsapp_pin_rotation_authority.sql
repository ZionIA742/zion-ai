-- ZION-ADM / PIN rotation 1.8-B. No remote Meta request is performed by SQL.
-- Backend MUST enforce authenticated manage_whatsapp_pins capability, same-origin,
-- explicit human consent, a cryptographic session binding and confirmed Meta result.
-- A caller-provided HTTP code/hash alone is NOT independent evidence of success.
BEGIN;

CREATE TABLE public.zion_admin_whatsapp_pin_rotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL UNIQUE,
  organization_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  phone_number_id text NOT NULL CHECK (btrim(phone_number_id) <> ''),
  integration_id uuid NOT NULL REFERENCES public.external_integrations(id) ON DELETE RESTRICT,
  old_secret_id uuid NOT NULL REFERENCES public.whatsapp_phone_security_secrets(id) ON DELETE RESTRICT,
  new_secret_id uuid UNIQUE REFERENCES public.whatsapp_phone_security_secrets(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  session_binding_hash text NOT NULL CHECK (session_binding_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN (
    'prepared', 'authorized', 'executing', 'remote_confirmed',
    'remote_rejected', 'remote_uncertain', 'completed', 'cancelled', 'expired'
  )),
  authorization_expires_at timestamptz NOT NULL,
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  authorized_at timestamptz,
  execution_started_at timestamptz,
  remote_result_at timestamptz,
  remote_http_status integer CHECK (remote_http_status IS NULL OR remote_http_status BETWEEN 100 AND 599),
  remote_error_code text,
  remote_request_id text,
  remote_evidence_hash text CHECK (remote_evidence_hash IS NULL OR remote_evidence_hash ~ '^[0-9a-f]{64}$'),
  finalized_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT zion_admin_pin_rotation_expiry_check CHECK (authorization_expires_at > prepared_at),
  CONSTRAINT zion_admin_pin_rotation_execution_check CHECK (
    status <> 'executing' OR (authorized_at IS NOT NULL AND execution_started_at IS NOT NULL AND new_secret_id IS NOT NULL)
  ),
  CONSTRAINT zion_admin_pin_rotation_remote_check CHECK (
    status NOT IN ('remote_confirmed','remote_rejected','remote_uncertain','completed') OR remote_result_at IS NOT NULL
  ),
  CONSTRAINT zion_admin_pin_rotation_confirmation_check CHECK (
    status NOT IN ('remote_confirmed','completed') OR
    (remote_http_status BETWEEN 200 AND 299 AND remote_evidence_hash IS NOT NULL)
  ),
  CONSTRAINT zion_admin_pin_rotation_completed_check CHECK (
    status <> 'completed' OR (new_secret_id IS NOT NULL AND finalized_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX zion_admin_pin_rotation_phone_inflight_uq
  ON public.zion_admin_whatsapp_pin_rotations(phone_number_id)
  WHERE status IN ('prepared','authorized','executing','remote_confirmed','remote_uncertain');
CREATE INDEX zion_admin_pin_rotation_store_idx
  ON public.zion_admin_whatsapp_pin_rotations(organization_id,store_id,prepared_at DESC);

CREATE TABLE public.zion_admin_whatsapp_pin_rotation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rotation_id uuid NOT NULL REFERENCES public.zion_admin_whatsapp_pin_rotations(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'prepared','authorized','authorization_consumed',
    'remote_confirmed','remote_rejected','remote_uncertain',
    'completed','expired','cancelled'
  )),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX zion_admin_pin_rotation_events_rotation_idx
  ON public.zion_admin_whatsapp_pin_rotation_events(rotation_id,created_at);

CREATE FUNCTION public.zion_admin_prevent_pin_rotation_event_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $f$
BEGIN
  RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_AUDIT_IMMUTABLE' USING ERRCODE='42501';
END;
$f$;
CREATE TRIGGER zion_admin_pin_rotation_event_immutable
  BEFORE UPDATE OR DELETE ON public.zion_admin_whatsapp_pin_rotation_events
  FOR EACH ROW EXECUTE FUNCTION public.zion_admin_prevent_pin_rotation_event_mutation();

ALTER TABLE public.zion_admin_whatsapp_pin_rotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zion_admin_whatsapp_pin_rotation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zion_admin_whatsapp_pin_rotations FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.zion_admin_whatsapp_pin_rotation_events FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.zion_admin_prepare_whatsapp_pin_rotation_by_system(
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
                 WHERE COALESCE(to_jsonb(a)->>'user_id',to_jsonb(a)->>'auth_user_id') = p_actor_user_id::text)
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

CREATE FUNCTION public.zion_admin_authorize_whatsapp_pin_rotation_by_system(
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
                 WHERE COALESCE(to_jsonb(a)->>'user_id',to_jsonb(a)->>'auth_user_id')=p_actor_user_id::text) THEN
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

-- Atomically consumes authorization AND writes an encrypted pending PIN.
-- The Node.js server generates the random six-digit PIN and encrypts it.
CREATE FUNCTION public.zion_admin_begin_whatsapp_pin_rotation_by_system(
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
                 WHERE COALESCE(to_jsonb(a)->>'user_id',to_jsonb(a)->>'auth_user_id')=p_actor_user_id::text)
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

-- An HTTP status/evidence fingerprint is NOT proof from Meta by itself.
-- Only the backend adapter may translate success === true to 'confirmed'.
CREATE FUNCTION public.zion_admin_record_whatsapp_pin_rotation_result_by_system(
  p_rotation_id uuid, p_operation_id uuid, p_actor_user_id uuid,
  p_result text, p_http_status integer, p_meta_error_code text,
  p_meta_request_id text, p_evidence_hash text
)
RETURNS TABLE(rotation_id uuid, status text, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v public.zion_admin_whatsapp_pin_rotations%ROWTYPE;
  v_next_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_result IS NULL OR p_result NOT IN ('confirmed','rejected','uncertain') THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_RESULT_INVALID' USING ERRCODE='22023';
  END IF;
  IF p_result='confirmed' AND (
       p_http_status NOT BETWEEN 200 AND 299 OR p_http_status IS NULL
       OR p_evidence_hash IS NULL OR p_evidence_hash !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_CONFIRMATION_INVALID' USING ERRCODE='22023';
  END IF;
  IF p_result='rejected' AND (
       p_http_status NOT IN (400,401,403) OR p_http_status IS NULL
       OR nullif(btrim(coalesce(p_meta_error_code,'')),'') IS NULL) THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_REJECTION_NOT_DETERMINISTIC' USING ERRCODE='22023';
  END IF;
  v_next_status := CASE p_result WHEN 'confirmed' THEN 'remote_confirmed'
                    WHEN 'rejected' THEN 'remote_rejected' ELSE 'remote_uncertain' END;
  SELECT * INTO v FROM public.zion_admin_whatsapp_pin_rotations a
  WHERE a.id=p_rotation_id FOR UPDATE;
  IF NOT FOUND OR v.operation_id IS DISTINCT FROM p_operation_id
     OR v.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_RESULT_SCOPE_INVALID' USING ERRCODE='42501';
  END IF;
  IF v.status=v_next_status THEN
    IF v.remote_http_status IS DISTINCT FROM p_http_status
       OR v.remote_error_code IS DISTINCT FROM left(p_meta_error_code,128)
       OR v.remote_request_id IS DISTINCT FROM left(p_meta_request_id,256)
       OR v.remote_evidence_hash IS DISTINCT FROM p_evidence_hash THEN
      RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_RESULT_REPLAY_CONFLICT' USING ERRCODE='23505';
    END IF;
    RETURN QUERY SELECT v.id,v.status,'idempotent_replay'::text;
    RETURN;
  END IF;
  IF v.status <> 'executing' OR v.new_secret_id IS NULL THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_RESULT_NOT_EXPECTED' USING ERRCODE='42501';
  END IF;
  UPDATE public.zion_admin_whatsapp_pin_rotations a
  SET status=v_next_status,remote_http_status=p_http_status,
      remote_error_code=left(p_meta_error_code,128),
      remote_request_id=left(p_meta_request_id,256),
      remote_evidence_hash=p_evidence_hash,
      remote_result_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE a.id=v.id;
  IF p_result='rejected' THEN
    PERFORM 1 FROM public.invalidate_whatsapp_phone_security_secret_by_system(
      v.organization_id,v.store_id,v.new_secret_id
    );
  END IF;
  INSERT INTO public.zion_admin_whatsapp_pin_rotation_events
    (rotation_id,operation_id,actor_user_id,event_type,
     metadata)
  VALUES (v.id,v.operation_id,v.actor_user_id,v_next_status,
    jsonb_build_object('http_status',p_http_status,'has_request_id',p_meta_request_id IS NOT NULL));
  RETURN QUERY SELECT v.id,v_next_status,'recorded'::text;
END;
$f$;

-- Finalization is atomic. Old secret remains active unless this commits.
CREATE FUNCTION public.zion_admin_finalize_whatsapp_pin_rotation_by_system(
  p_rotation_id uuid, p_operation_id uuid, p_actor_user_id uuid
)
RETURNS TABLE(rotation_id uuid, status text, new_secret_id uuid, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v public.zion_admin_whatsapp_pin_rotations%ROWTYPE;
  v_active record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v FROM public.zion_admin_whatsapp_pin_rotations a
  WHERE a.id=p_rotation_id FOR UPDATE;
  IF NOT FOUND OR v.operation_id IS DISTINCT FROM p_operation_id
     OR v.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_FINALIZE_SCOPE_INVALID' USING ERRCODE='42501';
  END IF;
  IF v.status='completed' THEN
    RETURN QUERY SELECT v.id,v.status,v.new_secret_id,'idempotent_replay'::text;
    RETURN;
  END IF;
  IF v.status <> 'remote_confirmed' OR v.remote_http_status NOT BETWEEN 200 AND 299
     OR v.remote_evidence_hash IS NULL OR v.new_secret_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.zion_internal_admins a
                    WHERE COALESCE(to_jsonb(a)->>'user_id',to_jsonb(a)->>'auth_user_id')=p_actor_user_id::text)
     OR NOT EXISTS (SELECT 1 FROM public.external_integrations i
                    WHERE i.id=v.integration_id AND i.organization_id=v.organization_id
                      AND i.store_id=v.store_id AND i.phone_number_id=v.phone_number_id
                      AND i.provider='whatsapp' AND i.status='active' AND i.is_active IS TRUE)
     OR NOT EXISTS (SELECT 1 FROM public.whatsapp_phone_security_secrets s
                    WHERE s.id=v.old_secret_id AND s.status='active'
                      AND s.organization_id=v.organization_id AND s.store_id=v.store_id
                      AND s.phone_number_id=v.phone_number_id AND s.external_integration_id=v.integration_id)
     OR NOT EXISTS (SELECT 1 FROM public.whatsapp_phone_security_secrets s
                    WHERE s.id=v.new_secret_id AND s.status='pending'
                      AND s.organization_id=v.organization_id AND s.store_id=v.store_id
                      AND s.phone_number_id=v.phone_number_id) THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_FINALIZE_NOT_AUTHORIZED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_active FROM public.activate_whatsapp_phone_security_secret_by_system(
    v.organization_id,v.store_id,'whatsapp',v.phone_number_id,v.integration_id
  );
  IF v_active.secret_id IS DISTINCT FROM v.new_secret_id
     OR v_active.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_ACTIVATION_MISMATCH' USING ERRCODE='42501';
  END IF;
  UPDATE public.zion_admin_whatsapp_pin_rotations a
  SET status='completed',finalized_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE a.id=v.id;
  INSERT INTO public.zion_admin_whatsapp_pin_rotation_events
    (rotation_id,operation_id,actor_user_id,event_type)
  VALUES (v.id,v.operation_id,v.actor_user_id,'completed');
  RETURN QUERY SELECT v.id,'completed'::text,v.new_secret_id,'completed'::text;
END;
$f$;

CREATE FUNCTION public.zion_admin_cancel_whatsapp_pin_rotation_by_system(
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
  UPDATE public.zion_admin_whatsapp_pin_rotations a
  SET status='cancelled',updated_at=clock_timestamp() WHERE a.id=v.id;
  INSERT INTO public.zion_admin_whatsapp_pin_rotation_events
    (rotation_id,operation_id,actor_user_id,event_type)
  VALUES (v.id,v.operation_id,v.actor_user_id,'cancelled');
  RETURN QUERY SELECT v.id,'cancelled'::text,'cancelled'::text;
END;
$f$;

-- Fail closed: a remote_uncertain result cannot be promoted by request id/hash.
CREATE FUNCTION public.zion_admin_reconcile_whatsapp_pin_rotation_by_system(p_rotation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
BEGIN
  RAISE EXCEPTION 'ZION_ADMIN_PIN_ROTATION_INDEPENDENT_META_RECONCILIATION_NOT_IMPLEMENTED'
    USING ERRCODE='42501';
END;
$f$;

REVOKE ALL ON FUNCTION public.zion_admin_prevent_pin_rotation_event_mutation() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.zion_admin_prepare_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.zion_admin_authorize_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.zion_admin_begin_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,text,text,text,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.zion_admin_record_whatsapp_pin_rotation_result_by_system(uuid,uuid,uuid,text,integer,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.zion_admin_finalize_whatsapp_pin_rotation_by_system(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.zion_admin_cancel_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.zion_admin_reconcile_whatsapp_pin_rotation_by_system(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zion_admin_prepare_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,uuid,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.zion_admin_authorize_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.zion_admin_begin_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,text,text,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.zion_admin_record_whatsapp_pin_rotation_result_by_system(uuid,uuid,uuid,text,integer,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.zion_admin_finalize_whatsapp_pin_rotation_by_system(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.zion_admin_cancel_whatsapp_pin_rotation_by_system(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.zion_admin_reconcile_whatsapp_pin_rotation_by_system(uuid) TO service_role;

COMMENT ON TABLE public.zion_admin_whatsapp_pin_rotations IS
  'ZION-ADM PIN rotation authority. No plaintext PIN or OAuth tokens. No SQL-only proof of remote Meta result.';
COMMIT;
