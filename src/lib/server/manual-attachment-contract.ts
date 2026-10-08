import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const MANUAL_ATTACHMENT_STORAGE_BUCKET = "zion-store-files";
export const MANUAL_ATTACHMENT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MANUAL_ATTACHMENT_PATH_PREFIX = "manual-attachments";

export function createManualAttachmentUploadId() {
  return randomUUID();
}

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
]);
const ALLOWED_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);
const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/webm",
  "audio/wav",
  "audio/x-wav",
]);
const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export type ManualAttachmentMessageType = "image" | "video" | "audio" | "document";

export type ManualAttachmentAuthorization = {
  version: 1;
  uploadId: string;
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string;
  path: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  messageType: ManualAttachmentMessageType;
  content: string;
  idempotencyKey: string;
  payloadFingerprint: string;
  expiresAt: number;
};

export type ManualAttachmentScope = {
  conversationId: string;
  leadId: string;
  organizationId: string;
  storeId: string;
};

export type ServiceSupabaseClient = ReturnType<typeof createServiceSupabaseClient>;

type ConversationRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
};

type LeadRow = {
  id: string;
  organization_id: string;
  store_id: string | null;
};

export function createServiceSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("service_role_unavailable");
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function normalizeManualAttachmentMimeType(value: unknown) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

export function classifyManualAttachmentMimeType(
  value: unknown,
): ManualAttachmentMessageType | null {
  const mimeType = normalizeManualAttachmentMimeType(value);
  if (ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) return "image";
  if (ALLOWED_VIDEO_MIME_TYPES.has(mimeType)) return "video";
  if (ALLOWED_AUDIO_MIME_TYPES.has(mimeType)) return "audio";
  if (ALLOWED_DOCUMENT_MIME_TYPES.has(mimeType)) return "document";
  return null;
}

export function defaultManualAttachmentContent(messageType: ManualAttachmentMessageType) {
  if (messageType === "image") return "A loja enviou uma imagem.";
  if (messageType === "video") return "A loja enviou um video.";
  if (messageType === "audio") return "A loja enviou um audio.";
  return "A loja enviou um arquivo.";
}

export function extractManualAttachmentExtension(fileName: string) {
  const normalized = String(fileName || "").trim();
  if (!normalized.includes(".")) return null;
  const extension = normalized.split(".").pop() || "";
  const safeExtension = extension.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 10);
  return safeExtension || null;
}

function sanitizeFileName(fileName: string) {
  const normalized = String(fileName || "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "");
  const parts = normalized.split(".");
  const extension = parts.length > 1 ? parts.pop() || "" : "";
  const baseName = parts.join(".") || normalized;
  const safeBaseName = baseName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const safeExtension = extension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 10);

  if (safeBaseName && safeExtension) return `${safeBaseName}.${safeExtension}`;
  if (safeBaseName) return safeBaseName;
  if (safeExtension) return `file.${safeExtension}`;
  return "file";
}

export function buildManualAttachmentPath(args: {
  organizationId: string;
  storeId: string;
  conversationId: string;
  uploadId: string;
  fileName: string;
}) {
  return [
    args.organizationId,
    args.storeId,
    MANUAL_ATTACHMENT_PATH_PREFIX,
    args.conversationId,
    `${args.uploadId}-${sanitizeFileName(args.fileName)}`,
  ].join("/");
}

export function isManualAttachmentPathForScope(
  path: string,
  scope: Pick<ManualAttachmentScope, "organizationId" | "storeId" | "conversationId">,
) {
  const prefix = `${scope.organizationId}/${scope.storeId}/${MANUAL_ATTACHMENT_PATH_PREFIX}/${scope.conversationId}/`;
  return path.startsWith(prefix) && path.length > prefix.length && !path.includes("..") && !path.includes("\\");
}

export function createManualAttachmentPayloadFingerprint(args: {
  path: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  messageType: ManualAttachmentMessageType;
  content: string;
}) {
  return createHmac("sha256", "manual-attachment-payload-v1")
    .update(
      JSON.stringify([
        args.path,
        args.fileName,
        args.mimeType,
        args.sizeBytes,
        args.messageType,
        args.content,
      ]),
    )
    .digest("hex");
}

function getAuthorizationSecret() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("service_role_unavailable");
  return secret;
}

export function createManualAttachmentAuthorization(
  args: Omit<ManualAttachmentAuthorization, "version" | "payloadFingerprint">,
) {
  const payload: ManualAttachmentAuthorization = {
    version: 1,
    ...args,
    payloadFingerprint: createManualAttachmentPayloadFingerprint(args),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", getAuthorizationSecret())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function readManualAttachmentAuthorization(token: string): ManualAttachmentAuthorization {
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature) throw new Error("invalid_upload_authorization");
  const expectedSignature = createHmac("sha256", getAuthorizationSecret())
    .update(encoded)
    .digest("base64url");
  if (signature !== expectedSignature) throw new Error("invalid_upload_authorization");

  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ManualAttachmentAuthorization;
  if (
    payload.version !== 1 ||
    !payload.uploadId ||
    !payload.organizationId ||
    !payload.storeId ||
    !payload.conversationId ||
    !payload.leadId ||
    !payload.path ||
    !payload.fileName ||
    !payload.mimeType ||
    !payload.idempotencyKey ||
    !payload.payloadFingerprint ||
    payload.expiresAt <= Date.now() ||
    payload.payloadFingerprint !== createManualAttachmentPayloadFingerprint(payload)
  ) {
    throw new Error("invalid_upload_authorization");
  }
  return payload;
}

