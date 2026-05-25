import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { isSellableInventoryState } from "../catalog/availability";
import { buildBehaviorInstructionBlock } from "./ai-sales-behavior";
import { buildSalesMethodologyInstructionBlock } from "./ai-sales-methodology";
import { buildSalesResponseBrain } from "./ai-sales-response-brain";

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
  media_url: string | null;
  metadata: Record<string, unknown> | null;
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
  organization_id: string | null;
  store_id: string | null;
  storage_path: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  sort_order: number | null;
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

type PaymentOrClosingSubtype =
  | "payment_info"
  | "pix_key_request"
  | "payment_submitted"
  | "receipt_submitted"
  | "reservation_or_hold"
  | "closing_or_buying"
  | "contract_request"
  | "down_payment_or_entry"
  | "none";

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

export type OperationalFollowUpDecisionKind =
  | "none"
  | "schedule_resume"
  | "soft_pause"
  | "stop_contact";

export type OperationalFollowUpDecisionReason =
  | "customer_requested_tomorrow"
  | "customer_requested_next_week"
  | "customer_requested_next_month"
  | "customer_thinking"
  | "customer_not_interested"
  | "customer_hard_stop"
  | "unclear_pause"
  | "none";

export type OperationalFollowUpDecision = {
  kind: OperationalFollowUpDecisionKind;
  reason: OperationalFollowUpDecisionReason;
  timingLabel?: string | null;
  requestedTiming?: string | null;
};

export type CommercialHandoffType =
  | "commercial_visit_request"
  | "commercial_quote_request";

export type CommercialHandoffContext = {
  taskType: CommercialHandoffType;
  intent: "visit_request" | "quote_request";
  reason:
    | "direct_visit_request"
    | "direct_quote_request"
    | "visit_after_commercial_momentum";
  shouldCreateTask: boolean;
  replyOverride: string | null;
  customerName: string | null;
  customerPhone: string | null;
  lastCustomerMessage: string;
  conversationSummary: string;
  spaceText: string | null;
  requestedAreaM2: number | null;
  locationText: string | null;
  preferredPeriodText: string | null;
  recommendedModel: string | null;
  relevantObjection: string | null;
  customerPreferences: string | null;
  adModelOrRequestedModel: string | null;
  nextStep: string;
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
  pattern: ConversationPattern;
  paymentOrClosingSubtype: PaymentOrClosingSubtype;
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

type ConversationPattern =
  | "generic_pool_opening"
  | "pool_size_discovery"
  | "pool_children_context"
  | "specific_model_or_ad_request"
  | "price_question"
  | "discount_question"
  | "payment_or_closing_flow"
  | "photo_or_simulation_request"
  | "chemical_problem"
  | "pause_or_disinterest"
  | "catalog_recommendation_or_refinement"
  | "general_sales_conversation";

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

type ProductPhotoRequestContext =
  | { kind: "not_applicable" }
  | {
      kind: "resolved_with_photo" | "resolved_without_photo";
      source: "explicit" | "history";
      targetType: "pool" | "catalog_item";
      modelName: string;
    }
  | {
      kind: "ambiguous";
      source: "history" | "request";
    }
  | {
      kind: "generic_request";
    };

export type CatalogPhotoActionContext = {
  shouldSend: true;
  reason: "explicit_strong_product_photo_request";
  poolId: string;
  poolName: string;
  organizationId: string;
  storeId: string;
  source: "pool_photos" | "pool_photo_url";
  bucket: "pool-photos" | null;
  storagePath: string | null;
  publicUrl: string;
  caption: string;
};

type CanonicalPoolModelKey = {
  type: string;
  number: number;
  key: string;
};

type RequestedPoolReference = {
  raw: string;
  normalized: string;
  fromAd: boolean;
  canonicalModelKey: CanonicalPoolModelKey | null;
};

type PoolReferenceMatchStrength =
  | "exact"
  | "strong"
  | "weak"
  | "none";

type RecommendationPolicy = {
  allowRecommendations: boolean;
  poolOptionCount: 0 | 1 | 2 | 3;
  catalogOptionCount: 0 | 1 | 2 | 3;
  allowOnlySimilarLanguage: boolean;
  requireExactOrStrongMatchForNamedPool: boolean;
  reason: string;
};

type PhotoOrSimulationSubtype =
  | "simulation_visual_request"
  | "local_photo_context"
  | "product_photo_specific"
  | "product_photo_without_model"
  | "general_photo_request";

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
        operationalFollowUpDecision: OperationalFollowUpDecision;
        commercialHandoff: CommercialHandoffContext | null;
        catalogPhotoAction: CatalogPhotoActionContext | null;
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

const POOL_PHOTOS_PUBLIC_BUCKET = "pool-photos";

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

function hasConfiguredTechnicalVisit(onboardingMap: Record<string, string>): boolean {
  const rawValue = String(onboardingMap.offers_technical_visit || "").trim();
  const normalizedValue = normalizeText(rawValue);
  if (["sim", "yes", "true", "1"].includes(normalizedValue)) return true;

  const summary = normalizeText(onboardingMap.technical_visit_rules_summary || "");
  const rules = normalizeText(onboardingMap.technical_visit_rules || "");

  return Boolean(summary || rules);
}

function shouldSuggestVisitAdvance(args: {
  facts: ConversationFactState;
  intents: DetectedIntent[];
  pattern: ConversationPattern;
  lastCustomerMessage: string;
  offersTechnicalVisit: boolean;
  lastAiListedPools: boolean;
  lastAiMessage?: string | null;
}): boolean {
  if (!args.offersTechnicalVisit) return false;
  if (looksLikeExplicitVisitRequest(args.lastCustomerMessage)) return true;
  if (looksLikeVisitAcceptanceAfterSuggestion(args.lastCustomerMessage, args.lastAiMessage || null)) {
    return true;
  }
  if (looksLikePaymentQuestion(args.lastCustomerMessage)) return false;
  if (hasSpecificPoolReference(args.lastCustomerMessage) && !args.lastAiListedPools) return false;
  return false;
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
  const hasBudgetConstraintSignal = looksLikeDiscountQuestionV2(text);

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

  void notInterestedSignals;

  const strongNotInterestedSignals = [
    "nao quero mais",
    "nÃ£o quero mais",
    "nao tenho interesse",
    "nÃ£o tenho interesse",
    "sem interesse",
    "desisti",
    "nao precisa",
    "nÃ£o precisa",
    "pode deixar",
    "pode parar",
    "cancela",
    "nao vou comprar",
    "nÃ£o vou comprar",
    "pare de mandar",
    "para de mandar",
    "nao me chama",
    "nÃ£o me chama",
    "nao me manda mensagem",
    "nÃ£o me manda mensagem",
    "ja resolvi",
    "jÃ¡ resolvi",
    "ja resolvi em outro lugar",
    "jÃ¡ resolvi em outro lugar",
    "comprei em outro lugar",
    "me tira",
    "remove meu contato",
  ];

  if (!hasBudgetConstraintSignal && strongNotInterestedSignals.some((signal) => t.includes(signal))) {
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

function isHardStopMessage(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("pare de mandar") ||
    t.includes("para de mandar") ||
    t.includes("me tira") ||
    t.includes("remove meu contato")
  );
}

function inferOperationalFollowUpDecision(args: {
  lastCustomerMessage: string;
  patienceSignal: CustomerPatienceSignal;
}): OperationalFollowUpDecision {
  const { lastCustomerMessage, patienceSignal } = args;

  if (patienceSignal.status === "not_interested") {
    return {
      kind: "stop_contact",
      reason: isHardStopMessage(lastCustomerMessage)
        ? "customer_hard_stop"
        : "customer_not_interested",
      timingLabel: patienceSignal.followUpTiming || null,
      requestedTiming: patienceSignal.followUpTiming || null,
    };
  }

  if (patienceSignal.status === "follow_up_requested") {
    const requestedTiming = patienceSignal.followUpTiming || null;

    if (requestedTiming === "amanhã") {
      return {
        kind: "schedule_resume",
        reason: "customer_requested_tomorrow",
        timingLabel: requestedTiming,
        requestedTiming,
      };
    }

    if (requestedTiming === "semana que vem") {
      return {
        kind: "schedule_resume",
        reason: "customer_requested_next_week",
        timingLabel: requestedTiming,
        requestedTiming,
      };
    }

    if (requestedTiming === "mês que vem") {
      return {
        kind: "schedule_resume",
        reason: "customer_requested_next_month",
        timingLabel: requestedTiming,
        requestedTiming,
      };
    }

    return {
      kind: "soft_pause",
      reason: "unclear_pause",
      timingLabel: requestedTiming,
      requestedTiming,
    };
  }

  if (patienceSignal.status === "thinking") {
    return {
      kind: "soft_pause",
      reason: "customer_thinking",
      timingLabel: patienceSignal.followUpTiming || null,
      requestedTiming: patienceSignal.followUpTiming || null,
    };
  }

  if (patienceSignal.status === "unclear_pause") {
    return {
      kind: "soft_pause",
      reason: "unclear_pause",
      timingLabel: patienceSignal.followUpTiming || null,
      requestedTiming: patienceSignal.followUpTiming || null,
    };
  }

  return {
    kind: "none",
    reason: "none",
    timingLabel: null,
    requestedTiming: null,
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

function collectConversationFacts(messages: MessageRow[]): ConversationFactState {
  const history = messages
    .filter((msg) => normalizeText(msg.sender) !== "ai_sales")
    .map((msg) => getEffectiveMessageContent(msg))
    .join(" \n ");
  const text = normalizeText(history);

  return {
    budgetKnown:
      text.includes("orcamento") ||
      text.includes("faixa") ||
      text.includes("mais barato") ||
      text.includes("economico") ||
      text.includes("economica"),
    authorityKnown:
      text.includes("meu marido") ||
      text.includes("minha esposa") ||
      text.includes("vou ver com") ||
      text.includes("vou falar com"),
    needKnown:
      text.includes("simples") ||
      text.includes("conforto") ||
      text.includes("filho") ||
      text.includes("crianca") ||
      text.includes("compact") ||
      text.includes("premium") ||
      text.includes("basic"),
    timingKnown:
      looksLikeTimingSignal(history),
    locationKnown:
      text.includes("bairro") || text.includes("cidade") || text.includes("regiao") || text.includes("região"),
    sizeKnown:
      extractRequestedAreaM2(history) != null || text.includes("espaco") || text.includes("medida") || text.includes("metros quadrados"),
    installationInterestKnown: looksLikeInstallationQuestion(history),
    paymentInterestKnown: looksLikePaymentQuestion(history) || text.includes("pix") || text.includes("parcelado"),
    visitInterestKnown: looksLikeTechnicalVisitQuestion(history),
  };
}

function countQuestionIntents(lastCustomerMessage: string): number {
  const intents = detectIntents(lastCustomerMessage);
  if (intents.length > 0) return intents.length;
  return lastCustomerMessage.includes("?") ? 1 : 0;
}

function looksLikeDirectQuoteRequest(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("quero orcamento") ||
    t.includes("quero orçamento") ||
    t.includes("faz um orcamento") ||
    t.includes("faz um orçamento") ||
    t.includes("me manda um orcamento") ||
    t.includes("me manda um orçamento") ||
    t.includes("preciso de um orcamento") ||
    t.includes("preciso de um orçamento")
  );
}

function looksLikeExplicitVisitRequest(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("agendar uma visita") ||
    t.includes("marcar uma visita") ||
    t.includes("marca uma visita") ||
    t.includes("pode agendar uma visita") ||
    t.includes("da pra agendar uma visita") ||
    t.includes("pode vir aqui ver") ||
    t.includes("quero uma visita tecnica") ||
    t.includes("quero que alguem venha avaliar")
  );
}

function looksLikeVisitAcceptanceAfterSuggestion(
  text: string,
  lastAiMessage: string | null | undefined
): boolean {
  const normalizedCustomerText = normalizeText(text);
  const normalizedLastAiMessage = normalizeText(lastAiMessage || "");

  if (!normalizedCustomerText || !normalizedLastAiMessage) return false;

  const aiSuggestedVisit =
    normalizedLastAiMessage.includes("visita") &&
    (normalizedLastAiMessage.includes("verificar") ||
      normalizedLastAiMessage.includes("horario") ||
      normalizedLastAiMessage.includes("cidade") ||
      normalizedLastAiMessage.includes("periodo"));

  if (!aiSuggestedVisit) return false;

  return (
    normalizedCustomerText === "sim" ||
    normalizedCustomerText === "sim pode verificar" ||
    normalizedCustomerText === "pode verificar" ||
    normalizedCustomerText === "pode ver um horario" ||
    normalizedCustomerText === "pode marcar" ||
    normalizedCustomerText === "pode agendar" ||
    normalizedCustomerText === "vamos fazer a visita"
  );
}

function looksLikeExtendedQuoteRequest(text: string): boolean {
  const t = normalizeText(text);

  return (
    looksLikeDirectQuoteRequest(text) ||
    t.includes("me passa um orcamento") ||
    t.includes("pode mandar orcamento") ||
    t.includes("quero proposta") ||
    t.includes("faz uma proposta")
  );
}

function extractLocationSnippet(text: string): string | null {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const patterns = [
    /(?:moro em|sou de|fica em|aqui em|na cidade de|cidade)\s+([a-z0-9\u00c0-\u017f\s\-]{2,60})/i,
    /(?:bairro)\s+([a-z0-9\u00c0-\u017f\s\-]{2,60})/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const value = String(match?.[1] || "").trim().replace(/[.!?,;:]+$/g, "");
    if (value) return value;
  }

  return null;
}

function extractPreferredPeriodSnippet(text: string): string | null {
  const raw = String(text || "").trim();
  const normalized = normalizeText(raw);

  if (!normalized) return null;
  if (normalized.includes("manha") || normalized.includes("manhã")) return "manhã";
  if (normalized.includes("tarde")) return "tarde";
  if (normalized.includes("noite")) return "noite";
  if (normalized.includes("fim de semana") || normalized.includes("final de semana")) {
    return "fim de semana";
  }
  if (normalized.includes("amanha") || normalized.includes("amanhã")) return "amanhã";
  if (normalized.includes("semana que vem")) return "semana que vem";

  const explicitDay = raw.match(
    /\b(?:segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)\b/i
  );
  return explicitDay?.[0] || null;
}

function extractRelevantObjection(text: string): string | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  if (looksLikeDiscountQuestionV2(text)) return "objeção de preço/orçamento";
  if (normalized.includes("caro")) return "cliente achou caro";
  if (normalized.includes("mais barato") || normalized.includes("barato")) {
    return "cliente quer opção mais barata";
  }
  return null;
}

function extractSpaceText(text: string): string | null {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const areaPatterns = [
    /\b\d{1,2}(?:[.,]\d+)?\s*(?:m|metro|metros)\s*(?:x|por)\s*\d{1,2}(?:[.,]\d+)?\s*(?:m|metro|metros)\b/i,
    /\b\d{1,2}(?:[.,]\d+)?\s*(?:x|por)\s*\d{1,2}(?:[.,]\d+)?\b/i,
    /\b\d{1,3}(?:[.,]\d+)?\s*m[²2]\b/i,
  ];

  for (const pattern of areaPatterns) {
    const match = raw.match(pattern);
    const value = String(match?.[0] || "").trim();
    if (value) return value;
  }

  return null;
}

function extractCustomerPreferencesText(text: string): string | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  const preferences: string[] = [];

  if (normalized.includes("pequena") || normalized.includes("compacta")) {
    preferences.push("piscina pequena/compacta");
  }
  if (
    normalized.includes("barata") ||
    normalized.includes("mais barata") ||
    normalized.includes("mais em conta") ||
    normalized.includes("economica") ||
    normalized.includes("nao quero gastar muito")
  ) {
    preferences.push("opcao mais economica");
  }

  if (preferences.length === 0) return null;
  return Array.from(new Set(preferences)).join(" e ");
}

function buildCommercialConversationSummary(args: {
  leadName?: string | null;
  lastCustomerMessage: string;
  adModelOrRequestedModel: string | null;
  spaceText: string | null;
  requestedAreaM2: number | null;
  locationText: string | null;
  preferredPeriodText: string | null;
  recommendedModel: string | null;
  relevantObjection: string | null;
  customerPreferences: string | null;
  nextStep: string;
}) {
  const parts = [
    args.leadName ? `Cliente: ${args.leadName}.` : null,
    args.adModelOrRequestedModel ? `Modelo citado pelo cliente/anuncio: ${args.adModelOrRequestedModel}.` : null,
    args.spaceText ? `Espaco informado: ${args.spaceText}.` : null,
    args.lastCustomerMessage ? `Última mensagem: "${args.lastCustomerMessage}".` : null,
    args.requestedAreaM2 != null ? `Espaço informado: ${args.requestedAreaM2} m².` : null,
    args.locationText ? `Local: ${args.locationText}.` : null,
    args.customerPreferences ? `Preferencias do cliente: ${args.customerPreferences}.` : null,
    args.preferredPeriodText ? `Melhor período citado: ${args.preferredPeriodText}.` : null,
    args.recommendedModel ? `Modelo recomendado no contexto: ${args.recommendedModel}.` : null,
    args.relevantObjection ? `Ponto comercial relevante: ${args.relevantObjection}.` : null,
    args.nextStep ? `Proximo passo: ${args.nextStep}` : null,
  ].filter(Boolean);

  return parts.join(" ");
}

function buildCommercialHandoffReply(args: {
  handoffType: CommercialHandoffType;
  locationText: string | null;
  preferredPeriodText: string | null;
  requestedAreaM2: number | null;
}): string {
  if (args.handoffType === "commercial_visit_request") {
    if (args.locationText && args.preferredPeriodText) {
      return "Perfeito. Vou verificar a disponibilidade com a loja e te retorno com o melhor horário.";
    }

    if (!args.locationText && !args.preferredPeriodText) {
      return "Posso te ajudar com isso. Me confirma sua cidade e qual dia/período costuma ser melhor para você que eu verifico com a loja.";
    }

    if (!args.locationText) {
      return "Posso te ajudar com isso. Me confirma sua cidade que eu verifico com a loja o melhor horário para a visita.";
    }

    return "Posso te ajudar com isso. Me confirma qual dia ou período costuma ser melhor para você que eu verifico com a loja.";
  }

  if (args.requestedAreaM2 != null || args.locationText) {
    return "Perfeito. Vou encaminhar seu pedido de orçamento para a loja e te retorno com as informações certas.";
  }

  return "Posso te ajudar com isso. Me confirma sua cidade e, se já tiver, o espaço ou medida que você quer aproveitar que eu encaminho para a loja da forma certa.";
}

function buildCommercialHandoffReplyV2(args: {
  handoffType: CommercialHandoffType;
  locationText: string | null;
  preferredPeriodText: string | null;
  requestedAreaM2: number | null;
}): string {
  if (args.handoffType === "commercial_visit_request") {
    if (args.locationText && args.preferredPeriodText) {
      return `Perfeito. Vou verificar na agenda os horarios disponiveis para ${args.preferredPeriodText} e te falo em seguida.`;
    }

    if (!args.locationText && !args.preferredPeriodText) {
      return "Posso te ajudar com isso. Vou verificar na agenda os dias que temos disponiveis. Me confirma sua cidade e qual dia ou periodo costuma ser melhor para voce.";
    }

    if (!args.locationText) {
      return "Posso te ajudar com isso. Me confirma sua cidade que eu vejo na agenda os melhores horarios para a visita.";
    }

    return "Posso te ajudar com isso. Vou verificar na agenda os dias que temos disponiveis. Qual dia ou periodo costuma ser melhor para voce?";
  }

  if (args.requestedAreaM2 != null || args.locationText) {
    return "Perfeito. Ja tenho parte das informacoes para montar isso certinho. So me confirma se voce quer incluir instalacao e se tem mais algum item que quer colocar no orcamento.";
  }

  return "Posso te ajudar com isso. Me confirma sua cidade e, se ja tiver, o espaco ou medida que voce quer aproveitar para eu montar isso certinho.";
}

