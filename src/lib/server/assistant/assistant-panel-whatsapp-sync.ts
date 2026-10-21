import { createClient } from "@supabase/supabase-js";
import { loadCanonicalActivePrimaryStoreResponsible } from "@/lib/server/store-responsibles";
import {
  sendResponsibleExternalNotification,
  type SendResponsibleExternalNotificationResult,
} from "@/lib/server/assistant/responsible-external-notifications-sender";
import { prepareResponsibleExternalNotification } from "@/lib/server/assistant/responsible-external-notifications";

type SupabaseError = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
} | null;
type SupabaseAwaitable<T> = PromiseLike<T>;
type SupabaseQueryLike = {
  eq(column: string, value: unknown): SupabaseQueryLike;
  gte(column: string, value: unknown): SupabaseQueryLike;
  in(column: string, value: unknown): SupabaseQueryLike;
  contains(column: string, value: unknown): SupabaseQueryLike;
  order(column: string, options: { ascending: boolean }): SupabaseQueryLike;
  limit(value: number): SupabaseQueryLike;
  maybeSingle(): SupabaseAwaitable<{ data: unknown; error: SupabaseError }>;
};
type SupabaseUpdateLike = Omit<SupabaseQueryLike, "eq"> & {
  eq(column: string, value: unknown): SupabaseUpdateLike;
  select(columns: string): SupabaseQueryLike;
};
type SupabaseInsertLike = {
  select(columns: string): SupabaseQueryLike;
  maybeSingle(): SupabaseAwaitable<{ data: unknown; error: SupabaseError }>;
};
type SupabaseTableLike = {
  select(columns: string): SupabaseQueryLike;
  insert(payload: Record<string, unknown>): SupabaseInsertLike;
  update(payload: Record<string, unknown>): SupabaseUpdateLike;
};
type SupabaseClientLike = {
  from(table: string): SupabaseTableLike;
  rpc(name: string, args: Record<string, unknown>): SupabaseAwaitable<{ data: unknown; error: SupabaseError }>;
};

function getSupabaseAdmin(): SupabaseClientLike {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Supabase server environment is not configured.");
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as SupabaseClientLike;
}
type AssistantPanelMessage = {
  id: string;
  organization_id: string;
  store_id: string;
  thread_id: string | null;
  sender_role: string | null;
  direction: string | null;
  content: string | null;
  metadata: Record<string, unknown> | null;
};

export type AssistantPanelWhatsappSyncResult = {
  ok: boolean;
  status:
    | "sent"
    | "already_sent"
    | "already_processing"
    | "failed"
    | "uncertain"
    | "not_attempted";
  notificationId?: string | null;
  externalMessageId?: string | null;
  reason?: string | null;
};

type SyncDependencies = {
  supabase?: SupabaseClientLike;
  send?: (
    input: Parameters<typeof sendResponsibleExternalNotification>[0],
  ) => Promise<SendResponsibleExternalNotificationResult>;
  prepare?: typeof prepareResponsibleExternalNotification;
};

