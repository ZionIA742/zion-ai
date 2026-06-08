import { createClient } from "@supabase/supabase-js";
import {
  detectPaymentOrClosingSubtype,
  generateAiSalesReply,
  type CommercialHandoffContext,
  type OperationalFollowUpDecision,
  type PaymentOrClosingSubtype,
} from "./generate-ai-sales-reply";
import {
  evaluateContractWorkflowDecision,
  type ContractWorkflowDecisionTrigger,
} from "./sales-contracts/contract-workflow-decision";
import {
  buildCustomerContractAcceptanceConfirmationText,
  detectStrongCustomerContractAcceptance,
  findEligibleSentContractForCustomerAcceptance,
  signSalesContractAsCustomer,
} from "./sales-contracts/customer-contract-acceptance";
import { pushAssistantContractWorkflowDecisionMessage } from "./assistant/contract-workflow-messages";

type GenerateAndSaveAiSalesReplyParams = {
  organizationId: string;
  storeId: string;
  conversationId: string;
};

type GenerateAndSaveAiSalesReplyResult =
  | {
      ok: true;
      aiText: string;
      context?: any;
      usage?: AiSalesReplyUsage | null;
      persisted: true;
      messageId: string | null;
    }
  | {
      ok: false;
      error: string;
      message: string;
      aiText?: string;
      context?: any;
    };

type AiSalesReplyUsage = {
  provider?: string;
  model?: string;
  tokensPrompt?: number | null;
  tokensCompletion?: number | null;
  totalTokens?: number | null;
  costUsd?: number | null;
  inputTokenPriceUsdPer1M?: number | null;
  outputTokenPriceUsdPer1M?: number | null;
  pricingSource?: string;
};

type CatalogPhotoAction = {
  shouldSend: true;
  reason: "explicit_strong_product_photo_request";
  targetType: "pool" | "catalog_item";
  poolId: string | null;
  poolName: string | null;
  catalogItemId: string | null;
  catalogItemName: string | null;
  catalogItemSku: string | null;
  organizationId: string;
  storeId: string;
  source: "pool_photos" | "pool_photo_url" | "store_catalog_item_photos";
  bucket: "pool-photos" | "store-catalog-photos" | null;
  storagePath: string | null;
  publicUrl: string;
  caption: string;
};

type ConversationRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
  is_human_active: boolean | null;
};

type OpenOperationalTaskRow = {
  id: string;
  task_type: string | null;
  status: string | null;
  task_payload?: Record<string, unknown> | null;
};

type StoreScheduleSettingsRow = {
  timezone_name: string | null;
};

type CrmCardStateRow = {
  conversation_id: string | null;
  effective_state: string | null;
  lead_state: string | null;
  conversation_status: string | null;
  is_human_active: boolean | null;
};

type CrmAutoProgressResult = {
  attempted: boolean;
  progressed: boolean;
  reason: string;
  skippedReason?: string | null;
  currentState?: string | null;
  previousState?: string | null;
  error?: string | null;
};

type CommercialHandoffCreationResult = {
  created: boolean;
  skipped: boolean;
  reason: string;
  error?: string | null;
  taskId?: string | null;
  taskType?: string | null;
  notificationCreated?: boolean;
  notificationError?: string | null;
  crmAutoProgressAttempted?: boolean;
  crmAutoProgressed?: boolean;
  crmAutoProgressReason?: string | null;
  crmAutoProgressSkippedReason?: string | null;
  crmAutoProgressError?: string | null;
  crmAutoProgressResult?: CrmAutoProgressResult | null;
};

type ContractWorkflowQuoteCandidateRow = {
  id: string;
  organization_id: string;
  store_id: string;
  conversation_id: string | null;
  lead_id: string | null;
  quote_number: string | null;
  status: string | null;
  customer_name: string | null;
  total_cents: number | null;
  current_version_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ExistingContractStateRow = {
  id: string;
  status: string | null;
};

type CustomerIncomingMessageRow = {
  id: string;
  sender: string | null;
  direction: string | null;
  content: string | null;
  created_at: string | null;
};

type ConversationChannelMessageRow = {
  id: string;
  sender: string | null;
  direction: string | null;
  created_at: string | null;
  metadata?: Record<string, unknown> | null;
};

type ContractWorkflowCardCreationResult = {
  attempted: boolean;
  created: boolean;
  deduped?: boolean;
  reason: string;
  quoteId?: string | null;
  quoteNumber?: string | null;
  trigger?: ContractWorkflowDecisionTrigger | null;
  error?: string | null;
};

const NO_RESUME_REASON = "none";
const AUTO_PROGRESS_TO_ORCAMENTO_ALLOWED_FROM = new Set([
  "novo_lead",
  "qualificacao",
]);
const AUTO_PROGRESS_TO_ORCAMENTO_BLOCKED = new Set([
  "orcamento",
  "negociacao",
  "fechamento_pagamento",
  "pagamento_pendente_confirmacao",
  "agendar_instalacao",
  "pos_venda_nps",
  "perdido",
  "humano_assumiu",
]);
const AUTO_PROGRESS_TO_QUALIFICACAO_ALLOWED_FROM = new Set(["novo_lead"]);
const AUTO_PROGRESS_TO_QUALIFICACAO_BLOCKED = new Set([
  "qualificacao",
  "orcamento",
  "negociacao",
  "fechamento_pagamento",
  "pagamento_pendente_confirmacao",
  "agendar_instalacao",
  "pos_venda_nps",
  "perdido",
  "humano_assumiu",
]);

function normalizeCatalogPhotoAction(action: unknown): CatalogPhotoAction | null {
  if (!action || typeof action !== "object") {
    return null;
  }

  const candidate = action as Record<string, unknown>;
  const shouldSend = candidate.shouldSend === true;
  const targetType =
    candidate.targetType === "catalog_item" ? "catalog_item" : candidate.targetType === "pool" ? "pool" : null;
  const poolId = String(candidate.poolId || "").trim() || null;
  const poolName = String(candidate.poolName || "").trim() || null;
  const catalogItemId = String(candidate.catalogItemId || "").trim() || null;
  const catalogItemName = String(candidate.catalogItemName || "").trim() || null;
  const catalogItemSku = String(candidate.catalogItemSku || "").trim() || null;
  const organizationId = String(candidate.organizationId || "").trim();
  const storeId = String(candidate.storeId || "").trim();
  const publicUrl = String(candidate.publicUrl || "").trim();
  const source =
    candidate.source === "pool_photo_url"
      ? "pool_photo_url"
      : candidate.source === "pool_photos"
        ? "pool_photos"
        : candidate.source === "store_catalog_item_photos"
          ? "store_catalog_item_photos"
        : null;
  const bucket =
    candidate.bucket === "pool-photos"
      ? "pool-photos"
      : candidate.bucket === "store-catalog-photos"
        ? "store-catalog-photos"
        : null;
  const storagePath =
    typeof candidate.storagePath === "string" && candidate.storagePath.trim().length > 0
      ? candidate.storagePath.trim()
      : null;
  const caption = String(candidate.caption || "").trim();

  if (
    !shouldSend ||
    !targetType ||
    !organizationId ||
    !storeId ||
    !source ||
    !caption ||
    !/^https?:\/\//i.test(publicUrl) ||
    (targetType === "pool" && (!poolId || !poolName)) ||
    (targetType === "catalog_item" && !catalogItemId)
  ) {
    return null;
  }

  return {
    shouldSend: true,
    reason: "explicit_strong_product_photo_request",
    targetType,
    poolId,
    poolName,
    catalogItemId,
    catalogItemName,
    catalogItemSku,
    organizationId,
    storeId,
    source,
    bucket,
    storagePath,
    publicUrl,
    caption,
  };
}

type MessageBoundaryRow = {
  id: string;
  sender: string | null;
  direction: string | null;
  created_at: string | null;
};

type ConversationMessageBoundaryState = {
  lastIncomingCustomerMessageId: string | null;
  lastIncomingCustomerMessageAt: string | null;
  lastAiMessageId: string | null;
  lastAiMessageAt: string | null;
};

type OperationalTaskGuardResult =
  | {
      blocked: false;
    }
  | {
      blocked: true;
      reason: "open_operational_task" | "pending_operational_queue";
      taskId?: string | null;
      queueId?: string | null;
      taskType?: string | null;
      taskStatus?: string | null;
      queueStatus?: string | null;
    };

function isAiSalesCommercialHandoffTask(task: OpenOperationalTaskRow | null | undefined) {
  const taskType = normalizeText(task?.task_type);
  const payload =
    task?.task_payload && typeof task.task_payload === "object"
      ? task.task_payload
      : null;

  return (
    taskType === "commercial_visit_request" ||
    taskType === "commercial_quote_request" ||
    normalizeText(String(payload?.["handoff_origin"] || "")) === "ai_sales"
  );
}

function getOpenCommercialHandoffStatuses() {
  return [
    "open",
    "waiting_user_choice",
    "waiting_customer_response",
    "ready_to_execute",
    "in_progress",
  ];
}

async function findExistingCommercialHandoffTask(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  taskType: string;
}) {
  const { data, error } = await args.supabase
    .from("store_assistant_operational_tasks")
    .select("id, task_type, status, task_payload")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("related_conversation_id", args.conversationId)
    .in("status", getOpenCommercialHandoffStatuses())
    .in("task_type", ["commercial_visit_request", "commercial_quote_request"])
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    throw new Error(`Falha ao verificar handoff comercial existente: ${error.message}`);
  }

  return ((data || []) as OpenOperationalTaskRow[]).find(
    (task) => normalizeText(task.task_type) === normalizeText(args.taskType)
  );
}

function buildCommercialHandoffNotificationBody(handoff: CommercialHandoffContext) {
  const headline =
    handoff.taskType === "commercial_quote_request"
      ? `${handoff.customerName || "Cliente"} pediu um orcamento. Revise o contexto antes de retornar ao cliente.`
      : `${handoff.customerName || "Cliente"} pediu uma visita. Verifique disponibilidade e procedimento da loja antes de confirmar qualquer horario.`;

  const details = [
    handoff.spaceText ? `Espaco informado: ${handoff.spaceText}.` : null,
    handoff.customerPreferences
      ? `Preferencia: ${handoff.customerPreferences}.`
      : null,
    handoff.recommendedModel
      ? `Modelo recomendado: ${handoff.recommendedModel}.`
      : null,
    handoff.relevantObjection
      ? `Ponto relevante: ${handoff.relevantObjection}.`
      : null,
  ].filter(Boolean);

  return [headline, ...details].join(" ");
}

