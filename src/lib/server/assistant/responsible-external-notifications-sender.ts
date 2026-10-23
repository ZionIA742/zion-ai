import { createClient } from "@supabase/supabase-js";
import { loadCanonicalActivePrimaryStoreResponsible } from "@/lib/server/store-responsibles";
import {
  resolveResponsibleWhatsappOutboundPolicy,
  type ResponsibleWhatsappTemplateContext,
} from "@/lib/server/assistant/responsible-whatsapp-outbound-policy";

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

type ResponsibleExternalNotificationRow = {
  id: string;
  organization_id: string;
  store_id: string;
  responsible_id: string;
  internal_notification_id: string;
  channel: string | null;
  destination: string | null;
  notification_type: string | null;
  priority: string | null;
  status: string | null;
  title: string | null;
  body: string | null;
  rendered_message: string | null;
  context: Record<string, unknown> | null;
  source_event_key: string | null;
  related_lead_id: string | null;
  related_conversation_id: string | null;
  related_appointment_id: string | null;
  related_document_type: string | null;
  related_document_id: string | null;
  related_document_number: string | null;
  related_document_status: string | null;
  external_message_id: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  error_text: string | null;
  attempts: number | null;
  locked_at: string | null;
  locked_by: string | null;
  processed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  send_status?: string | null;
  send_started_at?: string | null;
  send_finished_at?: string | null;
  policy_decision?: string | null;
  policy_last_inbound_message_id?: string | null;
  policy_template_name?: string | null;
  uncertainty_reason?: string | null;
};

type WhatsappIntegrationRow = {
  access_token?: string | null;
  phone_number_id?: string | null;
  metadata?: Json | null;
};

type WhatsappIntegration = {
  accessToken: string;
  phoneNumberId: string;
};

type WhatsAppSendResponse = {
  messages?: Array<{
    id?: string;
  }>;
  error?: {
    message?: string;
  };
};

export type SendResponsibleExternalNotificationInput = {
  organizationId: string;
  storeId: string;
  notificationId: string;
  uncertainOnTransportFailure?: boolean;
};

export type SendResponsibleExternalNotificationResult =
  | {
      ok: true;
      sent: true;
      notificationId: string;
      externalMessageId: string;
    }
  | {
      ok: false;
      sent: false;
      reason: string;
      notificationId?: string;
    };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const META_WHATSAPP_ACCESS_TOKEN = process.env.META_WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_GRAPH_API_VERSION =
  process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0";
const RESPONSIBLE_CHANNEL = "whatsapp_responsible";
const RESPONSIBLE_SEND_LOCKED_BY = "responsible_external_send_route";
const AUTOMATIC_REPORT_TYPES = ["morning_report", "evening_report"] as const;
const AUTOMATIC_REPORT_SOURCE = "assistant_automatic_reports";
const AUTOMATIC_REPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function getSupabaseAdmin() {
  if (!SUPABASE_URL) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL nao esta definido");
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY nao esta definido");
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
        }),
    },
  });
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeText(value: unknown) {
  return cleanText(value).toLowerCase();
}

function isAutomaticReportSource(context: Record<string, unknown>) {
  return [context.source, context.report_source].some(
    (value) => normalizeText(value) === AUTOMATIC_REPORT_SOURCE,
  );
}

function isAutomaticReportNotification(notification: ResponsibleExternalNotificationRow) {
  const context = notification.context || {};
  const notificationType = normalizeText(notification.notification_type);
  const localDate = cleanText(context.local_date);
  return Boolean(
    AUTOMATIC_REPORT_TYPES.includes(notificationType as (typeof AUTOMATIC_REPORT_TYPES)[number]) &&
      isAutomaticReportSource(context) &&
      normalizeText(context.report_type) === notificationType &&
      cleanText(context.event_key) === `assistant-automatic-report:${cleanText(notification.organization_id)}:${cleanText(notification.store_id)}:${localDate}:${notificationType}` &&
      localDate &&
      Number.isFinite(Date.parse(cleanText(context.target_iso))),
  );
}

function isAutomaticReportStale(notification: ResponsibleExternalNotificationRow) {
  const createdAt = Date.parse(cleanText(notification.created_at));
  const targetAt = Date.parse(cleanText(notification.context?.target_iso));
  const reference = Number.isFinite(createdAt) ? createdAt : targetAt;
  return Number.isFinite(reference) && Date.now() - reference > AUTOMATIC_REPORT_MAX_AGE_MS;
}

