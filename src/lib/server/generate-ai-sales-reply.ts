import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

type ConversationRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
  status: string | null;
  is_human_active: boolean | null;
};

type LeadRow = {
  id: string;
  organization_id: string;
  store_id: string | null;
  name: string | null;
  phone: string | null;
  state: string | null;
};

type MessageRow = {
  id: string;
  sender: string | null;
  content: string | null;
  direction: string | null;
  message_type: string | null;
  created_at: string | null;
};

type StoreRow = {
  id: string;
  organization_id: string;
  name: string | null;
};

type StoreAnswerRow = {
  question_key: string;
  answer: unknown;
};

type PoolRow = {
  id: string;
  name: string | null;
  material: string | null;
  shape: string | null;
  width_m: number | null;
  length_m: number | null;
  depth_m: number | null;
  price: number | null;
  description: string | null;
  photo_url: string | null;
  is_active: boolean | null;
  track_stock: boolean | null;
  stock_quantity: number | null;
};

export type GenerateAiSalesReplyParams = {
  organizationId: string;
  storeId: string;
  conversationId: string;
};

export type GenerateAiSalesReplyResult =
  | {
      ok: true;
      aiText: string;
      context: {
        leadName: string | null;
        lastCustomerMessage: string;
        storeDisplayName: string | null;
        poolCountUsed: number;
      };
    }
  | {
      ok: false;
      error: string;
      message: string;
    };

function asText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    if (Array.isArray(value)) {
      const arr = value
        .map((item) => asText(item))
        .filter(Boolean) as string[];
      return arr.length ? arr.join(", ") : null;
    }

    if (typeof value === "object") {
      const maybeObj = value as Record<string, unknown>;

      if (typeof maybeObj.value === "string") {
        return maybeObj.value.trim() || null;
      }

      return JSON.stringify(value);
    }
  } catch {
    return null;
  }

  return null;
}

function formatPoolLine(pool: PoolRow): string {
  const parts: string[] = [];

  if (pool.name) parts.push(pool.name);
  if (pool.material) parts.push(`material ${pool.material}`);
  if (pool.shape) parts.push(`formato ${pool.shape}`);

  if (pool.width_m != null && pool.length_m != null) {
    parts.push(`tamanho aproximado ${pool.width_m}m x ${pool.length_m}m`);
  }

  if (pool.depth_m != null) {
    parts.push(`profundidade ${pool.depth_m}m`);
  }

  if (pool.price != null) {
    parts.push(`valor de referência R$ ${pool.price}`);
  }

  if (pool.photo_url) {
    parts.push(`possui foto principal cadastrada`);
  }

  if (pool.description) {
    parts.push(`descrição: ${pool.description}`);
  }

  return `- ${parts.join(" | ")}`;
}

