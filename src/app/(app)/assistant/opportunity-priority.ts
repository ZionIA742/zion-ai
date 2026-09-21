import { buildCrmLeadConversationHref } from "@/lib/server/crm/lead-conversation-opportunity-context";

export type AssistantOpportunityPriorityRow = {
  commercial_opportunity_id: string;
  priority_band: string | null;
  priority_rank: number | null;
  reason_codes: string[] | null;
  has_due_followup?: boolean | null;
  followup_next_action_at?: string | null;
  followup_id?: string | null;
  blockers?: string[] | null;
  evaluated_as_of?: string | null;
};

export type AssistantOpportunityMetadata = Record<string, unknown> & {
  commercial_opportunity_id?: string | null;
  customer_context_summary?: (Record<string, unknown> & {
    commercialOpportunityId?: string | null;
  }) | null;
};

export type AssistantOpportunityMessage = {
  related_lead_id: string | null;
  related_conversation_id: string | null;
  metadata: AssistantOpportunityMetadata | null;
};

export type AssistantCommercialOpportunityResolution = {
  commercialOpportunityId: string | null;
  isAmbiguous: boolean;
  conflictReason: "commercial_opportunity_id_mismatch" | null;
};

export type AssistantOpportunityPresentation = AssistantCommercialOpportunityResolution & {
  priority: AssistantOpportunityPriorityRow | null;
  crmHref: string | null;
};

function cleanExplicitId(value: unknown) {
  return typeof value === "string" ? value.trim() || null : null;
}

export function resolveAssistantCommercialOpportunityId(
  metadata: AssistantOpportunityMetadata | null | undefined,
): AssistantCommercialOpportunityResolution {
  const metadataOpportunityId = cleanExplicitId(metadata?.commercial_opportunity_id);
  const summaryOpportunityId = cleanExplicitId(
    metadata?.customer_context_summary?.commercialOpportunityId,
  );

  if (
    metadataOpportunityId &&
    summaryOpportunityId &&
    metadataOpportunityId !== summaryOpportunityId
  ) {
    return {
      commercialOpportunityId: null,
      isAmbiguous: true,
      conflictReason: "commercial_opportunity_id_mismatch",
    };
  }

  return {
    commercialOpportunityId: metadataOpportunityId || summaryOpportunityId,
    isAmbiguous: false,
    conflictReason: null,
  };
}

export function getAssistantOpportunityPresentation(args: {
  message: AssistantOpportunityMessage;
  priorityByOpportunity: Record<string, AssistantOpportunityPriorityRow>;
}): AssistantOpportunityPresentation {
  const resolution = resolveAssistantCommercialOpportunityId(args.message.metadata);
  const commercialOpportunityId = resolution.commercialOpportunityId;
  const priority = commercialOpportunityId
    ? args.priorityByOpportunity[commercialOpportunityId] || null
    : null;
  const crmHref =
    commercialOpportunityId && !resolution.isAmbiguous
      ? buildCrmLeadConversationHref({
          leadId: args.message.related_lead_id,
          conversationId: args.message.related_conversation_id,
          opportunityId: commercialOpportunityId,
        })
      : null;

  return {
    ...resolution,
    priority,
    crmHref,
  };
}
