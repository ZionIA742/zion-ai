import type { SupabaseClient } from "@supabase/supabase-js";
import { renderCancellationAlert, renderPaymentProofAlert } from "./customer-commercial-intents";

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

export const PAYMENT_PROOF_SOURCE = "customer_payment_proof_v1";
export const CANCELLATION_REQUEST_SOURCE = "customer_cancellation_request_v1";

export async function enqueueCustomerCommercialAlert(args: {
  supabase: Pick<SupabaseClient, "rpc">;
  organizationId: string;
  storeId: string;
  leadId?: string | null;
  conversationId: string;
  sourceMessageId: string;
  source: typeof PAYMENT_PROOF_SOURCE | typeof CANCELLATION_REQUEST_SOURCE;
  customerName?: string | null;
  reference?: string | null;
  reason?: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
  commercialOpportunityId?: string | null;
  eventSuffix?: string | null;
}) {
  const eventKey = `${args.source}:${args.organizationId}:${args.storeId}:${args.sourceMessageId}:${clean(args.eventSuffix) || "request"}`;
  const payment = args.source === PAYMENT_PROOF_SOURCE;
  const context = {
    source: args.source,
    reason: payment ? "payment_proof_requires_human_confirmation" : "customer_cancellation_request",
    event_key: eventKey,
    needs_human_action: true,
    customer_name: clean(args.customerName) || null,
    reference: clean(args.reference) || null,
    source_message_id: args.sourceMessageId,
    related_conversation_id: args.conversationId,
    commercial_opportunity_id: clean(args.commercialOpportunityId) || null,
    ...(payment ? {
      payment_proof_storage_bucket: clean(args.storageBucket) || null,
      payment_proof_storage_path: clean(args.storagePath) || null,
    } : { cancellation_reason: clean(args.reason) || null }),
  };
  const { error } = await args.supabase.rpc("assistant_enqueue_internal_notification", {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    p_notification_type: "important_alert",
    p_title: payment ? "Possivel comprovante de pagamento" : "Solicitacao de cancelamento",
    p_body: payment
      ? renderPaymentProofAlert({ customerName: args.customerName, reference: args.reference })
      : renderCancellationAlert({ customerName: args.customerName, reference: args.reference, reason: args.reason }),
    p_priority: "high",
    p_context: context,
    p_related_lead_id: args.leadId || null,
    p_related_conversation_id: args.conversationId,
    p_related_appointment_id: null,
    p_event_key: eventKey,
  });
  if (error) throw new Error(`CUSTOMER_COMMERCIAL_ALERT_ENQUEUE_FAILED:${error.message}`);
  return { eventKey, context };
}
