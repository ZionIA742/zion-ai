import { strict as assert } from "node:assert";
import test from "node:test";
import { createWhatsappNumberChangeRouteHandler } from "./route-handler";

type Row = Record<string, unknown>;
type OwnerMembership = { id: string; user_id: string; role: string; is_active: boolean };
type QueryResult = { data: unknown; error: null };
type Query = PromiseLike<QueryResult> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  maybeSingle(): PromiseLike<QueryResult>;
};

function createHarness(options: {
  transport: { send(message: unknown): Promise<{ delivered: boolean }> };
  ownerEmail?: string | null;
  ownerMemberships?: OwnerMembership[];
  storeOrganizationId?: string;
  membershipOrganizationId?: string;
  internalAdmin?: boolean;
  internalAdminActive?: boolean;
  authError?: boolean;
  sessionUserId?: string;
  accessAllowed?: boolean;
} ) {
  const calls: Array<{ name: string; args: Row }> = [];
  const rpcResults: Record<string, unknown> = {
    create_whatsapp_number_change_link_by_system: [{ link_id: "link-1", expires_at: "2099-01-01T00:30:00.000Z" }],
    revoke_whatsapp_number_change_link_by_system: [{ link_id: "link-1", status: "revoked" }],
  };
  const storeOrganizationId = options.storeOrganizationId ?? "org-1";
  const query = (table: string): Query => {
    const filters: Row = {};
    const result = table === "stores"
      ? { id: "store-1", organization_id: storeOrganizationId, name: "Loja Teste" }
      : table === "zion_internal_admins"
        ? (options.internalAdmin ? { user_id: "owner-1", is_active: options.internalAdminActive ?? true } : null)
        : table === "memberships"
          ? (options.ownerMemberships ?? [{ id: "membership-1", user_id: "owner-1", role: "owner", is_active: true }])
          : null;
    return {
      select() { return this; },
      eq(column, value) { filters[column] = value; return this; },
      maybeSingle: async () => ({
        data: table === "zion_internal_admins" && filters.is_active === true &&
          (result as { is_active?: boolean } | null)?.is_active !== true
          ? null
          : Array.isArray(result) ? result[0] : result,
        error: null,
      }),
      then(resolve: (value: { data: unknown; error: null }) => unknown) {
        const scopedResult = table === "memberships" &&
          (filters.organization_id !== storeOrganizationId ||
            (options.membershipOrganizationId && options.membershipOrganizationId !== filters.organization_id))
          ? []
          : result;
        return Promise.resolve(resolve({ data: scopedResult, error: null }));
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
          error: options.authError ? new Error("auth user lookup failed") : null,
        }),
      },
    },
  };
  const handler = createWhatsappNumberChangeRouteHandler({
    resolveAccess: async () => options.accessAllowed === false
      ? ({ ok: false } as never)
      : ({ ok: true, sessionUserId: options.sessionUserId ?? "admin-1" }),
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

test("missing or ambiguous canonical owner blocks before Auth and RPC", async () => {
  for (const ownerMemberships of [[], [
    { id: "membership-a", user_id: "owner-a", role: "owner", is_active: true },
    { id: "membership-b", user_id: "owner-b", role: "owner", is_active: true },
  ]]) {
    const { handler, calls } = createHarness({
      ownerMemberships,
      transport: { send: async () => ({ delivered: true }) },
    });
    const response = await handler(new Request("https://zion.example/api/zion-admin/whatsapp-number-change", {
      method: "POST",
      body: JSON.stringify({ action: "create", storeId: "store-1" }),
      headers: { "content-type": "application/json" },
    }));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "WHATSAPP_NUMBER_CHANGE_OWNER_AMBIGUOUS");
    assert.equal(calls.length, 0);
  }
});

test("owner membership is scoped to the store organization", async () => {
  const { handler, calls } = createHarness({
    storeOrganizationId: "org-store",
    membershipOrganizationId: "org-other",
    ownerMemberships: [{ id: "membership-other", user_id: "owner-other", role: "owner", is_active: true }],
    transport: { send: async () => ({ delivered: true }) },
  });
  const response = await handler(new Request("https://zion.example/api/zion-admin/whatsapp-number-change", {
    method: "POST",
    body: JSON.stringify({ action: "create", storeId: "store-1" }),
    headers: { "content-type": "application/json" },
  }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "WHATSAPP_NUMBER_CHANGE_OWNER_AMBIGUOUS");
  assert.equal(calls.length, 0);
});

test("internal owner guard blocks before link persistence and email delivery", async () => {
  const messages: unknown[] = [];
  const { handler, calls } = createHarness({
    internalAdmin: true,
    transport: { send: async (message) => { messages.push(message); return { delivered: true }; } },
  });
  const response = await handler(new Request("https://zion.example/api/zion-admin/whatsapp-number-change", {
    method: "POST",
    body: JSON.stringify({ action: "create", storeId: "store-1" }),
    headers: { "content-type": "application/json" },
  }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "WHATSAPP_NUMBER_CHANGE_INTERNAL_OWNER");
  assert.equal(calls.length, 0);
  assert.equal(messages.length, 0);
});

test("active internal owner is allowed only when the authenticated admin is that owner", async () => {
  const messages: unknown[] = [];
  const { handler, calls } = createHarness({
    internalAdmin: true,
    sessionUserId: "owner-1",
    transport: { send: async (message) => { messages.push(message); return { delivered: true }; } },
  });
  const response = await handler(new Request("https://zion.example/api/zion-admin/whatsapp-number-change", {
    method: "POST",
    body: JSON.stringify({ action: "create", storeId: "store-1" }),
    headers: { "content-type": "application/json" },
  }));
  assert.equal(response.status, 201);
  assert.equal(messages.length, 1);
  assert.equal(calls[0]?.args.p_created_by_user_id, "owner-1");
  assert.equal(calls[0]?.args.p_responsible_user_id, "owner-1");
});

test("inactive historical internal-admin row does not block the canonical owner", async () => {
  const messages: unknown[] = [];
  const { handler, calls } = createHarness({
    internalAdmin: true,
    internalAdminActive: false,
    transport: { send: async (message) => { messages.push(message); return { delivered: true }; } },
  });
  const response = await handler(new Request("https://zion.example/api/zion-admin/whatsapp-number-change", {
    method: "POST",
    body: JSON.stringify({ action: "create", storeId: "store-1" }),
    headers: { "content-type": "application/json" },
  }));
  assert.equal(response.status, 201);
  assert.equal(messages.length, 1);
  assert.equal(calls.map((call) => call.name).includes("create_whatsapp_number_change_link_by_system"), true);
});

test("Auth lookup failure blocks before link persistence and email delivery", async () => {
  const messages: unknown[] = [];
  const { handler, calls } = createHarness({
    authError: true,
    transport: { send: async (message) => { messages.push(message); return { delivered: true }; } },
  });
  const response = await handler(new Request("https://zion.example/api/zion-admin/whatsapp-number-change", {
    method: "POST",
    body: JSON.stringify({ action: "create", storeId: "store-1" }),
    headers: { "content-type": "application/json" },
  }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "WHATSAPP_NUMBER_CHANGE_OWNER_EMAIL_UNAVAILABLE");
  assert.equal(calls.length, 0);
  assert.equal(messages.length, 0);
});

test("client-supplied identity cannot replace the authenticated session identity", async () => {
  const messages: unknown[] = [];
  const { handler, calls } = createHarness({
    internalAdmin: true,
    sessionUserId: "owner-1",
    transport: { send: async (message) => { messages.push(message); return { delivered: true }; } },
  });
  const response = await handler(new Request("https://zion.example/api/zion-admin/whatsapp-number-change", {
    method: "POST",
    body: JSON.stringify({
      action: "create",
      storeId: "store-1",
      sessionUserId: "another-user",
      responsibleUserId: "another-user",
    }),
    headers: { "content-type": "application/json" },
  }));
  assert.equal(response.status, 201);
  assert.equal(calls[0]?.args.p_created_by_user_id, "owner-1");
  assert.equal(calls[0]?.args.p_responsible_user_id, "owner-1");
  assert.equal(messages.length, 1);
});

test("authorization failure creates no link and sends no email", async () => {
  const messages: unknown[] = [];
  const { handler, calls } = createHarness({
    accessAllowed: false,
    transport: { send: async (message) => { messages.push(message); return { delivered: true }; } },
  });
  const response = await handler(new Request("https://zion.example/api/zion-admin/whatsapp-number-change", {
    method: "POST",
    body: JSON.stringify({ action: "create", storeId: "store-1" }),
    headers: { "content-type": "application/json" },
  }));
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
  assert.equal(messages.length, 0);
});
