import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pagePath = "src/app/(app)/configuracoes/page.tsx";
const migrationPaths = [
  "supabase/migrations/20260917190000_p19a_settings_experience_policies.sql",
  "supabase/migrations/20260917203000_p19a_settings_experience_writer_conflict_fix.sql",
];

const pageSource = readFileSync(pagePath, "utf8");
const migrationSource = migrationPaths
  .map((migrationPath) => readFileSync(migrationPath, "utf8"))
  .join("\n");
const migrationSourceLower = migrationSource.toLowerCase();

function blockBetween(start: string, end: string): string {
  const startIndex = pageSource.indexOf(start);
  const endIndex = pageSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, "start not found: " + start);
  assert.notEqual(endIndex, -1, "end not found: " + end);
  assert.equal(endIndex > startIndex, true);
  return pageSource.slice(startIndex, endIndex);
}

test("localStorage persists only drafts for experience cards, not saved authority", () => {
  const persistedType = blockBetween(
    "type PersistedConfiguracoesState = {",
    "type ResponsiblePersonDraft = {",
  );
  const restoreBlock = blockBetween(
    "const raw = readFromLocalStorageSafe(configDraftStorageKey);",
    "const persistConfiguracoesDraft = useCallback",
  );
  const persistBlock = blockBetween(
    "const payload: PersistedConfiguracoesState = {",
    "persistToLocalStorageSafe(configDraftStorageKey, JSON.stringify(payload));",
  );

  for (const forbidden of [
    "savedCommercialExperience",
    "savedBrandExperience",
    "savedContractExperience",
  ]) {
    assert.equal(persistedType.includes(forbidden), false);
    assert.equal(restoreBlock.includes(forbidden), false);
    assert.equal(persistBlock.includes(forbidden), false);
  }
});

test("page reads and writes canonical settings experience policies", () => {
  assert.equal(
    pageSource.includes('"read_store_settings_experience_policies_scoped"'),
    true,
  );
  assert.equal(
    pageSource.includes('"upsert_store_settings_experience_policies_scoped"'),
    true,
  );
  assert.equal(
    pageSource.includes("applySettingsExperiencePoliciesToCommercialDraft("),
    true,
  );
  assert.equal(
    pageSource.includes("applySettingsExperiencePoliciesToBrandDraft("),
    true,
  );
  assert.equal(
    pageSource.includes("applySettingsExperiencePoliciesToContractDraft("),
    true,
  );
});

