// src/app/api/ai/reply/route.ts
import { NextResponse } from "next/server";
import { generateAiReply } from "@/lib/server/generate-ai-reply";

export const runtime = "nodejs";

type RequestBody = {
  organizationId?: string;
  conversationId?: string;
  customerMessage?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;

    const result = await generateAiReply({
      organizationId: String(body.organizationId || ""),
      conversationId: String(body.conversationId || ""),
      customerMessage: String(body.customerMessage || ""),
    });

    if (!result.ok) {
      const status =
        result.error === "MISSING_FIELDS"
          ? 400
          : result.error === "CONVERSATION_NOT_FOUND_OR_FORBIDDEN"
          ? 404
          : result.error === "HUMAN_ACTIVE"
          ? 409
          : 500;

      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "AI_REPLY_ROUTE_FAILED",
        message: error?.message || "Erro interno ao processar resposta da IA.",
      },
      { status: 500 }
    );
  }
}