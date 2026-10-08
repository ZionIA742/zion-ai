import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ContractAccessError } from "@/lib/server/sales-contracts/contract-auth";
import { createSalesContractCustomerSignPostHandler } from "./route";

type Row = Record<string, unknown>;

const access = {
  ok: true as const,
  supabase: {} as never,
  sessionUserId: "session-user-1",
  organizationId: "org-1",
  storeId: "store-1",
  resolution: {} as never,
};

const contract: Row = {
  id: "contract-1",
  organization_id: "org-1",
  store_id: "store-1",
  current_version_id: "version-1",
  conversation_id: "conversation-1",
  lead_id: "lead-1",
  status: "sent_to_customer",
};

const currentVersion: Row = {
  id: "version-1",
  contract_id: "contract-1",
  organization_id: "org-1",
  store_id: "store-1",
};

function baseScope(overrides: Row = {}) {
  return {
    supabase: {} as never,
    userId: "legacy-user-must-not-cross-boundary",
    organizationId: "org-1",
    store: { id: "store-1", organization_id: "org-1", name: "Store 1" },
    contract,
    currentVersion,
    lead: { id: "lead-1", name: "Lead", phone: "+5511999999999", extra: "drop" },
    conversation: { id: "conversation-1", extra: "drop" },
    ...overrides,
  };
}

function request(body: Row = {}) {
  return new Request("http://localhost/api/sales-contracts/contract-1/customer-sign", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "test-agent",
      "x-forwarded-for": "203.0.113.10, proxy",
    },
    body: JSON.stringify(body),
  });
}

function result() {
  return {
    contract,
    currentVersion,
    signature: { id: "signature-1" },
  } as never;
}

function deniedAccess() {
  return {
    ok: false as const,
    httpStatus: 403 as const,
    resolution: {} as never,
    payload: {
      ok: false as const,
      error: "STORE_ACCESS_DENIED",
      message: "denied",
      status: "access_denied",
      reasonCode: "store_not_resolved",
    },
  };
}

test("customer-sign resolves active access before body, resolver, and helper", async () => {
  let bodyRead = false;
  let resolverCalls = 0;
  let helperCalls = 0;
  const handler = createSalesContractCustomerSignPostHandler({
    resolveAccess: (async (params) => {
      assert.deepEqual(params, { requirement: "active" });
      return deniedAccess();
    }) as never,
    resolveContract: (async () => {
      resolverCalls += 1;
      throw new Error("resolver must not run");
    }) as never,
    signAsCustomer: async () => {
      helperCalls += 1;
      throw new Error("helper must not run");
    },
  });
  const deniedRequest = {
    headers: new Headers(),
    json: async () => {
      bodyRead = true;
      throw new Error("body must not be read");
    },
  } as unknown as Request;

  const response = await handler(deniedRequest, {
    params: Promise.resolve({ contractId: "contract-1" }),
  });
  assert.equal(response.status, 403);
  assert.equal(bodyRead, false);
  assert.equal(resolverCalls, 0);
  assert.equal(helperCalls, 0);
});

test("customer-sign passes the canonical minimal scope and normalized request metadata", async () => {
  let captured: Row | null = null;
  const handler = createSalesContractCustomerSignPostHandler({
    resolveAccess: async () => access,
    resolveContract: (async () => baseScope()) as never,
    signAsCustomer: async (args) => {
      captured = args as never;
      return result();
    },
  });

  const response = await handler(
    request({
      signerName: " Ana ",
      signerPhone: " 5511 ",
      signerEmail: " mail@example.com ",
      acceptanceText: " Accept ",
    }),
    { params: Promise.resolve({ contractId: " contract-1 " }) },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    contract,
    current_version: currentVersion,
    signature: { id: "signature-1" },
  });
  assert.ok(captured);
  assert.equal((captured as Row).signerName, "Ana");
  assert.equal((captured as Row).signerPhone, "5511");
  assert.equal((captured as Row).signerEmail, "mail@example.com");
  assert.equal((captured as Row).acceptanceText, "Accept");
  assert.equal((captured as Row).userAgent, "test-agent");
  assert.equal((captured as Row).ipAddress, "203.0.113.10");
  assert.equal((captured as Row).metadataSource, "api_sales_contracts_customer_sign");
  assert.equal("expectedAnchorMessageId" in (captured as Row), false);

  const capturedScope = (captured as Row).scope as Row;
  assert.equal(capturedScope.organizationId, "org-1");
  assert.deepEqual(capturedScope.store, { id: "store-1" });
  assert.deepEqual(capturedScope.contract, contract);
  assert.deepEqual(capturedScope.currentVersion, currentVersion);
  assert.deepEqual(capturedScope.lead, { id: "lead-1", name: "Lead", phone: "+5511999999999" });
  assert.deepEqual(capturedScope.conversation, { id: "conversation-1" });
  assert.equal("userId" in capturedScope, false);
  assert.equal("sessionUserId" in capturedScope, false);
});

