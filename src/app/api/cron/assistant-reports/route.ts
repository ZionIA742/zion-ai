import { NextResponse } from "next/server";
import {
  isAutomaticAssistantReportsEnabled,
  processAutomaticAssistantReports,
} from "@/lib/server/assistant/automatic-reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AssistantReportsCronGetDeps = {
  processReports: typeof processAutomaticAssistantReports;
};

export function createAssistantReportsCronGetHandler(
  deps: Partial<AssistantReportsCronGetDeps> = {},
) {
  const processReports = deps.processReports ?? processAutomaticAssistantReports;

  return async function GET(req: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED_CRON_ROUTE" }, { status: 401 });
    }
    if (!isAutomaticAssistantReportsEnabled()) {
      return NextResponse.json({
        ok: true,
        enabled: false,
        processed: 0,
        results: [],
        route: "cron/assistant-reports",
      });
    }
    try {
      const result = await processReports({ limit: 100 });
      return NextResponse.json({ ...result, route: "cron/assistant-reports" });
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "AUTOMATIC_REPORT_CRON_FAILED" }, { status: 500 });
    }
  };
}

export const GET = createAssistantReportsCronGetHandler();
