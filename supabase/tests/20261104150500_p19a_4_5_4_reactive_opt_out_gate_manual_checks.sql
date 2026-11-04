-- P19-A 4.5.4 manual checks.
-- Run only against an approved disposable/staging database after the migration.
-- This file is intentionally not executed by the local validation.

BEGIN;

DO $checks$
DECLARE
  v_definition text;
  v_oid oid := pg_catalog.to_regprocedure(
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'
  );
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'P19A_4_5_4_GATE_MISSING';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_oid)
    INTO STRICT v_definition;

  IF pg_catalog.strpos(v_definition,
       'elsif v_any_opt_out_exists then') > 0 THEN
    RAISE EXCEPTION 'P19A_4_5_4_REACTIVE_OPT_OUT_STILL_PRESENT';
  END IF;

  IF pg_catalog.strpos(v_definition,
       'if v_outbound_kind = ''stop_contact_ack'' then') = 0
     OR pg_catalog.strpos(v_definition,
       'stop_contact_ack_without_exact_opt_out_source') = 0 THEN
    RAISE EXCEPTION 'P19A_4_5_4_STOP_ACK_GUARD_MISSING';
  END IF;

  IF pg_catalog.strpos(v_definition,
       'elsif v_outbound_kind = ''canonical_followup'' then') = 0
     OR pg_catalog.strpos(v_definition,
       'v_block_reason := ''commercial_opportunity_opted_out'';') = 0 THEN
    RAISE EXCEPTION 'P19A_4_5_4_FOLLOWUP_OPTOUT_GUARD_MISSING';
  END IF;
END;
$checks$;

-- Behavioral fixture matrix to execute only in an approved isolated database:
-- 1. opted-out opportunity + valid reactive_ai_reply => not blocked by opt-out;
-- 2. same opportunity + canonical_followup => blocked;
-- 3. stop_contact_ack without exact event => blocked;
-- 4. stop_contact_ack with exact source event => allowed;
-- 5. cross-organization/store message => blocked;
-- 6. concurrent replay => existing lock/idempotency behavior remains unchanged.

ROLLBACK;
