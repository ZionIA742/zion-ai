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

function getDiscountSaveBlock(source: string) {
  const start = source.indexOf("  const handleDiscountEditSave = useCallback(async () => {");
  assert.equal(start > -1, true, "handleDiscountEditSave not found");
  const end = source.indexOf("  }, [", start);
  assert.equal(end > start, true, "handleDiscountEditSave end not found");
  return source.slice(start, end);
}

function getOperationSaveBlock(source: string) {
  const start = source.indexOf("  const handleOperationEditSave = useCallback(async () => {");
  assert.equal(start > -1, true, "handleOperationEditSave not found");
  const end = source.indexOf("  }, [", start);
  assert.equal(end > start, true, "handleOperationEditSave end not found");
  return source.slice(start, end);
}

function getOperationDraftChangeBlock(source: string) {
  const start = source.indexOf("  const handleOperationDraftChange = useCallback((key: keyof OperationDraftState, value: string) => {");
  assert.equal(start > -1, true, "handleOperationDraftChange not found");
  const end = source.indexOf("  const handleOperationTechnicalVisitRuleToggle = useCallback(", start);
  assert.equal(end > start, true, "handleOperationDraftChange end not found");
  return source.slice(start, end);
}

function getOperationEditFormBlock(source: string) {
  const start = source.indexOf('{isOperationEditing ? (');
  assert.equal(start > -1, true, "operation edit form not found");
  const end = source.indexOf('<div className="mt-4 grid gap-4 lg:grid-cols-2">', start);
  assert.equal(end > start, true, "operation edit form end not found");
  return source.slice(start, end);
}

function getOperationDraftStateBlock(source: string) {
  const start = source.indexOf("type OperationDraftState = {");
  assert.equal(start > -1, true, "OperationDraftState not found");
  const end = source.indexOf("type ScheduleSettingsRow = {", start);
  assert.equal(end > start, true, "OperationDraftState end not found");
  return source.slice(start, end);
}

function getCreateOperationDraftFromAnswersBlock(source: string) {
  const start = source.indexOf("function createOperationDraftFromAnswers(");
  assert.equal(start > -1, true, "createOperationDraftFromAnswers not found");
  const end = source.indexOf("function createCommercialDraftFromAnswers(", start);
  assert.equal(end > start, true, "createOperationDraftFromAnswers end not found");
  return source.slice(start, end);
}

function getOperationScheduleSelectionBlock(source: string) {
  const start = source.indexOf("  const installationDaysSelected = useMemo(");
  assert.equal(start > -1, true, "installationDaysSelected block not found");
  const end = source.indexOf("  const operationSettingsInput = useMemo(", start);
  assert.equal(end > start, true, "operation schedule selection block end not found");
  return source.slice(start, end);
}

function getOperationReadinessMetricsBlock(source: string) {
  const start = source.indexOf("  const operationReadinessMetrics = useMemo(() => {");
  assert.equal(start > -1, true, "operationReadinessMetrics not found");
  const end = source.indexOf("  const operationSections = useMemo(() => {", start);
  assert.equal(end > start, true, "operationReadinessMetrics end not found");
  return source.slice(start, end);
}

function getOperationSectionsBlock(source: string) {
  const start = source.indexOf("  const operationSections = useMemo(() => {");
  assert.equal(start > -1, true, "operationSections not found");
  const end = source.indexOf("  const commercialIdentityItems = useMemo(() => {", start);
  assert.equal(end > start, true, "operationSections end not found");
  return source.slice(start, end);
}

function getOverviewStatusCardsBlock(source: string) {
  const start = source.indexOf('<StatusCard\n              label="Agenda"');
  assert.equal(start > -1, true, "overview Agenda StatusCard not found");
  const end = source.indexOf("            />", start);
  assert.equal(end > start, true, "overview Agenda StatusCard end not found");
  return source.slice(start, end + "            />".length);
}

function getRestoreLocalDraftBlock(source: string) {
  const start = source.indexOf("const raw = readFromLocalStorageSafe(configDraftStorageKey);");
  assert.equal(start > -1, true, "restore local draft effect not found");
  const end = source.indexOf("  const persistConfiguracoesDraft = useCallback(", start);
  assert.equal(end > start, true, "restore local draft effect end not found");
  return source.slice(start, end);
}

function getCreateCommercialDraftFromAnswersBlock(source: string) {
  const start = source.indexOf("function createCommercialDraftFromAnswers(");
  assert.equal(start > -1, true, "createCommercialDraftFromAnswers not found");
  const end = source.indexOf("function createCommercialDraftFromAnswersWithPaymentSettings(", start);
  assert.equal(end > start, true, "createCommercialDraftFromAnswers end not found");
  return source.slice(start, end);
}

function getCommercialIdentityItemsBlock(source: string) {
  const start = source.indexOf("  const commercialIdentityItems = useMemo(() => {");
  assert.equal(start > -1, true, "commercialIdentityItems not found");
  const end = source.indexOf("  const commercialAiSettingsInput = useMemo(", start);
  assert.equal(end > start, true, "commercialIdentityItems end not found");
  return source.slice(start, end);
}

function getPoolsOperationalItemsBlock(source: string) {
  const start = source.indexOf("  const poolsOperationalItems = useMemo(() => {");
  assert.equal(start > -1, true, "poolsOperationalItems not found");
  const end = source.indexOf("  const operationReadinessMetrics = useMemo(() => {", start);
  assert.equal(end > start, true, "poolsOperationalItems end not found");
  return source.slice(start, end);
}

function getPoolsQuickCountBlock(source: string) {
  const start = source.indexOf("Base comercial de piscinas");
  assert.equal(start > -1, true, "pools tab block not found");
  const end = source.indexOf("Cadastro manual e importa", start);
  assert.equal(end > start, true, "pools quick count block end not found");
  return source.slice(start, end);
}

