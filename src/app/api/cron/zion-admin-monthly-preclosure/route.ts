import { NextResponse } from "next/server";

import {
  authorizeOpenAiCostCron,
} from "@/lib/server/zion-admin-openai-cost-cron-auth";

import {
  runMonthlyPreclosureBySystem,
} from "@/lib/server/zion-admin-monthly-preclosure-execution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type MonthlyPreclosureCronDependencies = {
  authorizeCron: typeof authorizeOpenAiCostCron;
  runExecution: typeof runMonthlyPreclosureBySystem;
  isAutoExecutionEnabled: () => boolean;
};

function json(
  body: Record<string, unknown>,
  status: number,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * ZION-ADM / 8-E.6
 *
 * Endpoint financeiro protegido.
 * Reutiliza a autenticacao existente do cron OpenAI.
 *
 * A autorizacao ocorre antes da verificacao da flag,
 * da leitura de fontes e da escrita do pre-fechamento.
 *
 * A flag e independente e permanece OFF por padrao.
 * Nao cria cron, nao coleta fornecedores e nao
 * efetua fechamento definitivo.
 */
export function createMonthlyPreclosureCronGetHandler(
  dependencies: Partial<MonthlyPreclosureCronDependencies> = {},
) {
  const authorizeCron =
    dependencies.authorizeCron ?? authorizeOpenAiCostCron;

  const runExecution =
    dependencies.runExecution ?? runMonthlyPreclosureBySystem;

  const isAutoExecutionEnabled =
    dependencies.isAutoExecutionEnabled ??
    (() =>
      process.env
        .ZION_ADMIN_MONTHLY_PRECLOSURE_AUTO_EXECUTION_ENABLED ===
      "true");

  return async function GET(request: Request): Promise<NextResponse> {
    if (request.method !== "GET") {
      return NextResponse.json(
        { ok: false, error: "METHOD_NOT_ALLOWED" },
        {
          status: 405,
          headers: {
            Allow: "GET",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }

    // Autenticar primeiro. Nao revelar configuracoes
    // financeiras a requisicoes nao autorizadas.
    try {
      const access = await authorizeCron(request);

      if (
        !access ||
        typeof access !== "object" ||
        !("ok" in access) ||
        access.ok !== true ||
        !("status" in access) ||
        access.status !== "authorized"
      ) {
        return json(
          { ok: false, error: "UNAUTHORIZED_CRON_ROUTE" },
          401,
        );
      }
    } catch {
      return json(
        { ok: false, error: "UNAUTHORIZED_CRON_ROUTE" },
        401,
      );
    }

    let enabled: boolean;

    try {
      enabled = isAutoExecutionEnabled();
    } catch {
      return json(
        { ok: false, error: "FINANCIAL_CRON_UNAVAILABLE" },
        503,
      );
    }

    if (enabled !== true && enabled !== false) {
      return json(
        { ok: false, error: "FINANCIAL_CRON_UNAVAILABLE" },
        503,
      );
    }

    if (!enabled) {
      return json(
        { ok: true, status: "disabled" },
        200,
      );
    }

    try {
      // O executor valida horario e competencia.
      // O writer SQL aplica a mesma restricao no banco.
      // Nenhum parametro externo pode escolher o mes.
      const result = await runExecution();

      if (!result || typeof result !== "object") {
        return json(
          { ok: false, error: "FINANCIAL_CRON_UNAVAILABLE" },
          503,
        );
      }

      if (
        result.status === "created" ||
        result.status === "revised" ||
        result.status === "unchanged"
      ) {
        return json(
          { ok: true, status: result.status },
          200,
        );
      }

      if (
        result.status === "skipped" &&
        result.reason === "not_due"
      ) {
        return json(
          { ok: true, status: "skipped" },
          200,
        );
      }

      if (result.status === "needs_review") {
        // Sem confirmar sucesso financeiro e sem
        // incentivar repeticoes cegas da chamada.
        return json(
          { ok: false, status: "needs_review" },
          200,
        );
      }

      return json(
        { ok: false, error: "FINANCIAL_CRON_UNAVAILABLE" },
        503,
      );
    } catch {
      return json(
        { ok: false, error: "FINANCIAL_CRON_UNAVAILABLE" },
        503,
      );
    }
  };
}

export const GET = createMonthlyPreclosureCronGetHandler();