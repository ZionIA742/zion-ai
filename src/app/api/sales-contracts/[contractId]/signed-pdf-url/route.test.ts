import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ContractAccessError,
  type ContractAuthorizedStoreScope,
} from "@/lib/server/sales-contracts/contract-auth";
import { createSignedContractPdfUrlGetHandler } from "./route";

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

function storage(options: { signedData?: Row | null; signedError?: Row | null } = {}) {
  const calls: Array<{ bucket: string; path: string; expiration: number }> = [];
  return {
    calls,
    storage: {
      from(bucket: string) {
        return {
          async createSignedUrl(path: string, expiration: number) {
            calls.push({ bucket, path, expiration });
            return {
              data: options.signedData ?? { signedUrl: "https://signed.example/pdf" },
              error: options.signedError ?? null,
            };
          },
        };
      },
    },
  };
}

function version(overrides: Row = {}) {
  return {
    id: "version-1",
    contract_id: "contract-1",
    organization_id: "org-1",
    store_id: "store-1",
    storage_bucket: "private-contracts",
    storage_path: "org-1/store-1/contract-1/version-1.pdf",
    original_filename: "contract.pdf",
    mime_type: "application/pdf",
    ...overrides,
  };
}

function makeScope(overrides: {
  organizationId?: string;
  store?: Row;
  contract?: Row;
  currentVersion?: Row | null;
  supabase?: unknown;
} = {}) {
  return {
    supabase: overrides.supabase ?? storage(),
    organizationId: overrides.organizationId ?? "org-1",
    store: { id: "store-1", organization_id: "org-1", ...overrides.store },
    contract: {
      id: "contract-1",
      organization_id: "org-1",
      store_id: "store-1",
      current_version_id: "version-1",
      ...overrides.contract,
    },
    currentVersion:
      overrides.currentVersion === undefined ? version() : overrides.currentVersion,
  };
}

async function readResponse(response: Response) {
  return { body: await response.json(), response };
}

function context(contractId: string) {
  return { params: Promise.resolve({ contractId }) };
}

async function testDeniedAccess() {
  let contractCalls = 0;
  const handler = createSignedContractPdfUrlGetHandler({
    resolveAccess: async (params) => {
      assert.deepEqual(params, { requirement: "active" });
      return denied();
    },
    resolveContract: (async () => {
      contractCalls += 1;
      throw new Error("contract resolver must not run");
    }) as never,
  });
  const { body, response } = await readResponse(
    await handler(new Request("http://test"), context("contract-1")),
  );
  assert.equal(response.status, 401);
  assert.equal(body.error, "STORE_API_UNAUTHENTICATED");
  assert.equal(contractCalls, 0);
}

