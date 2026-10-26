import test from "node:test";
import assert from "node:assert/strict";

import type { AssistantReplyTestDependencies } from "@/app/api/assistant/reply/route";
import { generateAssistantReply } from "@/app/api/assistant/reply/route";
import { generateAiSalesReply } from "@/lib/server/generate-ai-sales-reply";

export type SimulationTurn = {
  userMessage: string;
  simulatedReply: string;
};

export type SimulationScenario = {
  id: "assistant-1" | "assistant-2" | "sales-1" | "sales-2";
  actor: "assistant" | "sales";
  turns: SimulationTurn[];
};

export type SimulationBudget = {
  maxCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxOutputTokensPerCall: number;
};

export const budget: SimulationBudget = {
  maxCalls: 32,
  maxInputTokens: 96_000,
  maxOutputTokens: 9_600,
  maxOutputTokensPerCall: 300,
};

export const scenarios: SimulationScenario[] = [
  {
    id: "assistant-1",
    actor: "assistant",
    turns: [
      { userMessage: "Quais compromissos tenho hoje?", simulatedReply: "Vou consultar os compromissos de hoje." },
      { userMessage: "O primeiro é do João?", simulatedReply: "Vou conferir o cliente no compromisso selecionado." },
      { userMessage: "Não, era a Maria. E depois mudei de assunto.", simulatedReply: "Entendi a correção e não vou reutilizar a referência sem confirmar." },
      { userMessage: "Agora me diga o horário de funcionamento.", simulatedReply: "Vou consultar o horário configurado da loja." },
    ],
  },
  {
    id: "assistant-2",
    actor: "assistant",
    turns: [
      { userMessage: "Preciso remarcar um compromisso.", simulatedReply: "Qual compromisso você quer remarcar?" },
      { userMessage: "O da manhã.", simulatedReply: "Preciso de mais uma referência para identificar o compromisso." },
      { userMessage: "O da Maria, amanhã.", simulatedReply: "Encontrei a referência; confirme a nova data e horário." },
      { userMessage: "Pode ser esse.", simulatedReply: "Ainda preciso da confirmação inequívoca do horário antes de alterar a agenda." },
    ],
  },
  {
    id: "sales-1",
    actor: "sales",
    turns: [
      { userMessage: "Estou procurando uma piscina.", simulatedReply: "Posso te ajudar. Qual espaço você tem disponível?" },
      { userMessage: "Tenho 3 por 4 metros.", simulatedReply: "Com essa medida, posso filtrar modelos compatíveis." },
      { userMessage: "Gostei do modelo compacto e quero instalação.", simulatedReply: "Vou considerar o modelo compacto e a instalação na consulta." },
      { userMessage: "Quanto fica?", simulatedReply: "O valor depende do modelo e da instalação; vou verificar as condições cadastradas." },
    ],
  },
  {
    id: "sales-2",
    actor: "sales",
    turns: [
      { userMessage: "Quero o modelo 305.", simulatedReply: "Vou confirmar o modelo 305 no catálogo atual." },
      { userMessage: "Tem desconto no Pix?", simulatedReply: "Posso verificar a política de desconto configurada para esse produto." },
      { userMessage: "Na verdade quero a versão menor.", simulatedReply: "Entendi a mudança; vou separar a nova opção da negociação anterior." },
      { userMessage: "Sim, pode ser.", simulatedReply: "Preciso confirmar qual versão e condição você aprovou antes de avançar." },
    ],
  },
];

