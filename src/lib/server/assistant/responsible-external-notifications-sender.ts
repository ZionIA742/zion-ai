import { createClient } from "@supabase/supabase-js";

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
  });
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeText(value: unknown) {
  return cleanText(value).toLowerCase();
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

async function sendWhatsappTextMessage(params: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  body: string;
}) {
  const response = await fetch(
    `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${params.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: params.to,
        type: "text",
        text: {
          preview_url: false,
          body: params.body,
        },
      }),
    },
  );

  const payload = (await response.json()) as WhatsAppSendResponse;

  if (!response.ok) {
    throw new Error(
      cleanText(payload?.error?.message) ||
        `Falha HTTP ${response.status} ao enviar texto para WhatsApp`,
    );
  }

  const messageId = cleanText(payload?.messages?.[0]?.id);

  if (!messageId) {
    throw new Error("Resposta do WhatsApp sem messages[0].id no envio de texto");
  }

  return messageId;
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

  try {
    const integration = await getResponsibleSendWhatsappIntegration({
      supabase,
      organizationId,
      storeId,
    });

    const externalMessageId = await sendWhatsappTextMessage({
      accessToken: integration.accessToken,
      phoneNumberId: integration.phoneNumberId,
      to: cleanText(claimedNotification.destination),
      body: cleanText(claimedNotification.rendered_message),
    });

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

    await markResponsibleExternalNotificationFailed({
      supabase,
      notificationId,
      organizationId,
      storeId,
      errorText,
    });

    return {
      ok: false,
      sent: false,
      reason: "send_failed",
      notificationId,
    };
  }
}
