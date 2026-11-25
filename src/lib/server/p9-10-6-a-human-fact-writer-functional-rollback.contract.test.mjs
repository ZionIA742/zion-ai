import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const sql = readFileSync(
  join(root, "supabase/tests/20261123120000_p9_10_6_a_human_fact_writer_functional_rollback.sql"),
  "utf8",
);

assert.match(sql, /begin;/i);
assert.match(sql, /rollback;/i);
assert.match(sql, /on commit drop/i);
assert.match(sql, /sender.*human/s);
assert.match(sql, /direction.*outgoing/s);
assert.match(sql, /'human_message'/);
assert.match(sql, /ZION_QFACT_HUMAN_PROVENANCE_INVALID/);
assert.match(sql, /v_bad_fixture_found := found/);
assert.match(sql, /v_provenance_sqlstate/);
assert.match(sql, /v_provenance_message/);
assert.match(sql, /v_scope_sqlstate/);
assert.match(sql, /v_scope_message/);
assert.match(sql, /v_scope_sqlstate = '23503'/);
assert.match(sql, /v_scope_message = 'qualification source message not found in scope'/);
// RED guard: the former generic SQLSTATE acceptance must not return.
assert.doesNotMatch(sql, /v_isolated\s*:=\s*v_scope_sqlstate\s+in\s*\(/s);
assert.match(sql, /conversation_id/);
assert.match(sql, /organization_id/);
assert.match(sql, /store_id/);
assert.match(sql, /commercial_opportunity_id/);
assert.match(sql, /idempotent/);
assert.match(sql, /canonical_facts_preserved/);
assert.match(sql, /baseline_events/);
assert.match(sql, /to_jsonb\(e\) is distinct from b\.row_json/);
  assert.match(sql, /jsonb_agg\(to_jsonb\(c\) order by to_jsonb\(c\)::text\)/);
assert.match(sql, /BLOCKED_BY_FIXTURE_PREREQUISITE/);
assert.match(sql, /persistent_write.*false/s);
assert.doesNotMatch(sql, /https?:\/\//i);
assert.doesNotMatch(sql, /fetch\s*\(|pg_net|http_request|net\.http|enqueue.*external/i);
assert.doesNotMatch(sql, /create\s+(or\s+replace\s+)?function|alter\s+table|create\s+table\s+public/i);
assert.doesNotMatch(sql, /(?:insert|update|delete)\s+into?\s+public\./i);
assert.doesNotMatch(sql, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);

console.log("PASS p9-10.6-A functional SQL rollback contract");
