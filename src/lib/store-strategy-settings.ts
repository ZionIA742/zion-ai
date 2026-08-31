export const STORE_STRATEGY_SERVICE_VALUES = [
  "venda_piscinas",
  "instalacao_piscinas",
  "venda_produtos_quimicos",
  "venda_acessorios",
  "visita_tecnica",
  "manutencao",
] as const;

export const STORE_STRATEGY_REGION_MODE_VALUES = [
  "somente_cidade_loja",
  "cidade_e_vizinhas",
  "grande_regiao",
  "todo_estado",
  "sob_consulta",
] as const;

export const STORE_STRATEGY_PRIMARY_REGION_MODE_VALUES =
  STORE_STRATEGY_REGION_MODE_VALUES.filter(
    (value) => value !== "sob_consulta",
  ) as readonly string[];

export type StoreStrategyServiceValue =
  (typeof STORE_STRATEGY_SERVICE_VALUES)[number];

export type StoreStrategyRegionModeValue =
  (typeof STORE_STRATEGY_REGION_MODE_VALUES)[number];

export type StoreStrategyPrimaryRegionModeValue =
  (typeof STORE_STRATEGY_PRIMARY_REGION_MODE_VALUES)[number];

export type StoreStrategySettingsRow = {
  organization_id: string;
  store_id: string;
  city: string | null;
  state: string | null;
  service_regions: string | null;
  service_region_modes: string[] | null;
  service_region_primary_mode: string | null;
  service_region_outside_consultation: boolean | null;
  service_region_notes: string | null;
  store_services: string[] | null;
  store_services_other: string | null;
  store_description: string | null;
  main_store_brand: string | null;
  brands_worked: string | null;
  strategy_service_exclusions: string | null;
  strategy_primary_focus: string | null;
  strategy_sell_more: string | null;
  strategy_common_customer: string | null;
  strategy_ideal_customer: string | null;
  strategy_ticket_range: string | null;
  strategy_positioning: string | null;
  strategy_priority_brands: string | null;
  strategy_non_worked_brands: string | null;
  strategy_top_lines: string | null;
  strategy_top_products: string | null;
  strategy_differentials: string | null;
  strategy_promise_limits: string | null;
  strategy_ai_presentation: string | null;
  strategy_ai_priorities: string | null;
  strategy_ai_never_forget: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type StoreStrategySettingsInput = {
  city: string;
  state: string;
  serviceRegions: string;
  serviceRegionModes: string[];
  serviceRegionPrimaryMode: string;
  serviceRegionOutsideConsultation: boolean;
  serviceRegionNotes: string;
  storeServices: string[];
  storeServicesOther: string;
  storeDescription: string;
  mainStoreBrand: string;
  brandsWorked: string;
  strategyServiceExclusions: string;
  strategyPrimaryFocus: string;
  strategySellMore: string;
  strategyCommonCustomer: string;
  strategyIdealCustomer: string;
  strategyTicketRange: string;
  strategyPositioning: string;
  strategyPriorityBrands: string;
  strategyNonWorkedBrands: string;
  strategyTopLines: string;
  strategyTopProducts: string;
  strategyDifferentials: string;
  strategyPromiseLimits: string;
  strategyAiPresentation: string;
  strategyAiPriorities: string;
  strategyAiNeverForget: string;
};

export type NormalizedStoreStrategySettingsInput = {
  city: string | null;
  state: string | null;
  serviceRegions: string | null;
  serviceRegionModes: StoreStrategyRegionModeValue[];
  serviceRegionPrimaryMode: StoreStrategyPrimaryRegionModeValue | null;
  serviceRegionOutsideConsultation: boolean;
  serviceRegionNotes: string | null;
  storeServices: StoreStrategyServiceValue[];
  storeServicesOther: string | null;
  storeDescription: string | null;
  mainStoreBrand: string | null;
  brandsWorked: string | null;
  strategyServiceExclusions: string | null;
  strategyPrimaryFocus: string | null;
  strategySellMore: string | null;
  strategyCommonCustomer: string | null;
  strategyIdealCustomer: string | null;
  strategyTicketRange: string | null;
  strategyPositioning: string | null;
  strategyPriorityBrands: string | null;
  strategyNonWorkedBrands: string | null;
  strategyTopLines: string | null;
  strategyTopProducts: string | null;
  strategyDifferentials: string | null;
  strategyPromiseLimits: string | null;
  strategyAiPresentation: string | null;
  strategyAiPriorities: string | null;
  strategyAiNeverForget: string | null;
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

function isAllowedValue<T extends readonly string[]>(
  values: T,
  candidate: string,
): candidate is T[number] {
  return (values as readonly string[]).includes(candidate);
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item)).filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    if (
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => cleanText(item)).filter(Boolean);
        }
      } catch {}
    }

    return trimmed
      .split(",")
      .map((item) => item.replace(/^[\[\]"]+|[\[\]"]+$/g, "").trim())
      .filter(Boolean);
  }

  return [];
}

function parseBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  const normalized = normalizeText(value);
  if (["sim", "true", "1"].includes(normalized)) return true;
  if (["nao", "não", "false", "0"].includes(normalized)) return false;
  return fallback;
}

export function coerceStoreStrategyServices(
  value: unknown,
): StoreStrategyServiceValue[] {
  return uniqueStrings(
    parseStringArray(value).filter((candidate) =>
      isAllowedValue(STORE_STRATEGY_SERVICE_VALUES, candidate),
    ),
  ) as StoreStrategyServiceValue[];
}

export function coerceStoreStrategyRegionModes(
  value: unknown,
): StoreStrategyRegionModeValue[] {
  return uniqueStrings(
    parseStringArray(value).filter((candidate) =>
      isAllowedValue(STORE_STRATEGY_REGION_MODE_VALUES, candidate),
    ),
  ) as StoreStrategyRegionModeValue[];
}

function coercePrimaryRegionMode(
  value: unknown,
): StoreStrategyPrimaryRegionModeValue | null {
  const candidate = cleanText(value);
  if (!candidate) return null;
  if (!isAllowedValue(STORE_STRATEGY_PRIMARY_REGION_MODE_VALUES, candidate)) {
    return null;
  }
  return candidate as StoreStrategyPrimaryRegionModeValue;
}

export function createDefaultStoreStrategySettingsInput(): StoreStrategySettingsInput {
  return {
    city: "",
    state: "",
    serviceRegions: "",
    serviceRegionModes: [],
    serviceRegionPrimaryMode: "",
    serviceRegionOutsideConsultation: false,
    serviceRegionNotes: "",
    storeServices: [],
    storeServicesOther: "",
    storeDescription: "",
    mainStoreBrand: "",
    brandsWorked: "",
    strategyServiceExclusions: "",
    strategyPrimaryFocus: "",
    strategySellMore: "",
    strategyCommonCustomer: "",
    strategyIdealCustomer: "",
    strategyTicketRange: "",
    strategyPositioning: "",
    strategyPriorityBrands: "",
    strategyNonWorkedBrands: "",
    strategyTopLines: "",
    strategyTopProducts: "",
    strategyDifferentials: "",
    strategyPromiseLimits: "",
    strategyAiPresentation: "",
    strategyAiPriorities: "",
    strategyAiNeverForget: "",
  };
}

