import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHistoricalCommercialContextBlock,
  buildModelInput,
  generateAiSalesReply,
  loadCommercialSnapshotBatch,
  loadScopedRecentMessages,
  resolveGenerationAnchorMessage,
  resolveMessagesWithCommercialContext,
  selectMessagesForCurrentCommercialInference,
} from "./generate-ai-sales-reply.js";

type Row = Record<string, unknown>;
type ResolveMessagesArgs = Parameters<typeof resolveMessagesWithCommercialContext>[0];
type TestMessage = ResolveMessagesArgs["messages"][number];
type TestSession = ResolveMessagesArgs["conversationSessions"][number];
type TestLink = ResolveMessagesArgs["commercialContextLinks"][number];

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private readonly rows: Row[];
  private readonly error: { message: string } | null;

  constructor(rows: Row[], error?: { message: string } | null) {
    this.rows = rows;
    this.error = error || null;
  }

  select(columns: string) {
    void columns;
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value);
    return this;
  }

  in(field: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[field]));
    return this;
  }

  order(field: string, options?: { ascending?: boolean }) {
    void field;
    void options;
    return this;
  }

  limit(value: number) {
    void value;
    return this;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((
          value: { data: Row[]; error: { message: string } | null }
        ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute() {
    if (this.error) {
      return {
        data: [] as Row[],
        error: this.error,
      };
    }

    let result = [...this.rows];

    for (const filter of this.filters) {
      result = result.filter(filter);
    }

    return {
      data: result,
      error: null,
    };
  }
}

class FakeSupabase {
  readonly fromCalls: string[] = [];
  private readonly tables: Record<string, Row[]>;
  private readonly tableErrors: Record<string, { message: string } | null>;

  constructor(
    tables: Record<string, Row[]>,
    tableErrors?: Record<string, { message: string } | null>
  ) {
    this.tables = tables;
    this.tableErrors = tableErrors || {};
  }

  from(table: string) {
    this.fromCalls.push(table);
    return new FakeQuery(this.tables[table] || [], this.tableErrors[table] || null);
  }
}

function createMessage(overrides: Partial<TestMessage>): TestMessage {
  return {
    id: "message-default",
    organization_id: "org-1",
    store_id: "store-1",
    conversation_id: "conv-1",
    sender: "user",
    content: "mensagem",
    direction: "incoming",
    message_type: "text",
    media_url: null,
    metadata: null,
    created_at: "2026-07-22T10:00:00.000Z",
    conversation_session_id: null,
    commercial_session_context_link_id: null,
    commercial_context_capture_state: "legacy_unknown",
    ...overrides,
  };
}

function resolveScenario(args: {
  messages: TestMessage[];
  anchorMessageId: string;
  sessions?: TestSession[];
  links?: TestLink[];
}) {
  const resolved = resolveMessagesWithCommercialContext({
    messages: args.messages,
    anchorMessageId: args.anchorMessageId,
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    conversationSessions: args.sessions || [],
    commercialContextLinks: args.links || [],
    resolutionFailed: false,
  });

  return {
    ...resolved,
    inferenceMessages: selectMessagesForCurrentCommercialInference({
      annotatedMessages: resolved.annotatedMessages,
      responseAnchorCommercialContext: resolved.responseAnchorCommercialContext,
    }),
  };
}

function flattenModelText(args: {
  semanticBlock?: string | null;
  input?: Array<{ role: string; content: string }>;
  instructions?: string | null;
}) {
  return [
    args.instructions || "",
    args.semanticBlock || "",
    ...(args.input || []).map((message) => message.content),
  ].join("\n");
}

function buildCurrentStateFixtureText() {
  return [
    "- conversation.status atual: open",
    "- lead.state atual: qualified",
    "- humanActive atual: nao",
  ].join("\n");
}

test("scoped recent messages query filters by conversation organization and store", async () => {
  const supabase = new FakeSupabase({
    messages: [
      createMessage({ id: "msg-valid" }),
      createMessage({ id: "msg-other-org", organization_id: "org-2" }),
      createMessage({ id: "msg-other-store", store_id: "store-2" }),
      createMessage({ id: "msg-other-conversation", conversation_id: "conv-2" }),
    ],
  });

  const result = await loadScopedRecentMessages({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
  });

  assert.equal(result.error, null);
  assert.deepEqual(
    (result.data || []).map((message) => message.id),
    ["msg-valid"]
  );
  assert.deepEqual(supabase.fromCalls, ["messages"]);
});

test("captured anchor keeps other historical context out of current commercial inference", () => {
  const scenario = resolveScenario({
    anchorMessageId: "msg-b",
    messages: [
      createMessage({
        id: "msg-a",
        content: "quero a opcao economica antiga",
        conversation_session_id: "session-a",
        commercial_session_context_link_id: "context-a",
        commercial_context_capture_state: "captured",
      }),
      createMessage({
        id: "msg-b",
        content: "agora quero fechar a opcao premium",
        created_at: "2026-07-22T11:00:00.000Z",
        conversation_session_id: "session-b",
        commercial_session_context_link_id: "context-b",
        commercial_context_capture_state: "captured",
      }),
    ],
    sessions: [
      {
        id: "session-a",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-1",
        status: "closed",
      },
      {
        id: "session-b",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-1",
        status: "active",
      },
    ],
    links: [
      {
        id: "context-a",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_session_id: "session-a",
        customer_id: "customer-a",
        commercial_opportunity_id: "opp-a",
        lead_customer_link_id: "lead-link-a",
        status: "inactive",
      },
      {
        id: "context-b",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_session_id: "session-b",
        customer_id: "customer-b",
        commercial_opportunity_id: "opp-b",
        lead_customer_link_id: "lead-link-b",
        status: "active",
      },
    ],
  });

  const olderMessage = scenario.annotatedMessages.find((message: Row) => message.id === "msg-a");
  assert.equal(olderMessage?.anchorHistoricalContextRelation, "other_historical_context");
  assert.deepEqual(
    scenario.inferenceMessages.map((message: Row) => message.id),
    ["msg-b"]
  );
  assert.equal(
    scenario.responseAnchorCommercialContext?.commercialOpportunityId,
    "opp-b"
  );
});

test("explicit anchor preserves A1 even when A2 is the latest customer message", () => {
  const messages = [
    createMessage({
      id: "msg-a1",
      content: "quero seguir com a proposta A",
      created_at: "2026-07-22T10:00:00.000Z",
      conversation_session_id: "session-a",
      commercial_session_context_link_id: "context-a",
      commercial_context_capture_state: "captured",
    }),
    createMessage({
      id: "msg-a2",
      content: "agora apareceu outra mensagem mais nova",
      created_at: "2026-07-22T11:00:00.000Z",
      conversation_session_id: "session-b",
      commercial_session_context_link_id: "context-b",
      commercial_context_capture_state: "captured",
    }),
  ];
  const anchor = resolveGenerationAnchorMessage({
    messages,
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    explicitAnchorMessageId: "msg-a1",
  });

  assert.equal(anchor.ok, true);
  if (!anchor.ok) {
    return;
  }

  const resolved = resolveMessagesWithCommercialContext({
    messages,
    anchorMessageId: anchor.anchorMessageId,
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    conversationSessions: [
      {
        id: "session-a",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-1",
        status: "closed",
      },
      {
        id: "session-b",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-1",
        status: "active",
      },
    ],
    commercialContextLinks: [
      {
        id: "context-a",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_session_id: "session-a",
        customer_id: "customer-a",
        commercial_opportunity_id: "opp-a",
        lead_customer_link_id: "lead-link-a",
        status: "inactive",
      },
      {
        id: "context-b",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_session_id: "session-b",
        customer_id: "customer-b",
        commercial_opportunity_id: "opp-b",
        lead_customer_link_id: "lead-link-b",
        status: "active",
      },
    ],
    resolutionFailed: false,
  });

  assert.equal(anchor.anchorMessageId, "msg-a1");
  assert.equal(anchor.fallbackUsed, false);
  assert.equal(
    resolved.responseAnchorCommercialContext?.commercialOpportunityId,
    "opp-a"
  );
  assert.equal(
    resolved.responseAnchorCommercialContext?.messageId,
    "msg-a1"
  );
});

test("explicit anchor outside scope or missing fails safely without fallback to latest", () => {
  const messages = [
    createMessage({
      id: "msg-a1",
      content: "primeira ancora valida",
      created_at: "2026-07-22T10:00:00.000Z",
      conversation_session_id: "session-a",
      commercial_session_context_link_id: "context-a",
      commercial_context_capture_state: "captured",
    }),
    createMessage({
      id: "msg-a2",
      content: "mensagem mais recente",
      created_at: "2026-07-22T11:00:00.000Z",
      conversation_session_id: "session-b",
      commercial_session_context_link_id: "context-b",
      commercial_context_capture_state: "captured",
    }),
  ];

  const missing = resolveGenerationAnchorMessage({
    messages,
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    explicitAnchorMessageId: "msg-missing",
  });
  const outOfScope = resolveGenerationAnchorMessage({
    messages: [
      ...messages,
      createMessage({
        id: "msg-foreign",
        organization_id: "org-2",
        store_id: "store-1",
        conversation_id: "conv-1",
        content: "nao pertence ao escopo",
      }),
    ],
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    explicitAnchorMessageId: "msg-foreign",
  });

  assert.deepEqual(missing, {
    ok: false,
    error: "INVALID_GENERATION_ANCHOR_MESSAGE",
    message: "A mensagem-ancora explicita nao foi encontrada no escopo carregado da conversa.",
  });
  assert.deepEqual(outOfScope, {
    ok: false,
    error: "INVALID_GENERATION_ANCHOR_MESSAGE",
    message: "A mensagem-ancora explicita nao pertence ao escopo esperado da execucao.",
  });
});

test("missing explicit anchor fails safely instead of falling back to the latest eligible message", () => {
  const messages = [
    createMessage({
      id: "msg-a1",
      content: "mensagem anterior",
      created_at: "2026-07-22T10:00:00.000Z",
    }),
    createMessage({
      id: "msg-a2",
      content: "mensagem mais recente",
      created_at: "2026-07-22T11:00:00.000Z",
    }),
  ];

  const anchor = resolveGenerationAnchorMessage({
    messages,
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    explicitAnchorMessageId: "",
  });

  assert.deepEqual(anchor, {
    ok: false,
    error: "MISSING_GENERATION_ANCHOR_MESSAGE",
    message: "A geracao comercial exige uma mensagem-ancora explicita e valida.",
  });
});

test("generateAiSalesReply fails on empty anchor before env validation", async () => {
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const result = await generateAiSalesReply({
      organizationId: "org-1",
      storeId: "store-1",
      conversationId: "conv-1",
      anchorMessageId: "   ",
    });

    assert.deepEqual(result, {
      ok: false,
      error: "MISSING_GENERATION_ANCHOR_MESSAGE",
      message: "A geracao comercial exige uma mensagem-ancora explicita e valida.",
    });
  } finally {
    if (originalSupabaseUrl == null) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    }

    if (originalSupabaseKey == null) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseKey;
    }

    if (originalOpenAiKey == null) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
  }
});

