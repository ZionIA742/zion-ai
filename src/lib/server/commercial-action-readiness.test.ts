import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  refreshCommercialActionReadiness,
  type CommercialActionReadinessState,
} from "./commercial-action-readiness";

type RpcCall = {
  fn: string;
  args: Record<string, unknown>;
};

type RpcResponse = {
  data: unknown;
  error: { message?: string | null } | null;
};

function readinessRow(state: CommercialActionReadinessState) {
  return {
    action_key: "send_quote",
    readiness_state: state,
    reason_code: `${state}_reason`,
    blocking_items: state === "ready" ? [] : [{ item_key: "qualification" }],
    readiness_basis: { source: "test" },
    authority_fingerprint: "fp-1",
    resolver_key: "commercial_action_readiness_v1",
    resolver_version: 1,
  };
}

function checklistMaterializationRow(overrides?: Record<string, unknown>) {
  return {
    current_checklist_version_id: "checklist-version-1",
    version_number: 1,
    previous_checklist_version_id: null,
    profile_version_id: "profile-version-1",
    gate_policy_version_id: "gate-policy-version-1",
    item_count: 3,
    checklist_state: "ready",
    changed: true,
    replayed: false,
    preserved: false,
    outcome: "checklist_materialized",
    request_fingerprint: "checklist-request-fp",
    settings_fingerprint: "checklist-settings-fp",
    actor_type: "system",
    source_type: "system_materializer",
    created_by: "system",
    current_updated_at: "2026-09-03T12:00:00.000Z",
    ...overrides,
  };
}

function progressMaterializationRow(overrides?: Record<string, unknown>) {
  return {
    current_progress_version_id: "progress-version-1",
    version_number: 1,
    previous_progress_version_id: null,
    checklist_version_id: "checklist-version-1",
    lifecycle_cycle: 1,
    item_count: 3,
    projection_state: "ready",
    changed: true,
    replayed: false,
    outcome: "progress_materialized",
    request_fingerprint: "progress-request-fp",
    source_type: "system_materializer",
    created_by: "system",
    current_updated_at: "2026-09-03T12:00:00.000Z",
    ...overrides,
  };
}

function successMaterializerResponses() {
  return {
    materialize_commercial_opportunity_checklist_by_system: {
      data: [checklistMaterializationRow()],
      error: null,
    },
    materialize_commercial_opportunity_checklist_progress_by_system: {
      data: [progressMaterializationRow()],
      error: null,
    },
  } satisfies Record<string, RpcResponse>;
}

function createRpcRecorder(
  responses: Record<string, RpcResponse | Error>,
  options?: { includeDefaultMaterializers?: boolean },
) {
  const calls: RpcCall[] = [];
  const defaultResponses: Record<string, RpcResponse> =
    options?.includeDefaultMaterializers === false
      ? {}
      : successMaterializerResponses();
  return {
    calls,
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      const response = responses[fn] ?? defaultResponses[fn];
      if (response instanceof Error) {
        throw response;
      }

      return response ?? { data: null, error: { message: "unexpected rpc" } };
    },
  };
}

