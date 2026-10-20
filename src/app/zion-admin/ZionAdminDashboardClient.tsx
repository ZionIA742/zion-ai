"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ensureFacebookSdkLoaded,
  classifyMetaEmbeddedSignupMessage,
  createMetaEmbeddedSignupFlowCoordinator,
  isMetaEmbeddedSignupFlowActive,
  extractMetaEmbeddedSignupSession,
  getMetaEmbeddedSignupConfig,
  isMetaEmbeddedSignupCancellation,
  type FacebookLoginResponse,
  type MetaEmbeddedSignupSession,
} from "@/lib/client/meta-embedded-signup";
import {
  getFirstAccessControlState,
  type StoreAccountAccess,
} from "./first-access-control";
import { supabase } from "@/lib/supabaseBrowser";
import {
  formatAvailableOverviewValue,
  getOverviewDiagnosticsAvailability,
  getOverviewAvailabilityLabel,
  getOverviewOperationalAvailability,
  getOverviewQueueAvailability,
  getPendingDetailsAvailabilityNotices,
  normalizeOverviewDataAvailability,
  type OverviewDataAvailability,
} from "./overview-availability";
import { selectRecentAiErrors } from "./recent-ai-errors";
import { classifyAiRunEvent, getAiRunGuidance, shouldShowAiRunCause } from "./ai-run-classification";
import {
  formatOperationalHealthIssueLabel,
  getOperationalHealthCommercialEvidenceText,
  getOperationalHealthEmptyGuidance,
  getOperationalHealthIssueGuidance,
} from "./operational-health-guidance";
// Sem pendências operacionais críticas remains represented by the shared operational summary helper.
import {
  compareOperationalStores,
  getOperationalDetails,
  getOperationalSummary,
} from "./operational-summary";

type OverviewPanelKey =
  | "ia"
  | "cost"
  | "tokens"
  | "pending"
  | "compare"
  | "conversations"
  | "messages"
  | "leads"
  | "appointments"
  | "assistant";

type StoreDetailTab =
  | "actions"
  | "health"
  | "settings"
  | "account"
  | "usage"
  | "pending"
  | "identification";

export type StoreIntegrityState = "healthy" | "warning" | "broken" | "unknown";
export type StoreIntegrityIssueCode =
  | "organization_missing" | "owner_missing" | "owner_ambiguous"
  | "owner_inactive" | "owner_profile_missing" | "subscription_missing"
  | "subscription_multiple";
export type StoreIntegrity = {
  state: StoreIntegrityState;
  issues: Array<{ code: StoreIntegrityIssueCode; severity: "warning" | "error"; scope: "store" | "organization" | "owner" | "subscription" }>;
  organization: { state: "present" | "missing" | "unknown" };
  owner: { state: "valid" | "missing" | "inactive" | "ambiguous" | "unknown"; count: number | null };
  subscription: { state: "single" | "missing" | "multiple" | "unknown"; status: string | null };
};

export type StoreAccountIdentityState = "valid" | "broken";
export type StoreAccountIdentityIssueCode =
  | "owner_missing"
  | "owner_ambiguous"
  | "auth_user_missing"
  | "owner_profile_missing";
export type StoreAccountIdentity = {
  state: StoreAccountIdentityState;
  issues: Array<{ code: StoreAccountIdentityIssueCode }>;
  owner: {
    state: "resolved" | "missing" | "ambiguous";
    membershipId: string | null;
    userId: string | null;
  };
  authUser: {
    state: "present" | "missing" | "unresolved";
    userId: string | null;
  };
  profile: {
    state: "present" | "missing" | "unresolved";
    userId: string | null;
  };
};

export type StoreOperationalHealthState =
  | "healthy"
  | "warning"
  | "broken"
  | "unknown";

export type StoreAiOperationalHealthState =
  | StoreOperationalHealthState
  | "idle";

export type StoreOperationalHealthIssue = {
  code: string;
  severity: "warning" | "error";
  scope: "whatsapp" | "ai" | "assistant" | "commercial" | "schedule" | "followup";
  count: number;
};

export type StoreCommercialOperationalHealth = {
  state: StoreOperationalHealthState;
  sourceAvailability: "available" | "partial" | "unavailable";
  processingErrors: number | null;
  pendingUnconfirmed: number | null;
  processedRecorded: number | null;
  invalid: number | null;
  noActionsObserved: boolean;
};

export type StoreOperationalHealth = {
  state: StoreOperationalHealthState;
  issues: StoreOperationalHealthIssue[];
  whatsapp: {
    state: StoreOperationalHealthState;
    liveConnectivity: "unverified";
  };
  ai: {
    state: StoreAiOperationalHealthState;
  };
  assistant: {
    state: StoreOperationalHealthState;
  };
  commercial?: StoreCommercialOperationalHealth | null;
  operations: {
    state: StoreOperationalHealthState;
  };
  observability: {
    workerHeartbeatAvailable: false;
  };
};
const STORE_INTEGRITY_STATE_LABELS: Record<StoreIntegrityState, string> = {
  healthy: "Saudável", warning: "Atenção", broken: "Problema", unknown: "Não verificada",
};
const STORE_INTEGRITY_ISSUE_LABELS: Record<StoreIntegrityIssueCode, string> = {
  organization_missing: "Organização não encontrada", owner_missing: "Loja sem proprietário",
  owner_ambiguous: "Mais de um proprietário encontrado", owner_inactive: "Proprietário inativo",
  owner_profile_missing: "Perfil do proprietário ausente", subscription_missing: "Assinatura não encontrada",
  subscription_multiple: "Mais de uma assinatura encontrada",
};
const STORE_ACCOUNT_IDENTITY_STATE_LABELS: Record<StoreAccountIdentityState, string> = {
  valid: "Válida",
  broken: "Problema",
};
const STORE_ACCOUNT_IDENTITY_ISSUE_LABELS: Record<StoreAccountIdentityIssueCode, string> = {
  owner_missing: "Conta proprietária não encontrada",
  owner_ambiguous: "Mais de uma conta proprietária encontrada",
  auth_user_missing: "Usuário de autenticação ausente",
  owner_profile_missing: "Perfil da conta proprietária ausente",
};
const STORE_ACCOUNT_IDENTITY_OWNER_STATE_LABELS: Record<StoreAccountIdentity["owner"]["state"], string> = {
  resolved: "Resolvido",
  missing: "Ausente",
  ambiguous: "Ambíguo",
};
const STORE_ACCOUNT_IDENTITY_COMPONENT_STATE_LABELS: Record<StoreAccountIdentity["authUser"]["state"], string> = {
  present: "Presente",
  missing: "Ausente",
  unresolved: "Não resolvido",
};
export function getStoreAccountIdentityStateLabel(
  identity: StoreAccountIdentity | null | undefined,
) {
  return identity
    ? STORE_ACCOUNT_IDENTITY_STATE_LABELS[identity.state]
    : "Não verificada";
}
export function getStoreAccountIdentityIssueLabels(
  identity: StoreAccountIdentity | null | undefined,
) {
  return (identity?.issues ?? []).map(
    (issue) => STORE_ACCOUNT_IDENTITY_ISSUE_LABELS[issue.code],
  );
}
export function getStoreAccountIdentityOwnerStateLabel(
  identity: StoreAccountIdentity | null | undefined,
) {
  return identity
    ? STORE_ACCOUNT_IDENTITY_OWNER_STATE_LABELS[identity.owner.state]
    : "Não verificada";
}
export function getStoreAccountIdentityComponentStateLabel(
  state: StoreAccountIdentity["authUser"]["state"] | undefined,
) {
  return state ? STORE_ACCOUNT_IDENTITY_COMPONENT_STATE_LABELS[state] : "Não verificada";
}
export function getStoreIntegrityStateLabel(integrity: StoreIntegrity | null | undefined) {
  return STORE_INTEGRITY_STATE_LABELS[integrity?.state ?? "unknown"];
}
export function getStoreIntegrityIssueLabels(integrity: StoreIntegrity | null | undefined) {
  return (integrity?.issues ?? []).map((issue) => STORE_INTEGRITY_ISSUE_LABELS[issue.code]);
}
export function getStoreIntegritySummary(
  stores: Array<{ integrity?: StoreIntegrity | null }>,
  orphanStores: Array<{ integrity?: StoreIntegrity | null }>,
) {
  const summary: Record<StoreIntegrityState, number> = { broken: 0, warning: 0, unknown: 0, healthy: 0 };
  for (const store of [...stores, ...orphanStores]) summary[store.integrity?.state ?? "unknown"] += 1;
  return summary;
}

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
  dataAvailability?: {
    ai?: {
      runs?: OverviewDataAvailability;
      queue?: OverviewDataAvailability;
      diagnostics?: OverviewDataAvailability;
      overall?: OverviewDataAvailability;
    };
    commercial?: {
      queue?: OverviewDataAvailability;
      diagnostics?: OverviewDataAvailability;
      overall?: OverviewDataAvailability;
    };
  };
  integrity?: {
    orphanStoresCount: number;
    orphanStores: Array<{
      id: string;
      name: string;
      organizationId: string;
      organizationName: string;
      createdAt: string | null;
      integrity?: StoreIntegrity | null;
    }>;
  };
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
  storeId?: string;
  storeName?: string;
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

export type StoreSettingsReadinessState =
  | "ready"
  | "attention"
  | "blocked"
  | "unknown";

export type StoreSettingsReadinessFamily =
  | "operation"
  | "payment"
  | "discount"
  | "channel"
  | "commercial_ai"
  | "strategy";

export type StoreSettingsReadinessFamilyIssue = {
  code: string;
  message: string;
};

export type StoreSettingsReadiness = {
  overall: StoreSettingsReadinessState;
  counts: Record<StoreSettingsReadinessState, number>;
  families: Array<{
    family: StoreSettingsReadinessFamily;
    state: StoreSettingsReadinessState;
    issues: StoreSettingsReadinessFamilyIssue[];
  }>;
  issues: Array<
    StoreSettingsReadinessFamilyIssue & {
      family: StoreSettingsReadinessFamily;
      state: Exclude<StoreSettingsReadinessState, "ready">;
    }
  >;
};
export type ZionAdminStore = {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  subscriptionStatus: string;
  createdAt: string | null;
  integrity?: StoreIntegrity | null;
  operationalHealth?: StoreOperationalHealth | null;
  dataAvailability?: ZionAdminOverview["dataAvailability"];
  settingsReadiness?: StoreSettingsReadiness | null;
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
  accountAccess?: StoreAccountAccess | null;
  accountIdentity?: StoreAccountIdentity | null;
};

type AccountAccessHistoryStatus = "available" | "unavailable";

type Props = {
  adminRole: string;
  canManageWhatsappPins: boolean;
  whatsappPinRecoveryMetaEnabled: boolean;
  initialData: ZionAdminOverview | null;
  initialError: string | null;
};

type ZionAdminWhatsappPin = {
  secret_id: string;
  organization_id: string;
  store_id: string;
  store_name: string;
  phone_number_id_masked: string;
  secret_status: "pending" | "active" | "invalidated" | string;
  created_at: string | null;
  activated_at: string | null;
  invalidated_at: string | null;
  can_reveal: boolean;
};

type AdminAccountProvisioning = {
  membershipRole: "owner";
};

const DEFAULT_ADMIN_ACCOUNT_PROVISIONING: AdminAccountProvisioning = {
  membershipRole: "owner",
};

function normalizeEmail(value: string) {
  return String(value || "").trim().toLowerCase();
}

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

function formatOverviewMetric(value: unknown, availability: unknown): string {
  return formatAvailableOverviewValue(value, availability, (current) =>
    formatNumber(current as number | string | null | undefined),
  );
}

function formatOverviewPercent(
  numerator: unknown,
  denominator: unknown,
  availability: unknown,
): string {
  return formatAvailableOverviewValue(denominator, availability, () =>
    formatPercent(
      numberValue(numerator as number | string | null | undefined),
      numberValue(denominator as number | string | null | undefined),
    ),
  );
}

function getStoreAiAvailability(
  store: ZionAdminStore,
  source: "runs" | "queue" | "diagnostics" | "overall",
) {
  if (source === "queue") {
    return getOverviewQueueAvailability(store.dataAvailability?.ai);
  }
  if (source === "diagnostics") {
    return getOverviewDiagnosticsAvailability(store.dataAvailability?.ai);
  }
  return normalizeOverviewDataAvailability(store.dataAvailability?.ai?.[source]);
}

function getStoreCommercialAvailability(
  store: ZionAdminStore,
  source: "queue" | "diagnostics" | "overall",
) {
  if (source === "queue") {
    return getOverviewQueueAvailability(store.dataAvailability?.commercial);
  }
  if (source === "diagnostics") {
    return getOverviewDiagnosticsAvailability(store.dataAvailability?.commercial);
  }
  return normalizeOverviewDataAvailability(store.dataAvailability?.commercial?.[source]);
}

function getGlobalAiAvailability(
  data: ZionAdminOverview | null,
  source: "runs" | "queue" | "diagnostics" | "overall",
) {
  if (source === "queue") {
    return getOverviewQueueAvailability(data?.dataAvailability?.ai);
  }
  if (source === "diagnostics") {
    return getOverviewDiagnosticsAvailability(data?.dataAvailability?.ai);
  }
  return normalizeOverviewDataAvailability(data?.dataAvailability?.ai?.[source]);
}

function getStorePendingAvailability(store: ZionAdminStore): OverviewDataAvailability {
  return getOverviewOperationalAvailability({
    ai: store.dataAvailability?.ai,
    commercial: store.dataAvailability?.commercial,
    hasUnverifiedOtherAreas: true,
    hasOtherAreaEvidence:
      numberValue(store.configurationIssues) > 0 ||
      numberValue(store.pendingWhatsappEvents) > 0 ||
      numberValue(store.whatsappErrors) > 0,
  });
}

function getGlobalPendingAvailability(
  data: ZionAdminOverview | null,
): OverviewDataAvailability {
  return getOverviewOperationalAvailability({
    ai: data?.dataAvailability?.ai,
    commercial: data?.dataAvailability?.commercial,
    hasUnverifiedOtherAreas: true,
    hasOtherAreaEvidence:
      numberValue(data?.totals.configurationIssues) > 0 ||
      numberValue(data?.totals.pendingWhatsappEvents) > 0 ||
      numberValue(data?.totals.whatsappErrors) > 0,
  });
}

