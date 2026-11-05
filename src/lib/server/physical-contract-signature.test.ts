import { strict as assert } from "node:assert";
import test from "node:test";
import { buildAutomaticMorningReport } from "./assistant/automatic-reports";
import {
  detectPhysicalSignaturePreference,
  confirmPhysicalContractSignatureByHuman,
  cancelPhysicalContractSignatureByHuman,
  recordDetectedPhysicalSignaturePreference,
} from "./physical-contract-signature";

test("detects explicit physical preference without inventing schedule", () => {
  assert.deepEqual(detectPhysicalSignaturePreference({ message: "Vou assinar o contrato de papel no dia da instalação." }), {
    preference: "physical", plannedDate: null, plannedTime: null,
  });
});

test("keeps only valid supplied date and time", () => {
  assert.deepEqual(detectPhysicalSignaturePreference({ message: "Prefiro assinatura física", plannedDate: "2026-11-23", plannedTime: "10:00" }), {
    preference: "physical", plannedDate: "2026-11-23", plannedTime: "10:00",
  });
  assert.deepEqual(detectPhysicalSignaturePreference({ message: "Prefiro assinatura física", plannedDate: "2026-02-31", plannedTime: "25:00" }), {
    preference: "physical", plannedDate: null, plannedTime: null,
  });
});

test("does not turn ambiguous contract language into physical preference", () => {
  assert.equal(detectPhysicalSignaturePreference({ message: "Pode mandar o contrato?" }), null);
});

test("recognizes natural installation-day physical-signature declarations", () => {
  assert.equal(detectPhysicalSignaturePreference({ message: "Vou assinar no dia da instalacao." })?.preference, "physical");
  assert.equal(detectPhysicalSignaturePreference({ message: "O contrato impresso eu assino quando voces vierem." })?.preference, "physical");
  assert.equal(detectPhysicalSignaturePreference({ message: "Vi o papel da proposta." }), null);
});

function scopedClient(options: { contracts?: Record<string, unknown>[]; versions?: Record<string, unknown>[]; policyError?: boolean } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const query = (table: string) => {
    let data = table === "sales_contracts" ? options.contracts || [] : options.versions || [];
    const chain = {
      select(columns: string) { void columns; return chain; },
      eq(column: string, value: unknown) { data = data.filter((row) => row[column] === value); return chain; },
      limit(value: number) { void value; return Promise.resolve({ data, error: null }); },
    };
    return chain;
  };
  return {
    calls,
    client: {
      from(table: string) { return query(table); },
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        if (name === "read_store_settings_experience_policies_scoped" && options.policyError) return { data: null, error: { message: "policy unavailable" } };
        if (name === "read_store_settings_experience_policies_scoped") return { data: [{ contract_usage_policy: { enabled: "sim", formats: ["fisico"] } }], error: null };
        if (name === "confirm_physical_contract_signature_by_user") return { data: [{ outcome: "confirmed", preference_id: "preference-1" }], error: null };
        if (name === "cancel_physical_contract_signature_by_user") return { data: [{ outcome: "cancelled", preference_id: "preference-1" }], error: null };
        return { data: [{ outcome: "recorded", preference_id: "preference-1", notification_id: "notification-1" }], error: null };
      },
    },
  };
}

test("records the scoped current contract and enqueues the assistant authority", async () => {
  const h = scopedClient({
    contracts: [{ id: "contract-1", commercial_opportunity_id: "opportunity-1", current_version_id: "version-1", conversation_id: "conversation-1", organization_id: "org-1", store_id: "store-1" }],
    versions: [{ id: "version-1", contract_id: "contract-1", organization_id: "org-1", store_id: "store-1" }],
  });
  const result = await recordDetectedPhysicalSignaturePreference({
    supabase: h.client,
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conversation-1",
    leadId: "lead-1",
    sourceMessageId: "message-1",
    message: "Prefiro assinar o contrato físico.",
  });
  assert.equal(result.outcome, "recorded");
  assert.equal(h.calls[0]?.name, "read_store_settings_experience_policies_scoped");
  assert.equal(h.calls[1]?.name, "record_physical_contract_signature_preference_by_system");
  assert.equal(h.calls[1]?.args.p_sales_contract_version_id, "version-1");
});

