import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  enqueuePersistedSalesAiFailureAlerts,
  enqueueSalesAiFailureOperationalAlert,
} from "./sales-ai-failure-operational-alert";

function clientFor(rows: unknown[], expectedTable = "channel_whatsapp_inbox") {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      assert.equal(table, expectedTable);
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        is() { return chain; },
        like() { return Promise.resolve({ data: rows, error: null }); },
      };
      return chain;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: [{ ok: true }], error: null };
    },
  };
  return { client, calls };
}

test("terminal inbox failure creates a scoped idempotent operational alert", async () => {
  const fixture = clientFor([]);
  await enqueueSalesAiFailureOperationalAlert(fixture.client, {
    source: "inbox",
    id: "inbox-1",
    organizationId: "org-1",
    storeId: "store-1",
    processingError: "sales_ai_failed_final:lease_expired_max_attempts",
    externalEventId: "event-1",
  });

  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].name, "assistant_enqueue_internal_notification");
  assert.equal(fixture.calls[0].args.p_organization_id, "org-1");
  assert.equal(fixture.calls[0].args.p_store_id, "store-1");
  assert.equal(fixture.calls[0].args.p_event_key, "sales_ai_failed_final:inbox:inbox-1");
  assert.equal((fixture.calls[0].args.p_context as Record<string, unknown>).needs_human_action, true);
});

test("persisted SQL-terminal inbox failures are discovered without reprocessing", async () => {
  const fixture = clientFor([
    {
      id: "inbox-1",
      organization_id: "org-1",
      store_id: "store-1",
      processing_error: "sales_ai_failed_final:lease_expired_max_attempts",
      payload: { source: "meta_whatsapp_webhook", message: { id: "wamid-1" } },
      external_event_id: "event-1",
    },
    {
      id: "other-source",
      organization_id: "org-1",
      store_id: "store-1",
      processing_error: "sales_ai_failed_final:other",
      payload: { source: "other" },
    },
  ]);

  const result = await enqueuePersistedSalesAiFailureAlerts(fixture.client, {
    organizationId: "org-1",
    storeId: "store-1",
    source: "inbox",
  });
  assert.deepEqual(result, { inspected: 2, created: 1 });
  assert.equal(fixture.calls[0].args.p_event_key, "sales_ai_failed_final:inbox:inbox-1");
});

test("non-terminal failures are rejected before notification", async () => {
  const fixture = clientFor([]);
  await assert.rejects(
    enqueueSalesAiFailureOperationalAlert(fixture.client, {
      source: "ai_run_queue",
      id: "queue-1",
      organizationId: "org-1",
      storeId: "store-1",
      processingError: "sales_ai_retryable:temporary",
    }),
    /SALES_AI_FAILURE_ALERT_INPUT_INVALID/,
  );
  assert.equal(fixture.calls.length, 0);
});

test("persisted SQL-terminal queue failures preserve queue context and scope", async () => {
  const fixture = clientFor(
    [{
      id: "queue-1",
      organization_id: "org-1",
      store_id: "store-1",
      processing_error: "sales_ai_failed_final:lease_expired_max_attempts",
      conversation_id: "conversation-1",
      lead_id: "lead-1",
      queue_key: "resume:conversation-1",
    }],
    "ai_run_queue",
  );
  const result = await enqueuePersistedSalesAiFailureAlerts(fixture.client, {
    organizationId: "org-1",
    storeId: "store-1",
    source: "ai_run_queue",
  });
  assert.deepEqual(result, { inspected: 1, created: 1 });
  assert.equal(fixture.calls[0].args.p_event_key, "sales_ai_failed_final:ai_run_queue:queue-1");
  assert.equal(fixture.calls[0].args.p_related_conversation_id, "conversation-1");
  assert.equal(fixture.calls[0].args.p_related_lead_id, "lead-1");
});