test("pending message in the same session stays in continuity without retroactive entity assignment", () => {
  const scenario = resolveScenario({
    anchorMessageId: "msg-anchor",
    messages: [
      createMessage({
        id: "msg-pending",
        content: "quero ver melhor",
        conversation_session_id: "session-a",
        commercial_context_capture_state: "pending_context",
      }),
      createMessage({
        id: "msg-anchor",
        content: "manda a proposta dessa opcao",
        created_at: "2026-07-22T11:00:00.000Z",
        conversation_session_id: "session-a",
        commercial_session_context_link_id: "context-a",
        commercial_context_capture_state: "captured",
      }),
    ],
    sessions: [
      {
        id: "session-a",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-1",
        status: "active",
      },
    ],
    links: [
      {
        id: "context-a",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_session_id: "session-a",
        customer_id: "customer-a",
        commercial_opportunity_id: "opp-a",
        lead_customer_link_id: "lead-link-a",
        status: "active",
      },
    ],
  });

  const pendingMessage = scenario.annotatedMessages.find(
    (message: Row) => message.id === "msg-pending"
  );
  assert.equal(
    pendingMessage?.anchorHistoricalContextRelation,
    "same_anchor_session_pending"
  );
  assert.equal(pendingMessage?.customerIdResolved, null);
  assert.equal(pendingMessage?.commercialOpportunityIdResolved, null);
  assert.deepEqual(
    scenario.inferenceMessages.map((message: Row) => message.id),
    ["msg-pending", "msg-anchor"]
  );
});

