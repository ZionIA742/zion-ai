import type { ContractWorkflowDecisionTrigger } from "@/lib/server/sales-contracts/contract-workflow-decision";
import {
  buildCustomerContextSummary,
  type CustomerContextSummary,
  type RelatedMessageCommercialContext,
} from "@/lib/server/assistant/customer-context-summary";

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

type BuildCustomerContextReportInput = {
  supabase: SupabaseLike;
  organizationId: string;
  storeId: string;
  leadId?: string | null;
  conversationId?: string | null;
  quoteId: string;
  quoteNumber?: string | null;
  customerName?: string | null;
  trigger: ContractWorkflowDecisionTrigger;
  source?: string | null;
  relatedMessageId?: string | null;
};

type MessageRow = {
  id: string;
  sender: string | null;
  direction: string | null;
  content: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  conversation_session_id?: string | null;
  commercial_session_context_link_id?: string | null;
  commercial_context_capture_state?: string | null;
};

type OperationalTaskPayload = {
  handoff_origin?: string | null;
  recommended_model?: string | null;
  ad_model_or_requested_model?: string | null;
  customer_preferences?: string | null;
  conversation_summary?: string | null;
  relevant_objection?: string | null;
  last_customer_message?: string | null;
  space_text?: string | null;
  requested_area_m2?: number | string | null;
};

type OperationalTaskRow = {
  id: string;
  task_type: string | null;
  status: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  task_payload: OperationalTaskPayload | null;
  updated_at: string | null;
};

