import type { SupabaseClient } from "@supabase/supabase-js";

export type HumanResponseCommitmentSourceKind = "panel" | "whatsapp_human";

export type RecordHumanResponseCommitmentInput = {
  organizationId: string;
  storeId: string;
  conversationId: string;
  conversationSessionId?: string | null;
  sourceMessageId: string;
  responsibleUserId: string;
  dueAt: string;
  operationKey: string;
  sourceKind: HumanResponseCommitmentSourceKind;
  explicitConfirmation: boolean;
};

export function validateExplicitHumanResponseCommitment(input: RecordHumanResponseCommitmentInput) {
  if (input.explicitConfirmation !== true) {
    throw new Error("human_response_commitment_explicit_confirmation_required");
  }
  if (!input.organizationId || !input.storeId || !input.conversationId || !input.sourceMessageId) {
    throw new Error("human_response_commitment_scope_required");
  }
  if (!input.responsibleUserId || !input.operationKey || !input.sourceKind) {
    throw new Error("human_response_commitment_identity_required");
  }
  const dueAt = Date.parse(input.dueAt);
  if (!Number.isFinite(dueAt) || dueAt <= Date.now()) {
    throw new Error("human_response_commitment_due_at_must_be_future");
  }
  return input;
}

export async function recordHumanResponseCommitmentBySystem(
  supabase: SupabaseClient,
  input: RecordHumanResponseCommitmentInput,
) {
  const validated = validateExplicitHumanResponseCommitment(input);
  const { data, error } = await supabase.rpc("record_human_response_commitment_by_system", {
    p_organization_id: validated.organizationId,
    p_store_id: validated.storeId,
    p_conversation_id: validated.conversationId,
    p_conversation_session_id: validated.conversationSessionId ?? null,
    p_source_message_id: validated.sourceMessageId,
    p_responsible_user_id: validated.responsibleUserId,
    p_due_at: validated.dueAt,
    p_operation_key: validated.operationKey,
    p_source_kind: validated.sourceKind,
    p_explicit_confirmation: true,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function readHumanResponseCommitmentsBySystem(
  supabase: SupabaseClient,
  scope: Pick<RecordHumanResponseCommitmentInput, "organizationId" | "storeId"> & { conversationId?: string | null },
) {
  const { data, error } = await supabase.rpc("read_human_response_commitments_by_system", {
    p_organization_id: scope.organizationId,
    p_store_id: scope.storeId,
    p_conversation_id: scope.conversationId ?? null,
  });
  if (error) throw error;
  return data ?? [];
}

export async function transitionHumanResponseCommitmentBySystem(
  supabase: SupabaseClient,
  input: { commitmentId: string; organizationId: string; storeId: string; status: "active" | "fulfilled" | "cancelled" | "expired"; operationKey: string; dueAt?: string | null },
) {
  if (!input.commitmentId || !input.organizationId || !input.storeId || !input.operationKey) {
    throw new Error("human_response_commitment_transition_identity_required");
  }
  if (input.status === "active" && (!input.dueAt || !Number.isFinite(Date.parse(input.dueAt)) || Date.parse(input.dueAt) <= Date.now())) {
    throw new Error("human_response_commitment_amendment_due_at_invalid");
  }
  const { data, error } = await supabase.rpc("transition_human_response_commitment_by_system", {
    p_commitment_id: input.commitmentId,
    p_organization_id: input.organizationId,
    p_store_id: input.storeId,
    p_status: input.status,
    p_operation_key: input.operationKey,
    p_due_at: input.dueAt ?? null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