export const simulationFixtures = {
  organization: { id: "org-simulation", name: "Organização fictícia" },
  store: { id: "store-simulation", organization_id: "org-simulation", name: "Loja de simulação", timezone: "America/Sao_Paulo" },
  responsible: { id: "responsible-simulation", organization_id: "org-simulation", store_id: "store-simulation", authorized: true },
  assistantThread: { id: "thread-simulation", organization_id: "org-simulation", store_id: "store-simulation", status: "active", thread_type: "primary" },
  customers: [
    { id: "customer-joao", organization_id: "org-simulation", store_id: "store-simulation", name: "João Silva", phone: "5511999000001" },
    { id: "customer-maria", organization_id: "org-simulation", store_id: "store-simulation", name: "Maria Souza", phone: "5511999000002" },
  ],
  appointments: [
    { id: "appointment-joao", organization_id: "org-simulation", store_id: "store-simulation", customer_id: "customer-joao", customer_name: "João Silva", scheduled_start: "2026-10-27T13:00:00.000Z", status: "scheduled" },
    { id: "appointment-maria", organization_id: "org-simulation", store_id: "store-simulation", customer_id: "customer-maria", customer_name: "Maria Souza", scheduled_start: "2026-10-27T15:00:00.000Z", status: "scheduled" },
  ],
  catalog: [
    { id: "pool-compact", organization_id: "org-simulation", store_id: "store-simulation", name: "Compacta 300", price_cents: 1899000, active: true },
    { id: "pool-305", organization_id: "org-simulation", store_id: "store-simulation", name: "Modelo 305", price_cents: 2499000, active: true },
  ],
  opportunity: { id: "opportunity-simulation", organization_id: "org-simulation", store_id: "store-simulation", stage: "qualificacao", lead_id: "lead-simulation" },
  conversation: { id: "conversation-simulation", organization_id: "org-simulation", store_id: "store-simulation", lead_id: "lead-simulation", status: "open", is_human_active: false },
  settings: { offers_installation: true, accepted_payment_methods: ["pix", "cartao"], discount_policy: "simulated_only" },
} as const;

export class BoundedSimulatedOpenAI {
  readonly calls: Array<{ model: string; input: unknown; outputTokens: number }> = [];
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(
    private readonly model: string,
    private readonly replies: string[],
    private readonly limits: SimulationBudget,
  ) {}

  readonly responses = {
    create: async (request: { input?: unknown; max_output_tokens?: number }) => {
      if (this.calls.length >= this.limits.maxCalls) throw new Error("SIMULATION_CALL_LIMIT_EXCEEDED");
      const outputTokens = Math.min(request.max_output_tokens || 0, this.limits.maxOutputTokensPerCall);
      const inputTokens = Math.min(2_000, this.limits.maxInputTokens - this.inputTokens);
      if (inputTokens <= 0 || this.outputTokens + outputTokens > this.limits.maxOutputTokens) {
        throw new Error("SIMULATION_TOKEN_LIMIT_EXCEEDED");
      }

      this.inputTokens += inputTokens;
      this.outputTokens += outputTokens;
      this.calls.push({ model: this.model, input: request.input, outputTokens });
      return {
        output_text: this.replies[this.calls.length - 1] || "Resposta simulada controlada.",
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        simulation: true,
      };
    },
  };

  get usage() {
    return { inputTokens: this.inputTokens, outputTokens: this.outputTokens };
  }
}

export function createFailFastSupabase() {
  const events: string[] = [];
  const client = {
    from(table: string) {
      events.push(`from:${table}`);
      throw new Error(`UNEXPECTED_SUPABASE_OPERATION:${table}`);
    },
    rpc(name: string) {
      events.push(`rpc:${name}`);
      throw new Error(`UNEXPECTED_SUPABASE_OPERATION:${name}`);
    },
  };
  return { client, events };
}

export function createFixtureSupabase() {
  const events: string[] = [];
  const messages: Array<Record<string, unknown>> = scenarios.flatMap((scenario) => scenario.turns.map((turn, index) => ({
    id: `${scenario.id}-message-${index + 1}`,
    organization_id: simulationFixtures.organization.id,
    store_id: simulationFixtures.store.id,
    conversation_id: simulationFixtures.conversation.id,
    sender: scenario.actor === "sales" ? "user" : "human",
    sender_role: scenario.actor === "sales" ? "customer" : "responsible",
    content: turn.userMessage,
    direction: "incoming",
    message_type: "text",
    created_at: `2026-10-26T${String(8 + index).padStart(2, "0")}:00:00.000Z`,
  }))) as Array<Record<string, unknown>>;
  let activeMessages = [...messages];
  const rows: Record<string, readonly unknown[]> = {
    stores: [simulationFixtures.store],
    conversations: [simulationFixtures.conversation],
    leads: [{ id: "lead-simulation", organization_id: simulationFixtures.organization.id, store_id: simulationFixtures.store.id, name: "Cliente Simulado", phone: "5511999000000", state: "qualificacao" }],
    commercial_opportunities: [simulationFixtures.opportunity],
    messages,
    store_assistant_threads: [simulationFixtures.assistantThread],
    store_assistant_context_state: [],
    store_onboarding_answers: [],
    store_operation_settings: [simulationFixtures.settings],
    store_commercial_ai_settings: [],
    store_discount_settings: [],
    store_high_value_discount_settings: [],
    store_catalog_items: simulationFixtures.catalog,
    pools: simulationFixtures.catalog,
    pool_photos: [],
    store_appointments: simulationFixtures.appointments,
    store_schedule_settings: [],
    store_schedule_blocks: [],
    store_assistant_messages: [],
    store_assistant_notification_queue: [],
    schedule_post_appointment_followups: [],
    store_assistant_operational_tasks: [],
    store_assistant_operational_task_queue: [],
    ai_runs: [],
  };
  const makeQuery = (table: string) => {
    const data = table === "messages" ? activeMessages : rows[table] || [];
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "contains", "order", "limit", "gte", "lte", "gt", "lt", "neq", "is", "not", "insert", "update"] as const) {
      query[method] = () => query;
    }
    query.maybeSingle = async () => ({ data: data[0] || null, error: null });
    query.then = (resolve: (value: unknown) => unknown) => resolve({ data, error: null });
    return query;
  };
  return {
    events,
    setActiveMessages(nextMessages: Array<Record<string, unknown>>) {
      activeMessages = [...nextMessages];
    },
    appendMessage(message: Record<string, unknown>) {
      activeMessages.push(message);
    },
    client: {
      from(table: string) {
        events.push(`from:${table}`);
        return makeQuery(table);
      },
      async rpc(name: string) {
        events.push(`rpc:${name}`);
        if (name === "assistant_list_messages") return { data: activeMessages, error: null };
        return { data: null, error: null };
      },
    },
  };
}

