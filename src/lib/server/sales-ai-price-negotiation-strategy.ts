import {
  createStoreDiscountSettingsInputFromSources,
  normalizeStoreDiscountSettingsInput,
  type StoreDiscountSettingsRow,
  type StoreHighValueDiscountSettingsRow,
} from "../store-discount-settings";

export type PriorConcessionState = "none" | "present" | "unknown";
export type PriceNegotiationDecisionKind =
  | "full_price"
  | "qualify_before_discount"
  | "defend_value"
  | "first_concession_candidate"
  | "requires_human_or_special_policy"
  | "not_applicable";

export type PriceNegotiationStrategyInput = {
  productIdentified: boolean;
  projectIdentified: boolean;
  reliablePriceCents: number | null;
  messageKind:
    | "opening"
    | "price_question"
    | "discount_question"
    | "price_objection"
    | "conditioned_close"
    | "counteroffer"
    | "payment_condition"
    | "other";
  materialPriceObjection: boolean;
  closeConditionedOnImprovedPrice: boolean;
  paymentContext: "none" | "pix" | "entry" | "installments" | "other";
  priorConcessionState: PriorConcessionState;
  discountSettings: StoreDiscountSettingsRow | null;
  highValueDiscountSettings: StoreHighValueDiscountSettingsRow | null;
};

export type PriceNegotiationStrategyDecision = {
  kind: PriceNegotiationDecisionKind;
  reasonCode: string;
  grounds: string[];
  shouldStartFirstConcession: boolean;
};

function decision(
  kind: PriceNegotiationDecisionKind,
  reasonCode: string,
  grounds: string[],
  shouldStartFirstConcession = false,
): PriceNegotiationStrategyDecision {
  return { kind, reasonCode, grounds, shouldStartFirstConcession };
}

function isHighValue(input: PriceNegotiationStrategyInput) {
  const settings = input.highValueDiscountSettings;
  return (
    settings?.enabled === true &&
    typeof settings.threshold_amount_cents === "number" &&
    input.reliablePriceCents != null &&
    input.reliablePriceCents >= settings.threshold_amount_cents
  );
}

