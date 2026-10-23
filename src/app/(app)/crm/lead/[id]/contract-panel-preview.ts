export type ContractPreviewContract = {
  id: string;
  current_version_id: string | null;
};

export type ContractPreviewTemplate = {
  available?: boolean;
  signedUrl?: string | null;
  mimeType?: string | null;
};

export type ContractPreviewTarget =
  | { kind: "contract"; id: string }
  | { kind: "template"; signedUrl: string };

function isPdfMimeType(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase() === "application/pdf";
}

/** Prefer the buyer-specific contract; only fall back to the active PDF template. */
export function chooseContractPreviewTarget(
  contracts: ContractPreviewContract[],
  template: ContractPreviewTemplate | null | undefined,
): ContractPreviewTarget | null {
  const specific = contracts.find(
    (contract) => Boolean(String(contract.id || "").trim()) && Boolean(contract.current_version_id),
  );
  if (specific) return { kind: "contract", id: specific.id };

  const signedUrl = String(template?.signedUrl || "").trim();
  if (template?.available === true && signedUrl && isPdfMimeType(template.mimeType)) {
    return { kind: "template", signedUrl };
  }

  return null;
}
