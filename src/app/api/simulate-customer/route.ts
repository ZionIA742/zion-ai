// src/app/api/simulate-customer/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateAiReply } from "@/lib/server/generate-ai-reply";

export const runtime = "nodejs";

type RequestBody = {
  organizationId?: string;
  conversationId?: string;
  text?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestBody;

    const organizationId = String(body.organizationId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    const text = String(body.text || "").trim();

    if (!organizationId || !conversationId || !text) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_FIELDS",
          message: "Envie organizationId, conversationId e text.",
        },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
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

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { error: insertError } = await supabase.rpc("insert_message", {
      p_conversation_id: conversationId,
      p_sender: "user",
      p_direction: "incoming",
      p_message_type: "text",
      p_content: text,
      p_external_message_id: null,
      p_media_url: null,
      p_metadata: {
        source: "demo_customer",
      },
    });

    if (insertError) {
      return NextResponse.json(
        {
          ok: false,
          error: "INSERT_CUSTOMER_MESSAGE_FAILED",
          message: insertError.message,
        },
        { status: 500 }
      );
    }

    const aiResult = await generateAiReply({
      organizationId,
      conversationId,
      customerMessage: text,
    });

    return NextResponse.json({
      ok: true,
      customerMessageSaved: true,
      ai: aiResult,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "SIMULATE_CUSTOMER_ROUTE_FAILED",
        message: err?.message || "Erro interno ao simular mensagem do cliente.",
      },
      { status: 500 }
    );
  }
}