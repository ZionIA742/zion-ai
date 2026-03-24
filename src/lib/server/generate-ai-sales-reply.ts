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

type ConversationFactState = {
  budgetKnown: boolean;
  authorityKnown: boolean;
  needKnown: boolean;
  timingKnown: boolean;
  locationKnown: boolean;
  sizeKnown: boolean;
  installationInterestKnown: boolean;
  paymentInterestKnown: boolean;
  visitInterestKnown: boolean;
};

type CommercialObjective = {
  primaryIntent: string;
  secondaryIntents: string[];
  mustAnswerFirst: string[];
  knownFacts: string[];
  missingFacts: string[];
  nextBestQuestion: string | null;
  responseGoal: string;
  forbiddenInThisReply: string[];
  responseMode: "objective" | "consultative";
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

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function hasMeaningfulValue(value: string | null | undefined): value is string {
  if (!value) return false;

  const normalized = normalizeText(value);

  if (!normalized) return false;
  if (normalized === "null") return false;
  if (normalized === "undefined") return false;
  if (normalized === "[]") return false;
  if (normalized === "{}") return false;
  if (normalized === "false") return false;
  if (normalized === "nao") return false;
  if (normalized === "nenhum") return false;
  if (normalized === "nenhuma") return false;
  if (normalized === "n/a") return false;

  return true;
}

function looksLikeCatalogRequest(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("catalogo") ||
    t.includes("foto") ||
    t.includes("fotos") ||
    t.includes("imagem") ||
    t.includes("imagens") ||
    t.includes("modelo") ||
    t.includes("modelos")
  );
}

function looksLikeInstallationQuestion(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("instalacao") ||
    t.includes("instalar") ||
    t.includes("instala") ||
    t.includes("inclui instalacao")
  );
}

function looksLikeTechnicalVisitQuestion(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("visita tecnica") ||
    t.includes("visita antes") ||
    t.includes("vem ver o local") ||
    t.includes("ver o lugar") ||
    t.includes("avaliar o local") ||
    t.includes("avaliacao no local") ||
    t.includes("ir no local") ||
    t.includes("visita no local")
  );
}

function looksLikePriceQuestion(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("preco") ||
    t.includes("valor") ||
    t.includes("quanto custa") ||
    t.includes("custa") ||
    t.includes("orcamento") ||
    t.includes("orçamento") ||
    t.includes("faixa de valor")
  );
}

function looksLikePaymentQuestion(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("cartao") ||
    t.includes("cartão") ||
    t.includes("credito") ||
    t.includes("crédito") ||
    t.includes("debito") ||
    t.includes("débito") ||
    t.includes("pix") ||
    t.includes("boleto") ||
    t.includes("parcel") ||
    t.includes("pagamento") ||
    t.includes("forma de pagamento") ||
    t.includes("formas de pagamento") ||
    t.includes("aceita cartao") ||
    t.includes("aceita cartão")
  );
}

function looksLikeRegionQuestion(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("atende") ||
    t.includes("atendem") ||
    t.includes("minha cidade") ||
    t.includes("minha regiao") ||
    t.includes("minha região") ||
    t.includes("fora da regiao") ||
    t.includes("fora da região") ||
    t.includes("deslocamento") ||
    t.includes("cidade") ||
    t.includes("bairro") ||
    t.includes("regiao") ||
    t.includes("região")
  );
}

function looksLikePoolChoice(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("piscina") ||
    t.includes("fibra") ||
    t.includes("vinil") ||
    t.includes("alvenaria") ||
    t.includes("pequena") ||
    t.includes("media") ||
    t.includes("média") ||
    t.includes("grande") ||
    t.includes("compacta") ||
    t.includes("retangular") ||
    t.includes("redonda")
  );
}

function looksLikeComparisonQuestion(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("qual a diferenca") ||
    t.includes("qual a diferença") ||
    t.includes("diferenca") ||
    t.includes("diferença") ||
    t.includes("compar") ||
    t.includes("melhor") ||
    t.includes("vale mais a pena")
  );
}

function looksLikeTimingSignal(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("agora") ||
    t.includes("esse mes") ||
    t.includes("este mes") ||
    t.includes("esse mês") ||
    t.includes("este mês") ||
    t.includes("urgente") ||
    t.includes("pra ja") ||
    t.includes("pra já") ||
    t.includes("para ja") ||
    t.includes("quanto antes") ||
    t.includes("semana que vem") ||
    t.includes("proximo mes") ||
    t.includes("próximo mês")
  );
}

function looksLikeBudgetSignal(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("faixa") ||
    t.includes("orcamento") ||
    t.includes("orçamento") ||
    t.includes("investir") ||
    t.includes("budget") ||
    t.includes("mais barato") ||
    t.includes("mais em conta") ||
    t.includes("economica") ||
    t.includes("econômica")
  );
}

function looksLikeAuthoritySignal(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("meu marido") ||
    t.includes("minha esposa") ||
    t.includes("meu pai") ||
    t.includes("minha mae") ||
    t.includes("minha mãe") ||
    t.includes("vou ver com") ||
    t.includes("vou falar com") ||
    t.includes("decidimos") ||
    t.includes("decidir")
  );
}

