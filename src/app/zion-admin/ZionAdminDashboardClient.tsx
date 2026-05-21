"use client";

import { useState } from "react";

type OverviewPanelKey =
  | "ia"
  | "cost"
  | "tokens"
  | "pending"
  | "conversations"
  | "messages"
  | "leads"
  | "appointments"
  | "assistant";

export type ZionAdminOverview = {
  admin: {
    role: string;
  };
  totals: {
    organizations: number | null;
    stores: number | null;
    storesActive?: number | null;
    storesTrial?: number | null;
    storesInactive?: number | null;
    leads: number | null;
    conversations: number | null;
    messages: number | null;
    salesAiMessages?: number | null;
    appointments: number | null;
    assistantThreads: number | null;
    assistantMessages: number | null;
    aiRuns?: number | null;
    successfulAiRuns?: number | null;
    failedAiRuns?: number | null;
    totalTokensPrompt?: number | null;
    totalTokensCompletion?: number | null;
    totalTokens?: number | null;
    tokensPromptToday?: number | null;
    tokensCompletionToday?: number | null;
    tokensToday?: number | null;
    tokensPromptLast7Days?: number | null;
    tokensCompletionLast7Days?: number | null;
    tokensLast7Days?: number | null;
    tokensPromptMonth?: number | null;
    tokensCompletionMonth?: number | null;
    tokensMonth?: number | null;
    tokenBreakdownTotal?: TokenUsageBreakdown | null;
    tokenBreakdownToday?: TokenUsageBreakdown | null;
    tokenBreakdownLast7Days?: TokenUsageBreakdown | null;
    tokenBreakdownMonth?: TokenUsageBreakdown | null;
    totalCostUsd?: number | string | null;
    costUsdToday?: number | string | null;
    costUsdLast7Days?: number | string | null;
    costUsdMonth?: number | string | null;
    costBreakdownTotal?: AiUsageBreakdown | null;
    costBreakdownToday?: AiUsageBreakdown | null;
    costBreakdownLast7Days?: AiUsageBreakdown | null;
    costBreakdownMonth?: AiUsageBreakdown | null;
    pendingAiRuns?: number | null;
    aiRunQueueErrors?: number | null;
    pendingSalesActions?: number | null;
    salesActionErrors?: number | null;
    configurationIssues?: number | null;
    pendingWhatsappEvents?: number | null;
    whatsappErrors?: number | null;
    totalOperationalIssues?: number | null;
  };
  countErrors: Record<string, string | null>;
  stores: ZionAdminStore[];
  future: {
    billing: string;
    paymentStatus: string;
    aiCost: string;
    tokens: string;
    workersHealth: string;
    integrationErrors: string;
  };
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
  source: string;
  label: string;
  error: string | null;
  occurredAt: string | null;
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

type AiUsageBreakdown = {
  salesChatUsd?: number | string | null;
  assistantChatUsd?: number | string | null;
  imageGenerationUsd?: number | string | null;
  visualCatalogUsd?: number | string | null;
  unclassifiedUsd?: number | string | null;
};

type TokenUsageBreakdown = {
  salesChatTokens?: number | string | null;
  assistantChatTokens?: number | string | null;
  imageGenerationTokens?: number | string | null;
  visualCatalogTokens?: number | string | null;
  unclassifiedTokens?: number | string | null;
};

export type ZionAdminStore = {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  subscriptionStatus: string;
  createdAt: string | null;
  totalLeads?: number | null;
  totalMessages?: number | null;
  totalSalesAiMessages?: number | null;
  totalAppointments?: number | null;
  totalAssistantThreads?: number | null;
  totalAssistantMessages?: number | null;
  totalAiRuns?: number | null;
  successfulAiRuns?: number | null;
  failedAiRuns?: number | null;
  totalTokensPrompt?: number | null;
  totalTokensCompletion?: number | null;
  totalTokens?: number | null;
  tokensPromptToday?: number | null;
  tokensCompletionToday?: number | null;
  tokensToday?: number | null;
  tokensPromptLast7Days?: number | null;
  tokensCompletionLast7Days?: number | null;
  tokensLast7Days?: number | null;
  tokensPromptMonth?: number | null;
  tokensCompletionMonth?: number | null;
  tokensMonth?: number | null;
  tokenBreakdownTotal?: TokenUsageBreakdown | null;
  tokenBreakdownToday?: TokenUsageBreakdown | null;
  tokenBreakdownLast7Days?: TokenUsageBreakdown | null;
  tokenBreakdownMonth?: TokenUsageBreakdown | null;
  totalCostUsd?: number | string | null;
  costUsdToday?: number | string | null;
  costUsdLast7Days?: number | string | null;
  costUsdMonth?: number | string | null;
  costBreakdownTotal?: AiUsageBreakdown | null;
  costBreakdownToday?: AiUsageBreakdown | null;
  costBreakdownLast7Days?: AiUsageBreakdown | null;
  costBreakdownMonth?: AiUsageBreakdown | null;
  lastAiRunAt?: string | null;
  pendingAiRuns?: number | null;
  aiRunQueueErrors?: number | null;
  pendingSalesActions?: number | null;
  salesActionErrors?: number | null;
  configurationIssues?: number | null;
  pendingWhatsappEvents?: number | null;
  whatsappErrors?: number | null;
  totalOperationalIssues?: number | null;
  recentAiErrors?: AiRunEvent[];
  recentAiSuccesses?: AiRunEvent[];
  pendingIssueDetails?: PendingIssueDetail[];
};

type Props = {
  adminRole: string;
  initialData: ZionAdminOverview | null;
  initialError: string | null;
};

function safeNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function numberValue(value: number | string | null | undefined) {
  return safeNumber(value) ?? 0;
}

function formatNumber(value: number | string | null | undefined) {
  const parsed = safeNumber(value);

  if (parsed == null) {
    return "Sem dados";
  }

  return new Intl.NumberFormat("pt-BR").format(parsed);
}

function formatCompactNumber(value: number | string | null | undefined) {
  const parsed = safeNumber(value);

  if (parsed == null) {
    return "Sem dados";
  }

  return new Intl.NumberFormat("pt-BR", {
    notation: parsed >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(parsed);
}

function formatUsd(value: number | string | null | undefined) {
  const parsed = safeNumber(value);

  if (parsed == null) {
    return "Sem dados";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: parsed > 0 && parsed < 1 ? 6 : 2,
    maximumFractionDigits: parsed > 0 && parsed < 1 ? 6 : 2,
  }).format(parsed);
}

function CostPeriodBlocks({
  today,
  week,
  month,
}: {
  today: number | string | null | undefined;
  week: number | string | null | undefined;
  month: number | string | null | undefined;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <DetailItem label="Hoje" value={formatUsd(today)} help="Gasto do dia atual" />
      <DetailItem
        label="Semana"
        value={formatUsd(week)}
        help="De segunda-feira até hoje"
      />
      <DetailItem label="Mês" value={formatUsd(month)} help="Do dia 1 até hoje" />
    </div>
  );
}

function CostBreakdownGrid({ breakdown }: { breakdown?: AiUsageBreakdown | null }) {
  const safeBreakdown = breakdown ?? {};

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <DetailItem
        label="IA vendedora"
        value={formatUsd(safeBreakdown.salesChatUsd)}
        help="Atendimento comercial e decisões de venda identificadas"
      />
      <DetailItem
        label="IA assistente"
        value={formatUsd(safeBreakdown.assistantChatUsd)}
        help="Chat operacional identificado"
      />
      <DetailItem
        label="Geração de imagem"
        value={formatUsd(safeBreakdown.imageGenerationUsd)}
        help="Montagem visual / foto do local quando houver base"
      />
      <DetailItem
        label="Catálogo visual"
        value={formatUsd(safeBreakdown.visualCatalogUsd)}
        help="Leitura visual de documentos/catálogos"
      />
      <DetailItem
        label="Outros / não classificado"
        value={formatUsd(safeBreakdown.unclassifiedUsd)}
        help="Custo sem marcação confiável de origem"
      />
    </div>
  );
}

function TokenPeriodBlocks({
  today,
  week,
  month,
  todayPrompt,
  todayCompletion,
  weekPrompt,
  weekCompletion,
  monthPrompt,
  monthCompletion,
}: {
  today: number | string | null | undefined;
  week: number | string | null | undefined;
  month: number | string | null | undefined;
  todayPrompt?: number | string | null | undefined;
  todayCompletion?: number | string | null | undefined;
  weekPrompt?: number | string | null | undefined;
  weekCompletion?: number | string | null | undefined;
  monthPrompt?: number | string | null | undefined;
  monthCompletion?: number | string | null | undefined;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <DetailItem
        label="Hoje"
        value={formatCompactNumber(today)}
        help={`${formatNumber(todayPrompt)} entrada · ${formatNumber(todayCompletion)} saída`}
      />
      <DetailItem
        label="Semana"
        value={formatCompactNumber(week)}
        help={`${formatNumber(weekPrompt)} entrada · ${formatNumber(weekCompletion)} saída`}
      />
      <DetailItem
        label="Mês"
        value={formatCompactNumber(month)}
        help={`${formatNumber(monthPrompt)} entrada · ${formatNumber(monthCompletion)} saída`}
      />
    </div>
  );
}

function TokenBreakdownGrid({
  breakdown,
}: {
  breakdown?: TokenUsageBreakdown | null;
}) {
  const safeBreakdown = breakdown ?? {};

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <DetailItem
        label="IA vendedora"
        value={formatCompactNumber(safeBreakdown.salesChatTokens)}
        help="Tokens do atendimento comercial e decisões de venda"
      />
      <DetailItem
        label="IA assistente"
        value={formatCompactNumber(safeBreakdown.assistantChatTokens)}
        help="Tokens do chat operacional quando houver marcação"
      />
      <DetailItem
        label="Geração de imagem"
        value={formatCompactNumber(safeBreakdown.imageGenerationTokens)}
        help="Tokens/imagem quando o módulo registrar uso confiável"
      />
      <DetailItem
        label="Catálogo visual"
        value={formatCompactNumber(safeBreakdown.visualCatalogTokens)}
        help="Leitura visual de documentos e catálogos"
      />
      <DetailItem
        label="Outros / não classificado"
        value={formatCompactNumber(safeBreakdown.unclassifiedTokens)}
        help="Uso sem marcação confiável de origem"
      />
    </div>
  );
}

