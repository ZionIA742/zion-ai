import test from "node:test";
import assert from "node:assert/strict";

import {
  applyWeekendSelectionToOperatingDays,
  createStoreOperationSettingsInputFromSources,
  deriveWeekendAvailabilityFromOperatingDays,
  normalizeOperationTechnicalVisitRules,
  normalizeOperatingDays,
  normalizePersistedOperationDraft,
  normalizeStoreOperationSettingsInput,
  parseOperationAverageInstallationTimeInput,
} from "./store-operation-settings.js";

const canonicalOperationDraft = {
  operating_days: "segunda, terca, quarta",
  operating_hours: "08:00-18:00",
  installation_days_rule: "canonico instalacao",
  technical_visit_days_rule: "canonico visita",
  serves_saturday: "Sim",
  serves_sunday: "Não",
  serves_holiday: "Não definido",
  allow_multiple_appointments_per_day: "Sim",
  allow_same_time_appointments: "Não",
  offers_installation: "Sim",
  average_installation_time_days: "2",
  installation_process_summary: "notas canonicas",
  offers_technical_visit: "Sim",
  technical_visit_rules_selected: ["precisa_agendar", "confirmar_endereco"],
  technical_visit_rules_other: "observacao canonica",
  agenda_capacity_rule: "1",
};

test("canonical operation settings win over contaminated legacy answers", () => {
  const input = createStoreOperationSettingsInputFromSources({
    answers: {
      offers_installation: "não",
      average_installation_time_days: "99 Dias",
      installation_process_other: "LEGACY_CONTAMINATED",
      technical_visit_rules_selected: [
        "somente_regiao_atendida",
        "horario_comercial",
      ],
      technical_visit_rules_other: "LEGACY_CONTAMINATED",
    },
    settings: {
      organization_id: "org-1",
      store_id: "store-1",
      offers_installation: true,
      average_installation_time_days: 2,
      installation_days_rule: null,
      installation_process_notes: null,
      offers_technical_visit: true,
      technical_visit_days_rule: null,
      technical_visit_rules: [
        "precisa_agendar",
        "confirmar_endereco",
      ],
      technical_visit_rules_other: null,
    },
  });

  assert.equal(input.offersInstallation, true);
  assert.equal(input.averageInstallationTimeDays, 2);
  assert.deepEqual(input.technicalVisitRules, [
    "precisa_agendar",
    "confirmar_endereco",
  ]);
  assert.equal(input.installationProcessNotes, "");
  assert.equal(input.technicalVisitRulesOther, "");
});

test("canonical null does not silently fall back to legacy", () => {
  const input = createStoreOperationSettingsInputFromSources({
    answers: {
      offers_installation: true,
      average_installation_time_days: "7",
    },
    settings: {
      organization_id: "org-1",
      store_id: "store-1",
      offers_installation: null,
      average_installation_time_days: null,
      installation_days_rule: null,
      installation_process_notes: null,
      offers_technical_visit: null,
      technical_visit_days_rule: null,
      technical_visit_rules: [],
      technical_visit_rules_other: null,
    },
  });

  assert.equal(input.offersInstallation, null);
  assert.equal(input.averageInstallationTimeDays, null);
});

test("missing canonical operation settings do not fall back to legacy answers", () => {
  const input = createStoreOperationSettingsInputFromSources({
    answers: {
      offers_installation: "Sim",
      average_installation_time_days: "2 Dias",
      installation_days_rule: "Somente com agendamento",
      offers_technical_visit: true,
      technical_visit_days_rule: "Consultar disponibilidade",
      technical_visit_rules_selected: [
        "precisa_agendar",
        "somente_regiao_atendida",
        "confirmar_endereco",
        "horario_comercial",
        "pode_ter_taxa",
      ],
      installation_process_other: "NAO_PROMOVER",
      technical_visit_rules_other: "NAO_PROMOVER",
    },
  });

  assert.equal(input.offersInstallation, null);
  assert.equal(input.averageInstallationTimeDays, null);
  assert.equal(input.installationDaysRule, "");
  assert.equal(input.offersTechnicalVisit, null);
  assert.equal(input.technicalVisitDaysRule, "");
  assert.deepEqual(input.technicalVisitRules, []);
  assert.equal(input.installationProcessNotes, "");
  assert.equal(input.technicalVisitRulesOther, "");
});

