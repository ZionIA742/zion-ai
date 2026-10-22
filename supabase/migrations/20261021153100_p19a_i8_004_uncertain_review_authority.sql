-- ZION / CENTRAL I8 / I8-004
-- SQL executado anteriormente em producao via Supabase SQL Editor.
-- ARQUIVO DE RECONCILIACAO: NAO EXECUTAR NOVAMENTE.
-- Nao registrar como migration pendente antes de reconciliar o historico remoto.
-- Revisao humana auditada de mensagens uncertain.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.messages') IS NULL THEN
    RAISE EXCEPTION 'I8_004_MESSAGES_TABLE_MISSING';
  END IF;

  IF pg_catalog.to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'I8_004_SERVICE_ROLE_MISSING';
  END IF;

  IF pg_catalog.to_regclass(
    'public.i8_whatsapp_uncertain_review_events'
  ) IS NOT NULL THEN
    RAISE EXCEPTION
      'I8_004_REVIEW_TABLE_ALREADY_EXISTS_RECONCILE';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.record_i8_whatsapp_uncertain_review_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text,text)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION
      'I8_004_REVIEW_RPC_ALREADY_EXISTS_RECONCILE';
  END IF;
END;
$preflight$;

CREATE TABLE public.i8_whatsapp_uncertain_review_events (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),

  organization_id uuid NOT NULL,
  store_id uuid NOT NULL,
  message_id uuid NOT NULL,

  outbound_attempt_started_at timestamptz NOT NULL,
  outbound_uncertain_at timestamptz NOT NULL,
  outbound_idempotency_key text,

  actor_user_id uuid NOT NULL,
  operation_key uuid NOT NULL,

  review_action text NOT NULL,
  evidence_kind text NOT NULL DEFAULT 'none',
  evidence_reference text,
  review_note text,

  created_at timestamptz NOT NULL
    DEFAULT pg_catalog.clock_timestamp(),

  CONSTRAINT i8_004_review_message_scope_fk
    FOREIGN KEY (message_id, organization_id, store_id)
    REFERENCES public.messages (id, organization_id, store_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT i8_004_review_action_check
    CHECK (
      review_action IN (
        'investigating',
        'inconclusive',
        'escalated',
        'reference_unverified'
      )
    ),

  CONSTRAINT i8_004_review_evidence_kind_check
    CHECK (
      evidence_kind IN (
        'none',
        'internal_observation',
        'provider_reference_unverified',
        'customer_report'
      )
    ),

  CONSTRAINT i8_004_review_reference_length_check
    CHECK (
      evidence_reference IS NULL
      OR pg_catalog.char_length(evidence_reference) <= 512
    ),

  CONSTRAINT i8_004_review_note_length_check
    CHECK (
      review_note IS NULL
      OR pg_catalog.char_length(review_note) <= 1500
    ),

  CONSTRAINT i8_004_review_operation_unique
    UNIQUE (
      message_id,
      outbound_attempt_started_at,
      operation_key
    )
);

CREATE INDEX i8_004_review_scope_created_idx
ON public.i8_whatsapp_uncertain_review_events (
  organization_id,
  store_id,
  created_at DESC
);

ALTER TABLE public.i8_whatsapp_uncertain_review_events
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.i8_whatsapp_uncertain_review_events
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION
  public.i8_004_reject_uncertain_review_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION USING
    errcode = '55000',
    message = 'I8_004_REVIEW_IS_APPEND_ONLY';
END;
$function$;

CREATE TRIGGER
  i8_004_prevent_review_update_delete
BEFORE UPDATE OR DELETE
ON public.i8_whatsapp_uncertain_review_events
FOR EACH ROW
EXECUTE FUNCTION
  public.i8_004_reject_uncertain_review_mutation();

REVOKE ALL ON FUNCTION
  public.i8_004_reject_uncertain_review_mutation()
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION
public.record_i8_whatsapp_uncertain_review_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_message_id uuid,
  p_actor_user_id uuid,
  p_operation_key uuid,
  p_review_action text,
  p_evidence_kind text DEFAULT 'none',
  p_evidence_reference text DEFAULT NULL,
  p_review_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_message public.messages%ROWTYPE;
  v_review_id uuid;
  v_existing
    public.i8_whatsapp_uncertain_review_events%ROWTYPE;
  v_evidence_kind text;