test("false-success card handlers are gated by their canonical writer", () => {
  const commercialSaveBlock = blockBetween(
    "const saveCommercialExperienceCard = useCallback(async (target: string) => {",
    "const handleCommercialEditCancel = useCallback",
  );
  const commercialEditBlock = blockBetween(
    "const handleCommercialEditSave = useCallback(async () => {",
    "const handleMonthlySalesGoalSave = useCallback",
  );
  const discountBlock = blockBetween(
    "const handleDiscountEditSave = useCallback(async () => {",
    "const handleChannelDraftChange = useCallback",
  );
  const brandBlock = blockBetween(
    "const handleBrandSettingsSave = useCallback(async () => {",
    "const updateContractExperienceDraft = useCallback",
  );
  const contractBlock = blockBetween(
    "const handleContractPolicySave = useCallback(async () => {",
    "const handleCommercialWhatsappSave = useCallback",
  );

  for (const [name, block] of [
    ["commercial card", commercialSaveBlock],
    ["commercial edit", commercialEditBlock],
    ["brand", brandBlock],
    ["contract", contractBlock],
  ] as const) {
    const writerIndex = block.indexOf("upsertSettingsExperiencePolicies(");
    const successIndex = Math.max(
      block.indexOf('setSuccessText("'),
      block.indexOf("upsertConfigAnswers("),
      block.indexOf("setIsCommercialEditing(false)"),
    );

    assert.equal(
      writerIndex >= 0,
      true,
      name + " missing canonical writer",
    );
    assert.equal(
      successIndex > writerIndex,
      true,
      name + " can report success before writer",
    );
  }

  const discountWriterIndex = discountBlock.indexOf(
    '"upsert_store_discount_card_scoped"',
  );
  const discountSuccessIndex = Math.max(
    discountBlock.indexOf('setSuccessText("'),
    discountBlock.indexOf("setIsDiscountEditing(false)"),
  );

  assert.equal(
    discountWriterIndex >= 0,
    true,
    "discount missing atomic canonical writer",
  );
  assert.equal(
    discountSuccessIndex > discountWriterIndex,
    true,
    "discount can report success before atomic writer",
  );
  assert.equal(
    discountBlock.includes("upsertSettingsExperiencePolicies("),
    false,
  );
  assert.equal(
    discountBlock.includes("upsertConfigAnswers("),
    false,
  );
});
test("discount high-value approval converts canonical boolean to UI choice", () => {
  const block = blockBetween(
    "function applySettingsExperiencePoliciesToCommercialDraft(",
    "function applySettingsExperiencePoliciesToBrandDraft(",
  );

  assert.equal(
    block.includes(
      "const highValueRequiresHuman =",
    ),
    true,
  );

  assert.equal(
    block.includes(
      'typeof highValueRequiresHuman === "boolean"',
    ),
    true,
  );

  assert.equal(
    block.includes(
      'highValueRequiresHuman ? "Sim" : "Não"',
    ),
    true,
  );

  assert.equal(
    block.includes(
      "nextDraft.high_value_requires_human",
    ),
    true,
  );
});
test("quote policy clears hidden dependent fields and uses canonical completeness", () => {
  const updateBlock = blockBetween(
    "const updateCommercialExperienceDraft = useCallback",
    "const toggleCommercialExperienceArrayValue = useCallback",
  );

  for (const required of [
    'key === "quote_validity"',
    'next.quote_validity_other_days = ""',
    'key === "quote_customer_note_enabled"',
    'next.quote_customer_note = ""',
    'key === "quote_internal_note_enabled"',
    'next.quote_internal_note = ""',
  ]) {
    assert.equal(
      updateBlock.includes(required),
      true,
      "missing quote dependent cleanup " + required,
    );
  }

  const normalizedBlock = blockBetween(
    "const normalizedCommercialExperience =",
    "const nextStrategyInput =",
  );

  assert.equal(
    normalizedBlock.includes('target === "quote"'),
    true,
  );
  assert.equal(
    normalizedBlock.includes(
      'commercialExperienceDraft.quote_validity === "outro"',
    ),
    true,
  );
  assert.equal(
    normalizedBlock.includes(
      'commercialExperienceDraft.quote_customer_note_enabled === "Sim"',
    ),
    true,
  );
  assert.equal(
    normalizedBlock.includes(
      'commercialExperienceDraft.quote_internal_note_enabled === "Sim"',
    ),
    true,
  );

  const configuredBlock = blockBetween(
    "const quoteCardConfigured = useMemo",
    "const discountCardConfigured = useMemo",
  );

  for (const required of [
    "quote_validity_other_days",
    "quote_customer_note",
    "quote_internal_note",
    "quote_preliminary_before_visit",
    "quote_definitive_requires_visit_result",
  ]) {
    assert.equal(
      configuredBlock.includes(required),
      true,
      "missing quote completeness dependency " + required,
    );
  }

  const cardBlock = blockBetween(
    'title="Orçamento"',
    'title="Pós-venda"',
  );

  assert.equal(
    cardBlock.includes(
      'tone={quoteCardConfigured ? "blue" : "yellow"}',
    ),
    true,
  );
  assert.equal(
    cardBlock.includes(
      'status={quoteCardConfigured ? "Completo" : "Precisa de atenção"}',
    ),
    true,
  );
});
test("post-sale policy requires base fields, clears hidden values and uses canonical completeness", () => {
  const saveBlock = blockBetween(
    'if (target === "post_sale") {',
    'if (target === "warranty") {',
  );

  for (const required of [
    "durationConfigured",
    "startConfigured",
    "checksConfigured",
    "POST_SALE_CHECK_OPTIONS",
    "post_sale_duration_other_days",
    "post_sale_start_other",
    "post_sale_checks_other",
  ]) {
    assert.equal(
      saveBlock.includes(required),
      true,
      "missing post-sale save validation " + required,
    );
  }

  const normalizedBlock = blockBetween(
    "const normalizedCommercialExperience =",
    "const nextStrategyInput =",
  );

  assert.equal(
    normalizedBlock.includes('target === "post_sale"'),
    true,
  );
  assert.equal(
    normalizedBlock.includes(
      'commercialExperienceDraft.post_sale_duration === "outro"',
    ),
    true,
  );
  assert.equal(
    normalizedBlock.includes(
      'commercialExperienceDraft.post_sale_start === "depende"',
    ),
    true,
  );
  assert.equal(
    normalizedBlock.includes(
      'commercialExperienceDraft.post_sale_checks.includes("outro")',
    ),
    true,
  );

  const configuredBlock = blockBetween(
    "const postSaleCardConfigured = useMemo",
    "const quoteCardConfigured = useMemo",
  );

  for (const required of [
    "durationConfigured",
    "startConfigured",
    "checksConfigured",
    "POST_SALE_CHECK_OPTIONS",
    "post_sale_duration_other_days",
    "post_sale_start_other",
    "post_sale_checks_other",
  ]) {
    assert.equal(
      configuredBlock.includes(required),
      true,
      "missing post-sale completeness dependency " + required,
    );
  }

  const cardBlock = blockBetween(
    'title="Pós-venda"',
    'title="Garantia"',
  );

  assert.equal(
    cardBlock.includes(
      'tone={postSaleCardConfigured ? "blue" : "yellow"}',
    ),
    true,
  );
  assert.equal(
    cardBlock.includes(
      'status={postSaleCardConfigured ? "Completo" : "Precisa de atenção"}',
    ),
    true,
  );
});
test("warranty policy requires complete applicable rules, normalizes hidden values and uses canonical completeness", () => {
  const saveBlock = blockBetween(
    'if (target === "warranty") {',
    'if (target === "cancellation") {',
  );

  for (const required of [
    "modeConfigured",
    "extraRuleConfigured",
    "itemsConfigured",
    "startConfigured",
    "durationConfigured",
    "conditionsConfigured",
    "WARRANTY_ITEM_OPTIONS",
  ]) {
    assert.equal(
      saveBlock.includes(required),
      true,
      "missing warranty save validation " + required,
    );
  }

  const normalizedBlock = blockBetween(
    "const normalizedCommercialExperience =",
    "const nextStrategyInput =",
  );

  for (const required of [
    'target === "warranty"',
    'warrantyMode === "depende"',
    'warrantyItems.includes("outro")',
    'warrantyStart === "outro"',
    'warrantyConditionsEnabled === "Sim"',
    'warranty_items:',
    'hasOwnWarranty',
    'warranty_duration_value:',
    'warranty_duration_unit:',
    'warranty_conditions:',
  ]) {
    assert.equal(
      normalizedBlock.includes(required),
      true,
      "missing warranty normalization " + required,
    );
  }

  const configuredBlock = blockBetween(
    "const warrantyCardConfigured = useMemo",
    "const postSaleCardConfigured = useMemo",
  );

  for (const required of [
    'warrantyMode === "Não"',
    "extraRuleConfigured",
    "itemsConfigured",
    "startConfigured",
    "durationConfigured",
    "conditionsConfigured",
    "WARRANTY_ITEM_OPTIONS",
  ]) {
    assert.equal(
      configuredBlock.includes(required),
      true,
      "missing warranty completeness dependency " + required,
    );
  }

  const cardBlock = blockBetween(
    'title="Garantia"',
    'title="Cancelamento, rescisão e reembolso"',
  );

  assert.equal(
    cardBlock.includes(
      'tone={warrantyCardConfigured ? "blue" : "yellow"}',
    ),
    true,
  );

  assert.equal(
    cardBlock.includes(
      'status={warrantyCardConfigured ? "Completo" : "Precisa de atenção"}',
    ),
    true,
  );
});
test("migration defines scoped canonical table, reader and writer", () => {
  for (const required of [
    "create table if not exists public.store_settings_experience_policies",
    "foreign key (store_id, organization_id)",
    "create policy store_settings_experience_policies_select_by_active_membership",
    "grant execute",
    "to authenticated",
  ]) {
    assert.equal(
      migrationSourceLower.includes(required.toLowerCase()),
      true,
      "missing " + required,
    );
  }

  for (const functionName of [
    "read_store_settings_experience_policies_scoped",
    "upsert_store_settings_experience_policies_scoped",
  ]) {
    const functionDefinition = new RegExp(
      String.raw`create(?:\s+or\s+replace)?\s+function\s+public\.${functionName}\s*\(`,
      "i",
    );

    assert.equal(
      functionDefinition.test(migrationSource),
      true,
      "missing function definition " + functionName,
    );
  }
});

