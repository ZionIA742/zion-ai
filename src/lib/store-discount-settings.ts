export const STORE_DISCOUNT_AUTONOMY_MODE_VALUES = [
  "approval_required",
  "default_step_autonomous",
  "within_policy_autonomous",
] as const;

export type StoreDiscountAutonomyMode =
  (typeof STORE_DISCOUNT_AUTONOMY_MODE_VALUES)[number];

export type StoreDiscountSettingsRow = {
  organization_id: string;
  store_id: string;
  default_discount_percent: number | null;
  max_discount_percent: number | null;
  allow_ask_above_max_discount: boolean | null;
  discount_autonomy_mode: string | null;
  discount_special_rules?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type StoreHighValueDiscountSettingsRow = {
  organization_id: string;
  store_id: string;
  enabled: boolean | null;
  threshold_amount_cents: number | null;
  discount_percent: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type StoreDiscountSettingsInput = {
  defaultDiscountPercent: string;
  maxDiscountPercent: string;
  allowAskAboveMaxDiscount: boolean;
  discountAutonomyMode: string;
  discountSpecialRules?: string;
  highValueEnabled: boolean;
  highValueThresholdAmount: string;
  highValueDiscountPercent: string;
};

export type NormalizedStoreDiscountSettingsInput = {
  defaultDiscountPercent: number;
  maxDiscountPercent: number;
  allowAskAboveMaxDiscount: boolean;
  discountAutonomyMode: StoreDiscountAutonomyMode;
  discountSpecialRules: string | null;
  highValueEnabled: boolean;
  highValueThresholdAmountCents: number | null;
  highValueDiscountPercent: number | null;
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeText(value: unknown) {
  return cleanText(value).toLowerCase();
}

function isAllowedValue<T extends readonly string[]>(
  values: T,
  candidate: string,
): candidate is T[number] {
  return (values as readonly string[]).includes(candidate);
}

function parsePercent(value: string): number | null {
  const cleaned = cleanText(value).replace(",", ".");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function parseMoneyReaisToCents(value: string): number | null {
  const digits = cleanText(value).replace(/[^\d]/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 100 : null;
}

function yesNoToBoolean(value: unknown): boolean | null {
  const normalized = normalizeText(value);
  if (normalized === "sim") return true;
  if (normalized === "nao" || normalized === "não") return false;
  return null;
}

export function formatStoreDiscountPercentInput(value: string) {
  return value.replace(/[^\d.,]/g, "");
}

export function formatStoreDiscountMoneyInput(value: string) {
  return value.replace(/[^\d]/g, "");
}

export function getStoreDiscountAutonomyModeLabel(value: unknown) {
  const normalized = cleanText(value);
  switch (normalized) {
    case "approval_required":
      return "Sempre com aprovacao humana";
    case "default_step_autonomous":
      return "IA pode conceder so o primeiro degrau";
    case "within_policy_autonomous":
      return "IA pode conceder dentro da politica";
    default:
      return normalized || "Nao definido";
  }
}

export function createDefaultStoreDiscountSettingsInput(): StoreDiscountSettingsInput {
  return {
    defaultDiscountPercent: "",
    maxDiscountPercent: "",
    allowAskAboveMaxDiscount: false,
    discountAutonomyMode: "approval_required",
    discountSpecialRules: "",
    highValueEnabled: false,
    highValueThresholdAmount: "",
    highValueDiscountPercent: "",
  };
}

export function normalizeStoreDiscountSettingsInput(
  input: StoreDiscountSettingsInput,
): { ok: true; value: NormalizedStoreDiscountSettingsInput } | { ok: false; error: string } {
  const defaultDiscountPercent = parsePercent(input.defaultDiscountPercent);
  const maxDiscountPercent = parsePercent(input.maxDiscountPercent);

  if (defaultDiscountPercent == null) {
    return { ok: false, error: "Informe o primeiro degrau normal de desconto." };
  }

  if (maxDiscountPercent == null) {
    return { ok: false, error: "Informe o teto normal da politica de desconto." };
  }

  if (defaultDiscountPercent < 0 || maxDiscountPercent < 0) {
    return { ok: false, error: "Os percentuais de desconto nao podem ser negativos." };
  }

  if (defaultDiscountPercent > maxDiscountPercent) {
    return { ok: false, error: "O primeiro degrau nao pode ser maior que o teto normal." };
  }

  const autonomyMode = cleanText(input.discountAutonomyMode) || "approval_required";
  if (!isAllowedValue(STORE_DISCOUNT_AUTONOMY_MODE_VALUES, autonomyMode)) {
    return { ok: false, error: "Modo de autonomia de desconto invalido." };
  }

  let highValueThresholdAmountCents: number | null = null;
  let highValueDiscountPercent: number | null = null;

  if (input.highValueEnabled) {
    highValueThresholdAmountCents = parseMoneyReaisToCents(input.highValueThresholdAmount);
    highValueDiscountPercent = parsePercent(input.highValueDiscountPercent);

    if (highValueThresholdAmountCents == null) {
      return { ok: false, error: "Informe o valor minimo da politica de alto valor." };
    }

    if (highValueDiscountPercent == null || highValueDiscountPercent <= 0) {
      return { ok: false, error: "Informe o percentual elegivel da politica de alto valor." };
    }

    if (highValueDiscountPercent > 100) {
      return {
        ok: false,
        error: "O percentual elegivel da politica de alto valor nao pode passar de 100%.",
      };
    }
  }

  return {
    ok: true,
    value: {
      defaultDiscountPercent,
      maxDiscountPercent,
      allowAskAboveMaxDiscount: input.allowAskAboveMaxDiscount,
      discountAutonomyMode: autonomyMode,
      discountSpecialRules: cleanText(input.discountSpecialRules) || null,
      highValueEnabled: input.highValueEnabled,
      highValueThresholdAmountCents,
      highValueDiscountPercent,
    },
  };
}

export function createStoreDiscountSettingsInputFromSources(args: {
  answers?: Record<string, unknown> | null;
  settings?: StoreDiscountSettingsRow | null;
  highValueSettings?: StoreHighValueDiscountSettingsRow | null;
}): StoreDiscountSettingsInput {
  const answers = args.answers ?? {};
  const settings = args.settings ?? null;
  const highValueSettings = args.highValueSettings ?? null;

  if (settings) {
    return {
      defaultDiscountPercent:
        settings.default_discount_percent == null
          ? ""
          : String(settings.default_discount_percent),
      maxDiscountPercent:
        settings.max_discount_percent == null ? "" : String(settings.max_discount_percent),
      allowAskAboveMaxDiscount: settings.allow_ask_above_max_discount === true,
      discountAutonomyMode:
        cleanText(settings.discount_autonomy_mode) || "approval_required",
      discountSpecialRules: cleanText(settings.discount_special_rules),
      highValueEnabled: highValueSettings?.enabled === true,
      highValueThresholdAmount:
        highValueSettings?.threshold_amount_cents == null
          ? ""
          : String(Math.round(highValueSettings.threshold_amount_cents / 100)),
      highValueDiscountPercent:
        highValueSettings?.discount_percent == null
          ? ""
          : String(highValueSettings.discount_percent),
    };
  }

  return {
    ...createDefaultStoreDiscountSettingsInput(),
    maxDiscountPercent: cleanText(answers.max_discount_percent),
    discountSpecialRules: cleanText(answers.discount_special_rules),
    highValueEnabled: false,
  };
}

export function createStoreDiscountPresentationFromSources(args: {
  answers?: Record<string, unknown> | null;
  settings?: StoreDiscountSettingsRow | null;
  highValueSettings?: StoreHighValueDiscountSettingsRow | null;
}) {
  const answers = args.answers ?? {};
  const settings = args.settings ?? null;
  const highValueSettings = args.highValueSettings ?? null;
  const input = createStoreDiscountSettingsInputFromSources(args);
  const normalized = normalizeStoreDiscountSettingsInput(input);
  const legacyMax = cleanText(answers.max_discount_percent);
  const legacyCanOffer = yesNoToBoolean(answers.can_offer_discount);

  const hasHistoricalConflict =
    !!settings &&
    !!legacyMax &&
    cleanText(settings.max_discount_percent) !== legacyMax;

  const historicalConflictSummary = hasHistoricalConflict
    ? `Fonte canonica: padrao ${settings?.default_discount_percent ?? 0}% / teto ${settings?.max_discount_percent ?? 0}% | legado maximo ${legacyMax}%`
    : "";

  const canOfferFromSettings = !!settings
    ? Number(settings.default_discount_percent ?? 0) > 0 ||
      Number(settings.max_discount_percent ?? 0) > 0 ||
      settings.allow_ask_above_max_discount === true
    : legacyCanOffer === true;

  const defaultDiscountPercent =
    settings?.default_discount_percent == null
      ? normalized.ok
        ? normalized.value.defaultDiscountPercent
        : null
      : settings.default_discount_percent;
  const maxDiscountPercent =
    settings?.max_discount_percent == null
      ? normalized.ok
        ? normalized.value.maxDiscountPercent
        : null
      : settings.max_discount_percent;
  const allowAskAboveMaxDiscount =
    settings?.allow_ask_above_max_discount === true ||
    (normalized.ok && normalized.value.allowAskAboveMaxDiscount);
  const autonomyMode =
    cleanText(settings?.discount_autonomy_mode) ||
    (normalized.ok ? normalized.value.discountAutonomyMode : "approval_required");
  const autonomyModeLabel = getStoreDiscountAutonomyModeLabel(autonomyMode);
  const highValueEnabled = highValueSettings?.enabled === true;
  const highValueThresholdAmountCents = highValueSettings?.threshold_amount_cents ?? null;
  const highValueDiscountPercent = highValueSettings?.discount_percent ?? null;
  const discountSpecialRules = settings
    ? cleanText(settings.discount_special_rules) || null
    : cleanText(answers.discount_special_rules) || null;
  const highValueSummary = !highValueEnabled
    ? "Alto valor desativado"
    : [
        highValueThresholdAmountCents == null
          ? null
          : `Alto valor a partir de R$ ${Math.round(highValueThresholdAmountCents / 100)}`,
        highValueDiscountPercent == null
          ? null
          : `${highValueDiscountPercent}% elegivel`,
      ]
        .filter(Boolean)
        .join(" | ");
  const policySummary = settings
    ? [
        defaultDiscountPercent == null
          ? null
          : `Primeiro degrau normal ${defaultDiscountPercent}%`,
        maxDiscountPercent == null ? null : `Teto normal ${maxDiscountPercent}%`,
        autonomyModeLabel,
        allowAskAboveMaxDiscount
          ? "Pode consultar humano acima do teto"
          : "Nao pode consultar acima do teto",
        highValueSummary,
      ]
        .filter(Boolean)
        .join(" | ")
    : [
        legacyCanOffer === null ? null : legacyCanOffer ? "Desconto permitido" : "Desconto nao permitido",
        legacyMax ? `Maximo legado ${legacyMax}%` : null,
      ]
        .filter(Boolean)
        .join(" | ");

  return {
    canOfferDiscount: canOfferFromSettings,
    defaultDiscountPercent,
    maxDiscountPercent,
    allowAskAboveMaxDiscount,
    autonomyMode,
    autonomyModeLabel,
    discountSpecialRules,
    highValueEnabled,
    highValueThresholdAmountCents,
    highValueDiscountPercent,
    policySummary,
    hasHistoricalConflict,
    historicalConflictSummary,
  };
}
