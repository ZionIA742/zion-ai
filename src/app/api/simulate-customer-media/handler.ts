import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { classifyIncomingMediaMessage } from "@/lib/server/media-classification";
import {
  resolveStoreApiAccess,
  type StoreApiAccessDenied,
  type StoreApiAccessResult,
} from "../../../lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "../../../lib/server/store-api-response";
import { analyzeCustomerLocationPhotoFromStorage } from "../../../lib/server/analyze-customer-location-photo";
import { transcribeCustomerAudioFromStorage } from "../../../lib/server/transcribe-customer-audio";
import { generateAndSaveAiSalesReply } from "../../../lib/server/generate-and-save-ai-sales-reply";

export const runtime = "nodejs";

const STORAGE_BUCKET = "zion-store-files";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const DEFAULT_PURPOSE = "customer_location_photo";
const DEFAULT_IMAGE_CONTENT = "Cliente enviou uma foto do local.";
const GENERIC_ATTACHMENT_CONTENT = "Cliente enviou um anexo.";
const LOCAL_SUCCESS_MESSAGE = "Anexo do cliente registrado com sucesso.";
const INVALID_REQUEST_MESSAGE =
  "Envie uma conversa valida, um purpose suportado e um arquivo compativel.";
const ROUTE_FAILED_MESSAGE =
  "Nao foi possivel concluir a simulacao de anexo do cliente no momento.";
const PROCESSING_UNAVAILABLE_MESSAGE =
  "Anexo do cliente registrado, mas o processamento complementar nao foi concluido neste momento.";
const MESSAGE_SAVE_FAILED_MESSAGE =
  "O anexo foi recebido, mas nao foi possivel concluir o registro da mensagem agora.";

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

const PURPOSE_TO_CLASSIFIER_PURPOSE: Record<string, string> = {
  customer_location_photo: "customer_location_photo",
  customer_product_or_pool_photo: "customer_product_photo",
  customer_product_photo: "customer_product_photo",
  payment_proof: "payment_receipt",
  payment_receipt: "payment_receipt",
  conversation_or_document_screenshot: "screenshot",
  screenshot: "screenshot",
  operational_image: "operational_image",
  unknown: "unknown",
};

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

type PersistedMessageRow = {
  id: string;
  metadata: Record<string, unknown> | null;
};

type PublicSuccessPayload = {
  ok: true;
  message: string;
};

type PublicErrorPayload = {
  ok: false;
  error: string;
  message: string;
};

type MediaFileLike = {
  name: string;
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

type PrivilegedClient = SupabaseClient;

type HandlerDeps = {
  resolveAccess: () => Promise<StoreApiAccessResult>;
  createDeniedResponse: (access: StoreApiAccessDenied) => NextResponse;
  createPrivilegedClient: () => PrivilegedClient;
  readFileBuffer: (file: MediaFileLike) => Promise<Buffer>;
  uploadMedia: (args: {
    supabase: PrivilegedClient;
    bucket: string;
    storagePath: string;
    fileBuffer: Buffer;
    mimeType: string;
  }) => Promise<{ error: { message: string } | null }>;
  classifyCustomerMedia: typeof classifyIncomingMediaMessage;
  analyzeCustomerLocationPhoto: typeof analyzeCustomerLocationPhotoFromStorage;
  transcribeCustomerAudio: typeof transcribeCustomerAudioFromStorage;
  runAiFlow: typeof generateAndSaveAiSalesReply;
  now: () => Date;
  createRandomSuffix: () => string;
};

function jsonNoStore(payload: PublicSuccessPayload | PublicErrorPayload, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function createPublicError(status: number, error: string, message: string) {
  return jsonNoStore(
    {
      ok: false,
      error,
      message,
    },
    status,
  );
}

function createPublicSuccess(message: string) {
  return jsonNoStore(
    {
      ok: true,
      message,
    },
    200,
  );
}

function createPrivilegedSupabaseClient(): PrivilegedClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("SUPABASE_ENV_MISSING");
  }

  return createClient(supabaseUrl, supabaseServiceKey);
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

function extractFileExtension(fileName: string | null | undefined) {
  const normalized = String(fileName || "").trim();

  if (!normalized.includes(".")) {
    return null;
  }

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

function buildStoragePath(args: {
  organizationId: string;
  storeId: string;
  leadId: string;
  conversationId: string;
  fileName: string;
  now: Date;
  randomSuffix: string;
}) {
  const timestamp = [
    args.now.getUTCFullYear(),
    String(args.now.getUTCMonth() + 1).padStart(2, "0"),
    String(args.now.getUTCDate()).padStart(2, "0"),
  ].join("");

  return [
    args.organizationId,
    args.storeId,
    "customer-media",
    args.leadId,
    args.conversationId,
    `${timestamp}-${args.randomSuffix}-${sanitizeFileName(args.fileName)}`,
  ].join("/");
}

function extractInsertMessageId(data: unknown) {
  if (Array.isArray(data)) {
    const first = data[0];

    if (first && typeof first === "object" && "id" in first) {
      return String((first as { id?: string | null }).id || "").trim() || null;
    }

    if (typeof first === "string") {
      return first.trim() || null;
    }
  }

  if (data && typeof data === "object" && "id" in data) {
    return String((data as { id?: string | null }).id || "").trim() || null;
  }

  if (typeof data === "string") {
    return data.trim() || null;
  }

  return null;
}

function isMediaFileLike(value: unknown): value is MediaFileLike {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as MediaFileLike).name === "string" &&
    typeof (value as MediaFileLike).size === "number" &&
    typeof (value as MediaFileLike).type === "string" &&
    typeof (value as MediaFileLike).arrayBuffer === "function"
  );
}

