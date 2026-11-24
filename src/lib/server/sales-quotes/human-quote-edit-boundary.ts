import type { SalesQuoteRow } from "./types";
import { assertHumanQuoteEditEligibility } from "./human-quote-edit-provenance";

type Quote = Pick<
  SalesQuoteRow,
  "metadata" | "status" | "updated_at" | "current_version_id"
>;

export class HumanQuoteEditBoundaryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HumanQuoteEditBoundaryError";
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function prepareHumanQuoteEditBoundary(args: {
  quote: Quote;
  expectedUpdatedAt: unknown;
  expectedCurrentVersionId: unknown;
}) {
  const { quote } = args;

  assertHumanQuoteEditEligibility(quote);

  const currentUpdatedAt = String(quote.updated_at || "").trim();
  const currentVersionId = quote.current_version_id ?? null;
  const currentStatus = String(quote.status || "").trim();

  if (!currentUpdatedAt || !currentStatus) {
    throw new HumanQuoteEditBoundaryError(
      409,
      "HUMAN_QUOTE_STATE_INCOMPLETE",
      "Estado atual do orcamento incompleto.",
    );
  }

  const expectedUpdatedAt =
    typeof args.expectedUpdatedAt === "string"
      ? args.expectedUpdatedAt.trim()
      : "";

  const expectedVersion = args.expectedCurrentVersionId;

  if (
    !expectedUpdatedAt ||
    (
      expectedVersion !== null &&
      (
        typeof expectedVersion !== "string" ||
        !UUID_RE.test(expectedVersion)
      )
    )
  ) {
    throw new HumanQuoteEditBoundaryError(
      428,
      "HUMAN_QUOTE_EDIT_PRECONDITION_REQUIRED",
      "Recarregue o orcamento antes de editar.",
    );
  }

  if (
    expectedUpdatedAt !== currentUpdatedAt ||
    expectedVersion !== currentVersionId
  ) {
    throw new HumanQuoteEditBoundaryError(
      409,
      "HUMAN_QUOTE_EDIT_STALE",
      "O orcamento foi modificado. Recarregue antes de salvar.",
    );
  }

  return {
    expectedUpdatedAt: currentUpdatedAt,
    expectedCurrentVersionId: currentVersionId,
    preservedStatus: currentStatus,
    preservedMetadata: { ...quote.metadata },
    priorPdfVersionId: currentVersionId,
  };
}
