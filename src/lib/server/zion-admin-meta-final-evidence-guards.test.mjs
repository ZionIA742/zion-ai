import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  "supabase/migrations/20261109193000_zion_admin_meta_final_evidence_guards.sql",
  "utf8",
);

test("reutiliza a tabela canonica de evidencias", () => {
  assert.match(
    sql,
    /ALTER TABLE public\.zion_admin_monthly_final_evidence/,
  );
  assert.doesNotMatch(
    sql,
    /CREATE TABLE\s+public\.zion_admin_monthly_final_evidence/i,
  );
});

test("distingue cobranca e nao aplicabilidade", () => {
  assert.match(sql, /meta_financial_status/);
  assert.match(sql, /'verified_amount'/);
  assert.match(sql, /'verified_not_applicable'/);
  assert.match(sql, /amount_brl_cents = 0/);
  assert.match(sql, /amount_usd IS NULL/);
  assert.match(sql, /proof_type = 'supplier_statement'/);
});

test("Meta exige upload vinculado ao mesmo mes e revisao", () => {
  assert.match(
    sql,
    /FROM public\.zion_admin_financial_evidence_uploads u/,
  );
  assert.match(sql, /u\.month = NEW\.month/);
  assert.match(
    sql,
    /u\.preclosure_revision\s*=\s*NEW\.preclosure_revision/,
  );
  assert.match(
    sql,
    /u\.document_sha256\s*=\s*NEW\.document_sha256/,
  );
});

test("evidencias nao podem ser modificadas", () => {
  assert.match(sql, /BEFORE UPDATE OR DELETE/);
  assert.match(sql, /ZION_ADMIN_FINAL_EVIDENCE_IMMUTABLE/);
});

test("migration nao abre gravacao direta nem fechamento", () => {
  assert.doesNotMatch(
    sql,
    /\bGRANT\s+(?:INSERT|UPDATE|DELETE|ALL)\b/i,
  );
  assert.doesNotMatch(
    sql,
    /INSERT INTO public\.zion_admin_monthly_final_closures/i,
  );
  assert.doesNotMatch(
    sql,
    /CREATE\s+(?:OR REPLACE\s+)?FUNCTION\s+public\.zion_admin_close_cost_month/i,
  );
});