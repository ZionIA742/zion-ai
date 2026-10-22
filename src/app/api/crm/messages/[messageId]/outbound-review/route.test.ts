import { strict as assert } from "node:assert";
import { createHandler } from "./route";

const messageId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const reviewId = "33333333-3333-4333-8333-333333333333";
const operationKey = "44444444-4444-4444-8444-444444444444";

function request(body: unknown) {
  return new Request("http://localhost/api/crm/messages/" + messageId + "/outbound-review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function access(overrides: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    sessionUserId: actorId,
    resolution: {
      domain: "zion_admin",
      status: "zion_admin_allowed",
      apiDecision: "allow",
      reasonCode: "zion_admin_allowed",
      message: "ok",
      safeHtmlDestination: "/zion-admin",
      organizationResolution: "none",
      storeResolution: "none",
      organizationId: null,
      storeId: null,
      commercialAccess: "unknown",
      role: "admin",
      capabilities: ["manage_accounts"],
    },
    ...overrides,
  } as never;
}

function rpcClient(
  result: unknown,
  error: { message?: string } | null = null,
  scope: { organization_id?: unknown; store_id?: unknown } | null = {
    organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    store_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  },
) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const scopeQuery = {
    select: () => scopeQuery,
    eq: () => scopeQuery,
    maybeSingle: async () => ({ data: scope, error: null }),
  };
  return {
    calls,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: result, error };
    },
    from: () => scopeQuery,
  };
}

const validBody = {
  operation_key: operationKey,
  review_action: "investigating",
  evidence_kind: "internal_observation",
  evidence_reference: "ticket-1",
  review_note: "Provider evidence was not available; keep uncertain.",
};

async function read(response: Response) {
  return { status: response.status, body: await response.json() };
}

