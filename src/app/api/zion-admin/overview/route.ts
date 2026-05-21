import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

type StoreRow = {
  id: string;
  organization_id: string;
  name: string | null;
  created_at: string | null;
};

type OrganizationRow = {
  id: string;
  name: string | null;
  created_at: string | null;
  subscription_status: string | null;
};

type StoreMetricRow = {
  store_id: string | null;
};

type AiRunRow = {
  id: string;
  store_id: string | null;
  conversation_id: string | null;
  lead_id: string | null;
  model: string | null;
  status: string | null;
  error: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  tokens_prompt: number | string | null;
  tokens_completion: number | string | null;
  cost_usd: number | string | null;
  created_at: string | null;
  finished_at: string | null;
};

type AiUsageBreakdown = {
  salesChatUsd: number;
  assistantChatUsd: number;
  imageGenerationUsd: number;
  visualCatalogUsd: number;
  unclassifiedUsd: number;
};

type AiRunEvent = {
  id: string;
  model: string | null;
  status: string | null;
  error: string | null;
  createdAt: string | null;
  finishedAt: string | null;
};

type PendingIssueDetail = {
  id: string;
  source:
    | "ai_run_queue"
    | "ai_sales_action_queue"
    | "channel_whatsapp_inbox"
    | "store_configuration";
  label: string;
  storeId: string | null;
  error: string | null;
  occurredAt: string | null;
  processedAt: string | null;
  queueKey?: string | null;
  externalEventId?: string | null;
  conversationId?: string | null;
  leadId?: string | null;
  aiRunId?: string | null;
  nextAction?: string | null;
  actionKey?: string | null;
  provider?: string | null;
  inputPreview?: string | null;
  payloadPreview?: string | null;
};

type QueueMetricRow = {
  store_id: string | null;
  processed_at: string | null;
  processing_error: string | null;
};

type AiRunQueueIssueRow = QueueMetricRow & {
  id: string;
  lead_id: string | null;
  conversation_id: string | null;
  queue_key: string | null;
  input: Record<string, unknown> | null;
  enqueued_at: string | null;
};

type SalesActionQueueIssueRow = QueueMetricRow & {
  id: string;
  conversation_id: string | null;
  ai_run_id: string | null;
  next_action: string | null;
  action_key: string | null;
  payload: Record<string, unknown> | null;
  enqueued_at: string | null;
};

type WhatsappInboxIssueRow = QueueMetricRow & {
  id: string;
  provider: string | null;
  external_event_id: string | null;
  payload: Record<string, unknown> | null;
  received_at: string | null;
};

type StoreOnboardingConfigRow = {
  store_id: string | null;
  organization_id: string | null;
  status: string | null;
  completed_at: string | null;
  updated_at: string | null;
};

type StoreBooleanConfigRow = {
  store_id: string | null;
  organization_id: string | null;
};

type StoreAuthConfigRow = StoreBooleanConfigRow & {
  is_active: boolean | null;
};

type StoreCatalogConfigRow = StoreBooleanConfigRow & {
  is_active: boolean | null;
};

type TokenUsageBreakdown = {
  salesChatTokens: number;
  assistantChatTokens: number;
  imageGenerationTokens: number;
  visualCatalogTokens: number;
  unclassifiedTokens: number;
};

type StoreOverviewMetrics = {
  totalLeads: number;
  totalMessages: number;
  totalSalesAiMessages: number;
  totalAppointments: number;
  totalAssistantThreads: number;
  totalAssistantMessages: number;
  totalAiRuns: number;
  successfulAiRuns: number;
  failedAiRuns: number;
  totalTokensPrompt: number;
  totalTokensCompletion: number;
  totalTokens: number;
  tokensPromptToday: number;
  tokensCompletionToday: number;
  tokensToday: number;
  tokensPromptLast7Days: number;
  tokensCompletionLast7Days: number;
  tokensLast7Days: number;
  tokensPromptMonth: number;
  tokensCompletionMonth: number;
  tokensMonth: number;
  tokenBreakdownTotal: TokenUsageBreakdown;
  tokenBreakdownToday: TokenUsageBreakdown;
  tokenBreakdownLast7Days: TokenUsageBreakdown;
  tokenBreakdownMonth: TokenUsageBreakdown;
  totalCostUsd: number;
  costUsdToday: number;
  costUsdLast7Days: number;
  costUsdMonth: number;
  costBreakdownTotal: AiUsageBreakdown;
  costBreakdownToday: AiUsageBreakdown;
  costBreakdownLast7Days: AiUsageBreakdown;
  costBreakdownMonth: AiUsageBreakdown;
  lastAiRunAt: string | null;
  recentAiErrors: AiRunEvent[];
  recentAiSuccesses: AiRunEvent[];
  pendingIssueDetails: PendingIssueDetail[];
  configurationIssues: number;
  pendingAiRuns: number;
  aiRunQueueErrors: number;
  pendingSalesActions: number;
  salesActionErrors: number;
  pendingWhatsappEvents: number;
  whatsappErrors: number;
};

async function getAuthenticatedUser() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {
          // Route Handler: não alteramos cookies aqui.
        },
        remove() {
          // Route Handler: não alteramos cookies aqui.
        },
      },
    },
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

function getServiceSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase service role não configurada.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function getExactCount(
  supabase: ReturnType<typeof getServiceSupabaseClient>,
  table: string,
) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true });

  if (error) {
    return {
      count: null,
      error: error.message,
    };
  }

  return {
    count: count ?? 0,
    error: null,
  };
}

function toNumber(value: number | string | null | undefined) {
  const parsed = typeof value === "string" ? Number(value) : (value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed) : 0;
}

function createEmptyAiUsageBreakdown(): AiUsageBreakdown {
  return {
    salesChatUsd: 0,
    assistantChatUsd: 0,
    imageGenerationUsd: 0,
    visualCatalogUsd: 0,
    unclassifiedUsd: 0,
  };
}

function addCostToBreakdown(
  breakdown: AiUsageBreakdown,
  category: keyof AiUsageBreakdown,
  costUsd: number,
) {
  breakdown[category] += costUsd;
}

function sumAiUsageBreakdown(
  target: AiUsageBreakdown,
  source: AiUsageBreakdown,
) {
  target.salesChatUsd += source.salesChatUsd;
  target.assistantChatUsd += source.assistantChatUsd;
  target.imageGenerationUsd += source.imageGenerationUsd;
  target.visualCatalogUsd += source.visualCatalogUsd;
  target.unclassifiedUsd += source.unclassifiedUsd;
}

