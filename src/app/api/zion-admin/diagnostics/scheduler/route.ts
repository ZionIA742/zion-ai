import { createClient } from '@supabase/supabase-js';
import { resolveZionAdminApiAccess } from '@/lib/server/zion-admin-api-access';
import { createZionAdminApiDeniedResponse, createZionAdminApiJsonResponse } from '@/lib/server/zion-admin-api-response';
import { projectSchedulerFailures } from '@/lib/diagnostics/scheduler-failure-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A diagnostic reader is deliberately not wrapped by the diagnostic collector.
export async function GET(request: Request) {
  const unavailable = () => createZionAdminApiJsonResponse({ok:false,message:'Histórico de agendamentos temporariamente indisponível.'},503);
  try {
    const access = await resolveZionAdminApiAccess({requiredCapability:'manage_accounts'});
    if (!access.ok) return createZionAdminApiDeniedResponse(access);
    if (process.env.ZION_ADMIN_DIAGNOSTIC_UNIFIED_READER_ENABLED !== 'true') return createZionAdminApiJsonResponse({ok:false,message:'Consulta desativada.'},404);
    const params = new URL(request.url).searchParams;
    const raw = params.get('limit') ?? '30';
    const limit = Number(raw);
    if ([...params.keys()].some(k => k !== 'limit') || params.getAll('limit').length > 1 || !/^[1-9][0-9]?$/.test(raw) || limit > 50) return createZionAdminApiJsonResponse({ok:false,message:'Filtro inválido.'},400);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return unavailable();
    const client = createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}});
    const {data,error} = await client.rpc('list_zion_admin_scheduler_failures_by_system',{p_limit:limit}).abortSignal(AbortSignal.timeout(5000));
    if (error) return unavailable();
    const items = projectSchedulerFailures(data,limit);
    if (items === null) return unavailable();
    return createZionAdminApiJsonResponse({ok:true,source:'pg_cron',window_days:7,limit,items},200);
  } catch { return unavailable(); }
}
