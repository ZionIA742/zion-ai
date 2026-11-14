import { createHash } from "node:crypto";
import {
  type ContextualReconstructionSnapshot,
  type ReconstructionCommitment,
  type ReconstructionEvidenceKind,
  type ReconstructionHumanDecision,
  type ReconstructionMessageActor,
  type ReconstructionOpportunity,
  type ReconstructionProposal,
  type ReconstructionProvenance,
  type ReconstructionRelevantMessage,
  type ReconstructionReleaseOrigin,
  type ReconstructionConflict,
  validateContextualReconstructionSnapshot,
} from "./contextual-reconstruction-snapshot";

export type ContextualReconstructionRequest = {
  id: string;
  organization_id: string;
  store_id: string;
  conversation_id: string;
  takeover_event_key: string;
  release_event_key: string;
  takeover_started_at: string;
  released_at: string;
  takeover_version: string;
  status: string;
};

type QueryResult<T> = { data: T | null; error: { message: string } | null };

export type ReconstructionMessageRow = {
  id: string;
  organization_id: string;
  store_id: string;
  conversation_id: string;
  sender: string | null;
  direction: string | null;
  content: string | null;
  created_at: string;
  metadata?: unknown;
};

export type ReconstructionTransitionRow = {
  id: string;
  organization_id: string;
  store_id: string;
  conversation_id: string;
  from_state: string | null;
  to_state: string | null;
  actor_type: string | null;
  actor_user_id: string | null;
  reason: string | null;
  source: string | null;
  metadata: unknown;
  event_key: string | null;
  created_at: string;
};

export type ReconstructionOpportunityRow = {
  id: string;
  organization_id: string;
  store_id: string;
  origin_lead_id: string | null;
  primary_conversation_id: string | null;
  stage: string | null;
  lifecycle_cycle?: number | null;
  stage_changed_at?: string | null;
  updated_at?: string | null;
};

export type ReconstructionProposalRow = {
  organization_id: string;
  store_id: string;
  commercial_opportunity_id: string;
  lifecycle_cycle: number | null;
  proposal_state: string | null;
  current_quote_id: string | null;
  current_quote_version_id: string | null;
  quote_number: string | null;
  version_status: string | null;
  version_number: number | null;
  version_sent_at: string | null;
  total_cents?: number | null;
};

export type ReconstructionItemRow = {
  id: string;
  name?: string | null;
  quantity?: number | null;
  unit_price_cents?: number | null;
  total_cents?: number | null;
  created_at?: string | null;
};

export type ReconstructionCommitmentRow = {
  id: string;
  kind: "visit" | "appointment" | "follow_up" | "agreement";
  description: string;
  scheduled_at: string | null;
  organization_id: string;
  store_id: string;
  conversation_id?: string | null;
  commercial_opportunity_id?: string | null;
  status?: string | null;
};

export type ReconstructionLeaseRow = {
  organization_id: string;
  store_id: string;
  conversation_id: string;
  takeover_started_at: string;
  released_at: string | null;
  hard_hold: boolean;
};

export type ReconstructionConversationRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
  status: string | null;
  is_human_active: boolean | null;
};

export type ReconstructionReaders = {
  loadRequest: (requestId: string, organizationId: string, storeId: string) => Promise<ContextualReconstructionRequest | null>;
  loadConversation: (conversationId: string, organizationId: string) => Promise<ReconstructionConversationRow | null>;
  loadLease: (conversationId: string, organizationId: string, storeId: string) => Promise<ReconstructionLeaseRow | null>;
  loadMessagesPage: (args: { organizationId: string; storeId: string; conversationId: string; startedAt: string; endedAt: string; offset: number; limit: number }) => Promise<ReconstructionMessageRow[]>;
  loadTransitions: (args: { organizationId: string; storeId: string; conversationId: string; startedAt: string; endedAt: string }) => Promise<ReconstructionTransitionRow[]>;
  loadOpportunities: (args: { organizationId: string; storeId: string; conversationId: string; leadId: string | null }) => Promise<ReconstructionOpportunityRow[]>;
  loadQualification: (args: { organizationId: string; storeId: string; opportunityId: string }) => Promise<Record<string, unknown> | null>;
  loadProposal: (args: { organizationId: string; storeId: string; opportunityId: string }) => Promise<ReconstructionProposalRow | null>;
  loadItems: (args: { organizationId: string; storeId: string; quoteId: string }) => Promise<ReconstructionItemRow[]>;
  loadCommitments: (args: { organizationId: string; storeId: string; conversationId: string; opportunityId: string | null }) => Promise<ReconstructionCommitmentRow[]>;
};