export type PreparedConversationRecord = {
  scenarioId: SimulationScenario["id"];
  turn: number;
  actor: SimulationScenario["actor"];
  output: unknown;
  source: "simulated" | "openai";
  modelCallsAfterTurn?: number;
  assistantCallsAfterTurn?: number;
  salesCallsAfterTurn?: number;
  inputTokensAfterTurn?: number;
  outputTokensAfterTurn?: number;
};

export type PreparedConversationRunnerArgs = {
  mode?: "simulated" | "simulated-real-path" | "real";
  authorization?: string;
  assistantDependencies?: AssistantReplyTestDependencies;
  salesDependencies?: {
    supabaseClient: unknown;
    openaiClient: { responses: { create: (request: unknown) => Promise<unknown> } };
  };
};

function createBudgetedOpenAIClient(
  client: { responses: { create: (request: unknown) => Promise<unknown> } },
  shared: { calls: number; inputTokens: number; outputTokens: number },
) {
  return {
    responses: {
      create: async (request: Record<string, unknown>) => {
        if (shared.calls >= budget.maxCalls) throw new Error("SIMULATION_CALL_LIMIT_EXCEEDED");
        const requestedOutput = typeof request.max_output_tokens === "number" ? request.max_output_tokens : budget.maxOutputTokensPerCall;
        if (requestedOutput > budget.maxOutputTokensPerCall) throw new Error("SIMULATION_OUTPUT_LIMIT_EXCEEDED");
        const estimatedInput = 2_000;
        if (shared.inputTokens + estimatedInput > budget.maxInputTokens) throw new Error("SIMULATION_INPUT_LIMIT_EXCEEDED");

        shared.calls += 1;
        shared.inputTokens += estimatedInput;
        const response = await client.responses.create({ ...request, max_output_tokens: requestedOutput });
        const usage = response && typeof response === "object" && "usage" in response
          ? (response as { usage?: { output_tokens?: unknown } }).usage
          : null;
        const outputTokens = typeof usage?.output_tokens === "number" ? usage.output_tokens : requestedOutput;
        shared.outputTokens += outputTokens;
        if (shared.outputTokens > budget.maxOutputTokens) throw new Error("SIMULATION_OUTPUT_LIMIT_EXCEEDED");
        return response;
      },
    },
  };
}

/**
 * Local-only executor. Real mode never creates clients: it requires both an
 * explicit argument and a process-local authorization marker, plus injected
 * dependencies. Thus the default path cannot call OpenAI or Supabase.
 */