export function decideSalesAiPriceNegotiation(
  input: PriceNegotiationStrategyInput,
): PriceNegotiationStrategyDecision {
  const normalized = normalizeStoreDiscountSettingsInput(
    createStoreDiscountSettingsInputFromSources({
      settings: input.discountSettings,
      highValueSettings: input.highValueDiscountSettings,
    }),
  );
  const hasProductAndPrice =
    input.productIdentified &&
    input.projectIdentified &&
    typeof input.reliablePriceCents === "number" &&
    input.reliablePriceCents > 0;

  if (input.messageKind === "opening") return decision("not_applicable", "OPENING", ["opening_message"]);
  if (input.messageKind === "counteroffer") {
    return decision("requires_human_or_special_policy", "COUNTEROFFER_REQUIRES_LATER_STAGE", [
      "counteroffer_detected",
      "no_new_concession_started",
    ]);
  }
  if (input.priorConcessionState === "present") {
    return decision("requires_human_or_special_policy", "PRIOR_CONCESSION_PRESENT", [
      "prior_concession_present",
      "no_new_concession_started",
    ]);
  }
  if (input.messageKind === "discount_question" && !hasProductAndPrice) {
    return decision("qualify_before_discount", "DISCOUNT_CONTEXT_INCOMPLETE", [
      "product_project_or_price_missing",
    ]);
  }
  if (!normalized.ok) {
    return decision("requires_human_or_special_policy", "DISCOUNT_POLICY_UNCONFIGURED", [
      "discount_settings_missing_or_invalid",
      "fail_closed",
    ]);
  }
  if (
    input.priorConcessionState === "unknown" &&
    input.materialPriceObjection &&
    input.closeConditionedOnImprovedPrice
  ) {
    return decision("requires_human_or_special_policy", "PRIOR_CONCESSION_UNKNOWN", [
      "prior_concession_state_unproven",
      "fail_closed",
    ]);
  }
  if (isHighValue(input)) {
    return decision("requires_human_or_special_policy", "HIGH_VALUE_HUMAN_GATE", [
      "high_value_threshold_reached",
      "human_gate",
    ]);
  }
  if (input.messageKind === "price_question") {
    return hasProductAndPrice
      ? decision("full_price", "RELIABLE_CATALOG_PRICE", ["catalog_price_available"])
      : decision("qualify_before_discount", "PRICE_CONTEXT_INCOMPLETE", ["price_basis_missing"]);
  }
  if (input.messageKind === "payment_condition" && !input.materialPriceObjection) {
    return decision("full_price", "PAYMENT_CONDITION_NOT_DISCOUNT_AUTHORITY", [
      "payment_context_alone_does_not_start_concession",
    ]);
  }
  if (input.messageKind === "discount_question" || input.messageKind === "price_objection") {
    if (!hasProductAndPrice) {
      return decision("qualify_before_discount", "DISCOUNT_CONTEXT_INCOMPLETE", [
        "product_project_or_price_missing",
      ]);
    }
    if (!input.materialPriceObjection && !input.closeConditionedOnImprovedPrice) {
      return decision("full_price", "NO_MATERIAL_TRIGGER", ["no_concession_trigger"]);
    }
    if (input.materialPriceObjection && !input.closeConditionedOnImprovedPrice) {
      return decision("defend_value", "PRICE_OBJECTION_WITHOUT_CONDITIONED_CLOSE", [
        "material_price_objection",
        "no_conditioned_close",
        "no_concession_started",
      ]);
    }
    if (normalized.value.discountAutonomyMode === "approval_required") {
      return decision("requires_human_or_special_policy", "HUMAN_APPROVAL_REQUIRED", [
        "policy_requires_human_approval",
      ]);
    }
    if (normalized.value.defaultDiscountPercent <= 0) {
      return decision("not_applicable", "NO_DEFAULT_CONCESSION", ["default_step_not_positive"]);
    }
    return decision("first_concession_candidate", "FIRST_DEFAULT_STEP_ELIGIBLE", [
      "material_objection_or_conditioned_close",
      "product_project_and_catalog_price_known",
      "prior_concession_absent",
      "policy_allows_first_step",
    ], true);
  }
  if (input.closeConditionedOnImprovedPrice) {
    if (
      input.messageKind === "conditioned_close" &&
      normalized.value.discountAutonomyMode !== "approval_required" &&
      normalized.value.defaultDiscountPercent > 0
    ) {
      return decision("first_concession_candidate", "FIRST_DEFAULT_STEP_ELIGIBLE", [
        "conditioned_close_detected",
        "product_project_and_catalog_price_known",
        "prior_concession_absent",
        "policy_allows_first_step",
      ], true);
    }
    return decision("requires_human_or_special_policy", "CONDITIONED_CLOSE_REQUIRES_REVIEW", [
      "conditioned_close_detected",
    ]);
  }
  return decision("not_applicable", "NO_NEGOTIATION_TRIGGER", ["no_discount_decision_required"]);
}

export function buildPriceNegotiationStrategyPromptBlock(
  decisionResult: PriceNegotiationStrategyDecision,
) {
  return [
    "ESTRATEGIA DE PRECO E NEGOCIACAO (DECISAO INTERNA)",
    `- decisao: ${decisionResult.kind}`,
    `- motivo: ${decisionResult.reasonCode}`,
    `- grounds: ${decisionResult.grounds.join(", ")}`,
    `- pode iniciar concessao agora: ${decisionResult.shouldStartFirstConcession ? "sim, apenas como candidato" : "nao"}`,
    "- aplicar desconto, aceitar contraproposta ou gerar nova quote nao pertence a esta camada.",
  ].join("\n");
}
