-- ZION-ADM / D10-G0
-- Canonical transactional authority for human contract-rule reviews.
-- Preparation only: do not apply before integration review.
--
-- The backend authenticates the user and authorizes the store.
-- This RPC is executable only by service_role.
-- Existing extraction and activation authorities are preserved.

BEGIN;

ALTER TABLE public.store_contract_template_extracted_rules
  ADD COLUMN IF NOT EXISTS review_revision bigint NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid =
      'public.store_contract_template_extracted_rules'::regclass
      AND conname =
        'zion_adm_contract_rule_revision_nonnegative_ck'
  ) THEN
    ALTER TABLE public.store_contract_template_extracted_rules
      ADD CONSTRAINT
        zion_adm_contract_rule_revision_nonnegative_ck
      CHECK (review_revision >= 0);
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.store_contract_template_extracted_rules
    WHERE review_revision < 0
  ) THEN
    RAISE EXCEPTION 'ZION_ADM_RULE_INVALID_EXISTING_REVISION';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.store_contract_template_rule_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  store_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  template_version_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  previous_review_status text NOT NULL,
  new_review_status text NOT NULL,

  previous_value_text text,
  new_value_text text,

  previous_label text NOT NULL,
  new_label text NOT NULL,

  expected_revision bigint NOT NULL,
  new_revision bigint NOT NULL,

  idempotency_key uuid NOT NULL,
  request_payload jsonb NOT NULL,
  new_rule_snapshot jsonb NOT NULL,

  CONSTRAINT zion_adm_rule_review_old_status_ck
    CHECK (
      previous_review_status IN (
        'pending', 'approved', 'rejected', 'edited'
      )
    ),

  CONSTRAINT zion_adm_rule_review_new_status_ck
    CHECK (
      new_review_status IN (
        'approved', 'rejected', 'edited'
      )
    ),

  CONSTRAINT zion_adm_rule_review_revision_ck
    CHECK (
      expected_revision >= 0
      AND new_revision = expected_revision + 1
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS
  zion_adm_rule_review_idempotency_uidx
ON public.store_contract_template_rule_review_events (
  organization_id,
  store_id,
  rule_id,
  idempotency_key
);

CREATE UNIQUE INDEX IF NOT EXISTS
  zion_adm_rule_review_revision_uidx
ON public.store_contract_template_rule_review_events (
  organization_id,
  store_id,
  rule_id,
  new_revision
);

CREATE INDEX IF NOT EXISTS
  zion_adm_rule_review_history_idx
ON public.store_contract_template_rule_review_events (
  organization_id,
  store_id,
  rule_id,
  reviewed_at DESC
);

ALTER TABLE public.store_contract_template_rule_review_events
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
ON TABLE public.store_contract_template_rule_review_events
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT
ON TABLE public.store_contract_template_rule_review_events
TO service_role;

-- The history must not be rewritten or deleted.
CREATE OR REPLACE FUNCTION
public.zion_adm_guard_contract_rule_review_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RAISE EXCEPTION
    'ZION_ADM_CONTRACT_RULE_REVIEW_HISTORY_IMMUTABLE';
END;
$function$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid =
      'public.store_contract_template_rule_review_events'::regclass
      AND tgname =
        'zion_adm_contract_rule_review_history_guard_trg'
  ) THEN
    CREATE TRIGGER
      zion_adm_contract_rule_review_history_guard_trg
    BEFORE UPDATE OR DELETE
    ON public.store_contract_template_rule_review_events
    FOR EACH ROW
    EXECUTE FUNCTION
      public.zion_adm_guard_contract_rule_review_event_mutation();
  END IF;
END;
$$;

REVOKE ALL
ON FUNCTION
public.zion_adm_guard_contract_rule_review_event_mutation()
FROM PUBLIC, anon, authenticated;

