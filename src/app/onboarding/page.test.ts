import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => void;
};

const pagePath = join(process.cwd(), "src/app/onboarding/page.tsx");

function readPageSource() {
  return readFileSync(pagePath, "utf8");
}

function getSaveStep5Block(source: string) {
  const start = source.indexOf("  async function saveStep5(e: FormEvent) {");
  assert.equal(start > -1, true, "saveStep5 not found");
  const end = source.indexOf("  if (storeLoading) {", start);
  assert.equal(end > start, true, "saveStep5 end not found");
  return source.slice(start, end);
}

function getSaveStep4Block(source: string) {
  const start = source.indexOf("  async function saveStep4(e: FormEvent) {");
  assert.equal(start > -1, true, "saveStep4 not found");
  const end = source.indexOf("  async function saveStep5(e: FormEvent) {", start);
  assert.equal(end > start, true, "saveStep4 end not found");
  return source.slice(start, end);
}

function getSaveStep1Block(source: string) {
  const start = source.indexOf("  async function saveStep1(e: FormEvent) {");
  assert.equal(start > -1, true, "saveStep1 not found");
  const end = source.indexOf("  async function saveStep2(e: FormEvent) {", start);
  assert.equal(end > start, true, "saveStep1 end not found");
  return source.slice(start, end);
}

function getSaveStep2Block(source: string) {
  const start = source.indexOf("  async function saveStep2(e: FormEvent) {");
  assert.equal(start > -1, true, "saveStep2 not found");
  const end = source.indexOf("  async function saveStep3(e: FormEvent) {", start);
  assert.equal(end > start, true, "saveStep2 end not found");
  return source.slice(start, end);
}

function getSaveStep3Block(source: string) {
  const start = source.indexOf("  async function saveStep3(e: FormEvent) {");
  assert.equal(start > -1, true, "saveStep3 not found");
  const end = source.indexOf("  async function saveStep4(e: FormEvent) {", start);
  assert.equal(end > start, true, "saveStep3 end not found");
  return source.slice(start, end);
}

function getLoadAnswersBlock(source: string) {
  const start = source.indexOf("    const loadAnswers = async () => {");
  assert.equal(start > -1, true, "loadAnswers not found");
  const end = source.indexOf("    loadAnswers();", start);
  assert.equal(end > start, true, "loadAnswers end not found");
  return source.slice(start, end);
}

function getScheduleSaveBlock(source: string) {
  const start = source.indexOf("  async function saveExistingScheduleSettingsPartial(");
  assert.equal(start > -1, true, "saveExistingScheduleSettingsPartial not found");
  const end = source.indexOf("  async function saveStep1(e: FormEvent) {", start);
  assert.equal(end > start, true, "saveExistingScheduleSettingsPartial end not found");
  return source.slice(start, end);
}

function getStep3DraftMergeBlock(source: string) {
  const start = source.indexOf("function mergePersistedStep3Draft(");
  assert.equal(start > -1, true, "mergePersistedStep3Draft not found");
  const end = source.indexOf("function joinSelectedLabels(", start);
  assert.equal(end > start, true, "mergePersistedStep3Draft end not found");
  return source.slice(start, end);
}

function getSaveStrategySettingsPartialBlock(source: string) {
  const start = source.indexOf("  async function saveStrategySettingsPartial(");
  assert.equal(start > -1, true, "saveStrategySettingsPartial not found");
  const end = source.indexOf("  async function saveStep1(e: FormEvent) {", start);
  assert.equal(end > start, true, "saveStrategySettingsPartial end not found");
  return source.slice(start, end);
}

function getSaveOperationSettingsPartialBlock(source: string) {
  const start = source.indexOf("  async function saveOperationSettingsPartial(");
  assert.equal(start > -1, true, "saveOperationSettingsPartial not found");
  const end = source.indexOf("  async function saveExistingScheduleSettingsPartial(", start);
  assert.equal(end > start, true, "saveOperationSettingsPartial end not found");
  return source.slice(start, end);
}

