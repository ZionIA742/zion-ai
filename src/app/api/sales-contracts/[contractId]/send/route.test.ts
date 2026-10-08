import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ContractAccessError,
  type ContractAuthorizedStoreScope,
} from "@/lib/server/sales-contracts/contract-auth";
import { createSalesContractSendPostHandler } from "./route";

type Row = Record<string, unknown>;

function access(supabase: unknown) {
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

function baseContract(overrides: Row = {}) {
  return {
    id: "contract-1",
    organization_id: "org-1",
    store_id: "store-1",
    status: "approved",
    conversation_id: "conversation-1",
    lead_id: "lead-1",
    current_version_id: "version-1",
    contract_number: "C-001",
    quote_id: "quote-1",
    quote_version_id: "quote-version-1",
    ...overrides,
  };
}

function baseVersion(overrides: Row = {}) {
  return {
    id: "version-1",
    contract_id: "contract-1",
    organization_id: "org-1",
    store_id: "store-1",
    storage_bucket: "contracts",
    storage_path: "org-1/store-1/contract-1/version-1.pdf",
    original_filename: "contract.pdf",
    mime_type: "application/pdf",
    size_bytes: 1234,
    ...overrides,
  };
}

function baseScope(overrides: {
  organizationId?: string;
  store?: Row;
  contract?: Row;
  currentVersion?: Row | null;
  supabase?: unknown;
} = {}) {
  return {
    supabase: overrides.supabase,
    organizationId: overrides.organizationId ?? "org-1",
    userId: "user-1",
    store: { id: "store-1", organization_id: "org-1", ...overrides.store },
    conversation: { id: "conversation-1" },
    lead: { id: "lead-1" },
    contract: { ...baseContract(), ...overrides.contract },
    currentVersion:
      overrides.currentVersion === undefined
        ? baseVersion()
        : overrides.currentVersion,
  };
}

function createSupabase(options: {
  insertData?: unknown;
  insertError?: Row | null;
  contractUpdate?: Row | null;
  contractUpdateError?: Row | null;
  versionUpdate?: Row | null;
  versionUpdateError?: Row | null;
} = {}) {
  const calls: Array<{ kind: string; table?: string; method?: string; args?: unknown[] }> = [];
  const updates: Array<{ table: string; values: Row; filters: Array<[string, unknown]> }> = [];
  const supabase = {
    calls,
    updates,
    async rpc(name: string, args: Row) {
      calls.push({ kind: "rpc", method: name, args: [args] });
      if (name === "insert_message") {
        return {
          data: options.insertData ?? { id: "message-1" },
          error: options.insertError ?? null,
        };
      }
      return { data: {}, error: null };
    },
    from(table: string) {
      let values: Row = {};
      const filters: Array<[string, unknown]> = [];
      const builder = {
        update(nextValues: Row) {
          values = nextValues;
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
          updates.push({ table, values, filters: [...filters] });
          if (table === "sales_contracts") {
            return {
              data: options.contractUpdate ?? baseContract({ status: "sent_to_customer" }),
              error: options.contractUpdateError ?? null,
            };
          }
          return {
            data: options.versionUpdate ?? baseVersion({ status: "sent" }),
            error: options.versionUpdateError ?? null,
          };
        },
      };
      return builder;
    },
  };
  return supabase;
}

function context(contractId = "contract-1") {
  return { params: Promise.resolve({ contractId }) };
}

async function bodyOf(response: Response) {
  return { response, body: await response.json() };
}

function handlerFor(options: {
  scope?: Row;
  supabase?: ReturnType<typeof createSupabase>;
  resolveAccess?: (params: { requirement: "active" }) => Promise<ReturnType<typeof access>>;
  resolveContract?: unknown;
  registerBusinessEvent?: unknown;
} = {}) {
  const supabase = options.supabase ?? createSupabase();
  const scope = options.scope ?? baseScope({ supabase });
  return {
    supabase,
    handler: createSalesContractSendPostHandler({
      resolveAccess: options.resolveAccess ?? (async () => access(supabase)),
      resolveContract:
        (options.resolveContract as never) ??
        (async () => scope) as never,
      registerBusinessEvent:
        (options.registerBusinessEvent as never) ?? (async () => undefined) as never,
    }),
  };
}

async function testDeniedAndCanonicalScope() {
  let resolveContractCalls = 0;
  const deniedSupabase = createSupabase();
  const deniedSetup = handlerFor({
    supabase: deniedSupabase,
    resolveAccess: (async (params: { requirement: "active" }) => {
      assert.deepEqual(params, { requirement: "active" });
      return denied();
    }) as never,
    resolveContract: (async () => {
      resolveContractCalls += 1;
      throw new Error("must not resolve contract");
    }) as never,
    registerBusinessEvent: (async () => {
      throw new Error("must not register event");
    }) as never,
  });
  const deniedResult = await bodyOf(
    await deniedSetup.handler(new Request("http://test"), context()),
  );
  assert.equal(deniedResult.response.status, 401);
  assert.equal(deniedResult.body.error, "STORE_API_UNAUTHENTICATED");
  assert.equal(resolveContractCalls, 0);
  assert.equal(deniedSupabase.calls.length, 0);

  const canonicalSupabase = createSupabase();
  let receivedScope: ContractAuthorizedStoreScope | undefined;
  const canonicalSetup = handlerFor({
    supabase: canonicalSupabase,
    resolveContract: (async (_contractId: string, authorizedScope: ContractAuthorizedStoreScope) => {
      receivedScope = authorizedScope;
      return baseScope({ supabase: canonicalSupabase });
    }) as never,
  });
  const canonicalResult = await bodyOf(
    await canonicalSetup.handler(new Request("http://test"), context()),
  );
  assert.equal(canonicalResult.response.status, 200);
  assert.deepEqual(receivedScope, {
    organizationId: "org-1",
    storeId: "store-1",
    sessionUserId: "user-1",
  });
}

async function testForeignScopeAndVersionMismatch() {
  const scopes = [
    baseScope({ organizationId: "org-2" }),
    baseScope({ store: { id: "store-2" } }),
    baseScope({ store: { organization_id: "org-2" } }),
    baseScope({ contract: { organization_id: "org-2" } }),
    baseScope({ contract: { store_id: "store-2" } }),
    baseScope({ currentVersion: baseVersion({ id: "version-2" }) }),
    baseScope({ currentVersion: baseVersion({ contract_id: "contract-2" }) }),
    baseScope({ currentVersion: baseVersion({ organization_id: "org-2" }) }),
    baseScope({ currentVersion: baseVersion({ store_id: "store-2" }) }),
  ];
  for (const scope of scopes) {
    const supabase = createSupabase();
    const setup = handlerFor({ scope: { ...scope, supabase }, supabase });
    const result = await bodyOf(
      await setup.handler(new Request("http://test"), context()),
    );
    assert.equal(result.response.status, 403);
    assert.equal(result.body.error, "CONTRACT_SCOPE_MISMATCH");
    assert.equal(supabase.calls.length, 0);
    assert.equal(supabase.updates.length, 0);
  }
}

async function testStatusAndRequiredFields() {
  const cases: Array<[Row, number, string]> = [
    [baseContract({ status: "completed" }), 409, "CONTRACT_STATUS_NOT_SENDABLE"],
    [baseContract({ status: "sent_to_customer" }), 409, "CONTRACT_ALREADY_SENT"],
    [baseContract({ status: "draft" }), 409, "CONTRACT_REQUIRES_APPROVAL"],
    [baseContract({ conversation_id: null }), 400, "CONTRACT_CONVERSATION_REQUIRED"],
    [baseContract({ current_version_id: null }), 400, "CONTRACT_VERSION_REQUIRED"],
  ];
  for (const [contract, status, error] of cases) {
    const supabase = createSupabase();
    const setup = handlerFor({ scope: baseScope({ contract, supabase }), supabase });
    const result = await bodyOf(
      await setup.handler(new Request("http://test"), context()),
    );
    assert.equal(result.response.status, status);
    assert.equal(result.body.error, error);
    assert.equal(supabase.calls.length, 0);
  }

  const missingVersion = createSupabase();
  const missingVersionSetup = handlerFor({
    scope: baseScope({ currentVersion: null, supabase: missingVersion }),
    supabase: missingVersion,
  });
  const missingVersionResult = await bodyOf(
    await missingVersionSetup.handler(new Request("http://test"), context()),
  );
  assert.equal(missingVersionResult.response.status, 404);
  assert.equal(missingVersionResult.body.error, "CONTRACT_VERSION_NOT_FOUND");

  for (const currentVersion of [
    baseVersion({ storage_bucket: "" }),
    baseVersion({ storage_path: "" }),
  ]) {
    const supabase = createSupabase();
    const setup = handlerFor({ scope: baseScope({ currentVersion, supabase }), supabase });
    const result = await bodyOf(
      await setup.handler(new Request("http://test"), context()),
    );
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error, "CONTRACT_FILE_MISSING");
    assert.equal(supabase.calls.length, 0);
  }

  const noFilenameSupabase = createSupabase();
  const noFilename = handlerFor({
    scope: baseScope({ currentVersion: baseVersion({ original_filename: "" }), supabase: noFilenameSupabase }),
    supabase: noFilenameSupabase,
  });
  const noFilenameResult = await bodyOf(
    await noFilename.handler(new Request("http://test"), context()),
  );
  assert.equal(noFilenameResult.response.status, 400);
  assert.equal(noFilenameResult.body.error, "CONTRACT_FILENAME_MISSING");
}