function buildSystemPrompt(args: {
  storeDisplayName: string | null;
  storeName: string | null;
  leadName: string | null;
  leadState: string | null;
  onboardingMap: Record<string, string>;
  recentHistory: string;
  availablePoolsText: string;
  lastCustomerMessage: string;
}) {
  const storeLabel = args.storeDisplayName || args.storeName || "a loja";
  const leadLabel = args.leadName || "cliente";

  const onboardingSummary = Object.entries(args.onboardingMap)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");

  return `
Você é a IA comercial real do projeto ZION, atendendo a loja ${storeLabel}.

Você está falando com o lead ${leadLabel}.

OBJETIVO
Seu papel é agir como uma vendedora consultiva, humana, natural e comercial para lojas de piscina.
Você deve aplicar SPIN Selling e BANT de forma natural, sem parecer interrogatório.

REGRAS CENTRAIS
- Fale em português do Brasil.
- Soe humana, natural, comercial e segura.
- Respostas curtas ou médias.
- No máximo 1 ou 2 perguntas por resposta.
- Não pareça robô.
- Não fale como suporte técnico.
- Não diga que é IA.
- Não diga que está seguindo framework.
- Não use markdown pesado.
- Não use listas longas no texto final.
- Não fale "no próximo passo do fluxo", "na evolução do fluxo" ou frases parecidas.
- Não explique processo interno.
- Não fique repetindo abertura parecida.
- Não ignore o pedido principal do cliente.

REGRAS COMERCIAIS DO ZION
- A loja vende piscinas, instalação e itens relacionados.
- A loja não deve prometer estética completa do entorno se isso não fizer parte do escopo confirmado.
- Não invente preço, prazo, estoque ou condição.
- Não dê preço seco cedo demais na maioria dos casos.
- Primeiro entenda o contexto mínimo necessário.
- Quando fizer sentido, sugira até 3 opções.
- Se o cliente pedir catálogo de piscina, trate isso como um pedido importante e avance de forma útil.
- Se houver opções de piscinas no contexto, você pode mencionar as opções de forma natural.
- Se o cliente insistir ou repetir o pedido, pare de enrolar e responda de forma mais objetiva.

COMO USAR SPIN
- Situação: faça poucas perguntas de contexto, só o necessário.
- Problema: descubra o que o cliente realmente quer resolver ou decidir.
- Implicação: ajude o cliente a perceber por que vale alinhar melhor a escolha.
- Need-payoff: mostre o valor do próximo passo certo.

COMO USAR BANT
- Budget: descubra faixa de investimento com naturalidade, sem perguntar orçamento seco cedo demais.
- Authority: descubra se decide sozinho ou com outra pessoa, sem constranger.
- Need: entenda a necessidade real.
- Timing: descubra se é para agora ou pesquisa.

ESTILO DE RESPOSTA
- Tom humano de WhatsApp.
- Natural.
- Objetivo.
- Atencioso.
- Sem exagero.
- Sem parecer script.

DADOS IMPORTANTES DA LOJA
${onboardingSummary || "- sem dados adicionais do onboarding disponíveis"}

ETAPA ATUAL DO LEAD
- lead_state: ${args.leadState || "desconhecido"}

HISTÓRICO RECENTE DA CONVERSA
${args.recentHistory || "Sem histórico recente relevante."}

OPÇÕES DE PISCINAS DISPONÍVEIS NO CONTEXTO
${args.availablePoolsText || "Nenhuma opção de piscina carregada no contexto."}

MENSAGEM MAIS RECENTE DO CLIENTE
${args.lastCustomerMessage}

INSTRUÇÃO FINAL
Responda como uma vendedora consultiva real.
Se o cliente pedir algo direto, responda ao pedido e só depois conduza com naturalidade.
Evite soar robótica.
Evite responder de forma genérica.
Evite frases artificiais como "esse é o próximo ponto que posso te mostrar".
`.trim();
}

