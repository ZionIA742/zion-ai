export type MetaStoreOption = {
  storeId: string;
  label: string;
  status: "ready" | "incomplete" | "ambiguous";
};

type Integration = {
  store_id: unknown;
  whatsapp_business_account_id: unknown;
  display_phone_number: unknown;
  access_token: unknown;
};

type Obj = Record<string, unknown>;

function object(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Obj : null;
}

/** Returns only safe display metadata. Never returns WABA IDs or tokens. */
export function buildMetaStoreOptions(rows: Integration[]): MetaStoreOption[] {
  const groups = new Map<string, Integration[]>();
  for (const row of rows) {
    const storeId = typeof row.store_id === "string" ? row.store_id : "";
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(storeId)) continue;
    groups.set(storeId, [...(groups.get(storeId) ?? []), row]);
  }
  return [...groups.entries()].map(([storeId, group]) => {
    const item = group[0];
    const phone = typeof item.display_phone_number === "string"
      ? item.display_phone_number.replace(/\D/g, "") : "";
    const waba = typeof item.whatsapp_business_account_id === "string"
      ? item.whatsapp_business_account_id.trim() : "";
    const token = typeof item.access_token === "string"
      ? item.access_token.trim() : "";
    const status: MetaStoreOption["status"] = group.length !== 1 ? "ambiguous"
      : /^\d{5,25}$/.test(waba) && /^[1-9]\d{9,14}$/.test(phone) && token
        ? "ready" : "incomplete";
    return {
      storeId,
      label: `Loja ${storeId.slice(0, 8)}${phone.length >= 4 ? ` · WhatsApp final ${phone.slice(-4)}` : ""}`,
      status,
    };
  }).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

export type MetaPricingDisplay = {
  monetary: string;
  volume: string;
  state: "approximate" | "no_data" | "unavailable";
};

/** An HTTP 200 or missing field is never evidence of a zero charge. */
export function formatMetaPricingDisplay(payload: unknown): MetaPricingDisplay {
  const root = object(payload);
  if (root?.ok !== true) {
    return { monetary: "Dados financeiros indisponíveis", volume: "Não verificado", state: "unavailable" };
  }
  const volume = typeof root.totalVolume === "number" &&
    Number.isSafeInteger(root.totalVolume) && root.totalVolume >= 0
    ? new Intl.NumberFormat("pt-BR").format(root.totalVolume) : "Não verificado";
  if (root.amountStatus === "no_data") {
    return { monetary: "Sem dados financeiros da Meta", volume, state: "no_data" };
  }
  const amount = root.approximateCost;
  const currency = root.currency;
  if (root.amountStatus !== "approximate" ||
    typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 ||
    typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    return { monetary: "Dados financeiros indisponíveis", volume, state: "unavailable" };
  }
  try {
    return {
      monetary: new Intl.NumberFormat("pt-BR", {
        style: "currency", currency, maximumFractionDigits: 6,
      }).format(amount),
      volume,
      state: "approximate",
    };
  } catch {
    return { monetary: "Dados financeiros indisponíveis", volume, state: "unavailable" };
  }
}

export type MetaEvidenceCounts = {
  delivered: number;
  billableEvidence: number;
  freeEvidence: number;
  unknownPricing: number;
};

export function readMetaEvidenceForStore(payload: unknown, storeId: string): MetaEvidenceCounts | null {
  const root = object(payload);
  if (root?.ok !== true) return null;
  const stores = object(root.stores);
  if (!stores) return null;
  const row = object(stores[storeId]);
  if (!row) return { delivered: 0, billableEvidence: 0, freeEvidence: 0, unknownPricing: 0 };
  const keys = ["delivered", "billableEvidence", "freeEvidence", "unknownPricing"] as const;
  if (!keys.every(key => typeof row[key] === "number" && Number.isSafeInteger(row[key]) && (row[key] as number) >= 0)) return null;
  return {
    delivered: row.delivered as number,
    billableEvidence: row.billableEvidence as number,
    freeEvidence: row.freeEvidence as number,
    unknownPricing: row.unknownPricing as number,
  };
}
