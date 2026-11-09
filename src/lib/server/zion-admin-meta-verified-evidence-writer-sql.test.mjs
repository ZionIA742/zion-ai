import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  "supabase/migrations/20261109210000_zion_admin_meta_verified_evidence_writer.sql",
  "utf8",
);

test("utiliza evidencias canonicas sem duplicar tabelas", () => {
  assert.match(sql, /ALTER TABLE public\.zion_admin_monthly_final_evidence/);
  assert.doesNotMatch(sql, /CREATE TABLE\s+public\./i);
});

test("exige upload e revisao canonicos", () => {
  assert.match(sql, /meta_upload_id bigint/);
  assert.match(sql, /FROM public\.zion_admin_monthly_preclosures/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /FROM public\.zion_admin_financial_evidence_uploads/);
  assert.match(sql, /v_upload\.month IS DISTINCT FROM p_month/);
  assert.match(
    sql,
    /v_upload\.preclosure_revision IS DISTINCT FROM/,
  );
});

test("impede duplicacao e reutilizacao de operacao", () => {
  assert.match(sql, /CREATE UNIQUE INDEX zamfe_meta_operation_unique/);
  assert.match(sql, /ZION_ADMIN_META_EVIDENCE_OPERATION_REUSED/);
  assert.match(sql, /'outcome', 'replayed'/);
});

test("mantem regras de nao cobranca e ator", () => {
  assert.match(sql, /'verified_not_applicable'/);
  assert.match(sql, /p_amount_brl_cents <> 0/);
  assert.match(sql, /p_proof_type <> 'supplier_statement'/);
  assert.match(sql, /FROM auth\.users/);
  assert.match(sql, /auth\.role\(\)/);
});

test("bloqueia meses definitivamente fechados", () => {
  assert.match(sql, /zion_admin_monthly_final_closures/);
  assert.match(sql, /zion_admin_monthly_closures/);
  assert.match(sql, /ZION_ADMIN_META_EVIDENCE_MONTH_CLOSED/);
});

test("writer permanece sem permissao de execucao", () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION/);
  assert.doesNotMatch(sql, /^\s*GRANT\s+EXECUTE\b/im);
  assert.doesNotMatch(sql, /INSERT INTO public\.zion_admin_monthly_final_closures/i);
});