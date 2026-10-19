export type WorkerClaimRow = {
  id: string;
  organization_id: string;
  store_id: string;
  claim_token: string;
  claim_expires_at: string;
  attempt_count: number;
  [key: string]: unknown;
};

export type WorkerClaimRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

export const WHATSAPP_INBOX_CLAIM_RPC = "claim_whatsapp_inbox_events_by_system";
export const WHATSAPP_INBOX_FINALIZE_RPC = "finalize_whatsapp_inbox_event_by_system";
export const AI_RUN_QUEUE_CLAIM_RPC = "claim_ai_run_queue_tasks_by_system";
export const AI_RUN_QUEUE_FINALIZE_RPC = "finalize_ai_run_queue_task_by_system";
export const WHATSAPP_INBOX_ASSERT_RPC = "assert_whatsapp_inbox_event_claim_by_system";
export const AI_RUN_QUEUE_ASSERT_RPC = "assert_ai_run_queue_task_claim_by_system";

export const WORKER_MAX_ATTEMPTS = 3;
export const WORKER_LEASE_SECONDS = 120;

function asRows(data: unknown, operation: string): Record<string, unknown>[] {
  if (!Array.isArray(data)) {
    throw new Error(`${operation} retornou contrato nao-array.`);
  }

  return data.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${operation} retornou linha invalida.`);
    }
    return item as Record<string, unknown>;
  });
}

function requiredText(row: Record<string, unknown>, key: string) {
  const value = String(row[key] || "").trim();
  if (!value) throw new Error(`Claim RPC retornou ${key} ausente.`);
  return value;
}

export function normalizeWorkerClaimRows(
  data: unknown,
  operation = "Claim RPC",
  requiredFields: string[] = [],
): WorkerClaimRow[] {
  return asRows(data, operation).map((row) => {
    for (const field of requiredFields) {
      if (!Object.prototype.hasOwnProperty.call(row, field)) {
        throw new Error(`${operation} retornou ${field} ausente.`);
      }
    }

    const claimExpiresAt = requiredText(row, "claim_expires_at");
    const claimExpiresAtMs = Date.parse(claimExpiresAt);
    if (!Number.isFinite(claimExpiresAtMs) || claimExpiresAtMs <= Date.now()) {
      throw new Error(`${operation} retornou claim expirado ou invalido.`);
    }

    const attemptCount = Number(row.attempt_count);
    if (!Number.isInteger(attemptCount) || attemptCount < 1 || attemptCount > WORKER_MAX_ATTEMPTS) {
      throw new Error(`${operation} retornou attempt_count invalido.`);
    }

    return {
    ...row,
    id: requiredText(row, "id"),
    organization_id: requiredText(row, "organization_id"),
    store_id: requiredText(row, "store_id"),
    claim_token: requiredText(row, "claim_token"),
    claim_expires_at: claimExpiresAt,
    attempt_count: attemptCount,
    };
  });
}

async function callClaimRpc(
  client: WorkerClaimRpcClient,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name} falhou: ${error.message || "erro desconhecido"}`);
  return normalizeWorkerClaimRows(data, name, requiredFieldsForClaimRpc(name));
}

function requiredFieldsForClaimRpc(name: string) {
  if (name === WHATSAPP_INBOX_CLAIM_RPC) {
    return ["provider", "external_event_id", "payload", "received_at", "processed_at", "processing_error"];
  }
  return ["conversation_id", "lead_id", "queue_key", "input"];
}

export function claimWhatsappInboxEventsBySystem(
  client: WorkerClaimRpcClient,
  args: { organizationId: string; storeId: string; limit: number; claimedBy: string; leaseSeconds?: number },
) {
  return callClaimRpc(client, WHATSAPP_INBOX_CLAIM_RPC, {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    p_limit: args.limit,
    p_claimed_by: args.claimedBy,
    p_lease_seconds: args.leaseSeconds ?? WORKER_LEASE_SECONDS,
    p_max_attempts: WORKER_MAX_ATTEMPTS,
  });
}

export function claimAiRunQueueTasksBySystem(
  client: WorkerClaimRpcClient,
  args: { organizationId: string; storeId: string; limit: number; claimedBy: string; leaseSeconds?: number },
) {
  return callClaimRpc(client, AI_RUN_QUEUE_CLAIM_RPC, {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    p_limit: args.limit,
    p_claimed_by: args.claimedBy,
    p_lease_seconds: args.leaseSeconds ?? WORKER_LEASE_SECONDS,
    p_max_attempts: WORKER_MAX_ATTEMPTS,
  });
}

export async function finalizeWorkerTaskBySystem(
  client: WorkerClaimRpcClient,
  args: {
    kind: "inbox" | "ai_run_queue";
    organizationId: string;
    storeId: string;
    id: string;
    claimToken: string;
    outcome: "processed" | "retryable" | "failed_final";
    errorText?: string | null;
  },
) {
  const rpc = args.kind === "inbox" ? WHATSAPP_INBOX_FINALIZE_RPC : AI_RUN_QUEUE_FINALIZE_RPC;
  const { data, error } = await client.rpc(rpc, {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    [args.kind === "inbox" ? "p_inbox_id" : "p_queue_id"]: args.id,
    p_claim_token: args.claimToken,
    p_outcome: args.outcome,
    p_error_text: args.errorText || null,
    p_max_attempts: WORKER_MAX_ATTEMPTS,
  });
  if (error) throw new Error(`${rpc} falhou: ${error.message || "erro desconhecido"}`);
  const rows = Array.isArray(data) ? data : [data];
  const row = rows[0];
  if (!row || typeof row !== "object" || Array.isArray(row) || (row as Record<string, unknown>).ok !== true) {
    throw new Error(`${rpc} recusou a finalizacao para ${args.id}.`);
  }
  const result = row as Record<string, unknown>;
  if (String(result.id || "") !== args.id || String(result.claim_token || "") !== args.claimToken) {
    throw new Error(`${rpc} confirmou registro ou token divergente para ${args.id}.`);
  }
  if (String(result.outcome || "") !== args.outcome) {
    throw new Error(`${rpc} confirmou outcome divergente para ${args.id}.`);
  }
}

export async function assertWorkerClaimActiveBySystem(
  client: WorkerClaimRpcClient,
  args: {
    kind: "inbox" | "ai_run_queue";
    organizationId: string;
    storeId: string;
    id: string;
    claimToken: string;
  },
) {
  const rpc = args.kind === "inbox" ? WHATSAPP_INBOX_ASSERT_RPC : AI_RUN_QUEUE_ASSERT_RPC;
  const { data, error } = await client.rpc(rpc, {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    [args.kind === "inbox" ? "p_inbox_id" : "p_queue_id"]: args.id,
    p_claim_token: args.claimToken,
  });
  if (error) throw new Error(`${rpc} falhou: ${error.message || "erro desconhecido"}`);
  const rows = Array.isArray(data) ? data : [data];
  const row = rows[0];
  if (!row || typeof row !== "object" || Array.isArray(row) || (row as Record<string, unknown>).ok !== true) {
    throw new Error(`${rpc} recusou claim ativo para ${args.id}.`);
  }
  const result = row as Record<string, unknown>;
  if (String(result.id || "") !== args.id || String(result.claim_token || "") !== args.claimToken) {
    throw new Error(`${rpc} confirmou registro ou token divergente para ${args.id}.`);
  }
  const expiresAt = Date.parse(String(result.claim_expires_at || ""));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error(`${rpc} retornou claim expirado para ${args.id}.`);
  }
}
