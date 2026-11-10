import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  "supabase/migrations/20261110120000_zion_admin_meta_billing_account_lines.sql",
  "utf8",
);

test("uma linha identifica conta e documento", () => {
  assert.match(sql, /financial_account_type text NOT NULL/);
  assert.match(sql, /financial_account_id text NOT NULL/);
  assert.match(sql, /document_upload_id bigint NOT NULL/);
  assert.match(sql, /document_reference text NOT NULL/);
  assert.match(sql, /CONSTRAINT zamabl_document_unique/);
});

test("nao duplica documentos da mesma conta", () => {
  assert.match(
    sql,
    /UNIQUE \(\s*month,\s*preclosure_revision,\s*financial_account_type,\s*financial_account_id,\s*document_reference\s*\)/,
  );
});

test("linhas pertencem a mesma revisao e documento Meta", () => {
  assert.match(sql, /v_evidence\.month IS DISTINCT FROM NEW\.month/);
  assert.match(sql, /v_upload\.month IS DISTINCT FROM NEW\.month/);
  assert.match(sql, /v_upload\.source IS DISTINCT FROM 'meta_invoice'/);
  assert.match(
    sql,
    /v_evidence\.meta_review_fingerprint_sha256 IS DISTINCT FROM/,
  );
});

test("total mensal confere a soma das linhas no commit", () => {
  assert.match(
    sql,
    /COALESCE\(SUM\(amount_brl_cents\), 0\)/,
  );
  assert.match(sql, /ZION_ADMIN_META_TOTAL_AMOUNT_MISMATCH/);
  assert.match(sql, /ZION_ADMIN_META_TOTAL_LINES_MISSING/);
  assert.match(sql, /ZION_ADMIN_META_TOTAL_STATUS_MISMATCH/);
  assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/g);
  assert.match(sql, /zamfe_meta_lines_complete/);
  assert.match(sql, /zamabl_meta_total_consistent/);
});

test("custo nao aplicavel exige valor zero", () => {
  assert.match(sql, /CONSTRAINT zamabl_not_applicable_zero/);
  assert.match(sql, /OR amount_brl_cents = 0/);
});

test("sem permissoes de escrita na aplicacao", () => {
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE/);
  assert.match(sql, /GRANT SELECT ON TABLE/);
  assert.doesNotMatch(
    sql,
    /^\s*GRANT\s+(INSERT|UPDATE|DELETE|EXECUTE)\b/im,
  );
});

test("linhas nao podem ser editadas ou excluidas", () => {
  assert.match(sql, /BEFORE UPDATE OR DELETE/);
  assert.match(sql, /ZION_ADMIN_META_BILLING_LINE_IMMUTABLE/);
});

test("migration transacional", () => {
  assert.match(sql.trimStart(), /^BEGIN;/);
  assert.match(sql.trimEnd(), /COMMIT;$/);
});