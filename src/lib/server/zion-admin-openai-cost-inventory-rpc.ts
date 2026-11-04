import { createClient } from "@supabase/supabase-js";

export const OPENAI_COST_INVENTORY_READ_RPC =
  "zion_admin_read_openai_cost_operations_by_identity_by_system";

export type OpenAiCostInventoryRpcResponse = {
  data: unknown;
  error: unknown;
};

export type OpenAiCostInventoryRpcCall = (
  name: typeof OPENAI_COST_INVENTORY_READ_RPC,
  parameters: { p_query_identity: string },
) => Promise<OpenAiCostInventoryRpcResponse>;

export type OpenAiCostInventoryRpcDependencies = {
  rpc?: OpenAiCostInventoryRpcCall;
};

function validIdentity(value: unknown): value is string {
  const prefix = "openai_organization_costs:v1:";

  return typeof value === "string" &&
    value.startsWith(prefix) &&
    value.length > prefix.length &&
    value.length <= 4096 &&
    value.trim() === value;
}

/**
 * Restricted read-only financial inventory transport.
 *
 * Reads through a SECURITY DEFINER RPC, without
 * granting direct SELECT access to service_role.
 *
 * Does not prepare, claim, collect or write costs.
 * Callers validate the returned financial rows.
 */
export async function readOpenAiCostInventoryViaRpc(
  queryIdentity: string,
  dependencies: OpenAiCostInventoryRpcDependencies = {},
): Promise<OpenAiCostInventoryRpcResponse> {
  if (!validIdentity(queryIdentity)) {
    throw new Error(
      "OPENAI_COST_INVENTORY_IDENTITY_INVALID",
    );
  }

  let rpc = dependencies.rpc;

  if (!rpc) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error(
        "OPENAI_COST_INVENTORY_RPC_CONFIG_MISSING",
      );
    }

    const client = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    rpc = async (name, parameters) => {
      const response = await client.rpc(name, parameters);

      return {
        data: response.data,
        error: response.error,
      };
    };
  }

  return rpc(OPENAI_COST_INVENTORY_READ_RPC, {
    p_query_identity: queryIdentity,
  });
}