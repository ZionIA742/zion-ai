import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  join(
    root,
    "supabase",
    "migrations",
    "20261114030000_p19a_whatsapp_pin_replay_waba_scope.sql",
  ),
  "utf8",
);

const previousMigration = readFileSync(
  join(
    root,
    "supabase",
    "migrations",
    "20261114000000_p19a_whatsapp_pin_materialization_atomicity.sql",
  ),
  "utf8",
);

function normalizeWaba(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function mayReplay(
  persistedWaba: string | null | undefined,
  incomingWaba: string | null | undefined,
): boolean {
  const persisted = normalizeWaba(persistedWaba);
  const incoming = normalizeWaba(incomingWaba);
  return persisted !== null && incoming !== null && persisted === incoming;
}

const cases: Array<[string, string | null | undefined, string | null | undefined, boolean]> = [
  ["correct WABA", "waba-1", "waba-1", true],
  ["divergent WABA", "waba-1", "waba-2", false],
  ["missing incoming WABA", "waba-1", null, false],
  ["missing persisted WABA", null, "waba-1", false],
  ["blank incoming WABA", "waba-1", "  ", false],
];

for (const [name, persistedWaba, incomingWaba, expected] of cases) {
  assert.equal(mayReplay(persistedWaba, incomingWaba), expected, name);
}

assert.match(migration, /to_regprocedure\(/);
assert.match(migration, /ZION_WHATSAPP_PIN_PENDING_WABA_SCOPE_MISMATCH/);
assert.match(migration, /coalesce\(v_integration\.whatsapp_business_account_id/);
assert.match(migration, /coalesce\(p_whatsapp_business_account_id/);
assert.match(migration, /is distinct from pg_catalog\.btrim\(p_whatsapp_business_account_id\)/);
assert.match(migration, /pg_catalog\.replace\(v_definition, v_marker, v_replacement\)/);
assert.match(previousMigration, /p_whatsapp_business_account_id text/);

console.log("whatsapp PIN replay WABA contract: passed");