function safeErrorText(value: unknown) {
  const text = value instanceof Error ? value.message : String(value || "");
  return text.trim().slice(0, 1000) || "RESPONSIBLE_EXTERNAL_SEND_FAILED";
}

function resolveWhatsappAccessToken(
  integration?: WhatsappIntegrationRow | null,
): string {
  const integrationToken = cleanText(integration?.access_token);
  if (integrationToken) {
    return integrationToken;
  }

  const envToken = cleanText(META_WHATSAPP_ACCESS_TOKEN);
  if (envToken) {
    return envToken;
  }

  throw new Error(
    "Integracao WhatsApp sem token de acesso configurado no banco ou em META_WHATSAPP_ACCESS_TOKEN",
  );
}

async function getResponsibleSendWhatsappIntegration(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  organizationId: string;
  storeId: string;
}): Promise<WhatsappIntegration> {
  const { data, error } = await args.supabase.rpc("get_whatsapp_integration", {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
  });

  if (error) {
    throw new Error(`Erro ao buscar integracao WhatsApp: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const integration = row as WhatsappIntegrationRow | null | undefined;
  const accessToken = resolveWhatsappAccessToken(integration);
  const phoneNumberId = cleanText(integration?.phone_number_id);

  if (!phoneNumberId) {
    throw new Error("Integracao WhatsApp sem phone_number_id");
  }

  return {
    accessToken,
    phoneNumberId,
  };
}

async function sendWhatsappPayload(params: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  payload: Record<string, unknown>;
}) {
  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${params.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params.payload),
      },
    );
  } catch (error) {
    const uncertain = new Error(safeErrorText(error));
    uncertain.name = "WHATSAPP_TRANSPORT_UNCERTAIN";
    throw uncertain;
  }

  if (!response.ok) {
    let payload: WhatsAppSendResponse | null = null;
    try {
      payload = (await response.json()) as WhatsAppSendResponse;
    } catch {
      // The HTTP status is already a deterministic provider rejection. Do not
      // turn an unreadable error body into transport uncertainty.
    }
    const message =
      cleanText(payload?.error?.message) ||
      `Falha HTTP ${response.status} ao enviar mensagem para WhatsApp`;
    if (response.status >= 500) {
      const uncertain = new Error(message);
      uncertain.name = "WHATSAPP_TRANSPORT_UNCERTAIN";
      throw uncertain;
    }
    throw new Error(message);
  }

  let payload: WhatsAppSendResponse;
  try {
    payload = (await response.json()) as WhatsAppSendResponse;
  } catch (error) {
    const uncertain = new Error(safeErrorText(error));
    uncertain.name = "WHATSAPP_TRANSPORT_UNCERTAIN";
    throw uncertain;
  }

  const messageId = cleanText(payload?.messages?.[0]?.id);

  if (!messageId) {
    const uncertain = new Error("Resposta do WhatsApp sem messages[0].id no envio");
    uncertain.name = "WHATSAPP_TRANSPORT_UNCERTAIN";
    throw uncertain;
  }

  return messageId;
}

async function sendWhatsappTextMessage(params: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  body: string;
}) {
  return sendWhatsappPayload({
    ...params,
    payload: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: params.to,
      type: "text",
      text: {
        preview_url: false,
        body: params.body,
      },
    },
  });
}

async function sendWhatsappTemplateMessage(params: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  template: Record<string, unknown>;
}) {
  return sendWhatsappPayload({
    ...params,
    payload: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: params.to,
      type: "template",
      template: params.template,
    },
  });
}

export type ResponsibleWhatsappPayload =
  | { type: "text"; body: string }
  | { type: "template"; template: Record<string, unknown> }
  | { type: "document"; link: string; filename: string; caption?: string };

export async function sendResponsibleWhatsappPayload(args: {
  organizationId: string;
  storeId: string;
  responsibleId: string;
  destination: string;
  payload: ResponsibleWhatsappPayload;
}): Promise<
  | { ok: true; externalMessageId: string }
  | { ok: false; reason: string }
> {
  const organizationId = cleanText(args.organizationId);
  const storeId = cleanText(args.storeId);
  const responsibleId = cleanText(args.responsibleId);
  const destination = cleanText(args.destination);
  if (!organizationId || !storeId || !responsibleId || !destination) {
    return { ok: false, reason: "RESPONSIBLE_WHATSAPP_SEND_INVALID_INPUT" };
  }

  try {
    const supabase = getSupabaseAdmin();
    const responsible = await loadCanonicalActivePrimaryStoreResponsible({
      supabase,
      organizationId,
      storeId,
    });
    if (!responsible.ok || responsible.responsible.id !== responsibleId) {
      return { ok: false, reason: "RESPONSIBLE_WHATSAPP_DESTINATION_SCOPE_MISMATCH" };
    }
    if (responsible.responsible.whatsappNumber !== destination) {
      return { ok: false, reason: "RESPONSIBLE_WHATSAPP_DESTINATION_CHANGED" };
    }

    const integration = await getResponsibleSendWhatsappIntegration({
      supabase,
      organizationId,
      storeId,
    });
    const externalMessageId = args.payload.type === "text"
      ? await sendWhatsappTextMessage({ ...integration, to: destination, body: args.payload.body })
      : args.payload.type === "template"
        ? await sendWhatsappTemplateMessage({ ...integration, to: destination, template: args.payload.template })
        : await sendWhatsappPayload({
            ...integration,
            to: destination,
            payload: {
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: destination,
              type: "document",
              document: {
                link: args.payload.link,
                filename: args.payload.filename,
                ...(args.payload.caption ? { caption: args.payload.caption } : {}),
              },
            },
          });
    return { ok: true, externalMessageId };
  } catch (error) {
    if (error instanceof Error && error.name === "WHATSAPP_TRANSPORT_UNCERTAIN") {
      return { ok: false, reason: "send_uncertain" };
    }
    return {
      ok: false,
      reason: "RESPONSIBLE_WHATSAPP_SEND_FAILED",
    };
  }
}

export async function sendResponsibleAssistantText(args: {
  organizationId: string;
  storeId: string;
  responsibleId: string;
  destination: string;
  text: string;
}): Promise<
  | { ok: true; externalMessageId: string }
  | { ok: false; reason: string }
> {
  const organizationId = cleanText(args.organizationId);
  const storeId = cleanText(args.storeId);
  const destination = cleanText(args.destination);
  const text = cleanText(args.text);
  if (!organizationId || !storeId || !cleanText(args.responsibleId) || !destination || !text) {
    return { ok: false, reason: "RESPONSIBLE_ASSISTANT_SEND_INVALID_INPUT" };
  }

  const supabase = getSupabaseAdmin();
  const responsible = await loadCanonicalActivePrimaryStoreResponsible({
    supabase,
    organizationId,
    storeId,
  });
  if (!responsible.ok || responsible.responsible.id !== args.responsibleId) {
    return { ok: false, reason: "RESPONSIBLE_ASSISTANT_DESTINATION_SCOPE_MISMATCH" };
  }
  if (responsible.responsible.whatsappNumber !== destination) {
    return { ok: false, reason: "RESPONSIBLE_ASSISTANT_DESTINATION_CHANGED" };
  }

  try {
    const policy = await resolveResponsibleWhatsappOutboundPolicy({
      supabase,
      organizationId,
      storeId,
      responsibleId: args.responsibleId,
      destination,
    });
    if (!policy.ok) return { ok: false, reason: policy.reason };
    if (policy.mode !== "free_form") {
      return { ok: false, reason: "RESPONSIBLE_WHATSAPP_TEMPLATE_CONTEXT_REQUIRED" };
    }

    const integration = await getResponsibleSendWhatsappIntegration({
      supabase,
      organizationId,
      storeId,
    });
    const externalMessageId = await sendWhatsappTextMessage({
      accessToken: integration.accessToken,
      phoneNumberId: integration.phoneNumberId,
      to: destination,
      body: text,
    });
    return { ok: true, externalMessageId };
  } catch (error) {
    if (error instanceof Error && error.name === "WHATSAPP_TRANSPORT_UNCERTAIN") {
      return { ok: false, reason: "send_uncertain" };
    }
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "RESPONSIBLE_ASSISTANT_SEND_FAILED",
    };
  }
}

async function loadResponsibleExternalNotification(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  organizationId: string;
  storeId: string;
  notificationId: string;
}) {
  const { data, error } = await args.supabase
    .from("store_responsible_external_notifications")
    .select("*")
    .eq("id", args.notificationId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Falha ao carregar notificacao externa do responsavel: ${error.message}`,
    );
  }

  return (data as ResponsibleExternalNotificationRow | null) ?? null;
}

