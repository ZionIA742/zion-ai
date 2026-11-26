import assert from "node:assert/strict";
import test from "node:test";
import {
  promoteCommercialMemoryToOpportunity,
  shouldPromoteCommercialMemoryForDecision,
} from "./promote-commercial-memory-to-opportunity";

const scope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  storeId: "22222222-2222-4222-8222-222222222222",
  leadId: "33333333-3333-4333-8333-333333333333",
  conversationId: "44444444-4444-4444-8444-444444444444",
  conversationSessionId: "55555555-5555-4555-8555-555555555555",
  commercialOpportunityId: "66666666-6666-4666-8666-666666666666",
};

const eventScope = {
  organization_id: scope.organizationId,
  store_id: scope.storeId,
  conversation_id: scope.conversationId,
  lead_id: scope.leadId,
  conversation_session_id: scope.conversationSessionId,
};

const events = [
  {
    event_id: "77777777-7777-4777-8777-777777777777",
    ...eventScope,
    commercial_session_context_link_id: null,
    commercial_opportunity_id: null,
    fact_key: "requested_area_m2",
    value_json: { value: 32, unit: "m2" },
    operation_key: "fact:customer:area",
    event_kind: "assertion",
    supersedes_event_id: null,
    source_message_id: "88888888-8888-4888-8888-888888888888",
    source_media_type: "text",
    actor_type: "customer",
    evidence_level: "confirmed",
    created_at: "2026-11-23T12:00:00.000Z",
    conflict_state: "consistent",
  },
  {
    event_id: "99999999-9999-4999-8999-999999999999",
    ...eventScope,
    commercial_session_context_link_id: null,
    commercial_opportunity_id: null,
    fact_key: "installation_interest",
    value_json: true,
    operation_key: "fact:human:installation",
    event_kind: "correction",
    supersedes_event_id: null,
    source_message_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    source_media_type: "text",
    actor_type: "human",
    evidence_level: "confirmed",
    created_at: "2026-11-23T12:01:00.000Z",
    conflict_state: "consistent",
  },
  {
    event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ...eventScope,
    commercial_session_context_link_id: null,
    commercial_opportunity_id: null,
    fact_key: "ignored_conflict",
    value_json: "unsafe",
    operation_key: "fact:conflict",
    event_kind: "assertion",
    supersedes_event_id: null,
    source_message_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    source_media_type: "text",
    actor_type: "customer",
    evidence_level: "confirmed",
    created_at: "2026-11-23T12:02:00.000Z",
    conflict_state: "conflict",
  },
];

function makeHarness(recovery = false) {
  const canonical = new Map<string, unknown>();
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  let failNextWriter = true;
  const supabase = {
    rpc: async (name: string, payload: Record<string, unknown>) => {
      calls.push({ name, payload });
      if (name === "read_commercial_conversation_fact_events_by_system") {
        return { data: events, error: null };
      }
      if (name === "read_commercial_opportunity_qualification_facts_by_system") {
        return {
          data: {
            organization_id: scope.organizationId,
            store_id: scope.storeId,
            commercial_opportunity_id: scope.commercialOpportunityId,
            known_facts: [...canonical.entries()].map(([factKey, value]) => ({
              factKey,
              state: "known",
              value,
            })),
          },
          error: null,
        };
      }
      assert.equal(
        name,
        "promote_commercial_memory_fact_if_absent_by_system",
      );
      if (failNextWriter) {
        failNextWriter = false;
        return { data: null, error: { message: "simulated writer failure" } };
      }
      canonical.set(String(payload.p_fact_key), payload.p_value_json);
      return { data: [{ outcome: "promoted_created" }], error: null };
    },
  };
  return { supabase, calls, canonical };
}

function runPromotion(supabase: typeof makeHarness extends () => infer T ? T extends { supabase: infer S } ? S : never : never) {
  return promoteCommercialMemoryToOpportunity({
    supabase,
    ...scope,
    enabled: true,
  });
}

