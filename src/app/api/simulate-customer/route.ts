import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateAndSaveAiSalesReply } from "@/lib/server/generate-and-save-ai-sales-reply";

export const runtime = "nodejs";

type RequestBody = {
  organizationId?: string;
  storeId?: string;
  conversationId?: string;
  text?: string;
};

type ConversationRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
  is_human_active: boolean | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestBody;

    const organizationId = String(body.organizationId || "").trim();
    const storeId = String(body.storeId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    const text = String(body.text || "").trim();

    if (!organizationId || !storeId || !conversationId || !text) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_FIELDS",
          message: "Envie organizationId, storeId, conversationId e text.",
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

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id, organization_id, lead_id, is_human_active")
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (conversationError) {
      return NextResponse.json(
        {
          ok: false,
          error: "CONVERSATION_LOOKUP_FAILED",
          message: conversationError.message,
        },
        { status: 400 }
      );
    }

    if (!conversation) {
      return NextResponse.json(
        {
          ok: false,
          error: "CONVERSATION_NOT_FOUND_OR_FORBIDDEN",
          message:
            "Conversa não encontrada para a organização informada.",
        },
        { status: 404 }
      );
    }

    const normalizedConversation = conversation as ConversationRow;

    if (normalizedConversation.is_human_active) {
      return NextResponse.json(
        {
          ok: false,
          error: "HUMAN_HANDOFF_ACTIVE",
          message:
            "A conversa está com humano ativo. A IA não deve responder automaticamente.",
        },
        { status: 400 }
      );
    }

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

    const aiResult = await generateAndSaveAiSalesReply({
      organizationId,
      storeId,
      conversationId,
    });

    if (!aiResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: aiResult.error,
          message: aiResult.message,
          customerMessageSaved: true,
          aiReplySaved: false,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      customerMessageSaved: true,
      aiReplySaved: true,
      conversationId,
      organizationId,
      storeId,
      customerText: text,
      aiText: aiResult.aiText,
      persisted: aiResult.persisted,
      context: aiResult.context,
      flow: {
        mode: "simulate_customer_with_direct_ai_persist",
        message:
          "Mensagem do cliente salva e resposta da IA gerada/salva com sucesso.",
      },
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