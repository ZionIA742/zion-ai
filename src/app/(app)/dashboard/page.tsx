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
    lowStockItems: Array<{
      id: string;
      sku: string | null;
      name: string;
      priceCents: number | null;
      currency: string;
      stockQuantity: number | null;
      isActive: boolean;
    }>;
    zeroStockItems: Array<{
      id: string;
      sku: string | null;
      name: string;
      priceCents: number | null;
      currency: string;
      stockQuantity: number | null;
      isActive: boolean;
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
  | "crm"
  | "agenda"
  | "estoque"
  | "historico";

const tabs: Array<{ id: DashboardTab; label: string; icon: string }> = [
  { id: "geral", label: "Geral", icon: "⌂" },
  { id: "ia", label: "IA", icon: "◉" },
  { id: "crm", label: "CRM", icon: "◇" },
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
  const text = String(value || "sem_status").replaceAll("_", " ").trim();

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
    user: "Usuário",
    human: "Humano",
    incoming: "Entrada",
    outgoing: "Saída",
  };

  return dictionary[text] || text.charAt(0).toUpperCase() + text.slice(1);
}

function compactText(value: string | null | undefined, max = 90) {
  const text = String(value || "").trim();
  if (!text) return "Sem prévia";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function getMaxValue(values: number[]) {
  return Math.max(1, ...values);
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-zinc-500">{text}</p>;
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
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </p>
      <p
        className={
          size === "large"
            ? "mt-3 text-4xl font-semibold tracking-tight text-zinc-950"
            : "mt-2 text-2xl font-semibold tracking-tight text-zinc-950"
        }
      >
        {value}
      </p>
      {helper ? <p className="mt-2 text-sm text-zinc-500">{helper}</p> : null}
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
      className={`rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm ${className}`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-zinc-500">{description}</p>
          ) : null}
        </div>
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
        <div key={label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-zinc-700">
              {formatLabel(label)}
            </span>
            <span className="font-medium text-zinc-950">{formatNumber(value)}</span>
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
    <div>
      <div className="flex h-4 overflow-hidden rounded-full border border-zinc-200 bg-zinc-100">
        <div className="bg-zinc-950" style={{ width: `${aiWidth}%` }} />
        <div className="bg-zinc-500" style={{ width: `${humanWidth}%` }} />
        <div className="bg-zinc-300" style={{ width: `${customerWidth}%` }} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-zinc-600">
        <div>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-zinc-950" />
          IA: {formatNumber(ai)}
        </div>
        <div>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-zinc-500" />
          Humano: {formatNumber(human)}
        </div>
        <div>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-zinc-300" />
          Cliente: {formatNumber(customer)}
        </div>
      </div>
    </div>
  );
}

