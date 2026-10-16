type RpcError = { message?: string | null } | null;

type RpcClient = {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError }>;
};

export const QUOTE_APPROVAL_REQUEST_RPC =
  "p9_request_quote_send_approval_by_system" as const;

export type QuoteApprovalRequestResult = {
  requestId: string;
  status:
    | "pending_dispatch"
    | "awaiting_responsible"
    | "dispatch_uncertain"
    | "approved";
  created: boolean;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function oneRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    if (data.length !== 1) return null;
    return data[0] && typeof data[0] === "object" && !Array.isArray(data[0])
      ? data[0] as Record<string, unknown>
      : null;
  }
  return data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
}

export async function requestQuoteSendApprovalBySystem(args: {
  supabase: RpcClient;
  organizationId: string;
  storeId: string;
  responsibleId: string;
  commercialOpportunityId: string;
  expectedLifecycleCycle: number;
  quoteId: string;
  quoteVersionId: string;
  reportSnapshot: Record<string, unknown>;
}): Promise<QuoteApprovalRequestResult> {
  const { data, error } = await args.supabase.rpc(
    QUOTE_APPROVAL_REQUEST_RPC,
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_responsible_id: args.responsibleId,
      p_commercial_opportunity_id: args.commercialOpportunityId,
      p_expected_lifecycle_cycle: args.expectedLifecycleCycle,
      p_quote_id: args.quoteId,
      p_quote_version_id: args.quoteVersionId,
      p_report_snapshot: args.reportSnapshot,
    },
  );

  if (error) {
    throw new Error(`P9_QUOTE_APPROVAL_REQUEST_RPC_FAILED:${error.message || "unknown"}`);
  }

  const row = oneRow(data);
  const requestId = text(row?.request_id);
  const status = text(row?.status);
  if (
    !requestId ||
    !["pending_dispatch", "awaiting_responsible", "dispatch_uncertain", "approved"].includes(status) ||
    typeof row?.created !== "boolean"
  ) {
    throw new Error("P9_QUOTE_APPROVAL_REQUEST_RPC_RETURN_INVALID");
  }

  return {
    requestId,
    status: status as QuoteApprovalRequestResult["status"],
    created: row.created,
  };
}
