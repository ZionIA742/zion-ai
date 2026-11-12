import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20261112170000_zion_admin_preclosure_financial_root_contract.sql",
    import.meta.url,
  ),
  "utf8",
);

test("keeps costs nested and hoists revenue and financial result", () => {
  assert.match(
    sql,
    /'sources',\s*p_source_snapshot\s*-\s*'manualRevenue'\s*-\s*'financialResult'/,
  );
  assert.match(sql, /'manualRevenue',\s*p_source_snapshot\s*->\s*'manualRevenue'/);
  assert.match(sql, /'financialResult',\s*p_source_snapshot\s*->\s*'financialResult'/);
});

test("preserves legacy snapshots without financial fields", () => {
  assert.match(sql, /IF p_source_snapshot \? 'manualRevenue' THEN/);
  assert.match(sql, /ZION_ADMIN_PRECLOSURE_INVALID_FINANCIAL_FIELDS/);
  assert.match(sql, /\(p_source_snapshot \? 'manualRevenue'\)\s*<>/);
  assert.match(sql, /\(p_source_snapshot \? 'financialResult'\)/);
});

test("preserves role protection, locking and final-close guards", () => {
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path TO ''/);
  assert.match(sql, /auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /ZION_ADMIN_PRECLOSURE_MONTH_ALREADY_FINALIZED/);
  assert.match(sql, /ZION_ADMIN_PRECLOSURE_MONTH_ALREADY_CLOSED/);
  assert.match(sql, /ZION_ADMIN_PRECLOSURE_NOT_DUE/);
  assert.match(sql, /FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /TO service_role/);
});

test("preserves idempotency, revisions, auditing and transaction", () => {
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /status', 'unchanged'/);
  assert.match(sql, /v_existing\.revision \+ 1/);
  assert.match(sql, /INSERT INTO public\.zion_admin_monthly_preclosure_audit/);
  assert.match(sql, /'financial_status', 'preliminary'/);
  assert.match(sql, /END;\s*\$function\$;/);
  assert.match(sql, /COMMIT;\s*$/);
});
