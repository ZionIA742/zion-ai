import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSalesAiBehaviorContract,
  buildSalesAiBehaviorContractPromptBlock,
  findSalesAiBehaviorContractOutputViolation,
} from "./sales-ai-behavior-contract";

const payment = {
  organization_id: "org", store_id: "store", accepted_payment_methods: ["pix", "cartao_credito"],
  pix_key_type: "email", pix_key: "a@b.com", pix_holder_name: "Store", down_payment_mode: "required",
  down_payment_value_type: "percent", down_payment_percent: 10, down_payment_amount_cents: null,
  installments_enabled: true, max_installments: 12, installment_interest_policy: "interest_free", payment_notes: null,
};
const discount = { organization_id: "org", store_id: "store", default_discount_percent: 5, max_discount_percent: 10, allow_ask_above_max_discount: false, discount_autonomy_mode: "within_policy_autonomous", discount_special_rules: null };

test("counterparts intersect operational payment settings and compare concrete limits", () => {
  const contract = buildSalesAiBehaviorContract({
    paymentSettings: payment,
    discountSettings: discount,
    highValueDiscountSettings: null,
    counterpartPolicy: {
      organization_id: "org", store_id: "store", enabled: true, allowed_payment_methods: ["pix", "boleto"],
      higher_down_payment_enabled: true, higher_down_payment_minimum_type: "percent", higher_down_payment_minimum_percent: 30,
      higher_down_payment_minimum_amount_cents: null, fewer_installments_enabled: true, fewer_installments_max_count: 3,
    },
  });
  assert.equal(contract.discount.counterparts.paymentMethods.pix.state, "allowed");
  assert.equal(contract.discount.counterparts.paymentMethods.boleto.state, "forbidden");
  assert.equal(contract.discount.counterparts.higherDownPayment.state, "allowed");
  assert.equal(contract.discount.counterparts.fewerInstallments.state, "allowed");
});

test("counterpart contract does not authorize discount percentage or mutation", () => {
  const contract = buildSalesAiBehaviorContract({ paymentSettings: null, discountSettings: null, highValueDiscountSettings: null });
  assert.equal(contract.discount.counterparts.higherDownPayment.state, "unconfigured");
  assert.equal("applyDiscount" in contract.discount.counterparts, false);
});

test("Pix selected without an operational key is not allowed", () => {
  const contract = buildSalesAiBehaviorContract({
    paymentSettings: { ...payment, pix_key: null, pix_key_type: null },
    discountSettings: discount, highValueDiscountSettings: null,
    counterpartPolicy: { organization_id: "org", store_id: "store", enabled: true, allowed_payment_methods: ["pix"], higher_down_payment_enabled: false, higher_down_payment_minimum_type: null, higher_down_payment_minimum_percent: null, higher_down_payment_minimum_amount_cents: null, fewer_installments_enabled: false, fewer_installments_max_count: null },
  });
  assert.notEqual(contract.discount.counterparts.paymentMethods.pix.state, "allowed");
});

test("incompatible, equal and lower down payments fail closed", () => {
  const base = { paymentSettings: payment, discountSettings: discount, highValueDiscountSettings: null };
  const make = (type: string, percent: number | null, cents: number | null) => buildSalesAiBehaviorContract({ ...base, counterpartPolicy: { organization_id: "org", store_id: "store", enabled: true, allowed_payment_methods: [], higher_down_payment_enabled: true, higher_down_payment_minimum_type: type, higher_down_payment_minimum_percent: percent, higher_down_payment_minimum_amount_cents: cents, fewer_installments_enabled: false, fewer_installments_max_count: null } });
  assert.equal(make("fixed", null, 2000).discount.counterparts.higherDownPayment.state, "forbidden");
  assert.equal(make("percent", 10, null).discount.counterparts.higherDownPayment.state, "forbidden");
  assert.equal(make("percent", 5, null).discount.counterparts.higherDownPayment.state, "forbidden");
});

