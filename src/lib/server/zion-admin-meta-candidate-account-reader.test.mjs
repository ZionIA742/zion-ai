import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";

const path =
  "src/lib/server/zion-admin-meta-candidate-account-reader.ts";

const source = readFileSync(path, "utf8");

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const loadedModule = { exports: {} };

vm.runInNewContext(compiled, {
  module: loadedModule,
  exports: loadedModule.exports,
  require(name) {
    throw new Error(`Unexpected import: ${name}`);
  },
});

const { readMetaCandidateAccounts: read } =
  loadedModule.exports;

function integration(id, waba) {
  return {
    id,
    whatsapp_business_account_id: waba,
  };
}

function binding(id, waba, account) {
  return {
    integration_id: id,
    whatsapp_business_account_id: waba,
    event_type: "bound",
    financial_account_type: "messaging_account",
    financial_account_id: account,
    authority_status: "candidate_only",
  };
}

function database(integrations, bindings, failTable = null) {
  const calls = [];

  return {
    calls,
    from(table) {
      assert.ok(
        table === "external_integrations" ||
        table === "zion_admin_meta_financial_binding_events",
      );

      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        not() {
          throw new Error(
            "Active integrations must not exclude null WABAs",
          );
        },
        order() {
          return query;
        },
        async range(start, end) {
          calls.push({ table, start, end });

          if (table === failTable) {
            return {
              data: null,
              error: { message: "Simulated DB error" },
            };
          }

          const data = table === "external_integrations"
            ? integrations
            : bindings;

          return {
            data: data.slice(start, end + 1),
            error: null,
          };
        },
      };

      return query;
    },
  };
}

test("bloqueia integracao ativa sem WABA", async () => {
  const db = database(
    [
      integration("integration-1", "123456789"),
      integration("integration-2", null),
    ],
    [
      binding("integration-1", "123456789", "ACCOUNT_1"),
    ],
  );

  const result = await read(db);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "CENSUS_INCOMPLETE");
});

test("bloqueia integracao sem vinculo financeiro", async () => {
  const db = database(
    [
      integration("integration-1", "123456789"),
      integration("integration-2", "987654321"),
    ],
    [
      binding("integration-1", "123456789", "ACCOUNT_1"),
    ],
  );

  const result = await read(db);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "CENSUS_INCOMPLETE");
});

test("aceita duas WABAs com a mesma conta candidata", async () => {
  const db = database(
    [
      integration("integration-1", "123456789"),
      integration("integration-2", "987654321"),
    ],
    [
      binding("integration-1", "123456789", "ACCOUNT_1"),
      binding("integration-2", "987654321", "ACCOUNT_1"),
    ],
  );

  const result = await read(db);

  assert.equal(result.ok, true);
  assert.equal(result.status, "candidate_only");
  assert.equal(result.scope, "current_active_integrations");
  assert.equal(result.accounts.length, 1);
  assert.equal(
    result.accounts[0].financialAccountId,
    "ACCOUNT_1",
  );
});

test("bloqueia WABA divergente do ultimo vinculo", async () => {
  const db = database(
    [integration("integration-1", "123456789")],
    [binding("integration-1", "987654321", "ACCOUNT_1")],
  );

  const result = await read(db);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "CENSUS_INCOMPLETE");
});

test("falha de consulta nao vira cobertura completa", async () => {
  const db = database(
    [integration("integration-1", "123456789")],
    [binding("integration-1", "123456789", "ACCOUNT_1")],
    "external_integrations",
  );

  const result = await read(db);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "CENSUS_UNAVAILABLE");
});

test("pagina integralmente as integracoes e os eventos", async () => {
  const integrations = [];
  const bindings = [];

  for (let index = 0; index < 251; index++) {
    const id = `integration-${index}`;
    const waba = String(100000000 + index);

    integrations.push(integration(id, waba));
    bindings.push(binding(id, waba, "ACCOUNT_SHARED"));
  }

  const db = database(integrations, bindings);
  const result = await read(db);

  assert.equal(result.ok, true);
  assert.equal(result.accounts.length, 1);

  const integrationPages = db.calls.filter(
    (call) => call.table === "external_integrations",
  );

  const bindingPages = db.calls.filter(
    (call) =>
      call.table ===
      "zion_admin_meta_financial_binding_events",
  );

  assert.equal(integrationPages.length, 2);
  assert.equal(bindingPages.length, 2);
});

test("nao trata contas candidatas como comprovadas", async () => {
  const db = database(
    [integration("integration-1", "123456789")],
    [binding("integration-1", "123456789", "ACCOUNT_1")],
  );

  const result = await read(db);

  assert.equal(result.ok, true);
  assert.equal(result.status, "candidate_only");
  assert.notEqual(result.status, "verified");
});