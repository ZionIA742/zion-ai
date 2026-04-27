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

type ConversationRow = {
  id: string;
  organization_id: string;
  is_human_active: boolean | null;
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