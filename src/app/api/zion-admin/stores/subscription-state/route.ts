import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import { createServiceSupabaseClient } from "@/lib/server/zion-account-provisioning";
import { handleStoreSubscriptionStateMutation } from "./route-handler";

export async function POST(request: Request) {
  return handleStoreSubscriptionStateMutation(request, {
    resolveAccess: resolveZionAdminApiAccess,
    createServiceSupabase: createServiceSupabaseClient,
  });
}
