import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Module from "node:module";
import type { StoreApiAccessGranted } from "@/lib/server/store-api-access";

const projectSrcPath = join(process.cwd(), "src");
const resolver = Module as typeof Module & {
  _resolveFilename: (...args: unknown[]) => string;
};
const originalResolveFilename = resolver._resolveFilename;
resolver._resolveFilename = function patched(request: string, parent: unknown, isMain: boolean, options: unknown) {
  return originalResolveFilename.call(this, request.startsWith("@/") ? join(projectSrcPath, request.slice(2)) : request, parent, isMain, options);
};

const routeModulePromise = import("./route");

function createRequest(body: unknown) {
  return { json: async () => body } as unknown as Request;
}

function createAccess(rpcResult?: { data: unknown; error: { message: string } | null }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const supabase = {
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return rpcResult ?? {
        data: [{
          operation_id: "11111111-1111-4111-8111-111111111111",
          lead_id: "22222222-2222-4222-8222-222222222222",
          previous_conversation_id: "33333333-3333-4333-8333-333333333333",
          previous_opportunity_id: "44444444-4444-4444-8444-444444444444",
          new_conversation_id: "55555555-5555-4555-8555-555555555555",
          new_opportunity_id: "66666666-6666-4666-8666-666666666666",
          lifecycle_cycle: 1,
          replayed: false,
          created_at: "2026-11-11T12:00:00.000Z",
        }],
        error: null,
      };
    },
  };
  return {
    calls,
    access: {
      ok: true,
      supabase,
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      storeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    } as unknown as StoreApiAccessGranted,
  };
}

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const validBody = {
  leadId: "22222222-2222-4222-8222-222222222222",
  previousConversationId: "33333333-3333-4333-8333-333333333333",
  previousOpportunityId: "44444444-4444-4444-8444-444444444444",
  operationId: "11111111-1111-4111-8111-111111111111",
  reason: "Novo ciclo autorizado pelo responsavel.",
};

const { createNewCommercialCyclePostHandler } = await routeModulePromise;

{
  const mock = createAccess();
  const response = await createNewCommercialCyclePostHandler({
    resolveAccess: async () => mock.access,
  })(createRequest({ ...validBody, organizationId: "tenant-forged", storeId: "store-forged" }));
  const result = await body(response);
  assert.equal(response.status, 200);
  assert.equal(result.opportunityId, "66666666-6666-4666-8666-666666666666");
  assert.equal(mock.calls[0]?.args.p_request_organization_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(mock.calls[0]?.args.p_store_id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.equal(mock.calls[0]?.fn, "start_new_commercial_cycle_by_user");
}

{
  const mock = createAccess({ data: null, error: { message: "P9_NEW_CYCLE_ACTIVE_CONVERSATION_EXISTS" } });
  const response = await createNewCommercialCyclePostHandler({
    resolveAccess: async () => mock.access,
  })(createRequest(validBody));
  const result = await body(response);
  assert.equal(response.status, 409);
  assert.equal(result.error, "P9_NEW_CYCLE_ACTIVE_CONVERSATION_EXISTS");
}

{
  const response = await createNewCommercialCyclePostHandler({
    resolveAccess: async () => createAccess().access,
  })(createRequest({ ...validBody, leadId: "not-a-uuid" }));
  const result = await body(response);
  assert.equal(response.status, 400);
  assert.equal(result.error, "P9_NEW_CYCLE_INPUT_INVALID");
}

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261111150000_p9_new_commercial_cycle.sql"),
  "utf8",
);
assert.match(migration, /status IN \('closed', 'resolved'\)/);
assert.match(migration, /status NOT IN \('closed', 'resolved'\)/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /Recheck after the per-lead lock/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.start_new_commercial_cycle_by_user[\s\S]*TO authenticated/);
assert.doesNotMatch(migration, /DELETE FROM public\.(?:sales_contracts|sales_contract_versions|contract_send_barriers)/i);

console.log("P9 new commercial cycle route tests passed");
