import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeStoreDiscountCounterpartPolicyInput,
  createDefaultStoreDiscountCounterpartPolicyInput,
  validateHigherDownPaymentAgainstPaymentSettings,
} from "./store-discount-counterpart-policy";

function policy(type: "percent" | "fixed", value: string) {
  const result = normalizeStoreDiscountCounterpartPolicyInput({
    ...createDefaultStoreDiscountCounterpartPolicyInput(),
    enabled: true,
    higherDownPaymentEnabled: true,
    higherDownPaymentMinimumType: type,
    higherDownPaymentMinimumPercent: type === "percent" ? value : "",
    higherDownPaymentMinimumAmount: type === "fixed" ? value : "",
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unexpected invalid counterpart policy fixture");
  return result.value;
}

test("counterpart policy defaults disabled and fail closed on invalid values", () => {
  const empty = normalizeStoreDiscountCounterpartPolicyInput(createDefaultStoreDiscountCounterpartPolicyInput());
  assert.equal(empty.ok, true);
  if (empty.ok) assert.equal(empty.value.enabled, false);
  const invalid = normalizeStoreDiscountCounterpartPolicyInput({
    ...createDefaultStoreDiscountCounterpartPolicyInput(),
    enabled: true,
    allowedPaymentMethods: ["parcelado"],
  });
  assert.equal(invalid.ok, false);
});

test("counterpart policy normalizes percent, fixed and fewer installments", () => {
  const result = normalizeStoreDiscountCounterpartPolicyInput({
    enabled: true,
    allowedPaymentMethods: ["pix", "pix", "cartao_credito"],
    higherDownPaymentEnabled: true,
    higherDownPaymentMinimumType: "percent",
    higherDownPaymentMinimumPercent: "30",
    higherDownPaymentMinimumAmount: "",
    fewerInstallmentsEnabled: true,
    fewerInstallmentsMaxCount: "3",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.allowedPaymentMethods, ["pix", "cartao_credito"]);
    assert.equal(result.value.higherDownPaymentMinimumPercent, 30);
    assert.equal(result.value.fewerInstallmentsMaxCount, 3);
  }
});

test("counterpart policy accepts fixed values with cents and rejects missing details", () => {
  const fixed = normalizeStoreDiscountCounterpartPolicyInput({
    ...createDefaultStoreDiscountCounterpartPolicyInput(), enabled: true,
    higherDownPaymentEnabled: true, higherDownPaymentMinimumType: "fixed",
    higherDownPaymentMinimumPercent: "", higherDownPaymentMinimumAmount: "100,50",
  });
  assert.equal(fixed.ok, true);
  if (fixed.ok) assert.equal(fixed.value.higherDownPaymentMinimumAmountCents, 10050);
  const missing = normalizeStoreDiscountCounterpartPolicyInput({
    ...createDefaultStoreDiscountCounterpartPolicyInput(), enabled: true,
    higherDownPaymentEnabled: true, higherDownPaymentMinimumType: "percent",
  });
  assert.equal(missing.ok, false);
});

test("disabled policy clears every child authority", () => {
  const result = normalizeStoreDiscountCounterpartPolicyInput({
    enabled: false, allowedPaymentMethods: ["pix"], higherDownPaymentEnabled: true,
    higherDownPaymentMinimumType: "percent", higherDownPaymentMinimumPercent: "30",
    higherDownPaymentMinimumAmount: "", fewerInstallmentsEnabled: true, fewerInstallmentsMaxCount: "3",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.allowedPaymentMethods, []);
    assert.equal(result.value.higherDownPaymentEnabled, false);
    assert.equal(result.value.fewerInstallmentsEnabled, false);
  }
});

test("higher entry requires a strictly greater percentage than the store baseline", () => {
  const baseline = { down_payment_mode: "required", down_payment_value_type: "percent", down_payment_percent: 20, down_payment_amount_cents: null };
  for (const value of ["5", "20"]) {
    assert.equal(validateHigherDownPaymentAgainstPaymentSettings({ policy: policy("percent", value), paymentSettings: baseline }).ok, false);
  }
  assert.equal(validateHigherDownPaymentAgainstPaymentSettings({ policy: policy("percent", "30"), paymentSettings: baseline }).ok, true);
  assert.equal(validateHigherDownPaymentAgainstPaymentSettings({ policy: policy("fixed", "300"), paymentSettings: baseline }).ok, false);
  assert.equal(validateHigherDownPaymentAgainstPaymentSettings({ policy: policy("percent", "30"), paymentSettings: null }).ok, false);
});

test("higher entry requires a strictly greater fixed amount than the store baseline", () => {
  const baseline = { down_payment_mode: "optional", down_payment_value_type: "fixed", down_payment_percent: null, down_payment_amount_cents: 10000 };
  assert.equal(validateHigherDownPaymentAgainstPaymentSettings({ policy: policy("fixed", "50"), paymentSettings: baseline }).ok, false);
  assert.equal(validateHigherDownPaymentAgainstPaymentSettings({ policy: policy("fixed", "100"), paymentSettings: baseline }).ok, false);
  assert.equal(validateHigherDownPaymentAgainstPaymentSettings({ policy: policy("fixed", "150"), paymentSettings: baseline }).ok, true);
  assert.equal(validateHigherDownPaymentAgainstPaymentSettings({ policy: policy("percent", "30"), paymentSettings: baseline }).ok, false);
});

test("no normal entry accepts either positive counterpart type, while case by case fails closed", () => {
  const none = { down_payment_mode: "none", down_payment_value_type: null, down_payment_percent: null, down_payment_amount_cents: null };
  assert.equal(validateHigherDownPaymentAgainstPaymentSettings({ policy: policy("percent", "5"), paymentSettings: none }).ok, true);
  assert.equal(validateHigherDownPaymentAgainstPaymentSettings({ policy: policy("fixed", "50"), paymentSettings: none }).ok, true);
  const caseByCase = { down_payment_mode: "required", down_payment_value_type: "case_by_case", down_payment_percent: null, down_payment_amount_cents: null };
  assert.equal(validateHigherDownPaymentAgainstPaymentSettings({ policy: policy("percent", "30"), paymentSettings: caseByCase }).ok, false);
});
