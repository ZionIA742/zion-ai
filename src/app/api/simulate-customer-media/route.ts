import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { classifyIncomingMediaMessage } from "@/lib/server/media-classification";
import { generateAndSaveAiSalesReply } from "@/lib/server/generate-and-save-ai-sales-reply";
import { analyzeCustomerLocationPhotoFromStorage } from "@/lib/server/analyze-customer-location-photo";
import { transcribeCustomerAudioFromStorage } from "@/lib/server/transcribe-customer-audio";

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
const ALLOWED_PURPOSES = new Set([
  "customer_location_photo",
  "customer_product_photo",
  "payment_receipt",
  "screenshot",
  "operational_image",
  "unknown",
]);
const DEFAULT_PURPOSE = "customer_location_photo";
const DEFAULT_CONTENT = "Cliente enviou uma foto do local.";
const GENERIC_ATTACHMENT_CONTENT = "Cliente enviou um anexo.";

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

type PersistedMessageRow = {
  id: string;
  metadata: Record<string, unknown> | null;
};

function isInternalRequestAuthorized(req: Request) {
  const secretFromEnv = process.env.AI_INTERNAL_ROUTE_SECRET;
  const secretFromHeader =
    req.headers.get("x-zion-internal-secret") ||
    req.headers.get("x-internal-secret") ||
    "";
  const nodeEnv = process.env.NODE_ENV || "development";

  if (nodeEnv !== "production") {
    return {
      ok: true,
      mode: "dev_bypass" as const,
    };
  }

  if (!secretFromEnv) {
    return {
      ok: false,
      mode: "missing_env_secret" as const,
    };
  }

  if (secretFromHeader !== secretFromEnv) {
    return {
      ok: false,
      mode: "invalid_header_secret" as const,
    };
  }

  return {
    ok: true,
    mode: "authorized_by_secret" as const,
  };
}

function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente."
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey);
}

function normalizeMimeType(value: string | null | undefined) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function isCustomerLocationPhotoPurpose(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase() === "customer_location_photo";
}

