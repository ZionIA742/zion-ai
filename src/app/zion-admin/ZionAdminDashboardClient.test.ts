import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatAvailableOverviewValue,
  normalizeOverviewDataAvailability,
} from "./overview-availability";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const clientPath = join(process.cwd(), "src/app/zion-admin/ZionAdminDashboardClient.tsx");

function readSource() {
  return readFileSync(clientPath, "utf8");
}

function loadFormatAiUsageValue() {
  const source = readSource();
  const functionStart = source.indexOf("export function formatAiUsageValue(");
  const bodyStart = source.indexOf(") {", functionStart) + 3;
  const functionEnd = source.indexOf("\n}\n\nfunction formatAiCost", bodyStart);

  assert.notEqual(functionStart, -1, "formatAiUsageValue must exist");
  assert.notEqual(functionEnd, -1, "formatAiUsageValue body must be bounded");

  return new Function(
    "value",
    "availability",
    "completeness",
    "formatter",
    source.slice(bodyStart, functionEnd),
  ) as (
    value: number | string | null | undefined,
    availability: string | undefined,
    completeness: string | null | undefined,
    formatter: (value: number | string | null | undefined) => string,
  ) => string;
}

function loadFormatOverviewPercent() {
  const source = readSource();
  const functionStart = source.indexOf("export function formatOverviewPercent(");
  const bodyStart = source.indexOf("{", functionStart) + 1;
  const functionEnd = source.indexOf("\n}\n\nexport function formatOverviewCompletionLabel", bodyStart);

  assert.notEqual(functionStart, -1, "formatOverviewPercent must exist");
  assert.notEqual(functionEnd, -1, "formatOverviewPercent body must be bounded");

  const implementation = new Function(
    "numerator",
    "denominator",
    "availability",
    "safeNumber",
    "normalizeOverviewDataAvailability",
    "formatPercent",
    source.slice(bodyStart, functionEnd),
  ) as (
    numerator: number | string | null | undefined,
    denominator: number | string | null | undefined,
    availability: string | undefined,
    safeNumber: (value: number | string | null | undefined) => number | null,
    normalizeOverviewDataAvailability: (value: unknown) => string,
    formatPercent: (part: number, total: number) => string,
  ) => string;

  return (
    numerator: number | string | null | undefined,
    denominator: number | string | null | undefined,
    availability: string | undefined,
  ) => implementation(
    numerator,
    denominator,
    availability,
    (value) => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    },
    normalizeOverviewDataAvailability,
    (part, total) => `${Math.round((part / total) * 100)}%`,
  );
}

function loadFormatOverviewCompletionLabel() {
  const source = readSource();
  const functionStart = source.indexOf("export function formatOverviewCompletionLabel(");
  const bodyStart = source.indexOf("{", functionStart) + 1;
  const functionEnd = source.indexOf("\n}\n\nfunction getStoreAiAvailability", bodyStart);

  assert.notEqual(functionStart, -1, "formatOverviewCompletionLabel must exist");
  assert.notEqual(functionEnd, -1, "formatOverviewCompletionLabel body must be bounded");

  const implementation = new Function(
    "numerator",
    "denominator",
    "availability",
    "formatOverviewPercent",
    source.slice(bodyStart, functionEnd),
  ) as (
    numerator: number | string | null | undefined,
    denominator: number | string | null | undefined,
    availability: string | undefined,
    formatOverviewPercent: (
      numerator: number | string | null | undefined,
      denominator: number | string | null | undefined,
      availability: string | undefined,
    ) => string,
  ) => string;

  return (numerator: number, denominator: number, availability: string | undefined) =>
    implementation(numerator, denominator, availability, loadFormatOverviewPercent());
}