function validateNotificationBeforeSend(
  notification: ResponsibleExternalNotificationRow | null,
): SendResponsibleExternalNotificationResult | null {
  if (!notification?.id) {
    return {
      ok: false,
      sent: false,
      reason: "notification_not_found",
    };
  }

  if (cleanText(notification.channel) !== RESPONSIBLE_CHANNEL) {
    return {
      ok: false,
      sent: false,
      reason: "invalid_channel",
      notificationId: notification.id,
    };
  }

  if (!cleanText(notification.destination)) {
    return {
      ok: false,
      sent: false,
      reason: "missing_destination",
      notificationId: notification.id,
    };
  }

  if (!cleanText(notification.rendered_message)) {
    return {
      ok: false,
      sent: false,
      reason: "missing_rendered_message",
      notificationId: notification.id,
    };
  }

  if (cleanText(notification.external_message_id) || cleanText(notification.sent_at)) {
    return {
      ok: false,
      sent: false,
      reason: "already_sent",
      notificationId: notification.id,
    };
  }

  if (isAutomaticReportNotification(notification) && isAutomaticReportStale(notification)) {
    return {
      ok: false,
      sent: false,
      reason: "automatic_report_expired",
      notificationId: notification.id,
    };
  }

  const status = normalizeText(notification.status);
  if (status === "materialized") {
    return {
      ok: false,
      sent: false,
      reason: "not_ready_to_send",
      notificationId: notification.id,
    };
  }

  if (status !== "ready_to_send") {
    return {
      ok: false,
      sent: false,
      reason: "already_processing_or_not_ready",
      notificationId: notification.id,
    };
  }

  return null;
}

