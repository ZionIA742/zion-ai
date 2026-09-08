const DEFAULT_DASHBOARD_TIME_ZONE = "America/Sao_Paulo";

type CivilDate = {
  year: number;
  month: number;
  day: number;
};

type ZonedDateTimeParts = CivilDate & {
  hour: number;
  minute: number;
  second: number;
};

export type DashboardPeriod = {
  timeZone: string;
  todayDateKey: string;
  todayStart: string;
  todayEnd: string;
  weekStart: string;
  monthStart: string;
  monthEnd: string;
  next30DaysEnd: string;
};

function validateTimeZone(value: string | null | undefined) {
  const candidate = String(value || "").trim();

  if (!candidate) return DEFAULT_DASHBOARD_TIME_ZONE;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return DEFAULT_DASHBOARD_TIME_ZONE;
  }
}

function getZonedParts(date: Date, timeZone: string): ZonedDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getZonedParts(date, timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    date.getUTCMilliseconds()
  );

  return localAsUtc - date.getTime();
}

function zonedCivilTimeToUtc(
  date: CivilDate,
  time: { hour: number; minute: number; second: number; millisecond: number },
  timeZone: string
) {
  const localAsUtc = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    time.hour,
    time.minute,
    time.second,
    time.millisecond
  );
  let utc = localAsUtc;

  for (let index = 0; index < 3; index += 1) {
    utc = localAsUtc - getTimeZoneOffsetMs(new Date(utc), timeZone);
  }

  return new Date(utc);
}

function addCalendarDays(date: CivilDate, days: number): CivilDate {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + days));

  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

function formatDateKey(date: CivilDate) {
  return [
    String(date.year).padStart(4, "0"),
    String(date.month).padStart(2, "0"),
    String(date.day).padStart(2, "0"),
  ].join("-");
}

export function buildDashboardPeriod(
  now: Date,
  configuredTimeZone: string | null | undefined
): DashboardPeriod {
  const timeZone = validateTimeZone(configuredTimeZone);
  const today = getZonedParts(now, timeZone);
  const todayDate = {
    year: today.year,
    month: today.month,
    day: today.day,
  };
  const weekStartDate = addCalendarDays(todayDate, -6);
  const next30DaysDate = addCalendarDays(todayDate, 30);
  const monthStartDate = {
    year: todayDate.year,
    month: todayDate.month,
    day: 1,
  };
  const monthEndDate = addCalendarDays(
    { year: todayDate.year, month: todayDate.month + 1, day: 1 },
    -1
  );
  const startOfDay = { hour: 0, minute: 0, second: 0, millisecond: 0 };
  const endOfDay = { hour: 23, minute: 59, second: 59, millisecond: 999 };

  return {
    timeZone,
    todayDateKey: formatDateKey(todayDate),
    todayStart: zonedCivilTimeToUtc(todayDate, startOfDay, timeZone).toISOString(),
    todayEnd: zonedCivilTimeToUtc(todayDate, endOfDay, timeZone).toISOString(),
    weekStart: zonedCivilTimeToUtc(weekStartDate, startOfDay, timeZone).toISOString(),
    monthStart: zonedCivilTimeToUtc(monthStartDate, startOfDay, timeZone).toISOString(),
    monthEnd: zonedCivilTimeToUtc(monthEndDate, endOfDay, timeZone).toISOString(),
    next30DaysEnd: zonedCivilTimeToUtc(next30DaysDate, endOfDay, timeZone).toISOString(),
  };
}
