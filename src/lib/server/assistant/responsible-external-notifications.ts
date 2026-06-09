import { createClient } from "@supabase/supabase-js";

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

type ResponsibleRow = {
  id: string;
  name: string | null;
  whatsapp_number: string | null;
  role: string | null;
  created_at: string | null;
};

type InternalAssistantNotificationRow = {
  id: string;
  organization_id: string;
  store_id: string;
  notification_type: string | null;
  priority: string | null;
  status: string | null;
  title: string | null;
  body: string | null;
  context: Record<string, unknown> | null;
  related_lead_id: string | null;
  related_conversation_id: string | null;
  related_appointment_id: string | null;
  created_at: string | null;
};

type ExternalNotificationInsertRow = {
  organization_id: string;
  store_id: string;
  responsible_id: string;
  internal_notification_id: string;
  channel: string;
  destination: string;
  notification_type: string;
  priority: string;
  status: string;
  title: string | null;
  body: string | null;
  rendered_message: string;
  context: Record<string, unknown>;
  source_event_key: string | null;
  related_lead_id: string | null;
  related_conversation_id: string | null;
  related_appointment_id: string | null;
  related_document_type: string | null;
  related_document_id: string | null;
  related_document_number: string | null;
  related_document_status: string | null;
};

type MaterializeSummary = {
  ok: true;
  scanned: number;
  created: number;
  skipped: number;
  skippedReasons: Record<string, number>;
};

type ResponsibleExternalNotificationRow = {
  id: string;
  organization_id: string;
  store_id: string;
  channel: string | null;
  destination: string | null;
  status: string | null;
  title: string | null;
  rendered_message: string | null;
  related_document_type: string | null;
  related_document_number: string | null;
  related_document_status: string | null;
  external_message_id: string | null;
  sent_at: string | null;
  failed_at: string | null;
  error_text: string | null;
  attempts: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ResponsibleExternalNotificationListItem = {
  id: string;
  status: string | null;
  channel: string | null;
  destinationMasked: string;
  title: string | null;
  rendered_message: string | null;
  related_document_type: string | null;
  related_document_number: string | null;
  related_document_status: string | null;
  external_message_id: string | null;
  sent_at: string | null;
  failed_at: string | null;
  error_text: string | null;
  attempts: number;
  created_at: string | null;
  updated_at: string | null;
};

const RESPONSIBLE_CHANNEL = "whatsapp_responsible";
const DEFAULT_LIMIT = 50;

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

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeText(value: unknown) {
  return cleanText(value).toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTruthyAnswer(value: unknown) {
  if (value === true) return true;
  return normalizeText(value) === "true";
}

function isUuidLike(value: string | null | undefined) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    cleanText(value)
  );
}

function safeUuidOrNull(value: unknown) {
  const text = cleanText(value);
  return isUuidLike(text) ? text : null;
}

export function normalizeResponsibleWhatsappDestination(value: string): string | null {
  const digits = String(value || "").replace(/\D/g, "");

  if (!digits) return null;
  if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 13) {
    return digits;
  }

  if (digits.length === 11) {
    return `55${digits}`;
  }

  if (digits.length >= 12 && digits.length <= 15) {
    return digits;
  }

  return null;
}

export function maskResponsibleDestination(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D/g, "");

  if (!digits) {
    return "destino-mascarado";
  }

  if (digits.length <= 5) {
    return `${digits.slice(0, 1)}***${digits.slice(-1)}`;
  }

  if (digits.length <= 8) {
    return `${digits.slice(0, 2)}***${digits.slice(-2)}`;
  }

  return `${digits.slice(0, 5)}*****${digits.slice(-3)}`;
}

export async function loadAssistantNotifyResponsibleSetting(args: {
  supabase?: ReturnType<typeof getSupabaseAdmin>;
  organizationId: string;
  storeId: string;
}) {
  const supabase = args.supabase || getSupabaseAdmin();

  const { data, error } = await supabase
    .from("store_onboarding_answers")
    .select("answer")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("question_key", "ai_should_notify_responsible")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar ai_should_notify_responsible: ${error.message}`);
  }

  return isTruthyAnswer(data?.answer);
}

export async function loadPrimaryResponsibleForExternalNotifications(args: {
  supabase?: ReturnType<typeof getSupabaseAdmin>;
  organizationId: string;
  storeId: string;
}) {
  const supabase = args.supabase || getSupabaseAdmin();

  const { data, error } = await supabase
    .from("store_responsibles")
    .select("id, name, whatsapp_number, role, created_at")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .not("whatsapp_number", "is", null)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Falha ao carregar store_responsibles: ${error.message}`);
  }

  const candidates = ((data || []) as ResponsibleRow[])
    .map((row) => ({
      id: row.id,
      name: cleanText(row.name) || null,
      role: cleanText(row.role) || null,
      whatsappNumber: normalizeResponsibleWhatsappDestination(
        cleanText(row.whatsapp_number)
      ),
      createdAt: row.created_at,
    }))
    .filter((row) => row.whatsappNumber);

  if (candidates.length === 0) {
    return null;
  }

  const owner = candidates.find((row) => normalizeText(row.role) === "owner");
  const selected = owner || candidates[0];

  return {
    id: selected.id,
    name: selected.name,
    whatsappNumber: selected.whatsappNumber as string,
  };
}

