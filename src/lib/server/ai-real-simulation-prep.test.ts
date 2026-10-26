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

const modelPricing: Record<string, { inputUsdPer1M: number; outputUsdPer1M: number }> = {
  "gpt-4o-mini": { inputUsdPer1M: 0.15, outputUsdPer1M: 0.6 },
  "gpt-4.1-mini": { inputUsdPer1M: 0.4, outputUsdPer1M: 1.6 },
  "gpt-5": { inputUsdPer1M: 1.25, outputUsdPer1M: 10 },
  "gpt-5-mini": { inputUsdPer1M: 0.25, outputUsdPer1M: 2 },
  "gpt-5-nano": { inputUsdPer1M: 0.05, outputUsdPer1M: 0.4 },
};

function normalizeModel(model: unknown): string {
  return String(model || "").trim().toLowerCase();
}

function pricingForModel(model: unknown) {
  const normalized = normalizeModel(model);
  const key = Object.keys(modelPricing).find((candidate) => normalized === candidate || normalized.startsWith(`${candidate}-`));
  return key ? { model: key, pricing: modelPricing[key] } : null;
}

function estimateInputTokens(payload: unknown): number {
  const serialized = JSON.stringify(payload ?? null);
  // Conservative local estimate: UTF-8/JSON overhead plus non-text structure margin.
  return Math.ceil(serialized.length / 3) + 256;
}

function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = modelPricing[model];
  return (inputTokens / 1_000_000) * pricing.inputUsdPer1M + (outputTokens / 1_000_000) * pricing.outputUsdPer1M;
}

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

