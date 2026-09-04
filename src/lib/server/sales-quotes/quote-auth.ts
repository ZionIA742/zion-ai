import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import type {
  QuoteConversationRow,
  QuoteLeadRow,
  QuoteStoreRow,
  SalesQuoteRow,
} from "./types";

type MembershipRow = {
  organization_id: string;
};

const SALES_QUOTES_SELECT =
  "id, organization_id, store_id, commercial_opportunity_id, creation_idempotency_key, creation_request_fingerprint, conversation_id, lead_id, quote_number, title, status, customer_name, customer_phone, customer_notes, internal_notes, payment_terms, delivery_terms, warranty_terms, valid_until, subtotal_cents, discount_cents, total_cents, current_version_id, last_change_request_id, metadata, created_at, updated_at";

function createServiceSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variaveis de ambiente."
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export class QuoteAccessError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function uniqueOrganizationIds(rows: MembershipRow[]) {
  return Array.from(
    new Set(rows.map((row) => String(row.organization_id || "").trim()).filter(Boolean))
  );
}

export async function authenticateQuoteRequest() {
  const sessionSupabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await sessionSupabase.auth.getUser();

  if (authError || !user) {
    throw new QuoteAccessError(401, "UNAUTHENTICATED", "Usuario nao autenticado.");
  }

  const supabase = createServiceSupabaseClient();
  const { data: memberships, error: membershipError } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (membershipError) {
    throw new QuoteAccessError(
      500,
      "LOAD_MEMBERSHIPS_FAILED",
      membershipError.message
    );
  }

  const organizationIds = uniqueOrganizationIds((memberships ?? []) as MembershipRow[]);

  if (organizationIds.length === 0) {
    throw new QuoteAccessError(
      403,
      "NO_ORGANIZATION_ACCESS",
      "Usuario sem acesso a organizacoes."
    );
  }

  return {
    user,
    supabase,
    organizationIds,
  };
}

async function loadAuthorizedStore(args: {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  organizationIds: string[];
  requestOrganizationId?: string | null;
  requestStoreId: string;
}) {
  const requestStoreId = String(args.requestStoreId || "").trim();
  const requestOrganizationId = String(args.requestOrganizationId || "").trim();

  if (!requestStoreId) {
    throw new QuoteAccessError(400, "INVALID_STORE_ID", "Store ID nao informado.");
  }

  const { data: store, error: storeError } = await args.supabase
    .from("stores")
    .select("id, organization_id, name, created_at")
    .eq("id", requestStoreId)
    .in("organization_id", args.organizationIds)
    .maybeSingle();

  if (storeError) {
    throw new QuoteAccessError(500, "LOAD_STORE_FAILED", storeError.message);
  }

  if (!store) {
    throw new QuoteAccessError(
      403,
      "STORE_FORBIDDEN",
      "Loja nao encontrada ou fora do escopo do usuario."
    );
  }

  if (requestOrganizationId && requestOrganizationId !== store.organization_id) {
    throw new QuoteAccessError(
      403,
      "ORGANIZATION_STORE_MISMATCH",
      "A organizacao informada nao corresponde a loja selecionada."
    );
  }

  return store as QuoteStoreRow;
}

async function loadAuthorizedConversation(args: {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  organizationId: string;
  conversationId?: string | null;
}) {
  const conversationId = String(args.conversationId || "").trim();

  if (!conversationId) {
    return null;
  }

  const { data: conversation, error: conversationError } = await args.supabase
    .from("conversations")
    .select("id, organization_id, lead_id, status, is_human_active")
    .eq("id", conversationId)
    .eq("organization_id", args.organizationId)
    .maybeSingle();

  if (conversationError) {
    throw new QuoteAccessError(
      500,
      "LOAD_CONVERSATION_FAILED",
      conversationError.message
    );
  }

  if (!conversation) {
    throw new QuoteAccessError(
      404,
      "CONVERSATION_NOT_FOUND",
      "Conversa nao encontrada para a organizacao informada."
    );
  }

  return conversation as QuoteConversationRow;
}