function inferCommercialHandoff(args: {
  lastCustomerMessage: string;
  customerConversationText: string;
  lastAiMessage: string | null;
  leadName: string | null;
  leadPhone: string | null;
  facts: ConversationFactState;
  intents: DetectedIntent[];
  pattern: ConversationPattern;
  patienceSignal: CustomerPatienceSignal;
  offersTechnicalVisit: boolean;
  lastAiListedPools: boolean;
  recommendedModel: string | null;
}): CommercialHandoffContext | null {
  if (args.patienceSignal.status === "not_interested") return null;

  const handoffSourceText = args.customerConversationText || args.lastCustomerMessage;
  const requestedAreaM2 = extractRequestedAreaM2(handoffSourceText);
  const spaceText = extractSpaceText(handoffSourceText);
  const locationText = extractLocationSnippet(handoffSourceText);
  const preferredPeriodText = extractPreferredPeriodSnippet(handoffSourceText);
  const relevantObjection =
    extractRelevantObjection(args.lastCustomerMessage) || extractRelevantObjection(handoffSourceText);
  const customerPreferences = extractCustomerPreferencesText(handoffSourceText);
  const adModelOrRequestedModel = extractRequestedPoolReference(handoffSourceText)?.raw || null;
  const directVisitRequest =
    looksLikeExplicitVisitRequest(args.lastCustomerMessage) ||
    looksLikeVisitAcceptanceAfterSuggestion(args.lastCustomerMessage, args.lastAiMessage);
  const directQuoteRequest = looksLikeExtendedQuoteRequest(args.lastCustomerMessage);

  if (!directVisitRequest && !directQuoteRequest) {
    return null;
  }

  const taskType: CommercialHandoffType = directQuoteRequest
    ? "commercial_quote_request"
    : "commercial_visit_request";
  const nextStepSummary =
    taskType === "commercial_quote_request"
      ? "responsavel deve revisar o pedido, confirmar o procedimento comercial correto e retornar ao cliente sem prometer orcamento emitido antes da validacao real."
      : "responsavel deve avaliar visita e disponibilidade, confirmar o procedimento da loja e retornar ao cliente sem prometer agenda antes da confirmacao real.";

  return {
    taskType,
    intent: taskType === "commercial_quote_request" ? "quote_request" : "visit_request",
    reason: directQuoteRequest ? "direct_quote_request" : "direct_visit_request",
    shouldCreateTask: true,
    replyOverride: buildCommercialHandoffReplyV2({
      handoffType: taskType,
      locationText,
      preferredPeriodText,
      requestedAreaM2,
    }),
    customerName: args.leadName,
    customerPhone: args.leadPhone,
    lastCustomerMessage: args.lastCustomerMessage,
    conversationSummary: buildCommercialConversationSummary({
      leadName: args.leadName,
      lastCustomerMessage: args.lastCustomerMessage,
      adModelOrRequestedModel,
      spaceText,
      requestedAreaM2,
      locationText,
      preferredPeriodText,
      recommendedModel: args.recommendedModel,
      relevantObjection,
      customerPreferences,
      nextStep: nextStepSummary,
    }),
    spaceText,
    requestedAreaM2,
    locationText,
    preferredPeriodText,
    recommendedModel: args.recommendedModel,
    relevantObjection,
    customerPreferences,
    adModelOrRequestedModel,
    nextStep:
      taskType === "commercial_quote_request"
        ? "Responsável deve revisar o pedido, confirmar procedimento comercial e retornar ao cliente com o orçamento correto."
        : "Responsável deve verificar disponibilidade, confirmar o procedimento da loja e retornar ao cliente sem prometer agenda antes da confirmação real.",
  };
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
    looksLikePoolPreferenceLanguage(text) ||
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

function looksLikePoolPreferenceLanguage(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("pequena") ||
    t.includes("pequeno") ||
    t.includes("pequenas") ||
    t.includes("pequenos") ||
    t.includes("barata") ||
    t.includes("barato") ||
    t.includes("baratas") ||
    t.includes("baratos") ||
    t.includes("economica") ||
    t.includes("econÃ´mica") ||
    t.includes("economico") ||
    t.includes("econÃ´mico") ||
    t.includes("compacta") ||
    t.includes("compacto") ||
    t.includes("compactas") ||
    t.includes("compactos") ||
    t.includes("simples") ||
    t.includes("menor") ||
    t.includes("menores") ||
    t.includes("mais barata") ||
    t.includes("mais barato") ||
    t.includes("mais em conta") ||
    t.includes("nao quero gastar muito") ||
    t.includes("nÃ£o quero gastar muito") ||
    t.includes("pouco espaco") ||
    t.includes("pouco espaÃ§o") ||
    t.includes("espaco pequeno") ||
    t.includes("espaÃ§o pequeno") ||
    t.includes("qual voce recomenda") ||
    t.includes("qual vocÃª recomenda") ||
    t.includes("qual recomenda") ||
    t.includes("facil de manter") ||
    t.includes("fÃ¡cil de manter") ||
    t.includes("boa para crianca") ||
    t.includes("boa para crianÃ§a") ||
    t.includes("bom custo beneficio") ||
    t.includes("bom custo-beneficio") ||
    t.includes("custo beneficio") ||
    t.includes("custo-beneficio")
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

  if (
    looksLikePoolPreferenceLanguage(text) &&
    !/\b(?:modelo|cod(?:igo)?|sku)\s+/i.test(t) &&
    !/\b\d{2,}\b/.test(t)
  ) {
    return false;
  }

  return (
    extractRequestedPoolReference(text) != null ||
    /\b(?:quero|tem|vi|sobre|fala da|me fala da|quanto custa a)\s+(?:o\s+modelo\s+|a\s+modelo\s+|a\s+|o\s+)([a-z0-9][a-z0-9-]{1,30})\b/i.test(t)
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

function detectPaymentOrClosingSubtype(text: string): PaymentOrClosingSubtype {
  const t = normalizeText(text);

  if (!t || isGenericPoolOpening(text) || looksLikeDiscountQuestionV2(text) || looksLikePriceQuestion(text)) {
    return "none";
  }

  if (
    t.includes("comprovante") ||
    t.includes("comprov") ||
    t.includes("mandei o comprovante") ||
    t.includes("enviei o comprovante")
  ) {
    return "receipt_submitted";
  }

  if (
    t.includes("ja fiz o pix") ||
    t.includes("fiz o pix") ||
    t.includes("ja paguei") ||
    t.includes("confirma ai o pagamento") ||
    t.includes("confirma o pagamento") ||
    t.includes("confirma ai meu pagamento")
  ) {
    return "payment_submitted";
  }

  if (
    t.includes("reservar") ||
    t.includes("reserva") ||
    t.includes("separar essa") ||
    t.includes("separa essa") ||
    t.includes("separar pra mim") ||
    t.includes("segurar pra mim")
  ) {
    return "reservation_or_hold";
  }

  if (t.includes("emitir o contrato") || t.includes("emite o contrato") || t.includes("contrato")) {
    return "contract_request";
  }

  if (t.includes("dar uma entrada") || t.includes("entrada") || t.includes("sinal")) {
    return "down_payment_or_entry";
  }

  if (
    t.includes("me manda o pix") ||
    t.includes("manda o pix") ||
    t.includes("passa o pix") ||
    t.includes("envia o pix") ||
    t.includes("manda a chave pix") ||
    t.includes("passa a chave pix") ||
    t.includes("qual e o pix") ||
    t.includes("qual eh o pix")
  ) {
    return "pix_key_request";
  }

  if (
    t === "quero fechar" ||
    t === "quero comprar" ||
    t.includes("quero comprar essa") ||
    t.includes("quero fechar essa") ||
    t.includes("vamos fechar") ||
    t.includes("vou ficar com essa")
  ) {
    return "closing_or_buying";
  }

  if (
    looksLikePaymentQuestion(text) ||
    t.includes("como faço para pagar") ||
    t.includes("como faco para pagar") ||
    t.includes("forma de pagamento") ||
    t.includes("formas de pagamento")
  ) {
    return "payment_info";
  }

  return "none";
}

function looksLikeDiscountQuestion(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("desconto") ||
    t.includes("descontinho") ||
    t.includes("melhora o valor") ||
    t.includes("consegue melhorar") ||
    t.includes("faz um preco melhor")
  );
}

function looksLikeDiscountQuestionV2(text: string): boolean {
  const t = normalizeText(text);

  return (
    looksLikeDiscountQuestion(text) ||
    t.includes("menor valor") ||
    t.includes("mais barato") ||
    t.includes("mais em conta") ||
    t.includes("ta caro") ||
    t.includes("esta caro") ||
    t.includes("vi mais barato") ||
    t.includes("concorrente") ||
    t.includes("fecha por") ||
    t.includes("consegue fazer por menos") ||
    t.includes("nao quero gastar muito") ||
    t.includes("nao quero gastar tanto") ||
    t.includes("quero economizar") ||
    t.includes("tem algo mais em conta") ||
    t.includes("opcao mais economica") ||
    t.includes("opcao economica") ||
    t.includes("meu orcamento e baixo") ||
    t.includes("nao posso pagar tudo isso") ||
    t.includes("tem promocao") ||
    t.includes("promocao") ||
    t.includes("no pix melhora") ||
    t.includes("pix melhora") ||
    t.includes("a vista melhora") ||
    t.includes("avista melhora")
  );
}

function hasExplicitPaymentConditionSignal(text: string): boolean {
  const t = normalizeText(text);

  return (
    looksLikePaymentQuestion(text) ||
    t.includes("pix melhora") ||
    t.includes("no pix melhora") ||
    t.includes("a vista melhora") ||
    t.includes("avista melhora") ||
    t.includes("parcelado") ||
    t.includes("parcelamento") ||
    t.includes("cartao") ||
    t.includes("cartão") ||
    t.includes("boleto") ||
    t.includes("entrada") ||
    t.includes("sinal") ||
    t.includes("forma de pagamento") ||
    t.includes("formas de pagamento")
  );
}

function looksLikePhotoOrSimulationRequest(text: string): boolean {
  const t = normalizeText(text);

  return (
    t.includes("foto") ||
    t.includes("fotos") ||
    t.includes("imagem") ||
    t.includes("imagens") ||
    t.includes("simulacao") ||
    t.includes("montagem") ||
    t.includes("render") ||
    t.includes("visualizacao") ||
    t.includes("como ficaria") ||
    t.includes("quintal") ||
    t.includes("cabe no meu") ||
    t.includes("cabe no espaco") ||
    t.includes("mandar uma foto")
  );
}

function detectPhotoOrSimulationSubtype(args: {
  lastCustomerMessage: string;
  customerConversationText: string;
}): PhotoOrSimulationSubtype {
  const current = normalizeText(args.lastCustomerMessage);
  const context = normalizeText(args.customerConversationText);
  const combined = `${current} | ${context}`;
  const asksSimulation =
    current.includes("simulacao") ||
    current.includes("montagem") ||
    current.includes("render") ||
    current.includes("visualizacao") ||
    current.includes("como ficaria");
  const asksPhoto =
    current.includes("foto") || current.includes("fotos") || current.includes("imagem") || current.includes("imagens");
  const localContext =
    current.includes("quintal") ||
    current.includes("espaco") ||
    current.includes("cabe") ||
    current.includes("local") ||
    current.includes("terreno");
  const specificPoolNow = hasSpecificPoolReference(args.lastCustomerMessage);
  const specificPoolInContext = hasSpecificPoolReference(combined);

  if (asksSimulation) return "simulation_visual_request";
  if (asksPhoto && specificPoolNow) return "product_photo_specific";
  if (asksPhoto && !specificPoolInContext && !localContext) return "product_photo_without_model";
  if (asksPhoto && localContext) return "local_photo_context";
  if (asksPhoto && specificPoolInContext) return "product_photo_specific";
  return "general_photo_request";
}

function detectConversationPattern(args: {
  facts: ConversationFactState;
  intents: DetectedIntent[];
  lastCustomerMessage: string;
  explicitCatalogRequest: boolean;
  patienceSignal: CustomerPatienceSignal;
  shouldPresentPoolRecommendations: boolean;
  lastAiListedPools: boolean;
  paymentOrClosingSubtype?: PaymentOrClosingSubtype;
}): ConversationPattern {
  const {
    facts,
    intents,
    lastCustomerMessage,
    explicitCatalogRequest,
    patienceSignal,
    shouldPresentPoolRecommendations,
    lastAiListedPools,
    paymentOrClosingSubtype,
  } = args;
  const normalized = normalizeText(lastCustomerMessage);
  const hasClearBudgetObjection = looksLikeDiscountQuestionV2(lastCustomerMessage);

  if (hasClearBudgetObjection && patienceSignal.status !== "not_interested") {
    return "discount_question";
  }

  if (patienceSignal.status !== "active_interest") {
    return "pause_or_disinterest";
  }

  if (paymentOrClosingSubtype && paymentOrClosingSubtype !== "none") {
    return "payment_or_closing_flow";
  }

  if (looksLikePhotoOrSimulationRequest(lastCustomerMessage)) {
    return "photo_or_simulation_request";
  }

  if (hasSpecificPoolReference(lastCustomerMessage)) {
    return "specific_model_or_ad_request";
  }

  if (isGenericPoolOpening(lastCustomerMessage)) {
    return "generic_pool_opening";
  }

  if (looksLikePriceQuestion(lastCustomerMessage)) {
    return "price_question";
  }

  if (PRODUCT_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword)))) {
    return "chemical_problem";
  }

  if (
    normalized.includes("filho") ||
    normalized.includes("filhos") ||
    normalized.includes("filha") ||
    normalized.includes("filhas") ||
    normalized.includes("crianca") ||
    normalized.includes("criancas")
  ) {
    return "pool_children_context";
  }

  if (
    (extractRequestedAreaM2(lastCustomerMessage) != null || facts.sizeKnown) &&
    !hasSpecificPoolReference(lastCustomerMessage) &&
    !looksLikePriceQuestion(lastCustomerMessage) &&
    !looksLikeInstallationQuestion(lastCustomerMessage)
  ) {
    return "pool_size_discovery";
  }

  if (
    shouldPresentPoolRecommendations ||
    explicitCatalogRequest ||
    looksLikePoolRecommendationRequest(lastCustomerMessage) ||
    looksLikeComparisonQuestion(lastCustomerMessage) ||
    lastAiListedPools
  ) {
    return "catalog_recommendation_or_refinement";
  }

  return "general_sales_conversation";
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
        getEffectiveMessageContent(msg).length > 0
    )
    .map((msg) => getEffectiveMessageContent(msg));

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

