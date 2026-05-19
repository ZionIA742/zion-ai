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
  store_id: string | null;
  status: string | null;
  error: string | null;
  tokens_prompt: number | string | null;
  tokens_completion: number | string | null;
  cost_usd: number | string | null;
  created_at: string | null;
};

type QueueMetricRow = {
  store_id: string | null;
  processed_at: string | null;
  processing_error: string | null;
};

type StoreOverviewMetrics = {
  totalLeads: number;
  totalMessages: number;
  totalAppointments: number;
  totalAssistantThreads: number;
  totalAssistantMessages: number;
  totalAiRuns: number;
  successfulAiRuns: number;
  failedAiRuns: number;
  totalTokensPrompt: number;
  totalTokensCompletion: number;
  totalTokens: number;
  totalCostUsd: number;
  lastAiRunAt: string | null;
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
    }
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
  table: string
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
  const parsed = typeof value === "string" ? Number(value) : value ?? 0;
  return Number.isFinite(parsed) ? Number(parsed) : 0;
}

function createEmptyStoreMetrics(): StoreOverviewMetrics {
  return {
    totalLeads: 0,
    totalMessages: 0,
    totalAppointments: 0,
    totalAssistantThreads: 0,
    totalAssistantMessages: 0,
    totalAiRuns: 0,
    successfulAiRuns: 0,
    failedAiRuns: 0,
    totalTokensPrompt: 0,
    totalTokensCompletion: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    lastAiRunAt: null,
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
  storeId: string | null | undefined
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
  table: string
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

async function loadQueueRows(
  supabase: ReturnType<typeof getServiceSupabaseClient>,
  table: string
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

async function loadAiRunRows(
  supabase: ReturnType<typeof getServiceSupabaseClient>
): Promise<{ rows: AiRunRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("ai_runs")
    .select(
      "store_id, status, error, tokens_prompt, tokens_completion, cost_usd, created_at"
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
        { status: 401 }
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
        { status: 403 }
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
      appointmentRows,
      assistantThreadRows,
      assistantMessageRows,
      aiRunRows,
      aiRunQueueRows,
      salesActionQueueRows,
      whatsappQueueRows,
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
      loadStoreIdRows(serviceSupabase, "store_appointments"),
      loadStoreIdRows(serviceSupabase, "store_assistant_threads"),
      loadStoreIdRows(serviceSupabase, "store_assistant_messages"),
      loadAiRunRows(serviceSupabase),
      loadQueueRows(serviceSupabase, "ai_run_queue"),
      loadQueueRows(serviceSupabase, "ai_sales_action_queue"),
      loadQueueRows(serviceSupabase, "channel_whatsapp_inbox"),
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
        { status: 500 }
      );
    }

    const organizations = (organizationsResult.data ?? []) as OrganizationRow[];
    const stores = (storesResult.data ?? []) as StoreRow[];

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
      const normalizedStatus = String(row.status || "").trim().toLowerCase();

      metrics.totalAiRuns += 1;
      metrics.totalTokensPrompt += promptTokens;
      metrics.totalTokensCompletion += completionTokens;
      metrics.totalTokens += promptTokens + completionTokens;
      metrics.totalCostUsd += costUsd;

      if (normalizedStatus === "succeeded") {
        metrics.successfulAiRuns += 1;
      }

      if (normalizedStatus === "failed" || isErroredText(row.error)) {
        metrics.failedAiRuns += 1;
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

    const storesList = stores.map((store) => {
      const organization = organizationMap.get(store.organization_id);
      const metrics =
        metricsByStore.get(store.id) ?? createEmptyStoreMetrics();

      const totalOperationalIssues =
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
        totalAppointments: metrics.totalAppointments,
        totalAssistantThreads: metrics.totalAssistantThreads,
        totalAssistantMessages: metrics.totalAssistantMessages,

        totalAiRuns: metrics.totalAiRuns,
        successfulAiRuns: metrics.successfulAiRuns,
        failedAiRuns: metrics.failedAiRuns,
        totalTokensPrompt: metrics.totalTokensPrompt,
        totalTokensCompletion: metrics.totalTokensCompletion,
        totalTokens: metrics.totalTokens,
        totalCostUsd: Number(metrics.totalCostUsd.toFixed(6)),
        lastAiRunAt: metrics.lastAiRunAt,

        pendingAiRuns: metrics.pendingAiRuns,
        aiRunQueueErrors: metrics.aiRunQueueErrors,
        pendingSalesActions: metrics.pendingSalesActions,
        salesActionErrors: metrics.salesActionErrors,
        pendingWhatsappEvents: metrics.pendingWhatsappEvents,
        whatsappErrors: metrics.whatsappErrors,
        totalOperationalIssues,
      };
    });

    const subscriptionStatusCounts = storesList.reduce<Record<string, number>>(
      (acc, store) => {
        const key = String(store.subscriptionStatus || "Sem dados");
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      },
      {}
    );

    const aiUsageTotals = storesList.reduce(
      (acc, store) => {
        acc.totalAiRuns += store.totalAiRuns;
        acc.successfulAiRuns += store.successfulAiRuns;
        acc.failedAiRuns += store.failedAiRuns;
        acc.totalTokensPrompt += store.totalTokensPrompt;
        acc.totalTokensCompletion += store.totalTokensCompletion;
        acc.totalTokens += store.totalTokens;
        acc.totalCostUsd += store.totalCostUsd;
        acc.pendingAiRuns += store.pendingAiRuns;
        acc.aiRunQueueErrors += store.aiRunQueueErrors;
        acc.pendingSalesActions += store.pendingSalesActions;
        acc.salesActionErrors += store.salesActionErrors;
        acc.pendingWhatsappEvents += store.pendingWhatsappEvents;
        acc.whatsappErrors += store.whatsappErrors;
        acc.totalOperationalIssues += store.totalOperationalIssues;

        if (compareIsoDateDesc(store.lastAiRunAt, acc.lastAiRunAt) < 0) {
          acc.lastAiRunAt = store.lastAiRunAt;
        }

        return acc;
      },
      {
        totalAiRuns: 0,
        successfulAiRuns: 0,
        failedAiRuns: 0,
        totalTokensPrompt: 0,
        totalTokensCompletion: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        lastAiRunAt: null as string | null,
        pendingAiRuns: 0,
        aiRunQueueErrors: 0,
        pendingSalesActions: 0,
        salesActionErrors: 0,
        pendingWhatsappEvents: 0,
        whatsappErrors: 0,
        totalOperationalIssues: 0,
      }
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
        appointments: appointmentsCount.count,
        assistantThreads: assistantThreadsCount.count,
        assistantMessages: assistantMessagesCount.count,
        aiRuns: aiUsageTotals.totalAiRuns,
        successfulAiRuns: aiUsageTotals.successfulAiRuns,
        failedAiRuns: aiUsageTotals.failedAiRuns,
        totalTokensPrompt: aiUsageTotals.totalTokensPrompt,
        totalTokensCompletion: aiUsageTotals.totalTokensCompletion,
        totalTokens: aiUsageTotals.totalTokens,
        totalCostUsd: Number(aiUsageTotals.totalCostUsd.toFixed(6)),
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
        storeAppointments: appointmentRows.error,
        storeAssistantThreads: assistantThreadRows.error,
        storeAssistantMessages: assistantMessageRows.error,
        aiRuns: aiRunRows.error,
        aiRunQueue: aiRunQueueRows.error,
        salesActionQueue: salesActionQueueRows.error,
        whatsappQueue: whatsappQueueRows.error,
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
      { status: 500 }
    );
  }
}
