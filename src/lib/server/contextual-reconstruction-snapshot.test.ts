import assert from "node:assert/strict";
import test from "node:test";
import {
  type ContextualReconstructionSnapshot,
  validateContextualReconstructionSnapshot,
} from "./contextual-reconstruction-snapshot";

const ids = {
  organization: "11111111-1111-4111-8111-111111111111",
  store: "22222222-2222-4222-8222-222222222222",
  conversation: "33333333-3333-4333-8333-333333333333",
  event: "44444444-4444-4444-8444-444444444444",
  takeover: "55555555-5555-4555-8555-555555555555",
  release: "66666666-6666-4666-8666-666666666666",
  message: "77777777-7777-4777-8777-777777777777",
  opportunity: "88888888-8888-4888-8888-888888888888",
  proposal: "99999999-9999-4999-8999-999999999999",
  version: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

const provenance = (source: "message" | "state_transition" | "crm" | "proposal" | "catalog" | "appointment" | "system" = "system") => ({
  source,
  sourceId: ids.event,
  actor: "system" as const,
  observedAt: "2026-11-14T12:00:00.000Z",
});

function snapshot(overrides: Partial<ContextualReconstructionSnapshot> = {}): ContextualReconstructionSnapshot {
  return {
    scope: { organizationId: ids.organization, storeId: ids.store, conversationId: ids.conversation },
    event: { id: ids.event, type: "human_takeover_released", occurredAt: "2026-11-14T12:00:00.000Z", origin: "human_release" },
    takeover: { startedAt: "2026-11-14T11:00:00.000Z", endedAt: "2026-11-14T12:00:00.000Z", takeoverEventId: ids.takeover, releaseEventId: ids.release, takeoverEventKey: "takeover:event", releaseEventKey: "release:event" },
    releaseOrigin: "human_release",
    crmStage: { value: "qualificacao", kind: "confirmed", provenance: provenance("crm"), observedAt: "2026-11-14T12:00:00.000Z" },
    relevantMessages: [],
    humanDecisions: [],
    commercialFacts: [],
    opportunity: { status: "resolved", candidates: [{ id: ids.opportunity, organizationId: ids.organization, storeId: ids.store, stage: "qualificacao", lifecycleCycle: 1, evidence: "confirmed", provenance: provenance("crm") }], selected: { id: ids.opportunity, organizationId: ids.organization, storeId: ids.store, stage: "qualificacao", lifecycleCycle: 1, evidence: "confirmed", provenance: provenance("crm") } },
    currentProposal: { id: ids.proposal, versionId: ids.version, organizationId: ids.organization, storeId: ids.store, opportunityId: ids.opportunity, totalValue: 1000, currency: "BRL", evidence: "confirmed", provenance: provenance("proposal") },
    products: [],
    commitments: [],
    anchor: { messageId: ids.message, conversationId: ids.conversation, organizationId: ids.organization, storeId: ids.store, capturedAt: "2026-11-14T12:00:00.000Z", version: 1 },
    conflicts: [],
    completeness: "complete",
    ambiguity: false,
    automaticMessaging: "forbidden",
    ...overrides,
  };
}

test("valid snapshot is deterministic and explicitly forbids automatic messaging", () => {
  const result = validateContextualReconstructionSnapshot(snapshot());
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.snapshot.automaticMessaging, "forbidden");
});

test("does not select an opportunity when context is ambiguous", () => {
  const value = snapshot({ opportunity: { status: "ambiguous", candidates: [snapshot().opportunity.candidates[0], { ...snapshot().opportunity.candidates[0], id: ids.store }], selected: null }, ambiguity: true, completeness: "blocked" });
  const result = validateContextualReconstructionSnapshot(value);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.path === "currentProposal"));
});

test("rejects an anchor from another tenant or conversation", () => {
  const result = validateContextualReconstructionSnapshot(snapshot({ anchor: { ...snapshot().anchor!, conversationId: ids.store } }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "scope_mismatch"));
});

test("rejects human decisions without human provenance", () => {
  const decision = { id: ids.message, decision: "valor confirmado", evidence: "human_correction" as const, provenance: { ...provenance("message"), actor: "system" as const } };
  const result = validateContextualReconstructionSnapshot(snapshot({ humanDecisions: [decision] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.path.includes("humanDecisions")));
});

test("rejects incomplete takeover interval and automatic authorization", () => {
  const result = validateContextualReconstructionSnapshot(snapshot({
    takeover: { ...snapshot().takeover, startedAt: "2026-11-14T13:00:00.000Z" },
    automaticMessaging: "forbidden",
  }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "interval_order"));
});

test("rejects complete snapshots with blocking conflicts", () => {
  const conflict = { id: ids.event, field: "currentProposal", description: "versões conflitantes", sources: [provenance("proposal")], blocksAutomaticContinuation: true };
  const result = validateContextualReconstructionSnapshot(snapshot({ conflicts: [conflict] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.path === "completeness"));
});

test("rejects nested opportunity and product data without canonical identity", () => {
  const value = snapshot({
    opportunity: { status: "resolved", candidates: [{ ...snapshot().opportunity.candidates[0], id: "not-a-uuid" }], selected: { ...snapshot().opportunity.candidates[0], id: "not-a-uuid" } },
    products: [{ id: "not-a-uuid", name: null, quantity: null, unitValue: null, totalValue: null, evidence: "confirmed", provenance: provenance("proposal") }],
  });
  const result = validateContextualReconstructionSnapshot(value);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "invalid_uuid" || issue.code === "required"));
});

test("rejects null human decisions and inconsistent release event origin", () => {
  const decision = { id: ids.message, decision: null, evidence: "human_correction" as const, provenance: { ...provenance("message"), actor: "human" as const, actorId: ids.organization } };
  const result = validateContextualReconstructionSnapshot(snapshot({
    humanDecisions: [decision],
    event: { ...snapshot().event, type: "human_takeover_expired", origin: "human_release" },
    releaseOrigin: "human_release",
  }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.path.includes("humanDecisions")));
});

test("rejects a proposal when the opportunity is ambiguous or not selected", () => {
  const candidate = snapshot().opportunity.candidates[0];
  const result = validateContextualReconstructionSnapshot(snapshot({
    opportunity: { status: "ambiguous", candidates: [candidate, { ...candidate, id: ids.store }], selected: null },
    ambiguity: true,
    completeness: "blocked",
  }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.path === "currentProposal"));
});

test("rejects runtime event and release-origin enums outside the canonical contract", () => {
  const result = validateContextualReconstructionSnapshot(snapshot({
    event: { ...snapshot().event, type: "unknown" as never, origin: "unknown" as never },
    releaseOrigin: "unknown" as never,
  }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "invalid_enum"));
});

