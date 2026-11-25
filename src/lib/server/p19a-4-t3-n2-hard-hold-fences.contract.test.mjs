import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const queue = readFileSync(join(root, "src/lib/server/process-ai-run-queue.ts"), "utf8");
const generation = readFileSync(join(root, "src/lib/server/generate-and-save-ai-sales-reply.ts"), "utf8");
const migration = readFileSync(
  join(root, "supabase/repairs/20261124160000_p19a_4_t3_n2_hard_hold_ai_fences.sql"),
  "utf8",
);
const repair = readFileSync(
  join(root, "supabase/repairs/20261123230000_p19a_4_t3_human_takeover_contract_repair.sql"),
  "utf8",
);
const rehearsal = readFileSync(
  join(root, "supabase/repairs/20261123230000_p19a_4_t3_human_takeover_contract_repair.transactional-rehearsal.sql"),
  "utf8",
);
const remoteReference = readFileSync(
  "supabase/diagnostics/p19a-n15-definicoes-remotas.txt",
  "utf8",
);

test("queue and generation read hard_hold independently from is_human_active", () => {
  assert.match(queue, /readSalesAiHumanControlState/);
  assert.match(queue, /human_control_state_unavailable/);
  assert.match(queue, /hard_hold/);
  assert.match(generation, /readSalesAiHumanControlState/);
  assert.match(generation, /HARD_HOLD_ACTIVE/);
  assert.match(generation, /HUMAN_CONTROL_STATE_UNAVAILABLE/);
});

test("SQL fences revalidate tenant-scoped human authority before worker materialization and external send", () => {
  assert.match(migration, /materialize_sales_ai_reply_set_by_worker_by_system/);
  assert.match(migration, /P19A_4_T3_N2_AI_BLOCKED_BY_HUMAN_CONTROL/);
  assert.match(migration, /validate_or_cancel_whatsapp_external_send_by_system/);
  assert.match(migration, /v_lease_released_at/);
  assert.match(migration, /human_takeover_hard_hold/);
  assert.match(migration, /is distinct from p_organization_id/);
  assert.match(migration, /is distinct from p_store_id/);
});

test("repair and rehearsal preserve inert P0 and synchronize the service-role release denial", () => {
  for (const sql of [repair, rehearsal]) {
    assert.match(sql, /begin;/i);
    assert.match(sql, /return 0/i);
    assert.match(sql, /revoke execute on function public\.release_human_takeover_lease_by_system\(uuid, text\) from service_role/);
    assert.match(sql, /has_function_privilege\('service_role', 'public\.release_human_takeover_lease_by_system\(uuid,text\)', 'EXECUTE'\) then/);
  }
});

test("N.16 uses anchors present in both complete remote definitions", () => {
  assert.match(remoteReference, /-- O lock permanece ate o fim da transacao\./);
  assert.match(remoteReference, /Fresh authority read after all required serialization locks are held\./);
  assert.match(migration, /v_guard_anchor constant text :=\s*'  -- Reutiliza integralmente a autoridade atual\.'/);
  const patternLiteral = migration.match(
    /\bv_guard_pattern\s+constant\s+text\s*:=\s*'([^']+)'\s*;/
  );

  assert.ok(patternLiteral);

  const pattern = new RegExp(
    patternLiteral[1]
      .replace(/^\(\?i\)/, "")
      .replaceAll("[[:space:]]", "\\s"),
    "gi",
  );

  const anchors = [...remoteReference.matchAll(pattern)];

  assert.equal(anchors.length, 1);

  const before = remoteReference.slice(0, anchors[0].index);
  const after = remoteReference.slice(anchors[0].index);

  const conversationLock = before.lastIndexOf(
    "private_acquire_sales_contract_conversation_xact_lock"
  );

  const humanFence = before.lastIndexOf("human_takeover_active");

  assert.ok(conversationLock >= 0);
  assert.ok(humanFence > conversationLock);
  assert.match(after, /WHATSAPP_EXTERNAL_SEND_GATE_MESSAGE_DISAPPEARED/);

  assert.match(migration, /v_declaration_count <> 1 or v_guard_count <> 1/);
  assert.match(migration, /Unexpected ordering of conversation and fresh message locks/);
  assert.doesNotMatch(migration, /FOR UPDATE e mantido durante TODA a chamada abaixo/);
  assert.doesNotMatch(migration, /v_guard_anchor constant text := '    if coalesce\(v_conversation_is_human_active, false\)'/);
});