test("ambiguous contract and unavailable policy fail closed without recording", async () => {
  const ambiguous = scopedClient({ contracts: [{ id: "c1" }, { id: "c2" }] });
  const first = await recordDetectedPhysicalSignaturePreference({
    supabase: ambiguous.client,
    organizationId: "org-1", storeId: "store-1", conversationId: "conversation-1", leadId: null,
    sourceMessageId: "message-1", message: "Vou assinar o de papel.",
  });
  assert.equal(first.outcome, "ambiguous_contract");
  assert.equal(ambiguous.calls.length, 0);

  const unavailable = scopedClient({ contracts: [{ id: "c1", current_version_id: "v1", conversation_id: "conversation-1", organization_id: "org-1", store_id: "store-1" }], versions: [{ id: "v1", contract_id: "c1", organization_id: "org-1", store_id: "store-1" }], policyError: true });
  const second = await recordDetectedPhysicalSignaturePreference({
    supabase: unavailable.client,
    organizationId: "org-1", storeId: "store-1", conversationId: "conversation-1", leadId: null,
    sourceMessageId: "message-1", message: "Vou assinar o de papel.",
  });
  assert.equal(second.outcome, "policy_unavailable");
  assert.equal(unavailable.calls.some((call) => call.name === "record_physical_contract_signature_preference_by_system"), false);
});

test("the existing morning report exposes the physical-signature pending item", () => {
  const body = buildAutomaticMorningReport({
    appointmentCount: 1, openAppointmentCount: 1, completedAppointmentCount: 0,
    cancelledAppointmentCount: 0, overdueAppointmentCount: 0,
    pendingNotificationCount: 1, pendingTaskCount: 0,
    reportLocalDate: "2026-11-23", reportTimezone: "America/Sao_Paulo",
    appointments: [{ id: "appointment-1", title: "Instalação", appointment_type: "installation", status: "scheduled", scheduled_start: "2026-11-23T13:00:00Z", scheduled_end: "2026-11-23T14:00:00Z", customer_name: "Regina", customer_phone: null, address_text: null, created_at: "2026-11-22T12:00:00Z" }],
    pendingItems: [{ id: "notification-1", title: "Assinatura física pendente", body: "Levar o contrato para assinatura.", related_appointment_id: "appointment-1", related_lead_id: null, created_at: "2026-11-22T12:00:00Z", kind: "notification", priority: "high", notification_type: "important_alert", context: { reason: "physical_contract_signature_pending", event_key: "physical-1" } }],
  });
  assert.match(body, /Assinatura física pendente|Levar o contrato .*assinatura/);
});

test("human confirmation uses the physical authority and preserves actor identity", async () => {
  const h = scopedClient();
  const result = await confirmPhysicalContractSignatureByHuman({
    supabase: h.client,
    organizationId: "org-1", storeId: "store-1", preferenceId: "preference-1",
    contractId: "contract-1", versionId: "version-1", actorUserId: "user-1", confirmation: "sim",
  });
  assert.deepEqual(result, { outcome: "confirmed", preferenceId: "preference-1" });
  assert.equal(h.calls[0]?.args.p_actor_user_id, "user-1");
});

test("human cancellation uses the physical authority and records a reason", async () => {
  const h = scopedClient();
  const result = await cancelPhysicalContractSignatureByHuman({
    supabase: h.client,
    organizationId: "org-1", storeId: "store-1", preferenceId: "preference-1",
    contractId: "contract-1", versionId: "version-1", actorUserId: "user-1", reason: "cliente remarcou sem nova data",
  });
  assert.deepEqual(result, { outcome: "cancelled", preferenceId: "preference-1" });
  assert.equal(h.calls[0]?.name, "cancel_physical_contract_signature_by_user");
  assert.equal(h.calls[0]?.args.p_reason, "cliente remarcou sem nova data");
});
