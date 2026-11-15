/**
 * Contrato puro da 10.5-A.
 *
 * Este módulo descreve contexto; não concede autorização para gerar, persistir
 * ou enviar mensagens. A literal `automaticMessaging: "forbidden"` é
 * intencionalmente parte do contrato para impedir que uma reconstrução seja
 * confundida com um comando de execução.
 */

export type ReconstructionEvidenceKind =
  | "confirmed"
  | "human_correction"
  | "inference"
  | "uncertain"
  | "obsolete";

export type ReconstructionCompleteness = "complete" | "partial" | "blocked";

export type ReconstructionOpportunityStatus =
  | "resolved"
  | "missing"
  | "ambiguous"
  | "stale";

export type ReconstructionReleaseOrigin =
  | "human_release"
  | "lease_expiration"
  | "system_recovery";

export type ReconstructionDecisionDomain =
  | "opportunity"
  | "crm_stage"
  | "commercial_facts"
  | "proposal"
  | "products"
  | "commitments";

export const RECONSTRUCTION_DOMAIN_FIELDS: Record<ReconstructionDecisionDomain, readonly string[]> = {
  opportunity: ["selected_opportunity"],
  crm_stage: ["stage"],
  commercial_facts: ["qualification_fact"],
  proposal: ["proposal", "total_value", "currency", "version"],
  products: ["product", "quantity", "unit_value", "total_value"],
  commitments: ["commitment", "scheduled_at", "description"],
};

export type ReconstructionMessageActor = "customer" | "human" | "ai" | "system" | "uncertain";

export type ReconstructionProvenance = {
  source: "message" | "state_transition" | "crm" | "proposal" | "catalog" | "appointment" | "system";
  sourceId: string;
  actor: ReconstructionMessageActor | "system";
  actorId?: string | null;
  observedAt: string;
};

export type ReconstructionCommercialFactKey =
  | "need_summary"
  | "interested_product_reference"
  | "space_text"
  | "requested_area_m2"
  | "location_text"
  | "customer_address_text"
  | "customer_city"
  | "customer_state_code"
  | "preferred_period_text"
  | "budget_text"
  | "decision_context"
  | "installation_interest"
  | "payment_interest"
  | "technical_visit_interest"
  | "measurements_confirmation_required"
  | "customer_preferences_text"
  | "relevant_objection_text";

export type ReconstructionCommercialFact = {
  organizationId: string;
  storeId: string;
  opportunityId: string;
  factKey: ReconstructionCommercialFactKey;
  state: "confirmed" | "inferred";
  valueKind: "text" | "number" | "boolean";
  value: string | number | boolean;
  normalizedValueText: string | null;
  sourceType: "incoming_customer_message" | "crm_manual" | "system_inference" | "system_correction" | "migration_backfill";
  sourceMessageId: string | null;
  sourceConversationId: string | null;
  lastEventId: string;
  lastOperationKey: string;
  updatedAt: string;
  provenance: ReconstructionProvenance;
};

export type ReconstructionHumanAuthorityProof = {
  kind: "canonical_state_transition";
  sourceId: string;
  actorId: string;
  organizationId: string;
  storeId: string;
  conversationId: string;
  opportunityId: string | null;
};

export type ReconstructionEvidence<T> = {
  value: T;
  kind: ReconstructionEvidenceKind;
  provenance: ReconstructionProvenance;
  observedAt: string;
};

export type ReconstructionTenantScope = {
  organizationId: string;
  storeId: string;
  conversationId: string;
};

export type ReconstructionTakeoverInterval = {
  startedAt: string;
  endedAt: string;
  takeoverEventId: string;
  releaseEventId: string;
  takeoverEventKey: string;
  releaseEventKey: string;
};

export type ReconstructionEvent = {
  id: string;
  type: "human_takeover_released" | "human_takeover_expired";
  occurredAt: string;
  origin: ReconstructionReleaseOrigin;
};

