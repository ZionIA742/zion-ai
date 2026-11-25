import {
  createEmptyQuoteFormItem,
  parseQuoteMoneyValue,
  parseQuoteQuantityValue,
  convertReaisToCents,
  type QuoteFormItem,
} from "./quote-editor-model";

import {
  resolveManualQuoteCreationContext,
  buildManualQuoteCreationStorageKey,
  buildManualQuoteCreationSnapshot,
} from "./lead/[id]/quote-create-operation";

import {
  normalizeManualQuoteItems,
} from "./manual-quote-pdf";

export type GeneralQuoteScope = {
  organizationId: string;
  storeId: string;
  userId: string;
};

export type GeneralQuoteLead = {
  id: string;
  name: string | null;
  phone: string | null;
  organizationId: string;
  storeId: string;
};

export type GeneralQuoteDraft = {
  linkedLead: GeneralQuoteLead | null;
  customerName: string;
  customerPhone: string;
  quoteTitle: string;
  quoteCustomerNotes: string;
  quoteWarrantyTerms: string;
  quoteValidityDays: string;
  quoteItems: QuoteFormItem[];
};

export function createGeneralQuoteDraft(): GeneralQuoteDraft {
  return {
    linkedLead: null,
    customerName: "",
    customerPhone: "",
    quoteTitle: "",
    quoteCustomerNotes: "",
    quoteWarrantyTerms: "",
    quoteValidityDays: "",
    quoteItems: [createEmptyQuoteFormItem()],
  };
}

function assertScope(scope: GeneralQuoteScope) {
  if (
    !scope.organizationId.trim() ||
    !scope.storeId.trim() ||
    !scope.userId.trim()
  ) {
    throw new Error("Escopo do orcamento indisponivel.");
  }
}

export function buildGeneralQuoteDraftKey(
  scope: GeneralQuoteScope,
) {
  assertScope(scope);

  return [
    "zion",
    "manual-quote-draft",
    "general",
    scope.userId,
    scope.organizationId,
    scope.storeId,
  ].map(encodeURIComponent).join(":");
}

const LEAD_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readGeneralQuoteLead(
  value: unknown,
): GeneralQuoteLead {
  if (!value || typeof value !== "object") {
    throw new Error("Lead invalido.");
  }

  const row = value as Record<string, unknown>;

  if (
    typeof row.id !== "string" ||
    !LEAD_UUID.test(row.id) ||
    typeof row.organizationId !== "string" ||
    !row.organizationId ||
    typeof row.storeId !== "string" ||
    !row.storeId ||
    (row.name !== null && typeof row.name !== "string") ||
    (row.phone !== null && typeof row.phone !== "string")
  ) {
    throw new Error("Lead invalido.");
  }

  return {
    id: row.id,
    name: row.name as string | null,
    phone: row.phone as string | null,
    organizationId: row.organizationId,
    storeId: row.storeId,
  };
}

export function assertGeneralQuoteLeadScope(
  scope: Pick<GeneralQuoteScope, "organizationId" | "storeId">,
  lead: GeneralQuoteLead,
) {
  if (
    lead.organizationId !== scope.organizationId ||
    lead.storeId !== scope.storeId
  ) {
    throw new Error("Lead fora do escopo da loja.");
  }
}

export function setGeneralQuoteLead(
  scope: GeneralQuoteScope,
  draft: GeneralQuoteDraft,
  lead: GeneralQuoteLead | null,
): GeneralQuoteDraft {
  assertScope(scope);

  const linkedLead = lead === null
    ? null
    : readGeneralQuoteLead(lead);

  if (linkedLead) {
    assertGeneralQuoteLeadScope(scope, linkedLead);
  }

  return {
    ...draft,
    linkedLead,
    customerName: "",
    customerPhone: "",
  };
}

