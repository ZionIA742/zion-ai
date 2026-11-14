import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  aggregateContextualReconstructionSnapshot,
  type ReconstructionReaders,
} from "./contextual-reconstruction-aggregator";

const aggregatorSource = fs.readFileSync("src/lib/server/contextual-reconstruction-aggregator.ts", "utf8");

const ids = {
  org: "11111111-1111-4111-8111-111111111111",
  store: "22222222-2222-4222-8222-222222222222",
  conversation: "33333333-3333-4333-8333-333333333333",
  lead: "44444444-4444-4444-8444-444444444444",
  request: "55555555-5555-4555-8555-555555555555",
  opportunity: "66666666-6666-4666-8666-666666666666",
  opportunity2: "77777777-7777-4777-8777-777777777777",
  proposal: "88888888-8888-4888-8888-888888888888",
  version: "99999999-9999-4999-8999-999999999999",
  transition: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  appointment: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

const startedAt = "2026-11-14T10:00:00.000Z";
const releasedAt = "2026-11-14T12:00:00.000Z";

function makeReaders(overrides: Partial<ReconstructionReaders> = {}): ReconstructionReaders {
  const messages = Array.from({ length: 205 }, (_, index) => ({
    id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
    organization_id: ids.org,
    store_id: ids.store,
    conversation_id: ids.conversation,
    sender: index === 204 ? "user" : index % 2 === 0 ? "human" : "ai_sales",
    direction: index === 204 ? "inbound" : "outgoing",
    content: index === 204 ? "Confirmo o valor combinado." : `mensagem ${index}`,
    created_at: new Date(Date.parse(startedAt) + index * 1000).toISOString(),
  }));
  const defaults: ReconstructionReaders = {
    async loadRequest() {
      return { id: ids.request, organization_id: ids.org, store_id: ids.store, conversation_id: ids.conversation, takeover_event_key: "takeover:event", release_event_key: "release:event", takeover_started_at: startedAt, released_at: releasedAt, takeover_version: startedAt, status: "pending" };
    },
    async loadConversation() {
      return { id: ids.conversation, organization_id: ids.org, lead_id: ids.lead, status: "qualificacao", is_human_active: false };
    },
    async loadLease() {
      return { organization_id: ids.org, store_id: ids.store, conversation_id: ids.conversation, takeover_started_at: startedAt, released_at: releasedAt, hard_hold: false };
    },
    async loadMessagesPage(args) {
      return messages.slice(args.offset, args.offset + args.limit);
    },
    async loadTransitions() {
      return [{ id: ids.transition, organization_id: ids.org, store_id: ids.store, conversation_id: ids.conversation, from_state: "humano_assumiu", to_state: "orcamento", actor_type: "human", actor_user_id: ids.lead, reason: "cliente confirmou correção humana", source: "crm", metadata: {}, event_key: "transition:event", created_at: "2026-11-14T11:00:00.000Z" }];
    },
    async loadOpportunities() {
      return [{ id: ids.opportunity, organization_id: ids.org, store_id: ids.store, origin_lead_id: ids.lead, primary_conversation_id: ids.conversation, stage: "orcamento", lifecycle_cycle: 2, stage_changed_at: "2026-11-14T11:00:00.000Z", updated_at: releasedAt }];
    },
    async loadQualification() {
      return { known_facts: [{ key: "area_m2", value: 32 }], conflicts: [], provenance_summary: { source: "canonical" } };
    },
    async loadProposal() {
      return { organization_id: ids.org, store_id: ids.store, commercial_opportunity_id: ids.opportunity, lifecycle_cycle: 2, proposal_state: "current", current_quote_id: ids.proposal, current_quote_version_id: ids.version, quote_number: "ORC-1", version_status: "sent", version_number: 3, version_sent_at: "2026-11-14T11:30:00.000Z", total_cents: 125000 };
    },
    async loadItems() {
      return [{ id: ids.version, name: "Piscina", quantity: 1, unit_price_cents: 100000, total_cents: 100000, created_at: "2026-11-14T11:30:00.000Z" }];
    },
    async loadCommitments() {
      return [{ id: ids.appointment, kind: "appointment", description: "Visita confirmada", scheduled_at: "2026-11-15T14:00:00.000Z", organization_id: ids.org, store_id: ids.store, conversation_id: ids.conversation, commercial_opportunity_id: ids.opportunity, status: "scheduled" }];
    },
  };
  return { ...defaults, ...overrides };
}

test("agrega histórico longo, decisão humana, proposta versionada e compromisso", async () => {
  const result = await aggregateContextualReconstructionSnapshot({ readers: makeReaders(), requestId: ids.request, organizationId: ids.org, storeId: ids.store, pageSize: 50 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.snapshot.relevantMessages.length, 205);
  assert.equal(result.snapshot.humanDecisions.length, 103);
  assert.equal(result.snapshot.currentProposal?.versionId, ids.version);
  assert.equal(result.snapshot.currentProposal?.totalValue, 1250);
  assert.equal(result.snapshot.products[0]?.totalValue, 1000);
  assert.equal(result.snapshot.commitments[0]?.description, "Visita confirmada");
  assert.equal(result.snapshot.automaticMessaging, "forbidden");
});

test("não seleciona arbitrariamente entre oportunidades", async () => {
  const result = await aggregateContextualReconstructionSnapshot({
    readers: makeReaders({
      async loadOpportunities() {
        return [
          { id: ids.opportunity, organization_id: ids.org, store_id: ids.store, origin_lead_id: ids.lead, primary_conversation_id: ids.conversation, stage: "orcamento" },
          { id: ids.opportunity2, organization_id: ids.org, store_id: ids.store, origin_lead_id: ids.lead, primary_conversation_id: ids.conversation, stage: "negociacao" },
        ];
      },
    }),
    requestId: ids.request,
    organizationId: ids.org,
    storeId: ids.store,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.snapshot?.opportunity.selected, null);
});

test("rejeita request de tenant divergente", async () => {
  const result = await aggregateContextualReconstructionSnapshot({
    readers: makeReaders({ async loadRequest() { return { id: ids.request, organization_id: ids.org, store_id: ids.store, conversation_id: ids.conversation, takeover_event_key: "t", release_event_key: "r", takeover_started_at: startedAt, released_at: releasedAt, takeover_version: startedAt, status: "pending" }; } }),
    requestId: ids.request,
    organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    storeId: ids.store,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "reconstruction_request_scope_mismatch");
});

test("falha fechado quando o contexto comercial está incompleto", async () => {
  const result = await aggregateContextualReconstructionSnapshot({
    readers: makeReaders({
      async loadOpportunities() { return []; },
      async loadMessagesPage() { return []; },
    }),
    requestId: ids.request,
    organizationId: ids.org,
    storeId: ids.store,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /incomplete|ambiguous/);
});

test("rejeita takeover reativado ou versão obsoleta", async () => {
  const result = await aggregateContextualReconstructionSnapshot({
    readers: makeReaders({ async loadLease() { return { organization_id: ids.org, store_id: ids.store, conversation_id: ids.conversation, takeover_started_at: "2026-11-14T13:00:00.000Z", released_at: null, hard_hold: false }; } }),
    requestId: ids.request,
    organizationId: ids.org,
    storeId: ids.store,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "takeover_context_no_longer_current");
});

test("agregador não contém writes nem integração externa", () => {
  assert.doesNotMatch(aggregatorSource, /supabase\.from\([^)]*\)\.(insert|update|delete)\(/);
  assert.doesNotMatch(aggregatorSource, /generateAndSaveAiSalesReply|sendExternal|whatsapp-process-all|ai_run_queue/);
});

