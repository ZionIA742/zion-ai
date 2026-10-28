import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenAiCostManualTargetedHandler,
} from "./zion-admin-openai-cost-manual-targeted-handler";

import type {
  OpenAiCostExecutionGateOutcome,
} from "./zion-admin-openai-cost-execution-gate";

const URL =
  "https://zion.example/api/zion-admin/costs/openai-manual-run";

const ID = "11111111-1111-4111-8111-111111111111";

const validPayload = () => ({
  operationId: ID,
  confirmation: `EXECUTAR_COLETA_OPENAI:${ID}`,
});

function makeRequest(
  payload: unknown = validPayload(),
  options: {
    method?: string;
    origin?: string | null;
    site?: string | null;
    contentType?: string;
    rawBody?: string;
  } = {},
): Request {
  const headers = new Headers();

  if (options.origin !== null) {
    headers.set(
      "origin",
      options.origin ?? "https://zion.example",
    );
  }

  if (options.site !== null) {
    headers.set(
      "sec-fetch-site",
      options.site ?? "same-origin",
    );
  }

  headers.set(
    "content-type",
    options.contentType ?? "application/json",
  );

  const method = options.method ?? "POST";

  return new Request(URL, {
    method,
    headers,
    ...(method === "POST"
      ? {
          body: options.rawBody ??
            JSON.stringify(payload),
        }
      : {}),
  });
}

function harness(options: {
  enabled?: boolean;
  flagThrows?: boolean;
  runThrows?: boolean;
  outcome?: OpenAiCostExecutionGateOutcome;
} = {}) {
  const calls: string[] = [];

  const handler = createOpenAiCostManualTargetedHandler({
    isEnabled: () => {
      if (options.flagThrows) {
        throw new Error("FLAG_UNAVAILABLE");
      }
      return options.enabled ?? true;
    },
    run: async (id) => {
      calls.push(id);

      if (options.runThrows) {
        throw new Error("TRANSPORT_UNKNOWN");
      }

      return options.outcome ?? {
        ok: true,
        status: "confirmed",
        claimedCount: 1,
        confirmedCount: 1,
        failureRecordedCount: 0,
        needsReviewCount: 0,
      };
    },
  });

  return { handler, calls };
}

async function expectResponse(
  response: Response,
  status: number,
  code?: string,
) {
  assert.equal(response.status, status);
  assert.equal(
    response.headers.get("cache-control"),
    "no-store",
  );

  const body = await response.json();

  if (code) {
    assert.equal(body.code, code);
  }

  return body;
}

test("manual flag disabled prevents execution", async () => {
  const h = harness({ enabled: false });

  await expectResponse(
    await h.handler(makeRequest()),
    503,
    "OPENAI_COST_MANUAL_TARGETED_DISABLED",
  );

  assert.deepEqual(h.calls, []);
});

test("manual flag failure is fail-closed", async () => {
  const h = harness({ flagThrows: true });

  await expectResponse(
    await h.handler(makeRequest()),
    503,
    "OPENAI_COST_MANUAL_TARGETED_DISABLED",
  );

  assert.deepEqual(h.calls, []);
});

test("GET cannot trigger a financial operation", async () => {
  const h = harness();

  await expectResponse(
    await h.handler(
      makeRequest(undefined, { method: "GET" }),
    ),
    405,
    "OPENAI_COST_MANUAL_TARGETED_METHOD_INVALID",
  );

  assert.deepEqual(h.calls, []);
});

test("missing Origin is rejected", async () => {
  const h = harness();

  await expectResponse(
    await h.handler(
      makeRequest(undefined, { origin: null }),
    ),
    403,
    "OPENAI_COST_MANUAL_TARGETED_ORIGIN_DENIED",
  );

  assert.deepEqual(h.calls, []);
});

