import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenAiCostsCronGetHandler,
} from "./route";

import type {
  DailyPreparationOutcome,
} from "@/lib/server/zion-admin-openai-cost-daily-preparation-service";

const URL =
  "https://zionapi.com.br/api/cron/zion-admin-openai-costs";

const ID = "11111111-1111-4111-8111-111111111111";

function handlerFor(outcome: DailyPreparationOutcome) {
  return createOpenAiCostsCronGetHandler({
    runPreparation: async () => outcome,
  });
}

async function invoke(
  outcome: DailyPreparationOutcome,
) {
  return handlerFor(outcome)(new Request(URL));
}

function assertHeaders(response: Response) {
  assert.equal(
    response.headers.get("cache-control"),
    "no-store",
  );
  assert.equal(
    response.headers.get("x-content-type-options"),
    "nosniff",
  );
}

test("returns success for prepared pending operation", async () => {
  const response = await invoke({
    status: "prepared_pending",
    operationId: ID,
    operationKey: "sensitive-operation-key",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "prepared_pending",
  });
  assertHeaders(response);
});

test("returns success for existing confirmed operation", async () => {
  const response = await invoke({
    status: "existing",
    operationId: ID,
    state: "confirmed",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "existing",
  });
  assertHeaders(response);
});

test("does not expose uncertain operation details", async () => {
  const response = await invoke({
    status: "existing",
    operationId: ID,
    state: "uncertain",
  });

  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(body.includes(ID), false);
  assert.equal(body.includes("uncertain"), false);
});

test("denies unauthorized financial cron request", async () => {
  const response = await invoke({
    status: "blocked",
    reason: "authorization_denied",
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "UNAUTHORIZED_CRON_ROUTE",
  });
  assertHeaders(response);
});

test("disabled financial flags return unavailable", async () => {
  const response = await invoke({
    status: "blocked",
    reason: "financial_flags_disabled",
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "FINANCIAL_CRON_UNAVAILABLE",
  });
});

test("inventory failure returns generic unavailable", async () => {
  const response = await invoke({
    status: "blocked",
    reason: "inventory_blocked",
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "FINANCIAL_CRON_UNAVAILABLE",
  });
});

test("unconfirmed preparation does not trigger retry", async () => {
  let calls = 0;

  const handler = createOpenAiCostsCronGetHandler({
    runPreparation: async () => {
      calls++;
      return {
        status: "blocked",
        reason: "preparation_unconfirmed",
      };
    },
  });

  const response = await handler(new Request(URL));

  assert.equal(response.status, 503);
  assert.equal(calls, 1);
});

test("unexpected internal error is not exposed", async () => {
  const handler = createOpenAiCostsCronGetHandler({
    runPreparation: async () => {
      throw new Error("sensitive database error");
    },
  });

  const response = await handler(new Request(URL));
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(body.includes("sensitive database error"), false);
  assertHeaders(response);
});

test("rejects unexpected service outcome", async () => {
  const response = await invoke({
    status: "unexpected",
  } as unknown as DailyPreparationOutcome);

  assert.equal(response.status, 503);
});

test("rejects non-GET without running preparation", async () => {
  let calls = 0;

  const handler = createOpenAiCostsCronGetHandler({
    runPreparation: async () => {
      calls++;
      return {
        status: "prepared_pending",
        operationId: ID,
        operationKey: "never-called",
      };
    },
  });

  const response = await handler(
    new Request(URL, { method: "POST" }),
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  assert.equal(calls, 0);
  assertHeaders(response);
});
