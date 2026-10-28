import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectOpenAiCostInventory,
} from "./zion-admin-openai-cost-inventory-reader";

const IDENTITY =
  "openai_organization_costs:v1:start_time=1&end_time=2&bucket_width=1d";

const ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  operation_key: "daily_utc_test",
  provider: "openai",
  source: "openai_organization_costs",
  query_identity: IDENTITY,
  state: "confirmed",
};

function load(data: unknown, error: unknown = null) {
  return async () => ({ data, error });
}

test("returns absent when the verified query is empty", async () => {
  const result = await inspectOpenAiCostInventory(
    IDENTITY,
    { load: load([]) },
  );

  assert.deepEqual(result, { status: "absent" });
});

test("recognizes an existing confirmed operation", async () => {
  const result = await inspectOpenAiCostInventory(
    IDENTITY,
    { load: load([ROW]) },
  );

  assert.equal(result.status, "existing");
  if (result.status !== "existing") return;

  assert.equal(result.operationKey, ROW.operation_key);
  assert.equal(result.state, "confirmed");
});

test("recognizes uncertain operations without retrying", async () => {
  const result = await inspectOpenAiCostInventory(
    IDENTITY,
    { load: load([{ ...ROW, state: "uncertain" }]) },
  );

  assert.equal(result.status, "existing");
  if (result.status !== "existing") return;

  assert.equal(result.state, "uncertain");
});

test("blocks multiple operations for one identity", async () => {
  const result = await inspectOpenAiCostInventory(
    IDENTITY,
    { load: load([ROW, { ...ROW, operation_key: "other" }]) },
  );

  assert.deepEqual(result, {
    status: "blocked",
    reason: "multiple_operations",
  });
});

test("blocks database errors", async () => {
  const result = await inspectOpenAiCostInventory(
    IDENTITY,
    { load: load(null, { message: "unavailable" }) },
  );

  assert.deepEqual(result, {
    status: "blocked",
    reason: "source_unavailable",
  });
});

test("blocks thrown transport failures", async () => {
  const result = await inspectOpenAiCostInventory(
    IDENTITY,
    {
      load: async () => {
        throw new Error("network");
      },
    },
  );

  assert.equal(result.status, "blocked");
});

test("blocks rows with mismatched financial identity", async () => {
  const result = await inspectOpenAiCostInventory(
    IDENTITY,
    {
      load: load([{
        ...ROW,
        query_identity: "other",
      }]),
    },
  );

  assert.deepEqual(result, {
    status: "blocked",
    reason: "invalid_response",
  });
});

test("blocks unsupported operation states", async () => {
  const result = await inspectOpenAiCostInventory(
    IDENTITY,
    { load: load([{ ...ROW, state: "unknown" }]) },
  );

  assert.equal(result.status, "blocked");
});

test("rejects an invalid identity without querying", async () => {
  let called = false;

  const result = await inspectOpenAiCostInventory(
    "invalid",
    {
      load: async () => {
        called = true;
        return { data: [], error: null };
      },
    },
  );

  assert.deepEqual(result, {
    status: "blocked",
    reason: "invalid_identity",
  });

  assert.equal(called, false);
});
