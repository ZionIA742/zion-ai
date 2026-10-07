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
  materializeManualAttachmentMessage,
  normalizeManualAttachmentMimeType,
  readManualAttachmentAuthorization,
  type ServiceSupabaseClient,
} from "@/lib/server/manual-attachment-contract";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SendManualAttachmentDeps = {
  resolveStoreAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createServiceSupabaseClient: () => ServiceSupabaseClient;
  isRealWhatsappConversation: Parameters<typeof materializeManualAttachmentMessage>[0]["isRealWhatsappConversation"];
  readFileBytes: (file: File) => Promise<Buffer>;
};

function createJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function createInvalidFormDataResponse() {
  return createJsonResponse({ ok: false, error: "INVALID_FORM_DATA", message: "Nao foi possivel ler os dados do anexo enviado." }, 400);
}

function messageFromRpc(value: unknown) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value && typeof value === "object" ? value : null;
}

async function defaultReadFileBytes(file: File) {
  return Buffer.from(await file.arrayBuffer());
}

export async function handleSendManualAttachmentPost(
  request: Request,
  deps: SendManualAttachmentDeps = {
    resolveStoreAccess: resolveStoreApiAccess,
    createServiceSupabaseClient,
    isRealWhatsappConversation: undefined,
    readFileBytes: defaultReadFileBytes,
  },
) {
  try {
    const access = await deps.resolveStoreAccess({ requirement: "active" });
    if (!access.ok) return createStoreApiDeniedResponse(access);

    let formData: FormData;
    try { formData = await request.formData(); } catch { return createInvalidFormDataResponse(); }

    const conversationId = String(formData.get("conversationId") || "").trim();
    const rawContent = String(formData.get("content") || "").trim();
    const fileEntry = formData.get("file");
    if (!conversationId) return createJsonResponse({ ok: false, error: "MISSING_FIELDS", message: "Envie conversationId e file." }, 400);
    if (!(fileEntry instanceof File)) return createJsonResponse({ ok: false, error: "FILE_REQUIRED", message: "Selecione um arquivo valido para envio." }, 400);
    if (fileEntry.size <= 0) return createJsonResponse({ ok: false, error: "EMPTY_FILE", message: "O arquivo enviado esta vazio." }, 400);
    if (fileEntry.size > MANUAL_ATTACHMENT_MAX_FILE_SIZE_BYTES) return createJsonResponse({ ok: false, error: "FILE_TOO_LARGE", message: "O anexo deve ter no maximo 10 MB." }, 400);

    const mimeType = normalizeManualAttachmentMimeType(fileEntry.type);
    const messageType = classifyManualAttachmentMimeType(mimeType);
    if (!messageType) return createJsonResponse({ ok: false, error: "UNSUPPORTED_FILE_TYPE", message: "Tipo de arquivo nao suportado para envio manual." }, 415);

    const supabase = deps.createServiceSupabaseClient();
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
      fileName: fileEntry.name,
    });
    const content = rawContent || defaultManualAttachmentContent(messageType);
    const unsignedAuthorization = {
      uploadId,
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      conversationId: scope.conversationId,
      leadId: scope.leadId,
      path,
      fileName: fileEntry.name,
      mimeType,
      sizeBytes: fileEntry.size,
      messageType,
      content,
      idempotencyKey: `crm_manual_attachment:${uploadId}`,
      expiresAt: Date.now() + 10 * 60 * 1000,
    } as const;
    // Compatibility requests generate a fresh key per request. Strong replay
    // idempotency is provided by the authorize/finalize flow.
    const authorization = readManualAttachmentAuthorization(
      createManualAttachmentAuthorization(unsignedAuthorization),
    );

    const fileBytes = await deps.readFileBytes(fileEntry);
    const uploadResult = await supabase.storage.from(MANUAL_ATTACHMENT_STORAGE_BUCKET).upload(path, fileBytes, {
      upsert: false,
      contentType: mimeType,
    });
    if (uploadResult.error) return createJsonResponse({ ok: false, error: "MEDIA_UPLOAD_FAILED", message: "Nao foi possivel enviar o anexo agora." }, 500);

    let rpc: Awaited<ReturnType<typeof materializeManualAttachmentMessage>>["rpc"];
    try {
      ({ rpc } = await materializeManualAttachmentMessage({
        supabase,
        authorization,
        sessionUserId: access.sessionUserId,
        isRealWhatsappConversation: deps.isRealWhatsappConversation,
      }));
    } catch {
      // The Storage object is deliberately preserved: an ambiguous RPC may
      // race with a concurrent winner that already references this object.
      return createJsonResponse({ ok: false, error: "INSERT_MANUAL_ATTACHMENT_FAILED", message: "O anexo foi enviado, mas nao foi possivel registrar a mensagem." }, 500);
    }
    if (rpc.error) return createJsonResponse({ ok: false, error: "INSERT_MANUAL_ATTACHMENT_FAILED", message: "O anexo foi enviado, mas nao foi possivel registrar a mensagem." }, 500);
    const result = messageFromRpc(rpc.data) as { message_id?: string; replayed?: boolean; id?: string } | null;
    return createJsonResponse({
      ok: true,
      messageId: result?.message_id ?? result?.id ?? null,
      messageType,
      attachmentKind: messageType === "document" ? "file" : messageType,
      ...(result?.replayed === true ? { replayed: true } : {}),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "SEND_MANUAL_ATTACHMENT_ROUTE_FAILED";
    if (code === "conversation_not_found_or_forbidden") return createJsonResponse({ ok: false, error: "CONVERSATION_NOT_FOUND_OR_FORBIDDEN" }, 404);
    if (code === "lead_not_found_or_forbidden") return createJsonResponse({ ok: false, error: "LEAD_NOT_FOUND_OR_FORBIDDEN" }, 404);
    if (code === "conversation_lookup_failed") return createJsonResponse({ ok: false, error: "CONVERSATION_LOOKUP_FAILED", message: "Nao foi possivel validar a conversa informada." }, 500);
    if (code === "lead_lookup_failed") return createJsonResponse({ ok: false, error: "LEAD_LOOKUP_FAILED", message: "Nao foi possivel validar o lead da conversa informada." }, 500);
    return createJsonResponse({ ok: false, error: "SEND_MANUAL_ATTACHMENT_ROUTE_FAILED", message: "Erro interno ao enviar anexo manual." }, 500);
  }
}

export async function POST(request: Request) {
  return handleSendManualAttachmentPost(request);
}
