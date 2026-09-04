import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import type {
  QuoteConversationRow,
  QuoteLeadRow,
  QuoteStoreRow,
  SalesQuoteRow,
  SalesQuoteVersionRow,
} from "@/lib/server/sales-quotes/types";
import type { SalesContract, SalesContractVersion } from "./types";

type MembershipRow = {
  organization_id: string;
};

const SALES_QUOTES_SELECT =
  "id, organization_id, store_id, commercial_opportunity_id, conversation_id, lead_id, quote_number, title, status, customer_name, customer_phone, customer_notes, internal_notes, subtotal_cents, discount_cents, total_cents, current_version_id, last_change_request_id, metadata, created_at, updated_at";

const SALES_QUOTE_VERSIONS_SELECT =
  "id, quote_id, organization_id, store_id, version_number, status, store_file_id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, quote_snapshot, created_at, sent_at";

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

export class ContractAccessError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function uniqueOrganizationIds(rows: MembershipRow[]) {
  return Array.from(
    new Set(rows.map((row) => String(row.organization_id || "").trim()).filter(Boolean))
  );
}

export async function authenticateContractRequest() {
  const sessionSupabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await sessionSupabase.auth.getUser();

  if (authError || !user) {
    throw new ContractAccessError(401, "UNAUTHENTICATED", "Usuario nao autenticado.");
  }

  const supabase = createServiceSupabaseClient();
  const { data: memberships, error: membershipError } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id);

  if (membershipError) {
    throw new ContractAccessError(
      500,
      "LOAD_MEMBERSHIPS_FAILED",
      membershipError.message
    );
  }

  const organizationIds = uniqueOrganizationIds((memberships ?? []) as MembershipRow[]);

  if (organizationIds.length === 0) {
    throw new ContractAccessError(
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
  supabase: any;
  organizationIds: string[];
  requestOrganizationId?: string | null;
  requestStoreId: string;
}) {
  const requestStoreId = String(args.requestStoreId || "").trim();
  const requestOrganizationId = String(args.requestOrganizationId || "").trim();

  if (!requestStoreId) {
    throw new ContractAccessError(400, "INVALID_STORE_ID", "Store ID nao informado.");
  }

  const { data: store, error: storeError } = await args.supabase
    .from("stores")
    .select("id, organization_id, name, created_at")
    .eq("id", requestStoreId)
    .in("organization_id", args.organizationIds)
    .maybeSingle();

  if (storeError) {
    throw new ContractAccessError(500, "LOAD_STORE_FAILED", storeError.message);
  }

  if (!store) {
    throw new ContractAccessError(
      403,
      "STORE_FORBIDDEN",
      "Loja nao encontrada ou fora do escopo do usuario."
    );
  }

  if (requestOrganizationId && requestOrganizationId !== store.organization_id) {
    throw new ContractAccessError(
      403,
      "ORGANIZATION_STORE_MISMATCH",
      "A organizacao informada nao corresponde a loja selecionada."
    );
  }

  return store as QuoteStoreRow;
}

async function loadAuthorizedConversation(args: {
  supabase: any;
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
    throw new ContractAccessError(
      500,
      "LOAD_CONVERSATION_FAILED",
      conversationError.message
    );
  }

  if (!conversation) {
    throw new ContractAccessError(
      404,
      "CONVERSATION_NOT_FOUND",
      "Conversa nao encontrada para a organizacao informada."
    );
  }

  return conversation as QuoteConversationRow;
}

async function loadAuthorizedLead(args: {
  supabase: any;
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
    throw new ContractAccessError(500, "LOAD_LEAD_FAILED", leadError.message);
  }

  if (!lead) {
    throw new ContractAccessError(
      404,
      "LEAD_NOT_FOUND",
      "Lead nao encontrado para a organizacao informada."
    );
  }

  const leadStoreId = String(lead.store_id || "").trim();
  if (leadStoreId && leadStoreId !== args.storeId) {
    throw new ContractAccessError(
      403,
      "LEAD_STORE_MISMATCH",
      "A lead informada pertence a outra loja."
    );
  }

  return lead as QuoteLeadRow;
}

