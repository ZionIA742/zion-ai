export type StoreBrandVisualPolicy = {
  configured: boolean;
  useLogoOnQuotes: boolean | null;
  useLogoOnContracts: boolean | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  documentFooter: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeChoice(value: unknown) {
  if (value === "Sim") {
    return true;
  }

  if (value === "Não") {
    return false;
  }

  return null;
}

function normalizeHexColor(value: unknown) {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    return null;
  }

  return /^#[0-9a-fA-F]{6}$/.test(normalized)
    ? normalized.toUpperCase()
    : null;
}

function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function normalizeStoreBrandVisualPolicy(
  value: unknown
): StoreBrandVisualPolicy {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    return {
      configured: false,
      useLogoOnQuotes: null,
      useLogoOnContracts: null,
      primaryColor: null,
      secondaryColor: null,
      documentFooter: null,
    };
  }

  const useLogoOnQuotes = normalizeChoice(value.use_logo_on_quotes);
  const useLogoOnContracts = normalizeChoice(value.use_logo_on_contracts);
  const primaryColor = normalizeHexColor(value.primary_color);

  const secondaryRaw = String(value.secondary_color ?? "").trim();
  const secondaryColor = secondaryRaw
    ? normalizeHexColor(secondaryRaw)
    : null;

  if (
    useLogoOnQuotes === null ||
    useLogoOnContracts === null ||
    primaryColor === null ||
    (secondaryRaw && secondaryColor === null)
  ) {
    throw new Error("brand_visual_policy canonica invalida");
  }

  return {
    configured: true,
    useLogoOnQuotes,
    useLogoOnContracts,
    primaryColor,
    secondaryColor,
    documentFooter: normalizeOptionalText(value.document_footer),
  };
}

export async function loadStoreBrandVisualPolicy(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
}): Promise<StoreBrandVisualPolicy> {
  const { data, error } = await args.supabase.rpc(
    "read_store_settings_experience_policies_scoped",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
    }
  );

  if (error) {
    throw new Error(
      `Falha ao carregar brand_visual_policy canonica: ${error.message}`
    );
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];

  if (rows.length > 1) {
    throw new Error(
      "Reader canonico retornou mais de uma brand_visual_policy para a loja"
    );
  }

  const row = rows[0];

  return normalizeStoreBrandVisualPolicy(
    isRecord(row) ? row.brand_visual_policy : null
  );
}