function looksLikeNeedSignal(text: string): boolean {
  const t = normalizeText(text);

  return (
    looksLikePoolChoice(t) ||
    looksLikeCatalogRequest(t) ||
    looksLikeInstallationQuestion(t) ||
    t.includes("quero") ||
    t.includes("preciso") ||
    t.includes("estou procurando") ||
    t.includes("to procurando") ||
    t.includes("tô procurando")
  );
}

function countQuestionIntents(lastCustomerMessage: string): number {
  const categories = [
    looksLikeCatalogRequest(lastCustomerMessage),
    looksLikeInstallationQuestion(lastCustomerMessage),
    looksLikeTechnicalVisitQuestion(lastCustomerMessage),
    looksLikePriceQuestion(lastCustomerMessage),
    looksLikePaymentQuestion(lastCustomerMessage),
    looksLikeRegionQuestion(lastCustomerMessage),
    looksLikePoolChoice(lastCustomerMessage),
    looksLikeComparisonQuestion(lastCustomerMessage),
  ];

  const score = categories.filter(Boolean).length;
  if (score > 0) return score;

  return lastCustomerMessage.includes("?") ? 1 : 0;
}

function isObjectiveQuestionMode(lastCustomerMessage: string): boolean {
  const intentCount = countQuestionIntents(lastCustomerMessage);
  const text = normalizeText(lastCustomerMessage);

  const isShortEnough = text.length <= 220;
  const asksDirectThing =
    looksLikePaymentQuestion(text) ||
    looksLikeTechnicalVisitQuestion(text) ||
    looksLikeInstallationQuestion(text) ||
    looksLikePriceQuestion(text) ||
    looksLikeRegionQuestion(text);

  const asksManyDirectThings = intentCount >= 2;
  const hasQuestionMark = lastCustomerMessage.includes("?");

  return isShortEnough && hasQuestionMark && (asksDirectThing || asksManyDirectThings);
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

function buildOperationalOnboardingBlock(
  onboardingMap: Record<string, string>
): string {
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
    [
      "dias disponíveis para instalação",
      onboardingMap.installation_available_days,
    ],
    ["regra dos dias de instalação", onboardingMap.installation_days_rule],
    [
      "tempo médio de instalação em dias",
      onboardingMap.average_installation_time_days,
    ],
    ["processo de instalação", onboardingMap.installation_process],
    [
      "etapas do processo de instalação",
      onboardingMap.installation_process_steps,
    ],
  ]);

  const technicalVisit = formatSection("VISITA TÉCNICA", [
    ["oferece visita técnica", onboardingMap.offers_technical_visit],
    [
      "dias disponíveis para visita técnica",
      onboardingMap.technical_visit_available_days,
    ],
    [
      "regra dos dias de visita técnica",
      onboardingMap.technical_visit_days_rule,
    ],
    ["regras de visita técnica", onboardingMap.technical_visit_rules],
    [
      "regras selecionadas de visita técnica",
      onboardingMap.technical_visit_rules_selected,
    ],
  ]);

  const pricingAndPayment = formatSection("PREÇO, PAGAMENTO E DESCONTO", [
    ["ticket médio", onboardingMap.average_ticket],
    ["meios de pagamento aceitos", onboardingMap.accepted_payment_methods],
    ["a IA pode enviar preço direto", onboardingMap.ai_can_send_price_directly],
    ["modo de falar de preço", onboardingMap.price_talk_mode],
    ["regra para preço direto", onboardingMap.price_direct_rule],
    [
      "condições para passar preço direto",
      onboardingMap.price_direct_conditions,
    ],
    [
      "o que precisa entender antes de falar preço",
      onboardingMap.price_must_understand_before,
    ],
    [
      "preço precisa de ajuda humana",
      onboardingMap.price_needs_human_help,
    ],
    ["pode oferecer desconto", onboardingMap.can_offer_discount],
    ["desconto máximo", onboardingMap.max_discount_percent],
  ]);

  const salesFlow = formatSection("FLUXO COMERCIAL", [
    ["passos iniciais", onboardingMap.sales_flow_start_steps],
    ["passos do meio", onboardingMap.sales_flow_middle_steps],
    ["passos finais", onboardingMap.sales_flow_final_steps],
    [
      "tempo médio de resposta humana",
      onboardingMap.average_human_response_time,
    ],
  ]);

  const humanEscalation = formatSection(
    "QUANDO CHAMAR HUMANO OU RESPONSÁVEL",
    [
      ["IA deve notificar responsável", onboardingMap.ai_should_notify_responsible],
      [
        "casos para notificar responsável",
        onboardingMap.responsible_notification_cases,
      ],
      ["nome do responsável", onboardingMap.responsible_name],
      ["whatsapp do responsável", onboardingMap.responsible_whatsapp],
      ["whatsapp comercial", onboardingMap.commercial_whatsapp],
      [
        "casos de projeto customizado com ajuda humana",
        onboardingMap.human_help_custom_project_cases,
      ],
      [
        "casos de desconto com ajuda humana",
        onboardingMap.human_help_discount_cases,
      ],
      [
        "casos de pagamento com ajuda humana",
        onboardingMap.human_help_payment_cases,
      ],
    ]
  );

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

