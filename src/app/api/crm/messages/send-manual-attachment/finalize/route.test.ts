import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createManualAttachmentAuthorization,
  MANUAL_ATTACHMENT_STORAGE_BUCKET,
} from "@/lib/server/manual-attachment-contract";
import { handleManualAttachmentFinalizePost } from "./route";
import type { StoreApiAccessGranted } from "@/lib/server/store-api-access";

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

function authorization(messageType: "image" | "document" | "audio" | "video" = "image") {
  const path = `${scope.organizationId}/${scope.storeId}/manual-attachments/${scope.conversationId}/upload.pdf`;
  return createManualAttachmentAuthorization({
    uploadId: "upload-1",
    ...scope,
    path,
    fileName: "upload.pdf",
    mimeType: messageType === "image" ? "image/png" : messageType === "document" ? "application/pdf" : `${messageType}/webm`,
    sizeBytes: 12,
    messageType,
    content: "A loja enviou um arquivo.",
    idempotencyKey: "crm_manual_attachment:upload-1",
    expiresAt: Date.now() + 60_000,
  });
}

function createSupabase(args: { rpcError?: boolean; removeCalls: string[] }) {
  const storage = {
    info: async () => ({ data: { size: 12, mimetype: "image/png", metadata: {} }, error: null }),
    remove: async (paths: string[]) => { args.removeCalls.push(...paths); return { data: null, error: null }; },
  };
  const query = (table: string) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      contains: () => builder,
      limit: () => builder,
      maybeSingle: async () => table === "conversations"
        ? { data: { id: scope.conversationId, organization_id: scope.organizationId, lead_id: scope.leadId }, error: null }
        : table === "leads"
          ? { data: { id: scope.leadId, organization_id: scope.organizationId, store_id: scope.storeId }, error: null }
          : { data: [], error: null },
    };
    return builder;
  };
  return {
    from: (table: string) => table === MANUAL_ATTACHMENT_STORAGE_BUCKET ? storage : query(table),
    storage: { from: () => storage },
    rpc: async () => args.rpcError
      ? { data: null, error: { message: "ambiguous failure" } }
      : { data: [{ message_id: "message-1", replayed: false }], error: null },
  };
}

async function run(body: Record<string, unknown>, supabase: ReturnType<typeof createSupabase>) {
  return handleManualAttachmentFinalizePost(
    new Request("http://localhost", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    { resolveAccess: async () => access(), createServiceClient: () => supabase as never },
  );
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
  createSupabase({ rpcError: true, removeCalls: rpcRemovals }),
);
assert.equal(rpcResponse.status, 500);
assert.deepEqual(rpcRemovals, []);

const successRemovals: string[] = [];
const successResponse = await run(
  { authorizationToken: authorization(), path: `${scope.organizationId}/${scope.storeId}/manual-attachments/${scope.conversationId}/upload.pdf` },
  createSupabase({ removeCalls: successRemovals }),
);
assert.equal(successResponse.status, 200);
assert.deepEqual(successRemovals, []);

const source = readFileSync(join(process.cwd(), "src/app/api/crm/messages/send-manual-attachment/finalize/route.ts"), "utf8");
assert.doesNotMatch(source, /cleanupManualAttachment/);
assert.doesNotMatch(source, /from\("messages"\)/);

console.log("manual-attachment-finalize-concurrency: PASS");
