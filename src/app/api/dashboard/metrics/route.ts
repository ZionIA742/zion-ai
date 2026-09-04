// src/app/api/dashboard/metrics/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getCatalogPriceSemantics,
  getCatalogPriceSemanticsFromNumber,
  getCatalogStockSemantics,
} from "@/lib/catalog/presentation";
import {
  buildMonthlySalesGoalState,
  type StoreMonthlySalesGoalRow,
} from "@/lib/store-monthly-sales-goal";
import { resolveStoreApiAccess } from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LeadRow = {
  id: string;
  name: string | null;
  phone: string | null;
  state: string;
  created_at: string;
  updated_at: string | null;
};

type ConversationRow = {
  id: string;
  lead_id: string;
  status: string;
  is_human_active: boolean;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_direction: string | null;
  last_message_sender: string | null;
  created_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  lead_id: string | null;
  store_id: string;
  sender: string;
  direction: string;
  message_type: string;
  content: string;
  created_at: string;
};

type AiRunRow = {
  id: string;
  conversation_id: string;
  lead_id: string;
  store_id: string;
  status: string;
  latency_ms: number | null;
  tokens_prompt: number | null;
  tokens_completion: number | null;
  cost_usd: number | string | null;
  created_at: string;
};

type AiDecisionRow = {
  id: string;
  conversation_id: string;
  lead_id: string;
  action: string;
  next_state: string | null;
  created_at: string;
};

type AiQueueRow = {
  id: string;
  conversation_id: string;
  next_action: string;
  action_key: string;
  processed_at: string | null;
  processing_error: string | null;
  enqueued_at: string;
};

type AppointmentRow = {
  id: string;
  lead_id: string | null;
  conversation_id: string | null;
  title: string;
  appointment_type: string;
  status: string;
  scheduled_start: string;
  scheduled_end: string;
  customer_name: string | null;
  customer_phone: string | null;
  address_text: string | null;
  source: string;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

type FollowupRow = {
  id: string;
  appointment_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  followup_status: string;
  preferred_channel: string;
  prompt_count: number;
  scheduled_end: string;
  last_prompted_at: string | null;
  confirmed_at: string | null;
  resolved_at: string | null;
};

type CatalogMetadataValue =
  | string
  | number
  | boolean
  | null
  | CatalogMetadataValue[]
  | { [key: string]: CatalogMetadataValue };

type CatalogItemRow = {
  id: string;
  sku: string | null;
  name: string;
  price_cents: number | null;
  currency: string;
  price_status?: string | null;
  is_active: boolean;
  track_stock: boolean;
  stock_quantity: number | null;
  stock_status?: string | null;
  metadata: Record<string, CatalogMetadataValue> | null;
  created_at: string;
  updated_at: string;
};

type PoolRow = {
  id: string;
  name: string | null;
  price: number | string | null;
  price_status?: string | null;
  is_active: boolean;
  track_stock: boolean;
  stock_quantity: number | null;
  stock_status?: string | null;
  created_at: string | null;
};

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      Vary: "*",
    },
  });
}

function startOfLocalDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfLocalDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function startOfLocalMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function endOfLocalMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toIso(date: Date) {
  return date.toISOString();
}