test("10.6-B promove fatos pré-oportunidade e recupera falha em nova geração", async () => {
  const harness = makeHarness();

  const first = await runPromotion(harness.supabase);
  assert.equal(first.status, "partial");
  assert.equal(first.attempted, 2);
  assert.equal(first.promoted, 1);

  const second = await runPromotion(harness.supabase);
  assert.equal(second.status, "promoted");
  assert.equal(second.promoted, 1);
  assert.deepEqual([...harness.canonical.keys()].sort(), [
    "requested_area_m2",
    "installation_interest",
  ].sort());

  const third = await runPromotion(harness.supabase);
  assert.equal(third.status, "skipped");
  assert.equal(third.promoted, 0);
  assert.equal(
    harness.calls.filter((call) => call.name === "promote_commercial_memory_fact_if_absent_by_system").length,
    3,
  );

  const writes = harness.calls.filter((call) => call.name === "promote_commercial_memory_fact_if_absent_by_system");
  assert.equal(writes.every((call) => call.payload.p_organization_id === scope.organizationId), true);
  assert.equal(writes.every((call) => call.payload.p_store_id === scope.storeId), true);
  assert.equal(writes.every((call) => call.payload.p_commercial_opportunity_id === scope.commercialOpportunityId), true);
  assert.equal(writes[0].payload.p_source_type, "incoming_customer_message");
  assert.equal(writes[1].payload.p_source_type, "human_message");
  assert.equal(writes[0].payload.p_source_message_id, events[0].source_message_id);
  assert.equal(writes[1].payload.p_source_message_id, events[1].source_message_id);
  assert.equal(writes[0].payload.p_source_conversation_id, scope.conversationId);
});

test("10.6-B recovery promotion uses the transactional recovery writer", async () => {
  const harness = makeHarness(true);
  const result = await promoteCommercialMemoryToOpportunity({
    supabase: harness.supabase,
    ...scope,
    enabled: true,
    recoveryAuthority: {
      responseSetId: "aaaaaaaa-1111-4111-8111-111111111111",
      queueId: "bbbbbbbb-2222-4222-8222-222222222222",
      claimToken: "cccccccc-3333-4333-8333-333333333333",
      anchorMessageId: "dddddddd-4444-4444-8444-444444444444",
      conversationId: scope.conversationId,
      leadId: scope.leadId,
      commercialOpportunityId: scope.commercialOpportunityId,
    },
  });
  assert.equal(result.status, "partial");
  const recoveryWrites = harness.calls.filter((call) => call.name === "promote_commercial_memory_fact_if_absent_by_system");
  assert.equal(recoveryWrites.length, 2);
  assert.equal(recoveryWrites.every((call) => call.payload.p_response_set_id), true);
  assert.equal(recoveryWrites.every((call) => call.payload.p_queue_id), true);
  assert.equal(recoveryWrites.every((call) => call.payload.p_claim_token), true);
  assert.equal(recoveryWrites.every((call) => call.payload.p_recovery_conversation_id), true);
  assert.equal(recoveryWrites.every((call) => call.payload.p_recovery_lead_id), true);
});

test("10.6-B flag desativado não lê nem escreve", async () => {
  const harness = makeHarness();
  const result = await promoteCommercialMemoryToOpportunity({
    supabase: harness.supabase,
    ...scope,
    enabled: false,
  });
  assert.equal(result.status, "disabled");
  assert.equal(harness.calls.length, 0);
});

test("10.6-B retry usa oportunidade existente e nunca promove estados ambíguos", () => {
  for (const decisionKind of ["continue_same_intent", "reopen_same_intent"]) {
    assert.equal(
      shouldPromoteCommercialMemoryForDecision({
        enabled: true,
        decisionKind,
        resolvedCommercialOpportunityId: scope.commercialOpportunityId,
      }),
      true,
    );
  }
  for (const decisionKind of ["needs_clarification", "structural_ambiguity", null]) {
    assert.equal(
      shouldPromoteCommercialMemoryForDecision({
        enabled: true,
        decisionKind,
        resolvedCommercialOpportunityId: scope.commercialOpportunityId,
      }),
      false,
    );
  }
  assert.equal(
    shouldPromoteCommercialMemoryForDecision({
      enabled: false,
      decisionKind: "continue_same_intent",
      resolvedCommercialOpportunityId: scope.commercialOpportunityId,
    }),
    false,
  );
});

