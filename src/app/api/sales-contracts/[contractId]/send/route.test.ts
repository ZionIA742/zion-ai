import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSalesContractSendPostHandler } from "./route";

type Row = Record<string, unknown>;
const VERSION_1 = "11111111-1111-4111-8111-111111111111";
const VERSION_2 = "22222222-2222-4222-8222-222222222222";

function manualContract() {
  return {
    metadata: {
      source: "responsible_text_draft",
      created_via: "create_sales_contract_manual_by_system",
    },
    quote_id: null,
    quote_version_id: null,
  };
}

const makeScope = (supabase: unknown, overrides: { contract?: Row; currentVersion?: Row | null; organizationId?: string; store?: Row } = {}) => ({
  supabase, organizationId: overrides.organizationId ?? "org-1", userId: "user-1",
  store: { id: "store-1", organization_id: "org-1", ...overrides.store }, conversation: { id: "conversation-1" }, lead: { id: "lead-1" },
  contract: { id: "contract-1", organization_id: "org-1", store_id: "store-1", status: "approved", conversation_id: "conversation-1", current_version_id: VERSION_1, contract_number: "C-001", quote_id: "quote-1", quote_version_id: "quote-version-1", ...overrides.contract } as Row,
  currentVersion: (overrides.currentVersion === null ? null : { id: VERSION_1, contract_id: "contract-1", organization_id: "org-1", store_id: "store-1", status: "approved", storage_bucket: "contracts", storage_path: `org-1/store-1/contract-1/${VERSION_1}.pdf`, original_filename: "contract.pdf", mime_type: "application/pdf", size_bytes: 1234, ...overrides.currentVersion }) as Row | null,
});

function granted(supabase: unknown) { return { ok: true as const, supabase: supabase as never, sessionUserId: "user-1", organizationId: "org-1", storeId: "store-1", resolution: {} as never }; }
function denied() { return { ok: false as const, httpStatus: 401 as const, payload: { ok: false, error: "STORE_API_UNAUTHENTICATED", message: "Nao autenticado.", status: "anonymous", reasonCode: "anonymous" }, resolution: {} as never }; }
function context(contractId = "contract-1") { return { params: Promise.resolve({ contractId }) }; }
async function body(response: Response) { return { response, body: await response.json() as Row }; }

function harness(options: { result?: Row; error?: { message: string } | null; scope?: ReturnType<typeof makeScope>; resolveContract?: (contractId: string, scope: Row) => Promise<unknown>; resolveAccess?: () => Promise<unknown> } = {}) {
  const calls: Array<{ fn: string; payload: Row }> = [];
  const supabase = { rpc: async (fn: string, payload: Row) => { calls.push({ fn, payload }); return { data: [{ message_id: "message-1", outbound_idempotency_key: `sales_contract_send:org-1:store-1:contract-1:${VERSION_1}`, outbound_delivery_state: "pending", sales_contract_id: "contract-1", sales_contract_version_id: VERSION_1, external_message_id: null, outcome: "queued", ...options.result }], error: options.error ?? null }; } };
  const scope = options.scope ?? makeScope(supabase);
  return { calls, supabase, scope, resolveAccess: options.resolveAccess ?? (async () => granted(supabase)), resolveContract: options.resolveContract ?? (async () => scope) };
}

async function testDeniedBeforeContract() {
  const h = harness(); let resolved = false;
  const handler = createSalesContractSendPostHandler({ resolveAccess: (async () => denied()) as never, resolveContract: (async () => { resolved = true; throw new Error("must not run"); }) as never });
  const result = await body(await handler(new Request("http://test"), context()));
  assert.equal(result.response.status, 401); assert.equal(resolved, false); assert.equal(h.calls.length, 0);
}

