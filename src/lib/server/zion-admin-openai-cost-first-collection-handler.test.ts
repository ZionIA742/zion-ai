import assert from "node:assert/strict";
import test from "node:test";

import {
  createFirstOpenAiCostCollectionHandler,
  FIRST_OPENAI_COST_CONFIRMATION,
  FIRST_OPENAI_COST_OPERATION_ID,
} from "./zion-admin-openai-cost-first-collection-handler";

import type {
  OpenAiCostExecutionGateOutcome,
} from "./zion-admin-openai-cost-execution-gate";

const URL = "https://zion.example/api/zion-admin/costs/openai-first-run";

function success(
  status: "confirmed" | "no_work" = "confirmed",
): OpenAiCostExecutionGateOutcome {
  const count = status === "confirmed" ? 1 : 0;

  return {
    ok: true,
    status,
    claimedCount: count,
    confirmedCount: count,
    failureRecordedCount: 0,
    needsReviewCount: 0,
  };
}

function payload() {
  return {
    operationId: FIRST_OPENAI_COST_OPERATION_ID,
    confirmation: FIRST_OPENAI_COST_CONFIRMATION,
  };
}

function request(
  body: unknown = payload(),
  overrides: {
    method?: string;
    origin?: string | null;
    fetchSite?: string | null;
    contentType?: string;
    rawBody?: string;
  } = {},
): Request {
  const method = overrides.method ?? "POST";
  const headers = new Headers();

  if (overrides.origin !== null) {
    headers.set(
      "origin",
      overrides.origin ?? "https://zion.example",
    );
  }

  if (overrides.fetchSite !== null) {
    headers.set(
      "sec-fetch-site",
      overrides.fetchSite ?? "same-origin",
    );
  }

  headers.set(
    "content-type",
    overrides.contentType ?? "application/json",
  );

  return new Request(URL, {
    method,
    headers,
    ...(method === "POST"
      ? { body: overrides.rawBody ?? JSON.stringify(body) }
      : {}),
  });
}

function harness(
  changes: {
    enabled?: boolean;
    flagThrows?: boolean;
    outcome?: OpenAiCostExecutionGateOutcome;
    runThrows?: boolean;
  } = {},
) {
  const calls: string[] = [];

  const handler = createFirstOpenAiCostCollectionHandler({
    isEnabled: () => {
      if (changes.flagThrows) throw Error("flag unavailable");
      return changes.enabled ?? true;
    },
    run: async (operationId) => {
      calls.push(operationId);
      if (changes.runThrows) throw Error("transport lost");
      return changes.outcome ?? success();
    },
  });

  return { handler, calls };
}

async function check(
  response: Response,
  expectedStatus: number,
  expectedCode?: string,
) {
  assert.equal(response.status, expectedStatus);
  assert.equal(
    response.headers.get("cache-control"),
    "no-store",
  );

  const body = await response.json();

  if (expectedCode) {
    assert.equal(body.code, expectedCode);
  }

  return body;
}

test("constructing handler performs no financial IO", () => {
  const h = harness();
  assert.equal(typeof h.handler, "function");
  assert.deepEqual(h.calls, []);
});

test("manual one-shot flag disabled blocks execution", async () => {
  const h = harness({ enabled: false });
  await check(
    await h.handler(request()),
    503,
    "OPENAI_COST_FIRST_RUN_DISABLED",
  );
  assert.deepEqual(h.calls, []);
});

test("unavailable manual flag fails closed", async () => {
  const h = harness({ flagThrows: true });
  await check(
    await h.handler(request()),
    503,
    "OPENAI_COST_FIRST_RUN_DISABLED",
  );
  assert.deepEqual(h.calls, []);
});

test("GET cannot trigger execution", async () => {
  const h = harness();
  await check(
    await h.handler(request(undefined, { method: "GET" })),
    405,
    "OPENAI_COST_FIRST_RUN_METHOD_INVALID",
  );
  assert.deepEqual(h.calls, []);
});

