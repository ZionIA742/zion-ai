export type ContractUsageApplicabilityMode = "sempre" | "depende" | "opcional";
export type ContractUsageFormat = "digital" | "fisico";
export type ContractBuyerDataField =
  | "full_name"
  | "cpf"
  | "rg"
  | "address"
  | "phone"
  | "email"
  | "other";
export type ContractUsageSignedBefore =
  | "encomendar"
  | "agendar_instalacao"
  | "iniciar_instalacao"
  | "entrega"
  | "retirada"
  | "outro";

export type StoreContractUsagePolicy = {
  state: "enabled" | "disabled" | "unconfigured" | "incomplete";
  enabled: boolean | null;
  applicabilityMode: ContractUsageApplicabilityMode | null;
  applicabilityCases: string[];
  applicabilityOther: string | null;
  highValueAmount: string | null;
  formats: ContractUsageFormat[];
  signedBefore: ContractUsageSignedBefore[];
  signedBeforeOther: string | null;
  buyerDataFieldsConfigured: boolean;
  buyerDataFields: ContractBuyerDataField[];
  buyerDataOther: string | null;
  notes: string | null;
};

export type ContractUsagePolicyReaderResult =
  | { ok: true; policy: StoreContractUsagePolicy }
  | { ok: false; error: string };

const APPLICABILITY_CASES = new Set([
  "piscina",
  "instalacao",
  "servico",
  "sob_encomenda",
  "financiamento",
  "alto_valor",
  "outro",
]);
const FORMATS = new Set<ContractUsageFormat>(["digital", "fisico"]);
const SIGNED_BEFORE = new Set<ContractUsageSignedBefore>([
  "encomendar",
  "agendar_instalacao",
  "iniciar_instalacao",
  "entrega",
  "retirada",
  "outro",
]);
const BUYER_DATA_FIELDS = new Set<ContractBuyerDataField>([
  "full_name",
  "cpf",
  "rg",
  "address",
  "phone",
  "email",
  "other",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
  const result = String(value ?? "").trim();
  return result || null;
}

function choice(value: unknown): string | null {
  return text(value)?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() || null;
}

function emptyPolicy(state: StoreContractUsagePolicy["state"]): StoreContractUsagePolicy {
  return {
    state,
    enabled: state === "disabled" ? false : state === "enabled" ? true : null,
    applicabilityMode: null,
    applicabilityCases: [],
    applicabilityOther: null,
    highValueAmount: null,
    formats: [],
    signedBefore: [],
    signedBeforeOther: null,
    buyerDataFieldsConfigured: false,
    buyerDataFields: [],
    buyerDataOther: null,
    notes: null,
  };
}

export function normalizeStoreContractUsagePolicy(value: unknown): StoreContractUsagePolicy {
  if (!isRecord(value) || Object.keys(value).length === 0) return emptyPolicy("unconfigured");

  const enabledChoice = choice(value.enabled);
  if (enabledChoice === "nao" || enabledChoice === "nÃ£o") return emptyPolicy("disabled");
  if (enabledChoice !== "sim") return emptyPolicy("incomplete");

  const mode = choice(value.applicability_mode) as ContractUsageApplicabilityMode | null;
  const cases = Array.isArray(value.applicability_cases)
    ? value.applicability_cases.filter((item): item is string => typeof item === "string" && APPLICABILITY_CASES.has(item))
    : [];
  const formats = Array.isArray(value.formats)
    ? value.formats.filter((item): item is ContractUsageFormat => typeof item === "string" && FORMATS.has(item as ContractUsageFormat))
    : [];
  const signedBefore = Array.isArray(value.signed_before)
    ? value.signed_before.filter((item): item is ContractUsageSignedBefore => typeof item === "string" && SIGNED_BEFORE.has(item as ContractUsageSignedBefore))
    : [];
  const buyerDataFieldsConfigured = value.buyer_data_fields_configured === true;
  const rawBuyerDataFields = value.buyer_data_fields;
  const buyerDataFields = Array.isArray(rawBuyerDataFields)
    ? Array.from(new Set(rawBuyerDataFields.filter((item): item is ContractBuyerDataField => typeof item === "string" && BUYER_DATA_FIELDS.has(item as ContractBuyerDataField))))
    : [];
  const buyerDataOtherText = text(value.buyer_data_other);
  const hasInvalidBuyerDataField =
    buyerDataFieldsConfigured &&
    (!Array.isArray(rawBuyerDataFields) ||
      rawBuyerDataFields.some(
        (item) => typeof item !== "string" || !BUYER_DATA_FIELDS.has(item as ContractBuyerDataField),
      ) ||
      (buyerDataOtherText !== null && buyerDataOtherText.length > 500) ||
      (buyerDataFields.includes("other") && !buyerDataOtherText));
  const buyerDataOther = buyerDataFields.includes("other")
    ? buyerDataOtherText?.slice(0, 500) || null
    : null;

  if (hasInvalidBuyerDataField) return emptyPolicy("incomplete");
  const applicabilityOther = text(value.applicability_other);
  const highValueAmount = text(value.high_value_amount);
  const signedBeforeOther = text(value.signed_before_other);
  const validMode = mode === "sempre" || mode === "depende" || mode === "opcional";
  const validCases = mode === "depende" && cases.length > 0 &&
    (cases.includes("outro") ? Boolean(applicabilityOther) : !applicabilityOther) &&
    (cases.includes("alto_valor") ? Boolean(highValueAmount) : !highValueAmount);
  const validAlwaysOrOptional = (mode === "sempre" || mode === "opcional") && cases.length === 0 && !applicabilityOther && !highValueAmount;
  const validFormats = formats.length > 0;
  const validSignedBefore = signedBefore.length > 0 &&
    (signedBefore.includes("outro") ? Boolean(signedBeforeOther) : !signedBeforeOther);

  if (!validMode || (!validCases && !validAlwaysOrOptional) || !validFormats || !validSignedBefore) {
    return emptyPolicy("incomplete");
  }

  return {
    state: "enabled",
    enabled: true,
    applicabilityMode: mode,
    applicabilityCases: cases,
    applicabilityOther,
    highValueAmount,
    formats,
    signedBefore,
    signedBeforeOther,
    buyerDataFieldsConfigured,
    buyerDataFields,
    buyerDataOther,
    notes: text(value.notes),
  };
}

export async function readStoreContractUsagePolicyBySystem(args: {
  supabase: { rpc: (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
  organizationId: string;
  storeId: string;
}): Promise<ContractUsagePolicyReaderResult> {
  const { data, error } = await args.supabase.rpc("read_store_settings_experience_policies_scoped", {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
  });
  if (error) return { ok: false, error: error.message };

  const rows = data == null ? [] : Array.isArray(data) ? data : [data];
  if (rows.length > 1) return { ok: false, error: "Reader canonico retornou mais de uma politica contratual." };
  return { ok: true, policy: normalizeStoreContractUsagePolicy(isRecord(rows[0]) ? rows[0].contract_usage_policy : null) };
}
