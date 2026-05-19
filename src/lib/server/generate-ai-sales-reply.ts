import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { isSellableInventoryState } from "../catalog/availability";
import { buildBehaviorInstructionBlock } from "./ai-sales-behavior";
import { buildSalesMethodologyInstructionBlock } from "./ai-sales-methodology";

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

type CatalogItemRow = {
  id: string;
  organization_id: string;
  store_id: string;
  sku: string | null;
  name: string | null;
  description: string | null;
  price_cents: number | null;
  currency: string | null;
  is_active: boolean | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
  track_stock: boolean | null;
  stock_quantity: number | null;
};

type CatalogItemPhotoRow = {
  id: string;
  catalog_item_id: string;
  storage_path: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  sort_order: number | null;
  created_at: string | null;
};

type PoolPhotoRow = {
  id: string;
  pool_id: string;
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

type CustomerPatienceStatus =
  | "active_interest"
  | "thinking"
  | "follow_up_requested"
  | "not_interested"
  | "unclear_pause";

type CustomerPatienceSignal = {
  status: CustomerPatienceStatus;
  summary: string;
  followUpTiming: string | null;
  shouldAvoidNewQuestion: boolean;
  shouldCloseSoftly: boolean;
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
  intents: DetectedIntent[];
  primaryIntent: string;
  mustAnswerFirst: string[];
  knownFacts: string[];
  missingFacts: string[];
  nextBestQuestion: string | null;
  responseGoal: string;
  forbiddenInThisReply: string[];
  responseMode: ResponseMode;
  patienceSignal: CustomerPatienceSignal;
};

type CatalogIntentAnalysis = {
  asksAboutCatalogProduct: boolean;
  asksAboutPool: boolean;
  asksForPhoto: boolean;
  asksForPrice: boolean;
  asksForAvailability: boolean;
  asksForBrand: boolean;
  requestedBrand: string | null;
  requestedProductTerm: string | null;
};

type MatchedCatalogItem = {
  item: CatalogItemRow;
  photos: CatalogItemPhotoRow[];
  score: number;
};

type MatchedPool = {
  pool: PoolRow;
  hasPhoto: boolean;
  score: number;
};

export type GenerateAiSalesReplyParams = {
  organizationId: string;
  storeId: string;
  conversationId: string;
};

export type GenerateAiSalesReplyUsage = {
  provider: "openai";
  model: string;
  tokensPrompt: number | null;
  tokensCompletion: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  inputTokenPriceUsdPer1M: number | null;
  outputTokenPriceUsdPer1M: number | null;
  pricingSource: string;
};

export type GenerateAiSalesReplyResult =
  | {
      ok: true;
      aiText: string;
      usage: GenerateAiSalesReplyUsage;
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

type OpenAiModelPricing = {
  inputUsdPer1M: number;
  outputUsdPer1M: number;
};

/**
 * Tabela local de precificação usada apenas para registrar custo aproximado no ZION.
 * Antes de vender em produção, revise estes valores na página oficial de pricing da OpenAI.
 */
const OPENAI_MODEL_PRICING_USD_PER_1M: Record<string, OpenAiModelPricing> = {
  "gpt-4o-mini": {
    inputUsdPer1M: 0.15,
    outputUsdPer1M: 0.6,
  },
  "gpt-4.1-mini": {
    inputUsdPer1M: 0.4,
    outputUsdPer1M: 1.6,
  },
  "gpt-5": {
    inputUsdPer1M: 1.25,
    outputUsdPer1M: 10,
  },
  "gpt-5-mini": {
    inputUsdPer1M: 0.25,
    outputUsdPer1M: 2,
  },
  "gpt-5-nano": {
    inputUsdPer1M: 0.05,
    outputUsdPer1M: 0.4,
  },
};

function normalizeModelForPricing(model: string): string {
  const normalized = String(model || "").trim().toLowerCase();

  if (normalized.startsWith("gpt-4o-mini")) return "gpt-4o-mini";
  if (normalized.startsWith("gpt-4.1-mini")) return "gpt-4.1-mini";
  if (normalized.startsWith("gpt-5-mini")) return "gpt-5-mini";
  if (normalized.startsWith("gpt-5-nano")) return "gpt-5-nano";
  if (normalized.startsWith("gpt-5")) return "gpt-5";

  return normalized;
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function calculateOpenAiCostUsd(args: {
  model: string;
  tokensPrompt: number | null;
  tokensCompletion: number | null;
}): {
  costUsd: number | null;
  inputTokenPriceUsdPer1M: number | null;
  outputTokenPriceUsdPer1M: number | null;
  pricingSource: string;
} {
  const pricingKey = normalizeModelForPricing(args.model);
  const pricing = OPENAI_MODEL_PRICING_USD_PER_1M[pricingKey] || null;

  if (!pricing) {
    return {
      costUsd: null,
      inputTokenPriceUsdPer1M: null,
      outputTokenPriceUsdPer1M: null,
      pricingSource: "model_not_in_local_pricing_table",
    };
  }

  if (args.tokensPrompt == null || args.tokensCompletion == null) {
    return {
      costUsd: null,
      inputTokenPriceUsdPer1M: pricing.inputUsdPer1M,
      outputTokenPriceUsdPer1M: pricing.outputUsdPer1M,
      pricingSource: "missing_usage_tokens",
    };
  }

  const inputCost = (args.tokensPrompt / 1_000_000) * pricing.inputUsdPer1M;
  const outputCost = (args.tokensCompletion / 1_000_000) * pricing.outputUsdPer1M;

  return {
    costUsd: Number((inputCost + outputCost).toFixed(8)),
    inputTokenPriceUsdPer1M: pricing.inputUsdPer1M,
    outputTokenPriceUsdPer1M: pricing.outputUsdPer1M,
    pricingSource: "zion_local_pricing_table_review_before_production",
  };
}

function extractOpenAiUsage(response: unknown, model: string): GenerateAiSalesReplyUsage {
  const usage = (response as any)?.usage || {};
  const tokensPrompt = numberOrNull(usage.input_tokens);
  const tokensCompletion = numberOrNull(usage.output_tokens);
  const totalTokens =
    numberOrNull(usage.total_tokens) ??
    (tokensPrompt != null && tokensCompletion != null
      ? tokensPrompt + tokensCompletion
      : null);

  const cost = calculateOpenAiCostUsd({
    model,
    tokensPrompt,
    tokensCompletion,
  });

  return {
    provider: "openai",
    model,
    tokensPrompt,
    tokensCompletion,
    totalTokens,
    costUsd: cost.costUsd,
    inputTokenPriceUsdPer1M: cost.inputTokenPriceUsdPer1M,
    outputTokenPriceUsdPer1M: cost.outputTokenPriceUsdPer1M,
    pricingSource: cost.pricingSource,
  };
}


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

  // Chaves vivas da tela de Configurações.
  // A tela de Configurações grava na mesma base do onboarding por RPCs scoped,
  // então estas chaves representam a configuração oficial atual da loja.
  "accepted_payment_methods_summary",
  "after_hours_behavior",
  "after_hours_summary",
  "agenda_capacity_rule",
  "ai_identity_mode",
  "ai_tone_summary",
  "channels_system_summary",
  "commercial_ai_summary",
  "discount_approver",
  "discount_approver_name",
  "discount_cases_other",
  "discount_cases_selected",
  "discount_explanation",
  "discount_percent",
  "discount_policy_summary",
  "discount_rules",
  "discount_special_rules",
  "final_activation_notes",
  "human_help_discount_summary",
  "human_help_general_summary",
  "human_help_summary",
  "import_summary",
  "installation_process_summary",
  "negotiation_rules_summary",
  "operational_ai_summary",
  "payment_alerts",
  "payment_cases_other",
  "payment_cases_selected",
  "payment_methods",
  "payment_methods_summary",
  "post_sale_summary",
  "price_before_summary",
  "price_must_understand_before_summary",
  "price_policy_summary",
  "promise_limits_summary",
  "sales_flow_notes",
  "strategy_ai_never_forget",
  "strategy_ai_presentation",
  "strategy_ai_priorities",
  "strategy_ai_store_summary",
  "strategy_common_customer",
  "strategy_differentials",
  "strategy_exception_cases",
  "strategy_ideal_customer",
  "strategy_non_worked_brands",
  "strategy_positioning",
  "strategy_primary_focus",
  "strategy_priority_brands",
  "strategy_promise_limits",
  "strategy_requires_human",
  "strategy_requires_visit",
  "strategy_sell_more",
  "strategy_service_exclusions",
  "strategy_ticket_range",
  "strategy_top_lines",
  "strategy_top_products",
  "technical_visit_rules_summary",
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
      /\bquero ver\b/i,
      /\bmostrar\b/i,
      /\bme mostra\b/i,
      /\bme mostrar\b/i,
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
      /\bspa\b/i,
      /\bprofunda\b/i,
      /\bras[ao]\b/i,
      /\btamanho\b/i,
      /\bmedida\b/i,
      /\bespaço\b/i,
      /\bespaco\b/i,
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
      /\bqual a principal diferenca\b/i,
      /\bexplicar a diferença\b/i,
    ],
  },
];