test("partial save base without canonical row writes only explicit patch over empty defaults", () => {
  const normalized = normalizeStoreOperationSettingsInput({
    ...createStoreOperationSettingsInputFromSources({
      answers: {
        offers_installation: "Sim",
        average_installation_time_days: "9",
        installation_days_rule: "LEGACY_INSTALLATION",
        offers_technical_visit: "Sim",
        technical_visit_days_rule: "LEGACY_VISIT",
        technical_visit_rules_selected: ["precisa_agendar"],
        technical_visit_rules_other: "LEGACY_OTHER",
      },
      settings: null,
    }),
    offersInstallation: false,
  });

  assert.equal(normalized.ok, true);
  if (!normalized.ok) return;

  assert.deepEqual(normalized.value, {
    offersInstallation: false,
    averageInstallationTimeDays: null,
    installationDaysRule: "",
    installationProcessNotes: "",
    offersTechnicalVisit: null,
    technicalVisitDaysRule: "",
    technicalVisitRules: [],
    technicalVisitRulesOther: "",
  });
});

test("partial save base with canonical row preserves fields not altered by patch", () => {
  const normalized = normalizeStoreOperationSettingsInput({
    ...createStoreOperationSettingsInputFromSources({
      answers: {
        offers_installation: "nÃ£o",
        installation_days_rule: "LEGACY_INSTALLATION",
        technical_visit_days_rule: "LEGACY_VISIT",
      },
      settings: {
        organization_id: "org-1",
        store_id: "store-1",
        offers_installation: true,
        average_installation_time_days: 4,
        installation_days_rule: "CANONICAL_INSTALLATION",
        installation_process_notes: "CANONICAL_NOTES",
        offers_technical_visit: true,
        technical_visit_days_rule: "CANONICAL_VISIT",
        technical_visit_rules: ["precisa_agendar", "pode_ter_taxa"],
        technical_visit_rules_other: "CANONICAL_OTHER",
      },
    }),
    offersInstallation: false,
  });

  assert.equal(normalized.ok, true);
  if (!normalized.ok) return;

  assert.equal(normalized.value.offersInstallation, false);
  assert.equal(normalized.value.averageInstallationTimeDays, 4);
  assert.equal(normalized.value.installationDaysRule, "CANONICAL_INSTALLATION");
  assert.equal(normalized.value.installationProcessNotes, "CANONICAL_NOTES");
  assert.equal(normalized.value.offersTechnicalVisit, true);
  assert.equal(normalized.value.technicalVisitDaysRule, "CANONICAL_VISIT");
  assert.deepEqual(normalized.value.technicalVisitRules, [
    "precisa_agendar",
    "pode_ter_taxa",
  ]);
  assert.equal(normalized.value.technicalVisitRulesOther, "CANONICAL_OTHER");
});

test("weekend toggles preserve the canonical operating days array", () => {
  assert.deepEqual(
    applyWeekendSelectionToOperatingDays({
      currentDays: ["segunda", "sexta"],
      saturdaySelection: "Sim",
      sundaySelection: "Nao definido",
    }),
    ["segunda", "sexta", "sabado"],
  );

  assert.deepEqual(
    applyWeekendSelectionToOperatingDays({
      currentDays: ["segunda", "sabado", "sexta"],
      saturdaySelection: "Nao",
      sundaySelection: "Nao definido",
    }),
    ["segunda", "sexta"],
  );

  assert.deepEqual(
    applyWeekendSelectionToOperatingDays({
      currentDays: ["terca", "domingo", "quinta"],
      saturdaySelection: "Nao definido",
      sundaySelection: "Nao",
    }),
    ["terca", "quinta"],
  );

  assert.deepEqual(
    applyWeekendSelectionToOperatingDays({
      currentDays: ["quarta", "sexta"],
      saturdaySelection: "Nao definido",
      sundaySelection: "Sim",
    }),
    ["quarta", "sexta", "domingo"],
  );

  assert.deepEqual(
    applyWeekendSelectionToOperatingDays({
      currentDays: ["segunda", "domingo"],
      saturdaySelection: "Nao definido",
      sundaySelection: "Nao definido",
    }),
    ["segunda", "domingo"],
  );
});