test("pending anchor only keeps the same session and does not invent customer or opportunity", () => {
  const scenario = resolveScenario({
    anchorMessageId: "msg-anchor",
    messages: [
      createMessage({
        id: "msg-same-session",
        conversation_session_id: "session-a",
        commercial_context_capture_state: "pending_context",
      }),
      createMessage({
        id: "msg-other-context",
        conversation_session_id: "session-b",
        commercial_session_context_link_id: "context-b",
        commercial_context_capture_state: "captured",
      }),
      createMessage({
        id: "msg-anchor",
        created_at: "2026-07-22T11:00:00.000Z",
        conversation_session_id: "session-a",
        commercial_context_capture_state: "pending_context",
      }),
    ],
    sessions: [
      {
        id: "session-a",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-1",
        status: "active",
      },
      {
        id: "session-b",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-1",
        status: "closed",
      },
    ],
    links: [
      {
        id: "context-b",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_session_id: "session-b",
        customer_id: "customer-b",
        commercial_opportunity_id: "opp-b",
        lead_customer_link_id: "lead-link-b",
        status: "inactive",
      },
    ],
  });

  assert.equal(scenario.responseAnchorCommercialContext?.customerId, null);
  assert.equal(scenario.responseAnchorCommercialContext?.commercialOpportunityId, null);
  assert.deepEqual(
    scenario.inferenceMessages.map((message: Row) => message.id),
    ["msg-same-session", "msg-anchor"]
  );
});