const PRODUCT_KEYWORDS = [
  "cloro",
  "barrilha",
  "algicida",
  "clarificante",
  "limpa borda",
  "limpa bordas",
  "elevador de ph",
  "redutor de ph",
  "sulfato de aluminio",
  "sulfato de alumínio",
  "aspirador",
  "escova",
  "peneira",
  "clorador",
  "kit teste",
  "kit de teste",
  "led",
  "luminaria",
  "luminária",
  "mangueira",
  "dispositivo",
  "hidromassagem",
  "retorno",
  "pastilha",
  "pastilhas",
  "produto",
  "acessorio",
  "acessório",
  "quimico",
  "químico",
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
      const arr = value.map((item) => asText(item)).filter(Boolean) as string[];
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

function detectFollowUpTiming(text: string): string | null {
  const t = normalizeText(text);

  if (t.includes("amanha") || t.includes("amanhã")) return "amanhã";
  if (t.includes("semana que vem") || t.includes("proxima semana") || t.includes("próxima semana")) {
    return "semana que vem";
  }
  if (t.includes("mes que vem") || t.includes("mês que vem") || t.includes("proximo mes") || t.includes("próximo mês")) {
    return "mês que vem";
  }
  if (t.includes("mais tarde")) return "mais tarde";
  if (t.includes("fim de semana") || t.includes("final de semana")) return "fim de semana";

  const daquiMatch = t.match(/daqui\s+(\d{1,2})\s+(dia|dias|semana|semanas|mes|meses|m[eê]s|m[eê]ses)/i);
  if (daquiMatch?.[0]) return daquiMatch[0];

  return null;
}

function analyzeCustomerPatienceSignal(text: string): CustomerPatienceSignal {
  const t = normalizeText(text);
  const followUpTiming = detectFollowUpTiming(text);

  const notInterestedSignals = [
    "nao quero",
    "não quero",
    "nao tenho interesse",
    "não tenho interesse",
    "sem interesse",
    "desisti",
    "nao precisa",
    "não precisa",
    "pode deixar",
    "nao vou comprar",
    "não vou comprar",
    "pare de mandar",
    "para de mandar",
    "me tira",
    "remove meu contato",
  ];

  if (notInterestedSignals.some((signal) => t.includes(signal))) {
    return {
      status: "not_interested",
      summary: "cliente demonstrou desinteresse ou pediu para não seguir com a venda",
      followUpTiming,
      shouldAvoidNewQuestion: true,
      shouldCloseSoftly: true,
    };
  }

  const followUpSignals = [
    "te chamo",
    "eu chamo",
    "eu retorno",
    "retorno depois",
    "falo depois",
    "me chama",
    "me mande",
    "me manda",
    "volta a falar",
    "chama depois",
    "mais tarde",
    "depois eu vejo",
    "depois vejo",
  ];

  if (followUpTiming || followUpSignals.some((signal) => t.includes(signal))) {
    return {
      status: "follow_up_requested",
      summary: "cliente pediu ou indicou uma retomada futura",
      followUpTiming,
      shouldAvoidNewQuestion: true,
      shouldCloseSoftly: false,
    };
  }

  const thinkingSignals = [
    "vou pensar",
    "preciso pensar",
    "pensar melhor",
    "vou analisar",
    "vou avaliar",
    "vou ver",
    "vou dar uma olhada",
    "vou conversar",
    "vou falar com",
    "vou ver com",
    "ver com minha esposa",
    "ver com meu marido",
    "falar com minha esposa",
    "falar com meu marido",
    "decidir com calma",
  ];

  if (thinkingSignals.some((signal) => t.includes(signal))) {
    return {
      status: "thinking",
      summary: "cliente pediu tempo para pensar, avaliar ou falar com outra pessoa",
      followUpTiming,
      shouldAvoidNewQuestion: true,
      shouldCloseSoftly: false,
    };
  }

  const unclearPauseSignals = [
    "agora nao",
    "agora não",
    "no momento nao",
    "no momento não",
    "mais pra frente",
    "mais para frente",
    "so pesquisando",
    "só pesquisando",
    "estou pesquisando",
    "to pesquisando",
    "tô pesquisando",
  ];

  if (unclearPauseSignals.some((signal) => t.includes(signal))) {
    return {
      status: "unclear_pause",
      summary: "cliente esfriou a conversa ou indicou pausa sem desistência clara",
      followUpTiming,
      shouldAvoidNewQuestion: true,
      shouldCloseSoftly: false,
    };
  }

  return {
    status: "active_interest",
    summary: "cliente segue com interesse ativo ou dúvida comercial em aberto",
    followUpTiming: null,
    shouldAvoidNewQuestion: false,
    shouldCloseSoftly: false,
  };
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

function isExplicitCatalogRequest(text: string): boolean {
  const t = normalizeText(text);

  return (
    looksLikeCatalogRequest(t) ||
    t.includes("me mostra") ||
    t.includes("me mostrar") ||
    t.includes("quero ver") ||
    t.includes("mostrar modelos") ||
    t.includes("mostrar opcoes") ||
    t.includes("mostrar opções") ||
    t.includes("mandar as piscinas") ||
    t.includes("ver as piscinas") ||
    t.includes("tem foto") ||
    t.includes("tiver foto") ||
    t.includes("quero foto") ||
    t.includes("quero fotos") ||
    t.includes("catálogo") ||
    t.includes("catalogo")
  );
}

function isAffirmativeReply(text: string): boolean {
  const t = normalizeText(text);

  return [
    "sim",
    "pode",
    "pode sim",
    "quero",
    "manda",
    "mande",
    "me manda",
    "me mande",
    "mostra",
    "me mostra",
    "quero ver",
    "quero sim",
    "pode mostrar",
    "manda ai",
    "manda aí",
    "manda as opcoes",
    "manda as opções",
    "pode ser",
    "isso",
    "ok",
    "beleza",
    "blz",
  ].some((signal) => t === signal || t.includes(signal));
}

function looksLikePoolRecommendationRequest(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("modelo") ||
    t.includes("modelos") ||
    t.includes("opcoes") ||
    t.includes("opções") ||
    t.includes("catalogo") ||
    t.includes("catálogo") ||
    t.includes("me mostra") ||
    t.includes("mostrar") ||
    t.includes("quero ver") ||
    t.includes("basica") ||
    t.includes("básica") ||
    t.includes("basicas") ||
    t.includes("básicas") ||
    t.includes("mais em conta") ||
    t.includes("economica") ||
    t.includes("econômica") ||
    t.includes("compacta") ||
    t.includes("compactas") ||
    t.includes("crianca") ||
    t.includes("criança") ||
    t.includes("criancas") ||
    t.includes("crianças") ||
    t.includes("familia") ||
    t.includes("família") ||
      t.includes("premium")
  );
}

function hasSpecificPoolReference(text: string): boolean {
  const t = normalizeText(text);

  if (
    t.includes("anuncio") ||
    t.includes("anúncio") ||
    t.includes("vi o anuncio") ||
    t.includes("vi o anúncio")
  ) {
    return true;
  }

  return (
    /\bpiscina\s+[a-z0-9]{2,}(?:\s+[a-z0-9]{1,12}){0,2}\b/i.test(t) ||
    /\b(?:fibra|vinil|pastilha|spa)\s+[a-z0-9]{2,}\b/i.test(t)
  );
}

function isGenericPoolOpening(text: string): boolean {
  const t = normalizeText(text);

  const genericInterest =
    t === "quero uma piscina" ||
    t === "queria uma piscina" ||
    t === "tenho interesse em piscina" ||
    t === "estou procurando uma piscina" ||
    t === "quero comprar uma piscina" ||
    t === "tenho interesse em uma piscina";

  if (!genericInterest) return false;
  if (hasSpecificPoolReference(text)) return false;
  if (isExplicitCatalogRequest(text)) return false;
  if (looksLikePoolRecommendationRequest(text)) return false;
  if (looksLikePriceQuestion(text)) return false;
  if (looksLikeInstallationQuestion(text)) return false;
  if (looksLikeComparisonQuestion(text)) return false;
  if (looksLikeRegionQuestion(text)) return false;
  if (looksLikeTechnicalVisitQuestion(text)) return false;

  return (
    !t.includes("foto") &&
    !t.includes("imagem") &&
    !t.includes("medida") &&
    !t.includes("espaco") &&
    !t.includes("espaço") &&
    !t.includes("cabe") &&
    !/\d/.test(t)
  );
}

function asksToRepeatPoolOptions(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("me mostra as opcoes") ||
    t.includes("me mostra as opções") ||
    t.includes("manda de novo") ||
    t.includes("mostra de novo") ||
    t.includes("quais sao os modelos") ||
    t.includes("quais são os modelos") ||
    t.includes("quais opcoes") ||
    t.includes("quais opções") ||
    t.includes("compara eles") ||
    t.includes("compare eles") ||
    t.includes("me mostra os modelos") ||
    t.includes("manda as opcoes") ||
    t.includes("manda as opções")
  );
}

function hasNewPoolRefinementSignal(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("filho") ||
    t.includes("filhos") ||
    t.includes("filha") ||
    t.includes("filhas") ||
    t.includes("crianca") ||
    t.includes("criancas") ||
    t.includes("familia") ||
    t.includes("lazer") ||
    t.includes("basico") ||
    t.includes("simples") ||
    t.includes("mais em conta") ||
    t.includes("economico") ||
    t.includes("premium") ||
    t.includes("completo") ||
    t.includes("espaco") ||
    t.includes("medida") ||
    t.includes("metro") ||
    t.includes("m2") ||
    t.includes("instalacao") ||
    t.includes("preco") ||
    t.includes("valor") ||
    t.includes("compara")
  );
}

function detectLastAiOfferedPoolOptions(lastAiMessage: string | null): boolean {
  if (!lastAiMessage) return false;

  const t = normalizeText(lastAiMessage);

  return (
    (
      t.includes("quer que eu") ||
      t.includes("posso te") ||
      t.includes("vou separar") ||
      t.includes("vou te mostrar") ||
      t.includes("te mostro") ||
      t.includes("aqui estao") ||
      t.includes("eu olharia") ||
      t.includes("eu indicaria") ||
      t.includes("essas opcoes")
    ) &&
    (t.includes("modelo") ||
      t.includes("modelos") ||
      t.includes("opcoes") ||
      t.includes("opções") ||
      t.includes("piscina") ||
      t.includes("piscinas"))
  );
}

function hasUsefulPoolContext(text: string): boolean {
  const t = normalizeText(text);

  return (
    looksLikePoolChoice(t) ||
    looksLikePoolRecommendationRequest(t) ||
    extractRequestedAreaM2(text) != null ||
    t.includes("filho") ||
    t.includes("filha") ||
    t.includes("crianca") ||
    t.includes("crianÃ§a") ||
    t.includes("criancas") ||
    t.includes("crianÃ§as") ||
    t.includes("familia") ||
    t.includes("famÃ­lia") ||
    t.includes("espaco") ||
    t.includes("espaÃ§o") ||
    t.includes("quintal") ||
    t.includes("lazer") ||
    t.includes("compacta") ||
    t.includes("compactas") ||
    t.includes("basica") ||
    t.includes("bÃ¡sica") ||
    t.includes("mais em conta") ||
    t.includes("economica") ||
    t.includes("econÃ´mica") ||
    t.includes("premium")
  );
}

function buildCustomerConversationText(messages: MessageRow[], lastCustomerMessage: string): string {
  const userTexts = messages
    .filter(
      (msg) =>
        normalizeText(msg.sender) === "user" &&
        normalizeText(msg.direction) === "incoming" &&
        String(msg.content || "").trim().length > 0
    )
    .map((msg) => String(msg.content || "").trim());

  if (!userTexts.includes(lastCustomerMessage)) {
    userTexts.push(lastCustomerMessage);
  }

  return userTexts.slice(-8).join(" | ");
}