export const scenarioFixtures = {
  "assistant-1": { threadId: "thread-assistant-1", conversationId: "conversation-assistant-1", leadId: "lead-assistant-1" },
  "assistant-2": { threadId: "thread-assistant-2", conversationId: "conversation-assistant-2", leadId: "lead-assistant-2" },
  "sales-1": { threadId: "thread-sales-1", conversationId: "conversation-sales-1", leadId: "lead-sales-1", opportunityId: "opportunity-sales-1" },
  "sales-2": { threadId: "thread-sales-2", conversationId: "conversation-sales-2", leadId: "lead-sales-2", opportunityId: "opportunity-sales-2" },
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
      const inputTokens = estimateInputTokens(request.input);
      if (inputTokens <= 0 || this.outputTokens + outputTokens > this.limits.maxOutputTokens) {
        throw new Error("SIMULATION_TOKEN_LIMIT_EXCEEDED");
      }
      if (this.inputTokens + inputTokens > this.limits.maxInputTokens) throw new Error("SIMULATION_INPUT_LIMIT_EXCEEDED");

      this.inputTokens += inputTokens;
      this.outputTokens += outputTokens;
      this.calls.push({ model: this.model, input: request.input, outputTokens });
      return {
        output_text: this.replies[this.calls.length - 1] || "Resposta simulada controlada.",
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        model: this.model,
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
  const historyByScenario = new Map<SimulationScenario["id"], Array<Record<string, unknown>>>(scenarios.map((scenario) => [scenario.id, []]));
  let activeScenario: SimulationScenario["id"] = "assistant-1";
  let activeMessages = historyByScenario.get(activeScenario)!;
  const scenarioRows = (scenarioId: SimulationScenario["id"]) => {
    const context = scenarioFixtures[scenarioId];
    return {
      conversation: {
        ...simulationFixtures.conversation,
        id: context.conversationId,
        lead_id: context.leadId,
      },
      lead: {
        id: context.leadId,
        organization_id: simulationFixtures.organization.id,
        store_id: simulationFixtures.store.id,
        name: scenarioId.startsWith("sales") ? "Cliente Comercial Fictício" : "Responsável Fictício",
        phone: `5511999${scenarioId.replace(/[^0-9]/g, "").padStart(4, "0")}`,
        state: "qualificacao",
      },
      opportunity: {
        ...simulationFixtures.opportunity,
        id: ("opportunityId" in context ? context.opportunityId : null) || `opportunity-${scenarioId}`,
        lead_id: context.leadId,
      },
      thread: {
        ...simulationFixtures.assistantThread,
        id: context.threadId,
      },
    };
  };
  const rows: Record<string, readonly unknown[]> = {
    stores: [simulationFixtures.store],
    conversations: [simulationFixtures.conversation],
    leads: [],
    commercial_opportunities: [],
    messages: [],
    store_assistant_threads: [simulationFixtures.assistantThread],
    store_assistant_context_state: [],
    store_onboarding_answers: [],
    store_operation_settings: [simulationFixtures.settings],
    store_responsibles: [simulationFixtures.responsible],
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
  const allowedTables = new Set(Object.keys(rows));
  const allowedRpcs = new Set([
    "assistant_list_messages",
    "read_store_payment_settings_by_system",
    "read_store_strategy_settings_by_system",
    "read_store_operation_execution_policies_by_system",
    "read_store_settings_experience_policies_scoped",
    "read_store_channel_settings_by_system",
    "read_store_discount_counterpart_policy_scoped",
  ]);
  const readMethods = new Set(["select", "eq", "in", "contains", "order", "limit", "gte", "lte", "gt", "lt", "neq", "is", "not", "maybeSingle"]);
  const makeQuery = (table: string) => {
    const current = scenarioRows(activeScenario);
    const dynamicRows: Record<string, readonly unknown[]> = {
      conversations: [current.conversation],
      leads: [current.lead],
      commercial_opportunities: [current.opportunity],
      messages: activeMessages,
      store_assistant_threads: [current.thread],
    };
    const data = dynamicRows[table] || rows[table] || [];
    const query: Record<string, unknown> = {};
    for (const method of readMethods) {
      query[method] = (...args: unknown[]) => {
        void args;
        return query;
      };
    }
    for (const method of ["insert", "update", "upsert", "delete", "single"] as const) {
      query[method] = () => {
        events.push(`blocked:${table}.${method}`);
        throw new Error(`UNEXPECTED_SUPABASE_OPERATION:${table}.${method}`);
      };
    }
    query.maybeSingle = async () => ({ data: data[0] || null, error: null });
    query.then = (resolve: (value: unknown) => unknown) => resolve({ data, error: null });
    return query;
  };
  return {
    events,
    setScenario(scenarioId: SimulationScenario["id"]) {
      activeScenario = scenarioId;
      activeMessages = historyByScenario.get(scenarioId)!;
    },
    resetScenario(scenarioId: SimulationScenario["id"]) {
      historyByScenario.set(scenarioId, []);
      activeScenario = scenarioId;
      activeMessages = historyByScenario.get(scenarioId)!;
    },
    getHistory(scenarioId: SimulationScenario["id"]) {
      return [...(historyByScenario.get(scenarioId) || [])];
    },
    setActiveMessages(nextMessages: Array<Record<string, unknown>>) {
      activeMessages = [...nextMessages];
      historyByScenario.set(activeScenario, activeMessages);
    },
    appendMessage(message: Record<string, unknown>) {
      activeMessages.push(message);
    },
    client: {
      from(table: string) {
        events.push(`from:${table}`);
        if (!allowedTables.has(table)) throw new Error(`UNEXPECTED_SUPABASE_OPERATION:${table}`);
        return makeQuery(table);
      },
      async rpc(name: string) {
        events.push(`rpc:${name}`);
        if (!allowedRpcs.has(name)) throw new Error(`UNEXPECTED_SUPABASE_OPERATION:${name}`);
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
  historyMessageCountAfterTurn?: number;
  historyContentsAfterTurn?: string[];
  modelRequested?: string;
  modelReturned?: string | null;
  callsThisTurn?: number;
  estimatedInputTokens?: number;
  effectiveInputTokens?: number;
  effectiveOutputTokens?: number;
  costUsd?: number;
  remainingCalls?: number;
  remainingInputTokens?: number;
  remainingOutputTokens?: number;
  interruptionReason?: string | null;
};

export type PreparedConversationRunnerArgs = {
  mode?: "simulated" | "simulated-real-path" | "real";
  authorization?: string;
  openaiDependencies?: {
    assistantClient: { responses: { create: (request: unknown) => Promise<unknown> } };
    salesClient: { responses: { create: (request: unknown) => Promise<unknown> } };
  };
  /** @deprecated Real mode must not receive arbitrary Supabase dependencies. */
  assistantDependencies?: AssistantReplyTestDependencies;
  /** @deprecated Real mode must not receive arbitrary Supabase dependencies. */
  salesDependencies?: { supabaseClient: unknown; openaiClient: { responses: { create: (request: unknown) => Promise<unknown> } } };
};

function createBudgetedOpenAIClient(
  client: { responses: { create: (request: unknown) => Promise<unknown> } },
  actor: "assistant" | "sales",
  shared: {
    calls: number;
    estimatedInputTokens: number;
    inputTokens: number;
    outputTokens: number;
    reservedOutputTokens: number;
    usageUnknown: boolean;
    interruptionReason: string | null;
    audit: Array<{ actor: "assistant" | "sales"; modelRequested: string; modelReturned: string | null; estimatedInputTokens: number; effectiveInputTokens: number; effectiveOutputTokens: number; costUsd: number }>;
  },
) {
  return {
    responses: {
      create: async (request: Record<string, unknown>) => {
        if (shared.usageUnknown) throw new Error("SIMULATION_USAGE_UNAVAILABLE");
        if (shared.calls >= budget.maxCalls) {
          shared.interruptionReason = "CALL_LIMIT_REACHED";
          throw new Error("SIMULATION_CALL_LIMIT_EXCEEDED");
        }
        const requestedOutput = typeof request.max_output_tokens === "number" ? request.max_output_tokens : budget.maxOutputTokensPerCall;
        if (requestedOutput <= 0 || requestedOutput > budget.maxOutputTokensPerCall) {
          shared.interruptionReason = "OUTPUT_LIMIT_REJECTED";
          throw new Error("SIMULATION_OUTPUT_LIMIT_EXCEEDED");
        }
        const requestedModel = pricingForModel(request.model);
        if (!requestedModel) {
          shared.interruptionReason = "MODEL_PRICE_OR_AUTHORIZATION_UNKNOWN";
          throw new Error("SIMULATION_MODEL_NOT_AUTHORIZED");
        }
        const estimatedInput = estimateInputTokens(request.input);
        if (shared.estimatedInputTokens + estimatedInput > budget.maxInputTokens) {
          shared.interruptionReason = "INPUT_BUDGET_REJECTED";
          throw new Error("SIMULATION_INPUT_LIMIT_EXCEEDED");
        }
        if (shared.outputTokens + shared.reservedOutputTokens + requestedOutput > budget.maxOutputTokens) {
          shared.interruptionReason = "OUTPUT_RESERVATION_REJECTED";
          throw new Error("SIMULATION_OUTPUT_LIMIT_EXCEEDED");
        }

        shared.calls += 1;
        shared.estimatedInputTokens += estimatedInput;
        shared.reservedOutputTokens += requestedOutput;
        try {
          const response = await client.responses.create({ ...request, max_output_tokens: requestedOutput });
          const usage = response && typeof response === "object" && "usage" in response
            ? (response as { usage?: { input_tokens?: unknown; output_tokens?: unknown } }).usage
            : null;
          const effectiveInput = usage && typeof usage.input_tokens === "number" ? usage.input_tokens : null;
          const effectiveOutput = usage && typeof usage.output_tokens === "number" ? usage.output_tokens : null;
          if (effectiveInput === null || effectiveOutput === null || effectiveInput < 0 || effectiveOutput < 0) {
            shared.usageUnknown = true;
            shared.interruptionReason = "USAGE_UNAVAILABLE";
            throw new Error("SIMULATION_USAGE_UNAVAILABLE");
          }
          if (effectiveOutput > requestedOutput) {
            shared.interruptionReason = "PROVIDER_OUTPUT_EXCEEDED_RESERVATION";
            throw new Error("SIMULATION_OUTPUT_LIMIT_EXCEEDED");
          }
          shared.inputTokens += effectiveInput;
          shared.outputTokens += effectiveOutput;
          const returnedModel = "model" in (response as object) ? (response as { model?: unknown }).model : null;
          if (returnedModel !== null && returnedModel !== undefined && !pricingForModel(returnedModel)) {
            shared.interruptionReason = "RETURNED_MODEL_PRICE_UNKNOWN";
            throw new Error("SIMULATION_MODEL_NOT_AUTHORIZED");
          }
          shared.audit.push({ actor, modelRequested: requestedModel.model, modelReturned: returnedModel == null ? null : pricingForModel(returnedModel)!.model, estimatedInputTokens: estimatedInput, effectiveInputTokens: effectiveInput, effectiveOutputTokens: effectiveOutput, costUsd: costUsd(requestedModel.model, effectiveInput, effectiveOutput) });
          return response;
        } finally {
          shared.reservedOutputTokens -= requestedOutput;
        }
      },
    },
  };
}

function generatedText(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    const candidate = output as Record<string, unknown>;
    for (const key of ["message", "reply", "reply_text", "text", "content", "aiText"]) {
      if (typeof candidate[key] === "string" && candidate[key]) return candidate[key] as string;
    }
  }
  return JSON.stringify(output);
}

function appendConversationMessage(
  supabase: ReturnType<typeof createFixtureSupabase>,
  scenario: SimulationScenario,
  turn: number,
  role: "user" | "assistant",
  content: string,
) {
  const context = scenarioFixtures[scenario.id];
  supabase.appendMessage({
    id: `${scenario.id}-${role}-message-${turn}`,
    organization_id: simulationFixtures.organization.id,
    store_id: simulationFixtures.store.id,
    conversation_id: context.conversationId,
    sender: role === "user" ? (scenario.actor === "sales" ? "user" : "human") : "assistant",
    sender_role: role === "user" ? (scenario.actor === "sales" ? "customer" : "responsible") : "assistant",
    content,
    direction: role === "user" ? "incoming" : "outgoing",
    message_type: "text",
    created_at: `2026-10-26T${String(8 + (turn - 1) * 2 + (role === "assistant" ? 1 : 0)).padStart(2, "0")}:00:00.000Z`,
  });
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
    if (args.assistantDependencies?.supabaseClient || args.salesDependencies?.supabaseClient) {
      throw new Error("REAL_SIMULATION_SUPABASE_INJECTION_FORBIDDEN");
    }
    if (!args.openaiDependencies?.assistantClient || !args.openaiDependencies.salesClient) {
      throw new Error("REAL_SIMULATION_OPENAI_DEPENDENCIES_REQUIRED");
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
      supabase.resetScenario(scenario.id);
      for (const [index, turn] of scenario.turns.entries()) {
        const message = {
          id: `${scenario.id}-user-message-${index + 1}`,
          organization_id: simulationFixtures.organization.id,
          store_id: simulationFixtures.store.id,
          conversation_id: scenarioFixtures[scenario.id].conversationId,
          sender: scenario.actor === "sales" ? "user" : "human",
          sender_role: scenario.actor === "sales" ? "customer" : "responsible",
          content: turn.userMessage,
          direction: "incoming",
          message_type: "text",
          created_at: `2026-10-26T${String(8 + index * 2).padStart(2, "0")}:00:00.000Z`,
        };
        supabase.appendMessage(message);
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
              conversationId: scenarioFixtures[scenario.id].conversationId,
              anchorMessageId: message.id,
              supabaseClient: supabase.client,
              openaiClient: salesClient,
            });
        appendConversationMessage(supabase, scenario, index + 1, "assistant", generatedText(output));
        const history = supabase.getHistory(scenario.id);
        records.push({ scenarioId: scenario.id, turn: index + 1, actor: scenario.actor, output, source: "simulated", modelCallsAfterTurn: assistantClient.calls.length + salesClient.calls.length, assistantCallsAfterTurn: assistantClient.calls.length, salesCallsAfterTurn: salesClient.calls.length, inputTokensAfterTurn: assistantClient.usage.inputTokens + salesClient.usage.inputTokens, outputTokensAfterTurn: assistantClient.usage.outputTokens + salesClient.usage.outputTokens, historyMessageCountAfterTurn: history.length, historyContentsAfterTurn: history.map((entry) => String(entry.content || "")) });
      }
    }
    return records;
  }

  const records: PreparedConversationRecord[] = [];
  const sharedUsage = { calls: 0, estimatedInputTokens: 0, inputTokens: 0, outputTokens: 0, reservedOutputTokens: 0, usageUnknown: false, interruptionReason: null as string | null, audit: [] as Array<{ actor: "assistant" | "sales"; modelRequested: string; modelReturned: string | null; estimatedInputTokens: number; effectiveInputTokens: number; effectiveOutputTokens: number; costUsd: number }> };
  const fixtureSupabase = createFixtureSupabase();
  const assistantInput = args.openaiDependencies?.assistantClient;
  const salesInput = args.openaiDependencies?.salesClient;
  const assistantDependencies = {
    supabaseClient: fixtureSupabase.client as unknown as AssistantReplyTestDependencies["supabaseClient"],
    openaiClient: createBudgetedOpenAIClient(assistantInput!, "assistant", sharedUsage),
    persistAssistantReply: async () => null,
    recordAssistantAiRun: async () => undefined,
  } as unknown as AssistantReplyTestDependencies;
  const salesDependencies = { supabaseClient: fixtureSupabase.client, openaiClient: createBudgetedOpenAIClient(salesInput!, "sales", sharedUsage) };
  for (const scenario of scenarios) {
    fixtureSupabase.resetScenario(scenario.id);
    for (const [index] of scenario.turns.entries()) {
      const turn = scenario.turns[index];
      const auditStart = sharedUsage.audit.length;
      appendConversationMessage(fixtureSupabase, scenario, index + 1, "user", turn.userMessage);
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
            conversationId: scenarioFixtures[scenario.id].conversationId,
            anchorMessageId: `${scenario.id}-user-message-${index + 1}`,
            supabaseClient: salesDependencies.supabaseClient,
            openaiClient: salesDependencies.openaiClient,
          });
      appendConversationMessage(fixtureSupabase, scenario, index + 1, "assistant", generatedText(output));
      const history = fixtureSupabase.getHistory(scenario.id);
      const turnAudit = sharedUsage.audit.slice(auditStart);
      const firstAudit = turnAudit[0] || null;
      records.push({
        scenarioId: scenario.id,
        turn: index + 1,
        actor: scenario.actor,
        output,
        source: "openai",
        historyMessageCountAfterTurn: history.length,
        historyContentsAfterTurn: history.map((entry) => String(entry.content || "")),
        modelRequested: firstAudit?.modelRequested || normalizeModel(scenario.actor === "assistant" ? process.env.ZION_AI_ASSISTANT_MODEL || "gpt-4.1-mini" : process.env.ZION_AI_SALES_MODEL || "gpt-4.1-mini"),
        modelReturned: firstAudit?.modelReturned || null,
        callsThisTurn: turnAudit.length,
        estimatedInputTokens: turnAudit.reduce((sum, item) => sum + item.estimatedInputTokens, 0),
        effectiveInputTokens: turnAudit.reduce((sum, item) => sum + item.effectiveInputTokens, 0),
        effectiveOutputTokens: turnAudit.reduce((sum, item) => sum + item.effectiveOutputTokens, 0),
        costUsd: turnAudit.reduce((sum, item) => sum + item.costUsd, 0),
        remainingCalls: budget.maxCalls - sharedUsage.calls,
        remainingInputTokens: budget.maxInputTokens - sharedUsage.estimatedInputTokens,
        remainingOutputTokens: budget.maxOutputTokens - sharedUsage.outputTokens - sharedUsage.reservedOutputTokens,
        interruptionReason: sharedUsage.interruptionReason,
      });
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
  assert.equal(totalCalls, 11);
  assert.equal(records.at(-1)?.assistantCallsAfterTurn, 5);
  assert.equal(records.at(-1)?.salesCallsAfterTurn, 6);
  assert.ok(totalCalls <= budget.maxCalls);
  assert.ok((records.at(-1)?.inputTokensAfterTurn || 0) <= budget.maxInputTokens);
  assert.ok((records.at(-1)?.outputTokensAfterTurn || 0) <= budget.maxOutputTokens);
});

