import assert from "node:assert/strict";
import test from "node:test";

import { POST, dynamic, runtime } from "./route";

const URL =
  "https://zion.example/api/zion-admin/costs/openai-manual-run";

const ID = "11111111-1111-4111-8111-111111111111";

const FLAG =
  "ZION_ADMIN_OPENAI_COST_MANUAL_TARGETED_ENABLED";

function request(
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

async function withFlag(
  value: string,
  fn: () => Promise<void>,
) {
  const previous = process.env[FLAG];
  process.env[FLAG] = value;

  try {
    await fn();
  } finally {
    if (previous === undefined) {
      delete process.env[FLAG];
    } else {
      process.env[FLAG] = previous;
    }
  }
}

test("route uses Node.js and is dynamic", () => {
  assert.equal(runtime, "nodejs");
  assert.equal(dynamic, "force-dynamic");
  assert.equal(typeof POST, "function");
});

test("real route is disabled when flag is false", async () => {
  await withFlag("false", async () => {
    const response = await POST(
      request({
        operationId: ID,
        confirmation: `EXECUTAR_COLETA_OPENAI:${ID}`,
      }),
    );

    assert.equal(response.status, 503);
    assert.equal(
      (await response.json()).code,
      "OPENAI_COST_MANUAL_TARGETED_DISABLED",
    );
  });
});

test("real route rejects different Origin", async () => {
  await withFlag("true", async () => {
    const response = await POST(
      request(
        { operationId: ID, confirmation: "INVALID" },
        "https://external.example",
      ),
    );

    assert.equal(response.status, 403);
    assert.equal(
      (await response.json()).code,
      "OPENAI_COST_MANUAL_TARGETED_ORIGIN_DENIED",
    );
  });
});

test("real route rejects invalid confirmation", async () => {
  await withFlag("true", async () => {
    const response = await POST(
      request({
        operationId: ID,
        confirmation: "INVALID",
      }),
    );

    assert.equal(response.status, 400);
    assert.equal(
      (await response.json()).code,
      "OPENAI_COST_MANUAL_TARGETED_TARGET_INVALID",
    );
  });
});

test("real route rejects invalid operation ID", async () => {
  await withFlag("true", async () => {
    const response = await POST(
      request({
        operationId: "invalid",
        confirmation: "EXECUTAR_COLETA_OPENAI:invalid",
      }),
    );

    assert.equal(response.status, 400);
    assert.equal(
      (await response.json()).code,
      "OPENAI_COST_MANUAL_TARGETED_TARGET_INVALID",
    );
  });
});

test("real route rejects additional fields", async () => {
  await withFlag("true", async () => {
    const response = await POST(
      request({
        operationId: ID,
        confirmation: `EXECUTAR_COLETA_OPENAI:${ID}`,
        extra: true,
      }),
    );

    assert.equal(response.status, 400);
    assert.equal(
      (await response.json()).code,
      "OPENAI_COST_MANUAL_TARGETED_TARGET_INVALID",
    );
  });
});