function normalizeText(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function isAiMessage(message: Pick<MessageRow, "sender" | "direction">) {
  const sender = normalizeText(message.sender);
  const direction = normalizeText(message.direction);

  return (
    sender === "ai" ||
    sender === "ia" ||
    sender === "assistant" ||
    sender === "assistente" ||
    sender === "zion" ||
    sender.includes("ai") ||
    sender.includes("ia_") ||
    sender.includes("assistant") ||
    sender.includes("assistente") ||
    (direction === "outbound" && (sender.includes("bot") || sender.includes("zion")))
  );
}

function isHumanOperatorMessage(message: Pick<MessageRow, "sender" | "direction">) {
  const sender = normalizeText(message.sender);

  return (
    sender === "human" ||
    sender === "humano" ||
    sender === "user" ||
    sender === "operator" ||
    sender === "responsible" ||
    sender.includes("human") ||
    sender.includes("humano") ||
    sender.includes("operator")
  );
}

function countBy<T extends Record<string, unknown>>(items: T[], key: keyof T) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const value = String(item[key] ?? "sem_status");
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function sumNumbers(values: Array<number | string | null | undefined>): number {
  return values.reduce<number>((sum, value) => {
    const numberValue = typeof value === "string" ? Number(value) : value ?? 0;
    return sum + (Number.isFinite(numberValue) ? Number(numberValue) : 0);
  }, 0);
}

function averageNumbers(values: Array<number | null | undefined>): number | null {
  const validValues = values.filter((value): value is number => Number.isFinite(value));
  if (!validValues.length) return null;
  return Math.round(validValues.reduce<number>((sum, value) => sum + value, 0) / validValues.length);
}

function getConversationDisplayName(
  conversation: ConversationRow,
  leadById: Map<string, LeadRow>
) {
  const lead = leadById.get(conversation.lead_id);
  return lead?.name || lead?.phone || "Cliente sem nome";
}

function normalizeCatalogCategory(value: string | null | undefined) {
  const text = normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (text.includes("piscina") || text.includes("pool")) return "pools";
  if (text.includes("quim") || text.includes("chemical") || text.includes("cloro")) return "chemicals";
  if (text.includes("acessor") || text.includes("accessor")) return "accessories";
  return "others";
}

function getCatalogCategory(item: CatalogItemRow) {
  const metadata = item.metadata || {};
  const rawCategory =
    metadata.categoria ||
    metadata.category ||
    metadata.tipo ||
    metadata.type ||
    metadata.productCategory ||
    metadata.product_category ||
    null;

  return normalizeCatalogCategory(typeof rawCategory === "string" ? rawCategory : null);
}

function getCatalogCategoryLabel(category: string) {
  const dictionary: Record<string, string> = {
    pools: "Piscinas",
    chemicals: "Químicos",
    accessories: "Acessórios",
    others: "Outros",
  };

  return dictionary[category] || "Outros";
}

function mapCatalogItemForDashboard(item: CatalogItemRow) {
  const category = getCatalogCategory(item);
  const price = getCatalogPriceSemantics({
    priceStatus: item.price_status,
    priceCents: item.price_cents,
  });

  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    category,
    categoryLabel: getCatalogCategoryLabel(category),
    priceCents: price.priceCents,
    currency: item.currency,
    priceStatus: price.resolvedStatus,
    stockQuantity: item.stock_quantity,
    stockStatus: item.stock_status,
    isActive: item.is_active,
    trackStock: item.track_stock,
  };
}

function mapPoolForDashboard(pool: PoolRow) {
  const price = getCatalogPriceSemanticsFromNumber({
    priceStatus: pool.price_status,
    price: pool.price,
  });

  return {
    id: `pool:${pool.id}`,
    sku: null,
    name: pool.name || "Piscina sem nome",
    category: "pools",
    categoryLabel: "Piscinas",
    priceCents: price.priceCents,
    currency: "BRL",
    priceStatus: price.resolvedStatus,
    stockQuantity: pool.stock_quantity,
    stockStatus: pool.stock_status,
    isActive: pool.is_active,
    trackStock: pool.track_stock,
  };
}

export type DashboardMetricsRouteDeps = {
  resolveAccess: typeof resolveStoreApiAccess;
  createPrivilegedClient: () => ReturnType<typeof createClient>;
};

function createPrivilegedDashboardClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("SUPABASE_ENV_MISSING");
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