async function findExistingCommercialHandoffNotification(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string | null;
  taskId: string;
  notificationType: string;
}) {
  const { data, error } = await args.supabase
    .from("store_assistant_notification_queue")
    .select("id, notification_type, status, context")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("related_conversation_id", args.conversationId)
    .eq("related_lead_id", args.leadId || null)
    .eq("notification_type", args.notificationType)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(
      `Falha ao verificar notificacao comercial existente: ${error.message}`
    );
  }

  return ((data || []) as Array<{
    id?: string | null;
    context?: Record<string, unknown> | null;
    related_lead_id?: string | null;
  }>).find((row) => {
    const context =
      row.context && typeof row.context === "object" ? row.context : null;
    const sameTaskId = String(context?.["task_id"] || "").trim() === args.taskId;
    const sameSource = String(context?.["source"] || "").trim() === "ai_sales";
    return sameTaskId && sameSource;
  });
}

async function enqueueCommercialHandoffNotification(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string | null;
  taskId: string;
  handoff: CommercialHandoffContext;
}) {
  const notificationType = "important_alert";
  const title =
    args.handoff.taskType === "commercial_quote_request"
      ? "Novo pedido comercial de orcamento"
      : "Novo pedido comercial de visita";
  const body = buildCommercialHandoffNotificationBody(args.handoff);
  const eventKey = `ai_sales_handoff:${args.handoff.taskType}:${args.taskId}`;
  const context = {
    source: "ai_sales",
    reason: args.handoff.taskType,
    task_id: args.taskId,
    task_type: args.handoff.taskType,
    handoff_type: args.handoff.taskType,
    event_key: eventKey,
    conversation_id: args.conversationId,
    lead_id: args.leadId || null,
    customer_name: args.handoff.customerName || null,
    customer_phone: args.handoff.customerPhone || null,
    needs_human_action: true,
    space_text: args.handoff.spaceText || null,
    recommended_model: args.handoff.recommendedModel || null,
    customer_preferences: args.handoff.customerPreferences || null,
    relevant_objection: args.handoff.relevantObjection || null,
  };

  try {
    console.info("[zion-ai-sales-handoff] tentando criar notificacao interna", {
      organizationId: args.organizationId,
      storeId: args.storeId,
      conversationId: args.conversationId,
      leadId: args.leadId || null,
      taskId: args.taskId,
      taskType: args.handoff.taskType,
      notificationType,
      payload: {
        p_notification_type: notificationType,
        p_title: title,
        p_body: body,
        p_priority: "high",
        p_context: context,
      },
    });

    const existingNotification = await findExistingCommercialHandoffNotification({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      conversationId: args.conversationId,
      leadId: args.leadId || null,
      taskId: args.taskId,
      notificationType,
    });

    if (existingNotification?.id) {
      console.info("[zion-ai-sales-handoff] notificacao interna ignorada por dedupe", {
        organizationId: args.organizationId,
        storeId: args.storeId,
        conversationId: args.conversationId,
        leadId: args.leadId || null,
        taskId: args.taskId,
        taskType: args.handoff.taskType,
        notificationId: existingNotification.id,
      });

      return {
        created: false,
        error: null,
        reason: "similar_notification_already_exists",
      };
    }

    const { error } = await args.supabase.rpc("assistant_enqueue_internal_notification", {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_notification_type: notificationType,
      p_title: title,
      p_body: body,
      p_priority: "high",
      p_context: context,
      p_related_lead_id: args.leadId || null,
      p_related_conversation_id: args.conversationId,
      p_related_appointment_id: null,
      p_event_key: eventKey,
    });

    if (error) {
      console.warn(
        "[zion-ai-sales-handoff] assistant_enqueue_internal_notification error:",
        {
          organizationId: args.organizationId,
          storeId: args.storeId,
          conversationId: args.conversationId,
          leadId: args.leadId || null,
          taskId: args.taskId,
          taskType: args.handoff.taskType,
          notificationType,
          error,
        }
      );
      return {
        created: false,
        error: error.message || "COMMERCIAL_HANDOFF_NOTIFICATION_RPC_FAILED",
      };
    }

    console.info("[zion-ai-sales-handoff] notificacao interna criada via rpc", {
      organizationId: args.organizationId,
      storeId: args.storeId,
      conversationId: args.conversationId,
      leadId: args.leadId || null,
      taskId: args.taskId,
      taskType: args.handoff.taskType,
      notificationType,
    });

    return {
      created: true,
      error: null,
      reason: "notification_created",
    };
  } catch (error: any) {
    console.warn(
      "[zion-ai-sales-handoff] commercial handoff notification exception:",
      {
        organizationId: args.organizationId,
        storeId: args.storeId,
        conversationId: args.conversationId,
        leadId: args.leadId || null,
        taskId: args.taskId,
        taskType: args.handoff.taskType,
        notificationType,
        error,
      }
    );
    return {
      created: false,
      error:
        error?.message || "COMMERCIAL_HANDOFF_NOTIFICATION_EXCEPTION",
    };
  }
}

async function detectOpenAssistantOperationalFlow(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
}): Promise<OperationalTaskGuardResult> {
  const { supabase, organizationId, storeId, conversationId } = args;

  const openTaskStatuses = [
    "open",
    "waiting_user_choice",
    "waiting_customer_response",
    "ready_to_execute",
    "in_progress",
  ];

  const { data: openTasks, error: openTaskError } = await supabase
    .from("store_assistant_operational_tasks")
    .select("id, task_type, status, task_payload")
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .eq("related_conversation_id", conversationId)
    .in("status", openTaskStatuses)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(10);

  if (openTaskError) {
    throw new Error(
      `Falha ao verificar tarefas operacionais abertas: ${openTaskError.message}`
    );
  }

  const blockingTask = ((openTasks || []) as OpenOperationalTaskRow[]).find(
    (task) => !isAiSalesCommercialHandoffTask(task)
  );

  if (blockingTask) {
    return {
      blocked: true,
      reason: "open_operational_task",
      taskId: blockingTask.id || null,
      taskType: blockingTask.task_type || null,
      taskStatus: blockingTask.status || null,
    };
  }

  const { data: pendingQueue, error: pendingQueueError } = await supabase
    .from("store_assistant_operational_task_queue")
    .select("id, task_id, status")
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .eq("conversation_id", conversationId)
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingQueueError) {
    throw new Error(
      `Falha ao verificar fila operacional pendente: ${pendingQueueError.message}`
    );
  }

  if (pendingQueue) {
    return {
      blocked: true,
      reason: "pending_operational_queue",
      queueId: pendingQueue.id || null,
      taskId: pendingQueue.task_id || null,
      queueStatus: pendingQueue.status || null,
    };
  }

  return {
    blocked: false,
  };
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function cleanText(value: unknown): string | null {
  const text = String(value || "").trim();
  return text || null;
}

function hasAnyPhrase(text: string, phrases: string[]) {
  return phrases.some((phrase) => text.includes(phrase));
}

function hasNegativeClosingOrContractSignal(text: string) {
  return hasAnyPhrase(text, [
    "nao fechado",
    "nao esta fechado",
    "nao está fechado",
    "nao quero fechar",
    "nao vou fechar",
    "nao aceito",
    "nao aprovado",
    "nao manda contrato",
    "nao quero contrato",
    "nao precisa de contrato",
    "sem contrato",
  ]);
}

function inferPreContractCustomerSignalTrigger(
  lastCustomerMessage: string | null | undefined
): ContractWorkflowDecisionTrigger | null {
  const text = normalizeText(lastCustomerMessage);
  if (!text) return null;
  if (hasNegativeClosingOrContractSignal(text)) return null;

  const subtype = detectPaymentOrClosingSubtype(text);

  if (subtype === "contract_request") {
    const strongContractRequest = hasAnyPhrase(text, [
      "manda o contrato",
      "pode mandar o contrato",
      "me manda o contrato",
      "pode enviar o contrato",
      "envia o contrato",
      "quero o contrato",
      "emitir o contrato",
      "emite o contrato",
    ]);

    return strongContractRequest ? "customer_requested_contract" : null;
  }

  if (subtype === "closing_or_buying") {
    return "customer_accepted_quote";
  }

  const explicitAcceptanceSignal = hasAnyPhrase(text, [
    "aceito o orcamento",
    "aceito o orçamento",
    "orcamento aprovado",
    "orçamento aprovado",
    "esta aprovado",
    "está aprovado",
    "fechado",
    "vamos fechar",
    "quero fechar",
    "pode seguir",
    "vamos fazer",
  ]);

  return explicitAcceptanceSignal ? "customer_accepted_quote" : null;
}

function hasClearCommercialQualificationSignal(message: string | null | undefined): boolean {
  const raw = String(message || "").trim();
  const text = normalizeText(raw);

  if (!text) return false;
  if (text.length < 6) return false;

  const blockedExact = new Set([
    "oi",
    "ola",
    "olá",
    "bom dia",
    "boa tarde",
    "boa noite",
    "teste",
    "?",
    "ta ai",
    "tá aí",
    "chama",
    "preciso falar",
    "me chama",
  ]);

  if (blockedExact.has(text)) return false;

  const blockedPatterns = [
    /^o+i+$/,
    /^ola+$/,
    /^ol+a+$/,
    /^bom dia+$/,
    /^boa tarde+$/,
    /^boa noite+$/,
    /^ta ai\??$/,
    /^to ai\??$/,
    /^tem alguem ai\??$/,
    /^me chama+$/,
    /^chama+$/,
    /^preciso falar+$/,
    /^[?!. ]+$/,
  ];

  if (blockedPatterns.some((pattern) => pattern.test(text))) {
    return false;
  }

  const commercialPatterns = [
    /\bpiscina\b/,
    /\bpreco\b/,
    /\bvalor\b/,
    /\bquanto custa\b/,
    /\borcamento\b/,
    /\binstalac(?:ao|oes|ao)\b/,
    /\binstalar\b/,
    /\bfibra\b/,
    /\bvinil\b/,
    /\bpequena\b/,
    /\bgrande\b/,
    /\bchacara\b/,
    /\bcasa\b/,
    /\bespaco\b/,
    /\bmedida\b/,
    /\bmedidas\b/,
    /\bmetro\b/,
    /\bmetros\b/,
    /\bcabe\b/,
    /\banuncio\b/,
    /\bmodelo\b/,
    /\bcatalogo\b/,
    /\bentrega\b/,
    /\bmanutencao\b/,
    /\bproduto\b/,
    /\bacessorio\b/,
    /\bacessorios\b/,
    /\bquimico\b/,
    /\bquimicos\b/,
    /\bcloro\b/,
    /\bparecida\b/,
    /\bopcao\b/,
    /\bopcoes\b/,
    /\bminha cidade\b/,
    /\batendem\b/,
    /\batende\b/,
    /\bvi o anuncio\b/,
    /\bqueria saber\b/,
    /\bquero saber\b/,
    /\bquero uma piscina\b/,
    /\btenho um espaco\b/,
    /\btenho espaco\b/,
  ];

  return commercialPatterns.some((pattern) => pattern.test(text));
}

