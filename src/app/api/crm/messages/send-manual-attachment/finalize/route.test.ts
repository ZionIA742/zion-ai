import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createManualAttachmentAuthorization,
  readManualAttachmentAuthorization,
  MANUAL_ATTACHMENT_MAX_FILE_SIZE_BYTES,
  MANUAL_ATTACHMENT_STORAGE_BUCKET,
} from "@/lib/server/manual-attachment-contract";
import { handleManualAttachmentFinalizePost } from "./route";
import type { StoreApiAccessGranted, StoreApiAccessResult } from "@/lib/server/store-api-access";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const scope = {
  organizationId: "org-1",
  storeId: "store-1",
  conversationId: "conversation-1",
  leadId: "lead-1",
};

function access(): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: {} as StoreApiAccessGranted["supabase"],
    resolution: {} as StoreApiAccessGranted["resolution"],
    sessionUserId: "user-1",
    organizationId: scope.organizationId,
    storeId: scope.storeId,
  };
}

function authorization(
  messageType: "image" | "document" | "audio" | "video" = "image",
  overrides: {
    expiresAt?: number;
    organizationId?: string;
    storeId?: string;
    conversationId?: string;
    leadId?: string;
    path?: string;
    idempotencyKey?: string;
  } = {},
) {
  const authorizationScope = {
    organizationId: overrides.organizationId ?? scope.organizationId,
    storeId: overrides.storeId ?? scope.storeId,
    conversationId: overrides.conversationId ?? scope.conversationId,
    leadId: overrides.leadId ?? scope.leadId,
  };
  const path = overrides.path ?? `${authorizationScope.organizationId}/${authorizationScope.storeId}/manual-attachments/${authorizationScope.conversationId}/upload.pdf`;
  return createManualAttachmentAuthorization({
    uploadId: "upload-1",
    ...authorizationScope,
    path,
    fileName: "upload.pdf",
    mimeType: messageType === "image" ? "image/png" : messageType === "document" ? "application/pdf" : `${messageType}/webm`,
    sizeBytes: 12,
    messageType,
    content: "A loja enviou um arquivo.",
    idempotencyKey: overrides.idempotencyKey ?? "crm_manual_attachment:upload-1",
    expiresAt: overrides.expiresAt ?? Date.now() + 60_000,
  });
}