const MAX_PANEL_SYNC_ATTEMPTS = 3;
const PERMANENT_PANEL_SYNC_FAILURES = new Set([
  "RESPONSIBLE_WHATSAPP_TEMPLATE_KIND_REQUIRED",
  "RESPONSIBLE_WHATSAPP_TEMPLATE_CONTEXT_INVALID",
]);

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function activationTimestamp(value: unknown) {
  const raw = cleanText(value) || cleanText(process.env.ASSISTANT_PANEL_WHATSAPP_SYNC_ACTIVATED_AT);
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function extractId(value: unknown): string | null {
  if (Array.isArray(value)) return extractId(value[0]);
  if (!value || typeof value !== "object") return null;
  const id = cleanText((value as { id?: unknown }).id);
  return id || null;
}

function isDuplicateError(error: SupabaseError) {
  return (
    cleanText(error?.code) === "23505" ||
    cleanText(error?.message).toLowerCase().includes("duplicate key")
  );
}

function isPanelSyncEventDuplicateError(error: SupabaseError) {
  if (cleanText(error?.code) !== "23505") return false;

  const diagnostic = [error?.message, error?.details, error?.hint]
    .map(cleanText)
    .join(" ")
    .toLowerCase();

  return diagnostic.includes("uq_store_assistant_notification_panel_sync_event");
}

function isPermanentPanelSyncFailure(reason: unknown) {
  return PERMANENT_PANEL_SYNC_FAILURES.has(cleanText(reason));
}

function eventKey(messageId: string, kind: "human" | "assistant") {
  return `assistant-panel-whatsapp:${kind}:${messageId}`;
}

function parsePanelSyncEventKey(value: unknown) {
  const match = cleanText(value).match(/^assistant-panel-whatsapp:(human|assistant):([^:]+)$/);
  if (!match) return null;

  return {
    kind: match[1] as "human" | "assistant",
    messageId: match[2],
  };
}

async function loadPanelMessage(args: {
  supabase: SupabaseClientLike;
  organizationId: string;
  storeId: string;
  messageId: string;
  kind: "human" | "assistant";
}) {
  let query = args.supabase
    .from("store_assistant_messages")
    .select("id, organization_id, store_id, thread_id, sender_role, direction, content, metadata")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId);

  query = args.kind === "human"
    ? query.eq("id", args.messageId).eq("sender_role", "store_responsible")
    : query
        .in("sender_role", ["assistant", "assistant_operational"])
        .contains("metadata", { source_external_message_id: `panel:${args.messageId}` })
        .order("created_at", { ascending: false });

  const { data, error } = await query.limit(1).maybeSingle();

  if (error) throw new Error(`Falha ao carregar mensagem do painel: ${error.message}`);
  return (data as AssistantPanelMessage | null) || null;
}

async function loadExistingNotification(args: {
  supabase: SupabaseClientLike;
  organizationId: string;
  storeId: string;
  sourceEventKey: string;
}) {
  const { data, error } = await args.supabase
    .from("store_responsible_external_notifications")
    .select("id, status, external_message_id, error_text, attempts")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("source_event_key", args.sourceEventKey)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Falha ao verificar sincronização do painel: ${error.message}`);
  return data as {
    id: string;
    status: string | null;
    external_message_id: string | null;
    error_text: string | null;
    attempts?: number | null;
  } | null;
}

async function confirmExternalNotificationSent(args: {
  supabase: SupabaseClientLike;
  organizationId: string;
  storeId: string;
  notificationId: string;
}) {
  const { data, error } = await args.supabase
    .from("store_responsible_external_notifications")
    .select("id, status, external_message_id, error_text")
    .eq("id", args.notificationId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Falha ao confirmar envio externo do painel: ${error.message}`);

  const row = data as {
    status?: string | null;
    external_message_id?: string | null;
    error_text?: string | null;
  } | null;
  const status = cleanText(row?.status);
  const externalMessageId = cleanText(row?.external_message_id);

  if (status === "sent" && externalMessageId) {
    return { confirmed: true as const, externalMessageId };
  }

  return {
    confirmed: false as const,
    status: status === "uncertain" ? "uncertain" as const : status === "processing" ? "already_processing" as const : "failed" as const,
    reason: cleanText(row?.error_text) || "external_send_not_confirmed",
  };
}

async function markInternalNotificationFailed(args: {
  supabase: SupabaseClientLike;
  notificationId: string;
  organizationId: string;
  storeId: string;
  reason: string;
}) {
  const now = new Date().toISOString();
  const { error } = await args.supabase
    .from("store_assistant_notification_queue")
    .update({
      status: "failed",
      processed_at: now,
      error_text: args.reason,
      updated_at: now,
    })
    .eq("id", args.notificationId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("notification_type", "assistant_panel_sync")
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Falha ao marcar sincronizacao do painel como failed: ${error.message}`);
}

async function resolveDeterministicSendFailureReason(args: {
  supabase: SupabaseClientLike;
  organizationId: string;
  storeId: string;
  sourceEventKey: string;
  fallback: string;
}) {
  try {
    const latest = await loadExistingNotification(args);
    return cleanText(latest?.error_text) || args.fallback;
  } catch {
    return args.fallback;
  }
}

async function loadInternalNotificationId(args: {
  supabase: SupabaseClientLike;
  organizationId: string;
  storeId: string;
  sourceEventKey: string;
  rpcData: unknown;
}) {
  const returnedId = extractId(args.rpcData);
  if (returnedId) return returnedId;

  const { data, error } = await args.supabase
    .from("store_assistant_notification_queue")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("notification_type", "assistant_panel_sync")
    .contains("context", { event_key: args.sourceEventKey })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Falha ao localizar notificação interna do painel: ${error.message}`);
  return extractId(data);
}

