export type SalesResponseBrainMessage = {
  sender: string | null;
  direction: string | null;
  content: string | null;
  created_at?: string | null;
};

export type SalesSituation =
  | "greeting_or_vague"
  | "ad_model_question"
  | "unknown_model"
  | "price_question"
  | "catalog_option_request"
  | "space_provided"
  | "city_or_location_provided"
  | "installation_question"
  | "quote_request"
  | "visit_request"
  | "price_objection"
  | "payment_question"
  | "pix_discount_question"
  | "financing_question"
  | "closing_signal"
  | "multi_message_context"
  | "unsupported_request"
  | "general_sales_conversation";

export type SalesConversationSnapshot = {
  customerName: string | null;
  rawCustomerName: string | null;
  crmStage: string | null;
  conversationStatus: string | null;
  humanActive: boolean;
  lastCustomerMessage: string;
  lastAiMessage: string | null;
  recentCustomerMessages: string[];
  recentAiMessages: string[];
  customerMessagesSinceLastAi: string[];
  shouldAnswerAsSingleCombinedTurn: boolean;
  cityOrRegion: string | null;
  neighborhoodOrAddress: string | null;
  locationType: "casa" | "chacara" | "quintal" | "empresa" | "condominio" | "outro" | "desconhecido";
  spaceText: string | null;
  approximateAreaM2: number | null;
  mentionedModel: string | null;
  recommendedModel: string | null;
  possibleUnknownModel: boolean;
  asksPrice: boolean;
  asksQuote: boolean;
  asksVisit: boolean;
  asksInstallation: boolean;
  asksPix: boolean;
  asksDiscount: boolean;
  asksFinancing: boolean;
  asksPayment: boolean;
  hasPriceObjection: boolean;
  preferredVisitPeriod: string | null;
  customerNameIsGeneric: boolean;
  hasReliableCustomerName: boolean;
  shouldAskCustomerName: boolean;
  hasAskedCustomerNameRecently: boolean;
  hasPoolInterestContext: boolean;
  hasInstallationContext: boolean;
  hasCanonicalVisitLocation: boolean;
  hasMinimumVisitQualification: boolean;
  visitNeedsQualificationBeforeAgenda: boolean;
  lastAiCommercialAngles: string[];
  knownData: string[];
  missingData: string[];
  repeatedQuestionRisk: string[];
};

export type SalesReplyPlan = {
  primarySituation: SalesSituation;
  secondarySituations: SalesSituation[];
  answerGoal:
    | "receive_customer"
    | "answer_direct_question"
    | "prepare_quote_handoff"
    | "prepare_visit_handoff"
    | "handle_price_objection"
    | "guide_next_step"
    | "set_payment_expectation";
  mustAnswer: string[];
  mustUseContext: string[];
  mustNotAskAgain: string[];
  missingCriticalInfo: string[];
  allowedNextStep:
    | "receive_and_wait"
    | "offer_similar_options"
    | "ask_single_missing_info"
    | "prepare_quote_handoff"
    | "prepare_visit_handoff"
    | "answer_and_guide"
    | "handle_objection_with_alternative";
  shouldAskQuestion: boolean;
  questionToAsk: string | null;
  handoffHint: {
    quote: boolean;
    visit: boolean;
  };
  tone:
    | "short_receptive"
    | "expert_salesperson"
    | "consultative_natural"
    | "objective_safe"
    | "empathetic_value_defense";
  forbiddenPhrases: string[];
  requiredPhrasesOrIdeas: string[];
  maxLength: "short" | "medium";
  blockGenericResetQuestion: boolean;
};

export type SalesResponseBrainInput = {
  customerName?: string | null;
  crmStage?: string | null;
  conversationStatus?: string | null;
  humanActive?: boolean | null;
  lastCustomerMessage: string;
  lastAiMessage?: string | null;
  orderedMessages: SalesResponseBrainMessage[];
  recommendedModel?: string | null;
  requestedPoolReferenceRaw?: string | null;
  strongestPoolReferenceMatch?: "exact" | "strong" | "weak" | "none" | null;
  hasConfiguredPixKey?: boolean;
  offersTechnicalVisit?: boolean;
  suggestedNextQuestion?: string | null;
  canonicalVisitLocationState?: "known" | "not_known" | "unproven";
  contextualQualification?: {
    hasCanonicalSnapshot: boolean;
    askNow: boolean;
    targetFactKey: string | null;
    targetGroup: string | null;
    targetStatus:
      | "missing"
      | "conflict"
      | "known"
      | "not_applicable"
      | "unproven";
  } | null;
  acceptedPaymentMethodsSummary?: string | null;
};

export type SalesResponseBrainOutput = {
  snapshot: SalesConversationSnapshot;
  situation: {
    primary: SalesSituation;
    secondary: SalesSituation[];
  };
  plan: SalesReplyPlan;
  promptBlock: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );
}

function isCustomerMessage(message: SalesResponseBrainMessage): boolean {
  return (
    normalizeText(message.sender) === "user" &&
    normalizeText(message.direction) === "incoming" &&
    String(message.content || "").trim().length > 0
  );
}

function isAiMessage(message: SalesResponseBrainMessage): boolean {
  const sender = normalizeText(message.sender);
  const direction = normalizeText(message.direction);

  return (
    String(message.content || "").trim().length > 0 &&
    (sender.includes("ai") ||
      sender.includes("assistant") ||
      sender.includes("bot") ||
      direction === "outgoing")
  );
}