test("no_active_session and legacy_unknown anchors degrade safely to the anchor itself", () => {
  const noActive = resolveScenario({
    anchorMessageId: "msg-anchor",
    messages: [
      createMessage({
        id: "msg-old",
        conversation_session_id: "session-a",
        commercial_session_context_link_id: "context-a",
        commercial_context_capture_state: "captured",
      }),
      createMessage({
        id: "msg-anchor",
        created_at: "2026-07-22T11:00:00.000Z",
        commercial_context_capture_state: "no_active_session",
      }),
    ],
    sessions: [
      {
        id: "session-a",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-1",
        status: "closed",
      },
    ],
    links: [
      {
        id: "context-a",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_session_id: "session-a",
        customer_id: "customer-a",
        commercial_opportunity_id: "opp-a",
        lead_customer_link_id: "lead-link-a",
        status: "inactive",
      },
    ],
  });
  const legacy = resolveScenario({
    anchorMessageId: "msg-anchor",
    messages: [
      createMessage({ id: "msg-old" }),
      createMessage({
        id: "msg-anchor",
        created_at: "2026-07-22T11:00:00.000Z",
        commercial_context_capture_state: "legacy_unknown",
      }),
    ],
  });

  assert.deepEqual(noActive.inferenceMessages.map((message: Row) => message.id), ["msg-anchor"]);
  assert.deepEqual(legacy.inferenceMessages.map((message: Row) => message.id), ["msg-anchor"]);
});

test("inactive historical links remain valid and cross-scope rows become inconsistent without fallback", () => {
  const validInactive = resolveScenario({
    anchorMessageId: "msg-anchor",
    messages: [
      createMessage({
        id: "msg-anchor",
        conversation_session_id: "session-a",
        commercial_session_context_link_id: "context-a",
        commercial_context_capture_state: "captured",
      }),
    ],
    sessions: [
      {
        id: "session-a",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-1",
        status: "closed",
      },
    ],
    links: [
      {
        id: "context-a",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_session_id: "session-a",
        customer_id: "customer-a",
        commercial_opportunity_id: "opp-a",
        lead_customer_link_id: "lead-link-a",
        status: "inactive",
      },
    ],
  });
  const inconsistent = resolveScenario({
    anchorMessageId: "msg-anchor",
    messages: [
      createMessage({
        id: "msg-anchor",
        conversation_session_id: "session-x",
        commercial_session_context_link_id: "context-x",
        commercial_context_capture_state: "captured",
      }),
    ],
    sessions: [
      {
        id: "session-x",
        organization_id: "org-2",
        store_id: "store-1",
        conversation_id: "conv-1",
        status: "active",
      },
    ],
    links: [
      {
        id: "context-x",
        organization_id: "org-2",
        store_id: "store-1",
        conversation_session_id: "session-x",
        customer_id: "customer-x",
        commercial_opportunity_id: "opp-x",
        lead_customer_link_id: "lead-link-x",
        status: "active",
      },
    ],
  });

  assert.equal(
    validInactive.responseAnchorCommercialContext?.historicalContextStatus,
    "captured"
  );
  assert.equal(
    inconsistent.responseAnchorCommercialContext?.historicalContextStatus,
    "inconsistent"
  );
  assert.equal(inconsistent.responseAnchorCommercialContext?.customerId, null);
});

