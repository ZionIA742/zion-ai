// src/lib/server/generate-ai-reply.ts
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

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

export type GenerateAiReplyResult =
  | {
      ok: true;
      saved: true;
      conversationId: string;
      messageId: string | null;
      aiText: string;
    }
  | {
      ok: false;
      error: string;
      message: string;
      aiText?: string;
    };

function buildSystemPrompt() {
  return `
Você é a IA comercial do projeto ZION, especializada em atendimento e qualificação de clientes para lojas de piscinas.

Seu papel é agir como um vendedor consultivo, humano, educado e objetivo, conduzindo a conversa para entender a necessidade do cliente e avançar o atendimento comercial.

OBJETIVO PRINCIPAL
- qualificar o cliente
- entender o tipo de interesse
- descobrir espaço disponível
- entender para quantas pessoas será a piscina
- descobrir cidade/região
- conduzir a conversa para apresentação de opções e avanço comercial

COMO VOCÊ DEVE FALAR
- sempre em português do Brasil
- linguagem natural, humana e comercial
- educado, simpático e profissional
- respostas curtas ou médias
- evite textos longos demais
- evite parecer robótico
- escreva como um vendedor real no WhatsApp

REGRAS IMPORTANTES
- nunca invente preço
- nunca invente estoque
- nunca invente prazo
- nunca diga que confirmou algo que não confirmou
- quando faltar informação, diga que pode verificar
- não diga que é IA
- não diga que é um teste
- não use markdown
- não use listas grandes
- não escreva blocos enormes
- faça no máximo 1 ou 2 perguntas por resposta
- não repita a mesma saudação em todas as mensagens
- não mande duas respostas coladas ou redundantes
- não fique genérico demais

COMPORTAMENTO COMERCIAL
- se o cliente estiver no começo, faça perguntas para qualificar
- se o cliente perguntar valor, primeiro entenda contexto antes de responder
- procure descobrir:
  - tamanho do espaço
  - finalidade da piscina
  - quantidade de pessoas
  - cidade/região
- conduza a conversa com leveza, como um vendedor experiente
- sempre tente mover a conversa para o próximo passo
- quando fizer sentido, ofereça ajuda para indicar opções ideais

ESTILO DE RESPOSTA
- pareça atencioso
- seja útil
- seja convincente sem exagero
- mostre domínio comercial
- não force fechamento cedo demais
- não fale como suporte técnico
- não responda só com frases secas como "claro" ou "sim"

EXEMPLOS DE TOM
- "Claro! Posso te ajudar com isso. Você já tem uma noção do espaço onde pretende colocar a piscina?"
- "Perfeito. E seria uma piscina mais para uso da família ou para algo maior?"
- "Entendi. Me fala também sua cidade para eu te orientar da forma mais certa."

MISSÃO
Seu trabalho é fazer o cliente sentir que está sendo atendido por um vendedor de verdade, que entende do assunto e conduz a conversa com segurança.
`.trim();
}

export async function generateAiReply(params: {
  organizationId: string;
  conversationId: string;
  customerMessage: string;
}): Promise<GenerateAiReplyResult> {
  try {
    const organizationId = String(params.organizationId || "").trim();
    const conversationId = String(params.conversationId || "").trim();
    const customerMessage = String(params.customerMessage || "").trim();

    if (!organizationId || !conversationId || !customerMessage) {
      return {
        ok: false,
        error: "MISSING_FIELDS",
        message:
          "Envie organizationId, conversationId e customerMessage no body da requisição.",
      };
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return {
        ok: false,
        error: "SUPABASE_ENV_MISSING",
        message:
          "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente.",
      };
    }

    if (!openaiApiKey) {
      return {
        ok: false,
        error: "OPENAI_ENV_MISSING",
        message: "Verifique OPENAI_API_KEY nas variáveis de ambiente.",
      };
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
      return {
        ok: false,
        error: "CONVERSATION_NOT_FOUND_OR_FORBIDDEN",
        message:
          conversationError?.message ||
          "Conversa não encontrada para a organização informada.",
      };
    }

    if (
      conversation.is_human_active === true ||
      conversation.status === "humano_assumiu"
    ) {
      return {
        ok: false,
        error: "HUMAN_ACTIVE",
        message: "A conversa está sob controle humano. IA bloqueada.",
      };
    }

    const { data: recentMessages, error: recentMessagesError } = await supabase
      .from("messages")
      .select("sender, content, direction, message_type, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(12);

    if (recentMessagesError) {
      return {
        ok: false,
        error: "LOAD_MESSAGES_FAILED",
        message: recentMessagesError.message,
      };
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
      model: "gpt-4.1-mini",
      input,
    });

    const aiText = String(response.output_text || "").trim();

    if (!aiText) {
      return {
        ok: false,
        error: "EMPTY_AI_RESPONSE",
        message: "A OpenAI não retornou texto utilizável.",
      };
    }

    const { data: messageId, error: sendError } = await supabase.rpc(
      "panel_send_message",
      {
        p_conversation_id: conversationId,
        p_text: aiText,
        p_sender: "ai",
        p_external_message_id: null,
      }
    );

    if (sendError) {
      return {
        ok: false,
        error: "SAVE_AI_MESSAGE_FAILED",
        message: sendError.message,
        aiText,
      };
    }

    return {
      ok: true,
      saved: true,
      conversationId,
      messageId: messageId ?? null,
      aiText,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: "AI_REPLY_ROUTE_FAILED",
      message: error?.message || "Erro interno ao processar resposta da IA.",
    };
  }
}