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
  const start = source.indexOf('title="Agenda e capacidade"');
  assert.equal(start > -1, true, "operation edit form not found");
  const end = source.indexOf('title="Regi', start);
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

function getChannelsSaveBlock(source: string) {
  const start = source.indexOf("  const handleChannelsEditSave = useCallback(async () => {");
  assert.equal(start > -1, true, "handleChannelsEditSave not found");
  const end = source.indexOf("  }, [", start);
  assert.equal(end > start, true, "handleChannelsEditSave end not found");
  return source.slice(start, end);
}

function getGeneralAddressCompletionBlock(source: string) {
  const start = source.indexOf("function isGeneralAddressComplete(");
  assert.equal(start > -1, true, "isGeneralAddressComplete not found");
  const end = source.indexOf("function formatMonthlyGoalDraftAmount(", start);
  assert.equal(end > start, true, "isGeneralAddressComplete end not found");
  return source.slice(start, end);
}

function getCepLookupBlock(source: string) {
  const start = source.indexOf("  const lookupGeneralAddressCep = useCallback(async (cepDigits: string) => {");
  assert.equal(start > -1, true, "lookupGeneralAddressCep not found");
  const end = source.indexOf("  const handleGeneralAddressSave = useCallback(", start);
  assert.equal(end > start, true, "lookupGeneralAddressCep end not found");
  return source.slice(start, end);
}

