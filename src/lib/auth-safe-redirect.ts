const WHATSAPP_NUMBER_CHANGE_PATH = "/whatsapp-number-change";

export function getSafeInternalLoginRedirect(value: string | null): string | null {
  if (!value) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }

  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\")) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(decoded, "https://zion.internal");
  } catch {
    return null;
  }

  if (url.origin !== "https://zion.internal") return null;

  const isWhatsappNumberChange = url.pathname === WHATSAPP_NUMBER_CHANGE_PATH;
  const isConventionalDestination =
    url.pathname === "/onboarding" || url.pathname === "/crm" || url.pathname.startsWith("/crm/");
  if (!isWhatsappNumberChange && !isConventionalDestination) return null;

  if (isWhatsappNumberChange && !url.searchParams.get("token")?.trim()) return null;
  return `${url.pathname}${url.search}`;
}
