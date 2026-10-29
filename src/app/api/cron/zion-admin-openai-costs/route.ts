import { NextResponse } from "next/server";

import {
  createDailyOpenAiCostExecutionRunner,
} from "@/lib/server/zion-admin-openai-cost-daily-execution-runner";

import {
  runDailyOpenAiCostPreparation,
} from "@/lib/server/zion-admin-openai-cost-daily-preparation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type OpenAiCostsCronGetDependencies = {
  runPreparation: typeof runDailyOpenAiCostPreparation;
  runExecution: ReturnType<typeof createDailyOpenAiCostExecutionRunner>;
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
 * Dedicated financial cron endpoint.
 *
 * Default: authenticated preparation-only workflow.
 * Automatic execution requires an additional explicit flag
 * and the separately authorized daily financial runner.
 *
 * No automatic retries or historical backfill are added.
 * Responses never expose secrets, operation IDs or RPC errors.
 */
export function createOpenAiCostsCronGetHandler(
  dependencies: Partial<OpenAiCostsCronGetDependencies> = {},
) {
  const runPreparation =
    dependencies.runPreparation ??
    runDailyOpenAiCostPreparation;

  const runExecution =
    dependencies.runExecution ??
    createDailyOpenAiCostExecutionRunner();

  const isAutoExecutionEnabled =
    dependencies.isAutoExecutionEnabled ??
    (() =>
      process.env.ZION_ADMIN_OPENAI_COST_AUTO_EXECUTION_ENABLED ===
      "true");

  return async function GET(
    request: Request,
  ): Promise<NextResponse> {
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

    try {
      const automaticExecutionEnabled =
        isAutoExecutionEnabled();

      if (
        automaticExecutionEnabled !== true &&
        automaticExecutionEnabled !== false
      ) {
        return json(
          { ok: false, error: "FINANCIAL_CRON_UNAVAILABLE" },
          503,
        );
      }

      if (automaticExecutionEnabled) {
        // The runner performs its own cron authentication,
        // financial flag checks, daily plan verification,
        // targeted claim and verified batch execution.
        //
        // Do not invoke preparation separately in this path.
        const execution = await runExecution(request);

        if (!execution || typeof execution !== "object") {
          return json(
            { ok: false, error: "FINANCIAL_CRON_UNAVAILABLE" },
            503,
          );
        }

        if (execution.status === "blocked") {
          if (execution.reason === "authorization_denied") {
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

        if (execution.status === "confirmed") {
          return json(
            { ok: true, status: "confirmed" },
            200,
          );
        }

        if (execution.status === "skipped") {
          return json(
            { ok: true, status: "skipped" },
            200,
          );
        }

        if (execution.status === "needs_review") {
          // Acknowledge the HTTP request without confirming
          // financial success or encouraging blind HTTP retries.
          return json(
            { ok: false, status: "needs_review" },
            200,
          );
        }

        return json(
          { ok: false, error: "FINANCIAL_CRON_UNAVAILABLE" },
          503,
        );
      }

      // Existing preparation-only behavior is preserved
      // while automatic execution remains disabled.
      const result = await runPreparation(request);

      if (!result || typeof result !== "object") {
        return json(
          { ok: false, error: "FINANCIAL_CRON_UNAVAILABLE" },
          503,
        );
      }

      if (result.status === "blocked") {
        if (result.reason === "authorization_denied") {
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

      if (result.status === "existing") {
        return json(
          { ok: true, status: "existing" },
          200,
        );
      }

      if (result.status === "prepared_pending") {
        return json(
          { ok: true, status: "prepared_pending" },
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

export const GET = createOpenAiCostsCronGetHandler();
