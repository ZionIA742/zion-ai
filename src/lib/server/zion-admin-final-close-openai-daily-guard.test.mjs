import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20261112173000_zion_admin_final_close_openai_daily_guard.sql",
    import.meta.url,
  ),
  "utf8",
);

test("verifier is restricted and never authorizes final close", () => {
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path TO ''/);
  assert.match(sql, /auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  assert.match(sql, /FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /TO service_role/);
  assert.match(sql, /'ptax_verified', false/);
  assert.match(sql, /'definitive', false/);
});

test("snapshot and audit use the canonical nested sources", () => {
  assert.match(sql, /\{sources,openai\}/);
  assert.match(sql, /zion_admin_monthly_preclosure_audit/);
  assert.match(sql, /a\.source_snapshot = v_snapshot/);
  assert.match(sql, /a\.pending_sources = v_pending/);
  assert.match(sql, /ZION_ADMIN_FINAL_OPENAI_STALE_PRECLOSURE/);
});

test("verifies daily operations and associated provider collections", () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /zion_admin_openai_cost_collection_operations/);
  assert.match(sql, /supersedes_operation_id/);
  assert.match(sql, /zion_admin_provider_cost_collections/);
  assert.match(sql, /query_identity/);
  assert.match(sql, /provider_timezone IS DISTINCT FROM 'UTC'/);
  assert.match(sql, /DAILY_OPERATION_AMBIGUOUS/);
});

test("verifies provider lines and daily snapshot provenance", () => {
  assert.match(sql, /zion_admin_provider_cost_lines/);
  assert.match(sql, /amount_decimal_text::numeric/);
  assert.match(sql, /amount_numeric IS DISTINCT FROM/);
  assert.match(sql, /jsonb_build_array/);
  assert.match(sql, /DAILY_PROVENANCE_MISMATCH/);
  assert.match(sql, /DAILY_USD_MISMATCH/);
  assert.match(sql, /MONTHLY_USD_MISMATCH/);
});

test("migration is transactional and does not modify financial records", () => {
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+public\./i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bzion_admin_monthly_final_close_gateway_by_system\s*\(/);
});

test("uses valid PostgreSQL date_part syntax", () => {
  assert.match(
    sql,
    /pg_catalog\.date_part\('day',\s*v_last_day\)::integer/,
  );
  assert.doesNotMatch(
    sql,
    /pg_catalog\.extract\s*\(/i,
  );
});
