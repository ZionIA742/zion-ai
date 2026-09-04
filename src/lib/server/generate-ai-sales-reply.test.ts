import { buildSalesResponseBrain } from "./ai-sales-response-brain";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  type CommercialMessageIntentDecisionKind,
  buildHistoricalCommercialContextBlock,
  buildModelInput,
  buildCommercialObjectiveBlock,
  describeCanonicalKnownFact,
  generateAiSalesReply,
  loadAnchoredCanonicalCommercialContext,
  loadCanonicalCommercialOpportunityStage,
  loadCanonicalQualificationSnapshotBySystem,
  loadCommercialSnapshotBatch,
  materializeCommercialOpportunityProfileFromQualificationBySystem,
  inferNonQualificationNextBestQuestion,
  inferForbiddenInThisReply,
  resolveQualificationProfileInstallationEvidenceState,
  resolveNextBestQuestionAfterQualificationAuthority,
  resolveContextualQualificationDecision,
  loadScopedRecentMessages,
  resolveGenerationAnchorMessage,
  resolveMessagesWithCommercialContext,
  summarizeCanonicalKnownFacts,
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

  async maybeSingle() {
    const result = await this.execute();
    return {
      data: result.data[0] || null,
      error: result.error,
    };
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
  readonly rpcCalls: Array<{ fn: string; payload: Record<string, unknown> }> = [];
  private readonly tables: Record<string, Row[]>;
  private readonly tableErrors: Record<string, { message: string } | null>;
  private readonly rpcResults: Record<
    string,
    | { data: unknown; error: { message: string } | null }
    | Array<{ data: unknown; error: { message: string } | null }>
    | ((payload: Record<string, unknown>) => { data: unknown; error: { message: string } | null })
  >;

  constructor(
    tables: Record<string, Row[]>,
    tableErrors?: Record<string, { message: string } | null>,
    rpcResults?: Record<string, RpcMockEntry>
  ) {
    this.tables = tables;
    this.tableErrors = tableErrors || {};
    this.rpcResults = rpcResults || {};
  }

  from(table: string) {
    this.fromCalls.push(table);
    return new FakeQuery(this.tables[table] || [], this.tableErrors[table] || null);
  }

  async rpc(fn: string, payload: Record<string, unknown>) {
    this.rpcCalls.push({ fn, payload });
    const configured = this.rpcResults[fn];

    if (Array.isArray(configured)) {
      return (
        configured.shift() || {
          data: null,
          error: { message: `missing rpc mock for ${fn}` },
        }
      );
    }

    if (typeof configured === "function") {
      return configured(payload);
    }

    return configured || {
      data: null,
      error: { message: `missing rpc mock for ${fn}` },
    };
  }
}

class FakeOpenAi {
  readonly calls: unknown[] = [];
  private readonly responsesQueue: unknown[];

  constructor(responsesQueue: unknown[]) {
    this.responsesQueue = [...responsesQueue];
  }

  responses = {
    create: async (payload: unknown) => {
      this.calls.push(payload);
      if (this.responsesQueue.length === 0) {
        throw new Error("missing openai response mock");
      }
      return this.responsesQueue.shift();
    },
  };
}

type RpcMockEntry =
  | { data: unknown; error: { message: string } | null }
  | Array<{ data: unknown; error: { message: string } | null }>
  | ((payload: Record<string, unknown>) => { data: unknown; error: { message: string } | null });

function createCommercialOpportunityStageSupabase(args?: {
  stage?: string | null;
  rowMissing?: boolean;
  rowId?: string | null;
  errorMessage?: string | null;
}) {
  const queries: Array<{ eq: Array<{ column: string; value: unknown }> }> = [];

  return {
    queries,
    client: {
      from(table: string) {
        assert.equal(table, "commercial_opportunities");

        const state = {
          eq: [] as Array<{ column: string; value: unknown }>,
        };

        return {
          select(_selection: string) {
            return this;
          },
          eq(column: string, value: unknown) {
            state.eq.push({ column, value });
            return this;
          },
          async maybeSingle() {
            queries.push(state);

            if (args?.errorMessage) {
              return { data: null, error: { message: args.errorMessage } };
            }

            if (args?.rowMissing) {
              return { data: null, error: null };
            }

            const filteredId =
              state.eq.find((entry) => entry.column === "id")?.value ?? "opp-canonical";
            const rowId =
              Object.prototype.hasOwnProperty.call(args ?? {}, "rowId")
                ? (args?.rowId ?? null)
                : filteredId;

            return {
              data: {
                id: rowId,
                stage: args?.stage ?? "novo_lead",
              },
              error: null,
            };
          },
        };
      },
    },
  };
}

function createCanonicalQualificationReaderRow(args?: {
  organizationId?: string;
  storeId?: string;
  commercialOpportunityId?: string;
  knownFacts?: Row[];
  missingFactGroups?: Row[];
  conflicts?: Row[];
  provenanceSummary?: Row;
  canAskNextQuestion?: boolean;
  knownFactCount?: number;
  missingGroupCount?: number;
  conflictCount?: number;
}) {
  const knownFacts = args?.knownFacts ?? [];
  const missingFactGroups = args?.missingFactGroups ?? [];
  const conflicts = args?.conflicts ?? [];

  return {
    organization_id: args?.organizationId ?? "org-1",
    store_id: args?.storeId ?? "store-1",
    commercial_opportunity_id: args?.commercialOpportunityId ?? "opp-1",
    known_facts: knownFacts,
    missing_fact_groups: missingFactGroups,
    conflicts,
    provenance_summary:
      args?.provenanceSummary ?? {
        knownFactCount: knownFacts.length,
        confirmedCount: knownFacts.length,
        inferredCount: 0,
        conflictCount: conflicts.length,
        messageBackedCount: 0,
        conversationBackedCount: 0,
        sourceCounts: {
          system_correction: knownFacts.length,
        },
      },
    can_ask_next_question: args?.canAskNextQuestion ?? missingFactGroups.length > 0,
    known_fact_count: args?.knownFactCount ?? knownFacts.length,
    missing_group_count: args?.missingGroupCount ?? missingFactGroups.length,
    conflict_count: args?.conflictCount ?? conflicts.length,
  };
}

function createCanonicalKnownFact(args: {
  factKey: string;
  valueKind?: string;
  value?: unknown;
  normalizedValueText?: string | null;
  state?: "confirmed" | "inferred";
  sourceType?:
    | "incoming_customer_message"
    | "crm_manual"
    | "system_inference"
    | "system_correction"
    | "migration_backfill";
}) {
  return {
    factKey: args.factKey,
    state: args.state ?? "confirmed",
    valueKind: args.valueKind ?? "text",
    value: args.value ?? args.normalizedValueText ?? args.factKey,
    normalizedValueText: args.normalizedValueText ?? null,
    sourceType: args.sourceType ?? "system_correction",
    sourceMessageId: null,
    sourceConversationId: null,
    lastEventId: null,
    lastOperationKey: null,
    updatedAt: null,
  };
}

function createCanonicalMissingGroup(args: {
  groupKey: "need" | "space" | "location" | "installation" | "payment";
  status?: "missing" | "conflict";
  factKeys: Array<
    | "need_summary"
    | "interested_product_reference"
    | "space_text"
    | "requested_area_m2"
    | "location_text"
    | "preferred_period_text"
    | "budget_text"
    | "decision_context"
    | "installation_interest"
    | "payment_interest"
    | "technical_visit_interest"
    | "customer_preferences_text"
    | "relevant_objection_text"
  >;
}) {
  return {
    groupKey: args.groupKey,
    status: args.status ?? "missing",
    factKeys: args.factKeys,
  };
}

function createCanonicalConflict(args: { factKey: string; valueKind?: string; candidates?: Row[] }) {
  return {
    factKey: args.factKey,
    valueKind: args.valueKind ?? "text",
    candidates:
      args.candidates ?? [
        {
          value: "valor-a",
          event_id: "event-a",
          value_kind: args.valueKind ?? "text",
          source_type: "incoming_customer_message",
          normalized_value_text: "valor-a",
          source_message_id: "msg-a",
          source_conversation_id: "conv-a",
        },
        {
          value: "valor-b",
          event_id: "event-b",
          value_kind: args.valueKind ?? "text",
          source_type: "incoming_customer_message",
          normalized_value_text: "valor-b",
          source_message_id: "msg-b",
          source_conversation_id: "conv-a",
        },
      ],
    sourceType: "incoming_customer_message",
    sourceMessageId: "msg-a",
    sourceConversationId: "conv-a",
    lastEventId: "event-a",
    lastOperationKey: null,
    updatedAt: null,
  };
}

