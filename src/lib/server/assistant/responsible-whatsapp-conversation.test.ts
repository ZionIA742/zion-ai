import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ensureResponsibleAudioTranscript,
  ResponsibleAudioTranscriptionError,
  resumePersistedResponsibleWhatsappEvent,
} from "./responsible-whatsapp-conversation";

const recoveryNow = new Date("2026-10-23T11:00:00.000Z");

function createAudioMetadataSupabase() {
  const updates: Record<string, unknown>[] = [];
  const supabase = {
    from(table: string) {
      assert.equal(table, "store_assistant_messages");
      const chain = {
        update(values: Record<string, unknown>) {
          updates.push(values);
          return chain;
        },
        eq() { return chain; },
        select() { return chain; },
        async maybeSingle() { return { data: { id: "inbound-1" }, error: null }; },
      };
      return chain;
    },
  };
  return { supabase, updates };
}

function audioInbound(metadata: Record<string, unknown> = {}) {
  return {
    id: "inbound-1",
    organization_id: "org-1",
    store_id: "store-1",
    thread_id: "thread-1",
    content: "Responsável enviou um áudio.",
    metadata: {
      attachment_kind: "audio",
      storage_bucket: "zion-store-files",
      storage_path: "org-1/store-1/whatsapp-inbound/thread-1/audio.webm",
      original_file_name: "audio.webm",
      mime_type: "audio/webm",
      ...metadata,
    },
  };
}

function createResumeHarness(overrides: {
  event?: Record<string, unknown>;
  inbound?: Record<string, unknown> | null;
  reply?: Record<string, unknown> | null;
} = {}) {
  const event = {
    id: "event-1",
    organization_id: "org-1",
    store_id: "store-1",
    responsible_id: "responsible-1",
    destination: "5511999999999",
    external_message_id: "wamid.resume-1",
    status: "received",
    claim_token: null,
    inbound_message_id: "inbound-1",
    assistant_message_id: null,
    attempts: 1,
    max_attempts: 3,
    outbound_status: "failed",
    outbound_started_at: null,
    external_response_id: null,
    error_text: "READ_STORE_SETTINGS_FAILED",
    created_at: "2026-10-23T10:00:00.000Z",
    ...overrides.event,
  };
  const inbound = overrides.inbound === undefined
    ? {
        id: "inbound-1",
        organization_id: "org-1",
        store_id: "store-1",
        thread_id: "thread-1",
        content: "O que temos pra hoje?",
        metadata: {
          origin: "whatsapp",
          external_message_id: "wamid.resume-1",
          responsible_id: "responsible-1",
          from_phone: "5511999999999",
          phone_number_id: "phone-1",
        },
      }
    : overrides.inbound;
  const reply = overrides.reply === undefined ? null : overrides.reply;

  const supabase = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let senderRoles: unknown[] | null = null;
      const chain = {
        select() { return chain; },
        eq(column: string, value: unknown) { filters[column] = value; return chain; },
        in(_column: string, values: unknown[]) { senderRoles = values; return chain; },
        contains() { return chain; },
        limit() { return chain; },
        async maybeSingle() {
          if (table === "store_assistant_responsible_whatsapp_events") {
            return { data: event, error: null };
          }
          if (table === "store_assistant_messages" && filters.id) {
            return { data: inbound, error: null };
          }
          if (table === "store_assistant_messages" && senderRoles) {
            return { data: reply, error: null };
          }
          return { data: null, error: null };
        },
      };
      return chain;
    },
  };

  return { supabase, event, inbound };
}

async function resumeWithHarness(
  harness: ReturnType<typeof createResumeHarness>,
  resumeRoute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>,
) {
  return resumePersistedResponsibleWhatsappEvent({
    supabase: harness.supabase as never,
    organizationId: "org-1",
    storeId: "store-1",
    eventId: "event-1",
    now: recoveryNow,
    deps: {
      loadResponsible: async () => ({
        ok: true as const,
        responsible: { id: "responsible-1", whatsappNumber: "5511999999999" },
      }) as never,
      resumeRoute: resumeRoute as never,
    },
  });
}

test("persisted responsible WhatsApp recovery reuses only the inbound and does not invoke commercial work", async () => {
  const harness = createResumeHarness();
  const routeInputs: Record<string, unknown>[] = [];
  const result = await resumeWithHarness(harness, async (input) => {
    routeInputs.push(input);
    return { handled: true, duplicate: false, status: "sent" };
  });

  assert.deepEqual(result, { status: "resumed", eventId: "event-1" });
  assert.equal(routeInputs[0]?.externalMessageId, "wamid.resume-1");
  assert.equal("onInboundPersisted" in (routeInputs[0] || {}), false);
});

