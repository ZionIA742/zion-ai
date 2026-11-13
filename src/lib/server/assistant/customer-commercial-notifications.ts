import type { SupabaseClient } from "@supabase/supabase-js";
import {
  renderCancellationAlert,
  renderPaymentProofAlert,
  type CancellationCommercialFacts,
} from "./customer-commercial-intents";

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

export const PAYMENT_PROOF_SOURCE = "customer_payment_proof_v1";
export const CANCELLATION_REQUEST_SOURCE = "customer_cancellation_request_v1";

type CommercialOpportunitySnapshot = {
  id: string;
  lifecycle_cycle: number | null;
  stage: string | null;
};

type CommercialContractSnapshot = {
  id: string;
  contract_number: string | null;
  status: string | null;
  customer_signed_at: string | null;
};

async function loadCancellationCommercialFacts(args: {
  supabase: Pick<SupabaseClient, "rpc" | "from">;
  organizationId: string;
  storeId: string;
  commercialOpportunityId?: string | null;
}): Promise<CancellationCommercialFacts> {
  const opportunityId = clean(args.commercialOpportunityId);
  if (!opportunityId) {
    return {
      opportunityStatus: "not_identified",
      contractStatus: "not_identified",
      signatureStatus: "unknown",
      financialStatus: "unknown",
    };
  }

  const { data: opportunity, error: opportunityError } = await args.supabase
    .from("commercial_opportunities")
    .select("id,lifecycle_cycle,stage")
    .eq("id", opportunityId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .limit(2);
  if (opportunityError) {
    return {
      opportunityStatus: "unknown",
      contractStatus: "unknown",
      signatureStatus: "unknown",
      financialStatus: "unknown",
    };
  }

  const opportunities = (opportunity || []) as CommercialOpportunitySnapshot[];
  if (opportunities.length !== 1) {
    return {
      opportunityStatus: opportunities.length > 1 ? "ambiguous" : "not_identified",
      contractStatus: "not_identified",
      signatureStatus: "unknown",
      financialStatus: "unknown",
    };
  }

  const currentOpportunity = opportunities[0];
  const [{ data: contracts, error: contractsError }, { data: quotes, error: quotesError }] = await Promise.all([
    args.supabase
      .from("sales_contracts")
      .select("id,contract_number,status,customer_signed_at")
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .eq("commercial_opportunity_id", opportunityId)
      .order("created_at", { ascending: false })
      .limit(5),
    args.supabase
      .from("sales_quotes")
      .select("id,quote_number,status")
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .eq("commercial_opportunity_id", opportunityId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const contractRows = (contracts || []) as CommercialContractSnapshot[];
  const contract = contractRows.length === 1 ? contractRows[0] : null;
  const financial = Number.isInteger(currentOpportunity.lifecycle_cycle)
    ? await args.supabase.rpc("p9_read_payment_history_internal", {
        p_organization_id: args.organizationId,
        p_store_id: args.storeId,
        p_commercial_opportunity_id: opportunityId,
        p_lifecycle_cycle: currentOpportunity.lifecycle_cycle,
      })
    : { data: null, error: null };
  const financialRows = Array.isArray(financial.data)
    ? financial.data.filter((row: { event_kind?: unknown }) => row.event_kind === "payment")
    : [];

  return {
    opportunityStatus: "identified",
    opportunityStage: clean(currentOpportunity.stage),
    quoteNumber: !quotesError && Array.isArray(quotes) && quotes.length === 1
      ? clean((quotes[0] as { quote_number?: unknown }).quote_number)
      : null,
    contractStatus: contractsError
      ? "unknown"
      : contractRows.length > 1
        ? "ambiguous"
        : contract
          ? "identified"
          : "not_identified",
    contractNumber: contract ? clean(contract.contract_number) : null,
    contractStatusValue: contract ? clean(contract.status) : null,
    signatureStatus: contract
      ? clean(contract.customer_signed_at)
        ? "confirmed"
        : "not_confirmed"
      : contractsError || contractRows.length > 1
        ? "unknown"
        : "not_confirmed",
    financialStatus: financial.error || !Array.isArray(financial.data)
      ? "unknown"
      : financialRows.length > 0
        ? "recorded"
        : "not_recorded",
    financialEventCount: financial.error || !Array.isArray(financial.data)
      ? null
      : financialRows.length,
  };
}

export async function enqueueCustomerCommercialAlert(args: {
  supabase: Pick<SupabaseClient, "rpc" | "from">;
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
  const cancellationFacts = payment
    ? null
    : await loadCancellationCommercialFacts({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        commercialOpportunityId: args.commercialOpportunityId,
      });
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
    ...(cancellationFacts ? { cancellation_commercial_facts: cancellationFacts } : {}),
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
      : renderCancellationAlert({ customerName: args.customerName, reference: args.reference, reason: args.reason, facts: cancellationFacts }),
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