function extractRequestedAreaM2(text: string): number | null {
  const normalized = normalizeText(text).replace(/,/g, ".");
  const explicitArea = normalized.match(/(\d{1,3}(?:\.\d{1,2})?)\s*(m2|m²|metros quadrados|metro quadrado)/i);

  if (explicitArea?.[1]) {
    const parsed = Number(explicitArea[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const dimensions = normalized.match(/(\d{1,2}(?:\.\d{1,2})?)\s*x\s*(\d{1,2}(?:\.\d{1,2})?)/i);

  if (dimensions?.[1] && dimensions?.[2]) {
    const width = Number(dimensions[1]);
    const length = Number(dimensions[2]);
    const area = width * length;
    return Number.isFinite(area) && area > 0 ? area : null;
  }

  return null;
}

function shouldAskTimingNow(args: {
  facts: ConversationFactState;
  intents: DetectedIntent[];
  lastCustomerMessage: string;
}): boolean {
  const { facts, intents, lastCustomerMessage } = args;

  if (facts.timingKnown) return false;
  if (intents.includes("catalog")) return false;
  if (intents.includes("comparison")) return false;
  if (looksLikePaymentQuestion(lastCustomerMessage)) return false;
  if (looksLikeTechnicalVisitQuestion(lastCustomerMessage)) return false;
  if (looksLikeInstallationQuestion(lastCustomerMessage)) return false;
  if (looksLikePriceQuestion(lastCustomerMessage)) return false;

  return false;
}

function formatCurrencyFromCents(priceCents: number | null | undefined, currency?: string | null): string | null {
  if (priceCents == null) return null;

  const value = priceCents / 100;
  const code = (currency || "BRL").toUpperCase();

  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: code,
    }).format(value);
  } catch {
    return `R$ ${value.toFixed(2).replace(".", ",")}`;
  }
}

function getMetadataText(metadata: Record<string, unknown> | null | undefined): string {
  if (!metadata || typeof metadata !== "object") return "";
  try {
    return JSON.stringify(metadata);
  } catch {
    return "";
  }
}

function extractMetadataCategory(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = metadata["categoria"];
  return asText(raw);
}

function extractRequestedBrand(text: string): string | null {
  const normalized = normalizeText(text);

  const regexes = [
    /\bmarca\s+([a-z0-9][a-z0-9\s\-]{1,30})/i,
    /\bda marca\s+([a-z0-9][a-z0-9\s\-]{1,30})/i,
    /\bdo fabricante\s+([a-z0-9][a-z0-9\s\-]{1,30})/i,
  ];

  for (const regex of regexes) {
    const match = normalized.match(regex);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function extractRequestedProductTerm(text: string): string | null {
  const normalized = normalizeText(text);

  for (const keyword of PRODUCT_KEYWORDS) {
    if (normalized.includes(normalizeText(keyword))) {
      return keyword;
    }
  }

  return null;
}

function analyzeCatalogIntent(text: string): CatalogIntentAnalysis {
  const normalized = normalizeText(text);
  const requestedBrand = extractRequestedBrand(text);
  const requestedProductTerm = extractRequestedProductTerm(text);

  const asksForPhoto =
    normalized.includes("foto") ||
    normalized.includes("fotos") ||
    normalized.includes("imagem") ||
    normalized.includes("imagens") ||
    normalized.includes("ver") ||
    normalized.includes("mostrar");

  const asksForAvailability =
    normalized.includes("tem") ||
    normalized.includes("tem ai") ||
    normalized.includes("tem aí") ||
    normalized.includes("disponivel") ||
    normalized.includes("disponível") ||
    normalized.includes("estoque") ||
    normalized.includes("em estoque") ||
    normalized.includes("trabalham com") ||
    normalized.includes("vocês têm") ||
    normalized.includes("voces tem");

  const asksAboutCatalogProduct =
    !!requestedProductTerm ||
    PRODUCT_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword))) ||
    normalized.includes("marca");

  return {
    asksAboutCatalogProduct,
    asksAboutPool: looksLikePoolChoice(text),
    asksForPhoto,
    asksForPrice: looksLikePriceQuestion(text),
    asksForAvailability,
    asksForBrand: !!requestedBrand || normalized.includes("marca"),
    requestedBrand,
    requestedProductTerm,
  };
}

function buildCatalogSearchText(item: CatalogItemRow): string {
  return normalizeText(
    [
      item.sku,
      item.name,
      item.description,
      extractMetadataCategory(item.metadata),
      getMetadataText(item.metadata),
    ]
      .filter(Boolean)
      .join(" | ")
  );
}

function scoreCatalogItem(item: CatalogItemRow, analysis: CatalogIntentAnalysis): number {
  const haystack = buildCatalogSearchText(item);
  let score = 0;

  if (analysis.requestedProductTerm && haystack.includes(normalizeText(analysis.requestedProductTerm))) {
    score += 8;
  }

  if (analysis.requestedBrand && haystack.includes(normalizeText(analysis.requestedBrand))) {
    score += 7;
  }

  if (analysis.asksForBrand && analysis.requestedBrand) {
    const brandToken = normalizeText(analysis.requestedBrand).split(/\s+/).filter(Boolean);
    for (const token of brandToken) {
      if (token.length >= 2 && haystack.includes(token)) {
        score += 2;
      }
    }
  }

  if (analysis.requestedProductTerm === "cloro" && haystack.includes("cloro")) score += 3;
  if (analysis.requestedProductTerm === "barrilha" && haystack.includes("barrilha")) score += 3;

  if (item.is_active === true) score += 1;
  if (item.track_stock === true && (item.stock_quantity || 0) > 0) score += 1;

  return score;
}

function scorePool(pool: PoolRow, text: string): number {
  const haystack = normalizeText(
    [pool.name, pool.material, pool.shape, pool.description].filter(Boolean).join(" | ")
  );
  const normalized = normalizeText(text);
  const requestedAreaM2 = extractRequestedAreaM2(text);
  const poolAreaM2 = pool.width_m != null && pool.length_m != null ? pool.width_m * pool.length_m : null;
  let score = 0;

  for (const token of normalized.split(/\s+/)) {
    if (token.length >= 3 && haystack.includes(token)) {
      score += 1;
    }
  }

  if (normalized.includes("fibra") && haystack.includes("fibra")) score += 4;
  if (normalized.includes("vinil") && haystack.includes("vinil")) score += 4;
  if (normalized.includes("alvenaria") && haystack.includes("alvenaria")) score += 4;
  if (normalized.includes("retangular") && haystack.includes("retangular")) score += 3;
  if (normalized.includes("redonda") && haystack.includes("redonda")) score += 3;

  if (normalized.includes("filho") || normalized.includes("filha") || normalized.includes("crianca") || normalized.includes("criança")) {
    score += 2;
    if (pool.depth_m != null && pool.depth_m <= 1.4) score += 4;
    if (haystack.includes("infantil") || haystack.includes("familia") || haystack.includes("família")) score += 3;
    if (haystack.includes("prainha") || haystack.includes("praia")) score += 2;
  }

  if (normalized.includes("basica") || normalized.includes("básica") || normalized.includes("basico") || normalized.includes("básico") || normalized.includes("simples")) {
    score += 2;
    if (haystack.includes("basica") || haystack.includes("básica") || haystack.includes("simples")) score += 4;
    if (haystack.includes("fibra")) score += 2;
  }

  if (normalized.includes("compacta") || normalized.includes("compacto") || normalized.includes("pequena") || normalized.includes("pequeno")) {
    score += 2;
    if (haystack.includes("compacta") || haystack.includes("compacto") || haystack.includes("pequena") || haystack.includes("pequeno")) score += 4;
  }

  if (requestedAreaM2 != null && poolAreaM2 != null) {
    if (poolAreaM2 <= requestedAreaM2) score += 8;
    else if (poolAreaM2 <= requestedAreaM2 * 1.2) score += 5;
    else if (poolAreaM2 <= requestedAreaM2 * 1.5) score += 2;
    else score -= 4;
  }

  if (pool.is_active === true) score += 1;
  if (pool.track_stock === true && (pool.stock_quantity || 0) > 0) score += 1;
  if (pool.price != null) score += 1;

  return score;
}

