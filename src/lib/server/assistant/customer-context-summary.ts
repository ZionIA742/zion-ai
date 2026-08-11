import type { ContractWorkflowDecisionTrigger } from "@/lib/server/sales-contracts/contract-workflow-decision";

type QueryError = { message: string };

type QueryResult<T> = Promise<{ data: T; error: QueryError | null }>;

type SupabaseQueryLike = {
  select(columns: string): SupabaseQueryLike;
  eq(field: string, value: unknown): SupabaseQueryLike;
  or(expression: string): SupabaseQueryLike;
  order(field: string, options?: { ascending?: boolean }): SupabaseQueryLike;
  limit(value: number): SupabaseQueryLike;
  maybeSingle(): QueryResult<unknown>;
  then<TResult1 = { data: unknown; error: QueryError | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: QueryError | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2>;
};

type SupabaseLike = {
  from(table: string): SupabaseQueryLike;
};

type BuildCustomerContextSummaryInput = {
  supabase: SupabaseLike;
  organizationId: string;
  storeId: string;
  leadId?: string | null;
  conversationId?: string | null;
  relatedMessageId?: string | null;
  quoteId?: string | null;
  quoteNumber?: string | null;
  customerName?: string | null;
  trigger: ContractWorkflowDecisionTrigger;
};

type LeadSummaryRow = {
  id: string;
  name: string | null;
  phone: string | null;
};

type QuoteSummaryRow = {
  id: string;
  organization_id: string;
  store_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  quote_number: string | null;
  status: string | null;
  total_cents: number | null;
  approved_at: string | null;
  sent_at: string | null;
};

type ContractSummaryRow = {
  id: string;
  organization_id: string;
  store_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  quote_id: string | null;
  contract_number: string | null;
  status: string | null;
  sent_at: string | null;
  customer_signed_at: string | null;
  completed_at: string | null;
  created_at: string | null;
};

type MessageSummaryRow = {
  id: string;
  sender: string | null;
  direction: string | null;
  content: string | null;
  created_at: string | null;
  organization_id?: string | null;
  store_id?: string | null;
  conversation_id?: string | null;
  conversation_session_id?: string | null;
  commercial_session_context_link_id?: string | null;
  commercial_context_capture_state?: string | null;
};

type ConversationSessionSnapshotRow = {
  id: string;
  organization_id: string;
  store_id: string;
  conversation_id: string;
};

type CommercialSessionContextLinkSnapshotRow = {
  id: string;
  organization_id: string;
  store_id: string;
  conversation_session_id: string;
  customer_id: string;
  commercial_opportunity_id: string;
  lead_customer_link_id: string;
};

export type HistoricalContextStatus =
  | "captured"
  | "pending_context"
  | "no_active_session"
  | "legacy_unknown"
  | "inconsistent";

export type RelatedMessageCommercialContext = {
  messageId: string;
  captureState: string | null;
  historicalContextStatus: HistoricalContextStatus;
  conversationSessionId: string | null;
  commercialSessionContextLinkId: string | null;
  customerId: string | null;
  commercialOpportunityId: string | null;
  leadCustomerLinkId: string | null;
};

type AppointmentSummaryRow = {
  id: string;
  appointment_type: string | null;
  status: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  created_at: string | null;
};

export type CustomerContextSummary = {
  customerName?: string;
  customerPhone?: string;
  quoteNumber?: string;
  quoteStatusLabel?: string;
  quoteTotalLabel?: string;
  quoteApprovedAt?: string;
  quoteSentAt?: string;
  contractNumber?: string;
  contractStatusLabel?: string;
  contractSentAt?: string;
  contractCustomerSignedAt?: string;
  contractCompletedAt?: string;
  latestCustomerMessage?: string;
  technicalVisitStatusLabel?: string;
  technicalVisitDate?: string;
  relatedMessageCommercialContext?: RelatedMessageCommercialContext;
  happened: string[];
  suggestedNextAction: string;
};

function cleanText(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatCurrencyBRL(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value / 100);
}

function formatDateBR(value: string | null | undefined) {
  const text = cleanText(value);
  if (!text) return null;

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function truncateText(value: string | null | undefined, maxLength = 180) {
  const text = cleanText(value);
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

function isCustomerMessage(message: MessageSummaryRow) {
  const sender = normalizeText(message.sender);
  const direction = normalizeText(message.direction);
  return (
    sender === "customer" ||
    sender === "cliente" ||
    direction === "incoming" ||
    direction === "inbound"
  );
}

function formatQuoteStatusLabel(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (normalized === "draft") return "Rascunho";
  if (normalized === "pending_review") return "Aguardando revisão";
  if (normalized === "approved") return "Aprovado";
  if (normalized === "sent") return "Enviado";
  if (normalized === "expired") return "Expirado";
  if (normalized === "cancelled") return "Cancelado";
  return cleanText(value) || null;
}

function formatContractStatusLabel(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (normalized === "draft") return "Rascunho";
  if (normalized === "pending_review") return "Em revisão";
  if (normalized === "approved") return "Aprovado";
  if (normalized === "sent" || normalized === "sent_to_customer") return "Enviado";
  if (normalized === "customer_signed") return "Assinado pelo cliente";
  if (normalized === "completed") return "Concluído";
  if (normalized === "cancelled") return "Cancelado";
  if (normalized === "expired") return "Expirado";
  return cleanText(value) || null;
}

function formatTechnicalVisitStatusLabel(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (normalized === "completed" || normalized === "fully_completed" || normalized === "done") {
    return "Concluída";
  }
  if (normalized === "scheduled") return "Agendada";
  if (normalized === "rescheduled") return "Reagendada";
  if (normalized === "cancelled") return "Cancelada";
  return cleanText(value) || null;
}

async function loadQuote(args: BuildCustomerContextSummaryInput) {
  const quoteId = cleanText(args.quoteId);
  if (!quoteId) return null;

  const { data, error } = await args.supabase
    .from("sales_quotes")
    .select(
      "id, organization_id, store_id, lead_id, conversation_id, quote_number, status, total_cents, approved_at, sent_at"
    )
    .eq("id", quoteId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar orçamento do resumo: ${error.message}`);
  }

  return (data || null) as QuoteSummaryRow | null;
}

async function loadLead(args: {
  supabase: SupabaseLike;
  organizationId: string;
  storeId: string;
  leadId?: string | null;
}) {
  const leadId = cleanText(args.leadId);
  if (!leadId) return null;

  const { data, error } = await args.supabase
    .from("leads")
    .select("id, name, phone")
    .eq("id", leadId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar lead do resumo: ${error.message}`);
  }

  return (data || null) as LeadSummaryRow | null;
}

async function loadLatestCustomerMessage(args: {
  supabase: SupabaseLike;
  organizationId: string;
  conversationId?: string | null;
}) {
  const conversationId = cleanText(args.conversationId);
  if (!conversationId) return null;

  const { data, error } = await args.supabase
    .from("messages")
    .select("id, sender, direction, content, created_at")
    .eq("organization_id", args.organizationId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) {
    throw new Error(`Falha ao carregar última mensagem do cliente: ${error.message}`);
  }

  const messages = ((data || []) as MessageSummaryRow[]).filter(isCustomerMessage);
  return messages[0] || null;
}

async function loadRelatedMessage(args: {
  supabase: SupabaseLike;
  organizationId: string;
  conversationId: string;
  relatedMessageId?: string | null;
}) {
  const relatedMessageId = cleanText(args.relatedMessageId);
  if (!relatedMessageId) return null;

  const { data, error } = await args.supabase
    .from("messages")
    .select(
      "id, organization_id, store_id, conversation_id, sender, direction, content, created_at, conversation_session_id, commercial_session_context_link_id, commercial_context_capture_state"
    )
    .eq("id", relatedMessageId)
    .eq("organization_id", args.organizationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar mensagem relacionada do resumo: ${error.message}`);
  }

  return (data || null) as MessageSummaryRow | null;
}

async function loadConversationSessionSnapshot(args: {
  supabase: SupabaseLike;
  organizationId: string;
  storeId: string;
  conversationId: string;
  conversationSessionId?: string | null;
}) {
  const conversationSessionId = cleanText(args.conversationSessionId);
  if (!conversationSessionId) return null;

  const { data, error } = await args.supabase
    .from("conversation_sessions")
    .select("id, organization_id, store_id, conversation_id")
    .eq("id", conversationSessionId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("conversation_id", args.conversationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar sessao historica da mensagem: ${error.message}`);
  }

  return (data || null) as ConversationSessionSnapshotRow | null;
}

async function loadCommercialSessionContextLinkSnapshot(args: {
  supabase: SupabaseLike;
  organizationId: string;
  storeId: string;
  commercialSessionContextLinkId?: string | null;
}) {
  const commercialSessionContextLinkId = cleanText(args.commercialSessionContextLinkId);
  if (!commercialSessionContextLinkId) return null;

  const { data, error } = await args.supabase
    .from("commercial_session_context_links")
    .select(
      "id, organization_id, store_id, conversation_session_id, customer_id, commercial_opportunity_id, lead_customer_link_id"
    )
    .eq("id", commercialSessionContextLinkId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Falha ao carregar vinculo historico da mensagem relacionada: ${error.message}`
    );
  }

  return (data || null) as CommercialSessionContextLinkSnapshotRow | null;
}

async function resolveRelatedMessageCommercialContext(args: {
  supabase: SupabaseLike;
  organizationId: string;
  conversationId?: string | null;
  relatedMessageId?: string | null;
}) {
  const conversationId = cleanText(args.conversationId);
  const relatedMessageId = cleanText(args.relatedMessageId);
  if (!relatedMessageId) return null;

  if (!conversationId) {
    return {
      messageId: relatedMessageId,
      captureState: null,
      historicalContextStatus: "inconsistent",
      conversationSessionId: null,
      commercialSessionContextLinkId: null,
      customerId: null,
      commercialOpportunityId: null,
      leadCustomerLinkId: null,
    } satisfies RelatedMessageCommercialContext;
  }

  const relatedMessage = await loadRelatedMessage({
    ...args,
    conversationId,
  });
  if (!relatedMessage) return null;

  const messageStoreId = cleanText(relatedMessage.store_id);
  const messageConversationId = cleanText(relatedMessage.conversation_id);
  const captureState = cleanText(relatedMessage.commercial_context_capture_state);
  const conversationSessionId = cleanText(relatedMessage.conversation_session_id);
  const commercialSessionContextLinkId = cleanText(
    relatedMessage.commercial_session_context_link_id
  );

  if (!messageStoreId || !messageConversationId) {
    return {
      messageId: relatedMessage.id,
      captureState,
      historicalContextStatus: "inconsistent",
      conversationSessionId,
      commercialSessionContextLinkId,
      customerId: null,
      commercialOpportunityId: null,
      leadCustomerLinkId: null,
    } satisfies RelatedMessageCommercialContext;
  }

  if (conversationId && messageConversationId !== conversationId) {
    return {
      messageId: relatedMessage.id,
      captureState,
      historicalContextStatus: "inconsistent",
      conversationSessionId,
      commercialSessionContextLinkId,
      customerId: null,
      commercialOpportunityId: null,
      leadCustomerLinkId: null,
    } satisfies RelatedMessageCommercialContext;
  }

  if (captureState === "no_active_session") {
    return {
      messageId: relatedMessage.id,
      captureState,
      historicalContextStatus: "no_active_session",
      conversationSessionId: null,
      commercialSessionContextLinkId: null,
      customerId: null,
      commercialOpportunityId: null,
      leadCustomerLinkId: null,
    } satisfies RelatedMessageCommercialContext;
  }

  if (captureState === "legacy_unknown") {
    return {
      messageId: relatedMessage.id,
      captureState,
      historicalContextStatus: "legacy_unknown",
      conversationSessionId: null,
      commercialSessionContextLinkId: null,
      customerId: null,
      commercialOpportunityId: null,
      leadCustomerLinkId: null,
    } satisfies RelatedMessageCommercialContext;
  }

  if (captureState === "pending_context") {
    const session = await loadConversationSessionSnapshot({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: messageStoreId,
      conversationId: messageConversationId,
      conversationSessionId,
    });

    return {
      messageId: relatedMessage.id,
      captureState,
      historicalContextStatus: session ? "pending_context" : "inconsistent",
      conversationSessionId,
      commercialSessionContextLinkId: null,
      customerId: null,
      commercialOpportunityId: null,
      leadCustomerLinkId: null,
    } satisfies RelatedMessageCommercialContext;
  }

  if (captureState === "captured") {
    const [session, contextLink] = await Promise.all([
      loadConversationSessionSnapshot({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: messageStoreId,
        conversationId: messageConversationId,
        conversationSessionId,
      }),
      loadCommercialSessionContextLinkSnapshot({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: messageStoreId,
        commercialSessionContextLinkId,
      }),
    ]);

    const isConsistent =
      Boolean(session) &&
      Boolean(contextLink) &&
      contextLink?.conversation_session_id === conversationSessionId;

    return {
      messageId: relatedMessage.id,
      captureState,
      historicalContextStatus: isConsistent ? "captured" : "inconsistent",
      conversationSessionId,
      commercialSessionContextLinkId,
      customerId: isConsistent ? contextLink?.customer_id || null : null,
      commercialOpportunityId: isConsistent
        ? contextLink?.commercial_opportunity_id || null
        : null,
      leadCustomerLinkId: isConsistent ? contextLink?.lead_customer_link_id || null : null,
    } satisfies RelatedMessageCommercialContext;
  }

  return {
    messageId: relatedMessage.id,
    captureState,
    historicalContextStatus: "inconsistent",
    conversationSessionId,
    commercialSessionContextLinkId,
    customerId: null,
    commercialOpportunityId: null,
    leadCustomerLinkId: null,
  } satisfies RelatedMessageCommercialContext;
}

async function loadLatestTechnicalVisit(args: {
  supabase: SupabaseLike;
  organizationId: string;
  storeId: string;
  leadId?: string | null;
  conversationId?: string | null;
}) {
  let query = args.supabase
    .from("store_appointments")
    .select("id, appointment_type, status, scheduled_start, scheduled_end, created_at")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("appointment_type", "technical_visit")
    .order("scheduled_end", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5);

  const conversationId = cleanText(args.conversationId);
  const leadId = cleanText(args.leadId);

  if (conversationId && leadId) {
    query = query.or(`conversation_id.eq.${conversationId},lead_id.eq.${leadId}`);
  } else if (conversationId) {
    query = query.eq("conversation_id", conversationId);
  } else if (leadId) {
    query = query.eq("lead_id", leadId);
  } else {
    return null;
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Falha ao carregar visita técnica do resumo: ${error.message}`);
  }

  const appointments = (data || []) as AppointmentSummaryRow[];
  return appointments[0] || null;
}

