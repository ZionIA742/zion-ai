import {
  readCommercialConversationFactEvents,
  type CommercialConversationFactEvent,
  type CommercialConversationFactRpcClient,
} from "./commercial-conversation-fact-events";

type CanonicalQualificationFact = {
  factKey: string;
  state: string;
  value: unknown;
};

type AtomicPromotionResult = {
  outcome: "promoted_created" | "ignored_existing_current" | "ignored_existing_event";
  eventId: string | null;
};

export type PromoteCommercialMemoryResult = {
  status: "disabled" | "skipped" | "promoted" | "partial" | "failed";
  attempted: number;
  promoted: number;
  skipped: number;
  errors: string[];
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readSingleRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" ? row as Record<string, unknown> : null;
}

function parseAtomicPromotionResult(value: unknown): AtomicPromotionResult {
  const row = readSingleRow(value);
  const outcome = clean(row?.outcome);
  if (
    outcome !== "promoted_created" &&
    outcome !== "ignored_existing_current" &&
    outcome !== "ignored_existing_event"
  ) {
    throw new Error("COMMERCIAL_MEMORY_PROMOTION_ATOMIC_RESPONSE_INVALID");
  }
  return {
    outcome,
    eventId: clean(row?.event_id) || null,
  };
}

function parseCanonicalFacts(value: unknown, organizationId: string, storeId: string, opportunityId: string) {
  const row = readSingleRow(value);
  if (
    clean(row?.organization_id) !== organizationId ||
    clean(row?.store_id) !== storeId ||
    clean(row?.commercial_opportunity_id) !== opportunityId
  ) {
    throw new Error("COMMERCIAL_MEMORY_PROMOTION_CANONICAL_SCOPE_MISMATCH");
  }

  const knownFacts = Array.isArray(row?.known_facts) ? row.known_facts : [];
  return knownFacts.flatMap((item): CanonicalQualificationFact[] => {
    if (!item || typeof item !== "object") return [];
    const fact = item as Record<string, unknown>;
    const factKey = clean(fact.factKey);
    return factKey
      ? [{ factKey, state: clean(fact.state), value: fact.value }]
      : [];
  });
}

function eligible(event: CommercialConversationFactEvent): boolean {
  return (
    event.commercialOpportunityId === null &&
    (event.actorType === "customer" || event.actorType === "human") &&
    event.evidenceLevel === "confirmed" &&
    event.conflictState === "consistent" &&
    ["assertion", "correction"].includes(event.eventKind)
  );
}

export function isCommercialMemoryCrmPromotionEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment.ZION_P9_10_6_A_REMOTE_INSTALLED === "true";
}

export function shouldPromoteCommercialMemoryForDecision(args: {
  enabled: boolean;
  decisionKind: string | null;
  resolvedCommercialOpportunityId: string | null;
}): boolean {
  return (
    args.enabled &&
    Boolean(clean(args.resolvedCommercialOpportunityId)) &&
    [
      "continue_same_intent",
      "reopen_same_intent",
      "new_independent_opportunity",
      "repurchase",
      "addendum",
    ].includes(args.decisionKind || "")
  );
}

