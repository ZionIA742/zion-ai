import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORAGE_BUCKET = "zion-store-files";
const SIGNED_URL_EXPIRATION_SECONDS = 60;

type MessageRow = {
  id: string;
  organization_id: string;
  store_id: string | null;
  conversation_id: string | null;
  lead_id: string | null;
  message_type: string | null;
  media_url: string | null;
  metadata: Record<string, unknown> | null;
};

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

type MembershipRow = {
  organization_id: string;
};

type StoreRow = {
  id: string;
  organization_id: string;
};

type AttachmentKind = "image" | "audio" | "video" | "file";

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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function normalizeMessageType(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function normalizeAttachmentKind(value: unknown): AttachmentKind | null {
  const normalized = String(value || "").trim().toLowerCase();

  if (
    normalized === "image" ||
    normalized === "audio" ||
    normalized === "video" ||
    normalized === "file"
  ) {
    return normalized;
  }

  return null;
}

function resolveAttachmentKind(
  messageType: string,
  metadata: Record<string, unknown> | null
) {
  const metadataAttachmentKind = normalizeAttachmentKind(metadata?.attachment_kind);
  if (metadataAttachmentKind) {
    return metadataAttachmentKind;
  }

  if (messageType === "image" || messageType === "audio" || messageType === "video") {
    return messageType;
  }

  return null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ messageId: string }> }
) {
  try {
    const { messageId: rawMessageId } = await context.params;
    const messageId = String(rawMessageId || "").trim();

    if (!messageId) {
      return buildJsonResponse(
        {
          ok: false,
          error: "MISSING_MESSAGE_ID",
          message: "Message ID nao informado na rota.",
        },
        400
      );
    }

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

    const supabase = createSupabaseAdminClient();

    const { data: message, error: messageError } = await supabase
      .from("messages")
      .select(
        "id, organization_id, store_id, conversation_id, lead_id, message_type, media_url, metadata"
      )
      .eq("id", messageId)
      .maybeSingle<MessageRow>();

    if (messageError) {
      return buildJsonResponse(
        {
          ok: false,
          error: "LOAD_MESSAGE_FAILED",
          message: messageError.message,
        },
        500
      );
    }

    if (!message) {
      return buildJsonResponse(
        {
          ok: false,
          error: "MESSAGE_NOT_FOUND",
          message: "Mensagem nao encontrada.",
        },
        404
      );
    }

    const metadata = isObjectRecord(message.metadata) ? message.metadata : null;
    const mediaPurpose = String(metadata?.media_purpose || "").trim().toLowerCase();
    const storageBucket = String(metadata?.storage_bucket || "").trim();
    const metadataStoragePath = String(metadata?.storage_path || "").trim();
    const mediaUrl = String(message.media_url || "").trim();
    const messageType = normalizeMessageType(message.message_type);
    const attachmentKind = resolveAttachmentKind(messageType, metadata);
    const mimeType = String(metadata?.mime_type || "").trim() || null;
    const fileName = String(metadata?.original_file_name || "").trim() || null;
    const storagePath =
      metadataStoragePath ||
      (storageBucket === STORAGE_BUCKET && mediaUrl && !/^https?:\/\//i.test(mediaUrl)
        ? mediaUrl
        : "");
    const isLegacyCustomerLocationPhoto =
      messageType === "image" && mediaPurpose === "customer_location_photo";
    const isSupportedPrivateAttachment =
      attachmentKind === "image" ||
      attachmentKind === "audio" ||
      attachmentKind === "video" ||
      attachmentKind === "file" ||
      messageType === "image" ||
      messageType === "audio" ||
      messageType === "video";

    if (
      storageBucket !== STORAGE_BUCKET ||
      !storagePath ||
      (!isLegacyCustomerLocationPhoto && !isSupportedPrivateAttachment)
    ) {
      return buildJsonResponse(
        {
          ok: false,
          error: "INVALID_MEDIA_MESSAGE",
          message:
            "A mensagem informada nao possui um anexo privado valido para visualizacao segura.",
        },
        422
      );
    }

    const conversationId = String(message.conversation_id || "").trim();

    if (!conversationId) {
      return buildJsonResponse(
        {
          ok: false,
          error: "MESSAGE_RELATION_INCONSISTENT",
          message: "A mensagem nao possui conversa valida vinculada.",
        },
        403
      );
    }

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id, organization_id, lead_id")
      .eq("id", conversationId)
      .maybeSingle<ConversationRow>();

    if (conversationError) {
      return buildJsonResponse(
        {
          ok: false,
          error: "LOAD_CONVERSATION_FAILED",
          message: conversationError.message,
        },
        500
      );
    }

    if (!conversation) {
      return buildJsonResponse(
        {
          ok: false,
          error: "CONVERSATION_NOT_FOUND",
          message: "Conversa vinculada a mensagem nao encontrada.",
        },
        403
      );
    }

    const leadId = String(message.lead_id || conversation.lead_id || "").trim();

    if (!leadId) {
      return buildJsonResponse(
        {
          ok: false,
          error: "LEAD_RELATION_INCONSISTENT",
          message: "Nao foi possivel identificar o lead vinculado a mensagem.",
        },
        403
      );
    }

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, organization_id, store_id")
      .eq("id", leadId)
      .maybeSingle<LeadRow>();

    if (leadError) {
      return buildJsonResponse(
        {
          ok: false,
          error: "LOAD_LEAD_FAILED",
          message: leadError.message,
        },
        500
      );
    }

    if (!lead) {
      return buildJsonResponse(
        {
          ok: false,
          error: "LEAD_NOT_FOUND",
          message: "Lead vinculado a mensagem nao encontrado.",
        },
        403
      );
    }

    const conversationOrganizationId = String(conversation.organization_id || "").trim();
    const messageOrganizationId = String(message.organization_id || "").trim();
    const leadOrganizationId = String(lead.organization_id || "").trim();
    const messageStoreId = String(message.store_id || "").trim();
    const leadStoreId = String(lead.store_id || "").trim();

    if (
      !conversationOrganizationId ||
      !messageOrganizationId ||
      !leadOrganizationId ||
      messageOrganizationId !== conversationOrganizationId ||
      leadOrganizationId !== conversationOrganizationId
    ) {
      return buildJsonResponse(
        {
          ok: false,
          error: "RELATION_SCOPE_INCONSISTENT",
          message: "Os vinculos internos da mensagem estao inconsistentes para visualizacao segura.",
        },
        403
      );
    }

    if (leadStoreId && messageStoreId && leadStoreId !== messageStoreId) {
      return buildJsonResponse(
        {
          ok: false,
          error: "STORE_SCOPE_INCONSISTENT",
          message: "Os vinculos de loja da mensagem estao inconsistentes para visualizacao segura.",
        },
        403
      );
    }

    const { data: membership, error: membershipError } = await sessionSupabase
      .from("memberships")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("organization_id", leadOrganizationId)
      .maybeSingle<MembershipRow>();

    if (membershipError) {
      return buildJsonResponse(
        {
          ok: false,
          error: "LOAD_MEMBERSHIP_FAILED",
          message: membershipError.message,
        },
        500
      );
    }

    if (!membership) {
      return buildJsonResponse(
        {
          ok: false,
          error: "FORBIDDEN_ORGANIZATION",
          message: "Voce nao pode acessar anexos desta organizacao.",
        },
        403
      );
    }

    const scopedStoreId = leadStoreId || messageStoreId;

    if (scopedStoreId) {
      const { data: store, error: storeError } = await sessionSupabase
        .from("stores")
        .select("id, organization_id")
        .eq("id", scopedStoreId)
        .eq("organization_id", leadOrganizationId)
        .maybeSingle<StoreRow>();

      if (storeError) {
        return buildJsonResponse(
          {
            ok: false,
            error: "LOAD_STORE_FAILED",
            message: storeError.message,
          },
          500
        );
      }

      if (!store) {
        return buildJsonResponse(
          {
            ok: false,
            error: "FORBIDDEN_STORE",
            message: "A loja vinculada ao anexo nao pertence a esta organizacao.",
          },
          403
        );
      }
    }

    const { data: signedData, error: signedError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_EXPIRATION_SECONDS);

    if (signedError || !signedData?.signedUrl) {
      return buildJsonResponse(
        {
          ok: false,
          error: "SIGNED_URL_GENERATION_FAILED",
          message:
            signedError?.message ||
            "Nao foi possivel gerar o link temporario deste anexo.",
        },
        500
      );
    }

    return buildJsonResponse({
      ok: true,
      signedUrl: signedData.signedUrl,
      mimeType,
      attachmentKind,
      fileName,
      expiresInSeconds: SIGNED_URL_EXPIRATION_SECONDS,
    });
  } catch (error: any) {
    return buildJsonResponse(
      {
        ok: false,
        error: "UNEXPECTED_ERROR",
        message: error?.message || "Erro inesperado ao gerar a visualizacao segura do anexo.",
      },
      500
    );
  }
}