test("canonical operating days drive weekend draft and no-op save despite legacy answers", () => {
  const scheduleOperatingDays = [
    "segunda",
    "terca",
    "quarta",
    "quinta",
    "sexta",
    "sabado",
  ];
  const contaminatedAnswers = {
    serves_saturday: "Não",
  };

  const draft = deriveWeekendAvailabilityFromOperatingDays(scheduleOperatingDays);

  assert.equal(contaminatedAnswers.serves_saturday, "Não");
  assert.equal(draft.serves_saturday, "Sim");
  assert.equal(
    deriveWeekendAvailabilityFromOperatingDays(scheduleOperatingDays)
      .serves_saturday,
    "Sim",
  );
  assert.deepEqual(
    applyWeekendSelectionToOperatingDays({
      currentDays: scheduleOperatingDays,
      saturdaySelection: draft.serves_saturday,
      sundaySelection: "Não definido",
    }),
    scheduleOperatingDays,
  );

  const sundayScheduleOperatingDays = [
    "segunda",
    "terça",
    "quarta",
    "quinta",
    "sexta",
    "domingo",
  ];
  const contaminatedSundayAnswers = {
    serves_sunday: "Não",
  };
  const sundayDraft = deriveWeekendAvailabilityFromOperatingDays(
    sundayScheduleOperatingDays,
  );

  assert.equal(contaminatedSundayAnswers.serves_sunday, "Não");
  assert.equal(sundayDraft.serves_sunday, "Sim");
  assert.equal(
    deriveWeekendAvailabilityFromOperatingDays(sundayScheduleOperatingDays)
      .serves_sunday,
    "Sim",
  );
  assert.deepEqual(
    applyWeekendSelectionToOperatingDays({
      currentDays: sundayScheduleOperatingDays,
      saturdaySelection: "Não definido",
      sundaySelection: sundayDraft.serves_sunday,
    }),
    ["segunda", "terca", "quarta", "quinta", "sexta", "domingo"],
  );
});

test("legacy localStorage operation draft is migrated over the canonical draft", () => {
  const migrated = normalizePersistedOperationDraft(canonicalOperationDraft, {
    installation_days_rule: "SMOKE P19A 3.3",
    technical_visit_rules_other: "observacao editada",
  });

  assert.equal(migrated.installation_days_rule, "SMOKE P19A 3.3");
  assert.equal(migrated.technical_visit_rules_other, "observacao editada");
  assert.deepEqual(migrated.technical_visit_rules_selected, [
    "precisa_agendar",
    "confirmar_endereco",
  ]);
  assert.equal(migrated.serves_saturday, "Sim");
  assert.equal(migrated.average_installation_time_days, "2");
});

test("obsolete operation draft fields are ignored during localStorage migration", () => {
  const migrated = normalizePersistedOperationDraft(canonicalOperationDraft, {
    technical_visit_rules_summary: "NAO_REINTRODUZIR",
    service_regions: "NAO_REINTRODUZIR",
    important_limitations: "NAO_REINTRODUZIR",
    operational_ai_summary: "NAO_REINTRODUZIR",
    technical_visit_rules_selected: [
      "precisa_agendar",
      "somente_regiao_atendida",
      "pode_ter_taxa",
    ],
  }) as typeof canonicalOperationDraft & Record<string, unknown>;

  assert.equal(migrated.technical_visit_rules_summary, undefined);
  assert.equal(migrated.service_regions, undefined);
  assert.equal(migrated.important_limitations, undefined);
  assert.equal(migrated.operational_ai_summary, undefined);
  assert.deepEqual(migrated.technical_visit_rules_selected, [
    "precisa_agendar",
    "pode_ter_taxa",
  ]);
});

