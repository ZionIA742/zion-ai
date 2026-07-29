import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  createServiceSupabaseClient,
  getAuthAdminUserByIdWithRetry,
  getInvalidFirstAccessAttemptMessage,
  readFirstAccessInviteId,
  resolveTrustedPasswordFlow,
} from "@/lib/server/zion-account-provisioning";
import { handleAuthCallback } from "./callback-handler";

export async function GET(request: Request) {
  return handleAuthCallback(request, {
    createSupabaseClient: createSupabaseServerClient,
    createServiceClient: createServiceSupabaseClient,
    getAuthAdminUserByIdWithRetry,
    getInvalidFirstAccessAttemptMessage,
    readFirstAccessInviteId,
    resolveTrustedPasswordFlow,
  });
}
