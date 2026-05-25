// src/app/(app)/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

const ORGANIZATION_ID = "b02252ce-0e73-4371-9e23-f1009e7b1698";
const STORE_ID = "6ac8f4b1-e50f-42c0-9cae-78951d6daf7b";

type DashboardMetrics = {
  ok: boolean;
  organizationId: string;
  storeId: string;
  generatedAt: string;
  summary: {
    leads: {
      total: number;
      today: number;
      last7Days: number;
      month: number;
      byState: Record<string, number>;
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
      currency: string;
      stockQuantity: number | null;
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
      currency: string;
      stockQuantity: number | null;
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
      currency: string;
      stockQuantity: number | null;
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
      currency: string;
      stockQuantity: number | null;
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

type DashboardTab =
  | "geral"
  | "ia"
  | "agenda"
  | "estoque"
  | "historico";

const tabs: Array<{ id: DashboardTab; label: string; icon: string }> = [
  { id: "geral", label: "Geral", icon: "⌂" },
  { id: "ia", label: "IA", icon: "◉" },
  { id: "agenda", label: "Agenda", icon: "◷" },
  { id: "estoque", label: "Estoque", icon: "▤" },
  { id: "historico", label: "Histórico", icon: "▥" },
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

function MetricCard({
  label,
  value,
  helper,
  size = "normal",
}: {
  label: string;
  value: string | number;
  helper?: string;
  size?: "normal" | "large";
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="break-words text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
        {label}
      </p>
      <p
        className={
          size === "large"
            ? "mt-3 break-words text-4xl font-semibold tracking-tight text-zinc-950"
            : "mt-1 break-words text-xl font-semibold tracking-tight text-zinc-950"
        }
      >
        {value}
      </p>
      {helper ? (
        <p className="mt-2 break-words text-sm leading-relaxed text-zinc-500">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm ${className}`}
    >
      <div className="mb-4 min-w-0">
        <h2 className="break-words text-base font-semibold text-zinc-950">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 break-words text-sm leading-relaxed text-zinc-500">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function HorizontalBars({
  items,
  maxItems = 7,
}: {
  items: Record<string, number>;
  maxItems?: number;
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
              className="h-full rounded-full bg-zinc-950"
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
        <div className="bg-zinc-950" style={{ width: `${aiWidth}%` }} />
        <div className="bg-zinc-500" style={{ width: `${humanWidth}%` }} />
        <div className="bg-zinc-300" style={{ width: `${customerWidth}%` }} />
      </div>

      <div className="mt-3 grid gap-2 text-xs text-zinc-600 sm:grid-cols-3">
        <div className="break-words">
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-zinc-950" />
          IA: {formatNumber(ai)}
        </div>
        <div className="break-words">
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-zinc-500" />
          Loja: {formatNumber(human)}
        </div>
        <div className="break-words">
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-zinc-300" />
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
    stockQuantity: number | null;
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
              {item.trackStock === false ? "Sem controle" : formatNumber(item.stockQuantity || 0)}
            </div>
            <div>
              <span className="font-medium text-zinc-950">Valor unitário: </span>
              {formatCurrencyFromCents(item.priceCents)}
            </div>
            <div>
              <span className="font-medium text-zinc-950">Valor em estoque: </span>
              {item.trackStock === false
                ? "Sem controle"
                : formatCurrencyFromCents((item.priceCents || 0) * (item.stockQuantity || 0))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function InsightCard({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
      <h3 className="break-words text-sm font-semibold text-zinc-950">
        {title}
      </h3>
      <p className="mt-2 break-words text-sm leading-relaxed text-zinc-600">
        {text}
      </p>
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

function ExecutiveNumberCard({
  title,
  value,
  helper,
  className = "",
}: {
  title: string;
  value: string | number;
  helper?: string;
  className?: string;
}) {
  return (
    <div
      className={`min-w-0 rounded-[6px] border border-zinc-300 bg-white p-2.5 text-center shadow-sm ${className}`}
    >
      <p className="break-words text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
        {title}
      </p>
      <p className="mt-1 break-words text-xl font-semibold tracking-tight text-zinc-950">
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

function GoalGauge({
  percent,
  label,
  helper,
}: {
  percent: number;
  label: string;
  helper?: string;
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
    <DashboardPanel className="min-h-0">
      <div className="text-center">
        <h3 className="text-base font-medium text-zinc-950">Meta do mês</h3>
      </div>

      <div className="mt-3 flex flex-col items-center">
        <div className="relative h-[140px] w-[300px] max-w-full">
          <svg
            viewBox="0 0 300 150"
            className="h-full w-full overflow-visible"
            aria-label="Progresso da meta do mês"
          >
            <path
              d="M 35 125 A 115 115 0 0 1 265 125"
              fill="none"
              stroke="#e4e4e7"
              strokeWidth="22"
              strokeLinecap="round"
            />
            {arcPercent > 0 ? (
              <path
                d="M 35 125 A 115 115 0 0 1 265 125"
                fill="none"
                stroke="#16a34a"
                strokeWidth="22"
                strokeLinecap="butt"
                strokeDasharray={`${filledLength} ${arcLength}`}
              />
            ) : null}
          </svg>

          <div className="absolute inset-x-0 top-[82px] flex justify-center text-center">
            <span className="block min-w-[34px] text-center text-lg font-semibold leading-none text-zinc-950">
              {hasGoal ? formatPercent(displayPercent) : "0%"}
            </span>
          </div>

          <div className="absolute inset-x-[20px] bottom-[6px] flex items-center justify-between">
            <span className="block text-xs font-medium leading-none text-zinc-700">
              0%
            </span>
            <span className="block text-xs font-medium leading-none text-zinc-700">
              100%
            </span>
          </div>
        </div>

        <div className="-mt-1 w-full max-w-[260px] text-center">
          <p className="break-words text-base font-medium leading-snug text-zinc-950">
            Meta: {hasGoal ? formatCurrencyFromCents(configuredGoalCents) : "Não definida"}
          </p>
          <p className="mt-1 break-words text-base font-medium leading-snug text-zinc-950">
            Hoje: {hasGoal ? formatCurrencyFromCents(currentRevenueCents) : "Sem vendas"}
          </p>
        </div>
      </div>
    </DashboardPanel>
  );
}

function CompactRanking({
  title,
  columns,
  rows,
  emptyText,
}: {
  title: string;
  columns: string[];
  rows: Array<Array<React.ReactNode>>;
  emptyText: string;
}) {
  return (
    <DashboardPanel>
      <PanelTitle title={title} />
      {rows.length ? (
        <div className="space-y-2">
          <div
            className="grid gap-2 rounded-[4px] bg-zinc-50 px-3 py-2 text-xs font-medium uppercase tracking-[0.08em] text-zinc-500"
            style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
          >
            {columns.map((column) => (
              <span key={column} className="break-words">
                {column}
              </span>
            ))}
          </div>
          {rows.map((row, index) => (
            <div
              key={index}
              className="grid gap-2 border-b border-zinc-100 px-3 py-2 text-sm last:border-b-0"
              style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
            >
              {row.map((cell, cellIndex) => (
                <div key={cellIndex} className="min-w-0 break-words">
                  {cell}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[6px] border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm leading-relaxed text-zinc-500">
          {emptyText}
        </div>
      )}
    </DashboardPanel>
  );
}

function WeeklySalesChart({
  title,
  emptyText,
}: {
  title: string;
  emptyText: string;
}) {
  const weeks = [
    { label: "Semana 1", value: 0 },
    { label: "Semana 2", value: 0 },
    { label: "Semana 3", value: 0 },
    { label: "Semana 4", value: 0 },
  ];
  const max = getMaxValue(weeks.map((week) => week.value));

  return (
    <DashboardPanel className="min-h-[210px]">
      <PanelTitle title={title} helper="Vendas e quantidade por semana." />
      <div className="flex h-32 items-end gap-4 border-b border-l border-zinc-200 px-4">
        {weeks.map((week) => (
          <div key={week.label} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
            <div
              className="w-full rounded-t-[4px] bg-zinc-900"
              style={{ height: `${Math.max(8, (week.value / max) * 100)}px` }}
            />
            <span className="break-words text-center text-[11px] text-zinc-500">
              {week.label}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 rounded-[6px] border border-dashed border-zinc-300 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-500">
        {emptyText}
      </p>
    </DashboardPanel>
  );
}

type DetailItem = {
  id: string;
  label: string;
  value: string;
  helper: string;
  detailTitle: string;
  detailText: string;
  howToResolve?: string;
};

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

  const visibleSlices = total ? slices.filter((slice) => slice.percent > 0) : slices;

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

function PaymentCirclePanel({
  slices,
  emptyText,
}: {
  slices: PaymentSlice[];
  emptyText: string;
}) {
  return (
    <DashboardPanel className="min-h-[190px]">
      <PanelTitle title="Formas de pagamento" />
      <PaymentDonut slices={slices} emptyText={emptyText} />
    </DashboardPanel>
  );
}

function SmallDonutPlaceholder({
  title,
  helper,
  emptyText,
}: {
  title: string;
  helper: string;
  emptyText: string;
}) {
  return (
    <DashboardPanel className="min-h-0">
      <PanelTitle title={title} helper={helper} />
      <div className="grid min-w-0 gap-4 sm:grid-cols-[128px_minmax(0,1fr)] sm:items-center">
        <div className="mx-auto h-28 w-28 rounded-full border border-zinc-300 bg-[conic-gradient(#111827_0deg_0deg,#f4f4f5_0deg_360deg)] p-6">
          <div className="flex h-full w-full items-center justify-center rounded-full border border-zinc-200 bg-white text-center text-xs font-medium text-zinc-500">
            Sem dados
          </div>
        </div>
        <p className="rounded-[6px] border border-dashed border-zinc-300 bg-zinc-50 p-2 text-xs leading-relaxed text-zinc-500">
          {emptyText}
        </p>
      </div>
    </DashboardPanel>
  );
}

function PendingDashboardPanel({
  items,
  selectedId,
  onSelect,
}: {
  items: DetailItem[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const selected = items.find((item) => item.id === selectedId) || items[0];

  function openIssue(id: string) {
    onSelect(id);
    setIsDrawerOpen(true);
  }

  return (
    <>
      <DashboardPanel>
        <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="break-words text-sm font-semibold uppercase tracking-[0.08em] text-zinc-950">
              Pendências da operação
            </h3>
            <p className="mt-1 break-words text-xs leading-relaxed text-zinc-500">
              Clique em uma linha para ver os detalhes e como resolver.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-950">
            {formatNumber(items.length)} item(s)
          </span>
        </div>

        <div className="space-y-1.5">
          {items.map((item) => {
            const severity = item.value.toLowerCase();
            const dotClass =
              severity.includes("crítico") || severity.includes("pendente")
                ? "bg-red-500"
                : severity.includes("atenção")
                  ? "bg-orange-500"
                  : "bg-emerald-500";

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => openIssue(item.id)}
                className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-left transition hover:border-zinc-950 hover:bg-white"
              >
                <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
                <span className="min-w-0 truncate text-sm font-semibold text-zinc-950">
                  {item.label}
                </span>
                <span className="rounded-full border border-zinc-200 bg-white px-3 py-0.5 text-xs font-semibold text-zinc-950">
                  {item.value}
                </span>
                <span className="text-sm font-semibold text-zinc-500">›</span>
              </button>
            );
          })}
        </div>
      </DashboardPanel>

      {isDrawerOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Fechar detalhes da pendência"
            onClick={() => setIsDrawerOpen(false)}
            className="absolute inset-0 bg-black/35"
          />

          <aside className="relative z-10 flex h-full w-full max-w-[560px] flex-col overflow-hidden bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                  <h3 className="break-words text-lg font-semibold text-zinc-950">
                    {selected.label}
                  </h3>
                  <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-semibold text-zinc-700">
                    {selected.value}
                  </span>
                </div>
                <p className="mt-2 break-words text-sm text-zinc-500">
                  Detalhes da pendência
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-950 transition hover:border-zinc-950"
              >
                Fechar
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
                  O que está errado
                </p>
                <h4 className="mt-2 break-words text-xl font-semibold text-zinc-950">
                  {selected.detailTitle}
                </h4>
                <p className="mt-3 break-words text-sm leading-relaxed text-zinc-700">
                  {selected.detailText}
                </p>
              </div>

              {selected.howToResolve ? (
                <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
                    Como resolver
                  </p>
                  <p className="mt-3 break-words text-sm leading-relaxed text-zinc-700">
                    {selected.howToResolve}
                  </p>
                </div>
              ) : null}

              <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
                  Próximo passo
                </p>
                <p className="mt-3 text-sm leading-relaxed text-zinc-700">
                  Resolva esta pendência no módulo indicado. Depois, atualize o dashboard
                  para confirmar se ela saiu da lista ou mudou de status.
                </p>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

const DASHBOARD_ACTIVE_TAB_STORAGE_KEY = "zion.dashboard.activeTab";
const DASHBOARD_SCROLL_STORAGE_KEY = "zion.dashboard.scrollY";

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

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<DashboardTab>(() => {
    if (typeof window === "undefined") return "geral";

    const savedTab = window.localStorage.getItem(DASHBOARD_ACTIVE_TAB_STORAGE_KEY);
    return isDashboardTab(savedTab) ? savedTab : "geral";
  });
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isTodayAppointmentsDrawerOpen, setIsTodayAppointmentsDrawerOpen] = useState(false);
  const [isUrgentStatesDrawerOpen, setIsUrgentStatesDrawerOpen] = useState(false);
  const [isPendingFollowupsDrawerOpen, setIsPendingFollowupsDrawerOpen] = useState(false);
  const [isMonthFollowupsDrawerOpen, setIsMonthFollowupsDrawerOpen] = useState(false);
  const [isCatalogStockDrawerOpen, setIsCatalogStockDrawerOpen] = useState(false);
  const [isTrackedStockDrawerOpen, setIsTrackedStockDrawerOpen] = useState(false);
  const [isLowStockDrawerOpen, setIsLowStockDrawerOpen] = useState(false);
  const [isZeroStockDrawerOpen, setIsZeroStockDrawerOpen] = useState(false);
  const [isInventoryValueDrawerOpen, setIsInventoryValueDrawerOpen] = useState(false);
  const [isFastMovingItemsDrawerOpen, setIsFastMovingItemsDrawerOpen] = useState(false);
  const [isHistoricalMonthDrawerOpen, setIsHistoricalMonthDrawerOpen] = useState(false);
  const [selectedHistoricalMonth, setSelectedHistoricalMonth] = useState("Mês anterior");
  const [historicalDetailDrawer, setHistoricalDetailDrawer] = useState<
    null | "messages" | "leads" | "conversations" | "appointments" | "currentMonth"
  >(null);
  const [generalDetailDrawer, setGeneralDetailDrawer] = useState<string | null>(null);
  const [isRegionDrawerOpen, setIsRegionDrawerOpen] = useState(false);
  const [selectedBestSellerCategory, setSelectedBestSellerCategory] = useState<string | null>(null);
  const [aiDetailDrawer, setAiDetailDrawer] = useState<
    null | "distribution" | "messages" | "conversations" | "pending" | "processes" | "actions"
  >(null);
  const [isNextAppointmentsDrawerOpen, setIsNextAppointmentsDrawerOpen] = useState(false);
  const [selectedGeneralItemId, setSelectedGeneralItemId] = useState('revenue_month');
  const [selectedPendingIssueId, setSelectedPendingIssueId] = useState('sales_source');

  async function loadDashboardMetrics() {
    try {
      setIsLoading(true);
      setErrorMessage(null);

      const response = await fetch(
        `/api/dashboard/metrics?organizationId=${ORGANIZATION_ID}&storeId=${STORE_ID}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok || !data?.ok) {
        throw new Error(
          data?.message || "Não foi possível carregar o dashboard agora."
        );
      }

      setMetrics(data);
    } catch (error: any) {
      setErrorMessage(
        error?.message || "Não foi possível carregar o dashboard agora."
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadDashboardMetrics();
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(DASHBOARD_ACTIVE_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const previousBodyOverflowY = document.body.style.overflowY;
    const previousHtmlOverflowY = document.documentElement.style.overflowY;

    if (activeTab === "ia" || activeTab === "agenda" || activeTab === "historico" || activeTab === "estoque") {
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

    if (activeTab === "ia" || activeTab === "agenda" || activeTab === "historico" || activeTab === "estoque") {
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
      if (activeTab === "ia" || activeTab === "agenda" || activeTab === "historico" || activeTab === "estoque") {
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
  }, []);

  const dashboardTitle = useMemo(() => {
    if (activeTab === "geral") return "Visão geral";
    if (activeTab === "ia") return "IA no atendimento";
    if (activeTab === "agenda") return "Agenda e compromissos";
    if (activeTab === "estoque") return "Catálogo e estoque";
    return "Histórico da operação";
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

  const generalSalesCards = [
    {
      label: "Faturamento do mês",
      value: summary.sales.available ? "R$ 0,00" : "Sem dados",
      helper: summary.sales.available
        ? "Total vendido no mês"
        : "Aguardando origem real de vendas",
    },
    {
      label: "Vendas hoje",
      value: summary.sales.available ? "0" : "Sem dados",
      helper: summary.sales.available
        ? "Vendas registradas hoje"
        : "Precisa de pedidos/vendas registrados",
    },
    {
      label: "Vendas na semana",
      value: summary.sales.available ? "0" : "Sem dados",
      helper: summary.sales.available
        ? "Vendas registradas na semana"
        : "Sem fonte confiável ainda",
    },
    {
      label: "Vendas no mês",
      value: summary.sales.available ? "0" : "Sem dados",
      helper: summary.sales.available
        ? "Vendas registradas no mês"
        : "Sem fonte confiável ainda",
    },
    {
      label: "Meta do mês",
      value: "Não definida",
      helper: "Precisa de configuração de meta mensal",
    },
  ];

  const generalOperationCards = [
    {
      label: "% venda por lead",
      value: summary.sales.available ? "0%" : "Sem dados",
      helper: "Precisa cruzar leads com vendas fechadas",
    },
    {
      label: "Mensagens hoje",
      value: formatNumber(summary.messages.today),
      helper: `${formatNumber(summary.messages.last7Days)} nos últimos 7 dias`,
    },
    {
      label: "Compromissos hoje",
      value: formatNumber(summary.appointments.today),
      helper: `${formatNumber(summary.appointments.future)} compromisso(s) futuro(s)`,
    },
    {
      label: "Leads do mês",
      value: formatNumber(summary.leads.month),
      helper: `${formatNumber(summary.leads.today)} novo(s) hoje`,
    },
    {
      label: "Pendências",
      value: formatNumber(summary.followups.pending + summary.ai.pendingQueueActions),
      helper: "Follow-ups e ações automáticas pendentes",
    },
  ];

  const aiSupportText =
    summary.ai.aiParticipationPercent >= 70
      ? "A IA está conduzindo boa parte do atendimento registrado neste mês."
      : summary.ai.aiParticipationPercent >= 40
        ? "A IA está participando de uma parte relevante dos atendimentos."
        : "A IA ainda aparece pouco nos atendimentos deste período.";

  const operationMovementText =
    summary.messages.month > 0
      ? `A loja teve ${formatNumber(summary.messages.month)} mensagens no mês, sendo ${formatNumber(summary.messages.last7Days)} nos últimos 7 dias.`
      : "Ainda não há movimento suficiente de mensagens neste mês.";

  const salesPlaceholder =
    "Ainda não existe uma origem confiável de vendas, pedidos ou orçamentos aprovados conectada ao dashboard. Quando essa base existir, este bloco deve mostrar faturamento, ticket médio e produtos mais vendidos.";

  const paymentSlices: PaymentSlice[] = [
    { label: "Pix", percent: 0, color: "#111827" },
    { label: "Cartão", percent: 0, color: "#2563eb" },
    { label: "Dinheiro", percent: 0, color: "#16a34a" },
    { label: "Boleto", percent: 0, color: "#d97706" },
    { label: "Financiamento", percent: 0, color: "#7c3aed" },
  ];

  const generalDetailItems: DetailItem[] = [
    {
      id: "revenue_month",
      label: "Faturamento do mês",
      value: summary.sales.available ? "R$ 0,00" : "Sem dados",
      helper: "Total vendido no mês.",
      detailTitle: "Faturamento do mês",
      detailText:
        "Este indicador deve mostrar quanto a loja vendeu no mês atual. Hoje ele ainda não tem uma origem confiável de vendas/pedidos/faturamento conectada.",
      howToResolve:
        "Criar ou conectar uma base real de pedidos, vendas ou orçamentos aprovados com valor, data, cliente, forma de pagamento e itens vendidos.",
    },
    {
      id: "sales_today",
      label: "Vendas hoje",
      value: summary.sales.available ? "0" : "Sem dados",
      helper: "Vendas registradas no dia.",
      detailTitle: "Vendas hoje",
      detailText:
        "Este indicador deve mostrar quantas vendas foram fechadas hoje. Não será preenchido enquanto o ZION não tiver registro real de vendas.",
      howToResolve:
        "Conectar o fechamento comercial do CRM/orçamento a uma tabela de vendas ou pedidos aprovados.",
    },
    {
      id: "sales_week",
      label: "Vendas na semana",
      value: summary.sales.available ? "0" : "Sem dados",
      helper: "Vendas registradas na semana.",
      detailTitle: "Vendas na semana",
      detailText:
        "Este indicador deve mostrar o volume de vendas na semana atual, usando somente vendas reais registradas no sistema.",
      howToResolve:
        "Registrar data de fechamento em vendas/pedidos e somar somente registros da semana atual.",
    },
    {
      id: "sales_month",
      label: "Vendas no mês",
      value: summary.sales.available ? "0" : "Sem dados",
      helper: "Vendas registradas no mês.",
      detailTitle: "Vendas no mês",
      detailText:
        "Este indicador deve mostrar a quantidade de vendas fechadas no mês atual.",
      howToResolve:
        "Criar origem confiável de venda concluída, separando lead em negociação de venda realmente fechada.",
    },
    {
      id: "monthly_goal",
      label: "Meta do mês",
      value: "Não definida",
      helper: "Meta comercial mensal da loja.",
      detailTitle: "Meta do mês",
      detailText:
        "A meta mensal ainda não foi configurada. Esse indicador deve comparar faturamento ou vendas reais com a meta escolhida pela loja.",
      howToResolve:
        "Adicionar configuração de meta mensal por loja, com valor em reais e/ou quantidade de vendas.",
    },
    {
      id: "conversion_rate",
      label: "% venda por lead",
      value: summary.sales.available ? "0%" : "Sem dados",
      helper: "Conversão de leads em vendas.",
      detailTitle: "% de venda por lead",
      detailText:
        "Este indicador deve mostrar quantos leads viraram venda. Hoje ele ainda não pode ser calculado com segurança porque falta origem real de venda fechada.",
      howToResolve:
        "Conectar venda/pedido aprovado ao lead e calcular vendas fechadas dividido pelo total de leads do período.",
    },
    {
      id: "messages_today",
      label: "Mensagens hoje",
      value: formatNumber(summary.messages.today),
      helper: `${formatNumber(summary.messages.last7Days)} nos últimos 7 dias.`,
      detailTitle: "Mensagens hoje",
      detailText:
        "Mostra o movimento de mensagens registradas hoje na loja, considerando a base atual de mensagens.",
    },
    {
      id: "appointments_today",
      label: "Compromissos hoje",
      value: formatNumber(summary.appointments.today),
      helper: `${formatNumber(summary.appointments.future)} compromisso(s) futuro(s).`,
      detailTitle: "Compromissos de hoje",
      detailText:
        "Mostra quantos compromissos existem hoje na agenda da loja e quantos ainda estão pela frente.",
    },
    {
      id: "leads_month",
      label: "Leads do mês",
      value: formatNumber(summary.leads.month),
      helper: `${formatNumber(summary.leads.today)} novo(s) hoje.`,
      detailTitle: "Leads do mês",
      detailText:
        "Mostra quantos leads foram criados no mês atual e quantos chegaram hoje.",
    },
    {
      id: "pending",
      label: "Pendências",
      value: formatNumber(summary.followups.pending + summary.ai.pendingQueueActions + summary.catalog.zeroStockItems + summary.catalog.lowStockItems),
      helper: "Pontos que precisam de atenção.",
      detailTitle: "Pendências da operação",
      detailText:
        "Mostra problemas, dados faltando e processos que precisam de ação humana ou melhoria no sistema.",
      howToResolve:
        "Abrir a lista de pendências abaixo e resolver item por item conforme a orientação apresentada.",
    },
  ];

  const pendingIssues: DetailItem[] = [
    {
      id: "sales_source",
      label: "Vendas/faturamento sem origem confiável",
      value: summary.sales.available ? "OK" : "Pendente",
      helper: "Impede faturamento, vendas por período e conversão real.",
      detailTitle: "Criar origem real de vendas",
      detailText:
        "O dashboard ainda não encontrou tabela confiável de vendas, pedidos ou orçamentos aprovados. Por isso, faturamento, vendas por dia/semana/mês, ticket médio e produtos mais vendidos não devem ser inventados.",
      howToResolve:
        "Implementar uma base de vendas/pedidos aprovados com organization_id, store_id, lead_id, conversation_id, valor, data, status, forma de pagamento e itens vendidos.",
    },
    {
      id: "monthly_goal_missing",
      label: "Meta mensal não configurada",
      value: "Pendente",
      helper: "A loja ainda não tem meta para comparar resultado.",
      detailTitle: "Configurar meta do mês",
      detailText:
        "Sem meta mensal, o dashboard não consegue mostrar percentual atingido nem alertar se a loja está abaixo do esperado.",
      howToResolve:
        "Adicionar configuração de meta mensal por loja em reais e/ou número de vendas, depois comparar com o faturamento real do mês.",
    },
    {
      id: "lead_origin_missing",
      label: "Origem dos leads não conectada",
      value: "Pendente",
      helper: "Impede saber de onde os clientes estão vindo.",
      detailTitle: "Conectar origem dos leads",
      detailText:
        "O dashboard precisa saber se o lead veio de WhatsApp, site, indicação, anúncio, manual ou outro canal. Hoje não há campo confiável conectado para essa leitura.",
      howToResolve:
        "Registrar origem do lead no cadastro/conversa e padronizar as opções por loja para montar a distribuição real.",
    },
    {
      id: "region_missing",
      label: "Região de venda não conectada",
      value: "Pendente",
      helper: "Impede saber qual região vende mais.",
      detailTitle: "Conectar região do cliente/venda",
      detailText:
        "Para saber qual região vende mais, o sistema precisa de endereço, cidade, bairro ou região vinculada ao lead e à venda fechada.",
      howToResolve:
        "Padronizar campos de endereço/região do lead e cruzar com vendas reais aprovadas.",
    },
    {
      id: "payment_missing",
      label: "Formas de pagamento sem registro de uso",
      value: "Pendente",
      helper: "Impede calcular a porcentagem por forma usada.",
      detailTitle: "Registrar forma de pagamento usada",
      detailText:
        "O painel deve mostrar a porcentagem das formas de pagamento realmente usadas, considerando apenas as formas ativadas pela loja. Hoje ainda não há venda registrada com forma de pagamento.",
      howToResolve:
        "No fechamento da venda/pedido, salvar a forma de pagamento escolhida e validar contra as formas configuradas pela loja.",
    },
    {
      id: "top_products_missing",
      label: "Produtos mais vendidos sem base de saída",
      value: "Pendente",
      helper: "Impede ranking real por categoria.",
      detailTitle: "Criar histórico de itens vendidos",
      detailText:
        "Para mostrar piscina, produto, acessório, químico e outros que mais vendem, o sistema precisa registrar os itens vendidos em cada pedido.",
      howToResolve:
        "Criar itens de venda/pedido ligados ao catálogo e registrar quantidade, preço e categoria no momento da venda.",
    },
    ...lists.operationalAlerts.map((alert) => ({
      id: `alert_${alert.type}`,
      label: alert.title,
      value: formatLabel(alert.severity),
      helper: alert.description,
      detailTitle: alert.title,
      detailText: alert.description,
      howToResolve:
        alert.type === "stock_zero"
          ? "Atualizar o estoque dos itens zerados ou marcar o item como indisponível/inativo até reposição."
          : alert.type === "stock_low"
            ? "Revisar os itens com estoque baixo e fazer reposição ou ajustar disponibilidade no catálogo."
            : alert.type === "followups"
              ? "Abrir os follow-ups pendentes e concluir, remarcar ou registrar o resultado do acompanhamento."
              : alert.type === "ai_queue_errors"
                ? "Verificar as ações da IA com erro e corrigir o motivo antes de reprocessar."
                : "Abrir o módulo relacionado e resolver a pendência apontada.",
    })),
  ];

  const allCatalogItems = lists.allCatalogItems || [];
  const inStockItems = lists.inStockItems || [];
  const inventoryValueByCategoryCents = summary.catalog.inventoryValueByCategoryCents || {
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

  const historicalMonthItems = ["Mês anterior", "Há 2 meses", "Há 3 meses"];

  function openHistoricalMonth(monthLabel: string) {
    setSelectedHistoricalMonth(monthLabel);
    setIsHistoricalMonthDrawerOpen(true);
  }

  const historicalDetailTitle =
    historicalDetailDrawer === "messages"
      ? "Mensagens do mês"
      : historicalDetailDrawer === "leads"
        ? "Leads no mês"
        : historicalDetailDrawer === "conversations"
          ? "Conversas ativas"
          : historicalDetailDrawer === "appointments"
            ? "Compromissos futuros"
            : "Resumo do mês atual";

  const historicalDetailDescription =
    historicalDetailDrawer === "messages"
      ? "Resumo das mensagens registradas no mês atual."
      : historicalDetailDrawer === "leads"
        ? "Leads registrados no período e informações disponíveis."
        : historicalDetailDrawer === "conversations"
          ? "Conversas abertas e últimos sinais de atendimento."
          : historicalDetailDrawer === "appointments"
            ? "Pessoas, horários e dados dos próximos compromissos."
            : "Explicação dos indicadores comerciais do mês em andamento.";

  return (
    <main
      className={`overflow-x-hidden bg-zinc-50 text-zinc-950 ${
        (activeTab === "ia" || activeTab === "agenda" || activeTab === "historico" || activeTab === "estoque") ? "h-auto min-h-0" : "min-h-screen"
      }`}
    >
      <div className="border-b border-zinc-200 bg-white">
        <div className="px-4 py-4 md:px-6">
          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h1 className="break-words text-2xl font-semibold tracking-tight">
                {dashboardTitle}
              </h1>

            </div>

            <button
              type="button"
              onClick={loadDashboardMetrics}
              className="w-fit rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm transition hover:border-zinc-950"
            >
              Atualizar dados
            </button>
          </div>

          <div className="mt-5 flex max-w-full flex-wrap gap-2 pb-1">
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
        </div>
      </div>

      <div
        className={`min-w-0 ${
          (activeTab === "ia" || activeTab === "agenda" || activeTab === "historico" || activeTab === "estoque") ? "space-y-3 p-4 pb-0 md:p-6 md:pb-0" : "space-y-5 p-4 md:p-6"
        }`}
      >
        {activeTab === "geral" ? (
          <>
            <div className="space-y-4">
              <div className="grid min-w-0 gap-4 xl:grid-cols-[0.95fr_1.35fr]">
                <div className="grid min-w-0 gap-4">
                  <GoalGauge
                    percent={0}
                    label="% da meta"
                    helper="Só aparece com meta mensal configurada e vendas reais registradas."
                  />

                  <PaymentCirclePanel
                    slices={paymentSlices}
                    emptyText="Ainda não há vendas com forma de pagamento registrada."
                  />

                  <SmallDonutPlaceholder
                    title="De onde os leads vêm"
                    helper="Origem dos leads por canal."
                    emptyText="Ainda não há campo confiável de origem do lead conectado ao dashboard."
                  />
                </div>

                <div className="grid min-w-0 gap-4">
                  <div className="grid min-w-0 gap-3 md:grid-cols-3">
                    {[
                      ["revenue_month", "Faturamento do mês", "Sem dados"],
                      ["sales_today", "Vendas hoje", "Sem dados"],
                      ["sales_week", "Vendas semana", "Sem dados"],
                    ].map(([id, title, value]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setGeneralDetailDrawer(id)}
                        className="min-w-0 rounded-[6px] border border-zinc-300 bg-white p-2.5 text-center shadow-sm transition hover:border-zinc-950"
                      >
                        <p className="break-words text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
                          {title}
                        </p>
                        <p className="mt-1 break-words text-xl font-semibold tracking-tight text-zinc-950">
                          {value}
                        </p>
                      </button>
                    ))}
                  </div>

                  <div className="grid min-w-0 gap-3 md:grid-cols-3">
                    <ExecutiveNumberCard
                      title="% venda por lead"
                      value="Sem dados"
                      helper="Conversão"
                    />
                    <button
                      type="button"
                      onClick={() => setGeneralDetailDrawer("leads_month")}
                      className="min-w-0 rounded-[6px] border border-zinc-300 bg-white p-2.5 text-center shadow-sm transition hover:border-zinc-950"
                    >
                      <p className="break-words text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
                        Leads do mês
                      </p>
                      <p className="mt-1 break-words text-xl font-semibold tracking-tight text-zinc-950">
                        {formatNumber(summary.leads.month)}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setGeneralDetailDrawer("pending")}
                      className="min-w-0 rounded-[6px] border border-zinc-300 bg-white p-2.5 text-center shadow-sm transition hover:border-zinc-950"
                    >
                      <p className="break-words text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
                        Pendências
                      </p>
                      <p className="mt-1 break-words text-xl font-semibold tracking-tight text-zinc-950">
                        {formatNumber(
                          summary.followups.pending +
                            summary.ai.pendingQueueActions +
                            summary.catalog.zeroStockItems +
                            summary.catalog.lowStockItems +
                            (summary.sales.available ? 0 : 5)
                        )}
                      </p>
                    </button>
                  </div>

                  <div className="grid min-w-0 gap-3 md:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setGeneralDetailDrawer("messages_today")}
                      className="min-w-0 rounded-[6px] border border-zinc-300 bg-white p-2.5 text-center shadow-sm transition hover:border-zinc-950"
                    >
                      <p className="break-words text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
                        Mensagens hoje
                      </p>
                      <p className="mt-1 break-words text-xl font-semibold tracking-tight text-zinc-950">
                        {formatNumber(summary.messages.today)}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setGeneralDetailDrawer("appointments_today")}
                      className="min-w-0 rounded-[6px] border border-zinc-300 bg-white p-2.5 text-center shadow-sm transition hover:border-zinc-950"
                    >
                      <p className="break-words text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
                        Compromissos hoje
                      </p>
                      <p className="mt-1 break-words text-xl font-semibold tracking-tight text-zinc-950">
                        {formatNumber(summary.appointments.today)}
                      </p>
                    </button>
                  </div>

                  <div className="grid min-w-0 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                    <WeeklySalesChart
                      title="Vendas por semana"
                      emptyText="Ainda não há vendas registradas por semana."
                    />

                    <button
                      type="button"
                      onClick={() => setIsRegionDrawerOpen(true)}
                      className="block w-full min-w-0 rounded-[6px] border border-zinc-300 bg-white p-3 text-left shadow-sm transition hover:border-zinc-950"
                    >
                      <PanelTitle title="Região que mais vende" />
                      <div className="rounded-[6px] border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm leading-relaxed text-zinc-500">
                        Ainda não há região de venda conectada aos pedidos.
                      </div>
                    </button>
                  </div>

                  <DashboardPanel>
                    <PanelTitle title="Mais vendidos" />
                    <div className="space-y-2">
                      {[
                        ["Piscina", "Piscina"],
                        ["Químico", "Químico"],
                        ["Acessório", "Acessório"],
                        ["Outro", "Outro"],
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setSelectedBestSellerCategory(id)}
                          className="grid w-full min-w-0 gap-2 rounded-[6px] border border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-sm transition hover:border-zinc-950 hover:bg-white sm:grid-cols-[minmax(0,1fr)_auto]"
                        >
                          <span className="min-w-0 break-words font-medium text-zinc-950">
                            {label}
                          </span>
                          <span className="shrink-0 text-zinc-500">Sem dados ›</span>
                        </button>
                      ))}
                    </div>
                  </DashboardPanel>
                </div>
              </div>

              <PendingDashboardPanel
                items={pendingIssues}
                selectedId={selectedPendingIssueId}
                onSelect={setSelectedPendingIssueId}
              />
            </div>

            <DashboardDetailDrawer
              title={
                generalDetailItems.find((item) => item.id === generalDetailDrawer)?.detailTitle ||
                "Detalhes"
              }
              description="Informações do bloco selecionado."
              isOpen={generalDetailDrawer !== null}
              onClose={() => setGeneralDetailDrawer(null)}
            >
              {(() => {
                const selected = generalDetailItems.find((item) => item.id === generalDetailDrawer);

                if (!selected) return null;

                return (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
                        Resumo
                      </p>
                      <div className="mt-3 flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="break-words text-xl font-semibold text-zinc-950">
                            {selected.label}
                          </h4>
                          <p className="mt-2 break-words text-sm leading-relaxed text-zinc-700">
                            {selected.detailText}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-700">
                          {selected.value}
                        </span>
                      </div>
                    </div>

                    {generalDetailDrawer === "messages_today" ? (
                      <DashboardPanel>
                        <PanelTitle title="Mensagens recentes" />
                        <InfoList
                          emptyText="Nenhuma mensagem recente encontrada."
                          items={lists.recentMessages.slice(0, 8).map((message) => ({
                            id: message.id,
                            title: message.isAi ? "IA" : message.isHumanOperator ? "Loja" : "Cliente",
                            subtitle: compactText(message.content, 130),
                            meta: <span>{formatLabel(message.direction)}</span>,
                            right: <span className="text-xs text-zinc-500">{formatDateTime(message.createdAt)}</span>,
                          }))}
                        />
                      </DashboardPanel>
                    ) : null}

                    {generalDetailDrawer === "leads_month" ? (
                      <DashboardPanel>
                        <PanelTitle title="Leads recentes" />
                        <InfoList
                          emptyText="Nenhum lead recente encontrado."
                          items={lists.recentLeads.slice(0, 8).map((lead) => ({
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
                    ) : null}

                    {generalDetailDrawer === "appointments_today" ? (
                      <DashboardPanel>
                        <PanelTitle title="Compromissos de hoje" />
                        <InfoList
                          emptyText="Nenhum compromisso encontrado para hoje."
                          items={todayAppointments.map((appointment) => ({
                            id: appointment.id,
                            title: appointment.customerName || "Cliente sem nome",
                            subtitle: appointment.title,
                            meta: (
                              <>
                                <StatusPill>{formatLabel(appointment.status)}</StatusPill>
                                <span>Tipo: {formatLabel(appointment.appointmentType)}</span>
                                <span>Horário: {formatDateTime(appointment.scheduledStart)}</span>
                                {appointment.customerPhone ? <span>Telefone: {appointment.customerPhone}</span> : null}
                                <MapsRouteButton
                                  addressText={getAppointmentRouteAddress(appointment)}
                                  compact
                                />
                              </>
                            ),
                          }))}
                        />
                      </DashboardPanel>
                    ) : null}

                    {generalDetailDrawer === "pending" ? (
                      <DashboardPanel>
                        <PanelTitle title="Pendências encontradas" />
                        <InfoList
                          emptyText="Nenhuma pendência encontrada."
                          items={pendingIssues.map((issue) => ({
                            id: issue.id,
                            title: issue.label,
                            subtitle: issue.helper,
                            right: <StatusPill>{issue.value}</StatusPill>,
                          }))}
                        />
                      </DashboardPanel>
                    ) : null}

                    {selected.howToResolve ? (
                      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
                          Como resolver
                        </p>
                        <p className="mt-3 break-words text-sm leading-relaxed text-zinc-700">
                          {selected.howToResolve}
                        </p>
                      </div>
                    ) : null}
                  </div>
                );
              })()}
            </DashboardDetailDrawer>

            <DashboardDetailDrawer
              title="Região que mais vende"
              description="Regiões com maior número de vendas quando houver base comercial real."
              isOpen={isRegionDrawerOpen}
              onClose={() => setIsRegionDrawerOpen(false)}
            >
              <div className="space-y-4">
                <EmptyState text="Ainda não há região de venda conectada aos pedidos." />
                <DashboardPanel>
                  <PanelTitle title="O que este bloco deve mostrar" />
                  <p className="text-sm leading-relaxed text-zinc-700">
                    Quando a base de vendas estiver conectada, esta tela deve listar as regiões com mais vendas e permitir entender onde a loja está vendendo melhor.
                  </p>
                </DashboardPanel>
              </div>
            </DashboardDetailDrawer>

            <DashboardDetailDrawer
              title={selectedBestSellerCategory ? `Mais vendidos: ${selectedBestSellerCategory}` : "Mais vendidos"}
              description="Itens vendidos e clientes relacionados à categoria escolhida."
              isOpen={selectedBestSellerCategory !== null}
              onClose={() => setSelectedBestSellerCategory(null)}
            >
              <div className="space-y-4">
                <EmptyState text="Ainda não há histórico real de itens vendidos para esta categoria." />
                <DashboardPanel>
                  <PanelTitle title="Como deve funcionar" />
                  <p className="text-sm leading-relaxed text-zinc-700">
                    Quando existir base real de pedidos ou vendas, esta tela deve mostrar quais itens foram vendidos, a quantidade de cada item e para quais clientes.
                  </p>
                </DashboardPanel>
              </div>
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
                    className="block w-full min-w-0 rounded-[6px] border border-zinc-300 bg-white p-3 text-left shadow-sm transition hover:border-zinc-950"
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
                      className="min-w-0 rounded-[6px] border border-zinc-300 bg-white p-2 text-center shadow-sm transition hover:border-zinc-950"
                    >
                      <p className="break-words text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                        Mensagens da IA
                      </p>
                      <p className="mt-0.5 break-words text-lg font-semibold tracking-tight text-zinc-950">
                        {formatNumber(summary.messages.ai)}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiDetailDrawer("conversations")}
                      className="min-w-0 rounded-[6px] border border-zinc-300 bg-white p-2 text-center shadow-sm transition hover:border-zinc-950"
                    >
                      <p className="break-words text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                        Conversas com IA
                      </p>
                      <p className="mt-0.5 break-words text-lg font-semibold tracking-tight text-zinc-950">
                        {formatNumber(lists.conversationsWithAiPresence.length)}
                      </p>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setAiDetailDrawer("pending")}
                    className="block w-full min-w-0 rounded-[6px] border border-zinc-300 bg-white p-3 text-left shadow-sm transition hover:border-zinc-950"
                  >
                    <PanelTitle title="Pendências da IA" />
                    <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                      <div className="rounded-[6px] border border-zinc-200 bg-zinc-50 p-2 text-center">
                        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                          Pendentes
                        </p>
                        <p className="mt-0.5 text-lg font-semibold text-zinc-950">
                          {formatNumber(summary.ai.pendingQueueActions)}
                        </p>
                      </div>
                      <div className="rounded-[6px] border border-zinc-200 bg-zinc-50 p-2 text-center">
                        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
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
                    className="block w-full min-w-0 rounded-[6px] border border-zinc-300 bg-white p-3 text-left shadow-sm transition hover:border-zinc-950"
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
                    className="block w-full min-w-0 rounded-[6px] border border-zinc-300 bg-white p-3 text-left shadow-sm transition hover:border-zinc-950"
                  >
                    <PanelTitle
                      title="O que a IA está fazendo"
                      helper="Ações registradas pela IA neste mês."
                    />
                    <HorizontalBars items={summary.ai.decisionsByAction} />
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
                  className="min-w-0 rounded-[6px] border border-zinc-300 bg-white p-2 text-center shadow-sm transition hover:border-zinc-950"
                >
                  <p className="break-words text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                    Compromisso do dia
                  </p>
                  <p className="mt-0.5 break-words text-lg font-semibold tracking-tight text-zinc-950">
                    {formatNumber(summary.appointments.today)}
                  </p>
                  <p className="mt-0.5 break-words text-[10px] leading-relaxed text-zinc-500">
                    Clique para ver todos
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setIsUrgentStatesDrawerOpen(true)}
                  className="min-w-0 rounded-[6px] border border-zinc-300 bg-white p-2 text-center shadow-sm transition hover:border-zinc-950"
                >
                  <p className="break-words text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                    Estados urgentes
                  </p>
                  <p className="mt-0.5 break-words text-lg font-semibold tracking-tight text-zinc-950">
                    {formatNumber(urgentAgendaItems.length)}
                  </p>
                  <p className="mt-0.5 break-words text-[10px] leading-relaxed text-zinc-500">
                    Clique para ver detalhes
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setIsPendingFollowupsDrawerOpen(true)}
                  className="min-w-0 rounded-[6px] border border-zinc-300 bg-white p-2 text-center shadow-sm transition hover:border-zinc-950"
                >
                  <p className="break-words text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                    Follow-ups pendentes
                  </p>
                  <p className="mt-0.5 break-words text-lg font-semibold tracking-tight text-zinc-950">
                    {formatNumber(summary.followups.pending)}
                  </p>
                  <p className="mt-0.5 break-words text-[10px] leading-relaxed text-zinc-500">
                    Clique para ver lista
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setIsMonthFollowupsDrawerOpen(true)}
                  className="min-w-0 rounded-[6px] border border-zinc-300 bg-white p-2 text-center shadow-sm transition hover:border-zinc-950"
                >
                  <p className="break-words text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                    Follow-ups no mês
                  </p>
                  <p className="mt-0.5 break-words text-lg font-semibold tracking-tight text-zinc-950">
                    {formatNumber(summary.followups.total)}
                  </p>
                  <p className="mt-0.5 break-words text-[10px] leading-relaxed text-zinc-500">
                    Clique para ver lista
                  </p>
                </button>
              </div>

              <div className="grid min-w-0 gap-3 xl:grid-cols-[0.85fr_1.35fr]">
                <div className="grid min-w-0 gap-3">
                  <DashboardPanel>
                    <PanelTitle title="Processos" />
                    <div className="max-h-[145px] overflow-y-auto pr-1">
                      <HorizontalBars items={summary.appointments.byType} />
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
                    className="block w-full min-w-0 cursor-pointer rounded-[6px] border border-zinc-300 bg-white p-3 text-left shadow-sm transition hover:border-zinc-950"
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
                  className="min-w-0 rounded-[6px] border border-zinc-300 bg-white p-2.5 text-center shadow-sm transition hover:border-zinc-950"
                >
                  <p className="break-words text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
                    Itens no catálogo
                  </p>
                  <p className="mt-1 break-words text-xl font-semibold tracking-tight text-zinc-950">
                    {formatNumber(summary.catalog.totalItems)}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setIsTrackedStockDrawerOpen(true)}
                  className="min-w-0 rounded-[6px] border border-zinc-300 bg-white p-2.5 text-center shadow-sm transition hover:border-zinc-950"
                >
                  <p className="break-words text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
                    Com estoque
                  </p>
                  <p className="mt-1 break-words text-xl font-semibold tracking-tight text-zinc-950">
                    {formatNumber(summary.catalog.stockTrackedItems)}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setIsLowStockDrawerOpen(true)}
                  className="min-w-0 rounded-[6px] border border-zinc-300 bg-white p-2.5 text-center shadow-sm transition hover:border-zinc-950"
                >
                  <p className="break-words text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
                    Estoque baixo
                  </p>
                  <p className="mt-1 break-words text-xl font-semibold tracking-tight text-zinc-950">
                    {formatNumber(summary.catalog.lowStockItems)}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setIsZeroStockDrawerOpen(true)}
                  className="min-w-0 rounded-[6px] border border-zinc-300 bg-white p-2.5 text-center shadow-sm transition hover:border-zinc-950"
                >
                  <p className="break-words text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
                    Estoque zerado
                  </p>
                  <p className="mt-1 break-words text-xl font-semibold tracking-tight text-zinc-950">
                    {formatNumber(summary.catalog.zeroStockItems)}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setIsInventoryValueDrawerOpen(true)}
                  className="min-w-0 rounded-[6px] border border-zinc-300 bg-white p-2.5 text-center shadow-sm transition hover:border-zinc-950"
                >
                  <p className="break-words text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
                    Valor em estoque
                  </p>
                  <p className="mt-1 break-words text-xl font-semibold tracking-tight text-zinc-950">
                    {formatCurrencyFromCents(summary.catalog.estimatedInventoryValueCents)}
                  </p>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsFastMovingItemsDrawerOpen(true)}
                className="block w-full min-w-0 rounded-[6px] border border-zinc-300 bg-white p-3 text-left shadow-sm transition hover:border-zinc-950"
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
                          Qtd: {formatNumber(item.stockQuantity || 0)}
                        </span>
                      </div>

                      <p className="mt-3 text-sm text-zinc-500">
                        Valor unitário: {formatCurrencyFromCents(item.priceCents)}
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
                          Qtd: {formatNumber(item.stockQuantity || 0)}
                        </span>
                      </div>

                      <p className="mt-3 text-sm text-zinc-500">
                        Valor unitário: {formatCurrencyFromCents(item.priceCents)}
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

        {activeTab === "historico" ? (
          <>
            <div className="space-y-4">
              <div className="grid min-w-0 gap-3 md:grid-cols-4">
                {[
                  ["messages", "Mensagens do mês", formatNumber(summary.messages.month)],
                  ["leads", "Leads no mês", formatNumber(summary.leads.month)],
                  ["conversations", "Conversas ativas", formatNumber(summary.conversations.active)],
                  ["appointments", "Compromissos futuros", formatNumber(summary.appointments.future)],
                ].map(([id, title, value]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() =>
                      setHistoricalDetailDrawer(
                        id as "messages" | "leads" | "conversations" | "appointments"
                      )
                    }
                    className="min-w-0 rounded-[6px] border border-zinc-300 bg-white p-2.5 text-center shadow-sm transition hover:border-zinc-950"
                  >
                    <p className="break-words text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
                      {title}
                    </p>
                    <p className="mt-1 break-words text-xl font-semibold tracking-tight text-zinc-950">
                      {value}
                    </p>
                  </button>
                ))}
              </div>

              <div className="grid min-w-0 gap-4 xl:grid-cols-[1fr_0.9fr]">
                <DashboardPanel>
                  <PanelTitle
                    title="Histórico dos meses anteriores"
                    helper="Clique em um mês para ver vendas, meta, resultado e itens vendidos."
                  />
                  <div className="space-y-2">
                    {historicalMonthItems.map((monthLabel) => (
                      <button
                        key={monthLabel}
                        type="button"
                        onClick={() => openHistoricalMonth(monthLabel)}
                        className="grid w-full min-w-0 gap-2 rounded-[6px] border border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-sm transition hover:border-zinc-950 hover:bg-white sm:grid-cols-[minmax(0,1fr)_minmax(84px,0.5fr)_minmax(84px,0.5fr)_minmax(88px,0.55fr)_minmax(82px,0.5fr)_auto]"
                      >
                        <span className="min-w-0 break-words font-medium text-zinc-950">
                          {monthLabel}
                        </span>
                        <span className="min-w-0 break-words text-zinc-700">
                          Vendido: Sem dados
                        </span>
                        <span className="min-w-0 break-words text-zinc-700">
                          Meta: Sem dados
                        </span>
                        <span className="min-w-0 break-words text-zinc-700">
                          Resultado: Sem dados
                        </span>
                        <span className="min-w-0 break-words text-zinc-700">
                          Itens: Sem dados
                        </span>
                        <span className="shrink-0 text-zinc-500">›</span>
                      </button>
                    ))}
                  </div>
                </DashboardPanel>

                <button
                  type="button"
                  onClick={() => setHistoricalDetailDrawer("currentMonth")}
                  className="min-w-0 rounded-[6px] border border-zinc-300 bg-white p-3 text-left shadow-sm transition hover:border-zinc-950"
                >
                  <PanelTitle
                    title="Resumo do mês atual"
                    helper="Clique para ver o que cada indicador representa."
                  />
                  <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                    {[
                      ["Vendido no mês", "Sem dados"],
                      ["Meta do mês", "Não definida"],
                      ["Resultado", "Sem dados"],
                      ["Itens vendidos", "Sem dados"],
                    ].map(([title, value]) => (
                      <div
                        key={title}
                        className="rounded-[6px] border border-zinc-200 bg-zinc-50 p-3"
                      >
                        <p className="text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">
                          {title}
                        </p>
                        <p className="mt-1 text-lg font-semibold text-zinc-950">
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>
                </button>
              </div>
            </div>

            <DashboardDetailDrawer
              title={historicalDetailTitle}
              description={historicalDetailDescription}
              isOpen={historicalDetailDrawer !== null}
              onClose={() => setHistoricalDetailDrawer(null)}
            >
              {historicalDetailDrawer === "messages" ? (
                <div className="space-y-4">
                  <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                    <ExecutiveNumberCard title="Mensagens no mês" value={formatNumber(summary.messages.month)} />
                    <ExecutiveNumberCard title="Últimos 7 dias" value={formatNumber(summary.messages.last7Days)} />
                    <ExecutiveNumberCard title="Hoje" value={formatNumber(summary.messages.today)} />
                  </div>
                  <DashboardPanel>
                    <PanelTitle title="Quem participou" />
                    <SplitProgress ai={summary.messages.ai} human={summary.messages.humanOperator} customer={summary.messages.customer} />
                  </DashboardPanel>
                  <DashboardPanel>
                    <PanelTitle title="Mensagens recentes" />
                    <InfoList
                      emptyText="Nenhuma mensagem recente encontrada."
                      items={lists.recentMessages.slice(0, 8).map((message) => ({
                        id: message.id,
                        title: message.isAi ? "IA" : message.isHumanOperator ? "Loja" : "Cliente",
                        subtitle: compactText(message.content, 130),
                        meta: <span>{formatLabel(message.direction)}</span>,
                        right: <span className="text-xs text-zinc-500">{formatDateTime(message.createdAt)}</span>,
                      }))}
                    />
                  </DashboardPanel>
                </div>
              ) : null}

              {historicalDetailDrawer === "leads" ? (
                <div className="space-y-4">
                  <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                    <ExecutiveNumberCard title="Leads no mês" value={formatNumber(summary.leads.month)} />
                    <ExecutiveNumberCard title="Últimos 7 dias" value={formatNumber(summary.leads.last7Days)} />
                    <ExecutiveNumberCard title="Hoje" value={formatNumber(summary.leads.today)} />
                  </div>
                  <DashboardPanel>
                    <PanelTitle title="Leads por etapa" />
                    <HorizontalBars items={summary.leads.byState} />
                  </DashboardPanel>
                  <DashboardPanel>
                    <PanelTitle title="Leads recentes" />
                    <InfoList
                      emptyText="Nenhum lead recente encontrado."
                      items={lists.recentLeads.slice(0, 8).map((lead) => ({
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

              {historicalDetailDrawer === "conversations" ? (
                <div className="space-y-4">
                  <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                    <ExecutiveNumberCard title="Conversas ativas" value={formatNumber(summary.conversations.active)} />
                    <ExecutiveNumberCard title="Humano ativo" value={formatNumber(summary.conversations.humanActive)} />
                    <ExecutiveNumberCard title="Total" value={formatNumber(summary.conversations.total)} />
                  </div>
                  <DashboardPanel>
                    <PanelTitle title="Conversas por status" />
                    <HorizontalBars items={summary.conversations.byStatus} />
                  </DashboardPanel>
                  <DashboardPanel>
                    <PanelTitle title="Conversas recentes" />
                    <InfoList
                      emptyText="Nenhuma conversa recente encontrada."
                      items={lists.recentConversations.slice(0, 8).map((conversation) => ({
                        id: conversation.id,
                        title: conversation.customerName || "Cliente sem nome",
                        subtitle: compactText(conversation.lastMessagePreview, 130),
                        meta: (
                          <>
                            <StatusPill>{formatLabel(conversation.status)}</StatusPill>
                            <span>Última mensagem: {formatDateTime(conversation.lastMessageAt)}</span>
                            {conversation.isHumanActive ? <span>Humano ativo</span> : null}
                          </>
                        ),
                      }))}
                    />
                  </DashboardPanel>
                </div>
              ) : null}

              {historicalDetailDrawer === "appointments" ? (
                <div className="space-y-4">
                  <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                    <ExecutiveNumberCard title="Compromissos futuros" value={formatNumber(summary.appointments.future)} />
                    <ExecutiveNumberCard title="Hoje" value={formatNumber(summary.appointments.today)} />
                    <ExecutiveNumberCard title="Follow-ups pendentes" value={formatNumber(summary.followups.pending)} />
                  </div>
                  <DashboardPanel>
                    <PanelTitle title="Próximos compromissos" />
                    <InfoList
                      emptyText="Nenhum compromisso futuro encontrado."
                      items={lists.nextAppointments.slice(0, 10).map((appointment) => ({
                        id: appointment.id,
                        title: appointment.customerName || "Cliente sem nome",
                        subtitle: appointment.title,
                        meta: (
                          <>
                            <StatusPill>{formatLabel(appointment.status)}</StatusPill>
                            <span>Tipo: {formatLabel(appointment.appointmentType)}</span>
                            <span>Horário: {formatDateTime(appointment.scheduledStart)}</span>
                            {appointment.customerPhone ? <span>Telefone: {appointment.customerPhone}</span> : null}
                            <MapsRouteButton
                              addressText={getAppointmentRouteAddress(appointment)}
                              compact
                            />
                          </>
                        ),
                      }))}
                    />
                  </DashboardPanel>
                </div>
              ) : null}

              {historicalDetailDrawer === "currentMonth" ? (
                <div className="space-y-4">
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                    <ExecutiveNumberCard title="Vendido no mês" value="Sem dados" />
                    <ExecutiveNumberCard title="Meta do mês" value="Não definida" />
                    <ExecutiveNumberCard title="Resultado" value="Sem dados" />
                    <ExecutiveNumberCard title="Itens vendidos" value="Sem dados" />
                  </div>
                  <DashboardPanel>
                    <PanelTitle title="O que este bloco mostra" />
                    <p className="text-sm leading-relaxed text-zinc-700">
                      Este resumo deve mostrar o desempenho comercial do mês atual: quanto a loja vendeu, qual era a meta, se bateu a meta e quais itens foram vendidos.
                    </p>
                  </DashboardPanel>
                  <DashboardPanel>
                    <PanelTitle title="Dados que ainda faltam" />
                    <p className="text-sm leading-relaxed text-zinc-700">
                      Hoje ainda não existe uma origem confiável de vendas, pedidos, metas e itens vendidos conectada ao dashboard. Por isso, estes campos continuam como “Sem dados” ou “Não definida”.
                    </p>
                  </DashboardPanel>
                </div>
              ) : null}
            </DashboardDetailDrawer>

            <DashboardDetailDrawer
              title={selectedHistoricalMonth}
              description="Histórico comercial do mês selecionado."
              isOpen={isHistoricalMonthDrawerOpen}
              onClose={() => setIsHistoricalMonthDrawerOpen(false)}
            >
              <div className="space-y-4">
                <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                  <ExecutiveNumberCard title="Quanto foi vendido" value="Sem dados" />
                  <ExecutiveNumberCard title="Meta do mês" value="Sem dados" />
                  <ExecutiveNumberCard title="Resultado" value="Sem dados" />
                </div>

                <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                  <ExecutiveNumberCard title="Vendas fechadas" value="Sem dados" />
                  <ExecutiveNumberCard title="Ticket médio" value="Sem dados" />
                  <ExecutiveNumberCard title="Itens vendidos" value="Sem dados" />
                </div>

                <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                  <ExecutiveNumberCard title="Leads gerados" value="Sem dados" />
                  <ExecutiveNumberCard title="Conversas abertas" value="Sem dados" />
                  <ExecutiveNumberCard title="Compromissos" value="Sem dados" />
                </div>

                <DashboardPanel>
                  <PanelTitle title="Meta" />
                  <p className="text-sm leading-relaxed text-zinc-700">
                    Quando existir venda real e meta configurada, este resumo vai mostrar se a loja bateu a meta, quanto faltou ou quanto passou.
                  </p>
                </DashboardPanel>

                <DashboardPanel>
                  <PanelTitle title="O que foi vendido" />
                  <EmptyState text="Ainda não há histórico real de itens vendidos para este mês." />
                </DashboardPanel>
              </div>
            </DashboardDetailDrawer>

          </>
        ) : null}
      </div>
    </main>
  );
}