function roundAiUsageBreakdown(breakdown: AiUsageBreakdown): AiUsageBreakdown {
  return {
    salesChatUsd: Number(breakdown.salesChatUsd.toFixed(6)),
    assistantChatUsd: Number(breakdown.assistantChatUsd.toFixed(6)),
    imageGenerationUsd: Number(breakdown.imageGenerationUsd.toFixed(6)),
    visualCatalogUsd: Number(breakdown.visualCatalogUsd.toFixed(6)),
    unclassifiedUsd: Number(breakdown.unclassifiedUsd.toFixed(6)),
  };
}

function createEmptyTokenUsageBreakdown(): TokenUsageBreakdown {
  return {
    salesChatTokens: 0,
    assistantChatTokens: 0,
    imageGenerationTokens: 0,
    visualCatalogTokens: 0,
    unclassifiedTokens: 0,
  };
}

function addTokensToBreakdown(
  breakdown: TokenUsageBreakdown,
  category: keyof AiUsageBreakdown,
  tokens: number,
) {
  const map: Record<keyof AiUsageBreakdown, keyof TokenUsageBreakdown> = {
    salesChatUsd: "salesChatTokens",
    assistantChatUsd: "assistantChatTokens",
    imageGenerationUsd: "imageGenerationTokens",
    visualCatalogUsd: "visualCatalogTokens",
    unclassifiedUsd: "unclassifiedTokens",
  };

  breakdown[map[category]] += tokens;
}

function sumTokenUsageBreakdown(
  target: TokenUsageBreakdown,
  source: TokenUsageBreakdown,
) {
  target.salesChatTokens += source.salesChatTokens;
  target.assistantChatTokens += source.assistantChatTokens;
  target.imageGenerationTokens += source.imageGenerationTokens;
  target.visualCatalogTokens += source.visualCatalogTokens;
  target.unclassifiedTokens += source.unclassifiedTokens;
}

function roundTokenUsageBreakdown(
  breakdown: TokenUsageBreakdown,
): TokenUsageBreakdown {
  return {
    salesChatTokens: Math.round(breakdown.salesChatTokens),
    assistantChatTokens: Math.round(breakdown.assistantChatTokens),
    imageGenerationTokens: Math.round(breakdown.imageGenerationTokens),
    visualCatalogTokens: Math.round(breakdown.visualCatalogTokens),
    unclassifiedTokens: Math.round(breakdown.unclassifiedTokens),
  };
}

function createEmptyStoreMetrics(): StoreOverviewMetrics {
  return {
    totalLeads: 0,
    totalMessages: 0,
    totalSalesAiMessages: 0,
    totalAppointments: 0,
    totalAssistantThreads: 0,
    totalAssistantMessages: 0,
    totalAiRuns: 0,
    successfulAiRuns: 0,
    failedAiRuns: 0,
    totalTokensPrompt: 0,
    totalTokensCompletion: 0,
    totalTokens: 0,
    tokensPromptToday: 0,
    tokensCompletionToday: 0,
    tokensToday: 0,
    tokensPromptLast7Days: 0,
    tokensCompletionLast7Days: 0,
    tokensLast7Days: 0,
    tokensPromptMonth: 0,
    tokensCompletionMonth: 0,
    tokensMonth: 0,
    tokenBreakdownTotal: createEmptyTokenUsageBreakdown(),
    tokenBreakdownToday: createEmptyTokenUsageBreakdown(),
    tokenBreakdownLast7Days: createEmptyTokenUsageBreakdown(),
    tokenBreakdownMonth: createEmptyTokenUsageBreakdown(),
    totalCostUsd: 0,
    costUsdToday: 0,
    costUsdLast7Days: 0,
    costUsdMonth: 0,
    costBreakdownTotal: createEmptyAiUsageBreakdown(),
    costBreakdownToday: createEmptyAiUsageBreakdown(),
    costBreakdownLast7Days: createEmptyAiUsageBreakdown(),
    costBreakdownMonth: createEmptyAiUsageBreakdown(),
    lastAiRunAt: null,
    recentAiErrors: [],
    recentAiSuccesses: [],
    pendingIssueDetails: [],
    configurationIssues: 0,
    pendingAiRuns: 0,
    aiRunQueueErrors: 0,
    pendingSalesActions: 0,
    salesActionErrors: 0,
    pendingWhatsappEvents: 0,
    whatsappErrors: 0,
  };
}

function getStoreMetrics(
  metricsByStore: Map<string, StoreOverviewMetrics>,
  storeId: string | null | undefined,
) {
  const safeStoreId = String(storeId || "").trim();

  if (!safeStoreId) {
    return null;
  }

  const existing = metricsByStore.get(safeStoreId);

  if (existing) {
    return existing;
  }

  const next = createEmptyStoreMetrics();
  metricsByStore.set(safeStoreId, next);
  return next;
}

function incrementStoreCounter(args: {
  metricsByStore: Map<string, StoreOverviewMetrics>;
  storeId: string | null | undefined;
  key: keyof Pick<
    StoreOverviewMetrics,
    | "totalLeads"
    | "totalMessages"
    | "totalSalesAiMessages"
    | "totalAppointments"
    | "totalAssistantThreads"
    | "totalAssistantMessages"
  >;
}) {
  const metrics = getStoreMetrics(args.metricsByStore, args.storeId);

  if (!metrics) {
    return;
  }

  metrics[args.key] += 1;
}

function isErroredText(value: string | null | undefined) {
  return String(value || "").trim().length > 0;
}

function isPendingQueueItem(row: QueueMetricRow) {
  return !row.processed_at;
}

function applyQueueMetrics(args: {
  metricsByStore: Map<string, StoreOverviewMetrics>;
  rows: QueueMetricRow[];
  pendingKey: keyof Pick<
    StoreOverviewMetrics,
    "pendingAiRuns" | "pendingSalesActions" | "pendingWhatsappEvents"
  >;
  errorKey: keyof Pick<
    StoreOverviewMetrics,
    "aiRunQueueErrors" | "salesActionErrors" | "whatsappErrors"
  >;
}) {
  for (const row of args.rows) {
    const metrics = getStoreMetrics(args.metricsByStore, row.store_id);

    if (!metrics) {
      continue;
    }

    if (isPendingQueueItem(row)) {
      metrics[args.pendingKey] += 1;
    }

    if (isErroredText(row.processing_error)) {
      metrics[args.errorKey] += 1;
    }
  }
}

function stringifyPreview(value: unknown, maxLength = 320) {
  if (value == null) return null;

  let text = "";

  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }

  const normalized = text.replace(/\s+/g, " " ).trim();

  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;

  return `${normalized.slice(0, maxLength)}...`;
}

function shouldExposeIssueDetail(row: QueueMetricRow) {
  return isPendingQueueItem(row) || isErroredText(row.processing_error);
}

function pushPendingIssueDetail(
  metricsByStore: Map<string, StoreOverviewMetrics>,
  storeId: string | null | undefined,
  issue: PendingIssueDetail,
) {
  const metrics = getStoreMetrics(metricsByStore, storeId);

  if (!metrics) {
    return;
  }

  metrics.pendingIssueDetails.push(issue);
}

