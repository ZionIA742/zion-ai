import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const migration = readFileSync(
  "supabase/migrations/20261125020000_p9_10_4_d_recovery_definitive.sql",
  "utf8",
);
const worker = readFileSync("src/lib/server/process-ai-run-queue.ts", "utf8");
const runtime = readFileSync("src/lib/server/generate-and-save-ai-sales-reply.ts", "utf8");

test("consolidated recovery is fail-closed and activation defaults off", () => {
  assert.match(migration, /4d44f7b4a2ad6dd33d2806ae251d8e2e/);
  assert.match(migration, /P9_10_4_D_MATERIALIZER_BASELINE_DRIFT/);
  assert.match(migration, /automatic_enqueue_enabled boolean not null default false/);
  assert.match(migration, /on conflict \(organization_id\s*,\s*queue_key\) do nothing/i);
  assert.match(migration, /responseSetId/);
  assert.match(migration, /p9_10_4_d_assert_recovery_write_authority/);
  assert.match(migration, /p9_10_4_d_assert_recovery_set_authority/);
  assert.match(migration, /for update of c/);
  assert.match(migration, /private_acquire_sales_contract_conversation_xact_lock/);
  assert.match(migration, /MATERIALIZER_BASELINE_DRIFT/);
  assert.match(migration, /LEGACY_FUNCTION_SIGNATURES_UNAVAILABLE/);
});

test("blocked recovery releases the claim without consuming attempts", () => {
  assert.match(worker, /recovery\.status === "deferred"/);
  assert.match(worker, /p9_10_4_d_settle_recovery_failure_by_system/);

  const sourceFile = ts.createSourceFile(
    "worker.ts", worker, ts.ScriptTarget.Latest, true
  );

  const branches = [];

  function visit(node) {
    if (ts.isIfStatement(node)) {
      const condition = node.expression.getText(sourceFile);
      const body = node.thenStatement.getText(sourceFile);

      if (
        /recovery\.status\s*===\s*["']deferred["']/.test(condition) &&
        /\bsettleFailure\s*\(/.test(body)
      ) {
        branches.push(body);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  assert.equal(branches.length, 1);
  assert.doesNotMatch(
    branches[0],
    /finalizeWorkerTaskBySystem|markQueueProcessed/
  );

  const settlementStart = migration.indexOf(
    "create or replace function public.p9_10_4_d_settle_recovery_failure_by_system("
  );

  assert.ok(settlementStart >= 0);

  const settlementEnd = migration.indexOf(
    "$function$;",
    settlementStart
  );

  assert.ok(settlementEnd > settlementStart);

  const settlement = migration.slice(settlementStart, settlementEnd);

  assert.match(settlement, /if v_blocked then[\s\S]*?from public\.release_ai_run_queue_recovery_claim_by_system\(/);
  assert.match(settlement, /'outcome','deferred'/);
  assert.match(migration, /attempt_count=greatest\(0,queue_row\.attempt_count-1\)/i);
  assert.match(migration, /input->>'type'='sales_ai_post_materialization_recovery'/i);
});

test("worker requires the exact confirmed response-set identity", () => {
  assert.match(worker, /const responseSetId = String\(queueInput\.responseSetId/);
  assert.match(worker, /responseSetId,/);
  assert.match(runtime, /row\.response_set_id !== args\.expectedResponseSetId/);
});

console.log("PASS p9-10.4-D consolidated recovery contract");
