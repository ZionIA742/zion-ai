import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORAGE_BUCKET = "zion-store-files";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

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

type ConversationRow = {
  id: string;
  organization_id: string;
  store_id: string | null;
  lead_id: string | null;
};

type LeadRow = {
  id: string;
  organization_id: string;
  store_id: string | null;
};

type ExternalIntegrationRow = {
  id: string;
};

type AttachmentKind = "image" | "audio" | "video" | "file";
type MessageType = "image" | "audio" | "video" | "text";

type ServiceSupabaseClient = ReturnType<typeof createServiceSupabaseClient>;

type SendManualAttachmentDeps = {
  resolveStoreAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createServiceSupabaseClient: () => ServiceSupabaseClient;
  isRealWhatsappConversation: (args: {
    supabase: ServiceSupabaseClient;
    organizationId: string;
    storeId: string;
    conversationId: string;
  }) => Promise<boolean>;
  readFileBytes: (file: File) => Promise<Buffer>;
};

function createServiceSupabaseClient() {
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

function createJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function normalizeMimeType(value: string | null | undefined) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function getAttachmentKindFromMimeType(value: string | null | undefined) {
  const normalized = normalizeMimeType(value);

  if (ALLOWED_IMAGE_MIME_TYPES.has(normalized)) return "image" as const;
  if (ALLOWED_AUDIO_MIME_TYPES.has(normalized)) return "audio" as const;
  if (ALLOWED_VIDEO_MIME_TYPES.has(normalized)) return "video" as const;
  if (ALLOWED_DOCUMENT_MIME_TYPES.has(normalized)) return "file" as const;

  return null;
}

function getMessageTypeFromAttachmentKind(attachmentKind: AttachmentKind): MessageType {
  return attachmentKind === "file" ? "text" : attachmentKind;
}

function extractFileExtension(fileName: string | null | undefined) {
  const normalized = String(fileName || "").trim();
  if (!normalized.includes(".")) return null;

  const extension = normalized.split(".").pop() || "";
  const safeExtension = extension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 10);

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

function buildStoragePath(args: {
  organizationId: string;
  storeId: string;
  conversationId: string;
  fileName: string;
}) {
  const now = new Date();
  const timestamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("");
  const random = Math.random().toString(36).slice(2, 8);
  const safeFileName = sanitizeFileName(args.fileName);

  return [
    args.organizationId,
    args.storeId,
    "manual-attachments",
    args.conversationId,
    `${timestamp}-${random}-${safeFileName}`,
  ].join("/");
}

function extractInsertMessageId(data: unknown) {
  if (Array.isArray(data)) {
    const first = data[0];
    if (first && typeof first === "object" && "id" in first) {
      return String((first as { id?: string | null }).id || "").trim() || null;
    }
    if (typeof first === "string") return first.trim() || null;
  }

  if (data && typeof data === "object" && "id" in data) {
    return String((data as { id?: string | null }).id || "").trim() || null;
  }

  if (typeof data === "string") {
    return data.trim() || null;
  }

  return null;
}

function buildDefaultContent(messageType: MessageType) {
  if (messageType === "image") return "A loja enviou uma imagem.";
  if (messageType === "audio") return "A loja enviou um audio.";
  if (messageType === "video") return "A loja enviou um video.";
  return "A loja enviou um arquivo.";
}

function createInvalidFormDataResponse() {
  return createJsonResponse(
    {
      ok: false,
      error: "INVALID_FORM_DATA",
      message: "Nao foi possivel ler os dados do anexo enviado.",
    },
    400,
  );
}

function createConversationNotFoundResponse() {
  return createJsonResponse(
    {
      ok: false,
      error: "CONVERSATION_NOT_FOUND_OR_FORBIDDEN",
      message: "Conversa nao encontrada para a loja informada.",
    },
    404,
  );
}

async function defaultReadFileBytes(file: File) {
  return Buffer.from(await file.arrayBuffer());
}

async function defaultIsRealWhatsappConversation(args: {
  supabase: ServiceSupabaseClient;
  organizationId: string;
  storeId: string;
  conversationId: string;
}) {
  const whatsappMetadataFilter: Record<string, unknown> = {
    source: "meta_whatsapp_webhook",
    channel: "whatsapp",
    external_channel: "whatsapp",
  };

  const [recentWhatsappIncoming, activeIntegration] = await Promise.all([
    args.supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", args.conversationId)
      .eq("sender", "user")
      .eq("direction", "incoming")
      .contains("metadata", whatsappMetadataFilter)
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

  if (recentWhatsappIncoming.error || activeIntegration.error) {
    throw new Error("whatsapp_scope_validation_failed");
  }

  const hasRecentWhatsappIncoming = Boolean(
    Array.isArray(recentWhatsappIncoming.data) &&
      recentWhatsappIncoming.data[0] &&
      recentWhatsappIncoming.data[0].id,
  );

  const hasActiveIntegration = Boolean(
    Array.isArray(activeIntegration.data) &&
      (activeIntegration.data[0] as ExternalIntegrationRow | undefined)?.id,
  );

  return hasRecentWhatsappIncoming && hasActiveIntegration;
}

async function loadScopedConversation(args: {
  supabase: ServiceSupabaseClient;
  conversationId: string;
  organizationId: string;
  storeId: string;
}) {
  const { data, error } = await args.supabase
    .from("conversations")
    .select("id, organization_id, store_id, lead_id")
    .eq("id", args.conversationId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle<ConversationRow>();

  if (error) {
    return {
      ok: false as const,
      response: createJsonResponse(
        {
          ok: false,
          error: "CONVERSATION_LOOKUP_FAILED",
          message: "Nao foi possivel validar a conversa informada.",
        },
        500,
      ),
    };
  }

  if (!data) {
    return {
      ok: false as const,
      response: createConversationNotFoundResponse(),
    };
  }

  return {
    ok: true as const,
    conversation: data,
  };
}

async function loadScopedLead(args: {
  supabase: ServiceSupabaseClient;
  leadId: string;
  organizationId: string;
  storeId: string;
}) {
  const { data, error } = await args.supabase
    .from("leads")
    .select("id, organization_id, store_id")
    .eq("id", args.leadId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle<LeadRow>();

  if (error) {
    return {
      ok: false as const,
      response: createJsonResponse(
        {
          ok: false,
          error: "LEAD_LOOKUP_FAILED",
          message: "Nao foi possivel validar o lead da conversa informada.",
        },
        500,
      ),
    };
  }

  if (!data) {
    return {
      ok: false as const,
      response: createJsonResponse(
        {
          ok: false,
          error: "LEAD_NOT_FOUND_OR_FORBIDDEN",
          message: "Lead nao encontrado para a conversa informada.",
        },
        404,
      ),
    };
  }

  return {
    ok: true as const,
    lead: data,
  };
}

async function cleanupUploadedFile(args: {
  supabase: ServiceSupabaseClient;
  storagePath: string;
  conversationId: string;
}) {
  try {
    const { error } = await args.supabase.storage
      .from(STORAGE_BUCKET)
      .remove([args.storagePath]);

    if (error) {
      console.error("[send-manual-attachment] cleanup_failed", {
        operation: "manual_attachment_cleanup",
        conversationId: args.conversationId,
      });
    }
  } catch {
    console.error("[send-manual-attachment] cleanup_failed", {
      operation: "manual_attachment_cleanup",
      conversationId: args.conversationId,
    });
  }
}

export async function handleSendManualAttachmentPost(
  request: Request,
  deps: SendManualAttachmentDeps = {
    resolveStoreAccess: resolveStoreApiAccess,
    createServiceSupabaseClient,
    isRealWhatsappConversation: defaultIsRealWhatsappConversation,
    readFileBytes: defaultReadFileBytes,
  },
) {
  let uploadCompleted = false;
  let messagePersisted = false;
  let storagePath: string | null = null;
  let serviceSupabase: ServiceSupabaseClient | null = null;
  let conversationIdForCleanup = "";

  try {
    const access = await deps.resolveStoreAccess({
      requirement: "active",
    });

    if (!access.ok) {
      return createStoreApiDeniedResponse(access);
    }

    let formData: FormData;

    try {
      formData = await request.formData();
    } catch {
      return createInvalidFormDataResponse();
    }

    const conversationId = String(formData.get("conversationId") || "").trim();
    const rawContent = String(formData.get("content") || "").trim();
    const fileEntry = formData.get("file");
    conversationIdForCleanup = conversationId;

    if (!conversationId) {
      return createJsonResponse(
        {
          ok: false,
          error: "MISSING_FIELDS",
          message: "Envie conversationId e file.",
        },
        400,
      );
    }

    if (!(fileEntry instanceof File)) {
      return createJsonResponse(
        {
          ok: false,
          error: "FILE_REQUIRED",
          message: "Selecione um arquivo valido para envio.",
        },
        400,
      );
    }

    if (fileEntry.size <= 0) {
      return createJsonResponse(
        {
          ok: false,
          error: "EMPTY_FILE",
          message: "O arquivo enviado esta vazio.",
        },
        400,
      );
    }

    if (fileEntry.size > MAX_FILE_SIZE_BYTES) {
      return createJsonResponse(
        {
          ok: false,
          error: "FILE_TOO_LARGE",
          message: "O anexo deve ter no maximo 10 MB.",
        },
        400,
      );
    }

    const attachmentKind = getAttachmentKindFromMimeType(fileEntry.type);

    if (!attachmentKind) {
      return createJsonResponse(
        {
          ok: false,
          error: "UNSUPPORTED_FILE_TYPE",
          message: "Tipo de arquivo nao suportado para envio manual.",
        },
        415,
      );
    }

    const messageType = getMessageTypeFromAttachmentKind(attachmentKind);
    const content = rawContent || buildDefaultContent(messageType);

    serviceSupabase = deps.createServiceSupabaseClient();

    const conversationResult = await loadScopedConversation({
      supabase: serviceSupabase,
      conversationId,
      organizationId: access.organizationId,
      storeId: access.storeId,
    });

    if (!conversationResult.ok) {
      return conversationResult.response;
    }

    if (!conversationResult.conversation.lead_id) {
      return createJsonResponse(
        {
          ok: false,
          error: "CONVERSATION_WITHOUT_LEAD",
          message: "A conversa nao possui lead vinculada.",
        },
        400,
      );
    }

    const leadResult = await loadScopedLead({
      supabase: serviceSupabase,
      leadId: conversationResult.conversation.lead_id,
      organizationId: access.organizationId,
      storeId: access.storeId,
    });

    if (!leadResult.ok) {
      return leadResult.response;
    }

    const fileBytes = await deps.readFileBytes(fileEntry);
    storagePath = buildStoragePath({
      organizationId: access.organizationId,
      storeId: access.storeId,
      conversationId,
      fileName: fileEntry.name,
    });

    const isWhatsappReal =
      attachmentKind === "image"
        ? await deps.isRealWhatsappConversation({
            supabase: serviceSupabase,
            organizationId: access.organizationId,
            storeId: access.storeId,
            conversationId,
          })
        : false;

    const mediaUrl = attachmentKind === "file" ? null : storagePath;

    const uploadResult = await serviceSupabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, fileBytes, {
        upsert: false,
        contentType: fileEntry.type || undefined,
      });

    if (uploadResult.error) {
      return createJsonResponse(
        {
          ok: false,
          error: "MEDIA_UPLOAD_FAILED",
          message: "Nao foi possivel enviar o anexo agora.",
        },
        500,
      );
    }

    uploadCompleted = true;

    const metadata = {
      ...(isWhatsappReal
        ? {
            source: "panel",
            channel: "whatsapp",
            external_channel: "whatsapp",
            outbound_origin: "crm_manual_image",
            whatsapp_detected_from_conversation: true,
          }
        : {}),
      media_origin: "store_user",
      source_channel: "panel_manual",
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
      original_file_name: fileEntry.name,
      original_extension: extractFileExtension(fileEntry.name),
      mime_type: fileEntry.type,
      size_bytes: fileEntry.size,
      attachment_kind: attachmentKind,
      can_be_sent_to_customer: true,
      requires_human_review: false,
      sent_by: "panel_user",
      sent_by_user_id: access.sessionUserId,
      pillar: "pilar_10_multimodal",
      send_external: isWhatsappReal,
    };

    let insertResult:
      | {
          data: unknown;
          error: { message?: string | null } | null;
        }
      | undefined;

    try {
      insertResult = await serviceSupabase.rpc("insert_message", {
        p_conversation_id: conversationId,
        p_sender: "human",
        p_direction: "outgoing",
        p_message_type: messageType,
        p_content: content,
        p_external_message_id: null,
        p_media_url: mediaUrl,
        p_metadata: metadata,
      });
    } catch {
      if (uploadCompleted && !messagePersisted && storagePath) {
        await cleanupUploadedFile({
          supabase: serviceSupabase,
          storagePath,
          conversationId,
        });
      }

      return createJsonResponse(
        {
          ok: false,
          error: "INSERT_MANUAL_ATTACHMENT_FAILED",
          message: "O anexo foi enviado, mas nao foi possivel registrar a mensagem.",
        },
        500,
      );
    }

    if (insertResult.error) {
      if (uploadCompleted && !messagePersisted && storagePath) {
        await cleanupUploadedFile({
          supabase: serviceSupabase,
          storagePath,
          conversationId,
        });
      }

      return createJsonResponse(
        {
          ok: false,
          error: "INSERT_MANUAL_ATTACHMENT_FAILED",
          message: "O anexo foi enviado, mas nao foi possivel registrar a mensagem.",
        },
        500,
      );
    }

    messagePersisted = true;

    return createJsonResponse({
      ok: true,
      messageId: extractInsertMessageId(insertResult.data),
      messageType,
      attachmentKind,
    });
  } catch {
    if (uploadCompleted && !messagePersisted && storagePath && serviceSupabase) {
      await cleanupUploadedFile({
        supabase: serviceSupabase,
        storagePath,
        conversationId: conversationIdForCleanup,
      });
    }

    return createJsonResponse(
      {
        ok: false,
        error: "SEND_MANUAL_ATTACHMENT_ROUTE_FAILED",
        message: "Erro interno ao enviar anexo manual.",
      },
      500,
    );
  }
}

export async function POST(request: Request) {
  return handleSendManualAttachmentPost(request);
}
