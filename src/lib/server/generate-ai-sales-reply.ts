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

type DetectedIntent =
  | "catalog"
  | "installation"
  | "technical_visit"
  | "price"
  | "payment"
  | "region"
  | "pool_choice"
  | "comparison";

type ResponseMode = "objective" | "consultative";

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
  intents: DetectedIntent[];
  primaryIntent: string;
  mustAnswerFirst: string[];
  knownFacts: string[];
  missingFacts: string[];
  nextBestQuestion: string | null;
  responseGoal: string;
  forbiddenInThisReply: string[];
  responseMode: ResponseMode;
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

const INTENT_RULES: Array<{
  intent: DetectedIntent;
  patterns: RegExp[];
}> = [
  {
    intent: "catalog",
    patterns: [
      /\bcatalogo\b/i,
      /\bcatálogo\b/i,
      /\bfoto\b/i,
      /\bfotos\b/i,
      /\bimagem\b/i,
      /\bimagens\b/i,
      /\bmodelo\b/i,
      /\bmodelos\b/i,
    ],
  },
  {
    intent: "installation",
    patterns: [
      /\binstalacao\b/i,
      /\binstalação\b/i,
      /\binstalar\b/i,
      /\binstala\b/i,
      /\binclui instalacao\b/i,
      /\binclui instalação\b/i,
    ],
  },
  {
    intent: "technical_visit",
    patterns: [
      /\bvisita tecnica\b/i,
      /\bvisita técnica\b/i,
      /\bvisita antes\b/i,
      /\bvem ver o local\b/i,
      /\bver o lugar\b/i,
      /\bavaliar o local\b/i,
      /\bavaliacao no local\b/i,
      /\bavaliação no local\b/i,
      /\bir no local\b/i,
      /\bvisita no local\b/i,
    ],
  },
  {
    intent: "price",
    patterns: [
      /\bpreco\b/i,
      /\bpreço\b/i,
      /\bvalor\b/i,
      /\bquanto custa\b/i,
      /\bcusta\b/i,
      /\borcamento\b/i,
      /\borçamento\b/i,
      /\bfaixa de valor\b/i,
    ],
  },
  {
    intent: "payment",
    patterns: [
      /\bcartao\b/i,
      /\bcartão\b/i,
      /\bcredito\b/i,
      /\bcrédito\b/i,
      /\bdebito\b/i,
      /\bdébito\b/i,
      /\bpix\b/i,
      /\bboleto\b/i,
      /\bparcel/i,
      /\bpagamento\b/i,
      /\bforma de pagamento\b/i,
      /\bformas de pagamento\b/i,
      /\baceita cartao\b/i,
      /\baceita cartão\b/i,
    ],
  },
  {
    intent: "region",
    patterns: [
      /\batende\b/i,
      /\batendem\b/i,
      /\bminha cidade\b/i,
      /\bminha regiao\b/i,
      /\bminha região\b/i,
      /\bfora da regiao\b/i,
      /\bfora da região\b/i,
      /\bdeslocamento\b/i,
      /\bcidade\b/i,
      /\bbairro\b/i,
      /\bregiao\b/i,
      /\bregião\b/i,
    ],
  },
  {
    intent: "pool_choice",
    patterns: [
      /\bpiscina\b/i,
      /\bfibra\b/i,
      /\bvinil\b/i,
      /\balvenaria\b/i,
      /\bpequena\b/i,
      /\bmedia\b/i,
      /\bmédia\b/i,
      /\bgrande\b/i,
      /\bcompacta\b/i,
      /\bretangular\b/i,
      /\bredonda\b/i,
    ],
  },
  {
    intent: "comparison",
    patterns: [
      /\bqual a diferenca\b/i,
      /\bqual a diferença\b/i,
      /\bdiferenca\b/i,
      /\bdiferença\b/i,
      /\bcompar/i,
      /\bmelhor\b/i,
      /\bvale mais a pena\b/i,
    ],
  },
];

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
  if (normalized === "não") return false;
  if (normalized === "nenhum") return false;
  if (normalized === "nenhuma") return false;
  if (normalized === "n/a") return false;

  return true;
}

function includesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function detectIntents(text: string): DetectedIntent[] {
  return INTENT_RULES
    .filter((rule) => includesAnyPattern(text, rule.patterns))
    .map((rule) => rule.intent);
}