export function createDashboardMetricsGetHandler(
  deps: Partial<DashboardMetricsRouteDeps> = {}
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const createPrivilegedClient =
    deps.createPrivilegedClient ?? createPrivilegedDashboardClient;

  return async function GET(request: Request) {
    void request;
    const access = await resolveAccess({ requirement: "active" });

    if (!access.ok) {
      return createStoreApiDeniedResponse(access);
    }

    const organizationId = access.organizationId;
    const storeId = access.storeId;

    try {
      const supabase = createPrivilegedClient();

    const now = new Date();
    const todayStart = startOfLocalDay(now);
    const todayEnd = endOfLocalDay(now);
    const weekStart = addDays(todayStart, -6);
    const monthStart = startOfLocalMonth(now);
    const monthEnd = endOfLocalMonth(now);
    const next30DaysEnd = addDays(todayEnd, 30);

    const leadsResult = await supabase
      .from("leads")
      .select("id,name,phone,state,created_at,updated_at")
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(10000);

    if (leadsResult.error) {
      console.error("[dashboard-metrics] query failure", [
        {
          source: "leads",
          code: leadsResult.error.code,
          message: leadsResult.error.message,
          details: leadsResult.error.details,
          hint: leadsResult.error.hint,
        },
      ]);

      return buildJsonResponse(
        {
          ok: false,
          error: "LOAD_DASHBOARD_METRICS_FAILED",
          message: "Nao foi possivel carregar as metricas do dashboard no momento.",
        },
        500
      );
    }

    const leads = (leadsResult.data || []) as LeadRow[];
    const authorizedLeadIds = leads.map((lead) => lead.id);
    const conversationLeadIds = authorizedLeadIds.length
      ? authorizedLeadIds
      : ["00000000-0000-0000-0000-000000000000"];

    const [
      conversationsResult,
      monthMessagesResult,
      recentMessagesResult,
      aiRunsResult,
      aiDecisionsResult,
      aiQueueResult,
      appointmentsResult,
      followupsResult,
      catalogResult,
      poolsResult,
      monthlyGoalResult,
    ] = await Promise.all([
      supabase
        .from("conversations")
        .select(
          "id,lead_id,status,is_human_active,last_message_at,last_message_preview,last_message_direction,last_message_sender,created_at"
        )
        .eq("organization_id", organizationId)
        .in("lead_id", conversationLeadIds)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(10000),

      supabase
        .from("messages")
        .select("id,conversation_id,lead_id,store_id,sender,direction,message_type,content,created_at")
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .gte("created_at", toIso(monthStart))
        .lte("created_at", toIso(monthEnd))
        .order("created_at", { ascending: false })
        .limit(5000),

      supabase
        .from("messages")
        .select("id,conversation_id,lead_id,store_id,sender,direction,message_type,content,created_at")
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(12),

      supabase
        .from("ai_runs")
        .select(
          "id,conversation_id,lead_id,store_id,status,latency_ms,tokens_prompt,tokens_completion,cost_usd,created_at"
        )
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .gte("created_at", toIso(monthStart))
        .lte("created_at", toIso(monthEnd))
        .order("created_at", { ascending: false })
        .limit(5000),

      supabase
        .from("ai_decisions")
        .select("id,conversation_id,lead_id,action,next_state,created_at")
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .gte("created_at", toIso(monthStart))
        .lte("created_at", toIso(monthEnd))
        .order("created_at", { ascending: false })
        .limit(1000),

      supabase
        .from("ai_sales_action_queue")
        .select("id,conversation_id,next_action,action_key,processed_at,processing_error,enqueued_at")
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .order("enqueued_at", { ascending: false })
        .limit(1000),

      supabase
        .from("store_appointments")
        .select(
          "id,lead_id,conversation_id,title,appointment_type,status,scheduled_start,scheduled_end,customer_name,customer_phone,address_text,source,created_by_user_id,created_at,updated_at"
        )
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .gte("scheduled_start", toIso(monthStart))
        .lte("scheduled_start", toIso(next30DaysEnd))
        .order("scheduled_start", { ascending: true })
        .limit(5000),

      supabase
        .from("schedule_post_appointment_followups")
        .select(
          "id,appointment_id,lead_id,conversation_id,followup_status,preferred_channel,prompt_count,scheduled_end,last_prompted_at,confirmed_at,resolved_at"
        )
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .order("scheduled_end", { ascending: false })
        .limit(5000),

      supabase
        .from("store_catalog_items")
        .select("id,sku,name,price_cents,currency,price_status,is_active,track_stock,stock_quantity,stock_status,metadata,created_at,updated_at")
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .order("updated_at", { ascending: false })
        .limit(10000),

      supabase
        .from("pools")
        .select("id,name,price,price_status,is_active,track_stock,stock_quantity,stock_status,created_at")
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(10000),

      supabase
        .from("store_monthly_sales_goals")
        .select(
          "organization_id, store_id, monthly_goal_enabled, monthly_goal_amount_cents, created_at, updated_at",
        )
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .limit(1),
    ]);

    const queryFailures = [
      { source: "conversations", error: conversationsResult.error },
      { source: "messages_month", error: monthMessagesResult.error },
      { source: "messages_recent", error: recentMessagesResult.error },
      { source: "ai_runs", error: aiRunsResult.error },
      { source: "ai_decisions", error: aiDecisionsResult.error },
      { source: "ai_sales_action_queue", error: aiQueueResult.error },
      { source: "store_appointments", error: appointmentsResult.error },
      {
        source: "schedule_post_appointment_followups",
        error: followupsResult.error,
      },
      { source: "store_catalog_items", error: catalogResult.error },
      { source: "pools", error: poolsResult.error },
      { source: "store_monthly_sales_goals", error: monthlyGoalResult.error },
    ].filter((item) => item.error);

    if (queryFailures.length > 0) {
      console.error(
        "[dashboard-metrics] query failure",
        queryFailures.map(({ source, error }) => ({
          source,
          code: error?.code,
          message: error?.message,
          details: error?.details,
          hint: error?.hint,
        }))
      );

      return buildJsonResponse(
        {
          ok: false,
          error: "LOAD_DASHBOARD_METRICS_FAILED",
          message: "Nao foi possivel carregar as metricas do dashboard no momento.",
        },
        500
      );
    }

    const conversations = (conversationsResult.data || []) as ConversationRow[];
    const monthMessages = (monthMessagesResult.data || []) as MessageRow[];
    const recentMessages = (recentMessagesResult.data || []) as MessageRow[];
    const aiRuns = (aiRunsResult.data || []) as AiRunRow[];
    const aiDecisions = (aiDecisionsResult.data || []) as AiDecisionRow[];
    const aiQueue = (aiQueueResult.data || []) as AiQueueRow[];
    const appointments = (appointmentsResult.data || []) as AppointmentRow[];
    const followups = (followupsResult.data || []) as FollowupRow[];
    const catalogItems = (catalogResult.data || []) as CatalogItemRow[];
    const pools = (poolsResult.data || []) as PoolRow[];
    const monthlyGoalRow = Array.isArray(monthlyGoalResult.data)
      ? ((monthlyGoalResult.data[0] as StoreMonthlySalesGoalRow | undefined) ?? null)
      : null;

    const leadById = new Map(leads.map((lead) => [lead.id, lead]));

    const todayLeads = leads.filter((lead) => {
      const createdAt = new Date(lead.created_at);
      return createdAt >= todayStart && createdAt <= todayEnd;
    });

    const weekLeads = leads.filter((lead) => {
      const createdAt = new Date(lead.created_at);
      return createdAt >= weekStart && createdAt <= todayEnd;
    });

    const monthLeads = leads.filter((lead) => {
      const createdAt = new Date(lead.created_at);
      return createdAt >= monthStart && createdAt <= monthEnd;
    });

    const todayMessages = monthMessages.filter((message) => {
      const createdAt = new Date(message.created_at);
      return createdAt >= todayStart && createdAt <= todayEnd;
    });

    const weekMessages = monthMessages.filter((message) => {
      const createdAt = new Date(message.created_at);
      return createdAt >= weekStart && createdAt <= todayEnd;
    });

    const aiMessages = monthMessages.filter(isAiMessage);
    const humanOperatorMessages = monthMessages.filter(isHumanOperatorMessage);
    const customerMessages = monthMessages.filter(
      (message) => !isAiMessage(message) && !isHumanOperatorMessage(message)
    );

    const messagesByConversation = monthMessages.reduce<Record<string, MessageRow[]>>(
      (acc, message) => {
        if (!acc[message.conversation_id]) {
          acc[message.conversation_id] = [];
        }
        acc[message.conversation_id].push(message);
        return acc;
      },
      {}
    );

    const conversationsWithAiPresence = Object.entries(messagesByConversation)
      .map(([conversationId, messages]) => {
        const conversation = conversations.find((item) => item.id === conversationId);
        const aiCount = messages.filter(isAiMessage).length;
        const humanCount = messages.filter(isHumanOperatorMessage).length;
        const customerCount = messages.length - aiCount - humanCount;
        const total = messages.length;
        const aiParticipationPercent = total > 0 ? Math.round((aiCount / total) * 100) : 0;

        return {
          conversationId,
          leadId: conversation?.lead_id || messages[0]?.lead_id || null,
          customerName: conversation
            ? getConversationDisplayName(conversation, leadById)
            : "Cliente sem nome",
          totalMessages: total,
          aiMessages: aiCount,
          humanMessages: humanCount,
          customerMessages: customerCount,
          aiParticipationPercent,
          lastMessageAt: conversation?.last_message_at || messages[0]?.created_at || null,
          lastMessagePreview: conversation?.last_message_preview || messages[0]?.content || null,
        };
      })
      .filter((item) => item.totalMessages > 0)
      .sort((a, b) => {
        if (b.aiParticipationPercent !== a.aiParticipationPercent) {
          return b.aiParticipationPercent - a.aiParticipationPercent;
        }
        return b.totalMessages - a.totalMessages;
      })
      .slice(0, 10);

    const activeConversations = conversations.filter(
      (conversation) => normalizeText(conversation.status) === "active"
    );

    const humanActiveConversations = conversations.filter(
      (conversation) => conversation.is_human_active
    );

    const todayAppointments = appointments.filter((appointment) => {
      const scheduledStart = new Date(appointment.scheduled_start);
      return scheduledStart >= todayStart && scheduledStart <= todayEnd;
    });

    const futureAppointments = appointments.filter((appointment) => {
      const scheduledStart = new Date(appointment.scheduled_start);
      return scheduledStart > now;
    });

    const nextAppointments = futureAppointments.slice(0, 8).map((appointment) => ({
      id: appointment.id,
      title: appointment.title,
      status: appointment.status,
      appointmentType: appointment.appointment_type,
      customerName: appointment.customer_name,
      customerPhone: appointment.customer_phone,
      addressText: appointment.address_text,
      scheduledStart: appointment.scheduled_start,
      scheduledEnd: appointment.scheduled_end,
      source: appointment.source,
    }));

    const pendingFollowups = followups.filter((followup) => {
      const status = normalizeText(followup.followup_status);
      return !followup.resolved_at && !["resolved", "resolvido", "confirmed", "confirmado"].includes(status);
    });

    const dashboardCatalogItems = catalogItems.map(mapCatalogItemForDashboard);
    const dashboardPoolItems = pools.map(mapPoolForDashboard);
    const allDashboardCatalogItems = [...dashboardPoolItems, ...dashboardCatalogItems];

    const activeCatalogItems = allDashboardCatalogItems.filter((item) => item.isActive);
    const stockTrackedItems = allDashboardCatalogItems.filter((item) => {
      const stock = getCatalogStockSemantics({
        stockStatus: item.stockStatus,
        stockQuantity: item.stockQuantity,
        trackStock: item.trackStock,
      });
      return !stock.isNotTracked;
    });
    const zeroStockItems = stockTrackedItems.filter((item) =>
      getCatalogStockSemantics({
        stockStatus: item.stockStatus,
        stockQuantity: item.stockQuantity,
        trackStock: item.trackStock,
      }).isZero
    );
    const lowStockItems = stockTrackedItems
      .filter((item) => {
        const stock = getCatalogStockSemantics({
          stockStatus: item.stockStatus,
          stockQuantity: item.stockQuantity,
          trackStock: item.trackStock,
        });
        return stock.isAvailable && stock.quantity != null && stock.quantity <= 3;
      })
      .sort((a, b) => {
        const stockA =
          getCatalogStockSemantics({
            stockStatus: a.stockStatus,
            stockQuantity: a.stockQuantity,
            trackStock: a.trackStock,
          }).quantity ?? Number.MAX_SAFE_INTEGER;
        const stockB =
          getCatalogStockSemantics({
            stockStatus: b.stockStatus,
            stockQuantity: b.stockQuantity,
            trackStock: b.trackStock,
          }).quantity ?? Number.MAX_SAFE_INTEGER;
        return stockA - stockB;
      });

    const estimatedInventoryValueCents = activeCatalogItems.reduce((sum, item) => {
      const stock = getCatalogStockSemantics({
        stockStatus: item.stockStatus,
        stockQuantity: item.stockQuantity,
        trackStock: item.trackStock,
      });
      const price = getCatalogPriceSemantics({
        priceStatus: item.priceStatus,
        priceCents: item.priceCents,
      });
      if (!stock.isAvailable || stock.quantity == null || !price.hasNumericPrice || price.priceCents == null) {
        return sum;
      }

      return sum + price.priceCents * stock.quantity;
    }, 0);

    const inventoryValueByCategoryCents = activeCatalogItems.reduce(
      (acc, item) => {
        const stock = getCatalogStockSemantics({
          stockStatus: item.stockStatus,
          stockQuantity: item.stockQuantity,
          trackStock: item.trackStock,
        });
        const price = getCatalogPriceSemantics({
          priceStatus: item.priceStatus,
          priceCents: item.priceCents,
        });
        if (!stock.isAvailable || stock.quantity == null || !price.hasNumericPrice || price.priceCents == null) {
          return acc;
        }

        const category = item.category;
        acc[category] = (acc[category] || 0) + price.priceCents * stock.quantity;
        return acc;
      },
      { pools: 0, chemicals: 0, accessories: 0, others: 0 } as Record<string, number>
    );

    const inStockItems = stockTrackedItems
      .filter((item) =>
        getCatalogStockSemantics({
          stockStatus: item.stockStatus,
          stockQuantity: item.stockQuantity,
          trackStock: item.trackStock,
        }).isAvailable
      )
      .sort((a, b) => {
        const stockA =
          getCatalogStockSemantics({
            stockStatus: a.stockStatus,
            stockQuantity: a.stockQuantity,
            trackStock: a.trackStock,
          }).quantity ?? 0;
        const stockB =
          getCatalogStockSemantics({
            stockStatus: b.stockStatus,
            stockQuantity: b.stockQuantity,
            trackStock: b.trackStock,
          }).quantity ?? 0;
        return stockB - stockA;
      });

    const successfulAiRuns = aiRuns.filter((run) => {
      const status = normalizeText(run.status);
      return ["success", "succeeded", "completed", "ok"].includes(status);
    });

    const failedAiRuns = aiRuns.filter((run) => {
      const status = normalizeText(run.status);
      return Boolean(run.status) && !["success", "succeeded", "completed", "ok"].includes(status);
    });

    const pendingAiQueue = aiQueue.filter((item) => !item.processed_at);
    const failedAiQueue = aiQueue.filter((item) => Boolean(item.processing_error));
    const currentRevenueCents: number | null = null;
    const monthlyGoal = buildMonthlySalesGoalState({
      row: monthlyGoalRow,
      currentRevenueCents,
    });

    const operationalAlerts = [
      pendingFollowups.length > 0
        ? {
            type: "followups",
            title: "Follow-ups pendentes",
            description: `${pendingFollowups.length} acompanhamento(s) aguardando atenção.`,
            severity: "attention",
          }
        : null,
      pendingAiQueue.length > 0
        ? {
            type: "ai_queue",
            title: "Ações da IA pendentes",
            description: `${pendingAiQueue.length} ação(ões) ainda não processada(s).`,
            severity: "attention",
          }
        : null,
      failedAiQueue.length > 0
        ? {
            type: "ai_queue_errors",
            title: "Falhas em ações da IA",
            description: `${failedAiQueue.length} ação(ões) com erro de processamento.`,
            severity: "critical",
          }
        : null,
      zeroStockItems.length > 0
        ? {
            type: "stock_zero",
            title: "Itens sem estoque",
            description: `${zeroStockItems.length} item(ns) com estoque zerado.`,
            severity: "attention",
          }
        : null,
      lowStockItems.length > 0
        ? {
            type: "stock_low",
            title: "Estoque baixo",
            description: `${lowStockItems.length} item(ns) com estoque baixo.`,
            severity: "info",
          }
        : null,
    ].filter(Boolean);

    return buildJsonResponse({
      ok: true,
      organizationId,
      storeId,
      generatedAt: now.toISOString(),
      period: {
        todayStart: toIso(todayStart),
        todayEnd: toIso(todayEnd),
        weekStart: toIso(weekStart),
        monthStart: toIso(monthStart),
        monthEnd: toIso(monthEnd),
        next30DaysEnd: toIso(next30DaysEnd),
      },
      summary: {
        leads: {
          total: leads.length,
          today: todayLeads.length,
          last7Days: weekLeads.length,
          month: monthLeads.length,
          byState: countBy(leads, "state"),
        },
        conversations: {
          total: conversations.length,
          active: activeConversations.length,
          humanActive: humanActiveConversations.length,
          byStatus: countBy(conversations, "status"),
        },
        messages: {
          today: todayMessages.length,
          last7Days: weekMessages.length,
          month: monthMessages.length,
          ai: aiMessages.length,
          humanOperator: humanOperatorMessages.length,
          customer: customerMessages.length,
          bySender: countBy(monthMessages, "sender"),
          byDirection: countBy(monthMessages, "direction"),
        },
        ai: {
          runsThisMonth: aiRuns.length,
          successfulRunsThisMonth: successfulAiRuns.length,
          failedRunsThisMonth: failedAiRuns.length,
          averageLatencyMs: averageNumbers(aiRuns.map((run) => run.latency_ms)),
          totalTokensPrompt: sumNumbers(aiRuns.map((run) => run.tokens_prompt)),
          totalTokensCompletion: sumNumbers(aiRuns.map((run) => run.tokens_completion)),
          totalCostUsd: Number(sumNumbers(aiRuns.map((run) => run.cost_usd)).toFixed(6)),
          decisionsThisMonth: aiDecisions.length,
          decisionsByAction: countBy(aiDecisions, "action"),
          pendingQueueActions: pendingAiQueue.length,
          failedQueueActions: failedAiQueue.length,
          aiParticipationPercent:
            monthMessages.length > 0 ? Math.round((aiMessages.length / monthMessages.length) * 100) : 0,
        },
        appointments: {
          today: todayAppointments.length,
          future: futureAppointments.length,
          byStatus: countBy(appointments, "status"),
          byType: countBy(appointments, "appointment_type"),
        },
        followups: {
          total: followups.length,
          pending: pendingFollowups.length,
          byStatus: countBy(followups, "followup_status"),
        },
        catalog: {
          totalItems: allDashboardCatalogItems.length,
          activeItems: activeCatalogItems.length,
          stockTrackedItems: stockTrackedItems.length,
          zeroStockItems: zeroStockItems.length,
          lowStockItems: lowStockItems.length,
          estimatedInventoryValueCents,
          inventoryValueByCategoryCents,
        },
        sales: {
          available: false,
          revenueMonthCents: currentRevenueCents,
          monthlyGoal,
          reason:
            "O dashboard ainda não encontrou uma tabela confiável de vendas/pedidos/faturamento. Não vou inventar faturamento sem base real.",
        },
      },
      lists: {
        recentLeads: leads.slice(0, 8).map((lead) => ({
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          state: lead.state,
          createdAt: lead.created_at,
          updatedAt: lead.updated_at,
        })),
        recentConversations: conversations.slice(0, 8).map((conversation) => ({
          id: conversation.id,
          leadId: conversation.lead_id,
          customerName: getConversationDisplayName(conversation, leadById),
          status: conversation.status,
          isHumanActive: conversation.is_human_active,
          lastMessageAt: conversation.last_message_at,
          lastMessagePreview: conversation.last_message_preview,
          lastMessageDirection: conversation.last_message_direction,
          lastMessageSender: conversation.last_message_sender,
        })),
        recentMessages: recentMessages.map((message) => ({
          id: message.id,
          conversationId: message.conversation_id,
          leadId: message.lead_id,
          sender: message.sender,
          direction: message.direction,
          messageType: message.message_type,
          content: message.content,
          createdAt: message.created_at,
          isAi: isAiMessage(message),
          isHumanOperator: isHumanOperatorMessage(message),
        })),
        conversationsWithAiPresence,
        nextAppointments,
        pendingFollowups: pendingFollowups.slice(0, 8).map((followup) => ({
          id: followup.id,
          appointmentId: followup.appointment_id,
          leadId: followup.lead_id,
          conversationId: followup.conversation_id,
          followupStatus: followup.followup_status,
          preferredChannel: followup.preferred_channel,
          promptCount: followup.prompt_count,
          scheduledEnd: followup.scheduled_end,
          lastPromptedAt: followup.last_prompted_at,
        })),
        allCatalogItems: allDashboardCatalogItems,
        inStockItems,
        lowStockItems,
        zeroStockItems,
        operationalAlerts,
      },
    });
    } catch (error: unknown) {
      console.error("[dashboard-metrics] unexpected failure", error);

      return buildJsonResponse(
        {
          ok: false,
          error: "DASHBOARD_METRICS_ROUTE_FAILED",
          message: "Nao foi possivel carregar as metricas do dashboard no momento.",
        },
        500
      );
    }
  };
}

export const GET = createDashboardMetricsGetHandler();
