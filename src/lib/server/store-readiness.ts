import {
  loadCanonicalActivePrimaryStoreResponsible,
  type LoadCanonicalStoreResponsibleResult,
} from "./store-responsibles";
import { loadStoreQuoteSettings } from "./sales-quotes/quote-settings";

export const STORE_READINESS_CAPABILITY_KEYS = [
  "onboarding_minimum",
  "responsible_operational",
  "agenda",
  "catalog",
  "quote",
] as const;

export type StoreReadinessCapabilityKey =
  (typeof STORE_READINESS_CAPABILITY_KEYS)[number];

export const STORE_READINESS_STATES = [
  "not_applicable",
  "not_configured",
  "ready",
  "blocked",
] as const;

export type StoreReadinessState = (typeof STORE_READINESS_STATES)[number];

export const STORE_READINESS_REASON_CODES = {
  ONBOARDING_STATUS_MISSING: "onboarding_status_missing",
  ONBOARDING_MINIMUM_INCOMPLETE: "onboarding_minimum_incomplete",
  PRIMARY_RESPONSIBLE_MISSING: "primary_responsible_missing",
  PRIMARY_RESPONSIBLE_AMBIGUOUS: "primary_responsible_ambiguous",
  PRIMARY_RESPONSIBLE_INVALID_DESTINATION:
    "primary_responsible_invalid_destination",
  SCHEDULE_SETTINGS_MISSING: "schedule_settings_missing",
  SCHEDULE_TIMEZONE_MISSING: "schedule_timezone_missing",
  SCHEDULE_TIMEZONE_INVALID: "schedule_timezone_invalid",
  SCHEDULE_OPERATING_DAYS_MISSING: "schedule_operating_days_missing",
  SCHEDULE_OPERATING_HOURS_MISSING: "schedule_operating_hours_missing",
  SCHEDULE_DAY_WINDOW_MISSING: "schedule_day_window_missing",
  SCHEDULE_DAY_WINDOW_INVALID: "schedule_day_window_invalid",
  SCHEDULE_SAME_TIME_CAPACITY_INVALID: "schedule_same_time_capacity_invalid",
  CATALOG_EMPTY: "catalog_empty",
  QUOTE_SETTINGS_MISSING: "quote_settings_missing",
  QUOTE_PDF_DISABLED_BY_POLICY: "quote_pdf_disabled_by_policy",
  QUOTE_GENERATION_DISABLED_BY_POLICY: "quote_generation_disabled_by_policy",
  QUOTE_SEND_DISABLED_BY_POLICY: "quote_send_disabled_by_policy",
} as const;

export type StoreReadinessReasonCode =
  (typeof STORE_READINESS_REASON_CODES)[keyof typeof STORE_READINESS_REASON_CODES];

export type StoreReadinessCapability = {
  capabilityKey: StoreReadinessCapabilityKey;
  state: StoreReadinessState;
  reasonCodes: StoreReadinessReasonCode[];
  missingFields: string[];
  blocksAccess: boolean;
  blocksCapability: boolean;
  blocksPilotGo: boolean;
};

export type StoreReadinessResult = {
  capabilities: StoreReadinessCapability[];
  capabilitiesByKey: Record<
    StoreReadinessCapabilityKey,
    StoreReadinessCapability
  >;
};

type StoreOnboardingRow = {
  status: string | null;
};

type StoreScheduleSettingsReadinessRow = {
  allow_same_time_appointments: boolean | null;
  same_time_capacity: number | null;
  operating_days: string[] | null;
  operating_hours: Record<string, { start?: string; end?: string }> | null;
  timezone_name: string | null;
};

type StoreReadinessSupabaseLike = {
  from(table: string): {
    select(
      columns: string,
      options?: { count?: "exact"; head?: boolean },
    ): {
      eq(column: string, value: unknown): any;
      limit(count: number): any;
      maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>;
      then(
        onFulfilled?:
          | ((value: { data: unknown; error: { message: string } | null }) => unknown)
          | null,
        onRejected?: ((reason: unknown) => unknown) | null,
      ): Promise<unknown>;
    };
  };
};

type ResolvedCapabilityInput = Omit<
  StoreReadinessCapability,
  "blocksCapability" | "blocksPilotGo"
> & {
  blocksCapability?: boolean;
  blocksPilotGo?: boolean;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeText(value: unknown) {
  return cleanText(value).toLowerCase();
}

function uniqueStrings<T extends string>(values: T[]) {
  return Array.from(new Set(values.filter(Boolean))) as T[];
}

function isValidTimeZone(value: string | null) {
  const text = cleanText(value);
  if (!text) return false;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: text });
    return true;
  } catch {
    return false;
  }
}