function pushStoreConfigurationIssue(
  metricsByStore: Map<string, StoreOverviewMetrics>,
  store: StoreRow,
  label: string,
  error: string,
) {
  const metrics = getStoreMetrics(metricsByStore, store.id);

  if (!metrics) {
    return;
  }

  metrics.configurationIssues += 1;
  metrics.pendingIssueDetails.push({
    id: `${store.id}:${label}`,
    source: "store_configuration",
    label,
    storeId: store.id,
    error,
    occurredAt: store.created_at,
    processedAt: null,
  });
}

function buildStoreKey(organizationId: string | null | undefined, storeId: string | null | undefined) {
  return `${String(organizationId || "").trim()}:${String(storeId || "").trim()}`;
}

function buildStoreKeySet(rows: StoreBooleanConfigRow[]) {
  const set = new Set<string>();

  for (const row of rows) {
    set.add(buildStoreKey(row.organization_id, row.store_id));
  }

  return set;
}

function applyStoreConfigurationIssues(args: {
  metricsByStore: Map<string, StoreOverviewMetrics>;
  stores: StoreRow[];
  onboardingRows: StoreOnboardingConfigRow[];
  responsibleRows: StoreBooleanConfigRow[];
  scheduleSettingsRows: StoreBooleanConfigRow[];
  discountSettingsRows: StoreBooleanConfigRow[];
  authSettingsRows: StoreAuthConfigRow[];
  catalogRows: StoreCatalogConfigRow[];
}) {
  const onboardingByStore = new Map<string, StoreOnboardingConfigRow>();
  const responsibleStoreKeys = buildStoreKeySet(args.responsibleRows);
  const scheduleSettingsStoreKeys = buildStoreKeySet(args.scheduleSettingsRows);
  const discountSettingsStoreKeys = buildStoreKeySet(args.discountSettingsRows);
  const activeAuthStoreKeys = buildStoreKeySet(
    args.authSettingsRows.filter((row) => row.is_active === true),
  );
  const activeCatalogCountsByStore = new Map<string, number>();

  for (const row of args.onboardingRows) {
    onboardingByStore.set(buildStoreKey(row.organization_id, row.store_id), row);
  }

  for (const row of args.catalogRows) {
    if (row.is_active !== true) continue;

    const key = buildStoreKey(row.organization_id, row.store_id);
    activeCatalogCountsByStore.set(key, (activeCatalogCountsByStore.get(key) || 0) + 1);
  }

  for (const store of args.stores) {
    const key = buildStoreKey(store.organization_id, store.id);
    const onboarding = onboardingByStore.get(key);
    const onboardingStatus = String(onboarding?.status || "").trim().toLowerCase();

    if (!onboarding || onboardingStatus !== "completed" || !onboarding.completed_at) {
      pushStoreConfigurationIssue(
        args.metricsByStore,
        store,
        "Onboarding não concluído",
        "A loja ainda não concluiu o onboarding obrigatório.",
      );
    }

    if (!responsibleStoreKeys.has(key)) {
      pushStoreConfigurationIssue(
        args.metricsByStore,
        store,
        "Responsável não cadastrado",
        "A loja ainda não tem responsável cadastrado para receber alertas e acompanhar a operação.",
      );
    }

    if (!scheduleSettingsStoreKeys.has(key)) {
      pushStoreConfigurationIssue(
        args.metricsByStore,
        store,
        "Agenda não configurada",
        "A loja ainda não tem configuração de agenda e horários de atendimento.",
      );
    }

    if (!discountSettingsStoreKeys.has(key)) {
      pushStoreConfigurationIssue(
        args.metricsByStore,
        store,
        "Configuração de desconto ausente",
        "A loja ainda não tem regra de desconto configurada.",
      );
    }

    if (!activeAuthStoreKeys.has(key)) {
      pushStoreConfigurationIssue(
        args.metricsByStore,
        store,
        "Configuração de acesso ausente",
        "A loja ainda não tem configuração de autenticação/acesso ativa.",
      );
    }

    if ((activeCatalogCountsByStore.get(key) || 0) <= 0) {
      pushStoreConfigurationIssue(
        args.metricsByStore,
        store,
        "Catálogo sem itens ativos",
        "A loja ainda não tem itens ativos no catálogo.",
      );
    }
  }
}

function applyPendingIssueDetails(args: {
  metricsByStore: Map<string, StoreOverviewMetrics>;
  aiRunQueueRows: AiRunQueueIssueRow[];
  salesActionQueueRows: SalesActionQueueIssueRow[];
  whatsappQueueRows: WhatsappInboxIssueRow[];
}) {
  for (const row of args.aiRunQueueRows) {
    if (!shouldExposeIssueDetail(row)) continue;

    pushPendingIssueDetail(args.metricsByStore, row.store_id, {
      id: row.id,
      source: "ai_run_queue",
      label: "Fila de IA",
      storeId: row.store_id,
      error: row.processing_error || (row.processed_at ? null : "Item ainda pendente de processamento"),
      occurredAt: row.enqueued_at,
      processedAt: row.processed_at,
      queueKey: row.queue_key,
      conversationId: row.conversation_id,
      leadId: row.lead_id,
      inputPreview: stringifyPreview(row.input),
    });
  }

  for (const row of args.salesActionQueueRows) {
    if (!shouldExposeIssueDetail(row)) continue;

    pushPendingIssueDetail(args.metricsByStore, row.store_id, {
      id: row.id,
      source: "ai_sales_action_queue",
      label: "Ações comerciais da IA",
      storeId: row.store_id,
      error: row.processing_error || (row.processed_at ? null : "Ação comercial ainda pendente de processamento"),
      occurredAt: row.enqueued_at,
      processedAt: row.processed_at,
      conversationId: row.conversation_id,
      aiRunId: row.ai_run_id,
      nextAction: row.next_action,
      actionKey: row.action_key,
      payloadPreview: stringifyPreview(row.payload),
    });
  }

  for (const row of args.whatsappQueueRows) {
    if (!shouldExposeIssueDetail(row)) continue;

    pushPendingIssueDetail(args.metricsByStore, row.store_id, {
      id: row.id,
      source: "channel_whatsapp_inbox",
      label: "WhatsApp de entrada",
      storeId: row.store_id,
      error: row.processing_error || (row.processed_at ? null : "Evento de WhatsApp ainda pendente de processamento"),
      occurredAt: row.received_at,
      processedAt: row.processed_at,
      provider: row.provider,
      externalEventId: row.external_event_id,
      payloadPreview: stringifyPreview(row.payload),
    });
  }
}

function getSaoPauloDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value || 0);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

