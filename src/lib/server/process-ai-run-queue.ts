import { createClient } from "@supabase/supabase-js";
import { generateAndSaveAiSalesReply } from "./generate-and-save-ai-sales-reply";

type AiRunQueueRow = {
  id: string;
  organization_id: string | null;
  store_id: string | null;
  conversation_id: string | null;
  lead_id: string | null;
  queue_key: string | null;
  input: Record<string, unknown> | null;
};

type ConversationAutomationRow = {
  id: string;
  status: string | null;
  is_human_active: boolean | null;
};

type ProcessAiRunQueueInput = {
  organizationId: string;
  storeId: string;
  limit?: number;
  supabaseClient?: any;
  runAiFlow?: typeof generateAndSaveAiSalesReply;
};

export type ProcessAiRunQueueResult = {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: Array<{
    queueId: string;
    queueKey: string | null;
    status: "succeeded" | "failed" | "skipped";
    detail: string | null;
  }>;
};

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY ou NEXT_PUBLIC_SUPABASE_URL ausente.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown_error");
}

function isDueSalesResume(row: AiRunQueueRow): boolean {
  const input = row.input && typeof row.input === "object" ? row.input : {};
  const reason = String(input.reason || "");

  const supportedReasons = new Set([
    "sales_ai_after_hours_policy",
    "customer_requested_tomorrow",
    "customer_requested_next_week",
    "customer_requested_next_month",
  ]);

  return (
    input.type === "resume_sales_conversation" &&
    supportedReasons.has(reason) &&
    Boolean(input.resumeAt) &&
    Date.parse(String(input.resumeAt)) <= Date.now()
  );
}

async function markQueueProcessed(args: {
  supabase: any;
  id: string;
  organizationId: string;
  storeId: string;
  detail: string | null;
}) {
  const { error } = await args.supabase
    .from("ai_run_queue")
    .update({
      processed_at: new Date().toISOString(),
      processing_error: args.detail,
    })
    .eq("id", args.id)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .is("processed_at", null);

  if (error) {
    throw new Error(`Falha ao marcar ai_run_queue processado: ${error.message}`);
  }
}

