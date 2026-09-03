export type SalesAiAfterHoursMode = "all_closed_hours" | "specific_window";

export type StoreScheduleSettingsForSalesAiWindow = {
  operating_days: unknown;
  operating_hours: unknown;
  timezone_name: string | null;
  attends_holidays?: boolean | null;
  ai_after_hours_enabled?: boolean | null;
  ai_after_hours_mode?: string | null;
  ai_after_hours_start?: string | null;
  ai_after_hours_end?: string | null;
  ai_attends_holidays?: boolean | null;
};

export type StoreScheduleHolidayBlockForSalesAiWindow = {
  id?: string | null;
  title?: string | null;
  block_type?: string | null;
  start_at: string | null;
  end_at: string | null;
};

export type SalesAiOperatingWindowDecision =
  | "HUMAN_OPEN"
  | "AI_ALLOWED_AFTER_HOURS"
  | "AI_NOT_ALLOWED_NOW";

export type HumanOpenPeriod = {
  startIso: string;
  endIso: string;
  localDate: string;
  dayKey: string;
  startTime: string;
  endTime: string;
  label: string;
};

export type SalesAiOperatingWindowContext = {
  decision: SalesAiOperatingWindowDecision;
  humanAvailableNow: boolean;
  aiAllowedNow: boolean;
  humanUnavailableReason: string | null;
  timezoneName: string;
  localNow: string;
  isHolidayBlocked: boolean;
  holidayBlockTitle: string | null;
  nextHumanOpenPeriod: HumanOpenPeriod | null;
  nextAiAllowedPeriod: HumanOpenPeriod | null;
  policy: {
    aiAfterHoursEnabled: boolean;
    aiAfterHoursMode: SalesAiAfterHoursMode | null;
    aiAfterHoursStart: string | null;
    aiAfterHoursEnd: string | null;
    aiAttendsHolidays: boolean;
  };
};

const DAY_KEYS = [
  "domingo",
  "segunda",
  "terca",
  "quarta",
  "quinta",
  "sexta",
  "sabado",
];

const DAY_LABELS: Record<string, string> = {
  domingo: "domingo",
  segunda: "segunda-feira",
  terca: "terca-feira",
  quarta: "quarta-feira",
  quinta: "quinta-feira",
  sexta: "sexta-feira",
  sabado: "sabado",
};

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

