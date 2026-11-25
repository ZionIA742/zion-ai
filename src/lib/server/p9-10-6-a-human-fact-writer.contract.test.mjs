import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const migration = readFileSync(
  join(root, "supabase/migrations/20261119010000_p9_10_6_a_human_fact_writer_extension.sql"),
  "utf8",
);

assert.match(migration, /human_message/);
assert.match(migration, /sender.*human/s);
assert.match(migration, /direction.*outgoing/s);
assert.match(migration, /ZION_QFACT_INCOMING_PROVENANCE_REQUIRED/);
assert.match(migration, /ZION_QFACT_HUMAN_PROVENANCE_REQUIRED/);
assert.match(migration, /ZION_QFACT_HUMAN_PROVENANCE_INVALID/);
assert.match(migration, /pg_get_functiondef/);
assert.match(migration, /has_function_privilege/);
assert.match(migration, /pg_get_userbyid/);
assert.match(migration, /prosecdef/);
assert.doesNotMatch(migration, /pg_catalog\.position\s*\(/);
assert.match(migration, /pg_catalog\.replace\(v_definition, v_old, ''\)/);
assert.match(migration, /one or more internal replacements were not applied/);
assert.match(migration, /system source replacement was not applied/);
assert.match(migration, /p9_qfact_events_source_type_chk/);
assert.match(migration, /p9_qfact_current_source_type_chk/);
assert.match(migration, /p9_qfact_events_resolution_chk/);
assert.match(migration, /pg_catalog\.pg_constraint/);
assert.match(migration, /pg_catalog\.pg_get_constraintdef/);
assert.match(migration, /canonical CHECK constraint identity is incomplete/);
assert.match(migration, /canonical human CHECK constraints were not installed/);
assert.equal(
  (migration.match(/add constraint p9_qfact_(?:events_source_type_chk|current_source_type_chk|events_resolution_chk)/g) ?? []).length,
  3,
  "exactly the three canonical CHECK constraints must be replaced",
);
assert.match(migration, /source_type <> 'human_message'/);
assert.match(migration, /source_message_id is not null and source_conversation_id is not null/);
assert.match(migration, /source_type in \([\s\S]*'system_correction',[\s\S]*'human_message'/);
assert.ok(
  (migration.match(/precondition failed: [^\n]+replacement is not unique/g) ?? []).length >= 6,
  "every mandatory replacement must have a unique-source precondition",
);
assert.ok(
  (migration.match(/v_definition := pg_catalog\.replace\(v_definition, v_old, v_new\)/g) ?? []).length === 6,
  "the migration must perform exactly the six planned replacements",
);
assert.doesNotMatch(migration, /create table|create trigger|create queue/i);
assert.doesNotMatch(migration, /p9_10_3|human_release_conversation_to_ai|process_stale_human_conversations/i);

const preflight = readFileSync(
  join(root, "supabase/diagnostics/p9-10-6-a-human-fact-writer-preflight.sql"),
  "utf8",
);
assert.match(preflight, /canonical_constraints/);
assert.match(preflight, /p9_qfact_events_source_type_chk/);
assert.match(preflight, /p9_qfact_current_source_type_chk/);
assert.match(preflight, /p9_qfact_events_resolution_chk/);
assert.match(preflight, /PENDING_10_6_A_COMPATIBLE_BASELINE/);
assert.match(preflight, /INSTALLED_10_6_A/);
assert.match(preflight, /BLOCKED_CANONICAL_CONSTRAINT_DEFINITION/);
assert.match(preflight, /canonical_constraint_identity_ok/);
assert.match(preflight, /BLOCKED_CANONICAL_CONSTRAINT_IDENTITY/);

console.log("PASS p9-10.6-A human writer contract");
