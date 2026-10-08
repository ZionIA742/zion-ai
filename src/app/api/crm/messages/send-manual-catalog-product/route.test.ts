import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createSendManualCatalogProductPostHandler } from "./route";

type Row = Record<string, unknown>;
const sourceId = "550e8400-e29b-41d4-a716-446655440000";
const operationId = "550e8400-e29b-41d4-a716-446655440001";
const baseBody = {
  conversationId: "conversation-1",
  sourceKind: "pool",
  sourceId,
  content: "Piscina premium",
  operationId,
  photoId: "attacker-photo",
  storageBucket: "attacker-bucket",
  storagePath: "attacker-path",
  outboundIdempotencyKey: "attacker-key",
};

const granted = (supabase: unknown) => ({
  ok: true as const,
  supabase: supabase as never,
  sessionUserId: "session-user-1",
  organizationId: "org-1",
  storeId: "store-1",
  resolution: {} as never,
});

const denied = {
  ok: false as const,
  httpStatus: 403 as const,
  payload: { ok: false as const, error: "STORE_API_ACCESS_DENIED", message: "Negado.", status: "access_denied" as const, reasonCode: "access_denied" as const },
  resolution: {} as never,
};

function createClient(options: { conversation?: Row | null; lead?: Row | null; rpcData?: unknown; rpcError?: { message: string } | null } = {}) {
  const calls: Array<{ table: string; filters: Row[] }> = [];
  const client = {
    calls,
    from(table: string) {
      const filters: Row[] = [];
      const builder = {
        select() { return builder; },
        eq(column: string, value: unknown) { filters.push({ column, value }); return builder; },
        contains(column: string, value: unknown) { filters.push({ column, value }); return builder; },
        limit() { return builder; },
        async maybeSingle() {
          calls.push({ table, filters: [...filters] });
          return { data: table === "conversations" ? ("conversation" in options ? options.conversation : { id: "conversation-1", organization_id: "org-1", lead_id: "lead-1" }) : ("lead" in options ? options.lead : { id: "lead-1", organization_id: "org-1", store_id: "store-1" }), error: null };
        },
      };
      return builder;
    },
    async rpc(name: string, args: Row) {
      calls.push({ table: `rpc:${name}`, filters: Object.entries(args).map(([column, value]) => ({ column, value })) });
      return { data: options.rpcData ?? [{ message_id: "message-1", replayed: false }], error: options.rpcError ?? null };
    },
  };
  return client;
}

