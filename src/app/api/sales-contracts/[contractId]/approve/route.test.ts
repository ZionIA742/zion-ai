import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApproveContractPostHandler } from "./route";

type Row = Record<string, unknown>;

function createSupabaseMock(overrides: { sales_contracts?: Row[]; sales_contract_versions?: Row[] } = {}) {
  const calls: Array<{ table: string; operation: string; filters: Row[] }> = [];
  const tables: Record<string, Row[]> = {
    sales_contracts: [
      {
        id: "contract-1",
        organization_id: "org-1",
        store_id: "store-1",
        current_version_id: "version-1",
        status: "approved",
        approved_at: "2026-10-08T14:00:00.000Z",
        approved_by: "user-1",
        contract_number: "CTR-1",
      },
    ],
    sales_contract_versions: [
      {
        id: "version-1",
        contract_id: "contract-1",
        organization_id: "org-1",
        store_id: "store-1",
        status: "approved",
        approved_at: "2026-10-08T14:00:00.000Z",
        storage_bucket: "zion-store-files",
        storage_path: "org-1/store-1/contracts/contract-1.pdf",
      },
    ],
  };
  if (overrides.sales_contracts) tables.sales_contracts = overrides.sales_contracts;
  if (overrides.sales_contract_versions) tables.sales_contract_versions = overrides.sales_contract_versions;

  return {
    calls,
    from(table: string) {
      const filters: Row[] = [];
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
        update() {
          throw new Error(`direct update forbidden: ${table}`);
        },
        async maybeSingle<T>() {
          calls.push({ table, operation: "maybeSingle", filters: [...filters] });
          const row = (tables[table] || []).find((candidate) =>
            filters.every((filter) => candidate[String(filter.column)] === filter.value),
          );
          return { data: (row || null) as T | null, error: null };
        },
      };
      return builder;
    },
  };
}

function baseScope(supabase: unknown) {
  return {
    supabase: supabase as never,
    userId: "user-1",
    organizationId: "org-1",
    store: { id: "store-1", organization_id: "org-1", name: "Store 1" },
    conversation: { id: "conversation-1" },
    lead: { id: "lead-1" },
    contract: {
      id: "contract-1",
      organization_id: "org-1",
      store_id: "store-1",
      current_version_id: "version-1",
      status: "pending_review",
      contract_number: "CTR-1",
      conversation_id: "conversation-1",
      lead_id: "lead-1",
    },
    currentVersion: {
      id: "version-1",
      contract_id: "contract-1",
      organization_id: "org-1",
      store_id: "store-1",
      status: "generated",
      storage_bucket: "zion-store-files",
      storage_path: "org-1/store-1/contracts/contract-1.pdf",
    },
  };
}

function authorityResult(overrides: Row = {}) {
  return {
    outcome: "approved",
    replayed: false,
    reconciled: false,
    contract_id: "contract-1",
    contract_version_id: "version-1",
    contract_status: "approved",
    version_status: "approved",
    approved_at: "2026-10-08T14:00:00.000Z",
    approved_by: "user-1",
    ...overrides,
  };
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
      error: "STORE_API_UNAUTHENTICATED" as const,
      message: "Nao autenticado.",
      status: "anonymous" as const,
      reasonCode: "anonymous" as const,
    },
    resolution: {} as never,
  };
}

async function callRoute(args: {
  scope?: Row;
  authority?: Row;
  authorityError?: Error;
  eventError?: Error;
  resolveAccess?: (params: { requirement: "active" }) => Promise<unknown>;
  resolveScope?: (scope: Row) => Row;
  durableContract?: Row;
  durableVersion?: Row;
}) {
  const supabase = createSupabaseMock({
    sales_contracts: args.durableContract ? [args.durableContract] : undefined,
    sales_contract_versions: args.durableVersion ? [args.durableVersion] : undefined,
  });
  const eventCalls: Row[] = [];
  const rpcCalls: Row[] = [];
  const handler = createApproveContractPostHandler({
    resolveAccess: (args.resolveAccess ?? (async () => grantedAccess(supabase))) as never,
    resolveContract: (async (_contractId: string, authorizedScope: Row) => {
      const resolved = args.resolveScope?.(args.scope || baseScope(supabase)) || args.scope || baseScope(supabase);
      (resolved as Row).authorizedScope = authorizedScope;
      return resolved;
    }) as never,
    approveContract: async (input) => {
      rpcCalls.push(input as unknown as Row);
      if (args.authorityError) throw args.authorityError;
      return (args.authority || authorityResult()) as never;
    },
    registerContractBusinessEvent: async (input) => {
      eventCalls.push(input as unknown as Row);
      if (args.eventError) throw args.eventError;
    },
  });
  const response = await handler(new Request("https://example.test"), {
    params: Promise.resolve({ contractId: "contract-1" }),
  });
  return {
    response,
    body: (await response.json()) as Row,
    supabase,
    eventCalls,
    rpcCalls,
  };
}

