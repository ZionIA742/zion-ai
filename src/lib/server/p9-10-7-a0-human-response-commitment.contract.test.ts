import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261123160000_p9_10_7_a0_human_response_commitments.sql"), "utf8");

test("migration define persistência, proveniência e isolamento canônicos", () => {
  assert.match(migration, /conversation_session_id uuid null/);
  assert.match(migration, /source_message_id uuid not null/);
  assert.match(migration, /responsible_user_id uuid not null references auth\.users/);
  assert.match(migration, /due_at timestamptz not null/);
  assert.match(migration, /sent_by_user_id/);
  assert.match(migration, /message_echo/);
  assert.match(migration, /audio_transcript/);
  assert.match(migration, /create unique index conversation_human_response_commitments_one_active_uidx/);
  assert.match(migration, /human_response_commitment_explicit_confirmation_required/);
  assert.match(migration, /revoke all on table public\.conversation_human_response_commitments/);
  assert.match(migration, /grant execute on function public\.read_human_response_commitments_by_system/);
});

test("não modifica o processador de stale takeover", () => {
  assert.doesNotMatch(migration, /process_stale_human_conversations/);
  assert.doesNotMatch(migration, /human_release_conversation_to_ai/);
  assert.doesNotMatch(migration, /send_whatsapp|generate_ai|cron/);
});