export function shouldEnqueueResponsibleExternalNotification(
  internalNotification: InternalAssistantNotificationRow
) {
  const notificationType = normalizeText(internalNotification.notification_type);
  const priority = normalizeText(internalNotification.priority);
  const status = normalizeText(internalNotification.status);
  const context = isRecord(internalNotification.context)
    ? internalNotification.context
    : null;

  if (notificationType !== "important_alert") {
    return { eligible: false as const, reason: "notification_type_not_supported" };
  }

  if (priority !== "high" && priority !== "urgent") {
    return { eligible: false as const, reason: "priority_not_supported" };
  }

  if (status === "cancelled") {
    return { eligible: false as const, reason: "notification_cancelled" };
  }

  if (!context) {
    return { eligible: false as const, reason: "missing_context" };
  }

  if (context.needs_human_action !== true) {
    return { eligible: false as const, reason: "needs_human_action_false" };
  }

  const documentType = normalizeText(context.document_type);
  if (documentType !== "quote" && documentType !== "contract") {
    return { eligible: false as const, reason: "document_type_not_supported" };
  }

  const reason = normalizeText(context.reason);
  if (reason !== "pending_review" && reason !== "customer_signed") {
    return { eligible: false as const, reason: "reason_not_supported" };
  }

  return { eligible: true as const };
}

export function renderResponsibleExternalNotificationMessage(args: {
  title: string | null;
  body: string | null;
  context: Record<string, unknown>;
}) {
  const documentType = normalizeText(args.context.document_type);
  const reason = normalizeText(args.context.reason);
  const documentNumber =
    cleanText(args.context.document_number) ||
    (documentType === "quote" ? "ORC-000000" : "CTR-000000");

  if (documentType === "quote" && reason === "pending_review") {
    return [
      "Orcamento aguardando revisao.",
      `Orcamento: ${documentNumber}`,
      "Status: pronto para revisar.",
      "",
      "Revise no painel da Assistente antes de enviar ao cliente.",
    ].join("\n");
  }

  if (documentType === "contract" && reason === "pending_review") {
    return [
      "Contrato aguardando revisao.",
      `Contrato: ${documentNumber}`,
      "Status: pronto para revisar.",
      "",
      "Revise no painel da Assistente antes de enviar ao cliente.",
    ].join("\n");
  }

  if (documentType === "contract" && reason === "customer_signed") {
    return [
      "Cliente aceitou o contrato.",
      `Contrato: ${documentNumber}`,
      "Status: falta confirmacao da loja.",
      "",
      "Neste primeiro bloco, revise e confirme pelo painel.",
    ].join("\n");
  }

  return [cleanText(args.title), cleanText(args.body)]
    .filter(Boolean)
    .join("\n\n") || "Aviso importante da Assistente aguardando acao humana.";
}

async function findExistingResponsibleExternalNotification(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  organizationId: string;
  storeId: string;
  responsibleId: string;
  internalNotificationId: string;
  channel: string;
  sourceEventKey: string | null;
}) {
  const { data: byInternalData, error: byInternalError } = await args.supabase
    .from("store_responsible_external_notifications")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("responsible_id", args.responsibleId)
    .eq("internal_notification_id", args.internalNotificationId)
    .eq("channel", args.channel)
    .limit(1)
    .maybeSingle();

  if (byInternalError) {
    throw new Error(
      `Falha ao verificar duplicidade por internal_notification_id: ${byInternalError.message}`
    );
  }

  if (byInternalData?.id) {
    return { exists: true, reason: "already_materialized_by_internal_notification" };
  }

  if (!args.sourceEventKey) {
    return { exists: false, reason: null };
  }

  const { data: byEventKeyData, error: byEventKeyError } = await args.supabase
    .from("store_responsible_external_notifications")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("responsible_id", args.responsibleId)
    .eq("channel", args.channel)
    .eq("source_event_key", args.sourceEventKey)
    .limit(1)
    .maybeSingle();

  if (byEventKeyError) {
    throw new Error(
      `Falha ao verificar duplicidade por source_event_key: ${byEventKeyError.message}`
    );
  }

  if (byEventKeyData?.id) {
    return { exists: true, reason: "already_materialized_by_source_event_key" };
  }

  return { exists: false, reason: null };
}

