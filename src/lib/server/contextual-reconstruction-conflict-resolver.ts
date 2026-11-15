import {
  validateContextualReconstructionSnapshot,
  type ContextualReconstructionSnapshot,
  RECONSTRUCTION_DOMAIN_FIELDS,
  type ReconstructionDecisionDomain,
  type ReconstructionConflict,
  type ReconstructionProvenance,
} from "./contextual-reconstruction-snapshot";

export type ContextualResolutionStatus =
  | "resolved_without_mutation"
  | "requires_human_regularization"
  | "blocked";

export type ContextualResolutionDomain = ReconstructionDecisionDomain;

export type ContextualResolutionDecision = {
  domain: ContextualResolutionDomain;
  outcome: "retain_canonical" | "honor_human_evidence" | "unknown" | "blocked";
  rationale: string;
  sources: ReconstructionProvenance[];
  requiresHumanRegularization: boolean;
};

export type ContextualResolutionResult = {
  status: ContextualResolutionStatus;
  automaticContinuation: "forbidden";
  decisions: ContextualResolutionDecision[];
  blockingConflicts: ReconstructionConflict[];
  informationalConflicts: ReconstructionConflict[];
  regularizationReasons: string[];
  regularizations: Array<{
    domain: ContextualResolutionDomain | "human_decision";
    field: string | null;
    decisionId: string | null;
    sourceId: string | null;
    observedAt: string | null;
    reason: string;
  }>;
};

const DOMAINS: ContextualResolutionDomain[] = [
  "opportunity",
  "crm_stage",
  "commercial_facts",
  "proposal",
  "products",
  "commitments",
];

