-- ZION P19-A / 4-B.1 — Controlled recovery of an invalidated WhatsApp PIN.
-- REVIEWED v2: 20261015173000. Replaces the UNAPPLIED 20261015170000 draft.
-- Do not keep two migration files with the same authority in the repository.
-- SHA-256 fingerprints are lowercase hex SHA-256 of the RAW OAuth access token;
-- never persist the raw token in this recovery ledger.
-- IMPORTANT: SQL authority alone DOES NOT authorize a Graph /register request.
-- The server must authenticate an internal admin with manage_whatsapp_pins,
-- validate a fresh OAuth authorization and require explicit operation consent.
-- No historical PIN is decrypted here; material is returned ENCRYPTED to service_role.
BEGIN;

CREATE TABLE public.whatsapp_pin_recovery_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id uuid NOT NULL UNIQUE,
    organization_id uuid NOT NULL,
    store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
    provider text NOT NULL DEFAULT 'whatsapp' CHECK (provider = 'whatsapp'),
    waba_id text NOT NULL CHECK (length(btrim(waba_id)) > 0),
    phone_number_id text NOT NULL CHECK (length(btrim(phone_number_id)) > 0),
    historical_secret_id uuid NOT NULL REFERENCES public.whatsapp_phone_security_secrets(id) ON DELETE RESTRICT,
    replacement_secret_id uuid REFERENCES public.whatsapp_phone_security_secrets(id) ON DELETE RESTRICT,
    actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    session_binding_hash text NOT NULL CHECK (length(session_binding_hash) BETWEEN 32 AND 256),
    purpose text NOT NULL DEFAULT 'whatsapp_pin_recovery' CHECK (purpose = 'whatsapp_pin_recovery'),
    status text NOT NULL DEFAULT 'prepared' CHECK (status IN (
        'prepared', 'executing', 'remote_confirmed', 'remote_rejected',
        'remote_uncertain', 'materialization_pending', 'completed',
        'failed', 'expired', 'cancelled'
    )),
    authorization_expires_at timestamptz NOT NULL,
    prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    execution_started_at timestamptz,
    remote_result_at timestamptz,
    remote_http_status integer CHECK (remote_http_status IS NULL OR remote_http_status BETWEEN 100 AND 599),
    remote_error_code text,
    remote_request_id text,
    remote_evidence_hash text,
    meta_graph_api_version text,
    meta_app_id text,
    access_token_fingerprint text CHECK (
        access_token_fingerprint IS NULL OR access_token_fingerprint ~ '^[0-9a-f]{64}$'
    ),
    materialization_token_fingerprint text CHECK (
        materialization_token_fingerprint IS NULL OR materialization_token_fingerprint ~ '^[0-9a-f]{64}$'
    ),
    materialization_token_validated_at timestamptz,
    integration_id uuid,
    finalized_at timestamptz,
    failure_code text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT whatsapp_pin_recovery_expiry_ck CHECK (authorization_expires_at > created_at),
    CONSTRAINT whatsapp_pin_recovery_materialization_token_ck CHECK (
        (materialization_token_fingerprint IS NULL) = (materialization_token_validated_at IS NULL)
    ),
    CONSTRAINT whatsapp_pin_recovery_executing_ck CHECK (status <> 'executing' OR execution_started_at IS NOT NULL),
    CONSTRAINT whatsapp_pin_recovery_confirmed_ck CHECK (
        status NOT IN ('remote_confirmed', 'materialization_pending', 'completed')
        OR (remote_result_at IS NOT NULL AND remote_http_status IS NOT NULL
            AND remote_http_status BETWEEN 200 AND 299
            AND nullif(btrim(remote_evidence_hash),'') IS NOT NULL)
    ),
    CONSTRAINT whatsapp_pin_recovery_completed_ck CHECK (
        status <> 'completed' OR (
            integration_id IS NOT NULL AND replacement_secret_id IS NOT NULL
            AND remote_result_at IS NOT NULL AND finalized_at IS NOT NULL
        )
    ),
    CONSTRAINT whatsapp_pin_recovery_uncertain_ck CHECK (
        status <> 'remote_uncertain' OR finalized_at IS NULL
    ),
    CONSTRAINT whatsapp_pin_recovery_finalized_ck CHECK (
        finalized_at IS NULL OR finalized_at >= created_at
    )
);