test("prepared conversations preserve independent chronological histories", async () => {
  const ids = scenarios.map((scenario) => scenarioFixtures[scenario.id].conversationId);
  const threadIds = scenarios.map((scenario) => scenarioFixtures[scenario.id].threadId);
  assert.equal(new Set(ids).size, scenarios.length);
  assert.equal(new Set(threadIds).size, scenarios.length);

  const records = await executePreparedConversations({ mode: "simulated-real-path" });
  for (const scenario of scenarios) {
    const scenarioRecords = records.filter((record) => record.scenarioId === scenario.id);
    assert.deepEqual(scenarioRecords.map((record) => record.historyMessageCountAfterTurn), [2, 4, 6, 8]);
    for (const [index, record] of scenarioRecords.entries()) {
      const contents = record.historyContentsAfterTurn || [];
      assert.equal(contents[index * 2], scenario.turns[index].userMessage);
      assert.equal(contents[index * 2 + 1], generatedText(scenarioRecords[index].output));
      for (const other of scenarios.filter((candidate) => candidate.id !== scenario.id)) {
        assert.ok(!contents.includes(other.turns[0].userMessage));
      }
    }
    const secondTurn = scenarioRecords[1];
    assert.ok(secondTurn.historyContentsAfterTurn?.includes(scenario.turns[0].userMessage));
    assert.ok(secondTurn.historyContentsAfterTurn?.includes(generatedText(scenarioRecords[0].output)));
  }
});

