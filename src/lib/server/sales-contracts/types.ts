export type SalesContractStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "sent"
  | "sent_to_customer"
  | "customer_signed"
  | "partially_signed"
  | "completed"
  | "cancelled"
  | "expired"
  | "failed";

export type SalesContractVersionStatus =
  | "generated"
  | "pending_review"
  | "approved"
  | "sent"
  | "completed"
  | "superseded"
  | "failed";

export type SalesContractSignatureSignerType = "customer" | "store";

export type SalesContractSignatureStatus =
  | "pending"
  | "accepted"
  | "signed"
  | "rejected"
  | "cancelled";

export type SalesContract = {
  id: string;
  organization_id: string;
  store_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  quote_id: string | null;
  quote_version_id: string | null;
  current_version_id: string | null;
  contract_number: string | null;
  title: string | null;
  status: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  currency: string | null;
  subtotal_cents: number | null;
  discount_cents: number | null;
  total_cents: number | null;
  payment_terms: string | null;
  delivery_terms: string | null;
  warranty_terms: string | null;
  contract_terms: string | null;
  valid_until: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  sent_at?: string | null;
  sent_by?: string | null;
  customer_signed_at?: string | null;
  store_signed_at?: string | null;
  completed_at?: string | null;
  completed_by?: string | null;
  cancelled_at?: string | null;
  expired_at?: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

export type SalesContractVersion = {
  id: string;
  contract_id: string;
  organization_id: string;
  store_id: string;
  version_number: number | null;
  status: string | null;
  store_file_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  contract_snapshot: Record<string, unknown> | null;
  created_at: string | null;
  approved_at?: string | null;
  sent_at?: string | null;
};

export type SalesContractSignature = {
  id: string;
  contract_id: string;
  organization_id: string;
  store_id: string;
  contract_version_id: string | null;
  signer_type: string | null;
  signer_user_id?: string | null;
  status: string | null;
  signer_name: string | null;
  signer_phone: string | null;
  signer_email?: string | null;
  acceptance_text: string | null;
  signed_at?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at?: string | null;
};

export type StoreContractSettings = {
  id?: string;
  organization_id: string;
  store_id: string;
  contract_pdf_enabled?: boolean | null;
  requires_customer_acceptance?: boolean | null;
  requires_store_signature?: boolean | null;
  contract_number_prefix?: string | null;
  default_contract_terms?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ContractPdfItem = {
  name: string | null;
  description: string | null;
  quantity: number | null;
  unit_price_cents: number | null;
  discount_cents: number | null;
  total_cents: number | null;
};

export type ContractSnapshot = {
  contract: {
    id: string;
    contractNumber: string;
    title: string | null;
    status: string;
    customerName: string | null;
    customerPhone: string | null;
    subtotalCents: number;
    discountCents: number;
    totalCents: number;
    paymentTerms: string | null;
    deliveryTerms: string | null;
    warrantyTerms: string | null;
    contractTerms: string | null;
    validUntil: string | null;
    quoteId: string | null;
    quoteVersionId: string | null;
  };
  store: {
    id: string;
    name: string | null;
  };
  lead: {
    id: string | null;
    name: string | null;
    phone: string | null;
  };
  quote: {
    id: string | null;
    quoteNumber: string | null;
  };
  items: Array<{
    id?: string | null;
    name: string | null;
    description: string | null;
    quantity: number | null;
    unitPriceCents: number | null;
    discountCents: number | null;
    totalCents: number | null;
    metadata?: Record<string, unknown> | null;
  }>;
  generatedAt: string;
  contractTemplateUsed?: boolean;
  templateId?: string | null;
  templateVersionId?: string | null;
  templateVersionNumber?: number | null;
  generatedContractTerms?: string | null;
  rulesUsed?: Array<{
    rule_id: string;
    rule_key: string;
    rule_group: string;
    label: string;
    value_text: string;
    review_status: "approved" | "edited";
    sort_order: number | null;
  }>;
  snapshotGeneratedAt?: string;
  templateWarning?: string | null;
};

export type CreateContractFromQuoteInput = {
  quoteId: string;
};

export type GenerateContractPdfInput = {
  contractId: string;
};

export type SendContractInput = {
  contractId: string;
  message?: string | null;
};

export type SignContractInput = {
  contractId: string;
  signerType: SalesContractSignatureSignerType;
  signerName?: string | null;
  signerPhone?: string | null;
  acceptanceText?: string | null;
};
