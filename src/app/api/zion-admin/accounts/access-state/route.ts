import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import { createServiceSupabaseClient } from "@/lib/server/zion-account-provisioning";
import { writeZionAdminAuditEvent } from "@/lib/server/zion-admin-audit";
import { handleAccessStateMutation } from "./route-handler";

export async function POST(request: Request) {
  return handleAccessStateMutation(request, {
    resolveAccess: resolveZionAdminApiAccess,
    createServiceSupabase: createServiceSupabaseClient,
    writeAuditEvent: writeZionAdminAuditEvent,
  });
}
