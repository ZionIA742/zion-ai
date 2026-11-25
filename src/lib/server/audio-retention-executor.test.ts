import assert from "node:assert/strict";
import test from "node:test";
import { executeAudioRetention } from "./audio-retention-executor";

const baseMetadata = {
  attachment_kind: "audio",
  media_origin: "customer",
  storage_bucket: "zion-store-files",
  storage_path: "org-1/store-1/whatsapp-inbound/conversation-1/media.webm",
  audio_transcript: "texto persistido",
  transcription_status: "succeeded",
  audio_fact_extraction_status: "completed_no_relevant_facts",
  audio_retention_eligible_at: "2026-11-23T12:00:00.000Z",
};

function harness(args: {
  metadata?: Record<string, unknown>;
  removeError?: string;
  claimOutcome?: string;
}) {
  const rpcCalls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const removeCalls: string[] = [];
  const row = {
    id: "message-1",
    organization_id: "org-1",
    store_id: "store-1",
    metadata: args.metadata || baseMetadata,
  };
  const supabase = {
    from: () => ({
      select: () => ({
        eq() { return this; },
        in() { return this; },
        is() { return this; },
        limit: async () => ({ data: [row], error: null }),
      }),
    }),
    rpc: async (name: string, payload: Record<string, unknown>) => {
      rpcCalls.push({ name, payload });
      if (name.startsWith("claim_")) {
        if (args.claimOutcome !== "claimed") return { data: [], error: null };
        return {
          data: [{
            message_id: row.id,
            storage_bucket: row.metadata.storage_bucket,
            storage_path: row.metadata.storage_path,
            claim_token: payload.p_claim_token,
            outcome: "claimed",
          }],
          error: null,
        };
      }
      return { data: [{ message_id: row.id, outcome: payload.p_outcome }], error: null };
    },
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          removeCalls.push(...paths);
          return args.removeError ? { error: { message: args.removeError } } : { error: null };
        },
      }),
    },
  } as any;
  return { supabase, rpcCalls, removeCalls };
}

test("does not delete at 23:59", async () => {
  const h = harness({ claimOutcome: "claimed" });
  const result = await executeAudioRetention({
    supabase: h.supabase,
    organizationId: "org-1",
    storeId: "store-1",
    now: new Date("2026-11-24T11:59:00.000Z"),
  });
  assert.equal(result.skipped, 1);
  assert.equal(h.removeCalls.length, 0);
  assert.equal(h.rpcCalls.length, 0);
});

test("rejects invalid, null, and empty eligibility timestamps", async () => {
  for (const marker of ["invalid-timestamp", null, ""]) {
    const h = harness({
      claimOutcome: "claimed",
      metadata: { ...baseMetadata, audio_retention_eligible_at: marker },
    });
    const result = await executeAudioRetention({
      supabase: h.supabase,
      organizationId: "org-1",
      storeId: "store-1",
      now: new Date("2026-11-24T12:00:00.000Z"),
    });
    assert.equal(result.skipped, 1);
    assert.equal(h.rpcCalls.length, 0);
    assert.equal(h.removeCalls.length, 0);
  }
});

test("claims and deletes at 24 hours, then finalizes persistently", async () => {
  const h = harness({ claimOutcome: "claimed" });
  const result = await executeAudioRetention({
    supabase: h.supabase,
    organizationId: "org-1",
    storeId: "store-1",
    now: new Date("2026-11-24T12:00:00.000Z"),
  });
  assert.deepEqual(result, { scanned: 1, claimed: 1, deleted: 1, failed: 0, skipped: 0 });
  assert.deepEqual(h.removeCalls, [baseMetadata.storage_path]);
  assert.deepEqual(h.rpcCalls.map((call) => call.name), [
    "claim_audio_retention_deletion_by_system",
    "finish_audio_retention_deletion_by_system",
  ]);
});

test("keeps the path available for retry when storage deletion fails", async () => {
  const h = harness({ claimOutcome: "claimed", removeError: "temporary storage outage" });
  const result = await executeAudioRetention({
    supabase: h.supabase,
    organizationId: "org-1",
    storeId: "store-1",
    now: new Date("2026-11-24T12:00:00.000Z"),
  });
  assert.equal(result.failed, 1);
  assert.equal(h.rpcCalls[1]?.payload.p_outcome, "failed");
  assert.equal(h.rpcCalls[1]?.payload.p_error, "temporary storage outage");
  assert.equal(h.removeCalls[0], baseMetadata.storage_path);
});

test("does not replay a claimed or deleted object", async () => {
  for (const status of ["claimed", "deleted"]) {
    const h = harness({
      claimOutcome: "claimed",
      metadata: { ...baseMetadata, audio_retention_deletion_status: status },
    });
    const result = await executeAudioRetention({
      supabase: h.supabase,
      organizationId: "org-1",
      storeId: "store-1",
      now: new Date("2026-11-24T12:00:00.000Z"),
    });
    assert.equal(result.skipped, 1);
    assert.equal(h.rpcCalls.length, 0);
    assert.equal(h.removeCalls.length, 0);
  }
});
