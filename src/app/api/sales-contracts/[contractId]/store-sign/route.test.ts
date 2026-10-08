import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ContractAccessError,
  type ContractAuthorizedStoreScope,
} from "@/lib/server/sales-contracts/contract-auth";
import { createSalesContractStoreSignPostHandler } from "./route";

type Row = Record<string, unknown>;

function granted(supabase: unknown) {
  return {
    ok: true as const,
    supabase: supabase as never,
    sessionUserId: "user-1",
    organizationId: "org-1",
    storeId: "store-1",
    resolution: {} as never,
  };
}

function denied() {
  return {
    ok: false as const,
    httpStatus: 401 as const,
    payload: {
      ok: false as const,
      error: "STORE_API_UNAUTHENTICATED",
      message: "Nao autenticado.",
      status: "anonymous" as const,
      reasonCode: "anonymous" as const,
    },
    resolution: {} as never,
  };
}

function contract(overrides: Row = {}) {
  return {
    id: "contract-1",
    organization_id: "org-1",
    store_id: "store-1",
    status: "customer_signed",
    current_version_id: "version-1",
    conversation_id: "conversation-1",
    lead_id: "lead-1",
    contract_number: "C-001",
    quote_id: "quote-1",
    customer_name: "Cliente",
    customer_phone: "5511999999999",
    ...overrides,
  };
}

function version(overrides: Row = {}) {
  return {
    id: "version-1",
    contract_id: "contract-1",
    organization_id: "org-1",
    store_id: "store-1",
    original_filename: "contract.pdf",
    mime_type: "application/pdf",
    storage_bucket: "contracts",
    storage_path: "org-1/store-1/contract-1/version-1.pdf",
    ...overrides,
  };
}

function scope(options: {
  organizationId?: string;
  store?: Row;
  contract?: Row;
  currentVersion?: Row | null;
  supabase?: unknown;
} = {}) {
  return {
    supabase: options.supabase,
    organizationId: options.organizationId ?? "org-1",
    userId: "legacy-user-must-not-authorize",
    store: { id: "store-1", organization_id: "org-1", ...options.store },
    conversation: { id: "conversation-1" },
    lead: { id: "lead-1", name: "Cliente", phone: "5511999999999" },
    contract: { ...contract(), ...options.contract },
    currentVersion:
      options.currentVersion === undefined ? version() : options.currentVersion,
  };
}

