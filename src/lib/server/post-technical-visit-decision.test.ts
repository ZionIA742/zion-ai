import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decidePostTechnicalVisitBySystem } from "./post-technical-visit-decision";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260929165000_p9_7_5_post_visit_decision_authority.sql",
);

const migration = readFileSync(migrationPath, "utf8");

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    decision_id: "decision-1",
    organization_id: "org-1",
    store_id: "store-1",
    appointment_id: "appointment-1",
    commercial_opportunity_id: "opportunity-1",
    lifecycle_cycle: 2,
    result_event_id: "event-1",
    decision_kind: "qualification",
    decision_reason: "technical_visit_viable_but_qualification_incomplete",
    decision_basis: { effects_executed: false },
    replayed: false,
    ...overrides,
  };
}

async function run() {
  const rpcCalls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  const supabase = {
    rpc: async (functionName: string, args: Record<string, unknown>) => {
      rpcCalls.push({ functionName, args });
      return { data: [validRow()], error: null };
    },
  };

  const valid = await decidePostTechnicalVisitBySystem({
    supabase,
    resultEventId: "event-1",
    operationKey: "post-visit:event-1",
    metadata: { source: "focused-test" },
  });

  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.decision.decisionKind, "qualification");
    assert.equal(valid.decision.replayed, false);
  }
  assert.deepEqual(rpcCalls[0], {
    functionName: "decide_post_technical_visit_by_system",
    args: {
      p_result_event_id: "event-1",
      p_operation_key: "post-visit:event-1",
      p_metadata: { source: "focused-test" },
    },
  });

  const invalidCardinality = await decidePostTechnicalVisitBySystem({
    supabase: {
      rpc: async () => ({ data: [], error: null }),
    },
    resultEventId: "event-1",
    operationKey: "post-visit:event-1",
  });
  assert.deepEqual(invalidCardinality, {
    ok: false,
    error: "INVALID_RESPONSE",
    message: "A authority pos-visita retornou uma decisao invalida.",
  });

  const rpcFailure = await decidePostTechnicalVisitBySystem({
    supabase: {
      rpc: async () => ({ data: null, error: { message: "internal detail" } }),
    },
    resultEventId: "event-1",
    operationKey: "post-visit:event-1",
  });
  assert.deepEqual(rpcFailure, {
    ok: false,
    error: "RPC_FAILED",
    message: "Nao foi possivel persistir a decisao pos-visita.",
  });

  const invalidInput = await decidePostTechnicalVisitBySystem({
    supabase,
    resultEventId: "",
    operationKey: "post-visit:event-1",
  });
  assert.equal(invalidInput.ok, false);

  const requiredBranches = [
    "technical_visit_viable_but_qualification_incomplete",
    "technical_visit_viable_quote_ready",
    "technical_visit_viable_quote_readiness_unresolved",
    "technical_visit_adjustments_require_resolution",
    "technical_visit_result_pending",
    "confirmed_technical_infeasibility",
    "technical_visit_did_not_occur",
    "technical_visit_occurrence_unclear",
    "technical_visit_viable_quote_already_sent",
  ];
  for (const branch of requiredBranches) {
    assert.equal(migration.includes(branch), true, `missing branch: ${branch}`);
  }

  assert.equal(migration.includes("ZION_P9_7_5_RESULT_EVENT_SUPERSEDED"), true);
  assert.equal(migration.includes("ZION_P9_7_5_DECISION_LIFECYCLE_STALE"), true);
  assert.equal(migration.includes("ZION_P9_7_5_INCOMPATIBLE_DECISION_REPLAY"), true);
  assert.equal(migration.includes("pg_advisory_xact_lock"), true);
  assert.equal(migration.includes("unique (organization_id, store_id, result_event_id)"), true);
  assert.equal(migration.includes("effects_executed boolean not null default false"), true);
  assert.equal(migration.includes("check (not effects_executed"), true);

  assert.equal(migration.includes("mark_commercial_opportunity_lost_by_system"), false);
  assert.equal(migration.includes("update public.commercial_opportunities"), false);
  assert.equal(migration.includes("insert into public.schedule_post_appointment_followups"), false);
  assert.equal(migration.includes("insert into public.sales_quotes"), false);
  assert.equal(migration.includes("insert into public.store_appointments"), false);
  assert.equal(migration.includes("negotiation"), true);
  assert.equal(migration.includes("v_decision_kind := 'negotiation'"), false);

  console.log("post-technical-visit-decision: 30 assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