async function loadConservativeCrmStateForQuoteAutoProgress(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string | null;
}) {
  let rpcRow: CrmCardStateRow | null = null;

  try {
    const { data, error } = await args.supabase.rpc(
      "panel_list_crm_cards_scoped",
      {
        p_organization_id: args.organizationId,
        p_store_id: args.storeId || null,
        p_limit: 500,
        p_offset: 0,
      }
    );

    if (error) {
      console.warn("[zion-ai-sales-handoff] falha ao consultar estado efetivo do CRM", {
        organizationId: args.organizationId,
        storeId: args.storeId,
        conversationId: args.conversationId,
        error: error.message,
      });
    } else {
      rpcRow =
        ((data || []) as CrmCardStateRow[]).find(
          (row) => String(row.conversation_id || "").trim() === args.conversationId
        ) || null;
    }
  } catch (error: any) {
    console.warn("[zion-ai-sales-handoff] erro inesperado ao consultar estado efetivo do CRM", {
      organizationId: args.organizationId,
      storeId: args.storeId,
      conversationId: args.conversationId,
      error: error?.message || String(error),
    });
  }

  const { data: conversationRow, error: conversationError } = await args.supabase
    .from("conversations")
    .select("status, is_human_active")
    .eq("id", args.conversationId)
    .eq("organization_id", args.organizationId)
    .maybeSingle();

  if (conversationError) {
    throw new Error(
      `Falha ao consultar status atual da conversa para autoavanço do CRM: ${conversationError.message}`
    );
  }

  let leadState = "";

  if (args.leadId) {
    const { data: leadRow, error: leadError } = await args.supabase
      .from("leads")
      .select("state")
      .eq("id", args.leadId)
      .eq("organization_id", args.organizationId)
      .maybeSingle();

    if (leadError) {
      throw new Error(
        `Falha ao consultar estado atual do lead para autoavanço do CRM: ${leadError.message}`
      );
    }

    leadState = normalizeText(String(leadRow?.state || ""));
  }

  const effectiveState = normalizeText(rpcRow?.effective_state);
  const conversationStatus = normalizeText(
    String(conversationRow?.status || rpcRow?.conversation_status || "")
  );
  const rpcLeadState = normalizeText(rpcRow?.lead_state);
  const bestLeadState = leadState || rpcLeadState;
  const isHumanActive =
    conversationRow?.is_human_active === true || rpcRow?.is_human_active === true;

  if (effectiveState) {
    return {
      currentState: effectiveState,
      source: "crm_rpc_effective_state",
      isHumanActive,
      leadState: bestLeadState || null,
      conversationStatus: conversationStatus || null,
    };
  }

  if (isHumanActive || conversationStatus === "humano_assumiu") {
    return {
      currentState: "humano_assumiu",
      source: "conversation_human_control",
      isHumanActive,
      leadState: bestLeadState || null,
      conversationStatus: conversationStatus || null,
    };
  }

  const candidates = [conversationStatus, bestLeadState].filter(Boolean);
  const blockedCandidate = candidates.find((state) =>
    AUTO_PROGRESS_TO_ORCAMENTO_BLOCKED.has(state)
  );

  if (blockedCandidate) {
    return {
      currentState: blockedCandidate,
      source: "fallback_blocked_state",
      isHumanActive,
      leadState: bestLeadState || null,
      conversationStatus: conversationStatus || null,
    };
  }

  if (candidates.length === 0) {
    return {
      currentState: null,
      source: "state_not_found",
      isHumanActive,
      leadState: bestLeadState || null,
      conversationStatus: conversationStatus || null,
    };
  }

  const allAllowed = candidates.every((state) =>
    AUTO_PROGRESS_TO_ORCAMENTO_ALLOWED_FROM.has(state)
  );

  if (!allAllowed) {
    return {
      currentState: null,
      source: "state_not_safe_for_auto_progress",
      isHumanActive,
      leadState: bestLeadState || null,
      conversationStatus: conversationStatus || null,
    };
  }

  return {
    currentState:
      conversationStatus === "qualificacao" || bestLeadState === "qualificacao"
        ? "qualificacao"
        : "novo_lead",
    source: "fallback_allowed_state",
    isHumanActive,
    leadState: bestLeadState || null,
    conversationStatus: conversationStatus || null,
  };
}

async function maybeAutoProgressCrmToBudgetFromQuoteHandoff(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string | null;
  taskId: string;
  handoff: CommercialHandoffContext;
}): Promise<CrmAutoProgressResult> {
  if (args.handoff.taskType !== "commercial_quote_request") {
    console.info("[zion-ai-sales-handoff] autoavanço do CRM ignorado", {
      reason: "handoff_is_not_quote_request",
      taskId: args.taskId,
      taskType: args.handoff.taskType,
      conversationId: args.conversationId,
    });
    return {
      attempted: false,
      progressed: false,
      reason: "handoff_is_not_quote_request",
      skippedReason: "handoff_is_not_quote_request",
    };
  }

  if (!args.organizationId || !args.conversationId) {
    console.info("[zion-ai-sales-handoff] autoavanço do CRM ignorado", {
      reason: "missing_organization_or_conversation",
      taskId: args.taskId,
      taskType: args.handoff.taskType,
      conversationId: args.conversationId,
    });
    return {
      attempted: false,
      progressed: false,
      reason: "missing_organization_or_conversation",
      skippedReason: "missing_organization_or_conversation",
    };
  }

  const stateSnapshot = await loadConservativeCrmStateForQuoteAutoProgress({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    conversationId: args.conversationId,
    leadId: args.leadId || null,
  });

  if (!stateSnapshot.currentState) {
    console.info("[zion-ai-sales-handoff] autoavanço do CRM ignorado", {
      reason: stateSnapshot.source,
      taskId: args.taskId,
      taskType: args.handoff.taskType,
      conversationId: args.conversationId,
      leadState: stateSnapshot.leadState,
      conversationStatus: stateSnapshot.conversationStatus,
      isHumanActive: stateSnapshot.isHumanActive,
    });
    return {
      attempted: false,
      progressed: false,
      reason: stateSnapshot.source,
      skippedReason: stateSnapshot.source,
    };
  }

  if (!AUTO_PROGRESS_TO_ORCAMENTO_ALLOWED_FROM.has(stateSnapshot.currentState)) {
    console.info("[zion-ai-sales-handoff] autoavanço do CRM ignorado", {
      reason: "current_state_not_allowed",
      taskId: args.taskId,
      taskType: args.handoff.taskType,
      conversationId: args.conversationId,
      currentState: stateSnapshot.currentState,
      stateSource: stateSnapshot.source,
      leadState: stateSnapshot.leadState,
      conversationStatus: stateSnapshot.conversationStatus,
      isHumanActive: stateSnapshot.isHumanActive,
    });
    return {
      attempted: false,
      progressed: false,
      reason: "current_state_not_allowed",
      skippedReason: "current_state_not_allowed",
      currentState: stateSnapshot.currentState,
    };
  }

  if (stateSnapshot.currentState === "novo_lead") {
    console.info("[zion-ai-sales-handoff] autoavanço do CRM tentando transição em duas etapas", {
      taskId: args.taskId,
      taskType: args.handoff.taskType,
      conversationId: args.conversationId,
      currentState: stateSnapshot.currentState,
      stateSource: stateSnapshot.source,
      leadState: stateSnapshot.leadState,
      conversationStatus: stateSnapshot.conversationStatus,
    });

    const { error: qualificationError } = await args.supabase.rpc(
      "panel_transition_conversation_state_scoped",
      {
        p_organization_id: args.organizationId,
        p_conversation_id: args.conversationId,
        p_to_state: "qualificacao",
        p_reason: "auto_progress_from_ai_sales_quote_request_prepare_qualification",
      }
    );

    if (qualificationError) {
      console.warn("[zion-ai-sales-handoff] falha na primeira etapa do autoavanço para orçamento", {
        taskId: args.taskId,
        taskType: args.handoff.taskType,
        conversationId: args.conversationId,
        fromState: stateSnapshot.currentState,
        toState: "qualificacao",
        error: qualificationError.message,
        details: (qualificationError as any)?.details ?? null,
        hint: (qualificationError as any)?.hint ?? null,
        code: (qualificationError as any)?.code ?? null,
      });
      return {
        attempted: true,
        progressed: false,
        reason: "crm_transition_to_qualification_failed",
        currentState: stateSnapshot.currentState,
        error: qualificationError.message,
      };
    }

    console.info("[zion-ai-sales-handoff] primeira etapa do autoavanço concluída", {
      taskId: args.taskId,
      taskType: args.handoff.taskType,
      conversationId: args.conversationId,
      fromState: "novo_lead",
      toState: "qualificacao",
    });

    const { error: budgetAfterQualificationError } = await args.supabase.rpc(
      "panel_transition_conversation_state_scoped",
      {
        p_organization_id: args.organizationId,
        p_conversation_id: args.conversationId,
        p_to_state: "orcamento",
        p_reason: "auto_progress_from_ai_sales_quote_request",
      }
    );

    if (budgetAfterQualificationError) {
      console.warn("[zion-ai-sales-handoff] falha na segunda etapa do autoavanço para orçamento", {
        taskId: args.taskId,
        taskType: args.handoff.taskType,
        conversationId: args.conversationId,
        fromState: "qualificacao",
        toState: "orcamento",
        error: budgetAfterQualificationError.message,
        details: (budgetAfterQualificationError as any)?.details ?? null,
        hint: (budgetAfterQualificationError as any)?.hint ?? null,
        code: (budgetAfterQualificationError as any)?.code ?? null,
      });
      return {
        attempted: true,
        progressed: false,
        reason: "crm_transition_to_budget_failed_after_qualification",
        previousState: "qualificacao",
        currentState: "qualificacao",
        error: budgetAfterQualificationError.message,
      };
    }

    console.info("[zion-ai-sales-handoff] segunda etapa do autoavanço concluída", {
      taskId: args.taskId,
      taskType: args.handoff.taskType,
      conversationId: args.conversationId,
      fromState: "qualificacao",
      toState: "orcamento",
    });

    return {
      attempted: true,
      progressed: true,
      reason: "crm_auto_progress_completed_via_qualification",
      previousState: stateSnapshot.currentState,
      currentState: "orcamento",
    };
  }

  console.info("[zion-ai-sales-handoff] autoavanço do CRM tentando mover para orçamento", {
    taskId: args.taskId,
    taskType: args.handoff.taskType,
    conversationId: args.conversationId,
    currentState: stateSnapshot.currentState,
    stateSource: stateSnapshot.source,
    leadState: stateSnapshot.leadState,
    conversationStatus: stateSnapshot.conversationStatus,
  });

  const { error } = await args.supabase.rpc(
    "panel_transition_conversation_state_scoped",
    {
      p_organization_id: args.organizationId,
      p_conversation_id: args.conversationId,
      p_to_state: "orcamento",
      p_reason: "auto_progress_from_ai_sales_quote_request",
    }
  );

  if (error) {
    console.warn("[zion-ai-sales-handoff] erro ao autoavancar CRM para orçamento", {
      taskId: args.taskId,
      taskType: args.handoff.taskType,
      conversationId: args.conversationId,
      currentState: stateSnapshot.currentState,
      stateSource: stateSnapshot.source,
      error: error.message,
      details: (error as any)?.details ?? null,
      hint: (error as any)?.hint ?? null,
      code: (error as any)?.code ?? null,
    });
    return {
      attempted: true,
      progressed: false,
      reason: "crm_transition_rpc_failed",
      currentState: stateSnapshot.currentState,
      error: error.message,
    };
  }

  console.info("[zion-ai-sales-handoff] autoavanço do CRM concluído", {
    taskId: args.taskId,
    taskType: args.handoff.taskType,
    conversationId: args.conversationId,
    fromState: stateSnapshot.currentState,
    toState: "orcamento",
  });

  return {
    attempted: true,
    progressed: true,
    reason: "crm_auto_progress_completed",
    previousState: stateSnapshot.currentState,
    currentState: "orcamento",
  };
}