export async function promoteCommercialMemoryToOpportunity(args: {
  supabase: CommercialConversationFactRpcClient & { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string | null } | null }> };
  organizationId: string;
  storeId: string;
  leadId: string;
  conversationId: string;
  conversationSessionId: string;
  commercialOpportunityId: string;
  enabled?: boolean;
  recoveryAuthority?: {
    responseSetId: string;
    queueId: string;
    claimToken: string;
    anchorMessageId: string;
    conversationId: string;
    leadId: string;
    commercialOpportunityId: string;
  };
}): Promise<PromoteCommercialMemoryResult> {
  if (args.enabled !== true) {
    return { status: "disabled", attempted: 0, promoted: 0, skipped: 0, errors: [] };
  }

  const scope = [
    args.organizationId,
    args.storeId,
    args.leadId,
    args.conversationId,
    args.conversationSessionId,
    args.commercialOpportunityId,
  ].map(clean);
  if (scope.some((value) => !value)) {
    return {
      status: "skipped",
      attempted: 0,
      promoted: 0,
      skipped: 0,
      errors: ["COMMERCIAL_MEMORY_PROMOTION_SCOPE_INVALID"],
    };
  }

  try {
    const events = await readCommercialConversationFactEvents({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      leadId: args.leadId,
      conversationId: args.conversationId,
      conversationSessionId: args.conversationSessionId,
      commercialOpportunityId: args.commercialOpportunityId,
    });
    const candidates = events.filter(eligible);

    const canonicalResult = await args.supabase.rpc(
      "read_commercial_opportunity_qualification_facts_by_system",
      {
        p_organization_id: args.organizationId,
        p_store_id: args.storeId,
        p_commercial_opportunity_id: args.commercialOpportunityId,
      },
    );
    if (canonicalResult.error) {
      throw new Error(`COMMERCIAL_MEMORY_PROMOTION_CANONICAL_READ_FAILED:${canonicalResult.error.message || "unknown"}`);
    }
    const canonicalFacts = parseCanonicalFacts(
      canonicalResult.data,
      args.organizationId,
      args.storeId,
      args.commercialOpportunityId,
    );

    let promoted = 0;
    let skipped = events.length - candidates.length;
    const errors: string[] = [];
    for (const event of candidates) {
      const existing = canonicalFacts.find((fact) => fact.factKey === event.factKey);
      if (existing) {
        if (existing.state === "conflict" || !sameJson(existing.value, event.value)) {
          skipped += 1;
          continue;
        }
        skipped += 1;
        continue;
      }

      const sourceType = event.actorType === "human"
        ? "human_message"
        : "incoming_customer_message";
      const { data, error } = await args.supabase.rpc(
        "promote_commercial_memory_fact_if_absent_by_system",
        {
          p_organization_id: args.organizationId,
          p_store_id: args.storeId,
          p_commercial_opportunity_id: args.commercialOpportunityId,
          p_operation_key: `p9_10_6_b_memory_promotion:v1:${args.commercialOpportunityId}:${event.eventId}`,
          p_fact_key: event.factKey,
          p_value_json: event.value,
          p_assertion_level: "confirmed",
          p_source_type: sourceType,
          p_source_message_id: event.sourceMessageId,
          p_source_conversation_id: event.conversationId,
          p_created_by: "commercial_memory_promotion_v1",
          p_resolves_conflict: false,
          ...(args.recoveryAuthority
            ? {
                p_response_set_id: args.recoveryAuthority.responseSetId,
                p_queue_id: args.recoveryAuthority.queueId,
                p_claim_token: args.recoveryAuthority.claimToken,
                p_anchor_message_id: args.recoveryAuthority.anchorMessageId,
                p_recovery_conversation_id: args.recoveryAuthority.conversationId,
                p_recovery_lead_id: args.recoveryAuthority.leadId,
              }
            : {}),
        },
      );
      if (error) {
        errors.push(`${event.eventId}:${error.message || "COMMERCIAL_MEMORY_PROMOTION_WRITE_FAILED"}`);
        continue;
      }
      const result = parseAtomicPromotionResult(data);
      if (result.outcome === "promoted_created") {
        promoted += 1;
      } else {
        skipped += 1;
      }
    }

    return {
      status: errors.length > 0 ? (promoted > 0 ? "partial" : "failed") : promoted > 0 ? "promoted" : "skipped",
      attempted: candidates.length,
      promoted,
      skipped,
      errors,
    };
  } catch (error) {
    return {
      status: "failed",
      attempted: 0,
      promoted: 0,
      skipped: 0,
      errors: [error instanceof Error ? error.message : "COMMERCIAL_MEMORY_PROMOTION_FAILED"],
    };
  }
}
