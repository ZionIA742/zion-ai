import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentProofDecision } from "@/lib/server/payment-proof-confirmation";

const SOURCE = "customer_payment_proof_v1";
function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function normalize(value: unknown) { return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[\s\p{P}]+/gu, " ").trim(); }

export function resolvePaymentProofDecision(value: unknown): PaymentProofDecision | null {
  const normalized = normalize(value);
  return normalized === "sim" ? "yes" : normalized === "nao" ? "no" : null;
}

export type PaymentProofDecisionHandled = {
  kind: "payment_proof_decision";
  responseText: string;
  result: {
    decision: PaymentProofDecision;
    notificationId: string;
    sourceMessageId: string;
    financialStatus: "not_applicable" | "pending_human_regularization";
  };
};

export async function tryHandlePaymentProofDecision(args: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  responsibleId: string;
  decisionMessageId: string;
  externalMessageId: string;
  content: string;
  contextMessageId?: string | null;
}) {
  const decision = resolvePaymentProofDecision(args.content);
  if (!decision || !clean(args.contextMessageId)) return null;
  const { data: outbound, error: outboundError } = await args.supabase
    .from("store_responsible_external_notifications")
    .select("internal_notification_id, context")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("responsible_id", args.responsibleId)
    .eq("external_message_id", args.contextMessageId)
    .limit(2);
  if (outboundError) throw new Error(`PAYMENT_PROOF_DECISION_CORRELATION_FAILED:${outboundError.message}`);
  const rows = (outbound || []).filter((row: { context?: unknown }) => {
    const context = row.context && typeof row.context === "object" ? row.context as Record<string, unknown> : {};
    return clean(context.source) === SOURCE;
  });
  if (rows.length !== 1) return null;
  const context = rows[0].context as Record<string, unknown>;
  const notificationId = clean(rows[0].internal_notification_id);
  const sourceMessageId = clean(context.source_message_id);
  const relatedConversationId = clean(context.related_conversation_id);
  if (!notificationId || !sourceMessageId || !relatedConversationId) return null;
  const eventKey = `customer_payment_proof_decision:${notificationId}`;
  const eventPayload = {
    schema: "customer_payment_proof_decision_v1",
    source: SOURCE,
    decision,
    notification_id: notificationId,
    source_message_id: sourceMessageId,
    decision_message_id: args.decisionMessageId,
    decision_external_message_id: args.externalMessageId,
    responsible_id: args.responsibleId,
    commercial_opportunity_id: clean(context.commercial_opportunity_id) || null,
  };
  const { data: existingEvent, error: existingEventError } = await args.supabase
    .from("store_business_events")
    .select("event_payload")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("event_key", eventKey)
    .maybeSingle();
  if (existingEventError) {
    throw new Error(`PAYMENT_PROOF_DECISION_CORRELATION_FAILED:${existingEventError.message}`);
  }
  const existingPayload = existingEvent?.event_payload && typeof existingEvent.event_payload === "object"
    ? existingEvent.event_payload as Record<string, unknown>
    : null;
  if (existingPayload) {
    const persistedDecision = existingPayload.decision === "yes" || existingPayload.decision === "no"
      ? existingPayload.decision as PaymentProofDecision
      : null;
    if (persistedDecision && persistedDecision !== decision) {
      throw new Error("PAYMENT_PROOF_DECISION_CONFLICT");
    }
    if (persistedDecision === decision) {
      return {
        decision: persistedDecision,
        notificationId,
        sourceMessageId,
        financialStatus: persistedDecision === "yes"
          ? "pending_human_regularization" as const
          : "not_applicable" as const,
      };
    }
  }

  const { error } = await args.supabase.rpc("store_business_event_register", {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    p_event_key: eventKey,
    p_actor_type: "store_responsible",
    p_lead_id: null,
    p_conversation_id: relatedConversationId,
    p_actor_user_id: null,
    p_event_payload: eventPayload,
  });
  if (error && !String(error.code || "").includes("23505")) throw new Error(`PAYMENT_PROOF_DECISION_PERSIST_FAILED:${error.message}`);
  return {
    decision,
    notificationId,
    sourceMessageId,
    financialStatus: decision === "yes"
      ? "pending_human_regularization" as const
      : "not_applicable" as const,
  };
}
