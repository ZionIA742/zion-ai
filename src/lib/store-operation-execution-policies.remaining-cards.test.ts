import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeliveryExecutionPolicy,
  buildPickupExecutionPolicy,
  buildPoolReplacementExecutionPolicy,
  buildTechnicalServicesExecutionPolicy,
  deliveryPolicyToDraftPatch,
  pickupPolicyToDraftPatch,
  poolReplacementPolicyToDraftPatch,
  technicalServicesPolicyToDraftPatch,
} from "./store-operation-execution-policies";

function poolDraft() {
  return {
    pool_replacement_enabled: "Sim",
    pool_replacement_situations: ["nova_da_loja", "danificada"],
    pool_replacement_situations_other: "",
    pool_replacement_removes_old: "Sim",
    pool_replacement_removes_old_rule: "",
    pool_replacement_disposal_included: "caso_a_caso",
    pool_replacement_disposal_rule: "Depende do local de descarte.",
    pool_replacement_requires_visit: "depende",
    pool_replacement_visit_rule: "Quando acesso ou medidas precisam ser confirmados.",
    pool_replacement_uses_installation_team: "depende",
    pool_replacement_team_rule: "Depende da complexidade da troca.",
    pool_replacement_duration_mode: "varia",
    pool_replacement_duration_value: "",
    pool_replacement_duration_rule: "Varia conforme retirada e preparação do local.",
    pool_replacement_includes: [
      "desconexao",
      "retirada_antiga",
      "posicionamento",
      "testes",
    ],
    pool_replacement_excludes_options: ["paisagismo", "obra_entorno"],
    pool_replacement_excludes: "",
    pool_replacement_notes: "Teste focal Card 7.",
  };
}

function deliveryDraft() {
  return {
    delivery_enabled: "Sim",
    delivery_items: ["piscina_com_instalacao", "equipamentos"],
    delivery_items_other: "",
    delivery_with_installation_mode: "depende",
    delivery_with_installation_timing: "",
    delivery_with_installation_notes:
      "A relação entre entrega e instalação depende do projeto.",
    delivery_provider: "ambos",
    delivery_provider_rule: "Pedidos maiores podem usar parceiro.",
    delivery_uses_installation_team: "depende",
    delivery_installation_team_rule:
      "Depende do tamanho e da necessidade de descarga.",
    delivery_coverage_mode: "CAMPO_LEGADO_NAO_DEVE_IR",
    delivery_pricing_mode: "caso_a_caso",
    delivery_pricing_destination_mode: "",
    delivery_pricing_destination_rule: "",
    delivery_partner_pricing_mode: "",
    delivery_partner_pricing_rule: "",
    delivery_case_factors: ["distancia", "acesso"],
    delivery_case_rule: "Calcula conforme distância e acesso.",
    delivery_fixed_fee: "",
    delivery_requires_appointment: "CAMPO_LEGADO_NAO_DEVE_IR",
    delivery_lead_time_mode: "CAMPO_LEGADO_NAO_DEVE_IR",
    delivery_lead_time_days: "999",
    delivery_release_gates: ["pagamento", "produto", "endereco"],
    delivery_release_gates_other: "",
    delivery_unloading_mode: "depende",
    delivery_notes:
      "A descarga e o posicionamento dependem do produto e do projeto.",
  };
}

function pickupDraft() {
  return {
    pickup_enabled: "Sim",
    pickup_items: ["piscinas", "equipamentos", "acessorios"],
    pickup_items_other: "",
    pickup_location_mode: "loja",
    pickup_other_location: "",
    pickup_requires_appointment: "Sim",
    pickup_ready_mode: "CAMPO_LEGADO_NAO_DEVE_IR",
    pickup_ready_value: "999",
    pickup_third_party_allowed: "autorizado",
    pickup_release_gates: [
      "pagamento",
      "separado",
      "identificacao",
      "autorizacao",
    ],
    pickup_release_gates_other: "",
    pickup_notes: "Teste focal Card 9.",
  };
}

