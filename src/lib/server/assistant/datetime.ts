import type { StoreScheduleSettingsRow } from "./types";

type ScheduleDateParts = { day: number; month: number; year: number };

function normalizeDateTimeText(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function formatDateTime(value: string | null) {
  if (!value) return "sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sem data";
  return date.toLocaleString("pt-BR");
}

export function formatDateOnly(value: string | null) {
  if (!value) return "sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sem data";
  return date.toLocaleDateString("pt-BR");
}

export function formatTimeOnly(value: string | null) {
  if (!value) return "sem hora";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sem hora";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function getScheduleTimezone(settings?: StoreScheduleSettingsRow | null) {
  const configuredTimezone = String(settings?.timezone_name || "").trim();
  return configuredTimezone || "America/Sao_Paulo";
}

export function padTwoDigits(value: number) {
  return String(value).padStart(2, "0");
}

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function safeScheduleTimezone(timeZone: string) {
  return isValidTimeZone(timeZone) ? timeZone : "America/Sao_Paulo";
}

export function formatDateOnlyInTimeZone(value: string | null, timeZone: string) {
  if (!value) return "sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sem data";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: safeScheduleTimezone(timeZone),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatTimeOnlyInTimeZone(value: string | null, timeZone: string) {
  if (!value) return "sem hora";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sem hora";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: safeScheduleTimezone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function getTimeZoneOffsetMinutes(timeZone: string, date: Date) {
  const safeTimeZone = safeScheduleTimezone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const values: Record<string, number> = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }

  const asUtc = Date.UTC(
    values.year,
    (values.month || 1) - 1,
    values.day || 1,
    values.hour === 24 ? 0 : values.hour || 0,
    values.minute || 0,
    values.second || 0,
    0
  );

  return Math.round((asUtc - date.getTime()) / 60000);
}

export function localScheduleDateTimeToUtcIso(args: {
  dateParts: ScheduleDateParts;
  hour: number;
  minute: number;
  timeZone: string;
}) {
  const safeTimeZone = safeScheduleTimezone(args.timeZone);
  const localUtcMs = Date.UTC(
    args.dateParts.year,
    args.dateParts.month,
    args.dateParts.day,
    args.hour,
    args.minute,
    0,
    0
  );

  let utcMs = localUtcMs;

  for (let i = 0; i < 3; i += 1) {
    const offsetMinutes = getTimeZoneOffsetMinutes(safeTimeZone, new Date(utcMs));
    const nextUtcMs = localUtcMs - offsetMinutes * 60 * 1000;
    if (Math.abs(nextUtcMs - utcMs) < 1000) {
      utcMs = nextUtcMs;
      break;
    }
    utcMs = nextUtcMs;
  }

  return new Date(utcMs).toISOString();
}

export function getLocalDateKeyFromIso(iso: string | null | undefined, settings?: StoreScheduleSettingsRow | null) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const timeZone = safeScheduleTimezone(getScheduleTimezone(settings || null));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  if (!values.year || !values.month || !values.day) return null;
  return `${values.year}-${values.month}-${values.day}`;
}

export function getDateKeyFromParts(dateParts: ScheduleDateParts | null | undefined) {
  if (!dateParts) return null;
  return `${dateParts.year}-${padTwoDigits(dateParts.month + 1)}-${padTwoDigits(dateParts.day)}`;
}

export function formatDatePartsForHuman(dateParts: ScheduleDateParts | null | undefined) {
  if (!dateParts) return "essa data";
  return `${padTwoDigits(dateParts.day)}/${padTwoDigits(dateParts.month + 1)}/${dateParts.year}`;
}

export function isoDateToLocalDateForDb(iso: string | null | undefined, timeZone: string) {
  if (!iso) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: safeScheduleTimezone(timeZone), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const values: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") values[part.type] = part.value;
  return values.year && values.month && values.day ? `${values.year}-${values.month}-${values.day}` : null;
}

export function getLocalDatePartsForSchedule(settings?: StoreScheduleSettingsRow | null, date = new Date()) {
  const timeZone = safeScheduleTimezone(getScheduleTimezone(settings || null));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year || date.getFullYear(),
    month: values.month || date.getMonth() + 1,
    day: values.day || date.getDate(),
  };
}

export function buildIsoFromDateAndTime(
  dateParts: ScheduleDateParts,
  time: string,
  settings?: StoreScheduleSettingsRow | null
) {
  const [hour, minute] = time.split(":").map(Number);
  return localScheduleDateTimeToUtcIso({
    dateParts,
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
    timeZone: getScheduleTimezone(settings || null),
  });
}

export function buildStoreLocalDayRangeIso(settings?: StoreScheduleSettingsRow | null, date = new Date()) {
  const dateParts = getLocalDatePartsForSchedule(settings || null, date);
  return {
    startIso: buildIsoFromDateAndTime(dateParts, "00:00", settings || null),
    endIso: buildIsoFromDateAndTime(dateParts, "23:59", settings || null),
    dateKey: `${dateParts.year}-${padTwoDigits(dateParts.month)}-${padTwoDigits(dateParts.day)}`,
  };
}

