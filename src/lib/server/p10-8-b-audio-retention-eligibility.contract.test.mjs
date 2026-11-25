import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "supabase/migrations/20261124190000_p10_8_b_audio_retention_eligibility.sql",
  "utf8",
);
const processor = fs.readFileSync(
  "src/lib/server/whatsapp-inbox-processor.ts",
  "utf8",
);

test("retention marker is atomic, scoped, audio-only, and set-if-absent", () => {
  assert.match(migration, /create or replace function public\.mark_audio_retention_eligible_by_system/);
  assert.match(migration, /m\.organization_id = p_organization_id/);
  assert.match(migration, /m\.store_id = p_store_id/);
  assert.match(migration, /m\.conversation_id = p_conversation_id/);
  assert.match(migration, /m\.message_type = 'audio'/);
  assert.match(migration, /audio_transcript/);
  assert.match(migration, /transcription_status.*succeeded/);
  assert.match(migration, /audio_retention_eligible_at.*is null/);
  assert.match(migration, /'completed_with_facts', 'completed_no_relevant_facts'/);
  assert.match(migration, /audio_fact_extraction_status/);
  assert.match(migration, /'already_marked'/);
  assert.doesNotMatch(migration, /delete from public\.messages/i);
  assert.doesNotMatch(migration, /storage\.from/i);
});

test("processor marks only after the fact writer returns without errors", () => {
  assert.match(processor, /ingestCommercialConversationFactsFromMessage\(args\)/);
  assert.match(processor, /if \(result\.errors\.length > 0\)/);
  assert.match(processor, /markAudioRetentionEligibleBySystem\(/);
  assert.match(processor, /message\.message_type.*audio/);
});
