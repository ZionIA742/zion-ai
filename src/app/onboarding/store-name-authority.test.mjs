import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const onboardingPath = join(process.cwd(), "src/app/onboarding/page.tsx");
const configPath = join(process.cwd(), "src/app/(app)/configuracoes/page.tsx");

const onboarding = readFileSync(onboardingPath, "utf8");
const config = readFileSync(configPath, "utf8");

const onboardingLoadStart = onboarding.indexOf(
  "  const loadBaseData = useCallback(async () => {",
);
assert.equal(onboardingLoadStart > -1, true, "onboarding loadBaseData not found");

const onboardingLoadEnd = onboarding.indexOf(
  "  }, [organizationId, activeStore?.id, activeStore?.name]);",
  onboardingLoadStart,
);
assert.equal(
  onboardingLoadEnd > onboardingLoadStart,
  true,
  "onboarding loadBaseData end not found",
);

const onboardingLoadBlock = onboarding.slice(
  onboardingLoadStart,
  onboardingLoadEnd,
);

assert.equal(
  onboardingLoadBlock.includes(
    "current.store_display_name || cleanText(activeStore.name)",
  ),
  true,
  "onboarding must hydrate official store name from activeStore.name",
);

assert.equal(
  onboardingLoadBlock.includes(
    "cleanText(nextAnswers.store_display_name) || cleanText(activeStore.name)",
  ),
  false,
  "onboarding must not prefer legacy store_display_name over stores.name",
);

const overviewEffectStart = config.indexOf(
  "const currentOperationInput = createStoreOperationSettingsInputFromSources({",
);
assert.equal(overviewEffectStart > -1, true, "overview draft effect not found");

const overviewEffectEnd = config.indexOf(
  "setSelectedStoreLogoFile(null);",
  overviewEffectStart,
);
assert.equal(
  overviewEffectEnd > overviewEffectStart,
  true,
  "overview draft effect end not found",
);

const overviewEffectBlock = config.slice(
  overviewEffectStart,
  overviewEffectEnd,
);

assert.equal(
  overviewEffectBlock.includes(
    "store_display_name: cleanText(answers.store_display_name) || storeName",
  ),
  false,
  "Configuracoes overview must not hydrate official store name from legacy answers",
);

const cancelStart = config.indexOf(
  "  const handleOverviewEditCancel = useCallback(() => {",
);
assert.equal(cancelStart > -1, true, "handleOverviewEditCancel not found");

const cancelEnd = config.indexOf(
  "  const handleOverviewEditSave = useCallback",
  cancelStart,
);
assert.equal(cancelEnd > cancelStart, true, "handleOverviewEditCancel end not found");

const cancelBlock = config.slice(cancelStart, cancelEnd);

assert.equal(
  cancelBlock.includes(
    "store_display_name: cleanText(answers.store_display_name) || storeName",
  ),
  false,
  "Configuracoes cancel must restore official store name from canonical storeName",
);

const identityStart = config.indexOf("  const identityItems = useMemo(() => {");
assert.equal(identityStart > -1, true, "identityItems not found");

const identityEnd = config.indexOf(
  "  const overviewSummary = useMemo(() => {",
  identityStart,
);
assert.equal(identityEnd > identityStart, true, "identityItems end not found");

const identityBlock = config.slice(identityStart, identityEnd);

assert.equal(
  identityBlock.includes(
    '{ label: "Nome da loja", value: cleanText(answers.store_display_name) || storeName }',
  ),
  false,
  "official store name summary must not prefer legacy answer",
);

assert.equal(
  identityBlock.includes(
    '{ label: "Dados usados em orçamento e contrato", value: cleanText(answers.store_display_name) || storeName }',
  ),
  false,
  "quote/contract store name must not prefer legacy answer",
);

/*
 * Intentionally preserve the separate AI-identity semantics for now.
 * P19-A 3.5 must not silently redesign the later Sales AI behavior work.
 */
assert.equal(
  config.includes("ai_display_name: cleanText(answers.store_display_name)"),
  true,
  "AI display-name legacy behavior must remain untouched in this fix",
);

console.log("store name canonical authority: 1 test passed");