async function loadMainContract(args: {
  supabase: SupabaseLike;
  organizationId: string;
  storeId: string;
  quoteId?: string | null;
  leadId?: string | null;
  conversationId?: string | null;
}) {
  const quoteId = cleanText(args.quoteId);

  if (quoteId) {
    const { data, error } = await args.supabase
      .from("sales_contracts")
      .select(
        "id, organization_id, store_id, lead_id, conversation_id, quote_id, contract_number, status, sent_at, customer_signed_at, completed_at, created_at"
      )
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .eq("quote_id", quoteId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Falha ao carregar contrato do orçamento no resumo: ${error.message}`);
    }

    if (data) {
      return data as ContractSummaryRow;
    }
  }

  let query = args.supabase
    .from("sales_contracts")
    .select(
      "id, organization_id, store_id, lead_id, conversation_id, quote_id, contract_number, status, sent_at, customer_signed_at, completed_at, created_at"
    )
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .order("created_at", { ascending: false })
    .limit(5);

  const conversationId = cleanText(args.conversationId);
  const leadId = cleanText(args.leadId);

  if (conversationId && leadId) {
    query = query.or(`conversation_id.eq.${conversationId},lead_id.eq.${leadId}`);
  } else if (conversationId) {
    query = query.eq("conversation_id", conversationId);
  } else if (leadId) {
    query = query.eq("lead_id", leadId);
  } else {
    return null;
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Falha ao carregar contrato principal do resumo: ${error.message}`);
  }

  const contracts = (data || []) as ContractSummaryRow[];
  return contracts[0] || null;
}