function getGeneralAddressSectionBlock(source: string) {
  const start = source.indexOf('title="Endereço da loja"');
  assert.equal(start > -1, true, "general address section not found");
  const end = source.indexOf('title="Responsável principal"', start);
  assert.equal(end > start, true, "general address section end not found");
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

function getScheduleAuthorityHelpersBlock(source: string) {
  const start = source.indexOf("function isConfiguredTimestamp(");
  assert.equal(start > -1, true, "schedule authority helpers not found");
  const end = source.indexOf("function optionLabel(", start);
  assert.equal(end > start, true, "schedule authority helpers end not found");
  return source.slice(start, end);
}

function getHumanScheduleSaveBlock(source: string) {
  const start = source.indexOf("  const saveHumanScheduleCard = useCallback(async () => {");
  assert.equal(start > -1, true, "saveHumanScheduleCard not found");
  const end = source.indexOf("  const saveAfterHoursCard = useCallback(async () => {", start);
  assert.equal(end > start, true, "saveHumanScheduleCard end not found");
  return source.slice(start, end);
}

function getAfterHoursSaveBlock(source: string) {
  const start = source.indexOf("  const saveAfterHoursCard = useCallback(async () => {");
  assert.equal(start > -1, true, "saveAfterHoursCard not found");
  const end = source.indexOf("  const saveAgendaCapacityCard = useCallback(async () => {", start);
  assert.equal(end > start, true, "saveAfterHoursCard end not found");
  return source.slice(start, end);
}

function getAgendaCapacitySaveBlock(source: string) {
  const start = source.indexOf("  const saveAgendaCapacityCard = useCallback(async () => {");
  assert.equal(start > -1, true, "saveAgendaCapacityCard not found");
  const end = source.indexOf("  const handleOverviewDraftChange = useCallback(", start);
  assert.equal(end > start, true, "saveAgendaCapacityCard end not found");
  return source.slice(start, end);
}

function getOperationScheduleCardsBlock(source: string) {
  const start = source.indexOf('title="Horários da equipe"');
  assert.equal(start > -1, true, "operation schedule cards block not found");
  const end = source.indexOf('title="Regi', start);
  assert.equal(end > start, true, "operation schedule cards block end not found");
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
  const start = source.indexOf("const currentOperationInput = createStoreOperationSettingsInputFromSources({");
  assert.equal(start > -1, true, "overview draft effect not found");
  const end = source.indexOf("setSelectedStoreLogoFile(null);", start);
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
  const end = source.indexOf("  useEffect(() => {", start);
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
  const start = source.indexOf('overviewEditTarget === "store"');
  assert.equal(start > -1, true, "overview edit form not found");
  const end = source.indexOf('title="Endereço da loja"', start);
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
  const start = source.indexOf("setPrimaryResponsibleDraft(canonicalPrimaryResponsibleDraft);");
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

const tests: TestCase[] = [
  {
    name: "general address completion requires physical address essentials but never CEP",
    run: () => {
      const source = readPageSource();
      const block = getGeneralAddressCompletionBlock(source);

      assert.equal(block.includes('address.has_public_address === "Não"'), true);
      assert.equal(block.includes('address.has_public_address !== "Sim"'), true);
      assert.equal(block.includes("cleanText(address.street)"), true);
      assert.equal(block.includes("cleanText(address.number)"), true);
      assert.equal(block.includes("cleanText(address.district)"), true);
      assert.equal(block.includes("cleanText(address.city)"), true);
      assert.equal(block.includes("cleanText(address.state)"), true);
      assert.equal(block.includes("isValidCustomerVisitMode(address.customer_visit_mode)"), true);
      assert.equal(block.includes("address.cep"), false);
      assert.equal(block.includes("address.complement"), false);
      assert.equal(block.includes("address.reference_point"), false);
      assert.equal(block.includes("address.directions_notes"), false);
    },
  },
  {
    name: "general address card status uses the canonical completion helper",
    run: () => {
      const source = readPageSource();
      const block = getGeneralAddressSectionBlock(source);

      assert.equal(block.includes('tone={isGeneralAddressComplete(savedGeneralAddress) ? "blue" : "yellow"}'), true);
      assert.equal(block.includes('status={isGeneralAddressComplete(savedGeneralAddress) ? "Completo" : "Precisa de atenção"}'), true);
      assert.equal(block.includes("savedGeneralAddress.cep"), false);
    },
  },
  {
    name: "CEP lookup fills only returned address fields and preserves manual fields on failures",
    run: () => {
      const source = readPageSource();
      const block = getCepLookupBlock(source);

      assert.equal(block.includes('fetch(`/api/store/cep?cep=${encodeURIComponent(cepDigits)}`'), true);
      assert.equal(block.includes("street: cleanText(result.address.street) || current.street"), true);
      assert.equal(block.includes("district: cleanText(result.address.district) || current.district"), true);
      assert.equal(block.includes("city: cleanText(result.address.city) || current.city"), true);
      assert.equal(block.includes("state: cleanText(result.address.state) || current.state"), true);
      assert.equal(block.includes("number:"), false);
      assert.equal(block.includes("complement:"), false);
      assert.equal(block.includes("reference_point:"), false);
      assert.equal(block.includes("directions_notes:"), false);
      assert.equal(block.includes("CEP nao encontrado"), true);
      assert.equal(block.includes("Nao foi possivel consultar o CEP agora"), true);
    },
  },
  {
    name: "CEP input is optional, masked, and triggers lookup only when complete",
    run: () => {
      const source = readPageSource();
      const lookupBlock = getCepLookupBlock(source);
      const sectionBlock = getGeneralAddressSectionBlock(source);

      assert.equal(source.includes("function formatBrazilianCepInput("), true);
      assert.equal(lookupBlock.includes("const digits = onlyCepDigits(formattedCep);"), true);
      assert.equal(lookupBlock.includes("if (digits.length === 8)"), true);
      assert.equal(sectionBlock.includes('placeholder="00000-000"'), true);
      assert.equal(sectionBlock.includes('inputMode="numeric"'), true);
      assert.equal(sectionBlock.includes("handleGeneralAddressCepChange(e.target.value)"), true);
      assert.equal(sectionBlock.includes("generalAddressCepLookupLoading"), true);
      assert.equal(sectionBlock.includes("generalAddressCepLookupMessage"), true);
    },
  },
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
      const operationRpcIndex = block.indexOf('"upsert_store_operation_settings_with_legacy_mirror_scoped"');
      const scheduleGateIndex = block.indexOf("if (scheduleSettings) {");
      const weekendDerivationIndex = block.indexOf("const updatedOperatingDays = applyWeekendSelectionToOperatingDays({");
      const scheduleRpcIndex = block.indexOf('await supabase.rpc("upsert_store_schedule_settings"');
      assert.equal(operationRpcIndex > -1, true);
      assert.equal(scheduleGateIndex > operationRpcIndex, true);
      assert.equal(weekendDerivationIndex > scheduleGateIndex, true);
      assert.equal(scheduleRpcIndex > scheduleGateIndex, true);
      assert.equal(block.includes("scheduleSettings?.operating_days ?? []"), false);
      assert.equal(block.includes("scheduleSettings?.allow_multiple_appointments_per_day ?? true"), false);
      assert.equal(block.includes("scheduleSettings?.allow_same_time_appointments ?? false"), false);
      assert.equal(block.includes("scheduleSettings?.attends_holidays ?? false"), false);
      assert.equal(block.includes('scheduleSettings?.timezone_name || "America/Sao_Paulo"'), false);
      assert.equal(block.includes("onboarding_upsert_answer_scoped"), false);
    },
  },
  {
    name: "schedule reader selects canonical configuration fields",
    run: () => {
      const source = readPageSource();
      const block = getFetchPageDataBlock(source);

      [
        "human_schedule_configured_at",
        "ai_after_hours_configured_at",
        "agenda_capacity_configured_at",
        "holiday_mode",
        "holiday_open_time",
        "holiday_close_time",
        "holiday_notes",
        "daily_limit_mode",
        "daily_limit",
        "appointment_buffer_enabled",
        "appointment_buffer_minutes",
        "ai_after_hours_enabled",
        "ai_after_hours_mode",
        "ai_after_hours_start",
        "ai_after_hours_end",
        "ai_attends_holidays",
      ].forEach((field) => assert.equal(block.includes(field), true, field));
    },
  },
  {
    name: "schedule refresh hydrates migrated operation cards from canonical row",
    run: () => {
      const source = readPageSource();
      const block = getFetchPageDataBlock(source);

      assert.equal(block.includes("const nextScheduleSettings ="), true);
      assert.equal(block.includes("createScheduleOperationExperienceDraftFromSettings("), true);
      assert.equal(block.includes("setSavedOperationExperience((current) =>"), true);
      assert.equal(block.includes("setOperationExperienceDraft((current) =>"), true);
      assert.equal(block.includes("nextScheduleSettings"), true);
    },
  },
  {
    name: "schedule localStorage restore preserves canonical operation authority",
    run: () => {
      const source = readPageSource();
      const restoreBlock = getRestoreLocalDraftBlock(source);

      assert.equal(source.includes("function restoreOperationDraftWithoutScheduleAuthority("), true);
      assert.equal(restoreBlock.includes("restoreOperationDraftWithoutScheduleAuthority(current, parsed.operationDraft ?? {})"), true);
      assert.equal(source.includes("serves_holiday: current.serves_holiday"), true);
      assert.equal(source.includes("allow_multiple_appointments_per_day:"), true);
      assert.equal(source.includes("allow_same_time_appointments: current.allow_same_time_appointments"), true);
      assert.equal(source.includes("agenda_capacity_rule: current.agenda_capacity_rule"), true);
    },
  },
  {
    name: "schedule card statuses depend on configured_at timestamps",
    run: () => {
      const source = readPageSource();
      const helpers = getScheduleAuthorityHelpersBlock(source);
      const cards = getOperationScheduleCardsBlock(source);

      assert.equal(helpers.includes("scheduleSettings?.human_schedule_configured_at"), true);
      assert.equal(helpers.includes("scheduleSettings?.ai_after_hours_configured_at"), true);
      assert.equal(helpers.includes("scheduleSettings?.agenda_capacity_configured_at"), true);
      assert.equal(cards.includes("resolveHumanScheduleCardStatus(scheduleSettings)"), true);
      assert.equal(cards.includes("resolveAfterHoursCardStatus(scheduleSettings)"), true);
      assert.equal(cards.includes("resolveAgendaCapacityCardStatus(scheduleSettings)"), true);
      assert.equal(cards.includes('tone={scheduleSettings ? "blue" : "yellow"}'), false);
    },
  },
  {
    name: "schedule hours card calls human schedule RPC with canonical days and hours",
    run: () => {
      const source = readPageSource();
      const saveBlock = getHumanScheduleSaveBlock(source);
      const helpers = getScheduleAuthorityHelpersBlock(source);
      const cards = getOperationScheduleCardsBlock(source);

      assert.equal(saveBlock.includes('"upsert_store_human_schedule_configuration_scoped"'), true);
      assert.equal(saveBlock.includes("p_operating_days: payload.operatingDays"), true);
      assert.equal(saveBlock.includes("p_operating_hours: payload.operatingHours"), true);
      assert.equal(saveBlock.includes("p_timezone_name: payload.timezoneName"), true);
      assert.equal(helpers.includes("const selectedDays = CANONICAL_OPERATION_DAYS.filter"), true);
      assert.equal(helpers.includes("operatingHours[day] = { start: open, end: close };"), true);
      assert.equal(cards.includes("saveHumanScheduleCard()"), true);
      assert.equal(cards.includes('saveOperationExperienceCard("hours"'), false);
    },
  },
  {
    name: "schedule hours maps same hours to every selected day and preserves per-day values",
    run: () => {
      const source = readPageSource();
      const helpers = getScheduleAuthorityHelpersBlock(source);
      const cards = getOperationScheduleCardsBlock(source);

      assert.equal(helpers.includes('const sameHours = normalizeLoose(draft.team_same_hours) !== "nao";'), true);
      assert.equal(helpers.includes("? normalizeTimeInput(draft.team_open_time)"), true);
      assert.equal(helpers.includes("? normalizeTimeInput(draft.team_close_time)"), true);
      assert.equal(helpers.includes(": normalizeTimeInput(draft.team_day_hours[day]?.open)"), true);
      assert.equal(helpers.includes(": normalizeTimeInput(draft.team_day_hours[day]?.close)"), true);
      assert.equal(cards.includes("Horário específico de sábado"), false);
      assert.equal(cards.includes("Horário específico de domingo"), false);
    },
  },
  {
    name: "schedule hours maps holiday modes to canonical RPC values",
    run: () => {
      const source = readPageSource();
      const helpers = getScheduleAuthorityHelpersBlock(source);
      const saveBlock = getHumanScheduleSaveBlock(source);

      assert.equal(helpers.includes('if (normalized === "fechado") return "closed";'), true);
      assert.equal(helpers.includes('if (normalized === "normal") return "normal";'), true);
      assert.equal(helpers.includes('if (normalized === "especial") return "special";'), true);
      assert.equal(helpers.includes('if (normalized === "caso_a_caso") return "case_by_case";'), true);
      assert.equal(saveBlock.includes("p_holiday_mode: payload.holidayMode"), true);
      assert.equal(saveBlock.includes("p_holiday_open_time: payload.holidayOpenTime"), true);
      assert.equal(saveBlock.includes("p_holiday_close_time: payload.holidayCloseTime"), true);
      assert.equal(saveBlock.includes("p_holiday_notes: payload.holidayNotes"), true);
    },
  },
  {
    name: "schedule after-hours calls real RPC and maps UI booleans and modes",
    run: () => {
      const source = readPageSource();
      const saveBlock = getAfterHoursSaveBlock(source);
      const helpers = getScheduleAuthorityHelpersBlock(source);
      const cards = getOperationScheduleCardsBlock(source);

      assert.equal(saveBlock.includes('"upsert_store_schedule_ai_after_hours_policy_scoped"'), true);
      assert.equal(saveBlock.includes("const enabled = parseYesNoToNullableBoolean("), true);
      assert.equal(saveBlock.includes("p_ai_after_hours_enabled: enabled"), true);
      assert.equal(helpers.includes('if (normalized === "todo_fechado") return "all_closed_hours";'), true);
      assert.equal(helpers.includes('if (normalized === "janela") return "specific_window";'), true);
      assert.equal(saveBlock.includes("p_ai_after_hours_mode: mode"), true);
      assert.equal(saveBlock.includes("p_ai_attends_holidays: enabled"), true);
      assert.equal(cards.includes("saveAfterHoursCard()"), true);
      assert.equal(cards.includes("setSavedOperationExperience(operationExperienceDraft);setOperationEditTarget(null);"), false);
    },
  },
  {
    name: "schedule after-hours configured_at null is not explicit no",
    run: () => {
      const source = readPageSource();
      const helpers = getScheduleAuthorityHelpersBlock(source);

      assert.equal(helpers.includes("const afterHoursConfigured = isConfiguredTimestamp(scheduleSettings.ai_after_hours_configured_at);"), true);
      assert.equal(helpers.includes("yesNoLabel(scheduleSettings.ai_after_hours_enabled)"), true);
      assert.equal(helpers.includes("ai_after_hours_enabled: afterHoursConfigured"), true);
      assert.equal(helpers.includes("scheduleSettings?.ai_after_hours_enabled === false"), true);
    },
  },
  {
    name: "schedule agenda calls capacity RPC and maps all capacity fields",
    run: () => {
      const source = readPageSource();
      const saveBlock = getAgendaCapacitySaveBlock(source);
      const helpers = getScheduleAuthorityHelpersBlock(source);
      const cards = getOperationScheduleCardsBlock(source);

      assert.equal(saveBlock.includes('"upsert_store_agenda_capacity_configuration_scoped"'), true);
      assert.equal(saveBlock.includes("p_allow_multiple_appointments_per_day: allowMultipleAppointmentsPerDay"), true);
      assert.equal(saveBlock.includes("p_allow_same_time_appointments: allowSameTimeAppointments ?? false"), true);
      assert.equal(saveBlock.includes("p_appointment_buffer_enabled: appointmentBufferEnabled ?? false"), true);
      assert.equal(saveBlock.includes("p_daily_limit_mode: dailyLimitMode"), true);
      assert.equal(saveBlock.includes("p_daily_limit: dailyLimit"), true);
      assert.equal(saveBlock.includes("p_same_time_capacity: sameTimeCapacity"), true);
      assert.equal(saveBlock.includes("p_appointment_buffer_minutes: appointmentBufferMinutes"), true);
      assert.equal(helpers.includes('if (normalized === "limite") return "fixed_limit";'), true);
      assert.equal(helpers.includes('if (normalized === "sem_limite") return "no_fixed_limit";'), true);
      assert.equal(cards.includes("saveAgendaCapacityCard()"), true);
      assert.equal(cards.includes("handleOperationEditSave()"), false);
    },
  },
  {
    name: "schedule agenda validates multiple appointment choices before save",
    run: () => {
      const source = readPageSource();
      const saveBlock = getAgendaCapacitySaveBlock(source);

      assert.equal(saveBlock.includes("if (allowMultipleAppointmentsPerDay && allowSameTimeAppointments == null)"), true);
      assert.equal(saveBlock.includes("if (allowMultipleAppointmentsPerDay && appointmentBufferEnabled == null)"), true);
      assert.equal(saveBlock.includes("if (allowMultipleAppointmentsPerDay && !dailyLimitMode)"), true);
      assert.equal(saveBlock.includes("allowMultipleAppointmentsPerDay && dailyLimitMode === \"fixed_limit\""), true);
      assert.equal(saveBlock.includes("allowMultipleAppointmentsPerDay && allowSameTimeAppointments"), true);
      assert.equal(saveBlock.includes("allowMultipleAppointmentsPerDay && appointmentBufferEnabled"), true);
    },
  },
  {
    name: "schedule agenda configured_at null is not complete",
    run: () => {
      const source = readPageSource();
      const helpers = getScheduleAuthorityHelpersBlock(source);
      const cards = getOperationScheduleCardsBlock(source);

      assert.equal(helpers.includes("scheduleSettings?.agenda_capacity_configured_at"), true);
      assert.equal(helpers.includes("const agendaConfigured = isConfiguredTimestamp(scheduleSettings.agenda_capacity_configured_at);"), true);
      assert.equal(cards.includes("isConfiguredTimestamp(scheduleSettings?.agenda_capacity_configured_at) ? yesNoLabel"), true);
    },
  },
  {
    name: "schedule migrated cards update canonical state only after RPC success",
    run: () => {
      const source = readPageSource();
      const human = getHumanScheduleSaveBlock(source);
      const afterHours = getAfterHoursSaveBlock(source);
      const agenda = getAgendaCapacitySaveBlock(source);

      [human, afterHours, agenda].forEach((block) => {
        assert.equal(block.includes("if (scheduleError) throw scheduleError;"), true);
        assert.equal(block.includes("setScheduleSettings(nextScheduleSettings);"), true);
        assert.equal(block.includes("setSavedOperationExperience(nextDraft);"), true);
        assert.equal(block.includes("setOperationExperienceDraft(nextDraft);"), true);
        assert.equal(block.includes("setOperationEditTarget(null);"), true);
        assert.equal(block.includes("await fetchPageData();"), true);
        assert.equal(block.includes("catch (error: any)"), true);
      });
    },
  },
  {
    name: "schedule migrated cards do not use local-only save as conclusion",
    run: () => {
      const source = readPageSource();
      const cards = getOperationScheduleCardsBlock(source);

      assert.equal(cards.includes('saveOperationExperienceCard("hours"'), false);
      assert.equal(cards.includes("setSavedOperationExperience(operationExperienceDraft)"), false);
      assert.equal(cards.includes("handleOperationEditSave()"), false);
      assert.equal(cards.includes("upsert_store_schedule_settings"), false);
    },
  },
  {
    name: "operation edit form keeps agenda absence canonical instead of inventing schedule settings",
    run: () => {
      const source = readPageSource();
      const formBlock = getOperationEditFormBlock(source);

      assert.equal(
        source.includes("Agenda canônica ainda não configurada."),
        true,
      );
      assert.equal(formBlock.includes("operationEditTarget === \"agenda\""), true);
      assert.equal(formBlock.includes("operationDraft.allow_multiple_appointments_per_day"), true);
      assert.equal(formBlock.includes("operationDraft.allow_same_time_appointments"), true);
      assert.equal(formBlock.includes("operationDraft.agenda_capacity_rule"), true);
      assert.equal(formBlock.includes("upsert_store_schedule_settings"), false);
      assert.equal(source.includes("CANONICAL_SCHEDULE_NOT_CONFIGURED_LABEL"), true);
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
      assert.equal(source.includes("Atende sábado"), true);
      assert.equal(source.includes("Atende domingo"), true);
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

      assert.equal(sectionsBlock.includes("scheduleSettings ? yesNoLabel(scheduleSettings.attends_holidays)"), false);
      assert.equal(sectionsBlock.includes("servesHolidayLabel"), true);
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
        restoreBlock.includes("restoreOperationDraftWithoutScheduleAuthority(current, parsed.operationDraft ?? {})"),
        true,
      );
      assert.equal(source.includes("normalizePersistedOperationDraft(current, persisted)"), true);
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
      const rpcIndex = block.indexOf('"upsert_store_operation_settings_with_legacy_mirror_scoped"');
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
      const overviewTabStart = source.indexOf('{activeTab === "geral" ? (');
      const overviewTabEnd = source.indexOf('{activeTab === "operacao" ? (', overviewTabStart);
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
    name: "pool strategy reader uses canonical strategy brand fields instead of legacy answers",
    run: () => {
      const source = readPageSource();
      const poolsOperationalBlock = getPoolsOperationalItemsBlock(source);

      assert.equal(
        poolsOperationalBlock.includes("strategySettingsInput.mainStoreBrand"),
        true,
      );
      assert.equal(
        poolsOperationalBlock.includes("strategySettingsInput.brandsWorked"),
        true,
      );
      assert.equal(
        poolsOperationalBlock.includes("answers.main_store_brand"),
        false,
      );
      assert.equal(
        poolsOperationalBlock.includes("answers.brands_worked"),
        false,
      );
    },
  },
  {
    name: "commercial editor uses isolated canonical payment writer and avoids shared legacy sync for payments",
    run: () => {
      const source = readPageSource();
      const block = getCommercialSaveBlock(source);

      const paymentSyncIndex = block.indexOf(
        '"upsert_store_payment_methods_and_terms_with_legacy_mirror_scope"',
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
        block.includes("const normalizedPaymentSettings = normalizeStorePaymentSettingsInput({"),
        true,
      );
      assert.equal(block.includes("setPaymentSettings("), true);
      assert.equal(
        block.includes('if (commercialEditTarget !== "payments") {'),
        true,
      );
      assert.equal(
        block.includes("payment_extensions: pickDraftFields(commercialExperienceDraft, ["),
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
    },
  },
  {
    name: "commercial payment read-only view uses canonical shared payment presentation without legacy review UI",
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
        false,
      );
    },
  },
  {
    name: "commercial edit form keeps only canonical payment buttons and does not expose legacy condition review UI",
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
        false,
      );
      assert.equal(
        source.includes("Dados antigos para revisar:"),
        false,
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
    name: "discount save uses one atomic canonical writer and does not write competing authorities",
    run: () => {
      const source = readPageSource();
      const block = getDiscountSaveBlock(source);

      assert.equal(
        block.includes('"upsert_store_discount_card_scoped"'),
        true,
      );

      for (const argument of [
        "p_organization_id:",
        "p_store_id:",
        "p_default_discount_percent:",
        "p_max_discount_percent:",
        "p_allow_ask_above_max_discount:",
        "p_discount_autonomy_mode:",
        "p_discount_special_rules:",
        "p_high_value_enabled:",
        "p_high_value_threshold_amount_cents:",
        "p_high_value_discount_percent:",
        "p_high_value_requires_human:",
        "p_discount_explanation:",
      ]) {
        assert.equal(
          block.includes(argument),
          true,
          "missing atomic discount argument " + argument,
        );
      }

      assert.equal(
        block.includes('"upsert_store_discount_settings_with_legacy_mirror_scoped"'),
        false,
      );
      assert.equal(
        block.includes('"upsert_store_high_value_discount_settings_scoped"'),
        false,
      );
      assert.equal(
        block.includes("upsertSettingsExperiencePolicies("),
        false,
      );
      assert.equal(
        block.includes("upsertConfigAnswers("),
        false,
      );

      assert.equal(block.includes("human_help_discount_cases:"), false);
      assert.equal(block.includes("human_help_discount_cases_selected"), false);
      assert.equal(block.includes("human_help_discount_cases_other"), false);
      assert.equal(block.includes("discount_approver_name:"), false);
      assert.equal(block.includes("discount_special_rules: discountDraft"), false);
    },
  },
  {    name: "discount read-only summary uses canonical presentation and high-value approval authority",
    run: () => {
      const source = readPageSource();
      const block = getDiscountItemsBlock(source);

      for (const label of [
        'label: "Desconto inicial para negociar"',
        'label: "Maior desconto da negociação normal"',
        'label: "A IA pode confirmar sozinha"',
        'label: "Pode consultar acima do limite"',
        'label: "Regra para vendas de valor alto"',
        'label: "Aprovação em venda de valor alto"',
      ]) {
        assert.equal(
          block.includes(label),
          true,
          "missing canonical discount summary label " + label,
        );
      }

      assert.equal(
        block.includes(
          'discountPresentation.autonomyMode === "within_policy_autonomous"',
        ),
        true,
      );
      assert.equal(
        block.includes(
          'discountPresentation.autonomyMode === "default_step_autonomous"',
        ),
        true,
      );
      assert.equal(
        block.includes(
          "savedCommercialExperience.high_value_requires_human",
        ),
        true,
      );

      assert.equal(block.includes("price_direct_rule"), false);
      assert.equal(block.includes("price_must_understand_before"), false);
      assert.equal(block.includes("negotiation_rules_summary"), false);
    },
  },
  {    name: "discount edit draft replaces only the known legacy explanation with the safe autonomy-aware copy",
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
  const filter = String(process.env.CONFIGURACOES_PAGE_TEST_FILTER || "").trim().toLowerCase();
  const selectedTests = filter
    ? tests.filter((test) => test.name.toLowerCase().includes(filter))
    : tests;

  assert.equal(selectedTests.length > 0, true, "no tests matched filter");

  for (const test of selectedTests) {
    test.run();
  }

  console.log(`configuracoes-page: ${selectedTests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
