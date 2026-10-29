import test from "node:test";
import assert from "node:assert/strict";

import {
  createOpenAiCostsCronGetHandler,
} from "./route";

import type {
  DailyOpenAiCostExecutionOutcome,
} from "@/lib/server/zion-admin-openai-cost-daily-execution-runner";

const ID = "11111111-1111-4111-8111-111111111111";

function request(method = "GET") {
  return new Request(
    "https://example.test/api/cron/zion-admin-openai-costs",
    { method },
  );
}

function setup(options: {
  automatic?: boolean;
  execution?: DailyOpenAiCostExecutionOutcome;
  throwExecution?: boolean;
  throwFlag?: boolean;
  throwPreparation?: boolean;
} = {}) {
  const calls = {
    preparation: 0,
    execution: 0,
    flagReads: 0,
  };

  const handler = createOpenAiCostsCronGetHandler({
    isAutoExecutionEnabled: () => {
      calls.flagReads++;

      if (options.throwFlag) {
        throw new Error("PRIVATE_FLAG_ERROR");
      }

      return options.automatic === true;
    },

    runPreparation: async () => {
      calls.preparation++;

      if (options.throwPreparation) {
        throw new Error("PRIVATE_PREPARATION_ERROR");
      }

      return {
        status: "prepared_pending",
        operationId: ID,
        operationKey: "opaque-preparation-key",
      };
    },

    runExecution: async () => {
      calls.execution++;

      if (options.throwExecution) {
        throw new Error("PRIVATE_FINANCIAL_ERROR");
      }

      return options.execution ?? {
        status: "confirmed",
        operationId: ID,
      };
    },
  });

  return { handler, calls };
}

test("disabled execution preserves preparation-only path", async () => {
  const h = setup();

  const response = await h.handler(request());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "prepared_pending",
  });

  assert.equal(h.calls.preparation, 1);
  assert.equal(h.calls.execution, 0);
});

test("enabled execution invokes only the protected runner", async () => {
  const h = setup({ automatic: true });

  const response = await h.handler(request());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "confirmed",
  });

  assert.equal(h.calls.preparation, 0);
  assert.equal(h.calls.execution, 1);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("automatic execution rejects unauthorized requests", async () => {
  const h = setup({
    automatic: true,
    execution: {
      status: "blocked",
      reason: "authorization_denied",
    },
  });

  const response = await h.handler(request());

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "UNAUTHORIZED_CRON_ROUTE",
  });

  assert.equal(h.calls.preparation, 0);
});

test("disabled financial gate never reports success", async () => {
  const h = setup({
    automatic: true,
    execution: {
      status: "blocked",
      reason: "preparation_blocked",
    },
  });

  const response = await h.handler(request());

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "FINANCIAL_CRON_UNAVAILABLE",
  });
});

test("previously processed operation is skipped", async () => {
  const h = setup({
    automatic: true,
    execution: {
      status: "skipped",
      reason: "not_pending",
    },
  });

  const response = await h.handler(request());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "skipped",
  });
});

test("empty claim does not report confirmed collection", async () => {
  const h = setup({
    automatic: true,
    execution: {
      status: "skipped",
      reason: "claim_empty",
    },
  });

  const response = await h.handler(request());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "skipped",
  });
});

test("uncertain execution is acknowledged but not confirmed", async () => {
  const h = setup({
    automatic: true,
    execution: {
      status: "needs_review",
      reason: "execution_uncertain",
      operationId: ID,
    },
  });

  const response = await h.handler(request());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: false,
    status: "needs_review",
  });

  assert.equal(JSON.stringify(body).includes(ID), false);
});

test("unexpected execution exception is never exposed", async () => {
  const h = setup({
    automatic: true,
    throwExecution: true,
  });

  const response = await h.handler(request());
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.deepEqual(body, {
    ok: false,
    error: "FINANCIAL_CRON_UNAVAILABLE",
  });

  assert.equal(
    JSON.stringify(body).includes("PRIVATE_FINANCIAL_ERROR"),
    false,
  );

  assert.equal(h.calls.execution, 1);
});

test("flag reader exception fails closed", async () => {
  const h = setup({ throwFlag: true });

  const response = await h.handler(request());

  assert.equal(response.status, 503);
  assert.equal(h.calls.preparation, 0);
  assert.equal(h.calls.execution, 0);
});

test("non-GET never invokes the execution runner", async () => {
  const h = setup({ automatic: true });

  const response = await h.handler(request("POST"));

  assert.equal(response.status, 405);
  assert.equal(h.calls.flagReads, 0);
  assert.equal(h.calls.preparation, 0);
  assert.equal(h.calls.execution, 0);
});