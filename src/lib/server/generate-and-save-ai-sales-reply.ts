import { createClient } from "@supabase/supabase-js";
import { generateAiSalesReply } from "./generate-ai-sales-reply";

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
  is_human_active: boolean | null;
};

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
      .select("id, organization_id, is_human_active")
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
