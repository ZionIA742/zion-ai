export type QuoteStatus =
  | "draft"
  | "pending_review"
  | "sent"
  | "approved"
  | "changes_requested"
  | "failed";

export type QuoteSettings = {
  quotePdfEnabled: boolean;
  aiCanGenerateQuote: boolean;
  aiCanSendQuoteToCustomer: boolean;
  requiresHumanApprovalBeforeSend: boolean;
  quoteNumberPrefix: string;
  nextQuoteNumber: number;
};

export type StoreQuoteSettingsRow = {
  id?: string;
  organization_id: string;
  store_id: string;
  quote_pdf_enabled: boolean | null;
  ai_can_generate_quote: boolean | null;
  ai_can_send_quote_to_customer: boolean | null;
  requires_human_approval_before_send: boolean | null;
  quote_number_prefix: string | null;
  next_quote_number: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type QuoteStoreRow = {
  id: string;
  organization_id: string;
  name: string | null;
  created_at?: string | null;
};

export type QuoteConversationRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
  status: string | null;
  is_human_active?: boolean | null;
};

export type QuoteLeadRow = {
  id: string;
  organization_id: string;
  store_id: string | null;
  name: string | null;
  phone: string | null;
};

export type SalesQuoteRow = {
  id: string;
  organization_id: string;
  store_id: string;
  commercial_opportunity_id?: string | null;
  creation_idempotency_key?: string | null;
  creation_request_fingerprint?: string | null;
  conversation_id: string | null;
  lead_id: string | null;
  quote_number: string | null;
  title: string | null;
  status: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_notes: string | null;
  internal_notes: string | null;
  payment_terms?: string | null;
  delivery_terms?: string | null;
  warranty_terms?: string | null;
  valid_until?: string | null;
  subtotal_cents: number | null;
  discount_cents: number | null;
  total_cents: number | null;
  current_version_id: string | null;
  last_change_request_id?: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

export type SalesQuoteItemRow = {
  id: string;
  quote_id: string;
  organization_id: string;
  store_id: string;
  item_type?: string | null;
  name: string | null;
  description: string | null;
  quantity: number | null;
  unit_price_cents: number | null;
  discount_cents: number | null;
  subtotal_cents: number | null;
  total_cents: number | null;
  sort_order: number | null;
  sku: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

export type SalesQuoteVersionRow = {
  id: string;
  quote_id: string;
  organization_id: string;
  store_id: string;
  version_number: number | null;
  status: string | null;
  quote_kind?: string | null;
  store_file_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  original_filename?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  quote_snapshot: Record<string, unknown> | null;
  created_at: string | null;
  sent_at?: string | null;
};

export type SalesQuoteChangeRequestRow = {
  id: string;
  quote_id: string;
  organization_id: string;
  store_id: string;
  status: string | null;
  requested_by: string | null;
  request_text: string | null;
  applied_changes?: Record<string, unknown> | null;
  created_at: string | null;
  applied_at?: string | null;
  resolved_at?: string | null;
};

export type StoreFileRow = {
  id: string;
  organization_id: string;
  store_id: string;
  file_kind: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string | null;
  updated_at?: string | null;
};

export type QuoteItemInput = {
  name: string;
  description?: string | null;
  quantity: number;
  unit_price_cents: number;
  discount_cents?: number | null;
  sku?: string | null;
  source?: Record<string, unknown> | null;
};

export type NormalizedQuoteItemInput = {
  name: string;
  description: string | null;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  subtotalCents: number;
  totalCents: number;
  sku: string | null;
  sortOrder: number;
  metadata: Record<string, unknown>;
};

export type QuoteSnapshot = {
  quote: {
    id: string;
    quoteNumber: string;
    title: string | null;
    status: string;
    customerNotes: string | null;
    internalNotes: string | null;
    subtotalCents: number;
    discountCents: number;
    totalCents: number;
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
  items: Array<{
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
  }>;
  settings: QuoteSettings;
  generatedAt: string;
  generationError?: string | null;
};