function createProfileMaterializationRow(args?: {
  currentProfileVersionId?: string;
  versionNumber?: number;
  previousProfileVersionId?: string | null;
  componentCount?: number;
  executionIntentCount?: number;
  profileState?: string;
  changed?: boolean;
  replayed?: boolean;
  preserved?: boolean;
  outcome?: string;
  requestFingerprint?: string;
  actorType?: string;
  sourceType?: string;
  createdBy?: string;
  currentUpdatedAt?: string;
}) {
  return {
    current_profile_version_id:
      args?.currentProfileVersionId ?? "profile-version-1",
    version_number: args?.versionNumber ?? 1,
    previous_profile_version_id:
      args?.previousProfileVersionId === undefined
        ? null
        : args.previousProfileVersionId,
    component_count: args?.componentCount ?? 0,
    execution_intent_count: args?.executionIntentCount ?? 0,
    profile_state: args?.profileState ?? "needs_clarification",
    changed: args?.changed ?? true,
    replayed: args?.replayed ?? false,
    preserved: args?.preserved ?? false,
    outcome: args?.outcome ?? "profile_version_created",
    request_fingerprint: args?.requestFingerprint ?? "fingerprint-1",
    actor_type: args?.actorType ?? "system",
    source_type: args?.sourceType ?? "qualification_profile_materializer",
    created_by: args?.createdBy ?? "sales_ai_profile_materializer_v1",
    current_updated_at: args?.currentUpdatedAt ?? "2026-08-24T10:00:02.000Z",
  };
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

function createGenerateAiSalesReplySupabase(args?: {
  anchorMessageContent?: string;
  anchorMessageId?: string;
  commercialOpportunityId?: string | null;
  onboardingAnswers?: Row[];
  commercialAiSettings?: Row[];
  paymentSettings?: Row[];
  operationSettings?: Row[];
  channelSettings?: Row[];
  discountSettings?: Row[];
  highValueDiscountSettings?: Row[];
  catalogItems?: Row[];
  catalogItemPhotos?: Row[];
  pools?: Row[];
  poolPhotos?: Row[];
  canonicalReaderResponses?: Array<{ data: unknown; error: { message: string } | null }>;
  writerResponse?: RpcMockEntry;
  materializerResponse?: RpcMockEntry;
  includeCurrentIntentResolution?: boolean;
  additionalCommercialOpportunities?: Row[];
  cmirWriterResponse?: RpcMockEntry;
  commercialOpportunityStage?: string;
  cmirReopenTargetStage?: string;
  currentIntentDecisionKind?: CommercialMessageIntentDecisionKind;
  currentIntentResolvedOpportunityId?: string | null;

}) {
  const anchorMessageId = args?.anchorMessageId ?? "msg-anchor";
  const commercialOpportunityId = Object.prototype.hasOwnProperty.call(
    args ?? {},
    "commercialOpportunityId",
  )
    ? (args?.commercialOpportunityId ?? null)
    : "opp-1";
  const currentIntentDecisionKind =
    args?.currentIntentDecisionKind ?? "continue_same_intent";

  const currentIntentResolvedOpportunityId =
    Object.prototype.hasOwnProperty.call(
      args ?? {},
      "currentIntentResolvedOpportunityId",
    )
      ? (args?.currentIntentResolvedOpportunityId ?? null)
      : commercialOpportunityId;

  const defaultReaderRow = createCanonicalQualificationReaderRow({
    commercialOpportunityId: commercialOpportunityId ?? "opp-none",
    knownFacts: [],
    missingFactGroups: [],
    canAskNextQuestion: true,
  });

  const commercialOpportunities: Row[] = [
    ...(commercialOpportunityId
      ? [
          {
            id: commercialOpportunityId,
            organization_id: "org-1",
            store_id: "store-1",
            stage: args?.commercialOpportunityStage ?? "qualificacao",
          },
        ]
      : []),
    ...(args?.additionalCommercialOpportunities ?? []),
  ];

  return new FakeSupabase(
    {
      conversations: [
        {
          id: "conv-1",
          organization_id: "org-1",
          lead_id: "lead-1",
          status: "open",
          is_human_active: false,
        },
      ],
      leads: [
        {
          id: "lead-1",
          organization_id: "org-1",
          store_id: "store-1",
          name: "Cliente",
          phone: "11999999999",
          state: "qualificacao",
        },
      ],
      stores: [
        {
          id: "store-1",
          organization_id: "org-1",
          name: "Loja 1",
        },
      ],
      store_onboarding_answers: args?.onboardingAnswers ?? [],
      store_commercial_ai_settings: args?.commercialAiSettings ?? [],
      store_payment_settings: args?.paymentSettings ?? [],
      store_operation_settings: args?.operationSettings ?? [],
      store_channel_settings: args?.channelSettings ?? [],
      store_discount_settings: args?.discountSettings ?? [],
      store_high_value_discount_settings: args?.highValueDiscountSettings ?? [],
      store_catalog_items: args?.catalogItems ?? [],
      store_catalog_item_photos: args?.catalogItemPhotos ?? [],
      pools: args?.pools ?? [],
      pool_photos: args?.poolPhotos ?? [],
      messages: [
        createMessage({
          id: anchorMessageId,
          content: args?.anchorMessageContent ?? "quero uma visita tecnica para um espaco 3x4",
          created_at: "2026-08-24T10:00:00.000Z",
          commercial_session_context_link_id: commercialOpportunityId ? "context-1" : null,
          commercial_context_capture_state: commercialOpportunityId ? "captured" : "no_active_session",
          conversation_session_id: commercialOpportunityId ? "session-1" : null,
        }),
      ],
      conversation_sessions: commercialOpportunityId
        ? [
            {
              id: "session-1",
              organization_id: "org-1",
              store_id: "store-1",
              conversation_id: "conv-1",
              status: "active",
            },
          ]
        : [],
      commercial_session_context_links: commercialOpportunityId
        ? [
            {
              id: "context-1",
              organization_id: "org-1",
              store_id: "store-1",
              conversation_session_id: "session-1",
              customer_id: "customer-1",
              commercial_opportunity_id: commercialOpportunityId,
              lead_customer_link_id: "lead-customer-link-1",
              status: "active",
            },
          ]
        : [],
      commercial_opportunities: commercialOpportunities,
      commercial_message_intent_resolution_current:
        commercialOpportunityId && (args?.includeCurrentIntentResolution ?? true)
        ? [
            {
              organization_id: "org-1",
              store_id: "store-1",
              anchor_message_id: anchorMessageId,
              current_event_id: "cmir-event-1",
              last_operation_key: `test-cmir:${anchorMessageId}`,
              updated_at: "2026-08-24T10:00:00.500Z",
            },
          ]
        : [],
      commercial_message_intent_resolution_events:
        commercialOpportunityId && (args?.includeCurrentIntentResolution ?? true)
        ? [
            {
              id: "cmir-event-1",
              organization_id: "org-1",
              store_id: "store-1",
              anchor_message_id: anchorMessageId,
              customer_id: "customer-1",
              lead_customer_link_id: "lead-customer-link-1",
              resolved_opportunity_id: currentIntentResolvedOpportunityId,
              related_opportunity_id: null,
              relation_type: null,
              decision_kind: currentIntentDecisionKind,
              reason_code: "test_existing_resolution",
              metadata: {},
            },
          ]
        : [],
    },
    {},
    {
      write_commercial_message_intent_resolution_by_system:
        args?.cmirWriterResponse ??
        ((payload: Record<string, unknown>) => {
          if (
            payload.p_decision_kind === "reopen_same_intent" &&
            args?.cmirReopenTargetStage
          ) {
            const resolvedOpportunityId = String(
              payload.p_resolved_opportunity_id ?? "",
            ).trim();

            const resolvedOpportunity = commercialOpportunities.find(
              (opportunity) =>
                String(opportunity.id ?? "") === resolvedOpportunityId,
            );

            if (resolvedOpportunity) {
              resolvedOpportunity.stage = args.cmirReopenTargetStage;
            }
          }

          return {
            data: [
              {
                decision_kind: payload.p_decision_kind,
                resolved_opportunity_id: payload.p_resolved_opportunity_id,
                related_opportunity_id: payload.p_related_opportunity_id,
                relation_type:
                  payload.p_decision_kind === "repurchase"
                    ? "repurchase_of"
                    : payload.p_decision_kind === "addendum"
                      ? "addendum_to"
                      : null,
                replayed: false,
              },
            ],
            error: null,
          };
        }),      read_commercial_opportunity_qualification_facts_by_system:
        args?.canonicalReaderResponses ??
        [
          {
            data: [defaultReaderRow],
            error: null,
          },
          {
            data: [defaultReaderRow],
            error: null,
          },
        ],
      write_commercial_opportunity_qualification_fact_by_system:
        args?.writerResponse ??
        ((payload: Record<string, unknown>) => ({
          data: [
            {
              commercial_opportunity_id: payload.p_commercial_opportunity_id,
              fact_key: payload.p_fact_key,
              event_id: "event-1",
              current_last_event_id: "event-1",
              current_state: payload.p_assertion_level,
              current_value_json: payload.p_value_json,
              normalized_value_text:
                typeof payload.p_value_json === "string" ? payload.p_value_json : null,
              value_kind:
                payload.p_fact_key === "requested_area_m2"
                  ? "number"
                  : payload.p_fact_key === "installation_interest" ||
                      payload.p_fact_key === "payment_interest" ||
                      payload.p_fact_key === "technical_visit_interest"
                    ? "boolean"
                    : "text",
              conflict_values_json: [],
              changed: true,
              outcome:
                payload.p_assertion_level === "confirmed"
                  ? "confirmed_created"
                  : "inferred_created",
              updated_at: "2026-08-24T10:00:01.000Z",
            },
          ],
          error: null,
        })),
      materialize_commercial_opportunity_profile_from_qualification_by_system:
        args?.materializerResponse ??
        {
          data: [createProfileMaterializationRow()],
          error: null,
        },
    },
  );
}

function createWriterRow(args?: {
  commercialOpportunityId?: string;
  factKey?: string;
  valueKind?: string;
  currentState?: "confirmed" | "inferred" | "conflict";
  changed?: boolean;
  outcome?: string;
}) {
  return {
    commercial_opportunity_id: args?.commercialOpportunityId ?? "opp-1",
    fact_key: args?.factKey ?? "space_text",
    event_id: "event-1",
    current_last_event_id: "event-1",
    current_state: args?.currentState ?? "confirmed",
    current_value_json: "3x4",
    normalized_value_text: "3x4",
    value_kind: args?.valueKind ?? "text",
    conflict_values_json: args?.currentState === "conflict" ? [{ value: "3x4" }, { value: "4x5" }] : [],
    changed: args?.changed ?? true,
    outcome: args?.outcome ?? "confirmed_created",
    updated_at: "2026-08-24T10:00:01.000Z",
  };
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

test("canonical qualification reader is called only with explicit organization, store and anchored opportunity", async () => {
  const supabase = new FakeSupabase(
    {},
    {},
    {
      read_commercial_opportunity_qualification_facts_by_system: {
        data: [
          createCanonicalQualificationReaderRow({
            knownFacts: [
              createCanonicalKnownFact({
                factKey: "need_summary",
                normalizedValueText: "familia",
              }),
            ],
            canAskNextQuestion: false,
          }),
        ],
        error: null,
      },
    },
  );

  const result = await loadCanonicalQualificationSnapshotBySystem({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    commercialOpportunityId: "opp-1",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(supabase.rpcCalls, [
    {
      fn: "read_commercial_opportunity_qualification_facts_by_system",
      payload: {
        p_organization_id: "org-1",
        p_store_id: "store-1",
        p_commercial_opportunity_id: "opp-1",
      },
    },
  ]);
});

test("canonical qualification reader failure does not degrade into synthetic zero facts", async () => {
  const supabase = new FakeSupabase(
    {},
    {},
    {
      read_commercial_opportunity_qualification_facts_by_system: {
        data: null,
        error: { message: "rpc exploded" },
      },
    },
  );

  const result = await loadCanonicalQualificationSnapshotBySystem({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    commercialOpportunityId: "opp-1",
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "qualification_reader_rpc_failed",
    message: "rpc exploded",
  });
});

test("canonical stage reader uses explicit anchored opportunity and wins over legacy lead state when available", async () => {
  const harness = createCommercialOpportunityStageSupabase({
    stage: "orcamento",
  });

  const result = await loadCanonicalCommercialOpportunityStage({
    supabase: harness.client,
    organizationId: "org-1",
    storeId: "store-1",
    commercialOpportunityId: "opp-canonical",
  });

  assert.deepEqual(result, {
    ok: true,
    stage: "orcamento",
  });
  assert.deepEqual(harness.queries[0]?.eq, [
    { column: "id", value: "opp-canonical" },
    { column: "organization_id", value: "org-1" },
    { column: "store_id", value: "store-1" },
  ]);
});

test("canonical qualification payload scope mismatch is rejected", async () => {
  const supabase = new FakeSupabase(
    {},
    {},
    {
      read_commercial_opportunity_qualification_facts_by_system: {
        data: [
          createCanonicalQualificationReaderRow({
            organizationId: "org-2",
          }),
        ],
        error: null,
      },
    },
  );

  const result = await loadCanonicalQualificationSnapshotBySystem({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    commercialOpportunityId: "opp-1",
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "qualification_reader_invalid_payload",
    message: "Canonical qualification reader returned an invalid payload.",
  });
});

test("canonical qualification payload counter mismatch is rejected", async () => {
  const supabase = new FakeSupabase(
    {},
    {},
    {
      read_commercial_opportunity_qualification_facts_by_system: {
        data: [
          createCanonicalQualificationReaderRow({
            knownFacts: [
              createCanonicalKnownFact({
                factKey: "need_summary",
                normalizedValueText: "familia",
              }),
            ],
            knownFactCount: 0,
          }),
        ],
        error: null,
      },
    },
  );

  const result = await loadCanonicalQualificationSnapshotBySystem({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    commercialOpportunityId: "opp-1",
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "qualification_reader_invalid_payload",
    message: "Canonical qualification reader returned inconsistent counters.",
  });
});

test("canonical qualification payload rejects wrong confirmed and inferred counters for actual states", async () => {
  const supabase = new FakeSupabase(
    {},
    {},
    {
      read_commercial_opportunity_qualification_facts_by_system: {
        data: [
          createCanonicalQualificationReaderRow({
            knownFacts: [
              createCanonicalKnownFact({
                factKey: "space_text",
                normalizedValueText: "3x4",
                state: "inferred",
                sourceType: "system_inference",
              }),
            ],
            provenanceSummary: {
              knownFactCount: 1,
              confirmedCount: 1,
              inferredCount: 0,
              conflictCount: 0,
              messageBackedCount: 0,
              conversationBackedCount: 0,
              sourceCounts: {
                system_inference: 1,
              },
            },
          }),
        ],
        error: null,
      },
    },
  );

  const result = await loadCanonicalQualificationSnapshotBySystem({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    commercialOpportunityId: "opp-1",
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "qualification_reader_invalid_payload",
    message: "Canonical qualification reader returned inconsistent counters.",
  });
});

test("canonical qualification payload rejects incoherent fact value kind and value", async () => {
  const supabase = new FakeSupabase(
    {},
    {},
    {
      read_commercial_opportunity_qualification_facts_by_system: {
        data: [
          createCanonicalQualificationReaderRow({
            knownFacts: [
              createCanonicalKnownFact({
                factKey: "installation_interest",
                valueKind: "text",
                value: "sim",
                normalizedValueText: "sim",
              }),
            ],
          }),
        ],
        error: null,
      },
    },
  );

  const result = await loadCanonicalQualificationSnapshotBySystem({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    commercialOpportunityId: "opp-1",
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "qualification_reader_invalid_payload",
    message: "Canonical qualification reader returned an invalid payload.",
  });
});

test("canonical qualification payload rejects invalid conflict candidate shape", async () => {
  const supabase = new FakeSupabase(
    {},
    {},
    {
      read_commercial_opportunity_qualification_facts_by_system: {
        data: [
          createCanonicalQualificationReaderRow({
            conflicts: [
              createCanonicalConflict({
                factKey: "location_text",
                candidates: [
                  {
                    value: "bairro a",
                    value_kind: "text",
                  },
                  {
                    value: "bairro b",
                    event_id: "event-b",
                    value_kind: "text",
                    source_type: "message",
                    normalized_value_text: "bairro b",
                    source_message_id: "msg-b",
                    source_conversation_id: "conv-a",
                  },
                ],
              }),
            ],
            missingFactGroups: [
              createCanonicalMissingGroup({
                groupKey: "location",
                status: "conflict",
                factKeys: ["location_text"],
              }),
            ],
          }),
        ],
        error: null,
      },
    },
  );

  const result = await loadCanonicalQualificationSnapshotBySystem({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    commercialOpportunityId: "opp-1",
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "qualification_reader_invalid_payload",
    message: "Canonical qualification reader returned an invalid payload.",
  });
});

test("anchored canonical context does not call reader when there is no anchored opportunity", async () => {
  const supabase = new FakeSupabase({});

  const result = await loadAnchoredCanonicalCommercialContext({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    leadState: "qualified",
    anchoredCommercialOpportunityId: null,
  });

  assert.deepEqual(result, {
    ok: true,
    anchoredCommercialOpportunityId: null,
    canonicalQualificationSnapshot: null,
    crmStageForReply: "qualified",
  });
  assert.deepEqual(supabase.rpcCalls, []);
  assert.deepEqual(supabase.fromCalls, []);
});

test("anchored canonical context fails closed when canonical stage lookup fails", async () => {
  const stageHarness = createCommercialOpportunityStageSupabase({
    errorMessage: "db down",
  });
  const supabase = {
    ...stageHarness.client,
    rpc: async () => ({
      data: [
        createCanonicalQualificationReaderRow({
          commercialOpportunityId: "opp-canonical",
          knownFacts: [
            createCanonicalKnownFact({
              factKey: "need_summary",
              normalizedValueText: "familia",
            }),
          ],
          canAskNextQuestion: false,
        }),
      ],
      error: null,
    }),
  };

  const result = await loadAnchoredCanonicalCommercialContext({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    leadState: "legacy-state",
    anchoredCommercialOpportunityId: "opp-canonical",
  });

  assert.deepEqual(result, {
    ok: false,
    error: "LOAD_CANONICAL_STAGE_FAILED",
    message: "Canonical commercial opportunity stage lookup failed.",
  });
});

test("anchored canonical context fails closed when canonical stage row is missing", async () => {
  const stageHarness = createCommercialOpportunityStageSupabase({
    rowMissing: true,
  });
  const supabase = {
    ...stageHarness.client,
    rpc: async () => ({
      data: [
        createCanonicalQualificationReaderRow({
          commercialOpportunityId: "opp-canonical",
          knownFacts: [
            createCanonicalKnownFact({
              factKey: "need_summary",
              normalizedValueText: "familia",
            }),
          ],
          canAskNextQuestion: false,
        }),
      ],
      error: null,
    }),
  };

  const result = await loadAnchoredCanonicalCommercialContext({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    leadState: "legacy-state",
    anchoredCommercialOpportunityId: "opp-canonical",
  });

  assert.deepEqual(result, {
    ok: false,
    error: "LOAD_CANONICAL_STAGE_FAILED",
    message: "Canonical commercial opportunity stage unavailable for anchored opportunity.",
  });
});

test("anchored canonical context uses canonical stage instead of legacy lead state", async () => {
  const stageHarness = createCommercialOpportunityStageSupabase({
    stage: "orcamento",
  });
  const supabase = {
    ...stageHarness.client,
    rpc: async () => ({
      data: [
        createCanonicalQualificationReaderRow({
          commercialOpportunityId: "opp-canonical",
          knownFacts: [
            createCanonicalKnownFact({
              factKey: "need_summary",
              normalizedValueText: "familia",
            }),
          ],
          canAskNextQuestion: false,
        }),
      ],
      error: null,
    }),
  };

  const result = await loadAnchoredCanonicalCommercialContext({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    leadState: "lead.state-antigo",
    anchoredCommercialOpportunityId: "opp-canonical",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.crmStageForReply, "orcamento");
    assert.equal(result.canonicalQualificationSnapshot?.commercialOpportunityId, "opp-canonical");
  }
});

test("anchored canonical context fails closed when canonical stage is outside the valid crm stage set", async () => {
  const stageHarness = createCommercialOpportunityStageSupabase({
    stage: "stage_invalido",
  });
  const supabase = {
    ...stageHarness.client,
    rpc: async () => ({
      data: [
        createCanonicalQualificationReaderRow({
          commercialOpportunityId: "opp-canonical",
          knownFacts: [
            createCanonicalKnownFact({
              factKey: "need_summary",
              normalizedValueText: "familia",
            }),
          ],
          canAskNextQuestion: false,
        }),
      ],
      error: null,
    }),
  };

  const result = await loadAnchoredCanonicalCommercialContext({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    leadState: "legacy-state",
    anchoredCommercialOpportunityId: "opp-canonical",
  });

  assert.deepEqual(result, {
    ok: false,
    error: "LOAD_CANONICAL_STAGE_FAILED",
    message: "Canonical commercial opportunity stage unavailable for anchored opportunity.",
  });
});

function createContextualQualificationSnapshot(args?: {
  knownFacts?: Row[];
  missingFactGroups?: Row[];
  conflicts?: Row[];
  canAskNextQuestion?: boolean;
}) {
  const knownFacts = args?.knownFacts ?? [];
  const missingFactGroups = args?.missingFactGroups ?? [];
  const conflicts = args?.conflicts ?? [];

  return {
    organizationId: "org-1",
    storeId: "store-1",
    commercialOpportunityId: "opp-1",
    knownFacts,
    missingFactGroups,
    conflicts,
    provenanceSummary: {
      knownFactCount: knownFacts.length,
      confirmedCount: knownFacts.length,
      inferredCount: 0,
      conflictCount: conflicts.length,
      messageBackedCount: 0,
      conversationBackedCount: 0,
      sourceCounts: {},
    },
    canAskNextQuestion:
      args?.canAskNextQuestion ?? (missingFactGroups.length > 0 || conflicts.length > 0),
    knownFactCount: knownFacts.length,
    missingGroupCount: missingFactGroups.length,
    conflictCount: conflicts.length,
  };
}

function createActiveQualificationPatience(shouldAvoidNewQuestion = false) {
  return {
    status: "active_interest",
    shouldAvoidNewQuestion,
  };
}

test("local photo context can make canonical space the structured qualification target", () => {
  const decision = resolveContextualQualificationDecision({
    snapshot: createContextualQualificationSnapshot({
      missingFactGroups: [
        createCanonicalMissingGroup({
          groupKey: "space",
          factKeys: ["space_text", "requested_area_m2"],
        }),
      ],
      canAskNextQuestion: true,
    }) as never,
    crmStage: "qualificacao",
    pattern: "photo_or_simulation_request",
    photoOrSimulationSubtype: "local_photo_context",
    intents: [],
    lastCustomerMessage: "Posso mandar uma foto do meu quintal?",
    explicitCatalogRequest: false,
    responseMode: "consultative",
    patienceSignal: createActiveQualificationPatience() as never,
  });

  assert.deepEqual(decision, {
    targetFactKey: "space_text",
    targetGroup: "space",
    targetStatus: "missing",
    askNow: true,
    reason: "target_missing_and_relevant",
  });
});

test("visual simulation request does not invent a qualification target in the pilot", () => {
  const decision = resolveContextualQualificationDecision({
    snapshot: createContextualQualificationSnapshot({
      missingFactGroups: [
        createCanonicalMissingGroup({
          groupKey: "space",
          factKeys: ["space_text", "requested_area_m2"],
        }),
      ],
      canAskNextQuestion: true,
    }) as never,
    crmStage: "qualificacao",
    pattern: "photo_or_simulation_request",
    photoOrSimulationSubtype: "simulation_visual_request",
    intents: [],
    lastCustomerMessage:
      "Consegue fazer uma simulacao da piscina no meu quintal?",
    explicitCatalogRequest: false,
    responseMode: "consultative",
    patienceSignal: createActiveQualificationPatience() as never,
  });

  assert.deepEqual(decision, {
    targetFactKey: null,
    targetGroup: null,
    targetStatus: "not_applicable",
    askNow: false,
    reason: "no_relevant_qualification_target",
  });
});

test("visual simulation request does not automatically ask the customer to send a location photo", () => {
  const question = inferNonQualificationNextBestQuestion({
    pattern: "photo_or_simulation_request",
    photoOrSimulationSubtype: "simulation_visual_request",
    facts: {
      budgetKnown: false,
      authorityKnown: false,
      needKnown: false,
      timingKnown: false,
      locationKnown: false,
      sizeKnown: false,
      installationInterestKnown: false,
      paymentInterestKnown: false,
      visitInterestKnown: false,
    } as never,
    canonicalQualificationSnapshot:
      createContextualQualificationSnapshot({
        canAskNextQuestion: false,
      }) as never,
    lastCustomerMessage:
      "Consegue montar uma piscina na foto do meu quintal?",
    explicitCatalogRequest: false,
    patienceSignal: createActiveQualificationPatience() as never,
    hasCustomerLocationPhoto: false,
  });

  assert.equal(question, null);
});

test("photo flow cannot recover a hidden legacy space or access qualification question", () => {
  const nextQuestion =
    resolveNextBestQuestionAfterQualificationAuthority({
      pattern: "photo_or_simulation_request",
      nonQualificationQuestion: null,
      heuristicQuestion:
        "Pode mandar sim. Se conseguir, me manda tambem uma nocao de medida do espaco.",
      snapshot: createContextualQualificationSnapshot({
        canAskNextQuestion: true,
      }) as never,
      qualificationDecision: {
        targetFactKey: null,
        targetGroup: null,
        targetStatus: "not_applicable",
        askNow: false,
        reason: "no_relevant_qualification_target",
      },
    });

  assert.equal(nextQuestion, null);
});

test("real product photo request without a model keeps its legitimate clarification question", () => {
  const question = inferNonQualificationNextBestQuestion({
    pattern: "photo_or_simulation_request",
    photoOrSimulationSubtype: "product_photo_without_model",
    productPhotoRequestContext: {
      kind: "ambiguous",
      source: "request",
    } as never,
    facts: {
      budgetKnown: false,
      authorityKnown: false,
      needKnown: false,
      timingKnown: false,
      locationKnown: false,
      sizeKnown: false,
      installationInterestKnown: false,
      paymentInterestKnown: false,
      visitInterestKnown: false,
    } as never,
    canonicalQualificationSnapshot:
      createContextualQualificationSnapshot({
        canAskNextQuestion: false,
      }) as never,
    lastCustomerMessage: "Tem foto dessa piscina?",
    explicitCatalogRequest: false,
    patienceSignal: createActiveQualificationPatience() as never,
    hasCustomerLocationPhoto: false,
  });

  assert.equal(question, "Qual modelo voce quer ver na foto?");
});
test("generic pool opening chooses one canonical product reference qualification target instead of model plus space", () => {
  const decision = resolveContextualQualificationDecision({
    snapshot: createContextualQualificationSnapshot({
      missingFactGroups: [
        createCanonicalMissingGroup({
          groupKey: "need",
          factKeys: [
            "need_summary",
            "interested_product_reference",
            "customer_preferences_text",
          ],
        }),
      ],
      canAskNextQuestion: true,
    }) as never,
    crmStage: "qualificacao",
    pattern: "generic_pool_opening",
    intents: [],
    lastCustomerMessage: "Oi, estou procurando uma piscina",
    explicitCatalogRequest: false,
    responseMode: "consultative",
    patienceSignal: createActiveQualificationPatience() as never,
  });

  assert.deepEqual(decision, {
    targetFactKey: "interested_product_reference",
    targetGroup: "need",
    targetStatus: "missing",
    askNow: true,
    reason: "target_missing_and_relevant",
  });
});

test("generic pool opening without canonical qualification context cannot revive the legacy model plus space question", () => {
  const nextQuestion =
    resolveNextBestQuestionAfterQualificationAuthority({
      pattern: "generic_pool_opening",
      nonQualificationQuestion: null,
      heuristicQuestion:
        "Voce ja tem algum modelo em mente? Me fala tambem o espaco disponivel.",
      snapshot: null,
      qualificationDecision: {
        targetFactKey: null,
        targetGroup: null,
        targetStatus: "unproven",
        askNow: false,
        reason: "no_canonical_snapshot",
      },
    });

  assert.equal(nextQuestion, null);
});
test("pure price question cannot fall back to a legacy qualification question when structured qualification intentionally has no target", () => {
  const nextQuestion = resolveNextBestQuestionAfterQualificationAuthority({
    pattern: "price_question",
    nonQualificationQuestion: null,
    heuristicQuestion: "isso seria para agora ou mais pra frente?",
    snapshot: createContextualQualificationSnapshot({
      canAskNextQuestion: true,
    }) as never,
    qualificationDecision: {
      targetFactKey: null,
      targetGroup: null,
      targetStatus: "not_applicable",
      askNow: false,
      reason: "no_relevant_qualification_target",
    },
  });

  assert.equal(nextQuestion, null);
});

test("discount objection cannot fall back to legacy installation payment or preference qualification", () => {
  const nextQuestion = resolveNextBestQuestionAfterQualificationAuthority({
    pattern: "discount_question",
    nonQualificationQuestion: null,
    heuristicQuestion: "Voce esta olhando so a piscina ou tambem instalacao?",
    snapshot: createContextualQualificationSnapshot({
      canAskNextQuestion: true,
    }) as never,
    qualificationDecision: {
      targetFactKey: null,
      targetGroup: null,
      targetStatus: "not_applicable",
      askNow: false,
      reason: "no_relevant_qualification_target",
    },
  });

  assert.equal(nextQuestion, null);
});
test("structured qualification target removes the legacy qualification sentence from nextBestQuestion authority", () => {
  const nextQuestion = resolveNextBestQuestionAfterQualificationAuthority({
    pattern: "catalog_recommendation_or_refinement",
    nonQualificationQuestion: null,
    heuristicQuestion:
      "Me fala mais ou menos o espaco ou a medida que voce tem para colocar a piscina.",
    snapshot: createContextualQualificationSnapshot({
      missingFactGroups: [
        createCanonicalMissingGroup({
          groupKey: "space",
          factKeys: ["space_text", "requested_area_m2"],
        }),
      ],
      canAskNextQuestion: true,
    }) as never,
    qualificationDecision: {
      targetFactKey: "space_text",
      targetGroup: "space",
      targetStatus: "missing",
      askNow: true,
      reason: "target_missing_and_relevant",
    },
  });

  assert.equal(nextQuestion, null);
});

test("commercial or operational next question remains available when qualification authority is structured", () => {
  const operationalQuestion =
    "Vou verificar na agenda os horarios disponiveis. Qual dia ou periodo costuma ser melhor pra voce?";

  const nextQuestion = resolveNextBestQuestionAfterQualificationAuthority({
    pattern: "general_sales_conversation",
    nonQualificationQuestion: operationalQuestion,
    heuristicQuestion:
      "Me fala mais ou menos o espaco ou a medida que voce tem para colocar a piscina.",
    snapshot: createContextualQualificationSnapshot({
      missingFactGroups: [
        createCanonicalMissingGroup({
          groupKey: "space",
          factKeys: ["space_text", "requested_area_m2"],
        }),
      ],
      canAskNextQuestion: true,
    }) as never,
    qualificationDecision: {
      targetFactKey: "space_text",
      targetGroup: "space",
      targetStatus: "missing",
      askNow: true,
      reason: "target_missing_and_relevant",
    },
  });

  assert.equal(nextQuestion, operationalQuestion);
});
test("qualification askNow reaches the sales prompt as a structured target without requiring a legacy question sentence", () => {
  const qualificationDecision = {
    targetFactKey: "space_text",
    targetGroup: "space",
    targetStatus: "missing",
    askNow: true,
    reason: "target_missing_and_relevant",
  } as const;

  const block = buildCommercialObjectiveBlock({
    pattern: "catalog_recommendation_or_refinement",
    paymentOrClosingSubtype: "none",
    intents: ["catalog"],
    primaryIntent: "catalog",
    mustAnswerFirst: ["responder com orientacao pratica sobre modelos/opcoes"],
    knownFacts: [],
    missingFacts: ["espaco ainda nao confirmado"],
    qualificationDecision,
    nextBestQuestion: null,
    responseGoal: "orientar usando o contexto e avancar apenas se fizer sentido",
    forbiddenInThisReply: [],
    responseMode: "consultative",
    patienceSignal: createActiveQualificationPatience(),
  } as never);

  assert.match(block, /DECISAO DE QUALIFICACAO CONTEXTUAL/);
  assert.match(block, /perguntar qualificacao agora: sim/);
  assert.match(block, /fato alvo: space_text/);
  assert.match(block, /grupo alvo: space/);
  assert.match(block, /estado do alvo: missing/);

  const forbidden = inferForbiddenInThisReply({
    pattern: "catalog_recommendation_or_refinement",
    intents: ["catalog"],
    nextBestQuestion: null,
    qualificationDecision,
    responseMode: "consultative",
    explicitCatalogRequest: true,
    lastAiListedPools: false,
    lastCustomerMessage: "Quero ver algumas opcoes",
    patienceSignal: createActiveQualificationPatience(),
    recommendationPolicy: {
      poolOptionCount: 1,
    },
    requestedPoolReference: null,
    strongestPoolReferenceMatch: "none",
    offersTechnicalVisit: false,
  } as never);

  assert.equal(
    forbidden.includes(
      "nao inventar pergunta no final so para encerrar com interrogacao",
    ),
    false,
  );
});

test("qualification askNow false forbids inventing a question when there is no commercial or operational next question", () => {
  const forbidden = inferForbiddenInThisReply({
    pattern: "price_question",
    intents: ["price"],
    nextBestQuestion: null,
    qualificationDecision: {
      targetFactKey: null,
      targetGroup: null,
      targetStatus: "not_applicable",
      askNow: false,
      reason: "no_relevant_qualification_target",
    },
    responseMode: "objective",
    explicitCatalogRequest: false,
    lastAiListedPools: false,
    lastCustomerMessage: "Quanto custa?",
    patienceSignal: createActiveQualificationPatience(),
    recommendationPolicy: {
      poolOptionCount: 1,
    },
    requestedPoolReference: null,
    strongestPoolReferenceMatch: "none",
    offersTechnicalVisit: false,
  } as never);

  assert.equal(
    forbidden.includes(
      "nao inventar pergunta no final so para encerrar com interrogacao",
    ),
    true,
  );
});
test("contextual qualification fails closed without canonical snapshot", () => {
  const decision = resolveContextualQualificationDecision({
    snapshot: null,
    crmStage: "qualificacao",
    pattern: "price_question",
    intents: ["price"],
    lastCustomerMessage: "Quanto custa?",
    explicitCatalogRequest: false,
    responseMode: "objective",
    patienceSignal: createActiveQualificationPatience() as never,
  });

  assert.deepEqual(decision, {
    targetFactKey: null,
    targetGroup: null,
    targetStatus: "unproven",
    askNow: false,
    reason: "no_canonical_snapshot",
  });
});

test("contextual qualification does not turn a pure price question into a budget question", () => {
  const decision = resolveContextualQualificationDecision({
    snapshot: createContextualQualificationSnapshot({
      canAskNextQuestion: false,
    }) as never,
    crmStage: "qualificacao",
    pattern: "price_question",
    intents: ["price"],
    lastCustomerMessage: "Quanto custa?",
    explicitCatalogRequest: false,
    responseMode: "objective",
    patienceSignal: createActiveQualificationPatience() as never,
  });

  assert.deepEqual(decision, {
    targetFactKey: null,
    targetGroup: null,
    targetStatus: "not_applicable",
    askNow: false,
    reason: "no_relevant_qualification_target",
  });
});

test("contextual qualification keeps volunteered canonical budget without using price as a new question target", () => {
  const decision = resolveContextualQualificationDecision({
    snapshot: createContextualQualificationSnapshot({
      knownFacts: [
        createCanonicalKnownFact({
          factKey: "budget_text",
          normalizedValueText: "ate 20 mil",
        }),
      ],
      canAskNextQuestion: false,
    }) as never,
    crmStage: "qualificacao",
    pattern: "price_question",
    intents: ["price"],
    lastCustomerMessage: "E quanto custa esse modelo?",
    explicitCatalogRequest: false,
    responseMode: "objective",
    patienceSignal: createActiveQualificationPatience() as never,
  });

  assert.deepEqual(decision, {
    targetFactKey: null,
    targetGroup: null,
    targetStatus: "not_applicable",
    askNow: false,
    reason: "no_relevant_qualification_target",
  });
});
test("contextual qualification does not turn a discount objection into a generic payment question", () => {
  const decision = resolveContextualQualificationDecision({
    snapshot: createContextualQualificationSnapshot({
      missingFactGroups: [
        createCanonicalMissingGroup({
          groupKey: "payment",
          factKeys: ["payment_interest"],
        }),
      ],
      canAskNextQuestion: true,
    }) as never,
    crmStage: "qualificacao",
    pattern: "discount_question",
    intents: [],
    lastCustomerMessage: "Tem como melhorar esse valor?",
    explicitCatalogRequest: false,
    responseMode: "objective",
    patienceSignal: createActiveQualificationPatience() as never,
  });

  assert.deepEqual(decision, {
    targetFactKey: null,
    targetGroup: null,
    targetStatus: "not_applicable",
    askNow: false,
    reason: "no_relevant_qualification_target",
  });
});

test("contextual qualification can target payment when payment intent is explicit", () => {
  const decision = resolveContextualQualificationDecision({
    snapshot: createContextualQualificationSnapshot({
      missingFactGroups: [
        createCanonicalMissingGroup({
          groupKey: "payment",
          factKeys: ["payment_interest"],
        }),
      ],
      canAskNextQuestion: true,
    }) as never,
    crmStage: "qualificacao",
    pattern: "payment_or_closing_flow",
    intents: ["payment"],
    lastCustomerMessage: "Da para pagar no Pix ou parcelado?",
    explicitCatalogRequest: false,
    responseMode: "objective",
    patienceSignal: createActiveQualificationPatience() as never,
  });

  assert.deepEqual(decision, {
    targetFactKey: "payment_interest",
    targetGroup: "payment",
    targetStatus: "missing",
    askNow: true,
    reason: "target_missing_and_relevant",
  });
});
test("contextual qualification asks a relevant canonical space gap without reading question text", () => {
  const decision = resolveContextualQualificationDecision({
    snapshot: createContextualQualificationSnapshot({
      missingFactGroups: [
        createCanonicalMissingGroup({
          groupKey: "space",
          factKeys: ["space_text", "requested_area_m2"],
        }),
      ],
      canAskNextQuestion: true,
    }) as never,
    crmStage: "qualificacao",
    pattern: "catalog_recommendation_or_refinement",
    intents: ["catalog"],
    lastCustomerMessage: "Quero ver algumas opcoes",
    explicitCatalogRequest: true,
    responseMode: "consultative",
    patienceSignal: createActiveQualificationPatience() as never,
  });

  assert.deepEqual(decision, {
    targetFactKey: "space_text",
    targetGroup: "space",
    targetStatus: "missing",
    askNow: true,
    reason: "target_missing_and_relevant",
  });
});

test("contextual qualification prioritizes canonical conflict clarification for relevant location", () => {
  const decision = resolveContextualQualificationDecision({
    snapshot: createContextualQualificationSnapshot({
      missingFactGroups: [
        createCanonicalMissingGroup({
          groupKey: "location",
          status: "conflict",
          factKeys: ["location_text"],
        }),
      ],
      conflicts: [
        createCanonicalConflict({
          factKey: "location_text",
        }),
      ],
      canAskNextQuestion: true,
    }) as never,
    crmStage: "qualificacao",
    pattern: "general_sales_conversation",
    intents: ["installation"],
    lastCustomerMessage: "Vocês fazem instalação aqui?",
    explicitCatalogRequest: false,
    responseMode: "consultative",
    patienceSignal: createActiveQualificationPatience() as never,
  });

  assert.deepEqual(decision, {
    targetFactKey: "location_text",
    targetGroup: "location",
    targetStatus: "conflict",
    askNow: true,
    reason: "target_conflict_requires_clarification",
  });
});

test("contextual qualification does not confuse a satisfied need group with exact product reference being known", () => {
  const decision = resolveContextualQualificationDecision({
    snapshot: createContextualQualificationSnapshot({
      knownFacts: [
        createCanonicalKnownFact({
          factKey: "need_summary",
          normalizedValueText: "piscina para familia",
        }),
      ],
      missingFactGroups: [],
      canAskNextQuestion: false,
    }) as never,
    crmStage: "qualificacao",
    pattern: "generic_pool_opening",
    intents: [],
    lastCustomerMessage: "Quero uma piscina",
    explicitCatalogRequest: false,
    responseMode: "consultative",
    patienceSignal: createActiveQualificationPatience() as never,
  });

  assert.deepEqual(decision, {
    targetFactKey: "interested_product_reference",
    targetGroup: "need",
    targetStatus: "unproven",
    askNow: false,
    reason: "target_group_already_satisfied",
  });
});

test("contextual qualification respects patience and suppresses a new qualification question", () => {
  const decision = resolveContextualQualificationDecision({
    snapshot: createContextualQualificationSnapshot({
      missingFactGroups: [
        createCanonicalMissingGroup({
          groupKey: "space",
          factKeys: ["space_text", "requested_area_m2"],
        }),
      ],
      canAskNextQuestion: true,
    }) as never,
    crmStage: "qualificacao",
    pattern: "catalog_recommendation_or_refinement",
    intents: ["catalog"],
    lastCustomerMessage: "Depois eu vejo isso",
    explicitCatalogRequest: true,
    responseMode: "consultative",
    patienceSignal: createActiveQualificationPatience(true) as never,
  });

  assert.deepEqual(decision, {
    targetFactKey: null,
    targetGroup: null,
    targetStatus: "not_applicable",
    askNow: false,
    reason: "current_context_does_not_justify_question",
  });
});

test("technical visit with canonical location known advances only to operational period question", () => {
  const snapshot = createContextualQualificationSnapshot({
    knownFacts: [
      createCanonicalKnownFact({
        factKey: "location_text",
        normalizedValueText: "campinas",
      }),
    ],
    canAskNextQuestion: false,
  }) as never;

  const question = inferNonQualificationNextBestQuestion({
    pattern: "general_sales_conversation",
    facts: {
      budgetKnown: false,
      authorityKnown: false,
      needKnown: false,
      timingKnown: false,
      locationKnown: false,
      sizeKnown: false,
      installationInterestKnown: false,
      paymentInterestKnown: false,
      visitInterestKnown: false,
    } as never,
    canonicalQualificationSnapshot: snapshot,
    lastCustomerMessage: "Quero marcar uma visita tecnica",
    explicitCatalogRequest: false,
    patienceSignal: createActiveQualificationPatience() as never,
    hasCustomerLocationPhoto: true,
  });

  assert.equal(
    question,
    "Vou verificar na agenda os horarios disponiveis. Qual dia ou periodo costuma ser melhor pra voce?",
  );
});

test("technical visit with canonical location missing leaves location to contextual qualification", () => {
  const snapshot = createContextualQualificationSnapshot({
    missingFactGroups: [
      createCanonicalMissingGroup({
        groupKey: "location",
        factKeys: ["location_text"],
      }),
    ],
    canAskNextQuestion: true,
  }) as never;

  const nonQualificationQuestion = inferNonQualificationNextBestQuestion({
    pattern: "general_sales_conversation",
    facts: {
      budgetKnown: false,
      authorityKnown: false,
      needKnown: false,
      timingKnown: false,
      locationKnown: true,
      sizeKnown: false,
      installationInterestKnown: false,
      paymentInterestKnown: false,
      visitInterestKnown: false,
    } as never,
    canonicalQualificationSnapshot: snapshot,
    lastCustomerMessage: "Quero marcar uma visita tecnica",
    explicitCatalogRequest: false,
    patienceSignal: createActiveQualificationPatience() as never,
    hasCustomerLocationPhoto: true,
  });

  assert.equal(nonQualificationQuestion, null);

  const decision = resolveContextualQualificationDecision({
    snapshot,
    crmStage: "qualificacao",
    pattern: "general_sales_conversation",
    intents: ["technical_visit"],
    lastCustomerMessage: "Quero marcar uma visita tecnica",
    explicitCatalogRequest: false,
    responseMode: "consultative",
    patienceSignal: createActiveQualificationPatience() as never,
  });

  assert.deepEqual(decision, {
    targetFactKey: "location_text",
    targetGroup: "location",
    targetStatus: "missing",
    askNow: true,
    reason: "target_missing_and_relevant",
  });
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

test("canonical qualification reader helper remains read-only and calls only the system reader rpc", async () => {
  const supabase = new FakeSupabase(
    {},
    {},
    {
      read_commercial_opportunity_qualification_facts_by_system: {
        data: [
          createCanonicalQualificationReaderRow({
            knownFacts: [
              createCanonicalKnownFact({
                factKey: "installation_interest",
                valueKind: "boolean",
                value: false,
                state: "inferred",
              }),
            ],
            canAskNextQuestion: false,
          }),
        ],
        error: null,
      },
    },
  );

  await loadCanonicalQualificationSnapshotBySystem({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    commercialOpportunityId: "opp-1",
  });

  assert.deepEqual(
    supabase.rpcCalls.map((call) => call.fn),
    ["read_commercial_opportunity_qualification_facts_by_system"],
  );
  assert.equal(
    supabase.rpcCalls.some(
      (call) =>
        call.fn === "write_commercial_opportunity_qualification_fact_by_system" ||
        call.fn === "write_commercial_opportunity_qualification_fact_by_user",
    ),
    false,
  );
});

test("qualification profile installation evidence resolver maps absent known and conflict deterministically", () => {
  const absentSnapshot = createContextualQualificationSnapshot() as never;
  const knownTrueSnapshot = createContextualQualificationSnapshot({
    knownFacts: [
      createCanonicalKnownFact({
        factKey: "installation_interest",
        valueKind: "boolean",
        value: true,
        state: "confirmed",
      }),
    ],
  }) as never;
  const knownFalseSnapshot = createContextualQualificationSnapshot({
    knownFacts: [
      createCanonicalKnownFact({
        factKey: "installation_interest",
        valueKind: "boolean",
        value: false,
        state: "confirmed",
      }),
    ],
  }) as never;
  const knownInferredSnapshot = createContextualQualificationSnapshot({
    knownFacts: [
      createCanonicalKnownFact({
        factKey: "installation_interest",
        valueKind: "boolean",
        value: true,
        state: "inferred",
      }),
    ],
  }) as never;
  const conflictSnapshot = createContextualQualificationSnapshot({
    conflicts: [
      createCanonicalConflict({
        factKey: "installation_interest",
        valueKind: "boolean",
      }),
    ],
  }) as never;
  const conflictWinsSnapshot = createContextualQualificationSnapshot({
    knownFacts: [
      createCanonicalKnownFact({
        factKey: "installation_interest",
        valueKind: "boolean",
        value: false,
      }),
    ],
    conflicts: [
      createCanonicalConflict({
        factKey: "installation_interest",
        valueKind: "boolean",
      }),
    ],
  }) as never;

  assert.equal(
    resolveQualificationProfileInstallationEvidenceState(absentSnapshot),
    "absent",
  );
  assert.equal(
    resolveQualificationProfileInstallationEvidenceState(knownTrueSnapshot),
    "known",
  );
  assert.equal(
    resolveQualificationProfileInstallationEvidenceState(knownFalseSnapshot),
    "known",
  );
  assert.equal(
    resolveQualificationProfileInstallationEvidenceState(knownInferredSnapshot),
    "known",
  );
  assert.equal(
    resolveQualificationProfileInstallationEvidenceState(conflictSnapshot),
    "conflict",
  );
  assert.equal(
    resolveQualificationProfileInstallationEvidenceState(conflictWinsSnapshot),
    "conflict",
  );
});

test("qualification profile materializer calls only the guard rpc with canonical scope and anchor event key", async () => {
  const supabase = new FakeSupabase(
    {},
    {},
    {
      materialize_commercial_opportunity_profile_from_qualification_by_system: {
        data: [createProfileMaterializationRow()],
        error: null,
      },
    },
  );

  const result =
    await materializeCommercialOpportunityProfileFromQualificationBySystem({
      supabase,
      organizationId: "org-1",
      storeId: "store-1",
      commercialOpportunityId: "opp-1",
      materializationEventKey: "msg-anchor",
      canonicalQualificationSnapshot: createContextualQualificationSnapshot({
        knownFacts: [
          createCanonicalKnownFact({
            factKey: "installation_interest",
            valueKind: "boolean",
            value: false,
          }),
        ],
      }) as never,
    });

  assert.equal(result.ok, true);
  assert.deepEqual(supabase.rpcCalls, [
    {
      fn: "materialize_commercial_opportunity_profile_from_qualification_by_system",
      payload: {
        p_organization_id: "org-1",
        p_store_id: "store-1",
        p_commercial_opportunity_id: "opp-1",
        p_materialization_event_key: "msg-anchor",
        p_installation_evidence_state: "known",
      },
    },
  ]);
  assert.equal(
    supabase.rpcCalls.some(
      (call) =>
        call.fn === "write_commercial_opportunity_profile_by_system" ||
        call.fn === "write_commercial_opportunity_profile_internal",
    ),
    false,
  );
});

test("qualification profile materializer source uses only the guard and never maps installation interest to included or excluded", () => {
  const source = readFileSync(
    "src/lib/server/generate-ai-sales-reply.ts",
    "utf8",
  );
  const resolverStart = source.indexOf(
    "export function resolveQualificationProfileInstallationEvidenceState(",
  );
  const helperStart = source.indexOf(
    "export async function materializeCommercialOpportunityProfileFromQualificationBySystem(",
  );
  const helperEnd = source.indexOf(
    "async function writeCanonicalQualificationFactBySystem(",
    helperStart,
  );

  assert.equal(resolverStart > -1, true);
  assert.equal(helperStart > resolverStart, true);
  assert.equal(helperEnd > helperStart, true);

  const block = source.slice(resolverStart, helperEnd);

  assert.equal(
    block.includes(
      "materialize_commercial_opportunity_profile_from_qualification_by_system",
    ),
    true,
  );
  assert.equal(block.includes("write_commercial_opportunity_profile_by_system"), false);
  assert.equal(block.includes("write_commercial_opportunity_profile_internal"), false);
  assert.equal(block.includes("included"), false);
  assert.equal(block.includes("excluded"), false);
});

test("qualification profile materializer treats preserved human and superior authority as success", async () => {
  for (const outcome of [
    "preserved_human_authority",
    "preserved_non_qualification_authority",
    "qualification_profile_unchanged",
    "idempotent_replay_current",
    "idempotent_replay_stale",
    "qualification_profile_materialization_completed",
  ]) {
    const supabase = new FakeSupabase(
      {},
      {},
      {
        materialize_commercial_opportunity_profile_from_qualification_by_system: {
          data: [
            createProfileMaterializationRow({
              outcome,
              preserved:
                outcome === "preserved_human_authority" ||
                outcome === "preserved_non_qualification_authority",
              changed: false,
              replayed: outcome.startsWith("idempotent_replay"),
              componentCount: 2,
              executionIntentCount: 1,
              profileState: "resolved",
              actorType:
                outcome === "preserved_human_authority" ? "human" : "system",
            }),
          ],
          error: null,
        },
      },
    );

    const result =
      await materializeCommercialOpportunityProfileFromQualificationBySystem({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        materializationEventKey: "msg-anchor",
        canonicalQualificationSnapshot:
          createContextualQualificationSnapshot() as never,
      });

    assert.equal(result.ok, true, outcome);
  }
});

test("qualification profile materializer fails closed on rpc error cardinality invalid payload or missing event key", async () => {
  for (const materializerResponse of [
    { data: null, error: { message: "materializer exploded" } },
    { data: [], error: null },
    {
      data: [createProfileMaterializationRow(), createProfileMaterializationRow()],
      error: null,
    },
    {
      data: [
        createProfileMaterializationRow({
          currentProfileVersionId: "",
        }),
      ],
      error: null,
    },
  ]) {
    const supabase = new FakeSupabase(
      {},
      {},
      {
        materialize_commercial_opportunity_profile_from_qualification_by_system:
          materializerResponse,
      },
    );

    const result =
      await materializeCommercialOpportunityProfileFromQualificationBySystem({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        materializationEventKey: "msg-anchor",
        canonicalQualificationSnapshot:
          createContextualQualificationSnapshot() as never,
      });

    assert.equal(result.ok, false);
  }

  const missingEventKeyResult =
    await materializeCommercialOpportunityProfileFromQualificationBySystem({
      supabase: new FakeSupabase(
        {},
        {},
        {
          materialize_commercial_opportunity_profile_from_qualification_by_system:
            {
              data: [createProfileMaterializationRow()],
              error: null,
            },
        },
      ),
      organizationId: "org-1",
      storeId: "store-1",
      commercialOpportunityId: "opp-1",
      materializationEventKey: "",
      canonicalQualificationSnapshot:
        createContextualQualificationSnapshot() as never,
    });

  assert.equal(missingEventKeyResult.ok, false);
});

test("generateAiSalesReply writes canonical qualification facts, rereads snapshot, and aggregates usage", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    canonicalReaderResponses: [
      {
        data: [
          createCanonicalQualificationReaderRow({
            commercialOpportunityId: "opp-1",
            knownFacts: [],
            missingFactGroups: [createCanonicalMissingGroup({ groupKey: "space", factKeys: ["space_text"] })],
            canAskNextQuestion: true,
          }),
        ],
        error: null,
      },
      {
        data: [
          createCanonicalQualificationReaderRow({
            commercialOpportunityId: "opp-1",
            knownFacts: [
              createCanonicalKnownFact({
                factKey: "technical_visit_interest",
                valueKind: "boolean",
                value: true,
                state: "confirmed",
                sourceType: "incoming_customer_message",
              }),
              createCanonicalKnownFact({
                factKey: "space_text",
                normalizedValueText: "3x4",
                sourceType: "incoming_customer_message",
              }),
              createCanonicalKnownFact({
                factKey: "requested_area_m2",
                valueKind: "number",
                value: 12,
                state: "confirmed",
                sourceType: "incoming_customer_message",
              }),
            ],
            missingFactGroups: [],
            canAskNextQuestion: false,
          }),
        ],
        error: null,
      },
    ],
  });
  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({
        candidates: [
          {
            fact_key: "technical_visit_interest",
            assertion_level: "confirmed",
            value_kind: "boolean",
            text_value: null,
            number_value: null,
            boolean_value: true,
            evidence_text: "quero uma visita tecnica",
          },
          {
            fact_key: "space_text",
            assertion_level: "confirmed",
            value_kind: "text",
            text_value: "3x4",
            number_value: null,
            boolean_value: null,
            evidence_text: "3x4",
          },
        ],
      }),
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      },
    },
    {
      output_text: "Podemos seguir com a visita tecnica",
      usage: {
        input_tokens: 40,
        output_tokens: 20,
        total_tokens: 60,
      },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.aiText, "Podemos seguir com a visita tecnica");
  assert.equal(result.usage.tokensPrompt, 50);
  assert.equal(result.usage.tokensCompletion, 25);
  assert.equal(result.usage.totalTokens, 75);

  const writerCalls = supabase.rpcCalls.filter(
    (call) => call.fn === "write_commercial_opportunity_qualification_fact_by_system",
  );
  assert.equal(writerCalls.length, 3);
  assert.deepEqual(
    writerCalls.map((call) => call.payload.p_fact_key),
    ["space_text", "requested_area_m2", "technical_visit_interest"],
  );
  assert.deepEqual(
    writerCalls.map((call) => call.payload.p_source_message_id),
    ["msg-anchor", "msg-anchor", "msg-anchor"],
  );
  assert.deepEqual(
    writerCalls.map((call) => call.payload.p_source_conversation_id),
    ["conv-1", "conv-1", "conv-1"],
  );
  assert.deepEqual(
    writerCalls.map((call) => call.payload.p_operation_key),
    [
      "p9_qfact_extract_v1:msg-anchor:space_text",
      "p9_qfact_extract_v1:msg-anchor:requested_area_m2",
      "p9_qfact_extract_v1:msg-anchor:technical_visit_interest",
    ],
  );
  assert.equal(
    writerCalls.every((call) => call.payload.p_created_by === "sales_ai_qualification_extractor_v1"),
    true,
  );
  assert.equal(writerCalls.every((call) => call.payload.p_resolves_conflict === false), true);
  assert.equal(
    supabase.rpcCalls.filter(
      (call) => call.fn === "read_commercial_opportunity_qualification_facts_by_system",
    ).length,
    2,
  );

  const finalOpenAiCall = openai.calls[1] as { instructions?: string };
  assert.equal(
    String(finalOpenAiCall.instructions || "").includes("technical_visit_interest: true"),
    true,
  );
});

test("generateAiSalesReply tells the model when the turn is a scheduled resume", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "me chama amanha",
  });

  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
    {
      output_text: "Oi! Como combinamos, estou voltando por aqui.",
      usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    scheduledResumeContext: {
      reason: "customer_requested_tomorrow",
      resumeAt: "2026-09-05T12:00:00.000Z",
      styleHint: "Retomar de forma natural, humana e sem pressao.",
    },
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.context.operationalFollowUpDecision, {
    kind: "none",
    reason: "none",
  });

  const finalOpenAiCall = openai.calls[1] as Record<string, unknown>;
  const finalPayload = JSON.stringify(finalOpenAiCall);

  assert.equal(
    finalPayload.includes("RETOMADA PROGRAMADA"),
    true,
    "scheduled resume must be explicit in the model instructions",
  );
  assert.equal(
    finalPayload.includes("nao e uma nova mensagem do cliente"),
    true,
  );
  assert.equal(
    finalPayload.includes("retome de forma natural"),
    true,
  );
  assert.equal(
    finalPayload.includes("nao responda novamente ao pedido antigo de ser chamado"),
    true,
  );
});
test("generateAiSalesReply materializes profile with the initial qualification snapshot when no new facts are written", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "oi, queria entender melhor as opcoes",
    canonicalReaderResponses: [
      {
        data: [
          createCanonicalQualificationReaderRow({
            commercialOpportunityId: "opp-1",
            knownFacts: [
              createCanonicalKnownFact({
                factKey: "installation_interest",
                valueKind: "boolean",
                value: false,
                state: "confirmed",
              }),
            ],
            missingFactGroups: [],
            canAskNextQuestion: false,
          }),
        ],
        error: null,
      },
    ],
  });
  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
    {
      output_text: "Te ajudo com as opcoes.",
      usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  assert.equal(
    supabase.rpcCalls.filter(
      (call) => call.fn === "write_commercial_opportunity_qualification_fact_by_system",
    ).length,
    0,
  );
  assert.equal(
    supabase.rpcCalls.filter(
      (call) => call.fn === "read_commercial_opportunity_qualification_facts_by_system",
    ).length,
    1,
  );
  const materializerCalls = supabase.rpcCalls.filter(
    (call) =>
      call.fn ===
      "materialize_commercial_opportunity_profile_from_qualification_by_system",
  );
  assert.equal(materializerCalls.length, 1);
  assert.deepEqual(materializerCalls[0]?.payload, {
    p_organization_id: "org-1",
    p_store_id: "store-1",
    p_commercial_opportunity_id: "opp-1",
    p_materialization_event_key: "msg-anchor",
    p_installation_evidence_state: "known",
  });
});