type QueryBuilder = {
  select: (columns: string) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  gte: (column: string, value: string) => QueryBuilder;
  lte: (column: string, value: string) => QueryBuilder;
  order: (column: string, options: { ascending: boolean }) => QueryBuilder;
  range: (from: number, to: number) => Promise<QueryResult<unknown[]>>;
  maybeSingle: () => Promise<QueryResult<unknown>>;
};

type ReconstructionSupabase = {
  from: (table: string) => QueryBuilder;
  rpc: (name: string, args: Record<string, unknown>) => Promise<QueryResult<unknown>>;
};

function requiredScope(row: Record<string, unknown>, organizationId: string, storeId: string) {
  return row.organization_id === organizationId && row.store_id === storeId;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function deterministicUuid(value: string) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function provenance(source: ReconstructionProvenance["source"], sourceId: string, actor: ReconstructionProvenance["actor"], observedAt: string): ReconstructionProvenance {
  return { source, sourceId, actor, observedAt };
}

function messageActor(row: ReconstructionMessageRow): ReconstructionMessageActor {
  const sender = String(row.sender || "").toLowerCase();
  if (sender.includes("ai") || sender.includes("assistant") || sender.includes("bot")) return "ai";
  if (String(row.direction || "").toLowerCase() === "outgoing") return "human";
  if (sender === "user" || String(row.direction || "").toLowerCase() === "inbound") return "customer";
  return "system";
}

function evidenceForMessage(actor: ReconstructionMessageActor): ReconstructionEvidenceKind {
  if (actor === "human") return "human_correction";
  if (actor === "ai") return "inference";
  return "confirmed";
}

function mapMessage(row: ReconstructionMessageRow): ReconstructionRelevantMessage {
  const actor = messageActor(row);
  return {
    id: row.id,
    actor,
    content: String(row.content || ""),
    createdAt: row.created_at,
    evidence: evidenceForMessage(actor),
    provenance: provenance("message", row.id, actor, row.created_at),
  };
}

function mapHumanDecisions(transitions: ReconstructionTransitionRow[], messages: ReconstructionRelevantMessage[]): ReconstructionHumanDecision[] {
  const decisions: ReconstructionHumanDecision[] = transitions
    .filter((row) => row.actor_type === "human" && row.to_state)
    .map((row) => ({
      id: row.id,
      decision: row.reason || `estado=${row.to_state}`,
      evidence: "human_correction" as const,
      provenance: provenance("state_transition", row.event_key || row.id, "human", row.created_at) as ReconstructionHumanDecision["provenance"],
    }));
  for (const message of messages.filter((row) => row.actor === "human")) {
    decisions.push({
      id: message.id,
      decision: message.content,
      evidence: "human_correction",
      provenance: provenance("message", message.id, "human", message.provenance.observedAt) as ReconstructionHumanDecision["provenance"],
    });
  }
  return decisions;
}

function opportunityEvidence(row: ReconstructionOpportunityRow): ReconstructionOpportunity {
  return {
    id: row.id,
    stage: row.stage,
    lifecycleCycle: row.lifecycle_cycle ?? null,
    evidence: "confirmed",
    provenance: provenance("crm", row.id, "system", row.updated_at || row.stage_changed_at || new Date(0).toISOString()),
  };
}

function mapProposal(row: ReconstructionProposalRow): ReconstructionProposal | null {
  if (!row.current_quote_id || !row.current_quote_version_id) return null;
  return {
    id: row.current_quote_id,
    versionId: row.current_quote_version_id,
    totalValue: row.total_cents == null ? null : row.total_cents / 100,
    currency: "BRL",
    evidence: "confirmed",
    provenance: provenance("proposal", row.current_quote_version_id, "system", row.version_sent_at || new Date(0).toISOString()),
  };
}

function mapCommitments(rows: ReconstructionCommitmentRow[]): ReconstructionCommitment[] {
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    description: row.description,
    scheduledAt: row.scheduled_at,
    evidence: "confirmed" as const,
    provenance: provenance("appointment", row.id, "system", row.scheduled_at || new Date(0).toISOString()),
  }));
}

function conflict(id: string, field: string, description: string, sourceId: string, observedAt: string): ReconstructionConflict {
  return {
    id,
    field,
    description,
    sources: [provenance("system", sourceId, "system", observedAt)],
    blocksAutomaticContinuation: true,
  };
}

