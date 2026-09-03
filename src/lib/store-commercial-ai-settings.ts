export const STORE_COMMERCIAL_AI_PRICE_ANSWER_POLICY_VALUES = [
  "direct_when_asked",
  "range_only_when_asked",
  "human_required_for_price",
] as const;

export const STORE_COMMERCIAL_AI_PRICE_CONTEXT_REQUIREMENT_VALUES = [
  "need_summary",
  "interested_product_reference",
  "space_or_measurements",
  "installation_scope",
] as const;

export const STORE_COMMERCIAL_AI_COMPLEMENTARY_SCOPE_MODE_VALUES = [
  "all_compatible",
  "selected_scope",
] as const;

export const STORE_COMMERCIAL_AI_COMPLEMENTARY_ALLOWED_MOMENT_VALUES = [
  "after_need_understood",
  "after_product_interest",
  "during_proposal_preparation",
  "customer_asks_what_else_needed",
] as const;

export const STORE_COMMERCIAL_AI_SUPERIOR_ALLOWED_TRIGGER_VALUES = [
  "more_suitable_alternative",
  "customer_requests_better_option",
  "materially_relevant_advantage",
] as const;

export type StoreCommercialAiPriceAnswerPolicy =
  (typeof STORE_COMMERCIAL_AI_PRICE_ANSWER_POLICY_VALUES)[number];

export type StoreCommercialAiPriceContextRequirement =
  (typeof STORE_COMMERCIAL_AI_PRICE_CONTEXT_REQUIREMENT_VALUES)[number];

export type StoreCommercialAiComplementaryScopeMode =
  (typeof STORE_COMMERCIAL_AI_COMPLEMENTARY_SCOPE_MODE_VALUES)[number];

export type StoreCommercialAiComplementaryAllowedMoment =
  (typeof STORE_COMMERCIAL_AI_COMPLEMENTARY_ALLOWED_MOMENT_VALUES)[number];

export type StoreCommercialAiSuperiorAllowedTrigger =
  (typeof STORE_COMMERCIAL_AI_SUPERIOR_ALLOWED_TRIGGER_VALUES)[number];