export async function resolveAuthorizedQuoteForContract(quoteId: string) {
  const auth = await authenticateContractRequest();
  const safeQuoteId = String(quoteId || "").trim();

  if (!safeQuoteId) {
    throw new ContractAccessError(400, "INVALID_QUOTE_ID", "Quote ID nao informado.");
  }

  const { data: quote, error: quoteError } = await auth.supabase
    .from("sales_quotes")
    .select(SALES_QUOTES_SELECT)
    .eq("id", safeQuoteId)
    .in("organization_id", auth.organizationIds)
    .maybeSingle();

  if (quoteError) {
    throw new ContractAccessError(500, "LOAD_QUOTE_FAILED", quoteError.message);
  }

  if (!quote) {
    throw new ContractAccessError(404, "QUOTE_NOT_FOUND", "Orcamento nao encontrado.");
  }

  const normalizedQuoteStatus = String(quote.status || "").trim().toLowerCase();
  if (normalizedQuoteStatus !== "approved" && normalizedQuoteStatus !== "sent") {
    throw new ContractAccessError(
      409,
      "QUOTE_STATUS_NOT_ALLOWED_FOR_CONTRACT",
      "Somente orcamentos approved ou sent podem originar contrato."
    );
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

  const currentVersionId = String(quote.current_version_id || "").trim();
  if (!currentVersionId) {
    throw new ContractAccessError(
      400,
      "QUOTE_VERSION_REQUIRED",
      "Este orcamento ainda nao possui current_version_id."
    );
  }

  const { data: quoteVersion, error: quoteVersionError } = await auth.supabase
    .from("sales_quote_versions")
    .select(SALES_QUOTE_VERSIONS_SELECT)
    .eq("id", currentVersionId)
    .eq("quote_id", quote.id)
    .eq("organization_id", quote.organization_id)
    .eq("store_id", quote.store_id)
    .maybeSingle();

  if (quoteVersionError) {
    throw new ContractAccessError(
      500,
      "LOAD_QUOTE_VERSION_FAILED",
      quoteVersionError.message
    );
  }

  if (!quoteVersion) {
    throw new ContractAccessError(
      404,
      "QUOTE_VERSION_NOT_FOUND",
      "Versao atual do orcamento nao encontrada."
    );
  }

  return {
    ...auth,
    userId: auth.user.id,
    organizationId: quote.organization_id,
    store,
    conversation,
    lead,
    quote: quote as SalesQuoteRow,
    quoteVersion: quoteVersion as SalesQuoteVersionRow,
  };
}

export async function resolveAuthorizedExistingContract(contractId: string) {
  const auth = await authenticateContractRequest();
  const safeContractId = String(contractId || "").trim();

  if (!safeContractId) {
    throw new ContractAccessError(
      400,
      "INVALID_CONTRACT_ID",
      "Contract ID nao informado."
    );
  }

  const { data: contract, error: contractError } = await auth.supabase
    .from("sales_contracts")
    .select("*")
    .eq("id", safeContractId)
    .in("organization_id", auth.organizationIds)
    .maybeSingle();

  if (contractError) {
    throw new ContractAccessError(500, "LOAD_CONTRACT_FAILED", contractError.message);
  }

  if (!contract) {
    throw new ContractAccessError(404, "CONTRACT_NOT_FOUND", "Contrato nao encontrado.");
  }

  const store = await loadAuthorizedStore({
    supabase: auth.supabase,
    organizationIds: auth.organizationIds,
    requestOrganizationId: contract.organization_id,
    requestStoreId: contract.store_id,
  });

  const conversation = await loadAuthorizedConversation({
    supabase: auth.supabase,
    organizationId: contract.organization_id,
    conversationId: contract.conversation_id,
  });

  const lead = await loadAuthorizedLead({
    supabase: auth.supabase,
    organizationId: contract.organization_id,
    storeId: contract.store_id,
    leadId: contract.lead_id,
  });

  let currentVersion: SalesContractVersion | null = null;
  const currentVersionId = String(contract.current_version_id || "").trim();

  if (currentVersionId) {
    const { data: version, error: versionError } = await auth.supabase
      .from("sales_contract_versions")
      .select("*")
      .eq("id", currentVersionId)
      .eq("contract_id", contract.id)
      .eq("organization_id", contract.organization_id)
      .eq("store_id", contract.store_id)
      .maybeSingle();

    if (versionError) {
      throw new ContractAccessError(
        500,
        "LOAD_CONTRACT_VERSION_FAILED",
        versionError.message
      );
    }

    currentVersion = (version ?? null) as SalesContractVersion | null;
  }

  return {
    ...auth,
    userId: auth.user.id,
    organizationId: contract.organization_id,
    store,
    conversation,
    lead,
    contract: contract as SalesContract,
    currentVersion,
  };
}
