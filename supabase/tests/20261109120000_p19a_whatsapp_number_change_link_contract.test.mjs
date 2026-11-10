import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL("../migrations/20261005100000_p19a_whatsapp_number_change_link_foundation.sql", import.meta.url),
  "utf8",
);

test("number-change authorization is hash-only, owner-bound, expiring, and single-use", () => {
  assert.match(migration, /responsible_user_id uuid/);
  assert.match(migration, /token_hash text not null/);
  assert.match(migration, /expires_at timestamptz not null/);
  assert.match(migration, /status in \('issued', 'started', 'completed', 'revoked', 'expired'\)/);
  assert.match(migration, /p_responsible_user_id uuid/);
  assert.match(migration, /v_link\.responsible_user_id is distinct from p_responsible_user_id/);
  assert.match(migration, /whatsapp_number_change_links_active_scope_uidx/);
  assert.match(migration, /status in \('completed', 'revoked', 'expired'\)/);
});
