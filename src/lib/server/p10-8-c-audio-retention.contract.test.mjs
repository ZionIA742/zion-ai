import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync("supabase/migrations/20261124200000_p10_8_c_audio_retention_executor.sql", "utf8");
const executor = fs.readFileSync("src/lib/server/audio-retention-executor.ts", "utf8");
const cron = fs.readFileSync("src/app/api/cron/whatsapp-process-all/route.ts", "utf8");
const mediaRoute = fs.readFileSync("src/app/api/crm/messages/[messageId]/signed-media-url/route.ts", "utf8");

test("executor migration claims atomically and preserves original references", () => {
  assert.match(migration, /claim_audio_retention_deletion_by_system/);
  assert.match(migration, /finish_audio_retention_deletion_by_system/);
  assert.match(migration, /audio_retention_eligible_at/);
  assert.match(migration, /interval '24 hours'/);
  assert.match(migration, /audio_retention_deletion_claim_token/);
  assert.match(migration, /audio_retention_next_attempt_at/);
  assert.match(migration, /audio_retention_file_deleted/);
  assert.doesNotMatch(migration, /delete from public\.messages/i);
  assert.doesNotMatch(migration, /storage\.from/i);
});

test("executor is commercial-audio-only and cron remains opt-in", () => {
  assert.match(executor, /message_type.*audio/);
  assert.match(executor, /media_origin.*customer.*human/);
  assert.match(executor, /whatsapp-inbound/);
  assert.match(cron, /ZION_AUDIO_RETENTION_EXECUTOR_ENABLED === "true"/);
  assert.match(cron, /executeAudioRetention/);
});

test("CRM media interface refuses deleted audio", () => {
  assert.match(mediaRoute, /audio_retention_file_deleted/);
  assert.match(mediaRoute, /AUDIO_RETENTION_EXPIRED/);
  assert.match(mediaRoute, /410/);
});