async function loadAuthorizedLead(args: {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  organizationId: string;
  storeId: string;
  leadId?: string | null;
}) {
  const leadId = String(args.leadId || "").trim();

  if (!leadId) {
    return null;
  }

  const { data: lead, error: leadError } = await args.supabase
    .from("leads")
    .select("id, organization_id, store_id, name, phone")
    .eq("id", leadId)
    .eq("organization_id", args.organizationId)
    .maybeSingle();

  if (leadError) {
    throw new QuoteAccessError(500, "LOAD_LEAD_FAILED", leadError.message);
  }

  if (!lead) {
    throw new QuoteAccessError(
      404,
      "LEAD_NOT_FOUND",
      "Lead nao encontrado para a organizacao informada."
    );
  }

  const leadStoreId = String(lead.store_id || "").trim();
  if (leadStoreId && leadStoreId !== args.storeId) {
    throw new QuoteAccessError(
      403,
      "LEAD_STORE_MISMATCH",
      "A lead informada pertence a outra loja."
    );
  }

  return lead as QuoteLeadRow;
}

export async function resolveAuthorizedQuoteScope(args: {
  requestOrganizationId?: string | null;
  requestStoreId: string;
  conversationId?: string | null;
  leadId?: string | null;
}) {
  const auth = await authenticateQuoteRequest();
  const store = await loadAuthorizedStore({
    supabase: auth.supabase,
    organizationIds: auth.organizationIds,
    requestOrganizationId: args.requestOrganizationId,
    requestStoreId: args.requestStoreId,
  });

  const conversation = await loadAuthorizedConversation({
    supabase: auth.supabase,
    organizationId: store.organization_id,
    conversationId: args.conversationId,
  });

  const resolvedLeadId =
    String(args.leadId || "").trim() || String(conversation?.lead_id || "").trim() || null;
  const lead = await loadAuthorizedLead({
    supabase: auth.supabase,
    organizationId: store.organization_id,
    storeId: store.id,
    leadId: resolvedLeadId,
  });

  if (
    conversation?.lead_id &&
    lead?.id &&
    String(conversation.lead_id).trim() !== String(lead.id).trim()
  ) {
    throw new QuoteAccessError(
      403,
      "CONVERSATION_LEAD_MISMATCH",
      "A conversa informada nao corresponde a lead selecionada."
    );
  }

  return {
    ...auth,
    organizationId: store.organization_id,
    store,
    conversation,
    lead,
  };
}

export async function resolveAuthorizedExistingQuote(quoteId: string) {
  const auth = await authenticateQuoteRequest();
  const safeQuoteId = String(quoteId || "").trim();

  if (!safeQuoteId) {
    throw new QuoteAccessError(400, "INVALID_QUOTE_ID", "Quote ID nao informado.");
  }

  const { data: quote, error: quoteError } = await auth.supabase
    .from("sales_quotes")
    .select(SALES_QUOTES_SELECT)
    .eq("id", safeQuoteId)
    .in("organization_id", auth.organizationIds)
    .maybeSingle();

  if (quoteError) {
    throw new QuoteAccessError(500, "LOAD_QUOTE_FAILED", quoteError.message);
  }

  if (!quote) {
    throw new QuoteAccessError(404, "QUOTE_NOT_FOUND", "Orcamento nao encontrado.");
  }

  const store = await loadAuthorizedStore({
    supabase: auth.supabase,
    organizationIds: auth.organizationIds,
    requestOrganizationId: quote.organization_id,
    requestStoreId: quote.store_id,
  });

  const conversation = await loadAuthorizedConversation({
    supabase: auth.supabase,
    organizationId: quote.organization_id,
    conversationId: quote.conversation_id,
  });

  const lead = await loadAuthorizedLead({
    supabase: auth.supabase,
    organizationId: quote.organization_id,
    storeId: quote.store_id,
    leadId: quote.lead_id,
  });

  return {
    ...auth,
    organizationId: quote.organization_id,
    store,
    conversation,
    lead,
    quote: quote as SalesQuoteRow,
  };
}

export function getSalesQuotesSelect() {
  return SALES_QUOTES_SELECT;
}
