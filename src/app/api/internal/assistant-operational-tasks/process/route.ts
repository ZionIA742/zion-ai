import { NextResponse } from "next/server";
import { processAssistantOperationalTasks } from "@/lib/server/process-assistant-operational-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProcessBody = {
  organizationId?: string;
  storeId?: string;
  limit?: number;
};

function isInternalRequestAuthorized(req: Request) {
  const secretFromEnv = process.env.AI_INTERNAL_ROUTE_SECRET;
  const secretFromHeader =
    req.headers.get("x-zion-internal-secret") ||
    req.headers.get("x-internal-secret") ||
    "";

  if (!secretFromEnv) {
    return { ok: false, mode: "missing_env_secret" as const };
  }

  if (secretFromHeader !== secretFromEnv) {
    return { ok: false, mode: "invalid_header_secret" as const };
  }

  return { ok: true, mode: "authorized_by_secret" as const };
}

export async function POST(req: Request) {
  const auth = isInternalRequestAuthorized(req);

  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "UNAUTHORIZED_INTERNAL_ROUTE",
        message:
          "Acesso interno não autorizado. Verifique AI_INTERNAL_ROUTE_SECRET e o header x-zion-internal-secret.",
      },
      { status: 401 }
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as ProcessBody;
    const organizationId = String(body.organizationId || "").trim();
    const storeId = String(body.storeId || "").trim();
    const limit = Math.min(Math.max(Number(body.limit || 5), 1), 20);

    if (!organizationId || !storeId) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_FIELDS",
          message: "Envie organizationId e storeId.",
        },
        { status: 400 }
      );
    }

    const result = await processAssistantOperationalTasks({
      organizationId,
      storeId,
      limit,
      workerName: "assistant-operational-manual-worker",
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "ASSISTANT_OPERATIONAL_TASK_PROCESS_FAILED",
        message:
          error?.message || "Erro interno ao processar tarefas operacionais da assistente.",
      },
      { status: 500 }
    );
  }
}
