export const STORE_PAYMENT_METHOD_VALUES = [
  "pix",
  "cartao_credito",
  "cartao_debito",
  "boleto",
  "dinheiro",
  "transferencia",
  "financiamento",
 ] as const;

export const STORE_PAYMENT_LEGACY_CONDITION_TAG_VALUES = [
  "parcelado",
  "a_vista",
  "sinal_mais_parcelas",
  "sob_analise",
] as const;

export const STORE_PAYMENT_PIX_KEY_TYPE_VALUES = [
  "cpf",
  "cnpj",
  "email",
  "phone",
  "random",
] as const;

export const STORE_PAYMENT_DOWN_PAYMENT_MODE_VALUES = [
  "none",
  "optional",
  "required",
] as const;

export const STORE_PAYMENT_DOWN_PAYMENT_VALUE_TYPE_VALUES = [
  "percent",
  "fixed",
  "case_by_case",
] as const;

export const STORE_PAYMENT_INSTALLMENT_INTEREST_POLICY_VALUES = [
  "interest_free",
  "with_interest",
  "case_by_case",
] as const;

export type StorePaymentMethod =
  (typeof STORE_PAYMENT_METHOD_VALUES)[number];

export type StorePaymentLegacyConditionTag =
  (typeof STORE_PAYMENT_LEGACY_CONDITION_TAG_VALUES)[number];

export type StorePaymentSelection =
  | StorePaymentMethod
  | StorePaymentLegacyConditionTag;

export type StorePaymentPixKeyType =
  (typeof STORE_PAYMENT_PIX_KEY_TYPE_VALUES)[number];

export type StorePaymentDownPaymentMode =
  (typeof STORE_PAYMENT_DOWN_PAYMENT_MODE_VALUES)[number];

export type StorePaymentDownPaymentValueType =
  (typeof STORE_PAYMENT_DOWN_PAYMENT_VALUE_TYPE_VALUES)[number];

export type StorePaymentInstallmentInterestPolicy =
  (typeof STORE_PAYMENT_INSTALLMENT_INTEREST_POLICY_VALUES)[number];

