import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  "supabase/migrations/20261113210000_zion_admin_diagnostic_foundation.sql",
  "utf8",
);

const tables = [
  "zion_admin_diagnostic_incidents",
  "zion_admin_diagnostic_occurrences",
  "zion_admin_diagnostic_history",
];

test("creates all three diagnostic tables", () => {
  for (const table of tables) {
    assert.match(
      sql,
      new RegExp(`CREATE TABLE public\\.${table}\\s*\\(`),
    );
  }
});

test("enables RLS for every table", () => {
  for (const table of tables) {
    assert.match(
      sql,
      new RegExp(
        `ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`,
      ),
    );
  }
});

test("revokes direct access from client and service roles", () => {
  assert.match(
    sql,
    /FROM PUBLIC, anon, authenticated, service_role/i,
  );
  assert.doesNotMatch(sql, /\bGRANT\b/i);
});

test("supports global, organization and store scopes", () => {
  assert.match(sql, /'system', 'organization', 'store'/);
  assert.match(sql, /diagnostic_incident_scope_check/);
});

test("distinguishes confirmed causes from hypotheses", () => {
  assert.match(sql, /'unknown', 'hypothesis', 'confirmed'/);
});

test("protects both child links to the original incident", () => {
  const references = sql.match(
    /incident_id uuid NOT NULL\s+REFERENCES public\.zion_admin_diagnostic_incidents\(id\)\s+ON DELETE RESTRICT/g,
  ) ?? [];

  assert.equal(references.length, 2);
});

test("keeps technical evidence in sanitized fields", () => {
  assert.match(sql, /sanitized_error_message/);
  assert.match(sql, /sanitized_stack_trace/);
  assert.match(sql, /sanitized_evidence/);
  assert.match(sql, /sanitized_details/);
});

test("migration is transactional", () => {
  assert.match(sql, /^\s*BEGIN;/m);
  assert.match(sql, /COMMIT;\s*$/);
});

test("requires an existing organization", () => {
  assert.match(
    sql,
    /organization_id uuid\s+REFERENCES public\.organizations\(id\)/,
  );
});

test("requires the store to belong to the organization", () => {
  assert.match(
    sql,
    /FOREIGN KEY \(store_id, organization_id\)\s+REFERENCES public\.stores \(id, organization_id\)/,
  );
});

test("uses the existing composite index without duplicating it", () => {
  assert.match(sql, /stores_id_organization_uidx/);

  assert.doesNotMatch(
    sql,
    /CREATE\s+(?:UNIQUE\s+)?INDEX\b[^;]*\bON\s+public\.stores\s*\(/i,
  );

  assert.match(
    sql,
    /FOREIGN KEY \(store_id, organization_id\)\s+REFERENCES public\.stores \(id, organization_id\)/,
  );
});

test("restricts deletion of referenced stores and organizations", () => {
  assert.match(
    sql,
    /REFERENCES public\.organizations\(id\)\s+ON UPDATE RESTRICT\s+ON DELETE RESTRICT/,
  );
  assert.match(
    sql,
    /REFERENCES public\.stores \(id, organization_id\)\s+ON UPDATE RESTRICT\s+ON DELETE RESTRICT/,
  );
});
