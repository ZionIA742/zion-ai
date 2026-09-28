type LocalDateTimeParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

export function isValidScheduleTimeZone(value: string | null | undefined): value is string {
  const timezone = String(value || '').trim();
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function getLocalDateTimeParts(value: Date, timezone: string): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: values.year, month: values.month, day: values.day,
    hour: values.hour === '24' ? '00' : values.hour,
    minute: values.minute, second: values.second,
  };
}

export function getStoreLocalDateTimeParts(value: string | Date, timezone: string | null | undefined) {
  if (!isValidScheduleTimeZone(timezone)) return null;
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  return getLocalDateTimeParts(instant, timezone);
}

export function getStoreLocalDateKey(value: string | Date, timezone: string | null | undefined) {
  const parts = getStoreLocalDateTimeParts(value, timezone);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : null;
}

function formatLocalDateTime(value: Date, timezone: string) {
  const parts = getLocalDateTimeParts(value, timezone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function storeLocalDateTimeToUtcIso(value: string, timezone: string | null | undefined) {
  if (!isValidScheduleTimeZone(timezone) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const [datePart, timePart] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const matches: Date[] = [];
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = new Date(wallClockAsUtc - offsetMinutes * 60000);
    if (formatLocalDateTime(candidate, timezone) === value) matches.push(candidate);
  }
  if (matches.length !== 1) return null;
  return matches[0].toISOString();
}

export function utcIsoToStoreLocalDateTime(value: string | null, timezone: string | null | undefined) {
  if (!value || !isValidScheduleTimeZone(timezone)) return '';
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return '';
  return formatLocalDateTime(instant, timezone);
}

export function storeDateKeyToUtcIso(dateKey: string, timezone: string | null | undefined, time = '00:00') {
  return storeLocalDateTimeToUtcIso(`${dateKey}T${time}`, timezone);
}

export function addStoreCalendarDays(dateKey: string, amount: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + amount));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, '0')}-${String(result.getUTCDate()).padStart(2, '0')}`;
}

export function storeTodayDateKey(timezone: string | null | undefined, now = new Date()) {
  return getStoreLocalDateKey(now, timezone);
}