async function testSuccessfulMutationsAndEvent() {
  const supabase = createSupabase();
  const eventCalls: Row[] = [];
  const setup = handlerFor({
    supabase,
    registerBusinessEvent: (async (input: Row) => {
      eventCalls.push(input);
    }) as never,
  });
  const result = await bodyOf(
    await setup.handler(new Request("http://test"), context()),
  );
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, {
    ok: true,
    contract: baseContract({ status: "sent_to_customer" }),
    current_version: baseVersion({ status: "sent" }),
    messageId: "message-1",
  });

  const insertCall = supabase.calls.find((call) => call.kind === "rpc");
  assert.equal(insertCall?.method, "insert_message");
  const insertArgs = insertCall?.args?.[0] as Row;
  assert.equal(insertArgs.p_conversation_id, "conversation-1");
  assert.equal(insertArgs.p_sender, "human");
  assert.equal(insertArgs.p_direction, "outgoing");
  assert.equal(insertArgs.p_message_type, "text");
  assert.equal(insertArgs.p_content, "Enviei o contrato para voce conferir. Qualquer duvida me avisa.");
  assert.equal(insertArgs.p_external_message_id, null);
  assert.equal(insertArgs.p_media_url, null);
  assert.deepEqual(insertArgs.p_metadata, {
    attachment_kind: "file",
    storage_bucket: "zion-store-files",
    storage_path: "org-1/store-1/contract-1/version-1.pdf",
    mime_type: "application/pdf",
    original_file_name: "contract.pdf",
    size_bytes: 1234,
    file_kind: "sales_contract_pdf",
    contract_id: "contract-1",
    contract_version_id: "version-1",
    contract_number: "C-001",
    quote_id: "quote-1",
    quote_version_id: "quote-version-1",
    private: true,
    generated_by: "system",
    sales_contract_id: "contract-1",
    sales_contract_version_id: "version-1",
  });

  assert.deepEqual(supabase.updates[0], {
    table: "sales_contracts",
    values: {
      status: "sent_to_customer",
      sent_at: supabase.updates[0].values.sent_at,
      sent_by: "user-1",
    },
    filters: [
      ["id", "contract-1"],
      ["organization_id", "org-1"],
      ["store_id", "store-1"],
    ],
  });
  assert.deepEqual(supabase.updates[1].filters, [
    ["id", "version-1"],
    ["contract_id", "contract-1"],
    ["organization_id", "org-1"],
    ["store_id", "store-1"],
  ]);
  assert.equal(supabase.updates[1].values.status, "sent");
  assert.equal(eventCalls.length, 1);
  assert.equal(eventCalls[0].organizationId, "org-1");
  assert.equal(eventCalls[0].storeId, "store-1");
  assert.equal(eventCalls[0].actorType, "human");
  assert.equal(eventCalls[0].actorUserId, "user-1");
}

