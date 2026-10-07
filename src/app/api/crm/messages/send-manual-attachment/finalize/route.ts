import { NextResponse } from "next/server";
import {
  createServiceSupabaseClient,
  isManualAttachmentPathForScope,
  loadManualAttachmentScope,
  materializeManualAttachmentMessage,
  MANUAL_ATTACHMENT_MAX_FILE_SIZE_BYTES,
  MANUAL_ATTACHMENT_STORAGE_BUCKET,
  normalizeManualAttachmentMimeType,
  readManualAttachmentAuthorization,
} from "@/lib/server/manual-attachment-contract";
import { resolveStoreApiAccess } from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FinalizeBody = { authorizationToken?: unknown; path?: unknown; content?: unknown };

function errorResponse(status: number, code: string) {
  return NextResponse.json({ ok: false, error: code }, { status });
}

function messageFromRpc(value: unknown) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value && typeof value === "object" ? value : null;
}

export async function handleManualAttachmentFinalizePost(
  request: Request,
  deps: { resolveAccess?: typeof resolveStoreApiAccess; createServiceClient?: typeof createServiceSupabaseClient } = {},
) {
  const access = await (deps.resolveAccess ?? resolveStoreApiAccess)({ requirement: "active" });
  if (!access.ok) return createStoreApiDeniedResponse(access);
  let body: FinalizeBody;
  try { body = (await request.json()) as FinalizeBody; } catch { return errorResponse(400, "invalid_json"); }

  let authorization;
  try { authorization = readManualAttachmentAuthorization(String(body.authorizationToken || "")); }
  catch { return errorResponse(403, "invalid_upload_authorization"); }

  if (
    authorization.organizationId !== access.organizationId ||
    authorization.storeId !== access.storeId ||
    String(body.path || "") !== authorization.path
  ) return errorResponse(403, "attachment_scope_mismatch");

  let supabase;
  try {
    supabase = (deps.createServiceClient ?? createServiceSupabaseClient)();
    const scope = await loadManualAttachmentScope({
      supabase,
      conversationId: authorization.conversationId,
      organizationId: access.organizationId,
      storeId: access.storeId,
    });
    if (scope.leadId !== authorization.leadId || !isManualAttachmentPathForScope(authorization.path, scope)) {
      return errorResponse(403, "attachment_scope_mismatch");
    }

    const objectInfo = await supabase.storage.from(MANUAL_ATTACHMENT_STORAGE_BUCKET).info(authorization.path);
    if (objectInfo.error || !objectInfo.data) return errorResponse(404, "attachment_object_not_found");
    const objectSize = Number(objectInfo.data.size);
    const objectMime = normalizeManualAttachmentMimeType(
      objectInfo.data.mimetype ?? objectInfo.data.metadata?.mimetype ?? objectInfo.data.metadata?.contentType,
    );
    if (!Number.isInteger(objectSize) || objectSize <= 0 || objectSize > MANUAL_ATTACHMENT_MAX_FILE_SIZE_BYTES || objectSize !== authorization.sizeBytes) {
      return errorResponse(400, "attachment_size_mismatch");
    }
    if (!objectMime || objectMime !== authorization.mimeType) {
      return errorResponse(415, "attachment_mime_mismatch");
    }

    const content = String(body.content || "").trim() || authorization.content;
    if (content !== authorization.content) {
      return errorResponse(400, "attachment_payload_mismatch");
    }
    const { rpc } = await materializeManualAttachmentMessage({
      supabase,
      authorization,
      sessionUserId: access.sessionUserId,
    });
    if (rpc.error) {
      // Storage and PostgreSQL are separate systems. A failed/ambiguous RPC
      // cannot prove that a concurrent transaction will not materialize this
      // exact object, so preserve the private object for controlled cleanup.
      return errorResponse(500, "manual_attachment_finalize_failed");
    }
    const result = messageFromRpc(rpc.data) as { message_id?: string; replayed?: boolean } | null;
    return NextResponse.json({ ok: true, messageId: result?.message_id ?? null, replayed: result?.replayed === true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "manual_attachment_finalize_failed";
    if (code.includes("not_found_or_forbidden")) return errorResponse(403, code);
    return errorResponse(500, "manual_attachment_finalize_failed");
  }
}

export async function POST(request: Request) { return handleManualAttachmentFinalizePost(request); }