async function testMaterializesWithoutDirectUpdates() {
  const h = harness(); let received: Row | undefined;
  const handler = createSalesContractSendPostHandler({
    resolveAccess: async () => granted(h.supabase),
    resolveContract: (async (_id: string, authorized: Row) => { assert.deepEqual(authorized, { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" }); return makeScope(h.supabase); }) as never,
    materializeSend: (async (args: Row) => { received = args; return { message_id: "message-1", outbound_idempotency_key: `sales_contract_send:org-1:store-1:contract-1:${VERSION_1}`, outbound_delivery_state: "pending", sales_contract_id: "contract-1", sales_contract_version_id: VERSION_1, external_message_id: null, outcome: "queued" }; }) as never,
  });
  const result = await body(await handler(new Request("http://test"), context()));
  assert.equal(result.response.status, 200); assert.equal((result.body.operation as Row).message_id, "message-1");
  assert.equal((received?.messageMetadata as Row).outbound_origin, "sales_contract_send"); assert.equal((received?.messageMetadata as Row).send_external, true); assert.equal(h.calls.length, 0);
}

async function testRpcPayloadAndPdfIdentity() {
  const h = harness(); const handler = createSalesContractSendPostHandler({ resolveAccess: async () => granted(h.supabase), resolveContract: (async () => makeScope(h.supabase)) as never });
  const result = await body(await handler(new Request("http://test"), context()));
  assert.equal(result.response.status, 200); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].fn, "materialize_sales_contract_send_by_system");
  assert.equal(h.calls[0].payload.p_contract_id, "contract-1"); assert.equal(h.calls[0].payload.p_contract_version_id, VERSION_1); assert.equal(h.calls[0].payload.p_idempotency_key, `sales_contract_send:org-1:store-1:contract-1:${VERSION_1}`);
  assert.equal(h.calls[0].payload.p_actor_user_id, "user-1");
  const metadata = h.calls[0].payload.p_message_metadata as Row; assert.equal(metadata.outbound_origin, "sales_contract_send"); assert.equal(metadata.storage_path, `org-1/store-1/contract-1/${VERSION_1}.pdf`); assert.equal(metadata.mime_type, "application/pdf"); assert.equal(metadata.sent_by_user_id, "user-1");
}

async function testExpectedVersionIsCarriedAndFenced() {
  const h = harness();
  const handler = createSalesContractSendPostHandler({
    resolveAccess: async () => granted(h.supabase),
    resolveContract: (async () => h.scope) as never,
  });
  const result = await body(await handler(new Request("http://test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedContractVersionId: VERSION_1 }),
  }), context()));
  assert.equal(result.response.status, 200);
  assert.equal(h.calls[0].payload.p_contract_version_id, VERSION_1);

  const stale = harness({ scope: makeScope(h.supabase, {
    contract: { current_version_id: VERSION_2 },
    currentVersion: { id: VERSION_2 },
  }) });
  const staleHandler = createSalesContractSendPostHandler({
    resolveAccess: async () => granted(stale.supabase),
    resolveContract: (async () => stale.scope) as never,
  });
  const staleResult = await body(await staleHandler(new Request("http://test", {
    method: "POST",
    body: JSON.stringify({ expectedContractVersionId: VERSION_1 }),
  }), context()));
  assert.equal(staleResult.response.status, 409);
  assert.equal(staleResult.body.error, "CONTRACT_VERSION_STALE");
  assert.equal(stale.calls.length, 0);

  let resolveCount = 0;
  const race = harness();
  const raceHandler = createSalesContractSendPostHandler({
    resolveAccess: async () => granted(race.supabase),
    resolveContract: (async () => {
      resolveCount += 1;
      return resolveCount === 1
        ? race.scope
        : makeScope(race.supabase, { contract: { current_version_id: VERSION_2 }, currentVersion: { id: VERSION_2 } });
    }) as never,
    materializeSend: (async () => { throw new Error("authority conflict"); }) as never,
  });
  const raceResult = await body(await raceHandler(new Request("http://test", {
    method: "POST",
    body: JSON.stringify({ expectedContractVersionId: VERSION_1 }),
  }), context()));
  assert.equal(raceResult.response.status, 409);
  assert.equal(raceResult.body.error, "CONTRACT_VERSION_STALE");
}

async function testManualRequiresExactExpectedVersion() {
  for (const request of [
    new Request("http://test"),
    new Request("http://test", { method: "POST", body: JSON.stringify({}) }),
    new Request("http://test", { method: "POST", body: JSON.stringify({ expectedContractVersionId: "not-a-uuid" }) }),
  ]) {
    const h = harness();
    h.scope.contract = { ...h.scope.contract, ...manualContract() };
    const handler = createSalesContractSendPostHandler({
      resolveAccess: async () => granted(h.supabase),
      resolveContract: (async () => h.scope) as never,
    });
    const result = await body(await handler(request, context()));
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error, request.body ? "CONTRACT_VERSION_EXPECTATION_INVALID" : "CONTRACT_VERSION_EXPECTATION_REQUIRED");
    assert.equal(h.calls.length, 0);
  }

  const h = harness();
  h.scope.contract = { ...h.scope.contract, ...manualContract() };
  const handler = createSalesContractSendPostHandler({
    resolveAccess: async () => granted(h.supabase),
    resolveContract: (async () => h.scope) as never,
  });
  const result = await body(await handler(new Request("http://test", {
    method: "POST",
    body: JSON.stringify({ expectedContractVersionId: VERSION_1 }),
  }), context()));
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(h.calls.length, 1);
}

