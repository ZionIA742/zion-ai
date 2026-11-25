/** Server-only adapter. Never import this module from client components. */

export const WRITE_COMMERCIAL_CONVERSATION_FACT_EVENT_RPC =
  "write_commercial_conversation_fact_event_by_system" as const;
export const READ_COMMERCIAL_CONVERSATION_FACT_EVENTS_RPC =
  "read_commercial_conversation_fact_events_by_system" as const;

const MEDIA_TYPES = new Set(["text", "audio", "image", "video", "document"]);
const ACTOR_TYPES = new Set(["customer", "human", "assistant", "system"]);
const EVIDENCE_LEVELS = new Set(["declared", "confirmed", "inferred", "conflict"]);
const EVENT_KINDS = new Set(["assertion", "correction", "conflict_resolution"]);

export type CommercialConversationFactRpcClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { message?: string | null } | null;
  }>;
};

export type CommercialConversationFactEventInput = {
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string;
  conversationSessionId: string;
  commercialSessionContextLinkId?: string | null;
  commercialOpportunityId?: string | null;
  operationKey: string;
  factKey: string;
  value: unknown;
  sourceMessageId: string;
  sourceMediaType: "text" | "audio" | "image" | "video" | "document";
  actorType: "customer" | "human" | "assistant" | "system";
  evidenceLevel: "declared" | "confirmed" | "inferred" | "conflict";
  eventKind?: "assertion" | "correction" | "conflict_resolution";
  supersedesEventId?: string | null;
};

export type CommercialConversationFactEvent = {
  eventId: string;
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string;
  conversationSessionId: string;
  commercialSessionContextLinkId: string | null;
  commercialOpportunityId: string | null;
  factKey: string;
  value: unknown;
  operationKey: string;
  eventKind: string;
  supersedesEventId: string | null;
  sourceMessageId: string;
  sourceMediaType: string;
  actorType: string;
  evidenceLevel: string;
  createdAt: string;
  conflictState: "consistent" | "conflict";
};

export type CommercialConversationFactWriteResult = {
  eventId: string;
  outcome: "created" | "replayed";
  operationKey: string;
  factKey: string;
  conflictGroupKey: string;
  createdAt: string;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullable(value: unknown): string | null {
  const result = clean(value);
  return result || null;
}

function firstRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" ? row as Record<string, unknown> : null;
}

function requireScope(args: {
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string;
  conversationSessionId: string;
}) {
  const values = [
    args.organizationId,
    args.storeId,
    args.conversationId,
    args.leadId,
    args.conversationSessionId,
  ].map(clean);
  if (values.some((value) => !value)) {
    throw new Error("COMMERCIAL_CONVERSATION_FACT_SCOPE_INVALID");
  }
  return values;
}

function parseWriteResult(value: unknown): CommercialConversationFactWriteResult {
  const row = firstRow(value);
  const eventId = clean(row?.event_id);
  const outcome = clean(row?.outcome);
  const operationKey = clean(row?.operation_key);
  const factKey = clean(row?.fact_key);
  const conflictGroupKey = clean(row?.conflict_group_key);
  const createdAt = clean(row?.created_at);
  if (
    !eventId ||
    (outcome !== "created" && outcome !== "replayed") ||
    !operationKey ||
    !factKey ||
    !conflictGroupKey ||
    !createdAt
  ) {
    throw new Error("COMMERCIAL_CONVERSATION_FACT_WRITE_RESPONSE_INVALID");
  }
  return {
    eventId,
    outcome,
    operationKey,
    factKey,
    conflictGroupKey,
    createdAt,
  };
}