function buildHappened(args: {
  trigger: ContractWorkflowDecisionTrigger;
  quote: QuoteSummaryRow | null;
  contract: ContractSummaryRow | null;
  appointment: AppointmentSummaryRow | null;
}) {
  const happened: string[] = [];

  if (args.trigger === "customer_requested_contract") {
    happened.push("Cliente pediu contrato na conversa.");
  } else if (args.trigger === "customer_accepted_quote") {
    happened.push("Cliente sinalizou aceite do orçamento na conversa.");
  }

  if (args.quote?.quote_number && normalizeText(args.quote.status) === "sent") {
    happened.push(`Orçamento ${args.quote.quote_number} já foi enviado.`);
  } else if (args.quote?.quote_number && normalizeText(args.quote.status) === "approved") {
    happened.push(`Orçamento ${args.quote.quote_number} já foi aprovado.`);
  }

  const visitStatus = normalizeText(args.appointment?.status);
  const visitDate =
    formatDateBR(args.appointment?.scheduled_end) ||
    formatDateBR(args.appointment?.scheduled_start);
  if (
    args.appointment &&
    ["completed", "fully_completed", "done"].includes(visitStatus)
  ) {
    happened.push(
      visitDate
        ? `Visita técnica concluída em ${visitDate}.`
        : "Visita técnica concluída."
    );
  }

  const contractStatus = normalizeText(args.contract?.status);
  if (!args.contract) {
    happened.push("Ainda não há contrato enviado ao cliente.");
  } else if (contractStatus === "pending_review") {
    happened.push("Já existe contrato em revisão.");
  } else if (contractStatus === "sent" || contractStatus === "sent_to_customer") {
    happened.push("Contrato já foi enviado ao cliente.");
  } else if (contractStatus === "customer_signed") {
    happened.push("Cliente já assinou o contrato.");
  } else if (contractStatus === "completed") {
    happened.push("Contrato já foi concluído.");
  }

  return happened.slice(0, 4);
}