test("generateAiSalesReply materializes profile with the post-write qualification snapshot", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "tambem quero instalacao",
    canonicalReaderResponses: [
      {
        data: [
          createCanonicalQualificationReaderRow({
            commercialOpportunityId: "opp-1",
            knownFacts: [],
            missingFactGroups: [
              createCanonicalMissingGroup({
                groupKey: "installation",
                factKeys: ["installation_interest"],
              }),
            ],
            canAskNextQuestion: true,
          }),
        ],
        error: null,
      },
      {
        data: [
          createCanonicalQualificationReaderRow({
            commercialOpportunityId: "opp-1",
            knownFacts: [
              createCanonicalKnownFact({
                factKey: "installation_interest",
                valueKind: "boolean",
                value: true,
                state: "confirmed",
              }),
            ],
            missingFactGroups: [],
            canAskNextQuestion: false,
          }),
        ],
        error: null,
      },
    ],
  });
  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
    {
      output_text: "Instalacao fica como escopo a confirmar.",
      usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  assert.equal(
    supabase.rpcCalls.filter(
      (call) => call.fn === "write_commercial_opportunity_qualification_fact_by_system",
    ).length,
    1,
  );
  assert.equal(
    supabase.rpcCalls.filter(
      (call) => call.fn === "read_commercial_opportunity_qualification_facts_by_system",
    ).length,
    2,
  );
  const materializerCall = supabase.rpcCalls.find(
    (call) =>
      call.fn ===
      "materialize_commercial_opportunity_profile_from_qualification_by_system",
  );
  assert.equal(
    materializerCall?.payload.p_installation_evidence_state,
    "known",
  );
  assert.equal(
    materializerCall?.payload.p_materialization_event_key,
    "msg-anchor",
  );
});

