import { createHash } from "node:crypto";
import type { QuoteLeadRow, QuoteStoreRow } from "@/lib/server/sales-quotes/types";
import type { SalesContract } from "./types";
import type {
  ContractQuoteSnapshotItem,
} from "./contract-versioning";
import type { ContractTemplateTermsResolution } from "./contract-template-terms";

export type CanonicalContractRendererInput = {
  identity: {
    contractId: string;
    organizationId: string;
    storeId: string;
    quoteId: string;
    quoteVersionId: string;
    quoteNumber: string | null;
    contractNumber: string | null;
    title: string | null;
    validUntil: string | null;
  };
  lineage: {
    commercialOpportunityId: string | null;
    proposalAcceptanceEventId: string | null;
  };
  customer: {
    leadId: string | null;
    name: string | null;
    phone: string | null;
  };
  store: {
    id: string;
    name: string | null;
  };
  items: Array<{
    id: string | null;
    name: string | null;
    description: string | null;
    quantity: number | null;
    unitPriceCents: number | null;
    discountCents: number | null;
    totalCents: number | null;
    metadata: Record<string, unknown> | null;
  }>;
  values: {
    currency: string | null;
    subtotalCents: number;
    discountCents: number;
    totalCents: number;
  };
  commercialTerms: {
    payment: string | null;
    delivery: string | null;
    warranty: string | null;
  };
  templateAuthority: {
    templateId: string;
    templateVersionId: string;
    templateVersionNumber: number | null;
    rules: ContractTemplateTermsResolution["rulesUsed"];
    clauses: string;
  };
  branding: {
    primaryColor: string | null;
    secondaryColor: string | null;
    documentFooter: string | null;
    logo: {
      mimeType: string;
      dataBase64: string;
    } | null;
  };
  createdAt: string | null;
}

type CanonicalContractRendererSource = {
  quoteSnapshot: {
    quote?: Record<string, unknown>;
  };
  contract: SalesContract;
  store: QuoteStoreRow;
  lead: QuoteLeadRow | null;
  items: ContractQuoteSnapshotItem[];
  templateTerms: ContractTemplateTermsResolution;
  brandVisual: {
    primaryColor?: string | null;
    secondaryColor?: string | null;
    documentFooter?: string | null;
  } | null;
  logo: { bytes: Uint8Array; mimeType: string } | null;
}

function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function encodeBytes(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

function readMetadataText(metadata: Record<string, unknown> | null, key: string) {
  return normalizeOptionalText(metadata?.[key]);
}

export function buildCanonicalContractRendererInput(
  source: CanonicalContractRendererSource,
): CanonicalContractRendererInput {
  const quote = source.quoteSnapshot.quote ?? {};
  const metadata = source.contract.metadata;
  const quoteId = normalizeOptionalText(source.contract.quote_id) || "";
  const quoteVersionId = normalizeOptionalText(source.contract.quote_version_id) || "";
  const rules = source.templateTerms.rulesUsed.map((rule) => ({ ...rule }));

  return {
    identity: {
      contractId: source.contract.id,
      organizationId: source.contract.organization_id,
      storeId: source.contract.store_id,
      quoteId,
      quoteVersionId,
      quoteNumber: normalizeOptionalText(quote.quoteNumber),
      contractNumber: normalizeOptionalText(source.contract.contract_number),
      title: normalizeOptionalText(quote.title) ?? source.contract.title,
      validUntil: normalizeOptionalText(quote.validUntil),
    },
    lineage: {
      commercialOpportunityId:
        normalizeOptionalText(source.contract.commercial_opportunity_id) ??
        readMetadataText(metadata, "commercial_opportunity_id"),
      proposalAcceptanceEventId: readMetadataText(
        metadata,
        "proposal_acceptance_event_id",
      ),
    },
    customer: {
      leadId: source.lead?.id || source.contract.lead_id || null,
      name: normalizeOptionalText(quote.customerName) ?? source.lead?.name ?? null,
      phone: normalizeOptionalText(quote.customerPhone) ?? source.lead?.phone ?? null,
    },
    store: {
      id: source.store.id,
      name: source.store.name,
    },
    items: source.items.map((item) => ({
      id: item.id ?? null,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      discountCents: item.discountCents,
      totalCents: item.totalCents,
      metadata: item.metadata,
    })),
    values: {
      currency: normalizeOptionalText(quote.currency) ?? source.contract.currency,
      subtotalCents: finiteNumber(quote.subtotalCents),
      discountCents: finiteNumber(quote.discountCents),
      totalCents: finiteNumber(quote.totalCents),
    },
    commercialTerms: {
      payment: normalizeOptionalText(quote.paymentTerms),
      delivery: normalizeOptionalText(quote.deliveryTerms),
      warranty: normalizeOptionalText(quote.warrantyTerms),
    },
    templateAuthority: {
      templateId: source.templateTerms.templateId || "",
      templateVersionId: source.templateTerms.templateVersionId || "",
      templateVersionNumber: source.templateTerms.templateVersionNumber,
      rules,
      clauses: source.templateTerms.generatedContractTerms || "",
    },
    branding: {
      primaryColor: source.brandVisual?.primaryColor ?? null,
      secondaryColor: source.brandVisual?.secondaryColor ?? null,
      documentFooter: source.brandVisual?.documentFooter ?? null,
      logo: source.logo
        ? {
            mimeType: source.logo.mimeType,
            dataBase64: encodeBytes(source.logo.bytes),
          }
        : null,
    },
    createdAt: source.contract.created_at,
  };
}

function fingerprintableInput(input: CanonicalContractRendererInput): unknown {
  if (Array.isArray(input)) {
    return input.map((value) => fingerprintableInput(value as CanonicalContractRendererInput));
  }

  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input)
        .filter(([key]) => key !== "createdAt")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [
          key,
          fingerprintableInput(value as CanonicalContractRendererInput),
        ]),
    );
  }

  return input;
}

export function computeContractContentFingerprint(
  input: CanonicalContractRendererInput,
) {
  return createHash("sha256")
    .update(JSON.stringify(fingerprintableInput(input)))
    .digest("hex");
}

export function buildContractSnapshotV2(args: {
  input: CanonicalContractRendererInput;
  contentFingerprint: string;
  materializedAt: string;
}) {
  return {
    schema: "zion.sales_contract_snapshot.v2",
    identity: {
      contract_id: args.input.identity.contractId,
      organization_id: args.input.identity.organizationId,
      store_id: args.input.identity.storeId,
    },
    lineage: {
      quote_id: args.input.identity.quoteId,
      quote_version_id: args.input.identity.quoteVersionId,
      commercial_opportunity_id: args.input.lineage.commercialOpportunityId,
      proposal_acceptance_event_id: args.input.lineage.proposalAcceptanceEventId,
    },
    template_authority: {
      template_id: args.input.templateAuthority.templateId,
      template_version_id: args.input.templateAuthority.templateVersionId,
      template_version_number: args.input.templateAuthority.templateVersionNumber,
      rules: args.input.templateAuthority.rules,
    },
    renderer_input: args.input,
    content_fingerprint: args.contentFingerprint,
    materialized_at: args.materializedAt,
  };
}