const tests: TestCase[] = [
  {
    name: "step 1 syncs canonical strategy settings before remaining onboarding answers and keeps canonical keys out of direct legacy writes",
    run: () => {
      const source = readPageSource();
      const block = getSaveStep1Block(source);
      const strategyBlock = getSaveStrategySettingsPartialBlock(source);

      const canonicalSyncIndex = block.indexOf("await saveStrategySettingsPartial({");
      const legacyAnswersIndex = block.indexOf("await upsertAnswers(");

      assert.equal(canonicalSyncIndex > -1, true);
      assert.equal(legacyAnswersIndex > -1, true);
      assert.equal(canonicalSyncIndex < legacyAnswersIndex, true);
      assert.equal(
        strategyBlock.includes('"upsert_store_strategy_settings_with_legacy_mirror_scoped"'),
        true,
      );
      assert.equal(block.includes('["store_display_name", step1Form.store_display_name.trim()]'), true);
      assert.equal(block.includes('["commercial_whatsapp", step1Form.commercial_whatsapp.trim()]'), true);
      assert.equal(block.includes('["store_description", step1Form.store_description.trim()]'), false);
      assert.equal(block.includes('["city", step1Form.city.trim()]'), false);
      assert.equal(block.includes('["state", step1Form.state.trim()]'), false);
      assert.equal(block.includes('["service_regions", step1Form.service_regions.trim()]'), false);
      assert.equal(block.includes('["store_services", step1Form.store_services]'), false);
      assert.equal(block.includes('["service_region_modes", step1Form.service_region_modes]'), false);
    },
  },
  {
    name: "onboarding uses legacy strategy answers only through explicit visual seed when canonical is absent",
    run: () => {
      const source = readPageSource();
      const block = getLoadAnswersBlock(source);

      assert.equal(
        source.includes("createStoreStrategySettingsLegacySeedInputFromAnswers"),
        true,
      );
      assert.equal(block.includes("const strategyFormSeedInput = canonicalStrategySettings"), true);
      assert.equal(block.includes("? strategySettingsInput"), true);
      assert.equal(
        block.includes(": createStoreStrategySettingsLegacySeedInputFromAnswers(answers)"),
        true,
      );
      assert.equal(block.includes("strategyFormSeedInput.storeDescription"), true);
      assert.equal(block.includes("strategyFormSeedInput.mainStoreBrand"), true);
      assert.equal(block.includes("strategyFormSeedInput.brandsWorked"), true);
    },
  },
  {
    name: "partial strategy save uses canonical current state or empty defaults before explicit patch",
    run: () => {
      const source = readPageSource();
      const block = getSaveStrategySettingsPartialBlock(source);

      assert.equal(block.includes("...createStoreStrategySettingsInputFromSources({"), true);
      assert.equal(block.includes("settings: strategySettings"), true);
      assert.equal(block.indexOf("settings: strategySettings") < block.indexOf("...patch"), true);
      assert.equal(block.includes("answers.city"), false);
      assert.equal(block.includes("answers.service_regions"), false);
      assert.equal(block.includes("answers.main_store_brand"), false);
      assert.equal(block.includes("answers.brands_worked"), false);
      assert.equal(block.includes("answers.strategy_ai_presentation"), false);
    },
  },
  {
    name: "step 2 syncs canonical strategy settings before remaining onboarding answers and keeps brands fields out of direct legacy writes",
    run: () => {
      const source = readPageSource();
      const block = getSaveStep2Block(source);
      const strategyBlock = getSaveStrategySettingsPartialBlock(source);

      const canonicalSyncIndex = block.indexOf("await saveStrategySettingsPartial({");
      const legacyAnswersIndex = block.indexOf("await upsertAnswers(");

      assert.equal(canonicalSyncIndex > -1, true);
      assert.equal(legacyAnswersIndex > -1, true);
      assert.equal(canonicalSyncIndex < legacyAnswersIndex, true);
      assert.equal(
        strategyBlock.includes('"upsert_store_strategy_settings_with_legacy_mirror_scoped"'),
        true,
      );
      assert.equal(block.includes('["pool_types", step2Form.pool_types.trim()]'), true);
      assert.equal(block.includes('["brands_worked", step2Form.brands_worked.trim()]'), false);
      assert.equal(block.includes('["main_store_brand", step2Form.main_store_brand.trim()]'), false);
      assert.equal(block.includes("brandsWorked: step2Form.brands_worked.trim()"), true);
      assert.equal(block.includes("mainStoreBrand: step2Form.main_store_brand.trim()"), true);
    },
  },
  {
    name: "onboarding loads operation and schedule canonical settings for operation step drafts",
    run: () => {
      const source = readPageSource();
      const block = getLoadAnswersBlock(source);

      assert.equal(block.includes('.from("store_operation_settings")'), true);
      assert.equal(block.includes('.from("store_schedule_settings")'), true);
      assert.equal(
        block.includes(
          "settings: canonicalOperationSettings",
        ),
        true,
      );
      assert.equal(block.includes("setOperationSettings(canonicalOperationSettings)"), true);
      assert.equal(block.includes("setScheduleSettings(canonicalScheduleSettings)"), true);
      assert.equal(
        block.includes("canonicalScheduleSettings.installation_days"),
        true,
      );
      assert.equal(
        block.includes("canonicalScheduleSettings.technical_visit_days"),
        true,
      );
      assert.equal(
        block.includes("canonicalScheduleSettings.attends_holidays"),
        true,
      );
      assert.equal(block.includes("enforce_operating_window"), true);
      assert.equal(block.includes("timezone_name"), true);
    },
  },
  {
    name: "onboarding operation load keeps legacy seed explicit while canonical settings win",
    run: () => {
      const source = readPageSource();
      const block = getLoadAnswersBlock(source);

      assert.equal(block.includes("canonicalOperationSettings"), true);
      assert.equal(
        block.includes("? yesNoFormValue(operationSettingsInput.offersInstallation)"),
        true,
      );
      assert.equal(
        block.includes("? yesNoFormValue(operationSettingsInput.offersTechnicalVisit)"),
        true,
      );
      assert.equal(
        block.includes("? String(operationSettingsInput.averageInstallationTimeDays ?? \"\")"),
        true,
      );
      assert.equal(
        block.includes("? operationSettingsInput.installationDaysRule"),
        true,
      );
      assert.equal(
        block.includes("? operationSettingsInput.technicalVisitDaysRule"),
        true,
      );
      assert.equal(
        block.includes("? operationSettingsInput.technicalVisitRules"),
        true,
      );
      assert.equal(
        block.includes("? operationSettingsInput.technicalVisitRulesOther"),
        true,
      );
      assert.equal(
        block.includes("yesNoFormValue(parseYesNoValue(answers.offers_installation))"),
        true,
      );
      assert.equal(
        block.includes("String(answers.average_installation_time_days ?? \"\")"),
        true,
      );
      assert.equal(
        block.includes("String(answers.installation_days_rule ?? \"\")"),
        true,
      );
      assert.equal(
        block.includes("operationRulesFromSource(remoteTechnicalVisitRulesSelected)"),
        true,
      );
    },
  },
  {
    name: "partial operation save builds from canonical row or empty defaults before explicit patch",
    run: () => {
      const source = readPageSource();
      const block = getSaveOperationSettingsPartialBlock(source);

      assert.equal(
        block.includes("...createStoreOperationSettingsInputFromSources({"),
        true,
      );
      assert.equal(block.includes("settings: operationSettings"), true);
      assert.equal(block.indexOf("settings: operationSettings") < block.indexOf("...patch"), true);
      assert.equal(block.includes("answers.offers_installation"), false);
      assert.equal(block.includes("answers.average_installation_time_days"), false);
      assert.equal(block.includes("answers.installation_days_rule"), false);
      assert.equal(block.includes("answers.offers_technical_visit"), false);
      assert.equal(block.includes("answers.technical_visit_days_rule"), false);
      assert.equal(block.includes("answers.technical_visit_rules_selected"), false);
      assert.equal(block.includes("answers.technical_visit_rules_other"), false);
    },
  },
  {
    name: "step 4 starts a new store without discount decision and derives the UI choice from canonical settings when present",
    run: () => {
      const source = readPageSource();

      assert.equal(source.includes('can_offer_discount: "",'), true);
      assert.equal(source.includes("const canOffer ="), true);
      assert.equal(source.includes("Number(row.default_discount_percent ?? 0) > 0"), true);
      assert.equal(source.includes("Number(row.max_discount_percent ?? 0) > 0"), true);
      assert.equal(source.includes("Boolean(row.allow_ask_above_max_discount)"), true);
      assert.equal(source.includes('can_offer_discount: canOffer ? "sim" : "não"'), true);
      assert.equal(source.includes("String(row.discount_special_rules ?? \"\")"), true);
    },
  },
  {
    name: "step 3 preserves the complete existing schedule payload and only edits collected agenda fields",
    run: () => {
      const source = readPageSource();
      const block = getScheduleSaveBlock(source);

      assert.equal(
        block.includes("if (!organizationId || !activeStore?.id || !scheduleSettings) return null;"),
        true,
      );
      assert.equal(block.includes("ensureScheduleSettingsPayloadCanPreserve(scheduleSettings)"), true);
      assert.equal(block.includes("p_allow_multiple_appointments_per_day:"), true);
      assert.equal(block.includes("scheduleSettings.allow_multiple_appointments_per_day"), true);
      assert.equal(block.includes("p_allow_same_time_appointments:"), true);
      assert.equal(block.includes("scheduleSettings.allow_same_time_appointments"), true);
      assert.equal(block.includes("p_same_time_capacity: scheduleSettings.same_time_capacity"), true);
      assert.equal(block.includes("Math.max("), false);
      assert.equal(block.includes("Number(scheduleSettings.same_time_capacity) || 1"), false);
      assert.equal(block.includes("p_operating_days: scheduleSettings.operating_days"), true);
      assert.equal(block.includes("p_operating_hours: scheduleSettings.operating_hours"), true);
      assert.equal(block.includes(": {}"), false);
      assert.equal(block.includes("p_after_hours_behavior: scheduleSettings.after_hours_behavior"), true);
      assert.equal(block.includes("p_notes: scheduleSettings.notes"), true);
      assert.equal(block.includes("p_enforce_operating_window: scheduleSettings.enforce_operating_window"), true);
      assert.equal(block.includes("p_timezone_name: scheduleSettings.timezone_name"), true);
      assert.equal(block.includes("p_installation_days:"), true);
      assert.equal(block.includes("p_attends_holidays:"), true);
      assert.equal(
        block.includes('"upsert_store_schedule_technical_visit_days_with_legacy_mirror_scoped"'),
        true,
      );
    },
  },
  {
    name: "step 3 persisted draft restore copies only known safe fields and lets canonical load win later",
    run: () => {
      const source = readPageSource();
      const block = getStep3DraftMergeBlock(source);
      const loadBlock = getLoadAnswersBlock(source);

      assert.equal(block.includes("...persisted"), false);
      assert.equal(block.includes("const next = { ...currentDraft };"), true);
      assert.equal(block.includes('typeof persisted[field] === "string"'), true);
      assert.equal(block.includes("Array.isArray(persisted[field])"), true);
      assert.equal(block.includes('typeof persisted[field] === "boolean"'), true);
      assert.equal(block.includes('"installation_days_rule"'), true);
      assert.equal(block.includes('"technical_visit_days_rule"'), true);
      assert.equal(block.includes("canonicalDaysFromSource("), true);
      assert.equal(block.includes("operationRulesFromSource("), true);
      assert.equal(block.includes("somente_regiao_atendida"), false);
      assert.equal(block.includes("horario_comercial"), false);
      assert.equal(
        block.includes('Object.prototype.hasOwnProperty.call(persisted, "installation_available_days")'),
        true,
      );
      assert.equal(block.includes("stringFields"), true);
      assert.equal(block.includes("stringArrayFields"), true);
      assert.equal(block.includes("booleanFields"), true);
      assert.equal(loadBlock.includes("canonicalOperationSettings"), true);
      assert.equal(loadBlock.includes("canonicalScheduleSettings"), true);
      assert.equal(
        loadBlock.indexOf("canonicalScheduleSettings.installation_days") >
          loadBlock.indexOf("setStep3Form((prev) => ({"),
        true,
      );
    },
  },
  {
    name: "step 2 syncs canonical operation settings before remaining onboarding answers and keeps offers fields out of direct legacy writes",
    run: () => {
      const source = readPageSource();
      const block = getSaveStep2Block(source);

      const operationSyncIndex = block.indexOf("await saveOperationSettingsPartial({");
      const legacyAnswersIndex = block.indexOf("await upsertAnswers(");

      assert.equal(operationSyncIndex > -1, true);
      assert.equal(legacyAnswersIndex > -1, true);
      assert.equal(operationSyncIndex < legacyAnswersIndex, true);
      assert.equal(
        block.includes("offersInstallation: parseYesNoValue(step2Form.offers_installation)"),
        true,
      );
      assert.equal(
        block.includes('["offers_installation", step2Form.offers_installation'),
        false,
      );
      assert.equal(
        block.includes('["offers_technical_visit", step2Form.offers_technical_visit'),
        false,
      );
    },
  },
  {
    name: "step 3 syncs operation and existing schedule canonical settings before legacy compatibility answers",
    run: () => {
      const source = readPageSource();
      const block = getSaveStep3Block(source);

      const operationSyncIndex = block.indexOf("await saveOperationSettingsPartial({");
      const scheduleSyncIndex = block.indexOf("await saveExistingScheduleSettingsPartial({");
      const legacyAnswersIndex = block.indexOf("await upsertAnswers(");

      assert.equal(operationSyncIndex > -1, true);
      assert.equal(scheduleSyncIndex > -1, true);
      assert.equal(legacyAnswersIndex > -1, true);
      assert.equal(operationSyncIndex < legacyAnswersIndex, true);
      assert.equal(scheduleSyncIndex < legacyAnswersIndex, true);
      assert.equal(block.includes("if (scheduleSettings) {"), true);
      assert.equal(block.includes("averageInstallationTimeDays: parsedAverageInstallationTime.value"), true);
      assert.equal(block.includes("technicalVisitRules: operationRulesFromSource("), true);
      assert.equal(block.includes("step3Form.technical_visit_rules_selected"), true);
      assert.equal(block.includes('["average_installation_time_days"'), false);
      assert.equal(block.includes('["technical_visit_rules_selected"'), false);
      assert.equal(block.includes('["technical_visit_available_days", nextTechnicalVisitDays]'), true);
    },
  },
  {
    name: "step 4 uses canonical payment and commercial writers before remaining onboarding answers",
    run: () => {
      const source = readPageSource();
      const block = getSaveStep4Block(source);

      const paymentSyncIndex = block.indexOf(
        '"upsert_store_payment_settings_with_legacy_mirror_scoped"',
      );
      const commercialSyncIndex = block.indexOf(
        '"upsert_store_commercial_ai_settings_with_legacy_mirror_scoped"',
      );
      const legacyAnswersIndex = block.indexOf('await supabase.rpc("onboarding_upsert_answer_scoped", {');

      assert.equal(paymentSyncIndex > -1, true);
      assert.equal(commercialSyncIndex > -1, true);
      assert.equal(legacyAnswersIndex > -1, true);
      assert.equal(paymentSyncIndex < legacyAnswersIndex, true);
      assert.equal(commercialSyncIndex < legacyAnswersIndex, true);
      assert.equal(
        block.includes('["accepted_payment_methods", step4Form.accepted_payment_methods]'),
        false,
      );
      assert.equal(block.includes('["ai_can_send_price_directly"'), false);
      assert.equal(block.includes('["price_direct_rule"'), false);
      assert.equal(block.includes('["price_direct_conditions"'), false);
      assert.equal(block.includes('["price_needs_human_help"'), false);
      assert.equal(block.includes('["price_talk_mode"'), false);
      assert.equal(block.includes('["price_must_understand_before"'), false);
      assert.equal(block.includes('["price_direct_rule_other"'), false);
      assert.equal(
        block.includes(
          'throw new Error(\n          "Falha ao sincronizar as configuracoes canonicas de pagamento.",',
        ) || block.includes('"Falha ao sincronizar as configuracoes canonicas de pagamento."'),
        true,
      );
      assert.equal(
        block.includes('"Falha ao sincronizar as configuracoes canonicas comerciais."'),
        true,
      );
    },
  },
  {
    name: "step 4 requires an explicit visible discount decision before materializing canonical discount settings",
    run: () => {
      const source = readPageSource();
      const block = getSaveStep4Block(source);

      assert.equal(
        block.includes("Informe se a loja trabalha ou não com descontos."),
        true,
      );
      assert.equal(
        source.includes('title="A loja trabalha com descontos?"'),
        true,
      );
      assert.equal(source.includes('value={step4Form.can_offer_discount}'), true);
      assert.equal(
        source.includes('onChange={(value) => updateStep4Field("can_offer_discount", value)}'),
        true,
      );
      assert.equal(
        block.includes('const usesNormalDiscount = step4Form.can_offer_discount === "sim";'),
        true,
      );
      assert.equal(
        block.includes("defaultDiscountPercent: usesNormalDiscount"),
        true,
      );
      assert.equal(
        block.includes("maxDiscountPercent: usesNormalDiscount"),
        true,
      );
      assert.equal(
        block.includes("allowAskAboveMaxDiscount: usesNormalDiscount"),
        true,
      );
      assert.equal(
        block.includes("discountAutonomyMode: usesNormalDiscount"),
        true,
      );
      assert.equal(
        block.includes('"upsert_store_discount_settings_with_legacy_mirror_scoped"'),
        true,
      );
      assert.equal(block.includes("p_organization_id: organizationId"), true);
      assert.equal(block.includes("p_store_id: storeId"), true);
      assert.equal(block.includes(".from(\"store_discount_settings\").insert"), false);
      assert.equal(block.includes('highValueEnabled: false'), true);
      assert.equal(block.includes('"upsert_store_high_value_discount_settings_scoped"'), false);
    },
  },
  {
    name: "step 4 exposes canonical discount controls only after explicit yes and keeps payment/commercial flow intact",
    run: () => {
      const source = readPageSource();
      const block = getSaveStep4Block(source);

      assert.equal(source.includes('value={step4Form.default_discount_percent}'), true);
      assert.equal(source.includes('value={step4Form.max_discount_percent}'), true);
      assert.equal(source.includes('checked={step4Form.allow_ask_above_max_discount}'), true);
      assert.equal(source.includes('value={step4Form.discount_autonomy_mode}'), true);
      assert.equal(source.includes("DISCOUNT_AUTONOMY_MODE_OPTIONS"), true);
      assert.equal(source.includes('step4Form.can_offer_discount === "sim"'), true);
      assert.equal(source.includes('step4Form.can_offer_discount === "não"'), true);
      assert.equal(
        block.includes('["accepted_payment_methods", step4Form.accepted_payment_methods]'),
        false,
      );
      assert.equal(
        block.includes('"upsert_store_payment_settings_with_legacy_mirror_scoped"'),
        true,
      );
      assert.equal(
        block.includes('"upsert_store_commercial_ai_settings_with_legacy_mirror_scoped"'),
        true,
      );
    },
  },
  {
    name: "step 5 uses the transactional responsible writer before other onboarding answers and before completed status",
    run: () => {
      const source = readPageSource();
      const block = getSaveStep5Block(source);

      const legacyAnswersIndex = block.indexOf('await supabase.rpc("onboarding_upsert_answer_scoped", {');
      const canonicalSyncIndex = block.indexOf(
        '"upsert_store_primary_responsible_with_legacy_mirror_scoped"',
      );
      const statusIndex = block.indexOf(
        'await supabase.rpc("onboarding_upsert_store_onboarding_scoped", {',
      );

      assert.equal(legacyAnswersIndex > -1, true);
      assert.equal(canonicalSyncIndex > -1, true);
      assert.equal(statusIndex > -1, true);
      assert.equal(canonicalSyncIndex < legacyAnswersIndex, true);
      assert.equal(canonicalSyncIndex < statusIndex, true);
      assert.equal(
        block.includes('["responsible_name", step5Form.responsible_name.trim()]'),
        false,
      );
      assert.equal(
        block.includes('["responsible_whatsapp", step5Form.responsible_whatsapp.trim()]'),
        false,
      );
    },
  },
  {
    name: "step 5 fails closed when the transactional responsible writer fails",
    run: () => {
      const source = readPageSource();
      const block = getSaveStep5Block(source);

      assert.equal(
        block.includes('throw new Error("Falha ao sincronizar o responsavel operacional principal.");'),
        true,
      );
      assert.equal(
        block.includes('"upsert_store_primary_responsible_with_legacy_mirror_scoped"'),
        true,
      );
      assert.equal(block.includes("p_name: step5Form.responsible_name.trim()"), true);
      assert.equal(
        block.includes("p_whatsapp_number: step5Form.responsible_whatsapp.trim()"),
        true,
      );
    },
  },
];

async function run() {
  for (const test of tests) {
    test.run();
  }

  console.log(`onboarding-page: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