test("generateAiSalesReply fails closed when canonical profile materialization fails", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "oi, queria entender melhor as opcoes",
    canonicalReaderResponses: [
      {
        data: [
          createCanonicalQualificationReaderRow({
            commercialOpportunityId: "opp-1",
            knownFacts: [],
            missingFactGroups: [],
            canAskNextQuestion: false,
          }),
        ],
        error: null,
      },
    ],
    materializerResponse: {
      data: null,
      error: { message: "materializer exploded" },
    },
  });
  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.deepEqual(result, {
    ok: false,
    error: "MATERIALIZE_CANONICAL_PROFILE_FAILED",
    message: "materializer exploded",
  });
  assert.equal(openai.calls.length, 1);
});

test("sales AI loads canonical discount policy as live authority instead of legacy onboarding discount fields", async () => {
  const { readFileSync } = await import("node:fs");

  const runtimeSource = readFileSync(
    "src/lib/server/generate-ai-sales-reply.ts",
    "utf8",
  );

  assert.equal(
    runtimeSource.includes("../store-discount-settings"),
    true,
    "Sales AI must consume the existing canonical discount settings module",
  );

  assert.equal(
    runtimeSource.includes("createStoreDiscountPresentationFromSources"),
    true,
    "Sales AI must reuse the canonical discount presentation instead of rebuilding discount policy from onboarding",
  );

  const discountQueryStart = runtimeSource.indexOf(
    '.from("store_discount_settings")',
  );

  assert.equal(
    discountQueryStart >= 0,
    true,
    "Sales AI must load store_discount_settings",
  );

  if (discountQueryStart >= 0) {
    const discountQueryBlock = runtimeSource.slice(
      discountQueryStart,
      discountQueryStart + 1400,
    );

    assert.equal(
      discountQueryBlock.includes('.eq("organization_id", organizationId)'),
      true,
      "canonical discount settings query must be organization scoped",
    );

    assert.equal(
      discountQueryBlock.includes('.eq("store_id", resolvedStoreId)'),
      true,
      "canonical discount settings query must be store scoped",
    );
  }

  const highValueQueryStart = runtimeSource.indexOf(
    '.from("store_high_value_discount_settings")',
  );

  assert.equal(
    highValueQueryStart >= 0,
    true,
    "Sales AI must load store_high_value_discount_settings",
  );

  if (highValueQueryStart >= 0) {
    const highValueQueryBlock = runtimeSource.slice(
      highValueQueryStart,
      highValueQueryStart + 1200,
    );

    assert.equal(
      highValueQueryBlock.includes('.eq("organization_id", organizationId)'),
      true,
      "high-value discount settings query must be organization scoped",
    );

    assert.equal(
      highValueQueryBlock.includes('.eq("store_id", resolvedStoreId)'),
      true,
      "high-value discount settings query must be store scoped",
    );
  }

  assert.equal(
    runtimeSource.includes("LOAD_DISCOUNT_SETTINGS_FAILED"),
    true,
    "failure to load canonical normal discount policy must fail closed",
  );

  assert.equal(
    runtimeSource.includes("LOAD_HIGH_VALUE_DISCOUNT_SETTINGS_FAILED"),
    true,
    "failure to load canonical high-value discount policy must fail closed",
  );

  assert.equal(
    runtimeSource.includes("POLITICA CANONICA DE DESCONTO DA LOJA"),
    true,
    "the final Sales AI context must explicitly expose canonical discount authority",
  );
});
test("generateAiSalesReply requests blocking human handoff when customer explicitly asks for a person and canonical channel allows it", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent:
      "Quero falar com uma pessoa da loja, por favor.",
    commercialOpportunityId: null,
    channelSettings: [
      {
        organization_id: "org-1",
        store_id: "store-1",
        commercial_channel_name: "WhatsApp comercial",
        commercial_receives_real_clients: true,
        commercial_is_official_sales_channel: true,
        commercial_channel_type: "WhatsApp",
        commercial_entry_priority: "Principal",
        commercial_human_handoff_enabled: true,
        commercial_channel_notes: null,
        integration_provider_name: "Provider",
        integration_connection_mode: "API / webhook",
        integrations_notes: null,
      },
    ],
  });

  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
      },
    },
    {
      output_text: "Posso continuar te ajudando por aqui.",
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
      },
    },
  ]);

  const response = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(response.ok, true);

  assert.equal(
    supabase.fromCalls.includes("store_channel_settings"),
    true,
    "Sales AI must read canonical store_channel_settings",
  );

  const context = response.ok
    ? (response.context as Record<string, any>)
    : null;

  const humanHandoff = context?.humanHandoff ?? null;

  assert.equal(humanHandoff?.requested, true);
  assert.equal(humanHandoff?.enabled, true);
  assert.equal(humanHandoff?.shouldCreateTask, true);
  assert.equal(
    humanHandoff?.taskType,
    "customer_human_handoff_request",
  );
  assert.equal(
    humanHandoff?.reason,
    "explicit_customer_request",
  );

  assert.equal(
    typeof humanHandoff?.replyOverride,
    "string",
  );

  assert.equal(
    String(humanHandoff?.replyOverride || "")
      .toLowerCase()
      .includes("pessoa"),
    true,
    "enabled handoff must have a deterministic acknowledgement to the customer",
  );
});

test("generateAiSalesReply honors canonical disabled human handoff over conflicting legacy enabled mirror", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent:
      "Quero falar com um atendente agora.",
    onboardingAnswers: [
      {
        question_key: "commercial_human_handoff_enabled",
        answer: "Sim",
      },
    ],
    channelSettings: [
      {
        organization_id: "org-1",
        store_id: "store-1",
        commercial_channel_name: "WhatsApp comercial",
        commercial_receives_real_clients: true,
        commercial_is_official_sales_channel: true,
        commercial_channel_type: "WhatsApp",
        commercial_entry_priority: "Principal",
        commercial_human_handoff_enabled: false,
        commercial_channel_notes: null,
        integration_provider_name: "Provider",
        integration_connection_mode: "API / webhook",
        integrations_notes: null,
      },
    ],
  });

  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
      },
    },
    {
      output_text: "Vou transferir voce para um atendente.",
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
      },
    },
  ]);

  const response = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(response.ok, true);

  assert.equal(
    supabase.fromCalls.includes("store_channel_settings"),
    true,
  );

  const context = response.ok
    ? (response.context as Record<string, any>)
    : null;

  const humanHandoff = context?.humanHandoff ?? null;

  assert.equal(humanHandoff?.requested, true);
  assert.equal(humanHandoff?.enabled, false);
  assert.equal(humanHandoff?.shouldCreateTask, false);
  assert.equal(
    humanHandoff?.reason,
    "human_handoff_disabled",
  );

  assert.equal(
    typeof humanHandoff?.replyOverride,
    "string",
  );

  const replyOverride =
    String(humanHandoff?.replyOverride || "").toLowerCase();

  assert.equal(
    replyOverride.includes("não consigo") ||
      replyOverride.includes("nao consigo"),
    true,
    "disabled handoff must explicitly avoid pretending that a transfer happened",
  );
});
test("generateAiSalesReply gives canonical discount policy precedence over conflicting legacy discount mirrors in final model context", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "Consegue melhorar o valor? Tem desconto?",
    onboardingAnswers: [
      {
        question_key: "max_discount_percent",
        answer: "99",
      },
      {
        question_key: "discount_policy_summary",
        answer: "LEGACY_DISCOUNT_POLICY_SHOULD_NOT_WIN",
      },
      {
        question_key: "discount_special_rules",
        answer: "LEGACY_DISCOUNT_RULE_SHOULD_NOT_WIN",
      },
    ],
    discountSettings: [
      {
        organization_id: "org-1",
        store_id: "store-1",
        default_discount_percent: 5,
        max_discount_percent: 12,
        allow_ask_above_max_discount: true,
        discount_autonomy_mode: "approval_required",
        discount_special_rules: "CANONICAL_DISCOUNT_RULE_ONLY",
      },
    ],
    highValueDiscountSettings: [
      {
        organization_id: "org-1",
        store_id: "store-1",
        enabled: true,
        threshold_amount_cents: 500000,
        discount_percent: 7,
      },
    ],
  });

  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      },
    },
    {
      output_text:
        "Vou verificar a melhor condicao dentro da politica da loja.",
      usage: {
        input_tokens: 40,
        output_tokens: 20,
        total_tokens: 60,
      },
    },
  ]);

  const response = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(response.ok, true);

  assert.equal(
    supabase.fromCalls.includes("store_discount_settings"),
    true,
  );

  assert.equal(
    supabase.fromCalls.includes("store_high_value_discount_settings"),
    true,
  );

  const finalOpenAiCall = openai.calls[1] as Record<string, unknown>;
  const finalPayload = JSON.stringify(finalOpenAiCall);

  assert.equal(
    finalPayload.includes("POLITICA CANONICA DE DESCONTO DA LOJA"),
    true,
  );

  assert.equal(
    finalPayload.includes("primeiro degrau normal configurado: 5%"),
    true,
  );

  assert.equal(
    finalPayload.includes("teto normal interno configurado: 12%"),
    true,
  );

  assert.equal(
    finalPayload.includes(
      "modo de autonomia configurado: approval_required",
    ),
    true,
  );

  assert.equal(
    finalPayload.includes("CANONICAL_DISCOUNT_RULE_ONLY"),
    true,
  );

  assert.equal(
    finalPayload.includes("R$ 5000,00"),
    true,
  );

  assert.equal(
    finalPayload.includes("existe percentual elegivel de 7%"),
    true,
  );

  assert.equal(
    finalPayload.includes("LEGACY_DISCOUNT_POLICY_SHOULD_NOT_WIN"),
    false,
    "legacy discount policy summary must not remain model-visible when canonical discount settings exist",
  );

  assert.equal(
    finalPayload.includes("LEGACY_DISCOUNT_RULE_SHOULD_NOT_WIN"),
    false,
    "legacy discount special rule must not remain model-visible when canonical discount settings exist",
  );
});
test("generateAiSalesReply prefers canonical commercial AI settings over legacy price answers", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    onboardingAnswers: [
      {
        question_key: "ai_can_send_price_directly",
        answer: true,
      },
      {
        question_key: "price_needs_human_help",
        answer: "nao",
      },
      {
        question_key: "price_talk_mode",
        answer: "quando_cliente_perguntar",
      },
      {
        question_key: "price_direct_rule",
        answer: "LEGACY_PRICE_RULE_SHOULD_NOT_WIN",
      },
    ],
    commercialAiSettings: [
      {
        organization_id: "org-1",
        store_id: "store-1",
        price_answer_policy: "human_required_for_price",
        price_context_requirements: ["installation_scope"],
      },
    ],
  });
  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({
        candidates: [],
      }),
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      },
    },
    {
      output_text: "Vou pedir para uma pessoa confirmar o valor.",
      usage: {
        input_tokens: 40,
        output_tokens: 20,
        total_tokens: 60,
      },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  assert.equal(supabase.fromCalls.includes("store_commercial_ai_settings"), true);

  const finalOpenAiCall = openai.calls[1] as Record<string, unknown>;
  const finalPayload = JSON.stringify(finalOpenAiCall);

  assert.equal(finalPayload.includes("A IA nao pode falar preco sem chamar uma pessoa da loja."), true);
  assert.equal(finalPayload.includes("LEGACY_PRICE_RULE_SHOULD_NOT_WIN"), false);
  assert.equal(finalPayload.includes("so_apos_entender_instalacao"), true);
});

test("generateAiSalesReply preserves canonical on-request price and non-tracked stock semantics for catalog items", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "quanto custa o Cloro Granulado?",
    commercialAiSettings: [{
      organization_id: "org-1",
      store_id: "store-1",
      price_answer_policy: "direct_when_asked",
      price_context_requirements: [],
      complementary_suggestions_enabled: false,
      superior_option_suggestions_enabled: false,
    }],
    catalogItems: [{
      id: "item-on-request",
      organization_id: "org-1",
      store_id: "store-1",
      sku: "CLORO-OR",
      name: "Cloro Granulado",
      description: "Produto quimico para piscina.",
      price_cents: null,
      price_status: "on_request",
      currency: "BRL",
      is_active: true,
      metadata: { categoria: "quimicos" },
      track_stock: false,
      stock_quantity: null,
      stock_status: "not_tracked",
    }],
  });

  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
    {
      output_text: "O valor desse item e sob consulta.",
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);

  const finalPayload = JSON.stringify(openai.calls[1])
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  assert.equal(
    finalPayload.includes("preco_status: on_request"),
    true,
    "canonical on_request price status must reach the model",
  );
  assert.equal(
    finalPayload.includes("preco: sob consulta"),
    true,
    "on_request must be represented as price under consultation",
  );
  assert.equal(
    finalPayload.includes("estoque_status: not_tracked"),
    true,
    "canonical not_tracked stock status must reach the model",
  );
  assert.equal(
    finalPayload.includes("estoque: nao controlado"),
    true,
    "not_tracked must not be represented as free stock",
  );
  assert.equal(
    finalPayload.includes("| estoque livre"),
    false,
    "not tracked inventory is not free inventory",
  );
});

test("generateAiSalesReply preserves canonical unknown stock instead of collapsing it to zero", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "tem Capa Termica disponivel?",
    commercialAiSettings: [{
      organization_id: "org-1",
      store_id: "store-1",
      price_answer_policy: "direct_when_asked",
      price_context_requirements: [],
      complementary_suggestions_enabled: false,
      superior_option_suggestions_enabled: false,
    }],
    catalogItems: [{
      id: "item-stock-unknown",
      organization_id: "org-1",
      store_id: "store-1",
      sku: "CAPA-UNK",
      name: "Capa Termica",
      description: "Acessorio para piscina.",
      price_cents: 50000,
      price_status: "valid",
      currency: "BRL",
      is_active: true,
      metadata: { categoria: "acessorios" },
      track_stock: true,
      stock_quantity: null,
      stock_status: "unknown",
    }],
  });

  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
    {
      output_text: "Esse item aparece no catalogo, mas preciso confirmar o estoque.",
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);

  const finalPayload = JSON.stringify(openai.calls[1])
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  assert.equal(
    finalPayload.includes("estoque_status: unknown"),
    true,
    "canonical unknown stock status must reach the model",
  );
  assert.equal(
    finalPayload.includes("estoque: desconhecido"),
    true,
    "unknown stock must remain unknown",
  );
  assert.equal(
    finalPayload.includes("estoque_status: zero"),
    false,
    "unknown stock cannot become confirmed zero",
  );
});

test("generateAiSalesReply preserves canonical on-request price and non-tracked stock semantics for pools", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "quanto custa a Piscina Consulta 400?",
    commercialAiSettings: [{
      organization_id: "org-1",
      store_id: "store-1",
      price_answer_policy: "direct_when_asked",
      price_context_requirements: [],
      complementary_suggestions_enabled: false,
      superior_option_suggestions_enabled: false,
    }],
    pools: [{
      id: "pool-on-request",
      organization_id: "org-1",
      store_id: "store-1",
      name: "Piscina Consulta 400",
      material: "fibra",
      shape: "retangular",
      width_m: 4,
      length_m: 5,
      depth_m: 1.3,
      price: null,
      price_status: "on_request",
      description: "Modelo vendido sob consulta.",
      photo_url: null,
      is_active: true,
      track_stock: false,
      stock_quantity: null,
      stock_status: "not_tracked",
    }],
  });

  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
    {
      output_text: "O valor dessa piscina e sob consulta.",
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);

  const finalPayload = JSON.stringify(openai.calls[1])
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  assert.equal(
    finalPayload.includes("preco_status: on_request"),
    true,
    "pool on_request price status must reach the model",
  );
  assert.equal(
    finalPayload.includes("preco: sob consulta"),
    true,
    "pool on_request price must stay under consultation",
  );
  assert.equal(
    finalPayload.includes("estoque_status: not_tracked"),
    true,
    "pool not_tracked status must reach the model",
  );
  assert.equal(
    finalPayload.includes("| estoque livre"),
    false,
    "pool without stock tracking cannot be described as free stock",
  );
});

