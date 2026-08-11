import test from "node:test";
import assert from "node:assert/strict";

const { buildCustomerContextSummary } = await import(
  new URL("./customer-context-summary.js", import.meta.url).href
);

type Row = Record<string, unknown>;

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private orFilters: Array<(row: Row) => boolean> = [];
  private orders: Array<{ field: string; ascending: boolean }> = [];
  private limitValue: number | null = null;
  private readonly rows: Row[];

  constructor(rows: Row[]) {
    this.rows = rows;
  }

  select(columns: string) {
    void columns;
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value);
    return this;
  }

  or(expression: string) {
    const conditions = expression
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [field, value] = part.split(".eq.");
        return (row: Row) => String(row[field] ?? "") === value;
      });

    this.orFilters.push((row) => conditions.some((condition) => condition(row)));
    return this;
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orders.push({ field, ascending: options?.ascending !== false });
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  maybeSingle() {
    return this.execute(true);
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Row | Row[] | null; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute(false).then(onfulfilled, onrejected);
  }

  private async execute(single: boolean) {
    let result = [...this.rows];

    for (const filter of this.filters) {
      result = result.filter(filter);
    }

    for (const filter of this.orFilters) {
      result = result.filter(filter);
    }

    for (const order of [...this.orders].reverse()) {
      result.sort((left, right) => {
        const a = left[order.field];
        const b = right[order.field];
        if (a === b) return 0;
        if (a == null) return order.ascending ? 1 : -1;
        if (b == null) return order.ascending ? -1 : 1;
        return String(a).localeCompare(String(b)) * (order.ascending ? 1 : -1);
      });
    }

    if (typeof this.limitValue === "number") {
      result = result.slice(0, this.limitValue);
    }

    return {
      data: single ? result[0] ?? null : result,
      error: null,
    };
  }
}

class FakeSupabase {
  private readonly tables: Record<string, Row[]>;

  constructor(tables: Record<string, Row[]>) {
    this.tables = tables;
  }

  from(table: string) {
    return new FakeQuery(this.tables[table] || []);
  }
}

function createBaseTables() {
  const tables: Record<string, Row[]> = {
    leads: [
      {
        id: "lead-1",
        organization_id: "org-1",
        store_id: "store-1",
        name: "Lead Atual",
        phone: "11999999999",
      },
    ],
    messages: [
      {
        id: "message-current",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-1",
        sender: "customer",
        direction: "incoming",
        content: "Mensagem atual",
        created_at: "2026-07-20T12:00:00.000Z",
        conversation_session_id: null,
        commercial_session_context_link_id: null,
        commercial_context_capture_state: "legacy_unknown",
      },
    ],
    sales_contracts: [
      {
        id: "contract-1",
        organization_id: "org-1",
        store_id: "store-1",
        lead_id: "lead-1",
        conversation_id: "conv-1",
        quote_id: null,
        contract_number: "CT-1",
        status: "sent",
        sent_at: "2026-07-20T09:00:00.000Z",
        customer_signed_at: null,
        completed_at: null,
        created_at: "2026-07-20T08:00:00.000Z",
      },
    ],
    store_appointments: [],
    conversation_sessions: [],
    commercial_session_context_links: [],
    sales_quotes: [],
  };

  return tables;
}

async function buildSummary(tables: Record<string, Row[]>, relatedMessageId?: string) {
  return buildCustomerContextSummary({
    supabase: new FakeSupabase(tables),
    organizationId: "org-1",
    storeId: "store-1",
    leadId: "lead-1",
    conversationId: "conv-1",
    relatedMessageId,
    trigger: "customer_requested_contract",
    customerName: "Cliente Atual",
  });
}

async function buildSummaryWithoutConversation(
  tables: Record<string, Row[]>,
  relatedMessageId: string
) {
  return buildCustomerContextSummary({
    supabase: new FakeSupabase(tables),
    organizationId: "org-1",
    storeId: "store-1",
    leadId: "lead-1",
    relatedMessageId,
    trigger: "customer_requested_contract",
    customerName: "Cliente Atual",
  });
}

