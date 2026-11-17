import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const cutover = readFileSync(
  "supabase/migrations/20261114170000_p19a_whatsapp_cutover_connection_mode_persistence.sql",
  "utf8",
);
const preservation = readFileSync(
  "supabase/migrations/20261114180000_p19a_whatsapp_signup_connection_mode_preservation.sql",
  "utf8",
);
const recovery = readFileSync("src/lib/server/whatsapp-pin-recovery.ts", "utf8");
const d3 = readFileSync(
  "supabase/migrations/20261114210000_p9_10_5_d3_a_human_technical_visit_authority.sql",
  "utf8",
);

test("cutover requires candidate connection mode and never inherits a prior mode", () => {
  assert.match(cutover, /if\s+p_provenance\s+is\s+null\s+or\s+not\s+\(p_provenance\s+\?\s+'connection_mode'\)/);
  assert.match(cutover, /pg_catalog\.jsonb_typeof\(p_provenance -> 'connection_mode'\)\s+is distinct from 'string'/);
  assert.match(cutover, /\(p_provenance ->> 'connection_mode'\)\s+not in \('standard', 'business_app_coexistence'\)/);
  assert.match(cutover, /ZION_WHATSAPP_CHANGE_CONNECTION_MODE_REQUIRED/);
  assert.match(cutover, /- 'connection_mode'/);
  assert.match(cutover, /when p_provenance \? 'connection_mode' then/);
});

test("PIN recovery uses a mode-gated authority instead of the legacy first-connection writer", () => {
  assert.match(preservation, /create or replace function public\.materialize_store_whatsapp_pin_recovery_by_system/);
  assert.match(preservation, /ZION_WHATSAPP_PIN_RECOVERY_INTEGRATION_REQUIRED/);
  assert.match(preservation, /ZION_WHATSAPP_PIN_RECOVERY_CONNECTION_MODE_REQUIRED/);
  assert.match(preservation, /materialize_store_whatsapp_embedded_signup_by_system\([\s\S]*?\) from public, anon, authenticated, service_role/);
  assert.match(recovery, /materialize_store_whatsapp_pin_recovery_by_system/);
  assert.doesNotMatch(recovery, /materialize_store_whatsapp_embedded_signup_by_system/);
});

test("PIN recovery finalizer permits only standard PIN-pending inactive integration", () => {
  assert.match(preservation, /ZION_P19A_RECOVERY_PENDING_STANDARD_FINALIZATION_V1/);
  assert.match(preservation, /ZION_PIN_RECOVERY_FINALIZER_SOURCE_DRIFT/);
  assert.match(preservation, /e\.is_active IS FALSE/);
  assert.match(preservation, /e\.metadata ->> 'connection_mode' IS NOT DISTINCT FROM 'standard'/);
  assert.match(preservation, /e\.metadata ->> 'pin_activation_pending' IS NOT DISTINCT FROM 'true'/);
  assert.match(preservation, /public\.activate_whatsapp_phone_security_secret_by_system/);
  assert.match(recovery, /validated\.connectionMode === "standard" && integrationRow\.is_active === false/);
  assert.match(recovery, /finalize_whatsapp_pin_recovery_materialization_by_system/);
});

test("D3-A operation fingerprint matches its 64-character database contract", () => {
  assert.match(d3, /request_fingerprint text not null/);
  assert.match(d3, /length\(pg_catalog\.btrim\(request_fingerprint\)\) = 64/);
  assert.match(d3, /extensions\.digest\(/);
  assert.doesNotMatch(d3, /v_fingerprint := pg_catalog\.md5\(/);
});
