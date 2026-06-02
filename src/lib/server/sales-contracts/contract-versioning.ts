import type { QuoteLeadRow, QuoteStoreRow, SalesQuoteItemRow } from "@/lib/server/sales-quotes/types";
import type { ContractSnapshot, SalesContract, SalesContractVersion } from "./types";

function toNumber(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

export function buildContractSnapshot(args: {
  contract: SalesContract;
  store: QuoteStoreRow;
  lead: QuoteLeadRow | null;
  items: SalesQuoteItemRow[];
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
      unitPriceCents: item.unit_price_cents,
      discountCents: item.discount_cents,
      totalCents: item.total_cents,
      metadata: item.metadata,
    })),
    generatedAt: new Date().toISOString(),
  } satisfies ContractSnapshot;
}

export async function getNextContractVersionNumber(args: {
  supabase: any;
  contractId: string;
}) {
  const { data, error } = await args.supabase
    .from("sales_contract_versions")
    .select("version_number")
    .eq("contract_id", args.contractId)
    .order("version_number", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Falha ao carregar versoes do contrato: ${error.message}`);
  }

  const currentVersion =
    Array.isArray(data) && data[0]?.version_number ? Number(data[0].version_number) : 0;

  return Math.max(1, currentVersion + 1);
}

export async function createContractVersion(args: {
  supabase: any;
  contract: SalesContract;
  versionNumber: number;
  status: string;
  storeFileId: string;
  storageBucket: string;
  storagePath: string;
  originalFilename: string;
  sizeBytes: number;
  contractSnapshot: ContractSnapshot;
}) {
  const { data, error } = await args.supabase
    .from("sales_contract_versions")
    .insert({
      contract_id: args.contract.id,
      organization_id: args.contract.organization_id,
      store_id: args.contract.store_id,
      version_number: args.versionNumber,
      status: args.status,
      store_file_id: args.storeFileId,
      storage_bucket: args.storageBucket,
      storage_path: args.storagePath,
      original_filename: args.originalFilename,
      mime_type: "application/pdf",
      size_bytes: args.sizeBytes,
      contract_snapshot: args.contractSnapshot,
    })
    .select("*")
    .maybeSingle();

  if (error || !data?.id) {
    throw new Error(error?.message || "Falha ao criar sales_contract_versions.");
  }

  return data as SalesContractVersion;
}

export async function markContractVersionStatus(args: {
  supabase: any;
  versionId: string;
  status: string;
}) {
  const { error } = await args.supabase
    .from("sales_contract_versions")
    .update({
      status: args.status,
    })
    .eq("id", args.versionId);

  if (error) {
    throw new Error(`Falha ao atualizar status da versao do contrato: ${error.message}`);
  }
}

export async function setContractCurrentVersion(args: {
  supabase: any;
  contractId: string;
  versionId: string;
  status?: string | null;
}) {
  const payload: Record<string, unknown> = {
    current_version_id: args.versionId,
  };

  if (args.status) {
    payload.status = args.status;
  }

  const { error } = await args.supabase
    .from("sales_contracts")
    .update(payload)
    .eq("id", args.contractId);

  if (error) {
    throw new Error(`Falha ao atualizar sales_contracts.current_version_id: ${error.message}`);
  }
}
