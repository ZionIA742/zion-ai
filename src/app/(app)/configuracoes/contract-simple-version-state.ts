export function getContractSimpleVersionState(input: {
  status: string | null | undefined;
  isActiveVersion: boolean;
  hasDocument: boolean;
  isRejected: boolean;
  mimeType: string | null | undefined;
}) {
  const normalizedStatus = String(input.status || "").trim().toLowerCase();
  const canActivate =
    !input.isActiveVersion &&
    !input.isRejected &&
    input.hasDocument &&
    ["uploaded", "analyzed", "awaiting_review"].includes(normalizedStatus);

  return {
    canDownload: input.hasDocument,
    canView: input.hasDocument && String(input.mimeType || "").trim().toLowerCase() === "application/pdf",
    canActivate,
    isHistorical: !input.isActiveVersion && !canActivate,
  };
}
