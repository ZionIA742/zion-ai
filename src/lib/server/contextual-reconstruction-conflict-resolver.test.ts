import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveContextualReconstructionConflicts,
} from "./contextual-reconstruction-conflict-resolver";
import type { ContextualReconstructionSnapshot } from "./contextual-reconstruction-snapshot";

const ids = {
  org: "11111111-1111-4111-8111-111111111111",
  store: "22222222-2222-4222-8222-222222222222",
  conversation: "33333333-3333-4333-8333-333333333333",
  event: "44444444-4444-4444-8444-444444444444",
  takeover: "55555555-5555-4555-8555-555555555555",
  release: "66666666-6666-4666-8666-666666666666",
  opportunity: "77777777-7777-4777-8777-777777777777",
  proposal: "88888888-8888-4888-8888-888888888888",
  version: "99999999-9999-4999-8999-999999999999",
};

const observedAt = "2026-11-14T11:30:00.000Z";
const provenance = (source: "crm" | "proposal" | "message" = "crm", actor: "system" | "human" = "system", actorId?: string) => ({
  source,
  sourceId: ids.event,
  actor,
  actorId,
  observedAt,
});

function makeSnapshot(overrides: Partial<ContextualReconstructionSnapshot> = {}): ContextualReconstructionSnapshot {
  const opportunity = {
    id: ids.opportunity,
    organizationId: ids.org,
    storeId: ids.store,
    stage: "orcamento",
    lifecycleCycle: 1,
    evidence: "confirmed" as const,
    provenance: provenance("crm"),
  };
  return {
    scope: { organizationId: ids.org, storeId: ids.store, conversationId: ids.conversation },
    event: { id: ids.event, type: "human_takeover_released", occurredAt: "2026-11-14T12:00:00.000Z", origin: "human_release" },
    takeover: { startedAt: "2026-11-14T10:00:00.000Z", endedAt: "2026-11-14T12:00:00.000Z", takeoverEventId: ids.takeover, releaseEventId: ids.release, takeoverEventKey: "takeover:1", releaseEventKey: "release:1" },
    releaseOrigin: "human_release",
    crmStage: { value: "orcamento", kind: "confirmed", provenance: provenance("crm"), observedAt },
    relevantMessages: [],
    humanDecisions: [],
    commercialFacts: [],
    opportunity: { status: "resolved", candidates: [opportunity], selected: opportunity },
    currentProposal: { id: ids.proposal, versionId: ids.version, organizationId: ids.org, storeId: ids.store, opportunityId: ids.opportunity, totalValue: 1000, currency: "BRL", evidence: "confirmed", provenance: provenance("proposal") },
    products: [],
    commitments: [],
    anchor: null,
    conflicts: [],
    completeness: "complete",
    ambiguity: false,
    automaticMessaging: "forbidden",
    ...overrides,
  };
}

test("retém autoridades canônicas sem mutação e marca ausências como desconhecidas", () => {
  const result = resolveContextualReconstructionConflicts(makeSnapshot());
  assert.equal(result.status, "requires_human_regularization");
  assert.equal(result.automaticContinuation, "forbidden");
  assert.ok(result.decisions.every((decision) => decision.outcome === "retain_canonical" || decision.outcome === "unknown"));
});

test("preserva correção humana válida e exige regularização canônica", () => {
  const result = resolveContextualReconstructionConflicts(makeSnapshot({
    humanDecisions: [{ id: ids.event, decision: "preço negociado", evidence: "human_correction", domain: "proposal", field: "total_value", provenance: provenance("crm", "human", ids.org), authorityProof: { kind: "canonical_state_transition", sourceId: ids.event, actorId: ids.org, organizationId: ids.org, storeId: ids.store, conversationId: ids.conversation, opportunityId: ids.opportunity } }],
  }));
  assert.equal(result.status, "requires_human_regularization");
  assert.equal(result.decisions.find((decision) => decision.domain === "proposal")?.outcome, "honor_human_evidence");
  assert.equal(result.decisions.find((decision) => decision.domain === "crm_stage")?.outcome, "retain_canonical");
  assert.equal(result.regularizations[0]?.domain, "proposal");
});

