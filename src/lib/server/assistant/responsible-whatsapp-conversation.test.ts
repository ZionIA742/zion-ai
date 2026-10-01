import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("responsible WhatsApp bridge accepts real Meta wamid punctuation", () => {
  const source = readFileSync(
    "src/lib/server/assistant/responsible-whatsapp-conversation.ts",
    "utf8",
  );

  assert.match(source, /\\x21-\\x7E/);

  const providerMessageId = "wamid.HBgNNTUxMTk5NDcyOTQ2MxUCABIYIEFDMkRBM0IxODU4RDM5MzA5MUNGQjk2Q0E1NkRGOTg2AA==";
  assert.match(providerMessageId, /^[\x21-\x7E]{1,512}$/);
  assert.doesNotMatch("bad id with spaces", /^[\x21-\x7E]{1,512}$/);
  assert.doesNotMatch("bad\nid", /^[\x21-\x7E]{1,512}$/);
});
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

test("responsible WhatsApp bridge persists bounded recovery and outbound uncertainty", () => {
  const migration = readFileSync(
    "supabase/migrations/20261001170000_p19a_responsible_whatsapp_reliability.sql",
    "utf8",
  );

  assert.match(migration, /attempts integer not null default 0/);
  assert.match(migration, /max_attempts integer not null default 3/);
  assert.match(migration, /outbound_status text null/);
  assert.match(migration, /outbound_status = 'uncertain'/);
  assert.match(migration, /outbound_status = 'sending'/);
  assert.match(migration, /attempts < e\.max_attempts/);
  assert.match(migration, /processing_stale_after_provider_call/);
  assert.match(migration, /recover_stale_store_assistant_responsible_whatsapp_events/);
  assert.match(migration, /inbox_reopened_for_recovery/);
  assert.match(migration, /for update skip locked/);
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

test("panel messages preserve canonical responsible provenance in the shared thread", () => {
  const migration = readFileSync(
    "supabase/migrations/20261001100000_p19a_assistant_panel_provenance.sql",
    "utf8",
  );

  assert.match(migration, /assistant_get_or_create_primary_thread/);
  assert.match(migration, /sender_role/);
  assert.match(migration, /'origin', 'panel'/);
  assert.match(migration, /'channel', 'panel'/);
  assert.match(migration, /'responsible_id', v_responsible_id/);
  assert.match(migration, /is_primary is true/);
  assert.match(migration, /is_active is true/);
  assert.match(migration, /v_responsible_count <> 1/);
  assert.match(migration, /v_thread_organization_id is distinct from p_organization_id/);
  assert.match(migration, /v_thread_store_id is distinct from p_store_id/);
});

test("panel and WhatsApp use the same canonical message/thread contract", () => {
  const panel = readFileSync(
    "src/app/(app)/assistant/page.tsx",
    "utf8",
  );
  const whatsapp = readFileSync(
    "src/lib/server/assistant/responsible-whatsapp-conversation.ts",
    "utf8",
  );

  assert.match(panel, /assistant_get_thread_summary/);
  assert.match(panel, /assistant_list_messages_paginated/);
  assert.match(panel, /assistant_send_human_message/);
  assert.match(whatsapp, /getOrCreateAssistantThread/);
  assert.match(whatsapp, /store_assistant_messages/);
  assert.match(whatsapp, /origin: "whatsapp"/);
  assert.match(whatsapp, /responsible_id: responsibleId/);
  assert.match(whatsapp, /thread_id: thread\.threadId/);
});

test("responsible WhatsApp media is persisted in the canonical thread with private metadata", () => {
  const bridge = readFileSync(
    "src/lib/server/assistant/responsible-whatsapp-conversation.ts",
    "utf8",
  );

  assert.match(bridge, /downloadAndStoreWhatsappInboundMedia/);
  assert.match(bridge, /mediaKind: media\.mediaKind/);
  assert.match(bridge, /conversationId: thread\.threadId/);
  assert.match(bridge, /message_type: media\?\.mediaKind \|\| "text"/);
  assert.match(bridge, /media_origin: "responsible"/);
  assert.match(bridge, /storage_bucket: storedMedia\.storageBucket/);
  assert.match(bridge, /storage_path: storedMedia\.storagePath/);
  assert.match(bridge, /removeWhatsappInboundStoredMedia/);
  assert.match(bridge, /if \(!inbound\)/);
});

test("responsible WhatsApp media accepts image, audio and document without fabricated text", () => {
  const processor = readFileSync(
    "src/lib/server/whatsapp-inbox-processor.ts",
    "utf8",
  );

  assert.match(processor, /mediaKind: "image" as const/);
  assert.match(processor, /mediaKind: "audio" as const/);
  assert.match(processor, /mediaKind: "document" as const/);
  assert.match(processor, /RESPONSIBLE_MEDIA_UNSUPPORTED_OR_MISSING/);
  assert.match(processor, /if \(args\.extracted\.rawMessageType === "text"\)/);
  assert.match(processor, /routeResponsibleWhatsappToAssistant\([\s\S]*?media,/);
});

test("assistant panel exposes all responsible attachment kinds through scoped signed URLs", () => {
  const panel = readFileSync("src/app/(app)/assistant/page.tsx", "utf8");
  const route = readFileSync(
    "src/app/api/assistant/messages/[messageId]/signed-media-url/route.ts",
    "utf8",
  );

  assert.match(panel, /metadata\.origin !== "whatsapp"/);
  assert.match(panel, /kind !== "image" && kind !== "audio" && kind !== "file"/);
  assert.match(panel, /signed-media-url/);
  assert.match(panel, /<img/);
  assert.match(panel, /<audio controls/);
  assert.match(panel, /Abrir \{attachment\.fileName/);
  assert.match(route, /\.eq\("organization_id", access\.organizationId\)/);
  assert.match(route, /\.eq\("store_id", access\.storeId\)/);
  assert.match(route, /createSignedUrl\(path, SIGNED_URL_EXPIRATION_SECONDS\)/);
  assert.doesNotMatch(route, /signedUrl: signed\.signedUrl,[\s\S]*storage_path/);
});
