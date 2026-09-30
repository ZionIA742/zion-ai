import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("responsible WhatsApp bridge uses the canonical assistant thread and sender role", () => {
  const source = readFileSync(
    "src/lib/server/assistant/responsible-whatsapp-conversation.ts",
    "utf8",
  );

  assert.match(source, /getOrCreateAssistantThread/);
  assert.match(source, /sender_role: "store_responsible"/);
  assert.match(source, /origin: "whatsapp"/);
  assert.match(source, /external_message_id: externalMessageId/);
  assert.match(source, /generateAssistantReply/);
  assert.match(source, /sendResponsibleAssistantText/);
  assert.match(source, /sourceExternalMessageId: externalMessageId/);
  assert.match(source, /claim_store_assistant_responsible_whatsapp_event/);
  assert.match(source, /RESPONSIBLE_ASSISTANT_EVENT_CLAIM_LOST/);
  assert.match(source, /organizationId/);
  assert.match(source, /storeId/);
});

test("responsible WhatsApp bridge has a persisted concurrency/idempotency ledger", () => {
  const migration = readFileSync(
    "supabase/migrations/20260930120000_p19a_responsible_assistant_whatsapp_bridge.sql",
    "utf8",
  );

  assert.match(migration, /store_assistant_responsible_whatsapp_events/);
  assert.match(migration, /external_message_id/);
  assert.match(migration, /status in \('received', 'processing', 'sent', 'failed', 'uncertain'\)/);
  assert.match(migration, /store_assistant_messages_responsible_whatsapp_external_uidx/);
  assert.match(migration, /sender_role = 'store_responsible'/);
  assert.match(migration, /foreign key \(responsible_id, organization_id, store_id\)/);
  assert.match(migration, /foreign key \(inbound_message_id, organization_id, store_id, thread_id\)/);
  assert.match(migration, /foreign key \(assistant_message_id, organization_id, store_id, thread_id\)/);
  assert.match(migration, /store_assistant_messages_id_thread_scope_uidx/);
  assert.match(migration, /claim_store_assistant_responsible_whatsapp_event/);
  assert.match(migration, /claim_token/);
  assert.match(migration, /processing_stale/);
  assert.match(migration, /grant select, insert, update[\s\S]*?to service_role/);
});

test("bridge treats sender role and message identity as database contracts", () => {
  const migration = readFileSync(
    "supabase/migrations/20260930120000_p19a_responsible_assistant_whatsapp_bridge.sql",
    "utf8",
  );

  assert.match(migration, /table_name = 'store_assistant_messages'/);
  assert.match(migration, /column_name = 'sender_role'/);
  assert.match(migration, /store_responsibles_id_scope_uidx/);
  assert.match(migration, /store_assistant_threads_id_scope_uidx/);
  assert.match(migration, /revoke all on table public\.store_assistant_responsible_whatsapp_events[\s\S]*?from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant .* delete .*service_role/i);
});
