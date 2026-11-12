import {
  createOpenAiCostCutoverRunner,
} from "@/lib/server/zion-admin-openai-cost-cutover-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CutoverRunner =
  ReturnType<typeof createOpenAiCostCutoverRunner>;

export type OpenAiCostCutoverCronDependencies = {
  runCutover?: CutoverRunner;
};

function json(
  body: Record<string, unknown>,
  status: number,
  allowGet = false,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(allowGet ? { Allow: "GET" } : {}),
    },
  });
}

/**
 * Exceptional OpenAI cost cutover endpoint.
 *
 * This route has no schedule and no automatic activation.
 *
 * The financial runner requires:
 * - authenticated system cron
 * - financial execution flags
 * - explicit cutover flag
 * - exact UTC cutover date
 *
 * It never exposes operation IDs, financial contracts
 * or database errors in its response.
 */
export function createOpenAiCostCutoverCronGetHandler(
  dependencies: OpenAiCostCutoverCronDependencies = {},
) {
  const runCutover =
    dependencies.runCutover ??
    createOpenAiCostCutoverRunner();

  return async function GET(
    request: Request,
  ): Promise<Response> {
    if (!request || request.method !== "GET") {
      return json(
        {
          ok: false,
          error: "METHOD_NOT_ALLOWED",
        },
        405,
        true,
      );
    }

    try {
      const result = await runCutover(request);

      if (!result || typeof result !== "object") {
        return json(
          { ok: false, status: "needs_review" },
          200,
        );
      }

      if (result.status === "blocked") {
        if (result.reason === "cron_unauthorized") {
          return json(
            {
              ok: false,
              error: "UNAUTHORIZED_CRON_ROUTE",
            },
            401,
          );
        }

        return json(
          {
            ok: false,
            error: "FINANCIAL_CUTOVER_UNAVAILABLE",
          },
          503,
        );
      }

      if (result.status === "confirmed") {
        return json(
          { ok: true, status: "confirmed" },
          200,
        );
      }

      if (result.status === "skipped") {
        return json(
          { ok: true, status: "skipped" },
          200,
        );
      }

      return json(
        { ok: false, status: "needs_review" },
        200,
      );
    } catch {
      // A financial write or claim could already
      // have committed. Do not encourage blind retries.
      return json(
        { ok: false, status: "needs_review" },
        200,
      );
    }
  };
}

export const GET =
  createOpenAiCostCutoverCronGetHandler();