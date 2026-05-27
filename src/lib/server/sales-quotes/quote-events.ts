import type { SalesQuoteRow } from "./types";

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
