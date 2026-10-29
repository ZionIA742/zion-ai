import test from "node:test";
import assert from "node:assert/strict";

import {
  authorizeDailyOpenAiCostExecution,
} from "./zion-admin-openai-cost-daily-execution-auth";

import type {
  DailyOpenAiCostExecutionFlags,
} from "./zion-admin-openai-cost-daily-execution-auth";

const SECRET = "test-only-financial-cron-secret-0123456789-abcdef";

const ENABLED_FLAGS: DailyOpenAiCostExecutionFlags = {
  collectionEnabled: true,
  preparationEnabled: true,
  executionEnabled: true,
  autoExecutionEnabled: true,
};

function request(
  bearer = SECRET,
  method = "GET",
  url = "https://example.test/api/cron/zion-admin-openai-costs",
): Request {
  return new Request(url, {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
    },
  });
}

function authorize(
  input: Request = request(),
  options: {
    cronEnabled?: boolean;
    cronSecret?: string;
    flags?: DailyOpenAiCostExecutionFlags;
    readFlags?: () => DailyOpenAiCostExecutionFlags;
  } = {},
) {
  return authorizeDailyOpenAiCostExecution(input, {
    cronAuthOptions: {
      isEnabled: () => options.cronEnabled ?? true,
      getSecret: () => options.cronSecret ?? SECRET,
    },
    readFlags: options.readFlags ??
      (() => options.flags ?? ENABLED_FLAGS),
  });
}

test("allows valid cron with all execution flags enabled", () => {
  assert.deepEqual(authorize(), {
    ok: true,
    status: "authorized",
  });
});

test("rejects disabled cron", () => {
  const result = authorize(request(), { cronEnabled: false });

  assert.equal(result.ok, false);
});

test("rejects incorrect bearer secret", () => {
  const result = authorize(request("incorrect-secret"));

  assert.equal(result.ok, false);
});

test("rejects missing bearer header", () => {
  const result = authorizeDailyOpenAiCostExecution(
    new Request(
      "https://example.test/api/cron/zion-admin-openai-costs",
    ),
    {
      cronAuthOptions: {
        isEnabled: () => true,
        getSecret: () => SECRET,
      },
      readFlags: () => ENABLED_FLAGS,
    },
  );

  assert.equal(result.ok, false);
});

test("rejects insufficient cron secret", () => {
  const result = authorize(request(), {
    cronSecret: "short",
  });

  assert.equal(result.ok, false);
});

test("rejects POST even with valid bearer", () => {
  const result = authorize(request(SECRET, "POST"));

  assert.equal(result.ok, false);
});

test("rejects query string even with valid bearer", () => {
  const result = authorize(
    request(
      SECRET,
      "GET",
      "https://example.test/api/cron/zion-admin-openai-costs?run=1",
    ),
  );

  assert.equal(result.ok, false);
});

test("collection flag disabled blocks automatic execution", () => {
  const result = authorize(request(), {
    flags: {
      ...ENABLED_FLAGS,
      collectionEnabled: false,
    },
  });

  assert.equal(result.ok, false);
});

test("preparation flag disabled blocks automatic execution", () => {
  const result = authorize(request(), {
    flags: {
      ...ENABLED_FLAGS,
      preparationEnabled: false,
    },
  });

  assert.equal(result.ok, false);
});

test("execution flag disabled blocks automatic execution", () => {
  const result = authorize(request(), {
    flags: {
      ...ENABLED_FLAGS,
      executionEnabled: false,
    },
  });

  assert.equal(result.ok, false);
});

test("auto execution flag disabled blocks automatic execution", () => {
  const result = authorize(request(), {
    flags: {
      ...ENABLED_FLAGS,
      autoExecutionEnabled: false,
    },
  });

  assert.equal(result.ok, false);
});

test("flag reader exception fails closed", () => {
  const result = authorize(request(), {
    readFlags: () => {
      throw new Error("FLAGS_UNAVAILABLE");
    },
  });

  assert.deepEqual(result, {
    ok: false,
    status: "blocked",
    reason: "financial_execution_disabled",
  });
});

test("cron denial does not read financial flags", () => {
  let reads = 0;

  const result = authorize(request("invalid"), {
    readFlags: () => {
      reads++;
      return ENABLED_FLAGS;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(reads, 0);
});

test("rejects nonboolean financial authorization", () => {
  const result = authorize(request(), {
    flags: {
      ...ENABLED_FLAGS,
      autoExecutionEnabled: "true" as unknown as boolean,
    },
  });

  assert.equal(result.ok, false);
});

test("rejects missing flags object", () => {
  const result = authorize(request(), {
    readFlags: () =>
      undefined as unknown as DailyOpenAiCostExecutionFlags,
  });

  assert.equal(result.ok, false);
});