"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261109090000_zion_admin_monthly_manual_revenue.sql"), "utf8");

test("receita zero e explicita; nao ha default zero", () => {
  assert.match(sql, /amount_brl_cents bigint NOT NULL\s+CHECK \(amount_brl_cents BETWEEN 0 AND 100000000000\)/);
  assert.doesNotMatch(sql, /amount_brl_cents\s+bigint\s+DEFAULT\s+0/i);
});
test("mes canonico e nao futuro, horario Sao Paulo", () => {
  assert.match(sql, /date_trunc\('month', month::timestamp\)/);
  assert.match(sql, /p_month > v_today_month/);
  assert.match(sql, /America\/Sao_Paulo/);
});
test("somente service role invoca writer protegido", () => {
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.zion_admin_set_manual_monthly_revenue_by_system/);
  assert.match(sql, /FROM PUBLIC, anon, authenticated, service_role/);
});
test("registro e revisoes auditados e nao editaveis", () => {
  assert.match(sql, /CREATE TABLE public\.zion_admin_monthly_manual_revenue_audit/);
  assert.match(sql, /CONSTRAINT zamra_month_revision_unique UNIQUE\(month, revision\)/);
  assert.match(sql, /BEFORE UPDATE OR DELETE/);
  assert.match(sql, /BEFORE TRUNCATE/);
});
test("reenvio e concorrencia protegidos", () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /WHERE operation_key = p_operation_key/);
  assert.match(sql, /p_expected_revision <> v_current\.revision/);
  assert.match(sql, /ZION_ADMIN_MANUAL_REVENUE_OPERATION_REUSED/);
});
test("mes finalizado e recusado; dados Meta nao sao autoridade", () => {
  assert.match(sql, /FROM public\.zion_admin_monthly_final_closures/);
  assert.doesNotMatch(sql, /INSERT INTO public\.zion_admin_monthly_final_closures/);
  assert.doesNotMatch(sql, /meta_pricing_analytics|verified_not_applicable/i);
});
test("nenhum acesso direto de alteracao pelos papeis da aplicacao", () => {
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/g);
  assert.match(sql, /REVOKE ALL ON TABLE public\.zion_admin_monthly_manual_revenue FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.zion_admin_monthly_manual_revenue TO service_role/);
});