test("cancellation policy requires valid choice and rules, normalizes hidden values and uses canonical completeness", () => {
  const saveBlock = blockBetween(
    'if (target === "cancellation") {',
    "if (validationError) {",
  );

  for (const required of [
    "modeConfigured",
    "normalizeCancellationSituations",
    "rawSituations.length === situations.length",
    'situations.includes("after_contract")',
    'situations.includes("ordered_product")',
    'situations.includes("custom_order")',
    'situations.includes("after_delivery")',
    'situations.includes("service_started")',
    'situations.includes("charge_or_retention")',
    'situations.includes("refund")',
    'situations.includes("other")',
  ]) {
    assert.equal(
      saveBlock.includes(required),
      true,
      "missing cancellation save validation " + required,
    );
  }

  const normalizedBlock = blockBetween(
    "const normalizedCommercialExperience =",
    "const nextStrategyInput =",
  );

  for (const required of [
    'target === "cancellation"',
    "normalizeCancellationSituations",
    "cancellation_rule_situations: situations",
    'situations.includes("after_contract")',
    'situations.includes("ordered_product")',
    'situations.includes("custom_order")',
    'situations.includes("after_delivery")',
    'situations.includes("service_started")',
    'situations.includes("charge_or_retention")',
    'situations.includes("refund")',
    'situations.includes("other")',
  ]) {
    assert.equal(
      normalizedBlock.includes(required),
      true,
      "missing cancellation normalization " + required,
    );
  }

  const helperBlock = blockBetween(
    "function normalizeCancellationSituations",
    "const CONTRACT_APPLICABILITY_CASE_OPTIONS",
  );

  for (const required of [
    "CANCELLATION_RULE_SITUATION_OPTIONS.some",
    "function isCancellationPolicyComplete",
    'policyMode === "Não"',
    'policyMode !== "Sim"',
    "rawSituations.length !== situations.length",
    "cancellationRuleTextForSituation",
  ]) {
    assert.equal(
      helperBlock.includes(required),
      true,
      "missing cancellation completeness dependency " + required,
    );
  }

  const cardBlock = blockBetween(
    'title="Cancelamento, rescisão e reembolso"',
    "</SectionBlock>",
  );

  assert.equal(
    cardBlock.includes(
      'tone={isCancellationPolicyComplete(savedCommercialExperience) ? "blue" : "yellow"}',
    ),
    true,
  );

  assert.equal(
    cardBlock.includes(
      'status={isCancellationPolicyComplete(savedCommercialExperience) ? "Completo" : "Precisa de atenção"}',
    ),
    true,
  );

  assert.equal(
    cardBlock.includes(
      "setCommercialExperienceDraft(savedCommercialExperience)",
    ),
    true,
    "cancellation cancel must restore saved canonical draft",
  );

  assert.equal(
    pageSource.includes(
      "p_cancellation_policy: patch.cancellation_policy ?? null",
    ),
    true,
    "cancellation must keep routing through canonical policy writer",
  );

  const legacyKeys = [
    "cancellation_after_contract" + "_enabled",
    "cancellation_ordered_product" + "_enabled",
    "cancellation_custom_order" + "_enabled",
    "cancellation_after_delivery" + "_enabled",
    "cancellation_service_started" + "_enabled",
    "cancellation_charge_or_retention" + "_enabled",
    "cancellation_refund_rule" + "_enabled",
    "cancellation_policy_other" + "_enabled",
  ];

  for (const legacyKey of legacyKeys) {
    assert.equal(
      pageSource.includes('"' + legacyKey + '"'),
      false,
      "legacy cancellation policy key still bound: " + legacyKey,
    );

    assert.equal(
      pageSource.includes(legacyKey + ": string;"),
      false,
      "legacy cancellation state field still exists: " + legacyKey,
    );
  }
});