test("legacy day fallbacks normalize accented and equivalent variants", () => {
  assert.deepEqual(
    normalizeOperatingDays([
      "terça",
      "sabado",
      "sábado",
      "Terca-feira",
      "segunda-feira",
      "DOMINGO",
      "invalido",
    ]),
    ["terca", "sabado", "segunda", "domingo"],
  );
  assert.deepEqual(
    normalizeOperatingDays("segunda, terça, sábado, domingo"),
    ["segunda", "terca", "sabado", "domingo"],
  );
});

test("shared onboarding operation helpers normalize rules and installation time", () => {
  assert.deepEqual(
    normalizeOperationTechnicalVisitRules([
      "precisa_agendar",
      "horario_comercial",
      "confirmar_endereco",
      "precisa_agendar",
    ]),
    ["precisa_agendar", "confirmar_endereco"],
  );
  assert.deepEqual(parseOperationAverageInstallationTimeInput("3 dias"), {
    ok: true,
    value: 3,
  });
  assert.deepEqual(parseOperationAverageInstallationTimeInput(""), {
    ok: true,
    value: null,
  });
  assert.equal(parseOperationAverageInstallationTimeInput("zero").ok, false);
});

test("normalizer rejects non-positive installation time", () => {
  const result = normalizeStoreOperationSettingsInput({
    offersInstallation: true,
    averageInstallationTimeDays: 0,
    installationDaysRule: "",
    installationProcessNotes: "",
    offersTechnicalVisit: true,
    technicalVisitDaysRule: "",
    technicalVisitRules: [],
    technicalVisitRulesOther: "",
  });

  assert.equal(result.ok, false);
});

test("normalizer preserves the canonical technical visit allowlist", () => {
  const result = normalizeStoreOperationSettingsInput({
    offersInstallation: true,
    averageInstallationTimeDays: 3,
    installationDaysRule: " regra ",
    installationProcessNotes: " notas ",
    offersTechnicalVisit: true,
    technicalVisitDaysRule: " visita ",
    technicalVisitRules: [
      "precisa_agendar",
      "analise_do_local",
      "precisa_agendar",
    ],
    technicalVisitRulesOther: " complemento ",
  });

  assert.equal(result.ok, true);

  if (!result.ok) return;

  assert.deepEqual(result.value.technicalVisitRules, [
    "precisa_agendar",
    "analise_do_local",
  ]);
  assert.equal(result.value.installationDaysRule, "regra");
  assert.equal(result.value.installationProcessNotes, "notas");
  assert.equal(result.value.technicalVisitRulesOther, "complemento");
});

test("normalizer treats undefined technical visit rules as an empty list", () => {
  const result = normalizeStoreOperationSettingsInput({
    offersInstallation: true,
    averageInstallationTimeDays: 3,
    installationDaysRule: "",
    installationProcessNotes: "",
    offersTechnicalVisit: true,
    technicalVisitDaysRule: "",
    technicalVisitRules: undefined,
    technicalVisitRulesOther: "",
  });

  assert.equal(result.ok, true);

  if (!result.ok) return;

  assert.deepEqual(result.value.technicalVisitRules, []);
});

test("normalizer fails closed for non-array technical visit rules", () => {
  const result = normalizeStoreOperationSettingsInput({
    offersInstallation: true,
    averageInstallationTimeDays: 3,
    installationDaysRule: "",
    installationProcessNotes: "",
    offersTechnicalVisit: true,
    technicalVisitDaysRule: "",
    technicalVisitRules: "precisa_agendar",
    technicalVisitRulesOther: "",
  });

  assert.equal(result.ok, false);

  if (result.ok) return;

  assert.equal(result.error, "technicalVisitRules deve ser uma lista.");
});

console.log("store-operation-settings: 15 tests passed");