export async function loadGeneralQuoteLeadPage(
  scope: Pick<GeneralQuoteScope, "organizationId" | "storeId">,
  input: {
    search?: string;
    offset?: number;
    leadId?: string;
  },
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const offset = input.offset ?? 0;

  const response = await fetcher(
    "/api/sales-quotes/lead-picker",
    {
      method: "POST",
      cache: "no-store",
      signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: scope.organizationId,
        storeId: scope.storeId,
        search: input.search ?? "",
        offset,
        ...(input.leadId === undefined
          ? {}
          : { leadId: input.leadId }),
      }),
    },
  );

  const result = await response.json().catch(() => null);

  if (
    !response.ok ||
    result?.ok !== true ||
    result.organizationId !== scope.organizationId ||
    result.storeId !== scope.storeId ||
    !Array.isArray(result.leads) ||
    result.leads.length > 30 ||
    typeof result.hasMore !== "boolean" ||
    (result.hasMore
      ? result.leads.length !== 30 ||
        result.nextOffset !== offset + 30
      : result.nextOffset !== null)
  ) {
    throw new Error("Nao foi possivel consultar os leads.");
  }

  const leads: GeneralQuoteLead[] =
    result.leads.map((row: unknown) => {
      if (!row || typeof row !== "object") {
        throw new Error("Resultado de leads invalido.");
      }

      return readGeneralQuoteLead({
        ...row,
        organizationId: result.organizationId,
        storeId: result.storeId,
      });
    });

  if (
    new Set(leads.map(lead => lead.id)).size !== leads.length ||
    (input.leadId !== undefined &&
      (result.hasMore ||
        leads.length > 1 ||
        leads.some(lead => lead.id !== input.leadId)))
  ) {
    throw new Error("Resultado de leads invalido.");
  }

  return {
    leads,
    hasMore: result.hasMore as boolean,
    nextOffset: result.nextOffset as number | null,
  };
}

export async function revalidateGeneralQuoteLead(
  scope: Pick<GeneralQuoteScope, "organizationId" | "storeId">,
  lead: GeneralQuoteLead,
  fetcher: typeof fetch = fetch,
) {
  assertGeneralQuoteLeadScope(scope, lead);

  const page = await loadGeneralQuoteLeadPage(
    scope,
    { leadId: lead.id },
    fetcher,
  );

  const current = page.leads[0];

  if (
    !current ||
    current.id !== lead.id ||
    current.name !== lead.name ||
    current.phone !== lead.phone
  ) {
    throw new Error(
      "O lead mudou ou nao esta mais disponivel. Selecione-o novamente."
    );
  }

  return current;
}

export function restoreGeneralQuoteDraft(
  raw: string | null,
): GeneralQuoteDraft {
  if (!raw) return createGeneralQuoteDraft();

  try {
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      return createGeneralQuoteDraft();
    }

    for (const key of [
      "customerName",
      "customerPhone",
      "quoteTitle",
      "quoteCustomerNotes",
      "quoteWarrantyTerms",
      "quoteValidityDays",
    ]) {
      if (typeof parsed[key] !== "string") {
        return createGeneralQuoteDraft();
      }
    }

    if (
      !Array.isArray(parsed.quoteItems) ||
      parsed.quoteItems.length === 0 ||
      !parsed.quoteItems.every((item: QuoteFormItem) =>
        item &&
        ["pool_installation", "service", "custom"].includes(item.itemType) &&
        ["id", "name", "description", "quantity", "unitPriceReais", "discountReais"]
          .every(key => typeof item[key as keyof QuoteFormItem] === "string")
      )
    ) {
      return createGeneralQuoteDraft();
    }

    if (
      new Set(parsed.quoteItems.map((item: QuoteFormItem) => item.id)).size !==
      parsed.quoteItems.length
    ) {
      return createGeneralQuoteDraft();
    }

    const linkedLead = parsed.linkedLead == null
      ? null
      : readGeneralQuoteLead(parsed.linkedLead);

    return {
      linkedLead,
      customerName: linkedLead ? "" : parsed.customerName,
      customerPhone: linkedLead ? "" : parsed.customerPhone,
      quoteTitle: parsed.quoteTitle,
      quoteCustomerNotes: parsed.quoteCustomerNotes,
      quoteWarrantyTerms: parsed.quoteWarrantyTerms,
      quoteValidityDays: parsed.quoteValidityDays,
      quoteItems: parsed.quoteItems.map((item: QuoteFormItem) => ({
        id: item.id,
        itemType: item.itemType,
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        unitPriceReais: item.unitPriceReais,
        discountReais: item.discountReais,
      })),
    };
  } catch {
    return createGeneralQuoteDraft();
  }
}