export type ReconstructionRelevantMessage = {
  id: string;
  actor: ReconstructionMessageActor;
  content: string | null;
  createdAt: string;
  evidence: ReconstructionEvidenceKind;
  provenance: ReconstructionProvenance;
};

export type ReconstructionHumanDecision = {
  id: string;
  decision: string | null;
  evidence: "human_correction" | "confirmed";
  /** Decisões sem domínio/campo não podem ser aplicadas pelo resolvedor. */
  domain?: ReconstructionDecisionDomain;
  field?: string | null;
  authorityProof?: ReconstructionHumanAuthorityProof | null;
  provenance: ReconstructionProvenance & {
    source: "message" | "state_transition" | "crm";
    actor: "human";
  };
};

export type ReconstructionOpportunity = {
  id: string;
  organizationId: string;
  storeId: string;
  stage: string | null;
  lifecycleCycle: number | null;
  evidence: ReconstructionEvidenceKind;
  provenance: ReconstructionProvenance;
};

export type ReconstructionOpportunityResolution = {
  status: ReconstructionOpportunityStatus;
  candidates: ReconstructionOpportunity[];
  selected: ReconstructionOpportunity | null;
};

export type ReconstructionProposal = {
  id: string;
  versionId: string;
  organizationId: string;
  storeId: string;
  opportunityId: string;
  totalValue: number | null;
  currency: string | null;
  evidence: ReconstructionEvidenceKind;
  provenance: ReconstructionProvenance;
};

export type ReconstructionProduct = {
  id: string;
  organizationId: string;
  storeId: string;
  quoteId: string;
  name: string | null;
  quantity: number | null;
  unitValue: number | null;
  totalValue: number | null;
  evidence: ReconstructionEvidenceKind;
  provenance: ReconstructionProvenance;
};

export type ReconstructionCommitment = {
  id: string;
  organizationId: string;
  storeId: string;
  conversationId: string;
  opportunityId: string;
  kind: "visit" | "appointment" | "follow_up" | "agreement";
  description: string | null;
  scheduledAt: string | null;
  evidence: ReconstructionEvidenceKind;
  provenance: ReconstructionProvenance;
};

export type ReconstructionAnchor = {
  messageId: string;
  conversationId: string;
  organizationId: string;
  storeId: string;
  capturedAt: string;
  version: number;
};

export type ReconstructionConflict = {
  id: string;
  field: string;
  description: string;
  sources: ReconstructionProvenance[];
  blocksAutomaticContinuation: boolean;
  details?: Record<string, unknown>;
};

export type ContextualReconstructionSnapshot = {
  scope: ReconstructionTenantScope;
  event: ReconstructionEvent;
  takeover: ReconstructionTakeoverInterval;
  releaseOrigin: ReconstructionReleaseOrigin;
  crmStage: ReconstructionEvidence<string | null>;
  relevantMessages: ReconstructionRelevantMessage[];
  humanDecisions: ReconstructionHumanDecision[];
  commercialFacts: ReconstructionCommercialFact[];
  opportunity: ReconstructionOpportunityResolution;
  currentProposal: ReconstructionProposal | null;
  products: ReconstructionProduct[];
  commitments: ReconstructionCommitment[];
  anchor: ReconstructionAnchor | null;
  conflicts: ReconstructionConflict[];
  completeness: ReconstructionCompleteness;
  ambiguity: boolean;
  /** Contexto nunca autoriza geração ou envio automático. */
  automaticMessaging: "forbidden";
};

export type SnapshotValidationIssue = {
  path: string;
  code:
    | "required"
    | "invalid_uuid"
    | "invalid_enum"
    | "invalid_timestamp"
    | "interval_order"
    | "scope_mismatch"
    | "invalid_ambiguity"
    | "invalid_opportunity_resolution"
    | "missing_provenance"
    | "automatic_messaging_forbidden";
};

