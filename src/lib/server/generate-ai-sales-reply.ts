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
        resolvedStoreId: string;
        requestedStoreId: string | null;
      };
    }
  | {
      ok: false;
      error: string;
      message: string;
    };

const ONBOARDING_KEYS = [
  "accepted_payment_methods",
  "ai_can_send_price_directly",
  "ai_should_notify_responsible",
  "average_human_response_time",
  "average_installation_time_days",
  "average_ticket",
  "brands_worked",
  "can_offer_discount",
  "city",
  "commercial_whatsapp",
  "human_help_custom_project_cases",
  "human_help_discount_cases",
  "human_help_payment_cases",
  "important_limitations",
  "installation_available_days",
  "installation_days_rule",
  "installation_process",
  "installation_process_steps",
  "main_store_brand",
  "main_store_differentials",
  "max_discount_percent",
  "offers_installation",
  "offers_technical_visit",
  "pool_types",
  "pool_types_selected",
  "price_direct_conditions",
  "price_direct_rule",
  "price_must_understand_before",
  "price_needs_human_help",
  "price_talk_mode",
  "responsible_name",
  "responsible_notification_cases",
  "responsible_whatsapp",
  "sales_flow_start_steps",
  "sales_flow_middle_steps",
  "sales_flow_final_steps",
  "sells_accessories",
  "sells_chemicals",
  "service_region_modes",
  "service_region_notes",
  "service_region_outside_consultation",
  "service_region_primary_mode",
  "service_regions",
  "state",
  "store_description",
  "store_display_name",
  "store_services",
  "technical_visit_available_days",
  "technical_visit_days_rule",
  "technical_visit_rules",
  "technical_visit_rules_selected",
] as const;

function asText(value: unknown): string | null {
  if (value == null) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

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
        const trimmed = maybeObj.value.trim();
        return trimmed.length ? trimmed : null;
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
    parts.push("há contexto visual interno associado a esse modelo");
  }

  return `- ${parts.join(" | ")}`;
}

function looksLikeCatalogRequest(text: string): boolean {
  return (
    text.includes("catálogo") ||
    text.includes("catalogo") ||
    text.includes("foto") ||
    text.includes("fotos") ||
    text.includes("imagem") ||
    text.includes("imagens") ||
    text.includes("modelo") ||
    text.includes("modelos")
  );
}

function looksLikeInstallationQuestion(text: string): boolean {
  return (
    text.includes("instalação") ||
    text.includes("instalacao") ||
    text.includes("instalar") ||
    text.includes("instala") ||
    text.includes("inclui instalação") ||
    text.includes("inclui instalacao") ||
    text.includes("visita técnica") ||
    text.includes("visita tecnica")
  );
}

function looksLikePriceQuestion(text: string): boolean {
  return (
    text.includes("preço") ||
    text.includes("preco") ||
    text.includes("valor") ||
    text.includes("quanto custa") ||
    text.includes("custa") ||
    text.includes("incluído") ||
    text.includes("incluido") ||
    text.includes("desconto") ||
    text.includes("parcel") ||
    text.includes("pagamento")
  );
}

function countQuestionIntents(lastCustomerMessage: string): number {
  const text = lastCustomerMessage.toLowerCase();

  const intents = [
    looksLikeCatalogRequest(text),
    looksLikeInstallationQuestion(text),
    looksLikePriceQuestion(text),
    text.includes("?"),
  ];

  return intents.filter(Boolean).length;
}

function hasMeaningfulValue(value: string | null | undefined): value is string {
  if (!value) return false;

  const normalized = value.trim().toLowerCase();

  if (!normalized) return false;
  if (normalized === "null") return false;
  if (normalized === "undefined") return false;
  if (normalized === "[]") return false;
  if (normalized === "{}") return false;
  if (normalized === "false") return false;
  if (normalized === "não") return false;
  if (normalized === "nao") return false;
  if (normalized === "nenhum") return false;
  if (normalized === "nenhuma") return false;
  if (normalized === "n/a") return false;

  return true;
}

function formatSection(
  title: string,
  entries: Array<[label: string, value: string | null | undefined]>
): string {
  const lines = entries
    .filter(([, value]) => hasMeaningfulValue(value))
    .map(([label, value]) => `- ${label}: ${value}`);

  if (!lines.length) {
    return `${title}\n- sem dados disponíveis`;
  }

  return `${title}\n${lines.join("\n")}`;
}

