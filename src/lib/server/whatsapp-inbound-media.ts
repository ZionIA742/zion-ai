import type { SupabaseClient } from "@supabase/supabase-js";

const STORAGE_BUCKET = "zion-store-files";
const WHATSAPP_GRAPH_API_VERSION =
  process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0";

type MetaMediaMetadataResponse = {
  url?: string;
  mime_type?: string;
  sha256?: string;
  file_size?: number;
};

export type DownloadAndStoreWhatsappInboundImageInput = {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  conversationId: string;
  mediaId: string;
  preferredMimeType?: string | null;
};

export type DownloadAndStoreWhatsappInboundImageResult = {
  storageBucket: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  originalFileName: string;
  sha256: string | null;
};

function getMetaWhatsappAccessToken(): string {
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN?.trim() || "";
  if (!token) {
    throw new Error("META_WHATSAPP_ACCESS_TOKEN nao esta definido.");
  }

  return token;
}

function normalizeMimeType(value: string | null | undefined) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function getImageExtensionFromMimeType(value: string | null | undefined) {
  const mimeType = normalizeMimeType(value);
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "bin";
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
    "whatsapp-inbound",
    args.conversationId,
    `${timestamp}-${random}-${safeFileName}`,
  ].join("/");
}

async function fetchMetaMediaMetadata(args: {
  accessToken: string;
  mediaId: string;
}): Promise<MetaMediaMetadataResponse> {
  const response = await fetch(
    `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${args.mediaId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
      },
    }
  );

  const payload = (await response.json().catch(() => null)) as
    | MetaMediaMetadataResponse
    | { error?: { message?: string } | null }
    | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error?.message || "").trim()
        : "";
    throw new Error(
      message || `Falha HTTP ${response.status} ao consultar metadata da media na Meta`
    );
  }

  if (!payload || typeof payload !== "object") {
    return {};
  }

  const payloadRecord = payload as Record<string, unknown>;

  return {
    url:
      typeof payloadRecord.url === "string" && payloadRecord.url.trim()
        ? payloadRecord.url.trim()
        : undefined,
    mime_type:
      typeof payloadRecord.mime_type === "string" && payloadRecord.mime_type.trim()
        ? payloadRecord.mime_type.trim()
        : undefined,
    sha256:
      typeof payloadRecord.sha256 === "string" && payloadRecord.sha256.trim()
        ? payloadRecord.sha256.trim()
        : undefined,
    file_size:
      typeof payloadRecord.file_size === "number" && Number.isFinite(payloadRecord.file_size)
        ? payloadRecord.file_size
        : undefined,
  };
}

async function downloadMetaMediaBinary(args: {
  accessToken: string;
  mediaUrl: string;
}) {
  const response = await fetch(args.mediaUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Falha HTTP ${response.status} ao baixar binario da media na Meta`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    bytes: new Uint8Array(arrayBuffer),
    contentType: normalizeMimeType(response.headers.get("content-type")),
  };
}

export async function removeWhatsappInboundStoredImage(args: {
  supabase: SupabaseClient;
  storagePath: string;
}) {
  await args.supabase.storage.from(STORAGE_BUCKET).remove([args.storagePath]);
}

export async function downloadAndStoreWhatsappInboundImage(
  args: DownloadAndStoreWhatsappInboundImageInput
): Promise<DownloadAndStoreWhatsappInboundImageResult> {
  const accessToken = getMetaWhatsappAccessToken();
  const mediaMetadata = await fetchMetaMediaMetadata({
    accessToken,
    mediaId: args.mediaId,
  });
  const mediaUrl = String(mediaMetadata.url || "").trim();

  if (!mediaUrl) {
    throw new Error("Meta nao retornou URL de download para a imagem.");
  }

  const downloaded = await downloadMetaMediaBinary({
    accessToken,
    mediaUrl,
  });

  const mimeType =
    normalizeMimeType(args.preferredMimeType) ||
    normalizeMimeType(mediaMetadata.mime_type) ||
    downloaded.contentType ||
    "image/jpeg";

  const extension = getImageExtensionFromMimeType(mimeType);
  const originalFileName = `whatsapp-image.${extension}`;
  const storagePath = buildStoragePath({
    organizationId: args.organizationId,
    storeId: args.storeId,
    conversationId: args.conversationId,
    fileName: originalFileName,
  });

  const { error } = await args.supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, downloaded.bytes, {
      upsert: false,
      contentType: mimeType,
    });

  if (error) {
    throw new Error(`Falha ao salvar imagem recebida no Storage: ${error.message}`);
  }

  return {
    storageBucket: STORAGE_BUCKET,
    storagePath,
    mimeType,
    sizeBytes: downloaded.bytes.byteLength,
    originalFileName,
    sha256: String(mediaMetadata.sha256 || "").trim() || null,
  };
}