const tests: TestCase[] = [
  {
    name: "AI cost and token indicators distinguish unavailable and incomplete data",
    run: () => {
      const source = readSource();
      for (const token of [
        'type AiUsageCompleteness = "complete" | "incomplete" | "no_runs"',
        'if (availability === "unavailable")',
        'if (availability === "partial")',
        'if (completeness === "no_runs")',
        'if (completeness === "incomplete")',
        "formatAiCost(",
        "formatAiTokens(",
        "costCompletenessTotal",
        "tokenCompletenessTotal",
      ]) {
        assert.equal(source.includes(token), true, `missing usage completeness UI contract: ${token}`);
      }
      assert.equal(source.includes('value={formatUsd(store.totalCostUsd)}'), false);
      assert.equal(source.includes('value={formatCompactNumber(store.totalTokens)}'), false);
    },
  },
  {
    name: "AI usage values only confirm numbers for complete available data",
    run: () => {
      const formatAiUsageValue = loadFormatAiUsageValue();
      const formatter = (value: number | string | null | undefined) => `confirmed:${value}`;

      assert.equal(formatAiUsageValue(0, "available", "complete", formatter), "confirmed:0");
      assert.equal(formatAiUsageValue(12.5, "available", "complete", formatter), "confirmed:12.5");
      assert.equal(formatAiUsageValue(0, "available", "no_runs", formatter), "Sem execu\u00e7\u00f5es");
      assert.equal(formatAiUsageValue(0, "available", "incomplete", formatter), "Incompleto");
      assert.equal(formatAiUsageValue(0, "available", undefined, formatter), "Incompleto");
      assert.equal(formatAiUsageValue(0, "available", "unexpected", formatter), "Incompleto");
      assert.equal(formatAiUsageValue(12.5, "partial", "complete", formatter), "Parcial");
      assert.equal(formatAiUsageValue(12.5, "unavailable", "complete", formatter), "Indispon\u00edvel");

      let formatterCalls = 0;
      const guardedFormatter = (value: number | string | null | undefined) => {
        formatterCalls += 1;
        return `confirmed:${value}`;
      };

      assert.equal(formatAiUsageValue(12.5, undefined, "complete", guardedFormatter), "Indispon\u00edvel");
      assert.equal(formatAiUsageValue(12.5, "unexpected", "complete", guardedFormatter), "Indispon\u00edvel");
      assert.equal(formatAiUsageValue(12.5, "partial", "complete", guardedFormatter), "Parcial");
      assert.equal(formatAiUsageValue(12.5, "unavailable", "complete", guardedFormatter), "Indispon\u00edvel");
      assert.equal(formatterCalls, 0);

      assert.equal(formatAiUsageValue(12.5, "available", "complete", guardedFormatter), "confirmed:12.5");
      assert.equal(formatterCalls, 1);
    },
  },
  {
    name: "store subscription action uses dedicated Zion Admin endpoint",
    run: () => {
      const source = readSource();

      assert.equal(source.includes('/api/zion-admin/stores/subscription-state'), true);
      assert.equal(source.includes("1. Ações"), true);
      assert.equal(source.includes("Operação da loja"), true);
      assert.equal(source.includes("Gerencie o funcionamento desta loja no ZION."), true);
      assert.equal(source.includes("Conta responsável"), true);
      assert.equal(source.includes("Gerencie o acesso do responsável à loja."), true);
      assert.equal(source.includes("Desativar loja"), true);
      assert.equal(source.includes("Reativar loja"), true);
      assert.equal(source.includes("Bloquear acesso"), true);
      assert.equal(source.includes("Reativar acesso"), true);
      assert.equal(source.includes("Assinatura canônica"), false);
      assert.equal(source.includes("Autoridade da etapa 5.2: subscriptions.status"), false);
      assert.equal(source.includes("Semântica"), false);
      assert.equal(
        source.includes("Acesso bloqueado = pessoa/conta. Inativa/Suspensa = loja."),
        false,
      );
      assert.equal(
        source.includes("Motivo detalhado ainda não registrado em base confiável."),
        false,
      );
    },
  },
  {
    name: "store action requires explicit confirmation and browser sends only storeId plus action",
    run: () => {
      const source = readSource();

      assert.equal(source.includes("window.confirm("), true);
      assert.equal(source.includes("storeId: store.id"), true);
      assert.equal(source.includes("organizationId: store.organizationId"), false);
      assert.equal(source.includes("subscriptionId:"), false);
    },
  },
  {
    name: "first access control stays visible in drawer header and reuses resend handler",
    run: () => {
      const source = readSource();

      assert.equal(source.includes("Central da loja"), true);
      assert.equal(source.includes('function StoreDetailsDrawer'), true);
      assert.equal(source.includes("getFirstAccessControlState({"), true);
      assert.equal(source.includes("title={firstAccessControl.reason || undefined}"), true);
      assert.equal(source.includes("void onResendFirstAccess(store)"), true);
      assert.equal(source.includes('/api/zion-admin/accounts/resend-first-access'), true);
    },
  },
  {
    name: "historical account overview distinguishes unavailable history from no activity",
    run: () => {
      const source = readSource();

      assert.equal(source.includes('return "Histórico não disponível";'), true);
      assert.equal(source.includes('return "Sem atividade";'), true);
      assert.equal(source.includes("accountAccess?.lastInviteHistoryStatus"), true);
      assert.equal(source.includes("accountAccess?.firstAccessHistoryStatus"), true);
    },
  },
  {
    name: "suspended status is represented in the client",
    run: () => {
      const source = readSource();

      assert.equal(source.includes('if (normalized === "suspended") return "Desativada";'), true);
      assert.equal(source.includes('if (normalized === "active") return "suspend" as const;'), true);
      assert.equal(source.includes('if (normalized === "suspended") return "reactivate" as const;'), true);
      assert.equal(source.includes('"inactive", "Inativas"'), true);
      assert.equal(source.includes("Acesso bloqueado"), true);
      assert.equal(source.includes("Acesso ativo"), true);
    },
  },
  {
    name: "canonical integrity labels and fail-closed fallback are exposed",
    run: () => {
      const source = readSource();

      for (const label of [
        "Saudável",
        "Atenção",
        "Problema",
        "Não verificada",
        "Loja sem proprietário",
        "Mais de um proprietário encontrado",
        "Proprietário inativo",
        "Perfil do proprietário ausente",
        "Assinatura não encontrada",
        "Mais de uma assinatura encontrada",
        "Organização não encontrada",
      ]) {
        assert.equal(source.includes(label), true, `missing integrity label: ${label}`);
      }

      assert.equal(source.includes('integrity?.state ?? "unknown"'), true);
      assert.equal(source.includes("Integridade estrutural"), true);
      assert.equal(source.includes("getOperationalSummary"), true);
      assert.equal(source.includes("getStoreIntegritySummary(stores, integrityOrphanStores)"), true);
      assert.equal(source.includes('orphanStores.slice(0,limit).map((orphan)'), true);
      assert.equal(source.includes("sem usuario vinculado"), false);
      assert.equal(source.includes("não entram nas listas nem nos contadores normais"), false);
      assert.equal(
        source.includes("estrutura(s) fora da lista operacional") &&
          source.includes("orphanStores={integrityOrphanStores}"),
        true,
      );
      assert.equal(source.includes("Revisar:"), false);
      assert.equal(source.includes("Central de alertas"), true);
      assert.equal(source.includes("subscriptionStatus"), true);
      assert.equal(source.includes("accountAccess"), true);
    },
  },
  {
    name: "canonical operational health is surfaced without replacing legacy pending UI",
    run: () => {
      const source = readSource();

      for (const token of [
        "operationalHealth?: StoreOperationalHealth | null",
        "Saúde operacional",
        "Saúde:",
        "WhatsApp",
        "Assistente",
        "Operação",
        "Sem atividade de IA",
        "Não foi possível verificar",
        "Conectividade ao vivo do WhatsApp",
        "Heartbeat dos workers",
        "não afirma que",
        "whatsapp_outbound_stale",
        "assistant_task_stale_pending",
        "responsible_notification_stale_processing",
        "post_appointment_followup_overdue",
      ]) {
        assert.equal(
          source.includes(token),
          true,
          `missing operational health UI token: ${token}`,
        );
      }

      assert.equal(source.includes("presa em processamento"), false);
      assert.equal(source.includes("acima do intervalo monitorado"), true);
      assert.equal(source.includes("critérios de monitoramento"), true);
      assert.equal(source.includes("não comprovam que uma tarefa esteja travada"), true);

      assert.equal(
        source.includes(
          'const operationalHealthState = operationalHealth?.state ?? "unknown";',
        ),
        true,
      );

      assert.equal(
        source.includes(
          'operationalHealth?.whatsapp?.liveConnectivity === "unverified"',
        ),
        true,
      );

      assert.equal(
        source.includes(
          "operationalHealth?.observability?.workerHeartbeatAvailable === false",
        ),
        true,
      );

      assert.equal(
        source.includes("getOperationalSummary(store)"),
        true,
        "legacy pending UI must remain available during 4.3-A",
      );

      assert.equal(
        source.includes("Sem pendências operacionais críticas"),
        true,
        "legacy pending copy must not be removed in 4.3-A",
      );
    },
  },
  {
    name: "overview reconciles the initial server snapshot with one fresh client request",
    run: () => {
      const source = readSource();

      for (const token of [
        "useEffect",
        "useState<ZionAdminOverview | null>(initialData)",
        "useState<string | null>(initialError)",
        'fetch("/api/zion-admin/overview"',
        'credentials: "include"',
        'cache: "no-store"',
        "setData(nextData)",
        "setOverviewError(null)",
        "setSelectedStore((current) =>",
        "controller.abort()",
        "{!selectedStore && overviewError ? (",
      ]) {
        assert.equal(
          source.includes(token),
          true,
          `missing client overview reconciliation token: ${token}`,
        );
      }

      assert.equal(
        source.includes("const data = initialData;"),
        false,
        "dashboard must not remain permanently pinned to the initial server snapshot",
      );

      assert.equal(
        source.includes("setInterval("),
        false,
        "this step must not introduce polling",
      );
    },
  },
  {
    name: "overview indicators fail closed when availability is absent or partial",
    run: () => {
      const source = readSource();

      for (const token of [
        "dataAvailability?:",
        "formatAvailableOverviewValue",
        "normalizeOverviewDataAvailability",
        "getOverviewAvailabilityLabel",
        'getGlobalAiAvailability(data, "runs")',
        'getStoreAiAvailability(store, "runs")',
        'getStoreAiAvailability(store, "queue")',
        'getStoreCommercialAvailability(store, "queue")',
        "getStoreWhatsappAvailability(store)",
        "formatOverviewMetric(store.whatsappErrors, getStoreWhatsappAvailability(store))",
        "formatOverviewMetric(selectedPendingStore.pendingWhatsappEvents, getStoreWhatsappAvailability(selectedPendingStore))",
        "formatOverviewMetric(selectedPendingStore.whatsappErrors, getStoreWhatsappAvailability(selectedPendingStore))",
      ]) {
        assert.equal(source.includes(token), true, `missing availability UI token: ${token}`);
      }
    },
  },
  {
    name: "count presentations bind every scoped indicator to its corresponding availability",
    run: () => {
      const source = readSource();
      const format = (value: unknown) => `confirmed:${String(value)}`;

      assert.equal(formatAvailableOverviewValue(0, "available", format), "confirmed:0");
      assert.equal(formatAvailableOverviewValue(23, "available", format), "confirmed:23");
      assert.equal(formatAvailableOverviewValue(0, "partial", format), "Parcial");
      assert.equal(formatAvailableOverviewValue(0, "unavailable", format), "Indisponível");
      assert.equal(formatAvailableOverviewValue(0, undefined, format), "Indisponível");
      assert.equal(formatAvailableOverviewValue(0, "invalid", format), "Indisponível");

      for (const token of [
        'store.totalLeads, getStoreCountAvailability(store, "leads")',
        'store.totalMessages, getStoreCountAvailability(store, "messages")',
        'store.totalSalesAiMessages, getStoreCountAvailability(store, "messages")',
        'store.totalAssistantMessages, getStoreCountAvailability(store, "assistantMessages")',
        'store.totalAppointments, getStoreCountAvailability(store, "appointments")',
        'selectedStore.totalLeads, getStoreCountAvailability(selectedStore, "leads")',
        'selectedStore.totalSalesAiMessages, getStoreCountAvailability(selectedStore, "messages")',
        'selectedStore.totalAssistantMessages, getStoreCountAvailability(selectedStore, "assistantMessages")',
        'selectedStore.totalAppointments, getStoreCountAvailability(selectedStore, "appointments")',
        'data?.totals.salesAiMessages, getGlobalCountAvailability(data, "messages")',
        'data?.totals.assistantMessages, getGlobalCountAvailability(data, "assistantMessages")',
      ]) {
        assert.equal(source.includes(token), true, `missing count availability binding: ${token}`);
      }

      for (const unguarded of [
        'formatNumber(store.totalSalesAiMessages)',
        'formatNumber(store.totalAssistantMessages)',
        'formatNumber(selectedStore.totalSalesAiMessages)',
        'formatNumber(selectedStore.totalAssistantMessages)',
        'formatNumber(selectedStore.totalLeads)',
        'formatNumber(selectedStore.totalAppointments)',
        'formatNumber(data?.totals.salesAiMessages)',
        'formatNumber(data?.totals.assistantMessages)',
        'formatNumber(store.totalMessages)} msg',
      ]) {
        assert.equal(source.includes(unguarded), false, `unguarded count presentation remains: ${unguarded}`);
      }
    },
  },
  {
    name: "completion rate distinguishes no activity from a true zero and preserves availability states",
    run: () => {
      const formatOverviewPercent = loadFormatOverviewPercent();
      const run = (numerator: number, denominator: number, availability: string | undefined) =>
        formatOverviewPercent(numerator, denominator, availability);

      assert.equal(run(0, 0, "available"), "Sem atividade");
      assert.equal(run(0, 1, "available"), "0%");
      assert.equal(run(1, 1, "available"), "100%");
      assert.equal(run(303, 320, "available"), "95%");
      assert.equal(run(1, 0, "available"), "Indisponível");
      assert.equal(run(-1, 0, "available"), "Indisponível");
      assert.equal(run(0, -1, "available"), "Indisponível");
      assert.equal(run(2, 1, "available"), "Indisponível");
      assert.equal(run(0.5, 1, "available"), "Indisponível");
      assert.equal(run(1, 0.5, "available"), "Indisponível");
      assert.equal(run(0, 0, "partial"), "Parcial");
      assert.equal(run(0, 0, "unavailable"), "Indisponível");
      assert.equal(run(0, 0, undefined), "Indisponível");
      assert.equal(run(0, 0, "invalid"), "Indisponível");
      assert.equal(formatOverviewPercent(0, " ", "available"), "Indisponível");
    },
  },
  {
    name: "completion presentation adds the suffix only to confirmed percentages",
    run: () => {
      const formatOverviewCompletionLabel = loadFormatOverviewCompletionLabel();

      assert.equal(formatOverviewCompletionLabel(0, 0, "available"), "Sem atividade");
      assert.equal(formatOverviewCompletionLabel(0, 1, "available"), "0% concluídas");
      assert.equal(formatOverviewCompletionLabel(1, 1, "available"), "100% concluídas");
      assert.equal(formatOverviewCompletionLabel(303, 320, "available"), "95% concluídas");
      assert.equal(formatOverviewCompletionLabel(0, 0, "partial"), "Parcial");
      assert.equal(formatOverviewCompletionLabel(0, 0, "unavailable"), "Indisponível");
      assert.equal(formatOverviewCompletionLabel(0, 0, undefined), "Indisponível");
    },
  },
  {
    name: "overview labels last seven days and all-message totals truthfully",
    run: () => {
      const source = readSource();

      assert.equal(source.includes('label="Últimos 7 dias"'), true);
      assert.equal(source.includes("· últimos 7 dias"), true);
      assert.equal(source.includes('messages: "Mensagens registradas"'), true);
      assert.equal(source.includes('messages: "Mensagens ativas registradas por loja."'), true);
      assert.equal(source.includes("mensagens registradas`"), true);
      assert.equal(source.includes("mensagens comerciais por loja"), false);
    },
  },
  {
    name: "overview binds queue counts to queue availability and runs errors to ai runs",
    run: () => {
      const source = readSource();

      assert.equal(
        source.includes('store.aiRunQueueErrors, getStoreAiAvailability(store, "queue")'),
        true,
      );
      assert.equal(
        source.includes('selectedPendingStore.aiRunQueueErrors, getStoreAiAvailability(selectedPendingStore, "queue")'),
        true,
      );
      assert.equal(
        source.includes('selectedPendingStore.salesActionErrors, getStoreCommercialAvailability(selectedPendingStore, "queue")'),
        true,
      );
      assert.equal(
        source.includes('selectedStore.failedAiRuns, getStoreAiAvailability(selectedStore, "runs")'),
        true,
      );
      assert.equal(
        source.includes('store.aiRunQueueErrors, getStoreAiAvailability(store, "diagnostics")'),
        false,
      );
      assert.equal(
        source.includes('selectedPendingStore.salesActionErrors, getStoreCommercialAvailability(selectedPendingStore, "diagnostics")'),
        false,
      );
    },
  },
  {
    name: "empty detail presentation does not claim queue absence at either presentation point",
    run: () => {
      const source = readSource();
      const message =
        "Nenhum detalhe de IA ou comercial foi retornado no recorte consultado. Isso não comprova ausência de pendências nas respectivas filas. O contrato atual não informa disponibilidade individual explícita para WhatsApp e configurações.";

      assert.equal(source.split(message).length - 1, 2);
      assert.equal(source.includes("Isso confirma ausência apenas nessas fontes disponíveis"), false);
    },
  },
  {
    name: "canonical account identity is typed and surfaced separately from access",
    run: () => {
      const source = readSource();

      for (const token of [
        'export type StoreAccountIdentityState = "valid" | "broken"',
        '"owner_missing"',
        '"owner_ambiguous"',
        '"auth_user_missing"',
        '"owner_profile_missing"',
        "accountIdentity?: StoreAccountIdentity | null",
        'valid: "Válida"',
        'broken: "Problema"',
        '"Não verificada"',
        '"Conta proprietária não encontrada"',
        '"Mais de uma conta proprietária encontrada"',
        '"Usuário de autenticação ausente"',
        '"Perfil da conta proprietária ausente"',
        "Identidade da conta",
        "Conta proprietária",
        "Usuário de autenticação",
        'label="Perfil"',
        "accountIdentityIssueLabels",
        "accountIdentity.state === \"broken\"",
        "accountIdentity.state === \"broken\" && accountIdentityIssueLabels.length === 0",
        "A identidade canônica da conta apresenta um problema sem detalhes disponíveis.",
        "Valida o vínculo entre a conta proprietária",
        "Não foi possível verificar a identidade canônica desta conta.",
        "Os vínculos canônicos da conta estão consistentes.",
      ]) {
        assert.equal(source.includes(token), true, `missing account identity UI token: ${token}`);
      }

      const validStateIndex = source.indexOf('accountIdentity.state === "valid" ?');
      const consistencyMessageIndex = source.indexOf(
        "Os vínculos canônicos da conta estão consistentes.",
      );
      assert.notEqual(validStateIndex, -1);
      assert.equal(validStateIndex < consistencyMessageIndex, true);
      const brokenFallbackIndex = source.indexOf(
        'accountIdentity.state === "broken" && accountIdentityIssueLabels.length === 0',
      );
      const brokenFallbackSource = source.slice(brokenFallbackIndex, consistencyMessageIndex);
      assert.equal(brokenFallbackSource.includes("Os vínculos canônicos da conta estão consistentes."), false);

      assert.equal(source.includes("accountAccess?: StoreAccountAccess | null"), true);
      assert.equal(source.includes("getAccountAccessStatusHelp"), true);
      assert.equal(source.includes("onToggleAccountAccess"), true);
      assert.equal(source.includes("Primeiro acesso"), true);
      assert.equal(source.includes("Integridade estrutural"), true);
      assert.equal(source.includes("Prontidão das configurações"), true);
      assert.equal(source.includes("Saúde operacional"), true);
      assert.equal(source.includes("membershipId"), true);
      assert.equal(source.includes("userId"), true);
    },
  },
  {
    name: "WhatsApp PIN recovery is restricted to the capability-gated fixed target",
    run: () => {
      const source = readSource();

      for (const token of [
        "function WhatsappPinRecoverySection",
        "function isWhatsappPinRecoveryTargetStore",
        "isWhatsappPinRecoveryTargetStore(store) ?",
        "nenhuma operação será iniciada",
        "if (!canAccess) return null",
        'wabaId: "1642288770859048"',
        'phoneNumberId: "1322472314288518"',
        "metaExecutionEnabled",
        "canManageWhatsappPins",
        "whatsappPinRecoveryMetaEnabled",
      ]) {
        assert.equal(source.includes(token), true, `missing recovery access token: ${token}`);
      }
    },
  },
  {
    name: "recovery UI keeps the disabled branch safe and binds OAuth to the prepared attempt",
    run: () => {
      const source = readSource();

      assert.equal(source.includes("Bloqueada por padrão"), true);
      assert.equal(source.includes("Nenhuma operação, chamada OAuth ou chamada externa"), true);
      assert.equal(source.includes("Esta operação nunca exibe o PIN original."), true);
      assert.equal(source.includes("novo OAuth, sem reutilizar código"), true);
      assert.equal(source.includes("somente após confirmação remota"), true);
      assert.equal(source.includes('/api/zion-admin/whatsapp-pins/recovery'), true);
      assert.equal(source.includes('action: "prepare"'), true);
      assert.equal(source.includes('action,\n          attemptId: recoveryAttempt.attemptId'), true);
      assert.equal(source.includes("localStorage"), false);

      const recoveryStart = source.indexOf("function WhatsappPinRecoverySection");
      const recoveryEnd = source.indexOf("function WhatsappPinsSection", recoveryStart);
      const recoveryBlock = source.slice(recoveryStart, recoveryEnd);
      assert.equal(recoveryBlock.includes("fetch(\"/api/zion-admin/whatsapp-pins/recovery\""), true);
      assert.equal(recoveryBlock.includes("window.FB?.login"), true);
      assert.equal(recoveryBlock.includes("ensureRecoveryMessageListener(flowId);"), true);
      assert.equal(recoveryBlock.includes("isMetaEmbeddedSignupFlowActive"), true);
      assert.equal(recoveryBlock.includes("flow.code !== recoveryCode"), true);
      assert.equal(recoveryBlock.includes("flow.session !== recoverySession"), true);
      assert.equal(recoveryBlock.includes("classificada como fechada"), true);
      assert.equal(recoveryBlock.includes("4 * 60_000"), true);
      assert.equal(recoveryBlock.includes("classifyMetaEmbeddedSignupMessage"), true);
      assert.equal(recoveryBlock.includes('method: "GET"'), true);
      assert.equal(recoveryBlock.includes("payload.resumable !== true"), true);
      assert.equal(recoveryBlock.includes('setRecoveryPhase("remote_confirmed")'), true);
      assert.equal(recoveryBlock.includes("authorizationExpiresAt"), true);
      assert.equal(recoveryBlock.includes("A retomada retornou um alvo divergente"), true);
      assert.equal(recoveryBlock.includes("recoveryResumeSequenceRef"), true);
      assert.equal(recoveryBlock.includes("recoveryResumeLoadingRef"), true);
      assert.equal(recoveryBlock.includes("recoveryResumeSequenceRef.current !== requestId"), true);
      assert.equal(recoveryBlock.includes("recoveryBusyRef.current = true"), true);
      assert.equal(recoveryBlock.includes("recoveryResumeSequenceRef.current += 1"), true);
      assert.equal(recoveryBlock.includes("controller.abort()"), true);
      assert.equal(recoveryBlock.includes(".finally(() =>"), true);
      assert.equal(recoveryBlock.includes("payload.pin"), false);
      assert.equal(recoveryBlock.includes("localStorage"), false);
      assert.equal(recoveryBlock.includes("window.location"), false);
    },
  },
  {
    name: "commercial operational health remains separate and safely labeled",
    run: () => {
      const source = readSource();

      for (const token of [
        'scope: "whatsapp" | "ai" | "assistant" | "commercial"',
        "commercial_action_processing_error",
        "commercial_action_invalid",
        "commercial_action_source_partial",
        "commercial_action_source_unavailable",
        "Ações comerciais",
        "operationalHealth?.commercial?.state ?? \"unknown\"",
        "getOperationalHealthCommercialEvidenceText",
      ]) {
        assert.equal(source.includes(token), true, `missing commercial UI token: ${token}`);
      }
      assert.equal(source.includes('label="A\\u00e7\\u00f5es comerciais"'), false);

      assert.equal(source.includes("processing_error"), true);
      assert.equal(source.includes("retry"), false);
      assert.equal(source.includes("Mensagens comerciais enviadas pela IA"), false);
      assert.equal(source.includes("Mensagens da IA registradas localmente"), true);
    },
  },
  {
    name: "global dashboard uses real section selection without removing existing store controls",
    run: () => {
      const source = readSource();

      for (const token of [
        "Seções administrativas",
        "Dashboard de lojas",
        "Custos",
        "ZionAdminCostsSection",
        "DashboardMetricCard",
        "Total de lojas",
        "Lojas ativas",
        "Config. bloqueada",
        "xl:grid-cols-6",
        'AdminIcon name="warning"',
        'AdminIcon name="shield"',
        "title=\"Lojas\"",
        "Organização",
        "Pendências",
        "AdminIcon",
        "bg-[#080b10]",
        "Navegação",
        "ZION Administrador",
        "GlobalAlertsSection",
        "Nenhuma loja sinalizada neste recorte.",
        "loja(s) com atenção no recorte",
        "activeGlobalSection",
        'activeGlobalSection === section ? "page" : undefined',
        "setActiveGlobalSection(section)",
        'activeGlobalSection === "overview"',
        'activeGlobalSection === "alerts"',
        'activeGlobalSection === "stores"',
        'activeGlobalSection === "comparisons"',
        'type="compare"',
        "Nova conta",
        "WhatsappPinsSection",
        "StoreDetailsDrawer",
        "Abrir loja",
        "Regularização do WhatsApp",
      ]) {
        assert.equal(source.includes(token), true, `missing global dashboard token: ${token}`);
      }

      assert.equal(source.includes('href="#overview"'), false);
      assert.equal(source.includes('href="#alerts"'), false);
      assert.equal(source.includes('href="#stores"'), false);
      assert.equal(source.includes('document.getElementById("comparisons")'), false);
      assert.equal(source.includes("Nenhuma ocorrência crítica observada."), false);
      assert.equal(source.includes("loja(s) com ocorrência monitorada"), false);
      assert.equal(source.includes("setInterval("), false);
      assert.equal(source.includes("/api/zion-admin/overview"), true);
      assert.equal(source.includes("Visão geral"), true);
      assert.equal(source.includes("Comparações"), true);
      assert.equal(source.includes("Acessos rápidos"), false);
      assert.equal(source.includes('activeGlobalSection === "costs"'), true);
      assert.equal(source.includes('"costs", "Custos", "costs"'), true);
      assert.equal(source.includes('"critical" | "ai" | "whatsapp" | "settings" | "structural"'), true);
    },
  },
  {
    name: "store drawer uses real tabs and resets to actions for a new store",
    run: () => {
      const source = readSource();
      const storeDetailsStart = source.indexOf("function StoreDetailsDrawer");
      const storeDetailsEnd = source.indexOf("export function OverviewDetailsDrawer", storeDetailsStart);
      const storeDetailsSource = source.slice(storeDetailsStart, storeDetailsEnd);

      for (const token of [
        "type StoreDetailTab",
        'useState<StoreDetailTab>("actions")',
        'key={selectedStore?.id ?? "closed"}',
        'aria-label="Seções da loja"',
        '["actions", "Ações"]',
        '["health", "Saúde operacional"]',
        '["settings", "Configurações"]',
        '["account", "Conta"]',
        '["usage", "Uso e IA"]',
        '["pending", "Pendências"]',
        '["identification", "Identificação"]',
        'activeStoreTab === tab ? "page" : undefined',
        'onClick={() => setActiveStoreTab(tab)}',
        'activeStoreTab === "actions"',
        'activeStoreTab === "health"',
        'activeStoreTab === "settings"',
        'activeStoreTab === "account"',
        'activeStoreTab === "usage"',
        'activeStoreTab === "pending"',
        'activeStoreTab === "identification"',
      ]) {
        assert.equal(source.includes(token), true, `missing store tab token: ${token}`);
      }

      assert.equal(storeDetailsSource.includes("Central da loja"), true);
      assert.equal(storeDetailsSource.includes("Lojas"), true);
      assert.equal(storeDetailsSource.includes("<DrawerShell"), false);
      assert.equal(storeDetailsSource.includes("fixed inset-0"), false);
      assert.equal(storeDetailsSource.includes("xl:grid-cols-4"), true);
      assert.equal(storeDetailsSource.includes("compact"), true);
      const actionOrder = [
        storeDetailsSource.indexOf("Operação da loja"),
        storeDetailsSource.indexOf("WhatsappPinsSection"),
        storeDetailsSource.indexOf("Conta responsável"),
        storeDetailsSource.indexOf("Regularização do WhatsApp"),
      ];
      assert.equal(actionOrder.every((index) => index >= 0), true);
      assert.equal(
        actionOrder.every((index, position) =>
          position === 0 || index > actionOrder[position - 1],
        ),
        true,
        `actions must follow the DOM order: ${actionOrder.join(", ")}`,
      );
      assert.equal(storeDetailsSource.includes("order-first"), false);
      assert.equal(storeDetailsSource.includes("xl:order-none"), false);
      assert.equal(source.includes("!selectedStore && activeGlobalSection === \"stores\""), true);
      assert.equal(source.includes("setSelectedStore(null);"), true);
      assert.equal(source.includes('role="button" tabIndex={0}'), true);
      assert.equal(source.includes('aria-label={`Abrir loja ${store.name}`}'), true);
      assert.equal(source.includes('event.target === event.currentTarget'), true);
      assert.equal(source.includes('ZION ADMINISTRADOR'), true);
      assert.equal(source.includes("if (section === \"stores\") setSelectedStore(null)"), false);
    },
  },
  {
    name: "store PINs use scoped loading and are absent from the global dashboard",
    run: () => {
      const source = readSource();
      const dashboardSource = source.slice(source.indexOf("export default function ZionAdminDashboardClient"));

      for (const token of [
        "organization_id=${encodeURIComponent(organizationId)}",
        "store_id=${encodeURIComponent(storeId)}",
        "key={store.id}",
        "AbortController",
        "setRevealedPins",
      ]) {
        assert.equal(source.includes(token), true, `missing scoped PIN token: ${token}`);
      }

      assert.equal(dashboardSource.includes("<WhatsappPinsSection"), false);
    },
  },
];