async function main() {
  const recorded = rpcClient({
    review_id: reviewId,
    result: "recorded",
    outbound_delivery_state: "uncertain",
    message_state_changed: false,
    message_retried: false,
  });
  const handler = createHandler({
    resolveAccess: async () => access(),
    createServiceClient: () => recorded,
  });
  const first = await read(await handler(request(validBody), { params: Promise.resolve({ messageId }) }));
  assert.equal(first.status, 200);
  assert.equal(first.body.review.result, "recorded");
  assert.equal(first.body.review.message_retried, false);
  assert.equal(recorded.calls[0].args.p_actor_user_id, actorId);
  assert.equal(recorded.calls[0].args.p_organization_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(recorded.calls[0].args.p_store_id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.equal("provider_message_id" in recorded.calls[0].args, false);

  const clientScopeCannotAuthorize = rpcClient({
    review_id: reviewId,
    result: "recorded",
    outbound_delivery_state: "uncertain",
    message_state_changed: false,
    message_retried: false,
  });
  const clientScopeResponse = await read(await createHandler({
    resolveAccess: async () => access(),
    createServiceClient: () => clientScopeCannotAuthorize,
  })(request({
    ...validBody,
    organization_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    store_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  }), { params: Promise.resolve({ messageId }) }));
  assert.equal(clientScopeResponse.status, 200);
  assert.equal(clientScopeCannotAuthorize.calls[0].args.p_organization_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(clientScopeCannotAuthorize.calls[0].args.p_store_id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

  const defaultEvidence = rpcClient({
    review_id: reviewId,
    result: "recorded",
    outbound_delivery_state: "uncertain",
    message_state_changed: false,
    message_retried: false,
  });
  const defaultEvidenceResponse = await read(await createHandler({
    resolveAccess: async () => access(),
    createServiceClient: () => defaultEvidence,
  })(request({ ...validBody, evidence_kind: undefined }), { params: Promise.resolve({ messageId }) }));
  assert.equal(defaultEvidenceResponse.status, 200);
  assert.equal(defaultEvidence.calls[0].args.p_evidence_kind, "none");

  const replay = rpcClient({
    review_id: reviewId,
    result: "already_recorded",
    outbound_delivery_state: "uncertain",
    message_state_changed: false,
    message_retried: false,
  });
  const replayResponse = await read(await createHandler({
    resolveAccess: async () => access(),
    createServiceClient: () => replay,
  })(request(validBody), { params: Promise.resolve({ messageId }) }));
  assert.equal(replayResponse.status, 200);
  assert.equal(replayResponse.body.review.result, "already_recorded");

  const denied = await read(await createHandler({
    resolveAccess: async () => ({ ok: false, httpStatus: 401, payload: { ok: false, error: "UNAUTHENTICATED" } } as never),
    createServiceClient: () => { throw new Error("must not call RPC"); },
  })(request(validBody), { params: Promise.resolve({ messageId }) }));
  assert.equal(denied.status, 401);

  for (const status of [403, 409]) {
    const nonAdmin = await read(await createHandler({
      resolveAccess: async () => ({ ok: false, httpStatus: status, payload: { ok: false, error: "ZION_ADMIN_API_FORBIDDEN" } } as never),
      createServiceClient: () => { throw new Error("must not call RPC"); },
    })(request(validBody), { params: Promise.resolve({ messageId }) }));
    assert.equal(nonAdmin.status, status);
  }

  const crossScope = await read(await createHandler({
    resolveAccess: async () => ({
      ok: false,
      httpStatus: 403,
      payload: { ok: false, error: "STORE_API_FORBIDDEN" },
    } as never),
    createServiceClient: () => { throw new Error("must not call RPC"); },
  })(request(validBody), { params: Promise.resolve({ messageId }) }));
  assert.equal(crossScope.status, 403);

  const missingMessageClient = rpcClient(null, null, null);
  const missingMessage = await read(await createHandler({
    resolveAccess: async () => access(),
    createServiceClient: () => missingMessageClient,
  })(request(validBody), { params: Promise.resolve({ messageId }) }));
  assert.equal(missingMessage.status, 404);
  assert.equal(missingMessageClient.calls.length, 0);

  const invalidId = await read(await handler(request(validBody), { params: Promise.resolve({ messageId: "not-a-uuid" }) }));
  assert.equal(invalidId.status, 400);

  for (const [field, value] of [
    ["operation_key", "not-a-uuid"],
    ["review_action", "human_review"],
    ["evidence_kind", "operator_note"],
  ] as const) {
    const client = rpcClient(null);
    const invalid = { ...validBody, [field]: value };
    const result = await read(await createHandler({
      resolveAccess: async () => access(),
      createServiceClient: () => client,
    })(request(invalid), { params: Promise.resolve({ messageId }) }));
    assert.equal(result.status, 400);
    assert.equal(client.calls.length, 0);
  }

  for (const [field, value] of [
    ["evidence_reference", "x".repeat(513)],
    ["review_note", "x".repeat(1501)],
  ] as const) {
    const client = rpcClient(null);
    const invalid = { ...validBody, [field]: value };
    const result = await read(await createHandler({
      resolveAccess: async () => access(),
      createServiceClient: () => client,
    })(request(invalid), { params: Promise.resolve({ messageId }) }));
    assert.equal(result.status, 400);
    assert.equal(client.calls.length, 0);
  }

  const rejected = rpcClient(null, { message: "message is not uncertain" });
  const rejectedResponse = await read(await createHandler({
    resolveAccess: async () => access(),
    createServiceClient: () => rejected,
  })(request(validBody), { params: Promise.resolve({ messageId }) }));
  assert.equal(rejectedResponse.status, 409);

  const invalidRpcResult = rpcClient({ result: "recorded" });
  const invalidResponse = await read(await createHandler({
    resolveAccess: async () => access(),
    createServiceClient: () => invalidRpcResult,
  })(request(validBody), { params: Promise.resolve({ messageId }) }));
  assert.equal(invalidResponse.status, 502);

  console.log("outbound-review route: focused tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