function isDuplicateInsertError(error: { code?: string | null; message?: string | null }) {
  const code = cleanText(error.code);
  const message = normalizeText(error.message);
  return code === "23505" || message.includes("duplicate key");
}

export async function enqueueResponsibleExternalNotificationFromAssistantNotification(args: {
  supabase?: ReturnType<typeof getSupabaseAdmin>;
  internalNotification: InternalAssistantNotificationRow;
}) {
  const supabase = args.supabase || getSupabaseAdmin();
  const internalNotification = args.internalNotification;
  const organizationId = cleanText(internalNotification.organization_id);
  const storeId = cleanText(internalNotification.store_id);
  const eligibility = shouldEnqueueResponsibleExternalNotification(internalNotification);

  if (!eligibility.eligible) {
    return { created: false as const, skippedReason: eligibility.reason };
  }

  const notifyResponsible = await loadAssistantNotifyResponsibleSetting({
    supabase,
    organizationId,
    storeId,
  });

  if (!notifyResponsible) {
    return { created: false as const, skippedReason: "assistant_notify_responsible_disabled" };
  }

  const responsible = await loadPrimaryResponsibleForExternalNotifications({
    supabase,
    organizationId,
    storeId,
  });

  if (!responsible) {
    return { created: false as const, skippedReason: "responsible_not_found_or_invalid_destination" };
  }

  const context = isRecord(internalNotification.context)
    ? internalNotification.context
    : {};
  const sourceEventKey = cleanText(context.event_key) || null;

  const existing = await findExistingResponsibleExternalNotification({
    supabase,
    organizationId,
    storeId,
    responsibleId: responsible.id,
    internalNotificationId: internalNotification.id,
    channel: RESPONSIBLE_CHANNEL,
    sourceEventKey,
  });

  if (existing.exists) {
    return { created: false as const, skippedReason: existing.reason || "already_materialized" };
  }

  const renderedMessage = renderResponsibleExternalNotificationMessage({
    title: internalNotification.title,
    body: internalNotification.body,
    context,
  });

  const insertPayload: ExternalNotificationInsertRow = {
    organization_id: organizationId,
    store_id: storeId,
    responsible_id: responsible.id,
    internal_notification_id: internalNotification.id,
    channel: RESPONSIBLE_CHANNEL,
    destination: responsible.whatsappNumber,
    notification_type: cleanText(internalNotification.notification_type),
    priority: cleanText(internalNotification.priority),
    status: "materialized",
    title: cleanText(internalNotification.title) || null,
    body: cleanText(internalNotification.body) || null,
    rendered_message: renderedMessage,
    context,
    source_event_key: sourceEventKey,
    related_lead_id: safeUuidOrNull(internalNotification.related_lead_id),
    related_conversation_id: safeUuidOrNull(internalNotification.related_conversation_id),
    related_appointment_id: safeUuidOrNull(internalNotification.related_appointment_id),
    related_document_type: cleanText(context.document_type) || null,
    related_document_id: safeUuidOrNull(context.document_id),
    related_document_number: cleanText(context.document_number) || null,
    related_document_status: cleanText(context.document_status) || null,
  };

  const { data, error } = await supabase
    .from("store_responsible_external_notifications")
    .insert(insertPayload)
    .select("id")
    .maybeSingle();

  if (error) {
    if (isDuplicateInsertError(error)) {
      return { created: false as const, skippedReason: "duplicate_insert_blocked" };
    }

    throw new Error(
      `Falha ao inserir store_responsible_external_notifications: ${error.message}`
    );
  }

  return {
    created: true as const,
    rowId: cleanText(data?.id) || null,
  };
}

export async function materializeResponsibleExternalNotifications(args: {
  supabase?: ReturnType<typeof getSupabaseAdmin>;
  organizationId: string;
  storeId: string;
  limit?: number;
}): Promise<MaterializeSummary> {
  const supabase = args.supabase || getSupabaseAdmin();
  const limit = Math.max(1, Math.min(Number(args.limit || DEFAULT_LIMIT), 200));

  const { data, error } = await supabase
    .from("store_assistant_notification_queue")
    .select(
      "id, organization_id, store_id, notification_type, priority, status, title, body, context, related_lead_id, related_conversation_id, related_appointment_id, created_at"
    )
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("notification_type", "important_alert")
    .in("priority", ["high", "urgent"])
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(
      `Falha ao carregar notificacoes internas para materializacao: ${error.message}`
    );
  }

  const notifications = ((data || []) as InternalAssistantNotificationRow[]).filter(
    (row) => cleanText(row.id)
  );

  const skippedReasons: Record<string, number> = {};
  let created = 0;
  let skipped = 0;

  for (const notification of notifications) {
    const result = await enqueueResponsibleExternalNotificationFromAssistantNotification({
      supabase,
      internalNotification: notification,
    });

    if (result.created) {
      created += 1;
      continue;
    }

    skipped += 1;
    const reason = cleanText(result.skippedReason) || "unknown";
    skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
  }

  return {
    ok: true,
    scanned: notifications.length,
    created,
    skipped,
    skippedReasons,
  };
}