function parseScheduleTimeToMinutes(value: string | null | undefined) {
  const match = cleanText(value).match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;

  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;

  return hour * 60 + minute;
}

export function normalizeStoreReadinessCapability(
  input: ResolvedCapabilityInput,
): StoreReadinessCapability {
  const state = input.state;
  const reasonCodes = uniqueStrings(input.reasonCodes);
  const missingFields = uniqueStrings(input.missingFields);

  if (state === "not_applicable") {
    return {
      capabilityKey: input.capabilityKey,
      state,
      reasonCodes,
      missingFields,
      blocksAccess: false,
      blocksCapability: false,
      blocksPilotGo: false,
    };
  }

  return {
    capabilityKey: input.capabilityKey,
    state,
    reasonCodes,
    missingFields,
    blocksAccess: input.blocksAccess === true,
    blocksCapability:
      input.blocksCapability !== undefined ? input.blocksCapability : state !== "ready",
    blocksPilotGo:
      input.blocksPilotGo !== undefined ? input.blocksPilotGo : state !== "ready",
  };
}

async function loadOnboardingRow(args: {
  supabase: StoreReadinessSupabaseLike;
  organizationId: string;
  storeId: string;
}) {
  const { data, error } = await args.supabase
    .from("store_onboarding")
    .select("status")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar store_onboarding: ${error.message}`);
  }

  return (data || null) as StoreOnboardingRow | null;
}

async function loadScheduleSettingsRow(args: {
  supabase: StoreReadinessSupabaseLike;
  organizationId: string;
  storeId: string;
}) {
  const { data, error } = await args.supabase
    .from("store_schedule_settings")
    .select(
      "allow_same_time_appointments, same_time_capacity, operating_days, operating_hours, timezone_name",
    )
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Falha ao carregar store_schedule_settings: ${error.message}`,
    );
  }

  return (data || null) as StoreScheduleSettingsReadinessRow | null;
}

async function loadCatalogCounts(args: {
  supabase: StoreReadinessSupabaseLike;
  organizationId: string;
  storeId: string;
}) {
  const [poolsResult, catalogItemsResult] = await Promise.all([
    args.supabase
      .from("pools")
      .select("id")
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .eq("is_active", true)
      .limit(1),
    args.supabase
      .from("store_catalog_items")
      .select("id")
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .eq("is_active", true)
      .limit(1),
  ]);

  if (poolsResult.error) {
    throw new Error(`Falha ao carregar pools ativos: ${poolsResult.error.message}`);
  }

  if (catalogItemsResult.error) {
    throw new Error(
      `Falha ao carregar store_catalog_items ativos: ${catalogItemsResult.error.message}`,
    );
  }

  return {
    activePoolsCount: Array.isArray(poolsResult.data) ? poolsResult.data.length : 0,
    activeCatalogItemsCount: Array.isArray(catalogItemsResult.data)
      ? catalogItemsResult.data.length
      : 0,
  };
}

export function resolveOnboardingMinimumCapability(
  row: StoreOnboardingRow | null,
): StoreReadinessCapability {
  const status = normalizeText(row?.status);

  if (status === "completed") {
    return normalizeStoreReadinessCapability({
      capabilityKey: "onboarding_minimum",
      state: "ready",
      reasonCodes: [],
      missingFields: [],
      blocksAccess: false,
    });
  }

  if (!status) {
    return normalizeStoreReadinessCapability({
      capabilityKey: "onboarding_minimum",
      state: "not_configured",
      reasonCodes: [STORE_READINESS_REASON_CODES.ONBOARDING_STATUS_MISSING],
      missingFields: ["store_onboarding.status"],
      blocksAccess: true,
      blocksCapability: true,
      blocksPilotGo: true,
    });
  }

  return normalizeStoreReadinessCapability({
    capabilityKey: "onboarding_minimum",
    state: "not_configured",
    reasonCodes: [STORE_READINESS_REASON_CODES.ONBOARDING_MINIMUM_INCOMPLETE],
    missingFields: ["store_onboarding.status"],
    blocksAccess: true,
    blocksCapability: true,
    blocksPilotGo: true,
  });
}

