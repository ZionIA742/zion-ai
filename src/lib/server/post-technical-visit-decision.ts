export const POST_TECHNICAL_VISIT_DECISION_KINDS = [
  "qualification",
  "quote",
  "negotiation",
  "followup",
  "loss",
  "new_visit",
  "needs_resolution",
  "none",
] as const;

export type PostTechnicalVisitDecisionKind =
  (typeof POST_TECHNICAL_VISIT_DECISION_KINDS)[number];

export type PostTechnicalVisitDecision = {
  decisionId: string;
  organizationId: string;
  storeId: string;
  appointmentId: string;
  commercialOpportunityId: string;
  lifecycleCycle: number;
  resultEventId: string;
  decisionKind: PostTechnicalVisitDecisionKind;
  decisionReason: string;
  decisionBasis: Record<string, unknown>;
  replayed: boolean;
};

type SupabaseRpcLike = {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string | null } | null }>;
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function readSingleRow(data: unknown): Record<string, unknown> | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row = data[0];
  return row && typeof row === "object" && !Array.isArray(row)
    ? (row as Record<string, unknown>)
    : null;
}

function isDecisionKind(value: string): value is PostTechnicalVisitDecisionKind {
  return POST_TECHNICAL_VISIT_DECISION_KINDS.includes(
    value as PostTechnicalVisitDecisionKind,
  );
}

function readDecision(row: Record<string, unknown>): PostTechnicalVisitDecision | null {
  const decisionId = cleanText(row.decision_id);
  const organizationId = cleanText(row.organization_id);
  const storeId = cleanText(row.store_id);
  const appointmentId = cleanText(row.appointment_id);
  const commercialOpportunityId = cleanText(row.commercial_opportunity_id);
  const resultEventId = cleanText(row.result_event_id);
  const decisionKind = cleanText(row.decision_kind);
  const lifecycleCycle = row.lifecycle_cycle;
  const decisionReason = cleanText(row.decision_reason);
  const decisionBasis = row.decision_basis;

  if (
    !decisionId ||
    !organizationId ||
    !storeId ||
    !appointmentId ||
    !commercialOpportunityId ||
    !resultEventId ||
    !isDecisionKind(decisionKind) ||
    typeof lifecycleCycle !== "number" ||
    !Number.isInteger(lifecycleCycle) ||
    lifecycleCycle < 1 ||
    !decisionReason ||
    !decisionBasis ||
    typeof decisionBasis !== "object" ||
    Array.isArray(decisionBasis) ||
    typeof row.replayed !== "boolean"
  ) {
    return null;
  }

  return {
    decisionId,
    organizationId,
    storeId,
    appointmentId,
    commercialOpportunityId,
    lifecycleCycle,
    resultEventId,
    decisionKind,
    decisionReason,
    decisionBasis: decisionBasis as Record<string, unknown>,
    replayed: row.replayed,
  };
}

export type DecidePostTechnicalVisitResult =
  | { ok: true; decision: PostTechnicalVisitDecision }
  | {
      ok: false;
      error:
        | "INVALID_INPUT"
        | "RPC_FAILED"
        | "INVALID_RESPONSE";
      message: string;
    };

export async function decidePostTechnicalVisitBySystem(args: {
  supabase: SupabaseRpcLike;
  resultEventId: string;
  operationKey: string;
  metadata?: Record<string, unknown>;
}): Promise<DecidePostTechnicalVisitResult> {
  const resultEventId = cleanText(args.resultEventId);
  const operationKey = cleanText(args.operationKey);

  if (!resultEventId || !operationKey || operationKey.length > 512) {
    return {
      ok: false,
      error: "INVALID_INPUT",
      message: "resultEventId e operationKey sao obrigatorios.",
    };
  }

  let response: { data: unknown; error: { message?: string | null } | null };
  try {
    response = await args.supabase.rpc("decide_post_technical_visit_by_system", {
      p_result_event_id: resultEventId,
      p_operation_key: operationKey,
      p_metadata: args.metadata || {},
    });
  } catch {
    return {
      ok: false,
      error: "RPC_FAILED",
      message: "Nao foi possivel persistir a decisao pos-visita.",
    };
  }

  if (response.error) {
    return {
      ok: false,
      error: "RPC_FAILED",
      message: "Nao foi possivel persistir a decisao pos-visita.",
    };
  }

  const row = readSingleRow(response.data);
  const decision = row ? readDecision(row) : null;
  if (!decision) {
    return {
      ok: false,
      error: "INVALID_RESPONSE",
      message: "A authority pos-visita retornou uma decisao invalida.",
    };
  }

  return { ok: true, decision };
}