test("sales AI live catalog queries load canonical price_status and stock_status columns", async () => {
  const { readFileSync } = await import("node:fs");
  const runtimeSource = readFileSync(
    "src/lib/server/generate-ai-sales-reply.ts",
    "utf8",
  );

  const poolFrom = runtimeSource.indexOf('.from("pools")');
  assert.notEqual(poolFrom, -1);

  const poolBlock = runtimeSource.slice(poolFrom, poolFrom + 1200);

  assert.equal(
    poolBlock.includes("price_status"),
    true,
    "pools live query must load canonical price_status",
  );
  assert.equal(
    poolBlock.includes("stock_status"),
    true,
    "pools live query must load canonical stock_status",
  );

  const catalogBlocks: string[] = [];
  let cursor = 0;

  while (true) {
    const index = runtimeSource.indexOf('.from("store_catalog_items")', cursor);
    if (index < 0) break;

    catalogBlocks.push(runtimeSource.slice(index, index + 1200));
    cursor = index + 1;
  }

  assert.equal(
    catalogBlocks.length >= 2,
    true,
    "expected both primary and exact catalog-item live queries",
  );

  for (const block of catalogBlocks) {
    assert.equal(
      block.includes("price_status"),
      true,
      "every catalog-item live query must load canonical price_status",
    );
    assert.equal(
      block.includes("stock_status"),
      true,
      "every catalog-item live query must load canonical stock_status",
    );
  }
});
test("generateAiSalesReply keeps explicit pool photo available when canonical stock is confirmed zero", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "Tem foto da Piscina Fibra 300?",
    commercialAiSettings: [{
      organization_id: "org-1",
      store_id: "store-1",
      price_answer_policy: "direct_when_asked",
      price_context_requirements: [],
      complementary_suggestions_enabled: false,
      superior_option_suggestions_enabled: false,
    }],
    pools: [{
      id: "pool-photo-zero",
      organization_id: "org-1",
      store_id: "store-1",
      name: "Piscina Fibra 300",
      material: "fibra",
      shape: "retangular",
      width_m: 3,
      length_m: 4,
      depth_m: 1.2,
      price: 12000,
      price_status: "valid",
      description: "Modelo com foto real cadastrada.",
      photo_url: "https://example.com/piscina-fibra-300.jpg",
      is_active: true,
      track_stock: true,
      stock_quantity: 0,
      stock_status: "zero",
    }],
  });

  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
    {
      output_text: "Vou te mostrar a foto cadastrada desse modelo.",
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.notEqual(
    result.context.catalogPhotoAction,
    null,
    "confirmed zero stock must not erase real registered photo evidence",
  );

  assert.equal(
    result.context.catalogPhotoAction?.shouldSend,
    true,
  );

  assert.equal(
    result.context.catalogPhotoAction?.targetType,
    "pool",
  );

  assert.equal(
    result.context.catalogPhotoAction?.publicUrl,
    "https://example.com/piscina-fibra-300.jpg",
  );

  assert.equal(
    result.aiText.includes("temos foto"),
    true,
    "photo-only reply may confirm registered media without claiming stock availability",
  );
});

test("catalog photo action is not gated by inventory sellability", async () => {
  const { readFileSync } = await import("node:fs");

  const runtimeSource = readFileSync(
    "src/lib/server/generate-ai-sales-reply.ts",
    "utf8",
  );

  const start = runtimeSource.indexOf(
    "function buildCatalogPhotoAction(",
  );

  assert.notEqual(start, -1);

  const nextFunction = runtimeSource.indexOf(
    "\nfunction ",
    start + 20,
  );

  assert.notEqual(nextFunction, -1);

  const block = runtimeSource.slice(start, nextFunction);

  assert.equal(
    block.includes("isSellableInventoryState"),
    false,
    "registered photo evidence must not be discarded because stock is zero",
  );

  assert.equal(
    block.includes("availability.isSellable"),
    false,
    "commercial sellability cannot be a media-existence gate",
  );
});

test("catalog photo resolution uses catalog candidates before sellability filtering", async () => {
  const { readFileSync } = await import("node:fs");

  const runtimeSource = readFileSync(
    "src/lib/server/generate-ai-sales-reply.ts",
    "utf8",
  );

  const start = runtimeSource.indexOf(
    "const photoCandidatePools = scoredPools;",
  );

  assert.notEqual(start, -1);

  const end = runtimeSource.indexOf(
    "const commercialObjective = buildCommercialObjective({",
    start,
  );

  assert.notEqual(end, -1);

  const photoFlow = runtimeSource.slice(start, end);

  const scoredCatalogForwardCount = (
    photoFlow.match(/matchedCatalogItems:\s*scoredCatalogItems/g) || []
  ).length;

  assert.equal(
    scoredCatalogForwardCount >= 2,
    true,
    "photo context and photo action must see active catalog candidates before stock sellability filtering",
  );
});
test("sales AI prompt keeps stock_status as the single stock semantics authority", async () => {
  const { readFileSync } = await import("node:fs");

  const runtimeSource = readFileSync(
    "src/lib/server/generate-ai-sales-reply.ts",
    "utf8",
  );

  assert.equal(
    runtimeSource.includes("stock_status=zero"),
    true,
    "prompt must preserve canonical zero semantics",
  );

  assert.equal(
    runtimeSource.includes("stock_status=unknown ou unknown_legacy"),
    true,
    "prompt must preserve canonical unknown semantics",
  );

  assert.equal(
    runtimeSource.includes("stock_status=not_tracked"),
    true,
    "prompt must preserve canonical not_tracked semantics",
  );

  assert.equal(
    runtimeSource.includes("estoque controlado positivo"),
    false,
    "raw positive quantity heuristic cannot compete with canonical stock_status",
  );

  assert.equal(
    runtimeSource.includes("quantidade zero ou nula"),
    false,
    "null inventory cannot be collapsed into confirmed zero by legacy prompt wording",
  );
});
test("generateAiSalesReply keeps core recommendation when proactive suggestions are disabled", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "qual piscina voce recomenda para um espaco 3x4?",
    commercialAiSettings: [{
      organization_id: "org-1",
      store_id: "store-1",
      price_answer_policy: "direct_when_asked",
      price_context_requirements: [],
      complementary_suggestions_enabled: false,
      superior_option_suggestions_enabled: false,
    }],
    pools: [{
      id: "pool-1",
      organization_id: "org-1",
      store_id: "store-1",
      name: "Piscina Compacta 300",
      material: "fibra",
      shape: "retangular",
      width_m: 3,
      length_m: 4,
      depth_m: 1.2,
      price: 12000,
      description: "Boa para espacos compactos.",
      photo_url: null,
      is_active: true,
      track_stock: false,
      stock_quantity: 0,
    }],
    catalogItems: [{
      id: "item-1",
      organization_id: "org-1",
      store_id: "store-1",
      sku: "CAPA-1",
      name: "Capa termica",
      description: "Acessorio de piscina.",
      price_cents: 50000,
      currency: "BRL",
      is_active: true,
      metadata: { categoria: "acessorios" },
      track_stock: false,
      stock_quantity: 0,
    }],
  });
  const openai = new FakeOpenAi([
    { output_text: JSON.stringify({ candidates: [] }), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
    { output_text: "Eu recomendo a Compacta 300.", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  const finalPayload = JSON.stringify(openai.calls[1]).replace(/\u00a0/g, " ");
  assert.equal(finalPayload.includes("pode recomendar agora: sim"), true);
  assert.equal(finalPayload.includes("pode sugerir complemento proativamente: nao"), true);
  assert.equal(finalPayload.includes("pode apresentar opcao superior proativamente: nao"), true);
  assert.equal(finalPayload.includes("Piscina Compacta 300"), true);
  assert.equal(finalPayload.includes("Capa termica"), false);
});

test("generateAiSalesReply still answers explicit complementary request with proactive complementary disabled", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "voces tem cloro?",
    commercialAiSettings: [{
      organization_id: "org-1",
      store_id: "store-1",
      price_answer_policy: "direct_when_asked",
      price_context_requirements: [],
      complementary_suggestions_enabled: false,
      superior_option_suggestions_enabled: false,
    }],
    catalogItems: [{
      id: "item-1",
      organization_id: "org-1",
      store_id: "store-1",
      sku: "CLORO-1",
      name: "Cloro Granulado",
      description: "Produto quimico para piscina.",
      price_cents: 3000,
      currency: "BRL",
      is_active: true,
      metadata: { categoria: "quimicos" },
      track_stock: false,
      stock_quantity: 0,
    }],
  });
  const openai = new FakeOpenAi([
    { output_text: JSON.stringify({ candidates: [] }), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
    { output_text: "Temos Cloro Granulado.", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  const finalPayload = JSON.stringify(openai.calls[1]);
  assert.equal(finalPayload.includes("pedido explicito de complementar detectado: sim"), true);
  assert.equal(finalPayload.includes("Cloro Granulado"), true);
});

test("generateAiSalesReply filters proactive complementary candidates by selected canonical category", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "qual piscina voce recomenda para um espaco 3x4?",
    commercialAiSettings: [{
      organization_id: "org-1",
      store_id: "store-1",
      price_answer_policy: "direct_when_asked",
      price_context_requirements: [],
      complementary_suggestions_enabled: true,
      complementary_scope_mode: "selected_scope",
      complementary_category_keys: ["quimicos"],
      complementary_line_keys: [],
      complementary_allowed_moments: ["after_product_interest"],
      superior_option_suggestions_enabled: false,
    }],
    pools: [{
      id: "pool-1",
      organization_id: "org-1",
      store_id: "store-1",
      name: "Piscina Compacta 300",
      material: "fibra",
      shape: "retangular",
      width_m: 3,
      length_m: 4,
      depth_m: 1.2,
      price: 12000,
      description: "Boa para espacos compactos.",
      photo_url: null,
      is_active: true,
      track_stock: false,
      stock_quantity: 0,
    }],
    catalogItems: [
      {
        id: "item-1",
        organization_id: "org-1",
        store_id: "store-1",
        sku: "CAPA-1",
        name: "Capa termica",
        description: "Acessorio de piscina.",
        price_cents: 50000,
        currency: "BRL",
        is_active: true,
        metadata: {
          categoria: "acessorios",
          compatibility: ["Piscina Compacta 300"],
        },
        track_stock: false,
        stock_quantity: 0,
      },
      {
        id: "item-2",
        organization_id: "org-1",
        store_id: "store-1",
        sku: "CLORO-1",
        name: "Cloro Granulado",
        description: "Produto quimico para piscina.",
        price_cents: 3000,
        currency: "BRL",
        is_active: true,
        metadata: {
          categoria: "quimicos",
          compatibility: ["Piscina Compacta 300"],
        },
        track_stock: false,
        stock_quantity: 0,
      },
    ],
  });
  const openai = new FakeOpenAi([
    { output_text: JSON.stringify({ candidates: [] }), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
    { output_text: "Eu recomendo a Compacta 300.", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  const finalPayload = JSON.stringify(openai.calls[1]);
  assert.equal(finalPayload.includes("categorias complementares permitidas: quimicos"), true);
  assert.equal(finalPayload.includes("linhas complementares permitidas: todas as linhas compativeis com evidencia canonica"), true);
  assert.equal(finalPayload.includes("Cloro Granulado"), true);
  assert.equal(finalPayload.includes("Capa termica"), false);
});

test("generateAiSalesReply fails closed for proactive complementary candidate without canonical relation", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "qual piscina voce recomenda para um espaco 3x4?",
    commercialAiSettings: [{
      organization_id: "org-1",
      store_id: "store-1",
      price_answer_policy: "direct_when_asked",
      price_context_requirements: [],
      complementary_suggestions_enabled: true,
      complementary_scope_mode: "all_compatible",
      complementary_category_keys: [],
      complementary_line_keys: [],
      complementary_allowed_moments: ["after_product_interest"],
      superior_option_suggestions_enabled: false,
    }],
    pools: [{
      id: "pool-1",
      organization_id: "org-1",
      store_id: "store-1",
      name: "Piscina Compacta 300",
      material: "fibra",
      shape: "retangular",
      width_m: 3,
      length_m: 4,
      depth_m: 1.2,
      price: 12000,
      description: "Boa para espacos compactos.",
      photo_url: null,
      is_active: true,
      track_stock: false,
      stock_quantity: 0,
    }],
    catalogItems: [{
      id: "item-1",
      organization_id: "org-1",
      store_id: "store-1",
      sku: "CLORO-1",
      name: "Cloro Granulado",
      description: "Produto quimico para piscina.",
      price_cents: 3000,
      currency: "BRL",
      is_active: true,
      metadata: { categoria: "quimicos" },
      track_stock: false,
      stock_quantity: 0,
    }],
  });
  const openai = new FakeOpenAi([
    { output_text: JSON.stringify({ candidates: [] }), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
    { output_text: "Eu recomendo a Compacta 300.", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  const finalPayload = JSON.stringify(openai.calls[1]);
  assert.equal(finalPayload.includes("candidatos complementares proativos carregados: 0"), true);
  assert.equal(finalPayload.includes("Cloro Granulado"), false);
});

test("generateAiSalesReply permits proactive complementary candidate by selected line with canonical relation", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "qual piscina voce recomenda para um espaco 3x4?",
    commercialAiSettings: [{
      organization_id: "org-1",
      store_id: "store-1",
      price_answer_policy: "direct_when_asked",
      price_context_requirements: [],
      complementary_suggestions_enabled: true,
      complementary_scope_mode: "selected_scope",
      complementary_category_keys: [],
      complementary_line_keys: ["tratamento"],
      complementary_allowed_moments: ["after_product_interest"],
      superior_option_suggestions_enabled: false,
    }],
    pools: [{
      id: "pool-1",
      organization_id: "org-1",
      store_id: "store-1",
      name: "Piscina Compacta 300",
      material: "fibra",
      shape: "retangular",
      width_m: 3,
      length_m: 4,
      depth_m: 1.2,
      price: 12000,
      description: "Boa para espacos compactos.",
      photo_url: null,
      is_active: true,
      track_stock: false,
      stock_quantity: 0,
    }],
    catalogItems: [
      {
        id: "item-1",
        organization_id: "org-1",
        store_id: "store-1",
        sku: "KIT-1",
        name: "Kit Tratamento",
        description: "Kit para manutencao.",
        price_cents: 9000,
        currency: "BRL",
        is_active: true,
        metadata: {
          categoria: "outros",
          line: "Tratamento",
          compatible_with: ["Piscina Compacta 300"],
        },
        track_stock: false,
        stock_quantity: 0,
      },
      {
        id: "item-2",
        organization_id: "org-1",
        store_id: "store-1",
        sku: "LUZ-1",
        name: "Iluminacao LED",
        description: "Acessorio compativel.",
        price_cents: 15000,
        currency: "BRL",
        is_active: true,
        metadata: {
          categoria: "acessorios",
          line: "Iluminacao",
          compatible_with: ["Piscina Compacta 300"],
        },
        track_stock: false,
        stock_quantity: 0,
      },
    ],
  });
  const openai = new FakeOpenAi([
    { output_text: JSON.stringify({ candidates: [] }), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
    { output_text: "Eu recomendo a Compacta 300.", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  const finalPayload = JSON.stringify(openai.calls[1]);
  assert.equal(finalPayload.includes("linhas complementares permitidas: tratamento"), true);
  assert.equal(finalPayload.includes("Kit Tratamento"), true);
  assert.equal(finalPayload.includes("Iluminacao LED"), false);
});

test("generateAiSalesReply permits explicit superior request while proactive superior is disabled", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "tem uma opcao melhor que essa?",
    commercialAiSettings: [{
      organization_id: "org-1",
      store_id: "store-1",
      price_answer_policy: "direct_when_asked",
      price_context_requirements: [],
      complementary_suggestions_enabled: false,
      superior_option_suggestions_enabled: false,
    }],
  });
  const openai = new FakeOpenAi([
    { output_text: JSON.stringify({ candidates: [] }), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
    { output_text: "Tenho uma opcao mais completa.", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  const finalPayload = JSON.stringify(openai.calls[1]);
  assert.equal(finalPayload.includes("pedido explicito de opcao superior detectado: sim"), true);
  assert.equal(finalPayload.includes("como o cliente pediu opcao melhor explicitamente"), true);
  assert.equal(finalPayload.includes("nao promover upgrade, opcao premium, maior ou mais completa espontaneamente"), false);
});

test("generateAiSalesReply does not treat higher price or dimensions alone as proactive superior evidence", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "qual piscina voce recomenda para um espaco 3x4?",
    commercialAiSettings: [{
      organization_id: "org-1",
      store_id: "store-1",
      price_answer_policy: "direct_when_asked",
      price_context_requirements: [],
      complementary_suggestions_enabled: false,
      superior_option_suggestions_enabled: true,
      superior_option_allowed_triggers: ["materially_relevant_advantage"],
    }],
    pools: [
      {
        id: "pool-1",
        organization_id: "org-1",
        store_id: "store-1",
        name: "Piscina Compacta 300",
        material: "fibra",
        shape: "retangular",
        width_m: 3,
        length_m: 4,
        depth_m: 1.2,
        price: 12000,
        description: "Boa para espacos compactos.",
        photo_url: null,
        is_active: true,
        track_stock: false,
        stock_quantity: 0,
      },
      {
        id: "pool-2",
        organization_id: "org-1",
        store_id: "store-1",
        name: "Piscina Grande 500",
        material: "fibra",
        shape: "retangular",
        width_m: 5,
        length_m: 6,
        depth_m: 1.4,
        price: 24000,
        description: "Modelo maior.",
        photo_url: null,
        is_active: true,
        track_stock: false,
        stock_quantity: 0,
      },
    ],
  });
  const openai = new FakeOpenAi([
    { output_text: JSON.stringify({ candidates: [] }), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
    { output_text: "Eu recomendo a Compacta 300.", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  const finalPayload = JSON.stringify(openai.calls[1]);
  assert.equal(finalPayload.includes("candidatos superiores proativos carregados: 0"), true);
});

test("generateAiSalesReply counts proactive superior only with comparative advantage for known need", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "gostei da Compacta 300, mas quero mais conforto para lazer",
    commercialAiSettings: [{
      organization_id: "org-1",
      store_id: "store-1",
      price_answer_policy: "direct_when_asked",
      price_context_requirements: [],
      complementary_suggestions_enabled: false,
      superior_option_suggestions_enabled: true,
      superior_option_allowed_triggers: ["materially_relevant_advantage"],
    }],
    pools: [
      {
        id: "pool-1",
        organization_id: "org-1",
        store_id: "store-1",
        name: "Piscina Compacta 300",
        material: "fibra",
        shape: "retangular",
        width_m: 3,
        length_m: 4,
        depth_m: 1.2,
        price: 12000,
        description: "Modelo simples.",
        photo_url: null,
        is_active: true,
        track_stock: false,
        stock_quantity: 0,
      },
      {
        id: "pool-2",
        organization_id: "org-1",
        store_id: "store-1",
        name: "Piscina Spa 400",
        material: "fibra",
        shape: "retangular",
        width_m: 4,
        length_m: 5,
        depth_m: 1.3,
        price: 18000,
        description: "Tem prainha e hidromassagem para mais conforto.",
        photo_url: null,
        is_active: true,
        track_stock: false,
        stock_quantity: 0,
      },
    ],
  });
  const openai = new FakeOpenAi([
    { output_text: JSON.stringify({ candidates: [] }), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
    { output_text: "Tenho uma opcao com mais conforto.", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  const finalPayload = JSON.stringify(openai.calls[1]);
  assert.equal(finalPayload.includes("candidatos superiores proativos carregados: 1"), true);
});

test("generateAiSalesReply uses canonical payment settings for Pix down payment and payment methods over legacy answers", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "Aceita Pix, cartao e entrada?",
    onboardingAnswers: [
      {
        question_key: "accepted_payment_methods",
        answer: ["boleto"],
      },
      {
        question_key: "accepted_payment_methods_summary",
        answer: "LEGACY_PAYMENT_METHODS_SHOULD_NOT_WIN",
      },
      {
        question_key: "pix_key",
        answer: "legacy-pix-key",
      },
      {
        question_key: "down_payment_rule",
        answer: "legacy entrada obrigatoria",
      },
    ],
    paymentSettings: [
      {
        organization_id: "org-1",
        store_id: "store-1",
        accepted_payment_methods: ["pix", "cartao_credito"],
        pix_key_type: "email",
        pix_key: "financeiro@example.com",
        pix_holder_name: "Loja 1",
        down_payment_mode: "required",
        down_payment_value_type: "percent",
        down_payment_percent: 20,
        down_payment_amount_cents: null,
        installments_enabled: true,
        max_installments: 6,
        installment_interest_policy: "interest_free",
        payment_notes: "Confirmacao humana do comprovante.",
      },
    ],
  });
  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    },
    {
      output_text: "A loja aceita Pix e cartao.",
      usage: { input_tokens: 40, output_tokens: 20, total_tokens: 60 },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  assert.equal(supabase.fromCalls.includes("store_payment_settings"), true);

  const finalOpenAiCall = openai.calls[1] as Record<string, unknown>;
  const finalPayload = JSON.stringify(finalOpenAiCall);

  assert.equal(finalPayload.includes("Pix, Cartao de credito"), true);
  assert.equal(finalPayload.includes("parcelamento em ate 6x"), true);
  assert.equal(finalPayload.includes("Entrada obrigatoria 20%"), true);
  assert.equal(finalPayload.includes("chave Pix configurada atualmente: sim"), true);
  assert.equal(finalPayload.includes("regra de entrada/sinal configurada atualmente: sim"), true);
  assert.equal(finalPayload.includes("LEGACY_PAYMENT_METHODS_SHOULD_NOT_WIN"), false);
  assert.equal(finalPayload.includes("legacy-pix-key"), false);
  assert.equal(finalPayload.includes("legacy entrada obrigatoria"), false);
});

test("generateAiSalesReply treats missing canonical payment and false technical visit settings as authoritative over legacy answers", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    onboardingAnswers: [
      {
        question_key: "accepted_payment_methods",
        answer: ["pix"],
      },
      {
        question_key: "accepted_payment_methods_summary",
        answer: "LEGACY_PIX_SHOULD_NOT_WIN",
      },
      {
        question_key: "offers_technical_visit",
        answer: "Sim",
      },
      {
        question_key: "technical_visit_rules",
        answer: "LEGACY_VISIT_RULE_SHOULD_NOT_WIN",
      },
    ],
    operationSettings: [
      {
        organization_id: "org-1",
        store_id: "store-1",
        offers_installation: null,
        average_installation_time_days: null,
        installation_days_rule: null,
        installation_process_notes: null,
        offers_technical_visit: false,
        technical_visit_days_rule: null,
        technical_visit_rules: [],
        technical_visit_rules_other: null,
      },
    ],
  });
  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    },
    {
      output_text: "Vou confirmar isso com a loja.",
      usage: { input_tokens: 40, output_tokens: 20, total_tokens: 60 },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  assert.equal(supabase.fromCalls.includes("store_payment_settings"), true);
  assert.equal(supabase.fromCalls.includes("store_operation_settings"), true);

  const finalOpenAiCall = openai.calls[1] as Record<string, unknown>;
  const finalPayload = JSON.stringify(finalOpenAiCall);

  assert.equal(finalPayload.includes("visita tecnica configurada atualmente: nao"), true);
  assert.equal(finalPayload.includes("chave Pix configurada atualmente: nao"), true);
  assert.equal(finalPayload.includes("regra de entrada/sinal configurada atualmente: nao"), true);
  assert.equal(finalPayload.includes("LEGACY_PIX_SHOULD_NOT_WIN"), false);
  assert.equal(finalPayload.includes("LEGACY_VISIT_RULE_SHOULD_NOT_WIN"), false);
});

test("generateAiSalesReply ignores technical visit pricing residual when offers is false", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "a visita tecnica custa quanto?",
    operationSettings: [
      {
        organization_id: "org-1",
        store_id: "store-1",
        offers_installation: null,
        average_installation_time_days: null,
        installation_days_rule: null,
        installation_process_notes: null,
        offers_technical_visit: false,
        technical_visit_days_rule: null,
        technical_visit_rules: ["pode_ter_taxa"],
        technical_visit_rules_other: null,
        technical_visit_pricing_mode: "fixed",
        technical_visit_fixed_fee_cents: 25000,
        technical_visit_case_by_case_rule: "NAO_USAR_RESIDUAL",
        technical_visit_fee_deductible_from_purchase: true,
      },
    ],
  });
  const openai = new FakeOpenAi([
    { output_text: JSON.stringify({ candidates: [] }), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
    { output_text: "Vou confirmar com a loja.", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  const finalPayload = JSON.stringify(openai.calls[1]);
  assert.equal(finalPayload.includes("loja oferece visita tecnica: nao"), true);
  assert.equal(finalPayload.includes("ignore qualquer preco, regra de calculo ou abatimento residual"), true);
  assert.equal(finalPayload.includes("R$ 250,00"), false);
  assert.equal(finalPayload.includes("NAO_USAR_RESIDUAL"), false);
});

test("generateAiSalesReply exposes free technical visit pricing authority", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "a visita tecnica e gratuita?",
    operationSettings: [
      {
        organization_id: "org-1",
        store_id: "store-1",
        offers_installation: null,
        average_installation_time_days: null,
        installation_days_rule: null,
        installation_process_notes: null,
        offers_technical_visit: true,
        technical_visit_days_rule: null,
        technical_visit_rules: [],
        technical_visit_rules_other: null,
        technical_visit_pricing_mode: "free",
        technical_visit_fixed_fee_cents: null,
        technical_visit_case_by_case_rule: null,
        technical_visit_fee_deductible_from_purchase: null,
      },
    ],
  });
  const openai = new FakeOpenAi([
    { output_text: JSON.stringify({ candidates: [] }), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
    { output_text: "A visita tecnica e gratuita.", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  const finalPayload = JSON.stringify(openai.calls[1]);
  assert.equal(finalPayload.includes("modo de cobranca da visita: free"), true);
  assert.equal(finalPayload.includes("a visita tecnica e gratuita"), true);
});

test("generateAiSalesReply exposes fixed technical visit fee and deductible authority", async () => {
  for (const deductible of [true, false]) {
    const supabase = createGenerateAiSalesReplySupabase({
      anchorMessageContent: "quanto custa a visita tecnica?",
      operationSettings: [
        {
          organization_id: "org-1",
          store_id: "store-1",
          offers_installation: null,
          average_installation_time_days: null,
          installation_days_rule: null,
          installation_process_notes: null,
          offers_technical_visit: true,
          technical_visit_days_rule: null,
          technical_visit_rules: [],
          technical_visit_rules_other: null,
          technical_visit_pricing_mode: "fixed",
          technical_visit_fixed_fee_cents: 12550,
          technical_visit_case_by_case_rule: null,
          technical_visit_fee_deductible_from_purchase: deductible,
        },
      ],
    });
    const openai = new FakeOpenAi([
      { output_text: JSON.stringify({ candidates: [] }), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
      { output_text: "A visita custa R$ 125,50.", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
    ]);

    const result = await generateAiSalesReply({
      organizationId: "org-1",
      storeId: "store-1",
      conversationId: "conv-1",
      anchorMessageId: "msg-anchor",
      supabaseClient: supabase,
      openaiClient: openai,
    });

    assert.equal(result.ok, true);
    const finalPayload = JSON.stringify(openai.calls[1]).replace(/\u00a0/g, " ");
    assert.equal(finalPayload.includes("modo de cobranca da visita: fixed"), true);
    assert.equal(finalPayload.includes("valor canonico da visita: R$ 125,50"), true);
    assert.equal(
      finalPayload.includes(
        deductible
          ? "sim, pode informar que o valor e abatido da compra"
          : "nao, pode informar que o valor nao e abatido da compra",
      ),
      true,
    );
  }
});

test("generateAiSalesReply exposes case by case rule without inventing exact fee", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "como calcula a visita tecnica?",
    operationSettings: [
      {
        organization_id: "org-1",
        store_id: "store-1",
        offers_installation: null,
        average_installation_time_days: null,
        installation_days_rule: null,
        installation_process_notes: null,
        offers_technical_visit: true,
        technical_visit_days_rule: null,
        technical_visit_rules: [],
        technical_visit_rules_other: null,
        technical_visit_pricing_mode: "case_by_case",
        technical_visit_fixed_fee_cents: null,
        technical_visit_case_by_case_rule: "Calculada conforme distancia e complexidade do acesso.",
        technical_visit_fee_deductible_from_purchase: true,
      },
    ],
  });
  const openai = new FakeOpenAi([
    { output_text: JSON.stringify({ candidates: [] }), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
    { output_text: "A visita e calculada conforme distancia.", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  const finalPayload = JSON.stringify(openai.calls[1]).replace(/\u00a0/g, " ");
  assert.equal(finalPayload.includes("modo de cobranca da visita: case_by_case"), true);
  assert.equal(finalPayload.includes("Calculada conforme distancia e complexidade do acesso."), true);
  assert.equal(finalPayload.includes("nao inventar valor exato de visita tecnica"), true);
  assert.equal(finalPayload.includes("R$"), false);
});

test("generateAiSalesReply fails closed when technical visit pricing mode or deductible is absent", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "a visita tecnica e paga ou gratis?",
    operationSettings: [
      {
        organization_id: "org-1",
        store_id: "store-1",
        offers_installation: null,
        average_installation_time_days: null,
        installation_days_rule: null,
        installation_process_notes: null,
        offers_technical_visit: true,
        technical_visit_days_rule: null,
        technical_visit_rules: [],
        technical_visit_rules_other: null,
        technical_visit_pricing_mode: null,
        technical_visit_fixed_fee_cents: null,
        technical_visit_case_by_case_rule: null,
        technical_visit_fee_deductible_from_purchase: null,
      },
    ],
  });
  const openai = new FakeOpenAi([
    { output_text: JSON.stringify({ candidates: [] }), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
    { output_text: "Vou confirmar com a loja.", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  const finalPayload = JSON.stringify(openai.calls[1]);
  assert.equal(finalPayload.includes("modo de cobranca da visita: nao configurado"), true);
  assert.equal(finalPayload.includes("nao afirmar que a visita e gratis, paga, tem valor fixo"), true);
});

test("generateAiSalesReply does not invent deductible when paid technical visit lacks deductible authority", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "se eu comprar a piscina abate a visita?",
    operationSettings: [
      {
        organization_id: "org-1",
        store_id: "store-1",
        offers_installation: null,
        average_installation_time_days: null,
        installation_days_rule: null,
        installation_process_notes: null,
        offers_technical_visit: true,
        technical_visit_days_rule: null,
        technical_visit_rules: [],
        technical_visit_rules_other: null,
        technical_visit_pricing_mode: "fixed",
        technical_visit_fixed_fee_cents: 10000,
        technical_visit_case_by_case_rule: null,
        technical_visit_fee_deductible_from_purchase: null,
      },
    ],
  });
  const openai = new FakeOpenAi([
    { output_text: JSON.stringify({ candidates: [] }), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
    { output_text: "Vou confirmar o abatimento com a loja.", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  const finalPayload = JSON.stringify(openai.calls[1]).replace(/\u00a0/g, " ");
  assert.equal(finalPayload.includes("valor canonico da visita: R$ 100,00"), true);
  assert.equal(finalPayload.includes("abatimento na compra: nao configurado; nao inventar"), true);
});

test("generateAiSalesReply does not promote pode ter taxa into technical visit pricing authority", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent: "a visita tecnica tem taxa?",
    operationSettings: [
      {
        organization_id: "org-1",
        store_id: "store-1",
        offers_installation: null,
        average_installation_time_days: null,
        installation_days_rule: null,
        installation_process_notes: null,
        offers_technical_visit: true,
        technical_visit_days_rule: null,
        technical_visit_rules: ["pode_ter_taxa"],
        technical_visit_rules_other: null,
        technical_visit_pricing_mode: null,
        technical_visit_fixed_fee_cents: null,
        technical_visit_case_by_case_rule: null,
        technical_visit_fee_deductible_from_purchase: null,
      },
    ],
  });
  const openai = new FakeOpenAi([
    { output_text: JSON.stringify({ candidates: [] }), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
    { output_text: "Vou confirmar a taxa com a loja.", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  const finalPayload = JSON.stringify(openai.calls[1]);
  assert.equal(finalPayload.includes("pode_ter_taxa legado nao autoriza cobranca, valor, modalidade ou abatimento"), true);
  assert.equal(finalPayload.includes("valor canonico da visita"), false);
});

test("generateAiSalesReply fails closed when canonical writer fails", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    writerResponse: {
      data: null,
      error: { message: "writer exploded" },
    },
  });
  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({
        candidates: [],
      }),
      usage: {
        input_tokens: 3,
        output_tokens: 1,
        total_tokens: 4,
      },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.deepEqual(result, {
    ok: false,
    error: "WRITE_CANONICAL_QUALIFICATION_FAILED",
    message: "writer exploded",
  });
  assert.equal(openai.calls.length, 1);
});

test("generateAiSalesReply skips structured extraction and writer when no explicit opportunity is anchored", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    commercialOpportunityId: null,
  });
  const openai = new FakeOpenAi([
    {
      output_text: "Posso te explicar as opcoes.",
      usage: {
        input_tokens: 7,
        output_tokens: 5,
        total_tokens: 12,
      },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  assert.equal(openai.calls.length, 1);
  assert.equal(
    supabase.rpcCalls.some(
      (call) =>
        call.fn === "write_commercial_opportunity_qualification_fact_by_system" ||
        call.fn === "read_commercial_opportunity_qualification_facts_by_system" ||
        call.fn === "materialize_commercial_opportunity_profile_from_qualification_by_system",
    ),
    false,
  );
});

test("generateAiSalesReply accepts idempotent replay current from the canonical writer", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    writerResponse: (payload) => ({
      data: [
        createWriterRow({
          commercialOpportunityId: "opp-1",
          factKey: String(payload.p_fact_key),
          valueKind: String(
            payload.p_fact_key === "requested_area_m2"
              ? "number"
              : payload.p_fact_key === "space_text"
                ? "text"
                : "boolean",
          ),
          currentState: "confirmed",
          changed: false,
          outcome: "idempotent_replay_current",
        }),
      ],
      error: null,
    }),
  });
  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
    {
      output_text: "Seguimos daqui.",
      usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
});

test("generateAiSalesReply accepts current_state conflict with confirmed_conflict_created outcome", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    writerResponse: (payload) => ({
      data: [
        createWriterRow({
          commercialOpportunityId: "opp-1",
          factKey: String(payload.p_fact_key),
          valueKind: String(
            payload.p_fact_key === "requested_area_m2"
              ? "number"
              : payload.p_fact_key === "space_text"
                ? "text"
                : "boolean",
          ),
          currentState: "conflict",
          changed: true,
          outcome: "confirmed_conflict_created",
        }),
      ],
      error: null,
    }),
  });
  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
    {
      output_text: "Preciso confirmar alguns pontos.",
      usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
});

test("generateAiSalesReply rejects structurally invalid canonical writer payload", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    writerResponse: {
      data: [
        createWriterRow({
          commercialOpportunityId: "opp-1",
          factKey: "space_text",
          valueKind: "text",
          currentState: "confirmed",
          outcome: "",
        }),
      ],
      error: null,
    },
  });
  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.deepEqual(result, {
    ok: false,
    error: "WRITE_CANONICAL_QUALIFICATION_FAILED",
    message: "Canonical qualification writer returned an invalid payload.",
  });
});

test("generateAiSalesReply fails closed when post-write canonical reader fails", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    canonicalReaderResponses: [
      {
        data: [
          createCanonicalQualificationReaderRow({
            commercialOpportunityId: "opp-1",
            knownFacts: [],
            missingFactGroups: [],
            canAskNextQuestion: true,
          }),
        ],
        error: null,
      },
      {
        data: null,
        error: { message: "post-write reader exploded" },
      },
    ],
  });
  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.deepEqual(result, {
    ok: false,
    error: "LOAD_CANONICAL_QUALIFICATION_FAILED",
    message: "post-write reader exploded",
  });
  assert.equal(openai.calls.length, 1);
});

