import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenAiCostCutoverCronGetHandler,
} from "./route";

import {
  createOpenAiCostCutoverRunner,
  type CutoverExecutionResult,
} from "../../../../lib/server/zion-admin-openai-cost-cutover-runner";

const URL =
  "https://example.test/api/cron/zion-admin-openai-cost-cutover";

function request(method = "GET") {
  return new Request(URL, { method });
}

function handlerWith(
  result: CutoverExecutionResult,
) {
  return createOpenAiCostCutoverCronGetHandler({
    runCutover: async () => result,
  });
}

test("construction performs no execution", () => {
  let calls = 0;

  createOpenAiCostCutoverCronGetHandler({
    runCutover: async () => {
      calls++;
      return {
        status: "skipped",
        reason: "already_confirmed",
      };
    },
  });

  assert.equal(calls, 0);
});

test("only GET is accepted", async () => {
  let calls = 0;

  const handler = createOpenAiCostCutoverCronGetHandler({
    runCutover: async () => {
      calls++;
      return {
        status: "confirmed",
        dateUtc: "2026-11-03",
      };
    },
  });

  const response = await handler(request("POST"));

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET");
  assert.equal(calls, 0);
});

test("unauthorized cron receives 401", async () => {
  const response = await handlerWith({
    status: "blocked",
    reason: "cron_unauthorized",
  })(request());

  assert.equal(response.status, 401);

  assert.deepEqual(await response.json(), {
    ok: false,
    error: "UNAUTHORIZED_CRON_ROUTE",
  });
});

test("real authorization blocks inventory access", async () => {
  let inventoryCalls = 0;

  const runner = createOpenAiCostCutoverRunner({
    inspect: async () => {
      inventoryCalls++;
      return { status: "absent" };
    },
  });

  const handler = createOpenAiCostCutoverCronGetHandler({
    runCutover: runner,
  });

  const response = await handler(request());

  assert.equal(response.status, 401);
  assert.equal(inventoryCalls, 0);
});

test("disabled cutover blocks inventory access", async () => {
  let inventoryCalls = 0;

  const runner = createOpenAiCostCutoverRunner({
    authorize: () => ({
      ok: true,
      status: "authorized",
    }),
    enabled: () => false,
    configuredDateUtc: () => "2026-11-05",
    now: () => new Date("2026-11-05T12:15:00Z"),
    inspect: async () => {
      inventoryCalls++;
      return { status: "absent" };
    },
  });

  const response =
    await createOpenAiCostCutoverCronGetHandler({
      runCutover: runner,
    })(request());

  assert.equal(response.status, 503);
  assert.equal(inventoryCalls, 0);
});

test("wrong cutover date blocks inventory", async () => {
  let inventoryCalls = 0;

  const runner = createOpenAiCostCutoverRunner({
    authorize: () => ({
      ok: true,
      status: "authorized",
    }),
    enabled: () => true,
    configuredDateUtc: () => "2026-11-06",
    now: () => new Date("2026-11-05T12:15:00Z"),
    inspect: async () => {
      inventoryCalls++;
      return { status: "absent" };
    },
  });

  const response =
    await createOpenAiCostCutoverCronGetHandler({
      runCutover: runner,
    })(request());

  assert.equal(response.status, 503);
  assert.equal(inventoryCalls, 0);
});

test("inventory block is never success", async () => {
  const response = await handlerWith({
    status: "blocked",
    reason: "inventory_unavailable",
  })(request());

  assert.equal(response.status, 503);
});

test("confirmed bridge has minimal response", async () => {
  const response = await handlerWith({
    status: "confirmed",
    dateUtc: "2026-11-03",
  })(request());

  assert.equal(response.status, 200);

  assert.deepEqual(await response.json(), {
    ok: true,
    status: "confirmed",
  });
});

test("already confirmed is skipped", async () => {
  const response = await handlerWith({
    status: "skipped",
    reason: "already_confirmed",
  })(request());

  assert.deepEqual(await response.json(), {
    ok: true,
    status: "skipped",
  });
});

test("empty competing claim is skipped", async () => {
  const response = await handlerWith({
    status: "skipped",
    reason: "claim_empty",
  })(request());

  assert.equal(response.status, 200);
});

test("uncertain preparation requires review", async () => {
  const response = await handlerWith({
    status: "needs_review",
    reason: "preparation_uncertain",
  })(request());

  assert.deepEqual(await response.json(), {
    ok: false,
    status: "needs_review",
  });
});

test("uncertain financial execution requires review", async () => {
  const response = await handlerWith({
    status: "needs_review",
    reason: "execution_uncertain",
  })(request());

  assert.equal(response.status, 200);
});

test("unexpected result is not confirmation", async () => {
  const handler = createOpenAiCostCutoverCronGetHandler({
    runCutover: async () =>
      ({ status: "unexpected" } as CutoverExecutionResult),
  });

  const response = await handler(request());

  assert.deepEqual(await response.json(), {
    ok: false,
    status: "needs_review",
  });
});

test("transport uncertainty does not trigger HTTP retry", async () => {
  const handler = createOpenAiCostCutoverCronGetHandler({
    runCutover: async () => {
      throw new Error("FINANCIAL_OUTCOME_UNCERTAIN");
    },
  });

  const response = await handler(request());

  assert.equal(response.status, 200);

  assert.deepEqual(await response.json(), {
    ok: false,
    status: "needs_review",
  });
});

test("financial identifiers are never exposed", async () => {
  const response = await handlerWith({
    status: "confirmed",
    dateUtc: "2026-11-03",
  })(request());

  const body = await response.text();

  assert.equal(body.includes("2026-11-03"), false);
  assert.equal(body.includes("operationId"), false);
  assert.equal(body.includes("queryIdentity"), false);
});

test("responses disable caching", async () => {
  const response = await handlerWith({
    status: "skipped",
    reason: "already_confirmed",
  })(request());

  assert.equal(
    response.headers.get("Cache-Control"),
    "no-store",
  );

  assert.equal(
    response.headers.get("X-Content-Type-Options"),
    "nosniff",
  );
});