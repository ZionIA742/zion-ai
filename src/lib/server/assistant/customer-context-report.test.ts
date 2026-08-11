import test from "node:test";
import assert from "node:assert/strict";

const { buildCustomerContextReportMetadata } = await import(
  new URL("./customer-context-report.js", import.meta.url).href
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

function createTables() {
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
        content: "Mensagem textual atual",
        metadata: { source: "whatsapp" },
        created_at: "2026-07-20T12:00:00.000Z",
        conversation_session_id: null,
        commercial_session_context_link_id: null,
        commercial_context_capture_state: "legacy_unknown",
      },
      {
        id: "message-related",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-1",
        sender: "customer",
        direction: "incoming",
        content: "Mensagem historica relacionada",
        metadata: { source: "whatsapp" },
        created_at: "2026-07-19T12:00:00.000Z",
        conversation_session_id: "session-a",
        commercial_session_context_link_id: "context-a",
        commercial_context_capture_state: "captured",
      },
    ],
    conversation_sessions: [
      {
        id: "session-a",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-1",
      },
    ],
    commercial_session_context_links: [
      {
        id: "context-a",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_session_id: "session-a",
        customer_id: "customer-a",
        commercial_opportunity_id: "opportunity-a",
        lead_customer_link_id: "lead-link-a",
      },
    ],
    sales_contracts: [
      {
        id: "contract-1",
        organization_id: "org-1",
        store_id: "store-1",
        lead_id: "lead-1",
        conversation_id: "conv-1",
        quote_id: "quote-1",
        contract_number: "CT-1",
        status: "sent",
        sent_at: "2026-07-20T09:00:00.000Z",
        customer_signed_at: null,
        completed_at: null,
        created_at: "2026-07-20T08:00:00.000Z",
      },
    ],
    sales_quotes: [
      {
        id: "quote-1",
        organization_id: "org-1",
        store_id: "store-1",
        lead_id: "lead-1",
        conversation_id: "conv-1",
        quote_number: "Q-1",
        status: "sent",
        total_cents: 123456,
        approved_at: null,
        sent_at: "2026-07-20T07:00:00.000Z",
      },
    ],
    store_appointments: [],
    store_assistant_operational_tasks: [
      {
        id: "task-1",
        organization_id: "org-1",
        store_id: "store-1",
        related_conversation_id: "conv-1",
        related_lead_id: "lead-1",
        task_type: "commercial_followup",
        status: "open",
        customer_name: "Lead Atual",
        customer_phone: "11999999999",
        task_payload: {
          handoff_origin: "ai_sales",
          recommended_model: "Modelo X",
          customer_preferences: "Quer algo para lazer",
        },
        updated_at: "2026-07-20T10:00:00.000Z",
      },
    ],
  };

  return tables;
}

async function buildMetadata(
  tables: Record<string, Row[]>,
  relatedMessageId?: string | null
) {
  return buildCustomerContextReportMetadata({
    supabase: new FakeSupabase(tables),
    organizationId: "org-1",
    storeId: "store-1",
    leadId: "lead-1",
    conversationId: "conv-1",
    quoteId: "quote-1",
    quoteNumber: "Q-1",
    customerName: "Lead Atual",
    trigger: "customer_requested_contract",
    source: "assistant",
    relatedMessageId,
  });
}

test("report exposes historical context separately from current commercial state", async () => {
  const metadata = await buildMetadata(createTables(), "message-related");

  assert.equal(metadata.related_message_commercial_context?.historicalContextStatus, "captured");
  assert.equal(metadata.related_message_commercial_context?.customerId, "customer-a");
  assert.match(metadata.narrative, /Contexto historico comprovado da mensagem relacionada/);
  assert.match(metadata.narrative, /No momento, o contrato já foi enviado ao cliente\./);
});

test("report remains compatible without relatedMessageId", async () => {
  const metadata = await buildMetadata(createTables(), null);

  assert.equal(metadata.related_message_commercial_context, null);
  assert.doesNotMatch(metadata.narrative, /Contexto historico da mensagem relacionada/);
  assert.equal(metadata.related_message_id, null);
});

test("report keeps historical message separate from the latest current message", async () => {
  const tables = createTables();
  tables.messages.unshift({
    id: "message-current-b",
    organization_id: "org-1",
    store_id: "store-1",
    conversation_id: "conv-1",
    sender: "customer",
    direction: "incoming",
    content: "Texto B da mensagem atual",
    metadata: { source: "whatsapp" },
    created_at: "2026-07-21T12:00:00.000Z",
    conversation_session_id: null,
    commercial_session_context_link_id: null,
    commercial_context_capture_state: "legacy_unknown",
  });
  const metadata = await buildMetadata(tables, "message-related");

  assert.match(metadata.narrative, /Contexto historico comprovado da mensagem relacionada/);
  assert.match(metadata.narrative, /Na última mensagem, o cliente disse: "Texto B da mensagem atual"\./);
  assert.doesNotMatch(metadata.narrative, /Na última mensagem, o cliente disse: "Mensagem historica relacionada"\./);
});

test("report never uses the historical message as latest current message fallback", async () => {
  const tables = createTables();
  tables.messages = tables.messages.filter((row) => row.id === "message-related");

  const metadata = await buildMetadata(tables, "message-related");

  assert.match(metadata.narrative, /Contexto historico comprovado da mensagem relacionada/);
  assert.doesNotMatch(metadata.narrative, /Na última mensagem, o cliente disse:/);
});

test("report rejects relatedMessageId from another conversation in the same organization", async () => {
  const tables = createTables();
  tables.messages.push({
    id: "message-other-conversation",
    organization_id: "org-1",
    store_id: "store-1",
    conversation_id: "conv-2",
    sender: "customer",
    direction: "incoming",
    content: "Mensagem historica fora da conversa",
    metadata: { source: "whatsapp" },
    created_at: "2026-07-21T09:00:00.000Z",
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

  const metadata = await buildMetadata(tables, "message-other-conversation");

  assert.equal(
    metadata.related_message_commercial_context?.historicalContextStatus,
    "inconsistent"
  );
  assert.match(metadata.narrative, /snapshot existe, mas esta inconsistente/);
  assert.doesNotMatch(metadata.narrative, /Mensagem historica fora da conversa/);
});