async function testCanonicalScopeAndRequirement() {
  const supabase = storage();
  let receivedScope: unknown;
  const handler = createSignedContractPdfUrlGetHandler({
    resolveAccess: async (params) => {
      assert.deepEqual(params, { requirement: "active" });
      return access(supabase);
    },
    resolveContract: (async (contractId: string, authorizedScope: ContractAuthorizedStoreScope) => {
      assert.equal(contractId, "contract-1");
      receivedScope = authorizedScope;
      return { ...makeScope(), supabase };
    }) as never,
  });
  const { response } = await readResponse(
    await handler(new Request("http://test"), context("contract-1")),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(receivedScope, {
    organizationId: "org-1",
    storeId: "store-1",
    sessionUserId: "user-1",
  });
}

async function testInvalidContractId() {
  let contractCalls = 0;
  const handler = createSignedContractPdfUrlGetHandler({
    resolveAccess: async () => access(storage()),
    resolveContract: (async () => {
      contractCalls += 1;
      throw new Error("contract resolver must not run");
    }) as never,
  });
  const { body, response } = await readResponse(
    await handler(new Request("http://test"), context("  ")),
  );
  assert.equal(response.status, 400);
  assert.equal(body.error, "INVALID_CONTRACT_ID");
  assert.equal(contractCalls, 0);
}

async function testForeignScopeIsRejected() {
  const cases = [
    makeScope({ organizationId: "org-2" }),
    makeScope({ store: { id: "store-2" } }),
    makeScope({ store: { organization_id: "org-2" } }),
    makeScope({ contract: { organization_id: "org-2" } }),
    makeScope({ contract: { store_id: "store-2" } }),
  ];
  for (const foreignScope of cases) {
    const supabase = storage();
    const handler = createSignedContractPdfUrlGetHandler({
      resolveAccess: async () => access(supabase),
      resolveContract: (async () => ({ ...foreignScope, supabase })) as never,
    });
    const { body, response } = await readResponse(
      await handler(new Request("http://test"), context("contract-1")),
    );
    assert.equal(response.status, 403);
    assert.equal(body.error, "CONTRACT_SCOPE_MISMATCH");
    assert.equal(supabase.calls.length, 0);
  }
}

async function testCurrentVersionRules() {
  const cases = [
    [makeScope({ contract: { current_version_id: null } }), 404, "CONTRACT_WITHOUT_CURRENT_VERSION"],
    [makeScope({ currentVersion: null }), 404, "CONTRACT_VERSION_NOT_FOUND"],
    [makeScope({ currentVersion: version({ id: "version-2" }) }), 403, "CONTRACT_SCOPE_MISMATCH"],
    [makeScope({ currentVersion: version({ contract_id: "contract-2" }) }), 403, "CONTRACT_SCOPE_MISMATCH"],
    [makeScope({ currentVersion: version({ organization_id: "org-2" }) }), 403, "CONTRACT_SCOPE_MISMATCH"],
    [makeScope({ currentVersion: version({ store_id: "store-2" }) }), 403, "CONTRACT_SCOPE_MISMATCH"],
  ] as const;
  for (const [testScope, expectedStatus, expectedError] of cases) {
    const supabase = storage();
    const handler = createSignedContractPdfUrlGetHandler({
      resolveAccess: async () => access(supabase),
      resolveContract: (async () => ({ ...testScope, supabase })) as never,
    });
    const { body, response } = await readResponse(
      await handler(new Request("http://test"), context("contract-1")),
    );
    assert.equal(response.status, expectedStatus);
    assert.equal(body.error, expectedError);
    assert.equal(supabase.calls.length, 0);
  }
}

async function testStorageMetadataAndSigning() {
  for (const currentVersion of [version({ storage_bucket: "" }), version({ storage_path: null })]) {
    const supabase = storage();
    const handler = createSignedContractPdfUrlGetHandler({
      resolveAccess: async () => access(supabase),
      resolveContract: (async () => ({ ...makeScope({ currentVersion }), supabase })) as never,
    });
    const { body, response } = await readResponse(
      await handler(new Request("http://test"), context("contract-1")),
    );
    assert.equal(response.status, 422);
    assert.equal(body.error, "CONTRACT_PDF_STORAGE_MISSING");
    assert.equal(supabase.calls.length, 0);
  }

  const failedStorage = storage({ signedError: { message: "storage unavailable" } });
  const failureHandler = createSignedContractPdfUrlGetHandler({
    resolveAccess: async () => access(failedStorage),
    resolveContract: (async () => ({ ...makeScope(), supabase: failedStorage })) as never,
  });
  const failed = await readResponse(
    await failureHandler(new Request("http://test"), context("contract-1")),
  );
  assert.equal(failed.response.status, 500);
  assert.equal(failed.body.error, "SIGNED_URL_GENERATION_FAILED");
}

async function testSuccessAndMimeFallback() {
  const supabase = storage({ signedData: { signedUrl: "https://signed.example/result" } });
  const handler = createSignedContractPdfUrlGetHandler({
    resolveAccess: async () => access(supabase),
    resolveContract: (async () => ({ ...makeScope({ currentVersion: version({ mime_type: null }) }), supabase })) as never,
  });
  const { body, response } = await readResponse(
    await handler(new Request("http://test"), context("contract-1")),
  );
  assert.deepEqual(body, {
    ok: true,
    signedUrl: "https://signed.example/result",
    originalFilename: "contract.pdf",
    mimeType: "application/pdf",
    expiresIn: 900,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(supabase.calls, [{
    bucket: "private-contracts",
    path: "org-1/store-1/contract-1/version-1.pdf",
    expiration: 900,
  }]);
}

async function testErrorContracts() {
  const contractErrorHandler = createSignedContractPdfUrlGetHandler({
    resolveAccess: async () => access(storage()),
    resolveContract: (async () => {
      throw new ContractAccessError(409, "CONTRACT_BLOCKED", "blocked");
    }) as never,
  });
  const contractError = await readResponse(
    await contractErrorHandler(new Request("http://test"), context("contract-1")),
  );
  assert.equal(contractError.response.status, 409);
  assert.deepEqual(contractError.body, {
    ok: false,
    error: "CONTRACT_BLOCKED",
    message: "blocked",
  });

  const unexpectedHandler = createSignedContractPdfUrlGetHandler({
    resolveAccess: async () => access(storage()),
    resolveContract: (async () => {
      throw new Error("unexpected");
    }) as never,
  });
  const unexpected = await readResponse(
    await unexpectedHandler(new Request("http://test"), context("contract-1")),
  );
  assert.equal(unexpected.response.status, 500);
  assert.equal(unexpected.body.error, "SIGNED_CONTRACT_PDF_URL_FAILED");
}

async function testSourceContract() {
  const source = readFileSync(
    join(process.cwd(), "src/app/api/sales-contracts/[contractId]/signed-pdf-url/route.ts"),
    "utf8",
  );
  assert.match(source, /resolveStoreApiAccess/);
  assert.match(source, /requirement: "active"/);
  assert.match(source, /createStoreApiDeniedResponse/);
  assert.match(source, /resolveExistingContractForAuthorizedStoreScope/);
  assert.doesNotMatch(source, /resolveAuthorizedExistingContract/);
}

async function main() {
  const tests = [
    testDeniedAccess,
    testCanonicalScopeAndRequirement,
    testInvalidContractId,
    testForeignScopeIsRejected,
    testCurrentVersionRules,
    testStorageMetadataAndSigning,
    testSuccessAndMimeFallback,
    testErrorContracts,
    testSourceContract,
  ];
  for (const test of tests) await test();
  console.log(`PASS ${tests.length} signed-pdf-url route tests`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
