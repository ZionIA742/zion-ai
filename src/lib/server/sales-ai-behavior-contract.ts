import {
  STORE_PAYMENT_METHOD_VALUES,
  type StorePaymentMethod,
  type StorePaymentSettingsRow,
} from "../store-payment-settings";

import type {
  StoreDiscountSettingsRow,
  StoreHighValueDiscountSettingsRow,
} from "../store-discount-settings";

export type SalesAiBehaviorState =
  | "allowed"
  | "forbidden"
  | "human_approval_required"
  | "unconfigured";

export type SalesAiBehaviorDecision = {
  state: SalesAiBehaviorState;
  reasonCode: string;
};

export type SalesAiBehaviorContract = {
  payment: {
    methods: Record<StorePaymentMethod, SalesAiBehaviorDecision>;
    pix: SalesAiBehaviorDecision;
    pixKeyDisclosure: SalesAiBehaviorDecision;
    downPayment: SalesAiBehaviorDecision;
    installments: SalesAiBehaviorDecision;
    installmentInterest: SalesAiBehaviorDecision;
    canonical: {
      acceptedPaymentMethods: StorePaymentMethod[] | null;
      pixKeyType: string | null;
      pixKey: string | null;
      pixHolderName: string | null;
      downPaymentMode: string | null;
      downPaymentValueType: string | null;
      downPaymentPercent: number | null;
      downPaymentAmountCents: number | null;
      installmentsEnabled: boolean | null;
      maxInstallments: number | null;
      installmentInterestPolicy: string | null;
      paymentNotes: string | null;
    };
  };
  discount: {
    defaultStep: SalesAiBehaviorDecision;
    withinPolicy: SalesAiBehaviorDecision;
    aboveMax: SalesAiBehaviorDecision;
    highValue: SalesAiBehaviorDecision;
    canonical: {
      defaultDiscountPercent: number | null;
      maxDiscountPercent: number | null;
      allowAskAboveMaxDiscount: boolean | null;
      autonomyMode: string | null;
      specialRules: string | null;
      highValueEnabled: boolean | null;
      highValueThresholdAmountCents: number | null;
      highValueDiscountPercent: number | null;
    };
  };
};

function decision(
  state: SalesAiBehaviorState,
  reasonCode: string,
): SalesAiBehaviorDecision {
  return { state, reasonCode };
}

function cleanText(value: unknown): string | null {
  const cleaned = String(value ?? "").trim();
  return cleaned || null;
}

function isPaymentMethod(value: string): value is StorePaymentMethod {
  return (STORE_PAYMENT_METHOD_VALUES as readonly string[]).includes(value);
}

function resolvePaymentMethods(
  settings: StorePaymentSettingsRow | null,
): {
  methods: Record<StorePaymentMethod, SalesAiBehaviorDecision>;
  accepted: StorePaymentMethod[] | null;
} {
  if (!settings || settings.accepted_payment_methods == null) {
    const methods = Object.fromEntries(
      STORE_PAYMENT_METHOD_VALUES.map((method) => [
        method,
        decision(
          "unconfigured",
          "PAYMENT_METHODS_UNCONFIGURED",
        ),
      ]),
    ) as Record<StorePaymentMethod, SalesAiBehaviorDecision>;

    return {
      methods,
      accepted: null,
    };
  }

  const accepted = settings.accepted_payment_methods.filter(
    (value): value is StorePaymentMethod =>
      typeof value === "string" && isPaymentMethod(value),
  );

  const acceptedSet = new Set<StorePaymentMethod>(accepted);

  const methods = Object.fromEntries(
    STORE_PAYMENT_METHOD_VALUES.map((method) => [
      method,
      acceptedSet.has(method)
        ? decision(
            "allowed",
            "PAYMENT_METHOD_ALLOWED",
          )
        : decision(
            "forbidden",
            "PAYMENT_METHOD_NOT_ACCEPTED",
          ),
    ]),
  ) as Record<StorePaymentMethod, SalesAiBehaviorDecision>;

  return {
    methods,
    accepted,
  };
}

