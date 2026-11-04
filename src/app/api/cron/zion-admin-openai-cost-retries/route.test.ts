import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenAiCostRetryCronGetHandler,
} from "./route";

import {
  createDailyOpenAiCostRetryRunner,
  type DailyRetryRunnerResult,
} from "../../../../lib/server/zion-admin-openai-cost-daily-retry-runner";

const URL =
  "https://example.test/api/cron/zion-admin-openai-cost-retries";

const ID =
  "11111111-1111-4111-8111-111111111111";

function request(method = "GET") {
  return new Request(URL, { method });
}

async function invoke(
  result: DailyRetryRunnerResult,
) {
  const handler = createOpenAiCostRetryCronGetHandler({
    isRetryEnabled: () => true,
    runRetry: async () => result,
  });

  return handler(request());
}

test("construction does not execute the runner", () => {
  let calls = 0;

  createOpenAiCostRetryCronGetHandler({
    isRetryEnabled: () => true,
    runRetry: async () => {
      calls++;
      return { status: "skipped", reason: "not_found" };
    },
  });

  assert.equal(calls, 0);
});

test("explicit retry flag is required", async () => {
  let calls = 0;

  const handler = createOpenAiCostRetryCronGetHandler({
    isRetryEnabled: () => false,
    runRetry: async () => {
      calls++;
      return { status: "confirmed", operationId: ID };
    },
  });

  const response = await handler(request());

  assert.equal(response.status, 503);
  assert.equal(calls, 0);
});

test("only GET is allowed", async () => {
  let calls = 0;

  const handler = createOpenAiCostRetryCronGetHandler({
    isRetryEnabled: () => true,
    runRetry: async () => {
      calls++;
      return { status: "confirmed", operationId: ID };
    },
  });

  const response = await handler(request("POST"));

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET");
  assert.equal(calls, 0);
});

test("invalid feature flag blocks execution", async () => {
  let calls = 0;

  const handler = createOpenAiCostRetryCronGetHandler({
    isRetryEnabled: () => {
      throw new Error("FLAG_UNAVAILABLE");
    },
    runRetry: async () => {
      calls++;
      return { status: "confirmed", operationId: ID };
    },
  });

  assert.equal((await handler(request())).status, 503);
  assert.equal(calls, 0);
});

test("unauthorized cron returns 401", async () => {
  const response = await invoke({
    status: "blocked",
    reason: "cron_unauthorized",
  });

  assert.equal(response.status, 401);

  assert.deepEqual(await response.json(), {
    ok: false,
    error: "UNAUTHORIZED_CRON_ROUTE",
  });
});

test("real authorization blocks inventory access", async () => {
  let inventoryReads = 0;

  const realRunner = createDailyOpenAiCostRetryRunner({
    inspect: async () => {
      inventoryReads++;
      return { status: "skipped", reason: "not_found" };
    },
  });

  const handler = createOpenAiCostRetryCronGetHandler({
    isRetryEnabled: () => true,
    runRetry: realRunner,
  });

  const response = await handler(request());

  assert.equal(response.status, 401);
  assert.equal(inventoryReads, 0);
});

test("financial execution disabled returns 503", async () => {
  const response = await invoke({
    status: "blocked",
    reason: "financial_execution_disabled",
  });

  assert.equal(response.status, 503);
});

test("confirmed retry returns minimal success", async () => {
  const response = await invoke({
    status: "confirmed",
    operationId: ID,
  });

  assert.equal(response.status, 200);

  assert.deepEqual(await response.json(), {
    ok: true,
    status: "confirmed",
  });
});

test("skipped retry is not financial confirmation", async () => {
  const response = await invoke({
    status: "skipped",
    reason: "not_due",
  });

  assert.equal(response.status, 200);

  assert.deepEqual(await response.json(), {
    ok: true,
    status: "skipped",
  });
});

test("recorded failure is not reported as success", async () => {
  const response = await invoke({
    status: "failure_recorded",
    operationId: ID,
    retryScheduled: true,
  });

  assert.equal(response.status, 200);

  assert.deepEqual(await response.json(), {
    ok: false,
    status: "failure_recorded",
  });
});

test("uncertain result requires review", async () => {
  const response = await invoke({
    status: "needs_review",
    reason: "execution_uncertain",
    operationId: ID,
  });

  assert.equal(response.status, 200);

  assert.deepEqual(await response.json(), {
    ok: false,
    status: "needs_review",
  });
});

test("unexpected result is never financial success", async () => {
  const handler = createOpenAiCostRetryCronGetHandler({
    isRetryEnabled: () => true,
    runRetry: async () =>
      ({ status: "unexpected" } as DailyRetryRunnerResult),
  });

  const response = await handler(request());

  assert.deepEqual(await response.json(), {
    ok: false,
    status: "needs_review",
  });
});

test("unexpected exception does not cause blind retry", async () => {
  const handler = createOpenAiCostRetryCronGetHandler({
    isRetryEnabled: () => true,
    runRetry: async () => {
      throw new Error("FINANCIAL_RESULT_UNCERTAIN");
    },
  });

  const response = await handler(request());

  assert.equal(response.status, 200);

  assert.deepEqual(await response.json(), {
    ok: false,
    status: "needs_review",
  });
});

test("responses never expose financial identifiers", async () => {
  const response = await invoke({
    status: "confirmed",
    operationId: ID,
  });

  const body = await response.text();

  assert.equal(body.includes(ID), false);
  assert.equal(body.includes("operationId"), false);
});

test("responses explicitly disable caching", async () => {
  const response = await invoke({
    status: "skipped",
    reason: "not_found",
  });

  assert.equal(
    response.headers.get("Cache-Control"),
    "no-store",
  );

  assert.equal(
    response.headers.get("X-Content-Type-Options"),
    "nosniff",
  );
});