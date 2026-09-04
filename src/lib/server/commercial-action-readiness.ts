import { randomUUID } from "node:crypto";

export const COMMERCIAL_ACTION_KEYS = [
  "send_quote",
  "schedule_technical_visit",
  "create_contract",
  "conclude_opportunity",
] as const;

export const COMMERCIAL_ACTION_READINESS_STATES = [
  "ready",
  "blocked",
  "needs_resolution",
  "conflict",
] as const;

export type CommercialActionKey = (typeof COMMERCIAL_ACTION_KEYS)[number];
export type CommercialActionReadinessState =
  (typeof COMMERCIAL_ACTION_READINESS_STATES)[number];

export type CommercialActionReadinessDecision = {
  actionKey: CommercialActionKey;
  readinessState: CommercialActionReadinessState;
  reasonCode: string | null;
  blockingItems: unknown[];
  readinessBasis: unknown;
  authorityFingerprint: string | null;
  resolverKey: string | null;
  resolverVersion: number | null;
};

export type RefreshCommercialActionReadinessResult =
  | { ok: true; decision: CommercialActionReadinessDecision }
  | {
      ok: false;
      error:
        | "INVALID_SCOPE"
        | "INVALID_ACTION_KEY"
        | "CHECKLIST_MATERIALIZATION_FAILED"
        | "CHECKLIST_MATERIALIZATION_INVALID"
        | "PROGRESS_MATERIALIZATION_FAILED"
        | "PROGRESS_MATERIALIZATION_INVALID"
        | "READINESS_READ_FAILED"
        | "READINESS_EMPTY"
        | "READINESS_INVALID";
      message: string;
    };

type SupabaseRpcLike = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string | null } | null }>;
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

export function isCommercialActionKey(value: string): value is CommercialActionKey {
  return COMMERCIAL_ACTION_KEYS.includes(value as CommercialActionKey);
}

function isReadinessState(value: string): value is CommercialActionReadinessState {
  return COMMERCIAL_ACTION_READINESS_STATES.includes(
    value as CommercialActionReadinessState,
  );
}

function readSingleRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    return data.length === 1 && data[0] && typeof data[0] === "object"
      ? (data[0] as Record<string, unknown>)
      : null;
  }

  return data && typeof data === "object"
    ? (data as Record<string, unknown>)
    : null;
}

function readSingleTableRow(data: unknown): Record<string, unknown> | null {
  return Array.isArray(data) &&
    data.length === 1 &&
    data[0] &&
    typeof data[0] === "object"
    ? (data[0] as Record<string, unknown>)
    : null;
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && cleanText(value).length > 0;
}

