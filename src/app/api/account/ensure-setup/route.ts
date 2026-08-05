import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { resolveAccessForRequest } from "@/lib/server/account-access-resolver";
import { handleEnsureSetup } from "./route-handler";

export async function POST() {
  return handleEnsureSetup({
    createSupabase: createSupabaseServerClient,
    resolveAccess: resolveAccessForRequest,
  });
}