function formatPercent(
  part: number | string | null | undefined,
  total: number | string | null | undefined,
) {
  const parsedPart = numberValue(part);
  const parsedTotal = numberValue(total);

  if (parsedTotal <= 0) {
    return "0%";
  }

  return `${Math.round((parsedPart / parsedTotal) * 100)}%`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Sem atividade";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime()) || parsed.getFullYear() <= 1971) {
    return "Sem atividade";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function getAiRunEventDate(event: AiRunEvent) {
  return formatDateTime(event.finishedAt || event.createdAt);
}

function getReadableAiError(error: string | null | undefined) {
  const value = String(error || "").trim();

  if (!value) {
    return "Erro sem detalhe registrado.";
  }

  return value;
}

function AiRunEventList({
  title,
  emptyText,
  events,
  variant,
}: {
  title: string;
  emptyText: string;
  events: AiRunEvent[] | undefined;
  variant: "error" | "success";
}) {
  const safeEvents = events ?? [];

  return (
    <section>
      <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>

      <div className="mt-3 space-y-2">
        {safeEvents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-zinc-500">
            {emptyText}
          </div>
        ) : (
          safeEvents.map((event) => (
            <div
              key={event.id}
              className={[
                "rounded-2xl border p-3 text-sm",
                variant === "error"
                  ? "border-red-500/25 bg-red-500/5"
                  : "border-emerald-500/20 bg-emerald-500/5",
              ].join(" ")}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-zinc-100">
                  {variant === "error" ? "Erro da IA" : "Execução com sucesso"}
                </div>
                <div className="text-xs text-zinc-500">
                  {getAiRunEventDate(event)}
                </div>
              </div>

              <div className="mt-2 grid gap-2 text-xs text-zinc-400 sm:grid-cols-2">
                <div>
                  <span className="text-zinc-500">Modelo:</span>{" "}
                  {event.model || "Sem modelo"}
                </div>
                <div>
                  <span className="text-zinc-500">Status:</span>{" "}
                  {event.status || "Sem status"}
                </div>
              </div>

              {variant === "error" ? (
                <div className="mt-2 rounded-xl border border-white/10 bg-zinc-950/40 p-2 text-xs leading-5 text-red-100">
                  {getReadableAiError(event.error)}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function normalizeStatus(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getStoreStatusLabel(status: string | null | undefined) {
  const normalized = normalizeStatus(status);

  if (normalized === "active") return "Ativa";
  if (normalized === "trial") return "Teste";
  if (normalized === "past_due") return "Pagamento em atraso";
  if (normalized === "canceled" || normalized === "cancelled")
    return "Cancelada";
  if (normalized === "inactive" || normalized === "disabled") return "Inativa";

  return status || "Sem status";
}

function isStoreActive(store: ZionAdminStore) {
  const normalized = normalizeStatus(store.subscriptionStatus);
  return normalized === "active" || normalized === "trial";
}

function isStoreCanceledOrInactive(store: ZionAdminStore) {
  return !isStoreActive(store);
}

function getInactiveReason(store: ZionAdminStore) {
  const normalized = normalizeStatus(store.subscriptionStatus);

  if (normalized === "past_due") {
    return "Possível atraso de pagamento conforme status atual. Confirmar quando o billing real estiver conectado.";
  }

  if (normalized === "canceled" || normalized === "cancelled") {
    return "Cancelada no status da assinatura. Motivo detalhado ainda sem base confiável.";
  }

  if (normalized === "inactive" || normalized === "disabled") {
    return "Inativa no sistema. Motivo detalhado ainda sem base confiável.";
  }

  return "Motivo detalhado ainda não registrado em base confiável.";
}

function getOperationalSummary(store: ZionAdminStore) {
  const aiErrors = numberValue(store.aiRunQueueErrors);
  const whatsappErrors = numberValue(store.whatsappErrors);
  const salesErrors = numberValue(store.salesActionErrors);
  const configurationIssues = numberValue(store.configurationIssues);
  const pendingAi = numberValue(store.pendingAiRuns);
  const pendingSales = numberValue(store.pendingSalesActions);
  const pendingWhatsapp = numberValue(store.pendingWhatsappEvents);
  const total =
    aiErrors +
    whatsappErrors +
    salesErrors +
    configurationIssues +
    pendingAi +
    pendingSales +
    pendingWhatsapp;

  if (total <= 0) {
    return {
      total,
      label: "Sem pendências críticas",
      details: "Nenhuma pendência crítica encontrada nas filas monitoradas.",
    };
  }

  const details = [
    aiErrors > 0 ? `${aiErrors} erro(s) na fila de IA` : null,
    whatsappErrors > 0
      ? `${whatsappErrors} erro(s) no WhatsApp de entrada`
      : null,
    salesErrors > 0 ? `${salesErrors} erro(s) em ações comerciais` : null,
    configurationIssues > 0
      ? `${configurationIssues} pendência(s) de configuração`
      : null,
    pendingAi > 0 ? `${pendingAi} IA pendente` : null,
    pendingSales > 0 ? `${pendingSales} ação comercial pendente` : null,
    pendingWhatsapp > 0 ? `${pendingWhatsapp} evento WhatsApp pendente` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    total,
    label: `${total} ocorrência(s)`,
    details,
  };
}

function getOperationalDetails(store: ZionAdminStore) {
  const items = [
    numberValue(store.aiRunQueueErrors) > 0
      ? `${numberValue(store.aiRunQueueErrors)} erro(s) na fila de IA`
      : null,
    numberValue(store.whatsappErrors) > 0
      ? `${numberValue(store.whatsappErrors)} erro(s) no WhatsApp de entrada`
      : null,
    numberValue(store.salesActionErrors) > 0
      ? `${numberValue(store.salesActionErrors)} erro(s) em ações comerciais`
      : null,
    numberValue(store.configurationIssues) > 0
      ? `${numberValue(store.configurationIssues)} pendência(s) de configuração`
      : null,
    numberValue(store.pendingAiRuns) > 0
      ? `${numberValue(store.pendingAiRuns)} IA pendente`
      : null,
    numberValue(store.pendingSalesActions) > 0
      ? `${numberValue(store.pendingSalesActions)} ação comercial pendente`
      : null,
    numberValue(store.pendingWhatsappEvents) > 0
      ? `${numberValue(store.pendingWhatsappEvents)} evento WhatsApp pendente`
      : null,
  ].filter(Boolean) as string[];

  return items;
}

function PendingIssueRootCauseList({ store }: { store: ZionAdminStore }) {
  const issueDetails = store.pendingIssueDetails ?? [];
  const operationalDetails = getOperationalDetails(store);

  if (issueDetails.length === 0) {
    return (
      <section>
        <h3 className="text-sm font-semibold text-zinc-200">
          Raiz das pendências
        </h3>

        <div className="mt-3 space-y-2">
          {operationalDetails.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-5 text-sm text-zinc-500">
              Nenhuma pendência crítica encontrada nas filas monitoradas.
            </div>
          ) : (
            operationalDetails.map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-50"
              >
                {item}
              </div>
            ))
          )}
        </div>
      </section>
    );
  }

  return (
    <section>
      <h3 className="text-sm font-semibold text-zinc-200">
        Raiz das pendências
      </h3>

      <div className="mt-3 space-y-3">
        {issueDetails.map((issue) => {
          const identifiers = [
            issue.queueKey ? `Queue key: ${issue.queueKey}` : null,
            issue.externalEventId ? `Evento externo: ${issue.externalEventId}` : null,
            issue.conversationId ? `Conversa: ${issue.conversationId}` : null,
            issue.leadId ? `Lead: ${issue.leadId}` : null,
            issue.aiRunId ? `AI run: ${issue.aiRunId}` : null,
            issue.nextAction ? `Ação: ${issue.nextAction}` : null,
            issue.actionKey ? `Action key: ${issue.actionKey}` : null,
            issue.provider ? `Provider: ${issue.provider}` : null,
          ].filter(Boolean) as string[];

          const preview = issue.inputPreview || issue.payloadPreview || null;

          return (
            <div
              key={`${issue.source}-${issue.id}`}
              className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-amber-50">
                    {issue.label || issue.source || "Pendência"}
                  </div>

                  <div className="mt-1 break-words text-xs leading-5 text-amber-100/80">
                    {issue.error || "Erro sem detalhe registrado."}
                  </div>
                </div>

                <div className="shrink-0 rounded-full border border-white/10 bg-zinc-950/40 px-3 py-1 text-xs text-zinc-400">
                  {formatDateTime(issue.occurredAt)}
                </div>
              </div>

              {identifiers.length > 0 ? (
                <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-zinc-400">
                  {identifiers.map((identifier) => (
                    <div
                      key={identifier}
                      className="break-words rounded-xl border border-white/10 bg-zinc-950/35 px-3 py-2"
                    >
                      {identifier}
                    </div>
                  ))}
                </div>
              ) : null}

              {preview ? (
                <div className="mt-3 rounded-xl border border-white/10 bg-zinc-950/50 p-3">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Preview técnico
                  </div>

                  <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-zinc-400">
                    {preview}
                  </pre>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function matchesSearch(store: ZionAdminStore, term: string) {
  const normalizedTerm = term.trim().toLowerCase();

  if (!normalizedTerm) return true;

  return [
    store.name,
    store.organizationName,
    store.id,
    store.organizationId,
    store.subscriptionStatus,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalizedTerm));
}

function OverviewButton({
  label,
  value,
  helper,
  onClick,
  active,
}: {
  label: string;
  value: string;
  helper: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "min-h-[112px] rounded-3xl border px-5 py-4 text-left transition",
        active
          ? "border-white/35 bg-white/[0.09]"
          : "border-white/10 bg-white/[0.04] hover:border-white/25 hover:bg-white/[0.07]",
      ].join(" ")}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">
        {value}
      </div>
      <div className="mt-1 text-sm leading-5 text-zinc-500">{helper}</div>
    </button>
  );
}

function StoreRowCard({
  store,
  selected,
  onClick,
  inactive,
}: {
  store: ZionAdminStore;
  selected: boolean;
  onClick: () => void;
  inactive?: boolean;
}) {
  const operational = getOperationalSummary(store);
  const aiRuns = numberValue(store.totalAiRuns);
  const successfulRuns = numberValue(store.successfulAiRuns);

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full rounded-2xl border p-3 text-left transition",
        selected
          ? "border-white/35 bg-white/[0.08]"
          : "border-white/10 bg-zinc-950/35 hover:border-white/25 hover:bg-white/[0.055]",
      ].join(" ")}
    >
      <div className="flex flex-col gap-3 xl:grid xl:grid-cols-[1.2fr_0.85fr_0.85fr_0.85fr_1.1fr] xl:items-stretch">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-zinc-50">
              {store.name}
            </h3>
            <span className="rounded-full border border-white/10 bg-zinc-950/60 px-2.5 py-1 text-[11px] text-zinc-400">
              {getStoreStatusLabel(store.subscriptionStatus)}
            </span>
          </div>
          <div className="mt-1 truncate text-sm text-zinc-400">
            {store.organizationName}
          </div>
          <div className="mt-1 truncate text-xs text-zinc-600">{store.id}</div>
          {inactive ? (
            <div className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">
              {getInactiveReason(store)}
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.035] p-2.5 text-xs">
          <div className="text-zinc-500">Uso</div>
          <div className="mt-1 font-semibold text-zinc-100">
            {formatNumber(store.totalMessages)} msg
          </div>
          <div className="mt-1 text-zinc-500">
            {formatNumber(store.totalSalesAiMessages)} msg IA · {formatNumber(store.totalLeads)} leads
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.035] p-2.5 text-xs">
          <div className="text-zinc-500">IA</div>
          <div className="mt-1 font-semibold text-zinc-100">
            {formatNumber(aiRuns)} exec.
          </div>
          <div className="mt-1 text-zinc-500">
            {formatPercent(successfulRuns, aiRuns)} sucesso
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.035] p-2.5 text-xs">
          <div className="text-zinc-500">Custo</div>
          <div className="mt-1 font-semibold text-zinc-100">
            {formatUsd(store.totalCostUsd)}
          </div>
          <div className="mt-1 text-zinc-500">
            {formatCompactNumber(store.totalTokens)} tokens
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.035] p-2.5 text-xs">
          <div className="text-zinc-500">Pendências</div>
          <div className="mt-1 font-semibold text-zinc-100">
            {operational.label}
          </div>
          <div className="mt-1 line-clamp-2 text-zinc-500">
            {operational.details}
          </div>
        </div>
      </div>
    </button>
  );
}

function DetailItem({
  label,
  value,
  help,
}: {
  label: string;
  value: string;
  help?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950/35 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </div>
      <div className="mt-1.5 break-words text-lg font-semibold text-zinc-50">
        {value}
      </div>
      {help ? (
        <div className="mt-1 text-xs leading-5 text-zinc-500">{help}</div>
      ) : null}
    </div>
  );
}

function DrawerShell({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/55 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Fechar detalhes"
        className="hidden flex-1 md:block"
        onClick={onClose}
      />

      <aside className="flex h-full w-full flex-col overflow-hidden border-l border-white/10 bg-zinc-950 text-zinc-50 shadow-2xl md:max-w-[620px]">
        <div className="shrink-0 border-b border-white/10 bg-zinc-950 px-5 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
                ZION Interno
              </div>
              <h2 className="mt-2 break-words text-2xl font-semibold leading-tight">
                {title}
              </h2>
              {subtitle ? (
                <p className="mt-2 break-words text-sm leading-5 text-zinc-400">
                  {subtitle}
                </p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/[0.08]"
            >
              Fechar
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {children}
        </div>
      </aside>
    </div>
  );
}

function StoreDetailsDrawer({
  store,
  onClose,
}: {
  store: ZionAdminStore | null;
  onClose: () => void;
}) {
  if (!store) return null;

  const operational = getOperationalSummary(store);
  const operationalDetails = getOperationalDetails(store);
  const aiRuns = numberValue(store.totalAiRuns);
  const successfulRuns = numberValue(store.successfulAiRuns);
  const failedRuns = numberValue(store.failedAiRuns);

  return (
    <DrawerShell
      title={store.name}
      subtitle={store.organizationName}
      onClose={onClose}
    >
      <div className="mb-5 mt-1 flex flex-wrap gap-2">
        <span className="rounded-full border border-white/10 bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
          {getStoreStatusLabel(store.subscriptionStatus)}
        </span>
        <span className="rounded-full border border-white/10 bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
          Última IA: {formatDateTime(store.lastAiRunAt)}
        </span>
      </div>

      <div className="space-y-5">
        <section>
          <h3 className="text-sm font-semibold text-zinc-200">Uso da loja</h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DetailItem label="Leads" value={formatNumber(store.totalLeads)} />
            <DetailItem
              label="Mensagens"
              value={formatNumber(store.totalMessages)}
              help="Mensagens comerciais totais da loja"
            />
            <DetailItem
              label="Mensagens IA vendedora"
              value={formatNumber(store.totalSalesAiMessages)}
              help="Mensagens comerciais enviadas pela IA"
            />
            <DetailItem
              label="Mensagens IA assistente"
              value={formatNumber(store.totalAssistantMessages)}
              help="Mensagens do chat operacional interno"
            />
            <DetailItem
              label="Compromissos"
              value={formatNumber(store.totalAppointments)}
              help="Total de compromissos cadastrados na agenda"
            />
            <DetailItem
              label="Marcados pela IA"
              value="Aguardando base"
              help="A agenda ainda não marca com segurança quais compromissos foram criados pela IA"
            />
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-zinc-200">
            Trabalho da IA
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DetailItem
              label="Execuções"
              value={formatNumber(aiRuns)}
              help={`${formatPercent(successfulRuns, aiRuns)} de sucesso`}
            />
            <DetailItem label="Sucesso" value={formatNumber(successfulRuns)} />
            <DetailItem label="Erros" value={formatNumber(failedRuns)} />
            <DetailItem
              label="Última IA"
              value={formatDateTime(store.lastAiRunAt)}
            />
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-zinc-200">
            Custo e tokens
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <DetailItem label="Hoje" value={formatUsd(store.costUsdToday)} />
              <DetailItem
                label="7 dias"
                value={formatUsd(store.costUsdLast7Days)}
              />
              <DetailItem label="Mês" value={formatUsd(store.costUsdMonth)} />
            </div>
            <DetailItem
              label="Custo total registrado"
              value={formatUsd(store.totalCostUsd)}
              help="Custo real em dólar salvo em ai_runs para execuções monitoradas."
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailItem
                label="Tokens totais"
                value={formatCompactNumber(store.totalTokens)}
              />
              <DetailItem
                label="Entrada / saída"
                value={`${formatCompactNumber(store.totalTokensPrompt)} / ${formatCompactNumber(store.totalTokensCompletion)}`}
              />
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-zinc-200">
            Custo por origem da IA
          </h3>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Separação por IA vendedora, assistente, catálogo visual, imagem e uso sem marcação confiável.
          </p>
          <div className="mt-3">
            <CostBreakdownGrid breakdown={store.costBreakdownTotal} />
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-zinc-200">
            Tokens por origem da IA
          </h3>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Ajuda a entender onde esta loja está consumindo tokens de IA.
          </p>
          <div className="mt-3">
            <TokenBreakdownGrid breakdown={store.tokenBreakdownTotal} />
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-zinc-200">
            Pendências da loja
          </h3>
          <div className="mt-3 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-2xl font-semibold">{operational.label}</div>
            <p className="mt-2 text-xs leading-5 text-zinc-400">
              {operational.details}
            </p>

            {operationalDetails.length > 0 ? (
              <div className="mt-4 space-y-2">
                {operationalDetails.map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-white/10 bg-zinc-950/40 p-3 text-sm text-zinc-300"
                  >
                    {item}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <DetailItem
                label="IA pendente"
                value={formatNumber(store.pendingAiRuns)}
              />
              <DetailItem
                label="Erro fila IA"
                value={formatNumber(store.aiRunQueueErrors)}
              />
              <DetailItem
                label="Ações pendentes"
                value={formatNumber(store.pendingSalesActions)}
              />
              <DetailItem
                label="Erro WhatsApp"
                value={formatNumber(store.whatsappErrors)}
              />
              <DetailItem
                label="Configuração"
                value={formatNumber(store.configurationIssues)}
              />
            </div>
          </div>
        </section>

        <PendingIssueRootCauseList store={store} />

        <section>
          <h3 className="text-sm font-semibold text-zinc-200">
            Histórico recente da IA
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <AiRunEventList
              title="Erros recentes"
              emptyText="Nenhum erro recente registrado para esta loja."
              events={store.recentAiErrors}
              variant="error"
            />
            <AiRunEventList
              title="Sucessos recentes"
              emptyText="Nenhuma execução recente registrada para esta loja."
              events={store.recentAiSuccesses}
              variant="success"
            />
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-zinc-200">Identificação</h3>
          <div className="mt-3 rounded-3xl border border-white/10 bg-white/[0.04] p-4 text-sm leading-6 text-zinc-400">
            <div>
              <span className="text-zinc-500">Store ID:</span> {store.id}
            </div>
            <div>
              <span className="text-zinc-500">Organization ID:</span>{" "}
              {store.organizationId}
            </div>
            <div>
              <span className="text-zinc-500">Criada em:</span>{" "}
              {formatDateTime(store.createdAt)}
            </div>
            {!isStoreActive(store) ? (
              <div className="mt-3 rounded-2xl border border-white/10 bg-zinc-950/40 p-3">
                <span className="text-zinc-500">Motivo:</span>{" "}
                {getInactiveReason(store)}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </DrawerShell>
  );
}

function OverviewDetailsDrawer({
  type,
  data,
  stores,
  onClose,
}: {
  type: OverviewPanelKey | null;
  data: ZionAdminOverview | null;
  stores: ZionAdminStore[];
  onClose: () => void;
}) {
  const [selectedAiStore, setSelectedAiStore] = useState<ZionAdminStore | null>(
    null,
  );
  const [selectedPendingStore, setSelectedPendingStore] =
    useState<ZionAdminStore | null>(null);
  const [pendingSearch, setPendingSearch] = useState("");

  if (!type) return null;

  const titleMap: Record<OverviewPanelKey, string> = {
    ia: "Trabalho da IA",
    cost: "Custo total da IA",
    tokens: "Tokens usados",
    pending: "Pendências gerais",
    conversations: "Conversas",
    messages: "Mensagens",
    leads: "Leads",
    appointments: "Compromissos",
    assistant: "Assistente operacional",
  };

  const subtitleMap: Record<OverviewPanelKey, string> = {
    ia: "Uso da IA vendedora e da IA assistente separado por loja.",
    cost: "Custo real registrado em dólar por loja.",
    tokens: "Tokens de entrada e saída por loja.",
    pending: "Lojas com pendências ou erros monitorados.",
    conversations:
      "Visão de conversas comerciais por loja quando houver base confiável.",
    messages: "Mensagens comerciais por loja.",
    leads: "Leads cadastrados por loja.",
    appointments: "Compromissos na agenda por loja.",
    assistant: "Uso da IA assistente operacional por loja.",
  };

  if (type === "ia" && selectedAiStore) {
    const aiRuns = numberValue(selectedAiStore.totalAiRuns);
    const successfulRuns = numberValue(selectedAiStore.successfulAiRuns);
    const failedRuns = numberValue(selectedAiStore.failedAiRuns);

    return (
      <DrawerShell
        title={`Trabalho da IA · ${selectedAiStore.name}`}
        subtitle={selectedAiStore.organizationName}
        onClose={onClose}
      >
        <button
          type="button"
          onClick={() => setSelectedAiStore(null)}
          className="mb-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/[0.08]"
        >
          ← Voltar para lojas
        </button>

        <div className="space-y-5">
          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              Resumo da IA nesta loja
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailItem
                label="Execuções"
                value={formatNumber(aiRuns)}
                help={`${formatPercent(successfulRuns, aiRuns)} de sucesso`}
              />
              <DetailItem label="Sucessos" value={formatNumber(successfulRuns)} />
              <DetailItem label="Erros" value={formatNumber(failedRuns)} />
              <DetailItem
                label="Última IA"
                value={formatDateTime(selectedAiStore.lastAiRunAt)}
              />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              IA vendedora
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailItem
                label="Mensagens IA vendedora"
                value={formatNumber(selectedAiStore.totalSalesAiMessages)}
                help="Mensagens comerciais enviadas pela IA para clientes"
              />
              <DetailItem
                label="Execuções comerciais"
                value={formatNumber(selectedAiStore.totalAiRuns)}
                help="Execuções registradas em ai_runs para esta loja"
              />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              IA assistente operacional
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailItem
                label="Conversas internas"
                value={formatNumber(selectedAiStore.totalAssistantThreads)}
                help="Threads da assistente operacional nesta loja"
              />
              <DetailItem
                label="Mensagens da assistente"
                value={formatNumber(selectedAiStore.totalAssistantMessages)}
                help="Mensagens trocadas no chat operacional"
              />
              <DetailItem
                label="Custo identificado"
                value={formatUsd(selectedAiStore.costBreakdownTotal?.assistantChatUsd)}
                help="Só aparece quando o fluxo da assistente registrar custo com marcação confiável"
              />
              <DetailItem
                label="Tokens identificados"
                value={formatCompactNumber(selectedAiStore.tokenBreakdownTotal?.assistantChatTokens)}
                help="Só aparece quando o fluxo da assistente registrar tokens com marcação confiável"
              />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              Custo e tokens da IA
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailItem
                label="Custo total"
                value={formatUsd(selectedAiStore.totalCostUsd)}
                help={`Hoje ${formatUsd(selectedAiStore.costUsdToday)} · semana ${formatUsd(selectedAiStore.costUsdLast7Days)} · mês ${formatUsd(selectedAiStore.costUsdMonth)}`}
              />
              <DetailItem
                label="Tokens"
                value={formatCompactNumber(selectedAiStore.totalTokens)}
                help={`${formatNumber(selectedAiStore.totalTokensPrompt)} entrada · ${formatNumber(selectedAiStore.totalTokensCompletion)} saída`}
              />
            </div>
          </section>
        </div>
      </DrawerShell>
    );
  }


  if (type === "cost" && selectedAiStore) {
    return (
      <DrawerShell
        title={`Custo da IA · ${selectedAiStore.name}`}
        subtitle={selectedAiStore.organizationName}
        onClose={onClose}
      >
        <button
          type="button"
          onClick={() => setSelectedAiStore(null)}
          className="mb-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/[0.08]"
        >
          ← Voltar para lojas
        </button>

        <div className="space-y-5">
          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              Custo por período nesta loja
            </h3>
            <div className="mt-3">
              <CostPeriodBlocks
                today={selectedAiStore.costUsdToday}
                week={selectedAiStore.costUsdLast7Days}
                month={selectedAiStore.costUsdMonth}
              />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              No que essa loja gastou
            </h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              A separação usa as marcações registradas em ai_runs. O que ainda não tiver marcação confiável aparece como não classificado.
            </p>
            <div className="mt-3">
              <CostBreakdownGrid breakdown={selectedAiStore.costBreakdownTotal} />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              Resumo de uso ligado ao custo
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailItem label="Custo total" value={formatUsd(selectedAiStore.totalCostUsd)} />
              <DetailItem label="Tokens" value={formatCompactNumber(selectedAiStore.totalTokens)} help={`${formatNumber(selectedAiStore.totalTokensPrompt)} entrada · ${formatNumber(selectedAiStore.totalTokensCompletion)} saída`} />
              <DetailItem label="Execuções" value={formatNumber(selectedAiStore.totalAiRuns)} />
              <DetailItem label="Erros" value={formatNumber(selectedAiStore.failedAiRuns)} />
            </div>
          </section>
        </div>
      </DrawerShell>
    );
  }


  if (type === "tokens" && selectedAiStore) {
    return (
      <DrawerShell
        title={`Tokens usados · ${selectedAiStore.name}`}
        subtitle={selectedAiStore.organizationName}
        onClose={onClose}
      >
        <button
          type="button"
          onClick={() => setSelectedAiStore(null)}
          className="mb-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/[0.08]"
        >
          ← Voltar para lojas
        </button>

        <div className="space-y-5">
          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              Tokens por período nesta loja
            </h3>
            <div className="mt-3">
              <TokenPeriodBlocks
                today={selectedAiStore.tokensToday}
                week={selectedAiStore.tokensLast7Days}
                month={selectedAiStore.tokensMonth}
                todayPrompt={selectedAiStore.tokensPromptToday}
                todayCompletion={selectedAiStore.tokensCompletionToday}
                weekPrompt={selectedAiStore.tokensPromptLast7Days}
                weekCompletion={selectedAiStore.tokensCompletionLast7Days}
                monthPrompt={selectedAiStore.tokensPromptMonth}
                monthCompletion={selectedAiStore.tokensCompletionMonth}
              />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              No que essa loja usou tokens
            </h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              A separação usa a mesma marcação confiável do custo em ai_runs. O que ainda não tiver origem clara aparece como não classificado.
            </p>
            <div className="mt-3">
              <TokenBreakdownGrid breakdown={selectedAiStore.tokenBreakdownTotal} />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              Entrada e saída
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailItem label="Total" value={formatCompactNumber(selectedAiStore.totalTokens)} />
              <DetailItem label="Entrada" value={formatNumber(selectedAiStore.totalTokensPrompt)} />
              <DetailItem label="Saída" value={formatNumber(selectedAiStore.totalTokensCompletion)} />
              <DetailItem label="Execuções" value={formatNumber(selectedAiStore.totalAiRuns)} />
            </div>
          </section>
        </div>
      </DrawerShell>
    );
  }

  if (type === "pending" && selectedPendingStore) {
    const operational = getOperationalSummary(selectedPendingStore);

    return (
      <DrawerShell
        title={`Pendências · ${selectedPendingStore.name}`}
        subtitle={selectedPendingStore.organizationName}
        onClose={onClose}
      >
        <button
          type="button"
          onClick={() => setSelectedPendingStore(null)}
          className="mb-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/[0.08]"
        >
          ← Voltar para lojas
        </button>

        <div className="space-y-5">
          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              Resumo das pendências
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailItem
                label="Total de pendências"
                value={formatNumber(operational.total)}
                help={operational.details}
              />
              <DetailItem
                label="Status da loja"
                value={getStoreStatusLabel(selectedPendingStore.subscriptionStatus)}
                help="Status atual registrado para esta loja"
              />
            </div>
          </section>

          <PendingIssueRootCauseList store={selectedPendingStore} />

          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              Contagem por área monitorada
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailItem
                label="IA pendente"
                value={formatNumber(selectedPendingStore.pendingAiRuns)}
              />
              <DetailItem
                label="Erro na fila de IA"
                value={formatNumber(selectedPendingStore.aiRunQueueErrors)}
              />
              <DetailItem
                label="Ações comerciais pendentes"
                value={formatNumber(selectedPendingStore.pendingSalesActions)}
              />
              <DetailItem
                label="Erro em ações comerciais"
                value={formatNumber(selectedPendingStore.salesActionErrors)}
              />
              <DetailItem
                label="Configuração da loja"
                value={formatNumber(selectedPendingStore.configurationIssues)}
              />
              <DetailItem
                label="Eventos WhatsApp pendentes"
                value={formatNumber(selectedPendingStore.pendingWhatsappEvents)}
              />
              <DetailItem
                label="Erros no WhatsApp"
                value={formatNumber(selectedPendingStore.whatsappErrors)}
              />
            </div>
          </section>
        </div>
      </DrawerShell>
    );
  }

  const sortedStores = [...stores].sort((a, b) => {
    if (type === "pending")
      return (
        numberValue(b.totalOperationalIssues) -
        numberValue(a.totalOperationalIssues)
      );
    if (type === "cost")
      return numberValue(b.totalCostUsd) - numberValue(a.totalCostUsd);
    if (type === "tokens")
      return numberValue(b.totalTokens) - numberValue(a.totalTokens);
    if (type === "ia")
      return (
        numberValue(b.totalAiRuns) +
        numberValue(b.totalAssistantMessages) -
        (numberValue(a.totalAiRuns) + numberValue(a.totalAssistantMessages))
      );
    if (type === "messages")
      return numberValue(b.totalMessages) - numberValue(a.totalMessages);
    if (type === "leads")
      return numberValue(b.totalLeads) - numberValue(a.totalLeads);
    if (type === "appointments")
      return (
        numberValue(b.totalAppointments) - numberValue(a.totalAppointments)
      );
    if (type === "assistant")
      return (
        numberValue(b.totalAssistantMessages) -
        numberValue(a.totalAssistantMessages)
      );
    return 0;
  });

  function renderStoreLine(store: ZionAdminStore) {
    const operational = getOperationalSummary(store);
    const operationalDetails = getOperationalDetails(store);

    let main = "";
    let help = "";

    if (type === "pending") {
      main = operational.label;
      help =
        operationalDetails.length > 0
          ? operationalDetails.join(" · ")
          : operational.details;
    } else if (type === "cost") {
      main = formatUsd(store.totalCostUsd);
      help = `Hoje ${formatUsd(store.costUsdToday)} · semana ${formatUsd(store.costUsdLast7Days)} · mês ${formatUsd(store.costUsdMonth)}`;
    } else if (type === "tokens") {
      main = formatCompactNumber(store.totalTokens);
      help = `${formatNumber(store.totalTokensPrompt)} entrada · ${formatNumber(store.totalTokensCompletion)} saída`;
    } else if (type === "ia") {
      main = `${formatNumber(store.totalAiRuns)} execuções`;
      help = `${formatPercent(store.successfulAiRuns, store.totalAiRuns)} sucesso · ${formatNumber(store.failedAiRuns)} erro(s) · ${formatNumber(store.totalAssistantMessages)} msg assistente`;
    } else if (type === "messages") {
      main = `${formatNumber(store.totalMessages)} mensagens`;
      help = `${formatNumber(store.totalLeads)} leads relacionados`;
    } else if (type === "leads") {
      main = `${formatNumber(store.totalLeads)} leads`;
      help = `${formatNumber(store.totalMessages)} mensagens comerciais`;
    } else if (type === "appointments") {
      main = `${formatNumber(store.totalAppointments)} compromissos`;
      help = "Visitas, instalações, medições e outros agendamentos.";
    } else if (type === "assistant") {
      main = `${formatNumber(store.totalAssistantMessages)} mensagens`;
      help = `${formatNumber(store.totalAssistantThreads)} conversa(s) internas`;
    } else {
      main = `${formatNumber(data?.totals.conversations)} conversas`;
      help =
        "Total global. Separação por loja depende de base confiável em conversations.";
    }

    const content = (
      <>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="truncate font-semibold text-zinc-100">
              {store.name}
            </div>
            <div className="mt-1 truncate text-xs text-zinc-500">
              {store.organizationName}
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-white/10 bg-zinc-950/50 px-2.5 py-1 text-[11px] text-zinc-400">
            {getStoreStatusLabel(store.subscriptionStatus)}
          </span>
        </div>
        <div className="mt-4 text-xl font-semibold text-zinc-50">{main}</div>
        <div className="mt-1 text-xs leading-5 text-zinc-500">{help}</div>
        {type === "ia" ? (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-zinc-950/35 px-3 py-2">
              <div className="text-[11px] text-zinc-500">IA vendedora</div>
              <div className="mt-1 text-sm font-semibold text-zinc-100">
                {formatNumber(store.totalAiRuns)} execuções
              </div>
              <div className="mt-0.5 text-xs text-zinc-500">
                {formatNumber(store.successfulAiRuns)} sucesso · {formatNumber(store.failedAiRuns)} erro(s)
              </div>
              <div className="mt-0.5 text-xs text-zinc-500">
                {formatNumber(store.totalSalesAiMessages)} mensagens comerciais
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-zinc-950/35 px-3 py-2">
              <div className="text-[11px] text-zinc-500">IA assistente</div>
              <div className="mt-1 text-sm font-semibold text-zinc-100">
                {formatNumber(store.totalAssistantMessages)} mensagens
              </div>
              <div className="mt-0.5 text-xs text-zinc-500">
                {formatNumber(store.totalAssistantThreads)} conversa(s) internas
              </div>
            </div>
          </div>
        ) : null}
      </>
    );

    if (type === "ia" || type === "cost" || type === "tokens") {
      return (
        <button
          key={store.id}
          type="button"
          onClick={() => setSelectedAiStore(store)}
          className="w-full rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-left transition hover:border-white/25 hover:bg-white/[0.06]"
        >
          {content}
          <div className="mt-3 text-xs font-semibold text-zinc-400">
            {type === "ia"
              ? "Ver IA vendedora e assistente →"
              : type === "cost"
                ? "Ver detalhes do custo →"
                : "Ver detalhes dos tokens →"}
          </div>
        </button>
      );
    }

    return (
      <div
        key={store.id}
        className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"
      >
        {content}
      </div>
    );
  }

  if (type === "pending") {
    const storesWithPending = sortedStores.filter(
      (store) => getOperationalSummary(store).total > 0,
    );
    const filteredPendingStores = storesWithPending.filter((store) =>
      matchesSearch(store, pendingSearch),
    );

    return (
      <DrawerShell
        title={titleMap[type]}
        subtitle={subtitleMap[type]}
        onClose={onClose}
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DetailItem
              label="Total de pendências"
              value={formatNumber(data?.totals.totalOperationalIssues)}
              help="Soma das pendências e erros nas filas monitoradas"
            />
            <DetailItem
              label="Lojas com pendência"
              value={formatNumber(storesWithPending.length)}
              help="Lojas com ao menos uma ocorrência crítica"
            />
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-950/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">⌕</span>
              <input
                value={pendingSearch}
                onChange={(event) => setPendingSearch(event.target.value)}
                placeholder="Procurar loja com pendência"
                className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
              />
            </div>
          </div>

          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              Lojas com pendências
            </h3>
            <div className="mt-3 space-y-3">
              {filteredPendingStores.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">
                  Nenhuma loja com pendência encontrada.
                </div>
              ) : (
                filteredPendingStores.map((store) => {
                  const operational = getOperationalSummary(store);
                  return (
                    <button
                      key={store.id}
                      type="button"
                      onClick={() => setSelectedPendingStore(store)}
                      className="w-full rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-left transition hover:border-white/25 hover:bg-white/[0.06]"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-zinc-100">
                            {store.name}
                          </div>
                          <div className="mt-1 truncate text-xs text-zinc-500">
                            {store.organizationName}
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full border border-white/10 bg-zinc-950/50 px-2.5 py-1 text-[11px] text-zinc-400">
                          {getStoreStatusLabel(store.subscriptionStatus)}
                        </span>
                      </div>
                      <div className="mt-4 text-xl font-semibold text-zinc-50">
                        {operational.label}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-zinc-500">
                        {operational.details}
                      </div>
                      <div className="mt-3 text-xs font-semibold text-zinc-400">
                        Ver onde estão as pendências →
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </DrawerShell>
    );
  }

  if (type === "conversations") {
    return (
      <DrawerShell
        title={titleMap[type]}
        subtitle={subtitleMap[type]}
        onClose={onClose}
      >
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Total global
          </div>
          <div className="mt-2 text-3xl font-semibold text-zinc-50">
            {formatNumber(data?.totals.conversations)} conversas
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Hoje esse número vem da tabela conversations como total geral. Para
            separar com segurança por loja, a API precisa ter uma ligação
            confiável por loja nessa tabela ou uma regra oficial usando
            lead/conversa.
          </p>
        </div>
      </DrawerShell>
    );
  }

  return (
    <DrawerShell
      title={titleMap[type]}
      subtitle={subtitleMap[type]}
      onClose={onClose}
    >
      {type === "cost" ? (
        <div className="mb-5 space-y-5">
          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              Total de todas as lojas
            </h3>
            <div className="mt-3">
              <CostPeriodBlocks
                today={data?.totals.costUsdToday}
                week={data?.totals.costUsdLast7Days}
                month={data?.totals.costUsdMonth}
              />
            </div>
          </section>
          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              No que o ZION está gastando IA
            </h3>
            <div className="mt-3">
              <CostBreakdownGrid breakdown={data?.totals.costBreakdownTotal} />
            </div>
          </section>
        </div>
      ) : null}

      {type === "tokens" ? (
        <div className="mb-5 space-y-5">
          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              Total de todas as lojas
            </h3>
            <div className="mt-3">
              <TokenPeriodBlocks
                today={data?.totals.tokensToday}
                week={data?.totals.tokensLast7Days}
                month={data?.totals.tokensMonth}
                todayPrompt={data?.totals.tokensPromptToday}
                todayCompletion={data?.totals.tokensCompletionToday}
                weekPrompt={data?.totals.tokensPromptLast7Days}
                weekCompletion={data?.totals.tokensCompletionLast7Days}
                monthPrompt={data?.totals.tokensPromptMonth}
                monthCompletion={data?.totals.tokensCompletionMonth}
              />
            </div>
          </section>
          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              No que o ZION está usando tokens
            </h3>
            <div className="mt-3">
              <TokenBreakdownGrid breakdown={data?.totals.tokenBreakdownTotal} />
            </div>
          </section>
        </div>
      ) : null}

      <div className="space-y-3">
        {sortedStores.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">
            Nenhuma loja encontrada.
          </div>
        ) : (
          sortedStores.map(renderStoreLine)
        )}
      </div>
    </DrawerShell>
  );
}

function OverviewInlineDetails({
  type,
  data,
  stores,
  onClose,
}: {
  type: OverviewPanelKey | null;
  data: ZionAdminOverview | null;
  stores: ZionAdminStore[];
  onClose: () => void;
}) {
  const [pendingSearch, setPendingSearch] = useState("");

  if (!type) return null;

  const totalAiRuns = numberValue(data?.totals.aiRuns);
  const successfulAiRuns = numberValue(data?.totals.successfulAiRuns);
  const failedAiRuns = numberValue(data?.totals.failedAiRuns);
  const storesWithPending = stores.filter(
    (store) => getOperationalSummary(store).total > 0,
  );
  const filteredPendingStores = storesWithPending.filter((store) =>
    matchesSearch(store, pendingSearch),
  );
  if (type === "pending") {
    return (
      <section className="mt-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-xl font-semibold text-zinc-50">Pendências</h3>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              Lojas com erros, filas travadas ou pontos que precisam de atenção.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-fit rounded-2xl border border-white/10 bg-zinc-950/50 px-4 py-2 text-sm font-semibold text-zinc-300 hover:bg-white/[0.06]"
          >
            Ocultar detalhes
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <DetailItem
            label="Total de pendências"
            value={formatNumber(data?.totals.totalOperationalIssues)}
            help="Soma das pendências e erros nas filas monitoradas"
          />
          <DetailItem
            label="Configuração"
            value={formatNumber(data?.totals.configurationIssues)}
            help="Onboarding, responsável, agenda, acesso, desconto ou catálogo"
          />
          <DetailItem
            label="Lojas com pendência"
            value={formatNumber(storesWithPending.length)}
            help="Lojas com ao menos uma ocorrência crítica"
          />
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-zinc-950/40 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-zinc-500">⌕</span>
            <input
              value={pendingSearch}
              onChange={(event) => setPendingSearch(event.target.value)}
              placeholder="Procurar loja com pendência"
              className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
            />
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {filteredPendingStores.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">
              Nenhuma loja com pendência encontrada.
            </div>
          ) : (
            filteredPendingStores.map((store) => {
              const operational = getOperationalSummary(store);
              return (
                <div
                  key={store.id}
                  className="rounded-2xl border border-white/10 bg-zinc-950/35 p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-zinc-100">
                        {store.name}
                      </div>
                      <div className="mt-1 truncate text-xs text-zinc-500">
                        {store.organizationName}
                      </div>
                    </div>

                    <span className="w-fit shrink-0 rounded-full border border-white/10 bg-zinc-950/50 px-2.5 py-1 text-[11px] text-zinc-400">
                      {getStoreStatusLabel(store.subscriptionStatus)}
                    </span>
                  </div>

                  <div className="mt-4 text-xl font-semibold text-zinc-50">
                    {operational.label}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-zinc-500">
                    {operational.details}
                  </div>

                  {store.pendingIssueDetails?.length ? (
                    <div className="mt-4 space-y-2">
                      {store.pendingIssueDetails.slice(0, 4).map((issue) => {
                        const isConfigurationIssue =
                          issue.source === "store_configuration";

                        return (
                          <div
                            key={`${issue.source}-${issue.id}`}
                            className={[
                              "rounded-2xl border p-3 text-xs leading-5",
                              isConfigurationIssue
                                ? "border-sky-500/20 bg-sky-500/5 text-sky-50"
                                : "border-amber-500/20 bg-amber-500/5 text-amber-50",
                            ].join(" ")}
                          >
                            <div className="font-semibold">
                              {issue.label || issue.source || "Pendência"}
                            </div>
                            <div
                              className={[
                                "mt-1",
                                isConfigurationIssue
                                  ? "text-sky-100/80"
                                  : "text-amber-100/80",
                              ].join(" ")}
                            >
                              {issue.error || "Erro sem detalhe registrado."}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>
    );
  }

  if (type === "ia") {
    return (
      <section className="mt-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-xl font-semibold text-zinc-50">
              Trabalho da IA
            </h3>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              Soma das execuções, mensagens, custo e tokens das lojas monitoradas.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-fit rounded-2xl border border-white/10 bg-zinc-950/50 px-4 py-2 text-sm font-semibold text-zinc-300 hover:bg-white/[0.06]"
          >
            Ocultar detalhes
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DetailItem
            label="Execuções"
            value={formatNumber(totalAiRuns)}
            help={`${formatPercent(successfulAiRuns, totalAiRuns)} de sucesso`}
          />
          <DetailItem
            label="Sucessos"
            value={formatNumber(successfulAiRuns)}
          />
          <DetailItem label="Erros" value={formatNumber(failedAiRuns)} />
          <DetailItem
            label="Última atividade"
            value={formatDateTime(
              stores
                .map((store) => store.lastAiRunAt)
                .filter(Boolean)
                .sort()
                .at(-1),
            )}
            help="Última execução de IA registrada"
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
          <section className="rounded-3xl border border-white/10 bg-zinc-950/30 p-4">
            <h4 className="text-sm font-semibold text-zinc-200">
              Mensagens por IA
            </h4>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailItem
                label="IA vendedora"
                value={formatNumber(data?.totals.salesAiMessages)}
                help="Mensagens comerciais enviadas pela IA para clientes"
              />
              <DetailItem
                label="IA assistente"
                value={formatNumber(data?.totals.assistantMessages)}
                help="Mensagens do chat operacional interno"
              />
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-zinc-950/30 p-4">
            <h4 className="text-sm font-semibold text-zinc-200">
              Custo da IA
            </h4>
            <div className="mt-3">
              <CostPeriodBlocks
                today={data?.totals.costUsdToday}
                week={data?.totals.costUsdLast7Days}
                month={data?.totals.costUsdMonth}
              />
            </div>
            <div className="mt-3">
              <CostBreakdownGrid breakdown={data?.totals.costBreakdownTotal} />
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-zinc-950/30 p-4">
            <h4 className="text-sm font-semibold text-zinc-200">
              Tokens usados
            </h4>
            <div className="mt-3">
              <TokenPeriodBlocks
                today={data?.totals.tokensToday}
                week={data?.totals.tokensLast7Days}
                month={data?.totals.tokensMonth}
                todayPrompt={data?.totals.tokensPromptToday}
                todayCompletion={data?.totals.tokensCompletionToday}
                weekPrompt={data?.totals.tokensPromptLast7Days}
                weekCompletion={data?.totals.tokensCompletionLast7Days}
                monthPrompt={data?.totals.tokensPromptMonth}
                monthCompletion={data?.totals.tokensCompletionMonth}
              />
            </div>
            <div className="mt-3">
              <TokenBreakdownGrid breakdown={data?.totals.tokenBreakdownTotal} />
            </div>
          </section>
        </div>

      </section>
    );
  }

  return null;
}


function StoreListSection({
  title,
  stores,
  search,
  onSearch,
  selectedStoreId,
  onSelectStore,
  inactive,
}: {
  title: string;
  stores: ZionAdminStore[];
  search: string;
  onSearch: (value: string) => void;
  selectedStoreId?: string;
  onSelectStore: (store: ZionAdminStore) => void;
  inactive?: boolean;
}) {
  const filteredStores = stores.filter((store) => matchesSearch(store, search));

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
        </div>
        <span className="w-fit rounded-full border border-white/10 bg-zinc-950/50 px-3 py-1 text-xs text-zinc-400">
          {formatNumber(stores.length)} loja(s)
        </span>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-zinc-950/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-zinc-500">⌕</span>
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Procurar loja por nome, organização ou status"
            className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
        </div>
      </div>

      <div className="mt-4 max-h-[350px] space-y-3 overflow-y-auto pr-1">
        {filteredStores.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">
            Nenhuma loja encontrada.
          </div>
        ) : (
          filteredStores.map((store) => (
            <StoreRowCard
              key={store.id}
              store={store}
              inactive={inactive}
              selected={selectedStoreId === store.id}
              onClick={() => onSelectStore(store)}
            />
          ))
        )}
      </div>
    </section>
  );
}

export default function ZionAdminDashboardClient({
  adminRole,
  initialData,
  initialError,
}: Props) {
  const [selectedStore, setSelectedStore] = useState<ZionAdminStore | null>(
    null,
  );
  const [selectedOverview, setSelectedOverview] =
    useState<OverviewPanelKey | null>(null);
  const [activeSearch, setActiveSearch] = useState("");
  const [inactiveSearch, setInactiveSearch] = useState("");

  const data = initialData;
  const stores = data?.stores ?? [];
  const activeStores = stores.filter(isStoreActive);
  const inactiveStores = stores.filter(isStoreCanceledOrInactive);

  const countErrors = data?.countErrors ?? {};
  const hasCountErrors = Object.values(countErrors).some(Boolean);

  const totalAiRuns = numberValue(data?.totals.aiRuns);
  const successfulAiRuns = numberValue(data?.totals.successfulAiRuns);
  const failedAiRuns = numberValue(data?.totals.failedAiRuns);

  return (
    <main className="min-h-screen overflow-x-hidden bg-zinc-950 px-4 py-6 text-zinc-50 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">
              ZION Interno
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              Dashboard interno do ZION
            </h1>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-300">
            Acesso:{" "}
            <span className="font-semibold text-zinc-50">{adminRole}</span>
          </div>
        </header>

        {initialError ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
            {initialError}
          </div>
        ) : null}

        {hasCountErrors ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
            Alguns indicadores não puderam ser carregados. A tela mostrou
            somente dados com origem confiável.
          </div>
        ) : null}

        <section>
          <div className="mb-3 flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                Visão geral de todas as lojas
              </h2>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <OverviewButton
              label="Trabalho da IA"
              value={formatNumber(totalAiRuns)}
              helper={`${formatPercent(successfulAiRuns, totalAiRuns)} sucesso · ${formatNumber(failedAiRuns)} erro(s) · ${formatNumber(data?.totals.salesAiMessages)} msg IA vendedora`}
              active={selectedOverview === "ia"}
              onClick={() =>
                setSelectedOverview((current) =>
                  current === "ia" ? null : "ia",
                )
              }
            />
            <OverviewButton
              label="Pendências"
              value={formatNumber(data?.totals.totalOperationalIssues)}
              helper={`${formatNumber(data?.totals.aiRunQueueErrors)} IA · ${formatNumber(data?.totals.whatsappErrors)} WhatsApp · ${formatNumber(data?.totals.configurationIssues)} configuração`}
              active={selectedOverview === "pending"}
              onClick={() =>
                setSelectedOverview((current) =>
                  current === "pending" ? null : "pending",
                )
              }
            />
          </div>

          <OverviewInlineDetails
            type={selectedOverview}
            data={data}
            stores={stores}
            onClose={() => setSelectedOverview(null)}
          />
        </section>

        <StoreListSection
          title="Lojas ativas"
          stores={activeStores}
          search={activeSearch}
          onSearch={setActiveSearch}
          selectedStoreId={selectedStore?.id}
          onSelectStore={setSelectedStore}
        />

        <StoreListSection
          title="Lojas canceladas ou inativas"
          stores={inactiveStores}
          search={inactiveSearch}
          onSearch={setInactiveSearch}
          selectedStoreId={selectedStore?.id}
          onSelectStore={setSelectedStore}
          inactive
        />
      </div>

      <StoreDetailsDrawer
        store={selectedStore}
        onClose={() => setSelectedStore(null)}
      />
    </main>
  );
}
