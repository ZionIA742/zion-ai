import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateMonthlyFinalCloseTotalsCandidate as calculate,
  FINAL_CLOSE_REQUIRED_EXPENSE_SOURCES as required,
} from "./zion-admin-monthly-final-close-totals.ts";

const expense = (source, amountBrlCents) => ({
  source,
  amountBrlCents,
});

const fixture = () => ({
  revenueBrlCents: 50000,
  expenses: [
    expense("fixed_costs", 10000),
    expense("manual_expenses", 2500),
    expense("openai_invoice", 350),
    expense("meta_invoice", 0),
  ],
});

test("uses the four mandatory financial sources", () => {
  assert.deepEqual([...required], [
    "fixed_costs",
    "manual_expenses",
    "openai_invoice",
    "meta_invoice",
  ]);
});

test("calculates revenue, expenses and result in cents", () => {
  const result = calculate(fixture());

  assert.equal(result.revenueBrlCents, 50000);
  assert.equal(result.expensesBrlCents, 12850);
  assert.equal(result.resultBrlCents, 37150);
});

test("accepts an explicitly reported zero", () => {
  const input = fixture();
  input.revenueBrlCents = 0;
  input.expenses = required.map((name) => expense(name, 0));

  assert.equal(calculate(input).resultBrlCents, 0);
});

test("preserves losses as negative amounts", () => {
  const input = fixture();
  input.revenueBrlCents = 0;

  assert.equal(calculate(input).resultBrlCents, -12850);
});

test("rejects a missing source instead of assuming zero", () => {
  const input = fixture();
  input.expenses.pop();

  assert.throws(
    () => calculate(input),
    /FINAL_TOTALS_MISSING_SOURCE/,
  );
});

test("rejects an unknown Meta amount", () => {
  const input = fixture();
  input.expenses[3].amountBrlCents = null;

  assert.throws(
    () => calculate(input),
    /FINAL_TOTALS_INVALID_CENTS/,
  );
});

test("rejects an unreported revenue amount", () => {
  assert.throws(
    () => calculate({
      ...fixture(),
      revenueBrlCents: null,
    }),
    /FINAL_TOTALS_INVALID_CENTS/,
  );
});

test("rejects duplicate sources", () => {
  const input = fixture();
  input.expenses.push(expense("fixed_costs", 1));

  assert.throws(
    () => calculate(input),
    /FINAL_TOTALS_DUPLICATE_SOURCE/,
  );
});

test("rejects unexpected sources", () => {
  const input = fixture();
  input.expenses.push(expense("extra_source", 1));

  assert.throws(
    () => calculate(input),
    /FINAL_TOTALS_UNEXPECTED_SOURCE/,
  );
});

test("rejects invalid financial precision", () => {
  for (const amount of [
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(
      () => calculate({
        ...fixture(),
        revenueBrlCents: amount,
      }),
      /FINAL_TOTALS_INVALID_CENTS/,
    );
  }
});

test("rejects integer overflow", () => {
  const input = fixture();

  input.expenses[0].amountBrlCents =
    Number.MAX_SAFE_INTEGER;

  assert.throws(
    () => calculate(input),
    /FINAL_TOTALS_OVERFLOW/,
  );
});

test("keeps inputs unchanged and returns frozen output", () => {
  const input = fixture();
  const original = structuredClone(input);

  const result = calculate(input);

  assert.deepEqual(input, original);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.breakdown));
  assert.ok(result.breakdown.every(Object.isFrozen));
});