function DataTable({
  headers,
  rows,
  emptyText,
}: {
  headers: string[];
  rows: Array<Array<React.ReactNode>>;
  emptyText: string;
}) {
  if (!rows.length) {
    return <EmptyState text={emptyText} />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200">
      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-[0.14em] text-zinc-500">
            <tr>
              {headers.map((header) => (
                <th key={header} className="px-3 py-3 font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="text-zinc-700">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-3 py-3 align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex rounded-full border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-700">
      {children}
    </span>
  );
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("geral");
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
  }, []);

  const dashboardTitle = useMemo(() => {
    if (activeTab === "geral") return "Visão geral";
    if (activeTab === "ia") return "IA no atendimento";
    if (activeTab === "crm") return "CRM e conversas";
    if (activeTab === "agenda") return "Agenda e compromissos";
    if (activeTab === "estoque") return "Catálogo e estoque";
    return "Histórico da operação";
  }, [activeTab]);

  if (isLoading) {
    return (
      <main className="min-h-screen bg-zinc-50 p-4 md:p-6">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-zinc-700">
            Carregando dashboard da loja...
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
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
      <main className="min-h-screen bg-zinc-50 p-4 md:p-6">
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

  const mainCards = [
    {
      label: "Participação da IA",
      value: formatPercent(summary.ai.aiParticipationPercent),
      helper: `${formatNumber(summary.messages.ai)} mensagens da IA no mês`,
    },
    {
      label: "Conversas ativas",
      value: formatNumber(summary.conversations.active),
      helper: `${formatNumber(summary.conversations.humanActive)} com humano ativo`,
    },
    {
      label: "Leads no mês",
      value: formatNumber(summary.leads.month),
      helper: `${formatNumber(summary.leads.today)} novos hoje`,
    },
    {
      label: "Follow-ups pendentes",
      value: formatNumber(summary.followups.pending),
      helper: `${formatNumber(summary.followups.total)} acompanhamentos no total`,
    },
  ];

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="border-b border-zinc-200 bg-white">
        <div className="px-4 py-4 md:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-zinc-500">
                Dashboard da loja
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                {dashboardTitle}
              </h1>
              <p className="mt-1 text-sm text-zinc-500">
                Dados reais da operação. Atualizado em{" "}
                {formatDateTime(metrics.generatedAt)}.
              </p>
            </div>

            <button
              type="button"
              onClick={loadDashboardMetrics}
              className="w-fit rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm transition hover:border-zinc-950"
            >
              Atualizar dados
            </button>
          </div>

          <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex min-w-fit items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition ${
                    isActive
                      ? "border-zinc-950 bg-zinc-950 text-white"
                      : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-950"
                  }`}
                >
                  <span>{tab.icon}</span>
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="space-y-5 p-4 md:p-6">
        {activeTab === "geral" ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {mainCards.map((card) => (
                <MetricCard
                  key={card.label}
                  label={card.label}
                  value={card.value}
                  helper={card.helper}
                />
              ))}
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
              <SectionCard
                title="Painel principal"
                description="Resumo rápido do que está acontecendo na loja agora."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <MetricCard
                    label="Mensagens hoje"
                    value={formatNumber(summary.messages.today)}
                    helper={`${formatNumber(summary.messages.last7Days)} nos últimos 7 dias`}
                    size="large"
                  />
                  <MetricCard
                    label="Compromissos hoje"
                    value={formatNumber(summary.appointments.today)}
                    helper={`${formatNumber(summary.appointments.future)} compromissos futuros`}
                    size="large"
                  />
                  <MetricCard
                    label="Itens ativos"
                    value={formatNumber(summary.catalog.activeItems)}
                    helper={`${formatNumber(summary.catalog.lowStockItems)} com estoque baixo`}
                  />
                  <MetricCard
                    label="Valor em estoque"
                    value={formatCurrencyFromCents(
                      summary.catalog.estimatedInventoryValueCents
                    )}
                    helper="Estimativa por preço x quantidade"
                  />
                </div>
              </SectionCard>

              <SectionCard
                title="Alertas operacionais"
                description="Pontos que podem precisar de atenção."
              >
                {lists.operationalAlerts.length ? (
                  <div className="space-y-3">
                    {lists.operationalAlerts.map((alert) => (
                      <div
                        key={`${alert.type}-${alert.title}`}
                        className="rounded-xl border border-zinc-200 bg-zinc-50 p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold text-zinc-950">
                            {alert.title}
                          </h3>
                          <StatusPill>{formatLabel(alert.severity)}</StatusPill>
                        </div>
                        <p className="mt-1 text-sm text-zinc-600">
                          {alert.description}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="Nenhum alerta importante no momento." />
                )}
              </SectionCard>
            </div>

            <div className="grid gap-5 xl:grid-cols-3">
              <SectionCard
                title="Leads por etapa"
                description="Distribuição atual dos leads no CRM."
              >
                <HorizontalBars items={summary.leads.byState} />
              </SectionCard>

              <SectionCard
                title="Conversas por status"
                description="Situação das conversas da loja."
              >
                <HorizontalBars items={summary.conversations.byStatus} />
              </SectionCard>

              <SectionCard
                title="Compromissos por status"
                description="Agenda no período analisado."
              >
                <HorizontalBars items={summary.appointments.byStatus} />
              </SectionCard>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <SectionCard title="Próximos compromissos">
                <DataTable
                  headers={["Cliente", "Compromisso", "Status", "Data"]}
                  emptyText="Nenhum compromisso futuro encontrado."
                  rows={lists.nextAppointments.map((appointment) => [
                    appointment.customerName || "Cliente sem nome",
                    appointment.title,
                    <StatusPill key="status">
                      {formatLabel(appointment.status)}
                    </StatusPill>,
                    formatDateTime(appointment.scheduledStart),
                  ])}
                />
              </SectionCard>

              <SectionCard title="Conversas recentes">
                <DataTable
                  headers={["Cliente", "Status", "Última mensagem", "Quando"]}
                  emptyText="Nenhuma conversa recente encontrada."
                  rows={lists.recentConversations.map((conversation) => [
                    conversation.customerName,
                    <StatusPill key="status">
                      {formatLabel(conversation.status)}
                    </StatusPill>,
                    compactText(conversation.lastMessagePreview),
                    formatDateTime(conversation.lastMessageAt),
                  ])}
                />
              </SectionCard>
            </div>
          </>
        ) : null}

        {activeTab === "ia" ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <MetricCard
                label="Participação da IA"
                value={formatPercent(summary.ai.aiParticipationPercent)}
                helper="Base: mensagens do mês"
              />
              <MetricCard
                label="Execuções da IA"
                value={formatNumber(summary.ai.runsThisMonth)}
                helper={`${formatNumber(summary.ai.successfulRunsThisMonth)} com sucesso`}
              />
              <MetricCard
                label="Falhas da IA"
                value={formatNumber(summary.ai.failedRunsThisMonth)}
                helper={`${formatNumber(summary.ai.failedQueueActions)} ações com erro`}
              />
              <MetricCard
                label="Custo estimado"
                value={`US$ ${summary.ai.totalCostUsd.toFixed(4)}`}
                helper="Com base em ai_runs"
              />
              <MetricCard
                label="Tempo médio"
                value={
                  summary.ai.averageLatencyMs
                    ? `${formatNumber(summary.ai.averageLatencyMs)} ms`
                    : "Sem dado"
                }
                helper="Latência média da IA"
              />
            </div>

            <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
              <SectionCard
                title="IA x humano x cliente"
                description="Distribuição das mensagens do mês."
              >
                <SplitProgress
                  ai={summary.messages.ai}
                  human={summary.messages.humanOperator}
                  customer={summary.messages.customer}
                />
              </SectionCard>

              <SectionCard
                title="Processos com maior presença da IA"
                description="Participação calculada por mensagens da conversa."
              >
                <DataTable
                  headers={["Cliente", "IA", "Mensagens", "Última mensagem"]}
                  emptyText="Ainda não há conversas com dados suficientes."
                  rows={lists.conversationsWithAiPresence.map((item) => [
                    item.customerName,
                    <span key="ai" className="font-semibold text-zinc-950">
                      {formatPercent(item.aiParticipationPercent)}
                    </span>,
                    `${formatNumber(item.aiMessages)} IA / ${formatNumber(
                      item.totalMessages
                    )} total`,
                    compactText(item.lastMessagePreview, 70),
                  ])}
                />
              </SectionCard>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <SectionCard
                title="Decisões da IA por ação"
                description="Ações registradas em ai_decisions neste mês."
              >
                <HorizontalBars items={summary.ai.decisionsByAction} />
              </SectionCard>

              <SectionCard
                title="Fila de ações da IA"
                description="Ações automáticas pendentes ou com erro."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <MetricCard
                    label="Pendentes"
                    value={formatNumber(summary.ai.pendingQueueActions)}
                    helper="Ainda não processadas"
                  />
                  <MetricCard
                    label="Com erro"
                    value={formatNumber(summary.ai.failedQueueActions)}
                    helper="Precisam de atenção técnica"
                  />
                </div>
              </SectionCard>
            </div>
          </>
        ) : null}

        {activeTab === "crm" ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Total de leads"
                value={formatNumber(summary.leads.total)}
                helper={`${formatNumber(summary.leads.today)} criados hoje`}
              />
              <MetricCard
                label="Leads no mês"
                value={formatNumber(summary.leads.month)}
                helper={`${formatNumber(summary.leads.last7Days)} nos últimos 7 dias`}
              />
              <MetricCard
                label="Conversas ativas"
                value={formatNumber(summary.conversations.active)}
                helper={`${formatNumber(summary.conversations.total)} conversas no total`}
              />
              <MetricCard
                label="Mensagens no mês"
                value={formatNumber(summary.messages.month)}
                helper={`${formatNumber(summary.messages.today)} hoje`}
              />
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <SectionCard title="Leads recentes">
                <DataTable
                  headers={["Nome", "Telefone", "Etapa", "Criado em"]}
                  emptyText="Nenhum lead encontrado."
                  rows={lists.recentLeads.map((lead) => [
                    lead.name || "Lead sem nome",
                    lead.phone || "Sem telefone",
                    <StatusPill key="state">{formatLabel(lead.state)}</StatusPill>,
                    formatDate(lead.createdAt),
                  ])}
                />
              </SectionCard>

              <SectionCard title="Últimas mensagens">
                <DataTable
                  headers={["Origem", "Mensagem", "Quando"]}
                  emptyText="Nenhuma mensagem recente encontrada."
                  rows={lists.recentMessages.map((message) => [
                    message.isAi
                      ? "IA"
                      : message.isHumanOperator
                        ? "Humano"
                        : "Cliente",
                    compactText(message.content, 100),
                    formatDateTime(message.createdAt),
                  ])}
                />
              </SectionCard>
            </div>
          </>
        ) : null}

        {activeTab === "agenda" ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Hoje"
                value={formatNumber(summary.appointments.today)}
                helper="Compromissos para hoje"
              />
              <MetricCard
                label="Futuros"
                value={formatNumber(summary.appointments.future)}
                helper="Compromissos ainda pela frente"
              />
              <MetricCard
                label="Follow-ups pendentes"
                value={formatNumber(summary.followups.pending)}
                helper="Aguardando acompanhamento"
              />
              <MetricCard
                label="Total de follow-ups"
                value={formatNumber(summary.followups.total)}
                helper="Histórico registrado"
              />
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <SectionCard title="Próximos compromissos">
                <DataTable
                  headers={["Cliente", "Tipo", "Status", "Data"]}
                  emptyText="Nenhum compromisso futuro encontrado."
                  rows={lists.nextAppointments.map((appointment) => [
                    appointment.customerName || "Cliente sem nome",
                    formatLabel(appointment.appointmentType),
                    <StatusPill key="status">
                      {formatLabel(appointment.status)}
                    </StatusPill>,
                    formatDateTime(appointment.scheduledStart),
                  ])}
                />
              </SectionCard>

              <SectionCard title="Follow-ups pendentes">
                <DataTable
                  headers={["Status", "Canal", "Tentativas", "Data base"]}
                  emptyText="Nenhum follow-up pendente encontrado."
                  rows={lists.pendingFollowups.map((followup) => [
                    <StatusPill key="status">
                      {formatLabel(followup.followupStatus)}
                    </StatusPill>,
                    formatLabel(followup.preferredChannel),
                    formatNumber(followup.promptCount),
                    formatDateTime(followup.scheduledEnd),
                  ])}
                />
              </SectionCard>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <SectionCard title="Compromissos por status">
                <HorizontalBars items={summary.appointments.byStatus} />
              </SectionCard>

              <SectionCard title="Compromissos por tipo">
                <HorizontalBars items={summary.appointments.byType} />
              </SectionCard>
            </div>
          </>
        ) : null}

        {activeTab === "estoque" ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <MetricCard
                label="Itens no catálogo"
                value={formatNumber(summary.catalog.totalItems)}
                helper={`${formatNumber(summary.catalog.activeItems)} ativos`}
              />
              <MetricCard
                label="Com estoque"
                value={formatNumber(summary.catalog.stockTrackedItems)}
                helper="Itens com controle ativo"
              />
              <MetricCard
                label="Estoque baixo"
                value={formatNumber(summary.catalog.lowStockItems)}
                helper="Quantidade entre 1 e 3"
              />
              <MetricCard
                label="Estoque zerado"
                value={formatNumber(summary.catalog.zeroStockItems)}
                helper="Precisa de atenção"
              />
              <MetricCard
                label="Valor estimado"
                value={formatCurrencyFromCents(
                  summary.catalog.estimatedInventoryValueCents
                )}
                helper="Preço x quantidade"
              />
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <SectionCard title="Itens com estoque baixo">
                <DataTable
                  headers={["Produto", "SKU", "Qtd", "Preço"]}
                  emptyText="Nenhum item com estoque baixo encontrado."
                  rows={lists.lowStockItems.map((item) => [
                    item.name,
                    item.sku || "Sem SKU",
                    <span key="qty" className="font-semibold text-zinc-950">
                      {formatNumber(item.stockQuantity || 0)}
                    </span>,
                    formatCurrencyFromCents(item.priceCents),
                  ])}
                />
              </SectionCard>

              <SectionCard title="Itens sem estoque">
                <DataTable
                  headers={["Produto", "SKU", "Qtd", "Preço"]}
                  emptyText="Nenhum item zerado encontrado."
                  rows={lists.zeroStockItems.map((item) => [
                    item.name,
                    item.sku || "Sem SKU",
                    <span key="qty" className="font-semibold text-zinc-950">
                      {formatNumber(item.stockQuantity || 0)}
                    </span>,
                    formatCurrencyFromCents(item.priceCents),
                  ])}
                />
              </SectionCard>
            </div>

            <SectionCard
              title="Produtos que mais saem"
              description="Ainda não há tabela confiável de venda/pedido/movimentação de estoque. Quando esse registro existir, este bloco deve mostrar ranking real de saída."
            >
              <EmptyState text={summary.sales.reason} />
            </SectionCard>
          </>
        ) : null}

        {activeTab === "historico" ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Mensagens no mês"
                value={formatNumber(summary.messages.month)}
                helper={`${formatNumber(summary.messages.last7Days)} nos últimos 7 dias`}
              />
              <MetricCard
                label="Leads no mês"
                value={formatNumber(summary.leads.month)}
                helper={`${formatNumber(summary.leads.last7Days)} nos últimos 7 dias`}
              />
              <MetricCard
                label="Execuções IA"
                value={formatNumber(summary.ai.runsThisMonth)}
                helper="Neste mês"
              />
              <MetricCard
                label="Custo IA"
                value={`US$ ${summary.ai.totalCostUsd.toFixed(4)}`}
                helper="Estimativa do mês"
              />
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <SectionCard title="Mensagens por remetente">
                <HorizontalBars items={summary.messages.bySender} />
              </SectionCard>

              <SectionCard title="Mensagens por direção">
                <HorizontalBars items={summary.messages.byDirection} />
              </SectionCard>
            </div>

            <SectionCard
              title="Faturamento e vendas"
              description="Este bloco ficará pronto quando o sistema tiver origem confiável de vendas, pedidos ou orçamentos aprovados."
            >
              <EmptyState text={summary.sales.reason} />
            </SectionCard>
          </>
        ) : null}
      </div>
    </main>
  );
}