function buildRawOnboardingSummary(
  onboardingMap: Record<string, string>
): string {
  const entries = Object.entries(onboardingMap)
    .filter(([, value]) => hasMeaningfulValue(value))
    .map(([key, value]) => `- ${key}: ${value}`);

  return entries.length
    ? entries.join("\n")
    : "- sem dados adicionais do onboarding disponíveis";
}

function buildResponsePriorityBlock(args: {
  lastCustomerMessage: string;
  responseMode: "objective" | "consultative";
}) {
  const message = args.lastCustomerMessage;
  const responseMode = args.responseMode;

  const asksPayment = looksLikePaymentQuestion(message);
  const asksVisit = looksLikeTechnicalVisitQuestion(message);
  const asksInstallation = looksLikeInstallationQuestion(message);
  const asksPrice = looksLikePriceQuestion(message);
  const asksRegion = looksLikeRegionQuestion(message);
  const asksCatalog = looksLikeCatalogRequest(message);
  const asksPoolChoice = looksLikePoolChoice(message);
  const asksComparison = looksLikeComparisonQuestion(message);

  const instructions: string[] = [];

  if (asksPayment) {
    instructions.push(
      `- O cliente perguntou sobre pagamento/cartão. Responda isso de forma objetiva logo no começo. Se a pergunta for só sobre cartão, priorize responder cartão e não despeje todos os meios de pagamento sem necessidade. Só amplie se o cliente pedir ou se for indispensável.`
    );
  }

  if (asksVisit) {
    instructions.push(
      `- O cliente perguntou sobre visita técnica. Responda isso de forma objetiva logo no começo. Não traga taxa, horário, regra detalhada, região específica ou processo completo sem necessidade, a menos que isso seja indispensável para não induzir erro.`
    );
  }

  if (asksInstallation) {
    instructions.push(
      `- O cliente perguntou sobre instalação. Responda isso antes de fazer qualquer pergunta. Não abra o processo completo, etapas e prazo inteiro sem o cliente pedir.`
    );
  }

  if (asksPrice) {
    instructions.push(
      `- O cliente perguntou sobre preço/valor. Responda isso de forma útil e comercial. Se puder falar faixa, fale. Se ainda não puder cravar, explique rapidamente o que falta e não ignore a pergunta.`
    );
  }

  if (asksRegion) {
    instructions.push(
      `- O cliente perguntou sobre atendimento por cidade/região. Responda isso antes de conduzir. Seja objetiva. Não detalhe toda a política regional sem necessidade.`
    );
  }

  if (asksCatalog || asksPoolChoice) {
    instructions.push(
      `- O cliente está falando de modelo/tamanho/tipo de piscina. Responda isso de forma prática, sem enrolar, e direcione para opções compatíveis.`
    );
  }

  if (asksComparison) {
    instructions.push(
      `- O cliente quer comparação/diferença. Não responda com lista solta. Compare de forma prática: perfil de uso, espaço, percepção de custo e quando cada opção faz mais sentido.`
    );
  }

  if (instructions.length === 0) {
    instructions.push(
      `- Responda primeiro o pedido central do cliente com objetividade e só depois conduza a conversa.`
    );
  }

  if (responseMode === "objective") {
    instructions.push(`- Esta mensagem deve ser respondida em MODO OBJETIVO.`);
    instructions.push(`- Limite a resposta a 2 ou 3 blocos curtos no máximo.`);
    instructions.push(
      `- Responda exatamente o que foi perguntado e acrescente no máximo 1 complemento útil por assunto.`
    );
    instructions.push(
      `- Não transforme a resposta em explicação longa, mini-manual ou apresentação da loja.`
    );
    instructions.push(
      `- Só faça 1 pergunta curta no final se ela for realmente útil para avançar.`
    );
    instructions.push(
      `- Evite trazer assunto extra que o cliente não pediu, a menos que seja indispensável para não induzir erro.`
    );
  } else {
    instructions.push(
      `- Se houver 2 ou mais intenções na mensagem, responda todas na mesma resposta, em blocos curtos.`
    );
    instructions.push(
      `- Ordem obrigatória: responder -> esclarecer o mínimo necessário -> conduzir.`
    );
  }

  instructions.push(`- Não faça pergunta antes de responder o que o cliente perguntou.`);
  instructions.push(
    `- Evite terminar sem responder algo que o cliente perguntou explicitamente.`
  );

  return instructions.join("\n");
}

