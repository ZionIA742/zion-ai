import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  "supabase/migrations/20261110143000_zion_admin_meta_atomic_evidence_lines_writer.sql",
  "utf8",
);

test("registra total e linhas em uma funcao transacional", () => {
  assert.match(
    sql,
    /zion_admin_register_verified_meta_evidence_by_system/,
  );

  assert.match(
    sql,
    /INSERT INTO public\.zion_admin_meta_billing_account_lines/,
  );

  assert.match(sql, /p_lines jsonb/);
});

test("valida soma, tipo e quantidade antes da escrita", () => {
  assert.match(sql, /v_total IS DISTINCT FROM p_amount_brl_cents/);
  assert.match(sql, /v_amount_records <> 0/);
  assert.match(sql, /v_amount_records = 0/);
  assert.match(sql, /jsonb_array_length\(p_lines\) NOT BETWEEN 1 AND 5000/);

  const total = sql.indexOf("ZION_ADMIN_META_ATOMIC_TOTAL_MISMATCH");
  const writer = sql.indexOf(
    "v_result :=\n        public.zion_admin_register_verified_meta_evidence_by_system",
  );

  assert.ok(total >= 0);
  assert.ok(writer > total);
});

test("reenvio exige as mesmas linhas", () => {
  assert.match(sql, /'outcome' = 'replayed'/);
  assert.match(sql, /v_saved IS DISTINCT FROM v_sorted/);
  assert.match(sql, /ZION_ADMIN_META_ATOMIC_OPERATION_REUSED/);
});

test("conserva a identidade dos documentos individuais", () => {
  assert.match(sql, /document_upload_id/);
  assert.match(sql, /document_sha256/);
  assert.match(sql, /review_fingerprint_sha256/);
  assert.match(sql, /financial_account_id/);
});

test("nao concede acesso ao registro financeiro", () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION/);
  assert.match(sql, /ZION_ADMIN_META_ATOMIC_UNAUTHORIZED/);

  assert.doesNotMatch(
    sql,
    /^\s*GRANT\s+EXECUTE\b/im,
  );
});

test("nao cria dados, contas ou cobrancas artificiais", () => {
  assert.doesNotMatch(
    sql,
    /^\s*INSERT INTO public\.zion_admin_financial_evidence_uploads/im,
  );
  assert.doesNotMatch(
    sql,
    /^\s*INSERT INTO public\.zion_admin_meta_financial_binding_events/im,
  );
});

test("migration transacional", () => {
  assert.match(sql.trimStart(), /^BEGIN;/);
  assert.match(sql.trimEnd(), /COMMIT;$/);
});