import type { SalesQuoteRow } from "./types";

export const HUMAN_QUOTE_EDIT_PROVENANCE_REQUIRED =
  "HUMAN_QUOTE_EDIT_PROVENANCE_REQUIRED";

const USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class HumanQuoteEditProvenanceError extends Error {
  readonly status = 403;
  readonly code = HUMAN_QUOTE_EDIT_PROVENANCE_REQUIRED;

  constructor() {
    super("Orcamento sem origem humana comprovada para edicao independente.");
    this.name = "HumanQuoteEditProvenanceError";
  }
}

export function assertHumanQuoteEditProvenance(
  quote: Pick<SalesQuoteRow, "metadata">,
): { creationActorUserId: string } {
  const metadata = quote?.metadata;

  const userId =
    typeof metadata?.creation_actor_user_id === "string"
      ? metadata.creation_actor_user_id.trim()
      : "";

  if (
    metadata?.created_via !== "api_sales_quotes_create" ||
    metadata?.creation_actor_kind !== "user" ||
    !USER_ID_PATTERN.test(userId)
  ) {
    throw new HumanQuoteEditProvenanceError();
  }

  return { creationActorUserId: userId };
}

// Eligibility is distinct from proof of the original creator's identity.
// The legacy marker is issued only by the administrative database guard.
export function isLegacyHumanQuoteEditEligible(
  quote: Parameters<typeof assertHumanQuoteEditProvenance>[0],
): boolean {
  const metadata = quote.metadata;
  return Boolean(
    metadata && typeof metadata === "object" && !Array.isArray(metadata) &&
    metadata.created_via === "api_sales_quotes_create" &&
    metadata.legacy_human_edit_eligible === true &&
    !Object.prototype.hasOwnProperty.call(metadata, "creation_actor_kind") &&
    !Object.prototype.hasOwnProperty.call(metadata, "creation_actor_user_id")
  );
}

export function assertHumanQuoteEditEligibility(
  quote: Parameters<typeof assertHumanQuoteEditProvenance>[0],
): { creationActorUserId: string | null } {
  if (isLegacyHumanQuoteEditEligible(quote)) {
    return { creationActorUserId: null };
  }
  return assertHumanQuoteEditProvenance(quote);
}