export async function listResponsibleExternalNotifications(args: {
  supabase?: ReturnType<typeof getSupabaseAdmin>;
  organizationId: string;
  storeId: string;
  status?: string;
  limit?: number;
}) {
  const supabase = args.supabase || getSupabaseAdmin();
  const organizationId = cleanText(args.organizationId);
  const storeId = cleanText(args.storeId);
  const normalizedStatus = cleanText(args.status);
  const limit = Math.max(1, Math.min(Number(args.limit || 20), 100));

  let query = supabase
    .from("store_responsible_external_notifications")
    .select(
      "id, organization_id, store_id, channel, destination, status, title, rendered_message, related_document_type, related_document_number, related_document_status, external_message_id, sent_at, failed_at, error_text, attempts, created_at, updated_at"
    )
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (normalizedStatus) {
    query = query.eq("status", normalizedStatus);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(
      `Falha ao listar store_responsible_external_notifications: ${error.message}`
    );
  }

  const items = ((data || []) as ResponsibleExternalNotificationRow[]).map(
    (row): ResponsibleExternalNotificationListItem => ({
      id: cleanText(row.id),
      status: cleanText(row.status) || null,
      channel: cleanText(row.channel) || null,
      destinationMasked: maskResponsibleDestination(row.destination),
      title: cleanText(row.title) || null,
      rendered_message: cleanText(row.rendered_message) || null,
      related_document_type: cleanText(row.related_document_type) || null,
      related_document_number: cleanText(row.related_document_number) || null,
      related_document_status: cleanText(row.related_document_status) || null,
      external_message_id: cleanText(row.external_message_id) || null,
      sent_at: row.sent_at || null,
      failed_at: row.failed_at || null,
      error_text: cleanText(row.error_text) || null,
      attempts: Math.max(0, Number(row.attempts || 0)),
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
    })
  );

  return {
    ok: true as const,
    items,
    total: items.length,
  };
}

export async function prepareResponsibleExternalNotification(args: {
  supabase?: ReturnType<typeof getSupabaseAdmin>;
  organizationId: string;
  storeId: string;
  notificationId: string;
}) {
  const supabase = args.supabase || getSupabaseAdmin();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("store_responsible_external_notifications")
    .update({
      status: "ready_to_send",
      failed_at: null,
      error_text: null,
      locked_at: null,
      locked_by: null,
      processed_at: null,
      updated_at: now,
    })
    .eq("id", cleanText(args.notificationId))
    .eq("organization_id", cleanText(args.organizationId))
    .eq("store_id", cleanText(args.storeId))
    .in("status", ["materialized", "failed"])
    .select("id, status")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Falha ao preparar notificacao externa do responsavel: ${error.message}`
    );
  }

  if (!data?.id) {
    return {
      ok: false as const,
      updated: false as const,
      reason: "invalid_status_for_prepare",
    };
  }

  return {
    ok: true as const,
    updated: true as const,
    notificationId: cleanText(data.id),
    status: cleanText(data.status) || "ready_to_send",
  };
}

export async function cancelResponsibleExternalNotification(args: {
  supabase?: ReturnType<typeof getSupabaseAdmin>;
  organizationId: string;
  storeId: string;
  notificationId: string;
}) {
  const supabase = args.supabase || getSupabaseAdmin();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("store_responsible_external_notifications")
    .update({
      status: "cancelled",
      locked_at: null,
      locked_by: null,
      processed_at: now,
      updated_at: now,
    })
    .eq("id", cleanText(args.notificationId))
    .eq("organization_id", cleanText(args.organizationId))
    .eq("store_id", cleanText(args.storeId))
    .in("status", ["materialized", "ready_to_send", "failed"])
    .select("id, status")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Falha ao cancelar notificacao externa do responsavel: ${error.message}`
    );
  }

  if (!data?.id) {
    return {
      ok: false as const,
      updated: false as const,
      reason: "invalid_status_for_cancel",
    };
  }

  return {
    ok: true as const,
    updated: true as const,
    notificationId: cleanText(data.id),
    status: cleanText(data.status) || "cancelled",
  };
}