export type CustomerContextReportMetadata = {
  kind: "customer_context_report";
  organization_id: string;
  store_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  quote_id: string;
  quote_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  source: string | null;
  trigger: ContractWorkflowDecisionTrigger;
  report_key: string;
  related_message_id: string | null;
  title: string;
  subtitle: string;
  report_title: string;
  report_subtitle: string;
  narrative: string;
  source_label: string | null;
  main_interest: string | null;
  customer_goal: string | null;
  related_message_commercial_context: RelatedMessageCommercialContext | null;
  quote_number_label: string | null;
  quote_status_label: string | null;
  quote_total_label: string | null;
  contract_number: string | null;
  contract_status_label: string | null;
  technical_visit_label: string | null;
  current_status_label: string | null;
  conversation_highlights: string[];
  suggested_next_action: string;
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

function truncateText(value: string | null | undefined, maxLength = 220) {
  const text = cleanText(value);
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

function isCustomerMessage(message: MessageRow) {
  const sender = normalizeText(message.sender);
  const direction = normalizeText(message.direction);
  return (
    sender === "customer" ||
    sender === "cliente" ||
    direction === "incoming" ||
    direction === "inbound"
  );
}

function readMetadataText(
  metadata: Record<string, unknown> | null | undefined,
  keys: string[]
) {
  if (!metadata || typeof metadata !== "object") return null;
  for (const key of keys) {
    const value = cleanText(metadata[key]);
    if (value) return value;
  }
  return null;
}

async function loadRecentMessages(args: {
  supabase: SupabaseLike;
  organizationId: string;
  conversationId?: string | null;
}) {
  const conversationId = cleanText(args.conversationId);
  if (!conversationId) return [] as MessageRow[];

  const { data, error } = await args.supabase
    .from("messages")
    .select("id, sender, direction, content, metadata, created_at")
    .eq("organization_id", args.organizationId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) {
    throw new Error(
      `Falha ao carregar mensagens recentes para o relatorio: ${error.message}`
    );
  }

  return (data || []) as MessageRow[];
}

async function loadRecentOperationalTasks(args: {
  supabase: SupabaseLike;
  organizationId: string;
  storeId: string;
  leadId?: string | null;
  conversationId?: string | null;
}) {
  const conversationId = cleanText(args.conversationId);
  const leadId = cleanText(args.leadId);
  if (!conversationId && !leadId) return [] as OperationalTaskRow[];

  let query = args.supabase
    .from("store_assistant_operational_tasks")
    .select("id, task_type, status, customer_name, customer_phone, task_payload, updated_at")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .order("updated_at", { ascending: false })
    .limit(6);

  if (conversationId && leadId) {
    query = query.or(`related_conversation_id.eq.${conversationId},related_lead_id.eq.${leadId}`);
  } else if (conversationId) {
    query = query.eq("related_conversation_id", conversationId);
  } else if (leadId) {
    query = query.eq("related_lead_id", leadId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(
      `Falha ao carregar tarefas recentes para o relatorio: ${error.message}`
    );
  }

  return (data || []) as OperationalTaskRow[];
}

function resolveSourceLabel(messages: MessageRow[], tasks: OperationalTaskRow[]) {
  for (const message of messages) {
    const metadata = message.metadata;
    const channel = readMetadataText(metadata, [
      "channel",
      "source_channel",
      "provider",
    ]);
    const source = readMetadataText(metadata, ["source"]);
    const normalized = normalizeText(channel || source);

    if (normalized.includes("whatsapp")) return "WhatsApp";
    if (normalized.includes("instagram")) return "Instagram";
    if (normalized.includes("facebook")) return "Facebook";
  }

  for (const task of tasks) {
    const origin = normalizeText(task.task_payload?.handoff_origin);
    if (origin === "ai_sales") return "WhatsApp";
  }

  return null;
}

function resolveMainInterest(tasks: OperationalTaskRow[]) {
  for (const task of tasks) {
    const value =
      cleanText(task.task_payload?.ad_model_or_requested_model) ||
      cleanText(task.task_payload?.recommended_model);
    if (value) return value;
  }

  return null;
}

function resolveCustomerGoal(messages: MessageRow[], tasks: OperationalTaskRow[]) {
  for (const task of tasks) {
    const preference = cleanText(task.task_payload?.customer_preferences);
    if (preference) return preference;
  }

  const recentTexts = messages
    .filter(isCustomerMessage)
    .map((message) => normalizeText(message.content))
    .filter(Boolean);

  if (recentTexts.some((text) => text.includes("filho") || text.includes("crianca"))) {
    return "Busca uma opção adequada para os filhos.";
  }

  if (recentTexts.some((text) => text.includes("familia"))) {
    return "Quer uma opção voltada para a família.";
  }

  if (recentTexts.some((text) => text.includes("lazer") || text.includes("descanso"))) {
    return "Procura uma solução voltada para lazer.";
  }

  return null;
}

function resolveSpacePoint(tasks: OperationalTaskRow[]) {
  for (const task of tasks) {
    const spaceText = cleanText(task.task_payload?.space_text);
    if (spaceText) {
      return `O cliente informou ${spaceText} de espaço disponível.`;
    }

    const areaValue = cleanText(task.task_payload?.requested_area_m2);
    if (areaValue) {
      return `O cliente mencionou cerca de ${areaValue} m² de espaço disponível.`;
    }
  }

  return null;
}

function collectImportantConversationPoints(messages: MessageRow[], tasks: OperationalTaskRow[]) {
  const points: string[] = [];
  const pushPoint = (value: string | null) => {
    const text = cleanText(value);
    if (!text) return;
    if (!points.includes(text)) points.push(text);
  };

  const spacePoint = resolveSpacePoint(tasks);
  pushPoint(spacePoint);

  for (const task of tasks) {
    pushPoint(
      cleanText(task.task_payload?.relevant_objection)
        ? `Ponto relevante registrado: ${cleanText(task.task_payload?.relevant_objection)}.`
        : null
    );

    pushPoint(
      cleanText(task.task_payload?.conversation_summary)
        ? truncateText(task.task_payload?.conversation_summary, 180)
        : null
    );
  }

  const recentCustomerMessages = messages.filter(isCustomerMessage);
  for (const message of recentCustomerMessages) {
    const text = normalizeText(message.content);
    if (!text) continue;

    if (text.includes("contrato")) {
      pushPoint("O cliente pediu para seguir com o contrato.");
    }
    if (text.includes("orcamento") || text.includes("orçamento")) {
      pushPoint("O cliente mencionou o orçamento na conversa.");
    }
    if (text.includes("instal")) {
      pushPoint("O cliente trouxe dúvidas ou comentários sobre instalação.");
    }
    if (text.includes("entrega")) {
      pushPoint("O cliente trouxe dúvidas ou comentários sobre entrega.");
    }
    if (text.includes("pagamento") || text.includes("pix") || text.includes("parcela")) {
      pushPoint("O cliente trouxe dúvidas ou comentários sobre pagamento.");
    }
    if (text.includes("visita")) {
      pushPoint("O cliente mencionou visita técnica na conversa.");
    }
  }

  return points.slice(0, 6);
}

function buildCurrentSituation(args: {
  summary: CustomerContextSummary | null;
}) {
  const summary = args.summary;
  if (!summary) return "Atendimento em acompanhamento.";

  if (summary.contractStatusLabel === "Em revisão") {
    return "Já existe contrato em revisão e ele ainda depende da decisão do responsável.";
  }

  if (summary.contractStatusLabel === "Enviado") {
    return "O contrato já foi enviado ao cliente e o próximo passo é acompanhar o aceite.";
  }

  if (summary.contractStatusLabel === "Assinado pelo cliente") {
    return "O cliente já assinou o contrato e falta a confirmação final da loja.";
  }

  if (summary.quoteStatusLabel === "Enviado" || summary.quoteStatusLabel === "Aprovado") {
    return "O orçamento já está pronto para sustentar a decisão sobre o contrato.";
  }

  return "O atendimento ainda precisa de confirmação antes do próximo passo comercial.";
}

function buildHistoricalContextNarrative(
  relatedMessageCommercialContext: RelatedMessageCommercialContext | null | undefined
) {
  if (!relatedMessageCommercialContext) return null;

  if (relatedMessageCommercialContext.historicalContextStatus === "captured") {
    return "Contexto historico comprovado da mensagem relacionada: havia sessao comercial e vinculo comercial congelado para essa mensagem.";
  }

  if (relatedMessageCommercialContext.historicalContextStatus === "pending_context") {
    return "Contexto historico da mensagem relacionada: havia sessao comercial registrada, mas sem customer, oportunidade ou lead_customer_link historicos comprovados.";
  }

  if (relatedMessageCommercialContext.historicalContextStatus === "no_active_session") {
    return "Contexto historico da mensagem relacionada: nao havia sessao comercial historica para essa mensagem.";
  }

  if (relatedMessageCommercialContext.historicalContextStatus === "legacy_unknown") {
    return "Contexto historico da mensagem relacionada: o historico comercial dessa mensagem nao e comprovado.";
  }

  return "Contexto historico da mensagem relacionada: o snapshot existe, mas esta inconsistente e nao foi reinterpretado pelo contexto comercial atual.";
}

function buildNarrative(args: {
  summary: CustomerContextSummary | null;
  sourceLabel: string | null;
  mainInterest: string | null;
  customerGoal: string | null;
  latestCustomerMessage: string | null;
  importantPoints: string[];
  historicalContextNarrative: string | null;
}) {
  const customerName = cleanText(args.summary?.customerName) || "O cliente";
  const introParts = [
    `${customerName} entrou em contato${args.sourceLabel ? ` pelo ${args.sourceLabel}` : ""} e demonstrou interesse em avançar com o atendimento.`,
  ];

  if (args.mainInterest) {
    introParts.push(`Há interesse registrado em ${args.mainInterest}.`);
  }

  if (args.customerGoal) {
    introParts.push(args.customerGoal);
  }

  if (args.historicalContextNarrative) {
    introParts.push(args.historicalContextNarrative);
  }

  const quoteParts: string[] = [];
  if (args.summary?.quoteNumber && args.summary?.quoteStatusLabel) {
    let phrase = `O orçamento ${args.summary.quoteNumber} já está ${args.summary.quoteStatusLabel.toLowerCase()}`;
    if (args.summary.quoteTotalLabel) {
      phrase += `, no valor de ${args.summary.quoteTotalLabel}`;
    }
    quoteParts.push(`${phrase}.`);
  }

  if (args.latestCustomerMessage) {
    quoteParts.push(`Na última mensagem, o cliente disse: "${args.latestCustomerMessage}".`);
  }

  if (args.summary?.technicalVisitStatusLabel === "Concluída" && args.summary?.technicalVisitDate) {
    quoteParts.push(
      `Também há registro de visita técnica concluída em ${args.summary.technicalVisitDate}.`
    );
  }

  const closingParts: string[] = [];
  if (args.summary?.contractStatusLabel === "Enviado") {
    closingParts.push("No momento, o contrato já foi enviado ao cliente.");
  } else if (args.summary?.contractStatusLabel === "Assinado pelo cliente") {
    closingParts.push("No momento, o cliente já assinou o contrato e falta a confirmação da loja.");
  } else if (args.summary?.contractStatusLabel === "Em revisão") {
    closingParts.push("No momento, já existe um contrato em revisão.");
  } else {
    closingParts.push("No momento, ainda não há contrato enviado ao cliente.");
  }

  if (args.importantPoints.length > 0) {
    closingParts.push(args.importantPoints[0]);
  }

  return [introParts.join(" "), quoteParts.join(" "), closingParts.join(" ")]
    .map((item) => cleanText(item))
    .filter(Boolean)
    .join("\n\n");
}

export async function buildCustomerContextReportMetadata(
  input: BuildCustomerContextReportInput
): Promise<CustomerContextReportMetadata> {
  const summary = await buildCustomerContextSummary({
    ...input,
    relatedMessageId: input.relatedMessageId,
  });
  const recentMessages = await loadRecentMessages({
    supabase: input.supabase,
    organizationId: input.organizationId,
    conversationId: input.conversationId,
  });
  const recentTasks = await loadRecentOperationalTasks({
    supabase: input.supabase,
    organizationId: input.organizationId,
    storeId: input.storeId,
    leadId: input.leadId,
    conversationId: input.conversationId,
  });

  const relatedMessageId = cleanText(input.relatedMessageId);
  const latestCustomerMessage =
    recentMessages.find(
      (message) => isCustomerMessage(message) && cleanText(message.id) !== relatedMessageId
    )?.content || null;
  const sourceLabel = resolveSourceLabel(recentMessages, recentTasks);
  const mainInterest = resolveMainInterest(recentTasks);
  const customerGoal = resolveCustomerGoal(recentMessages, recentTasks);
  const importantPoints = collectImportantConversationPoints(recentMessages, recentTasks);
  const currentSituation = buildCurrentSituation({ summary });
  const historicalContextNarrative = buildHistoricalContextNarrative(
    summary?.relatedMessageCommercialContext
  );
  const reportKey = [
    "customer_context_report",
    cleanText(input.quoteId) || "unknown",
    cleanText(input.trigger) || "unknown",
    cleanText(input.source) || "unknown",
  ].join(":");

  const technicalVisitLabel =
    summary?.technicalVisitStatusLabel && summary?.technicalVisitDate
      ? `${summary.technicalVisitStatusLabel} em ${summary.technicalVisitDate}`
      : summary?.technicalVisitStatusLabel || summary?.technicalVisitDate || null;

  return {
    kind: "customer_context_report",
    organization_id: input.organizationId,
    store_id: input.storeId,
    lead_id: cleanText(input.leadId),
    conversation_id: cleanText(input.conversationId),
    quote_id: input.quoteId,
    quote_number: cleanText(summary?.quoteNumber) || cleanText(input.quoteNumber),
    customer_name: cleanText(summary?.customerName) || cleanText(input.customerName),
    customer_phone: cleanText(summary?.customerPhone),
    source: cleanText(input.source),
    trigger: input.trigger,
    report_key: reportKey,
    related_message_id: cleanText(input.relatedMessageId),
    title: "Relatório do cliente",
    subtitle: "Contexto para decisão do responsável",
    report_title: "Relatório do cliente",
    report_subtitle: "Contexto para decisão do responsável",
    narrative: buildNarrative({
      summary,
      sourceLabel,
      mainInterest,
      customerGoal,
      latestCustomerMessage: truncateText(latestCustomerMessage, 180),
      importantPoints,
      historicalContextNarrative,
    }),
    source_label: sourceLabel,
    main_interest: cleanText(mainInterest),
    customer_goal: cleanText(customerGoal),
    related_message_commercial_context: summary?.relatedMessageCommercialContext || null,
    quote_number_label: cleanText(summary?.quoteNumber) || cleanText(input.quoteNumber),
    quote_status_label: cleanText(summary?.quoteStatusLabel),
    quote_total_label: cleanText(summary?.quoteTotalLabel),
    contract_number: cleanText(summary?.contractNumber),
    contract_status_label: cleanText(summary?.contractStatusLabel),
    technical_visit_label: technicalVisitLabel,
    current_status_label: currentSituation,
    conversation_highlights: importantPoints,
    suggested_next_action:
      cleanText(summary?.suggestedNextAction) ||
      "Revisar o atendimento antes de decidir a próxima ação.",
  };
}
