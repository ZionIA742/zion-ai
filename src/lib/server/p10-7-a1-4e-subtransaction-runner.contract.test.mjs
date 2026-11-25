import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync(
  "supabase/homologation/20261124193000_p10_7_a1_4e_atomic_dedup_subtransaction_runner.sql",
  "utf8",
);
const executableSql = runner.replace(/--[^\r\n]*/g, "");

test("A1.4e.1 uses one controlled subtransaction and one visible result table", () => {
  assert.match(runner, /CREATE TEMP TABLE p10_7_a1_4e_results[\s\S]*ON COMMIT PRESERVE ROWS/);
  assert.match(runner, /BEGIN\s*[\s\S]*CREATE UNIQUE INDEX IF NOT EXISTS/);
  assert.match(runner, /P10_7_A1_4E_INTENTIONAL_ROLLBACK/);
  assert.match(runner, /SELECT test_name, verdict, details\s+FROM pg_temp\.p10_7_a1_4e_results/);
  assert.equal((runner.match(/SELECT test_name, verdict, details/g) ?? []).length, 1);
  assert.match(runner, /rollback executado/);
  assert.doesNotMatch(executableSql, /\bCOMMIT\s*;/i);
});

test("A1.4e.1 covers replay, sent preservation, IDs, and non-human isolation", () => {
  assert.match(runner, /v_first := public\.assistant_enqueue_internal_notification/);
  assert.match(runner, /v_second := public\.assistant_enqueue_internal_notification/);
  assert.match(runner, /v_third := public\.assistant_enqueue_internal_notification/);
  assert.match(runner, /IF v_first IS NULL/);
  assert.match(runner, /v_second IS DISTINCT FROM v_first/);
  assert.match(runner, /SET status = 'sent'/);
  assert.match(runner, /v_status_after_first IS DISTINCT FROM 'pending'/);
  assert.match(runner, /v_status_after_sent IS DISTINCT FROM 'sent'/);
  assert.match(runner, /v_count_after_reopen IS DISTINCT FROM 1/);
  assert.match(runner, /SET lock_timeout = '5s'/);
  assert.match(runner, /SET statement_timeout = '30s'/);
  assert.match(runner, /'source', 'other_notification_test'/);
  assert.match(runner, /v_other IS NULL OR v_other IS NOT DISTINCT FROM v_first/);
  assert.match(runner, /EXCEPTION WHEN unique_violation/);
  assert.match(runner, /indice unico nao rejeitou insercao duplicada/);
  assert.match(runner, /thread_id nulo para alerta de teste/);
  assert.match(runner, /context ->> 'event_key' = v_event_key/);
  assert.match(runner, /v_test_rows_after = 0/);
});

test("A1.4e.1 never invokes delivery paths and documents real concurrency", () => {
  assert.doesNotMatch(runner, /sendResponsible|external_message_id|assistant_send_/i);
  assert.match(runner, /SESSAO A:/);
  assert.match(runner, /SESSAO B:/);
  assert.match(runner, /23505 e resultado esperado de deduplicacao atomica/);
  assert.match(runner, /Nao execute o drainer nem qualquer rotina de envio/);
  assert.match(runner, /event_key','p10-7-a1-4e:TOKEN_UNICO/);
});

test("A1.4e.1 keeps A1.4b protection definitions aligned with the migration", () => {
  const migration = readFileSync(
    "supabase/migrations/20261124173000_p10_7_a1_4b_atomic_human_response_alert_dedup.sql",
    "utf8",
  );
  assert.match(runner, /uq_store_assistant_notification_human_response_event/);
  assert.match(runner, /trg_p10_7_a1_4b_preserve_delivered_human_response_alert/);
  assert.match(runner, /p10_7_a1_4b_preserve_delivered_human_response_alert\(\)/);
  assert.match(migration, /uq_store_assistant_notification_human_response_event/);
  assert.match(migration, /trg_p10_7_a1_4b_preserve_delivered_human_response_alert/);
  assert.match(migration, /OLD\.status IN \('sent', 'delivered', 'read'\)/);
  assert.match(runner, /OLD\.status IN \('sent', 'delivered', 'read'\)/);
  assert.match(runner, /context ->> 'reason' = 'human_response_pending'/);
});
