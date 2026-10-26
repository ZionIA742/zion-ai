import assert from "node:assert/strict";
import test from "node:test";

import {
  runClaimedOpenAiCostBatch,
} from "./zion-admin-openai-cost-batch-coordinator";

import {
  createOpenAiCostBatchAdapters,
} from "./zion-admin-openai-cost-batch-adapters";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

import {
  OPENAI_COST_CLAIM_RPC,
  OPENAI_COST_ASSERT_RPC,
} from "./zion-admin-openai-cost-claimed-operations";

import {
  OPENAI_COST_FINALIZE_RPC,
} from "./zion-admin-openai-cost-operation-finalizer";

import {
  OPENAI_COST_FAIL_RPC,
} from "./zion-admin-openai-cost-operation-failure";

const ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT = "33333333-3333-4333-8333-333333333333";

const ACTOR = "zion-admin-financial-worker";
const NOW = new Date("2026-10-26T18:00:00Z");
const EXPIRES = "2026-10-26T18:10:00Z";
const NEXT = "2026-10-26T18:05:00Z";

const contract = buildOpenAiCostQueryContract({
  startTime: 1792886400,
  endTime: 1792972800,
  groupBy: ["line_item"],
  projectIds: ["proj-a"],
  limit: 10,
});

const REQUEST = { limit: 1, claimedBy: ACTOR };

function claimItem() {
  return {
    operation_id: ID,
    operation_key: "costs:2026-10-25",
    query_identity: contract.queryIdentity,
    query_parameters: contract.queryParameters,
    period_start: contract.periodStart,
    period_end: contract.periodEnd,
    state: "processing",
    attempt_count: 1,
    max_attempts: 3,
    claim_token: TOKEN,
    claim_expires_at: EXPIRES,
    claimed_by: ACTOR,
  };
}

function claimEnvelope(count = 1) {
  return {
    outcome: "claimed",
    claimed_count: count,
    lease_minutes: 15,
    operations: count === 0 ? [] : [claimItem()],
  };
}

function assertion() {
  return {
    outcome: "valid",
    operation_id: ID,
    operation_key: "costs:2026-10-25",
    state: "processing",
    attempt_count: 1,
    claim_expires_at: EXPIRES,
    claimed_by: ACTOR,
  };
}

function page(withRecord = false) {
  return {
    object: "page",
    data: withRecord
      ? [{
          object: "bucket",
          start_time: contract.costsRequest.startTime,
          end_time: contract.costsRequest.endTime,
          results: [{
            object: "organization.costs.result",
            amount: { currency: "usd", value: 0.25 },
            project_id: "proj-a",
            line_item: "responses",
            api_source: "agents_api",
          }],
        }]
      : [],
    has_more: false,
    next_page: null,
  };
}

type Scenario = {
  emptyClaim?: boolean;
  claimError?: boolean;
  assertError?: boolean;
  httpStatus?: number;
  withRecord?: boolean;
  finalizationError?: boolean;
  failureError?: boolean;
};

