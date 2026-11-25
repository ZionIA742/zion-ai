import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  readCommercialConversationFactEvents,
  writeCommercialConversationFactEvent,
} from "./commercial-conversation-fact-events";
import {
  ingestCommercialConversationFactsFromMessage,
  reconcileCommercialConversationFactsFromMessages,
} from "./ingest-commercial-conversation-facts";

const scope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  storeId: "22222222-2222-4222-8222-222222222222",
  conversationId: "33333333-3333-4333-8333-333333333333",
  leadId: "44444444-4444-4444-8444-444444444444",
  conversationSessionId: "55555555-5555-4555-8555-555555555555",
};

function fakeSupabase(response: unknown) {
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  return {
    calls,
    supabase: {
      rpc: async (name: string, payload: Record<string, unknown>) => {
        calls.push({ name, payload });
        return { data: response, error: null };
      },
    },
  } as const;
}

test("writer preserves audio provenance and no-opportunity session scope", async () => {
  const harness = fakeSupabase({
    event_id: "66666666-6666-4666-8666-666666666666",
    outcome: "created",
    operation_key: "fact:message-audio-1:requested_area_m2",
    fact_key: "requested_area_m2",
    conflict_group_key: "requested_area_m2",
    created_at: "2026-11-17T20:00:00.000Z",
  });

  const result = await writeCommercialConversationFactEvent({
    supabase: harness.supabase,
    input: {
      ...scope,
      operationKey: "fact:message-audio-1:requested_area_m2",
      factKey: "requested_area_m2",
      value: { value: 32, unit: "m2" },
      sourceMessageId: "77777777-7777-4777-8777-777777777777",
      sourceMediaType: "audio",
      actorType: "customer",
      evidenceLevel: "declared",
    },
  });

  assert.equal(result.outcome, "created");
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].payload.p_organization_id, scope.organizationId);
  assert.equal(harness.calls[0].payload.p_store_id, scope.storeId);
  assert.equal(harness.calls[0].payload.p_conversation_id, scope.conversationId);
  assert.equal(harness.calls[0].payload.p_lead_id, scope.leadId);
  assert.equal(harness.calls[0].payload.p_conversation_session_id, scope.conversationSessionId);
  assert.equal(harness.calls[0].payload.p_commercial_opportunity_id, null);
  assert.equal(harness.calls[0].payload.p_source_media_type, "audio");
  assert.equal(harness.calls[0].payload.p_actor_type, "customer");
});