test("fewer installments requires enabled normal installments and a strictly lower limit", () => {
  const make = (settings: typeof payment, max: number | null) => buildSalesAiBehaviorContract({ paymentSettings: settings, discountSettings: discount, highValueDiscountSettings: null, counterpartPolicy: { organization_id: "org", store_id: "store", enabled: true, allowed_payment_methods: [], higher_down_payment_enabled: false, higher_down_payment_minimum_type: null, higher_down_payment_minimum_percent: null, higher_down_payment_minimum_amount_cents: null, fewer_installments_enabled: true, fewer_installments_max_count: max } });
  assert.equal(make(payment, 3).discount.counterparts.fewerInstallments.state, "allowed");
  assert.equal(make(payment, 12).discount.counterparts.fewerInstallments.state, "forbidden");
  assert.equal(make({ ...payment, installments_enabled: false }, 3).discount.counterparts.fewerInstallments.state, "forbidden");
});

test("counterpart prompt contains no invented economic claim", () => {
  const contract = buildSalesAiBehaviorContract({ paymentSettings: payment, discountSettings: discount, highValueDiscountSettings: null });
  const prompt = buildSalesAiBehaviorContractPromptBlock(contract).toLowerCase();
  for (const forbidden of ["pix é mais barato", "pix não paga taxa", "débito tem menos taxa", "dinheiro merece desconto", "menos parcelas economiza", "entrada maior melhora margem"]) {
    assert.equal(prompt.includes(forbidden), false, forbidden);
  }
});

test("counterpart dimensions stay independent and block fused payment wording", () => {
  const contract = buildSalesAiBehaviorContract({
    paymentSettings: {
      ...payment,
      down_payment_percent: 20,
      max_installments: 7,
    },
    discountSettings: discount,
    highValueDiscountSettings: null,
    counterpartPolicy: {
      organization_id: "org",
      store_id: "store",
      enabled: true,
      allowed_payment_methods: ["pix"],
      higher_down_payment_enabled: true,
      higher_down_payment_minimum_type: "percent",
      higher_down_payment_minimum_percent: 30,
      higher_down_payment_minimum_amount_cents: null,
      fewer_installments_enabled: true,
      fewer_installments_max_count: 3,
    },
  });
  const prompt = buildSalesAiBehaviorContractPromptBlock(contract).toLowerCase();

  assert.equal(contract.discount.counterparts.paymentMethods.pix.state, "allowed");
  assert.equal(contract.discount.counterparts.higherDownPayment.state, "allowed");
  assert.equal(contract.discount.counterparts.fewerInstallments.state, "allowed");
  assert.match(prompt, /cada contrapartida.*condicao independente/);
  assert.match(prompt, /metodo de pagamento.*nao autoriza.*parcelamento/);
  assert.match(prompt, /menos parcelas.*nao define qual metodo/);
  assert.match(prompt, /mencione-as separadamente/);
  assert.match(prompt, /human_approval_required nao significa que um handoff ou task foi criado/);
  assert.match(prompt, /nao diga que vai encaminhar, que ja encaminhou ou que vai retornar depois/);
  assert.match(prompt, /essa condicao precisa de confirmacao do responsavel/);
  assert.match(prompt, /a melhoria ainda depende de confirmacao/);
  assert.doesNotMatch(prompt, /pix parcelado.*(?:permitido|autorizado|pode)/);
  assert.equal(
    findSalesAiBehaviorContractOutputViolation({
      text: "Com Pix parcelado em até 3x, conseguimos melhorar a condição.",
      contract,
    }),
    "COUNTERPART_DIMENSIONS_FUSED",
  );
  assert.equal(
    findSalesAiBehaviorContractOutputViolation({
      text: "As condições são entrada de 30%, pagamento via Pix e, quando houver parcelamento, redução para até 3x.",
      contract,
    }),
    null,
  );
});