// Exact validation declarations extracted from the lead editor.
export function calculateGeneralQuoteValidation(
  draft: GeneralQuoteDraft,
  quoteServiceOptionEnabled: boolean,
  humanQuoteEditView: ReadonlyMap<string, string> | null = null,
  humanQuoteGlobalDiscountCents = 0,
) {
  const {
    quoteTitle,
    quoteItems,
  } = draft;

  const quoteSubtotalReais = quoteItems.reduce((total, item) => {
    const quantity = parseQuoteQuantityValue(item.quantity);
    const unitPrice = parseQuoteMoneyValue(item.unitPriceReais);

    return total + quantity * unitPrice;
  }, 0);
  const quoteDiscountTotalReais = quoteItems.reduce((total, item) => {
    const discount = parseQuoteMoneyValue(item.discountReais);
    return total + discount;
  }, 0);
  const quoteGlobalDiscountReais = humanQuoteEditView ? humanQuoteGlobalDiscountCents / 100 : 0;
  const quoteTotalReais = Math.max(quoteSubtotalReais - quoteDiscountTotalReais - quoteGlobalDiscountReais, 0);
  const quoteHasUnavailableService =
    quoteItems.some((item) => item.itemType === "service" && !humanQuoteEditView?.has(item.id)) &&
    !quoteServiceOptionEnabled;
  const quoteHasTitle = quoteTitle.trim().length > 0;
  const quoteHasAtLeastOneItem = quoteItems.length > 0;
  const quoteItemsAreValid = quoteItems.every((item) => {
    const hasName = item.name.trim().length > 0;
    const quantity = parseQuoteQuantityValue(item.quantity);
    const unitPrice = parseQuoteMoneyValue(item.unitPriceReais);

    return hasName && quantity > 0 && (humanQuoteEditView ? (item.unitPriceReais.trim() !== "" && Number.isFinite(Number(item.unitPriceReais.trim().replace(",", "."))) && Number(item.unitPriceReais.trim().replace(",", ".")) >= 0) : unitPrice > 0);
  });
  const canGenerateQuotePdf =
    quoteHasTitle &&
    quoteHasAtLeastOneItem &&
    quoteItemsAreValid &&
    !quoteHasUnavailableService &&
    (quoteGlobalDiscountReais === 0 || Math.round((quoteSubtotalReais - quoteDiscountTotalReais) * 100) >= humanQuoteGlobalDiscountCents);
  const quoteValidationMessage = quoteHasUnavailableService
    ? "A loja não possui serviços técnicos configurados e disponíveis para este orçamento."
    : canGenerateQuotePdf
      ? null
      : "Preencha o t\u00edtulo, o nome do item, a quantidade e o pre\u00e7o para gerar o PDF.";

  return {
    quoteSubtotalReais,
    quoteDiscountTotalReais,
    quoteGlobalDiscountReais,
    quoteTotalReais,
    canGenerateQuotePdf,
    quoteValidationMessage,
  };
}

export function buildGeneralQuoteSubmission(
  scope: GeneralQuoteScope,
  draft: GeneralQuoteDraft,
) {
  assertScope(scope);

  const linkedLead = draft.linkedLead === null
    ? null
    : readGeneralQuoteLead(draft.linkedLead);

  if (linkedLead) {
    assertGeneralQuoteLeadScope(scope, linkedLead);
  }

  const context = resolveManualQuoteCreationContext({
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    linkLead: linkedLead !== null,
    currentLeadId: linkedLead?.id ?? null,
    currentConversationId: null,
    currentOpportunityId: null,
    currentLeadName: linkedLead?.name ?? null,
    currentLeadPhone: linkedLead?.phone ?? null,
    manualCustomerName: draft.customerName,
    manualCustomerPhone: draft.customerPhone,
  });

  const payload = {
    ...context,
    title: draft.quoteTitle.trim(),
    customer_notes: draft.quoteCustomerNotes.trim() || null,
    internal_notes: null,
    warranty_terms: draft.quoteWarrantyTerms.trim() || null,
    validity_days: draft.quoteValidityDays.trim() || null,
    items: normalizeManualQuoteItems(draft.quoteItems),
  };

  const pendingOperationStorageKey =
    buildManualQuoteCreationStorageKey(context) +
    ":general:" + encodeURIComponent(scope.userId);

  const requestSnapshot =
    buildManualQuoteCreationSnapshot({
      ...payload,
      discount_cents: 0,
    });

  return {
    payload,
    pendingOperationStorageKey,
    requestSnapshot,
  };
}
