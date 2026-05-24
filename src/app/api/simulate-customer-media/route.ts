import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

function isAllowedImageMimeType(value: string | null | undefined) {
  return ALLOWED_IMAGE_MIME_TYPES.has(String(value || "").trim().toLowerCase());
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

    if (!isAllowedImageMimeType(fileEntry.type)) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_FILE_TYPE",
          message: "Envie uma imagem JPEG, JPG, PNG ou WEBP.",
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

    const metadata = {
      media_purpose: purpose,
      media_origin: "customer",
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
      original_file_name: fileEntry.name,
      mime_type: fileEntry.type,
      size_bytes: fileEntry.size,
      source_channel: "panel_simulation",
      visual_simulation_status: "received",
      can_be_used_for_recommendation: true,
      can_be_sent_to_customer: false,
      requires_human_review: false,
      pillar: "pilar_10_multimodal",
    };

    const { data: insertData, error: insertError } = await supabase.rpc(
      "insert_message",
      {
        p_conversation_id: conversationId,
        p_sender: "user",
        p_direction: "incoming",
        p_message_type: "image",
        p_content: DEFAULT_CONTENT,
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
          message: "A imagem foi enviada, mas não foi possível registrar a mensagem.",
        },
        { status: 500 }
      );
    }

    const messageId = extractInsertMessageId(insertData);

    return NextResponse.json({
      ok: true,
      messageId,
      organizationId,
      storeId: resolvedStoreId,
      leadId: normalizedLead.id,
      conversationId,
      storageBucket: STORAGE_BUCKET,
      storagePath,
      mediaPurpose: purpose,
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
