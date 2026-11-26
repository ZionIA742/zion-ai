import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261125233000_p9_10_5_p9_10_4_jwt_claims_compat.sql", "utf8");

test("F.6-B repairs exactly the five confirmed authorities with auth.role()", () => {
  for (const name of [
    "read_commercial_conversation_fact_events_by_system",
    "write_commercial_conversation_fact_event_by_system",
    "p9_10_4_d_assert_recovery_set_authority",
    "p9_10_4_d_assert_recovery_set_claim_authority",
    "p9_10_4_d_assert_recovery_write_authority",
  ]) assert.match(migration, new RegExp(`create or replace function public\\.${name}`));
  assert.equal((migration.match(/if auth\.role\(\) is distinct from 'service_role'/g) ?? []).length, 5);
  assert.doesNotMatch(migration, /lead_customer_link_request_role/);
  assert.doesNotMatch(migration, /current_setting\('request\.jwt\.claim\.role'/);
  assert.doesNotMatch(migration, /session_user/);
  assert.doesNotMatch(migration, /regexp_replace|pg_get_functiondef\(/);
});

test("F.6-B preserves authority contracts, recovery_set five UUIDs and grants", () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = pg_catalog, pg_temp, public/);
  assert.match(migration, /set row_security = off/);
  assert.match(migration, /alter function public\.read_commercial_conversation_fact_events_by_system\(uuid,uuid,uuid,uuid,uuid,uuid,uuid\) owner to postgres/);
  assert.match(migration, /alter function public\.p9_10_4_d_assert_recovery_set_authority\(uuid,uuid,uuid,uuid,uuid\) owner to postgres/);
  assert.match(migration, /grant execute on function public\.p9_10_4_d_assert_recovery_set_authority\(uuid,uuid,uuid,uuid,uuid\) to service_role/);
  assert.match(migration, /grant execute on function public\.write_commercial_conversation_fact_event_by_system[\s\S]*to service_role/);
});

test("F.6-B has no psql metacommands or transaction terminators", () => {
  assert.doesNotMatch(migration, /^\\(?:set|ir|if|endif|else)\b/im);
  assert.doesNotMatch(migration, /^\s*(?:begin|commit|rollback)\s*;/im);
});