async function maybeAutoProgressCrmToQualificationFromSalesSignal(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string | null;
  lastCustomerMessage: string | null | undefined;
}): Promise<CrmAutoProgressResult> {
  if (!args.organizationId || !args.conversationId) {
    console.info("[zion-ai-sales-qualification] autoavanço ignorado", {
      reason: "missing_organization_or_conversation",
      conversationId: args.conversationId,
    });
    return {
      attempted: false,
      progressed: false,
      reason: "missing_organization_or_conversation",
      skippedReason: "missing_organization_or_conversation",
    };
  }

  if (!hasClearCommercialQualificationSignal(args.lastCustomerMessage)) {
    console.info("[zion-ai-sales-qualification] autoavanço ignorado", {
      reason: "no_clear_commercial_signal",
      conversationId: args.conversationId,
      lastCustomerMessage: args.lastCustomerMessage || null,
    });
    return {
      attempted: false,
      progressed: false,
      reason: "no_clear_commercial_signal",
      skippedReason: "no_clear_commercial_signal",
    };
  }

  const stateSnapshot = await loadConservativeCrmStateForQuoteAutoProgress({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    conversationId: args.conversationId,
    leadId: args.leadId || null,
  });

  if (!stateSnapshot.currentState) {
    console.info("[zion-ai-sales-qualification] autoavanço ignorado", {
      reason: stateSnapshot.source,
      conversationId: args.conversationId,
      leadState: stateSnapshot.leadState,
      conversationStatus: stateSnapshot.conversationStatus,
      isHumanActive: stateSnapshot.isHumanActive,
    });
    return {
      attempted: false,
      progressed: false,
      reason: stateSnapshot.source,
      skippedReason: stateSnapshot.source,
    };
  }

  if (AUTO_PROGRESS_TO_QUALIFICACAO_BLOCKED.has(stateSnapshot.currentState)) {
    console.info("[zion-ai-sales-qualification] autoavanço ignorado", {
      reason: "current_state_blocked",
      conversationId: args.conversationId,
      currentState: stateSnapshot.currentState,
      leadState: stateSnapshot.leadState,
      conversationStatus: stateSnapshot.conversationStatus,
      isHumanActive: stateSnapshot.isHumanActive,
    });
    return {
      attempted: false,
      progressed: false,
      reason: "current_state_blocked",
      skippedReason: "current_state_blocked",
      currentState: stateSnapshot.currentState,
    };
  }

  if (!AUTO_PROGRESS_TO_QUALIFICACAO_ALLOWED_FROM.has(stateSnapshot.currentState)) {
    console.info("[zion-ai-sales-qualification] autoavanço ignorado", {
      reason: "current_state_not_allowed",
      conversationId: args.conversationId,
      currentState: stateSnapshot.currentState,
      leadState: stateSnapshot.leadState,
      conversationStatus: stateSnapshot.conversationStatus,
      isHumanActive: stateSnapshot.isHumanActive,
    });
    return {
      attempted: false,
      progressed: false,
      reason: "current_state_not_allowed",
      skippedReason: "current_state_not_allowed",
      currentState: stateSnapshot.currentState,
    };
  }

  console.info("[zion-ai-sales-qualification] autoavanço tentando mover para qualificação", {
    conversationId: args.conversationId,
    currentState: stateSnapshot.currentState,
    leadState: stateSnapshot.leadState,
    conversationStatus: stateSnapshot.conversationStatus,
    isHumanActive: stateSnapshot.isHumanActive,
  });

  const { error } = await args.supabase.rpc(
    "panel_transition_conversation_state_scoped",
    {
      p_organization_id: args.organizationId,
      p_conversation_id: args.conversationId,
      p_to_state: "qualificacao",
      p_reason: "auto_progress_from_ai_sales_qualification_signal",
    }
  );

  if (error) {
    console.warn("[zion-ai-sales-qualification] erro ao autoavançar CRM para qualificação", {
      conversationId: args.conversationId,
      currentState: stateSnapshot.currentState,
      error: error.message,
      details: (error as any)?.details ?? null,
      hint: (error as any)?.hint ?? null,
      code: (error as any)?.code ?? null,
    });
    return {
      attempted: true,
      progressed: false,
      reason: "crm_transition_rpc_failed",
      currentState: stateSnapshot.currentState,
      error: error.message,
    };
  }

  console.info("[zion-ai-sales-qualification] autoavanço concluído", {
    conversationId: args.conversationId,
    fromState: stateSnapshot.currentState,
    toState: "qualificacao",
  });

  return {
    attempted: true,
    progressed: true,
    reason: "crm_auto_progress_completed",
    previousState: stateSnapshot.currentState,
  };
}

function isCustomerIncomingMessage(row: MessageBoundaryRow): boolean {
  return (
    normalizeText(row.sender) === "user" &&
    normalizeText(row.direction) === "incoming"
  );
}

function isAiOutgoingMessage(row: MessageBoundaryRow): boolean {
  const sender = normalizeText(row.sender);

  return (
    sender.includes("ai") ||
    sender.includes("assistant") ||
    sender.includes("bot")
  );
}

function compareIsoDates(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  const aTime = Date.parse(a);
  const bTime = Date.parse(b);

  if (!Number.isFinite(aTime) && !Number.isFinite(bTime)) return 0;
  if (!Number.isFinite(aTime)) return -1;
  if (!Number.isFinite(bTime)) return 1;

  return aTime - bTime;
}

async function loadConversationMessageBoundaryState(args: {
  supabase: any;
  conversationId: string;
}): Promise<ConversationMessageBoundaryState> {
  const { supabase, conversationId } = args;

  const { data, error } = await supabase
    .from("messages")
    .select("id, sender, direction, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(
      `Falha ao verificar mensagens recentes da conversa: ${error.message}`
    );
  }

  const rows = Array.isArray(data) ? (data as MessageBoundaryRow[]) : [];
  const lastIncomingCustomerMessage =
    rows.find(isCustomerIncomingMessage) || null;
  const lastAiMessage = rows.find(isAiOutgoingMessage) || null;

  return {
    lastIncomingCustomerMessageId: lastIncomingCustomerMessage?.id || null,
    lastIncomingCustomerMessageAt:
      lastIncomingCustomerMessage?.created_at || null,
    lastAiMessageId: lastAiMessage?.id || null,
    lastAiMessageAt: lastAiMessage?.created_at || null,
  };
}

function hasAiReplyAfterLatestCustomerMessage(
  state: ConversationMessageBoundaryState
): boolean {
  if (!state.lastIncomingCustomerMessageAt || !state.lastAiMessageAt) {
    return false;
  }

  return (
    compareIsoDates(
      state.lastAiMessageAt,
      state.lastIncomingCustomerMessageAt
    ) > 0
  );
}

