import {
  createDailyOpenAiCostRetryRunner,
} from "@/lib/server/zion-admin-openai-cost-daily-retry-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RetryRunner =
  ReturnType<typeof createDailyOpenAiCostRetryRunner>;

export type OpenAiCostRetryCronDependencies = {
  runRetry?: RetryRunner;
  isRetryEnabled?: () => boolean;
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
 * Dedicated OpenAI cost retry endpoint.
 *
 * Disabled by default behind a separate explicit flag.
 * The existing daily collection cron is not changed.
 *
 * The retry runner verifies cron authentication and
 * all financial execution flags BEFORE database I/O.
 * It then checks the due operation and validates the
 * atomic targeted claim before provider collection.
 *
 * A financial uncertainty is acknowledged without
 * triggering an indiscriminate HTTP retry.
 *
 * Responses expose no operation IDs or provider details.
 */
export function createOpenAiCostRetryCronGetHandler(
  dependencies: OpenAiCostRetryCronDependencies = {},
) {
  const runRetry =
    dependencies.runRetry ??
    createDailyOpenAiCostRetryRunner();

  const isRetryEnabled =
    dependencies.isRetryEnabled ??
    (() =>
      process.env.ZION_ADMIN_OPENAI_COST_AUTO_RETRY_ENABLED ===
      "true");

  return async function GET(
    request: Request,
  ): Promise<Response> {
    if (!request || request.method !== "GET") {
      return json(
        { ok: false, error: "METHOD_NOT_ALLOWED" },
        405,
        true,
      );
    }

    let enabled: boolean;

    try {
      enabled = isRetryEnabled();
    } catch {
      return json(
        { ok: false, error: "FINANCIAL_CRON_UNAVAILABLE" },
        503,
      );
    }

    if (enabled !== true) {
      return json(
        { ok: false, error: "FINANCIAL_CRON_UNAVAILABLE" },
        503,
      );
    }

    try {
      const result = await runRetry(request);

      if (!result || typeof result !== "object") {
        return json(
          { ok: false, status: "needs_review" },
          200,
        );
      }

      if (result.status === "blocked") {
        if (result.reason === "cron_unauthorized") {
          return json(
            { ok: false, error: "UNAUTHORIZED_CRON_ROUTE" },
            401,
          );
        }

        return json(
          { ok: false, error: "FINANCIAL_CRON_UNAVAILABLE" },
          503,
        );
      }

      if (result.status === "skipped") {
        return json(
          { ok: true, status: "skipped" },
          200,
        );
      }

      if (result.status === "confirmed") {
        return json(
          { ok: true, status: "confirmed" },
          200,
        );
      }

      if (result.status === "failure_recorded") {
        return json(
          { ok: false, status: "failure_recorded" },
          200,
        );
      }

      return json(
        { ok: false, status: "needs_review" },
        200,
      );
    } catch {
      // The targeted claim or finalization might already
      // have committed. Never encourage blind retries.
      return json(
        { ok: false, status: "needs_review" },
        200,
      );
    }
  };
}

export const GET = createOpenAiCostRetryCronGetHandler();