function collectRecentMessages(
  messages: SalesResponseBrainMessage[],
  predicate: (message: SalesResponseBrainMessage) => boolean,
  limit = 4
): string[] {
  return messages
    .filter(predicate)
    .slice(-limit)
    .map((message) => String(message.content || "").trim());
}

function collectCustomerMessagesSinceLastAi(
  messages: SalesResponseBrainMessage[]
): string[] {
  let lastAiIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isAiMessage(messages[index])) {
      lastAiIndex = index;
      break;
    }
  }

  return messages
    .slice(lastAiIndex + 1)
    .filter(isCustomerMessage)
    .map((message) => String(message.content || "").trim());
}

function looksLikeGreetingOrVague(text: string): boolean {
  const normalized = normalizeText(text);

  if (!normalized) return false;

  const exact = new Set([
    "oi",
    "ola",
    "bom dia",
    "boa tarde",
    "boa noite",
    "teste",
    "?",
    "ta ai",
    "preciso falar",
  ]);

  if (exact.has(normalized)) return true;

  return (
    /^o+i+$/.test(normalized) ||
    /^ola+$/.test(normalized) ||
    /^ol+a+$/.test(normalized) ||
    /^ta ai\??$/.test(normalized) ||
    /^tem alguem ai\??$/.test(normalized) ||
    /^[?!. ]+$/.test(normalized)
  );
}

function looksLikePriceQuestion(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    normalized.includes("quanto custa") ||
    normalized.includes("preco") ||
    normalized.includes("valor") ||
    normalized.includes("quanto fica")
  );
}

function looksLikeQuoteRequest(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    normalized.includes("orcamento") ||
    normalized.includes("proposta") ||
    normalized.includes("quanto fica tudo") ||
    normalized.includes("todos os custos")
  );
}

function looksLikeVisitRequest(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    normalized.includes("visita") ||
    normalized.includes("agendar") ||
    normalized.includes("vem medir") ||
    normalized.includes("ver o local") ||
    normalized.includes("avaliar no local")
  );
}

function looksLikeInstallationQuestion(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    normalized.includes("instalacao") ||
    normalized.includes("instalar") ||
    normalized.includes("obra") ||
    normalized.includes("base")
  );
}

function looksLikePaymentQuestion(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    normalized.includes("pix") ||
    normalized.includes("pagamento") ||
    normalized.includes("pagar") ||
    normalized.includes("cartao") ||
    normalized.includes("boleto") ||
    normalized.includes("parcel")
  );
}

function looksLikePixDiscountQuestion(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    normalized.includes("desconto") ||
    normalized.includes("melhora no pix") ||
    normalized.includes("a vista") ||
    normalized.includes("avista") ||
    (normalized.includes("pix") &&
      (normalized.includes("desconto") || normalized.includes("melhor")))
  );
}

function looksLikeFinancingQuestion(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    normalized.includes("financia") ||
    normalized.includes("financiamento") ||
    normalized.includes("parcela")
  );
}

function looksLikePriceObjection(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    normalized.includes("caro") ||
    normalized.includes("muito dinheiro") ||
    normalized.includes("salgado") ||
    normalized.includes("mais barato")
  );
}

function looksLikeClosingSignal(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    normalized.includes("quero fechar") ||
    normalized.includes("vou pagar") ||
    normalized.includes("manda o pix") ||
    normalized.includes("pode cobrar") ||
    normalized.includes("quero comprar")
  );
}

function looksLikeCatalogOptionRequest(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    normalized.includes("quais opcoes") ||
    normalized.includes("quais opções") ||
    normalized.includes("quais modelos") ||
    normalized.includes("opcoes voce tem") ||
    normalized.includes("opções você tem") ||
    normalized.includes("me mostra") ||
    normalized.includes("quero ver")
  );
}

function looksLikeUnsupportedRequest(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    normalized.includes("paisagismo") ||
    normalized.includes("area gourmet") ||
    normalized.includes("área gourmet") ||
    normalized.includes("deck de madeira") ||
    normalized.includes("obra civil completa")
  );
}