async function testManualRejectsStaleVersionAndPreservesReplay() {
  const stale = harness();
  stale.scope.contract = { ...stale.scope.contract, ...manualContract(), current_version_id: VERSION_2 };
  stale.scope.currentVersion = { ...stale.scope.currentVersion, id: VERSION_2 };
  const staleHandler = createSalesContractSendPostHandler({
    resolveAccess: async () => granted(stale.supabase),
    resolveContract: (async () => stale.scope) as never,
  });
  const staleResult = await body(await staleHandler(new Request("http://test", {
    method: "POST",
    body: JSON.stringify({ expectedContractVersionId: VERSION_1 }),
  }), context()));
  assert.equal(staleResult.response.status, 409);
  assert.equal(staleResult.body.error, "CONTRACT_VERSION_STALE");
  assert.equal(stale.calls.length, 0);

  const replay = harness({ result: { outcome: "already_queued" } });
  replay.scope.contract = { ...replay.scope.contract, ...manualContract() };
  const replayHandler = createSalesContractSendPostHandler({
    resolveAccess: async () => granted(replay.supabase),
    resolveContract: (async () => replay.scope) as never,
  });
  const replayResult = await body(await replayHandler(new Request("http://test", {
    method: "POST",
    body: JSON.stringify({ expectedContractVersionId: VERSION_1 }),
  }), context()));
  assert.equal(replayResult.response.status, 200);
  assert.equal((replayResult.body.operation as Row).outcome, "already_queued");
  assert.equal(replay.calls.length, 1);
}

async function testReplayAndAuthorityFailureClosed() {
  for (const outcome of ["already_queued", "already_sent", "uncertain", "failed"]) {
    const h = harness({ result: { outcome } }); const handler = createSalesContractSendPostHandler({ resolveAccess: async () => granted(h.supabase), resolveContract: (async () => makeScope(h.supabase)) as never });
    const result = await body(await handler(new Request("http://test"), context())); assert.equal(result.response.status, 200); assert.equal((result.body.operation as Row).outcome, outcome);
  }
  const handler = createSalesContractSendPostHandler({ resolveAccess: async () => granted({}), resolveContract: (async () => makeScope({})) as never, materializeSend: (async () => { throw new Error("authority unavailable"); }) as never });
  const result = await body(await handler(new Request("http://test"), context())); assert.equal(result.response.status, 500); assert.equal(result.body.error, "UNEXPECTED_ERROR");
}

async function testSourceContract() {
  const source = readFileSync(join(process.cwd(), "src/app/api/sales-contracts/[contractId]/send/route.ts"), "utf8");
  assert.match(source, /materializeSalesContractSendBySystem/); assert.match(source, /requirement: "active"/); assert.match(source, /buildSalesContractSendIdempotencyKey/); assert.doesNotMatch(source, /insert_message/); assert.doesNotMatch(source, /from\("sales_contracts"\)\.update/); assert.doesNotMatch(source, /from\("sales_contract_versions"\)\.update/);
}

