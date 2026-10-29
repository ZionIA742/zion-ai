import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeOpenAiCostCron,
} from "./zion-admin-openai-cost-cron-auth";

const SECRET = "s".repeat(48);

function request(
  token = SECRET,
  method = "GET",
  url = "https://zionapi.com.br/api/cron/zion-admin-openai-costs",
) {
  return new Request(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
}

const enabled = {
  isEnabled: () => true,
  getSecret: () => SECRET,
};

test("authorizes an exact dedicated service token", () => {
  assert.deepEqual(
    authorizeOpenAiCostCron(request(), enabled),
    { ok: true, status: "authorized" },
  );
});

test("blocks when automation is disabled", () => {
  assert.deepEqual(
    authorizeOpenAiCostCron(request(), {
      ...enabled,
      isEnabled: () => false,
    }),
    { ok: false, status: "disabled" },
  );
});

test("rejects an incorrect bearer token", () => {
  assert.equal(
    authorizeOpenAiCostCron(request("wrong"), enabled).ok,
    false,
  );
});

test("rejects a missing authorization header", () => {
  const req = new Request(
    "https://zionapi.com.br/api/cron/zion-admin-openai-costs",
  );

  assert.equal(
    authorizeOpenAiCostCron(req, enabled).status,
    "unauthorized",
  );
});

test("rejects a missing service secret", () => {
  assert.equal(
    authorizeOpenAiCostCron(request(), {
      isEnabled: () => true,
      getSecret: () => undefined,
    }).status,
    "secret_unavailable",
  );
});

test("rejects a short secret", () => {
  assert.equal(
    authorizeOpenAiCostCron(request(), {
      isEnabled: () => true,
      getSecret: () => "short",
    }).status,
    "secret_unavailable",
  );
});

test("rejects non-GET requests", () => {
  assert.equal(
    authorizeOpenAiCostCron(
      request(SECRET, "POST"),
      enabled,
    ).status,
    "invalid_method",
  );
});

test("rejects query parameters", () => {
  assert.equal(
    authorizeOpenAiCostCron(
      request(
        SECRET,
        "GET",
        "https://zionapi.com.br/api/cron/zion-admin-openai-costs?date=2026-10-25",
      ),
      enabled,
    ).status,
    "invalid_request",
  );
});

test("does not accept a token with extra characters", () => {
  assert.equal(
    authorizeOpenAiCostCron(
      request(SECRET + "extra"),
      enabled,
    ).status,
    "unauthorized",
  );
});

test("fails closed if the secret provider throws", () => {
  assert.equal(
    authorizeOpenAiCostCron(request(), {
      isEnabled: () => true,
      getSecret: () => {
        throw new Error("unavailable");
      },
    }).status,
    "secret_unavailable",
  );
});
