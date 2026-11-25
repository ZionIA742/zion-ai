import assert from "node:assert/strict";
import test from "node:test";
import {
  recoverConfirmedSalesAiReplySetPostCommitEffects,
  reconcileConfirmedSalesAiReplySetPostCommitEffects,
} from "./generate-and-save-ai-sales-reply";

test("durable post-materialization recovery defers without writers during hard hold", async () => {
  const writes: string[] = [];
  let leaseReads = 0;
  let replySetReads = 0;
  const row = {
    response_set_id: "10000000-0000-4000-8000-000000000001",
    text_message_id: "10000000-0000-4000-8000-000000000002",
    document_message_ids: [],
    photo_message_id: null,
    request_fingerprint: "r".repeat(64),
    materialization_state: "confirmed",
    payload: { caller_payload: { post_commit_recovery: {} } },
  };
  const systemSupabase = {
    async rpc(name: string) {
      replySetReads += 1;
      assert.equal(name, "read_sales_ai_reply_set_by_anchor");
      return { data: row, error: null };
    },
  };
  const supabase = {
    from(table: string) {
      if (table === "conversations") {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            return {
              data: {
                id: "10000000-0000-4000-8000-000000000005",
                organization_id: "10000000-0000-4000-8000-000000000003",
                lead_id: "10000000-0000-4000-8000-000000000006",
                status: "open",
                is_human_active: false,
                leads: { organization_id: "10000000-0000-4000-8000-000000000003", store_id: "10000000-0000-4000-8000-000000000004" },
              },
              error: null,
            };
          },
        };
      }
      if (table === "stores") {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            return { data: { id: "10000000-0000-4000-8000-000000000004", organization_id: "10000000-0000-4000-8000-000000000003" }, error: null };
          },
        };
      }
      if (table === "conversation_human_takeover_leases") {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            leaseReads += 1;
            return {
              data: {
                organization_id: "10000000-0000-4000-8000-000000000003",
                store_id: "10000000-0000-4000-8000-000000000004",
                conversation_id: "10000000-0000-4000-8000-000000000005",
                hard_hold: true,
                released_at: null,
              },
              error: null,
            };
          },
        };
      }
      writes.push(table);
      throw new Error(`unexpected writer table ${table}`);
    },
  };

  const result = await recoverConfirmedSalesAiReplySetPostCommitEffects({
    supabase,
    systemSupabase,
    organizationId: "10000000-0000-4000-8000-000000000003",
    storeId: "10000000-0000-4000-8000-000000000004",
    conversationId: "10000000-0000-4000-8000-000000000005",
    anchorMessageId: "10000000-0000-4000-8000-000000000007",
    responseSetId: row.response_set_id,
    workerClaim: {
      kind: "ai_run_queue",
      id: "10000000-0000-4000-8000-000000000008",
      token: "10000000-0000-4000-8000-000000000009",
    },
  });

  assert.deepEqual(result, { status: "deferred", complete: false });
  assert.equal(replySetReads, 1);
  assert.equal(leaseReads, 1);
  assert.deepEqual(writes, []);

  await assert.rejects(
    () => recoverConfirmedSalesAiReplySetPostCommitEffects({
      supabase,
      systemSupabase,
      organizationId: "10000000-0000-4000-8000-000000000003",
      storeId: "10000000-0000-4000-8000-000000000004",
      conversationId: "10000000-0000-4000-8000-000000000005",
      anchorMessageId: "10000000-0000-4000-8000-000000000007",
    }),
    /P9_RECOVERY_WORKER_BINDING_REQUIRED/
  );

  assert.equal(replySetReads, 1);
  assert.equal(leaseReads, 1);
  assert.deepEqual(writes, []);
});