function normalizePurpose(value: FormDataEntryValue | null) {
  const requestedPurpose =
    String(value || DEFAULT_PURPOSE).trim() || DEFAULT_PURPOSE;
  const classifierPurpose = PURPOSE_TO_CLASSIFIER_PURPOSE[requestedPurpose] || null;

  if (!classifierPurpose) {
    return null;
  }

  return {
    requestedPurpose,
    classifierPurpose,
  };
}

async function loadPersistedMessage(args: {
  supabase: PrivilegedClient;
  messageId: string;
  conversationId: string;
}) {
  return args.supabase
    .from("messages")
    .select("id, metadata")
    .eq("id", args.messageId)
    .eq("conversation_id", args.conversationId)
    .maybeSingle();
}

async function updateMessageMetadata(args: {
  supabase: PrivilegedClient;
  messageId: string;
  conversationId: string;
  metadata: Record<string, unknown>;
}) {
  return args.supabase
    .from("messages")
    .update({
      metadata: args.metadata,
    })
    .eq("id", args.messageId)
    .eq("conversation_id", args.conversationId);
}

async function cleanupUploadedMedia(args: {
  supabase: PrivilegedClient;
  storagePath: string | null;
}) {
  if (!args.storagePath) {
    return;
  }

  try {
    await args.supabase.storage.from(STORAGE_BUCKET).remove([args.storagePath]);
  } catch {}
}

async function finalizeAiReply(args: {
  deps: HandlerDeps;
  organizationId: string;
  storeId: string;
  conversationId: string;
}) {
  try {
    const aiResult = await args.deps.runAiFlow({
      organizationId: args.organizationId,
      storeId: args.storeId,
      conversationId: args.conversationId,
    });

    if (!aiResult.ok) {
      return createPublicError(
        409,
        "SIMULATE_CUSTOMER_MEDIA_PROCESSING_UNAVAILABLE",
        PROCESSING_UNAVAILABLE_MESSAGE,
      );
    }

    return createPublicSuccess(LOCAL_SUCCESS_MESSAGE);
  } catch {
    return createPublicError(
      409,
      "SIMULATE_CUSTOMER_MEDIA_PROCESSING_UNAVAILABLE",
      PROCESSING_UNAVAILABLE_MESSAGE,
    );
  }
}

const defaultDeps: HandlerDeps = {
  resolveAccess: () => resolveStoreApiAccess({ requirement: "active" }),
  createDeniedResponse: createStoreApiDeniedResponse,
  createPrivilegedClient: createPrivilegedSupabaseClient,
  readFileBuffer: async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    return Buffer.from(arrayBuffer);
  },
  uploadMedia: async ({ supabase, bucket, storagePath, fileBuffer, mimeType }) =>
    supabase.storage.from(bucket).upload(storagePath, fileBuffer, {
      upsert: false,
      contentType: mimeType || undefined,
    }),
  classifyCustomerMedia: classifyIncomingMediaMessage,
  analyzeCustomerLocationPhoto: analyzeCustomerLocationPhotoFromStorage,
  transcribeCustomerAudio: transcribeCustomerAudioFromStorage,
  runAiFlow: generateAndSaveAiSalesReply,
  now: () => new Date(),
  createRandomSuffix: () => Math.random().toString(36).slice(2, 8),
};