export function parseScheduleDateFromText(text: string, now: Date) {
  const normalized = normalizeDateTimeText(text);

  const numeric = normalized.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (numeric) {
    let year = numeric[3] ? Number(numeric[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    return {
      day: Number(numeric[1]),
      month: Number(numeric[2]) - 1,
      year,
    };
  }

  const monthMap: Record<string, number> = {
    janeiro: 0,
    fevereiro: 1,
    marco: 2,
    "março": 2,
    abril: 3,
    maio: 4,
    junho: 5,
    julho: 6,
    agosto: 7,
    setembro: 8,
    outubro: 9,
    novembro: 10,
    dezembro: 11,
  };

  const written = normalized.match(
    /\b(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?\b/
  );
  if (written) {
    let year = written[3] ? Number(written[3]) : now.getFullYear();
    const month = monthMap[written[2]];
    const day = Number(written[1]);
    let candidate = new Date(year, month, day);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    if (!written[3] && candidate.getTime() < today.getTime()) {
      year += 1;
      candidate = new Date(year, month, day);
    }
    return { day, month, year };
  }

  const bareDay = normalized.match(/\bdia\s+(\d{1,2})(?!\d)/);
  if (bareDay) {
    const day = Number(bareDay[1]);
    let month = now.getMonth();
    let year = now.getFullYear();
    let candidate = new Date(year, month, day);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    if (candidate.getTime() < today.getTime()) {
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
      candidate = new Date(year, month, day);
    }
    return { day: candidate.getDate(), month: candidate.getMonth(), year: candidate.getFullYear() };
  }

  const base = new Date(now);
  base.setHours(0, 0, 0, 0);

  if (normalized.includes("amanha") || normalized.includes("amanhã")) {
    base.setDate(base.getDate() + 1);
    return { day: base.getDate(), month: base.getMonth(), year: base.getFullYear() };
  }

  if (normalized.includes("hoje")) {
    return { day: base.getDate(), month: base.getMonth(), year: base.getFullYear() };
  }

  return null;
}

export function parseDateReferenceFromText(text: string, now: Date) {
  return parseScheduleDateFromText(text, now);
}

export function parseCompleteScheduleDateFromText(text: string, now: Date) {
  const raw = String(text || "");
  const numeric = raw.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    let year = numeric[3] ? Number(numeric[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    return { day, month: month - 1, year };
  }

  const normalized = normalizeDateTimeText(raw);
  if (/\b\d{1,2}\s+de\s+(janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/.test(normalized)) {
    return parseDateReferenceFromText(raw, now);
  }

  return null;
}

export function hasAmbiguousBareDayDateReference(text: string) {
  const normalized = normalizeDateTimeText(text);
  const hasCompleteNumericDate = /\b\d{1,2}\s*\/\s*\d{1,2}(?:\s*\/\s*\d{2,4})?\b/.test(normalized);
  const hasWrittenMonth = /\b\d{1,2}\s+de\s+(janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/.test(normalized);
  return !hasCompleteNumericDate && !hasWrittenMonth && /\b(?:dia|data)\s+\d{1,2}\b/.test(normalized);
}

export function normalizeScheduleTimeText(hourText: string, minuteText?: string | null) {
  const hour = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  return `${padTwoDigits(hour)}:${padTwoDigits(minute)}`;
}

export function parseTimeRangeFromText(text: string) {
  const normalized = normalizeDateTimeText(text)
    .replace(/\b\d{1,2}\s*\/\s*\d{1,2}(?:\s*\/\s*\d{2,4})?\b/g, " ")
    .replace(/\b\d{1,2}\s+de\s+(?:janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+\d{2,4})?\b/g, " ");

  const rangeMatch = normalized.match(/\b(?:das?|de|do)?\s*(\d{1,2})(?::(\d{2}))?\s*h?\s*(?:ate|as|a|-)\s*(?:as?\s*)?(\d{1,2})(?::(\d{2}))?\s*h?\b/i);
  if (rangeMatch) {
    const startTime = normalizeScheduleTimeText(rangeMatch[1], rangeMatch[2]);
    const endTime = normalizeScheduleTimeText(rangeMatch[3], rangeMatch[4]);
    if (startTime && endTime) return { startTime, endTime };
  }

  const singleMatch = normalized.match(/\b(?:as|para|pra)?\s*(\d{1,2})(?::(\d{2}))?\s*h\b/i) ||
    normalized.match(/\b(?:as|para|pra)\s+(\d{1,2})(?::(\d{2}))?\b/i) ||
    normalized.match(/\b(\d{1,2}:\d{2})\b/);
  if (singleMatch) {
    if (singleMatch[1]?.includes(":")) {
      const [hour, minute] = singleMatch[1].split(":");
      const startTime = normalizeScheduleTimeText(hour, minute);
      if (startTime) return { startTime, endTime: null as string | null };
    }
    const startTime = normalizeScheduleTimeText(singleMatch[1], singleMatch[2]);
    if (startTime) return { startTime, endTime: null as string | null };
  }

  return null;
}

export function addMinutesToIso(iso: string, minutes: number) {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

export function getScheduleParsingNow(settings?: StoreScheduleSettingsRow | null) {
  const timeZone = safeScheduleTimezone(getScheduleTimezone(settings || null));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }

  return new Date(
    values.year || new Date().getFullYear(),
    (values.month || 1) - 1,
    values.day || 1,
    values.hour === 24 ? 0 : values.hour || 0,
    values.minute || 0,
    values.second || 0,
    0
  );
}

export function parseDbDateKeyToScheduleParts(dateKey: string | null | undefined) {
  const raw = String(dateKey || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return { year, month: month - 1, day };
}