export async function generateAiSalesReply(
  params: GenerateAiSalesReplyParams
): Promise<GenerateAiSalesReplyResult> {
  try {
    const organizationId = String(params.organizationId || "").trim();
    const storeId = String(params.storeId || "").trim();
    const conversationId = String(params.conversationId || "").trim();

    if (!organizationId || !storeId || !conversationId) {
      return {
        ok: false,
        error: "MISSING_FIELDS",
        message: "Envie organizationId, storeId e conversationId.",
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
      .select("id, organization_id, lead_id, status, is_human_active")
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      .maybeSingle<ConversationRow>();

    if (conversationError || !conversation) {
      return {
        ok: false,
        error: "CONVERSATION_NOT_FOUND",
        message:
          conversationError?.message ||
          "Conversa não encontrada para a organização informada.",
      };
    }

    if (conversation.is_human_active === true) {
      return {
        ok: false,
        error: "HUMAN_ACTIVE",
        message: "A conversa está com humano ativo.",
      };
    }

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, organization_id, store_id, name, phone, state")
      .eq("id", conversation.lead_id)
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .maybeSingle<LeadRow>();

    if (leadError || !lead) {
      return {
        ok: false,
        error: "LEAD_NOT_FOUND",
        message:
          leadError?.message || "Lead não encontrado para a conversa informada.",
      };
    }

    const { data: store, error: storeError } = await supabase
      .from("stores")
      .select("id, organization_id, name")
      .eq("id", storeId)
      .eq("organization_id", organizationId)
      .maybeSingle<StoreRow>();

    if (storeError || !store) {
      return {
        ok: false,
        error: "STORE_NOT_FOUND",
        message:
          storeError?.message || "Loja não encontrada para os dados informados.",
      };
    }

    const { data: onboardingAnswers, error: onboardingError } = await supabase
      .from("store_onboarding_answers")
      .select("question_key, answer")
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .in("question_key", [
        "store_display_name",
        "city",
        "state",
        "service_regions",
        "store_services",
        "main_store_differentials",
        "pool_types",
        "brands_worked",
      ]);

    if (onboardingError) {
      return {
        ok: false,
        error: "LOAD_ONBOARDING_FAILED",
        message: onboardingError.message,
      };
    }

    const onboardingMap: Record<string, string> = {};
    for (const row of (onboardingAnswers || []) as StoreAnswerRow[]) {
      const text = asText(row.answer);
      if (text) {
        onboardingMap[row.question_key] = text;
      }
    }

    const { data: recentMessages, error: recentMessagesError } = await supabase
      .from("messages")
      .select("id, sender, content, direction, message_type, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (recentMessagesError) {
      return {
        ok: false,
        error: "LOAD_MESSAGES_FAILED",
        message: recentMessagesError.message,
      };
    }

    const orderedMessages = ([...(recentMessages || [])] as MessageRow[]).reverse();

    const lastCustomerMessage =
      [...orderedMessages]
        .reverse()
        .find(
          (msg) =>
            String(msg.sender || "").toLowerCase() === "user" &&
            String(msg.direction || "").toLowerCase() === "incoming" &&
            String(msg.content || "").trim().length > 0
        )?.content?.trim() || "";

    if (!lastCustomerMessage) {
      return {
        ok: false,
        error: "NO_CUSTOMER_MESSAGE",
        message: "Não encontrei uma mensagem recente do cliente para responder.",
      };
    }

    const recentHistory = orderedMessages
      .filter((msg) => String(msg.content || "").trim().length > 0)
      .map((msg) => {
        const sender = String(msg.sender || "").toLowerCase();
        const direction = String(msg.direction || "").toLowerCase();

        let label = "Cliente";
        if (sender.includes("ai") || sender.includes("assistant") || sender.includes("bot")) {
          label = "IA";
        } else if (direction === "outgoing") {
          label = "Humano";
        }

        return `${label}: ${String(msg.content || "").trim()}`;
      })
      .join("\n");

    const lastCustomerMessageNormalized = lastCustomerMessage.toLowerCase();

    const customerSeemsToBeAskingPools =
      lastCustomerMessageNormalized.includes("piscina") ||
      lastCustomerMessageNormalized.includes("fibra") ||
      lastCustomerMessageNormalized.includes("vinil") ||
      lastCustomerMessageNormalized.includes("alvenaria") ||
      lastCustomerMessageNormalized.includes("catálogo") ||
      lastCustomerMessageNormalized.includes("catalogo") ||
      lastCustomerMessageNormalized.includes("modelo") ||
      lastCustomerMessageNormalized.includes("modelos");

    let availablePoolsText = "Nenhuma opção de piscina carregada no contexto.";
    let poolCountUsed = 0;

    if (customerSeemsToBeAskingPools) {
      const { data: pools, error: poolsError } = await supabase
        .from("pools")
        .select(
          "id, name, material, shape, width_m, length_m, depth_m, price, description, photo_url, is_active, track_stock, stock_quantity"
        )
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(3);

      if (poolsError) {
        return {
          ok: false,
          error: "LOAD_POOLS_FAILED",
          message: poolsError.message,
        };
      }

      const usablePools = ((pools || []) as PoolRow[]).filter((pool) => {
        if (pool.track_stock === true) {
          return (pool.stock_quantity || 0) > 0;
        }
        return true;
      });

      poolCountUsed = usablePools.length;

      if (usablePools.length > 0) {
        availablePoolsText = usablePools.map(formatPoolLine).join("\n");
      }
    }

    const systemPrompt = buildSystemPrompt({
      storeDisplayName: onboardingMap.store_display_name || null,
      storeName: store.name,
      leadName: lead.name,
      leadState: lead.state,
      onboardingMap,
      recentHistory,
      availablePoolsText,
      lastCustomerMessage,
    });

    const input = [
      {
        role: "system" as const,
        content: systemPrompt,
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
            content: String(msg.content || "").trim(),
          };
        }),
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

    return {
      ok: true,
      aiText,
      context: {
        leadName: lead.name,
        lastCustomerMessage,
        storeDisplayName: onboardingMap.store_display_name || store.name,
        poolCountUsed,
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      error: "GENERATE_AI_SALES_REPLY_FAILED",
      message: error?.message || "Erro interno ao gerar resposta comercial da IA.",
    };
  }
}