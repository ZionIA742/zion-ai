import { getCanonicalCrmStage } from "../../../config/crm";

export type LeadConversationContextRow = {
  id: string;
  organizationId: string;
  leadId: string;
  createdAt: string | null;
};

export type LeadOpportunityContextRow = {
  id: string;
  organizationId: string;
  storeId: string;
  leadId: string;
  conversationId: string | null;
  stage: string | null;
  stageChangedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type LeadConversationOpportunityContextInput = {
  organizationId: string;
  storeId: string | null;
  leadId: string;
  requestedConversationId?: string | null;
  requestedOpportunityId?: string | null;
  conversations: LeadConversationContextRow[];
  opportunities: LeadOpportunityContextRow[];
};

export type LeadConversationOpportunityContextFailure = {
  ok: false;
  error: "conversation_scope_rejected" | "opportunity_scope_rejected";
};

export type LeadConversationOpportunityContextSuccess = {
  ok: true;
  conversation: LeadConversationContextRow | null;
  opportunities: LeadOpportunityContextRow[];
  activeOpportunities: LeadOpportunityContextRow[];
  selectedOpportunity: LeadOpportunityContextRow | null;
  requiresOpportunitySelection: boolean;
};

export type LeadConversationOpportunityContextResult =
  | LeadConversationOpportunityContextFailure
  | LeadConversationOpportunityContextSuccess;

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function toDateMs(value: string | null) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortConversations(rows: LeadConversationContextRow[]) {
  return [...rows].sort((a, b) => toDateMs(b.createdAt) - toDateMs(a.createdAt));
}

function sortOpportunities(rows: LeadOpportunityContextRow[]) {
  return [...rows].sort((a, b) => {
    const byStageChange = toDateMs(b.stageChangedAt) - toDateMs(a.stageChangedAt);
    if (byStageChange !== 0) return byStageChange;
    const byUpdate = toDateMs(b.updatedAt) - toDateMs(a.updatedAt);
    if (byUpdate !== 0) return byUpdate;
    return toDateMs(b.createdAt) - toDateMs(a.createdAt);
  });
}

function isPipelineOpportunity(row: LeadOpportunityContextRow) {
  return getCanonicalCrmStage(row.stage)?.area === "pipeline";
}

export function buildCrmLeadConversationHref(args: {
  leadId: string | null | undefined;
  conversationId?: string | null;
  opportunityId?: string | null;
}) {
  const leadId = String(args.leadId || "").trim();
  if (!leadId) {
    return null;
  }

  const searchParams = new URLSearchParams();
  const conversationId = normalizeOptionalText(args.conversationId);
  const opportunityId = normalizeOptionalText(args.opportunityId);

  if (conversationId) {
    searchParams.set("conversationId", conversationId);
  }

  if (opportunityId) {
    searchParams.set("opportunityId", opportunityId);
  }

  const queryString = searchParams.toString();
  const basePath = `/crm/lead/${encodeURIComponent(leadId)}`;
  return queryString ? `${basePath}?${queryString}` : basePath;
}

export function resolveLeadConversationOpportunityContext(
  input: LeadConversationOpportunityContextInput,
): LeadConversationOpportunityContextResult {
  const organizationId = normalizeOptionalText(input.organizationId);
  const storeId = normalizeOptionalText(input.storeId);
  const leadId = normalizeOptionalText(input.leadId);
  const requestedConversationId = normalizeOptionalText(input.requestedConversationId);
  const requestedOpportunityId = normalizeOptionalText(input.requestedOpportunityId);

  const conversations = sortConversations(
    input.conversations.filter(
      (row) =>
        normalizeOptionalText(row.organizationId) === organizationId &&
        normalizeOptionalText(row.leadId) === leadId,
    ),
  );

  const opportunities = sortOpportunities(
    input.opportunities.filter(
      (row) =>
        normalizeOptionalText(row.organizationId) === organizationId &&
        normalizeOptionalText(row.leadId) === leadId &&
        storeId !== null &&
        normalizeOptionalText(row.storeId) === storeId,
    ),
  );

  let conversation: LeadConversationContextRow | null = null;

  if (requestedConversationId) {
    conversation =
      conversations.find((row) => normalizeOptionalText(row.id) === requestedConversationId) ??
      null;

    if (!conversation) {
      return {
        ok: false,
        error: "conversation_scope_rejected",
      };
    }
  } else if (!requestedOpportunityId) {
    conversation = conversations[0] ?? null;
  }

  let selectedOpportunity: LeadOpportunityContextRow | null = null;

  if (requestedOpportunityId) {
    selectedOpportunity =
      opportunities.find((row) => normalizeOptionalText(row.id) === requestedOpportunityId) ??
      null;

    if (!selectedOpportunity) {
      return {
        ok: false,
        error: "opportunity_scope_rejected",
      };
    }
  } else {
    const activeOpportunities = opportunities.filter(isPipelineOpportunity);

    if (activeOpportunities.length === 1) {
      selectedOpportunity = activeOpportunities[0];
    }
  }

  const activeOpportunities = opportunities.filter(isPipelineOpportunity);

  return {
    ok: true,
    conversation,
    opportunities,
    activeOpportunities,
    selectedOpportunity,
    requiresOpportunitySelection:
      !requestedOpportunityId && selectedOpportunity === null && activeOpportunities.length > 1,
  };
}
