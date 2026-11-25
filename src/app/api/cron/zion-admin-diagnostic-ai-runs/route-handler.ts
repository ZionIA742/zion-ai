import { authorizeOpenAiCostCron } from "../../../../lib/server/zion-admin-openai-cost-cron-auth";
import { runDiagnosticAiRunCaptureCron } from "../../../../lib/server/zion-admin-diagnostic-ai-run-cron-runner";

export type DiagnosticAiRunCronRouteDependencies = {
  getSecret?: () => string | undefined;
  isAutoEnabled?: () => boolean;
  runCapture?: typeof runDiagnosticAiRunCaptureCron;
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
 * Cron exclusivo do ZION-ADM.
 * Nao integra fluxos de WhatsApp ou IAs comerciais.
 * Nunca chama a funcao de ativacao da captura.
 * Sem query params ou controle externo de batch.
 */
export function createDiagnosticAiRunCronGetHandler(
  dependencies: DiagnosticAiRunCronRouteDependencies = {},
) {
  const authorizeCron =
    dependencies.authorizeCron ?? authorizeOpenAiCostCron;

  const getSecret =
    dependencies.getSecret ??
    (() => process.env.ZION_ADMIN_DIAGNOSTIC_AI_RUN_CRON_SECRET);

  const isAutoEnabled =
    dependencies.isAutoEnabled ??
    (() =>
      process.env.ZION_ADMIN_DIAGNOSTIC_AI_RUN_CRON_ENABLED ===
      "true");

  const runCapture =
    dependencies.runCapture ?? runDiagnosticAiRunCaptureCron;

  return async function GET(request: Request): Promise<Response> {
    if (!request || request.method !== "GET") {
      return json(
        { ok: false, error: "METHOD_NOT_ALLOWED" },
        405,
      );
    }

    try {
      // Usa o verificador existente, mas substitui
      // explicitamente a flag e o segredo financeiros.
      const access = await authorizeCron(request, {
        isEnabled: () => true,
        getSecret,
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
        throw new Error("Invalid configuration");
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
      const result = await runCapture({ batchLimit: 20 });

      if (
        !result ||
        (result.status !== "inactive" &&
          result.status !== "processed")
      ) {
        return json(
          { ok: false, error: "DIAGNOSTIC_CRON_UNAVAILABLE" },
          503,
        );
      }

      return json({ ok: true, ...result }, 200);
    } catch {
      // Nao publicar mensagens de RPC, stacks nem
      // informacoes internas do banco na resposta HTTP.
      return json(
        { ok: false, error: "DIAGNOSTIC_CRON_UNAVAILABLE" },
        503,
      );
    }
  };
}

