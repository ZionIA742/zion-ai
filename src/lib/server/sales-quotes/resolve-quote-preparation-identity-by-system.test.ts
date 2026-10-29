import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveQuotePreparationIdentityBySystem,
  type QuotePreparationIdentitySupabase,
} from "./resolve-quote-preparation-identity-by-system";

const ids = {
  task: "11111111-1111-4111-8111-111111111111",
  organization: "22222222-2222-4222-8222-222222222222",
  store: "33333333-3333-4333-8333-333333333333",
  lead: "44444444-4444-4444-8444-444444444444",
  conversation: "55555555-5555-4555-8555-555555555555",
  opportunity: "66666666-6666-4666-8666-666666666666",
  message: "77777777-7777-4777-8777-777777777777",
  profile: "88888888-8888-4888-8888-888888888888",
};

const baseRows = {
  store_assistant_operational_tasks: {
    id: ids.task,
    organization_id: ids.organization,
    store_id: ids.store,
    task_type: "commercial_quote_request",
    status: "open",
    related_lead_id: ids.lead,
    related_conversation_id: ids.conversation,
    commercial_opportunity_id: ids.opportunity,
    task_payload: { quote_preparation: { request_message_id: ids.message } },
  },
  messages: {
    id: ids.message,
    organization_id: ids.organization,
    store_id: ids.store,
    lead_id: ids.lead,
    conversation_id: ids.conversation,
    sender: "user",
    direction: "incoming",
    deleted_at: null,
  },
  leads: { id: ids.lead, organization_id: ids.organization, store_id: ids.store },
  conversations: { id: ids.conversation, organization_id: ids.organization, lead_id: ids.lead },
  commercial_opportunities: {
    id: ids.opportunity,
    organization_id: ids.organization,
    store_id: ids.store,
    origin_lead_id: ids.lead,
    primary_conversation_id: ids.conversation,
    stage: "qualificacao",
  },
  commercial_opportunity_profile_current: {
    organization_id: ids.organization,
    store_id: ids.store,
    commercial_opportunity_id: ids.opportunity,
    current_profile_version_id: ids.profile,
  },
  commercial_opportunity_profile_versions: {
    id: ids.profile,
    organization_id: ids.organization,
    store_id: ids.store,
    commercial_opportunity_id: ids.opportunity,
    version_number: 4,
    profile_state: "resolved",
  },
};

function client(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const rows = { ...baseRows, ...overrides };
  const supabase: QuotePreparationIdentitySupabase = {
    from(table) {
      calls.push(table);
      let filters: Record<string, unknown> = {};
      return {
        select() { return this; },
        eq(column: string, value: unknown) {
          filters = { ...filters, [column]: value };
          return this;
        },
        in() { return this; },
        async maybeSingle() {
          const row = rows[table as keyof typeof rows] as Record<string, unknown> | undefined;
          const matches = row && Object.entries(filters).every(([key, value]) => row[key] === value);
          return { data: matches ? row : null, error: null };
        },
      };
    },
  };
  return { supabase, calls };
}

test("resolves the complete canonical identity from the database", async () => {
  const { supabase, calls } = client();
  const result = await resolveQuotePreparationIdentityBySystem({
    taskId: ids.task,
    organizationId: ids.organization,
    storeId: ids.store,
    supabase,
  });

  assert.deepEqual(result, {
    eligible: true,
    identity: {
      taskId: ids.task,
      organizationId: ids.organization,
      storeId: ids.store,
      leadId: ids.lead,
      conversationId: ids.conversation,
      commercialOpportunityId: ids.opportunity,
      requestMessageId: ids.message,
      profileVersionId: ids.profile,
      profileVersionNumber: 4,
    },
  });
  assert.deepEqual(calls, [
    "store_assistant_operational_tasks",
    "messages",
    "leads",
    "conversations",
    "commercial_opportunities",
    "commercial_opportunity_profile_current",
    "commercial_opportunity_profile_versions",
  ]);
});

