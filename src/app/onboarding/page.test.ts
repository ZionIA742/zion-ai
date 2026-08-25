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

const tests: TestCase[] = [
  {
    name: "step 4 uses the canonical payment writer before remaining onboarding answers and does not write accepted_payment_methods directly",
    run: () => {
      const source = readPageSource();
      const block = getSaveStep4Block(source);

      const canonicalSyncIndex = block.indexOf(
        '"upsert_store_payment_settings_with_legacy_mirror_scoped"',
      );
      const legacyAnswersIndex = block.indexOf('await supabase.rpc("onboarding_upsert_answer_scoped", {');

      assert.equal(canonicalSyncIndex > -1, true);
      assert.equal(legacyAnswersIndex > -1, true);
      assert.equal(canonicalSyncIndex < legacyAnswersIndex, true);
      assert.equal(
        block.includes('["accepted_payment_methods", step4Form.accepted_payment_methods]'),
        false,
      );
      assert.equal(
        block.includes(
          'throw new Error(\n          "Falha ao sincronizar as configuracoes canonicas de pagamento.",',
        ) || block.includes('"Falha ao sincronizar as configuracoes canonicas de pagamento."'),
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
