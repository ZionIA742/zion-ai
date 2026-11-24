"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sql = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../../supabase/migrations",
    "20261124001500_zion_human_quote_draft_edit_atomic.sql",
  ),
  "utf8",
).toLowerCase();

test("migration possui transacao completa", () => {
  assert.match(sql, /^\s*begin;/);
  assert.match(sql, /commit;\s*$/);
});

test("autoridade exige credencial privilegiada", () => {
  assert.match(sql, /v_request_role is distinct from 'service_role'/);
  assert.match(sql, /session_user <> 'postgres'/);
  assert.match(sql, /from public, anon, authenticated;/);
  assert.match(sql, /to service_role;/);
});

test("autoridade protege search_path e escopo", () => {
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = pg_catalog, pg_temp/);
  assert.match(sql, /set row_security = off/);
});

test("bloqueia linha com isolamento entre lojas", () => {
  assert.match(
    sql,
    /where q\.id = p_quote_id\s+and q\.organization_id = p_organization_id\s+and q\.store_id = p_store_id\s+for update;/,
  );
});

test("exige procedencia humana persistida", () => {
  assert.match(sql, /v_quote\.metadata ->> 'created_via'/);
  assert.match(sql, /v_quote\.metadata ->> 'creation_actor_kind'/);
  assert.match(sql, /v_quote\.metadata ->> 'creation_actor_user_id'/);
  assert.match(sql, /zion_human_quote_edit_provenance_required/);
});

test("verifica concorrencia depois do bloqueio", () => {
  const lock = sql.indexOf("for update;");
  const stale = sql.indexOf(
    "v_quote.updated_at",
    lock,
  );

  assert.ok(lock >= 0);
  assert.ok(stale > lock);

  assert.match(
    sql,
    /v_quote\.updated_at\s+is distinct from p_expected_updated_at/,
  );

  assert.match(
    sql,
    /v_quote\.current_version_id\s+is distinct from p_expected_current_version_id/,
  );

  assert.match(sql, /zion_human_quote_edit_stale/);
});

test("restringe autoridade a rascunhos sem versoes", () => {
  assert.match(sql, /v_quote\.status is distinct from 'draft'/);
  assert.match(sql, /v_quote\.current_version_id is not null/);
  assert.match(sql, /from public\.sales_quote_versions sv/);
  assert.match(sql, /zion_human_quote_edit_versioned_flow_required/);
});

test("preserva metadata original", () => {
  assert.match(
    sql,
    /v_metadata := v_quote\.metadata \|\| jsonb_build_object/,
  );

  assert.match(sql, /'payment_terms', p_payment_terms/);
  assert.match(sql, /'delivery_terms', p_delivery_terms/);
  assert.match(sql, /'warranty_terms', p_warranty_terms/);
  assert.match(sql, /'validity_days', p_validity_days/);
  assert.match(sql, /'valid_until', p_valid_until/);
});

test("reutiliza writer financeiro preservando status", () => {
  assert.match(
    sql,
    /public\.apply_sales_quote_change_money_and_items_by_system\(/,
  );

  assert.match(sql, /p_title,\s+v_quote\.status,/);
  assert.match(sql, /zion_human_quote_edit_writer_result_invalid/);
});

test("preserva referencias de fotos dos itens mantidos", () => {
  assert.match(sql, /into v_item_photos/);
  assert.match(sql, /jsonb_to_recordset\(v_item_photos\)/);
  assert.match(sql, /where i\.id = photo\.id/);

  for (const field of [
    "source_photo_storage_bucket",
    "source_photo_storage_path",
    "source_photo_public_url",
  ]) {
    assert.ok(sql.includes(`'${field}', i.${field}`));
    assert.ok(sql.includes(`${field} = photo.${field}`));
  }
});

test("timestamp humano avanca monotonicamente", () => {
  assert.match(sql, /zz_zion_human_quote_monotonic_updated_at/);
  assert.match(sql, /pg_catalog\.clock_timestamp\(\)/);
  assert.match(sql, /old\.updated_at \+ interval '1 microsecond'/);
  assert.match(sql, /v_updated_at <= v_quote\.updated_at/);
});

test("nao realiza escritas comerciais diretas", () => {
  assert.doesNotMatch(
    sql,
    /\b(?:update|delete\s+from|insert\s+into)\s+public\.(?:commercial_opportunities|conversations|sales_quote_versions|sales_quote_change_requests)\b/,
  );
});
