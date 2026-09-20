import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pagePath = join(process.cwd(), "src/app/onboarding/page.tsx");
const source = readFileSync(pagePath, "utf8");

const loadStart = source.indexOf("  const loadBaseData = useCallback(async () => {");
assert.equal(loadStart > -1, true, "loadBaseData not found");

const loadEnd = source.indexOf(
  "  }, [organizationId, activeStore?.id, activeStore?.name]);",
  loadStart,
);
assert.equal(loadEnd > loadStart, true, "loadBaseData end not found");

const loadBlock = source.slice(loadStart, loadEnd);

assert.equal(
  loadBlock.includes('fetch("/api/store/primary-responsible"'),
  true,
  "onboarding must read the canonical primary responsible",
);

assert.equal(
  loadBlock.includes("nextAnswers.responsible_name"),
  false,
  "onboarding must not fallback to legacy responsible_name",
);

assert.equal(
  loadBlock.includes("nextAnswers.responsible_whatsapp"),
  false,
  "onboarding must not fallback to legacy responsible_whatsapp",
);

const saveStart = source.indexOf("  async function saveStep3(event: FormEvent) {");
assert.equal(saveStart > -1, true, "saveStep3 not found");

const saveEnd = source.indexOf("  const whatsappConnected = useMemo(() => {", saveStart);
assert.equal(saveEnd > saveStart, true, "saveStep3 end not found");

const saveBlock = source.slice(saveStart, saveEnd);

assert.equal(
  saveBlock.includes('"upsert_store_primary_responsible_with_legacy_mirror_scoped"'),
  true,
  "onboarding must save the primary responsible through the canonical writer",
);

console.log("onboarding responsible authority: 1 test passed");