function buildCatalogItemContextLine(match: MatchedCatalogItem): string {
  const { item, photos } = match;
  const price = formatCurrencyFromCents(item.price_cents, item.currency);
  const category = extractMetadataCategory(item.metadata);
  const photoCount = photos.length;
  const photoLabel = photoCount > 0 ? `${photoCount} foto(s) cadastrada(s)` : "sem foto cadastrada";

  const availability = isSellableInventoryState({
    isActive: item.is_active,
    trackStock: item.track_stock,
    stockQuantity: item.stock_quantity,
  });
  const stockLabel =
    availability.reason === "in_stock"
      ? "disponibilidade: confirmada"
      : availability.reason === "stock_not_tracked"
        ? "estoque não controlado por esta base"
        : availability.reason === "out_of_stock"
          ? "indisponível para venda: sem estoque"
          : "indisponível para venda: item inativo";

  return [
    `- item: ${item.name || "sem nome"}`,
    item.sku ? `sku: ${item.sku}` : null,
    category ? `categoria: ${category}` : null,
    price ? `preço: ${price}` : null,
    `ativo: ${item.is_active === true ? "sim" : "não"}`,
    `controle de estoque: ${item.track_stock === true ? "sim" : "não"}`,
    stockLabel,
    photoLabel,
    item.description ? `descrição: ${item.description}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

function formatPoolLine(pool: PoolRow, hasPhoto: boolean): string {
  const parts: string[] = [];
  const availability = isSellableInventoryState({
    isActive: pool.is_active,
    trackStock: pool.track_stock,
    stockQuantity: pool.stock_quantity,
  });

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

  if (availability.reason === "in_stock") {
    parts.push("disponibilidade: confirmada");
  } else if (availability.reason === "stock_not_tracked") {
    parts.push("estoque não controlado por esta base");
  } else if (availability.reason === "out_of_stock") {
    parts.push("indisponível para venda: sem estoque");
  } else {
    parts.push("indisponível para venda: item inativo");
  }

  parts.push(hasPhoto || !!pool.photo_url ? "há foto cadastrada" : "sem foto cadastrada");

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

  const liveStoreStrategy = formatSection("CONFIGURAÇÃO VIVA — ESTRATÉGIA COMERCIAL", [
    ["resumo comercial da loja para IA", onboardingMap.strategy_ai_store_summary],
    ["apresentação comercial da IA", onboardingMap.strategy_ai_presentation],
    ["prioridades da IA vendedora", onboardingMap.strategy_ai_priorities],
    ["o que a IA nunca deve esquecer", onboardingMap.strategy_ai_never_forget],
    ["posicionamento da loja", onboardingMap.strategy_positioning],
    ["foco comercial principal", onboardingMap.strategy_primary_focus],
    ["cliente ideal", onboardingMap.strategy_ideal_customer],
    ["cliente comum", onboardingMap.strategy_common_customer],
    ["diferenciais estratégicos", onboardingMap.strategy_differentials],
    ["o que mais vende", onboardingMap.strategy_sell_more],
    ["faixa de ticket", onboardingMap.strategy_ticket_range],
    ["marcas prioritárias", onboardingMap.strategy_priority_brands],
    ["produtos prioritários", onboardingMap.strategy_top_products],
    ["linhas prioritárias", onboardingMap.strategy_top_lines],
    ["limites de promessa", onboardingMap.strategy_promise_limits],
    ["casos que exigem visita", onboardingMap.strategy_requires_visit],
    ["casos que exigem humano", onboardingMap.strategy_requires_human],
    ["casos de exceção", onboardingMap.strategy_exception_cases],
    ["serviços que a loja não faz", onboardingMap.strategy_service_exclusions],
    ["marcas que a loja não trabalha", onboardingMap.strategy_non_worked_brands],
  ]);

  const liveCommercialAi = formatSection("CONFIGURAÇÃO VIVA — COMERCIAL E IA", [
    ["resumo comercial da IA", onboardingMap.commercial_ai_summary],
    ["modo de identidade da IA", onboardingMap.ai_identity_mode],
    ["tom da IA", onboardingMap.ai_tone_summary],
    ["regras de negociação", onboardingMap.negotiation_rules_summary],
    ["observações do fluxo comercial", onboardingMap.sales_flow_notes],
    ["limites de promessa", onboardingMap.promise_limits_summary],
    ["resumo de atendimento humano", onboardingMap.human_help_general_summary],
    ["resumo de ajuda humana", onboardingMap.human_help_summary],
    ["resumo de pós-venda", onboardingMap.post_sale_summary],
    ["observações finais de ativação", onboardingMap.final_activation_notes],
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
    ["resumo operacional", onboardingMap.operational_ai_summary],
    ["comportamento fora do horário", onboardingMap.after_hours_behavior],
    ["resumo fora do horário", onboardingMap.after_hours_summary],
    ["regra de capacidade da agenda", onboardingMap.agenda_capacity_rule],
  ]);

  const installation = formatSection("INSTALAÇÃO", [
    ["oferece instalação", onboardingMap.offers_installation],
    ["dias disponíveis para instalação", onboardingMap.installation_available_days],
    ["regra dos dias de instalação", onboardingMap.installation_days_rule],
    ["tempo médio de instalação em dias", onboardingMap.average_installation_time_days],
    ["processo de instalação", onboardingMap.installation_process],
    ["etapas do processo de instalação", onboardingMap.installation_process_steps],
    ["resumo do processo de instalação", onboardingMap.installation_process_summary],
  ]);

  const technicalVisit = formatSection("VISITA TÉCNICA", [
    ["oferece visita técnica", onboardingMap.offers_technical_visit],
    ["dias disponíveis para visita técnica", onboardingMap.technical_visit_available_days],
    ["regra dos dias de visita técnica", onboardingMap.technical_visit_days_rule],
    ["regras de visita técnica", onboardingMap.technical_visit_rules],
    ["regras selecionadas de visita técnica", onboardingMap.technical_visit_rules_selected],
    ["resumo das regras de visita técnica", onboardingMap.technical_visit_rules_summary],
  ]);

  const pricingAndPayment = formatSection("PREÇO, PAGAMENTO E DESCONTO", [
    ["ticket médio", onboardingMap.average_ticket],
    ["meios de pagamento aceitos", onboardingMap.accepted_payment_methods],
    ["resumo dos meios de pagamento aceitos", onboardingMap.accepted_payment_methods_summary],
    ["meios de pagamento configurados", onboardingMap.payment_methods],
    ["resumo de pagamento", onboardingMap.payment_methods_summary],
    ["alertas de pagamento", onboardingMap.payment_alerts],
    ["casos de pagamento selecionados", onboardingMap.payment_cases_selected],
    ["outros casos de pagamento", onboardingMap.payment_cases_other],
    ["a IA pode enviar preço direto", onboardingMap.ai_can_send_price_directly],
    ["modo de falar de preço", onboardingMap.price_talk_mode],
    ["regra para preço direto", onboardingMap.price_direct_rule],
    ["condições para passar preço direto", onboardingMap.price_direct_conditions],
    ["o que precisa entender antes de falar preço", onboardingMap.price_must_understand_before],
    ["resumo do que entender antes de falar preço", onboardingMap.price_must_understand_before_summary],
    ["política de preço", onboardingMap.price_policy_summary],
    ["o que entender antes do preço", onboardingMap.price_before_summary],
    ["preço precisa de ajuda humana", onboardingMap.price_needs_human_help],
    ["pode negociar desconto", onboardingMap.can_offer_discount],
    ["limite interno máximo de desconto (não revelar automaticamente ao cliente)", onboardingMap.max_discount_percent],
    ["percentual interno de desconto (não revelar automaticamente ao cliente)", onboardingMap.discount_percent],
    ["política de desconto", onboardingMap.discount_policy_summary],
    ["regras de desconto", onboardingMap.discount_rules],
    ["regras especiais de desconto", onboardingMap.discount_special_rules],
    ["explicação de desconto", onboardingMap.discount_explanation],
    ["aprovador de desconto", onboardingMap.discount_approver],
    ["nome do aprovador de desconto", onboardingMap.discount_approver_name],
    ["casos de desconto selecionados", onboardingMap.discount_cases_selected],
    ["outros casos de desconto", onboardingMap.discount_cases_other],
    ["resumo de ajuda humana em desconto", onboardingMap.human_help_discount_summary],
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
      onboardingMap.human_help_custom_project_cases],
    ["casos de desconto com ajuda humana", onboardingMap.human_help_discount_cases],
    ["casos de pagamento com ajuda humana", onboardingMap.human_help_payment_cases],
  ]);

  const limitations = formatSection("LIMITAÇÕES E CUIDADOS", [
    ["limitações importantes", onboardingMap.important_limitations],
    ["exclusões de serviço", onboardingMap.strategy_service_exclusions],
    ["marcas não trabalhadas", onboardingMap.strategy_non_worked_brands],
    ["casos que exigem humano", onboardingMap.strategy_requires_human],
    ["casos que exigem visita", onboardingMap.strategy_requires_visit],
    ["casos de exceção", onboardingMap.strategy_exception_cases],
  ]);

  return [
    overview,
    liveStoreStrategy,
    liveCommercialAi,
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
    /\b(\d{1,2}(?:[.,]\d{1,2})?)\s?(m|mt|metros?)\b|\b\d{1,2}\s?x\s?\d{1,2}\b|\b\d{1,3}\s?metros?\s?quadrados?\b/;

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

  if (
    !facts.budgetKnown &&
    (looksLikePriceQuestion(lastCustomerMessage) || looksLikePoolChoice(lastCustomerMessage))
  ) {
    out.push("faixa de investimento");
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

function inferNextBestQuestion(args: {
  facts: ConversationFactState;
  intents: DetectedIntent[];
  lastCustomerMessage: string;
  explicitCatalogRequest: boolean;
  patienceSignal: CustomerPatienceSignal;
}): string | null {
  const { facts, intents, lastCustomerMessage, explicitCatalogRequest, patienceSignal } = args;

  if (patienceSignal.shouldAvoidNewQuestion) {
    return null;
  }

  if (
    (explicitCatalogRequest || intents.includes("comparison") || looksLikePoolChoice(lastCustomerMessage)) &&
    !facts.sizeKnown
  ) {
    return "qual espaço ou medida aproximada você tem aí para a piscina?";
  }

  if (
    facts.needKnown &&
    facts.sizeKnown &&
    extractRequestedAreaM2(lastCustomerMessage) != null &&
    !hasNewPoolRefinementSignal(lastCustomerMessage) &&
    !looksLikePriceQuestion(lastCustomerMessage) &&
    !looksLikeInstallationQuestion(lastCustomerMessage) &&
    !looksLikeComparisonQuestion(lastCustomerMessage) &&
    !hasSpecificPoolReference(lastCustomerMessage)
  ) {
    return "vai ser mais para crianças pequenas brincarem ou para adultos também usarem? E você prefere algo mais simples de manter ou uma opção com mais conforto?";
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

  if (
    shouldAskTimingNow({
      facts,
      intents,
      lastCustomerMessage,
    })
  ) {
    return "isso seria para agora ou mais pra frente?";
  }

  return null;
}

function inferResponseGoal(args: {
  intents: DetectedIntent[];
  facts: ConversationFactState;
  nextBestQuestion: string | null;
  responseMode: ResponseMode;
  explicitCatalogRequest: boolean;
  lastCustomerMessage: string;
  lastAiListedPools: boolean;
  patienceSignal: CustomerPatienceSignal;
}): string {
  const {
    intents,
    facts,
    nextBestQuestion,
    responseMode,
    explicitCatalogRequest,
    lastCustomerMessage,
    lastAiListedPools,
    patienceSignal,
  } = args;

  if (patienceSignal.status === "not_interested") {
    return "respeitar o desinteresse, encerrar com educação e não tentar reabrir a venda nesta resposta";
  }

  if (patienceSignal.status === "thinking") {
    return "acolher o tempo do cliente, não pressionar e deixar um próximo passo leve sem nova triagem";
  }

  if (patienceSignal.status === "follow_up_requested") {
    return "confirmar que vai respeitar a retomada futura indicada pelo cliente, sem forçar fechamento agora";
  }

  if (patienceSignal.status === "unclear_pause") {
    return "baixar a pressão comercial, responder com leveza e manter a porta aberta sem insistir";
  }

  if (responseMode === "objective") {
    return "responder exatamente o que foi perguntado, com clareza, sem excesso de expansão e com no máximo um avanço curto";
  }

  if (isGenericPoolOpening(lastCustomerMessage)) {
    return "responder com naturalidade, sem listar catálogo ainda, e fazer uma triagem consultiva leve com uma única pergunta útil sobre espaço e uso principal";
  }

  if (
    isAffirmativeReply(lastCustomerMessage) &&
    (lastAiListedPools || looksLikePoolChoice(lastCustomerMessage) || looksLikePoolRecommendationRequest(lastCustomerMessage))
  ) {
    return "apresentar agora 2 ou 3 opções concretas e seguir com no máximo uma pergunta útil se ainda faltar um dado decisivo";
  }

  if (
    lastAiListedPools &&
    hasNewPoolRefinementSignal(lastCustomerMessage) &&
    !asksToRepeatPoolOptions(lastCustomerMessage) &&
    !looksLikePoolRecommendationRequest(lastCustomerMessage)
  ) {
    return "refinar a recomendação anterior com base no novo dado, destacando a melhor ou as 2 melhores opções, sem repetir lista completa";
  }

  if (explicitCatalogRequest || intents.includes("pool_choice")) {
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
  explicitCatalogRequest: boolean;
  lastAiListedPools: boolean;
  lastCustomerMessage: string;
  patienceSignal: CustomerPatienceSignal;
}): string[] {
  const out: string[] = [
    "não ignorar a pergunta principal do cliente",
    "não fazer mais de uma pergunta se uma só já resolve",
    "não soar como robô, suporte frio ou formulário",
    "não prometer envio de foto/catálogo/arquivo como se já estivesse acontecendo",
    "não despejar lista repetida de modelos sem critério",
    "não reiniciar a triagem da conversa com perguntas amplas do tipo opções, preço, instalação ou melhor solução",
    "não inventar estoque, foto, marca, serviço ou disponibilidade",
    "não dizer que tem foto se não houver foto cadastrada",
    "não dizer que tem em estoque se a base não confirmar isso",
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

  if (!args.explicitCatalogRequest && args.lastAiListedPools && !isAffirmativeReply(args.lastCustomerMessage)) {
    out.push("não listar novos modelos novamente se o cliente não pediu isso explicitamente agora");
  }

  if (
    args.lastAiListedPools &&
    hasNewPoolRefinementSignal(args.lastCustomerMessage) &&
    !asksToRepeatPoolOptions(args.lastCustomerMessage) &&
    !looksLikePoolRecommendationRequest(args.lastCustomerMessage)
  ) {
    out.push("não repetir lista completa de modelos se a IA já listou opções antes");
    out.push("não recomeçar a recomendação do zero; usar o novo dado do cliente para afunilar");
    out.push("não ignorar a nova informação do cliente ao recomendar");
    out.push("não listar 3 modelos novamente quando bastar destacar a melhor opção ou as 2 melhores");
  }

  if (args.responseMode === "objective") {
    out.push("não abrir explicação longa além do que o cliente perguntou");
    out.push("não adicionar vários assuntos extras na mesma resposta");
    out.push("não transformar a resposta em apresentação completa da operação");
    out.push("não listar todos os detalhes operacionais quando bastar uma confirmação objetiva");
  }

  if (args.patienceSignal.status !== "active_interest") {
    out.push("não fazer nova pergunta comercial quando o cliente pediu tempo, indicou pausa ou demonstrou desinteresse");
    out.push("não insistir, pressionar, criar urgência falsa ou tentar contornar a pausa do cliente");
    out.push("não listar novos modelos, condições ou benefícios para tentar vencer a pausa nesta resposta");
  }

  if (args.patienceSignal.status === "not_interested") {
    out.push("não tentar recuperar a venda nesta resposta; apenas encerrar com educação e deixar a porta aberta");
    out.push("não escrever quando mudar de ideia; use se mudar de ideia");
  }

  return out;
}

function buildCommercialObjective(args: {
  orderedMessages: MessageRow[];
  lastCustomerMessage: string;
  explicitCatalogRequest: boolean;
  lastAiListedPools: boolean;
}): CommercialObjective {
  const facts = collectConversationFacts(args.orderedMessages);
  const intents = detectIntents(args.lastCustomerMessage);
  const responseMode: ResponseMode = isObjectiveQuestionMode(args.lastCustomerMessage)
    ? "objective"
    : "consultative";
  const patienceSignal = analyzeCustomerPatienceSignal(args.lastCustomerMessage);

  const nextBestQuestion = inferNextBestQuestion({
    facts,
    intents,
    lastCustomerMessage: args.lastCustomerMessage,
    explicitCatalogRequest: args.explicitCatalogRequest,
    patienceSignal,
  });

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
      explicitCatalogRequest: args.explicitCatalogRequest,
      lastCustomerMessage: args.lastCustomerMessage,
      lastAiListedPools: args.lastAiListedPools,
      patienceSignal,
    }),
    forbiddenInThisReply: inferForbiddenInThisReply({
      intents,
      nextBestQuestion,
      responseMode,
      explicitCatalogRequest: args.explicitCatalogRequest,
      lastAiListedPools: args.lastAiListedPools,
      lastCustomerMessage: args.lastCustomerMessage,
      patienceSignal,
    }),
    responseMode,
    patienceSignal,
  };
}


function formatPatienceToneGuidance(signal: CustomerPatienceSignal): string {
  if (signal.status === "not_interested") {
    return [
      "- tom recomendado: curto, leve e sem tentativa de recuperação",
      "- frase segura: Tudo bem, sem problema. Se mudar de ideia ou precisar de algo, me avisa.",
      "- nunca usar: Quando mudar de ideia",
      "- não adicionar pergunta, catálogo, benefício, urgência ou tentativa de convencer",
    ].join("\n");
  }

  if (signal.status === "follow_up_requested") {
    const timing = signal.followUpTiming ? ` ${signal.followUpTiming}` : "";

    return [
      "- tom recomendado: bem leve, curto e natural",
      `- frase segura: Blz, qualquer coisa me avisa${timing ? `. A gente continua${timing}.` : "."}`,
      "- alternativa segura: Ok, se precisar de algo, me avisa.",
      "- não fazer nova pergunta comercial nesta resposta",
    ].join("\n");
  }

  if (signal.status === "thinking") {
    return [
      "- tom recomendado: acolher sem pressionar e sem alongar",
      "- frase segura: Tranquilo, pode ver com calma. Se precisar de algo, me avisa.",
      "- se houver decisão compartilhada, não ofereça resumo automaticamente a menos que isso ajude muito; mantenha leve",
      "- não fazer nova pergunta comercial nesta resposta",
    ].join("\n");
  }

  if (signal.status === "unclear_pause") {
    return [
      "- tom recomendado: baixar a pressão e manter a porta aberta",
      "- frase segura: Ok, sem problema. Se precisar de alguma coisa, me avisa.",
      "- não fazer nova pergunta comercial nesta resposta",
    ].join("\n");
  }

  return "- sem orientação especial de pausa nesta resposta";
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

  const patienceTimingText = objective.patienceSignal.followUpTiming
    ? `- prazo/retomada citado pelo cliente: ${objective.patienceSignal.followUpTiming}`
    : "- prazo/retomada citado pelo cliente: não identificado";

  const patienceToneGuidance = formatPatienceToneGuidance(objective.patienceSignal);

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

SINAL DE PACIÊNCIA, PAUSA OU DESINTERESSE
- status: ${objective.patienceSignal.status}
- leitura: ${objective.patienceSignal.summary}
${patienceTimingText}
- evitar nova pergunta comercial: ${objective.patienceSignal.shouldAvoidNewQuestion ? "sim" : "não"}
- encerrar com suavidade: ${objective.patienceSignal.shouldCloseSoftly ? "sim" : "não"}

TOM RECOMENDADO PARA ESTE SINAL
${patienceToneGuidance}

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
  explicitCatalogRequest: boolean;
  lastAiListedPools: boolean;
  lastCustomerMessage: string;
  hasCatalogEvidence: boolean;
  hasPoolEvidence: boolean;
  shouldPresentPoolRecommendations: boolean;
}) {
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

  if (isGenericPoolOpening(args.lastCustomerMessage)) {
    instructions.push(
      "- Esta é uma abertura genérica de interesse em piscina. Não liste modelos nem catálogo ainda. Responda com naturalidade e faça só uma pergunta consultiva leve, de preferência juntando espaço/medida com uso principal."
    );
  }

  if (args.shouldPresentPoolRecommendations) {
    instructions.push(
      "- O cliente já confirmou que quer ver modelos/opções de piscina. Nesta resposta, liste 2 ou 3 modelos concretos do catálogo pelo nome, com um motivo curto para cada um. Não responda apenas que vai separar ou que pode mostrar."
    );
  } else if (
    args.lastAiListedPools &&
    hasNewPoolRefinementSignal(args.lastCustomerMessage) &&
    !asksToRepeatPoolOptions(args.lastCustomerMessage) &&
    !looksLikePoolRecommendationRequest(args.lastCustomerMessage)
  ) {
    instructions.push(
      "- A IA já apresentou modelos antes e o cliente trouxe um dado novo para qualificar melhor. Agora, em vez de repetir a lista, afunile a recomendação: destaque a melhor opção ou as 2 melhores e explique por que elas combinam mais com esse novo contexto."
    );
  } else if (args.explicitCatalogRequest || args.hasPoolEvidence) {
    instructions.push(
      "- Se já houver contexto suficiente de piscina e modelos compatíveis no contexto, recomende direto 2 ou 3 opções concretas pelo nome, mesmo quando a última mensagem for continuação curta. Não fique só perguntando se ele quer ver."
    );
  } else {
    instructions.push(
      "- Não volte a listar modelos, catálogo ou várias opções se o cliente não pediu isso explicitamente agora."
    );
  }

  if (
    args.lastAiListedPools &&
    !args.explicitCatalogRequest &&
    !args.shouldPresentPoolRecommendations
  ) {
    instructions.push(
      "- Como a IA já listou modelos antes, não repita nova lista nesta resposta sem pedido explícito do cliente."
    );
  }

  instructions.push(
    "- Não reinicie a conversa com perguntas amplas de triagem como opções, preço, instalação ou melhor solução se a conversa já estava andando."
  );

  instructions.push(
    "- Seja totalmente sincera: se a base não confirmar estoque, foto, marca, serviço ou disponibilidade, não invente."
  );

  instructions.push(
    "- Quando o cliente mudar o contexto para espaço, filhos, básico, premium, preço, instalação ou comparação, use isso para evoluir a conversa. Não recomece a venda nem repita a mesma prateleira completa."
  );

  instructions.push(
    "- Se o catálogo mostrar item ativo com estoque controlado positivo, você pode dizer que tem, sem revelar a quantidade exata em estoque."
  );

  instructions.push(
    "- Não use a palavra \"unidades\" para falar de estoque/disponibilidade, a menos que exista autorização explícita da loja."
  );

  instructions.push(
    "- Se o catálogo mostrar item ativo com estoque controlado e quantidade 0 ou nula, diga que está em falta ou sem estoque confirmado."
  );

  instructions.push(
    "- Se o item/modelo existir no catálogo, mas aparecer sem disponibilidade vendável, não diga que não encontrou; diga que ele aparece no catálogo, mas não há disponibilidade confirmada para venda no momento."
  );

  instructions.push(
    "- Se houver evidência vendável e evidência indisponível parecida para o mesmo item/modelo, priorize a evidência vendável."
  );

  instructions.push(
    "- Se o item estiver ativo, mas sem controle de estoque, não diga que tem em estoque; diga que o item aparece ativo no catálogo, mas o estoque não está confirmado por esta base."
  );

  instructions.push(
    "- Se o cliente pedir foto e não houver foto cadastrada, diga claramente que não há foto cadastrada no momento."
  );

  if (!args.hasCatalogEvidence) {
    instructions.push(
      "- Para produto de catálogo sem item compatível encontrado, não diga que tem. Diga que você não conseguiu localizar esse item específico no catálogo atual."
    );
  }

  if (!args.hasPoolEvidence) {
    instructions.push(
      "- Para piscina específica sem modelo/foto compatível encontrado, não invente. Diga que não conseguiu localizar esse modelo específico ou que não há foto cadastrada dele."
    );
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
  instructions.push("- Evite a pergunta automática sobre timing, a menos que seja realmente essencial.");

  return instructions.join("\n");
}

function buildExamplesBlock(args: {
  intents: DetectedIntent[];
  nextBestQuestion: string | null;
  explicitCatalogRequest: boolean;
}) {
  const examples: string[] = [];

  if (args.intents.includes("payment") && args.intents.includes("technical_visit")) {
    examples.push(
      `EXEMPLO BOM:
Cliente: "Aceita cartão? E vocês fazem visita técnica?"
Resposta boa: "Sim, aceitamos cartão. E fazemos visita técnica sim, com agendamento. ${args.nextBestQuestion || "Me fala sua cidade ou bairro que eu te oriento certinho."}"`
    );
  }

  examples.push(
    `EXEMPLO BOM:
Cliente: "Vocês têm cloro da marca X?"
Resposta boa: "Dessa marca específica eu não consegui confirmar aqui no catálogo agora. Mas, olhando o que temos, eu começaria por 2 ou 3 opções parecidas e te digo qual faz mais sentido pro que você quer."`
  );

  examples.push(
    `EXEMPLO BOM:
Cliente: "Tem foto dessa piscina?"
Resposta boa: "Dessa piscina eu não tenho foto cadastrada aqui no momento. As opções mais próximas com foto que eu priorizaria são estas, porque combinam melhor com o que você procura."`
  );

  examples.push(
    `EXEMPLO BOM:
Cliente: "Quero ver modelos com foto"
Resposta boa: "Para esse caso, eu olharia primeiro 2 ou 3 modelos com foto que combinam melhor com o que você quer e explico rapidinho o porquê de cada um."`
  );

  examples.push(
    `EXEMPLO BOM:
Cliente: "Tenho 10 m² e é para meus filhos brincarem. Quero modelos básicos"
Resposta boa: "Para 10 m² e pensando nas crianças, eu olharia primeiro estas opções:
1. [modelo vendável 1] — mais compacto e fácil de encaixar nesse espaço
2. [modelo vendável 2] — boa opção para uso da família com proposta mais básica
3. [modelo vendável 3] — alternativa prática para quem quer começar com algo mais enxuto

Se a ideia for priorizar segurança para criança, eu começaria pelas opções mais rasas."`
  );

  examples.push(
    `EXEMPLO RUIM:
"Sim, tem em estoque." sem a base confirmar estoque.`
  );

  examples.push(
    `EXEMPLO RUIM:
"Tenho foto sim." sem existir foto cadastrada.`
  );

  examples.push(
    `EXEMPLO RUIM:
"Entendi. Quero te ajudar de forma objetiva. Me diz só o principal neste momento: você quer entender opções, preço, instalação ou a melhor solução para o seu caso?"`
  );

  examples.push(
    `EXEMPLO RUIM:
"Ah, isso é para agora ou você está pesquisando para mais pra frente?"`
  );

  return examples.join("\n\n");
}