function buildOperationalOnboardingBlock(onboardingMap: Record<string, string>): string {
  const overview = formatSection("DADOS GERAIS DA LOJA", [
    ["nome de exibição", onboardingMap.store_display_name],
    ["descrição da loja", onboardingMap.store_description],
    ["cidade", onboardingMap.city],
    ["estado", onboardingMap.state],
    ["marca principal", onboardingMap.main_store_brand],
    ["diferenciais principais", onboardingMap.main_store_differentials],
    ["serviços da loja", onboardingMap.store_services],
    ["tipos de piscina", onboardingMap.pool_types],
    ["tipos de piscina selecionados", onboardingMap.pool_types_selected],
    ["marcas trabalhadas", onboardingMap.brands_worked],
    ["vende acessórios", onboardingMap.sells_accessories],
    ["vende químicos", onboardingMap.sells_chemicals],
  ]);

  const serviceRegion = formatSection("REGIÃO E ATENDIMENTO", [
    ["regiões atendidas", onboardingMap.service_regions],
    ["modo principal de região", onboardingMap.service_region_primary_mode],
    ["modos de atendimento por região", onboardingMap.service_region_modes],
    ["observações de região", onboardingMap.service_region_notes],
    [
      "atendimento fora da região depende de consulta",
      onboardingMap.service_region_outside_consultation,
    ],
  ]);

  const installation = formatSection("INSTALAÇÃO", [
    ["oferece instalação", onboardingMap.offers_installation],
    ["dias disponíveis para instalação", onboardingMap.installation_available_days],
    ["regra dos dias de instalação", onboardingMap.installation_days_rule],
    ["tempo médio de instalação em dias", onboardingMap.average_installation_time_days],
    ["processo de instalação", onboardingMap.installation_process],
    ["etapas do processo de instalação", onboardingMap.installation_process_steps],
  ]);

  const technicalVisit = formatSection("VISITA TÉCNICA", [
    ["oferece visita técnica", onboardingMap.offers_technical_visit],
    ["dias disponíveis para visita técnica", onboardingMap.technical_visit_available_days],
    ["regra dos dias de visita técnica", onboardingMap.technical_visit_days_rule],
    ["regras de visita técnica", onboardingMap.technical_visit_rules],
    ["regras selecionadas de visita técnica", onboardingMap.technical_visit_rules_selected],
  ]);

  const pricingAndPayment = formatSection("PREÇO, PAGAMENTO E DESCONTO", [
    ["ticket médio", onboardingMap.average_ticket],
    ["meios de pagamento aceitos", onboardingMap.accepted_payment_methods],
    ["a IA pode enviar preço direto", onboardingMap.ai_can_send_price_directly],
    ["modo de falar de preço", onboardingMap.price_talk_mode],
    ["regra para preço direto", onboardingMap.price_direct_rule],
    ["condições para passar preço direto", onboardingMap.price_direct_conditions],
    ["o que precisa entender antes de falar preço", onboardingMap.price_must_understand_before],
    ["preço precisa de ajuda humana", onboardingMap.price_needs_human_help],
    ["pode oferecer desconto", onboardingMap.can_offer_discount],
    ["desconto máximo", onboardingMap.max_discount_percent],
  ]);

  const salesFlow = formatSection("FLUXO COMERCIAL", [
    ["passos iniciais", onboardingMap.sales_flow_start_steps],
    ["passos do meio", onboardingMap.sales_flow_middle_steps],
    ["passos finais", onboardingMap.sales_flow_final_steps],
    ["tempo médio de resposta humana", onboardingMap.average_human_response_time],
  ]);

  const humanEscalation = formatSection("QUANDO CHAMAR HUMANO OU RESPONSÁVEL", [
    ["IA deve notificar responsável", onboardingMap.ai_should_notify_responsible],
    ["casos para notificar responsável", onboardingMap.responsible_notification_cases],
    ["nome do responsável", onboardingMap.responsible_name],
    ["whatsapp do responsável", onboardingMap.responsible_whatsapp],
    ["whatsapp comercial", onboardingMap.commercial_whatsapp],
    ["casos de projeto customizado com ajuda humana", onboardingMap.human_help_custom_project_cases],
    ["casos de desconto com ajuda humana", onboardingMap.human_help_discount_cases],
    ["casos de pagamento com ajuda humana", onboardingMap.human_help_payment_cases],
  ]);

  const limitations = formatSection("LIMITAÇÕES E CUIDADOS", [
    ["limitações importantes", onboardingMap.important_limitations],
  ]);

  return [
    overview,
    serviceRegion,
    installation,
    technicalVisit,
    pricingAndPayment,
    salesFlow,
    humanEscalation,
    limitations,
  ].join("\n\n");
}

