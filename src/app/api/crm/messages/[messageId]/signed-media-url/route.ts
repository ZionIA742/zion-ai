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
const POOL_PHOTOS_BUCKET = "pool-photos";
const STORE_CATALOG_PHOTOS_BUCKET = "store-catalog-photos";
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

type AttachmentKind = "image" | "audio" | "video" | "file";

type SignedMediaRouteDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createPrivilegedClient: () => ReturnType<typeof createClient>;
};

function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variaveis de ambiente.",
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
  metadata: Record<string, unknown> | null,
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

export function createSignedMediaUrlGetHandler(
  deps: Partial<SignedMediaRouteDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const createPrivilegedClient =
    deps.createPrivilegedClient ?? createSupabaseAdminClient;

  return async function GET(
    _request: Request,
    context: { params: Promise<{ messageId: string }> },
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
          400,
        );
      }

      const access = await resolveAccess({
        requirement: "active",
      });

      if (!access.ok) {
        return createStoreApiDeniedResponse(access);
      }

      const organizationId = access.organizationId;
      const storeId = access.storeId;
      const supabase = createPrivilegedClient();

      const { data: message, error: messageError } = await supabase
        .from("messages")
        .select(
          "id, organization_id, store_id, conversation_id, lead_id, message_type, media_url, metadata",
        )
        .eq("id", messageId)
        .eq("organization_id", organizationId)
        .maybeSingle<MessageRow>();

      if (messageError) {
        return buildJsonResponse(
          {
            ok: false,
            error: "LOAD_MESSAGE_FAILED",
            message: "Nao foi possivel carregar a mensagem.",
          },
          500,
        );
      }

      if (!message) {
        return buildJsonResponse(
          {
            ok: false,
            error: "MESSAGE_NOT_FOUND",
            message: "Mensagem nao encontrada.",
          },
          404,
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
      const isCatalogProductPhoto =
        messageType === "image" && mediaPurpose === "catalog_product_photo";
      const isSupportedPrivateAttachment =
        attachmentKind === "image" ||
        attachmentKind === "audio" ||
        attachmentKind === "video" ||
        attachmentKind === "file" ||
        messageType === "image" ||
        messageType === "audio" ||
        messageType === "video";

      if (
        (!isCatalogProductPhoto && storageBucket !== STORAGE_BUCKET) ||
        !storagePath ||
        (!isLegacyCustomerLocationPhoto && !isCatalogProductPhoto && !isSupportedPrivateAttachment)
      ) {
        return buildJsonResponse(
          {
            ok: false,
            error: "INVALID_MEDIA_MESSAGE",
            message:
              "A mensagem informada nao possui um anexo privado valido para visualizacao segura.",
          },
          422,
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
          403,
        );
      }

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
            error: "LOAD_CONVERSATION_FAILED",
            message: "Nao foi possivel validar a conversa.",
          },
          500,
        );
      }

      if (!conversation) {
        return buildJsonResponse(
          {
            ok: false,
            error: "CONVERSATION_NOT_FOUND",
            message: "Conversa vinculada a mensagem nao encontrada.",
          },
          403,
        );
      }

      const conversationLeadId = String(conversation.lead_id || "").trim();
      const messageLeadId = String(message.lead_id || "").trim();

      if (!conversationLeadId || (messageLeadId && messageLeadId !== conversationLeadId)) {
        return buildJsonResponse(
          {
            ok: false,
            error: "LEAD_RELATION_INCONSISTENT",
            message: "Os vinculos de lead da mensagem estao inconsistentes para visualizacao segura.",
          },
          403,
        );
      }

      const leadId = conversationLeadId;

      if (!leadId) {
        return buildJsonResponse(
          {
            ok: false,
            error: "LEAD_RELATION_INCONSISTENT",
            message: "Nao foi possivel identificar o lead vinculado a mensagem.",
          },
          403,
        );
      }

      const { data: lead, error: leadError } = await supabase
        .from("leads")
        .select("id, organization_id, store_id")
        .eq("id", leadId)
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .maybeSingle<LeadRow>();

      if (leadError) {
        return buildJsonResponse(
          {
            ok: false,
            error: "LOAD_LEAD_FAILED",
            message: "Nao foi possivel validar o lead.",
          },
          500,
        );
      }

      if (!lead) {
        return buildJsonResponse(
          {
            ok: false,
            error: "LEAD_NOT_FOUND",
            message: "Lead vinculado a mensagem nao encontrado.",
          },
          403,
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
        messageOrganizationId !== organizationId ||
        conversationOrganizationId !== organizationId ||
        leadOrganizationId !== organizationId
      ) {
        return buildJsonResponse(
          {
            ok: false,
            error: "RELATION_SCOPE_INCONSISTENT",
            message: "Os vinculos internos da mensagem estao inconsistentes para visualizacao segura.",
          },
          403,
        );
      }

      if (isCatalogProductPhoto) {
        if (storageBucket !== POOL_PHOTOS_BUCKET && storageBucket !== STORE_CATALOG_PHOTOS_BUCKET) {
          return buildJsonResponse(
            { ok: false, error: "INVALID_MEDIA_MESSAGE", message: "A lineage da foto de catalogo nao e valida." },
            422,
          );
        }

        const targetType = String(metadata?.target_type || "").trim().toLowerCase();
        if (storageBucket === POOL_PHOTOS_BUCKET) {
          const poolId = String(metadata?.pool_id || "").trim();
          const photoId = String(metadata?.catalog_photo_id || "").trim();
          if (targetType !== "pool" || !poolId || !photoId) {
            return buildJsonResponse({ ok: false, error: "INVALID_MEDIA_MESSAGE", message: "A lineage da piscina nao e valida." }, 422);
          }
          const { data: pool, error: poolError } = await supabase
            .from("pools")
            .select("id, organization_id, store_id")
            .eq("id", poolId)
            .eq("organization_id", organizationId)
            .eq("store_id", storeId)
            .maybeSingle();
          if (poolError) return buildJsonResponse({ ok: false, error: "LOAD_CATALOG_SOURCE_FAILED", message: "Nao foi possivel validar a origem do catalogo." }, 500);
          if (
            !pool ||
            pool.id !== poolId ||
            pool.organization_id !== organizationId ||
            pool.store_id !== storeId
          ) return buildJsonResponse({ ok: false, error: "CATALOG_SOURCE_NOT_FOUND", message: "Piscina do catalogo nao encontrada." }, 403);
          let photoQuery = supabase
            .from("pool_photos")
            .select("id, pool_id, organization_id, store_id, storage_path")
            .eq("pool_id", poolId)
            .eq("organization_id", organizationId)
            .eq("store_id", storeId)
            .eq("storage_path", storagePath);
          photoQuery = photoQuery.eq("id", photoId);
          const { data: photo, error: photoError } = await photoQuery.maybeSingle();
          if (photoError) return buildJsonResponse({ ok: false, error: "LOAD_CATALOG_PHOTO_FAILED", message: "Nao foi possivel validar a foto do catalogo." }, 500);
          if (
            !photo ||
            photo.id !== photoId ||
            photo.pool_id !== poolId ||
            photo.organization_id !== organizationId ||
            photo.store_id !== storeId ||
            photo.storage_path !== storagePath
          ) {
            return buildJsonResponse({ ok: false, error: "CATALOG_PHOTO_LINEAGE_MISMATCH", message: "A foto da piscina nao pertence ao escopo canonico." }, 403);
          }
        } else {
          const itemId = String(metadata?.catalog_item_id || "").trim();
          const photoId = String(metadata?.catalog_photo_id || "").trim();
          if (targetType !== "catalog_item" || !itemId || !photoId) {
            return buildJsonResponse({ ok: false, error: "INVALID_MEDIA_MESSAGE", message: "A lineage do produto do catalogo nao e valida." }, 422);
          }
          const { data: item, error: itemError } = await supabase
            .from("store_catalog_items")
            .select("id, organization_id, store_id")
            .eq("id", itemId)
            .eq("organization_id", organizationId)
            .eq("store_id", storeId)
            .maybeSingle();
          if (itemError) return buildJsonResponse({ ok: false, error: "LOAD_CATALOG_SOURCE_FAILED", message: "Nao foi possivel validar a origem do catalogo." }, 500);
          if (
            !item ||
            item.id !== itemId ||
            item.organization_id !== organizationId ||
            item.store_id !== storeId
          ) return buildJsonResponse({ ok: false, error: "CATALOG_SOURCE_NOT_FOUND", message: "Produto do catalogo nao encontrado." }, 403);
          const { data: photo, error: photoError } = await supabase
            .from("store_catalog_item_photos")
            .select("id, catalog_item_id, storage_path")
            .eq("id", photoId)
            .eq("catalog_item_id", itemId)
            .eq("storage_path", storagePath)
            .maybeSingle();
          if (photoError) return buildJsonResponse({ ok: false, error: "LOAD_CATALOG_PHOTO_FAILED", message: "Nao foi possivel validar a foto do catalogo." }, 500);
          if (!photo || photo.id !== photoId || photo.catalog_item_id !== itemId || photo.storage_path !== storagePath) {
            return buildJsonResponse({ ok: false, error: "CATALOG_PHOTO_LINEAGE_MISMATCH", message: "A foto do produto nao pertence ao escopo canonico." }, 403);
          }
        }
      }

      if (
        (messageStoreId && messageStoreId !== storeId) ||
        !leadStoreId ||
        leadStoreId !== storeId
      ) {
        return buildJsonResponse(
          {
            ok: false,
            error: "STORE_SCOPE_INCONSISTENT",
            message: "Os vinculos de loja da mensagem estao inconsistentes para visualizacao segura.",
          },
          403,
        );
      }

      const expectedPathPrefix = `${organizationId}/${storeId}/`;
      if (!isCatalogProductPhoto && !storagePath.startsWith(expectedPathPrefix)) {
        return buildJsonResponse(
          {
            ok: false,
            error: "STORE_SCOPE_INCONSISTENT",
            message: "Os vinculos de loja da mensagem estao inconsistentes para visualizacao segura.",
          },
          403,
        );
      }

      const { data: signedData, error: signedError } = await supabase.storage
        .from(storageBucket)
        .createSignedUrl(storagePath, SIGNED_URL_EXPIRATION_SECONDS);

      if (signedError || !signedData?.signedUrl) {
        return buildJsonResponse(
          {
            ok: false,
            error: "SIGNED_URL_GENERATION_FAILED",
            message:
              "Nao foi possivel gerar o link temporario deste anexo.",
          },
          500,
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
    } catch {
      return buildJsonResponse(
        {
          ok: false,
          error: "UNEXPECTED_ERROR",
          message: "Nao foi possivel gerar a visualizacao segura do anexo.",
        },
        500,
      );
    }
  };
}

export const GET = createSignedMediaUrlGetHandler();
