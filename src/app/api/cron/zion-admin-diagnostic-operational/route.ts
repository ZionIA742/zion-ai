import { authorizeOpenAiCostCron } from "../../../../lib/server/zion-admin-openai-cost-cron-auth";
import {
  runDiagnosticOperationalCaptureCron,
  DIAGNOSTIC_OPERATIONAL_BATCH_LIMIT,
} from "../../../../lib/server/zion-admin-diagnostic-operational-cron-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type DiagnosticOperationalCronRouteDependencies = {
  getSecret?: () => string | undefined;
  isAutoEnabled?: () => boolean;
  runCapture?: typeof runDiagnosticOperationalCaptureCron;
  authorizeCron?: typeof authorizeOpenAiCostCron;
};

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(status === 405 ? { Allow: "GET" } : {}),
    },
  });
}

/**
 * Cron exclusivo da captura operacional do ZION-ADM.
 *
 * - Somente GET autenticado por segredo dedicado.
 * - Desativado por padrao.
 * - Nunca ativa a captura no banco.
 * - Nao aceita parametros externos para alterar o lote.
 * - Nao interfere no cron de ai_runs.
 * - Nao retorna mensagens internas do Supabase.
 */
export function createDiagnosticOperationalCronGetHandler(
  dependencies: DiagnosticOperationalCronRouteDependencies = {},
) {
  const authorizeCron =
    dependencies.authorizeCron ?? authorizeOpenAiCostCron;

  const getSecret =
    dependencies.getSecret ??
    (() => process.env.ZION_ADMIN_DIAGNOSTIC_OPERATIONAL_CRON_SECRET);

  const isAutoEnabled =
    dependencies.isAutoEnabled ??
    (() =>
      process.env.ZION_ADMIN_DIAGNOSTIC_OPERATIONAL_CRON_ENABLED ===
      "true");

  const runCapture =
    dependencies.runCapture ?? runDiagnosticOperationalCaptureCron;

  return async function GET(request: Request): Promise<Response> {
    if (!request || request.method !== "GET") {
      return json(
        { ok: false, error: "METHOD_NOT_ALLOWED" },
        405,
      );
    }

    try {
      const access = await authorizeCron(request, {
        isEnabled: () => true,
        getSecret: () => getSecret() ?? "",
      });

      if (
        !access ||
        access.ok !== true ||
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
      enabled = isAutoEnabled();

      if (typeof enabled !== "boolean") {
        throw new Error("INVALID_CRON_CONFIGURATION");
      }
    } catch {
      return json(
        { ok: false, error: "DIAGNOSTIC_CRON_UNAVAILABLE" },
        503,
      );
    }

    if (!enabled) {
      return json({ ok: true, status: "disabled" }, 200);
    }

    try {
      const result = await runCapture({
        batchLimit: DIAGNOSTIC_OPERATIONAL_BATCH_LIMIT,
      });

      if (
        !result ||
        (result.status !== "inactive" &&
          result.status !== "processed") ||
        result.batchLimit !== DIAGNOSTIC_OPERATIONAL_BATCH_LIMIT
      ) {
        return json(
          { ok: false, error: "DIAGNOSTIC_CRON_UNAVAILABLE" },
          503,
        );
      }

      return json({ ok: true, ...result }, 200);
    } catch {
      return json(
        { ok: false, error: "DIAGNOSTIC_CRON_UNAVAILABLE" },
        503,
      );
    }
  };
}

export const GET = createDiagnosticOperationalCronGetHandler();