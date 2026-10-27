import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const STORAGE_BUCKET = "zion-store-files";
const WHATSAPP_GRAPH_API_VERSION =
  process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0";
const DEFAULT_WHATSAPP_INBOUND_MEDIA_MAX_BYTES = 16 * 1024 * 1024;
const MIN_WHATSAPP_INBOUND_MEDIA_MAX_BYTES = 1 * 1024 * 1024;
const MAX_WHATSAPP_INBOUND_MEDIA_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_WHATSAPP_INBOUND_MEDIA_DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_WHATSAPP_INBOUND_MEDIA_DOWNLOAD_TIMEOUT_MS = 120_000;
const GENERIC_MEDIA_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
]);
const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/aac",
  "audio/amr",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/webm",
  "audio/x-wav",
  "audio/3gpp",
  "audio/3gpp2",
]);

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
  fetchImpl?: typeof fetch;
  downloadTimeoutMs?: number;
};

export type WhatsappInboundMediaErrorCode =
  | "WHATSAPP_MEDIA_TOO_LARGE"
  | "WHATSAPP_MEDIA_DOWNLOAD_TIMEOUT"
  | "WHATSAPP_MEDIA_DOWNLOAD_INTERRUPTED"
  | "WHATSAPP_MEDIA_BODY_MISSING"
  | "WHATSAPP_MEDIA_HASH_INVALID"
  | "WHATSAPP_MEDIA_HASH_MISMATCH"
  | "WHATSAPP_AUDIO_MIME_INVALID"
  | "WHATSAPP_AUDIO_FORMAT_INVALID"
  | "WHATSAPP_MEDIA_ALREADY_EXISTS"
  | "WHATSAPP_MEDIA_EXISTING_VALIDATION_FAILED";

export class WhatsappInboundMediaError extends Error {
  constructor(
    public readonly code: WhatsappInboundMediaErrorCode,
    message?: string,
  ) {
    super(message || code);
    this.name = "WhatsappInboundMediaError";
  }
}

export type DownloadAndStoreWhatsappInboundMediaResult = {
  storageBucket: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  originalFileName: string;
  sha256: string | null;
  reusedExisting: boolean;
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
  if (mimeType === "audio/aac") return "aac";
  if (mimeType === "audio/amr") return "amr";
  if (mimeType === "audio/mpeg") return "mp3";
  if (mimeType === "audio/mp4") return "m4a";
  if (mimeType === "audio/ogg") return "ogg";
  if (mimeType === "audio/webm") return "webm";
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") return "wav";
  if (mimeType === "audio/opus") return "opus";
  if (mimeType === "audio/3gpp" || mimeType === "audio/3gpp2") return "amr";
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
  mediaId: string;
  fileName: string;
}) {
  const stableMediaId = sanitizeFileName(args.mediaId).slice(0, 160);
  const safeFileName = sanitizeFileName(args.fileName);

  return [
    args.organizationId,
    args.storeId,
    "whatsapp-inbound",
    args.conversationId,
    `${stableMediaId}-${safeFileName}`,
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

function getWhatsappInboundMediaDownloadTimeoutMs(value?: number) {
  if (!Number.isFinite(value) || Number(value) <= 0) {
    return DEFAULT_WHATSAPP_INBOUND_MEDIA_DOWNLOAD_TIMEOUT_MS;
  }

  return Math.min(
    MAX_WHATSAPP_INBOUND_MEDIA_DOWNLOAD_TIMEOUT_MS,
    Math.max(1, Math.floor(Number(value))),
  );
}

function assertWhatsappInboundMediaSize(sizeBytes: number, maxBytes = getWhatsappInboundMediaMaxBytes()) {
  if (sizeBytes > maxBytes) {
    throw new WhatsappInboundMediaError("WHATSAPP_MEDIA_TOO_LARGE");
  }
}

function isSha256(value: string) {
  return /^[0-9a-f]{64}$/i.test(value);
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function detectAudioMimeType(bytes: Uint8Array) {
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") {
    return "audio/wav";
  }
  if (ascii(bytes, 0, 4) === "OggS") return "audio/ogg";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return "audio/webm";
  }
  if (ascii(bytes, 0, 6) === "#!AMR\n") return "audio/amr";
  if (ascii(bytes, 0, 3) === "ID3") return "audio/mpeg";
  if (ascii(bytes, 4, 4) === "ftyp") return "audio/mp4";
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return (bytes[1] & 0x06) === 0 ? "audio/aac" : "audio/mpeg";
  }
  return null;
}

