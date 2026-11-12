import { NextResponse } from "next/server";
import {
  buildManualAttachmentPath,
  classifyManualAttachmentMimeType,
  createManualAttachmentAuthorization,
  createManualAttachmentUploadId,
  createServiceSupabaseClient,
  defaultManualAttachmentContent,
  loadManualAttachmentScope,
  MANUAL_ATTACHMENT_MAX_FILE_SIZE_BYTES,
  MANUAL_ATTACHMENT_STORAGE_BUCKET,
  normalizeManualAttachmentMimeType,
} from "@/lib/server/manual-attachment-contract";
import { resolveStoreApiAccess } from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthorizeBody = {
  conversationId?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
  content?: unknown;
};

function errorResponse(status: number, code: string) {
  return NextResponse.json({ ok: false, error: code }, { status });
}

export async function handleManualAttachmentAuthorizePost(
  request: Request,
  deps: { resolveAccess?: typeof resolveStoreApiAccess; createServiceClient?: typeof createServiceSupabaseClient } = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const createServiceClient = deps.createServiceClient ?? createServiceSupabaseClient;

  const access = await resolveAccess({ requirement: "active" });
  if (!access.ok) return createStoreApiDeniedResponse(access);

  let body: AuthorizeBody;
  try {
    body = (await request.json()) as AuthorizeBody;
  } catch {
    return errorResponse(400, "invalid_json");
  }

  const conversationId = String(body.conversationId || "").trim();
  const fileName = String(body.fileName || "").trim();
  const mimeType = normalizeManualAttachmentMimeType(body.mimeType);
  const sizeBytes = Number(body.sizeBytes);
  if (!conversationId || !fileName || !mimeType || !Number.isInteger(sizeBytes)) {
    return errorResponse(400, "invalid_attachment_request");
  }
  if (sizeBytes <= 0) return errorResponse(400, "attachment_empty");
  if (sizeBytes > MANUAL_ATTACHMENT_MAX_FILE_SIZE_BYTES) return errorResponse(413, "attachment_too_large");

  const messageType = classifyManualAttachmentMimeType(mimeType);
  if (!messageType) return errorResponse(415, "unsupported_attachment_type");

  let supabase;
  try {
    supabase = createServiceClient();
    const scope = await loadManualAttachmentScope({
      supabase,
      conversationId,
      organizationId: access.organizationId,
      storeId: access.storeId,
    });
    const uploadId = createManualAttachmentUploadId();
    const path = buildManualAttachmentPath({
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      conversationId: scope.conversationId,
      uploadId,
      fileName,
    });
    const content = String(body.content || "").trim() || defaultManualAttachmentContent(messageType);
    const authorizationToken = createManualAttachmentAuthorization({
      uploadId,
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      conversationId: scope.conversationId,
      leadId: scope.leadId,
      path,
      fileName,
      mimeType,
      sizeBytes,
      messageType,
      content,
      idempotencyKey: `crm_manual_attachment:${uploadId}`,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
    const signed = await supabase.storage
      .from(MANUAL_ATTACHMENT_STORAGE_BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    if (signed.error || !signed.data?.token) return errorResponse(502, "signed_upload_unavailable");

    return NextResponse.json({
      ok: true,
      bucket: MANUAL_ATTACHMENT_STORAGE_BUCKET,
      path,
      token: signed.data.token,
      authorizationToken,
      messageType,
      mimeType,
      sizeBytes,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "manual_attachment_authorization_failed";
    if (code === "conversation_not_found_or_forbidden" || code === "lead_not_found_or_forbidden") {
      return errorResponse(403, code);
    }
    if (code === "conversation_lookup_failed" || code === "lead_lookup_failed") {
      return errorResponse(502, code);
    }
    return errorResponse(500, "manual_attachment_authorization_failed");
  }
}

export async function POST(request: Request) {
  return handleManualAttachmentAuthorizePost(request);
}