function collectConversationFacts(messages: MessageRow[]): ConversationFactState {
  const userTexts = messages
    .filter(
      (msg) =>
        normalizeText(msg.sender) === "user" &&
        normalizeText(msg.direction) === "incoming" &&
        String(msg.content || "").trim().length > 0
    )
    .map((msg) => String(msg.content || "").trim());

  const merged = normalizeText(userTexts.join(" | "));

  const sizeRegex =
    /\b(\d{1,2}(?:[.,]\d{1,2})?)\s?(m|mt|metros?)\b|\b\d{1,2}\s?x\s?\d{1,2}\b/;

  return {
    budgetKnown: looksLikeBudgetSignal(merged),
    authorityKnown: looksLikeAuthoritySignal(merged),
    needKnown: looksLikeNeedSignal(merged),
    timingKnown: looksLikeTimingSignal(merged),
    locationKnown:
      merged.includes("bairro") ||
      merged.includes("cidade") ||
      merged.includes("suzano") ||
      merged.includes("mogi") ||
      merged.includes("sp") ||
      merged.includes("sao paulo") ||
      merged.includes("são paulo"),
    sizeKnown: sizeRegex.test(merged),
    installationInterestKnown: looksLikeInstallationQuestion(merged),
    paymentInterestKnown: looksLikePaymentQuestion(merged),
    visitInterestKnown: looksLikeTechnicalVisitQuestion(merged),
  };
}

function summarizeKnownFacts(
  facts: ConversationFactState,
  lastCustomerMessage: string
): string[] {
  const out: string[] = [];

  if (facts.needKnown) out.push("já existe necessidade/interesse comercial identificado");
  if (facts.budgetKnown) out.push("já existe sinal de orçamento/faixa de investimento");
  if (facts.authorityKnown) out.push("já existe sinal de decisão compartilhada ou autoridade");
  if (facts.timingKnown) out.push("já existe sinal de timing");
  if (facts.locationKnown) out.push("já existe sinal de cidade/região");
  if (facts.sizeKnown) out.push("já existe sinal de medida/tamanho");
  if (facts.installationInterestKnown) out.push("já existe interesse em instalação");
  if (facts.paymentInterestKnown) out.push("já existe interesse em pagamento");
  if (facts.visitInterestKnown) out.push("já existe interesse em visita técnica");

  if (looksLikeCatalogRequest(lastCustomerMessage)) {
    out.push("o cliente demonstra interesse em ver modelos/fotos/catálogo");
  }

  if (looksLikeComparisonQuestion(lastCustomerMessage)) {
    out.push("o cliente quer comparação entre opções");
  }

  return out.length ? out : ["quase nenhum fato comercial estruturado foi confirmado ainda"];
}

function summarizeMissingFacts(
  facts: ConversationFactState,
  lastCustomerMessage: string
): string[] {
  const out: string[] = [];

  if (!facts.sizeKnown && looksLikePoolChoice(lastCustomerMessage)) {
    out.push("medida ou espaço disponível");
  }

  if (
    !facts.locationKnown &&
    (looksLikeInstallationQuestion(lastCustomerMessage) ||
      looksLikeTechnicalVisitQuestion(lastCustomerMessage) ||
      looksLikeRegionQuestion(lastCustomerMessage))
  ) {
    out.push("cidade/bairro/região do atendimento");
  }

  if (!facts.budgetKnown && (looksLikePriceQuestion(lastCustomerMessage) || looksLikePoolChoice(lastCustomerMessage))) {
    out.push("faixa de investimento");
  }

  if (!facts.timingKnown && looksLikeNeedSignal(lastCustomerMessage)) {
    out.push("timing da decisão/compra");
  }

  if (!facts.authorityKnown && looksLikePriceQuestion(lastCustomerMessage)) {
    out.push("se decide sozinho ou com outra pessoa");
  }

  return out;
}

function inferPrimaryIntent(lastCustomerMessage: string): string {
  if (looksLikeComparisonQuestion(lastCustomerMessage)) {
    return "comparar opções e orientar escolha";
  }

  if (looksLikeCatalogRequest(lastCustomerMessage)) {
    return "pedir modelos/fotos/catálogo";
  }

  if (looksLikePriceQuestion(lastCustomerMessage)) {
    return "entender preço/valor";
  }

  if (looksLikeInstallationQuestion(lastCustomerMessage)) {
    return "entender instalação";
  }

  if (looksLikeTechnicalVisitQuestion(lastCustomerMessage)) {
    return "entender visita técnica";
  }

  if (looksLikePaymentQuestion(lastCustomerMessage)) {
    return "entender pagamento";
  }

  if (looksLikeRegionQuestion(lastCustomerMessage)) {
    return "entender atendimento por região";
  }

  if (looksLikePoolChoice(lastCustomerMessage)) {
    return "escolher modelo/tamanho/tipo de piscina";
  }

  return "avançar a conversa comercial com resposta útil e natural";
}

function inferSecondaryIntents(lastCustomerMessage: string): string[] {
  const intents: string[] = [];

  if (looksLikeCatalogRequest(lastCustomerMessage)) {
    intents.push("catálogo/modelos");
  }
  if (looksLikePriceQuestion(lastCustomerMessage)) {
    intents.push("preço");
  }
  if (looksLikeInstallationQuestion(lastCustomerMessage)) {
    intents.push("instalação");
  }
  if (looksLikeTechnicalVisitQuestion(lastCustomerMessage)) {
    intents.push("visita técnica");
  }
  if (looksLikePaymentQuestion(lastCustomerMessage)) {
    intents.push("pagamento");
  }
  if (looksLikeRegionQuestion(lastCustomerMessage)) {
    intents.push("região");
  }
  if (looksLikePoolChoice(lastCustomerMessage)) {
    intents.push("tipo/tamanho/modelo");
  }
  if (looksLikeComparisonQuestion(lastCustomerMessage)) {
    intents.push("comparação");
  }

  return Array.from(new Set(intents));
}