test("captured uses the frozen historical link and keeps current contract separate", async () => {
  const tables = createBaseTables();
  tables.messages.push({
    id: "message-captured",
    organization_id: "org-1",
    store_id: "store-1",
    conversation_id: "conv-1",
    sender: "customer",
    direction: "incoming",
    content: "Mensagem historica A",
    created_at: "2026-07-19T12:00:00.000Z",
    conversation_session_id: "session-a",
    commercial_session_context_link_id: "context-a",
    commercial_context_capture_state: "captured",
  });
  tables.conversation_sessions.push({
    id: "session-a",
    organization_id: "org-1",
    store_id: "store-1",
    conversation_id: "conv-1",
  });
  tables.commercial_session_context_links.push(
    {
      id: "context-a",
      organization_id: "org-1",
      store_id: "store-1",
      conversation_session_id: "session-a",
      customer_id: "customer-a",
      commercial_opportunity_id: "opportunity-a",
      lead_customer_link_id: "lead-link-a",
    },
    {
      id: "context-b",
      organization_id: "org-1",
      store_id: "store-1",
      conversation_session_id: "session-b",
      customer_id: "customer-b",
      commercial_opportunity_id: "opportunity-b",
      lead_customer_link_id: "lead-link-b",
    }
  );

  const summary = await buildSummary(tables, "message-captured");

  assert.equal(summary?.contractNumber, "CT-1");
  assert.deepEqual(summary?.relatedMessageCommercialContext, {
    messageId: "message-captured",
    captureState: "captured",
    historicalContextStatus: "captured",
    conversationSessionId: "session-a",
    commercialSessionContextLinkId: "context-a",
    customerId: "customer-a",
    commercialOpportunityId: "opportunity-a",
    leadCustomerLinkId: "lead-link-a",
  });
});

test("pending_context preserves only the frozen session id", async () => {
  const tables = createBaseTables();
  tables.messages.push({
    id: "message-pending",
    organization_id: "org-1",
    store_id: "store-1",
    conversation_id: "conv-1",
    sender: "customer",
    direction: "incoming",
    content: "Mensagem pendente",
    created_at: "2026-07-19T12:00:00.000Z",
    conversation_session_id: "session-pending",
    commercial_session_context_link_id: null,
    commercial_context_capture_state: "pending_context",
  });
  tables.conversation_sessions.push({
    id: "session-pending",
    organization_id: "org-1",
    store_id: "store-1",
    conversation_id: "conv-1",
  });

  const summary = await buildSummary(tables, "message-pending");

  assert.deepEqual(summary?.relatedMessageCommercialContext, {
    messageId: "message-pending",
    captureState: "pending_context",
    historicalContextStatus: "pending_context",
    conversationSessionId: "session-pending",
    commercialSessionContextLinkId: null,
    customerId: null,
    commercialOpportunityId: null,
    leadCustomerLinkId: null,
  });
});

test("no_active_session does not invent historical context", async () => {
  const tables = createBaseTables();
  tables.messages.push({
    id: "message-no-session",
    organization_id: "org-1",
    store_id: "store-1",
    conversation_id: "conv-1",
    sender: "customer",
    direction: "incoming",
    content: "Mensagem sem sessao",
    created_at: "2026-07-19T12:00:00.000Z",
    conversation_session_id: null,
    commercial_session_context_link_id: null,
    commercial_context_capture_state: "no_active_session",
  });

  const summary = await buildSummary(tables, "message-no-session");

  assert.equal(
    summary?.relatedMessageCommercialContext?.historicalContextStatus,
    "no_active_session"
  );
  assert.equal(summary?.relatedMessageCommercialContext?.conversationSessionId, null);
  assert.equal(summary?.relatedMessageCommercialContext?.customerId, null);
});

test("legacy_unknown does not promote the current context to historical", async () => {
  const tables = createBaseTables();
  tables.messages.push({
    id: "message-legacy",
    organization_id: "org-1",
    store_id: "store-1",
    conversation_id: "conv-1",
    sender: "customer",
    direction: "incoming",
    content: "Mensagem legacy",
    created_at: "2026-07-19T12:00:00.000Z",
    conversation_session_id: null,
    commercial_session_context_link_id: null,
    commercial_context_capture_state: "legacy_unknown",
  });

  const summary = await buildSummary(tables, "message-legacy");

  assert.equal(
    summary?.relatedMessageCommercialContext?.historicalContextStatus,
    "legacy_unknown"
  );
  assert.equal(summary?.relatedMessageCommercialContext?.commercialSessionContextLinkId, null);
  assert.equal(summary?.relatedMessageCommercialContext?.customerId, null);
});

