import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isUuid,
  mapVariableExpenseRpcError,
  parseDate,
  parseMinorAmount,
} from "./route";

const source = readFileSync("src/app/api/zion-admin/costs/route.ts", "utf8");

test("manual variable expense amounts preserve cents and reject imprecise values", () => {
  assert.equal(parseMinorAmount("10.50"), 1050);
  assert.equal(parseMinorAmount("0.01"), 1);
  assert.equal(parseMinorAmount(1050), 1050);
  assert.equal(parseMinorAmount("1000000000.00"), 100000000000);
  assert.equal(parseMinorAmount("1000000000.01"), null);
  assert.equal(parseMinorAmount("0"), null);
  assert.equal(parseMinorAmount("10.555"), null);
  assert.equal(parseMinorAmount("   "), null);
  assert.equal(parseMinorAmount("-1"), null);
  assert.equal(parseMinorAmount("Infinity"), null);
});

test("variable expense dates and administrative actor identity are validated", () => {
  assert.equal(parseDate("2026-10-23"), "2026-10-23");
  assert.equal(parseDate("2026-02-29"), null);
  assert.equal(parseDate("2026-04-31"), null);
  assert.equal(parseDate("2026-2-3"), null);
  assert.equal(parseDate("not-a-date"), null);
  assert.equal(isUuid("00000000-0000-4000-8000-000000000001"), true);
  assert.equal(isUuid("not-a-uuid"), false);
  assert.match(source, /p_actor_id: access\.sessionUserId/);
  assert.match(source, /!isUuid\(access\.sessionUserId\)/);
  assert.match(source, /Identidade administrativa inválida/);
});

test("variable expense RPC operations map to the installed contract", () => {
  for (const action of ["add_variable", "edit_variable", "cancel_variable"]) {
    assert.equal(source.includes(action), true);
  }
  assert.match(source, /zion_admin_mutate_variable_expense/);
  assert.match(source, /p_action: variableAction === "add_variable" \? "created"/);
  assert.match(source, /p_expected_updated_at: expectedUpdatedAt/);
  assert.match(source, /p_operation_key: operationKey/);
});

test("RPC failures remain non-success responses with safe categories", () => {
  assert.deepEqual(mapVariableExpenseRpcError("VARIABLE_EXPENSE_MONTH_ALREADY_CLOSED"), [409, "A competência financeira já está fechada."]);
  assert.deepEqual(mapVariableExpenseRpcError("VARIABLE_EXPENSE_STALE_VERSION"), [409, "O lançamento foi alterado; recarregue os dados e tente novamente."]);
  assert.deepEqual(mapVariableExpenseRpcError("VARIABLE_EXPENSE_NOT_FOUND"), [404, "Despesa variável não encontrada."]);
  assert.deepEqual(mapVariableExpenseRpcError("unexpected database failure"), [503, "Não foi possível confirmar a operação da despesa variável."]);
});

test("GET keeps manual expenses separate and fails their availability closed", () => {
  assert.match(source, /from\("zion_admin_variable_expenses"\)/);
  assert.match(source, /variableExpensesResult\.error \? "unavailable"/);
  assert.match(source, /variableExpenses: variableExpensesResult\.error \? null/);
  assert.match(source, /source: "manual"/);
});