function buildSuggestedNextAction(args: {
  quote: QuoteSummaryRow | null;
  contract: ContractSummaryRow | null;
  appointment: AppointmentSummaryRow | null;
}) {
  const contractStatus = normalizeText(args.contract?.status);
  const quoteStatus = normalizeText(args.quote?.status);
  const visitStatus = normalizeText(args.appointment?.status);

  if (contractStatus === "pending_review") {
    return "Revisar o contrato e decidir se ele pode ser enviado ao cliente.";
  }

  if (
    (contractStatus === "sent" || contractStatus === "sent_to_customer") &&
    !cleanText(args.contract?.customer_signed_at)
  ) {
    return "Acompanhar o aceite do cliente antes de avançar.";
  }

  if (contractStatus === "customer_signed" && !cleanText(args.contract?.completed_at)) {
    return "Conferir o contrato assinado pelo cliente e finalizar a confirmação da loja.";
  }

  if (!args.contract && (quoteStatus === "approved" || quoteStatus === "sent")) {
    return "Revisar o orçamento e, se estiver tudo certo, gerar contrato para revisão.";
  }

  if (
    !args.contract &&
    !args.quote &&
    ["completed", "fully_completed", "done"].includes(visitStatus)
  ) {
    return "Revisar o resultado da visita técnica e preparar ou ajustar o orçamento antes do contrato.";
  }

  return "Revisar o atendimento antes de decidir a próxima ação.";
}