test("prepared executor blocks real mode without both authorization gates", async () => {
  await assert.rejects(
    () => executePreparedConversations({ mode: "real" }),
    /REAL_SIMULATION_AUTHORIZATION_REQUIRED/,
  );
});

function newSharedUsage() {
  return {
    calls: 0,
    estimatedInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reservedOutputTokens: 0,
    usageUnknown: false,
    interruptionReason: null as string | null,
    audit: [] as Array<{ actor: "assistant" | "sales"; modelRequested: string; modelReturned: string | null; estimatedInputTokens: number; effectiveInputTokens: number; effectiveOutputTokens: number; costUsd: number }>,
  };
}

test("budget wrapper blocks payloads and output reservations before provider call", async () => {
  let providerCalls = 0;
  const shared = newSharedUsage();
  const client = createBudgetedOpenAIClient({
    responses: { create: async () => { providerCalls += 1; return { model: "gpt-4.1-mini", usage: { input_tokens: 1, output_tokens: 1 } }; } },
  }, "assistant", shared);
  await assert.rejects(() => client.responses.create({ model: "gpt-4.1-mini", input: "x".repeat(400_000), max_output_tokens: 1 }), /SIMULATION_INPUT_LIMIT_EXCEEDED/);
  shared.outputTokens = budget.maxOutputTokens - 100;
  await assert.rejects(() => client.responses.create({ model: "gpt-4.1-mini", input: "small", max_output_tokens: 200 }), /SIMULATION_OUTPUT_LIMIT_EXCEEDED/);
  assert.equal(providerCalls, 0);
  assert.equal(shared.calls, 0);
});

