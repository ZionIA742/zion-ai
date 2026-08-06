import {
  getCanonicalCrmStage,
  type CanonicalCrmStageId,
} from "@/config/crm";

const SAFE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AuthorizedOpportunityStage = CanonicalCrmStageId;

export type OpportunityDetailWarningCode =
  | "missing_origin_lead"
  | "missing_primary_conversation"
  | "missing_display_name"
  | "missing_phone";

export type OpportunityDetailProblemCode =
  | "invalid_stage"
  | "customer_scope_inconsistency"
  | "origin_lead_scope_inconsistency"
  | "primary_conversation_scope_inconsistency";

export type OpportunityDetailErrorCode =
  | "unauthenticated"
  | "not_found"
  | "technical_error";

export type AuthorizedOpportunityDetailData = {
  opportunity: {
    id: string;
    organizationId: string;
    storeId: string;
    customerId: string;
    stage: AuthorizedOpportunityStage | null;
    stageStatus: "valid" | "invalid";
    stageChangedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  };
  customer: {
    id: string;
    displayName: string | null;
  };
  originLead: {
    id: string;
    name: string | null;
    phone: string | null;
  } | null;
  primaryConversation: {
    id: string;
    leadId: string | null;
    isHumanActive: boolean | null;
  } | null;
  hasOriginLead: boolean;
  hasPrimaryConversation: boolean;
  isHumanActive: boolean | null;
  displayName: string | null;
  phone: string | null;
  warnings: OpportunityDetailWarningCode[];
  problems: OpportunityDetailProblemCode[];
  requiresAttention: boolean;
};

export type ResolveAuthorizedOpportunityDetailSuccess = {
  ok: true;
  data: AuthorizedOpportunityDetailData;
};

export type ResolveAuthorizedOpportunityDetailFailure = {
  ok: false;
  error: OpportunityDetailErrorCode;
  message: string;
};

export type ResolveAuthorizedOpportunityDetailResult =
  | ResolveAuthorizedOpportunityDetailSuccess
  | ResolveAuthorizedOpportunityDetailFailure;

export type AuthorizedStoreContext = {
  sessionUserId: string;
  organizationId: string;
  storeId: string;
};

export type AuthorizedStoreGateResult =
  | {
      ok: true;
      context: AuthorizedStoreContext;
    }
  | {
      ok: false;
      reason: "unauthenticated" | "unavailable";
    };

type QueryError = {
  message: string;
};

type QueryResult<T> = Promise<{
  data: T | null;
  error: QueryError | null;
}>;

type SingleRowFilter<T> = {
  eq(column: string, value: unknown): SingleRowFilter<T>;
  is(column: string, value: null): SingleRowFilter<T>;
  maybeSingle(): QueryResult<T>;
};

export type ServiceSupabaseLike = {
  from(table: string): {
    select(selection: string): SingleRowFilter<unknown>;
  };
};

type OpportunityRow = {
  id: string;
  organization_id: string;
  store_id: string;
  customer_id: string;
  origin_lead_id: string | null;
  primary_conversation_id: string | null;
  stage: string | null;
  stage_changed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type CustomerRow = {
  id: string;
  organization_id: string;
  display_name: string | null;
  merged_into_customer_id: string | null;
};

type CustomerStoreLinkRow = {
  id: string;
  organization_id: string;
  store_id: string;
  customer_id: string;
};

type LeadRow = {
  id: string;
  organization_id: string;
  store_id: string | null;
  name: string | null;
  phone: string | null;
};

type ConversationIdentityRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
};

type ConversationHumanStateRow = {
  id: string;
  organization_id: string;
  is_human_active: boolean | null;
};

type ConversationSessionRow = {
  id: string;
  organization_id: string;
  store_id: string;
  conversation_id: string;
  status: string;
};

type CommercialSessionContextLinkRow = {
  id: string;
  organization_id: string;
  store_id: string;
  conversation_session_id: string;
  customer_id: string;
  commercial_opportunity_id: string;
  lead_customer_link_id: string;
  status: string;
  unlinked_at: string | null;
};

type LeadCustomerLinkProofRow = {
  id: string;
  organization_id: string;
  store_id: string;
  customer_id: string;
  lead_id: string;
  status: string;
  unlinked_at: string | null;
};

type ConversationProofArgs = {
  commercialOpportunityId: string;
  organizationId: string;
  storeId: string;
  customerId: string;
  originLeadId: string;
  primaryConversationId: string;
};

