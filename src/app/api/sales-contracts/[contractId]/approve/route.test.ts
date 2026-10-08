import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApproveContractPostHandler } from "./route";

type Row = Record<string, unknown>;

function createSupabaseMock() {
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

async function callRoute(args: {
  scope?: Row;
  authority?: Row;
  authorityError?: Error;
  eventError?: Error;
  resolveAccess?: () => Promise<unknown>;
}) {
  const supabase = createSupabaseMock();
  const eventCalls: Row[] = [];
  const rpcCalls: Row[] = [];
  const handler = createApproveContractPostHandler({
    resolveContractScope: async () => (args.scope || baseScope(supabase)) as never,
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
        resolveContractScope: async () => ({
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
    name: "source contract removes direct updates and keeps customer sign untouched",
    run: () => {
      const routeSource = readFileSync(
        join(process.cwd(), "src/app/api/sales-contracts/[contractId]/approve/route.ts"),
        "utf8",
      );
      assert.match(routeSource, /approve_sales_contract_by_user_atomic/);
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
