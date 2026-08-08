// src/app/(app)/dashboard/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useStoreContext } from "@/components/StoreProvider";
import { getCatalogPriceSemantics, getCatalogStockSemantics } from "@/lib/catalog/presentation";

type DashboardMetrics = {
  ok: boolean;
  organizationId: string;
  storeId: string;
  generatedAt: string;
  storeSystemStartedAt?: string | null;
  storeCreatedAt?: string | null;
  summary: {
    leads: {
      total: number;
      today: number;
      last7Days: number;
      month: number;
      byState: Record<string, number>;
      bySource?: Record<string, number>;
    };
    conversations: {
      total: number;
      active: number;
      humanActive: number;
      byStatus: Record<string, number>;
    };
    messages: {
      today: number;
      last7Days: number;
      month: number;
      ai: number;
      humanOperator: number;
      customer: number;
      bySender: Record<string, number>;
      byDirection: Record<string, number>;
    };
    ai: {
      runsThisMonth: number;
      successfulRunsThisMonth: number;
      failedRunsThisMonth: number;
      averageLatencyMs: number | null;
      totalTokensPrompt: number;
      totalTokensCompletion: number;
      totalCostUsd: number;
      decisionsThisMonth: number;
      decisionsByAction: Record<string, number>;
      pendingQueueActions: number;
      failedQueueActions: number;
      aiParticipationPercent: number;
    };
    appointments: {
      today: number;
      future: number;
      byStatus: Record<string, number>;
      byType: Record<string, number>;
    };
    followups: {
      total: number;
      pending: number;
      byStatus: Record<string, number>;
    };
    catalog: {
      totalItems: number;
      activeItems: number;
      stockTrackedItems: number;
      zeroStockItems: number;
      lowStockItems: number;
      estimatedInventoryValueCents: number;
      inventoryValueByCategoryCents?: Record<string, number>;
    };
    sales: {
      available: boolean;
      reason: string;
    };
  };
  lists: {
    recentLeads: Array<{
      id: string;
      name: string | null;
      phone: string | null;
      state: string;
      createdAt: string;
      updatedAt: string | null;
    }>;
    recentConversations: Array<{
      id: string;
      leadId: string;
      customerName: string;
      status: string;
      isHumanActive: boolean;
      lastMessageAt: string | null;
      lastMessagePreview: string | null;
      lastMessageDirection: string | null;
      lastMessageSender: string | null;
    }>;
    recentMessages: Array<{
      id: string;
      conversationId: string;
      leadId: string | null;
      sender: string;
      direction: string;
      messageType: string;
      content: string;
      createdAt: string;
      isAi: boolean;
      isHumanOperator: boolean;
    }>;
    conversationsWithAiPresence: Array<{
      conversationId: string;
      leadId: string | null;
      customerName: string;
      totalMessages: number;
      aiMessages: number;
      humanMessages: number;
      customerMessages: number;
      aiParticipationPercent: number;
      lastMessageAt: string | null;
      lastMessagePreview: string | null;
    }>;
    nextAppointments: Array<{
      id: string;
      title: string;
      status: string;
      appointmentType: string;
      customerName: string | null;
      customerPhone: string | null;
      addressText?: string | null;
      address?: string | null;
      location?: string | null;
      scheduledStart: string;
      scheduledEnd: string;
      source: string;
    }>;
    pendingFollowups: Array<{
      id: string;
      appointmentId: string;
      leadId: string | null;
      conversationId: string | null;
      followupStatus: string;
      preferredChannel: string;
      promptCount: number;
      scheduledEnd: string;
      lastPromptedAt: string | null;
    }>;
      allCatalogItems?: Array<{
        id: string;
        sku: string | null;
        name: string;
        category?: string;
        categoryLabel?: string;
        priceCents: number | null;
        priceStatus?: string | null;
        currency: string;
        stockQuantity: number | null;
        stockStatus?: string | null;
        isActive: boolean;
        trackStock?: boolean;
      }>;
    inStockItems?: Array<{
      id: string;
      sku: string | null;
        name: string;
        category?: string;
        categoryLabel?: string;
        priceCents: number | null;
        priceStatus?: string | null;
        currency: string;
        stockQuantity: number | null;
        stockStatus?: string | null;
        isActive: boolean;
        trackStock?: boolean;
      }>;
    lowStockItems: Array<{
      id: string;
      sku: string | null;
        name: string;
        category?: string;
        categoryLabel?: string;
        priceCents: number | null;
        priceStatus?: string | null;
        currency: string;
        stockQuantity: number | null;
        stockStatus?: string | null;
        isActive: boolean;
        trackStock?: boolean;
      }>;
    zeroStockItems: Array<{
      id: string;
      sku: string | null;
        name: string;
        category?: string;
        categoryLabel?: string;
        priceCents: number | null;
        priceStatus?: string | null;
        currency: string;
        stockQuantity: number | null;
        stockStatus?: string | null;
        isActive: boolean;
        trackStock?: boolean;
      }>;
    operationalAlerts: Array<{
      type: string;
      title: string;
      description: string;
      severity: "info" | "attention" | "critical" | string;
    }>;
  };
};

type DashboardTab = "vendas" | "leads" | "ia" | "agenda" | "estoque";

const tabs: Array<{ id: DashboardTab; label: string; icon: string }> = [
  { id: "vendas", label: "Vendas", icon: "R$" },
  { id: "leads", label: "Leads", icon: "◎" },
  { id: "ia", label: "IA", icon: "◉" },
  { id: "agenda", label: "Agenda", icon: "◷" },
  { id: "estoque", label: "Estoque", icon: "▤" },
];

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function formatPercent(value: number | null | undefined) {
  return `${formatNumber(value || 0)}%`;
}

function formatCurrencyFromCents(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0) / 100);
}

function getDashboardItemStockLabel(item: {
  stockQuantity: number | null;
  stockStatus?: string | null;
  trackStock?: boolean;
}) {
  return getCatalogStockSemantics({
    stockStatus: item.stockStatus,
    stockQuantity: item.stockQuantity,
    trackStock: item.trackStock,
  }).label;
}

function getDashboardItemStockValue(item: {
  stockQuantity: number | null;
  stockStatus?: string | null;
  trackStock?: boolean;
}) {
  return getCatalogStockSemantics({
    stockStatus: item.stockStatus,
    stockQuantity: item.stockQuantity,
    trackStock: item.trackStock,
  }).valueLabel;
}

function getDashboardItemPriceLabel(item: {
  priceCents: number | null;
  priceStatus?: string | null;
}) {
  return getCatalogPriceSemantics({
    priceStatus: item.priceStatus,
    priceCents: item.priceCents,
  }).label;
}

function getDashboardInventoryValueLabel(item: {
  priceCents: number | null;
  priceStatus?: string | null;
  stockQuantity: number | null;
  stockStatus?: string | null;
  trackStock?: boolean;
}) {
  const price = getCatalogPriceSemantics({
    priceStatus: item.priceStatus,
    priceCents: item.priceCents,
  });
  const stock = getCatalogStockSemantics({
    stockStatus: item.stockStatus,
    stockQuantity: item.stockQuantity,
    trackStock: item.trackStock,
  });

  if (!price.hasNumericPrice || price.priceCents == null || !stock.isAvailable || stock.quantity == null) {
    return "Não calculado";
  }

  return formatCurrencyFromCents(price.priceCents * stock.quantity);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatLabel(value: string | null | undefined) {
  const rawText = String(value || "sem_status").replaceAll("_", " ").trim();
  const text = rawText.toLowerCase();

  const dictionary: Record<string, string> = {
    active: "Ativa",
    inactive: "Inativa",
    novo_lead: "Novo lead",
    qualificacao: "Qualificação",
    negociacao: "Negociação",
    fechamento_pagamento: "Fechamento / pagamento",
    scheduled: "Agendado",
    completed: "Concluído",
    cancelled: "Cancelado",
    rescheduled: "Remarcado",
    confirmed_completed: "Concluído confirmado",
    pending: "Pendente",
    resolved: "Resolvido",
    ai: "IA",
    user: "Responsável",
    human: "Humano",
    incoming: "Recebidas",
    outgoing: "Enviadas",
    technical_visit: "Visita técnica",
    "technical visit": "Visita técnica",
    installation: "Instalação",
    maintenance: "Manutenção",
    measurement: "Medição",
    meeting: "Reunião",
    visit: "Visita",
    appointment: "Compromisso",
    attention: "Atenção",
    critical: "Crítico",
    info: "Informação",
  };

  return dictionary[text] || rawText.charAt(0).toUpperCase() + rawText.slice(1);
}

function compactText(value: string | null | undefined, max = 110) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "Sem prévia";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function getMaxValue(values: number[]) {
  return Math.max(1, ...values);
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-5">
      <p className="text-sm text-zinc-500">{text}</p>
    </div>
  );
}

