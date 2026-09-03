import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createCommercialAssistantHandoff,
  findExistingCommercialHandoffTask,
  generateAndSaveAiSalesReply,
  mapGenerateAndSaveAiSalesReplyError,
  tryHandleCustomerContractAcceptance,
  type CommercialAssistantHandoffDeps,
} from "./generate-and-save-ai-sales-reply";
import type { CommercialHandoffContext } from "./generate-ai-sales-reply";
import { ContractAccessError } from "./sales-contracts/contract-auth";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

function createHandoff(
  overrides?: Partial<CommercialHandoffContext>,
): CommercialHandoffContext {
  return {
    taskType: "commercial_quote_request",
    intent: "quote_request",
    reason: "direct_quote_request",
    shouldCreateTask: true,
    replyOverride: "Posso te ajudar com isso.",
    customerName: "Cliente",
    customerPhone: "5511999999999",
    lastCustomerMessage: "Quero um orcamento",
    conversationSummary: "Cliente pediu orcamento",
    spaceText: "quintal",
    requestedAreaM2: 24,
    locationText: "Campinas",
    preferredPeriodText: "manha",
    recommendedModel: "Modelo X",
    relevantObjection: "prazo",
    customerPreferences: "com instalacao",
    adModelOrRequestedModel: "Modelo X",
    commercialOpportunityId: "opp-1",
    nextStep: "Responsavel deve revisar o pedido.",
    ...overrides,
  };
}

function createDeps(
  overrides?: Partial<CommercialAssistantHandoffDeps>,
): CommercialAssistantHandoffDeps {
  return {
    findExistingTask: async () => null,
    enqueueNotification: async () => ({
      created: false,
      error: null,
      reason: "stubbed",
    }),
    autoProgressBudgetFromQuote: async () => ({
      attempted: false,
      progressed: false,
      reason: "stubbed",
      skippedReason: "stubbed",
    }),
    ...overrides,
  };
}

function createSupabaseRecorder() {
  const insertedRows: Array<Record<string, unknown>> = [];
  const selectStates: Array<{
    eq: Array<{ column: string; value: unknown }>;
    in: Array<{ column: string; values: unknown[] }>;
    order: Array<{ column: string; options: Record<string, unknown> }>;
    limit: number | null;
    operations: string[];
  }> = [];

  const buildSelectQuery = (options?: { maybeSingleData?: unknown | null }) => {
    const state = {
      eq: [] as Array<{ column: string; value: unknown }>,
      in: [] as Array<{ column: string; values: unknown[] }>,
      order: [] as Array<{ column: string; options: Record<string, unknown> }>,
      limit: null as number | null,
      operations: [] as string[],
    };

    return {
      eq(column: string, value: unknown) {
        state.eq.push({ column, value });
        state.operations.push(`eq:${column}`);
        return this;
      },
      in(column: string, values: unknown[]) {
        state.in.push({ column, values });
        state.operations.push(`in:${column}`);
        return this;
      },
      order(column: string, options: Record<string, unknown>) {
        state.order.push({ column, options });
        state.operations.push(`order:${column}`);
        return this;
      },
      limit(value: number) {
        state.limit = value;
        state.operations.push(`limit:${value}`);
        return this;
      },
      async maybeSingle() {
        state.operations.push("maybeSingle");
        selectStates.push(state);
        return {
          data: options?.maybeSingleData ?? null,
          error: null,
        };
      },
    };
  };

  const buildInsertQuery = (row: Record<string, unknown>) => ({
    select() {
      return {
        async maybeSingle() {
          insertedRows.push(row);
          return {
            data: {
              id: `task-${insertedRows.length}`,
            },
            error: null,
          };
        },
      };
    },
  });

  return {
    insertedRows,
    selectStates,
    supabase: {
      from(table: string) {
        assert.equal(table, "store_assistant_operational_tasks");

        return {
          select(_selection: string) {
            return buildSelectQuery({
              maybeSingleData: {
                id: "task-existing",
                task_type: "commercial_quote_request",
                status: "open",
                commercial_opportunity_id: "opp-a",
                task_payload: null,
              },
            });
          },
          insert(row: Record<string, unknown>) {
            return buildInsertQuery(row);
          },
        };
      },
    },
  };
}

function createAcceptanceMessage(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "msg-a1",
    organization_id: "org-1",
    store_id: "store-1",
    conversation_id: "conv-1",
    sender: "user",
    direction: "incoming",
    content: "aceito a proposta A1",
    created_at: "2026-07-28T10:00:00.000Z",
    ...overrides,
  };
}

function createAcceptanceSupabase(messages: Array<Record<string, unknown>>) {
  const queryStates: Array<{ eq: Array<{ column: string; value: unknown }> }> = [];

  return {
    queryStates,
    supabase: {
      from(table: string) {
        assert.equal(table, "messages");

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
            queryStates.push(state);
            const row =
              messages.find((candidate) =>
                state.eq.every(({ column, value }) => candidate[column] === value),
              ) || null;

            return {
              data: row,
              error: null,
            };
          },
        };
      },
    },
  };
}

function createBoundaryLoader(
  states: Array<{
    lastIncomingCustomerMessageId: string | null;
    lastIncomingCustomerMessageAt: string | null;
    lastAiMessageId: string | null;
    lastAiMessageAt: string | null;
  }>,
) {
  let index = 0;

  return async () => {
    const selected =
      states[Math.min(index, states.length - 1)] || {
        lastIncomingCustomerMessageId: null,
        lastIncomingCustomerMessageAt: null,
        lastAiMessageId: null,
        lastAiMessageAt: null,
      };
    index += 1;
    return selected;
  };
}

