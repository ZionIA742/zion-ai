import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pagePath = "src/app/(app)/configuracoes/page.tsx";
const strategyLibPath = "src/lib/store-strategy-settings.ts";
const pageSource = readFileSync(pagePath, "utf8");
const strategyLibSource = readFileSync(strategyLibPath, "utf8");

function blockBetween(start: string, end: string): string {
  const startIndex = pageSource.indexOf(start);
  const endIndex = pageSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, "start not found: " + start);
  assert.notEqual(endIndex, -1, "end not found: " + end);
  assert.equal(endIndex > startIndex, true);
  return pageSource.slice(startIndex, endIndex);
}

const redesignedFields = [
  "strategy_sell_more_choices",
  "strategy_sell_more_other",
  "strategy_priority_deal_types",
  "strategy_priority_deal_types_other",
  "strategy_avoid_cases",
  "strategy_avoid_cases_other",
  "strategy_avoid_action",
  "strategy_sale_value_range",
  "strategy_sale_value_custom",
  "strategy_commercial_strategy_configured_at",
];

test("strategy settings row and page select expose redesigned commercial strategy fields", () => {
  const selectBlock = blockBetween('          .from("store_strategy_settings")', '          .from("store_channel_settings")');
  for (const field of redesignedFields) {
    assert.equal(strategyLibSource.includes(field + "?:"), true, "type missing " + field);
    assert.equal(selectBlock.includes(field), true, "select missing " + field);
  }
});

test("commercial strategy card persists only through the redesigned canonical writer", () => {
  const saveBlock = blockBetween('  const saveCommercialExperienceCard = useCallback(async (target: string) => {', '  const handleCommercialEditCancel = useCallback(() => {');
  const strategyBranchStart = saveBlock.indexOf('if (target === "strategy") {');
  const nextBranchStart = saveBlock.indexOf('if (target === "offerings" || target === "brands") {');
  assert.notEqual(strategyBranchStart, -1);
  assert.notEqual(nextBranchStart, -1);
  assert.equal(strategyBranchStart < nextBranchStart, true);
  const strategyBranch = saveBlock.slice(strategyBranchStart, nextBranchStart);
  assert.equal(strategyBranch.includes('"upsert_store_commercial_strategy_policy_scoped"'), true);
  assert.equal(saveBlock.includes('"upsert_store_structured_commercial_strategy_scoped"'), false);
  for (const parameter of [
    "p_strategy_sell_more_choices",
    "p_strategy_sell_more_other",
    "p_strategy_priority_deal_types",
    "p_strategy_priority_deal_types_other",
    "p_strategy_avoid_cases",
    "p_strategy_avoid_cases_other",
    "p_strategy_avoid_action",
    "p_strategy_sale_value_range",
    "p_strategy_sale_value_custom",
  ]) {
    assert.equal(strategyBranch.includes(parameter), true, "writer payload missing " + parameter);
  }
  const errorGate = strategyBranch.indexOf("if (structuredStrategySaveError) throw structuredStrategySaveError;");
  assert.equal(errorGate >= 0, true);
  const successGate = saveBlock.indexOf('setSuccessText("', nextBranchStart);
  assert.equal(successGate > errorGate, true, "success must happen only after the redesigned writer error gate");
});

test("canonical hydration uses the redesigned configured marker and redesigned database fields", () => {
  const hydrationBlock = blockBetween('function createCanonicalCommercialExperienceDraft(', 'function buildStrategyServicesFromOfferings(');
  assert.equal(hydrationBlock.includes("strategySettings?.strategy_commercial_strategy_configured_at"), true);
  assert.equal(hydrationBlock.includes("hasRedesignedCommercialStrategy"), true);
  for (const field of [
    "strategy_priority_deal_types",
    "strategy_priority_deal_types_other",
    "strategy_avoid_cases",
    "strategy_avoid_cases_other",
    "strategy_avoid_action",
  ]) {
    assert.equal(hydrationBlock.includes("strategySettings?." + field), true, "hydration missing " + field);
  }
  assert.equal(hydrationBlock.includes('["equipamentos", "acessorios_equipamentos"].includes(value)'), true);
  assert.equal(
    pageSource.includes("createCanonicalCommercialExperienceDraft(savedCommercialExperience, strategySettingsInput, strategySettings)"),
    true,
  );
  assert.equal(
    pageSource.includes("createCanonicalCommercialExperienceDraft(current, strategySettingsInput, strategySettings)"),
    true,
  );
});