test("brand completeness is derived from raw canonical policy", () => {
  const completenessBlock = blockBetween(
    "const savedBrandVisualPolicy = readRecord(",
    "const displayedLogoFileName =",
  );

  assert.equal(
    completenessBlock.includes(
      "settingsExperiencePolicies?.brand_visual_policy",
    ),
    true,
    "brand completeness must read raw canonical brand_visual_policy",
  );

  assert.equal(
    completenessBlock.includes("savedBrandUseLogoOnQuotes"),
    true,
  );

  assert.equal(
    completenessBlock.includes("savedBrandUseLogoOnContracts"),
    true,
  );

  assert.equal(
    completenessBlock.includes(
      "brandVisualColorPattern.test(savedBrandPrimaryColor)",
    ),
    true,
    "brand completeness must require a valid canonical primary color",
  );

  assert.equal(
    completenessBlock.includes(
      "brandVisualColorPattern.test(savedBrandSecondaryColor)",
    ),
    true,
    "brand completeness must validate a configured secondary color",
  );

  assert.equal(
    completenessBlock.includes(
      "(!savedBrandUsesLogo || hasStoredLogo)",
    ),
    true,
    "brand completeness must require physical logo only when canonical policy uses it",
  );

  assert.equal(
    completenessBlock.includes("savedBrandExperience"),
    false,
    "brand completeness must not infer configured state from UI defaults",
  );

  assert.equal(
    pageSource.includes(
      'tone={isBrandIdentityComplete ? "blue" : "yellow"}',
    ),
    true,
    "brand card tone must use canonical completeness",
  );

  assert.equal(
    pageSource.includes(
      'status={isBrandIdentityComplete ? "Completo" : "Precisa de atenção"}',
    ),
    true,
    "brand card status must use canonical completeness",
  );
});