test("budget wrapper counts failed attempts, reconciles usage, and fails closed without usage", async () => {
  let providerCalls = 0;
  const shared = newSharedUsage();
  const failing = createBudgetedOpenAIClient({
    responses: { create: async () => { providerCalls += 1; throw new Error("temporary"); } },
  }, "sales", shared);
  await assert.rejects(() => failing.responses.create({ model: "gpt-4.1-mini", input: "retry", max_output_tokens: 10 }), /temporary/);
  assert.equal(shared.calls, 1);

  const noUsage = createBudgetedOpenAIClient({
    responses: { create: async () => { providerCalls += 1; return { model: "gpt-4.1-mini" }; } },
  }, "sales", shared);
  await assert.rejects(() => noUsage.responses.create({ model: "gpt-4.1-mini", input: "no usage", max_output_tokens: 10 }), /SIMULATION_USAGE_UNAVAILABLE/);
  await assert.rejects(() => noUsage.responses.create({ model: "gpt-4.1-mini", input: "retry", max_output_tokens: 10 }), /SIMULATION_USAGE_UNAVAILABLE/);
  assert.equal(shared.usageUnknown, true);
  assert.equal(providerCalls, 2);
});

test("budget wrapper rejects unknown models and records requested/returned pricing", async () => {
  const unknownShared = newSharedUsage();
  const unknown = createBudgetedOpenAIClient({ responses: { create: async () => ({}) } }, "assistant", unknownShared);
  await assert.rejects(() => unknown.responses.create({ model: "unpriced-model", input: "x", max_output_tokens: 10 }), /SIMULATION_MODEL_NOT_AUTHORIZED/);

  const shared = newSharedUsage();
  const known = createBudgetedOpenAIClient({
    responses: { create: async () => ({ model: "gpt-4.1-mini-2026", usage: { input_tokens: 7, output_tokens: 3 } }) },
  }, "assistant", shared);
  await known.responses.create({ model: "gpt-4.1-mini", input: "priced", max_output_tokens: 10 });
  assert.deepEqual(shared.audit[0], { actor: "assistant", modelRequested: "gpt-4.1-mini", modelReturned: "gpt-4.1-mini", estimatedInputTokens: estimateInputTokens("priced"), effectiveInputTokens: 7, effectiveOutputTokens: 3, costUsd: costUsd("gpt-4.1-mini", 7, 3) });
});

