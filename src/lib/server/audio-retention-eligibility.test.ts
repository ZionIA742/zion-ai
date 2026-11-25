import assert from "node:assert/strict";
import test from "node:test";
import {
  markAudioRetentionEligibleBySystem,
  resolveAudioFactExtractionStatus,
} from "./audio-retention-eligibility";

test("marks audio with relevant commercial facts only after a clean extraction", () => {
  assert.equal(
    resolveAudioFactExtractionStatus({
      status: "created",
      errors: [],
      writes: [{ outcome: "created" }],
    }),
    "completed_with_facts",
  );
});

test("marks a clean extraction with no relevant facts distinctly", () => {
  assert.equal(
    resolveAudioFactExtractionStatus({
      status: "skipped",
      errors: [],
      writes: [],
    }),
    "completed_no_relevant_facts",
  );
});

test("does not mark failed, transcript-missing, or unscoped audio", () => {
  for (const input of [
    { status: "partial" as const, errors: ["writer_failed"], writes: [] },
    { status: "skipped" as const, reason: "audio_transcript_unavailable", errors: [], writes: [] },
    { status: "skipped" as const, reason: "missing_session_scope", errors: [], writes: [] },
  ]) {
    assert.equal(resolveAudioFactExtractionStatus(input), null);
  }
});

test("a retry can become eligible only after the later clean extraction", () => {
  assert.equal(
    resolveAudioFactExtractionStatus({
      status: "partial",
      errors: ["temporary_writer_failure"],
      writes: [],
    }),
    null,
  );
  assert.equal(
    resolveAudioFactExtractionStatus({
      status: "replayed",
      errors: [],
      writes: [{ outcome: "replayed" }],
    }),
    "completed_no_relevant_facts",
  );
});

test("accepts an atomic first mark and an idempotent concurrent replay", async () => {
  const calls: unknown[] = [];
  const supabase = {
    rpc: async (_name: string, payload: unknown) => {
      calls.push(payload);
      return {
        data: [{
          message_id: "audio-1",
          marked_at: "2026-11-24T12:00:00.000Z",
          outcome: calls.length === 1 ? "marked" : "already_marked",
          fact_extraction_status: "completed_no_relevant_facts",
        }],
        error: null,
      };
    },
  };

  const first = await markAudioRetentionEligibleBySystem({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conversation-1",
    messageId: "audio-1",
    factExtractionStatus: "completed_no_relevant_facts",
  });
  const replay = await markAudioRetentionEligibleBySystem({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conversation-1",
    messageId: "audio-1",
    factExtractionStatus: "completed_no_relevant_facts",
  });

  assert.equal(first.outcome, "marked");
  assert.equal(replay.outcome, "already_marked");
  assert.equal(first.marked_at, replay.marked_at);
  assert.equal(calls.length, 2);
});

test("fails closed when the atomic RPC rejects the preconditions", async () => {
  await assert.rejects(
    markAudioRetentionEligibleBySystem({
      supabase: {
        rpc: async () => ({ data: null, error: { message: "audio_retention_eligibility_precondition_failed" } }),
      },
      organizationId: "org-1",
      storeId: "store-1",
      conversationId: "conversation-1",
      messageId: "audio-1",
      factExtractionStatus: "completed_with_facts",
    }),
    /audio_retention_eligibility_mark_failed/,
  );
});
