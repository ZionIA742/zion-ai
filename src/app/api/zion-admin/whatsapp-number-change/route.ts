import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import { createServiceSupabaseClient } from "@/lib/server/zion-account-provisioning";
import { createWhatsappNumberChangeRouteHandler } from "./route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createWhatsappNumberChangeRouteHandler({
  resolveAccess: () => resolveZionAdminApiAccess({ requiredCapability: "manage_accounts" }),
  createServiceSupabase: () => createServiceSupabaseClient() as never,
});

export const POST = handler;
