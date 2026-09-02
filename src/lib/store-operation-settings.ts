export const STORE_OPERATION_TECHNICAL_VISIT_RULES = [
  "precisa_agendar",
  "confirmar_endereco",
  "analise_do_local",
  "pode_ter_taxa",
] as const;

export type StoreOperationTechnicalVisitRule =
  (typeof STORE_OPERATION_TECHNICAL_VISIT_RULES)[number];

export type StoreOperationSettingsRow = {
  organization_id: string;
  store_id: string;
  offers_installation: boolean | null;
  average_installation_time_days: number | null;
  installation_days_rule: string | null;
  installation_process_notes: string | null;
  offers_technical_visit: boolean | null;
  technical_visit_days_rule: string | null;
  technical_visit_rules: unknown;
  technical_visit_rules_other: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type StoreOperationSettingsInput = {
  offersInstallation: boolean | null;
  averageInstallationTimeDays: number | null;
  installationDaysRule: string;
  installationProcessNotes: string;
  offersTechnicalVisit: boolean | null;
  technicalVisitDaysRule: string;
  technicalVisitRules: StoreOperationTechnicalVisitRule[];
  technicalVisitRulesOther: string;
};

type AnswersMap = Record<string, unknown>;

const OPERATION_DRAFT_STRING_FIELDS = [
  "operating_days",
  "operating_hours",
  "installation_days_rule",
  "technical_visit_days_rule",
  "serves_saturday",
  "serves_sunday",
  "serves_holiday",
  "allow_multiple_appointments_per_day",
  "allow_same_time_appointments",
  "offers_installation",
  "average_installation_time_days",
  "installation_process_summary",
  "offers_technical_visit",
  "technical_visit_rules_other",
  "agenda_capacity_rule",
] as const;

const CANONICAL_OPERATING_DAYS = [
  "segunda",
  "terca",
  "quarta",
  "quinta",
  "sexta",
  "sabado",
  "domingo",
] as const;

type CanonicalOperatingDay = (typeof CANONICAL_OPERATING_DAYS)[number];

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;

  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();

  if (["sim", "true", "yes", "1"].includes(normalized)) return true;
  if (["não", "nao", "false", "no", "0"].includes(normalized)) return false;

  return null;
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^(\d+)\s*(?:dia|dias)?$/);

  if (!match) return null;

  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseOperationAverageInstallationTimeInput(
  value: unknown,
):
  | { ok: true; value: number | null }
  | { ok: false; error: string } {
  const text = cleanText(value);

  if (!text) {
    return { ok: true, value: null };
  }

  const parsed = parsePositiveInteger(text);

  if (parsed === null) {
    return {
      ok: false,
      error:
        "averageInstallationTimeDays deve ser um inteiro positivo quando informado.",
    };
  }

  return { ok: true, value: parsed };
}

function parseArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item)).filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => cleanText(item)).filter(Boolean);
      }
    } catch {
      return trimmed
        .split(",")
        .map((item) => cleanText(item))
        .filter(Boolean);
    }
  }

  return [];
}