test("generateAiSalesReply keeps deterministic facts when structured extraction fails and still continues", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    canonicalReaderResponses: [
      {
        data: [
          createCanonicalQualificationReaderRow({
            commercialOpportunityId: "opp-1",
            knownFacts: [],
            missingFactGroups: [],
            canAskNextQuestion: true,
          }),
        ],
        error: null,
      },
      {
        data: [
          createCanonicalQualificationReaderRow({
            commercialOpportunityId: "opp-1",
            knownFacts: [
              createCanonicalKnownFact({
                factKey: "space_text",
                normalizedValueText: "3x4",
                state: "confirmed",
                sourceType: "incoming_customer_message",
              }),
              createCanonicalKnownFact({
                factKey: "requested_area_m2",
                valueKind: "number",
                value: 12,
                state: "confirmed",
                sourceType: "incoming_customer_message",
              }),
            ],
            missingFactGroups: [],
            canAskNextQuestion: false,
          }),
        ],
        error: null,
      },
    ],
  });
  const openai = {
    calls: [] as unknown[],
    responses: {
      create: async (payload: any) => {
        openai.calls.push(payload);
        if (openai.calls.length === 1) {
          throw new Error("structured extraction exploded");
        }
        return {
          output_text: "Consigo seguir com essa medida",
          usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
        };
      },
    },
  };

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.aiText, "Consigo seguir com essa medida");
  assert.deepEqual(
    supabase.rpcCalls
      .filter((call) => call.fn === "write_commercial_opportunity_qualification_fact_by_system")
      .map((call) => call.payload.p_fact_key),
    ["space_text", "requested_area_m2", "technical_visit_interest"],
  );
  assert.equal(
    supabase.rpcCalls.filter(
      (call) => call.fn === "read_commercial_opportunity_qualification_facts_by_system",
    ).length,
    2,
  );
});

test("generateAiSalesReply returns null-safe partial usage aggregation", async () => {
  const supabase = createGenerateAiSalesReplySupabase();
  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: {
        input_tokens: 10,
      },
    },
    {
      output_text: "Resposta final.",
      usage: {
        input_tokens: 40,
        output_tokens: 20,
        total_tokens: 60,
      },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.usage.tokensPrompt, 50);
  assert.equal(result.usage.tokensCompletion, null);
  assert.equal(result.usage.totalTokens, null);
  assert.equal(result.usage.costUsd, null);
  assert.equal(result.usage.inputTokenPriceUsdPer1M, 0.4);
  assert.equal(result.usage.outputTokenPriceUsdPer1M, 1.6);
});

test("CMIR new independent opportunity keeps arrival A historical and routes canonical qualification to resolved B", async () => {
  const arrivalOpportunityId = "opp-1";
  const seed = [
    "zion",
    "p9",
    "cmir",
    "v1",
    "org-1",
    "store-1",
    "msg-anchor",
    "child",
  ].join(":");
  const hex = createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32);
  const resolvedOpportunityId = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");

  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent:
      "Agora quero comprar outra piscina para minha chacara, o espaco e 3x4.",
    commercialOpportunityId: arrivalOpportunityId,
    includeCurrentIntentResolution: false,
    additionalCommercialOpportunities: [
      {
        id: resolvedOpportunityId,
        organization_id: "org-1",
        store_id: "store-1",
        stage: "novo_lead",
      },
    ],
    canonicalReaderResponses: [
      {
        data: [
          createCanonicalQualificationReaderRow({
            commercialOpportunityId: resolvedOpportunityId,
            knownFacts: [],
            missingFactGroups: [
              createCanonicalMissingGroup({
                groupKey: "space",
                factKeys: ["space_text", "requested_area_m2"],
              }),
            ],
            canAskNextQuestion: true,
          }),
        ],
        error: null,
      },
      {
        data: [
          createCanonicalQualificationReaderRow({
            commercialOpportunityId: resolvedOpportunityId,
            knownFacts: [
              createCanonicalKnownFact({
                factKey: "space_text",
                normalizedValueText: "3x4",
                sourceType: "incoming_customer_message",
              }),
              createCanonicalKnownFact({
                factKey: "requested_area_m2",
                valueKind: "number",
                value: 12,
                state: "confirmed",
                sourceType: "incoming_customer_message",
              }),
            ],
            missingFactGroups: [],
            canAskNextQuestion: false,
          }),
        ],
        error: null,
      },
    ],
  });

  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({
        decision_kind: "new_independent_opportunity",
        reason_code: "model_reason_is_not_authority",
        evidence: ["outra piscina"],
      }),
      usage: {
        input_tokens: 5,
        output_tokens: 2,
        total_tokens: 7,
      },
    },
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: {
        input_tokens: 6,
        output_tokens: 2,
        total_tokens: 8,
      },
    },
    {
      output_text: "Claro, vamos tratar essa nova compra separadamente.",
      usage: {
        input_tokens: 20,
        output_tokens: 10,
        total_tokens: 30,
      },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(
    result.context.responseAnchorCommercialContext?.commercialOpportunityId,
    arrivalOpportunityId,
  );
  assert.equal(result.context.resolvedCommercialOpportunityId, resolvedOpportunityId);
  assert.equal(
    result.context.commercialMessageIntentResolution?.decisionKind,
    "new_independent_opportunity",
  );
  assert.equal(
    result.context.commercialMessageIntentResolution?.resolvedCommercialOpportunityId,
    resolvedOpportunityId,
  );
  assert.equal(result.context.commercialMessageIntentResolution?.source, "writer");

  const cmirWriterCalls = supabase.rpcCalls.filter(
    (call) => call.fn === "write_commercial_message_intent_resolution_by_system",
  );
  assert.equal(cmirWriterCalls.length, 1);
  assert.equal(cmirWriterCalls[0]?.payload.p_anchor_message_id, "msg-anchor");
  assert.equal(
    cmirWriterCalls[0]?.payload.p_resolved_opportunity_id,
    resolvedOpportunityId,
  );
  assert.equal(cmirWriterCalls[0]?.payload.p_related_opportunity_id, null);
  assert.equal(
    cmirWriterCalls[0]?.payload.p_decision_kind,
    "new_independent_opportunity",
  );
  assert.deepEqual(
    (cmirWriterCalls[0]?.payload.p_metadata as Record<string, unknown>)
      ?.literal_anchor_evidence,
    ["outra piscina"],
  );

  const qualificationReaderCalls = supabase.rpcCalls.filter(
    (call) => call.fn === "read_commercial_opportunity_qualification_facts_by_system",
  );
  assert.deepEqual(
    qualificationReaderCalls.map(
      (call) => call.payload.p_commercial_opportunity_id,
    ),
    [resolvedOpportunityId, resolvedOpportunityId],
  );

  const qualificationWriterCalls = supabase.rpcCalls.filter(
    (call) => call.fn === "write_commercial_opportunity_qualification_fact_by_system",
  );
  assert.equal(qualificationWriterCalls.length > 0, true);
  assert.equal(
    qualificationWriterCalls.every(
      (call) => call.payload.p_commercial_opportunity_id === resolvedOpportunityId,
    ),
    true,
  );
  assert.equal(
    qualificationWriterCalls.some(
      (call) => call.payload.p_commercial_opportunity_id === arrivalOpportunityId,
    ),
    false,
  );

  assert.equal(openai.calls.length, 3);
  assert.equal(result.usage.tokensPrompt, 31);
  assert.equal(result.usage.tokensCompletion, 14);
  assert.equal(result.usage.totalTokens, 45);
});

