import { NextResponse } from "next/server";

import {
  runDailyOpenAiCostPreparation,
} from "@/lib/server/zion-admin-openai-cost-daily-preparation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type OpenAiCostsCronGetDependencies = {
  runPreparation: typeof runDailyOpenAiCostPreparation;
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
 * Dedicated financial preparation endpoint.
 *
 * Authentication, daily planning, verified inventory and the
 * financial preparation gates live in the internal service.
 *
 * Does not claim, execute, collect, finalize or write a snapshot.
 * Responses never expose secrets, operation IDs or RPC errors.
 */
export function createOpenAiCostsCronGetHandler(
  dependencies: Partial<OpenAiCostsCronGetDependencies> = {},
) {
  const runPreparation =
    dependencies.runPreparation ??
    runDailyOpenAiCostPreparation;

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
