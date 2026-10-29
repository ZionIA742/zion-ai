import test from "node:test";
import assert from "node:assert/strict";

import type {
  OpenAiCostClaimResult,
} from "./zion-admin-openai-cost-claimed-operations";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

import {
  planDailyOpenAiCostCollection,
} from "./zion-admin-openai-cost-daily-planner";

import {
  DAILY_OPENAI_COST_CRON_ACTOR,
  validateDailyOpenAiCostClaim,
} from "./zion-admin-openai-cost-daily-claim-validator";

const NOW = new Date("2026-10-29T14:00:00.000Z");
const ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "22222222-2222-4222-8222-222222222222";

function sample(): OpenAiCostClaimResult {
  const plan = planDailyOpenAiCostCollection({
    now: NOW,
    inventoryVerified: true,
    existingQueryIdentities: [],
  });

  assert.equal(plan.status, "prepare");

  if (plan.status !== "prepare") {
    throw new Error("PLAN_UNAVAILABLE");
  }

  return {
    outcome: "claimed",
    claimedCount: 1,
    operations: [{
      operationId: ID,
      operationKey: plan.operationKey,
      claimToken: TOKEN,
      claimedBy: DAILY_OPENAI_COST_CRON_ACTOR,
      claimExpiresAt: "2026-10-29T14:15:00.000Z",
      attemptCount: 1,
      maxAttempts: 3,
      contract: buildOpenAiCostQueryContract(
        plan.costsRequest,
      ),
    }],
  };
}

test("accepts exactly one matching canonical daily claim", () => {
  assert.equal(
    validateDailyOpenAiCostClaim(sample(), ID, NOW),
    true,
  );
});

test("rejects another operation ID", () => {
  assert.equal(
    validateDailyOpenAiCostClaim(
      sample(),
      "33333333-3333-4333-8333-333333333333",
      NOW,
    ),
    false,
  );
});

test("rejects another UTC planning day", () => {
  assert.equal(
    validateDailyOpenAiCostClaim(
      sample(),
      ID,
      new Date("2026-10-30T14:00:00.000Z"),
    ),
    false,
  );
});

test("rejects retries and previous attempts", () => {
  const result = sample();
  result.operations[0].attemptCount = 2;

  assert.equal(
    validateDailyOpenAiCostClaim(result, ID, NOW),
    false,
  );
});

test("rejects an operator outside the cron identity", () => {
  const result = sample();
  result.operations[0].claimedBy =
    "zion-admin-financial-worker";

  assert.equal(
    validateDailyOpenAiCostClaim(result, ID, NOW),
    false,
  );
});

test("rejects an altered operation key", () => {
  const result = sample();
  result.operations[0].operationKey = "wrong-key";

  assert.equal(
    validateDailyOpenAiCostClaim(result, ID, NOW),
    false,
  );
});

test("rejects an altered financial query identity", () => {
  const result = sample();
  result.operations[0].contract.queryIdentity =
    "openai_organization_costs:v1:incorrect";

  assert.equal(
    validateDailyOpenAiCostClaim(result, ID, NOW),
    false,
  );
});

test("rejects changed query parameters", () => {
  const result = sample();
  result.operations[0].contract.queryParameters.limit = 2;

  assert.equal(
    validateDailyOpenAiCostClaim(result, ID, NOW),
    false,
  );
});

test("rejects a changed financial period", () => {
  const result = sample();
  result.operations[0].contract.periodEnd =
    "2026-10-29T00:00:00.000Z";

  assert.equal(
    validateDailyOpenAiCostClaim(result, ID, NOW),
    false,
  );
});

test("rejects an expired lease", () => {
  const result = sample();
  result.operations[0].claimExpiresAt =
    "2026-10-29T13:59:59.000Z";

  assert.equal(
    validateDailyOpenAiCostClaim(result, ID, NOW),
    false,
  );
});

test("rejects an empty claim without collection", () => {
  const result = sample();
  result.claimedCount = 0;
  result.operations = [];

  assert.equal(
    validateDailyOpenAiCostClaim(result, ID, NOW),
    false,
  );
});

test("rejects a malformed expected operation ID", () => {
  assert.equal(
    validateDailyOpenAiCostClaim(sample(), "not-a-uuid", NOW),
    false,
  );
});