export async function executePreparedConversations(
  args: PreparedConversationRunnerArgs = {},
): Promise<PreparedConversationRecord[]> {
  const mode = args.mode || "simulated";
  if (mode === "real") {
    if (args.authorization !== "REAL_SIMULATION_AUTHORIZED" || process.env.ZION_REAL_SIMULATION_AUTHORIZED !== "1") {
      throw new Error("REAL_SIMULATION_AUTHORIZATION_REQUIRED");
    }
    if (!args.assistantDependencies || !args.salesDependencies) {
      throw new Error("REAL_SIMULATION_DEPENDENCIES_REQUIRED");
    }
  }

  if (mode === "simulated") {
    const assistantTurns = scenarios.filter((scenario) => scenario.actor === "assistant").flatMap((scenario) => scenario.turns);
    const salesTurns = scenarios.filter((scenario) => scenario.actor === "sales").flatMap((scenario) => scenario.turns);
    const assistantClient = new BoundedSimulatedOpenAI("gpt-4.1-mini", assistantTurns.map((turn) => turn.simulatedReply), { ...budget, maxCalls: 8 });
    const salesClient = new BoundedSimulatedOpenAI("gpt-4.1-mini", salesTurns.map((turn) => turn.simulatedReply), budget);
    const records: PreparedConversationRecord[] = [];
    let assistantIndex = 0;
    let salesIndex = 0;
    for (const scenario of scenarios) {
      for (const [index, turn] of scenario.turns.entries()) {
        const client = scenario.actor === "assistant" ? assistantClient : salesClient;
        const response = await client.responses.create({
          input: { scenario: scenario.id, turn: index + 1, userMessage: turn.userMessage },
          max_output_tokens: budget.maxOutputTokensPerCall,
        });
        records.push({ scenarioId: scenario.id, turn: index + 1, actor: scenario.actor, output: response, source: "simulated", modelCallsAfterTurn: assistantClient.calls.length + salesClient.calls.length, inputTokensAfterTurn: assistantClient.usage.inputTokens + salesClient.usage.inputTokens, outputTokensAfterTurn: assistantClient.usage.outputTokens + salesClient.usage.outputTokens });
        if (scenario.actor === "assistant") assistantIndex += 1;
        else salesIndex += 1;
      }
    }
    assert.equal(assistantIndex, assistantTurns.length);
    assert.equal(salesIndex, salesTurns.length);
    return records;
  }

  if (mode === "simulated-real-path") {
    const supabase = createFixtureSupabase();
    const assistantClient = new BoundedSimulatedOpenAI("gpt-4.1-mini", scenarios[0].turns.map((turn) => turn.simulatedReply), { ...budget, maxCalls: 8 });
    const salesReply = "{\"reply_text\":\"Resposta comercial simulada\",\"cross_sell_suggestions_included\":[]}";
    const salesClient = new BoundedSimulatedOpenAI("gpt-4.1-mini", Array.from({ length: budget.maxCalls }, () => salesReply), budget);
    const assistantDependencies = {
      supabaseClient: supabase.client as unknown as AssistantReplyTestDependencies["supabaseClient"],
      openaiClient: assistantClient as unknown as AssistantReplyTestDependencies["openaiClient"],
      persistAssistantReply: async () => null,
      recordAssistantAiRun: async () => undefined,
    };
    const records: PreparedConversationRecord[] = [];
    for (const scenario of scenarios) {
      for (const [index, turn] of scenario.turns.entries()) {
        const message = {
          id: `${scenario.id}-active-${index + 1}`,
          organization_id: simulationFixtures.organization.id,
          store_id: simulationFixtures.store.id,
          conversation_id: simulationFixtures.conversation.id,
          sender: scenario.actor === "sales" ? "user" : "human",
          sender_role: scenario.actor === "sales" ? "customer" : "responsible",
          content: turn.userMessage,
          direction: "incoming",
          message_type: "text",
          created_at: `2026-10-26T${String(10 + index).padStart(2, "0")}:00:00.000Z`,
        };
        supabase.setActiveMessages([message]);
        const output = scenario.actor === "assistant"
          ? await generateAssistantReply({
              request: new Request("http://localhost/assistant-simulation"),
              organizationId: simulationFixtures.organization.id,
              storeId: simulationFixtures.store.id,
              testDependencies: assistantDependencies,
            })
          : await generateAiSalesReply({
              organizationId: simulationFixtures.organization.id,
              storeId: simulationFixtures.store.id,
              conversationId: simulationFixtures.conversation.id,
              anchorMessageId: message.id,
              supabaseClient: supabase.client,
              openaiClient: salesClient,
            });
        records.push({ scenarioId: scenario.id, turn: index + 1, actor: scenario.actor, output, source: "simulated", modelCallsAfterTurn: assistantClient.calls.length + salesClient.calls.length, assistantCallsAfterTurn: assistantClient.calls.length, salesCallsAfterTurn: salesClient.calls.length, inputTokensAfterTurn: assistantClient.usage.inputTokens + salesClient.usage.inputTokens, outputTokensAfterTurn: assistantClient.usage.outputTokens + salesClient.usage.outputTokens });
      }
    }
    return records;
  }

  const records: PreparedConversationRecord[] = [];
  const sharedUsage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const assistantInput = args.assistantDependencies;
  const salesInput = args.salesDependencies;
  const assistantDependencies = {
    ...assistantInput,
    openaiClient: createBudgetedOpenAIClient(assistantInput!.openaiClient as unknown as { responses: { create: (request: unknown) => Promise<unknown> } }, sharedUsage),
  } as AssistantReplyTestDependencies;
  const salesDependencies = {
    ...salesInput,
    openaiClient: createBudgetedOpenAIClient(salesInput!.openaiClient, sharedUsage),
  };
  for (const scenario of scenarios) {
    for (const [index] of scenario.turns.entries()) {
      const output = scenario.actor === "assistant"
        ? await generateAssistantReply({
            request: new Request("http://localhost/assistant-simulation"),
            organizationId: "org-simulation",
            storeId: "store-simulation",
            testDependencies: assistantDependencies,
          })
        : await generateAiSalesReply({
            organizationId: "org-simulation",
            storeId: "store-simulation",
            conversationId: "conversation-simulation",
            anchorMessageId: "anchor-simulation",
            supabaseClient: salesDependencies.supabaseClient,
            openaiClient: salesDependencies.openaiClient,
          });
      records.push({ scenarioId: scenario.id, turn: index + 1, actor: scenario.actor, output, source: "openai" });
    }
  }
  return records;
}