function formatCurrencyFromReais(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;

  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `R$ ${Number(value).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
  }
}

function extractPriceRangeFromText(text: string | null | undefined): string | null {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const match = raw.match(/(R\$\s*[\d\.\,]+)\s*a\s*(R\$\s*[\d\.\,]+)/i);
  if (!match?.[1] || !match?.[2]) return null;

  return `${match[1]} a ${match[2]}`;
}

function hasTrustedPoolPrice(match: MatchedPool | null): boolean {
  if (!match) return false;
  return match.pool.price != null || extractPriceRangeFromText(match.pool.description) != null;
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

const GENERIC_POOL_REFERENCE_TOKENS = new Set([
  "a",
  "anuncio",
  "anuncios",
  "basica",
  "basicas",
  "basico",
  "basicos",
  "catologo",
  "com",
  "compacta",
  "compactas",
  "compacto",
  "compactos",
  "crianca",
  "criancas",
  "custo",
  "da",
  "de",
  "do",
  "economica",
  "economicas",
  "economico",
  "economicos",
  "em",
  "espaco",
  "facil",
  "fibra",
  "foto",
  "fotos",
  "hidromassagem",
  "mais",
  "manter",
  "menor",
  "menores",
  "modelo",
  "modelos",
  "mostra",
  "opcao",
  "opcoes",
  "para",
  "pastilha",
  "pequena",
  "pequenas",
  "pequeno",
  "pequenos",
  "piscina",
  "piscinas",
  "premium",
  "simples",
  "spa",
  "tipo",
  "um",
  "uma",
  "vinil",
  "barata",
  "baratas",
  "barato",
  "baratos",
]);

function isGenericPoolReferenceToken(token: string): boolean {
  return GENERIC_POOL_REFERENCE_TOKENS.has(token);
}

const KNOWN_POOL_MODEL_TYPES = new Set([
  "vinil",
  "fibra",
  "spa",
  "pastilha",
  "alvenaria",
]);

function buildCanonicalPoolModelKey(
  text: string | null | undefined
): CanonicalPoolModelKey | null {
  const normalized = normalizeText(text);

  if (!normalized) return null;

  const sanitized = normalized.replace(
    /\b(?:piscina|piscinas|modelo|modelos|produto|produtos|foto|fotos|imagem|imagens|ver|mostrar|mostra|mandar|manda|mande|tem|quero|me|da|do|de|o|a|um|uma)\b/g,
    " "
  );

  const tokens = sanitized.split(/\s+/).filter(Boolean);
  const type = tokens.find((token) => KNOWN_POOL_MODEL_TYPES.has(token)) || null;
  const numberToken = tokens.find((token) => /^\d{1,4}$/.test(token)) || null;

  if (!type || !numberToken) return null;

  const number = Number.parseInt(numberToken, 10);

  if (!Number.isFinite(number)) return null;

  return {
    type,
    number,
    key: `${type}:${number}`,
  };
}

function compareCanonicalPoolModelKey(
  a: CanonicalPoolModelKey | null | undefined,
  b: CanonicalPoolModelKey | null | undefined
): boolean {
  return !!a && !!b && a.type === b.type && a.number === b.number;
}

function extractRequestedPoolReference(text: string): RequestedPoolReference | null {
  const normalized = normalizeText(text);
  const patterns = [
    /\btem\s+foto\s+da\s+(?:piscina\s+)?([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\btem\s+imagem\s+da\s+(?:piscina\s+)?([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\bme\s+manda\s+foto\s+da\s+(?:piscina\s+)?([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\bme\s+mande\s+foto\s+da\s+(?:piscina\s+)?([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\bmanda\s+foto\s+da\s+(?:piscina\s+)?([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\bmande\s+foto\s+da\s+(?:piscina\s+)?([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\bquero\s+ver\s+a\s+(?:piscina\s+)?([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\bquero\s+ver\s+o\s+modelo\s+([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\bmostra\s+a\s+(?:piscina\s+)?([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\bmostrar\s+a\s+(?:piscina\s+)?([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\bfoto\s+da\s+(?:piscina\s+)?([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\bimagem\s+da\s+(?:piscina\s+)?([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\bvi o anuncio da piscina\s+([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\bvi o anuncio da\s+([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\banuncio da piscina\s+([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\banuncio da\s+([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\bquero\s+o\s+modelo\s+([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\bquero\s+a\s+([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\bquero\s+o\s+([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\btem\s+a\s+([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\btem\s+o\s+([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\bmodelo\s+([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\bpiscina\s+([a-z0-9][a-z0-9\s-]{1,40})/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const raw = match?.[1]?.trim();
    if (!raw) continue;

    const cleaned = raw
      .replace(/\b(?:quanto|custa|valor|preco|preço|tem|foto|fotos|ai|aí)\b.*$/i, "")
      .trim();

    const refinedCleaned = cleaned
      .replace(/\b(?:imagem|imagens|ver|mostrar|mostra|manda|mande|mandar)\b.*$/i, "")
      .trim();
    const effectiveCleaned = refinedCleaned || cleaned;

    if (!effectiveCleaned) continue;

    const tokens = effectiveCleaned.split(/\s+/).filter(Boolean);
    const descriptiveOnly =
      looksLikePoolPreferenceLanguage(effectiveCleaned) &&
      !tokens.some((token) => /^\d{1,4}$/.test(token));
    const hasNamedSignal = tokens.some(
      (token) => (/^\d{1,4}$/.test(token) || token.length >= 4) && !isGenericPoolReferenceToken(token)
    );
    const hasCodeSignal =
      tokens.some((token) => /^\d{1,4}$/.test(token)) &&
      tokens.some((token) => !isGenericPoolReferenceToken(token));

    if (descriptiveOnly || (!hasNamedSignal && !hasCodeSignal)) {
      continue;
    }

    return {
      raw: effectiveCleaned,
      normalized: normalizeText(effectiveCleaned),
      fromAd: normalized.includes("anuncio"),
      canonicalModelKey: buildCanonicalPoolModelKey(effectiveCleaned),
    };
  }

  return null;
}

function analyzeCatalogIntent(text: string): CatalogIntentAnalysis {
  const normalized = normalizeText(text);
  const requestedBrand = extractRequestedBrand(text);
  const requestedProductTerm = extractRequestedProductTerm(text);
  const requestedPoolReference = extractRequestedPoolReference(text);

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
    !!requestedPoolReference?.canonicalModelKey ||
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

function scoreCatalogItem(
  item: CatalogItemRow,
  analysis: CatalogIntentAnalysis,
  requestedPoolReference?: RequestedPoolReference | null
): number {
  const haystack = buildCatalogSearchText(item);
  let score = 0;
  const requestedCanonicalKey = requestedPoolReference?.canonicalModelKey || null;
  const itemCanonicalKey =
    buildCanonicalPoolModelKey(item.name) || buildCanonicalPoolModelKey(item.sku);

  if (compareCanonicalPoolModelKey(requestedCanonicalKey, itemCanonicalKey)) {
    score += 20;
  }

  if (
    !requestedCanonicalKey &&
    requestedPoolReference?.normalized &&
    haystack.includes(requestedPoolReference.normalized)
  ) {
    score += 10;
  }

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

function buildCatalogItemContextLine(match: MatchedCatalogItem): string {
  const name = match.item.name || "Item sem nome";
  const price =
    typeof match.item.price_cents === "number"
      ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: match.item.currency || "BRL" }).format(match.item.price_cents / 100)
      : null;
  const availability =
    match.item.track_stock === true
      ? (match.item.stock_quantity || 0) > 0
        ? `estoque: ${match.item.stock_quantity}`
        : "sem estoque confirmado"
      : "estoque livre";
  const photos = match.photos.length > 0 ? `${match.photos.length} foto(s)` : "sem foto cadastrada";

  return `- ${name}${price ? ` | preco: ${price}` : ""} | ${availability} | ${photos}`;
}

function formatPoolLine(pool: PoolRow, hasPhoto: boolean): string {
  const dimensions =
    pool.width_m && pool.length_m
      ? `${pool.width_m}m x ${pool.length_m}m${pool.depth_m ? ` x ${pool.depth_m}m` : ""}`
      : pool.depth_m
        ? `profundidade ${pool.depth_m}m`
        : "medidas nao informadas";
  const price = formatCurrencyFromReais(pool.price);
  const availability =
    pool.track_stock === true
      ? (pool.stock_quantity || 0) > 0
        ? `estoque: ${pool.stock_quantity}`
        : "sem estoque confirmado"
      : "estoque livre";

  return `- ${pool.name || "Piscina sem nome"}${price ? ` | preco base: ${price}` : ""} | ${dimensions} | ${availability} | ${hasPhoto ? "com foto" : "sem foto"}`;
}

function looksLikeHistoricalProductPhotoReference(text: string): boolean {
  const normalized = normalizeText(text);

  return (
    normalized.includes("dessa piscina") ||
    normalized.includes("desse modelo") ||
    normalized.includes("desse produto") ||
    normalized.includes("essa piscina") ||
    normalized.includes("esse modelo") ||
    normalized.includes("esse produto") ||
    normalized.includes("essa opcao") ||
    normalized.includes("essa opção") ||
    normalized.includes("aquele modelo") ||
    normalized.includes("aquela piscina") ||
    /^ela(?:\s|$|[?!.,])/.test(normalized) ||
    /^esse(?:\s|$|[?!.,])/.test(normalized) ||
    /^essa(?:\s|$|[?!.,])/.test(normalized) ||
    /^aquele(?:\s|$|[?!.,])/.test(normalized) ||
    /^aquela(?:\s|$|[?!.,])/.test(normalized)
  );
}

function findStrongCatalogPhotoMatch(
  matches: MatchedCatalogItem[],
  requestedPoolReference?: RequestedPoolReference | null
): MatchedCatalogItem | null {
  const requestedCanonicalKey = requestedPoolReference?.canonicalModelKey || null;
  const requestedNormalized = requestedPoolReference?.normalized || "";

  if (requestedCanonicalKey) {
    const canonicalMatches = matches.filter((match) =>
      compareCanonicalPoolModelKey(
        buildCanonicalPoolModelKey(match.item.name) || buildCanonicalPoolModelKey(match.item.sku),
        requestedCanonicalKey
      )
    );

    if (canonicalMatches.length > 0) {
      return canonicalMatches
        .slice()
        .sort((a, b) => b.photos.length - a.photos.length || b.score - a.score)[0];
    }

    return null;
  }

  if (requestedNormalized) {
    const normalizedMatches = matches.filter((match) => {
      const haystack = normalizeText(
        [match.item.name, match.item.sku, match.item.description].filter(Boolean).join(" | ")
      );
      return haystack.includes(requestedNormalized);
    });

    if (normalizedMatches.length > 0) {
      return normalizedMatches
        .slice()
        .sort((a, b) => b.photos.length - a.photos.length || b.score - a.score)[0];
    }
  }

  const first = matches[0] || null;
  const second = matches[1] || null;

  if (!first) return null;

  const identifier = normalizeText(first.item.name || first.item.sku || "");

  if (!identifier) return null;
  if (first.score < 8) return null;
  if (second && first.score < second.score + 3) return null;

  return first;
}

function buildCatalogPhotoEvidence(args: {
  requestedPoolReference: RequestedPoolReference | null;
  strongestPoolReferenceMatch: PoolReferenceMatchStrength;
  bestNamedPoolMatch: MatchedPool | null;
  availablePools: MatchedPool[];
  matchedCatalogItems: MatchedCatalogItem[];
}): {
  poolMatch: MatchedPool | null;
  catalogItemMatch: MatchedCatalogItem | null;
  hasPhoto: boolean;
  modelName: string | null;
  targetType: "pool" | "catalog_item" | null;
} {
  const requestedCanonicalKey = args.requestedPoolReference?.canonicalModelKey || null;
  const resolvedPoolMatch =
    requestedCanonicalKey
      ? args.availablePools
          .filter((match) =>
            compareCanonicalPoolModelKey(
              buildCanonicalPoolModelKey(match.pool.name),
              requestedCanonicalKey
            )
          )
          .sort((a, b) => Number(b.hasPhoto) - Number(a.hasPhoto) || b.score - a.score)[0] || null
      : args.strongestPoolReferenceMatch === "exact" || args.strongestPoolReferenceMatch === "strong"
        ? args.bestNamedPoolMatch
        : null;

  const resolvedCatalogItemMatch = findStrongCatalogPhotoMatch(
    args.matchedCatalogItems,
    args.requestedPoolReference
  );

  const poolHasPhoto = !!resolvedPoolMatch?.hasPhoto;
  const catalogItemPhotosCount = resolvedCatalogItemMatch?.photos.length || 0;
  const catalogHasPhoto = catalogItemPhotosCount > 0;
  const hasPhoto = poolHasPhoto || catalogHasPhoto;

  if (!resolvedPoolMatch && !resolvedCatalogItemMatch) {
    return {
      poolMatch: null,
      catalogItemMatch: null,
      hasPhoto: false,
      modelName: null,
      targetType: null,
    };
  }

  const preferredTargetType: "pool" | "catalog_item" =
    resolvedPoolMatch ? "pool" : "catalog_item";
  const modelName =
    preferredTargetType === "pool"
      ? String(
          resolvedPoolMatch?.pool.name ||
            resolvedCatalogItemMatch?.item.name ||
            resolvedCatalogItemMatch?.item.sku ||
            args.requestedPoolReference?.raw ||
            "Modelo"
        ).trim()
      : String(
          resolvedCatalogItemMatch?.item.name ||
            resolvedCatalogItemMatch?.item.sku ||
            resolvedPoolMatch?.pool.name ||
            args.requestedPoolReference?.raw ||
            "Produto"
        ).trim();

  return {
    poolMatch: resolvedPoolMatch || null,
    catalogItemMatch: resolvedCatalogItemMatch || null,
    hasPhoto,
    modelName,
    targetType: preferredTargetType,
  };
}

function selectPrimaryPoolPhoto(
  poolPhotos: PoolPhotoRow[],
  organizationId: string,
  storeId: string,
  poolId: string
): PoolPhotoRow | null {
  return (
    poolPhotos
      .filter(
        (photo) =>
          photo.pool_id === poolId &&
          photo.organization_id === organizationId &&
          photo.store_id === storeId &&
          typeof photo.storage_path === "string" &&
          photo.storage_path.trim().length > 0
      )
      .slice()
      .sort((a, b) => {
        const sortOrderA =
          typeof a.sort_order === "number" ? a.sort_order : Number.MAX_SAFE_INTEGER;
        const sortOrderB =
          typeof b.sort_order === "number" ? b.sort_order : Number.MAX_SAFE_INTEGER;

        if (sortOrderA !== sortOrderB) {
          return sortOrderA - sortOrderB;
        }

        return String(a.id || "").localeCompare(String(b.id || ""));
      })[0] || null
  );
}

function buildCatalogPhotoAction(args: {
  productPhotoRequestContext: ProductPhotoRequestContext;
  photoOrSimulationSubtype?: PhotoOrSimulationSubtype | null;
  requestedPoolReference: RequestedPoolReference | null;
  strongestPoolReferenceMatch: PoolReferenceMatchStrength;
  bestNamedPoolMatch: MatchedPool | null;
  availablePools: MatchedPool[];
  matchedCatalogItems: MatchedCatalogItem[];
  poolPhotosByPoolId: Map<string, PoolPhotoRow[]>;
  organizationId: string;
  storeId: string;
  supabase: any;
}): CatalogPhotoActionContext | null {
  if (
    args.productPhotoRequestContext.kind !== "resolved_with_photo" ||
    args.productPhotoRequestContext.source !== "explicit" ||
    args.photoOrSimulationSubtype !== "product_photo_specific"
  ) {
    return null;
  }

  const explicitPhotoEvidence = buildCatalogPhotoEvidence({
    requestedPoolReference: args.requestedPoolReference,
    strongestPoolReferenceMatch: args.strongestPoolReferenceMatch,
    bestNamedPoolMatch: args.bestNamedPoolMatch,
    availablePools: args.availablePools,
    matchedCatalogItems: args.matchedCatalogItems,
  });

  const resolvedPool = explicitPhotoEvidence.poolMatch?.pool || null;

  if (!resolvedPool || !explicitPhotoEvidence.hasPhoto) {
    return null;
  }

  const availability = isSellableInventoryState({
    isActive: resolvedPool.is_active,
    trackStock: resolvedPool.track_stock,
    stockQuantity: resolvedPool.stock_quantity,
  });

  if (!availability.isSellable) {
    return null;
  }

  const poolPhotos = args.poolPhotosByPoolId.get(resolvedPool.id) || [];
  const primaryPoolPhoto = selectPrimaryPoolPhoto(
    poolPhotos,
    args.organizationId,
    args.storeId,
    resolvedPool.id
  );

  const storagePath = primaryPoolPhoto?.storage_path?.trim() || null;
  const fallbackUrl = String(resolvedPool.photo_url || "").trim() || null;
  let publicUrl = "";
  let source: CatalogPhotoActionContext["source"] | null = null;
  let bucket: CatalogPhotoActionContext["bucket"] = null;

  if (storagePath) {
    const { data } = args.supabase.storage
      .from(POOL_PHOTOS_PUBLIC_BUCKET)
      .getPublicUrl(storagePath);
    publicUrl = String(data?.publicUrl || "").trim();
    source = "pool_photos";
    bucket = POOL_PHOTOS_PUBLIC_BUCKET;
  } else if (fallbackUrl) {
    publicUrl = fallbackUrl;
    source = "pool_photo_url";
  }

  if (!source || !/^https?:\/\//i.test(publicUrl)) {
    return null;
  }

  const poolName = String(resolvedPool.name || args.productPhotoRequestContext.modelName || "").trim();

  if (!poolName) {
    return null;
  }

  return {
    shouldSend: true,
    reason: "explicit_strong_product_photo_request",
    poolId: resolvedPool.id,
    poolName,
    organizationId: args.organizationId,
    storeId: args.storeId,
    source,
    bucket,
    storagePath,
    publicUrl,
    caption: `Foto da ${poolName}`,
  };
}

function findSingleRecentProductInFocus(args: {
  orderedMessages: MessageRow[];
  matchedPools: MatchedPool[];
  matchedCatalogItems: MatchedCatalogItem[];
}):
  | {
      targetType: "pool" | "catalog_item";
      modelName: string;
      hasPhoto: boolean;
    }
  | "ambiguous"
  | null {
  const candidates = [
    ...args.matchedPools.slice(0, 5).map((match) => ({
      targetType: "pool" as const,
      modelName: String(match.pool.name || "").trim(),
      normalizedName: normalizeText(match.pool.name || ""),
      canonicalModelKey: buildCanonicalPoolModelKey(match.pool.name),
      hasPhoto: match.hasPhoto,
    })),
    ...args.matchedCatalogItems.slice(0, 5).map((match) => ({
      targetType: "catalog_item" as const,
      modelName: String(match.item.name || match.item.sku || "").trim(),
      normalizedName: normalizeText(match.item.name || match.item.sku || ""),
      canonicalModelKey: buildCanonicalPoolModelKey(match.item.name) || buildCanonicalPoolModelKey(match.item.sku),
      hasPhoto: match.photos.length > 0,
    })),
  ].filter((candidate) => candidate.modelName && candidate.normalizedName.length >= 3);

  if (candidates.length === 0) return null;

  const uniqueCandidates = candidates.filter(
    (candidate, index, array) =>
      array.findIndex(
        (item) =>
          (item.canonicalModelKey?.key || `${item.targetType}:${item.normalizedName}`) ===
          (candidate.canonicalModelKey?.key || `${candidate.targetType}:${candidate.normalizedName}`)
      ) === index
  );

  const recentMessages = args.orderedMessages
    .filter((message) => String(message.content || "").trim().length > 0)
    .slice(-8);

  const matches = uniqueCandidates
    .map((candidate) => {
      let mentions = 0;

      for (const message of recentMessages) {
        const content = normalizeText(message.content || "");
        const messageCanonicalKey = buildCanonicalPoolModelKey(message.content || "");
        if (
          content.includes(candidate.normalizedName) ||
          compareCanonicalPoolModelKey(candidate.canonicalModelKey, messageCanonicalKey)
        ) {
          mentions += 1;
        }
      }

      return {
        ...candidate,
        mentions,
      };
    })
    .filter((candidate) => candidate.mentions > 0)
    .sort((a, b) => b.mentions - a.mentions || b.normalizedName.length - a.normalizedName.length);

  if (matches.length === 0) return null;
  if (matches.length > 1) return "ambiguous";

  const single = matches[0];

  return {
    targetType: single.targetType,
    modelName: single.modelName,
    hasPhoto: single.hasPhoto,
  };
}

function buildProductPhotoRequestContext(args: {
  lastCustomerMessage: string;
  photoOrSimulationSubtype?: PhotoOrSimulationSubtype | null;
  catalogIntent: CatalogIntentAnalysis;
  requestedPoolReference: RequestedPoolReference | null;
  strongestPoolReferenceMatch: PoolReferenceMatchStrength;
  bestNamedPoolMatch: MatchedPool | null;
  photoCandidatePools: MatchedPool[];
  matchedCatalogItems: MatchedCatalogItem[];
  orderedMessages: MessageRow[];
}): ProductPhotoRequestContext {
  const asksForPhoto = args.catalogIntent.asksForPhoto;

  if (!asksForPhoto) {
    return { kind: "not_applicable" };
  }

  if (
    args.photoOrSimulationSubtype === "simulation_visual_request" ||
    args.photoOrSimulationSubtype === "local_photo_context"
  ) {
    return { kind: "not_applicable" };
  }

  const explicitPhotoEvidence = buildCatalogPhotoEvidence({
    requestedPoolReference: args.requestedPoolReference,
    strongestPoolReferenceMatch: args.strongestPoolReferenceMatch,
    bestNamedPoolMatch: args.bestNamedPoolMatch,
    availablePools: args.photoCandidatePools,
    matchedCatalogItems: args.matchedCatalogItems,
  });

  if (explicitPhotoEvidence.poolMatch || explicitPhotoEvidence.catalogItemMatch) {
    return {
      kind: explicitPhotoEvidence.hasPhoto ? "resolved_with_photo" : "resolved_without_photo",
      source: "explicit",
      targetType: explicitPhotoEvidence.targetType || "pool",
      modelName: explicitPhotoEvidence.modelName || String(args.requestedPoolReference?.raw || "Modelo").trim(),
    };
  }

  if (
    args.requestedPoolReference &&
    args.requestedPoolReference.canonicalModelKey &&
    args.strongestPoolReferenceMatch === "weak"
  ) {
    return { kind: "ambiguous", source: "request" };
  }

  if (looksLikeHistoricalProductPhotoReference(args.lastCustomerMessage)) {
    const recentTarget = findSingleRecentProductInFocus({
      orderedMessages: args.orderedMessages,
      matchedPools: args.photoCandidatePools,
      matchedCatalogItems: args.matchedCatalogItems,
    });

    if (recentTarget === "ambiguous") {
      return { kind: "ambiguous", source: "history" };
    }

    if (recentTarget) {
      return {
        kind: recentTarget.hasPhoto ? "resolved_with_photo" : "resolved_without_photo",
        source: "history",
        targetType: recentTarget.targetType,
        modelName: recentTarget.modelName,
      };
    }

    return { kind: "ambiguous", source: "history" };
  }

  if (
    looksLikePoolPreferenceLanguage(args.lastCustomerMessage) ||
    looksLikePoolChoice(args.lastCustomerMessage)
  ) {
    return { kind: "generic_request" };
  }

  if (args.photoOrSimulationSubtype === "product_photo_without_model") {
    return { kind: "ambiguous", source: "request" };
  }

  return { kind: "generic_request" };
}

function buildProductPhotoRequestContextBlock(
  context: ProductPhotoRequestContext
): string {
  if (context.kind === "not_applicable") {
    return "";
  }

  if (context.kind === "resolved_with_photo") {
    return [
      "CONTEXTO DE PEDIDO DE FOTO DE PRODUTO",
      "- o cliente pediu foto de produto/modelo",
      `- modelo identificado com seguranca: ${context.modelName}`,
      "- existe foto real cadastrada para esse modelo no catalogo da loja",
      "- para esta resposta, a prioridade e confirmar a foto cadastrada do modelo correto; nao troque o modelo por parecido e nao transforme isso em resposta principal de disponibilidade",
      "- responda com honestidade que ha foto real cadastrada desse modelo, de preferencia com frase curta e neutra, mas nao diga que a foto ja foi enviada nem que o envio automatico aconteceu agora",
      "- nao confunda este pedido com foto do local do cliente",
    ].join("\n");
  }

  if (context.kind === "resolved_without_photo") {
    return [
      "CONTEXTO DE PEDIDO DE FOTO DE PRODUTO",
      "- o cliente pediu foto de produto/modelo",
      `- modelo identificado com seguranca: ${context.modelName}`,
      "- nao ha foto cadastrada para esse modelo no catalogo da loja",
      "- para esta resposta, a prioridade e dizer se ha ou nao foto cadastrada do modelo correto; nao troque o modelo por parecido e nao use disponibilidade como resposta principal",
      "- responda com honestidade, sem inventar imagem, e continue ajudando com informacoes do modelo",
      "- nao confunda este pedido com foto do local do cliente",
    ].join("\n");
  }

  if (context.kind === "ambiguous") {
    return [
      "CONTEXTO DE PEDIDO DE FOTO DE PRODUTO",
      "- o cliente pediu foto de produto/modelo, mas o modelo ainda nao esta claro com seguranca",
      "- pergunte qual modelo ele quer ver antes de prometer qualquer foto",
      "- nao escolha piscina aleatoria e nao confunda este pedido com foto do local do cliente",
    ].join("\n");
  }

  return [
    "CONTEXTO DE PEDIDO DE FOTO DE PRODUTO",
    "- o cliente pediu foto de produto/modelo de forma generica",
    "- nao escolha foto aleatoria nem afirme foto de um modelo especifico sem match forte",
    "- primeiro afunile ou sugira opcoes reais antes de falar de foto de um modelo especifico",
  ].join("\n");
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

function classifyPoolReferenceMatch(
  pool: PoolRow,
  requestedReference: RequestedPoolReference | null
): PoolReferenceMatchStrength {
  if (!requestedReference) return "none";

  const name = normalizeText(pool.name);
  const haystack = normalizeText(
    [pool.name, pool.material, pool.shape, pool.description].filter(Boolean).join(" | ")
  );
  const poolCanonicalKey = buildCanonicalPoolModelKey(pool.name);

  if (!name || !haystack) return "none";

  if (compareCanonicalPoolModelKey(poolCanonicalKey, requestedReference.canonicalModelKey)) {
    return "exact";
  }

  if (requestedReference.canonicalModelKey) {
    return "none";
  }

  if (name.includes(requestedReference.normalized)) {
    return "exact";
  }

  const tokens = requestedReference.normalized.split(/\s+/).filter(Boolean);
  const strongTokens = tokens.filter(
    (token) => (/^\d{1,4}$/.test(token) || token.length >= 4) && !isGenericPoolReferenceToken(token)
  );

  if (strongTokens.length > 0) {
    const strongNameHits = strongTokens.filter((token) => name.includes(token));
    const strongHaystackHits = strongTokens.filter((token) => haystack.includes(token));

    if (strongNameHits.length > 0) {
      return "strong";
    }

    if (strongHaystackHits.length >= 2) {
      return "strong";
    }
  }

  const broadHits = tokens.filter((token) => token.length >= 3 && haystack.includes(token));
  if (broadHits.length > 0) {
    return "weak";
  }

  return "none";
}

function inferPrimaryIntent(text: string): string {
  if (looksLikeDiscountQuestionV2(text)) return "discount";
  if (looksLikePriceQuestion(text)) return "price";
  if (looksLikePhotoOrSimulationRequest(text)) return "photo_or_simulation";
  if (hasSpecificPoolReference(text)) return "specific_model";
  if (detectPaymentOrClosingSubtype(text) !== "none") return "payment_or_closing";

  const intents = detectIntents(text);
  return intents[0] || "general_sales_conversation";
}

function inferMustAnswerFirst(intents: DetectedIntent[]): string[] {
  const items: string[] = [];

  if (intents.includes("payment")) {
    items.push("responder claramente sobre cartao/pagamento");
  }
  if (intents.includes("technical_visit")) {
    items.push("responder claramente sobre visita tecnica");
  }
  if (intents.includes("installation")) {
    items.push("responder claramente sobre instalacao");
  }
  if (intents.includes("price")) {
    items.push("responder claramente sobre preco/faixa de valor");
  }
  if (intents.includes("region")) {
    items.push("responder claramente sobre cidade/regiao atendida");
  }
  if (intents.includes("catalog") || intents.includes("pool_choice")) {
    items.push("responder com orientacao pratica sobre modelos/opcoes");
  }
  if (intents.includes("comparison")) {
    items.push("responder com comparacao pratica entre as opcoes");
  }

  return items.length ? items : ["responder diretamente o pedido principal antes de conduzir"];
}

function summarizeKnownFacts(facts: ConversationFactState, lastCustomerMessage: string): string[] {
  const out: string[] = [];
  if (facts.sizeKnown) out.push("cliente ja informou espaco ou medida");
  if (facts.needKnown) out.push("ja existe contexto suficiente sobre necessidade ou preferencia");
  if (facts.installationInterestKnown) out.push("instalacao ja apareceu como parte do contexto");
  if (facts.paymentInterestKnown) out.push("forma de pagamento ja entrou na conversa");
  if (facts.locationKnown) out.push("localizacao ja foi informada");
  if (facts.budgetKnown) out.push("faixa de investimento ja apareceu");
  if (facts.authorityKnown) out.push("ha sinal sobre decisor ou decisao compartilhada");
  if (facts.timingKnown) out.push("o momento de compra ou execucao ja foi mencionado");
  if (!out.length && normalizeText(lastCustomerMessage)) out.push("ha mensagem recente do cliente para responder");
  return out;
}

function summarizeMissingFacts(facts: ConversationFactState, _lastCustomerMessage: string): string[] {
  const out: string[] = [];
  if (!facts.sizeKnown) out.push("espaco ou medida ainda nao esta claro");
  if (!facts.needKnown) out.push("a necessidade ou preferencia principal ainda pode ser refinada");
  if (!facts.installationInterestKnown) out.push("a conversa ainda nao deixou claro se entra instalacao");
  if (!facts.paymentInterestKnown) out.push("a forma de pagamento ainda nao esta clara");
  if (!facts.locationKnown) out.push("cidade, bairro ou local ainda nao foi confirmado");
  return out;
}

function inferRecommendationPolicy(args: {
  pattern: ConversationPattern;
  photoOrSimulationSubtype?: PhotoOrSimulationSubtype | null;
  facts: ConversationFactState;
  lastCustomerMessage: string;
  explicitCatalogRequest: boolean;
  shouldPresentPoolRecommendations: boolean;
  lastAiListedPools: boolean;
  requestedPoolReference: RequestedPoolReference | null;
  strongestPoolReferenceMatch: PoolReferenceMatchStrength;
}): RecommendationPolicy {
  const explicitVarietyRequest =
    looksLikeComparisonQuestion(args.lastCustomerMessage) ||
    asksToRepeatPoolOptions(args.lastCustomerMessage) ||
    /\b(variedade|comparar|comparacao|modelos|opcoes)\b/i.test(normalizeText(args.lastCustomerMessage));

  if (args.pattern === "generic_pool_opening") {
    return {
      allowRecommendations: false,
      poolOptionCount: 0,
      catalogOptionCount: 0,
      allowOnlySimilarLanguage: false,
      requireExactOrStrongMatchForNamedPool: false,
      reason: "abertura generica: nao listar opcoes cedo demais",
    };
  }

  if (args.pattern === "specific_model_or_ad_request" && args.requestedPoolReference) {
    const exactOrStrong =
      args.strongestPoolReferenceMatch === "exact" || args.strongestPoolReferenceMatch === "strong";

    return {
      allowRecommendations: exactOrStrong,
      poolOptionCount: exactOrStrong ? 1 : 0,
      catalogOptionCount: exactOrStrong ? 1 : 0,
      allowOnlySimilarLanguage: !exactOrStrong,
      requireExactOrStrongMatchForNamedPool: true,
      reason: exactOrStrong
        ? "modelo especifico com match confiavel: tratar como modelo encontrado"
        : "modelo especifico sem match exato ou forte: nao afirmar equivalencia",
    };
  }

  if (args.pattern === "photo_or_simulation_request") {
    if (
      args.photoOrSimulationSubtype === "product_photo_without_model" ||
      args.photoOrSimulationSubtype === "local_photo_context" ||
      args.photoOrSimulationSubtype === "simulation_visual_request" ||
      args.photoOrSimulationSubtype === "general_photo_request"
    ) {
      return {
        allowRecommendations: false,
        poolOptionCount: 0,
        catalogOptionCount: 0,
        allowOnlySimilarLanguage: false,
        requireExactOrStrongMatchForNamedPool: false,
        reason: "foto ou simulacao sem base suficiente para listar modelos agora",
      };
    }

    return {
      allowRecommendations: true,
      poolOptionCount: 1,
      catalogOptionCount: 1,
      allowOnlySimilarLanguage: false,
      requireExactOrStrongMatchForNamedPool: false,
      reason: "foto de produto com modelo claro: responder de forma objetiva",
    };
  }

  if (args.pattern === "pool_size_discovery") {
    const allowRecommendations = args.shouldPresentPoolRecommendations && args.facts.needKnown;
    return {
      allowRecommendations,
      poolOptionCount: allowRecommendations ? 1 : 0,
      catalogOptionCount: allowRecommendations ? 1 : 0,
      allowOnlySimilarLanguage: false,
      requireExactOrStrongMatchForNamedPool: false,
      reason: allowRecommendations
        ? "espaco e preferencia suficientes: afunilar para 1 opcao principal"
        : "espaco conhecido, mas ainda falta preferencia suficiente para recomendar",
    };
  }

  if (args.pattern === "pool_children_context") {
    const allowRecommendations = args.facts.sizeKnown || args.shouldPresentPoolRecommendations;
    return {
      allowRecommendations,
      poolOptionCount: allowRecommendations ? 1 : 0,
      catalogOptionCount: allowRecommendations ? 1 : 0,
      allowOnlySimilarLanguage: false,
      requireExactOrStrongMatchForNamedPool: false,
      reason: allowRecommendations
        ? "contexto infantil com base suficiente: priorizar 1 opcao segura e pratica"
        : "contexto infantil ainda precisa de espaco ou base minima antes de recomendar",
    };
  }

  if (args.pattern === "catalog_recommendation_or_refinement") {
    return {
      allowRecommendations: true,
      poolOptionCount: explicitVarietyRequest ? 3 : args.lastAiListedPools ? 1 : 2,
      catalogOptionCount: explicitVarietyRequest ? 3 : args.lastAiListedPools ? 1 : 2,
      allowOnlySimilarLanguage: false,
      requireExactOrStrongMatchForNamedPool: false,
      reason: explicitVarietyRequest
        ? "pedido explicito de variedade ou comparacao"
        : args.lastAiListedPools
          ? "cliente refinou opcoes ja apresentadas: afunilar"
          : "cliente quer recomendacao com ate 2 caminhos bons",
    };
  }

  if (args.shouldPresentPoolRecommendations || args.explicitCatalogRequest) {
    return {
      allowRecommendations: true,
      poolOptionCount: explicitVarietyRequest ? 3 : 2,
      catalogOptionCount: explicitVarietyRequest ? 3 : 2,
      allowOnlySimilarLanguage: false,
      requireExactOrStrongMatchForNamedPool: false,
      reason: explicitVarietyRequest
        ? "pedido de variedade ou comparacao"
        : "pedido de opcoes com contexto comercial suficiente",
    };
  }

  return {
    allowRecommendations: false,
    poolOptionCount: 0,
    catalogOptionCount: 0,
    allowOnlySimilarLanguage: false,
    requireExactOrStrongMatchForNamedPool: false,
    reason: "a conversa ainda pede qualificacao antes de recomendar",
  };
}

function shouldAskForCustomerLocationPhoto(args: {
  pattern: ConversationPattern;
  paymentOrClosingSubtype?: PaymentOrClosingSubtype;
  photoOrSimulationSubtype?: PhotoOrSimulationSubtype | null;
  facts: ConversationFactState;
  lastCustomerMessage: string;
  explicitCatalogRequest: boolean;
  patienceSignal: CustomerPatienceSignal;
  hasCustomerLocationPhoto: boolean;
}): boolean {
  if (args.hasCustomerLocationPhoto || args.patienceSignal.shouldAvoidNewQuestion) {
    return false;
  }

  if (
    args.pattern === "payment_or_closing_flow" ||
    args.pattern === "price_question" ||
    args.pattern === "discount_question" ||
    args.pattern === "specific_model_or_ad_request" ||
    args.pattern === "chemical_problem" ||
    args.pattern === "pause_or_disinterest" ||
    (args.paymentOrClosingSubtype && args.paymentOrClosingSubtype !== "none")
  ) {
    return false;
  }

  if (
    args.pattern === "photo_or_simulation_request" ||
    args.explicitCatalogRequest ||
    looksLikeTechnicalVisitQuestion(args.lastCustomerMessage) ||
    looksLikeExplicitVisitRequest(args.lastCustomerMessage) ||
    looksLikeExtendedQuoteRequest(args.lastCustomerMessage) ||
    isVagueGreetingOrPing(args.lastCustomerMessage) ||
    hasSpecificPoolReference(args.lastCustomerMessage)
  ) {
    return false;
  }

  if (args.photoOrSimulationSubtype === "product_photo_specific") {
    return false;
  }

  const text = normalizeText(args.lastCustomerMessage);
  const mentionsSpaceContext =
    args.facts.sizeKnown ||
    text.includes("quintal") ||
    text.includes("espaco") ||
    text.includes("espaço") ||
    text.includes("local") ||
    text.includes("lugar") ||
    text.includes("area") ||
    text.includes("área") ||
    text.includes("medida") ||
    text.includes("medidas") ||
    text.includes("metros") ||
    text.includes("cabe") ||
    text.includes("encaixe");

  const asksRecommendationHelp =
    looksLikePoolRecommendationRequest(args.lastCustomerMessage) &&
    !hasSpecificPoolReference(args.lastCustomerMessage);

  return mentionsSpaceContext || asksRecommendationHelp;
}

function inferNextBestQuestion(args: {
  pattern: ConversationPattern;
  paymentOrClosingSubtype?: PaymentOrClosingSubtype;
  photoOrSimulationSubtype?: PhotoOrSimulationSubtype | null;
  productPhotoRequestContext?: ProductPhotoRequestContext | null;
  facts: ConversationFactState;
  intents: DetectedIntent[];
  lastCustomerMessage: string;
  explicitCatalogRequest: boolean;
  patienceSignal: CustomerPatienceSignal;
  offersTechnicalVisit: boolean;
  lastAiListedPools: boolean;
  hasCustomerLocationPhoto: boolean;
}): string | null {
  const {
    pattern,
    paymentOrClosingSubtype,
    photoOrSimulationSubtype,
    productPhotoRequestContext,
    facts,
    intents,
    lastCustomerMessage,
    explicitCatalogRequest,
    patienceSignal,
    offersTechnicalVisit,
    lastAiListedPools,
    hasCustomerLocationPhoto,
  } = args;

  if (patienceSignal.shouldAvoidNewQuestion) {
    return null;
  }

  if (
    shouldAskForCustomerLocationPhoto({
      pattern,
      paymentOrClosingSubtype,
      photoOrSimulationSubtype,
      facts,
      lastCustomerMessage,
      explicitCatalogRequest,
      patienceSignal,
      hasCustomerLocationPhoto,
    })
  ) {
    return "Você tem uma foto do lugar? Com a foto dá pra entender melhor o espaço e me ajuda a te sugerir piscinas melhores";
  }

  if (pattern === "generic_pool_opening") {
    return "Beleza, voce ja tem algum modelo em mente? Se nao tiver, posso te mostrar algumas opcoes. Me fala tambem mais ou menos o espaco que voce tem pra colocar a piscina";
  }

  if (pattern === "pool_size_discovery") {
    return "Com esse espaco ja da para afunilar melhor as opcoes. Voce prefere algo mais simples de manter ou uma opcao com mais conforto?";
  }

  if (pattern === "pool_children_context") {
    if (facts.sizeKnown) {
      return "Voce prefere uma piscina mais rasa ou nao tem preferencia quanto a profundidade?";
    }
    return "me fala tambem mais ou menos o espaco que voce tem pra colocar a piscina";
  }

  if (pattern === "discount_question") {
    const normalizedDiscountMessage = normalizeText(lastCustomerMessage);
    const explicitPaymentCondition = hasExplicitPaymentConditionSignal(lastCustomerMessage);
    const askedPixImprovement =
      normalizedDiscountMessage.includes("pix melhora") ||
      normalizedDiscountMessage.includes("no pix melhora") ||
      normalizedDiscountMessage.includes("a vista melhora") ||
      normalizedDiscountMessage.includes("avista melhora");

    if (hasSpecificPoolReference(lastCustomerMessage)) {
      if (!facts.installationInterestKnown && !looksLikeInstallationQuestion(lastCustomerMessage)) {
        return "Voce esta olhando so a piscina ou tambem instalacao?";
      }
      if (!explicitPaymentCondition) {
        return facts.sizeKnown || facts.needKnown
          ? "Voce quer priorizar o menor preco ou uma opcao pequena com um pouco mais de conforto?"
          : "Quer que eu te mostre as opcoes mais em conta?";
      }
      if (!askedPixImprovement && !facts.paymentInterestKnown) {
        return "Seria no Pix/a vista ou parcelado?";
      }
      return "Qual condicao faz mais sentido pra voce hoje: so a piscina ou piscina com instalacao?";
    }

    if (facts.needKnown) {
      return explicitPaymentCondition
        ? askedPixImprovement
          ? "Qual modelo voce esta pensando pra eu ver a condicao mais real?"
          : "Seria no Pix/a vista ou parcelado?"
        : "Voce quer priorizar o menor preco ou uma opcao com um pouco mais de conforto?";
    }

    return explicitPaymentCondition
      ? "Qual modelo voce esta pensando pra eu ver a condicao mais real?"
      : "Quer que eu te mostre as opcoes mais acessiveis?";
  }

  if (pattern === "payment_or_closing_flow") {
    if (paymentOrClosingSubtype === "closing_or_buying") {
      return "Me fala qual condicao faz mais sentido pra voce hoje que eu te oriento no proximo passo";
    }
    return null;
  }

  if (looksLikeTechnicalVisitQuestion(lastCustomerMessage)) {
    return facts.locationKnown
      ? "Vou verificar na agenda os horarios disponiveis. Qual dia ou periodo costuma ser melhor pra voce?"
      : "Vou verificar na agenda os dias que temos disponiveis. Me confirma sua cidade ou bairro e qual dia ou periodo costuma ser melhor pra voce?";
  }

  if (pattern === "photo_or_simulation_request") {
    if (productPhotoRequestContext?.kind === "ambiguous") {
      return "Qual modelo voce quer ver na foto?";
    }
    if (productPhotoRequestContext?.kind === "generic_request") {
      return "Se quiser, eu posso te indicar algumas opcoes reais antes. Voce prefere algo mais compacto ou ja tem algum modelo em mente?";
    }
    if (
      productPhotoRequestContext?.kind === "resolved_with_photo" ||
      productPhotoRequestContext?.kind === "resolved_without_photo"
    ) {
      return null;
    }
    if (photoOrSimulationSubtype === "product_photo_without_model") {
      return "Tenho como verificar sim. Qual modelo de piscina voce quer ver a foto?";
    }
    if (photoOrSimulationSubtype === "product_photo_specific") {
      return null;
    }
    if (photoOrSimulationSubtype === "simulation_visual_request") {
      return "Com uma foto do espaço dá pra entender melhor o local e indicar modelos que combinam melhor. Me manda uma foto do lugar que eu te ajudo por aqui";
    }
    if (facts.sizeKnown) {
      return "Se conseguir, me fala tambem se tem alguma limitacao de acesso ou detalhe do espaco que te preocupa mais";
    }
    return "Pode mandar sim. Se conseguir, me manda tambem uma nocao de medida do espaco, porque isso ajuda bastante a orientar melhor";
  }

  if (pattern === "specific_model_or_ad_request") {
    return null;
  }

  if (
    (explicitCatalogRequest || intents.includes("comparison") || looksLikePoolChoice(lastCustomerMessage)) &&
    !facts.sizeKnown
  ) {
    return "me fala mais ou menos o espaco que voce tem pra colocar a piscina";
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
    return "Com esse espaco faz sentido olhar modelos mais compactos. Voce prefere algo mais simples de manter ou uma opcao com mais conforto?";
  }

  if (
    (intents.includes("installation") || intents.includes("technical_visit") || intents.includes("region")) &&
    !facts.locationKnown
  ) {
    return "qual sua cidade ou bairro?";
  }

  if (intents.includes("price") && !facts.budgetKnown) {
    return "voce pensa em uma faixa mais economica, intermediaria ou algo mais premium?";
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
  pattern: ConversationPattern;
  paymentOrClosingSubtype?: PaymentOrClosingSubtype;
  photoOrSimulationSubtype?: PhotoOrSimulationSubtype | null;
  productPhotoRequestContext?: ProductPhotoRequestContext | null;
  intents: DetectedIntent[];
  facts: ConversationFactState;
  nextBestQuestion: string | null;
  responseMode: ResponseMode;
  explicitCatalogRequest: boolean;
  lastCustomerMessage: string;
  lastAiListedPools: boolean;
  patienceSignal: CustomerPatienceSignal;
  recommendationPolicy: RecommendationPolicy;
  requestedPoolReference: RequestedPoolReference | null;
  strongestPoolReferenceMatch: PoolReferenceMatchStrength;
  bestNamedPoolMatch: MatchedPool | null;
  offersTechnicalVisit: boolean;
}): string {
  const {
    pattern,
    paymentOrClosingSubtype,
    photoOrSimulationSubtype,
    productPhotoRequestContext,
    intents,
    facts,
    responseMode,
    patienceSignal,
    requestedPoolReference,
    strongestPoolReferenceMatch,
    bestNamedPoolMatch,
    offersTechnicalVisit,
    lastCustomerMessage,
    lastAiListedPools,
  } = args;

  const suggestVisitAdvance = shouldSuggestVisitAdvance({
    facts,
    intents,
    pattern,
    lastCustomerMessage,
    offersTechnicalVisit,
    lastAiListedPools,
  });

  if (patienceSignal.status === "not_interested") {
    if (isHardStopMessage(args.lastCustomerMessage)) {
      return "parar imediatamente, reconhecer o pedido do cliente sem discutir e encerrar sem deixar gancho comercial insistente";
    }
    return "respeitar o desinteresse, encerrar com educacao e nao tentar reabrir a venda nesta resposta";
  }

  if (patienceSignal.status === "thinking") {
    return "acolher o tempo do cliente ou a decisao compartilhada, nao pressionar e deixar no maximo uma porta aberta leve e humana, sem nova triagem nem tentativa de fechamento";
  }

  if (patienceSignal.status === "follow_up_requested") {
    return "reconhecer o prazo ou retorno futuro pedido pelo cliente, respeitar esse momento e nao forcar fechamento nem prometer follow-up automatico real se nao existe scheduler conectado";
  }

  if (patienceSignal.status === "unclear_pause") {
    return "baixar a pressao comercial, tratar pesquisa fria ou pausa sem aquecer artificialmente o lead e manter a porta aberta de forma curta, sem insistir";
  }

  if (
    pattern === "discount_question" &&
    intents.includes("price") &&
    requestedPoolReference &&
    (strongestPoolReferenceMatch === "exact" || strongestPoolReferenceMatch === "strong") &&
    hasTrustedPoolPrice(bestNamedPoolMatch)
  ) {
    return "responder primeiro o preco do modelo encontrado e, na sequencia, tratar desconto ou condicao de pagamento com protecao de margem, sem prometer abatimento automatico";
  }

  if (pattern === "discount_question") {
    return hasExplicitPaymentConditionSignal(args.lastCustomerMessage)
      ? "responder a objecao de preco ou pedido de desconto de forma comercial, proteger margem, vender valor antes de reduzir preco e tratar a condicao como dependente de modelo, projeto e forma de pagamento, sempre respeitando a configuracao da loja"
      : "responder a objecao de preco ou limite de orcamento de forma comercial, reconhecer a limitacao, sugerir alternativa mais economica real quando houver base e usar contexto ja conhecido antes de perguntar algo novo, sem puxar forma de pagamento como saida generica";
  }

  if (looksLikeTechnicalVisitQuestion(args.lastCustomerMessage)) {
    return offersTechnicalVisit
      ? "tratar visita como proximo passo comercial seguro, coletar cidade ou bairro e melhor dia ou periodo, dizer que vai verificar na agenda a disponibilidade e nao afirmar que a visita ja foi agendada ou confirmada"
      : "explicar com sinceridade que a visita depende de validacao interna, coletar cidade ou bairro e melhor dia ou periodo e nao prometer agendamento como se estivesse executado";
  }

  if (pattern === "payment_or_closing_flow") {
    if (paymentOrClosingSubtype === "payment_submitted" || paymentOrClosingSubtype === "receipt_submitted") {
      return "agradecer a sinalizacao de pagamento ou comprovante, informar com naturalidade que voce vai pedir a validacao do responsavel e nao tratar pagamento como validado ou confirmado antes disso";
    }
    if (paymentOrClosingSubtype === "pix_key_request") {
      return "orientar sobre Pix apenas com base na configuracao viva da loja; se a chave ou instrucao exata nao estiver clara no contexto, nao inventar e dizer que a chave correta precisa ser confirmada antes de passar";
    }
    if (paymentOrClosingSubtype === "reservation_or_hold") {
      return "tratar reserva ou separacao como proximo passo dependente de validacao real, sem afirmar que o produto ja ficou reservado ou separado";
    }
    if (paymentOrClosingSubtype === "contract_request") {
      return "explicar de forma comercial e simples que contrato pode exigir encaminhamento ou preparacao pela loja, sem dizer que a IA emitiu, assinou ou concluiu esse passo";
    }
    if (paymentOrClosingSubtype === "closing_or_buying") {
      return "reconhecer intencao forte de compra, orientar o proximo passo com base nas condicoes configuradas da loja e conduzir para validacao segura, sem declarar venda fechada antes de confirmacao real";
    }
    if (paymentOrClosingSubtype === "down_payment_or_entry") {
      return "explicar entrada, sinal ou condicao inicial apenas com base na configuracao viva da loja e, se faltar base, tratar como condicao a confirmar em vez de inventar regra";
    }
    return "orientar pagamento ou fechamento com base nas configuracoes vivas da loja, responder o ponto principal do cliente e conduzir o proximo passo sem confirmar pagamento, comprovante, reserva, contrato ou venda como concluidos";
  }

  if (
    pattern === "specific_model_or_ad_request" &&
    intents.includes("price") &&
    requestedPoolReference &&
    (strongestPoolReferenceMatch === "exact" || strongestPoolReferenceMatch === "strong") &&
    hasTrustedPoolPrice(bestNamedPoolMatch)
  ) {
    return "responder o preco do modelo encontrado logo no comeco, usando o valor base do catalogo e a faixa do cadastro quando existir, e so depois fazer uma pergunta curta de avanco";
  }

  if (responseMode === "objective") {
    return "responder exatamente o que foi perguntado, com clareza, sem excesso de expansao e com no maximo um avanco curto";
  }

  if (pattern === "generic_pool_opening") {
    return "responder como vendedora de WhatsApp, sem listar catalogo, e puxar so o basico para sair do generico: modelo em mente e espaco disponivel";
  }

  if (pattern === "pool_size_discovery") {
    return "interpretar o espaco, afunilar melhor as opcoes pelo tamanho e avancar com no maximo uma pergunta pratica sobre manutencao, conforto, custo ou proximo passo, sem reabrir motivacao";
  }

  if (pattern === "pool_children_context") {
    return "priorizar seguranca, praticidade, supervisao facil e manutencao simples. Se ja houver espaco informado, afunilar para modelos compactos, seguros e simples de cuidar, sem puxar conforto premium ou recursos extras";
  }

  if (pattern === "photo_or_simulation_request") {
    if (productPhotoRequestContext?.kind === "resolved_with_photo") {
      return "responder com honestidade que existe foto real cadastrada para o modelo identificado, sem dizer que ja enviou a foto e sem prometer envio automatico nesta etapa";
    }
    if (productPhotoRequestContext?.kind === "resolved_without_photo") {
      return "responder com honestidade que nao ha foto cadastrada para o modelo identificado no momento, sem inventar imagem, e continuar ajudando com informacoes do produto";
    }
    if (productPhotoRequestContext?.kind === "ambiguous") {
      return "descobrir primeiro qual modelo o cliente quer ver em foto antes de prometer qualquer imagem, sem escolher produto aleatorio";
    }
    if (productPhotoRequestContext?.kind === "generic_request") {
      return "afunilar primeiro o tipo de modelo ou sugerir opcoes reais antes de falar em foto especifica, sem escolher imagem aleatoria";
    }
    if (photoOrSimulationSubtype === "simulation_visual_request") {
      return "explicar com naturalidade que foto e medidas ajudam bastante a orientar melhor, mas sem prometer montagem visual pronta, render ou simulacao real neste momento, e manter um proximo passo comercial util";
    }
    if (photoOrSimulationSubtype === "product_photo_without_model") {
      return "descobrir primeiro qual modelo de piscina o cliente quer ver em foto, sem citar piscinas aleatorias nem supor produto por conta propria";
    }
    if (photoOrSimulationSubtype === "product_photo_specific") {
      return "responder sobre a foto do modelo especifico citado no contexto, usando apenas a evidencia real de foto cadastrada desse modelo e sem trocar para outro produto sem necessidade";
    }
    return "tratar a foto do local como apoio comercial para orientar melhor por espaco, acesso e encaixe; pedir medida quando faltar; e ser totalmente sincera sem prometer simulacao, render, montagem visual ou analise real da imagem";
  }

  if (pattern === "specific_model_or_ad_request") {
    return "responder a referencia especifica primeiro, sem tratar como lead generico, e so depois conduzir com uma pergunta curta se ainda faltar contexto critico";
  }

  if (intents.includes("comparison")) {
    return "comparar de forma pratica e objetiva, destacando diferencas que realmente ajudem o cliente a decidir";
  }

  if (args.recommendationPolicy.allowRecommendations) {
    if (args.recommendationPolicy.poolOptionCount <= 1) {
      return "afunilar a conversa para 1 opcao principal do catalogo, com motivo curto e util";
    }
    if (args.recommendationPolicy.poolOptionCount === 2) {
      return "trabalhar com 2 caminhos fortes e diferentes, sem despejar lista grande";
    }
    return "organizar uma comparacao curta de ate 3 opcoes porque houve pedido claro de variedade";
  }

  if (facts.sizeKnown && facts.needKnown) {
    return "usar o contexto ja dado para orientar com mais precisao, sem voltar para perguntas amplas ou repetir triagem";
  }

  return "responder de forma comercial, objetiva e natural, avançando só um passo útil sem parecer formulário";
}

function inferForbiddenInThisReply(args: {
  pattern: ConversationPattern;
  paymentOrClosingSubtype?: PaymentOrClosingSubtype;
  photoOrSimulationSubtype?: PhotoOrSimulationSubtype | null;
  intents: DetectedIntent[];
  nextBestQuestion: string | null;
  responseMode: ResponseMode;
  explicitCatalogRequest: boolean;
  lastAiListedPools: boolean;
  lastCustomerMessage: string;
  patienceSignal: CustomerPatienceSignal;
  recommendationPolicy: RecommendationPolicy;
  requestedPoolReference: RequestedPoolReference | null;
  strongestPoolReferenceMatch: PoolReferenceMatchStrength;
  offersTechnicalVisit: boolean;
}): string[] {
  const out: string[] = [];

  if (args.pattern === "generic_pool_opening") {
    out.push("nao listar catalogo ou varios modelos cedo demais");
    out.push("nao perguntar orcamento, pagamento ou cidade logo na abertura generica");
  }

  if (args.pattern === "pool_size_discovery") {
    out.push("nao voltar para perguntas amplas de uso, motivo, familia, lazer, filhos ou outro motivo");
    out.push("nao perguntar criancas ou adultos como padrao desta etapa");
    out.push("nao puxar spa, hidromassagem ou recursos extras cedo");
  }

  if (args.pattern === "pool_children_context") {
    out.push("nao vender luxo, spa, hidromassagem ou recurso extra cedo quando o contexto principal for filhos ou criancas");
    out.push("nao repetir pergunta sobre algo que o cliente ja respondeu");
  }

  if (args.pattern === "discount_question") {
    out.push("nao revelar desconto maximo, percentual interno ou margem da loja");
    out.push("nao abrir percentual de desconto por conta propria");
    out.push("nao comecar a resposta oferecendo desconto");
    out.push("nao inventar promocao, condicao especial ou desconto no Pix");
    out.push("nao aceitar automaticamente proposta do tipo fecha por R$ X sem base ou aprovacao");
    out.push("nao entrar em guerra de preco com concorrente");
    out.push("nao confirmar condicao sensivel de pagamento, Pix, comprovante ou contrato sem base/configuracao");
    out.push("nao responder so com depende; primeiro defenda valor e depois explique a condicao com criterio");
    if (!hasExplicitPaymentConditionSignal(args.lastCustomerMessage)) {
      out.push("nao puxar formas de pagamento, Pix, parcelamento, cartao, entrada ou condicao especial se o cliente nao trouxe pagamento");
      out.push("nao sugerir frases como formas de pagamento que podem ajudar no orcamento ou condicao de pagamento que pode ajudar");
      out.push("nao usar frases vagas como se quiser seguir por esse caminho");
      out.push("nao escrever forma de pagamento, formas de pagamento, condicoes de pagamento, Pix ou parcelado, a vista ou parcelado, facilitar no pagamento, ajudar no orcamento, no Pix ou entrada");
    }
  }

  if (args.pattern === "payment_or_closing_flow") {
    out.push("nao inventar forma de pagamento que nao esteja configurada na loja");
    out.push("nao inventar chave Pix, QR Code, link de pagamento ou instrucao transacional");
    out.push("nao inventar parcelamento, numero de parcelas, entrada, sinal ou condicao especial");
    out.push("nao confirmar pagamento, Pix ou comprovante sem validacao real");
    out.push("nao escrever pagamento confirmado, Pix confirmado ou comprovante validado");
    out.push("nao dizer que a venda esta fechada antes da confirmacao real da loja ou sistema");
    out.push("nao dizer que o produto foi reservado, separado ou segurado sem base real");
    out.push("nao dizer que o contrato foi emitido, enviado para assinatura ou assinado pela IA");
    out.push("nao aceitar condicao comercial sensivel sem configuracao, aprovacao ou validacao real");
  }

  if (looksLikeTechnicalVisitQuestion(args.lastCustomerMessage)) {
    out.push("nao escrever posso agendar sim, agendei, visita agendada, visita confirmada, horario marcado, ja marquei, esta marcado ou ficou agendado");
    out.push("nao prometer disponibilidade como se a agenda ja tivesse sido verificada");
    if (!args.offersTechnicalVisit) {
      out.push("nao inventar que a loja faz visita tecnica se isso nao estiver configurado");
    }
  }

  if (args.pattern === "photo_or_simulation_request") {
    out.push("nao dizer que analisou a foto, o quintal, o terreno ou o local se nao houve processamento real da imagem");
    out.push("nao usar frases como pela foto da para ver, vendo sua foto ou analisando a imagem sem base real");
    out.push("nao prometer montagem visual, render, simulacao pronta, foto editada ou visualizacao final");
    out.push("nao dizer que vai editar, montar ou gerar imagem do local");
    out.push("nao dizer que ja enviou, mandou, anexou ou mostrou a foto se isso nao aconteceu de fato");
    out.push("nao prometer envio automatico de foto nesta etapa");
    out.push("nao confundir foto cadastrada do produto com foto do local do cliente");
    out.push("nao tratar pedido de foto do local como se o sistema ja recebesse, processasse e entendesse a imagem automaticamente");
    out.push("nao abrir catalogo cedo demais se ainda faltar medida ou contexto basico do espaco");
    if (args.photoOrSimulationSubtype === "simulation_visual_request") {
      out.push("nao reduzir pedido de simulacao a um simples pode mandar foto sem deixar claro que montagem visual pronta nao esta garantida");
    }
    if (args.photoOrSimulationSubtype === "product_photo_without_model") {
      out.push("nao escolher um modelo de piscina por conta propria quando o cliente pediu foto sem dizer qual modelo");
      out.push("nao citar fotos de piscinas aleatorias quando ainda falta identificar a piscina certa");
    }
    if (args.photoOrSimulationSubtype === "product_photo_specific") {
      out.push("nao trocar o modelo pedido por outro modelo so porque ele tambem tem foto cadastrada");
    }
  }

  if (args.pattern === "specific_model_or_ad_request") {
    out.push("nao ignorar o modelo, anuncio ou referencia especifica citada pelo cliente");
    out.push("nao responder com triagem generica antes de tratar a referencia especifica");
    if (
      args.requestedPoolReference &&
      args.recommendationPolicy.requireExactOrStrongMatchForNamedPool &&
      (args.strongestPoolReferenceMatch === "weak" || args.strongestPoolReferenceMatch === "none")
    ) {
      out.push(`nao dizer que "${args.requestedPoolReference.raw}" e o mesmo item de um modelo do catalogo sem match exato ou forte`);
      out.push("nao tratar referencia incerta como equivalencia confirmada; no maximo apresente como opcao parecida");
    }
  }

  if (args.intents.includes("price")) {
    out.push("nao fugir da pergunta de preco");
  }

  if (args.intents.includes("payment")) {
    out.push("nao inventar forma de pagamento, chave Pix, parcelamento ou condicao de entrada");
  }

  if (args.intents.includes("comparison")) {
    out.push("nao responder comparacao com texto generico sem contraste real");
  }

  if (!args.nextBestQuestion) {
    out.push("nao inventar pergunta no final so para encerrar com interrogacao");
  }

  if (!args.explicitCatalogRequest && args.lastAiListedPools && !isAffirmativeReply(args.lastCustomerMessage)) {
    out.push("nao listar novos modelos novamente se o cliente nao pediu isso explicitamente agora");
  }

  if (
    args.lastAiListedPools &&
    hasNewPoolRefinementSignal(args.lastCustomerMessage) &&
    !asksToRepeatPoolOptions(args.lastCustomerMessage) &&
    !looksLikePoolRecommendationRequest(args.lastCustomerMessage)
  ) {
    out.push("nao repetir lista completa de modelos se a IA ja listou opcoes antes");
    out.push("nao recomecar a recomendacao do zero; usar o novo dado do cliente para afunilar");
    out.push("nao ignorar a nova informacao do cliente ao recomendar");
    out.push("nao listar 3 modelos novamente quando bastar destacar a melhor opcao ou as 2 melhores");
  }

  if (args.recommendationPolicy.poolOptionCount <= 1) {
    out.push("nao listar 3 modelos por padrao quando a politica desta resposta pede afunilamento");
  }

  if (args.responseMode === "objective") {
    out.push("nao abrir explicacao longa alem do que o cliente perguntou");
    out.push("nao adicionar varios assuntos extras na mesma resposta");
    out.push("nao transformar a resposta em apresentacao completa da operacao");
    out.push("nao listar todos os detalhes operacionais quando bastar uma confirmacao objetiva");
  }

  if (args.patienceSignal.status !== "active_interest") {
    out.push("nao fazer nova pergunta comercial quando o cliente pediu tempo, indicou pausa ou demonstrou desinteresse");
    out.push("nao insistir, pressionar, criar urgencia falsa ou tentar contornar a pausa do cliente");
    out.push("nao listar novos modelos, condicoes ou beneficios para tentar vencer a pausa nesta resposta");
    out.push("nao cobrar resposta, retorno ou decisao do cliente");
  }

  if (args.patienceSignal.status === "not_interested") {
    out.push("nao tentar recuperar a venda nesta resposta; apenas encerrar com educacao e deixar a porta aberta");
    out.push("nao escrever quando mudar de ideia; use se mudar de ideia");
    out.push("nao oferecer catalogo, comparacao, desconto ou nova chamada comercial");
    if (isHardStopMessage(args.lastCustomerMessage)) {
      out.push("nao deixar porta comercial insistente quando o cliente pediu para parar contato");
    }
  }

  if (args.patienceSignal.status === "follow_up_requested") {
    out.push("nao prometer que vai chamar em data futura como tarefa automatica garantida se nao existe scheduler real conectado");
    out.push("nao agir como se ja tivesse criado lembrete, agendamento ou follow-up automatico");
  }

  if (args.patienceSignal.status === "unclear_pause") {
    out.push("nao tratar so pesquisando, agora nao ou mais pra frente como lead quente");
    out.push("nao empurrar fechamento, catalogo ou condicao comercial como se o cliente estivesse pronto para decidir");
  }

  return out;
}

function buildCommercialObjective(args: {
  facts: ConversationFactState;
  orderedMessages: MessageRow[];
  lastCustomerMessage: string;
  photoOrSimulationSubtype?: PhotoOrSimulationSubtype | null;
  productPhotoRequestContext?: ProductPhotoRequestContext | null;
  explicitCatalogRequest: boolean;
  lastAiListedPools: boolean;
  shouldPresentPoolRecommendations: boolean;
  offersTechnicalVisit: boolean;
  recommendationPolicy: RecommendationPolicy;
  requestedPoolReference: RequestedPoolReference | null;
  strongestPoolReferenceMatch: PoolReferenceMatchStrength;
  bestNamedPoolMatch: MatchedPool | null;
}): CommercialObjective {
  const facts = args.facts;
  const alreadyHasCustomerLocationPhoto = hasCustomerLocationPhoto(args.orderedMessages);
  const intents = detectIntents(args.lastCustomerMessage);
  const paymentOrClosingSubtype = detectPaymentOrClosingSubtype(args.lastCustomerMessage);
  const responseMode: ResponseMode = isObjectiveQuestionMode(args.lastCustomerMessage)
    ? "objective"
    : "consultative";
  const patienceSignal = analyzeCustomerPatienceSignal(args.lastCustomerMessage);
  const pattern = detectConversationPattern({
    facts,
    intents,
    lastCustomerMessage: args.lastCustomerMessage,
    explicitCatalogRequest: args.explicitCatalogRequest,
    patienceSignal,
    shouldPresentPoolRecommendations: args.shouldPresentPoolRecommendations,
    lastAiListedPools: args.lastAiListedPools,
    paymentOrClosingSubtype,
  });

  const nextBestQuestion = inferNextBestQuestion({
    pattern,
    paymentOrClosingSubtype,
    photoOrSimulationSubtype: args.photoOrSimulationSubtype,
    productPhotoRequestContext: args.productPhotoRequestContext,
    facts,
    intents,
    lastCustomerMessage: args.lastCustomerMessage,
    explicitCatalogRequest: args.explicitCatalogRequest,
    patienceSignal,
    offersTechnicalVisit: args.offersTechnicalVisit,
    lastAiListedPools: args.lastAiListedPools,
    hasCustomerLocationPhoto: alreadyHasCustomerLocationPhoto,
  });

  return {
    pattern,
    paymentOrClosingSubtype,
    intents,
    primaryIntent: inferPrimaryIntent(args.lastCustomerMessage),
    mustAnswerFirst: inferMustAnswerFirst(intents),
    knownFacts: summarizeKnownFacts(facts, args.lastCustomerMessage),
    missingFacts: summarizeMissingFacts(facts, args.lastCustomerMessage),
    nextBestQuestion,
    responseGoal: inferResponseGoal({
      pattern,
      paymentOrClosingSubtype,
      photoOrSimulationSubtype: args.photoOrSimulationSubtype,
      productPhotoRequestContext: args.productPhotoRequestContext,
      intents,
      facts,
      nextBestQuestion,
      responseMode,
      explicitCatalogRequest: args.explicitCatalogRequest,
      lastCustomerMessage: args.lastCustomerMessage,
      lastAiListedPools: args.lastAiListedPools,
      patienceSignal,
      recommendationPolicy: args.recommendationPolicy,
      requestedPoolReference: args.requestedPoolReference,
      strongestPoolReferenceMatch: args.strongestPoolReferenceMatch,
      bestNamedPoolMatch: args.bestNamedPoolMatch,
      offersTechnicalVisit: args.offersTechnicalVisit,
    }),
    forbiddenInThisReply: inferForbiddenInThisReply({
      pattern,
      paymentOrClosingSubtype,
      photoOrSimulationSubtype: args.photoOrSimulationSubtype,
      intents,
      nextBestQuestion,
      responseMode,
      explicitCatalogRequest: args.explicitCatalogRequest,
      lastAiListedPools: args.lastAiListedPools,
      lastCustomerMessage: args.lastCustomerMessage,
      patienceSignal,
      recommendationPolicy: args.recommendationPolicy,
      requestedPoolReference: args.requestedPoolReference,
      strongestPoolReferenceMatch: args.strongestPoolReferenceMatch,
      offersTechnicalVisit: args.offersTechnicalVisit,
    }),
    responseMode,
    patienceSignal,
  };
}


function formatPatienceToneGuidance(signal: CustomerPatienceSignal): string {
  if (signal.status === "not_interested") {
    return [
      "- tom recomendado: curto, leve e sem tentativa de recuperação",
      "- frase segura: Tudo bem, sem problema. Se precisar de algo no futuro, me avisa.",
      "- nunca usar: Quando mudar de ideia",
      "- não adicionar pergunta, catálogo, benefício, urgência ou tentativa de convencer",
    ].join("\n");
  }

  if (signal.status === "follow_up_requested") {
    return [
      "- tom recomendado: bem leve, curto e natural",
      `- frase segura: ${signal.followUpTiming === "amanhã" ? "Ok, amanhã eu te chamo." : signal.followUpTiming === "semana que vem" ? "Beleza, semana que vem eu retorno." : signal.followUpTiming === "mês que vem" ? "Ok, mês que vem eu retorno." : "Ok, eu retorno depois."}`,
      "- alternativa segura: Beleza, vou considerar esse prazo.",
      "- não prometer agendamento automático, lembrete criado ou contato garantido em data futura se isso não existe de verdade",
      "- não fazer nova pergunta comercial nesta resposta",
    ].join("\n");
  }

  if (signal.status === "thinking") {
    return [
      "- tom recomendado: acolher sem pressionar e sem alongar",
      "- frase segura: Ok, sem pressa. Se precisar estou aqui.",
      "- se houver decisão compartilhada, não ofereça resumo automaticamente a menos que isso ajude muito; mantenha leve",
      "- não fazer nova pergunta comercial nesta resposta",
    ].join("\n");
  }

  if (signal.status === "unclear_pause") {
    return [
      "- tom recomendado: baixar a pressão e manter a porta aberta",
      "- frase segura: Beleza, se precisar de mais alguma coisa me avisa.",
      "- não tratar esse momento como fechamento quente",
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
- padrão dominante: ${objective.pattern}
- subtipo de pagamento/fechamento: ${objective.paymentOrClosingSubtype}
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

function collectRecentCustomerMessages(messages: MessageRow[], limit = 4): string[] {
  return messages
    .filter(
      (msg) =>
        normalizeText(msg.sender) === "user" &&
        normalizeText(msg.direction) === "incoming" &&
        getEffectiveMessageContent(msg).length > 0
    )
    .slice(-limit)
    .map((msg) => getEffectiveMessageContent(msg));
}

function isVagueGreetingOrPing(text: string): boolean {
  const normalized = normalizeText(text);

  if (!normalized) return false;

  const vagueMessages = new Set([
    "oi",
    "ola",
    "olá",
    "bom dia",
    "boa tarde",
    "boa noite",
    "teste",
    "?",
    "ta ai",
    "tá aí",
    "preciso falar",
  ]);

  if (vagueMessages.has(normalized)) return true;

  return (
    /^o+i+$/i.test(normalized) ||
    /^ola+$/i.test(normalized) ||
    /^ol+a+$/i.test(normalized) ||
    /^ta ai\??$/i.test(normalized) ||
    /^tem alguem ai\??$/i.test(normalized) ||
    /^[?!. ]+$/.test(normalized)
  );
}

function buildCustomerSituationInstructionBlock(args: {
  orderedMessages: MessageRow[];
  lastCustomerMessage: string;
  lastAiMessage: string | null;
  customerConversationText: string;
  leadName: string | null;
}): string {
  const recentCustomerMessages = collectRecentCustomerMessages(args.orderedMessages, 4);
  const locationText = extractLocationSnippet(args.customerConversationText);
  const spaceText = extractSpaceText(args.customerConversationText);
  const requestedAreaM2 = extractRequestedAreaM2(args.customerConversationText);
  const preferredPeriodText = extractPreferredPeriodSnippet(args.customerConversationText);
  const requestedModel = extractRequestedPoolReference(args.customerConversationText)?.raw || null;
  const relevantObjection = extractRelevantObjection(args.customerConversationText);
  const customerPreferences = extractCustomerPreferencesText(args.customerConversationText);

  return [
    "LEITURA DA SITUACAO DO CLIENTE",
    `- ultimas falas do cliente para considerar como uma conversa unica: ${recentCustomerMessages.length > 0 ? recentCustomerMessages.map((item) => `"${item}"`).join(" | ") : `"${args.lastCustomerMessage}"`}`,
    `- nome do cliente: ${args.leadName || "nao informado"}`,
    `- cidade/regiao ja informada: ${locationText || "nao identificado"}`,
    `- espaco/medida ja informados: ${spaceText || (requestedAreaM2 != null ? `${requestedAreaM2} m2` : "nao identificado")}`,
    `- modelo ou anuncio citado: ${requestedModel || "nao identificado"}`,
    `- preferencia comercial percebida: ${customerPreferences || "nao identificado"}`,
    `- objecao ou sensibilidade comercial percebida: ${relevantObjection || "nao identificado"}`,
    `- melhor periodo citado: ${preferredPeriodText || "nao identificado"}`,
    `- ultima resposta da IA para evitar repeticao: ${args.lastAiMessage || "nenhuma resposta anterior relevante"}`,
  ].join("\n");
}

function buildSalesResponseBrainInstructionBlock(args: {
  orderedMessages: MessageRow[];
  lastCustomerMessage: string;
  lastAiMessage: string | null;
  customerConversationText: string;
  nextBestQuestion: string | null;
  requestedPoolReference: RequestedPoolReference | null;
  strongestPoolReferenceMatch: PoolReferenceMatchStrength;
}): string {
  const vagueGreeting = isVagueGreetingOrPing(args.lastCustomerMessage);
  const hasIntegratedCustomerContext = collectRecentCustomerMessages(args.orderedMessages, 4).length >= 2;
  const requestedModel = args.requestedPoolReference?.raw || null;
  const modelNotWorked =
    requestedModel &&
    (args.strongestPoolReferenceMatch === "weak" || args.strongestPoolReferenceMatch === "none");

  const instructions = [
    "CEREBRO COMERCIAL V1",
    "- responda exatamente o que o cliente pediu antes de puxar qualquer nova pergunta",
    "- use o historico recente como memoria ativa; se cidade, espaco, periodo, modelo, preferencia, objecao, pagamento, visita ou orcamento ja apareceram, aproveite isso na resposta e nao pergunte de novo",
    "- quando o cliente mandar varias mensagens curtas em sequencia, trate o conjunto como uma conversa unica e devolva uma resposta integrada, sem responder cada frase isoladamente",
    "- toda resposta deve ter resposta direta + contexto + proximo passo natural",
    "- faça no maximo uma pergunta principal, e so se ela realmente destravar a venda",
    "- se a ultima resposta da IA ja fez uma pergunta ou listou opcoes, nao repita a mesma estrutura sem motivo novo",
    "- nao fale como chatbot, suporte tecnico, sistema interno ou consulta de banco de dados",
    "- em duvida entre soar vendedor e soar sistema, escolha soar vendedor mantendo sinceridade comercial",
  ];

  if (hasIntegratedCustomerContext) {
    instructions.push(
      "- nesta resposta, una as ultimas mensagens do cliente em uma unica linha de raciocinio e mostre que voce entendeu o conjunto antes de avancar"
    );
  }

  if (vagueGreeting) {
    instructions.push(
      "- a mensagem atual e vaga ou so um cumprimento; responda curto, humano e receptivo, sem forcar venda, sem pedir medida/cidade e sem puxar pagamento, visita ou orcamento"
    );
  }

  if (modelNotWorked) {
    instructions.push(
      `- o cliente citou "${requestedModel}". Nao use frases como "nao encontrei no catalogo", "nao localizei no sistema" ou "nao achei esse modelo". Prefira linguagem de vendedor, como "esse modelo nao trabalhamos hoje", "esse modelo nao temos hoje" ou "esse modelo especifico nao esta disponivel na loja".`
    );
    instructions.push(
      "- depois de explicar isso, nao trave a conversa: ofereca opcao parecida, compare caminho mais compacto/confortavel/economico ou use o espaco ja conhecido para conduzir a proxima recomendacao"
    );
  }

  if (looksLikePriceQuestion(args.lastCustomerMessage)) {
    instructions.push(
      "- se o cliente perguntou preco, responda de forma util sem fugir; se o valor depender de projeto, modelo ou instalacao, explique isso em uma frase simples e continue a venda"
    );
  }

  if (looksLikeDiscountQuestionV2(args.lastCustomerMessage)) {
    instructions.push(
      "- se o cliente trouxe objecao de preco, reconheca o peso do investimento, defenda valor sem discutir, e quando fizer sentido ofereca caminho mais simples ou condicao sujeita a confirmacao"
    );
  }

  if (looksLikePaymentQuestion(args.lastCustomerMessage)) {
    instructions.push(
      "- se a pergunta for sobre Pix, pagamento ou condicao, nao invente chave, desconto, parcelamento ou confirmacao; se faltar configuracao, diga que a loja precisa confirmar a condicao correta"
    );
  }

  if (looksLikeExplicitVisitRequest(args.lastCustomerMessage)) {
    instructions.push(
      "- em pedido de visita, fale como quem vai verificar disponibilidade na agenda; nao prometa agenda pronta e nao pergunte de novo dia/periodo se isso ja estiver no historico"
    );
  }

  if (looksLikeExtendedQuoteRequest(args.lastCustomerMessage)) {
    instructions.push(
      "- em pedido de orcamento, use o contexto ja conhecido para encaminhar a solicitação sem pedir tudo de novo; so peca a informacao critica que realmente estiver faltando"
    );
  }

  if (args.nextBestQuestion) {
    instructions.push(
      `- se ainda faltar um unico dado para avancar, a melhor pergunta e: ${args.nextBestQuestion}`
    );
  } else {
    instructions.push("- se ja houver contexto suficiente, nao invente pergunta so para terminar a mensagem com interrogacao");
  }

  return instructions.join("\n");
}

function buildSalesReplyQualityRules(args: {
  lastCustomerMessage: string;
  lastAiMessage: string | null;
}): string {
  const instructions = [
    "REGRAS DE QUALIDADE DA RESPOSTA",
    "- gere uma unica mensagem final de WhatsApp, clara e pronta para envio",
    "- prefira 1 bloco curto ou 2 paragrafos curtos; nao transforme em texto longo",
    "- nao repita abertura, negativa, fechamento ou pergunta da mensagem anterior da IA",
    "- nao responda como se cada mensagem do cliente fosse isolada quando houver contexto recente suficiente",
    "- nao repita perguntas ja respondidas pelo cliente",
    "- nao use linguagem fria como software, cadastro, sistema, fluxo interno, banco de dados ou catalogo interno",
  ];

  if (args.lastAiMessage) {
    instructions.push(
      "- compare mentalmente com a ultima resposta da IA e evite reciclar a mesma formula, especialmente se ela ja negou um modelo ou ja pediu contexto parecido"
    );
  }

  if (isVagueGreetingOrPing(args.lastCustomerMessage)) {
    instructions.push(
      "- para cumprimento vago, responda curto, tipo 'Oi, posso te ajudar com algo?' ou equivalente natural, sem empurrar venda"
    );
  }

  return instructions.join("\n");
}

function isCustomerLocationPhotoMessage(message: MessageRow): boolean {
  if (normalizeText(message.message_type) !== "image") {
    return false;
  }

  const metadata =
    message.metadata && typeof message.metadata === "object" ? message.metadata : null;

  return normalizeText(asText(metadata?.media_purpose)) === "customer_location_photo";
}

function hasCustomerLocationPhoto(messages: MessageRow[]): boolean {
  return messages.some(isCustomerLocationPhotoMessage);
}

function getLocationPhotoAnalysisText(message: MessageRow): string {
  if (!isCustomerLocationPhotoMessage(message)) {
    return "";
  }

  const metadata =
    message.metadata && typeof message.metadata === "object" ? message.metadata : null;
  const analysis =
    metadata?.location_photo_analysis &&
    typeof metadata.location_photo_analysis === "object"
      ? (metadata.location_photo_analysis as Record<string, unknown>)
      : null;

  if (!analysis) {
    return "";
  }

  const summary = String(analysis.summary || "").trim();
  if (!summary) {
    return "";
  }

  const spaceSizeSignal = normalizeText(asText(analysis.space_size_signal));
  const environmentType = normalizeText(asText(analysis.environment_type));
  const confidence = normalizeText(asText(analysis.confidence));
  const needsMeasurementsConfirmation =
    analysis.needs_measurements_confirmation !== false;
  const safeCommercialHints = Array.isArray(analysis.safe_commercial_hints)
    ? analysis.safe_commercial_hints
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];

  const signalParts: string[] = [];

  if (spaceSizeSignal === "small") {
    signalParts.push("espaco percebido como mais compacto");
  } else if (spaceSizeSignal === "medium") {
    signalParts.push("espaco percebido como intermediario");
  } else if (spaceSizeSignal === "large") {
    signalParts.push("espaco percebido como mais amplo");
  }

  if (environmentType === "outdoor") {
    signalParts.push("ambiente aparenta ser externo");
  } else if (environmentType === "indoor") {
    signalParts.push("ambiente aparenta ser interno");
  } else if (environmentType === "mixed") {
    signalParts.push("ambiente com sinais mistos");
  }

  if (confidence === "low") {
    signalParts.push("leitura visual com baixa confianca");
  } else if (confidence === "medium") {
    signalParts.push("leitura visual com confianca moderada");
  }

  const parts = [
    "Cliente enviou uma foto do local.",
    `Analise visual segura: ${summary}.`,
  ];

  if (signalParts.length > 0) {
    parts.push(`Sinais visuais: ${signalParts.join("; ")}.`);
  }

  if (safeCommercialHints.length > 0) {
    parts.push(`Pistas comerciais seguras: ${safeCommercialHints.join("; ")}.`);
  }

  if (needsMeasurementsConfirmation) {
    parts.push("As medidas precisam ser confirmadas antes de qualquer recomendacao conclusiva.");
  }

  return parts.join(" ");
}

function getEffectiveMessageContent(message: MessageRow): string {
  const metadata =
    message.metadata && typeof message.metadata === "object" ? message.metadata : null;
  const messageType = normalizeText(message.message_type);
  const audioTranscript = String(metadata?.audio_transcript || "").trim();

  if (messageType === "audio" && audioTranscript) {
    return audioTranscript;
  }

  const locationPhotoAnalysisText = getLocationPhotoAnalysisText(message);
  if (locationPhotoAnalysisText) {
    return locationPhotoAnalysisText;
  }

  return String(message.content || "").trim();
}

function buildCustomerMediaContextBlock(messages: MessageRow[]): string {
  const hasCustomerLocationPhotoInConversation = hasCustomerLocationPhoto(messages);

  if (!hasCustomerLocationPhotoInConversation) {
    return "";
  }

  const latestLocationPhotoAnalysisText =
    [...messages]
      .reverse()
      .map((message) => getLocationPhotoAnalysisText(message))
      .find((value) => value.length > 0) || "";

  if (latestLocationPhotoAnalysisText) {
    return [
      "CONTEXTO MULTIMODAL SEGURO",
      "- o cliente ja enviou uma foto do local",
      `- analise visual interna disponivel: ${latestLocationPhotoAnalysisText}`,
      "- use essa leitura visual apenas como apoio comercial cauteloso",
      "- voce pode responder com frases como 'pela foto, parece...' ou 'pelo que da para ver...'",
      "- nao afirme que cabe com certeza, nao invente medidas exatas e nao trate instalacao como garantida",
      "- nao prometa simulacao visual, previa visual ou que vai mostrar como vai ficar",
      "- se precisar de confirmacao, peca largura, comprimento, profundidade desejada e informacoes objetivas do espaco",
    ].join("\n");
  }

  return [
    "CONTEXTO MULTIMODAL SEGURO",
    "- o cliente ja enviou uma foto do local",
    "- use isso apenas como sinal de contexto comercial: a foto pode ajudar a entender melhor o espaco e orientar perguntas ou recomendacoes",
    "- nao diga que analisou detalhes visuais da imagem",
    "- nao prometa montagem, simulacao visual, previa visual ou que vai mostrar como vai ficar",
    "- nao invente acabamento, deck, piso, paisagismo, iluminacao, obra externa ou servicos de entorno",
    "- nao afirme medidas, inclinacao, estrutura, drenagem ou detalhes tecnicos visuais que nao foram validados",
    "- nao diga que vai mandar imagem ao cliente",
    "- se precisar de mais precisao, peca dados objetivos como medida aproximada, cidade/regiao, tipo de espaco e uso desejado",
  ].join("\n");
}

function buildResponsePriorityBlock(args: {
  pattern: ConversationPattern;
  paymentOrClosingSubtype?: PaymentOrClosingSubtype;
  photoOrSimulationSubtype?: PhotoOrSimulationSubtype | null;
  facts: ConversationFactState;
  intents: DetectedIntent[];
  responseMode: ResponseMode;
  explicitCatalogRequest: boolean;
  lastAiListedPools: boolean;
  lastCustomerMessage: string;
  hasCatalogEvidence: boolean;
  hasPoolEvidence: boolean;
  shouldPresentPoolRecommendations: boolean;
  hasConfiguredPixKey?: boolean;
  hasConfiguredDownPaymentRule?: boolean;
  offersTechnicalVisit?: boolean;
  recommendationPolicy: RecommendationPolicy;
  requestedPoolReference: RequestedPoolReference | null;
  strongestPoolReferenceMatch: PoolReferenceMatchStrength;
  bestNamedPoolMatch: MatchedPool | null;
}) {
  const instructions: string[] = [];
  const bestNamedPoolBasePrice = formatCurrencyFromReais(args.bestNamedPoolMatch?.pool.price || null);
  const bestNamedPoolPriceRange = extractPriceRangeFromText(args.bestNamedPoolMatch?.pool.description);
  const suggestVisitAdvance = shouldSuggestVisitAdvance({
    facts: args.facts,
    intents: args.intents,
    pattern: args.pattern,
    lastCustomerMessage: args.lastCustomerMessage,
    offersTechnicalVisit: Boolean(args.offersTechnicalVisit),
    lastAiListedPools: args.lastAiListedPools,
  });

  if (args.pattern === "generic_pool_opening") {
    instructions.push(
      "- PADRÃO DOMINANTE: abertura genérica de piscina. Não liste catálogo agora. Pergunte de forma natural se o cliente já tem modelo em mente e peça o espaço disponível."
    );
  }

  if (args.pattern === "pool_size_discovery") {
    instructions.push(
      "- PADRÃO DOMINANTE: cliente já informou espaço/medida. Interprete o espaço, afunile por praticidade, encaixe, manutenção e conforto. Não volte para pergunta ampla de uso, motivo, filhos, família, lazer ou outro motivo."
    );
    instructions.push(
      "- Nesta etapa, faça no máximo uma pergunta prática e fechada. A pergunta preferida é sobre algo mais simples de manter versus uma opção com mais conforto."
    );
  }
  if (args.pattern === "pool_children_context") {
    instructions.push(
      "- PADRAO DOMINANTE: contexto de filhos/criancas. Priorize seguranca, praticidade, supervisao e manutencao simples. Nao puxe luxo, spa, hidromassagem, conforto premium ou recursos extras cedo."
    );
    instructions.push(
      "- Se ja houver espaco informado, diga que faz sentido olhar modelos compactos, seguros e simples de cuidar. Se precisar perguntar algo, prefira profundidade ou seguranca, e nao conforto ou recurso extra."
    );
  }

  if (args.pattern === "discount_question") {
    instructions.push(
      "- PADRAO DOMINANTE: desconto, menor valor, Pix melhor, promocao ou objecao de preco. Responda de forma comercial, proteja margem e venda valor antes de reduzir preco."
    );
    instructions.push(
      hasExplicitPaymentConditionSignal(args.lastCustomerMessage)
        ? "- Como o cliente trouxe pagamento junto, trate a condicao como dependente de modelo, projeto e forma de pagamento. Nunca revele desconto maximo nem aceite proposta automaticamente."
        : "- Em objecao de orcamento pura, resolva primeiro com produto mais acessivel, comparacao util ou prioridade do cliente. Nao puxe forma de pagamento como saida generica."
    );
    if (
      args.intents.includes("price") &&
      args.requestedPoolReference &&
      (args.strongestPoolReferenceMatch === "exact" || args.strongestPoolReferenceMatch === "strong") &&
      hasTrustedPoolPrice(args.bestNamedPoolMatch)
    ) {
      instructions.push(
        "- Como esta mensagem mistura preco com desconto ou Pix, responda primeiro o preco do modelo encontrado e so depois trate a condicao comercial."
      );
    }
    if (suggestVisitAdvance && !hasExplicitPaymentConditionSignal(args.lastCustomerMessage)) {
      instructions.push(
        "- Se a loja fizer visita tecnica e ja houver espaco + instalacao/interesse suficiente, a visita pode ser o proximo passo natural para confirmar acesso, medidas e instalacao, sem prometer agendamento concluido."
      );
    }
  }

  if (args.pattern === "pause_or_disinterest") {
    instructions.push(
      "- PADRAO DOMINANTE: pausa, pedido de tempo, pesquisa fria, retorno futuro ou desinteresse. Responda curto, humano e sem pressao. Se pediu para parar, encerre. Se pediu retorno em data futura, reconheca o prazo sem prometer automacao inexistente."
    );
    if (args.lastCustomerMessage && isHardStopMessage(args.lastCustomerMessage)) {
      instructions.push(
        "- O cliente pediu para parar contato. Pare imediatamente, agradeca o aviso e nao deixe gancho comercial insistente."
      );
    }
  }

  if (args.pattern === "payment_or_closing_flow") {
    instructions.push(
      "- PADRAO DOMINANTE: pagamento, Pix, comprovante, reserva, contrato ou fechamento. Oriente com base nas configuracoes vivas da loja e conduza o proximo passo, mas nunca confirme pagamento, comprovante, reserva, contrato ou venda sem validacao real."
    );
    if (args.paymentOrClosingSubtype === "payment_submitted" || args.paymentOrClosingSubtype === "receipt_submitted") {
      instructions.push(
        "- O cliente disse que pagou ou enviou comprovante. Agradeca e diga que voce vai pedir a conferencia do responsavel. Nao trate isso como validado."
      );
    } else if (args.paymentOrClosingSubtype === "pix_key_request") {
      instructions.push(
        args.hasConfiguredPixKey
          ? "- O cliente pediu o Pix. So diga que pode passar a chave se a chave real estiver no contexto ou configuracao viva."
          : "- O cliente pediu o Pix. Mesmo que Pix seja aceito, nao diga que pode passar a chave agora quando ela nao estiver configurada. Diga que a chave certa precisa ser confirmada antes de passar."
      );
    } else if (args.paymentOrClosingSubtype === "down_payment_or_entry") {
      instructions.push(
        args.hasConfiguredDownPaymentRule
          ? "- Se houver regra explicita de entrada ou sinal na configuracao, use com cautela e sem extrapolar o que esta definido."
          : "- O cliente perguntou sobre entrada ou sinal. Nao responda 'pode sim' sem base. Trate essa condicao como algo que precisa de confirmacao interna conforme modelo, projeto e forma de pagamento."
      );
    } else if (args.paymentOrClosingSubtype === "reservation_or_hold") {
      instructions.push(
        "- Se o cliente pedir reserva ou separacao, trate como encaminhamento e validacao de proximo passo; nao afirme reserva concluida."
      );
    } else if (args.paymentOrClosingSubtype === "contract_request") {
      instructions.push(
        "- Se o cliente pedir contrato, diga que esse passo pode ser preparado ou encaminhado pela loja, sem falar como se a IA emitisse ou assinasse."
      );
    } else if (args.paymentOrClosingSubtype === "closing_or_buying") {
      instructions.push(
        "- O cliente demonstrou intencao forte de compra. Conduza para o proximo passo comercial real, sem declarar venda fechada antes da validacao."
      );
    }
  }

  if (args.intents.includes("technical_visit")) {
    instructions.push(
      "- Se o cliente pedir visita, trate como verificacao ou encaminhamento. Nao escreva que ja agendou, confirmou horario ou marcou a visita antes de existir acao real."
    );
  }

  if (args.pattern === "photo_or_simulation_request") {
    if (args.photoOrSimulationSubtype === "simulation_visual_request") {
      instructions.push(
        "- PADRÃO DOMINANTE: pedido de simulação, montagem, render ou visualização. Diga com naturalidade que foto e medidas ajudam bastante a orientar melhor, mas não prometa uma montagem visual pronta neste momento."
      );
    } else if (args.photoOrSimulationSubtype === "product_photo_without_model") {
      instructions.push(
        "- PADRÃO DOMINANTE: pedido de foto de produto sem modelo claro. Antes de citar qualquer piscina, pergunte qual modelo o cliente quer ver. Não escolha modelo por conta própria."
      );
    } else if (args.photoOrSimulationSubtype === "product_photo_specific") {
      instructions.push(
        "- PADRÃO DOMINANTE: pedido de foto de um modelo específico. Responda sobre a foto cadastrada desse modelo e não troque para outra piscina aleatoriamente."
      );
      instructions.push(
        "- Quando a pergunta for so sobre foto de um modelo especifico, confirme primeiro se ha ou nao foto cadastrada desse modelo. Nao transforme disponibilidade, estoque ou vendabilidade na resposta principal."
      );
    } else {
      instructions.push(
        "- PADRÃO DOMINANTE: foto do local, dúvida de encaixe ou pedido de simulação. Trate a foto como apoio comercial para orientar melhor por espaço, acesso e encaixe."
      );
      instructions.push(
        "- Peça medida junto com a foto quando isso ajudar. Não abra catálogo cedo demais se ainda faltar noção de espaço."
      );
      instructions.push(
        "- Não prometa simulação, montagem visual, render, foto editada ou visualização pronta. Não finja análise visual real da imagem."
      );
    }
  }

  if (args.pattern === "specific_model_or_ad_request") {
    instructions.push(
      "- PADRÃO DOMINANTE: modelo específico ou anúncio. Responda a referência específica primeiro e não trate o cliente como lead genérico."
    );
    if (
      args.intents.includes("price") &&
      (args.strongestPoolReferenceMatch === "exact" || args.strongestPoolReferenceMatch === "strong") &&
      hasTrustedPoolPrice(args.bestNamedPoolMatch)
    ) {
      instructions.push(
        `- O cliente perguntou preço de um modelo específico encontrado no catálogo. Responda o preço primeiro. Use como base ${bestNamedPoolBasePrice || "o valor cadastrado"}${bestNamedPoolPriceRange ? ` e mencione também a faixa ${bestNamedPoolPriceRange}` : ""} antes de fazer qualquer pergunta.`
      );
      instructions.push(
        "- Não fuja do preço com 'depende' se já existe valor confiável no catálogo. Se precisar conduzir, faça isso só depois, com uma pergunta curta sobre instalação ou itens do pedido."
      );
    }
    if (
      args.requestedPoolReference &&
      args.recommendationPolicy.requireExactOrStrongMatchForNamedPool &&
      (args.strongestPoolReferenceMatch === "weak" || args.strongestPoolReferenceMatch === "none")
    ) {
      instructions.push(
        `- O nome "${args.requestedPoolReference.raw}" não teve match exato ou forte no catálogo. Não diga que ele é ${args.bestNamedPoolMatch?.pool.name || "outro modelo do catálogo"}. Responda como vendedora, com linguagem de loja, por exemplo: "esse modelo a gente não trabalha", "esse modelo específico não temos" ou "não trabalhamos com esse modelo, mas tenho opções parecidas". Se existir item próximo, trate só como opção parecida e continue a venda usando o contexto já conhecido antes de fazer nova pergunta.`
      );
    }
  }

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
      "- Esta é uma abertura genérica de interesse em piscina. Não liste modelos nem catálogo ainda. Responda com naturalidade e faça só uma pergunta consultiva leve, de preferência puxando espaço/medida ou se o cliente já tem algum modelo em mente."
    );
  }

  if (args.shouldPresentPoolRecommendations) {
    if (args.recommendationPolicy.poolOptionCount === 1) {
      instructions.push(
        "- O cliente já deu base suficiente para recomendação. Nesta resposta, priorize 1 opção principal do catálogo e só abra uma segunda se ela realmente representar um caminho diferente e útil."
      );
    } else if (args.recommendationPolicy.poolOptionCount === 2) {
      instructions.push(
        "- O cliente já confirmou que quer ver modelos/opções de piscina. Nesta resposta, trabalhe com no máximo 2 modelos concretos do catálogo, com motivo curto para cada um."
      );
    } else {
      instructions.push(
        "- O cliente já confirmou que quer ver modelos/opções de piscina. Nesta resposta, até 3 modelos são aceitáveis porque houve pedido claro de variedade/comparação."
      );
    }
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
      args.recommendationPolicy.poolOptionCount <= 1
        ? "- Se já houver contexto suficiente de piscina e modelos compatíveis no contexto, abra pela melhor opção principal. Só use segunda alternativa se houver um segundo caminho forte."
        : "- Se já houver contexto suficiente de piscina e modelos compatíveis no contexto, recomende direto 1 ou 2 opções concretas pelo nome. Até 3 só quando houver pedido explícito de variedade ou comparação."
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
      "- Para produto de catálogo sem item compatível encontrado, não diga que tem. Responda como vendedora, por exemplo 'esse modelo a gente não trabalha', 'esse modelo específico não temos' ou 'não trabalhamos com esse modelo, mas tenho opções parecidas', sem falar em catálogo atual ou busca técnica."
    );
  }

  if (!args.hasPoolEvidence) {
    instructions.push(
      "- Para piscina específica sem modelo/foto compatível encontrado, não invente. Se faltar o modelo, diga de forma comercial que esse modelo a gente não trabalha e ofereça caminho próximo. Se o problema for só foto, diga apenas que não há foto disponível dele agora."
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
Resposta boa: "Sim, aceitamos cartão. E a visita eu posso verificar pra você. ${args.nextBestQuestion || "Me fala sua cidade ou bairro e um bom dia ou período pra eu te orientar certinho."}"`
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
Resposta boa: "Tenho como verificar sim. Qual modelo de piscina você quer ver a foto?"`
  );

  examples.push(
    `EXEMPLO BOM:
Cliente: "Quero ver modelos com foto"
Resposta boa: "Para esse caso, eu olharia primeiro 2 ou 3 modelos com foto que combinam melhor com o que você quer e explico rapidinho o porquê de cada um."`
  );

  examples.push(
    `EXEMPLO BOM:
Cliente: "Tem a Leblon?"
Resposta boa: "Essa eu não tenho aqui. Mas, com o que você já me falou, dá para olhar opções que façam mais sentido para o seu caso. ${args.nextBestQuestion || "Quer que eu te passe as que fazem mais sentido para o que você quer?"}"`
  );

  examples.push(
    `EXEMPLO BOM:
Cliente: "Tenho 10 metros quadrados e é para meus filhos brincarem. Quero modelos básicos"
Resposta boa: "Com esse espaço, eu olharia primeiro estas opções:
1. [modelo vendável 1] — mais compacto e pode fazer sentido para esse espaço
2. [modelo vendável 2] — opção prática e mais básica para quem quer algo fácil de acompanhar
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
  requestedPoolReference: RequestedPoolReference | null;
  strongestPoolReferenceMatch: PoolReferenceMatchStrength;
  bestNamedPoolMatch: MatchedPool | null;
  recommendationPolicy: RecommendationPolicy;
}): string {
  const requestedBrand = args.analysis.requestedBrand || "nenhuma marca claramente identificada";
  const requestedProduct = args.analysis.requestedProductTerm || "nenhum produto claramente identificado";
  const requestedPoolReference = args.requestedPoolReference?.raw || "nenhum nome/modelo específico identificado";
  const bestNamedPoolMatch = args.bestNamedPoolMatch?.pool.name || "nenhum modelo próximo relevante";
  const bestNamedPoolBasePrice = formatCurrencyFromReais(args.bestNamedPoolMatch?.pool.price || null);
  const bestNamedPoolPriceRange = extractPriceRangeFromText(args.bestNamedPoolMatch?.pool.description);

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
- nome/modelo específico citado: ${requestedPoolReference}
- força do match do nome citado: ${args.strongestPoolReferenceMatch}
- política desta resposta: ${args.recommendationPolicy.reason}
- se o match do nome citado for weak ou none, trate apenas como opção parecida e não como equivalência
- modelo mais próximo para referência, se existir: ${bestNamedPoolMatch}
- preço base do modelo mais próximo, se existir: ${bestNamedPoolBasePrice || "não cadastrado"}
- faixa de preço detectada na descrição, se existir: ${bestNamedPoolPriceRange || "não identificada"}
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

function buildOperationalOnboardingBlock(onboardingMap: Record<string, string>): string {
  const entries = Object.entries(onboardingMap)
    .filter(([, value]) => hasMeaningfulValue(value))
    .slice(0, 40)
    .map(([key, value]) => `- ${key}: ${String(value).trim()}`);

  return entries.length ? entries.join("\n") : "- Sem configuracao operacional relevante registrada.";
}

function buildRawOnboardingSummary(onboardingMap: Record<string, string>): string {
  const entries = Object.entries(onboardingMap)
    .filter(([, value]) => value != null && String(value).trim().length > 0)
    .map(([key, value]) => `- ${key}: ${String(value).trim()}`);

  return entries.length ? entries.join("\n") : "- Sem respostas configuradas no onboarding.";
}

function hasConfiguredPixKey(onboardingMap: Record<string, string>): boolean {
  return Object.entries(onboardingMap).some(([key, value]) => {
    const normalizedKey = normalizeText(key);
    const normalizedValue = normalizeText(value);
    return (
      normalizedValue.length > 0 &&
      ((normalizedKey.includes("pix") && (normalizedKey.includes("key") || normalizedKey.includes("chave"))) ||
        normalizedKey.includes("dados bancarios"))
    );
  });
}

function hasConfiguredDownPaymentRule(onboardingMap: Record<string, string>): boolean {
  return Object.entries(onboardingMap).some(([key, value]) => {
    const normalizedKey = normalizeText(key);
    const normalizedValue = normalizeText(value);
    return (
      normalizedValue.length > 0 &&
      (normalizedKey.includes("entrada") || normalizedKey.includes("sinal") || normalizedKey.includes("down_payment"))
    );
  });
}

function buildInstructions(args: {
  conversationPattern: ConversationPattern;
  paymentOrClosingSubtype?: PaymentOrClosingSubtype;
  photoOrSimulationSubtype?: PhotoOrSimulationSubtype | null;
  storeDisplayName: string | null;
  storeName: string | null;
  leadName: string | null;
  leadState: string | null;
  onboardingMap: Record<string, string>;
  recentHistory: string;
  customerMediaContextBlock: string;
  productPhotoRequestContextBlock: string;
  hasCustomerLocationPhoto: boolean;
  availablePoolsText: string;
  lastCustomerMessage: string;
  behaviorInstructionBlock: string;
  salesMethodologyInstructionBlock: string;
  salesBrainPromptBlock: string;
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
  recommendationPolicy: RecommendationPolicy;
  requestedPoolReference: RequestedPoolReference | null;
  strongestPoolReferenceMatch: PoolReferenceMatchStrength;
  bestNamedPoolMatch: MatchedPool | null;
}) {
  const storeLabel = args.storeDisplayName || args.storeName || "a loja";
  const leadLabel = args.leadName || "cliente";
  const operationalBlock = buildOperationalOnboardingBlock(args.onboardingMap);
  const rawOnboardingSummary = buildRawOnboardingSummary(args.onboardingMap);
  const hasPixKey = hasConfiguredPixKey(args.onboardingMap);
  const hasDownPaymentRule = hasConfiguredDownPaymentRule(args.onboardingMap);
  const hasTechnicalVisit = hasConfiguredTechnicalVisit(args.onboardingMap);

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
- follow-up proativo real, cadência automática, agendamento de retomada e cancelamento automático ainda dependem de Configurações/CRM/worker; não fale como se isso já estivesse conectado aqui
- se o cliente pedir para chamar amanhã, semana que vem ou mês que vem, reconheça o prazo, mas não diga que um agendamento automático já foi criado se isso não aconteceu de fato
- quando a conversa entrar em pagamento, Pix, comprovante, reserva, contrato, sinal/entrada ou fechamento, trate a configuração viva da loja como fonte soberana
- se a forma de pagamento, chave Pix, parcelamento, entrada, sinal ou regra de contrato não estiver clara nas configurações, não invente
- Pix aceito não significa chave Pix disponível; só diga que pode passar a chave se ela existir de forma real no contexto/configuração
- se não houver chave Pix configurada, diga que o Pix é aceito quando isso estiver configurado, mas que a chave certa precisa ser confirmada pela loja ou responsável
- entrada ou sinal só podem ser afirmados quando houver configuração explícita; sem isso, trate como condição a confirmar internamente antes de responder
- se o cliente disser que já pagou, fez o Pix ou mandou comprovante, agradeça e diga que a conferência será feita pela loja ou responsável; não confirme pagamento
- se o cliente pedir reserva, separação ou para segurar produto, trate isso como encaminhamento e próximo passo dependente de validação real; não afirme reserva concluída
- se o cliente pedir contrato, diga que a loja pode preparar ou encaminhar esse fluxo quando necessário, mas a IA não emite, não assina e não conclui contrato sozinha
- se o cliente disser que quer fechar ou comprar, conduza com postura comercial e segura para o próximo passo real, sem declarar venda concluída antes da confirmação
- trate desconto máximo/percentual máximo como limite interno de negociação, não como oferta inicial para o cliente
- nunca revele automaticamente o percentual máximo de desconto configurado, como "até 18%", "até X%" ou equivalente, a menos que a configuração diga explicitamente para divulgar esse número ao cliente
- se o cliente perguntar sobre desconto, responda de forma comercial e protegendo margem: diga que a loja consegue avaliar desconto conforme produto, projeto, forma de pagamento ou condição configurada
- ao falar de desconto, venda valor antes de reduzir preço: destaque orientação, produto, instalação, qualidade, segurança, garantia, atendimento ou outro diferencial configurado antes de negociar abatimento
- só aproxime ou ofereça percentual específico quando isso estiver claramente autorizado nas regras de desconto, política comercial ou por aprovação humana
- se faltar base para cravar algo, responda com cautela comercial em vez de inventar certeza
- se houver regra clara de escalonamento humano, respeite
- não prometa enviar mídia, PDF, catálogo ou fotos como se a entrega já estivesse acontecendo
- cite modelos concretos quando fizer sentido e quando houver pedido explícito atual, continuidade afirmativa clara ou contexto suficiente com catálogo compatível
- quando o cliente já aceitou ver modelos ou pediu opções, não peça permissão de novo: use o catálogo e siga a política desta resposta para apresentar 1, 2 ou até 3 recomendações reais com nome e motivo curto
- se houver contexto suficiente como espaço, contexto infantil já explícito, básico/premium ou instalação, use esse contexto para justificar a recomendação sem reabrir pergunta ampla de motivação
- quando faltar o modelo específico pedido pelo cliente, use o melhor contexto já conhecido da conversa antes de perguntar algo novo: espaço, medida, orçamento, cidade, instalação, preferência por preço, conforto ou perfil de uso
- não repita pergunta que o cliente já respondeu só porque o modelo citado não existe
- quando houver modelos compatíveis no contexto e o cliente pedir ou aceitar opções, prefira 1 opção principal quando o contexto estiver claro; use 2 se houver dois caminhos fortes; use até 3 apenas quando houver pedido explícito de variedade ou comparação
- quando houver modelos vendáveis compatíveis, eles devem ser a recomendação principal da resposta
- modelos sem disponibilidade vendável nunca devem entrar como opção principal se existirem modelos vendáveis compatíveis
- modelos sem disponibilidade vendável podem aparecer apenas como referência secundária, com linguagem comercial cuidadosa e sem tratar como produto pronto para venda
- se só houver referências sem disponibilidade confirmada, deixe claro que elas servem como referência de perfil e que a disponibilidade ainda precisa ser confirmada antes de fechar
- quando já tiver apresentado modelos antes, use novas mensagens do cliente para afunilar a recomendação; não repita a mesma lista, destaque a melhor opção ou as 2 melhores e explique o motivo
- quando houver opções úteis no catálogo, abra pela recomendação mais útil e só depois mencione limitação específica, se isso ainda for necessário para responder com honestidade
- evite abrir com "não temos", "não há estoque confirmado" ou "não consegui localizar" quando ainda existir orientação útil, alternativa vendável ou referência relevante para apresentar primeiro
- se o cliente citar um modelo/anúncio específico, só trate como modelo encontrado quando houver match exato ou forte no catálogo
- se o match do modelo/anúncio específico for weak ou none, diga de forma humana que a loja não tem essa com esse nome e, se existir item próximo, apresente apenas como opção parecida
- se o cliente perguntar preço de um modelo específico com match exato ou forte e houver preço confiável no catálogo, responda o preço primeiro usando o valor base cadastrado e a faixa do cadastro quando existir
- nesse caso, não peça espaço antes de responder o preço; só depois faça uma pergunta curta de avanço, se ela realmente ajudar
- quando o cliente pedir desconto, menor valor, Pix melhor, promoção ou disser que está caro, responda a objeção primeiro, proteja margem e venda valor antes de reduzir preço
- nunca revele desconto máximo, percentual interno, margem da loja ou condição não confirmada
- em objeção de orçamento pura, resolva primeiro com produto mais barato, menor, mais simples, comparação útil ou pergunta de prioridade; não puxe pagamento como saída genérica
- em objeção de orçamento pura, não mencione pagamento, forma de pagamento, condição de pagamento, Pix, parcelamento, entrada, cartão, boleto ou à vista se o cliente não trouxe esse assunto
- nesse cenário, feche com produto, comparação ou próxima pergunta sobre opções, nunca com convite para falar de pagamento
- só trate condição melhor como dependente de modelo, projeto e forma de pagamento quando o cliente realmente trouxer Pix, parcelamento, entrada, cartão, boleto ou outra forma de pagamento, usando as configurações vivas da loja quando existirem
- se a mensagem misturar preço com desconto ou Pix, responda primeiro o preço quando houver base real e só depois trate a condição comercial com segurança
- em recomendações por espaço, não diga cabe no seu espaço, vai caber ou se encaixa; prefira pode fazer sentido para esse espaço, pelo tamanho parece uma boa opção ou pode combinar com esse espaço
- se a loja fizer visita técnica e já houver espaço, interesse em instalação ou necessidade de confirmar acesso/medidas, visita ou avaliação pode ser um próximo passo comercial natural
- nesse caso, trate visita como verificação ou encaminhamento: peça cidade/bairro e melhor dia/período e diga que vai verificar disponibilidade; não diga que já agendou
- se a visita técnica não estiver configurada com clareza, não invente que faz visita; diga que isso precisa de confirmação interna antes de responder
- nunca escreva posso agendar sim, agendei, visita confirmada, horário marcado, já marquei ou ficou agendado sem ação real de agenda
- quando o cliente pedir visita diretamente, prefira posso te ajudar com isso ou posso verificar um horário pra visita
- quando o cliente pedir foto do local, falar de quintal, encaixe ou simulação, trate a foto como apoio comercial e não como análise visual automática
- quando fizer sentido comercial pedir foto do local para orientar melhor a recomendação, prefira uma frase natural como: "Você tem uma foto do lugar? Com a foto dá pra entender melhor o espaço e me ajuda a te sugerir piscinas melhores"
- peça medida junto com a foto quando isso ajudar a orientar melhor
- não diga que analisou a imagem, que viu o quintal pela foto ou que consegue montar/renderizar visualmente se esse recurso não existe no sistema atual
- se o cliente pedir simulação, explique com sinceridade que a foto ajuda a orientar melhor, mas não prometa montagem visual pronta neste momento
- se o cliente pedir simulação ou montagem, você pode responder de forma natural no espírito de: "Com uma foto do espaço dá pra entender melhor o local e indicar modelos que combinam melhor. Me manda uma foto do lugar que eu te ajudo por aqui"
- se o cliente pedir foto de produto sem dizer qual piscina é, pergunte primeiro qual modelo ele quer ver e não liste fotos/modelos aleatórios
- se houver modelo claro no histórico ou na mensagem, responda só sobre a foto desse modelo específico
- se o cliente já enviou foto do local nesta conversa (${args.hasCustomerLocationPhoto ? "sim" : "não"}), não peça outra foto; use a que já existe apenas como apoio comercial e siga pedindo dados objetivos quando faltar precisão

REGRA DOMINANTE DE CENÁRIO DESTA RESPOSTA
- padrão atual: ${args.conversationPattern}
- subtipo de pagamento/fechamento detectado: ${args.paymentOrClosingSubtype || "none"}
- este padrão deve mandar mais que instruções genéricas de descoberta
- se o padrão for pool_size_discovery, não volte para perguntas amplas de uso, motivo, família, lazer, filhos ou outro motivo
- se o padrão for generic_pool_opening, não liste catálogo cedo demais
- se o padrão for specific_model_or_ad_request, responda a referência específica antes de qualquer triagem
- se o padrão for discount_question, responda a objeção comercial primeiro, proteja margem, venda valor antes de desconto e não revele limite interno
- se o padrão for pause_or_disinterest, respeite o momento do cliente, não pressione, não cobre resposta e não prometa follow-up automático inexistente
- se o padrão for payment_or_closing_flow, oriente com base nas configurações vivas da loja e não confirme pagamento, comprovante, reserva, contrato ou venda sem validação real
- se o subtipo for pix_key_request e não houver chave Pix configurada, não diga que pode passar a chave; diga que ela precisa ser confirmada pela loja/responsável
- se o subtipo for down_payment_or_entry e não houver regra explícita de entrada/sinal, não diga "pode sim"; trate como condição a confirmar
- se o padrão for photo_or_simulation_request, trate foto como apoio comercial, peça medida quando fizer sentido e não prometa análise visual real nem simulação pronta
- subtipo de foto/simulação detectado: ${args.photoOrSimulationSubtype || "nenhum"}
- visita tecnica configurada no contexto: ${hasTechnicalVisit ? "sim" : "não"}
- chave Pix configurada no contexto: ${hasPixKey ? "sim" : "não"}
- regra explícita de entrada/sinal no contexto: ${hasDownPaymentRule ? "sim" : "não"}

POLÍTICA DE RECOMENDAÇÃO DESTA RESPOSTA
- pode recomendar agora: ${args.recommendationPolicy.allowRecommendations ? "sim" : "não"}
- quantidade máxima de opções de piscina nesta resposta: ${args.recommendationPolicy.poolOptionCount}
- quantidade máxima de opções de catálogo nesta resposta: ${args.recommendationPolicy.catalogOptionCount}
- motivo da política: ${args.recommendationPolicy.reason}
- só pode afirmar equivalência de modelo específico com match exato/forte: ${args.recommendationPolicy.requireExactOrStrongMatchForNamedPool ? "sim" : "não"}
- se o cliente citou nome/modelo específico: ${args.requestedPoolReference?.raw || "não"}
- força do match do nome citado: ${args.strongestPoolReferenceMatch}
- modelo mais próximo no contexto, se existir: ${args.bestNamedPoolMatch?.pool.name || "nenhum"}
- se o match for weak ou none, não diga que o nome citado é o mesmo item do catálogo; trate no máximo como opção parecida

REGRAS ESPECÍFICAS DE DESCONTO E NEGOCIAÇÃO
- Desconto máximo, percentual máximo ou limite interno são informações de bastidor comercial; use para não ultrapassar limite, não para abrir a negociação.
- Não responda "trabalhamos até X%" só porque existe um limite máximo configurado.
- Resposta preferida para pergunta genérica sobre desconto: "Conseguimos avaliar desconto dependendo do produto, do projeto e da forma de pagamento." Adapte com a explicação simples que estiver nas configurações.
- Se houver explicação de desconto nas configurações, use essa explicação em linguagem simples, sem revelar limite máximo se ele não estiver autorizado para divulgação.
- Se o cliente pressionar por desconto antes de escolher produto/projeto, conduza para entender o caso antes de abrir margem.
- Se desconto depender de aprovação humana, diga que dá para avaliar e que casos especiais podem precisar de confirmação da loja.
- A postura comercial é vender bem e proteger margem: não entregue o maior desconto possível logo no começo.

REGRAS ESPECÍFICAS DE SINCERIDADE
- Se o cliente pedir um produto específico e ele não aparecer entre os itens compatíveis, diga isso de forma humana, sem falar em catálogo atual, match ou busca técnica.
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

${args.customerMediaContextBlock ? `${args.customerMediaContextBlock}\n\n` : ""}CEREBRO COMERCIAL DO TURNO
${args.salesBrainPromptBlock}

${args.productPhotoRequestContextBlock ? `\n\n${args.productPhotoRequestContextBlock}` : ""}

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
- quantidade máxima de modelos de piscina agora: ${args.recommendationPolicy.poolOptionCount}
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
    .filter((msg) => getEffectiveMessageContent(msg).length > 0)
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

      return `${label}: ${getEffectiveMessageContent(msg)}`;
    })
    .join("\n");
}

