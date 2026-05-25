import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

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
  lead_id: string | null;
};

type LeadRow = {
  id: string;
  organization_id: string;
  store_id: string | null;
};

function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variaveis de ambiente."
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getAttachmentKindFromMimeType(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();

  if (ALLOWED_IMAGE_MIME_TYPES.has(normalized)) return "image" as const;
  if (ALLOWED_AUDIO_MIME_TYPES.has(normalized)) return "audio" as const;
  if (ALLOWED_VIDEO_MIME_TYPES.has(normalized)) return "video" as const;
  if (ALLOWED_DOCUMENT_MIME_TYPES.has(normalized)) return "file" as const;

  return null;
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

function buildDefaultContent(messageType: "image" | "audio" | "video" | "text") {
  if (messageType === "image") return "A loja enviou uma imagem.";
  if (messageType === "audio") return "A loja enviou um audio.";
  if (messageType === "video") return "A loja enviou um video.";
  return "A loja enviou um arquivo.";
}

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  let uploadedStoragePath: string | null = null;

  try {
    const sessionSupabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await sessionSupabase.auth.getUser();

    if (userError || !user) {
      return buildJsonResponse(
        {
          ok: false,
          error: "UNAUTHENTICATED",
          message: "Usuario nao autenticado.",
        },
        401
      );
    }

    const formData = await request.formData();

    const organizationId = String(formData.get("organizationId") || "").trim();
    const requestedStoreId = String(formData.get("storeId") || "").trim();
    const conversationId = String(formData.get("conversationId") || "").trim();
    const rawContent = String(formData.get("content") || "").trim();
    const fileEntry = formData.get("file");

    if (!organizationId || !requestedStoreId || !conversationId) {
      return buildJsonResponse(
        {
          ok: false,
          error: "MISSING_FIELDS",
          message: "Envie organizationId, storeId, conversationId e file.",
        },
        400
      );
    }

    if (!(fileEntry instanceof File)) {
      return buildJsonResponse(
        {
          ok: false,
          error: "FILE_REQUIRED",
          message: "Selecione um arquivo valido para envio.",
        },
        400
      );
    }

    if (fileEntry.size <= 0) {
      return buildJsonResponse(
        {
          ok: false,
          error: "EMPTY_FILE",
          message: "O arquivo enviado esta vazio.",
        },
        400
      );
    }

    if (fileEntry.size > MAX_FILE_SIZE_BYTES) {
      return buildJsonResponse(
        {
          ok: false,
          error: "FILE_TOO_LARGE",
          message: "O anexo deve ter no maximo 10 MB.",
        },
        400
      );
    }

    const attachmentKind = getAttachmentKindFromMimeType(fileEntry.type);

    if (!attachmentKind) {
      return buildJsonResponse(
        {
          ok: false,
          error: "UNSUPPORTED_FILE_TYPE",
          message: "Tipo de arquivo nao suportado para envio manual.",
        },
        415
      );
    }

    const messageType =
      attachmentKind === "file" ? ("text" as const) : attachmentKind;
    const content = rawContent || buildDefaultContent(messageType);
    const supabase = createSupabaseAdminClient();

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id, organization_id, lead_id")
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      .maybeSingle<ConversationRow>();

    if (conversationError) {
      return buildJsonResponse(
        {
          ok: false,
          error: "CONVERSATION_LOOKUP_FAILED",
          message: conversationError.message,
        },
        500
      );
    }

    if (!conversation) {
      return buildJsonResponse(
        {
          ok: false,
          error: "CONVERSATION_NOT_FOUND_OR_FORBIDDEN",
          message: "Conversa nao encontrada para a organizacao informada.",
        },
        404
      );
    }

    const normalizedConversation = conversation as ConversationRow;

    if (!normalizedConversation.lead_id) {
      return buildJsonResponse(
        {
          ok: false,
          error: "CONVERSATION_WITHOUT_LEAD",
          message: "A conversa nao possui lead vinculada.",
        },
        400
      );
    }

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, organization_id, store_id")
      .eq("id", normalizedConversation.lead_id)
      .eq("organization_id", organizationId)
      .maybeSingle<LeadRow>();

    if (leadError) {
      return buildJsonResponse(
        {
          ok: false,
          error: "LEAD_LOOKUP_FAILED",
          message: leadError.message,
        },
        500
      );
    }

    if (!lead) {
      return buildJsonResponse(
        {
          ok: false,
          error: "LEAD_NOT_FOUND_OR_FORBIDDEN",
          message: "Lead nao encontrado para a conversa informada.",
        },
        404
      );
    }

    const normalizedLead = lead as LeadRow;
    const resolvedStoreId = String(normalizedLead.store_id || "").trim();

    if (!resolvedStoreId) {
      return buildJsonResponse(
        {
          ok: false,
          error: "LEAD_STORE_ID_MISSING",
          message: "store_id nao encontrado para este lead.",
        },
        400
      );
    }

    if (requestedStoreId !== resolvedStoreId) {
      return buildJsonResponse(
        {
          ok: false,
          error: "STORE_ID_MISMATCH",
          message: "O storeId informado nao corresponde ao store_id real da lead.",
        },
        400
      );
    }

    const storagePath = buildStoragePath({
      organizationId,
      storeId: resolvedStoreId,
      conversationId,
      fileName: fileEntry.name,
    });
    const mediaUrl = attachmentKind === "file" ? null : storagePath;

    uploadedStoragePath = storagePath;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, fileEntry, {
        upsert: false,
        contentType: fileEntry.type || undefined,
      });

    if (uploadError) {
      return buildJsonResponse(
        {
          ok: false,
          error: "MEDIA_UPLOAD_FAILED",
          message: uploadError.message,
        },
        500
      );
    }

    const metadata = {
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
      sent_by_user_id: user.id,
      pillar: "pilar_10_multimodal",
      send_external: false,
    };

    const { data: insertData, error: insertError } = await supabase.rpc(
      "insert_message",
      {
        p_conversation_id: conversationId,
        p_sender: "human",
        p_direction: "outgoing",
        p_message_type: messageType,
        p_content: content,
        p_external_message_id: null,
        p_media_url: mediaUrl,
        p_metadata: metadata,
      }
    );

    if (insertError) {
      console.error("[send-manual-attachment] insert_message failed", {
        code: insertError.code,
        message: insertError.message,
        details: insertError.details,
        hint: insertError.hint,
        conversationId,
        organizationId,
        requestedStoreId,
        sender: "human",
        direction: "outgoing",
        messageType,
        metadataKeys: Object.keys(metadata),
      });

      const { error: cleanupError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([storagePath]);

      if (cleanupError) {
        console.error(
          "[send-manual-attachment] cleanup after insert_message failed:",
          {
            storagePath,
            message: cleanupError.message,
          }
        );
      }

      return buildJsonResponse(
        {
          ok: false,
          error: "INSERT_MANUAL_ATTACHMENT_FAILED",
          message: "O anexo foi enviado, mas nao foi possivel registrar a mensagem.",
        },
        500
      );
    }

    const messageId = extractInsertMessageId(insertData);

    return buildJsonResponse({
      ok: true,
      messageId,
      messageType,
      attachmentKind,
    });
  } catch (error) {
    if (uploadedStoragePath) {
      try {
        const supabase = createSupabaseAdminClient();
        await supabase.storage.from(STORAGE_BUCKET).remove([uploadedStoragePath]);
      } catch (cleanupError) {
        console.error("[send-manual-attachment] cleanup after unexpected error failed:", {
          storagePath: uploadedStoragePath,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError || ""),
        });
      }
    }

    const message =
      error instanceof Error ? error.message : "Erro interno ao enviar anexo manual.";

    return buildJsonResponse(
      {
        ok: false,
        error: "SEND_MANUAL_ATTACHMENT_ROUTE_FAILED",
        message,
      },
      500
    );
  }
}
