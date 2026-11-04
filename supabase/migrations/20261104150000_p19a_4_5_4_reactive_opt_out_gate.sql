-- P19-A 4.5.4: remove only the commercial opt-out block from reactive_ai_reply.
--
-- This migration deliberately patches the definition installed in the database,
-- rather than comparing a local SQL hash with pg_get_functiondef(). It aborts
-- unless the exact expected fragment occurs once and all security attributes
-- remain unchanged. It also aborts if the patch was already applied or if the
-- canonical-followup opt-out guard is missing.

BEGIN;

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $migration$
DECLARE
  v_gate_oid oid := pg_catalog.to_regprocedure(
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'
  );
  v_before record;
  v_after record;
  v_old_fragment text := $old$
        if v_outbound_kind = 'stop_contact_ack' then
          if not v_stop_event_exists then
            v_block_reason :=
              'stop_contact_ack_without_exact_opt_out_source';
          end if;
        elsif v_any_opt_out_exists then
          v_block_reason := 'commercial_opportunity_opted_out';
        end if;
$old$;
  v_new_fragment text := $new$
        if v_outbound_kind = 'stop_contact_ack' then
          if not v_stop_event_exists then
            v_block_reason :=
              'stop_contact_ack_without_exact_opt_out_source';
          end if;
        end if;
$new$;
  v_occurrences integer;
  v_patched_definition text;
BEGIN
  IF v_gate_oid IS NULL
     OR pg_catalog.to_regclass('public.messages') IS NULL
     OR pg_catalog.to_regclass('public.commercial_opportunity_followups') IS NULL
     OR pg_catalog.to_regclass('public.commercial_opportunity_followup_events') IS NULL THEN
    RAISE EXCEPTION 'P19A_4_5_4_DEPENDENCY_MISSING';
  END IF;

  SELECT p.proowner,
         p.proacl,
         p.proconfig,
         p.prosecdef,
         p.provolatile,
         p.prokind,
         p.pronargs,
         p.proargtypes,
         pg_catalog.pg_get_functiondef(p.oid) AS definition
  INTO STRICT v_before
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_gate_oid;

  IF pg_catalog.strpos(v_before.definition, v_old_fragment) > 0 THEN
    v_occurrences := (
      pg_catalog.length(v_before.definition)
      - pg_catalog.length(pg_catalog.replace(v_before.definition, v_old_fragment, ''))
    ) / pg_catalog.length(v_old_fragment);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION 'P19A_4_5_4_UNEXPECTED_REACTIVE_FRAGMENT_COUNT:%', v_occurrences;
    END IF;
  ELSE
    IF pg_catalog.strpos(v_before.definition, v_new_fragment) > 0 THEN
      RAISE EXCEPTION 'P19A_4_5_4_ALREADY_APPLIED';
    END IF;
    RAISE EXCEPTION 'P19A_4_5_4_INSTALLED_FUNCTION_DRIFT';
  END IF;

  IF pg_catalog.strpos(v_before.definition, 'elsif v_outbound_kind = ''canonical_followup'' then') = 0
     OR pg_catalog.strpos(v_before.definition, 'v_block_reason := ''commercial_opportunity_opted_out'';') = 0
     OR pg_catalog.strpos(v_before.definition, 'stop_contact_ack_without_exact_opt_out_source') = 0 THEN
    RAISE EXCEPTION 'P19A_4_5_4_REQUIRED_GUARDS_MISSING';
  END IF;

  IF pg_catalog.md5(v_before.definition) IS DISTINCT FROM
     'c7a73e17f1b6e7b372b760e26c50d84d' THEN
    RAISE EXCEPTION 'P19A_4_5_4_INSTALLED_FUNCTION_HASH_MISMATCH';
  END IF;

  v_patched_definition := pg_catalog.replace(
    v_before.definition,
    v_old_fragment,
    v_new_fragment
  );

  EXECUTE v_patched_definition;

  SELECT p.proowner,
         p.proacl,
         p.proconfig,
         p.prosecdef,
         p.provolatile,
         p.prokind,
         p.pronargs,
         p.proargtypes,
         pg_catalog.pg_get_functiondef(p.oid) AS definition
  INTO STRICT v_after
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_gate_oid;

  IF v_before.proowner IS DISTINCT FROM v_after.proowner
     OR v_before.proacl IS DISTINCT FROM v_after.proacl
     OR v_before.proconfig IS DISTINCT FROM v_after.proconfig
     OR v_before.prosecdef IS DISTINCT FROM v_after.prosecdef
     OR v_before.provolatile IS DISTINCT FROM v_after.provolatile
     OR v_before.prokind IS DISTINCT FROM v_after.prokind
     OR v_before.pronargs IS DISTINCT FROM v_after.pronargs
     OR v_before.proargtypes IS DISTINCT FROM v_after.proargtypes THEN
    RAISE EXCEPTION 'P19A_4_5_4_SECURITY_ATTRIBUTES_CHANGED';
  END IF;

  IF pg_catalog.strpos(v_after.definition, v_old_fragment) > 0
     OR pg_catalog.strpos(v_after.definition, v_new_fragment) = 0
     OR pg_catalog.strpos(v_after.definition, 'elsif v_outbound_kind = ''canonical_followup'' then') = 0
     OR pg_catalog.strpos(v_after.definition, 'v_block_reason := ''commercial_opportunity_opted_out'';') = 0
     OR pg_catalog.strpos(v_after.definition, 'stop_contact_ack_without_exact_opt_out_source') = 0 THEN
    RAISE EXCEPTION 'P19A_4_5_4_POSTCHECK_FAILED';
  END IF;

  RAISE NOTICE 'P19A_4_5_4_REACTIVE_OPT_OUT_PATCHED';
END;
$migration$;

COMMIT;