test("fixture Supabase rejects unknown tables, RPCs, and mutations", async () => {
  const supabase = createFixtureSupabase();
  assert.throws(() => supabase.client.from("production_secret"), /UNEXPECTED_SUPABASE_OPERATION/);
  await assert.rejects(() => supabase.client.rpc("cancel_store_appointment"), /UNEXPECTED_SUPABASE_OPERATION/);
  assert.throws(() => (supabase.client.from("messages") as { insert: () => unknown }).insert(), /UNEXPECTED_SUPABASE_OPERATION/);
});

test("real mode rejects arbitrary Supabase injection even with authorization", async () => {
  const previous = process.env.ZION_REAL_SIMULATION_AUTHORIZED;
  process.env.ZION_REAL_SIMULATION_AUTHORIZED = "1";
  try {
    await assert.rejects(
      () => executePreparedConversations({
        mode: "real",
        authorization: "REAL_SIMULATION_AUTHORIZED",
        assistantDependencies: {
          supabaseClient: Object.assign(createFailFastSupabase().client, { isMock: true }) as unknown as AssistantReplyTestDependencies["supabaseClient"],
          openaiClient: new BoundedSimulatedOpenAI("gpt-4.1-mini", [], budget) as unknown as AssistantReplyTestDependencies["openaiClient"],
          persistAssistantReply: async () => null,
          recordAssistantAiRun: async () => undefined,
        },
        openaiDependencies: {
          assistantClient: new BoundedSimulatedOpenAI("gpt-4.1-mini", [], budget) as unknown as { responses: { create: (request: unknown) => Promise<unknown> } },
          salesClient: new BoundedSimulatedOpenAI("gpt-4.1-mini", [], budget) as unknown as { responses: { create: (request: unknown) => Promise<unknown> } },
        },
      }),
      /REAL_SIMULATION_SUPABASE_INJECTION_FORBIDDEN/,
    );
  } finally {
    if (previous === undefined) delete process.env.ZION_REAL_SIMULATION_AUTHORIZED;
    else process.env.ZION_REAL_SIMULATION_AUTHORIZED = previous;
  }
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
  supabase.resetScenario("sales-1");
  appendConversationMessage(supabase, scenarios[2], 1, "user", scenarios[2].turns[0].userMessage);
  const model = new BoundedSimulatedOpenAI("gpt-4.1-mini", ["{\"reply_text\":\"Resposta simulada\",\"cross_sell_suggestions_included\":[]}"], budget);
  const result = await generateAiSalesReply({
    organizationId: simulationFixtures.organization.id,
    storeId: simulationFixtures.store.id,
    conversationId: scenarioFixtures["sales-1"].conversationId,
    anchorMessageId: "sales-1-user-message-1",
    supabaseClient: supabase.client,
    openaiClient: model,
  });
  assert.equal(result.ok, true, JSON.stringify({ result, events: supabase.events }));
  assert.ok(model.calls.length > 0);
  assert.ok(supabase.events.length > 0);
});

test("fixture supabase reaches the assistant generator without external services", async () => {
  const supabase = createFixtureSupabase();
  supabase.resetScenario("assistant-1");
  appendConversationMessage(supabase, scenarios[0], 1, "user", scenarios[0].turns[0].userMessage);
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
  assert.equal(result.ok, true, JSON.stringify({ result, events: supabase.events }));
  assert.ok(model.calls.length <= 1);
  assert.ok(supabase.events.length > 0);
});