test("rejects missing, deleted, or non-incoming request messages", async () => {
  for (const messages of [
    undefined,
    { ...baseRows.messages, deleted_at: "2026-10-29T00:00:00Z" },
    { ...baseRows.messages, direction: "outgoing" },
  ]) {
    const { supabase } = client({ messages });
    const result = await resolveQuotePreparationIdentityBySystem({
      taskId: ids.task,
      organizationId: ids.organization,
      storeId: ids.store,
      supabase,
    });
    assert.equal(result.eligible, false);
    if (!result.eligible) assert.equal(result.reason, "request_message_invalid");
  }
});

test("rejects task and relational scope divergence", async () => {
  const variants = [
    { ...baseRows.store_assistant_operational_tasks, status: "resolved" },
    { ...baseRows.store_assistant_operational_tasks, related_conversation_id: ids.lead },
    { ...baseRows.messages, conversation_id: ids.lead },
    { ...baseRows.commercial_opportunities, primary_conversation_id: ids.lead },
  ];

  const first = await resolveQuotePreparationIdentityBySystem({
    taskId: ids.task,
    organizationId: ids.organization,
    storeId: ids.store,
    supabase: client({ store_assistant_operational_tasks: variants[0] }).supabase,
  });
  assert.equal(first.eligible, false);
  if (!first.eligible) assert.equal(first.reason, "task_not_eligible");

  const second = await resolveQuotePreparationIdentityBySystem({
    taskId: ids.task,
    organizationId: ids.organization,
    storeId: ids.store,
    supabase: client({ store_assistant_operational_tasks: variants[1] }).supabase,
  });
  assert.equal(second.eligible, false);
  if (!second.eligible) assert.equal(second.reason, "request_message_invalid");

  const third = await resolveQuotePreparationIdentityBySystem({
    taskId: ids.task,
    organizationId: ids.organization,
    storeId: ids.store,
    supabase: client({ messages: variants[2] }).supabase,
  });
  assert.equal(third.eligible, false);
  if (!third.eligible) assert.equal(third.reason, "request_message_invalid");

  const fourth = await resolveQuotePreparationIdentityBySystem({
    taskId: ids.task,
    organizationId: ids.organization,
    storeId: ids.store,
    supabase: client({ commercial_opportunities: variants[3] }).supabase,
  });
  assert.equal(fourth.eligible, false);
  if (!fourth.eligible) assert.equal(fourth.reason, "opportunity_context_mismatch");
});

test("rejects absent or unresolved current profiles", async () => {
  for (const profileCurrent of [
    undefined,
    { ...baseRows.commercial_opportunity_profile_current, current_profile_version_id: null },
  ]) {
    const result = await resolveQuotePreparationIdentityBySystem({
      taskId: ids.task,
      organizationId: ids.organization,
      storeId: ids.store,
      supabase: client({ commercial_opportunity_profile_current: profileCurrent }).supabase,
    });
    assert.equal(result.eligible, false);
    if (!result.eligible) assert.equal(result.reason, "profile_current_missing");
  }

  const result = await resolveQuotePreparationIdentityBySystem({
    taskId: ids.task,
    organizationId: ids.organization,
    storeId: ids.store,
    supabase: client({
      commercial_opportunity_profile_versions: {
        ...baseRows.commercial_opportunity_profile_versions,
        profile_state: "needs_clarification",
      },
    }).supabase,
  });
  assert.equal(result.eligible, false);
  if (!result.eligible) assert.equal(result.reason, "profile_not_resolved");
});

test("returns an identifiable query failure without registration or writer calls", async () => {
  const calls: string[] = [];
  const supabase: QuotePreparationIdentitySupabase = {
    from(table) {
      calls.push(table);
      return {
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        async maybeSingle() {
          return { data: null, error: { code: "PGRST_TEST_FAILURE", message: "read failed" } };
        },
      };
    },
  };

  const result = await resolveQuotePreparationIdentityBySystem({
    taskId: ids.task,
    organizationId: ids.organization,
    storeId: ids.store,
    supabase,
  });
  assert.deepEqual(result, {
    eligible: false,
    taskId: ids.task,
    reason: "query_failed",
    errorCode: "PGRST_TEST_FAILURE",
  });
  assert.deepEqual(calls, ["store_assistant_operational_tasks"]);
});