function createSupabase(options: {
  signature?: Row | null;
  signatureError?: Row | null;
  contractUpdate?: Row | null;
  contractUpdateError?: Row | null;
  versionUpdate?: Row | null;
  versionUpdateError?: Row | null;
} = {}) {
  const calls: Array<{ kind: string; table?: string; method?: string; args?: unknown[] }> = [];
  const inserts: Array<{ table: string; values: Row }> = [];
  const updates: Array<{ table: string; values: Row; filters: Array<[string, unknown]> }> = [];
  const supabase = {
    calls,
    inserts,
    updates,
    from(table: string) {
      let insertValues: Row | null = null;
      let updateValues: Row = {};
      const filters: Array<[string, unknown]> = [];
      const builder = {
        insert(values: Row) {
          insertValues = values;
          return builder;
        },
        update(values: Row) {
          updateValues = values;
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        select() {
          return builder;
        },
        async maybeSingle() {
          calls.push({ kind: "query", table, method: "maybeSingle" });
          if (insertValues) {
            inserts.push({ table, values: insertValues });
            return {
              data: options.signature ?? {
                id: "signature-1",
                contract_id: "contract-1",
                contract_version_id: "version-1",
                organization_id: "org-1",
                store_id: "store-1",
                signer_type: "store",
                signer_user_id: "user-1",
                signer_name: "Responsavel da loja",
                status: "signed",
                signed_at: "signed-at",
                acceptance_text: "Confirmo",
                metadata: { source: "api_sales_contracts_store_sign" },
              },
              error: options.signatureError ?? null,
            };
          }
          updates.push({ table, values: updateValues, filters: [...filters] });
          if (table === "sales_contracts") {
            return {
              data: options.contractUpdate ?? contract({ status: "completed" }),
              error: options.contractUpdateError ?? null,
            };
          }
          return {
            data: options.versionUpdate ?? version({ status: "completed" }),
            error: options.versionUpdateError ?? null,
          };
        },
      };
      return builder;
    },
  };
  return supabase;
}

function context() {
  return { params: Promise.resolve({ contractId: "contract-1" }) };
}

async function readResponse(response: Response) {
  return { response, body: await response.json() };
}

function setup(options: {
  supabase?: ReturnType<typeof createSupabase>;
  testScope?: Row;
  resolveAccess?: unknown;
  resolveContract?: unknown;
  loadExistingSignature?: unknown;
  registerBusinessEvent?: unknown;
  pushAssistantReviewMessage?: unknown;
} = {}) {
  const supabase = options.supabase ?? createSupabase();
  const testScope = options.testScope ?? scope({ supabase });
  return {
    supabase,
    handler: createSalesContractStoreSignPostHandler({
      resolveAccess:
        (options.resolveAccess as never) ?? (async () => granted(supabase)) as never,
      resolveContract:
        (options.resolveContract as never) ?? (async () => testScope) as never,
      loadExistingSignature:
        (options.loadExistingSignature as never) ?? (async () => null) as never,
      registerBusinessEvent:
        (options.registerBusinessEvent as never) ?? (async () => undefined) as never,
      pushAssistantReviewMessage:
        (options.pushAssistantReviewMessage as never) ?? (async () => undefined) as never,
    }),
  };
}

async function testAuthorityAndScope() {
  let contractCalls = 0;
  let lookupCalls = 0;
  const supabase = createSupabase();
  const setupDenied = setup({
    supabase,
    resolveAccess: (async (params: { requirement: "active" }) => {
      assert.deepEqual(params, { requirement: "active" });
      return denied();
    }) as never,
    resolveContract: (async () => {
      contractCalls += 1;
      throw new Error("must not resolve contract");
    }) as never,
    loadExistingSignature: (async () => {
      lookupCalls += 1;
      throw new Error("must not lookup signature");
    }) as never,
  });
  const request = { json: async () => { throw new Error("body must not be read"); } } as unknown as Request;
  const deniedResult = await readResponse(await setupDenied.handler(request, context()));
  assert.equal(deniedResult.response.status, 401);
  assert.equal(deniedResult.body.error, "STORE_API_UNAUTHENTICATED");
  assert.equal(contractCalls, 0);
  assert.equal(lookupCalls, 0);
  assert.equal(supabase.inserts.length, 0);
  assert.equal(supabase.updates.length, 0);

  let receivedScope: ContractAuthorizedStoreScope | undefined;
  const canonicalSetup = setup({
    resolveContract: (async (_id: string, authorizedScope: ContractAuthorizedStoreScope) => {
      receivedScope = authorizedScope;
      return scope({ supabase: createSupabase() });
    }) as never,
  });
  const canonicalResult = await readResponse(
    await canonicalSetup.handler(new Request("http://test", { method: "POST", body: "{}" }), context()),
  );
  assert.equal(canonicalResult.response.status, 200);
  assert.deepEqual(receivedScope, {
    organizationId: "org-1",
    storeId: "store-1",
    sessionUserId: "user-1",
  });
}

async function testDefenseInDepth() {
  const scopes = [
    scope({ organizationId: "org-2" }),
    scope({ store: { id: "store-2" } }),
    scope({ store: { organization_id: "org-2" } }),
    scope({ contract: { organization_id: "org-2" } }),
    scope({ contract: { store_id: "store-2" } }),
    scope({ currentVersion: version({ id: "version-2" }) }),
    scope({ currentVersion: version({ contract_id: "contract-2" }) }),
    scope({ currentVersion: version({ organization_id: "org-2" }) }),
    scope({ currentVersion: version({ store_id: "store-2" }) }),
  ];
  for (const testScope of scopes) {
    const supabase = createSupabase();
    const configured = setup({ testScope: { ...testScope, supabase }, supabase });
    const result = await readResponse(
      await configured.handler(new Request("http://test", { method: "POST", body: "{}" }), context()),
    );
    assert.equal(result.response.status, 403);
    assert.equal(result.body.error, "CONTRACT_SCOPE_MISMATCH");
    assert.equal(supabase.inserts.length, 0);
    assert.equal(supabase.updates.length, 0);
  }
}

async function testDomainRulesAndExistingSignature() {
  const cases: Array<[Row, number, string]> = [
    [contract({ status: "completed" }), 409, "CONTRACT_STATUS_NOT_SIGNABLE"],
    [contract({ status: "approved" }), 409, "CONTRACT_CUSTOMER_SIGNATURE_REQUIRED"],
    [contract({ current_version_id: null }), 400, "CONTRACT_VERSION_REQUIRED"],
  ];
  for (const [testContract, status, error] of cases) {
    const supabase = createSupabase();
    const configured = setup({ testScope: scope({ contract: testContract, supabase }), supabase });
    const result = await readResponse(
      await configured.handler(new Request("http://test", { method: "POST", body: "{}" }), context()),
    );
    assert.equal(result.response.status, status);
    assert.equal(result.body.error, error);
    assert.equal(supabase.inserts.length, 0);
  }

  const missingVersionSupabase = createSupabase();
  const missingVersion = setup({
    testScope: scope({ currentVersion: null, supabase: missingVersionSupabase }),
    supabase: missingVersionSupabase,
  });
  const missingVersionResult = await readResponse(
    await missingVersion.handler(new Request("http://test", { method: "POST", body: "{}" }), context()),
  );
  assert.equal(missingVersionResult.response.status, 404);
  assert.equal(missingVersionResult.body.error, "CONTRACT_VERSION_NOT_FOUND");

  const existingSupabase = createSupabase();
  const existing = setup({
    supabase: existingSupabase,
    loadExistingSignature: (async () => ({ id: "existing-signature" })) as never,
  });
  const existingResult = await readResponse(
    await existing.handler(new Request("http://test", { method: "POST", body: "{}" }), context()),
  );
  assert.equal(existingResult.response.status, 409);
  assert.equal(existingResult.body.error, "STORE_SIGNATURE_ALREADY_EXISTS");
  assert.equal(existingSupabase.inserts.length, 0);
  assert.equal(existingSupabase.updates.length, 0);
}

async function testSignaturePayloadAndSuccess() {
  const supabase = createSupabase({
    signature: {
      id: "signature-1",
      contract_id: "contract-1",
      contract_version_id: "version-1",
      organization_id: "org-1",
      store_id: "store-1",
      signer_type: "store",
      signer_user_id: "user-1",
      signer_name: "Ana",
      status: "signed",
      signed_at: "signed-at",
      acceptance_text: "Confirmo",
      metadata: { source: "api_sales_contracts_store_sign" },
    },
  });
  const events: Row[] = [];
  const assistantMessages: Row[] = [];
  const configured = setup({
    supabase,
    registerBusinessEvent: (async (input: Row) => { events.push(input); }) as never,
    pushAssistantReviewMessage: (async (input: Row) => { assistantMessages.push(input); }) as never,
  });
  const response = await readResponse(
    await configured.handler(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ signerName: "Ana", acceptanceText: "Confirmo" }),
      }),
      context(),
    ),
  );
  assert.equal(response.response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.signature.id, "signature-1");
  assert.equal(response.body.contract.status, "completed");
  assert.equal(response.body.current_version.status, "completed");

  assert.deepEqual(supabase.inserts[0], {
    table: "sales_contract_signatures",
    values: {
      contract_id: "contract-1",
      contract_version_id: "version-1",
      organization_id: "org-1",
      store_id: "store-1",
      signer_type: "store",
      signer_user_id: "user-1",
      signer_name: "Ana",
      status: "signed",
      signed_at: supabase.inserts[0].values.signed_at,
      acceptance_text: "Confirmo",
      metadata: { source: "api_sales_contracts_store_sign" },
    },
  });
  assert.deepEqual(supabase.updates[0].filters, [
    ["id", "contract-1"],
    ["organization_id", "org-1"],
    ["store_id", "store-1"],
  ]);
  assert.equal(supabase.updates[0].values.completed_by, "user-1");
  assert.deepEqual(supabase.updates[1].filters, [
    ["id", "version-1"],
    ["contract_id", "contract-1"],
    ["organization_id", "org-1"],
    ["store_id", "store-1"],
  ]);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.eventKey), [
    "contrato_assinado_loja",
    "contrato_concluido",
  ]);
  for (const event of events) {
    assert.equal(event.organizationId, "org-1");
    assert.equal(event.storeId, "store-1");
    assert.equal(event.actorType, "human");
    assert.equal(event.actorUserId, "user-1");
  }
  assert.equal(assistantMessages.length, 1);
  assert.equal(assistantMessages[0].organizationId, "org-1");
  assert.equal(assistantMessages[0].storeId, "store-1");
  assert.equal(assistantMessages[0].documentStatus, "completed");
}

