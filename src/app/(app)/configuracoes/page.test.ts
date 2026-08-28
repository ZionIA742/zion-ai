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

function getCommercialSaveBlock(source: string) {
  const start = source.indexOf("  const handleCommercialEditSave = useCallback(async () => {");
  assert.equal(start > -1, true, "handleCommercialEditSave not found");
  const end = source.indexOf("  }, [", start);
  assert.equal(end > start, true, "handleCommercialEditSave end not found");
  return source.slice(start, end);
}

function getChannelsSaveBlock(source: string) {
  const start = source.indexOf("  const handleChannelsEditSave = useCallback(async () => {");
  assert.equal(start > -1, true, "handleChannelsEditSave not found");
  const end = source.indexOf("  }, [", start);
  assert.equal(end > start, true, "handleChannelsEditSave end not found");
  return source.slice(start, end);
}

function getCommercialPaymentItemsBlock(source: string) {
  const start = source.indexOf("  const commercialPaymentItems = useMemo(() => {");
  assert.equal(start > -1, true, "commercialPaymentItems block not found");
  const end = source.indexOf("  const commercialNegotiationItems = useMemo(() => {", start);
  assert.equal(end > start, true, "commercialPaymentItems end not found");
  return source.slice(start, end);
}

function getFetchPageDataBlock(source: string) {
  const start = source.indexOf("  const fetchPageData = useCallback(async () => {");
  assert.equal(start > -1, true, "fetchPageData not found");
  const end = source.indexOf("  const upsertConfigAnswers = useCallback(", start);
  assert.equal(end > start, true, "fetchPageData end not found");
  return source.slice(start, end);
}

function getChannelsTabBlock(source: string) {
  const start = source.indexOf('{activeTab === "canais-integracoes" ? (');
  assert.equal(start > -1, true, "channels tab not found");
  const end = source.indexOf('{activeTab === "contratos" ? (', start);
  assert.equal(end > start, true, "channels tab end not found");
  return source.slice(start, end);
}

