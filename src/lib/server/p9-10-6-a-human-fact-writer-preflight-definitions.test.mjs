import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const preflight = readFileSync(
  join(root, "supabase/diagnostics/p9-10-6-a-human-fact-writer-preflight.sql"),
  "utf8",
);

// These are the definitions emitted by pg_get_constraintdef(oid, true) for
// the historical and post-10.6 canonical CHECK constraints.
const historicalSource = "CHECK ((source_type = ANY (ARRAY['incoming_customer_message'::text, 'crm_manual'::text, 'system_inference'::text, 'system_correction'::text, 'migration_backfill'::text])))";
const historicalResolution = "CHECK ((resolves_conflict IS FALSE OR ((assertion_level = 'confirmed'::text) AND (source_type = ANY (ARRAY['incoming_customer_message'::text, 'crm_manual'::text, 'system_correction'::text])))))";
const installedSource = "CHECK ((source_type = ANY (ARRAY['incoming_customer_message'::text, 'crm_manual'::text, 'system_inference'::text, 'system_correction'::text, 'migration_backfill'::text, 'human_message'::text])) AND ((source_type <> 'human_message'::text) OR ((source_message_id IS NOT NULL) AND (source_conversation_id IS NOT NULL))))";
const installedResolution = "CHECK ((resolves_conflict IS FALSE OR ((assertion_level = 'confirmed'::text) AND (source_type = ANY (ARRAY['incoming_customer_message'::text, 'crm_manual'::text, 'system_correction'::text, 'human_message'::text])))))";

const quoted = (definition) => (definition.match(/'[^']+'/g) ?? []).length;
const oldSourcePredicate = (definition) => definition.toLowerCase().includes("sourcetype=anyarray");
const oldResolutionPredicate = (definition) => definition.toLowerCase().includes("assertion_level=confirmed");

// RED: the former comparisons reject real PostgreSQL output.
assert.equal(oldSourcePredicate(historicalSource), false);
assert.equal(oldResolutionPredicate(historicalResolution), false);

const sourcePredicate = (definition, installed) => {
  assert.match(definition, /source_type\s*=\s*ANY\s*\(\s*ARRAY\[/i);
  for (const value of ["incoming_customer_message", "crm_manual", "system_inference", "system_correction", "migration_backfill"]) {
    assert.match(definition, new RegExp(`'${value}'::text`));
  }
  assert.equal(quoted(definition), installed ? 7 : 5);
  if (installed) {
    assert.match(definition, /'human_message'::text/);
    assert.match(definition, /source_message_id\s+IS\s+NOT\s+NULL/i);
    assert.match(definition, /source_conversation_id\s+IS\s+NOT\s+NULL/i);
  } else {
    assert.doesNotMatch(definition, /'human_message'::text/);
  }
};

const resolutionPredicate = (definition, installed) => {
  assert.match(definition, /resolves_conflict\s+IS\s+FALSE\s+OR/i);
  assert.match(definition, /assertion_level\s*=\s*'confirmed'::text/i);
  for (const value of ["incoming_customer_message", "crm_manual", "system_correction"]) {
    assert.match(definition, new RegExp(`'${value}'::text`));
  }
  assert.equal(quoted(definition), installed ? 5 : 4);
  assert.equal(installed, /'human_message'::text/.test(definition));
};

// GREEN: exact literal/cast counts and authorized source sets are retained.
sourcePredicate(historicalSource, false);
resolutionPredicate(historicalResolution, false);
sourcePredicate(installedSource, true);
resolutionPredicate(installedResolution, true);

assert.ok(preflight.includes("source_type[[:space:]]*=[[:space:]]*any"));
assert.match(preflight, /'confirmed'::text/);
assert.match(preflight, /regexp_count\(raw_definition/);
const installedShape = preflight.slice(
  preflight.indexOf(") as installed_definition_marker"),
  preflight.indexOf(") as installed_shape"),
);
assert.match(installedShape, /'human_message'::text/);
assert.ok(
  installedShape.includes("regexp_count(raw_definition, '''[^'']+''') = 5"),
  "installed resolution must count confirmed plus four authorized source literals",
);

// GREEN negative controls: a renamed column or unauthorized source is blocked.
assert.throws(() => sourcePredicate(historicalSource.replace("source_type", "sourcetype"), false));
assert.throws(() => sourcePredicate(historicalSource.replace("'crm_manual'::text", "'unexpected'::text"), false));

console.log("PASS p9-10.6-A real constraint definition RED/GREEN fixtures");