function createAiWindowScopeSupabase(args?: {
  canonicalOrganizationId?: string;
  canonicalStoreId?: string;
  conversationId?: string;
  leadId?: string;
  storeOrganizationId?: string;
  leadOrganizationId?: string;
  conversationError?: { message: string } | null;
  storeError?: { message: string } | null;
  scheduleSettings?: Record<string, unknown> | null;
  holidayBlocks?: Array<Record<string, unknown>>;
}) {
  const canonicalOrganizationId = args?.canonicalOrganizationId ?? "org-canonical";
  const canonicalStoreId = args?.canonicalStoreId ?? "store-canonical";
  const conversationId = args?.conversationId ?? "conv-canonical";
  const leadId = args?.leadId ?? "lead-canonical";
  const storeOrganizationId = args?.storeOrganizationId ?? canonicalOrganizationId;
  const leadOrganizationId = args?.leadOrganizationId ?? canonicalOrganizationId;
  const windowUpserts: Array<{ row: Record<string, unknown>; options: Record<string, unknown> }> = [];
  const stateUpdates: Array<{
    payload: Record<string, unknown>;
    eq: Array<{ column: string; value: unknown }>;
  }> = [];
  const queueUpdates: Array<{
    payload: Record<string, unknown>;
    eq: Array<{ column: string; value: unknown }>;
    is: Array<{ column: string; value: unknown }>;
    like: Array<{ column: string; value: unknown }>;
  }> = [];
  const queueUpserts: Array<{ row: Record<string, unknown>; options: Record<string, unknown> }> = [];
  const conversationSelects: string[] = [];
  const storeSelects: string[] = [];
  const conversationFilters: Array<{ column: string; value: unknown }> = [];
  const storeFilters: Array<{ column: string; value: unknown }> = [];
  const scheduleSettings =
    args && "scheduleSettings" in args
      ? args.scheduleSettings
      : {
          operating_days: [
            "segunda",
            "terca",
            "quarta",
            "quinta",
            "sexta",
            "sabado",
            "domingo",
          ],
          operating_hours: {
            segunda: { start: "00:00", end: "23:59" },
            terca: { start: "00:00", end: "23:59" },
            quarta: { start: "00:00", end: "23:59" },
            quinta: { start: "00:00", end: "23:59" },
            sexta: { start: "00:00", end: "23:59" },
            sabado: { start: "00:00", end: "23:59" },
            domingo: { start: "00:00", end: "23:59" },
          },
          timezone_name: "America/Sao_Paulo",
          attends_holidays: false,
          ai_after_hours_enabled: false,
          ai_after_hours_mode: null,
          ai_after_hours_start: null,
          ai_after_hours_end: null,
          ai_attends_holidays: false,
        };
  const holidayBlocks = args?.holidayBlocks || [];

  return {
    windowUpserts,
    stateUpdates,
    queueUpdates,
    queueUpserts,
    conversationSelects,
    storeSelects,
    conversationFilters,
    storeFilters,
    client: {
      from(table: string) {
        if (table === "conversations") {
          const filters: Array<{ column: string; value: unknown }> = [];
          return {
            select(selection: string) {
              conversationSelects.push(selection);
              return this;
            },
            eq(column: string, value: unknown) {
              filters.push({ column, value });
              conversationFilters.push({ column, value });
              return this;
            },
            async maybeSingle() {
              if (args?.conversationError) {
                return { data: null, error: args.conversationError };
              }

              const idFilter = filters.find((item) => item.column === "id");
              if (idFilter?.value !== conversationId) {
                return { data: null, error: null };
              }

              return {
                data: {
                  id: conversationId,
                  organization_id: canonicalOrganizationId,
                  lead_id: leadId,
                  is_human_active: false,
                  leads: {
                    organization_id: leadOrganizationId,
                    store_id: canonicalStoreId,
                  },
                },
                error: null,
              };
            },
          };
        }

        if (table === "stores") {
          const filters: Array<{ column: string; value: unknown }> = [];
          return {
            select(selection: string) {
              storeSelects.push(selection);
              return this;
            },
            eq(column: string, value: unknown) {
              filters.push({ column, value });
              storeFilters.push({ column, value });
              return this;
            },
            async maybeSingle() {
              if (args?.storeError) {
                return { data: null, error: args.storeError };
              }

              const idFilter = filters.find((item) => item.column === "id");
              if (idFilter?.value !== canonicalStoreId) {
                return { data: null, error: null };
              }

              return {
                data: {
                  id: canonicalStoreId,
                  organization_id: storeOrganizationId,
                },
                error: null,
              };
            },
          };
        }

        if (table === "store_schedule_settings") {
          return {
            select(_selection: string) {
              return this;
            },
            eq(_column: string, _value: unknown) {
              return this;
            },
            async maybeSingle() {
              return {
                data: scheduleSettings,
                error: null,
              };
            },
          };
        }

        if (table === "store_schedule_blocks") {
          return {
            select(_selection: string) {
              return this;
            },
            eq(_column: string, _value: unknown) {
              return this;
            },
            lt(_column: string, _value: unknown) {
              return this;
            },
            async gt(_column: string, _value: unknown) {
              return {
                data: holidayBlocks,
                error: null,
              };
            },
          };
        }

        if (table === "conversation_ai_window_state") {
          return {
            async upsert(
              row: Record<string, unknown>,
              options: Record<string, unknown>,
            ) {
              windowUpserts.push({ row, options });
              return { error: null };
            },
            update(payload: Record<string, unknown>) {
              const state = {
                payload,
                eq: [] as Array<{ column: string; value: unknown }>,
              };
              const builder = {
                eq(column: string, value: unknown) {
                  state.eq.push({ column, value });
                  return builder;
                },
                then<TResult1 = { error: null }, TResult2 = never>(
                  onfulfilled?:
                    | ((value: { error: null }) => TResult1 | PromiseLike<TResult1>)
                    | null,
                  onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
                ) {
                  stateUpdates.push(state);
                  return Promise.resolve({ error: null }).then(onfulfilled, onrejected);
                },
              };
              return builder;
            },
          };
        }

        if (table === "ai_run_queue") {
          const state = {
            payload: {} as Record<string, unknown>,
            eq: [] as Array<{ column: string; value: unknown }>,
            is: [] as Array<{ column: string; value: unknown }>,
            like: [] as Array<{ column: string; value: unknown }>,
          };

          return {
            update(payload: Record<string, unknown>) {
              state.payload = payload;
              return this;
            },
            eq(column: string, value: unknown) {
              state.eq.push({ column, value });
              return this;
            },
            is(column: string, value: unknown) {
              state.is.push({ column, value });
              return this;
            },
            async like(column: string, value: unknown) {
              state.like.push({ column, value });
              queueUpdates.push(state);
              return { error: null };
            },
            async upsert(
              row: Record<string, unknown>,
              options: Record<string, unknown>,
            ) {
              queueUpserts.push({ row, options });
              return { error: null };
            },
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
}

async function withMockedSupabaseEnv(run: () => Promise<void>) {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";

  try {
    await run();
  } finally {
    if (previousUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    }

    if (previousKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
    }
  }
}

function createScopeAwareReplyDeps(overrides?: Record<string, unknown>) {
  return {
    detectOpenAssistantOperationalFlow: async () => ({ blocked: false as const }),
    loadConversationMessageBoundaryState: createBoundaryLoader([
      {
        lastIncomingCustomerMessageId: "msg-1",
        lastIncomingCustomerMessageAt: "2026-07-30T10:00:00.000Z",
        lastAiMessageId: null,
        lastAiMessageAt: null,
      },
      {
        lastIncomingCustomerMessageId: "msg-1",
        lastIncomingCustomerMessageAt: "2026-07-30T10:00:00.000Z",
        lastAiMessageId: null,
        lastAiMessageAt: null,
      },
    ]),
    tryHandleCustomerContractAcceptance: async () => null,
    generateAiSalesReply: async () =>
      ({
        ok: true,
        aiText: "Resposta comercial",
        anchorMessageId: "msg-1",
        usage: null,
        context: {
          operationalFollowUpDecision: {
            kind: "none",
            reason: "none",
          },
        },
      }) as never,
    updateLatestRunningAiRunUsage: async () => undefined,
    sendAiPanelMessage: async () => "msg-ai-1",
    createCommercialAssistantHandoff: async () =>
      ({
        created: false,
        skipped: true,
        reason: "handoff_not_requested",
      }) as never,
    ...overrides,
  };
}

function createCommercialOpportunityStageSupabase(args?: {
  stage?: string | null;
  rowMissing?: boolean;
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

            if (args?.rowMissing) {
              return { data: null, error: null };
            }

            return {
              data: {
                id: "opp-canonical",
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

function createQualificationAutoProgressSupabaseHarness(args?: {
  stage?: string | null;
  canonicalWriterError?: { message: string } | null;
  expectedCommercialOpportunityId?: string;
}) {
  const scope = createAiWindowScopeSupabase();
  const expectedCommercialOpportunityId =
    args?.expectedCommercialOpportunityId ?? "opp-canonical";
  const requestRpcCalls: Array<{ fn: string; payload: Record<string, unknown> }> = [];
  const systemRpcCalls: Array<{ fn: string; payload: Record<string, unknown> }> = [];
  const createClientCalls: Array<{ url: string; key: string }> = [];
  let clientIndex = 0;

  const requestClient = {
    from(table: string) {
      if (table === "commercial_opportunities") {
        const filters: Array<{ column: string; value: unknown }> = [];
        return {
          select(_selection: string) {
            return this;
          },
          eq(column: string, value: unknown) {
            filters.push({ column, value });
            return this;
          },
          async maybeSingle() {
            const idFilter = filters.find((item) => item.column === "id");
            const organizationFilter = filters.find(
              (item) => item.column === "organization_id"
            );
            const storeFilter = filters.find((item) => item.column === "store_id");

            assert.equal(idFilter?.value, expectedCommercialOpportunityId);
            assert.equal(organizationFilter?.value, "org-canonical");
            assert.equal(storeFilter?.value, "store-canonical");

            return {
              data: {
                id: expectedCommercialOpportunityId,
                stage: args?.stage ?? "novo_lead",
              },
              error: null,
            };
          },
        };
      }

      return scope.client.from(table);
    },
    async rpc(fn: string, payload: Record<string, unknown>) {
      requestRpcCalls.push({ fn, payload });

      if (fn === "transition_conversation_state_internal") {
        return { data: null, error: null };
      }

      throw new Error(`Unexpected request-scoped rpc: ${fn}`);
    },
  };

  const systemClient = {
    async rpc(fn: string, payload: Record<string, unknown>) {
      systemRpcCalls.push({ fn, payload });

      if (fn !== "transition_commercial_opportunity_stage_by_system") {
        throw new Error(`Unexpected system rpc: ${fn}`);
      }

      if (args?.canonicalWriterError) {
        return {
          data: null,
          error: args.canonicalWriterError,
        };
      }

      return {
        data: {
          commercial_opportunity_id: expectedCommercialOpportunityId,
          stage: String(payload.p_target_stage || ""),
          lifecycle_cycle: 1,
          lifecycle_event_id: "event-1",
          event_type: "stage_transition",
          reason_code: "system",
          stage_changed_at: "2026-08-11T10:00:00.000Z",
          updated_at: "2026-08-11T10:00:00.000Z",
        },
        error: null,
      };
    },
  };

  return {
    scope,
    requestRpcCalls,
    systemRpcCalls,
    createClientCalls,
    createSupabaseClient(url: string, key: string) {
      createClientCalls.push({ url, key });
      clientIndex += 1;
      return (clientIndex === 1 ? requestClient : systemClient) as never;
    },
  };
}

const tests: TestCase[] = [
  {
    name: "contract access errors are preserved in the public result",
    run: () => {
      const error = new ContractAccessError(
        409,
        "ZCB19",
        "Nao foi possivel concluir o aceite do cliente (ZCB19: ANCHOR_MESSAGE_ORDER_AMBIGUOUS).",
      ) as ContractAccessError & {
        details?: unknown;
        sqlState?: string | null;
        deterministicMessage?: string | null;
      };
      error.details = "anchor id duplicated";
      error.sqlState = "ZCB19";
      error.deterministicMessage = "ANCHOR_MESSAGE_ORDER_AMBIGUOUS";

      assert.deepEqual(mapGenerateAndSaveAiSalesReplyError(error), {
        ok: false,
        error: "ZCB19",
        message:
          "Nao foi possivel concluir o aceite do cliente (ZCB19: ANCHOR_MESSAGE_ORDER_AMBIGUOUS).",
        context: {
          details: "anchor id duplicated",
          sqlState: "ZCB19",
          deterministicMessage: "ANCHOR_MESSAGE_ORDER_AMBIGUOUS",
        },
      });
    },
  },
  {
    name: "generic errors still map to the fallback public result",
    run: () => {
      assert.deepEqual(
        mapGenerateAndSaveAiSalesReplyError(new Error("falha generica")),
        {
          ok: false,
          error: "GENERATE_AND_SAVE_AI_SALES_REPLY_FAILED",
          message: "falha generica",
        },
      );
    },
  },
  {
    name: "persists the explicit commercial opportunity id in the handoff insert",
    run: async () => {
      const recorder = createSupabaseRecorder();

      const result = await createCommercialAssistantHandoff(
        {
          supabase: recorder.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          conversationId: "conv-1",
          leadId: "lead-1",
          handoff: createHandoff({
            commercialOpportunityId: "opp-explicit",
          }),
        },
        createDeps(),
      );

      assert.equal(result.created, true);
      assert.equal(recorder.insertedRows.length, 1);
      assert.equal(
        recorder.insertedRows[0]?.commercial_opportunity_id,
        "opp-explicit",
      );
      assert.equal(recorder.insertedRows[0]?.organization_id, "org-1");
      assert.equal(recorder.insertedRows[0]?.store_id, "store-1");
      assert.equal(recorder.insertedRows[0]?.related_conversation_id, "conv-1");
      assert.equal(recorder.insertedRows[0]?.related_lead_id, "lead-1");
    },
  },
  {
    name: "propagates the generation anchor message id into commercial handoff auto progress",
    run: async () => {
      const recorder = createSupabaseRecorder();
      let receivedAnchorMessageId: string | null = null;

      const result = await createCommercialAssistantHandoff(
        {
          supabase: recorder.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          conversationId: "conv-1",
          leadId: "lead-1",
          handoff: createHandoff({
            commercialOpportunityId: "opp-explicit",
          }),
          generationAnchorMessageId: "msg-anchor-1",
        },
        createDeps({
          autoProgressBudgetFromQuote: async (args) => {
            receivedAnchorMessageId = args.generationAnchorMessageId || null;
            return {
              attempted: false,
              progressed: false,
              reason: "stubbed",
              skippedReason: "stubbed",
            };
          },
        }),
      );

      assert.equal(result.created, true);
      assert.equal(receivedAnchorMessageId, "msg-anchor-1");
    },
  },
  {
    name: "dedupe does not collide across different opportunities in the same conversation",
    run: async () => {
      const recorder = createSupabaseRecorder();
      const deps = createDeps({
        findExistingTask: async (args) => {
          assert.equal(args.conversationId, "conv-shared");
          assert.equal(args.taskType, "commercial_quote_request");
          return args.commercialOpportunityId === "opp-a"
            ? ({
                id: "task-existing",
                task_type: "commercial_quote_request",
                status: "open",
              } as never)
            : null;
        },
      });

      const firstResult = await createCommercialAssistantHandoff(
        {
          supabase: recorder.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          conversationId: "conv-shared",
          leadId: "lead-1",
          handoff: createHandoff({
            commercialOpportunityId: "opp-a",
          }),
        },
        deps,
      );

      const secondResult = await createCommercialAssistantHandoff(
        {
          supabase: recorder.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          conversationId: "conv-shared",
          leadId: "lead-1",
          handoff: createHandoff({
            commercialOpportunityId: "opp-b",
          }),
        },
        deps,
      );

      assert.equal(firstResult.created, false);
      assert.equal(firstResult.reason, "similar_open_handoff_already_exists");
      assert.equal(secondResult.created, true);
      assert.equal(recorder.insertedRows.length, 1);
      assert.equal(recorder.insertedRows[0]?.commercial_opportunity_id, "opp-b");
    },
  },
  {
    name: "fails explicitly before insert when a commercial handoff lacks opportunity context",
    run: async () => {
      const recorder = createSupabaseRecorder();

      await assert.rejects(
        () =>
          createCommercialAssistantHandoff(
            {
              supabase: recorder.supabase,
              organizationId: "org-1",
              storeId: "store-1",
              conversationId: "conv-1",
              leadId: "lead-1",
              handoff: createHandoff({
                commercialOpportunityId: null,
              }),
            },
            createDeps(),
          ),
        /COMMERCIAL_HANDOFF_MISSING_OPPORTUNITY_CONTEXT/,
      );

      assert.equal(recorder.insertedRows.length, 0);
    },
  },
  {
    name: "real dedupe query applies exact scope filters and exact task_type before limit",
    run: async () => {
      const recorder = createSupabaseRecorder();

      const result = await findExistingCommercialHandoffTask({
        supabase: recorder.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        conversationId: "conv-1",
        taskType: "commercial_quote_request",
        commercialOpportunityId: "opp-a",
      });

      assert.equal(result?.id, "task-existing");
      assert.equal(recorder.selectStates.length, 1);

      const query = recorder.selectStates[0];
      assert.deepEqual(query.eq, [
        { column: "organization_id", value: "org-1" },
        { column: "store_id", value: "store-1" },
        { column: "related_conversation_id", value: "conv-1" },
        { column: "commercial_opportunity_id", value: "opp-a" },
        { column: "task_type", value: "commercial_quote_request" },
      ]);
      assert.deepEqual(query.in, [
        {
          column: "status",
          values: [
            "open",
            "waiting_user_choice",
            "waiting_customer_response",
            "ready_to_execute",
            "in_progress",
          ],
        },
      ]);
      assert.equal(query.limit, 1);
      assert.equal(query.operations.includes("in:task_type"), false);
      assert.equal(query.operations.includes("maybeSingle"), true);
      assert.equal(query.operations.indexOf("eq:task_type") > -1, true);
      assert.equal(
        query.operations.indexOf("eq:task_type") <
          query.operations.indexOf("limit:1"),
        true,
      );
    },
  },
  {
    name: "contract acceptance branch loads exactly the captured boundary anchor and uses its trigger fields",
    run: async () => {
      const recorder = createAcceptanceSupabase([
        createAcceptanceMessage({
          id: "msg-a1",
          content: "aceito a proposta A1",
          created_at: "2026-07-28T10:00:00.000Z",
        }),
        createAcceptanceMessage({
          id: "msg-a2",
          content: "mensagem mais recente que nao deve ser usada",
          created_at: "2026-07-28T10:05:00.000Z",
        }),
      ]);
      const detectInputs: string[] = [];
      const signCalls: Array<Record<string, unknown>> = [];
      const sentMessages: string[] = [];

      const result = await tryHandleCustomerContractAcceptance(
        {
          supabase: recorder.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          conversationId: "conv-1",
          leadId: "lead-1",
          anchorMessageId: "msg-a1",
        },
        {
          detectStrongCustomerContractAcceptance: (text) => {
            detectInputs.push(String(text || ""));
            return text === "aceito a proposta A1";
          },
          findEligibleSentContractForCustomerAcceptance: async () =>
            ({
              outcome: "single",
              scope: {
                organizationId: "org-1",
                storeId: "store-1",
                contractId: "contract-1",
              },
              contractId: "contract-1",
              contractNumber: "CTR-001",
              matchedBy: "conversation_id",
            }) as never,
          signSalesContractAsCustomer: async (payload) => {
            signCalls.push(payload as unknown as Record<string, unknown>);
            return {
              outcome: "signed",
              replayed: false,
              reconciled: false,
              signatureId: "signature-1",
              contractId: "contract-1",
              contractStatus: "customer_signed",
              versionStatus: "customer_signed",
              sideEffects: {
                businessEvent: "completed",
                documentReview: "completed",
              },
              acceptedAt: "2026-07-28T10:00:00.000Z",
            } as never;
          },
          buildCustomerContractAcceptanceConfirmationText: () =>
            "Contrato assinado com sucesso.",
          sendAiPanelMessage: async ({ aiText }) => {
            sentMessages.push(aiText);
            return "msg-out-1";
          },
          loadConversationMessageBoundaryState: createBoundaryLoader([
            {
              lastIncomingCustomerMessageId: "msg-a1",
              lastIncomingCustomerMessageAt: "2026-07-28T10:00:00.000Z",
              lastAiMessageId: null,
              lastAiMessageAt: null,
            },
            {
              lastIncomingCustomerMessageId: "msg-a1",
              lastIncomingCustomerMessageAt: "2026-07-28T10:00:00.000Z",
              lastAiMessageId: null,
              lastAiMessageAt: null,
            },
          ]),
        },
      );

      assert.equal(recorder.queryStates.length, 1);
      assert.deepEqual(recorder.queryStates[0]?.eq, [
        { column: "id", value: "msg-a1" },
        { column: "organization_id", value: "org-1" },
        { column: "store_id", value: "store-1" },
        { column: "conversation_id", value: "conv-1" },
        { column: "sender", value: "user" },
        { column: "direction", value: "incoming" },
      ]);
      assert.deepEqual(detectInputs, ["aceito a proposta A1"]);
      assert.equal(signCalls.length, 1);
      assert.equal(signCalls[0]?.expectedAnchorMessageId, "msg-a1");
      assert.equal(signCalls[0]?.acceptanceText, "aceito a proposta A1");
      assert.deepEqual(signCalls[0]?.metadata, {
        accepted_via: "conversation_text",
        channel: "conversation",
        conversation_id: "conv-1",
        lead_id: "lead-1",
        trigger_message_id: "msg-a1",
        trigger_message_content: "aceito a proposta A1",
        contract_number: "CTR-001",
        matched_by: "conversation_id",
      });
      assert.deepEqual(sentMessages, ["Contrato assinado com sucesso."]);
      assert.equal(result?.ok, true);
      if (result?.ok) {
        assert.equal(result.context?.acceptanceOutcome, "signed");
        assert.equal(result.context?.replayed, false);
        assert.equal(result.context?.reconciled, false);
        assert.equal(result.context?.signatureId, "signature-1");
        assert.equal(result.context?.contractStatus, "customer_signed");
        assert.equal(result.context?.versionStatus, "customer_signed");
        assert.equal(result.context?.triggerMessageId, "msg-a1");
        assert.equal(result.context?.triggerMessageContent, "aceito a proposta A1");
      }
    },
  },
  {
    name: "automatic conversation acceptance disables lead fallback when locating the contract",
    run: async () => {
      const recorder = createAcceptanceSupabase([createAcceptanceMessage()]);
      let signCalled = false;
      let sendCalled = false;

      const result = await tryHandleCustomerContractAcceptance(
        {
          supabase: recorder.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          conversationId: "conv-1",
          leadId: "lead-1",
          anchorMessageId: "msg-a1",
        },
        {
          detectStrongCustomerContractAcceptance: () => true,
          findEligibleSentContractForCustomerAcceptance: async (payload) => {
            assert.equal(payload.conversationId, "conv-1");
            assert.equal(payload.leadId, "lead-1");
            assert.equal(payload.anchorMessageId, "msg-a1");
            assert.equal(payload.allowLeadFallback, false);
            return {
              outcome: "none",
              candidateCount: 0,
              matchedBy: "conversation",
            } as never;
          },
          signSalesContractAsCustomer: async () => {
            signCalled = true;
            return {} as never;
          },
          sendAiPanelMessage: async () => {
            sendCalled = true;
            return "msg-out-1";
          },
        },
      );

      assert.equal(result, null);
      assert.equal(signCalled, false);
      assert.equal(sendCalled, false);
    },
  },
  {
    name: "newer customer message after A1 aborts contract signature before sign",
    run: async () => {
      const recorder = createAcceptanceSupabase([
        createAcceptanceMessage({
          id: "msg-a1",
          content: "aceito a proposta A1",
        }),
      ]);
      let signCalled = false;

      const result = await tryHandleCustomerContractAcceptance(
        {
          supabase: recorder.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          conversationId: "conv-1",
          leadId: "lead-1",
          anchorMessageId: "msg-a1",
        },
        {
          detectStrongCustomerContractAcceptance: () => true,
          findEligibleSentContractForCustomerAcceptance: async () =>
            ({
              outcome: "single",
              scope: {
                organizationId: "org-1",
                storeId: "store-1",
                contractId: "contract-1",
              },
              contractId: "contract-1",
              contractNumber: "CTR-001",
              matchedBy: "conversation_id",
            }) as never,
          signSalesContractAsCustomer: async () => {
            signCalled = true;
            return {
              outcome: "signed",
              replayed: false,
              reconciled: false,
              signatureId: "signature-1",
              contractId: "contract-1",
              contractStatus: "customer_signed",
              versionStatus: "customer_signed",
              acceptedAt: "2026-07-28T10:00:00.000Z",
            } as never;
          },
          buildCustomerContractAcceptanceConfirmationText: () => "nao deve enviar",
          sendAiPanelMessage: async () => "msg-out-1",
          loadConversationMessageBoundaryState: createBoundaryLoader([
            {
              lastIncomingCustomerMessageId: "msg-a2",
              lastIncomingCustomerMessageAt: "2026-07-28T10:05:00.000Z",
              lastAiMessageId: null,
              lastAiMessageAt: null,
            },
          ]),
        },
      );

      assert.deepEqual(result, {
        ok: false,
        error: "AI_REPLY_SUPERSEDED_BY_NEWER_CUSTOMER_MESSAGE",
        message:
          "Entrou mensagem mais nova do cliente durante a geracao. Ignorando esta resposta antiga.",
      });
      assert.equal(signCalled, false);
    },
  },
  {
    name: "newer customer message before acceptance confirmation aborts send after sign",
    run: async () => {
      const recorder = createAcceptanceSupabase([
        createAcceptanceMessage({
          id: "msg-a1",
          content: "aceito a proposta A1",
        }),
      ]);
      let signCalled = false;
      let sendCalled = false;

      const result = await tryHandleCustomerContractAcceptance(
        {
          supabase: recorder.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          conversationId: "conv-1",
          leadId: "lead-1",
          anchorMessageId: "msg-a1",
        },
        {
          detectStrongCustomerContractAcceptance: () => true,
          findEligibleSentContractForCustomerAcceptance: async () =>
            ({
              outcome: "single",
              scope: {
                organizationId: "org-1",
                storeId: "store-1",
                contractId: "contract-1",
              },
              contractId: "contract-1",
              contractNumber: "CTR-001",
              matchedBy: "conversation_id",
            }) as never,
          signSalesContractAsCustomer: async () => {
            signCalled = true;
            return {
              outcome: "signed",
              replayed: false,
              reconciled: false,
              signatureId: "signature-1",
              contractId: "contract-1",
              contractStatus: "customer_signed",
              versionStatus: "customer_signed",
              acceptedAt: "2026-07-28T10:00:00.000Z",
            } as never;
          },
          buildCustomerContractAcceptanceConfirmationText: () =>
            "Contrato assinado com sucesso.",
          sendAiPanelMessage: async () => {
            sendCalled = true;
            return "msg-out-1";
          },
          loadConversationMessageBoundaryState: createBoundaryLoader([
            {
              lastIncomingCustomerMessageId: "msg-a1",
              lastIncomingCustomerMessageAt: "2026-07-28T10:00:00.000Z",
              lastAiMessageId: null,
              lastAiMessageAt: null,
            },
            {
              lastIncomingCustomerMessageId: "msg-a2",
              lastIncomingCustomerMessageAt: "2026-07-28T10:05:00.000Z",
              lastAiMessageId: null,
              lastAiMessageAt: null,
            },
          ]),
        },
      );

      assert.equal(result?.ok, true);
      if (result?.ok) {
        assert.equal(result.persisted, true);
        assert.equal(result.messageId, null);
        assert.equal(result.aiText, "Contrato assinado com sucesso.");
        assert.deepEqual(result.context, {
          flow: "customer_contract_text_acceptance",
          partialSuccess: true,
          contractAccepted: true,
          confirmationPersisted: false,
          confirmationStatus: "suppressed",
          confirmationReason: "AI_REPLY_SUPERSEDED_BY_NEWER_CUSTOMER_MESSAGE",
          contractId: "contract-1",
          contractNumber: "CTR-001",
          matchedBy: "conversation_id",
          acceptanceOutcome: "signed",
          replayed: false,
          reconciled: false,
          signatureId: "signature-1",
          contractStatus: "customer_signed",
          versionStatus: "customer_signed",
          triggerMessageId: "msg-a1",
          triggerMessageContent: "aceito a proposta A1",
        });
      }
      assert.equal(signCalled, true);
      assert.equal(sendCalled, false);
    },
  },
  {
    name: "single contract send failure returns partial success with failed confirmation",
    run: async () => {
      const recorder = createAcceptanceSupabase([
        createAcceptanceMessage({
          id: "msg-a1",
          content: "aceito a proposta A1",
        }),
      ]);

      const result = await tryHandleCustomerContractAcceptance(
        {
          supabase: recorder.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          conversationId: "conv-1",
          leadId: "lead-1",
          anchorMessageId: "msg-a1",
        },
        {
          detectStrongCustomerContractAcceptance: () => true,
          findEligibleSentContractForCustomerAcceptance: async () =>
            ({
              outcome: "single",
              scope: {
                organizationId: "org-1",
                storeId: "store-1",
                contractId: "contract-1",
              },
              contractId: "contract-1",
              contractNumber: "CTR-001",
              matchedBy: "conversation_id",
            }) as never,
          signSalesContractAsCustomer: async () =>
            ({
              outcome: "signed",
              replayed: false,
              reconciled: false,
              signatureId: "signature-1",
              contractId: "contract-1",
              contractStatus: "customer_signed",
              versionStatus: "customer_signed",
              sideEffects: {
                businessEvent: "completed",
                documentReview: "completed",
              },
            }) as never,
          buildCustomerContractAcceptanceConfirmationText: () =>
            "Contrato assinado com sucesso.",
          sendAiPanelMessage: async () => {
            throw new Error("falha tecnica limpa");
          },
          loadConversationMessageBoundaryState: createBoundaryLoader([
            {
              lastIncomingCustomerMessageId: "msg-a1",
              lastIncomingCustomerMessageAt: "2026-07-28T10:00:00.000Z",
              lastAiMessageId: null,
              lastAiMessageAt: null,
            },
            {
              lastIncomingCustomerMessageId: "msg-a1",
              lastIncomingCustomerMessageAt: "2026-07-28T10:00:00.000Z",
              lastAiMessageId: null,
              lastAiMessageAt: null,
            },
          ]),
        },
      );

      assert.equal(result?.ok, true);
      if (result?.ok) {
        assert.equal(result.persisted, true);
        assert.equal(result.messageId, null);
        assert.equal(result.aiText, "Contrato assinado com sucesso.");
        assert.equal(result.context?.partialSuccess, true);
        assert.equal(result.context?.contractAccepted, true);
        assert.equal(result.context?.confirmationPersisted, false);
        assert.equal(result.context?.confirmationStatus, "failed");
        assert.equal(result.context?.confirmationReason, "PANEL_SEND_MESSAGE_FAILED");
        assert.equal(result.context?.confirmationErrorMessage, "falha tecnica limpa");
        assert.equal(result.context?.acceptanceOutcome, "signed");
        assert.equal(result.context?.triggerMessageId, "msg-a1");
        assert.equal(result.context?.triggerMessageContent, "aceito a proposta A1");
      }
    },
  },
  {
    name: "single contract null panel message id returns partial success with unconfirmed failure",
    run: async () => {
      const recorder = createAcceptanceSupabase([
        createAcceptanceMessage({
          id: "msg-a1",
          content: "aceito a proposta A1",
        }),
      ]);

      const result = await tryHandleCustomerContractAcceptance(
        {
          supabase: recorder.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          conversationId: "conv-1",
          leadId: "lead-1",
          anchorMessageId: "msg-a1",
        },
        {
          detectStrongCustomerContractAcceptance: () => true,
          findEligibleSentContractForCustomerAcceptance: async () =>
            ({
              outcome: "single",
              scope: {
                organizationId: "org-1",
                storeId: "store-1",
                contractId: "contract-1",
              },
              contractId: "contract-1",
              contractNumber: "CTR-001",
              matchedBy: "conversation_id",
            }) as never,
          signSalesContractAsCustomer: async () =>
            ({
              outcome: "signed",
              replayed: false,
              reconciled: false,
              signatureId: "signature-1",
              contractId: "contract-1",
              contractStatus: "customer_signed",
              versionStatus: "customer_signed",
            }) as never,
          buildCustomerContractAcceptanceConfirmationText: () =>
            "Contrato assinado com sucesso.",
          sendAiPanelMessage: async () => null,
          loadConversationMessageBoundaryState: createBoundaryLoader([
            {
              lastIncomingCustomerMessageId: "msg-a1",
              lastIncomingCustomerMessageAt: "2026-07-28T10:00:00.000Z",
              lastAiMessageId: null,
              lastAiMessageAt: null,
            },
            {
              lastIncomingCustomerMessageId: "msg-a1",
              lastIncomingCustomerMessageAt: "2026-07-28T10:00:00.000Z",
              lastAiMessageId: null,
              lastAiMessageAt: null,
            },
          ]),
        },
      );

      assert.equal(result?.ok, true);
      if (result?.ok) {
        assert.equal(result.persisted, true);
        assert.equal(result.messageId, null);
        assert.equal(result.context?.partialSuccess, true);
        assert.equal(result.context?.contractAccepted, true);
        assert.equal(result.context?.confirmationPersisted, false);
        assert.equal(result.context?.confirmationStatus, "failed");
        assert.equal(result.context?.confirmationReason, "PANEL_SEND_MESSAGE_FAILED");
        assert.equal(
          result.context?.confirmationErrorMessage,
          "PANEL_SEND_MESSAGE_NOT_CONFIRMED",
        );
      }
    },
  },
  {
    name: "single contract full success marks confirmation as sent",
    run: async () => {
      const recorder = createAcceptanceSupabase([
        createAcceptanceMessage({
          id: "msg-a1",
          content: "aceito a proposta A1",
        }),
      ]);

      const result = await tryHandleCustomerContractAcceptance(
        {
          supabase: recorder.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          conversationId: "conv-1",
          leadId: "lead-1",
          anchorMessageId: "msg-a1",
        },
        {
          detectStrongCustomerContractAcceptance: () => true,
          findEligibleSentContractForCustomerAcceptance: async () =>
            ({
              outcome: "single",
              scope: {
                organizationId: "org-1",
                storeId: "store-1",
                contractId: "contract-1",
              },
              contractId: "contract-1",
              contractNumber: "CTR-001",
              matchedBy: "conversation_id",
            }) as never,
          signSalesContractAsCustomer: async () =>
            ({
              outcome: "signed",
              replayed: false,
              reconciled: false,
              signatureId: "signature-1",
              contractId: "contract-1",
              contractStatus: "customer_signed",
              versionStatus: "customer_signed",
            }) as never,
          buildCustomerContractAcceptanceConfirmationText: () =>
            "Contrato assinado com sucesso.",
          sendAiPanelMessage: async () => "msg-out-1",
          loadConversationMessageBoundaryState: createBoundaryLoader([
            {
              lastIncomingCustomerMessageId: "msg-a1",
              lastIncomingCustomerMessageAt: "2026-07-28T10:00:00.000Z",
              lastAiMessageId: null,
              lastAiMessageAt: null,
            },
            {
              lastIncomingCustomerMessageId: "msg-a1",
              lastIncomingCustomerMessageAt: "2026-07-28T10:00:00.000Z",
              lastAiMessageId: null,
              lastAiMessageAt: null,
            },
          ]),
        },
      );

      assert.equal(result?.ok, true);
      if (result?.ok) {
        assert.equal(result.messageId, "msg-out-1");
        assert.equal(result.context?.partialSuccess, false);
        assert.equal(result.context?.contractAccepted, true);
        assert.equal(result.context?.confirmationPersisted, true);
        assert.equal(result.context?.confirmationStatus, "sent");
        assert.equal(result.context?.confirmationReason, null);
        assert.equal(result.context?.acceptanceOutcome, "signed");
      }
    },
  },
  {
    name: "retry with the same trigger resolves an already signed contract and calls the RPC again",
    run: async () => {
      const recorder = createAcceptanceSupabase([createAcceptanceMessage()]);
      const signCalls: Array<Record<string, unknown>> = [];

      const result = await tryHandleCustomerContractAcceptance(
        {
          supabase: recorder.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          conversationId: "conv-1",
          leadId: "lead-1",
          anchorMessageId: "msg-a1",
        },
        {
          detectStrongCustomerContractAcceptance: () => true,
          findEligibleSentContractForCustomerAcceptance: async (payload) => {
            assert.equal(payload.anchorMessageId, "msg-a1");
            return {
              outcome: "single",
              scope: {
                organizationId: "org-1",
                store: { id: "store-1" },
                contract: {
                  id: "contract-1",
                  current_version_id: "version-1",
                  conversation_id: "conv-1",
                  status: "customer_signed",
                },
                currentVersion: {
                  id: "version-1",
                  contract_id: "contract-1",
                  status: "customer_signed",
                },
                lead: null,
                conversation: { id: "conv-1" },
              },
              contractId: "contract-1",
              contractNumber: "CTR-001",
              matchedBy: "conversation",
            } as never;
          },
          signSalesContractAsCustomer: async (payload) => {
            signCalls.push(payload as Record<string, unknown>);
            return {
              outcome: "already_applied",
              replayed: true,
              reconciled: false,
              signatureId: "signature-1",
              contractId: "contract-1",
              contractStatus: "customer_signed",
              versionStatus: "customer_signed",
              sideEffects: {
                businessEvent: "skipped",
                documentReview: "skipped",
              },
            } as never;
          },
          buildCustomerContractAcceptanceConfirmationText: () =>
            "Contrato assinado com sucesso.",
          sendAiPanelMessage: async () => "msg-out-1",
          loadConversationMessageBoundaryState: createBoundaryLoader([
            {
              lastIncomingCustomerMessageId: "msg-a1",
              lastIncomingCustomerMessageAt: "2026-07-28T10:00:00.000Z",
              lastAiMessageId: null,
              lastAiMessageAt: null,
            },
            {
              lastIncomingCustomerMessageId: "msg-a1",
              lastIncomingCustomerMessageAt: "2026-07-28T10:00:00.000Z",
              lastAiMessageId: null,
              lastAiMessageAt: null,
            },
          ]),
        },
      );

      assert.equal(signCalls.length, 1);
      assert.equal(signCalls[0]?.expectedAnchorMessageId, "msg-a1");
      assert.equal(result?.ok, true);
      if (result?.ok) {
        assert.equal(result.context?.acceptanceOutcome, "already_applied");
        assert.equal(result.context?.replayed, true);
        assert.equal(result.context?.reconciled, false);
      }
    },
  },
  {
    name: "reconciled partial state is propagated in the final context",
    run: async () => {
      const recorder = createAcceptanceSupabase([createAcceptanceMessage()]);

      const result = await tryHandleCustomerContractAcceptance(
        {
          supabase: recorder.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          conversationId: "conv-1",
          leadId: "lead-1",
          anchorMessageId: "msg-a1",
        },
        {
          detectStrongCustomerContractAcceptance: () => true,
          findEligibleSentContractForCustomerAcceptance: async () =>
            ({
              outcome: "single",
              scope: {
                organizationId: "org-1",
                storeId: "store-1",
                contractId: "contract-1",
              },
              contractId: "contract-1",
              contractNumber: "CTR-001",
              matchedBy: "conversation_id",
            }) as never,
          signSalesContractAsCustomer: async () =>
            ({
              outcome: "reconciled_partial_state",
              replayed: false,
              reconciled: true,
              signatureId: "signature-1",
              contractId: "contract-1",
              contractStatus: "customer_signed",
              versionStatus: "customer_signed",
              sideEffects: {
                businessEvent: "skipped",
                documentReview: "skipped",
              },
            }) as never,
          buildCustomerContractAcceptanceConfirmationText: () =>
            "Contrato assinado com sucesso.",
          sendAiPanelMessage: async () => "msg-out-1",
          loadConversationMessageBoundaryState: createBoundaryLoader([
            {
              lastIncomingCustomerMessageId: "msg-a1",
              lastIncomingCustomerMessageAt: "2026-07-28T10:00:00.000Z",
              lastAiMessageId: null,
              lastAiMessageAt: null,
            },
            {
              lastIncomingCustomerMessageId: "msg-a1",
              lastIncomingCustomerMessageAt: "2026-07-28T10:00:00.000Z",
              lastAiMessageId: null,
              lastAiMessageAt: null,
            },
          ]),
        },
      );

      assert.equal(result?.ok, true);
      if (result?.ok) {
        assert.equal(result.context?.acceptanceOutcome, "reconciled_partial_state");
        assert.equal(result.context?.replayed, false);
        assert.equal(result.context?.reconciled, true);
      }
    },
  },
  {
    name: "real signature failure does not send customer confirmation",
    run: async () => {
      const recorder = createAcceptanceSupabase([createAcceptanceMessage()]);
      let sendCalled = false;

      await assert.rejects(
        () =>
          tryHandleCustomerContractAcceptance(
            {
              supabase: recorder.supabase,
              organizationId: "org-1",
              storeId: "store-1",
              conversationId: "conv-1",
              leadId: "lead-1",
              anchorMessageId: "msg-a1",
            },
            {
              detectStrongCustomerContractAcceptance: () => true,
              findEligibleSentContractForCustomerAcceptance: async () =>
                ({
                  outcome: "single",
                  scope: {
                    organizationId: "org-1",
                    storeId: "store-1",
                    contractId: "contract-1",
                  },
                  contractId: "contract-1",
                  contractNumber: "CTR-001",
                  matchedBy: "conversation_id",
                }) as never,
              signSalesContractAsCustomer: async () => {
                throw new Error("signature failed");
              },
              sendAiPanelMessage: async () => {
                sendCalled = true;
                return "msg-out-1";
              },
              loadConversationMessageBoundaryState: createBoundaryLoader([
                {
                  lastIncomingCustomerMessageId: "msg-a1",
                  lastIncomingCustomerMessageAt: "2026-07-28T10:00:00.000Z",
                  lastAiMessageId: null,
                  lastAiMessageAt: null,
                },
              ]),
            },
          ),
        /signature failed/,
      );

      assert.equal(sendCalled, false);
    },
  },
  {
    name: "multiple contracts with newer customer message still returns superseded without send",
    run: async () => {
      const recorder = createAcceptanceSupabase([
        createAcceptanceMessage({
          id: "msg-a1",
          content: "aceito a proposta A1",
        }),
      ]);
      let sendCalled = false;

      const result = await tryHandleCustomerContractAcceptance(
        {
          supabase: recorder.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          conversationId: "conv-1",
          leadId: "lead-1",
          anchorMessageId: "msg-a1",
        },
        {
          detectStrongCustomerContractAcceptance: () => true,
          findEligibleSentContractForCustomerAcceptance: async () =>
            ({
              outcome: "multiple",
              candidateCount: 2,
              matchedBy: "conversation_id",
              candidates: [
                { contractId: "contract-1", contractNumber: "CTR-001" },
                { contractId: "contract-2", contractNumber: "CTR-002" },
              ],
            }) as never,
          sendAiPanelMessage: async () => {
            sendCalled = true;
            return "msg-out-1";
          },
          loadConversationMessageBoundaryState: createBoundaryLoader([
            {
              lastIncomingCustomerMessageId: "msg-a2",
              lastIncomingCustomerMessageAt: "2026-07-28T10:05:00.000Z",
              lastAiMessageId: null,
              lastAiMessageAt: null,
            },
          ]),
        },
      );

      assert.deepEqual(result, {
        ok: false,
        error: "AI_REPLY_SUPERSEDED_BY_NEWER_CUSTOMER_MESSAGE",
        message:
          "Entrou mensagem mais nova do cliente durante a geracao. Ignorando esta resposta antiga.",
        aiText:
          "Recebi seu aceite. Como encontrei mais de um contrato enviado em aberto para voce, preciso que a loja confirme qual deles seguir antes de registrar formalmente.",
      });
      assert.equal(sendCalled, false);
    },
  },
  {
    name: "multiple contracts send failure returns exact panel send error",
    run: async () => {
      const recorder = createAcceptanceSupabase([
        createAcceptanceMessage({
          id: "msg-a1",
          content: "aceito a proposta A1",
        }),
      ]);

      const result = await tryHandleCustomerContractAcceptance(
        {
          supabase: recorder.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          conversationId: "conv-1",
          leadId: "lead-1",
          anchorMessageId: "msg-a1",
        },
        {
          detectStrongCustomerContractAcceptance: () => true,
          findEligibleSentContractForCustomerAcceptance: async () =>
            ({
              outcome: "multiple",
              candidateCount: 2,
              matchedBy: "conversation_id",
              candidates: [
                { contractId: "contract-1", contractNumber: "CTR-001" },
                { contractId: "contract-2", contractNumber: "CTR-002" },
              ],
            }) as never,
          sendAiPanelMessage: async () => {
            throw new Error("falha no painel");
          },
          loadConversationMessageBoundaryState: createBoundaryLoader([
            {
              lastIncomingCustomerMessageId: "msg-a1",
              lastIncomingCustomerMessageAt: "2026-07-28T10:00:00.000Z",
              lastAiMessageId: null,
              lastAiMessageAt: null,
            },
          ]),
        },
      );

      assert.deepEqual(result, {
        ok: false,
        error: "PANEL_SEND_MESSAGE_FAILED",
        message: "falha no painel",
        aiText:
          "Recebi seu aceite. Como encontrei mais de um contrato enviado em aberto para voce, preciso que a loja confirme qual deles seguir antes de registrar formalmente.",
      });
    },
  },
  {
    name: "multiple contracts null panel message id returns not confirmed error and preserves ai text",
    run: async () => {
      const recorder = createAcceptanceSupabase([
        createAcceptanceMessage({
          id: "msg-a1",
          content: "aceito a proposta A1",
        }),
      ]);

      const result = await tryHandleCustomerContractAcceptance(
        {
          supabase: recorder.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          conversationId: "conv-1",
          leadId: "lead-1",
          anchorMessageId: "msg-a1",
        },
        {
          detectStrongCustomerContractAcceptance: () => true,
          findEligibleSentContractForCustomerAcceptance: async () =>
            ({
              outcome: "multiple",
              candidateCount: 2,
              matchedBy: "conversation_id",
              candidates: [
                { contractId: "contract-1", contractNumber: "CTR-001" },
                { contractId: "contract-2", contractNumber: "CTR-002" },
              ],
            }) as never,
          sendAiPanelMessage: async () => null,
          loadConversationMessageBoundaryState: createBoundaryLoader([
            {
              lastIncomingCustomerMessageId: "msg-a1",
              lastIncomingCustomerMessageAt: "2026-07-28T10:00:00.000Z",
              lastAiMessageId: null,
              lastAiMessageAt: null,
            },
          ]),
        },
      );

      assert.deepEqual(result, {
        ok: false,
        error: "PANEL_SEND_MESSAGE_FAILED",
        message: "PANEL_SEND_MESSAGE_NOT_CONFIRMED",
        aiText:
          "Recebi seu aceite. Como encontrei mais de um contrato enviado em aberto para voce, preciso que a loja confirme qual deles seguir antes de registrar formalmente.",
      });
    },
  },
  {
    name: "coherent params persist canonical conversation_ai_window_state ids",
    run: async () => {
      const supabase = createAiWindowScopeSupabase();
      await withMockedSupabaseEnv(async () => {
        const result = await generateAndSaveAiSalesReply(
          {
            organizationId: "org-canonical",
            storeId: "store-canonical",
            conversationId: "conv-canonical",
          },
          {
            createSupabaseClient: () => supabase.client as never,
            ...createScopeAwareReplyDeps(),
          },
        );

        assert.equal(result.ok, true);
        assert.equal(supabase.windowUpserts.length, 1);
        assert.equal(supabase.windowUpserts[0]?.row.conversation_id, "conv-canonical");
        assert.equal(supabase.windowUpserts[0]?.row.organization_id, "org-canonical");
        assert.equal(supabase.windowUpserts[0]?.row.store_id, "store-canonical");
        assert.deepEqual(supabase.windowUpserts[0]?.options, {
          onConflict: "conversation_id",
        });
        assert.deepEqual(supabase.conversationSelects, [
          "id, organization_id, lead_id, is_human_active, leads!inner(organization_id, store_id)",
        ]);
        assert.deepEqual(supabase.conversationFilters, [
          { column: "id", value: "conv-canonical" },
        ]);
        assert.deepEqual(supabase.storeSelects, ["id, organization_id"]);
        assert.deepEqual(supabase.storeFilters, [
          { column: "id", value: "store-canonical" },
        ]);
      });
    },
  },
  {
    name: "closed store with canonical AI after-hours disabled blocks generation without losing inbound boundary",
    run: async () => {
      const supabase = createAiWindowScopeSupabase();
      let generationCalls = 0;
      let sendCalls = 0;
      let boundaryCalls = 0;

      await withMockedSupabaseEnv(async () => {
        const result = await generateAndSaveAiSalesReply(
          {
            organizationId: "org-canonical",
            storeId: "store-canonical",
            conversationId: "conv-canonical",
          },
          {
            createSupabaseClient: () => supabase.client as never,
            ...createScopeAwareReplyDeps({
              loadConversationMessageBoundaryState: async () => {
                boundaryCalls += 1;
                return {
                  lastIncomingCustomerMessageId: "msg-closed-1",
                  lastIncomingCustomerMessageAt: "2026-09-04T00:00:00.000Z",
                  lastAiMessageId: null,
                  lastAiMessageAt: null,
                };
              },
              loadSalesAiOperatingWindowAuthority: async () =>
                ({
                  decision: "AI_NOT_ALLOWED_NOW",
                  humanAvailableNow: false,
                  aiAllowedNow: false,
                  humanUnavailableReason: "outside_human_operating_hours",
                  timezoneName: "America/Sao_Paulo",
                  localNow: "2026-09-03 21:00",
                  isHolidayBlocked: false,
                  holidayBlockTitle: null,
                  nextHumanOpenPeriod: {
                    startIso: "2026-09-04T11:00:00.000Z",
                    endIso: "2026-09-04T21:00:00.000Z",
                    localDate: "2026-09-04",
                    dayKey: "sexta",
                    startTime: "08:00",
                    endTime: "18:00",
                    label: "sexta-feira 2026-09-04 as 08:00",
                  },
                  nextAiAllowedPeriod: {
                    startIso: "2026-09-04T11:00:00.000Z",
                    endIso: "2026-09-04T21:00:00.000Z",
                    localDate: "2026-09-04",
                    dayKey: "sexta",
                    startTime: "08:00",
                    endTime: "18:00",
                    label: "sexta-feira 2026-09-04 as 08:00",
                  },
                  policy: {
                    aiAfterHoursEnabled: false,
                    aiAfterHoursMode: null,
                    aiAfterHoursStart: null,
                    aiAfterHoursEnd: null,
                    aiAttendsHolidays: false,
                  },
                }) as never,
              generateAiSalesReply: async () => {
                generationCalls += 1;
                return ({ ok: false, error: "UNUSED", message: "UNUSED" }) as never;
              },
              sendAiPanelMessage: async () => {
                sendCalls += 1;
                return "msg-ai-1";
              },
            }),
          },
        );

        assert.equal(result.ok, false);
        assert.equal(result.error, "SALES_AI_NOT_ALLOWED_NOW");
        assert.equal(boundaryCalls, 1);
        assert.equal(generationCalls, 0);
        assert.equal(sendCalls, 0);
        assert.equal(supabase.windowUpserts.length, 1);
        assert.equal(
          supabase.windowUpserts[0]?.row.next_resume_at,
          "2026-09-04T11:00:00.000Z",
        );
        assert.equal(
          supabase.windowUpserts[0]?.row.resume_reason,
          "sales_ai_after_hours_policy",
        );
        assert.equal(supabase.queueUpserts.length, 1);
        assert.equal(
          supabase.queueUpserts[0]?.row.queue_key,
          "resume:conv-canonical:sales_ai_after_hours:202609040800",
        );
        assert.deepEqual(supabase.queueUpserts[0]?.options, {
          onConflict: "queue_key",
        });
        assert.equal(supabase.queueUpdates.length, 0);
      });
    },
  },
  {
    name: "allowed after-hours context is passed into sales generation before sending",
    run: async () => {
      const supabase = createAiWindowScopeSupabase();
      let receivedDecision: string | null = null;

      await withMockedSupabaseEnv(async () => {
        const result = await generateAndSaveAiSalesReply(
          {
            organizationId: "org-canonical",
            storeId: "store-canonical",
            conversationId: "conv-canonical",
          },
          {
            createSupabaseClient: () => supabase.client as never,
            ...createScopeAwareReplyDeps({
              loadSalesAiOperatingWindowAuthority: async () =>
                ({
                  decision: "AI_ALLOWED_AFTER_HOURS",
                  humanAvailableNow: false,
                  aiAllowedNow: true,
                  humanUnavailableReason: "outside_human_operating_hours",
                  timezoneName: "America/Sao_Paulo",
                  localNow: "2026-09-03 21:00",
                  isHolidayBlocked: false,
                  holidayBlockTitle: null,
                  nextHumanOpenPeriod: {
                    startIso: "2026-09-04T11:00:00.000Z",
                    endIso: "2026-09-04T21:00:00.000Z",
                    localDate: "2026-09-04",
                    dayKey: "sexta",
                    startTime: "08:00",
                    endTime: "18:00",
                    label: "sexta-feira 2026-09-04 as 08:00",
                  },
                  nextAiAllowedPeriod: {
                    startIso: "2026-09-03T21:00:00.000Z",
                    endIso: "2026-09-04T03:00:00.000Z",
                    localDate: "2026-09-03",
                    dayKey: "quinta",
                    startTime: "18:00",
                    endTime: "00:00",
                    label: "quinta-feira 2026-09-03 as 18:00",
                  },
                  policy: {
                    aiAfterHoursEnabled: true,
                    aiAfterHoursMode: "all_closed_hours",
                    aiAfterHoursStart: null,
                    aiAfterHoursEnd: null,
                    aiAttendsHolidays: false,
                  },
                }) as never,
              generateAiSalesReply: async (args: any) => {
                receivedDecision =
                  args.salesAiOperatingWindowContext?.decision || null;
                return {
                  ok: true,
                  aiText: "Resposta after-hours segura",
                  anchorMessageId: "msg-1",
                  usage: null,
                  context: {
                    operationalFollowUpDecision: {
                      kind: "none",
                      reason: "none",
                    },
                  },
                } as never;
              },
            }),
          },
        );

        assert.equal(result.ok, true);
        assert.equal(receivedDecision, "AI_ALLOWED_AFTER_HOURS");
      });
    },
  },
  {
    name: "divergent external organization fails before any window upsert",
    run: async () => {
      const supabase = createAiWindowScopeSupabase();
      let generationCalls = 0;
      let sendCalls = 0;

      await withMockedSupabaseEnv(async () => {
        const result = await generateAndSaveAiSalesReply(
          {
            organizationId: "org-other",
            storeId: "store-canonical",
            conversationId: "conv-canonical",
          },
          {
            createSupabaseClient: () => supabase.client as never,
            ...createScopeAwareReplyDeps({
              generateAiSalesReply: async () => {
                generationCalls += 1;
                return ({ ok: false, error: "UNUSED", message: "UNUSED" }) as never;
              },
              sendAiPanelMessage: async () => {
                sendCalls += 1;
                return "msg-ai-1";
              },
            }),
          },
        );

        assert.deepEqual(result, {
          ok: false,
          error: "CONVERSATION_SCOPE_MISMATCH",
          message:
            "A conversa não corresponde ao escopo informado para persistir a janela da IA.",
        });
        assert.equal(generationCalls, 0);
        assert.equal(sendCalls, 0);
        assert.equal(supabase.windowUpserts.length, 0);
        assert.equal(supabase.queueUpdates.length, 0);
      });
    },
  },
  {
    name: "divergent external store fails before any window upsert",
    run: async () => {
      const supabase = createAiWindowScopeSupabase();

      await withMockedSupabaseEnv(async () => {
        const result = await generateAndSaveAiSalesReply(
          {
            organizationId: "org-canonical",
            storeId: "store-other",
            conversationId: "conv-canonical",
          },
          {
            createSupabaseClient: () => supabase.client as never,
            ...createScopeAwareReplyDeps(),
          },
        );

        assert.deepEqual(result, {
          ok: false,
          error: "CONVERSATION_SCOPE_MISMATCH",
          message:
            "A conversa não corresponde ao escopo informado para persistir a janela da IA.",
        });
        assert.equal(supabase.windowUpserts.length, 0);
      });
    },
  },
  {
    name: "store belonging to another organization fails closed before any window upsert",
    run: async () => {
      const supabase = createAiWindowScopeSupabase({
        storeOrganizationId: "org-other",
      });

      await withMockedSupabaseEnv(async () => {
        const result = await generateAndSaveAiSalesReply(
          {
            organizationId: "org-canonical",
            storeId: "store-canonical",
            conversationId: "conv-canonical",
          },
          {
            createSupabaseClient: () => supabase.client as never,
            ...createScopeAwareReplyDeps(),
          },
        );

        assert.deepEqual(result, {
          ok: false,
          error: "CONVERSATION_SCOPE_MISMATCH",
          message:
            "A conversa não corresponde ao escopo informado para persistir a janela da IA.",
        });
        assert.equal(supabase.windowUpserts.length, 0);
      });
    },
  },
  {
    name: "technical conversations query error does not become scope mismatch",
    run: async () => {
      const supabase = createAiWindowScopeSupabase({
        conversationError: {
          message: "relation conversations failed",
        },
      });

      await withMockedSupabaseEnv(async () => {
        const result = await generateAndSaveAiSalesReply(
          {
            organizationId: "org-canonical",
            storeId: "store-canonical",
            conversationId: "conv-canonical",
          },
          {
            createSupabaseClient: () => supabase.client as never,
            ...createScopeAwareReplyDeps(),
          },
        );

        assert.deepEqual(result, {
          ok: false,
          error: "GENERATE_AND_SAVE_AI_SALES_REPLY_FAILED",
          message:
            "Falha ao resolver escopo canonico da janela da IA: relation conversations failed",
        });
      });
    },
  },
  {
    name: "technical stores query error does not become scope mismatch",
    run: async () => {
      const supabase = createAiWindowScopeSupabase({
        storeError: {
          message: "relation stores failed",
        },
      });

      await withMockedSupabaseEnv(async () => {
        const result = await generateAndSaveAiSalesReply(
          {
            organizationId: "org-canonical",
            storeId: "store-canonical",
            conversationId: "conv-canonical",
          },
          {
            createSupabaseClient: () => supabase.client as never,
            ...createScopeAwareReplyDeps(),
          },
        );

        assert.deepEqual(result, {
          ok: false,
          error: "GENERATE_AND_SAVE_AI_SALES_REPLY_FAILED",
          message:
            "Falha ao validar loja canonica da janela da IA: relation stores failed",
        });
      });
    },
  },
  {
    name: "lead organization mismatch fails closed",
    run: async () => {
      const supabase = createAiWindowScopeSupabase({
        leadOrganizationId: "org-other",
      });
      let generationCalls = 0;
      let sendCalls = 0;
      let handoffCalls = 0;

      await withMockedSupabaseEnv(async () => {
        const result = await generateAndSaveAiSalesReply(
          {
            organizationId: "org-canonical",
            storeId: "store-canonical",
            conversationId: "conv-canonical",
          },
          {
            createSupabaseClient: () => supabase.client as never,
            ...createScopeAwareReplyDeps({
              generateAiSalesReply: async () => {
                generationCalls += 1;
                return ({ ok: false, error: "UNUSED", message: "UNUSED" }) as never;
              },
              sendAiPanelMessage: async () => {
                sendCalls += 1;
                return "msg-ai-1";
              },
              createCommercialAssistantHandoff: async () => {
                handoffCalls += 1;
                return ({
                  created: false,
                  skipped: true,
                  reason: "handoff_not_requested",
                }) as never;
              },
            }),
          },
        );

        assert.deepEqual(result, {
          ok: false,
          error: "CONVERSATION_SCOPE_MISMATCH",
          message:
            "A conversa não corresponde ao escopo informado para persistir a janela da IA.",
        });
        assert.equal(generationCalls, 0);
        assert.equal(sendCalls, 0);
        assert.equal(handoffCalls, 0);
        assert.equal(supabase.windowUpserts.length, 0);
        assert.equal(supabase.queueUpdates.length, 0);
      });
    },
  },
  {
    name: "lead without store_id fails closed",
    run: async () => {
      const supabase = createAiWindowScopeSupabase({
        canonicalStoreId: "",
      });
      let generationCalls = 0;
      let sendCalls = 0;
      let usageCalls = 0;

      await withMockedSupabaseEnv(async () => {
        const result = await generateAndSaveAiSalesReply(
          {
            organizationId: "org-canonical",
            storeId: "store-canonical",
            conversationId: "conv-canonical",
          },
          {
            createSupabaseClient: () => supabase.client as never,
            ...createScopeAwareReplyDeps({
              generateAiSalesReply: async () => {
                generationCalls += 1;
                return ({ ok: false, error: "UNUSED", message: "UNUSED" }) as never;
              },
              sendAiPanelMessage: async () => {
                sendCalls += 1;
                return "msg-ai-1";
              },
              updateLatestRunningAiRunUsage: async () => {
                usageCalls += 1;
              },
            }),
          },
        );

        assert.deepEqual(result, {
          ok: false,
          error: "CONVERSATION_SCOPE_MISMATCH",
          message:
            "A conversa não corresponde ao escopo informado para persistir a janela da IA.",
        });
        assert.equal(generationCalls, 0);
        assert.equal(sendCalls, 0);
        assert.equal(usageCalls, 0);
        assert.equal(supabase.windowUpserts.length, 0);
        assert.equal(supabase.queueUpdates.length, 0);
      });
    },
  },
  {
    name: "stop_contact uses canonical conversation organization and store filters",
    run: async () => {
      const supabase = createAiWindowScopeSupabase();

      await withMockedSupabaseEnv(async () => {
        const result = await generateAndSaveAiSalesReply(
          {
            organizationId: "org-canonical",
            storeId: "store-canonical",
            conversationId: "conv-canonical",
          },
          {
            createSupabaseClient: () => supabase.client as never,
            ...createScopeAwareReplyDeps({
              generateAiSalesReply: async () =>
                ({
                  ok: true,
                  aiText: "Resposta comercial",
                  anchorMessageId: "msg-1",
                  usage: null,
                  context: {
                    operationalFollowUpDecision: {
                      kind: "stop_contact",
                      reason: "customer_requested_stop_contact",
                    },
                  },
                }) as never,
            }),
          },
        );

        assert.equal(result.ok, true);
        assert.equal(supabase.stateUpdates.length, 1);
        assert.deepEqual(supabase.stateUpdates[0]?.eq, [
          { column: "conversation_id", value: "conv-canonical" },
          { column: "organization_id", value: "org-canonical" },
          { column: "store_id", value: "store-canonical" },
        ]);
        assert.equal(supabase.queueUpdates.length, 2);
        assert.deepEqual(supabase.queueUpdates[0]?.eq, [
          { column: "organization_id", value: "org-canonical" },
          { column: "store_id", value: "store-canonical" },
          { column: "conversation_id", value: "conv-canonical" },
        ]);
        assert.deepEqual(supabase.queueUpdates[1]?.eq, [
          { column: "organization_id", value: "org-canonical" },
          { column: "store_id", value: "store-canonical" },
          { column: "conversation_id", value: "conv-canonical" },
        ]);
      });
    },
  },  {
    name: "source passes the explicit expected anchor into signSalesContractAsCustomer",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/generate-and-save-ai-sales-reply.ts"),
        "utf8",
      );

      const signCallIndex = source.indexOf("await resolvedDeps.signSalesContractAsCustomer({");
      const anchorParamIndex = source.indexOf(
        "expectedAnchorMessageId: anchoredCustomerMessage.id,",
        signCallIndex,
      );

      assert.equal(signCallIndex > -1, true);
      assert.equal(anchorParamIndex > signCallIndex, true);
    },
  },
  {
    name: "source disables lead fallback when resolving automatic contract acceptance",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/generate-and-save-ai-sales-reply.ts"),
        "utf8",
      );

      const finderCallIndex = source.indexOf(
        "await resolvedDeps.findEligibleSentContractForCustomerAcceptance({"
      );
      const leadFallbackIndex = source.indexOf(
        "allowLeadFallback: false,",
        finderCallIndex,
      );
      const anchorParamIndex = source.indexOf(
        "anchorMessageId: anchoredCustomerMessage.id,",
        finderCallIndex,
      );

      assert.equal(finderCallIndex > -1, true);
      assert.equal(anchorParamIndex > finderCallIndex, true);
      assert.equal(leadFallbackIndex > finderCallIndex, true);
    },
  },
  {
    name: "source passes the captured boundary anchor into generateAiSalesReply",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/generate-and-save-ai-sales-reply.ts"),
        "utf8",
      );

      const generationCallIndex = source.indexOf("const generationResult = await resolvedDeps.generateAiSalesReply({");
      const anchorParamIndex = source.indexOf(
        "anchorMessageId: boundaryBeforeGeneration.lastIncomingCustomerMessageId,",
        generationCallIndex
      );

      assert.equal(generationCallIndex > -1, true);
      assert.equal(anchorParamIndex > generationCallIndex, true);
    },
  },
  {
    name: "source aborts before send when generation anchor diverges from the captured boundary",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/generate-and-save-ai-sales-reply.ts"),
        "utf8",
      );

      const generationAnchorIndex = source.indexOf(
        "const generationAnchorMessageId = String(generationResult.anchorMessageId || \"\").trim();"
      );
      const mismatchErrorIndex = source.indexOf(
        'error: AI_REPLY_GENERATION_ANCHOR_MISMATCH,',
        generationAnchorIndex
      );
      const sendIndex = source.indexOf(
        "messageId = await resolvedDeps.sendAiPanelMessage({",
        mismatchErrorIndex
      );
      const handoffIndex = source.indexOf(
        "commercialHandoffResult = await resolvedDeps.createCommercialAssistantHandoff({",
        mismatchErrorIndex
      );

      assert.equal(generationAnchorIndex > -1, true);
      assert.equal(mismatchErrorIndex > generationAnchorIndex, true);
      assert.equal(sendIndex > mismatchErrorIndex, true);
      assert.equal(handoffIndex > mismatchErrorIndex, true);
      assert.equal(source.includes('const AI_REPLY_GENERATION_ANCHOR_MISMATCH ='), true);
    },
  },
  {
    name: "source validates requested handoff opportunity before normal sendAiPanelMessage",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/generate-and-save-ai-sales-reply.ts"),
        "utf8",
      );

      const handoffIndex = source.indexOf(
        "const requestedCommercialHandoff = generationResult.context?.commercialHandoff || null;"
      );
      const validationIndex = source.indexOf(
        "getRequiredCommercialOpportunityIdFromHandoff(",
        handoffIndex
      );
      const skipIndex = source.indexOf(
        'reason: "missing_commercial_opportunity_context"',
        validationIndex
      );
      const sendIndex = source.indexOf(
        "messageId = await resolvedDeps.sendAiPanelMessage({",
        skipIndex
      );

      assert.equal(handoffIndex > -1, true);
      assert.equal(validationIndex > handoffIndex, true);
      assert.equal(skipIndex > validationIndex, true);
      assert.equal(sendIndex > skipIndex, true);
    },
  },
  {
    name: "handoff without explicit opportunity binding does not abort the main reply flow",
    run: async () => {
      const sentMessages: string[] = [];
      let receivedHandoff: unknown = "unset";

      await withMockedSupabaseEnv(async () => {
        const result = await generateAndSaveAiSalesReply(
          {
            organizationId: "org-canonical",
            storeId: "store-canonical",
            conversationId: "conv-canonical",
          },
          {
            createSupabaseClient: () => createAiWindowScopeSupabase().client as never,
            ...createScopeAwareReplyDeps({
              generateAiSalesReply: async () =>
                ({
                  ok: true,
                  aiText: "Resposta comercial",
                  anchorMessageId: "msg-1",
                  usage: null,
                  context: {
                    lastCustomerMessage: "Quero um orcamento",
                    leadName: "Cliente",
                    operationalFollowUpDecision: {
                      kind: "none",
                      reason: "none",
                    },
                    commercialHandoff: createHandoff({
                      commercialOpportunityId: null,
                    }),
                    responseAnchorCommercialContext: {
                      messageId: "msg-1",
                      captureState: "captured",
                      historicalContextStatus: "captured",
                      conversationSessionId: "session-1",
                      commercialSessionContextLinkId: "link-1",
                      customerId: "customer-1",
                      commercialOpportunityId: null,
                      leadCustomerLinkId: "lead-link-1",
                    },
                  },
                }) as never,
              sendAiPanelMessage: async (args: { aiText: string }) => {
                sentMessages.push(args.aiText);
                return "msg-ai-1";
              },
              createCommercialAssistantHandoff: async (args: { handoff: unknown }) => {
                receivedHandoff = args.handoff;
                return ({
                  created: false,
                  skipped: true,
                  reason: "handoff_not_requested",
                }) as never;
              },
            }),
          },
        );

        assert.equal(result.ok, true);
        assert.deepEqual(sentMessages, ["Resposta comercial"]);
        assert.equal(receivedHandoff, null);
      });
    },
  },
  {
    name: "commercial handoff uses resolved B instead of arrival A after CMIR",
    run: async () => {
      const sentMessages: string[] = [];
      let receivedHandoff: CommercialHandoffContext | null = null;

      await withMockedSupabaseEnv(async () => {
        const result = await generateAndSaveAiSalesReply(
          {
            organizationId: "org-canonical",
            storeId: "store-canonical",
            conversationId: "conv-canonical",
          },
          {
            createSupabaseClient: () =>
              createAiWindowScopeSupabase().client as never,
            ...createScopeAwareReplyDeps({
              generateAiSalesReply: async () =>
                ({
                  ok: true,
                  aiText: "Resposta comercial",
                  anchorMessageId: "msg-1",
                  usage: null,
                  context: {
                    lastCustomerMessage:
                      "Pode me colocar em contato com o responsavel?",
                    leadName: "Cliente",
                    operationalFollowUpDecision: {
                      kind: "none",
                      reason: "none",
                    },
                    resolvedCommercialOpportunityId: "opp-resolved-b",
                    commercialHandoff: createHandoff({
                      commercialOpportunityId: "opp-resolved-b",
                    }),
                    responseAnchorCommercialContext: {
                      messageId: "msg-1",
                      captureState: "captured",
                      historicalContextStatus: "captured",
                      conversationSessionId: "session-1",
                      commercialSessionContextLinkId: "link-1",
                      customerId: "customer-1",
                      commercialOpportunityId: "opp-arrival-a",
                      leadCustomerLinkId: "lead-link-1",
                    },
                  },
                }) as never,
              sendAiPanelMessage: async (args: { aiText: string }) => {
                sentMessages.push(args.aiText);
                return "msg-ai-1";
              },
              createCommercialAssistantHandoff: async (args: {
                handoff: CommercialHandoffContext;
              }) => {
                receivedHandoff = args.handoff;
                return ({
                  created: false,
                  skipped: true,
                  reason: "handoff_not_requested",
                }) as never;
              },
            }),
          },
        );

        assert.equal(result.ok, true);
        assert.deepEqual(sentMessages, ["Resposta comercial"]);
        assert.equal(
          receivedHandoff?.commercialOpportunityId,
          "opp-resolved-b",
        );
        assert.equal(result.ok, true);
assert.deepEqual(sentMessages, ["Resposta comercial"]);
assert.equal(
  receivedHandoff?.commercialOpportunityId,
  "opp-resolved-b",
);
      });
    },
  },  {
    name: "qualification signal uses dedicated system client for canonical by_system writer and keeps explicit scope params",
    run: async () => {
      const harness = createQualificationAutoProgressSupabaseHarness();

      await withMockedSupabaseEnv(async () => {
        const result = await generateAndSaveAiSalesReply(
          {
            organizationId: "org-canonical",
            storeId: "store-canonical",
            conversationId: "conv-canonical",
          },
          {
            createSupabaseClient: harness.createSupabaseClient,
            ...createScopeAwareReplyDeps({
              generateAiSalesReply: async () =>
                ({
                  ok: true,
                  aiText: "Resposta comercial",
                  anchorMessageId: "msg-1",
                  usage: null,
                  context: {
                    lastCustomerMessage: "Tenho interesse em comprar uma piscina",
                    leadName: "Cliente",
                    operationalFollowUpDecision: {
                      kind: "none",
                      reason: "none",
                    },
                    resolvedCommercialOpportunityId: "opp-canonical",
                    responseAnchorCommercialContext: {
                      messageId: "msg-1",
                      captureState: "captured",
                      historicalContextStatus: "captured",
                      conversationSessionId: "session-1",
                      commercialSessionContextLinkId: "link-1",
                      customerId: "customer-1",
                      commercialOpportunityId: "opp-canonical",
                      leadCustomerLinkId: "lead-link-1",
                    },
                  },
                }) as never,
            }),
          },
        );

        assert.equal(result.ok, true);
        assert.equal(harness.createClientCalls.length, 2);
        assert.deepEqual(harness.requestRpcCalls.map((call) => call.fn), [
          "transition_conversation_state_internal",
        ]);
        assert.deepEqual(harness.systemRpcCalls.map((call) => call.fn), [
          "transition_commercial_opportunity_stage_by_system",
        ]);
        assert.equal(
          harness.requestRpcCalls.some(
            (call) => call.fn === "transition_commercial_opportunity_stage_by_system"
          ),
          false,
        );
        assert.equal(
          harness.requestRpcCalls.some((call) => /_by_user$/i.test(call.fn)),
          false,
        );
        assert.deepEqual(harness.systemRpcCalls[0]?.payload, {
          p_organization_id: "org-canonical",
          p_store_id: "store-canonical",
          p_commercial_opportunity_id: "opp-canonical",
          p_idempotency_key: "ai_sales_signal_progress:msg-1:qualificacao",
          p_target_stage: "qualificacao",
          p_reason_details: "clear_customer_qualification_signal_detected",
          p_evidence_type: "incoming_customer_message",
          p_evidence_message_id: "msg-1",
          p_evidence_summary:
            "Mensagem do cliente contém sinal comercial claro para qualificação.",
          p_source: "ai_sales_auto_progress",
        });
      });
    },
  },
  {
    name: "qualification auto progress uses resolved B instead of arrival A after CMIR",
    run: async () => {
      const harness = createQualificationAutoProgressSupabaseHarness({
        expectedCommercialOpportunityId: "opp-resolved-b",
      });

      await withMockedSupabaseEnv(async () => {
        const result = await generateAndSaveAiSalesReply(
          {
            organizationId: "org-canonical",
            storeId: "store-canonical",
            conversationId: "conv-canonical",
          },
          {
            createSupabaseClient: harness.createSupabaseClient,
            ...createScopeAwareReplyDeps({
              generateAiSalesReply: async () =>
                ({
                  ok: true,
                  aiText: "Resposta comercial",
                  anchorMessageId: "msg-1",
                  usage: null,
                  context: {
                    lastCustomerMessage:
                      "Agora quero comprar outra piscina para minha chacara",
                    leadName: "Cliente",
                    operationalFollowUpDecision: {
                      kind: "none",
                      reason: "none",
                    },
                    resolvedCommercialOpportunityId: "opp-resolved-b",
                    responseAnchorCommercialContext: {
                      messageId: "msg-1",
                      captureState: "captured",
                      historicalContextStatus: "captured",
                      conversationSessionId: "session-1",
                      commercialSessionContextLinkId: "link-1",
                      customerId: "customer-1",
                      commercialOpportunityId: "opp-arrival-a",
                      leadCustomerLinkId: "lead-link-1",
                    },
                  },
                }) as never,
            }),
          },
        );

        assert.equal(result.ok, true);

        const canonicalCalls = harness.systemRpcCalls.filter(
          (call) =>
            call.fn ===
            "transition_commercial_opportunity_stage_by_system",
        );

        assert.equal(canonicalCalls.length, 1);
        assert.equal(
          canonicalCalls[0]?.payload.p_commercial_opportunity_id,
          "opp-resolved-b",
        );
        assert.equal(
          canonicalCalls.some(
            (call) =>
              call.payload.p_commercial_opportunity_id ===
              "opp-arrival-a",
          ),
          false,
        );
        assert.equal(
          canonicalCalls[0]?.payload.p_evidence_message_id,
          "msg-1",
        );
      });
    },
  },
  {    name: "qualification signal writer failure stays fail-closed and does not fall back to request-scoped by_system or by_user rpc",
    run: async () => {
      const harness = createQualificationAutoProgressSupabaseHarness({
        canonicalWriterError: {
          message: "commercial opportunity stage transition by system is not authorized",
        },
      });

      await withMockedSupabaseEnv(async () => {
        const result = await generateAndSaveAiSalesReply(
          {
            organizationId: "org-canonical",
            storeId: "store-canonical",
            conversationId: "conv-canonical",
          },
          {
            createSupabaseClient: harness.createSupabaseClient,
            ...createScopeAwareReplyDeps({
              generateAiSalesReply: async () =>
                ({
                  ok: true,
                  aiText: "Resposta comercial",
                  anchorMessageId: "msg-1",
                  usage: null,
                  context: {
                    lastCustomerMessage: "Tenho interesse em comprar uma piscina",
                    leadName: "Cliente",
                    operationalFollowUpDecision: {
                      kind: "none",
                      reason: "none",
                    },
                    resolvedCommercialOpportunityId: "opp-canonical",
                    responseAnchorCommercialContext: {
                      messageId: "msg-1",
                      captureState: "captured",
                      historicalContextStatus: "captured",
                      conversationSessionId: "session-1",
                      commercialSessionContextLinkId: "link-1",
                      customerId: "customer-1",
                      commercialOpportunityId: "opp-canonical",
                      leadCustomerLinkId: "lead-link-1",
                    },
                  },
                }) as never,
            }),
          },
        );

        assert.equal(result.ok, true);
        if (result.ok) {
          assert.deepEqual(result.context?.qualificationAutoProgressResult, {
            attempted: true,
            progressed: false,
            reason: "canonical_transition_to_qualification_failed",
            currentState: "novo_lead",
            error:
              "commercial opportunity stage transition by system is not authorized",
          });
        }
        assert.deepEqual(harness.requestRpcCalls, []);
        assert.deepEqual(harness.systemRpcCalls.map((call) => call.fn), [
          "transition_commercial_opportunity_stage_by_system",
        ]);
      });
    },
  },
  {
    name: "source loads canonical stage by exact commercial opportunity scope",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/generate-and-save-ai-sales-reply.ts"),
        "utf8",
      );

      const helperIndex = source.indexOf(
        "async function loadCanonicalCommercialOpportunityStage(args: {"
      );
      const nextTopLevelDeclarationIndex = source.indexOf(
        "\ntype CatalogPhotoAction =",
        helperIndex
      );

      assert.equal(helperIndex > -1, true);
      assert.equal(nextTopLevelDeclarationIndex > helperIndex, true);

      const helperSource = source.slice(helperIndex, nextTopLevelDeclarationIndex);

      assert.equal(helperSource.includes('.from("commercial_opportunities")'), true);
      assert.equal(helperSource.includes('.eq("id", args.commercialOpportunityId)'), true);
      assert.equal(helperSource.includes('.eq("organization_id", args.organizationId)'), true);
      assert.equal(helperSource.includes('.eq("store_id", args.storeId)'), true);
      assert.equal(helperSource.includes('.order("created_at"'), false);
      assert.equal(helperSource.includes(".limit(1)"), false);
      assert.equal(helperSource.includes("latest"), false);
      assert.equal(helperSource.includes("first"), false);
      assert.equal(helperSource.includes("fallback"), false);
    },
  },
  {
    name: "source uses canonical stage reader for quote handoff branching",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/generate-and-save-ai-sales-reply.ts"),
        "utf8",
      );

      const helperIndex = source.indexOf(
        "async function maybeAutoProgressCrmToBudgetFromQuoteHandoffCanonical("
      );
      const canonicalStageIndex = source.indexOf(
        "await loadCanonicalCommercialOpportunityStage({",
        helperIndex
      );
      const legacyStageIndex = source.indexOf(
        "await loadConservativeCrmStateForQuoteAutoProgress({",
        helperIndex
      );

      assert.equal(helperIndex > -1, true);
      assert.equal(canonicalStageIndex > helperIndex, true);
      assert.equal(legacyStageIndex, -1);
    },
  },
  {
    name: "source uses canonical stage reader for qualification signal branching",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/generate-and-save-ai-sales-reply.ts"),
        "utf8",
      );

      const helperIndex = source.indexOf(
        "async function maybeAutoProgressCrmToQualificationFromSalesSignalCanonical("
      );
      const canonicalStageIndex = source.indexOf(
        "await loadCanonicalCommercialOpportunityStage({",
        helperIndex
      );
      const legacyStageIndex = source.indexOf(
        "await loadConservativeCrmStateForQuoteAutoProgress({",
        helperIndex
      );

      assert.equal(helperIndex > -1, true);
      assert.equal(canonicalStageIndex > helperIndex, true);
      assert.equal(legacyStageIndex, -1);
    },
  },
  {
    name: "source passes generationAnchorMessageId into createCommercialAssistantHandoff",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/generate-and-save-ai-sales-reply.ts"),
        "utf8",
      );

      const handoffCallIndex = source.indexOf(
        "commercialHandoffResult = await resolvedDeps.createCommercialAssistantHandoff({"
      );
      const anchorParamIndex = source.indexOf(
        "generationAnchorMessageId,",
        handoffCallIndex
      );

      assert.equal(handoffCallIndex > -1, true);
      assert.equal(anchorParamIndex > handoffCallIndex, true);
    },
  },
  {
    name: "source runs canonical writer before legacy transition for quote handoff auto progress",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/generate-and-save-ai-sales-reply.ts"),
        "utf8",
      ).replace(/\r\n/g, "\n");

      const helperIndex = source.indexOf(
        "async function maybeAutoProgressCrmToBudgetFromQuoteHandoffCanonical("
      );
      const nextTopLevelFunctionIndex = source.indexOf(
        "async function maybeAutoProgressCrmToQualificationFromSalesSignalCanonical(",
        helperIndex
      );
      const helperBody = source.slice(helperIndex, nextTopLevelFunctionIndex);

      const qualificationCanonicalIndex = helperBody.indexOf(
        "const qualificationCanonicalFailure = await transitionCanonicalStage({"
      );
      const qualificationLegacyIndex = helperBody.indexOf(
        "const qualificationLegacyFailure = await transitionLegacyState({"
      );
      const budgetCanonicalNovoLeadIndex = helperBody.indexOf(
        "const budgetCanonicalFailure = await transitionCanonicalStage({"
      );
      const budgetLegacyNovoLeadIndex = helperBody.indexOf(
        "const budgetLegacyFailure = await transitionLegacyState({"
      );
      const directBudgetBranchIndex = helperBody.indexOf(
        'const budgetEventKey = buildAiSalesAutoProgressEventKey({\n' +
          "    taskId: args.taskId,\n" +
          '    step: currentStage === "qualificacao" ? "prepare_budget" : "budget_direct",\n' +
          "  });"
      );
      const budgetCanonicalDirectIndex = helperBody.indexOf(
        "const budgetCanonicalFailure = await transitionCanonicalStage({",
        directBudgetBranchIndex
      );
      const budgetLegacyDirectIndex = helperBody.indexOf(
        "const budgetLegacyFailure = await transitionLegacyState({",
        directBudgetBranchIndex
      );

      assert.equal(helperIndex > -1, true);
      assert.equal(nextTopLevelFunctionIndex > helperIndex, true);
      assert.equal(qualificationCanonicalIndex > -1, true);
      assert.equal(qualificationLegacyIndex > qualificationCanonicalIndex, true);
      assert.equal(
        budgetCanonicalNovoLeadIndex > qualificationLegacyIndex,
        true
      );
      assert.equal(
        budgetLegacyNovoLeadIndex > budgetCanonicalNovoLeadIndex,
        true
      );
      assert.equal(directBudgetBranchIndex > budgetLegacyNovoLeadIndex, true);
      assert.equal(
        budgetCanonicalDirectIndex > directBudgetBranchIndex,
        true
      );
      assert.equal(budgetLegacyDirectIndex > budgetCanonicalDirectIndex, true);
    },
  },
  {
    name: "source routes budget handoff canonical by_system writer through args.systemSupabase",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/generate-and-save-ai-sales-reply.ts"),
        "utf8",
      );

      const helperIndex = source.indexOf(
        "async function maybeAutoProgressCrmToBudgetFromQuoteHandoffCanonical("
      );
      const systemParamIndex = source.indexOf("systemSupabase: any;", helperIndex);
      const canonicalCallIndex = source.indexOf(
        "await transitionCommercialOpportunityStageBySystem({",
        helperIndex
      );
      const systemClientIndex = source.indexOf(
        "supabase: args.systemSupabase,",
        canonicalCallIndex
      );

      assert.equal(helperIndex > -1, true);
      assert.equal(systemParamIndex > helperIndex, true);
      assert.equal(canonicalCallIndex > helperIndex, true);
      assert.equal(systemClientIndex > canonicalCallIndex, true);
    },
  },
  {
    name: "source keeps sales signal auto progress fail-closed on missing opportunity binding",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/generate-and-save-ai-sales-reply.ts"),
        "utf8",
      );

      const helperIndex = source.indexOf(
        "async function maybeAutoProgressCrmToQualificationFromSalesSignalCanonical("
      );
      const helperEndIndex = source.indexOf(
        "async function loadConversationMessageBoundaryState(args: {",
        helperIndex
      );
      const helperSource = source.slice(helperIndex, helperEndIndex);
      const guardIndex = helperSource.indexOf(
        "if (!commercialOpportunityId || !generationAnchorMessageId) {"
      );
      const stageSnapshotIndex = helperSource.indexOf(
        "const stageSnapshot = await loadCanonicalCommercialOpportunityStage({"
      );
      const missingContextGuardSource = helperSource.slice(
        guardIndex,
        stageSnapshotIndex
      );
      const writerIndex = helperSource.indexOf(
        "await transitionCommercialOpportunityStageBySystem({"
      );

      assert.equal(helperIndex > -1, true);
      assert.equal(helperEndIndex > helperIndex, true);
      assert.equal(guardIndex > -1, true);
      assert.equal(stageSnapshotIndex > guardIndex, true);
      assert.equal(
        missingContextGuardSource.includes(
          'reason: "missing_commercial_opportunity_context"'
        ),
        true
      );
      assert.equal(
        missingContextGuardSource.includes(
          'skippedReason: "missing_commercial_opportunity_context"'
        ),
        true
      );
      assert.equal(
        missingContextGuardSource.includes("attempted: false"),
        true
      );
      assert.equal(
        missingContextGuardSource.includes("progressed: false"),
        true
      );
      assert.equal(writerIndex > stageSnapshotIndex, true);
    },
  },
  {
    name: "source routes qualification signal canonical by_system writer through args.systemSupabase and passes dedicated system client from main flow",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/generate-and-save-ai-sales-reply.ts"),
        "utf8",
      );

      const helperIndex = source.indexOf(
        "async function maybeAutoProgressCrmToQualificationFromSalesSignalCanonical("
      );
      const systemParamIndex = source.indexOf("systemSupabase: any;", helperIndex);
      const canonicalCallIndex = source.indexOf(
        "await transitionCommercialOpportunityStageBySystem({",
        helperIndex
      );
      const systemClientIndex = source.indexOf(
        "supabase: args.systemSupabase,",
        canonicalCallIndex
      );
      const mainSystemClientIndex = source.indexOf(
        "const systemSupabase = resolvedDeps.createSupabaseClient(",
      );
      const mainPassIndex = source.indexOf(
        "systemSupabase,",
        source.indexOf(
          "await maybeAutoProgressCrmToQualificationFromSalesSignalCanonical({"
        )
      );

      assert.equal(helperIndex > -1, true);
      assert.equal(systemParamIndex > helperIndex, true);
      assert.equal(canonicalCallIndex > helperIndex, true);
      assert.equal(systemClientIndex > canonicalCallIndex, true);
      assert.equal(mainSystemClientIndex > -1, true);
      assert.equal(mainPassIndex > -1, true);
    },
  },
  {
    name: "source uses stable message-based idempotency for qualification signal auto progress",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/generate-and-save-ai-sales-reply.ts"),
        "utf8",
      );

      assert.equal(
        source.includes(
          'return `ai_sales_signal_progress:${args.generationAnchorMessageId}:${args.targetStage}`;'
        ),
        true
      );
      assert.equal(source.includes("incoming_customer_message"), true);
      assert.equal(
        source.includes(
          "Mensagem do cliente contém sinal comercial claro para qualificação."
        ),
        true
      );
    },
  },
  {
    name: "non-commercial path remains unchanged and skips insert",
    run: async () => {
      const recorder = createSupabaseRecorder();

      const result = await createCommercialAssistantHandoff(
        {
          supabase: recorder.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          conversationId: "conv-1",
          leadId: "lead-1",
          handoff: null,
        },
        createDeps(),
      );

      assert.deepEqual(result, {
        created: false,
        skipped: true,
        reason: "handoff_not_requested",
      });
      assert.equal(recorder.insertedRows.length, 0);
    },
  },
  {
    name: "source uses exact canonical opportunity scope without latest fallback",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/generate-and-save-ai-sales-reply.ts"),
        "utf8",
      );

      const helperIndex = source.indexOf(
        "async function loadCanonicalCommercialOpportunityStage(args: {"
      );
      const nextTopLevelDeclarationIndex = source.indexOf(
        "\ntype CatalogPhotoAction =",
        helperIndex
      );
      const helperSource = source.slice(helperIndex, nextTopLevelDeclarationIndex);

      assert.equal(helperIndex > -1, true);
      assert.equal(nextTopLevelDeclarationIndex > helperIndex, true);
      assert.equal(helperSource.includes('.from("commercial_opportunities")'), true);
      assert.equal(helperSource.includes('.select("id, stage")'), true);
      assert.equal(helperSource.includes('.eq("id", args.commercialOpportunityId)'), true);
      assert.equal(helperSource.includes('.eq("organization_id", args.organizationId)'), true);
      assert.equal(helperSource.includes('.eq("store_id", args.storeId)'), true);
      assert.equal(helperSource.includes(".maybeSingle()"), true);
      assert.equal(helperSource.includes('.order("created_at"'), false);
      assert.equal(helperSource.includes(".limit(1)"), false);
      assert.equal(helperSource.includes("latest"), false);
      assert.equal(helperSource.includes("first"), false);
      assert.equal(helperSource.includes("fallback"), false);
      assert.equal(
        helperSource.includes("loadConservativeCrmStateForQuoteAutoProgress"),
        false
      );
      assert.equal(
        helperSource.includes("readCommercialOpportunityIdFromHandoff"),
        false
      );
    },
  },
];

async function main() {
  let passed = 0;

  for (const test of tests) {
    await test.run();
    passed += 1;
  }

  console.log(
    `generate-and-save-ai-sales-reply: ${passed}/${tests.length} tests passed`,
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