function isAllowedImageMimeType(value: string | null | undefined) {
  return ALLOWED_IMAGE_MIME_TYPES.has(normalizeMimeType(value));
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

function buildStoragePath(args: {
  organizationId: string;
  storeId: string;
  leadId: string;
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
    "customer-media",
    args.leadId,
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

export async function POST(req: Request) {
  let uploadedStoragePath: string | null = null;

  try {
    const auth = isInternalRequestAuthorized(req);

    if (!auth.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "UNAUTHORIZED_INTERNAL_ROUTE",
          message:
            "Acesso interno não autorizado. Verifique AI_INTERNAL_ROUTE_SECRET e o header x-zion-internal-secret.",
        },
        { status: 401 }
      );
    }

    const formData = await req.formData();

    const organizationId = String(formData.get("organizationId") || "").trim();
    const requestedStoreId = String(formData.get("storeId") || "").trim();
    const conversationId = String(formData.get("conversationId") || "").trim();
    const purpose = String(formData.get("purpose") || DEFAULT_PURPOSE).trim();
    const fileEntry = formData.get("file");

    if (!organizationId || !conversationId || !(fileEntry instanceof File)) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_FIELDS",
          message: "Envie organizationId, conversationId e file.",
        },
        { status: 400 }
      );
    }

    if (!ALLOWED_PURPOSES.has(purpose)) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_MEDIA_PURPOSE",
          message: "purpose inválido para esta rota de teste controlado.",
        },
        { status: 400 }
      );
    }

    const attachmentKind = getAttachmentKindFromMimeType(fileEntry.type);

    if (!attachmentKind) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_FILE_TYPE",
          message:
            "Envie um anexo suportado: imagem, video, audio, PDF, Word, Excel ou PowerPoint.",
        },
        { status: 400 }
      );
    }

    if (fileEntry.size <= 0 || fileEntry.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_FILE_SIZE",
          message: "A imagem deve ter no máximo 10 MB.",
        },
        { status: 400 }
      );
    }

    const messageType = attachmentKind;
    const defaultContent =
      attachmentKind === "image" ? DEFAULT_CONTENT : GENERIC_ATTACHMENT_CONTENT;

    const supabase = createSupabaseAdminClient();

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id, organization_id, lead_id")
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (conversationError) {
      return NextResponse.json(
        {
          ok: false,
          error: "CONVERSATION_LOOKUP_FAILED",
          message: conversationError.message,
        },
        { status: 400 }
      );
    }

    if (!conversation) {
      return NextResponse.json(
        {
          ok: false,
          error: "CONVERSATION_NOT_FOUND_OR_FORBIDDEN",
          message: "Conversa não encontrada para a organização informada.",
        },
        { status: 404 }
      );
    }

    const normalizedConversation = conversation as ConversationRow;

    if (!normalizedConversation.lead_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "CONVERSATION_WITHOUT_LEAD",
          message: "A conversa não possui lead vinculada.",
        },
        { status: 400 }
      );
    }

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, organization_id, store_id")
      .eq("id", normalizedConversation.lead_id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (leadError) {
      return NextResponse.json(
        {
          ok: false,
          error: "LEAD_LOOKUP_FAILED",
          message: leadError.message,
        },
        { status: 400 }
      );
    }

    if (!lead) {
      return NextResponse.json(
        {
          ok: false,
          error: "LEAD_NOT_FOUND_OR_FORBIDDEN",
          message: "Lead não encontrada para a conversa informada.",
        },
        { status: 404 }
      );
    }

    const normalizedLead = lead as LeadRow;
    const resolvedStoreId = String(normalizedLead.store_id || "").trim();

    if (!resolvedStoreId) {
      return NextResponse.json(
        {
          ok: false,
          error: "LEAD_STORE_ID_MISSING",
          message: "store_id não encontrado para este lead.",
        },
        { status: 400 }
      );
    }

    if (requestedStoreId && requestedStoreId !== resolvedStoreId) {
      return NextResponse.json(
        {
          ok: false,
          error: "STORE_ID_MISMATCH",
          message: "O storeId informado não corresponde ao store_id real da lead.",
        },
        { status: 400 }
      );
    }

    const storagePath = buildStoragePath({
      organizationId,
      storeId: resolvedStoreId,
      leadId: normalizedLead.id,
      conversationId,
      fileName: fileEntry.name,
    });

    uploadedStoragePath = storagePath;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, fileEntry, {
        upsert: false,
        contentType: fileEntry.type || undefined,
      });

    if (uploadError) {
      return NextResponse.json(
        {
          ok: false,
          error: "MEDIA_UPLOAD_FAILED",
          message: uploadError.message,
        },
        { status: 500 }
      );
    }

    const classification = classifyIncomingMediaMessage({
      messageType,
      mimeType: fileEntry.type,
      fileName: fileEntry.name,
      content: defaultContent,
      explicitPurpose: purpose,
      sender: "user",
      direction: "incoming",
      sourceChannel: "panel_simulation",
    });
    const isCustomerLocationPhoto =
      attachmentKind === "image" &&
      (isCustomerLocationPhotoPurpose(classification.mediaPurpose) ||
        isCustomerLocationPhotoPurpose(purpose));

    const metadata = {
      media_purpose: purpose,
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
      ...(isCustomerLocationPhoto
        ? {
            visual_analysis_status: "pending",
            visual_analysis_error: null,
          }
        : {}),
    };

    const { data: insertData, error: insertError } = await supabase.rpc(
      "insert_message",
      {
        p_conversation_id: conversationId,
        p_sender: "user",
        p_direction: "incoming",
        p_message_type: messageType,
        p_content: defaultContent,
        p_external_message_id: null,
        p_media_url: storagePath,
        p_metadata: metadata,
      }
    );

    if (insertError) {
      const { error: cleanupError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([storagePath]);

      if (cleanupError) {
        console.error("[simulate-customer-media] cleanup after insert_message failed:", {
          storagePath,
          message: cleanupError.message,
        });
      }

      return NextResponse.json(
        {
          ok: false,
          error: "INSERT_CUSTOMER_MEDIA_MESSAGE_FAILED",
          message: "O anexo foi enviado, mas nao foi possivel registrar a mensagem.",
        },
        { status: 500 }
      );
    }

    const messageId = extractInsertMessageId(insertData);
    const shouldTranscribeAudio = attachmentKind === "audio";
    const shouldAnalyzeLocationPhoto = isCustomerLocationPhoto;

    if (!shouldTranscribeAudio && !shouldAnalyzeLocationPhoto) {
      return NextResponse.json({
        ok: true,
        customerMessageSaved: true,
        aiReplySaved: false,
        messageId,
        organizationId,
        storeId: resolvedStoreId,
        leadId: normalizedLead.id,
        conversationId,
        storageBucket: STORAGE_BUCKET,
        storagePath,
        mediaPurpose: purpose,
      });
    }

    if (!messageId) {
      return NextResponse.json({
        ok: true,
        customerMessageSaved: true,
        aiReplySaved: false,
        ...(shouldTranscribeAudio
          ? {
              transcriptionStatus: "failed",
              message:
                "Audio salvo com sucesso, mas a transcricao nao pode continuar porque o ID da mensagem nao foi retornado.",
            }
          : {
              visualAnalysisStatus: "failed",
              message:
                "Imagem salva com sucesso, mas a analise visual nao pode continuar porque o ID da mensagem nao foi retornado.",
            }),
        messageId: null,
        organizationId,
        storeId: resolvedStoreId,
        leadId: normalizedLead.id,
        conversationId,
        storageBucket: STORAGE_BUCKET,
        storagePath,
        mediaPurpose: purpose,
      });
    }

    const { data: persistedMessage, error: persistedMessageError } = await supabase
      .from("messages")
      .select("id, metadata")
      .eq("id", messageId)
      .eq("conversation_id", conversationId)
      .maybeSingle<PersistedMessageRow>();

    const persistedMetadata =
      persistedMessage?.metadata && typeof persistedMessage.metadata === "object"
        ? persistedMessage.metadata
        : metadata;
    const persistedMetadataRecord = persistedMetadata as Record<string, unknown>;

    if (persistedMessageError) {
      console.error("[simulate-customer-media] failed to load persisted media message:", {
        messageId,
        conversationId,
        error: persistedMessageError.message,
      });
    }

    if (shouldAnalyzeLocationPhoto) {
      const existingLocationPhotoAnalysis =
        persistedMetadataRecord.location_photo_analysis &&
        typeof persistedMetadataRecord.location_photo_analysis === "object"
          ? (persistedMetadataRecord.location_photo_analysis as Record<string, unknown>)
          : null;
      const existingVisualSummary = String(
        existingLocationPhotoAnalysis?.summary || ""
      ).trim();
      const existingVisualStatus = String(
        persistedMetadataRecord.visual_analysis_status || ""
      ).trim();

      if (existingVisualSummary || existingVisualStatus === "succeeded") {
        const aiResult = await generateAndSaveAiSalesReply({
          organizationId,
          storeId: resolvedStoreId,
          conversationId,
        });

        return NextResponse.json({
          ok: true,
          customerMessageSaved: true,
          aiReplySaved: aiResult.ok,
          messageId,
          organizationId,
          storeId: resolvedStoreId,
          leadId: normalizedLead.id,
          conversationId,
          storageBucket: STORAGE_BUCKET,
          storagePath,
          mediaPurpose: purpose,
          visualAnalysisStatus: "succeeded",
          aiText: aiResult.ok ? aiResult.aiText : null,
          aiError: aiResult.ok ? null : aiResult.error,
          aiMessage: aiResult.ok ? null : aiResult.message,
        });
      }

      const visualAnalysisResult = await analyzeCustomerLocationPhotoFromStorage({
        supabase,
        bucket: STORAGE_BUCKET,
        storagePath,
        fileName: fileEntry.name,
        mimeType: fileEntry.type,
      });

      if (!visualAnalysisResult.ok) {
        const failedMetadata = {
          ...persistedMetadata,
          visual_analysis_status: "failed",
          visual_analysis_provider: visualAnalysisResult.provider,
          visual_analysis_model: visualAnalysisResult.model,
          visual_analysis_error: visualAnalysisResult.message,
          visual_analysis_completed_at: new Date().toISOString(),
        };

        const { error: failedUpdateError } = await supabase
          .from("messages")
          .update({
            metadata: failedMetadata,
          })
          .eq("id", messageId)
          .eq("conversation_id", conversationId);

        if (failedUpdateError) {
          console.error("[simulate-customer-media] failed to persist visual analysis error:", {
            messageId,
            conversationId,
            error: failedUpdateError.message,
          });
        }

        return NextResponse.json({
          ok: true,
          customerMessageSaved: true,
          aiReplySaved: false,
          messageId,
          organizationId,
          storeId: resolvedStoreId,
          leadId: normalizedLead.id,
          conversationId,
          storageBucket: STORAGE_BUCKET,
          storagePath,
          mediaPurpose: purpose,
          visualAnalysisStatus: "failed",
          message:
            "Foto do local salva com sucesso, mas a analise visual falhou e a IA nao respondeu nesta tentativa.",
        });
      }

      const succeededMetadata = {
        ...persistedMetadata,
        location_photo_analysis: visualAnalysisResult.analysis,
        visual_analysis_status: "succeeded",
        visual_analysis_provider: visualAnalysisResult.provider,
        visual_analysis_model: visualAnalysisResult.model,
        visual_analysis_error: null,
        visual_analysis_completed_at: new Date().toISOString(),
      };

      const { error: succeededUpdateError } = await supabase
        .from("messages")
        .update({
          metadata: succeededMetadata,
        })
        .eq("id", messageId)
        .eq("conversation_id", conversationId);

      if (succeededUpdateError) {
        console.error("[simulate-customer-media] failed to persist visual analysis metadata:", {
          messageId,
          conversationId,
          error: succeededUpdateError.message,
        });

        return NextResponse.json({
          ok: true,
          customerMessageSaved: true,
          aiReplySaved: false,
          messageId,
          organizationId,
          storeId: resolvedStoreId,
          leadId: normalizedLead.id,
          conversationId,
          storageBucket: STORAGE_BUCKET,
          storagePath,
          mediaPurpose: purpose,
          visualAnalysisStatus: "failed",
          message:
            "Foto do local foi salva, mas a analise visual nao conseguiu ser persistida e a IA nao respondeu.",
        });
      }

      const aiResult = await generateAndSaveAiSalesReply({
        organizationId,
        storeId: resolvedStoreId,
        conversationId,
      });

      return NextResponse.json({
        ok: true,
        customerMessageSaved: true,
        aiReplySaved: aiResult.ok,
        messageId,
        organizationId,
        storeId: resolvedStoreId,
        leadId: normalizedLead.id,
        conversationId,
        storageBucket: STORAGE_BUCKET,
        storagePath,
        mediaPurpose: purpose,
        visualAnalysisStatus: "succeeded",
        aiText: aiResult.ok ? aiResult.aiText : null,
        aiError: aiResult.ok ? null : aiResult.error,
        aiMessage: aiResult.ok ? null : aiResult.message,
      });
    }

    if (String(persistedMetadataRecord.audio_transcript || "").trim()) {
      const aiResult = await generateAndSaveAiSalesReply({
        organizationId,
        storeId: resolvedStoreId,
        conversationId,
      });

      return NextResponse.json({
        ok: true,
        customerMessageSaved: true,
        aiReplySaved: aiResult.ok,
        messageId,
        organizationId,
        storeId: resolvedStoreId,
        leadId: normalizedLead.id,
        conversationId,
        storageBucket: STORAGE_BUCKET,
        storagePath,
        mediaPurpose: purpose,
        aiText: aiResult.ok ? aiResult.aiText : null,
        transcriptionStatus: "succeeded",
      });
    }

    const transcriptionResult = await transcribeCustomerAudioFromStorage({
      supabase,
      bucket: STORAGE_BUCKET,
      storagePath,
      fileName: fileEntry.name,
      mimeType: fileEntry.type,
    });

    if (!transcriptionResult.ok) {
      const failedMetadata = {
        ...persistedMetadata,
        transcription_status: "failed",
        transcription_provider: transcriptionResult.provider,
        transcription_model: transcriptionResult.model,
        transcription_error: transcriptionResult.message,
      };

      const { error: failedUpdateError } = await supabase
        .from("messages")
        .update({
          metadata: failedMetadata,
        })
        .eq("id", messageId)
        .eq("conversation_id", conversationId);

      if (failedUpdateError) {
        console.error("[simulate-customer-media] failed to persist audio transcription error:", {
          messageId,
          conversationId,
          error: failedUpdateError.message,
        });
      }

      return NextResponse.json({
        ok: true,
        customerMessageSaved: true,
        aiReplySaved: false,
        messageId,
        organizationId,
        storeId: resolvedStoreId,
        leadId: normalizedLead.id,
        conversationId,
        storageBucket: STORAGE_BUCKET,
        storagePath,
        mediaPurpose: purpose,
        transcriptionStatus: "failed",
        message:
          "Audio do cliente salvo com sucesso, mas a transcricao falhou e a IA nao respondeu nesta tentativa.",
      });
    }

    const succeededMetadata = {
      ...persistedMetadata,
      audio_transcript: transcriptionResult.transcript,
      transcription_status: "succeeded",
      transcription_provider: transcriptionResult.provider,
      transcription_model: transcriptionResult.model,
      transcription_error: null,
      transcription_completed_at: new Date().toISOString(),
    };

    const { error: succeededUpdateError } = await supabase
      .from("messages")
      .update({
        metadata: succeededMetadata,
      })
      .eq("id", messageId)
      .eq("conversation_id", conversationId);

    if (succeededUpdateError) {
      console.error("[simulate-customer-media] failed to persist audio transcript metadata:", {
        messageId,
        conversationId,
        error: succeededUpdateError.message,
      });

      return NextResponse.json({
        ok: true,
        customerMessageSaved: true,
        aiReplySaved: false,
        messageId,
        organizationId,
        storeId: resolvedStoreId,
        leadId: normalizedLead.id,
        conversationId,
        storageBucket: STORAGE_BUCKET,
        storagePath,
        mediaPurpose: purpose,
        transcriptionStatus: "failed",
        message:
          "Audio do cliente foi salvo, mas a transcricao nao conseguiu ser persistida e a IA nao respondeu.",
      });
    }

    const aiResult = await generateAndSaveAiSalesReply({
      organizationId,
      storeId: resolvedStoreId,
      conversationId,
    });

    return NextResponse.json({
      ok: true,
      customerMessageSaved: true,
      aiReplySaved: aiResult.ok,
      messageId,
      organizationId,
      storeId: resolvedStoreId,
      leadId: normalizedLead.id,
      conversationId,
      storageBucket: STORAGE_BUCKET,
      storagePath,
      mediaPurpose: purpose,
      transcriptionStatus: "succeeded",
      aiText: aiResult.ok ? aiResult.aiText : null,
      aiError: aiResult.ok ? null : aiResult.error,
      aiMessage: aiResult.ok ? null : aiResult.message,
    });
  } catch (err: any) {
    if (uploadedStoragePath) {
      try {
        const supabase = createSupabaseAdminClient();
        await supabase.storage.from(STORAGE_BUCKET).remove([uploadedStoragePath]);
      } catch (cleanupError) {
        console.error("[simulate-customer-media] cleanup after unexpected error failed:", {
          storagePath: uploadedStoragePath,
          cleanupError,
        });
      }
    }

    return NextResponse.json(
      {
        ok: false,
        error: "SIMULATE_CUSTOMER_MEDIA_ROUTE_FAILED",
        message:
          err?.message || "Erro interno ao registrar foto do local do cliente.",
      },
      { status: 500 }
    );
  }
}