function availabilityHelp(value: unknown) {
  return getOverviewAvailabilityLabel(value);
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
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
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
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
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
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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

function formatAccountAccessDateTime(
  value: string | null | undefined,
  historyStatus: AccountAccessHistoryStatus | null | undefined = "available",
) {
  if (historyStatus === "unavailable") {
    return "Histórico não disponível";
  }

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

function formatDateTime(value: string | null | undefined) {
  return formatAccountAccessDateTime(value);
}

function getAiRunEventDate(event: AiRunEvent) {
  return formatDateTime(event.createdAt || event.finishedAt);
}

function getReadableAiError(error: string | null | undefined) {
  const value = String(error || "").trim();

  if (!value) {
    return "Erro sem detalhe registrado.";
  }

  return value;
}

function getPendingIssueResolutionHelp(issue: PendingIssueDetail) {
  const label = String(issue.label || "").toLowerCase();
  const source = String(issue.source || "").toLowerCase();
  const error = String(issue.error || "").toLowerCase();

  if (source === "store_configuration") {
    if (label.includes("onboarding")) {
      return "Como resolver: abrir o Onboarding da loja e concluir as etapas obrigatórias. Sem isso, a loja pode ficar com configurações mínimas incompletas.";
    }

    if (label.includes("responsável") || label.includes("responsavel")) {
      return "Como resolver: cadastrar pelo menos um responsável da loja nas Configurações para receber alertas e acompanhar a operação.";
    }

    if (label.includes("agenda")) {
      return "Como resolver: configurar dias de atendimento, horários, regras de capacidade e janela operacional da agenda da loja.";
    }

    if (label.includes("desconto")) {
      return "Como resolver: preencher as regras de desconto/negociação da loja para a IA não operar sem limite comercial claro.";
    }

    if (label.includes("acesso") || label.includes("autenticação") || label.includes("autenticacao")) {
      return "Como resolver: revisar as configurações de acesso/autenticação da loja e deixar a configuração ativa.";
    }

    if (label.includes("catálogo") || label.includes("catalogo")) {
      return "Como resolver: cadastrar ou importar itens no catálogo da loja e manter pelo menos um item ativo.";
    }

    return "Como resolver: abrir as Configurações da loja e completar a configuração indicada nesta pendência.";
  }

  if (source.includes("whatsapp") || error.includes("conversation") || error.includes("payload")) {
    return "Como resolver: revisar o evento de entrada do WhatsApp, confirmar se o payload tem conversa/lead válido e reprocessar quando existir ação segura. Se for erro antigo de teste, deve entrar futuramente em arquivar/ignorar pendência.";
  }

  if (source.includes("ai_run") || error.includes("ai_run") || error.includes("output")) {
    return "Como resolver: verificar a execução/fila da IA, confirmar se houve resposta gerada e reprocessar somente se ainda for relevante. Se for teste antigo, futuramente deve poder ser arquivado sem apagar o histórico.";
  }

  if (source.includes("sales") || label.includes("ação") || label.includes("acao")) {
    return "Como resolver: revisar a ação comercial pendente, conferir se ainda precisa ser executada e reprocessar/cancelar com segurança conforme o contexto da conversa.";
  }

  return "Como resolver: revisar a origem da pendência, confirmar se ainda é atual e tratar manualmente até existir ação automática segura no Dashboard ADM.";
}

function AiRunEventList({
  title,
  emptyText,
  events,
  variant,
  availability,
}: {
  title: string;
  emptyText: string;
  events: AiRunEvent[] | undefined;
  variant: "error" | "success";
  availability?: unknown;
}) {
  const safeEvents = events ?? [];
  const availabilityState = normalizeOverviewDataAvailability(availability);

  return (
    <section>
      <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>

      {availabilityState === "partial" ? (
        <div className="mt-2 rounded-xl border border-amber-400/20 bg-amber-500/[0.06] p-3 text-xs text-amber-100">
          Consulta parcial; a lista pode não conter todas as ocorrências do recorte.
        </div>
      ) : null}

      <div className="mt-3 space-y-2">
        {availabilityState === "unavailable" ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-zinc-500">
            Fonte de execuções indisponível; não é possível confirmar a ausência de erros.
          </div>
        ) : safeEvents.length === 0 ? (
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
                  {variant === "error" ? "Erro da IA" : "Execução concluída"}
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
                {event.storeName ? (
                  <div>
                    <span className="text-zinc-500">Loja:</span>{" "}
                    {event.storeName}
                  </div>
                ) : null}
              </div>

              {(() => {
                const classification = classifyAiRunEvent(event);
                const guidance = getAiRunGuidance(classification, availabilityState);

                return (
                  <div className="mt-2 space-y-2 text-xs">
                    <div className="rounded-xl border border-white/10 bg-zinc-950/40 p-2 leading-5 text-zinc-200">
                      <span className="text-zinc-500">Situação observada:</span>{" "}
                      {classification.situationLabel}
                    </div>
                    {shouldShowAiRunCause(classification) ? (
                      <div className="rounded-xl border border-white/10 bg-zinc-950/40 p-2 leading-5 text-zinc-300">
                        <span className="text-zinc-500">Causa específica:</span>{" "}
                        {classification.causeLabel}
                      </div>
                    ) : null}
                    <div className="rounded-xl border border-sky-400/20 bg-sky-500/[0.06] p-2 leading-5 text-sky-100">
                      <span className="text-sky-200/70">Orientação:</span>{" "}
                      {guidance.statement}
                    </div>
                    {variant === "error" ? (
                      <div className="rounded-xl border border-white/10 bg-zinc-950/40 p-2 leading-5 text-red-100">
                        {getReadableAiError(event.error)}
                      </div>
                    ) : null}
                  </div>
                );
              })()}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function GlobalAlertsSection({
  stores,
  availability,
}: {
  stores: ZionAdminStore[];
  availability?: unknown;
}) {
  const storesWithOperationalIssues = stores.filter(
    (store) => getOperationalSummary(store).hasPotentialPending,
  );

  return (
    <section
      id="alerts"
      className="scroll-mt-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4"
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-200/70">
            Monitoramento
          </div>
          <h2 className="mt-1 text-lg font-semibold text-zinc-50">Alertas</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Ocorrências observadas nas fontes disponíveis, sem inferir causa ou entrega externa.
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-400">
          <span className="font-semibold text-zinc-200">{formatNumber(storesWithOperationalIssues.length)}</span>{" "}
          loja(s) com atenção no recorte
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <AiRunEventList
          title="Erros recentes da IA"
          emptyText="Nenhum erro recente disponível no recorte carregado."
          events={selectRecentAiErrors(stores)}
          variant="error"
          availability={availability}
        />
        <div className="rounded-2xl border border-white/10 bg-zinc-950/30 p-3">
          <h3 className="text-sm font-semibold text-zinc-200">Lojas com atenção</h3>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            A lista preserva o estado consolidado da API e não substitui os detalhes por loja.
          </p>
          <div className="mt-3 space-y-2">
            {storesWithOperationalIssues.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 p-3 text-xs text-zinc-500">
                Nenhuma loja sinalizada neste recorte.
              </div>
            ) : (
              storesWithOperationalIssues.slice(0, 6).map((store) => (
                <div
                  key={store.id}
                  className="rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2"
                >
                  <div className="truncate text-sm font-semibold text-zinc-100">{store.name}</div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {getOperationalSummary(store).label}
                  </div>
                </div>
              ))
            )}
          </div>
          {storesWithOperationalIssues.length > 6 ? (
            <div className="mt-2 text-[11px] text-zinc-500">
              Mais {storesWithOperationalIssues.length - 6} loja(s) na lista de lojas.
            </div>
          ) : null}
        </div>
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
  if (normalized === "suspended") return "Desativada";
  if (normalized === "canceled" || normalized === "cancelled")
    return "Cancelada";
  if (normalized === "inactive" || normalized === "disabled") return "Inativa";
  if (normalized === "unavailable") return "Status indisponivel";

  return status || "Sem status";
}

function shouldShowBlockedAccessBadge(store: ZionAdminStore) {
  return store.accountAccess?.accessState === "blocked";
}

function getStoreSubscriptionAction(store: ZionAdminStore) {
  const normalized = normalizeStatus(store.subscriptionStatus);

  if (normalized === "active") return "suspend" as const;
  if (normalized === "suspended") return "reactivate" as const;

  return null;
}

function isStoreActive(store: ZionAdminStore) {
  const normalized = normalizeStatus(store.subscriptionStatus);
  return normalized === "active" || normalized === "trial";
}

function isStoreCanceledOrInactive(store: ZionAdminStore) {
  return !isStoreActive(store);
}

const STORE_OPERATIONAL_HEALTH_STATE_LABELS: Record<
  StoreOperationalHealthState,
  string
> = {
  healthy: "Saudável",
  warning: "Atenção",
  broken: "Problema",
  unknown: "Não foi possível verificar",
};

const STORE_AI_OPERATIONAL_HEALTH_STATE_LABELS: Record<
  StoreAiOperationalHealthState,
  string
> = {
  ...STORE_OPERATIONAL_HEALTH_STATE_LABELS,
  idle: "Sem atividade de IA",
};

const STORE_OPERATIONAL_HEALTH_ISSUE_LABELS: Record<string, string> = {
  whatsapp_inbound_stale: "Entrada do WhatsApp aguardando processamento além do esperado",
  whatsapp_inbound_error: "Erro no processamento de entrada do WhatsApp",
  whatsapp_outbound_failed: "Falha no envio de mensagem pelo WhatsApp",
  whatsapp_outbound_uncertain: "Envio pelo WhatsApp com resultado incerto",
  whatsapp_outbound_stale: "Envio do WhatsApp aguardando ou processando além do esperado",
  ai_latest_run_failed: "Última execução da IA falhou",
  ai_run_queue_stale: "Execução da IA aguardando além do esperado",
  assistant_task_failed: "Tarefa da Assistente falhou",
  assistant_task_stale_processing: "Tarefa da Assistente acima do intervalo monitorado",
  assistant_task_stale_pending: "Tarefa da Assistente aguardando além do esperado",
  responsible_notification_failed: "Notificação ao responsável falhou",
  responsible_notification_uncertain: "Notificação ao responsável com resultado incerto",
  commercial_action_processing_error: "Erro registrado no processamento de a\u00e7\u00e3o comercial",
  commercial_action_invalid: "Evid\u00eancia inv\u00e1lida de a\u00e7\u00e3o comercial",
  commercial_action_source_partial: "Verifica\u00e7\u00e3o parcial das a\u00e7\u00f5es comerciais",
  commercial_action_source_unavailable: "Fonte de a\u00e7\u00f5es comerciais indispon\u00edvel",
  responsible_notification_stale_processing:
    "Notificação ao responsável acima do intervalo monitorado",
  appointment_overdue: "Compromisso permaneceu aberto após o horário previsto",
  post_appointment_followup_overdue:
    "Acompanhamento pós-compromisso está atrasado",
};

export function getStoreOperationalHealthStateLabel(
  health: StoreOperationalHealth | null | undefined,
) {
  return STORE_OPERATIONAL_HEALTH_STATE_LABELS[health?.state ?? "unknown"];
}

function getStoreAiOperationalHealthStateLabel(
  health: StoreOperationalHealth | null | undefined,
) {
  return STORE_AI_OPERATIONAL_HEALTH_STATE_LABELS[
    health?.ai?.state ?? "unknown"
  ];
}

export function getStoreOperationalHealthIssueLabels(
  health: StoreOperationalHealth | null | undefined,
) {
  return (health?.issues ?? []).map((issue) => {
    return formatOperationalHealthIssueLabel(issue, STORE_OPERATIONAL_HEALTH_ISSUE_LABELS);
  });
}

function getOperationalHealthStateClassName(
  state: StoreOperationalHealthState | StoreAiOperationalHealthState,
) {
  if (state === "broken") {
    return "border-red-500/30 bg-red-500/10 text-red-100";
  }

  if (state === "warning") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  }

  if (state === "healthy") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
  }

  if (state === "idle") {
    return "border-white/10 bg-zinc-900 text-zinc-300";
  }

  return "border-white/10 bg-zinc-900 text-zinc-400";
}
function getInactiveReason(store: ZionAdminStore) {
  const normalized = normalizeStatus(store.subscriptionStatus);

  if (normalized === "past_due") {
    return "Possível atraso de pagamento conforme status atual. Confirmar quando o billing real estiver conectado.";
  }

  if (normalized === "suspended") {
    return "Loja desativada no momento.";
  }

  if (normalized === "canceled" || normalized === "cancelled") {
    return "Loja cancelada ou inativa.";
  }

  if (normalized === "inactive" || normalized === "disabled") {
    return "Loja inativa no momento.";
  }

  return "Status da loja indisponível no momento.";

}

function PendingIssueRootCauseList({ store }: { store: ZionAdminStore }) {
  const issueDetails = store.pendingIssueDetails ?? [];
  const operationalDetails = getOperationalDetails(store);
  const detailNotices = getPendingDetailsAvailabilityNotices({
    ai: store.dataAvailability?.ai,
    commercial: store.dataAvailability?.commercial,
  });

  if (issueDetails.length === 0) {
    return (
      <section>
        <h3 className="text-sm font-semibold text-zinc-200">
          Detalhes das pendências
        </h3>

        <div className="mt-3 space-y-2">
          {detailNotices.map((notice) => (
            <div
              key={notice}
              className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-50"
            >
              {notice}
            </div>
          ))}
          {operationalDetails.length === 0 && detailNotices.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-5 text-sm text-zinc-500">
              Nenhum detalhe de IA ou comercial foi retornado no recorte consultado. Isso não comprova ausência de pendências nas respectivas filas. O contrato atual não informa disponibilidade individual explícita para WhatsApp e configurações.
            </div>
          ) : null}
          {operationalDetails.length > 0 ? (
            operationalDetails.map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-50"
              >
                {item}
              </div>
            ))
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section>
      <h3 className="text-sm font-semibold text-zinc-200">
        Detalhes das pendências
      </h3>

      <div className="mt-3 space-y-2.5">
        {detailNotices.map((notice) => (
          <div
            key={notice}
            className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-50"
          >
            {notice}
          </div>
        ))}
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
                  <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
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
        "min-h-[88px] rounded-2xl border px-4 py-3 text-left transition",
        active
          ? "border-white/35 bg-white/[0.09]"
          : "border-white/10 bg-white/[0.04] hover:border-white/25 hover:bg-white/[0.07]",
      ].join(" ")}
    >
      <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight text-zinc-50">
        {value}
      </div>
      <div className="mt-0.5 text-xs leading-4 text-zinc-500">{helper}</div>
    </button>
  );
}

type AdminIconName =
  | "overview" | "alerts" | "stores" | "comparisons" | "search" | "plus" | "arrow"
  | "check" | "warning" | "settings" | "brain" | "whatsapp" | "shield" | "key" | "user" | "info";

function AdminIcon({ name, className = "h-4 w-4" }: { name: AdminIconName; className?: string }) {
  const paths: Record<AdminIconName, React.ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    alerts: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    stores: <><path d="M3 10h18" /><path d="M5 10v10h14V10" /><path d="M3 10 5 4h14l2 6" /><path d="M9 20v-6h6v6" /></>,
    comparisons: <><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 15 3-4 3 2 4-6" /></>,
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    warning: <><path d="m12 4 9 16H3L12 4Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
    settings: <><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" /><path d="M4.9 4.9 7 7" /><path d="m17 17 2.1 2.1" /><path d="M4 12H1" /><path d="M23 12h-3" /><path d="m4.9 19.1 2.1-2.1" /><path d="M17 7l2.1-2.1" /></>,
    brain: <><path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5.2A3 3 0 0 0 7 18h2V4Z" /><path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5.2A3 3 0 0 1 17 18h-2V4Z" /><path d="M12 4v16" /></>,
    whatsapp: <><path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4.1A8 8 0 1 1 20 11.5Z" /><path d="M8.5 8.5c.3 2 1.5 3.5 3.5 4.5 1 .5 1.8.7 2.5.4" /></>,
    shield: <><path d="M12 3 19 6v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" /></>,
    key: <><circle cx="8" cy="15" r="3" /><path d="m10.5 12.5 8-8" /><path d="m16 6 2 2" /><path d="m14 8 2 2" /></>,
    user: <><circle cx="12" cy="8" r="3" /><path d="M5 21a7 7 0 0 1 14 0" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
  };

  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function DashboardMetricCard({ label, value, helper, tone = "violet", icon = "overview" }: { label: string; value: string; helper: string; tone?: "violet" | "green" | "red" | "amber" | "blue"; icon?: AdminIconName }) {
  const toneClass = {
    violet: "text-violet-200",
    green: "text-emerald-300",
    red: "text-red-300",
    amber: "text-amber-300",
    blue: "text-sky-300",
  }[tone];

  return (
    <div className="rounded-2xl border border-[#252b35] bg-[#10141b] p-3.5 shadow-[0_12px_32px_rgba(0,0,0,0.14)]">
      <div className="flex items-start gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] ${toneClass}`}>
          <AdminIcon name={icon} className="h-4 w-4" />
        </span>
        <div className="min-w-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8e98aa]">{label}</div>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-[#f4f6fb]">{value}</div>
      <div className="mt-1 text-xs leading-4 text-[#8e98aa]">{helper}</div>
    </div>
  );
}

const STORE_SETTINGS_READINESS_STATE_LABELS: Record<
  StoreSettingsReadinessState,
  string
> = {
  ready: "Pronta",
  attention: "Atenção",
  blocked: "Bloqueada",
  unknown: "Não verificada",
};

const STORE_SETTINGS_READINESS_FAMILY_LABELS: Record<
  StoreSettingsReadinessFamily,
  string
> = {
  operation: "Operação",
  payment: "Pagamento",
  discount: "Desconto",
  channel: "Canal",
  commercial_ai: "IA comercial",
  strategy: "Estratégia",
};

const STORE_SETTINGS_READINESS_FAMILIES: StoreSettingsReadinessFamily[] = [
  "operation",
  "payment",
  "discount",
  "channel",
  "commercial_ai",
  "strategy",
];

function getSettingsReadinessStateClassName(
  state: StoreSettingsReadinessState,
) {
  if (state === "ready") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  }

  if (state === "attention") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  }

  if (state === "blocked") {
    return "border-red-500/30 bg-red-500/10 text-red-200";
  }

  return "border-white/10 bg-zinc-950/60 text-zinc-400";
}

function getSettingsReadinessFamilyState(
  readiness: StoreSettingsReadiness | null | undefined,
  family: StoreSettingsReadinessFamily,
): StoreSettingsReadinessState {
  return (
    readiness?.families.find((item) => item.family === family)?.state ??
    "unknown"
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
  const integrityState = store.integrity?.state ?? "unknown";
  const integrityIssues = getStoreIntegrityIssueLabels(store.integrity);
  const operationalHealthState = store.operationalHealth?.state ?? "unknown";
  const settingsReadinessState = store.settingsReadiness?.overall ?? "unknown";

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full rounded-2xl border p-3 text-left transition",
        selected
          ? "border-violet-400/40 bg-violet-500/[0.08]"
          : "border-[#252b35] bg-[#10141b] hover:border-violet-400/30 hover:bg-white/[0.04]",
      ].join(" ")}
    >
      <div className="flex flex-col gap-2 xl:grid xl:grid-cols-[1.2fr_0.85fr_0.85fr_0.85fr_1.1fr] xl:items-stretch">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-zinc-50">
              {store.name}
            </h3>
            <span className="rounded-full border border-white/10 bg-zinc-950/60 px-2 py-0.5 text-[10px] text-zinc-400">
              {getStoreStatusLabel(store.subscriptionStatus)}
            </span>
            {shouldShowBlockedAccessBadge(store) ? (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-200">
                Acesso bloqueado
              </span>
            ) : null}
            <span className="rounded-full border border-white/10 bg-zinc-950/60 px-2 py-0.5 text-[10px] text-zinc-400">
              Integridade: {getStoreIntegrityStateLabel(store.integrity)}
            </span>
            <span
              className={[
                "rounded-full border px-2 py-0.5 text-[10px]",
                getOperationalHealthStateClassName(operationalHealthState),
              ].join(" ")}
            >
              Saúde: {getStoreOperationalHealthStateLabel(store.operationalHealth)}
            </span>
            <span
              className={[
                "rounded-full border px-2 py-0.5 text-[10px]",
                getSettingsReadinessStateClassName(settingsReadinessState),
              ].join(" ")}
            >
              Configuração: {STORE_SETTINGS_READINESS_STATE_LABELS[settingsReadinessState]}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-zinc-400">
            {store.organizationName}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-zinc-600">{store.id}</div>
          {inactive ? (
            <div className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">
              {getInactiveReason(store)}
            </div>
          ) : null}
          {integrityState !== "healthy" ? (
            <div className="mt-1 truncate text-[11px] text-amber-200/80">
              {integrityIssues[0] || "Verificação estrutural incompleta"}
              {integrityIssues.length > 1 ? ` (+${integrityIssues.length - 1})` : ""}
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-2 text-[11px]">
          <div className="text-zinc-500">Uso</div>
          <div className="mt-1 font-semibold text-zinc-100">
            {formatNumber(store.totalMessages)} msg
          </div>
          <div className="mt-1 text-zinc-500">
            {formatNumber(store.totalSalesAiMessages)} msg IA · {formatNumber(store.totalLeads)} leads
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-2 text-[11px]">
          <div className="text-zinc-500">IA</div>
          <div className="mt-1 font-semibold text-zinc-100">
            {formatOverviewMetric(aiRuns, getStoreAiAvailability(store, "runs"))} exec.
          </div>
          <div className="mt-1 text-zinc-500">
            {formatOverviewPercent(successfulRuns, aiRuns, getStoreAiAvailability(store, "runs"))} concluídas
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-2 text-[11px]">
          <div className="text-zinc-500">Custo</div>
          <div className="mt-1 font-semibold text-zinc-100">
            {formatUsd(store.totalCostUsd)}
          </div>
          <div className="mt-1 text-zinc-500">
            {formatCompactNumber(store.totalTokens)} tokens
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-2 text-[11px]">
          <div className="text-zinc-500">Pendências</div>
          <div className="mt-1 font-semibold text-zinc-100">
            {operational.label}
          </div>
          <div className="mt-1 line-clamp-2 text-zinc-500">
            {operational.details}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1 text-xs font-semibold text-violet-200">
        Abrir loja
        <AdminIcon name="arrow" className="h-3.5 w-3.5" />
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
    <div className="rounded-xl border border-white/10 bg-zinc-950/35 p-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
        {label}
      </div>
      <div className="mt-1 break-words text-base font-semibold text-zinc-50">
        {value}
      </div>
      {help ? (
        <div className="mt-0.5 text-[11px] leading-4 text-zinc-500">{help}</div>
      ) : null}
    </div>
  );
}

