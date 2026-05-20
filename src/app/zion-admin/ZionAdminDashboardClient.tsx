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
    appointments: number | null;
    assistantThreads: number | null;
    assistantMessages: number | null;
    aiRuns?: number | null;
    successfulAiRuns?: number | null;
    failedAiRuns?: number | null;
    totalTokensPrompt?: number | null;
    totalTokensCompletion?: number | null;
    totalTokens?: number | null;
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

type AiUsageBreakdown = {
  salesChatUsd?: number | string | null;
  assistantChatUsd?: number | string | null;
  imageGenerationUsd?: number | string | null;
  visualCatalogUsd?: number | string | null;
  unclassifiedUsd?: number | string | null;
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
  totalAppointments?: number | null;
  totalAssistantThreads?: number | null;
  totalAssistantMessages?: number | null;
  totalAiRuns?: number | null;
  successfulAiRuns?: number | null;
  failedAiRuns?: number | null;
  totalTokensPrompt?: number | null;
  totalTokensCompletion?: number | null;
  totalTokens?: number | null;
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
  pendingWhatsappEvents?: number | null;
  whatsappErrors?: number | null;
  totalOperationalIssues?: number | null;
  recentAiErrors?: AiRunEvent[];
  recentAiSuccesses?: AiRunEvent[];
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
  const pendingAi = numberValue(store.pendingAiRuns);
  const pendingSales = numberValue(store.pendingSalesActions);
  const pendingWhatsapp = numberValue(store.pendingWhatsappEvents);
  const total =
    aiErrors +
    whatsappErrors +
    salesErrors +
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
}: {
  label: string;
  value: string;
  helper: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[64px] rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left transition hover:border-white/25 hover:bg-white/[0.07]"
    >
      <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-50">
        {value}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-zinc-500">{helper}</div>
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
            {formatNumber(store.totalLeads)} leads
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
            />
            <DetailItem
              label="Compromissos"
              value={formatNumber(store.totalAppointments)}
            />
            <DetailItem
              label="Mensagens assistente"
              value={formatNumber(store.totalAssistantMessages)}
            />
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-zinc-200">
            IA trabalhando
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
            </div>
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

  if (!type) return null;

  const titleMap: Record<OverviewPanelKey, string> = {
    ia: "IA trabalhando",
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
    ia: "Uso da IA separado por loja.",
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
        title={`IA trabalhando · ${selectedAiStore.name}`}
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

          <AiRunEventList
            title="Últimos erros da IA"
            emptyText="Nenhum erro recente registrado para esta loja."
            events={selectedAiStore.recentAiErrors}
            variant="error"
          />

          <AiRunEventList
            title="Últimas execuções com sucesso"
            emptyText="Nenhuma execução recente com sucesso registrada para esta loja."
            events={selectedAiStore.recentAiSuccesses}
            variant="success"
          />
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
      return numberValue(b.totalAiRuns) - numberValue(a.totalAiRuns);
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
      help = `${formatPercent(store.successfulAiRuns, store.totalAiRuns)} sucesso · ${formatNumber(store.failedAiRuns)} erro(s)`;
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
      </>
    );

    if (type === "ia" || type === "cost") {
      return (
        <button
          key={store.id}
          type="button"
          onClick={() => setSelectedAiStore(store)}
          className="w-full rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-left transition hover:border-white/25 hover:bg-white/[0.06]"
        >
          {content}
          <div className="mt-3 text-xs font-semibold text-zinc-400">
            {type === "ia" ? "Ver erros e sucessos →" : "Ver detalhes do custo →"}
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

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <OverviewButton
              label="IA trabalhando"
              value={formatNumber(totalAiRuns)}
              helper={`${formatPercent(successfulAiRuns, totalAiRuns)} sucesso · ${formatNumber(failedAiRuns)} erro(s)`}
              onClick={() => setSelectedOverview("ia")}
            />
            <OverviewButton
              label="Custo da IA"
              value={formatUsd(data?.totals.totalCostUsd)}
              helper={`Hoje ${formatUsd(data?.totals.costUsdToday)} · semana ${formatUsd(data?.totals.costUsdLast7Days)} · mês ${formatUsd(data?.totals.costUsdMonth)}`}
              onClick={() => setSelectedOverview("cost")}
            />
            <OverviewButton
              label="Tokens usados"
              value={formatCompactNumber(data?.totals.totalTokens)}
              helper={`${formatNumber(data?.totals.totalTokensPrompt)} entrada · ${formatNumber(data?.totals.totalTokensCompletion)} saída`}
              onClick={() => setSelectedOverview("tokens")}
            />
            <OverviewButton
              label="Pendências"
              value={formatNumber(data?.totals.totalOperationalIssues)}
              helper={`${formatNumber(data?.totals.aiRunQueueErrors)} IA · ${formatNumber(data?.totals.whatsappErrors)} WhatsApp`}
              onClick={() => setSelectedOverview("pending")}
            />
            <OverviewButton
              label="Conversas"
              value={formatNumber(data?.totals.conversations)}
              helper="Conversas comerciais"
              onClick={() => setSelectedOverview("conversations")}
            />
            <OverviewButton
              label="Mensagens"
              value={formatNumber(data?.totals.messages)}
              helper="Mensagens globais"
              onClick={() => setSelectedOverview("messages")}
            />
            <OverviewButton
              label="Leads"
              value={formatNumber(data?.totals.leads)}
              helper="Leads cadastrados"
              onClick={() => setSelectedOverview("leads")}
            />
            <OverviewButton
              label="Compromissos"
              value={formatNumber(data?.totals.appointments)}
              helper="Agenda das lojas"
              onClick={() => setSelectedOverview("appointments")}
            />
            <OverviewButton
              label="Assistente"
              value={formatNumber(data?.totals.assistantMessages)}
              helper={`${formatNumber(data?.totals.assistantThreads)} thread(s)`}
              onClick={() => setSelectedOverview("assistant")}
            />
          </div>
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
      <OverviewDetailsDrawer
        type={selectedOverview}
        data={data}
        stores={stores}
        onClose={() => setSelectedOverview(null)}
      />
    </main>
  );
}
