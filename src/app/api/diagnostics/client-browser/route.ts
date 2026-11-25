import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { resolveAccessForRequest } from "@/lib/server/account-access-resolver";
import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import { createBrowserDiagnosticReceiver } from "@/lib/server/client-browser-diagnostic-receiver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Deliberately not wrapped by backend diagnostics: avoid reporting the reporter.
export async function POST(request: Request) {
  return createBrowserDiagnosticReceiver({
    enabled: process.env.ZION_ADMIN_DIAGNOSTIC_CLIENT_ENABLED === "true",
    async authorize(domain) {
      if (domain === "zion_admin") {
        const access = await resolveZionAdminApiAccess({requiredCapability:"manage_accounts"});
        return access.ok ? {userId:access.sessionUserId,scope:"system",organizationId:null,storeId:null} : null;
      }
      const supabase = await createSupabaseServerClient();
      const access = await resolveAccessForRequest({requestedDomain:"store_area",supabase});
      if (access.domain !== "store_area" || access.apiDecision !== "allow" || !access.sessionUserId || !access.organizationId || !access.storeId) return null;
      return {userId:access.sessionUserId,scope:"store",organizationId:access.organizationId,storeId:access.storeId};
    },
    async persist(args) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) return false;
      const supabase = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      // Future writer must enforce a durable rate limit and revalidate scope.
      const {data,error} = await supabase.rpc("register_zion_admin_client_browser_failure_by_system",args).abortSignal(AbortSignal.timeout(2000));
      return error === null && (data?.status === "registered" || data?.status === "rate_limited");
    }
  })(request);
}
