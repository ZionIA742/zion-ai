import {
  STORE_PAYMENT_METHOD_VALUES,
  parseStorePaymentCurrencyDecimalInputToCents,
  type StorePaymentMethod,
  type StorePaymentSettingsRow,
} from "./store-payment-settings";

export const STORE_DISCOUNT_COUNTERPART_MINIMUM_TYPE_VALUES = [
  "percent",
  "fixed",
] as const;

export type StoreDiscountCounterpartMinimumType =
  (typeof STORE_DISCOUNT_COUNTERPART_MINIMUM_TYPE_VALUES)[number];

export type StoreDiscountCounterpartPolicyRow = {
  organization_id: string;
  store_id: string;
  enabled: boolean;
  allowed_payment_methods: string[] | null;
  higher_down_payment_enabled: boolean;
  higher_down_payment_minimum_type: string | null;
  higher_down_payment_minimum_percent: number | null;
  higher_down_payment_minimum_amount_cents: number | null;
  fewer_installments_enabled: boolean;
  fewer_installments_max_count: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type StoreDiscountCounterpartPolicyInput = {
  enabled: boolean;
  allowedPaymentMethods: string[];
  higherDownPaymentEnabled: boolean;
  higherDownPaymentMinimumType: string;
  higherDownPaymentMinimumPercent: string;
  higherDownPaymentMinimumAmount: string;
  fewerInstallmentsEnabled: boolean;
  fewerInstallmentsMaxCount: string;
};

export type NormalizedStoreDiscountCounterpartPolicy = {
  enabled: boolean;
  allowedPaymentMethods: StorePaymentMethod[];
  higherDownPaymentEnabled: boolean;
  higherDownPaymentMinimumType: StoreDiscountCounterpartMinimumType | null;
  higherDownPaymentMinimumPercent: number | null;
  higherDownPaymentMinimumAmountCents: number | null;
  fewerInstallmentsEnabled: boolean;
  fewerInstallmentsMaxCount: number | null;
};

export type StoreDiscountCounterpartPaymentBaseline = Pick<
  StorePaymentSettingsRow,
  | "down_payment_mode"
  | "down_payment_value_type"
  | "down_payment_percent"
  | "down_payment_amount_cents"
>;

export function createDefaultStoreDiscountCounterpartPolicyInput(): StoreDiscountCounterpartPolicyInput {
  return {
    enabled: false,
    allowedPaymentMethods: [],
    higherDownPaymentEnabled: false,
    higherDownPaymentMinimumType: "",
    higherDownPaymentMinimumPercent: "",
    higherDownPaymentMinimumAmount: "",
    fewerInstallmentsEnabled: false,
    fewerInstallmentsMaxCount: "",
  };
}

function parseFiniteNumber(value: unknown): number | null {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCents(value: unknown): number | null {
  return parseStorePaymentCurrencyDecimalInputToCents(String(value ?? ""));
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = parseFiniteNumber(value);
  if (parsed == null || !Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

export function normalizeStoreDiscountCounterpartPolicyInput(
  input: StoreDiscountCounterpartPolicyInput,
): { ok: true; value: NormalizedStoreDiscountCounterpartPolicy } | { ok: false; error: string } {
  const methods = Array.from(new Set(input.allowedPaymentMethods));
  if (methods.some((method) => !(STORE_PAYMENT_METHOD_VALUES as readonly string[]).includes(method))) {
    return { ok: false, error: "Método de pagamento de contrapartida inválido." };
  }

  if (!input.enabled) {
    return {
      ok: true,
      value: {
        enabled: false,
        allowedPaymentMethods: [],
        higherDownPaymentEnabled: false,
        higherDownPaymentMinimumType: null,
        higherDownPaymentMinimumPercent: null,
        higherDownPaymentMinimumAmountCents: null,
        fewerInstallmentsEnabled: false,
        fewerInstallmentsMaxCount: null,
      },
    };
  }

  let higherType: StoreDiscountCounterpartMinimumType | null = null;
  let higherPercent: number | null = null;
  let higherCents: number | null = null;
  if (input.higherDownPaymentEnabled) {
    if (!(STORE_DISCOUNT_COUNTERPART_MINIMUM_TYPE_VALUES as readonly string[]).includes(input.higherDownPaymentMinimumType)) {
      return { ok: false, error: "Tipo mínimo de entrada inválido." };
    }
    higherType = input.higherDownPaymentMinimumType as StoreDiscountCounterpartMinimumType;
    if (higherType === "percent") {
      higherPercent = parseFiniteNumber(input.higherDownPaymentMinimumPercent);
      if (higherPercent == null || higherPercent <= 0 || higherPercent > 100) {
        return { ok: false, error: "Percentual mínimo de entrada inválido." };
      }
    } else {
      higherCents = parseCents(input.higherDownPaymentMinimumAmount);
      if (higherCents == null) return { ok: false, error: "Valor mínimo de entrada inválido." };
    }
  }

  const fewerMax = input.fewerInstallmentsEnabled
    ? parsePositiveInteger(input.fewerInstallmentsMaxCount)
    : null;
  if (input.fewerInstallmentsEnabled && fewerMax == null) {
    return { ok: false, error: "Limite de parcelas da contrapartida inválido." };
  }

  return {
    ok: true,
    value: {
      enabled: true,
      allowedPaymentMethods: methods as StorePaymentMethod[],
      higherDownPaymentEnabled: input.higherDownPaymentEnabled,
      higherDownPaymentMinimumType: higherType,
      higherDownPaymentMinimumPercent: higherPercent,
      higherDownPaymentMinimumAmountCents: higherCents,
      fewerInstallmentsEnabled: input.fewerInstallmentsEnabled,
      fewerInstallmentsMaxCount: fewerMax,
    },
  };
}

export function validateHigherDownPaymentAgainstPaymentSettings(args: {
  policy: NormalizedStoreDiscountCounterpartPolicy;
  paymentSettings: StoreDiscountCounterpartPaymentBaseline | null | undefined;
}): { ok: true } | { ok: false; error: string } {
  const { policy, paymentSettings } = args;
  if (!policy.higherDownPaymentEnabled) return { ok: true };
  if (!paymentSettings) {
    return { ok: false, error: "NÃ£o foi possÃ­vel confirmar a entrada normal da loja." };
  }

  const mode = String(paymentSettings.down_payment_mode ?? "").trim();
  if (mode === "none") return { ok: true };
  if (!["optional", "required"].includes(mode)) {
    return { ok: false, error: "Defina uma entrada normal vÃ¡lida antes de ativar esta contrapartida." };
  }

  const baselineType = String(paymentSettings.down_payment_value_type ?? "").trim();
  if (baselineType === "percent") {
    const baseline = Number(paymentSettings.down_payment_percent);
    if (!Number.isFinite(baseline) || baseline <= 0 || baseline > 100) {
      return { ok: false, error: "Defina o percentual da entrada normal antes de ativar esta contrapartida." };
    }
    if (policy.higherDownPaymentMinimumType !== "percent" || policy.higherDownPaymentMinimumPercent == null) {
      return { ok: false, error: "A contrapartida deve usar percentual, igual Ã  entrada normal da loja." };
    }
    if (policy.higherDownPaymentMinimumPercent <= baseline) {
      return { ok: false, error: `A entrada da contrapartida deve ser maior que ${baseline}%.` };
    }
    return { ok: true };
  }

  if (baselineType === "fixed") {
    const baseline = Number(paymentSettings.down_payment_amount_cents);
    if (!Number.isInteger(baseline) || baseline <= 0) {
      return { ok: false, error: "Defina o valor da entrada normal antes de ativar esta contrapartida." };
    }
    if (policy.higherDownPaymentMinimumType !== "fixed" || policy.higherDownPaymentMinimumAmountCents == null) {
      return { ok: false, error: "A contrapartida deve usar valor fixo, igual Ã  entrada normal da loja." };
    }
    if (policy.higherDownPaymentMinimumAmountCents <= baseline) {
      return { ok: false, error: "O valor da entrada da contrapartida deve ser maior que a entrada normal da loja." };
    }
    return { ok: true };
  }

  return { ok: false, error: "A entrada normal da loja estÃ¡ definida caso a caso e nÃ£o pode ser usada como base automÃ¡tica." };
}

export function createStoreDiscountCounterpartPolicyInputFromSources(
  row: StoreDiscountCounterpartPolicyRow | null | undefined,
): StoreDiscountCounterpartPolicyInput {
  if (!row) return createDefaultStoreDiscountCounterpartPolicyInput();
  return {
    enabled: row.enabled === true,
    allowedPaymentMethods: row.allowed_payment_methods ?? [],
    higherDownPaymentEnabled: row.higher_down_payment_enabled === true,
    higherDownPaymentMinimumType: row.higher_down_payment_minimum_type ?? "",
    higherDownPaymentMinimumPercent: row.higher_down_payment_minimum_percent == null ? "" : String(row.higher_down_payment_minimum_percent),
    higherDownPaymentMinimumAmount: row.higher_down_payment_minimum_amount_cents == null ? "" : String(row.higher_down_payment_minimum_amount_cents / 100),
    fewerInstallmentsEnabled: row.fewer_installments_enabled === true,
    fewerInstallmentsMaxCount: row.fewer_installments_max_count == null ? "" : String(row.fewer_installments_max_count),
  };
}

export function normalizeStoreDiscountCounterpartPolicyRow(
  row: StoreDiscountCounterpartPolicyRow,
): NormalizedStoreDiscountCounterpartPolicy | null {
  const result = normalizeStoreDiscountCounterpartPolicyInput(
    createStoreDiscountCounterpartPolicyInputFromSources(row),
  );
  return result.ok ? result.value : null;
}