function harness(scenario: Scenario = {}) {
  const calls: string[] = [];

  const adapters = createOpenAiCostBatchAdapters({
    now: () => NOW,

    claimDependencies: {
      rpc: async (name, params) => {
        calls.push(name);

        if (name === OPENAI_COST_CLAIM_RPC) {
          assert.equal(params.p_limit, 1);
          assert.equal(params.p_claimed_by, ACTOR);

          if (scenario.claimError) {
            return {
              data: null,
              error: { code: "NETWORK" },
            };
          }

          return {
            data: claimEnvelope(scenario.emptyClaim ? 0 : 1),
            error: null,
          };
        }

        assert.equal(name, OPENAI_COST_ASSERT_RPC);
        assert.equal(params.p_operation_id, ID);
        assert.equal(params.p_claim_token, TOKEN);

        if (scenario.assertError) {
          return {
            data: null,
            error: { code: "CLAIM_NOT_ACTIVE" },
          };
        }

        return { data: assertion(), error: null };
      },
    },

    collectorDependencies: {
      adminKey: "simulated-admin-key",
      fetch: async (url, init) => {
        calls.push("openai_fetch");

        const parsed = new URL(url);
        assert.equal(
          parsed.pathname,
          "/v1/organization/costs",
        );
        assert.equal(
          parsed.searchParams.get("start_time"),
          String(contract.costsRequest.startTime),
        );
        assert.equal(
          parsed.searchParams.get("end_time"),
          String(contract.costsRequest.endTime),
        );
        assert.equal(
          parsed.searchParams.get("project_ids"),
          "proj-a",
        );
        assert.equal(
          parsed.searchParams.get("limit"),
          "10",
        );
        assert.equal(init.method, "GET");

        const status = scenario.httpStatus ?? 200;

        return {
          ok: status === 200,
          status,
          json: async () => page(
            scenario.withRecord ?? false,
          ),
        };
      },
    },

    finalizeDependencies: {
      rpc: async (name, payload) => {
        calls.push(name);
        assert.equal(name, OPENAI_COST_FINALIZE_RPC);
        assert.equal(payload.p_operation_id, ID);
        assert.equal(payload.p_claim_token, TOKEN);
        assert.deepEqual(
          payload.p_collection.query_parameters,
          contract.queryParameters,
        );
        assert.equal(
          payload.p_collection.collection_key,
          `openai_organization_costs:v1:${ID}`,
        );
        assert.equal(
          payload.p_collection.result_count,
          scenario.withRecord ? 1 : 0,
        );

        if (scenario.withRecord) {
          assert.equal(payload.p_lines.length, 1);
          assert.equal(
            payload.p_lines[0].amount_decimal_text,
            "0.25",
          );
        }

        if (scenario.finalizationError) {
          throw new Error("response lost after possible commit");
        }

        return {
          data: {
            outcome: "confirmed",
            operation_id: ID,
            operation_key: "costs:2026-10-25",
            snapshot_collection_id: SNAPSHOT,
            snapshot_outcome: "inserted",
            confirmed_at: "2026-10-26T18:01:00Z",
          },
          error: null,
        };
      },
    },

    failureDependencies: {
      rpc: async (name, payload) => {
        calls.push(name);
        assert.equal(name, OPENAI_COST_FAIL_RPC);
        assert.equal(payload.p_operation_id, ID);
        assert.equal(payload.p_claim_token, TOKEN);

        if (scenario.failureError) {
          throw new Error("failure response lost");
        }

        const retryable =
          payload.p_failure_kind === "retryable";

        const uncertain =
          payload.p_failure_kind === "uncertain";

        return {
          data: {
            outcome: "failure_recorded",
            operation_id: ID,
            operation_key: "costs:2026-10-25",
            state: retryable
              ? "retryable_failed"
              : uncertain
                ? "uncertain"
                : "permanent_failed",
            event_kind: retryable
              ? "failed_retryable"
              : uncertain
                ? "marked_uncertain"
                : "failed_permanent",
            error_code: payload.p_error_code,
            attempt_count: 1,
            max_attempts: 3,
            retry_scheduled: retryable,
            next_attempt_at: retryable ? NEXT : null,
            retry_delay_minutes: retryable ? 5 : null,
          },
          error: null,
        };
      },
    },
  });

  return {
    calls,
    run: () => runClaimedOpenAiCostBatch(
      REQUEST,
      adapters,
    ),
  };
}

test("creating adapters performs no external operations", () => {
  let calls = 0;

  const adapters = createOpenAiCostBatchAdapters({
    claim: async () => {
      calls++;
      throw new Error("unexpected claim");
    },
    collect: async () => {
      calls++;
      throw new Error("unexpected provider call");
    },
    finalize: async () => {
      calls++;
      throw new Error("unexpected finalization");
    },
    recordFailure: async () => {
      calls++;
      throw new Error("unexpected failure write");
    },
  });

  assert.equal(typeof adapters.claim, "function");
  assert.equal(typeof adapters.collect, "function");
  assert.equal(typeof adapters.finalize, "function");
  assert.equal(typeof adapters.recordFailure, "function");
  assert.equal(calls, 0);
});