export function createContextualReconstructionReaders(supabase: ReconstructionSupabase): ReconstructionReaders {
  return {
    async loadRequest(requestId, organizationId, storeId) {
      const result = await supabase.from("p9_contextual_reconstruction_requests").select("*").eq("id", requestId).eq("organization_id", organizationId).eq("store_id", storeId).maybeSingle();
      if (result.error || !result.data) return null;
      const row = result.data as ContextualReconstructionRequest;
      return row.organization_id === organizationId && row.store_id === storeId ? row : null;
    },
    async loadConversation(conversationId, organizationId) {
      const result = await supabase.from("conversations").select("id, organization_id, lead_id, status, is_human_active").eq("id", conversationId).eq("organization_id", organizationId).maybeSingle();
      return result.error ? null : result.data as ReconstructionConversationRow | null;
    },
    async loadLease(conversationId, organizationId, storeId) {
      const result = await supabase.from("conversation_human_takeover_leases").select("organization_id, store_id, conversation_id, takeover_started_at, released_at, hard_hold").eq("conversation_id", conversationId).eq("organization_id", organizationId).eq("store_id", storeId).maybeSingle();
      return result.error ? null : result.data as ReconstructionLeaseRow | null;
    },
    async loadMessagesPage(args) {
      const result = await supabase.from("messages").select("id, organization_id, store_id, conversation_id, sender, direction, content, created_at, metadata").eq("organization_id", args.organizationId).eq("store_id", args.storeId).eq("conversation_id", args.conversationId).gte("created_at", args.startedAt).lte("created_at", args.endedAt).order("created_at", { ascending: true }).range(args.offset, args.offset + args.limit - 1);
      return result.error ? [] : result.data as ReconstructionMessageRow[] || [];
    },
    async loadTransitions(args) {
      const result = await supabase.from("state_transition_log").select("id, organization_id, store_id, conversation_id, from_state, to_state, actor_type, actor_user_id, reason, source, metadata, event_key, created_at").eq("organization_id", args.organizationId).eq("store_id", args.storeId).eq("conversation_id", args.conversationId).gte("created_at", args.startedAt).lte("created_at", args.endedAt).order("created_at", { ascending: true }).range(0, 9999);
      return result.error ? [] : result.data as ReconstructionTransitionRow[] || [];
    },
    async loadOpportunities(args) {
      const result = await supabase.from("commercial_opportunities").select("id, organization_id, store_id, origin_lead_id, primary_conversation_id, stage, lifecycle_cycle, stage_changed_at, updated_at").eq("organization_id", args.organizationId).eq("store_id", args.storeId).range(0, 9999);
      if (result.error) return [];
      return (result.data as ReconstructionOpportunityRow[] || []).filter((row) => row.primary_conversation_id === args.conversationId || (args.leadId && row.origin_lead_id === args.leadId));
    },
    async loadQualification(args) {
      const result = await supabase.rpc("read_commercial_opportunity_qualification_facts_by_system", { p_organization_id: args.organizationId, p_store_id: args.storeId, p_commercial_opportunity_id: args.opportunityId });
      return result.error ? null : asRecord(Array.isArray(result.data) ? result.data[0] : result.data);
    },
    async loadProposal(args) {
      const result = await supabase.rpc("read_current_commercial_proposal_by_system", { p_organization_id: args.organizationId, p_store_id: args.storeId, p_commercial_opportunity_id: args.opportunityId });
      if (result.error) return null;
      const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
      if (rows.length !== 1) return null;
      const proposal = rows[0] as ReconstructionProposalRow;
      if (!proposal.current_quote_id) return proposal;
      const quoteResult = await supabase.from("sales_quotes").select("total_cents").eq("id", proposal.current_quote_id).eq("organization_id", args.organizationId).eq("store_id", args.storeId).maybeSingle();
      const quote = asRecord(quoteResult.data);
      return { ...proposal, total_cents: typeof quote?.total_cents === "number" ? quote.total_cents : null };
    },
    async loadItems(args) {
      const result = await supabase.from("sales_quote_items").select("*").eq("quote_id", args.quoteId).eq("organization_id", args.organizationId).eq("store_id", args.storeId).order("sort_order", { ascending: true }).range(0, 9999);
      return result.error ? [] : result.data as ReconstructionItemRow[] || [];
    },
    async loadCommitments(args) {
      const result = await supabase.from("store_appointments").select("id, appointment_type, title, scheduled_start, organization_id, store_id, commercial_opportunity_id, status").eq("organization_id", args.organizationId).eq("store_id", args.storeId).eq("commercial_opportunity_id", args.opportunityId).order("scheduled_start", { ascending: true }).range(0, 9999);
      if (result.error) return [];
      return (result.data as Array<Record<string, unknown>> || []).map((row) => ({
        id: String(row.id),
        kind: "appointment" as const,
        description: String(row.title || row.appointment_type || "compromisso"),
        scheduled_at: row.scheduled_start as string | null,
        organization_id: String(row.organization_id),
        store_id: String(row.store_id),
        commercial_opportunity_id: row.commercial_opportunity_id as string | null,
        status: row.status as string | null,
      }));
    },
  };
}