test("replacement links do not override the frozen historical link", () => {
  const scenario = resolveScenario({
    anchorMessageId: "msg-anchor",
    messages: [
      createMessage({
        id: "msg-anchor",
        conversation_session_id: "session-a",
        commercial_session_context_link_id: "context-original",
        commercial_context_capture_state: "captured",
      }),
    ],
    sessions: [
      {
        id: "session-a",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-1",
        status: "closed",
      },
    ],
    links: [
      {
        id: "context-original",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_session_id: "session-a",
        customer_id: "customer-original",
        commercial_opportunity_id: "opp-original",
        lead_customer_link_id: "lead-link-original",
        status: "inactive",
        replaced_by_context_link_id: "context-replacement",
      } as TestLink,
      {
        id: "context-replacement",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_session_id: "session-a",
        customer_id: "customer-replacement",
        commercial_opportunity_id: "opp-replacement",
        lead_customer_link_id: "lead-link-replacement",
        status: "active",
      },
    ],
  });

  const input = buildModelInput(scenario.annotatedMessages);
  const semanticBlock = buildHistoricalCommercialContextBlock(scenario.annotatedMessages);
  const modelText = flattenModelText({
    semanticBlock,
    input,
    instructions: buildCurrentStateFixtureText(),
  });

  assert.equal(scenario.responseAnchorCommercialContext?.customerId, "customer-original");
  assert.equal(
    scenario.responseAnchorCommercialContext?.commercialOpportunityId,
    "opp-original"
  );
  assert.equal(modelText.includes("customer-replacement"), false);
  assert.equal(modelText.includes("opp-replacement"), false);
  assert.equal(modelText.includes("context-replacement"), false);
});

test("store and conversation scope mismatches become inconsistent without fallback", () => {
  const wrongStore = resolveScenario({
    anchorMessageId: "msg-anchor",
    messages: [
      createMessage({
        id: "msg-anchor",
        conversation_session_id: "session-store",
        commercial_session_context_link_id: "context-store",
        commercial_context_capture_state: "captured",
      }),
    ],
    sessions: [
      {
        id: "session-store",
        organization_id: "org-1",
        store_id: "store-2",
        conversation_id: "conv-1",
        status: "active",
      },
    ],
    links: [
      {
        id: "context-store",
        organization_id: "org-1",
        store_id: "store-2",
        conversation_session_id: "session-store",
        customer_id: "customer-store",
        commercial_opportunity_id: "opp-store",
        lead_customer_link_id: "lead-link-store",
        status: "active",
      },
    ],
  });
  const wrongConversation = resolveScenario({
    anchorMessageId: "msg-anchor",
    messages: [
      createMessage({
        id: "msg-anchor",
        conversation_session_id: "session-conversation",
        commercial_session_context_link_id: "context-conversation",
        commercial_context_capture_state: "captured",
      }),
    ],
    sessions: [
      {
        id: "session-conversation",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-2",
        status: "active",
      },
    ],
    links: [
      {
        id: "context-conversation",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_session_id: "session-conversation",
        customer_id: "customer-conversation",
        commercial_opportunity_id: "opp-conversation",
        lead_customer_link_id: "lead-link-conversation",
        status: "active",
      },
    ],
  });

  for (const scenario of [wrongStore, wrongConversation]) {
    assert.equal(
      scenario.responseAnchorCommercialContext?.historicalContextStatus,
      "inconsistent"
    );
    assert.equal(scenario.responseAnchorCommercialContext?.customerId, null);
    assert.equal(
      scenario.annotatedMessages[0]?.anchorHistoricalContextRelation,
      "inconsistent"
    );
  }
});

