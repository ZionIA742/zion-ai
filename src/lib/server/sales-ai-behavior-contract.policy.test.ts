import assert from "node:assert/strict";

import {
  buildSalesAiBehaviorContract,
  buildSalesAiBehaviorContractPromptBlock,
} from "./sales-ai-behavior-contract";

const paymentBase = {
  organization_id: "org-1",
  store_id: "store-1",
  accepted_payment_methods: ["pix", "cartao_credito"],
  pix_key_type: "cnpj",
  pix_key: "12345678000199",
  pix_holder_name: "Loja Teste",
  down_payment_mode: "required",
  down_payment_value_type: "case_by_case",
  down_payment_percent: null,
  down_payment_amount_cents: null,
  installments_enabled: true,
  max_installments: 10,
  installment_interest_policy: "case_by_case",
  payment_notes: null,
};

const discountBase = {
  organization_id: "org-1",
  store_id: "store-1",
  default_discount_percent: 15,
  max_discount_percent: 28,
  allow_ask_above_max_discount: true,
  discount_autonomy_mode: "approval_required",
  discount_special_rules: null,
};

{
  const contract = buildSalesAiBehaviorContract({
    paymentSettings: paymentBase,
    discountSettings: null,
    highValueDiscountSettings: null,
  });

  assert.equal(contract.payment.installments.state, "allowed");
  assert.equal(
    contract.payment.installmentInterest.state,
    "human_approval_required",
  );
  assert.equal(contract.payment.downPayment.state, "allowed");
}

{
  const contract = buildSalesAiBehaviorContract({
    paymentSettings: {
      ...paymentBase,
      installment_interest_policy: "interest_free",
    },
    discountSettings: null,
    highValueDiscountSettings: null,
  });

  assert.equal(contract.payment.installmentInterest.state, "allowed");
}

{
  const contract = buildSalesAiBehaviorContract({
    paymentSettings: null,
    discountSettings: discountBase,
    highValueDiscountSettings: {
      organization_id: "org-1",
      store_id: "store-1",
      enabled: true,
      threshold_amount_cents: 5000000,
      discount_percent: 20,
    },
  });

  assert.equal(
    contract.discount.highValue.state,
    "human_approval_required",
  );
}

{
  const contract = buildSalesAiBehaviorContract({
    paymentSettings: null,
    discountSettings: {
      ...discountBase,
      max_discount_percent: null,
    },
    highValueDiscountSettings: null,
  });

  assert.equal(contract.discount.defaultStep.state, "unconfigured");
  assert.equal(contract.discount.withinPolicy.state, "unconfigured");
  assert.equal(contract.discount.aboveMax.state, "unconfigured");
}

{
  const contract = buildSalesAiBehaviorContract({
    paymentSettings: paymentBase,
    discountSettings: discountBase,
    highValueDiscountSettings: {
      organization_id: "org-1",
      store_id: "store-1",
      enabled: true,
      threshold_amount_cents: 5000000,
      discount_percent: 20,
    },
  });

  const block = buildSalesAiBehaviorContractPromptBlock(contract);

  assert.match(block, /payment\.pix: allowed/);
  assert.match(block, /payment\.installment_interest: human_approval_required/);
  assert.match(block, /discount\.default_step: human_approval_required/);
  assert.match(block, /discount\.high_value: human_approval_required/);
  assert.match(block, /false e proibicao real/);
  assert.match(block, /none representa ausencia de regra configurada/);
  assert.match(block, /12345678000199/);
}

console.log("sales AI behavior contract policy: 5 tests passed");