export type SnapshotValidationResult =
  | { ok: true; snapshot: ContextualReconstructionSnapshot }
  | { ok: false; issues: SnapshotValidationIssue[] };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function isTimestamp(value: string) {
  return value.trim() !== "" && Number.isFinite(Date.parse(value));
}

function expectedFactValueKind(factKey: ReconstructionCommercialFactKey): ReconstructionCommercialFact["valueKind"] {
  if (factKey === "requested_area_m2") return "number";
  if (["installation_interest", "payment_interest", "technical_visit_interest", "measurements_confirmation_required"].includes(factKey)) return "boolean";
  return "text";
}

function isFactKey(value: unknown): value is ReconstructionCommercialFactKey {
  return typeof value === "string" && [
    "need_summary", "interested_product_reference", "space_text", "requested_area_m2", "location_text",
    "customer_address_text", "customer_city", "customer_state_code", "preferred_period_text", "budget_text",
    "decision_context", "installation_interest", "payment_interest", "technical_visit_interest",
    "measurements_confirmation_required", "customer_preferences_text", "relevant_objection_text",
  ].includes(value);
}

function addScopeIssue(issues: SnapshotValidationIssue[], path: string, value: string, expected: string) {
  if (value !== expected) issues.push({ path, code: "scope_mismatch" });
}

function validateProvenance(
  issues: SnapshotValidationIssue[],
  provenance: ReconstructionProvenance | null | undefined,
  path: string,
) {
  const validSources = new Set(["message", "state_transition", "crm", "proposal", "catalog", "appointment", "system"]);
  const validActors = new Set(["customer", "human", "ai", "system", "uncertain"]);
  if (!provenance || !provenance.sourceId.trim() || !validSources.has(provenance.source) || !validActors.has(provenance.actor)
    || !isTimestamp(provenance.observedAt)) {
    issues.push({ path, code: "missing_provenance" });
  }
}