function normalizeLoose(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeOperatingDayValue(
  value: unknown,
): CanonicalOperatingDay | null {
  const normalized = normalizeLoose(value)
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ");

  switch (normalized) {
    case "segunda":
    case "segunda feira":
      return "segunda";
    case "terca":
    case "terca feira":
      return "terca";
    case "quarta":
    case "quarta feira":
      return "quarta";
    case "quinta":
    case "quinta feira":
      return "quinta";
    case "sexta":
    case "sexta feira":
      return "sexta";
    case "sabado":
      return "sabado";
    case "domingo":
      return "domingo";
    default:
      return null;
  }
}

export function normalizeOperatingDays(values: unknown): CanonicalOperatingDay[] {
  const sourceValues = Array.isArray(values) ? values : parseArray(values);
  const normalizedDays: CanonicalOperatingDay[] = [];

  sourceValues.forEach((value) => {
    const day = normalizeOperatingDayValue(value);
    if (day && !normalizedDays.includes(day)) {
      normalizedDays.push(day);
    }
  });

  return normalizedDays;
}

export function deriveWeekendAvailabilityFromOperatingDays(values: unknown): {
  serves_saturday: "Sim" | "Não";
  serves_sunday: "Sim" | "Não";
} {
  const operatingDays = normalizeOperatingDays(values);

  return {
    serves_saturday: operatingDays.includes("sabado") ? "Sim" : "Não",
    serves_sunday: operatingDays.includes("domingo") ? "Sim" : "Não",
  };
}

export function applyWeekendSelectionToOperatingDays(args: {
  currentDays: unknown;
  saturdaySelection: string;
  sundaySelection: string;
}): CanonicalOperatingDay[] {
  const normalizedDays = normalizeOperatingDays(args.currentDays);

  const applySelection = (
    day: CanonicalOperatingDay,
    selection: string,
  ) => {
    const normalizedSelection = normalizeLoose(selection);
    const hasDay = normalizedDays.includes(day);

    if (normalizedSelection === "sim" && !hasDay) {
      normalizedDays.push(day);
      return;
    }

    if (normalizedSelection === "nao" && hasDay) {
      const index = normalizedDays.indexOf(day);
      normalizedDays.splice(index, 1);
    }
  };

  applySelection("sabado", args.saturdaySelection);
  applySelection("domingo", args.sundaySelection);

  return normalizedDays;
}

function normalizeTechnicalVisitRules(
  value: unknown,
): StoreOperationTechnicalVisitRule[] {
  const allowed = new Set<string>(STORE_OPERATION_TECHNICAL_VISIT_RULES);

  return Array.from(
    new Set(
      parseArray(value)
        .map((item) => item.toLowerCase())
        .filter((item) => allowed.has(item)),
    ),
  ) as StoreOperationTechnicalVisitRule[];
}

export function normalizeOperationTechnicalVisitRules(
  value: unknown,
): StoreOperationTechnicalVisitRule[] {
  return normalizeTechnicalVisitRules(value);
}

export function normalizePersistedOperationDraft<T extends object>(
  canonicalDraft: T,
  persistedDraft: unknown,
): T {
  if (
    !persistedDraft ||
    typeof persistedDraft !== "object" ||
    Array.isArray(persistedDraft)
  ) {
    return canonicalDraft;
  }

  const persisted = persistedDraft as Record<string, unknown>;
  const migrated: Record<string, unknown> = {
    ...(canonicalDraft as Record<string, unknown>),
  };

  for (const field of OPERATION_DRAFT_STRING_FIELDS) {
    const value = persisted[field];
    if (typeof value === "string") {
      migrated[field] = value;
    }
  }

  if (Array.isArray(persisted.technical_visit_rules_selected)) {
    migrated.technical_visit_rules_selected = normalizeTechnicalVisitRules(
      persisted.technical_visit_rules_selected,
    );
  }

  return migrated as T;
}

export function createStoreOperationSettingsInputFromSources(args: {
  answers?: AnswersMap | null;
  settings?: StoreOperationSettingsRow | null;
}): StoreOperationSettingsInput {
  const settings = args.settings ?? null;

  // Uma linha canônica existente vence o legado inteiro.
  // NULL no canônico continua NULL; não volta silenciosamente ao onboarding.
  if (settings) {
    return {
      offersInstallation: settings.offers_installation,
      averageInstallationTimeDays: settings.average_installation_time_days,
      installationDaysRule: cleanText(settings.installation_days_rule),
      installationProcessNotes: cleanText(settings.installation_process_notes),
      offersTechnicalVisit: settings.offers_technical_visit,
      technicalVisitDaysRule: cleanText(settings.technical_visit_days_rule),
      technicalVisitRules: normalizeTechnicalVisitRules(
        settings.technical_visit_rules,
      ),
      technicalVisitRulesOther: cleanText(
        settings.technical_visit_rules_other,
      ),
    };
  }

  // Ausencia canonica nao promove answers legados como autoridade.
  return {
    offersInstallation: null,
    averageInstallationTimeDays: null,
    installationDaysRule: "",
    installationProcessNotes: "",
    offersTechnicalVisit: null,
    technicalVisitDaysRule: "",
    technicalVisitRules: [],
    technicalVisitRulesOther: "",
  };
}

export function normalizeStoreOperationSettingsInput(
  input: Omit<StoreOperationSettingsInput, "technicalVisitRules"> & {
    technicalVisitRules?: unknown;
  },
):
  | { ok: true; value: StoreOperationSettingsInput }
  | { ok: false; error: string } {
  if (
    input.averageInstallationTimeDays !== null &&
    (!Number.isInteger(input.averageInstallationTimeDays) ||
      input.averageInstallationTimeDays <= 0)
  ) {
    return {
      ok: false,
      error:
        "averageInstallationTimeDays deve ser um inteiro positivo quando informado.",
    };
  }

  const allowed = new Set<string>(STORE_OPERATION_TECHNICAL_VISIT_RULES);
  const technicalVisitRulesInput = input.technicalVisitRules ?? [];

  if (!Array.isArray(technicalVisitRulesInput)) {
    return {
      ok: false,
      error: "technicalVisitRules deve ser uma lista.",
    };
  }

  const normalizedRules = Array.from(
    new Set(
      technicalVisitRulesInput
        .map((rule) => cleanText(rule).toLowerCase())
        .filter(Boolean),
    ),
  );

  if (normalizedRules.some((rule) => !allowed.has(rule))) {
    return {
      ok: false,
      error: "technicalVisitRules contém valor inválido.",
    };
  }

  return {
    ok: true,
    value: {
      offersInstallation: input.offersInstallation,
      averageInstallationTimeDays: input.averageInstallationTimeDays,
      installationDaysRule: cleanText(input.installationDaysRule),
      installationProcessNotes: cleanText(input.installationProcessNotes),
      offersTechnicalVisit: input.offersTechnicalVisit,
      technicalVisitDaysRule: cleanText(input.technicalVisitDaysRule),
      technicalVisitRules:
        normalizedRules as StoreOperationTechnicalVisitRule[],
      technicalVisitRulesOther: cleanText(input.technicalVisitRulesOther),
    },
  };
}