async function claimResponsibleExternalNotification(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  organizationId: string;
  storeId: string;
  notificationId: string;
  currentAttempts: number | null;
}) {
  const now = new Date().toISOString();
  const nextAttempts = Math.max(0, Number(args.currentAttempts || 0)) + 1;

  const { data, error } = await args.supabase
    .from("store_responsible_external_notifications")
    .update({
      status: "processing",
      attempts: nextAttempts,
      locked_at: now,
      locked_by: RESPONSIBLE_SEND_LOCKED_BY,
      updated_at: now,
    })
    .eq("id", args.notificationId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("status", "ready_to_send")
    .is("external_message_id", null)
    .is("sent_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao bloquear notificacao para envio: ${error.message}`);
  }

  return (data as ResponsibleExternalNotificationRow | null) ?? null;
}

async function markResponsibleExternalNotificationSent(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  notificationId: string;
  organizationId: string;
  storeId: string;
  externalMessageId: string;
}) {
  const now = new Date().toISOString();

  const { error } = await args.supabase
    .from("store_responsible_external_notifications")
    .update({
      status: "sent",
      send_status: "sent",
      send_finished_at: now,
      external_message_id: args.externalMessageId,
      sent_at: now,
      processed_at: now,
      error_text: null,
      failed_at: null,
      locked_at: null,
      locked_by: null,
      updated_at: now,
    })
    .eq("id", args.notificationId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId);

  if (error) {
    throw new Error(`Falha ao marcar notificacao como enviada: ${error.message}`);
  }
}

async function markResponsibleExternalNotificationFailed(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  notificationId: string;
  organizationId: string;
  storeId: string;
  errorText: string;
}) {
  const now = new Date().toISOString();

  const { error } = await args.supabase
    .from("store_responsible_external_notifications")
    .update({
      status: "failed",
      send_status: "failed",
      send_finished_at: now,
      failed_at: now,
      processed_at: now,
      error_text: args.errorText,
      locked_at: null,
      locked_by: null,
      updated_at: now,
    })
    .eq("id", args.notificationId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId);

  if (error) {
    throw new Error(`Falha ao marcar notificacao como failed: ${error.message}`);
  }
}

async function markResponsibleExternalNotificationUncertain(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  notificationId: string;
  organizationId: string;
  storeId: string;
  errorText: string;
}) {
  const now = new Date().toISOString();
  const { error } = await args.supabase
    .from("store_responsible_external_notifications")
    .update({
      status: "uncertain",
      send_status: "uncertain",
      send_finished_at: now,
      uncertainty_reason: args.errorText,
      processed_at: now,
      error_text: args.errorText,
      locked_at: null,
      locked_by: null,
      updated_at: now,
    })
    .eq("id", args.notificationId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId);
  if (error) throw new Error(`Falha ao marcar notificacao como uncertain: ${error.message}`);
}