function buildCatalogEvidenceBlock(args: {
  analysis: CatalogIntentAnalysis;
  matchedCatalogItems: MatchedCatalogItem[];
  matchedPools: MatchedPool[];
  unavailableCatalogItems: MatchedCatalogItem[];
  unavailablePools: MatchedPool[];
}): string {
  const requestedBrand = args.analysis.requestedBrand || "nenhuma marca claramente identificada";
  const requestedProduct = args.analysis.requestedProductTerm || "nenhum produto claramente identificado";

  const catalogLines =
    args.matchedCatalogItems.length > 0
      ? args.matchedCatalogItems.map(buildCatalogItemContextLine).join("\n")
      : "- nenhum item de catálogo compatível localizado";

  const poolLines =
    args.matchedPools.length > 0
      ? args.matchedPools
          .map((match) => formatPoolLine(match.pool, match.hasPhoto))
          .join("\n")
      : "- nenhum modelo de piscina compatível localizado";

  const unavailableCatalogLines =
    args.unavailableCatalogItems.length > 0
      ? args.unavailableCatalogItems.map(buildCatalogItemContextLine).join("\n")
      : "- nenhum item de catálogo compatível sem disponibilidade localizado";

  const unavailablePoolLines =
    args.unavailablePools.length > 0
      ? args.unavailablePools
          .map((match) => formatPoolLine(match.pool, match.hasPhoto))
          .join("\n")
      : "- nenhum modelo de piscina compatível sem disponibilidade localizado";

  return `
EVIDÊNCIAS DE CATÁLOGO E MÍDIA
- cliente perguntou por produto de catálogo: ${args.analysis.asksAboutCatalogProduct ? "sim" : "não"}
- cliente perguntou por piscina/modelo: ${args.analysis.asksAboutPool ? "sim" : "não"}
- cliente pediu foto/imagem: ${args.analysis.asksForPhoto ? "sim" : "não"}
- cliente perguntou por disponibilidade/estoque: ${args.analysis.asksForAvailability ? "sim" : "não"}
- cliente perguntou por marca: ${args.analysis.asksForBrand ? "sim" : "não"}
- marca identificada no texto: ${requestedBrand}
- produto identificado no texto: ${requestedProduct}
- use modelos e itens com disponibilidade vendável como recomendação principal
- use modelos e itens sem disponibilidade vendável apenas como referência secundária, nunca como opção pronta para venda

ITENS DE CATÁLOGO MAIS COMPATÍVEIS
${catalogLines}

MODELOS DE PISCINA MAIS COMPATÍVEIS
${poolLines}

ITENS ENCONTRADOS NO CATÁLOGO, MAS SEM DISPONIBILIDADE VENDÁVEL
${unavailableCatalogLines}

MODELOS DE PISCINA ENCONTRADOS, MAS SEM DISPONIBILIDADE VENDÁVEL
${unavailablePoolLines}
`.trim();
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
  salesMethodologyInstructionBlock: string;
  commercialObjectiveBlock: string;
  shouldLoadPools: boolean;
  lastAiMessage: string | null;
  lastAiListedPools: boolean;
  questionIntentCount: number;
  responseMode: ResponseMode;
  intents: DetectedIntent[];
  nextBestQuestion: string | null;
  explicitCatalogRequest: boolean;
  catalogEvidenceBlock: string;
  responsePriorityBlock: string;
  examplesBlock: string;
  shouldPresentPoolRecommendations: boolean;
}) {
  const storeLabel = args.storeDisplayName || args.storeName || "a loja";
  const leadLabel = args.leadName || "cliente";
  const operationalBlock = buildOperationalOnboardingBlock(args.onboardingMap);
  const rawOnboardingSummary = buildRawOnboardingSummary(args.onboardingMap);

  return `
Você é a IA comercial real do projeto ZION atendendo a loja ${storeLabel}.
Você está falando com ${leadLabel}.
O nome cadastrado do cliente é ${leadLabel}; se esse nome parecer uma gíria ou apelido, trate como nome próprio quando usar.

MISSÃO
Responder como uma vendedora humana de WhatsApp: clara, natural, curta, útil e comercial.
Você deve aplicar SPIN e BANT com leveza, sem parecer interrogatório.

REGRA MÁXIMA
1. Responda primeiro o que o cliente perguntou.
2. Só depois conduza.
3. Se o cliente fez 2 ou mais perguntas, responda todas primeiro.
4. Nunca abra a resposta com pergunta se já dá para responder algo.
5. Nunca reabra a triagem ampla da conversa quando ela já está andando.
6. Nunca repita catálogo/modelos sem necessidade real, mas use continuidade clara e contexto suficiente para avançar quando o cliente já estiver aceitando ou pedindo opções.
7. Nunca invente estoque, foto, marca, serviço, disponibilidade ou informação ausente.
8. Quando não houver confirmação no banco, seja sincera e diga isso.

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
- escreva em português correto, com acentos, til, crase, vírgulas e interrogação quando fizer sentido
- não escreva errado de propósito para parecer humana
- não use sarcasmo, ironia, deboche, grosseria ou intimidade arriscada
- não use "tio", "mano", "parça", "amigo" ou apelidos parecidos como gíria, intimidade ou tratamento genérico
- se o nome cadastrado do cliente for "Tio", isso é nome próprio e pode ser usado com moderação, como qualquer outro nome; não trate como gíria
- em mensagens curtas e informais de WhatsApp, evite ponto final no fim da última frase; prefira terminar sem ponto, com ? ou ! quando fizer sentido
- em mensagens longas, sérias, explicações técnicas, contratos, orçamentos ou avisos formais, use pontuação completa normalmente
- a naturalidade de WhatsApp nunca pode contrariar SPIN, BANT, sinceridade comercial ou regras da loja

REGRAS OPERACIONAIS
- use a Configuração viva da loja como fonte principal de verdade; tecnicamente ela pode vir das respostas scoped do onboarding/configurações
- use as evidências de catálogo, estoque e foto fornecidas abaixo como fonte de verdade para produto e mídia
- não prometa preço, prazo, instalação, visita, desconto, pagamento ou cobertura regional sem base
- trate desconto máximo/percentual máximo como limite interno de negociação, não como oferta inicial para o cliente
- nunca revele automaticamente o percentual máximo de desconto configurado, como "até 18%", "até X%" ou equivalente, a menos que a configuração diga explicitamente para divulgar esse número ao cliente
- se o cliente perguntar sobre desconto, responda de forma comercial e protegendo margem: diga que a loja consegue avaliar desconto conforme produto, projeto, forma de pagamento ou condição configurada
- ao falar de desconto, venda valor antes de reduzir preço: destaque orientação, produto, instalação, qualidade, segurança, garantia, atendimento ou outro diferencial configurado antes de negociar abatimento
- só aproxime ou ofereça percentual específico quando isso estiver claramente autorizado nas regras de desconto, política comercial ou por aprovação humana
- se faltar base para cravar algo, responda com cautela comercial em vez de inventar certeza
- se houver regra clara de escalonamento humano, respeite
- não prometa enviar mídia, PDF, catálogo ou fotos como se a entrega já estivesse acontecendo
- cite modelos concretos quando fizer sentido e quando houver pedido explícito atual, continuidade afirmativa clara ou contexto suficiente com catálogo compatível
- quando o cliente já aceitou ver modelos ou pediu opções, não peça permissão de novo: use o catálogo e apresente 2 ou 3 recomendações reais com nome e motivo curto
- se houver contexto suficiente como espaço, uso por crianças, família, básico/premium ou instalação, use esse contexto para justificar a recomendação
- quando houver modelos compatíveis no contexto e o cliente pedir ou aceitar opções, apresente 2 ou 3 opções reais pelo nome, com um motivo curto para cada uma; só faça pergunta no fim se realmente faltar um dado decisivo
- quando houver modelos vendáveis compatíveis, eles devem ser a recomendação principal da resposta
- modelos sem disponibilidade vendável nunca devem entrar como opção principal se existirem modelos vendáveis compatíveis
- modelos sem disponibilidade vendável podem aparecer apenas como referência secundária, com linguagem comercial cuidadosa e sem tratar como produto pronto para venda
- se só houver referências sem disponibilidade confirmada, deixe claro que elas servem como referência de perfil e que a disponibilidade ainda precisa ser confirmada antes de fechar
- quando já tiver apresentado modelos antes, use novas mensagens do cliente para afunilar a recomendação; não repita a mesma lista, destaque a melhor opção ou as 2 melhores e explique o motivo
- quando houver opções úteis no catálogo, abra pela recomendação mais útil e só depois mencione limitação específica, se isso ainda for necessário para responder com honestidade
- evite abrir com "não temos", "não há estoque confirmado" ou "não consegui localizar" quando ainda existir orientação útil, alternativa vendável ou referência relevante para apresentar primeiro

REGRAS ESPECÍFICAS DE DESCONTO E NEGOCIAÇÃO
- Desconto máximo, percentual máximo ou limite interno são informações de bastidor comercial; use para não ultrapassar limite, não para abrir a negociação.
- Não responda "trabalhamos até X%" só porque existe um limite máximo configurado.
- Resposta preferida para pergunta genérica sobre desconto: "Conseguimos avaliar desconto dependendo do produto, do projeto e da forma de pagamento." Adapte com a explicação simples que estiver nas configurações.
- Se houver explicação de desconto nas configurações, use essa explicação em linguagem simples, sem revelar limite máximo se ele não estiver autorizado para divulgação.
- Se o cliente pressionar por desconto antes de escolher produto/projeto, conduza para entender o caso antes de abrir margem.
- Se desconto depender de aprovação humana, diga que dá para avaliar e que casos especiais podem precisar de confirmação da loja.
- A postura comercial é vender bem e proteger margem: não entregue o maior desconto possível logo no começo.

REGRAS ESPECÍFICAS DE SINCERIDADE
- Se o cliente pedir um produto específico e ele não aparecer entre os itens compatíveis, diga que você não conseguiu localizar esse item específico no catálogo atual.
- Se o cliente pedir uma marca específica e a marca não estiver claramente confirmada nos itens compatíveis, não diga que tem essa marca.
- Se houver item compatível ativo com estoque controlado positivo, você pode dizer que há disponibilidade confirmada, sem revelar a quantidade exata em estoque.
- Se houver item compatível ativo com estoque controlado e quantidade zero ou nula, diga que está em falta ou sem estoque confirmado.
- Se o item/modelo aparecer nas seções de encontrados sem disponibilidade vendável, não diga que não localizou no catálogo; diga que ele aparece no catálogo, mas que não há disponibilidade confirmada para venda no momento.
- Não use a palavra "unidades" ao falar de estoque/disponibilidade, salvo se houver autorização explícita em configuração futura.
- Se houver item compatível ativo sem controle de estoque, diga que ele aparece ativo no catálogo, mas que o estoque não está confirmado por esta base.
- Se o cliente pedir foto e não houver foto cadastrada para o item/modelo compatível, diga isso com clareza.
- Se não houver foto cadastrada, você pode oferecer outras opções que tenham foto, mas somente se essas opções realmente aparecerem nas evidências abaixo.
- Nunca diga que vai enviar foto agora como se o sistema já estivesse enviando automaticamente; apenas diga se há ou não foto cadastrada.

PRIORIDADE DESTA RESPOSTA
${args.responsePriorityBlock}

DIAGNÓSTICO
${args.commercialObjectiveBlock}

EVIDÊNCIAS DO CATÁLOGO
${args.catalogEvidenceBlock}

METODOLOGIA COMERCIAL OFICIAL DO ZION
${args.salesMethodologyInstructionBlock}

COMPORTAMENTO OFICIAL DO ZION
${args.behaviorInstructionBlock}

EXEMPLOS DE TOM
${args.examplesBlock}

BASE OPERACIONAL E CONFIGURAÇÃO VIVA DA LOJA
${operationalBlock}

RESUMO BRUTO DAS RESPOSTAS CONFIGURADAS
${rawOnboardingSummary}

ETAPA DO LEAD
- lead_state: ${args.leadState || "desconhecido"}

HISTÓRICO RECENTE
${args.recentHistory || "Sem histórico recente relevante."}

OPÇÕES DE PISCINA DISPONÍVEIS NO CONTEXTO
${args.availablePoolsText || "Nenhuma opção de piscina carregada no contexto."}

SINAIS DO CONTEXTO
- múltiplas intenções na última mensagem: ${args.questionIntentCount >= 2 ? "sim" : "não"}
- pedido explícito atual de catálogo/fotos/modelos: ${args.explicitCatalogRequest ? "sim" : "não"}
- deve apresentar recomendações de piscina agora: ${args.shouldPresentPoolRecommendations ? "sim" : "não"}
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
- use português correto; não remova acentos, til, crase, vírgulas nem interrogação necessária
- não termine mensagens curtas e informais com ponto final, a menos que o tom precise ser formal ou sério
- não use "tio" nem apelidos íntimos como gíria, abertura genérica ou tratamento padrão
- se o nome real do cliente for "Tio", pode usar o nome com naturalidade e moderação, sem forçar em toda resposta
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
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const enumeratedLines = lines.filter((line) => /^\d+\./.test(line)).length;
  const bulletedPoolLines = lines.filter(
    (line) =>
      /^[-*•]/.test(line) &&
      (line.includes("piscina") ||
        /\b(fibra|vinil|pastilha|036|054|072)\b/.test(line))
  ).length;
  const namedPoolMatches = text.match(
    /\bpiscina\s+[a-z0-9][a-z0-9\s/-]{1,40}\b/g
  );
  const namedPoolCount = new Set(namedPoolMatches || []).size;
  const recommendationLanguage =
    text.includes("essas opcoes") ||
    text.includes("essas opções") ||
    text.includes("estas opcoes") ||
    text.includes("estas opções") ||
    text.includes("eu indicaria") ||
    text.includes("eu recomendaria") ||
    text.includes("eu olharia primeiro");
  const comparisonSignals =
    text.includes("material") &&
    text.includes("formato") &&
    (text.includes("valor de referencia") ||
      text.includes("tamanho aproximado"));

  if (namedPoolCount >= 2) return true;
  if (enumeratedLines >= 2 && namedPoolCount >= 1) return true;
  if (bulletedPoolLines >= 2) return true;
  if (recommendationLanguage && (namedPoolCount >= 1 || enumeratedLines >= 2)) {
    return true;
  }

  return comparisonSignals;
}


function applyWhatsAppOutputStyle(
  text: string,
  responseMode: ResponseMode,
  leadName?: string | null
): string {
  const leadNameIsTio = normalizeText(leadName) === "tio";
  let withoutRiskyIntimacy = String(text || "")
    .replace(/^\s*e aí[,!\s]+/i, "")
    .replace(/^\s*mano[,!\s]+/i, "")
    .trim();

  // "tio" não deve ser usado como gíria ou intimidade.
  // Porém, se o nome cadastrado do cliente for Tio, isso é nome próprio e pode permanecer.
  if (!leadNameIsTio) {
    withoutRiskyIntimacy = withoutRiskyIntimacy.replace(/^\s*tio[,!\s]+/i, "").trim();
  }

  const lines = withoutRiskyIntimacy.split("\n");

  const styledLines = lines.map((line) => {
    const trimmed = line.trimEnd();

    if (!trimmed) return line;
    if (!trimmed.endsWith(".")) return line;
    if (/\.\.\.$/.test(trimmed)) return line;
    if (/\b(?:sr|sra|dr|dra|av|obs)\.$/i.test(trimmed)) return line;
    if (/https?:\/\//i.test(trimmed)) return line;
    if (/\b\d+[.]\d+\b/.test(trimmed)) return line;

    const isBulletOrNumbered = /^\s*(?:[-*•]|\d+[.)])\s+/.test(trimmed);
    const isShortInformalLine = trimmed.length <= 180;
    const shouldRemoveFinalPeriod = responseMode === "objective" || isShortInformalLine || isBulletOrNumbered;

    if (!shouldRemoveFinalPeriod) return line;

    return trimmed.slice(0, -1);
  });

  let styled = styledLines.join("\n").trim();

  if (styled.endsWith(".")) {
    const lastParagraph = styled.split(/\n{2,}/).pop() || styled;
    if (lastParagraph.length <= 220 && !/\.\.\.$/.test(lastParagraph)) {
      styled = styled.slice(0, -1).trimEnd();
    }
  }

  return styled;
}

function cleanupAiText(text: string, responseMode: ResponseMode, leadName?: string | null): string {
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

  return applyWhatsAppOutputStyle(cleaned.trim(), responseMode, leadName);
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
    const lastAiOfferedPoolOptions = detectLastAiOfferedPoolOptions(lastAiMessage);
    const explicitCatalogRequest = isExplicitCatalogRequest(lastCustomerMessage);
    const catalogIntent = analyzeCatalogIntent(lastCustomerMessage);
    const customerConversationText = buildCustomerConversationText(orderedMessages, lastCustomerMessage);
    const affirmativeContinuation = isAffirmativeReply(lastCustomerMessage);
    const customerAskedToRepeatPoolOptions =
      asksToRepeatPoolOptions(lastCustomerMessage);
    const recentPoolContext =
      hasUsefulPoolContext(customerConversationText) ||
      detectLastAiListedPools(lastAiMessage) ||
      lastAiOfferedPoolOptions;
    const directPoolRecommendationRequest =
      catalogIntent.asksAboutPool &&
      (explicitCatalogRequest || looksLikePoolRecommendationRequest(lastCustomerMessage));
    const genericPoolOpening = isGenericPoolOpening(lastCustomerMessage);
    const shouldPresentPoolRecommendations =
      (!genericPoolOpening && customerAskedToRepeatPoolOptions) ||
      (!lastAiListedPools &&
        !genericPoolOpening &&
        (directPoolRecommendationRequest ||
          (lastAiOfferedPoolOptions && affirmativeContinuation) ||
          (recentPoolContext && affirmativeContinuation) ||
          (recentPoolContext &&
            looksLikePoolRecommendationRequest(lastCustomerMessage))));

    const shouldLoadPools =
      explicitCatalogRequest ||
      (looksLikeComparisonQuestion(customerConversationText) && !lastAiListedPools) ||
      (catalogIntent.asksAboutPool && !genericPoolOpening) ||
      shouldPresentPoolRecommendations ||
      (recentPoolContext && affirmativeContinuation);

    let availablePoolsText = "Nenhuma opção de piscina carregada no contexto.";
    let poolCountUsed = 0;
    let matchedPools: MatchedPool[] = [];
    let unavailableMatchedPools: MatchedPool[] = [];

    let pools: PoolRow[] = [];
    if (shouldLoadPools || catalogIntent.asksForPhoto || catalogIntent.asksAboutPool || shouldPresentPoolRecommendations) {
      const { data: poolsData, error: poolsError } = await supabase
        .from("pools")
        .select(
          "id, name, material, shape, width_m, length_m, depth_m, price, description, photo_url, is_active, track_stock, stock_quantity"
        )
        .eq("organization_id", organizationId)
        .eq("store_id", resolvedStoreId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(100);

      if (poolsError) {
        return {
          ok: false,
          error: "LOAD_POOLS_FAILED",
          message: poolsError.message,
        };
      }

      pools = (poolsData || []) as PoolRow[];
    }

    let poolPhotoMap = new Map<string, number>();
    if (pools.length > 0) {
      const poolIds = pools.map((pool) => pool.id);

      const { data: poolPhotosData, error: poolPhotosError } = await supabase
        .from("pool_photos")
        .select("id, pool_id")
        .in("pool_id", poolIds);

      if (poolPhotosError) {
        return {
          ok: false,
          error: "LOAD_POOL_PHOTOS_FAILED",
          message: poolPhotosError.message,
        };
      }

      for (const row of (poolPhotosData || []) as PoolPhotoRow[]) {
        poolPhotoMap.set(row.pool_id, (poolPhotoMap.get(row.pool_id) || 0) + 1);
      }
    }

    if (pools.length > 0) {
      const scoredPools = pools
        .map((pool) => ({
          pool,
          hasPhoto: (poolPhotoMap.get(pool.id) || 0) > 0 || !!pool.photo_url,
          score: scorePool(pool, customerConversationText),
        }))
        .filter((match) => shouldLoadPools || match.score > 0)
        .sort((a, b) => b.score - a.score);

      matchedPools = scoredPools
        .filter((match) =>
          isSellableInventoryState({
            isActive: match.pool.is_active,
            trackStock: match.pool.track_stock,
            stockQuantity: match.pool.stock_quantity,
          }).isSellable
        )
        .slice(0, 3);

      const matchedPoolIds = new Set(matchedPools.map((match) => match.pool.id));
      const matchedPoolNames = new Set(
        matchedPools
          .map((match) => normalizeText(match.pool.name))
          .filter(Boolean)
      );

      unavailableMatchedPools = scoredPools
        .filter((match) =>
          !isSellableInventoryState({
            isActive: match.pool.is_active,
            trackStock: match.pool.track_stock,
            stockQuantity: match.pool.stock_quantity,
          }).isSellable
        )
        .filter((match) => {
          if (matchedPoolIds.has(match.pool.id)) return false;
          const normalizedName = normalizeText(match.pool.name);
          return !normalizedName || !matchedPoolNames.has(normalizedName);
        })
        .slice(0, 3);

      const usablePools = pools.filter((pool) =>
        isSellableInventoryState({
          isActive: pool.is_active,
          trackStock: pool.track_stock,
          stockQuantity: pool.stock_quantity,
        }).isSellable
      );

      poolCountUsed = usablePools.length;

      if (matchedPools.length > 0) {
        availablePoolsText = matchedPools
          .map((match) => formatPoolLine(match.pool, match.hasPhoto))
          .join("\n");
      } else if (usablePools.length > 0 && shouldLoadPools) {
        availablePoolsText = usablePools
          .slice(0, 3)
          .map((pool) => formatPoolLine(pool, (poolPhotoMap.get(pool.id) || 0) > 0 || !!pool.photo_url))
          .join("\n");
      }
    }

    let catalogItems: CatalogItemRow[] = [];
    if (
      catalogIntent.asksAboutCatalogProduct ||
      catalogIntent.asksForBrand ||
      catalogIntent.asksForPhoto ||
      catalogIntent.asksForAvailability ||
      catalogIntent.asksForPrice
    ) {
      const { data: catalogItemsData, error: catalogItemsError } = await supabase
        .from("store_catalog_items")
        .select(
          "id, organization_id, store_id, sku, name, description, price_cents, currency, is_active, metadata, created_at, updated_at, track_stock, stock_quantity"
        )
        .eq("organization_id", organizationId)
        .eq("store_id", resolvedStoreId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(60);

      if (catalogItemsError) {
        return {
          ok: false,
          error: "LOAD_CATALOG_ITEMS_FAILED",
          message: catalogItemsError.message,
        };
      }

      catalogItems = (catalogItemsData || []) as CatalogItemRow[];
    }

    let catalogItemPhotos: CatalogItemPhotoRow[] = [];
    if (catalogItems.length > 0) {
      const catalogItemIds = catalogItems.map((item) => item.id);

      const { data: catalogPhotosData, error: catalogPhotosError } = await supabase
        .from("store_catalog_item_photos")
        .select(
          "id, catalog_item_id, storage_path, file_name, file_size_bytes, sort_order, created_at"
        )
        .in("catalog_item_id", catalogItemIds)
        .order("sort_order", { ascending: true });

      if (catalogPhotosError) {
        return {
          ok: false,
          error: "LOAD_CATALOG_ITEM_PHOTOS_FAILED",
          message: catalogPhotosError.message,
        };
      }

      catalogItemPhotos = (catalogPhotosData || []) as CatalogItemPhotoRow[];
    }

    const photoMap = new Map<string, CatalogItemPhotoRow[]>();
    for (const photo of catalogItemPhotos) {
      const existing = photoMap.get(photo.catalog_item_id) || [];
      existing.push(photo);
      photoMap.set(photo.catalog_item_id, existing);
    }

    const scoredCatalogItems: MatchedCatalogItem[] = catalogItems
      .map((item) => ({
        item,
        photos: photoMap.get(item.id) || [],
        score: scoreCatalogItem(item, catalogIntent),
      }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score);

    const matchedCatalogItems: MatchedCatalogItem[] = scoredCatalogItems
      .filter((match) =>
        isSellableInventoryState({
          isActive: match.item.is_active,
          trackStock: match.item.track_stock,
          stockQuantity: match.item.stock_quantity,
        }).isSellable
      )
      .slice(0, 5);

    const matchedCatalogItemIds = new Set(matchedCatalogItems.map((match) => match.item.id));
    const matchedCatalogItemNames = new Set(
      matchedCatalogItems
        .map((match) => normalizeText(match.item.name))
        .filter(Boolean)
    );

    const unavailableMatchedCatalogItems: MatchedCatalogItem[] = scoredCatalogItems
      .filter((match) =>
        !isSellableInventoryState({
          isActive: match.item.is_active,
          trackStock: match.item.track_stock,
          stockQuantity: match.item.stock_quantity,
        }).isSellable
      )
      .filter((match) => {
        if (matchedCatalogItemIds.has(match.item.id)) return false;
        const normalizedName = normalizeText(match.item.name);
        return !normalizedName || !matchedCatalogItemNames.has(normalizedName);
      })
      .slice(0, 5);

    const commercialObjective = buildCommercialObjective({
      orderedMessages,
      lastCustomerMessage,
      explicitCatalogRequest,
      lastAiListedPools,
    });

    const commercialObjectiveBlock = buildCommercialObjectiveBlock(commercialObjective);

    const catalogEvidenceBlock = buildCatalogEvidenceBlock({
      analysis: catalogIntent,
      matchedCatalogItems,
      matchedPools,
      unavailableCatalogItems: unavailableMatchedCatalogItems,
      unavailablePools: unavailableMatchedPools,
    });

    const responsePriorityBlock = buildResponsePriorityBlock({
      intents: commercialObjective.intents,
      responseMode: commercialObjective.responseMode,
      explicitCatalogRequest,
      lastAiListedPools,
      lastCustomerMessage,
      hasCatalogEvidence: matchedCatalogItems.length > 0,
      hasPoolEvidence: matchedPools.length > 0,
      shouldPresentPoolRecommendations,
    });

    const examplesBlock = buildExamplesBlock({
      intents: commercialObjective.intents,
      nextBestQuestion: commercialObjective.nextBestQuestion,
      explicitCatalogRequest,
    });

    const salesMethodologyInstructionBlock = buildSalesMethodologyInstructionBlock({
      lastCustomerMessage,
      hasCatalogEvidence: matchedCatalogItems.length > 0,
      hasPoolEvidence: matchedPools.length > 0,
      responseMode: commercialObjective.responseMode,
    });

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
      salesMethodologyInstructionBlock,
      commercialObjectiveBlock,
      shouldLoadPools,
      lastAiMessage,
      lastAiListedPools,
      questionIntentCount,
      responseMode: commercialObjective.responseMode,
      intents: commercialObjective.intents,
      nextBestQuestion: commercialObjective.nextBestQuestion,
      explicitCatalogRequest,
      catalogEvidenceBlock,
      responsePriorityBlock,
      examplesBlock,
      shouldPresentPoolRecommendations,
    });

    const input = buildModelInput(orderedMessages);

    const response = await openai.responses.create({
      model,
      instructions,
      input,
      max_output_tokens: commercialObjective.responseMode === "objective" ? 180 : 240,
    });

    const usage = extractOpenAiUsage(response, model);

    const aiText = cleanupAiText(
      String(response.output_text || "").trim(),
      commercialObjective.responseMode,
      lead.name
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
      usage,
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