async function ensureNotification(args: {
  supabase: SupabaseClientLike;
  organizationId: string;
  storeId: string;
  responsibleId: string;
  destination: string;
  sourceEventKey: string;
  message: string;
  kind: "human" | "assistant";
}) {
  const existing = await loadExistingNotification(args);
  if (existing?.id) return existing;

  const { data: rpcData, error: rpcError } = await args.supabase.rpc(
    "assistant_enqueue_internal_notification",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_notification_type: "assistant_panel_sync",
      p_title: args.kind === "human" ? "Mensagem do painel" : "Resposta da Assistente",
      p_body: args.message,
      p_priority: "normal",
      p_context: {
        source: "assistant_panel_whatsapp_sync",
        event_key: args.sourceEventKey,
        message_kind: args.kind,
      },
      p_related_lead_id: null,
      p_related_conversation_id: null,
      p_related_appointment_id: null,
      p_event_key: args.sourceEventKey,
    },
  );

  let internalNotificationId: string | null;
  if (rpcError) {
    if (!isPanelSyncEventDuplicateError(rpcError)) {
      throw new Error(`Falha ao criar ledger interno do painel: ${rpcError.message}`);
    }

    internalNotificationId = await loadInternalNotificationId({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      sourceEventKey: args.sourceEventKey,
      rpcData: null,
    });
  } else {
    internalNotificationId = await loadInternalNotificationId({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      sourceEventKey: args.sourceEventKey,
      rpcData,
    });
  }

  if (!internalNotificationId) {
    throw new Error("Ledger interno do painel não confirmou seu identificador.");
  }

  const { data, error } = await args.supabase
    .from("store_responsible_external_notifications")
    .insert({
      organization_id: args.organizationId,
      store_id: args.storeId,
      responsible_id: args.responsibleId,
      internal_notification_id: internalNotificationId,
      channel: "whatsapp_responsible",
      destination: args.destination,
      notification_type: "assistant_panel_sync",
      priority: "normal",
      status: "ready_to_send",
      title: args.kind === "human" ? "Mensagem do painel" : "Resposta da Assistente",
      body: args.message,
      rendered_message: args.message,
      context: {
        source: "assistant_panel_whatsapp_sync",
        event_key: args.sourceEventKey,
        message_kind: args.kind,
      },
      source_event_key: args.sourceEventKey,
    })
    .select("id, status, external_message_id, error_text")
    .maybeSingle();

  if (error) {
    if (isDuplicateError(error)) return loadExistingNotification(args);
    throw new Error(`Falha ao criar ledger externo do painel: ${error.message}`);
  }

  return data as {
    id: string;
    status: string | null;
    external_message_id: string | null;
    error_text: string | null;
  } | null;
}