export function createStoreStrategySettingsInputFromSources(args: {
  answers?: Record<string, unknown> | null;
  settings?: StoreStrategySettingsRow | null;
}): StoreStrategySettingsInput {
  const answers = args.answers ?? {};
  const settings = args.settings ?? null;
  const defaults = createDefaultStoreStrategySettingsInput();

  if (settings) {
    const serviceRegionModes = coerceStoreStrategyRegionModes(
      settings.service_region_modes,
    );
    const serviceRegionPrimaryMode =
      coercePrimaryRegionMode(settings.service_region_primary_mode) ||
      (serviceRegionModes.find(
        (value) => value !== "sob_consulta",
      ) as StoreStrategyPrimaryRegionModeValue | undefined) ||
      null;

    return {
      city: cleanText(settings.city) || defaults.city,
      state: cleanText(settings.state) || defaults.state,
      serviceRegions:
        cleanText(settings.service_regions) || defaults.serviceRegions,
      serviceRegionModes,
      serviceRegionPrimaryMode:
        serviceRegionPrimaryMode || defaults.serviceRegionPrimaryMode,
      serviceRegionOutsideConsultation:
        settings.service_region_outside_consultation === true ||
        serviceRegionModes.includes("sob_consulta"),
      serviceRegionNotes:
        cleanText(settings.service_region_notes) || defaults.serviceRegionNotes,
      storeServices: coerceStoreStrategyServices(settings.store_services),
      storeServicesOther:
        cleanText(settings.store_services_other) || defaults.storeServicesOther,
      storeDescription:
        cleanText(settings.store_description) || defaults.storeDescription,
      mainStoreBrand:
        cleanText(settings.main_store_brand) || defaults.mainStoreBrand,
      brandsWorked: cleanText(settings.brands_worked) || defaults.brandsWorked,
      strategyServiceExclusions:
        cleanText(settings.strategy_service_exclusions) ||
        defaults.strategyServiceExclusions,
      strategyPrimaryFocus:
        cleanText(settings.strategy_primary_focus) ||
        defaults.strategyPrimaryFocus,
      strategySellMore:
        cleanText(settings.strategy_sell_more) || defaults.strategySellMore,
      strategyCommonCustomer:
        cleanText(settings.strategy_common_customer) ||
        defaults.strategyCommonCustomer,
      strategyIdealCustomer:
        cleanText(settings.strategy_ideal_customer) ||
        defaults.strategyIdealCustomer,
      strategyTicketRange:
        cleanText(settings.strategy_ticket_range) ||
        defaults.strategyTicketRange,
      strategyPositioning:
        cleanText(settings.strategy_positioning) ||
        defaults.strategyPositioning,
      strategyPriorityBrands:
        cleanText(settings.strategy_priority_brands) ||
        defaults.strategyPriorityBrands,
      strategyNonWorkedBrands:
        cleanText(settings.strategy_non_worked_brands) ||
        defaults.strategyNonWorkedBrands,
      strategyTopLines:
        cleanText(settings.strategy_top_lines) || defaults.strategyTopLines,
      strategyTopProducts:
        cleanText(settings.strategy_top_products) ||
        defaults.strategyTopProducts,
      strategyDifferentials:
        cleanText(settings.strategy_differentials) ||
        defaults.strategyDifferentials,
      strategyPromiseLimits:
        cleanText(settings.strategy_promise_limits) ||
        defaults.strategyPromiseLimits,
      strategyAiPresentation:
        cleanText(settings.strategy_ai_presentation) ||
        defaults.strategyAiPresentation,
      strategyAiPriorities:
        cleanText(settings.strategy_ai_priorities) ||
        defaults.strategyAiPriorities,
      strategyAiNeverForget:
        cleanText(settings.strategy_ai_never_forget) ||
        defaults.strategyAiNeverForget,
    };
  }

  const serviceRegionModes = coerceStoreStrategyRegionModes(
    answers.service_region_modes,
  );
  const serviceRegionPrimaryMode =
    coercePrimaryRegionMode(answers.service_region_primary_mode) ||
    (serviceRegionModes.find(
      (value) => value !== "sob_consulta",
    ) as StoreStrategyPrimaryRegionModeValue | undefined) ||
    null;

  return {
    city: cleanText(answers.city) || defaults.city,
    state: cleanText(answers.state) || defaults.state,
    serviceRegions: cleanText(answers.service_regions) || defaults.serviceRegions,
    serviceRegionModes,
    serviceRegionPrimaryMode:
      serviceRegionPrimaryMode || defaults.serviceRegionPrimaryMode,
    serviceRegionOutsideConsultation:
      parseBoolean(answers.service_region_outside_consultation, false) ||
      serviceRegionModes.includes("sob_consulta"),
    serviceRegionNotes:
      cleanText(answers.service_region_notes) || defaults.serviceRegionNotes,
    storeServices: coerceStoreStrategyServices(answers.store_services),
    storeServicesOther:
      cleanText(answers.store_services_other) || defaults.storeServicesOther,
    storeDescription:
      cleanText(answers.store_description) || defaults.storeDescription,
    mainStoreBrand:
      cleanText(answers.main_store_brand) || defaults.mainStoreBrand,
    brandsWorked: cleanText(answers.brands_worked) || defaults.brandsWorked,
    strategyServiceExclusions:
      cleanText(answers.strategy_service_exclusions) ||
      defaults.strategyServiceExclusions,
    strategyPrimaryFocus:
      cleanText(answers.strategy_primary_focus) || defaults.strategyPrimaryFocus,
    strategySellMore:
      cleanText(answers.strategy_sell_more) || defaults.strategySellMore,
    strategyCommonCustomer:
      cleanText(answers.strategy_common_customer) ||
      defaults.strategyCommonCustomer,
    strategyIdealCustomer:
      cleanText(answers.strategy_ideal_customer) ||
      defaults.strategyIdealCustomer,
    strategyTicketRange:
      cleanText(answers.strategy_ticket_range) || defaults.strategyTicketRange,
    strategyPositioning:
      cleanText(answers.strategy_positioning) || defaults.strategyPositioning,
    strategyPriorityBrands:
      cleanText(answers.strategy_priority_brands) ||
      defaults.strategyPriorityBrands,
    strategyNonWorkedBrands:
      cleanText(answers.strategy_non_worked_brands) ||
      defaults.strategyNonWorkedBrands,
    strategyTopLines:
      cleanText(answers.strategy_top_lines) || defaults.strategyTopLines,
    strategyTopProducts:
      cleanText(answers.strategy_top_products) || defaults.strategyTopProducts,
    strategyDifferentials:
      cleanText(answers.strategy_differentials) ||
      defaults.strategyDifferentials,
    strategyPromiseLimits:
      cleanText(answers.strategy_promise_limits) ||
      defaults.strategyPromiseLimits,
    strategyAiPresentation:
      cleanText(answers.strategy_ai_presentation) ||
      defaults.strategyAiPresentation,
    strategyAiPriorities:
      cleanText(answers.strategy_ai_priorities) ||
      defaults.strategyAiPriorities,
    strategyAiNeverForget:
      cleanText(answers.strategy_ai_never_forget) ||
      defaults.strategyAiNeverForget,
  };
}

