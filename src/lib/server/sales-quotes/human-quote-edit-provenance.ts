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