test("durable post-materialization recovery retries commercial memory promotion", async () => {
  const previousFlag = process.env.ZION_P9_10_6_A_REMOTE_INSTALLED;
  process.env.ZION_P9_10_6_A_REMOTE_INSTALLED = "true";
  const calls: string[] = [];
  const organizationId = "org-1";
  const storeId = "store-1";
  const conversationId = "conv-1";
  const leadId = "lead-1";
  const sessionId = "session-1";
  const opportunityId = "opp-1";

  const promotionEvent = {
    event_id: "event-1",
    organization_id: organizationId,
    store_id: storeId,
    conversation_id: conversationId,
    lead_id: leadId,
    conversation_session_id: sessionId,
    commercial_session_context_link_id: null,
    commercial_opportunity_id: null,
    fact_key: "requested_area_m2",
    value_json: { value: 32, unit: "m2" },
    operation_key: "fact:event-1",
    event_kind: "assertion",
    supersedes_event_id: null,
    source_message_id: "message-1",
    source_media_type: "text",
    actor_type: "customer",
    evidence_level: "confirmed",
    created_at: "2026-11-23T12:00:00.000Z",
    conflict_state: "consistent",
  };
  const rpc = async (name: string, payload: Record<string, unknown>) => {
    calls.push(name);
    if (name === "read_commercial_conversation_fact_events_by_system") {
      return { data: [promotionEvent], error: null };
    }
    if (name === "read_commercial_opportunity_qualification_facts_by_system") {
      return {
        data: {
          organization_id: organizationId,
          store_id: storeId,
          commercial_opportunity_id: opportunityId,
          known_facts: [],
        },
        error: null,
      };
    }
    if (name === "write_commercial_opportunity_qualification_fact_by_system") {
      assert.equal(payload.p_organization_id, organizationId);
      assert.equal(payload.p_store_id, storeId);
      assert.equal(payload.p_commercial_opportunity_id, opportunityId);
      assert.equal(payload.p_source_message_id, "message-1");
      assert.equal(payload.p_source_type, "incoming_customer_message");
      return { data: [{ outcome: "created" }], error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  };
  const supabase = {
    rpc,
    from(table: string) {
      const query = {
        select() { return query; },
        eq() { return query; },
        async maybeSingle() {
          if (table === "conversations") {
            return {
              data: {
                id: conversationId,
                organization_id: organizationId,
                lead_id: leadId,
                status: "open",
                is_human_active: false,
                leads: { organization_id: organizationId, store_id: storeId },
              },
              error: null,
            };
          }
          if (table === "stores") {
            return { data: { id: storeId, organization_id: organizationId }, error: null };
          }
          if (table === "conversation_human_takeover_leases") {
            return { data: null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return query;
    },
  };
  const row = {
    response_set_id: "set-recovery-promotion",
    text_message_id: "message-ai-1",
    document_message_ids: [],
    photo_message_id: null,
    request_fingerprint: "r".repeat(64),
    materialization_state: "confirmed",
    payload: {
      caller_payload: {
        post_commit_recovery: {
          commercial_memory_promotion: {
            organization_id: organizationId,
            store_id: storeId,
            lead_id: leadId,
            conversation_id: conversationId,
            conversation_session_id: sessionId,
            commercial_opportunity_id: opportunityId,
            decision_kind: "continue_same_intent",
          },
        },
      },
    },
  };

  try {
    const result = await reconcileConfirmedSalesAiReplySetPostCommitEffects({
      supabase,
      canonicalScope: {
        organizationId,
        storeId,
        conversationId,
        leadId,
        conversationStatus: "open",
        isHumanActive: false,
      } as never,
      leadId,
      systemSupabase: supabase,
      row,
      organizationId,
      storeId,
      conversationId,
      anchorMessageId: "anchor-1",
    });
    assert.equal(result.complete, true);
    assert.deepEqual(calls, [
      "read_commercial_conversation_fact_events_by_system",
      "read_commercial_opportunity_qualification_facts_by_system",
      "write_commercial_opportunity_qualification_fact_by_system",
    ]);
  } finally {
    if (previousFlag === undefined) delete process.env.ZION_P9_10_6_A_REMOTE_INSTALLED;
    else process.env.ZION_P9_10_6_A_REMOTE_INSTALLED = previousFlag;
  }
});