function resolveAudioMimeType(args: { declaredMimeType: string; bytes: Uint8Array }) {
  const declared = normalizeMimeType(args.declaredMimeType);
  const detected = detectAudioMimeType(args.bytes);

  if (!detected) {
    throw new WhatsappInboundMediaError("WHATSAPP_AUDIO_FORMAT_INVALID");
  }
  if (!GENERIC_MEDIA_MIME_TYPES.has(declared) && !ALLOWED_AUDIO_MIME_TYPES.has(declared)) {
    throw new WhatsappInboundMediaError("WHATSAPP_AUDIO_MIME_INVALID");
  }

  const compatible =
    GENERIC_MEDIA_MIME_TYPES.has(declared) ||
    declared === detected ||
    (declared === "audio/x-wav" && detected === "audio/wav") ||
    (declared === "audio/opus" && detected === "audio/ogg") ||
    ((declared === "audio/3gpp" || declared === "audio/3gpp2") && detected === "audio/amr");

  if (!compatible) {
    throw new WhatsappInboundMediaError("WHATSAPP_AUDIO_FORMAT_INVALID");
  }

  return detected;
}

async function fetchMetaMediaMetadata(args: {
  accessToken: string;
  mediaId: string;
  fetchImpl?: typeof fetch;
}): Promise<MetaMediaMetadataResponse> {
  const response = await (args.fetchImpl || fetch)(
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
      Number.isSafeInteger(payloadRecord.file_size) &&
      payloadRecord.file_size >= 0
        ? payloadRecord.file_size
        : undefined,
  };
}