async function testCanonicalContractIdentityAndScope() {
  const h = harness();
  let requestedContractId = "";
  const handler = createSalesContractSendPostHandler({
    resolveAccess: async () => granted(h.supabase),
    resolveContract: (async (contractId: string, authorizedScope: Row) => {
      requestedContractId = contractId;
      assert.deepEqual(authorizedScope, { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" });
      return h.scope;
    }) as never,
  });
  const result = await body(await handler(new Request("http://test"), context("requested-contract")));
  assert.equal(result.response.status, 200);
  assert.equal(requestedContractId, "requested-contract");

  const mismatches = [
    { organizationId: "org-2" },
    { store: { id: "store-2" } },
    { store: { organization_id: "org-2" } },
    { contract: { organization_id: "org-2" } },
    { contract: { store_id: "store-2" } },
  ];
  for (const mismatch of mismatches) {
    const mismatchHarness = harness({ scope: makeScope(h.supabase, mismatch) });
    const mismatchHandler = createSalesContractSendPostHandler({
      resolveAccess: async () => granted(mismatchHarness.supabase),
      resolveContract: (async () => mismatchHarness.scope) as never,
    });
    const mismatchResult = await body(await mismatchHandler(new Request("http://test"), context()));
    assert.equal(mismatchResult.response.status, 403);
    assert.equal(mismatchResult.body.error, "CONTRACT_SCOPE_MISMATCH");
    assert.equal(mismatchHarness.calls.length, 0);
  }
}

async function testCurrentVersionAndPdfGates() {
  const cases: Array<{ scope: ReturnType<typeof makeScope>; status: number; error: string }> = [
    { scope: makeScope({}, { contract: { status: "completed" } }), status: 409, error: "CONTRACT_STATUS_NOT_SENDABLE" },
    { scope: makeScope({}, { contract: { status: "cancelled" } }), status: 409, error: "CONTRACT_STATUS_NOT_SENDABLE" },
    { scope: makeScope({}, { contract: { status: "draft" } }), status: 409, error: "CONTRACT_REQUIRES_APPROVAL" },
    { scope: makeScope({}, { currentVersion: { status: "draft" } }), status: 409, error: "CONTRACT_VERSION_REQUIRES_APPROVAL" },
    { scope: makeScope({}, { contract: { current_version_id: null } }), status: 400, error: "CONTRACT_VERSION_REQUIRED" },
    { scope: makeScope({}, { currentVersion: null }), status: 404, error: "CONTRACT_VERSION_NOT_FOUND" },
    { scope: makeScope({}, { currentVersion: { id: VERSION_2 } }), status: 403, error: "CONTRACT_SCOPE_MISMATCH" },
    { scope: makeScope({}, { currentVersion: { id: VERSION_1, contract_id: "contract-2" } }), status: 403, error: "CONTRACT_SCOPE_MISMATCH" },
    { scope: makeScope({}, { currentVersion: { id: VERSION_1, organization_id: "org-2" } }), status: 403, error: "CONTRACT_SCOPE_MISMATCH" },
    { scope: makeScope({}, { currentVersion: { id: VERSION_1, store_id: "store-2" } }), status: 403, error: "CONTRACT_SCOPE_MISMATCH" },
    { scope: makeScope({}, { currentVersion: { id: VERSION_1, storage_bucket: "" } }), status: 400, error: "CONTRACT_FILE_MISSING" },
    { scope: makeScope({}, { currentVersion: { id: VERSION_1, storage_path: "" } }), status: 400, error: "CONTRACT_FILE_MISSING" },
    { scope: makeScope({}, { currentVersion: { id: VERSION_1, original_filename: "" } }), status: 400, error: "CONTRACT_FILENAME_MISSING" },
  ];
  for (const item of cases) {
    const h = harness({ scope: item.scope });
    const handler = createSalesContractSendPostHandler({ resolveAccess: async () => granted(h.supabase), resolveContract: (async () => h.scope) as never });
    const result = await body(await handler(new Request("http://test"), context()));
    assert.equal(result.response.status, item.status, item.error);
    assert.equal(result.body.error, item.error);
    assert.equal(h.calls.length, 0);
  }
}

async function testAuthorityErrorsAndUnexpectedResolution() {
  const authorityFailure = harness({ error: { message: "P9_CONTRACT_SEND_AUTHORITY_FAILED" } });
  const authorityHandler = createSalesContractSendPostHandler({ resolveAccess: async () => granted(authorityFailure.supabase), resolveContract: (async () => authorityFailure.scope) as never });
  const authorityResult = await body(await authorityHandler(new Request("http://test"), context()));
  assert.equal(authorityResult.response.status, 500);
  assert.equal(authorityResult.body.error, "UNEXPECTED_ERROR");

  const incomplete = harness({ result: { message_id: null } });
  const incompleteHandler = createSalesContractSendPostHandler({ resolveAccess: async () => granted(incomplete.supabase), resolveContract: (async () => incomplete.scope) as never });
  const incompleteResult = await body(await incompleteHandler(new Request("http://test"), context()));
  assert.equal(incompleteResult.response.status, 500);

  const resolutionHandler = createSalesContractSendPostHandler({
    resolveAccess: async () => granted({}),
    resolveContract: (async () => { throw new Error("resolver unavailable"); }) as never,
  });
  const resolutionResult = await body(await resolutionHandler(new Request("http://test"), context()));
  assert.equal(resolutionResult.response.status, 500);
  assert.equal(resolutionResult.body.error, "UNEXPECTED_ERROR");
}

async function testUnexpectedAccessErrorIsObserved() {
  const handler = createSalesContractSendPostHandler({
    resolveAccess: async () => { throw new Error("access resolver unavailable"); },
  });
  const result = await body(await handler(new Request("http://test"), context()));
  assert.equal(result.response.status, 500);
  assert.equal(result.body.error, "UNEXPECTED_ERROR");
}

async function main() {
  const tests = [
    testDeniedBeforeContract,
    testCanonicalContractIdentityAndScope,
    testCurrentVersionAndPdfGates,
    testMaterializesWithoutDirectUpdates,
    testRpcPayloadAndPdfIdentity,
    testExpectedVersionIsCarriedAndFenced,
    testManualRequiresExactExpectedVersion,
    testManualRejectsStaleVersionAndPreservesReplay,
    testReplayAndAuthorityFailureClosed,
    testAuthorityErrorsAndUnexpectedResolution,
    testUnexpectedAccessErrorIsObserved,
    testSourceContract,
  ];
  for (const test of tests) await test();
  console.log(`PASS ${tests.length} contract send route tests`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