function ClickableDetailItem({
  label,
  value,
  help,
  onClick,
}: {
  label: string;
  value: string;
  help?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-white/10 bg-zinc-950/35 p-2.5 text-left transition hover:border-white/25 hover:bg-white/[0.06]"
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
        {label}
      </div>
      <div className="mt-1 break-words text-base font-semibold text-zinc-50">
        {value}
      </div>
      {help ? (
        <div className="mt-0.5 text-[11px] leading-4 text-zinc-500">{help}</div>
      ) : null}
      <div className="mt-2 text-[11px] font-semibold text-zinc-400">
        Ver detalhes →
      </div>
    </button>
  );
}

function DetailModal({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="max-h-[82vh] w-full max-w-2xl overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-50 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-4">
          <div className="min-w-0">
            <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Detalhes
            </div>
            <h3 className="mt-1 text-lg font-semibold leading-tight">{title}</h3>
            {description ? (
              <p className="mt-1 text-[11px] leading-4 text-zinc-500">{description}</p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-white/[0.08]"
          >
            Fechar
          </button>
        </div>

        <div className="max-h-[66vh] overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

function getAccountAccessStatusHelp(access: StoreAccountAccess | null | undefined) {
  if (!access) return "Conta de loja indisponivel.";
  if (access.status === "first_access_pending") {
    return "Aguardando definicao da primeira senha.";
  }
  if (access.status === "first_access_completed") {
    return "Acesso configurado.";
  }
  if (access.status === "provisioning_pending") {
    return "Provisionamento estrutural ainda pendente.";
  }
  if (access.status === "provisioning_failed") {
    return "Provisionamento exige revisao interna.";
  }
  if (access.status === "invalid_account") {
    return "Marcadores administrativos invalidos.";
  }
  if (access.status === "ambiguous") {
    return "Existe mais de uma conta owner candidata para esta loja.";
  }
  return "Conta de loja nao encontrada.";
}

function AdminCreateAccountModal({
  onClose,
  onSubmit,
  busy,
  error,
  success,
}: {
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  busy: boolean;
  error: string | null;
  success:
    | {
        email: string;
        membershipRole: string;
      }
    | null;
}) {
  const [email, setEmail] = useState("");
  const [storeName, setStoreName] = useState("");
  const [responsibleName, setResponsibleName] = useState("");

  return (
    <DetailModal
      title="Criar nova conta"
      description="Envia o convite inicial da conta da loja e conclui o provisionamento estrutural do primeiro acesso."
      onClose={onClose}
    >
      {success ? (
        <div className="mb-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
          Convite enviado para <span className="font-semibold">{success.email}</span>. A conta nasceu com papel{" "}
          <span className="font-semibold">{success.membershipRole}</span> e seguirá para o onboarding no primeiro acesso.
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          const form = event.currentTarget;
          form.dataset.email = email;
          form.dataset.storeName = storeName;
          form.dataset.responsibleName = responsibleName;
          void onSubmit(event);
        }}
        className="space-y-4"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
              E-mail
            </label>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="email"
              placeholder="cliente@loja.com"
              className="mt-1 w-full rounded-2xl border border-white/10 bg-zinc-950/50 px-4 py-3 text-sm text-zinc-50 outline-none transition focus:border-white/30"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
              Nome da Loja
            </label>
            <input
              value={storeName}
              onChange={(event) => setStoreName(event.target.value)}
              placeholder="Loja do cliente"
              className="mt-1 w-full rounded-2xl border border-white/10 bg-zinc-950/50 px-4 py-3 text-sm text-zinc-50 outline-none transition focus:border-white/30"
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
              Nome do Responsável
            </label>
            <input
              value={responsibleName}
              onChange={(event) => setResponsibleName(event.target.value)}
              placeholder="Pessoa principal"
              className="mt-1 w-full rounded-2xl border border-white/10 bg-zinc-950/50 px-4 py-3 text-sm text-zinc-50 outline-none transition focus:border-white/30"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-zinc-950/40 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Como funciona
          </div>
          <div className="mt-2 text-sm text-zinc-200">
            O cliente receberá um convite por e-mail e criará a própria senha.
          </div>
          <div className="mt-1 text-xs leading-5 text-zinc-500">
            O primeiro acesso vai direto para o onboarding da loja. O CRM só será liberado depois que o vínculo inicial estiver válido e o onboarding for concluído.
          </div>
          <div className="mt-2 text-xs leading-5 text-zinc-500">
            Durante o piloto, a conta nasce com papel {DEFAULT_ADMIN_ACCOUNT_PROVISIONING.membershipRole} e acesso integral centralizado no backend, sem senha definida pelo administrador.
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-white/10"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Criando conta..." : "Criar conta"}
          </button>
        </div>
      </form>
    </DetailModal>
  );
}


function DrawerShell({
  title,
  subtitle,
  children,
  onClose,
  headerActions,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  headerActions?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/55 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Fechar detalhes"
        className="hidden flex-1 md:block"
        onClick={onClose}
      />

      <aside className="flex h-full w-full flex-col overflow-hidden border-l border-white/10 bg-zinc-950 text-zinc-50 shadow-2xl md:max-w-[88vw] xl:max-w-[1120px]">
        <div className="shrink-0 border-b border-white/10 bg-zinc-950 px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
                ZION Interno
              </div>
              <h2 className="mt-2 break-words text-xl font-semibold leading-tight">
                {title}
              </h2>
              {subtitle ? (
                <p className="mt-2 break-words text-sm leading-5 text-zinc-400">
                  {subtitle}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              <div className="flex flex-wrap items-start justify-end gap-2">
                {headerActions}
                <button
                  type="button"
                  onClick={onClose}
                  className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/[0.08]"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {children}
        </div>
      </aside>
    </div>
  );
}

function StoreDetailsDrawer({
  store,
  canManageAccounts,
  canManageWhatsappPins,
  whatsappPinRecoveryMetaEnabled,
  onClose,
  onResendFirstAccess,
  onToggleAccountAccess,
  onToggleStoreSubscription,
  accessState,
  resendState,
  storeState,
}: {
  store: ZionAdminStore | null;
  canManageAccounts: boolean;
  canManageWhatsappPins: boolean;
  whatsappPinRecoveryMetaEnabled: boolean;
  onClose: () => void;
  onResendFirstAccess: (store: ZionAdminStore) => Promise<void>;
  onToggleAccountAccess: (store: ZionAdminStore) => Promise<void>;
  onToggleStoreSubscription: (store: ZionAdminStore) => Promise<void>;
  accessState: {
    busyMembershipId: string | null;
    error: string | null;
    success: string | null;
  };
  resendState: {
    busyStoreId: string | null;
    error: string | null;
    success: string | null;
  };
  storeState: {
    busyStoreId: string | null;
    error: string | null;
    success: string | null;
  };
}) {
  const [activeStoreTab, setActiveStoreTab] = useState<StoreDetailTab>("actions");

  if (!store) return null;

  const operational = getOperationalSummary(store);
  const operationalDetails = getOperationalDetails(store);
  const aiRuns = numberValue(store.totalAiRuns);
  const successfulRuns = numberValue(store.successfulAiRuns);
  const failedRuns = numberValue(store.failedAiRuns);
  const accountAccess = store.accountAccess ?? null;
  const accountIdentity = store.accountIdentity ?? null;
  const accountIdentityIssueLabels = getStoreAccountIdentityIssueLabels(accountIdentity);
  const firstAccessControl = getFirstAccessControlState({
    accountAccess,
    canManageAccounts,
    isBusy: resendState.busyStoreId === store.id,
  });
  const accessAction =
    accountAccess?.accessState === "active"
      ? "block"
      : accountAccess?.accessState === "blocked"
        ? "reactivate"
        : null;
  const storeAction = getStoreSubscriptionAction(store);
  const accessActionLabel =
    accessAction === "block" ? "Bloquear acesso" : "Reativar acesso";
  const storeActionLabel =
    storeAction === "suspend" ? "Desativar loja" : "Reativar loja";
  const accessDisabled =
    !canManageAccounts ||
    !accountAccess?.membershipId ||
    !accessAction ||
    accessState.busyMembershipId === accountAccess.membershipId;
  const storeActionDisabled =
    !canManageAccounts || !storeAction || storeState.busyStoreId === store.id;
  const integrityState = store.integrity?.state ?? "unknown";
  const integrityIssueLabels = getStoreIntegrityIssueLabels(store.integrity);
  const operationalHealth = store.operationalHealth ?? null;
  const operationalHealthState = operationalHealth?.state ?? "unknown";
  const operationalHealthIssueLabels =
    getStoreOperationalHealthIssueLabels(operationalHealth);
  const commercialEvidenceText =
    getOperationalHealthCommercialEvidenceText(operationalHealth?.commercial);
  const settingsReadiness = store.settingsReadiness ?? null;
  const settingsReadinessState =
    settingsReadiness?.overall ?? "unknown";
  const settingsReadinessIssues = settingsReadiness?.issues ?? [];

  return (
    <section className="min-w-0 rounded-2xl border border-[#252b35] bg-[#0e1218] shadow-[0_16px_48px_rgba(0,0,0,0.18)]">
      <div className="border-b border-[#252b35] bg-[#10141b] px-4 py-5 sm:px-6">
        <div className="mb-3 flex items-center gap-2 text-xs text-[#8e98aa]">
          <button type="button" onClick={onClose} className="transition hover:text-violet-200">
            Lojas
          </button>
          <span aria-hidden="true">/</span>
          <span className="truncate text-[#f4f6fb]">{store.name}</span>
        </div>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-200/70">Central da loja</div>
            <h2 className="mt-2 break-words text-2xl font-semibold leading-tight text-[#f4f6fb]">{store.name}</h2>
            <p className="mt-1 break-words text-sm leading-5 text-[#8e98aa]">{store.organizationName}</p>
          </div>
          <div className="flex max-w-[260px] flex-col items-end gap-1">
          <button
            type="button"
            disabled={firstAccessControl.disabled}
            aria-label={firstAccessControl.label}
            title={firstAccessControl.reason || undefined}
            onClick={() => {
              if (
                firstAccessControl.confirmMessage &&
                window.confirm(firstAccessControl.confirmMessage)
              ) {
                void onResendFirstAccess(store);
              }
            }}
            className="rounded-xl bg-violet-400 px-4 py-2 text-sm font-semibold text-[#090c11] transition hover:bg-violet-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {resendState.busyStoreId === store.id
              ? "Enviando..."
              : firstAccessControl.label}
          </button>
          {firstAccessControl.reason ? (
            <div className="text-right text-[11px] leading-4 text-[#8e98aa]">
              {firstAccessControl.reason}
            </div>
          ) : null}
          </div>
        </div>
      </div>
      <div className="px-4 py-4 sm:px-6">
      <div className="mb-5 mt-1 flex flex-wrap gap-2">
        <span className="rounded-full border border-white/10 bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
          {getStoreStatusLabel(store.subscriptionStatus)}
        </span>
        <span className="rounded-full border border-white/10 bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
          Última IA: {formatDateTime(store.lastAiRunAt)}
        </span>
      </div>

      <nav
        aria-label="Seções da loja"
        className="mb-5 grid grid-cols-2 gap-1.5 rounded-2xl border border-white/10 bg-zinc-950/35 p-1.5 sm:grid-cols-4 lg:grid-cols-7"
      >
        {([
          ["actions", "Ações"],
          ["health", "Saúde operacional"],
          ["settings", "Configurações"],
          ["account", "Conta"],
          ["usage", "Uso e IA"],
          ["pending", "Pendências"],
          ["identification", "Identificação"],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            aria-current={activeStoreTab === tab ? "page" : undefined}
            onClick={() => setActiveStoreTab(tab)}
            className={[
              "rounded-xl px-2 py-2 text-xs font-semibold transition",
              activeStoreTab === tab
                ? "bg-violet-500/20 text-violet-100 ring-1 ring-violet-400/30"
                : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="space-y-4">
        {activeStoreTab === "health" ? <section>
          <h4 className="text-sm font-semibold text-zinc-200">Integridade estrutural</h4>
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
            <div className="text-sm font-semibold text-zinc-100">
              {getStoreIntegrityStateLabel(store.integrity)}
            </div>
            {integrityState === "healthy" ? (
              <p className="mt-1 text-xs leading-5 text-zinc-500">Nenhum problema estrutural detectado.</p>
            ) : integrityState === "unknown" ? (
              <p className="mt-1 text-xs leading-5 text-amber-200">Não foi possível verificar completamente a integridade desta loja.</p>
            ) : integrityIssueLabels.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs leading-5 text-zinc-400">
                {integrityIssueLabels.map((issue) => <li key={issue}>• {issue}</li>)}
              </ul>
            ) : null}
          </div>
        </section> : null}
        {activeStoreTab === "settings" ? <section>
          <h4 className="text-sm font-semibold text-zinc-200">
            Prontidão das configurações
          </h4>

          <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-zinc-100">
                {STORE_SETTINGS_READINESS_STATE_LABELS[settingsReadinessState]}
              </div>

              <span
                className={[
                  "rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                  getSettingsReadinessStateClassName(settingsReadinessState),
                ].join(" ")}
              >
                Estado geral
              </span>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {STORE_SETTINGS_READINESS_FAMILIES.map((family) => {
                const familyState = getSettingsReadinessFamilyState(
                  settingsReadiness,
                  family,
                );

                return (
                  <DetailItem
                    key={family}
                    label={STORE_SETTINGS_READINESS_FAMILY_LABELS[family]}
                    value={STORE_SETTINGS_READINESS_STATE_LABELS[familyState]}
                  />
                );
              })}
            </div>

            {settingsReadinessState === "ready" ? (
              <p className="mt-3 text-xs leading-5 text-zinc-500">
                As seis famílias de configuração estão prontas.
              </p>
            ) : settingsReadinessState === "unknown" &&
              settingsReadinessIssues.length === 0 ? (
              <p className="mt-3 text-xs leading-5 text-amber-200">
                Não foi possível verificar completamente as configurações desta loja.
              </p>
            ) : settingsReadinessIssues.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs leading-5 text-zinc-400">
                {settingsReadinessIssues.map((issue) => (
                  <li key={`${issue.family}:${issue.code}`}>
                    • {STORE_SETTINGS_READINESS_FAMILY_LABELS[issue.family]}:{" "}
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section> : null}
        {activeStoreTab === "health" ? <section>
          <h4 className="text-sm font-semibold text-zinc-200">
            Saúde operacional
          </h4>

          <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-zinc-100">
                {getStoreOperationalHealthStateLabel(operationalHealth)}
              </div>

              <span
                className={[
                  "rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                  getOperationalHealthStateClassName(operationalHealthState),
                ].join(" ")}
              >
                Estado geral
              </span>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <DetailItem
                label="WhatsApp"
                value={STORE_OPERATIONAL_HEALTH_STATE_LABELS[
                  operationalHealth?.whatsapp?.state ?? "unknown"
                ]}
              />
              <DetailItem
                label="IA"
                value={getStoreAiOperationalHealthStateLabel(operationalHealth)}
              />
              <DetailItem
                label="Assistente"
                value={STORE_OPERATIONAL_HEALTH_STATE_LABELS[
                  operationalHealth?.assistant?.state ?? "unknown"
                ]}
              />
              <DetailItem
                label="Operação"
                value={STORE_OPERATIONAL_HEALTH_STATE_LABELS[
                  operationalHealth?.operations?.state ?? "unknown"
                ]}
              />
              <DetailItem
                label="Ações comerciais"
                value={STORE_OPERATIONAL_HEALTH_STATE_LABELS[
                  operationalHealth?.commercial?.state ?? "unknown"
                ]}
              />
            </div>

            <p className="mt-3 text-xs leading-5 text-zinc-500">
              {commercialEvidenceText}
            </p>

            {operationalHealthIssueLabels.length > 0 ? (
              <>
                <ul className="mt-3 space-y-1 text-xs leading-5 text-zinc-400">
                  {(operationalHealth?.issues ?? []).map((issue, index) => (
                    <li key={`${issue.code}-${issue.scope}`}>
                      <div>
                        • {operationalHealthIssueLabels[index]}
                      </div>
                      {(issue.scope === "assistant" || issue.scope === "commercial") && (
                        <div className="pl-3 text-zinc-500">
                          {getOperationalHealthIssueGuidance(issue)}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                {operationalHealthState === "unknown" && (
                  <p className="mt-3 text-xs leading-5 text-amber-200">
                    Não foi possível verificar completamente a saúde operacional desta loja.
                  </p>
                )}
              </>
            ) : operationalHealthState === "healthy" ? (
              <p className="mt-3 text-xs leading-5 text-zinc-500">
                Nenhum problema operacional persistido foi detectado nas fontes monitoradas.
              </p>
            ) : operationalHealthState === "unknown" ? (
              <p className="mt-3 text-xs leading-5 text-amber-200">
                Não foi possível verificar completamente a saúde operacional desta loja.
              </p>
            ) : (
              <p className="mt-3 text-xs leading-5 text-zinc-500">
                {getOperationalHealthEmptyGuidance({
                  healthState: operationalHealthState,
                  assistantState: operationalHealth?.assistant?.state ?? "unknown",
                })}
              </p>
            )}

            <div className="mt-3 rounded-xl border border-white/10 bg-zinc-950/35 p-3 text-[11px] leading-5 text-zinc-500">
              <div>
                Conectividade ao vivo do WhatsApp:{" "}
                {operationalHealth?.whatsapp?.liveConnectivity === "unverified"
                  ? "não verificada"
                  : "não informada"}
              </div>
              <div>
                Heartbeat dos workers:{" "}
                {operationalHealth?.observability?.workerHeartbeatAvailable === false
                  ? "não disponível"
                  : "não informado"}
              </div>
              <div className="mt-1">
                Este painel identifica problemas pelos registros persistidos e não afirma que
                serviços externos ou workers estejam online em tempo real. Os limites de tempo
                são critérios de monitoramento e não comprovam que uma tarefa esteja travada.
              </div>
            </div>
          </div>
        </section> : null}
        {activeStoreTab === "actions" ? <section>
          <h3 className="text-sm font-semibold text-zinc-200">Gestão da loja</h3>
          <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-zinc-300">
              <div>
                <h4 className="text-sm font-semibold text-zinc-200">Operação da loja</h4>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  Gerencie o funcionamento desta loja no ZION.
                </p>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <DetailItem
                  label="Status"
                  value={getStoreStatusLabel(store.subscriptionStatus)}
                />
                <DetailItem
                  label="Última IA"
                  value={formatDateTime(store.lastAiRunAt)}
                />
              </div>

            {storeState.error ? (
              <div className="mt-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                {storeState.error}
              </div>
            ) : null}

            {storeState.success ? (
              <div className="mt-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                {storeState.success}
              </div>
            ) : null}

            {storeAction ? (
              <button
                type="button"
                disabled={storeActionDisabled}
                onClick={() => {
                  if (
                    window.confirm(
                      storeAction === "suspend"
                        ? `Desativar a loja ${store.name}? O WhatsApp sera desligado antes da suspension e nao volta automaticamente na reativacao.`
                        : `Reativar a loja ${store.name}? O WhatsApp continuara desligado ate reconfiguracao manual.`,
                    )
                  ) {
                    void onToggleStoreSubscription(store);
                  }
                }}
                className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {storeState.busyStoreId === store.id
                  ? storeAction === "suspend"
                    ? "Desativando loja..."
                    : "Reativando loja..."
                  : storeActionLabel}
              </button>
            ) : null}
            </div>

            <div>
              <WhatsappPinsSection
                key={store.id}
                canAccess={canManageWhatsappPins}
                metaExecutionEnabled={whatsappPinRecoveryMetaEnabled}
                organizationId={store.organizationId}
                storeId={store.id}
                compact
              />
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-zinc-300">
              <div>
                <h4 className="text-sm font-semibold text-zinc-200">Conta responsável</h4>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  Gerencie o acesso do responsável à loja.
                </p>
              </div>

              <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] p-3">
                <div className="text-sm font-semibold text-zinc-200">Identidade da conta</div>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  Valida o vínculo entre a conta proprietária, o usuário de autenticação e o perfil.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <DetailItem
                    label="Identidade"
                    value={getStoreAccountIdentityStateLabel(accountIdentity)}
                  />
                  <DetailItem
                    label="Conta proprietária"
                    value={getStoreAccountIdentityOwnerStateLabel(accountIdentity)}
                  />
                  <DetailItem
                    label="Usuário de autenticação"
                    value={getStoreAccountIdentityComponentStateLabel(accountIdentity?.authUser.state)}
                  />
                  <DetailItem
                    label="Perfil"
                    value={getStoreAccountIdentityComponentStateLabel(accountIdentity?.profile.state)}
                  />
                </div>
                {!accountIdentity ? (
                  <p className="mt-3 text-xs leading-5 text-amber-200">
                    Não foi possível verificar a identidade canônica desta conta.
                  </p>
                ) : accountIdentity.state === "broken" && accountIdentityIssueLabels.length > 0 ? (
                  <ul className="mt-3 space-y-1 text-xs leading-5 text-red-200">
                    {accountIdentityIssueLabels.map((label) => (
                      <li key={label}>• {label}</li>
                    ))}
                  </ul>
                ) : accountIdentity.state === "broken" && accountIdentityIssueLabels.length === 0 ? (
                  <p className="mt-3 text-xs leading-5 text-red-200">
                    A identidade canônica da conta apresenta um problema sem detalhes disponíveis.
                  </p>
                ) : accountIdentity.state === "valid" ? (
                  <p className="mt-3 text-xs leading-5 text-emerald-200">
                    Os vínculos canônicos da conta estão consistentes.
                  </p>
                ) : null}
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <DetailItem
                  label="Responsável"
                  value={accountAccess?.responsibleName || "Não informado"}
                />
                <DetailItem
                  label="E-mail"
                  value={accountAccess?.emailMasked || "E-mail indisponível"}
                />
                <DetailItem
                  label="Acesso"
                  value={
                    accountAccess?.accessState === "blocked"
                      ? "Acesso bloqueado"
                      : accountAccess?.accessState === "active"
                        ? "Acesso ativo"
                        : accountAccess?.accessStateLabel || "Acesso indisponível"
                  }
                />
                <DetailItem
                  label="Status"
                  value={accountAccess?.statusLabel || "Conta indisponível"}
                  help={getAccountAccessStatusHelp(accountAccess)}
                />
                <DetailItem
                  label="Último envio"
                  value={formatAccountAccessDateTime(
                    accountAccess?.lastInviteSentAt,
                    accountAccess?.lastInviteHistoryStatus,
                  )}
                />
                <DetailItem
                  label="Primeiro acesso"
                  value={formatAccountAccessDateTime(
                    accountAccess?.firstAccessCompletedAt,
                    accountAccess?.firstAccessHistoryStatus,
                  )}
                />
              </div>

            {resendState.error ? (
              <div className="mt-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                {resendState.error}
              </div>
            ) : null}

            {resendState.success ? (
              <div className="mt-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                {resendState.success}
              </div>
            ) : null}

            {accessState.error ? (
              <div className="mt-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                {accessState.error}
              </div>
            ) : null}

            {accessState.success ? (
              <div className="mt-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                {accessState.success}
              </div>
            ) : null}

            {accessAction ? (
              <button
                type="button"
                disabled={accessDisabled}
                onClick={() => {
                  if (
                    window.confirm(
                      `${accessAction === "block" ? "Bloquear" : "Reativar"} o acesso de ${accountAccess?.emailMasked || "esta conta"}?`,
                    )
                  ) {
                    void onToggleAccountAccess(store);
                  }
                }}
                className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {accessState.busyMembershipId === accountAccess?.membershipId
                  ? accessAction === "block"
                    ? "Bloqueando..."
                    : "Reativando..."
                  : accessActionLabel}
              </button>
            ) : null}

            </div>
            {!isWhatsappPinRecoveryTargetStore(store) ? <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-zinc-300">
              <div className="flex items-start gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-zinc-400/10 text-zinc-300"><AdminIcon name="whatsapp" className="h-4 w-4" /></span>
                <div>
                  <h4 className="text-sm font-semibold text-zinc-200">RegularizaÃ§Ã£o do WhatsApp</h4>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">RecuperaÃ§Ã£o nÃ£o disponÃ­vel para esta loja no contrato autorizado.</p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-zinc-500">O alvo de recuperaÃ§Ã£o nÃ£o estÃ¡ vinculado a esta loja; nenhuma operaÃ§Ã£o serÃ¡ iniciada.</p>
            </div> : null}
            {isWhatsappPinRecoveryTargetStore(store) ? <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-zinc-300">
              <div className="flex items-start gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300"><AdminIcon name="whatsapp" className="h-4 w-4" /></span>
                <div>
                  <h4 className="text-sm font-semibold text-zinc-200">Regularização do WhatsApp</h4>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">Recuperação controlada para o telefone autorizado da loja.</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2">
                <DetailItem label="WABA" value={WHATSAPP_PIN_RECOVERY_TARGET.wabaId} />
                <DetailItem label="Phone ID" value={maskWhatsappRecoveryPhoneNumberId(WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId)} />
              </div>
              <details className="mt-3 rounded-xl border border-white/10 bg-zinc-950/30 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-emerald-200">Preparar recuperação</summary>
                <WhatsappPinRecoverySection canAccess={canManageWhatsappPins} metaExecutionEnabled={whatsappPinRecoveryMetaEnabled} />
              </details>
            </div> : null}
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-2xl border border-sky-400/20 bg-sky-500/[0.08] p-3 text-xs leading-5 text-sky-100">
            <AdminIcon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
            <div><span className="font-semibold">Importante:</span> ações externas permanecem condicionadas às autorizações e confirmações exibidas pelo backend.</div>
          </div>
        </section> : null}

        {activeStoreTab === "usage" ? <section>
          <h3 className="text-sm font-semibold text-zinc-200">Uso da loja</h3>
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <DetailItem label="Leads" value={formatNumber(store.totalLeads)} />
            <DetailItem
              label="Mensagens"
              value={formatNumber(store.totalMessages)}
              help="Mensagens comerciais totais da loja"
            />
            <DetailItem
              label="Mensagens da IA registradas"
              value={formatNumber(store.totalSalesAiMessages)}
              help="Mensagens da IA registradas localmente"
            />
            <DetailItem
              label="Mensagens IA assistente"
              value={formatNumber(store.totalAssistantMessages)}
              help="Mensagens do chat operacional interno"
            />
            <DetailItem
              label="Compromissos"
              value={formatNumber(store.totalAppointments)}
            />
          </div>
        </section> : null}

        {activeStoreTab === "usage" ? <section>
          <h3 className="text-sm font-semibold text-zinc-200">
            Trabalho da IA
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <DetailItem
              label="Execuções"
              value={formatOverviewMetric(aiRuns, getStoreAiAvailability(store, "runs"))}
              help={`${formatOverviewPercent(successfulRuns, aiRuns, getStoreAiAvailability(store, "runs"))} concluídas`}
            />
            <DetailItem label="Execuções concluídas" value={formatOverviewMetric(successfulRuns, getStoreAiAvailability(store, "runs"))} />
            <DetailItem label="Erros" value={formatOverviewMetric(failedRuns, getStoreAiAvailability(store, "runs"))} />
            <DetailItem
              label="Última IA"
              value={formatDateTime(store.lastAiRunAt)}
            />
          </div>
        </section> : null}

        {activeStoreTab === "usage" ? <section>
          <h3 className="text-sm font-semibold text-zinc-200">
            Custo e tokens
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-3">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
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
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
        </section> : null}

        {activeStoreTab === "pending" ? <section>
          <h3 className="text-sm font-semibold text-zinc-200">
            Pendências da loja
          </h3>
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
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
                value={formatOverviewMetric(store.pendingAiRuns, getStoreAiAvailability(store, "queue"))}
              />
              <DetailItem
                label="Erro fila IA"
                value={formatOverviewMetric(store.aiRunQueueErrors, getStoreAiAvailability(store, "queue"))}
              />
              <DetailItem
                label="Ações pendentes"
                value={formatOverviewMetric(store.pendingSalesActions, getStoreCommercialAvailability(store, "queue"))}
              />
              <DetailItem
                label="Erro WhatsApp"
                value={formatNumber(store.whatsappErrors)}
              />
            </div>
          </div>
        </section> : null}

        {activeStoreTab === "identification" ? <section>
          <h3 className="text-sm font-semibold text-zinc-200">Identificação</h3>
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-zinc-400">
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
        </section> : null}

        {activeStoreTab === "account" ? (
          <section>
            <h3 className="text-sm font-semibold text-zinc-200">Conta responsável</h3>
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <DetailItem label="Responsável" value={accountAccess?.responsibleName || "Não informado"} />
                <DetailItem label="E-mail" value={accountAccess?.emailMasked || "E-mail indisponível"} />
                <DetailItem
                  label="Acesso"
                  value={
                    accountAccess?.accessState === "blocked"
                      ? "Acesso bloqueado"
                      : accountAccess?.accessState === "active"
                        ? "Acesso ativo"
                        : accountAccess?.accessStateLabel || "Acesso indisponível"
                  }
                />
                <DetailItem label="Status" value={accountAccess?.statusLabel || "Conta indisponível"} />
                <DetailItem
                  label="Primeiro acesso"
                  value={formatAccountAccessDateTime(accountAccess?.firstAccessCompletedAt, accountAccess?.firstAccessHistoryStatus)}
                />
              </div>
              <p className="mt-3 text-xs leading-5 text-zinc-500">
                As ações de bloqueio e reativação permanecem na aba Ações.
              </p>
            </div>
          </section>
        ) : null}
      </div>
      </div>
    </section>
  );
}

export function OverviewDetailsDrawer({
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
    compare: "Comparar lojas",
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
    compare: "Comparação lado a lado entre duas lojas.",
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

        <div className="space-y-4">
          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              Resumo da IA nesta loja
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <DetailItem
                label="Execuções"
              value={formatOverviewMetric(aiRuns, getStoreAiAvailability(selectedAiStore, "runs"))}
                help={`${formatOverviewPercent(successfulRuns, aiRuns, getStoreAiAvailability(selectedAiStore, "runs"))} concluídas`}
              />
              <DetailItem label="Execuções concluídas" value={formatOverviewMetric(successfulRuns, getStoreAiAvailability(selectedAiStore, "runs"))} />
              <DetailItem label="Erros" value={formatOverviewMetric(failedRuns, getStoreAiAvailability(selectedAiStore, "runs"))} />
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
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <DetailItem
                label="Mensagens da IA registradas"
                value={formatNumber(selectedAiStore.totalSalesAiMessages)}
                help="Mensagens da IA registradas localmente"
              />
              <DetailItem
                label="Execuções comerciais"
                value={formatOverviewMetric(selectedAiStore.totalAiRuns, getStoreAiAvailability(selectedAiStore, "runs"))}
                help="Execuções registradas em ai_runs para esta loja"
              />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              IA assistente operacional
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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

        <div className="space-y-4">
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
            <p className="mt-1 text-[11px] leading-4 text-zinc-500">
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
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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

        <div className="space-y-4">
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
            <p className="mt-1 text-[11px] leading-4 text-zinc-500">
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
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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

        <div className="space-y-4">
          <section>
            <h3 className="text-sm font-semibold text-zinc-200">
              Resumo das pendências
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <DetailItem
                label="Total de pendências"
                value={operational.displayTotal}
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
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <DetailItem
                label="IA pendente"
                value={formatOverviewMetric(selectedPendingStore.pendingAiRuns, getStoreAiAvailability(selectedPendingStore, "queue"))}
              />
              <DetailItem
                label="Erro na fila de IA"
                value={formatOverviewMetric(selectedPendingStore.aiRunQueueErrors, getStoreAiAvailability(selectedPendingStore, "queue"))}
              />
              <DetailItem
                label="Ações comerciais pendentes"
                value={formatOverviewMetric(selectedPendingStore.pendingSalesActions, getStoreCommercialAvailability(selectedPendingStore, "queue"))}
              />
              <DetailItem
                label="Erro em ações comerciais"
                value={formatOverviewMetric(selectedPendingStore.salesActionErrors, getStoreCommercialAvailability(selectedPendingStore, "queue"))}
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
      return compareOperationalStores(a, b);
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
      main = `${formatOverviewMetric(store.totalAiRuns, getStoreAiAvailability(store, "runs"))} execuções`;
      help = availabilityHelp(getStoreAiAvailability(store, "runs"));
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
          <span className="shrink-0 rounded-full border border-white/10 bg-zinc-950/50 px-2 py-0.5 text-[10px] text-zinc-400">
            {getStoreStatusLabel(store.subscriptionStatus)}
          </span>
        </div>
        <div className="mt-4 text-lg font-semibold text-zinc-50">{main}</div>
        <div className="mt-1 text-[11px] leading-4 text-zinc-500">{help}</div>
        {type === "ia" ? (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-zinc-950/35 px-3 py-2">
              <div className="text-[11px] text-zinc-500">IA vendedora</div>
              <div className="mt-1 text-sm font-semibold text-zinc-100">
                {formatOverviewMetric(store.totalAiRuns, getStoreAiAvailability(store, "runs"))} execuções
              </div>
              <div className="mt-0.5 text-xs text-zinc-500">
                {formatOverviewMetric(store.successfulAiRuns, getStoreAiAvailability(store, "runs"))} concluídas · {formatOverviewMetric(store.failedAiRuns, getStoreAiAvailability(store, "runs"))} erro(s)
              </div>
              <div className="mt-0.5 text-xs text-zinc-500">
                {formatNumber(store.totalSalesAiMessages)} mensagens da IA registradas
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
      (store) => getOperationalSummary(store).hasPotentialPending,
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
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <DetailItem
              label="Total de pendências"
              value={formatOverviewMetric(data?.totals.totalOperationalIssues, getGlobalPendingAvailability(data))}
              help="Soma das pendências e erros nas filas monitoradas"
            />
            <DetailItem
              label="Lojas com pendência"
              value={formatNumber(storesWithPending.length)}
              help="Lojas com ao menos uma ocorrência crítica"
            />
          </div>

          <div className="rounded-xl border border-white/10 bg-zinc-950/40 px-3 py-1.5">
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
            <div className="mt-3 space-y-2.5">
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
                        <span className="shrink-0 rounded-full border border-white/10 bg-zinc-950/50 px-2 py-0.5 text-[10px] text-zinc-400">
                          {getStoreStatusLabel(store.subscriptionStatus)}
                        </span>
                      </div>
                      <div className="mt-4 text-lg font-semibold text-zinc-50">
                        {operational.label}
                      </div>
                      <div className="mt-1 text-[11px] leading-4 text-zinc-500">
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
          <div className="mt-2 text-2xl font-semibold text-zinc-50">
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
        <div className="mb-5 space-y-4">
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
        <div className="mb-5 space-y-4">
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

      <div className="space-y-2.5">
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
  const [selectedPendingStoreId, setSelectedPendingStoreId] = useState("");
  const [selectedAiDetail, setSelectedAiDetail] = useState<
    "executions" | "errors" | "messages" | "cost" | "tokens" | null
  >(null);
  const [compareLeftStoreId, setCompareLeftStoreId] = useState("");
  const [compareRightStoreId, setCompareRightStoreId] = useState("");
  const [compareLeftSearch, setCompareLeftSearch] = useState("");
  const [compareRightSearch, setCompareRightSearch] = useState("");

  if (!type) return null;

  const totalAiRuns = numberValue(data?.totals.aiRuns);
  const successfulAiRuns = numberValue(data?.totals.successfulAiRuns);
  const failedAiRuns = numberValue(data?.totals.failedAiRuns);
  const storesWithPending = stores.filter(
    (store) => getOperationalSummary(store).hasPotentialPending,
  );
  const filteredPendingStores = storesWithPending.filter((store) =>
    matchesSearch(store, pendingSearch),
  );
  const selectedPendingStore =
    storesWithPending.find((store) => store.id === selectedPendingStoreId) ?? null;
  const compareLeftStore =
    stores.find((store) => store.id === compareLeftStoreId) ?? null;
  const compareRightStore =
    stores.find((store) => store.id === compareRightStoreId) ?? null;

  if (type === "compare") {
    function renderComparisonColumn(side: "left" | "right") {
      const selectedStore = side === "left" ? compareLeftStore : compareRightStore;
      const selectedId = side === "left" ? compareLeftStoreId : compareRightStoreId;
      const otherSelectedId = side === "left" ? compareRightStoreId : compareLeftStoreId;
      const searchValue = side === "left" ? compareLeftSearch : compareRightSearch;
      const setSearch =
        side === "left" ? setCompareLeftSearch : setCompareRightSearch;
      const setSelectedId =
        side === "left" ? setCompareLeftStoreId : setCompareRightStoreId;

      const normalizedSearch = searchValue.trim().toLowerCase();
      const filteredOptions = stores
        .filter((store) => store.id !== otherSelectedId)
        .filter((store) => {
          if (!normalizedSearch) return true;

          return [store.name, store.organizationName, store.id]
            .filter(Boolean)
            .some((value) =>
              String(value).toLowerCase().includes(normalizedSearch),
            );
        })
        .slice(0, 8);

      function chooseStore(store: ZionAdminStore) {
        setSelectedId(store.id);
        setSearch(`${store.name} · ${store.organizationName}`);
      }

      return (
        <div className="rounded-xl border border-white/10 bg-zinc-950/35 p-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            {side === "left" ? "Loja A" : "Loja B"}
          </div>

          <div className="mt-2 rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">⌕</span>
              <input
                value={searchValue}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setSelectedId("");
                }}
                placeholder="Procurar loja pelo nome"
                className="w-full bg-transparent text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
              />
            </div>
          </div>

          <div className="mt-2 h-28 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-black/10 p-1 pr-1">
            {filteredOptions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 px-3 py-2 text-xs text-zinc-500">
                Nenhuma loja encontrada.
              </div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => chooseStore(option)}
                  className={[
                    "w-full rounded-xl border px-3 py-2 text-left text-xs transition",
                    selectedId === option.id
                      ? "border-white/30 bg-white/[0.08]"
                      : "border-white/10 bg-white/[0.025] hover:border-white/25 hover:bg-white/[0.055]",
                  ].join(" ")}
                >
                  <div className="truncate font-semibold text-zinc-100">
                    {option.name}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                    {option.organizationName}
                  </div>
                </button>
              ))
            )}
          </div>

          {selectedStore ? (
            <div className="mt-3 max-h-[310px] space-y-2 overflow-y-auto pr-1">
              <div>
                <div className="text-sm font-semibold text-zinc-100">
                  {selectedStore.name}
                </div>
                <div className="text-[11px] text-zinc-500">
                  {selectedStore.organizationName}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <DetailItem
                  label="Msg IA registradas"
                  value={formatNumber(selectedStore.totalSalesAiMessages)}
                />
                <DetailItem
                  label="Msg assist."
                  value={formatNumber(selectedStore.totalAssistantMessages)}
                />
                <DetailItem
                  label="Execuções"
                  value={formatNumber(selectedStore.totalAiRuns)}
                />
                <DetailItem
                  label="Concluídas"
                  value={formatNumber(selectedStore.successfulAiRuns)}
                />
                <DetailItem
                  label="Erros"
                  value={formatOverviewMetric(selectedStore.failedAiRuns, getStoreAiAvailability(selectedStore, "runs"))}
                />
                <DetailItem
                  label="Pendências"
                  value={formatOverviewMetric(selectedStore.totalOperationalIssues, getStorePendingAvailability(selectedStore))}
                />
                <DetailItem
                  label="Custo"
                  value={formatUsd(selectedStore.totalCostUsd)}
                />
                <DetailItem
                  label="Tokens"
                  value={formatCompactNumber(selectedStore.totalTokens)}
                />
                <DetailItem
                  label="Leads"
                  value={formatNumber(selectedStore.totalLeads)}
                />
                <DetailItem
                  label="Compromissos"
                  value={formatNumber(selectedStore.totalAppointments)}
                />
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-white/10 p-4 text-xs text-zinc-500">
              Procure e escolha uma loja para comparar.
            </div>
          )}
        </div>
      );
    }

    return (
      <section className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-zinc-50">Comparar lojas</h3>
            <p className="mt-0.5 text-xs leading-5 text-zinc-500">
              Procure duas lojas pelo nome e compare os dados lado a lado.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-fit rounded-xl border border-white/10 bg-zinc-950/50 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-white/[0.06]"
          >
            Ocultar
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {renderComparisonColumn("left")}
          {renderComparisonColumn("right")}
        </div>
      </section>
    );
  }

  if (type === "pending") {
    function renderIssueTechnicalDetails(issue: PendingIssueDetail) {
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

      return identifiers;
    }

    const selectedPendingDetailNotices = selectedPendingStore
      ? getPendingDetailsAvailabilityNotices({
          ai: selectedPendingStore.dataAvailability?.ai,
          commercial: selectedPendingStore.dataAvailability?.commercial,
        })
      : [];

    return (
      <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-zinc-50">Pendências</h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              Lojas em lista. Clique em uma loja para ver as pendências, detalhes e sugestão de resolução.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-fit rounded-xl border border-white/10 bg-zinc-950/50 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-white/[0.06]"
          >
            Ocultar detalhes
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <DetailItem
            label="Total de pendências"
            value={formatOverviewMetric(data?.totals.totalOperationalIssues, getGlobalPendingAvailability(data))}
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

        <div className="mt-4 rounded-xl border border-white/10 bg-zinc-950/40 px-3 py-1.5">
          <div className="flex items-center gap-2">
            <span className="text-zinc-500">⌕</span>
            <input
              value={pendingSearch}
              onChange={(event) => {
                setPendingSearch(event.target.value);
                setSelectedPendingStoreId("");
              }}
              placeholder="Procurar loja com pendência"
              className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.35fr]">
          <div className="rounded-2xl border border-white/10 bg-zinc-950/30 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
              Lojas com pendência
            </div>
            <div className="max-h-[330px] space-y-2 overflow-y-auto pr-1">
              {filteredPendingStores.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-zinc-500">
                  Nenhuma loja com pendência encontrada.
                </div>
              ) : (
                filteredPendingStores.map((store) => {
                  const operational = getOperationalSummary(store);
                  const selected = selectedPendingStoreId === store.id;

                  return (
                    <button
                      key={store.id}
                      type="button"
                      onClick={() => setSelectedPendingStoreId(store.id)}
                      className={[
                        "w-full rounded-xl border px-3 py-2 text-left transition",
                        selected
                          ? "border-white/35 bg-white/[0.08]"
                          : "border-white/10 bg-white/[0.025] hover:border-white/25 hover:bg-white/[0.055]",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-zinc-100">
                            {store.name}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                            {store.organizationName}
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full border border-white/10 bg-zinc-950/60 px-2 py-0.5 text-[11px] font-semibold text-zinc-200">
                          {operational.displayTotal}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-1 text-[11px] text-zinc-500">
                        {operational.details}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-950/30 p-3">
            {selectedPendingStore ? (
              <div>
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-100">
                      {selectedPendingStore.name}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {selectedPendingStore.organizationName}
                    </div>
                  </div>
                  <span className="w-fit rounded-full border border-white/10 bg-zinc-950/60 px-2 py-0.5 text-[10px] text-zinc-400">
                    {getOperationalSummary(selectedPendingStore).label}
                  </span>
                </div>

                <div className="mt-3 max-h-[430px] space-y-2 overflow-y-auto pr-1">
                  {selectedPendingDetailNotices.map((notice) => (
                    <div
                      key={notice}
                      className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-50"
                    >
                      {notice}
                    </div>
                  ))}
                  {(selectedPendingStore.pendingIssueDetails ?? []).length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 p-4 text-xs text-zinc-500">
                      {selectedPendingDetailNotices.length > 0
                        ? "Não é possível confirmar a ausência de detalhes enquanto as fontes correspondentes estiverem indisponíveis ou parciais."
                        : "Nenhum detalhe de IA ou comercial foi retornado no recorte consultado. Isso não comprova ausência de pendências nas respectivas filas. O contrato atual não informa disponibilidade individual explícita para WhatsApp e configurações."}
                    </div>
                  ) : (
                    (selectedPendingStore.pendingIssueDetails ?? []).map((issue) => {
                      const isConfigurationIssue = issue.source === "store_configuration";
                      const identifiers = renderIssueTechnicalDetails(issue);
                      const preview = issue.inputPreview || issue.payloadPreview || null;

                      return (
                        <div
                          key={`${issue.source}-${issue.id}`}
                          className={[
                            "rounded-xl border p-3 text-xs leading-5",
                            isConfigurationIssue
                              ? "border-sky-500/20 bg-sky-500/5 text-sky-50"
                              : "border-amber-500/20 bg-amber-500/5 text-amber-50",
                          ].join(" ")}
                        >
                          <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
                            <div className="font-semibold">
                              {issue.label || issue.source || "Pendência"}
                            </div>
                            <div className="shrink-0 text-[11px] text-zinc-500">
                              {formatDateTime(issue.occurredAt)}
                            </div>
                          </div>

                          <div className="mt-1 text-zinc-300">
                            {issue.error || "Erro sem detalhe registrado."}
                          </div>

                          <div className="mt-2 rounded-xl border border-white/10 bg-black/20 p-2 text-zinc-300">
                            {getPendingIssueResolutionHelp(issue)}
                          </div>

                          {identifiers.length > 0 ? (
                            <div className="mt-2 grid grid-cols-1 gap-1">
                              {identifiers.map((identifier) => (
                                <div
                                  key={identifier}
                                  className="break-words rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-zinc-400"
                                >
                                  {identifier}
                                </div>
                              ))}
                            </div>
                          ) : null}

                          {preview ? (
                            <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-black/25 p-2 text-[11px] text-zinc-400">
                              {preview}
                            </pre>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-dashed border-white/10 p-4 text-center text-sm text-zinc-500">
                Selecione uma loja na lista para ver as pendências, detalhes técnicos e sugestão de resolução.
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (type === "ia") {
    const detailModal = selectedAiDetail ? (
      <DetailModal
        title={
          selectedAiDetail === "executions"
            ? "Execuções da IA"
            : selectedAiDetail === "errors"
              ? "Erros da IA"
              : selectedAiDetail === "messages"
                ? "Mensagens por IA"
                : selectedAiDetail === "cost"
                  ? "Custo da IA"
                  : "Tokens usados"
        }
        description={
          selectedAiDetail === "executions"
            ? "Total de execuções de IA registradas em ai_runs, incluindo quantas concluíram sem erro técnico."
            : selectedAiDetail === "errors"
              ? "Execuções que falharam ou registraram erro técnico."
              : selectedAiDetail === "messages"
                ? "Separação entre mensagens da IA vendedora e mensagens da IA assistente."
                : selectedAiDetail === "cost"
                  ? "Custo real salvo em ai_runs, separado por período e origem."
                  : "Tokens de entrada e saída salvos em ai_runs, separados por período e origem."
        }
        onClose={() => setSelectedAiDetail(null)}
      >
        {selectedAiDetail === "executions" ? (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <DetailItem label="Total" value={formatOverviewMetric(totalAiRuns, getGlobalAiAvailability(data, "runs"))} />
            <DetailItem
              label="Taxa concluída"
              value={formatOverviewPercent(successfulAiRuns, totalAiRuns, getGlobalAiAvailability(data, "runs"))}
              help="Percentual de execuções sem erro técnico"
            />
            <DetailItem label="Concluídas" value={formatOverviewMetric(successfulAiRuns, getGlobalAiAvailability(data, "runs"))} />
            <DetailItem label="Erros" value={formatOverviewMetric(failedAiRuns, getGlobalAiAvailability(data, "runs"))} />
          </div>
        ) : null}


        {selectedAiDetail === "errors" ? (
          <div className="space-y-2.5">
            <DetailItem
              label="Erros"
              value={formatOverviewMetric(failedAiRuns, getGlobalAiAvailability(data, "runs"))}
              help="Execuções registradas com falha técnica"
            />
            <AiRunEventList
              title="Erros recentes por loja"
              emptyText="Nenhum erro recente disponível no recorte carregado."
              events={selectRecentAiErrors(stores)}
              variant="error"
              availability={getGlobalAiAvailability(data, "runs")}
            />
          </div>
        ) : null}

        {selectedAiDetail === "messages" ? (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <DetailItem
              label="IA vendedora (registros)"
              value={formatNumber(data?.totals.salesAiMessages)}
              help="Mensagens da IA registradas localmente"
            />
            <DetailItem
              label="IA assistente"
              value={formatNumber(data?.totals.assistantMessages)}
              help="Mensagens do chat operacional interno"
            />
          </div>
        ) : null}

        {selectedAiDetail === "cost" ? (
          <div className="space-y-4">
            <CostPeriodBlocks
              today={data?.totals.costUsdToday}
              week={data?.totals.costUsdLast7Days}
              month={data?.totals.costUsdMonth}
            />
            <CostBreakdownGrid breakdown={data?.totals.costBreakdownTotal} />
          </div>
        ) : null}

        {selectedAiDetail === "tokens" ? (
          <div className="space-y-4">
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
            <TokenBreakdownGrid breakdown={data?.totals.tokenBreakdownTotal} />
          </div>
        ) : null}
      </DetailModal>
    ) : null;

    return (
      <section className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-zinc-50">
              Trabalho da IA
            </h3>
            <p className="mt-0.5 text-xs leading-5 text-zinc-500">
              Soma das execuções, mensagens, custo e tokens das lojas monitoradas.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-fit rounded-xl border border-white/10 bg-zinc-950/50 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-white/[0.06]"
          >
            Ocultar
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <ClickableDetailItem
            label="Execuções"
            value={formatOverviewMetric(totalAiRuns, getGlobalAiAvailability(data, "runs"))}
            help={`${formatOverviewPercent(successfulAiRuns, totalAiRuns, getGlobalAiAvailability(data, "runs"))} concluídas`}
            onClick={() => setSelectedAiDetail("executions")}
          />
          <ClickableDetailItem
            label="Erros"
            value={formatOverviewMetric(failedAiRuns, getGlobalAiAvailability(data, "runs"))}
            help="Chamadas de IA com falha"
            onClick={() => setSelectedAiDetail("errors")}
          />
          <ClickableDetailItem
            label="Mensagens por IA"
            value={`${formatNumber(data?.totals.salesAiMessages)} / ${formatNumber(data?.totals.assistantMessages)}`}
            help="Vendedora / assistente"
            onClick={() => setSelectedAiDetail("messages")}
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-zinc-950/30 p-3">
            <div>
              <h4 className="text-sm font-semibold text-zinc-200">
                Custo da IA
              </h4>
              <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">
                Hoje, semana, mês e origem do gasto.
              </p>
            </div>
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

          <section className="rounded-2xl border border-white/10 bg-zinc-950/30 p-3">
            <div>
              <h4 className="text-sm font-semibold text-zinc-200">
                Tokens usados
              </h4>
              <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">
                Entrada, saída, período e origem do uso.
              </p>
            </div>
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

        {detailModal}
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
  preview = false,
}: {
  title: string;
  stores: ZionAdminStore[];
  search: string;
  onSearch: (value: string) => void;
  selectedStoreId?: string;
  onSelectStore: (store: ZionAdminStore) => void;
  inactive?: boolean;
  preview?: boolean;
}) {
  const filteredStores = stores.filter((store) => matchesSearch(store, search));
  const visibleStores = preview ? filteredStores.slice(0, 5) : filteredStores;

  return (
    <section className="rounded-2xl border border-[#252b35] bg-[#0e1218] p-4 shadow-[0_12px_32px_rgba(0,0,0,0.12)]">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <span className="w-fit rounded-full border border-[#252b35] bg-[#080b10] px-3 py-1 text-xs text-[#8e98aa]">
          {formatNumber(stores.length)} loja(s)
        </span>
      </div>

      <label className="mt-4 flex items-center gap-2 rounded-xl border border-[#252b35] bg-[#080b10] px-3 py-2">
        <div className="flex items-center gap-2">
          <AdminIcon name="search" className="h-4 w-4 text-[#616b7c]" />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Procurar loja por nome, organização ou status"
            className="w-full bg-transparent text-sm text-[#f4f6fb] outline-none placeholder:text-[#616b7c]"
          />
        </div>
      </label>

      <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
        {visibleStores.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">
            Nenhuma loja encontrada.
          </div>
        ) : (
          <table className="min-w-[980px] w-full border-collapse text-left text-xs">
            <thead className="bg-white/[0.035] text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              <tr>
                {['Loja', 'Organização', 'Status', 'Saúde', 'Configuração', 'IA', 'Uso', 'Pendências', 'Última IA', 'Ações'].map((heading) => (
                  <th key={heading} className="border-b border-white/10 px-3 py-2.5 font-semibold">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleStores.map((store) => {
                const operational = getOperationalSummary(store);
                const healthState = store.operationalHealth?.state ?? "unknown";
                const readinessState = store.settingsReadiness?.overall ?? "unknown";
                return (
                  <tr key={store.id} className={selectedStoreId === store.id ? "bg-violet-500/[0.08]" : "hover:bg-white/[0.035]"}>
                    <td className="border-b border-white/[0.07] px-3 py-3 font-semibold text-zinc-100">
                      <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-sky-400/10 text-sky-300"><AdminIcon name="stores" className="h-3.5 w-3.5" /></span><span className="max-w-[150px] truncate">{store.name}</span></div>
                    </td>
                    <td className="border-b border-white/[0.07] px-3 py-3 text-zinc-400">{store.organizationName}</td>
                    <td className="border-b border-white/[0.07] px-3 py-3"><span className="rounded-full border border-white/10 bg-zinc-950/60 px-2 py-1 text-[10px] text-zinc-300">{getStoreStatusLabel(store.subscriptionStatus)}</span></td>
                    <td className="border-b border-white/[0.07] px-3 py-3"><span className={`rounded-full border px-2 py-1 text-[10px] ${getOperationalHealthStateClassName(healthState)}`}>{getStoreOperationalHealthStateLabel(store.operationalHealth)}</span></td>
                    <td className="border-b border-white/[0.07] px-3 py-3"><span className={`rounded-full border px-2 py-1 text-[10px] ${getSettingsReadinessStateClassName(readinessState)}`}>{STORE_SETTINGS_READINESS_STATE_LABELS[readinessState]}</span></td>
                    <td className="border-b border-white/[0.07] px-3 py-3 text-zinc-300">{formatOverviewMetric(store.totalAiRuns, getStoreAiAvailability(store, "runs"))}</td>
                    <td className="border-b border-white/[0.07] px-3 py-3 text-zinc-300">{formatNumber(store.totalMessages)} msg</td>
                    <td className="border-b border-white/[0.07] px-3 py-3 text-zinc-300">{operational.label}</td>
                    <td className="border-b border-white/[0.07] px-3 py-3 text-zinc-400">{formatDateTime(store.lastAiRunAt)}</td>
                    <td className="border-b border-white/[0.07] px-3 py-3"><button type="button" onClick={() => onSelectStore(store)} className="whitespace-nowrap rounded-lg border border-violet-400/40 px-2.5 py-1.5 text-[10px] font-semibold text-violet-200 transition hover:bg-violet-500/15">Abrir loja <AdminIcon name="arrow" className="ml-1 inline h-3 w-3" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {preview && filteredStores.length > visibleStores.length ? <div className="mt-2 text-right text-xs text-zinc-500">Exibindo {visibleStores.length} de {filteredStores.length}. Abra Lojas para ver a tabela completa.</div> : null}
    </section>
  );
}

const WHATSAPP_PIN_RECOVERY_TARGET = {
  organizationId: "fbd4afaa-4958-4663-9234-98589ab322c7",
  storeId: "54fb81f4-92e5-463a-af6c-fc1544ea4b04",
  wabaId: "1642288770859048",
  phoneNumberId: "1322472314288518",
} as const;

function isWhatsappPinRecoveryTargetStore(
  store: Pick<ZionAdminStore, "organizationId" | "id">,
) {
  return (
    store.organizationId === WHATSAPP_PIN_RECOVERY_TARGET.organizationId &&
    store.id === WHATSAPP_PIN_RECOVERY_TARGET.storeId
  );
}

type WhatsappPinRecoveryPhase =
  | "idle"
  | "preparing"
  | "prepared"
  | "authorizing_execute"
  | "executing"
  | "remote_confirmed"
  | "authorizing_materialize"
  | "materializing"
  | "completed"
  | "remote_rejected"
  | "remote_uncertain"
  | "failed";

type WhatsappPinRecoveryAttempt = {
  attemptId: string;
  operationId: string;
  expiresAt: string;
};

function mapWhatsappPinRecoveryError(payload: unknown, status: number) {
  const error =
    payload && typeof payload === "object" && !Array.isArray(payload) &&
    typeof (payload as Record<string, unknown>).error === "string"
      ? String((payload as Record<string, unknown>).error)
      : "";

  switch (error) {
    case "WHATSAPP_PIN_RECOVERY_META_EXECUTION_DISABLED":
      return "A recuperação Meta está desabilitada por configuração.";
    case "WHATSAPP_PIN_RECOVERY_OAUTH_CODE_REQUIRED":
    case "WHATSAPP_PIN_RECOVERY_FRESH_OAUTH_CODE_REQUIRED":
      return "A autorização Meta não foi recebida. Reinicie a autorização.";
    case "WHATSAPP_PIN_RECOVERY_EXPLICIT_CONSENT_REQUIRED":
      return "Confirme o consentimento administrativo antes de preparar a recuperação.";
    case "WHATSAPP_PIN_RECOVERY_REMOTE_RESULT_RETURN_INVALID":
      return "A Meta respondeu, mas o resultado não pôde ser confirmado com segurança.";
    case "WHATSAPP_PIN_RECOVERY_MATERIALIZATION_AUTHORIZATION_INVALID":
      return "A autorização para concluir a integração não corresponde à tentativa preparada.";
    case "WHATSAPP_PIN_RECOVERY_BEGIN_RETURN_INVALID":
      return "A autorização local da recuperação não pôde ser confirmada.";
    default:
      return status === 401 || status === 403
        ? "Sua sessão administrativa não está autorizada para esta recuperação."
        : "Não foi possível concluir a etapa da recuperação. Nenhum PIN foi exibido.";
  }
}

function maskWhatsappRecoveryPhoneNumberId(value: string) {
  return value.length > 8
    ? `${value.slice(0, 4)}••••${value.slice(-4)}`
    : "••••••••";
}

function WhatsappPinRecoverySection({
  canAccess,
  metaExecutionEnabled,
}: {
  canAccess: boolean;
  metaExecutionEnabled: boolean;
}) {
  const [recoveryConsent, setRecoveryConsent] = useState(false);
  const [recoveryPhase, setRecoveryPhase] = useState<WhatsappPinRecoveryPhase>("idle");
  const [recoveryAttempt, setRecoveryAttempt] = useState<WhatsappPinRecoveryAttempt | null>(null);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoverySession, setRecoverySession] = useState<MetaEmbeddedSignupSession | null>(null);
  const [recoveryOAuthPurpose, setRecoveryOAuthPurpose] = useState<"execute" | "materialize" | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const recoveryBusyRef = useRef(false);
  const recoveryMountedRef = useRef(true);
  const recoveryOAuthTimerRef = useRef<number | null>(null);
  const recoveryAttemptRef = useRef<WhatsappPinRecoveryAttempt | null>(null);
  const recoveryOAuthSequenceRef = useRef(0);
  const recoveryResumeSequenceRef = useRef(0);
  const recoveryResumeLoadingRef = useRef(false);
  const recoveryOAuthFlowRef = useRef<{
    id: number;
    purpose: "execute" | "materialize";
    code: string;
    session: MetaEmbeddedSignupSession | null;
    status: "authorizing" | "submitting" | "closed";
  } | null>(null);
  const recoveryOAuthCoordinatorRef = useRef<ReturnType<typeof createMetaEmbeddedSignupFlowCoordinator> | null>(null);
  const recoveryMessageListenerRef = useRef<((event: MessageEvent) => void) | null>(null);
  const metaEmbeddedSignupConfig = useMemo(() => getMetaEmbeddedSignupConfig(), []);

  useEffect(() => {
    recoveryAttemptRef.current = recoveryAttempt;
  }, [recoveryAttempt]);

  useEffect(() => {
    if (!canAccess || !metaExecutionEnabled || recoveryAttempt) return;

    const requestId = recoveryResumeSequenceRef.current + 1;
    recoveryResumeSequenceRef.current = requestId;
    recoveryResumeLoadingRef.current = true;
    recoveryBusyRef.current = true;
    void Promise.resolve().then(() => {
      if (
        recoveryMountedRef.current &&
        recoveryResumeLoadingRef.current &&
        recoveryResumeSequenceRef.current === requestId
      ) setRecoveryBusy(true);
    });
    const controller = new AbortController();
    void fetch("/api/zion-admin/whatsapp-pins/recovery", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (
          !recoveryMountedRef.current ||
          !recoveryResumeLoadingRef.current ||
          recoveryResumeSequenceRef.current !== requestId
        ) return;
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        if (!response.ok || payload?.ok !== true) {
          throw new Error(mapWhatsappPinRecoveryError(payload, response.status));
        }
        if (payload.resumable !== true) return;
        if (
          payload.status !== "remote_confirmed" ||
          typeof payload.attemptId !== "string" ||
          typeof payload.operationId !== "string" ||
          typeof payload.authorizationExpiresAt !== "string" ||
          typeof payload.createdAt !== "string" ||
          typeof payload.remoteResultAt !== "string"
        ) {
          throw new Error("A retomada retornou dados inválidos e foi bloqueada.");
        }
        const target = payload.target;
        if (!target || typeof target !== "object" || Array.isArray(target)) {
          throw new Error("A retomada retornou um alvo inválido e foi bloqueada.");
        }
        const targetRecord = target as Record<string, unknown>;
        if (
          targetRecord.organizationId !== WHATSAPP_PIN_RECOVERY_TARGET.organizationId ||
          targetRecord.storeId !== WHATSAPP_PIN_RECOVERY_TARGET.storeId ||
          targetRecord.wabaId !== WHATSAPP_PIN_RECOVERY_TARGET.wabaId ||
          targetRecord.phoneNumberId !== WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId
        ) {
          throw new Error("A retomada retornou um alvo divergente e foi bloqueada.");
        }
        setRecoveryAttempt({
          attemptId: payload.attemptId,
          operationId: payload.operationId,
          expiresAt: payload.authorizationExpiresAt,
        });
        setRecoveryPhase("remote_confirmed");
        setRecoveryMessage("Recuperação remota confirmada localizada. Autorize novamente na Meta para materializar.");
      })
      .catch((reason) => {
        if (
          !controller.signal.aborted &&
          recoveryMountedRef.current &&
          recoveryResumeLoadingRef.current &&
          recoveryResumeSequenceRef.current === requestId
        ) {
          setRecoveryError(reason instanceof Error ? reason.message : "Não foi possível consultar a retomada segura.");
        }
      })
      .finally(() => {
        if (
          !recoveryMountedRef.current ||
          recoveryResumeSequenceRef.current !== requestId
        ) return;
        recoveryResumeLoadingRef.current = false;
        recoveryBusyRef.current = false;
        setRecoveryBusy(false);
      });

    return () => {
      recoveryResumeSequenceRef.current += 1;
      recoveryResumeLoadingRef.current = false;
      controller.abort();
    };
  }, [canAccess, metaExecutionEnabled, recoveryAttempt]);

  const removeRecoveryMessageListener = useCallback(() => {
    const listener = recoveryMessageListenerRef.current;
    if (!listener || typeof window === "undefined") return;
    window.removeEventListener("message", listener);
    recoveryMessageListenerRef.current = null;
  }, []);

  const handleRecoveryEmbeddedSignupMessage = useCallback((flowId: number, event: MessageEvent) => {
    const flow = recoveryOAuthFlowRef.current;
    if (!flow || !isMetaEmbeddedSignupFlowActive({ expectedFlowId: flowId, currentFlowId: flow.id, status: flow.status })) return;
    recoveryOAuthCoordinatorRef.current?.acceptMessage(event);

    const diagnostic = classifyMetaEmbeddedSignupMessage(event);
    if (diagnostic === "origin_rejected") {
      setRecoveryMessage("Evento Meta rejeitado por origem não autorizada.");
      return;
    }
    if (diagnostic === "ignored_message") return;
    if (diagnostic === "other_event") {
      setRecoveryMessage("Evento Meta recebido; aguardando FINISH validado.");
      return;
    }
    if (diagnostic === "cancelled" || isMetaEmbeddedSignupCancellation(event)) {
      flow.status = "closed";
      if (recoveryOAuthTimerRef.current !== null) window.clearTimeout(recoveryOAuthTimerRef.current);
      recoveryOAuthFlowRef.current = null;
      recoveryOAuthCoordinatorRef.current?.close();
      recoveryOAuthCoordinatorRef.current = null;
      removeRecoveryMessageListener();
      setRecoveryCode("");
      setRecoverySession(null);
      setRecoveryOAuthPurpose(null);
      setRecoveryPhase(recoveryAttemptRef.current ? "prepared" : "idle");
      setRecoveryMessage("A autorização Meta foi cancelada antes da conclusão.");
      return;
    }
    if (diagnostic === "finish_missing_context" || diagnostic === "finish_missing_ids") {
      setRecoveryMessage("FINISH recebido sem contexto Meta completo; aguardando confirmação válida.");
      return;
    }

    const session = extractMetaEmbeddedSignupSession(event);
    if (!session) {
      setRecoveryMessage("FINISH Meta rejeitado por formato ou identificadores inválidos.");
      return;
    }
    if (
      session.whatsappBusinessAccountId !== WHATSAPP_PIN_RECOVERY_TARGET.wabaId ||
      session.phoneNumberId !== WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId
    ) {
      setRecoverySession(null);
      setRecoveryMessage("FINISH Meta rejeitado: WABA ou Phone ID não corresponde ao alvo autorizado.");
      return;
    }

    flow.session = session;
    setRecoverySession(session);
    setRecoveryMessage("Contexto Meta FINISH recebido. Aguardando o código OAuth seguro.");
  }, [removeRecoveryMessageListener]);

  const ensureRecoveryMessageListener = useCallback((flowId: number) => {
    if (typeof window === "undefined" || recoveryMessageListenerRef.current) return;
    const listener = (event: MessageEvent) => handleRecoveryEmbeddedSignupMessage(flowId, event);
    recoveryMessageListenerRef.current = listener;
    window.addEventListener("message", listener);
  }, [handleRecoveryEmbeddedSignupMessage]);

  useEffect(() => {
    return () => {
      recoveryMountedRef.current = false;
      if (recoveryOAuthTimerRef.current !== null) window.clearTimeout(recoveryOAuthTimerRef.current);
      recoveryOAuthFlowRef.current = null;
      recoveryOAuthCoordinatorRef.current = null;
      removeRecoveryMessageListener();
    };
  }, [removeRecoveryMessageListener]);

  const runRecoveryAction = useCallback(async (action: "execute" | "materialize", oauthCode: string) => {
    if (!recoveryAttempt || recoveryBusyRef.current || !oauthCode) return;

    recoveryBusyRef.current = true;
    setRecoveryBusy(true);
    setRecoveryError(null);
    setRecoveryMessage(action === "execute" ? "Executando a autorização remota..." : "Materializando a integração confirmada...");
    setRecoveryPhase(action === "execute" ? "executing" : "materializing");

    try {
      const response = await fetch("/api/zion-admin/whatsapp-pins/recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          action,
          attemptId: recoveryAttempt.attemptId,
          operationId: recoveryAttempt.operationId,
          oauthCode,
        }),
      });
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      const status = typeof payload?.status === "string" ? payload.status : "";

      if (action === "execute" && status === "remote_uncertain") {
        setRecoveryPhase("remote_uncertain");
        setRecoveryMessage("O resultado remoto ficou incerto. Não repita a operação automaticamente.");
        return;
      }
      if (action === "execute" && status === "remote_rejected") {
        setRecoveryPhase("remote_rejected");
        setRecoveryMessage("A Meta rejeitou a operação de recuperação.");
        return;
      }
      if (action === "execute" && response.ok && status === "remote_confirmed") {
        setRecoveryPhase("remote_confirmed");
        setRecoveryMessage("A Meta confirmou a operação. É necessária uma nova autorização para materializar.");
        return;
      }
      if (action === "materialize" && response.ok && status === "completed") {
        setRecoveryPhase("completed");
        setRecoveryMessage("Recuperação concluída e integração materializada pelo backend.");
        return;
      }

      throw new Error(mapWhatsappPinRecoveryError(payload, response.status));
    } catch (reason) {
      setRecoveryPhase("failed");
      setRecoveryError(reason instanceof Error ? reason.message : "Não foi possível concluir a recuperação.");
    } finally {
      setRecoveryCode("");
      setRecoverySession(null);
      setRecoveryOAuthPurpose(null);
      recoveryBusyRef.current = false;
      setRecoveryBusy(false);
      if (recoveryOAuthTimerRef.current !== null) {
        window.clearTimeout(recoveryOAuthTimerRef.current);
        recoveryOAuthTimerRef.current = null;
      }
      recoveryOAuthFlowRef.current = null;
      recoveryOAuthCoordinatorRef.current?.close();
      recoveryOAuthCoordinatorRef.current = null;
      removeRecoveryMessageListener();
    }
  }, [recoveryAttempt, removeRecoveryMessageListener]);

  useEffect(() => {
    const flow = recoveryOAuthFlowRef.current;
    if (
      !flow ||
      flow.status !== "authorizing" ||
      !recoveryCode ||
      !recoverySession ||
      !recoveryOAuthPurpose ||
      flow.code !== recoveryCode ||
      flow.session !== recoverySession ||
      flow.purpose !== recoveryOAuthPurpose ||
      recoveryBusyRef.current
    ) return;
    flow.status = "submitting";
    recoveryOAuthCoordinatorRef.current?.markSubmitting();
    void runRecoveryAction(recoveryOAuthPurpose, recoveryCode);
  }, [recoveryCode, recoveryOAuthPurpose, recoverySession, runRecoveryAction]);

  async function startRecoveryOAuth(purpose: "execute" | "materialize") {
    if (
      !metaExecutionEnabled ||
      !recoveryAttempt ||
      recoveryBusyRef.current ||
      (purpose === "execute" && recoveryPhase !== "prepared") ||
      (purpose === "materialize" && recoveryPhase !== "remote_confirmed")
    ) return;

    setRecoveryError(null);
    setRecoveryMessage("Carregando a autorização oficial da Meta...");
    setRecoveryCode("");
    setRecoverySession(null);
    setRecoveryOAuthPurpose(purpose);
    setRecoveryPhase(purpose === "execute" ? "authorizing_execute" : "authorizing_materialize");
    const flowId = recoveryOAuthSequenceRef.current + 1;
    recoveryOAuthSequenceRef.current = flowId;
    recoveryOAuthFlowRef.current = {
      id: flowId,
      purpose,
      code: "",
      session: null,
      status: "authorizing",
    };
    recoveryOAuthCoordinatorRef.current = createMetaEmbeddedSignupFlowCoordinator({
      wabaId: WHATSAPP_PIN_RECOVERY_TARGET.wabaId,
      phoneNumberId: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId,
    });
    ensureRecoveryMessageListener(flowId);

    try {
      await ensureFacebookSdkLoaded(metaEmbeddedSignupConfig.appId);
      if (!window.FB?.login) throw new Error("FACEBOOK_SDK_LOGIN_UNAVAILABLE");

      window.FB.login(
        (response: FacebookLoginResponse) => {
          const flow = recoveryOAuthFlowRef.current;
          if (!flow || !isMetaEmbeddedSignupFlowActive({ expectedFlowId: flowId, currentFlowId: flow.id, status: flow.status })) return;
          const code = typeof response.authResponse?.code === "string"
            ? response.authResponse.code.trim()
            : "";
          if (!code) {
            flow.status = "closed";
            recoveryOAuthFlowRef.current = null;
            removeRecoveryMessageListener();
            setRecoveryCode("");
            setRecoverySession(null);
            setRecoveryOAuthPurpose(null);
            setRecoveryPhase(recoveryAttemptRef.current ? "prepared" : "idle");
            setRecoveryError("A autorização Meta foi cancelada ou não retornou código.");
            return;
          }
          if (!recoveryOAuthCoordinatorRef.current?.acceptOAuthCode(code)) return;
          flow.code = code;
          setRecoveryCode(code);
          setRecoveryMessage("Código OAuth recebido em memória. Aguardando o FINISH validado da Meta.");
        },
        {
          config_id: metaEmbeddedSignupConfig.configId,
          response_type: "code",
          override_default_response_type: true,
          extras: {
            version: "v4",
            featureType: "whatsapp_business_app_onboarding",
            sessionInfoVersion: "3",
          },
        },
      );

      if (recoveryOAuthTimerRef.current !== null) window.clearTimeout(recoveryOAuthTimerRef.current);
      recoveryOAuthTimerRef.current = window.setTimeout(() => {
        const flow = recoveryOAuthFlowRef.current;
        if (!recoveryMountedRef.current || recoveryBusyRef.current || !flow || !isMetaEmbeddedSignupFlowActive({ expectedFlowId: flowId, currentFlowId: flow.id, status: flow.status })) return;
        flow.status = "closed";
        recoveryOAuthFlowRef.current = null;
        removeRecoveryMessageListener();
        setRecoveryCode("");
        setRecoverySession(null);
        setRecoveryOAuthPurpose(null);
        setRecoveryPhase(recoveryAttemptRef.current ? "prepared" : "idle");
        setRecoveryError("O tempo seguro para receber código e contexto Meta terminou. A janela não foi classificada como fechada.");
      }, 4 * 60_000);
    } catch {
      const flow = recoveryOAuthFlowRef.current;
      if (!flow || flow.id !== flowId) return;
      flow.status = "closed";
      recoveryOAuthFlowRef.current = null;
      removeRecoveryMessageListener();
      setRecoveryCode("");
      setRecoverySession(null);
      setRecoveryOAuthPurpose(null);
      setRecoveryPhase(recoveryAttemptRef.current ? "prepared" : "idle");
      setRecoveryError("Não foi possível iniciar a autorização oficial da Meta.");
    }
  }

  async function prepareRecovery() {
    if (!metaExecutionEnabled || !recoveryConsent || recoveryBusyRef.current) return;

    recoveryResumeSequenceRef.current += 1;
    recoveryResumeLoadingRef.current = false;
    recoveryBusyRef.current = true;
    setRecoveryBusy(true);
    setRecoveryPhase("preparing");
    setRecoveryError(null);
    setRecoveryMessage("Preparando a tentativa administrativa...");

    try {
      const response = await fetch("/api/zion-admin/whatsapp-pins/recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          action: "prepare",
          consent: true,
          target: WHATSAPP_PIN_RECOVERY_TARGET,
        }),
      });
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (
        !response.ok ||
        payload?.ok !== true ||
        typeof payload.attemptId !== "string" ||
        typeof payload.operationId !== "string" ||
        typeof payload.expiresAt !== "string"
      ) {
        throw new Error(mapWhatsappPinRecoveryError(payload, response.status));
      }

      setRecoveryAttempt({
        attemptId: payload.attemptId,
        operationId: payload.operationId,
        expiresAt: payload.expiresAt,
      });
      setRecoveryPhase("prepared");
      setRecoveryMessage("Tentativa preparada. Use uma nova autorização oficial da Meta para continuar.");
    } catch (reason) {
      setRecoveryPhase("failed");
      setRecoveryError(reason instanceof Error ? reason.message : "Não foi possível preparar a recuperação.");
    } finally {
      recoveryBusyRef.current = false;
      setRecoveryBusy(false);
    }
  }

  if (!canAccess) return null;

  return (
    <section className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/[0.06] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200/70">
            Recuperação controlada
          </div>
          <h2 className="mt-1 text-lg font-semibold text-zinc-100">
            Regularização do WhatsApp
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-400">
            A Meta registra este telefone, mas ele ainda não está vinculado à integração do ZION.
            Esta operação nunca exibe o PIN original.
          </p>
        </div>
        <span className="w-fit rounded-full border border-amber-400/20 bg-zinc-950/50 px-3 py-1 text-xs text-amber-100">
          {metaExecutionEnabled ? "Disponibilidade controlada" : "Bloqueada por padrão"}
        </span>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-zinc-300 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-zinc-950/40 p-3">
          <div className="text-zinc-500">WABA autorizada</div>
          <code className="mt-1 block text-zinc-200">{WHATSAPP_PIN_RECOVERY_TARGET.wabaId}</code>
        </div>
        <div className="rounded-xl border border-white/10 bg-zinc-950/40 p-3">
          <div className="text-zinc-500">Phone ID autorizado</div>
          <code className="mt-1 block text-zinc-200">
            {maskWhatsappRecoveryPhoneNumberId(WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId)}
          </code>
        </div>
      </div>

      <ol className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-4">
        {[
          ["1", "Preparar", "consentimento e autorização local"],
          ["2", "Autorizar na Meta", "novo OAuth, sem reutilizar código"],
          ["3", "Executar", "operação remota com resultado explícito"],
          ["4", "Materializar", "somente após confirmação remota"],
        ].map(([number, title, description]) => (
          <li key={number} className="rounded-xl border border-white/10 bg-zinc-950/40 p-3">
            <span className="font-semibold text-zinc-200">{number}. {title}</span>
            <span className="mt-1 block leading-5">{description}</span>
          </li>
        ))}
      </ol>

      {metaExecutionEnabled ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-zinc-950/40 p-3">
          <label className="flex items-start gap-2 text-xs leading-5 text-zinc-300">
            <input
              type="checkbox"
              checked={recoveryConsent}
              disabled={recoveryBusy || recoveryAttempt !== null}
              onChange={(event) => setRecoveryConsent(event.target.checked)}
              className="mt-1 accent-amber-400"
            />
            <span>
              Confirmo que esta é uma operação administrativa explícita para a loja Meta autorizada e
              que a execução externa só poderá ocorrer após nova autorização na Meta.
            </span>
          </label>

          <div className="mt-3 flex flex-wrap gap-2">
            {!recoveryAttempt ? (
              <button
                type="button"
                disabled={!recoveryConsent || recoveryPhase === "preparing" || recoveryBusy}
                onClick={() => void prepareRecovery()}
                className="rounded-lg bg-amber-300 px-3 py-2 text-xs font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {recoveryPhase === "preparing" ? "Preparando..." : "Preparar recuperação"}
              </button>
            ) : null}

            {recoveryPhase === "prepared" ? (
              <button
                type="button"
                disabled={recoveryBusy}
                onClick={() => void startRecoveryOAuth("execute")}
                className="rounded-lg bg-violet-400 px-3 py-2 text-xs font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Autorizar na Meta e executar
              </button>
            ) : null}

            {recoveryPhase === "remote_confirmed" ? (
              <button
                type="button"
                disabled={recoveryBusy}
                onClick={() => void startRecoveryOAuth("materialize")}
                className="rounded-lg bg-emerald-300 px-3 py-2 text-xs font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Autorizar novamente e materializar
              </button>
            ) : null}
          </div>

          {recoveryAttempt ? (
            <div className="mt-2 text-[11px] text-zinc-500">
              Tentativa preparada. A validade é controlada pelo backend; não reutilize esta operação em outra sessão.
            </div>
          ) : null}
        </div>
      ) : null}

      {recoveryMessage ? (
        <div className="mt-3 rounded-xl border border-blue-400/20 bg-blue-400/10 p-3 text-xs leading-5 text-blue-100">
          {recoveryMessage}
        </div>
      ) : null}
      {recoveryError ? (
        <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-xs leading-5 text-red-100">
          {recoveryError}
        </div>
      ) : null}

      <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
        {metaExecutionEnabled
          ? "A autorização usa o mecanismo Embedded Signup compartilhado com o onboarding. O backend valida o alvo, a sessão, a tentativa e o código antes de qualquer operação externa."
          : "A execução Meta está desabilitada por configuração. Nenhuma operação, chamada OAuth ou chamada externa está disponível neste painel."}
      </div>
    </section>
  );
}

function WhatsappPinsSection({
  canAccess,
  metaExecutionEnabled,
  organizationId,
  storeId,
  compact = false,
}: {
  canAccess: boolean;
  metaExecutionEnabled: boolean;
  organizationId: string;
  storeId: string;
  compact?: boolean;
}) {
  const [pins, setPins] = useState<ZionAdminWhatsappPin[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealedPins, setRevealedPins] = useState<Record<string, string>>({});
  const [revealBusyId, setRevealBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!canAccess || loaded) return;

    const controller = new AbortController();
    void fetch(
      `/api/zion-admin/whatsapp-pins?organization_id=${encodeURIComponent(organizationId)}&store_id=${encodeURIComponent(storeId)}`,
      {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
      },
    )
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok || !Array.isArray(payload.pins)) {
          throw new Error(payload?.message || "Nao foi possivel carregar os PINs.");
        }
        setPins(payload.pins as ZionAdminWhatsappPin[]);
        setLoaded(true);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Nao foi possivel carregar os PINs.");
        }
      })
      .finally(() => {
        // The loaded/error state determines the terminal UI state.
      });

    return () => controller.abort();
  }, [canAccess, loaded, organizationId, storeId]);

  useEffect(() => {
    const timers = Object.keys(revealedPins).map((secretId) =>
      window.setTimeout(() => {
        setRevealedPins((current) => {
          const next = { ...current };
          delete next[secretId];
          return next;
        });
      }, 15_000),
    );

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [revealedPins]);

  async function revealPin(pin: ZionAdminWhatsappPin) {
    if (!pin.can_reveal || pin.secret_status === "pending" || revealBusyId) return;

    setRevealBusyId(pin.secret_id);
    setError(null);

    try {
      const response = await fetch("/api/zion-admin/whatsapp-pins/reveal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          secretId: pin.secret_id,
          organizationId: pin.organization_id,
          storeId: pin.store_id,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok || typeof payload.pin !== "string") {
        throw new Error(payload?.message || "Nao foi possivel revelar este PIN.");
      }

      setRevealedPins((current) => ({ ...current, [pin.secret_id]: payload.pin }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nao foi possivel revelar este PIN.");
    } finally {
      setRevealBusyId(null);
    }
  }

  if (!canAccess) return null;

  const loading = !loaded && !error;

  return (
    <>
    <section className="rounded-2xl border border-violet-400/20 bg-violet-500/[0.06] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-200/70">
            Segurança operacional
          </div>
          <h2 className="mt-1 text-lg font-semibold text-zinc-100">PINs</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            Segredos armazenados para a verificação em duas etapas do WhatsApp.
          </p>
        </div>
        <span className="w-fit rounded-full border border-white/10 bg-zinc-950/50 px-3 py-1 text-xs text-zinc-400">
          {loading ? "Carregando..." : `${formatNumber(pins.length)} PIN(s)`}
        </span>
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {!loading && !error && pins.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-white/10 p-4 text-sm text-zinc-500">
          Nenhum PIN armazenado foi encontrado.
        </div>
      ) : null}

      <div className="mt-3 space-y-2">
        {pins.map((pin) => {
          const revealed = revealedPins[pin.secret_id];
          const invalidated = pin.secret_status === "invalidated";
          const pending = pin.secret_status === "pending";

          return (
            <div
              key={pin.secret_id}
              className="rounded-xl border border-white/10 bg-zinc-950/50 p-3"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-zinc-100">{pin.store_name}</span>
                    <span
                      className={[
                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
                        invalidated
                          ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
                          : pending
                            ? "border-zinc-500/30 bg-zinc-500/10 text-zinc-300"
                            : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
                      ].join(" ")}
                    >
                      {pin.secret_status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    Telefone: {pin.phone_number_id_masked}
                  </div>
                  {invalidated ? (
                    <div className="mt-2 text-xs leading-5 text-amber-200">
                      PIN historico invalidado. Sua validade atual na Meta nao esta confirmada.
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <code className="min-w-[92px] rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-center text-sm tracking-[0.28em] text-zinc-200">
                    {revealed || "••••••"}
                  </code>
                  {revealed ? (
                    <button
                      type="button"
                      onClick={() =>
                        setRevealedPins((current) => {
                          const next = { ...current };
                          delete next[pin.secret_id];
                          return next;
                        })
                      }
                      className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/[0.08]"
                    >
                      Ocultar PIN
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={pending || !pin.can_reveal || revealBusyId !== null}
                      onClick={() => void revealPin(pin)}
                      className="rounded-lg bg-violet-400 px-3 py-2 text-xs font-semibold text-zinc-950 hover:bg-violet-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {revealBusyId === pin.secret_id ? "Revelando..." : "Revelar PIN"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!compact ? (
        <details className="mt-3 rounded-xl border border-white/10 bg-zinc-950/30 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-violet-200">Histórico e recuperação</summary>
          <WhatsappPinRecoverySection
            canAccess={canAccess}
            metaExecutionEnabled={metaExecutionEnabled}
          />
        </details>
      ) : null}
    </section>
    </>
  );
}

export default function ZionAdminDashboardClient({
  adminRole,
  canManageWhatsappPins,
  whatsappPinRecoveryMetaEnabled,
  initialData,
  initialError,
}: Props) {
  const router = useRouter();
  const [selectedStore, setSelectedStore] = useState<ZionAdminStore | null>(
    null,
  );
  const [selectedOverview, setSelectedOverview] =
    useState<OverviewPanelKey | null>(null);
  const [activeGlobalSection, setActiveGlobalSection] = useState<
    "overview" | "alerts" | "stores" | "comparisons"
  >("overview");
  const [activeSearch, setActiveSearch] = useState("");
  const [inactiveSearch, setInactiveSearch] = useState("");
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isCreateAccountOpen, setIsCreateAccountOpen] = useState(false);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [createAccountError, setCreateAccountError] = useState<string | null>(null);
  const [createAccountSuccess, setCreateAccountSuccess] = useState<{
    email: string;
    membershipRole: string;
  } | null>(null);
  const [resendBusyStoreId, setResendBusyStoreId] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [accessBusyMembershipId, setAccessBusyMembershipId] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessSuccess, setAccessSuccess] = useState<string | null>(null);
  const [storeBusyId, setStoreBusyId] = useState<string | null>(null);
  const [storeActionError, setStoreActionError] = useState<string | null>(null);
  const [storeActionSuccess, setStoreActionSuccess] = useState<string | null>(null);
  const [data, setData] = useState<ZionAdminOverview | null>(initialData);
  const [overviewError, setOverviewError] = useState<string | null>(initialError);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function refreshOverview() {
      try {
        const response = await fetch("/api/zion-admin/overview", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok || !payload || !Array.isArray(payload.stores)) {
          throw new Error(
            payload?.error || "Não foi possível atualizar os dados internos do ZION.",
          );
        }

        if (!active) {
          return;
        }

        const nextData = payload as ZionAdminOverview;

        setData(nextData);
        setOverviewError(null);

        setSelectedStore((current) => {
          if (!current) {
            return null;
          }

          return nextData.stores.find((store) => store.id === current.id) ?? null;
        });
      } catch (error) {
        if (!active || controller.signal.aborted) {
          return;
        }

        console.error(
          "[ZionAdminDashboardClient] overview refresh error:",
          error,
        );

        setOverviewError(
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar os dados internos do ZION.",
        );
      }
    }

    void refreshOverview();

    return () => {
      active = false;
      controller.abort();
    };
  }, [initialData, initialError]);

  const stores = data?.stores ?? [];
  const activeStores = stores.filter(isStoreActive);
  const inactiveStores = stores.filter(isStoreCanceledOrInactive);
  const integrityOrphanStores = data?.integrity?.orphanStores ?? [];
  const orphanStoresCount = data?.integrity?.orphanStoresCount ?? 0;
  const integritySummary = getStoreIntegritySummary(stores, integrityOrphanStores);

  const countErrors = data?.countErrors ?? {};
  const hasCountErrors = Object.values(countErrors).some(Boolean);

  const totalAiRuns = numberValue(data?.totals.aiRuns);
  const globalAiRunsAvailability = getGlobalAiAvailability(data, "runs");
  const globalPendingAvailability = getGlobalPendingAvailability(data);
  const storesWithProblems = stores.filter(
    (store) => store.operationalHealth?.state === "broken" || store.integrity?.state === "broken",
  ).length;
  const storesWithBlockedConfiguration = stores.filter(
    (store) => store.settingsReadiness?.overall === "blocked",
  ).length;
  const canManageAccounts = useMemo(() => {
    const normalized = String(adminRole || "").trim().toLowerCase();
    return normalized === "owner" || normalized === "admin" || normalized === "super_admin";
  }, [adminRole]);

  async function handleSignOut() {
    if (isSigningOut) return;

    setIsSigningOut(true);

    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error("[ZionAdminDashboardClient] signOut error:", error);
    } finally {
      if (typeof window !== "undefined") {
        const loginUrl = `${window.location.origin}/zion-admin/login`;
        window.location.replace(loginUrl);
        window.setTimeout(() => {
          window.location.assign(loginUrl);
        }, 50);
      } else {
        router.replace("/zion-admin/login");
        router.refresh();
      }
    }
  }

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateAccountError(null);
    setCreateAccountSuccess(null);

    const form = event.currentTarget;
    const email = normalizeEmail(form.dataset.email || "");
    const storeName = String(form.dataset.storeName || "").trim();
    const responsibleName = String(form.dataset.responsibleName || "").trim();

    if (!email) {
      setCreateAccountError("Preencha o e-mail da nova conta.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setCreateAccountError("Digite um e-mail válido.");
      return;
    }

    if (!storeName) {
      setCreateAccountError("Preencha o nome da loja.");
      return;
    }

    if (!responsibleName) {
      setCreateAccountError("Preencha o nome do responsável.");
      return;
    }

    setIsCreatingAccount(true);

    try {
      const response = await fetch("/api/zion-admin/accounts/create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email,
          storeName,
          responsibleName,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || "Não foi possível criar a conta.");
      }

      setCreateAccountSuccess({
        email,
        membershipRole: String(payload?.membershipRole || DEFAULT_ADMIN_ACCOUNT_PROVISIONING.membershipRole),
      });

      router.refresh();
    } catch (error: unknown) {
      const message =
        error &&
        typeof error === "object" &&
        "message" in error &&
        typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "Não foi possível criar a conta.";

      setCreateAccountError(message);
    } finally {
      setIsCreatingAccount(false);
    }
  }

  async function handleResendFirstAccess(store: ZionAdminStore) {
    if (!store.id) {
      return;
    }

    setResendBusyStoreId(store.id);
    setResendError(null);
    setResendSuccess(null);

    try {
      const response = await fetch("/api/zion-admin/accounts/resend-first-access", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          storeId: store.id,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || "Nao foi possivel reenviar o link.");
      }

      setResendSuccess("Novo link enviado com sucesso.");
      router.refresh();
    } catch (error: unknown) {
      setResendError(
        error &&
          typeof error === "object" &&
          "message" in error &&
          typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "Nao foi possivel reenviar o link.",
      );
    } finally {
      setResendBusyStoreId(null);
    }
  }

  async function handleToggleAccountAccess(store: ZionAdminStore) {
    const membershipId = store.accountAccess?.membershipId ?? null;
    const action =
      store.accountAccess?.accessState === "active"
        ? "block"
        : store.accountAccess?.accessState === "blocked"
          ? "reactivate"
          : null;

    if (!membershipId || !action) {
      return;
    }

    setAccessBusyMembershipId(membershipId);
    setAccessError(null);
    setAccessSuccess(null);

    try {
      const response = await fetch("/api/zion-admin/accounts/access-state", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          membershipId,
          action,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || "Nao foi possivel atualizar o acesso.");
      }

      setAccessSuccess(
        action === "block"
          ? "Acesso bloqueado com sucesso."
          : "Acesso reativado com sucesso.",
      );
      router.refresh();
    } catch (error: unknown) {
      setAccessError(
        error &&
          typeof error === "object" &&
          "message" in error &&
          typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "Nao foi possivel atualizar o acesso.",
      );
    } finally {
      setAccessBusyMembershipId(null);
    }
  }

  async function handleToggleStoreSubscription(store: ZionAdminStore) {
    const action = getStoreSubscriptionAction(store);

    if (!store.id || !action) {
      return;
    }

    setStoreBusyId(store.id);
    setStoreActionError(null);
    setStoreActionSuccess(null);

    try {
      const response = await fetch("/api/zion-admin/stores/subscription-state", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          storeId: store.id,
          action,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || "Nao foi possivel atualizar o estado da loja.");
      }

      setStoreActionSuccess(
        action === "suspend"
          ? "Loja desativada com sucesso."
          : "Loja reativada com sucesso.",
      );
      router.refresh();
    } catch (error: unknown) {
      setStoreActionError(
        error &&
          typeof error === "object" &&
          "message" in error &&
          typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "Nao foi possivel atualizar o estado da loja.",
      );
    } finally {
      setStoreBusyId(null);
    }
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#080b10] text-[#f4f6fb]">
      <div className="mx-auto grid min-h-screen max-w-[1600px] gap-0 lg:grid-cols-[208px_minmax(0,1fr)]">
        <aside className="border-b border-[#252b35] bg-[#090c11] p-4 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r lg:p-5">
          <div className="flex items-center gap-3 px-1 py-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-400 text-sm font-black text-[#090c11]">Z</div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-200">ZION</div>
              <div className="mt-0.5 text-[11px] text-[#8e98aa]">Interno</div>
            </div>
          </div>
          <div className="mt-8 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#616b7c]">Navegação</div>
          <nav aria-label="Seções administrativas" className="mt-2 grid grid-cols-2 gap-1.5 lg:grid-cols-1">
            {([
              ["overview", "Visão geral", "overview"],
              ["alerts", "Alertas", "alerts"],
              ["stores", "Lojas", "stores"],
              ["comparisons", "Comparações", "comparisons"],
            ] as const).map(([section, label]) => (
              <button
                key={section}
                type="button"
                aria-current={activeGlobalSection === section ? "page" : undefined}
                onClick={() => {
                  setActiveGlobalSection(section);
                  setSelectedStore(null);
                  if (section !== "comparisons") setSelectedOverview(null);
                  if (section === "comparisons") setSelectedOverview("compare");
                }}
                className={[
                  "flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition",
                  activeGlobalSection === section
                    ? "border border-violet-400/30 bg-violet-500/15 font-semibold text-violet-100 shadow-[0_0_20px_rgba(168,139,255,0.08)]"
                    : "border border-transparent text-[#a1aabb] hover:bg-white/[0.06] hover:text-white",
                ].join(" ")}
              >
                <AdminIcon name={section} className="h-4 w-4 shrink-0" />
                {label}
              </button>
            ))}
          </nav>
          <div className="mt-8 hidden border-t border-[#252b35] px-1 pt-4 text-[11px] leading-5 text-[#616b7c] lg:block">
            <div className="font-semibold uppercase tracking-[0.16em] text-[#8e98aa]">ZION interno</div>
            <div className="mt-1">Administrador</div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <header className="flex flex-col gap-4 border-b border-[#252b35] pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8e98aa]">ZION interno</div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#f4f6fb]">Dashboard de lojas</h1>
            <p className="mt-1 text-sm text-[#8e98aa]">Visão consolidada da operação, saúde e atividade das lojas.</p>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto">
            <label className="hidden items-center gap-2 rounded-xl border border-[#252b35] bg-[#10141b] px-3 py-2 text-xs text-[#8e98aa] lg:flex">
              <AdminIcon name="search" className="h-4 w-4" />
              <span className="sr-only">Buscar loja</span>
              <input
                value={activeSearch}
                onChange={(event) => {
                  setActiveSearch(event.target.value);
                  setActiveGlobalSection("stores");
                }}
                placeholder="Buscar loja..."
                className="w-32 bg-transparent text-[#f4f6fb] outline-none placeholder:text-[#616b7c]"
              />
            </label>
            {canManageAccounts ? (
              <button
                type="button"
                onClick={() => {
                  setCreateAccountError(null);
                  setCreateAccountSuccess(null);
                  setIsCreateAccountOpen(true);
                }}
                className="flex items-center gap-1.5 rounded-xl bg-violet-400 px-3 py-2 text-xs font-semibold text-[#090c11] transition hover:bg-violet-300"
              >
                <AdminIcon name="plus" className="h-4 w-4" />
                Nova conta
              </button>
            ) : null}
            <div className="hidden rounded-xl border border-[#252b35] bg-[#10141b] px-3 py-2 text-xs text-[#a1aabb] sm:block">
              Acesso:{" "}
              <span className="font-semibold text-zinc-50">{adminRole}</span>
            </div>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={isSigningOut}
              className="rounded-xl border border-[#252b35] bg-[#10141b] px-3 py-2 text-xs font-semibold text-[#a1aabb] transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSigningOut ? "Saindo..." : "Sair"}
            </button>
          </div>
        </header>

        {!selectedStore && overviewError ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
            {overviewError}
          </div>
        ) : null}

        {!selectedStore && hasCountErrors ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
            Alguns indicadores não puderam ser carregados. A tela mostrou
            somente dados com origem confiável.
          </div>
        ) : null}

        {!selectedStore && activeGlobalSection === "overview" ? (
        <div id="overview" className="space-y-5">
        {orphanStoresCount > 0 ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
            <div className="font-semibold">
              {orphanStoresCount} estrutura(s) fora da lista operacional
            </div>
            <div className="mt-1 text-xs text-amber-100/80">
              Estas estruturas ficam fora da lista operacional e dos indicadores operacionais,
              mas são consideradas no resumo de integridade.
              {integrityOrphanStores.slice(0, 3).map((store) => (
                <div key={store.id}>
                  {store.name}: {getStoreIntegrityStateLabel(store.integrity)}
                  {getStoreIntegrityIssueLabels(store.integrity).length > 0
                    ? ` — ${getStoreIntegrityIssueLabels(store.integrity).join(", ")}`
                    : ""}
                </div>
              ))}
              {integrityOrphanStores.length > 3
                ? ` e mais ${integrityOrphanStores.length - 3} estrutura(s).`
                : ""}
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl border border-[#252b35] bg-[#10141b] p-3 text-xs text-[#8e98aa]">
          <span className="font-semibold text-[#f4f6fb]">Integridade estrutural:</span>{" "}
          {integritySummary.broken} problema(s) · {integritySummary.warning} atenção · {integritySummary.unknown} não verificada(s) · {integritySummary.healthy} saudável(eis)
        </div>

        <section>
          <div className="mb-3 flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                Visão geral de todas as lojas
              </h2>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <DashboardMetricCard label="Total de lojas" value={formatNumber(data?.totals.stores)} helper="Lojas no recorte" icon="stores" tone="blue" />
            <DashboardMetricCard label="Lojas ativas" value={formatNumber(activeStores.length)} helper="Ativas no recorte" icon="check" tone="green" />
            <DashboardMetricCard label="Com problema" value={formatNumber(storesWithProblems)} helper="Saúde ou integridade quebrada" icon="warning" tone="red" />
            <DashboardMetricCard label="Config. bloqueada" value={formatNumber(storesWithBlockedConfiguration)} helper="Prontidão bloqueada" icon="settings" tone="amber" />
            <DashboardMetricCard label="Incidentes IA" value={formatOverviewMetric(data?.totals.failedAiRuns, globalAiRunsAvailability)} helper="Falhas em execuções registradas" icon="brain" tone="violet" />
            <DashboardMetricCard label="Incidentes WhatsApp" value={formatNumber(data?.totals.whatsappErrors)} helper="Erros locais observados" icon="whatsapp" tone="green" />
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[1.35fr_0.65fr]">
            <section className="flex items-center justify-between gap-4 rounded-2xl border border-amber-400/20 bg-amber-500/[0.07] p-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300"><AdminIcon name="warning" className="h-5 w-5" /></span>
                <div>
                  <div className="text-sm font-semibold text-zinc-100">Atenção no recorte</div>
                  <div className="mt-1 text-xs text-zinc-400">{formatNumber(storesWithProblems)} loja(s) sinalizada(s) por saúde ou integridade observada.</div>
                </div>
              </div>
              <button type="button" onClick={() => { setSelectedStore(null); setActiveGlobalSection("alerts"); }} className="shrink-0 rounded-xl border border-amber-300/30 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-400/10">Ver alertas</button>
            </section>
            <section className="rounded-2xl border border-sky-400/20 bg-sky-500/[0.06] p-4">
              <div className="flex items-center gap-2"><AdminIcon name="shield" className="h-4 w-4 text-sky-300" /><h3 className="text-sm font-semibold text-zinc-100">Integridade estrutural</h3></div>
              <div className="mt-2 flex items-center gap-2"><span className="rounded-full border border-sky-300/20 bg-sky-400/10 px-2 py-1 text-[10px] text-sky-100">{integritySummary.broken > 0 ? "Atenção" : integritySummary.unknown > 0 ? "Não verificada" : "Observada"}</span><span className="text-xs text-zinc-400">{integritySummary.broken} problema(s) · {integritySummary.unknown} não verificada(s)</span></div>
              <p className="mt-2 text-xs text-zinc-500">Estruturas órfãs e detalhes continuam disponíveis em Alertas.</p>
            </section>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#f4f6fb]">Acessos rápidos</h3>
              <p className="mt-1 text-xs text-[#8e98aa]">Indicadores detalhados preservando as fontes e disponibilidades atuais.</p>
            </div>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <OverviewButton
              label="Trabalho da IA"
              value={formatOverviewMetric(totalAiRuns, globalAiRunsAvailability)}
              helper={availabilityHelp(globalAiRunsAvailability)}
              active={selectedOverview === "ia"}
              onClick={() =>
                setSelectedOverview((current) =>
                  current === "ia" ? null : "ia",
                )
              }
            />
            <OverviewButton
              label="Comparar lojas"
              value={formatNumber(stores.length)}
              helper="Escolha duas lojas e compare lado a lado"
              active={selectedOverview === "compare"}
              onClick={() => {
                setActiveGlobalSection("comparisons");
                setSelectedOverview("compare");
              }}
            />
            <OverviewButton
              label="Pendências"
              value={formatOverviewMetric(data?.totals.totalOperationalIssues, globalPendingAvailability)}
              helper={availabilityHelp(globalPendingAvailability)}
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
            onClose={() => {
              setSelectedOverview(null);
              setActiveGlobalSection("overview");
            }}
          />
          <div className="mt-5">
            <StoreListSection
              title="Prévia de lojas"
              stores={activeStores}
              search={activeSearch}
              onSearch={setActiveSearch}
              onSelectStore={setSelectedStore}
              preview
            />
          </div>
        </section>

        </div>
        ) : null}

        {!selectedStore && activeGlobalSection === "alerts" ? (
          <GlobalAlertsSection
            stores={stores}
            availability={getGlobalAiAvailability(data, "runs")}
          />
        ) : null}

        {!selectedStore && activeGlobalSection === "comparisons" ? (
          <div id="comparisons" className="scroll-mt-4">
            <OverviewInlineDetails
              type="compare"
              data={data}
              stores={stores}
              onClose={() => {
                setSelectedOverview(null);
                setActiveGlobalSection("overview");
              }}
            />
          </div>
        ) : null}

        {!selectedStore && activeGlobalSection === "stores" ? (
        <div id="stores" className="scroll-mt-4 space-y-3">
          <StoreListSection
            title="Lojas ativas"
            stores={activeStores}
            search={activeSearch}
            onSearch={setActiveSearch}
            selectedStoreId={undefined}
            onSelectStore={setSelectedStore}
          />

          <StoreListSection
            title="Lojas canceladas ou inativas"
            stores={inactiveStores}
            search={inactiveSearch}
            onSearch={setInactiveSearch}
            selectedStoreId={undefined}
            onSelectStore={setSelectedStore}
            inactive
          />
        </div>
        ) : null}
        </div>
      </div>

      <StoreDetailsDrawer
        key={selectedStore?.id ?? "closed"}
        store={selectedStore}
        canManageAccounts={canManageAccounts}
        canManageWhatsappPins={canManageWhatsappPins}
        whatsappPinRecoveryMetaEnabled={whatsappPinRecoveryMetaEnabled}
        onClose={() => setSelectedStore(null)}
        onResendFirstAccess={handleResendFirstAccess}
        onToggleAccountAccess={handleToggleAccountAccess}
        onToggleStoreSubscription={handleToggleStoreSubscription}
        accessState={{
          busyMembershipId: accessBusyMembershipId,
          error: accessError,
          success: accessSuccess,
        }}
        resendState={{
          busyStoreId: resendBusyStoreId,
          error: resendError,
          success: resendSuccess,
        }}
        storeState={{
          busyStoreId: storeBusyId,
          error: storeActionError,
          success: storeActionSuccess,
        }}
      />

      {isCreateAccountOpen ? (
        <AdminCreateAccountModal
          onClose={() => setIsCreateAccountOpen(false)}
          onSubmit={handleCreateAccount}
          busy={isCreatingAccount}
          error={createAccountError}
          success={createAccountSuccess}
        />
      ) : null}
    </main>
  );
}