function startOfSaoPauloDateUtc(year: number, month: number, day: number) {
  // São Paulo está em UTC-3. Usamos 03:00 UTC para representar 00:00 em America/Sao_Paulo.
  return new Date(Date.UTC(year, month - 1, day, 3, 0, 0, 0));
}

function addDaysToSaoPauloDate(
  year: number,
  month: number,
  day: number,
  amount: number,
) {
  const date = new Date(Date.UTC(year, month - 1, day + amount, 12, 0, 0, 0));
  return getSaoPauloDateParts(date);
}

function getPeriodBoundaries() {
  const nowParts = getSaoPauloDateParts(new Date());
  const startOfToday = startOfSaoPauloDateUtc(
    nowParts.year,
    nowParts.month,
    nowParts.day,
  );

  const noonForDay = new Date(
    Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day, 12, 0, 0, 0),
  );
  const dayOfWeek = noonForDay.getUTCDay();
  const mondayOffset = (dayOfWeek + 6) % 7;
  const weekParts = addDaysToSaoPauloDate(
    nowParts.year,
    nowParts.month,
    nowParts.day,
    -mondayOffset,
  );

  const startOfLast7Days = startOfSaoPauloDateUtc(
    weekParts.year,
    weekParts.month,
    weekParts.day,
  );
  const startOfMonth = startOfSaoPauloDateUtc(nowParts.year, nowParts.month, 1);

  return {
    startOfToday,
    startOfLast7Days,
    startOfMonth,
  };
}

function isOnOrAfter(value: string | null | undefined, boundary: Date) {
  if (!value) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return parsed >= boundary.getTime();
}

function stringifyForClassification(value: unknown) {
  if (!value) return "";

  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return String(value).toLowerCase();
  }
}

function classifyAiRunUsage(row: AiRunRow): keyof AiUsageBreakdown {
  const inputText = stringifyForClassification(row.input);
  const outputText = stringifyForClassification(row.output);
  const allText = `${inputText} ${outputText}`;

  if (
    allText.includes("pool_image_generation") ||
    allText.includes("image_generation") ||
    allText.includes("geracao_imagem") ||
    allText.includes("geração de imagem") ||
    allText.includes("montagem") ||
    allText.includes("piscina instalada")
  ) {
    return "imageGenerationUsd";
  }

  if (
    allText.includes("visual_catalog") ||
    allText.includes("visual-catalog") ||
    allText.includes("catalog_document") ||
    allText.includes("catalogo_visual") ||
    allText.includes("catálogo visual")
  ) {
    return "visualCatalogUsd";
  }

  if (
    allText.includes("assistant_chat") ||
    allText.includes("assistant_operational") ||
    allText.includes("operational_assistant") ||
    allText.includes("store_assistant") ||
    allText.includes("ia_assistente") ||
    allText.includes("assistant/reply")
  ) {
    return "assistantChatUsd";
  }

  if (
    allText.includes("ai_sales") ||
    allText.includes("sales_reply") ||
    allText.includes("generate-and-save-ai-sales-reply") ||
    allText.includes("internal_ai_sales_reply_bridge") ||
    (row.conversation_id && row.lead_id)
  ) {
    return "salesChatUsd";
  }

  return "unclassifiedUsd";
}

function compareIsoDateDesc(a: string | null, b: string | null) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  const aTime = Date.parse(a);
  const bTime = Date.parse(b);

  if (!Number.isFinite(aTime) && !Number.isFinite(bTime)) return 0;
  if (!Number.isFinite(aTime)) return 1;
  if (!Number.isFinite(bTime)) return -1;

  return bTime - aTime;
}

async function loadStoreIdRows(
  supabase: ReturnType<typeof getServiceSupabaseClient>,
  table: string,
): Promise<{ rows: StoreMetricRow[]; error: string | null }> {
  const { data, error } = await supabase.from(table).select("store_id");

  if (error) {
    return {
      rows: [],
      error: error.message,
    };
  }

  return {
    rows: (data ?? []) as StoreMetricRow[],
    error: null,
  };
}

async function loadSalesAiMessageRows(
  supabase: ReturnType<typeof getServiceSupabaseClient>,
): Promise<{ rows: StoreMetricRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("messages")
    .select("store_id")
    .eq("sender", "ai")
    .eq("direction", "outgoing")
    .is("deleted_at", null);

  if (error) {
    return {
      rows: [],
      error: error.message,
    };
  }

  return {
    rows: (data ?? []) as StoreMetricRow[],
    error: null,
  };
}

async function loadStoreOnboardingConfigRows(
  supabase: ReturnType<typeof getServiceSupabaseClient>,
): Promise<{ rows: StoreOnboardingConfigRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("store_onboarding")
    .select("store_id, organization_id, status, completed_at, updated_at");

  if (error) {
    return {
      rows: [],
      error: error.message,
    };
  }

  return {
    rows: (data ?? []) as StoreOnboardingConfigRow[],
    error: null,
  };
}

async function loadStoreBooleanConfigRows(
  supabase: ReturnType<typeof getServiceSupabaseClient>,
  table: string,
): Promise<{ rows: StoreBooleanConfigRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from(table)
    .select("store_id, organization_id");

  if (error) {
    return {
      rows: [],
      error: error.message,
    };
  }

  return {
    rows: (data ?? []) as StoreBooleanConfigRow[],
    error: null,
  };
}

async function loadStoreAuthConfigRows(
  supabase: ReturnType<typeof getServiceSupabaseClient>,
): Promise<{ rows: StoreAuthConfigRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("store_auth_settings")
    .select("store_id, organization_id, is_active");

  if (error) {
    return {
      rows: [],
      error: error.message,
    };
  }

  return {
    rows: (data ?? []) as StoreAuthConfigRow[],
    error: null,
  };
}

async function loadStoreCatalogConfigRows(
  supabase: ReturnType<typeof getServiceSupabaseClient>,
): Promise<{ rows: StoreCatalogConfigRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("store_catalog_items")
    .select("store_id, organization_id, is_active");

  if (error) {
    return {
      rows: [],
      error: error.message,
    };
  }

  return {
    rows: (data ?? []) as StoreCatalogConfigRow[],
    error: null,
  };
}

async function loadQueueRows(
  supabase: ReturnType<typeof getServiceSupabaseClient>,
  table: string,
): Promise<{ rows: QueueMetricRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from(table)
    .select("store_id, processed_at, processing_error");

  if (error) {
    return {
      rows: [],
      error: error.message,
    };
  }

  return {
    rows: (data ?? []) as QueueMetricRow[],
    error: null,
  };
}

async function loadAiRunQueueIssueRows(
  supabase: ReturnType<typeof getServiceSupabaseClient>,
): Promise<{ rows: AiRunQueueIssueRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("ai_run_queue")
    .select(
      "id, store_id, lead_id, conversation_id, queue_key, input, enqueued_at, processed_at, processing_error",
    );

  if (error) {
    return {
      rows: [],
      error: error.message,
    };
  }

  return {
    rows: (data ?? []) as AiRunQueueIssueRow[],
    error: null,
  };
}

