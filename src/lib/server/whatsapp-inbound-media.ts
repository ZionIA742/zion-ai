import type { SupabaseClient } from "@supabase/supabase-js";

const STORAGE_BUCKET = "zion-store-files";
const WHATSAPP_GRAPH_API_VERSION =
  process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0";
const DEFAULT_WHATSAPP_INBOUND_MEDIA_MAX_BYTES = 16 * 1024 * 1024;
const MIN_WHATSAPP_INBOUND_MEDIA_MAX_BYTES = 1 * 1024 * 1024;
const MAX_WHATSAPP_INBOUND_MEDIA_MAX_BYTES = 64 * 1024 * 1024;

type MetaMediaMetadataResponse = {
  url?: string;
  mime_type?: string;
  sha256?: string;
  file_size?: number;
};

export type WhatsappInboundMediaKind =
  | "image"
  | "audio"
  | "video"
  | "document";

export type DownloadAndStoreWhatsappInboundMediaInput = {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  conversationId: string;
  mediaId: string;
  mediaKind: WhatsappInboundMediaKind;
  preferredMimeType?: string | null;
  preferredFileName?: string | null;
  fallbackBaseName?: string | null;
};

export type DownloadAndStoreWhatsappInboundMediaResult = {
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

function getFileExtensionFromMimeType(value: string | null | undefined) {
  const mimeType = normalizeMimeType(value);

  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "audio/mpeg") return "mp3";
  if (mimeType === "audio/mp4") return "m4a";
  if (mimeType === "audio/ogg") return "ogg";
  if (mimeType === "audio/webm") return "webm";
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") return "wav";
  if (mimeType === "video/mp4") return "mp4";
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "video/quicktime") return "mov";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "application/msword") return "doc";
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (mimeType === "application/vnd.ms-excel") return "xls";
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return "xlsx";
  }
  if (mimeType === "application/vnd.ms-powerpoint") return "ppt";
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return "pptx";
  }

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

function buildDefaultBaseName(kind: WhatsappInboundMediaKind) {
  if (kind === "audio") return "whatsapp-audio";
  if (kind === "video") return "whatsapp-video";
  if (kind === "document") return "whatsapp-document";
  return "whatsapp-image";
}

function buildOriginalFileName(args: {
  mediaKind: WhatsappInboundMediaKind;
  mimeType: string;
  preferredFileName?: string | null;
  fallbackBaseName?: string | null;
}) {
  const preferred = String(args.preferredFileName || "").trim();
  if (preferred) {
    return sanitizeFileName(preferred);
  }

  const extension = getFileExtensionFromMimeType(args.mimeType);
  const baseName =
    String(args.fallbackBaseName || "").trim() || buildDefaultBaseName(args.mediaKind);

  return sanitizeFileName(`${baseName}.${extension}`);
}

function getWhatsappInboundMediaMaxBytes() {
  const rawValue = Number(process.env.WHATSAPP_INBOUND_MEDIA_MAX_BYTES);

  if (!Number.isFinite(rawValue) || rawValue <= 0) {
    return DEFAULT_WHATSAPP_INBOUND_MEDIA_MAX_BYTES;
  }

  return Math.min(
    MAX_WHATSAPP_INBOUND_MEDIA_MAX_BYTES,
    Math.max(MIN_WHATSAPP_INBOUND_MEDIA_MAX_BYTES, Math.floor(rawValue)),
  );
}

function assertWhatsappInboundMediaSize(sizeBytes: number) {
  if (sizeBytes > getWhatsappInboundMediaMaxBytes()) {
    throw new Error("WHATSAPP_MEDIA_TOO_LARGE");
  }
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
      typeof payloadRecord.mime_type === "string" &&
      payloadRecord.mime_type.trim()
        ? payloadRecord.mime_type.trim()
        : undefined,
    sha256:
      typeof payloadRecord.sha256 === "string" && payloadRecord.sha256.trim()
        ? payloadRecord.sha256.trim()
        : undefined,
    file_size:
      typeof payloadRecord.file_size === "number" &&
      Number.isFinite(payloadRecord.file_size)
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

export async function removeWhatsappInboundStoredMedia(args: {
  supabase: SupabaseClient;
  storagePath: string;
}) {
  await args.supabase.storage.from(STORAGE_BUCKET).remove([args.storagePath]);
}

export async function downloadAndStoreWhatsappInboundMedia(
  args: DownloadAndStoreWhatsappInboundMediaInput
): Promise<DownloadAndStoreWhatsappInboundMediaResult> {
  const accessToken = getMetaWhatsappAccessToken();
  const mediaMetadata = await fetchMetaMediaMetadata({
    accessToken,
    mediaId: args.mediaId,
  });
  const mediaUrl = String(mediaMetadata.url || "").trim();

  if (!mediaUrl) {
    throw new Error("Meta nao retornou URL de download para a media.");
  }

  const downloaded = await downloadMetaMediaBinary({
    accessToken,
    mediaUrl,
  });
  assertWhatsappInboundMediaSize(downloaded.bytes.byteLength);

  const mimeType =
    normalizeMimeType(args.preferredMimeType) ||
    normalizeMimeType(mediaMetadata.mime_type) ||
    downloaded.contentType ||
    "application/octet-stream";

  const originalFileName = buildOriginalFileName({
    mediaKind: args.mediaKind,
    mimeType,
    preferredFileName: args.preferredFileName,
    fallbackBaseName: args.fallbackBaseName,
  });
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
    throw new Error(`Falha ao salvar media recebida no Storage: ${error.message}`);
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