function detectLastAiMessage(orderedMessages: MessageRow[]): string | null {
  const lastAiMessage =
    [...orderedMessages]
      .reverse()
      .find((msg) => {
        const sender = normalizeText(msg.sender);
        const direction = normalizeText(msg.direction);

        return (
          getEffectiveMessageContent(msg).length > 0 &&
          (sender.includes("ai") ||
            sender.includes("assistant") ||
            sender.includes("bot") ||
            direction === "outgoing")
        );
      }) || null;

  return lastAiMessage ? getEffectiveMessageContent(lastAiMessage) : null;
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
  cleaned = cleaned.replace(/\bm²\b/gi, "metros quadrados");

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
    .filter((msg) => getEffectiveMessageContent(msg).length > 0)
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
        content: getEffectiveMessageContent(msg),
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
      .select("id, sender, content, direction, message_type, media_url, metadata, created_at")
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
    const alreadyHasCustomerLocationPhoto = hasCustomerLocationPhoto(orderedMessages);
    const customerMediaContextBlock = buildCustomerMediaContextBlock(orderedMessages);

    const lastCustomerMessageRow =
      [...orderedMessages]
        .reverse()
        .find(
          (msg) =>
            normalizeText(msg.sender) === "user" &&
            normalizeText(msg.direction) === "incoming" &&
            getEffectiveMessageContent(msg).length > 0
        ) || null;
    const lastCustomerMessage = lastCustomerMessageRow
      ? getEffectiveMessageContent(lastCustomerMessageRow)
      : "";

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
    const requestedPoolReference = extractRequestedPoolReference(lastCustomerMessage);
    const customerConversationText = buildCustomerConversationText(orderedMessages, lastCustomerMessage);
    const photoOrSimulationSubtype = looksLikePhotoOrSimulationRequest(lastCustomerMessage)
      ? detectPhotoOrSimulationSubtype({
          lastCustomerMessage,
          customerConversationText,
        })
      : null;
    const conversationFacts = collectConversationFacts(orderedMessages);
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
      (explicitCatalogRequest && photoOrSimulationSubtype !== "product_photo_without_model") ||
      (looksLikeComparisonQuestion(customerConversationText) && !lastAiListedPools) ||
      (catalogIntent.asksAboutPool &&
        !genericPoolOpening &&
        photoOrSimulationSubtype !== "product_photo_without_model" &&
        photoOrSimulationSubtype !== "local_photo_context" &&
        photoOrSimulationSubtype !== "simulation_visual_request") ||
      shouldPresentPoolRecommendations ||
      (recentPoolContext && affirmativeContinuation) ||
      photoOrSimulationSubtype === "product_photo_specific" ||
      photoOrSimulationSubtype === "general_photo_request";

    let availablePoolsText = "Nenhuma opção de piscina carregada no contexto.";
    let poolCountUsed = 0;
    let matchedPools: MatchedPool[] = [];
    let unavailableMatchedPools: MatchedPool[] = [];
    let scoredPools: MatchedPool[] = [];
    let strongestPoolReferenceMatch: PoolReferenceMatchStrength = "none";
    let bestNamedPoolMatch: MatchedPool | null = null;

    let pools: PoolRow[] = [];
    if (
      shouldLoadPools ||
      ((catalogIntent.asksForPhoto || catalogIntent.asksAboutPool) &&
        photoOrSimulationSubtype !== "product_photo_without_model" &&
        photoOrSimulationSubtype !== "local_photo_context" &&
        photoOrSimulationSubtype !== "simulation_visual_request") ||
      shouldPresentPoolRecommendations
    ) {
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
    let poolPhotosByPoolId = new Map<string, PoolPhotoRow[]>();
    if (pools.length > 0) {
      const poolIds = pools.map((pool) => pool.id);

      const { data: poolPhotosData, error: poolPhotosError } = await supabase
        .from("pool_photos")
        .select(
          "id, pool_id, organization_id, store_id, storage_path, file_name, file_size_bytes, sort_order"
        )
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
        const currentRows = poolPhotosByPoolId.get(row.pool_id) || [];
        currentRows.push(row);
        poolPhotosByPoolId.set(row.pool_id, currentRows);
      }
    }

    if (pools.length > 0) {
      scoredPools = pools
        .map((pool) => ({
          pool,
          hasPhoto: (poolPhotoMap.get(pool.id) || 0) > 0 || !!pool.photo_url,
          score: scorePool(pool, customerConversationText),
        }))
        .filter((match) => shouldLoadPools || match.score > 0)
        .sort((a, b) => b.score - a.score);

      if (requestedPoolReference && scoredPools.length > 0) {
        const rankedByReference = scoredPools
          .map((match) => ({
            match,
            strength: classifyPoolReferenceMatch(match.pool, requestedPoolReference),
          }))
          .sort((a, b) => {
            const rank: Record<PoolReferenceMatchStrength, number> = {
              exact: 4,
              strong: 3,
              weak: 2,
              none: 1,
            };
            return rank[b.strength] - rank[a.strength] || b.match.score - a.match.score;
          });

        strongestPoolReferenceMatch = rankedByReference[0]?.strength || "none";
        bestNamedPoolMatch = rankedByReference[0]?.match || null;
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
        score: scoreCatalogItem(item, catalogIntent, requestedPoolReference),
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

    const recommendationPolicy = inferRecommendationPolicy({
      pattern: detectConversationPattern({
        facts: conversationFacts,
        intents: detectIntents(lastCustomerMessage),
        lastCustomerMessage,
        explicitCatalogRequest,
        patienceSignal: analyzeCustomerPatienceSignal(lastCustomerMessage),
        shouldPresentPoolRecommendations,
        lastAiListedPools,
        paymentOrClosingSubtype: detectPaymentOrClosingSubtype(lastCustomerMessage),
      }),
      facts: conversationFacts,
      lastCustomerMessage,
      photoOrSimulationSubtype,
      explicitCatalogRequest,
      shouldPresentPoolRecommendations,
      lastAiListedPools,
      requestedPoolReference,
      strongestPoolReferenceMatch,
    });

    if (scoredPools.length > 0) {
      matchedPools = scoredPools
        .filter((match) =>
          isSellableInventoryState({
            isActive: match.pool.is_active,
            trackStock: match.pool.track_stock,
            stockQuantity: match.pool.stock_quantity,
          }).isSellable
        )
        .slice(0, recommendationPolicy.poolOptionCount);

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
        .slice(0, recommendationPolicy.poolOptionCount);

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
      } else if (usablePools.length > 0 && shouldLoadPools && recommendationPolicy.poolOptionCount > 0) {
        availablePoolsText = usablePools
          .slice(0, recommendationPolicy.poolOptionCount)
          .map((pool) => formatPoolLine(pool, (poolPhotoMap.get(pool.id) || 0) > 0 || !!pool.photo_url))
          .join("\n");
      }
    }

    const photoCandidatePools = scoredPools;

    const productPhotoRequestContext = buildProductPhotoRequestContext({
      lastCustomerMessage,
      photoOrSimulationSubtype,
      catalogIntent,
      requestedPoolReference,
      strongestPoolReferenceMatch,
      bestNamedPoolMatch,
      photoCandidatePools,
      matchedCatalogItems,
      orderedMessages,
    });
    const productPhotoRequestContextBlock = buildProductPhotoRequestContextBlock(
      productPhotoRequestContext
    );
    const catalogPhotoAction = buildCatalogPhotoAction({
      productPhotoRequestContext,
      photoOrSimulationSubtype,
      requestedPoolReference,
      strongestPoolReferenceMatch,
      bestNamedPoolMatch,
      availablePools: photoCandidatePools,
      matchedCatalogItems,
      poolPhotosByPoolId,
      organizationId,
      storeId: resolvedStoreId,
      supabase,
    });

    const commercialObjective = buildCommercialObjective({
      facts: conversationFacts,
      orderedMessages,
      lastCustomerMessage,
      photoOrSimulationSubtype,
      productPhotoRequestContext,
      explicitCatalogRequest,
      lastAiListedPools,
      shouldPresentPoolRecommendations,
      offersTechnicalVisit: hasConfiguredTechnicalVisit(onboardingMap),
      recommendationPolicy,
      requestedPoolReference,
      strongestPoolReferenceMatch,
      bestNamedPoolMatch,
    });

    const commercialObjectiveBlock = buildCommercialObjectiveBlock(commercialObjective);
    const salesBrain = buildSalesResponseBrain({
      customerName: lead.name,
      crmStage: lead.state,
      conversationStatus: conversation.status,
      humanActive: conversation.is_human_active,
      lastCustomerMessage,
      lastAiMessage,
      orderedMessages,
      recommendedModel: matchedPools[0]?.pool?.name || null,
      requestedPoolReferenceRaw: requestedPoolReference?.raw || null,
      strongestPoolReferenceMatch,
      hasConfiguredPixKey: hasConfiguredPixKey(onboardingMap),
      offersTechnicalVisit: hasConfiguredTechnicalVisit(onboardingMap),
      suggestedNextQuestion: commercialObjective.nextBestQuestion,
      acceptedPaymentMethodsSummary:
        onboardingMap.accepted_payment_methods_summary ||
        onboardingMap.accepted_payment_methods ||
        null,
    });

    const catalogEvidenceBlock = buildCatalogEvidenceBlock({
      analysis: catalogIntent,
      matchedCatalogItems,
      matchedPools,
      unavailableCatalogItems: unavailableMatchedCatalogItems,
      unavailablePools: unavailableMatchedPools,
      requestedPoolReference,
      strongestPoolReferenceMatch,
      bestNamedPoolMatch,
      recommendationPolicy,
    });

    const responsePriorityBlock = buildResponsePriorityBlock({
      pattern: commercialObjective.pattern,
      paymentOrClosingSubtype: commercialObjective.paymentOrClosingSubtype,
      photoOrSimulationSubtype,
      facts: conversationFacts,
      intents: commercialObjective.intents,
      responseMode: commercialObjective.responseMode,
      explicitCatalogRequest,
      lastAiListedPools,
      lastCustomerMessage,
      hasCatalogEvidence: matchedCatalogItems.length > 0,
      hasPoolEvidence: matchedPools.length > 0,
      shouldPresentPoolRecommendations,
      hasConfiguredPixKey: hasConfiguredPixKey(onboardingMap),
      hasConfiguredDownPaymentRule: hasConfiguredDownPaymentRule(onboardingMap),
      offersTechnicalVisit: hasConfiguredTechnicalVisit(onboardingMap),
      recommendationPolicy,
      requestedPoolReference,
      strongestPoolReferenceMatch,
      bestNamedPoolMatch,
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
      conversationPattern: commercialObjective.pattern,
      paymentOrClosingSubtype: commercialObjective.paymentOrClosingSubtype,
      photoOrSimulationSubtype,
      storeDisplayName: onboardingMap.store_display_name || null,
      storeName: store.name,
      leadName: lead.name,
      leadState: lead.state,
      onboardingMap,
      recentHistory,
      customerMediaContextBlock,
      productPhotoRequestContextBlock,
      hasCustomerLocationPhoto: alreadyHasCustomerLocationPhoto,
      availablePoolsText,
      lastCustomerMessage,
      behaviorInstructionBlock,
      salesMethodologyInstructionBlock,
      salesBrainPromptBlock: salesBrain.promptBlock,
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
      recommendationPolicy,
      requestedPoolReference,
      strongestPoolReferenceMatch,
      bestNamedPoolMatch,
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
    const commercialHandoff = inferCommercialHandoff({
      lastCustomerMessage,
      customerConversationText,
      lastAiMessage,
      leadName: lead.name,
      leadPhone: lead.phone,
      facts: conversationFacts,
      intents: commercialObjective.intents,
      pattern: commercialObjective.pattern,
      patienceSignal: commercialObjective.patienceSignal,
      offersTechnicalVisit: hasConfiguredTechnicalVisit(onboardingMap),
      lastAiListedPools,
      recommendedModel: matchedPools[0]?.pool?.name || null,
    });
    const operationalFollowUpDecision = inferOperationalFollowUpDecision({
      lastCustomerMessage,
      patienceSignal: commercialObjective.patienceSignal,
    });

    const shouldUseCommercialReplyOverride = Boolean(
      commercialHandoff?.replyOverride &&
        commercialHandoff.shouldCreateTask &&
        !(
          commercialHandoff.taskType === "commercial_visit_request" &&
          salesBrain.snapshot.visitNeedsQualificationBeforeAgenda
        )
    );
    const finalAiText = catalogPhotoAction
      ? `Sim, temos foto da ${catalogPhotoAction.poolName}.`
      : shouldUseCommercialReplyOverride
        ? String(commercialHandoff?.replyOverride || "").trim()
        : aiText;

    if (!finalAiText) {
      return {
        ok: false,
        error: "EMPTY_AI_RESPONSE",
        message: "A OpenAI não retornou texto utilizável.",
      };
    }

    return {
      ok: true,
      aiText: finalAiText,
      usage,
      context: {
        leadName: lead.name,
        lastCustomerMessage,
        storeDisplayName: onboardingMap.store_display_name || store.name,
        poolCountUsed,
        resolvedStoreId,
        requestedStoreId: requestedStoreId || null,
        operationalFollowUpDecision,
        commercialHandoff,
        catalogPhotoAction,
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
