import { createClient } from "@supabase/supabase-js";
import {
  generateAiSalesReply,
  type OperationalFollowUpDecision,
} from "./generate-ai-sales-reply";

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

type ConversationRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
  is_human_active: boolean | null;
};

type StoreScheduleSettingsRow = {
  timezone_name: string | null;
};

const NO_RESUME_REASON = "none";

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

  const { data: openTask, error: openTaskError } = await supabase
    .from("store_assistant_operational_tasks")
    .select("id, task_type, status")
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .eq("related_conversation_id", conversationId)
    .in("status", openTaskStatuses)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (openTaskError) {
    throw new Error(
      `Falha ao verificar tarefas operacionais abertas: ${openTaskError.message}`
    );
  }

  if (openTask) {
    return {
      blocked: true,
      reason: "open_operational_task",
      taskId: openTask.id || null,
      taskType: openTask.task_type || null,
      taskStatus: openTask.status || null,
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

    const aiText = String(generationResult.aiText || "").trim();

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

    const { data: messageId, error: sendError } = await supabase.rpc(
      "panel_send_message",
      {
        p_conversation_id: conversationId,
        p_text: aiText,
        p_sender: "ai",
        p_external_message_id: null,
      }
    );

    if (sendError) {
      return {
        ok: false,
        error: "PANEL_SEND_MESSAGE_FAILED",
        message: sendError.message,
        aiText,
      };
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

    return {
      ok: true,
      aiText,
      context: generationResult.context,
      usage: generationResult.usage,
      persisted: true,
      messageId: messageId ?? null,
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
