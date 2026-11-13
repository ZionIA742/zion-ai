import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261114010000_p9_panel_human_message_takeover.sql",
  ),
  "utf8",
);

test("panel human outbound messages use the canonical takeover atomically", () => {
  assert.match(migration, /perform public\.private_acquire_sales_contract_conversation_xact_lock\(p_conversation_id\)/);
  assert.match(
    migration,
    /v_sender = 'human'[\s\S]*v_direction = 'outgoing'[\s\S]*p_metadata ->> 'source'[\s\S]*= 'panel'/,
  );
  assert.match(migration, /p_metadata ->> 'outbound_origin'[\s\S]*= 'crm_manual_text'/);
  assert.match(migration, /p_metadata ->> 'source_channel'[\s\S]*= 'panel_manual'/);
  assert.match(migration, /perform public\.human_takeover_conversation\(/);
  assert.match(migration, /automatic_panel_human_message/);
  assert.ok(
    migration.indexOf("perform public.human_takeover_conversation(") <
      migration.indexOf("insert into public.messages"),
  );
});

test("non-panel writers cannot enter takeover through this condition", () => {
  assert.match(migration, /coalesce\(p_metadata ->> 'source', ''\) = 'panel'/);
  assert.match(migration, /v_sender = 'human'/);
  assert.match(migration, /v_direction = 'outgoing'/);
  assert.doesNotMatch(migration, /source.*meta_whatsapp_webhook/);
});