-- A remote_uncertain attempt deliberately blocks another recovery attempt.
CREATE UNIQUE INDEX whatsapp_pin_recovery_nonterminal_target_uidx
ON public.whatsapp_pin_recovery_attempts (organization_id, store_id, phone_number_id)
WHERE status IN ('prepared','executing','remote_confirmed','remote_uncertain','materialization_pending');
CREATE UNIQUE INDEX whatsapp_pin_recovery_global_nonterminal_phone_uidx
ON public.whatsapp_pin_recovery_attempts (phone_number_id)
WHERE status IN ('prepared','executing','remote_confirmed','remote_uncertain','materialization_pending');
CREATE INDEX whatsapp_pin_recovery_scope_status_idx
ON public.whatsapp_pin_recovery_attempts (organization_id, store_id, status, created_at DESC);
CREATE INDEX whatsapp_pin_recovery_historical_secret_idx
ON public.whatsapp_pin_recovery_attempts (historical_secret_id);
CREATE UNIQUE INDEX whatsapp_pin_recovery_replacement_uidx
ON public.whatsapp_pin_recovery_attempts (replacement_secret_id)
WHERE replacement_secret_id IS NOT NULL;

-- Separate append-only event log: do not weaken/change existing ZION-ADM audit constraints.
CREATE TABLE public.whatsapp_pin_recovery_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id uuid NOT NULL REFERENCES public.whatsapp_pin_recovery_attempts(id) ON DELETE RESTRICT,
    operation_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    event_type text NOT NULL CHECK (event_type IN (
        'prepared','authorization_consumed','replacement_created','remote_confirmed',
        'remote_rejected','remote_uncertain','materialization_token_bound','completed','expired','denied'
    )),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX whatsapp_pin_recovery_events_attempt_idx
ON public.whatsapp_pin_recovery_events(attempt_id, created_at);

CREATE FUNCTION public.prevent_whatsapp_pin_recovery_event_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $f$
BEGIN
    RAISE EXCEPTION 'ZION_PIN_RECOVERY_AUDIT_IMMUTABLE' USING ERRCODE = '42501';
END;
$f$;
CREATE TRIGGER whatsapp_pin_recovery_events_immutable
BEFORE UPDATE OR DELETE ON public.whatsapp_pin_recovery_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_whatsapp_pin_recovery_event_mutation();

ALTER TABLE public.whatsapp_pin_recovery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_pin_recovery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_pin_recovery_attempts FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.whatsapp_pin_recovery_events FROM PUBLIC, anon, authenticated, service_role;