export function normalizeStoreStrategySettingsInput(
  input: StoreStrategySettingsInput,
): { ok: true; value: NormalizedStoreStrategySettingsInput } {
  const serviceRegionPrimaryMode =
    coercePrimaryRegionMode(input.serviceRegionPrimaryMode) ||
    null;
  const serviceRegionModes = uniqueStrings([
    ...coerceStoreStrategyRegionModes(input.serviceRegionModes),
    ...(serviceRegionPrimaryMode ? [serviceRegionPrimaryMode] : []),
    ...(input.serviceRegionOutsideConsultation ? ["sob_consulta"] : []),
  ]) as StoreStrategyRegionModeValue[];

  return {
    ok: true,
    value: {
      city: cleanText(input.city) || null,
      state: cleanText(input.state) || null,
      serviceRegions: cleanText(input.serviceRegions) || null,
      serviceRegionModes,
      serviceRegionPrimaryMode,
      serviceRegionOutsideConsultation: Boolean(
        input.serviceRegionOutsideConsultation,
      ),
      serviceRegionNotes: cleanText(input.serviceRegionNotes) || null,
      storeServices: coerceStoreStrategyServices(input.storeServices),
      storeServicesOther: cleanText(input.storeServicesOther) || null,
      storeDescription: cleanText(input.storeDescription) || null,
      mainStoreBrand: cleanText(input.mainStoreBrand) || null,
      brandsWorked: cleanText(input.brandsWorked) || null,
      strategyServiceExclusions:
        cleanText(input.strategyServiceExclusions) || null,
      strategyPrimaryFocus: cleanText(input.strategyPrimaryFocus) || null,
      strategySellMore: cleanText(input.strategySellMore) || null,
      strategyCommonCustomer: cleanText(input.strategyCommonCustomer) || null,
      strategyIdealCustomer: cleanText(input.strategyIdealCustomer) || null,
      strategyTicketRange: cleanText(input.strategyTicketRange) || null,
      strategyPositioning: cleanText(input.strategyPositioning) || null,
      strategyPriorityBrands: cleanText(input.strategyPriorityBrands) || null,
      strategyNonWorkedBrands:
        cleanText(input.strategyNonWorkedBrands) || null,
      strategyTopLines: cleanText(input.strategyTopLines) || null,
      strategyTopProducts: cleanText(input.strategyTopProducts) || null,
      strategyDifferentials: cleanText(input.strategyDifferentials) || null,
      strategyPromiseLimits: cleanText(input.strategyPromiseLimits) || null,
      strategyAiPresentation:
        cleanText(input.strategyAiPresentation) || null,
      strategyAiPriorities: cleanText(input.strategyAiPriorities) || null,
      strategyAiNeverForget:
        cleanText(input.strategyAiNeverForget) || null,
    },
  };
}

export function deriveStoreStrategyAiStoreSummary(
  input: StoreStrategySettingsInput | NormalizedStoreStrategySettingsInput,
) {
  const serviceModes =
    "serviceRegionModes" in input
      ? input.serviceRegionModes
      : [];
  const storeServices = "storeServices" in input ? input.storeServices : [];

  const parts = [
    cleanText(input.storeDescription),
    cleanText(input.strategyPrimaryFocus),
    cleanText(input.strategyPositioning),
    cleanText(input.strategySellMore)
      ? `Vender mais: ${cleanText(input.strategySellMore)}`
      : "",
    cleanText(input.serviceRegions)
      ? `Regiao: ${cleanText(input.serviceRegions)}`
      : "",
    serviceModes.length > 0 ? `Cobertura: ${serviceModes.join(", ")}` : "",
    storeServices.length > 0 ? `Servicos: ${storeServices.join(", ")}` : "",
    cleanText(input.storeServicesOther)
      ? `Outros servicos: ${cleanText(input.storeServicesOther)}`
      : "",
    cleanText(input.mainStoreBrand)
      ? `Marca principal: ${cleanText(input.mainStoreBrand)}`
      : "",
    cleanText(input.strategyPriorityBrands)
      ? `Prioridades: ${cleanText(input.strategyPriorityBrands)}`
      : "",
    cleanText(input.strategyDifferentials)
      ? `Diferenciais: ${cleanText(input.strategyDifferentials)}`
      : "",
    cleanText(input.strategyPromiseLimits)
      ? `Limites: ${cleanText(input.strategyPromiseLimits)}`
      : "",
  ].filter(Boolean);

  return parts.join(" | ");
}