async function runCase(state: CommercialActionReadinessState) {
  const supabase = createRpcRecorder({
    read_commercial_action_readiness_scoped: {
      data: [readinessRow(state)],
      error: null,
    },
  });

  const result = await refreshCommercialActionReadiness({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    commercialOpportunityId: "opp-1",
    actionKey: "send_quote",
    eventKeyBase: "attempt-1",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.decision.actionKey, "send_quote");
  assert.equal(result.decision.readinessState, state);
  assert.equal(result.decision.reasonCode, `${state}_reason`);
  assert.equal(result.decision.authorityFingerprint, "fp-1");
}

const tests: Array<{ name: string; run: () => Promise<void> | void }> = [
  {
    name: "calls checklist then progress then scoped readiness with exact scope",
    run: async () => {
      const supabase = createRpcRecorder({
        read_commercial_action_readiness_scoped: {
          data: [readinessRow("ready")],
          error: null,
        },
      });

      const result = await refreshCommercialActionReadiness({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        actionKey: "send_quote",
        eventKeyBase: "attempt-1",
      });

      assert.equal(result.ok, true);
      assert.deepEqual(
        supabase.calls.map((call) => call.fn),
        [
          "materialize_commercial_opportunity_checklist_by_system",
          "materialize_commercial_opportunity_checklist_progress_by_system",
          "read_commercial_action_readiness_scoped",
        ],
      );
      assert.deepEqual(supabase.calls[0]?.args, {
        p_organization_id: "org-1",
        p_store_id: "store-1",
        p_commercial_opportunity_id: "opp-1",
        p_materialization_event_key: "attempt-1:checklist",
      });
      assert.deepEqual(supabase.calls[1]?.args, {
        p_organization_id: "org-1",
        p_store_id: "store-1",
        p_commercial_opportunity_id: "opp-1",
        p_materialization_event_key: "attempt-1:progress",
      });
      assert.deepEqual(supabase.calls[2]?.args, {
        p_organization_id: "org-1",
        p_store_id: "store-1",
        p_commercial_opportunity_id: "opp-1",
        p_action_key: "send_quote",
      });
    },
  },
  {
    name: "checklist failure stops before progress and readiness",
    run: async () => {
      const supabase = createRpcRecorder({
        materialize_commercial_opportunity_checklist_by_system: {
          data: null,
          error: { message: "db down" },
        },
      });
      const result = await refreshCommercialActionReadiness({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        actionKey: "send_quote",
        eventKeyBase: "attempt-1",
      });

      assert.equal(result.ok, false);
      assert.equal(supabase.calls.length, 1);
    },
  },
  {
    name: "checklist null data fails closed before progress and readiness",
    run: async () => {
      const supabase = createRpcRecorder({
        materialize_commercial_opportunity_checklist_by_system: {
          data: null,
          error: null,
        },
      });
      const result = await refreshCommercialActionReadiness({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        actionKey: "send_quote",
        eventKeyBase: "attempt-1",
      });

      assert.equal(result.ok, false);
      assert.equal(result.ok ? "" : result.error, "CHECKLIST_MATERIALIZATION_INVALID");
      assert.equal(supabase.calls.length, 1);
    },
  },
  {
    name: "checklist empty data fails closed before progress and readiness",
    run: async () => {
      const supabase = createRpcRecorder({
        materialize_commercial_opportunity_checklist_by_system: {
          data: [],
          error: null,
        },
      });
      const result = await refreshCommercialActionReadiness({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        actionKey: "send_quote",
        eventKeyBase: "attempt-1",
      });

      assert.equal(result.ok, false);
      assert.equal(result.ok ? "" : result.error, "CHECKLIST_MATERIALIZATION_INVALID");
      assert.equal(supabase.calls.length, 1);
    },
  },
  {
    name: "checklist invalid shape fails closed before progress and readiness",
    run: async () => {
      const supabase = createRpcRecorder({
        materialize_commercial_opportunity_checklist_by_system: {
          data: [{ current_checklist_version_id: "", outcome: "checklist_unchanged" }],
          error: null,
        },
      });
      const result = await refreshCommercialActionReadiness({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        actionKey: "send_quote",
        eventKeyBase: "attempt-1",
      });

      assert.equal(result.ok, false);
      assert.equal(result.ok ? "" : result.error, "CHECKLIST_MATERIALIZATION_INVALID");
      assert.equal(supabase.calls.length, 1);
    },
  },
  {
    name: "checklist multiple rows fail closed before progress and readiness",
    run: async () => {
      const supabase = createRpcRecorder({
        materialize_commercial_opportunity_checklist_by_system: {
          data: [checklistMaterializationRow(), checklistMaterializationRow()],
          error: null,
        },
      });
      const result = await refreshCommercialActionReadiness({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        actionKey: "send_quote",
        eventKeyBase: "attempt-1",
      });

      assert.equal(result.ok, false);
      assert.equal(result.ok ? "" : result.error, "CHECKLIST_MATERIALIZATION_INVALID");
      assert.equal(supabase.calls.length, 1);
    },
  },
  {
    name: "progress failure stops before readiness",
    run: async () => {
      const supabase = createRpcRecorder({
        materialize_commercial_opportunity_checklist_progress_by_system: {
          data: null,
          error: { message: "db down" },
        },
      });
      const result = await refreshCommercialActionReadiness({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        actionKey: "send_quote",
        eventKeyBase: "attempt-1",
      });

      assert.equal(result.ok, false);
      assert.equal(supabase.calls.length, 2);
    },
  },
  {
    name: "progress null data fails closed before readiness",
    run: async () => {
      const supabase = createRpcRecorder({
        materialize_commercial_opportunity_checklist_progress_by_system: {
          data: null,
          error: null,
        },
      });
      const result = await refreshCommercialActionReadiness({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        actionKey: "send_quote",
        eventKeyBase: "attempt-1",
      });

      assert.equal(result.ok, false);
      assert.equal(result.ok ? "" : result.error, "PROGRESS_MATERIALIZATION_INVALID");
      assert.deepEqual(
        supabase.calls.map((call) => call.fn),
        [
          "materialize_commercial_opportunity_checklist_by_system",
          "materialize_commercial_opportunity_checklist_progress_by_system",
        ],
      );
    },
  },
  {
    name: "progress invalid shape fails closed before readiness",
    run: async () => {
      const supabase = createRpcRecorder({
        materialize_commercial_opportunity_checklist_progress_by_system: {
          data: [{ current_progress_version_id: "progress-version-1", outcome: "" }],
          error: null,
        },
      });
      const result = await refreshCommercialActionReadiness({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        actionKey: "send_quote",
        eventKeyBase: "attempt-1",
      });

      assert.equal(result.ok, false);
      assert.equal(result.ok ? "" : result.error, "PROGRESS_MATERIALIZATION_INVALID");
      assert.equal(supabase.calls.length, 2);
    },
  },
  {
    name: "checklist rpc throw fails closed before progress and readiness",
    run: async () => {
      const supabase = createRpcRecorder({
        materialize_commercial_opportunity_checklist_by_system: new Error("boom"),
      });
      const result = await refreshCommercialActionReadiness({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        actionKey: "send_quote",
        eventKeyBase: "attempt-1",
      });

      assert.equal(result.ok, false);
      assert.equal(result.ok ? "" : result.error, "CHECKLIST_MATERIALIZATION_FAILED");
      assert.equal(supabase.calls.length, 1);
    },
  },
  {
    name: "progress rpc throw fails closed before readiness",
    run: async () => {
      const supabase = createRpcRecorder({
        materialize_commercial_opportunity_checklist_progress_by_system: new Error("boom"),
      });
      const result = await refreshCommercialActionReadiness({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        actionKey: "send_quote",
        eventKeyBase: "attempt-1",
      });

      assert.equal(result.ok, false);
      assert.equal(result.ok ? "" : result.error, "PROGRESS_MATERIALIZATION_FAILED");
      assert.equal(supabase.calls.length, 2);
    },
  },
  {
    name: "readiness failure fails closed",
    run: async () => {
      const supabase = createRpcRecorder({
        read_commercial_action_readiness_scoped: {
          data: null,
          error: { message: "db down" },
        },
      });
      const result = await refreshCommercialActionReadiness({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        actionKey: "send_quote",
        eventKeyBase: "attempt-1",
      });

      assert.equal(result.ok, false);
      assert.equal(result.ok ? "" : result.error, "READINESS_READ_FAILED");
    },
  },
  {
    name: "readiness rpc throw fails closed",
    run: async () => {
      const supabase = createRpcRecorder({
        read_commercial_action_readiness_scoped: new Error("boom"),
      });
      const result = await refreshCommercialActionReadiness({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        actionKey: "send_quote",
        eventKeyBase: "attempt-1",
      });

      assert.equal(result.ok, false);
      assert.equal(result.ok ? "" : result.error, "READINESS_READ_FAILED");
      assert.equal(supabase.calls.length, 3);
    },
  },
  {
    name: "unchanged and preserved materializer outcomes remain valid",
    run: async () => {
      const supabase = createRpcRecorder({
        materialize_commercial_opportunity_checklist_by_system: {
          data: [
            checklistMaterializationRow({
              changed: false,
              preserved: true,
              outcome: "preserved_human_authority",
            }),
          ],
          error: null,
        },
        materialize_commercial_opportunity_checklist_progress_by_system: {
          data: [
            progressMaterializationRow({
              changed: false,
              replayed: true,
              outcome: "checklist_unchanged",
            }),
          ],
          error: null,
        },
        read_commercial_action_readiness_scoped: {
          data: [readinessRow("ready")],
          error: null,
        },
      });

      const result = await refreshCommercialActionReadiness({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        actionKey: "send_quote",
        eventKeyBase: "attempt-1",
      });

      assert.equal(result.ok, true);
      assert.equal(supabase.calls.length, 3);
    },
  },
  { name: "ready preserved", run: () => runCase("ready") },
  { name: "blocked preserved", run: () => runCase("blocked") },
  { name: "needs_resolution preserved", run: () => runCase("needs_resolution") },
  { name: "conflict preserved", run: () => runCase("conflict") },
  {
    name: "empty or invalid readiness payload fails closed",
    run: async () => {
      for (const data of [[], [{ action_key: "send_quote" }], [{ action_key: "other", readiness_state: "ready" }]]) {
        const supabase = createRpcRecorder({
          read_commercial_action_readiness_scoped: { data, error: null },
        });
        const result = await refreshCommercialActionReadiness({
          supabase,
          organizationId: "org-1",
          storeId: "store-1",
          commercialOpportunityId: "opp-1",
          actionKey: "send_quote",
          eventKeyBase: "attempt-1",
        });
        assert.equal(result.ok, false);
      }
    },
  },
  {
    name: "unknown readiness state fails closed",
    run: async () => {
      const supabase = createRpcRecorder({
        read_commercial_action_readiness_scoped: {
          data: [{ ...readinessRow("ready"), readiness_state: "done" }],
          error: null,
        },
      });
      const result = await refreshCommercialActionReadiness({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        actionKey: "send_quote",
        eventKeyBase: "attempt-1",
      });
      assert.equal(result.ok, false);
    },
  },
  {
    name: "invalid action key fails before rpc",
    run: async () => {
      const supabase = createRpcRecorder({});
      const result = await refreshCommercialActionReadiness({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        actionKey: "not_real",
        eventKeyBase: "attempt-1",
      });
      assert.equal(result.ok, false);
      assert.equal(supabase.calls.length, 0);
    },
  },
  {
    name: "helper does not call the internal resolver directly",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/commercial-action-readiness.ts"),
        "utf8",
      );
      const internalResolverName = ["p9", "resolve", "commercial", "action", "readiness", "internal"].join("_");
      assert.equal(source.includes(internalResolverName), false);
      assert.equal(source.includes("read_commercial_action_readiness_scoped"), true);
    },
  },
];

void (async () => {
  const failures: string[] = [];
  for (const testCase of tests) {
    try {
      await testCase.run();
      process.stdout.write(`ok - ${testCase.name}\n`);
    } catch (error) {
      failures.push(
        `not ok - ${testCase.name}\n${error instanceof Error ? error.stack || error.message : String(error)}`,
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  }
})();
