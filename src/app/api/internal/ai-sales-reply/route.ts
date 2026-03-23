import { NextResponse } from "next/server";
import { generateAndSaveAiSalesReply } from "@/lib/server/generate-and-save-ai-sales-reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  organizationId?: string;
  storeId?: string;
  conversationId?: string;
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
    const conversationId = String(body.conversationId || "").trim();

    if (!organizationId || !storeId || !conversationId) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_FIELDS",
          message: "Envie organizationId, storeId e conversationId.",
        },
        { status: 400 }
      );
    }

    const result = await generateAndSaveAiSalesReply({
      organizationId,
      storeId,
      conversationId,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          message: result.message,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Resposta comercial gerada e salva com sucesso.",
      bridge: {
        route: "internal/ai-sales-reply",
        authMode: auth.mode,
      },
      aiText: result.aiText,
      context: result.context,
      persisted: result.persisted,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "INTERNAL_AI_SALES_REPLY_ROUTE_FAILED",
        message:
          error?.message ||
          "Erro interno ao gerar e salvar resposta comercial da IA.",
      },
      { status: 500 }
    );
  }
}