function createSupabase(args: {
  rpcError?: { message: string };
  rpcData?: unknown;
  rpcThrows?: Error;
  removeCalls: string[];
  infoCalls?: string[];
  rpcCalls?: string[];
  rpcPayloads?: Array<Record<string, unknown>>;
  queryCalls?: string[];
  conversation?: { id: string; organization_id: string; lead_id: string | null } | null;
  conversationError?: { message: string };
  lead?: { id: string; organization_id: string; store_id: string | null } | null;
  leadError?: { message: string };
  incomingMessages?: Array<Record<string, unknown>>;
  integrations?: Array<Record<string, unknown>>;
  storageInfo?: { data: { size: number; contentType?: string; metadata?: Record<string, unknown> } | null; error: { message: string } | null };
  storageInfoThrows?: Error;
  whatsapp?: boolean;
}) {
  const conversationRows = [args.conversation === undefined
    ? { id: scope.conversationId, organization_id: scope.organizationId, lead_id: scope.leadId }
    : args.conversation].filter(Boolean) as Array<Record<string, unknown>>;
  const leadRows = [args.lead === undefined
    ? { id: scope.leadId, organization_id: scope.organizationId, store_id: scope.storeId }
    : args.lead].filter(Boolean) as Array<Record<string, unknown>>;
  const incomingMessages = args.incomingMessages ?? (args.whatsapp
    ? [{ id: "incoming-message-1", conversation_id: scope.conversationId, sender: "user", direction: "incoming", metadata: { source: "meta_whatsapp_webhook", channel: "whatsapp", external_channel: "whatsapp" } }]
    : []);
  const integrations = args.integrations ?? (args.whatsapp
    ? [{ id: "integration-1", organization_id: scope.organizationId, store_id: scope.storeId, provider: "whatsapp", is_active: true, status: "active" }]
    : []);
  const storage = {
    info: async (path: string) => {
      args.infoCalls?.push(path);
      if (args.storageInfoThrows) throw args.storageInfoThrows;
      if (args.storageInfo) return args.storageInfo;
      return { data: { size: 12, contentType: "image/png", metadata: {} }, error: null };
    },
    remove: async (paths: string[]) => { args.removeCalls.push(...paths); return { data: null, error: null }; },
  };
  const query = (table: string) => {
    const filters = new Map<string, unknown>();
    const containsFilters = new Map<string, Record<string, unknown>>();
    const records = table === "conversations"
      ? conversationRows
      : table === "leads"
        ? leadRows
        : table === "messages"
          ? incomingMessages
          : table === "external_integrations"
            ? integrations
            : [];
    const matches = (record: Record<string, unknown>) => {
      for (const [column, value] of filters) if (record[column] !== value) return false;
      for (const [column, expected] of containsFilters) {
        const actual = record[column];
        if (!actual || typeof actual !== "object") return false;
        for (const [key, value] of Object.entries(expected)) {
          if ((actual as Record<string, unknown>)[key] !== value) return false;
        }
      }
      return true;
    };
    const filteredRecords = () => records.filter(matches).slice(0, 1);
    const queryResult = () => table === "messages" || table === "external_integrations"
      ? { data: filteredRecords(), error: null }
      : { data: [], error: null };
    const builder = {
      select: (columns: string) => { args.queryCalls?.push(`${table}.select:${columns}`); return builder; },
      eq: (column: string, value: unknown) => { filters.set(column, value); args.queryCalls?.push(`${table}.eq:${column}=${String(value)}`); return builder; },
      contains: (column: string, value: unknown) => { containsFilters.set(column, value as Record<string, unknown>); args.queryCalls?.push(`${table}.contains:${column}=${JSON.stringify(value)}`); return builder; },
      limit: (value: number) => { args.queryCalls?.push(`${table}.limit:${value}`); return builder; },
      maybeSingle: async () => table === "conversations"
        ? { data: filteredRecords()[0] ?? null, error: args.conversationError ?? null }
        : table === "leads"
          ? { data: filteredRecords()[0] ?? null, error: args.leadError ?? null }
          : { data: null, error: null },
      then: (resolve: (value: { data: unknown[]; error: { message: string } | null }) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(queryResult()).then(resolve, reject),
    };
    return builder;
  };
  return {
    from: (table: string) => table === MANUAL_ATTACHMENT_STORAGE_BUCKET ? storage : query(table),
    storage: { from: () => storage },
    rpc: async (name: string, payload: Record<string, unknown>) => {
      args.rpcCalls?.push(name);
      args.rpcPayloads?.push(payload);
      if (args.rpcThrows) throw args.rpcThrows;
      return args.rpcError
        ? { data: null, error: args.rpcError }
        : { data: args.rpcData ?? [{ message_id: "message-1", replayed: false }], error: null };
    },
  };
}

function authorizationWithInvalidFingerprint(token: string) {
  const [encoded] = token.split(".");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;
  payload.payloadFingerprint = "0".repeat(64);
  const tamperedEncoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY || "")
    .update(tamperedEncoded)
    .digest("base64url");
  return `${tamperedEncoded}.${signature}`;
}

async function assertInvalidAuthorization(
  response: Response,
  calls: { infoCalls: string[]; rpcCalls: string[] },
) {
  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.deepEqual(payload, { ok: false, error: "invalid_upload_authorization" });
  assert.deepEqual(calls.infoCalls, []);
  assert.deepEqual(calls.rpcCalls, []);
}