function servicesDraft() {
  return {
    technical_services_enabled: "Sim",
    technical_service_types: [
      "diagnostico",
      "instalacao_equipamento",
      "troca_equipamento",
    ],
    technical_services_other: "",
    technical_equipment_types: ["bombas", "filtros"],
    technical_equipment_other: "",
    equipment_installation_origin_policy: "depende",
    equipment_installation_origin_rule: "Depende do equipamento.",
    equipment_replacement_existing: "caso_a_caso",
    equipment_replacement_existing_rule:
      "Substitui após avaliação técnica.",
    technical_services_notes: "Teste focal Card 10.",
  };
}

test("Card 7: monta policy canonica rica de troca", () => {
  const result = buildPoolReplacementExecutionPolicy(poolDraft());

  assert.equal(result.ok, true);

  if (!result.ok) return;

  assert.deepEqual(result.value.situations, [
    "nova_da_loja",
    "danificada",
  ]);
  assert.equal(result.value.uses_installation_team, "depende");
  assert.equal(
    result.value.team_rule,
    "Depende da complexidade da troca.",
  );
  assert.equal(result.value.duration_mode, "varia");
  assert.equal(
    result.value.duration_rule,
    "Varia conforme retirada e preparação do local.",
  );
  assert.equal(result.value.disposal_included, "caso_a_caso");
  assert.equal(result.value.requires_visit, "depende");
});

test("Card 7: varia sem duration_rule falha no adapter", () => {
  const draft = poolDraft();
  draft.pool_replacement_duration_rule = "";

  const result = buildPoolReplacementExecutionPolicy(draft);

  assert.equal(result.ok, false);

  if (result.ok) return;

  assert.match(result.error, /tempo/i);
});

test("Card 7: hydration distingue nunca configurado de Não explicito", () => {
  const neverConfigured = poolReplacementPolicyToDraftPatch(
    null,
    false,
  );

  const explicitlyDisabled = poolReplacementPolicyToDraftPatch(
    null,
    true,
  );

  assert.equal(
    neverConfigured.pool_replacement_enabled,
    "Não definido",
  );
  assert.equal(
    explicitlyDisabled.pool_replacement_enabled,
    "Não",
  );
});

test("Card 8: modo depende funciona sem timing inexistente na UI", () => {
  const result = buildDeliveryExecutionPolicy(deliveryDraft());

  assert.equal(result.ok, true);

  if (!result.ok) return;

  assert.equal(
    result.value.with_installation_mode,
    "depende",
  );
  assert.equal(
    result.value.with_installation_timing,
    undefined,
  );
  assert.equal(
    result.value.with_installation_notes,
    "A relação entre entrega e instalação depende do projeto.",
  );

  assert.equal(
    "coverage_mode" in result.value,
    false,
  );
  assert.equal(
    "requires_appointment" in result.value,
    false,
  );
  assert.equal(
    "lead_time_mode" in result.value,
    false,
  );
});

test("Card 8: frete fixo converte centavos deterministicamente", () => {
  const draft = deliveryDraft();

  draft.delivery_items = ["equipamentos"];
  draft.delivery_with_installation_mode = "";
  draft.delivery_with_installation_notes = "";
  draft.delivery_provider = "parceiro";
  draft.delivery_provider_rule = "";
  draft.delivery_uses_installation_team = "";
  draft.delivery_installation_team_rule = "";
  draft.delivery_pricing_mode = "fixo";
  draft.delivery_fixed_fee = "150,50";
  draft.delivery_unloading_mode = "transporta";
  draft.delivery_notes = "";

  const result = buildDeliveryExecutionPolicy(draft);

  assert.equal(result.ok, true);

  if (!result.ok) return;

  assert.equal(result.value.fixed_fee_cents, 15050);
});

test("Card 8: frete fixo sem valor é rejeitado", () => {
  const draft = deliveryDraft();

  draft.delivery_items = ["equipamentos"];
  draft.delivery_with_installation_mode = "";
  draft.delivery_with_installation_notes = "";
  draft.delivery_provider = "parceiro";
  draft.delivery_provider_rule = "";
  draft.delivery_uses_installation_team = "";
  draft.delivery_installation_team_rule = "";
  draft.delivery_pricing_mode = "fixo";
  draft.delivery_fixed_fee = "";
  draft.delivery_unloading_mode = "transporta";
  draft.delivery_notes = "";

  const result = buildDeliveryExecutionPolicy(draft);

  assert.equal(result.ok, false);

  if (result.ok) return;

  assert.match(result.error, /valor fixo/i);
});