export async function loadManualAttachmentScope(args: {
  supabase: ServiceSupabaseClient;
  conversationId: string;
  organizationId: string;
  storeId: string;
}) {
  const conversation = await args.supabase
    .from("conversations")
    .select("id, organization_id, lead_id")
    .eq("id", args.conversationId)
    .eq("organization_id", args.organizationId)
    .maybeSingle<ConversationRow>();

  if (conversation.error) throw new Error("conversation_lookup_failed");
  if (!conversation.data?.lead_id) throw new Error("conversation_not_found_or_forbidden");

  const lead = await args.supabase
    .from("leads")
    .select("id, organization_id, store_id")
    .eq("id", conversation.data.lead_id)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle<LeadRow>();

  if (lead.error) throw new Error("lead_lookup_failed");
  if (!lead.data?.store_id) throw new Error("lead_not_found_or_forbidden");

  return {
    conversationId: conversation.data.id,
    leadId: lead.data.id,
    organizationId: args.organizationId,
    storeId: lead.data.store_id,
  } satisfies ManualAttachmentScope;
}

export async function isRealWhatsappConversation(args: {
  supabase: ServiceSupabaseClient;
  organizationId: string;
  storeId: string;
  conversationId: string;
}) {
  const [incoming, integration] = await Promise.all([
    args.supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", args.conversationId)
      .eq("sender", "user")
      .eq("direction", "incoming")
      .contains("metadata", {
        source: "meta_whatsapp_webhook",
        channel: "whatsapp",
        external_channel: "whatsapp",
      })
      .limit(1),
    args.supabase
      .from("external_integrations")
      .select("id")
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .eq("provider", "whatsapp")
      .eq("is_active", true)
      .eq("status", "active")
      .limit(1),
  ]);

  if (incoming.error || integration.error) throw new Error("whatsapp_scope_validation_failed");
  return Boolean(incoming.data?.[0]?.id && integration.data?.[0]?.id);
}

export async function materializeManualAttachmentMessage(args: {
  supabase: ServiceSupabaseClient;
  authorization: ManualAttachmentAuthorization;
  sessionUserId: string;
  isRealWhatsappConversation?: typeof isRealWhatsappConversation;
}) {
  const whatsapp = await (args.isRealWhatsappConversation ?? isRealWhatsappConversation)({
    supabase: args.supabase,
    organizationId: args.authorization.organizationId,
    storeId: args.authorization.storeId,
    conversationId: args.authorization.conversationId,
  });
  const sendExternal = whatsapp;
  const metadata = {
    source: "panel",
    channel: whatsapp ? "whatsapp" : "crm",
    external_channel: whatsapp ? "whatsapp" : undefined,
    outbound_origin: sendExternal ? `crm_manual_${args.authorization.messageType}` : undefined,
    whatsapp_detected_from_conversation: whatsapp,
    media_origin: "store_user",
    source_channel: "panel_manual",
    storage_bucket: MANUAL_ATTACHMENT_STORAGE_BUCKET,
    storage_path: args.authorization.path,
    original_file_name: args.authorization.fileName,
    original_extension: extractManualAttachmentExtension(args.authorization.fileName),
    mime_type: args.authorization.mimeType,
    size_bytes: args.authorization.sizeBytes,
    attachment_kind: args.authorization.messageType,
    can_be_sent_to_customer: true,
    requires_human_review: false,
    sent_by: "panel_user",
    sent_by_user_id: args.sessionUserId,
    pillar: "pilar_10_multimodal",
    send_external: sendExternal,
    outbound_idempotency_key: args.authorization.idempotencyKey,
    manual_attachment_payload_fingerprint: args.authorization.payloadFingerprint,
    manual_attachment_upload_id: args.authorization.uploadId,
  };
  const rpc = await args.supabase.rpc("finalize_manual_attachment_message", {
    p_organization_id: args.authorization.organizationId,
    p_store_id: args.authorization.storeId,
    p_conversation_id: args.authorization.conversationId,
    p_lead_id: args.authorization.leadId,
    p_message_type: args.authorization.messageType,
    p_content: args.authorization.content,
    p_media_url: args.authorization.path,
    p_metadata: metadata,
    p_outbound_idempotency_key: args.authorization.idempotencyKey,
    p_payload_fingerprint: args.authorization.payloadFingerprint,
  });
  return { rpc, metadata, sendExternal };
}

export async function cleanupManualAttachment(args: {
  supabase: ServiceSupabaseClient;
  path: string;
}) {
  try {
    await args.supabase.storage.from(MANUAL_ATTACHMENT_STORAGE_BUCKET).remove([args.path]);
  } catch {
    // Cleanup is best-effort and never masks the canonical response.
  }
}