async function loadLatestIncomingCustomerMessage(args: {
  supabase: any;
  conversationId: string;
}): Promise<CustomerIncomingMessageRow | null> {
  const { data, error } = await args.supabase
    .from("messages")
    .select("id, sender, direction, content, created_at")
    .eq("conversation_id", args.conversationId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(
      `Falha ao carregar a ultima mensagem do cliente: ${error.message}`
    );
  }

  const rows = Array.isArray(data) ? (data as CustomerIncomingMessageRow[]) : [];
  return rows.find(isCustomerIncomingMessage) || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRealWhatsappIncomingMessage(row: ConversationChannelMessageRow): boolean {
  if (String(row.sender || "").trim() !== "user") {
    return false;
  }

  if (String(row.direction || "").trim() !== "incoming") {
    return false;
  }

  const metadata = isRecord(row.metadata) ? row.metadata : null;
  if (!metadata) {
    return false;
  }

  return (
    String(metadata.source || "").trim() === "meta_whatsapp_webhook" &&
    String(metadata.channel || "").trim() === "whatsapp" &&
    String(metadata.external_channel || "").trim() === "whatsapp"
  );
}

async function conversationHasRecentRealWhatsappIncomingMessage(args: {
  supabase: any;
  conversationId: string;
}): Promise<boolean> {
  const { data, error } = await args.supabase
    .from("messages")
    .select("id, sender, direction, created_at, metadata")
    .eq("conversation_id", args.conversationId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(
      `Falha ao verificar origem WhatsApp da conversa: ${error.message}`
    );
  }

  const rows = Array.isArray(data) ? (data as ConversationChannelMessageRow[]) : [];
  return rows.some(isRealWhatsappIncomingMessage);
}

async function hasActiveWhatsappIntegration(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
}): Promise<boolean> {
  const { data, error } = await args.supabase
    .from("external_integrations")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("provider", "whatsapp")
    .eq("is_active", true)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Falha ao verificar integracao WhatsApp ativa: ${error.message}`
    );
  }

  return Boolean(data && typeof data === "object" && "id" in data && data.id);
}

async function isRealWhatsappConversation(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
}): Promise<boolean> {
  const [hasRecentIncomingWhatsappMessage, hasWhatsappIntegration] =
    await Promise.all([
      conversationHasRecentRealWhatsappIncomingMessage({
        supabase: args.supabase,
        conversationId: args.conversationId,
      }),
      hasActiveWhatsappIntegration({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
      }),
    ]);

  return hasRecentIncomingWhatsappMessage && hasWhatsappIntegration;
}

async function insertAiWhatsappMessage(args: {
  supabase: any;
  conversationId: string;
  aiText: string;
}) {
  const metadata = {
    source: "ai_sales_reply",
    channel: "whatsapp",
    external_channel: "whatsapp",
    send_external: true,
    outbound_origin: "ai_sales_reply",
    whatsapp_detected_from_conversation: true,
  };

  const { data, error } = await args.supabase.rpc("insert_message", {
    p_conversation_id: args.conversationId,
    p_sender: "ai",
    p_direction: "outgoing",
    p_message_type: "text",
    p_content: args.aiText,
    p_external_message_id: null,
    p_media_url: null,
    p_metadata: metadata,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  return row?.id || null;
}

async function sendAiPanelMessage(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  aiText: string;
}) {
  try {
    const whatsappConversation = await isRealWhatsappConversation({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      conversationId: args.conversationId,
    });

    if (whatsappConversation) {
      return await insertAiWhatsappMessage(args);
    }
  } catch (whatsappDetectionError: any) {
    console.warn("[zion-ai-sales-reply] Falha ao detectar conversa WhatsApp real", {
      organizationId: args.organizationId,
      storeId: args.storeId,
      conversationId: args.conversationId,
      error:
        whatsappDetectionError instanceof Error
          ? whatsappDetectionError.message
          : String(whatsappDetectionError || ""),
    });
  }

  const { data: messageId, error: sendError } = await args.supabase.rpc(
    "panel_send_message",
    {
      p_conversation_id: args.conversationId,
      p_text: args.aiText,
      p_sender: "ai",
      p_external_message_id: null,
    }
  );

  if (sendError) {
    throw new Error(sendError.message);
  }

  return messageId ?? null;
}

function isValidTimeZone(timeZone: string | null | undefined): boolean {
  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: String(timeZone || "").trim() || "America/Sao_Paulo",
    }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function safeTimeZone(timeZone: string | null | undefined): string {
  return isValidTimeZone(timeZone) ? String(timeZone).trim() : "America/Sao_Paulo";
}

function getTimeZoneOffsetMinutes(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values: Record<string, number> = {};

  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }

  const localAsUtc = Date.UTC(
    values.year || date.getUTCFullYear(),
    (values.month || 1) - 1,
    values.day || 1,
    values.hour || 0,
    values.minute || 0,
    values.second || 0
  );

  return Math.round((localAsUtc - date.getTime()) / 60000);
}

function getLocalDateParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);

  const values: Record<string, number> = {};

  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }

  return {
    year: values.year || value.getUTCFullYear(),
    month: values.month || value.getUTCMonth() + 1,
    day: values.day || value.getUTCDate(),
  };
}

function localDateTimePartsToUtcIso(args: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}) {
  const approximateUtc = new Date(
    Date.UTC(args.year, args.month - 1, args.day, args.hour, args.minute, 0)
  );
  const offsetMinutes = getTimeZoneOffsetMinutes(args.timeZone, approximateUtc);
  return new Date(approximateUtc.getTime() - offsetMinutes * 60000).toISOString();
}

function addDaysToLocalDateParts(parts: {
  year: number;
  month: number;
  day: number;
}, days: number) {
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);
  return {
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate(),
  };
}

function formatQueueTimestamp(value: string, timeZone: string): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values: Record<string, string> = {};

  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  return `${values.year || "0000"}${values.month || "00"}${values.day || "00"}${values.hour || "00"}${values.minute || "00"}`;
}

function formatLocalAuditStamp(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

function isFutureIso(value: string | null | undefined, now = new Date()): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return parsed > now.getTime();
}

function resolveResumeAtFromDecision(args: {
  decision: OperationalFollowUpDecision;
  timeZone: string;
  now?: Date;
}): string | null {
  if (args.decision.kind !== "schedule_resume") {
    return null;
  }

  const baseDateParts = getLocalDateParts(args.now || new Date(), args.timeZone);

  if (args.decision.reason === "customer_requested_tomorrow") {
    const target = addDaysToLocalDateParts(baseDateParts, 1);
    return localDateTimePartsToUtcIso({
      ...target,
      hour: 9,
      minute: 0,
      timeZone: args.timeZone,
    });
  }

  if (args.decision.reason === "customer_requested_next_week") {
    const target = addDaysToLocalDateParts(baseDateParts, 7);
    return localDateTimePartsToUtcIso({
      ...target,
      hour: 9,
      minute: 0,
      timeZone: args.timeZone,
    });
  }

  if (args.decision.reason === "customer_requested_next_month") {
    const target = addDaysToLocalDateParts(baseDateParts, 30);
    return localDateTimePartsToUtcIso({
      ...target,
      hour: 9,
      minute: 0,
      timeZone: args.timeZone,
    });
  }

  return null;
}

async function loadStoreTimeZone(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
}): Promise<string> {
  const { data, error } = await args.supabase
    .from("store_schedule_settings")
    .select("timezone_name")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (error) {
    console.warn("[ai-sales-followup] Falha ao carregar timezone da loja", {
      organizationId: args.organizationId,
      storeId: args.storeId,
      error: error.message,
    });
    return "America/Sao_Paulo";
  }

  return safeTimeZone((data as StoreScheduleSettingsRow | null)?.timezone_name);
}

async function clearPendingResumeArtifacts(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  customerMessageAt?: string | null;
  preserveReason?: boolean;
  nextResumeReason?: string | null;
  queueCancelReason: string;
}) {
  const {
    supabase,
    organizationId,
    storeId,
    conversationId,
    customerMessageAt,
    preserveReason,
    nextResumeReason,
    queueCancelReason,
  } = args;
  const nowIso = new Date().toISOString();

  const windowPatch: Record<string, unknown> = {
    conversation_id: conversationId,
    organization_id: organizationId,
    store_id: storeId,
    waiting_next_day: false,
    next_resume_at: null,
    updated_at: nowIso,
  };

  if (customerMessageAt) {
    windowPatch.last_customer_message_at = customerMessageAt;
  }

  if (preserveReason) {
    windowPatch.resume_reason = nextResumeReason || NO_RESUME_REASON;
  } else {
    windowPatch.resume_reason = NO_RESUME_REASON;
  }

  const { error: windowError } = await supabase
    .from("conversation_ai_window_state")
    .upsert(windowPatch, { onConflict: "conversation_id" });

  if (windowError) {
    throw new Error(
      `Falha ao limpar estado pendente de retomada: ${windowError.message}`
    );
  }

  const queuePrefix = `resume:${conversationId}:`;
  const { error: queueError } = await supabase
    .from("ai_run_queue")
    .update({
      processed_at: nowIso,
      processing_error: queueCancelReason,
    })
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .eq("conversation_id", conversationId)
    .is("processed_at", null)
    .like("queue_key", `${queuePrefix}%`);

  if (queueError) {
    throw new Error(
      `Falha ao invalidar retomadas pendentes: ${queueError.message}`
    );
  }
}

async function persistOperationalFollowUpDecision(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string | null;
  decision: OperationalFollowUpDecision;
  lastCustomerMessageAt: string | null;
  lastAiMessageAt: string | null;
}) {
  const {
    supabase,
    organizationId,
    storeId,
    conversationId,
    leadId,
    decision,
    lastCustomerMessageAt,
    lastAiMessageAt,
  } = args;

  if (!decision || decision.kind === "none") {
    return;
  }

  const timeZone = await loadStoreTimeZone({
    supabase,
    organizationId,
    storeId,
  });

  if (decision.kind === "stop_contact") {
    await clearPendingResumeArtifacts({
      supabase,
      organizationId,
      storeId,
      conversationId,
      customerMessageAt: lastCustomerMessageAt,
      preserveReason: true,
      nextResumeReason: decision.reason,
      queueCancelReason: "cancelled_by_stop_contact",
    });

    const { error: stopWindowError } = await supabase
      .from("conversation_ai_window_state")
      .update({
        resume_reason: decision.reason,
        last_ai_message_at: lastAiMessageAt,
        pending_supervisor: false,
        waiting_next_day: false,
        updated_at: new Date().toISOString(),
      })
      .eq("conversation_id", conversationId);

    if (stopWindowError) {
      throw new Error(
        `Falha ao marcar bloqueio de retomada: ${stopWindowError.message}`
      );
    }

    return;
  }

  const nextResumeAt = resolveResumeAtFromDecision({
    decision,
    timeZone,
  });

  const windowPayload: Record<string, unknown> = {
    conversation_id: conversationId,
    organization_id: organizationId,
    store_id: storeId,
    waiting_next_day: decision.reason === "customer_requested_tomorrow",
    pending_supervisor: false,
    last_ai_message_at: lastAiMessageAt,
    last_customer_message_at: lastCustomerMessageAt,
    next_resume_at: nextResumeAt,
    resume_reason: decision.reason,
    updated_at: new Date().toISOString(),
  };

  const { error: upsertError } = await supabase
    .from("conversation_ai_window_state")
    .upsert(windowPayload, { onConflict: "conversation_id" });

  if (upsertError) {
    throw new Error(
      `Falha ao persistir janela operacional da conversa: ${upsertError.message}`
    );
  }

  if (decision.kind !== "schedule_resume" || !nextResumeAt) {
    return;
  }

  await clearPendingResumeArtifacts({
    supabase,
    organizationId,
    storeId,
    conversationId,
    customerMessageAt: lastCustomerMessageAt,
    preserveReason: true,
    nextResumeReason: decision.reason,
    queueCancelReason: "replaced_by_new_resume_schedule",
  });

  const refreshedWindowPayload = {
    ...windowPayload,
    updated_at: new Date().toISOString(),
  };

  const { error: refreshWindowError } = await supabase
    .from("conversation_ai_window_state")
    .upsert(refreshedWindowPayload, { onConflict: "conversation_id" });

  if (refreshWindowError) {
    throw new Error(
      `Falha ao restaurar janela operacional apos deduplicacao: ${refreshWindowError.message}`
    );
  }

  const now = new Date();

  if (isFutureIso(nextResumeAt, now)) {
    return;
  }

  const queueKey = `resume:${conversationId}:${decision.reason}:${formatQueueTimestamp(nextResumeAt, timeZone)}`;
  const input = {
    type: "resume_sales_conversation",
    reason: decision.reason,
    resumeAt: nextResumeAt,
    system_event: "ai_window_resume",
    resume_mode: decision.reason,
    style_hint: "Retomar de forma natural, humana e sem pressão. Não justificar atraso.",
    created_at_iso: now.toISOString(),
    created_at_local: formatLocalAuditStamp(now, timeZone),
    created_at_sp: formatLocalAuditStamp(now, "America/Sao_Paulo"),
    queue_key: queueKey,
    next_resume_at: nextResumeAt,
    timing_label: decision.timingLabel || null,
    requested_timing: decision.requestedTiming || null,
    timezone_name: timeZone,
  };

  const { error: insertQueueError } = await supabase
    .from("ai_run_queue")
    .insert({
      organization_id: organizationId,
      store_id: storeId,
      conversation_id: conversationId,
      lead_id: leadId,
      queue_key: queueKey,
      input,
      enqueued_at: now.toISOString(),
      processed_at: null,
      processing_error: null,
    });

  if (insertQueueError) {
    throw new Error(
      `Falha ao enfileirar retomada operacional: ${insertQueueError.message}`
    );
  }
}


function cleanIntegerOrNull(value: unknown): number | null {
  if (value == null) return null;

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return null;

  return Math.max(0, Math.round(parsed));
}

function cleanCostOrNull(value: unknown): number | null {
  if (value == null) return null;

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return null;

  return Number(parsed.toFixed(8));
}

async function updateLatestRunningAiRunUsage(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  usage?: AiSalesReplyUsage | null;
}) {
  const { supabase, organizationId, storeId, conversationId, usage } = args;

  if (!usage) {
    return;
  }

  const updatePayload: Record<string, unknown> = {
    provider: usage.provider || "openai",
    model: usage.model || null,
    tokens_prompt: cleanIntegerOrNull(usage.tokensPrompt),
    tokens_completion: cleanIntegerOrNull(usage.tokensCompletion),
    cost_usd: cleanCostOrNull(usage.costUsd),
  };

  const metadataPayload = {
    usage_capture_source: "generate-and-save-ai-sales-reply",
    total_tokens: cleanIntegerOrNull(usage.totalTokens),
    input_token_price_usd_per_1m: cleanCostOrNull(
      usage.inputTokenPriceUsdPer1M
    ),
    output_token_price_usd_per_1m: cleanCostOrNull(
      usage.outputTokenPriceUsdPer1M
    ),
    pricing_source: usage.pricingSource || null,
    captured_at: new Date().toISOString(),
  };

  const { data: activeRun, error: activeRunError } = await supabase
    .from("ai_runs")
    .select("id, input")
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .eq("conversation_id", conversationId)
    .in("status", ["running", "queued"])
    .order("started_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeRunError) {
    throw new Error(
      `Falha ao localizar ai_run ativo para registrar uso: ${activeRunError.message}`
    );
  }

  if (!activeRun?.id) {
    return;
  }

  const currentInput =
    activeRun.input && typeof activeRun.input === "object"
      ? activeRun.input
      : {};

  const { error: updateError } = await supabase
    .from("ai_runs")
    .update({
      ...updatePayload,
      input: {
        ...currentInput,
        usage_metadata: metadataPayload,
      },
    })
    .eq("id", activeRun.id);

  if (updateError) {
    throw new Error(
      `Falha ao registrar uso/custo no ai_run: ${updateError.message}`
    );
  }
}

async function createCommercialAssistantHandoff(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string | null;
  handoff: CommercialHandoffContext | null | undefined;
}): Promise<CommercialHandoffCreationResult> {
  const handoff = args.handoff;

  if (!handoff || !handoff.shouldCreateTask) {
    return { created: false, skipped: true, reason: "handoff_not_requested" };
  }

  const similarTask = await findExistingCommercialHandoffTask({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    conversationId: args.conversationId,
    taskType: handoff.taskType,
  });

  if (similarTask) {
    return {
      created: false,
      skipped: true,
      reason: "similar_open_handoff_already_exists",
      taskId: similarTask.id || null,
    };
  }

  const title =
    handoff.taskType === "commercial_quote_request"
      ? `Orçamento comercial pendente${handoff.customerName ? `: ${handoff.customerName}` : ""}`
      : `Visita comercial pendente${handoff.customerName ? `: ${handoff.customerName}` : ""}`;

  const payload = {
    handoff_origin: "ai_sales",
    allow_sales_ai_while_pending: true,
    intent: handoff.intent,
    needs_human_action: true,
    handoff_created: true,
    handoff_type: handoff.taskType,
    space_text: handoff.spaceText,
    requested_area_m2: handoff.requestedAreaM2,
    location_text: handoff.locationText,
    preferred_period_text: handoff.preferredPeriodText,
    recommended_model: handoff.recommendedModel,
    relevant_objection: handoff.relevantObjection,
    customer_preferences: handoff.customerPreferences,
    ad_model_or_requested_model: handoff.adModelOrRequestedModel,
    last_customer_message: handoff.lastCustomerMessage,
    conversation_summary: handoff.conversationSummary,
    next_step: handoff.nextStep,
    created_by: "generate-and-save-ai-sales-reply",
  };

  const { data, error } = await args.supabase
    .from("store_assistant_operational_tasks")
    .insert({
      organization_id: args.organizationId,
      store_id: args.storeId,
      thread_id: null,
      task_type: handoff.taskType,
      status: "open",
      priority: handoff.taskType === "commercial_visit_request" ? "high" : "normal",
      title,
      description: handoff.conversationSummary || handoff.nextStep,
      related_lead_id: args.leadId || null,
      related_conversation_id: args.conversationId,
      related_appointment_id: null,
      customer_name: handoff.customerName || null,
      customer_phone: handoff.customerPhone || null,
      target_date: null,
      target_time: null,
      target_start_at: null,
      target_end_at: null,
      timezone_name: "America/Sao_Paulo",
      task_payload: payload,
      last_action_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error || !data?.id) {
    throw new Error(
      error?.message || "TASK_INSERT_NOT_CONFIRMED_FOR_COMMERCIAL_HANDOFF"
    );
  }

  const notificationResult = await enqueueCommercialHandoffNotification({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    conversationId: args.conversationId,
    leadId: args.leadId || null,
    taskId: String(data.id),
    handoff,
  });

  let crmAutoProgressResult: CrmAutoProgressResult | undefined;

  try {
    crmAutoProgressResult = await maybeAutoProgressCrmToBudgetFromQuoteHandoff({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      conversationId: args.conversationId,
      leadId: args.leadId || null,
      taskId: String(data.id),
      handoff,
    });
  } catch (error: any) {
    console.warn("[zion-ai-sales-handoff] falha inesperada no autoavanço do CRM", {
      taskId: String(data.id),
      taskType: handoff.taskType,
      conversationId: args.conversationId,
      error: error?.message || String(error),
    });
    crmAutoProgressResult = {
      attempted: true,
      progressed: false,
      reason: "crm_auto_progress_unexpected_failure",
      error: error?.message || String(error),
    };
  }

  return {
    created: true,
    skipped: false,
    reason: "handoff_created",
    taskId: String(data.id),
    taskType: handoff.taskType,
    notificationCreated: notificationResult.created,
    notificationError: notificationResult.error,
    crmAutoProgressAttempted: crmAutoProgressResult?.attempted === true,
    crmAutoProgressed: crmAutoProgressResult?.progressed === true,
    crmAutoProgressReason: crmAutoProgressResult?.reason || null,
    crmAutoProgressSkippedReason: crmAutoProgressResult?.skippedReason || null,
    crmAutoProgressError: crmAutoProgressResult?.error || null,
    crmAutoProgressResult: crmAutoProgressResult || null,
  };
}

async function loadEligibleQuotesByConversationOrLead(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId?: string | null;
  leadId?: string | null;
}) {
  const select =
    "id, organization_id, store_id, conversation_id, lead_id, quote_number, status, customer_name, total_cents, current_version_id, created_at, updated_at";

  const loadByConversation = async () => {
    const conversationId = cleanText(args.conversationId);
    if (!conversationId) return [] as ContractWorkflowQuoteCandidateRow[];

    const { data, error } = await args.supabase
      .from("sales_quotes")
      .select(select)
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .eq("conversation_id", conversationId)
      .in("status", ["approved", "sent"])
      .not("current_version_id", "is", null)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      throw new Error(
        `Falha ao carregar orcamentos elegiveis por conversa: ${error.message}`
      );
    }

    return (data || []) as ContractWorkflowQuoteCandidateRow[];
  };

  const loadByLead = async () => {
    const leadId = cleanText(args.leadId);
    if (!leadId) return [] as ContractWorkflowQuoteCandidateRow[];

    const { data, error } = await args.supabase
      .from("sales_quotes")
      .select(select)
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .eq("lead_id", leadId)
      .in("status", ["approved", "sent"])
      .not("current_version_id", "is", null)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      throw new Error(
        `Falha ao carregar orcamentos elegiveis por lead: ${error.message}`
      );
    }

    return (data || []) as ContractWorkflowQuoteCandidateRow[];
  };

  return {
    byConversation: await loadByConversation(),
    byLead: await loadByLead(),
  };
}

function pickInequivocalQuoteCandidate(args: {
  byConversation: ContractWorkflowQuoteCandidateRow[];
  byLead: ContractWorkflowQuoteCandidateRow[];
}) {
  if (args.byConversation.length === 1) {
    return {
      candidate: args.byConversation[0],
      source: "conversation_id" as const,
    };
  }

  if (args.byConversation.length > 1) {
    return {
      candidate: null,
      source: "conversation_id" as const,
      ambiguous: true,
    };
  }

  if (args.byLead.length === 1) {
    return {
      candidate: args.byLead[0],
      source: "lead_id" as const,
    };
  }

  if (args.byLead.length > 1) {
    return {
      candidate: null,
      source: "lead_id" as const,
      ambiguous: true,
    };
  }

  return {
    candidate: null,
    source: "none" as const,
    ambiguous: false,
  };
}

async function loadExistingContractsForQuote(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  quoteId: string;
}) {
  const { data, error } = await args.supabase
    .from("sales_contracts")
    .select("id, status")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("quote_id", args.quoteId);

  if (error) {
    throw new Error(`Falha ao carregar contratos do orcamento: ${error.message}`);
  }

  return (data || []) as ExistingContractStateRow[];
}

async function maybeCreateAssistantPreContractCardFromCustomerSignal(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string | null;
  customerName: string | null;
  lastCustomerMessage: string | null | undefined;
}) : Promise<ContractWorkflowCardCreationResult> {
  const trigger = inferPreContractCustomerSignalTrigger(args.lastCustomerMessage);
  if (!trigger) {
    return {
      attempted: false,
      created: false,
      reason: "no_clear_pre_contract_signal",
    };
  }

  const quoteCandidates = await loadEligibleQuotesByConversationOrLead({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    conversationId: args.conversationId,
    leadId: args.leadId,
  });

  const selectedQuote = pickInequivocalQuoteCandidate(quoteCandidates);
  if (!selectedQuote.candidate) {
    return {
      attempted: true,
      created: false,
      reason: selectedQuote.ambiguous ? "quote_ambiguous" : "quote_not_found",
      trigger,
    };
  }

  const existingContracts = await loadExistingContractsForQuote({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    quoteId: selectedQuote.candidate.id,
  });

  const decision = evaluateContractWorkflowDecision({
    quote: {
      id: selectedQuote.candidate.id,
      status: selectedQuote.candidate.status,
      lead_id: selectedQuote.candidate.lead_id,
      conversation_id: selectedQuote.candidate.conversation_id,
      store_id: selectedQuote.candidate.store_id,
      organization_id: selectedQuote.candidate.organization_id,
      total_cents: selectedQuote.candidate.total_cents,
      current_version_id: selectedQuote.candidate.current_version_id,
    },
    trigger,
    hasHumanConfirmation: false,
    existingContracts,
  });

  if (!decision.needsHumanConfirmation || decision.allowed) {
    return {
      attempted: true,
      created: false,
      reason: "decision_did_not_require_human_card",
      quoteId: selectedQuote.candidate.id,
      quoteNumber: cleanText(selectedQuote.candidate.quote_number),
      trigger,
    };
  }

  if (
    decision.reasonCode !== "CUSTOMER_SIGNAL_REQUIRES_HUMAN_CONFIRMATION" &&
    decision.reasonCode !== "TECHNICAL_VISIT_REQUIRED_BEFORE_CONTRACT"
  ) {
    return {
      attempted: true,
      created: false,
      reason: decision.reasonCode,
      quoteId: selectedQuote.candidate.id,
      quoteNumber: cleanText(selectedQuote.candidate.quote_number),
      trigger,
    };
  }

  const summary =
    trigger === "customer_requested_contract"
      ? "O cliente pediu contrato na conversa comercial."
      : "O cliente deu sinal de aceite/fechamento na conversa comercial.";

  const pushResult = await pushAssistantContractWorkflowDecisionMessage({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    leadId: selectedQuote.candidate.lead_id || args.leadId,
    conversationId: selectedQuote.candidate.conversation_id || args.conversationId,
    quoteId: selectedQuote.candidate.id,
    quoteNumber: cleanText(selectedQuote.candidate.quote_number),
    customerName:
      cleanText(selectedQuote.candidate.customer_name) || cleanText(args.customerName),
    trigger,
    decision,
    summary,
    sourceOverride: "sales_ai_customer_signal_v1",
  });

  return {
    attempted: true,
    created: pushResult.created === true,
    deduped: pushResult.deduped === true,
    reason: pushResult.deduped ? "assistant_card_deduped" : "assistant_card_created",
    quoteId: selectedQuote.candidate.id,
    quoteNumber: cleanText(selectedQuote.candidate.quote_number),
    trigger,
  };
}


export async function generateAndSaveAiSalesReply(
  params: GenerateAndSaveAiSalesReplyParams
): Promise<GenerateAndSaveAiSalesReplyResult> {
  try {
    const organizationId = String(params.organizationId || "").trim();
    const storeId = String(params.storeId || "").trim();
    const conversationId = String(params.conversationId || "").trim();

    if (!organizationId || !storeId || !conversationId) {
      return {
        ok: false,
        error: "MISSING_REQUIRED_FIELDS",
        message: "organizationId, storeId e conversationId são obrigatórios.",
      };
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return {
        ok: false,
        error: "SUPABASE_ENV_MISSING",
        message:
          "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.",
      };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id, organization_id, lead_id, is_human_active")
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (conversationError) {
      return {
        ok: false,
        error: "CONVERSATION_LOOKUP_FAILED",
        message: conversationError.message,
      };
    }

    if (!conversation) {
      return {
        ok: false,
        error: "CONVERSATION_NOT_FOUND",
        message: "Conversa não encontrada para a organização informada.",
      };
    }

    const normalizedConversation = conversation as ConversationRow;

    if (normalizedConversation.is_human_active) {
      return {
        ok: false,
        error: "HUMAN_HANDOFF_ACTIVE",
        message:
          "A conversa está com humano ativo. A IA não deve responder automaticamente.",
      };
    }

    const operationalGuard = await detectOpenAssistantOperationalFlow({
      supabase,
      organizationId,
      storeId,
      conversationId,
    });

    if (operationalGuard.blocked) {
      return {
        ok: false,
        error: "OPERATIONAL_TASK_ACTIVE_FOR_CONVERSATION",
        message:
          "Existe uma tarefa operacional da assistente ativa para esta conversa. A IA vendedora não deve responder automaticamente enquanto a assistente operacional conduz essa tratativa.",
        context: {
          guard: operationalGuard,
        },
      };
    }

    const boundaryBeforeGeneration = await loadConversationMessageBoundaryState({
      supabase,
      conversationId,
    });

    if (!boundaryBeforeGeneration.lastIncomingCustomerMessageId) {
      return {
        ok: false,
        error: "NO_RECENT_CUSTOMER_MESSAGE_FOR_AI_REPLY",
        message:
          "Nao encontrei mensagem recente do cliente para gerar resposta comercial.",
      };
    }

    if (hasAiReplyAfterLatestCustomerMessage(boundaryBeforeGeneration)) {
      return {
        ok: false,
        error: "AI_REPLY_ALREADY_EXISTS_FOR_LATEST_CUSTOMER_MESSAGE",
        message:
          "Ja existe resposta da IA depois da ultima mensagem do cliente. Ignorando execucao duplicada.",
      };
    }

    await clearPendingResumeArtifacts({
      supabase,
      organizationId,
      storeId,
      conversationId,
      customerMessageAt: boundaryBeforeGeneration.lastIncomingCustomerMessageAt,
      preserveReason: false,
      nextResumeReason: null,
      queueCancelReason: "cancelled_by_new_customer_message",
    });

    const lastIncomingCustomerMessage = await loadLatestIncomingCustomerMessage({
      supabase,
      conversationId,
    });

    const lastCustomerMessageText = cleanText(lastIncomingCustomerMessage?.content);

    if (detectStrongCustomerContractAcceptance(lastCustomerMessageText)) {
      const eligibleContract = await findEligibleSentContractForCustomerAcceptance({
        supabase,
        organizationId,
        storeId,
        conversationId,
        leadId: normalizedConversation.lead_id || null,
      });

      if (eligibleContract.outcome === "single") {
        await signSalesContractAsCustomer({
          scope: eligibleContract.scope,
          acceptanceText: lastCustomerMessageText,
          metadataSource: "sales_ai_conversation_customer_acceptance_v1",
          metadata: {
            accepted_via: "conversation_text",
            channel: "conversation",
            conversation_id: conversationId,
            lead_id: normalizedConversation.lead_id || null,
            trigger_message_id: lastIncomingCustomerMessage?.id || null,
            trigger_message_content: lastCustomerMessageText,
            contract_number: eligibleContract.contractNumber,
            matched_by: eligibleContract.matchedBy,
          },
        });

        const aiText = buildCustomerContractAcceptanceConfirmationText();
        let messageId: string | null = null;

        try {
          messageId = await sendAiPanelMessage({
            supabase,
            organizationId,
            storeId,
            conversationId,
            aiText,
          });
        } catch (sendAcceptanceReplyError: any) {
          return {
            ok: false,
            error: "PANEL_SEND_MESSAGE_FAILED",
            message:
              sendAcceptanceReplyError?.message ||
              "Falha ao enviar confirmacao de aceite do contrato.",
            aiText,
          };
        }

        return {
          ok: true,
          aiText,
          context: {
            flow: "customer_contract_text_acceptance",
            contractId: eligibleContract.contractId,
            contractNumber: eligibleContract.contractNumber,
            matchedBy: eligibleContract.matchedBy,
            triggerMessageId: lastIncomingCustomerMessage?.id || null,
          },
          usage: null,
          persisted: true,
          messageId,
        };
      }

      if (eligibleContract.outcome === "multiple") {
        const aiText =
          "Recebi seu aceite. Como encontrei mais de um contrato enviado em aberto para voce, preciso que a loja confirme qual deles seguir antes de registrar formalmente.";
        let messageId: string | null = null;

        try {
          messageId = await sendAiPanelMessage({
            supabase,
            organizationId,
            storeId,
            conversationId,
            aiText,
          });
        } catch (sendClarificationError: any) {
          return {
            ok: false,
            error: "PANEL_SEND_MESSAGE_FAILED",
            message:
              sendClarificationError?.message ||
              "Falha ao enviar resposta de esclarecimento sobre o aceite do contrato.",
            aiText,
          };
        }

        return {
          ok: true,
          aiText,
          context: {
            flow: "customer_contract_text_acceptance_ambiguous",
            candidateCount: eligibleContract.candidateCount,
            candidates: eligibleContract.candidates,
            matchedBy: eligibleContract.matchedBy,
            triggerMessageId: lastIncomingCustomerMessage?.id || null,
          },
          usage: null,
          persisted: true,
          messageId,
        };
      }
    }

    const generationResult = await generateAiSalesReply({
      organizationId,
      storeId,
      conversationId,
    });

    if (!generationResult.ok) {
      return {
        ok: false,
        error: generationResult.error,
        message: generationResult.message,
      };
    }

    let aiText = String(generationResult.aiText || "").trim();

    if (!aiText) {
      return {
        ok: false,
        error: "EMPTY_AI_TEXT",
        message: "A IA não retornou texto para salvar.",
      };
    }

    try {
      await updateLatestRunningAiRunUsage({
        supabase,
        organizationId,
        storeId,
        conversationId,
        usage: generationResult.usage,
      });
    } catch (usageError: any) {
      console.warn("[zion-ai-usage] Falha ao registrar uso/custo do ai_run", {
        organizationId,
        storeId,
        conversationId,
        error: usageError?.message || usageError,
      });
    }

    const boundaryBeforeSave = await loadConversationMessageBoundaryState({
      supabase,
      conversationId,
    });

    if (
      boundaryBeforeSave.lastIncomingCustomerMessageId !==
      boundaryBeforeGeneration.lastIncomingCustomerMessageId
    ) {
      return {
        ok: false,
        error: "AI_REPLY_SUPERSEDED_BY_NEWER_CUSTOMER_MESSAGE",
        message:
          "Entrou mensagem mais nova do cliente durante a geracao. Ignorando esta resposta antiga.",
        aiText,
      };
    }

    if (hasAiReplyAfterLatestCustomerMessage(boundaryBeforeSave)) {
      return {
        ok: false,
        error: "AI_REPLY_ALREADY_EXISTS_FOR_LATEST_CUSTOMER_MESSAGE",
        message:
          "Outra execucao ja respondeu a ultima mensagem do cliente. Ignorando duplicidade.",
        aiText,
      };
    }

    const requestedCommercialHandoff = generationResult.context?.commercialHandoff || null;

    if (requestedCommercialHandoff?.shouldCreateTask) {
      try {
        const similarOpenHandoff = await findExistingCommercialHandoffTask({
          supabase,
          organizationId,
          storeId,
          conversationId,
          taskType: requestedCommercialHandoff.taskType,
        });

        if (similarOpenHandoff) {
          aiText =
            requestedCommercialHandoff.taskType === "commercial_quote_request"
              ? "Seu pedido de orcamento ja esta aberto por aqui. Se quiser, eu tambem posso organizar os detalhes do que voce procura para facilitar o retorno da loja."
              : "Essa solicitacao de visita ja esta aberta por aqui. Se quiser, me confirma sua cidade e um bom dia ou periodo que isso ajuda no retorno da loja.";
        }
      } catch (handoffLookupError) {
        console.warn("[zion-ai-sales-handoff] Falha ao verificar handoff comercial antes do envio", {
          organizationId,
          storeId,
          conversationId,
          error:
            handoffLookupError instanceof Error
              ? handoffLookupError.message
              : String(handoffLookupError || ""),
        });
      }
    }

    let messageId: string | null = null;

    try {
      messageId = await sendAiPanelMessage({
        supabase,
        organizationId,
        storeId,
        conversationId,
        aiText,
      });
    } catch (sendError: any) {
      return {
        ok: false,
        error: "PANEL_SEND_MESSAGE_FAILED",
        message: sendError?.message || "Falha ao enviar resposta da IA.",
        aiText,
      };
    }

    const catalogPhotoAction = normalizeCatalogPhotoAction(
      generationResult.context?.catalogPhotoAction
    );

    if (
      catalogPhotoAction &&
      catalogPhotoAction.organizationId === organizationId &&
      catalogPhotoAction.storeId === storeId
    ) {
      try {
        const imageMetadata: Record<string, unknown> = {
          media_purpose: "catalog_product_photo",
          catalog_photo_action: true,
          target_type: catalogPhotoAction.targetType,
          source: catalogPhotoAction.source,
          pool_id: catalogPhotoAction.poolId,
          pool_name: catalogPhotoAction.poolName,
          catalog_item_id: catalogPhotoAction.catalogItemId,
          catalog_item_name: catalogPhotoAction.catalogItemName,
          catalog_item_sku: catalogPhotoAction.catalogItemSku,
          storage_bucket: catalogPhotoAction.bucket,
          storage_path: catalogPhotoAction.storagePath,
          generated_by: "ai_sales",
          auto_sent: true,
          reason: catalogPhotoAction.reason,
        };

        const { error: imageInsertError } = await supabase.rpc("insert_message", {
          p_conversation_id: conversationId,
          p_sender: "ai",
          p_direction: "outgoing",
          p_message_type: "image",
          p_content: catalogPhotoAction.caption,
          p_media_url: catalogPhotoAction.publicUrl,
          p_external_message_id: null,
          p_metadata: imageMetadata,
        });

        if (imageInsertError) {
          console.warn("[zion-ai-sales-photo] Falha ao persistir imagem de catalogo", {
            organizationId,
            storeId,
            conversationId,
            targetType: catalogPhotoAction.targetType,
            poolId: catalogPhotoAction.poolId,
            catalogItemId: catalogPhotoAction.catalogItemId,
            error: imageInsertError.message,
          });
        }
      } catch (catalogPhotoInsertError: any) {
        console.warn("[zion-ai-sales-photo] Erro inesperado ao persistir imagem de catalogo", {
          organizationId,
          storeId,
          conversationId,
          targetType: catalogPhotoAction.targetType,
          poolId: catalogPhotoAction.poolId,
          catalogItemId: catalogPhotoAction.catalogItemId,
          error:
            catalogPhotoInsertError instanceof Error
              ? catalogPhotoInsertError.message
              : String(catalogPhotoInsertError || ""),
        });
      }
    }

    const aiMessageTimestamp = new Date().toISOString();

    await persistOperationalFollowUpDecision({
      supabase,
      organizationId,
      storeId,
      conversationId,
      leadId: normalizedConversation.lead_id || null,
      decision:
        generationResult.context?.operationalFollowUpDecision || {
          kind: "none",
          reason: "none",
        },
      lastCustomerMessageAt: boundaryBeforeGeneration.lastIncomingCustomerMessageAt,
      lastAiMessageAt: aiMessageTimestamp,
    });

    let commercialHandoffResult: CommercialHandoffCreationResult | null = null;

    try {
      commercialHandoffResult = await createCommercialAssistantHandoff({
        supabase,
        organizationId,
        storeId,
        conversationId,
        leadId: normalizedConversation.lead_id || null,
        handoff: generationResult.context?.commercialHandoff || null,
      });
    } catch (handoffError: any) {
      commercialHandoffResult = {
        created: false,
        skipped: false,
        reason: "handoff_creation_failed",
        error: handoffError?.message || String(handoffError || ""),
      };
      console.warn("[zion-ai-sales-handoff] Falha ao criar pendência comercial", {
        organizationId,
        storeId,
        conversationId,
        error: handoffError?.message || handoffError,
      });
    }

    let preContractCardResult: ContractWorkflowCardCreationResult | null = null;

    try {
      preContractCardResult = await maybeCreateAssistantPreContractCardFromCustomerSignal({
        supabase,
        organizationId,
        storeId,
        conversationId,
        leadId: normalizedConversation.lead_id || null,
        customerName: generationResult.context?.leadName || null,
        lastCustomerMessage:
          generationResult.context?.lastCustomerMessage ||
          generationResult.context?.commercialHandoff?.lastCustomerMessage ||
          null,
      });
    } catch (preContractCardError: any) {
      preContractCardResult = {
        attempted: true,
        created: false,
        reason: "pre_contract_card_creation_failed",
        error: preContractCardError?.message || String(preContractCardError || ""),
      };
      console.warn(
        "[zion-ai-sales-pre-contract] Falha ao criar card pre-contrato da assistente",
        {
          organizationId,
          storeId,
          conversationId,
          error: preContractCardError?.message || preContractCardError,
        }
      );
    }

    const shouldSkipQualificationBecauseBudgetProgressed =
      requestedCommercialHandoff?.shouldCreateTask === true &&
      requestedCommercialHandoff?.taskType === "commercial_quote_request" &&
      commercialHandoffResult?.crmAutoProgressed === true;

    let qualificationAutoProgressResult: CrmAutoProgressResult | null = null;

    if (shouldSkipQualificationBecauseBudgetProgressed) {
      qualificationAutoProgressResult = {
        attempted: false,
        progressed: false,
        reason: "budget_auto_progress_already_completed",
        skippedReason: "budget_auto_progress_already_completed",
      };
      console.info("[zion-ai-sales-qualification] fallback ignorado", {
        reason: "budget_auto_progress_already_completed",
        conversationId,
        taskId: commercialHandoffResult?.taskId || null,
      });
    } else {
      try {
        qualificationAutoProgressResult =
          await maybeAutoProgressCrmToQualificationFromSalesSignal({
            supabase,
            organizationId,
            storeId,
            conversationId,
            leadId: normalizedConversation.lead_id || null,
            lastCustomerMessage:
              generationResult.context?.lastCustomerMessage ||
              generationResult.context?.commercialHandoff?.lastCustomerMessage ||
              null,
          });
      } catch (qualificationProgressError: any) {
        qualificationAutoProgressResult = {
          attempted: true,
          progressed: false,
          reason: "crm_auto_progress_unexpected_failure",
          error:
            qualificationProgressError?.message ||
            String(qualificationProgressError || ""),
        };
        console.warn(
          "[zion-ai-sales-qualification] falha inesperada no autoavanço para qualificação",
          {
            organizationId,
            storeId,
            conversationId,
            error:
              qualificationProgressError?.message || qualificationProgressError,
          }
        );
      }
    }

    return {
      ok: true,
      aiText,
      context: {
        ...generationResult.context,
        qualificationAutoProgressResult,
        commercialHandoffResult,
        preContractCardResult,
      },
      usage: generationResult.usage,
      persisted: true,
      messageId,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: "GENERATE_AND_SAVE_AI_SALES_REPLY_FAILED",
      message:
        error?.message ||
        "Erro interno ao gerar e salvar resposta comercial da IA.",
    };
  }
}