function resolveDiscountBehavior(
  settings: StoreDiscountSettingsRow | null,
): {
  defaultStep: SalesAiBehaviorDecision;
  withinPolicy: SalesAiBehaviorDecision;
  aboveMax: SalesAiBehaviorDecision;
} {
  if (!settings) {
    return {
      defaultStep: decision(
        "unconfigured",
        "DISCOUNT_POLICY_UNCONFIGURED",
      ),
      withinPolicy: decision(
        "unconfigured",
        "DISCOUNT_POLICY_UNCONFIGURED",
      ),
      aboveMax: decision(
        "unconfigured",
        "DISCOUNT_POLICY_UNCONFIGURED",
      ),
    };
  }

  const autonomyMode = cleanText(settings.discount_autonomy_mode);

  const hasCompleteNormalPolicy =
    typeof settings.default_discount_percent === "number" &&
    Number.isFinite(settings.default_discount_percent) &&
    typeof settings.max_discount_percent === "number" &&
    Number.isFinite(settings.max_discount_percent) &&
    settings.default_discount_percent >= 0 &&
    settings.max_discount_percent >= 0 &&
    settings.default_discount_percent <= settings.max_discount_percent;

  if (!hasCompleteNormalPolicy) {
    return {
      defaultStep: decision(
        "unconfigured",
        "DISCOUNT_POLICY_INCOMPLETE",
      ),
      withinPolicy: decision(
        "unconfigured",
        "DISCOUNT_POLICY_INCOMPLETE",
      ),
      aboveMax: decision(
        "unconfigured",
        "DISCOUNT_POLICY_INCOMPLETE",
      ),
    };
  }

  let defaultStep: SalesAiBehaviorDecision;
  let withinPolicy: SalesAiBehaviorDecision;

  if (autonomyMode === "approval_required") {
    defaultStep = decision(
      "human_approval_required",
      "DISCOUNT_APPROVAL_REQUIRED",
    );
    withinPolicy = decision(
      "human_approval_required",
      "DISCOUNT_APPROVAL_REQUIRED",
    );
  } else if (autonomyMode === "default_step_autonomous") {
    defaultStep = decision(
      "allowed",
      "DISCOUNT_DEFAULT_STEP_AUTONOMOUS",
    );
    withinPolicy = decision(
      "human_approval_required",
      "DISCOUNT_ABOVE_DEFAULT_REQUIRES_APPROVAL",
    );
  } else if (autonomyMode === "within_policy_autonomous") {
    defaultStep = decision(
      "allowed",
      "DISCOUNT_WITHIN_POLICY_AUTONOMOUS",
    );
    withinPolicy = decision(
      "allowed",
      "DISCOUNT_WITHIN_POLICY_AUTONOMOUS",
    );
  } else {
    defaultStep = decision(
      "unconfigured",
      "DISCOUNT_AUTONOMY_UNCONFIGURED",
    );
    withinPolicy = decision(
      "unconfigured",
      "DISCOUNT_AUTONOMY_UNCONFIGURED",
    );
  }

  const aboveMax =
    settings.allow_ask_above_max_discount === true
      ? decision(
          "human_approval_required",
          "DISCOUNT_ABOVE_MAX_CAN_REQUEST_APPROVAL",
        )
      : settings.allow_ask_above_max_discount === false
        ? decision(
            "forbidden",
            "DISCOUNT_ABOVE_MAX_FORBIDDEN",
          )
        : decision(
            "unconfigured",
            "DISCOUNT_ABOVE_MAX_POLICY_UNCONFIGURED",
          );

  return {
    defaultStep,
    withinPolicy,
    aboveMax,
  };
}

function resolveHighValueBehavior(
  settings: StoreHighValueDiscountSettingsRow | null,
): SalesAiBehaviorDecision {
  if (!settings || settings.enabled == null) {
    return decision(
      "unconfigured",
      "HIGH_VALUE_DISCOUNT_UNCONFIGURED",
    );
  }

  if (settings.enabled === false) {
    return decision(
      "forbidden",
      "HIGH_VALUE_DISCOUNT_DISABLED",
    );
  }

  if (
    settings.threshold_amount_cents == null ||
    settings.discount_percent == null
  ) {
    return decision(
      "unconfigured",
      "HIGH_VALUE_DISCOUNT_INCOMPLETE",
    );
  }

  return decision(
    "human_approval_required",
    "HIGH_VALUE_DISCOUNT_ELIGIBLE_REQUIRES_APPROVAL",
  );
}

