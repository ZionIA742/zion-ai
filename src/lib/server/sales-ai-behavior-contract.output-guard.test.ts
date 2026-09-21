import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSalesAiBehaviorContract,
  findSalesAiBehaviorContractOutputViolation,
} from "./sales-ai-behavior-contract";

function buildContract(args?: {
  installmentsEnabled?: boolean | null;
  pixAccepted?: boolean;
  pixKey?: string | null;
  pixKeyType?: string | null;
  discountAutonomyMode?: string | null;
}) {
  const pixAccepted = args?.pixAccepted ?? true;

  return buildSalesAiBehaviorContract({
    paymentSettings: {
      organization_id: "org-1",
      store_id: "store-1",
      accepted_payment_methods: pixAccepted
        ? ["pix", "cartao_credito"]
        : ["cartao_credito"],
      pix_key_type: args?.pixKeyType ?? null,
      pix_key: args?.pixKey ?? null,
      pix_holder_name: null,
      down_payment_mode: "none",
      down_payment_value_type: null,
      down_payment_percent: null,
      down_payment_amount_cents: null,
      installments_enabled:
        Object.prototype.hasOwnProperty.call(args ?? {}, "installmentsEnabled")
          ? (args?.installmentsEnabled ?? null)
          : false,
      max_installments: null,
      installment_interest_policy: null,
      payment_notes: null,
    },
    discountSettings: args?.discountAutonomyMode
      ? {
          organization_id: "org-1",
          store_id: "store-1",
          default_discount_percent: 15,
          max_discount_percent: 28,
          allow_ask_above_max_discount: true,
          discount_autonomy_mode: args.discountAutonomyMode,
          discount_special_rules: null,
        }
      : null,
    highValueDiscountSettings: null,
  });
}

test("output guard blocks affirmative installment claim when installments are forbidden", () => {
  const contract = buildContract({
    installmentsEnabled: false,
  });

  assert.equal(
    findSalesAiBehaviorContractOutputViolation({
      text: "Sim, fazemos em até 10x no cartão.",
      contract,
    }),
    "INSTALLMENTS_NOT_ALLOWED_CLAIM",
  );
});

test("output guard allows explicit denial when installments are forbidden", () => {
  const contract = buildContract({
    installmentsEnabled: false,
  });

  assert.equal(
    findSalesAiBehaviorContractOutputViolation({
      text: "Essa condição de parcelamento não está disponível.",
      contract,
    }),
    null,
  );
});

test("output guard blocks granted discount when human approval is required", () => {
  const contract = buildContract({
    discountAutonomyMode: "approval_required",
  });

  assert.equal(
    findSalesAiBehaviorContractOutputViolation({
      text: "Consigo liberar 10% de desconto para você.",
      contract,
    }),
    "DISCOUNT_APPROVAL_BYPASSED",
  );
});

test("output guard allows discount consultation when human approval is required", () => {
  const contract = buildContract({
    discountAutonomyMode: "approval_required",
  });

  assert.equal(
    findSalesAiBehaviorContractOutputViolation({
      text: "Posso consultar a aprovação de 10% de desconto com o responsável.",
      contract,
    }),
    null,
  );
});

test("output guard blocks Pix key disclosure when key authority is unconfigured", () => {
  const contract = buildContract({
    pixAccepted: true,
    pixKey: null,
    pixKeyType: null,
  });

  assert.equal(
    findSalesAiBehaviorContractOutputViolation({
      text: "A chave Pix é financeiro@loja.com.",
      contract,
    }),
    "PIX_KEY_DISCLOSURE_NOT_ALLOWED",
  );
});

test("output guard allows safe Pix confirmation wording when key authority is unconfigured", () => {
  const contract = buildContract({
    pixAccepted: true,
    pixKey: null,
    pixKeyType: null,
  });

  assert.equal(
    findSalesAiBehaviorContractOutputViolation({
      text: "A loja aceita Pix, mas a chave correta precisa ser confirmada antes de eu passar.",
      contract,
    }),
    null,
  );
});

console.log("sales AI behavior contract output guard: 6 tests passed");