function looksLikeCatalogRequest(text: string): boolean {
  return detectIntents(text).includes("catalog");
}

function looksLikeInstallationQuestion(text: string): boolean {
  return detectIntents(text).includes("installation");
}

function looksLikeTechnicalVisitQuestion(text: string): boolean {
  return detectIntents(text).includes("technical_visit");
}

function looksLikePriceQuestion(text: string): boolean {
  return detectIntents(text).includes("price");
}

function looksLikePaymentQuestion(text: string): boolean {
  return detectIntents(text).includes("payment");
}

function looksLikeRegionQuestion(text: string): boolean {
  return detectIntents(text).includes("region");
}

function looksLikePoolChoice(text: string): boolean {
  return detectIntents(text).includes("pool_choice");
}

function looksLikeComparisonQuestion(text: string): boolean {
  return detectIntents(text).includes("comparison");
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
  const intents = detectIntents(lastCustomerMessage);
  if (intents.length > 0) return intents.length;
  return lastCustomerMessage.includes("?") ? 1 : 0;
}

function isObjectiveQuestionMode(lastCustomerMessage: string): boolean {
  const text = normalizeText(lastCustomerMessage);
  const intents = detectIntents(text);
  const hasQuestionMark = lastCustomerMessage.includes("?");
  const asksDirectThing =
    intents.includes("payment") ||
    intents.includes("technical_visit") ||
    intents.includes("installation") ||
    intents.includes("price") ||
    intents.includes("region");

  return text.length <= 220 && hasQuestionMark && (asksDirectThing || intents.length >= 2);
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
    [
      "casos de projeto customizado com ajuda humana",
      onboardingMap.human_help_custom_project_cases,
    ],
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

  return entries.length
    ? entries.join("\n")
    : "- sem dados adicionais do onboarding disponíveis";
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

function inferMustAnswerFirst(intents: DetectedIntent[]): string[] {
  const items: string[] = [];

  if (intents.includes("payment")) {
    items.push("responder claramente sobre cartão/pagamento");
  }
  if (intents.includes("technical_visit")) {
    items.push("responder claramente sobre visita técnica");
  }
  if (intents.includes("installation")) {
    items.push("responder claramente sobre instalação");
  }
  if (intents.includes("price")) {
    items.push("responder claramente sobre preço/faixa de valor");
  }
  if (intents.includes("region")) {
    items.push("responder claramente sobre cidade/região atendida");
  }
  if (intents.includes("catalog") || intents.includes("pool_choice")) {
    items.push("responder com orientação prática sobre modelos/opções");
  }
  if (intents.includes("comparison")) {
    items.push("responder com comparação prática entre as opções");
  }

  return items.length ? items : ["responder diretamente o pedido principal antes de conduzir"];
}

function inferNextBestQuestion(
  facts: ConversationFactState,
  intents: DetectedIntent[],
  lastCustomerMessage: string
): string | null {
  if (
    (intents.includes("catalog") || intents.includes("pool_choice") || intents.includes("comparison")) &&
    !facts.sizeKnown
  ) {
    return "qual espaço ou medida aproximada você tem aí para a piscina?";
  }

  if (
    (intents.includes("installation") || intents.includes("technical_visit") || intents.includes("region")) &&
    !facts.locationKnown
  ) {
    return "qual sua cidade ou bairro?";
  }

  if (intents.includes("price") && !facts.budgetKnown) {
    return "você pensa em uma faixa mais econômica, intermediária ou algo mais premium?";
  }

  if (!facts.timingKnown && looksLikeNeedSignal(lastCustomerMessage)) {
    return "isso é para agora ou você está pesquisando para mais pra frente?";
  }

  return null;
}

function inferResponseGoal(args: {
  intents: DetectedIntent[];
  facts: ConversationFactState;
  nextBestQuestion: string | null;
  responseMode: ResponseMode;
}): string {
  const { intents, facts, nextBestQuestion, responseMode } = args;

  if (responseMode === "objective") {
    return "responder exatamente o que foi perguntado, com clareza, sem excesso de expansão e com no máximo um avanço curto";
  }

  if (intents.includes("catalog") || intents.includes("pool_choice")) {
    if (nextBestQuestion && !facts.sizeKnown) {
      return "responder o pedido de modelos com naturalidade e avançar para descobrir medida/espaço";
    }
    return "responder o pedido de modelos e estreitar a escolha para uma recomendação mais assertiva";
  }

  if (intents.includes("comparison")) {
    return "comparar com clareza e puxar o próximo dado que faltaria para indicar a melhor opção";
  }

  if (intents.includes("price")) {
    return "responder preço sem fugir e, ao mesmo tempo, conduzir para o dado mínimo que permite orientar melhor";
  }

  if (intents.includes("installation")) {
    return "responder instalação com segurança e puxar apenas a informação mínima necessária para avançar";
  }

  if (intents.includes("technical_visit")) {
    return "responder visita técnica de forma objetiva e conduzir para região/disponibilidade";
  }

  if (intents.includes("payment")) {
    return "responder pagamento de forma direta e manter a conversa andando comercialmente";
  }

  return "resolver a dúvida do cliente e gerar um microavanço comercial sem parecer interrogatório";
}

function inferForbiddenInThisReply(args: {
  intents: DetectedIntent[];
  nextBestQuestion: string | null;
  responseMode: ResponseMode;
}): string[] {
  const out: string[] = [
    "não ignorar a pergunta principal do cliente",
    "não fazer mais de uma pergunta se uma só já resolve",
    "não soar como robô, suporte frio ou formulário",
    "não prometer envio de foto/catálogo/arquivo como se já estivesse acontecendo",
    "não despejar lista repetida de modelos sem critério",
  ];

  if (args.intents.includes("price")) {
    out.push("não fugir da pergunta de preço");
  }

  if (args.intents.includes("comparison")) {
    out.push("não responder comparação com texto genérico sem contraste real");
  }

  if (!args.nextBestQuestion) {
    out.push("não inventar pergunta no final só para encerrar com interrogação");
  }

  if (args.responseMode === "objective") {
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
  const intents = detectIntents(args.lastCustomerMessage);
  const responseMode: ResponseMode = isObjectiveQuestionMode(args.lastCustomerMessage)
    ? "objective"
    : "consultative";
  const nextBestQuestion = inferNextBestQuestion(facts, intents, args.lastCustomerMessage);

  return {
    intents,
    primaryIntent: inferPrimaryIntent(args.lastCustomerMessage),
    mustAnswerFirst: inferMustAnswerFirst(intents),
    knownFacts: summarizeKnownFacts(facts, args.lastCustomerMessage),
    missingFacts: summarizeMissingFacts(facts, args.lastCustomerMessage),
    nextBestQuestion,
    responseGoal: inferResponseGoal({
      intents,
      facts,
      nextBestQuestion,
      responseMode,
    }),
    forbiddenInThisReply: inferForbiddenInThisReply({
      intents,
      nextBestQuestion,
      responseMode,
    }),
    responseMode,
  };
}

function buildCommercialObjectiveBlock(objective: CommercialObjective): string {
  const intentsText = objective.intents.length
    ? objective.intents.map((item) => `- ${item}`).join("\n")
    : "- nenhuma intenção secundária relevante detectada";

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
DIAGNÓSTICO COMERCIAL
- intenção principal: ${objective.primaryIntent}
- modo de resposta: ${objective.responseMode}

INTENÇÕES DETECTADAS
${intentsText}

PRECISA RESPONDER PRIMEIRO
${mustAnswerFirstText}

FATOS JÁ CONHECIDOS
${knownFactsText}

O QUE AINDA FALTA, SE FIZER SENTIDO
${missingFactsText}

OBJETIVO DESTA RESPOSTA
- ${objective.responseGoal}

MELHOR PERGUNTA ÚNICA PARA AVANÇAR
- ${objective.nextBestQuestion || "não é obrigatório perguntar nesta resposta"}

BLOQUEIOS DESTA RESPOSTA
${forbiddenText}
`.trim();
}

function buildResponsePriorityBlock(args: {
  intents: DetectedIntent[];
  responseMode: ResponseMode;
}): string {
  const instructions: string[] = [];

  if (args.intents.includes("payment")) {
    instructions.push(
      "- Se o cliente perguntou sobre cartão/pagamento, responda isso logo no começo. Se a pergunta for só sobre cartão, responda cartão primeiro e evite listar todos os meios de pagamento sem necessidade."
    );
  }

  if (args.intents.includes("technical_visit")) {
    instructions.push(
      "- Se o cliente perguntou sobre visita técnica, responda isso logo no começo. Não detalhe taxa, horário, processo completo ou cobertura regional inteira sem necessidade."
    );
  }

  if (args.intents.includes("installation")) {
    instructions.push(
      "- Se o cliente perguntou sobre instalação, responda antes de qualquer pergunta. Não abra o processo inteiro se o cliente não pediu."
    );
  }

  if (args.intents.includes("price")) {
    instructions.push(
      "- Se o cliente perguntou sobre preço, responda de forma útil. Se puder falar faixa, fale. Se não puder cravar ainda, explique em uma frase curta o que falta."
    );
  }

  if (args.intents.includes("region")) {
    instructions.push(
      "- Se o cliente perguntou sobre atendimento por cidade/região, responda isso antes de conduzir. Seja objetiva."
    );
  }

  if (args.intents.includes("catalog") || args.intents.includes("pool_choice")) {
    instructions.push(
      "- Se o cliente falou de modelo/tamanho/tipo de piscina, responda com orientação prática e enxuta."
    );
  }

  if (args.intents.includes("comparison")) {
    instructions.push(
      "- Se o cliente quer comparação, compare de forma prática: quando cada opção faz mais sentido, em vez de lista solta."
    );
  }

  if (!instructions.length) {
    instructions.push("- Responda primeiro o pedido central do cliente com objetividade e só depois conduza.");
  }

  if (args.responseMode === "objective") {
    instructions.push("- Esta mensagem está em MODO OBJETIVO.");
    instructions.push("- Resposta curta: até 3 blocos curtos.");
    instructions.push("- Responda o que foi perguntado e acrescente só o mínimo útil.");
    instructions.push("- Faça no máximo 1 pergunta curta no final, e só se ela realmente ajudar.");
  } else {
    instructions.push("- Se houver mais de uma dúvida, responda todas em blocos curtos antes de conduzir.");
  }

  instructions.push("- Nunca faça pergunta antes de responder o que já dá para responder.");
  instructions.push("- Nunca deixe pergunta explícita sem resposta.");

  return instructions.join("\n");
}

function buildExamplesBlock(args: {
  intents: DetectedIntent[];
  nextBestQuestion: string | null;
}): string {
  const examples: string[] = [];

  if (args.intents.includes("payment") && args.intents.includes("technical_visit")) {
    examples.push(
      `EXEMPLO BOM:
Cliente: "Aceita cartão? E vocês fazem visita técnica?"
Resposta boa: "Sim, aceitamos cartão. E fazemos visita técnica sim, com agendamento. ${args.nextBestQuestion || "Me fala sua cidade ou bairro que eu te oriento certinho."}"`

    );
  }

  if (args.intents.includes("payment") && !args.intents.includes("technical_visit")) {
    examples.push(
      `EXEMPLO BOM:
Cliente: "Aceita cartão?"
Resposta boa: "Sim, aceitamos cartão."`
    );
  }

  if (args.intents.includes("technical_visit") && !args.intents.includes("payment")) {
    examples.push(
      `EXEMPLO BOM:
Cliente: "Vocês fazem visita técnica?"
Resposta boa: "Fazemos sim, com agendamento. ${args.nextBestQuestion || "Me fala sua cidade ou bairro que eu te oriento certinho."}"`
    );
  }

  if (args.intents.includes("price")) {
    examples.push(
      `EXEMPLO BOM:
Cliente: "Qual o valor?"
Resposta boa: "Consigo te orientar sim sobre valor, mas ele varia conforme modelo e instalação. ${args.nextBestQuestion || "Se quiser, me fala o que você procura que eu te direciono melhor."}"`
    );
  }

  examples.push(
    `EXEMPLO RUIM:
"Sim, aceitamos cartão, crédito, débito, pix, boleto, dinheiro e parcelamento. E sim, fazemos visita técnica, desde que agendada antes, com confirmação do endereço e dentro da região de atendimento..."
`
  );

  return examples.join("\n\n");
}

function buildInstructions(args: {
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
  responseMode: ResponseMode;
  intents: DetectedIntent[];
  nextBestQuestion: string | null;
}) {
  const storeLabel = args.storeDisplayName || args.storeName || "a loja";
  const leadLabel = args.leadName || "cliente";
  const operationalBlock = buildOperationalOnboardingBlock(args.onboardingMap);
  const rawOnboardingSummary = buildRawOnboardingSummary(args.onboardingMap);
  const responsePriorityBlock = buildResponsePriorityBlock({
    intents: args.intents,
    responseMode: args.responseMode,
  });
  const examplesBlock = buildExamplesBlock({
    intents: args.intents,
    nextBestQuestion: args.nextBestQuestion,
  });

  return `
Você é a IA comercial real do projeto ZION atendendo a loja ${storeLabel}.
Você está falando com ${leadLabel}.

MISSÃO
Responder como uma vendedora humana de WhatsApp: clara, natural, curta, útil e comercial.
Você deve aplicar SPIN e BANT com leveza, sem parecer interrogatório.

REGRA MÁXIMA
1. Responda primeiro o que o cliente perguntou.
2. Só depois conduza.
3. Se o cliente fez 2 ou mais perguntas, responda todas primeiro.
4. Nunca abra a resposta com pergunta se já dá para responder algo.

TOM
- português do Brasil
- humana, natural, segura, útil
- curta ou média
- sem linguagem burocrática
- sem cara de suporte técnico
- sem cara de formulário
- sem dizer que é IA
- sem falar de processo interno

ESTILO DE WHATSAPP
- responda o principal já na primeira linha ou no primeiro bloco
- prefira frases curtas
- no máximo 1 pergunta ao final na maioria dos casos
- quando a dúvida for simples, seja simples
- não transforme confirmação simples em mini-manual
- não use listas grandes sem necessidade

REGRAS OPERACIONAIS
- use o onboarding como fonte principal de verdade
- não prometa preço, prazo, instalação, visita, desconto, pagamento ou cobertura regional sem base
- se faltar base para cravar algo, responda com cautela comercial em vez de inventar certeza
- se houver regra clara de escalonamento humano, respeite
- não prometa enviar mídia, PDF, catálogo ou fotos como se a entrega já estivesse acontecendo

PRIORIDADE DESTA RESPOSTA
${responsePriorityBlock}

DIAGNÓSTICO
${args.commercialObjectiveBlock}

COMPORTAMENTO OFICIAL DO ZION
${args.behaviorInstructionBlock}

EXEMPLOS DE TOM
${examplesBlock}

BASE OPERACIONAL DA LOJA
${operationalBlock}

RESUMO BRUTO DO ONBOARDING
${rawOnboardingSummary}

ETAPA DO LEAD
- lead_state: ${args.leadState || "desconhecido"}

HISTÓRICO RECENTE
${args.recentHistory || "Sem histórico recente relevante."}

OPÇÕES DE PISCINA DISPONÍVEIS NO CONTEXTO
${args.availablePoolsText || "Nenhuma opção de piscina carregada no contexto."}

SINAIS DO CONTEXTO
- múltiplas intenções na última mensagem: ${args.questionIntentCount >= 2 ? "sim" : "não"}
- pedido de catálogo ou fotos: ${looksLikeCatalogRequest(args.lastCustomerMessage) ? "sim" : "não"}
- pergunta sobre instalação: ${looksLikeInstallationQuestion(args.lastCustomerMessage) ? "sim" : "não"}
- pergunta sobre visita técnica: ${looksLikeTechnicalVisitQuestion(args.lastCustomerMessage) ? "sim" : "não"}
- pergunta sobre preço: ${looksLikePriceQuestion(args.lastCustomerMessage) ? "sim" : "não"}
- pergunta sobre pagamento: ${looksLikePaymentQuestion(args.lastCustomerMessage) ? "sim" : "não"}
- pergunta sobre região: ${looksLikeRegionQuestion(args.lastCustomerMessage) ? "sim" : "não"}
- pedido ligado a tamanho/tipo/modelo: ${looksLikePoolChoice(args.lastCustomerMessage) ? "sim" : "não"}
- pedido de comparação: ${looksLikeComparisonQuestion(args.lastCustomerMessage) ? "sim" : "não"}
- opções de piscina carregadas: ${args.shouldLoadPools ? "sim" : "não"}
- última resposta da IA listou modelos: ${args.lastAiListedPools ? "sim" : "não"}
- modo resposta objetiva: ${args.responseMode === "objective" ? "sim" : "não"}

ÚLTIMA RESPOSTA DA IA
${args.lastAiMessage || "Sem resposta anterior da IA no histórico recente."}

MENSAGEM MAIS RECENTE DO CLIENTE
${args.lastCustomerMessage}

SAÍDA OBRIGATÓRIA
- gere apenas a mensagem final que será enviada ao cliente
- não explique seu raciocínio
- não use markdown pesado
- não use títulos
- não escreva observações para o sistema
- em modo objetivo, mantenha a resposta bem compacta
`.trim();
}

function formatRecentHistory(messages: MessageRow[]): string {
  return messages
    .filter((msg) => String(msg.content || "").trim().length > 0)
    .slice(-8)
    .map((msg) => {
      const sender = normalizeText(msg.sender);
      const direction = normalizeText(msg.direction);

      let label = "Cliente";

      if (sender.includes("ai") || sender.includes("assistant") || sender.includes("bot")) {
        label = "IA";
      } else if (direction === "outgoing") {
        label = "Humano";
      }

      return `${label}: ${String(msg.content || "").trim()}`;
    })
    .join("\n");
}

function detectLastAiMessage(orderedMessages: MessageRow[]): string | null {
  return (
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
      ?.content?.trim() || null
  );
}

function detectLastAiListedPools(lastAiMessage: string | null): boolean {
  if (!lastAiMessage) return false;

  const text = normalizeText(lastAiMessage);

  return (
    text.includes("material") ||
    text.includes("formato") ||
    text.includes("valor de referencia") ||
    text.includes("valor de referência") ||
    text.includes("tamanho aproximado")
  );
}

function cleanupAiText(text: string, responseMode: ResponseMode): string {
  let cleaned = String(text || "").trim();

  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.replace(/[ \t]+\n/g, "\n");
  cleaned = cleaned.replace(/\s{2,}/g, " ");

  const bannedStarts = [
    /^claro[,!\s]*/i,
    /^perfeito[,!\s]*/i,
    /^com certeza[,!\s]*/i,
  ];

  for (const pattern of bannedStarts) {
    cleaned = cleaned.replace(pattern, "");
  }

  if (responseMode === "objective") {
    const paragraphs = cleaned
      .split(/\n{2,}/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (paragraphs.length > 3) {
      cleaned = paragraphs.slice(0, 3).join("\n\n");
    }
  }

  return cleaned.trim();
}

function buildModelInput(messages: MessageRow[]) {
  return messages
    .filter((msg) => String(msg.content || "").trim().length > 0)
    .map((msg) => {
      const sender = normalizeText(msg.sender);
      const direction = normalizeText(msg.direction);

      const role =
        sender.includes("assistant") || sender.includes("ai") || sender.includes("bot")
          ? "assistant"
          : direction === "outgoing"
            ? "assistant"
            : "user";

      return {
        role: role as "user" | "assistant",
        content: String(msg.content || "").trim(),
      };
    });
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
    const model = process.env.ZION_AI_SALES_MODEL || "gpt-4.1-mini";

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
        message: leadError?.message || "Lead não encontrado para a conversa informada.",
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
        message: storeError?.message || "Loja não encontrada para os dados informados.",
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

    const behaviorInstructionBlock = buildBehaviorInstructionBlock(lastCustomerMessage);
    const questionIntentCount = countQuestionIntents(lastCustomerMessage);
    const recentHistory = formatRecentHistory(orderedMessages);
    const lastAiMessage = detectLastAiMessage(orderedMessages);
    const lastAiListedPools = detectLastAiListedPools(lastAiMessage);

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

    const commercialObjectiveBlock = buildCommercialObjectiveBlock(commercialObjective);

    const instructions = buildInstructions({
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
      intents: commercialObjective.intents,
      nextBestQuestion: commercialObjective.nextBestQuestion,
    });

    const input = buildModelInput(orderedMessages);

    const response = await openai.responses.create({
      model,
      instructions,
      input,
      max_output_tokens: commercialObjective.responseMode === "objective" ? 180 : 260,
    });

    const aiText = cleanupAiText(
      String(response.output_text || "").trim(),
      commercialObjective.responseMode
    );

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