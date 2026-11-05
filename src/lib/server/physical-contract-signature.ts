export type PhysicalSignaturePreference = {
  preference: "physical";
  plannedDate: string | null;
  plannedTime: string | null;
};

type PhysicalSignatureQuery = {
  select(columns: string): PhysicalSignatureQuery;
  eq(column: string, value: unknown): PhysicalSignatureQuery;
  limit(value: number): PhysicalSignatureQuery;
  then<TResult1 = { data?: unknown; error?: { message?: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data?: unknown; error?: { message?: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
};

export type PhysicalSignatureSupabase = {
  from(table: string): PhysicalSignatureQuery;
  rpc(name: string, args: Record<string, unknown>): Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

export type PhysicalSignatureHandlingResult =
  | { outcome: "not_detected" | "ambiguous_contract" | "policy_unavailable" | "record_failed"; preference: null; reason?: string }
  | { outcome: "recorded" | "replayed"; preference: Record<string, unknown> | null; contractId: string; versionId: string; policyState: string };

export type PhysicalSignatureConfirmationResult = {
  outcome: "confirmed" | "still_pending" | "replayed" | "cancelled";
  preferenceId: string | null;
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function validDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.toISOString().slice(0, 10) === value;
}

function validTime(value: string | null) {
  return Boolean(value && /^\d{2}:\d{2}$/.test(value) && Number(value.slice(0, 2)) < 24 && Number(value.slice(3)) < 60);
}

/** Fail-closed detector for an explicit customer choice; never infers a date. */
export function detectPhysicalSignaturePreference(input: {
  message: string | null | undefined;
  plannedDate?: string | null;
  plannedTime?: string | null;
}): PhysicalSignaturePreference | null {
  const text = normalize(String(input.message || ""));
  const explicitPhysical = /(fisic|papel|impresso)/.test(text) && /assin/.test(text);
  const explicitInstallationTiming = /assin.*(dia da instalacao|quando .*vierem|quando .*instalarem)/.test(text);
  if (!text || (!explicitPhysical && !explicitInstallationTiming)) return null;
  return {
    preference: "physical",
    plannedDate: validDate(input.plannedDate || null) ? input.plannedDate || null : null,
    plannedTime: validTime(input.plannedTime || null) ? input.plannedTime || null : null,
  };
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

async function readRows(client: PhysicalSignatureSupabase, table: string, columns: string, filters: Array<[string, unknown]>) {
  let query = client.from(table).select(columns);
  for (const [column, value] of filters) query = query.eq(column, value);
  const result = await query.limit(2);
  if (result.error) throw new Error(result.error.message || "PHYSICAL_SIGNATURE_QUERY_FAILED");
  return Array.isArray(result.data) ? result.data as Array<Record<string, unknown>> : [];
}

/** Connects an unequivocal customer signal to the prepared, scoped SQL authority. */
export async function recordDetectedPhysicalSignaturePreference(args: {
  supabase: PhysicalSignatureSupabase;
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string | null;
  sourceMessageId: string;
  message: string;
  plannedDate?: string | null;
  plannedTime?: string | null;
}): Promise<PhysicalSignatureHandlingResult> {
  const detected = detectPhysicalSignaturePreference({ message: args.message, plannedDate: args.plannedDate, plannedTime: args.plannedTime });
  if (!detected) return { outcome: "not_detected", preference: null };

  const byConversation = await readRows(args.supabase, "sales_contracts", "id, commercial_opportunity_id, lead_id, conversation_id, current_version_id, status", [
    ["organization_id", args.organizationId], ["store_id", args.storeId], ["conversation_id", args.conversationId],
  ]);
  const contracts = byConversation.length ? byConversation : args.leadId
    ? await readRows(args.supabase, "sales_contracts", "id, commercial_opportunity_id, lead_id, conversation_id, current_version_id, status", [
      ["organization_id", args.organizationId], ["store_id", args.storeId], ["lead_id", args.leadId],
    ])
    : [];
  if (contracts.length !== 1) return { outcome: "ambiguous_contract", preference: null, reason: contracts.length ? "multiple_contracts" : "no_scoped_contract" };
  const contract = contracts[0];
  const contractId = clean(contract.id);
  const versionId = clean(contract.current_version_id);
  if (!contractId || !versionId) return { outcome: "ambiguous_contract", preference: null, reason: "missing_current_version" };
  const versions = await readRows(args.supabase, "sales_contract_versions", "id, contract_id, organization_id, store_id, status", [
    ["id", versionId], ["contract_id", contractId], ["organization_id", args.organizationId], ["store_id", args.storeId],
  ]);
  if (versions.length !== 1) return { outcome: "ambiguous_contract", preference: null, reason: "current_version_not_scoped" };

  const policy = await args.supabase.rpc("read_store_settings_experience_policies_scoped", {
    p_organization_id: args.organizationId, p_store_id: args.storeId,
  });
  if (policy.error) return { outcome: "policy_unavailable", preference: null, reason: policy.error.message || "policy_unavailable" };
  const policyRow = Array.isArray(policy.data) ? policy.data[0] : policy.data;
  const policyValue = policyRow && typeof policyRow === "object" && !Array.isArray(policyRow)
    ? (policyRow as Record<string, unknown>).contract_usage_policy
    : null;
  const policyState = policyValue && typeof policyValue === "object" ? "configured" : "unconfigured";
  const operationKey = `p9-physical-signature:${args.organizationId}:${args.storeId}:${contractId}:${versionId}:${args.sourceMessageId}`;
  const recorded = await args.supabase.rpc("record_physical_contract_signature_preference_by_system", {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    p_commercial_opportunity_id: contract.commercial_opportunity_id ?? null,
    p_sales_contract_id: contractId,
    p_sales_contract_version_id: versionId,
    p_source_message_id: args.sourceMessageId,
    p_planned_date: detected.plannedDate,
    p_planned_time: detected.plannedTime,
    p_operation_key: operationKey,
  });
  if (recorded.error) return { outcome: "record_failed", preference: null, reason: recorded.error.message || "record_failed" };
  const row = Array.isArray(recorded.data) ? recorded.data[0] : recorded.data;
  const rowRecord = row && typeof row === "object" && !Array.isArray(row) ? row as Record<string, unknown> : null;
  return { outcome: rowRecord?.outcome === "replayed" ? "replayed" : "recorded", preference: rowRecord, contractId, versionId, policyState };
}

/** Minimal post-installation adapter; the caller must supply a human actor identity. */
export async function confirmPhysicalContractSignatureByHuman(args: {
  supabase: PhysicalSignatureSupabase;
  organizationId: string;
  storeId: string;
  preferenceId: string;
  contractId: string;
  versionId: string;
  actorUserId: string;
  confirmation: "sim" | "nao";
}): Promise<PhysicalSignatureConfirmationResult> {
  const result = await args.supabase.rpc("confirm_physical_contract_signature_by_user", {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    p_preference_id: args.preferenceId,
    p_sales_contract_id: args.contractId,
    p_sales_contract_version_id: args.versionId,
    p_actor_user_id: args.actorUserId,
    p_confirmation: args.confirmation,
  });
  if (result.error) throw new Error(result.error.message || "PHYSICAL_SIGNATURE_CONFIRMATION_FAILED");
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  const value = row && typeof row === "object" && !Array.isArray(row) ? row as Record<string, unknown> : {};
  const outcome = value.outcome;
  if (outcome !== "confirmed" && outcome !== "still_pending" && outcome !== "replayed") {
    throw new Error("PHYSICAL_SIGNATURE_CONFIRMATION_RESPONSE_INVALID");
  }
  return { outcome, preferenceId: typeof value.preference_id === "string" ? value.preference_id : null };
}

export async function cancelPhysicalContractSignatureByHuman(args: {
  supabase: PhysicalSignatureSupabase;
  organizationId: string;
  storeId: string;
  preferenceId: string;
  contractId: string;
  versionId: string;
  actorUserId: string;
  reason: string;
}): Promise<PhysicalSignatureConfirmationResult> {
  const result = await args.supabase.rpc("cancel_physical_contract_signature_by_user", {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    p_preference_id: args.preferenceId,
    p_sales_contract_id: args.contractId,
    p_sales_contract_version_id: args.versionId,
    p_actor_user_id: args.actorUserId,
    p_reason: args.reason,
  });
  if (result.error) throw new Error(result.error.message || "PHYSICAL_SIGNATURE_CANCELLATION_FAILED");
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  const value = row && typeof row === "object" && !Array.isArray(row) ? row as Record<string, unknown> : {};
  const outcome = value.outcome;
  if (outcome !== "confirmed" && outcome !== "still_pending" && outcome !== "replayed" && outcome !== "cancelled") {
    throw new Error("PHYSICAL_SIGNATURE_CANCELLATION_RESPONSE_INVALID");
  }
  return { outcome, preferenceId: typeof value.preference_id === "string" ? value.preference_id : null };
}
