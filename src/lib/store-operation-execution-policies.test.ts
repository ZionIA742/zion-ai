import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInstallationExecutionPolicy,
  buildTechnicalVisitExecutionPolicy,
  formatVisitFixedFeeFromCents,
  installationPolicyToDraftPatch,
  parseVisitFixedFeeToCents,
  technicalVisitPolicyToDraftPatch,
} from "./store-operation-execution-policies";

test("visit policy maps canonical scheduling and duration", () => {
  const result = buildTechnicalVisitExecutionPolicy({
    visit_required_situations: ["medidas"],
    visit_required_other: "",
    visit_optional_situations: ["cliente_pedir"],
    visit_optional_other: "",
    visit_team_mode: "dono_loja",
    visit_team_rule: "",
    visit_requires_appointment: "Sim",
    visit_duration_mode: "60",
    visit_duration_minutes: "60",
    visit_duration_rule: "",
    visit_pricing_mode: "free",
    visit_fixed_fee: "",
    visit_case_by_case_rule: "",
    visit_deductible: "",
    visit_preconfirm_items: ["endereco"],
    visit_preconfirm_other: "",
    visit_other_notes: "teste",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.requires_appointment, true);
  assert.equal(result.value.duration_mode, "60");
  assert.equal(result.value.duration_minutes, 60);
  assert.deepEqual(result.value.required_situations, ["medidas"]);
});

test("visit without duration fails when appointment is required", () => {
  const result = buildTechnicalVisitExecutionPolicy({
    visit_required_situations: [],
    visit_required_other: "",
    visit_optional_situations: [],
    visit_optional_other: "",
    visit_team_mode: "dono_loja",
    visit_team_rule: "",
    visit_requires_appointment: "Sim",
    visit_duration_mode: "",
    visit_duration_minutes: "",
    visit_duration_rule: "",
    visit_pricing_mode: "free",
    visit_fixed_fee: "",
    visit_case_by_case_rule: "",
    visit_deductible: "",
    visit_preconfirm_items: [],
    visit_preconfirm_other: "",
    visit_other_notes: "",
  });

  assert.equal(result.ok, false);
});

test("BRL fixed fee conversion is deterministic", () => {
  assert.equal(parseVisitFixedFeeToCents("150"), 15000);
  assert.equal(parseVisitFixedFeeToCents("150,50"), 15050);
  assert.equal(parseVisitFixedFeeToCents("R$ 1.250,75"), 125075);
  assert.equal(parseVisitFixedFeeToCents("abc"), null);
  assert.equal(formatVisitFixedFeeFromCents(15050), "150,50");
});

test("installation normalizes Sim Nao Depende into canonical values", () => {
  const result = buildInstallationExecutionPolicy({
    installation_customer_can_buy_without: "Sim",
    installation_customer_can_buy_without_rule: "",
    installation_third_party_pool: "Não",
    installation_third_party_pool_rule: "",
    installation_supply_mode: "disponivel",
    installation_supplier_lead_time_mode: "",
    installation_supplier_lead_time_value: "",
    installation_supplier_lead_time_rule: "",
    installation_start_lead_time_mode: "1_dia",
    installation_start_lead_time_days: "",
    installation_start_lead_time_rule: "",
    installation_duration_mode: "horas",
    installation_duration_value: "6",
    installation_duration_unit: "horas",
    installation_duration_rule: "",
    installation_has_multiple_teams: "Não",
    installation_concurrent_capacity: "1",
    installation_schedule_gates: ["endereco"],
    installation_schedule_gates_other: "",
    installation_start_gates: ["produto"],
    installation_start_gates_other: "",
    installation_includes: ["entrega"],
    installation_includes_other: "",
    installation_excludes_options: ["paisagismo"],
    installation_excludes: "",
    installation_notes: "",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.customer_can_buy_without, "sim");
  assert.equal(result.value.third_party_pool, "nao");
  assert.equal(result.value.concurrent_capacity, 1);
  assert.equal(result.value.duration_value, 6);
});

test("installation supplier mode is required when supply is ordered", () => {
  const result = buildInstallationExecutionPolicy({
    installation_customer_can_buy_without: "Sim",
    installation_customer_can_buy_without_rule: "",
    installation_third_party_pool: "Não",
    installation_third_party_pool_rule: "",
    installation_supply_mode: "sob_encomenda",
    installation_supplier_lead_time_mode: "",
    installation_supplier_lead_time_value: "",
    installation_supplier_lead_time_rule: "",
    installation_start_lead_time_mode: "1_dia",
    installation_start_lead_time_days: "",
    installation_start_lead_time_rule: "",
    installation_duration_mode: "horas",
    installation_duration_value: "6",
    installation_duration_unit: "horas",
    installation_duration_rule: "",
    installation_has_multiple_teams: "Não",
    installation_concurrent_capacity: "1",
    installation_schedule_gates: [],
    installation_schedule_gates_other: "",
    installation_start_gates: [],
    installation_start_gates_other: "",
    installation_includes: [],
    installation_includes_other: "",
    installation_excludes_options: [],
    installation_excludes: "",
    installation_notes: "",
  });

  assert.equal(result.ok, false);
});

test("single installation team cannot expose capacity above one", () => {
  const result = buildInstallationExecutionPolicy({
    installation_customer_can_buy_without: "Sim",
    installation_customer_can_buy_without_rule: "",
    installation_third_party_pool: "Não",
    installation_third_party_pool_rule: "",
    installation_supply_mode: "disponivel",
    installation_supplier_lead_time_mode: "",
    installation_supplier_lead_time_value: "",
    installation_supplier_lead_time_rule: "",
    installation_start_lead_time_mode: "1_dia",
    installation_start_lead_time_days: "",
    installation_start_lead_time_rule: "",
    installation_duration_mode: "horas",
    installation_duration_value: "6",
    installation_duration_unit: "horas",
    installation_duration_rule: "",
    installation_has_multiple_teams: "Não",
    installation_concurrent_capacity: "2",
    installation_schedule_gates: [],
    installation_schedule_gates_other: "",
    installation_start_gates: [],
    installation_start_gates_other: "",
    installation_includes: [],
    installation_includes_other: "",
    installation_excludes_options: [],
    installation_excludes: "",
    installation_notes: "",
  });

  assert.equal(result.ok, false);
});

test("visit canonical policy hydrates UI draft", () => {
  const patch = technicalVisitPolicyToDraftPatch(
    {
      required_situations: ["medidas"],
      optional_situations: [],
      team_mode: "equipe_tecnica",
      requires_appointment: true,
      duration_mode: "90",
      duration_minutes: 90,
      preconfirm_items: ["fotos"],
    },
    {
      mode: "fixed",
      fixedFeeCents: 15000,
      deductible: true,
    },
  );

  assert.equal(patch.visit_duration_mode, "90");
  assert.equal(patch.visit_duration_minutes, "90");
  assert.equal(patch.visit_pricing_mode, "fixed");
  assert.equal(patch.visit_fixed_fee, "150,00");
  assert.equal(patch.visit_deductible, "Sim");
});

test("installation canonical policy hydrates UI draft", () => {
  const patch = installationPolicyToDraftPatch({
    customer_can_buy_without: "sim",
    third_party_pool: "nao",
    supply_mode: "disponivel",
    start_lead_time_mode: "2_3_dias",
    duration_mode: "dias_uteis",
    duration_value: 2,
    has_multiple_teams: false,
    concurrent_capacity: 1,
    schedule_gates: ["endereco"],
    start_gates: ["produto"],
    includes: ["entrega"],
    excludes: [],
  });

  assert.equal(patch.installation_customer_can_buy_without, "Sim");
  assert.equal(patch.installation_third_party_pool, "Não");
  assert.equal(patch.installation_duration_value, "2");
  assert.equal(patch.installation_duration_unit, "dias_uteis");
  assert.equal(patch.installation_concurrent_capacity, "1");
});