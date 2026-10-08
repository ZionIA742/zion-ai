import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuoteLeadRow, QuoteStoreRow } from "@/lib/server/sales-quotes/types";
import type { ContractSnapshot, SalesContract, SalesContractVersion } from "./types";
import type { ContractTemplateTermsResolution } from "./contract-template-terms";

export type ContractQuoteSnapshotItem = {
  id?: string | null;
  name: string | null;
  description: string | null;
  quantity: number | null;
  unitPriceCents: number | null;
  discountCents: number | null;
  subtotalCents: number | null;
  totalCents: number | null;
  sku: string | null;
  sortOrder: number | null;
  metadata: Record<string, unknown> | null;
};

function toNumber(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

export function buildContractSnapshot(args: {
  contract: SalesContract;
  store: QuoteStoreRow;
  lead: QuoteLeadRow | null;
  items: ContractQuoteSnapshotItem[];
  templateTerms?: ContractTemplateTermsResolution | null;
}) {
  return {
    contract: {
      id: args.contract.id,
      contractNumber: String(args.contract.contract_number || "").trim(),
      title: args.contract.title,
      status: String(args.contract.status || "").trim() || "pending_review",
      customerName: args.contract.customer_name,
      customerPhone: args.contract.customer_phone,
      subtotalCents: toNumber(args.contract.subtotal_cents),
      discountCents: toNumber(args.contract.discount_cents),
      totalCents: toNumber(args.contract.total_cents),
      paymentTerms: args.contract.payment_terms,
      deliveryTerms: args.contract.delivery_terms,
      warrantyTerms: args.contract.warranty_terms,
      contractTerms: args.contract.contract_terms,
      validUntil: args.contract.valid_until,
      quoteId: args.contract.quote_id,
      quoteVersionId: args.contract.quote_version_id,
    },
    store: {
      id: args.store.id,
      name: args.store.name,
    },
    lead: {
      id: args.lead?.id || null,
      name: args.lead?.name || null,
      phone: args.lead?.phone || null,
    },
    quote: {
      id: args.contract.quote_id,
      quoteNumber:
        args.contract.metadata && typeof args.contract.metadata === "object"
          ? String(args.contract.metadata.quote_number || "").trim() || null
          : null,
    },
    items: args.items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      discountCents: item.discountCents,
      totalCents: item.totalCents,
      metadata: item.metadata,
    })),
    generatedAt: new Date().toISOString(),
    contractTemplateUsed: args.templateTerms?.contractTemplateUsed ?? false,
    templateId: args.templateTerms?.templateId ?? null,
    templateVersionId: args.templateTerms?.templateVersionId ?? null,
    templateVersionNumber: args.templateTerms?.templateVersionNumber ?? null,
    generatedContractTerms: args.templateTerms?.generatedContractTerms ?? null,
    rulesUsed: args.templateTerms?.rulesUsed ?? [],
    snapshotGeneratedAt:
      args.templateTerms?.snapshotGeneratedAt ?? new Date().toISOString(),
    templateWarning: args.templateTerms?.warning ?? null,
  } satisfies ContractSnapshot;
}

export type CanonicalContractVersionWriterArgs = {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  contractId: string;
  operationKey: string;
  requestFingerprint: string;
  contentFingerprint: string;
  storeFileId: string;
  storageBucket: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  pdfSha256: string;
  contractSnapshot: Record<string, unknown>;
  onAuthorityResolved?: (result: { versionId: string; replayed: boolean }) => void;
};

export async function createSalesContractVersionBySystem(
  args: CanonicalContractVersionWriterArgs,
) {
  const { data, error } = await args.supabase.rpc(
    "create_sales_contract_version_by_system",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_contract_id: args.contractId,
      p_operation_key: args.operationKey,
      p_request_fingerprint: args.requestFingerprint,
      p_content_fingerprint: args.contentFingerprint,
      p_store_file_id: args.storeFileId,
      p_storage_bucket: args.storageBucket,
      p_storage_path: args.storagePath,
      p_original_filename: args.originalFilename,
      p_mime_type: args.mimeType,
      p_size_bytes: args.sizeBytes,
      p_pdf_sha256: args.pdfSha256,
      p_contract_snapshot: args.contractSnapshot,
    },
  );

  if (error) {
    throw new Error(`Falha ao criar versao canonica do contrato: ${error.message}`);
  }

  const writerRow = Array.isArray(data) ? data[0] : data;
  if (
    !writerRow ||
    typeof writerRow.id !== "string" ||
    writerRow.contract_id !== args.contractId ||
    writerRow.organization_id !== args.organizationId ||
    writerRow.store_id !== args.storeId ||
    !Number.isInteger(Number(writerRow.version_number)) ||
    Number(writerRow.version_number) < 1 ||
    typeof writerRow.status !== "string" ||
    typeof writerRow.replayed !== "boolean"
  ) {
    throw new Error("A autoridade canonica retornou uma versao invalida.");
  }

  args.onAuthorityResolved?.({
    versionId: writerRow.id,
    replayed: writerRow.replayed,
  });

  const { data: version, error: versionError } = await args.supabase
    .from("sales_contract_versions")
    .select("*")
    .eq("id", writerRow.id)
    .eq("contract_id", args.contractId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (versionError || !version?.id) {
    throw new Error(
      versionError?.message ||
        "A versao retornada pela autoridade canonica nao esta disponivel.",
    );
  }

  if (
    version.id !== writerRow.id ||
    version.contract_id !== args.contractId ||
    version.organization_id !== args.organizationId ||
    version.store_id !== args.storeId ||
    Number(version.version_number) !== Number(writerRow.version_number)
  ) {
    throw new Error("A versao duravel retornada nao corresponde ao resultado da autoridade.");
  }

  return {
    version: version as SalesContractVersion,
    replayed: writerRow.replayed,
  };
}

export async function reconcileSupersededContractVersion(args: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  contractId: string;
  versionNumber: number | null;
}) {
  const versionNumber = Number(args.versionNumber);
  if (!Number.isInteger(versionNumber) || versionNumber <= 1) return;

  const { data, error } = await args.supabase
    .from("sales_contract_versions")
    .update({ status: "superseded" })
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("contract_id", args.contractId)
    .eq("version_number", versionNumber - 1)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao atualizar status da versao do contrato: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error("A versao anterior esperada nao foi encontrada para superseded.");
  }
}

export async function markContractPendingReview(args: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  contractId: string;
  expectedCurrentVersionId: string;
}) {
  const { data, error } = await args.supabase
    .from("sales_contracts")
    .update({ status: "pending_review" })
    .eq("id", args.contractId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("current_version_id", args.expectedCurrentVersionId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao atualizar status do contrato: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error("O contrato mudou de versao durante a reconciliacao.");
  }
}