export async function syncAssistantPanelMessageToResponsibleWhatsapp(
  args: {
    organizationId: string;
    storeId: string;
    messageId: string;
    kind: "human" | "assistant";
    textPrefix?: string;
  },
  dependencies: SyncDependencies = {},
): Promise<AssistantPanelWhatsappSyncResult> {
  const organizationId = cleanText(args.organizationId);
  const storeId = cleanText(args.storeId);
  const messageId = cleanText(args.messageId);
  if (!organizationId || !storeId || !messageId) {
    return { ok: false, status: "not_attempted", reason: "missing_scope_or_message" };
  }

  const supabase = dependencies.supabase || getSupabaseAdmin();
  const message = await loadPanelMessage({ supabase, organizationId, storeId, messageId, kind: args.kind });
  if (!message || (args.kind === "human" && message.sender_role !== "store_responsible")) {
    return { ok: false, status: "not_attempted", reason: "panel_message_not_found_or_invalid" };
  }

  if (args.kind === "human" && cleanText(message.metadata?.origin) !== "panel") {
    return { ok: false, status: "not_attempted", reason: "message_is_not_from_panel" };
  }

  const text = cleanText(message.content);
  if (!text) return { ok: false, status: "not_attempted", reason: "empty_message" };

  const sourceEventKey = eventKey(messageId, args.kind);
  const existing = await loadExistingNotification({
    supabase,
    organizationId,
    storeId,
    sourceEventKey,
  });
  if (existing?.id) {
    let status = cleanText(existing.status);
    if (status === "sent" && existing.external_message_id) {
      return { ok: true, status: "already_sent", notificationId: existing.id, externalMessageId: existing.external_message_id };
    }
    if (status === "failed" && isPermanentPanelSyncFailure(existing.error_text)) {
      return {
        ok: false,
        status: "failed",
        notificationId: existing.id,
        reason: cleanText(existing.error_text),
      };
    }
    if (status === "materialized" || status === "failed") {
      if (Number(existing.attempts || 0) >= MAX_PANEL_SYNC_ATTEMPTS) {
        return {
          ok: false,
          status: "already_processing",
          notificationId: existing.id,
          reason: "automatic_attempt_limit_reached",
        };
      }

      const prepare = dependencies.prepare || prepareResponsibleExternalNotification;
      const prepared = await prepare({
        supabase: supabase as never,
        organizationId,
        storeId,
        notificationId: existing.id,
      });
      if (!prepared.ok) {
        return {
          ok: false,
          status: "already_processing",
          notificationId: existing.id,
          reason: prepared.reason,
        };
      }
      status = "ready_to_send";
    }
    if (status !== "ready_to_send") {
      return { ok: false, status: status === "uncertain" ? "uncertain" : "already_processing", notificationId: existing.id, reason: existing.error_text || status };
    }

    const send = dependencies.send || sendResponsibleExternalNotification;
    const result = await send({
      organizationId,
      storeId,
      notificationId: existing.id,
      uncertainOnTransportFailure: true,
    });
    if (result.ok) {
      const confirmation = await confirmExternalNotificationSent({
        supabase,
        organizationId,
        storeId,
        notificationId: existing.id,
      });
      if (!confirmation.confirmed) {
        return { ok: false, status: confirmation.status, notificationId: existing.id, reason: confirmation.reason };
      }
      return { ok: true, status: "sent", notificationId: existing.id, externalMessageId: confirmation.externalMessageId };
    }
    return {
      ok: false,
      status: result.reason === "send_uncertain" ? "uncertain" : "failed",
      notificationId: existing.id,
      reason:
        result.reason === "send_uncertain"
          ? result.reason
          : await resolveDeterministicSendFailureReason({
              supabase,
              organizationId,
              storeId,
              sourceEventKey,
              fallback: result.reason,
            }),
    };
  }

  const responsible = await loadCanonicalActivePrimaryStoreResponsible({
    supabase: supabase as never,
    organizationId,
    storeId,
  });
  if (!responsible.ok) return { ok: false, status: "failed", reason: responsible.reason };

  const messageToSend = `${args.textPrefix || ""}${text}`;
  let notification: Awaited<ReturnType<typeof ensureNotification>>;
  try {
    notification = await ensureNotification({
      supabase,
      organizationId,
      storeId,
      responsibleId: responsible.responsible.id,
      destination: responsible.responsible.whatsappNumber,
      sourceEventKey,
      message: messageToSend,
      kind: args.kind,
    });
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      reason: error instanceof Error ? error.message : "notification_not_confirmed",
    };
  }
  if (!notification?.id) return { ok: false, status: "failed", reason: "notification_not_created" };

  const send = dependencies.send || sendResponsibleExternalNotification;
  const result = await send({
    organizationId,
    storeId,
    notificationId: notification.id,
    uncertainOnTransportFailure: true,
  });

  if (result.ok) {
    const confirmation = await confirmExternalNotificationSent({
      supabase,
      organizationId,
      storeId,
      notificationId: notification.id,
    });
    if (!confirmation.confirmed) {
      return { ok: false, status: confirmation.status, notificationId: notification.id, reason: confirmation.reason };
    }
    return { ok: true, status: "sent", notificationId: notification.id, externalMessageId: confirmation.externalMessageId };
  }
  return {
    ok: false,
    status: result.reason === "send_uncertain" ? "uncertain" : "failed",
    notificationId: notification.id,
    reason:
      result.reason === "send_uncertain"
        ? result.reason
        : await resolveDeterministicSendFailureReason({
            supabase,
            organizationId,
            storeId,
            sourceEventKey,
            fallback: result.reason,
          }),
  };
}