async function loadSalesActionQueueIssueRows(
  supabase: ReturnType<typeof getServiceSupabaseClient>,
): Promise<{ rows: SalesActionQueueIssueRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("ai_sales_action_queue")
    .select(
      "id, store_id, conversation_id, ai_run_id, next_action, action_key, payload, enqueued_at, processed_at, processing_error",
    );

  if (error) {
    return {
      rows: [],
      error: error.message,
    };
  }

  return {
    rows: (data ?? []) as SalesActionQueueIssueRow[],
    error: null,
  };
}

async function loadWhatsappInboxIssueRows(
  supabase: ReturnType<typeof getServiceSupabaseClient>,
): Promise<{ rows: WhatsappInboxIssueRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("channel_whatsapp_inbox")
    .select(
      "id, store_id, provider, external_event_id, payload, received_at, processed_at, processing_error",
    );

  if (error) {
    return {
      rows: [],
      error: error.message,
    };
  }

  return {
    rows: (data ?? []) as WhatsappInboxIssueRow[],
    error: null,
  };
}

async function loadAiRunRows(
  supabase: ReturnType<typeof getServiceSupabaseClient>,
): Promise<{ rows: AiRunRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("ai_runs")
    .select(
      "id, store_id, conversation_id, lead_id, model, status, error, input, output, tokens_prompt, tokens_completion, cost_usd, created_at, finished_at",
    );

  if (error) {
    return {
      rows: [],
      error: error.message,
    };
  }

  return {
    rows: (data ?? []) as AiRunRow[],
    error: null,
  };
}