export async function writeCommercialConversationFactEvent(args: {
  supabase: CommercialConversationFactRpcClient;
  input: CommercialConversationFactEventInput;
}): Promise<CommercialConversationFactWriteResult> {
  const input = args.input;
  const [organizationId, storeId, conversationId, leadId, conversationSessionId] =
    requireScope(input);
  const operationKey = clean(input.operationKey);
  const factKey = clean(input.factKey);
  const sourceMessageId = clean(input.sourceMessageId);
  const sourceMediaType = clean(input.sourceMediaType);
  const actorType = clean(input.actorType);
  const evidenceLevel = clean(input.evidenceLevel);
  const eventKind = clean(input.eventKind || "assertion");
  if (
    !operationKey ||
    !factKey ||
    !sourceMessageId ||
    input.value === null ||
    input.value === undefined ||
    !MEDIA_TYPES.has(sourceMediaType) ||
    !ACTOR_TYPES.has(actorType) ||
    !EVIDENCE_LEVELS.has(evidenceLevel) ||
    !EVENT_KINDS.has(eventKind)
  ) {
    throw new Error("COMMERCIAL_CONVERSATION_FACT_INPUT_INVALID");
  }

  const { data, error } = await args.supabase.rpc(
    WRITE_COMMERCIAL_CONVERSATION_FACT_EVENT_RPC,
    {
      p_organization_id: organizationId,
      p_store_id: storeId,
      p_conversation_id: conversationId,
      p_lead_id: leadId,
      p_conversation_session_id: conversationSessionId,
      p_commercial_session_context_link_id: nullable(input.commercialSessionContextLinkId),
      p_commercial_opportunity_id: nullable(input.commercialOpportunityId),
      p_operation_key: operationKey,
      p_fact_key: factKey,
      p_value_json: input.value,
      p_source_message_id: sourceMessageId,
      p_source_media_type: sourceMediaType,
      p_actor_type: actorType,
      p_evidence_level: evidenceLevel,
      p_event_kind: eventKind,
      p_supersedes_event_id: nullable(input.supersedesEventId),
    },
  );
  if (error) {
    throw new Error(`COMMERCIAL_CONVERSATION_FACT_WRITE_RPC_FAILED:${error.message}`);
  }
  return parseWriteResult(data);
}

function parseReadRow(value: unknown): CommercialConversationFactEvent {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const result: CommercialConversationFactEvent = {
    eventId: clean(row.event_id),
    organizationId: clean(row.organization_id),
    storeId: clean(row.store_id),
    conversationId: clean(row.conversation_id),
    leadId: clean(row.lead_id),
    conversationSessionId: clean(row.conversation_session_id),
    commercialSessionContextLinkId: nullable(row.commercial_session_context_link_id),
    commercialOpportunityId: nullable(row.commercial_opportunity_id),
    factKey: clean(row.fact_key),
    value: row.value_json,
    operationKey: clean(row.operation_key),
    eventKind: clean(row.event_kind),
    supersedesEventId: nullable(row.supersedes_event_id),
    sourceMessageId: clean(row.source_message_id),
    sourceMediaType: clean(row.source_media_type),
    actorType: clean(row.actor_type),
    evidenceLevel: clean(row.evidence_level),
    createdAt: clean(row.created_at),
    conflictState: clean(row.conflict_state) === "conflict" ? "conflict" : "consistent",
  };
  if (
    !result.eventId ||
    !result.organizationId ||
    !result.storeId ||
    !result.conversationId ||
    !result.leadId ||
    !result.conversationSessionId ||
    !result.factKey ||
    result.value === null ||
    result.value === undefined ||
    !result.operationKey ||
    !result.sourceMessageId ||
    !result.createdAt
  ) {
    throw new Error("COMMERCIAL_CONVERSATION_FACT_READ_RESPONSE_INVALID");
  }
  return result;
}

export async function readCommercialConversationFactEvents(args: {
  supabase: CommercialConversationFactRpcClient;
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string;
  conversationSessionId: string;
  commercialSessionContextLinkId?: string | null;
  commercialOpportunityId?: string | null;
}): Promise<CommercialConversationFactEvent[]> {
  const [organizationId, storeId, conversationId, leadId, conversationSessionId] =
    requireScope(args);
  const { data, error } = await args.supabase.rpc(
    READ_COMMERCIAL_CONVERSATION_FACT_EVENTS_RPC,
    {
      p_organization_id: organizationId,
      p_store_id: storeId,
      p_conversation_id: conversationId,
      p_lead_id: leadId,
      p_conversation_session_id: conversationSessionId,
      p_commercial_session_context_link_id: nullable(args.commercialSessionContextLinkId),
      p_commercial_opportunity_id: nullable(args.commercialOpportunityId),
    },
  );
  if (error) {
    throw new Error(`COMMERCIAL_CONVERSATION_FACT_READ_RPC_FAILED:${error.message}`);
  }
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows.map(parseReadRow).map((row) => {
    if (
      row.organizationId !== organizationId ||
      row.storeId !== storeId ||
      row.conversationId !== conversationId ||
      row.leadId !== leadId ||
      row.conversationSessionId !== conversationSessionId
    ) {
      throw new Error("COMMERCIAL_CONVERSATION_FACT_READ_SCOPE_MISMATCH");
    }
    return row;
  });
}