function HorizontalBars({
  items,
  maxItems = 7,
  barClassName = "bg-zinc-950",
}: {
  items: Record<string, number>;
  maxItems?: number;
  barClassName?: string;
}) {
  const entries = Object.entries(items || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxItems);

  const max = getMaxValue(entries.map(([, value]) => value));

  if (!entries.length) {
    return <EmptyState text="Ainda não há dados suficientes." />;
  }

  return (
    <div className="space-y-3">
      {entries.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-sm">
            <span className="min-w-0 break-words text-zinc-700">
              {formatLabel(label)}
            </span>
            <span className="shrink-0 font-medium text-zinc-950">
              {formatNumber(value)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
            <div
              className={`h-full rounded-full ${barClassName}`}
              style={{ width: `${Math.max(4, (value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function SplitProgress({
  ai,
  human,
  customer,
}: {
  ai: number;
  human: number;
  customer: number;
}) {
  const total = Math.max(1, ai + human + customer);
  const aiWidth = (ai / total) * 100;
  const humanWidth = (human / total) * 100;
  const customerWidth = (customer / total) * 100;

  return (
    <div className="min-w-0">
      <div className="flex h-4 overflow-hidden rounded-full border border-zinc-200 bg-zinc-100">
        <div className="bg-blue-600" style={{ width: `${aiWidth}%` }} />
        <div className="bg-cyan-500" style={{ width: `${humanWidth}%` }} />
        <div className="bg-emerald-300" style={{ width: `${customerWidth}%` }} />
      </div>

      <div className="mt-3 grid gap-2 text-xs text-zinc-600 sm:grid-cols-3">
        <div className="break-words">
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-600" />
          IA: {formatNumber(ai)}
        </div>
        <div className="break-words">
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-cyan-500" />
          Loja: {formatNumber(human)}
        </div>
        <div className="break-words">
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-300" />
          Clientes: {formatNumber(customer)}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-full rounded-full border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium leading-tight text-zinc-700">
      <span className="break-words">{children}</span>
    </span>
  );
}

function InfoList({
  items,
  emptyText,
}: {
  items: Array<{
    id: string;
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    meta?: React.ReactNode;
    right?: React.ReactNode;
  }>;
  emptyText: string;
}) {
  if (!items.length) {
    return <EmptyState text={emptyText} />;
  }

  return (
    <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
      {items.map((item) => (
        <div
          key={item.id}
          className="grid min-w-0 gap-3 px-4 py-3 text-sm md:grid-cols-[minmax(0,1fr)_auto]"
        >
          <div className="min-w-0">
            <div className="break-words font-medium text-zinc-950">
              {item.title}
            </div>
            {item.subtitle ? (
              <div className="mt-1 break-words leading-relaxed text-zinc-600">
                {item.subtitle}
              </div>
            ) : null}
            {item.meta ? (
              <div className="mt-2 flex min-w-0 flex-wrap gap-2 text-xs text-zinc-500">
                {item.meta}
              </div>
            ) : null}
          </div>
          {item.right ? (
            <div className="min-w-0 md:text-right">{item.right}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}


function CatalogItemsList({
  items,
  emptyText,
}: {
  items: Array<{
    id: string;
    sku: string | null;
    name: string;
    categoryLabel?: string;
    priceCents: number | null;
    priceStatus?: string | null;
    stockQuantity: number | null;
    stockStatus?: string | null;
    isActive: boolean;
    trackStock?: boolean;
  }>;
  emptyText: string;
}) {
  if (!items.length) {
    return <EmptyState text={emptyText} />;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-2xl border border-zinc-200 bg-white p-4"
        >
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="break-words text-base font-semibold text-zinc-950">
                {item.name}
              </h4>
              <p className="mt-1 break-words text-sm text-zinc-600">
                SKU: {item.sku || "Sem SKU"}
              </p>
            </div>

            <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-700">
              {item.isActive ? "Ativo" : "Inativo"}
            </span>
          </div>

          <div className="mt-3 grid gap-2 text-sm text-zinc-600 sm:grid-cols-2">
            <div>
              <span className="font-medium text-zinc-950">Categoria: </span>
              {item.categoryLabel || "Sem categoria"}
            </div>
            <div>
              <span className="font-medium text-zinc-950">Estoque: </span>
              {getDashboardItemStockValue(item)}
            </div>
            <div>
              <span className="font-medium text-zinc-950">Valor unitário: </span>
              {getDashboardItemPriceLabel(item)}
            </div>
            <div>
              <span className="font-medium text-zinc-950">Valor em estoque: </span>
              {getDashboardInventoryValueLabel(item)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}



function DashboardPanel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 rounded-[6px] border border-zinc-300 bg-white p-3 shadow-sm ${className}`}
    >
      {children}
    </section>
  );
}

function PanelTitle({
  title,
  helper,
}: {
  title: string;
  helper?: string;
}) {
  return (
    <div className="mb-2 min-w-0">
      <h3 className="break-words text-sm font-semibold uppercase tracking-[0.08em] text-zinc-950">
        {title}
      </h3>
      {helper ? (
        <p className="mt-1 break-words text-[11px] leading-relaxed text-zinc-500">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

type DashboardMetricAccent =
  | "neutral"
  | "blue"
  | "cyan"
  | "green"
  | "amber"
  | "orange"
  | "red";

const dashboardMetricAccentClasses: Record<
  DashboardMetricAccent,
  { border: string; top: string; value: string; hover: string }
> = {
  neutral: {
    border: "border-zinc-300",
    top: "border-t-zinc-700",
    value: "text-zinc-950",
    hover: "hover:border-zinc-950",
  },
  blue: {
    border: "border-blue-200",
    top: "border-t-blue-600",
    value: "text-blue-700",
    hover: "hover:border-blue-500",
  },
  cyan: {
    border: "border-cyan-200",
    top: "border-t-cyan-600",
    value: "text-cyan-700",
    hover: "hover:border-cyan-500",
  },
  green: {
    border: "border-emerald-200",
    top: "border-t-emerald-600",
    value: "text-emerald-700",
    hover: "hover:border-emerald-500",
  },
  amber: {
    border: "border-amber-200",
    top: "border-t-amber-500",
    value: "text-amber-700",
    hover: "hover:border-amber-500",
  },
  orange: {
    border: "border-orange-200",
    top: "border-t-orange-500",
    value: "text-orange-700",
    hover: "hover:border-orange-500",
  },
  red: {
    border: "border-red-200",
    top: "border-t-red-500",
    value: "text-red-700",
    hover: "hover:border-red-500",
  },
};

function ExecutiveNumberCard({
  title,
  value,
  helper,
  className = "",
  accent = "neutral",
}: {
  title: string;
  value: string | number;
  helper?: string;
  className?: string;
  accent?: DashboardMetricAccent;
}) {
  const classes = dashboardMetricAccentClasses[accent];

  return (
    <div
      className={`min-w-0 rounded-[6px] border border-t-4 bg-white p-2.5 text-center shadow-sm ${classes.border} ${classes.top} ${className}`}
    >
      <p className="break-words text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
        {title}
      </p>
      <p className={`mt-1 break-words text-xl font-semibold tracking-tight ${classes.value}`}>
        {value}
      </p>
      {helper ? (
        <p className="mt-1 break-words text-[11px] leading-relaxed text-zinc-500">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

function ClickableExecutiveNumberCard({
  title,
  value,
  helper,
  onClick,
  accent = "neutral",
}: {
  title: string;
  value: string | number;
  helper?: string;
  onClick: () => void;
  accent?: DashboardMetricAccent;
}) {
  const classes = dashboardMetricAccentClasses[accent];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-0 rounded-[6px] border border-t-4 bg-white p-2.5 text-center shadow-sm transition hover:shadow ${classes.border} ${classes.top} ${classes.hover}`}
    >
      <p className="break-words text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
        {title}
      </p>
      <p className={`mt-1 break-words text-xl font-semibold tracking-tight ${classes.value}`}>
        {value}
      </p>
      {helper ? (
        <p className="mt-1 break-words text-[11px] leading-relaxed text-zinc-500">
          {helper}
        </p>
      ) : null}
    </button>
  );
}

function GoalGauge({
  percent,
  onClick,
}: {
  percent: number;
  onClick: () => void;
}) {
  const configuredGoalCents = 0;
  const currentRevenueCents = 0;
  const hasGoal = configuredGoalCents > 0;
  const displayPercent = hasGoal
    ? Math.round((currentRevenueCents / configuredGoalCents) * 100)
    : percent;

  const arcPercent = Math.max(0, Math.min(displayPercent, 100));
  const arcLength = 251.2;
  const filledLength = (arcPercent / 100) * arcLength;

  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-0 min-w-0 rounded-[4px] border border-zinc-300 bg-white p-3 text-left shadow-sm transition hover:border-zinc-950 hover:shadow"
    >
      <div className="text-center">
        <h3 className="text-base font-medium text-zinc-950">Meta do mês</h3>
      </div>

      <div className="mt-2 flex flex-col items-center">
        <div className="relative h-[164px] w-[310px] max-w-full">
          <svg
            viewBox="0 0 310 165"
            className="h-full w-full overflow-visible"
            aria-label="Progresso da meta do mês"
          >
            <path
              d="M 38 126 A 117 117 0 0 1 272 126"
              fill="none"
              stroke="#e4e4e7"
              strokeWidth="22"
              strokeLinecap="round"
            />
            {arcPercent > 0 ? (
              <path
                d="M 38 126 A 117 117 0 0 1 272 126"
                fill="none"
                stroke="#16a34a"
                strokeWidth="22"
                strokeLinecap="round"
                strokeDasharray={`${filledLength} ${arcLength}`}
              />
            ) : null}
          </svg>

          <div className="absolute left-1/2 top-[82px] -translate-x-1/2 -translate-y-1/2">
            <span className="inline-flex min-w-[62px] items-center justify-center rounded-full border border-zinc-200 bg-white px-3 py-2 text-lg font-semibold leading-none text-zinc-950 shadow-sm">
              {hasGoal ? formatPercent(displayPercent) : "0%"}
            </span>
          </div>

          <span className="absolute bottom-[6px] left-[24px] inline-flex min-w-[44px] -translate-x-1/2 items-center justify-center rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-semibold leading-none text-zinc-700">
            0%
          </span>
          <span className="absolute bottom-[6px] right-[24px] inline-flex min-w-[44px] translate-x-1/2 items-center justify-center rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-semibold leading-none text-zinc-700">
            100%
          </span>
        </div>

        <div className="-mt-1 w-full max-w-[270px] text-center">
          <p className="break-words text-base font-medium leading-snug text-zinc-950">
            Meta: {hasGoal ? formatCurrencyFromCents(configuredGoalCents) : "Não definida"}
          </p>
          <p className="mt-1 break-words text-base font-medium leading-snug text-zinc-950">
            Hoje: {hasGoal ? formatCurrencyFromCents(currentRevenueCents) : "Sem vendas"}
          </p>
        </div>
      </div>
    </button>
  );
}

function CommercialReadingPanel({
  salesAvailable,
  leadsMonth,
  pendingFollowups,
  futureAppointments,
  onClick,
}: {
  salesAvailable: boolean;
  leadsMonth: number;
  pendingFollowups: number;
  futureAppointments: number;
  onClick: () => void;
}) {
  const primaryInsight = pendingFollowups
    ? {
        eyebrow: "Prioridade agora",
        title: `${formatNumber(pendingFollowups)} follow-up(s) precisam de atenção`,
        text: "Os acompanhamentos pendentes são o ponto comercial mais imediato para trabalhar agora.",
        accent: "border-amber-500",
        eyebrowColor: "text-amber-700",
      }
    : futureAppointments
      ? {
          eyebrow: "Movimento comercial",
          title: `${formatNumber(futureAppointments)} compromisso(s) futuro(s) registrado(s)`,
          text: "Os próximos compromissos são o movimento comercial mais concreto disponível neste momento.",
          accent: "border-emerald-600",
          eyebrowColor: "text-emerald-700",
        }
      : leadsMonth
        ? {
            eyebrow: "Demanda",
            title: `${formatNumber(leadsMonth)} lead(s) entraram neste mês`,
            text: "Há demanda registrada para trabalhar e acompanhar a evolução no funil.",
            accent: "border-cyan-600",
            eyebrowColor: "text-cyan-700",
          }
        : {
            eyebrow: "Cenário atual",
            title: "Sem movimento comercial novo no período",
            text: "Ainda não há novos leads, compromissos futuros ou acompanhamentos que indiquem uma prioridade mais específica.",
            accent: "border-slate-500",
            eyebrowColor: "text-slate-600",
          };

  const compactInsights = [
    {
      label: "Demanda",
      value: leadsMonth
        ? `${formatNumber(leadsMonth)} lead(s) no mês`
        : "Sem novos leads",
      dot: "bg-cyan-600",
    },
    {
      label: "Resultado",
      value: salesAvailable ? "Base de vendas localizada" : "Vendas ainda sem base",
      dot: "bg-blue-600",
    },
    {
      label: "Próximo passo",
      value: pendingFollowups
        ? "Priorizar acompanhamentos"
        : futureAppointments
          ? "Acompanhar compromissos"
          : leadsMonth
            ? "Avançar leads do funil"
            : "Aguardar nova demanda",
      dot: "bg-emerald-600",
    },
  ];

  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full min-w-0 rounded-[4px] border border-zinc-300 bg-white p-4 text-left shadow-sm transition hover:border-zinc-950 hover:shadow"
    >
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-zinc-950">
            Leitura comercial
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            Resumo do que merece atenção comercial agora.
          </p>
        </div>
        <span className="shrink-0 text-xs font-semibold text-zinc-600">
          Ver análise ›
        </span>
      </div>

      <div className={`mt-4 border-l-4 ${primaryInsight.accent} pl-4`}>
        <p
          className={`text-[10px] font-semibold uppercase tracking-[0.13em] ${primaryInsight.eyebrowColor}`}
        >
          {primaryInsight.eyebrow}
        </p>
        <p className="mt-1 break-words text-lg font-semibold tracking-tight text-zinc-950">
          {primaryInsight.title}
        </p>
        <p className="mt-1 max-w-4xl break-words text-sm leading-relaxed text-zinc-600">
          {primaryInsight.text}
        </p>
      </div>

      <div className="mt-5 grid min-w-0 border-t border-zinc-200 pt-4 sm:grid-cols-3">
        {compactInsights.map((item, index) => (
          <div
            key={item.label}
            className={`min-w-0 py-2 sm:py-0 ${
              index > 0 ? "sm:border-l sm:border-zinc-200 sm:pl-4" : ""
            } ${index < compactInsights.length - 1 ? "sm:pr-4" : ""}`}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${item.dot}`} />
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                {item.label}
              </span>
            </div>
            <p className="mt-2 break-words text-sm font-semibold text-zinc-950">
              {item.value}
            </p>
          </div>
        ))}
      </div>
    </button>
  );
}

function CommercialReadingDetail({
  salesAvailable,
  salesStatusText,
  leadsMonth,
  pendingFollowups,
  futureAppointments,
}: {
  salesAvailable: boolean;
  salesStatusText: string;
  leadsMonth: number;
  pendingFollowups: number;
  futureAppointments: number;
}) {
  const nextStep = pendingFollowups
    ? `Priorizar os ${formatNumber(pendingFollowups)} acompanhamento(s) pendente(s).`
    : futureAppointments
      ? `Acompanhar os ${formatNumber(futureAppointments)} compromisso(s) futuro(s) já registrados.`
      : leadsMonth
        ? "Trabalhar os leads que já entraram no funil e acompanhar a evolução deles."
        : "Aguardar nova demanda mantendo a operação pronta para responder rapidamente.";

  const items = [
    {
      label: "Resultado",
      value: salesAvailable ? "Leitura parcial" : "Ainda indisponível",
      text: salesAvailable
        ? "A origem de vendas foi localizada, mas os totais necessários para comparar resultado e tendência ainda não estão disponíveis."
        : salesStatusText,
      dot: "bg-blue-600",
    },
    {
      label: "Demanda",
      value: `${formatNumber(leadsMonth)} lead(s) no mês`,
      text: leadsMonth
        ? "Há entrada de demanda registrada neste mês. A conversão poderá ser cruzada com vendas quando os totais comerciais estiverem disponíveis."
        : "Nenhum lead novo foi registrado no mês atual.",
      dot: "bg-cyan-600",
    },
    {
      label: "Atenção",
      value: pendingFollowups ? `${formatNumber(pendingFollowups)} pendente(s)` : "Em dia",
      text: pendingFollowups
        ? "Existem acompanhamentos pendentes que podem influenciar o avanço das oportunidades."
        : "Não há follow-ups pendentes neste momento.",
      dot: "bg-amber-500",
    },
    {
      label: "Próximo passo",
      value: nextStep,
      text: "A recomendação é derivada apenas dos sinais operacionais que o dashboard já consegue comprovar.",
      dot: "bg-emerald-600",
    },
  ];

  return (
    <div className="space-y-4">
      <DashboardPanel>
        <PanelTitle
          title="Leitura do momento"
          helper="Interpretação dos sinais comerciais que o dashboard já consegue comprovar."
        />

        <div className="divide-y divide-zinc-100">
          {items.map((item) => (
            <div
              key={item.label}
              className="grid min-w-0 gap-2 py-3 sm:grid-cols-[150px_minmax(0,1fr)]"
            >
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.dot}`} />
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
                  {item.label}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-950">{item.value}</p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-600">{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      </DashboardPanel>

      <DashboardPanel>
        <PanelTitle
          title="O que esta leitura vai comparar"
          helper="Assim que os dados reais de vendas estiverem completos."
        />
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            "Meta x ritmo esperado do mês",
            "Vendas atuais x período anterior",
            "Conversão de leads",
            "Evolução do ticket médio",
            "Produto ou categoria que mais contribui",
            "Região que mais contribui para o resultado",
          ].map((item) => (
            <div
              key={item}
              className="border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
            >
              {item}
            </div>
          ))}
        </div>
      </DashboardPanel>
    </div>
  );
}

type SalesPeriodView = "year" | "month" | "week" | "day";

type SalesAccent = "blue" | "green" | "cyan" | "amber" | "orange" | "slate";

const salesPeriodViews: Array<{ id: SalesPeriodView; label: string }> = [
  { id: "year", label: "Ano" },
  { id: "month", label: "Mês" },
  { id: "week", label: "Semana" },
  { id: "day", label: "Dia" },
];

const salesAccentClasses: Record<
  SalesAccent,
  { border: string; bar: string; badge: string; value: string }
> = {
  blue: {
    border: "border-blue-200",
    bar: "bg-blue-600",
    badge: "bg-blue-50 text-blue-700",
    value: "text-blue-700",
  },
  green: {
    border: "border-emerald-200",
    bar: "bg-emerald-600",
    badge: "bg-emerald-50 text-emerald-700",
    value: "text-emerald-700",
  },
  cyan: {
    border: "border-cyan-200",
    bar: "bg-cyan-600",
    badge: "bg-cyan-50 text-cyan-700",
    value: "text-cyan-700",
  },
  amber: {
    border: "border-amber-200",
    bar: "bg-amber-500",
    badge: "bg-amber-50 text-amber-700",
    value: "text-amber-700",
  },
  orange: {
    border: "border-orange-200",
    bar: "bg-orange-500",
    badge: "bg-orange-50 text-orange-700",
    value: "text-orange-700",
  },
  slate: {
    border: "border-slate-300",
    bar: "bg-slate-700",
    badge: "bg-slate-100 text-slate-700",
    value: "text-slate-800",
  },
};

function SalesMetricTile({
  title,
  value,
  helper,
  accent = "slate",
  onClick,
}: {
  title: string;
  value: string;
  helper?: string;
  accent?: SalesAccent;
  onClick: () => void;
}) {
  const classes = salesAccentClasses[accent];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative min-w-0 overflow-hidden rounded-[4px] border bg-white p-3 text-left shadow-sm transition hover:border-zinc-950 hover:shadow ${classes.border}`}
    >
      <span className={`absolute inset-x-0 top-0 h-1 ${classes.bar}`} />
      <p className="pt-1 text-[11px] font-semibold uppercase tracking-[0.11em] text-zinc-500">
        {title}
      </p>
      <p className={`mt-2 break-words text-xl font-semibold tracking-tight ${classes.value}`}>
        {value}
      </p>
      {helper ? (
        <p className="mt-1 break-words text-[11px] leading-relaxed text-zinc-500">
          {helper}
        </p>
      ) : null}
    </button>
  );
}

function startOfSalesWeek(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const weekday = date.getDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  date.setDate(date.getDate() + offset);
  return date;
}

function addSalesDays(value: Date, amount: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function capitalizeSalesLabel(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function formatSalesDay(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
  })
    .format(value)
    .replace(".", "");
}

function formatSalesDayNumber(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
  }).format(value);
}

function formatSalesMonthShort(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    month: "short",
  })
    .format(value)
    .replace(".", "");
}

function formatSalesPeriodTitle(view: SalesPeriodView, anchorDate: Date) {
  if (view === "year") {
    return "Anos disponíveis";
  }

  if (view === "month") {
    return `Meses de ${anchorDate.getFullYear()}`;
  }

  if (view === "week") {
    const start = startOfSalesWeek(anchorDate);
    const end = addSalesDays(start, 6);
    const startText = new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "short",
    }).format(start);
    const endText = new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(end);

    return `Semana de ${startText} — ${endText}`;
  }

  return capitalizeSalesLabel(
    new Intl.DateTimeFormat("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(anchorDate)
  );
}

function shiftSalesPeriod(anchorDate: Date, view: SalesPeriodView, direction: -1 | 1) {
  const next = new Date(anchorDate);

  if (view === "month") {
    next.setFullYear(next.getFullYear() + direction);
  } else if (view === "week") {
    next.setDate(next.getDate() + direction * 7);
  } else if (view === "day") {
    next.setDate(next.getDate() + direction);
  }

  return next;
}

function SalesCalendarPlaceholder({
  label = "Sem dados",
  helper = "Aguardando base real de vendas",
}: {
  label?: string;
  helper?: string;
}) {
  return (
    <div className="mt-3 border-t border-zinc-200 pt-3">
      <p className="text-sm font-semibold text-zinc-800">{label}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{helper}</p>
    </div>
  );
}

function SalesPeriodExplorer({
  view,
  anchorDate,
  onViewChange,
  onAnchorDateChange,
  salesAvailable,
  statusText,
  systemStartYear,
}: {
  view: SalesPeriodView;
  anchorDate: Date;
  onViewChange: (view: SalesPeriodView) => void;
  onAnchorDateChange: (date: Date) => void;
  salesAvailable: boolean;
  statusText: string;
  systemStartYear: number;
}) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const safeStartYear = Math.min(Math.max(2000, systemStartYear), currentYear);
  const weekStart = startOfSalesWeek(anchorDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => addSalesDays(weekStart, index));
  const yearMonths = Array.from({ length: 12 }, (_, index) =>
    new Date(anchorDate.getFullYear(), index, 1)
  );
  const yearOptions = Array.from(
    { length: currentYear - safeStartYear + 1 },
    (_, index) => new Date(safeStartYear + index, 0, 1)
  );

  const emptyHelper = salesAvailable
    ? "A origem de vendas foi localizada, mas os totais ainda não vieram nesta resposta."
    : "Aguardando uma origem confiável de vendas, pedidos ou faturamento.";

  function goToday() {
    onAnchorDateChange(new Date());
    onViewChange("day");
  }

  return (
    <DashboardPanel className="rounded-[4px] border-zinc-400 p-0 shadow-sm">
      <div className="border-b border-zinc-300 bg-zinc-950 px-4 py-3 text-white">
        <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
              Histórico de vendas
            </p>
            <h3 className="mt-1 break-words text-lg font-semibold">
              {formatSalesPeriodTitle(view, anchorDate)}
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-[4px] border border-zinc-700 bg-zinc-900">
              {view !== "year" ? (
                <button
                  type="button"
                  onClick={() => onAnchorDateChange(shiftSalesPeriod(anchorDate, view, -1))}
                  className="border-r border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-800"
                  aria-label="Período anterior"
                >
                  ‹
                </button>
              ) : null}
              <button
                type="button"
                onClick={goToday}
                className="px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800"
              >
                Hoje
              </button>
              {view !== "year" ? (
                <button
                  type="button"
                  onClick={() => onAnchorDateChange(shiftSalesPeriod(anchorDate, view, 1))}
                  className="border-l border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-800"
                  aria-label="Próximo período"
                >
                  ›
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-1 rounded-[4px] border border-zinc-700 bg-zinc-900 p-1">
              {salesPeriodViews.map((item) => {
                const isActive = item.id === view;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onViewChange(item.id)}
                    className={`rounded-[3px] px-3 py-1.5 text-xs font-semibold transition ${
                      isActive
                        ? "bg-white text-zinc-950"
                        : "text-zinc-300 hover:bg-zinc-800 hover:text-white"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-zinc-100 p-3">
        {view === "year" ? (
          <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {yearOptions.map((yearDate) => {
              const isCurrentYear = yearDate.getFullYear() === currentYear;

              return (
                <button
                  key={yearDate.getFullYear()}
                  type="button"
                  onClick={() => {
                    onAnchorDateChange(
                      new Date(yearDate.getFullYear(), anchorDate.getMonth(), 1)
                    );
                    onViewChange("month");
                  }}
                  className={`min-h-[116px] min-w-0 rounded-[4px] border bg-white p-3 text-left shadow-sm transition hover:border-blue-500 hover:shadow ${
                    isCurrentYear ? "border-blue-500 ring-1 ring-blue-100" : "border-zinc-300"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xl font-semibold text-zinc-950">
                      {yearDate.getFullYear()}
                    </span>
                    <span className="rounded-[3px] bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">
                      {isCurrentYear ? "Atual" : "Ver meses"}
                    </span>
                  </div>
                  <SalesCalendarPlaceholder helper={emptyHelper} />
                </button>
              );
            })}
          </div>
        ) : null}

        {view === "month" ? (
          <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {yearMonths.map((month) => {
              const isCurrentMonth =
                month.getFullYear() === now.getFullYear() &&
                month.getMonth() === now.getMonth();

              return (
                <button
                  key={month.toISOString()}
                  type="button"
                  onClick={() => {
                    const targetDate = isCurrentMonth
                      ? new Date()
                      : new Date(month.getFullYear(), month.getMonth(), 1);
                    onAnchorDateChange(targetDate);
                    onViewChange("week");
                  }}
                  className={`min-h-[126px] min-w-0 rounded-[4px] border bg-white p-3 text-left shadow-sm transition hover:border-cyan-500 hover:shadow ${
                    isCurrentMonth ? "border-cyan-500 ring-1 ring-cyan-100" : "border-zinc-300"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-zinc-950">
                      {capitalizeSalesLabel(
                        new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(month)
                      )}
                    </span>
                    {isCurrentMonth ? (
                      <span className="rounded-[3px] bg-cyan-600 px-2 py-1 text-[10px] font-semibold text-white">
                        Atual
                      </span>
                    ) : (
                      <span className="rounded-[3px] bg-cyan-50 px-2 py-1 text-[10px] font-semibold text-cyan-700">
                        Ver semana
                      </span>
                    )}
                  </div>
                  <SalesCalendarPlaceholder helper={emptyHelper} />
                </button>
              );
            })}
          </div>
        ) : null}

        {view === "week" ? (
          <div className="space-y-3">
            <div className="overflow-x-auto pb-1">
              <div className="grid min-w-[770px] grid-cols-7 gap-2">
                {weekDays.map((day) => {
                  const isToday = isSameLocalDate(day.toISOString());
                  const isSelected = isSameLocalDate(
                    day.toISOString(),
                    anchorDate
                  );

                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      onClick={() => onAnchorDateChange(day)}
                      className={`relative min-h-[112px] min-w-0 rounded-[6px] border bg-white px-3 py-3 text-left shadow-sm transition hover:border-cyan-500 hover:shadow ${
                        isSelected
                          ? "border-cyan-500 ring-2 ring-cyan-100"
                          : "border-zinc-300"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                            {formatSalesDay(day)}
                          </p>
                          <p className="mt-1 text-2xl font-semibold text-zinc-950">
                            {formatSalesDayNumber(day)}
                          </p>
                        </div>
                        {isToday ? (
                          <span className="rounded-full bg-cyan-600 px-2 py-1 text-[9px] font-semibold text-white">
                            Hoje
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-3 border-t border-zinc-200 pt-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-700">
                          Vendas
                        </p>
                        <p className="mt-1 text-sm font-semibold text-zinc-950">
                          Sem dados
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[6px] border border-zinc-300 bg-white p-4 shadow-sm">
              <div className="flex min-w-0 flex-col gap-3 border-b border-zinc-200 pb-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-cyan-700">
                    Dia selecionado
                  </p>
                  <h4 className="mt-1 text-base font-semibold text-zinc-950">
                    {capitalizeSalesLabel(
                      new Intl.DateTimeFormat("pt-BR", {
                        weekday: "long",
                        day: "2-digit",
                        month: "long",
                      }).format(anchorDate)
                    )}
                  </h4>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                    Selecione outro dia acima para comparar a semana sem sair desta visão.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onViewChange("day")}
                  className="shrink-0 rounded-[4px] border border-zinc-300 bg-zinc-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800"
                >
                  Abrir dia
                </button>
              </div>

              <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="border-l-4 border-emerald-500 bg-emerald-50 px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-700">
                    Vendas
                  </p>
                  <p className="mt-1 text-base font-semibold text-zinc-950">Sem dados</p>
                </div>
                <div className="border-l-4 border-blue-500 bg-blue-50 px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-blue-700">
                    Faturamento
                  </p>
                  <p className="mt-1 text-base font-semibold text-zinc-950">Sem dados</p>
                </div>
                <div className="border-l-4 border-amber-500 bg-amber-50 px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-700">
                    Ticket médio
                  </p>
                  <p className="mt-1 text-base font-semibold text-zinc-950">Sem dados</p>
                </div>
                <div className="border-l-4 border-slate-500 bg-slate-50 px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-700">
                    Conversão
                  </p>
                  <p className="mt-1 text-base font-semibold text-zinc-950">Sem dados</p>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {view === "day" ? (
          <div className="space-y-3">
            <div className="grid min-w-0 gap-2 sm:grid-cols-3">
              <div className="border-l-4 border-emerald-500 bg-emerald-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-emerald-700">
                  Vendas do dia
                </p>
                <p className="mt-2 text-xl font-semibold text-zinc-950">Sem dados</p>
              </div>
              <div className="border-l-4 border-blue-500 bg-blue-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-blue-700">
                  Faturamento
                </p>
                <p className="mt-2 text-xl font-semibold text-zinc-950">Sem dados</p>
              </div>
              <div className="border-l-4 border-amber-500 bg-amber-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-amber-700">
                  Ticket médio
                </p>
                <p className="mt-2 text-xl font-semibold text-zinc-950">Sem dados</p>
              </div>
            </div>

            <div className="rounded-[4px] border border-zinc-300 bg-white p-4 shadow-sm">
              <div className="flex min-w-0 items-center justify-between gap-3 border-b border-zinc-200 pb-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-700">
                    Vendas de {formatSalesDayNumber(anchorDate)} {formatSalesMonthShort(anchorDate)}
                  </p>
                  <p className="mt-1 text-sm text-zinc-600">
                    Cada venda aparecerá individualmente aqui, com cliente, itens, valor, forma de pagamento e status.
                  </p>
                </div>
                <span className="shrink-0 rounded-[3px] bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-600">
                  0 registros
                </span>
              </div>
              <div className="mt-3 border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm leading-relaxed text-zinc-500">
                {statusText}
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-3 border-t border-zinc-300 pt-3">
          <p className="text-xs leading-relaxed text-zinc-500">
            Nenhum valor de venda é estimado. A navegação temporal está pronta e será preenchida apenas com dados reais da operação.
          </p>
        </div>
      </div>
    </DashboardPanel>
  );
}

type LeadDetailDrawer = "today" | "last7" | "month" | "total";

type SalesDetailDrawer =
  | "goal"
  | "revenueMonth"
  | "salesToday"
  | "salesWeek"
  | "salesMonth"
  | "ticketAverage"
  | "conversion"
  | "region"
  | "products"
  | "payments"
  | "commercialReading";

type PaymentSlice = {
  label: string;
  percent: number;
  color: string;
};

function PaymentDonut({
  slices,
  emptyText,
}: {
  slices: PaymentSlice[];
  emptyText: string;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.percent, 0);

  let offset = 0;
  const gradient = total
    ? slices
        .map((slice) => {
          const start = offset;
          const end = offset + slice.percent;
          offset = end;
          return `${slice.color} ${start}% ${end}%`;
        })
        .join(", ")
    : "#f4f4f5 0% 100%";

  const visibleSlices = total ? slices.filter((slice) => slice.percent > 0) : [];

  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-[88px_minmax(0,1fr)] sm:items-center">
      <div className="flex justify-center">
        <div
          className="relative h-20 w-20 rounded-full border border-zinc-200 shadow-sm"
          style={{ background: `conic-gradient(${gradient})` }}
        >
          <div className="absolute inset-4 flex flex-col items-center justify-center rounded-full border border-zinc-200 bg-white text-center">
            <span className="text-xs font-semibold leading-tight text-zinc-950">
              {total ? `${formatNumber(total)}%` : "Sem dados"}
            </span>
          </div>
        </div>
      </div>

      <div className="min-w-0">
        <div className="grid min-w-0 gap-x-3 gap-y-2 sm:grid-cols-2">
          {visibleSlices.map((slice) => (
            <div key={slice.label} className="flex min-w-0 items-center gap-2 text-xs">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: slice.color }}
              />
              <span className="min-w-0 flex-1 break-words text-zinc-700">
                {slice.label}
              </span>
              <span className="shrink-0 font-medium text-zinc-950">
                {formatPercent(slice.percent)}
              </span>
            </div>
          ))}
        </div>
        {!total ? (
          <p className="mt-3 break-words rounded-[6px] border border-dashed border-zinc-300 bg-zinc-50 p-2 text-xs leading-relaxed text-zinc-500">
            {emptyText}
          </p>
        ) : null}
      </div>
    </div>
  );
}

const leadSourcePalette = [
  "#2563eb",
  "#059669",
  "#0891b2",
  "#d97706",
  "#ea580c",
  "#475569",
  "#dc2626",
  "#0f766e",
];

function LeadSourceDonut({
  sources,
  emptyText,
}: {
  sources: Record<string, number>;
  emptyText: string;
}) {
  const entries = Object.entries(sources || {})
    .filter(([, value]) => Number(value) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  const total = entries.reduce((sum, [, value]) => sum + Number(value || 0), 0);

  const segments = entries.map(([label, value], index) => {
    const percent = total > 0 ? (Number(value) / total) * 100 : 0;
    const start = entries
      .slice(0, index)
      .reduce(
        (sum, [, previousValue]) =>
          sum + (total > 0 ? (Number(previousValue) / total) * 100 : 0),
        0
      );
    const end = start + percent;

    return {
      label,
      value: Number(value),
      percent,
      color: leadSourcePalette[index % leadSourcePalette.length],
      start,
      end,
    };
  });

  const gradient = segments.length
    ? segments
        .map((segment) => `${segment.color} ${segment.start}% ${segment.end}%`)
        .join(", ")
    : "#e4e4e7 0% 100%";

  return (
    <DashboardPanel className="min-h-0 border-cyan-200">
      <PanelTitle
        title="De onde os leads vêm"
        helper="Participação de cada origem no total de leads com origem identificada."
      />

      <div className="grid min-w-0 gap-5 sm:grid-cols-[178px_minmax(0,1fr)] sm:items-center">
        <div className="mx-auto flex w-full items-center justify-center">
          <div
            className="relative h-[148px] w-[148px] shrink-0 rounded-full border border-zinc-300 shadow-sm"
            style={{ background: `conic-gradient(${gradient})` }}
            aria-label="Distribuição percentual da origem dos leads"
          >
            <div className="absolute inset-[31px] flex items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-white text-center shadow-inner">
              <div className="flex w-[78px] flex-col items-center justify-center px-1">
                <span className="block text-xl font-semibold leading-none text-zinc-950">
                  {segments.length ? "100%" : "—"}
                </span>
                <span className="mt-2 block whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
                  {segments.length ? "dos leads" : "sem dados"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {segments.length ? (
          <div className="space-y-2">
            {segments.map((segment) => (
              <div
                key={segment.label}
                className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-zinc-100 pb-2 last:border-b-0"
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: segment.color }}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-800">
                    {formatLabel(segment.label)}
                  </p>
                  <p className="text-[10px] text-zinc-500">
                    {formatNumber(segment.value)} lead(s)
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold text-zinc-950">
                  {new Intl.NumberFormat("pt-BR", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 1,
                  }).format(segment.percent)}%
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-[6px] border border-dashed border-zinc-300 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-500">
            {emptyText}
          </p>
        )}
      </div>
    </DashboardPanel>
  );
}

const DASHBOARD_ACTIVE_TAB_STORAGE_KEY = "zion.dashboard.activeTab";
const DASHBOARD_SCROLL_STORAGE_KEY = "zion.dashboard.scrollY";
const DASHBOARD_STORE_START_YEAR_STORAGE_PREFIX = "zion.dashboard.storeStartYear";

function isDashboardTab(value: string | null): value is DashboardTab {
  return Boolean(value && tabs.some((tab) => tab.id === value));
}

function isSameLocalDate(value: string | null | undefined, referenceDate = new Date()) {
  if (!value) return false;

  const date = new Date(value);

  return (
    date.getFullYear() === referenceDate.getFullYear() &&
    date.getMonth() === referenceDate.getMonth() &&
    date.getDate() === referenceDate.getDate()
  );
}

function getAppointmentRouteAddress(
  appointment: DashboardMetrics["lists"]["nextAppointments"][number]
) {
  return String(
    appointment.addressText || appointment.address || appointment.location || ""
  ).trim();
}

function buildGoogleMapsRouteUrl(addressText: string | null | undefined) {
  const normalizedAddress = String(addressText || "").trim();

  if (!normalizedAddress) return null;

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    normalizedAddress
  )}`;
}

function MapsRouteButton({
  addressText,
  compact = false,
}: {
  addressText: string | null | undefined;
  compact?: boolean;
}) {
  const mapsUrl = buildGoogleMapsRouteUrl(addressText);
  const disabled = !mapsUrl;

  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? "Falta endereço para abrir a rota" : "Abrir rota no Google Maps"}
      onClick={(event) => {
        event.stopPropagation();

        if (!mapsUrl) return;

        window.open(mapsUrl, "_blank", "noopener,noreferrer");
      }}
      className={[
        "shrink-0 rounded-full border font-semibold transition",
        compact ? "px-2 py-0.5 text-[10px]" : "px-3 py-1.5 text-xs",
        disabled
          ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400"
          : "border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-800",
      ].join(" ")}
    >
      {compact ? "Rota" : "Abrir rota"}
    </button>
  );
}

function TodayAppointmentsDrawer({
  appointments,
  isOpen,
  onClose,
}: {
  appointments: DashboardMetrics["lists"]["nextAppointments"];
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Fechar compromissos do dia"
        onClick={onClose}
        className="absolute inset-0 bg-black/35"
      />

      <aside className="relative z-10 flex h-full w-full max-w-[560px] flex-col overflow-hidden bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
          <div className="min-w-0">
            <h3 className="break-words text-lg font-semibold text-zinc-950">
              Compromissos do dia
            </h3>
            <p className="mt-1 break-words text-sm text-zinc-500">
              Todos os compromissos encontrados para hoje.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-950 transition hover:border-zinc-950"
          >
            Fechar
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {appointments.length ? (
            <div className="space-y-3">
              {appointments.map((appointment) => (
                <div
                  key={appointment.id}
                  className="rounded-2xl border border-zinc-200 bg-white p-4"
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="break-words text-base font-semibold text-zinc-950">
                        {appointment.customerName || "Cliente sem nome"}
                      </h4>
                      <p className="mt-1 break-words text-sm text-zinc-600">
                        {appointment.title}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-700">
                        {formatLabel(appointment.status)}
                      </span>
                      <MapsRouteButton
                        addressText={getAppointmentRouteAddress(appointment)}
                        compact
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 text-sm text-zinc-600 sm:grid-cols-2">
                    <div>
                      <span className="font-medium text-zinc-950">Tipo: </span>
                      {formatLabel(appointment.appointmentType)}
                    </div>
                    <div>
                      <span className="font-medium text-zinc-950">Horário: </span>
                      {formatDateTime(appointment.scheduledStart)}
                    </div>
                    {appointment.customerPhone ? (
                      <div className="sm:col-span-2">
                        <span className="font-medium text-zinc-950">Telefone: </span>
                        {appointment.customerPhone}
                      </div>
                    ) : null}
                    <div className="sm:col-span-2">
                      <span className="font-medium text-zinc-950">Endereço: </span>
                      {getAppointmentRouteAddress(appointment) || "Não informado"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="Nenhum compromisso encontrado para hoje." />
          )}
        </div>
      </aside>
    </div>
  );
}


function DashboardDetailDrawer({
  title,
  description,
  isOpen,
  onClose,
  children,
}: {
  title: string;
  description: string;
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label={`Fechar ${title}`}
        onClick={onClose}
        className="absolute inset-0 bg-black/35"
      />

      <aside className="relative z-10 flex h-full w-full max-w-[560px] flex-col overflow-hidden bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
          <div className="min-w-0">
            <h3 className="break-words text-lg font-semibold text-zinc-950">
              {title}
            </h3>
            <p className="mt-1 break-words text-sm text-zinc-500">
              {description}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-950 transition hover:border-zinc-950"
          >
            Fechar
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

function getStoreSystemStartYear(metrics: DashboardMetrics) {
  const currentYear = new Date().getFullYear();
  const explicitCandidates = [metrics.storeSystemStartedAt, metrics.storeCreatedAt];
  const explicitYears = explicitCandidates
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getFullYear())
    .filter((year) => Number.isFinite(year) && year >= 2000 && year <= currentYear);

  return explicitYears.length ? Math.min(...explicitYears) : currentYear;
}

export default function DashboardPage() {
  const { organizationId, activeStoreId } = useStoreContext();
  const [activeTab, setActiveTab] = useState<DashboardTab>(() => {
    if (typeof window === "undefined") return "vendas";

    const savedTab = window.localStorage.getItem(DASHBOARD_ACTIVE_TAB_STORAGE_KEY);
    return isDashboardTab(savedTab) ? savedTab : "vendas";
  });
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [leadDetailDrawer, setLeadDetailDrawer] = useState<LeadDetailDrawer | null>(null);
  const [salesDetailDrawer, setSalesDetailDrawer] = useState<SalesDetailDrawer | null>(null);
  const [salesPeriodView, setSalesPeriodView] = useState<SalesPeriodView>("week");
  const [salesAnchorDate, setSalesAnchorDate] = useState(() => new Date());
  const [storeSystemStartYear, setStoreSystemStartYear] = useState(
    () => new Date().getFullYear()
  );
  const [isTodayAppointmentsDrawerOpen, setIsTodayAppointmentsDrawerOpen] =
    useState(false);
  const [isUrgentStatesDrawerOpen, setIsUrgentStatesDrawerOpen] = useState(false);
  const [isPendingFollowupsDrawerOpen, setIsPendingFollowupsDrawerOpen] =
    useState(false);
  const [isMonthFollowupsDrawerOpen, setIsMonthFollowupsDrawerOpen] =
    useState(false);
  const [isCatalogStockDrawerOpen, setIsCatalogStockDrawerOpen] = useState(false);
  const [isTrackedStockDrawerOpen, setIsTrackedStockDrawerOpen] = useState(false);
  const [isLowStockDrawerOpen, setIsLowStockDrawerOpen] = useState(false);
  const [isZeroStockDrawerOpen, setIsZeroStockDrawerOpen] = useState(false);
  const [isInventoryValueDrawerOpen, setIsInventoryValueDrawerOpen] =
    useState(false);
  const [isFastMovingItemsDrawerOpen, setIsFastMovingItemsDrawerOpen] =
    useState(false);
  const [aiDetailDrawer, setAiDetailDrawer] = useState<
    null | "distribution" | "messages" | "conversations" | "pending" | "processes" | "actions"
  >(null);
  const [isNextAppointmentsDrawerOpen, setIsNextAppointmentsDrawerOpen] =
    useState(false);

  const loadDashboardMetrics = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setMetrics(null);
      setErrorMessage("Loja ativa não encontrada.");
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage(null);

      const response = await fetch("/api/dashboard/metrics", {
        method: "GET",
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok || !data?.ok) {
        throw new Error(
          data?.message || "Não foi possível carregar o dashboard agora."
        );
      }

      const detectedStartYear = getStoreSystemStartYear(data);
      let resolvedStartYear = detectedStartYear;

      if (typeof window !== "undefined") {
        const storageKey = `${DASHBOARD_STORE_START_YEAR_STORAGE_PREFIX}.${activeStoreId}`;
        const savedYear = Number(window.localStorage.getItem(storageKey));
        const validSavedYear =
          Number.isFinite(savedYear) &&
          savedYear >= 2000 &&
          savedYear <= new Date().getFullYear()
            ? savedYear
            : null;

        resolvedStartYear =
          validSavedYear == null
            ? detectedStartYear
            : Math.min(validSavedYear, detectedStartYear);
        window.localStorage.setItem(storageKey, String(resolvedStartYear));
      }

      setStoreSystemStartYear(resolvedStartYear);
      setMetrics(data);
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar o dashboard agora."
      );
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, activeStoreId]);

  useEffect(() => {
    loadDashboardMetrics();
  }, [activeTab, loadDashboardMetrics]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(DASHBOARD_ACTIVE_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const previousBodyOverflowY = document.body.style.overflowY;
    const previousHtmlOverflowY = document.documentElement.style.overflowY;
    const usesCompactViewport = ["ia", "agenda", "estoque"].includes(activeTab);

    if (usesCompactViewport) {
      window.scrollTo({ top: 0, behavior: "auto" });
      document.body.style.overflowY = "hidden";
      document.documentElement.style.overflowY = "hidden";
    } else {
      document.body.style.overflowY = previousBodyOverflowY;
      document.documentElement.style.overflowY = previousHtmlOverflowY;
    }

    return () => {
      document.body.style.overflowY = previousBodyOverflowY;
      document.documentElement.style.overflowY = previousHtmlOverflowY;
    };
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === "undefined" || isLoading) return;

    const usesCompactViewport = ["ia", "agenda", "estoque"].includes(activeTab);

    if (usesCompactViewport) {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: "auto" });
      });
      return;
    }

    const savedScrollY = Number(
      window.localStorage.getItem(DASHBOARD_SCROLL_STORAGE_KEY) || "0"
    );

    if (Number.isFinite(savedScrollY) && savedScrollY > 0) {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: savedScrollY, behavior: "auto" });
      });
    }
  }, [activeTab, isLoading]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let animationFrameId = 0;

    const saveScrollPosition = () => {
      if (["ia", "agenda", "estoque"].includes(activeTab)) {
        window.localStorage.setItem(DASHBOARD_SCROLL_STORAGE_KEY, "0");
        return;
      }

      window.localStorage.setItem(
        DASHBOARD_SCROLL_STORAGE_KEY,
        String(window.scrollY || 0)
      );
    };

    const handleScroll = () => {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = window.requestAnimationFrame(saveScrollPosition);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        saveScrollPosition();
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pagehide", saveScrollPosition);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pagehide", saveScrollPosition);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeTab]);


  if (isLoading) {
    return (
      <main className="min-h-screen overflow-x-hidden bg-zinc-50 p-4 md:p-6">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-zinc-700">
            Carregando dashboard da loja...
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={index}
                className="h-24 animate-pulse rounded-2xl bg-zinc-100"
              />
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (errorMessage || !metrics) {
    return (
      <main className="min-h-screen overflow-x-hidden bg-zinc-50 p-4 md:p-6">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-zinc-950">
            Dashboard da Loja
          </h1>
          <p className="mt-2 text-sm text-zinc-600">{errorMessage}</p>
          <button
            type="button"
            onClick={loadDashboardMetrics}
            className="mt-4 rounded-xl border border-zinc-950 bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            Tentar novamente
          </button>
        </div>
      </main>
    );
  }

  const summary = metrics.summary;
  const lists = metrics.lists;
  const todayAppointments = lists.nextAppointments.filter((appointment) =>
    isSameLocalDate(appointment.scheduledStart)
  );
  const urgentAgendaItems = [
    ...lists.pendingFollowups.map((followup) => ({
      id: `followup-${followup.id}`,
      title: "Follow-up pendente",
      description: `Canal: ${formatLabel(followup.preferredChannel)} • ${formatNumber(
        followup.promptCount
      )} tentativa(s)`,
      status: formatLabel(followup.followupStatus),
      date: formatDateTime(followup.scheduledEnd),
    })),
    ...lists.operationalAlerts
      .filter((alert) =>
        ["followups", "ai_queue", "ai_queue_errors"].includes(alert.type)
      )
      .map((alert) => ({
        id: `agenda-alert-${alert.type}`,
        title: alert.title,
        description: alert.description,
        status: formatLabel(alert.severity),
        date: "",
      })),
  ];
  const monthFollowups = lists.pendingFollowups;
  const salesStatusText = summary.sales.available
    ? "A origem de vendas foi localizada, mas esta resposta ainda não fornece os totais necessários para exibir valores reais."
    : summary.sales.reason ||
      "Ainda não há uma origem confiável de vendas conectada ao dashboard.";
  const salesPlaceholder =
    "Os dados serão exibidos aqui quando a origem real de vendas estiver disponível. Nenhum número será estimado ou inventado.";
  const paymentSlices: PaymentSlice[] = [
    { label: "Pix", percent: 0, color: "#111827" },
    { label: "Cartão", percent: 0, color: "#2563eb" },
    { label: "Dinheiro", percent: 0, color: "#16a34a" },
    { label: "Boleto", percent: 0, color: "#d97706" },
    { label: "Financiamento", percent: 0, color: "#0f766e" },
  ];
  const allCatalogItems = lists.allCatalogItems || [];
  const inStockItems = lists.inStockItems || [];
  const inventoryValueByCategoryCents =
    summary.catalog.inventoryValueByCategoryCents || {
      pools: 0,
      chemicals: 0,
      accessories: 0,
      others: 0,
    };
  const inventoryValueCategories = [
    { key: "pools", label: "Piscinas" },
    { key: "chemicals", label: "Químicos" },
    { key: "accessories", label: "Acessórios" },
    { key: "others", label: "Outros" },
  ];

  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const leadsToday = lists.recentLeads.filter((lead) =>
    isSameLocalDate(lead.createdAt, now)
  );
  const leadsLast7Days = lists.recentLeads.filter((lead) => {
    const createdAt = new Date(lead.createdAt);
    return createdAt >= sevenDaysAgo && createdAt <= now;
  });
  const leadsThisMonth = lists.recentLeads.filter((lead) => {
    const createdAt = new Date(lead.createdAt);
    return (
      createdAt.getFullYear() === now.getFullYear() &&
      createdAt.getMonth() === now.getMonth()
    );
  });

  const selectedLeadDetail = leadDetailDrawer
    ? {
        today: {
          title: "Leads de hoje",
          description: "Leads criados hoje entre os registros recentes disponíveis no dashboard.",
          value: summary.leads.today,
          items: leadsToday,
        },
        last7: {
          title: "Leads dos últimos 7 dias",
          description: "Leads criados nos últimos sete dias entre os registros recentes disponíveis.",
          value: summary.leads.last7Days,
          items: leadsLast7Days,
        },
        month: {
          title: "Leads do mês",
          description: "Leads criados no mês atual entre os registros recentes disponíveis.",
          value: summary.leads.month,
          items: leadsThisMonth,
        },
        total: {
          title: "Total de leads",
          description: "Visão consolidada do total de leads e da distribuição pelo estado atual.",
          value: summary.leads.total,
          items: lists.recentLeads,
        },
      }[leadDetailDrawer]
    : null;

  const salesDetailCopy: Record<
    SalesDetailDrawer,
    { title: string; value: string; description: string }
  > = {
    goal: {
      title: "Meta do mês",
      value: "Não definida",
      description: "Meta comercial mensal, progresso realizado e diferença restante para o objetivo.",
    },
    revenueMonth: {
      title: "Faturamento do mês",
      value: "Sem dados",
      description: "Valor total faturado no mês selecionado e composição das vendas que formam esse faturamento.",
    },
    salesToday: {
      title: "Vendas de hoje",
      value: "Sem dados",
      description: "Quantidade, valor e lista das vendas realizadas hoje.",
    },
    salesWeek: {
      title: "Vendas da semana",
      value: "Sem dados",
      description: "Quantidade, faturamento e vendas individuais da semana selecionada.",
    },
    salesMonth: {
      title: "Vendas do mês",
      value: "Sem dados",
      description: "Quantidade de vendas do mês selecionado e distribuição ao longo das semanas.",
    },
    ticketAverage: {
      title: "Ticket médio",
      value: "Sem dados",
      description: "Valor médio das vendas reais registradas no período selecionado.",
    },
    conversion: {
      title: "Conversão por lead",
      value: "Sem dados",
      description: "Relação entre leads elegíveis e vendas reais concluídas no período.",
    },
    region: {
      title: "Região que mais vende",
      value: "Sem dados",
      description: "Ranking das regiões responsáveis pelas vendas reais registradas.",
    },
    products: {
      title: "Produtos mais vendidos",
      value: "Sem dados",
      description: "Ranking de produtos e categorias por quantidade vendida e faturamento.",
    },
    payments: {
      title: "Formas de pagamento",
      value: "Sem dados",
      description: "Distribuição das vendas reais por Pix, cartão, dinheiro, boleto, financiamento e outras formas registradas.",
    },
    commercialReading: {
      title: "Leitura comercial",
      value: "Resumo inteligente",
      description: "Interpretação dos sinais comerciais disponíveis agora e do que merece atenção.",
    },
  };

  const selectedSalesDetail = salesDetailDrawer
    ? salesDetailCopy[salesDetailDrawer]
    : null;

  return (
    <main
      className={`overflow-x-hidden bg-zinc-50 text-zinc-950 ${
        ["ia", "agenda", "estoque"].includes(activeTab)
          ? "h-auto min-h-0"
          : "min-h-screen"
      }`}
    >
      <div className="border-b border-zinc-200 bg-white">
        <div className="px-4 py-4 md:px-6">
          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex max-w-full flex-wrap gap-2">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex min-w-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition ${
                      isActive
                        ? "border-zinc-950 bg-zinc-950 text-white"
                        : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-950"
                    }`}
                  >
                    <span className="shrink-0">{tab.icon}</span>
                    <span className="break-words">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={loadDashboardMetrics}
              className="w-fit rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm transition hover:border-zinc-950"
            >
              Atualizar dados
            </button>
          </div>
        </div>
      </div>

      <div
        className={`min-w-0 ${
          ["ia", "agenda", "estoque"].includes(activeTab)
            ? "space-y-3 p-4 pb-0 md:p-6 md:pb-0"
            : "space-y-5 p-4 md:p-6"
        }`}
      >
        {activeTab === "leads" ? (
          <>
            <div className="space-y-4">
              <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <ClickableExecutiveNumberCard
                  title="Leads hoje"
                  value={formatNumber(summary.leads.today)}
                  helper="Clique para ver os registros de hoje"
                  accent="blue"
                  onClick={() => setLeadDetailDrawer("today")}
                />
                <ClickableExecutiveNumberCard
                  title="Últimos 7 dias"
                  value={formatNumber(summary.leads.last7Days)}
                  helper="Clique para abrir o período"
                  accent="cyan"
                  onClick={() => setLeadDetailDrawer("last7")}
                />
                <ClickableExecutiveNumberCard
                  title="Leads no mês"
                  value={formatNumber(summary.leads.month)}
                  helper="Clique para ver o mês atual"
                  accent="green"
                  onClick={() => setLeadDetailDrawer("month")}
                />
                <ClickableExecutiveNumberCard
                  title="Total de leads"
                  value={formatNumber(summary.leads.total)}
                  helper="Clique para ver a visão consolidada"
                  accent="amber"
                  onClick={() => setLeadDetailDrawer("total")}
                />
              </div>

              <div className="grid min-w-0 gap-4 xl:grid-cols-[0.85fr_1.15fr]">
                <div className="space-y-4">
                  <DashboardPanel className="border-blue-200">
                    <PanelTitle
                      title="Leads por estado atual"
                      helper="Distribuição usando os dados já existentes."
                    />
                    <HorizontalBars items={summary.leads.byState} barClassName="bg-blue-600" />
                  </DashboardPanel>

                  <LeadSourceDonut
                    sources={summary.leads.bySource || {}}
                    emptyText="Ainda não há uma origem de lead confiável conectada ao dashboard. Quando a API enviar a distribuição por origem, o gráfico e a legenda percentual serão preenchidos automaticamente."
                  />
                </div>

                <DashboardPanel className="border-emerald-200">
                  <PanelTitle
                    title="Leads recentes"
                    helper="Role dentro do bloco para consultar os cadastros mais recentes."
                  />
                  <div className="max-h-[410px] overflow-y-auto pr-1">
                    <InfoList
                      emptyText="Nenhum lead recente encontrado."
                      items={lists.recentLeads.map((lead) => ({
                        id: lead.id,
                        title: lead.name || "Lead sem nome",
                        subtitle: lead.phone || "Sem telefone",
                        meta: (
                          <>
                            <StatusPill>{formatLabel(lead.state)}</StatusPill>
                            <span>Criado em {formatDate(lead.createdAt)}</span>
                          </>
                        ),
                      }))}
                    />
                  </div>
                </DashboardPanel>
              </div>
            </div>

            <DashboardDetailDrawer
              title={selectedLeadDetail?.title || "Detalhes de leads"}
              description={selectedLeadDetail?.description || "Detalhamento do indicador selecionado."}
              isOpen={leadDetailDrawer !== null}
              onClose={() => setLeadDetailDrawer(null)}
            >
              {selectedLeadDetail ? (
                <div className="space-y-4">
                  <ExecutiveNumberCard
                    title={selectedLeadDetail.title}
                    value={formatNumber(selectedLeadDetail.value)}
                  />

                  {leadDetailDrawer === "total" ? (
                    <DashboardPanel>
                      <PanelTitle
                        title="Distribuição atual"
                        helper="Quantidade total por estado do lead."
                      />
                      <HorizontalBars items={summary.leads.byState} />
                    </DashboardPanel>
                  ) : null}

                  <DashboardPanel>
                    <PanelTitle
                      title="Registros disponíveis"
                      helper="A lista mostra os leads recentes que a rota atual disponibiliza; o total do indicador continua sendo o número consolidado acima."
                    />
                    <InfoList
                      emptyText="Nenhum registro recente deste período foi retornado."
                      items={selectedLeadDetail.items.map((lead) => ({
                        id: lead.id,
                        title: lead.name || "Lead sem nome",
                        subtitle: lead.phone || "Sem telefone",
                        meta: (
                          <>
                            <StatusPill>{formatLabel(lead.state)}</StatusPill>
                            <span>Criado em {formatDate(lead.createdAt)}</span>
                          </>
                        ),
                      }))}
                    />
                  </DashboardPanel>
                </div>
              ) : null}
            </DashboardDetailDrawer>
          </>
        ) : null}

        {activeTab === "vendas" ? (
          <>
            <div className="space-y-3">
              <div className="grid min-w-0 gap-3 xl:grid-cols-[0.82fr_1.65fr]">
                <GoalGauge percent={0} onClick={() => setSalesDetailDrawer("goal")} />

                <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <SalesMetricTile
                    title="Faturamento do mês"
                    value="Sem dados"
                    helper="Total vendido no mês"
                    accent="blue"
                    onClick={() => setSalesDetailDrawer("revenueMonth")}
                  />
                  <SalesMetricTile
                    title="Vendas hoje"
                    value="Sem dados"
                    helper="Quantidade e valor do dia"
                    accent="green"
                    onClick={() => setSalesDetailDrawer("salesToday")}
                  />
                  <SalesMetricTile
                    title="Vendas na semana"
                    value="Sem dados"
                    helper="Semana selecionada"
                    accent="cyan"
                    onClick={() => setSalesDetailDrawer("salesWeek")}
                  />
                  <SalesMetricTile
                    title="Vendas no mês"
                    value="Sem dados"
                    helper="Quantidade de vendas"
                    accent="amber"
                    onClick={() => setSalesDetailDrawer("salesMonth")}
                  />
                  <SalesMetricTile
                    title="Ticket médio"
                    value="Sem dados"
                    helper="Média por venda"
                    accent="orange"
                    onClick={() => setSalesDetailDrawer("ticketAverage")}
                  />
                  <SalesMetricTile
                    title="Conversão por lead"
                    value="Sem dados"
                    helper="Leads convertidos em venda"
                    accent="slate"
                    onClick={() => setSalesDetailDrawer("conversion")}
                  />
                </div>
              </div>

              <div className="min-w-0">
                <SalesPeriodExplorer
                  view={salesPeriodView}
                  anchorDate={salesAnchorDate}
                  onViewChange={setSalesPeriodView}
                  onAnchorDateChange={setSalesAnchorDate}
                  salesAvailable={summary.sales.available}
                  statusText={salesStatusText}
                  systemStartYear={storeSystemStartYear}
                />
              </div>

              <CommercialReadingPanel
                salesAvailable={summary.sales.available}
                leadsMonth={summary.leads.month}
                pendingFollowups={summary.followups.pending}
                futureAppointments={summary.appointments.future}
                onClick={() => setSalesDetailDrawer("commercialReading")}
              />

              <div className="grid min-w-0 gap-3 xl:grid-cols-3">
                <button
                  type="button"
                  onClick={() => setSalesDetailDrawer("payments")}
                  className="flex min-h-[205px] min-w-0 flex-col rounded-[4px] border border-cyan-200 bg-white p-4 text-left shadow-sm transition hover:border-zinc-950 hover:shadow"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-zinc-950">
                      Formas de pagamento
                    </h3>
                    <span className="h-2.5 w-2.5 rounded-[2px] bg-cyan-600" />
                  </div>

                  {paymentSlices.some((slice) => slice.percent > 0) ? (
                    <div className="mt-4">
                      <PaymentDonut
                        slices={paymentSlices}
                        emptyText="Sem vendas com forma de pagamento registrada."
                      />
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-1 items-center gap-4">
                      <div className="relative h-24 w-24 shrink-0 rounded-full border border-zinc-200 bg-zinc-100">
                        <div className="absolute inset-[18px] flex items-center justify-center rounded-full border border-zinc-200 bg-white">
                          <span className="text-xs font-semibold text-zinc-500">—</span>
                        </div>
                      </div>
                      <div className="min-w-0">
                        <p className="text-base font-semibold text-zinc-950">
                          Sem dados ainda
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                          As formas de pagamento aparecerão quando houver vendas registradas.
                        </p>
                      </div>
                    </div>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setSalesDetailDrawer("region")}
                  className="flex min-h-[205px] min-w-0 flex-col rounded-[4px] border border-blue-200 bg-white p-4 text-left shadow-sm transition hover:border-zinc-950 hover:shadow"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-zinc-950">
                      Região que mais vende
                    </h3>
                    <span className="h-2.5 w-2.5 rounded-[2px] bg-blue-600" />
                  </div>

                  <div className="flex flex-1 flex-col justify-center">
                    <p className="text-2xl font-semibold tracking-tight text-zinc-950">
                      Sem dados
                    </p>
                    <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
                      A região de maior resultado aparecerá quando houver vendas reais com localização identificada.
                    </p>
                  </div>

                  <div className="h-1.5 w-full overflow-hidden bg-blue-50">
                    <div className="h-full w-0 bg-blue-600" />
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSalesDetailDrawer("products")}
                  className="flex min-h-[205px] min-w-0 flex-col rounded-[4px] border border-emerald-200 bg-white p-4 text-left shadow-sm transition hover:border-zinc-950 hover:shadow"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-zinc-950">
                      Produtos mais vendidos
                    </h3>
                    <span className="h-2.5 w-2.5 rounded-[2px] bg-emerald-600" />
                  </div>

                  <div className="mt-3 divide-y divide-zinc-100">
                    {["Piscinas", "Químicos", "Acessórios", "Outros"].map(
                      (category, index) => (
                        <div
                          key={category}
                          className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-sm"
                        >
                          <span className="text-xs font-semibold text-zinc-400">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="min-w-0 font-medium text-zinc-800">
                            {category}
                          </span>
                          <span className="text-zinc-500">—</span>
                        </div>
                      )
                    )}
                  </div>
                </button>
              </div>
            </div>

            <DashboardDetailDrawer
              title={selectedSalesDetail?.title || "Detalhes de vendas"}
              description={selectedSalesDetail?.description || "Detalhamento do indicador selecionado."}
              isOpen={salesDetailDrawer !== null}
              onClose={() => setSalesDetailDrawer(null)}
            >
              {selectedSalesDetail ? (
                salesDetailDrawer === "commercialReading" ? (
                  <CommercialReadingDetail
                    salesAvailable={summary.sales.available}
                    salesStatusText={salesStatusText}
                    leadsMonth={summary.leads.month}
                    pendingFollowups={summary.followups.pending}
                    futureAppointments={summary.appointments.future}
                  />
                ) : (
                <div className="space-y-4">
                  <ExecutiveNumberCard
                    title={selectedSalesDetail.title}
                    value={selectedSalesDetail.value}
                  />

                  {salesDetailDrawer === "payments" ? (
                    <DashboardPanel>
                      <PanelTitle title="Distribuição por forma de pagamento" />
                      <PaymentDonut
                        slices={paymentSlices}
                        emptyText="Ainda não há vendas com forma de pagamento registrada."
                      />
                    </DashboardPanel>
                  ) : null}

                  {salesDetailDrawer === "products" ? (
                    <DashboardPanel>
                      <PanelTitle title="Categorias" />
                      <div className="space-y-2">
                        {["Piscinas", "Químicos", "Acessórios", "Outros"].map((category) => (
                          <div
                            key={category}
                            className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"
                          >
                            <span className="font-medium text-zinc-800">{category}</span>
                            <span className="text-zinc-500">Sem dados</span>
                          </div>
                        ))}
                      </div>
                    </DashboardPanel>
                  ) : null}

                  <DashboardPanel>
                    <PanelTitle title="Situação dos dados" />
                    <EmptyState text={salesStatusText} />
                  </DashboardPanel>

                  <div className="rounded-[4px] border border-zinc-200 bg-zinc-50 p-4">
                    <p className="text-sm leading-relaxed text-zinc-700">
                      Quando a origem real de vendas estiver conectada, este detalhe exibirá os registros que compõem o indicador sem estimar ou inventar valores.
                    </p>
                  </div>
                </div>
                )
              ) : null}
            </DashboardDetailDrawer>
          </>
        ) : null}

        {activeTab === "ia" ? (
          <>
            <div className="space-y-4">
              <div className="grid min-w-0 gap-4 xl:grid-cols-[0.9fr_1.45fr]">
                <div className="grid min-w-0 gap-3 content-start">
                  <button
                    type="button"
                    onClick={() => setAiDetailDrawer("distribution")}
                    className="block w-full min-w-0 rounded-[6px] border border-blue-200 border-t-4 border-t-blue-600 bg-white p-3 text-left shadow-sm transition hover:border-blue-500"
                  >
                    <PanelTitle
                      title="IA x loja x cliente"
                      helper="Distribuição das mensagens do mês."
                    />
                    <SplitProgress
                      ai={summary.messages.ai}
                      human={summary.messages.humanOperator}
                      customer={summary.messages.customer}
                    />
                  </button>

                  <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setAiDetailDrawer("messages")}
                      className="min-w-0 rounded-[6px] border border-cyan-200 border-t-4 border-t-cyan-600 bg-white p-2 text-center shadow-sm transition hover:border-cyan-500"
                    >
                      <p className="break-words text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                        Mensagens da IA
                      </p>
                      <p className="mt-0.5 break-words text-lg font-semibold tracking-tight text-cyan-700">
                        {formatNumber(summary.messages.ai)}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiDetailDrawer("conversations")}
                      className="min-w-0 rounded-[6px] border border-emerald-200 border-t-4 border-t-emerald-600 bg-white p-2 text-center shadow-sm transition hover:border-emerald-500"
                    >
                      <p className="break-words text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                        Conversas com IA
                      </p>
                      <p className="mt-0.5 break-words text-lg font-semibold tracking-tight text-emerald-700">
                        {formatNumber(lists.conversationsWithAiPresence.length)}
                      </p>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setAiDetailDrawer("pending")}
                    className="block w-full min-w-0 rounded-[6px] border border-amber-200 border-t-4 border-t-amber-500 bg-white p-3 text-left shadow-sm transition hover:border-amber-500"
                  >
                    <PanelTitle title="Pendências da IA" />
                    <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                      <div className="rounded-[6px] border border-amber-200 bg-amber-50 p-2 text-center">
                        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-amber-700">
                          Pendentes
                        </p>
                        <p className="mt-0.5 text-lg font-semibold text-zinc-950">
                          {formatNumber(summary.ai.pendingQueueActions)}
                        </p>
                      </div>
                      <div className="rounded-[6px] border border-orange-200 bg-orange-50 p-2 text-center">
                        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-orange-700">
                          Com erro
                        </p>
                        <p className="mt-0.5 text-lg font-semibold text-zinc-950">
                          {formatNumber(summary.ai.failedQueueActions)}
                        </p>
                      </div>
                    </div>
                  </button>
                </div>

                <div className="grid min-w-0 gap-4">
                  <button
                    type="button"
                    onClick={() => setAiDetailDrawer("processes")}
                    className="block w-full min-w-0 rounded-[6px] border border-cyan-200 border-t-4 border-t-cyan-600 bg-white p-3 text-left shadow-sm transition hover:border-cyan-500"
                  >
                    <PanelTitle title="Processos com maior presença da IA" />
                    {lists.conversationsWithAiPresence.length ? (
                      <div className="space-y-2">
                        {lists.conversationsWithAiPresence.slice(0, 3).map((item) => (
                          <div
                            key={item.conversationId}
                            className="grid gap-2 border-b border-zinc-100 px-3 py-2 text-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto]"
                          >
                            <span className="min-w-0 break-words font-medium text-zinc-950">
                              {item.customerName}
                            </span>
                            <span className="shrink-0 text-zinc-700">
                              {formatPercent(item.aiParticipationPercent)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState text="Ainda não há conversas com dados suficientes." />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setAiDetailDrawer("actions")}
                    className="block w-full min-w-0 rounded-[6px] border border-emerald-200 border-t-4 border-t-emerald-600 bg-white p-3 text-left shadow-sm transition hover:border-emerald-500"
                  >
                    <PanelTitle
                      title="O que a IA está fazendo"
                      helper="Ações registradas pela IA neste mês."
                    />
                    <HorizontalBars items={summary.ai.decisionsByAction} barClassName="bg-emerald-600" />
                  </button>
                </div>
              </div>
            </div>

            <DashboardDetailDrawer
              title={
                aiDetailDrawer === "distribution"
                  ? "IA x loja x cliente"
                  : aiDetailDrawer === "messages"
                    ? "Mensagens da IA"
                    : aiDetailDrawer === "conversations"
                      ? "Conversas com IA"
                      : aiDetailDrawer === "pending"
                        ? "Pendências da IA"
                        : aiDetailDrawer === "processes"
                          ? "Processos com maior presença da IA"
                          : "O que a IA está fazendo"
              }
              description="Detalhes do bloco selecionado na aba IA."
              isOpen={aiDetailDrawer !== null}
              onClose={() => setAiDetailDrawer(null)}
            >
              {aiDetailDrawer === "distribution" ? (
                <div className="space-y-4">
                  <DashboardPanel>
                    <PanelTitle title="Distribuição das mensagens" />
                    <SplitProgress
                      ai={summary.messages.ai}
                      human={summary.messages.humanOperator}
                      customer={summary.messages.customer}
                    />
                  </DashboardPanel>
                  <p className="text-sm leading-relaxed text-zinc-700">
                    Esse bloco mostra quem mais participou das conversas registradas no período: IA, loja ou clientes.
                  </p>
                </div>
              ) : null}

              {aiDetailDrawer === "messages" ? (
                <div className="space-y-4">
                  <ExecutiveNumberCard title="Mensagens da IA no mês" value={formatNumber(summary.messages.ai)} />
                  <DashboardPanel>
                    <PanelTitle title="Mensagens recentes da IA" />
                    <InfoList
                      emptyText="Nenhuma mensagem recente da IA encontrada."
                      items={lists.recentMessages
                        .filter((message) => message.isAi)
                        .slice(0, 8)
                        .map((message) => ({
                          id: message.id,
                          title: "IA",
                          subtitle: compactText(message.content, 130),
                          meta: <span>{formatLabel(message.direction)}</span>,
                          right: <span className="text-xs text-zinc-500">{formatDateTime(message.createdAt)}</span>,
                        }))}
                    />
                  </DashboardPanel>
                </div>
              ) : null}

              {aiDetailDrawer === "conversations" ? (
                <div className="space-y-4">
                  <ExecutiveNumberCard title="Conversas com IA" value={formatNumber(lists.conversationsWithAiPresence.length)} />
                  <InfoList
                    emptyText="Nenhuma conversa com presença da IA encontrada."
                    items={lists.conversationsWithAiPresence.slice(0, 10).map((item) => ({
                      id: item.conversationId,
                      title: item.customerName,
                      subtitle: compactText(item.lastMessagePreview, 130),
                      meta: (
                        <>
                          <span>{formatNumber(item.aiMessages)} mensagem(ns) da IA</span>
                          <span>{formatPercent(item.aiParticipationPercent)} de presença</span>
                        </>
                      ),
                    }))}
                  />
                </div>
              ) : null}

              {aiDetailDrawer === "pending" ? (
                <div className="space-y-4">
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                    <ExecutiveNumberCard title="Pendentes" value={formatNumber(summary.ai.pendingQueueActions)} />
                    <ExecutiveNumberCard title="Com erro" value={formatNumber(summary.ai.failedQueueActions)} />
                  </div>
                  <p className="text-sm leading-relaxed text-zinc-700">
                    Esse bloco mostra ações automáticas que ainda precisam ser processadas ou que tiveram erro e exigem atenção.
                  </p>
                </div>
              ) : null}

              {aiDetailDrawer === "processes" ? (
                <InfoList
                  emptyText="Ainda não há conversas com dados suficientes."
                  items={lists.conversationsWithAiPresence.slice(0, 10).map((item) => ({
                    id: item.conversationId,
                    title: item.customerName,
                    subtitle: compactText(item.lastMessagePreview, 130),
                    meta: (
                      <>
                        <span>{formatPercent(item.aiParticipationPercent)} IA</span>
                        <span>{formatNumber(item.aiMessages)} IA / {formatNumber(item.totalMessages)} total</span>
                      </>
                    ),
                  }))}
                />
              ) : null}

              {aiDetailDrawer === "actions" ? (
                <div className="space-y-4">
                  <DashboardPanel>
                    <PanelTitle title="Ações registradas" />
                    <HorizontalBars items={summary.ai.decisionsByAction} />
                  </DashboardPanel>
                  <p className="text-sm leading-relaxed text-zinc-700">
                    Esse bloco mostra quais tipos de ações a IA registrou no sistema durante o mês.
                  </p>
                </div>
              ) : null}
            </DashboardDetailDrawer>
          </>
        ) : null}

        {activeTab === "agenda" ? (
          <>
            <div className="space-y-3">
              <div className="grid min-w-0 gap-3 md:grid-cols-4">
                <button
                  type="button"
                  onClick={() => setIsTodayAppointmentsDrawerOpen(true)}
                  className="min-w-0 rounded-[6px] border border-blue-200 border-t-4 border-t-blue-600 bg-white p-2 text-center shadow-sm transition hover:border-blue-500"
                >
                  <p className="break-words text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                    Compromisso do dia
                  </p>
                  <p className="mt-0.5 break-words text-lg font-semibold tracking-tight text-blue-700">
                    {formatNumber(summary.appointments.today)}
                  </p>
                  <p className="mt-0.5 break-words text-[10px] leading-relaxed text-zinc-500">
                    Clique para ver todos
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setIsUrgentStatesDrawerOpen(true)}
                  className="min-w-0 rounded-[6px] border border-orange-200 border-t-4 border-t-orange-500 bg-white p-2 text-center shadow-sm transition hover:border-orange-500"
                >
                  <p className="break-words text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                    Estados urgentes
                  </p>
                  <p className="mt-0.5 break-words text-lg font-semibold tracking-tight text-orange-700">
                    {formatNumber(urgentAgendaItems.length)}
                  </p>
                  <p className="mt-0.5 break-words text-[10px] leading-relaxed text-zinc-500">
                    Clique para ver detalhes
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setIsPendingFollowupsDrawerOpen(true)}
                  className="min-w-0 rounded-[6px] border border-amber-200 border-t-4 border-t-amber-500 bg-white p-2 text-center shadow-sm transition hover:border-amber-500"
                >
                  <p className="break-words text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                    Follow-ups pendentes
                  </p>
                  <p className="mt-0.5 break-words text-lg font-semibold tracking-tight text-amber-700">
                    {formatNumber(summary.followups.pending)}
                  </p>
                  <p className="mt-0.5 break-words text-[10px] leading-relaxed text-zinc-500">
                    Clique para ver lista
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setIsMonthFollowupsDrawerOpen(true)}
                  className="min-w-0 rounded-[6px] border border-emerald-200 border-t-4 border-t-emerald-600 bg-white p-2 text-center shadow-sm transition hover:border-emerald-500"
                >
                  <p className="break-words text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                    Follow-ups no mês
                  </p>
                  <p className="mt-0.5 break-words text-lg font-semibold tracking-tight text-emerald-700">
                    {formatNumber(summary.followups.total)}
                  </p>
                  <p className="mt-0.5 break-words text-[10px] leading-relaxed text-zinc-500">
                    Clique para ver lista
                  </p>
                </button>
              </div>

              <div className="grid min-w-0 gap-3 xl:grid-cols-[0.85fr_1.35fr]">
                <div className="grid min-w-0 gap-3">
                  <DashboardPanel className="border-cyan-200">
                    <PanelTitle title="Processos" />
                    <div className="max-h-[145px] overflow-y-auto pr-1">
                      <HorizontalBars items={summary.appointments.byType} barClassName="bg-cyan-600" />
                    </div>
                  </DashboardPanel>
                </div>

                <div className="grid min-w-0 gap-3 content-start">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setIsNextAppointmentsDrawerOpen(true)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setIsNextAppointmentsDrawerOpen(true);
                      }
                    }}
                    className="block w-full min-w-0 cursor-pointer rounded-[6px] border border-blue-200 border-t-4 border-t-blue-600 bg-white p-3 text-left shadow-sm transition hover:border-blue-500"
                  >
                    <PanelTitle title="Próximos compromissos" />
                    {lists.nextAppointments.length ? (
                      <div className="max-h-[178px] overflow-y-auto pr-1">
                        <div className="space-y-2">
                          {lists.nextAppointments.map((appointment) => (
                            <div
                              key={appointment.id}
                              className="grid min-w-0 gap-2 rounded-[6px] border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(92px,0.6fr)_minmax(78px,0.5fr)_minmax(88px,0.55fr)_auto] sm:items-center"
                            >
                              <span className="min-w-0 break-words font-medium text-zinc-950">
                                {appointment.customerName || "Cliente sem nome"}
                              </span>
                              <span className="min-w-0 break-words text-zinc-700">
                                {formatLabel(appointment.appointmentType)}
                              </span>
                              <span className="min-w-0 break-words text-zinc-700">
                                {formatLabel(appointment.status)}
                              </span>
                              <span className="min-w-0 break-words text-zinc-700">
                                {formatDateTime(appointment.scheduledStart)}
                              </span>
                              <div className="flex min-w-0 justify-start sm:justify-end">
                                <MapsRouteButton
                                  addressText={getAppointmentRouteAddress(appointment)}
                                  compact
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <EmptyState text="Nenhum compromisso futuro encontrado." />
                    )}
                  </div>
                </div>
              </div>
            </div>

            <TodayAppointmentsDrawer
              appointments={todayAppointments}
              isOpen={isTodayAppointmentsDrawerOpen}
              onClose={() => setIsTodayAppointmentsDrawerOpen(false)}
            />

            <DashboardDetailDrawer
              title="Próximos compromissos"
              description="Lista dos próximos compromissos com detalhes e resumo do caso."
              isOpen={isNextAppointmentsDrawerOpen}
              onClose={() => setIsNextAppointmentsDrawerOpen(false)}
            >
              {lists.nextAppointments.length ? (
                <div className="space-y-3">
                  {lists.nextAppointments.map((appointment) => (
                    <div
                      key={appointment.id}
                      className="rounded-2xl border border-zinc-200 bg-white p-4"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="break-words text-base font-semibold text-zinc-950">
                            {appointment.customerName || "Cliente sem nome"}
                          </h4>
                          <p className="mt-1 break-words text-sm text-zinc-600">
                            {appointment.title}
                          </p>
                        </div>

                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-700">
                            {formatLabel(appointment.status)}
                          </span>
                          <MapsRouteButton
                            addressText={getAppointmentRouteAddress(appointment)}
                            compact
                          />
                        </div>
                      </div>

                      <div className="mt-3 grid gap-2 text-sm text-zinc-600 sm:grid-cols-2">
                        <div>
                          <span className="font-medium text-zinc-950">Tipo: </span>
                          {formatLabel(appointment.appointmentType)}
                        </div>
                        <div>
                          <span className="font-medium text-zinc-950">Horário: </span>
                          {formatDateTime(appointment.scheduledStart)}
                        </div>
                        {appointment.customerPhone ? (
                          <div>
                            <span className="font-medium text-zinc-950">Telefone: </span>
                            {appointment.customerPhone}
                          </div>
                        ) : null}
                        <div>
                          <span className="font-medium text-zinc-950">Origem: </span>
                          {formatLabel(appointment.source)}
                        </div>
                        <div className="sm:col-span-2">
                          <span className="font-medium text-zinc-950">Endereço: </span>
                          {getAppointmentRouteAddress(appointment) || "Não informado"}
                        </div>
                      </div>

                      <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
                          Relatório do caso
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-zinc-700">
                          Compromisso agendado para {appointment.customerName || "cliente sem nome"} em {formatDateTime(appointment.scheduledStart)}. Tipo: {formatLabel(appointment.appointmentType)}. Status atual: {formatLabel(appointment.status)}.
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="Nenhum compromisso futuro encontrado." />
              )}
            </DashboardDetailDrawer>

            <DashboardDetailDrawer
              title="Estados urgentes"
              description="Agenda, acompanhamentos e ações que podem exigir atenção."
              isOpen={isUrgentStatesDrawerOpen}
              onClose={() => setIsUrgentStatesDrawerOpen(false)}
            >
              {urgentAgendaItems.length ? (
                <div className="space-y-3">
                  {urgentAgendaItems.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-zinc-200 bg-white p-4"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="break-words text-base font-semibold text-zinc-950">
                            {item.title}
                          </h4>
                          <p className="mt-1 break-words text-sm text-zinc-600">
                            {item.description}
                          </p>
                        </div>

                        <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-700">
                          {item.status}
                        </span>
                      </div>
                      {item.date ? (
                        <p className="mt-3 text-sm text-zinc-500">{item.date}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="Nenhum estado urgente encontrado agora." />
              )}
            </DashboardDetailDrawer>

            <DashboardDetailDrawer
              title="Follow-ups pendentes"
              description="Lista de acompanhamentos que ainda aguardam ação."
              isOpen={isPendingFollowupsDrawerOpen}
              onClose={() => setIsPendingFollowupsDrawerOpen(false)}
            >
              {lists.pendingFollowups.length ? (
                <div className="space-y-3">
                  {lists.pendingFollowups.map((followup) => (
                    <div
                      key={followup.id}
                      className="rounded-2xl border border-zinc-200 bg-white p-4"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="break-words text-base font-semibold text-zinc-950">
                            {formatLabel(followup.followupStatus)}
                          </h4>
                          <p className="mt-1 break-words text-sm text-zinc-600">
                            Canal preferido: {formatLabel(followup.preferredChannel)}
                          </p>
                        </div>

                        <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-700">
                          {formatNumber(followup.promptCount)} tentativa(s)
                        </span>
                      </div>

                      <p className="mt-3 text-sm text-zinc-500">
                        Data base: {formatDateTime(followup.scheduledEnd)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="Nenhum follow-up pendente encontrado." />
              )}
            </DashboardDetailDrawer>

            <DashboardDetailDrawer
              title="Follow-ups feitos no mês"
              description="Lista dos acompanhamentos registrados no mês."
              isOpen={isMonthFollowupsDrawerOpen}
              onClose={() => setIsMonthFollowupsDrawerOpen(false)}
            >
              {monthFollowups.length ? (
                <div className="space-y-3">
                  {monthFollowups.map((followup) => (
                    <div
                      key={followup.id}
                      className="rounded-2xl border border-zinc-200 bg-white p-4"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="break-words text-base font-semibold text-zinc-950">
                            {formatLabel(followup.followupStatus)}
                          </h4>
                          <p className="mt-1 break-words text-sm text-zinc-600">
                            Canal preferido: {formatLabel(followup.preferredChannel)}
                          </p>
                        </div>

                        <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-700">
                          {formatNumber(followup.promptCount)} tentativa(s)
                        </span>
                      </div>

                      <p className="mt-3 text-sm text-zinc-500">
                        Data base: {formatDateTime(followup.scheduledEnd)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="Nenhum follow-up registrado no mês." />
              )}
            </DashboardDetailDrawer>
          </>
        ) : null}

        {activeTab === "estoque" ? (
          <>
            <div className="space-y-4">
              <div className="grid min-w-0 gap-3 md:grid-cols-5">
                <button
                  type="button"
                  onClick={() => setIsCatalogStockDrawerOpen(true)}
                  className="min-w-0 rounded-[6px] border border-blue-200 border-t-4 border-t-blue-600 bg-white p-2.5 text-center shadow-sm transition hover:border-blue-500"
                >
                  <p className="break-words text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
                    Itens no catálogo
                  </p>
                  <p className="mt-1 break-words text-xl font-semibold tracking-tight text-blue-700">
                    {formatNumber(summary.catalog.totalItems)}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setIsTrackedStockDrawerOpen(true)}
                  className="min-w-0 rounded-[6px] border border-emerald-200 border-t-4 border-t-emerald-600 bg-white p-2.5 text-center shadow-sm transition hover:border-emerald-500"
                >
                  <p className="break-words text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
                    Com estoque
                  </p>
                  <p className="mt-1 break-words text-xl font-semibold tracking-tight text-emerald-700">
                    {formatNumber(summary.catalog.stockTrackedItems)}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setIsLowStockDrawerOpen(true)}
                  className="min-w-0 rounded-[6px] border border-amber-200 border-t-4 border-t-amber-500 bg-white p-2.5 text-center shadow-sm transition hover:border-amber-500"
                >
                  <p className="break-words text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
                    Estoque baixo
                  </p>
                  <p className="mt-1 break-words text-xl font-semibold tracking-tight text-amber-700">
                    {formatNumber(summary.catalog.lowStockItems)}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setIsZeroStockDrawerOpen(true)}
                  className="min-w-0 rounded-[6px] border border-red-200 border-t-4 border-t-red-500 bg-white p-2.5 text-center shadow-sm transition hover:border-red-500"
                >
                  <p className="break-words text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
                    Estoque zerado
                  </p>
                  <p className="mt-1 break-words text-xl font-semibold tracking-tight text-red-700">
                    {formatNumber(summary.catalog.zeroStockItems)}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setIsInventoryValueDrawerOpen(true)}
                  className="min-w-0 rounded-[6px] border border-cyan-200 border-t-4 border-t-cyan-600 bg-white p-2.5 text-center shadow-sm transition hover:border-cyan-500"
                >
                  <p className="break-words text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
                    Valor em estoque
                  </p>
                  <p className="mt-1 break-words text-xl font-semibold tracking-tight text-cyan-700">
                    {formatCurrencyFromCents(summary.catalog.estimatedInventoryValueCents)}
                  </p>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsFastMovingItemsDrawerOpen(true)}
                className="block w-full min-w-0 rounded-[6px] border border-emerald-200 border-t-4 border-t-emerald-600 bg-white p-3 text-left shadow-sm transition hover:border-emerald-500"
              >
                <PanelTitle
                  title="Itens que mais saem"
                  helper="Este bloco ficará pronto quando existir uma origem confiável de vendas, pedidos ou movimentação de estoque."
                />
                <EmptyState text={salesPlaceholder} />
              </button>
            </div>

            <DashboardDetailDrawer
              title="Itens no catálogo"
              description="Resumo geral dos itens cadastrados no catálogo da loja."
              isOpen={isCatalogStockDrawerOpen}
              onClose={() => setIsCatalogStockDrawerOpen(false)}
            >
              <div className="space-y-4">
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <ExecutiveNumberCard
                    title="Total cadastrado"
                    value={formatNumber(summary.catalog.totalItems)}
                  />
                  <ExecutiveNumberCard
                    title="Ativos"
                    value={formatNumber(summary.catalog.activeItems)}
                  />
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
                    Lista do catálogo
                  </p>
                  <div className="mt-3">
                    <CatalogItemsList
                      items={allCatalogItems}
                      emptyText="A rota ainda não enviou a lista completa do catálogo."
                    />
                  </div>
                </div>
              </div>
            </DashboardDetailDrawer>

            <DashboardDetailDrawer
              title="Itens com estoque"
              description="Itens cadastrados com controle de estoque ativo."
              isOpen={isTrackedStockDrawerOpen}
              onClose={() => setIsTrackedStockDrawerOpen(false)}
            >
              <div className="space-y-4">
                <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                  <ExecutiveNumberCard
                    title="Com estoque"
                    value={formatNumber(inStockItems.length)}
                  />
                  <ExecutiveNumberCard
                    title="Estoque baixo"
                    value={formatNumber(summary.catalog.lowStockItems)}
                  />
                  <ExecutiveNumberCard
                    title="Estoque zerado"
                    value={formatNumber(summary.catalog.zeroStockItems)}
                  />
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
                    Lista dos itens com estoque
                  </p>
                  <div className="mt-3">
                    <CatalogItemsList
                      items={inStockItems}
                      emptyText="Nenhum item com estoque positivo encontrado."
                    />
                  </div>
                </div>
              </div>
            </DashboardDetailDrawer>

            <DashboardDetailDrawer
              title="Itens com estoque baixo"
              description="Produtos que ainda existem, mas precisam de reposição."
              isOpen={isLowStockDrawerOpen}
              onClose={() => setIsLowStockDrawerOpen(false)}
            >
              {lists.lowStockItems.length ? (
                <div className="space-y-3">
                  {lists.lowStockItems.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-zinc-200 bg-white p-4"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="break-words text-base font-semibold text-zinc-950">
                            {item.name}
                          </h4>
                          <p className="mt-1 break-words text-sm text-zinc-600">
                            SKU: {item.sku || "Sem SKU"}
                          </p>
                        </div>

                        <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-700">
                          {getDashboardItemStockLabel(item)}
                        </span>
                      </div>

                      <p className="mt-3 text-sm text-zinc-500">
                        Valor unitário: {getDashboardItemPriceLabel(item)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="Nenhum item com estoque baixo encontrado." />
              )}
            </DashboardDetailDrawer>

            <DashboardDetailDrawer
              title="Itens sem estoque"
              description="Itens zerados que precisam de atenção."
              isOpen={isZeroStockDrawerOpen}
              onClose={() => setIsZeroStockDrawerOpen(false)}
            >
              {lists.zeroStockItems.length ? (
                <div className="space-y-3">
                  {lists.zeroStockItems.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-zinc-200 bg-white p-4"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="break-words text-base font-semibold text-zinc-950">
                            {item.name}
                          </h4>
                          <p className="mt-1 break-words text-sm text-zinc-600">
                            SKU: {item.sku || "Sem SKU"}
                          </p>
                        </div>

                        <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-700">
                          {getDashboardItemStockLabel(item)}
                        </span>
                      </div>

                      <p className="mt-3 text-sm text-zinc-500">
                        Valor unitário: {getDashboardItemPriceLabel(item)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="Nenhum item zerado encontrado." />
              )}
            </DashboardDetailDrawer>

            <DashboardDetailDrawer
              title="Valor em estoque"
              description="Valor estimado dos itens cadastrados com base em preço e quantidade."
              isOpen={isInventoryValueDrawerOpen}
              onClose={() => setIsInventoryValueDrawerOpen(false)}
            >
              <div className="space-y-4">
                <ExecutiveNumberCard
                  title="Total em estoque"
                  value={formatCurrencyFromCents(summary.catalog.estimatedInventoryValueCents)}
                />

                <div className="space-y-2">
                  {inventoryValueCategories.map((category) => (
                    <div
                      key={category.key}
                      className="grid min-w-0 gap-2 rounded-[6px] border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <span className="min-w-0 break-words font-medium text-zinc-950">
                        {category.label}
                      </span>
                      <span className="shrink-0 text-zinc-700">
                        {formatCurrencyFromCents(inventoryValueByCategoryCents[category.key] || 0)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
                    Observação
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-zinc-700">
                    A separação por categoria depende da categoria salva no catálogo. Itens sem categoria reconhecida entram em Outros.
                  </p>
                </div>
              </div>
            </DashboardDetailDrawer>

            <DashboardDetailDrawer
              title="Itens que mais saem"
              description="Ranking de produtos com maior saída quando existir base real de vendas ou movimentação."
              isOpen={isFastMovingItemsDrawerOpen}
              onClose={() => setIsFastMovingItemsDrawerOpen(false)}
            >
              <div className="space-y-4">
                <EmptyState text={salesPlaceholder} />

                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
                    Como esse bloco deve funcionar
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-zinc-700">
                    Quando existir histórico real de vendas, pedidos ou movimentação de estoque, esta tela deve mostrar quais piscinas, químicos, acessórios e outros itens saem mais.
                  </p>
                </div>
              </div>
            </DashboardDetailDrawer>
          </>
        ) : null}

      </div>
    </main>
  );
}
