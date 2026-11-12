import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20261111210000_zion_admin_final_close_nested_sources_fix.sql",
    import.meta.url,
  ),
  "utf8",
);

test("updates both existing verifiers", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.zion_admin_verify_final_close_manual_revenue_by_system/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.zion_admin_verify_final_close_registered_costs_by_system/);
});

test("reads declared revenue inside sources", () => {
  assert.match(sql, /source_snapshot #> '\{sources,manualRevenue\}'/);
});

test("reads fixed expenses inside sources", () => {
  assert.match(sql, /#> '\{sources,fixed\}'/);
  assert.match(sql, /#>> '\{sources,fixed,status\}'/);
  assert.match(sql, /#> '\{sources,fixed,registeredBrlCents\}'/);
});

test("reads manual expenses inside sources", () => {
  assert.match(sql, /#> '\{sources,manual\}'/);
  assert.match(sql, /#>> '\{sources,manual,status\}'/);
  assert.match(sql, /#> '\{sources,manual,registeredBrlCents\}'/);
  assert.match(sql, /#> '\{sources,manual,registeredUsdCents\}'/);
});

test("does not retain the incorrect root paths", () => {
  assert.doesNotMatch(sql, /source_snapshot\s*->\s*'(fixed|manual|manualRevenue)'/);
  assert.doesNotMatch(sql, /source_snapshot\s*#(?:>|>>)\s*'\{(fixed|manual),/);
});

test("preserves the safety checks", () => {
  assert.equal(
    (sql.match(/SECURITY DEFINER/g) ?? []).length,
    2,
  );
  assert.match(sql, /STALE_PRECLOSURE/);
  assert.match(sql, /PRECLOSURE_AUDIT_MISMATCH/);
  assert.match(sql, /SNAPSHOT_MISMATCH/);
  assert.match(sql, /TO service_role/g);
});

test("does not enable a final close or change expenses", () => {
  assert.match(sql, /'definitive', false/g);
  assert.doesNotMatch(
    sql,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|TRUNCATE\s+)/im,
  );
});