BEGIN

  IF p_organization_id IS NULL
     OR p_store_id IS NULL
     OR p_message_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_operation_key IS NULL
  THEN
    RAISE EXCEPTION USING
      errcode = '22023',
      message = 'I8_004_INVALID_IDENTITY';
  END IF;

  IF p_review_action IS NULL
     OR p_review_action NOT IN (
       'investigating',
       'inconclusive',
       'escalated',
       'reference_unverified'
     )
  THEN
    RAISE EXCEPTION USING
      errcode = '22023',
      message = 'I8_004_INVALID_REVIEW_ACTION';
  END IF;

  v_evidence_kind := COALESCE(p_evidence_kind, 'none');

  IF v_evidence_kind NOT IN (
    'none',
    'internal_observation',
    'provider_reference_unverified',
    'customer_report'
  )
  THEN
    RAISE EXCEPTION USING
      errcode = '22023',
      message = 'I8_004_INVALID_EVIDENCE_KIND';
  END IF;

  IF pg_catalog.char_length(
       COALESCE(p_evidence_reference, '')
     ) > 512
     OR pg_catalog.char_length(
       COALESCE(p_review_note, '')
     ) > 1500
  THEN
    RAISE EXCEPTION USING
      errcode = '22023',
      message = 'I8_004_REVIEW_TEXT_TOO_LONG';
  END IF;

  SELECT m.*
  INTO v_message
  FROM public.messages m
  WHERE m.id = p_message_id
    AND m.organization_id = p_organization_id
    AND m.store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      errcode = '42501',
      message = 'I8_004_MESSAGE_NOT_IN_SCOPE';
  END IF;

  IF v_message.direction IS DISTINCT FROM 'outgoing'
     OR v_message.sender IS DISTINCT FROM 'ai'
  THEN
    RAISE EXCEPTION USING
      errcode = '23514',
      message = 'I8_004_NOT_AI_OUTBOUND';
  END IF;

  IF v_message.outbound_delivery_state
       IS DISTINCT FROM 'uncertain'
     OR v_message.outbound_attempt_started_at IS NULL
     OR v_message.outbound_uncertain_at IS NULL
  THEN
    RAISE EXCEPTION USING
      errcode = '23514',
      message = 'I8_004_NOT_AN_UNCERTAIN_ATTEMPT';
  END IF;

  INSERT INTO
    public.i8_whatsapp_uncertain_review_events (
      organization_id,
      store_id,
      message_id,
      outbound_attempt_started_at,
      outbound_uncertain_at,
      outbound_idempotency_key,
      actor_user_id,
      operation_key,
      review_action,
      evidence_kind,
      evidence_reference,
      review_note
    )
  VALUES (
    p_organization_id,
    p_store_id,
    p_message_id,
    v_message.outbound_attempt_started_at,
    v_message.outbound_uncertain_at,
    v_message.outbound_idempotency_key,
    p_actor_user_id,
    p_operation_key,
    p_review_action,
    v_evidence_kind,
    p_evidence_reference,
    p_review_note
  )
  ON CONFLICT ON CONSTRAINT
    i8_004_review_operation_unique
  DO NOTHING
  RETURNING id INTO v_review_id;

  IF v_review_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'review_id', v_review_id,
      'result', 'recorded',
      'outbound_delivery_state', 'uncertain',
      'message_state_changed', false,
      'message_retried', false
    );
  END IF;

  SELECT r.*
  INTO v_existing
  FROM public.i8_whatsapp_uncertain_review_events r
  WHERE r.message_id = p_message_id
    AND r.outbound_attempt_started_at =
      v_message.outbound_attempt_started_at
    AND r.operation_key = p_operation_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'I8_004_IDEMPOTENCY_RECORD_NOT_FOUND';
  END IF;

  IF v_existing.organization_id
       IS DISTINCT FROM p_organization_id
     OR v_existing.store_id
       IS DISTINCT FROM p_store_id
     OR v_existing.actor_user_id
       IS DISTINCT FROM p_actor_user_id
     OR v_existing.review_action
       IS DISTINCT FROM p_review_action
     OR v_existing.evidence_kind
       IS DISTINCT FROM v_evidence_kind
     OR v_existing.evidence_reference
       IS DISTINCT FROM p_evidence_reference
     OR v_existing.review_note
       IS DISTINCT FROM p_review_note
  THEN
    RAISE EXCEPTION USING
      errcode = '23505',
      message = 'I8_004_IDEMPOTENCY_CONFLICT';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'review_id', v_existing.id,
    'result', 'already_recorded',
    'outbound_delivery_state', 'uncertain',
    'message_state_changed', false,
    'message_retried', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION
public.record_i8_whatsapp_uncertain_review_by_system(
  uuid, uuid, uuid, uuid, uuid,
  text, text, text, text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.record_i8_whatsapp_uncertain_review_by_system(
  uuid, uuid, uuid, uuid, uuid,
  text, text, text, text
)
TO service_role;

DO $postcheck$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    WHERE c.oid =
      'public.i8_whatsapp_uncertain_review_events'::regclass
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION
      'I8_004_RLS_NOT_ENABLED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid =
      'public.i8_whatsapp_uncertain_review_events'::regclass
      AND t.tgname =
        'i8_004_prevent_review_update_delete'
      AND NOT t.tgisinternal
      AND t.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION
      'I8_004_APPEND_ONLY_TRIGGER_MISSING';
  END IF;

  IF pg_catalog.has_function_privilege(
       'authenticated',
       'public.record_i8_whatsapp_uncertain_review_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text,text)'::regprocedure,
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION
      'I8_004_RPC_EXPOSED_TO_AUTHENTICATED';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'service_role',
       'public.record_i8_whatsapp_uncertain_review_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text,text)'::regprocedure,
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION
      'I8_004_RPC_SERVICE_ROLE_NOT_GRANTED';
  END IF;
END;
$postcheck$;

COMMIT;
