import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20261111180000_zion_admin_final_close_manual_revenue_guard.sql",
    import.meta.url,
  ),
  "utf8",
);

test("creates the revenue verification function", () => {
  assert.match(
    sql,
    /CREATE FUNCTION public\.zion_admin_verify_final_close_manual_revenue_by_system/i,
  );
});

test("requires system authorization", () => {
  assert.match(sql, /auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  assert.match(sql, /FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /TO service_role/i);
});

test("uses security definer and fixed search path", () => {
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/i);
});

test("rejects invalid and unfinished months", () => {
  assert.match(sql, /INVALID_MONTH/);
  assert.match(sql, /MONTH_NOT_FINISHED/);
  assert.match(sql, /America\/Sao_Paulo/);
});

test("locks the same preclosure authority", () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /zion_admin_monthly_preclosure/);
});

test("locks and verifies the current preclosure", () => {
  assert.match(sql, /v_preclosure\.revision <> p_preclosure_revision/);
  assert.match(sql, /STALE_PRECLOSURE/);
  assert.match(
    sql,
    /FROM public\.zion_admin_monthly_preclosures\s+WHERE month = p_month\s+FOR SHARE/i,
  );
});

test("compares preclosure with its audit", () => {
  assert.match(sql, /zion_admin_monthly_preclosure_audit/);
  assert.match(sql, /PRECLOSURE_AUDIT_MISMATCH/);
});

test("locks and reads current revenue", () => {
  assert.match(
    sql,
    /FROM public\.zion_admin_monthly_manual_revenue\s+WHERE month = p_month\s+FOR SHARE/i,
  );
});

test("compares revenue with its audit", () => {
  assert.match(sql, /zion_admin_monthly_manual_revenue_audit/);
  assert.match(sql, /REVENUE_AUDIT_MISMATCH/);
});

test("rejects stale snapshot values and revisions", () => {
  assert.match(sql, /v_snapshot_revenue/);
  assert.match(sql, /amountBrlCents/);
  assert.match(sql, /SNAPSHOT_MISMATCH/);
});

test("distinguishes confirmed zero from absent revenue", () => {
  assert.match(sql, /manual_subscription_revenue/);
  assert.match(sql, /IS DISTINCT FROM 'confirmed'/);
  assert.match(sql, /NOT_REPORTED/);
});

test("does not modify values or finalize a month", () => {
  assert.doesNotMatch(
    sql,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|TRUNCATE\s+)/im,
  );
  assert.match(sql, /'definitive', false/);
});