export async function buildCustomerContextSummary(
  input: BuildCustomerContextSummaryInput
): Promise<CustomerContextSummary | null> {
  const quote = await loadQuote(input);
  const leadId = cleanText(quote?.lead_id) || cleanText(input.leadId);
  const conversationId =
    cleanText(quote?.conversation_id) || cleanText(input.conversationId);

  const [
    lead,
    latestCustomerMessage,
    latestTechnicalVisit,
    mainContract,
    relatedMessageCommercialContext,
  ] =
    await Promise.all([
      loadLead({
        supabase: input.supabase,
        organizationId: input.organizationId,
        storeId: input.storeId,
        leadId,
      }),
      loadLatestCustomerMessage({
        supabase: input.supabase,
        organizationId: input.organizationId,
        conversationId,
      }),
      loadLatestTechnicalVisit({
        supabase: input.supabase,
        organizationId: input.organizationId,
        storeId: input.storeId,
        leadId,
        conversationId,
      }),
      loadMainContract({
        supabase: input.supabase,
        organizationId: input.organizationId,
        storeId: input.storeId,
        quoteId: quote?.id || input.quoteId,
        leadId,
        conversationId,
      }),
      resolveRelatedMessageCommercialContext({
        supabase: input.supabase,
        organizationId: input.organizationId,
        conversationId,
        relatedMessageId: input.relatedMessageId,
      }),
    ]);

  const customerName =
    cleanText(lead?.name) ||
    cleanText(input.customerName);
  const customerPhone = cleanText(lead?.phone);
  const quoteNumber = cleanText(quote?.quote_number) || cleanText(input.quoteNumber);
  const quoteStatusLabel = formatQuoteStatusLabel(quote?.status);
  const quoteTotalLabel = formatCurrencyBRL(quote?.total_cents);
  const quoteApprovedAt = formatDateBR(quote?.approved_at);
  const quoteSentAt = formatDateBR(quote?.sent_at);
  const contractNumber = cleanText(mainContract?.contract_number);
  const contractStatusLabel = formatContractStatusLabel(mainContract?.status);
  const contractSentAt = formatDateBR(mainContract?.sent_at);
  const contractCustomerSignedAt = formatDateBR(mainContract?.customer_signed_at);
  const contractCompletedAt = formatDateBR(mainContract?.completed_at);
  const technicalVisitStatusLabel = formatTechnicalVisitStatusLabel(
    latestTechnicalVisit?.status
  );
  const technicalVisitDate =
    formatDateBR(latestTechnicalVisit?.scheduled_end) ||
    formatDateBR(latestTechnicalVisit?.scheduled_start);
  const latestCustomerMessageText = truncateText(latestCustomerMessage?.content, 180);
  const happened = buildHappened({
    trigger: input.trigger,
    quote,
    contract: mainContract,
    appointment: latestTechnicalVisit,
  });
  const suggestedNextAction = buildSuggestedNextAction({
    quote,
    contract: mainContract,
    appointment: latestTechnicalVisit,
  });

  const summary: CustomerContextSummary = {
    happened,
    suggestedNextAction,
  };

  if (customerName) summary.customerName = customerName;
  if (customerPhone) summary.customerPhone = customerPhone;
  if (quoteNumber) summary.quoteNumber = quoteNumber;
  if (quoteStatusLabel) summary.quoteStatusLabel = quoteStatusLabel;
  if (quoteTotalLabel) summary.quoteTotalLabel = quoteTotalLabel;
  if (quoteApprovedAt) summary.quoteApprovedAt = quoteApprovedAt;
  if (quoteSentAt) summary.quoteSentAt = quoteSentAt;
  if (contractNumber) summary.contractNumber = contractNumber;
  if (contractStatusLabel) summary.contractStatusLabel = contractStatusLabel;
  if (contractSentAt) summary.contractSentAt = contractSentAt;
  if (contractCustomerSignedAt) {
    summary.contractCustomerSignedAt = contractCustomerSignedAt;
  }
  if (contractCompletedAt) summary.contractCompletedAt = contractCompletedAt;
  if (latestCustomerMessageText) {
    summary.latestCustomerMessage = latestCustomerMessageText;
  }
  if (technicalVisitStatusLabel) {
    summary.technicalVisitStatusLabel = technicalVisitStatusLabel;
  }
  if (technicalVisitDate) summary.technicalVisitDate = technicalVisitDate;
  if (relatedMessageCommercialContext) {
    summary.relatedMessageCommercialContext = relatedMessageCommercialContext;
  }

  return summary;
}
