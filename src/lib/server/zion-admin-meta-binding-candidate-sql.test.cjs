const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const sql = readFileSync(
  join(process.cwd(),
    "supabase/migrations/20261109123000_zion_admin_meta_binding_candidate_writer.sql"),
  "utf8"
);

test("somente service_role pode registrar eventos", () => {
  assert.match(sql, /auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION/);
});

test("vinculacao nao se torna autoridade de faturamento", () => {
  assert.match(sql, /'candidate_only'/);
  assert.match(sql, /'integration_state_observation'/);
  assert.doesNotMatch(sql, /'verified_amount'|'verified_not_applicable'/);
});

test("tenancy e estado da integracao sao conferidos", () => {
  assert.match(sql, /FROM public\.external_integrations/);
  assert.match(sql, /INNER JOIN public\.stores/);
  assert.match(sql, /FOR SHARE OF ei, s/);
});

test("chave de operacao rejeita reutilizacao divergente", () => {
  assert.match(sql, /WHERE operation_key = p_operation_key/);
  assert.match(sql, /ZION_ADMIN_META_BINDING_OPERATION_REUSED/);
  assert.match(sql, /'outcome', 'replayed'/);
});

test("transicoes financeiras nao podem saltar vinculacoes", () => {
  assert.match(sql, /ZION_ADMIN_META_BINDING_REQUIRES_UNBOUND/);
  assert.match(sql, /ZION_ADMIN_META_BINDING_INVALID_UNBOUND/);
  assert.match(sql, /pg_advisory_xact_lock/);
});

test("nao registra fechamento ou cobranca", () => {
  assert.doesNotMatch(sql, /INSERT INTO public\.zion_admin_monthly_final_closures/);
  assert.doesNotMatch(sql, /UPDATE public\.zion_admin_monthly_preclosures/);
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
});