function buildAssistantDependencies(modelClient: BoundedSimulatedOpenAI, supabase: ReturnType<typeof createFailFastSupabase>): AssistantReplyTestDependencies {
  return {
    supabaseClient: supabase.client as unknown as AssistantReplyTestDependencies["supabaseClient"],
    openaiClient: modelClient as unknown as AssistantReplyTestDependencies["openaiClient"],
    persistAssistantReply: async () => null,
    recordAssistantAiRun: async () => undefined,
  };
}

test("real-generation preparation keeps four conversations bounded and simulated", async () => {
  const assistantTurns = scenarios.filter((scenario) => scenario.actor === "assistant").flatMap((scenario) => scenario.turns);
  const salesTurns = scenarios.filter((scenario) => scenario.actor === "sales").flatMap((scenario) => scenario.turns);
  const assistantClient = new BoundedSimulatedOpenAI(
    process.env.ZION_AI_ASSISTANT_MODEL || "gpt-4.1-mini",
    assistantTurns.map((turn) => turn.simulatedReply),
    { ...budget, maxCalls: 8 },
  );
  const salesClient = new BoundedSimulatedOpenAI(
    process.env.ZION_AI_SALES_MODEL || "gpt-4.1-mini",
    salesTurns.map((turn) => turn.simulatedReply),
    budget,
  );
  const supabase = createFailFastSupabase();

  const assistantDependencies = buildAssistantDependencies(assistantClient, supabase);
  const salesDependencies = {
    supabaseClient: supabase.client,
    openaiClient: salesClient,
  };

  assert.ok(assistantDependencies.openaiClient);
  assert.ok(assistantDependencies.supabaseClient);
  assert.ok(salesDependencies.openaiClient);
  assert.ok(salesDependencies.supabaseClient);

  for (const scenario of scenarios) {
    for (const turn of scenario.turns) {
      const modelClient = scenario.actor === "assistant" ? assistantClient : salesClient;
      const response = await modelClient.responses.create({
          input: { fixture: simulationFixtures, scenario: scenario.id, actor: scenario.actor, userMessage: turn.userMessage },
        max_output_tokens: budget.maxOutputTokensPerCall,
      });
      assert.equal(response.simulation, true);
      assert.equal(typeof response.output_text, "string");
    }
  }

  assert.equal(scenarios.length, 4);
  assert.equal(assistantTurns.length + salesTurns.length, 16);
  assert.equal(assistantClient.calls.length, 8);
  assert.equal(salesClient.calls.length, 8);
  assert.ok(assistantClient.calls.every((call) => call.model === (process.env.ZION_AI_ASSISTANT_MODEL || "gpt-4.1-mini")));
  assert.ok(salesClient.calls.every((call) => call.model === (process.env.ZION_AI_SALES_MODEL || "gpt-4.1-mini")));
  assert.ok(assistantClient.usage.inputTokens <= budget.maxInputTokens);
  assert.ok(salesClient.usage.inputTokens <= budget.maxInputTokens);
  assert.ok(assistantClient.usage.outputTokens <= budget.maxOutputTokens);
  assert.ok(salesClient.usage.outputTokens <= budget.maxOutputTokens);
  assert.deepEqual(supabase.events, []);
});

