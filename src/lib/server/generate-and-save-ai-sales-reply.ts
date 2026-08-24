import { createClient } from "@supabase/supabase-js";
import {
  detectPaymentOrClosingSubtype,
  generateAiSalesReply,
  type CommercialHandoffContext,
  type OperationalFollowUpDecision,
  type PaymentOrClosingSubtype,
  type ResponseAnchorCommercialContext,
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
import { ContractAccessError } from "./sales-contracts/contract-auth";
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

type GenerateAndSaveAiSalesReplyDeps = {
  createSupabaseClient: typeof createClient;
  detectOpenAssistantOperationalFlow: typeof detectOpenAssistantOperationalFlow;
  loadConversationMessageBoundaryState: typeof loadConversationMessageBoundaryState;
  tryHandleCustomerContractAcceptance: typeof tryHandleCustomerContractAcceptance;
  generateAiSalesReply: typeof generateAiSalesReply;
  updateLatestRunningAiRunUsage: typeof updateLatestRunningAiRunUsage;
  sendAiPanelMessage: typeof sendAiPanelMessage;
  createCommercialAssistantHandoff: typeof createCommercialAssistantHandoff;
};

const AI_REPLY_GENERATION_ANCHOR_MISMATCH =
  "AI_REPLY_GENERATION_ANCHOR_MISMATCH";
const AI_REPLY_SUPERSEDED_BY_NEWER_CUSTOMER_MESSAGE =
  "AI_REPLY_SUPERSEDED_BY_NEWER_CUSTOMER_MESSAGE";
const CONVERSATION_SCOPE_MISMATCH_ERRORS = new Set([
  "CONVERSATION_SCOPE_ORGANIZATION_MISSING",
  "CONVERSATION_SCOPE_LEAD_MISSING",
  "CONVERSATION_SCOPE_STORE_MISSING",
  "CONVERSATION_SCOPE_LEAD_ORGANIZATION_MISMATCH",
  "CONVERSATION_SCOPE_ORGANIZATION_MISMATCH",
  "CONVERSATION_SCOPE_STORE_MISMATCH",
  "CONVERSATION_SCOPE_STORE_NOT_FOUND",
  "CONVERSATION_SCOPE_STORE_ORGANIZATION_MISMATCH",
]);

export function mapGenerateAndSaveAiSalesReplyError(
  error: unknown,
): GenerateAndSaveAiSalesReplyResult {
  if (error instanceof ContractAccessError) {
    const context: Record<string, unknown> = {};
    const details = (error as ContractAccessError & { details?: unknown }).details;
    const sqlState = (error as ContractAccessError & { sqlState?: string | null }).sqlState;
    const deterministicMessage = (
      error as ContractAccessError & { deterministicMessage?: string | null }
    ).deterministicMessage;

    if (details !== undefined) {
      context.details = details;
    }

    if (sqlState) {
      context.sqlState = sqlState;
    }

    if (deterministicMessage) {
      context.deterministicMessage = deterministicMessage;
    }

    return {
      ok: false,
      error: error.code,
      message: error.message,
      ...(Object.keys(context).length > 0 ? { context } : {}),
    };
  }

  return {
    ok: false,
    error: "GENERATE_AND_SAVE_AI_SALES_REPLY_FAILED",
    message:
      (error as { message?: string } | null | undefined)?.message ||
      "Erro interno ao gerar e salvar resposta comercial da IA.",
  };
}

function normalizeConversationScopeLead(
  value:
    | {
        organization_id: string | null;
        store_id: string | null;
      }
    | Array<{
        organization_id: string | null;
        store_id: string | null;
      }>
    | null
    | undefined,
) {
  if (Array.isArray(value)) {
    return value[0] || null;
  }

  if (value && typeof value === "object") {
    return value;
  }

  return null;
}

async function resolveConversationAiWindowStateScope(args: {
  supabase: any;
  conversationId: string;
  expectedOrganizationId?: string | null;
  expectedStoreId?: string | null;
}) {
  const { data, error } = await args.supabase
    .from("conversations")
    .select("id, organization_id, lead_id, is_human_active, leads!inner(organization_id, store_id)")
    .eq("id", args.conversationId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Falha ao resolver escopo canonico da janela da IA: ${error.message}`
    );
  }

  const conversation =
    data && typeof data === "object"
      ? (data as ConversationRow & {
          leads?:
            | {
                organization_id: string | null;
                store_id: string | null;
              }
            | Array<{
                organization_id: string | null;
                store_id: string | null;
              }>
            | null;
        })
      : null;

  if (!conversation?.id) {
    throw new Error("CONVERSATION_SCOPE_NOT_FOUND");
  }

  const canonicalOrganizationId = String(conversation.organization_id || "").trim();
  const canonicalLeadId = String(conversation.lead_id || "").trim();
  const lead = normalizeConversationScopeLead(conversation.leads);
  const leadOrganizationId = String(lead?.organization_id || "").trim();
  const canonicalStoreId = String(lead?.store_id || "").trim();

  if (!canonicalOrganizationId) {
    throw new Error("CONVERSATION_SCOPE_ORGANIZATION_MISSING");
  }

  if (!canonicalLeadId) {
    throw new Error("CONVERSATION_SCOPE_LEAD_MISSING");
  }

  if (!canonicalStoreId) {
    throw new Error("CONVERSATION_SCOPE_STORE_MISSING");
  }

  if (!leadOrganizationId || leadOrganizationId !== canonicalOrganizationId) {
    throw new Error("CONVERSATION_SCOPE_LEAD_ORGANIZATION_MISMATCH");
  }

  const expectedOrganizationId = String(args.expectedOrganizationId || "").trim();
  if (expectedOrganizationId && expectedOrganizationId !== canonicalOrganizationId) {
    throw new Error("CONVERSATION_SCOPE_ORGANIZATION_MISMATCH");
  }

  const expectedStoreId = String(args.expectedStoreId || "").trim();
  if (expectedStoreId && expectedStoreId !== canonicalStoreId) {
    throw new Error("CONVERSATION_SCOPE_STORE_MISMATCH");
  }

  const { data: store, error: storeError } = await args.supabase
    .from("stores")
    .select("id, organization_id")
    .eq("id", canonicalStoreId)
    .maybeSingle();

  if (storeError) {
    throw new Error(
      `Falha ao validar loja canonica da janela da IA: ${storeError.message}`
    );
  }

  const storeOrganizationId = String(
    (store as { organization_id?: string | null } | null)?.organization_id || ""
  ).trim();

  if (!storeOrganizationId) {
    throw new Error("CONVERSATION_SCOPE_STORE_NOT_FOUND");
  }

  if (storeOrganizationId !== canonicalOrganizationId) {
    throw new Error("CONVERSATION_SCOPE_STORE_ORGANIZATION_MISMATCH");
  }

  return {
    conversationId: String(conversation.id).trim(),
    organizationId: canonicalOrganizationId,
    leadId: canonicalLeadId,
    storeId: canonicalStoreId,
    isHumanActive: conversation.is_human_active ?? null,
  };
}

function mapConversationScopeResolutionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");

  if (message === "CONVERSATION_SCOPE_NOT_FOUND") {
    return {
      ok: false as const,
      result: {
        ok: false,
        error: "CONVERSATION_NOT_FOUND",
        message: "Conversa não encontrada para a organização informada.",
      } satisfies GenerateAndSaveAiSalesReplyResult,
    };
  }

  if (CONVERSATION_SCOPE_MISMATCH_ERRORS.has(message)) {
    return {
      ok: false as const,
      result: {
        ok: false,
        error: "CONVERSATION_SCOPE_MISMATCH",
        message:
          "A conversa não corresponde ao escopo informado para persistir a janela da IA.",
      } satisfies GenerateAndSaveAiSalesReplyResult,
    };
  }

  return {
    ok: true as const,
  };
}

async function transitionConversationStateAsInternalActor(args: {
  supabase: any;
  conversationId: string;
  toState: string;
  reason: string;
  actorType: "ai" | "system";
  source: string;
  eventKey?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const { error } = await args.supabase.rpc(
    "transition_conversation_state_internal",
    {
      p_conversation_id: args.conversationId,
      p_to_state: args.toState,
      p_reason: args.reason,
      p_actor_type: args.actorType,
      p_source: args.source,
      p_event_key: args.eventKey ?? null,
      p_metadata: args.metadata ?? {},
    }
  );

  return { error };
}

function buildAiSalesAutoProgressEventKey(args: {
  taskId: string;
  step: "prepare_qualification" | "prepare_budget" | "budget_direct";
}) {
  return `ai_sales_auto_progress:${args.taskId}:${args.step}`;
}

function buildAiSalesSignalProgressEventKey(args: {
  generationAnchorMessageId: string;
  targetStage: "qualificacao";
}) {
  return `ai_sales_signal_progress:${args.generationAnchorMessageId}:${args.targetStage}`;
}

type CommercialStageTransitionRpcRow = {
  commercial_opportunity_id: string;
  stage: string;
  lifecycle_cycle: number | null;
  lifecycle_event_id: string | null;
  event_type: string | null;
  reason_code: string | null;
  stage_changed_at: string | null;
  updated_at: string | null;
};

function summarizeCommercialHandoffEvidence(
  handoff: CommercialHandoffContext,
): string | null {
  return (
    cleanText(handoff.conversationSummary) ||
    cleanText(handoff.nextStep) ||
    cleanText(handoff.lastCustomerMessage) ||
    null
  );
}

function buildCommercialHandoffReasonDetails(
  handoff: CommercialHandoffContext,
): string | null {
  const parts = [
    cleanText(handoff.lastCustomerMessage)
      ? `last_customer_message=${cleanText(handoff.lastCustomerMessage)}`
      : null,
    cleanText(handoff.conversationSummary)
      ? `conversation_summary=${cleanText(handoff.conversationSummary)}`
      : null,
    cleanText(handoff.nextStep)
      ? `next_step=${cleanText(handoff.nextStep)}`
      : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" | ") : null;
}

async function transitionCommercialOpportunityStageBySystem(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  idempotencyKey: string;
  targetStage: string;
  reasonDetails?: string | null;
  evidenceType: string;
  evidenceMessageId?: string | null;
  evidenceSummary?: string | null;
  source: string;
}) {
  const { data, error } = await args.supabase.rpc(
    "transition_commercial_opportunity_stage_by_system",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_commercial_opportunity_id: args.commercialOpportunityId,
      p_idempotency_key: args.idempotencyKey,
      p_target_stage: args.targetStage,
      p_reason_details: args.reasonDetails ?? null,
      p_evidence_type: args.evidenceType,
      p_evidence_message_id: args.evidenceMessageId ?? null,
      p_evidence_summary: args.evidenceSummary ?? null,
      p_source: args.source,
    },
  );

  const rows = Array.isArray(data)
    ? (data as CommercialStageTransitionRpcRow[])
    : data
      ? ([data] as CommercialStageTransitionRpcRow[])
      : [];

  return {
    data: rows[0] || null,
    error,
  };
}

type CommercialOpportunityStageRow = {
  id: string;
  stage: string | null;
};

async function loadCanonicalCommercialOpportunityStage(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
}) {
  const { data, error } = await args.supabase
    .from("commercial_opportunities")
    .select("id, stage")
    .eq("id", args.commercialOpportunityId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (error) {
    console.warn("[zion-ai-sales-opportunity] canonical stage load failed", {
      reason: "canonical_stage_lookup_failed",
      commercialOpportunityId: args.commercialOpportunityId,
      organizationId: args.organizationId,
      storeId: args.storeId,
      error: error.message,
    });
    return {
      ok: false as const,
      reason: "canonical_stage_lookup_failed",
      stage: null,
    };
  }

  const row =
    data && typeof data === "object"
      ? (data as CommercialOpportunityStageRow)
      : null;
  const stage = normalizeText(row?.stage);

  if (!row?.id || !stage) {
    console.info("[zion-ai-sales-opportunity] canonical stage unavailable", {
      reason: "canonical_stage_not_found",
      commercialOpportunityId: args.commercialOpportunityId,
      organizationId: args.organizationId,
      storeId: args.storeId,
    });
    return {
      ok: false as const,
      reason: "canonical_stage_not_found",
      stage: null,
    };
  }

  return {
    ok: true as const,
    reason: "canonical_stage_loaded",
    stage,
  };
}

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
  commercial_opportunity_id?: string | null;
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

export type CommercialAssistantHandoffDeps = {
  findExistingTask: typeof findExistingCommercialHandoffTask;
  enqueueNotification: typeof enqueueCommercialHandoffNotification;
  autoProgressBudgetFromQuote: typeof maybeAutoProgressCrmToBudgetFromQuoteHandoffCanonical;
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
  organization_id: string | null;
  store_id: string | null;
  conversation_id: string | null;
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

export async function findExistingCommercialHandoffTask(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  taskType: string;
  commercialOpportunityId: string;
}) {
  const { data, error } = await args.supabase
    .from("store_assistant_operational_tasks")
    .select("id, task_type, status, commercial_opportunity_id, task_payload")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("related_conversation_id", args.conversationId)
    .eq("commercial_opportunity_id", args.commercialOpportunityId)
    .eq("task_type", args.taskType)
    .in("status", getOpenCommercialHandoffStatuses())
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao verificar handoff comercial existente: ${error.message}`);
  }

  return (data as OpenOperationalTaskRow | null) || null;
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

    const { error: qualificationError } =
      await transitionConversationStateAsInternalActor({
        supabase: args.supabase,
        conversationId: args.conversationId,
        toState: "qualificacao",
        reason: "auto_progress_from_ai_sales_quote_request_prepare_qualification",
        actorType: "ai",
        source: "ai_sales_auto_progress",
        eventKey: buildAiSalesAutoProgressEventKey({
          taskId: args.taskId,
          step: "prepare_qualification",
        }),
      });

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

    const { error: budgetAfterQualificationError } =
      await transitionConversationStateAsInternalActor({
        supabase: args.supabase,
        conversationId: args.conversationId,
        toState: "orcamento",
        reason: "auto_progress_from_ai_sales_quote_request",
        actorType: "ai",
        source: "ai_sales_auto_progress",
        eventKey: buildAiSalesAutoProgressEventKey({
          taskId: args.taskId,
          step: "prepare_budget",
        }),
      });

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

  const { error } = await transitionConversationStateAsInternalActor({
    supabase: args.supabase,
    conversationId: args.conversationId,
    toState: "orcamento",
    reason: "auto_progress_from_ai_sales_quote_request",
    actorType: "ai",
    source: "ai_sales_auto_progress",
    eventKey: buildAiSalesAutoProgressEventKey({
      taskId: args.taskId,
      step: "budget_direct",
    }),
  });

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

  const { error } = await transitionConversationStateAsInternalActor({
    supabase: args.supabase,
    conversationId: args.conversationId,
    toState: "qualificacao",
    reason: "auto_progress_from_ai_sales_qualification_signal",
    actorType: "ai",
    source: "ai_sales_auto_progress",
  });

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

async function maybeAutoProgressCrmToBudgetFromQuoteHandoffCanonical(args: {
  supabase: any;
  systemSupabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string | null;
  taskId: string;
  handoff: CommercialHandoffContext;
  generationAnchorMessageId?: string | null;
}): Promise<CrmAutoProgressResult> {
  if (args.handoff.taskType !== "commercial_quote_request") {
    console.info("[zion-ai-sales-handoff] crm auto progress skipped", {
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
    console.info("[zion-ai-sales-handoff] crm auto progress skipped", {
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

  const commercialOpportunityId = readCommercialOpportunityIdFromHandoff(args.handoff);

  if (!commercialOpportunityId) {
    console.info("[zion-ai-sales-handoff] crm auto progress skipped", {
      reason: "missing_commercial_opportunity_context",
      taskId: args.taskId,
      taskType: args.handoff.taskType,
      conversationId: args.conversationId,
    });
    return {
      attempted: false,
      progressed: false,
      reason: "missing_commercial_opportunity_context",
      skippedReason: "missing_commercial_opportunity_context",
    };
  }

  const handoffReasonDetails = buildCommercialHandoffReasonDetails(args.handoff);
  const handoffEvidenceSummary = summarizeCommercialHandoffEvidence(args.handoff);
  const evidenceMessageId = cleanText(args.generationAnchorMessageId) || null;

  const stageSnapshot = await loadCanonicalCommercialOpportunityStage({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    commercialOpportunityId,
  });

  if (!stageSnapshot.ok) {
    return {
      attempted: false,
      progressed: false,
      reason: stageSnapshot.reason,
      skippedReason: stageSnapshot.reason,
    };
  }

  const currentStage = stageSnapshot.stage;

  if (!AUTO_PROGRESS_TO_ORCAMENTO_ALLOWED_FROM.has(currentStage)) {
    return {
      attempted: false,
      progressed: false,
      reason: "current_state_not_allowed",
      skippedReason: "current_state_not_allowed",
      currentState: currentStage,
    };
  }

  const transitionLegacyState = async (args2: {
    toState: "qualificacao" | "orcamento";
    reason: string;
    eventKey: string;
    previousState: string;
    failureReason:
      | "crm_transition_to_qualification_failed"
      | "crm_transition_to_budget_failed_after_qualification"
      | "crm_transition_rpc_failed";
  }) => {
    const { error } = await transitionConversationStateAsInternalActor({
      supabase: args.supabase,
      conversationId: args.conversationId,
      toState: args2.toState,
      reason: args2.reason,
      actorType: "ai",
      source: "ai_sales_auto_progress",
      eventKey: args2.eventKey,
    });

    if (error) {
      console.warn("[zion-ai-sales-handoff] legacy transition failed", {
        reason: "legacy_transition_failed",
        taskId: args.taskId,
        conversationId: args.conversationId,
        commercialOpportunityId,
        previousState: args2.previousState,
        toState: args2.toState,
        error: error.message,
      });
      return {
        attempted: true,
        progressed: false,
        reason: args2.failureReason,
        previousState: args2.previousState,
        currentState: args2.previousState,
        error: error.message,
      } satisfies CrmAutoProgressResult;
    }

    return null;
  };

  const transitionCanonicalStage = async (args2: {
    targetStage: "qualificacao" | "orcamento";
    idempotencyKey: string;
    currentState: string;
    failureReason:
      | "canonical_transition_to_qualification_failed"
      | "canonical_transition_to_budget_failed_after_qualification"
      | "canonical_transition_to_budget_failed";
  }) => {
    const { error } = await transitionCommercialOpportunityStageBySystem({
      supabase: args.systemSupabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      commercialOpportunityId,
      idempotencyKey: args2.idempotencyKey,
      targetStage: args2.targetStage,
      reasonDetails: handoffReasonDetails,
      evidenceType: "commercial_handoff_task",
      evidenceMessageId,
      evidenceSummary: handoffEvidenceSummary,
      source: "ai_sales_auto_progress",
    });

    if (error) {
      console.warn("[zion-ai-sales-handoff] canonical transition failed", {
        reason: "canonical_transition_failed",
        taskId: args.taskId,
        conversationId: args.conversationId,
        commercialOpportunityId,
        currentState: args2.currentState,
        targetStage: args2.targetStage,
        error: error.message,
      });
      return {
        attempted: true,
        progressed: false,
        reason: args2.failureReason,
        previousState: args2.currentState,
        currentState: args2.currentState,
        error: error.message,
      } satisfies CrmAutoProgressResult;
    }

    return null;
  };

  if (currentStage === "novo_lead") {
    const qualificationEventKey = buildAiSalesAutoProgressEventKey({
      taskId: args.taskId,
      step: "prepare_qualification",
    });
    const qualificationCanonicalFailure = await transitionCanonicalStage({
      targetStage: "qualificacao",
      idempotencyKey: qualificationEventKey,
      currentState: currentStage,
      failureReason: "canonical_transition_to_qualification_failed",
    });

    if (qualificationCanonicalFailure) {
      return qualificationCanonicalFailure;
    }

    const qualificationLegacyFailure = await transitionLegacyState({
      toState: "qualificacao",
      reason: "auto_progress_from_ai_sales_quote_request_prepare_qualification",
      eventKey: qualificationEventKey,
      previousState: currentStage,
      failureReason: "crm_transition_to_qualification_failed",
    });

    if (qualificationLegacyFailure) {
      return qualificationLegacyFailure;
    }

    const budgetEventKey = buildAiSalesAutoProgressEventKey({
      taskId: args.taskId,
      step: "prepare_budget",
    });
    const budgetCanonicalFailure = await transitionCanonicalStage({
      targetStage: "orcamento",
      idempotencyKey: budgetEventKey,
      currentState: "qualificacao",
      failureReason: "canonical_transition_to_budget_failed_after_qualification",
    });

    if (budgetCanonicalFailure) {
      return budgetCanonicalFailure;
    }

    const budgetLegacyFailure = await transitionLegacyState({
      toState: "orcamento",
      reason: "auto_progress_from_ai_sales_quote_request",
      eventKey: budgetEventKey,
      previousState: "qualificacao",
      failureReason: "crm_transition_to_budget_failed_after_qualification",
    });

    if (budgetLegacyFailure) {
      return budgetLegacyFailure;
    }

    return {
      attempted: true,
      progressed: true,
      reason: "crm_auto_progress_completed_via_qualification",
      previousState: currentStage,
      currentState: "orcamento",
    };
  }

  const budgetEventKey = buildAiSalesAutoProgressEventKey({
    taskId: args.taskId,
    step: currentStage === "qualificacao" ? "prepare_budget" : "budget_direct",
  });
  const budgetCanonicalFailure = await transitionCanonicalStage({
    targetStage: "orcamento",
    idempotencyKey: budgetEventKey,
    currentState: currentStage,
    failureReason: "canonical_transition_to_budget_failed",
  });

  if (budgetCanonicalFailure) {
    return budgetCanonicalFailure;
  }

  const budgetLegacyFailure = await transitionLegacyState({
    toState: "orcamento",
    reason: "auto_progress_from_ai_sales_quote_request",
    eventKey: budgetEventKey,
    previousState: currentStage,
    failureReason: "crm_transition_rpc_failed",
  });

  if (budgetLegacyFailure) {
    return budgetLegacyFailure;
  }

  return {
    attempted: true,
    progressed: true,
    reason: "crm_auto_progress_completed",
    previousState: currentStage,
    currentState: "orcamento",
  };
}

async function maybeAutoProgressCrmToQualificationFromSalesSignalCanonical(args: {
  supabase: any;
  systemSupabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string | null;
  lastCustomerMessage: string | null | undefined;
  commercialOpportunityId: string | null;
  generationAnchorMessageId: string | null;
}): Promise<CrmAutoProgressResult> {
  if (!args.organizationId || !args.conversationId) {
    return {
      attempted: false,
      progressed: false,
      reason: "missing_organization_or_conversation",
      skippedReason: "missing_organization_or_conversation",
    };
  }

  if (!hasClearCommercialQualificationSignal(args.lastCustomerMessage)) {
    return {
      attempted: false,
      progressed: false,
      reason: "no_clear_commercial_signal",
      skippedReason: "no_clear_commercial_signal",
    };
  }

  const commercialOpportunityId = cleanText(args.commercialOpportunityId);
  const generationAnchorMessageId = cleanText(args.generationAnchorMessageId);

  if (!commercialOpportunityId || !generationAnchorMessageId) {
    console.info("[zion-ai-sales-qualification] auto progress skipped", {
      reason: "missing_commercial_opportunity_context",
      conversationId: args.conversationId,
    });
    return {
      attempted: false,
      progressed: false,
      reason: "missing_commercial_opportunity_context",
      skippedReason: "missing_commercial_opportunity_context",
    };
  }

  const stageSnapshot = await loadCanonicalCommercialOpportunityStage({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    commercialOpportunityId,
  });

  if (!stageSnapshot.ok) {
    return {
      attempted: false,
      progressed: false,
      reason: stageSnapshot.reason,
      skippedReason: stageSnapshot.reason,
    };
  }

  const currentStage = stageSnapshot.stage;

  if (AUTO_PROGRESS_TO_QUALIFICACAO_BLOCKED.has(currentStage)) {
    return {
      attempted: false,
      progressed: false,
      reason: "current_state_blocked",
      skippedReason: "current_state_blocked",
      currentState: currentStage,
    };
  }

  if (!AUTO_PROGRESS_TO_QUALIFICACAO_ALLOWED_FROM.has(currentStage)) {
    return {
      attempted: false,
      progressed: false,
      reason: "current_state_not_allowed",
      skippedReason: "current_state_not_allowed",
      currentState: currentStage,
    };
  }

  const qualificationSignalEventKey = buildAiSalesSignalProgressEventKey({
    generationAnchorMessageId,
    targetStage: "qualificacao",
  });
  const { error: canonicalError } =
    await transitionCommercialOpportunityStageBySystem({
      supabase: args.systemSupabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      commercialOpportunityId,
      idempotencyKey: qualificationSignalEventKey,
      targetStage: "qualificacao",
      reasonDetails: "clear_customer_qualification_signal_detected",
      evidenceType: "incoming_customer_message",
      evidenceMessageId: generationAnchorMessageId,
      evidenceSummary:
        "Mensagem do cliente contém sinal comercial claro para qualificação.",
      source: "ai_sales_auto_progress",
    });

  if (canonicalError) {
    console.warn("[zion-ai-sales-qualification] canonical transition failed", {
      reason: "canonical_transition_failed",
      conversationId: args.conversationId,
      commercialOpportunityId,
      generationAnchorMessageId,
      currentState: currentStage,
      error: canonicalError.message,
    });
    return {
      attempted: true,
      progressed: false,
      reason: "canonical_transition_to_qualification_failed",
      currentState: currentStage,
      error: canonicalError.message,
    };
  }

  const { error: legacyError } = await transitionConversationStateAsInternalActor({
    supabase: args.supabase,
    conversationId: args.conversationId,
    toState: "qualificacao",
    reason: "auto_progress_from_ai_sales_qualification_signal",
    actorType: "ai",
    source: "ai_sales_auto_progress",
  });

  if (legacyError) {
    console.warn("[zion-ai-sales-qualification] legacy transition failed", {
      reason: "legacy_transition_failed",
      conversationId: args.conversationId,
      commercialOpportunityId,
      generationAnchorMessageId,
      currentState: currentStage,
      error: legacyError.message,
    });
    return {
      attempted: true,
      progressed: false,
      reason: "crm_transition_rpc_failed",
      currentState: currentStage,
      error: legacyError.message,
    };
  }

  return {
    attempted: true,
    progressed: true,
    reason: "crm_auto_progress_completed",
    previousState: currentStage,
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

async function loadAnchoredIncomingCustomerMessage(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  messageId: string;
}): Promise<CustomerIncomingMessageRow | null> {
  const { data, error } = await args.supabase
    .from("messages")
    .select(
      "id, organization_id, store_id, conversation_id, sender, direction, content, created_at"
    )
    .eq("id", args.messageId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("conversation_id", args.conversationId)
    .eq("sender", "user")
    .eq("direction", "incoming")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Falha ao carregar a mensagem-ancora do cliente: ${error.message}`
    );
  }

  const row =
    data && typeof data === "object" ? (data as CustomerIncomingMessageRow) : null;

  if (!row || cleanText(row.content) == null) {
    return null;
  }

  return row;
}

type CustomerContractAcceptanceFlowDeps = {
  detectStrongCustomerContractAcceptance: typeof detectStrongCustomerContractAcceptance;
  findEligibleSentContractForCustomerAcceptance: typeof findEligibleSentContractForCustomerAcceptance;
  signSalesContractAsCustomer: typeof signSalesContractAsCustomer;
  buildCustomerContractAcceptanceConfirmationText: typeof buildCustomerContractAcceptanceConfirmationText;
  sendAiPanelMessage: typeof sendAiPanelMessage;
  loadConversationMessageBoundaryState: typeof loadConversationMessageBoundaryState;
};

function buildCustomerContractAcceptanceContext(args: {
  contractId: string;
  contractNumber: string | null;
  matchedBy: string;
  triggerMessageId: string;
  triggerMessageContent: string;
  partialSuccess: boolean;
  confirmationPersisted: boolean;
  confirmationStatus: "suppressed" | "failed" | "sent";
  confirmationReason: string | null;
  confirmationErrorMessage?: string;
  acceptanceOutcome?: string | null;
  replayed?: boolean;
  reconciled?: boolean;
  signatureId?: string | null;
  contractStatus?: string | null;
  versionStatus?: string | null;
  sideEffects?: {
    businessEvent: "completed" | "failed" | "skipped";
    documentReview: "completed" | "failed" | "skipped";
  } | null;
}) {
  return {
    flow: "customer_contract_text_acceptance",
    partialSuccess: args.partialSuccess,
    contractAccepted: true,
    confirmationPersisted: args.confirmationPersisted,
    confirmationStatus: args.confirmationStatus,
    confirmationReason: args.confirmationReason,
    ...(args.confirmationErrorMessage
      ? { confirmationErrorMessage: args.confirmationErrorMessage }
      : {}),
    contractId: args.contractId,
    contractNumber: args.contractNumber,
    matchedBy: args.matchedBy,
    ...(args.acceptanceOutcome ? { acceptanceOutcome: args.acceptanceOutcome } : {}),
    ...(typeof args.replayed === "boolean" ? { replayed: args.replayed } : {}),
    ...(typeof args.reconciled === "boolean" ? { reconciled: args.reconciled } : {}),
    ...(args.signatureId ? { signatureId: args.signatureId } : {}),
    ...(args.contractStatus ? { contractStatus: args.contractStatus } : {}),
    ...(args.versionStatus ? { versionStatus: args.versionStatus } : {}),
    ...(args.sideEffects ? { sideEffects: args.sideEffects } : {}),
    triggerMessageId: args.triggerMessageId,
    triggerMessageContent: args.triggerMessageContent,
  };
}

function normalizeConfirmedPanelMessageId(messageId: string | null | undefined) {
  const confirmedMessageId = String(messageId || "").trim();
  return confirmedMessageId || null;
}

function buildAiReplySupersededResult(aiText?: string): Extract<
  GenerateAndSaveAiSalesReplyResult,
  { ok: false }
> {
  return {
    ok: false,
    error: AI_REPLY_SUPERSEDED_BY_NEWER_CUSTOMER_MESSAGE,
    message:
      "Entrou mensagem mais nova do cliente durante a geracao. Ignorando esta resposta antiga.",
    ...(aiText ? { aiText } : {}),
  };
}

async function ensureBoundaryStillMatchesAnchor(args: {
  deps: CustomerContractAcceptanceFlowDeps;
  supabase: any;
  conversationId: string;
  anchorMessageId: string;
  aiText?: string;
}): Promise<Extract<GenerateAndSaveAiSalesReplyResult, { ok: false }> | null> {
  const boundary = await args.deps.loadConversationMessageBoundaryState({
    supabase: args.supabase,
    conversationId: args.conversationId,
  });

  if (boundary.lastIncomingCustomerMessageId !== args.anchorMessageId) {
    return buildAiReplySupersededResult(args.aiText);
  }

  return null;
}

export async function tryHandleCustomerContractAcceptance(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string | null;
  anchorMessageId: string;
}, deps?: Partial<CustomerContractAcceptanceFlowDeps>): Promise<GenerateAndSaveAiSalesReplyResult | null> {
  const resolvedDeps: CustomerContractAcceptanceFlowDeps = {
    detectStrongCustomerContractAcceptance,
    findEligibleSentContractForCustomerAcceptance,
    signSalesContractAsCustomer,
    buildCustomerContractAcceptanceConfirmationText,
    sendAiPanelMessage,
    loadConversationMessageBoundaryState,
    ...deps,
  };

  const anchoredCustomerMessage = await loadAnchoredIncomingCustomerMessage({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    conversationId: args.conversationId,
    messageId: args.anchorMessageId,
  });

  if (!anchoredCustomerMessage) {
    return {
      ok: false,
      error: "INVALID_GENERATION_ANCHOR_MESSAGE",
      message:
        "A mensagem-ancora explicita nao e elegivel como mensagem de cliente para a geracao comercial.",
    };
  }

  const acceptanceText = cleanText(anchoredCustomerMessage.content);

  if (!acceptanceText) {
    return {
      ok: false,
      error: "INVALID_GENERATION_ANCHOR_MESSAGE",
      message:
        "A mensagem-ancora explicita nao e elegivel como mensagem de cliente para a geracao comercial.",
    };
  }

  if (!resolvedDeps.detectStrongCustomerContractAcceptance(acceptanceText)) {
    return null;
  }

  const eligibleContract =
    await resolvedDeps.findEligibleSentContractForCustomerAcceptance({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      conversationId: args.conversationId,
      leadId: args.leadId,
      anchorMessageId: anchoredCustomerMessage.id,
      allowLeadFallback: false,
    });

  if (eligibleContract.outcome === "single") {
    const supersededBeforeSign = await ensureBoundaryStillMatchesAnchor({
      deps: resolvedDeps,
      supabase: args.supabase,
      conversationId: args.conversationId,
      anchorMessageId: anchoredCustomerMessage.id,
    });

    if (supersededBeforeSign) {
      return supersededBeforeSign;
    }

    const acceptanceResult = await resolvedDeps.signSalesContractAsCustomer({
      scope: eligibleContract.scope,
      expectedAnchorMessageId: anchoredCustomerMessage.id,
      acceptanceText,
      metadataSource: "sales_ai_conversation_customer_acceptance_v1",
      metadata: {
        accepted_via: "conversation_text",
        channel: "conversation",
        conversation_id: args.conversationId,
        lead_id: args.leadId,
        trigger_message_id: anchoredCustomerMessage.id,
        trigger_message_content: acceptanceText,
        contract_number: eligibleContract.contractNumber,
        matched_by: eligibleContract.matchedBy,
      },
    });

    const aiText = resolvedDeps.buildCustomerContractAcceptanceConfirmationText();
    const supersededBeforeSend = await ensureBoundaryStillMatchesAnchor({
      deps: resolvedDeps,
      supabase: args.supabase,
      conversationId: args.conversationId,
      anchorMessageId: anchoredCustomerMessage.id,
      aiText,
    });

    if (supersededBeforeSend) {
      return {
        ok: true,
        aiText,
        context: buildCustomerContractAcceptanceContext({
        contractId: eligibleContract.contractId,
        contractNumber: eligibleContract.contractNumber,
        matchedBy: eligibleContract.matchedBy,
        acceptanceOutcome: acceptanceResult.outcome,
        replayed: acceptanceResult.replayed,
        reconciled: acceptanceResult.reconciled,
        signatureId: acceptanceResult.signatureId,
        contractStatus: acceptanceResult.contractStatus,
        versionStatus: acceptanceResult.versionStatus,
        sideEffects: acceptanceResult.sideEffects || null,
        triggerMessageId: anchoredCustomerMessage.id,
        triggerMessageContent: acceptanceText,
        partialSuccess: true,
          confirmationPersisted: false,
          confirmationStatus: "suppressed",
          confirmationReason: AI_REPLY_SUPERSEDED_BY_NEWER_CUSTOMER_MESSAGE,
        }),
        usage: null,
        persisted: true,
        messageId: null,
      };
    }

    let messageId: string | null = null;

    try {
      messageId = await resolvedDeps.sendAiPanelMessage({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        conversationId: args.conversationId,
        aiText,
      });
    } catch (sendError: any) {
      return {
        ok: true,
        aiText,
        context: buildCustomerContractAcceptanceContext({
          contractId: eligibleContract.contractId,
          contractNumber: eligibleContract.contractNumber,
          matchedBy: eligibleContract.matchedBy,
          acceptanceOutcome: acceptanceResult.outcome,
          replayed: acceptanceResult.replayed,
          reconciled: acceptanceResult.reconciled,
          signatureId: acceptanceResult.signatureId,
          contractStatus: acceptanceResult.contractStatus,
          versionStatus: acceptanceResult.versionStatus,
          sideEffects: acceptanceResult.sideEffects || null,
          triggerMessageId: anchoredCustomerMessage.id,
          triggerMessageContent: acceptanceText,
          partialSuccess: true,
          confirmationPersisted: false,
          confirmationStatus: "failed",
          confirmationReason: "PANEL_SEND_MESSAGE_FAILED",
          confirmationErrorMessage:
            sendError?.message || "Falha ao enviar resposta da IA.",
        }),
        usage: null,
        persisted: true,
        messageId: null,
      };
    }

    messageId = normalizeConfirmedPanelMessageId(messageId);

    if (!messageId) {
      return {
        ok: true,
        aiText,
        context: buildCustomerContractAcceptanceContext({
          contractId: eligibleContract.contractId,
          contractNumber: eligibleContract.contractNumber,
          matchedBy: eligibleContract.matchedBy,
          acceptanceOutcome: acceptanceResult.outcome,
          replayed: acceptanceResult.replayed,
          reconciled: acceptanceResult.reconciled,
          signatureId: acceptanceResult.signatureId,
          contractStatus: acceptanceResult.contractStatus,
          versionStatus: acceptanceResult.versionStatus,
          sideEffects: acceptanceResult.sideEffects || null,
          triggerMessageId: anchoredCustomerMessage.id,
          triggerMessageContent: acceptanceText,
          partialSuccess: true,
          confirmationPersisted: false,
          confirmationStatus: "failed",
          confirmationReason: "PANEL_SEND_MESSAGE_FAILED",
          confirmationErrorMessage: "PANEL_SEND_MESSAGE_NOT_CONFIRMED",
        }),
        usage: null,
        persisted: true,
        messageId: null,
      };
    }

    return {
      ok: true,
      aiText,
      context: buildCustomerContractAcceptanceContext({
        contractId: eligibleContract.contractId,
        contractNumber: eligibleContract.contractNumber,
        matchedBy: eligibleContract.matchedBy,
        acceptanceOutcome: acceptanceResult.outcome,
        replayed: acceptanceResult.replayed,
        reconciled: acceptanceResult.reconciled,
        signatureId: acceptanceResult.signatureId,
        contractStatus: acceptanceResult.contractStatus,
        versionStatus: acceptanceResult.versionStatus,
        sideEffects: acceptanceResult.sideEffects || null,
        triggerMessageId: anchoredCustomerMessage.id,
        triggerMessageContent: acceptanceText,
        partialSuccess: false,
        confirmationPersisted: true,
        confirmationStatus: "sent",
        confirmationReason: null,
      }),
      usage: null,
      persisted: true,
      messageId,
    };
  }

  if (eligibleContract.outcome === "multiple") {
    const aiText =
      "Recebi seu aceite. Como encontrei mais de um contrato enviado em aberto para voce, preciso que a loja confirme qual deles seguir antes de registrar formalmente.";
    const supersededBeforeSend = await ensureBoundaryStillMatchesAnchor({
      deps: resolvedDeps,
      supabase: args.supabase,
      conversationId: args.conversationId,
      anchorMessageId: anchoredCustomerMessage.id,
      aiText,
    });

    if (supersededBeforeSend) {
      return supersededBeforeSend;
    }

    let messageId: string | null = null;

    try {
      messageId = await resolvedDeps.sendAiPanelMessage({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        conversationId: args.conversationId,
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

    messageId = normalizeConfirmedPanelMessageId(messageId);

    if (!messageId) {
      return {
        ok: false,
        error: "PANEL_SEND_MESSAGE_FAILED",
        message: "PANEL_SEND_MESSAGE_NOT_CONFIRMED",
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
        triggerMessageId: anchoredCustomerMessage.id,
        triggerMessageContent: acceptanceText,
      },
      usage: null,
      persisted: true,
      messageId,
    };
  }

  return null;
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
  canonicalScope: Awaited<
    ReturnType<typeof resolveConversationAiWindowStateScope>
  >;
  customerMessageAt?: string | null;
  preserveReason?: boolean;
  nextResumeReason?: string | null;
  queueCancelReason: string;
}) {
  const {
    supabase,
    canonicalScope,
    customerMessageAt,
    preserveReason,
    nextResumeReason,
    queueCancelReason,
  } = args;
  const nowIso = new Date().toISOString();

  const windowPatch: Record<string, unknown> = {
    conversation_id: canonicalScope.conversationId,
    organization_id: canonicalScope.organizationId,
    store_id: canonicalScope.storeId,
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

  const queuePrefix = `resume:${canonicalScope.conversationId}:`;
  const { error: queueError } = await supabase
    .from("ai_run_queue")
    .update({
      processed_at: nowIso,
      processing_error: queueCancelReason,
    })
    .eq("organization_id", canonicalScope.organizationId)
    .eq("store_id", canonicalScope.storeId)
    .eq("conversation_id", canonicalScope.conversationId)
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
  canonicalScope: Awaited<
    ReturnType<typeof resolveConversationAiWindowStateScope>
  >;
  leadId: string | null;
  decision: OperationalFollowUpDecision;
  lastCustomerMessageAt: string | null;
  lastAiMessageAt: string | null;
}) {
  const {
    supabase,
    canonicalScope,
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
    organizationId: canonicalScope.organizationId,
    storeId: canonicalScope.storeId,
  });

  if (decision.kind === "stop_contact") {
    await clearPendingResumeArtifacts({
      supabase,
      canonicalScope,
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
      .eq("conversation_id", canonicalScope.conversationId)
      .eq("organization_id", canonicalScope.organizationId)
      .eq("store_id", canonicalScope.storeId);

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
    conversation_id: canonicalScope.conversationId,
    organization_id: canonicalScope.organizationId,
    store_id: canonicalScope.storeId,
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
    canonicalScope,
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

  const queueKey = `resume:${canonicalScope.conversationId}:${decision.reason}:${formatQueueTimestamp(nextResumeAt, timeZone)}`;
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
      organization_id: canonicalScope.organizationId,
      store_id: canonicalScope.storeId,
      conversation_id: canonicalScope.conversationId,
      lead_id: canonicalScope.leadId || leadId,
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

function readCommercialOpportunityIdFromHandoff(
  handoff: CommercialHandoffContext | null | undefined,
) {
  return cleanText(handoff?.commercialOpportunityId) || null;
}

function getRequiredCommercialOpportunityIdFromHandoff(
  handoff: CommercialHandoffContext,
) {
  if (!handoff.shouldCreateTask) {
    throw new Error("COMMERCIAL_HANDOFF_MISSING_OPPORTUNITY_CONTEXT");
  }

  const commercialOpportunityId = readCommercialOpportunityIdFromHandoff(handoff);

  if (!commercialOpportunityId) {
    throw new Error("COMMERCIAL_HANDOFF_MISSING_OPPORTUNITY_CONTEXT");
  }

  return commercialOpportunityId;
}

export async function createCommercialAssistantHandoff(
  args: {
  supabase: any;
  systemSupabase?: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string | null;
  handoff: CommercialHandoffContext | null | undefined;
  generationAnchorMessageId?: string | null;
},
  deps: CommercialAssistantHandoffDeps = {
    findExistingTask: findExistingCommercialHandoffTask,
    enqueueNotification: enqueueCommercialHandoffNotification,
    autoProgressBudgetFromQuote: maybeAutoProgressCrmToBudgetFromQuoteHandoffCanonical,
  },
): Promise<CommercialHandoffCreationResult> {
  const handoff = args.handoff;

  if (!handoff || !handoff.shouldCreateTask) {
    return { created: false, skipped: true, reason: "handoff_not_requested" };
  }

  const commercialOpportunityId =
    getRequiredCommercialOpportunityIdFromHandoff(handoff);

  const similarTask = await deps.findExistingTask({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    conversationId: args.conversationId,
    taskType: handoff.taskType,
    commercialOpportunityId,
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
      commercial_opportunity_id: commercialOpportunityId,
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

  const notificationResult = await deps.enqueueNotification({
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
    crmAutoProgressResult = await deps.autoProgressBudgetFromQuote({
      supabase: args.supabase,
      systemSupabase: args.systemSupabase || args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      conversationId: args.conversationId,
      leadId: args.leadId || null,
      taskId: String(data.id),
      handoff,
      generationAnchorMessageId: args.generationAnchorMessageId || null,
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
  params: GenerateAndSaveAiSalesReplyParams,
  deps?: Partial<GenerateAndSaveAiSalesReplyDeps>,
): Promise<GenerateAndSaveAiSalesReplyResult> {
  try {
    const resolvedDeps: GenerateAndSaveAiSalesReplyDeps = {
      createSupabaseClient: createClient,
      detectOpenAssistantOperationalFlow,
      loadConversationMessageBoundaryState,
      tryHandleCustomerContractAcceptance,
      generateAiSalesReply,
      updateLatestRunningAiRunUsage,
      sendAiPanelMessage,
      createCommercialAssistantHandoff,
      ...deps,
    };
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

    const supabase = resolvedDeps.createSupabaseClient(
      supabaseUrl,
      supabaseServiceKey,
    );
    const systemSupabase = resolvedDeps.createSupabaseClient(
      supabaseUrl,
      supabaseServiceKey,
    );

    let canonicalScope: Awaited<
      ReturnType<typeof resolveConversationAiWindowStateScope>
    >;
    try {
      canonicalScope = await resolveConversationAiWindowStateScope({
        supabase,
        conversationId,
        expectedOrganizationId: organizationId,
        expectedStoreId: storeId,
      });
    } catch (scopeError) {
      const mappedScopeError = mapConversationScopeResolutionError(scopeError);

      if (!mappedScopeError.ok) {
        return mappedScopeError.result;
      }

      throw scopeError;
    }

    const canonicalOrganizationId = canonicalScope.organizationId;
    const canonicalStoreId = canonicalScope.storeId;
    const canonicalConversationId = canonicalScope.conversationId;
    const conversation: ConversationRow = {
      id: canonicalConversationId,
      organization_id: canonicalOrganizationId,
      lead_id: canonicalScope.leadId,
      is_human_active: canonicalScope.isHumanActive,
    };

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

    const operationalGuard = await resolvedDeps.detectOpenAssistantOperationalFlow({
      supabase,
      organizationId: canonicalOrganizationId,
      storeId: canonicalStoreId,
      conversationId: canonicalConversationId,
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

    const boundaryBeforeGeneration = await resolvedDeps.loadConversationMessageBoundaryState({
      supabase,
      conversationId: canonicalConversationId,
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
      canonicalScope,
      customerMessageAt: boundaryBeforeGeneration.lastIncomingCustomerMessageAt,
      preserveReason: false,
      nextResumeReason: null,
      queueCancelReason: "cancelled_by_new_customer_message",
    });

    const contractAcceptanceResult = await resolvedDeps.tryHandleCustomerContractAcceptance({
      supabase,
      organizationId: canonicalOrganizationId,
      storeId: canonicalStoreId,
      conversationId: canonicalConversationId,
      leadId: normalizedConversation.lead_id || null,
      anchorMessageId: boundaryBeforeGeneration.lastIncomingCustomerMessageId,
    });

    if (contractAcceptanceResult) {
      return contractAcceptanceResult;
    }

    const generationResult = await resolvedDeps.generateAiSalesReply({
      organizationId: canonicalOrganizationId,
      storeId: canonicalStoreId,
      conversationId: canonicalConversationId,
      anchorMessageId: boundaryBeforeGeneration.lastIncomingCustomerMessageId,
    });

    if (generationResult.ok === false) {
      return {
        ok: false,
        error: generationResult.error,
        message: generationResult.message,
      };
    }

    let aiText = String(generationResult.aiText || "").trim();
    const generationAnchorMessageId = String(generationResult.anchorMessageId || "").trim();
    const generationResponseAnchorCommercialContext =
      (generationResult.context?.responseAnchorCommercialContext ||
        null) as ResponseAnchorCommercialContext | null;

    if (
      !generationAnchorMessageId ||
      generationAnchorMessageId !== boundaryBeforeGeneration.lastIncomingCustomerMessageId
    ) {
      return {
        ok: false,
        error: AI_REPLY_GENERATION_ANCHOR_MISMATCH,
        message:
          "A geracao nao preservou a mensagem-ancora capturada antes da execucao. A resposta foi descartada com seguranca.",
      };
    }

    if (!aiText) {
      return {
        ok: false,
        error: "EMPTY_AI_TEXT",
        message: "A IA não retornou texto para salvar.",
      };
    }

    try {
      await resolvedDeps.updateLatestRunningAiRunUsage({
        supabase,
        organizationId: canonicalOrganizationId,
        storeId: canonicalStoreId,
        conversationId: canonicalConversationId,
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

    const boundaryBeforeSave = await resolvedDeps.loadConversationMessageBoundaryState({
      supabase,
      conversationId: canonicalConversationId,
    });

    if (
      boundaryBeforeSave.lastIncomingCustomerMessageId !==
      boundaryBeforeGeneration.lastIncomingCustomerMessageId
    ) {
      return buildAiReplySupersededResult(aiText);
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
    let validatedCommercialHandoff = requestedCommercialHandoff;
    let requestedCommercialOpportunityId: string | null = null;

    if (requestedCommercialHandoff?.shouldCreateTask) {
      try {
        requestedCommercialOpportunityId =
          getRequiredCommercialOpportunityIdFromHandoff(
            requestedCommercialHandoff
          );
      } catch {
        validatedCommercialHandoff = null;
        console.info("[zion-ai-sales-handoff] commercial handoff skipped", {
          reason: "missing_commercial_opportunity_context",
          organizationId: canonicalOrganizationId,
          storeId: canonicalStoreId,
          conversationId: canonicalConversationId,
        });
      }

      if (validatedCommercialHandoff && requestedCommercialOpportunityId) {
        try {
          const similarOpenHandoff = await findExistingCommercialHandoffTask({
            supabase,
            organizationId: canonicalOrganizationId,
            storeId: canonicalStoreId,
            conversationId: canonicalConversationId,
            taskType: validatedCommercialHandoff.taskType,
            commercialOpportunityId: requestedCommercialOpportunityId,
          });

          if (similarOpenHandoff) {
            aiText =
              validatedCommercialHandoff.taskType === "commercial_quote_request"
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
    }

    let messageId: string | null = null;

    try {
      messageId = await resolvedDeps.sendAiPanelMessage({
        supabase,
        organizationId: canonicalOrganizationId,
        storeId: canonicalStoreId,
        conversationId: canonicalConversationId,
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
      catalogPhotoAction.organizationId === canonicalOrganizationId &&
      catalogPhotoAction.storeId === canonicalStoreId
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
          p_conversation_id: canonicalConversationId,
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
      canonicalScope,
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
      commercialHandoffResult = await resolvedDeps.createCommercialAssistantHandoff({
        supabase,
        systemSupabase,
        organizationId: canonicalOrganizationId,
        storeId: canonicalStoreId,
        conversationId: canonicalConversationId,
        leadId: normalizedConversation.lead_id || null,
        handoff: validatedCommercialHandoff,
        generationAnchorMessageId,
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
        organizationId: canonicalOrganizationId,
        storeId: canonicalStoreId,
        conversationId: canonicalConversationId,
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
      validatedCommercialHandoff?.shouldCreateTask === true &&
      validatedCommercialHandoff?.taskType === "commercial_quote_request" &&
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
          await maybeAutoProgressCrmToQualificationFromSalesSignalCanonical({
            supabase,
            systemSupabase,
            organizationId: canonicalOrganizationId,
            storeId: canonicalStoreId,
            conversationId: canonicalConversationId,
            leadId: normalizedConversation.lead_id || null,
            commercialOpportunityId:
              generationResponseAnchorCommercialContext?.commercialOpportunityId ||
              null,
            generationAnchorMessageId,
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
    return mapGenerateAndSaveAiSalesReplyError(error);
  }
}