test("CMIR ambiguity stays fail-closed and never qualifies the arrival opportunity", async () => {
  const arrivalOpportunityId = "opp-1";

  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent:
      "Nao sei se quero continuar essa compra ou fazer outra piscina.",
    commercialOpportunityId: arrivalOpportunityId,
    includeCurrentIntentResolution: false,
  });

  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({
        decision_kind: "needs_clarification",
        reason_code: "model_reason_is_not_authority",
        evidence: ["continuar essa compra ou fazer outra piscina"],
      }),
      usage: {
        input_tokens: 4,
        output_tokens: 2,
        total_tokens: 6,
      },
    },
    {
      output_text:
        "Voce esta falando da compra atual ou de uma nova piscina?",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(
    result.context.responseAnchorCommercialContext?.commercialOpportunityId,
    arrivalOpportunityId,
  );
  assert.equal(result.context.resolvedCommercialOpportunityId, null);
  assert.equal(
    result.context.commercialMessageIntentResolution?.decisionKind,
    "needs_clarification",
  );
  assert.equal(
    result.context.commercialMessageIntentResolution
      ?.resolvedCommercialOpportunityId,
    null,
  );
  assert.equal(result.context.commercialMessageIntentResolution?.source, "writer");

  const cmirWriterCalls = supabase.rpcCalls.filter(
    (call) =>
      call.fn === "write_commercial_message_intent_resolution_by_system",
  );

  assert.equal(cmirWriterCalls.length, 1);
  assert.equal(
    cmirWriterCalls[0]?.payload.p_decision_kind,
    "needs_clarification",
  );
  assert.equal(cmirWriterCalls[0]?.payload.p_resolved_opportunity_id, null);
  assert.equal(cmirWriterCalls[0]?.payload.p_related_opportunity_id, null);

  const qualificationReaderCalls = supabase.rpcCalls.filter(
    (call) =>
      call.fn ===
      "read_commercial_opportunity_qualification_facts_by_system",
  );
  const qualificationWriterCalls = supabase.rpcCalls.filter(
    (call) =>
      call.fn ===
      "write_commercial_opportunity_qualification_fact_by_system",
  );

  assert.equal(qualificationReaderCalls.length, 0);
  assert.equal(qualificationWriterCalls.length, 0);

  assert.equal(
    supabase.rpcCalls.some(
      (call) =>
        call.payload.p_commercial_opportunity_id === arrivalOpportunityId &&
        (call.fn ===
          "read_commercial_opportunity_qualification_facts_by_system" ||
          call.fn ===
            "write_commercial_opportunity_qualification_fact_by_system"),
    ),
    false,
  );

  assert.equal(
    result.aiText,
    "Voce esta falando da compra atual ou de uma nova piscina?",
  );
  assert.equal(openai.calls.length, 2);
  assert.equal(result.usage.tokensPrompt, 14);
  assert.equal(result.usage.tokensCompletion, 7);
  assert.equal(result.usage.totalTokens, 21);
});
test("CMIR structural ambiguity stays fail-closed and does not mutate arrival A", async () => {
  const arrivalOpportunityId = "opp-1";

  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent:
      "Quero continuar vendo essa piscina, mas talvez seja para outro projeto.",
    commercialOpportunityId: arrivalOpportunityId,
    includeCurrentIntentResolution: false,
  });

  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({
        decision_kind: "structural_ambiguity",
        evidence: ["talvez seja para outro projeto"],
      }),
      usage: {
        input_tokens: 5,
        output_tokens: 2,
        total_tokens: 7,
      },
    },
    {
      output_text:
        "Você está falando desta compra que já estávamos vendo ou de uma nova compra/projeto?",
      usage: {
        input_tokens: 20,
        output_tokens: 10,
        total_tokens: 30,
      },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(
    result.context.responseAnchorCommercialContext?.commercialOpportunityId,
    arrivalOpportunityId,
  );

  assert.equal(result.context.resolvedCommercialOpportunityId, null);

  assert.equal(
    result.context.commercialMessageIntentResolution?.decisionKind,
    "structural_ambiguity",
  );
  assert.equal(
    result.context.commercialMessageIntentResolution
      ?.resolvedCommercialOpportunityId,
    null,
  );
  assert.equal(
    result.context.commercialMessageIntentResolution
      ?.relatedCommercialOpportunityId,
    null,
  );
  assert.equal(
    result.context.commercialMessageIntentResolution?.relationType,
    null,
  );

  const cmirWriterCalls = supabase.rpcCalls.filter(
    (call) =>
      call.fn === "write_commercial_message_intent_resolution_by_system",
  );

  assert.equal(cmirWriterCalls.length, 1);
  assert.equal(
    cmirWriterCalls[0]?.payload.p_decision_kind,
    "structural_ambiguity",
  );
  assert.equal(
    cmirWriterCalls[0]?.payload.p_resolved_opportunity_id,
    null,
  );
  assert.equal(
    cmirWriterCalls[0]?.payload.p_related_opportunity_id,
    null,
  );
  assert.equal(
    cmirWriterCalls[0]?.payload.p_operation_key,
    "ai_sales_cmir:v1:msg-anchor",
  );

  const qualificationReaderCalls = supabase.rpcCalls.filter(
    (call) =>
      call.fn ===
      "read_commercial_opportunity_qualification_facts_by_system",
  );
  const qualificationWriterCalls = supabase.rpcCalls.filter(
    (call) =>
      call.fn ===
      "write_commercial_opportunity_qualification_fact_by_system",
  );

  assert.equal(qualificationReaderCalls.length, 0);
  assert.equal(qualificationWriterCalls.length, 0);

  assert.equal(
    supabase.rpcCalls.some(
      (call) =>
        call.payload.p_commercial_opportunity_id === arrivalOpportunityId &&
        (call.fn ===
          "read_commercial_opportunity_qualification_facts_by_system" ||
          call.fn ===
            "write_commercial_opportunity_qualification_fact_by_system"),
    ),
    false,
  );

  assert.equal(openai.calls.length, 2);
  assert.equal(result.usage.totalTokens, 37);
});

test("CMIR reuses existing current resolution without semantic call or rewrite", async () => {
  const supabase = createGenerateAiSalesReplySupabase({
    commercialOpportunityId: "opp-1",
  });

  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({
        candidates: [],
      }),
      usage: {
        input_tokens: 6,
        output_tokens: 2,
        total_tokens: 8,
      },
    },
    {
      output_text: "Podemos continuar com essa compra.",
      usage: {
        input_tokens: 12,
        output_tokens: 5,
        total_tokens: 17,
      },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(
    result.context.responseAnchorCommercialContext?.commercialOpportunityId,
    "opp-1",
  );
  assert.equal(result.context.resolvedCommercialOpportunityId, "opp-1");
  assert.equal(
    result.context.commercialMessageIntentResolution?.decisionKind,
    "continue_same_intent",
  );
  assert.equal(
    result.context.commercialMessageIntentResolution?.source,
    "current",
  );

  assert.equal(
    supabase.fromCalls.includes(
      "commercial_message_intent_resolution_current",
    ),
    true,
  );
  assert.equal(
    supabase.fromCalls.includes(
      "commercial_message_intent_resolution_events",
    ),
    true,
  );

  const cmirWriterCalls = supabase.rpcCalls.filter(
    (call) =>
      call.fn ===
      "write_commercial_message_intent_resolution_by_system",
  );

  assert.equal(cmirWriterCalls.length, 0);

  assert.equal(openai.calls.length, 2);

  assert.equal(result.usage.tokensPrompt, 18);
  assert.equal(result.usage.tokensCompletion, 7);
  assert.equal(result.usage.totalTokens, 25);
});

test("CMIR existing current B overrides arrival A on retry without semantic rewrite", async () => {
  const arrivalOpportunityId = "opp-1";
  const resolvedOpportunityId = "opp-resolved-b";

  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent:
      "Quero continuar falando daquela outra piscina.",
    commercialOpportunityId: arrivalOpportunityId,
    currentIntentDecisionKind: "new_independent_opportunity",
    currentIntentResolvedOpportunityId: resolvedOpportunityId,
    additionalCommercialOpportunities: [
      {
        id: resolvedOpportunityId,
        organization_id: "org-1",
        store_id: "store-1",
        stage: "qualificacao",
      },
    ],
    canonicalReaderResponses: [
      {
        data: [
          createCanonicalQualificationReaderRow({
            commercialOpportunityId: resolvedOpportunityId,
            knownFacts: [],
            missingFactGroups: [],
            canAskNextQuestion: false,
          }),
        ],
        error: null,
      },
    ],
  });

  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: {
        input_tokens: 6,
        output_tokens: 2,
        total_tokens: 8,
      },
    },
    {
      output_text: "Claro, seguimos com essa outra compra.",
      usage: {
        input_tokens: 12,
        output_tokens: 5,
        total_tokens: 17,
      },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(
    result.context.responseAnchorCommercialContext?.commercialOpportunityId,
    arrivalOpportunityId,
  );

  assert.equal(
    result.context.resolvedCommercialOpportunityId,
    resolvedOpportunityId,
  );

  assert.equal(
    result.context.commercialMessageIntentResolution?.decisionKind,
    "new_independent_opportunity",
  );
  assert.equal(
    result.context.commercialMessageIntentResolution
      ?.resolvedCommercialOpportunityId,
    resolvedOpportunityId,
  );
  assert.equal(
    result.context.commercialMessageIntentResolution?.source,
    "current",
  );

  const cmirWriterCalls = supabase.rpcCalls.filter(
    (call) =>
      call.fn === "write_commercial_message_intent_resolution_by_system",
  );

  assert.equal(cmirWriterCalls.length, 0);

  const qualificationReaderCalls = supabase.rpcCalls.filter(
    (call) =>
      call.fn ===
      "read_commercial_opportunity_qualification_facts_by_system",
  );

  assert.equal(qualificationReaderCalls.length, 1);
  assert.equal(
    qualificationReaderCalls[0]?.payload.p_commercial_opportunity_id,
    resolvedOpportunityId,
  );

  assert.equal(
    qualificationReaderCalls.some(
      (call) =>
        call.payload.p_commercial_opportunity_id === arrivalOpportunityId,
    ),
    false,
  );

  assert.equal(openai.calls.length, 2);
  assert.equal(result.usage.totalTokens, 25);
});

test("CMIR semantic continue keeps exact arrival A and ignores model supplied opportunity id", async () => {
  const arrivalOpportunityId = "opp-1";

  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent:
      "Sim, e sobre essa mesma piscina. O espaco dela e 3x4.",
    commercialOpportunityId: arrivalOpportunityId,
    includeCurrentIntentResolution: false,
    canonicalReaderResponses: [
      {
        data: [
          createCanonicalQualificationReaderRow({
            commercialOpportunityId: arrivalOpportunityId,
            knownFacts: [],
            missingFactGroups: [
              createCanonicalMissingGroup({
                groupKey: "space",
                factKeys: ["space_text", "requested_area_m2"],
              }),
            ],
            canAskNextQuestion: true,
          }),
        ],
        error: null,
      },
      {
        data: [
          createCanonicalQualificationReaderRow({
            commercialOpportunityId: arrivalOpportunityId,
            knownFacts: [],
            missingFactGroups: [],
            canAskNextQuestion: false,
          }),
        ],
        error: null,
      },
    ],
  });

  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({
        decision_kind: "continue_same_intent",
        reason_code: "model_reason_is_not_authority",
        resolved_opportunity_id: "model-must-not-choose-this-id",
        evidence: ["essa mesma piscina"],
      }),
      usage: {
        input_tokens: 5,
        output_tokens: 2,
        total_tokens: 7,
      },
    },
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: {
        input_tokens: 6,
        output_tokens: 2,
        total_tokens: 8,
      },
    },
    {
      output_text: "Perfeito, seguimos com essa mesma piscina.",
      usage: {
        input_tokens: 20,
        output_tokens: 10,
        total_tokens: 30,
      },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(
    result.context.responseAnchorCommercialContext?.commercialOpportunityId,
    arrivalOpportunityId,
  );
  assert.equal(
    result.context.resolvedCommercialOpportunityId,
    arrivalOpportunityId,
  );

  assert.equal(
    result.context.commercialMessageIntentResolution?.decisionKind,
    "continue_same_intent",
  );
  assert.equal(
    result.context.commercialMessageIntentResolution?.resolvedCommercialOpportunityId,
    arrivalOpportunityId,
  );
  assert.equal(
    result.context.commercialMessageIntentResolution?.relatedCommercialOpportunityId,
    null,
  );
  assert.equal(
    result.context.commercialMessageIntentResolution?.relationType,
    null,
  );

  const cmirWriterCalls = supabase.rpcCalls.filter(
    (call) =>
      call.fn === "write_commercial_message_intent_resolution_by_system",
  );

  assert.equal(cmirWriterCalls.length, 1);
  assert.equal(
    cmirWriterCalls[0]?.payload.p_decision_kind,
    "continue_same_intent",
  );
  assert.equal(
    cmirWriterCalls[0]?.payload.p_resolved_opportunity_id,
    arrivalOpportunityId,
  );
  assert.equal(
    cmirWriterCalls[0]?.payload.p_related_opportunity_id,
    null,
  );
  assert.equal(
    cmirWriterCalls[0]?.payload.p_operation_key,
    "ai_sales_cmir:v1:msg-anchor",
  );

  assert.notEqual(
    cmirWriterCalls[0]?.payload.p_resolved_opportunity_id,
    "model-must-not-choose-this-id",
  );

  const qualificationWriterCalls = supabase.rpcCalls.filter(
    (call) =>
      call.fn === "write_commercial_opportunity_qualification_fact_by_system",
  );

  assert.equal(qualificationWriterCalls.length > 0, true);
  assert.equal(
    qualificationWriterCalls.every(
      (call) =>
        call.payload.p_commercial_opportunity_id === arrivalOpportunityId,
    ),
    true,
  );

  assert.equal(openai.calls.length, 3);
  assert.equal(result.usage.totalTokens, 45);
});

test("CMIR semantic reopen restores exact lost arrival A without creating B", async () => {
  const arrivalOpportunityId = "opp-1";

  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent:
      "Quero retomar aquele mesmo orcamento da piscina que a gente estava vendo.",
    commercialOpportunityId: arrivalOpportunityId,
    commercialOpportunityStage: "perdido",
    cmirReopenTargetStage: "orcamento",
    includeCurrentIntentResolution: false,
    canonicalReaderResponses: [
      {
        data: [
          createCanonicalQualificationReaderRow({
            commercialOpportunityId: arrivalOpportunityId,
            knownFacts: [],
            missingFactGroups: [],
            canAskNextQuestion: false,
          }),
        ],
        error: null,
      },
    ],
  });

  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({
        decision_kind: "reopen_same_intent",
        evidence: ["retomar aquele mesmo orcamento"],
      }),
      usage: {
        input_tokens: 5,
        output_tokens: 2,
        total_tokens: 7,
      },
    },
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: {
        input_tokens: 6,
        output_tokens: 2,
        total_tokens: 8,
      },
    },
    {
      output_text: "Claro, podemos retomar aquele mesmo orçamento.",
      usage: {
        input_tokens: 20,
        output_tokens: 10,
        total_tokens: 30,
      },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(
    result.context.responseAnchorCommercialContext?.commercialOpportunityId,
    arrivalOpportunityId,
  );
  assert.equal(
    result.context.resolvedCommercialOpportunityId,
    arrivalOpportunityId,
  );

  assert.equal(
    result.context.commercialMessageIntentResolution?.decisionKind,
    "reopen_same_intent",
  );
  assert.equal(
    result.context.commercialMessageIntentResolution
      ?.resolvedCommercialOpportunityId,
    arrivalOpportunityId,
  );
  assert.equal(
    result.context.commercialMessageIntentResolution
      ?.relatedCommercialOpportunityId,
    null,
  );
  assert.equal(
    result.context.commercialMessageIntentResolution?.relationType,
    null,
  );

  const cmirWriterCalls = supabase.rpcCalls.filter(
    (call) =>
      call.fn === "write_commercial_message_intent_resolution_by_system",
  );

  assert.equal(cmirWriterCalls.length, 1);
  assert.equal(
    cmirWriterCalls[0]?.payload.p_decision_kind,
    "reopen_same_intent",
  );
  assert.equal(
    cmirWriterCalls[0]?.payload.p_resolved_opportunity_id,
    arrivalOpportunityId,
  );
  assert.equal(
    cmirWriterCalls[0]?.payload.p_related_opportunity_id,
    null,
  );
  assert.equal(
    cmirWriterCalls[0]?.payload.p_operation_key,
    "ai_sales_cmir:v1:msg-anchor",
  );

  const qualificationReaderCalls = supabase.rpcCalls.filter(
    (call) =>
      call.fn ===
      "read_commercial_opportunity_qualification_facts_by_system",
  );

  assert.equal(qualificationReaderCalls.length, 1);
  assert.equal(
    qualificationReaderCalls[0]?.payload.p_commercial_opportunity_id,
    arrivalOpportunityId,
  );

  const reopenedRowResult = await supabase
    .from("commercial_opportunities")
    .select("id, stage")
    .eq("id", arrivalOpportunityId)
    .eq("organization_id", "org-1")
    .eq("store_id", "store-1")
    .maybeSingle();

  assert.equal(reopenedRowResult.error, null);
  assert.equal(reopenedRowResult.data?.id, arrivalOpportunityId);
  assert.equal(reopenedRowResult.data?.stage, "orcamento");

  assert.equal(openai.calls.length, 3);
  assert.equal(result.usage.totalTokens, 45);
});

test("CMIR repurchase resolves child B and preserves exact arrival A as repurchase parent", async () => {
  const arrivalOpportunityId = "opp-1";
  const seed = [
    "zion",
    "p9",
    "cmir",
    "v1",
    "org-1",
    "store-1",
    "msg-anchor",
    "child",
  ].join(":");
  const hex = createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32);
  const resolvedOpportunityId = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");

  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent:
      "Quero comprar outra piscina para minha chacara, o espaco e 4x5.",
    commercialOpportunityId: arrivalOpportunityId,
    commercialOpportunityStage: "concluido_sem_mais_acoes",
    includeCurrentIntentResolution: false,
    additionalCommercialOpportunities: [
      {
        id: resolvedOpportunityId,
        organization_id: "org-1",
        store_id: "store-1",
        stage: "novo_lead",
      },
    ],
    canonicalReaderResponses: [
      {
        data: [
          createCanonicalQualificationReaderRow({
            commercialOpportunityId: resolvedOpportunityId,
            knownFacts: [],
            missingFactGroups: [
              createCanonicalMissingGroup({
                groupKey: "space",
                factKeys: ["space_text", "requested_area_m2"],
              }),
            ],
            canAskNextQuestion: true,
          }),
        ],
        error: null,
      },
      {
        data: [
          createCanonicalQualificationReaderRow({
            commercialOpportunityId: resolvedOpportunityId,
            knownFacts: [
              createCanonicalKnownFact({
                factKey: "space_text",
                normalizedValueText: "4x5",
                sourceType: "incoming_customer_message",
              }),
              createCanonicalKnownFact({
                factKey: "requested_area_m2",
                valueKind: "number",
                value: 20,
                state: "confirmed",
                sourceType: "incoming_customer_message",
              }),
            ],
            missingFactGroups: [],
            canAskNextQuestion: false,
          }),
        ],
        error: null,
      },
    ],
  });

  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({
        decision_kind: "repurchase",
        reason_code: "model_reason_is_not_authority",
        evidence: ["comprar outra piscina"],
      }),
      usage: {
        input_tokens: 5,
        output_tokens: 2,
        total_tokens: 7,
      },
    },
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: {
        input_tokens: 6,
        output_tokens: 2,
        total_tokens: 8,
      },
    },
    {
      output_text: "Claro, vamos tratar essa nova compra separadamente.",
      usage: {
        input_tokens: 20,
        output_tokens: 10,
        total_tokens: 30,
      },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(
    result.context.responseAnchorCommercialContext?.commercialOpportunityId,
    arrivalOpportunityId,
  );
  assert.equal(result.context.resolvedCommercialOpportunityId, resolvedOpportunityId);
  assert.equal(
    result.context.commercialMessageIntentResolution?.decisionKind,
    "repurchase",
  );
  assert.equal(
    result.context.commercialMessageIntentResolution?.relatedCommercialOpportunityId,
    arrivalOpportunityId,
  );
  assert.equal(
    result.context.commercialMessageIntentResolution?.relationType,
    "repurchase_of",
  );

  const cmirWriterCalls = supabase.rpcCalls.filter(
    (call) => call.fn === "write_commercial_message_intent_resolution_by_system",
  );

  assert.equal(cmirWriterCalls.length, 1);
  assert.equal(cmirWriterCalls[0]?.payload.p_resolved_opportunity_id, resolvedOpportunityId);
  assert.equal(cmirWriterCalls[0]?.payload.p_related_opportunity_id, arrivalOpportunityId);
  assert.equal(cmirWriterCalls[0]?.payload.p_decision_kind, "repurchase");

  const qualificationWriterCalls = supabase.rpcCalls.filter(
    (call) => call.fn === "write_commercial_opportunity_qualification_fact_by_system",
  );

  assert.equal(qualificationWriterCalls.length > 0, true);
  assert.equal(
    qualificationWriterCalls.every(
      (call) => call.payload.p_commercial_opportunity_id === resolvedOpportunityId,
    ),
    true,
  );
  assert.equal(
    qualificationWriterCalls.some(
      (call) => call.payload.p_commercial_opportunity_id === arrivalOpportunityId,
    ),
    false,
  );

  assert.equal(openai.calls.length, 3);
  assert.equal(result.usage.totalTokens, 45);
});

