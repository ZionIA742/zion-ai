import assert from "node:assert/strict";
import test from "node:test";
import { createWhatsappNumberChangeLinkRouteHandler } from "./route";

const ORG = "org-1";
const STORE = "store-1";
const USER = "user-1";
const LINK = "link-1";

function access(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    organizationId: ORG,
    storeId: STORE,
    sessionUserId: USER,
    ...overrides,
  };
}

function request(body: unknown) {
  return new Request("https://example.test/api/store/whatsapp/number-change-link?token=opaque-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function client(
  candidate: Record<string, unknown> | null,
  resolution: { data: unknown; error: unknown | null },
  options: { requestStatus?: string; completion?: { data: unknown; error: unknown | null } } = {},
) {
  const calls: string[] = [];
  const requestRow = {
    id: "request-1",
    organization_id: ORG,
    store_id: STORE,
    provider: "whatsapp",
    status: options.requestStatus || "completed",
    active_integration_id: "integration-1",
  };
  const linkQuery = {
    select() { return this; },
    eq() { return this; },
    maybeSingle: async () => ({ data: candidate, error: null }),
  };
  const requestQuery = {
    select() { return this; },
    eq() { return this; },
    maybeSingle: async () => ({ data: requestRow, error: null }),
  };
  return {
    calls,
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "resolve_whatsapp_number_change_link_by_system") return resolution;
      if (name === "complete_whatsapp_number_change_link_by_system") {
        return options.completion || { data: { status: "completed" }, error: null };
      }
      return { data: null, error: null };
    },
    from: (table: string) => {
      if (table === "whatsapp_number_change_links") return linkQuery;
      if (table === "whatsapp_binding_change_requests") return requestQuery;
      throw new Error(`unexpected table: ${table}`);
    },
  } as never;
}

function completedCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: LINK,
    organization_id: ORG,
    store_id: STORE,
    provider: "whatsapp",
    status: "completed",
    expires_at: "2026-11-10T12:00:00.000Z",
    started_at: "2026-11-10T11:00:00.000Z",
    binding_change_request_id: "request-1",
    responsible_user_id: USER,
    ...overrides,
  };
}

function startedCandidate(overrides: Record<string, unknown> = {}) {
  return completedCandidate({ status: "started", ...overrides });
}

async function read(response: Response) {
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

test("recupera link concluído quando a RPC original falha e não repete cutover", async () => {
  const supabase = client(completedCandidate(), { data: null, error: { message: "terminal link" } });
  const handler = createWhatsappNumberChangeLinkRouteHandler({
    resolveAccess: async () => access() as never,
    createServiceClient: () => supabase,
  });

  const result = await read(await handler.POST(request({ action: "complete" })));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, status: "completed" });
  assert.deepEqual(supabase.calls, ["resolve_whatsapp_number_change_link_by_system"]);
});

test("recupera link concluído quando a RPC retorna vazio", async () => {
  const supabase = client(completedCandidate(), { data: null, error: null });
  const handler = createWhatsappNumberChangeLinkRouteHandler({
    resolveAccess: async () => access() as never,
    createServiceClient: () => supabase,
  });

  const result = await read(await handler.POST(request({ action: "complete" })));
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "completed");
});

test("link started e pedido completed chama a RPC de conclusão uma vez", async () => {
  const supabase = client(startedCandidate(), { data: [startedCandidate()], error: null });
  const handler = createWhatsappNumberChangeLinkRouteHandler({
    resolveAccess: async () => access() as never,
    createServiceClient: () => supabase,
  });

  const result = await read(await handler.POST(request({ action: "complete" })));
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "completed");
  assert.deepEqual(supabase.calls, [
    "resolve_whatsapp_number_change_link_by_system",
    "complete_whatsapp_number_change_link_by_system",
  ]);
});

test("link started e pedido não concluído bloqueia sem chamar conclusão", async () => {
  const supabase = client(
    startedCandidate(),
    { data: [startedCandidate()], error: null },
    { requestStatus: "ready_to_cutover" },
  );
  const handler = createWhatsappNumberChangeLinkRouteHandler({
    resolveAccess: async () => access() as never,
    createServiceClient: () => supabase,
  });

  const result = await read(await handler.POST(request({ action: "complete" })));
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "WHATSAPP_NUMBER_CHANGE_LINK_REQUEST_NOT_COMPLETED");
  assert.deepEqual(supabase.calls, ["resolve_whatsapp_number_change_link_by_system"]);
});

test("falha da RPC de conclusão retorna erro seguro e não chama cutover", async () => {
  const supabase = client(
    startedCandidate(),
    { data: [startedCandidate()], error: null },
    { completion: { data: null, error: { message: "temporary failure" } } },
  );
  const handler = createWhatsappNumberChangeLinkRouteHandler({
    resolveAccess: async () => access() as never,
    createServiceClient: () => supabase,
  });

  const result = await read(await handler.POST(request({ action: "complete" })));
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "WHATSAPP_NUMBER_CHANGE_LINK_COMPLETION_FAILED");
  assert.equal(supabase.calls.includes("cutover_whatsapp_binding_change_request_by_system"), false);
});

test("link já completed é replayável sem chamar RPC novamente", async () => {
  const supabase = client(completedCandidate(), { data: null, error: { message: "terminal link" } });
  const handler = createWhatsappNumberChangeLinkRouteHandler({
    resolveAccess: async () => access() as never,
    createServiceClient: () => supabase,
  });

  const result = await read(await handler.POST(request({ action: "complete" })));
  assert.equal(result.status, 200);
  assert.deepEqual(supabase.calls, ["resolve_whatsapp_number_change_link_by_system"]);
});

test("retorno vazio da RPC de conclusão não gera sucesso", async () => {
  const supabase = client(
    startedCandidate(),
    { data: [startedCandidate()], error: null },
    { completion: { data: null, error: null } },
  );
  const handler = createWhatsappNumberChangeLinkRouteHandler({
    resolveAccess: async () => access() as never,
    createServiceClient: () => supabase,
  });

  const result = await read(await handler.POST(request({ action: "complete" })));
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "WHATSAPP_NUMBER_CHANGE_LINK_COMPLETION_FAILED");
});

for (const [name, overrides] of [
  ["outra loja", { store_id: "other-store" }],
  ["outro responsável", { responsible_user_id: "other-user" }],
  ["provedor inválido", { provider: "other" }],
  ["link expirado", { status: "expired" }],
] as const) {
  test(`não aceita fallback de ${name}`, async () => {
    const supabase = client(completedCandidate(overrides), { data: null, error: { message: "not active" } });
    const handler = createWhatsappNumberChangeLinkRouteHandler({
      resolveAccess: async () => access() as never,
      createServiceClient: () => supabase,
    });

    const result = await read(await handler.POST(request({ action: "complete" })));
    assert.equal(result.status, 403);
    assert.equal(result.body.error, "WHATSAPP_NUMBER_CHANGE_LINK_UNAUTHORIZED");
  });
}

console.log("number-change-link route: 11 tests passed");