-- (1) Prepare one target-locked and time-limited recovery operation.
CREATE FUNCTION public.prepare_whatsapp_pin_recovery_attempt_by_system(
    p_operation_id uuid,
    p_actor_user_id uuid,
    p_organization_id uuid,
    p_store_id uuid,
    p_waba_id text,
    p_phone_number_id text,
    p_historical_secret_id uuid,
    p_session_binding_hash text,
    p_authorization_expires_at timestamptz
)
RETURNS TABLE(attempt_id uuid, operation_id uuid, status text,
              historical_secret_id uuid, expires_at timestamptz, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v public.whatsapp_pin_recovery_attempts%ROWTYPE;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
    END IF;
    IF p_operation_id IS NULL OR p_actor_user_id IS NULL OR p_organization_id IS NULL
       OR p_store_id IS NULL OR p_historical_secret_id IS NULL
       OR nullif(btrim(p_waba_id),'') IS NULL OR nullif(btrim(p_phone_number_id),'') IS NULL
       OR length(coalesce(p_session_binding_hash,'')) NOT BETWEEN 32 AND 256
       OR p_authorization_expires_at IS NULL
       OR p_authorization_expires_at <= clock_timestamp()
       OR p_authorization_expires_at > clock_timestamp() + interval '10 minutes'
    THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_INVALID_PREPARATION' USING ERRCODE='22023';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('zion_pin_recovery:' || p_phone_number_id, 0)
    );
    SELECT * INTO v FROM public.whatsapp_pin_recovery_attempts a
    WHERE a.operation_id=p_operation_id FOR UPDATE;
    IF FOUND THEN
        IF v.actor_user_id <> p_actor_user_id OR v.organization_id <> p_organization_id
           OR v.store_id <> p_store_id OR v.waba_id <> p_waba_id
           OR v.phone_number_id <> p_phone_number_id
           OR v.historical_secret_id <> p_historical_secret_id
           OR v.session_binding_hash <> p_session_binding_hash
           OR v.authorization_expires_at <> p_authorization_expires_at
        THEN
            RAISE EXCEPTION 'ZION_PIN_RECOVERY_OPERATION_CONFLICT' USING ERRCODE='23505';
        END IF;
        RETURN QUERY SELECT v.id, v.operation_id, v.status, v.historical_secret_id,
                            v.authorization_expires_at, 'idempotent_replay'::text;
        RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.stores s
                   WHERE s.id=p_store_id AND s.organization_id=p_organization_id)
       OR NOT EXISTS (SELECT 1 FROM public.zion_internal_admins a
                      WHERE coalesce(pg_catalog.to_jsonb(a)->>'user_id',
                                     pg_catalog.to_jsonb(a)->>'auth_user_id')=p_actor_user_id::text)
       OR NOT EXISTS (SELECT 1 FROM public.whatsapp_phone_security_secrets s
                      WHERE s.id=p_historical_secret_id
                        AND s.organization_id=p_organization_id AND s.store_id=p_store_id
                        AND s.phone_number_id=p_phone_number_id
                        AND s.provider='whatsapp' AND s.secret_kind='two_step_verification_pin'
                        AND s.status='invalidated')
    THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_SCOPE_OR_SECRET_INVALID' USING ERRCODE='42501';
    END IF;
    -- Compare the canonical integration columns, not browser-supplied scope.
    IF EXISTS (
        SELECT 1 FROM public.external_integrations e
        WHERE e.provider='whatsapp' AND e.is_active=true
          AND (e.phone_number_id=p_phone_number_id OR e.store_id=p_store_id)
    ) THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_ACTIVE_BINDING_CONFLICT' USING ERRCODE='23505';
    END IF;
    -- Expire only an unconsumed authorization. Never expire executing/uncertain.
    UPDATE public.whatsapp_pin_recovery_attempts a
       SET status='expired', updated_at=clock_timestamp()
     WHERE a.organization_id=p_organization_id AND a.store_id=p_store_id
       AND a.phone_number_id=p_phone_number_id AND a.status='prepared'
       AND a.authorization_expires_at <= clock_timestamp();
    IF EXISTS (
        SELECT 1 FROM public.whatsapp_pin_recovery_attempts a
         WHERE a.organization_id=p_organization_id AND a.store_id=p_store_id
           AND a.phone_number_id=p_phone_number_id
           AND a.status IN ('prepared','executing','remote_confirmed','remote_uncertain','materialization_pending')
    ) THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_ALREADY_IN_PROGRESS' USING ERRCODE='23505';
    END IF;
    INSERT INTO public.whatsapp_pin_recovery_attempts (
        operation_id, organization_id, store_id, waba_id, phone_number_id,
        historical_secret_id, actor_user_id, session_binding_hash, authorization_expires_at
    ) VALUES (
        p_operation_id, p_organization_id, p_store_id, p_waba_id, p_phone_number_id,
        p_historical_secret_id, p_actor_user_id, p_session_binding_hash, p_authorization_expires_at
    ) RETURNING * INTO v;
    INSERT INTO public.whatsapp_pin_recovery_events(attempt_id,operation_id,actor_user_id,event_type)
    VALUES(v.id,v.operation_id,v.actor_user_id,'prepared');
    RETURN QUERY SELECT v.id,v.operation_id,v.status,v.historical_secret_id,
                        v.authorization_expires_at,'created'::text;