export function validateContextualReconstructionSnapshot(
  snapshot: ContextualReconstructionSnapshot,
): SnapshotValidationResult {
  const issues: SnapshotValidationIssue[] = [];
  const scope = snapshot.scope;

  for (const [path, value] of Object.entries(scope)) {
    if (!value) issues.push({ path: `scope.${path}`, code: "required" });
    else if (!isUuid(value)) issues.push({ path: `scope.${path}`, code: "invalid_uuid" });
  }

  if (!isUuid(snapshot.event.id)) issues.push({ path: "event.id", code: "invalid_uuid" });
  if (!isTimestamp(snapshot.event.occurredAt)) issues.push({ path: "event.occurredAt", code: "invalid_timestamp" });
  if (!isUuid(snapshot.takeover.takeoverEventId)) issues.push({ path: "takeover.takeoverEventId", code: "invalid_uuid" });
  if (!isUuid(snapshot.takeover.releaseEventId)) issues.push({ path: "takeover.releaseEventId", code: "invalid_uuid" });
  if (!isTimestamp(snapshot.takeover.startedAt)) issues.push({ path: "takeover.startedAt", code: "invalid_timestamp" });
  if (!isTimestamp(snapshot.takeover.endedAt)) issues.push({ path: "takeover.endedAt", code: "invalid_timestamp" });
  if (!snapshot.takeover.takeoverEventKey || !snapshot.takeover.releaseEventKey) {
    issues.push({ path: "takeover.eventKeys", code: "required" });
  }

  if (isTimestamp(snapshot.takeover.startedAt) && isTimestamp(snapshot.takeover.endedAt)
    && Date.parse(snapshot.takeover.endedAt) < Date.parse(snapshot.takeover.startedAt)) {
    issues.push({ path: "takeover", code: "interval_order" });
  }

  if (snapshot.automaticMessaging !== "forbidden") {
    issues.push({ path: "automaticMessaging", code: "automatic_messaging_forbidden" });
  }

  const validReleaseOrigins = new Set(["human_release", "lease_expiration", "system_recovery"]);
  const validEventTypes = new Set(["human_takeover_released", "human_takeover_expired"]);
  if (!validReleaseOrigins.has(snapshot.releaseOrigin)) issues.push({ path: "releaseOrigin", code: "invalid_enum" });
  if (!validEventTypes.has(snapshot.event.type)) issues.push({ path: "event.type", code: "invalid_enum" });

  validateProvenance(issues, snapshot.crmStage.provenance, "crmStage.provenance");
  for (const [index, message] of snapshot.relevantMessages.entries()) {
    if (!isUuid(message.id)) issues.push({ path: `relevantMessages.${index}.id`, code: "invalid_uuid" });
    validateProvenance(issues, message.provenance, `relevantMessages.${index}.provenance`);
    if (!isTimestamp(message.createdAt)) issues.push({ path: `relevantMessages.${index}.createdAt`, code: "invalid_timestamp" });
    if (message.actor === "human" && !message.provenance.actorId) issues.push({ path: `relevantMessages.${index}.provenance.actorId`, code: "missing_provenance" });
  }

  for (const [index, decision] of snapshot.humanDecisions.entries()) {
    if (!isUuid(decision.id)) issues.push({ path: `humanDecisions.${index}.id`, code: "invalid_uuid" });
    validateProvenance(issues, decision.provenance, `humanDecisions.${index}.provenance`);
    if (decision.provenance.actor !== "human" || !decision.provenance.actorId) issues.push({ path: `humanDecisions.${index}.provenance.actor`, code: "missing_provenance" });
    if (!decision.decision || !decision.decision.trim()) issues.push({ path: `humanDecisions.${index}.decision`, code: "required" });
    if (decision.domain !== undefined && !Object.prototype.hasOwnProperty.call(RECONSTRUCTION_DOMAIN_FIELDS, decision.domain)) {
      issues.push({ path: `humanDecisions.${index}.domain`, code: "invalid_enum" });
    }
    if (decision.domain !== undefined && !decision.field?.trim()) issues.push({ path: `humanDecisions.${index}.field`, code: "required" });
    if (decision.domain !== undefined && decision.field && !RECONSTRUCTION_DOMAIN_FIELDS[decision.domain]?.includes(decision.field)) {
      issues.push({ path: `humanDecisions.${index}.field`, code: "invalid_enum" });
    }
    if (decision.authorityProof) {
      const proof = decision.authorityProof;
      if (proof.kind !== "canonical_state_transition"
        || !isUuid(proof.actorId) || !isUuid(proof.organizationId) || !isUuid(proof.storeId)
        || !isUuid(proof.conversationId) || (proof.opportunityId !== null && !isUuid(proof.opportunityId))) {
        issues.push({ path: `humanDecisions.${index}.authorityProof`, code: "missing_provenance" });
      }
      if (proof.sourceId !== decision.provenance.sourceId || proof.actorId !== decision.provenance.actorId
        || proof.organizationId !== scope.organizationId || proof.storeId !== scope.storeId
        || proof.conversationId !== scope.conversationId) {
        issues.push({ path: `humanDecisions.${index}.authorityProof`, code: "scope_mismatch" });
      }
    }
  }

  for (const [index, fact] of snapshot.commercialFacts.entries()) {
    validateProvenance(issues, fact.provenance, `commercialFacts.${index}.provenance`);
    const expectedKind = isFactKey(fact.factKey) ? expectedFactValueKind(fact.factKey) : null;
    if (!isUuid(fact.organizationId) || !isUuid(fact.storeId) || !isUuid(fact.opportunityId)
      || fact.organizationId !== scope.organizationId || fact.storeId !== scope.storeId
      || snapshot.opportunity.status !== "resolved" || snapshot.opportunity.selected?.id !== fact.opportunityId
      || !expectedKind || fact.valueKind !== expectedKind
      || (expectedKind === "text" && (typeof fact.value !== "string" || !fact.value.trim() || !fact.normalizedValueText?.trim()))
      || (expectedKind === "number" && (typeof fact.value !== "number" || !Number.isFinite(fact.value)))
      || (expectedKind === "boolean" && typeof fact.value !== "boolean")
      || !fact.lastOperationKey.trim() || !isUuid(fact.lastEventId) || !isTimestamp(fact.updatedAt)
      || (fact.sourceType === "incoming_customer_message"
        && (!isUuid(fact.sourceMessageId) || fact.sourceConversationId !== scope.conversationId))) {
      issues.push({ path: `commercialFacts.${index}`, code: "required" });
    }
  }

  const opportunity = snapshot.opportunity;
  if (opportunity.status === "resolved" && !opportunity.selected) {
    issues.push({ path: "opportunity.selected", code: "invalid_opportunity_resolution" });
  }
  if (opportunity.status === "ambiguous" && opportunity.selected) {
    issues.push({ path: "opportunity.selected", code: "invalid_opportunity_resolution" });
  }
  if (opportunity.status === "ambiguous" && opportunity.candidates.length < 2) {
    issues.push({ path: "opportunity.candidates", code: "invalid_opportunity_resolution" });
  }
  if (opportunity.status === "missing" && (opportunity.selected || opportunity.candidates.length > 0)) {
    issues.push({ path: "opportunity", code: "invalid_opportunity_resolution" });
  }
  for (const [index, candidate] of opportunity.candidates.entries()) {
    if (!isUuid(candidate.id) || !isUuid(candidate.organizationId) || !isUuid(candidate.storeId)) {
      issues.push({ path: `opportunity.candidates.${index}`, code: "invalid_uuid" });
    }
    addScopeIssue(issues, `opportunity.candidates.${index}.organizationId`, candidate.organizationId, scope.organizationId);
    addScopeIssue(issues, `opportunity.candidates.${index}.storeId`, candidate.storeId, scope.storeId);
    validateProvenance(issues, candidate.provenance, `opportunity.candidates.${index}.provenance`);
  }
  if (opportunity.selected) {
    if (!opportunity.candidates.some((candidate) => candidate.id === opportunity.selected?.id)) {
      issues.push({ path: "opportunity.selected", code: "invalid_opportunity_resolution" });
    }
  }
  for (const [index, decision] of snapshot.humanDecisions.entries()) {
    if (decision.authorityProof?.opportunityId !== null && decision.authorityProof?.opportunityId !== undefined
      && (!opportunity.selected || decision.authorityProof.opportunityId !== opportunity.selected.id)) {
      issues.push({ path: `humanDecisions.${index}.authorityProof.opportunityId`, code: "scope_mismatch" });
    }
  }

  if (snapshot.currentProposal) {
    validateProvenance(issues, snapshot.currentProposal.provenance, "currentProposal.provenance");
    if (!isUuid(snapshot.currentProposal.id) || !isUuid(snapshot.currentProposal.versionId)) {
      issues.push({ path: "currentProposal", code: "invalid_uuid" });
    }
    if (!snapshot.currentProposal.currency || snapshot.currentProposal.totalValue == null || !Number.isFinite(snapshot.currentProposal.totalValue) || snapshot.currentProposal.totalValue < 0) {
      issues.push({ path: "currentProposal", code: "required" });
    }
    if (!isUuid(snapshot.currentProposal.organizationId) || !isUuid(snapshot.currentProposal.storeId) || !isUuid(snapshot.currentProposal.opportunityId)
      || snapshot.currentProposal.organizationId !== scope.organizationId || snapshot.currentProposal.storeId !== scope.storeId
      || snapshot.opportunity.status !== "resolved"
      || !snapshot.opportunity.selected
      || snapshot.opportunity.selected.id !== snapshot.currentProposal.opportunityId
      || !snapshot.opportunity.candidates.some((candidate) => candidate.id === snapshot.currentProposal?.opportunityId)) {
      issues.push({ path: "currentProposal", code: "scope_mismatch" });
    }
  }

  for (const [index, product] of snapshot.products.entries()) {
    validateProvenance(issues, product.provenance, `products.${index}.provenance`);
    if (!isUuid(product.id) || !isUuid(product.organizationId) || !isUuid(product.storeId) || !isUuid(product.quoteId)
      || product.organizationId !== scope.organizationId || product.storeId !== scope.storeId
      || !snapshot.currentProposal || product.quoteId !== snapshot.currentProposal.id
      || (product.name == null) || product.quantity == null || product.unitValue == null || product.totalValue == null
      || !Number.isFinite(product.quantity) || !Number.isFinite(product.unitValue) || !Number.isFinite(product.totalValue)
      || product.quantity < 0 || product.unitValue < 0 || product.totalValue < 0) {
      issues.push({ path: `products.${index}`, code: "required" });
    }
  }
  for (const [index, commitment] of snapshot.commitments.entries()) {
    validateProvenance(issues, commitment.provenance, `commitments.${index}.provenance`);
    if (!isUuid(commitment.id) || !isUuid(commitment.organizationId) || !isUuid(commitment.storeId) || !isUuid(commitment.conversationId) || !isUuid(commitment.opportunityId)
      || commitment.organizationId !== scope.organizationId || commitment.storeId !== scope.storeId || commitment.conversationId !== scope.conversationId
      || !snapshot.opportunity.selected || commitment.opportunityId !== snapshot.opportunity.selected.id
      || !commitment.description || !commitment.scheduledAt || !isTimestamp(commitment.scheduledAt)) {
      issues.push({ path: `commitments.${index}`, code: "required" });
    }
  }
  for (const [index, conflict] of snapshot.conflicts.entries()) {
    if (!conflict.sources.length) issues.push({ path: `conflicts.${index}.sources`, code: "missing_provenance" });
    conflict.sources.forEach((source, sourceIndex) => validateProvenance(issues, source, `conflicts.${index}.sources.${sourceIndex}`));
  }

  if (snapshot.ambiguity !== (opportunity.status === "ambiguous" || snapshot.conflicts.length > 0)) {
    issues.push({ path: "ambiguity", code: "invalid_ambiguity" });
  }
  if (snapshot.event.origin !== snapshot.releaseOrigin
    || (snapshot.event.type === "human_takeover_expired" && snapshot.releaseOrigin !== "lease_expiration")
    || (snapshot.event.type === "human_takeover_released" && snapshot.releaseOrigin === "lease_expiration")
    || snapshot.event.occurredAt !== snapshot.takeover.endedAt) {
    issues.push({ path: "event", code: "invalid_opportunity_resolution" });
  }
  if (snapshot.completeness === "complete" && (snapshot.ambiguity || snapshot.conflicts.some((item) => item.blocksAutomaticContinuation))) {
    issues.push({ path: "completeness", code: "invalid_ambiguity" });
  }

  if (snapshot.anchor) {
    if (!isUuid(snapshot.anchor.messageId)) issues.push({ path: "anchor.messageId", code: "invalid_uuid" });
    addScopeIssue(issues, "anchor.conversationId", snapshot.anchor.conversationId, scope.conversationId);
    addScopeIssue(issues, "anchor.organizationId", snapshot.anchor.organizationId, scope.organizationId);
    addScopeIssue(issues, "anchor.storeId", snapshot.anchor.storeId, scope.storeId);
    if (!isTimestamp(snapshot.anchor.capturedAt)) issues.push({ path: "anchor.capturedAt", code: "invalid_timestamp" });
    if (!Number.isInteger(snapshot.anchor.version) || snapshot.anchor.version < 1) issues.push({ path: "anchor.version", code: "required" });
  }

  return issues.length ? { ok: false, issues } : { ok: true, snapshot };
}

