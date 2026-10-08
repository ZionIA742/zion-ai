import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ContractAccessError,
  resolveExistingContractForAuthorizedStoreScope,
} from "@/lib/server/sales-contracts/contract-auth";
import { createSalesContractDetailGetHandler } from "./route";

type Row = Record<string, unknown>;
type Filter = { column: string; value: unknown };

type FakeState = {
  tables: Record<string, Row[]>;
  calls: Array<{ table: string; filters: Filter[] }>;
};

function createFakeSupabase(tables: Record<string, Row[]>) {
  const state: FakeState = { tables, calls: [] };

  return {
    state,
    from(table: string) {
      const filters: Filter[] = [];
      const rows = () => (state.tables[table] || []).filter((row) =>
        filters.every((filter) => row[filter.column] === filter.value),
      );
      const recordCall = () => {
        state.calls.push({ table, filters: [...filters] });
      };
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return builder;
        },
        order() {
          return builder;
        },
        async maybeSingle<T>() {
          recordCall();
          return { data: (rows()[0] || null) as T | null, error: null };
        },
        then(
          resolve: (value: { data: Row[]; error: null }) => unknown,
          reject: (error: unknown) => unknown,
        ) {
          recordCall();
          return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function baseTables() {
  return {
    sales_contracts: [
      {
        id: "contract-1",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conversation-1",
        lead_id: "lead-1",
        current_version_id: "version-1",
      },
      {
        id: "contract-foreign-store",
        organization_id: "org-1",
        store_id: "store-2",
        conversation_id: "conversation-2",
        lead_id: "lead-2",
        current_version_id: null,
      },
      {
        id: "contract-foreign-org",
        organization_id: "org-2",
        store_id: "store-foreign",
        conversation_id: "conversation-foreign",
        lead_id: "lead-foreign",
        current_version_id: null,
      },
    ],
    stores: [
      { id: "store-1", organization_id: "org-1", name: "Store 1" },
      { id: "store-2", organization_id: "org-1", name: "Store 2" },
      { id: "store-foreign", organization_id: "org-2", name: "Foreign Store" },
    ],
    conversations: [
      { id: "conversation-1", organization_id: "org-1", lead_id: "lead-1" },
      { id: "conversation-2", organization_id: "org-1", lead_id: "lead-2" },
    ],
    leads: [
      { id: "lead-1", organization_id: "org-1", store_id: "store-1", name: "Lead 1" },
      { id: "lead-2", organization_id: "org-1", store_id: "store-2", name: "Lead 2" },
    ],
    sales_contract_versions: [
      {
        id: "version-1",
        contract_id: "contract-1",
        organization_id: "org-1",
        store_id: "store-1",
        version_number: 1,
      },
    ],
    sales_contract_signatures: [
      { id: "signature-1", contract_id: "contract-1", organization_id: "org-1", store_id: "store-1" },
    ],
  };
}

function authorizedScope() {
  return { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" };
}

function grantedAccess(supabase: unknown) {
  return {
    ok: true as const,
    supabase: supabase as never,
    sessionUserId: "user-1",
    organizationId: "org-1",
    storeId: "store-1",
    resolution: {} as never,
  };
}

function deniedAccess() {
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

function validScope(supabase: unknown) {
  return {
    supabase: supabase as never,
    userId: "user-1",
    organizationId: "org-1",
    store: { id: "store-1", organization_id: "org-1", name: "Store 1" },
    conversation: { id: "conversation-1", organization_id: "org-1", lead_id: "lead-1" },
    lead: { id: "lead-1", organization_id: "org-1", store_id: "store-1" },
    contract: {
      id: "contract-1",
      organization_id: "org-1",
      store_id: "store-1",
      conversation_id: "conversation-1",
      lead_id: "lead-1",
    },
    currentVersion: { id: "version-1", contract_id: "contract-1" },
  };
}

async function responseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const tests: Array<{ name: string; run: () => Promise<void> | void }> = [
  {
    name: "authorized scope resolver rejects empty scope before service client",
    run: async () => {
      let serviceCreated = 0;
      await assert.rejects(
        () =>
          resolveExistingContractForAuthorizedStoreScope(
            "contract-1",
            { organizationId: "", storeId: "store-1", sessionUserId: "user-1" },
            { createServiceSupabaseClient: () => { serviceCreated += 1; return {} as never; } },
          ),
        (error: unknown) =>
          error instanceof ContractAccessError &&
          error.code === "INVALID_AUTHORIZED_CONTRACT_SCOPE" &&
          error.status === 500,
      );
      assert.equal(serviceCreated, 0);
    },
  },
  {
    name: "authorized scope resolver uses exact contract store and organization filters",
    run: async () => {
      const supabase = createFakeSupabase(baseTables());
      await resolveExistingContractForAuthorizedStoreScope("contract-1", authorizedScope(), {
        createServiceSupabaseClient: () => supabase as never,
      });
      assert.deepEqual(supabase.state.calls[0], {
        table: "sales_contracts",
        filters: [
          { column: "id", value: "contract-1" },
          { column: "organization_id", value: "org-1" },
          { column: "store_id", value: "store-1" },
        ],
      });
    },
  },
  {
    name: "foreign store or organization contracts are not revealed",
    run: async () => {
      for (const contractId of ["contract-foreign-store", "contract-foreign-org"]) {
        const supabase = createFakeSupabase(baseTables());
        await assert.rejects(
          () =>
            resolveExistingContractForAuthorizedStoreScope(contractId, authorizedScope(), {
              createServiceSupabaseClient: () => supabase as never,
            }),
          (error: unknown) =>
            error instanceof ContractAccessError &&
            error.code === "CONTRACT_NOT_FOUND" &&
            error.status === 404,
        );
      }
    },
  },
  {
    name: "authorized resolver scopes store lead and current version canonically",
    run: async () => {
      const supabase = createFakeSupabase(baseTables());
      const result = await resolveExistingContractForAuthorizedStoreScope("contract-1", authorizedScope(), {
        createServiceSupabaseClient: () => supabase as never,
      });
      assert.deepEqual(result.store.id, "store-1");
      assert.deepEqual(result.lead.store_id, "store-1");
      assert.deepEqual(result.currentVersion?.id, "version-1");
      assert.deepEqual(
        supabase.state.calls.slice(1).map((call) => call.filters),
        [
          [
            { column: "id", value: "store-1" },
            { column: "organization_id", value: "org-1" },
          ],
          [
            { column: "id", value: "conversation-1" },
            { column: "organization_id", value: "org-1" },
          ],
          [
            { column: "id", value: "lead-1" },
            { column: "organization_id", value: "org-1" },
            { column: "store_id", value: "store-1" },
          ],
          [
            { column: "id", value: "version-1" },
            { column: "contract_id", value: "contract-1" },
            { column: "organization_id", value: "org-1" },
            { column: "store_id", value: "store-1" },
          ],
        ],
      );
    },
  },
  {
    name: "new resolver source is independent from legacy authentication",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/sales-contracts/contract-auth.ts"),
        "utf8",
      );
      const start = source.indexOf("export async function resolveExistingContractForAuthorizedStoreScope");
      assert.notEqual(start, -1);
      const functionSource = source.slice(start);
      assert.equal(functionSource.includes("authenticateContractRequest"), false);
      assert.equal(functionSource.includes("memberships"), false);
      assert.equal(functionSource.includes("organizationIds"), false);
      assert.equal(functionSource.includes("auth.getUser"), false);
    },
  },
  {
    name: "denied canonical access prevents resolver and signatures",
    run: async () => {
      const supabase = createFakeSupabase(baseTables());
      let resolverCalls = 0;
      let requirement = "";
      const handler = createSalesContractDetailGetHandler({
        resolveAccess: async ({ requirement: received }) => {
          requirement = received;
          return deniedAccess();
        },
        resolveContract: async () => {
          resolverCalls += 1;
          throw new Error("must not resolve");
        },
      });
      const response = await handler(new Request("https://example.test"), {
        params: Promise.resolve({ contractId: "contract-1" }),
      });
      const body = await responseBody(response);
      assert.equal(requirement, "active");
      assert.equal(response.status, 401);
      assert.equal(body.error, "STORE_API_UNAUTHENTICATED");
      assert.equal(resolverCalls, 0);
      assert.equal(supabase.state.calls.length, 0);
    },
  },
  {
    name: "route delivers canonical scope and returns contract signatures",
    run: async () => {
      const supabase = createFakeSupabase(baseTables());
      let receivedScope: unknown;
      let requirement = "";
      const handler = createSalesContractDetailGetHandler({
        resolveAccess: async ({ requirement: received }) => {
          requirement = received;
          return grantedAccess(supabase);
        },
        resolveContract: async (_contractId, scope) => {
          receivedScope = scope;
          return validScope(supabase);
        },
      });
      const response = await handler(new Request("https://example.test"), {
        params: Promise.resolve({ contractId: "contract-1" }),
      });
      const body = await responseBody(response);
      assert.equal(requirement, "active");
      assert.deepEqual(receivedScope, authorizedScope());
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(body.ok, true);
      assert.equal((body.contract as Row).id, "contract-1");
      assert.equal((body.current_version as Row).id, "version-1");
      assert.equal((body.signatures as unknown[]).length, 1);
      assert.deepEqual(supabase.state.calls[0], {
        table: "sales_contract_signatures",
        filters: [
          { column: "contract_id", value: "contract-1" },
          { column: "organization_id", value: "org-1" },
          { column: "store_id", value: "store-1" },
        ],
      });
    },
  },
  {
    name: "route rejects foreign organization and store scopes before signatures",
    run: async () => {
      for (const foreignScope of [
        { organizationId: "org-2", storeId: "store-1" },
        { organizationId: "org-1", storeId: "store-2" },
      ]) {
        const supabase = createFakeSupabase(baseTables());
        const handler = createSalesContractDetailGetHandler({
          resolveAccess: async () => grantedAccess(supabase),
          resolveContract: async () => ({
            ...validScope(supabase),
            organizationId: foreignScope.organizationId,
            store: { id: foreignScope.storeId, organization_id: foreignScope.organizationId },
            contract: {
              ...validScope(supabase).contract,
              organization_id: foreignScope.organizationId,
              store_id: foreignScope.storeId,
            },
          }),
        });
        const response = await handler(new Request("https://example.test"), {
          params: Promise.resolve({ contractId: "contract-1" }),
        });
        const body = await responseBody(response);
        assert.equal(response.status, 403);
        assert.equal(body.error, "CONTRACT_SCOPE_MISMATCH");
        assert.equal(supabase.state.calls.length, 0);
      }
    },
  },
  {
    name: "route preserves domain and unexpected errors",
    run: async () => {
      const domainHandler = createSalesContractDetailGetHandler({
        resolveAccess: async () => grantedAccess({}),
        resolveContract: async () => {
          throw new ContractAccessError(409, "DOMAIN_FAILURE", "domain failure");
        },
      });
      const domainResponse = await domainHandler(new Request("https://example.test"), {
        params: Promise.resolve({ contractId: "contract-1" }),
      });
      const domainBody = await responseBody(domainResponse);
      assert.equal(domainResponse.status, 409);
      assert.deepEqual(domainBody.error, "DOMAIN_FAILURE");
      assert.deepEqual(domainBody.message, "domain failure");

      const unexpectedHandler = createSalesContractDetailGetHandler({
        resolveAccess: async () => grantedAccess({}),
        resolveContract: async () => {
          throw new Error("unexpected failure");
        },
      });
      const unexpectedResponse = await unexpectedHandler(new Request("https://example.test"), {
        params: Promise.resolve({ contractId: "contract-1" }),
      });
      const unexpectedBody = await responseBody(unexpectedResponse);
      assert.equal(unexpectedResponse.status, 500);
      assert.equal(unexpectedBody.error, "UNEXPECTED_ERROR");
    },
  },
  {
    name: "detail route source uses active canonical access and not legacy resolver",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/app/api/sales-contracts/[contractId]/route.ts"),
        "utf8",
      );
      assert.match(source, /resolveStoreApiAccess/);
      assert.match(source, /createStoreApiDeniedResponse/);
      assert.match(source, /requirement: "active"/);
      assert.match(source, /resolveExistingContractForAuthorizedStoreScope/);
      assert.doesNotMatch(source, /resolveAuthorizedExistingContract/);
    },
  },
];

async function main() {
  for (const test of tests) {
    await test.run();
    console.log(`ok - ${test.name}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