const tests: Array<{ name: string; run: () => Promise<void> | void }> = [
  {
    name: "denied canonical access returns before resolver authority rereads or event",
    run: async () => {
      const supabase = createSupabaseMock();
      let resolveCalls = 0;
      let authorityCalls = 0;
      let eventCalls = 0;
      const handler = createApproveContractPostHandler({
        resolveAccess: (async (params: { requirement: "active" }) => {
          assert.deepEqual(params, { requirement: "active" });
          return deniedAccess();
        }) as never,
        resolveContract: (async () => { resolveCalls += 1; throw new Error("must not resolve"); }) as never,
        approveContract: (async () => { authorityCalls += 1; throw new Error("must not approve"); }) as never,
        registerContractBusinessEvent: (async () => { eventCalls += 1; }) as never,
      });
      const response = await handler(new Request("https://example.test"), { params: Promise.resolve({ contractId: "contract-1" }) });
      const body = (await response.json()) as Row;
      assert.equal(response.status, 401);
      assert.equal(body.error, "STORE_API_UNAUTHENTICATED");
      assert.equal(resolveCalls, 0);
      assert.equal(authorityCalls, 0);
      assert.equal(eventCalls, 0);
      assert.equal(supabase.calls.length, 0);
    },
  },
  {
    name: "canonical resolver receives access organization store and session user",
    run: async () => {
      const supabase = createSupabaseMock();
      let received: Row | undefined;
      const handler = createApproveContractPostHandler({
        resolveAccess: (async () => grantedAccess(supabase)) as never,
        resolveContract: (async (_contractId: string, authorizedScope: Row) => {
          received = authorizedScope;
          return baseScope(supabase);
        }) as never,
        approveContract: (async () => authorityResult()) as never,
        registerContractBusinessEvent: (async () => undefined) as never,
      });
      const response = await handler(new Request("https://example.test"), { params: Promise.resolve({ contractId: "contract-1" }) });
      assert.equal(response.status, 200);
      assert.deepEqual(received, { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" });
    },
  },
  {
    name: "happy path calls atomic approval with canonical scope and no direct updates",
    run: async () => {
      const result = await callRoute({});
      assert.equal(result.response.status, 200);
      assert.equal(result.body.ok, true);
      assert.equal(result.body.outcome, "approved");
      assert.deepEqual(result.rpcCalls[0], {
        supabase: result.rpcCalls[0].supabase,
        organizationId: "org-1",
        storeId: "store-1",
        contractId: "contract-1",
        expectedContractVersionId: "version-1",
        actorUserId: "user-1",
      });
      assert.equal(result.supabase.calls.some((call) => call.operation === "update"), false);
      assert.equal(result.eventCalls.length, 1);
    },
  },
  {
    name: "fresh durable response contains approved contract and version",
    run: async () => {
      const result = await callRoute({});
      assert.equal((result.body.contract as Row).status, "approved");
      assert.equal((result.body.current_version as Row).status, "approved");
      assert.equal((result.body.current_version as Row).id, "version-1");
      assert.equal((result.body.sideEffects as Row).businessEvent, "recorded");
    },
  },
  {
    name: "already applied replay does not emit business event",
    run: async () => {
      const result = await callRoute({
        authority: authorityResult({
          outcome: "already_applied",
          replayed: true,
          reconciled: false,
        }),
      });
      assert.equal(result.response.status, 200);
      assert.equal(result.body.outcome, "already_applied");
      assert.equal(result.eventCalls.length, 0);
      assert.equal((result.body.sideEffects as Row).businessEvent, "skipped");
    },
  },
  {
    name: "partial reconciliation emits business event",
    run: async () => {
      const result = await callRoute({
        authority: authorityResult({
          outcome: "reconciled_partial_state",
          replayed: true,
          reconciled: true,
        }),
      });
      assert.equal(result.response.status, 200);
      assert.equal(result.body.reconciled, true);
      assert.equal(result.eventCalls.length, 1);
    },
  },
  {
    name: "business event failure does not fail canonical approval",
    run: async () => {
      const result = await callRoute({ eventError: new Error("event unavailable") });
      assert.equal(result.response.status, 200);
      assert.equal(result.body.ok, true);
      assert.equal((result.body.sideEffects as Row).businessEvent, "failed");
    },
  },
  {
    name: "RPC failure is fail closed",
    run: async () => {
      const result = await callRoute({ authorityError: new Error("rpc failed") });
      assert.equal(result.response.status, 500);
      assert.equal(result.body.error, "UNEXPECTED_ERROR");
      assert.equal(result.eventCalls.length, 0);
    },
  },
  {
    name: "incomplete RPC result is fail closed",
    run: async () => {
      const result = await callRoute({ authority: { outcome: "approved" } });
      assert.equal(result.response.status, 500);
      assert.equal(result.body.error, "UNEXPECTED_ERROR");
      assert.equal(result.eventCalls.length, 0);
    },
  },
  {
    name: "contract/version mismatch is rejected before RPC",
    run: async () => {
      const supabase = createSupabaseMock();
      let rpcCalls = 0;
      const handler = createApproveContractPostHandler({
        resolveAccess: (async () => grantedAccess(supabase)) as never,
        resolveContract: async () => ({
          ...baseScope(supabase),
          contract: { ...baseScope(supabase).contract, current_version_id: "version-2" },
        }) as never,
        approveContract: async () => {
          rpcCalls += 1;
          return authorityResult() as never;
        },
      });
      const response = await handler(new Request("https://example.test"), {
        params: Promise.resolve({ contractId: "contract-1" }),
      });
      const body = (await response.json()) as Row;
      assert.equal(response.status, 409);
      assert.equal(body.error, "CONTRACT_VERSION_STALE");
      assert.equal(rpcCalls, 0);
    },
  },
  {
    name: "foreign organization and store scope are rejected before RPC",
    run: async () => {
      const cases: Row[] = [
        { organizationId: "org-2" },
        { store: { id: "store-2", organization_id: "org-1", name: "Other" } },
        { store: { id: "store-1", organization_id: "org-2", name: "Other" } },
        { contract: { ...baseScope(createSupabaseMock()).contract, organization_id: "org-2" } },
        { contract: { ...baseScope(createSupabaseMock()).contract, store_id: "store-2" } },
      ];
      for (const change of cases) {
        const result = await callRoute({
          resolveScope: (original) => ({ ...original, ...change }),
          authority: authorityResult(),
          authorityError: undefined,
        });
        assert.equal(result.response.status, 403);
        assert.equal(result.body.error, "CONTRACT_SCOPE_MISMATCH");
        assert.equal(result.rpcCalls.length, 0);
      }
    },
  },
  {
    name: "foreign current version lineage is rejected before RPC",
    run: async () => {
      for (const currentVersion of [
        { contract_id: "contract-2" },
        { organization_id: "org-2" },
        { store_id: "store-2" },
      ]) {
        const result = await callRoute({
          resolveScope: (original) => ({
            ...original,
            currentVersion: { ...(original.currentVersion as Row), ...currentVersion },
          }),
        });
        assert.equal(result.response.status, 403);
        assert.equal(result.body.error, "CONTRACT_SCOPE_MISMATCH");
        assert.equal(result.rpcCalls.length, 0);
      }
    },
  },
  {
    name: "PDF gate remains enforced",
    run: async () => {
      const result = await callRoute({
        scope: {
          ...baseScope(createSupabaseMock()),
          currentVersion: { ...baseScope(createSupabaseMock()).currentVersion, storage_path: null },
        },
      });
      assert.equal(result.response.status, 400);
      assert.equal(result.body.error, "CONTRACT_PDF_STORAGE_MISSING");
      assert.equal(result.rpcCalls.length, 0);
    },
  },
  {
    name: "durable returned contract or version scope mismatch fails closed before event",
    run: async () => {
      const contractMismatch = await callRoute({
        durableContract: {
          id: "contract-1", organization_id: "org-2", store_id: "store-1", current_version_id: "version-1", status: "approved", approved_at: "2026-10-08T14:00:00.000Z", approved_by: "user-1",
        },
      });
      assert.equal(contractMismatch.response.status, 500);
      assert.equal(contractMismatch.eventCalls.length, 0);

      const versionMismatch = await callRoute({
        durableVersion: {
          id: "version-1", contract_id: "contract-2", organization_id: "org-1", store_id: "store-1", status: "approved", approved_at: "2026-10-08T14:00:00.000Z",
        },
      });
      assert.equal(versionMismatch.response.status, 500);
      assert.equal(versionMismatch.eventCalls.length, 0);
    },
  },
  {
    name: "source contract removes direct updates and keeps customer sign untouched",
    run: () => {
      const routeSource = readFileSync(
        join(process.cwd(), "src/app/api/sales-contracts/[contractId]/approve/route.ts"),
        "utf8",
      );
      assert.match(routeSource, /approve_sales_contract_by_user_atomic/);
      assert.match(routeSource, /resolveStoreApiAccess/);
      assert.match(routeSource, /requirement: "active"/);
      assert.match(routeSource, /createStoreApiDeniedResponse/);
      assert.match(routeSource, /resolveExistingContractForAuthorizedStoreScope/);
      assert.equal(routeSource.includes("resolveAuthorizedExistingContract"), false);
      assert.equal(routeSource.includes('.from("sales_contracts").update'), false);
      assert.equal(routeSource.includes('.from("sales_contract_versions").update'), false);
      assert.match(routeSource, /registerContractBusinessEvent/);
      assert.match(routeSource, /already_applied/);
      assert.match(routeSource, /reconciled_partial_state/);
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
