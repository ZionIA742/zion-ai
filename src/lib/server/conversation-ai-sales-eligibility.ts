// `conversations.status` is the commercial conversation state, not lead.state
// or commercial_opportunities.stage. Keep this allowlist explicit so a new or
// corrupted status cannot authorize an automated reply by accident.
const SALES_AI_LIVE_CONVERSATION_STATUSES = new Set([
  "active",
  "novo_lead",
  "qualificacao",
  "negociacao",
  "orcamento",
]);

export function isSalesAiConversationStatusEligible(status: unknown): boolean {
  const normalized = String(status || "").trim().toLowerCase();
  return SALES_AI_LIVE_CONVERSATION_STATUSES.has(normalized);
}
