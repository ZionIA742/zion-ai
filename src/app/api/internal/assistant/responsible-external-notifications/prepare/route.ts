import { NextResponse } from "next/server";
import { prepareResponsibleExternalNotification } from "@/lib/server/assistant/responsible-external-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PrepareBody = {
  organizationId?: string;
  storeId?: string;
  notificationId?: string;
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
        updated: false,
        reason: "unauthorized",
      },
      { status: 401 }
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as PrepareBody;
    const organizationId = String(body.organizationId || "").trim();
    const storeId = String(body.storeId || "").trim();
    const notificationId = String(body.notificationId || "").trim();

    if (!organizationId || !storeId || !notificationId) {
      return NextResponse.json(
        {
          ok: false,
          updated: false,
          reason: "missing_required_fields",
        },
        { status: 400 }
      );
    }

    const result = await prepareResponsibleExternalNotification({
      organizationId,
      storeId,
      notificationId,
    });

    return NextResponse.json(result, {
      status: result.ok ? 200 : 409,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        updated: false,
        reason: "RESPONSIBLE_EXTERNAL_NOTIFICATION_PREPARE_FAILED",
        message:
          error?.message ||
          "Erro interno ao preparar notificacao externa do responsavel.",
      },
      { status: 500 }
    );
  }
}
