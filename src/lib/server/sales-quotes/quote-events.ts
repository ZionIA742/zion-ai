import type { SalesQuoteRow } from "./types";

export async function canInsertQuoteConversationEvent(args: {
  supabase: any;
  quote: SalesQuoteRow;
  eventType: string;
}) {
  const leadId = String(args.quote.lead_id || "").trim();
  const organizationId = String(args.quote.organization_id || "").trim();

  if (!leadId || !organizationId) {
    return {
      allowed: false,
      currentState: null,
      skippedReason: "missing_lead_context",
    };
  }

  const { data: leadData, error: leadError } = await args.supabase
    .from("leads")
    .select("state")
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (leadError) {
    throw new Error(`Falha ao carregar estado atual da conversa: ${leadError.message}`);
  }

  const currentState = String(leadData?.state || "").trim().toLowerCase() || null;
  if (!currentState) {
    return {
      allowed: false,
      currentState: null,
      skippedReason: "missing_current_state",
    };
  }

  const { data: ruleData, error: ruleError } = await args.supabase
    .from("event_state_rules")
    .select("is_allowed")
    .eq("event_type", args.eventType)
    .eq("state", currentState)
    .maybeSingle();

  if (ruleError) {
    throw new Error(`Falha ao validar event_state_rules: ${ruleError.message}`);
  }

  return {
    allowed: ruleData?.is_allowed === true,
    currentState,
    skippedReason: ruleData ? "rule_found" : "rule_not_found",
  };
}

export async function insertQuoteConversationEvent(args: {
  supabase: any;
  quote: SalesQuoteRow;
  eventType: string;
  payload: Record<string, unknown>;
  createdBy?: string;
}) {
  const conversationId = String(args.quote.conversation_id || "").trim();

  if (!conversationId) {
    return {
      created: false,
      skippedReason: "missing_conversation_id",
    };
  }

  const { error } = await args.supabase.from("conversation_events").insert({
    conversation_id: conversationId,
    organization_id: args.quote.organization_id,
    event_type: args.eventType,
    payload: args.payload,
    created_by: args.createdBy || "system",
  });

  if (error) {
    throw new Error(`Falha ao registrar conversation_event: ${error.message}`);
  }

  return {
    created: true,
    skippedReason: null,
  };
}
