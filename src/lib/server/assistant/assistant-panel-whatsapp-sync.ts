import { createClient } from "@supabase/supabase-js";
import { loadCanonicalActivePrimaryStoreResponsible } from "@/lib/server/store-responsibles";
import {
  sendResponsibleExternalNotification,
  type SendResponsibleExternalNotificationResult,
} from "@/lib/server/assistant/responsible-external-notifications-sender";

type SupabaseError = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
} | null;
type SupabaseAwaitable<T> = PromiseLike<T>;
type SupabaseQueryLike = {
  eq(column: string, value: unknown): SupabaseQueryLike;
  in(column: string, value: unknown): SupabaseQueryLike;
  contains(column: string, value: unknown): SupabaseQueryLike;
  order(column: string, options: { ascending: boolean }): SupabaseQueryLike;
  limit(value: number): SupabaseQueryLike;
  maybeSingle(): SupabaseAwaitable<{ data: unknown; error: SupabaseError }>;
};
type SupabaseInsertLike = {
  select(columns: string): SupabaseQueryLike;
  maybeSingle(): SupabaseAwaitable<{ data: unknown; error: SupabaseError }>;
};
type SupabaseTableLike = {
  select(columns: string): SupabaseQueryLike;
  insert(payload: Record<string, unknown>): SupabaseInsertLike;
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
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

function eventKey(messageId: string, kind: "human" | "assistant") {
  return `assistant-panel-whatsapp:${kind}:${messageId}`;
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
    .select("id, status, external_message_id, error_text")
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
  } | null;
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
    const status = cleanText(existing.status);
    if (status === "sent" && existing.external_message_id) {
      return { ok: true, status: "already_sent", notificationId: existing.id, externalMessageId: existing.external_message_id };
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
      return { ok: true, status: "sent", notificationId: existing.id, externalMessageId: result.externalMessageId };
    }
    return {
      ok: false,
      status: result.reason === "send_uncertain" ? "uncertain" : "failed",
      notificationId: existing.id,
      reason: result.reason,
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
    return { ok: true, status: "sent", notificationId: notification.id, externalMessageId: result.externalMessageId };
  }
  return {
    ok: false,
    status: result.reason === "send_uncertain" ? "uncertain" : "failed",
    notificationId: notification.id,
    reason: result.reason,
  };
}