test("invalid link scope or mismatched session keeps captured messages inconsistent and hides uuids", () => {
  const wrongOrganization = resolveScenario({
    anchorMessageId: "msg-org",
    messages: [
      createMessage({
        id: "msg-org",
        conversation_session_id: "session-org",
        commercial_session_context_link_id: "context-org",
        commercial_context_capture_state: "captured",
      }),
    ],
    sessions: [
      {
        id: "session-org",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-1",
        status: "active",
      },
    ],
    links: [
      {
        id: "context-org",
        organization_id: "org-2",
        store_id: "store-1",
        conversation_session_id: "session-org",
        customer_id: "customer-org",
        commercial_opportunity_id: "opp-org",
        lead_customer_link_id: "lead-link-org",
        status: "active",
      },
    ],
  });
  const wrongStore = resolveScenario({
    anchorMessageId: "msg-store",
    messages: [
      createMessage({
        id: "msg-store",
        conversation_session_id: "session-store",
        commercial_session_context_link_id: "context-store",
        commercial_context_capture_state: "captured",
      }),
    ],
    sessions: [
      {
        id: "session-store",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-1",
        status: "active",
      },
    ],
    links: [
      {
        id: "context-store",
        organization_id: "org-1",
        store_id: "store-2",
        conversation_session_id: "session-store",
        customer_id: "customer-store",
        commercial_opportunity_id: "opp-store",
        lead_customer_link_id: "lead-link-store",
        status: "active",
      },
    ],
  });
  const mismatchedSession = resolveScenario({
    anchorMessageId: "msg-mismatch",
    messages: [
      createMessage({
        id: "msg-mismatch",
        conversation_session_id: "session-main",
        commercial_session_context_link_id: "context-mismatch",
        commercial_context_capture_state: "captured",
      }),
    ],
    sessions: [
      {
        id: "session-main",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-1",
        status: "active",
      },
    ],
    links: [
      {
        id: "context-mismatch",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_session_id: "session-other",
        customer_id: "customer-mismatch",
        commercial_opportunity_id: "opp-mismatch",
        lead_customer_link_id: "lead-link-mismatch",
        status: "active",
      },
    ],
  });

  for (const [scenario, leakedValue] of [
    [wrongOrganization, "context-org"],
    [wrongStore, "context-store"],
    [mismatchedSession, "context-mismatch"],
  ] as const) {
    const modelText = flattenModelText({
      semanticBlock: buildHistoricalCommercialContextBlock(scenario.annotatedMessages),
      input: buildModelInput(scenario.annotatedMessages),
      instructions: buildCurrentStateFixtureText(),
    });

    assert.equal(
      scenario.responseAnchorCommercialContext?.historicalContextStatus,
      "inconsistent"
    );
    assert.equal(scenario.responseAnchorCommercialContext?.customerId, null);
    assert.equal(modelText.includes(leakedValue), false);
  }
});

test("batch loading deduplicates ids into one sessions query and one links query", async () => {
  const supabase = new FakeSupabase({
    conversation_sessions: [
      {
        id: "session-a",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-1",
        status: "active",
      },
    ],
    commercial_session_context_links: [
      {
        id: "context-a",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_session_id: "session-a",
        customer_id: "customer-a",
        commercial_opportunity_id: "opp-a",
        lead_customer_link_id: "lead-link-a",
        status: "active",
      },
    ],
  });

  const result = await loadCommercialSnapshotBatch({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    messages: [
      createMessage({
        id: "msg-1",
        conversation_session_id: "session-a",
        commercial_session_context_link_id: "context-a",
        commercial_context_capture_state: "captured",
      }),
      createMessage({
        id: "msg-2",
        conversation_session_id: "session-a",
        commercial_session_context_link_id: "context-a",
        commercial_context_capture_state: "captured",
      }),
    ],
  });

  assert.equal(result.conversationSessions.length, 1);
  assert.equal(result.commercialContextLinks.length, 1);
  assert.deepEqual(supabase.fromCalls, [
    "conversation_sessions",
    "commercial_session_context_links",
  ]);
});