async function testReturnedMismatchAndAssistantFailure() {
  for (const signature of [
    { id: "s", contract_id: "contract-2" },
    { id: "s", contract_version_id: "version-2" },
    { id: "s", organization_id: "org-2" },
    { id: "s", store_id: "store-2" },
  ]) {
    const supabase = createSupabase({ signature: { ...signature, signer_type: "store" } });
    const configured = setup({ supabase });
    const result = await readResponse(
      await configured.handler(new Request("http://test", { method: "POST", body: "{}" }), context()),
    );
    assert.equal(result.response.status, 500);
    assert.equal(result.body.error, "UNEXPECTED_ERROR");
    assert.equal(supabase.updates.length, 0);
  }

  for (const contractUpdate of [
    contract({ id: "contract-2" }),
    contract({ organization_id: "org-2" }),
    contract({ store_id: "store-2" }),
  ]) {
    const supabase = createSupabase({ contractUpdate });
    let eventCount = 0;
    const configured = setup({
      supabase,
      registerBusinessEvent: (async () => { eventCount += 1; }) as never,
    });
    const result = await readResponse(
      await configured.handler(new Request("http://test", { method: "POST", body: "{}" }), context()),
    );
    assert.equal(result.response.status, 500);
    assert.equal(eventCount, 0);
  }

  const versionMismatch = createSupabase({ versionUpdate: version({ organization_id: "org-2" }) });
  let eventCount = 0;
  const mismatchSetup = setup({
    supabase: versionMismatch,
    registerBusinessEvent: (async () => { eventCount += 1; }) as never,
  });
  const mismatchResult = await readResponse(
    await mismatchSetup.handler(new Request("http://test", { method: "POST", body: "{}" }), context()),
  );
  assert.equal(mismatchResult.response.status, 500);
  assert.equal(eventCount, 0);

  const assistantFailure = setup({
    pushAssistantReviewMessage: (async () => { throw new Error("assistant unavailable"); }) as never,
  });
  const success = await readResponse(
    await assistantFailure.handler(new Request("http://test", { method: "POST", body: "{}" }), context()),
  );
  assert.equal(success.response.status, 200);
  assert.equal(success.body.ok, true);
}

