import { createZionAdminApiDeniedResponse, createZionAdminApiJsonResponse } from "@/lib/server/zion-admin-api-response";
import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import { createServiceSupabaseClient } from "@/lib/server/zion-account-provisioning";
import { buildOfficialOpenAiCostReport, OfficialCostReportError } from "@/lib/server/zion-admin-openai-official-cost-report";
import type { OfficialCostClient, OfficialCostReport } from "@/lib/server/zion-admin-openai-official-cost-report";
import { convertOfficialUsdToBrl, loadDailyPtaxRates } from "@/lib/server/zion-admin-ptax-daily";
import type { DailyPtaxReport } from "@/lib/server/zion-admin-ptax-daily";

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
  loadPtax?: (from: string, to: string) => Promise<DailyPtaxReport>;
};

async function attachDailyPtax(
  report: OfficialCostReport,
  from: string,
  to: string,
  loadPtax: (from: string, to: string) => Promise<DailyPtaxReport>,
) {
  const requiresQuotation = report.daily.some(
    (day) => day.status === "available",
  );

  let rates: DailyPtaxReport | null = null;

  if (requiresQuotation) {
    try {
      const loaded = await loadPtax(from, to);
      if (
        loaded.source !== "bcb_ptax_venda" ||
        !Array.isArray(loaded.daily)
      ) {
        throw new Error("INVALID_PTAX_RESPONSE");
      }
      rates = loaded;
    } catch {
      // A indisponibilidade do BCB nao invalida os custos em USD.
      rates = null;
    }
  }

  const quotations = new Map(
    (rates?.daily ?? []).map((rate) => [rate.date, rate]),
  );

  const daily = report.daily.map((day) => {
    const base = {
      ...day,
      ptaxRate: null as string | null,
      ptaxQuotationDate: null as string | null,
      ptaxStatus: "not_applicable",
      estimatedBrl: null as string | null,
    };

    if (day.status === "confirmed_empty") {
      return { ...base, estimatedBrl: "0.00" };
    }

    if (day.status !== "available" || day.totalUsd === null) {
      return base;
    }

    const quote = quotations.get(day.date);

    if (!quote?.rate || !quote.quotationDate ||
        quote.status === "unavailable") {
      return { ...base, ptaxStatus: "unavailable" };
    }

    try {
      return {
        ...base,
        ptaxRate: quote.rate,
        ptaxQuotationDate: quote.quotationDate,
        ptaxStatus: quote.status,
        estimatedBrl: convertOfficialUsdToBrl(
          day.totalUsd,
          quote.rate,
        ),
      };
    } catch {
      return { ...base, ptaxStatus: "unavailable" };
    }
  });

  const quotationMissing = daily.some(
    (day) => day.status === "available" &&
      day.estimatedBrl === null,
  );

  const canTotal =
    report.availability === "complete" && !quotationMissing;

  let totalBrlEstimated: string | null = null;

  if (canTotal) {
    const cents = daily.reduce((sum, day) => {
      if (day.estimatedBrl === null) return sum;
      return sum + BigInt(day.estimatedBrl.replace(".", ""));
    }, BigInt(0));

    totalBrlEstimated =
      `${cents / BigInt(100)}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
  }

  return {
    ...report,
    daily,
    fx: {
      source: "bcb_ptax_venda",
      availability: quotationMissing
        ? "unavailable"
        : report.availability,
      totalBrlEstimated,
      note: "BRL estimado pela PTAX venda do BCB, com arredondamento diario para centavos. Nao representa o valor cobrado pelo cartao.",
    },
  };
}

export function createOpenAiOfficialCostsGetHandler(deps: OpenAiOfficialCostsHandlerDeps = {}) {
  const resolveAccess = deps.resolveAccess ?? (() => resolveZionAdminApiAccess({ requiredCapability: "manage_accounts" }));
  const createServiceClient = deps.createServiceClient ?? createServiceSupabaseClient;
  const buildReport = deps.buildReport ?? buildOfficialOpenAiCostReport;
  const loadPtax = deps.loadPtax ?? loadDailyPtaxRates;

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
    const withFx = await attachDailyPtax(report, from, to, loadPtax);
    return createZionAdminApiJsonResponse({ ok: true, ...withFx }, 200);
  } catch (error) {
    const code = error instanceof OfficialCostReportError ? error.code : "SOURCE_UNAVAILABLE";
    return createZionAdminApiJsonResponse({ ok: false, error: code, message: "A fonte oficial de custos nao esta disponivel com confiabilidade suficiente." }, 503);
  }
  };
}

export const GET = createOpenAiOfficialCostsGetHandler();