function buildRequest(body: Row = baseBody) {
  return new Request("http://test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function createHandler(client: ReturnType<typeof createClient>, sendExternal = false) {
  return createSendManualCatalogProductPostHandler({
    resolveAccess: async () => granted(client),
    createServiceClient: () => client as never,
    isRealWhatsappConversation: async () => sendExternal,
  });
}

test("access denied happens before service client creation", async () => {
  let created = false;
  const handler = createSendManualCatalogProductPostHandler({
    resolveAccess: (async () => denied) as never,
    createServiceClient: () => {
      created = true;
      throw new Error("must not create client");
    },
  });
  const response = await handler(buildRequest());
  assert.equal(response.status, 403);
  assert.equal(created, false);
});

test("invalid JSON, source, operation, and empty captions fail before authority", async () => {
  for (const body of [
    null,
    { ...baseBody, sourceKind: "photo" },
    { ...baseBody, sourceId: "not-a-uuid" },
    { ...baseBody, operationId: "not-a-uuid" },
    { ...baseBody, content: "   " },
  ]) {
    const client = createClient();
    const handler = createHandler(client);
    const response = await handler(body === null ? new Request("http://test", { method: "POST", body: "{" }) : buildRequest(body));
    assert.equal(response.status, 400);
    assert.equal(client.calls.some((call) => call.table.startsWith("rpc:")), false);
  }
});

test("non-WhatsApp sends the canonical RPC with server-derived identity and ignores arbitrary media fields", async () => {
  const client = createClient();
  const response = await createHandler(client, false)(buildRequest());
  const body = await response.json();
  const rpc = client.calls.find((call) => call.table === "rpc:finalize_manual_catalog_photo_message");
  const args = Object.fromEntries((rpc?.filters || []).map((filter) => [filter.column, filter.value]));
  assert.equal(response.status, 200);
  assert.equal(body.messageId, "message-1");
  assert.equal(body.sendExternal, false);
  assert.equal(args.p_organization_id, "org-1");
  assert.equal(args.p_store_id, "store-1");
  assert.equal(args.p_actor_user_id, "session-user-1");
  assert.equal(args.p_source_id, undefined);
  assert.equal(args.p_catalog_source_id, sourceId);
  assert.equal(args.p_content, "Piscina premium");
  assert.equal(args.p_send_external, false);
  assert.equal(args.p_outbound_idempotency_key, `crm_manual_catalog_photo:${operationId}`);
  assert.equal(typeof args.p_payload_fingerprint, "string");
  assert.equal(JSON.stringify(args).includes("attacker"), false);
});

test("real WhatsApp propagates send_external and replayed", async () => {
  const client = createClient({ rpcData: [{ message_id: "message-1", replayed: true }] });
  const response = await createHandler(client, true)(buildRequest());
  const body = await response.json();
  const rpc = client.calls.find((call) => call.table.startsWith("rpc:"));
  const args = Object.fromEntries((rpc?.filters || []).map((filter) => [filter.column, filter.value]));
  assert.equal(response.status, 200);
  assert.equal(body.replayed, true);
  assert.equal(body.sendExternal, true);
  assert.equal(args.p_send_external, true);
});

test("conversation and lead scope failures fail closed", async () => {
  for (const options of [
    { conversation: null },
    { conversation: { id: "conversation-1", organization_id: "other-org", lead_id: "lead-1" } },
    { conversation: { id: "conversation-1", organization_id: "org-1", lead_id: null } },
    { conversation: { id: "conversation-1", organization_id: "org-1", lead_id: "lead-1" }, lead: null },
    { conversation: { id: "conversation-1", organization_id: "org-1", lead_id: "lead-1" }, lead: { id: "lead-1", organization_id: "org-1", store_id: "other-store" } },
  ]) {
    const client = createClient(options);
    const body = await createHandler(client)(buildRequest());
    assert.notEqual(body.status, 200);
    assert.equal(client.calls.some((call) => call.table.startsWith("rpc:")), false);
  }
});

test("RPC error and missing message_id are public generic failures", async () => {
  for (const options of [
    { rpcError: { message: "postgres secret" } },
    { rpcData: [{ replayed: false }] },
  ]) {
    const client = createClient(options);
    const response = await createHandler(client)(buildRequest());
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.message.includes("postgres secret"), false);
    assert.equal(body.message.includes("message_id"), false);
  }
});

test("same operation is idempotent while caption, source, and external flag change the fingerprint", async () => {
  async function fingerprint(body: Row, sendExternal = false) {
    const client = createClient();
    await createHandler(client, sendExternal)(buildRequest(body));
    const rpc = client.calls.find((call) => call.table.startsWith("rpc:"));
    return Object.fromEntries((rpc?.filters || []).map((filter) => [filter.column, filter.value]));
  }
  const first = await fingerprint(baseBody);
  const same = await fingerprint(baseBody);
  const captionChanged = await fingerprint({ ...baseBody, content: "Outra legenda" });
  const sourceChanged = await fingerprint({ ...baseBody, sourceId: "550e8400-e29b-41d4-a716-446655440002" });
  const externalChanged = await fingerprint(baseBody, true);
  assert.equal(first.p_outbound_idempotency_key, same.p_outbound_idempotency_key);
  assert.equal(first.p_payload_fingerprint, same.p_payload_fingerprint);
  assert.notEqual(first.p_payload_fingerprint, captionChanged.p_payload_fingerprint);
  assert.notEqual(first.p_payload_fingerprint, sourceChanged.p_payload_fingerprint);
  assert.notEqual(first.p_payload_fingerprint, externalChanged.p_payload_fingerprint);
});

test("send route source contract does not expose internal RPC errors", () => {
  const source = readFileSync(join(process.cwd(), "src/app/api/crm/messages/send-manual-catalog-product/route.ts"), "utf8");
  assert.match(source, /finalize_manual_catalog_photo_message/);
  assert.match(source, /buildManualCatalogIdempotencyKey/);
  assert.match(source, /buildManualCatalogPayloadFingerprint/);
  assert.doesNotMatch(source, /message: error\.message/);
  assert.doesNotMatch(source, /insert_message/);
});