END;
$f$;

-- (2) Consume authorization exactly once; ciphertext stays on server.
CREATE FUNCTION public.begin_whatsapp_pin_recovery_attempt_by_system(
    p_attempt_id uuid, p_operation_id uuid, p_actor_user_id uuid,
    p_session_binding_hash text, p_access_token_fingerprint text,
    p_meta_graph_api_version text, p_meta_app_id text
)
RETURNS TABLE(attempt_id uuid, status text, historical_secret_id uuid,
              ciphertext text, iv text, auth_tag text, key_version integer,
              waba_id text, phone_number_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v public.whatsapp_pin_recovery_attempts%ROWTYPE;
        s public.whatsapp_phone_security_secrets%ROWTYPE;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
    END IF;
    IF p_access_token_fingerprint IS NULL
       OR p_access_token_fingerprint !~ '^[0-9a-f]{64}$'
       OR length(coalesce(p_session_binding_hash,'')) NOT BETWEEN 32 AND 256 THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_MISSING_BINDING' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v FROM public.whatsapp_pin_recovery_attempts a
    WHERE a.id=p_attempt_id FOR UPDATE;
    IF NOT FOUND OR v.operation_id IS DISTINCT FROM p_operation_id
       OR v.actor_user_id IS DISTINCT FROM p_actor_user_id
       OR v.session_binding_hash IS DISTINCT FROM p_session_binding_hash
       OR v.status <> 'prepared' OR v.authorization_expires_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_AUTHORIZATION_INVALID_OR_CONSUMED' USING ERRCODE='42501';
    END IF;
    SELECT * INTO s FROM public.whatsapp_phone_security_secrets h
    WHERE h.id=v.historical_secret_id AND h.organization_id=v.organization_id
      AND h.store_id=v.store_id AND h.phone_number_id=v.phone_number_id
      AND h.status='invalidated' FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_HISTORICAL_SECRET_NOT_FOUND' USING ERRCODE='42501';
    END IF;
    UPDATE public.whatsapp_pin_recovery_attempts a
       SET status='executing', execution_started_at=clock_timestamp(),
           access_token_fingerprint=p_access_token_fingerprint,
           meta_graph_api_version=p_meta_graph_api_version, meta_app_id=p_meta_app_id,
           updated_at=clock_timestamp()
     WHERE a.id=v.id;
    INSERT INTO public.whatsapp_pin_recovery_events(attempt_id,operation_id,actor_user_id,event_type)
    VALUES(v.id,v.operation_id,v.actor_user_id,'authorization_consumed');
    RETURN QUERY SELECT v.id,'executing'::text,s.id,s.ciphertext,s.iv,s.auth_tag,
                        s.key_version,v.waba_id,v.phone_number_id;
END;
$f$;

-- (3) Create a NEW pending row; historical invalidated row is never updated.
-- The TypeScript server must encrypt the SAME PIN with a fresh AES-GCM nonce.
CREATE FUNCTION public.create_whatsapp_pin_recovery_replacement_secret_by_system(
    p_attempt_id uuid,p_operation_id uuid,p_actor_user_id uuid,
    p_ciphertext text,p_iv text,p_auth_tag text,p_key_version integer
)
RETURNS TABLE(replacement_secret_id uuid,status text,outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v public.whatsapp_pin_recovery_attempts%ROWTYPE; v_new record;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
    END IF;
    SELECT * INTO v FROM public.whatsapp_pin_recovery_attempts a
    WHERE a.id=p_attempt_id FOR UPDATE;
    IF NOT FOUND OR v.operation_id IS DISTINCT FROM p_operation_id
       OR v.actor_user_id IS DISTINCT FROM p_actor_user_id OR v.status <> 'executing' THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_REPLACEMENT_NOT_AUTHORIZED' USING ERRCODE='42501';
    END IF;
    IF v.replacement_secret_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.whatsapp_phone_security_secrets s
                       WHERE s.id=v.replacement_secret_id AND s.ciphertext=p_ciphertext
                         AND s.iv=p_iv AND s.auth_tag=p_auth_tag AND s.key_version=p_key_version) THEN
            RAISE EXCEPTION 'ZION_PIN_RECOVERY_REPLACEMENT_CONFLICT' USING ERRCODE='23505';
        END IF;
        RETURN QUERY SELECT v.replacement_secret_id,'pending'::text,'idempotent_replay'::text;
        RETURN;
    END IF;
    SELECT * INTO v_new FROM public.create_whatsapp_phone_security_secret_pending_by_system(
        v.organization_id,v.store_id,'whatsapp',v.phone_number_id,
        p_ciphertext,p_iv,p_auth_tag,p_key_version
    );
    IF v_new.secret_id IS NULL THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_REPLACEMENT_CREATION_FAILED';
    END IF;
    UPDATE public.whatsapp_pin_recovery_attempts a
       SET replacement_secret_id=v_new.secret_id,updated_at=clock_timestamp()
     WHERE a.id=v.id;
    INSERT INTO public.whatsapp_pin_recovery_events(attempt_id,operation_id,actor_user_id,event_type)
    VALUES(v.id,v.operation_id,v.actor_user_id,'replacement_created');
    RETURN QUERY SELECT v_new.secret_id::uuid,'pending'::text,'created'::text;
END;
$f$;

-- (4) Record direct, sanitized backend observation of exactly ONE Graph result.
-- SQL cannot authenticate Meta's response by itself: the calling server must
-- check success === true. VERIFIED or a caller-provided hash is not proof.
CREATE FUNCTION public.record_whatsapp_pin_recovery_remote_result_by_system(
    p_attempt_id uuid,p_operation_id uuid,p_actor_user_id uuid,
    p_result text,p_http_status integer,p_meta_error_code text,
    p_meta_request_id text,p_remote_evidence_hash text
)
RETURNS TABLE(attempt_id uuid,status text,outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v public.whatsapp_pin_recovery_attempts%ROWTYPE; v_status text;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
    END IF;
    IF p_result NOT IN ('confirmed','rejected','uncertain') OR p_result IS NULL THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_RESULT_INVALID' USING ERRCODE='22023';
    END IF;
    IF p_result='confirmed' AND (p_http_status IS NULL OR p_http_status NOT BETWEEN 200 AND 299
        OR nullif(btrim(coalesce(p_remote_evidence_hash,'')),'') IS NULL) THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_CONFIRMATION_EVIDENCE_REQUIRED' USING ERRCODE='22023';
    END IF;
    IF p_result='rejected' AND (p_http_status IS NULL OR p_http_status NOT IN (400,401,403)
        OR nullif(btrim(coalesce(p_meta_error_code,'')),'') IS NULL) THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_DETERMINISTIC_REJECTION_REQUIRED' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v FROM public.whatsapp_pin_recovery_attempts a
    WHERE a.id=p_attempt_id FOR UPDATE;
    IF NOT FOUND OR v.operation_id IS DISTINCT FROM p_operation_id
       OR v.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_RESULT_TARGET_INVALID' USING ERRCODE='42501';
    END IF;
    v_status := CASE p_result WHEN 'confirmed' THEN 'remote_confirmed'
                WHEN 'rejected' THEN 'remote_rejected' ELSE 'remote_uncertain' END;
    IF v.status=v_status THEN
        IF v.remote_http_status IS DISTINCT FROM p_http_status
           OR v.remote_evidence_hash IS DISTINCT FROM p_remote_evidence_hash
           OR v.remote_error_code IS DISTINCT FROM p_meta_error_code THEN
            RAISE EXCEPTION 'ZION_PIN_RECOVERY_RESULT_REPLAY_CONFLICT' USING ERRCODE='23505';
        END IF;
        RETURN QUERY SELECT v.id,v.status,'idempotent_replay'::text;
        RETURN;
    END IF;
    IF v.status <> 'executing' OR v.replacement_secret_id IS NULL THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_RESULT_NOT_EXPECTED' USING ERRCODE='42501';
    END IF;
    UPDATE public.whatsapp_pin_recovery_attempts a
       SET status=v_status,remote_http_status=p_http_status,
           remote_error_code=left(p_meta_error_code,128),
           remote_request_id=left(p_meta_request_id,256),
           remote_evidence_hash=left(p_remote_evidence_hash,256),
           remote_result_at=clock_timestamp(), updated_at=clock_timestamp()
     WHERE a.id=v.id;
    IF p_result='rejected' THEN
        PERFORM 1 FROM public.invalidate_whatsapp_phone_security_secret_by_system(
            v.organization_id,v.store_id,v.replacement_secret_id
        );
    END IF;
    INSERT INTO public.whatsapp_pin_recovery_events(attempt_id,operation_id,actor_user_id,event_type,
                                                    metadata)
    VALUES(v.id,v.operation_id,v.actor_user_id,v_status,
           pg_catalog.jsonb_build_object('http_status',p_http_status,
                                          'has_request_id',p_meta_request_id IS NOT NULL));
    RETURN QUERY SELECT v.id,v_status,'recorded'::text;
END;
$f$;

-- (5) Bind a freshly validated, replacement OAuth token for LOCAL materialization.
-- Does NOT authorize another /register and may run only after explicit Graph success.
-- The backend must validate fresh Meta OAuth and the same WABA/phone before calling.
-- The SQL RPC cannot independently attest that external validation happened.
CREATE FUNCTION public.authorize_whatsapp_pin_recovery_materialization_token_by_system(
    p_attempt_id uuid,p_operation_id uuid,p_actor_user_id uuid,
    p_session_binding_hash text,p_access_token_fingerprint text,p_validated_at timestamptz
)
RETURNS TABLE(attempt_id uuid,status text,outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v public.whatsapp_pin_recovery_attempts%ROWTYPE;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
    END IF;
    IF p_access_token_fingerprint IS NULL
       OR p_access_token_fingerprint !~ '^[0-9a-f]{64}$'
       OR p_validated_at IS NULL
       OR p_validated_at > clock_timestamp() + interval '30 seconds'
       OR p_validated_at < clock_timestamp() - interval '5 minutes'
       OR length(coalesce(p_session_binding_hash,'')) NOT BETWEEN 32 AND 256 THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_FRESH_OAUTH_VALIDATION_REQUIRED' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v FROM public.whatsapp_pin_recovery_attempts a
    WHERE a.id=p_attempt_id FOR UPDATE;
    IF NOT FOUND OR v.operation_id IS DISTINCT FROM p_operation_id
       OR v.actor_user_id IS DISTINCT FROM p_actor_user_id
       OR v.session_binding_hash IS DISTINCT FROM p_session_binding_hash
       OR v.status <> 'remote_confirmed' OR v.remote_evidence_hash IS NULL
       OR v.remote_http_status IS NULL OR v.remote_http_status NOT BETWEEN 200 AND 299
       OR p_validated_at < v.remote_result_at THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_MATERIALIZATION_NOT_AUTHORIZED' USING ERRCODE='42501';
    END IF;
    IF v.materialization_token_fingerprint IS NOT NULL
       AND v.materialization_token_fingerprint = p_access_token_fingerprint THEN
        RETURN QUERY SELECT v.id,v.status,'idempotent_replay'::text;
        RETURN;
    END IF;
    -- A later fresh authorization may replace a previous MATERIALIZATION fingerprint;
    -- registration fingerprint remains immutable. Every rebinding is audited.
    UPDATE public.whatsapp_pin_recovery_attempts a
       SET materialization_token_fingerprint=p_access_token_fingerprint,
           materialization_token_validated_at=p_validated_at,updated_at=clock_timestamp()
     WHERE a.id=v.id;
    INSERT INTO public.whatsapp_pin_recovery_events(attempt_id,operation_id,actor_user_id,event_type)
    VALUES(v.id,v.operation_id,v.actor_user_id,'materialization_token_bound');
    RETURN QUERY SELECT v.id,v.status,'bound'::text;
END;
$f$;

-- (6) Deliberate fail-closed reconciliation: no independent attestation
-- is currently implemented. A hash/request-id alone must NEVER turn an
-- uncertain external operation into remote_confirmed.
CREATE FUNCTION public.reconcile_whatsapp_pin_recovery_remote_confirmation_by_system(
    p_attempt_id uuid,p_operation_id uuid,p_actor_user_id uuid,
    p_remote_request_id text,p_remote_evidence_hash text
)
RETURNS TABLE(attempt_id uuid,status text,outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
BEGIN
    RAISE EXCEPTION 'ZION_PIN_RECOVERY_INDEPENDENT_META_EVIDENCE_NOT_IMPLEMENTED'
        USING ERRCODE='42501';
END;
$f$;

-- (7) Complete recovery atomically with canonical secret activation.
-- The canonical integration writer must have run only after confirmed Graph success.
CREATE FUNCTION public.finalize_whatsapp_pin_recovery_materialization_by_system(
    p_attempt_id uuid,p_operation_id uuid,p_actor_user_id uuid,
    p_integration_id uuid,p_access_token_fingerprint text,
    p_meta_graph_api_version text,p_meta_app_id text,p_validated_at timestamptz
)
RETURNS TABLE(attempt_id uuid,status text,integration_id uuid,
              replacement_secret_id uuid,outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v public.whatsapp_pin_recovery_attempts%ROWTYPE;
        e public.external_integrations%ROWTYPE;
        v_activation record;
        v_waba text;
        v_expected_fingerprint text;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
    END IF;
    SELECT * INTO v FROM public.whatsapp_pin_recovery_attempts a
    WHERE a.id=p_attempt_id FOR UPDATE;
    IF NOT FOUND OR v.operation_id IS DISTINCT FROM p_operation_id
       OR v.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_FINALIZATION_SCOPE_INVALID' USING ERRCODE='42501';
    END IF;
    IF v.status='completed' THEN
        IF v.integration_id IS DISTINCT FROM p_integration_id THEN
            RAISE EXCEPTION 'ZION_PIN_RECOVERY_FINALIZATION_REPLAY_CONFLICT' USING ERRCODE='23505';
        END IF;
        RETURN QUERY SELECT v.id,v.status,v.integration_id,v.replacement_secret_id,'idempotent_replay'::text;
        RETURN;
    END IF;
    v_expected_fingerprint := coalesce(v.materialization_token_fingerprint,
                                       v.access_token_fingerprint);
    IF v.status <> 'remote_confirmed' OR v.replacement_secret_id IS NULL
       OR v.remote_evidence_hash IS NULL OR v.remote_http_status IS NULL OR v.remote_http_status NOT BETWEEN 200 AND 299
       OR v_expected_fingerprint IS NULL
       OR v_expected_fingerprint IS DISTINCT FROM p_access_token_fingerprint
       OR p_validated_at IS NULL
       OR p_validated_at > clock_timestamp() + interval '30 seconds'
       OR p_validated_at < clock_timestamp() - interval '10 minutes'
       OR (v.materialization_token_validated_at IS NOT NULL
           AND p_validated_at < v.materialization_token_validated_at) THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_FINALIZATION_NOT_AUTHORIZED' USING ERRCODE='42501';
    END IF;
    SELECT * INTO e FROM public.external_integrations i WHERE i.id=p_integration_id FOR SHARE;
    IF NOT FOUND OR e.organization_id <> v.organization_id OR e.store_id <> v.store_id
       OR e.provider <> 'whatsapp' OR e.status <> 'active' OR NOT e.is_active
       OR e.phone_number_id <> v.phone_number_id THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_INTEGRATION_NOT_VALID' USING ERRCODE='42501';
    END IF;
    -- Ensure the token actually materialized by the CANONICAL writer is the one
    -- validated for this attempt. SHA-256 exists in PostgreSQL 15+ / Supabase.
    -- This is a fingerprint comparison, never a token returned or persisted here.
    IF e.access_token IS NULL OR pg_catalog.encode(
         pg_catalog.sha256(pg_catalog.convert_to(e.access_token,'UTF8')),'hex'
       ) IS DISTINCT FROM p_access_token_fingerprint THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_MATERIALIZED_TOKEN_MISMATCH' USING ERRCODE='42501';
    END IF;
    v_waba := coalesce(pg_catalog.to_jsonb(e)->>'whatsapp_business_account_id',
                       pg_catalog.to_jsonb(e)->>'waba_id',
                       pg_catalog.to_jsonb(e)->'metadata'->>'waba_id');
    IF v_waba IS DISTINCT FROM v.waba_id THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_WABA_MISMATCH' USING ERRCODE='42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.whatsapp_phone_security_secrets s
                   WHERE s.id=v.replacement_secret_id AND s.organization_id=v.organization_id
                     AND s.store_id=v.store_id AND s.phone_number_id=v.phone_number_id
                     AND s.status='pending') THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_PENDING_SECRET_MISSING' USING ERRCODE='42501';
    END IF;
    SELECT * INTO v_activation FROM public.activate_whatsapp_phone_security_secret_by_system(
        v.organization_id,v.store_id,'whatsapp',v.phone_number_id,p_integration_id
    );
    IF v_activation.secret_id IS DISTINCT FROM v.replacement_secret_id
       OR v_activation.status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'ZION_PIN_RECOVERY_SECRET_ACTIVATION_MISMATCH' USING ERRCODE='42501';
    END IF;
    UPDATE public.whatsapp_pin_recovery_attempts a
       SET status='completed',integration_id=p_integration_id,
           finalized_at=clock_timestamp(),updated_at=clock_timestamp()
     WHERE a.id=v.id;
    INSERT INTO public.whatsapp_pin_recovery_events(attempt_id,operation_id,actor_user_id,event_type)
    VALUES(v.id,v.operation_id,v.actor_user_id,'completed');
    RETURN QUERY SELECT v.id,'completed'::text,p_integration_id,v.replacement_secret_id,'completed'::text;
END;
$f$;

REVOKE ALL ON FUNCTION public.prevent_whatsapp_pin_recovery_event_mutation() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.prepare_whatsapp_pin_recovery_attempt_by_system(uuid,uuid,uuid,uuid,text,text,uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.begin_whatsapp_pin_recovery_attempt_by_system(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_whatsapp_pin_recovery_replacement_secret_by_system(uuid,uuid,uuid,text,text,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_whatsapp_pin_recovery_remote_result_by_system(uuid,uuid,uuid,text,integer,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.authorize_whatsapp_pin_recovery_materialization_token_by_system(uuid,uuid,uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reconcile_whatsapp_pin_recovery_remote_confirmation_by_system(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finalize_whatsapp_pin_recovery_materialization_by_system(uuid,uuid,uuid,uuid,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_whatsapp_pin_recovery_attempt_by_system(uuid,uuid,uuid,uuid,text,text,uuid,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_whatsapp_pin_recovery_attempt_by_system(uuid,uuid,uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_whatsapp_pin_recovery_replacement_secret_by_system(uuid,uuid,uuid,text,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_pin_recovery_remote_result_by_system(uuid,uuid,uuid,text,integer,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.authorize_whatsapp_pin_recovery_materialization_token_by_system(uuid,uuid,uuid,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_whatsapp_pin_recovery_remote_confirmation_by_system(uuid,uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_whatsapp_pin_recovery_materialization_by_system(uuid,uuid,uuid,uuid,text,text,text,timestamptz) TO service_role;

COMMIT;
