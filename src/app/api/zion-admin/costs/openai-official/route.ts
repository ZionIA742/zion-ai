import { createZionAdminApiDeniedResponse, createZionAdminApiJsonResponse } from "@/lib/server/zion-admin-api-response";
import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import { createServiceSupabaseClient } from "@/lib/server/zion-account-provisioning";
import { buildOfficialOpenAiCostReport, OfficialCostReportError } from "@/lib/server/zion-admin-openai-official-cost-report";
import type { OfficialCostClient, OfficialCostReport } from "@/lib/server/zion-admin-openai-official-cost-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

type Access = Awaited<ReturnType<typeof resolveZionAdminApiAccess>>;

export type OpenAiOfficialCostsHandlerDeps = {
  resolveAccess?: () => Promise<Access>;
  createServiceClient?: () => OfficialCostClient;
  buildReport?: (client: OfficialCostClient, from: string, to: string) => Promise<OfficialCostReport>;
};

export function createOpenAiOfficialCostsGetHandler(deps: OpenAiOfficialCostsHandlerDeps = {}) {
  const resolveAccess = deps.resolveAccess ?? (() => resolveZionAdminApiAccess({ requiredCapability: "manage_accounts" }));
  const createServiceClient = deps.createServiceClient ?? createServiceSupabaseClient;
  const buildReport = deps.buildReport ?? buildOfficialOpenAiCostReport;

  return async function GET(request: Request) {
  const access = await resolveAccess();
  if (!access.ok) return createZionAdminApiDeniedResponse(access);
  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if (!validDate(from) || !validDate(to)) {
    return createZionAdminApiJsonResponse({ ok: false, error: "INVALID_PERIOD", message: "Informe from e to como datas UTC YYYY-MM-DD." }, 400);
  }
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  const days = Math.round((toMs - fromMs) / 86400000) + 1;
  if (toMs < fromMs || days > 366) {
    return createZionAdminApiJsonResponse({ ok: false, error: "INVALID_PERIOD", message: "O intervalo UTC deve ser crescente e ter no maximo 366 dias." }, 400);
  }
  try {
    const report = await buildReport(createServiceClient(), from, to);
    return createZionAdminApiJsonResponse({ ok: true, ...report }, 200);
  } catch (error) {
    const code = error instanceof OfficialCostReportError ? error.code : "SOURCE_UNAVAILABLE";
    return createZionAdminApiJsonResponse({ ok: false, error: code, message: "A fonte oficial de custos nao esta disponivel com confiabilidade suficiente." }, 503);
  }
  };
}

export const GET = createOpenAiOfficialCostsGetHandler();
