import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  ContractTextVersionError,
  createTextSalesContractVersionBySystem,
} from "./route";

function baseArgs(overrides: Record<string, unknown> = {}) {
  return {
    supabase: null,
    organizationId: "org-1",
    storeId: "store-1",
    contractId: "contract-1",
    commercialOpportunityId: "opportunity-1",
    templateVersionId: "template-version-1",
    draftId: "draft-1",
    draftRevision: 4,
    draftSha256: "a".repeat(64),
    expectedCurrentVersionId: null,
    operationKey: "p9:contract-text-pdf:contract-1:operation-1",
    requestFingerprint: "b".repeat(64),
    contentFingerprint: "c".repeat(64),
    storeFileId: "file-1",
    storageBucket: "contracts",
    storagePath: "contracts/contract-1.pdf",
    originalFilename: "contract-1.pdf",
    mimeType: "application/pdf",
    sizeBytes: 123,
    pdfSha256: "d".repeat(64),
    contractSnapshot: { identity: { contract_id: "contract-1" } },
    allowReopenApproved: false,
    ...overrides,
  } as unknown as Parameters<typeof createTextSalesContractVersionBySystem>[0];
}

async function captureError(args: Parameters<typeof createTextSalesContractVersionBySystem>[0]) {
  const logs: unknown[][] = [];
  const originalError = console.error;
  console.error = (...values: unknown[]) => logs.push(values);
  try {
    await createTextSalesContractVersionBySystem(args);
    assert.fail("expected text version authority failure");
  } catch (error) {
    return { error, logs };
  } finally {
    console.error = originalError;
  }
}

test("text RPC PostgreSQL/PostgREST errors preserve public mapping and emit sanitized diagnostics", async () => {
  const result = await captureError(
    baseArgs({
      supabase: {
        rpc: async () => ({
          data: null,
          error: {
            code: "42501",
            message: "internal details must not reach the browser",
            status: 403,
          },
        }),
      },
    }),
  );

  assert.ok(result.error instanceof ContractTextVersionError);
  assert.equal((result.error as ContractTextVersionError).code, "CONTRACT_TEXT_VERSION_FAILED");
  assert.equal((result.error as ContractTextVersionError).status, 500);
  const diagnostic = JSON.stringify(result.logs);
  assert.match(diagnostic, /create_sales_contract_text_version_by_system/);
  assert.match(diagnostic, /42501/);
  assert.doesNotMatch(diagnostic, /internal details must not reach the browser/);
});

test("text RPC zero rows remains an uncertain authority result", async () => {
  let authorityUncertain = false;
  const result = await captureError(
    baseArgs({
      onAuthorityUncertain: () => {
        authorityUncertain = true;
      },
      supabase: {
        rpc: async () => ({ data: [], error: null }),
      },
    }),
  );

  assert.ok(result.error instanceof ContractTextVersionError);
  assert.equal((result.error as ContractTextVersionError).code, "CONTRACT_TEXT_VERSION_AUTHORITY_UNCERTAIN");
  assert.equal((result.error as ContractTextVersionError).status, 503);
  assert.equal(authorityUncertain, true);
  assert.equal(result.logs.length, 0);
});

test("rejected text RPC is logged as uncertain without exposing rejection details", async () => {
  const result = await captureError(
    baseArgs({
      supabase: {
        rpc: async () => {
          throw new Error("provider secret rejection");
        },
      },
    }),
  );

  assert.ok(result.error instanceof ContractTextVersionError);
  assert.equal((result.error as ContractTextVersionError).code, "CONTRACT_TEXT_VERSION_AUTHORITY_UNCERTAIN");
  assert.equal((result.error as ContractTextVersionError).status, 503);
  const diagnostic = JSON.stringify(result.logs);
  assert.match(diagnostic, /RPC_REJECTED/);
  assert.doesNotMatch(diagnostic, /provider secret rejection/);
});
