import type { SupabaseClient } from "@supabase/supabase-js";

export const QUOTE_APPROVAL_DECISION_RPC =
  "p9_decide_quote_approval_by_responsible_by_system" as const;

type ApprovalRequest = {
  id: string;
  organization_id: string;
  store_id: string;
  responsible_id: string;
  commercial_opportunity_id: string;
  lifecycle_cycle: number;
  quote_id: string;
  quote_version_id: string;
  status: "awaiting_responsible" | "approved" | "rejected";
  decision_inbound_message_id?: string | null;
  decision_external_message_id?: string | null;
};

type Decision = "approved" | "rejected";

export type QuoteApprovalDecisionResult = {
  outcome: "decided" | "replayed";
  status: Decision;
  requestId: string;
  quoteVersionId: string;
};

const APPROVED_WITHOUT_CONTEXT_PHRASES = new Set([
  "aprovo o orcamento",
  "aprovo este orcamento",
  "aprovado o orcamento",
  "aprovo a proposta",
  "aprovada a proposta",
  "autorizo o envio do orcamento",
  "autorizo o envio da proposta",
]);

const REJECTED_WITHOUT_CONTEXT_PHRASES = new Set([
  "rejeito o orcamento",
  "rejeito este orcamento",
  "rejeito a proposta",
  "nao aprovo o orcamento",
  "nao aprovo a proposta",
  "nao autorizo o envio do orcamento",
  "nao autorizo o envio da proposta",
]);

const APPROVED_WITH_CONTEXT_PHRASES = new Set([
  ...APPROVED_WITHOUT_CONTEXT_PHRASES,
  "aprovo",
  "aprovado",
  "aprovada",
  "aprovar",
  "autorizo",
  "autorizado",
  "autorizada",
]);

const REJECTED_WITH_CONTEXT_PHRASES = new Set([
  ...REJECTED_WITHOUT_CONTEXT_PHRASES,
  "rejeito",
  "rejeitado",
  "rejeitada",
  "rejeitar",
  "recuso",
  "nao aprovo",
  "nao autorizo",
]);

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDecisionText(value: unknown) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, " ")
    .trim();
}

function resolveDecision(value: unknown, hasContext: boolean): Decision | null {
  const normalized = normalizeDecisionText(value);
  if (
    (hasContext ? APPROVED_WITH_CONTEXT_PHRASES : APPROVED_WITHOUT_CONTEXT_PHRASES).has(
      normalized,
    )
  ) {
    return "approved";
  }
  if (
    (hasContext ? REJECTED_WITH_CONTEXT_PHRASES : REJECTED_WITHOUT_CONTEXT_PHRASES).has(
      normalized,
    )
  ) {
    return "rejected";
  }
  return null;
}

function oneRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) {
    return data.length === 1 ? ((data[0] || null) as T | null) : null;
  }
  return data && typeof data === "object" ? (data as T) : null;
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function assertNoQueryError(error: { message?: string | null } | null, code: string) {
  if (error) throw new Error(`${code}:${error.message || "unknown"}`);
}

export async function decideQuoteApprovalFromPersistedInbound(args: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  responsibleId: string;
  inboundMessageId: string;
  externalMessageId: string;
  content: string;
  contextMessageId?: string | null;
}): Promise<QuoteApprovalDecisionResult | null> {
  const contextMessageId = clean(args.contextMessageId);
  const decision = resolveDecision(args.content, Boolean(contextMessageId));
  if (!decision) return null;

  const pendingQuery = await args.supabase
    .from("p9_responsible_commercial_approval_requests")
    .select(
      "id, organization_id, store_id, responsible_id, commercial_opportunity_id, lifecycle_cycle, quote_id, quote_version_id, status, decision_inbound_message_id, decision_external_message_id",
    )
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("responsible_id", args.responsibleId)
    .eq("request_kind", "quote_send_approval")
    .in("status", ["awaiting_responsible", "approved", "rejected"]);
  assertNoQueryError(pendingQuery.error, "P9_QUOTE_DECISION_REQUEST_LOOKUP_FAILED");
  const requests = rows<ApprovalRequest>(pendingQuery.data);
  if (requests.length === 0) return null;

  const awaiting = requests.filter((request) => request.status === "awaiting_responsible");
  const replayCandidates = requests.filter(
    (request) =>
      (request.status === "approved" || request.status === "rejected") &&
      (clean(request.decision_inbound_message_id) === args.inboundMessageId ||
        clean(request.decision_external_message_id) === args.externalMessageId),
  );

  if (replayCandidates.length > 1) return null;
  if (replayCandidates.length === 1) {
    const request = replayCandidates[0];
    return await decideWithRequest({ args, decision, request });
  }

  let candidates = awaiting;
  if (contextMessageId) {
    const deliveryQuery = await args.supabase
      .from("p9_quote_approval_delivery_parts")
      .select("request_id")
      .in(
        "request_id",
        awaiting.map((request) => request.id),
      )
      .in("component", ["report", "pdf"])
      .eq("status", "accepted")
      .eq("external_message_id", contextMessageId);
    assertNoQueryError(deliveryQuery.error, "P9_QUOTE_DECISION_CONTEXT_LOOKUP_FAILED");
    const requestIds = new Set(
      rows<{ request_id: string }>(deliveryQuery.data).map((row) => clean(row.request_id)),
    );
    candidates = awaiting.filter((request) => requestIds.has(request.id));
  }

  // Ambiguous or absent correlation stays with the existing assistant flow.
  if (candidates.length !== 1) return null;
  const request = candidates[0];

  return decideWithRequest({ args, decision, request });
}

async function decideWithRequest(args: {
  args: {
    supabase: SupabaseClient;
    inboundMessageId: string;
    externalMessageId: string;
  };
  decision: Decision;
  request: ApprovalRequest;
}) {
  const rpcResult = await args.args.supabase.rpc(QUOTE_APPROVAL_DECISION_RPC, {
    p_request_id: args.request.id,
    p_organization_id: args.request.organization_id,
    p_store_id: args.request.store_id,
    p_responsible_id: args.request.responsible_id,
    p_commercial_opportunity_id: args.request.commercial_opportunity_id,
    p_expected_lifecycle_cycle: args.request.lifecycle_cycle,
    p_quote_id: args.request.quote_id,
    p_quote_version_id: args.request.quote_version_id,
    p_decision_inbound_message_id: args.args.inboundMessageId,
    p_decision_external_message_id: args.args.externalMessageId,
    p_decision: args.decision,
  });
  assertNoQueryError(rpcResult.error, "P9_QUOTE_DECISION_RPC_FAILED");

  const result = oneRow<{
    outcome?: unknown;
    status?: unknown;
    request_id?: unknown;
    quote_version_id?: unknown;
  }>(rpcResult.data);
  const outcome = clean(result?.outcome);
  const status = clean(result?.status);
  if (
    (outcome !== "decided" && outcome !== "replayed") ||
    status !== args.decision ||
    clean(result?.request_id) !== args.request.id ||
    clean(result?.quote_version_id) !== args.request.quote_version_id
  ) {
    throw new Error("P9_QUOTE_DECISION_RPC_RETURN_INVALID");
  }

  return {
    outcome: outcome as QuoteApprovalDecisionResult["outcome"],
    status: args.decision,
    requestId: args.request.id,
    quoteVersionId: args.request.quote_version_id,
  };
}
