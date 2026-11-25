import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const runner = fs.readFileSync(
  "supabase/homologation/20261124220000_p10_9_b_commercial_memory_integrated_runner.sql",
  "utf8",
);
const composer = fs.readFileSync(
  "scripts/prepare-p10-9-b-commercial-memory-homologation.mjs",
  "utf8",
);

test("runner uses installed canonical RPCs and one controlled rollback", () => {
  assert.match(composer, /20261124220000_p10_9_b_commercial_memory_integrated_runner\.sql/);
  assert.match(runner, /write_commercial_conversation_fact_event_by_system/);
  assert.match(runner, /read_commercial_conversation_fact_events_by_system/);
  assert.match(runner, /read_commercial_opportunity_qualification_facts_by_system/);
  assert.match(runner, /write_commercial_opportunity_qualification_fact_by_system/);
  assert.match(runner, /insert_message\(uuid,text,text,text,text,text,text,jsonb\)/);
  assert.match(runner, /link_lead_to_customer\(uuid,uuid,uuid,uuid,text,text/);
  assert.match(runner, /link_commercial_session_context\(uuid,uuid,uuid,uuid,uuid,uuid,text,text/);
  assert.match(runner, /begin;\s*set local lock_timeout = '5s';\s*set local statement_timeout = '60s';/s);
  assert.doesNotMatch(runner, /request\.jwt\.claim\.role\s*=\s*'service_role'/);
  assert.match(runner, /f5bec07b5231aea04e2e6b0c2c2b41d8/);
  assert.match(runner, /ensure_commercial_conversation_session_context/);
  assert.match(runner, /can_ai_reply_subscription_guard/);
  assert.match(runner, /rebuild_conversation_last_message/);
  assert.match(runner, /rollback;\s*$/m);
  assert.match(runner, /P10_9_B_INTENTIONAL_ROLLBACK/);
  assert.match(runner, /select test_name, verdict, details/);
  assert.doesNotMatch(runner, /create\s+(or\s+replace\s+)?function\s+public\./i);
  assert.doesNotMatch(runner, /create\s+table\s+public\./i);
});

test("runner covers text, synthetic audio transcript, correction, conflict, replay, promotion and isolation", () => {
  assert.match(runner, /:text:assertion/);
  assert.match(runner, /:audio:assertion/);
  assert.match(runner, /Transcricao sintetica/);
  assert.match(runner, /:text:correction/);
  assert.match(runner, /supersedes_event_id/);
  assert.match(runner, /outcome = 'replayed'/);
  assert.match(runner, /where operation_key like v_test_prefix \|\| '%'/);
  assert.match(runner, /v_promotion_first_outcome in \('confirmed_created', 'created'\)/);
  assert.match(runner, /v_promotion_replay_id = v_promotion_first_id/);
  assert.match(runner, /v_promotion_event_count = 1/);
  assert.match(runner, /:promotion:/);
  assert.match(runner, /v_foreign_opportunity/);
  assert.match(runner, /promotion_and_isolation/);
  assert.match(runner, /P10\.9-B\.14 synthetic organization/);
  assert.match(runner, /past_due/);
  assert.match(runner, /link_lead_to_customer/);
  assert.match(runner, /link_commercial_session_context/);
  assert.match(runner, /insert_message/);
  assert.match(runner, /pg_get_functiondef/);
  assert.doesNotMatch(runner, /tgtype & 4/);
  assert.match(runner, /commercial opportunity scope mismatch/);
  assert.match(runner, /ai_enqueue_pass/);
  assert.match(runner, /p98_branch_pass/);
  assert.match(runner, /outbound_commercial_finalized_at is not null/);
  assert.match(runner, /capture_zion_admin_operational_failure_transition/);
  assert.doesNotMatch(runner, /assistant_enqueue_internal_notification/);
  assert.doesNotMatch(runner, /disable trigger/i);
});

test("runner proves rollback absence and does not activate audio retention or storage", () => {
  assert.match(runner, /v_test_event_after = 0/);
  assert.match(runner, /v_test_qevent_after = 0/);
  assert.match(runner, /v_synthetic_after = 0/);
  assert.match(runner, /v_audio_metadata_after is not distinct from v_audio_metadata_before/);
  assert.match(runner, /v_subtransaction_rolled_back/);
  assert.match(runner, /functional_assertions/);
  assert.match(runner, /fixture_trigger_audit/);
  assert.match(runner, /m\.deleted_at is not null/);
  assert.match(runner, /m\.conversation_session_id is distinct from v_fixture\.conversation_session_id/);
  assert.doesNotMatch(runner, /ZION_AUDIO_RETENTION_EXECUTOR_ENABLED\s*=\s*'true'/i);
  assert.doesNotMatch(runner, /\.storage\.|\.remove\s*\(/i);
  assert.match(runner, /Extracao TypeScript real e Storage real dependem/);
});

test("runner has one executable SQL envelope and no diagnostic early return", () => {
  assert.equal((runner.match(/^begin;$/gim) || []).length, 1);
  assert.equal((runner.match(/^rollback;$/gim) || []).length, 1);
  assert.equal((runner.match(/^commit;$/gim) || []).length, 0);
  assert.doesNotMatch(runner, /(^|\n)\s*return;\s*(\n|$)/);
  assert.match(runner, /do \$runner\$/);
  assert.match(runner, /\$runner\$;/);
  assert.equal((runner.match(/\$runner\$/g) || []).length, 2);
});

test("runner SQL envelope is structurally balanced before remote PostgreSQL validation", () => {
  let depth = 0;
  let inSingleQuote = false;
  for (let index = 0; index < runner.length; index += 1) {
    const character = runner[index];
    const next = runner[index + 1];
    if (character === "'" && inSingleQuote && next === "'") {
      index += 1;
      continue;
    }
    if (character === "'" && runner[index - 1] !== "\\") {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (inSingleQuote) continue;
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    assert.ok(depth >= 0, `parenthesis closed before opening at offset ${index}`);
  }
  assert.equal(inSingleQuote, false);
  assert.equal(depth, 0);
});

test("runner pins exact seven-argument reader and trigger bindings; fixture opt-in is off", () => {
  assert.match(runner, /read_commercial_conversation_fact_events_by_system\(uuid,uuid,uuid,uuid,uuid,uuid,uuid\)/);
  assert.doesNotMatch(runner, /read_commercial_conversation_fact_events_by_system\(uuid,uuid,uuid,uuid,uuid,uuid\)/);
  assert.match(runner, /v_execute_fixture constant boolean := false/);
  assert.match(runner, /if v_execute_fixture and v_contracts_ok and v_external_trigger_functions is null then/);
  assert.match(runner, /full join actual a using \(binding\)/);
  assert.match(runner, /observed_md5 is distinct from definition_md5/);
  assert.match(runner, /not t\.tgisinternal/);
  assert.match(runner, /v_message_count <> 2/);
  assert.match(runner, /v_audio_update_count <> 1/);
  assert.match(runner, /v_extra_residues = 0/);
  assert.match(runner, /v_extra_side_effects = 0/);
  assert.match(runner, /public\.ai_runs/);
  assert.match(runner, /public\.store_assistant_operational_task_queue/);
  assert.match(runner, /public\.zion_admin_diagnostic_operational_failure_events/);
});
