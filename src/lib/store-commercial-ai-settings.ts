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

export type StoreCommercialAiPriceAnswerPolicy =
  (typeof STORE_COMMERCIAL_AI_PRICE_ANSWER_POLICY_VALUES)[number];

export type StoreCommercialAiPriceContextRequirement =
  (typeof STORE_COMMERCIAL_AI_PRICE_CONTEXT_REQUIREMENT_VALUES)[number];

export type StoreCommercialAiSettingsRow = {
  organization_id: string;
  store_id: string;
  price_answer_policy: string | null;
  price_context_requirements: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type StoreCommercialAiSettingsInput = {
  priceAnswerPolicy: string;
  priceContextRequirements: string[];
};

export type NormalizedStoreCommercialAiSettingsInput = {
  priceAnswerPolicy: StoreCommercialAiPriceAnswerPolicy;
  priceContextRequirements: StoreCommercialAiPriceContextRequirement[];
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
  };
}

export function createStoreCommercialAiSettingsInputFromSources(args: {
  answers?: Record<string, unknown> | null;
  settings?: StoreCommercialAiSettingsRow | null;
}): StoreCommercialAiSettingsInput {
  const settings = args.settings ?? null;
  const answers = args.answers ?? {};
  const canonicalPolicy = coercePriceAnswerPolicy(
    settings?.price_answer_policy,
  );
  const legacyPolicy = inferStoreCommercialAiPriceAnswerPolicyFromLegacy(
    answers,
  );

  return {
    priceAnswerPolicy:
      canonicalPolicy ||
      legacyPolicy ||
      createDefaultStoreCommercialAiSettingsInput().priceAnswerPolicy,
    priceContextRequirements: coerceStoreCommercialAiPriceContextRequirements(
      settings
        ? settings.price_context_requirements
        : answers.price_must_understand_before ?? answers.price_direct_conditions,
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

  return {
    ok: true,
    value: {
      priceAnswerPolicy,
      priceContextRequirements:
        coerceStoreCommercialAiPriceContextRequirements(
          input.priceContextRequirements,
        ),
    },
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
