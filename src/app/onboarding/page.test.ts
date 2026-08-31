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

function getSaveStrategySettingsPartialBlock(source: string) {
  const start = source.indexOf("  async function saveStrategySettingsPartial(");
  assert.equal(start > -1, true, "saveStrategySettingsPartial not found");
  const end = source.indexOf("  async function saveStep1(e: FormEvent) {", start);
  assert.equal(end > start, true, "saveStrategySettingsPartial end not found");
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
