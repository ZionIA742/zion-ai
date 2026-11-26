import { strict as assert } from "node:assert";
import { createQualificationFactsPostHandler } from "./route-handler";
import type { StoreApiAccessGranted } from "@/lib/server/store-api-access";

const ids = {
  org: "org-a",
  store: "store-a",
  lead: "lead-a",
  opportunity: "opp-a",
};

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/crm/qualification-facts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createAccess(options?: {
  known?: Array<Record<string, unknown>>;
  conflicts?: Array<Record<string, unknown>>;
  opportunityId?: string;
  storeId?: string;
  writeError?: {
    code?: string;
    message: string;
    details?: string;
    hint?: string;
  } | null;
}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const optionsValue = options || {};
  const supabase = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query = {
        select() { return query; },
        eq(column: string, value: unknown) { filters[column] = value; return query; },
        async maybeSingle() {
          if (table === "leads") {
            const valid = filters.id === ids.lead && filters.organization_id === ids.org && filters.store_id === ids.store;
            return { data: valid ? { id: ids.lead, organization_id: ids.org, store_id: ids.store } : null, error: null };
          }
          const valid = filters.id === (optionsValue.opportunityId || ids.opportunity)
            && filters.organization_id === ids.org
            && filters.store_id === (optionsValue.storeId || ids.store)
            && filters.origin_lead_id === ids.lead;
          return { data: valid ? { id: ids.opportunity, organization_id: ids.org, store_id: ids.store, origin_lead_id: ids.lead } : null, error: null };
        },
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name.startsWith("read_")) {
        return {
          data: {
            organization_id: ids.org,
            store_id: ids.store,
            commercial_opportunity_id: ids.opportunity,
            known_facts: optionsValue.known || [],
            conflicts: optionsValue.conflicts || [],
          },
          error: null,
        };
      }
      return { data: { accepted: true }, error: optionsValue.writeError || null };
    },
  } as unknown as StoreApiAccessGranted["supabase"];

  const access = {
    ok: true as const,
    supabase,
    sessionUserId: "user-a",
    organizationId: ids.org,
    storeId: ids.store,
  } as StoreApiAccessGranted;
  return { access, rpcCalls };
}

