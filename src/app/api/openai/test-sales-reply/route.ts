import { NextResponse } from "next/server";
import { generateAiSalesReply } from "@/lib/server/generate-ai-sales-reply";

export const runtime = "nodejs";

type RequestBody = {
  organizationId?: string;
  storeId?: string;
  conversationId?: string;
};

export async function POST(req: Request) {
  try {
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

    const result = await generateAiSalesReply({
      organizationId,
      storeId,
      conversationId,
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      message: "Resposta comercial gerada com sucesso.",
      aiText: result.aiText,
      context: result.context,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "TEST_SALES_REPLY_ROUTE_FAILED",
        message:
          error?.message || "Erro interno ao testar geração comercial da IA.",
      },
      { status: 500 }
    );
  }
}