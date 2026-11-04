import assert from "node:assert/strict";
import test from "node:test";

import {
  eligibleDailyOpenAiCostRetry,
} from "./zion-admin-openai-cost-daily-retry-eligibility";

import {
  planDailyOpenAiCostCollection,
} from "./zion-admin-openai-cost-daily-planner";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

const NOW = new Date("2026-11-05T12:20:11.000Z");

function candidate(
  overrides: Record<string, unknown> = {},
) {
  const plan = planDailyOpenAiCostCollection({
    now: NOW,
    inventoryVerified: true,
    existingQueryIdentities: [],
  });

  assert.equal(plan.status, "prepare");

  if (plan.status !== "prepare") {
    throw new Error("PLAN_UNAVAILABLE");
  }

  const contract = buildOpenAiCostQueryContract(
    plan.costsRequest,
  );

  return {
    operationId: "11111111-1111-4111-8111-111111111111",
    operationKey: plan.operationKey,
    queryIdentity: plan.queryIdentity,
    queryParameters: contract.queryParameters,
    provider: "openai",
    source: "openai_organization_costs",
    state: "retryable_failed",
    attemptCount: 1,
    maxAttempts: 3,
    nextAttemptAt: "2026-11-05T12:20:10.000Z",
    periodStart: new Date(
      plan.costsRequest.startTime * 1000,
    ).toISOString(),
    periodEnd: new Date(
      plan.costsRequest.endTime * 1000,
    ).toISOString(),
    claimToken: null,
    claimExpiresAt: null,
    snapshotCollectionId: null,
    confirmedAt: null,
    ...overrides,
  };
}

test("accepts due first retry for current UTC day", () => {
  assert.equal(
    eligibleDailyOpenAiCostRetry(candidate(), NOW),
    true,
  );
});

test("accepts due second retry", () => {
  assert.equal(
    eligibleDailyOpenAiCostRetry(
      candidate({ attemptCount: 2 }),
      NOW,
    ),
    true,
  );
});

test("does not run before next attempt", () => {
  assert.equal(
    eligibleDailyOpenAiCostRetry(
      candidate({
        nextAttemptAt: "2026-11-05T12:21:00.000Z",
      }),
      NOW,
    ),
    false,
  );
});

test("rejects confirmed and uncertain operations", () => {
  for (const state of [
    "confirmed",
    "uncertain",
    "permanent_failed",
    "processing",
    "pending",
  ]) {
    assert.equal(
      eligibleDailyOpenAiCostRetry(
        candidate({ state }),
        NOW,
      ),
      false,
    );
  }
});

test("rejects exhausted or invalid attempts", () => {
  for (const attemptCount of [0, 3, 4, 1.5]) {
    assert.equal(
      eligibleDailyOpenAiCostRetry(
        candidate({ attemptCount }),
        NOW,
      ),
      false,
    );
  }
});

test("rejects mismatched financial identity", () => {
  for (const changes of [
    { operationKey: "wrong-key" },
    { queryIdentity: "wrong-identity" },
    { provider: "other" },
    { source: "other" },
    { operationId: "invalid" },
  ]) {
    assert.equal(
      eligibleDailyOpenAiCostRetry(
        candidate(changes),
        NOW,
      ),
      false,
    );
  }
});

test("rejects altered query parameters", () => {
  assert.equal(
    eligibleDailyOpenAiCostRetry(
      candidate({ queryParameters: {} }),
      NOW,
    ),
    false,
  );
});

test("rejects altered UTC financial periods", () => {
  for (const changes of [
    { periodStart: "2026-11-03T00:00:00.000Z" },
    { periodEnd: "2026-11-06T00:00:00.000Z" },
  ]) {
    assert.equal(
      eligibleDailyOpenAiCostRetry(
        candidate(changes),
        NOW,
      ),
      false,
    );
  }
});

test("never resumes a previous UTC day", () => {
  assert.equal(
    eligibleDailyOpenAiCostRetry(
      candidate(),
      new Date("2026-11-06T12:20:11.000Z"),
    ),
    false,
  );
});

test("rejects active claim or confirmed snapshot", () => {
  for (const changes of [
    { claimToken: "11111111-1111-4111-8111-111111111111" },
    { claimExpiresAt: "2026-11-05T12:30:00Z" },
    { snapshotCollectionId: "11111111-1111-4111-8111-111111111111" },
    { confirmedAt: "2026-11-05T12:19:00Z" },
  ]) {
    assert.equal(
      eligibleDailyOpenAiCostRetry(
        candidate(changes),
        NOW,
      ),
      false,
    );
  }
});

test("rejects invalid timestamps and input", () => {
  assert.equal(
    eligibleDailyOpenAiCostRetry(
      candidate({ nextAttemptAt: null }),
      NOW,
    ),
    false,
  );

  assert.equal(
    eligibleDailyOpenAiCostRetry(
      candidate(),
      new Date(NaN),
    ),
    false,
  );

  assert.equal(
    eligibleDailyOpenAiCostRetry(null, NOW),
    false,
  );
});