-- Canonical review authority.
CREATE OR REPLACE FUNCTION
public.review_store_contract_template_rule_by_system(
  p_rule_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_actor_user_id uuid,
  p_expected_revision bigint,
  p_idempotency_key uuid,
  p_review_status text,
  p_value_text text DEFAULT NULL,
  p_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_version_id uuid;
  v_template_id uuid;
  v_locked_template_id uuid;
  v_version_status text;
  v_version_rejected_at timestamptz;

  v_rule public.store_contract_template_extracted_rules%ROWTYPE;
  v_updated public.store_contract_template_extracted_rules%ROWTYPE;
  v_event public.store_contract_template_rule_review_events%ROWTYPE;

  v_value_text text;
  v_label text;
  v_payload jsonb;
  v_now timestamptz;
  v_event_id uuid;
BEGIN
  IF p_rule_id IS NULL
     OR p_organization_id IS NULL
     OR p_store_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_expected_revision IS NULL
     OR p_idempotency_key IS NULL
  THEN
    RAISE EXCEPTION 'ZION_ADM_RULE_REVIEW_INVALID_ARGUMENTS';
  END IF;

  IF p_expected_revision < 0 THEN
    RAISE EXCEPTION 'ZION_ADM_RULE_REVIEW_INVALID_REVISION';
  END IF;

  IF p_review_status IS NULL
     OR p_review_status NOT IN (
       'approved', 'rejected', 'edited'
     )
  THEN
    RAISE EXCEPTION 'ZION_ADM_RULE_REVIEW_INVALID_STATUS';
  END IF;

  IF p_review_status = 'edited'
     AND NULLIF(BTRIM(COALESCE(p_value_text, '')), '')
       IS NULL
  THEN
    RAISE EXCEPTION 'ZION_ADM_RULE_REVIEW_VALUE_REQUIRED';
  END IF;

  IF p_label IS NOT NULL
     AND NULLIF(BTRIM(p_label), '') IS NULL
  THEN
    RAISE EXCEPTION 'ZION_ADM_RULE_REVIEW_INVALID_LABEL';
  END IF;

  v_payload := jsonb_build_object(
    'reviewStatus', p_review_status,
    'valueText', p_value_text,
    'label', p_label
  );

  -- Resolve scope without locks, then revalidate under locks.
  SELECT
    r.template_version_id,
    v.template_id
  INTO
    v_version_id,
    v_template_id
  FROM public.store_contract_template_extracted_rules r
  JOIN public.store_contract_template_versions v
    ON v.id = r.template_version_id
   AND v.organization_id = r.organization_id
   AND v.store_id = r.store_id
  WHERE r.id = p_rule_id
    AND r.organization_id = p_organization_id
    AND r.store_id = p_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'ZION_ADM_RULE_REVIEW_NOT_FOUND_OR_OUT_OF_SCOPE';
  END IF;

  -- Lock order: template -> version -> rule.
  -- Compatible with the existing activation authority.
  SELECT t.id
  INTO v_locked_template_id
  FROM public.store_contract_templates t
  WHERE t.id = v_template_id
    AND t.organization_id = p_organization_id
    AND t.store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'ZION_ADM_RULE_REVIEW_TEMPLATE_NOT_FOUND';
  END IF;

  SELECT
    v.status,
    v.rejected_at
  INTO
    v_version_status,
    v_version_rejected_at
  FROM public.store_contract_template_versions v
  WHERE v.id = v_version_id
    AND v.template_id = v_locked_template_id
    AND v.organization_id = p_organization_id
    AND v.store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'ZION_ADM_RULE_REVIEW_VERSION_NOT_FOUND';
  END IF;

  SELECT r.*
  INTO v_rule
  FROM public.store_contract_template_extracted_rules r
  WHERE r.id = p_rule_id
    AND r.template_version_id = v_version_id
    AND r.organization_id = p_organization_id
    AND r.store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'ZION_ADM_RULE_REVIEW_RULE_NOT_FOUND';
  END IF;

  -- Exact replay is allowed even if the version was
  -- subsequently activated or archived.
  SELECT e.*
  INTO v_event
  FROM public.store_contract_template_rule_review_events e
  WHERE e.organization_id = p_organization_id
    AND e.store_id = p_store_id
    AND e.rule_id = p_rule_id
    AND e.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_event.actor_user_id IS DISTINCT FROM p_actor_user_id
       OR v_event.expected_revision IS DISTINCT
          FROM p_expected_revision
       OR v_event.request_payload IS DISTINCT FROM v_payload
    THEN
      RAISE EXCEPTION
        'ZION_ADM_RULE_REVIEW_IDEMPOTENCY_KEY_REUSED';
    END IF;

    RETURN jsonb_build_object(
      'rule', v_event.new_rule_snapshot,
      'eventId', v_event.id,
      'replayed', true
    );
  END IF;

  IF v_version_status NOT IN (
    'analyzed', 'awaiting_review'
  ) OR v_version_rejected_at IS NOT NULL THEN
    RAISE EXCEPTION
      'ZION_ADM_RULE_REVIEW_VERSION_READ_ONLY';
  END IF;

  IF v_rule.review_revision <> p_expected_revision THEN
    RAISE EXCEPTION
      'ZION_ADM_RULE_REVIEW_CONFLICT';
  END IF;

  v_value_text :=
    CASE
      WHEN p_review_status = 'edited'
        THEN BTRIM(p_value_text)
      ELSE v_rule.value_text
    END;

  v_label :=
    CASE
      WHEN p_label IS NOT NULL
        THEN BTRIM(p_label)
      ELSE v_rule.label
    END;

  v_now := clock_timestamp();

  UPDATE public.store_contract_template_extracted_rules
  SET
    review_status = p_review_status,
    value_text = v_value_text,
    label = v_label,
    review_revision = review_revision + 1,
    updated_at = v_now
  WHERE id = p_rule_id
    AND template_version_id = v_version_id
    AND organization_id = p_organization_id
    AND store_id = p_store_id
    AND review_revision = p_expected_revision
  RETURNING *
  INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ZION_ADM_RULE_REVIEW_CONFLICT';
  END IF;

  INSERT INTO public.store_contract_template_rule_review_events (
    organization_id,
    store_id,
    rule_id,
    template_version_id,
    actor_user_id,
    reviewed_at,
    previous_review_status,
    new_review_status,
    previous_value_text,
    new_value_text,
    previous_label,
    new_label,
    expected_revision,
    new_revision,
    idempotency_key,
    request_payload,
    new_rule_snapshot
  )
  VALUES (
    p_organization_id,
    p_store_id,
    p_rule_id,
    v_version_id,
    p_actor_user_id,
    v_now,
    v_rule.review_status,
    v_updated.review_status,
    v_rule.value_text,
    v_updated.value_text,
    v_rule.label,
    v_updated.label,
    p_expected_revision,
    v_updated.review_revision,
    p_idempotency_key,
    v_payload,
    to_jsonb(v_updated)
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'rule', to_jsonb(v_updated),
    'eventId', v_event_id,
    'replayed', false
  );
END;
$function$;

ALTER FUNCTION public.review_store_contract_template_rule_by_system(
  uuid, uuid, uuid, uuid, bigint, uuid, text, text, text
) OWNER TO postgres;

REVOKE ALL
ON FUNCTION
public.review_store_contract_template_rule_by_system(
  uuid, uuid, uuid, uuid, bigint, uuid, text, text, text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION
public.review_store_contract_template_rule_by_system(
  uuid, uuid, uuid, uuid, bigint, uuid, text, text, text
)
TO service_role;

COMMIT;