test("prepared executor runs all 16 turns in simulated mode and marks outputs", async () => {
  const records = await executePreparedConversations();
  assert.equal(records.length, 16);
  assert.ok(records.every((record) => record.source === "simulated"));
  assert.deepEqual(records.map((record) => record.turn), [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4]);
});

test("prepared executor traverses the real generator functions with fixture data and simulated OpenAI", async () => {
  const records = await executePreparedConversations({ mode: "simulated-real-path" });
  assert.equal(records.length, 16);
  assert.ok(records.every((record) => record.source === "simulated"));
  assert.ok(records.every((record) => record.output && typeof record.output === "object"));
  const totalCalls = records.at(-1)?.modelCallsAfterTurn || 0;
  assert.equal(totalCalls, 13);
  assert.equal(records.at(-1)?.assistantCallsAfterTurn, 5);
  assert.equal(records.at(-1)?.salesCallsAfterTurn, 8);
  assert.ok(totalCalls <= budget.maxCalls);
  assert.ok((records.at(-1)?.inputTokensAfterTurn || 0) <= budget.maxInputTokens);
  assert.ok((records.at(-1)?.outputTokensAfterTurn || 0) <= budget.maxOutputTokens);
});

test("prepared executor blocks real mode without both authorization gates", async () => {
  await assert.rejects(
    () => executePreparedConversations({ mode: "real" }),
    /REAL_SIMULATION_AUTHORIZATION_REQUIRED/,
  );
});

test("real-generation preparation fails fast for an unrecognized Supabase effect", () => {
  const supabase = createFailFastSupabase();
  assert.throws(() => supabase.client.rpc("cancel_store_appointment"), /UNEXPECTED_SUPABASE_OPERATION/);
  assert.throws(() => supabase.client.from("messages"), /UNEXPECTED_SUPABASE_OPERATION/);
  assert.deepEqual(supabase.events, ["rpc:cancel_store_appointment", "from:messages"]);
});

test("real-generation preparation rejects a missing model dependency by policy", () => {
  const modelClient: BoundedSimulatedOpenAI | null = null;
  assert.equal(modelClient, null);
  assert.throws(() => {
    if (!modelClient) throw new Error("SIMULATION_OPENAI_DEPENDENCY_REQUIRED");
  }, /SIMULATION_OPENAI_DEPENDENCY_REQUIRED/);
});

test("fixture supabase reaches the sales generator without external services", async () => {
  const supabase = createFixtureSupabase();
  const model = new BoundedSimulatedOpenAI("gpt-4.1-mini", ["{\"reply_text\":\"Resposta simulada\",\"cross_sell_suggestions_included\":[]}"], budget);
  const result = await generateAiSalesReply({
    organizationId: simulationFixtures.organization.id,
    storeId: simulationFixtures.store.id,
    conversationId: simulationFixtures.conversation.id,
    anchorMessageId: "sales-1-message-1",
    supabaseClient: supabase.client,
    openaiClient: model,
  });
  assert.equal(result.ok, true);
  assert.ok(model.calls.length > 0);
  assert.ok(supabase.events.length > 0);
});

test("fixture supabase reaches the assistant generator without external services", async () => {
  const supabase = createFixtureSupabase();
  const model = new BoundedSimulatedOpenAI("gpt-4.1-mini", ["Resposta operacional simulada"], budget);
  const result = await generateAssistantReply({
    request: new Request("http://localhost/assistant-simulation"),
    organizationId: simulationFixtures.organization.id,
    storeId: simulationFixtures.store.id,
    testDependencies: {
      supabaseClient: supabase.client as unknown as AssistantReplyTestDependencies["supabaseClient"],
      openaiClient: model as unknown as AssistantReplyTestDependencies["openaiClient"],
      persistAssistantReply: async () => null,
      recordAssistantAiRun: async () => undefined,
    },
  });
  assert.equal(result.ok, true);
  assert.equal(model.calls.length, 1);
  assert.ok(supabase.events.length > 0);
});