export function resolveResponsibleOperationalCapability(
  result: LoadCanonicalStoreResponsibleResult,
): StoreReadinessCapability {
  if (result.ok) {
    return normalizeStoreReadinessCapability({
      capabilityKey: "responsible_operational",
      state: "ready",
      reasonCodes: [],
      missingFields: [],
      blocksAccess: false,
    });
  }

  if (result.reason === "responsible_primary_not_configured") {
    return normalizeStoreReadinessCapability({
      capabilityKey: "responsible_operational",
      state: "not_configured",
      reasonCodes: [STORE_READINESS_REASON_CODES.PRIMARY_RESPONSIBLE_MISSING],
      missingFields: ["store_responsibles.primary_active_responsible"],
      blocksAccess: false,
      blocksCapability: true,
      blocksPilotGo: true,
    });
  }

  if (result.reason === "responsible_primary_invalid_destination") {
    return normalizeStoreReadinessCapability({
      capabilityKey: "responsible_operational",
      state: "blocked",
      reasonCodes: [
        STORE_READINESS_REASON_CODES.PRIMARY_RESPONSIBLE_INVALID_DESTINATION,
      ],
      missingFields: ["store_responsibles.whatsapp_number"],
      blocksAccess: false,
      blocksCapability: true,
      blocksPilotGo: true,
    });
  }

  return normalizeStoreReadinessCapability({
    capabilityKey: "responsible_operational",
    state: "blocked",
    reasonCodes: [STORE_READINESS_REASON_CODES.PRIMARY_RESPONSIBLE_AMBIGUOUS],
    missingFields: [],
    blocksAccess: false,
    blocksCapability: true,
    blocksPilotGo: true,
  });
}

export function resolveAgendaCapability(
  row: StoreScheduleSettingsReadinessRow | null,
): StoreReadinessCapability {
  const reasonCodes: StoreReadinessReasonCode[] = [];
  const missingFields: string[] = [];

  if (!row) {
    return normalizeStoreReadinessCapability({
      capabilityKey: "agenda",
      state: "not_configured",
      reasonCodes: [STORE_READINESS_REASON_CODES.SCHEDULE_SETTINGS_MISSING],
      missingFields: [
        "store_schedule_settings.timezone_name",
        "store_schedule_settings.operating_days",
        "store_schedule_settings.operating_hours",
      ],
      blocksAccess: false,
      blocksCapability: true,
      blocksPilotGo: true,
    });
  }

  const timezoneName = cleanText(row.timezone_name);
  if (!timezoneName) {
    reasonCodes.push(STORE_READINESS_REASON_CODES.SCHEDULE_TIMEZONE_MISSING);
    missingFields.push("store_schedule_settings.timezone_name");
  } else if (!isValidTimeZone(timezoneName)) {
    return normalizeStoreReadinessCapability({
      capabilityKey: "agenda",
      state: "blocked",
      reasonCodes: [STORE_READINESS_REASON_CODES.SCHEDULE_TIMEZONE_INVALID],
      missingFields: ["store_schedule_settings.timezone_name"],
      blocksAccess: false,
      blocksCapability: true,
      blocksPilotGo: true,
    });
  }

  const operatingDays = Array.isArray(row.operating_days)
    ? row.operating_days.map((value) => normalizeText(value)).filter(Boolean)
    : [];

  if (operatingDays.length === 0) {
    reasonCodes.push(STORE_READINESS_REASON_CODES.SCHEDULE_OPERATING_DAYS_MISSING);
    missingFields.push("store_schedule_settings.operating_days");
  }

  const operatingHours =
    row.operating_hours && typeof row.operating_hours === "object"
      ? row.operating_hours
      : null;

  if (!operatingHours) {
    reasonCodes.push(STORE_READINESS_REASON_CODES.SCHEDULE_OPERATING_HOURS_MISSING);
    missingFields.push("store_schedule_settings.operating_hours");
  }

  if (
    row.allow_same_time_appointments === true &&
    (!Number.isFinite(row.same_time_capacity) ||
      Number(row.same_time_capacity) < 1)
  ) {
    return normalizeStoreReadinessCapability({
      capabilityKey: "agenda",
      state: "blocked",
      reasonCodes: [
        STORE_READINESS_REASON_CODES.SCHEDULE_SAME_TIME_CAPACITY_INVALID,
      ],
      missingFields: ["store_schedule_settings.same_time_capacity"],
      blocksAccess: false,
      blocksCapability: true,
      blocksPilotGo: true,
    });
  }

  if (reasonCodes.length === 0 && operatingHours) {
    for (const dayKey of operatingDays) {
      const hours = operatingHours[dayKey];
      const start = cleanText(hours?.start);
      const end = cleanText(hours?.end);

      if (!start || !end) {
        reasonCodes.push(STORE_READINESS_REASON_CODES.SCHEDULE_DAY_WINDOW_MISSING);
        missingFields.push(
          `store_schedule_settings.operating_hours.${dayKey}.start`,
          `store_schedule_settings.operating_hours.${dayKey}.end`,
        );
        continue;
      }

      const startMinutes = parseScheduleTimeToMinutes(start);
      const endMinutes = parseScheduleTimeToMinutes(end);

      if (
        startMinutes === null ||
        endMinutes === null ||
        startMinutes >= endMinutes
      ) {
        return normalizeStoreReadinessCapability({
          capabilityKey: "agenda",
          state: "blocked",
          reasonCodes: [
            STORE_READINESS_REASON_CODES.SCHEDULE_DAY_WINDOW_INVALID,
          ],
          missingFields: [
            `store_schedule_settings.operating_hours.${dayKey}.start`,
            `store_schedule_settings.operating_hours.${dayKey}.end`,
          ],
          blocksAccess: false,
          blocksCapability: true,
          blocksPilotGo: true,
        });
      }
    }
  }

  if (reasonCodes.length > 0) {
    return normalizeStoreReadinessCapability({
      capabilityKey: "agenda",
      state: "not_configured",
      reasonCodes,
      missingFields,
      blocksAccess: false,
      blocksCapability: true,
      blocksPilotGo: true,
    });
  }

  return normalizeStoreReadinessCapability({
    capabilityKey: "agenda",
    state: "ready",
    reasonCodes: [],
    missingFields: [],
    blocksAccess: false,
  });
}

