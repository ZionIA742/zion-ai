import { createHash } from "node:crypto";

type RpcError = { message?: string | null } | null;

type AcceptanceReaderRow = {
  revision_id?: unknown;
  quote_id?: unknown;
  target_quote_version_id?: unknown;
  source_acceptance_event_id?: unknown;
  source_quote_version_id?: unknown;
  outcome?: unknown;
  quote_status?: unknown;
  commercial_opportunity_id?: unknown;
  lifecycle_cycle?: unknown;
  current_quote_id?: unknown;
  current_quote_version_id?: unknown;
  acceptance_state?: unknown;
  reason_code?: unknown;
  acceptance_event_id?: unknown;
  source_message_id?: unknown;
  accepted_at?: unknown;
};

type AcceptanceReaderResult = {
  data: unknown;
  error: RpcError;
};

type AcceptanceReaderClient = {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<AcceptanceReaderResult>;
};

export const CURRENT_COMMERCIAL_PROPOSAL_ACCEPTANCE_READER =
  "read_current_commercial_proposal_acceptance_by_system" as const;

export const ACCEPTED_SALES_QUOTE_REVISION_SQL_REQUIRED =
  "POST_ACCEPTANCE_REVISION_SQL_REQUIRED" as const;

export const ACCEPTED_SALES_QUOTE_REVISION_RPC =
  "create_accepted_sales_quote_revision_by_system" as const;

export const ACCEPTED_REVISION_INPUT_FINGERPRINT_KEY =
  "_zion_p9_accepted_revision_input_sha256" as const;

export type AcceptedSalesQuoteRevisionRpcResult = {
  revisionId: string;
  quoteId: string;
  sourceQuoteVersionId: string;
  targetQuoteVersionId: string;
  sourceAcceptanceEventId: string;
  quoteStatus: "pending_review";
  outcome: "created" | "replayed";
};

export type AcceptedSalesQuoteRevisionResolution =
  | { kind: "not_accepted" }
  | {
      kind: "accepted";
      commercialOpportunityId: string;
      lifecycleCycle: number;
      quoteId: string;
      quoteVersionId: string;
      acceptanceEventId: string;
      sourceMessageId: string;
      acceptedAt: string;
    };

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function oneRow(data: unknown): AcceptanceReaderRow | null {
  if (Array.isArray(data)) {
    if (data.length !== 1) return null;
    return data[0] && typeof data[0] === "object" ? data[0] as AcceptanceReaderRow : null;
  }
  return data && typeof data === "object" ? data as AcceptanceReaderRow : null;
}

function requireText(value: unknown, field: string) {
  const normalized = text(value);
  if (!normalized) throw new Error(`POST_ACCEPTANCE_REVISION_RPC_RETURN_INVALID:${field}`);
  return normalized;
}

export function buildAcceptedSalesQuoteRevisionOperationKey(changeRequestId: string) {
  const normalized = text(changeRequestId);
  if (!normalized) throw new Error("POST_ACCEPTANCE_REVISION_CHANGE_REQUEST_REQUIRED");
  return `accepted-quote-revision:${normalized}`.slice(0, 128);
}