function inferMustAnswerFirst(lastCustomerMessage: string): string[] {
  const items: string[] = [];

  if (looksLikePaymentQuestion(lastCustomerMessage)) {
    items.push("responder claramente sobre cartão/pagamento");
  }
  if (looksLikeTechnicalVisitQuestion(lastCustomerMessage)) {
    items.push("responder claramente sobre visita técnica");
  }
  if (looksLikeInstallationQuestion(lastCustomerMessage)) {
    items.push("responder claramente sobre instalação");
  }
  if (looksLikePriceQuestion(lastCustomerMessage)) {
    items.push("responder claramente sobre preço/faixa de valor");
  }
  if (looksLikeRegionQuestion(lastCustomerMessage)) {
    items.push("responder claramente sobre cidade/região atendida");
  }
  if (looksLikeCatalogRequest(lastCustomerMessage) || looksLikePoolChoice(lastCustomerMessage)) {
    items.push("responder com orientação prática sobre modelos/opções");
  }
  if (looksLikeComparisonQuestion(lastCustomerMessage)) {
    items.push("responder com comparação prática entre as opções");
  }

  return items.length
    ? items
    : ["responder diretamente o pedido principal antes de conduzir"];
}

function inferNextBestQuestion(
  facts: ConversationFactState,
  lastCustomerMessage: string
): string | null {
  if (
    (looksLikeCatalogRequest(lastCustomerMessage) ||
      looksLikePoolChoice(lastCustomerMessage) ||
      looksLikeComparisonQuestion(lastCustomerMessage)) &&
    !facts.sizeKnown
  ) {
    return "qual espaço ou medida aproximada você tem aí para a piscina?";
  }

  if (
    (looksLikeInstallationQuestion(lastCustomerMessage) ||
      looksLikeTechnicalVisitQuestion(lastCustomerMessage) ||
      looksLikeRegionQuestion(lastCustomerMessage)) &&
    !facts.locationKnown
  ) {
    return "qual sua cidade ou bairro?";
  }

  if (looksLikePriceQuestion(lastCustomerMessage) && !facts.budgetKnown) {
    return "você pensa em uma faixa mais econômica, intermediária ou algo mais premium?";
  }

  if (!facts.timingKnown && looksLikeNeedSignal(lastCustomerMessage)) {
    return "isso é para agora ou você está pesquisando para mais pra frente?";
  }

  return null;
}

function inferResponseGoal(args: {
  lastCustomerMessage: string;
  facts: ConversationFactState;
  nextBestQuestion: string | null;
  responseMode: "objective" | "consultative";
}): string {
  const { lastCustomerMessage, facts, nextBestQuestion, responseMode } = args;

  if (responseMode === "objective") {
    return "responder exatamente o que foi perguntado, com clareza, sem excesso de expansão e com no máximo um avanço curto";
  }

  if (looksLikeCatalogRequest(lastCustomerMessage) || looksLikePoolChoice(lastCustomerMessage)) {
    if (nextBestQuestion && !facts.sizeKnown) {
      return "responder o pedido de modelos com naturalidade e avançar para descobrir medida/espaço";
    }

    return "responder o pedido de modelos e estreitar a escolha para uma recomendação mais assertiva";
  }

  if (looksLikeComparisonQuestion(lastCustomerMessage)) {
    return "comparar com clareza e puxar o próximo dado que faltaria para indicar a melhor opção";
  }

  if (looksLikePriceQuestion(lastCustomerMessage)) {
    return "responder preço sem fugir e, ao mesmo tempo, conduzir para o dado mínimo que permite orientar melhor";
  }

  if (looksLikeInstallationQuestion(lastCustomerMessage)) {
    return "responder instalação com segurança e puxar apenas a informação mínima necessária para avançar";
  }

  if (looksLikeTechnicalVisitQuestion(lastCustomerMessage)) {
    return "responder visita técnica de forma objetiva e conduzir para região/disponibilidade";
  }

  if (looksLikePaymentQuestion(lastCustomerMessage)) {
    return "responder pagamento de forma direta e manter a conversa andando comercialmente";
  }

  return "resolver a dúvida do cliente e gerar um microavanço comercial sem parecer interrogatório";
}

