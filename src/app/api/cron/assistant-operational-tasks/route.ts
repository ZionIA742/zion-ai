import { NextResponse } from "next/server";
import { processAssistantOperationalTasks } from "@/lib/server/process-assistant-operational-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isCronRequestAuthorized(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") || "";

  if (!cronSecret) {
    return { ok: false, mode: "missing_cron_secret" as const };
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return { ok: false, mode: "invalid_cron_authorization" as const };
  }

  return { ok: true, mode: "authorized_by_cron_secret" as const };
}

export async function GET(req: Request) {
  const auth = isCronRequestAuthorized(req);

  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "UNAUTHORIZED_CRON_ROUTE",
        message: "Cron não autorizado. Verifique CRON_SECRET e o header Authorization.",
      },
      { status: 401 }
    );
  }

  try {
    const result = await processAssistantOperationalTasks({
      limit: 20,
      workerName: "assistant-operational-cron-worker",
    });

    return NextResponse.json({
      ...result,
      authMode: auth.mode,
      route: "cron/assistant-operational-tasks",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "ASSISTANT_OPERATIONAL_TASK_CRON_FAILED",
        message:
          error?.message || "Erro interno no cron de tarefas operacionais da assistente.",
      },
      { status: 500 }
    );
  }
}