async function run(
  body: Record<string, unknown>,
  supabase: ReturnType<typeof createSupabase>,
  resolveAccess: () => Promise<StoreApiAccessResult> = async () => access(),
) {
  return handleManualAttachmentFinalizePost(
    new Request("http://localhost", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    { resolveAccess, createServiceClient: () => supabase as never },
  );
}

function validBody(token = authorization(), path = `${scope.organizationId}/${scope.storeId}/manual-attachments/${scope.conversationId}/upload.pdf`) {
  return { authorizationToken: token, path };
}

function assertNoAuthorizationArtifacts(payload: Record<string, unknown>) {
  assert.equal("authorizationToken" in payload, false);
  assert.equal("token" in payload, false);
  assert.equal("path" in payload, false);
  assert.equal("messageId" in payload, false);
}

function assertNoRpc(calls: { rpcCalls: string[] }) {
  assert.deepEqual(calls.rpcCalls, []);
}

function assertNoStorageOrRpc(calls: { infoCalls: string[]; rpcCalls: string[]; removeCalls?: string[] }) {
  assert.deepEqual(calls.infoCalls, []);
  assert.deepEqual(calls.rpcCalls, []);
  assert.deepEqual(calls.removeCalls ?? [], []);
}

const mismatchRemovals: string[] = [];
const mismatchResponse = await run(
  { authorizationToken: authorization(), path: `${scope.organizationId}/${scope.storeId}/manual-attachments/${scope.conversationId}/upload.pdf`, content: "different" },
  createSupabase({ removeCalls: mismatchRemovals }),
);
assert.equal(mismatchResponse.status, 400);
assert.deepEqual(mismatchRemovals, []);

const rpcRemovals: string[] = [];
const rpcResponse = await run(
  { authorizationToken: authorization(), path: `${scope.organizationId}/${scope.storeId}/manual-attachments/${scope.conversationId}/upload.pdf` },
  createSupabase({ rpcError: { message: "ambiguous failure" }, removeCalls: rpcRemovals }),
);
assert.equal(rpcResponse.status, 500);
assert.deepEqual(rpcRemovals, []);

const invalidSignatureCalls = { infoCalls: [] as string[], rpcCalls: [] as string[] };
const validToken = authorization();
const [validEncoded, validSignature] = validToken.split(".");
const alteredSignature = `${validSignature.slice(0, -1)}${validSignature.endsWith("A") ? "B" : "A"}`;
assert.notEqual(alteredSignature, validSignature);
const invalidSignatureResponse = await run(
  { authorizationToken: `${validEncoded}.${alteredSignature}`, path: `${scope.organizationId}/${scope.storeId}/manual-attachments/${scope.conversationId}/upload.pdf` },
  createSupabase({ removeCalls: [], infoCalls: invalidSignatureCalls.infoCalls, rpcCalls: invalidSignatureCalls.rpcCalls }),
);
await assertInvalidAuthorization(invalidSignatureResponse, invalidSignatureCalls);

const expiredCalls = { infoCalls: [] as string[], rpcCalls: [] as string[] };
const expiredResponse = await run(
  { authorizationToken: authorization("image", { expiresAt: Date.now() - 1 }), path: `${scope.organizationId}/${scope.storeId}/manual-attachments/${scope.conversationId}/upload.pdf` },
  createSupabase({ removeCalls: [], infoCalls: expiredCalls.infoCalls, rpcCalls: expiredCalls.rpcCalls }),
);
await assertInvalidAuthorization(expiredResponse, expiredCalls);

const invalidFingerprintCalls = { infoCalls: [] as string[], rpcCalls: [] as string[] };
const invalidFingerprintResponse = await run(
  { authorizationToken: authorizationWithInvalidFingerprint(validToken), path: `${scope.organizationId}/${scope.storeId}/manual-attachments/${scope.conversationId}/upload.pdf` },
  createSupabase({ removeCalls: [], infoCalls: invalidFingerprintCalls.infoCalls, rpcCalls: invalidFingerprintCalls.rpcCalls }),
);
await assertInvalidAuthorization(invalidFingerprintResponse, invalidFingerprintCalls);

const successRemovals: string[] = [];
const successRpcCalls: string[] = [];
const successResponse = await run(
  { authorizationToken: authorization(), path: `${scope.organizationId}/${scope.storeId}/manual-attachments/${scope.conversationId}/upload.pdf` },
  createSupabase({ removeCalls: successRemovals, rpcCalls: successRpcCalls }),
);
assert.equal(successResponse.status, 200);
assert.deepEqual(successRemovals, []);
assert.deepEqual(successRpcCalls, ["finalize_manual_attachment_message"]);

const otherOrganizationQueries: string[] = [];
const otherOrganizationCalls = { infoCalls: [] as string[], rpcCalls: [] as string[] };
const otherOrganizationRemovals: string[] = [];
const otherOrganizationResponse = await run(
  validBody(),
  createSupabase({
    removeCalls: otherOrganizationRemovals,
    queryCalls: otherOrganizationQueries,
    conversation: { id: scope.conversationId, organization_id: "org-foreign", lead_id: scope.leadId },
    infoCalls: otherOrganizationCalls.infoCalls,
    rpcCalls: otherOrganizationCalls.rpcCalls,
  }),
);
const otherOrganizationPayload = await otherOrganizationResponse.json();
assert.equal(otherOrganizationResponse.status, 403);
assert.deepEqual(otherOrganizationPayload, { ok: false, error: "conversation_not_found_or_forbidden" });
assert.equal(otherOrganizationQueries.includes("conversations.eq:organization_id=org-1"), true);
assertNoAuthorizationArtifacts(otherOrganizationPayload);
assertNoStorageOrRpc({ ...otherOrganizationCalls, removeCalls: otherOrganizationRemovals });

const otherStoreQueries: string[] = [];
const otherStoreCalls = { infoCalls: [] as string[], rpcCalls: [] as string[] };
const otherStoreRemovals: string[] = [];
const otherStoreResponse = await run(
  validBody(),
  createSupabase({
    removeCalls: otherStoreRemovals,
    queryCalls: otherStoreQueries,
    lead: { id: scope.leadId, organization_id: scope.organizationId, store_id: "store-foreign" },
    infoCalls: otherStoreCalls.infoCalls,
    rpcCalls: otherStoreCalls.rpcCalls,
  }),
);
const otherStorePayload = await otherStoreResponse.json();
assert.equal(otherStoreResponse.status, 403);
assert.deepEqual(otherStorePayload, { ok: false, error: "lead_not_found_or_forbidden" });
assert.equal(otherStoreQueries.includes("leads.eq:store_id=store-1"), true);
assertNoAuthorizationArtifacts(otherStorePayload);
assertNoStorageOrRpc({ ...otherStoreCalls, removeCalls: otherStoreRemovals });

const otherOrganizationLeadQueries: string[] = [];
const otherOrganizationLeadCalls = { infoCalls: [] as string[], rpcCalls: [] as string[] };
const otherOrganizationLeadRemovals: string[] = [];
const otherOrganizationLeadResponse = await run(
  validBody(),
  createSupabase({
    removeCalls: otherOrganizationLeadRemovals,
    queryCalls: otherOrganizationLeadQueries,
    lead: { id: scope.leadId, organization_id: "org-foreign", store_id: scope.storeId },
    infoCalls: otherOrganizationLeadCalls.infoCalls,
    rpcCalls: otherOrganizationLeadCalls.rpcCalls,
  }),
);
const otherOrganizationLeadPayload = await otherOrganizationLeadResponse.json();
assert.equal(otherOrganizationLeadResponse.status, 403);
assert.deepEqual(otherOrganizationLeadPayload, { ok: false, error: "lead_not_found_or_forbidden" });
assert.equal(otherOrganizationLeadQueries.includes("leads.eq:organization_id=org-1"), true);
assertNoAuthorizationArtifacts(otherOrganizationLeadPayload);
assertNoStorageOrRpc({ ...otherOrganizationLeadCalls, removeCalls: otherOrganizationLeadRemovals });

const noLeadQueries: string[] = [];
const noLeadCalls = { infoCalls: [] as string[], rpcCalls: [] as string[] };
const noLeadResponse = await run(
  validBody(),
  createSupabase({
    removeCalls: [],
    queryCalls: noLeadQueries,
    conversation: { id: scope.conversationId, organization_id: scope.organizationId, lead_id: null },
    infoCalls: noLeadCalls.infoCalls,
    rpcCalls: noLeadCalls.rpcCalls,
  }),
);
const noLeadPayload = await noLeadResponse.json();
assert.equal(noLeadResponse.status, 403);
assert.deepEqual(noLeadPayload, { ok: false, error: "conversation_not_found_or_forbidden" });
assertNoAuthorizationArtifacts(noLeadPayload);
assertNoStorageOrRpc(noLeadCalls);

const incompatiblePathCalls = { infoCalls: [] as string[], rpcCalls: [] as string[] };
const incompatiblePathToken = authorization("image", { path: `${scope.organizationId}/${scope.storeId}/manual-attachments/another-conversation/upload.pdf` });
const incompatiblePathResponse = await run(
  validBody(incompatiblePathToken, `${scope.organizationId}/${scope.storeId}/manual-attachments/another-conversation/upload.pdf`),
  createSupabase({ removeCalls: [], infoCalls: incompatiblePathCalls.infoCalls, rpcCalls: incompatiblePathCalls.rpcCalls }),
);
const incompatiblePathPayload = await incompatiblePathResponse.json();
assert.equal(incompatiblePathResponse.status, 403);
assert.deepEqual(incompatiblePathPayload, { ok: false, error: "attachment_scope_mismatch" });
assertNoAuthorizationArtifacts(incompatiblePathPayload);
assertNoStorageOrRpc(incompatiblePathCalls);

const incompatibleStorePathCalls = { infoCalls: [] as string[], rpcCalls: [] as string[] };
const incompatibleStorePathToken = authorization("image", { path: `${scope.organizationId}/another-store/manual-attachments/${scope.conversationId}/upload.pdf` });
const incompatibleStorePathResponse = await run(
  validBody(incompatibleStorePathToken, `${scope.organizationId}/another-store/manual-attachments/${scope.conversationId}/upload.pdf`),
  createSupabase({ removeCalls: [], infoCalls: incompatibleStorePathCalls.infoCalls, rpcCalls: incompatibleStorePathCalls.rpcCalls }),
);
const incompatibleStorePathPayload = await incompatibleStorePathResponse.json();
assert.equal(incompatibleStorePathResponse.status, 403);
assert.deepEqual(incompatibleStorePathPayload, { ok: false, error: "attachment_scope_mismatch" });
assertNoAuthorizationArtifacts(incompatibleStorePathPayload);
assertNoStorageOrRpc(incompatibleStorePathCalls);

const deniedCalls = { infoCalls: [] as string[], rpcCalls: [] as string[] };
const deniedResponse = await run(validBody(), createSupabase({ removeCalls: [], infoCalls: deniedCalls.infoCalls, rpcCalls: deniedCalls.rpcCalls }), async () => ({
  ok: false,
  httpStatus: 401,
  resolution: {} as never,
  payload: { ok: false, error: "STORE_API_UNAUTHENTICATED", message: "login", status: "anonymous", reasonCode: "anonymous" } as never,
}));
const deniedPayload = await deniedResponse.json();
assert.equal(deniedResponse.status, 401);
assert.equal(deniedPayload.error, "STORE_API_UNAUTHENTICATED");
assertNoAuthorizationArtifacts(deniedPayload);
assertNoStorageOrRpc(deniedCalls);

const mimeCalls = { infoCalls: [] as string[], rpcCalls: [] as string[] };
const mimeResponse = await run(
  validBody(),
  createSupabase({
    removeCalls: [],
    infoCalls: mimeCalls.infoCalls,
    rpcCalls: mimeCalls.rpcCalls,
    storageInfo: { data: { size: 12, contentType: "image/jpeg", metadata: {} }, error: null },
  }),
);
const mimePayload = await mimeResponse.json();
assert.equal(mimeResponse.status, 415);
assert.deepEqual(mimePayload, { ok: false, error: "attachment_mime_mismatch" });
assertNoAuthorizationArtifacts(mimePayload);
assertNoRpc(mimeCalls);

for (const [name, storageSize] of [["different", 13], ["too-large", MANUAL_ATTACHMENT_MAX_FILE_SIZE_BYTES + 1]] as const) {
  const sizeCalls = { infoCalls: [] as string[], rpcCalls: [] as string[] };
  const sizeResponse = await run(
    validBody(),
    createSupabase({
      removeCalls: [],
      infoCalls: sizeCalls.infoCalls,
      rpcCalls: sizeCalls.rpcCalls,
      storageInfo: { data: { size: storageSize, contentType: "image/png", metadata: {} }, error: null },
    }),
  );
  const sizePayload = await sizeResponse.json();
  assert.equal(sizeResponse.status, 400, name);
  assert.deepEqual(sizePayload, { ok: false, error: "attachment_size_mismatch" }, name);
  assertNoAuthorizationArtifacts(sizePayload);
  assertNoRpc(sizeCalls);
}

for (const storageInfo of [
  { data: null, error: null },
  { data: null, error: { message: "storage unavailable" } },
] as const) {
  const objectCalls = { infoCalls: [] as string[], rpcCalls: [] as string[] };
  const objectResponse = await run(
    validBody(),
    createSupabase({ removeCalls: [], infoCalls: objectCalls.infoCalls, rpcCalls: objectCalls.rpcCalls, storageInfo }),
  );
  const objectPayload = await objectResponse.json();
  assert.equal(objectResponse.status, 404);
  assert.deepEqual(objectPayload, { ok: false, error: "attachment_object_not_found" });
  assertNoAuthorizationArtifacts(objectPayload);
  assertNoRpc(objectCalls);
}

const storageExceptionCalls = { infoCalls: [] as string[], rpcCalls: [] as string[] };
const storageExceptionResponse = await run(
  validBody(),
  createSupabase({
    removeCalls: [],
    infoCalls: storageExceptionCalls.infoCalls,
    rpcCalls: storageExceptionCalls.rpcCalls,
    storageInfoThrows: new Error("storage secret internal detail"),
  }),
);
const storageExceptionPayload = await storageExceptionResponse.json();
assert.equal(storageExceptionResponse.status, 500);
assert.deepEqual(storageExceptionPayload, { ok: false, error: "manual_attachment_finalize_failed" });
assert.equal(JSON.stringify(storageExceptionPayload).includes("storage secret internal detail"), false);
assertNoAuthorizationArtifacts(storageExceptionPayload);
assertNoRpc(storageExceptionCalls);

const payloadCalls = { infoCalls: [] as string[], rpcCalls: [] as string[], rpcPayloads: [] as Array<Record<string, unknown>> };
const payloadToken = authorization();
const payloadResponse = await run(
  validBody(payloadToken),
  createSupabase({ removeCalls: [], infoCalls: payloadCalls.infoCalls, rpcCalls: payloadCalls.rpcCalls, rpcPayloads: payloadCalls.rpcPayloads }),
);
assert.equal(payloadResponse.status, 200);
assert.deepEqual(payloadCalls.rpcCalls, ["finalize_manual_attachment_message"]);
assert.equal(payloadCalls.rpcPayloads.length, 1);
const payloadAuthorization = readManualAttachmentAuthorization(payloadToken);
assert.deepEqual(payloadCalls.rpcPayloads[0], {
  p_organization_id: payloadAuthorization.organizationId,
  p_store_id: payloadAuthorization.storeId,
  p_conversation_id: payloadAuthorization.conversationId,
  p_lead_id: payloadAuthorization.leadId,
  p_message_type: payloadAuthorization.messageType,
  p_content: payloadAuthorization.content,
  p_media_url: payloadAuthorization.path,
  p_metadata: {
    source: "panel",
    channel: "crm",
    external_channel: undefined,
    outbound_origin: undefined,
    whatsapp_detected_from_conversation: false,
    media_origin: "store_user",
    source_channel: "panel_manual",
    storage_bucket: MANUAL_ATTACHMENT_STORAGE_BUCKET,
    storage_path: payloadAuthorization.path,
    original_file_name: payloadAuthorization.fileName,
    original_extension: "pdf",
    mime_type: payloadAuthorization.mimeType,
    size_bytes: payloadAuthorization.sizeBytes,
    attachment_kind: payloadAuthorization.messageType,
    can_be_sent_to_customer: true,
    requires_human_review: false,
    sent_by: "panel_user",
    sent_by_user_id: "user-1",
    pillar: "pilar_10_multimodal",
    send_external: false,
    outbound_idempotency_key: payloadAuthorization.idempotencyKey,
    manual_attachment_payload_fingerprint: payloadAuthorization.payloadFingerprint,
    manual_attachment_upload_id: payloadAuthorization.uploadId,
  },
  p_outbound_idempotency_key: payloadAuthorization.idempotencyKey,
  p_payload_fingerprint: payloadAuthorization.payloadFingerprint,
});

const whatsappCalls = { infoCalls: [] as string[], rpcCalls: [] as string[], rpcPayloads: [] as Array<Record<string, unknown>> };
const whatsappResponse = await run(
  validBody(),
  createSupabase({ removeCalls: [], infoCalls: whatsappCalls.infoCalls, rpcCalls: whatsappCalls.rpcCalls, rpcPayloads: whatsappCalls.rpcPayloads, whatsapp: true }),
);
assert.equal(whatsappResponse.status, 200);
const whatsappMetadata = whatsappCalls.rpcPayloads[0]?.p_metadata as Record<string, unknown>;
assert.equal(whatsappMetadata.channel, "whatsapp");
assert.equal(whatsappMetadata.external_channel, "whatsapp");
assert.equal(whatsappMetadata.send_external, true);
assert.equal(whatsappMetadata.outbound_origin, "crm_manual_image");

const replayCalls = { infoCalls: [] as string[], rpcCalls: [] as string[] };
const replayResponse = await run(
  validBody(),
  createSupabase({ removeCalls: [], infoCalls: replayCalls.infoCalls, rpcCalls: replayCalls.rpcCalls, rpcData: [{ message_id: "message-replayed", replayed: true }] }),
);
const replayPayload = await replayResponse.json();
assert.equal(replayResponse.status, 200);
assert.deepEqual(replayPayload, { ok: true, messageId: "message-replayed", replayed: true });
assert.deepEqual(replayCalls.rpcCalls, ["finalize_manual_attachment_message"]);

const conflictCalls = { infoCalls: [] as string[], rpcCalls: [] as string[] };
const conflictResponse = await run(
  validBody(),
  createSupabase({ removeCalls: [], infoCalls: conflictCalls.infoCalls, rpcCalls: conflictCalls.rpcCalls, rpcError: { message: "MANUAL_ATTACHMENT_IDEMPOTENCY_CONFLICT" } }),
);
const conflictPayload = await conflictResponse.json();
assert.equal(conflictResponse.status, 500);
assert.deepEqual(conflictPayload, { ok: false, error: "manual_attachment_finalize_failed" });
assertNoAuthorizationArtifacts(conflictPayload);
assert.deepEqual(conflictCalls.rpcCalls, ["finalize_manual_attachment_message"]);

const source = readFileSync(join(process.cwd(), "src/app/api/crm/messages/send-manual-attachment/finalize/route.ts"), "utf8");
assert.doesNotMatch(source, /cleanupManualAttachment/);
assert.doesNotMatch(source, /from\("messages"\)/);

console.log("manual-attachment-finalize-concurrency: PASS");