test("missing Origin is rejected", async () => {
  const h = harness();
  await check(
    await h.handler(request(undefined, { origin: null })),
    403,
    "OPENAI_COST_FIRST_RUN_ORIGIN_DENIED",
  );
  assert.deepEqual(h.calls, []);
});

test("foreign Origin is rejected", async () => {
  const h = harness();
  await check(
    await h.handler(request(undefined, {
      origin: "https://untrusted.example",
    })),
    403,
    "OPENAI_COST_FIRST_RUN_ORIGIN_DENIED",
  );
  assert.deepEqual(h.calls, []);
});

test("cross-site fetch metadata is rejected", async () => {
  const h = harness();
  await check(
    await h.handler(request(undefined, {
      fetchSite: "cross-site",
    })),
    403,
    "OPENAI_COST_FIRST_RUN_ORIGIN_DENIED",
  );
  assert.deepEqual(h.calls, []);
});

test("non-JSON media type is rejected", async () => {
  const h = harness();
  await check(
    await h.handler(request(undefined, {
      contentType: "text/plain",
    })),
    415,
    "OPENAI_COST_FIRST_RUN_MEDIA_INVALID",
  );
  assert.deepEqual(h.calls, []);
});

test("malformed JSON cannot trigger execution", async () => {
  const h = harness();
  await check(
    await h.handler(request(undefined, {
      rawBody: "{bad",
    })),
    400,
    "OPENAI_COST_FIRST_RUN_BODY_INVALID",
  );
  assert.deepEqual(h.calls, []);
});

test("oversized body cannot trigger execution", async () => {
  const h = harness();
  await check(
    await h.handler(request(undefined, {
      rawBody: "x".repeat(513),
    })),
    413,
    "OPENAI_COST_FIRST_RUN_BODY_TOO_LARGE",
  );
  assert.deepEqual(h.calls, []);
});

test("extra fields are rejected", async () => {
  const h = harness();
  await check(
    await h.handler(request({
      ...payload(),
      limit: 10,
    })),
    400,
    "OPENAI_COST_FIRST_RUN_TARGET_INVALID",
  );
  assert.deepEqual(h.calls, []);
});

test("another operation ID is rejected", async () => {
  const h = harness();
  await check(
    await h.handler(request({
      ...payload(),
      operationId: "11111111-1111-4111-8111-111111111111",
    })),
    400,
    "OPENAI_COST_FIRST_RUN_TARGET_INVALID",
  );
  assert.deepEqual(h.calls, []);
});

test("wrong confirmation is rejected", async () => {
  const h = harness();
  await check(
    await h.handler(request({
      ...payload(),
      confirmation: "wrong",
    })),
    400,
    "OPENAI_COST_FIRST_RUN_TARGET_INVALID",
  );
  assert.deepEqual(h.calls, []);
});

test("valid confirmation delegates exactly once", async () => {
  const h = harness();
  const body = await check(await h.handler(request()), 200);

  assert.equal(body.status, "confirmed");
  assert.equal(body.confirmedCount, 1);
  assert.equal(body.operationId, FIRST_OPENAI_COST_OPERATION_ID);
  assert.deepEqual(h.calls, [FIRST_OPENAI_COST_OPERATION_ID]);
});

test("no work is not mistaken for collected costs", async () => {
  const h = harness({ outcome: success("no_work") });
  const body = await check(await h.handler(request()), 200);

  assert.equal(body.status, "no_work");
  assert.equal(body.confirmedCount, 0);
  assert.deepEqual(h.calls, [FIRST_OPENAI_COST_OPERATION_ID]);
});

test("ambiguous execution never retries automatically", async () => {
  const h = harness({ runThrows: true });
  await check(
    await h.handler(request()),
    503,
    "OPENAI_COST_EXECUTION_UNCONFIRMED",
  );
  assert.deepEqual(h.calls, [FIRST_OPENAI_COST_OPERATION_ID]);
});