export async function recoverPendingAssistantPanelSyncNotifications(args: {
  organizationId: string;
  storeId: string;
  activationAt?: string | null;
  limit?: number;
  supabase?: SupabaseClientLike;
  send?: SyncDependencies["send"];
}) {
  const organizationId = cleanText(args.organizationId);
  const storeId = cleanText(args.storeId);
  const limit = Math.max(1, Math.min(Number(args.limit || 20), 100));

  if (!organizationId || !storeId) {
    return {
      scanned: 0,
      sent: 0,
      failed: 0,
      uncertain: 0,
      skipped: 0,
    };
  }

  const activatedAt = activationTimestamp(args.activationAt);
  if (!activatedAt) {
    return {
      scanned: 0,
      sent: 0,
      failed: 0,
      uncertain: 0,
      skipped: 0,
    };
  }

  const supabase = args.supabase || getSupabaseAdmin();
  const pendingQuery = supabase
    .from("store_assistant_notification_queue")
    .select("id, organization_id, store_id, notification_type, status, context")
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .eq("notification_type", "assistant_panel_sync")
    .eq("status", "pending")
    .gte("created_at", activatedAt)
    .order("created_at", { ascending: true })
    .limit(limit);
  const { data, error } = await (pendingQuery as unknown as SupabaseAwaitable<{
    data: unknown;
    error: SupabaseError;
  }>);

  if (error) {
    throw new Error(`Falha ao carregar sincronizacoes pendentes do painel: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  let sent = 0;
  let failed = 0;
  let uncertain = 0;
  let skipped = 0;

  for (const rawRow of rows) {
    const row = rawRow as Record<string, unknown>;
    const parsed = parsePanelSyncEventKey(
      (row.context as Record<string, unknown> | null | undefined)?.event_key,
    );
    if (!parsed) {
      skipped += 1;
      continue;
    }

    try {
      const result = await syncAssistantPanelMessageToResponsibleWhatsapp(
        {
          organizationId,
          storeId,
          messageId: parsed.messageId,
          kind: parsed.kind,
          textPrefix:
            parsed.kind === "human"
              ? "VocÃª pelo painel: "
              : "Assistente pelo painel: ",
        },
        { supabase, send: args.send },
      );

      if (result.status === "sent" || result.status === "already_sent") {
        const now = new Date().toISOString();
        const { error: updateError } = await supabase
          .from("store_assistant_notification_queue")
          .update({
            status: "sent",
            processed_at: now,
            error_text: null,
            updated_at: now,
          })
          .eq("id", String(row.id || ""))
          .eq("organization_id", organizationId)
          .eq("store_id", storeId)
          .eq("notification_type", "assistant_panel_sync")
          .eq("status", "pending")
          .select("id")
          .maybeSingle();

        if (updateError) {
          throw new Error(`Falha ao marcar sincronizacao do painel como sent: ${updateError.message}`);
        }

        sent += 1;
      } else if (result.status === "uncertain") {
        uncertain += 1;
      } else if (result.status === "failed") {
        if (isPermanentPanelSyncFailure(result.reason)) {
          await markInternalNotificationFailed({
            supabase,
            notificationId: String(row.id || ""),
            organizationId,
            storeId,
            reason: cleanText(result.reason),
          });
        }
        failed += 1;
      } else {
        skipped += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return {
    scanned: rows.length,
    sent,
    failed,
    uncertain,
    skipped,
  };
}