test("captured without the frozen link becomes inconsistent and does not fallback", async () => {
  const tables = createBaseTables();
  tables.messages.push({
    id: "message-inconsistent",
    organization_id: "org-1",
    store_id: "store-1",
    conversation_id: "conv-1",
    sender: "customer",
    direction: "incoming",
    content: "Mensagem inconsistente",
    created_at: "2026-07-19T12:00:00.000Z",
    conversation_session_id: "session-a",
    commercial_session_context_link_id: "missing-context",
    commercial_context_capture_state: "captured",
  });
  tables.conversation_sessions.push({
    id: "session-a",
    organization_id: "org-1",
    store_id: "store-1",
    conversation_id: "conv-1",
  });
  tables.commercial_session_context_links.push({
    id: "context-b",
    organization_id: "org-1",
    store_id: "store-1",
    conversation_session_id: "session-a",
    customer_id: "customer-b",
    commercial_opportunity_id: "opportunity-b",
    lead_customer_link_id: "lead-link-b",
  });

  const summary = await buildSummary(tables, "message-inconsistent");

  assert.deepEqual(summary?.relatedMessageCommercialContext, {
    messageId: "message-inconsistent",
    captureState: "captured",
    historicalContextStatus: "inconsistent",
    conversationSessionId: "session-a",
    commercialSessionContextLinkId: "missing-context",
    customerId: null,
    commercialOpportunityId: null,
    leadCustomerLinkId: null,
  });
});

test("calls without relatedMessageId remain compatible", async () => {
  const tables = createBaseTables();

  const summary = await buildSummary(tables);

  assert.equal(summary?.contractNumber, "CT-1");
  assert.equal(summary?.relatedMessageCommercialContext, undefined);
  assert.equal(summary?.latestCustomerMessage, "Mensagem atual");
});

test("relatedMessageId from another conversation is not accepted", async () => {
  const tables = createBaseTables();
  tables.messages.push({
    id: "message-other-conversation",
    organization_id: "org-1",
    store_id: "store-1",
    conversation_id: "conv-2",
    sender: "customer",
    direction: "incoming",
    content: "Mensagem fora do escopo",
    created_at: "2026-07-19T12:00:00.000Z",
    conversation_session_id: "session-other",
    commercial_session_context_link_id: "context-other",
    commercial_context_capture_state: "captured",
  });
  tables.conversation_sessions.push({
    id: "session-other",
    organization_id: "org-1",
    store_id: "store-1",
    conversation_id: "conv-2",
  });
  tables.commercial_session_context_links.push({
    id: "context-other",
    organization_id: "org-1",
    store_id: "store-1",
    conversation_session_id: "session-other",
    customer_id: "customer-other",
    commercial_opportunity_id: "opportunity-other",
    lead_customer_link_id: "lead-link-other",
  });

  const summary = await buildSummary(tables, "message-other-conversation");

  assert.deepEqual(summary?.relatedMessageCommercialContext, {
    messageId: "message-other-conversation",
    captureState: "captured",
    historicalContextStatus: "inconsistent",
    conversationSessionId: "session-other",
    commercialSessionContextLinkId: "context-other",
    customerId: null,
    commercialOpportunityId: null,
    leadCustomerLinkId: null,
  });
  assert.equal(summary?.latestCustomerMessage, "Mensagem atual");
});

test("relatedMessageId without conversationId stays explicit and safe", async () => {
  const tables = createBaseTables();
  tables.messages.push({
    id: "message-no-conversation-input",
    organization_id: "org-1",
    store_id: "store-1",
    conversation_id: "conv-hidden",
    sender: "customer",
    direction: "incoming",
    content: "Mensagem historica sem conversa esperada",
    created_at: "2026-07-19T12:00:00.000Z",
    conversation_session_id: "session-hidden",
    commercial_session_context_link_id: "context-hidden",
    commercial_context_capture_state: "captured",
  });

  const summary = await buildSummaryWithoutConversation(
    tables,
    "message-no-conversation-input"
  );

  assert.deepEqual(summary?.relatedMessageCommercialContext, {
    messageId: "message-no-conversation-input",
    captureState: null,
    historicalContextStatus: "inconsistent",
    conversationSessionId: null,
    commercialSessionContextLinkId: null,
    customerId: null,
    commercialOpportunityId: null,
    leadCustomerLinkId: null,
  });
});
