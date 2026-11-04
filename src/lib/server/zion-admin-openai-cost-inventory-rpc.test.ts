import assert from "node:assert/strict";
import test from "node:test";

import {
  OPENAI_COST_INVENTORY_READ_RPC,
  readOpenAiCostInventoryViaRpc,
} from "./zion-admin-openai-cost-inventory-rpc";

const IDENTITY =
  "openai_organization_costs:v1:fixture";

test("uses the restricted RPC with exact parameters", async () => {
  let calls = 0;

  const response = await readOpenAiCostInventoryViaRpc(
    IDENTITY,
    {
      rpc: async (name, parameters) => {
        calls++;

        assert.equal(
          name,
          OPENAI_COST_INVENTORY_READ_RPC,
        );

        assert.deepEqual(parameters, {
          p_query_identity: IDENTITY,
        });

        return { data: [], error: null };
      },
    },
  );

  assert.equal(calls, 1);
  assert.deepEqual(response.data, []);
  assert.equal(response.error, null);
});

test("preserves financial rows unchanged", async () => {
  const rows = [{
    id: "11111111-1111-4111-8111-111111111111",
    state: "retryable_failed",
    claim_token: null,
  }];

  const response = await readOpenAiCostInventoryViaRpc(
    IDENTITY,
    {
      rpc: async () => ({
        data: rows,
        error: null,
      }),
    },
  );

  assert.deepEqual(response.data, rows);
});

test("does not disguise permission errors as absence", async () => {
  const error = {
    code: "42501",
    message: "permission denied",
  };

  const response = await readOpenAiCostInventoryViaRpc(
    IDENTITY,
    {
      rpc: async () => ({
        data: null,
        error,
      }),
    },
  );

  assert.equal(response.error, error);
});

test("rejects invalid identities before calling RPC", async () => {
  let calls = 0;

  for (const identity of [
    "",
    "invalid",
    "openai_organization_costs:v1:",
    "openai_organization_costs:v1:test ",
  ]) {
    await assert.rejects(
      readOpenAiCostInventoryViaRpc(
        identity,
        {
          rpc: async () => {
            calls++;
            return { data: [], error: null };
          },
        },
      ),
    );
  }

  assert.equal(calls, 0);
});

test("transport uncertainty remains an error", async () => {
  await assert.rejects(
    readOpenAiCostInventoryViaRpc(
      IDENTITY,
      {
        rpc: async () => {
          throw new Error("RPC_UNAVAILABLE");
        },
      },
    ),
    /RPC_UNAVAILABLE/,
  );
});