test("writer accepts a human text correction without changing canonical opportunity facts", async () => {
  const harness = fakeSupabase({
    event_id: "88888888-8888-4888-8888-888888888888",
    outcome: "replayed",
    operation_key: "human:message-text-1:requested_area_m2:correction",
    fact_key: "requested_area_m2",
    conflict_group_key: "requested_area_m2",
    created_at: "2026-11-17T20:01:00.000Z",
  });

  const result = await writeCommercialConversationFactEvent({
    supabase: harness.supabase,
    input: {
      ...scope,
      commercialOpportunityId: "99999999-9999-4999-8999-999999999999",
      commercialSessionContextLinkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      operationKey: "human:message-text-1:requested_area_m2:correction",
      factKey: "requested_area_m2",
      value: { value: 36, unit: "m2" },
      sourceMessageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      sourceMediaType: "text",
      actorType: "human",
      evidenceLevel: "confirmed",
      eventKind: "correction",
      supersedesEventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    },
  });

  assert.equal(result.outcome, "replayed");
  assert.equal(harness.calls[0].payload.p_commercial_opportunity_id, "99999999-9999-4999-8999-999999999999");
  assert.equal(harness.calls[0].payload.p_commercial_session_context_link_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(harness.calls[0].payload.p_event_kind, "correction");
  assert.equal(harness.calls[0].payload.p_supersedes_event_id, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
});

test("writer rejects incomplete provenance before RPC", async () => {
  const harness = fakeSupabase({});
  await assert.rejects(
    writeCommercialConversationFactEvent({
      supabase: harness.supabase,
      input: {
        ...scope,
        operationKey: "missing-source",
        factKey: "requested_area_m2",
        value: { value: 32 },
        sourceMessageId: "",
        sourceMediaType: "audio",
        actorType: "customer",
        evidenceLevel: "declared",
      },
    }),
    /INPUT_INVALID/,
  );
  assert.equal(harness.calls.length, 0);
});

test("reader keeps conflict rows and rejects cross-scope RPC output", async () => {
  const harness = fakeSupabase([
    {
      event_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      organization_id: scope.organizationId,
      store_id: scope.storeId,
      conversation_id: scope.conversationId,
      lead_id: scope.leadId,
      conversation_session_id: scope.conversationSessionId,
      commercial_session_context_link_id: null,
      commercial_opportunity_id: null,
      fact_key: "requested_area_m2",
      value_json: { value: 32 },
      operation_key: "message-1:area",
      event_kind: "assertion",
      supersedes_event_id: null,
      source_message_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      source_media_type: "audio",
      actor_type: "customer",
      evidence_level: "declared",
      created_at: "2026-11-17T20:00:00.000Z",
      conflict_state: "conflict",
    },
  ]);
  const rows = await readCommercialConversationFactEvents({ supabase: harness.supabase, ...scope });
  assert.equal(rows[0].conflictState, "conflict");
  assert.equal(rows[0].commercialOpportunityId, null);
  assert.deepEqual(harness.calls[0].payload, {
    p_organization_id: scope.organizationId,
    p_store_id: scope.storeId,
    p_conversation_id: scope.conversationId,
    p_lead_id: scope.leadId,
    p_conversation_session_id: scope.conversationSessionId,
    p_commercial_session_context_link_id: null,
    p_commercial_opportunity_id: null,
  });

  const invalid = fakeSupabase([{
    ...{
      event_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      organization_id: "other-org",
      store_id: scope.storeId,
      conversation_id: scope.conversationId,
      lead_id: scope.leadId,
      conversation_session_id: scope.conversationSessionId,
      commercial_session_context_link_id: null,
      commercial_opportunity_id: null,
      fact_key: "requested_area_m2",
      value_json: { value: 32 },
      operation_key: "message-1:area",
      event_kind: "assertion",
      supersedes_event_id: null,
      source_message_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      source_media_type: "audio",
      actor_type: "customer",
      evidence_level: "declared",
      created_at: "2026-11-17T20:00:00.000Z",
      conflict_state: "conflict",
    },
    organization_id: "other-org",
  }]);
  await assert.rejects(
    readCommercialConversationFactEvents({ supabase: invalid.supabase, ...scope }),
    /READ_RESPONSE_INVALID|READ_SCOPE_MISMATCH/,
  );
});

test("10.5 ingests validated text facts without requiring an opportunity", async () => {
  const harness = fakeSupabase({
    event_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    outcome: "created",
    operation_key: "p9_10_5_fact_event_v1:message-10:requested_area_m2",
    fact_key: "requested_area_m2",
    conflict_group_key: "requested_area_m2",
    created_at: "2026-11-19T12:00:00.000Z",
  });
  const result = await ingestCommercialConversationFactsFromMessage({
    supabase: harness.supabase,
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    conversationId: scope.conversationId,
    leadId: scope.leadId,
    conversationSessionId: scope.conversationSessionId,
    message: {
      id: "message-10",
      sender: "user",
      content: "Tenho um espaço de 4 por 8 metros e quero uma piscina.",
      message_type: "text",
    },
  });
  assert.equal(result.status, "created");
  assert.ok(result.writes.length >= 1);
  assert.equal(harness.calls.every((call) => call.payload.p_commercial_opportunity_id === null), true);
  assert.equal(harness.calls.every((call) => call.payload.p_source_message_id === "message-10"), true);
});

test("10.5 never invents an audio fact without a persisted transcript", async () => {
  const harness = fakeSupabase({});
  const result = await ingestCommercialConversationFactsFromMessage({
    supabase: harness.supabase,
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    conversationId: scope.conversationId,
    leadId: scope.leadId,
    conversationSessionId: scope.conversationSessionId,
    message: {
      id: "audio-10",
      sender: "user",
      content: "Cliente enviou um áudio.",
      message_type: "audio",
      metadata: {},
    },
  });
  assert.equal(result.reason, "audio_transcript_unavailable");
  assert.equal(harness.calls.length, 0);
});

test("10.5 reconcilia falha de ingestao humana com a mesma operation key", async () => {
  let calls = 0;
  let writerCalls = 0;
  const operationKeys: unknown[] = [];
  const supabase = {
    rpc: async (_name: string, payload: Record<string, unknown>) => {
      calls += 1;
      if (_name === "read_commercial_conversation_fact_events_by_system") {
        return { data: [], error: null };
      }
      writerCalls += 1;
      operationKeys.push(payload.p_operation_key);
      if (writerCalls === 1) return { data: null, error: new Error("temporary writer failure") };
      return {
        data: {
          event_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          outcome: "created",
          operation_key: payload.p_operation_key,
          fact_key: payload.p_fact_key,
          conflict_group_key: payload.p_fact_key,
          created_at: "2026-11-19T12:01:00.000Z",
        },
        error: null,
      };
    },
  } as const;
  const message = {
    id: "human-panel-1",
    sender: "human",
    direction: "outgoing",
    content: "Na verdade prefiro algo menor.",
    message_type: "text",
    conversation_session_id: scope.conversationSessionId,
  };

  const failed = await reconcileCommercialConversationFactsFromMessages({
    supabase,
    ...scope,
    messages: [message],
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.attempted, 1);

  const recovered = await reconcileCommercialConversationFactsFromMessages({
    supabase,
    ...scope,
    messages: [message],
  });
  assert.equal(recovered.status, "reconciled");
  assert.equal(recovered.created, 1);
  assert.equal(calls, 4);
  assert.equal(operationKeys[0], operationKeys[1]);
});

test("10.5 nao reconcilia mensagem humana sem fato relevante nem libera contexto", async () => {
  const harness = fakeSupabase({});
  const result = await reconcileCommercialConversationFactsFromMessages({
    supabase: harness.supabase,
    ...scope,
    messages: [{
      id: "human-panel-no-fact",
      sender: "human",
      direction: "outgoing",
      content: "Ok, vou verificar.",
      message_type: "text",
      conversation_session_id: scope.conversationSessionId,
    }],
  });
  assert.deepEqual(result, {
    status: "skipped",
    attempted: 0,
    created: 0,
    replayed: 0,
    skipped: 0,
    errors: [],
  });
  assert.equal(harness.calls.length, 0);
});

test("10.5 falha de escopo impede a retomada da IA", async () => {
  const harness = fakeSupabase({
    event_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    outcome: "created",
    operation_key: "unused",
    fact_key: "need_summary",
    conflict_group_key: "need_summary",
    created_at: "2026-11-19T12:02:00.000Z",
  });
  const result = await reconcileCommercialConversationFactsFromMessages({
    supabase: harness.supabase,
    ...scope,
    messages: [{
      id: "human-panel-missing-session",
      sender: "human",
      direction: "outgoing",
      content: "Quero uma piscina para as crianças.",
      message_type: "text",
      conversation_session_id: null,
    }],
  });
  assert.equal(result.status, "failed");
  assert.equal(harness.calls.length, 0);
});

test("migration is append-only, server-only and scoped by all commercial identities", () => {
  const migration = readFileSync(
    "supabase/migrations/20261117200000_p9_10_5_commercial_conversation_fact_events_foundation.sql",
    "utf8",
  );
  assert.match(migration, /create table public\.commercial_conversation_fact_events/);
  assert.match(migration, /organization_id uuid not null/);
  assert.match(migration, /store_id uuid not null/);
  assert.match(migration, /conversation_id uuid not null/);
  assert.match(migration, /lead_id uuid not null/);
  assert.match(migration, /conversation_session_id uuid not null/);
  assert.match(migration, /operation_key text not null/);
  assert.match(migration, /commercial_conversation_fact_events_operation_uidx/);
  assert.match(migration, /commercial conversation fact operation key collision/);
  assert.match(migration, /v_existing\.commercial_session_context_link_id is distinct from p_commercial_session_context_link_id/);
  assert.match(migration, /v_existing\.commercial_opportunity_id is distinct from p_commercial_opportunity_id/);
  assert.match(migration, /v_existing\.source_media_type is distinct from v_media_type/);
  assert.match(migration, /v_existing\.actor_type is distinct from v_actor_type/);
  assert.match(migration, /v_existing\.evidence_level is distinct from v_evidence_level/);
  assert.match(migration, /v_existing\.event_kind is distinct from v_event_kind/);
  assert.match(migration, /v_existing\.supersedes_event_id is distinct from p_supersedes_event_id/);
  assert.match(migration, /e\.commercial_opportunity_id is null\s+and e\.commercial_session_context_link_id is null/);
  assert.match(migration, /commercial conversation fact reader opportunity mismatch/);
  assert.doesNotMatch(migration, /count\(distinct e\.value_json\) over/);
  assert.match(migration, /select distinct se\.fact_key, se\.commercial_opportunity_id, se\.value_json/);
  assert.match(migration, /group by dv\.fact_key, dv\.commercial_opportunity_id/);
  assert.match(migration, /prevent_commercial_conversation_fact_event_mutation\(\)/);
  assert.match(migration, /before update or delete on public\.commercial_conversation_fact_events/);
  assert.match(migration, /commercial conversation fact events are append-only/);
  assert.match(migration, /grant execute on function public\.write_commercial_conversation_fact_event_by_system/);
  assert.match(migration, /grant execute on function public\.read_commercial_conversation_fact_events_by_system/);
  assert.match(migration, /revoke all on table public\.commercial_conversation_fact_events from public, anon, authenticated, service_role/);
});