function getCommercialEditFormBlock(source: string) {
  const start = source.indexOf('{isCommercialEditing ? (');
  assert.equal(start > -1, true, "commercial edit form not found");
  const end = source.indexOf('<SummaryList items={commercialIdentityItems} />', start);
  assert.equal(end > start, true, "commercial edit form end not found");
  return source.slice(start, end);
}

function getChannelsSaveBlock(source: string) {
  const start = source.indexOf("  const handleChannelsEditSave = useCallback(async () => {");
  assert.equal(start > -1, true, "handleChannelsEditSave not found");
  const end = source.indexOf("  }, [", start);
  assert.equal(end > start, true, "handleChannelsEditSave end not found");
  return source.slice(start, end);
}

function getStrategySaveBlock(source: string) {
  const start = source.indexOf("  const handleStrategyEditSave = useCallback(async () => {");
  assert.equal(start > -1, true, "handleStrategyEditSave not found");
  const end = source.indexOf("  }, [", start);
  assert.equal(end > start, true, "handleStrategyEditSave end not found");
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

function getCreatePrimaryResponsibleDraftFromSourcesBlock(source: string) {
  const start = source.indexOf("function createPrimaryResponsibleDraftFromSources(");
  assert.equal(start > -1, true, "createPrimaryResponsibleDraftFromSources not found");
  const end = source.indexOf("function parseResponsiblePeopleFromAnswers(", start);
  assert.equal(end > start, true, "createPrimaryResponsibleDraftFromSources end not found");
  return source.slice(start, end);
}

function getCanonicalPrimaryResponsibleStateBlock(source: string) {
  const start = source.indexOf("  const [canonicalPrimaryResponsible, setCanonicalPrimaryResponsible] =");
  assert.equal(start > -1, true, "canonical primary responsible state not found");
  const end = source.indexOf("  const storeLogoInputRef = useRef", start);
  assert.equal(end > start, true, "canonical primary responsible state end not found");
  return source.slice(start, end);
}

function getOverviewDraftEffectBlock(source: string) {
  const start = source.indexOf("  useEffect(() => {\n    const currentOperationInput = createStoreOperationSettingsInputFromSources({");
  assert.equal(start > -1, true, "overview draft effect not found");
  const end = source.indexOf("  useEffect(() => {\n    setSelectedStoreLogoFile(null);", start);
  assert.equal(end > start, true, "overview draft effect end not found");
  return source.slice(start, end);
}

function getOverviewSummaryBlock(source: string) {
  const start = source.indexOf("  const overviewSummary = useMemo(() => {");
  assert.equal(start > -1, true, "overviewSummary not found");
  const end = source.indexOf("  const iaReadiness = useMemo(() => {", start);
  assert.equal(end > start, true, "overviewSummary end not found");
  return source.slice(start, end);
}

function getActivationPendenciesBlock(source: string) {
  const start = source.indexOf("  const activationPendencies = useMemo(() => {");
  assert.equal(start > -1, true, "activationPendencies not found");
  const end = source.indexOf("  const shouldShowQuickAccess =", start);
  assert.equal(end > start, true, "activationPendencies end not found");
  return source.slice(start, end);
}

function getOverviewEditCancelBlock(source: string) {
  const start = source.indexOf("  const handleOverviewEditCancel = useCallback(() => {");
  assert.equal(start > -1, true, "handleOverviewEditCancel not found");
  const end = source.indexOf("  const handleOverviewEditSave = useCallback(async () => {", start);
  assert.equal(end > start, true, "handleOverviewEditCancel end not found");
  return source.slice(start, end);
}

function getOverviewEditSaveBlock(source: string) {
  const start = source.indexOf("  const handleOverviewEditSave = useCallback(async () => {");
  assert.equal(start > -1, true, "handleOverviewEditSave not found");
  const end = source.indexOf("  const handleStrategyDraftChange = useCallback(", start);
  assert.equal(end > start, true, "handleOverviewEditSave end not found");
  return source.slice(start, end);
}

function getOverviewEditFormBlock(source: string) {
  const start = source.indexOf("{isOverviewEditing ? (");
  assert.equal(start > -1, true, "overview edit form not found");
  const end = source.indexOf('          <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">', start);
  assert.equal(end > start, true, "overview edit form end not found");
  return source.slice(start, end);
}

function getActivationItemsBlock(source: string) {
  const start = source.indexOf("  const activationItems = useMemo(() => {");
  assert.equal(start > -1, true, "activationItems not found");
  const end = source.indexOf("  const discountItems = useMemo(() => {", start);
  assert.equal(end > start, true, "activationItems end not found");
  return source.slice(start, end);
}

function getActivationHydrationBlock(source: string) {
  const start = source.indexOf("  useEffect(() => {\n    setPrimaryResponsibleDraft(");
  assert.equal(start > -1, true, "primary responsible hydration effect not found");
  const end = source.indexOf("  const handleCommercialDraftChange = useCallback", start);
  assert.equal(end > start, true, "primary responsible hydration effect end not found");
  return source.slice(start, end);
}

function getActivationEditCancelBlock(source: string) {
  const start = source.indexOf("  const handleActivationEditCancel = useCallback(() => {");
  assert.equal(start > -1, true, "handleActivationEditCancel not found");
  const end = source.indexOf("  const handleActivationEditSave = useCallback(async () => {", start);
  assert.equal(end > start, true, "handleActivationEditCancel end not found");
  return source.slice(start, end);
}

function getCreateChannelDraftFromSourcesBlock(source: string) {
  const start = source.indexOf("function createChannelDraftFromSources(");
  assert.equal(start > -1, true, "createChannelDraftFromSources not found");
  const end = source.indexOf("function parseNumberInput(", start);
  assert.equal(end > start, true, "createChannelDraftFromSources end not found");
  return source.slice(start, end);
}

function getChannelsTabBlock(source: string) {
  const start = source.indexOf('{activeTab === "canais-integracoes" ? (');
  assert.equal(start > -1, true, "channels tab not found");
  const end = source.indexOf('{activeTab === "contratos" ? (', start);
  assert.equal(end > start, true, "channels tab end not found");
  return source.slice(start, end);
}

function getStrategyTabBlock(source: string) {
  const start = source.indexOf('{activeTab === "estrategia" ? (');
  assert.equal(start > -1, true, "strategy tab not found");
  const end = source.indexOf('{activeTab === "piscinas" ? (', start);
  assert.equal(end > start, true, "strategy tab end not found");
  return source.slice(start, end);
}

function getCreateDiscountDraftFromAnswersBlock(source: string) {
  const start = source.indexOf("function createDiscountDraftFromAnswers(");
  assert.equal(start > -1, true, "createDiscountDraftFromAnswers not found");
  const end = source.indexOf("function createChannelDraftFromSources(", start);
  assert.equal(end > start, true, "createDiscountDraftFromAnswers end not found");
  return source.slice(start, end);
}

function getDiscountItemsBlock(source: string) {
  const start = source.indexOf("  const discountItems = useMemo(() => {");
  assert.equal(start > -1, true, "discountItems not found");
  const end = source.indexOf("  const channelsOverviewMetrics = useMemo(", start);
  assert.equal(end > start, true, "discountItems end not found");
  return source.slice(start, end);
}

function getDiscountEditFormBlock(source: string) {
  const start = source.indexOf('{isDiscountEditing ? (');
  assert.equal(start > -1, true, "discount edit form not found");
  const end = source.indexOf('<SummaryList items={discountItems} />', start);
  assert.equal(end > start, true, "discount edit form end not found");
  return source.slice(start, end);
}

const tests: TestCase[] = [
  {
    name: "operation save derives canonical weekend operating days and never invents schedule rows",
    run: () => {
      const source = readPageSource();
      const block = getOperationSaveBlock(source);

      assert.equal(
        block.includes("const updatedOperatingDays = applyWeekendSelectionToOperatingDays({"),
        true,
      );
      assert.equal(block.includes("currentDays: scheduleSettings.operating_days"), true);
      assert.equal(block.includes("saturdaySelection: operationDraft.serves_saturday"), true);
      assert.equal(block.includes("sundaySelection: operationDraft.serves_sunday"), true);
      assert.equal(block.includes("p_operating_days: updatedOperatingDays"), true);
      assert.equal(block.includes('if (scheduleSettings) {'), true);
      assert.equal(block.includes('await supabase.rpc("upsert_store_schedule_settings"'), true);
      assert.equal(block.includes("onboarding_upsert_answer_scoped"), false);
    },
  },
  {
    name: "operation draft change and edit form keep agenda controls read-only until canonical schedule settings exist",
    run: () => {
      const source = readPageSource();
      const changeBlock = getOperationDraftChangeBlock(source);
      const formBlock = getOperationEditFormBlock(source);

      assert.equal(changeBlock.includes("!scheduleSettings"), true);
      assert.equal(changeBlock.includes('key === "serves_saturday"'), true);
      assert.equal(changeBlock.includes('key === "serves_sunday"'), true);
      assert.equal(changeBlock.includes('key === "serves_holiday"'), true);
      assert.equal(changeBlock.includes('key === "allow_multiple_appointments_per_day"'), true);
      assert.equal(changeBlock.includes('key === "allow_same_time_appointments"'), true);
      assert.equal(changeBlock.includes('key === "agenda_capacity_rule"'), true);
      assert.equal(
        formBlock.includes("Agenda canonica ainda nao configurada; estes controles ficam somente leitura por enquanto."),
        true,
      );
      assert.equal(formBlock.includes("operation-schedule-controls-read-only"), true);
      assert.equal(formBlock.includes("pointer-events: none;"), true);
      assert.equal(formBlock.includes("cursor: not-allowed;"), true);
    },
  },
  {
    name: "operation draft derives weekend labels only from canonical schedule settings",
    run: () => {
      const source = readPageSource();
      const formBlock = getOperationEditFormBlock(source);
      const canonicalFunctionStart = source.indexOf("function deriveCanonicalWeekendAvailabilityLabel(");
      const canonicalFunctionEnd = source.indexOf("function createOperationDraftFromAnswers(", canonicalFunctionStart);
      assert.equal(canonicalFunctionStart > -1, true);
      assert.equal(canonicalFunctionEnd > canonicalFunctionStart, true);
      const canonicalFunctionBlock = source.slice(canonicalFunctionStart, canonicalFunctionEnd);
      const canonicalScheduleIndex = canonicalFunctionBlock.indexOf("if (scheduleSettings) {");

      assert.equal(source.includes("normalizeOperatingDays"), true);
      assert.equal(source.includes("deriveWeekendAvailabilityFromOperatingDays"), true);
      assert.equal(source.includes("deriveCanonicalWeekendAvailabilityLabel"), true);
      assert.equal(source.includes('deriveCanonicalWeekendAvailabilityLabel("sabado", scheduleSettings)'), true);
      assert.equal(source.includes('deriveCanonicalWeekendAvailabilityLabel("domingo", scheduleSettings)'), true);
      assert.equal(source.includes("const servesSaturdayLabel = useMemo("), true);
      assert.equal(source.includes("const servesSundayLabel = useMemo("), true);
      assert.equal(canonicalScheduleIndex > -1, true);
      assert.equal(canonicalFunctionBlock.includes("serves_saturday"), true);
      assert.equal(canonicalFunctionBlock.includes("serves_sunday"), true);
      assert.equal(canonicalFunctionBlock.includes("answers."), false);
      assert.equal(canonicalFunctionBlock.includes("installation_available_days"), false);
      assert.equal(canonicalFunctionBlock.includes("technical_visit_available_days"), false);
      assert.equal(formBlock.includes("Atende sábado"), true);
      assert.equal(formBlock.includes("Atende domingo"), true);
    },
  },
  {
    name: "operation read view does not promote legacy agenda answers when canonical schedule settings are absent",
    run: () => {
      const source = readPageSource();
      const draftBlock = getCreateOperationDraftFromAnswersBlock(source);
      const selectionBlock = getOperationScheduleSelectionBlock(source);
      const readinessBlock = getOperationReadinessMetricsBlock(source);
      const sectionsBlock = getOperationSectionsBlock(source);
      const overviewAgendaBlock = getOverviewStatusCardsBlock(source);

      assert.equal(selectionBlock.includes("answers.installation_available_days"), false);
      assert.equal(selectionBlock.includes("answers.technical_visit_available_days"), false);
      assert.equal(selectionBlock.includes(": []"), true);

      assert.equal(draftBlock.includes("cleanText(answers.operating_days)"), false);
      assert.equal(draftBlock.includes("cleanText(answers.operating_hours)"), false);
      assert.equal(draftBlock.includes("deriveHolidayAvailabilityLabel"), false);
      assert.equal(draftBlock.includes("answers.agenda_capacity_rule"), false);
      assert.equal(draftBlock.includes("answers.average_human_response_time"), false);
      assert.equal(draftBlock.includes(': "Sim",'), false);
      assert.equal(draftBlock.includes(': "Não",'), false);

      assert.equal(readinessBlock.includes("const hasOperationalSchedule = Boolean(scheduleSettings);"), true);
      assert.equal(readinessBlock.includes("installationDaysSelected.length > 0 || technicalVisitDaysSelected.length > 0"), false);
      assert.equal(readinessBlock.includes(': "1"'), false);
      assert.equal(readinessBlock.includes('"Bloqueado"'), true);
      assert.equal(readinessBlock.includes(': "Pendente"'), true);

      assert.equal(sectionsBlock.includes("answers.average_human_response_time"), false);
      assert.equal(sectionsBlock.includes("answers.agenda_capacity_rule"), false);
      assert.equal(sectionsBlock.includes(': "Sim"'), false);
      assert.equal(sectionsBlock.includes(': "Não"'), false);
      assert.equal(sectionsBlock.includes("CANONICAL_SCHEDULE_NOT_CONFIGURED_LABEL"), true);

      assert.equal(overviewAgendaBlock.includes("answers.installation_days_rule"), false);
      assert.equal(overviewAgendaBlock.includes("answers.technical_visit_days_rule"), false);
      assert.equal(overviewAgendaBlock.includes('value={scheduleSettings ? "Configurada" : "Pendente"}'), true);
    },
  },
  {
    name: "operation read view keeps canonical false and empty schedule values canonical",
    run: () => {
      const source = readPageSource();
      const selectionBlock = getOperationScheduleSelectionBlock(source);
      const sectionsBlock = getOperationSectionsBlock(source);
      const readinessBlock = getOperationReadinessMetricsBlock(source);

      assert.equal(selectionBlock.includes("Array.isArray(scheduleSettings?.installation_days)"), true);
      assert.equal(selectionBlock.includes("Array.isArray(scheduleSettings?.technical_visit_days)"), true);
      assert.equal(selectionBlock.includes("? (scheduleSettings.installation_days as unknown[])"), true);
      assert.equal(selectionBlock.includes("? (scheduleSettings.technical_visit_days as unknown[])"), true);

      assert.equal(sectionsBlock.includes("scheduleSettings ? yesNoLabel(scheduleSettings.attends_holidays)"), true);
      assert.equal(sectionsBlock.includes("scheduleSettings ? yesNoLabel(scheduleSettings.allow_multiple_appointments_per_day)"), true);
      assert.equal(sectionsBlock.includes("scheduleSettings ? yesNoLabel(scheduleSettings.allow_same_time_appointments)"), true);
      assert.equal(
        sectionsBlock.includes("scheduleSettings && Number.isFinite(Number(scheduleSettings.same_time_capacity))"),
        true,
      );
      assert.equal(readinessBlock.includes("scheduleSettings.allow_same_time_appointments"), true);
    },
  },
  {
    name: "operation localStorage restore migrates persisted draft instead of accepting raw legacy shape",
    run: () => {
      const source = readPageSource();
      const draftStateBlock = getOperationDraftStateBlock(source);
      const restoreBlock = getRestoreLocalDraftBlock(source);

      assert.equal(source.includes("normalizePersistedOperationDraft"), true);
      assert.equal(
        restoreBlock.includes("setOperationDraft((current) =>"),
        true,
      );
      assert.equal(
        restoreBlock.includes("normalizePersistedOperationDraft(current, parsed.operationDraft)"),
        true,
      );
      assert.equal(
        restoreBlock.includes("setOperationDraft(parsed.operationDraft)"),
        false,
      );
      assert.equal(draftStateBlock.includes("technical_visit_rules_summary:"), false);
      assert.equal(draftStateBlock.includes("service_regions:"), false);
      assert.equal(draftStateBlock.includes("important_limitations:"), false);
      assert.equal(draftStateBlock.includes("operational_ai_summary:"), false);
      assert.equal(restoreBlock.includes("technical_visit_rules_summary"), false);
      assert.equal(restoreBlock.includes("service_regions"), false);
      assert.equal(restoreBlock.includes("important_limitations"), false);
      assert.equal(restoreBlock.includes("operational_ai_summary"), false);
    },
  },
  {
    name: "operation save prepares validation inside try and blocks invalid installation time before rpc",
    run: () => {
      const source = readPageSource();
      const block = getOperationSaveBlock(source);
      const tryIndex = block.indexOf("    try {");
      const parseIndex = block.indexOf("const parsedAverageInstallationTime = parseOptionalPositiveInteger(");
      const normalizeIndex = block.indexOf("const normalizedOperationSettings = normalizeStoreOperationSettingsInput({");
      const rpcIndex = block.indexOf('await supabase.rpc(\n          "upsert_store_operation_settings_with_legacy_mirror_scoped"');
      const invalidTimeIndex = block.indexOf("Prazo médio de instalação deve ser vazio ou um inteiro positivo.");

      assert.equal(tryIndex > -1, true);
      assert.equal(parseIndex > tryIndex, true);
      assert.equal(normalizeIndex > tryIndex, true);
      assert.equal(invalidTimeIndex > tryIndex, true);
      assert.equal(invalidTimeIndex < rpcIndex, true);
      assert.equal(rpcIndex > normalizeIndex, true);
      assert.equal(block.includes("Number.isNaN(parsedAverageInstallationTime)"), true);
      assert.equal(block.includes("? 0\n        : parsedAverageInstallationTime"), false);
    },
  },
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
    name: "canonical primary responsible hydrates current identity without legacy fallback",
    run: () => {
      const source = readPageSource();
      const stateBlock = getCanonicalPrimaryResponsibleStateBlock(source);
      const draftBlock = getCreatePrimaryResponsibleDraftFromSourcesBlock(source);
      const fetchBlock = getFetchPageDataBlock(source);

      assert.equal(
        stateBlock.includes("const loadedCanonicalPrimaryResponsible = hasLoadedCanonicalPrimaryResponsible"),
        true,
      );
      assert.equal(stateBlock.includes("canonicalPrimaryResponsibleDraft"), true);
      assert.equal(
        stateBlock.includes("createPrimaryResponsibleDraftFromSources(answers, loadedCanonicalPrimaryResponsible)"),
        true,
      );
      assert.equal(draftBlock.includes("name: cleanText(responsible?.name)"), true);
      assert.equal(draftBlock.includes("whatsapp: cleanText(responsible?.whatsappNumber)"), true);
      assert.equal(draftBlock.includes("name: cleanText(answers.responsible_name)"), false);
      assert.equal(draftBlock.includes("whatsapp: cleanText(answers.responsible_whatsapp)"), false);
      assert.equal(fetchBlock.includes("setCanonicalPrimaryResponsible(nextCanonicalPrimaryResponsible)"), true);
      assert.equal(fetchBlock.includes("setHasLoadedCanonicalPrimaryResponsible(true)"), true);
    },
  },
  {
    name: "overview identity reads canonical responsible and canonical absence stays absent",
    run: () => {
      const source = readPageSource();
      const effectBlock = getOverviewDraftEffectBlock(source);
      const summaryBlock = getOverviewSummaryBlock(source);
      const pendenciesBlock = getActivationPendenciesBlock(source);

      assert.equal(effectBlock.includes("responsible_name: cleanText(canonicalPrimaryResponsibleDraft.name)"), true);
      assert.equal(effectBlock.includes("responsible_whatsapp: cleanText(canonicalPrimaryResponsibleDraft.whatsapp)"), true);
      assert.equal(effectBlock.includes("responsible_name: cleanText(answers.responsible_name)"), false);
      assert.equal(effectBlock.includes("responsible_whatsapp: cleanText(answers.responsible_whatsapp)"), false);
      assert.equal(summaryBlock.includes("primaryResponsibleName"), true);
      assert.equal(summaryBlock.includes("primaryResponsibleWhatsapp"), true);
      assert.equal(summaryBlock.includes("answers.responsible_name"), false);
      assert.equal(summaryBlock.includes("answers.responsible_whatsapp"), false);
      assert.equal(pendenciesBlock.includes("if (!primaryResponsibleName)"), true);
      assert.equal(pendenciesBlock.includes("if (!primaryResponsibleWhatsapp)"), true);
      assert.equal(pendenciesBlock.includes("answers.responsible_name"), false);
      assert.equal(pendenciesBlock.includes("answers.responsible_whatsapp"), false);
    },
  },
  {
    name: "overview operation rules read canonical operation state and do not save legacy mirrors",
    run: () => {
      const source = readPageSource();
      const effectBlock = getOverviewDraftEffectBlock(source);
      const cancelBlock = getOverviewEditCancelBlock(source);
      const saveBlock = getOverviewEditSaveBlock(source);
      const editFormBlock = getOverviewEditFormBlock(source);

      assert.equal(
        effectBlock.includes("currentOperationInput.installationDaysRule"),
        true,
      );
      assert.equal(
        effectBlock.includes("currentOperationInput.technicalVisitDaysRule"),
        true,
      );
      assert.equal(effectBlock.includes("answers.installation_days_rule"), false);
      assert.equal(effectBlock.includes("answers.technical_visit_days_rule"), false);
      assert.equal(
        cancelBlock.includes("operationSettingsInput.installationDaysRule"),
        true,
      );
      assert.equal(
        cancelBlock.includes("operationSettingsInput.technicalVisitDaysRule"),
        true,
      );
      assert.equal(cancelBlock.includes("answers.installation_days_rule"), false);
      assert.equal(cancelBlock.includes("answers.technical_visit_days_rule"), false);
      assert.equal(saveBlock.includes("installation_days_rule"), false);
      assert.equal(saveBlock.includes("technical_visit_days_rule"), false);
      assert.equal(
        editFormBlock.includes('handleOverviewDraftChange("installation_days_rule"'),
        false,
      );
      assert.equal(
        editFormBlock.includes('handleOverviewDraftChange("technical_visit_days_rule"'),
        false,
      );
    },
  },
  {
    name: "primary responsible edit cancel resets identity to canonical source",
    run: () => {
      const source = readPageSource();
      const overviewCancelBlock = getOverviewEditCancelBlock(source);
      const activationHydrationBlock = getActivationHydrationBlock(source);
      const activationCancelBlock = getActivationEditCancelBlock(source);

      assert.equal(
        overviewCancelBlock.includes("responsible_name: cleanText(canonicalPrimaryResponsibleDraft.name)"),
        true,
      );
      assert.equal(
        overviewCancelBlock.includes("responsible_whatsapp: cleanText(canonicalPrimaryResponsibleDraft.whatsapp)"),
        true,
      );
      assert.equal(activationHydrationBlock.includes("setPrimaryResponsibleDraft(canonicalPrimaryResponsibleDraft)"), true);
      assert.equal(activationCancelBlock.includes("setPrimaryResponsibleDraft(canonicalPrimaryResponsibleDraft)"), true);
      assert.equal(activationCancelBlock.includes("answers.responsible_name"), false);
      assert.equal(activationCancelBlock.includes("answers.responsible_whatsapp"), false);
    },
  },
  {
    name: "current responsible presentation and channels do not read legacy responsible answers",
    run: () => {
      const source = readPageSource();
      const activationItemsBlock = getActivationItemsBlock(source);
      const channelsBlock = getCreateChannelDraftFromSourcesBlock(source);
      const overviewTabStart = source.indexOf('{activeTab === "visao-geral" ? (');
      const overviewTabEnd = source.indexOf('{activeTab === "estrategia" ? (', overviewTabStart);
      assert.equal(overviewTabStart > -1, true, "overview tab not found");
      assert.equal(overviewTabEnd > overviewTabStart, true, "overview tab end not found");
      const overviewTabBlock = source.slice(overviewTabStart, overviewTabEnd);

      assert.equal(source.includes("const primaryResponsibleName = cleanText(loadedCanonicalPrimaryResponsible?.name);"), true);
      assert.equal(source.includes("loadedCanonicalPrimaryResponsible?.whatsappNumber"), true);
      assert.equal(activationItemsBlock.includes("primaryResponsibleName"), true);
      assert.equal(activationItemsBlock.includes("primaryResponsibleWhatsapp"), true);
      assert.equal(activationItemsBlock.includes("answers.responsible_name"), false);
      assert.equal(activationItemsBlock.includes("answers.responsible_whatsapp"), false);
      assert.equal(channelsBlock.includes("responsible?: CanonicalPrimaryResponsible | null"), true);
      assert.equal(channelsBlock.includes("const responsibleWhatsapp = cleanText(responsible?.whatsappNumber);"), true);
      assert.equal(channelsBlock.includes("const responsibleName = cleanText(responsible?.name);"), true);
      assert.equal(channelsBlock.includes("answers.responsible_whatsapp"), false);
      assert.equal(overviewTabBlock.includes("primaryResponsibleName"), true);
      assert.equal(overviewTabBlock.includes("primaryResponsibleWhatsapp"), true);
      assert.equal(overviewTabBlock.includes("answers.responsible_name"), false);
      assert.equal(overviewTabBlock.includes("answers.responsible_whatsapp"), false);
    },
  },
  {
    name: "legacy responsible fields without canonical equivalence remain scoped to legacy behavior",
    run: () => {
      const source = readPageSource();
      const draftBlock = getCreatePrimaryResponsibleDraftFromSourcesBlock(source);
      const discountDraftBlock = getCreateDiscountDraftFromAnswersBlock(source);

      assert.equal(draftBlock.includes("cleanText(answers.responsible_role)"), true);
      assert.equal(draftBlock.includes("answers.ai_should_notify_responsible"), true);
      assert.equal(draftBlock.includes("cleanText(answers.responsible_notes)"), true);
      assert.equal(source.includes("parseResponsiblePeopleFromAnswers(answers)"), true);
      assert.equal(discountDraftBlock.includes("cleanText(answers.discount_approver_name)"), true);
      assert.equal(discountDraftBlock.includes("cleanText(answers.responsible_name)"), true);
    },
  },
  {
    name: "commercial identity presentation reads strategy authority and never price policy fields",
    run: () => {
      const source = readPageSource();
      const draftBlock = getCreateCommercialDraftFromAnswersBlock(source);
      const combinedDraftBlock = source.slice(
        source.indexOf("function createCommercialDraftFromAnswersWithPaymentSettings("),
        source.indexOf("function createDiscountDraftFromAnswers("),
      );
      const identityBlock = getCommercialIdentityItemsBlock(source);

      assert.equal(draftBlock.includes("answers.strategy_ai_presentation"), false);
      assert.equal(combinedDraftBlock.includes("strategySettingsInput?.strategyAiPresentation"), true);
      assert.equal(draftBlock.includes("ai_display_name: cleanText(answers.store_display_name)"), true);
      assert.equal(draftBlock.includes("answers.responsible_name"), false);
      assert.equal(identityBlock.includes("strategySettingsInput.strategyAiPresentation"), true);
      assert.equal(identityBlock.includes("answers.strategy_ai_presentation"), false);
      assert.equal(identityBlock.includes("answers.responsible_name"), false);
      assert.equal(identityBlock.includes("price_talk_mode"), false);
      assert.equal(identityBlock.includes("price_answer_policy"), false);
      assert.equal(identityBlock.includes("ai_can_send_price_directly"), false);
      assert.equal(identityBlock.includes("price_needs_human_help"), false);
      assert.equal(
        identityBlock.includes("nao_falar_sozinha") || draftBlock.includes("nao_falar_sozinha"),
        false,
      );
    },
  },
  {
    name: "pool strategy readers use canonical strategy brand fields instead of legacy answers",
    run: () => {
      const source = readPageSource();
      const poolsOperationalBlock = getPoolsOperationalItemsBlock(source);
      const poolsQuickCountBlock = getPoolsQuickCountBlock(source);

      assert.equal(poolsOperationalBlock.includes("strategySettingsInput.mainStoreBrand"), true);
      assert.equal(poolsOperationalBlock.includes("strategySettingsInput.brandsWorked"), true);
      assert.equal(poolsOperationalBlock.includes("answers.main_store_brand"), false);
      assert.equal(poolsOperationalBlock.includes("answers.brands_worked"), false);
      assert.equal(poolsQuickCountBlock.includes("strategySettingsInput.mainStoreBrand"), true);
      assert.equal(poolsQuickCountBlock.includes("strategySettingsInput.brandsWorked"), true);
      assert.equal(poolsQuickCountBlock.includes("answers.main_store_brand"), false);
      assert.equal(poolsQuickCountBlock.includes("answers.brands_worked"), false);
    },
  },
  {
    name: "commercial edit form shows strategy presentation as read-only and falls back to Nao definido",
    run: () => {
      const source = readPageSource();
      const draftBlock = getCreateCommercialDraftFromAnswersBlock(source);
      const formBlock = getCommercialEditFormBlock(source);

      assert.equal(draftBlock.includes('"Não definido"'), true);
      assert.equal(draftBlock.includes("answers.strategy_ai_presentation"), false);
      assert.equal(formBlock.includes("value={commercialDraft.ai_presentation_mode} readOnly"), true);
      assert.equal(
        formBlock.includes('handleCommercialDraftChange("ai_presentation_mode"'),
        false,
      );
    },
  },
  {
    name: "commercial editor uses canonical payment and commercial writers before shared legacy answer sync",
    run: () => {
      const source = readPageSource();
      const block = getCommercialSaveBlock(source);

      const paymentSyncIndex = block.indexOf(
        '"upsert_store_payment_settings_with_legacy_mirror_scoped"',
      );
      const commercialSyncIndex = block.indexOf(
        '"upsert_store_commercial_ai_settings_with_legacy_mirror_scoped"',
      );
      const sharedLegacySyncIndex = block.indexOf("const saved = await upsertConfigAnswers(");

      assert.equal(paymentSyncIndex > -1, true);
      assert.equal(commercialSyncIndex > -1, true);
      assert.equal(sharedLegacySyncIndex > -1, true);
      assert.equal(paymentSyncIndex < sharedLegacySyncIndex, true);
      assert.equal(commercialSyncIndex < sharedLegacySyncIndex, true);
      assert.equal(
        block.includes("const derivedPaymentSummary = deriveStorePaymentSettingsSummary("),
        true,
      );
      assert.equal(block.includes("price_talk_mode: commercialAiLegacyMirrors"), false);
      assert.equal(block.includes("ai_can_send_price_directly: commercialAiLegacyMirrors"), false);
      assert.equal(block.includes("price_needs_human_help: commercialAiLegacyMirrors"), false);
      assert.equal(block.includes("price_must_understand_before: commercialAiLegacyMirrors"), false);
      assert.equal(block.includes("price_direct_conditions: commercialAiLegacyMirrors"), false);
      assert.equal(block.includes("price_direct_rule: commercialAiLegacyMirrors"), false);
      assert.equal(block.includes("strategy_ai_presentation"), false);
      assert.equal(block.includes("ai_presentation_mode"), false);
      assert.equal(block.includes("p_price_answer_policy:"), true);
      assert.equal(block.includes("p_price_context_requirements:"), true);
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
    name: "simple page load reads canonical payment and commercial AI settings but does not call their writers",
    run: () => {
      const source = readPageSource();
      const block = getFetchPageDataBlock(source);

      assert.equal(block.includes('.from("store_payment_settings")'), true);
      assert.equal(block.includes('.from("store_commercial_ai_settings")'), true);
      assert.equal(
        block.includes("upsert_store_payment_settings_with_legacy_mirror_scoped"),
        false,
      );
      assert.equal(
        block.includes("upsert_store_payment_settings_scoped"),
        false,
      );
      assert.equal(
        block.includes("upsert_store_commercial_ai_settings_with_legacy_mirror_scoped"),
        false,
      );
      assert.equal(
        block.includes("upsert_store_commercial_ai_settings_scoped"),
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
    name: "simple page load reads canonical strategy settings but does not call any strategy writer",
    run: () => {
      const source = readPageSource();
      const block = getFetchPageDataBlock(source);

      assert.equal(block.includes('.from("store_strategy_settings")'), true);
      assert.equal(
        block.includes("upsert_store_strategy_settings_with_legacy_mirror_scoped"),
        false,
      );
      assert.equal(
        block.includes("upsert_store_strategy_settings_scoped"),
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
    name: "strategy editor saves only canonical strategy fields through the scoped mirror writer",
    run: () => {
      const source = readPageSource();
      const block = getStrategySaveBlock(source);

      assert.equal(
        block.includes('"upsert_store_strategy_settings_with_legacy_mirror_scoped"'),
        true,
      );
      assert.equal(
        block.includes("normalizeStoreStrategySettingsInput(strategyDraft)"),
        true,
      );
      assert.equal(block.includes("p_city:"), true);
      assert.equal(block.includes("p_service_region_modes:"), true);
      assert.equal(block.includes("p_store_services:"), true);
      assert.equal(block.includes("p_main_store_brand:"), true);
      assert.equal(block.includes("p_strategy_ai_never_forget:"), true);
      assert.equal(block.includes("p_strategy_requires_visit"), false);
      assert.equal(block.includes("p_strategy_requires_human"), false);
      assert.equal(block.includes("p_strategy_exception_cases"), false);
      assert.equal(block.includes("p_strategy_ai_store_summary"), false);
      assert.equal(block.includes("upsertConfigAnswers"), false);
    },
  },
  {
    name: "strategy UI keeps canonical fields editable and leaves excluded legacy text read-only",
    run: () => {
      const source = readPageSource();
      const block = getStrategyTabBlock(source);

      assert.equal(
        block.includes('onChange={(event) => handleStrategyDraftChange("serviceRegions", event.target.value)}'),
        true,
      );
      assert.equal(
        block.includes('handleStrategyDraftChange("serviceRegionPrimaryMode", event.target.value)'),
        true,
      );
      assert.equal(
        block.includes('handleStrategyMultiValueToggle("serviceRegionModes", option.value)'),
        true,
      );
      assert.equal(
        block.includes('handleStrategyMultiValueToggle("storeServices", option.value)'),
        true,
      );
      assert.equal(block.includes('value={derivedStrategyAiStoreSummary}'), true);
      assert.equal(block.includes("readOnly"), true);
      assert.equal(block.includes("Campos legacy fora da autoridade canonica"), true);
      assert.equal(block.includes("Este resumo e derivado da configuracao canonica"), true);
      assert.equal(block.includes('handleStrategyDraftChange("strategy_requires_visit"'), false);
      assert.equal(block.includes('handleStrategyDraftChange("strategy_requires_human"'), false);
      assert.equal(block.includes('handleStrategyDraftChange("strategy_exception_cases"'), false);
      assert.equal(block.includes('handleStrategyDraftChange("strategy_ai_store_summary"'), false);
      assert.equal(block.includes("service_region_modes_text"), false);
      assert.equal(block.includes("store_services_text"), false);
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
    name: "discount draft binds special rules only to canonical discount settings input",
    run: () => {
      const source = readPageSource();
      const block = getCreateDiscountDraftFromAnswersBlock(source);

      assert.equal(
        block.includes("special_discount_rules: discountInput.discountSpecialRules"),
        true,
      );
      assert.equal(block.includes("price_direct_rule_other"), false);
      assert.equal(block.includes("price_direct_rule"), false);
      assert.equal(block.includes("price_must_understand_before"), false);
      assert.equal(block.includes("negotiation_rules_summary"), false);
      assert.equal(block.includes("sales_flow_notes"), false);
      assert.equal(block.includes("human_help_general_summary"), false);
    },
  },
  {
    name: "discount edit form keeps human approval and approver as read-only derived fields",
    run: () => {
      const source = readPageSource();
      const block = getDiscountEditFormBlock(source);

      assert.equal(block.includes("Quando precisa aprovação humana"), true);
      assert.equal(block.includes("Quem aprova desconto"), true);
      assert.equal(
        block.includes("value={discountDraft.human_help_discount_summary}"),
        true,
      );
      assert.equal(
        block.includes("value={discountDraft.discount_approver}"),
        true,
      );
      assert.equal(
        block.includes('handleDiscountDraftChange("human_help_discount_summary"'),
        false,
      );
      assert.equal(
        block.includes('handleDiscountDraftChange("discount_approver"'),
        false,
      );
    },
  },
  {
    name: "discount save writes special rules through canonical writer and does not write competing authorities",
    run: () => {
      const source = readPageSource();
      const block = getDiscountSaveBlock(source);

      assert.equal(
        block.includes('"upsert_store_discount_settings_with_legacy_mirror_scoped"'),
        true,
      );
      assert.equal(block.includes("p_default_discount_percent:"), true);
      assert.equal(block.includes("p_max_discount_percent:"), true);
      assert.equal(block.includes("p_allow_ask_above_max_discount:"), true);
      assert.equal(block.includes("p_discount_autonomy_mode:"), true);
      assert.equal(block.includes("p_discount_special_rules:"), true);
      assert.equal(block.includes('"upsert_store_high_value_discount_settings_scoped"'), true);
      assert.equal(block.includes("p_enabled:"), true);
      assert.equal(block.includes("p_threshold_amount_cents:"), true);
      assert.equal(block.includes("p_discount_percent:"), true);
      assert.equal(block.includes("human_help_discount_cases:"), false);
      assert.equal(block.includes("human_help_discount_cases_selected"), false);
      assert.equal(block.includes("human_help_discount_cases_other"), false);
      assert.equal(block.includes("discount_approver_name:"), false);
      assert.equal(block.includes("discount_special_rules: discountDraft"), false);
    },
  },
  {
    name: "discount read-only summary uses canonical special rules and derived approval text",
    run: () => {
      const source = readPageSource();
      const block = getDiscountItemsBlock(source);

      assert.equal(
        block.includes('label: "Regras especiais", value: discountPresentation.discountSpecialRules || "Nao definido"'),
        true,
      );
      assert.equal(
        block.includes('label: "Quando precisa aprovação humana"'),
        true,
      );
      assert.equal(
        block.includes("value: discountDraft.human_help_discount_summary || \"Não definido\""),
        true,
      );
      assert.equal(block.includes("price_direct_rule"), false);
      assert.equal(block.includes("price_must_understand_before"), false);
      assert.equal(block.includes("negotiation_rules_summary"), false);
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