function getCreateDiscountDraftFromAnswersBlock(source: string) {
  const start = source.indexOf("function createDiscountDraftFromAnswers(");
  assert.equal(start > -1, true, "createDiscountDraftFromAnswers not found");
  const end = source.indexOf("function createChannelDraftFromSources(", start);
  assert.equal(end > start, true, "createDiscountDraftFromAnswers end not found");
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
      assert.equal(block.includes('salvas com sucesso."'), true);
    },
  },
  {
    name: "commercial editor uses the canonical payment writer before shared legacy answer sync and keeps summary derived",
    run: () => {
      const source = readPageSource();
      const block = getCommercialSaveBlock(source);

      const canonicalSyncIndex = block.indexOf(
        '"upsert_store_payment_settings_with_legacy_mirror_scoped"',
      );
      const sharedLegacySyncIndex = block.indexOf("const saved = await upsertConfigAnswers(");

      assert.equal(canonicalSyncIndex > -1, true);
      assert.equal(sharedLegacySyncIndex > -1, true);
      assert.equal(canonicalSyncIndex < sharedLegacySyncIndex, true);
      assert.equal(
        block.includes("const derivedPaymentSummary = deriveStorePaymentSettingsSummary("),
        true,
      );
      assert.equal(
        block.includes("accepted_payment_methods_summary: derivedPaymentSummary"),
        true,
      );
    },
  },
  {
    name: "commercial payment read-only view uses shared payment presentation helper and surfaces legacy tags outside the canonical summary",
    run: () => {
      const source = readPageSource();
      const block = getCommercialPaymentItemsBlock(source);

      assert.equal(
        block.includes("createStorePaymentPresentationFromSources({"),
        true,
      );
      assert.equal(block.includes("settings: paymentSettings"), true);
      assert.equal(
        block.includes("joinSelectedLabels(parseArrayAnswer(answers.accepted_payment_methods)"),
        false,
      );
      assert.equal(
        block.includes('label: "Dados antigos para revisar"'),
        true,
      );
    },
  },
  {
    name: "commercial edit form keeps only canonical payment buttons and shows legacy condition tags as read-only review data",
    run: () => {
      const source = readPageSource();

      assert.equal(
        source.includes("{PAYMENT_METHOD_MAIN_OPTIONS.map((option) => {"),
        true,
      );
      assert.equal(
        source.includes("{PAYMENT_METHOD_CONDITION_OPTIONS.map((option) => {"),
        false,
      );
      assert.equal(
        source.includes("legacy_payment_condition_tags.length > 0"),
        true,
      );
      assert.equal(
        source.includes("Dados antigos para revisar:"),
        true,
      );
    },
  },
  {
    name: "simple page load reads canonical payment settings but does not call any payment writer",
    run: () => {
      const source = readPageSource();
      const block = getFetchPageDataBlock(source);

      assert.equal(block.includes('.from("store_payment_settings")'), true);
      assert.equal(
        block.includes("upsert_store_payment_settings_with_legacy_mirror_scoped"),
        false,
      );
      assert.equal(
        block.includes("upsert_store_payment_settings_scoped"),
        false,
      );
    },
  },
  {
    name: "simple page load reads canonical channel settings but does not call any channel writer",
    run: () => {
      const source = readPageSource();
      const block = getFetchPageDataBlock(source);

      assert.equal(block.includes('.from("store_channel_settings")'), true);
      assert.equal(
        block.includes("upsert_store_channel_settings_with_legacy_mirror_scoped"),
        false,
      );
      assert.equal(
        block.includes("upsert_store_channel_settings_scoped"),
        false,
      );
    },
  },
  {
    name: "channels editor saves only the canonical channel writer payload and leaves bloco 5 data out of this save path",
    run: () => {
      const source = readPageSource();
      const block = getChannelsSaveBlock(source);

      assert.equal(block.includes("normalizeStoreChannelSettingsInput({"), true);
      assert.equal(
        block.includes('"upsert_store_channel_settings_with_legacy_mirror_scoped"'),
        true,
      );
      assert.equal(block.includes("const saved = await upsertConfigAnswers("), false);
      assert.equal(block.includes("p_commercial_channel_name:"), true);
      assert.equal(block.includes("p_commercial_receives_real_clients:"), true);
      assert.equal(block.includes("p_commercial_is_official_sales_channel:"), true);
      assert.equal(block.includes("p_commercial_channel_type:"), true);
      assert.equal(block.includes("p_commercial_entry_priority:"), true);
      assert.equal(block.includes("p_commercial_human_handoff_enabled:"), true);
      assert.equal(block.includes("p_commercial_channel_notes:"), true);
      assert.equal(block.includes("p_integration_provider_name:"), true);
      assert.equal(block.includes("p_integration_connection_mode:"), true);
      assert.equal(block.includes("p_integrations_notes:"), true);
      assert.equal(block.includes("responsible_receives_ai_alerts"), false);
      assert.equal(block.includes("responsible_receives_reports"), false);
      assert.equal(block.includes("responsible_receives_urgencies"), false);
      assert.equal(block.includes("responsible_is_primary_alert_channel"), false);
      assert.equal(block.includes("responsible_is_human_command_channel"), false);
      assert.equal(block.includes("internal_chat_enabled"), false);
      assert.equal(block.includes("internal_chat_priority"), false);
      assert.equal(block.includes("internal_chat_accepts_manual_commands"), false);
      assert.equal(block.includes("internal_chat_separate_from_inbox"), false);
      assert.equal(block.includes("assistant_alerts_route"), false);
      assert.equal(block.includes("urgency_route"), false);
      assert.equal(block.includes("reports_route"), false);
      assert.equal(block.includes("channel_fallback_rule"), false);
    },
  },
  {
    name: "channels UI keeps only the 10 canonical fields editable and leaves live and responsible fields read-only",
    run: () => {
      const source = readPageSource();
      const block = getChannelsTabBlock(source);

      assert.equal(block.includes("storeWhatsappSafeErrorText"), true);
      assert.equal(block.includes("${storeWhatsappSafeErrorText}"), true);
      assert.equal(
        block.includes("${cleanText(storeWhatsappStatus?.lastSafeError)}"),
        false,
      );
      assert.equal(
        block.includes('onChange={(e) => handleChannelDraftChange("commercial_channel_name", e.target.value)}'),
        true,
      );
      assert.equal(
        block.includes('onChange={(value) => handleChannelDraftChange("commercial_is_official_sales_channel", value)}'),
        true,
      );
      assert.equal(
        block.includes('onChange={(value) => handleChannelDraftChange("commercial_human_handoff_enabled", value)}'),
        true,
      );
      assert.equal(
        block.includes('onChange={(value) => handleChannelDraftChange("commercial_receives_real_clients", value)}'),
        true,
      );
      assert.equal(
        block.includes('onChange={(e)=>handleChannelDraftChange("commercial_channel_type", e.target.value)}'),
        true,
      );
      assert.equal(
        block.includes('onChange={(e)=>handleChannelDraftChange("commercial_entry_priority", e.target.value)}'),
        true,
      );
      assert.equal(
        block.includes('onChange={(e)=>handleChannelDraftChange("commercial_channel_notes", e.target.value)}'),
        true,
      );
      assert.equal(
        block.includes('onChange={(e) => handleChannelDraftChange("integration_provider_name", e.target.value)}'),
        true,
      );
      assert.equal(
        block.includes('onChange={(e) => handleChannelDraftChange("integration_connection_mode", e.target.value)}'),
        true,
      );
      assert.equal(
        block.includes('onChange={(e)=>handleChannelDraftChange("integrations_notes", e.target.value)}'),
        true,
      );
      assert.equal(block.includes("value={connectedCommercialWhatsapp}"), true);
      assert.equal(block.includes("value={primaryResponsibleWhatsapp}"), true);
      assert.equal(block.includes("value={primaryResponsibleChannelLabel}"), true);
      assert.equal(block.includes("value={storeWhatsappVisualStatus.label}"), true);
      assert.equal(block.includes('handleChannelDraftChange("responsible_receives_ai_alerts"'), false);
      assert.equal(block.includes('handleChannelDraftChange("responsible_receives_reports"'), false);
      assert.equal(block.includes('handleChannelDraftChange("responsible_receives_urgencies"'), false);
      assert.equal(block.includes('handleChannelDraftChange("responsible_is_primary_alert_channel"'), false);
      assert.equal(block.includes('handleChannelDraftChange("responsible_is_human_command_channel"'), false);
      assert.equal(block.includes('handleChannelDraftChange("internal_chat_enabled"'), false);
      assert.equal(block.includes('handleChannelDraftChange("internal_chat_priority"'), false);
      assert.equal(block.includes('handleChannelDraftChange("internal_chat_accepts_manual_commands"'), false);
      assert.equal(block.includes('handleChannelDraftChange("internal_chat_separate_from_inbox"'), false);
      assert.equal(block.includes('handleChannelDraftChange("assistant_alerts_route"'), false);
      assert.equal(block.includes('handleChannelDraftChange("urgency_route"'), false);
      assert.equal(block.includes('handleChannelDraftChange("reports_route"'), false);
      assert.equal(block.includes('handleChannelDraftChange("channel_fallback_rule"'), false);
      assert.equal(block.includes("Chat interno do sistema"), false);
      assert.equal(block.includes("Roteamento r"), false);
      assert.equal(block.includes("derivado da fonte viva"), true);
      assert.equal(block.includes("ficam fora desta fam"), true);
      assert.equal(block.includes("pertencem ao Bloco 5"), true);
    },
  },
  {
    name: "discount edit draft prefers structured human-help selection and only falls back to legacy fields last",
    run: () => {
      const source = readPageSource();
      const block = getCreateDiscountDraftFromAnswersBlock(source);

      assert.equal(
        block.includes("parseArrayAnswer(answers.human_help_discount_cases_selected)"),
        true,
      );
      assert.equal(
        block.includes("HUMAN_HELP_DISCOUNT_OPTIONS"),
        true,
      );
      assert.equal(
        block.includes('"",'),
        true,
      );
      assert.equal(
        block.includes("cleanText(answers.human_help_discount_cases) ||"),
        true,
      );
      assert.equal(
        block.includes("cleanText(answers.human_help_discount_cases_other)"),
        true,
      );
    },
  },
  {
    name: "discount edit draft replaces only the known legacy explanation with the safe autonomy-aware copy",
    run: () => {
      const source = readPageSource();
      const block = getCreateDiscountDraftFromAnswersBlock(source);

      assert.equal(
        block.includes('const legacyDiscountExplanation ='),
        true,
      );
      assert.equal(
        block.includes('const currentDiscountExplanation = cleanText(answers.discount_explanation);'),
        true,
      );
      assert.equal(
        block.includes('currentDiscountExplanation === legacyDiscountExplanation'),
        true,
      );
      assert.equal(
        block.includes('discount_explanation: safeDiscountExplanation'),
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