export function buildSalesAiBehaviorContract(args: {
  paymentSettings: StorePaymentSettingsRow | null;
  discountSettings: StoreDiscountSettingsRow | null;
  highValueDiscountSettings: StoreHighValueDiscountSettingsRow | null;
}): SalesAiBehaviorContract {
  const paymentSettings = args.paymentSettings;
  const paymentMethods = resolvePaymentMethods(paymentSettings);

  const pix = paymentMethods.methods.pix;

  const pixKeyDisclosure =
    pix.state === "forbidden"
      ? decision(
          "forbidden",
          "PIX_NOT_ACCEPTED",
        )
      : pix.state === "unconfigured"
        ? decision(
            "unconfigured",
            "PIX_PAYMENT_UNCONFIGURED",
          )
        : cleanText(paymentSettings?.pix_key_type) &&
            cleanText(paymentSettings?.pix_key)
          ? decision(
              "allowed",
              "PIX_KEY_CONFIGURED",
            )
          : decision(
              "unconfigured",
              "PIX_KEY_UNCONFIGURED",
            );

  const downPaymentMode = cleanText(paymentSettings?.down_payment_mode);

  const downPayment =
    !paymentSettings || downPaymentMode == null || downPaymentMode === "none"
      ? decision(
          "unconfigured",
          "DOWN_PAYMENT_RULE_UNCONFIGURED",
        )
      : downPaymentMode === "optional" || downPaymentMode === "required"
        ? decision(
            "allowed",
            "DOWN_PAYMENT_RULE_CONFIGURED",
          )
        : decision(
            "unconfigured",
            "DOWN_PAYMENT_RULE_INVALID",
          );

  const installments =
    !paymentSettings || paymentSettings.installments_enabled == null
      ? decision(
          "unconfigured",
          "INSTALLMENTS_UNCONFIGURED",
        )
      : paymentSettings.installments_enabled === true
        ? decision(
            "allowed",
            "INSTALLMENTS_ENABLED",
          )
        : decision(
            "forbidden",
            "INSTALLMENTS_DISABLED",
          );

  const installmentInterestPolicy = cleanText(
    paymentSettings?.installment_interest_policy,
  );

  const installmentInterest =
    installments.state === "forbidden"
      ? decision(
          "forbidden",
          "INSTALLMENTS_DISABLED",
        )
      : installments.state === "unconfigured"
        ? decision(
            "unconfigured",
            "INSTALLMENTS_UNCONFIGURED",
          )
        : installmentInterestPolicy === "case_by_case"
          ? decision(
              "human_approval_required",
              "INSTALLMENT_INTEREST_CASE_BY_CASE",
            )
          : installmentInterestPolicy === "interest_free" ||
              installmentInterestPolicy === "with_interest"
            ? decision(
                "allowed",
                "INSTALLMENT_INTEREST_POLICY_CONFIGURED",
              )
            : decision(
                "unconfigured",
                "INSTALLMENT_INTEREST_POLICY_UNCONFIGURED",
              );

  const discountBehavior = resolveDiscountBehavior(args.discountSettings);
  const highValue = resolveHighValueBehavior(args.highValueDiscountSettings);

  return {
    payment: {
      methods: paymentMethods.methods,
      pix,
      pixKeyDisclosure,
      downPayment,
      installments,
      installmentInterest,
      canonical: {
        acceptedPaymentMethods: paymentMethods.accepted,
        pixKeyType: cleanText(paymentSettings?.pix_key_type),
        pixKey: cleanText(paymentSettings?.pix_key),
        pixHolderName: cleanText(paymentSettings?.pix_holder_name),
        downPaymentMode,
        downPaymentValueType: cleanText(
          paymentSettings?.down_payment_value_type,
        ),
        downPaymentPercent:
          paymentSettings?.down_payment_percent ?? null,
        downPaymentAmountCents:
          paymentSettings?.down_payment_amount_cents ?? null,
        installmentsEnabled:
          paymentSettings?.installments_enabled ?? null,
        maxInstallments:
          paymentSettings?.max_installments ?? null,
        installmentInterestPolicy:
          cleanText(paymentSettings?.installment_interest_policy),
        paymentNotes:
          cleanText(paymentSettings?.payment_notes),
      },
    },
    discount: {
      ...discountBehavior,
      highValue,
      canonical: {
        defaultDiscountPercent:
          args.discountSettings?.default_discount_percent ?? null,
        maxDiscountPercent:
          args.discountSettings?.max_discount_percent ?? null,
        allowAskAboveMaxDiscount:
          args.discountSettings?.allow_ask_above_max_discount ?? null,
        autonomyMode:
          cleanText(args.discountSettings?.discount_autonomy_mode),
        specialRules:
          cleanText(args.discountSettings?.discount_special_rules),
        highValueEnabled:
          args.highValueDiscountSettings?.enabled ?? null,
        highValueThresholdAmountCents:
          args.highValueDiscountSettings?.threshold_amount_cents ?? null,
        highValueDiscountPercent:
          args.highValueDiscountSettings?.discount_percent ?? null,
      },
    },
  };
}