async function testReturnedScopeMismatchAndErrorContracts() {
  for (const contractUpdate of [
    baseContract({ id: "contract-2" }),
    baseContract({ organization_id: "org-2" }),
    baseContract({ store_id: "store-2" }),
  ]) {
    const supabase = createSupabase({ contractUpdate });
    let eventCalls = 0;
    const setup = handlerFor({
      supabase,
      registerBusinessEvent: (async () => {
        eventCalls += 1;
      }) as never,
    });
    const result = await bodyOf(
      await setup.handler(new Request("http://test"), context()),
    );
    assert.equal(result.response.status, 500);
    assert.equal(result.body.error, "UNEXPECTED_ERROR");
    assert.equal(eventCalls, 0);
  }

  const versionMismatch = createSupabase({
    versionUpdate: baseVersion({ organization_id: "org-2" }),
  });
  let eventCalls = 0;
  const setup = handlerFor({
    supabase: versionMismatch,
    registerBusinessEvent: (async () => {
      eventCalls += 1;
    }) as never,
  });
  const result = await bodyOf(
    await setup.handler(new Request("http://test"), context()),
  );
  assert.equal(result.response.status, 500);
  assert.equal(result.body.error, "UNEXPECTED_ERROR");
  assert.equal(eventCalls, 0);
}