test("Card 8: hydration restaura frete fixo e não ressuscita campos legados", () => {
  const patch = deliveryPolicyToDraftPatch(
    {
      items: ["equipamentos"],
      provider: "parceiro",
      pricing_mode: "fixo",
      fixed_fee_cents: 15050,
      release_gates: ["pagamento"],
      unloading_mode: "transporta",
      notes: "Entrega focal.",
    },
    true,
  );

  assert.equal(patch.delivery_enabled, "Sim");
  assert.equal(patch.delivery_fixed_fee, "150,50");
  assert.equal(patch.delivery_coverage_mode, "");
  assert.equal(patch.delivery_requires_appointment, "");
  assert.equal(patch.delivery_lead_time_mode, "");
  assert.equal(patch.delivery_lead_time_days, "");
});

test("Card 9: monta policy canonica e ignora ready_mode legado", () => {
  const result = buildPickupExecutionPolicy(pickupDraft());

  assert.equal(result.ok, true);

  if (!result.ok) return;

  assert.deepEqual(result.value.items, [
    "piscinas",
    "equipamentos",
    "acessorios",
  ]);
  assert.equal(result.value.location_mode, "loja");
  assert.equal(result.value.requires_appointment, true);
  assert.equal(result.value.third_party_allowed, "autorizado");
  assert.equal("ready_mode" in result.value, false);
  assert.equal("ready_value" in result.value, false);
});

test("Card 9: hydration preserva Não explicito e limpa campos mortos", () => {
  const disabled = pickupPolicyToDraftPatch(null, true);

  assert.equal(disabled.pickup_enabled, "Não");
  assert.equal(disabled.pickup_ready_mode, "");
  assert.equal(disabled.pickup_ready_value, "");

  const neverConfigured = pickupPolicyToDraftPatch(null, false);

  assert.equal(
    neverConfigured.pickup_enabled,
    "Não definido",
  );
});

test("Card 10: monta as duas regras condicionais canonicas", () => {
  const result =
    buildTechnicalServicesExecutionPolicy(servicesDraft());

  assert.equal(result.ok, true);

  if (!result.ok) return;

  assert.deepEqual(result.value.service_types, [
    "diagnostico",
    "instalacao_equipamento",
    "troca_equipamento",
  ]);

  assert.equal(
    result.value.equipment_installation_origin_policy,
    "depende",
  );
  assert.equal(
    result.value.equipment_installation_origin_rule,
    "Depende do equipamento.",
  );
  assert.equal(
    result.value.equipment_replacement_existing,
    "caso_a_caso",
  );
  assert.equal(
    result.value.equipment_replacement_existing_rule,
    "Substitui após avaliação técnica.",
  );
});

test("Card 10: depende sem regra de origem é rejeitado", () => {
  const draft = servicesDraft();
  draft.equipment_installation_origin_rule = "";

  const result =
    buildTechnicalServicesExecutionPolicy(draft);

  assert.equal(result.ok, false);

  if (result.ok) return;

  assert.match(result.error, /equipamentos/i);
});

test("Card 10: hydration restaura policy e distingue configuração", () => {
  const patch = technicalServicesPolicyToDraftPatch(
    {
      service_types: [
        "diagnostico",
        "instalacao_equipamento",
        "troca_equipamento",
      ],
      equipment_types: ["bombas", "filtros"],
      equipment_installation_origin_policy: "depende",
      equipment_installation_origin_rule:
        "Depende do equipamento.",
      equipment_replacement_existing: "caso_a_caso",
      equipment_replacement_existing_rule:
        "Substitui após avaliação técnica.",
      notes: "Teste focal Card 10.",
    },
    true,
  );

  assert.equal(
    patch.technical_services_enabled,
    "Sim",
  );
  assert.deepEqual(
    patch.technical_equipment_types,
    ["bombas", "filtros"],
  );
  assert.equal(
    patch.equipment_installation_origin_policy,
    "depende",
  );
  assert.equal(
    patch.equipment_replacement_existing,
    "caso_a_caso",
  );

  const disabled =
    technicalServicesPolicyToDraftPatch(null, true);

  assert.equal(
    disabled.technical_services_enabled,
    "Não",
  );
});