async function json(response: Response) {
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function run() {
  const base = {
    leadId: ids.lead,
    commercialOpportunityId: ids.opportunity,
    factKey: "budget_text",
    value: "R$ 40.000",
    expectedLastEventId: null,
    operationKey: "op-new",
  };

  {
    const { access, rpcCalls } = createAccess();
    const result = await json(await createQualificationFactsPostHandler({ resolveAccess: async () => access })(request(base)));
    assert.equal(result.status, 200);
    assert.equal(rpcCalls[1]?.name, "write_commercial_qualification_fact_by_user_if_current");
    assert.equal(rpcCalls[1]?.args.p_value_json, "R$ 40.000");
    assert.equal(rpcCalls[1]?.args.p_expected_last_event_id, null);
    assert.equal(rpcCalls[1]?.args.p_source_message_id, null);
    assert.equal(rpcCalls[1]?.args.p_source_conversation_id, null);
  }

  {
    const { access, rpcCalls } = createAccess({
      writeError: {
        code: "42501",
        message: "permission denied; token=eyJheader.payload.signature",
        details: "internal details",
        hint: "use request.jwt.claims",
      },
    });
    const originalError = console.error;
    const logs: unknown[] = [];
    console.error = (...args: unknown[]) => logs.push(args);
    try {
      const result = await json(await createQualificationFactsPostHandler({ resolveAccess: async () => access })(request({ ...base, operationKey: "op-unexpected" })));
      assert.equal(result.status, 409);
      assert.equal(result.body.error, "QUALIFICATION_FACT_WRITE_FAILED");
      assert.equal(typeof result.body.correlationId, "string");
      assert.equal(String(result.body.message || "").includes("permission denied"), false);
      assert.equal(logs.length, 1);
      const log = (logs[0] as unknown[])[1] as Record<string, unknown>;
      assert.equal(log.code, "42501");
      assert.equal(String(log.message).includes("[JWT_REDACTED]"), true);
      assert.equal(String(log.message).includes("token=eyJ"), false);
      assert.equal(log.details, "internal details");
      assert.equal(log.hint, "use request.jwt.claims");
      assert.equal(rpcCalls[1]?.name, "write_commercial_qualification_fact_by_user_if_current");
    } finally {
      console.error = originalError;
    }
  }

  {
    const { access, rpcCalls } = createAccess({ known: [{ factKey: "budget_text", lastEventId: "event-1" }] });
    const result = await json(await createQualificationFactsPostHandler({ resolveAccess: async () => access })(request({ ...base, operationKey: "op-correction", expectedLastEventId: "event-1", value: "R$ 50.000" })));
    assert.equal(result.status, 200);
    assert.equal(rpcCalls[1]?.args.p_resolves_conflict, false);
  }

  {
    const { access, rpcCalls } = createAccess({ conflicts: [{ factKey: "budget_text", lastEventId: "conflict-1" }] });
    const result = await json(await createQualificationFactsPostHandler({ resolveAccess: async () => access })(request({ ...base, operationKey: "op-conflict", expectedLastEventId: "conflict-1", resolvesConflict: true })));
    assert.equal(result.status, 200);
    assert.equal(rpcCalls[1]?.args.p_resolves_conflict, true);
  }

  {
    const { access, rpcCalls } = createAccess({ known: [{ factKey: "budget_text", lastEventId: "event-current" }] });
    const result = await json(await createQualificationFactsPostHandler({ resolveAccess: async () => access })(request({ ...base, operationKey: "op-stale", expectedLastEventId: "event-old" })));
    assert.equal(result.status, 409);
    assert.equal(result.body.error, "QUALIFICATION_FACT_STALE");
    assert.equal(rpcCalls.length, 1);
  }

  {
    const { access, rpcCalls } = createAccess({ writeError: { message: "IDEMPOTENCY_KEY_REUSED" } });
    const result = await json(await createQualificationFactsPostHandler({ resolveAccess: async () => access })(request({ ...base, operationKey: "op-reused" })));
    assert.equal(result.status, 409);
    assert.equal(result.body.error, "QUALIFICATION_FACT_OPERATION_REUSED");
    assert.equal(rpcCalls[1]?.name, "write_commercial_qualification_fact_by_user_if_current");
  }

  {
    const { access, rpcCalls } = createAccess({ writeError: { message: "ZION_QFACT_EXPECTED_REVISION_MISMATCH" } });
    const result = await json(await createQualificationFactsPostHandler({ resolveAccess: async () => access })(request({ ...base, operationKey: "op-concurrent-stale" })));
    assert.equal(result.status, 409);
    assert.equal(result.body.error, "QUALIFICATION_FACT_STALE");
    assert.equal(rpcCalls[1]?.name, "write_commercial_qualification_fact_by_user_if_current");
  }

  {
    const { access, rpcCalls } = createAccess();
    const result = await json(await createQualificationFactsPostHandler({ resolveAccess: async () => access })(request({ ...base, commercialOpportunityId: "opp-other" })));
    assert.equal(result.status, 403);
    assert.equal(result.body.error, "OPPORTUNITY_SCOPE_INVALID");
    assert.equal(rpcCalls.length, 0);
  }

  {
    const { access, rpcCalls } = createAccess();
    access.storeId = "store-other";
    const result = await json(await createQualificationFactsPostHandler({ resolveAccess: async () => access })(request(base)));
    assert.equal(result.status, 403);
    assert.equal(result.body.error, "LEAD_SCOPE_INVALID");
    assert.equal(rpcCalls.length, 0);
  }
}

await run();
console.log("qualification-facts route: PASS");