export type SalesAiBehaviorContractOutputViolation =
  | "INSTALLMENTS_NOT_ALLOWED_CLAIM"
  | "DISCOUNT_APPROVAL_BYPASSED"
  | "PIX_KEY_DISCLOSURE_NOT_ALLOWED";

function normalizeBehaviorGuardText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function findSalesAiBehaviorContractOutputViolation(args: {
  text: string;
  contract: SalesAiBehaviorContract;
}): SalesAiBehaviorContractOutputViolation | null {
  const text = normalizeBehaviorGuardText(args.text);

  if (!text) return null;

  if (args.contract.payment.installments.state !== "allowed") {
    const explicitlyDeniesInstallments =
      /\b(?:nao|nunca|sem)\b.{0,30}\b(?:parcelamento|parcelamos|parcelar|parcelado|parcelada|parcelas?)\b/.test(
        text,
      ) ||
      /\b(?:parcelamento|parcelar|parcelado|parcelada|parcelas?)\b.{0,30}\b(?:indisponivel|nao disponivel)\b/.test(
        text,
      );

    const affirmativelyOffersInstallments =
      /\b(?:fazemos|faz|conseguimos|consigo|podemos|posso|da para|dá para)\b.{0,35}\b(?:em\s+)?(?:ate\s+)?\d+\s*x\b/.test(
        text,
      ) ||
      /\b(?:parcelamos|parcelamos em|parcelamos ate|parcelamos em ate)\b/.test(
        text,
      );

    if (
      affirmativelyOffersInstallments &&
      !explicitlyDeniesInstallments
    ) {
      return "INSTALLMENTS_NOT_ALLOWED_CLAIM";
    }
  }

  if (
    args.contract.discount.defaultStep.state ===
      "human_approval_required" ||
    args.contract.discount.withinPolicy.state ===
      "human_approval_required"
  ) {
    const mentionsConcreteDiscount =
      /\b\d{1,3}(?:[.,]\d+)?\s*%\s*(?:de\s+)?desconto\b/.test(text) ||
      /\bdesconto\b.{0,30}\b\d{1,3}(?:[.,]\d+)?\s*%/.test(text);

    const grantsDiscount =
      /\b(?:libero|liberamos|consigo liberar|podemos liberar|posso liberar|dou|damos|consigo dar|podemos dar|posso dar|fecho com)\b/.test(
        text,
      );

    if (mentionsConcreteDiscount && grantsDiscount) {
      return "DISCOUNT_APPROVAL_BYPASSED";
    }
  }

  if (args.contract.payment.pixKeyDisclosure.state !== "allowed") {
    const disclosesPixKey =
      /\bchave\s+pix\s*(?:e|eh|:)\s*[^\s,.!?;:]+/.test(text);

    if (disclosesPixKey) {
      return "PIX_KEY_DISCLOSURE_NOT_ALLOWED";
    }
  }

  return null;
}
function formatBehaviorDecisionLine(
  path: string,
  value: SalesAiBehaviorDecision,
): string {
  return `- ${path}: ${value.state} | ${value.reasonCode}`;
}