function inferForbiddenInThisReply(
  lastCustomerMessage: string,
  nextBestQuestion: string | null,
  responseMode: "objective" | "consultative"
): string[] {
  const out: string[] = [
    "não ignorar a pergunta principal do cliente",
    "não fazer mais de uma pergunta se uma só já resolve",
    "não soar como robô, suporte frio ou formulário",
    "não prometer envio de foto/catálogo/arquivo como se já estivesse acontecendo",
    "não despejar lista repetida de modelos sem critério",
  ];

  if (looksLikePriceQuestion(lastCustomerMessage)) {
    out.push("não fugir da pergunta de preço");
  }

  if (looksLikeComparisonQuestion(lastCustomerMessage)) {
    out.push("não responder comparação com texto genérico sem contraste real");
  }

  if (!nextBestQuestion) {
    out.push("não inventar pergunta no final só para encerrar com interrogação");
  }

  if (responseMode === "objective") {
    out.push("não abrir explicação longa além do que o cliente perguntou");
    out.push("não adicionar vários assuntos extras na mesma resposta");
    out.push("não transformar a resposta em apresentação completa da operação");
    out.push("não listar todos os detalhes operacionais quando bastar uma confirmação objetiva");
  }

  return out;
}

function buildCommercialObjective(args: {
  orderedMessages: MessageRow[];
  lastCustomerMessage: string;
}): CommercialObjective {
  const facts = collectConversationFacts(args.orderedMessages);
  const responseMode: "objective" | "consultative" = isObjectiveQuestionMode(
    args.lastCustomerMessage
  )
    ? "objective"
    : "consultative";
  const nextBestQuestion = inferNextBestQuestion(facts, args.lastCustomerMessage);

  return {
    primaryIntent: inferPrimaryIntent(args.lastCustomerMessage),
    secondaryIntents: inferSecondaryIntents(args.lastCustomerMessage),
    mustAnswerFirst: inferMustAnswerFirst(args.lastCustomerMessage),
    knownFacts: summarizeKnownFacts(facts, args.lastCustomerMessage),
    missingFacts: summarizeMissingFacts(facts, args.lastCustomerMessage),
    nextBestQuestion,
    responseGoal: inferResponseGoal({
      lastCustomerMessage: args.lastCustomerMessage,
      facts,
      nextBestQuestion,
      responseMode,
    }),
    forbiddenInThisReply: inferForbiddenInThisReply(
      args.lastCustomerMessage,
      nextBestQuestion,
      responseMode
    ),
    responseMode,
  };
}