export function buildAcceptedSalesQuoteRevisionInputFingerprint(
  body: Record<string, unknown>,
  changeRequestId: string,
) {
  const canonical = {
    changeRequestId,
    title: body.title ?? null,
    discount_cents: body.discount_cents ?? null,
    customer_notes: body.customer_notes ?? null,
    internal_notes: body.internal_notes ?? null,
    payment_terms: body.payment_terms ?? null,
    delivery_terms: body.delivery_terms ?? null,
    warranty_terms: body.warranty_terms ?? null,
    validity_days: body.validity_days ?? null,
    items: Array.isArray(body.items)
      ? body.items.map((item) => {
          const record = item && typeof item === "object"
            ? item as Record<string, unknown>
            : {};
          return {
            id: record.id ?? null,
            item_type: record.item_type ?? null,
            name: record.name ?? null,
            description: record.description ?? null,
            quantity: record.quantity ?? null,
            unit_price_cents: record.unit_price_cents ?? null,
            discount_cents: record.discount_cents ?? null,
          };
        })
      : null,
  };

  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

export async function createAcceptedSalesQuoteRevisionBySystem(args: {
  supabase: AcceptanceReaderClient;
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  expectedLifecycleCycle: number;
  quoteId: string;
  sourceQuoteVersionId: string;
  sourceAcceptanceEventId: string;
  changeRequestId: string;
  operationKey: string;
  revision: Record<string, unknown>;
}): Promise<AcceptedSalesQuoteRevisionRpcResult> {
  const { data, error } = await args.supabase.rpc(
    ACCEPTED_SALES_QUOTE_REVISION_RPC,
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_commercial_opportunity_id: args.commercialOpportunityId,
      p_expected_lifecycle_cycle: args.expectedLifecycleCycle,
      p_quote_id: args.quoteId,
      p_source_quote_version_id: args.sourceQuoteVersionId,
      p_source_acceptance_event_id: args.sourceAcceptanceEventId,
      p_change_request_id: args.changeRequestId,
      p_operation_key: args.operationKey,
      p_revision: args.revision,
    },
  );

  if (error) throw new Error(`POST_ACCEPTANCE_REVISION_RPC_FAILED:${error.message || "unknown"}`);

  const row = oneRow(data);
  if (!row) throw new Error("POST_ACCEPTANCE_REVISION_RPC_RETURN_INVALID");

  const outcome = text(row.outcome);
  const quoteStatus = text(row.quote_status);
  if (outcome !== "created" && outcome !== "replayed") {
    throw new Error("POST_ACCEPTANCE_REVISION_RPC_RETURN_INVALID:outcome");
  }
  if (quoteStatus !== "pending_review") {
    throw new Error("POST_ACCEPTANCE_REVISION_RPC_RETURN_INVALID:quote_status");
  }

  const result = {
    revisionId: requireText(row.revision_id, "revision_id"),
    quoteId: requireText(row.quote_id, "quote_id"),
    sourceQuoteVersionId: requireText(row.source_quote_version_id, "source_quote_version_id"),
    targetQuoteVersionId: requireText(row.target_quote_version_id, "target_quote_version_id"),
    sourceAcceptanceEventId: requireText(row.source_acceptance_event_id, "source_acceptance_event_id"),
    quoteStatus: "pending_review" as const,
    outcome: outcome as "created" | "replayed",
  };

  if (
    result.quoteId !== args.quoteId ||
    result.sourceQuoteVersionId !== args.sourceQuoteVersionId ||
    result.sourceAcceptanceEventId !== args.sourceAcceptanceEventId
  ) {
    throw new Error("POST_ACCEPTANCE_REVISION_RPC_RETURN_SCOPE_INVALID");
  }

  return result;
}

export async function resolveAcceptedSalesQuoteRevision(args: {
  supabase: AcceptanceReaderClient;
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string | null | undefined;
  quoteId: string;
  quoteVersionId: string | null | undefined;
}): Promise<AcceptedSalesQuoteRevisionResolution> {
  const commercialOpportunityId = text(args.commercialOpportunityId);
  const quoteVersionId = text(args.quoteVersionId);
  if (!commercialOpportunityId || !quoteVersionId) return { kind: "not_accepted" };

  const { data, error } = await args.supabase.rpc(
    CURRENT_COMMERCIAL_PROPOSAL_ACCEPTANCE_READER,
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_commercial_opportunity_id: commercialOpportunityId,
    },
  );

  if (error) {
    throw new Error(`Falha ao resolver aceite comercial canônico: ${error.message || "retorno RPC inválido"}`);
  }

  const row = oneRow(data);
  if (!row) {
    throw new Error("Falha ao resolver aceite comercial canônico: retorno RPC inválido.");
  }

  if (text(row.acceptance_state) !== "accepted") return { kind: "not_accepted" };

  const readerOpportunityId = text(row.commercial_opportunity_id);
  const readerQuoteId = text(row.current_quote_id);
  const readerVersionId = text(row.current_quote_version_id);
  const lifecycleCycle = Number(row.lifecycle_cycle);
  const acceptanceEventId = text(row.acceptance_event_id);
  const sourceMessageId = text(row.source_message_id);
  const acceptedAt = text(row.accepted_at);

  if (
    text(row.reason_code) !== "current_proposal_accepted" ||
    readerOpportunityId !== commercialOpportunityId ||
    readerQuoteId !== args.quoteId ||
    readerVersionId !== quoteVersionId ||
    !Number.isInteger(lifecycleCycle) ||
    lifecycleCycle < 1 ||
    !acceptanceEventId ||
    !sourceMessageId ||
    !acceptedAt
  ) {
    throw new Error("POST_ACCEPTANCE_REVISION_ACCEPTANCE_SCOPE_INVALID");
  }

  return {
    kind: "accepted",
    commercialOpportunityId,
    lifecycleCycle,
    quoteId: readerQuoteId,
    quoteVersionId: readerVersionId,
    acceptanceEventId,
    sourceMessageId,
    acceptedAt,
  };
}