async function downloadMetaMediaBinary(args: {
  accessToken: string;
  mediaUrl: string;
  maxBytes: number;
  timeoutMs: number;
  expectedSha256?: string;
  fetchImpl?: typeof fetch;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
  const fetchImpl = args.fetchImpl || fetch;

  try {
    let response: Response;
    try {
      response = await fetchImpl(args.mediaUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${args.accessToken}` },
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) {
        throw new WhatsappInboundMediaError("WHATSAPP_MEDIA_DOWNLOAD_TIMEOUT");
      }
      throw new WhatsappInboundMediaError(
        "WHATSAPP_MEDIA_DOWNLOAD_INTERRUPTED",
      );
    }

    if (!response.ok) {
      throw new Error(
        `Falha HTTP ${response.status} ao baixar binario da media na Meta`
      );
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isSafeInteger(contentLength) && contentLength > args.maxBytes) {
      throw new WhatsappInboundMediaError("WHATSAPP_MEDIA_TOO_LARGE");
    }
    if (!response.body) {
      throw new WhatsappInboundMediaError("WHATSAPP_MEDIA_BODY_MISSING");
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    const hash = createHash("sha256");
    let sizeBytes = 0;

    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const bytes = chunk.value instanceof Uint8Array
          ? chunk.value
          : new Uint8Array(chunk.value);
        sizeBytes += bytes.byteLength;
        if (sizeBytes > args.maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new WhatsappInboundMediaError("WHATSAPP_MEDIA_TOO_LARGE");
        }
        hash.update(bytes);
        chunks.push(bytes);
      }
    } catch (error) {
      if (error instanceof WhatsappInboundMediaError) throw error;
      if (controller.signal.aborted) {
        throw new WhatsappInboundMediaError("WHATSAPP_MEDIA_DOWNLOAD_TIMEOUT");
      }
      throw new WhatsappInboundMediaError(
        "WHATSAPP_MEDIA_DOWNLOAD_INTERRUPTED",
      );
    }

    const sha256 = hash.digest("hex");
    if (args.expectedSha256 && sha256 !== args.expectedSha256) {
      throw new WhatsappInboundMediaError("WHATSAPP_MEDIA_HASH_MISMATCH");
    }
    const bytes = new Uint8Array(sizeBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      bytes,
      sha256,
      contentType: normalizeMimeType(response.headers.get("content-type")),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function removeWhatsappInboundStoredMedia(args: {
  supabase: SupabaseClient;
  storagePath: string;
}) {
  await args.supabase.storage.from(STORAGE_BUCKET).remove([args.storagePath]);
}

async function readAndValidateExistingWhatsappMedia(args: {
  supabase: SupabaseClient;
  storagePath: string;
  mediaKind: WhatsappInboundMediaKind;
  declaredMimeType: string;
  mimeType: string;
  originalFileName: string;
  expectedSha256?: string;
  maxBytes: number;
}) {
  const storage = args.supabase.storage.from(STORAGE_BUCKET);
  if (typeof storage.download !== "function") return null;

  const { data, error } = await storage.download(args.storagePath);
  if (error || !data) return null;

  const bytes = new Uint8Array(await data.arrayBuffer());
  assertWhatsappInboundMediaSize(bytes.byteLength, args.maxBytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (args.expectedSha256 && sha256 !== args.expectedSha256) {
    throw new WhatsappInboundMediaError("WHATSAPP_MEDIA_HASH_MISMATCH");
  }
  const mimeType = args.mediaKind === "audio"
    ? resolveAudioMimeType({ declaredMimeType: args.declaredMimeType, bytes })
    : args.mimeType;

  return {
    storageBucket: STORAGE_BUCKET,
    storagePath: args.storagePath,
    mimeType,
    sizeBytes: bytes.byteLength,
    originalFileName: args.originalFileName,
    sha256,
    reusedExisting: true,
  } satisfies DownloadAndStoreWhatsappInboundMediaResult;
}

export async function downloadAndStoreWhatsappInboundMedia(
  args: DownloadAndStoreWhatsappInboundMediaInput
): Promise<DownloadAndStoreWhatsappInboundMediaResult> {
  const accessToken = getMetaWhatsappAccessToken();
  const maxBytes = getWhatsappInboundMediaMaxBytes();
  const mediaMetadata = await fetchMetaMediaMetadata({
    accessToken,
    mediaId: args.mediaId,
    fetchImpl: args.fetchImpl,
  });
  if (mediaMetadata.file_size !== undefined) {
    assertWhatsappInboundMediaSize(mediaMetadata.file_size, maxBytes);
  }
  const expectedSha256 = String(mediaMetadata.sha256 || "").trim().toLowerCase();
  if (expectedSha256 && !isSha256(expectedSha256)) {
    throw new WhatsappInboundMediaError("WHATSAPP_MEDIA_HASH_INVALID");
  }
  const mediaUrl = String(mediaMetadata.url || "").trim();

  if (!mediaUrl) {
    throw new Error("Meta nao retornou URL de download para a media.");
  }

  const knownDeclaredMimeType =
    normalizeMimeType(args.preferredMimeType) ||
    normalizeMimeType(mediaMetadata.mime_type) ||
    "application/octet-stream";
  const knownOriginalFileName = buildOriginalFileName({
    mediaKind: args.mediaKind,
    mimeType: knownDeclaredMimeType,
    preferredFileName: args.preferredFileName,
    fallbackBaseName: args.fallbackBaseName,
  });
  const knownStoragePath = buildStoragePath({
    organizationId: args.organizationId,
    storeId: args.storeId,
    conversationId: args.conversationId,
    mediaId: args.mediaId,
    fileName: knownOriginalFileName,
  });
  const existingBeforeDownload = await readAndValidateExistingWhatsappMedia({
    supabase: args.supabase,
    storagePath: knownStoragePath,
    mediaKind: args.mediaKind,
    declaredMimeType: knownDeclaredMimeType,
    mimeType: knownDeclaredMimeType,
    originalFileName: knownOriginalFileName,
    expectedSha256: expectedSha256 || undefined,
    maxBytes,
  });
  if (existingBeforeDownload) return existingBeforeDownload;

  const downloaded = await downloadMetaMediaBinary({
    accessToken,
    mediaUrl,
    maxBytes,
    timeoutMs: getWhatsappInboundMediaDownloadTimeoutMs(args.downloadTimeoutMs),
    expectedSha256: expectedSha256 || undefined,
    fetchImpl: args.fetchImpl,
  });

  const declaredMimeType =
    normalizeMimeType(args.preferredMimeType) ||
    normalizeMimeType(mediaMetadata.mime_type) ||
    downloaded.contentType ||
    "application/octet-stream";
  const mimeType = args.mediaKind === "audio"
    ? resolveAudioMimeType({ declaredMimeType, bytes: downloaded.bytes })
    : declaredMimeType;

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
    mediaId: args.mediaId,
    fileName: originalFileName,
  });

  const { error } = await args.supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, downloaded.bytes, {
      upsert: false,
      contentType: mimeType,
    });

  if (error) {
    if (/already exists|duplicate|conflict/i.test(error.message)) {
      const existingAfterConflict = await readAndValidateExistingWhatsappMedia({
        supabase: args.supabase,
        storagePath,
        mediaKind: args.mediaKind,
        declaredMimeType,
        mimeType,
        originalFileName,
        expectedSha256: expectedSha256 || undefined,
        maxBytes,
      });
      if (existingAfterConflict) return existingAfterConflict;
      throw new WhatsappInboundMediaError("WHATSAPP_MEDIA_EXISTING_VALIDATION_FAILED");
    }
    throw new Error(`Falha ao salvar media recebida no Storage: ${error.message}`);
  }

  return {
    storageBucket: STORAGE_BUCKET,
    storagePath,
    mimeType,
    sizeBytes: downloaded.bytes.byteLength,
    originalFileName,
    sha256: downloaded.sha256,
    reusedExisting: false,
  };
}
