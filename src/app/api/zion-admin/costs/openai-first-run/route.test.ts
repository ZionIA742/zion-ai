import assert from "node:assert/strict";
import test from "node:test";

import {
  POST,
  dynamic,
  runtime,
} from "./route";

import {
  FIRST_OPENAI_COST_CONFIRMATION,
  FIRST_OPENAI_COST_OPERATION_ID,
} from "@/lib/server/zion-admin-openai-cost-first-collection-handler";

const URL =
  "https://zion.example/api/zion-admin/costs/openai-first-run";

function makeRequest(
  body: unknown,
  origin = "https://zion.example",
): Request {
  return new Request(URL, {
    method: "POST",
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function validBody() {
  return {
    operationId: FIRST_OPENAI_COST_OPERATION_ID,
    confirmation: FIRST_OPENAI_COST_CONFIRMATION,
  };
}

async function withFlag(
  value: string,
  check: () => Promise<void>,
) {
  const key =
    "ZION_ADMIN_OPENAI_COST_MANUAL_FIRST_RUN_ENABLED";
  const previous = process.env[key];

  process.env[key] = value;

  try {
    await check();
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
}

test("route uses Node.js and remains dynamic", () => {
  assert.equal(runtime, "nodejs");
  assert.equal(dynamic, "force-dynamic");
  assert.equal(typeof POST, "function");
});

test("real route remains disabled by default", async () => {
  await withFlag("false", async () => {
    const response = await POST(
      makeRequest(validBody()),
    );

    assert.equal(response.status, 503);
    assert.equal(
      response.headers.get("cache-control"),
      "no-store",
    );

    const result = await response.json();
    assert.equal(
      result.code,
      "OPENAI_COST_FIRST_RUN_DISABLED",
    );
  });
});

test("real route rejects a different operation", async () => {
  await withFlag("true", async () => {
    const response = await POST(
      makeRequest({
        ...validBody(),
        operationId:
          "11111111-1111-4111-8111-111111111111",
      }),
    );

    assert.equal(response.status, 400);

    const result = await response.json();
    assert.equal(
      result.code,
      "OPENAI_COST_FIRST_RUN_TARGET_INVALID",
    );
  });
});

test("real route rejects foreign Origin", async () => {
  await withFlag("true", async () => {
    const response = await POST(
      makeRequest(
        validBody(),
        "https://external.example",
      ),
    );

    assert.equal(response.status, 403);

    const result = await response.json();
    assert.equal(
      result.code,
      "OPENAI_COST_FIRST_RUN_ORIGIN_DENIED",
    );
  });
});

test("real route rejects invalid confirmation", async () => {
  await withFlag("true", async () => {
    const response = await POST(
      makeRequest({
        ...validBody(),
        confirmation: "INVALID",
      }),
    );

    assert.equal(response.status, 400);

    const result = await response.json();
    assert.equal(
      result.code,
      "OPENAI_COST_FIRST_RUN_TARGET_INVALID",
    );
  });
});

const disabledFinancialFlagCases = [
  { feature: "false", execution: "false" },
  { feature: "false", execution: "true" },
  { feature: "true", execution: "false" },
] as const;

for (const flags of disabledFinancialFlagCases) {
  test(
    `valid manual request cannot bypass financial flags ${flags.feature}/${flags.execution}`,
    async () => {
      const featureKey =
        "ZION_ADMIN_OPENAI_COST_COLLECTION_ENABLED";
      const executionKey =
        "ZION_ADMIN_OPENAI_COST_EXECUTION_ENABLED";

      const previousFeature = process.env[featureKey];
      const previousExecution = process.env[executionKey];

      try {
        process.env[featureKey] = flags.feature;
        process.env[executionKey] = flags.execution;

        await withFlag("true", async () => {
          const response = await POST(
            makeRequest(validBody()),
          );

          assert.equal(response.status, 503);
          assert.equal(
            response.headers.get("cache-control"),
            "no-store",
          );

          const result = await response.json();

          assert.equal(result.ok, false);
          assert.equal(result.status, "disabled");
          assert.equal(
            result.code,
            "OPENAI_COST_EXECUTION_DISABLED",
          );
          assert.equal(
            result.operationId,
            FIRST_OPENAI_COST_OPERATION_ID,
          );
        });
      } finally {
        if (previousFeature === undefined) {
          delete process.env[featureKey];
        } else {
          process.env[featureKey] = previousFeature;
        }

        if (previousExecution === undefined) {
          delete process.env[executionKey];
        } else {
          process.env[executionKey] = previousExecution;
        }
      }
    },
  );
}