test("customer-sign rejects every canonical contract scope mismatch", async () => {
  const mismatchCases = [
    ["resolver organization", { organizationId: "org-2" }],
    ["store id", { store: { id: "store-2", organization_id: "org-1" } }],
    ["store organization", { store: { id: "store-1", organization_id: "org-2" } }],
    ["contract organization", { contract: { ...contract, organization_id: "org-2" } }],
    ["contract store", { contract: { ...contract, store_id: "store-2" } }],
    ["version id", { currentVersion: { ...currentVersion, id: "version-2" } }],
    ["version contract", { currentVersion: { ...currentVersion, contract_id: "contract-2" } }],
    ["version organization", { currentVersion: { ...currentVersion, organization_id: "org-2" } }],
    ["version store", { currentVersion: { ...currentVersion, store_id: "store-2" } }],
  ] as const;

  for (const [label, override] of mismatchCases) {
    let helperCalls = 0;
    const handler = createSalesContractCustomerSignPostHandler({
      resolveAccess: async () => access,
      resolveContract: (async () => baseScope(override)) as never,
      signAsCustomer: async () => {
        helperCalls += 1;
        return result();
      },
    });
    const response = await handler(request(), { params: Promise.resolve({ contractId: "contract-1" }) });
    assert.equal(response.status, 403, label);
    assert.equal((await response.json()).error, "CONTRACT_SCOPE_MISMATCH", label);
    assert.equal(helperCalls, 0, label);
  }
});

test("customer-sign fails closed when the current version is absent", async () => {
  let helperCalls = 0;
  const handler = createSalesContractCustomerSignPostHandler({
    resolveAccess: async () => access,
    resolveContract: (async () => baseScope({ currentVersion: null })) as never,
    signAsCustomer: async () => {
      helperCalls += 1;
      return result();
    },
  });
  const response = await handler(request(), { params: Promise.resolve({ contractId: "contract-1" }) });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "CONTRACT_VERSION_NOT_FOUND");
  assert.equal(helperCalls, 0);
});

test("customer-sign preserves ContractAccessError and unexpected error mapping", async () => {
  const accessError = new ContractAccessError(409, "SIGN_BLOCKED", "blocked");
  for (const [error, status, code] of [
    [accessError, 409, "SIGN_BLOCKED"],
    [new Error("boom"), 500, "UNEXPECTED_ERROR"],
  ] as const) {
    const handler = createSalesContractCustomerSignPostHandler({
      resolveAccess: async () => access,
      resolveContract: (async () => baseScope()) as never,
      signAsCustomer: async () => {
        throw error;
      },
    });
    const response = await handler(request(), { params: Promise.resolve({ contractId: "contract-1" }) });
    assert.equal(response.status, status);
    assert.equal((await response.json()).error, code);
  }
});

test("customer-sign source contract uses canonical access/resolver and no direct writes", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/api/sales-contracts/[contractId]/customer-sign/route.ts"),
    "utf8",
  );
  assert.match(source, /resolveStoreApiAccess/);
  assert.match(source, /resolveExistingContractForAuthorizedStoreScope/);
  assert.match(source, /createStoreApiDeniedResponse/);
  assert.match(source, /scope\.organizationId !== access\.organizationId/);
  assert.match(source, /scope\.store\.id !== access\.storeId/);
  assert.match(source, /currentVersion\.contract_id !== scope\.contract\.id/);
  assert.match(source, /currentVersion\.organization_id !== access\.organizationId/);
  assert.match(source, /currentVersion\.store_id !== access\.storeId/);
  assert.doesNotMatch(source, /resolveAuthorizedExistingContract/);
  assert.doesNotMatch(source, /\.from\("sales_contract_signatures"\)/);
  assert.doesNotMatch(source, /\.from\("sales_contracts"\)\.update/);
  assert.doesNotMatch(source, /\.from\("sales_contract_versions"\)\.update/);
});
