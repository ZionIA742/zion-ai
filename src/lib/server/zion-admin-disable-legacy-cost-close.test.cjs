const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const sql = readFileSync(
  join(process.cwd(),
    "supabase/migrations/20261109143000_zion_admin_disable_legacy_cost_close.sql"),
  "utf8",
);

const route = readFileSync(
  join(process.cwd(), "src/app/api/zion-admin/costs/route.ts"),
  "utf8",
);

test("funcao legada e substituida por bloqueio permanente", () => {
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.zion_admin_close_cost_month/,
  );
  assert.match(
    sql,
    /RAISE EXCEPTION\s+'ZION_ADMIN_LEGACY_COST_CLOSE_DISABLED'/,
  );
});

test("service_role e demais papeis perdem a permissao", () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION/);
  assert.match(
    sql,
    /FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.doesNotMatch(sql, /GRANT EXECUTE/);
});

test("migration nao modifica fechamentos historicos", () => {
  assert.doesNotMatch(
    sql,
    /\b(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\s+public\.zion_admin_monthly_closures/i,
  );
  assert.doesNotMatch(
    sql,
    /\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.zion_admin_monthly_final_closures/i,
  );
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
});

test("API bloqueia fechamento antes de chamar o RPC legado", () => {
  const guard = route.indexOf('if (action === "close") {');
  const rpc = route.indexOf(
    'db.rpc("zion_admin_close_cost_month"',
  );

  assert.ok(guard >= 0);
  assert.ok(rpc > guard);
  assert.match(
    route.slice(guard, guard + 400),
    /LEGACY_COST_CLOSE_DISABLED/,
  );
  assert.match(
    route.slice(guard, guard + 400),
    /409/,
  );
});

test("pre-fechamento e outros writers nao sao alterados", () => {
  assert.doesNotMatch(
    sql,
    /CREATE OR REPLACE FUNCTION public\.zion_admin_register_monthly_preclosure/i,
  );
  assert.doesNotMatch(
    sql,
    /CREATE OR REPLACE FUNCTION public\.zion_admin_set_manual_monthly_revenue/i,
  );
});