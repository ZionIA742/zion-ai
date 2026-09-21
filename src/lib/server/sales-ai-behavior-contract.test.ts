import assert from "node:assert/strict";

import {
  buildSalesAiBehaviorContract,
} from "./sales-ai-behavior-contract";

const basePayment = {
  organization_id: "org-1",
  store_id: "store-1",
  accepted_payment_methods: ["pix", "cartao_credito"],
  pix_key_type: null,
  pix_key: null,
  pix_holder_name: null,
  down_payment_mode: "none",
  down_payment_value_type: null,
  down_payment_percent: null,
  down_payment_amount_cents: null,
  installments_enabled: false,
  max_installments: null,
  installment_interest_policy: null,
  payment_notes: null,
};

const baseDiscount = {
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
    paymentSettings: null,
    discountSettings: null,
    highValueDiscountSettings: null,
  });

  assert.equal(contract.payment.pix.state, "unconfigured");
  assert.equal(contract.payment.installments.state, "unconfigured");
  assert.equal(contract.payment.downPayment.state, "unconfigured");

  assert.equal(contract.discount.defaultStep.state, "unconfigured");
  assert.equal(contract.discount.withinPolicy.state, "unconfigured");
  assert.equal(contract.discount.aboveMax.state, "unconfigured");
}

{
  const contract = buildSalesAiBehaviorContract({
    paymentSettings: basePayment,
    discountSettings: null,
    highValueDiscountSettings: null,
  });

  assert.equal(contract.payment.pix.state, "allowed");
  assert.equal(contract.payment.pixKeyDisclosure.state, "unconfigured");

  // false é false: parcelamento está explicitamente indisponível.
  assert.equal(contract.payment.installments.state, "forbidden");

  // "none" significa ausência de regra de entrada, não autorização.
  assert.equal(contract.payment.downPayment.state, "unconfigured");

  // Método fora da lista canônica não pode virar "precisa confirmar".
  assert.equal(
    contract.payment.methods.financiamento.state,
    "forbidden",
  );
}

{
  const contract = buildSalesAiBehaviorContract({
    paymentSettings: null,
    discountSettings: baseDiscount,
    highValueDiscountSettings: {
      organization_id: "org-1",
      store_id: "store-1",
      enabled: false,
      threshold_amount_cents: null,
      discount_percent: null,
    },
  });

  // approval_required não autoriza nem mesmo o primeiro degrau sozinho.
  assert.equal(
    contract.discount.defaultStep.state,
    "human_approval_required",
  );
  assert.equal(
    contract.discount.withinPolicy.state,
    "human_approval_required",
  );

  // acima do teto pode consultar humano porque a configuração permite.
  assert.equal(
    contract.discount.aboveMax.state,
    "human_approval_required",
  );

  // false é false também na política de alto valor.
  assert.equal(contract.discount.highValue.state, "forbidden");
}

{
  const contract = buildSalesAiBehaviorContract({
    paymentSettings: null,
    discountSettings: {
      ...baseDiscount,
      discount_autonomy_mode: "within_policy_autonomous",
      allow_ask_above_max_discount: false,
    },
    highValueDiscountSettings: null,
  });

  assert.equal(contract.discount.defaultStep.state, "allowed");
  assert.equal(contract.discount.withinPolicy.state, "allowed");

  // sem autorização para consultar acima do teto, a IA deve negar.
  assert.equal(contract.discount.aboveMax.state, "forbidden");
}

console.log("sales AI behavior contract: 4 tests passed");