export type OpportunityDetailDataAccess = {
  isSafeOpportunityId(value: string): boolean;
  loadOpportunityById(
    commercialOpportunityId: string,
    organizationId: string,
    storeId: string,
  ): Promise<OpportunityRow | null>;
  loadCustomerById(
    customerId: string,
    organizationId: string,
  ): Promise<CustomerRow | null>;
  loadCustomerStoreLink(
    customerId: string,
    organizationId: string,
    storeId: string,
  ): Promise<CustomerStoreLinkRow | null>;
  loadLeadById(
    leadId: string,
    organizationId: string,
    storeId: string,
  ): Promise<LeadRow | null>;
  loadConversationIdentityById(
    conversationId: string,
    organizationId: string,
  ): Promise<ConversationIdentityRow | null>;
  loadConversationHumanStateById(
    conversationId: string,
    organizationId: string,
  ): Promise<ConversationHumanStateRow | null>;
  loadActiveConversationSessionByConversationId(
    conversationId: string,
    organizationId: string,
    storeId: string,
  ): Promise<ConversationSessionRow | null>;
  loadActiveContextLinkBySession(
    conversationSessionId: string,
    commercialOpportunityId: string,
    organizationId: string,
    storeId: string,
    customerId: string,
  ): Promise<CommercialSessionContextLinkRow | null>;
  loadActiveLeadCustomerLinkProof(
    leadCustomerLinkId: string,
    organizationId: string,
    storeId: string,
    customerId: string,
    leadId: string,
  ): Promise<LeadCustomerLinkProofRow | null>;
};

export type OpportunityDetailRuntimeDeps = {
  resolveStoreAccess(): Promise<AuthorizedStoreGateResult>;
  createDataAccess(): OpportunityDetailDataAccess;
};

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function buildFailure(
  error: OpportunityDetailErrorCode,
  message: string,
): ResolveAuthorizedOpportunityDetailFailure {
  return {
    ok: false,
    error,
    message,
  };
}

async function maybeSingle<T>(
  query: SingleRowFilter<unknown>,
  errorCode: string,
): Promise<T | null> {
  const response = await query.maybeSingle();

  if (response.error) {
    throw new Error(errorCode);
  }

  return (response.data ?? null) as T | null;
}

export function createProductionDataAccess(
  serviceSupabase: ServiceSupabaseLike,
): OpportunityDetailDataAccess {
  return {
    isSafeOpportunityId(value: string) {
      return SAFE_UUID_PATTERN.test(value);
    },
    loadOpportunityById(commercialOpportunityId, organizationId, storeId) {
      return maybeSingle<OpportunityRow>(
        serviceSupabase
          .from("commercial_opportunities")
          .select(
            "id, organization_id, store_id, customer_id, origin_lead_id, primary_conversation_id, stage, stage_changed_at, created_at, updated_at",
          )
          .eq("id", commercialOpportunityId)
          .eq("organization_id", organizationId)
          .eq("store_id", storeId),
        "LOAD_OPPORTUNITY_FAILED",
      );
    },
    loadCustomerById(customerId, organizationId) {
      return maybeSingle<CustomerRow>(
        serviceSupabase
          .from("customers")
          .select("id, organization_id, display_name, merged_into_customer_id")
          .eq("id", customerId)
          .eq("organization_id", organizationId),
        "LOAD_CUSTOMER_FAILED",
      );
    },
    loadCustomerStoreLink(customerId, organizationId, storeId) {
      return maybeSingle<CustomerStoreLinkRow>(
        serviceSupabase
          .from("customer_store_links")
          .select("id, organization_id, store_id, customer_id")
          .eq("customer_id", customerId)
          .eq("organization_id", organizationId)
          .eq("store_id", storeId),
        "LOAD_CUSTOMER_STORE_LINK_FAILED",
      );
    },
    loadLeadById(leadId, organizationId, storeId) {
      return maybeSingle<LeadRow>(
        serviceSupabase
          .from("leads")
          .select("id, organization_id, store_id, name, phone")
          .eq("id", leadId)
          .eq("organization_id", organizationId)
          .eq("store_id", storeId),
        "LOAD_LEAD_FAILED",
      );
    },
    loadConversationIdentityById(conversationId, organizationId) {
      return maybeSingle<ConversationIdentityRow>(
        serviceSupabase
          .from("conversations")
          .select("id, organization_id, lead_id")
          .eq("id", conversationId)
          .eq("organization_id", organizationId),
        "LOAD_CONVERSATION_IDENTITY_FAILED",
      );
    },
    loadConversationHumanStateById(conversationId, organizationId) {
      return maybeSingle<ConversationHumanStateRow>(
        serviceSupabase
          .from("conversations")
          .select("id, organization_id, is_human_active")
          .eq("id", conversationId)
          .eq("organization_id", organizationId),
        "LOAD_CONVERSATION_HUMAN_STATE_FAILED",
      );
    },
    loadActiveConversationSessionByConversationId(
      conversationId,
      organizationId,
      storeId,
    ) {
      return maybeSingle<ConversationSessionRow>(
        serviceSupabase
          .from("conversation_sessions")
          .select("id, organization_id, store_id, conversation_id, status")
          .eq("conversation_id", conversationId)
          .eq("organization_id", organizationId)
          .eq("store_id", storeId)
          .eq("status", "active"),
        "LOAD_CONVERSATION_SESSION_FAILED",
      );
    },
    loadActiveContextLinkBySession(
      conversationSessionId,
      commercialOpportunityId,
      organizationId,
      storeId,
      customerId,
    ) {
      return maybeSingle<CommercialSessionContextLinkRow>(
        serviceSupabase
          .from("commercial_session_context_links")
          .select(
            "id, organization_id, store_id, conversation_session_id, customer_id, commercial_opportunity_id, lead_customer_link_id, status, unlinked_at",
          )
          .eq("conversation_session_id", conversationSessionId)
          .eq("commercial_opportunity_id", commercialOpportunityId)
          .eq("organization_id", organizationId)
          .eq("store_id", storeId)
          .eq("customer_id", customerId)
          .eq("status", "active")
          .is("unlinked_at", null),
        "LOAD_CONTEXT_LINK_FAILED",
      );
    },
    loadActiveLeadCustomerLinkProof(
      leadCustomerLinkId,
      organizationId,
      storeId,
      customerId,
      leadId,
    ) {
      return maybeSingle<LeadCustomerLinkProofRow>(
        serviceSupabase
          .from("lead_customer_links")
          .select("id, organization_id, store_id, customer_id, lead_id, status, unlinked_at")
          .eq("id", leadCustomerLinkId)
          .eq("organization_id", organizationId)
          .eq("store_id", storeId)
          .eq("customer_id", customerId)
          .eq("lead_id", leadId)
          .eq("status", "active")
          .is("unlinked_at", null),
        "LOAD_LEAD_CUSTOMER_LINK_PROOF_FAILED",
      );
    },
  };
}