export type StoreCommercialAiSettingsRow = {
  organization_id: string;
  store_id: string;
  price_answer_policy: string | null;
  price_context_requirements: string[] | null;
  complementary_suggestions_enabled?: boolean | null;
  complementary_scope_mode?: string | null;
  complementary_category_keys?: string[] | null;
  complementary_line_keys?: string[] | null;
  complementary_allowed_moments?: string[] | null;
  superior_option_suggestions_enabled?: boolean | null;
  superior_option_allowed_triggers?: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type StoreCommercialAiSettingsInput = {
  priceAnswerPolicy: string;
  priceContextRequirements: string[];
  complementarySuggestionsEnabled?: boolean;
  complementaryScopeMode?: string;
  complementaryCategoryKeys?: string[];
  complementaryLineKeys?: string[];
  complementaryAllowedMoments?: string[];
  superiorOptionSuggestionsEnabled?: boolean;
  superiorOptionAllowedTriggers?: string[];
};

export type NormalizedStoreCommercialAiSettingsInput = {
  priceAnswerPolicy: StoreCommercialAiPriceAnswerPolicy;
  priceContextRequirements: StoreCommercialAiPriceContextRequirement[];
  complementarySuggestionsEnabled: boolean;
  complementaryScopeMode: StoreCommercialAiComplementaryScopeMode;
  complementaryCategoryKeys: string[];
  complementaryLineKeys: string[];
  complementaryAllowedMoments: StoreCommercialAiComplementaryAllowedMoment[];
  superiorOptionSuggestionsEnabled: boolean;
  superiorOptionAllowedTriggers: StoreCommercialAiSuperiorAllowedTrigger[];
};

export type CommercialSuggestionPolicy = {
  allowProactiveComplementarySuggestions: boolean;
  complementaryScopeMode: StoreCommercialAiComplementaryScopeMode;
  allowedComplementaryCategoryKeys: string[];
  allowedComplementaryLineKeys: string[];
  allowedComplementaryMoments: StoreCommercialAiComplementaryAllowedMoment[];
  allowProactiveSuperiorOptionSuggestions: boolean;
  allowedSuperiorTriggers: StoreCommercialAiSuperiorAllowedTrigger[];
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeText(value: unknown) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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

function coerceBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  const normalized = normalizeText(value);
  if (normalized === "sim" || normalized === "true" || normalized === "1") {
    return true;
  }
  if (
    normalized === "nao" ||
    normalized === "não" ||
    normalized === "false" ||
    normalized === "0"
  ) {
    return false;
  }
  return fallback;
}

function asYesNo(value: unknown): "sim" | "nao" | null {
  if (typeof value === "boolean") return value ? "sim" : "nao";
  const normalized = normalizeText(value);
  if (normalized === "sim" || normalized === "true" || normalized === "1") {
    return "sim";
  }
  if (
    normalized === "nao" ||
    normalized === "não" ||
    normalized === "false" ||
    normalized === "0"
  ) {
    return "nao";
  }
  return null;
}

function coercePriceAnswerPolicy(
  value: unknown,
): StoreCommercialAiPriceAnswerPolicy | null {
  const candidate = cleanText(value);
  return isAllowedValue(
    STORE_COMMERCIAL_AI_PRICE_ANSWER_POLICY_VALUES,
    candidate,
  )
    ? candidate
    : null;
}

export function coerceStoreCommercialAiPriceContextRequirements(
  value: unknown,
): StoreCommercialAiPriceContextRequirement[] {
  const mapped = parseStringArray(value)
    .map((item) => {
      const normalized = normalizeText(item);
      if (normalized === "so_apos_entender_objetivo") return "need_summary";
      if (normalized === "so_apos_entender_tipo") {
        return "interested_product_reference";
      }
      if (normalized === "so_apos_entender_medidas") {
        return "space_or_measurements";
      }
      if (normalized === "so_apos_entender_instalacao") {
        return "installation_scope";
      }
      if (
        isAllowedValue(
          STORE_COMMERCIAL_AI_PRICE_CONTEXT_REQUIREMENT_VALUES,
          normalized,
        )
      ) {
        return normalized;
      }
      return "";
    })
    .filter(Boolean);

  return uniqueStrings(mapped) as StoreCommercialAiPriceContextRequirement[];
}

function coerceStoreCommercialAiComplementaryScopeMode(
  value: unknown,
): StoreCommercialAiComplementaryScopeMode {
  const normalized = normalizeText(value);
  if (normalized === "selected_categories") return "selected_scope";
  return isAllowedValue(
    STORE_COMMERCIAL_AI_COMPLEMENTARY_SCOPE_MODE_VALUES,
    normalized,
  )
    ? normalized
    : "all_compatible";
}

export function coerceStoreCommercialAiComplementaryCategoryKeys(
  value: unknown,
): string[] {
  return uniqueStrings(
    parseStringArray(value)
      .map((item) => normalizeText(item).replace(/[^a-z0-9_-]/g, "_"))
      .map((item) => item.replace(/_+/g, "_").replace(/^_+|_+$/g, ""))
      .filter(Boolean),
  );
}

export const coerceStoreCommercialAiComplementaryLineKeys =
  coerceStoreCommercialAiComplementaryCategoryKeys;

export function coerceStoreCommercialAiComplementaryAllowedMoments(
  value: unknown,
): StoreCommercialAiComplementaryAllowedMoment[] {
  return uniqueStrings(
    parseStringArray(value)
      .map((item) => normalizeText(item))
      .filter((item) =>
        isAllowedValue(
          STORE_COMMERCIAL_AI_COMPLEMENTARY_ALLOWED_MOMENT_VALUES,
          item,
        ),
      ),
  ) as StoreCommercialAiComplementaryAllowedMoment[];
}

export function coerceStoreCommercialAiSuperiorAllowedTriggers(
  value: unknown,
): StoreCommercialAiSuperiorAllowedTrigger[] {
  return uniqueStrings(
    parseStringArray(value)
      .map((item) => normalizeText(item))
      .filter((item) =>
        isAllowedValue(
          STORE_COMMERCIAL_AI_SUPERIOR_ALLOWED_TRIGGER_VALUES,
          item,
        ),
      ),
  ) as StoreCommercialAiSuperiorAllowedTrigger[];
}

export function inferStoreCommercialAiPriceAnswerPolicyFromLegacy(
  answers: Record<string, unknown> | null | undefined,
): StoreCommercialAiPriceAnswerPolicy | null {
  const source = answers ?? {};
  const direct = asYesNo(source.ai_can_send_price_directly);
  const humanHelp = asYesNo(source.price_needs_human_help);
  const mode = normalizeText(source.price_talk_mode);

  if (
    direct === "nao" ||
    humanHelp === "sim" ||
    mode === "nao_falar_sozinha"
  ) {
    return "human_required_for_price";
  }

  if (direct === "sim" && humanHelp === "nao") {
    if (mode === "apenas_faixa_inicial") return "range_only_when_asked";
    if (mode === "quando_cliente_perguntar") return "direct_when_asked";
  }

  return null;
}

export function createDefaultStoreCommercialAiSettingsInput(): StoreCommercialAiSettingsInput {
  return {
    priceAnswerPolicy: "human_required_for_price",
    priceContextRequirements: [],
    complementarySuggestionsEnabled: false,
    complementaryScopeMode: "all_compatible",
    complementaryCategoryKeys: [],
    complementaryLineKeys: [],
    complementaryAllowedMoments: [],
    superiorOptionSuggestionsEnabled: false,
    superiorOptionAllowedTriggers: [],
  };
}

export function createStoreCommercialAiSettingsInputFromSources(args: {
  answers?: Record<string, unknown> | null;
  settings?: StoreCommercialAiSettingsRow | null;
}): StoreCommercialAiSettingsInput {
  const settings = args.settings ?? null;
  const canonicalPolicy = coercePriceAnswerPolicy(
    settings?.price_answer_policy,
  );

  return {
    priceAnswerPolicy:
      canonicalPolicy ||
      createDefaultStoreCommercialAiSettingsInput().priceAnswerPolicy,
    priceContextRequirements: coerceStoreCommercialAiPriceContextRequirements(
      settings ? settings.price_context_requirements : [],
    ),
    complementarySuggestionsEnabled: coerceBoolean(
      settings?.complementary_suggestions_enabled,
      false,
    ),
    complementaryScopeMode: coerceStoreCommercialAiComplementaryScopeMode(
      settings?.complementary_scope_mode,
    ),
    complementaryCategoryKeys: coerceStoreCommercialAiComplementaryCategoryKeys(
      settings?.complementary_category_keys,
    ),
    complementaryLineKeys: coerceStoreCommercialAiComplementaryLineKeys(
      settings?.complementary_line_keys,
    ),
    complementaryAllowedMoments:
      coerceStoreCommercialAiComplementaryAllowedMoments(
        settings?.complementary_allowed_moments,
      ),
    superiorOptionSuggestionsEnabled: coerceBoolean(
      settings?.superior_option_suggestions_enabled,
      false,
    ),
    superiorOptionAllowedTriggers:
      coerceStoreCommercialAiSuperiorAllowedTriggers(
        settings?.superior_option_allowed_triggers,
      ),
  };
}

export function normalizeStoreCommercialAiSettingsInput(
  input: StoreCommercialAiSettingsInput,
):
  | { ok: true; value: NormalizedStoreCommercialAiSettingsInput }
  | { ok: false; error: string } {
  const priceAnswerPolicy = coercePriceAnswerPolicy(input.priceAnswerPolicy);
  if (!priceAnswerPolicy) {
    return { ok: false, error: "Politica de resposta de preco invalida." };
  }

  const complementarySuggestionsEnabled = coerceBoolean(
    input.complementarySuggestionsEnabled,
    false,
  );
  const complementaryScopeMode = coerceStoreCommercialAiComplementaryScopeMode(
    input.complementaryScopeMode,
  );
  const complementaryCategoryKeys =
    coerceStoreCommercialAiComplementaryCategoryKeys(
    input.complementaryCategoryKeys,
    );
  const complementaryLineKeys =
    coerceStoreCommercialAiComplementaryLineKeys(input.complementaryLineKeys);
  const complementaryAllowedMoments =
    coerceStoreCommercialAiComplementaryAllowedMoments(
      input.complementaryAllowedMoments,
    );
  const superiorOptionSuggestionsEnabled = coerceBoolean(
    input.superiorOptionSuggestionsEnabled,
    false,
  );
  const superiorOptionAllowedTriggers =
    coerceStoreCommercialAiSuperiorAllowedTriggers(
      input.superiorOptionAllowedTriggers,
    );

  if (
    complementarySuggestionsEnabled &&
    complementaryScopeMode === "selected_scope" &&
    complementaryCategoryKeys.length === 0 &&
    complementaryLineKeys.length === 0
  ) {
    return {
      ok: false,
      error:
        "Selecione ao menos uma categoria ou linha para sugestoes complementares.",
    };
  }

  return {
    ok: true,
    value: {
      priceAnswerPolicy,
      priceContextRequirements:
        coerceStoreCommercialAiPriceContextRequirements(
          input.priceContextRequirements,
        ),
      complementarySuggestionsEnabled,
      complementaryScopeMode: complementarySuggestionsEnabled
        ? complementaryScopeMode
        : "all_compatible",
      complementaryCategoryKeys: complementarySuggestionsEnabled
        ? complementaryCategoryKeys
        : [],
      complementaryLineKeys: complementarySuggestionsEnabled
        ? complementaryLineKeys
        : [],
      complementaryAllowedMoments: complementarySuggestionsEnabled
        ? complementaryAllowedMoments
        : [],
      superiorOptionSuggestionsEnabled,
      superiorOptionAllowedTriggers: superiorOptionSuggestionsEnabled
        ? superiorOptionAllowedTriggers
        : [],
    },
  };
}

export function buildCommercialSuggestionPolicy(
  input: NormalizedStoreCommercialAiSettingsInput,
): CommercialSuggestionPolicy {
  return {
    allowProactiveComplementarySuggestions:
      input.complementarySuggestionsEnabled,
    complementaryScopeMode: input.complementaryScopeMode,
    allowedComplementaryCategoryKeys: input.complementaryCategoryKeys,
    allowedComplementaryLineKeys: input.complementaryLineKeys,
    allowedComplementaryMoments: input.complementaryAllowedMoments,
    allowProactiveSuperiorOptionSuggestions:
      input.superiorOptionSuggestionsEnabled,
    allowedSuperiorTriggers: input.superiorOptionAllowedTriggers,
  };
}

export function deriveStoreCommercialAiLegacyMirrors(
  input: NormalizedStoreCommercialAiSettingsInput,
) {
  const priceTalkMode =
    input.priceAnswerPolicy === "range_only_when_asked"
      ? "apenas_faixa_inicial"
      : input.priceAnswerPolicy === "human_required_for_price"
        ? "nao_falar_sozinha"
        : "quando_cliente_perguntar";
  const aiCanSendPriceDirectly =
    input.priceAnswerPolicy === "human_required_for_price" ? false : true;
  const priceNeedsHumanHelp =
    input.priceAnswerPolicy === "human_required_for_price" ? "sim" : "nao";
  const legacyRequirements = input.priceContextRequirements.map((value) => {
    if (value === "need_summary") return "so_apos_entender_objetivo";
    if (value === "interested_product_reference") {
      return "so_apos_entender_tipo";
    }
    if (value === "space_or_measurements") return "so_apos_entender_medidas";
    return "so_apos_entender_instalacao";
  });
  const policyLabel =
    input.priceAnswerPolicy === "range_only_when_asked"
      ? "Pode falar so uma faixa inicial, nao valor fechado"
      : input.priceAnswerPolicy === "human_required_for_price"
        ? "Nao deve falar preco sozinha"
        : "Pode falar preco quando o cliente perguntar";
  const requirementLabelByValue: Record<
    StoreCommercialAiPriceContextRequirement,
    string
  > = {
    need_summary: "So depois de entender o que o cliente quer",
    interested_product_reference:
      "So depois de entender o tipo de piscina ou produto",
    space_or_measurements:
      "So depois de entender medidas ou porte do projeto",
    installation_scope: "So depois de entender se precisa instalacao",
  };
  const requirementText = input.priceContextRequirements
    .map((value) => requirementLabelByValue[value])
    .join(", ");
  const priceDirectRule =
    input.priceAnswerPolicy === "human_required_for_price"
      ? "A IA nao pode falar preco sem chamar uma pessoa da loja."
      : [
          requirementText,
          policyLabel,
          "Nao precisa de ajuda humana para falar preco na regra normal.",
        ]
          .filter(Boolean)
          .join(" | ");

  return {
    price_talk_mode: priceTalkMode,
    ai_can_send_price_directly: aiCanSendPriceDirectly,
    price_needs_human_help: priceNeedsHumanHelp,
    price_must_understand_before: legacyRequirements,
    price_direct_conditions: [
      ...legacyRequirements,
      priceTalkMode,
      ...(priceNeedsHumanHelp === "sim" ? ["nunca_sem_chamar_humano"] : []),
    ],
    price_direct_rule: priceDirectRule,
  };
}
