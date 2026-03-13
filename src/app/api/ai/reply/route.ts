// src/app/api/ai/reply/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type RequestBody = {
  organizationId?: string;
  conversationId?: string;
  customerMessage?: string;
};

type ConversationRow = {
  id: string;
  organization_id: string;
  is_human_active: boolean | null;
  status: string | null;
};

type MessageRow = {
  sender: string | null;
  content: string | null;
  direction: string | null;
  message_type: string | null;
  created_at: string | null;
};

function buildSystemPrompt() {
  return `
Você é a IA comercial do projeto ZION, um vendedor automático para lojas de piscinas.

Seu papel:
- atender clientes com educação e objetividade
- responder sempre em português do Brasil
- ajudar com piscinas, produtos químicos e acessórios
- vender sem parecer robótico
- ser direto, útil e comercial

Regras:
- nunca invente estoque confirmado
- nunca invente preço se ele não for informado
- quando não souber algo, diga que pode verificar
- mantenha respostas curtas e naturais
- tente conduzir a conversa para entender necessidade, orçamento ou tipo de produto
- não diga que é um teste
- não use markdown
- não use listas longas
- não escreva respostas gigantes

Tom:
- vendedor prestativo
- natural
- comercial
- claro
`.trim();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;

    const organizationId = String(body.organizationId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    const customerMessage = String(body.customerMessage || "").trim();

    if (!organizationId || !conversationId || !customerMessage) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_FIELDS",
          message:
            "Envie organizationId, conversationId e customerMessage no body da requisição.",
        },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "SUPABASE_ENV_MISSING",
          message:
            "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local",
        },
        { status: 500 }
      );
    }

    if (!openaiApiKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "OPENAI_ENV_MISSING",
          message: "Verifique OPENAI_API_KEY no .env.local",
        },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const openai = new OpenAI({ apiKey: openaiApiKey });

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id, organization_id, is_human_active, status")
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      .maybeSingle<ConversationRow>();

    if (conversationError || !conversation) {
      return NextResponse.json(
        {
          ok: false,
          error: "CONVERSATION_NOT_FOUND_OR_FORBIDDEN",
          message:
            conversationError?.message ||
            "Conversa não encontrada para a organização informada.",
        },
        { status: 404 }
      );
    }

    if (
      conversation.is_human_active === true ||
      conversation.status === "humano_assumiu"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "HUMAN_ACTIVE",
          message: "A conversa está sob controle humano. IA bloqueada.",
        },
        { status: 409 }
      );
    }

    const { data: recentMessages, error: recentMessagesError } = await supabase
      .from("messages")
      .select("sender, content, direction, message_type, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(12);

    if (recentMessagesError) {
      return NextResponse.json(
        {
          ok: false,
          error: "LOAD_MESSAGES_FAILED",
          message: recentMessagesError.message,
        },
        { status: 500 }
      );
    }

    const orderedMessages = ([...(recentMessages || [])] as MessageRow[]).reverse();

    const input = [
      {
        role: "system" as const,
        content: buildSystemPrompt(),
      },
      ...orderedMessages
        .filter((msg) => String(msg.content || "").trim().length > 0)
        .map((msg) => {
          const sender = String(msg.sender || "").toLowerCase();
          const direction = String(msg.direction || "").toLowerCase();

          const role =
            sender.includes("assistant") ||
            sender.includes("ai") ||
            sender.includes("bot")
              ? "assistant"
              : direction === "outgoing"
              ? "assistant"
              : "user";

          return {
            role: role as "user" | "assistant",
            content: String(msg.content || ""),
          };
        }),
      {
        role: "user" as const,
        content: customerMessage,
      },
    ];

    const response = await openai.responses.create({
      model: "gpt-5-mini",
      input,
    });

    const aiText = String(response.output_text || "").trim();

    if (!aiText) {
      return NextResponse.json(
        {
          ok: false,
          error: "EMPTY_AI_RESPONSE",
          message: "A OpenAI não retornou texto utilizável.",
        },
        { status: 500 }
      );
    }

    const { data: messageId, error: sendError } = await supabase.rpc(
      "panel_send_message",
      {
        p_conversation_id: conversationId,
        p_text: aiText,
        p_sender: "assistant",
        p_external_message_id: null,
      }
    );

    if (sendError) {
      return NextResponse.json(
        {
          ok: false,
          error: "SAVE_AI_MESSAGE_FAILED",
          message: sendError.message,
          aiText,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      saved: true,
      conversationId,
      messageId,
      aiText,
    });
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