function buildRawOnboardingSummary(onboardingMap: Record<string, string>): string {
  const entries = Object.entries(onboardingMap)
    .filter(([, value]) => hasMeaningfulValue(value))
    .map(([key, value]) => `- ${key}: ${value}`);

  return entries.length ? entries.join("\n") : "- sem dados adicionais do onboarding disponíveis";
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
  shouldLoadPools: boolean;
  lastAiMessage: string | null;
  lastAiListedPools: boolean;
  questionIntentCount: number;
}) {
  const storeLabel = args.storeDisplayName || args.storeName || "a loja";
  const leadLabel = args.leadName || "cliente";
  const operationalBlock = buildOperationalOnboardingBlock(args.onboardingMap);
  const rawOnboardingSummary = buildRawOnboardingSummary(args.onboardingMap);

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
- Não use listas longas no texto final, exceto quando realmente ajudar muito.
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
- Não invente preço, prazo, estoque, desconto, condição comercial, forma de pagamento ou capacidade operacional.
- Use a base operacional do onboarding como fonte principal de verdade da loja.
- Se houver regra clara no onboarding sobre instalação, visita técnica, desconto, pagamento, região, prazo ou escalonamento, siga essa regra.
- Se faltar confirmação suficiente no onboarding para cravar algo, deixe claro de forma comercial e natural que isso depende de confirmação humana.
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

REGRAS OPERACIONAIS IMPORTANTES
- Quando o cliente perguntar sobre instalação, use primeiro os dados de offers_installation, installation_available_days, installation_days_rule, average_installation_time_days, installation_process e installation_process_steps, se existirem.
- Quando o cliente perguntar sobre visita técnica, use primeiro os dados de offers_technical_visit, technical_visit_available_days, technical_visit_days_rule, technical_visit_rules e technical_visit_rules_selected, se existirem.
- Quando o cliente perguntar sobre preço, pagamento ou desconto, use primeiro ai_can_send_price_directly, price_talk_mode, price_direct_rule, price_direct_conditions, price_must_understand_before, price_needs_human_help, accepted_payment_methods, can_offer_discount e max_discount_percent, se existirem.
- Quando o cliente perguntar sobre atendimento em outra cidade ou região, use primeiro service_regions, service_region_primary_mode, service_region_modes, service_region_notes e service_region_outside_consultation, se existirem.
- Quando um caso exigir humano, use ai_should_notify_responsible, responsible_notification_cases, human_help_custom_project_cases, human_help_discount_cases e human_help_payment_cases como base para decidir.
- Quando houver limitações importantes já registradas, respeite essas limitações e não prometa o que está fora do escopo.
- Nunca trate um campo vazio, ambíguo ou ausente como confirmação operacional.

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

BASE OPERACIONAL E COMERCIAL DA LOJA
${operationalBlock}

RESUMO BRUTO DO ONBOARDING
${rawOnboardingSummary}

ETAPA ATUAL DO LEAD
- lead_state: ${args.leadState || "desconhecido"}

HISTÓRICO RECENTE DA CONVERSA
${args.recentHistory || "Sem histórico recente relevante."}

OPÇÕES DE PISCINAS DISPONÍVEIS NO CONTEXTO
${args.availablePoolsText || "Nenhuma opção de piscina carregada no contexto."}

SINAIS DO CONTEXTO ATUAL
- ultima_mensagem_do_cliente_tem_multiplas_intencoes: ${args.questionIntentCount >= 2 ? "sim" : "não"}
- pedido_de_catalogo_ou_fotos: ${looksLikeCatalogRequest(args.lastCustomerMessage.toLowerCase()) ? "sim" : "não"}
- pergunta_sobre_instalacao: ${looksLikeInstallationQuestion(args.lastCustomerMessage.toLowerCase()) ? "sim" : "não"}
- pergunta_sobre_preco: ${looksLikePriceQuestion(args.lastCustomerMessage.toLowerCase()) ? "sim" : "não"}
- opcoes_de_piscina_carregadas_no_contexto: ${args.shouldLoadPools ? "sim" : "não"}
- ultima_resposta_da_ia_listou_modelos: ${args.lastAiListedPools ? "sim" : "não"}

ÚLTIMA RESPOSTA DA IA
${args.lastAiMessage || "Sem resposta anterior da IA no histórico recente."}

MENSAGEM MAIS RECENTE DO CLIENTE
${args.lastCustomerMessage}

INSTRUÇÃO FINAL
Responda como uma vendedora consultiva real.
Se o cliente pedir algo direto, responda ao pedido e só depois conduza com naturalidade.
Se a mensagem do cliente tiver 2 ou mais perguntas, responda essas perguntas primeiro em blocos curtos e claros.
Evite soar robótica.
Evite responder de forma genérica.
Evite resposta com cara de aviso de sistema.
Se o cliente pedir fotos, catálogo visual, PDF ou envio de material, não invente entrega automática e não enfatize a limitação técnica.
Nesses casos, conduza o cliente com algo prático: tamanho, faixa de valor, material, uso principal, instalação ou perfil da piscina.
Se a resposta anterior da IA já listou modelos, não repita a lista agora a menos que o cliente tenha pedido explicitamente outra comparação.
Se o cliente perguntar sobre instalação e preço junto, responda ambos antes de conduzir.
Se houver valor no contexto, trate como valor de referência.
Se não houver confirmação suficiente sobre inclusão da instalação, prazo, desconto, pagamento, visita técnica ou atendimento fora da região, diga isso de forma comercial e natural, sem parecer evasiva.
Quando as regras do onboarding indicarem necessidade de humano, conduza a conversa para isso de forma natural, sem parecer bloqueio de sistema.
Prefira terminar com uma condução concreta, como filtrar opções por tamanho, faixa de valor, material, perfil de uso, região de atendimento ou próximo passo comercial.
`.trim();
}

export async function generateAiSalesReply(
  params: GenerateAiSalesReplyParams
): Promise<GenerateAiSalesReplyResult> {
  try {
    const organizationId = String(params.organizationId || "").trim();
    const requestedStoreId = String(params.storeId || "").trim();
    const conversationId = String(params.conversationId || "").trim();

    if (!organizationId || !conversationId) {
      return {
        ok: false,
        error: "MISSING_FIELDS",
        message: "Envie organizationId e conversationId.",
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

    if (!conversation.lead_id) {
      return {
        ok: false,
        error: "CONVERSATION_WITHOUT_LEAD",
        message: "A conversa não possui lead vinculada.",
      };
    }

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, organization_id, store_id, name, phone, state")
      .eq("id", conversation.lead_id)
      .eq("organization_id", organizationId)
      .maybeSingle<LeadRow>();

    if (leadError || !lead) {
      return {
        ok: false,
        error: "LEAD_NOT_FOUND",
        message:
          leadError?.message || "Lead não encontrado para a conversa informada.",
      };
    }

    const resolvedStoreId = String(lead.store_id || "").trim();

    if (!resolvedStoreId) {
      return {
        ok: false,
        error: "LEAD_STORE_ID_MISSING",
        message: "store_id não encontrado para este lead.",
      };
    }

    const { data: store, error: storeError } = await supabase
      .from("stores")
      .select("id, organization_id, name")
      .eq("id", resolvedStoreId)
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
      .eq("store_id", resolvedStoreId)
      .in("question_key", [...ONBOARDING_KEYS]);

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
      .limit(12);

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
        )
        ?.content?.trim() || "";

    if (!lastCustomerMessage) {
      return {
        ok: false,
        error: "NO_CUSTOMER_MESSAGE",
        message: "Não encontrei uma mensagem recente do cliente para responder.",
      };
    }

    const behaviorInstructionBlock =
      buildBehaviorInstructionBlock(lastCustomerMessage);

    const lastCustomerMessageNormalized = lastCustomerMessage.toLowerCase();
    const questionIntentCount = countQuestionIntents(lastCustomerMessage);

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

    const lastAiMessage =
      [...orderedMessages]
        .reverse()
        .find((msg) => {
          const sender = String(msg.sender || "").toLowerCase();
          const direction = String(msg.direction || "").toLowerCase();

          return (
            String(msg.content || "").trim().length > 0 &&
            (sender.includes("ai") ||
              sender.includes("assistant") ||
              sender.includes("bot") ||
              direction === "outgoing")
          );
        })
        ?.content?.trim() || null;

    const lastAiListedPools =
      !!lastAiMessage &&
      (lastAiMessage.includes("material") ||
        lastAiMessage.includes("formato") ||
        lastAiMessage.includes("valor de referência") ||
        lastAiMessage.includes("valor de referência:") ||
        lastAiMessage.includes("tamanho aprox.") ||
        lastAiMessage.includes("tamanho aproximado"));

    const customerSeemsToBeAskingPools =
      lastCustomerMessageNormalized.includes("piscina") ||
      lastCustomerMessageNormalized.includes("fibra") ||
      lastCustomerMessageNormalized.includes("vinil") ||
      lastCustomerMessageNormalized.includes("alvenaria") ||
      looksLikeCatalogRequest(lastCustomerMessageNormalized);

    const shouldLoadPools =
      customerSeemsToBeAskingPools &&
      !(lastAiListedPools && questionIntentCount >= 2);

    let availablePoolsText = "Nenhuma opção de piscina carregada no contexto.";
    let poolCountUsed = 0;

    if (shouldLoadPools) {
      const { data: pools, error: poolsError } = await supabase
        .from("pools")
        .select(
          "id, name, material, shape, width_m, length_m, depth_m, price, description, photo_url, is_active, track_stock, stock_quantity"
        )
        .eq("organization_id", organizationId)
        .eq("store_id", resolvedStoreId)
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
      shouldLoadPools,
      lastAiMessage,
      lastAiListedPools,
      questionIntentCount,
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
        resolvedStoreId,
        requestedStoreId: requestedStoreId || null,
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