// Regressao: a central da loja nao pode esconder o card quando o acesso ao PIN for negado.
const pinVisibilityTests: TestCase[] = [
  {
    name: "PIN card remains visible on denied access without exposing secrets",
    run: () => {
      const source = readSource();
      const start = source.indexOf("function WhatsappPinsSection({");
      const end = source.indexOf("export default function ZionAdminDashboardClient({", start);
      assert.ok(start !== -1 && end > start);
      const pins = source.slice(start, end);
      assert.equal(pins.includes("if (!canAccess) return null;"), false);
      assert.equal(pins.includes('value="Acesso restrito"'), true);
      assert.equal(pins.includes('if (!canAccess || loaded) return;'), true);
      assert.equal(pins.includes('<button type="button" disabled'), true);
      assert.equal(pins.includes('/api/zion-admin/whatsapp-pins/reveal'), true);
      assert.equal(pins.includes('Histórico de PINs'), true);
      // A recuperacao Meta permanece separada e protegida por permissao.
      const recoveryStart = source.indexOf("function WhatsappPinRecoverySection({");
      const recovery = source.slice(recoveryStart, start);
      assert.equal(recovery.includes("if (!canAccess) return null;"), true);
      assert.equal(recovery.includes("Autorizar na Meta e executar"), true);
      assert.equal(recovery.includes("Autorizar novamente e materializar"), true);
    },
  },
];
tests.push(...pinVisibilityTests);

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`zion-admin-dashboard-client: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