function looksLikeAdModelQuestion(text: string, mentionedModel: string | null): boolean {
  const normalized = normalizeText(text);
  return Boolean(
    mentionedModel &&
      (normalized.includes("anuncio") ||
        normalized.includes("anúncio") ||
        normalized.includes("vi a piscina") ||
        normalized.includes("voce tem") ||
        normalized.includes("voces tem"))
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

function extractNeighborhoodOrAddress(text: string): string | null {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const patterns = [
    /(?:bairro)\s+([a-z0-9\u00c0-\u017f\s\-]{2,60})/i,
    /(?:rua|avenida|av\.?|condominio|condomínio)\s+([a-z0-9\u00c0-\u017f\s\-]{2,80})/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const value = String(match?.[1] || "").trim().replace(/[.!?,;:]+$/g, "");
    if (value) return value;
  }

  return null;
}

function detectLocationType(text: string): SalesConversationSnapshot["locationType"] {
  const normalized = normalizeText(text);

  if (normalized.includes("chacara") || normalized.includes("chácara")) return "chacara";
  if (normalized.includes("quintal")) return "quintal";
  if (normalized.includes("condominio") || normalized.includes("condomínio")) return "condominio";
  if (normalized.includes("empresa") || normalized.includes("comercial")) return "empresa";
  if (normalized.includes("casa")) return "casa";
  if (normalized) return "outro";
  return "desconhecido";
}

function extractSpaceText(text: string): string | null {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const patterns = [
    /\b\d{1,2}(?:[.,]\d+)?\s*(?:m|metro|metros)\s*(?:x|por)\s*\d{1,2}(?:[.,]\d+)?\s*(?:m|metro|metros)\b/i,
    /\b\d{1,2}(?:[.,]\d+)?\s*(?:x|por)\s*\d{1,2}(?:[.,]\d+)?\b/i,
    /\b\d{1,3}(?:[.,]\d+)?\s*m[²2]\b/i,
    /\b\d{1,3}(?:[.,]\d+)?\s*metros?\s*quadrados?\b/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const value = String(match?.[0] || "").trim();
    if (value) return value;
  }

  return null;
}

function extractApproximateAreaM2(text: string): number | null {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const areaMatch = raw.match(/\b(\d{1,3}(?:[.,]\d+)?)\s*(?:m[²2]|metros?\s*quadrados?)\b/i);
  if (areaMatch?.[1]) {
    const parsed = Number(String(areaMatch[1]).replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function extractPreferredPeriod(text: string): string | null {
  const normalized = normalizeText(text);

  if (!normalized) return null;
  if (normalized.includes("manha")) return "manha";
  if (normalized.includes("tarde")) return "tarde";
  if (normalized.includes("noite")) return "noite";
  if (normalized.includes("sabado")) return "sabado";
  if (normalized.includes("domingo")) return "domingo";
  if (normalized.includes("fim de semana")) return "fim de semana";

  return null;
}

function extractCustomerPresentedName(text: string): string | null {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const patterns = [
    /(?:meu nome e|me chamo|eu sou|sou o|sou a|pode me chamar de)\s+([a-z\u00c0-\u017f][a-z\u00c0-\u017f\s'-]{1,40})/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const value = String(match?.[1] || "")
      .trim()
      .replace(/[.!?,;:]+$/g, "");
    if (value) return value;
  }

  return null;
}

function isGenericCustomerName(name: string | null | undefined): boolean {
  const normalized = normalizeText(name);
  if (!normalized) return true;

  const compact = normalized.replace(/\s+/g, " ").trim();
  const digitsOnly = compact.replace(/\D/g, "");

  if (!compact || digitsOnly.length >= 8 && digitsOnly === compact.replace(/\s+/g, "")) {
    return true;
  }

  if (/^(nome|lead|cliente|contato)\s*\d*$/.test(compact)) return true;

  const blockedTerms = [
    "teste",
    "teste pilar",
    "fluxo limpo",
    "mensagem vaga",
    "orcamento direto",
    "orçamento direto",
    "cerebro",
    "cerebro comercial",
    "checkpoint",
    "lead",
    "cliente",
  ];

  if (blockedTerms.some((term) => compact === normalizeText(term) || compact.includes(normalizeText(term)))) {
    return true;
  }

  return false;
}

function isReliableCustomerName(name: string | null | undefined): boolean {
  const raw = String(name || "").trim();
  if (raw.length < 2) return false;
  if (isGenericCustomerName(raw)) return false;
  return /[a-z\u00c0-\u017f]/i.test(raw);
}

function hasAskedCustomerNameRecently(messages: string[]): boolean {
  return messages.some((message) => {
    const normalized = normalizeText(message);
    return (
      normalized.includes("qual seu nome") ||
      normalized.includes("qual e seu nome") ||
      normalized.includes("como voce se chama") ||
      normalized.includes("como vc se chama") ||
      normalized.includes("posso saber seu nome") ||
      normalized.includes("me fala seu nome")
    );
  });
}

function detectLastAiCommercialAngles(lastAiMessage: string | null | undefined): string[] {
  const normalized = normalizeText(lastAiMessage);
  if (!normalized) return [];

  return uniqueStrings([
    normalized.includes("compact") ? "compact_models" : null,
    normalized.includes("mais conforto") || normalized.includes("conforto") ? "comfort" : null,
    normalized.includes("mais em conta") || normalized.includes("mais barato") || normalized.includes("custo") ? "cost" : null,
    normalized.includes("instal") ? "installation" : null,
    normalized.includes("visita") ? "visit" : null,
    normalized.includes("orcamento") ? "quote" : null,
    normalized.includes("pix") || normalized.includes("pagamento") ? "payment" : null,
  ]);
}

function extractMentionedModel(text: string, requestedPoolReferenceRaw?: string | null): string | null {
  if (requestedPoolReferenceRaw) return String(requestedPoolReferenceRaw).trim() || null;

  const raw = String(text || "").trim();
  if (!raw) return null;

  const match = raw.match(
    /\b(?:modelo|piscina|anuncio|anúncio)\s+([a-z0-9][a-z0-9\s-]{1,40})/i
  );
  return String(match?.[1] || "").trim() || null;
}

function buildSalesConversationSnapshot(
  input: SalesResponseBrainInput
): SalesConversationSnapshot {
  const conversationText = input.orderedMessages
    .map((message) => String(message.content || "").trim())
    .filter(Boolean)
    .join(" \n ");
  const recentCustomerMessages = collectRecentMessages(input.orderedMessages, isCustomerMessage, 4);
  const recentAiMessages = collectRecentMessages(input.orderedMessages, isAiMessage, 3);
  const customerMessagesSinceLastAi = collectCustomerMessagesSinceLastAi(input.orderedMessages);
  const cityOrRegion = extractLocationSnippet(conversationText);
  const neighborhoodOrAddress = extractNeighborhoodOrAddress(conversationText);
  const spaceText = extractSpaceText(conversationText);
  const approximateAreaM2 = extractApproximateAreaM2(conversationText);
  const mentionedModel = extractMentionedModel(
    conversationText,
    input.requestedPoolReferenceRaw
  );
  const preferredVisitPeriod = extractPreferredPeriod(conversationText);
  const presentedCustomerName = extractCustomerPresentedName(conversationText);
  const rawCustomerName = presentedCustomerName || input.customerName || null;
  const hasReliableCustomerName = isReliableCustomerName(rawCustomerName);
  const customerName = hasReliableCustomerName ? String(rawCustomerName).trim() : null;
  const customerNameIsGeneric = !hasReliableCustomerName && Boolean(String(rawCustomerName || "").trim());
  const askedCustomerNameRecently = hasAskedCustomerNameRecently(recentAiMessages);
  const hasPoolInterestContext = Boolean(
    mentionedModel ||
      input.recommendedModel ||
      looksLikeQuoteRequest(conversationText) ||
      looksLikePriceQuestion(conversationText) ||
      normalizeText(conversationText).includes("piscina")
  );
  const hasInstallationContext = Boolean(
    spaceText ||
      approximateAreaM2 != null ||
      neighborhoodOrAddress ||
      detectLocationType(conversationText) !== "desconhecido"
  );
  const lastAiCommercialAngles = detectLastAiCommercialAngles(input.lastAiMessage);
  const hasCanonicalVisitLocation =
    input.canonicalVisitLocationState === "known";

  const hasMinimumVisitQualification = Boolean(
    hasReliableCustomerName &&
      cityOrRegion &&
      hasPoolInterestContext &&
      hasInstallationContext
  );
  const knownData = uniqueStrings([
    customerName ? `nome=${customerName}` : null,
    cityOrRegion ? `cidade=${cityOrRegion}` : null,
    neighborhoodOrAddress ? `bairro_endereco=${neighborhoodOrAddress}` : null,
    spaceText ? `espaco=${spaceText}` : null,
    approximateAreaM2 != null ? `area_m2=${approximateAreaM2}` : null,
    mentionedModel ? `modelo=${mentionedModel}` : null,
    input.recommendedModel ? `modelo_recomendado=${input.recommendedModel}` : null,
    preferredVisitPeriod ? `periodo=${preferredVisitPeriod}` : null,
  ]);
  const missingData = uniqueStrings([
    !hasReliableCustomerName && looksLikeVisitRequest(input.lastCustomerMessage) ? "nome" : null,
    !cityOrRegion && (looksLikeVisitRequest(input.lastCustomerMessage) || looksLikeQuoteRequest(input.lastCustomerMessage))
      ? "cidade"
      : null,
    !hasPoolInterestContext && looksLikeVisitRequest(input.lastCustomerMessage) ? "tipo_piscina_objetivo" : null,
    !hasInstallationContext && looksLikeVisitRequest(input.lastCustomerMessage) ? "local_instalacao_contexto" : null,
    !spaceText && looksLikeQuoteRequest(input.lastCustomerMessage) ? "espaco_medida" : null,
    !preferredVisitPeriod && looksLikeVisitRequest(input.lastCustomerMessage) ? "dia_periodo" : null,
  ]);
  const repeatedQuestionRisk = uniqueStrings([
    hasReliableCustomerName || askedCustomerNameRecently ? "nome" : null,
    cityOrRegion ? "cidade" : null,
    spaceText || approximateAreaM2 != null ? "espaco" : null,
    preferredVisitPeriod ? "periodo" : null,
    mentionedModel ? "modelo" : null,
    looksLikeQuoteRequest(conversationText) ? "orcamento" : null,
  ]);

  return {
    customerName,
    rawCustomerName,
    crmStage: input.crmStage || null,
    conversationStatus: input.conversationStatus || null,
    humanActive: input.humanActive === true,
    lastCustomerMessage: input.lastCustomerMessage,
    lastAiMessage: input.lastAiMessage || null,
    recentCustomerMessages,
    recentAiMessages,
    customerMessagesSinceLastAi,
    shouldAnswerAsSingleCombinedTurn: customerMessagesSinceLastAi.length >= 2,
    cityOrRegion,
    neighborhoodOrAddress,
    locationType: detectLocationType(conversationText),
    spaceText,
    approximateAreaM2,
    mentionedModel,
    recommendedModel: input.recommendedModel || null,
    possibleUnknownModel: Boolean(
      mentionedModel &&
        (input.strongestPoolReferenceMatch === "weak" ||
          input.strongestPoolReferenceMatch === "none")
    ),
    asksPrice: looksLikePriceQuestion(input.lastCustomerMessage),
    asksQuote: looksLikeQuoteRequest(input.lastCustomerMessage),
    asksVisit: looksLikeVisitRequest(input.lastCustomerMessage),
    asksInstallation: looksLikeInstallationQuestion(input.lastCustomerMessage),
    asksPix: normalizeText(input.lastCustomerMessage).includes("pix"),
    asksDiscount: looksLikePixDiscountQuestion(input.lastCustomerMessage),
    asksFinancing: looksLikeFinancingQuestion(input.lastCustomerMessage),
    asksPayment: looksLikePaymentQuestion(input.lastCustomerMessage),
    hasPriceObjection: looksLikePriceObjection(input.lastCustomerMessage),
    preferredVisitPeriod,
    customerNameIsGeneric,
    hasReliableCustomerName,
    shouldAskCustomerName: !hasReliableCustomerName && !askedCustomerNameRecently,
    hasAskedCustomerNameRecently: askedCustomerNameRecently,
    hasPoolInterestContext,
    hasInstallationContext,
    hasCanonicalVisitLocation,
    hasMinimumVisitQualification,
    visitNeedsQualificationBeforeAgenda:
      looksLikeVisitRequest(input.lastCustomerMessage) &&
      (!input.offersTechnicalVisit || !hasCanonicalVisitLocation),
    lastAiCommercialAngles,
    knownData,
    missingData,
    repeatedQuestionRisk,
  };
}

function classifySalesSituation(
  input: SalesResponseBrainInput,
  snapshot: SalesConversationSnapshot
): { primary: SalesSituation; secondary: SalesSituation[] } {
  const secondary: SalesSituation[] = [];

  if (snapshot.shouldAnswerAsSingleCombinedTurn) secondary.push("multi_message_context");
  if (snapshot.asksPrice) secondary.push("price_question");
  if (snapshot.asksInstallation) secondary.push("installation_question");
  if (snapshot.asksPayment) secondary.push("payment_question");
  if (snapshot.asksFinancing) secondary.push("financing_question");
  if (snapshot.cityOrRegion) secondary.push("city_or_location_provided");
  if (snapshot.spaceText || snapshot.approximateAreaM2 != null) secondary.push("space_provided");

  if (looksLikeGreetingOrVague(input.lastCustomerMessage)) {
    return { primary: "greeting_or_vague", secondary: uniqueStrings(secondary) as SalesSituation[] };
  }

  if (looksLikeUnsupportedRequest(input.lastCustomerMessage)) {
    return { primary: "unsupported_request", secondary: uniqueStrings(secondary) as SalesSituation[] };
  }

  if (snapshot.asksQuote) {
    return { primary: "quote_request", secondary: uniqueStrings(secondary) as SalesSituation[] };
  }

  if (snapshot.asksVisit) {
    return { primary: "visit_request", secondary: uniqueStrings(secondary) as SalesSituation[] };
  }

  if (snapshot.hasPriceObjection) {
    return { primary: "price_objection", secondary: uniqueStrings(secondary) as SalesSituation[] };
  }

  if (snapshot.asksFinancing) {
    return { primary: "financing_question", secondary: uniqueStrings(secondary) as SalesSituation[] };
  }

  if (snapshot.asksDiscount) {
    return { primary: "pix_discount_question", secondary: uniqueStrings(secondary) as SalesSituation[] };
  }

  if (snapshot.asksPayment) {
    return { primary: "payment_question", secondary: uniqueStrings(secondary) as SalesSituation[] };
  }

  if (looksLikeClosingSignal(input.lastCustomerMessage)) {
    return { primary: "closing_signal", secondary: uniqueStrings(secondary) as SalesSituation[] };
  }

  if (snapshot.asksInstallation) {
    return { primary: "installation_question", secondary: uniqueStrings(secondary) as SalesSituation[] };
  }

  if (snapshot.possibleUnknownModel) {
    secondary.push("unknown_model");
    if (looksLikeAdModelQuestion(input.lastCustomerMessage, snapshot.mentionedModel)) {
      return { primary: "ad_model_question", secondary: uniqueStrings(secondary) as SalesSituation[] };
    }
    return { primary: "unknown_model", secondary: uniqueStrings(secondary) as SalesSituation[] };
  }

  if (snapshot.asksPrice) {
    return { primary: "price_question", secondary: uniqueStrings(secondary) as SalesSituation[] };
  }

  if (snapshot.cityOrRegion && normalizeText(input.lastCustomerMessage).includes("moro em")) {
    return { primary: "city_or_location_provided", secondary: uniqueStrings(secondary) as SalesSituation[] };
  }

  if (
    (snapshot.spaceText || snapshot.approximateAreaM2 != null) &&
    (normalizeText(input.lastCustomerMessage).includes("quintal") ||
      /\b\d{1,3}(?:[.,]\d+)?\s*(?:m[²2]|metros?\s*quadrados?)\b/i.test(input.lastCustomerMessage))
  ) {
    return { primary: "space_provided", secondary: uniqueStrings(secondary) as SalesSituation[] };
  }

  if (looksLikeCatalogOptionRequest(input.lastCustomerMessage)) {
    return { primary: "catalog_option_request", secondary: uniqueStrings(secondary) as SalesSituation[] };
  }

  if (snapshot.shouldAnswerAsSingleCombinedTurn) {
    return { primary: "multi_message_context", secondary: uniqueStrings(secondary) as SalesSituation[] };
  }

  return { primary: "general_sales_conversation", secondary: uniqueStrings(secondary) as SalesSituation[] };
}

function buildSalesReplyPlan(args: {
  input: SalesResponseBrainInput;
  snapshot: SalesConversationSnapshot;
  situation: { primary: SalesSituation; secondary: SalesSituation[] };
}): SalesReplyPlan {
  const mustUseContext = [...args.snapshot.knownData];
  const mustNotAskAgain = [...args.snapshot.repeatedQuestionRisk];
  const forbiddenPhrases = [
    "nao encontrei no catalogo",
    "nao achei no sistema",
    "nao localizei",
    "nao tenho esse nome aqui no cadastro",
    "amplo",
  ];

  const basePlan: SalesReplyPlan = {
    primarySituation: args.situation.primary,
    secondarySituations: args.situation.secondary,
    answerGoal: "guide_next_step",
    mustAnswer: ["responder diretamente a pergunta principal do cliente"],
    mustUseContext,
    mustNotAskAgain,
    missingCriticalInfo: [],
    allowedNextStep: "answer_and_guide",
    shouldAskQuestion: false,
    questionToAsk: null,
    handoffHint: {
      quote: false,
      visit: false,
    },
    tone: "consultative_natural",
    forbiddenPhrases,
    requiredPhrasesOrIdeas: [
      "usar contexto real ja informado",
      "responder como vendedora consultiva e natural",
    ],
    maxLength: "medium",
    blockGenericResetQuestion: false,
  };

  switch (args.situation.primary) {
    case "greeting_or_vague":
      return {
        ...basePlan,
        answerGoal: "receive_customer",
        mustAnswer: ["receber o cliente de forma curta e receptiva"],
        mustUseContext: [],
        mustNotAskAgain: [],
        missingCriticalInfo: [],
        allowedNextStep: "receive_and_wait",
        tone: "short_receptive",
        shouldAskQuestion: args.snapshot.shouldAskCustomerName,
        questionToAsk: args.snapshot.shouldAskCustomerName
          ? "Qual seu nome? Me fala como posso te ajudar."
          : null,
        forbiddenPhrases: [
          ...forbiddenPhrases,
          "me fala sua cidade",
          "qual espaco voce tem",
          "quer orcamento",
          "quer visita",
        ],
        requiredPhrasesOrIdeas: [
          "resposta curta",
          "sem forcar venda",
          args.snapshot.shouldAskCustomerName
            ? "se faltar nome confiavel, pedir o nome de forma natural e leve"
            : "se ja houver nome confiavel, usar isso com naturalidade sem perguntar de novo",
        ],
        maxLength: "short",
        blockGenericResetQuestion: false,
      };
    case "unknown_model":
    case "ad_model_question":
      return {
        ...basePlan,
        answerGoal: "answer_direct_question",
        allowedNextStep: "offer_similar_options",
        shouldAskQuestion: Boolean(args.input.suggestedNextQuestion),
        questionToAsk: args.input.suggestedNextQuestion || null,
        tone: "expert_salesperson",
        forbiddenPhrases: [
          ...forbiddenPhrases,
          "nao trabalhamos hoje",
          "nao temos hoje",
          "nao esta disponivel hoje",
        ],
        requiredPhrasesOrIdeas: [
          "dizer que esse modelo a gente nao trabalha ou que esse modelo especifico nao temos",
          "oferecer alternativa util",
          "continuar a venda sem soar como sistema",
        ],
        blockGenericResetQuestion: true,
      };
    case "quote_request": {
      const contextualQualification =
        args.input.contextualQualification || null;

      const canAskStructuredQualification =
        contextualQualification?.hasCanonicalSnapshot === true &&
        contextualQualification.askNow === true &&
        Boolean(
          contextualQualification.targetFactKey ||
            contextualQualification.targetGroup,
        );

      return {
        ...basePlan,
        answerGoal: "prepare_quote_handoff",
        allowedNextStep: "prepare_quote_handoff",
        handoffHint: {
          quote: true,
          visit: false,
        },
        shouldAskQuestion: canAskStructuredQualification,
        questionToAsk: null,
        missingCriticalInfo:
          canAskStructuredQualification &&
          contextualQualification?.targetFactKey
            ? [contextualQualification.targetFactKey]
            : [],
        requiredPhrasesOrIdeas: [
          "usar os dados do orcamento ja conhecidos sem pedir tudo de novo",
          canAskStructuredQualification
            ? "se houver pergunta de qualificacao nesta resposta, formular somente o unico alvo autorizado pela decisao contextual"
            : "nao inventar cidade, espaco, modelo, instalacao ou outro questionario para liberar o orcamento",
          "encaminhar ou preparar o proximo passo do orcamento sem prometer PDF ou envio concluido",
        ],
        forbiddenPhrases: [
          ...forbiddenPhrases,
          "orcamento enviado",
          "ja emiti o orcamento",
          "pdf enviado",
          "qual seu nome e sua cidade",
          "me confirma sua cidade para eu montar isso",
          "me fala o espaco ou a medida",
        ],
        blockGenericResetQuestion: true,
      };
    }    case "visit_request": {
      const contextualQualification =
        args.input.contextualQualification || null;

      const canAskCanonicalLocation =
        Boolean(args.input.offersTechnicalVisit) &&
        contextualQualification?.hasCanonicalSnapshot === true &&
        contextualQualification.targetGroup === "location" &&
        contextualQualification.askNow === true;

      if (args.snapshot.visitNeedsQualificationBeforeAgenda) {
        return {
          ...basePlan,
          answerGoal: "guide_next_step",
          allowedNextStep: canAskCanonicalLocation
            ? "ask_single_missing_info"
            : "answer_and_guide",
          handoffHint: {
            quote: false,
            visit: false,
          },
          shouldAskQuestion: canAskCanonicalLocation,
          questionToAsk: null,
          missingCriticalInfo: canAskCanonicalLocation
            ? ["location_text"]
            : [],
          requiredPhrasesOrIdeas: [
            args.input.offersTechnicalVisit
              ? canAskCanonicalLocation
                ? "se houver pergunta de qualificacao nesta resposta, formular somente o alvo de localizacao autorizado pela decisao contextual"
                : "nao inventar nome, modelo, espaco, cidade ou outro questionario para liberar agenda"
              : "na falta de configuracao clara, nao prometer visita; dizer que precisa confirmar o procedimento correto antes",
            "nao falar em disponibilidade de agenda enquanto a localizacao canonica da oportunidade nao estiver comprovada",
          ],
          forbiddenPhrases: [
            ...forbiddenPhrases,
            "vou verificar na agenda os dias que temos disponiveis",
            "vou ver na agenda quais horarios temos disponiveis",
            "posso agendar",
            "ja esta agendado",
          ],
          blockGenericResetQuestion: true,
        };
      }

      const needsVisitPeriod = !args.snapshot.preferredVisitPeriod;

      return {
        ...basePlan,
        answerGoal: "prepare_visit_handoff",
        allowedNextStep: "prepare_visit_handoff",
        handoffHint: {
          quote: false,
          visit: true,
        },
        shouldAskQuestion: needsVisitPeriod,
        questionToAsk: needsVisitPeriod
          ? "Qual dia ou periodo costuma ser melhor para voce"
          : null,
        missingCriticalInfo: needsVisitPeriod
          ? ["dia_periodo"]
          : [],
        requiredPhrasesOrIdeas: [
          "a localizacao canonica ja esta conhecida; daqui em diante dia ou periodo e um dado operacional de agenda",
          "dizer que vai verificar na agenda os dias ou horarios disponiveis",
          "nao prometer agenda pronta",
          "nao confirmar visita como garantida ou gratuita",
        ],
        forbiddenPhrases: [
          ...forbiddenPhrases,
          "vou verificar com a loja",
          "a loja vai confirmar",
          "posso agendar",
          "ja esta agendado",
        ],
        blockGenericResetQuestion: true,
      };
    }    case "installation_question":
      return {
        ...basePlan,
        answerGoal: "answer_direct_question",
        tone: "objective_safe",
        requiredPhrasesOrIdeas: [
          "explicar instalacao de forma simples e segura",
          "falar de acesso ao local, modelo e condicoes do espaco",
          "dizer que a visita ajuda a confirmar o melhor jeito de instalar com seguranca",
        ],
        forbiddenPhrases: [
          ...forbiddenPhrases,
          "preparo da base",
          "acabamento",
          "paisagismo",
          "obra externa",
          "piso",
          "preparacao do terreno",
        ],
        blockGenericResetQuestion: true,
      };
    case "price_objection":
      return {
        ...basePlan,
        answerGoal: "handle_price_objection",
        allowedNextStep: "handle_objection_with_alternative",
        tone: "empathetic_value_defense",
        requiredPhrasesOrIdeas: [
          "reconhecer a objecao sem discutir",
          "defender valor com sobriedade",
          "oferecer alternativa mais simples, mais em conta ou comparacao de custo-beneficio",
          "nao transformar responsavel ou condicao especial no foco principal da resposta",
        ],
        forbiddenPhrases: [
          ...forbiddenPhrases,
          "confirmacao da loja",
          "sujeito a confirmacao da loja",
          "falo com o responsavel para avaliar alguma condicao especial para o seu caso",
          "vou falar com o responsavel para ver condicao",
          "posso falar com o responsavel",
          "condicao especial para o seu caso",
        ],
        blockGenericResetQuestion: true,
      };
    case "payment_question":
    case "pix_discount_question":
    case "financing_question": {
      const contextualQualification =
        args.input.contextualQualification || null;

      const canAskPaymentQualification =
        contextualQualification?.hasCanonicalSnapshot === true &&
        contextualQualification.askNow === true &&
        contextualQualification.targetGroup === "payment";

      return {
        ...basePlan,
        answerGoal: "set_payment_expectation",
        tone: "objective_safe",
        shouldAskQuestion: canAskPaymentQualification,
        questionToAsk: null,
        missingCriticalInfo:
          canAskPaymentQualification &&
          contextualQualification?.targetFactKey
            ? [contextualQualification.targetFactKey]
            : [],
        requiredPhrasesOrIdeas: [
          args.input.acceptedPaymentMethodsSummary
            ? `apresentar as formas aceitas conhecidas: ${args.input.acceptedPaymentMethodsSummary}`
            : "apresentar as formas aceitas se houver base no contexto",
          "responder primeiro exatamente a duvida de pagamento trazida pelo cliente",
          canAskPaymentQualification
            ? "se houver pergunta de qualificacao nesta resposta, formular somente o alvo de pagamento autorizado pela decisao contextual"
            : "nao inventar nova pergunta sobre Pix, parcelamento ou preferencia de pagamento",
          "nao inventar chave pix, desconto, financiamento ou confirmacao",
          args.input.hasConfiguredPixKey
            ? "se houver base real, responder com seguranca sem extrapolar"
            : "se faltar configuracao, dizer que precisa confirmar a chave ou a condicao correta antes de passar",
        ],
        forbiddenPhrases: [
          ...forbiddenPhrases,
          "a loja vai confirmar",
          "a loja vai te passar",
          "vou verificar com a loja",
        ],
        blockGenericResetQuestion: true,
      };
    }
    case "space_provided":
    case "city_or_location_provided": {
      const avoidCompactAngle = args.snapshot.lastAiCommercialAngles.includes("compact_models");
      return {
        ...basePlan,
        answerGoal: "guide_next_step",
        tone: "consultative_natural",
        requiredPhrasesOrIdeas: [
          "reconhecer o novo contexto informado sem pedir de novo",
          avoidCompactAngle
            ? "nao repetir o mesmo angulo da ultima resposta; avancar por custo, conforto, instalacao, comparacao ou proximo passo"
            : "usar o contexto novo para afunilar a conversa",
          "se falar de espaco grande, prefira espaço grande, quintal grande, bastante espaço, área boa ou espaço confortável",
        ],
        forbiddenPhrases: [
          ...(avoidCompactAngle
            ? [...basePlan.forbiddenPhrases, "modelos mais compactos"]
            : basePlan.forbiddenPhrases),
          "me diz so o principal neste momento",
          "voce quer entender opcoes, preco, instalacao ou a melhor solucao",
          "como posso ajudar",
          "quer que eu te ajude com algo",
        ],
        blockGenericResetQuestion: true,
      };
    }
    case "multi_message_context":
      return {
        ...basePlan,
        answerGoal: "answer_direct_question",
        tone: "consultative_natural",
        requiredPhrasesOrIdeas: [
          "responder juntando as ultimas mensagens do cliente como um unico contexto",
        ],
        blockGenericResetQuestion: true,
      };
    default:
      return basePlan;
  }
}

function buildSalesBrainPromptBlock(output: SalesResponseBrainOutput): string {
  const { snapshot, plan } = output;

  return [
    "CEREBRO COMERCIAL — PLANO DESTE TURNO",
    `- situacao principal: ${plan.primarySituation}`,
    `- situacoes secundarias: ${plan.secondarySituations.length > 0 ? plan.secondarySituations.join(", ") : "nenhuma"}`,
    `- pergunta principal do cliente: ${snapshot.lastCustomerMessage}`,
    `- dados conhecidos: ${snapshot.knownData.length > 0 ? snapshot.knownData.join("; ") : "nenhum dado confiavel relevante"}`,
    `- nome confiavel do cliente: ${snapshot.hasReliableCustomerName ? snapshot.customerName : "nao"}`,
    `- pedir nome agora: ${snapshot.shouldAskCustomerName ? "sim" : "nao"}`,
    `- localizacao canonica permite avancar para agenda: ${snapshot.hasCanonicalVisitLocation ? "sim" : "nao"}`,
    `- nao perguntar novamente: ${plan.mustNotAskAgain.length > 0 ? plan.mustNotAskAgain.join(", ") : "nenhum bloqueio especifico"}`,
    `- objetivo: ${plan.answerGoal}`,
    `- responder diretamente: ${plan.mustAnswer.join("; ")}`,
    `- proximo passo permitido: ${plan.allowedNextStep}`,
    `- deve usar contexto integrado: ${snapshot.shouldAnswerAsSingleCombinedTurn ? "sim" : "nao"}`,
    `- tom: ${plan.tone}`,
    `- tamanho maximo: ${plan.maxLength}`,
    `- frases proibidas: ${plan.forbiddenPhrases.join("; ")}`,
    `- ideias obrigatorias: ${plan.requiredPhrasesOrIdeas.join("; ")}`,
    `- informacoes criticas faltantes: ${plan.missingCriticalInfo.length > 0 ? plan.missingCriticalInfo.join(", ") : "nenhuma obrigatoria agora"}`,
    `- pergunta unica permitida: ${plan.shouldAskQuestion ? plan.questionToAsk || "sim, mas ainda sem texto definido" : "nao obrigatoria"}`,
    `- hint de handoff: quote=${plan.handoffHint.quote ? "sim" : "nao"}; visit=${plan.handoffHint.visit ? "sim" : "nao"}`,
    `- bloquear pergunta generica de reinicio: ${plan.blockGenericResetQuestion ? "sim" : "nao"}`,
    "- travas: nao inventar preco, agenda, pagamento, estoque ou servico nao confirmado; nao soar como sistema",
  ].join("\n");
}

export function buildSalesResponseBrain(
  input: SalesResponseBrainInput
): SalesResponseBrainOutput {
  const snapshot = buildSalesConversationSnapshot(input);
  const situation = classifySalesSituation(input, snapshot);
  const plan = buildSalesReplyPlan({
    input,
    snapshot,
    situation,
  });

  return {
    snapshot,
    situation,
    plan,
    promptBlock: buildSalesBrainPromptBlock({
      snapshot,
      situation,
      plan,
      promptBlock: "",
    }),
  };
}