async function testErrorContracts() {
  const accessErrorSetup = setup({
    resolveContract: (async () => {
      throw new ContractAccessError(409, "CONTRACT_BLOCKED", "blocked");
    }) as never,
  });
  const accessError = await readResponse(
    await accessErrorSetup.handler(new Request("http://test", { method: "POST", body: "{}" }), context()),
  );
  assert.equal(accessError.response.status, 409);
  assert.deepEqual(accessError.body, { ok: false, error: "CONTRACT_BLOCKED", message: "blocked" });

  const unexpectedSetup = setup({
    resolveContract: (async () => { throw new Error("unexpected"); }) as never,
  });
  const unexpected = await readResponse(
    await unexpectedSetup.handler(new Request("http://test", { method: "POST", body: "{}" }), context()),
  );
  assert.equal(unexpected.response.status, 500);
  assert.equal(unexpected.body.error, "UNEXPECTED_ERROR");
}

async function testSourceContract() {
  const source = readFileSync(
    join(process.cwd(), "src/app/api/sales-contracts/[contractId]/store-sign/route.ts"),
    "utf8",
  );
  assert.match(source, /resolveStoreApiAccess/);
  assert.match(source, /requirement: "active"/);
  assert.match(source, /createStoreApiDeniedResponse/);
  assert.match(source, /resolveExistingContractForAuthorizedStoreScope/);
  assert.doesNotMatch(source, /resolveAuthorizedExistingContract/);
  assert.match(source, /organization_id.*access\.organizationId/);
  assert.match(source, /store_id.*access\.storeId/);
  assert.match(source, /signer_user_id: access\.sessionUserId/);
  assert.match(source, /actorUserId: access\.sessionUserId/);
}

async function main() {
  const tests = [
    testAuthorityAndScope,
    testDefenseInDepth,
    testDomainRulesAndExistingSignature,
    testSignaturePayloadAndSuccess,
    testReturnedMismatchAndAssistantFailure,
    testErrorContracts,
    testSourceContract,
  ];
  for (const test of tests) await test();
  console.log(`PASS ${tests.length} store-sign route tests`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