test("batch loading degrades safely when sessions query fails", async () => {
  const supabase = new FakeSupabase(
    {
      commercial_session_context_links: [],
    },
    {
      conversation_sessions: { message: "session batch failed" },
    }
  );

  const batch = await loadCommercialSnapshotBatch({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    messages: [
      createMessage({
        id: "msg-anchor",
        conversation_session_id: "session-a",
        commercial_context_capture_state: "pending_context",
      }),
    ],
  });
  const scenario = resolveMessagesWithCommercialContext({
    messages: [
      createMessage({
        id: "msg-anchor",
        conversation_session_id: "session-a",
        commercial_context_capture_state: "pending_context",
      }),
    ],
    anchorMessageId: "msg-anchor",
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    conversationSessions: batch.conversationSessions,
    commercialContextLinks: batch.commercialContextLinks,
    resolutionFailed: batch.resolutionFailed,
  });

  assert.equal(batch.resolutionFailed, true);
  assert.equal(
    scenario.responseAnchorCommercialContext?.historicalContextStatus,
    "inconsistent"
  );
  assert.deepEqual(supabase.fromCalls, ["conversation_sessions"]);
  assert.equal(buildModelInput(scenario.annotatedMessages)[0]?.content.length > 0, true);
});

test("batch loading degrades safely when context links query fails", async () => {
  const supabase = new FakeSupabase(
    {
      conversation_sessions: [
        {
          id: "session-a",
          organization_id: "org-1",
          store_id: "store-1",
          conversation_id: "conv-1",
          status: "active",
        },
      ],
    },
    {
      commercial_session_context_links: { message: "link batch failed" },
    }
  );

  const batch = await loadCommercialSnapshotBatch({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    messages: [
      createMessage({
        id: "msg-anchor",
        conversation_session_id: "session-a",
        commercial_session_context_link_id: "context-a",
        commercial_context_capture_state: "captured",
      }),
    ],
  });
  const scenario = resolveMessagesWithCommercialContext({
    messages: [
      createMessage({
        id: "msg-anchor",
        conversation_session_id: "session-a",
        commercial_session_context_link_id: "context-a",
        commercial_context_capture_state: "captured",
      }),
    ],
    anchorMessageId: "msg-anchor",
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    conversationSessions: batch.conversationSessions,
    commercialContextLinks: batch.commercialContextLinks,
    resolutionFailed: batch.resolutionFailed,
  });

  assert.equal(batch.resolutionFailed, true);
  assert.equal(
    scenario.responseAnchorCommercialContext?.historicalContextStatus,
    "inconsistent"
  );
  assert.deepEqual(supabase.fromCalls, [
    "conversation_sessions",
    "commercial_session_context_links",
  ]);
  assert.equal(buildModelInput(scenario.annotatedMessages)[0]?.content.length > 0, true);
});

test("historical block and model input keep M markers aligned and never expose UUIDs", () => {
  const scenario = resolveScenario({
    anchorMessageId: "msg-b",
    messages: [
      createMessage({
        id: "msg-a",
        content: "mensagem antiga",
        conversation_session_id: "session-a",
        commercial_session_context_link_id: "context-a",
        commercial_context_capture_state: "captured",
      }),
      createMessage({
        id: "msg-b",
        content: "mensagem atual",
        created_at: "2026-07-22T11:00:00.000Z",
        conversation_session_id: "session-b",
        commercial_session_context_link_id: "context-b",
        commercial_context_capture_state: "captured",
      }),
    ],
    sessions: [
      {
        id: "session-a",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-1",
        status: "closed",
      },
      {
        id: "session-b",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_id: "conv-1",
        status: "active",
      },
    ],
    links: [
      {
        id: "context-a",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_session_id: "session-a",
        customer_id: "customer-a",
        commercial_opportunity_id: "opp-a",
        lead_customer_link_id: "lead-link-a",
        status: "inactive",
      },
      {
        id: "context-b",
        organization_id: "org-1",
        store_id: "store-1",
        conversation_session_id: "session-b",
        customer_id: "customer-b",
        commercial_opportunity_id: "opp-b",
        lead_customer_link_id: "lead-link-b",
        status: "active",
      },
    ],
  });

  const semanticBlock = buildHistoricalCommercialContextBlock(
    scenario.annotatedMessages
  );
  const input = buildModelInput(scenario.annotatedMessages);

  assert.match(semanticBlock, /M01/);
  assert.match(semanticBlock, /M02/);
  assert.equal(input[0].content.startsWith("[M01]"), true);
  assert.equal(input[1].content.startsWith("[M02]"), true);
  assert.equal(semanticBlock.includes("context-a"), false);
  assert.equal(semanticBlock.includes("opp-a"), false);
  assert.equal(input.some((message: Row) => String(message.content).includes("context-a")), false);
});

