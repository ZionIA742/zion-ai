import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { buildBehaviorInstructionBlock } from "./ai-sales-behavior";

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

  if (pool.description) {
    parts.push(`descrição: ${pool.description}`);
  }

  if (pool.photo_url) {
    parts.push(`há imagem principal cadastrada no sistema`);
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
  behaviorInstructionBlock: string;
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
- Soe humana, comercial, natural e segura.
- Respostas curtas ou médias.
- No máximo 1 ou 2 perguntas por resposta.
- Não pareça robô.
- Não fale como suporte técnico.
- Não diga que é IA.
- Não diga que está seguindo framework.
- Não use markdown pesado.
- Não use listas longas no texto final.
- Não explique processo interno.
- Não use frases artificiais, burocráticas ou "certinhas demais".
- Não use frases como "no momento não consigo", "neste momento o fluxo", "posso te mostrar na evolução", "quer que eu faça isso?".
- Não ignore o pedido principal do cliente.
- Não prometa enviar fotos, catálogo, link, arquivo, PDF, mídia ou orçamento se isso não estiver realmente disponível no fluxo atual.
- Se o cliente pedir algo visual e isso não puder ser entregue automaticamente, não transforme a resposta em desculpa técnica.
- Não use frases como "temos fotos bem legais", "te mostro", "te envio", "te mando", "vou separar as fotos", "vou te passar o catálogo" se isso não estiver realmente implementado.
- Não fale de imagem, foto, PDF, catálogo visual ou material como se a entrega já estivesse acontecendo.
- Quando existir contexto visual cadastrado, trate isso apenas como contexto interno para melhorar sua orientação, e não como promessa de entrega imediata ao cliente.
- Fale como alguém vendendo de verdade no WhatsApp.

REGRAS COMERCIAIS DO ZION
- A loja vende piscinas, instalação e itens relacionados.
- A loja não deve prometer estética completa do entorno se isso não fizer parte do escopo confirmado.
- Não invente preço, prazo, estoque ou condição.
- Não invente capacidade operacional que ainda não existe no fluxo.
- Não dê preço seco cedo demais na maioria dos casos.
- Primeiro entenda o contexto mínimo necessário.
- Quando fizer sentido, sugira até 3 opções.
- Se o cliente pedir catálogo de piscina, trate isso como um pedido importante e avance de forma útil.
- Se houver opções de piscinas no contexto, você pode mencionar as opções de forma natural, mas sem parecer que já está entregando mídia ou material visual.
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

ESTILO DE FALA DO ZION
- Fale como vendedor experiente de WhatsApp.
- Menos explicação, mais condução.
- Menos "texto bonito", mais naturalidade.
- Menos justificativa técnica, mais ajuda prática.
- Responda primeiro ao que o cliente pediu e depois conduza.
- Quando o cliente pedir fotos ou catálogo, conduza a escolha em vez de prometer material.

EXEMPLOS DE TOM BOM
- "Perfeito, João. Para eu te direcionar melhor, você está procurando uma piscina menor, média ou maior?"
- "Consigo te ajudar com isso. Seu foco hoje está mais em custo-benefício ou em uma opção mais completa?"
- "Perfeito. Me fala só uma coisa: você já tem o espaço definido ou ainda está começando a ver as opções?"
- "Posso te orientar pelas opções que mais combinam com o que você procura. Você quer algo mais compacto ou uma piscina mais espaçosa?"
- "Entendi. Para não te mostrar coisa fora do que faz sentido, me diz: a prioridade hoje é tamanho, valor ou praticidade na instalação?"
- "Perfeito. Em vez de te jogar um monte de opção, eu prefiro te direcionar melhor. Você quer algo mais econômico, intermediário ou uma opção mais completa?"

EXEMPLOS DE TOM RUIM
- "No momento não consigo enviar fotos diretamente."
- "Esse é o próximo ponto que posso te mostrar."
- "Quer que eu faça isso?"
- "Neste momento o fluxo é apenas em texto."
- "Posso te mostrar na evolução do fluxo."
- "Tenho fotos cadastradas das piscinas que temos."
- "Temos fotos bem legais."
- "Vou te mandar as imagens."
- "Vou te mostrar as fotos agora."

Se a resposta começar a soar como um desses exemplos ruins, reescreva antes de responder.

BLOCO COMPORTAMENTAL OFICIAL DO ZION
${args.behaviorInstructionBlock}

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
Evite resposta com cara de aviso de sistema.
Se o cliente pedir fotos, catálogo visual, PDF ou envio de material, não invente entrega automática e não enfatize a limitação técnica.
Nesses casos, conduza o cliente com algo prático: tamanho, faixa de valor, material, uso principal, instalação ou perfil da piscina.
Prefira terminar com uma condução concreta, como filtrar opções por tamanho, faixa de valor, material ou perfil de uso.
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

    const behaviorInstructionBlock =
      buildBehaviorInstructionBlock(lastCustomerMessage);

    const recentHistory = orderedMessages
      .filter((msg) => String(msg.content || "").trim().length > 0)
      .map((msg) => {
        const sender = String(msg.sender || "").toLowerCase();
        const direction = String(msg.direction || "").toLowerCase();

        let label = "Cliente";
        if (
          sender.includes("ai") ||
          sender.includes("assistant") ||
          sender.includes("bot")
        ) {
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
      behaviorInstructionBlock,
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