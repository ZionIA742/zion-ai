export function buildAssistantStoreScopeKey(
  organizationId: string | null | undefined,
  storeId: string | null | undefined,
) {
  const normalizedOrganizationId = String(organizationId || "").trim();
  const normalizedStoreId = String(storeId || "").trim();

  if (!normalizedOrganizationId || !normalizedStoreId) {
    return null;
  }

  return `${normalizedOrganizationId}:${normalizedStoreId}`;
}