test("foreign Origin is rejected", async () => {
  const h = harness();

  await expectResponse(
    await h.handler(
      makeRequest(undefined, {
        origin: "https://external.example",
      }),
    ),
    403,
    "OPENAI_COST_MANUAL_TARGETED_ORIGIN_DENIED",
  );

  assert.deepEqual(h.calls, []);
});

test("cross-site request is rejected", async () => {
  const h = harness();

  await expectResponse(
    await h.handler(
      makeRequest(undefined, { site: "cross-site" }),
    ),
    403,
    "OPENAI_COST_MANUAL_TARGETED_ORIGIN_DENIED",
  );

  assert.deepEqual(h.calls, []);
});

test("non-JSON content type is rejected", async () => {
  const h = harness();

  await expectResponse(
    await h.handler(
      makeRequest(undefined, {
        contentType: "text/plain",
      }),
    ),
    415,
    "OPENAI_COST_MANUAL_TARGETED_MEDIA_INVALID",
  );

  assert.deepEqual(h.calls, []);
});

test("malformed JSON is rejected", async () => {
  const h = harness();

  await expectResponse(
    await h.handler(
      makeRequest(undefined, { rawBody: "{invalid" }),
    ),
    400,
    "OPENAI_COST_MANUAL_TARGETED_BODY_INVALID",
  );

  assert.deepEqual(h.calls, []);
});

test("oversized body is rejected", async () => {
  const h = harness();

  await expectResponse(
    await h.handler(
      makeRequest(undefined, { rawBody: "x".repeat(513) }),
    ),
    413,
    "OPENAI_COST_MANUAL_TARGETED_BODY_TOO_LARGE",
  );

  assert.deepEqual(h.calls, []);
});

test("additional fields are rejected", async () => {
  const h = harness();

  await expectResponse(
    await h.handler(
      makeRequest({ ...validPayload(), extra: true }),
    ),
    400,
    "OPENAI_COST_MANUAL_TARGETED_TARGET_INVALID",
  );

  assert.deepEqual(h.calls, []);
});

test("invalid operation UUID is rejected", async () => {
  const h = harness();

  await expectResponse(
    await h.handler(
      makeRequest({
        operationId: "invalid",
        confirmation: "EXECUTAR_COLETA_OPENAI:invalid",
      }),
    ),
    400,
    "OPENAI_COST_MANUAL_TARGETED_TARGET_INVALID",
  );

  assert.deepEqual(h.calls, []);
});

test("confirmation for another UUID is rejected", async () => {
  const h = harness();

  await expectResponse(
    await h.handler(
      makeRequest({
        operationId: ID,
        confirmation:
          "EXECUTAR_COLETA_OPENAI:22222222-2222-4222-8222-222222222222",
      }),
    ),
    400,
    "OPENAI_COST_MANUAL_TARGETED_TARGET_INVALID",
  );

  assert.deepEqual(h.calls, []);
});

test("valid request delegates exactly once", async () => {
  const h = harness();

  const body = await expectResponse(
    await h.handler(makeRequest()),
    200,
  );

  assert.equal(body.status, "confirmed");
  assert.equal(body.confirmedCount, 1);
  assert.equal(body.operationId, ID);
  assert.deepEqual(h.calls, [ID]);
});

test("no_work is not counted as collected", async () => {
  const h = harness({
    outcome: {
      ok: true,
      status: "no_work",
      claimedCount: 0,
      confirmedCount: 0,
      failureRecordedCount: 0,
      needsReviewCount: 0,
    },
  });

  const body = await expectResponse(
    await h.handler(makeRequest()),
    200,
  );

  assert.equal(body.status, "no_work");
  assert.equal(body.confirmedCount, 0);
  assert.deepEqual(h.calls, [ID]);
});

test("ambiguous execution is never retried", async () => {
  const h = harness({ runThrows: true });

  await expectResponse(
    await h.handler(makeRequest()),
    503,
    "OPENAI_COST_EXECUTION_UNCONFIRMED",
  );

  assert.deepEqual(h.calls, [ID]);
});