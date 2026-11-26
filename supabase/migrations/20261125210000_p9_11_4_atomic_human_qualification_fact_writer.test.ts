import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261125210000_p9_11_4_atomic_human_qualification_fact_writer.sql"), "utf8");

assert.match(migration, /create or replace function public\.apply_commercial_qualification_fact_internal_if_current/);
assert.doesNotMatch(migration, /apply_commercial_opportunity_qualification_fact_internal_if_current/);
assert.match(migration, /pg_advisory_xact_lock\([\s\S]*zion:p9:qfact:/);
assert.match(migration, /from public\.commercial_opportunity_qualification_facts_current[\s\S]*for update/);
assert.match(migration, /ZION_QFACT_EXPECTED_REVISION_MISMATCH/);
assert.match(migration, /if exists \([\s\S]*commercial_opportunity_qualification_fact_events/);
assert.match(migration, /write_commercial_qualification_fact_by_user_if_current/);
assert.doesNotMatch(migration, /write_commercial_opportunity_qualification_fact_by_user_if_current/);
assert.match(migration, /p_expected_last_event_id uuid/);
assert.match(migration, /if v_result\.changed is true/);
console.log("atomic qualification writer migration: PASS");