export function buildSalesAiBehaviorContractPromptBlock(
  contract: SalesAiBehaviorContract,
): string {
  const pixKeyForDisclosure =
    contract.payment.pixKeyDisclosure.state === "allowed"
      ? contract.payment.canonical.pixKey ?? "not_configured"
      : "not_available_for_disclosure";

  return [
    "SALES AI BEHAVIOR CONTRACT - AUTORIDADE EFETIVA",
    "- este bloco define permissao efetiva e prevalece sobre orientacoes genericas, exemplos e dados legados",
    "- allowed: pode afirmar ou oferecer somente dentro dos limites canonicos descritos",
    "- forbidden: condicao indisponivel; nao ofereca, nao prometa e nao transforme em simples pedido de confirmacao",
    "- human_approval_required: nao conceda sozinho; quando comercialmente adequado, ofereca consulta/aprovacao humana de forma explicita",
    "- unconfigured: nao existe autoridade suficiente para compromisso automatico; nao presuma permissao",
    "- false e proibicao real quando a authority canonica usa booleano; nunca converta false em talvez",
    "- none representa ausencia de regra configurada; nunca converta none em permissao",
    ...STORE_PAYMENT_METHOD_VALUES.map((method) =>
      formatBehaviorDecisionLine(
        `payment.method.${method}`,
        contract.payment.methods[method],
      ),
    ),
    formatBehaviorDecisionLine("payment.pix", contract.payment.pix),
    formatBehaviorDecisionLine(
      "payment.pix_key_disclosure",
      contract.payment.pixKeyDisclosure,
    ),
    `- payment.pix_key_value: ${pixKeyForDisclosure}`,
    formatBehaviorDecisionLine(
      "payment.down_payment",
      contract.payment.downPayment,
    ),
    `- payment.down_payment_mode: ${contract.payment.canonical.downPaymentMode ?? "not_configured"}`,
    `- payment.down_payment_value_type: ${contract.payment.canonical.downPaymentValueType ?? "not_configured"}`,
    `- payment.down_payment_percent: ${contract.payment.canonical.downPaymentPercent ?? "not_configured"}`,
    `- payment.down_payment_amount_cents: ${contract.payment.canonical.downPaymentAmountCents ?? "not_configured"}`,
    formatBehaviorDecisionLine(
      "payment.installments",
      contract.payment.installments,
    ),
    `- payment.max_installments: ${contract.payment.canonical.maxInstallments ?? "not_configured"}`,
    formatBehaviorDecisionLine(
      "payment.installment_interest",
      contract.payment.installmentInterest,
    ),
    `- payment.installment_interest_policy: ${contract.payment.canonical.installmentInterestPolicy ?? "not_configured"}`,
    formatBehaviorDecisionLine(
      "discount.default_step",
      contract.discount.defaultStep,
    ),
    formatBehaviorDecisionLine(
      "discount.within_policy",
      contract.discount.withinPolicy,
    ),
    formatBehaviorDecisionLine(
      "discount.above_max",
      contract.discount.aboveMax,
    ),
    formatBehaviorDecisionLine(
      "discount.high_value",
      contract.discount.highValue,
    ),
    `- discount.default_percent: ${contract.discount.canonical.defaultDiscountPercent ?? "not_configured"}`,
    `- discount.max_percent_internal: ${contract.discount.canonical.maxDiscountPercent ?? "not_configured"}`,
    `- discount.autonomy_mode: ${contract.discount.canonical.autonomyMode ?? "not_configured"}`,
    `- discount.high_value_threshold_cents: ${contract.discount.canonical.highValueThresholdAmountCents ?? "not_configured"}`,
    `- discount.high_value_percent: ${contract.discount.canonical.highValueDiscountPercent ?? "not_configured"}`,
    `- discount.special_rules: ${contract.discount.canonical.specialRules ?? "not_configured"}`,
    "- regras especiais podem restringir ou contextualizar a politica, mas texto livre nao amplia sozinho uma permissao marcada como forbidden, human_approval_required ou unconfigured",
    "- nunca revele ao cliente teto interno, reasonCode ou nomes internos deste contrato",
  ].join("\n");
}
