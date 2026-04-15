import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  organizationId?: string;
  storeId?: string;
  nowIso?: string;
};

function isInternalRequestAuthorized(req: Request) {
  const secretFromEnv = process.env.AI_INTERNAL_ROUTE_SECRET;
  const secretFromHeader =
    req.headers.get("x-zion-internal-secret") ||
    req.headers.get("x-internal-secret") ||
    "";

  if (!secretFromEnv) {
    return {
      ok: false,
      mode: "missing_env_secret" as const,
    };
  }

  if (secretFromHeader !== secretFromEnv) {
    return {
      ok: false,
      mode: "invalid_header_secret" as const,
    };
  }

  return {
    ok: true,
    mode: "authorized_by_secret" as const,
  };
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "internal/schedule-post-appointment-followup",
    method: "GET",
    message: "rota publicada e funcionando",
  });
}

export async function POST(req: Request) {
  try {
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

    const body = (await req.json()) as RequestBody;

    const organizationId = String(body.organizationId || "").trim();
    const storeId = String(body.storeId || "").trim();
    const nowIso = String(body.nowIso || "").trim();

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

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "SUPABASE_ENV_MISSING",
          message:
            "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente.",
        },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const effectiveNow = nowIso ? new Date(nowIso) : new Date();

    if (Number.isNaN(effectiveNow.getTime())) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_NOW_ISO",
          message: "nowIso inválido.",
        },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc(
      "enqueue_post_appointment_followups",
      {
        p_organization_id: organizationId,
        p_store_id: storeId,
        p_now: effectiveNow.toISOString(),
      }
    );

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "ENQUEUE_POST_APPOINTMENT_FOLLOWUPS_FAILED",
          message: error.message,
        },
        { status: 500 }
      );
    }

    const row = Array.isArray(data) ? data[0] : null;
    const insertedCount = Number(row?.inserted_count || 0);

    return NextResponse.json({
      ok: true,
      message: "Varredura de pós-compromisso executada com sucesso.",
      bridge: {
        route: "internal/schedule-post-appointment-followup",
        authMode: auth.mode,
      },
      organizationId,
      storeId,
      nowIso: effectiveNow.toISOString(),
      insertedCount,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "INTERNAL_SCHEDULE_POST_APPOINTMENT_FOLLOWUP_ROUTE_FAILED",
        message:
          error?.message ||
          "Erro interno ao enfileirar acompanhamentos pós-compromisso.",
      },
      { status: 500 }
    );
  }
}