test("visible commercial strategy card uses only the approved redesigned semantics", () => {
  const strategyCard = blockBetween('            title="Estratégia comercial"', '            title="Marcas trabalhadas e preferência"');
  for (const requiredText of [
    "COMMERCIAL_PRIORITY_DEAL_TYPE_OPTIONS",
    "COMMERCIAL_AVOID_CASE_OPTIONS",
    "COMMERCIAL_AVOID_ACTION_OPTIONS",
    "strategy_priority_deal_types",
    "strategy_avoid_cases",
    "strategy_avoid_action",
    "comportamento observado no atendimento",
  ]) {
    assert.equal(strategyCard.includes(requiredText), true, "new strategy UI missing " + requiredText);
  }
  for (const obsoleteText of [
    "COMMERCIAL_SALE_PREFERENCE_OPTIONS",
    "COMMERCIAL_CUSTOMER_TRAIT_OPTIONS",
    "COMMERCIAL_ATTENTION_CASE_OPTIONS",
    "strategy_sale_preference",
    "strategy_customer_traits",
    "strategy_attention_cases",
  ]) {
    assert.equal(strategyCard.includes(obsoleteText), false, "obsolete strategy UI still present: " + obsoleteText);
  }
});

test("strategy multi-select helper enforces exclusive neutral choices and clears dependent values", () => {
  const toggleBlock = blockBetween('  const toggleCommercialExperienceArrayValue = useCallback((', '  const saveCommercialExperienceCard = useCallback(');
  assert.equal(toggleBlock.includes('key === "strategy_avoid_cases"'), true);
  assert.equal(toggleBlock.includes('key === "strategy_sell_more" || key === "strategy_priority_deal_types"'), true);
  assert.equal(toggleBlock.includes('? "nenhum"'), true);
  assert.equal(toggleBlock.includes('? "sem_prioridade"'), true);
  assert.equal(toggleBlock.includes('nextState.strategy_sell_more_other = "";'), true);
  assert.equal(toggleBlock.includes('nextState.strategy_priority_deal_types_other = "";'), true);
  assert.equal(toggleBlock.includes('nextState.strategy_avoid_cases_other = "";'), true);
  assert.equal(toggleBlock.includes('nextState.strategy_avoid_action = "";'), true);
});

test("catalog priorities and deal-type priorities remain semantically separated", () => {
  const sellMoreOptions = blockBetween("const COMMERCIAL_SELL_MORE_OPTIONS", "const COMMERCIAL_PRIORITY_DEAL_TYPE_OPTIONS");
  const dealTypeOptions = blockBetween("const COMMERCIAL_PRIORITY_DEAL_TYPE_OPTIONS", "const COMMERCIAL_AVOID_CASE_OPTIONS");
  assert.equal(sellMoreOptions.includes('value: "piscinas_instalacao"'), false);
  assert.equal(sellMoreOptions.includes('label: "Piscinas com instalação"'), false);
  assert.equal(sellMoreOptions.includes('label: "Piscinas"'), true);
  assert.equal(sellMoreOptions.includes('label: "Acessórios e equipamentos"'), true);
  assert.equal(dealTypeOptions.includes('value: "piscina_com_instalacao"'), true);
  assert.equal(dealTypeOptions.includes('label: "Piscina com instalação"'), true);
});
