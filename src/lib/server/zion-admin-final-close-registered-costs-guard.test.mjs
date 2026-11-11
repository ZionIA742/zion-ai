import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20261111190000_zion_admin_final_close_registered_costs_guard.sql",
    import.meta.url,
  ),
  "utf8",
);

test("defines the registered costs verifier", () => {
  assert.match(sql, /CREATE FUNCTION public\.zion_admin_verify_final_close_registered_costs_by_system/i);
});

test("restricts execution to service role", () => {
  assert.match(sql, /auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  assert.match(sql, /FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /TO service_role/i);
});

test("uses security definer with fixed search path", () => {
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/i);
});

test("rejects unfinished months", () => {
  assert.match(sql, /MONTH_NOT_FINISHED/);
  assert.match(sql, /America\/Sao_Paulo/);
});

test("uses the preclosure concurrency authority", () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /STALE_PRECLOSURE/);
});

test("checks preclosure audit consistency", () => {
  assert.match(sql, /zion_admin_monthly_preclosure_audit/);
  assert.match(sql, /PRECLOSURE_AUDIT_MISMATCH/);
});

test("locks relevant finance tables", () => {
  assert.match(sql, /LOCK TABLE[\s\S]*zion_admin_fixed_cost_items/);
  assert.match(sql, /zion_admin_fixed_cost_versions/);
  assert.match(sql, /zion_admin_variable_expenses/);
  assert.match(sql, /IN SHARE MODE/);
});

test("selects the latest effective fixed cost version", () => {
  assert.match(sql, /DISTINCT ON \(v\.item_id\)/);
  assert.match(sql, /v\.effective_month <= p_month/);
  assert.match(sql, /ORDER BY v\.item_id, v\.effective_month DESC/);
});

test("preserves exact annual allocation", () => {
  assert.match(sql, /pg_catalog\.floor\(/);
  assert.match(sql, /a\.frequency = 'annual'/);
  assert.match(sql, /a\.starts_on > v_month_end/);
});

test("counts active expenses in separate currencies", () => {
  assert.match(sql, /competence_month = p_month\s+AND status = 'active'/);
  assert.match(sql, /currency = 'BRL'/);
  assert.match(sql, /currency = 'USD'/);
});

test("rejects divergent snapshot totals", () => {
  assert.match(sql, /FIXED_SNAPSHOT_MISMATCH/);
  assert.match(sql, /MANUAL_SNAPSHOT_MISMATCH/);
  assert.match(sql, /registeredBrlCents/);
  assert.match(sql, /registeredUsdCents/);
});

test("blocks unsupported USD conversion and finalization", () => {
  assert.match(sql, /MANUAL_USD_FX_MISSING/);
  assert.match(sql, /'definitive', false/);
  assert.doesNotMatch(
    sql,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|TRUNCATE\s+)/im,
  );
});
