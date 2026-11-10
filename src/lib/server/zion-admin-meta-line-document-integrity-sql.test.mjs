import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  "supabase/migrations/20261110131000_zion_admin_meta_line_document_integrity.sql",
  "utf8",
);

test("exige hash individual de cada documento", () => {
  assert.match(
    sql,
    /ADD COLUMN document_sha256 text NOT NULL/,
  );

  assert.match(
    sql,
    /document_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/,
  );
});

test("hash deve corresponder ao upload registrado", () => {
  assert.match(
    sql,
    /v_upload\.document_sha256 IS DISTINCT FROM\s+NEW\.document_sha256/,
  );

  assert.match(
    sql,
    /v_upload\.source IS DISTINCT FROM 'meta_invoice'/,
  );

  assert.match(
    sql,
    /v_upload\.preclosure_revision IS DISTINCT FROM/,
  );
});

test("permite fingerprints distintos por documento", () => {
  assert.doesNotMatch(
    sql,
    /v_evidence\.meta_review_fingerprint_sha256\s+IS DISTINCT FROM/,
  );

  assert.match(
    sql,
    /v_evidence\.verified_by_user_id IS DISTINCT FROM/,
  );
});

test("falha se ja houver documentos registrados", () => {
  assert.match(
    sql,
    /ZION_ADMIN_META_LINE_EXISTING_ROWS_REQUIRE_AUDIT/,
  );
});

test("nao libera operacoes financeiras", () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION/);

  assert.doesNotMatch(
    sql,
    /^\s*GRANT\s+EXECUTE\b/im,
  );

  assert.doesNotMatch(
    sql,
    /\bINSERT INTO public\.zion_admin_monthly_final_evidence\b/,
  );
});

test("migration transacional", () => {
  assert.match(sql.trimStart(), /^BEGIN;/);
  assert.match(sql.trimEnd(), /COMMIT;$/);
});