test("empty database claim performs no provider request", async () => {
  const h = harness({ emptyClaim: true });
  const output = await h.run();

  assert.equal(output.claimedCount, 0);
  assert.equal(output.confirmedCount, 0);
  assert.deepEqual(h.calls, [OPENAI_COST_CLAIM_RPC]);
});

test("complete mocked RPC and OpenAI integration confirms empty", async () => {
  const h = harness();
  const output = await h.run();

  assert.equal(output.claimedCount, 1);
  assert.equal(output.confirmedCount, 1);
  assert.equal(output.failureRecordedCount, 0);
  assert.equal(output.needsReviewCount, 0);

  assert.deepEqual(h.calls, [
    OPENAI_COST_CLAIM_RPC,
    OPENAI_COST_ASSERT_RPC,
    "openai_fetch",
    OPENAI_COST_FINALIZE_RPC,
  ]);

  assert.equal(output.operations[0].outcome, "confirmed");
});

test("provider monetary record reaches transactional finalizer", async () => {
  const h = harness({ withRecord: true });
  const output = await h.run();

  assert.equal(output.confirmedCount, 1);
  assert.equal(output.failureRecordedCount, 0);
  assert.equal(
    h.calls.filter(
      (name) => name === OPENAI_COST_FINALIZE_RPC,
    ).length,
    1,
  );
});

test("HTTP 429 records retryable failure without finalization", async () => {
  const h = harness({ httpStatus: 429 });
  const output = await h.run();

  assert.equal(output.confirmedCount, 0);
  assert.equal(output.failureRecordedCount, 1);
  assert.equal(output.needsReviewCount, 0);

  assert.equal(
    output.operations[0].outcome === "failure_recorded" &&
      output.operations[0].state,
    "retryable_failed",
  );

  assert.ok(h.calls.includes(OPENAI_COST_FAIL_RPC));
  assert.ok(!h.calls.includes(OPENAI_COST_FINALIZE_RPC));
});

test("HTTP 401 records permanent failure", async () => {
  const h = harness({ httpStatus: 401 });
  const output = await h.run();

  assert.equal(output.confirmedCount, 0);
  assert.equal(output.failureRecordedCount, 1);
  assert.equal(
    output.operations[0].outcome === "failure_recorded" &&
      output.operations[0].state,
    "permanent_failed",
  );

  assert.ok(!h.calls.includes(OPENAI_COST_FINALIZE_RPC));
});

test("uncertain finalizer transport never invokes failure RPC", async () => {
  const h = harness({ finalizationError: true });
  const output = await h.run();

  assert.equal(output.confirmedCount, 0);
  assert.equal(output.failureRecordedCount, 0);
  assert.equal(output.needsReviewCount, 1);

  assert.ok(h.calls.includes(OPENAI_COST_FINALIZE_RPC));
  assert.ok(!h.calls.includes(OPENAI_COST_FAIL_RPC));

  assert.equal(
    output.operations[0].outcome === "needs_review" &&
      output.operations[0].phase,
    "finalization",
  );
});

test("uncertain failure RPC does not produce confirmed state", async () => {
  const h = harness({
    httpStatus: 429,
    failureError: true,
  });

  const output = await h.run();

  assert.equal(output.confirmedCount, 0);
  assert.equal(output.failureRecordedCount, 0);
  assert.equal(output.needsReviewCount, 1);

  assert.equal(
    h.calls.filter(
      (name) => name === OPENAI_COST_FAIL_RPC,
    ).length,
    1,
  );
});

test("claim RPC error stops before provider calls", async () => {
  const h = harness({ claimError: true });

  await assert.rejects(
    () => h.run(),
    /OPENAI_COST_CLAIM_OUTCOME_UNCERTAIN/,
  );

  assert.deepEqual(h.calls, [OPENAI_COST_CLAIM_RPC]);
});

test("claim assertion failure stops before provider calls", async () => {
  const h = harness({ assertError: true });

  await assert.rejects(
    () => h.run(),
    /OPENAI_COST_CLAIM_ASSERT_UNCONFIRMED/,
  );

  assert.deepEqual(h.calls, [
    OPENAI_COST_CLAIM_RPC,
    OPENAI_COST_ASSERT_RPC,
  ]);
});