export type StorePaymentSettingsRow = {
  organization_id: string;
  store_id: string;
  accepted_payment_methods: string[] | null;
  pix_key_type: string | null;
  pix_key: string | null;
  pix_holder_name: string | null;
  down_payment_mode: string | null;
  down_payment_value_type: string | null;
  down_payment_percent: number | null;
  down_payment_amount_cents: number | null;
  installments_enabled: boolean | null;
  max_installments: number | null;
  installment_interest_policy: string | null;
  payment_notes: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type StorePaymentSettingsInput = {
  acceptedPaymentMethods: string[];
  legacyPaymentConditionTags?: StorePaymentLegacyConditionTag[];
  pixKeyType: string;
  pixKey: string;
  pixHolderName: string;
  downPaymentMode: string;
  downPaymentValueType: string;
  downPaymentPercent: string;
  downPaymentAmount: string;
  installmentsEnabled: string;
  maxInstallments: string;
  installmentInterestPolicy: string;
  paymentNotes: string;
};

export type NormalizedStorePaymentSettingsInput = {
  acceptedPaymentMethods: StorePaymentMethod[];
  pixKeyType: StorePaymentPixKeyType | null;
  pixKey: string | null;
  pixHolderName: string | null;
  downPaymentMode: StorePaymentDownPaymentMode;
  downPaymentValueType: StorePaymentDownPaymentValueType | null;
  downPaymentPercent: number | null;
  downPaymentAmountCents: number | null;
  installmentsEnabled: boolean;
  maxInstallments: number | null;
  installmentInterestPolicy: StorePaymentInstallmentInterestPolicy | null;
  paymentNotes: string | null;
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeText(value: unknown) {
  return cleanText(value).toLowerCase();
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isStorePaymentSelection(candidate: string): candidate is StorePaymentSelection {
  return (
    isAllowedValue(STORE_PAYMENT_METHOD_VALUES, candidate) ||
    isAllowedValue(STORE_PAYMENT_LEGACY_CONDITION_TAG_VALUES, candidate)
  );
}

function isAllowedValue<T extends readonly string[]>(
  values: T,
  candidate: string,
): candidate is T[number] {
  return (values as readonly string[]).includes(candidate);
}

function formatCurrencyFromCents(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value / 100);
}

export function formatStorePaymentCurrencyInput(value: string) {
  return value.replace(/[^\d]/g, "");
}

export function formatStorePaymentPercentInput(value: string) {
  return value.replace(/[^\d.,]/g, "");
}

export function formatStorePaymentInstallmentsInput(value: string) {
  return value.replace(/[^\d]/g, "");
}

function coerceStorePaymentSelections(value: unknown): StorePaymentSelection[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  const normalizedValues = rawValues.map((item) => normalizeText(item)).filter(Boolean);

  const hasSplitPixArtifact =
    normalizedValues.includes("p") &&
    normalizedValues.includes("i") &&
    normalizedValues.includes("x");

  const result: StorePaymentSelection[] = [];
  let splitPixInserted = false;

  for (const item of normalizedValues) {
    if (item === "p" || item === "i" || item === "x") {
      if (hasSplitPixArtifact && !splitPixInserted) {
        result.push("pix");
        splitPixInserted = true;
      }
      continue;
    }

    if (isStorePaymentSelection(item)) {
      result.push(item);
    }
  }

  return uniqueStrings(result) as StorePaymentSelection[];
}

export function coerceStorePaymentMethods(value: unknown): StorePaymentMethod[] {
  return coerceStorePaymentSelections(value).filter((item): item is StorePaymentMethod =>
    isAllowedValue(STORE_PAYMENT_METHOD_VALUES, item),
  );
}

export function coerceLegacyPaymentConditionTags(
  value: unknown,
): StorePaymentLegacyConditionTag[] {
  return coerceStorePaymentSelections(value).filter(
    (item): item is StorePaymentLegacyConditionTag =>
      isAllowedValue(STORE_PAYMENT_LEGACY_CONDITION_TAG_VALUES, item),
  );
}

export function normalizeStorePaymentSettingsInput(
  input: StorePaymentSettingsInput,
): { ok: true; value: NormalizedStorePaymentSettingsInput } | { ok: false; error: string } {
  const acceptedPaymentMethods = coerceStorePaymentMethods(
    input.acceptedPaymentMethods,
  );

  if (acceptedPaymentMethods.length === 0) {
    return {
      ok: false,
      error: "Selecione pelo menos uma forma de pagamento aceita pela loja.",
    };
  }

  const pixAccepted = acceptedPaymentMethods.includes("pix");
  const pixKeyTypeCandidate = cleanText(input.pixKeyType);
  const pixKeyCandidate = cleanText(input.pixKey);
  const pixHolderNameCandidate = cleanText(input.pixHolderName);
  let pixKeyType: StorePaymentPixKeyType | null = null;
  let pixKey: string | null = null;
  let pixHolderName: string | null = null;

  if (pixAccepted) {
    if (
      pixKeyTypeCandidate &&
      !isAllowedValue(STORE_PAYMENT_PIX_KEY_TYPE_VALUES, pixKeyTypeCandidate)
    ) {
      return { ok: false, error: "Tipo de chave Pix invalido." };
    }

    if (pixKeyCandidate && !pixKeyTypeCandidate) {
      return {
        ok: false,
        error: "Informe o tipo da chave Pix antes de salvar a chave.",
      };
    }

    pixKeyType = pixKeyTypeCandidate
      ? (pixKeyTypeCandidate as StorePaymentPixKeyType)
      : null;
    pixKey = pixKeyCandidate || null;
    pixHolderName = pixHolderNameCandidate || null;
  }

  const downPaymentModeCandidate = cleanText(input.downPaymentMode) || "none";
  if (
    !isAllowedValue(
      STORE_PAYMENT_DOWN_PAYMENT_MODE_VALUES,
      downPaymentModeCandidate,
    )
  ) {
    return { ok: false, error: "Modo de entrada invalido." };
  }

  let downPaymentValueType: StorePaymentDownPaymentValueType | null = null;
  let downPaymentPercent: number | null = null;
  let downPaymentAmountCents: number | null = null;

  if (downPaymentModeCandidate !== "none") {
    const valueTypeCandidate = cleanText(input.downPaymentValueType);
    if (
      !isAllowedValue(
        STORE_PAYMENT_DOWN_PAYMENT_VALUE_TYPE_VALUES,
        valueTypeCandidate,
      )
    ) {
      return {
        ok: false,
        error: "Defina como a entrada deve ser tratada.",
      };
    }

    downPaymentValueType =
      valueTypeCandidate as StorePaymentDownPaymentValueType;

    if (downPaymentValueType === "percent") {
      const parsedPercent = Number(
        cleanText(input.downPaymentPercent).replace(",", "."),
      );

      if (
        !Number.isFinite(parsedPercent) ||
        parsedPercent <= 0 ||
        parsedPercent > 100
      ) {
        return {
          ok: false,
          error: "A entrada percentual precisa ficar entre 0,01% e 100%.",
        };
      }

      downPaymentPercent = Math.round(parsedPercent * 100) / 100;
    }

    if (downPaymentValueType === "fixed") {
      const parsedAmount = Number(cleanText(input.downPaymentAmount));
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return {
          ok: false,
          error: "Informe o valor fixo da entrada em reais inteiros.",
        };
      }

      downPaymentAmountCents = Math.round(parsedAmount * 100);
    }
  }

  const installmentsEnabled =
    normalizeText(input.installmentsEnabled) === "sim";
  let maxInstallments: number | null = null;
  let installmentInterestPolicy: StorePaymentInstallmentInterestPolicy | null =
    null;

  if (installmentsEnabled) {
    const parsedInstallments = Number(cleanText(input.maxInstallments));
    if (
      !Number.isFinite(parsedInstallments) ||
      parsedInstallments < 1 ||
      parsedInstallments > 360
    ) {
      return {
        ok: false,
        error: "Defina o numero maximo de parcelas com um valor valido.",
      };
    }

    const interestPolicyCandidate = cleanText(input.installmentInterestPolicy);
    if (
      !isAllowedValue(
        STORE_PAYMENT_INSTALLMENT_INTEREST_POLICY_VALUES,
        interestPolicyCandidate,
      )
    ) {
      return {
        ok: false,
        error: "Defina a politica de juros do parcelamento.",
      };
    }

    maxInstallments = parsedInstallments;
    installmentInterestPolicy =
      interestPolicyCandidate as StorePaymentInstallmentInterestPolicy;
  }

  return {
    ok: true,
    value: {
      acceptedPaymentMethods,
      pixKeyType,
      pixKey,
      pixHolderName,
      downPaymentMode:
        downPaymentModeCandidate as StorePaymentDownPaymentMode,
      downPaymentValueType,
      downPaymentPercent,
      downPaymentAmountCents,
      installmentsEnabled,
      maxInstallments,
      installmentInterestPolicy,
      paymentNotes: cleanText(input.paymentNotes) || null,
    },
  };
}

export function createDefaultStorePaymentSettingsInput(): StorePaymentSettingsInput {
  return {
    acceptedPaymentMethods: [],
    pixKeyType: "",
    pixKey: "",
    pixHolderName: "",
    downPaymentMode: "none",
    downPaymentValueType: "",
    downPaymentPercent: "",
    downPaymentAmount: "",
    installmentsEnabled: "nao",
    maxInstallments: "",
    installmentInterestPolicy: "",
    paymentNotes: "",
  };
}

export function createStorePaymentSettingsInputFromSources(args: {
  answers?: Record<string, unknown> | null;
  settings?: StorePaymentSettingsRow | null;
}): StorePaymentSettingsInput {
  const settings = args.settings ?? null;

  if (settings) {
    return {
      acceptedPaymentMethods: coerceStorePaymentMethods(
        settings.accepted_payment_methods,
      ),
      pixKeyType: cleanText(settings.pix_key_type),
      pixKey: cleanText(settings.pix_key),
      pixHolderName: cleanText(settings.pix_holder_name),
      downPaymentMode: cleanText(settings.down_payment_mode) || "none",
      downPaymentValueType: cleanText(settings.down_payment_value_type),
      downPaymentPercent:
        settings.down_payment_percent == null
          ? ""
          : String(settings.down_payment_percent),
      downPaymentAmount:
        settings.down_payment_amount_cents == null
          ? ""
          : String(Math.round(settings.down_payment_amount_cents / 100)),
      installmentsEnabled:
        settings.installments_enabled === true ? "sim" : "nao",
      maxInstallments:
        settings.max_installments == null
          ? ""
          : String(settings.max_installments),
      installmentInterestPolicy: cleanText(
        settings.installment_interest_policy,
      ),
      paymentNotes: cleanText(settings.payment_notes),
    };
  }

  return createDefaultStorePaymentSettingsInput();
}

export function getStorePaymentMethodLabel(value: StorePaymentMethod) {
  if (value === "pix") return "Pix";
  if (value === "cartao_credito") return "Cartao de credito";
  if (value === "cartao_debito") return "Cartao de debito";
  if (value === "boleto") return "Boleto";
  if (value === "dinheiro") return "Dinheiro";
  if (value === "transferencia") return "Transferencia";
  return "Financiamento";
}

export function getStorePaymentLegacyConditionTagLabel(
  value: StorePaymentLegacyConditionTag,
) {
  if (value === "parcelado") return "Parcelado";
  if (value === "a_vista") return "A vista";
  if (value === "sob_analise") return "Sob analise";
  return "Sinal + parcelas";
}

export function createStorePaymentPresentationFromSources(args: {
  answers?: Record<string, unknown> | null;
  settings?: StorePaymentSettingsRow | null;
}) {
  const answers = args.answers ?? {};
  const settings = args.settings ?? null;
  const paymentSettingsInput = createStorePaymentSettingsInputFromSources(args);
  const legacyPaymentConditionTags = settings
    ? coerceLegacyPaymentConditionTags(settings.accepted_payment_methods)
    : [];
  const normalizedPaymentSettings = normalizeStorePaymentSettingsInput({
    acceptedPaymentMethods: paymentSettingsInput.acceptedPaymentMethods,
    pixKeyType: paymentSettingsInput.pixKeyType,
    pixKey: paymentSettingsInput.pixKey,
    pixHolderName: paymentSettingsInput.pixHolderName,
    downPaymentMode: paymentSettingsInput.downPaymentMode,
    downPaymentValueType: paymentSettingsInput.downPaymentValueType,
    downPaymentPercent: paymentSettingsInput.downPaymentPercent,
    downPaymentAmount: paymentSettingsInput.downPaymentAmount,
    installmentsEnabled: paymentSettingsInput.installmentsEnabled,
    maxInstallments: paymentSettingsInput.maxInstallments,
    installmentInterestPolicy: paymentSettingsInput.installmentInterestPolicy,
    paymentNotes: paymentSettingsInput.paymentNotes,
  });

  const legacyConditionSummary = legacyPaymentConditionTags
    .map(getStorePaymentLegacyConditionTagLabel)
    .join(", ");

  if (normalizedPaymentSettings.ok) {
    return {
      canonicalPaymentMethods: normalizedPaymentSettings.value.acceptedPaymentMethods,
      legacyPaymentConditionTags,
      paymentSummary: deriveStorePaymentSettingsSummary(
        normalizedPaymentSettings.value,
      ),
      legacyConditionSummary,
      legacyConditionNotice: legacyConditionSummary
        ? `Dados antigos para revisar: ${legacyConditionSummary}`
        : "",
    };
  }

  const fallbackMethods = paymentSettingsInput.acceptedPaymentMethods.map(
    (value) => getStorePaymentMethodLabel(value as StorePaymentMethod),
  );

  return {
    canonicalPaymentMethods: paymentSettingsInput.acceptedPaymentMethods.filter(
      (value): value is StorePaymentMethod =>
        isAllowedValue(STORE_PAYMENT_METHOD_VALUES, value),
    ),
    legacyPaymentConditionTags,
    paymentSummary: fallbackMethods.join(", "),
    legacyConditionSummary,
    legacyConditionNotice: legacyConditionSummary
      ? `Dados antigos para revisar: ${legacyConditionSummary}`
      : "",
  };
}

export function createStorePaymentDisplaySummaryFromSources(args: {
  answers?: Record<string, unknown> | null;
  settings?: StorePaymentSettingsRow | null;
}) {
  return createStorePaymentPresentationFromSources(args).paymentSummary;
}

function getDownPaymentModeLabel(value: StorePaymentDownPaymentMode) {
  if (value === "optional") return "Entrada opcional";
  if (value === "required") return "Entrada obrigatoria";
  return "Sem entrada";
}

function getInstallmentInterestPolicyLabel(
  value: StorePaymentInstallmentInterestPolicy,
) {
  if (value === "interest_free") return "sem juros";
  if (value === "with_interest") return "com juros";
  return "juros caso a caso";
}

export function deriveStorePaymentSettingsSummary(
  input: NormalizedStorePaymentSettingsInput,
) {
  const parts: string[] = [];
  const methods = input.acceptedPaymentMethods.map(getStorePaymentMethodLabel);

  if (methods.length > 0) {
    parts.push(methods.join(", "));
  }

  if (input.installmentsEnabled) {
    const installmentParts = [
      input.maxInstallments ? `parcelamento em ate ${input.maxInstallments}x` : null,
      input.installmentInterestPolicy
        ? getInstallmentInterestPolicyLabel(
            input.installmentInterestPolicy,
          )
        : null,
    ].filter(Boolean);

    if (installmentParts.length > 0) {
      parts.push(installmentParts.join(" "));
    }
  }

  if (input.downPaymentMode !== "none") {
    let detail = "";
    if (input.downPaymentValueType === "percent" && input.downPaymentPercent != null) {
      detail = `${input.downPaymentPercent}%`;
    } else if (
      input.downPaymentValueType === "fixed" &&
      input.downPaymentAmountCents != null
    ) {
      detail = formatCurrencyFromCents(input.downPaymentAmountCents);
    } else if (input.downPaymentValueType === "case_by_case") {
      detail = "caso a caso";
    }

    parts.push(
      [getDownPaymentModeLabel(input.downPaymentMode), detail]
        .filter(Boolean)
        .join(" "),
    );
  }

  if (input.paymentNotes) {
    parts.push(input.paymentNotes);
  }

  return parts.join(" | ");
}
