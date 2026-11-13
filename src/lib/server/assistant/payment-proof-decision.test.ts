import assert from "node:assert/strict";
import test from "node:test";
import {
  resolvePaymentProofDecision,
  tryHandlePaymentProofDecision,
} from "./payment-proof-decision";

test("payment decisions accept only standalone SIM/NAO", () => {
  assert.equal(resolvePaymentProofDecision("SIM"), "yes");
  assert.equal(resolvePaymentProofDecision("não"), "no");
  assert.equal(resolvePaymentProofDecision("sim, pode confirmar"), null);
});

function createSupabase(args: {
  notification?: Record<string, unknown> | null;
  existingEvent?: Record<string, unknown> | null;
}) {
  const rpcCalls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const supabase = {
    from(table: string) {
      const state = { table, filters: [] as Array<[string, unknown]> };
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => {
          state.filters.push([field, value]);
          return query;
        },
        limit: () => query,
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve(resolve({
            data: state.table === "store_responsible_external_notifications"
              ? (args.notification ? [args.notification] : [])
              : [],
            error: null,
          })),
        maybeSingle: async () => {
          if (state.table === "store_responsible_external_notifications") {
            return { data: args.notification || null, error: null };
          }
          return { data: args.existingEvent || null, error: null };
        },
      };
      return query;
    },
    async rpc(name: string, payload: Record<string, unknown>) {
      rpcCalls.push({ name, payload });
      return { data: null, error: null };
    },
  };
  return { supabase, rpcCalls };
}

const notification = {
  internal_notification_id: "notification-1",
  context: {
    source: "customer_payment_proof_v1",
    source_message_id: "proof-message-1",
    related_conversation_id: "conversation-1",
    commercial_opportunity_id: "opportunity-1",
  },
};

test("valid responsible decision persists the proof decision without financial RPC", async () => {
  const h = createSupabase({ notification });
  const result = await tryHandlePaymentProofDecision({
    supabase: h.supabase as never,
    organizationId: "org-1",
    storeId: "store-1",
    responsibleId: "responsible-1",
    decisionMessageId: "decision-message-1",
    externalMessageId: "wamid-decision-1",
    content: "SIM",
    contextMessageId: "wamid-notification-1",
  });
  assert.equal(result?.decision, "yes");
  assert.equal(h.rpcCalls.length, 1);
  assert.equal(h.rpcCalls[0]?.name, "store_business_event_register");
  assert.equal(h.rpcCalls[0]?.payload.p_event_key, "customer_payment_proof_decision:notification-1");
  assert.equal(h.rpcCalls[0]?.payload.p_actor_type, "store_responsible");
});

test("a different reply cannot overwrite a persisted proof decision", async () => {
  const h = createSupabase({
    notification,
    existingEvent: { event_payload: { decision: "yes" } },
  });
  await assert.rejects(
    () => tryHandlePaymentProofDecision({
      supabase: h.supabase as never,
      organizationId: "org-1",
      storeId: "store-1",
      responsibleId: "responsible-1",
      decisionMessageId: "decision-message-2",
      externalMessageId: "wamid-decision-2",
      content: "NAO",
      contextMessageId: "wamid-notification-1",
    }),
    /PAYMENT_PROOF_DECISION_CONFLICT/,
  );
  assert.equal(h.rpcCalls.length, 0);
});

test("a notification without canonical evidence cannot create a decision event", async () => {
  const h = createSupabase({
    notification: {
      ...notification,
      context: { ...notification.context, source_message_id: null },
    },
  });
  const result = await tryHandlePaymentProofDecision({
    supabase: h.supabase as never,
    organizationId: "org-1",
    storeId: "store-1",
    responsibleId: "responsible-1",
    decisionMessageId: "decision-message-1",
    externalMessageId: "wamid-decision-1",
    content: "SIM",
    contextMessageId: "wamid-notification-1",
  });
  assert.equal(result, null);
  assert.equal(h.rpcCalls.length, 0);
});