export function createSimulateCustomerMediaPostHandler(deps?: Partial<HandlerDeps>) {
  const resolvedDeps: HandlerDeps = {
    ...defaultDeps,
    ...deps,
  };

  return async function POST(request: Request) {
    const access = await resolvedDeps.resolveAccess();

    if (!access.ok) {
      return resolvedDeps.createDeniedResponse(access as StoreApiAccessDenied);
    }

    let formData: FormData;

    try {
      formData = await request.formData();
    } catch {
      return createPublicError(
        400,
        "SIMULATE_CUSTOMER_MEDIA_INVALID_REQUEST",
        INVALID_REQUEST_MESSAGE,
      );
    }

    const conversationId = String(formData.get("conversationId") || "").trim();
    const normalizedPurpose = normalizePurpose(formData.get("purpose"));
    const fileEntry = formData.get("file");

    if (!conversationId || !normalizedPurpose || !isMediaFileLike(fileEntry)) {
      return createPublicError(
        400,
        "SIMULATE_CUSTOMER_MEDIA_INVALID_REQUEST",
        INVALID_REQUEST_MESSAGE,
      );
    }

    const attachmentKind = getAttachmentKindFromMimeType(fileEntry.type);

    if (!attachmentKind) {
      return createPublicError(
        400,
        "SIMULATE_CUSTOMER_MEDIA_INVALID_FILE_TYPE",
        INVALID_REQUEST_MESSAGE,
      );
    }

    if (fileEntry.size <= 0 || fileEntry.size > MAX_FILE_SIZE_BYTES) {
      return createPublicError(
        400,
        "SIMULATE_CUSTOMER_MEDIA_INVALID_FILE_SIZE",
        INVALID_REQUEST_MESSAGE,
      );
    }

    let supabase: PrivilegedClient;

    try {
      supabase = resolvedDeps.createPrivilegedClient();
    } catch {
      return createPublicError(
        500,
        "SIMULATE_CUSTOMER_MEDIA_ROUTE_FAILED",
        ROUTE_FAILED_MESSAGE,
      );
    }

    let conversationData: unknown;
    let conversationError: { message: string } | null;

    try {
      ({ data: conversationData, error: conversationError } = await supabase
        .from("conversations")
        .select("id, organization_id, store_id, lead_id")
        .eq("id", conversationId)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle());
    } catch {
      return createPublicError(
        500,
        "SIMULATE_CUSTOMER_MEDIA_ROUTE_FAILED",
        ROUTE_FAILED_MESSAGE,
      );
    }

    if (conversationError) {
      return createPublicError(
        500,
        "SIMULATE_CUSTOMER_MEDIA_ROUTE_FAILED",
        ROUTE_FAILED_MESSAGE,
      );
    }

    const conversation = conversationData as ConversationRow | null;

    if (!conversation) {
      return createPublicError(
        404,
        "SIMULATE_CUSTOMER_MEDIA_CONVERSATION_NOT_AVAILABLE",
        "Conversa indisponivel para esta simulacao.",
      );
    }

    const leadId = String(conversation.lead_id || "").trim();

    if (!leadId) {
      return createPublicError(
        409,
        "SIMULATE_CUSTOMER_MEDIA_CONVERSATION_UNAVAILABLE",
        "A conversa nao esta pronta para receber este anexo simulado.",
      );
    }

    let leadData: unknown;
    let leadError: { message: string } | null;

    try {
      ({ data: leadData, error: leadError } = await supabase
        .from("leads")
        .select("id, organization_id, store_id")
        .eq("id", leadId)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle());
    } catch {
      return createPublicError(
        500,
        "SIMULATE_CUSTOMER_MEDIA_ROUTE_FAILED",
        ROUTE_FAILED_MESSAGE,
      );
    }

    if (leadError) {
      return createPublicError(
        500,
        "SIMULATE_CUSTOMER_MEDIA_ROUTE_FAILED",
        ROUTE_FAILED_MESSAGE,
      );
    }

    const lead = leadData as LeadRow | null;

    if (!lead) {
      return createPublicError(
        404,
        "SIMULATE_CUSTOMER_MEDIA_LEAD_NOT_AVAILABLE",
        "Conversa indisponivel para esta simulacao.",
      );
    }

    let fileBuffer: Buffer;

    try {
      fileBuffer = await resolvedDeps.readFileBuffer(fileEntry);
    } catch {
      return createPublicError(
        500,
        "SIMULATE_CUSTOMER_MEDIA_ROUTE_FAILED",
        ROUTE_FAILED_MESSAGE,
      );
    }

    let classification: ReturnType<typeof classifyIncomingMediaMessage>;

    try {
      classification = resolvedDeps.classifyCustomerMedia({
        messageType: attachmentKind,
        mimeType: fileEntry.type,
        fileName: fileEntry.name,
        content:
          attachmentKind === "image"
            ? DEFAULT_IMAGE_CONTENT
            : GENERIC_ATTACHMENT_CONTENT,
        explicitPurpose: normalizedPurpose.classifierPurpose,
        sender: "user",
        direction: "incoming",
        sourceChannel: "panel_simulation",
      });
    } catch {
      return createPublicError(
        500,
        "SIMULATE_CUSTOMER_MEDIA_ROUTE_FAILED",
        ROUTE_FAILED_MESSAGE,
      );
    }

    const storagePath = buildStoragePath({
      organizationId: access.organizationId,
      storeId: access.storeId,
      leadId: lead.id,
      conversationId: conversation.id,
      fileName: fileEntry.name,
      now: resolvedDeps.now(),
      randomSuffix: resolvedDeps.createRandomSuffix(),
    });

    try {
      const uploadResult = await resolvedDeps.uploadMedia({
        supabase,
        bucket: STORAGE_BUCKET,
        storagePath,
        fileBuffer,
        mimeType: fileEntry.type,
      });

      if (uploadResult.error) {
        return createPublicError(
          500,
          "SIMULATE_CUSTOMER_MEDIA_UPLOAD_FAILED",
          ROUTE_FAILED_MESSAGE,
        );
      }
    } catch {
      return createPublicError(
        500,
        "SIMULATE_CUSTOMER_MEDIA_UPLOAD_FAILED",
        ROUTE_FAILED_MESSAGE,
      );
    }

    const metadata: Record<string, unknown> = {
      organization_id: access.organizationId,
      store_id: access.storeId,
      lead_id: lead.id,
      conversation_id: conversation.id,
      media_purpose: normalizedPurpose.requestedPurpose,
      media_purpose_normalized: classification.mediaPurpose,
      attachment_kind: attachmentKind,
      media_origin: "customer",
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
      original_file_name: fileEntry.name,
      original_extension: extractFileExtension(fileEntry.name),
      mime_type: fileEntry.type,
      size_bytes: fileEntry.size,
      source_channel: "panel_simulation",
      visual_simulation_status: "received",
      can_be_used_for_recommendation: true,
      can_be_sent_to_customer: false,
      requires_human_review: classification.requiresHumanReview,
      media_classification_confidence: classification.confidence,
      media_classification_reason: classification.reason,
      media_requires_ai_analysis: classification.requiresAiAnalysis,
      media_requires_human_review: classification.requiresHumanReview,
      media_classified_by: "rule_engine_v1",
      pillar: "pilar_10_multimodal",
      ...(attachmentKind === "audio"
        ? {
            transcription_status: "pending",
            transcription_error: null,
          }
        : {}),
      ...(classification.mediaPurpose === "customer_location_photo" &&
      attachmentKind === "image"
        ? {
            visual_analysis_status: "pending",
            visual_analysis_error: null,
          }
        : {}),
    };

    let insertData: unknown;
    let insertError: { message: string } | null;

    try {
      ({ data: insertData, error: insertError } = await supabase.rpc(
        "insert_message",
        {
          p_conversation_id: conversation.id,
          p_sender: "user",
          p_direction: "incoming",
          p_message_type: attachmentKind,
          p_content:
            attachmentKind === "image"
              ? DEFAULT_IMAGE_CONTENT
              : GENERIC_ATTACHMENT_CONTENT,
          p_external_message_id: null,
          p_media_url: storagePath,
          p_metadata: metadata,
        },
      ));
    } catch {
      await cleanupUploadedMedia({
        supabase,
        storagePath,
      });

      return createPublicError(
        500,
        "SIMULATE_CUSTOMER_MEDIA_ROUTE_FAILED",
        ROUTE_FAILED_MESSAGE,
      );
    }

    if (insertError) {
      await cleanupUploadedMedia({
        supabase,
        storagePath,
      });

      return createPublicError(
        500,
        "SIMULATE_CUSTOMER_MEDIA_MESSAGE_SAVE_FAILED",
        MESSAGE_SAVE_FAILED_MESSAGE,
      );
    }

    const requiresAudioTranscription = attachmentKind === "audio";
    const requiresVisualAnalysis =
      attachmentKind === "image" &&
      classification.mediaPurpose === "customer_location_photo";

    if (!requiresAudioTranscription && !requiresVisualAnalysis) {
      return createPublicSuccess(LOCAL_SUCCESS_MESSAGE);
    }

    const messageId = extractInsertMessageId(insertData);

    if (!messageId) {
      return createPublicError(
        409,
        "SIMULATE_CUSTOMER_MEDIA_PROCESSING_UNAVAILABLE",
        PROCESSING_UNAVAILABLE_MESSAGE,
      );
    }

    let persistedMessageMetadata: Record<string, unknown> = metadata;

    try {
      const { data: persistedMessage, error: persistedMessageError } =
        await loadPersistedMessage({
          supabase,
          messageId,
          conversationId: conversation.id,
        });

      if (persistedMessageError) {
        return createPublicError(
          409,
          "SIMULATE_CUSTOMER_MEDIA_PROCESSING_UNAVAILABLE",
          PROCESSING_UNAVAILABLE_MESSAGE,
        );
      }

      const persistedMessageRow = persistedMessage as PersistedMessageRow | null;
      const safePersistedMetadata =
        persistedMessageRow?.metadata && typeof persistedMessageRow.metadata === "object"
          ? persistedMessageRow.metadata
          : metadata;

      persistedMessageMetadata = {
        ...safePersistedMetadata,
        organization_id: access.organizationId,
        store_id: access.storeId,
        lead_id: lead.id,
        conversation_id: conversation.id,
      };
    } catch {
      return createPublicError(
        409,
        "SIMULATE_CUSTOMER_MEDIA_PROCESSING_UNAVAILABLE",
        PROCESSING_UNAVAILABLE_MESSAGE,
      );
    }

    if (requiresVisualAnalysis) {
      const existingLocationAnalysis =
        persistedMessageMetadata.location_photo_analysis &&
        typeof persistedMessageMetadata.location_photo_analysis === "object"
          ? (persistedMessageMetadata.location_photo_analysis as Record<string, unknown>)
          : null;
      const existingSummary = String(existingLocationAnalysis?.summary || "").trim();
      const existingVisualStatus = String(
        persistedMessageMetadata.visual_analysis_status || "",
      ).trim();

      if (existingSummary || existingVisualStatus === "succeeded") {
        return finalizeAiReply({
          deps: resolvedDeps,
          organizationId: access.organizationId,
          storeId: access.storeId,
          conversationId: conversation.id,
        });
      }

      let visualAnalysisResult: Awaited<
        ReturnType<typeof analyzeCustomerLocationPhotoFromStorage>
      >;

      try {
        visualAnalysisResult = await resolvedDeps.analyzeCustomerLocationPhoto({
          supabase,
          bucket: STORAGE_BUCKET,
          storagePath,
          fileName: fileEntry.name,
          mimeType: fileEntry.type,
        });
      } catch {
        return createPublicError(
          409,
          "SIMULATE_CUSTOMER_MEDIA_PROCESSING_UNAVAILABLE",
          PROCESSING_UNAVAILABLE_MESSAGE,
        );
      }

      if (!visualAnalysisResult.ok) {
        try {
          await updateMessageMetadata({
            supabase,
            messageId,
            conversationId: conversation.id,
            metadata: {
              ...persistedMessageMetadata,
              visual_analysis_status: "failed",
              visual_analysis_provider: visualAnalysisResult.provider,
              visual_analysis_model: visualAnalysisResult.model,
              visual_analysis_error: visualAnalysisResult.error,
              visual_analysis_completed_at: new Date().toISOString(),
            },
          });
        } catch {}

        return createPublicError(
          409,
          "SIMULATE_CUSTOMER_MEDIA_PROCESSING_UNAVAILABLE",
          PROCESSING_UNAVAILABLE_MESSAGE,
        );
      }

      try {
        const { error: metadataUpdateError } = await updateMessageMetadata({
          supabase,
          messageId,
          conversationId: conversation.id,
          metadata: {
            ...persistedMessageMetadata,
            location_photo_analysis: visualAnalysisResult.analysis,
            visual_analysis_status: "succeeded",
            visual_analysis_provider: visualAnalysisResult.provider,
            visual_analysis_model: visualAnalysisResult.model,
            visual_analysis_error: null,
            visual_analysis_completed_at: new Date().toISOString(),
          },
        });

        if (metadataUpdateError) {
          return createPublicError(
            409,
            "SIMULATE_CUSTOMER_MEDIA_PROCESSING_UNAVAILABLE",
            PROCESSING_UNAVAILABLE_MESSAGE,
          );
        }
      } catch {
        return createPublicError(
          409,
          "SIMULATE_CUSTOMER_MEDIA_PROCESSING_UNAVAILABLE",
          PROCESSING_UNAVAILABLE_MESSAGE,
        );
      }

      return finalizeAiReply({
        deps: resolvedDeps,
        organizationId: access.organizationId,
        storeId: access.storeId,
        conversationId: conversation.id,
      });
    }

    const existingTranscript = String(persistedMessageMetadata.audio_transcript || "").trim();

    if (existingTranscript) {
      return finalizeAiReply({
        deps: resolvedDeps,
        organizationId: access.organizationId,
        storeId: access.storeId,
        conversationId: conversation.id,
      });
    }

    let transcriptionResult: Awaited<ReturnType<typeof transcribeCustomerAudioFromStorage>>;

    try {
      transcriptionResult = await resolvedDeps.transcribeCustomerAudio({
        supabase,
        bucket: STORAGE_BUCKET,
        storagePath,
        fileName: fileEntry.name,
        mimeType: fileEntry.type,
      });
    } catch {
      return createPublicError(
        409,
        "SIMULATE_CUSTOMER_MEDIA_PROCESSING_UNAVAILABLE",
        PROCESSING_UNAVAILABLE_MESSAGE,
      );
    }

    if (!transcriptionResult.ok) {
      try {
        await updateMessageMetadata({
          supabase,
          messageId,
          conversationId: conversation.id,
          metadata: {
            ...persistedMessageMetadata,
            transcription_status: "failed",
            transcription_provider: transcriptionResult.provider,
            transcription_model: transcriptionResult.model,
            transcription_error: transcriptionResult.error,
          },
        });
      } catch {}

      return createPublicError(
        409,
        "SIMULATE_CUSTOMER_MEDIA_PROCESSING_UNAVAILABLE",
        PROCESSING_UNAVAILABLE_MESSAGE,
      );
    }

    try {
      const { error: metadataUpdateError } = await updateMessageMetadata({
        supabase,
        messageId,
        conversationId: conversation.id,
        metadata: {
          ...persistedMessageMetadata,
          audio_transcript: transcriptionResult.transcript,
          transcription_status: "succeeded",
          transcription_provider: transcriptionResult.provider,
          transcription_model: transcriptionResult.model,
          transcription_error: null,
          transcription_completed_at: new Date().toISOString(),
        },
      });

      if (metadataUpdateError) {
        return createPublicError(
          409,
          "SIMULATE_CUSTOMER_MEDIA_PROCESSING_UNAVAILABLE",
          PROCESSING_UNAVAILABLE_MESSAGE,
        );
      }
    } catch {
      return createPublicError(
        409,
        "SIMULATE_CUSTOMER_MEDIA_PROCESSING_UNAVAILABLE",
        PROCESSING_UNAVAILABLE_MESSAGE,
      );
    }

    return finalizeAiReply({
      deps: resolvedDeps,
      organizationId: access.organizationId,
      storeId: access.storeId,
      conversationId: conversation.id,
    });
  };
}

export const POST = createSimulateCustomerMediaPostHandler();