test("brand save rejects logo usage without stored or newly selected logo", () => {
  const brandBlock = blockBetween(
    "const handleBrandSettingsSave = useCallback(async () => {",
    "const updateContractExperienceDraft = useCallback",
  );

  const dependencyValidationIndex =
    brandBlock.indexOf("wantsLogoInGeneratedDocuments &&");

  const storedLogoGuardIndex =
    brandBlock.indexOf("!hasStoredLogo", dependencyValidationIndex);

  const selectedLogoGuardIndex =
    brandBlock.indexOf("!selectedStoreLogoFile", dependencyValidationIndex);

  const logoUploadIndex =
    brandBlock.indexOf("handleSaveStoreLogo()", dependencyValidationIndex);

  const canonicalWriterIndex =
    brandBlock.indexOf(
      "upsertSettingsExperiencePolicies(",
      dependencyValidationIndex,
    );

  assert.equal(
    dependencyValidationIndex >= 0,
    true,
    "brand save missing logo dependency validation",
  );

  assert.equal(
    storedLogoGuardIndex > dependencyValidationIndex,
    true,
    "brand save must consider an already stored logo",
  );

  assert.equal(
    selectedLogoGuardIndex > dependencyValidationIndex,
    true,
    "brand save must consider a newly selected logo",
  );

  assert.equal(
    logoUploadIndex > selectedLogoGuardIndex,
    true,
    "logo dependency validation must happen before upload",
  );

  assert.equal(
    canonicalWriterIndex > logoUploadIndex,
    true,
    "canonical brand policy writer must run only after logo validation/upload",
  );

  assert.equal(
    brandBlock.includes(
      "[brandExperienceDraft, handleSaveStoreLogo, hasStoredLogo, selectedStoreLogoFile, upsertSettingsExperiencePolicies]",
    ),
    true,
    "brand save callback must react to stored-logo state",
  );
});
test("settings experience writer unwraps exactly one RPC row", () => {
  const writerBlock = blockBetween(
    "const upsertSettingsExperiencePolicies = useCallback(async (",
    "const saveCommercialExperienceCard = useCallback",
  );

  assert.equal(
    writerBlock.includes("const returnedPolicies = Array.isArray(data)"),
    true,
    "writer must normalize RETURNS TABLE RPC data as rows",
  );

  assert.equal(
    writerBlock.includes("returnedPolicies.length !== 1"),
    true,
    "writer must fail closed unless exactly one canonical row is returned",
  );

  assert.equal(
    writerBlock.includes(
      "returnedPolicies[0] as StoreSettingsExperiencePoliciesRow",
    ),
    true,
    "writer must unwrap the single canonical row",
  );

  assert.equal(
    writerBlock.includes(
      "(data ?? null) as StoreSettingsExperiencePoliciesRow | null",
    ),
    false,
    "writer must not cast RETURNS TABLE RPC data directly as one object",
  );

  const unwrapIndex = writerBlock.indexOf("returnedPolicies[0]");
  const stateIndex = writerBlock.indexOf(
    "setSettingsExperiencePolicies(nextPolicies)",
  );

  assert.equal(
    unwrapIndex >= 0 && stateIndex > unwrapIndex,
    true,
    "UI state must receive the unwrapped canonical row",
  );
});
test("contract usage policy normalizes hidden fields and uses canonical completeness", () => {
  const normalizeBlock = blockBetween(
    "function normalizeContractUsageDraft(",
    "function isContractUsagePolicyComplete(",
  );

  assert.equal(
    normalizeBlock.includes('if (draft.enabled === "Não")'),
    true,
    "disabled contract usage must clear dependent fields",
  );

  assert.equal(
    normalizeBlock.includes('applicabilityMode === "depende"'),
    true,
    "applicability cases must only survive depende mode",
  );

  assert.equal(
    normalizeBlock.includes('validApplicabilityCases.has(value)'),
    true,
    "invalid applicability cases must be removed",
  );

  assert.equal(
    normalizeBlock.includes('applicabilityCases.includes("alto_valor")'),
    true,
    "high-value amount must only survive when alto_valor applies",
  );

  assert.equal(
    normalizeBlock.includes('signedBefore.includes("outro")'),
    true,
    "other signed-before detail must only survive when outro applies",
  );

  const completenessBlock = blockBetween(
    "function isContractUsagePolicyComplete(",
    "function buildCommercialExperiencePolicyPatch(",
  );

  assert.equal(
    completenessBlock.includes('draft.enabled === "Não"'),
    true,
    "canonical disabled policy must have explicit completeness semantics",
  );

  assert.equal(
    completenessBlock.includes(
      '["sempre", "depende", "opcional"].includes(draft.applicability_mode)',
    ),
    true,
    "canonical applicability mode must be validated semantically",
  );

  assert.equal(
    completenessBlock.includes(
      'draft.applicability_cases.includes("alto_valor") !==',
    ),
    true,
    "canonical completeness must reject inconsistent high-value dependency",
  );

  assert.equal(
    completenessBlock.includes(
      'draft.signed_before.includes("outro") !==',
    ),
    true,
    "canonical completeness must reject inconsistent other signed-before dependency",
  );

  const saveBlock = blockBetween(
    "const handleContractPolicySave = useCallback(async () => {",
    "useEffect(() => {",
  );

  assert.equal(
    saveBlock.includes(
      "const draft = normalizeContractUsageDraft(contractExperienceDraft)",
    ),
    true,
    "save must normalize contract usage before canonical persistence",
  );

  assert.equal(
    saveBlock.includes(
      "contract_usage_policy: pickDraftFields(draft, CONTRACT_EXPERIENCE_KEYS)",
    ),
    true,
    "canonical writer must receive the normalized contract usage policy",
  );

  const cardBlock = blockBetween(
    'title="Uso do contrato"',
    'title="Contrato padrão da loja"',
  );

  assert.equal(
    cardBlock.includes(
      "isContractUsagePolicyComplete(readRecord(settingsExperiencePolicies?.contract_usage_policy))",
    ),
    true,
    "card completeness must come from the raw canonical contract usage policy",
  );

  assert.equal(
    cardBlock.includes(
      'savedContractExperience.enabled === "Não" ? "Não se aplica" : "Não definido"',
    ),
    true,
    "summary must distinguish explicit Não from not configured",
  );
});