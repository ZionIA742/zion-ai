import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => void;
};

const pagePath = join(process.cwd(), "src/app/(app)/configuracoes/page.tsx");

function readPageSource() {
  return readFileSync(pagePath, "utf8");
}

function getUpsertConfigAnswersBlock(source: string) {
  const start = source.indexOf("  const upsertConfigAnswers = useCallback(");
  assert.equal(start > -1, true, "upsertConfigAnswers not found");
  const end = source.indexOf("  useEffect(() => {", start);
  assert.equal(end > start, true, "upsertConfigAnswers end not found");
  return source.slice(start, end);
}

function getActivationSaveBlock(source: string) {
  const start = source.indexOf("  const handleActivationEditSave = useCallback(async () => {");
  assert.equal(start > -1, true, "handleActivationEditSave not found");
  const end = source.indexOf("  }, [", start);
  assert.equal(end > start, true, "handleActivationEditSave end not found");
  return source.slice(start, end);
}

const tests: TestCase[] = [
  {
    name: "configuracoes uses the transactional responsible writer before remaining legacy answers and before onboarding status update",
    run: () => {
      const source = readPageSource();
      const block = getUpsertConfigAnswersBlock(source);

      const legacyAnswersIndex = block.indexOf('await supabase.rpc("onboarding_upsert_answer_scoped", {');
      const canonicalSyncIndex = block.indexOf(
        '"upsert_store_primary_responsible_with_legacy_mirror_scoped"',
      );
      const onboardingStatusIndex = block.indexOf('"onboarding_upsert_store_onboarding_scoped"');

      assert.equal(legacyAnswersIndex > -1, true);
      assert.equal(canonicalSyncIndex > -1, true);
      assert.equal(onboardingStatusIndex > -1, true);
      assert.equal(canonicalSyncIndex < legacyAnswersIndex, true);
      assert.equal(canonicalSyncIndex < onboardingStatusIndex, true);
      assert.equal(
        block.includes(
          'Object.prototype.hasOwnProperty.call(entries, "responsible_name") ||',
        ),
        true,
      );
      assert.equal(
        block.includes('Object.prototype.hasOwnProperty.call(entries, "responsible_whatsapp")'),
        true,
      );
      assert.equal(
        block.includes('questionKey !== "responsible_name" &&'),
        true,
      );
      assert.equal(
        block.includes('questionKey !== "responsible_whatsapp"'),
        true,
      );
    },
  },
  {
    name: "configuracoes fails closed on missing responsible identity during transactional sync",
    run: () => {
      const source = readPageSource();
      const block = getUpsertConfigAnswersBlock(source);

      assert.equal(
        block.includes(
          '"Nome e WhatsApp do responsavel principal sao obrigatorios para sincronizar a configuracao."',
        ),
        true,
      );
      assert.equal(
        block.includes('"upsert_store_primary_responsible_with_legacy_mirror_scoped"'),
        true,
      );
      assert.equal(block.includes("p_name: responsibleName"), true);
      assert.equal(block.includes("p_whatsapp_number: responsibleWhatsapp"), true);
    },
  },
  {
    name: "activation editor still saves the primary responsible fields through the shared canonical sync path",
    run: () => {
      const source = readPageSource();
      const block = getActivationSaveBlock(source);

      assert.equal(
        block.includes("responsible_name: cleanText(primaryResponsibleDraft.name)"),
        true,
      );
      assert.equal(
        block.includes("responsible_whatsapp: cleanText(primaryResponsibleDraft.whatsapp)"),
        true,
      );
      assert.equal(
        block.includes('"Alterações de responsável e ativação salvas com sucesso."'),
        true,
      );
    },
  },
];

async function run() {
  for (const test of tests) {
    test.run();
  }

  console.log(`configuracoes-page: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