async function testAccessAndUnexpectedErrors() {
  const accessErrorSetup = handlerFor({
    resolveContract: (async () => {
      throw new ContractAccessError(409, "CONTRACT_BLOCKED", "blocked");
    }) as never,
  });
  const accessError = await bodyOf(
    await accessErrorSetup.handler(new Request("http://test"), context()),
  );
  assert.equal(accessError.response.status, 409);
  assert.deepEqual(accessError.body, {
    ok: false,
    error: "CONTRACT_BLOCKED",
    message: "blocked",
  });

  const unexpectedSetup = handlerFor({
    resolveContract: (async () => {
      throw new Error("unexpected");
    }) as never,
  });
  const unexpected = await bodyOf(
    await unexpectedSetup.handler(new Request("http://test"), context()),
  );
  assert.equal(unexpected.response.status, 500);
  assert.equal(unexpected.body.error, "UNEXPECTED_ERROR");
}

async function testSourceContract() {
  const source = readFileSync(
    join(process.cwd(), "src/app/api/sales-contracts/[contractId]/send/route.ts"),
    "utf8",
  );
  assert.match(source, /resolveStoreApiAccess/);
  assert.match(source, /requirement: "active"/);
  assert.match(source, /createStoreApiDeniedResponse/);
  assert.match(source, /resolveExistingContractForAuthorizedStoreScope/);
  assert.doesNotMatch(source, /resolveAuthorizedExistingContract/);
  assert.match(source, /\.eq\("organization_id", access\.organizationId\)/);
  assert.match(source, /\.eq\("store_id", access\.storeId\)/);
  assert.match(source, /\.eq\("contract_id", scope\.contract\.id\)/);
}

async function main() {
  const tests = [
    testDeniedAndCanonicalScope,
    testForeignScopeAndVersionMismatch,
    testStatusAndRequiredFields,
    testSuccessfulMutationsAndEvent,
    testReturnedScopeMismatchAndErrorContracts,
    testAccessAndUnexpectedErrors,
    testSourceContract,
  ];
  for (const test of tests) await test();
  console.log(`PASS ${tests.length} send route tests`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
