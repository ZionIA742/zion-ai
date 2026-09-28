import { strict as assert } from "node:assert";
import { createTechnicalVisitPostHandler } from "./route";
import type { StoreApiAccessGranted } from "@/lib/server/store-api-access";

const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];

const handler = createTechnicalVisitPostHandler({
  resolveAccess: async () => ({
    ok: true,
    organizationId: "org-authorized",
    storeId: "store-authorized",
    supabase: {},
  } as StoreApiAccessGranted),
  createServiceSupabaseClient: () => ({
    rpc: async (name: string, payload: Record<string, unknown>) => {
      calls.push({ name, payload });
      return { data: { id: "appointment-1" }, error: null };
    },
  }),
});

void (async () => {
  const response = await handler(
    new Request("http://localhost/api/schedule/technical-visit", {
      method: "POST",
      body: JSON.stringify({
        commercialOpportunityId: "opp-explicit",
        leadId: "lead-explicit",
        conversationId: "conversation-explicit",
        title: "Visita técnica",
        scheduledStart: "2026-09-28T12:00:00.000Z",
        scheduledEnd: "2026-09-28T13:00:00.000Z",
      }),
      headers: { "Content-Type": "application/json" },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.name,
    "create_technical_visit_with_fresh_commercial_readiness_by_system",
  );
  assert.equal(calls[0]?.payload.p_organization_id, "org-authorized");
  assert.equal(calls[0]?.payload.p_store_id, "store-authorized");
  assert.equal(calls[0]?.payload.p_commercial_opportunity_id, "opp-explicit");

  process.stdout.write("technical-visit route test passed\n");
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