test("persisted responsible WhatsApp recovery fails closed for scope, replies, attempts, outbound and age", async () => {
  const cases = [
    createResumeHarness({ event: { store_id: "store-foreign" } }),
    createResumeHarness({ reply: { id: "assistant-1" } }),
    createResumeHarness({ inbound: null }),
    createResumeHarness({ event: { attempts: 3, max_attempts: 3 } }),
    createResumeHarness({ event: { outbound_status: "sending", outbound_started_at: "2026-10-23T10:01:00.000Z" } }),
    createResumeHarness({ event: { outbound_status: "uncertain" } }),
    createResumeHarness({ event: { created_at: "2026-10-22T10:00:00.000Z" } }),
  ];
  let routeCalls = 0;
  for (const harness of cases) {
    const result = await resumeWithHarness(harness, async () => {
      routeCalls += 1;
      return { handled: true, duplicate: false, status: "sent" };
    });
    assert.equal(result.status, "skipped");
  }
  assert.equal(routeCalls, 0);
});

test("persisted responsible WhatsApp recovery respects a concurrent claim", async () => {
  const result = await resumeWithHarness(createResumeHarness(), async () => ({
    handled: true,
    duplicate: true,
    status: "processing",
  }));
  assert.deepEqual(result, { status: "skipped", eventId: "event-1", reason: "claim_not_acquired" });
});

test("assistant recovery cron selects only recent failed received events and never reopens the inbox", () => {
  const bridge = readFileSync(
    "src/lib/server/assistant/responsible-whatsapp-conversation.ts",
    "utf8",
  );
  const cron = readFileSync(
    "src/app/api/cron/whatsapp-process-all/route.ts",
    "utf8",
  );

  assert.match(bridge, /\.eq\("status", "received"\)/);
  assert.match(bridge, /\.not\("error_text", "is", null\)/);
  assert.match(bridge, /\.not\("inbound_message_id", "is", null\)/);
  assert.match(bridge, /\.is\("assistant_message_id", null\)/);
  assert.match(bridge, /\.is\("outbound_started_at", null\)/);
  assert.match(bridge, /\.gte\("created_at", cutoff\)/);
  assert.match(cron, /resumeEligiblePersistedResponsibleWhatsappEvents/);
  assert.doesNotMatch(cron, /recoverStaleResponsibleWhatsappEvents/);
  assert.doesNotMatch(cron, /responsibleInboundRecovery/);
});

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

test("CONTINUAR remains scoped to the responsible Assistant flow", () => {
  const processor = readFileSync(
    "src/lib/server/whatsapp-inbox-processor.ts",
    "utf8",
  );
  const sync = readFileSync(
    "src/lib/server/assistant/assistant-panel-whatsapp-sync.ts",
    "utf8",
  );

  assert.match(processor, /buttonId === "CONTINUAR"/);
  assert.match(processor, /cancelPendingAssistantPanelTemplateNotifications/);
  assert.match(processor, /content: "CONTINUAR"/);
  assert.match(sync, /assistant_operational_pending/);
  assert.match(sync, /status: "cancelled"/);
  assert.match(sync, /external_message_id/);
});

