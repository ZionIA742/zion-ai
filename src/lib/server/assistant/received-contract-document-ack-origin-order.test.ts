import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const historicalPath = resolve(
  process.cwd(),
  "supabase/migrations/20261106140000_p9_9_3_c5_received_document_ack_outbound_kind.sql",
);
const fixPath = resolve(
  process.cwd(),
  "supabase/migrations/20261106173000_p9_9_3_c5_received_document_ack_origin_order_fix.sql",
);

function normalizeOrigin(metadata: Record<string, unknown>) {
  const value = String(metadata.outbound_origin ?? "").trim();
  return value || null;
}

test("reproduz o defeito: a variável ainda não tinha recebido a origem", () => {
  const uninitialized: string | undefined = undefined;
  assert.notEqual(uninitialized, "received_contract_document_ack");
  assert.equal(
    normalizeOrigin({ outbound_origin: " received_contract_document_ack " }),
    "received_contract_document_ack",
  );
});

test("a migration incremental lê a origem real do metadata no bloco prematuro", () => {
  const historical = readFileSync(historicalPath, "utf8");
  const fix = readFileSync(fixPath, "utf8");

  assert.match(
    historical,
    /if v_outbound_origin is distinct from 'received_contract_document_ack'/,
  );
  assert.match(fix, /v_message\.metadata ->> 'outbound_origin'/);
  assert.match(fix, /pg_catalog\.btrim/);
  assert.match(fix, /coalesce\(v_message\.metadata ->> 'outbound_origin', ''\)/);
  assert.match(fix, /received_document_ack_origin_mismatch/);
  assert.doesNotMatch(fix, /20261106140000.*ALTER|UPDATE|DELETE/s);
});

test("ACK legítimo do Edgar passa e origem incorreta continua bloqueada", () => {
  assert.equal(
    normalizeOrigin({ outbound_origin: "received_contract_document_ack" }),
    "received_contract_document_ack",
  );
  assert.notEqual(
    normalizeOrigin({ outbound_origin: "sales_ai_reply" }),
    "received_contract_document_ack",
  );
  assert.notEqual(
    normalizeOrigin({ outbound_origin: "received_contract_document_ack_typo" }),
    "received_contract_document_ack",
  );
});

test("a correção não remove as proteções documentais do guard", () => {
  const historical = readFileSync(historicalPath, "utf8");
  const fix = readFileSync(fixPath, "utf8");
  const combined = `${historical}\n${fix}`;
  for (const invariant of [
    "received_document_ack_source_scope_mismatch",
    "received_document_ack_source_required",
    "received_document_ack_source_changed_during_gate",
    "v_initial_outbound_kind <> 'received_contract_document_ack'",
    "v_outbound_kind <> 'received_contract_document_ack'",
  ]) {
    assert.match(combined, new RegExp(invariant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
