import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20261111165000_zion_admin_monthly_final_close_guarded_gateway.sql",
    import.meta.url,
  ),
  "utf8",
);

test("creates a dedicated final-close gateway", () => {
  assert.match(
    sql,
    /CREATE FUNCTION public\.zion_admin_monthly_final_close_gateway_by_system/i,
  );
});

test("uses security definer with restricted search path", () => {
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/i);
});

test("rejects unauthorized roles", () => {
  assert.match(
    sql,
    /auth\.role\(\) IS DISTINCT FROM 'service_role'/i,
  );
});

test("validates month and reason", () => {
  assert.match(sql, /ZION_ADMIN_FINAL_CLOSE_INVALID_MONTH/);
  assert.match(sql, /ZION_ADMIN_FINAL_CLOSE_INVALID_REASON/);
});

test("uses Sao Paulo calendar and blocks the current month", () => {
  assert.match(sql, /America\/Sao_Paulo/);
  assert.match(sql, /p_month >= v_current_month/);
  assert.match(sql, /month_not_finished/);
});

test("locks consistently with preclosure", () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /zion_admin_monthly_preclosure/);
});

test("rejects an existing finalized month", () => {
  assert.match(sql, /zion_admin_monthly_final_closures/);
  assert.match(sql, /already_finalized/);
});

test("requires the database preflight", () => {
  assert.match(
    sql,
    /public\.zion_admin_monthly_final_close_preflight_by_system/,
  );
  assert.match(sql, /source_authority_unverified/);
});

test("remains blocked without independently bound evidence", () => {
  assert.match(sql, /final_source_binding_not_implemented/);
  assert.doesNotMatch(
    sql,
    /\bINSERT\s+INTO\b|\bDELETE\s+FROM\b|\bUPDATE\s+public\./i,
  );
});

test("does not grant execute to application user roles", () => {
  assert.match(
    sql,
    /FROM PUBLIC, anon, authenticated/i,
  );
  assert.match(
    sql,
    /TO service_role/i,
  );
});
