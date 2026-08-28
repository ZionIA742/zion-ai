function digitsOnly(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
}

export function extractManualLeadPhoneDigits(
  value: string | null | undefined,
): string {
  const rawValue = String(value || "");
  const digits = digitsOnly(rawValue);
  const hasExplicitBrazilCountryCode = rawValue.trim().startsWith("+55");

  if (
    digits.startsWith("55") &&
    (hasExplicitBrazilCountryCode || digits.length > 11)
  ) {
    const localDigits = digits.slice(2);
    if (localDigits.length >= 10) {
      return localDigits.slice(0, 11);
    }
  }

  return digits.slice(0, 11);
}

export function formatManualLeadPhone(
  value: string | null | undefined,
): string {
  const digits = extractManualLeadPhoneDigits(value);

  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;

  const ddd = digits.slice(0, 2);
  const subscriber = digits.slice(2);

  if (!subscriber) {
    return `(${ddd}`;
  }

  const useMobileMask =
    digits.length > 10 || subscriber.startsWith("9");
  const prefixLength = useMobileMask ? 5 : 4;

  if (subscriber.length <= prefixLength) {
    return `(${ddd}) ${subscriber}`;
  }

  return `(${ddd}) ${subscriber.slice(0, prefixLength)}-${subscriber.slice(
    prefixLength,
    prefixLength + 4,
  )}`;
}
