-- ZION P9 9.3-B/1F -- runner de estrutura, sem escrita permanente.
WITH definition AS (
 SELECT p.oid, p.prosecdef, pg_get_functiondef(p.oid) AS body
 FROM pg_proc p
 WHERE p.oid = to_regprocedure(
 'public.p9_decide_quote_approval_by_responsible_by_system(uuid,uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid,text,text)'
 )
), guard AS (
 SELECT p.oid, pg_get_functiondef(p.oid) AS body
 FROM pg_proc p
 WHERE p.oid = to_regprocedure('public.p9_assert_accepted_revision_responsible_approval_trg()')
), checks AS (
 SELECT 'decision_writer_present'::text AS test,
 EXISTS(SELECT 1 FROM definition) AS ok
 UNION ALL SELECT 'legacy_approval_present',
 to_regprocedure('public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid,uuid)') IS NOT NULL
 UNION ALL SELECT 'decision_service_role_only',
 EXISTS(SELECT 1 FROM definition WHERE prosecdef AND has_function_privilege('service_role',oid,'EXECUTE')
 AND NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('authenticated',oid,'EXECUTE'))
 UNION ALL SELECT 'decision_before_version_promotion',
 EXISTS(SELECT 1 FROM definition WHERE position('UPDATE public.p9_responsible_commercial_approval_requests' IN body)>0
 AND position('public.approve_sales_quote_version_by_system(' IN body)>
 position('UPDATE public.p9_responsible_commercial_approval_requests' IN body))
 UNION ALL SELECT 'only_explicit_approval_promotes',
 EXISTS(SELECT 1 FROM definition WHERE position('IF v_derived_decision = ''approved'' THEN' IN body)>0
 AND position('v_approved_version_count <> 1' IN body)>0)
 UNION ALL SELECT 'approval_replay_scope_checked',
 EXISTS(SELECT 1 FROM definition WHERE position('P9_QUOTE_DECISION_APPROVED_REPLAY_STATE_CONFLICT' IN body)>0)
 UNION ALL SELECT 'version_guard_trigger_exists',
 EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public.sales_quotes'::regclass
 AND t.tgname='p9_accepted_revision_responsible_approval_guard'
 AND NOT t.tgisinternal AND t.tgenabled <> 'D')
 UNION ALL SELECT 'gate_restricted_to_accepted_revisions',
 EXISTS(SELECT 1 FROM guard WHERE position('public.p9_accepted_quote_revisions' IN body)>0
 AND position('request_row.quote_version_id = NEW.current_version_id' IN body)>0)
 UNION ALL SELECT 'gate_requires_human_message_evidence',
 EXISTS(SELECT 1 FROM guard WHERE position('request_row.decision_inbound_message_id IS NOT NULL' IN body)>0
 AND position('request_row.decided_at IS NOT NULL' IN body)>0)
 UNION ALL SELECT 'gate_on_approval_and_send',
 EXISTS(SELECT 1 FROM guard WHERE position('NEW.status IN (''approved'', ''sent'')' IN body)>0)
 UNION ALL SELECT 'v1_not_subject_to_revision_gate',
 EXISTS(SELECT 1 FROM guard WHERE position('ar.target_quote_version_id = NEW.current_version_id' IN body)>0)
)
SELECT test, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS resultado
FROM checks ORDER BY test;

WITH definition AS (
 SELECT pg_get_functiondef(p.oid) AS body,p.oid,p.prosecdef FROM pg_proc p
 WHERE p.oid=to_regprocedure('public.p9_decide_quote_approval_by_responsible_by_system(uuid,uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid,text,text)')
), guard AS (
 SELECT pg_get_functiondef(p.oid) AS body FROM pg_proc p
 WHERE p.oid=to_regprocedure('public.p9_assert_accepted_revision_responsible_approval_trg()')
),checks AS (
 SELECT EXISTS(SELECT 1 FROM definition) AS ok
 UNION ALL SELECT to_regprocedure('public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid,uuid)') IS NOT NULL
 UNION ALL SELECT EXISTS(SELECT 1 FROM definition WHERE prosecdef AND has_function_privilege('service_role',oid,'EXECUTE') AND NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('authenticated',oid,'EXECUTE'))
 UNION ALL SELECT EXISTS(SELECT 1 FROM definition WHERE position('UPDATE public.p9_responsible_commercial_approval_requests' IN body)>0 AND position('public.approve_sales_quote_version_by_system(' IN body)>position('UPDATE public.p9_responsible_commercial_approval_requests' IN body))
 UNION ALL SELECT EXISTS(SELECT 1 FROM definition WHERE position('IF v_derived_decision = ''approved'' THEN' IN body)>0 AND position('v_approved_version_count <> 1' IN body)>0)
 UNION ALL SELECT EXISTS(SELECT 1 FROM definition WHERE position('P9_QUOTE_DECISION_APPROVED_REPLAY_STATE_CONFLICT' IN body)>0)
 UNION ALL SELECT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public.sales_quotes'::regclass AND t.tgname='p9_accepted_revision_responsible_approval_guard' AND NOT t.tgisinternal AND t.tgenabled <> 'D')
 UNION ALL SELECT EXISTS(SELECT 1 FROM guard WHERE position('public.p9_accepted_quote_revisions' IN body)>0 AND position('request_row.quote_version_id = NEW.current_version_id' IN body)>0)
 UNION ALL SELECT EXISTS(SELECT 1 FROM guard WHERE position('request_row.decision_inbound_message_id IS NOT NULL' IN body)>0 AND position('request_row.decided_at IS NOT NULL' IN body)>0)
 UNION ALL SELECT EXISTS(SELECT 1 FROM guard WHERE position('NEW.status IN (''approved'', ''sent'')' IN body)>0)
 UNION ALL SELECT EXISTS(SELECT 1 FROM guard WHERE position('ar.target_quote_version_id = NEW.current_version_id' IN body)>0)
)
SELECT count(*) FILTER(WHERE ok) AS passed, count(*) FILTER(WHERE NOT ok) AS failed,
 CASE WHEN count(*)=11 AND bool_and(ok) THEN 'STRUCTURE_PASS_ONLY' ELSE 'STRUCTURE_INCOMPLETE' END AS verdict
FROM checks;