test("bloqueia autoria incerta, decisão fora do takeover e conflito de preço", () => {
  const result = resolveContextualReconstructionConflicts(makeSnapshot({
    humanDecisions: [{ id: ids.event, decision: "valor confirmado", evidence: "human_correction", domain: "proposal", field: "total_value", provenance: { ...provenance("crm", "human", ids.org), observedAt: "2026-11-14T09:00:00.000Z" }, authorityProof: { kind: "canonical_state_transition", sourceId: ids.event, actorId: ids.org, organizationId: ids.org, storeId: ids.store, conversationId: ids.conversation, opportunityId: ids.opportunity } }],
    conflicts: [{ id: ids.event, field: "price", description: "preços divergentes", sources: [provenance("proposal")], blocksAutomaticContinuation: true }],
    completeness: "blocked",
    ambiguity: true,
  }));
  assert.equal(result.status, "blocked");
  assert.equal(result.blockingConflicts.length, 1);
  assert.ok(result.regularizationReasons.includes("human_decision_without_current_verified_provenance"));
});

test("não escolhe oportunidade ambígua nem resolve compromisso por texto", () => {
  const opportunity = makeSnapshot().opportunity.candidates[0];
  const result = resolveContextualReconstructionConflicts(makeSnapshot({
    opportunity: { status: "ambiguous", candidates: [opportunity, { ...opportunity, id: ids.store }], selected: null },
    currentProposal: null,
    ambiguity: true,
    completeness: "blocked",
  }));
  assert.equal(result.status, "blocked");
  assert.equal(result.decisions.find((decision) => decision.domain === "opportunity")?.outcome, "blocked");
});

test("dados obsoletos, produtos e compromissos conflitantes permanecem bloqueados", () => {
  const result = resolveContextualReconstructionConflicts(makeSnapshot({
    products: [{ id: ids.version, organizationId: ids.org, storeId: ids.store, quoteId: ids.proposal, name: "Produto antigo", quantity: 1, unitValue: 1, totalValue: 1, evidence: "obsolete", provenance: provenance("proposal") }],
    conflicts: [{ id: ids.event, field: "commitments", description: "visita divergente", sources: [provenance("crm")], blocksAutomaticContinuation: true }],
    ambiguity: true,
    completeness: "blocked",
  }));
  assert.equal(result.status, "blocked");
  assert.equal(result.decisions.find((decision) => decision.domain === "products")?.outcome, "blocked");
  assert.equal(result.decisions.find((decision) => decision.domain === "commitments")?.outcome, "blocked");
});

test("falha fechado para decisÃ£o sem domÃ­nio, campo ou autoridade canÃ´nica", () => {
  const result = resolveContextualReconstructionConflicts(makeSnapshot({
    humanDecisions: [{ id: ids.event, decision: "preÃ§o negociado", evidence: "human_correction", provenance: provenance("message", "human", ids.org) }],
  }));
  assert.equal(result.status, "requires_human_regularization");
  assert.equal(result.decisions.some((decision) => decision.outcome === "honor_human_evidence"), false);
  assert.equal(result.regularizations[0]?.reason, "human_decision_requires_canonical_domain_field_and_authority");
});

test("bloqueia completude bloqueada mesmo sem conflito explÃ­cito", () => {
  const result = resolveContextualReconstructionConflicts(makeSnapshot({ completeness: "blocked" }));
  assert.equal(result.status, "blocked");
  assert.ok(result.regularizationReasons.includes("snapshot_completeness_blocked"));
});

test("preserva conflitos informativos sem promovÃª-los a bloqueio", () => {
  const result = resolveContextualReconstructionConflicts(makeSnapshot({
    conflicts: [{ id: ids.event, field: "notes", description: "informaÃ§Ã£o auxiliar", sources: [provenance("crm")], blocksAutomaticContinuation: false }],
    completeness: "partial",
    ambiguity: true,
  }));
  assert.equal(result.blockingConflicts.length, 0);
  assert.equal(result.informationalConflicts.length, 1);
});