export type ContextualReconstructionAggregationResult =
  | { ok: true; snapshot: ContextualReconstructionSnapshot }
  | { ok: false; reason: string; details?: string; snapshot?: ContextualReconstructionSnapshot };

export async function aggregateContextualReconstructionSnapshot(args: {
  readers: ReconstructionReaders;
  requestId: string;
  organizationId: string;
  storeId: string;
  pageSize?: number;
}): Promise<ContextualReconstructionAggregationResult> {
  const request = await args.readers.loadRequest(args.requestId, args.organizationId, args.storeId);
  if (!request) return { ok: false, reason: "reconstruction_request_not_found" };
  if (["obsolete", "failed_final"].includes(request.status)) return { ok: false, reason: "reconstruction_request_terminal" };
  if (request.organization_id !== args.organizationId || request.store_id !== args.storeId) return { ok: false, reason: "reconstruction_request_scope_mismatch" };

  const [conversation, lease] = await Promise.all([
    args.readers.loadConversation(request.conversation_id, args.organizationId),
    args.readers.loadLease(request.conversation_id, args.organizationId, args.storeId),
  ]);
  if (!conversation || conversation.organization_id !== args.organizationId) return { ok: false, reason: "conversation_scope_mismatch" };
  if (!lease || lease.organization_id !== args.organizationId || lease.store_id !== args.storeId || lease.conversation_id !== request.conversation_id) return { ok: false, reason: "lease_scope_mismatch" };
  if (!Number.isFinite(Date.parse(lease.takeover_started_at)) || !Number.isFinite(Date.parse(request.takeover_started_at)) || !Number.isFinite(Date.parse(request.takeover_version)) || Date.parse(lease.takeover_started_at) !== Date.parse(request.takeover_started_at) || Date.parse(lease.takeover_started_at) !== Date.parse(request.takeover_version) || lease.released_at === null || lease.hard_hold || conversation.status === "humano_assumiu" || conversation.is_human_active) return { ok: false, reason: "takeover_context_no_longer_current" };
  if (!request.takeover_started_at || !request.released_at || Date.parse(request.takeover_started_at) > Date.parse(request.released_at)) return { ok: false, reason: "takeover_interval_invalid" };

  const pageSize = Math.min(500, Math.max(1, args.pageSize || 100));
  const messages: ReconstructionMessageRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await args.readers.loadMessagesPage({ organizationId: args.organizationId, storeId: args.storeId, conversationId: request.conversation_id, startedAt: request.takeover_started_at, endedAt: request.released_at, offset, limit: pageSize });
    messages.push(...page);
    if (page.length < pageSize) break;
  }
  if (messages.some((row) => row.organization_id !== args.organizationId || row.store_id !== args.storeId || row.conversation_id !== request.conversation_id)) return { ok: false, reason: "message_scope_mismatch" };

  const transitions = await args.readers.loadTransitions({ organizationId: args.organizationId, storeId: args.storeId, conversationId: request.conversation_id, startedAt: request.takeover_started_at, endedAt: request.released_at });
  if (transitions.some((row) => !requiredScope(row as unknown as Record<string, unknown>, args.organizationId, args.storeId) || row.conversation_id !== request.conversation_id)) return { ok: false, reason: "transition_scope_mismatch" };

  const opportunities = (await args.readers.loadOpportunities({ organizationId: args.organizationId, storeId: args.storeId, conversationId: request.conversation_id, leadId: conversation.lead_id })).filter((row) => row.organization_id === args.organizationId && row.store_id === args.storeId);
  const opportunityCandidates = opportunities.map(opportunityEvidence);
  const opportunityStatus = opportunityCandidates.length === 0 ? "missing" : opportunityCandidates.length === 1 ? "resolved" : "ambiguous";
  const selectedOpportunity = opportunityStatus === "resolved" ? opportunityCandidates[0] : null;
  const conflicts: ReconstructionConflict[] = [];
  if (opportunityStatus === "missing") conflicts.push(conflict("opportunity-missing", "opportunity", "Nenhuma oportunidade compatível foi encontrada.", request.id, request.released_at));
  if (opportunityStatus === "ambiguous") conflicts.push(conflict("opportunity-ambiguous", "opportunity", "Mais de uma oportunidade compatível; nenhuma foi selecionada.", request.id, request.released_at));

  const qualification = selectedOpportunity ? await args.readers.loadQualification({ organizationId: args.organizationId, storeId: args.storeId, opportunityId: selectedOpportunity.id }) : null;
  if (selectedOpportunity && !qualification) conflicts.push(conflict("qualification-missing", "commercialFacts", "Fatos canônicos de qualificação indisponíveis.", selectedOpportunity.id, request.released_at));
  const proposalRow = selectedOpportunity ? await args.readers.loadProposal({ organizationId: args.organizationId, storeId: args.storeId, opportunityId: selectedOpportunity.id }) : null;
  if (selectedOpportunity && !proposalRow) conflicts.push(conflict("proposal-missing", "currentProposal", "Proposta vigente inequívoca indisponível.", selectedOpportunity.id, request.released_at));
  const proposal = proposalRow ? mapProposal(proposalRow) : null;
  const items = proposalRow?.current_quote_id ? await args.readers.loadItems({ organizationId: args.organizationId, storeId: args.storeId, quoteId: proposalRow.current_quote_id }) : [];
  const commitments = selectedOpportunity ? mapCommitments(await args.readers.loadCommitments({ organizationId: args.organizationId, storeId: args.storeId, conversationId: request.conversation_id, opportunityId: selectedOpportunity.id })) : [];

  const relevantMessages = messages.map(mapMessage);
  const customerMessages = messages.filter((row) => messageActor(row) === "customer");
  const anchorRow = customerMessages[customerMessages.length - 1] || null;
  if (!anchorRow) conflicts.push(conflict("anchor-missing", "anchor", "Nenhuma mensagem de cliente foi encontrada no intervalo do takeover.", request.id, request.released_at));
  const releaseOrigin: ReconstructionReleaseOrigin = request.release_event_key.includes("timeout") || request.release_event_key.includes("expiration") ? "lease_expiration" : "human_release";
  const eventId = deterministicUuid(`request:${request.id}`);
  const snapshot: ContextualReconstructionSnapshot = {
    scope: { organizationId: args.organizationId, storeId: args.storeId, conversationId: request.conversation_id },
    event: { id: eventId, type: releaseOrigin === "lease_expiration" ? "human_takeover_expired" : "human_takeover_released", occurredAt: request.released_at, origin: releaseOrigin },
    takeover: { startedAt: request.takeover_started_at, endedAt: request.released_at, takeoverEventId: deterministicUuid(`takeover:${request.takeover_event_key}`), releaseEventId: deterministicUuid(`release:${request.release_event_key}`) },
    releaseOrigin,
    crmStage: { value: selectedOpportunity?.stage || null, kind: selectedOpportunity ? "confirmed" : "obsolete", provenance: provenance("crm", selectedOpportunity?.id || request.id, "system", request.released_at), observedAt: request.released_at },
    relevantMessages,
    humanDecisions: mapHumanDecisions(transitions, relevantMessages),
    commercialFacts: qualification ? [{ value: qualification, kind: "confirmed", provenance: provenance("crm", selectedOpportunity?.id || request.id, "system", request.released_at), observedAt: request.released_at }] : [],
    opportunity: { status: opportunityStatus, candidates: opportunityCandidates, selected: selectedOpportunity },
    currentProposal: proposal,
    products: items.map((item) => ({ id: item.id, name: item.name || null, quantity: item.quantity ?? null, unitValue: item.unit_price_cents == null ? null : item.unit_price_cents / 100, totalValue: item.total_cents == null ? null : item.total_cents / 100, evidence: "confirmed" as const, provenance: provenance("proposal", item.id, "system", item.created_at || request.released_at) })),
    commitments,
    anchor: anchorRow ? { messageId: anchorRow.id, conversationId: request.conversation_id, organizationId: args.organizationId, storeId: args.storeId, capturedAt: anchorRow.created_at, version: 1 } : null,
    conflicts,
    completeness: conflicts.length ? "blocked" : "complete",
    ambiguity: opportunityStatus === "ambiguous" || conflicts.length > 0,
    automaticMessaging: "forbidden",
  };
  const validation = validateContextualReconstructionSnapshot(snapshot);
  if (!validation.ok) return { ok: false, reason: "snapshot_validation_failed", details: validation.issues.map((issue) => `${issue.path}:${issue.code}`).join(",") };
  if (conflicts.length > 0) return { ok: false, reason: "context_incomplete_or_ambiguous", details: conflicts.map((item) => item.id).join(",") , snapshot };
  return { ok: true, snapshot };
}

