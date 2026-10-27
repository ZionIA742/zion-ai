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

type CommercialScenarioId =
  | "commercial-technical-visit"
  | "commercial-pump"
  | "commercial-cover"
  | "commercial-complete-pool"
  | "commercial-discount"
  | "commercial-change-request"
  | "commercial-human-takeover";

export type CommercialSimulationScenario = {
  id: CommercialScenarioId;
  actor: "sales";
  title: string;
  turns: SimulationTurn[];
  requiresTechnicalVisit: boolean;
  requiresContract: boolean;
  fixtureTechnicalVisitCompletedAfterTurn?: number;
};

type FixtureScenarioId = SimulationScenario["id"] | CommercialScenarioId;

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
  maxOutputTokensPerCall: 800,
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

/**
 * This commercial suite is intentionally separate from `budget`: it is a
 * local-only preparation for a future paid run, not an expansion of the
 * existing 32-call battery or of any production AI limit.
 */
export const commercialSimulationBudget: SimulationBudget = {
  maxCalls: 96,
  maxInputTokens: 1_200_000,
  maxOutputTokens: 96_000,
  maxOutputTokensPerCall: 1_200,
};

export const commercialSimulationMaxCostUsd = 1;

export const commercialSimulationScenarios: CommercialSimulationScenario[] = [
  {
    id: "commercial-technical-visit",
    actor: "sales",
    title: "Piscina com visita tecnica e pos-visita",
    requiresTechnicalVisit: true,
    requiresContract: true,
    fixtureTechnicalVisitCompletedAfterTurn: 6,
    turns: [
      { userMessage: "Quero uma piscina para o quintal.", simulatedReply: "Posso entender o espaco e o que voce espera da piscina?" },
      { userMessage: "Tenho um espaco de 4 por 7 metros em Campinas.", simulatedReply: "Com essas medidas, vamos considerar opcoes compativeis e confirmar os detalhes do local." },
      { userMessage: "Quero instalacao completa.", simulatedReply: "A instalacao pode ser avaliada com seguranca para esse espaco." },
      { userMessage: "Vocês fazem visita tecnica?", simulatedReply: "Posso verificar o procedimento e os horarios; ainda nao ha visita confirmada." },
      { userMessage: "Prefiro uma tarde na proxima semana.", simulatedReply: "Vou encaminhar essa preferencia para verificacao de disponibilidade." },
      { userMessage: "Pode considerar quarta a tarde.", simulatedReply: "A preferencia foi registrada apenas na fixture, sem confirmacao de agenda." },
      { userMessage: "A visita ja foi feita pela equipe e o acesso esta liberado.", simulatedReply: "Com a visita concluida pela equipe, podemos avancar com o orcamento." },
      { userMessage: "Qual modelo faz mais sentido agora?", simulatedReply: "Vou usar somente as opcoes do catalogo ficticio para orientar o proximo passo." },
      { userMessage: "Quero receber um orcamento com instalacao.", simulatedReply: "O orcamento deve ser preparado e confirmado, sem presumir aprovacao." },
      { userMessage: "Se a entrada couber no meu plano, podemos seguir.", simulatedReply: "Vamos alinhar as condicoes cadastradas e a proxima confirmacao comercial." },
    ],
  },
  {
    id: "commercial-pump",
    actor: "sales",
    title: "Venda de bomba de piscina",
    requiresTechnicalVisit: false,
    requiresContract: false,
    turns: [
      { userMessage: "Preciso trocar so a bomba da minha piscina.", simulatedReply: "Posso ajudar a verificar a compatibilidade sem supor especificacoes." },
      { userMessage: "Minha piscina tem cerca de 30 mil litros.", simulatedReply: "Essa informacao ajuda a orientar a consulta ao catalogo." },
      { userMessage: "A instalacao atual usa tubulacao de 50 mm.", simulatedReply: "Vou tratar a medida como dado tecnico a conferir, sem inventar adaptacao." },
      { userMessage: "A bomba Fluxo 1 CV serve?", simulatedReply: "Vou confirmar apenas os dados cadastrados para a Fluxo 1 CV." },
      { userMessage: "Quanto ela custa?", simulatedReply: "O preco deve vir do catalogo ficticio, nao de uma decisao da IA." },
      { userMessage: "Aceita Pix e cartao?", simulatedReply: "As formas de pagamento devem respeitar a configuracao ficticia." },
      { userMessage: "Nao preciso de visita tecnica.", simulatedReply: "Para este item, a fixture nao exige visita tecnica." },
      { userMessage: "Tambem nao quero contrato para uma bomba.", simulatedReply: "A fixture marca esta venda simples como sem contrato." },
      { userMessage: "Conseguem entregar em Campinas?", simulatedReply: "A entrega precisa ser confirmada pela loja, sem promessa automatica." },
      { userMessage: "Se estiver tudo certo, quero fechar.", simulatedReply: "O proximo passo e confirmar item e condicoes, sem venda presumida." },
    ],
  },
  {
    id: "commercial-cover",
    actor: "sales",
    title: "Venda de capa de piscina",
    requiresTechnicalVisit: false,
    requiresContract: false,
    turns: [
      { userMessage: "Quero uma capa para minha piscina.", simulatedReply: "Posso verificar a capa correta a partir das medidas." },
      { userMessage: "Ela mede 3 por 6 metros.", simulatedReply: "Vou manter essas dimensoes como referencia da conversa." },
      { userMessage: "Quero a capa termica Azul 3x6.", simulatedReply: "Vou procurar somente o item exato do catalogo ficticio." },
      { userMessage: "Ela cobre a piscina inteira?", simulatedReply: "A resposta deve usar apenas as caracteristicas cadastradas." },
      { userMessage: "Qual e o preco?", simulatedReply: "O valor deve vir do catalogo, sem preco arbitrario." },
      { userMessage: "No Pix melhora alguma coisa?", simulatedReply: "Qualquer condicao depende da politica ficticia cadastrada." },
      { userMessage: "Nao preciso de visita para isso.", simulatedReply: "A venda simples permanece sem visita tecnica." },
      { userMessage: "Tambem nao preciso de contrato.", simulatedReply: "A fixture nao cria etapa contratual para esta capa." },
      { userMessage: "Gostei, quero comprar uma.", simulatedReply: "Vamos confirmar item, medida e pagamento antes de avancar." },
      { userMessage: "Pode me passar o proximo passo?", simulatedReply: "O fechamento deve ser encaminhado sem confirmar pedido automaticamente." },
    ],
  },
  {
    id: "commercial-complete-pool",
    actor: "sales",
    title: "Venda completa de piscina",
    requiresTechnicalVisit: true,
    requiresContract: true,
    turns: [
      { userMessage: "Estou comparando uma Compacta 300 e uma Modelo 305.", simulatedReply: "Vou diferenciar os dois modelos conforme o catalogo ficticio." },
      { userMessage: "Meu terreno permite ate 4 por 7 metros.", simulatedReply: "Essa medida ajuda a comparar sem afirmar que a instalacao esta aprovada." },
      { userMessage: "Qual delas tem instalacao completa?", simulatedReply: "A instalacao deve respeitar a configuracao cadastrada e a verificacao do local." },
      { userMessage: "Quero a Modelo 305.", simulatedReply: "Vou manter o modelo escolhido como referencia mais recente." },
      { userMessage: "Quanto fica com instalacao?", simulatedReply: "O orcamento deve usar catalogo e condicoes cadastradas." },
      { userMessage: "Posso dar entrada e parcelar o restante?", simulatedReply: "As condicoes devem ser confirmadas, nao inventadas." },
      { userMessage: "E se eu der uma entrada maior?", simulatedReply: "A negociacao deve continuar dentro das regras ficticias." },
      { userMessage: "Precisa de contrato?", simulatedReply: "O contrato so e aplicavel porque esta configurado para esta venda completa." },
      { userMessage: "Quero seguir, mas ainda nao assinei nada.", simulatedReply: "Nenhuma assinatura ou aprovacao deve ser presumida." },
      { userMessage: "Qual e o proximo passo para fechar?", simulatedReply: "O proximo passo deve encaminhar a confirmacao comercial com seguranca." },
    ],
  },
  {
    id: "commercial-discount",
    actor: "sales",
    title: "Cliente insistente pedindo desconto",
    requiresTechnicalVisit: true,
    requiresContract: true,
    turns: [
      { userMessage: "Me da desconto numa piscina?", simulatedReply: "Primeiro preciso entender o modelo e o contexto antes de qualquer concessao." },
      { userMessage: "A concorrente cobra menos.", simulatedReply: "Vou defender o valor sem inventar desconto ou atacar concorrentes." },
      { userMessage: "Quero o menor preco possivel.", simulatedReply: "O preco cheio e as condicoes cadastradas devem vir antes de concessoes." },
      { userMessage: "Tenho espaco de 4 por 7 em Campinas.", simulatedReply: "Agora ha dados para qualificar o caso comercial." },
      { userMessage: "Estou olhando a Modelo 305 com instalacao.", simulatedReply: "Vou usar o modelo e a instalacao para orientar a proposta." },
      { userMessage: "Se eu pagar a vista voce reduz?", simulatedReply: "Qualquer contrapartida depende da politica ficticia, sem promessa." },
      { userMessage: "Quero mais desconto ainda.", simulatedReply: "A conversa deve respeitar o limite de duas concessoes por ciclo." },
      { userMessage: "Entao me da outra condicao.", simulatedReply: "Nao vou criar condicao fora da politica configurada." },
      { userMessage: "Por que vale esse valor?", simulatedReply: "A resposta deve defender a proposta por valor e escopo verificavel." },
      { userMessage: "Se estiver dentro das regras, podemos avancar.", simulatedReply: "O proximo passo deve validar a proposta, sem desconto inventado." },
    ],
  },
  {
    id: "commercial-change-request",
    actor: "sales",
    title: "Cliente indeciso que altera o pedido",
    requiresTechnicalVisit: true,
    requiresContract: true,
    turns: [
      { userMessage: "Quero uma Compacta 300.", simulatedReply: "Vou registrar a primeira preferencia na conversa." },
      { userMessage: "Meu espaco e 3 por 5 metros.", simulatedReply: "A medida fica como contexto para a opcao inicial." },
      { userMessage: "Pode preparar uma proposta?", simulatedReply: "Uma proposta pode ser encaminhada, sem aprovar automaticamente." },
      { userMessage: "Na verdade meu espaco e 4 por 7.", simulatedReply: "A medida mais recente deve prevalecer para a proxima proposta." },
      { userMessage: "Agora estou considerando a Modelo 305.", simulatedReply: "A nova opcao deve ficar separada da proposta anterior." },
      { userMessage: "Vou pensar e volto depois.", simulatedReply: "A conversa deve preservar o contexto sem pressionar fechamento." },
      { userMessage: "Voltei; quero alterar a proposta.", simulatedReply: "A alteracao deve criar um novo caminho, nao mutar um orcamento ja enviado." },
      { userMessage: "Quero a Modelo 305 com instalacao.", simulatedReply: "Vou usar o pedido mais recente para orientar a nova proposta." },
      { userMessage: "O orcamento anterior continua igual, certo?", simulatedReply: "A resposta deve reconhecer a imutabilidade da proposta anterior." },
      { userMessage: "Qual o proximo passo para a nova proposta?", simulatedReply: "O proximo passo deve pedir confirmacao sem inferir aprovacao." },
    ],
  },
  {
    id: "commercial-human-takeover",
    actor: "sales",
    title: "Cliente dificil, desistência e atendimento humano",
    requiresTechnicalVisit: false,
    requiresContract: false,
    turns: [
      { userMessage: "Quero saber de piscina, mas nao sei explicar.", simulatedReply: "Vou responder de forma objetiva e pedir somente o necessario." },
      { userMessage: "Qualquer uma serve, quanto custa?", simulatedReply: "Sem modelo definido, nao devo inventar preco ou especificacao." },
      { userMessage: "Achei tudo caro.", simulatedReply: "A resposta deve ser respeitosa e sem penalidade inventada." },
      { userMessage: "Sua concorrente e bem melhor.", simulatedReply: "Vou acolher a comparacao e manter objetividade." },
      { userMessage: "Quero cancelar essa negociacao.", simulatedReply: "O cancelamento deve ser encaminhado corretamente, sem multa ficticia." },
      { userMessage: "Nao me mande mais proposta automatica.", simulatedReply: "Nenhuma nova acao comercial automatica deve ser acionada." },
      { userMessage: "Quero falar com uma pessoa agora.", simulatedReply: "O takeover humano deve ser respeitado." },
      { userMessage: "Voce ainda esta tentando vender?", simulatedReply: "A IA nao deve insistir apos o pedido de atendimento humano." },
      { userMessage: "Pode so registrar minha reclamacao.", simulatedReply: "A resposta deve ser curta, respeitosa e sem prometer procedimento inexistente." },
      { userMessage: "Vou aguardar uma pessoa responder.", simulatedReply: "O atendimento humano permanece o proximo passo, sem novas acoes automaticas." },
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
    { id: "pool-compact", organization_id: "org-simulation", store_id: "store-simulation", name: "Compacta 300", description: "Piscina ficticia Compacta 300, para comparacao comercial local.", price: 18990, price_cents: 1899000, is_active: true, active: true, track_stock: false },
    { id: "pool-305", organization_id: "org-simulation", store_id: "store-simulation", name: "Modelo 305", description: "Piscina ficticia Modelo 305, para comparacao comercial local.", price: 24990, price_cents: 2499000, is_active: true, active: true, track_stock: false },
    { id: "pump-flow-1cv", organization_id: "org-simulation", store_id: "store-simulation", name: "Bomba Fluxo 1 CV", sku: "BOMBA-1CV-FICT", description: "Bomba ficticia de 1 CV; compatibilidade depende de confirmacao tecnica.", price: 129900, price_cents: 129900, is_active: true, active: true, track_stock: false },
    { id: "cover-thermal-3x6", organization_id: "org-simulation", store_id: "store-simulation", name: "Capa termica Azul 3x6", sku: "CAPA-TERM-3X6-FICT", description: "Capa termica ficticia para piscina de 3 por 6 metros.", price: 89900, price_cents: 89900, is_active: true, active: true, track_stock: false },
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
  "commercial-technical-visit": { threadId: "thread-commercial-technical-visit", conversationId: "conversation-commercial-technical-visit", leadId: "lead-commercial-technical-visit", opportunityId: "opportunity-commercial-technical-visit" },
  "commercial-pump": { threadId: "thread-commercial-pump", conversationId: "conversation-commercial-pump", leadId: "lead-commercial-pump", opportunityId: "opportunity-commercial-pump" },
  "commercial-cover": { threadId: "thread-commercial-cover", conversationId: "conversation-commercial-cover", leadId: "lead-commercial-cover", opportunityId: "opportunity-commercial-cover" },
  "commercial-complete-pool": { threadId: "thread-commercial-complete-pool", conversationId: "conversation-commercial-complete-pool", leadId: "lead-commercial-complete-pool", opportunityId: "opportunity-commercial-complete-pool" },
  "commercial-discount": { threadId: "thread-commercial-discount", conversationId: "conversation-commercial-discount", leadId: "lead-commercial-discount", opportunityId: "opportunity-commercial-discount" },
  "commercial-change-request": { threadId: "thread-commercial-change-request", conversationId: "conversation-commercial-change-request", leadId: "lead-commercial-change-request", opportunityId: "opportunity-commercial-change-request" },
  "commercial-human-takeover": { threadId: "thread-commercial-human-takeover", conversationId: "conversation-commercial-human-takeover", leadId: "lead-commercial-human-takeover", opportunityId: "opportunity-commercial-human-takeover" },
} as const satisfies Record<FixtureScenarioId, { threadId: string; conversationId: string; leadId: string; opportunityId?: string }>;

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
  const allFixtureScenarioIds = [...scenarios, ...commercialSimulationScenarios].map((scenario) => scenario.id) as FixtureScenarioId[];
  const historyByScenario = new Map<FixtureScenarioId, Array<Record<string, unknown>>>(allFixtureScenarioIds.map((scenarioId) => [scenarioId, []]));
  const visitStateByScenario = new Map<FixtureScenarioId, "not_applicable" | "requested" | "completed">(
    allFixtureScenarioIds.map((scenarioId) => [
      scenarioId,
      scenarioId === "commercial-technical-visit" ? "requested" : "not_applicable",
    ]),
  );
  const humanTakeoverByScenario = new Map<FixtureScenarioId, boolean>(
    allFixtureScenarioIds.map((scenarioId) => [scenarioId, false]),
  );
  let activeScenario: FixtureScenarioId = "assistant-1";
  const contextStateByScenario = new Map<FixtureScenarioId, Array<Record<string, unknown>>>(
    allFixtureScenarioIds.map((scenarioId) => [scenarioId, []]),
  );
  let activeMessages = historyByScenario.get(activeScenario)!;
  const scenarioRows = (scenarioId: FixtureScenarioId) => {
    const context = scenarioFixtures[scenarioId];
    return {
      conversation: {
        ...simulationFixtures.conversation,
        id: context.conversationId,
        lead_id: context.leadId,
        is_human_active: humanTakeoverByScenario.get(scenarioId) === true,
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
    store_catalog_item_photos: [],
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
      store_assistant_context_state: contextStateByScenario.get(activeScenario) || [],
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
    if (table === "store_assistant_context_state") {
      const contextRows = contextStateByScenario.get(activeScenario)!;

      const requireScopedContext = (value: unknown) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("UNEXPECTED_SUPABASE_OPERATION:context_invalid_payload");
        }
        const payload = value as Record<string, unknown>;
        if (
          payload.organization_id !== simulationFixtures.organization.id ||
          payload.store_id !== simulationFixtures.store.id ||
          payload.thread_id !== current.thread.id
        ) {
          throw new Error("UNEXPECTED_SUPABASE_OPERATION:context_wrong_scope");
        }
        return payload;
      };

      query.insert = (value: unknown) => {
        const payload = requireScopedContext(value);
        if (contextRows.length !== 0) {
          throw new Error("UNEXPECTED_SUPABASE_OPERATION:context_duplicate_insert");
        }
        contextRows.push({ ...payload, id: `fixture-context-${activeScenario}` });
        events.push(`memory:${table}.insert`);
        return query;
      };

      query.update = (value: unknown) => {
        const payload = requireScopedContext(value);
        if (contextRows.length !== 1) {
          throw new Error("UNEXPECTED_SUPABASE_OPERATION:context_update_without_row");
        }
        if (payload.id && payload.id !== contextRows[0].id) {
          throw new Error("UNEXPECTED_SUPABASE_OPERATION:context_wrong_id");
        }
        contextRows[0] = { ...contextRows[0], ...payload };
        events.push(`memory:${table}.update`);
        return query;
      };
    }

    query.maybeSingle = async () => ({ data: data[0] || null, error: null });
    query.then = (resolve: (value: unknown) => unknown) => resolve({ data, error: null });
    return query;
  };
  return {
    events,
    setScenario(scenarioId: FixtureScenarioId) {
      activeScenario = scenarioId;
      activeMessages = historyByScenario.get(scenarioId)!;
    },
    resetScenario(scenarioId: FixtureScenarioId) {
      historyByScenario.set(scenarioId, []);
      contextStateByScenario.set(scenarioId, []);
      visitStateByScenario.set(scenarioId, scenarioId === "commercial-technical-visit" ? "requested" : "not_applicable");
      humanTakeoverByScenario.set(scenarioId, false);
      activeScenario = scenarioId;
      activeMessages = historyByScenario.get(scenarioId)!;
    },
    getHistory(scenarioId: FixtureScenarioId) {
      return [...(historyByScenario.get(scenarioId) || [])];
    },
    getFixtureTechnicalVisitState(scenarioId: FixtureScenarioId) {
      return visitStateByScenario.get(scenarioId) || "not_applicable";
    },
    completeFixtureTechnicalVisit(scenarioId: FixtureScenarioId) {
      if (scenarioId !== "commercial-technical-visit" || visitStateByScenario.get(scenarioId) !== "requested") {
        throw new Error("UNEXPECTED_FIXTURE_VISIT_STATE_CHANGE");
      }
      visitStateByScenario.set(scenarioId, "completed");
      events.push(`fixture_only:technical_visit.completed:${scenarioId}`);
    },
    activateFixtureHumanTakeover(scenarioId: FixtureScenarioId) {
      if (scenarioId !== "commercial-human-takeover") {
        throw new Error("UNEXPECTED_FIXTURE_HUMAN_TAKEOVER");
      }
      humanTakeoverByScenario.set(scenarioId, true);
      events.push(`fixture_only:human_takeover.active:${scenarioId}`);
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
  scenario: Pick<SimulationScenario, "id" | "actor"> | CommercialSimulationScenario,
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

export type CommercialSimulationRecord = {
  scenarioId: CommercialScenarioId;
  turn: number;
  output: unknown;
  historyContentsAfterTurn: string[];
  simulatedCallsAfterTurn: number;
  simulatedCallsThisScenario: number;
  fixtureTechnicalVisitState: "not_applicable" | "requested" | "completed";
  humanTakeoverActive: boolean;
  generatorInvoked: boolean;
  source: "simulated" | "openai" | "fixture_guard";
  callsThisTurn: number;
  inputTokensThisTurn: number;
  outputTokensThisTurn: number;
  costUsdThisTurn: number;
};

export type CommercialSimulationRunnerArgs = {
  mode?: "simulated" | "real";
  authorization?: string;
  openaiClient?: { responses: { create: (request: unknown) => Promise<unknown> } };
  supabaseClient?: unknown;
};

export type CommercialSimulationRunReport = {
  mode: "simulated" | "real";
  source: "simulated" | "openai";
  model: string;
  pricing: { inputUsdPer1M: number; outputUsdPer1M: number };
  plannedTurns: number;
  potentialCalls: number;
  totals: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
  scenarios: CommercialSimulationRecord[];
  technicalEvaluation: "validated_fixture_invariants" | "not_evaluated";
  commercialEvaluation: "not_evaluated";
  aborted?: { scenarioId: string; turn: number; cause: string; cumulative: { calls: number; inputTokens: number; outputTokens: number; costUsd: number } };
};

export const futureCommercialQualityReportTemplate = {
  technical: ["generator_path", "history_continuity", "catalog_and_configuration_scope", "external_effect_blocking"],
  commercial: ["request_understanding", "memory_and_continuity", "naturalness", "catalog_precision", "price_and_payment_terms", "technical_visit_and_post_visit", "contract_applicability", "discount_and_negotiation", "closing"],
} as const;

/**
 * Executes only the real sales generator with local, in-memory fixtures and
 * a simulated Responses client. It intentionally does not judge sales quality:
 * that is reserved for a future paid, human-reviewed battery.
 */
type CommercialUsage = ReturnType<typeof newSharedUsage> & { costUsd: number };

function createCommercialBudgetedOpenAIClient(
  client: { responses: { create: (request: unknown) => Promise<unknown> } },
  usage: CommercialUsage,
) {
  return {
    responses: {
      create: async (request: Record<string, unknown>) => {
        if (usage.calls >= commercialSimulationBudget.maxCalls) throw new Error("COMMERCIAL_CALL_LIMIT_EXCEEDED");
        const model = pricingForModel(request.model);
        if (!model) throw new Error("COMMERCIAL_MODEL_NOT_AUTHORIZED");
        const requestedOutput = typeof request.max_output_tokens === "number" ? request.max_output_tokens : commercialSimulationBudget.maxOutputTokensPerCall;
        if (requestedOutput <= 0 || requestedOutput > commercialSimulationBudget.maxOutputTokensPerCall) throw new Error("COMMERCIAL_OUTPUT_LIMIT_EXCEEDED");
        const estimatedInput = JSON.stringify(request.input ?? null).length + 1_024;
        const projectedInput = usage.estimatedInputTokens + estimatedInput;
        const projectedOutput = usage.outputTokens + requestedOutput;
        const projectedCost = costUsd(model.model, projectedInput, projectedOutput);
        if (projectedInput > commercialSimulationBudget.maxInputTokens || projectedOutput > commercialSimulationBudget.maxOutputTokens || projectedCost > commercialSimulationMaxCostUsd) {
          throw new Error("COMMERCIAL_FINANCIAL_LIMIT_EXCEEDED");
        }
        usage.calls += 1;
        usage.estimatedInputTokens += estimatedInput;
        const response = await client.responses.create({ ...request, max_output_tokens: requestedOutput });
        const responseObject = response && typeof response === "object" ? response as { usage?: { input_tokens?: unknown; output_tokens?: unknown }; model?: unknown } : null;
        const inputTokens = responseObject?.usage?.input_tokens;
        const outputTokens = responseObject?.usage?.output_tokens;
        if (typeof inputTokens !== "number" || typeof outputTokens !== "number" || inputTokens < 0 || outputTokens < 0 || outputTokens > requestedOutput) throw new Error("COMMERCIAL_USAGE_INVALID");
        const returned = responseObject?.model == null ? model.model : pricingForModel(responseObject.model);
        if (!returned) throw new Error("COMMERCIAL_RETURNED_MODEL_NOT_AUTHORIZED");
        usage.inputTokens += inputTokens;
        usage.outputTokens += outputTokens;
        usage.costUsd += costUsd(model.model, inputTokens, outputTokens);
        if (usage.costUsd > commercialSimulationMaxCostUsd) throw new Error("COMMERCIAL_FINANCIAL_LIMIT_EXCEEDED");
        return response;
      },
    },
  };
}

export async function executeCommercialSimulationScenarios(args: CommercialSimulationRunnerArgs = {}): Promise<CommercialSimulationRecord[]> {
  const mode = args.mode || "simulated";
  if (mode === "real") {
    if (args.authorization !== "REAL_COMMERCIAL_SIMULATION_AUTHORIZED" || process.env.ZION_REAL_COMMERCIAL_SIMULATION_AUTHORIZED !== "1") throw new Error("COMMERCIAL_REAL_AUTHORIZATION_REQUIRED");
    if (args.supabaseClient) throw new Error("COMMERCIAL_REAL_SUPABASE_INJECTION_FORBIDDEN");
    if (!args.openaiClient) throw new Error("COMMERCIAL_REAL_OPENAI_DEPENDENCY_REQUIRED");
  }
  const supabase = createFixtureSupabase();
  const salesReply = "{\"reply_text\":\"Resposta comercial simulada e segura.\",\"cross_sell_suggestions_included\":[]}";
  const model = new BoundedSimulatedOpenAI(
    "gpt-4.1-mini",
    Array.from({ length: commercialSimulationBudget.maxCalls }, () => salesReply),
    commercialSimulationBudget,
  );
  const usage = { ...newSharedUsage(), costUsd: 0 } as CommercialUsage;
  const realClient = mode === "real" ? createCommercialBudgetedOpenAIClient(args.openaiClient!, usage) : model;
  const records: CommercialSimulationRecord[] = [];

  for (const scenario of commercialSimulationScenarios) {
    supabase.resetScenario(scenario.id);
    const callsBeforeScenario = model.calls.length;
    for (const [index, turn] of scenario.turns.entries()) {
      if (scenario.fixtureTechnicalVisitCompletedAfterTurn === index) {
        supabase.completeFixtureTechnicalVisit(scenario.id);
      }
      if (scenario.id === "commercial-human-takeover" && index === 7) {
        supabase.activateFixtureHumanTakeover(scenario.id);
      }

      appendConversationMessage(supabase, scenario, index + 1, "user", turn.userMessage);
      const generatorInvoked = !(scenario.id === "commercial-human-takeover" && index >= 7);
      let output: unknown;
      try {
        output = generatorInvoked
          ? await generateAiSalesReply({
              organizationId: simulationFixtures.organization.id,
              storeId: simulationFixtures.store.id,
              conversationId: scenarioFixtures[scenario.id].conversationId,
              anchorMessageId: `${scenario.id}-user-message-${index + 1}`,
              supabaseClient: supabase.client,
              openaiClient: realClient,
            })
          : { ok: true, message: "Automacao bloqueada: takeover humano ativo.", blockedByHumanTakeover: true };
        assertSimulationTurnSucceeded(output, scenario.id, index + 1);
      } catch (error) {
        const cause = String(error instanceof Error ? error.message : error).replace(/[\r\n]/g, " ").slice(0, 180);
        throw new Error(`COMMERCIAL_TURN_FAILED:${scenario.id}:${index + 1}:${cause}:calls=${usage.calls}:input=${usage.inputTokens}:output=${usage.outputTokens}:cost=${usage.costUsd.toFixed(6)}`);
      }
      appendConversationMessage(supabase, scenario, index + 1, "assistant", generatedText(output));
      const history = supabase.getHistory(scenario.id);
      records.push({
        scenarioId: scenario.id,
        turn: index + 1,
        output,
        historyContentsAfterTurn: history.map((entry) => String(entry.content || "")),
        simulatedCallsAfterTurn: model.calls.length,
        simulatedCallsThisScenario: model.calls.length - callsBeforeScenario,
        fixtureTechnicalVisitState: supabase.getFixtureTechnicalVisitState(scenario.id),
        humanTakeoverActive: scenario.id === "commercial-human-takeover" && index >= 7,
        generatorInvoked,
        source: generatorInvoked ? (mode === "real" ? "openai" : "simulated") : "fixture_guard",
        callsThisTurn: mode === "real" ? usage.calls - (records.reduce((sum, record) => sum + record.callsThisTurn, 0)) : model.calls.length - callsBeforeScenario - records.filter((record) => record.scenarioId === scenario.id).reduce((sum, record) => sum + record.callsThisTurn, 0),
        inputTokensThisTurn: mode === "real" ? usage.inputTokens - records.reduce((sum, record) => sum + record.inputTokensThisTurn, 0) : 0,
        outputTokensThisTurn: mode === "real" ? usage.outputTokens - records.reduce((sum, record) => sum + record.outputTokensThisTurn, 0) : 0,
        costUsdThisTurn: mode === "real" ? usage.costUsd - records.reduce((sum, record) => sum + record.costUsdThisTurn, 0) : 0,
      });
    }
  }
  return records;
}

export function buildCommercialSimulationRunReport(
  records: CommercialSimulationRecord[],
  mode: "simulated" | "real" = "simulated",
  aborted?: CommercialSimulationRunReport["aborted"],
): CommercialSimulationRunReport {
  const configuredModel = normalizeModel(process.env.ZION_AI_SALES_MODEL || "gpt-4.1-mini");
  const priced = pricingForModel(configuredModel);
  if (!priced) throw new Error("COMMERCIAL_MODEL_NOT_AUTHORIZED");
  const totals = records.reduce((sum, record) => ({
    calls: sum.calls + record.callsThisTurn,
    inputTokens: sum.inputTokens + record.inputTokensThisTurn,
    outputTokens: sum.outputTokens + record.outputTokensThisTurn,
    costUsd: sum.costUsd + record.costUsdThisTurn,
  }), { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
  return {
    mode,
    source: mode === "real" ? "openai" : "simulated",
    model: priced.model,
    pricing: priced.pricing,
    plannedTurns: commercialSimulationScenarios.reduce((sum, scenario) => sum + scenario.turns.length, 0),
    potentialCalls: commercialSimulationBudget.maxCalls,
    totals,
    scenarios: records,
    technicalEvaluation: mode === "real" ? "validated_fixture_invariants" : "not_evaluated",
    commercialEvaluation: "not_evaluated",
    ...(aborted ? { aborted } : {}),
  };
}

export async function executeCommercialSimulationRun(args: CommercialSimulationRunnerArgs = {}): Promise<CommercialSimulationRunReport> {
  try {
    const records = await executeCommercialSimulationScenarios(args);
    return buildCommercialSimulationRunReport(records, args.mode || "simulated");
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    const match = message.match(/^COMMERCIAL_TURN_FAILED:([^:]+):(\d+):(.+):calls=(\d+):input=(\d+):output=(\d+):cost=([0-9.]+)$/);
    if (!match) throw error;
    const [, scenarioId, turn, cause, calls, inputTokens, outputTokens, cost] = match;
    return buildCommercialSimulationRunReport([], args.mode || "simulated", {
      scenarioId,
      turn: Number(turn),
      cause,
      cumulative: { calls: Number(calls), inputTokens: Number(inputTokens), outputTokens: Number(outputTokens), costUsd: Number(cost) },
    });
  }
}

/**
 * Local-only executor. Real mode never creates clients: it requires both an
 * explicit argument and a process-local authorization marker, plus injected
 * dependencies. Thus the default path cannot call OpenAI or Supabase.
 */
function assertSimulationTurnSucceeded(
  output: unknown,
  scenarioId: string,
  turnNumber: number,
): void {
  if (
    output &&
    typeof output === "object" &&
    "ok" in output &&
    output.ok === true
  ) {
    return;
  }

  const failure = output && typeof output === "object"
    ? output as { error?: unknown; message?: unknown }
    : null;

  const reason = String(
    failure?.error || failure?.message || "INVALID_GENERATOR_RESULT",
  ).replace(/[\r\n]/g, " ").slice(0, 140);

  throw new Error(
    `SIMULATION_TURN_FAILED:${scenarioId}:${turnNumber}:${reason}`,
  );
}
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
        assertSimulationTurnSucceeded(output, scenario.id, index + 1);
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
      assertSimulationTurnSucceeded(output, scenario.id, index + 1);
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

test("a generator failure cannot be reported as a successful simulation turn", () => {
  assert.doesNotThrow(() =>
    assertSimulationTurnSucceeded(
      { ok: true, aiText: "Resposta valida" },
      "sales-1",
      1,
    ),
  );

  assert.throws(
    () => assertSimulationTurnSucceeded(
      { ok: false, error: "GENERATE_AI_SALES_REPLY_FAILED" },
      "sales-1",
      2,
    ),
    /SIMULATION_TURN_FAILED:sales-1:2:GENERATE_AI_SALES_REPLY_FAILED/,
  );

  assert.throws(
    () => assertSimulationTurnSucceeded(
      { error: "ASSISTANT_REPLY_ROUTE_FAILED" },
      "assistant-2",
      1,
    ),
    /SIMULATION_TURN_FAILED:assistant-2:1/,
  );
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
  assert.ok(
    records.every((record) =>
      record.output !== null &&
      typeof record.output === "object" &&
      "ok" in record.output &&
      record.output.ok === true
    ),
    "SIMULATION_TURN_FAILED",
  );
  const totalCalls = records.at(-1)?.modelCallsAfterTurn || 0;
  assert.equal(totalCalls, 10);
  assert.equal(records.at(-1)?.assistantCallsAfterTurn, 2);
  assert.equal(records.at(-1)?.salesCallsAfterTurn, 8);
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

test("seven commercial sales scenarios execute seventy fixture-only turns through the real generator", async () => {
  assert.equal(commercialSimulationScenarios.length, 7);
  assert.deepEqual(commercialSimulationScenarios.map((scenario) => scenario.turns.length), [10, 10, 10, 10, 10, 10, 10]);
  assert.equal(commercialSimulationScenarios.flatMap((scenario) => scenario.turns).length, 70);
  assert.equal(new Set(commercialSimulationScenarios.map((scenario) => scenarioFixtures[scenario.id].conversationId)).size, 7);
  assert.equal(new Set(commercialSimulationScenarios.map((scenario) => scenarioFixtures[scenario.id].leadId)).size, 7);
  assert.equal(new Set(commercialSimulationScenarios.map((scenario) => scenarioFixtures[scenario.id].opportunityId)).size, 7);

  const records = await executeCommercialSimulationScenarios();
  assert.equal(records.length, 70);
  assert.ok(records.every((record) => record.output && typeof record.output === "object" && "ok" in record.output && record.output.ok === true));
  assert.ok(records.every((record) => record.simulatedCallsAfterTurn <= commercialSimulationBudget.maxCalls));

  for (const scenario of commercialSimulationScenarios) {
    const scenarioRecords = records.filter((record) => record.scenarioId === scenario.id);
    assert.equal(scenarioRecords.length, 10);
    assert.ok(scenarioRecords.at(-1)!.simulatedCallsThisScenario <= scenario.turns.length);
    for (const [index, record] of scenarioRecords.entries()) {
      assert.equal(record.historyContentsAfterTurn.length, (index + 1) * 2);
      assert.equal(record.historyContentsAfterTurn[index * 2], scenario.turns[index].userMessage);
      assert.equal(record.historyContentsAfterTurn[index * 2 + 1], generatedText(record.output));
      if (index > 0) assert.ok(record.historyContentsAfterTurn.includes(scenario.turns[index - 1].userMessage));
      assert.ok(!record.historyContentsAfterTurn.includes(commercialSimulationScenarios.find((other) => other.id !== scenario.id)!.turns[0].userMessage));
    }
  }
  assert.deepEqual(
    commercialSimulationScenarios.map((scenario) => records.filter((record) => record.scenarioId === scenario.id).at(-1)!.simulatedCallsThisScenario),
    [10, 10, 10, 10, 10, 10, 7],
  );
  assert.equal(records.at(-1)!.simulatedCallsAfterTurn, 67);

  const visitRecords = records.filter((record) => record.scenarioId === "commercial-technical-visit");
  assert.equal(visitRecords[5].fixtureTechnicalVisitState, "requested");
  assert.equal(visitRecords[6].fixtureTechnicalVisitState, "completed");
  assert.equal(visitRecords[6].historyContentsAfterTurn.includes("A visita ja foi feita pela equipe e o acesso esta liberado."), true);

  const takeoverRecords = records.filter((record) => record.scenarioId === "commercial-human-takeover");
  assert.equal(takeoverRecords[6].humanTakeoverActive, false);
  assert.equal(takeoverRecords[7].humanTakeoverActive, true);
  assert.deepEqual(takeoverRecords.map((record) => record.generatorInvoked), [true, true, true, true, true, true, true, false, false, false]);
  assert.equal(takeoverRecords.at(-1)!.simulatedCallsThisScenario, takeoverRecords[6].simulatedCallsThisScenario);

  assert.ok(simulationFixtures.catalog.some((item) => item.name === "Bomba Fluxo 1 CV" && item.price_cents === 129900));
  assert.ok(simulationFixtures.catalog.some((item) => item.name === "Capa termica Azul 3x6" && item.price_cents === 89900));
  assert.ok(records.every((record) => !generatedText(record.output).match(/R\$|desconto de|parcelas de/i)));
  assert.deepEqual(futureCommercialQualityReportTemplate.technical, ["generator_path", "history_continuity", "catalog_and_configuration_scope", "external_effect_blocking"]);
  assert.equal(futureCommercialQualityReportTemplate.commercial.length, 9);
});

test("prepared executor blocks real mode without both authorization gates", async () => {
  await assert.rejects(
    () => executePreparedConversations({ mode: "real" }),
    /REAL_SIMULATION_AUTHORIZATION_REQUIRED/,
  );
});

test("commercial real mode requires explicit authorization and never treats an API key as authorization", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousGate = process.env.ZION_REAL_COMMERCIAL_SIMULATION_AUTHORIZED;
  process.env.OPENAI_API_KEY = "intentionally-not-used";
  delete process.env.ZION_REAL_COMMERCIAL_SIMULATION_AUTHORIZED;
  try {
    await assert.rejects(
      () => executeCommercialSimulationScenarios({ mode: "real", openaiClient: { responses: { create: async () => ({}) } } }),
      /COMMERCIAL_REAL_AUTHORIZATION_REQUIRED/,
    );
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousGate === undefined) delete process.env.ZION_REAL_COMMERCIAL_SIMULATION_AUTHORIZED;
    else process.env.ZION_REAL_COMMERCIAL_SIMULATION_AUTHORIZED = previousGate;
  }
});

test("commercial report labels simulated output and reserves a separate paid ceiling", async () => {
  const records = await executeCommercialSimulationScenarios();
  const report = buildCommercialSimulationRunReport(records);
  assert.equal(report.source, "simulated");
  assert.equal(report.commercialEvaluation, "not_evaluated");
  assert.equal(report.plannedTurns, 70);
  assert.equal(report.potentialCalls, commercialSimulationBudget.maxCalls);
  assert.ok(report.totals.calls <= 67);
  assert.equal(commercialSimulationMaxCostUsd, 1);
});

test("commercial real path is connected to the generator with an injected simulated provider", async () => {
  const previous = process.env.ZION_REAL_COMMERCIAL_SIMULATION_AUTHORIZED;
  process.env.ZION_REAL_COMMERCIAL_SIMULATION_AUTHORIZED = "1";
  const provider = new BoundedSimulatedOpenAI(
    "gpt-4.1-mini",
    Array.from({ length: commercialSimulationBudget.maxCalls }, () => "{\"reply_text\":\"Resposta do provedor de teste.\",\"cross_sell_suggestions_included\":[]}"),
    commercialSimulationBudget,
  );
  try {
    const records = await executeCommercialSimulationScenarios({ mode: "real", authorization: "REAL_COMMERCIAL_SIMULATION_AUTHORIZED", openaiClient: provider });
    assert.equal(records.length, 70);
    assert.ok(records.filter((record) => record.source === "openai").length >= 63);
    assert.equal(provider.calls.length, 67);
  } finally {
    if (previous === undefined) delete process.env.ZION_REAL_COMMERCIAL_SIMULATION_AUTHORIZED;
    else process.env.ZION_REAL_COMMERCIAL_SIMULATION_AUTHORIZED = previous;
  }
});

test("commercial run report records the first technical failure with cumulative usage", async () => {
  const previous = process.env.ZION_REAL_COMMERCIAL_SIMULATION_AUTHORIZED;
  process.env.ZION_REAL_COMMERCIAL_SIMULATION_AUTHORIZED = "1";
  try {
    const report = await executeCommercialSimulationRun({
      mode: "real",
      authorization: "REAL_COMMERCIAL_SIMULATION_AUTHORIZED",
      openaiClient: { responses: { create: async () => { throw new Error("provider unavailable"); } } },
    });
    assert.equal(report.aborted?.scenarioId, "commercial-technical-visit");
    assert.equal(report.aborted?.turn, 1);
    assert.match(report.aborted?.cause || "", /GENERATE_AI_SALES_REPLY_FAILED/);
    assert.equal(report.aborted?.cumulative.calls, 1);
  } finally {
    if (previous === undefined) delete process.env.ZION_REAL_COMMERCIAL_SIMULATION_AUTHORIZED;
    else process.env.ZION_REAL_COMMERCIAL_SIMULATION_AUTHORIZED = previous;
  }
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

test("fixture context writes remain scoped and in memory", async () => {
  const fixture = createFixtureSupabase();
  fixture.setScenario("assistant-2");

  const payload = {
    organization_id: simulationFixtures.organization.id,
    store_id: simulationFixtures.store.id,
    thread_id: scenarioFixtures["assistant-2"].threadId,
    active_status: "active",
    context_payload: { simulated: true },
    candidate_options: [],
  };

  const contextTable = () => fixture.client.from("store_assistant_context_state") as Record<string, unknown>;

  const firstQuery = contextTable();
  const insert = firstQuery.insert as (value: Record<string, unknown>) => Record<string, unknown>;

  assert.throws(
    () => insert({ ...payload, thread_id: "wrong-thread" }),
    /UNEXPECTED_SUPABASE_OPERATION/,
  );

  const insertedQuery = insert(payload);
  const readInserted = insertedQuery.maybeSingle as () => Promise<{ data: Record<string, unknown> | null }>;
  const inserted = (await readInserted()).data;

  assert.equal(inserted?.thread_id, payload.thread_id);
  assert.equal(inserted?.active_status, "active");

  fixture.setScenario("assistant-1");
  const otherQuery = contextTable();
  const readOther = otherQuery.maybeSingle as () => Promise<{ data: unknown }>;
  assert.equal((await readOther()).data, null);

  fixture.setScenario("assistant-2");
  const updateQuery = contextTable();
  const update = updateQuery.update as (value: Record<string, unknown>) => Record<string, unknown>;
  const updatedQuery = update({ ...payload, active_status: "waiting_user_choice" });
  const readUpdated = updatedQuery.maybeSingle as () => Promise<{ data: Record<string, unknown> | null }>;

  assert.equal((await readUpdated()).data?.active_status, "waiting_user_choice");

  fixture.resetScenario("assistant-2");
  const resetQuery = contextTable();
  const readReset = resetQuery.maybeSingle as () => Promise<{ data: unknown }>;
  assert.equal((await readReset()).data, null);

  assert.ok(fixture.events.includes("memory:store_assistant_context_state.insert"));
  assert.ok(fixture.events.includes("memory:store_assistant_context_state.update"));
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
