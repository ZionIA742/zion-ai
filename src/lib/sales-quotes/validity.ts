function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function isIsoDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isNumericOnlyValue(value: string) {
  return /^\d+$/.test(value);
}

function normalizeDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function parseDateCandidate(value: unknown) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;

  if (isNumericOnlyValue(normalized)) {
    return null;
  }

  if (isIsoDateOnly(normalized)) {
    return normalized;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return normalizeDateOnly(parsed);
}

export function parseValidityDays(value: unknown) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) return null;

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export function addDaysToDateString(baseDateValue: unknown, days: number) {
  const baseDate = new Date(String(baseDateValue || "").trim() || Date.now());
  if (Number.isNaN(baseDate.getTime())) {
    return null;
  }

  baseDate.setUTCHours(0, 0, 0, 0);
  baseDate.setUTCDate(baseDate.getUTCDate() + days);
  return normalizeDateOnly(baseDate);
}

export function resolveValidUntilFromValidityDays(args: {
  validityDays: unknown;
  baseDateValue: unknown;
}) {
  const parsedValidityDays = parseValidityDays(args.validityDays);
  if (parsedValidityDays == null) {
    return null;
  }

  return addDaysToDateString(args.baseDateValue, parsedValidityDays);
}

export function resolveDisplayValidityDays(args: {
  validityDaysValue?: unknown;
  validUntilValue?: unknown;
  baseDateValue?: unknown;
}) {
  const explicitValidityDays = normalizeOptionalText(args.validityDaysValue);
  if (explicitValidityDays && parseValidityDays(explicitValidityDays) != null) {
    return explicitValidityDays;
  }

  const normalizedValidUntil = normalizeOptionalText(args.validUntilValue);
  if (!normalizedValidUntil) {
    return null;
  }

  if (isNumericOnlyValue(normalizedValidUntil)) {
    return normalizedValidUntil;
  }

  const validUntilDate = parseDateCandidate(normalizedValidUntil);
  const baseDate = parseDateCandidate(args.baseDateValue);

  if (!validUntilDate || !baseDate) {
    return null;
  }

  const validUntilUtc = Date.parse(`${validUntilDate}T00:00:00.000Z`);
  const baseUtc = Date.parse(`${baseDate}T00:00:00.000Z`);

  if (!Number.isFinite(validUntilUtc) || !Number.isFinite(baseUtc)) {
    return null;
  }

  const diffDays = Math.round((validUntilUtc - baseUtc) / 86400000);
  if (!Number.isSafeInteger(diffDays) || diffDays < 0) {
    return null;
  }

  return String(diffDays);
}