test("CMIR addendum resolves child B and preserves exact arrival A as addendum parent", async () => {
  const arrivalOpportunityId = "opp-1";
  const seed = [
    "zion",
    "p9",
    "cmir",
    "v1",
    "org-1",
    "store-1",
    "msg-anchor",
    "child",
  ].join(":");
  const hex = createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32);
  const resolvedOpportunityId = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");

  const supabase = createGenerateAiSalesReplySupabase({
    anchorMessageContent:
      "Quero adicionar mais uma piscina ao mesmo projeto, o espaco novo e 5x4.",
    commercialOpportunityId: arrivalOpportunityId,
    commercialOpportunityStage: "concluido_sem_mais_acoes",
    includeCurrentIntentResolution: false,
    additionalCommercialOpportunities: [
      {
        id: resolvedOpportunityId,
        organization_id: "org-1",
        store_id: "store-1",
        stage: "novo_lead",
      },
    ],
    canonicalReaderResponses: [
      {
        data: [
          createCanonicalQualificationReaderRow({
            commercialOpportunityId: resolvedOpportunityId,
            knownFacts: [],
            missingFactGroups: [],
            canAskNextQuestion: false,
          }),
        ],
        error: null,
      },
      {
        data: [
          createCanonicalQualificationReaderRow({
            commercialOpportunityId: resolvedOpportunityId,
            knownFacts: [],
            missingFactGroups: [],
            canAskNextQuestion: false,
          }),
        ],
        error: null,
      },
    ],
  });

  const openai = new FakeOpenAi([
    {
      output_text: JSON.stringify({
        decision_kind: "addendum",
        reason_code: "model_reason_is_not_authority",
        evidence: ["adicionar mais uma piscina ao mesmo projeto"],
      }),
      usage: {
        input_tokens: 5,
        output_tokens: 2,
        total_tokens: 7,
      },
    },
    {
      output_text: JSON.stringify({ candidates: [] }),
      usage: {
        input_tokens: 6,
        output_tokens: 2,
        total_tokens: 8,
      },
    },
    {
      output_text: "Certo, vamos tratar essa ampliacao separadamente.",
      usage: {
        input_tokens: 20,
        output_tokens: 10,
        total_tokens: 30,
      },
    },
  ]);

  const result = await generateAiSalesReply({
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    anchorMessageId: "msg-anchor",
    supabaseClient: supabase,
    openaiClient: openai,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(
    result.context.responseAnchorCommercialContext?.commercialOpportunityId,
    arrivalOpportunityId,
  );
  assert.equal(result.context.resolvedCommercialOpportunityId, resolvedOpportunityId);

  assert.equal(
    result.context.commercialMessageIntentResolution?.decisionKind,
    "addendum",
  );
  assert.equal(
    result.context.commercialMessageIntentResolution?.relatedCommercialOpportunityId,
    arrivalOpportunityId,
  );
  assert.equal(
    result.context.commercialMessageIntentResolution?.relationType,
    "addendum_to",
  );

  const cmirWriterCalls = supabase.rpcCalls.filter(
    (call) =>
      call.fn === "write_commercial_message_intent_resolution_by_system",
  );

  assert.equal(cmirWriterCalls.length, 1);
  assert.equal(
    cmirWriterCalls[0]?.payload.p_resolved_opportunity_id,
    resolvedOpportunityId,
  );
  assert.equal(
    cmirWriterCalls[0]?.payload.p_related_opportunity_id,
    arrivalOpportunityId,
  );
  assert.equal(
    cmirWriterCalls[0]?.payload.p_decision_kind,
    "addendum",
  );

  assert.equal(openai.calls.length, 3);
  assert.equal(result.usage.totalTokens, 45);
});

test("inferred fact remains inferred in snapshot and representation", async () => {
  const supabase = new FakeSupabase(
    {},
    {},
    {
      read_commercial_opportunity_qualification_facts_by_system: {
        data: [
          createCanonicalQualificationReaderRow({
            knownFacts: [
              createCanonicalKnownFact({
                factKey: "space_text",
                normalizedValueText: "3x4",
                state: "inferred",
                sourceType: "system_inference",
              }),
            ],
            provenanceSummary: {
              knownFactCount: 1,
              confirmedCount: 0,
              inferredCount: 1,
              conflictCount: 0,
              messageBackedCount: 0,
              conversationBackedCount: 0,
              sourceCounts: {
                system_inference: 1,
              },
            },
            canAskNextQuestion: false,
          }),
        ],
        error: null,
      },
    },
  );

  const result = await loadCanonicalQualificationSnapshotBySystem({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    commercialOpportunityId: "opp-1",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.snapshot.knownFacts[0]?.state, "inferred");
  assert.deepEqual(summarizeCanonicalKnownFacts(result.snapshot), [
    "espaco ou medida registrados: 3x4 (inferido)",
  ]);
});

test("boolean false representation stays semantically false and neutral", () => {
  assert.equal(
    describeCanonicalKnownFact(
      createCanonicalKnownFact({
        factKey: "payment_interest",
        valueKind: "boolean",
        value: false,
      }) as never,
    ),
    "payment_interest: false",
  );
  assert.equal(
    describeCanonicalKnownFact(
      createCanonicalKnownFact({
        factKey: "installation_interest",
        valueKind: "boolean",
        value: false,
      }) as never,
    ),
    "installation_interest: false",
  );
  assert.equal(
    describeCanonicalKnownFact(
      createCanonicalKnownFact({
        factKey: "technical_visit_interest",
        valueKind: "boolean",
        value: false,
      }) as never,
    ),
    "technical_visit_interest: false",
  );
});

test("all 13 canonical fact keys have concrete known fact representation", () => {
  const snapshot = {
    organizationId: "org-1",
    storeId: "store-1",
    commercialOpportunityId: "opp-1",
    knownFacts: [
      createCanonicalKnownFact({ factKey: "need_summary", normalizedValueText: "familia" }),
      createCanonicalKnownFact({
        factKey: "interested_product_reference",
        normalizedValueText: "modelo x",
      }),
      createCanonicalKnownFact({ factKey: "space_text", normalizedValueText: "3x4" }),
      createCanonicalKnownFact({
        factKey: "requested_area_m2",
        valueKind: "number",
        value: 12,
      }),
      createCanonicalKnownFact({ factKey: "location_text", normalizedValueText: "campinas" }),
      createCanonicalKnownFact({
        factKey: "preferred_period_text",
        normalizedValueText: "setembro",
      }),
      createCanonicalKnownFact({ factKey: "budget_text", normalizedValueText: "20 mil" }),
      createCanonicalKnownFact({
        factKey: "decision_context",
        normalizedValueText: "decide com a familia",
      }),
      createCanonicalKnownFact({
        factKey: "installation_interest",
        valueKind: "boolean",
        value: true,
      }),
      createCanonicalKnownFact({
        factKey: "payment_interest",
        valueKind: "boolean",
        value: false,
      }),
      createCanonicalKnownFact({
        factKey: "technical_visit_interest",
        valueKind: "boolean",
        value: true,
      }),
      createCanonicalKnownFact({
        factKey: "customer_preferences_text",
        normalizedValueText: "compacta",
      }),
      createCanonicalKnownFact({
        factKey: "relevant_objection_text",
        normalizedValueText: "achou caro",
      }),
    ] as never[],
    missingFactGroups: [],
    conflicts: [],
    provenanceSummary: {
      knownFactCount: 13,
      confirmedCount: 13,
      inferredCount: 0,
      conflictCount: 0,
      messageBackedCount: 0,
      conversationBackedCount: 0,
      sourceCounts: {
        system_correction: 13,
      },
    },
    canAskNextQuestion: false,
    knownFactCount: 13,
    missingGroupCount: 0,
    conflictCount: 0,
  };

  const summary = summarizeCanonicalKnownFacts(snapshot as never);

  assert.equal(summary.length, 13);
  assert.equal(summary.every(Boolean), true);
});

test("different explicit opportunities keep commercialOpportunityId and snapshot isolated", async () => {
  const stageHarness = createCommercialOpportunityStageSupabase({
    stage: "orcamento",
  });
  const supabase = {
    ...stageHarness.client,
    rpc: async (_fn: string, payload: Record<string, unknown>) => ({
      data: [
        createCanonicalQualificationReaderRow({
          commercialOpportunityId: String(payload.p_commercial_opportunity_id),
          knownFacts: [
            createCanonicalKnownFact({
              factKey: "need_summary",
              normalizedValueText: String(payload.p_commercial_opportunity_id),
            }),
          ],
          canAskNextQuestion: false,
        }),
      ],
      error: null,
    }),
  };

  const first = await loadAnchoredCanonicalCommercialContext({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    leadState: "novo_lead",
    anchoredCommercialOpportunityId: "opp-a",
  });
  const second = await loadAnchoredCanonicalCommercialContext({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    leadState: "novo_lead",
    anchoredCommercialOpportunityId: "opp-b",
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) {
    assert.equal(first.anchoredCommercialOpportunityId, "opp-a");
    assert.equal(second.anchoredCommercialOpportunityId, "opp-b");
    assert.equal(first.canonicalQualificationSnapshot.commercialOpportunityId, "opp-a");
    assert.equal(second.canonicalQualificationSnapshot.commercialOpportunityId, "opp-b");
    assert.notDeepEqual(first.canonicalQualificationSnapshot, second.canonicalQualificationSnapshot);
  }
});
test("sales brain visit gate trusts canonical location instead of legacy heuristic minimum qualification", () => {
  const brain = buildSalesResponseBrain({
    customerName: null,
    crmStage: "qualificacao",
    conversationStatus: "active",
    humanActive: false,
    lastCustomerMessage: "Quero agendar uma visita tecnica",
    orderedMessages: [],
    offersTechnicalVisit: true,
    suggestedNextQuestion: null,
    canonicalVisitLocationState: "known",
    contextualQualification: {
      hasCanonicalSnapshot: true,
      askNow: false,
      targetFactKey: "location_text",
      targetGroup: "location",
      targetStatus: "known",
    },
  });

  assert.equal(brain.snapshot.hasMinimumVisitQualification, false);
  assert.equal(brain.snapshot.hasCanonicalVisitLocation, true);
  assert.equal(brain.snapshot.visitNeedsQualificationBeforeAgenda, false);
  assert.equal(brain.plan.allowedNextStep, "prepare_visit_handoff");
  assert.equal(
    brain.plan.questionToAsk,
    "Qual dia ou periodo costuma ser melhor para voce",
  );
});

test("sales brain visit gate blocks agenda when canonical location still needs contextual qualification", () => {
  const brain = buildSalesResponseBrain({
    customerName: "Maria",
    crmStage: "qualificacao",
    conversationStatus: "active",
    humanActive: false,
    lastCustomerMessage: "Quero agendar uma visita tecnica",
    orderedMessages: [],
    offersTechnicalVisit: true,
    suggestedNextQuestion: null,
    canonicalVisitLocationState: "not_known",
    contextualQualification: {
      hasCanonicalSnapshot: true,
      askNow: true,
      targetFactKey: "location_text",
      targetGroup: "location",
      targetStatus: "missing",
    },
  });

  assert.equal(brain.snapshot.hasCanonicalVisitLocation, false);
  assert.equal(brain.snapshot.visitNeedsQualificationBeforeAgenda, true);
  assert.equal(brain.plan.handoffHint.visit, false);
  assert.equal(brain.plan.allowedNextStep, "ask_single_missing_info");
  assert.equal(brain.plan.shouldAskQuestion, true);
  assert.equal(brain.plan.questionToAsk, null);
  assert.deepEqual(brain.plan.missingCriticalInfo, ["location_text"]);
});

test("sales brain visit gate fails closed without canonical qualification snapshot", () => {
  const brain = buildSalesResponseBrain({
    customerName: "Maria",
    crmStage: "qualificacao",
    conversationStatus: "active",
    humanActive: false,
    lastCustomerMessage: "Quero agendar uma visita tecnica",
    orderedMessages: [],
    offersTechnicalVisit: true,
    suggestedNextQuestion: null,
    canonicalVisitLocationState: "unproven",
    contextualQualification: {
      hasCanonicalSnapshot: false,
      askNow: false,
      targetFactKey: null,
      targetGroup: null,
      targetStatus: "unproven",
    },
  });

  assert.equal(brain.snapshot.hasCanonicalVisitLocation, false);
  assert.equal(brain.snapshot.visitNeedsQualificationBeforeAgenda, true);
  assert.equal(brain.plan.handoffHint.visit, false);
  assert.equal(brain.plan.shouldAskQuestion, false);
  assert.equal(brain.plan.questionToAsk, null);
});
test("technical visit without canonical snapshot cannot use legacy locationKnown to ask operational period", () => {
  const nextQuestion = inferNonQualificationNextBestQuestion({
    pattern: "general_sales_conversation",
    facts: {
      locationKnown: true,
    } as never,
    canonicalQualificationSnapshot: null,
    lastCustomerMessage: "Quero agendar uma visita tecnica",
    explicitCatalogRequest: false,
    patienceSignal: createActiveQualificationPatience() as never,
    hasCustomerLocationPhoto: false,
  });

  assert.equal(nextQuestion, null);
});

test("qualification authority without canonical snapshot blocks any remaining legacy heuristic fallback", () => {
  const nextQuestion =
    resolveNextBestQuestionAfterQualificationAuthority({
      pattern: "pool_size_discovery",
      nonQualificationQuestion: null,
      heuristicQuestion:
        "Voce prefere algo mais simples de manter ou uma opcao com mais conforto?",
      snapshot: null,
      qualificationDecision: {
        targetFactKey: null,
        targetGroup: null,
        targetStatus: "unproven",
        askNow: false,
        reason: "no_canonical_snapshot",
      },
    });

  assert.equal(nextQuestion, null);
});
test("pool size discovery keeps customer preferences as the single structured qualification authority", () => {
  const snapshot = createContextualQualificationSnapshot({
    missingFactGroups: [
      createCanonicalMissingGroup({
        groupKey: "need",
        factKeys: ["customer_preferences_text"],
      }),
    ],
    canAskNextQuestion: true,
  }) as never;

  const decision = resolveContextualQualificationDecision({
    snapshot,
    crmStage: "qualificacao",
    pattern: "pool_size_discovery",
    intents: [],
    lastCustomerMessage: "Tenho um espaco de 3 por 4 metros",
    explicitCatalogRequest: false,
    responseMode: "consultative",
    patienceSignal: createActiveQualificationPatience() as never,
  });

  assert.equal(decision.targetFactKey, "customer_preferences_text");
  assert.equal(decision.targetGroup, "need");
  assert.equal(decision.askNow, true);

  const nextQuestion =
    resolveNextBestQuestionAfterQualificationAuthority({
      pattern: "pool_size_discovery",
      nonQualificationQuestion: null,
      heuristicQuestion:
        "Voce prefere algo mais simples de manter ou uma opcao com mais conforto?",
      snapshot,
      qualificationDecision: decision,
    });

  assert.equal(nextQuestion, null);
});

test("children context keeps customer preferences structured and cannot revive depth or space legacy questions", () => {
  const snapshot = createContextualQualificationSnapshot({
    missingFactGroups: [
      createCanonicalMissingGroup({
        groupKey: "need",
        factKeys: ["customer_preferences_text"],
      }),
    ],
    canAskNextQuestion: true,
  }) as never;

  const decision = resolveContextualQualificationDecision({
    snapshot,
    crmStage: "qualificacao",
    pattern: "pool_children_context",
    intents: [],
    lastCustomerMessage: "Tenho duas criancas pequenas",
    explicitCatalogRequest: false,
    responseMode: "consultative",
    patienceSignal: createActiveQualificationPatience() as never,
  });

  assert.equal(decision.targetFactKey, "customer_preferences_text");
  assert.equal(decision.targetGroup, "need");
  assert.equal(decision.askNow, true);

  const depthQuestion =
    resolveNextBestQuestionAfterQualificationAuthority({
      pattern: "pool_children_context",
      nonQualificationQuestion: null,
      heuristicQuestion:
        "Voce prefere uma piscina mais rasa ou nao tem preferencia quanto a profundidade?",
      snapshot,
      qualificationDecision: decision,
    });

  assert.equal(depthQuestion, null);

  const spaceQuestion =
    resolveNextBestQuestionAfterQualificationAuthority({
      pattern: "pool_children_context",
      nonQualificationQuestion: null,
      heuristicQuestion:
        "Me fala mais ou menos o espaco que voce tem pra colocar a piscina",
      snapshot,
      qualificationDecision: decision,
    });

  assert.equal(spaceQuestion, null);
});
test("runtime qualification bridge never turns a canonical gap into a legacy question sentence", () => {
  const snapshot = createContextualQualificationSnapshot({
    missingFactGroups: [
      createCanonicalMissingGroup({
        groupKey: "need",
        factKeys: ["customer_preferences_text"],
      }),
    ],
    canAskNextQuestion: true,
  }) as never;

  const nextQuestion =
    resolveNextBestQuestionAfterQualificationAuthority({
      pattern: "general_sales_conversation",
      nonQualificationQuestion: null,
      heuristicQuestion:
        "Voce prefere algo mais simples de manter ou uma opcao com mais conforto?",
      snapshot,
      qualificationDecision: {
        targetFactKey: null,
        targetGroup: null,
        targetStatus: "unproven",
        askNow: false,
        reason: "no_relevant_qualification_target",
      },
    });

  assert.equal(nextQuestion, null);
});
test("quote sales brain cannot create its own city space installation questionnaire", () => {
  const brain = buildSalesResponseBrain({
    customerName: "Maria",
    crmStage: "orcamento",
    conversationStatus: "active",
    humanActive: false,
    lastCustomerMessage: "Quero um orcamento",
    orderedMessages: [],
    offersTechnicalVisit: true,
    suggestedNextQuestion: null,
    contextualQualification: {
      hasCanonicalSnapshot: true,
      askNow: false,
      targetFactKey: null,
      targetGroup: null,
      targetStatus: "known",
    },
  });

  assert.equal(brain.plan.handoffHint.quote, true);
  assert.equal(brain.plan.shouldAskQuestion, false);
  assert.equal(brain.plan.questionToAsk, null);
  assert.deepEqual(brain.plan.missingCriticalInfo, []);
});

test("quote sales brain exposes only the structured qualification target when askNow is authorized", () => {
  const brain = buildSalesResponseBrain({
    customerName: "Maria",
    crmStage: "orcamento",
    conversationStatus: "active",
    humanActive: false,
    lastCustomerMessage: "Quero um orcamento",
    orderedMessages: [],
    offersTechnicalVisit: true,
    suggestedNextQuestion: null,
    contextualQualification: {
      hasCanonicalSnapshot: true,
      askNow: true,
      targetFactKey: "location_text",
      targetGroup: "location",
      targetStatus: "missing",
    },
  });

  assert.equal(brain.plan.handoffHint.quote, true);
  assert.equal(brain.plan.shouldAskQuestion, true);
  assert.equal(brain.plan.questionToAsk, null);
  assert.deepEqual(
    brain.plan.missingCriticalInfo,
    ["location_text"],
  );
});

test("payment sales brain does not force Pix or payment preference when contextual qualification says not to ask", () => {
  const brain = buildSalesResponseBrain({
    customerName: "Maria",
    crmStage: "negociacao",
    conversationStatus: "active",
    humanActive: false,
    lastCustomerMessage: "Aceita Pix?",
    orderedMessages: [],
    hasConfiguredPixKey: true,
    acceptedPaymentMethodsSummary: "Pix e cartao",
    suggestedNextQuestion: null,
    contextualQualification: {
      hasCanonicalSnapshot: true,
      askNow: false,
      targetFactKey: "payment_interest",
      targetGroup: "payment",
      targetStatus: "known",
    },
  });

  assert.equal(brain.plan.shouldAskQuestion, false);
  assert.equal(brain.plan.questionToAsk, null);
  assert.deepEqual(brain.plan.missingCriticalInfo, []);
});

test("payment sales brain can ask only the structured payment target when contextual qualification authorizes it", () => {
  const brain = buildSalesResponseBrain({
    customerName: "Maria",
    crmStage: "negociacao",
    conversationStatus: "active",
    humanActive: false,
    lastCustomerMessage: "Como funciona o pagamento?",
    orderedMessages: [],
    acceptedPaymentMethodsSummary: "Pix e cartao",
    suggestedNextQuestion: null,
    contextualQualification: {
      hasCanonicalSnapshot: true,
      askNow: true,
      targetFactKey: "payment_interest",
      targetGroup: "payment",
      targetStatus: "missing",
    },
  });

  assert.equal(brain.plan.shouldAskQuestion, true);
  assert.equal(brain.plan.questionToAsk, null);
  assert.deepEqual(
    brain.plan.missingCriticalInfo,
    ["payment_interest"],
  );
});
test("sales AI forbids unsourced commercial claims in value selling and recommendations", async () => {
  const { readFileSync } = await import("node:fs");
  const runtimeSource = readFileSync(
    "src/lib/server/generate-ai-sales-reply.ts",
    "utf8",
  );

  assert.equal(
    runtimeSource.includes(
      "Qualidade, segurança, garantia, durabilidade, resistência, certificação e outros diferenciais só podem ser afirmados quando estiverem explicitamente comprovados",
    ),
    true,
  );

  assert.equal(
    runtimeSource.includes(
      "não use qualidade, segurança, garantia, durabilidade, resistência ou certificação como argumento comercial sem fonte explícita",
    ),
    true,
  );

  assert.equal(
    runtimeSource.includes(
      "Se a ideia for priorizar segurança para criança, eu começaria pelas opções mais rasas.",
    ),
    false,
    "shallow depth must not be presented as a safety conclusion",
  );

  assert.equal(
    runtimeSource.includes(
      "Segurança eu só trataria como diferencial se houver especificação técnica confirmada para o modelo.",
    ),
    true,
  );

  assert.equal(
    runtimeSource.includes(
      "destaque orientação, produto, instalação, qualidade, segurança, garantia, atendimento ou outro diferencial configurado",
    ),
    false,
    "generic value selling must not seed unsupported quality/safety/warranty claims",
  );
});

test("safety comparison requires explicit safety evidence instead of shallow family fit", async () => {
  const { readFileSync } = await import("node:fs");
  const runtimeSource = readFileSync(
    "src/lib/server/generate-ai-sales-reply.ts",
    "utf8",
  );

  const comparisonStart = runtimeSource.indexOf(
    "function hasComparativeSuperiorEvidence",
  );
  const comparisonEnd = runtimeSource.indexOf(
    "function looksLikeExplicitComplementaryRequest",
    comparisonStart,
  );

  assert.equal(comparisonStart >= 0, true);
  assert.equal(comparisonEnd > comparisonStart, true);

  const comparisonBlock = runtimeSource.slice(
    comparisonStart,
    comparisonEnd,
  );

  assert.equal(
    comparisonBlock.includes(
      'const safetyMarkers = /\\b(seguranca|antiderrapante)\\b/i;',
    ),
    true,
    "safety preference must require an explicit safety marker from product evidence",
  );

  assert.equal(
    comparisonBlock.includes(
      'const familyFitMarkers = /\\b(infantil|familia|ras[ao]|praia|prainha)\\b/i;',
    ),
    true,
    "family fit may still use explicit family/shallow features without calling them safety",
  );

  assert.equal(
    comparisonBlock.includes(
      'const familyMarkers = /\\b(infantil|familia|seguranca|ras[ao]|praia|prainha|antiderrapante)\\b/i;',
    ),
    false,
    "family fit and safety evidence must remain separate authorities",
  );
});