export async function sendResponsibleExternalNotification(
  input: SendResponsibleExternalNotificationInput,
): Promise<SendResponsibleExternalNotificationResult> {
  const organizationId = cleanText(input.organizationId);
  const storeId = cleanText(input.storeId);
  const notificationId = cleanText(input.notificationId);

  if (!organizationId || !storeId || !notificationId) {
    return {
      ok: false,
      sent: false,
      reason: "missing_required_fields",
    };
  }

  const supabase = getSupabaseAdmin();
  const notification = await loadResponsibleExternalNotification({
    supabase,
    organizationId,
    storeId,
    notificationId,
  });

  const preValidation = validateNotificationBeforeSend(notification);
  if (preValidation) {
    return preValidation;
  }

  const claimedNotification = await claimResponsibleExternalNotification({
    supabase,
    organizationId,
    storeId,
    notificationId,
    currentAttempts: notification?.attempts ?? 0,
  });

  if (!claimedNotification?.id) {
    return {
      ok: false,
      sent: false,
      reason: "already_processing_or_not_ready",
      notificationId,
    };
  }

  let acceptedExternalMessageId: string | null = null;
  try {
    const policy = await resolveResponsibleWhatsappOutboundPolicy({
      supabase,
      organizationId,
      storeId,
      responsibleId: cleanText(claimedNotification.responsible_id),
      destination: cleanText(claimedNotification.destination),
      templateContext: {
        notificationType: claimedNotification.notification_type,
        title: claimedNotification.title,
        body: claimedNotification.body,
        context: claimedNotification.context,
        relatedLeadId: claimedNotification.related_lead_id,
        relatedConversationId: claimedNotification.related_conversation_id,
        relatedAppointmentId: claimedNotification.related_appointment_id,
      } satisfies ResponsibleWhatsappTemplateContext,
    });
    if (!policy.ok) throw new Error(policy.reason);
    if (isAutomaticReportNotification(claimedNotification) && policy.mode !== "free_form") {
      throw new Error("AUTOMATIC_REPORT_WHATSAPP_WINDOW_CLOSED");
    }

    const integration = await getResponsibleSendWhatsappIntegration({
      supabase,
      organizationId,
      storeId,
    });
    const sendStartedAt = new Date().toISOString();
    await supabase
      .from("store_responsible_external_notifications")
      .update({
        send_status: "sending",
        send_started_at: sendStartedAt,
        policy_decision: policy.mode,
        policy_template_name: policy.mode === "template_required" ? policy.template.name : null,
        policy_last_inbound_message_id: policy.lastInboundMessageId,
        updated_at: sendStartedAt,
      })
      .eq("id", notificationId)
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .eq("status", "processing");

    const externalMessageId = policy.mode === "free_form"
      ? await sendWhatsappTextMessage({
          accessToken: integration.accessToken,
          phoneNumberId: integration.phoneNumberId,
          to: policy.responsible.whatsappNumber,
          body: cleanText(claimedNotification.rendered_message),
        })
      : await sendWhatsappTemplateMessage({
          accessToken: integration.accessToken,
          phoneNumberId: integration.phoneNumberId,
          to: policy.responsible.whatsappNumber,
          template: policy.template,
        });
    acceptedExternalMessageId = externalMessageId;

    await markResponsibleExternalNotificationSent({
      supabase,
      notificationId,
      organizationId,
      storeId,
      externalMessageId,
    });

    return {
      ok: true,
      sent: true,
      notificationId,
      externalMessageId,
    };
  } catch (error) {
    const errorText = safeErrorText(error);

    const isTransportUncertain = error instanceof Error && error.name === "WHATSAPP_TRANSPORT_UNCERTAIN";
    const isAcceptanceUncertain = Boolean(acceptedExternalMessageId);
    if (isAcceptanceUncertain || (input.uncertainOnTransportFailure && isTransportUncertain)) {
      await markResponsibleExternalNotificationUncertain({
        supabase,
        notificationId,
        organizationId,
        storeId,
        errorText,
      });
    } else {
      await markResponsibleExternalNotificationFailed({
        supabase,
        notificationId,
        organizationId,
        storeId,
        errorText,
      });
    }

    return {
      ok: false,
      sent: false,
      reason: isAcceptanceUncertain || (input.uncertainOnTransportFailure && isTransportUncertain) ? "send_uncertain" : "send_failed",
      notificationId,
    };
  }
}