test("a canonical quote decision terminates the assistant bridge before generation or outbound", () => {
  const source = readFileSync(
    "src/lib/server/assistant/responsible-whatsapp-conversation.ts",
    "utf8",
  );

  assert.match(source, /QuoteApprovalDecisionResult \| null/);
  assert.match(source, /decisionHandled: true/);
  assert.match(source, /outbound_status: null/);

  const decisionBranch = source.indexOf("if (inboundHookResult)");
  const assistantGeneration = source.indexOf("const { data: existingAssistant");
  assert.ok(decisionBranch >= 0);
  assert.ok(assistantGeneration > decisionBranch);
  assert.match(
    source.slice(decisionBranch, assistantGeneration),
    /return \{[\s\S]*decisionHandled: true[\s\S]*\} as const;/,
  );
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

test("responsible audio transcription persists transcript and preserves tenant scope", async () => {
  const harness = createAudioMetadataSupabase();
  const calls: Record<string, unknown>[] = [];
  const result = await ensureResponsibleAudioTranscript({
    supabase: harness.supabase as never,
    organizationId: "org-1",
    storeId: "store-1",
    inbound: audioInbound(),
    transcribeAudio: async (input) => {
      calls.push(input as unknown as Record<string, unknown>);
      return { ok: true as const, transcript: "Verifique a visita de amanha", provider: "openai" as const, model: "whisper-1" };
    },
  });

  assert.equal(result?.transcript, "Verifique a visita de amanha");
  assert.equal(calls[0]?.bucket, "zion-store-files");
  assert.equal(calls[0]?.storagePath, "org-1/store-1/whatsapp-inbound/thread-1/audio.webm");
  assert.equal(calls[0]?.mimeType, "audio/webm");
  const metadata = harness.updates[0]?.metadata as Record<string, unknown>;
  assert.equal(metadata.audio_transcript, "Verifique a visita de amanha");
  assert.equal(metadata.audio_transcription_status, "completed");
});

test("completed responsible audio transcription is reused without provider or metadata writes", async () => {
  const harness = createAudioMetadataSupabase();
  let calls = 0;
  const result = await ensureResponsibleAudioTranscript({
    supabase: harness.supabase as never,
    organizationId: "org-1",
    storeId: "store-1",
    inbound: audioInbound({
      audio_transcript: "Transcricao persistida",
      audio_transcription_status: "completed",
    }),
    transcribeAudio: async () => {
      calls += 1;
      throw new Error("provider must not be called");
    },
  });

  assert.equal(result?.transcript, "Transcricao persistida");
  assert.equal(calls, 0);
  assert.equal(harness.updates.length, 0);
});

test("empty and permanent transcription failures fail closed without dispatch", async () => {
  const emptyHarness = createAudioMetadataSupabase();
  await assert.rejects(
    () => ensureResponsibleAudioTranscript({
      supabase: emptyHarness.supabase as never,
      organizationId: "org-1",
      storeId: "store-1",
      inbound: audioInbound(),
      transcribeAudio: async () => ({ ok: false as const, error: "EMPTY_AUDIO_TRANSCRIPT", message: "empty", provider: "openai" as const, model: "whisper-1" }),
    }),
    (error: unknown) => error instanceof ResponsibleAudioTranscriptionError && error.retryable === false,
  );

  const permanentHarness = createAudioMetadataSupabase();
  await assert.rejects(
    () => ensureResponsibleAudioTranscript({
      supabase: permanentHarness.supabase as never,
      organizationId: "org-1",
      storeId: "store-1",
      inbound: audioInbound(),
      transcribeAudio: async () => ({ ok: false as const, error: "OPENAI_ENV_MISSING", message: "missing key", provider: "openai" as const, model: "whisper-1" }),
    }),
    (error: unknown) => error instanceof ResponsibleAudioTranscriptionError && error.retryable === false,
  );

  assert.equal((emptyHarness.updates[0]?.metadata as Record<string, unknown>).audio_transcription_status, "failed");
  assert.equal((permanentHarness.updates[0]?.metadata as Record<string, unknown>).audio_transcription_retryable, false);
});

test("temporary transcription failures remain retryable and do not produce a transcript", async () => {
  const harness = createAudioMetadataSupabase();
  await assert.rejects(
    () => ensureResponsibleAudioTranscript({
      supabase: harness.supabase as never,
      organizationId: "org-1",
      storeId: "store-1",
      inbound: audioInbound(),
      transcribeAudio: async () => ({ ok: false as const, error: "AUDIO_DOWNLOAD_FAILED", message: "download failed", provider: "openai" as const, model: "whisper-1" }),
    }),
    (error: unknown) => error instanceof ResponsibleAudioTranscriptionError && error.retryable === true,
  );

  const metadata = harness.updates[0]?.metadata as Record<string, unknown>;
  assert.equal(metadata.audio_transcription_status, "failed");
  assert.equal(metadata.audio_transcription_retryable, true);
  assert.equal("audio_transcript" in metadata, false);
});

test("the effective Assistant context uses transcript instead of the audio placeholder", () => {
  const route = readFileSync("src/app/api/assistant/reply/route.ts", "utf8");
  const bridge = readFileSync("src/lib/server/assistant/responsible-whatsapp-conversation.ts", "utf8");

  assert.match(route, /message\.message_type\) === "audio"/);
  assert.match(route, /message\.metadata\?\.audio_transcript/);
  assert.match(route, /buildModelInput/);
  assert.match(bridge, /ensureResponsibleAudioTranscript/);
  assert.ok(bridge.indexOf("ensureResponsibleAudioTranscript") < bridge.indexOf("const { data: existingAssistant"));
  assert.match(bridge, /sendResponsibleAssistantText/);
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
  assert.match(panel, /<audio[\s\S]*?controls/);
  assert.match(panel, /Ampliar \$\{attachment\.fileName/);
  assert.match(panel, /getAssistantAttachmentLabel/);
  assert.match(panel, /IntersectionObserver/);
  assert.match(panel, /observeAssistantMedia/);
  assert.match(panel, /assistantMediaUrlsRef/);
  assert.match(panel, /assistantMediaLoadingRef/);
  assert.match(panel, /assistantMediaAutoFailedRef/);
  assert.match(panel, /loadAssistantMedia\(message\.id, \{ manual: true \}\)/);
  assert.doesNotMatch(panel, /\}, \[assistantMediaLoading, assistantMediaUrls\]\);/);
  assert.match(panel, /root: chatScrollRef\.current/);
  assert.match(panel, /data-assistant-media-message-id/);
  assert.match(panel, /onError=\{\(\) => handleAssistantMediaError\(message\.id\)\}/);
  assert.match(panel, /Link do \{externalLinkPreview\.platform\}/);
  assert.match(panel, /target="_blank"/);
  assert.match(panel, /noreferrer noopener/);
  assert.doesNotMatch(panel, /<video/);
  assert.match(route, /\.eq\("organization_id", access\.organizationId\)/);
  assert.match(route, /\.eq\("store_id", access\.storeId\)/);
  assert.match(route, /createSignedUrl\(path, SIGNED_URL_EXPIRATION_SECONDS\)/);
  assert.doesNotMatch(route, /signedUrl: signed\.signedUrl,[\s\S]*storage_path/);
});