function hasBooleanValue(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isValidChecklistMaterialization(data: unknown): boolean {
  const row = readSingleTableRow(data);

  return Boolean(
    row &&
      isNonEmptyText(row.current_checklist_version_id) &&
      isNonEmptyText(row.outcome) &&
      hasBooleanValue(row.changed) &&
      hasBooleanValue(row.replayed) &&
      hasBooleanValue(row.preserved),
  );
}

function isValidProgressMaterialization(data: unknown): boolean {
  const row = readSingleTableRow(data);

  return Boolean(
    row &&
      isNonEmptyText(row.current_progress_version_id) &&
      isNonEmptyText(row.checklist_version_id) &&
      isNonEmptyText(row.outcome) &&
      hasBooleanValue(row.changed) &&
      hasBooleanValue(row.replayed),
  );
}

function normalizeBlockingItems(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeResolverVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function normalizeReadinessDecision(
  row: Record<string, unknown>,
  expectedActionKey: CommercialActionKey,
): CommercialActionReadinessDecision | null {
  const actionKey = cleanText(row.action_key);
  const readinessState = cleanText(row.readiness_state);

  if (actionKey !== expectedActionKey || !isReadinessState(readinessState)) {
    return null;
  }

  return {
    actionKey,
    readinessState,
    reasonCode: cleanText(row.reason_code) || null,
    blockingItems: normalizeBlockingItems(row.blocking_items),
    readinessBasis: row.readiness_basis ?? null,
    authorityFingerprint: cleanText(row.authority_fingerprint) || null,
    resolverKey: cleanText(row.resolver_key) || null,
    resolverVersion: normalizeResolverVersion(row.resolver_version),
  };
}

export async function refreshCommercialActionReadiness(args: {
  supabase: SupabaseRpcLike;
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  actionKey: string;
  eventKeyBase?: string;
}): Promise<RefreshCommercialActionReadinessResult> {
  const organizationId = cleanText(args.organizationId);
  const storeId = cleanText(args.storeId);
  const commercialOpportunityId = cleanText(args.commercialOpportunityId);
  const rawActionKey = cleanText(args.actionKey);

  if (!organizationId || !storeId || !commercialOpportunityId) {
    return {
      ok: false,
      error: "INVALID_SCOPE",
      message: "organizationId, storeId e commercialOpportunityId sao obrigatorios.",
    };
  }

  if (!isCommercialActionKey(rawActionKey)) {
    return {
      ok: false,
      error: "INVALID_ACTION_KEY",
      message: "actionKey invalida.",
    };
  }

  const eventKeyBase =
    cleanText(args.eventKeyBase) ||
    `commercial_action_readiness:${rawActionKey}:${randomUUID()}`;

  const basePayload = {
    p_organization_id: organizationId,
    p_store_id: storeId,
    p_commercial_opportunity_id: commercialOpportunityId,
  };

  let checklist: Awaited<ReturnType<SupabaseRpcLike["rpc"]>>;
  try {
    checklist = await args.supabase.rpc(
      "materialize_commercial_opportunity_checklist_by_system",
      {
        ...basePayload,
        p_materialization_event_key: `${eventKeyBase}:checklist`,
      },
    );
  } catch {
    return {
      ok: false,
      error: "CHECKLIST_MATERIALIZATION_FAILED",
      message: "Nao foi possivel atualizar o checklist comercial.",
    };
  }

  if (checklist.error) {
    return {
      ok: false,
      error: "CHECKLIST_MATERIALIZATION_FAILED",
      message: "Nao foi possivel atualizar o checklist comercial.",
    };
  }

  if (!isValidChecklistMaterialization(checklist.data)) {
    return {
      ok: false,
      error: "CHECKLIST_MATERIALIZATION_INVALID",
      message: "O checklist comercial retornou uma materializacao invalida.",
    };
  }

  let progress: Awaited<ReturnType<SupabaseRpcLike["rpc"]>>;
  try {
    progress = await args.supabase.rpc(
      "materialize_commercial_opportunity_checklist_progress_by_system",
      {
        ...basePayload,
        p_materialization_event_key: `${eventKeyBase}:progress`,
      },
    );
  } catch {
    return {
      ok: false,
      error: "PROGRESS_MATERIALIZATION_FAILED",
      message: "Nao foi possivel atualizar o progresso comercial.",
    };
  }

  if (progress.error) {
    return {
      ok: false,
      error: "PROGRESS_MATERIALIZATION_FAILED",
      message: "Nao foi possivel atualizar o progresso comercial.",
    };
  }

  if (!isValidProgressMaterialization(progress.data)) {
    return {
      ok: false,
      error: "PROGRESS_MATERIALIZATION_INVALID",
      message: "O progresso comercial retornou uma materializacao invalida.",
    };
  }

  let readiness: Awaited<ReturnType<SupabaseRpcLike["rpc"]>>;
  try {
    readiness = await args.supabase.rpc(
      "read_commercial_action_readiness_scoped",
      {
        p_organization_id: organizationId,
        p_store_id: storeId,
        p_commercial_opportunity_id: commercialOpportunityId,
        p_action_key: rawActionKey,
      },
    );
  } catch {
    return {
      ok: false,
      error: "READINESS_READ_FAILED",
      message: "Nao foi possivel ler a prontidao da acao comercial.",
    };
  }

  if (readiness.error) {
    return {
      ok: false,
      error: "READINESS_READ_FAILED",
      message: "Nao foi possivel ler a prontidao da acao comercial.",
    };
  }

  const row = readSingleRow(readiness.data);
  if (!row) {
    return {
      ok: false,
      error: "READINESS_EMPTY",
      message: "A prontidao da acao comercial nao retornou uma decisao.",
    };
  }

  const decision = normalizeReadinessDecision(row, rawActionKey);
  if (!decision) {
    return {
      ok: false,
      error: "READINESS_INVALID",
      message: "A prontidao da acao comercial retornou uma decisao invalida.",
    };
  }

  return {
    ok: true,
    decision,
  };
}

export function mapCommercialActionReadinessFailure(
  result: RefreshCommercialActionReadinessResult,
): {
  error: string;
  status: number;
} {
  if (!result.ok) {
    return {
      error: "COMMERCIAL_ACTION_READINESS_UNAVAILABLE",
      status: 503,
    };
  }

  switch (result.decision.readinessState) {
    case "ready":
      return { error: "", status: 200 };
    case "blocked":
      return { error: "COMMERCIAL_ACTION_BLOCKED", status: 409 };
    case "needs_resolution":
      return { error: "COMMERCIAL_ACTION_NEEDS_RESOLUTION", status: 409 };
    case "conflict":
      return { error: "COMMERCIAL_ACTION_CONFLICT", status: 409 };
  }
}