async function proveConversationByExplicitContext(
  dataAccess: OpportunityDetailDataAccess,
  args: ConversationProofArgs,
): Promise<boolean> {
  const session = await dataAccess.loadActiveConversationSessionByConversationId(
    args.primaryConversationId,
    args.organizationId,
    args.storeId,
  );

  if (!session) {
    return false;
  }

  const contextLink = await dataAccess.loadActiveContextLinkBySession(
    session.id,
    args.commercialOpportunityId,
    args.organizationId,
    args.storeId,
    args.customerId,
  );

  if (!contextLink) {
    return false;
  }

  const leadCustomerLink = await dataAccess.loadActiveLeadCustomerLinkProof(
    contextLink.lead_customer_link_id,
    args.organizationId,
    args.storeId,
    args.customerId,
    args.originLeadId,
  );

  return leadCustomerLink !== null;
}

export async function resolveAuthorizedOpportunityDetailCore(
  commercialOpportunityId: string,
  context: AuthorizedStoreContext,
  dataAccess: OpportunityDetailDataAccess,
): Promise<ResolveAuthorizedOpportunityDetailResult> {
  const safeOpportunityId = String(commercialOpportunityId || "").trim();

  if (!dataAccess.isSafeOpportunityId(safeOpportunityId)) {
    return buildFailure("not_found", "Oportunidade nao encontrada.");
  }

  const opportunity = await dataAccess.loadOpportunityById(
    safeOpportunityId,
    context.organizationId,
    context.storeId,
  );

  if (!opportunity) {
    return buildFailure("not_found", "Oportunidade nao encontrada.");
  }

  const warnings: OpportunityDetailWarningCode[] = [];
  const problems: OpportunityDetailProblemCode[] = [];

  const stageDefinition = getCanonicalCrmStage(opportunity.stage);
  const stage = stageDefinition?.id ?? null;

  if (!stage) {
    problems.push("invalid_stage");
  }

  const customerId = normalizeOptionalText(opportunity.customer_id);
  const originLeadId = normalizeOptionalText(opportunity.origin_lead_id);
  const primaryConversationId = normalizeOptionalText(
    opportunity.primary_conversation_id,
  );

  let customerDisplayName: string | null = null;
  let customerValidated = false;

  if (customerId) {
    const [customer, customerStoreLink] = await Promise.all([
      dataAccess.loadCustomerById(customerId, context.organizationId),
      dataAccess.loadCustomerStoreLink(
        customerId,
        context.organizationId,
        context.storeId,
      ),
    ]);

    if (
      customer &&
      customerStoreLink &&
      normalizeOptionalText(customer.merged_into_customer_id) === null &&
      normalizeOptionalText(customer.organization_id) === context.organizationId &&
      normalizeOptionalText(customerStoreLink.organization_id) ===
        context.organizationId &&
      normalizeOptionalText(customerStoreLink.store_id) === context.storeId &&
      normalizeOptionalText(customerStoreLink.customer_id) === customerId
    ) {
      customerValidated = true;
      customerDisplayName = normalizeOptionalText(customer.display_name);
    } else {
      problems.push("customer_scope_inconsistency");
    }
  } else {
    problems.push("customer_scope_inconsistency");
  }

  let originLead: AuthorizedOpportunityDetailData["originLead"] = null;
  let validatedLeadId: string | null = null;
  let leadNameForDisplay: string | null = null;
  let leadPhoneForDisplay: string | null = null;

  if (!originLeadId) {
    warnings.push("missing_origin_lead");
  } else {
    const lead = await dataAccess.loadLeadById(
      originLeadId,
      context.organizationId,
      context.storeId,
    );

    if (!lead) {
      problems.push("origin_lead_scope_inconsistency");
    } else {
      validatedLeadId = lead.id;

      if (customerValidated) {
        leadNameForDisplay = normalizeOptionalText(lead.name);
        leadPhoneForDisplay = normalizeOptionalText(lead.phone);
        originLead = {
          id: lead.id,
          name: leadNameForDisplay,
          phone: leadPhoneForDisplay,
        };
      }
    }
  }

  let primaryConversation: AuthorizedOpportunityDetailData["primaryConversation"] =
    null;

  if (!primaryConversationId) {
    warnings.push("missing_primary_conversation");
  } else {
    const conversation = await dataAccess.loadConversationIdentityById(
      primaryConversationId,
      context.organizationId,
    );

    const conversationLeadId = normalizeOptionalText(conversation?.lead_id);
    const baseConversationMatches =
      conversation !== null &&
      conversationLeadId !== null &&
      validatedLeadId !== null &&
      conversationLeadId === validatedLeadId &&
      customerId !== null;

    if (
      baseConversationMatches &&
      customerId !== null &&
      validatedLeadId !== null &&
      primaryConversationId !== null
    ) {
      const proofArgs: ConversationProofArgs = {
        commercialOpportunityId: opportunity.id,
        organizationId: context.organizationId,
        storeId: context.storeId,
        customerId: customerId,
        originLeadId: validatedLeadId,
        primaryConversationId,
      };

      const hasExplicitProof = await proveConversationByExplicitContext(
        dataAccess,
        proofArgs,
      );

      if (hasExplicitProof) {
        const humanState = await dataAccess.loadConversationHumanStateById(
          primaryConversationId,
          context.organizationId,
        );

        primaryConversation = {
          id: primaryConversationId,
          leadId: conversationLeadId,
          isHumanActive:
            humanState && typeof humanState.is_human_active === "boolean"
              ? humanState.is_human_active
              : null,
        };
      } else {
        problems.push("primary_conversation_scope_inconsistency");
      }
    } else {
      problems.push("primary_conversation_scope_inconsistency");
    }
  }

  const displayName = customerValidated
    ? customerDisplayName ?? leadNameForDisplay
    : null;
  const phone = customerValidated ? leadPhoneForDisplay : null;

  if (!displayName) {
    warnings.push("missing_display_name");
  }

  if (!phone) {
    warnings.push("missing_phone");
  }

  return {
    ok: true,
    data: {
      opportunity: {
        id: opportunity.id,
        organizationId: opportunity.organization_id,
        storeId: opportunity.store_id,
        customerId: opportunity.customer_id,
        stage,
        stageStatus: stage ? "valid" : "invalid",
        stageChangedAt: opportunity.stage_changed_at,
        createdAt: opportunity.created_at,
        updatedAt: opportunity.updated_at,
      },
      customer: {
        id: opportunity.customer_id,
        displayName: customerValidated ? customerDisplayName : null,
      },
      originLead,
      primaryConversation,
      hasOriginLead: originLeadId !== null,
      hasPrimaryConversation: primaryConversationId !== null,
      isHumanActive: primaryConversation?.isHumanActive ?? null,
      displayName,
      phone,
      warnings,
      problems,
      requiresAttention: problems.length > 0,
    },
  };
}

export async function resolveAuthorizedOpportunityDetailWithDeps(
  commercialOpportunityId: string,
  runtimeDeps: OpportunityDetailRuntimeDeps,
): Promise<ResolveAuthorizedOpportunityDetailResult> {
  try {
    const gateResult = await runtimeDeps.resolveStoreAccess();

    if (!gateResult.ok) {
      return gateResult.reason === "unauthenticated"
        ? buildFailure("unauthenticated", "Usuario nao autenticado.")
        : buildFailure(
            "technical_error",
            "Nao foi possivel carregar o detalhe da oportunidade.",
          );
    }

    const dataAccess = runtimeDeps.createDataAccess();
    return await resolveAuthorizedOpportunityDetailCore(
      commercialOpportunityId,
      gateResult.context,
      dataAccess,
    );
  } catch {
    return buildFailure(
      "technical_error",
      "Nao foi possivel carregar o detalhe da oportunidade.",
    );
  }
}