function normalizeText(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function safeSalesAiTimeZone(value: unknown): string {
  const candidate = String(value || "").trim();
  if (!candidate) return DEFAULT_TIMEZONE;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function getLocalParts(date: Date, timeZone: string) {
  const values: Record<string, number> = {};
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }

  return {
    year: values.year || date.getUTCFullYear(),
    month: values.month || date.getUTCMonth() + 1,
    day: values.day || date.getUTCDate(),
    hour: values.hour === 24 ? 0 : values.hour || 0,
    minute: values.minute || 0,
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function localDateString(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function localMinute(parts: { hour: number; minute: number }): number {
  return parts.hour * 60 + parts.minute;
}

function getDayKey(parts: { year: number; month: number; day: number }): string {
  const dayIndex = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return DAY_KEYS[dayIndex] || "domingo";
}

function addDays(parts: { year: number; month: number; day: number }, days: number) {
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

export function parseSalesAiScheduleTimeToMinutes(value: unknown): number | null {
  const match = String(value || "").trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function formatMinutes(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(normalized / 60))}:${pad2(normalized % 60)}`;
}

function normalizeOperatingDays(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((item) => normalizeText(item))
    .filter((item) => DAY_KEYS.includes(item));
  return Array.from(new Set(normalized));
}

function readOperatingHours(
  settings: StoreScheduleSettingsForSalesAiWindow,
  dayKey: string,
): { start: string | null; end: string | null } {
  const hours =
    settings.operating_hours &&
    typeof settings.operating_hours === "object" &&
    !Array.isArray(settings.operating_hours)
      ? (settings.operating_hours as Record<string, unknown>)
      : {};
  const dayValue = hours[dayKey];

  if (!dayValue || typeof dayValue !== "object" || Array.isArray(dayValue)) {
    return { start: null, end: null };
  }

  const dayHours = dayValue as { start?: unknown; end?: unknown };
  return {
    start: typeof dayHours.start === "string" ? dayHours.start : null,
    end: typeof dayHours.end === "string" ? dayHours.end : null,
  };
}

function localDateTimeToUtcIso(args: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}): string {
  let guess = Date.UTC(args.year, args.month - 1, args.day, args.hour, args.minute, 0, 0);

  for (let index = 0; index < 4; index += 1) {
    const parts = getLocalParts(new Date(guess), args.timeZone);
    const current = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0,
      0,
    );
    const target = Date.UTC(
      args.year,
      args.month - 1,
      args.day,
      args.hour,
      args.minute,
      0,
      0,
    );
    const diff = target - current;
    if (diff === 0) break;
    guess += diff;
  }

  return new Date(guess).toISOString();
}

function dayRangeUtcIso(parts: { year: number; month: number; day: number }, timeZone: string) {
  const next = addDays(parts, 1);
  return {
    startIso: localDateTimeToUtcIso({ ...parts, hour: 0, minute: 0, timeZone }),
    endIso: localDateTimeToUtcIso({ ...next, hour: 0, minute: 0, timeZone }),
  };
}

function blockOverlapsRange(
  block: StoreScheduleHolidayBlockForSalesAiWindow,
  startIso: string,
  endIso: string,
): boolean {
  const blockStart = Date.parse(String(block.start_at || ""));
  const blockEnd = Date.parse(String(block.end_at || ""));
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (![blockStart, blockEnd, start, end].every(Number.isFinite)) return false;
  return blockStart < end && blockEnd > start;
}

function findHolidayBlockForLocalDay(args: {
  holidayBlocks: StoreScheduleHolidayBlockForSalesAiWindow[];
  parts: { year: number; month: number; day: number };
  timeZone: string;
}) {
  const range = dayRangeUtcIso(args.parts, args.timeZone);
  return (
    args.holidayBlocks.find((block) => {
      if (normalizeText(block.block_type) !== "holiday") return false;
      return blockOverlapsRange(block, range.startIso, range.endIso);
    }) || null
  );
}

function isMinuteInsideWindow(args: {
  minute: number;
  start: number;
  end: number;
}): boolean {
  if (args.start === args.end) return false;
  if (args.start < args.end) {
    return args.minute >= args.start && args.minute < args.end;
  }
  return args.minute >= args.start || args.minute < args.end;
}

function resolveAfterHoursMode(value: unknown): SalesAiAfterHoursMode | null {
  const normalized = normalizeText(value);
  if (normalized === "all_closed_hours") return "all_closed_hours";
  if (normalized === "specific_window") return "specific_window";
  return null;
}

function resolveNextHumanOpenPeriod(args: {
  settings: StoreScheduleSettingsForSalesAiWindow;
  holidayBlocks: StoreScheduleHolidayBlockForSalesAiWindow[];
  now: Date;
  timeZone: string;
}): HumanOpenPeriod | null {
  const nowParts = getLocalParts(args.now, args.timeZone);
  const nowMinute = localMinute(nowParts);
  const operatingDays = normalizeOperatingDays(args.settings.operating_days);
  if (operatingDays.length === 0) return null;

  for (let offset = 0; offset <= 21; offset += 1) {
    const dayParts = addDays(nowParts, offset);
    const dayKey = getDayKey(dayParts);
    if (!operatingDays.includes(dayKey)) continue;
    if (
      findHolidayBlockForLocalDay({
        holidayBlocks: args.holidayBlocks,
        parts: dayParts,
        timeZone: args.timeZone,
      })
    ) {
      continue;
    }

    const hours = readOperatingHours(args.settings, dayKey);
    const openingMinutes = parseSalesAiScheduleTimeToMinutes(hours.start);
    const closingMinutes = parseSalesAiScheduleTimeToMinutes(hours.end);
    if (openingMinutes === null || closingMinutes === null || openingMinutes >= closingMinutes) {
      continue;
    }

    if (offset === 0 && nowMinute >= closingMinutes) {
      continue;
    }

    const startMinutes = offset === 0 && nowMinute > openingMinutes ? nowMinute : openingMinutes;
    const startIso = localDateTimeToUtcIso({
      ...dayParts,
      hour: Math.floor(startMinutes / 60),
      minute: startMinutes % 60,
      timeZone: args.timeZone,
    });
    const endIso = localDateTimeToUtcIso({
      ...dayParts,
      hour: Math.floor(closingMinutes / 60),
      minute: closingMinutes % 60,
      timeZone: args.timeZone,
    });
    const localDate = localDateString(dayParts);
    const startTime = formatMinutes(startMinutes);
    const endTime = formatMinutes(closingMinutes);

    return {
      startIso,
      endIso,
      localDate,
      dayKey,
      startTime,
      endTime,
      label: `${DAY_LABELS[dayKey] || dayKey} ${localDate} as ${startTime}`,
    };
  }

  return null;
}

function resolveNextAiAllowedPeriod(args: {
  settings: StoreScheduleSettingsForSalesAiWindow | null;
  holidayBlocks: StoreScheduleHolidayBlockForSalesAiWindow[];
  now: Date;
  timeZone: string;
}): HumanOpenPeriod | null {
  if (!args.settings) return null;

  const nowParts = getLocalParts(args.now, args.timeZone);
  const nowTime = args.now.getTime();
  const policy = {
    enabled: args.settings.ai_after_hours_enabled === true,
    mode: resolveAfterHoursMode(args.settings.ai_after_hours_mode),
    start: parseSalesAiScheduleTimeToMinutes(args.settings.ai_after_hours_start),
    end: parseSalesAiScheduleTimeToMinutes(args.settings.ai_after_hours_end),
    attendsHolidays: args.settings.ai_attends_holidays === true,
  };
  const operatingDays = normalizeOperatingDays(args.settings.operating_days);

  for (let offset = 0; offset <= 21; offset += 1) {
    const dayParts = addDays(nowParts, offset);
    const dayKey = getDayKey(dayParts);
    const holidayBlock = findHolidayBlockForLocalDay({
      holidayBlocks: args.holidayBlocks,
      parts: dayParts,
      timeZone: args.timeZone,
    });
    const dayAllowsHumanWindow = !holidayBlock && operatingDays.includes(dayKey);
    const hours = readOperatingHours(args.settings, dayKey);
    const humanStart = parseSalesAiScheduleTimeToMinutes(hours.start);
    const humanEnd = parseSalesAiScheduleTimeToMinutes(hours.end);
    const intervals: Array<{ start: number; end: number; reason: string }> = [];

    if (
      dayAllowsHumanWindow &&
      humanStart !== null &&
      humanEnd !== null &&
      humanStart < humanEnd
    ) {
      intervals.push({ start: humanStart, end: humanEnd, reason: "human_open" });
    }

    if (policy.enabled && (!holidayBlock || policy.attendsHolidays)) {
      if (policy.mode === "all_closed_hours") {
        if (humanStart !== null && humanEnd !== null && humanStart < humanEnd) {
          intervals.push({ start: 0, end: humanStart, reason: "ai_after_hours" });
          intervals.push({ start: humanEnd, end: 24 * 60, reason: "ai_after_hours" });
        } else {
          intervals.push({ start: 0, end: 24 * 60, reason: "ai_after_hours" });
        }
      } else if (
        policy.mode === "specific_window" &&
        policy.start !== null &&
        policy.end !== null
      ) {
        if (policy.start < policy.end) {
          intervals.push({ start: policy.start, end: policy.end, reason: "ai_after_hours" });
        } else {
          intervals.push({ start: policy.start, end: 24 * 60, reason: "ai_after_hours" });
          intervals.push({ start: 0, end: policy.end, reason: "ai_after_hours" });
        }
      }
    }

    for (const interval of intervals.sort((a, b) => a.start - b.start)) {
      if (interval.start === interval.end) continue;
      const startIso = localDateTimeToUtcIso({
        ...dayParts,
        hour: Math.floor(interval.start / 60),
        minute: interval.start % 60,
        timeZone: args.timeZone,
      });
      const endIso =
        interval.end >= 24 * 60
          ? localDateTimeToUtcIso({
              ...addDays(dayParts, 1),
              hour: 0,
              minute: 0,
              timeZone: args.timeZone,
            })
          : localDateTimeToUtcIso({
              ...dayParts,
              hour: Math.floor(interval.end / 60),
              minute: interval.end % 60,
              timeZone: args.timeZone,
            });

      if (Date.parse(endIso) <= nowTime) continue;

      const effectiveStart =
        Date.parse(startIso) <= nowTime
          ? args.now.toISOString()
          : startIso;
      const startParts = getLocalParts(new Date(effectiveStart), args.timeZone);
      const startTime = formatMinutes(localMinute(startParts));
      const localDate = localDateString(startParts);

      return {
        startIso: effectiveStart,
        endIso,
        localDate,
        dayKey: getDayKey(startParts),
        startTime,
        endTime: interval.end >= 24 * 60 ? "00:00" : formatMinutes(interval.end),
        label: `${DAY_LABELS[getDayKey(startParts)] || getDayKey(startParts)} ${localDate} as ${startTime}`,
      };
    }
  }

  return null;
}

export function resolveSalesAiOperatingWindow(args: {
  settings: StoreScheduleSettingsForSalesAiWindow | null;
  holidayBlocks?: StoreScheduleHolidayBlockForSalesAiWindow[] | null;
  now?: Date;
}): SalesAiOperatingWindowContext {
  const now = args.now || new Date();
  const timeZone = safeSalesAiTimeZone(args.settings?.timezone_name);
  const localParts = getLocalParts(now, timeZone);
  const localNow = `${localDateString(localParts)} ${formatMinutes(localMinute(localParts))}`;
  const policy = {
    aiAfterHoursEnabled: args.settings?.ai_after_hours_enabled === true,
    aiAfterHoursMode: resolveAfterHoursMode(args.settings?.ai_after_hours_mode),
    aiAfterHoursStart:
      parseSalesAiScheduleTimeToMinutes(args.settings?.ai_after_hours_start) === null
        ? null
        : formatMinutes(parseSalesAiScheduleTimeToMinutes(args.settings?.ai_after_hours_start) as number),
    aiAfterHoursEnd:
      parseSalesAiScheduleTimeToMinutes(args.settings?.ai_after_hours_end) === null
        ? null
        : formatMinutes(parseSalesAiScheduleTimeToMinutes(args.settings?.ai_after_hours_end) as number),
    aiAttendsHolidays: args.settings?.ai_attends_holidays === true,
  };

  if (!args.settings) {
    return {
      decision: "AI_NOT_ALLOWED_NOW",
      humanAvailableNow: false,
      aiAllowedNow: false,
      humanUnavailableReason: "schedule_settings_missing",
      timezoneName: timeZone,
      localNow,
      isHolidayBlocked: false,
      holidayBlockTitle: null,
      nextHumanOpenPeriod: null,
      nextAiAllowedPeriod: null,
      policy,
    };
  }

  const holidayBlocks = args.holidayBlocks || [];
  const dayKey = getDayKey(localParts);
  const holidayBlock = findHolidayBlockForLocalDay({
    holidayBlocks,
    parts: localParts,
    timeZone,
  });
  const operatingDays = normalizeOperatingDays(args.settings.operating_days);
  const hours = readOperatingHours(args.settings, dayKey);
  const openingMinutes = parseSalesAiScheduleTimeToMinutes(hours.start);
  const closingMinutes = parseSalesAiScheduleTimeToMinutes(hours.end);
  const nowMinute = localMinute(localParts);
  const hasValidHumanWindow =
    operatingDays.includes(dayKey) &&
    openingMinutes !== null &&
    closingMinutes !== null &&
    openingMinutes < closingMinutes;
  const humanAvailableNow =
    !holidayBlock &&
    hasValidHumanWindow &&
    nowMinute >= (openingMinutes as number) &&
    nowMinute < (closingMinutes as number);
  const nextHumanOpenPeriod = resolveNextHumanOpenPeriod({
    settings: args.settings,
    holidayBlocks,
    now,
    timeZone,
  });
  const nextAiAllowedPeriod = resolveNextAiAllowedPeriod({
    settings: args.settings,
    holidayBlocks,
    now,
    timeZone,
  });

  if (humanAvailableNow) {
    return {
      decision: "HUMAN_OPEN",
      humanAvailableNow: true,
      aiAllowedNow: true,
      humanUnavailableReason: null,
      timezoneName: timeZone,
      localNow,
      isHolidayBlocked: false,
      holidayBlockTitle: null,
      nextHumanOpenPeriod,
      nextAiAllowedPeriod,
      policy,
    };
  }

  const humanUnavailableReason = holidayBlock
    ? "holiday_block"
    : hasValidHumanWindow
      ? "outside_human_operating_hours"
      : "human_operating_window_unavailable";

  const blockedContext = {
    humanAvailableNow: false,
    aiAllowedNow: false,
    humanUnavailableReason,
    timezoneName: timeZone,
    localNow,
    isHolidayBlocked: Boolean(holidayBlock),
    holidayBlockTitle: holidayBlock?.title || null,
    nextHumanOpenPeriod,
    nextAiAllowedPeriod,
    policy,
  };

  if (!policy.aiAfterHoursEnabled) {
    return {
      decision: "AI_NOT_ALLOWED_NOW",
      ...blockedContext,
    };
  }

  if (holidayBlock && !policy.aiAttendsHolidays) {
    return {
      decision: "AI_NOT_ALLOWED_NOW",
      ...blockedContext,
    };
  }

  if (policy.aiAfterHoursMode === "all_closed_hours") {
    return {
      decision: "AI_ALLOWED_AFTER_HOURS",
      ...blockedContext,
      aiAllowedNow: true,
    };
  }

  if (policy.aiAfterHoursMode === "specific_window") {
    const start = parseSalesAiScheduleTimeToMinutes(policy.aiAfterHoursStart);
    const end = parseSalesAiScheduleTimeToMinutes(policy.aiAfterHoursEnd);
    const insideWindow =
      start !== null &&
      end !== null &&
      isMinuteInsideWindow({ minute: nowMinute, start, end });

    return {
      decision: insideWindow ? "AI_ALLOWED_AFTER_HOURS" : "AI_NOT_ALLOWED_NOW",
      ...blockedContext,
      aiAllowedNow: insideWindow,
    };
  }

  return {
    decision: "AI_NOT_ALLOWED_NOW",
    ...blockedContext,
  };
}

export async function loadSalesAiOperatingWindowAuthority(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  now?: Date;
}): Promise<SalesAiOperatingWindowContext> {
  const selectWithAiPolicy =
    "operating_days, operating_hours, timezone_name, attends_holidays, ai_after_hours_enabled, ai_after_hours_mode, ai_after_hours_start, ai_after_hours_end, ai_attends_holidays";
  const selectWithoutAiPolicy =
    "operating_days, operating_hours, timezone_name, attends_holidays";
  let scheduleResult = await args.supabase
    .from("store_schedule_settings")
    .select(selectWithAiPolicy)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (scheduleResult.error && /ai_after_hours|ai_attends_holidays/i.test(scheduleResult.error.message || "")) {
    scheduleResult = await args.supabase
      .from("store_schedule_settings")
      .select(selectWithoutAiPolicy)
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .maybeSingle();
  }

  if (scheduleResult.error) {
    throw new Error(
      `Falha ao carregar politica operacional da IA comercial: ${scheduleResult.error.message}`,
    );
  }

  const settings = (scheduleResult.data || null) as StoreScheduleSettingsForSalesAiWindow | null;
  const timeZone = safeSalesAiTimeZone(settings?.timezone_name);
  const localParts = getLocalParts(args.now || new Date(), timeZone);
  const rangeStart = dayRangeUtcIso(localParts, timeZone).startIso;
  const rangeEnd = dayRangeUtcIso(addDays(localParts, 21), timeZone).endIso;
  const blocksResult = await args.supabase
    .from("store_schedule_blocks")
    .select("id, title, block_type, start_at, end_at")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("block_type", "holiday")
    .lt("start_at", rangeEnd)
    .gt("end_at", rangeStart);

  if (blocksResult.error) {
    throw new Error(
      `Falha ao carregar feriados da agenda para IA comercial: ${blocksResult.error.message}`,
    );
  }

  return resolveSalesAiOperatingWindow({
    settings,
    holidayBlocks: Array.isArray(blocksResult.data)
      ? (blocksResult.data as StoreScheduleHolidayBlockForSalesAiWindow[])
      : [],
    now: args.now,
  });
}

export function buildSalesAiOperatingWindowPromptBlock(
  context: SalesAiOperatingWindowContext | null | undefined,
): string {
  if (!context || context.decision !== "AI_ALLOWED_AFTER_HOURS") {
    return "";
  }

  return `
JANELA HUMANA / AFTER-HOURS
- a equipe humana esta fora do horario agora
- a IA esta autorizada estruturalmente a atender neste periodo
- se algum ponto depender de humano, nao invente aprovacao, agenda, preco, estoque, pagamento ou excecao
- explique naturalmente que precisa confirmar com a equipe
- proximo periodo util humano: ${context.nextHumanOpenPeriod?.label || "nao calculado com seguranca"}
`.trim();
}