export async function GET() {
  try {
    const user = await getAuthenticatedUser();

    if (!user) {
      return NextResponse.json(
        {
          error: "Não autenticado.",
        },
        { status: 401 },
      );
    }

    const serviceSupabase = getServiceSupabaseClient();

    const { data: admin, error: adminError } = await serviceSupabase
      .from("zion_internal_admins")
      .select("id, role, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (adminError || !admin) {
      return NextResponse.json(
        {
          error: "Acesso interno não autorizado.",
        },
        { status: 403 },
      );
    }

    const [
      organizationsCount,
      storesCount,
      leadsCount,
      conversationsCount,
      messagesCount,
      appointmentsCount,
      assistantThreadsCount,
      assistantMessagesCount,
      organizationsResult,
      storesResult,
      leadRows,
      messageRows,
      salesAiMessageRows,
      appointmentRows,
      assistantThreadRows,
      assistantMessageRows,
      aiRunRows,
      aiRunQueueRows,
      salesActionQueueRows,
      whatsappQueueRows,
      aiRunQueueIssueRows,
      salesActionQueueIssueRows,
      whatsappIssueRows,
      onboardingConfigRows,
      responsibleConfigRows,
      scheduleSettingsConfigRows,
      discountSettingsConfigRows,
      authSettingsConfigRows,
      catalogConfigRows,
    ] = await Promise.all([
      getExactCount(serviceSupabase, "organizations"),
      getExactCount(serviceSupabase, "stores"),
      getExactCount(serviceSupabase, "leads"),
      getExactCount(serviceSupabase, "conversations"),
      getExactCount(serviceSupabase, "messages"),
      getExactCount(serviceSupabase, "store_appointments"),
      getExactCount(serviceSupabase, "store_assistant_threads"),
      getExactCount(serviceSupabase, "store_assistant_messages"),
      serviceSupabase
        .from("organizations")
        .select("id, name, created_at, subscription_status")
        .order("created_at", { ascending: false })
        .limit(100),
      serviceSupabase
        .from("stores")
        .select("id, organization_id, name, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      loadStoreIdRows(serviceSupabase, "leads"),
      loadStoreIdRows(serviceSupabase, "messages"),
      loadSalesAiMessageRows(serviceSupabase),
      loadStoreIdRows(serviceSupabase, "store_appointments"),
      loadStoreIdRows(serviceSupabase, "store_assistant_threads"),
      loadStoreIdRows(serviceSupabase, "store_assistant_messages"),
      loadAiRunRows(serviceSupabase),
      loadQueueRows(serviceSupabase, "ai_run_queue"),
      loadQueueRows(serviceSupabase, "ai_sales_action_queue"),
      loadQueueRows(serviceSupabase, "channel_whatsapp_inbox"),
      loadAiRunQueueIssueRows(serviceSupabase),
      loadSalesActionQueueIssueRows(serviceSupabase),
      loadWhatsappInboxIssueRows(serviceSupabase),
      loadStoreOnboardingConfigRows(serviceSupabase),
      loadStoreBooleanConfigRows(serviceSupabase, "store_responsibles"),
      loadStoreBooleanConfigRows(serviceSupabase, "store_schedule_settings"),
      loadStoreBooleanConfigRows(serviceSupabase, "store_discount_settings"),
      loadStoreAuthConfigRows(serviceSupabase),
      loadStoreCatalogConfigRows(serviceSupabase),
    ]);

    const organizationsError = organizationsResult.error;
    const storesError = storesResult.error;

    if (organizationsError || storesError) {
      return NextResponse.json(
        {
          error: "Falha ao carregar dados internos do ZION.",
          details: {
            organizations: organizationsError?.message ?? null,
            stores: storesError?.message ?? null,
          },
        },
        { status: 500 },
      );
    }

    const organizations = (organizationsResult.data ?? []) as OrganizationRow[];
    const stores = (storesResult.data ?? []) as StoreRow[];
    const periodBoundaries = getPeriodBoundaries();

    const organizationMap = new Map<string, OrganizationRow>();

    for (const organization of organizations) {
      organizationMap.set(organization.id, organization);
    }

    const metricsByStore = new Map<string, StoreOverviewMetrics>();

    for (const store of stores) {
      getStoreMetrics(metricsByStore, store.id);
    }

    for (const row of leadRows.rows) {
      incrementStoreCounter({
        metricsByStore,
        storeId: row.store_id,
        key: "totalLeads",
      });
    }

    for (const row of messageRows.rows) {
      incrementStoreCounter({
        metricsByStore,
        storeId: row.store_id,
        key: "totalMessages",
      });
    }

    for (const row of salesAiMessageRows.rows) {
      incrementStoreCounter({
        metricsByStore,
        storeId: row.store_id,
        key: "totalSalesAiMessages",
      });
    }

    for (const row of appointmentRows.rows) {
      incrementStoreCounter({
        metricsByStore,
        storeId: row.store_id,
        key: "totalAppointments",
      });
    }

    for (const row of assistantThreadRows.rows) {
      incrementStoreCounter({
        metricsByStore,
        storeId: row.store_id,
        key: "totalAssistantThreads",
      });
    }

    for (const row of assistantMessageRows.rows) {
      incrementStoreCounter({
        metricsByStore,
        storeId: row.store_id,
        key: "totalAssistantMessages",
      });
    }

    for (const row of aiRunRows.rows) {
      const metrics = getStoreMetrics(metricsByStore, row.store_id);

      if (!metrics) {
        continue;
      }

      const promptTokens = toNumber(row.tokens_prompt);
      const completionTokens = toNumber(row.tokens_completion);
      const costUsd = toNumber(row.cost_usd);
      const normalizedStatus = String(row.status || "")
        .trim()
        .toLowerCase();

      metrics.totalAiRuns += 1;
      metrics.totalTokensPrompt += promptTokens;
      metrics.totalTokensCompletion += completionTokens;
      metrics.totalTokens += promptTokens + completionTokens;
      metrics.totalCostUsd += costUsd;

      const usageCategory = classifyAiRunUsage(row);
      const totalTokensForRun = promptTokens + completionTokens;
      addCostToBreakdown(metrics.costBreakdownTotal, usageCategory, costUsd);
      addTokensToBreakdown(metrics.tokenBreakdownTotal, usageCategory, totalTokensForRun);

      if (isOnOrAfter(row.created_at, periodBoundaries.startOfToday)) {
        metrics.costUsdToday += costUsd;
        metrics.tokensPromptToday += promptTokens;
        metrics.tokensCompletionToday += completionTokens;
        metrics.tokensToday += totalTokensForRun;
        addCostToBreakdown(metrics.costBreakdownToday, usageCategory, costUsd);
        addTokensToBreakdown(metrics.tokenBreakdownToday, usageCategory, totalTokensForRun);
      }

      if (isOnOrAfter(row.created_at, periodBoundaries.startOfLast7Days)) {
        metrics.costUsdLast7Days += costUsd;
        metrics.tokensPromptLast7Days += promptTokens;
        metrics.tokensCompletionLast7Days += completionTokens;
        metrics.tokensLast7Days += totalTokensForRun;
        addCostToBreakdown(metrics.costBreakdownLast7Days, usageCategory, costUsd);
        addTokensToBreakdown(metrics.tokenBreakdownLast7Days, usageCategory, totalTokensForRun);
      }

      if (isOnOrAfter(row.created_at, periodBoundaries.startOfMonth)) {
        metrics.costUsdMonth += costUsd;
        metrics.tokensPromptMonth += promptTokens;
        metrics.tokensCompletionMonth += completionTokens;
        metrics.tokensMonth += totalTokensForRun;
        addCostToBreakdown(metrics.costBreakdownMonth, usageCategory, costUsd);
        addTokensToBreakdown(metrics.tokenBreakdownMonth, usageCategory, totalTokensForRun);
      }

      if (normalizedStatus === "succeeded") {
        metrics.successfulAiRuns += 1;
      }

      if (normalizedStatus === "failed" || isErroredText(row.error)) {
        metrics.failedAiRuns += 1;
        metrics.recentAiErrors.push({
          id: row.id,
          model: row.model,
          status: row.status,
          error: row.error,
          createdAt: row.created_at,
          finishedAt: row.finished_at,
        });
      }

      if (normalizedStatus === "succeeded") {
        metrics.recentAiSuccesses.push({
          id: row.id,
          model: row.model,
          status: row.status,
          error: row.error,
          createdAt: row.created_at,
          finishedAt: row.finished_at,
        });
      }

      if (compareIsoDateDesc(row.created_at, metrics.lastAiRunAt) < 0) {
        metrics.lastAiRunAt = row.created_at;
      }
    }

    applyQueueMetrics({
      metricsByStore,
      rows: aiRunQueueRows.rows,
      pendingKey: "pendingAiRuns",
      errorKey: "aiRunQueueErrors",
    });

    applyQueueMetrics({
      metricsByStore,
      rows: salesActionQueueRows.rows,
      pendingKey: "pendingSalesActions",
      errorKey: "salesActionErrors",
    });

    applyQueueMetrics({
      metricsByStore,
      rows: whatsappQueueRows.rows,
      pendingKey: "pendingWhatsappEvents",
      errorKey: "whatsappErrors",
    });

    applyPendingIssueDetails({
      metricsByStore,
      aiRunQueueRows: aiRunQueueIssueRows.rows,
      salesActionQueueRows: salesActionQueueIssueRows.rows,
      whatsappQueueRows: whatsappIssueRows.rows,
    });

    applyStoreConfigurationIssues({
      metricsByStore,
      stores,
      onboardingRows: onboardingConfigRows.rows,
      responsibleRows: responsibleConfigRows.rows,
      scheduleSettingsRows: scheduleSettingsConfigRows.rows,
      discountSettingsRows: discountSettingsConfigRows.rows,
      authSettingsRows: authSettingsConfigRows.rows,
      catalogRows: catalogConfigRows.rows,
    });

    const storesList = stores.map((store) => {
      const organization = organizationMap.get(store.organization_id);
      const metrics = metricsByStore.get(store.id) ?? createEmptyStoreMetrics();

      const totalOperationalIssues =
        metrics.configurationIssues +
        metrics.pendingAiRuns +
        metrics.aiRunQueueErrors +
        metrics.pendingSalesActions +
        metrics.salesActionErrors +
        metrics.pendingWhatsappEvents +
        metrics.whatsappErrors;

      return {
        id: store.id,
        name: store.name ?? "Loja sem nome",
        organizationId: store.organization_id,
        organizationName: organization?.name ?? "Organização não encontrada",
        subscriptionStatus: organization?.subscription_status ?? "Sem dados",
        createdAt: store.created_at,

        totalLeads: metrics.totalLeads,
        totalMessages: metrics.totalMessages,
        totalSalesAiMessages: metrics.totalSalesAiMessages,
        totalAppointments: metrics.totalAppointments,
        totalAssistantThreads: metrics.totalAssistantThreads,
        totalAssistantMessages: metrics.totalAssistantMessages,

        totalAiRuns: metrics.totalAiRuns,
        successfulAiRuns: metrics.successfulAiRuns,
        failedAiRuns: metrics.failedAiRuns,
        totalTokensPrompt: metrics.totalTokensPrompt,
        totalTokensCompletion: metrics.totalTokensCompletion,
        totalTokens: metrics.totalTokens,
        tokensPromptToday: metrics.tokensPromptToday,
        tokensCompletionToday: metrics.tokensCompletionToday,
        tokensToday: metrics.tokensToday,
        tokensPromptLast7Days: metrics.tokensPromptLast7Days,
        tokensCompletionLast7Days: metrics.tokensCompletionLast7Days,
        tokensLast7Days: metrics.tokensLast7Days,
        tokensPromptMonth: metrics.tokensPromptMonth,
        tokensCompletionMonth: metrics.tokensCompletionMonth,
        tokensMonth: metrics.tokensMonth,
        tokenBreakdownTotal: roundTokenUsageBreakdown(metrics.tokenBreakdownTotal),
        tokenBreakdownToday: roundTokenUsageBreakdown(metrics.tokenBreakdownToday),
        tokenBreakdownLast7Days: roundTokenUsageBreakdown(metrics.tokenBreakdownLast7Days),
        tokenBreakdownMonth: roundTokenUsageBreakdown(metrics.tokenBreakdownMonth),
        totalCostUsd: Number(metrics.totalCostUsd.toFixed(6)),
        costUsdToday: Number(metrics.costUsdToday.toFixed(6)),
        costUsdLast7Days: Number(metrics.costUsdLast7Days.toFixed(6)),
        costUsdMonth: Number(metrics.costUsdMonth.toFixed(6)),
        costBreakdownTotal: roundAiUsageBreakdown(metrics.costBreakdownTotal),
        costBreakdownToday: roundAiUsageBreakdown(metrics.costBreakdownToday),
        costBreakdownLast7Days: roundAiUsageBreakdown(metrics.costBreakdownLast7Days),
        costBreakdownMonth: roundAiUsageBreakdown(metrics.costBreakdownMonth),
        lastAiRunAt: metrics.lastAiRunAt,

        configurationIssues: metrics.configurationIssues,
        pendingAiRuns: metrics.pendingAiRuns,
        aiRunQueueErrors: metrics.aiRunQueueErrors,
        pendingSalesActions: metrics.pendingSalesActions,
        salesActionErrors: metrics.salesActionErrors,
        pendingWhatsappEvents: metrics.pendingWhatsappEvents,
        whatsappErrors: metrics.whatsappErrors,
        totalOperationalIssues,

        pendingIssueDetails: [...metrics.pendingIssueDetails]
          .sort((a, b) => compareIsoDateDesc(a.occurredAt, b.occurredAt))
          .slice(0, 50),

        recentAiErrors: [...metrics.recentAiErrors]
          .sort((a, b) => compareIsoDateDesc(a.createdAt, b.createdAt))
          .slice(0, 20),
        recentAiSuccesses: [...metrics.recentAiSuccesses]
          .sort((a, b) => compareIsoDateDesc(a.createdAt, b.createdAt))
          .slice(0, 20),
      };
    });

    const subscriptionStatusCounts = storesList.reduce<Record<string, number>>(
      (acc, store) => {
        const key = String(store.subscriptionStatus || "Sem dados");
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      },
      {},
    );

    const aiUsageTotals = storesList.reduce(
      (acc, store) => {
        acc.totalAiRuns += store.totalAiRuns;
        acc.successfulAiRuns += store.successfulAiRuns;
        acc.failedAiRuns += store.failedAiRuns;
        acc.totalTokensPrompt += store.totalTokensPrompt;
        acc.totalTokensCompletion += store.totalTokensCompletion;
        acc.totalTokens += store.totalTokens;
        acc.tokensPromptToday += store.tokensPromptToday;
        acc.tokensCompletionToday += store.tokensCompletionToday;
        acc.tokensToday += store.tokensToday;
        acc.tokensPromptLast7Days += store.tokensPromptLast7Days;
        acc.tokensCompletionLast7Days += store.tokensCompletionLast7Days;
        acc.tokensLast7Days += store.tokensLast7Days;
        acc.tokensPromptMonth += store.tokensPromptMonth;
        acc.tokensCompletionMonth += store.tokensCompletionMonth;
        acc.tokensMonth += store.tokensMonth;
        sumTokenUsageBreakdown(acc.tokenBreakdownTotal, store.tokenBreakdownTotal);
        sumTokenUsageBreakdown(acc.tokenBreakdownToday, store.tokenBreakdownToday);
        sumTokenUsageBreakdown(acc.tokenBreakdownLast7Days, store.tokenBreakdownLast7Days);
        sumTokenUsageBreakdown(acc.tokenBreakdownMonth, store.tokenBreakdownMonth);
        acc.totalCostUsd += store.totalCostUsd;
        acc.costUsdToday += store.costUsdToday;
        acc.costUsdLast7Days += store.costUsdLast7Days;
        acc.costUsdMonth += store.costUsdMonth;
        sumAiUsageBreakdown(acc.costBreakdownTotal, store.costBreakdownTotal);
        sumAiUsageBreakdown(acc.costBreakdownToday, store.costBreakdownToday);
        sumAiUsageBreakdown(acc.costBreakdownLast7Days, store.costBreakdownLast7Days);
        sumAiUsageBreakdown(acc.costBreakdownMonth, store.costBreakdownMonth);
        acc.configurationIssues += store.configurationIssues;
        acc.pendingAiRuns += store.pendingAiRuns;
        acc.aiRunQueueErrors += store.aiRunQueueErrors;
        acc.pendingSalesActions += store.pendingSalesActions;
        acc.salesActionErrors += store.salesActionErrors;
        acc.pendingWhatsappEvents += store.pendingWhatsappEvents;
        acc.whatsappErrors += store.whatsappErrors;
        acc.totalOperationalIssues += store.totalOperationalIssues;
        acc.totalSalesAiMessages += store.totalSalesAiMessages;

        if (compareIsoDateDesc(store.lastAiRunAt, acc.lastAiRunAt) < 0) {
          acc.lastAiRunAt = store.lastAiRunAt;
        }

        return acc;
      },
      {
        totalSalesAiMessages: 0,
        totalAiRuns: 0,
        successfulAiRuns: 0,
        failedAiRuns: 0,
        totalTokensPrompt: 0,
        totalTokensCompletion: 0,
        totalTokens: 0,
        tokensPromptToday: 0,
        tokensCompletionToday: 0,
        tokensToday: 0,
        tokensPromptLast7Days: 0,
        tokensCompletionLast7Days: 0,
        tokensLast7Days: 0,
        tokensPromptMonth: 0,
        tokensCompletionMonth: 0,
        tokensMonth: 0,
        tokenBreakdownTotal: createEmptyTokenUsageBreakdown(),
        tokenBreakdownToday: createEmptyTokenUsageBreakdown(),
        tokenBreakdownLast7Days: createEmptyTokenUsageBreakdown(),
        tokenBreakdownMonth: createEmptyTokenUsageBreakdown(),
        totalCostUsd: 0,
        costUsdToday: 0,
        costUsdLast7Days: 0,
        costUsdMonth: 0,
        costBreakdownTotal: createEmptyAiUsageBreakdown(),
        costBreakdownToday: createEmptyAiUsageBreakdown(),
        costBreakdownLast7Days: createEmptyAiUsageBreakdown(),
        costBreakdownMonth: createEmptyAiUsageBreakdown(),
        lastAiRunAt: null as string | null,
        configurationIssues: 0,
        pendingAiRuns: 0,
        aiRunQueueErrors: 0,
        pendingSalesActions: 0,
        salesActionErrors: 0,
        pendingWhatsappEvents: 0,
        whatsappErrors: 0,
        totalOperationalIssues: 0,
      },
    );

    return NextResponse.json({
      admin: {
        role: admin.role,
      },
      totals: {
        organizations: organizationsCount.count,
        stores: storesCount.count,
        storesActive: subscriptionStatusCounts.active ?? 0,
        storesTrial: subscriptionStatusCounts.trial ?? 0,
        storesInactive:
          (storesCount.count ?? 0) -
          (subscriptionStatusCounts.active ?? 0) -
          (subscriptionStatusCounts.trial ?? 0),
        leads: leadsCount.count,
        conversations: conversationsCount.count,
        messages: messagesCount.count,
        salesAiMessages: aiUsageTotals.totalSalesAiMessages,
        appointments: appointmentsCount.count,
        assistantThreads: assistantThreadsCount.count,
        assistantMessages: assistantMessagesCount.count,
        aiRuns: aiUsageTotals.totalAiRuns,
        successfulAiRuns: aiUsageTotals.successfulAiRuns,
        failedAiRuns: aiUsageTotals.failedAiRuns,
        totalTokensPrompt: aiUsageTotals.totalTokensPrompt,
        totalTokensCompletion: aiUsageTotals.totalTokensCompletion,
        totalTokens: aiUsageTotals.totalTokens,
        tokensPromptToday: aiUsageTotals.tokensPromptToday,
        tokensCompletionToday: aiUsageTotals.tokensCompletionToday,
        tokensToday: aiUsageTotals.tokensToday,
        tokensPromptLast7Days: aiUsageTotals.tokensPromptLast7Days,
        tokensCompletionLast7Days: aiUsageTotals.tokensCompletionLast7Days,
        tokensLast7Days: aiUsageTotals.tokensLast7Days,
        tokensPromptMonth: aiUsageTotals.tokensPromptMonth,
        tokensCompletionMonth: aiUsageTotals.tokensCompletionMonth,
        tokensMonth: aiUsageTotals.tokensMonth,
        tokenBreakdownTotal: roundTokenUsageBreakdown(aiUsageTotals.tokenBreakdownTotal),
        tokenBreakdownToday: roundTokenUsageBreakdown(aiUsageTotals.tokenBreakdownToday),
        tokenBreakdownLast7Days: roundTokenUsageBreakdown(aiUsageTotals.tokenBreakdownLast7Days),
        tokenBreakdownMonth: roundTokenUsageBreakdown(aiUsageTotals.tokenBreakdownMonth),
        totalCostUsd: Number(aiUsageTotals.totalCostUsd.toFixed(6)),
        costUsdToday: Number(aiUsageTotals.costUsdToday.toFixed(6)),
        costUsdLast7Days: Number(aiUsageTotals.costUsdLast7Days.toFixed(6)),
        costUsdMonth: Number(aiUsageTotals.costUsdMonth.toFixed(6)),
        costBreakdownTotal: roundAiUsageBreakdown(aiUsageTotals.costBreakdownTotal),
        costBreakdownToday: roundAiUsageBreakdown(aiUsageTotals.costBreakdownToday),
        costBreakdownLast7Days: roundAiUsageBreakdown(aiUsageTotals.costBreakdownLast7Days),
        costBreakdownMonth: roundAiUsageBreakdown(aiUsageTotals.costBreakdownMonth),
        configurationIssues: aiUsageTotals.configurationIssues,
        pendingAiRuns: aiUsageTotals.pendingAiRuns,
        aiRunQueueErrors: aiUsageTotals.aiRunQueueErrors,
        pendingSalesActions: aiUsageTotals.pendingSalesActions,
        salesActionErrors: aiUsageTotals.salesActionErrors,
        pendingWhatsappEvents: aiUsageTotals.pendingWhatsappEvents,
        whatsappErrors: aiUsageTotals.whatsappErrors,
        totalOperationalIssues: aiUsageTotals.totalOperationalIssues,
        lastAiRunAt: aiUsageTotals.lastAiRunAt,
      },
      countErrors: {
        organizations: organizationsCount.error,
        stores: storesCount.error,
        leads: leadsCount.error,
        conversations: conversationsCount.error,
        messages: messagesCount.error,
        appointments: appointmentsCount.error,
        assistantThreads: assistantThreadsCount.error,
        assistantMessages: assistantMessagesCount.error,
        storeLeads: leadRows.error,
        storeMessages: messageRows.error,
        storeSalesAiMessages: salesAiMessageRows.error,
        storeAppointments: appointmentRows.error,
        storeAssistantThreads: assistantThreadRows.error,
        storeAssistantMessages: assistantMessageRows.error,
        aiRuns: aiRunRows.error,
        aiRunQueue: aiRunQueueRows.error,
        salesActionQueue: salesActionQueueRows.error,
        whatsappQueue: whatsappQueueRows.error,
        aiRunQueueDetails: aiRunQueueIssueRows.error,
        salesActionQueueDetails: salesActionQueueIssueRows.error,
        whatsappQueueDetails: whatsappIssueRows.error,
        storeOnboardingConfig: onboardingConfigRows.error,
        storeResponsiblesConfig: responsibleConfigRows.error,
        storeScheduleSettingsConfig: scheduleSettingsConfigRows.error,
        storeDiscountSettingsConfig: discountSettingsConfigRows.error,
        storeAuthSettingsConfig: authSettingsConfigRows.error,
        storeCatalogConfig: catalogConfigRows.error,
      },
      stores: storesList,
      future: {
        billing: "Ainda não implementado.",
        paymentStatus: "Ainda não implementado.",
        aiCost:
          aiUsageTotals.totalAiRuns > 0
            ? "Custo real já registrado para novas execuções de IA."
            : "Aguardando base confiável.",
        tokens:
          aiUsageTotals.totalTokens > 0
            ? "Tokens reais já registrados para novas execuções de IA."
            : "Aguardando base confiável.",
        workersHealth:
          aiUsageTotals.totalOperationalIssues > 0
            ? "Há pendências ou erros operacionais para revisar."
            : "Nenhuma pendência crítica encontrada nas filas monitoradas.",
        integrationErrors:
          aiUsageTotals.whatsappErrors > 0
            ? "Existem erros registrados no webhook/entrada do WhatsApp."
            : "Nenhum erro de integração encontrado nas filas monitoradas.",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "Erro inesperado ao carregar dashboard interno.",
        details: error?.message ?? "Erro desconhecido.",
      },
      { status: 500 },
    );
  }
}