test("legacy unknown keeps no proven historical context while preserving text continuity", () => {
  const scenario = resolveScenario({
    anchorMessageId: "msg-anchor",
    messages: [
      createMessage({
        id: "msg-anchor",
        content: "quero entender melhor essa piscina",
        commercial_context_capture_state: "legacy_unknown",
      }),
    ],
  });
  const semanticBlock = buildHistoricalCommercialContextBlock(scenario.annotatedMessages);
  const input = buildModelInput(scenario.annotatedMessages);
  const modelText = flattenModelText({
    semanticBlock,
    input,
    instructions: buildCurrentStateFixtureText(),
  });

  assert.equal(
    scenario.responseAnchorCommercialContext?.historicalContextStatus,
    "legacy_unknown"
  );
  assert.equal(
    scenario.annotatedMessages[0]?.anchorHistoricalContextRelation,
    "no_proven_historical_context"
  );
  assert.equal(scenario.responseAnchorCommercialContext?.customerId, null);
  assert.equal(input[0]?.content.includes("quero entender melhor essa piscina"), true);
  assert.equal(modelText.includes("conversation_session_id"), false);
  assert.equal(modelText.includes("commercial_session_context_link_id"), false);
});

test("model-facing text never leaks internal ids across instructions semantic block and input", () => {
  const scenario = resolveScenario({
    anchorMessageId: "msg-anchor",
    messages: [
      createMessage({
        id: "msg-anchor",
        content: "quero fechar essa opcao",
        commercial_context_capture_state: "legacy_unknown",
      }),
      createMessage({
        id: "msg-second",
        content: "manda mais detalhes",
        created_at: "2026-07-22T11:00:00.000Z",
        commercial_context_capture_state: "no_active_session",
      }),
    ],
  });

  const semanticBlock = buildHistoricalCommercialContextBlock(scenario.annotatedMessages);
  const input = buildModelInput(scenario.annotatedMessages);
  const modelText = flattenModelText({
    instructions: [
      buildCurrentStateFixtureText(),
      "ESTADO COMERCIAL ATUAL",
      "CONTEXTO COMERCIAL DAS MENSAGENS NO MOMENTO DO ENVIO",
    ].join("\n"),
    semanticBlock,
    input,
  });

  for (const forbidden of [
    "conversation_session_id",
    "commercial_session_context_link_id",
    "customer_id",
    "commercial_opportunity_id",
    "lead_customer_link_id",
    "session-a",
    "context-a",
    "customer-a",
    "opp-a",
    "lead-link-a",
  ]) {
    assert.equal(modelText.includes(forbidden), false);
  }
});

test("conversations without proven historical context still build valid input from text only", () => {
  const scenario = resolveScenario({
    anchorMessageId: "msg-anchor",
    messages: [
      createMessage({
        id: "msg-legacy",
        content: "tenho interesse",
        commercial_context_capture_state: "legacy_unknown",
      }),
      createMessage({
        id: "msg-anchor",
        content: "qual o valor",
        created_at: "2026-07-22T11:00:00.000Z",
        commercial_context_capture_state: "no_active_session",
      }),
    ],
  });

  const currentCommercialInference = selectMessagesForCurrentCommercialInference({
    annotatedMessages: scenario.annotatedMessages,
    responseAnchorCommercialContext: scenario.responseAnchorCommercialContext,
  });
  const input = buildModelInput(scenario.annotatedMessages);

  assert.deepEqual(
    currentCommercialInference.map((message) => message.id),
    ["msg-anchor"]
  );
  assert.equal(input.length, 2);
  assert.equal(input[0]?.content.includes("tenho interesse"), true);
  assert.equal(input[1]?.content.includes("qual o valor"), true);
  assert.equal(
    scenario.responseAnchorCommercialContext?.historicalContextStatus,
    "no_active_session"
  );
});
