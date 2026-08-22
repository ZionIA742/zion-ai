export type CurrentCommercialProposalProjectionOutcome =
  | "current_proposal_updated"
  | "already_current_proposal"
  | "stale_sent_proposal_ignored";

export const CURRENT_COMMERCIAL_PROPOSAL_PROJECTION_ACCEPTED_OUTCOMES =
  new Set<CurrentCommercialProposalProjectionOutcome>([
    "current_proposal_updated",
    "already_current_proposal",
    "stale_sent_proposal_ignored",
  ]);

export const CURRENT_COMMERCIAL_PROPOSAL_PROJECTION_SOURCE =
  "sales_quote_send_route";

type CurrentCommercialProposalProjectionRpcRow = {
  commercial_opportunity_id: string;
  current_quote_id: string;
  current_quote_version_id: string;
  changed: boolean;
  outcome: string;
  updated_at: string | null;
};

export class CurrentCommercialProposalProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CurrentCommercialProposalProjectionError";
  }
}

export function buildCurrentCommercialProposalIdempotencyKey(args: {
  commercialOpportunityId: string;
  salesQuoteId: string;
  salesQuoteVersionId: string;
}) {
  return `current_commercial_proposal:${args.commercialOpportunityId}:${args.salesQuoteId}:${args.salesQuoteVersionId}`;
}

export const buildCurrentCommercialProposalProjectionIdempotencyKey =
  buildCurrentCommercialProposalIdempotencyKey;

function normalizeProjectionRow(data: unknown) {
  const row = Array.isArray(data)
    ? ((data[0] as CurrentCommercialProposalProjectionRpcRow | undefined) ?? null)
    : ((data as CurrentCommercialProposalProjectionRpcRow | null) ?? null);

  if (
    !row ||
    !CURRENT_COMMERCIAL_PROPOSAL_PROJECTION_ACCEPTED_OUTCOMES.has(
      row.outcome as CurrentCommercialProposalProjectionOutcome,
    )
  ) {
    throw new CurrentCommercialProposalProjectionError(
      "O envio foi concluido, mas a proposta comercial vigente retornou um resultado invalido.",
    );
  }

  return row;
}

export async function projectCurrentCommercialProposalBySystem(args: {
  supabase: {
    rpc: (
      fn: string,
      payload: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  salesQuoteId: string;
  salesQuoteVersionId: string;
  source?: string;
}) {
  const { data, error } = await args.supabase.rpc(
    "set_current_commercial_proposal_from_sent_quote_by_system",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_commercial_opportunity_id: args.commercialOpportunityId,
      p_sales_quote_id: args.salesQuoteId,
      p_sales_quote_version_id: args.salesQuoteVersionId,
      p_idempotency_key: buildCurrentCommercialProposalIdempotencyKey({
        commercialOpportunityId: args.commercialOpportunityId,
        salesQuoteId: args.salesQuoteId,
        salesQuoteVersionId: args.salesQuoteVersionId,
      }),
      p_source: args.source || CURRENT_COMMERCIAL_PROPOSAL_PROJECTION_SOURCE,
    },
  );

  if (error) {
    throw new CurrentCommercialProposalProjectionError(
      "O envio foi concluido, mas nao foi possivel sincronizar a proposta comercial vigente.",
    );
  }

  return normalizeProjectionRow(data);
}