function buildCommercialObjectiveBlock(objective: CommercialObjective): string {
  const secondaryIntentsText = objective.secondaryIntents.length
    ? objective.secondaryIntents.map((item) => `- ${item}`).join("\n")
    : "- nenhuma secundária relevante detectada";

  const mustAnswerFirstText = objective.mustAnswerFirst.length
    ? objective.mustAnswerFirst.map((item) => `- ${item}`).join("\n")
    : "- responder diretamente o pedido principal do cliente";

  const knownFactsText = objective.knownFacts.length
    ? objective.knownFacts.map((item) => `- ${item}`).join("\n")
    : "- ainda há poucos fatos consolidados";

  const missingFactsText = objective.missingFacts.length
    ? objective.missingFacts.map((item) => `- ${item}`).join("\n")
    : "- nenhum dado crítico faltando para esta resposta";

  const forbiddenText = objective.forbiddenInThisReply.length
    ? objective.forbiddenInThisReply.map((item) => `- ${item}`).join("\n")
    : "- sem bloqueios adicionais";

  return `
DIAGNÓSTICO COMERCIAL E OBJETIVO DESTA RESPOSTA
- intenção principal: ${objective.primaryIntent}
- modo de resposta: ${objective.responseMode}

INTENÇÕES SECUNDÁRIAS
${secondaryIntentsText}

O QUE PRECISA SER RESPONDIDO PRIMEIRO NESTA MENSAGEM
${mustAnswerFirstText}

O QUE JÁ SABEMOS DA CONVERSA
${knownFactsText}

O QUE AINDA FALTA DESCOBRIR, SE FIZER SENTIDO NESTA RESPOSTA
${missingFactsText}

OBJETIVO ÚNICO DESTA RESPOSTA
- ${objective.responseGoal}

MELHOR PERGUNTA ÚNICA PARA AVANÇAR, SE REALMENTE PRECISAR PERGUNTAR
- ${objective.nextBestQuestion || "não é obrigatório perguntar nesta resposta"}

BLOQUEIOS EXPLÍCITOS PARA ESTA RESPOSTA
${forbiddenText}
`.trim();
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
  commercialObjectiveBlock: string;
  shouldLoadPools: boolean;
  lastAiMessage: string | null;
  lastAiListedPools: boolean;
  questionIntentCount: number;
  responseMode: "objective" | "consultative";
}) {
  const storeLabel = args.storeDisplayName || args.storeName || "a loja";
  const leadLabel = args.leadName || "cliente";
  const operationalBlock = buildOperationalOnboardingBlock(args.onboardingMap);
  const rawOnboardingSummary = buildRawOnboardingSummary(args.onboardingMap);
  const responsePriorityBlock = buildResponsePriorityBlock({
    lastCustomerMessage: args.lastCustomerMessage,
    responseMode: args.responseMode,
  });

  return `
Você é a IA comercial real do projeto ZION, atendendo a loja ${storeLabel}.
Você está falando com o lead ${leadLabel}.

OBJETIVO
Seu papel é agir como uma vendedora consultiva, humana, natural e comercial para lojas de piscina.
Você deve aplicar SPIN Selling e BANT de forma natural, sem parecer interrogatório.

REGRA MAIS IMPORTANTE DESTA RESPOSTA
- Primeiro responda objetivamente o que o cliente perguntou.
- Só depois conduza a conversa.
- Se o cliente fez 2 ou mais perguntas na mesma mensagem, responda as 2 ou mais primeiro.
- Nunca deixe pergunta objetiva sem resposta.

REGRAS CENTRAIS
- Fale em português do Brasil.
- Soe humana, comercial, natural e segura.
- Respostas curtas ou médias.
- No máximo 1 pergunta no final da resposta na maioria dos casos.
- Não pareça robô.
- Não fale como suporte técnico.
- Não diga que é IA.
- Não diga que está seguindo framework.
- Não use markdown pesado.
- Não explique processo interno.
- Não use frases artificiais, burocráticas ou certinhas demais.
- Não ignore o pedido principal do cliente.
- Não prometa preço, prazo, estoque, desconto, visita, instalação, pagamento ou cobertura regional sem base.
- Não prometa enviar fotos, catálogo, link, arquivo, PDF, mídia ou orçamento se isso não estiver realmente disponível no fluxo atual.
- Se o cliente pedir algo visual e isso não puder ser entregue automaticamente, não transforme a resposta em desculpa técnica.
- Não fale de imagem, foto, PDF, catálogo visual ou material como se a entrega já estivesse acontecendo.
- Quando existir contexto visual cadastrado, trate isso apenas como contexto interno para melhorar a orientação, e não como promessa de entrega imediata.
- Fale como alguém vendendo de verdade no WhatsApp.
- Quando uma informação operacional não estiver claramente sustentada, prefira resposta comercial cautelosa em vez de certeza excessiva.
- Não seja mais específica do que o necessário quando o cliente fez pergunta simples e objetiva.

COMPORTAMENTO OBRIGATÓRIO NESTA RESPOSTA
${responsePriorityBlock}

CAMADA ESTRUTURADA DE OBJETIVO COMERCIAL
${args.commercialObjectiveBlock}

REGRAS COMERCIAIS DO ZION
- A loja vende piscinas, instalação e itens relacionados.
- A loja não deve prometer estética completa do entorno se isso não fizer parte do escopo confirmado.
- Use a base operacional do onboarding como fonte principal de verdade da loja.
- Se houver regra clara no onboarding sobre instalação, visita técnica, desconto, pagamento, região, prazo ou escalonamento, siga essa regra.
- Se faltar confirmação suficiente no onboarding para cravar algo, deixe claro de forma comercial e natural que isso depende de confirmação humana.
- Não dê preço seco cedo demais na maioria dos casos, mas também não ignore quando o cliente perguntar.
- Quando fizer sentido, sugira até 3 opções.
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
- Menos explicação, mais resposta útil.
- Menos rodeio, mais objetividade.
- Menos justificativa técnica, mais ajuda prática.
- Responda primeiro ao que o cliente pediu e depois conduza.
- Quando o cliente pedir fotos ou catálogo, conduza a escolha em vez de prometer material.
- Em mensagens objetivas, seja ainda mais enxuta: responda o que foi perguntado, acrescente pouco e avance com leveza.

REGRAS OPERACIONAIS IMPORTANTES
- Quando o cliente perguntar sobre instalação, use primeiro os dados de offers_installation, installation_available_days, installation_days_rule, average_installation_time_days, installation_process e installation_process_steps, se existirem.
- Quando o cliente perguntar sobre visita técnica, use primeiro os dados de offers_technical_visit, technical_visit_available_days, technical_visit_days_rule, technical_visit_rules e technical_visit_rules_selected, se existirem.
- Quando o cliente perguntar sobre preço, pagamento ou desconto, use primeiro ai_can_send_price_directly, price_talk_mode, price_direct_rule, price_direct_conditions, price_must_understand_before, price_needs_human_help, accepted_payment_methods, can_offer_discount e max_discount_percent, se existirem.
- Quando o cliente perguntar sobre atendimento em outra cidade ou região, use primeiro service_regions, service_region_primary_mode, service_region_modes, service_region_notes e service_region_outside_consultation, se existirem.
- Quando um caso exigir humano, use ai_should_notify_responsible, responsible_notification_cases, human_help_custom_project_cases, human_help_discount_cases e human_help_payment_cases como base para decidir.
- Quando houver limitações importantes já registradas, respeite essas limitações e não prometa o que está fora do escopo.
- Nunca trate um campo vazio, ambíguo ou ausente como confirmação operacional.
- Em perguntas simples sobre cartão, visita, instalação, região ou preço, confirme o essencial primeiro. Só detalhe o resto se o cliente pedir ou se for indispensável para não induzir erro.
- Não liste todos os meios de pagamento quando bastar responder sobre cartão.
- Não cite taxa, horário, prazo, etapa, deslocamento ou cobertura detalhada sem necessidade real da resposta.

EXEMPLOS DE TOM BOM
- "Sim, trabalhamos com cartão. E sobre a visita, fazemos sim, só preciso confirmar sua região para te orientar certinho."
- "Fazemos sim a instalação. O valor pode variar conforme o local e o preparo necessário, então eu te explico isso sem problema."
- "Sobre cartão, aceitamos sim. Sobre piscina pequena, consigo te direcionar para opções mais compactas e práticas."
- "Fazemos visita técnica, sim. Para te falar com mais segurança, me passa sua cidade ou bairro."

EXEMPLOS DE TOM RUIM
- "No momento não consigo enviar fotos diretamente."
- "Esse é o próximo ponto que posso te mostrar."
- "Quer que eu faça isso?"
- "Neste momento o fluxo é apenas em texto."
- "Posso te mostrar na evolução do fluxo."
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
- pedido_de_catalogo_ou_fotos: ${looksLikeCatalogRequest(args.lastCustomerMessage) ? "sim" : "não"}
- pergunta_sobre_instalacao: ${looksLikeInstallationQuestion(args.lastCustomerMessage) ? "sim" : "não"}
- pergunta_sobre_visita_tecnica: ${looksLikeTechnicalVisitQuestion(args.lastCustomerMessage) ? "sim" : "não"}
- pergunta_sobre_preco: ${looksLikePriceQuestion(args.lastCustomerMessage) ? "sim" : "não"}
- pergunta_sobre_pagamento: ${looksLikePaymentQuestion(args.lastCustomerMessage) ? "sim" : "não"}
- pergunta_sobre_regiao: ${looksLikeRegionQuestion(args.lastCustomerMessage) ? "sim" : "não"}
- pedido_ligado_a_tamanho_tipo_modelo: ${looksLikePoolChoice(args.lastCustomerMessage) ? "sim" : "não"}
- pedido_de_comparacao: ${looksLikeComparisonQuestion(args.lastCustomerMessage) ? "sim" : "não"}
- opcoes_de_piscina_carregadas_no_contexto: ${args.shouldLoadPools ? "sim" : "não"}
- ultima_resposta_da_ia_listou_modelos: ${args.lastAiListedPools ? "sim" : "não"}
- modo_resposta_objetiva: ${args.responseMode === "objective" ? "sim" : "não"}

ÚLTIMA RESPOSTA DA IA
${args.lastAiMessage || "Sem resposta anterior da IA no histórico recente."}

MENSAGEM MAIS RECENTE DO CLIENTE
${args.lastCustomerMessage}

FORMATO OBRIGATÓRIO DE EXECUÇÃO
- Linha 1: responda diretamente o principal.
- Linha 2 em diante: responda os outros pontos que o cliente perguntou, se houver.
- Só depois disso faça, no máximo, 1 pergunta útil para avançar.
- Se o cliente perguntou sobre cartão, visita, instalação, preço ou região, essas respostas devem aparecer claramente no texto.
- Não fuja da pergunta.
- Não comece pedindo informação sem antes responder o que já dá para responder.

FORMATO EXTRA PARA MODO OBJETIVO
- Quando "modo_resposta_objetiva: sim", responda em 2 ou 3 blocos curtos.
- Não acrescente detalhes operacionais extras se o cliente não pediu.
- Não cite prazo, taxa, processo, horário, etapas ou regras adicionais sem necessidade real para essa resposta.
- Se a pergunta for só sobre cartão, basta responder cartão, sem listar todos os meios de pagamento.
- Se a pergunta for só sobre visita técnica, basta confirmar se faz e o mínimo necessário para avançar.
- Responda as perguntas principais e avance com leveza.
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
            normalizeText(msg.sender) === "user" &&
            normalizeText(msg.direction) === "incoming" &&
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

    const questionIntentCount = countQuestionIntents(lastCustomerMessage);

    const recentHistory = orderedMessages
      .filter((msg) => String(msg.content || "").trim().length > 0)
      .map((msg) => {
        const sender = normalizeText(msg.sender);
        const direction = normalizeText(msg.direction);

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
          const sender = normalizeText(msg.sender);
          const direction = normalizeText(msg.direction);

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
      (normalizeText(lastAiMessage).includes("material") ||
        normalizeText(lastAiMessage).includes("formato") ||
        normalizeText(lastAiMessage).includes("valor de referencia") ||
        normalizeText(lastAiMessage).includes("tamanho aproximado"));

    const customerSeemsToBeAskingPools =
      looksLikePoolChoice(lastCustomerMessage) ||
      looksLikeCatalogRequest(lastCustomerMessage) ||
      looksLikeComparisonQuestion(lastCustomerMessage);

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

    const commercialObjective = buildCommercialObjective({
      orderedMessages,
      lastCustomerMessage,
    });

    const commercialObjectiveBlock =
      buildCommercialObjectiveBlock(commercialObjective);

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
      commercialObjectiveBlock,
      shouldLoadPools,
      lastAiMessage,
      lastAiListedPools,
      questionIntentCount,
      responseMode: commercialObjective.responseMode,
    });

    const input = [
      {
        role: "system" as const,
        content: systemPrompt,
      },
      ...orderedMessages
        .filter((msg) => String(msg.content || "").trim().length > 0)
        .map((msg) => {
          const sender = normalizeText(msg.sender);
          const direction = normalizeText(msg.direction);

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