import { strict as assert } from "node:assert";
import test from "node:test";
import { createWhatsappNumberChangeRouteHandler } from "./route-handler";

type Row = Record<string, unknown>;
type QueryResult = { data: unknown; error: null };
type Query = PromiseLike<QueryResult> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  maybeSingle(): PromiseLike<QueryResult>;
};

function createHarness(options: {
  transport: { send(message: unknown): Promise<{ delivered: boolean }> };
  ownerEmail?: string | null;
} ) {
  const calls: Array<{ name: string; args: Row }> = [];
  const rpcResults: Record<string, unknown> = {
    create_whatsapp_number_change_link_by_system: [{ link_id: "link-1", expires_at: "2099-01-01T00:30:00.000Z" }],
    revoke_whatsapp_number_change_link_by_system: [{ link_id: "link-1", status: "revoked" }],
  };
  const query = (table: string): Query => {
    const result = table === "stores"
      ? { id: "store-1", organization_id: "org-1", name: "Loja Teste" }
      : table === "zion_internal_admins"
        ? null
        : table === "memberships"
          ? [{ id: "membership-1", user_id: "owner-1", role: "owner", is_active: true }]
          : null;
    return {
      select() { return this; },
      eq() { return this; },
      maybeSingle: async () => ({ data: Array.isArray(result) ? result[0] : result, error: null }),
      then(resolve: (value: { data: unknown; error: null }) => unknown) {
        return Promise.resolve(resolve({ data: result, error: null }));
      },
    };
  };
  const client = {
    from: (table: string) => query(table),
    rpc: async (name: string, args: Row) => {
      calls.push({ name, args });
      return { data: rpcResults[name] ?? null, error: null };
    },
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: { id: "owner-1", email: options.ownerEmail === undefined ? "owner@example.com" : options.ownerEmail } },
          error: null,
        }),
      },
    },
  };
  const handler = createWhatsappNumberChangeRouteHandler({
    resolveAccess: async () => ({ ok: true, sessionUserId: "admin-1" }),
    createServiceSupabase: () => client as never,
    now: () => new Date("2099-01-01T00:00:00.000Z"),
    createToken: () => "one-time-token",
    baseUrl: () => "https://zion.example",
    sendEmail: options.transport as never,
  });
  return { handler, calls };
}

test("administrative issuance sends to the single canonical owner only", async () => {
  const messages: unknown[] = [];
  const { handler, calls } = createHarness({
    transport: { send: async (message) => { messages.push(message); return { delivered: true }; } },
  });
  const response = await handler(new Request("https://zion.example/api/zion-admin/whatsapp-number-change", {
    method: "POST",
    body: JSON.stringify({ action: "create", storeId: "store-1" }),
    headers: { "content-type": "application/json" },
  }));
  assert.equal(response.status, 201);
  assert.equal(messages.length, 1);
  assert.equal((messages[0] as Row).recipient, "owner@example.com");
  assert.equal((calls[0]?.args).p_responsible_user_id, "owner-1");
  assert.match(String((messages[0] as Row).link), /token=one-time-token/);
});

test("failed delivery revokes the just-issued link and does not report success", async () => {
  const { handler, calls } = createHarness({
    transport: { send: async () => ({ delivered: false }) },
  });
  const response = await handler(new Request("https://zion.example/api/zion-admin/whatsapp-number-change", {
    method: "POST",
    body: JSON.stringify({ action: "create", storeId: "store-1" }),
    headers: { "content-type": "application/json" },
  }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "WHATSAPP_NUMBER_CHANGE_EMAIL_TRANSPORT_UNAVAILABLE");
  assert.deepEqual(calls.map((call) => call.name), [
    "create_whatsapp_number_change_link_by_system",
    "revoke_whatsapp_number_change_link_by_system",
  ]);
});

test("missing canonical owner email blocks before issuing a link", async () => {
  const { handler, calls } = createHarness({
    ownerEmail: null,
    transport: { send: async () => ({ delivered: true }) },
  });
  const response = await handler(new Request("https://zion.example/api/zion-admin/whatsapp-number-change", {
    method: "POST",
    body: JSON.stringify({ action: "create", storeId: "store-1" }),
    headers: { "content-type": "application/json" },
  }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "WHATSAPP_NUMBER_CHANGE_OWNER_EMAIL_UNAVAILABLE");
  assert.equal(calls.length, 0);
});