function bySourceId(left: ReconstructionProvenance, right: ReconstructionProvenance) {
  const leftKey = `${left.source}:${left.sourceId}`;
  const rightKey = `${right.source}:${right.sourceId}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function uniqueSources(sources: ReconstructionProvenance[]) {
  const seen = new Set<string>();
  return sources
    .filter((source) => {
      const key = `${source.source}:${source.sourceId}:${source.observedAt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(bySourceId);
}

function conflictsForDomain(snapshot: ContextualReconstructionSnapshot, domain: ContextualResolutionDomain) {
  const fieldNames: Record<ContextualResolutionDomain, string[]> = {
    opportunity: ["opportunity"],
    crm_stage: ["crmStage", "stage", "crm_stage"],
    commercial_facts: ["commercialFacts", "commercial_facts", "facts"],
    proposal: ["currentProposal", "proposal", "price", "budget", "value", "currency"],
    products: ["products", "product"],
    commitments: ["commitments", "commitment", "visit", "appointment"],
  };
  return snapshot.conflicts.filter((conflict) =>
    fieldNames[domain].some((field) => conflict.field.toLowerCase().includes(field.toLowerCase())),
  );
}

function canonicalSources(snapshot: ContextualReconstructionSnapshot, domain: ContextualResolutionDomain) {
  switch (domain) {
    case "opportunity":
      return snapshot.opportunity.selected?.provenance
        ? [snapshot.opportunity.selected.provenance]
        : snapshot.opportunity.candidates.flatMap((candidate) => [candidate.provenance]);
    case "crm_stage":
      return [snapshot.crmStage.provenance];
    case "commercial_facts":
      return snapshot.commercialFacts.map((fact) => fact.provenance);
    case "proposal":
      return snapshot.currentProposal ? [snapshot.currentProposal.provenance] : [];
    case "products":
      return snapshot.products.map((product) => product.provenance);
    case "commitments":
      return snapshot.commitments.map((commitment) => commitment.provenance);
  }
}

function hasObsoleteEvidence(snapshot: ContextualReconstructionSnapshot, domain: ContextualResolutionDomain) {
  if (domain === "commercial_facts") return false;
  if (domain === "products") return snapshot.products.some((item) => item.evidence === "obsolete");
  if (domain === "commitments") return snapshot.commitments.some((item) => item.evidence === "obsolete");
  if (domain === "proposal") return Boolean(snapshot.currentProposal?.evidence === "obsolete");
  if (domain === "crm_stage") return snapshot.crmStage.kind === "obsolete";
  if (domain === "opportunity") return Boolean(snapshot.opportunity.selected?.evidence === "obsolete");
  return false;
}

function hasConfirmedCanonicalEvidence(snapshot: ContextualReconstructionSnapshot, domain: ContextualResolutionDomain) {
  switch (domain) {
    case "opportunity":
      return snapshot.opportunity.status === "resolved"
        && snapshot.opportunity.selected?.evidence === "confirmed"
        && snapshot.opportunity.selected.lifecycleCycle !== null
        && Boolean(snapshot.opportunity.selected.stage?.trim());
    case "crm_stage":
      return snapshot.crmStage.kind === "confirmed" && Boolean(snapshot.crmStage.value?.trim());
    case "commercial_facts":
      return snapshot.commercialFacts.length > 0 && snapshot.commercialFacts.every((fact) => fact.state === "confirmed");
    case "proposal":
      return snapshot.currentProposal?.evidence === "confirmed";
    case "products":
      return snapshot.products.length > 0 && snapshot.products.every((product) => product.evidence === "confirmed");
    case "commitments":
      return snapshot.commitments.length > 0 && snapshot.commitments.every((commitment) => commitment.evidence === "confirmed");
  }
}

export function resolveContextualReconstructionConflicts(
  snapshot: ContextualReconstructionSnapshot,
): ContextualResolutionResult {
  const validation = validateContextualReconstructionSnapshot(snapshot);
  if (!validation.ok) {
    const blockingConflicts = snapshot.conflicts.filter((conflict) => conflict.blocksAutomaticContinuation);
    return {
      status: "blocked",
      automaticContinuation: "forbidden",
      decisions: [],
      blockingConflicts,
      informationalConflicts: snapshot.conflicts.filter((conflict) => !conflict.blocksAutomaticContinuation),
      regularizationReasons: ["snapshot_invalid_for_conflict_resolution"],
      regularizations: [],
    };
  }

  const validHumanDecisions = snapshot.humanDecisions.filter((decision) => {
    const observedAt = Date.parse(decision.provenance.observedAt);
    return decision.provenance.actor === "human"
      && Boolean(decision.provenance.actorId?.trim())
      && (decision.provenance.source === "state_transition" || decision.provenance.source === "crm")
      && Boolean(decision.decision?.trim())
      && Boolean(decision.domain && decision.field?.trim())
      && Boolean(decision.authorityProof)
      && decision.authorityProof?.sourceId === decision.provenance.sourceId
      && decision.authorityProof.actorId === decision.provenance.actorId
      && decision.authorityProof.organizationId === snapshot.scope.organizationId
      && decision.authorityProof.storeId === snapshot.scope.storeId
      && decision.authorityProof.conversationId === snapshot.scope.conversationId
      && (decision.authorityProof.opportunityId === null || decision.authorityProof.opportunityId === snapshot.opportunity.selected?.id)
      && decision.domain !== undefined
      && RECONSTRUCTION_DOMAIN_FIELDS[decision.domain]?.includes(decision.field as string)
      && observedAt >= Date.parse(snapshot.takeover.startedAt)
      && observedAt <= Date.parse(snapshot.takeover.endedAt);
  });
  const invalidHumanDecisionCount = snapshot.humanDecisions.length - validHumanDecisions.length;
  const blockingConflicts = snapshot.conflicts.filter((conflict) => conflict.blocksAutomaticContinuation);
  const regularizationReasons: string[] = [];
  const regularizations: ContextualResolutionResult["regularizations"] = [];
  if (invalidHumanDecisionCount > 0) regularizationReasons.push("human_decision_without_current_verified_provenance");
  for (const decision of snapshot.humanDecisions) {
    if (!validHumanDecisions.includes(decision)) {
      regularizations.push({
        domain: "human_decision",
        field: decision.field ?? null,
        decisionId: decision.id,
        sourceId: decision.provenance.sourceId ?? null,
        observedAt: decision.provenance.observedAt ?? null,
        reason: "human_decision_requires_canonical_domain_field_and_authority",
      });
    }
  }
  if (validHumanDecisions.length > 0) {
    regularizationReasons.push("human_decision_requires_canonical_commercial_writer");
    for (const decision of validHumanDecisions) {
      regularizations.push({
        domain: decision.domain ?? "human_decision",
        field: decision.field ?? null,
        decisionId: decision.id,
        sourceId: decision.provenance.sourceId,
        observedAt: decision.provenance.observedAt,
        reason: "human_decision_requires_canonical_commercial_writer",
      });
    }
  }

  const informationalConflicts = snapshot.conflicts.filter((conflict) => !conflict.blocksAutomaticContinuation);
  if (snapshot.completeness === "blocked") regularizationReasons.push("snapshot_completeness_blocked");
  const decisions = DOMAINS.map((domain): ContextualResolutionDecision => {
    const domainConflicts = conflictsForDomain(snapshot, domain);
    const matchingHumanDecisions = validHumanDecisions.filter((decision) => decision.domain === domain);
    const humanSources = uniqueSources(matchingHumanDecisions.map((decision) => decision.provenance));
    const sources = uniqueSources([...canonicalSources(snapshot, domain), ...humanSources]);
    if (domainConflicts.length > 0 || hasObsoleteEvidence(snapshot, domain)) {
      return {
        domain,
        outcome: "blocked",
        rationale: domainConflicts.length > 0 ? "conflito bloqueante preservado" : "evidência obsoleta não pode prevalecer",
        sources: uniqueSources([...sources, ...domainConflicts.flatMap((conflict) => conflict.sources)]),
        requiresHumanRegularization: true,
      };
    }
    if (domain === "opportunity" && (snapshot.opportunity.status !== "resolved" || !snapshot.opportunity.selected)) {
      return {
        domain,
        outcome: "blocked",
        rationale: "oportunidade ausente ou ambígua não pode ser escolhida pelo resolvedor",
        sources,
        requiresHumanRegularization: true,
      };
    }
    if (matchingHumanDecisions.length > 0) {
      return {
        domain,
        outcome: "honor_human_evidence",
        rationale: "evidência humana válida é preservada, mas nenhuma autoridade comercial é substituída por texto",
        sources,
        requiresHumanRegularization: true,
      };
    }
    const hasCanonicalValue = hasConfirmedCanonicalEvidence(snapshot, domain);
    return {
      domain,
      outcome: hasCanonicalValue ? "retain_canonical" : "unknown",
      rationale: hasCanonicalValue ? "autoridade canônica preservada sem mutação" : "nenhum dado canônico suficiente",
      sources,
      requiresHumanRegularization: !hasCanonicalValue,
    };
  });

  const hasUnknown = decisions.some((decision) => decision.outcome === "unknown");
  const requiresRegularization = regularizationReasons.length > 0
    || decisions.some((decision) => decision.requiresHumanRegularization);
  return {
    status: snapshot.completeness === "blocked" || blockingConflicts.length > 0 || decisions.some((decision) => decision.outcome === "blocked")
      ? "blocked"
      : requiresRegularization || hasUnknown
        ? "requires_human_regularization"
        : "resolved_without_mutation",
    automaticContinuation: "forbidden",
    decisions,
    blockingConflicts,
    informationalConflicts,
    regularizationReasons,
    regularizations,
  };
}