export function resolveCatalogCapability(args: {
  activePoolsCount: number;
  activeCatalogItemsCount: number;
}): StoreReadinessCapability {
  if (args.activePoolsCount > 0 || args.activeCatalogItemsCount > 0) {
    return normalizeStoreReadinessCapability({
      capabilityKey: "catalog",
      state: "ready",
      reasonCodes: [],
      missingFields: [],
      blocksAccess: false,
    });
  }

  return normalizeStoreReadinessCapability({
    capabilityKey: "catalog",
    state: "not_configured",
    reasonCodes: [STORE_READINESS_REASON_CODES.CATALOG_EMPTY],
    missingFields: ["pools|store_catalog_items"],
    blocksAccess: false,
    blocksCapability: true,
    blocksPilotGo: true,
  });
}

export function resolveQuoteCapability(args: {
  row: Awaited<ReturnType<typeof loadStoreQuoteSettings>>["row"];
  settings: Awaited<ReturnType<typeof loadStoreQuoteSettings>>["settings"];
}): StoreReadinessCapability {
  if (!args.row?.id) {
    return normalizeStoreReadinessCapability({
      capabilityKey: "quote",
      state: "not_configured",
      reasonCodes: [STORE_READINESS_REASON_CODES.QUOTE_SETTINGS_MISSING],
      missingFields: [
        "store_quote_settings.quote_pdf_enabled",
      ],
      blocksAccess: false,
      blocksCapability: true,
      blocksPilotGo: true,
    });
  }

  const reasonCodes: StoreReadinessReasonCode[] = [];
  const missingFields: string[] = [];

  if (!args.settings.quotePdfEnabled) {
    reasonCodes.push(STORE_READINESS_REASON_CODES.QUOTE_PDF_DISABLED_BY_POLICY);
    missingFields.push("store_quote_settings.quote_pdf_enabled");
  }

  if (reasonCodes.length > 0) {
    return normalizeStoreReadinessCapability({
      capabilityKey: "quote",
      state: "blocked",
      reasonCodes,
      missingFields,
      blocksAccess: false,
      blocksCapability: true,
      blocksPilotGo: true,
    });
  }

  return normalizeStoreReadinessCapability({
    capabilityKey: "quote",
    state: "ready",
    reasonCodes: [],
    missingFields: [],
    blocksAccess: false,
  });
}

export async function resolveStoreReadiness(args: {
  supabase: StoreReadinessSupabaseLike;
  organizationId: string;
  storeId: string;
}): Promise<StoreReadinessResult> {
  const [onboardingRow, responsibleResult, scheduleRow, catalogCounts, quoteResult] =
    await Promise.all([
      loadOnboardingRow(args),
      loadCanonicalActivePrimaryStoreResponsible({
        supabase: args.supabase as never,
        organizationId: args.organizationId,
        storeId: args.storeId,
      }),
      loadScheduleSettingsRow(args),
      loadCatalogCounts(args),
      loadStoreQuoteSettings(args),
    ]);

  const capabilities = [
    resolveOnboardingMinimumCapability(onboardingRow),
    resolveResponsibleOperationalCapability(responsibleResult),
    resolveAgendaCapability(scheduleRow),
    resolveCatalogCapability(catalogCounts),
    resolveQuoteCapability(quoteResult),
  ];

  return {
    capabilities,
    capabilitiesByKey: {
      onboarding_minimum: capabilities[0],
      responsible_operational: capabilities[1],
      agenda: capabilities[2],
      catalog: capabilities[3],
      quote: capabilities[4],
    },
  };
}