async function loadConversationAutomationState(args: {
  supabase: any;
  organizationId: string;
  conversationId: string;
}): Promise<ConversationAutomationRow | null> {
  const { data, error } = await args.supabase
    .from("conversations")
    .select("id, status, is_human_active")
    .eq("id", args.conversationId)
    .eq("organization_id", args.organizationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao consultar conversa atual da retomada: ${error.message}`);
  }

  return (data as ConversationAutomationRow | null) || null;
}

async function consumeMatchingSalesResumeWindowState(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  reason: string;
  resumeAt: string;
}) {
  const { error } = await args.supabase
    .from("conversation_ai_window_state")
    .update({
      waiting_next_day: false,
      next_resume_at: null,
      resume_reason: "none",
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("conversation_id", args.conversationId)
    .eq("resume_reason", args.reason)
    .eq("next_resume_at", args.resumeAt);

  if (error) {
    throw new Error(
      `Falha ao consumir estado canonico da retomada: ${error.message}`,
    );
  }
}

export async function processDueAiRunQueue(
  input: ProcessAiRunQueueInput,
): Promise<ProcessAiRunQueueResult> {
  const organizationId = String(input.organizationId || "").trim();
  const storeId = String(input.storeId || "").trim();
  const limit = Math.max(1, Math.min(Number(input.limit ?? 10) || 10, 100));

  if (!organizationId || !storeId) {
    throw new Error("organizationId e storeId sao obrigatorios.");
  }

  const supabase = input.supabaseClient || getSupabaseAdmin();
  const runAiFlow = input.runAiFlow || generateAndSaveAiSalesReply;
  const { data, error } = await supabase
    .from("ai_run_queue")
    .select("id, organization_id, store_id, conversation_id, lead_id, queue_key, input")
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .is("processed_at", null)
    .lte("enqueued_at", new Date().toISOString())
    .order("enqueued_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Falha ao carregar ai_run_queue vencida: ${error.message}`);
  }

  const results: ProcessAiRunQueueResult["results"] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of ((data || []) as AiRunQueueRow[]).filter(isDueSalesResume)) {
    const queueId = String(row.id || "").trim();
    const conversationId = String(row.conversation_id || "").trim();
    const queueKey = row.queue_key || null;
    const queueInput =
      row.input && typeof row.input === "object" ? row.input : {};
    const resumeReason = String(queueInput.reason || "").trim();
    const resumeAt = String(queueInput.resumeAt || "").trim();
    const anchorMessageId = String(queueInput.anchorMessageId || "").trim();
    const styleHint =
      String(queueInput.styleHint || queueInput.style_hint || "").trim() || null;

    if (!queueId || !conversationId) {
      skipped += 1;
      results.push({
        queueId,
        queueKey,
        status: "skipped",
        detail: "queue_missing_conversation",
      });
      continue;
    }

    if (!anchorMessageId) {
      await markQueueProcessed({
        supabase,
        id: queueId,
        organizationId,
        storeId,
        detail: "resume_anchor_missing",
      });
      await consumeMatchingSalesResumeWindowState({
        supabase,
        organizationId,
        storeId,
        conversationId,
        reason: resumeReason,
        resumeAt,
      });
      skipped += 1;
      results.push({
        queueId,
        queueKey,
        status: "skipped",
        detail: "resume_anchor_missing",
      });
      continue;
    }

    try {
      const conversation = await loadConversationAutomationState({
        supabase,
        organizationId,
        conversationId,
      });

      if (!conversation?.id || String(conversation.status || "").trim() !== "active") {
        await markQueueProcessed({
          supabase,
          id: queueId,
          organizationId,
          storeId,
          detail: "conversation_not_active",
        });
        await consumeMatchingSalesResumeWindowState({
          supabase,
          organizationId,
          storeId,
          conversationId,
          reason: resumeReason,
          resumeAt,
        });
        skipped += 1;
        results.push({
          queueId,
          queueKey,
          status: "skipped",
          detail: "conversation_not_active",
        });
        continue;
      }

      if (conversation.is_human_active === true) {
        await markQueueProcessed({
          supabase,
          id: queueId,
          organizationId,
          storeId,
          detail: "human_active",
        });
        await consumeMatchingSalesResumeWindowState({
          supabase,
          organizationId,
          storeId,
          conversationId,
          reason: resumeReason,
          resumeAt,
        });
        skipped += 1;
        results.push({ queueId, queueKey, status: "skipped", detail: "human_active" });
        continue;
      }

      const aiResult = await runAiFlow({
        organizationId,
        storeId,
        conversationId,
        executionContext: {
          kind: "scheduled_resume",
          queueId,
          queueKey,
          reason: resumeReason as
            | "sales_ai_after_hours_policy"
            | "customer_requested_tomorrow"
            | "customer_requested_next_week"
            | "customer_requested_next_month",
          resumeAt,
          anchorMessageId,
          styleHint,
        },
      });
      const detail = aiResult.ok ? null : aiResult.error;

      await markQueueProcessed({
        supabase,
        id: queueId,
        organizationId,
        storeId,
        detail,
      });

      await consumeMatchingSalesResumeWindowState({
        supabase,
        organizationId,
        storeId,
        conversationId,
        reason: resumeReason,
        resumeAt,
      });

      if (aiResult.ok) {
        succeeded += 1;
        results.push({ queueId, queueKey, status: "succeeded", detail: null });
      } else if (
        aiResult.error === "HUMAN_HANDOFF_ACTIVE" ||
        aiResult.error === "HUMAN_ACTIVE" ||
        aiResult.error === "AI_REPLY_ALREADY_EXISTS_FOR_LATEST_CUSTOMER_MESSAGE" ||
        aiResult.error === "AI_REPLY_SUPERSEDED_BY_NEWER_CUSTOMER_MESSAGE" ||
        aiResult.error === "SALES_AI_NOT_ALLOWED_NOW"
      ) {
        skipped += 1;
        results.push({ queueId, queueKey, status: "skipped", detail });
      } else {
        failed += 1;
        results.push({ queueId, queueKey, status: "failed", detail });
      }
    } catch (error) {
      const detail = safeError(error);
      failed += 1;
      results.push({ queueId, queueKey, status: "failed", detail });
    }
  }

  return {
    processed: succeeded + failed + skipped,
    succeeded,
    failed,
    skipped,
    results,
  };
}
