export function formatOfficialWhatsappDisplay(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
